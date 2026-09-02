import { UpstreamServiceError } from '@etai/shared';
import { ZodError } from 'zod';

/**
 * Errors the application raises on purpose, each carrying the status it should
 * become at the edge.
 *
 * The point of the class is that a route handler can throw and stop thinking about
 * HTTP. One translator turns these into responses, which keeps every endpoint
 * consistent and keeps internal details out of the body.
 */
export class AppError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(message = 'The request body is not valid', details?: unknown) {
    super(message, 400, 'validation_error', details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'You need to sign in to do that') {
    super(message, 401, 'unauthorized');
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Your account does not have access to that') {
    super(message, 403, 'forbidden');
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'That does not exist') {
    super(message, 404, 'not_found');
  }
}

export class RateLimitError extends AppError {
  constructor(message = 'Too many requests, try again shortly') {
    super(message, 429, 'rate_limited');
  }
}

/** A model provider or another external service failed. */
export class UpstreamError extends AppError {
  constructor(message = 'An upstream service did not respond correctly') {
    super(message, 502, 'upstream_error');
  }
}

type ErrorBody = {
  error: { code: string; message: string; details?: unknown };
};

/**
 * Turns anything thrown inside a route handler into a response.
 *
 * Known errors keep their message because it was written to be read by a user.
 * Anything else becomes a flat 500: an unexpected failure can carry a database
 * string or a file path in its message, and that belongs in the server log rather
 * than in an HTTP body.
 */
export function toErrorResponse(error: unknown): Response {
  if (error instanceof ZodError) {
    return json(400, {
      error: {
        code: 'validation_error',
        message: 'The request body is not valid',
        details: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
    });
  }

  /**
   * A provider outage is not a bug in this application and should not read like one.
   * The service name is logged, never returned: a provider error can carry a request
   * id, a quota description or a URL.
   */
  if (error instanceof UpstreamServiceError) {
    console.error(`Upstream failure from ${error.service}:`, error.cause);
    return json(502, {
      error: { code: 'upstream_error', message: 'A service this depends on did not respond' },
    });
  }

  if (error instanceof AppError) {
    return json(error.status, {
      error: {
        code: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
      },
    });
  }

  console.error('Unhandled error in route handler:', error);

  return json(500, {
    error: { code: 'internal_error', message: 'Something went wrong on our end' },
  });
}

function json(status: number, body: ErrorBody): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
