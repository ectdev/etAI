import { describe, expect, it } from 'vitest';
import type { AnswerSource, GroundedAnswer } from '@etai/shared';
import { linkCitations } from './cite.js';
import { outOfScopeAnswer, verifyAnswer } from './verify.js';

const source = (path: string): AnswerSource => ({
  documentId: `id-${path}`,
  path,
  title: `Title of ${path}`,
  headingPath: null,
  docType: 'reference',
  temporalDate: null,
  isDeprecated: false,
  supersededByPath: null,
  distance: 0.2,
});

const answer = (overrides: Partial<GroundedAnswer> = {}): GroundedAnswer => ({
  answer: 'The limit is 5 MB.',
  citations: [{ documentPath: 'runner-specs-aws.md', quote: 'Maximum file size: 5 MB.' }],
  coverage: 'full',
  gap: null,
  ...overrides,
});

const RETRIEVED = ['runner-specs-aws.md', 'release-checklist.md'];

describe('verifyAnswer', () => {
  it('keeps a citation that names a document the model was given', () => {
    const result = verifyAnswer(answer(), RETRIEVED);

    expect(result.citations).toHaveLength(1);
    expect(result.droppedCitations).toEqual([]);
    expect(result.answer).toBe('The limit is 5 MB.');
  });

  it('drops a citation naming a document that was never retrieved', () => {
    // The failure this exists for. A model asked to cite its sources will occasionally
    // name something plausible it was never given, and a citation that looks right is
    // worse than none, because a reader has no way to tell the difference.
    const result = verifyAnswer(
      answer({
        citations: [
          { documentPath: 'runner-specs-aws.md', quote: 'real' },
          { documentPath: 'runner-specs-azure.md', quote: 'invented' },
        ],
      }),
      RETRIEVED,
    );

    expect(result.citations.map((citation) => citation.documentPath)).toEqual([
      'runner-specs-aws.md',
    ]);
    expect(result.droppedCitations).toEqual(['runner-specs-azure.md']);
  });

  it('records what it dropped rather than discarding it quietly', () => {
    // A rise in dropped citations says something about the model or the prompt, and it
    // is invisible if the drop leaves no trace.
    const result = verifyAnswer(
      answer({ citations: [{ documentPath: 'invented.md', quote: 'x' }], coverage: 'partial' }),
      RETRIEVED,
    );

    expect(result.droppedCitations).toEqual(['invented.md']);
  });

  it('withholds an answer whose every citation was invented', () => {
    // The worst case available: confident prose with nothing behind it. Showing it with
    // the citations quietly stripped would be worse than refusing.
    const result = verifyAnswer(
      answer({
        citations: [
          { documentPath: 'made-up-one.md', quote: 'x' },
          { documentPath: 'made-up-two.md', quote: 'y' },
        ],
      }),
      RETRIEVED,
    );

    expect(result.answer).toBe('');
    expect(result.coverage).toBe('not_documented');
    expect(result.citations).toEqual([]);
    expect(result.gap).toBeTruthy();
    expect(result.droppedCitations).toHaveLength(2);
  });

  it('leaves a refusal without citations, whatever the model attached to it', () => {
    const result = verifyAnswer(
      answer({
        coverage: 'not_documented',
        answer: 'There is nothing about this.',
        citations: [{ documentPath: 'runner-specs-aws.md', quote: 'unrelated' }],
      }),
      RETRIEVED,
    );

    expect(result.citations).toEqual([]);
    expect(result.answer).toBe('');
  });

  it('keeps a partial answer that still has something real to point at', () => {
    const result = verifyAnswer(
      answer({
        coverage: 'partial',
        answer: 'The briefs name Azure as a target network.',
        gap: 'No document states its file size limit.',
        citations: [{ documentPath: 'release-checklist.md', quote: 'real quote' }],
      }),
      RETRIEVED,
    );

    expect(result.coverage).toBe('partial');
    expect(result.citations).toHaveLength(1);
    expect(result.gap).toBeTruthy();
  });

  it('accepts an answer with no citations when nothing was retrieved to cite', () => {
    // Not the same as inventing citations, so it is not demoted.
    const result = verifyAnswer(answer({ citations: [], coverage: 'partial' }), RETRIEVED);

    expect(result.coverage).toBe('partial');
    expect(result.droppedCitations).toEqual([]);
  });

  it('does not treat a similar looking path as a match', () => {
    const result = verifyAnswer(
      answer({ citations: [{ documentPath: 'runner-specs-aws.MD', quote: 'x' }] }),
      RETRIEVED,
    );

    expect(result.droppedCitations).toEqual(['runner-specs-aws.MD']);
  });

  it('handles an empty retrieved set', () => {
    const result = verifyAnswer(answer(), []);

    expect(result.coverage).toBe('not_documented');
    expect(result.citations).toEqual([]);
  });
});

/**
 * The markers the model writes into the answer text.
 *
 * Until the prompt asked for them there was one record of which documents an answer used.
 * Now there are two, the markers and the citation list, and two records can disagree
 * while each one looks correct on its own. Nothing throws when they do, so the failure
 * would be a chip pointing at the wrong document, which reads exactly like a chip
 * pointing at the right one.
 *
 * These use text written here rather than model output on purpose: a model will not
 * produce a marker for a document it was never given on demand. The cases that need real
 * output are in `markers.test.ts`, and they exist because the interface's nine parser
 * tests all passed while every one of them supplied its own markers.
 */
describe('the markers inside the answer text', () => {
  it('leaves a correctly marked answer exactly as written', () => {
    // First, because a rule that fires on correct output is worse than no rule.
    const result = verifyAnswer(answer({ answer: 'The limit is 5 MB [1].' }), RETRIEVED);

    expect(result.answer).toBe('The limit is 5 MB [1].');
    expect(result.coherence).toEqual([]);
  });

  it('removes a marker pointing outside the retrieved set, and counts it', () => {
    /**
     * Two documents were retrieved, so `[7]` refers to nothing a reader can open. Leaving
     * it to the interface would work for the chat page, which renders an unresolvable
     * marker as text, and fail everywhere else: an MCP client is handed the answer string
     * and would print a reference to a seventh document that does not exist.
     */
    const result = verifyAnswer(
      answer({
        answer: 'The limit is 5 MB [1] and QA signs it off [7].',
        citations: [
          { documentPath: 'runner-specs-aws.md', quote: 'Maximum file size: 5 MB.' },
          { documentPath: 'release-checklist.md', quote: 'QA signs off.' },
        ],
      }),
      RETRIEVED,
    );

    expect(result.answer).toBe('The limit is 5 MB [1] and QA signs it off.');
    expect(result.coherence).toEqual([{ rule: 'marker_out_of_range', count: 1 }]);
  });

  it('keeps a marker for a retrieved document the answer did not cite, and counts it', () => {
    // In range, so it misleads nobody: the interface renders it as plain text because no
    // citation carries that number. Removing it would edit the answer to hide a
    // disagreement between the two records, which is the disagreement worth seeing.
    const result = verifyAnswer(
      answer({ answer: 'The limit is 5 MB [1] and QA signs it off [2].' }),
      RETRIEVED,
    );

    expect(result.answer).toBe('The limit is 5 MB [1] and QA signs it off [2].');
    expect(result.coherence).toEqual([{ rule: 'marker_not_cited', count: 1 }]);
  });

  it('takes only the bad half of a group, leaving the claim its good reference', () => {
    /**
     * A claim resting on two documents is marked `[1, 7]`, and the model may be right
     * about one of them and wrong about the other. Removing the whole group would take a
     * working reference away with the broken one, and the sentence would end up with less
     * support than the model actually had for it.
     */
    const result = verifyAnswer(
      answer({
        answer: 'Both the spec and the checklist say so [1, 9].',
        citations: [{ documentPath: 'runner-specs-aws.md', quote: 'Maximum file size.' }],
      }),
      RETRIEVED,
    );

    expect(result.answer).toBe('Both the spec and the checklist say so [1].');
    expect(result.coherence).toEqual([{ rule: 'marker_out_of_range', count: 1 }]);
  });

  it('counts a marker written into a refusal, which the blanking would otherwise hide', () => {
    /**
     * A refusal has no claims, so a marker in one means the citation instruction reached
     * a reply it was not written for. Same shape as the retirement warning turning up in
     * an answer with nothing retired in front of it.
     *
     * The count is the only way to see it. The text is erased two lines later, so an
     * assertion on the answer would pass whether or not this rule existed.
     */
    const result = verifyAnswer(
      answer({
        coverage: 'not_documented',
        answer: 'Nothing here covers that [1].',
        citations: [],
      }),
      RETRIEVED,
    );

    expect(result.answer).toBe('');
    expect(result.coherence).toEqual([{ rule: 'marker_in_refusal', count: 1 }]);
  });

  it('counts an answer that covers the question and points at nothing', () => {
    /**
     * The schema allows it and the demotion above does not catch it: nothing was dropped,
     * so nothing was invented, and the model simply answered without citing. On screen
     * that is confident prose with an empty source list beside it.
     *
     * Left intact rather than withheld. The text may well be right, and a reader who can
     * see that it has no sources knows more than a reader handed a refusal.
     */
    const result = verifyAnswer(answer({ citations: [] }), RETRIEVED);

    expect(result.answer).toBe('The limit is 5 MB.');
    expect(result.coverage).toBe('full');
    expect(result.coherence).toEqual([{ rule: 'answered_without_citation', count: 1 }]);
  });

  it('counts citations attached to a refusal before discarding them', () => {
    // The citations are stripped either way, so the count is the only thing that can
    // report the model having attached them to a reply that had nothing to cite.
    const result = verifyAnswer(
      answer({
        coverage: 'out_of_scope',
        answer: 'That is not what this collection covers.',
        citations: [
          { documentPath: 'runner-specs-aws.md', quote: 'unrelated' },
          { documentPath: 'release-checklist.md', quote: 'also unrelated' },
        ],
      }),
      RETRIEVED,
    );

    expect(result.citations).toEqual([]);
    expect(result.coherence).toEqual([{ rule: 'citation_in_refusal', count: 2 }]);
  });

  it('counts a repeated quote but not a document cited twice for two claims', () => {
    /**
     * The distinction is the whole rule. One document supporting two claims with two
     * different sentences is correct and ordinary in this collection, and a duplicate
     * rule that flagged it would fire on good answers. Only an identical pair carries no
     * second piece of information.
     */
    const twoClaims = verifyAnswer(
      answer({
        citations: [
          { documentPath: 'runner-specs-aws.md', quote: 'Maximum file size: 5 MB.' },
          { documentPath: 'runner-specs-aws.md', quote: 'All assets are inlined.' },
        ],
      }),
      RETRIEVED,
    );

    expect(twoClaims.coherence).toEqual([]);

    const sameTwice = verifyAnswer(
      answer({
        citations: [
          { documentPath: 'runner-specs-aws.md', quote: 'Maximum file size: 5 MB.' },
          { documentPath: 'runner-specs-aws.md', quote: 'Maximum file size: 5 MB.' },
        ],
      }),
      RETRIEVED,
    );

    expect(sameTwice.coherence).toEqual([{ rule: 'duplicate_citation', count: 1 }]);
  });

  it('accepts exactly the numbers the linker assigns when one document is retrieved twice', () => {
    /**
     * The join between the gate and the interface, asserted rather than assumed.
     *
     * One document contributing two chunks appears twice in the retrieved list, and a
     * citation names the document rather than the chunk, so the linker gives it the
     * first of its two positions. The second position is a number no citation will ever
     * carry, and a gate that worked the numbering out its own way would wave it through
     * to an interface that could not resolve it.
     *
     * Every document contributes one chunk on this collection, so this cannot happen
     * today. It is what the pipeline does on a corpus large enough to need splitting.
     */
    const paths = ['release-checklist.md', 'drift-agent-v3.md', 'drift-agent-v3.md'];
    const sources = paths.map((path) => source(path));

    const result = verifyAnswer(
      answer({
        answer: 'Initialize with start() [2]. The same guide covers teardown [3].',
        citations: [{ documentPath: 'drift-agent-v3.md', quote: 'start({ token })' }],
      }),
      paths,
    );

    const linked = linkCitations(result.citations, sources);

    // Two, because the guide sits second among the retrieved documents. A gate that
    // numbered the citations by their own order would say one, and the first version of
    // this test could not tell the two apart: with a single citation on the first
    // document both rules answer the same. The case has to be one where they differ.
    expect(linked.map((citation) => citation.sourceNumber)).toEqual([2]);

    // So `[2]` is the marker that resolves, and `[3]` is the guide's second position,
    // which is a number no citation will ever carry.
    expect(result.coherence).toEqual([{ rule: 'marker_not_cited', count: 1 }]);
    expect(result.answer).toContain('[2]');
  });
});

describe('outOfScopeAnswer', () => {
  it('refuses without citing anything', () => {
    const result = outOfScopeAnswer();

    expect(result.coverage).toBe('out_of_scope');
    expect(result.answer).toBe('');
    expect(result.citations).toEqual([]);
  });

  it('says what the collection is about, so the reader knows what to ask instead', () => {
    expect(outOfScopeAnswer().gap).toMatch(/continuous integration/i);
  });
});

/**
 * The quote a citation carries, checked against the text the model was shown.
 *
 * This rule exists because of a live failure rather than an idea. Asked about the SDK,
 * the model cited the retired guide and quoted "status: RETIRED, do not present as
 * current". That sentence is not in the file. It was in the metadata block this project
 * writes above each document, so the model quoted my scaffolding as evidence, and the
 * reader would have been shown a sentence that exists nowhere in the collection.
 *
 * On screen it is worse than it sounds. The panel looks the quote up to decide which
 * paragraph to open on, finds nothing, and opens at the top, so a citation that appears
 * to point at an exact sentence lands the reader at the start of a document.
 */
describe('a quote that is not in the document', () => {
  const CONTENT = new Map([
    ['runner-specs-aws.md', 'Hard limits: Maximum file size: 5 MB. No outbound network requests.'],
    ['release-checklist.md', 'The QA bot rejects builds that make any outbound request.'],
  ]);

  it('keeps the citation and drops the quote', () => {
    const result = verifyAnswer(
      answer({
        citations: [
          { documentPath: 'runner-specs-aws.md', quote: 'status: RETIRED, do not present' },
        ],
      }),
      RETRIEVED,
      CONTENT,
    );

    // The document is still the right one. Only the excerpt was invented.
    expect(result.citations).toHaveLength(1);
    expect(result.citations[0]?.documentPath).toBe('runner-specs-aws.md');
    expect(result.citations[0]?.quote).toBe('');
    expect(result.droppedCitations).toEqual([]);
    expect(result.coherence).toEqual([{ rule: 'quote_not_in_document', count: 1 }]);
  });

  it('leaves a real quote alone, so the rule is not simply blanking everything', () => {
    const result = verifyAnswer(answer(), RETRIEVED, CONTENT);

    expect(result.citations[0]?.quote).toBe('Maximum file size: 5 MB.');
    expect(result.coherence).toEqual([]);
  });

  it('accepts a quote the model trimmed or respaced, because they all do', () => {
    const result = verifyAnswer(
      answer({
        citations: [{ documentPath: 'runner-specs-aws.md', quote: 'maximum   file size:  5 MB' }],
      }),
      RETRIEVED,
      CONTENT,
    );

    expect(result.citations[0]?.quote).toBe('maximum   file size:  5 MB');
    expect(result.coherence).toEqual([]);
  });

  it('checks nothing when it was given nothing to check against', () => {
    // The unit tests above this block pass no text, and they must keep meaning what they
    // meant. An absent map is "not asked", not "nothing matched".
    const result = verifyAnswer(
      answer({ citations: [{ documentPath: 'runner-specs-aws.md', quote: 'invented' }] }),
      RETRIEVED,
    );

    expect(result.citations[0]?.quote).toBe('invented');
    expect(result.coherence).toEqual([]);
  });
});
