import { getPool } from '@etai/db';
import { embedQuery, toVectorLiteral } from '../embedding/embed.js';
import { searchChunks } from '../retrieval/search.js';
import { evalQueries, type EvalQuery, type QueryExpectation } from './queries.js';

/**
 * Runs every question in the set through a retrieval strategy and reports what came back.
 *
 * The strategy is a parameter so that a change can be compared against what came before
 * it. A ranking change that nobody measured against the previous version is a change,
 * not an improvement, and the two are easy to confuse when the results look plausible
 * either way.
 */

export interface QueryMeasurement {
  question: string;
  expect: QueryExpectation;
  group: string;
  /** Distance to the nearest chunk. Lower is closer. */
  nearest: number;
  /** Document paths of the top results, best first, with duplicates removed. */
  top: string[];
  /** For answerable questions, whether every expected document was retrieved. */
  hit: boolean | null;
  /** Rank of the first expected document, one based. Null when none was retrieved. */
  firstExpectedRank: number | null;
}

/** How many results a measurement looks at. Also the k in recall@k. */
export const TOP_K = 5;

export interface RetrievalOutcome {
  paths: string[];
  nearestDistance: number | null;
}

export type Retriever = (question: string) => Promise<RetrievalOutcome>;

/** The baseline: vector similarity alone, which is where this started. */
export const vectorOnlyRetriever: Retriever = async (question) => {
  const pool = getPool();
  const embedding = await embedQuery(question);

  const { rows } = await pool.query<{ path: string; distance: string }>(
    `SELECT d.path, (c.embedding <=> $1::vector) AS distance
       FROM chunk c
       JOIN document d ON d.id = c.document_id
      WHERE d.deleted_at IS NULL AND c.embedding IS NOT NULL
      ORDER BY distance
      LIMIT $2`,
    [toVectorLiteral(embedding), TOP_K],
  );

  return {
    paths: rows.map((row) => row.path),
    nearestDistance: rows.length > 0 ? Number(rows[0]?.distance) : null,
  };
};

/** Vector and keyword search fused by rank, with no metadata pass after it. */
export const fusedOnlyRetriever: Retriever = async (question) => {
  const result = await searchChunks(question, { limit: TOP_K, skipRanking: true });

  return {
    paths: [...new Set(result.chunks.map((chunk) => chunk.path))],
    nearestDistance: result.nearestDistance,
  };
};

/** The full pipeline: both searches, fused, then ranked on what is known about each document. */
export const hybridRetriever: Retriever = async (question) => {
  const result = await searchChunks(question, { limit: TOP_K });

  return {
    // Several chunks can come from one document, and recall is about documents.
    paths: [...new Set(result.chunks.map((chunk) => chunk.path))],
    nearestDistance: result.nearestDistance,
  };
};

export async function measureQueries(
  retrieve: Retriever,
  queries: EvalQuery[] = evalQueries,
): Promise<QueryMeasurement[]> {
  const results: QueryMeasurement[] = [];

  for (const query of queries) {
    const { paths, nearestDistance } = await retrieve(query.question);
    const expected = query.documents ?? [];
    const firstExpectedIndex = paths.findIndex((path) => expected.includes(path));

    results.push({
      question: query.question,
      expect: query.expect,
      group: query.group,
      nearest: nearestDistance ?? 1,
      top: paths,
      hit: expected.length === 0 ? null : expected.every((path) => paths.includes(path)),
      firstExpectedRank: firstExpectedIndex >= 0 ? firstExpectedIndex + 1 : null,
    });
  }

  return results;
}

export interface RetrievalScore {
  answerable: number;
  recallAtK: number;
  firstPlace: number;
  /** Mean reciprocal rank over the questions with an expected document. */
  mrr: number;
}

export function scoreRetrieval(results: QueryMeasurement[]): RetrievalScore {
  const answerable = results.filter((result) => result.expect === 'answerable');

  const reciprocalRanks = answerable.map((result) =>
    result.firstExpectedRank ? 1 / result.firstExpectedRank : 0,
  );

  return {
    answerable: answerable.length,
    recallAtK: answerable.filter((result) => result.hit === true).length,
    firstPlace: answerable.filter((result) => result.firstExpectedRank === 1).length,
    mrr: reciprocalRanks.reduce((total, value) => total + value, 0) / (answerable.length || 1),
  };
}
