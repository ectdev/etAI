import { RELEVANCE_DISTANCE_LIMIT, type Coverage } from '@etai/shared';
import { answerQuestion } from '../generation/answer.js';
import { searchChunks } from '../retrieval/search.js';
import { evalQueries, type EvalQuery, type QueryExpectation } from './queries.js';

/**
 * Runs the same questions through both generation providers and reports the difference.
 *
 * Retrieval is identical whichever model writes the answer, so `recall@5` cannot separate
 * them and reporting it here would be padding. What can separate them is judgement:
 * whether a model reads the retrieved documents and reaches the right conclusion about
 * how much of the question they answer, and whether it cites only what it was given.
 *
 * Only questions that reach a model are worth running. One turned away by the distance
 * check never becomes a model call, so both providers produce the identical refusal by
 * construction, and counting those would inflate agreement with rows that measure
 * nothing. The set is filtered on that first, using search alone, which costs one
 * embedding call per question and no generation.
 */

/** What each label should produce when the model reads the documents correctly. */
export function expectedCoverage(expectation: QueryExpectation): Coverage[] {
  switch (expectation) {
    case 'answerable':
      return ['full'];
    case 'partial':
      return ['partial'];
    case 'out_of_scope':
      // Either refusal is right. Whether a question is unwritten or unrelated is a
      // judgement the documents do not settle, and both replies are honest.
      return ['not_documented', 'out_of_scope'];
  }
}

export interface ProviderScore {
  label: string;
  questions: number;
  /** Answers whose coverage matched what the documents support. */
  coverageCorrect: number;
  /** Answers that cited nothing they were not given. */
  citationsClean: number;
  /** Answers that should have carried a citation and did. */
  citedWhenAnswering: number;
  answersExpected: number;
  medianLatencyMs: number;
  disagreements: Array<{ question: string; expected: Coverage[]; got: Coverage }>;
}

export interface ProviderChoice {
  label: string;
  provider: string;
  model: string;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round(((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2)
    : (sorted[middle] ?? 0);
}

/**
 * Keeps the questions a model actually sees.
 *
 * Search only, so this costs an embedding call each and nothing else. Running
 * `answerQuestion` to find out would spend the generation this is trying to decide
 * whether to spend.
 */
export async function questionsThatReachTheModel(queries: EvalQuery[]): Promise<EvalQuery[]> {
  const reaching: EvalQuery[] = [];

  for (const query of queries) {
    const { nearestDistance } = await searchChunks(query.question);
    if (nearestDistance !== null && nearestDistance <= RELEVANCE_DISTANCE_LIMIT) {
      reaching.push(query);
    }
  }

  return reaching;
}

/** Scores one provider over a set of questions. */
export async function scoreProvider(
  choice: ProviderChoice,
  queries: EvalQuery[],
): Promise<ProviderScore> {
  let coverageCorrect = 0;
  let citationsClean = 0;
  let citedWhenAnswering = 0;
  let answersExpected = 0;
  const latencies: number[] = [];
  const disagreements: ProviderScore['disagreements'] = [];

  for (const query of queries) {
    const result = await answerQuestion(query.question, {
      provider: choice.provider,
      model: choice.model,
    });

    const expected = expectedCoverage(query.expect);

    if (expected.includes(result.coverage)) {
      coverageCorrect += 1;
    } else {
      disagreements.push({ question: query.question, expected, got: result.coverage });
    }

    if (result.droppedCitations.length === 0) citationsClean += 1;

    // An answer with no citation is unsupported prose whatever it says. Counted only
    // where an answer was expected, since a refusal citing nothing is correct.
    if (query.expect !== 'out_of_scope') {
      answersExpected += 1;
      if (result.citations.length > 0) citedWhenAnswering += 1;
    }

    latencies.push(result.timings.generationMs);
  }

  return {
    label: choice.label,
    questions: queries.length,
    coverageCorrect,
    citationsClean,
    citedWhenAnswering,
    answersExpected,
    medianLatencyMs: median(latencies),
    disagreements,
  };
}

/** The two providers the project supports, as the README describes them. */
export const PROVIDERS: ProviderChoice[] = [
  { label: 'gemini-3.6-flash', provider: 'google', model: 'gemini-3.6-flash' },
  { label: 'claude-sonnet-5', provider: 'anthropic', model: 'claude-sonnet-5' },
];

export function comparisonSet(): EvalQuery[] {
  return evalQueries;
}
