import { getPool } from '@etai/db';
import { embeddingSignature } from './embedding/embed.js';

/**
 * Whether this instance can serve questions, for a load balancer or an uptime check.
 *
 * Two checks, run side by side, each with its own deadline: can the database be reached,
 * and is the index there and searchable with the embeddings this instance is configured
 * for. Neither calls a model, so a health probe every few seconds costs nothing and
 * cannot exhaust a quota. The answer is states, not numbers or paths, because the
 * endpoint is public.
 *
 * `degraded` means the instance answers but worse: an empty index refuses everything, and
 * a stale one searches by keyword until `pnpm ingest --write` re-embeds it. `down` means
 * it cannot answer at all.
 */
export interface Health {
  status: 'ok' | 'degraded' | 'down';
  database: 'up' | 'down';
  index: 'ready' | 'empty' | 'stale' | 'unknown';
  checkedInMs: number;
}

export const HEALTH_CHECK_TIMEOUT_MS = 2_000;

type Pool = ReturnType<typeof getPool>;

export async function checkHealth(
  options: { pool?: Pool; timeoutMs?: number } = {},
): Promise<Health> {
  const started = Date.now();
  const pool = options.pool ?? getPool();
  const timeoutMs = options.timeoutMs ?? HEALTH_CHECK_TIMEOUT_MS;
  const signature = embeddingSignature();

  const [database, index] = await Promise.allSettled([
    within(timeoutMs, pool.query('SELECT 1')),
    within(
      timeoutMs,
      pool.query<{ chunks: number; searchable: number }>(
        `SELECT count(*)::int AS chunks,
                count(*) FILTER (WHERE embedding IS NOT NULL AND embedded_with = $1)::int AS searchable
           FROM chunk`,
        [signature],
      ),
    ),
  ]);

  const databaseUp = database.status === 'fulfilled';
  let indexState: Health['index'] = 'unknown';
  if (index.status === 'fulfilled') {
    const row = index.value.rows[0];
    indexState =
      !row || row.chunks === 0 ? 'empty' : row.searchable < row.chunks ? 'stale' : 'ready';
  }

  return {
    status: !databaseUp ? 'down' : indexState === 'ready' ? 'ok' : 'degraded',
    database: databaseUp ? 'up' : 'down',
    index: indexState,
    checkedInMs: Date.now() - started,
  };
}

/** Rejects once the deadline passes. The query itself is bounded by the pool's own limit. */
function within<T>(ms: number, work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer within ${ms} ms`)), ms);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}
