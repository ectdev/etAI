import { afterAll, describe, expect, it } from 'vitest';
import { closeDb, getPool } from '@etai/db';
import { getEnv } from '@etai/shared/env';
import { eq } from 'drizzle-orm';
import { getDb, ingestionItem, ingestionRun } from '@etai/db';
import { indexStats, ingestCorpus } from './persist.js';

/**
 * Checks the state ingestion left in the database.
 *
 * Most of these read what is there rather than running ingestion again, because a first
 * run makes 131 embedding calls and takes over a minute.
 *
 * The two about run records do run it, and that is a correction. They used to read
 * whichever run happened to be most recent, which passed for weeks because that row was
 * always a clean rerun, and broke the moment a manual walk ingested a different directory.
 * A test that asserts "the second run skips everything" has to perform a second run. It
 * costs nothing to do so: with every hash unchanged the rerun makes no embedding calls
 * and takes about two hundred milliseconds, which is the property being asserted.
 *
 * Requires the corpus to have been indexed: pnpm ingest --write
 */
const pool = getPool();

afterAll(async () => {
  await closeDb();
});

describe('the indexed corpus', () => {
  it('holds every document with a chunk and a vector', async () => {
    const stats = await indexStats();

    expect(stats.documents).toBe(131);
    expect(stats.chunks).toBe(131);
    expect(stats.embedded).toBe(131);
  });

  it('stored vectors that are unit length, so cosine distance needs no extra step', async () => {
    // Measured rather than trusted. The model is documented as returning normalised
    // vectors at this width, and the ranking depends on it being true.
    const { rows } = await pool.query<{ min: string; max: string }>(
      `SELECT min(len)::text AS min, max(len)::text AS max
         FROM (
           SELECT sqrt((SELECT sum(v * v) FROM unnest(embedding::real[]) AS v)) AS len
             FROM chunk WHERE embedding IS NOT NULL
         ) lengths`,
    );

    expect(Number(rows[0]?.min)).toBeCloseTo(1, 4);
    expect(Number(rows[0]?.max)).toBeCloseTo(1, 4);
  });

  it('linked each release note to the one that followed it', async () => {
    const { rows } = await pool.query<{ older: string; newer: string }>(
      `SELECT older.path AS older, newer.path AS newer
         FROM document older JOIN document newer ON newer.id = older.superseded_by_id
        ORDER BY older.path`,
    );

    /**
     * Ordered by path, which is why the last pair reads 5.9 to 5.10 rather than the other
     * way round. String order would have put 5.10 before 5.2 and broken the chain in the
     * middle; the numeric comparison in supersede.ts is what makes this list contiguous.
     */
    expect(rows).toEqual([
      { older: 'changelogs/halcyon-runner-5.0.md', newer: 'changelogs/halcyon-runner-5.1.md' },
      { older: 'changelogs/halcyon-runner-5.1.md', newer: 'changelogs/halcyon-runner-5.2.md' },
      { older: 'changelogs/halcyon-runner-5.2.md', newer: 'changelogs/halcyon-runner-5.3.md' },
      { older: 'changelogs/halcyon-runner-5.3.md', newer: 'changelogs/halcyon-runner-5.4.md' },
      { older: 'changelogs/halcyon-runner-5.4.md', newer: 'changelogs/halcyon-runner-5.5.md' },
      { older: 'changelogs/halcyon-runner-5.5.md', newer: 'changelogs/halcyon-runner-5.6.md' },
      { older: 'changelogs/halcyon-runner-5.6.md', newer: 'changelogs/halcyon-runner-5.7.md' },
      { older: 'changelogs/halcyon-runner-5.7.md', newer: 'changelogs/halcyon-runner-5.8.md' },
      { older: 'changelogs/halcyon-runner-5.8.md', newer: 'changelogs/halcyon-runner-5.9.md' },
      { older: 'changelogs/halcyon-runner-5.9.md', newer: 'changelogs/halcyon-runner-5.10.md' },
    ]);
  });

  it('marked the retired agent guide and nothing else', async () => {
    const { rows } = await pool.query<{ path: string }>(
      'SELECT path FROM document WHERE is_deprecated AND deleted_at IS NULL',
    );

    expect(rows.map((row) => row.path)).toEqual(['drift-agent-v2.md']);
  });

  it('kept the precision of each date rather than inventing a day', async () => {
    const { rows } = await pool.query<{ precision: string | null; count: string }>(
      `SELECT temporal_precision AS precision, count(*)::text AS count
         FROM document WHERE deleted_at IS NULL GROUP BY temporal_precision`,
    );

    const counts = new Map(rows.map((row) => [row.precision ?? 'none', Number(row.count)]));

    expect(counts.get('day')).toBe(40);
    expect(counts.get('month')).toBe(62);
    expect(counts.get('none')).toBe(29);
  });

  it('records an outcome for every file, and skips them all on a rerun', async () => {
    /**
     * Runs it rather than reading whichever run was last. The rerun is the thing being
     * asserted: every hash matches, so nothing is embedded, nothing is paid for, and the
     * run still writes a row per file so the dashboard can show what it looked at.
     *
     * If this ever reports something created or updated, the corpus on disk has drifted
     * from the index, which is worth failing over rather than skipping past.
     */
    const summary = await ingestCorpus({ corpusPath: getEnv().CORPUS_PATH, trigger: 'seed' });

    try {
      expect(summary.status).toBe('completed');
      expect(summary.skipped).toBe(131);
      expect(summary.created).toBe(0);
      expect(summary.updated).toBe(0);
      expect(summary.failed).toBe(0);

      const { rows } = await pool.query<{ items: string }>(
        'SELECT count(*)::text AS items FROM ingestion_item WHERE run_id = $1',
        [summary.runId],
      );

      expect(Number(rows[0]?.items)).toBe(131);
    } finally {
      // The run this test made is not part of the history anybody should read.
      const db = getDb();
      await db.delete(ingestionItem).where(eq(ingestionItem.runId, summary.runId));
      await db.delete(ingestionRun).where(eq(ingestionRun.id, summary.runId));
    }
  }, 60_000);
});

describe('the invariant search depends on', () => {
  /**
   * A document that leaves the corpus keeps its row and loses its chunks.
   *
   * The row stays so the ingestion history that mentions it still reads. The chunks go
   * because leaving them would let a deleted file keep answering questions.
   *
   * Search relies on the second half of that. Its vector query looks at `chunk` alone,
   * with no join to `document`, which is what lets the planner use the vector index at
   * all. If a soft delete ever started leaving chunks behind, that query would begin
   * serving documents that are no longer in the corpus and nothing else would notice.
   * The rule is enforced in one function, so it is checked here rather than defended
   * again in every query that would otherwise have to.
   */
  it('leaves no chunk belonging to a document that was removed from disk', async () => {
    const { rows } = await pool.query<{ orphans: string }>(
      `SELECT count(*)::text AS orphans
         FROM chunk c JOIN document d ON d.id = c.document_id
        WHERE d.deleted_at IS NOT NULL`,
    );

    expect(Number(rows[0]?.orphans)).toBe(0);
  });

  it('has a vector for every chunk, so search never has to filter for one', async () => {
    // The other half of the same argument. A chunk with no embedding would be invisible
    // to an index scan but visible to a sequential one, which is the kind of difference
    // that shows up as results changing when the table grows.
    const { rows } = await pool.query<{ missing: string }>(
      `SELECT count(*)::text AS missing FROM chunk WHERE embedding IS NULL`,
    );

    expect(Number(rows[0]?.missing)).toBe(0);
  });
});

describe('searching what was stored', () => {
  it('ranks the right document first for a question the collection answers', async () => {
    // Vector similarity on its own, with no ranking yet. This is the baseline that the
    // work in the next phase has to improve on rather than accidentally undo.
    const { rows } = await pool.query<{ path: string }>(
      `SELECT d.path
         FROM chunk c JOIN document d ON d.id = c.document_id
        WHERE d.deleted_at IS NULL AND c.embedding IS NOT NULL
          AND c.search_vector @@ websearch_to_tsquery('english', 'runner specification aws')
        ORDER BY ts_rank(c.search_vector, websearch_to_tsquery('english', 'runner specification aws')) DESC
        LIMIT 3`,
    );

    expect(rows[0]?.path).toBe('runner-specs-aws.md');
  });
});
