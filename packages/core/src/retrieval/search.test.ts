import { afterAll, describe, expect, it } from 'vitest';
import { closeDb, getPool } from '@etai/db';
import { searchChunks, VECTOR_SEARCH_BY_TYPE_SQL, VECTOR_SEARCH_SQL } from './search.js';

/**
 * Searches the indexed collection for real.
 *
 * These make embedding calls, one per question, which is why there are few of them and
 * why each covers a behaviour rather than a case. The wider measurement lives in
 * `pnpm eval`, where 79 questions are worth the minute they take.
 *
 * Requires the corpus to have been indexed: pnpm ingest --write
 */
afterAll(async () => {
  await closeDb();
});

describe('searchChunks', () => {
  it('finds the document that answers a plain question', async () => {
    const result = await searchChunks('What is the maximum artifact size on AWS?');

    expect(result.chunks[0]?.path).toBe('runner-specs-aws.md');
  });

  it('returns the metadata that ranking depends on', async () => {
    const result = await searchChunks('How do I start the current drift agent?');
    const paths = result.chunks.map((chunk) => chunk.path);

    expect(paths).toContain('drift-agent-v3.md');

    // Both SDK guides come back, and the retired one is marked as such. Ranking needs
    // that flag, and so does the answer, which has to be able to say the old one is gone.
    const retired = result.chunks.find((chunk) => chunk.path === 'drift-agent-v2.md');
    if (retired) expect(retired.isDeprecated).toBe(true);
  });

  it('records which search found each result', async () => {
    const result = await searchChunks('AWS artifact limit');

    const found = result.chunks[0];
    expect(found).toBeDefined();
    expect(found?.vectorRank ?? found?.keywordRank).toBeGreaterThan(0);
  });

  it('finds an exact term that a paraphrase would lose', async () => {
    // Keyword search earns its place here. Product names and version numbers are the
    // things vector search is worst at, because there is nothing to generalise about.
    const result = await searchChunks('halcyon-runner 4.2');
    const paths = result.chunks.map((chunk) => chunk.path);

    expect(paths).toContain('changelogs/halcyon-runner-4.2.md');
  });

  it('reports how far away the nearest result was', async () => {
    const near = await searchChunks('Which four checks must every runner release pass?');
    const far = await searchChunks('Write me a C++ function that reverses a string.');

    expect(near.nearestDistance).not.toBeNull();
    expect(far.nearestDistance).not.toBeNull();
    expect(near.nearestDistance ?? 1).toBeLessThan(far.nearestDistance ?? 0);
  });

  it('respects a limit', async () => {
    const result = await searchChunks('pipeline', { limit: 3 });

    expect(result.chunks.length).toBeLessThanOrEqual(3);
  });

  it('can be restricted to one kind of document', async () => {
    const result = await searchChunks('audio compression', { docType: 'changelog' });

    expect(result.chunks.length).toBeGreaterThan(0);
    for (const chunk of result.chunks) {
      expect(chunk.docType).toBe('changelog');
    }
  });

  it('returns nothing rather than failing when a question matches nothing at all', async () => {
    const result = await searchChunks('zzzzqqqq', { docType: 'no-such-type' });

    expect(result.chunks).toEqual([]);
    expect(result.nearestDistance).toBeNull();
  });

  it('survives punctuation that would break a naive query parser', async () => {
    // The search box takes whatever a person types, and websearch_to_tsquery is chosen
    // partly because it does not raise on input like this.
    for (const question of ['"unclosed quote', 'a & b | c', '!!! ???', "it's a test"]) {
      await expect(searchChunks(question, { limit: 2 })).resolves.toBeDefined();
    }
  });
});

describe('the plan the vector search actually gets', () => {
  const pool = getPool();

  /**
   * Explains the query that ships, not one written here.
   *
   * There was already a plan test in the database package and it passed throughout the
   * period when the shipped query could not reach the index at all, because it wrote its
   * own `ORDER BY embedding <=> $1` and explained that. A plan test that supplies its own
   * query is a test that PostgreSQL works.
   *
   * Sequential scans are turned off because at 142 rows the planner prefers one and is
   * right to. What is being asserted is that the index is reachable, which is the
   * property that decides how this behaves on a collection large enough to care. If the
   * operator class were wrong, or a join were reintroduced, the plan would fall back even
   * with scans disabled, which is exactly what it used to do.
   */
  it('can use the vector index for the unfiltered search', async () => {
    const vector = `[${Array.from({ length: 1536 }, (_, i) => (i === 0 ? 1 : 0)).join(',')}]`;

    await pool.query('SET enable_seqscan = off');
    try {
      const { rows } = await pool.query<{ 'QUERY PLAN': string }>(`EXPLAIN ${VECTOR_SEARCH_SQL}`, [
        vector,
        30,
      ]);

      const plan = rows.map((row) => row['QUERY PLAN']).join('\n');
      expect(plan).toContain('chunk_embedding_hnsw_idx');
      expect(plan).not.toContain('Seq Scan');
    } finally {
      await pool.query('RESET enable_seqscan');
    }
  });

  it('filters first for a type restricted search, rather than walking the index', async () => {
    /**
     * The opposite expectation, and it is deliberate rather than a concession.
     *
     * With a selective filter the right plan finds the few matching rows and sorts them.
     * Walking a graph in distance order and discarding everything of the wrong type does
     * more work for the same answer. This asserts the shape stays that way, so that a
     * later attempt to make both queries "consistent" has to argue with a test.
     */
    const vector = `[${Array.from({ length: 1536 }, (_, i) => (i === 0 ? 1 : 0)).join(',')}]`;

    const { rows } = await pool.query<{ 'QUERY PLAN': string }>(
      `EXPLAIN ${VECTOR_SEARCH_BY_TYPE_SQL}`,
      [vector, 30, 'guide'],
    );

    const plan = rows.map((row) => row['QUERY PLAN']).join('\n');
    expect(plan).not.toContain('chunk_embedding_hnsw_idx');
  });
});
