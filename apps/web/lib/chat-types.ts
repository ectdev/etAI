import {
  normaliseForQuote,
  quoteAppearsIn,
  splitOnCitationMarkers,
  type Coverage,
  type LinkedCitation,
} from '@etai/shared';

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

/**
 * A run of answer text, or a citation chip standing where a marker was.
 *
 * A chip carries its citation rather than possibly carrying one. A chip without a
 * citation is a button that opens nothing, and the way to make sure it never renders is
 * to make it impossible to build rather than to check for it at every use.
 */
export type Segment =
  { kind: 'text'; text: string } | { kind: 'chip'; number: number; citation: LinkedCitation };

/**
 * Splits an answer into paragraphs and citation chips.
 *
 * The marker syntax is not spelled out here. It comes from `@etai/shared`, which is also
 * where the server reads it when it checks that every marker resolves to a document that
 * was actually retrieved. Both halves have to agree about what a marker is, and the way
 * to guarantee that is one implementation rather than two that look alike.
 *
 * The numbering comes from the API, worked out from the retrieved set rather than from
 * anything the model counted, so this function looks a number up and never assigns one. A
 * marker whose number has no citation stays as text: dropping it would silently edit the
 * answer, and a reader who sees `[4]` beside three sources has learned something true.
 */
export function parseAnswer(text: string, citations: LinkedCitation[]): Segment[][] {
  const byNumber = new Map(citations.map((citation) => [citation.sourceNumber, citation]));

  return text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0)
    .map((paragraph) =>
      splitOnCitationMarkers(paragraph).flatMap((segment): Segment[] => {
        if (segment.kind === 'text') return [segment];

        /**
         * One chip per number, so a claim resting on two documents offers a way into
         * each of them rather than one button that has to choose. A number with no
         * citation behind it stays as text in the shape the model wrote it, which keeps
         * a half-resolved group honest: `[1, 7]` with only 1 cited renders as a chip for
         * 1 and the text `[7]`, rather than quietly claiming both were used.
         */
        return segment.numbers.map((number) => {
          const citation = byNumber.get(number);

          return citation
            ? { kind: 'chip', number, citation }
            : { kind: 'text', text: `[${number}]` };
        });
      }),
    );
}

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

/**
 * Finds the paragraph a quote came from, so the panel can open on it.
 *
 * Matched on a normalised prefix rather than on the whole quote, because a model quotes
 * the sentence it used and may stop mid-clause or fix the spacing. Returns -1 when
 * nothing matches, and the panel then shows the document from the top, which is the
 * right outcome: guessing a paragraph would point a reader at the wrong sentence with
 * the same confidence as pointing them at the right one.
 */
export function findQuotedParagraph(paragraphs: string[], quote: string | undefined): number {
  if (!quote) return -1;

  // Exact containment first, so a quote appearing in two paragraphs opens on the one that
  // holds all of it rather than on an earlier one that happens to share its first words.
  const exact = paragraphs.findIndex(
    (paragraph) =>
      normaliseForQuote(paragraph).includes(normaliseForQuote(quote)) && quote.length >= 12,
  );
  if (exact !== -1) return exact;

  return paragraphs.findIndex((paragraph) => quoteAppearsIn(paragraph, quote));
}
