/**
 * A failure that came from a service this application calls, not from this application.
 *
 * It exists because the two are worth telling apart and nothing was telling them apart.
 * When the embedding API or the generation API is down, every layer above it saw a plain
 * `Error`, the route handler treated it as unexpected, and the caller got a 500 saying
 * something went wrong on our end. That is the wrong answer three times over: it blames
 * the wrong system, it gives no signal that retrying later would work, and it buries a
 * provider outage in the same bucket as a programming mistake.
 *
 * Defined here rather than beside the HTTP error classes because `packages/core` throws
 * it and core knows nothing about HTTP. Every surface that wraps core, the web routes
 * today and the MCP server next, translates it into whatever it is that surface says.
 */
export class UpstreamServiceError extends Error {
  constructor(
    /** Which service failed, in words a log reader can act on. */
    readonly service: string,
    override readonly cause?: unknown,
  ) {
    super(`The ${service} service did not respond correctly`);
    this.name = 'UpstreamServiceError';
  }
}

/**
 * Runs something that talks to an external service, and names the service if it fails.
 *
 * The original error is kept as `cause` so a log still has the provider's own message.
 * Only the message that reaches a caller is replaced, because a provider error can carry
 * a request id, a quota description or a URL, and none of those belong in a response
 * body.
 */
export async function callUpstream<T>(service: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    // An error this wrapper already produced is passed through rather than wrapped
    // twice, so a nested call does not report the outer service for an inner failure.
    if (error instanceof UpstreamServiceError) throw error;
    throw new UpstreamServiceError(service, error);
  }
}

/**
 * The HTTP status a provider answered with, dug out of whatever wraps it.
 *
 * The SDK reports a failed call as a retry error holding the last attempt, which holds
 * the API error, which holds the status, and this module wraps all of that once more.
 * Walked rather than reached for by a fixed path, because the nesting is the SDK's
 * business and changes between versions. A set of visited objects keeps a cause that
 * points back at itself from looping.
 */
export function providerStatus(error: unknown): number | undefined {
  const seen = new Set<unknown>();
  const queue: unknown[] = [error];

  while (queue.length > 0 && seen.size < 50) {
    const current = queue.shift();
    if (current === null || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);

    const record = current as Record<string, unknown>;
    for (const key of ['statusCode', 'status'] as const) {
      const value = record[key];
      if (typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599) {
        return value;
      }
    }

    queue.push(record.cause, record.lastError);
    if (Array.isArray(record.errors)) queue.push(...record.errors);
  }

  return undefined;
}

/** Statuses a second model can reasonably be asked to cover: overload, rate, outage. */
const TRANSIENT_STATUSES = new Set([408, 429, 500, 502, 503, 504, 529]);

/**
 * Whether a provider failure is the kind another model might not share.
 *
 * Overload and rate limits are per model, so a sibling model often answers while the
 * first is busy. A bad key or a malformed request is not: every model behind the same
 * key fails the same way, and retrying elsewhere only doubles the wait for the same error.
 */
export function isTransientProviderFailure(error: unknown): boolean {
  const status = providerStatus(error);
  if (status !== undefined) return TRANSIENT_STATUSES.has(status);

  // A call that ran out of time says nothing about the next model, which may well answer.
  if (timedOut(error)) return true;

  const text = describe(error);
  return /overloaded|high demand|temporarily unavailable|rate limit/i.test(text);
}

/** Whether a deadline, rather than the provider, ended the call, however it was wrapped. */
export function timedOut(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  for (let depth = 0; depth < 10 && current && !seen.has(current); depth += 1) {
    seen.add(current);
    const name = (current as { name?: unknown }).name;
    if (name === 'TimeoutError') return true;
    current = typeof current === 'object' ? (current as { cause?: unknown }).cause : undefined;
  }
  return false;
}

function describe(error: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  for (let depth = 0; depth < 10 && current && !seen.has(current); depth += 1) {
    seen.add(current);
    if (typeof current === 'string') parts.push(current);
    else if (current instanceof Error) parts.push(current.message);
    current = typeof current === 'object' ? (current as { cause?: unknown }).cause : undefined;
  }
  return parts.join(' ');
}
