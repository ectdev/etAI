import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chunk, closeDb, document, getDb } from '@etai/db';
import { eq, sql } from 'drizzle-orm';
import { documentTypes, listDocuments } from './documents.js';

/**
 * The corpus view, checked against what search can actually reach.
 *
 * The list is the answer to "what is indexed", and the way it fails is by saying yes about
 * something that is not. Two of those cannot be produced by the corpus as it stands, and
 * both have fixtures here rather than being left to whatever the database happens to hold.
 * The dashboard tests in this directory already passed once against zeroes, which is how
 * that lesson was learned.
 *
 * Needs the database and the corpus indexed, and no provider: pnpm ingest --write
 */

const FIXTURE = 'documents-test-fixture';

let deletedId: string;
let unembeddedId: string;
let splitId: string;

beforeAll(async () => {
  const db = getDb();

  const [removed] = await db
    .insert(document)
    .values({
      path: `${FIXTURE}/removed-from-disk.md`,
      title: 'Removed from disk',
      content: 'gone',
      contentHash: `${FIXTURE}-1`,
      docType: 'reference',
      // Soft deleted, which is what ingestion does to a document that left the corpus.
      deletedAt: new Date(),
    })
    .returning({ id: document.id });

  const [pending] = await db
    .insert(document)
    .values({
      path: `${FIXTURE}/never-embedded.md`,
      title: 'Never embedded',
      content: 'present but unsearchable',
      contentHash: `${FIXTURE}-2`,
      docType: 'reference',
    })
    .returning({ id: document.id });

  /**
   * A document split into two chunks, which this corpus never produces.
   *
   * Every document here fits one embedding, so a query that returns one row per chunk
   * looks identical to one that returns a row per document. Without this fixture the
   * grouping is untestable, and the first version of the test below passed against a
   * query grouped by chunk.
   */
  const [split] = await db
    .insert(document)
    .values({
      path: `${FIXTURE}/split-into-two.md`,
      title: 'Long enough to split',
      content: 'first half. second half.',
      contentHash: `${FIXTURE}-3`,
      docType: 'guide',
    })
    .returning({ id: document.id });

  if (!removed || !pending || !split) throw new Error('could not write the fixture documents');

  deletedId = removed.id;
  unembeddedId = pending.id;
  splitId = split.id;

  await db.insert(chunk).values([
    // A chunk with no embedding: the row exists, and vector search cannot see it.
    {
      documentId: pending.id,
      position: 0,
      content: 'present but unsearchable',
      contentHash: `${FIXTURE}-2-chunk`,
      tokenCount: 3,
    },
    {
      documentId: split.id,
      position: 0,
      content: 'first half.',
      contentHash: `${FIXTURE}-3-chunk-0`,
      tokenCount: 2,
    },
    {
      documentId: split.id,
      position: 1,
      content: 'second half.',
      contentHash: `${FIXTURE}-3-chunk-1`,
      tokenCount: 2,
    },
  ]);
});

afterAll(async () => {
  const db = getDb();

  for (const id of [unembeddedId, splitId]) {
    await db.delete(chunk).where(eq(chunk.documentId, id));
  }
  await db.delete(document).where(sql`${document.path} like ${`${FIXTURE}%`}`);

  await closeDb();
});

describe('listing what is indexed', () => {
  it('leaves out a document that was removed from the corpus', async () => {
    /**
     * A soft deleted document is gone from search, so listing it would show a corpus that
     * does not match what a question can reach. The row is still in the table, which is
     * the whole reason this can go wrong: nothing about selecting it would look odd.
     */
    const rows = await listDocuments();

    expect(rows.some((row) => row.id === deletedId)).toBe(false);
    expect(rows.some((row) => row.path.includes('removed-from-disk'))).toBe(false);
  });

  it('marks a document with no embedding as unsearchable rather than as indexed', async () => {
    /**
     * The failure this column exists for. The document is in the database, the corpus
     * count includes it, and vector search will never return it. Nothing else in the
     * system reports that: it simply never comes back.
     */
    const rows = await listDocuments();
    const pending = rows.find((row) => row.id === unembeddedId);

    expect(pending, 'the fixture document was not listed at all').toBeDefined();
    expect(pending?.chunks).toBe(1);
    expect(pending?.embeddedChunks).toBe(0);
    expect(pending?.status).toBe('not_embedded');
  });

  it('counts one row per document however many chunks it has', async () => {
    /**
     * A join to chunks grouped by chunk gives one row per chunk, which multiplies a
     * document into as many rows as it was split into.
     *
     * This cannot be seen on the shipped corpus: every document fits one embedding, so
     * per-chunk and per-document return the same 142 rows. The first version of this test
     * passed against a query grouped by chunk for exactly that reason. The fixture is a
     * document split in two, which is what the pipeline produces on a corpus large enough
     * to need splitting.
     */
    const rows = await listDocuments();
    const split = rows.filter((row) => row.id === splitId);

    expect(split).toHaveLength(1);
    expect(split[0]?.chunks).toBe(2);

    const paths = rows.map((row) => row.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('resolves a superseded document to the path of what replaced it', async () => {
    const rows = await listDocuments();
    const replaced = rows.filter((row) => row.supersededByPath !== null);

    // The premise: this collection has a chain of five changelogs, and without one the
    // assertion below is empty and passes for the wrong reason.
    expect(replaced.length).toBeGreaterThan(0);

    const byPath = new Set(rows.map((row) => row.path));
    for (const row of replaced) {
      expect(
        byPath.has(row.supersededByPath ?? ''),
        `${row.path} points at a missing document`,
      ).toBe(true);
    }
  });

  it('offers the types the corpus contains rather than a list typed by hand', async () => {
    const types = documentTypes(await listDocuments());

    expect(types).toContain('reference');
    expect(types).toContain('deployment_report');
    expect(types).toEqual([...types].sort());
  });
});
