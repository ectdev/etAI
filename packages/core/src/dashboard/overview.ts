import {
  chunk,
  document,
  getDb,
  ingestionItem,
  ingestionRun,
  searchQuery,
  user,
  type SearchQuery,
} from '@etai/db';
import { VECTOR_DIMENSIONS, type Coverage } from '@etai/shared';
import { getEnv } from '@etai/shared/env';
import { desc, eq, isNull, sql } from 'drizzle-orm';

/**
 * What the dashboard reads.
 *
 * Four independent queries rather than one, because the page shows four things and any
 * of them can fail on its own. A single query joining all of it would mean a slow count
 * on one table takes the whole page down, and the design shows each panel failing
 * separately for exactly that reason.
 *
 * Nothing here writes. The dashboard reports on the system rather than driving it, which
 * is why there is no route behind the "Run ingestion" button the design draws. Ingestion
 * is a command that takes a minute and a half on a cold corpus, and putting it behind a
 * web request means either holding the request open for that long or building a job
 * runner to avoid it. Neither is needed for a dashboard that reports, so the empty
 * state names the command instead.
 */

export interface IndexHealth {
  documentsIndexed: number;
  /** How many files the last run saw. Null before any run, and not a live look at disk. */
  filesInLastRun: number | null;
  chunks: number;
  embedded: number;
  embeddingModel: string;
  vectorDimensions: number;
  /** Read from the catalogue rather than assumed, since a missing index changes nothing visible. */
  vectorIndex: string | null;
  keywordIndex: string | null;
  lastSynchronised: Date | null;
}

/**
 * Reads the two indexes out of the catalogue.
 *
 * Worth doing rather than printing what the schema says should be there. A vector index
 * that failed to build raises nothing at query time: results stay correct and every
 * search quietly scans the whole table. The dashboard is the only place that difference
 * becomes visible before it becomes a performance problem.
 */
async function describeIndexes(): Promise<{ vector: string | null; keyword: string | null }> {
  const db = getDb();

  const rows = await db.execute<{ indexdef: string }>(
    sql`SELECT indexdef FROM pg_indexes WHERE tablename = 'chunk'`,
  );

  let vector: string | null = null;
  let keyword: string | null = null;

  for (const row of rows.rows) {
    const definition = row.indexdef.toLowerCase();

    if (definition.includes('using hnsw')) {
      vector = definition.includes('vector_cosine_ops')
        ? 'HNSW, vector_cosine_ops'
        : 'HNSW, wrong operator class';
    }

    if (definition.includes('using gin')) keyword = 'GIN, generated tsvector';
  }

  return { vector, keyword };
}

export async function indexHealth(): Promise<IndexHealth> {
  const db = getDb();
  const env = getEnv();

  const [counts] = await db
    .select({
      documents: sql<number>`count(distinct ${document.id})::int`,
      chunks: sql<number>`count(${chunk.id})::int`,
      embedded: sql<number>`count(${chunk.embedding})::int`,
    })
    .from(document)
    .leftJoin(chunk, eq(chunk.documentId, document.id))
    .where(isNull(document.deletedAt));

  const [lastRun] = await db
    .select({ stats: ingestionRun.stats, finishedAt: ingestionRun.finishedAt })
    .from(ingestionRun)
    .where(eq(ingestionRun.status, 'completed'))
    .orderBy(desc(ingestionRun.startedAt))
    .limit(1);

  const indexes = await describeIndexes();
  const stats = runStats(lastRun?.stats);

  return {
    documentsIndexed: counts?.documents ?? 0,
    filesInLastRun: lastRun ? stats.created + stats.updated + stats.skipped + stats.failed : null,
    chunks: counts?.chunks ?? 0,
    embedded: counts?.embedded ?? 0,
    embeddingModel: env.EMBEDDING_MODEL,
    vectorDimensions: VECTOR_DIMENSIONS,
    vectorIndex: indexes.vector,
    keywordIndex: indexes.keyword,
    lastSynchronised: lastRun?.finishedAt ?? null,
  };
}

export interface RunCounts {
  created: number;
  updated: number;
  skipped: number;
  deleted: number;
  failed: number;
}

/**
 * Reads the counts out of the stored blob without trusting its shape.
 *
 * The column is jsonb with a default, so a row written by an older version of the writer
 * is valid json and missing keys. Reading a missing count as zero is right; letting
 * `undefined` reach a template and render as "undefined" beside four real numbers is not.
 */
function runStats(value: unknown): RunCounts {
  const stats = (value ?? {}) as Partial<Record<keyof RunCounts, unknown>>;
  const read = (key: keyof RunCounts) => (typeof stats[key] === 'number' ? stats[key] : 0);

  return {
    created: read('created'),
    updated: read('updated'),
    skipped: read('skipped'),
    deleted: read('deleted'),
    failed: read('failed'),
  };
}

export interface RunSummary {
  id: string;
  status: 'running' | 'completed' | 'partial' | 'failed';
  trigger: string;
  /** True when watch mode started this because files changed during the previous run. */
  queued: boolean;
  /** Who started it, when a person did. Null for a run from the command line. */
  triggeredBy: string | null;
  counts: RunCounts;
  startedAt: Date;
  finishedAt: Date | null;
  durationMs: number | null;
  error: string | null;
  /** The documents that failed, which is what makes a partial run readable. */
  failures: Array<{ path: string; error: string }>;
}

export async function recentRuns(limit = 5): Promise<RunSummary[]> {
  const db = getDb();

  const rows = await db
    .select({
      id: ingestionRun.id,
      status: ingestionRun.status,
      trigger: ingestionRun.trigger,
      queued: ingestionRun.queued,
      stats: ingestionRun.stats,
      startedAt: ingestionRun.startedAt,
      finishedAt: ingestionRun.finishedAt,
      error: ingestionRun.error,
      email: user.email,
    })
    .from(ingestionRun)
    .leftJoin(user, eq(user.id, ingestionRun.triggeredByUserId))
    .orderBy(desc(ingestionRun.startedAt))
    .limit(limit);

  if (rows.length === 0) return [];

  /**
   * One query for every run's failures rather than one per run.
   *
   * Five rows would be five round trips, which is not slow at this size and is the shape
   * that becomes slow silently when the limit is raised. It costs nothing to write it the
   * other way now.
   */
  const failed = await db
    .select({ runId: ingestionItem.runId, path: ingestionItem.path, error: ingestionItem.error })
    .from(ingestionItem)
    .where(eq(ingestionItem.action, 'failed'));

  const byRun = new Map<string, Array<{ path: string; error: string }>>();

  for (const item of failed) {
    const list = byRun.get(item.runId) ?? [];
    list.push({ path: item.path, error: item.error ?? 'no reason recorded' });
    byRun.set(item.runId, list);
  }

  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    trigger: row.trigger,
    queued: row.queued,
    triggeredBy: row.email,
    counts: runStats(row.stats),
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    durationMs: row.finishedAt ? row.finishedAt.getTime() - row.startedAt.getTime() : null,
    error: row.error,
    failures: byRun.get(row.id) ?? [],
  }));
}

export interface QuestionStats {
  lastSevenDays: number;
  today: number;
  /** Median rather than mean: one slow provider call otherwise moves the whole number. */
  medianLatencyMs: number | null;
  answered: number;
  declined: number;
  byCoverage: Record<Coverage, number>;
  /**
   * How many arrived through each surface.
   *
   * Here because the page used to count `/api/ask` alone while calling the result "what
   * people are asking". Showing the split is what keeps that heading true as the MCP
   * server gets used.
   */
  bySource: { web: number; mcp: number };
  /** Rows that could not be written since this process started, so the page can say so. */
  unrecorded: number;
}

export async function questionStats(unrecorded = 0): Promise<QuestionStats> {
  const db = getDb();

  const [totals] = await db
    .select({
      lastSevenDays: sql<number>`count(*) filter (where ${searchQuery.createdAt} > now() - interval '7 days')::int`,
      today: sql<number>`count(*) filter (where ${searchQuery.createdAt}::date = current_date)::int`,
      medianLatencyMs: sql<
        number | null
      >`percentile_cont(0.5) within group (order by ${searchQuery.latencyMs})`,
      full: sql<number>`count(*) filter (where ${searchQuery.coverage} = 'full')::int`,
      partial: sql<number>`count(*) filter (where ${searchQuery.coverage} = 'partial')::int`,
      notDocumented: sql<number>`count(*) filter (where ${searchQuery.coverage} = 'not_documented')::int`,
      outOfScope: sql<number>`count(*) filter (where ${searchQuery.coverage} = 'out_of_scope')::int`,
      web: sql<number>`count(*) filter (where ${searchQuery.source} = 'web')::int`,
      mcp: sql<number>`count(*) filter (where ${searchQuery.source} = 'mcp')::int`,
    })
    .from(searchQuery);

  const byCoverage: Record<Coverage, number> = {
    full: totals?.full ?? 0,
    partial: totals?.partial ?? 0,
    not_documented: totals?.notDocumented ?? 0,
    out_of_scope: totals?.outOfScope ?? 0,
  };

  return {
    lastSevenDays: totals?.lastSevenDays ?? 0,
    today: totals?.today ?? 0,
    medianLatencyMs:
      totals?.medianLatencyMs === null || totals?.medianLatencyMs === undefined
        ? null
        : Math.round(totals.medianLatencyMs),
    // The same split `isAnswered` makes everywhere else, expressed in SQL rather than
    // repeated as a judgement: full and partial carry an answer, the other two do not.
    answered: byCoverage.full + byCoverage.partial,
    declined: byCoverage.not_documented + byCoverage.out_of_scope,
    byCoverage,
    bySource: { web: totals?.web ?? 0, mcp: totals?.mcp ?? 0 },
    unrecorded,
  };
}

export type RecentQuery = Pick<
  SearchQuery,
  | 'id'
  | 'query'
  | 'coverage'
  | 'resultCount'
  | 'latencyMs'
  | 'generationModel'
  | 'createdAt'
  | 'source'
>;

export async function recentQueries(limit = 6): Promise<RecentQuery[]> {
  return getDb()
    .select({
      id: searchQuery.id,
      query: searchQuery.query,
      coverage: searchQuery.coverage,
      resultCount: searchQuery.resultCount,
      latencyMs: searchQuery.latencyMs,
      generationModel: searchQuery.generationModel,
      createdAt: searchQuery.createdAt,
      source: searchQuery.source,
    })
    .from(searchQuery)
    .orderBy(desc(searchQuery.createdAt))
    .limit(limit);
}
