import type { ChatAnswer, ChatSource, DocumentDetail } from './chat-types';

/**
 * The requests the chat screen makes, and what it does when they fail.
 *
 * Asking a question is two calls rather than one. `/api/search` returns the passages, and
 * `/api/ask` returns the answer written from them. Both endpoints already existed and are
 * already tested, and the split is what makes "sources appear before the answer" a real
 * stage rather than a rendering order: at the point the sources are shown, the answer has
 * genuinely not been written yet.
 *
 * The cost of the split is one extra embedding call per question, a fraction of a cent.
 * Streaming would remove that and add a protocol, and it would also remove the citation
 * check, which cannot run halfway through the first token. Showing the passages early is
 * the part of streaming that can be done honestly here.
 */

export interface ApiFailure {
  message: string;
  /** A provider outage rather than a fault here, which reads differently to a person. */
  upstream: boolean;
  /**
   * Whether sending the same question again could work.
   *
   * False for a question the server rejected, because the text has not changed and it
   * will be rejected again. A "Try again" button on one of those is a button that cannot
   * work, which is what it was reported as.
   */
  retryable: boolean;
}

export class RequestFailed extends Error {
  constructor(readonly failure: ApiFailure) {
    super(failure.message);
    this.name = 'RequestFailed';
  }
}

interface ErrorBody {
  error?: { code?: string; message?: string };
}

async function readFailure(response: Response): Promise<ApiFailure> {
  let body: ErrorBody = {};
  try {
    body = (await response.json()) as ErrorBody;
  } catch {
    // A response that is not JSON is still a failure; it just cannot say why.
  }

  const code = body.error?.code;

  if (response.status === 400 || code === 'validation_error') {
    // The question itself was refused. Sending it unchanged gets the same answer.
    return {
      message: body.error?.message ?? 'That question could not be read. Try rewording it.',
      upstream: false,
      retryable: false,
    };
  }
  if (response.status === 401) {
    return {
      message: 'Your session has expired. Sign in again to keep asking.',
      upstream: false,
      retryable: false,
    };
  }
  if (response.status === 429) {
    return {
      message: 'Too many requests just now. Wait a moment and try again.',
      upstream: false,
      retryable: true,
    };
  }
  if (code === 'upstream_error' || response.status === 502) {
    return {
      message:
        'The model provider did not respond. Retrieval is unaffected, so the documents ' +
        'that were found are listed and still open to read.',
      upstream: true,
      retryable: true,
    };
  }

  return {
    message: body.error?.message ?? 'Something went wrong. Try asking again.',
    upstream: false,
    retryable: true,
  };
}

async function post<T>(path: string, body: unknown, signal: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) throw new RequestFailed(await readFailure(response));

  return (await response.json()) as T;
}

export interface SearchResponse {
  results: Array<ChatSource & { chunkId: string; content: string }>;
  /** Admin only, so absent for a regular user rather than null. */
  nearestDistance?: number | null;
  timings?: { embedMs: number; searchMs: number };
}

/** Stage one. Returns the passages a question retrieves, before any model is asked. */
export async function searchFor(
  query: string,
  signal: AbortSignal,
): Promise<{ sources: ChatSource[]; retrievalMs: number | null }> {
  const result = await post<SearchResponse>('/api/search', { query, limit: 8 }, signal);

  return {
    sources: result.results,
    // Null for a regular user, who is not sent timings. The interface says "retrieved
    // four documents" without a duration rather than inventing one.
    retrievalMs: result.timings ? result.timings.embedMs + result.timings.searchMs : null,
  };
}

/**
 * Stage two. Returns the answer, its coverage, and the citations that survived checking.
 *
 * `conversationId` is null for the first question of a new conversation, and the id comes
 * back on the answer, which is how the browser learns what it is now in.
 */
export async function askFor(
  question: string,
  conversationId: string | null,
  /** When this question replaces an earlier one, the position it replaces from. */
  replaceFromPosition: number | null,
  signal: AbortSignal,
): Promise<ChatAnswer & { conversationId: string }> {
  return post<ChatAnswer & { conversationId: string }>(
    '/api/ask',
    { question, conversationId, replaceFromPosition },
    signal,
  );
}

/** Reads one document for the panel. */
export async function fetchDocument(path: string, signal: AbortSignal): Promise<DocumentDetail> {
  const response = await fetch(`/api/documents?path=${encodeURIComponent(path)}`, { signal });

  if (!response.ok) throw new RequestFailed(await readFailure(response));

  return (await response.json()) as DocumentDetail;
}
