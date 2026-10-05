import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createScratchDatabase, type ScratchDatabase } from '@etai/db/testing';

/**
 * The same collection gives the same results, however and wherever it was indexed.
 *
 * It did not. Fusion and ranking broke ties on the chunk id, which is a random UUID, and
 * in rank fusion ties are routine, so two installs of one corpus put different documents
 * first for a third of the questions. Re-indexing the same database did the same.
 *
 * So the corpus is indexed, measured, wiped and indexed again in a different order, which
 * gives every chunk a new id and a new place on disk, and every question has to come back
 * with the same five documents in the same order. Keyless, on a database of its own.
 */

const CORPUS = fileURLToPath(new URL('../../../../corpus', import.meta.url));

let scratch: ScratchDatabase;
let db: typeof import('@etai/db');
let persist: typeof import('../ingestion/persist.js');
let measure: typeof import('./measure.js');
let queries: typeof import('./queries.js');

function files(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? files(path) : name.endsWith('.md') ? [path] : [];
  });
}

async function topFive(): Promise<Array<[string, string[]]>> {
  const results = await measure.measureQueries(measure.hybridRetriever, queries.evalQueries);
  return results.map((result) => [result.question, result.top.slice(0, 5)]);
}

beforeAll(async () => {
  loadDotenv({ path: join(process.cwd(), '.env'), quiet: true });
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error('DATABASE_URL is needed to create a scratch database');

  scratch = await createScratchDatabase(base);
  process.env.DATABASE_URL = scratch.url;
  process.env.EMBEDDING_PROVIDER = 'hashing';

  db = await import('@etai/db');
  persist = await import('../ingestion/persist.js');
  measure = await import('./measure.js');
  queries = await import('./queries.js');
}, 60_000);

afterAll(async () => {
  await db?.closeDb();
  await scratch?.drop();
});

describe('retrieval across two indexes of one corpus', () => {
  it('returns the same five documents, in the same order, for every question', async () => {
    await persist.ingestCorpus({ corpusPath: CORPUS });
    const first = await topFive();

    // Wiped, then rebuilt starting from the second half of the files in reverse, so the
    // rows are inserted in a different order and every chunk gets a new random id.
    await db.getPool().query('TRUNCATE chunk, document, ingestion_item, ingestion_run CASCADE');
    const half = mkdtempSync(join(tmpdir(), 'etai-determinism-'));
    try {
      const all = files(CORPUS).sort().reverse();
      for (const file of all.slice(0, Math.ceil(all.length / 2))) {
        const target = join(half, relative(CORPUS, file));
        mkdirSync(dirname(target), { recursive: true });
        cpSync(file, target);
      }
      await persist.ingestCorpus({ corpusPath: half });
      await persist.ingestCorpus({ corpusPath: CORPUS });
    } finally {
      rmSync(half, { recursive: true, force: true });
    }

    const { rows } = await db
      .getPool()
      .query<{ count: number }>(
        'SELECT count(*)::int AS count FROM document WHERE deleted_at IS NULL',
      );
    expect(rows[0]?.count).toBe(files(CORPUS).length);

    const second = await topFive();
    const moved = second.filter(([, top], index) => top.join() !== first[index]![1].join());

    expect(
      moved.map(([question]) => question),
      'these questions came back differently from an identical corpus',
    ).toEqual([]);
  }, 180_000);
});
