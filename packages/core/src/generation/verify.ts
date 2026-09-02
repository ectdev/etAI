import {
  citationMarkers,
  isAnswered,
  quoteAppearsIn,
  removeCitationMarkers,
  type Citation,
  type CoherenceRule,
  type CoherenceViolation,
  type GroundedAnswer,
} from '@etai/shared';
import { firstIndexByPath } from './cite.js';

export interface VerifiedAnswer extends GroundedAnswer {
  /** Paths the model cited that it was not given. */
  droppedCitations: string[];
  /** Rules the answer broke. Empty in the ordinary case. */
  coherence: CoherenceViolation[];
}

/** Drops the rules that did not fire, so an empty list means an answer with nothing wrong. */
function violations(counts: Array<[CoherenceRule, number]>): CoherenceViolation[] {
  return counts.filter(([, count]) => count > 0).map(([rule, count]) => ({ rule, count }));
}

/**
 * Checks an answer against the documents it was allowed to see.
 *
 * A model asked to cite its sources will occasionally cite something plausible that it
 * was never given. A citation that looks right is worse than no citation, because a
 * reader has no way to tell the difference. The prompt asks the model not to do this and
 * this check enforces it, which is a different kind of guarantee: one is a request, the
 * other is a comparison against a list.
 *
 * A citation naming a path outside the retrieved set is removed and recorded. Recording
 * rather than silently discarding matters, because a rise in dropped citations is a
 * signal about the model or the prompt that would otherwise be invisible.
 *
 * The same question is asked of the markers written into the answer text. Until the
 * prompt started asking for markers there was one record of which documents an answer
 * used; now there are two, and two records can disagree while each looks fine on its own.
 * A marker pointing outside the retrieved set is removed, because a reference a reader
 * cannot follow is worse on every surface than no reference. A marker pointing at a
 * retrieved document the answer did not cite is left exactly where it is and counted:
 * it is incoherent without being misleading, and the interface already renders an
 * unresolvable marker as plain text.
 *
 * Nothing here throws. An answer that is right about most of what it says should reach
 * the reader with the wrong part removed, not be replaced by an error.
 *
 * `retrievedPaths` is ordered, and the order is what makes a marker mean something: the
 * documents are numbered for the model in the same order they appear here.
 */
export function verifyAnswer(
  answer: GroundedAnswer,
  retrievedPaths: string[],
  /**
   * The text the model was actually shown, by path, so a quote can be checked against it.
   *
   * Optional because most of the unit tests below are about which citations survive and
   * have no text to give. Production always passes it, and `wiring.test.ts` fails if that
   * call ever loses the argument, because a check this easy to drop silently is worth
   * one static assertion.
   */
  contentByPath?: ReadonlyMap<string, string>,
): VerifiedAnswer {
  const allowed = new Set(retrievedPaths);

  const kept: Citation[] = [];
  const dropped: string[] = [];

  for (const citation of answer.citations) {
    if (allowed.has(citation.documentPath)) {
      kept.push(citation);
    } else {
      dropped.push(citation.documentPath);
    }
  }

  // Read before anything below blanks or rewrites the text. A refusal loses its answer
  // entirely, so a marker inside one is only ever observable at this point.
  const markers = citationMarkers(answer.answer);

  /**
   * A refusal has nothing to cite by definition, and any citation attached to one is
   * noise at best.
   *
   * A marker in a refusal is more than noise. It means the instruction to mark claims
   * reached a reply that has no claims, which is the same shape as the retirement warning
   * turning up in an answer with nothing retired in front of it. The text goes, so the
   * count is the only thing that can report it.
   */
  if (!isAnswered(answer.coverage)) {
    return {
      ...answer,
      answer: '',
      citations: [],
      droppedCitations: dropped,
      coherence: violations([
        ['marker_in_refusal', markers.length],
        // Counted here for the same reason: the citations are about to be discarded, so
        // this is the last point at which anybody can see the model attached them.
        ['citation_in_refusal', answer.citations.length],
      ]),
    };
  }

  /**
   * An answer that claims to cover the question but has nothing left to point at is
   * demoted rather than shown.
   *
   * This is the case that matters most: every citation was invented, so the text reads as
   * a confident answer with no support behind it at all. Presenting that with the
   * citations quietly stripped would be the worst outcome available.
   *
   * Its markers are not counted. The text is being withdrawn for a reason already
   * recorded in `droppedCitations`, and marks inside withdrawn text say nothing about
   * whether the marker instruction is working.
   */
  if (kept.length === 0 && dropped.length > 0) {
    return {
      ...answer,
      answer: '',
      citations: [],
      coverage: 'not_documented',
      gap:
        answer.gap ??
        'The answer could not be traced back to any of the retrieved documents, so it is not shown.',
      droppedCitations: dropped,
      coherence: [],
    };
  }

  /**
   * The numbers a marker is allowed to carry.
   *
   * Taken from the same rule that assigns `sourceNumber` rather than worked out again
   * here, so the gate cannot accept a number the reader's interface then fails to
   * resolve. With one chunk per document these are simply the positions of the cited
   * documents; the derivation matters the moment a document contributes two chunks,
   * because then its second position is a number no citation will ever carry.
   */
  const firstIndex = firstIndexByPath(retrievedPaths);
  const cited = new Set<number>();

  for (const citation of kept) {
    const index = firstIndex.get(citation.documentPath);
    if (index !== undefined) cited.add(index + 1);
  }

  const outOfRange = markers.filter((number) => number < 1 || number > retrievedPaths.length);
  const notCited = markers.filter(
    (number) => number >= 1 && number <= retrievedPaths.length && !cited.has(number),
  );

  /**
   * The same document quoted twice in exactly the same words.
   *
   * A duplicate is defined as the path and the quote both repeating, not the path alone.
   * One document supporting two different claims with two different sentences is correct
   * and common here, and a rule that flagged it would fire on good answers, which is the
   * failure this whole gate is written to avoid. An identical pair carries no second
   * piece of information and is the only version that is genuinely a defect.
   */
  const seen = new Set<string>();
  let duplicates = 0;

  for (const citation of kept) {
    const key = JSON.stringify([citation.documentPath, citation.quote]);
    if (seen.has(key)) duplicates += 1;
    else seen.add(key);
  }

  /**
   * A quote that is not in the document it claims to come from.
   *
   * The citation is kept, because the document is the right one and dropping it would
   * throw away a correct reference over a bad excerpt. The quote goes, because a quote is
   * the one part of a citation a reader checks without leaving the page, and showing one
   * that is not in the file is worse than showing none.
   */
  let quotesNotFound = 0;

  const checked = contentByPath
    ? kept.map((citation) => {
        const content = contentByPath.get(citation.documentPath);
        if (content === undefined || quoteAppearsIn(content, citation.quote)) return citation;

        quotesNotFound += 1;
        return { ...citation, quote: '' };
      })
    : kept;

  return {
    ...answer,
    answer: removeCitationMarkers(answer.answer, new Set(outOfRange)),
    citations: checked,
    droppedCitations: dropped,
    coherence: violations([
      ['marker_out_of_range', outOfRange.length],
      ['marker_not_cited', notCited.length],
      ['quote_not_in_document', quotesNotFound],
      /**
       * An answer that covers the question and points at nothing.
       *
       * Distinct from the demotion above, which fires when every citation named a
       * document that was not retrieved. This is the model answering and citing nothing
       * at all, which the schema permits and which reads on screen as a confident answer
       * with an empty source list beside it. Left intact rather than withheld: the text
       * may well be correct, and a reader who can see it has no citations knows more than
       * a reader given a refusal.
       */
      ['answered_without_citation', kept.length === 0 && dropped.length === 0 ? 1 : 0],
      ['duplicate_citation', duplicates],
    ]),
  };
}

/**
 * The reply given when a question is turned away before any model is asked.
 *
 * Written here rather than at the point of refusal so that the chat page, the API and the
 * MCP tool all say the same thing.
 */
export function outOfScopeAnswer(): VerifiedAnswer {
  return {
    answer: '',
    citations: [],
    coverage: 'out_of_scope',
    gap: 'This question is outside what the indexed documents cover. They describe how one company runs a continuous integration platform: the per provider runner specifications, the pipeline configuration schema, the build agent, the secrets and cache rules, and the reports and notes from its customer migrations.',
    droppedCitations: [],
    coherence: [],
  };
}

/**
 * The refusal given when search itself was not working, rather than when the collection
 * has nothing to say.
 *
 * These two look identical on screen and mean opposite things. Without this, an embedding
 * outage produced the sentence above: "this question is outside what the indexed
 * documents cover", about a question the corpus answers plainly. The system was wrong
 * about its own contents, confidently, and the reader had no way to know.
 *
 * Coverage stays `out_of_scope` because there is no fifth value and inventing one would
 * touch the schema, the prompt and both surfaces to describe a state that exists only
 * during an outage. The gap carries the truth instead, and `degraded` on the response
 * carries it to the interface, which shows it beside the coverage badge.
 */
export function degradedNoResultsAnswer(): VerifiedAnswer {
  return {
    answer: '',
    citations: [],
    coverage: 'out_of_scope',
    gap: 'Semantic search is unavailable at the moment, so only keyword matching ran, and it found nothing for this question. That is a statement about the search rather than about the documents: the answer may well be in the collection. Trying again later, or rewording the question to use terms that would appear in a document, is worth doing.',
    droppedCitations: [],
    coherence: [],
  };
}
