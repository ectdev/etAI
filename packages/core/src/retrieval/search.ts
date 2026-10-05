import { getPool } from '@etai/db';
import { UpstreamServiceError } from '@etai/shared';
import { embeddingSignature, embedQuery, toVectorLiteral } from '../embedding/embed.js';
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
export const VECTOR_SEARCH_SQL = `SELECT c.id AS chunk_id, (c.embedding <=> $1::vector) AS distance,
          c.content_hash || ':' || c.position AS tiebreak
     FROM chunk c
    WHERE c.embedded_with = $3
    ORDER BY c.embedding <=> $1::vector
    FETCH FIRST $2 ROWS WITH TIES`;

/** The same search restricted to one document type. See the note above about its plan. */
export const VECTOR_SEARCH_BY_TYPE_SQL = `SELECT c.id AS chunk_id, (c.embedding <=> $1::vector) AS distance,
          c.content_hash || ':' || c.position AS tiebreak
     FROM chunk c
     JOIN document d ON d.id = c.document_id
    WHERE d.deleted_at IS NULL
      AND d.doc_type = $3
      AND c.embedded_with = $4
    ORDER BY distance
    FETCH FIRST $2 ROWS WITH TIES`;

/**
 * Keyword search, ranked, with ties broken by where the chunk lives.
 *
 * Templated documents match a query term equally often, so many chunks share one rank.
 * Ordered by rank alone, those ties came back in whatever order the rows happened to sit
 * on disk, which a re-index changes: moving the corpus into new folders moved first place
 * on one question and MRR in the third decimal with not a word of any document changed.
 * Path and position are the chunk's natural key, so the order now survives a re-index and
 * a fresh clone measures what this one does.
 *
 * The vector query above is left alone. Its ORDER BY has to be the bare distance for the
 * HNSW index to serve it, and two chunks at exactly the same float distance do not occur.
 */
export const KEYWORD_SEARCH_SQL = `SELECT c.id AS chunk_id, ts_rank(c.search_vector, query) AS rank,
          c.content_hash || ':' || c.position AS tiebreak
     FROM chunk c
     JOIN document d ON d.id = c.document_id,
          websearch_to_tsquery('english', $1) AS query
    WHERE c.search_vector @@ query
      AND ($3::text IS NULL OR d.doc_type = $3)
    ORDER BY rank DESC, d.path, c.position
    LIMIT $2`;

interface VectorRow {
  chunk_id: string;
  distance: string;
  tiebreak: string;
}

/**
 * Nearest first, ties settled by the stable key, cut at the number asked for.
 *
 * The queries return every row tied with the last one they were asked for (`WITH TIES`),
 * because a plain `LIMIT` cut a run of equal distances wherever the index walk happened
 * to be, and which of the tied chunks made the list changed from one install to the
 * next. With the hashing embeddings that was most questions: a chunk that shares no word
 * with the question sits at exactly 1, and so do dozens of others. The order and the cut
 * are made here instead, where they can be the same everywhere.
 */
export function orderVectorRows(rows: VectorRow[], limit: number): VectorRow[] {
  return [...rows]
    .sort(
      (a, b) =>
        Number(a.distance) - Number(b.distance) ||
        (a.tiebreak < b.tiebreak ? -1 : a.tiebreak > b.tiebreak ? 1 : 0),
    )
    .slice(0, limit);
}

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
  /**
   * True when the keyword query failed and the results come from the vector half alone.
   * Rarer than an embedding outage, since both halves read one database, and reported for
   * the same reason: the reader is looking at half a search.
   */
  keywordUnavailable?: boolean;
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

  const signature = embeddingSignature();
  const docTypeFilter = options.docType ?? null;

  /**
   * `websearch_to_tsquery` rather than `plainto_tsquery`, because it accepts what people
   * actually type: quoted phrases, and a leading minus to exclude a word. It also never
   * raises on strange input, which matters when the input is a search box.
   *
   * This one keeps its join in both cases. It needs `document` for the type filter, and
   * unlike the vector query it has nothing to gain from losing it: the GIN index serves
   * the `@@` match either way. The `deleted_at` filter is gone for the same reason it
   * went from the vector query, that a deleted document has no chunks to find.
   */
  const runKeyword = (text: string) =>
    pool.query<{ chunk_id: string; rank: string; tiebreak: string }>(KEYWORD_SEARCH_SQL, [
      text,
      candidates,
      docTypeFilter,
    ]);

  /**
   * The half that needs a model: embed the question, then find its nearest chunks.
   *
   * An embedding outage is caught here and leaves this half empty rather than failing the
   * request. Retrieval gets measurably worse without vectors, which is the whole argument
   * for hybrid search, and measurably worse is not the same as unavailable.
   *
   * Two query shapes, because only one of them can use the vector index. An HNSW index
   * answers `ORDER BY embedding <=> $1` by walking the graph, and only when the ordering
   * is the whole query: join `document` to it and the planner collects every row, joins,
   * then sorts. Checked with EXPLAIN rather than assumed. Dropping the join is safe
   * because a document removed from disk keeps its row and loses its chunks, so there is
   * no chunk behind a deleted document for the filter to catch. The filtered shape keeps
   * the join and does not want the index: with a selective filter, sorting the few
   * matching rows beats walking a graph and discarding most of what it returns.
   */
  const vectorHalf = async () => {
    const started = Date.now();
    let embedding: number[] | null = options.embedding ?? null;

    if (embedding === null) {
      try {
        embedding = await embedQuery(normalized.text);
      } catch (error) {
        if (!(error instanceof UpstreamServiceError)) throw error;
        console.warn(`Embedding unavailable, searching by keyword only: ${error.message}`);
      }
    }

    const embedMs = Date.now() - started;
    if (embedding === null) return { embedding, rows: [] as VectorRow[], embedMs };

    const { rows } =
      docTypeFilter === null
        ? await pool.query<VectorRow>(VECTOR_SEARCH_SQL, [
            toVectorLiteral(embedding),
            candidates,
            signature,
          ])
        : await pool.query<VectorRow>(VECTOR_SEARCH_BY_TYPE_SQL, [
            toVectorLiteral(embedding),
            candidates,
            docTypeFilter,
            signature,
          ]);

    return { embedding, rows: orderVectorRows(rows, candidates), embedMs };
  };

  /**
   * The two halves share nothing until they are fused, so they run side by side.
   *
   * The keyword query no longer waits behind an embedding call that takes most of a
   * second, and a failure in one half leaves the other's results instead of failing the
   * request: vectors alone when the keyword query is refused, keywords alone when the
   * provider is down. Only a failure of something outside this code is absorbed that
   * way. A bug in either half still fails the request, and both halves failing does too,
   * because there is then nothing honest to return.
   */
  const searchStarted = Date.now();
  const [vectorOutcome, keywordOutcome] = await Promise.allSettled([
    vectorHalf(),
    runKeyword(normalized.text),
  ]);

  for (const outcome of [vectorOutcome, keywordOutcome]) {
    if (outcome.status === 'rejected' && !isOperationalFailure(outcome.reason)) {
      throw outcome.reason;
    }
  }
  // A vector half that caught its own embedding failure fulfilled without searching
  // anything, so it counts as down here. Returning an empty result in that case would
  // tell the reader the collection has nothing, when nothing could be searched.
  const vectorSearched =
    vectorOutcome.status === 'fulfilled' && vectorOutcome.value.embedding !== null;
  if (!vectorSearched && keywordOutcome.status === 'rejected') {
    throw keywordOutcome.reason;
  }

  if (vectorOutcome.status === 'rejected') {
    console.warn(
      `Vector search failed, searching by keyword only: ${describe(vectorOutcome.reason)}`,
    );
  }
  if (keywordOutcome.status === 'rejected') {
    console.warn(
      `Keyword search failed, searching by meaning only: ${describe(keywordOutcome.reason)}`,
    );
  }

  const vectorResult =
    vectorOutcome.status === 'fulfilled'
      ? vectorOutcome.value
      : { embedding: null, rows: [] as VectorRow[], embedMs: Date.now() - searchStarted };
  const embedding = vectorResult.embedding;
  const embedMs = vectorResult.embedMs;
  const vectorRows = { rows: vectorResult.rows };
  const keywordUnavailable = keywordOutcome.status === 'rejected';

  /**
   * A question vector and no stored vector to compare it with, while vectors exist.
   *
   * The query only looks at vectors made with the current signature, because a vector
   * from another model sits in a different space and its distance to this question is a
   * number with no meaning. When none match, the index was built by something else: the
   * model was changed and `pnpm ingest --write` has not been run since. Search then
   * does what it does when the embedding provider is down, keyword only and marked
   * degraded, rather than returning neighbours from the wrong space as though they were
   * close. The extra query runs only in that abnormal case.
   */
  const indexFromAnotherModel =
    embedding !== null &&
    docTypeFilter === null &&
    vectorRows.rows.length === 0 &&
    (await indexHasAnyVectors(pool));

  if (indexFromAnotherModel) {
    console.warn(
      `The index holds no vectors made with ${signature}. Searching by keyword only until ` +
        'pnpm ingest --write re-embeds the corpus.',
    );
  }

  const keywordAlone = embedding === null || indexFromAnotherModel;

  let keywordRows =
    keywordOutcome.status === 'fulfilled' ? keywordOutcome.value : { rows: [], rowCount: 0 };

  /**
   * The widening that only happens when keyword search is carrying the whole query.
   *
   * `websearch_to_tsquery` joins terms with AND, which is right when the vector half is
   * there to catch what wording misses. Alone it is brittle: "Why is the build cache kept
   * separate from the artifact store?" parses to
   * `'build' & 'cach' & 'kept' & 'separ' & 'artifact' & 'store'`, and no chunk in this
   * collection carries all six, so a question the corpus answers in a document named
   * after it returned nothing and the system called it out of scope. Measured, not
   * guessed: AND matched 0 chunks and OR matched 109.
   *
   * So the terms are re-joined with OR and the search runs again. What that costs is
   * visible in the same numbers: 109 of the 131 chunks now match, which is most of the
   * collection, and the ranking has to do all the work of telling them apart. It happens
   * to put the right document first here. It will not always, which is why this is a
   * fallback rather than the default. Something imprecise to rank beats an empty result
   * that gets reported as a fact about the collection.
   *
   * Still `websearch_to_tsquery`, which understands "or" as a keyword and never raises on
   * strange input. Building a `to_tsquery` string by hand would put user text into query
   * syntax, which is a parser error at best.
   */
  if (keywordAlone && !keywordUnavailable && keywordRows.rowCount === 0) {
    const anyTerm = normalized.text.split(/\s+/).filter(Boolean).join(' or ');
    if (anyTerm.length > 0) keywordRows = await runKeyword(anyTerm);
  }

  const fused = fuseByRank(
    toRanked(
      vectorRows.rows,
      (row) => row.chunk_id,
      (row) => row.tiebreak,
    ),
    toRanked(
      keywordRows.rows,
      (row) => row.chunk_id,
      (row) => row.tiebreak,
    ),
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
      degraded: keywordAlone,
      ...(keywordUnavailable ? { keywordUnavailable: true } : {}),
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
    degraded: keywordAlone,
    ...(keywordUnavailable ? { keywordUnavailable: true } : {}),
  };
}

/** Whether the index holds vectors at all, any signature. Asked only when none matched. */
async function indexHasAnyVectors(pool: ReturnType<typeof getPool>): Promise<boolean> {
  const { rows } = await pool.query<{ exists: boolean }>(
    'SELECT EXISTS (SELECT 1 FROM chunk WHERE embedding IS NOT NULL) AS exists',
  );
  return rows[0]?.exists === true;
}

/**
 * A failure of something this code depends on rather than of this code: the embedding
 * provider, a database that refused a query (a five character SQLSTATE such as `57014`
 * for a statement timeout), or a connection that could not be made. A bug is none of
 * these and is left to fail the request.
 */
export function isOperationalFailure(error: unknown): boolean {
  if (error instanceof UpstreamServiceError) return true;
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && (/^[0-9A-Z]{5}$/.test(code) || /^E[A-Z]+$/.test(code));
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
