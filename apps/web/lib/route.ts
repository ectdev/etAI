import type { ZodType } from 'zod';
import { ValidationError, toErrorResponse } from './errors';

/**
 * Reads and validates a JSON body.
 *
 * A body that is not JSON at all is a validation failure rather than a crash, because
 * that is what it is: a request that did not arrive in the shape the endpoint accepts.
 */
export async function readJson<T>(request: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown;

  try {
    raw = await request.json();
  } catch {
    throw new ValidationError('The request body must be JSON');
  }

  const parsed = schema.safeParse(raw);

  if (!parsed.success) {
    throw new ValidationError('The request body is not valid', {
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }

  return parsed.data;
}

/**
 * Wraps a handler so it can throw instead of building error responses.
 *
 * Without this every endpoint repeats the same translation from an error to a status
 * code, and the repetition is where they drift apart: one returns a message another
 * hides, one forgets to log. Handlers here return the success case and throw everything
 * else.
 */
export function handler(run: (request: Request) => Promise<Response>) {
  return async (request: Request): Promise<Response> => {
    try {
      return await run(request);
    } catch (error) {
      return toErrorResponse(error);
    }
  };
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
