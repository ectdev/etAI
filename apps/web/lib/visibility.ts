import type { AnswerResponse } from '@etai/shared';

/**
 * What each role is allowed to see of a result.
 *
 * A cosine distance means nothing to somebody looking for a document, and printing one
 * next to every source turns a search tool into a debug view. The numbers still matter to
 * whoever is inspecting the system, which is what the admin role is for.
 *
 * The cut is made here, on the server, rather than in the interface. A field sent to the
 * browser and hidden with CSS is a field that has been disclosed: it is in the network
 * tab, in the page source, and in anything that logs a response. Hiding is not the same
 * as withholding.
 *
 * The coverage value stays visible to everyone. It is the answer's own status, not
 * diagnostic detail: whether the collection covered a question is the thing the reader
 * most needs to know about the answer they are reading.
 */

/** A source as a regular user receives it: enough to recognise and open a document. */
export interface PublicSource {
  documentId: string;
  path: string;
  title: string;
  headingPath: string | null;
  docType: string;
  temporalDate: string | null;
  isDeprecated: boolean;
  supersededByPath: string | null;
  /** Present for an admin only. */
  distance?: number | null;
  /** Present for an admin only. */
  score?: number;
}

function publicSource(
  source: {
    documentId: string;
    path: string;
    title: string;
    headingPath: string | null;
    docType: string;
    temporalDate: string | null;
    isDeprecated: boolean;
    supersededByPath: string | null;
    distance?: number | null;
    score?: number;
  },
  isAdmin: boolean,
): PublicSource {
  const visible: PublicSource = {
    documentId: source.documentId,
    path: source.path,
    title: source.title,
    headingPath: source.headingPath,
    docType: source.docType,
    temporalDate: source.temporalDate,
    isDeprecated: source.isDeprecated,
    supersededByPath: source.supersededByPath,
  };

  if (!isAdmin) return visible;

  return {
    ...visible,
    distance: source.distance ?? null,
    ...(source.score === undefined ? {} : { score: source.score }),
  };
}

export interface PublicSearchResult {
  results: Array<PublicSource & { chunkId: string; content: string }>;
  /**
   * Sent to every role, unlike the numbers below it.
   *
   * The rest of this file withholds diagnostics because they help nobody choose a
   * document. This one is not a diagnostic. It says the search that produced these
   * results was the keyword half working alone, which changes what the results are worth,
   * and withholding it would leave a reader unable to tell a degraded answer from a good
   * one. Absent when the search was normal, so the ordinary payload does not grow.
   */
  degraded?: boolean;
  nearestDistance?: number | null;
  timings?: { embedMs: number; searchMs: number };
}

/** Trims a search result to what the role may see. */
export function searchForRole(
  result: {
    chunks: Array<
      Parameters<typeof publicSource>[0] & { chunkId: string; content: string; score: number }
    >;
    nearestDistance: number | null;
    timings: { embedMs: number; searchMs: number };
    degraded: boolean;
  },
  isAdmin: boolean,
): PublicSearchResult {
  const results = result.chunks.map((chunk) => ({
    ...publicSource(chunk, isAdmin),
    chunkId: chunk.chunkId,
    content: chunk.content,
  }));

  const degraded = result.degraded ? { degraded: true as const } : {};

  if (!isAdmin) return { results, ...degraded };

  return { results, ...degraded, nearestDistance: result.nearestDistance, timings: result.timings };
}

export interface PublicAnswer {
  answer: string;
  coverage: AnswerResponse['coverage'];
  gap: string | null;
  citations: AnswerResponse['citations'];
  sources: PublicSource[];
  /** Sent to every role. See the note on PublicSearchResult. */
  degraded?: boolean;
  /** Present for an admin only. */
  droppedCitations?: string[];
  timings?: AnswerResponse['timings'];
  model?: string;
}

/**
 * Trims an answer to what the role may see.
 *
 * `droppedCitations` goes with the timings rather than with the answer. It is a count of
 * how often the model cited something it was not given, which is a measurement of the
 * system rather than information about this answer, and it is empty in normal operation.
 */
export function answerForRole(result: AnswerResponse, isAdmin: boolean): PublicAnswer {
  const visible: PublicAnswer = {
    answer: result.answer,
    coverage: result.coverage,
    gap: result.gap,
    citations: result.citations,
    sources: result.sources.map((source) => publicSource(source, isAdmin)),
    ...(result.degraded ? { degraded: true } : {}),
  };

  if (!isAdmin) return visible;

  return {
    ...visible,
    droppedCitations: result.droppedCitations,
    timings: result.timings,
    model: result.model,
  };
}
