import { describe, expect, it } from 'vitest';
import { callUpstream, UpstreamServiceError } from './errors.js';

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
