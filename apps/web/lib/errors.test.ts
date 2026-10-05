import { describe, expect, it, vi } from 'vitest';
import { UpstreamServiceError } from '@etai/shared';
import { z } from 'zod';
import {
  ForbiddenError,
  NotFoundError,
  RateLimitError,
  UnauthorizedError,
  UpstreamError,
  ValidationError,
  toErrorResponse,
} from './errors';

async function body(response: Response) {
  return (await response.json()) as { error: { code: string; message: string; details?: unknown } };
}

describe('toErrorResponse', () => {
  it.each([
    [new ValidationError(), 400, 'validation_error'],
    [new UnauthorizedError(), 401, 'unauthorized'],
    [new ForbiddenError(), 403, 'forbidden'],
    [new NotFoundError(), 404, 'not_found'],
    [new RateLimitError(), 429, 'rate_limited'],
    [new UpstreamError(), 502, 'upstream_error'],
  ])('turns %o into the right status and code', async (error, status, code) => {
    const response = toErrorResponse(error);
    expect(response.status).toBe(status);

    const payload = await body(response);
    expect(payload.error.code).toBe(code);
    expect(payload.error.message.length).toBeGreaterThan(0);
  });

  it('answers a provider outage as an upstream failure, not as our own', async () => {
    /**
     * The gap this closes. An embedding or generation outage used to arrive here as a
     * plain Error and leave as a 500 saying something went wrong on our end, which
     * blames the wrong system and tells a caller nothing about whether to retry. The
     * 502 class existed and was tested; nothing threw it.
     */
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = toErrorResponse(
      new UpstreamServiceError('google generation', new Error('503 from provider, request abc123')),
    );

    expect(response.status).toBe(502);

    const payload = await body(response);
    expect(payload.error.code).toBe('upstream_error');
    // The provider's own message stays in the log. A request id or a quota URL in a
    // response body is a leak, and provider errors carry both.
    expect(JSON.stringify(payload)).not.toContain('abc123');
    expect(logged).toHaveBeenCalled();

    logged.mockRestore();
  });

  it('reports every invalid field, so a form can mark all of them at once', async () => {
    const schema = z.object({ email: z.email(), topK: z.number().int().positive() });
    const parsed = schema.safeParse({ email: 'nope', topK: -1 });

    expect(parsed.success).toBe(false);
    if (parsed.success) return;

    const response = toErrorResponse(parsed.error);
    expect(response.status).toBe(400);

    const payload = await body(response);
    const details = payload.error.details as Array<{ path: string }>;
    expect(details.map((detail) => detail.path).sort()).toEqual(['email', 'topK']);
  });

  it('keeps an unexpected error out of the response body', async () => {
    // A stray error can carry a connection string or a file path in its message, and
    // an HTTP body is the wrong place for either.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const leaky = new Error('connect ECONNREFUSED postgresql://etai:secret@localhost:5432');

    const response = toErrorResponse(leaky);
    const payload = await body(response);

    expect(response.status).toBe(500);
    expect(payload.error.code).toBe('internal_error');
    expect(JSON.stringify(payload)).not.toContain('secret');
    expect(JSON.stringify(payload)).not.toContain('ECONNREFUSED');

    // It still has to be diagnosable, so it goes to the server log instead.
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });

  it('handles a thrown value that is not an error at all', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    for (const thrown of ['a string', 42, null, undefined, { unexpected: true }]) {
      const response = toErrorResponse(thrown);
      expect(response.status).toBe(500);
    }

    logged.mockRestore();
  });

  it('always answers with JSON, so a client can parse the failure the same way', async () => {
    const response = toErrorResponse(new NotFoundError());
    expect(response.headers.get('content-type')).toBe('application/json');
  });

  it('carries validation details through when they are supplied', async () => {
    const response = toErrorResponse(new ValidationError('Bad query', { field: 'query' }));
    const payload = await body(response);

    expect(payload.error.message).toBe('Bad query');
    expect(payload.error.details).toEqual({ field: 'query' });
  });
});
