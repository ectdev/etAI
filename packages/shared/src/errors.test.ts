import { describe, expect, it } from 'vitest';
import {
  timedOut,
  callUpstream,
  isTransientProviderFailure,
  providerStatus,
  UpstreamServiceError,
} from './errors.js';

/**
 * The boundary between a failure that is ours and one that is not.
 *
 * Before this existed, an embedding API outage and a null dereference arrived at the
 * route handler as the same thing: a plain `Error`, translated into a 500 saying
 * something went wrong on our end. There was even a `502 upstream_error` class defined
 * and unit tested, and nothing in the application ever threw it.
 */
describe('naming a failure that came from somewhere else', () => {
  it('passes a successful call straight through', async () => {
    await expect(callUpstream('embedding', async () => 'a vector')).resolves.toBe('a vector');
  });

  it('turns a provider failure into one that names the provider', async () => {
    const failing = callUpstream('google generation', async () => {
      throw new Error('503 Service Unavailable');
    });

    await expect(failing).rejects.toBeInstanceOf(UpstreamServiceError);
    await expect(failing).rejects.toThrow(/google generation/);
  });

  it('keeps the original error so a log still has the provider message', async () => {
    /**
     * The message a caller sees and the message an operator needs are different, and
     * this is the only place both exist. A provider error can carry a request id, a
     * quota description or a URL, so it is kept as the cause and never as the message.
     */
    const original = new Error('quota exceeded for project 12345, see https://internal/url');

    try {
      await callUpstream('embedding', async () => {
        throw original;
      });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(UpstreamServiceError);
      expect((error as UpstreamServiceError).cause).toBe(original);
      expect((error as Error).message).not.toContain('12345');
      expect((error as Error).message).not.toContain('https://internal/url');
    }
  });

  it('does not wrap a failure it already wrapped', async () => {
    // Embedding is called from inside answering. Without this, an embedding outage would
    // be reported as a generation failure, which sends whoever reads the log to the
    // wrong provider's status page.
    const inner = new UpstreamServiceError('embedding', new Error('timeout'));

    try {
      await callUpstream('google generation', async () => {
        throw inner;
      });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBe(inner);
      expect((error as UpstreamServiceError).service).toBe('embedding');
    }
  });

  it('survives something thrown that was never an Error', async () => {
    // A library rejecting with a string or an object is not unusual, and a wrapper that
    // assumed `Error` would throw while handling the throw.
    await expect(
      callUpstream('embedding', async () => {
        throw 'just a string';
      }),
    ).rejects.toBeInstanceOf(UpstreamServiceError);
  });
});

describe('reading a provider failure', () => {
  const nested = (status: number) =>
    Object.assign(new Error('outer'), {
      cause: Object.assign(new Error('retry'), {
        lastError: Object.assign(new Error('api'), { statusCode: status }),
      }),
    });

  it('finds the status however deep the SDK put it', () => {
    expect(providerStatus(nested(503))).toBe(503);
    expect(providerStatus({ errors: [{}, { status: 429 }] })).toBe(429);
  });

  it('treats overload, rate limits and outages as transient, and auth and bad requests as not', () => {
    for (const status of [408, 429, 500, 502, 503, 504, 529])
      expect(isTransientProviderFailure(nested(status))).toBe(true);
    for (const status of [400, 401, 403, 404, 422])
      expect(isTransientProviderFailure(nested(status))).toBe(false);
  });

  it('falls back to the message when there is no status', () => {
    expect(isTransientProviderFailure(new Error('The model is overloaded'))).toBe(true);
    expect(isTransientProviderFailure(new Error('Invalid API key'))).toBe(false);
  });

  it('survives values that are not errors, and a cause that points back at itself', () => {
    const loop: Record<string, unknown> = { message: 'loop' };
    loop.cause = loop;
    loop.lastError = loop;

    for (const value of [null, undefined, 'text', 42, {}, [], loop]) {
      expect(() => providerStatus(value)).not.toThrow();
      expect(() => isTransientProviderFailure(value)).not.toThrow();
    }
    expect(providerStatus(loop)).toBeUndefined();
  });

  it('ignores numbers that are not HTTP statuses', () => {
    expect(providerStatus({ statusCode: 42 })).toBeUndefined();
    expect(providerStatus({ status: 503.5 })).toBeUndefined();
    expect(providerStatus({ status: '503' })).toBeUndefined();
  });
});

describe('timedOut', () => {
  const deadline = () =>
    Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });

  it('recognises a deadline, however deep the SDK and this module have wrapped it', () => {
    expect(timedOut(deadline())).toBe(true);
    expect(timedOut(new UpstreamServiceError('generation', deadline()))).toBe(true);
    expect(
      timedOut(new UpstreamServiceError('generation', new Error('retry', { cause: deadline() }))),
    ).toBe(true);
  });

  it('is not fooled by a cancellation, a provider error, or nothing at all', () => {
    expect(timedOut(Object.assign(new Error('aborted'), { name: 'AbortError' }))).toBe(false);
    expect(timedOut(Object.assign(new Error('busy'), { statusCode: 503 }))).toBe(false);
    expect(timedOut(undefined)).toBe(false);
    expect(timedOut('TimeoutError')).toBe(false);
  });

  it('makes a timeout transient, so the next model is tried', () => {
    expect(isTransientProviderFailure(new UpstreamServiceError('generation', deadline()))).toBe(
      true,
    );
  });

  it('stops walking a cause chain that loops back on itself', () => {
    const looped: Error & { cause?: unknown } = new Error('loop');
    looped.cause = looped;
    expect(timedOut(looped)).toBe(false);
  });
});
