import { afterAll, describe, expect, it, vi } from 'vitest';
import { UpstreamServiceError, VECTOR_DIMENSIONS } from '@etai/shared';
import { closeDb } from '@etai/db';
import { isNothingClose } from '../generation/answer.js';

/**
 * What happens to search when the embedding provider is down.
 *
 * This project runs two searches and fuses them, and one of the two needs a model. Until
 * now an embedding outage took the other one down with it: a single `await` threw and the
 * request became a 502 for a system that still had a keyword index, a GIN index over it
 * and a query written against it. Reliability here means the half that works keeps
 * working, not that both halves fail together.
 *
 * The outage is forced rather than waited for. It has happened twice in this project for
 * real, both times when a key ran out of credit, and neither time was convenient.
 *
 * `embedQuery` is mocked rather than the HTTP call, because what is under test is what
 * `searchChunks` does with a failure, not how the failure is produced. The real thing is
 * wrapped in `callUpstream`, which is what turns a provider error into the class caught
 * here, and `errors.test.ts` covers that half.
 */

/**
 * A fixed unit vector stands in for a real one, so this file needs no API key and costs
 * nothing. What is under test is the branch, not the relevance: whether the vector query
 * runs at all and whether the result says it was degraded. The rows it comes back with
 * are whatever is nearest to an arbitrary direction, which is exactly as meaningful as it
 * needs to be here.
 */
const STAND_IN_VECTOR = Array.from({ length: VECTOR_DIMENSIONS }, (_, index) =>
  index === 0 ? 1 : 0,
);

vi.mock('../embedding/embed.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../embedding/embed.js')>();

  return {
    ...actual,
    embedQuery: vi.fn(),
  };
});

const { embedQuery } = await import('../embedding/embed.js');

// The default for every call that does not deliberately fail.
vi.mocked(embedQuery).mockResolvedValue(STAND_IN_VECTOR);
const { searchChunks } = await import('./search.js');

afterAll(async () => {
  await closeDb();
});

describe('searching while the embedding provider is down', () => {
  it('returns keyword results instead of failing the request', async () => {
    vi.mocked(embedQuery).mockRejectedValueOnce(
      new UpstreamServiceError('embedding', new Error('429 quota exceeded')),
    );

    const result = await searchChunks('report() steps agent');

    expect(result.degraded).toBe(true);
    expect(result.chunks.length).toBeGreaterThan(0);

    // Every result came from the keyword half, so none of them carries a distance and all
    // of them carry a keyword rank. That is the difference the flag is reporting.
    expect(result.chunks.every((chunk) => chunk.distance === null)).toBe(true);
    expect(result.chunks.every((chunk) => chunk.keywordRank !== null)).toBe(true);
    expect(result.nearestDistance).toBeNull();
  });

  it('finds the right document, which is the point of keeping the half that works', async () => {
    vi.mocked(embedQuery).mockRejectedValueOnce(
      new UpstreamServiceError('embedding', new Error('503')),
    );

    const result = await searchChunks('report()');

    // Not a claim that degraded search is as good as hybrid: it is measurably worse, and
    // that is the argument for hybrid. It is a claim that it is still useful, on a
    // question whose wording appears in the documents.
    expect(result.chunks.map((chunk) => chunk.path)).toContain('drift-agent-v2.md');
  });

  it('is not a general catch: a bug still fails the request', async () => {
    /**
     * The premise, and the line that makes this safe. Swallowing every error here would
     * turn a null dereference in the embedding code into a silently worse search, which
     * is the failure this project has an entry about. Only the class that means "another
     * system is down" is caught.
     */
    vi.mocked(embedQuery).mockRejectedValueOnce(new TypeError('cannot read property of undefined'));

    await expect(searchChunks('report()')).rejects.toThrow(TypeError);
  });

  it('runs the normal path when embedding works, so the flag means something', async () => {
    // Without this the first test could pass against a system that had given up on
    // vectors entirely, and `degraded: true` would be the only state there is.
    const result = await searchChunks('What is the maximum artifact size on AWS?');

    expect(result.degraded).toBe(false);
    expect(result.nearestDistance).not.toBeNull();
    expect(result.chunks.some((chunk) => chunk.distance !== null)).toBe(true);
  });
});

describe('the relevance gate under a degraded search', () => {
  const chunks = [{ path: 'a.md' }] as never;

  it('stands down, because there is no distance to judge with', () => {
    /**
     * The failure this prevents is the quiet one. `nearestDistance` is null under a
     * degraded search for a reason that has nothing to do with relevance, and read the
     * usual way every question in the collection would be refused as out of scope while
     * the system looked like it was working.
     */
    expect(isNothingClose({ chunks, nearestDistance: null, degraded: true }, 0.42)).toBe(false);
    expect(isNothingClose({ chunks, nearestDistance: null, degraded: false }, 0.42)).toBe(true);
  });

  it('still refuses when nothing was retrieved at all', () => {
    // Standing down is about the distance, not about the results. No documents is no
    // documents whichever search found them.
    expect(isNothingClose({ chunks: [], nearestDistance: null, degraded: true }, 0.42)).toBe(true);
  });

  it('applies the limit normally when the search was not degraded', () => {
    expect(isNothingClose({ chunks, nearestDistance: 0.9, degraded: false }, 0.42)).toBe(true);
    expect(isNothingClose({ chunks, nearestDistance: 0.2, degraded: false }, 0.42)).toBe(false);
  });
});

describe('the widening that only happens when keyword search is alone', () => {
  it('finds a question whose terms never co-occur, which AND cannot', async () => {
    /**
     * The failure this fixes was found by running the system with a dead key rather than
     * by reading the code. "What happened to report()?" parses to
     * `'happen' & 'report()'`, no document holds both, and the empty result was
     * reported to the reader as "this question is outside what the indexed documents
     * cover" about a question the corpus answers on its own front page.
     */
    vi.mocked(embedQuery).mockRejectedValueOnce(
      new UpstreamServiceError('embedding', new Error('401')),
    );

    const result = await searchChunks('What happened to report()?');

    expect(result.degraded).toBe(true);
    expect(result.chunks.length).toBeGreaterThan(0);
  });

  it('does not widen when the strict query already matched', async () => {
    /**
     * The premise, and the reason this is a fallback. Widening costs precision, and the
     * cost is measurable on this collection: "drift agent v2" matches 4 chunks with AND
     * and 8 with OR. A search that widened every time would be worse than the one it
     * replaced.
     *
     * Asserted on membership and on the count rather than on which document comes first.
     * The strict matches tie closely at ts_rank, so the order at the top is decided by the
     * metadata pass rather than by the text search, and the count is the thing that
     * actually distinguishes the two paths.
     */
    vi.mocked(embedQuery).mockRejectedValueOnce(
      new UpstreamServiceError('embedding', new Error('401')),
    );

    const result = await searchChunks('drift agent v2', { limit: 20 });

    expect(result.chunks.map((chunk) => chunk.path)).toContain('drift-agent-v2.md');
    expect(result.chunks.length).toBeLessThan(10);
  });

  it('does not widen while vector search is working', async () => {
    /**
     * With both halves running, AND is right: the vector half catches what wording misses,
     * and widening here would push common words into every result set.
     *
     * Asserted on `keywordRank` rather than on which documents came back, because that is
     * the only thing that actually distinguishes the two. The first version of this test
     * checked `degraded` and that some chunk had a distance, and both stayed true with the
     * guard deleted, so it passed against the behaviour it was written to forbid. This
     * question's strict query matches nothing, so with the guard in place every result
     * must have come from the vector half and carry no keyword rank at all.
     */
    const result = await searchChunks(
      'Why is the build cache kept separate from the artifact store?',
    );

    expect(result.degraded).toBe(false);
    expect(result.chunks.some((chunk) => chunk.distance !== null)).toBe(true);
    expect(result.chunks.every((chunk) => chunk.keywordRank === null)).toBe(true);
  });
});
