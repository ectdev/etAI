import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createScratchDatabase, type ScratchDatabase } from '@etai/db/testing';

/**
 * The health check against each state it reports, on a database of its own.
 */

const corpus = mkdtempSync(join(tmpdir(), 'etai-health-'));
let scratch: ScratchDatabase;
let db: typeof import('@etai/db');
let health: typeof import('./health.js');
let persist: typeof import('./ingestion/persist.js');

beforeAll(async () => {
  loadDotenv({ path: join(process.cwd(), '.env'), quiet: true });
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error('DATABASE_URL is needed to create a scratch database');

  scratch = await createScratchDatabase(base);
  process.env.DATABASE_URL = scratch.url;
  process.env.EMBEDDING_PROVIDER = 'hashing';

  writeFileSync(join(corpus, 'limits.md'), '# Limits\n\nArtifacts are capped at 5 GB per job.');
  writeFileSync(join(corpus, 'retention.md'), '# Retention\n\nCaches are kept for 14 days.');

  db = await import('@etai/db');
  health = await import('./health.js');
  persist = await import('./ingestion/persist.js');
}, 60_000);

afterAll(async () => {
  await db?.closeDb();
  await scratch?.drop();
  rmSync(corpus, { recursive: true, force: true });
});

describe('checkHealth', () => {
  it('reports an instance with nothing indexed as up but degraded', async () => {
    expect(await health.checkHealth()).toMatchObject({
      status: 'degraded',
      database: 'up',
      index: 'empty',
    });
  });

  it('reports ok once the index is there and searchable', async () => {
    await persist.ingestCorpus({ corpusPath: corpus });

    expect(await health.checkHealth()).toMatchObject({
      status: 'ok',
      database: 'up',
      index: 'ready',
    });
  });

  it('reports a stale index when some vectors were made by another model', async () => {
    await db.getPool().query(
      `UPDATE chunk SET embedded_with = 'google:another-model:1536:text-v1'
        WHERE id = (SELECT id FROM chunk ORDER BY id LIMIT 1)`,
    );

    expect(await health.checkHealth()).toMatchObject({ status: 'degraded', index: 'stale' });

    await persist.ingestCorpus({ corpusPath: corpus });
    expect((await health.checkHealth()).index).toBe('ready');
  });

  it('reports down, quickly, when the database cannot be reached', async () => {
    const unreachable = new pg.Pool({
      connectionString: 'postgresql://nobody:nothing@127.0.0.1:1/none',
      connectionTimeoutMillis: 300,
    });
    try {
      const result = await health.checkHealth({ pool: unreachable, timeoutMs: 1_000 });

      expect(result).toMatchObject({ status: 'down', database: 'down', index: 'unknown' });
      expect(result.checkedInMs).toBeLessThan(1_500);
    } finally {
      await unreachable.end();
    }
  });

  it('gives up on a database that never answers, both checks at once', async () => {
    const silent = { query: () => new Promise(() => {}) } as unknown as pg.Pool;

    const result = await health.checkHealth({ pool: silent, timeoutMs: 150 });

    expect(result.status).toBe('down');
    // Both checks waited out their deadline side by side; in turn it would take twice as long.
    expect(result.checkedInMs).toBeGreaterThanOrEqual(140);
    expect(result.checkedInMs).toBeLessThan(290);
  });
});
