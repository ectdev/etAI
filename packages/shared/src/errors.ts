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
