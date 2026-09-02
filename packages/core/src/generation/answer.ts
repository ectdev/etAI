import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateObject } from 'ai';
import {
  callUpstream,
  groundedAnswerSchema,
  RELEVANCE_DISTANCE_LIMIT,
  type AnswerResponse,
} from '@etai/shared';
import { getEnv } from '@etai/shared/env';
import { normalizeQuestion, unusableQuestionMessage } from '../retrieval/question.js';
import {
  searchChunks,
  type RetrievedChunk,
  type SearchOptions,
  type SearchResult,
} from '../retrieval/search.js';
import { linkCitations } from './cite.js';
import { buildUserPrompt, SYSTEM_PROMPT } from './prompt.js';
import { degradedNoResultsAnswer, outOfScopeAnswer, verifyAnswer } from './verify.js';

/**
 * The model that writes answers.
 *
 * Either provider works and the choice is a setting rather than a rewrite, because the
 * SDK gives both the same interface. Google is the default only because embeddings
 * already need that key, so one key runs everything.
 */
function generationModel(provider: string, model: string) {
  const env = getEnv();

  if (provider === 'anthropic') {
    if (!env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is required when the generation provider is "anthropic"');
    }
    return createAnthropic({ apiKey: env.ANTHROPIC_API_KEY })(model);
  }

  return createGoogleGenerativeAI({ apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY })(model);
}

export interface AskOptions extends SearchOptions {
  /**
   * Distance beyond which the question is refused without asking a model. Exposed so a
   * measurement can vary it; the default comes from `pnpm eval`.
   */
  relevanceLimit?: number;
  /**
   * Which model writes the answer, when it should not be the configured one.
   *
   * Here so the two providers can be compared in one run rather than by setting the
   * environment and running twice. Nothing in the application passes it: the application
   * uses what `.env` says, and this is the measurement's door.
   */
  provider?: string;
  model?: string;
}

function toSource(chunk: RetrievedChunk) {
  return {
    documentId: chunk.documentId,
    path: chunk.path,
    title: chunk.title,
    headingPath: chunk.headingPath,
    docType: chunk.docType,
    temporalDate: chunk.temporalDate,
    isDeprecated: chunk.isDeprecated,
    supersededByPath: chunk.supersededByPath,
    distance: chunk.distance,
  };
}

/**
 * Whether retrieval found anything worth asking a model about.
 *
 * Its own function so it can be tested without a model call, which is the only way the
 * degraded branch below gets covered: reaching it for real needs an embedding provider
 * that is down, and that is not a state to wait around for.
 *
 * `nearestDistance === null` normally means vector search found nothing, which is the
 * strongest signal available that a question is not about this collection. Under a
 * degraded search it means something else entirely: there was no embedding to measure
 * with. Read the usual way, every question would look out of scope and the system would
 * refuse everything while appearing to work.
 *
 * So the gate stands down rather than being reinterpreted, and coverage carries the
 * weight instead. That is a real loss and worth naming: 25 of the 34 out of scope
 * questions in the measurement set stop here without a model call, and under a degraded
 * search they reach the model and are refused by judgement. Slower, more expensive, and
 * still correct.
 */
export function isNothingClose(
  search: Pick<SearchResult, 'chunks' | 'nearestDistance' | 'degraded'>,
  relevanceLimit: number,
): boolean {
  if (search.chunks.length === 0) return true;
  if (search.degraded) return false;

  return search.nearestDistance === null || search.nearestDistance > relevanceLimit;
}

/**
 * Answers a question from the indexed documents, or explains why it cannot.
 *
 * Three things stand between a question and a confident wrong answer, and they are
 * deliberately of different kinds. A distance check refuses what is plainly unrelated
 * before any model is involved. The prompt tells the model to answer only from what it is
 * given. And the citations that come back are checked against what was actually
 * retrieved, which is the only one of the three that does not depend on the model
 * cooperating.
 */
export async function answerQuestion(
  question: string,
  options: AskOptions = {},
): Promise<AnswerResponse> {
  const env = getEnv();
  const relevanceLimit = options.relevanceLimit ?? RELEVANCE_DISTANCE_LIMIT;
  const provider = options.provider ?? env.GENERATION_PROVIDER;
  const model = options.model ?? env.GENERATION_MODEL;

  const normalized = normalizeQuestion(question);

  // An unusable question gets an answer rather than an error. Someone who pressed enter on
  // an empty box wants to be told what to do next, not handed a failure.
  if (!normalized.usable && normalized.problem) {
    return {
      answer: '',
      citations: [],
      coverage: 'out_of_scope',
      gap: unusableQuestionMessage(normalized.problem),
      droppedCitations: [],
      coherence: [],
      sources: [],
      timings: { retrievalMs: 0, generationMs: 0 },
      model,
    };
  }

  const retrievalStarted = Date.now();
  const search = await searchChunks(normalized.text, options);
  const retrievalMs = Date.now() - retrievalStarted;

  const nothingClose = isNothingClose(search, relevanceLimit);

  if (nothingClose) {
    // No model call at all, which is where most of the refusals happen. See the note on
    // `isNothingClose` for what that is worth and when it stops being available.
    return {
      ...(search.degraded ? degradedNoResultsAnswer() : outOfScopeAnswer()),
      // Spelled out rather than inherited from the refusal. A refusal has nothing to
      // cite, and saying so here is what makes the two citation shapes stay distinct:
      // the gate produces one kind, a reader receives another.
      citations: [],
      sources: search.chunks.map(toSource),
      timings: { retrievalMs, generationMs: 0 },
      model,
      ...(search.degraded ? { degraded: true } : {}),
    };
  }

  const generationStarted = Date.now();

  // Named so a provider outage arrives as an upstream failure rather than as an
  // unexpected one. The SDK has already retried twice by the time this throws.
  const { object } = await callUpstream(`${provider} generation`, () =>
    generateObject({
      model: generationModel(provider, model),
      schema: groundedAnswerSchema,
      system: SYSTEM_PROMPT,
      // The normalised text, not the raw question. Searching one string and asking the
      // model about another means the documents in front of it answer a question it was
      // not given: past the length cap the search sees the first 500 characters and the
      // model would see all of them. The HTTP route caps input before it gets here, so
      // this is reachable through the library rather than the API, which is exactly the
      // sort of gap that opens when a second caller arrives.
      prompt: buildUserPrompt(normalized.text, search.chunks),
      // A grounded answer is a reading task rather than a writing one, and sampling
      // widely here produces prose that drifts from the documents it is reporting.
      // Google honours this. Anthropic does not accept it on this model and the SDK
      // warns and ignores it, so switching provider gives up the determinism.
      temperature: 0,
      maxRetries: 2,
    }),
  );

  const generationMs = Date.now() - generationStarted;

  const verified = verifyAnswer(
    object,
    search.chunks.map((chunk) => chunk.path),
    /**
     * The text the model was shown, so the gate can tell a real quote from a made up one.
     * A document contributing two chunks gets both, joined, because the model may quote
     * from either and the gate should not call the second one invented.
     */
    search.chunks.reduce((byPath, chunk) => {
      const existing = byPath.get(chunk.path);
      byPath.set(chunk.path, existing ? `${existing}\n\n${chunk.content}` : chunk.content);
      return byPath;
    }, new Map<string, string>()),
  );

  /**
   * A gate that silently repairs is a gate nobody can see working, and a model that got
   * worse would look exactly like a model that stayed the same. The counts are stored
   * with the question and the totals are on the dashboard; this line is for whoever is
   * reading the log at the time rather than the record.
   *
   * On stderr, because the MCP server imports this module and stdout there is the
   * protocol. `console.warn` writes to stderr, and a test asserts every line on stdout
   * parses as JSON-RPC, so this cannot quietly become a protocol error.
   */
  if (verified.coherence.length > 0) {
    console.warn(
      `Answer broke ${verified.coherence.length} coherence rule(s): ${verified.coherence
        .map((violation) => `${violation.rule} x${violation.count}`)
        .join(', ')}`,
    );
  }

  // Verify first, then link. A citation earns its number by surviving the gate, so a
  // number can never be attached to something that was not retrieved.
  const sources = search.chunks.map(toSource);

  return {
    ...verified,
    citations: linkCitations(verified.citations, sources),
    sources,
    timings: { retrievalMs, generationMs },
    model,
    ...(search.degraded ? { degraded: true } : {}),
  };
}
