import { describe, expect, it } from 'vitest';
import { fuseByRank, toRanked } from './fuse.js';

const ranked = (...ids: string[]) => toRanked(ids, (id) => id);

describe('fuseByRank', () => {
  it('keeps the order of one list when the other is empty', () => {
    const fused = fuseByRank(ranked('a', 'b', 'c'), []);

    expect(fused.map((item) => item.chunkId)).toEqual(['a', 'b', 'c']);
  });

  it('puts a result both searches found above one that only appeared in the first', () => {
    // This is the point of fusing. Neither search is trusted alone, and agreement
    // between two that fail differently is a stronger signal than either ranking.
    const fused = fuseByRank(ranked('only-vector', 'both'), ranked('both'));

    expect(fused[0]?.chunkId).toBe('both');
  });

  it('records where each result came from', () => {
    const fused = fuseByRank(ranked('a', 'b'), ranked('b'));
    const b = fused.find((item) => item.chunkId === 'b');

    expect(b?.vectorRank).toBe(2);
    expect(b?.keywordRank).toBe(1);
  });

  it('leaves the rank null for the search that did not find a result', () => {
    const fused = fuseByRank(ranked('a'), ranked('b'));

    expect(fused.find((item) => item.chunkId === 'a')?.keywordRank).toBeNull();
    expect(fused.find((item) => item.chunkId === 'b')?.vectorRank).toBeNull();
  });

  it('lets a keyword hit rescue something vector search ranked far down', () => {
    // The case this exists for: an exact term such as a product name or a version
    // number, which vector search paraphrases away and keyword search finds outright.
    const vector = ranked('v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8', 'v9', 'exact');
    const keyword = ranked('exact');

    const fused = fuseByRank(vector, keyword);

    expect(fused[0]?.chunkId).toBe('exact');
  });

  it('does not let one search alone outrank agreement, however confident it is', () => {
    const fused = fuseByRank(ranked('first-in-vector', 'agreed'), ranked('agreed'));
    const agreed = fused.find((item) => item.chunkId === 'agreed');
    const alone = fused.find((item) => item.chunkId === 'first-in-vector');

    expect(agreed?.score).toBeGreaterThan(alone?.score ?? 0);
  });

  it('returns every result from both searches', () => {
    const fused = fuseByRank(ranked('a', 'b'), ranked('b', 'c'));

    expect(fused.map((item) => item.chunkId).sort()).toEqual(['a', 'b', 'c']);
  });

  it('is stable, so the same inputs give the same order', () => {
    const first = fuseByRank(ranked('a', 'b'), ranked('c', 'd'));
    const second = fuseByRank(ranked('a', 'b'), ranked('c', 'd'));

    expect(first.map((item) => item.chunkId)).toEqual(second.map((item) => item.chunkId));
  });

  it('handles two empty lists without failing', () => {
    expect(fuseByRank([], [])).toEqual([]);
  });

  it('scores by position rather than by any score the searches produced', () => {
    // Cosine distance and text rank are not comparable numbers, and weighing one
    // against the other needs a constant that has to be guessed. Positions do not.
    const fused = fuseByRank(ranked('a'), ranked('a'));

    expect(fused[0]?.score).toBeCloseTo(2 / 61, 10);
  });
});
