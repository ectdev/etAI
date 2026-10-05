import { afterAll, describe, expect, it } from 'vitest';
import { closeDb, getPool } from '@etai/db';
import { KEYWORD_SEARCH_SQL, orderVectorRows } from './search.js';

/**
 * Keyword search returns ties in an order that survives a re-index.
 *
 * Runs the shipped SQL, not a copy, against the indexed corpus. It needs no embeddings,
 * so it runs in the default suite and in CI. All 61 migration updates share the
 * sentence about repositories in scope, so they tie exactly on that word: the case where
 * the order used to be whatever the rows' position on disk happened to be.
 */

afterAll(async () => {
  await closeDb();
});

async function keyword(text: string, limit: number, docType: string | null) {
  const pool = getPool();
  const { rows } = await pool.query<{ chunk_id: string; rank: string }>(KEYWORD_SEARCH_SQL, [
    text,
    limit,
    docType,
  ]);
  const { rows: located } = await pool.query<{ id: string; path: string; position: number }>(
    `SELECT c.id, d.path, c.position FROM chunk c JOIN document d ON d.id = c.document_id
      WHERE c.id = ANY($1)`,
    [rows.map((row) => row.chunk_id)],
  );
  const where = new Map(located.map((row) => [row.id, row]));
  return rows.map((row) => ({ rank: Number(row.rank), ...where.get(row.chunk_id)! }));
}

describe('keyword search ordering', () => {
  it('has ties to break, so the next case means something', async () => {
    const rows = await keyword('repositories', 100, 'migration');

    expect(rows.length).toBeGreaterThan(10);
    expect(new Set(rows.map((row) => row.rank)).size).toBeLessThan(rows.length);
  });

  it('orders chunks of equal rank by path, as the database sorts paths', async () => {
    const rows = await keyword('repositories', 100, 'migration');
    const tied = rows.filter((row) => row.rank === rows[0]!.rank).map((row) => row.path);

    // The database's collation, not JavaScript's, is the one the query sorts with.
    const { rows: sorted } = await getPool().query<{ path: string }>(
      'SELECT path FROM unnest($1::text[]) AS path ORDER BY path',
      [tied],
    );
    expect(tied).toEqual(sorted.map((row) => row.path));
  });

  it('cuts at the limit from that same order, so the top thirty are always the same thirty', async () => {
    const all = await keyword('repositories', 100, 'migration');
    const top = await keyword('repositories', 30, 'migration');

    expect(top.map((row) => row.path)).toEqual(all.slice(0, 30).map((row) => row.path));
  });
});

describe('orderVectorRows', () => {
  const row = (chunk_id: string, distance: string, tiebreak: string) => ({
    chunk_id,
    distance,
    tiebreak,
  });

  it('orders by distance as a number, not as the text the driver returns', () => {
    const ordered = orderVectorRows([row('a', '0.9', 'x'), row('b', '0.10', 'y')], 10);

    expect(ordered.map((item) => item.chunk_id)).toEqual(['b', 'a']);
  });

  it('settles equal distances by the stable key, whatever order they arrived in', () => {
    const tied = [row('id-3', '1', 'c'), row('id-1', '1', 'a'), row('id-2', '1', 'b')];

    expect(orderVectorRows(tied, 10).map((item) => item.tiebreak)).toEqual(['a', 'b', 'c']);
    expect(orderVectorRows([...tied].reverse(), 10)).toEqual(orderVectorRows(tied, 10));
  });

  it('cuts at the limit after ordering, so the same tied rows make the list everywhere', () => {
    const rows = [row('n', '0.2', 'z'), row('t2', '0.5', 'b'), row('t1', '0.5', 'a')];

    expect(orderVectorRows(rows, 2).map((item) => item.chunk_id)).toEqual(['n', 't1']);
    expect(orderVectorRows([], 5)).toEqual([]);
  });
});
