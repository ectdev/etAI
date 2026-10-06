import { afterEach, describe, expect, it, vi } from 'vitest';
import { UpstreamServiceError, VECTOR_DIMENSIONS } from '@etai/shared';

/**
 * The question cache, with the provider replaced by a counter.
 *
 * What matters is how many provider calls a sequence of questions costs, and that a
 * failure is neither cached nor disguised: search tells a provider outage apart from a
 * bug by its class, so the error must arrive exactly as the provider wrapper threw it.
 */

let calls = 0;
let failNext = 0;
let lastSignal: AbortSignal | undefined;
let delayMs = 0;

vi.mock('ai', async (original) => ({
  ...(await original<typeof import('ai')>()),
  embed: vi.fn(async ({ value, abortSignal }: { value: string; abortSignal?: AbortSignal }) => {
    calls += 1;
    lastSignal = abortSignal;
    if (delayMs > 0) {
      // A slow provider that still honours the deadline it was given.
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, delayMs);
        abortSignal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(abortSignal.reason);
        });
      });
    }
    if (failNext > 0) {
      failNext -= 1;
      throw Object.assign(new Error('503 high demand'), { statusCode: 503 });
    }
    const embedding = Array.from({ length: VECTOR_DIMENSIONS }, (_, i) =>
      i === value.length % VECTOR_DIMENSIONS ? 1 : 0,
    );
    return { embedding, usage: { tokens: 1 } };
  }),
}));

process.env.EMBEDDING_PROVIDER = 'google';
const { clearQueryCache, embedQuery, queryCacheKey } = await import('./embed.js');

afterEach(() => {
  delayMs = 0;
  calls = 0;
  failNext = 0;
  clearQueryCache();
});

describe('the question cache', () => {
  it('pays for a question once when it is asked twice', async () => {
    const first = await embedQuery('maximum artifact size on AWS');
    const second = await embedQuery('maximum artifact size on AWS');

    expect(calls).toBe(1);
    expect(second).toEqual(first);
  });

  it('pays once per distinct question', async () => {
    await embedQuery('one question');
    await embedQuery('another question');
    await embedQuery('one question');

    expect(calls).toBe(2);
  });

  it('shares one call between concurrent requests for the same question', async () => {
    await Promise.all(Array.from({ length: 5 }, () => embedQuery('asked five times at once')));
    expect(calls).toBe(1);
  });

  it('does not cache a failure, and rethrows it as the same upstream error', async () => {
    failNext = 1;
    const failure = await embedQuery('during an outage').catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(UpstreamServiceError);

    const recovered = await embedQuery('during an outage');
    expect(recovered).toHaveLength(VECTOR_DIMENSIONS);
    expect(calls).toBe(2);
  });

  it('hands out a vector nobody can change for the next caller', async () => {
    const vector = await embedQuery('frozen');
    expect(() => {
      (vector as number[])[0] = 42;
    }).toThrow(TypeError);
    expect((await embedQuery('frozen'))[0]).not.toBe(42);
  });

  it('keys by signature as well as text, so a configuration change misses', () => {
    expect(queryCacheKey('google:a:1536:text-v1', 'q')).not.toBe(
      queryCacheKey('google:b:1536:text-v1', 'q'),
    );
    expect(queryCacheKey('s', 'q')).toBe(queryCacheKey('s', 'q'));
  });

  it('handles empty and very long questions', async () => {
    await expect(embedQuery('')).resolves.toHaveLength(VECTOR_DIMENSIONS);
    await expect(embedQuery('x'.repeat(10_000))).resolves.toHaveLength(VECTOR_DIMENSIONS);
  });
});

describe('the deadline on a question embedding', () => {
  it('is passed to every call, so a provider that never answers cannot hold a search open', async () => {
    await embedQuery('a question asked under a deadline');

    expect(lastSignal).toBeInstanceOf(AbortSignal);
    expect(lastSignal?.aborted).toBe(false);
  });
});

describe('the deadline a caller chooses', () => {
  it('gives up on a slow provider once a short deadline passes', async () => {
    delayMs = 300;
    const started = performance.now();

    await expect(embedQuery('a question nobody can wait for', { timeoutMs: 50 })).rejects.toThrow();
    expect(performance.now() - started).toBeLessThan(250);
  });

  it('waits it out when a batch allows longer', async () => {
    delayMs = 100;

    const vector = await embedQuery('a question in a batch', { timeoutMs: 1_000 });

    expect(vector).toHaveLength(VECTOR_DIMENSIONS);
  });
});
