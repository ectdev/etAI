import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createScratchDatabase, type ScratchDatabase } from '@etai/db/testing';

/**
 * A run that does not finish must not leave anything a later run trusts.
 *
 * Found by a run killed part way through re-indexing a moved corpus. Two documents were
 * left with a row and no chunks, every later run skipped them because their text had not
 * changed, and search could not find them. The same order of writes had a worse case
 * nobody had hit yet: an edited document killed while embedding kept its new content hash
 * beside its old chunks, and answered with the old text from then on.
 *
 * Its own database and the hashing embeddings, so it costs nothing. The embedding call is
 * made to fail for one marked document, which is the moment a provider outage or a killed
 * process interrupts a real run.
 */

const control = vi.hoisted(() => ({ poison: null as string | null }));

vi.mock('../embedding/embed.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../embedding/embed.js')>();
  return {
    ...actual,
    embedDocuments: async (texts: string[]) => {
      const marker = control.poison;
      if (marker && texts.some((text) => text.includes(marker))) {
        throw new Error('the embedding provider went away');
      }
      return actual.embedDocuments(texts);
    },
  };
});

const corpus = mkdtempSync(join(tmpdir(), 'etai-interrupted-'));
let scratch: ScratchDatabase;
let db: typeof import('@etai/db');
let persist: typeof import('./persist.js');

const write = (name: string, body: string) => writeFileSync(join(corpus, name), body);
const run = () => persist.ingestCorpus({ corpusPath: corpus });

async function stored(path: string) {
  const { rows } = await db.getPool().query<{ content: string; chunks: number }>(
    `SELECT d.content, count(c.id)::int AS chunks
       FROM document d LEFT JOIN chunk c ON c.document_id = d.id
      WHERE d.path = $1 AND d.deleted_at IS NULL
      GROUP BY d.id`,
    [path],
  );
  return rows[0] ?? null;
}

beforeAll(async () => {
  loadDotenv({ path: join(process.cwd(), '.env'), quiet: true });
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error('DATABASE_URL is needed to create a scratch database');

  scratch = await createScratchDatabase(base);
  process.env.DATABASE_URL = scratch.url;
  process.env.EMBEDDING_PROVIDER = 'hashing';

  write('limits.md', '# Limits\n\nThe maximum artifact size is 5 GB per job.');
  write('retention.md', '# Retention\n\nCache entries are kept for 14 days since the last read.');

  db = await import('@etai/db');
  persist = await import('./persist.js');

  const first = await run();
  expect(first.created).toBe(2);
}, 60_000);

afterAll(async () => {
  control.poison = null;
  await db?.closeDb();
  await scratch?.drop();
  rmSync(corpus, { recursive: true, force: true });
});

describe('a new document whose embedding fails', () => {
  it('is not written at all, so the next run sees it as new', async () => {
    write('on-call.md', '# On call\n\nOne person covers one week. POISON-NEW');
    control.poison = 'POISON-NEW';

    const failed = await run();

    expect(failed.failed).toBe(1);
    expect(failed.status).toBe('partial');
    // The old order left a row here with no chunks, which every later run skipped.
    expect(await stored('on-call.md')).toBeNull();

    control.poison = null;
    const retried = await run();

    expect(retried.created).toBe(1);
    expect((await stored('on-call.md'))?.chunks).toBeGreaterThan(0);
  });
});

describe('an edited document whose embedding fails', () => {
  it('keeps its old text and old chunks together, and is updated by the next run', async () => {
    write('limits.md', '# Limits\n\nThe maximum artifact size is 8 GB per job. POISON-EDIT');
    control.poison = 'POISON-EDIT';

    const failed = await run();

    expect(failed.failed).toBe(1);
    const kept = await stored('limits.md');
    // The old order stored the new hash with the old chunks and skipped it forever after.
    expect(kept?.content).toContain('5 GB');
    expect(kept?.chunks).toBeGreaterThan(0);

    control.poison = null;
    const retried = await run();

    expect(retried.updated).toBe(1);
    expect((await stored('limits.md'))?.content).toContain('8 GB');

    const { rows } = await db
      .getPool()
      .query<{ content: string }>(
        `SELECT c.content FROM chunk c JOIN document d ON d.id = c.document_id WHERE d.path = 'limits.md'`,
      );
    expect(rows.map((row) => row.content).join(' ')).toContain('8 GB');
  });
});

describe('a document an older run left without chunks', () => {
  it('is rebuilt rather than skipped', async () => {
    await db
      .getPool()
      .query(
        `DELETE FROM chunk WHERE document_id = (SELECT id FROM document WHERE path = 'retention.md')`,
      );
    expect((await stored('retention.md'))?.chunks).toBe(0);

    const repaired = await run();

    expect(repaired.updated).toBe(1);
    expect(repaired.failed).toBe(0);
    expect((await stored('retention.md'))?.chunks).toBeGreaterThan(0);

    const settled = await run();
    expect(settled.updated).toBe(0);
    expect(settled.skipped).toBe(3);
  });
});

describe('a run whose process died', () => {
  it('is closed by the next run once it is plainly stale, and a recent one is left alone', async () => {
    const insert = (minutesAgo: number) =>
      db.getPool().query<{ id: string }>(
        `INSERT INTO ingestion_run (status, trigger, corpus_path, started_at)
         VALUES ('running', 'cli', $1, now() - make_interval(mins => $2)) RETURNING id`,
        [corpus, minutesAgo],
      );
    const stale = (await insert(persist.STALE_RUN_MINUTES + 45)).rows[0]!.id;
    const recent = (await insert(1)).rows[0]!.id;

    await run();

    const { rows } = await db
      .getPool()
      .query<{ id: string; status: string; error: string | null; finished: boolean }>(
        `SELECT id, status, error, finished_at IS NOT NULL AS finished FROM ingestion_run WHERE id = ANY($1)`,
        [[stale, recent]],
      );
    const byId = new Map(rows.map((row) => [row.id, row]));

    expect(byId.get(stale)).toMatchObject({
      status: 'failed',
      error: persist.INTERRUPTED_RUN_ERROR,
      finished: true,
    });
    expect(byId.get(recent)).toMatchObject({ status: 'running', finished: false });
  });
});
