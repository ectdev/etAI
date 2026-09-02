import { z } from 'zod';

/**
 * What happened to a question, in one field.
 *
 * Four values, because four things can happen and each one deserves a different reply:
 *
 * - `full`: the documents answer it.
 * - `partial`: they discuss the subject without containing the fact asked for. Six client
 *   briefs name ironSource as a target network and no document specifies anything about
 *   it, so a question about its file size retrieves confidently and cannot be answered.
 *   Treating that as a flat refusal throws away something true.
 * - `not_documented`: a fair question about this studio that nobody wrote down, such as a
 *   leave policy. The honest reply says so.
 * - `out_of_scope`: not about this collection at all. The useful reply says what the
 *   collection is for.
 *
 * This was two fields, a three-value coverage and a three-value reason, which multiply out
 * to nine combinations of which four mean anything. `full` with `out_of_scope` was
 * representable and meaningless. Collapsing them makes the states that cannot happen
 * impossible to write down rather than merely unlikely to be written.
 */
export const coverageSchema = z.enum(['full', 'partial', 'not_documented', 'out_of_scope']);
export type Coverage = z.infer<typeof coverageSchema>;

/**
 * Whether this coverage carries an answer.
 *
 * Every surface needs this test, and every surface spelling it out is how one of them ends
 * up disagreeing with the others about whether `partial` counts.
 */
export function isAnswered(coverage: Coverage): boolean {
  return coverage === 'full' || coverage === 'partial';
}

/**
 * A citation as the model produces it.
 *
 * The path is the only identifier that crosses the model boundary, because it is what
 * the model can see in the context and copy. Asking it for a database id would be asking
 * it to transcribe a UUID correctly every time, and a mistyped UUID is a citation that
 * looks real and points nowhere.
 *
 * `documentPath` is checked against what was actually retrieved before the answer is
 * returned, so a path the model invented never reaches the reader.
 */
export const citationSchema = z.object({
  documentPath: z.string().min(1),
  /**
   * The sentence or two the claim rests on. A quote makes the citation checkable without
   * opening the document, and a quote that does not support the claim is visible where a
   * bare path would not be.
   */
  quote: z.string().min(1),
});
export type Citation = z.infer<typeof citationSchema>;

/**
 * A citation as a reader receives it.
 *
 * Everything the model did not provide is worked out from the retrieved set: the number
 * shown beside the claim, the id that opens the document, and its title. None of it can
 * be invented, because none of it came from the answer.
 *
 * `sourceNumber` is one based and points into `sources`, which is what lets an interface
 * show the same number on a claim and on the card it refers to. Matching on path instead
 * would break the moment one document supplies two citations.
 */
export const linkedCitationSchema = citationSchema.extend({
  sourceNumber: z.number().int().positive(),
  documentId: z.string(),
  title: z.string(),
});
export type LinkedCitation = z.infer<typeof linkedCitationSchema>;

/**
 * How a claim inside the answer text points at the document behind it.
 *
 * The number is the document's position in the context the model was given, which is the
 * same number `sourceNumber` carries above. One number therefore identifies a claim, a
 * citation and a source card, and none of it is trusted: every marker is checked against
 * the retrieved set before a reader sees it.
 *
 * The syntax lives here, once, because two packages read it. `@etai/core` checks markers
 * and `apps/web` renders them as buttons. Two spellings of one syntax is how those halves
 * come to disagree quietly, with the interface showing a chip the check never examined.
 */
export const CITATION_MARKER = /\[\d+(?:\s*,\s*\d+)*\]/;

/**
 * A run of answer text, or a marker standing between two of them.
 *
 * A marker carries a list rather than a number because one claim can rest on two
 * documents, and asked to mark its claims the model writes `[1, 7]` for those. The list
 * keeps them grouped so the answer can be repaired without being rewritten: if one of the
 * two numbers points nowhere, that number is removed and the other stays where it is.
 */
export type CitationSegment =
  { kind: 'text'; text: string } | { kind: 'marker'; numbers: number[] };

/** Writes a group of numbers back out in the form the model wrote them. */
function marker(numbers: number[]): string {
  return `[${numbers.join(', ')}]`;
}

/**
 * Splits answer text into prose and markers, keeping both.
 *
 * Empty runs are never emitted, so a marker at the start or end of a paragraph does not
 * produce a blank segment beside it.
 */
export function splitOnCitationMarkers(text: string): CitationSegment[] {
  const segments: CitationSegment[] = [];
  let cursor = 0;

  for (const match of text.matchAll(new RegExp(CITATION_MARKER.source, 'g'))) {
    if (match.index > cursor)
      segments.push({ kind: 'text', text: text.slice(cursor, match.index) });

    // The brackets are the syntax and the digits are the value, so the numbers are read
    // off the matched text rather than from capture groups that have to stay in step
    // with it. A repeated number inside one group is kept: it is what the model wrote.
    const numbers = match[0]
      .slice(1, -1)
      .split(',')
      .map((digits) => Number.parseInt(digits.trim(), 10));

    segments.push({ kind: 'marker', numbers });
    cursor = match.index + match[0].length;
  }

  if (cursor < text.length) segments.push({ kind: 'text', text: text.slice(cursor) });

  return segments;
}

/**
 * Every number written as a marker, in the order they appear.
 *
 * Flattened across groups, because each number in `[1, 7]` is a claim about a different
 * document and each has to be checked on its own. A number used twice is counted twice.
 */
export function citationMarkers(text: string): number[] {
  return splitOnCitationMarkers(text).flatMap((segment) =>
    segment.kind === 'marker' ? segment.numbers : [],
  );
}

/**
 * Removes the named numbers from the markers, leaving the sentence around them readable.
 *
 * A group loses only the numbers named: `[1, 7]` with 7 removed becomes `[1]`, because
 * the claim still rests on document 1 and deleting the whole marker would take a good
 * reference away with the bad one. A group that loses all of its numbers goes entirely.
 *
 * Deleting `[9]` from "the limit is 5 MB [9]." leaves a space in front of the full stop,
 * and a reader notices that before they notice the missing marker. So the space directly
 * in front of a removed marker goes too, but only when what follows is punctuation,
 * another space, or the end of the text. A wider tidy-up would risk reformatting a code
 * sample the answer had quoted, which is a worse outcome than an odd space.
 */
export function removeCitationMarkers(text: string, numbers: ReadonlySet<number>): string {
  if (numbers.size === 0) return text;

  const segments = splitOnCitationMarkers(text);
  let kept = '';

  for (const [index, segment] of segments.entries()) {
    if (segment.kind === 'text') {
      kept += segment.text;
      continue;
    }

    const surviving = segment.numbers.filter((number) => !numbers.has(number));

    if (surviving.length > 0) {
      kept += marker(surviving);
      continue;
    }

    const next = segments[index + 1];
    // A marker following this one keeps the space: "a [9][2]" has to stay "a [2]".
    const following = next?.kind === 'text' ? next.text : '';

    if (kept.endsWith(' ') && (next === undefined || /^[\s.,;:!?)\]]/.test(following))) {
      kept = kept.slice(0, -1);
    }
  }

  return kept;
}

/**
 * A rule the answer broke on its way out.
 *
 * These are relationships between fields that are each individually valid, so nothing
 * here is a parse failure and nothing here throws. Two kinds, and the difference decides
 * what happens rather than only how it reads:
 *
 * - `marker_out_of_range` points at a document that was never retrieved. That would
 *   mislead a reader, so the marker is removed from the text.
 * - Every other rule is incoherent without misleading anyone. The answer is left exactly
 *   as written and the count is what carries the problem.
 *
 * How many markers were stripped is not stored separately, because it is the count of
 * `marker_out_of_range`. Two fields holding one number is how a summary line and the
 * table beneath it come to disagree.
 *
 * Two rules that were proposed and are deliberately not here.
 *
 * Citation numbers running contiguously from 1 would reject correct answers. A number is
 * a document's position among the retrieved set rather than a citation ordinal, so an
 * answer that uses only the sixth document correctly carries the single citation 6. That
 * is measured rather than argued: the ironSource question does exactly this on every run.
 *
 * Citation numbers falling inside the retrieved range cannot be violated. `linkCitations`
 * derives every number from a position in that set, so a rule for it would be a check
 * that can never fail, which is worse than no check because it looks like protection.
 */
export const coherenceRuleSchema = z.enum([
  'marker_out_of_range',
  'marker_not_cited',
  'marker_in_refusal',
  'answered_without_citation',
  'citation_in_refusal',
  'duplicate_citation',
  /**
   * The citation named a document it was given, and quoted something not in it.
   *
   * Found live: the model quoted a line from the metadata block above the document text,
   * which is text this project writes rather than anything in the file. The citation
   * still points at the right document, so it is kept and the quote is dropped, and the
   * panel then opens the document from the top instead of showing a sentence that does
   * not exist in it.
   */
  'quote_not_in_document',
]);
export type CoherenceRule = z.infer<typeof coherenceRuleSchema>;

export const coherenceViolationSchema = z.object({
  rule: coherenceRuleSchema,
  count: z.number().int().positive(),
});
export type CoherenceViolation = z.infer<typeof coherenceViolationSchema>;

/** What the model is asked to produce. Anything else is a failure to parse, not an answer. */
export const groundedAnswerSchema = z.object({
  answer: z.string(),
  citations: z.array(citationSchema),
  coverage: coverageSchema,
  /**
   * What is missing, when something is. This is the field that makes a partial answer
   * useful: naming the gap tells the reader what to go and find elsewhere.
   */
  gap: z.string().nullable(),
});
export type GroundedAnswer = z.infer<typeof groundedAnswerSchema>;

/** A source the answer was allowed to draw on, as it is sent to a client. */
export const answerSourceSchema = z.object({
  documentId: z.string(),
  path: z.string(),
  title: z.string(),
  headingPath: z.string().nullable(),
  docType: z.string(),
  temporalDate: z.string().nullable(),
  isDeprecated: z.boolean(),
  supersededByPath: z.string().nullable(),
  /** Cosine distance from the question. Null when only keyword search found it. */
  distance: z.number().nullable(),
});
export type AnswerSource = z.infer<typeof answerSourceSchema>;

/** The whole response, after the answer has been checked against its sources. */
export const answerResponseSchema = z.object({
  answer: z.string(),
  /** Linked rather than raw: by this point every citation carries a number and an id. */
  citations: z.array(linkedCitationSchema),
  coverage: coverageSchema,
  gap: z.string().nullable(),
  sources: z.array(answerSourceSchema),
  /** Citations the model produced that named something it was not given. */
  droppedCitations: z.array(z.string()),
  /** Rules the answer broke. Empty is the ordinary case, and it is empty by measurement. */
  coherence: z.array(coherenceViolationSchema),
  timings: z.object({
    retrievalMs: z.number(),
    generationMs: z.number(),
  }),
  model: z.string(),
  /**
   * True when the embedding provider was unavailable and only keyword search ran.
   *
   * Sent to every role, unlike the distances and timings beside it. This is not diagnostic
   * detail: it changes how much weight the answer deserves, and a reader who is not told
   * has no way to tell a degraded answer from a good one.
   */
  degraded: z.boolean().optional(),
});
export type AnswerResponse = z.infer<typeof answerResponseSchema>;

/** What a client may ask for. Both the chat page and the MCP tool validate against this. */
export const askSchema = z.object({
  question: z
    .string()
    .trim()
    .min(3, 'Ask a question with at least three characters')
    .max(500, 'Questions are limited to 500 characters'),

  /**
   * Which conversation this belongs to, absent for the first question of a new one.
   *
   * A uuid rather than any string, so a malformed value is refused here instead of
   * reaching a query. One that is real but belongs to somebody else is not a validation
   * problem and is handled where the owner is known.
   */
  conversationId: z.uuid().nullish(),

  /**
   * When this question replaces an earlier one, the position it replaces from.
   *
   * Editing a question rewinds the conversation to that point: that turn and everything
   * after it are removed, and the edited question is asked as if it were new. Keeping the
   * old answer would leave an answer to a question that is no longer on the page.
   */
  replaceFromPosition: z.number().int().min(0).nullish(),
});
export type AskInput = z.infer<typeof askSchema>;

/** What a plain search asks for, without generating an answer. */
export const searchInputSchema = z.object({
  query: z
    .string()
    .trim()
    .min(2, 'Search for at least two characters')
    .max(500, 'Searches are limited to 500 characters'),
  limit: z.coerce.number().int().min(1).max(20).default(8),
  docType: z.string().min(1).max(50).optional(),
});
export type SearchInput = z.infer<typeof searchInputSchema>;

/**
 * What identifies a document to fetch.
 *
 * The path is a database key rather than a filesystem path, so a value like
 * `../../etc/passwd` matches no row instead of escaping anywhere, and this schema is
 * about keeping the input a sane size rather than about traversal. The lookup is what
 * makes traversal impossible, and it is written that way on purpose; a validator here
 * would be a second line of defence that invites somebody to relax the first.
 */
export const documentPathSchema = z.object({
  path: z
    .string()
    .trim()
    .min(1, 'Give the path of a document')
    .max(400, 'That is longer than any path in the collection'),
});
export type DocumentPathInput = z.infer<typeof documentPathSchema>;

/**
 * Whether a quote can be located in a piece of text.
 *
 * One implementation, because two surfaces ask the same question for different reasons
 * and an answer that differs between them is the defect. The generation gate asks it to
 * decide whether a citation's quote is real before the answer is sent. The chat panel
 * asks it to decide which paragraph to open on. If the gate were stricter than the panel,
 * quotes would be blanked that the panel could have found; if it were looser, the panel
 * would open at the top on a quote the gate had just called good.
 *
 * Matched on a normalised prefix rather than on the whole quote, because a model quotes
 * the sentence it used and may stop mid-clause or fix the spacing. Short quotes are
 * rejected outright: below about a dozen characters a match says nothing, and "Status:"
 * appears in half the collection.
 */
export function quoteAppearsIn(haystack: string, quote: string | undefined): boolean {
  if (!quote) return false;

  const needle = normaliseForQuote(quote);
  if (needle.length < 12) return false;

  const text = normaliseForQuote(haystack);
  return text.includes(needle) || text.includes(needle.slice(0, 40));
}

/** Collapses the differences a model introduces when it copies a sentence out. */
export function normaliseForQuote(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}
