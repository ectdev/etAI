import { getPool } from '@etai/db';
import { UpstreamServiceError } from '@etai/shared';
import { embedQuery, toVectorLiteral } from '../embedding/embed.js';
import { fuseByRank, toRanked } from './fuse.js';
import { normalizeQuestion } from './question.js';
import { rankChunks } from './rank.js';

export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  path: string;
  title: string;
  headingPath: string | null;
  content: string;
  docType: string;
  temporalDate: string | null;
  temporalPrecision: 'day' | 'month' | null;
  isDeprecated: boolean;
  supersededByPath: string | null;
  project: string | null;
  versionSeries: string | null;
  versionNumber: string | null;
  /** Cosine distance, when vector search found this. Lower is closer. */
  distance: number | null;
  vectorRank: number | null;
  keywordRank: number | null;
  /** Fused score. Higher is better. */
  score: number;
}

export interface SearchOptions {
  /** How many chunks to return. */
  limit?: number;
  /** How many candidates each search contributes before fusing. */
  candidates?: number;
  /** Restrict to one kind of document, for the dashboard and the MCP tool. */
  docType?: string | undefined;
  /** How many results a crowded document type may take. */
  perTypeLimit?: number;
  /** Which types the quota applies to. */
  crowdedTypes?: readonly string[];
  /** Positions a retired document gives up in ranking. */
  deprecatedDemotion?: number;
  /** Positions a document with a newer version gives up. */
  supersededDemotion?: number;
  /**
   * Skips the metadata pass, leaving the fused order untouched. Only the measurement
   * uses this, to show what the ranking is worth.
   */
  skipRanking?: boolean;
  /**
   * A vector for this question that the caller already has.
   *
   * Only the sweep passes it. The sweep runs the same questions at a dozen ranking
   * settings, none of which change what the question means, so embedding each one once
   * per setting buys nothing and costs twelve times the calls. On a free key that is the
   * difference between a sweep that runs and a sweep that stops halfway through on a
   * daily quota.
   *
   * Nothing else should supply this. A vector that does not belong to the question is
   * undetectable here and produces results that look ordinary and are meaningless.
   */
  embedding?: number[];
}

const DEFAULT_LIMIT = 8;

/**
 * Candidates taken from each search before fusion.
 *
 * Wider than the number returned on purpose. A document that vector search puts
 * fifteenth and keyword search puts second should win, and it can only do that if both
 * lists are long enough to contain it.
 */
const DEFAULT_CANDIDATES = 30;

/**
 * The vector search, as one string so a test can read its plan.
 *
 * This is not tidiness. There was already a test asserting that an HNSW index scan
 * appears in the plan for a cosine-ordered query, and it passed for as long as the
 * shipped query could not use the index at all, because it explained a query written in
 * the test rather than the one that runs. A plan test that writes its own query proves
 * that PostgreSQL works.
 *
 * Naming it means the test and the code cannot drift: `search.test.ts` runs EXPLAIN on
 * exactly this text.
 */
export const VECTOR_SEARCH_SQL = `SELECT c.id AS chunk_id, (c.embedding <=> $1::vector) AS distance
     FROM chunk c
    ORDER BY c.embedding <=> $1::vector
    LIMIT $2`;

/** The same search restricted to one document type. See the note above about its plan. */
export const VECTOR_SEARCH_BY_TYPE_SQL = `SELECT c.id AS chunk_id, (c.embedding <=> $1::vector) AS distance
     FROM chunk c
     JOIN document d ON d.id = c.document_id
    WHERE d.deleted_at IS NULL
      AND d.doc_type = $3
    ORDER BY distance
    LIMIT $2`;

export interface SearchResult {
  chunks: RetrievedChunk[];
  /** Distance to the nearest chunk, or null when vector search found nothing. */
  nearestDistance: number | null;
  timings: { embedMs: number; searchMs: number };
  /**
   * True when the embedding provider failed and only keyword search ran.
   *
   * Reported rather than hidden, because a degraded result is a different thing from a
   * good one and the difference is invisible in the rows themselves. Everything
   * downstream needs to know: the relevance gate has no distance to judge with, and a
   * reader deserves to be told that the search behind an answer was the lexical half.
   */
  degraded: boolean;
}

/**
 * Finds the chunks most likely to answer a question.
 *
 * Runs both searches, fuses them by rank, then loads the surviving rows with the
 * document metadata attached, because ranking beyond this point depends on knowing
 * whether a document has been retired or replaced.
 *
 * The two queries are separate rather than one statement with common table expressions.
 * A single query would save a round trip, and at this size that saving is not
 * measurable, while the combined statement is markedly harder to read and to change.
 */
export async function searchChunks(
  question: string,
  options: SearchOptions = {},
): Promise<SearchResult> {
  const pool = getPool();
  const limit = options.limit ?? DEFAULT_LIMIT;
  const candidates = options.candidates ?? DEFAULT_CANDIDATES;

  const normalized = normalizeQuestion(question);

  // Nothing to search for. Both searches would still return their nearest rows, which is
  // noise wearing the shape of an answer, so neither is run.
  if (!normalized.usable) {
    return {
      chunks: [],
      nearestDistance: null,
      timings: { embedMs: 0, searchMs: 0 },
      degraded: false,
    };
  }

  /**
   * The half of the search that does not need a model, kept reachable when the half that
   * does is down.
   *
   * Both indexes are built and both queries are written, and until now an embedding
   * outage took the working one down with it: one `await` threw and the request became a
   * 502 for a system that could still have answered from the keyword index. Retrieval
   * gets measurably worse without vectors, which is the whole argument for hybrid search,
   * and measurably worse is not the same as unavailable.
   *
   * Only an upstream failure is caught. A bug in this code should still be a 500.
   */
  const embedStarted = Date.now();
  let embedding: number[] | null = options.embedding ?? null;

  if (embedding === null) {
    try {
      embedding = await embedQuery(normalized.text);
    } catch (error) {
      if (!(error instanceof UpstreamServiceError)) throw error;
      console.warn(`Embedding unavailable, searching by keyword only: ${error.message}`);
    }
  }

  const embedMs = Date.now() - embedStarted;

  const searchStarted = Date.now();
  const docTypeFilter = options.docType ?? null;

  /**
   * Two shapes, because only one of them can use the vector index.
   *
   * An HNSW index answers `ORDER BY embedding <=> $1 LIMIT n` by walking the graph, and
   * it can only do that when the ordering is the whole query. Join `document` to it and
   * the planner has to collect every row, join, then sort, and the index sits unused no
   * matter how large the table gets. Checked with EXPLAIN rather than assumed: with the
   * join present the plan is a sequential scan and a top-N sort even with sequential
   * scans disabled, and without it the plan is an index scan.
   *
   * Dropping the join is safe because it never excluded anything. A document removed
   * from disk keeps its row and loses its chunks, so there is no chunk behind a deleted
   * document for the filter to catch. `persist.test.ts` holds that rule in place.
   *
   * The filtered shape keeps the join and does not want the index. With a selective
   * filter, finding the few matching rows and sorting them beats walking a graph and
   * discarding most of what it returns, which is what the plan for that shape shows.
   */
  const vectorRows =
    embedding === null
      ? { rows: [] as Array<{ chunk_id: string; distance: string }> }
      : docTypeFilter === null
        ? await pool.query<{ chunk_id: string; distance: string }>(VECTOR_SEARCH_SQL, [
            toVectorLiteral(embedding),
            candidates,
          ])
        : await pool.query<{ chunk_id: string; distance: string }>(VECTOR_SEARCH_BY_TYPE_SQL, [
            toVectorLiteral(embedding),
            candidates,
            docTypeFilter,
          ]);

  /**
   * `websearch_to_tsquery` rather than `plainto_tsquery`, because it accepts what people
   * actually type: quoted phrases, and a leading minus to exclude a word. It also never
   * raises on strange input, which matters when the input is a search box.
   *
   * This one keeps its join in both cases. It needs `document` for the type filter, and
   * unlike the vector query it has nothing to gain from losing it: the GIN index serves
   * the `@@` match either way. The `deleted_at` filter is gone for the same reason it
   * went from the query above, that a deleted document has no chunks to find.
   */
  const runKeyword = (text: string) =>
    pool.query<{ chunk_id: string; rank: string }>(
      `SELECT c.id AS chunk_id, ts_rank(c.search_vector, query) AS rank
       FROM chunk c
       JOIN document d ON d.id = c.document_id,
            websearch_to_tsquery('english', $1) AS query
      WHERE c.search_vector @@ query
        AND ($3::text IS NULL OR d.doc_type = $3)
      ORDER BY rank DESC
      LIMIT $2`,
      [text, candidates, docTypeFilter],
    );

  let keywordRows = await runKeyword(normalized.text);

  /**
   * The widening that only happens when keyword search is carrying the whole query.
   *
   * `websearch_to_tsquery` joins terms with AND, which is right when the vector half is
   * there to catch what wording misses. Alone it is brittle: "What happened to
   * report()?" parses to `'happen' & 'report()'`, and no document in this
   * collection contains both, so a question the corpus plainly answers returned nothing
   * and the system called it out of scope. Measured, not guessed: AND matched 0 chunks
   * and OR matched 14.
   *
   * So the terms are re-joined with OR and the search runs again. Precision drops
   * noticeably, and the ranking shows it: the same question puts three meeting notes
   * above the SDK guide, because "happen" is a common word and it is now enough on its
   * own. That is why this is a fallback rather than the default. Something imprecise to
   * rank beats an empty result that gets reported as a fact about the collection.
   *
   * Still `websearch_to_tsquery`, which understands "or" as a keyword and never raises on
   * strange input. Building a `to_tsquery` string by hand would put user text into query
   * syntax, which is a parser error at best.
   */
  if (embedding === null && keywordRows.rowCount === 0) {
    const anyTerm = normalized.text.split(/\s+/).filter(Boolean).join(' or ');
    if (anyTerm.length > 0) keywordRows = await runKeyword(anyTerm);
  }

  const fused = fuseByRank(
    toRanked(vectorRows.rows, (row) => row.chunk_id),
    toRanked(keywordRows.rows, (row) => row.chunk_id),
  );

  const distanceByChunk = new Map(
    vectorRows.rows.map((row) => [row.chunk_id, Number(row.distance)]),
  );

  /**
   * Ranking sees a good deal more than it returns.
   *
   * The metadata pass can only move a document up if the document is in front of it, and
   * the quota can only replace a crowded result with something better if that something
   * survived this far. This window was originally four times the requested size, which
   * was measurably too narrow: the document answering one of the test questions sat at
   * position 22 and never reached the step that would have promoted it.
   */
  const keep = fused.slice(0, Math.max(limit * 8, 48));
  const searchMs = Date.now() - searchStarted;

  if (keep.length === 0) {
    return {
      chunks: [],
      nearestDistance: null,
      timings: { embedMs, searchMs },
      degraded: embedding === null,
    };
  }

  const detail = await pool.query<{
    chunk_id: string;
    document_id: string;
    path: string;
    title: string;
    heading_path: string | null;
    content: string;
    doc_type: string;
    temporal_date: string | null;
    temporal_precision: 'day' | 'month' | null;
    is_deprecated: boolean;
    superseded_by_path: string | null;
    project: string | null;
    version_series: string | null;
    version_number: string | null;
  }>(
    `SELECT c.id AS chunk_id, d.id AS document_id, d.path, d.title,
            c.heading_path, c.content, d.doc_type, d.temporal_date, d.temporal_precision,
            d.is_deprecated, s.path AS superseded_by_path, d.project,
            d.version_series, d.version_number
       FROM chunk c
       JOIN document d ON d.id = c.document_id
       LEFT JOIN document s ON s.id = d.superseded_by_id
      WHERE c.id = ANY($1::uuid[])`,
    [keep.map((item) => item.chunkId)],
  );

  const byChunkId = new Map(detail.rows.map((row) => [row.chunk_id, row]));

  const candidatesWithMetadata = keep
    .map((item): RetrievedChunk | null => {
      const row = byChunkId.get(item.chunkId);
      if (!row) return null;

      return {
        chunkId: row.chunk_id,
        documentId: row.document_id,
        path: row.path,
        title: row.title,
        headingPath: row.heading_path,
        content: row.content,
        docType: row.doc_type,
        temporalDate: row.temporal_date,
        temporalPrecision: row.temporal_precision,
        isDeprecated: row.is_deprecated,
        supersededByPath: row.superseded_by_path,
        project: row.project,
        versionSeries: row.version_series,
        versionNumber: row.version_number,
        distance: distanceByChunk.get(item.chunkId) ?? null,
        vectorRank: item.vectorRank,
        keywordRank: item.keywordRank,
        score: item.score,
      };
    })
    .filter((chunk): chunk is RetrievedChunk => chunk !== null);

  const chunks = options.skipRanking
    ? candidatesWithMetadata.slice(0, limit)
    : rankChunks(candidatesWithMetadata, {
        limit,
        ...(options.perTypeLimit === undefined ? {} : { perTypeLimit: options.perTypeLimit }),
        ...(options.crowdedTypes === undefined ? {} : { crowdedTypes: options.crowdedTypes }),
        ...(options.deprecatedDemotion === undefined
          ? {}
          : { deprecatedDemotion: options.deprecatedDemotion }),
        ...(options.supersededDemotion === undefined
          ? {}
          : { supersededDemotion: options.supersededDemotion }),
      });

  const distances = vectorRows.rows.map((row) => Number(row.distance));

  return {
    chunks,
    nearestDistance: distances.length > 0 ? Math.min(...distances) : null,
    timings: { embedMs, searchMs },
    degraded: embedding === null,
  };
}
