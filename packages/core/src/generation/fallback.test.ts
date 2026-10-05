import { afterEach, describe, expect, it, vi } from 'vitest';
import { UpstreamServiceError } from '@etai/shared';

/**
 * The fallback model, with the provider replaced by a script.
 *
 * Offline on purpose. The case it exists for, a model returning 503 on every other
 * request, cannot be summoned on demand, and a test that waits for an outage is not a
 * test. Retrieval is replaced too, with one close chunk, so every call reaches generation.
 */

const calls: string[] = [];
const signals: Array<AbortSignal | undefined> = [];
let script: Array<(model: string) => unknown> = [];

vi.mock('ai', async (original) => ({
  ...(await original<typeof import('ai')>()),
  generateObject: vi.fn(
    async ({ model, abortSignal }: { model: { modelId: string }; abortSignal?: AbortSignal }) => {
      calls.push(model.modelId);
      signals.push(abortSignal);
      const step = script.shift();
      if (!step) throw new Error('the script ran out');
      const result = step(model.modelId);
      if (result instanceof Error) throw result;
      return { object: result };
    },
  ),
}));

vi.mock('../retrieval/search.js', () => ({
  searchChunks: vi.fn(async () => ({
    chunks: [
      {
        chunkId: 'c1',
        documentId: 'd1',
        path: 'policies/release-gate.md',
        title: 'Release checklist',
        headingPath: null,
        content: 'Every release must be green on all four providers.',
        docType: 'reference',
        temporalDate: null,
        temporalPrecision: null,
        isDeprecated: false,
        supersededByPath: null,
        distance: 0.1,
        vectorRank: 1,
        keywordRank: 1,
        score: 1,
      },
    ],
    nearestDistance: 0.1,
    timings: { embedMs: 0, searchMs: 0 },
    degraded: false,
  })),
}));

const { answerQuestion } = await import('./answer.js');

const grounded = () => ({
  answer: 'Every release must be green on all four providers [1].',
  coverage: 'full',
  gap: null,
  citations: [
    {
      documentPath: 'policies/release-gate.md',
      quote: 'Every release must be green on all four providers.',
    },
  ],
});

/** Shaped like what the SDK throws: a retry error holding the API error holding the status. */
const providerError = (status: number, message = `HTTP ${status}`) =>
  Object.assign(new Error('Failed after 3 attempts'), {
    lastError: Object.assign(new Error(message), { statusCode: status }),
  });

const ask = (fallbackModel?: string | null) =>
  answerQuestion('Which checks must a release pass?', {
    provider: 'google',
    model: 'primary-model',
    ...(fallbackModel === undefined ? {} : { fallbackModel }),
  });

afterEach(() => {
  calls.length = 0;
  signals.length = 0;
  script = [];
});

describe('the fallback model', () => {
  it('is never asked when the primary answers', async () => {
    script = [grounded];
    const result = await ask('backup-model');

    expect(calls).toEqual(['primary-model']);
    expect(result.model).toBe('primary-model');
  });

  it.each([429, 500, 502, 503, 504, 529])(
    'answers when the primary fails with %i',
    async (status) => {
      script = [() => providerError(status), grounded];
      const result = await ask('backup-model');

      expect(calls).toEqual(['primary-model', 'backup-model']);
      expect(result.model).toBe('backup-model');
      expect(result.coverage).toBe('full');
      expect(result.citations).toHaveLength(1);
    },
  );

  it('answers when the overload is only in the message, with no status attached', async () => {
    script = [() => new Error('This model is currently experiencing high demand.'), grounded];
    expect((await ask('backup-model')).model).toBe('backup-model');
  });

  it.each([400, 401, 403, 404])(
    'is not asked when the primary fails with %i, which every model would share',
    async (status) => {
      script = [() => providerError(status), grounded];

      await expect(ask('backup-model')).rejects.toBeInstanceOf(UpstreamServiceError);
      expect(calls).toEqual(['primary-model']);
    },
  );

  it('is not asked when none is configured, or when it is turned off for the call', async () => {
    script = [() => providerError(503)];
    await expect(ask(null)).rejects.toBeInstanceOf(UpstreamServiceError);
    expect(calls).toEqual(['primary-model']);
  });

  it('is not asked when it is the same model as the primary', async () => {
    script = [() => providerError(503), grounded];
    await expect(ask('primary-model')).rejects.toBeInstanceOf(UpstreamServiceError);
    expect(calls).toEqual(['primary-model']);
  });

  it('is asked exactly once, and its own failure is the one reported', async () => {
    script = [
      () => providerError(503),
      () => providerError(503, 'backup overloaded too'),
      grounded,
    ];

    const failure = await ask('backup-model').catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(UpstreamServiceError);
    expect(calls).toEqual(['primary-model', 'backup-model']);
  });
});

describe('deadlines', () => {
  /** What `AbortSignal.timeout` ends a call with, as the SDK passes it on. */
  const timeout = () =>
    Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });

  it('gives every model its own deadline, so the fallback is not left with what remains', async () => {
    script = [() => providerError(503), grounded];
    await ask('backup-model');

    expect(signals).toHaveLength(2);
    expect(signals.every((signal) => signal instanceof AbortSignal)).toBe(true);
    expect(signals[0]).not.toBe(signals[1]);
    expect(signals[1]?.aborted).toBe(false);
  });

  it('asks the fallback when the primary runs out of time', async () => {
    script = [timeout, grounded];
    const result = await ask('backup-model');

    expect(calls).toEqual(['primary-model', 'backup-model']);
    expect(result.model).toBe('backup-model');
  });

  it('does not treat a cancelled request as a slow model', async () => {
    script = [() => Object.assign(new Error('aborted'), { name: 'AbortError' }), grounded];

    await expect(ask('backup-model')).rejects.toBeInstanceOf(UpstreamServiceError);
    expect(calls).toEqual(['primary-model']);
  });
});
