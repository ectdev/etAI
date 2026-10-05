import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createScratchDatabase, type ScratchDatabase } from '@etai/db/testing';

/**
 * Ingestion and search end to end, on a database of their own.
 *
 * Every other ingestion test runs against the development index and therefore can only
 * re-read the real corpus. This one writes: a fixture corpus is indexed, its vectors are
 * made stale the two ways that happen in practice, and the pipeline is required to
 * notice and repair both. It runs keyless with the hashing provider, so it costs nothing
 * and runs in CI.
 *
 * The environment is set before anything that reads it is imported. Each test file gets
 * a fresh module graph, so the cached configuration here is this file's alone.
 */

const corpus = mkdtempSync(join(tmpdir(), 'etai-provenance-'));
let scratch: ScratchDatabase;

type Persist = typeof import('./persist.js');
type Search = typeof import('../retrieval/search.js');
type Db = typeof import('@etai/db');
type Embed = typeof import('../embedding/embed.js');
let persist: Persist;
let search: Search;
let db: Db;
let embed: Embed;

const write = (name: string, body: string) => writeFileSync(join(corpus, name), body);

async function signaturesInIndex(): Promise<Array<string | null>> {
  const { rows } = await db
    .getPool()
    .query<{ embedded_with: string | null }>(
      'SELECT DISTINCT embedded_with FROM chunk WHERE embedding IS NOT NULL ORDER BY 1',
    );
  return rows.map((row) => row.embedded_with);
}

beforeAll(async () => {
  loadDotenv({ path: join(process.cwd(), '.env'), quiet: true });
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error('DATABASE_URL is needed to create a scratch database');

  scratch = await createScratchDatabase(base);
  process.env.DATABASE_URL = scratch.url;
  process.env.EMBEDDING_PROVIDER = 'hashing';

  write(
    'artifact-limits.md',
    '# Artifact limits\n\nThe maximum artifact size is 5 GB per job on AWS.',
  );
  write(
    'cache-retention.md',
    '# Cache retention\n\nCache entries are kept for 14 days since the last read.',
  );
  write('on-call.md', '# On call\n\nOne person covers one week, Monday to Monday.');

  db = await import('@etai/db');
  persist = await import('./persist.js');
  search = await import('../retrieval/search.js');
  embed = await import('../embedding/embed.js');
}, 60_000);

afterAll(async () => {
  await db?.closeDb();
  await scratch?.drop();
  rmSync(corpus, { recursive: true, force: true });
});

describe('a fresh index', () => {
  it('migrated from empty, which is the test that the migrations work on their own', async () => {
    const { rows } = await db
      .getPool()
      .query<{ extversion: string }>(
        "SELECT extversion FROM pg_extension WHERE extname = 'vector'",
      );
    expect(rows).toHaveLength(1);
  });

  it('records the signature each vector was made with', async () => {
    const run = await persist.ingestCorpus({ corpusPath: corpus, trigger: 'seed' });

    expect(run.status).toBe('completed');
    expect(run.created).toBe(3);
    expect(await signaturesInIndex()).toEqual([embed.embeddingSignature()]);
    expect(embed.embeddingSignature()).toMatch(/^hashing:/);

    const stats = await persist.indexStats();
    expect(stats.searchable).toBe(stats.chunks);
  });

  it('skips everything on a rerun and embeds nothing', async () => {
    const run = await persist.ingestCorpus({ corpusPath: corpus, trigger: 'seed' });

    expect(run.skipped).toBe(3);
    expect(run.chunksEmbedded).toBe(0);
  });

  it('finds a document by its words through the vector half, not only the keyword half', async () => {
    const result = await search.searchChunks('maximum artifact size on AWS');

    expect(result.degraded).toBe(false);
    expect(result.chunks[0]?.path).toBe('artifact-limits.md');
    expect(result.chunks.some((chunk) => chunk.distance !== null)).toBe(true);
  });
});

describe('an index built by a different model', () => {
  it('is searched by keyword only and says so, instead of comparing across vector spaces', async () => {
    // What the index looks like after EMBEDDING_MODEL changes: every vector was made by
    // something other than what the configuration would use for a question now.
    await db
      .getPool()
      .query(`UPDATE chunk SET embedded_with = 'google:an-older-model:1536:text-v1'`);

    const stats = await persist.indexStats();
    expect(stats.searchable).toBe(0);
    expect(stats.embedded).toBe(stats.chunks);

    const result = await search.searchChunks('maximum artifact size on AWS');
    expect(result.degraded).toBe(true);
    expect(result.chunks.every((chunk) => chunk.distance === null)).toBe(true);
    // Keyword search still answers, which is the point of degrading rather than failing.
    expect(result.chunks.map((chunk) => chunk.path)).toContain('artifact-limits.md');
  });

  it('is re-embedded by the next ordinary run, with no flag', async () => {
    const run = await persist.ingestCorpus({ corpusPath: corpus, trigger: 'seed' });

    // The bug this replaces: content hashes matched, so this run used to report three
    // skipped documents and leave every stale vector where it was.
    expect(run.updated).toBe(3);
    expect(run.chunksEmbedded).toBeGreaterThanOrEqual(3);
    expect(await signaturesInIndex()).toEqual([embed.embeddingSignature()]);

    const result = await search.searchChunks('maximum artifact size on AWS');
    expect(result.degraded).toBe(false);
  });
});

describe('vectors whose provenance is unknown', () => {
  it('are re-embedded, and only those', async () => {
    // Rows written before the signature column existed carry null.
    await db.getPool().query(
      `UPDATE chunk SET embedded_with = NULL
        WHERE document_id = (SELECT id FROM document WHERE path = 'on-call.md')`,
    );

    const run = await persist.ingestCorpus({ corpusPath: corpus, trigger: 'seed' });

    expect(run.updated).toBe(1);
    expect(run.skipped).toBe(2);
    expect(await signaturesInIndex()).toEqual([embed.embeddingSignature()]);
  });
});

describe('--force', () => {
  it('re-embeds unchanged documents, which is the one case it exists for', async () => {
    // It used to return before doing anything when the text was unchanged, so the flag
    // documented as "for when the model or its settings changed" re-embedded nothing.
    const { rows: before } = await db
      .getPool()
      .query<{ embedded_at: Date }>('SELECT embedded_at FROM chunk ORDER BY id');

    const run = await persist.ingestCorpus({ corpusPath: corpus, trigger: 'seed', force: true });

    expect(run.updated).toBe(3);
    expect(run.chunksEmbedded).toBeGreaterThanOrEqual(3);

    const { rows: after } = await db
      .getPool()
      .query<{ embedded_at: Date }>('SELECT embedded_at FROM chunk ORDER BY id');
    expect(
      after.every((row, index) => row.embedded_at > (before[index]?.embedded_at ?? new Date(0))),
    ).toBe(true);
  });
});

describe('ordinary edits around the new rules', () => {
  it('re-embeds an edited document and keeps the vectors of the others', async () => {
    write(
      'cache-retention.md',
      '# Cache retention\n\nCache entries are kept for 30 days since the last read.',
    );

    const run = await persist.ingestCorpus({ corpusPath: corpus, trigger: 'seed' });

    expect(run.updated).toBe(1);
    expect(run.skipped).toBe(2);
  });

  it('removes a deleted file from search entirely', async () => {
    unlinkSync(join(corpus, 'on-call.md'));

    const run = await persist.ingestCorpus({ corpusPath: corpus, trigger: 'seed' });
    expect(run.deleted).toBe(1);

    const result = await search.searchChunks('one person covers one week on call');
    expect(result.chunks.map((chunk) => chunk.path)).not.toContain('on-call.md');
  });

  it('indexes an empty file and a whitespace-only file without failing the run', async () => {
    write('empty.md', '');
    write('blank.md', '   \n\n\t\n');

    const run = await persist.ingestCorpus({ corpusPath: corpus, trigger: 'seed' });

    expect(run.status).toBe('completed');
    expect(run.failed).toBe(0);
  });

  it('stays searchable with questions no document could match', async () => {
    for (const question of ['zzzz qqqq', '日本語', 'a'.repeat(400), '42']) {
      await expect(search.searchChunks(question)).resolves.toBeDefined();
    }
  });
});
