import { isAnswered, type Coverage, type LinkedCitation } from '@etai/shared';

/**
 * A source as the browser receives it.
 *
 * The distance is optional because it is not sent to a regular user. That is a server
 * decision, and the type says so rather than leaving the interface to guess whether a
 * missing number means "not retrieved by vector search" or "not allowed to see it".
 */
export interface ChatSource {
  documentId: string;
  path: string;
  title: string;
  headingPath: string | null;
  docType: string;
  temporalDate: string | null;
  isDeprecated: boolean;
  supersededByPath: string | null;
  distance?: number | null;
}

/** An answer as the browser receives it. Timings and the model name are admin only. */
export interface ChatAnswer {
  answer: string;
  /**
   * Null when nothing was retrieved because nothing needed to be.
   *
   * A greeting is answered without consulting a document, so there is no coverage to
   * report and the badge is not rendered. Reporting `out_of_scope` for "hello" would be
   * technically true and would count a pleasantry as a question the corpus failed.
   */
  coverage: Coverage | null;
  gap: string | null;
  citations: LinkedCitation[];
  sources: ChatSource[];
  /** True when the embedding provider was down and only keyword search ran. */
  degraded?: boolean;
  /** True when the keyword query failed and only vector search ran. */
  keywordUnavailable?: boolean;
  /** False when the answer could not be stored in the conversation. Absent when it was. */
  saved?: false;
  droppedCitations?: string[];
  timings?: { retrievalMs: number; generationMs: number };
  model?: string;
}

/**
 * What the chat screen holds for one exchange.
 *
 * A turn moves through four states and the interface shows a different thing in each.
 * `retrieving` is the gap the two stage flow creates: search has been asked and has not
 * answered, so there is nothing to show but the fact that it is happening. `sourced` is
 * the point of splitting the request in two, because the documents are known and the
 * answer is not.
 */
export type TurnPhase = 'retrieving' | 'sourced' | 'answered' | 'failed';

export interface Turn {
  id: string;
  question: string;
  phase: TurnPhase;
  /** Known once retrieval returns, which is before the answer exists. */
  sources: ChatSource[];
  retrievalMs: number | null;
  answer: ChatAnswer | null;
  /** Set when a request failed rather than when the collection could not answer. */
  error: { message: string; upstream: boolean; retryable: boolean } | null;
}

/**
 * The sources the side panel may show for a turn.
 *
 * The panel numbers its cards to match the citation chips, so it belongs beside an answer
 * that can cite. Before the answer exists it shows what retrieval found, which is the
 * reason sources are fetched first. Once a refusal arrives there is nothing to number:
 * the documents retrieved for "write me a C++ function" are merely the nearest of an
 * unrelated lot, and eight of them under "numbers match the citations in the answer"
 * claimed a link that was never there. The folded list inside the turn still shows them,
 * as what was retrieved, which is true.
 */
export function panelSources(turn: Pick<Turn, 'sources' | 'answer'>): ChatSource[] {
  if (!turn.answer) return turn.sources;
  const { coverage } = turn.answer;
  return coverage !== null && isAnswered(coverage) ? turn.sources : [];
}

/** The four coverage values, as the interface presents them. */
export const COVERAGE_LABEL: Record<Coverage, string> = {
  full: 'Answered from the corpus',
  partial: 'Partially covered',
  not_documented: 'Not documented',
  out_of_scope: 'Outside this collection',
};

/**
 * The glyph inside the coverage badge.
 *
 * A filled circle for a full answer, a half circle for a partial one, an empty circle
 * for something the collection does not document, and a struck circle for a question
 * that is not about it. None of them is a warning mark, because none of these four is a
 * failure: refusing correctly is the system working.
 */
export const COVERAGE_GLYPH: Record<Coverage, { fill: string; slash: string }> = {
  full: { fill: 'M12 7a5 5 0 0 1 0 10 5 5 0 0 1 0-10z', slash: '' },
  partial: { fill: 'M12 7a5 5 0 0 1 0 10z', slash: '' },
  not_documented: { fill: '', slash: '' },
  out_of_scope: { fill: '', slash: 'M7.5 16.5L16.5 7.5' },
};

/** A document as the panel receives it. */
export interface DocumentDetail {
  path: string;
  title: string;
  docType: string;
  content: string;
  temporalDate: string | null;
  temporalPrecision: 'day' | 'month' | null;
  project: string | null;
  isDeprecated: boolean;
  supersededByPath: string | null;
  indexedAt: string | null;
}
