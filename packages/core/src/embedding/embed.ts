import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { embed, embedMany } from 'ai';
import { LRUCache } from 'lru-cache';
import { getEnv, type Env } from '@etai/shared/env';
import {
  callUpstream,
  PROVIDER_TIMEOUT_MS,
  RELEVANCE_DISTANCE_LIMITS,
  VECTOR_DIMENSIONS,
} from '@etai/shared';
import { EMBEDDING_TEXT_VERSION } from '../ingestion/embed-text.js';
import { HASHING_MODEL, hashEmbedding } from './hashing.js';

/**
 * What the current configuration would embed with, as the string stored beside every
 * vector it produces: provider, model, width and text format version.
 *
 * Compared for equality and nothing else. Two vectors are comparable when their
 * signatures match, and a stored vector whose signature differs from this one is stale:
 * ingestion makes it again, search leaves it out, and the dashboard counts it.
 */
/**
 * The distance beyond which a question is refused before a model is asked, for the
 * embeddings this process is configured with. See RELEVANCE_DISTANCE_LIMITS for why it
 * differs by provider.
 */
export function relevanceLimit(): number {
  return relevanceLimitFor(getEnv());
}

export function relevanceLimitFor(env: Pick<Env, 'EMBEDDING_PROVIDER'>): number {
  return RELEVANCE_DISTANCE_LIMITS[env.EMBEDDING_PROVIDER];
}

export function embeddingSignature(): string {
  return signatureFor(getEnv());
}

/** The pure half, so every combination can be tested without touching the environment. */
export function signatureFor(env: Pick<Env, 'EMBEDDING_PROVIDER' | 'EMBEDDING_MODEL'>): string {
  const model = env.EMBEDDING_PROVIDER === 'hashing' ? HASHING_MODEL : env.EMBEDDING_MODEL.trim();
  return `${env.EMBEDDING_PROVIDER}:${model}:${VECTOR_DIMENSIONS}:text-v${EMBEDDING_TEXT_VERSION}`;
}

/**
 * Real embeddings come from Google, whichever provider writes the answers, because the
 * Anthropic API has no embeddings endpoint. The keyless alternative is in hashing.ts.
 */
function embeddingModel() {
  const env = getEnv();
  return createGoogleGenerativeAI({ apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY }).textEmbeddingModel(
    env.EMBEDDING_MODEL,
  );
}

/**
 * Two things are passed to the model on every call, and both matter.
 *
 * The width is asked for explicitly. The model returns 3072 numbers by default and
 * pgvector cannot build an HNSW index above 2000, so the default would leave every
 * search scanning the whole table. At 1536 the vector still comes back at unit length,
 * so cosine distance needs no extra step.
 *
 * The task type is what the text is going to be used for. A document being stored and a
 * question being asked are not the same kind of text, and telling the model which is
 * which produces vectors that are meant to be compared against each other. Embedding
 * both as though they were documents is a quiet way to lose retrieval quality.
 */
function providerOptions(taskType: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY') {
  return {
    google: {
      outputDimensionality: VECTOR_DIMENSIONS,
      taskType,
    },
  };
}

export interface EmbedResult {
  embeddings: number[][];
  /** Tokens the provider reported, when it reports any. */
  tokens: number | undefined;
}

/**
 * Embeds text that is being stored.
 *
 * Retries and request batching are left to the SDK, which knows how many values the
 * model accepts per call and applies exponential backoff between attempts. Writing
 * either by hand would mean guessing at limits the library already knows.
 */
export async function embedDocuments(texts: string[]): Promise<EmbedResult> {
  if (texts.length === 0) return { embeddings: [], tokens: 0 };

  if (getEnv().EMBEDDING_PROVIDER === 'hashing') {
    return { embeddings: texts.map((text) => hashEmbedding(text)), tokens: undefined };
  }

  const result = await callUpstream('embedding', () =>
    embedMany({
      model: embeddingModel(),
      values: texts,
      providerOptions: providerOptions('RETRIEVAL_DOCUMENT'),
      maxRetries: 4,
      abortSignal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS.documentEmbeddings),
      // Kept modest on purpose. The whole collection is a few hundred values, so there
      // is nothing to gain from pushing concurrency into rate limit territory.
      maxParallelCalls: 3,
    }),
  );

  return { embeddings: result.embeddings, tokens: result.usage?.tokens };
}

/**
 * Question vectors already computed, by signature and text.
 *
 * The chat page searches and then asks, and both embed the same question, so every
 * question used to be paid for twice. The vector depends only on the text and on what
 * makes it, so the second call can be the first call's answer. The signature is part of
 * the key, which means a configuration change can never be served a vector from before it.
 *
 * Bounded by count and by age: at 1536 numbers a vector is about 12 KB, so 500 of them
 * are a few megabytes, and an hour keeps a long running server from holding a provider's
 * output forever. Concurrent requests for the same key share one call rather than racing
 * to make two. Failures are never cached.
 */
const queryVectors = new LRUCache<string, readonly number[], { timeoutMs: number }>({
  max: 500,
  ttl: 60 * 60 * 1000,
  fetchMethod: async (key, _stale, { context }) => {
    const text = key.slice(key.indexOf(KEY_SEPARATOR) + 1);
    return Object.freeze(await embedQueryUncached(text, context.timeoutMs));
  },
});

const KEY_SEPARATOR = String.fromCharCode(0);

/** The cache key: signature and text, separated by a character neither can contain. */
export function queryCacheKey(signature: string, text: string): string {
  return `${signature}${KEY_SEPARATOR}${text}`;
}

/**
 * Embeds a question, from the cache when the same question was embedded recently.
 *
 * The deadline defaults to the one a person waiting on a search can afford. A batch, such
 * as the evaluation, passes `PROVIDER_TIMEOUT_MS.batchQueryEmbedding` so the SDK has room
 * to back off when it meets the provider's per-minute limit.
 */
export async function embedQuery(
  text: string,
  options: { timeoutMs?: number } = {},
): Promise<number[]> {
  const timeoutMs = options.timeoutMs ?? PROVIDER_TIMEOUT_MS.queryEmbedding;
  const vector = await queryVectors.fetch(queryCacheKey(embeddingSignature(), text), {
    context: { timeoutMs },
  });
  // fetch resolves undefined only when the fetch was aborted, which nothing here does.
  if (!vector) return embedQueryUncached(text, timeoutMs);
  return vector as number[];
}

/** Empties the question cache. For tests, and for nothing else. */
export function clearQueryCache(): void {
  queryVectors.clear();
}

/** Embeds a question. The task type is the only difference, and it is the important one. */
async function embedQueryUncached(
  text: string,
  timeoutMs: number = PROVIDER_TIMEOUT_MS.queryEmbedding,
): Promise<number[]> {
  if (getEnv().EMBEDDING_PROVIDER === 'hashing') return hashEmbedding(text);
  const result = await callUpstream('embedding', () =>
    embed({
      model: embeddingModel(),
      value: text,
      providerOptions: providerOptions('RETRIEVAL_QUERY'),
      maxRetries: 4,
      abortSignal: AbortSignal.timeout(timeoutMs),
    }),
  );

  return result.embedding;
}

/** pgvector reads a vector from this shape rather than from an array parameter. */
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}
