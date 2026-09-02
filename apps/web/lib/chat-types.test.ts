import type { LinkedCitation } from '@etai/shared';
import { describe, expect, it } from 'vitest';
import { findQuotedParagraph, parseAnswer } from './chat-types';

const citation = (sourceNumber: number, quote = 'a quote'): LinkedCitation => ({
  sourceNumber,
  documentId: `doc-${sourceNumber}`,
  documentPath: `path-${sourceNumber}.md`,
  title: `Title ${sourceNumber}`,
  quote,
});

/**
 * Turning an answer into text and citation chips.
 *
 * The chip a reader clicks and the card it opens have to carry the same number. The
 * numbers come from the API, where they are worked out from the retrieved set, so this
 * function must not renumber anything: it looks a marker up and leaves the arithmetic
 * alone. The failure to watch for is silent, because a chip that opens the wrong
 * document looks exactly like one that opens the right one.
 */
describe('splitting an answer into text and chips', () => {
  it('gives a chip the number the API assigned, not its position in the text', () => {
    // The model cited source 2 before source 1. Renumbering by order of appearance is
    // the obvious implementation and it points the first chip at the wrong card.
    const segments = parseAnswer('First [2] then [1].', [citation(1), citation(2)]);
    const chips = segments[0]?.filter((segment) => segment.kind === 'chip') ?? [];

    expect(chips.map((chip) => (chip.kind === 'chip' ? chip.number : 0))).toEqual([2, 1]);
    expect(chips[0]?.kind === 'chip' && chips[0].citation?.documentPath).toBe('path-2.md');
  });

  it('gives repeated citations of one document the same number', () => {
    const segments = parseAnswer('Claim one [1]. Claim two [1].', [citation(1)]);
    const chips = segments[0]?.filter((segment) => segment.kind === 'chip') ?? [];

    expect(chips).toHaveLength(2);
    expect(chips.every((chip) => chip.kind === 'chip' && chip.number === 1)).toBe(true);
  });

  it('leaves a marker with no citation as text rather than dropping it', () => {
    /**
     * A number the answer used and the citation list does not have means the citation
     * was removed by verification. Rendering nothing would silently edit the answer;
     * rendering a dead chip would offer a link to nowhere. Showing `[4]` as text is
     * true: the answer said it, and there is no source behind it.
     */
    const segments = parseAnswer('Supported [1]. Unsupported [4].', [citation(1)]);
    const flat = segments[0] ?? [];

    expect(flat.filter((segment) => segment.kind === 'chip')).toHaveLength(1);
    expect(flat.map((segment) => (segment.kind === 'text' ? segment.text : '')).join('')).toContain(
      '[4]',
    );
  });

  it('gives a claim resting on two documents one chip for each', () => {
    /**
     * Found in a real answer rather than imagined. Asked to mark its claims, the model
     * wrote `[1, 7]` on the one sentence supported by both the postmortem and the sync
     * note, and the earlier pattern matched only single numbers, so the whole thing
     * rendered as literal text and neither document was reachable from that claim.
     */
    const segments = parseAnswer('The verify stage now measures the artifact [1, 7].', [
      citation(1),
      citation(7),
    ]);
    const chips = segments[0]?.filter((segment) => segment.kind === 'chip') ?? [];

    expect(chips.map((chip) => (chip.kind === 'chip' ? chip.number : 0))).toEqual([1, 7]);
    expect(
      segments[0]?.map((segment) => (segment.kind === 'text' ? segment.text : '')).join(''),
    ).not.toContain('[');
  });

  it('renders half of a group as a chip and half as text when only one number resolves', () => {
    // The honest rendering. A single chip for the pair would claim both documents were
    // used, and dropping the group would hide that the answer said so.
    const segments = parseAnswer('Both agree [1, 7].', [citation(1)]);
    const flat = segments[0] ?? [];

    expect(flat.filter((segment) => segment.kind === 'chip')).toHaveLength(1);
    expect(flat.map((segment) => (segment.kind === 'text' ? segment.text : '')).join('')).toContain(
      '[7]',
    );
  });

  it('keeps paragraphs apart and drops the blank ones', () => {
    expect(parseAnswer('One.\n\n\nTwo.\n\n', [])).toHaveLength(2);
  });

  it('handles an answer with no citations at all', () => {
    // Every refusal takes this path: text, no markers, no sources.
    const segments = parseAnswer('Nothing here covers that.', []);

    expect(segments).toHaveLength(1);
    expect(segments[0]?.every((segment) => segment.kind === 'text')).toBe(true);
  });
});

describe('finding the passage a citation quoted', () => {
  const paragraphs = [
    'AWS enforces the artifact limit on the extracted size, not the archive.',
    'Hard limits: maximum file size 5 MB for the final single HTML file.',
    'The QA bot rejects builds that make any outbound request.',
  ];

  it('finds the paragraph the quote came from', () => {
    expect(findQuotedParagraph(paragraphs, 'maximum file size 5 MB')).toBe(1);
  });

  it('still finds it when the model reflowed the whitespace', () => {
    // A quote comes back as the model wrote it, which is not always byte for byte what
    // the document says.
    expect(findQuotedParagraph(paragraphs, 'Hard limits:   maximum\n file size 5 MB')).toBe(1);
  });

  it('falls back to a prefix when the quote runs past the paragraph', () => {
    expect(
      findQuotedParagraph(paragraphs, 'The QA bot rejects builds that make any outbound request'),
    ).toBe(2);
  });

  it('returns nothing rather than guessing', () => {
    /**
     * The important direction. Highlighting the wrong paragraph looks identical to
     * highlighting the right one, so a near miss is worse than no highlight: the panel
     * then opens at the top, which tells the reader nothing false.
     */
    expect(findQuotedParagraph(paragraphs, 'a sentence from a different document')).toBe(-1);
    expect(findQuotedParagraph(paragraphs, undefined)).toBe(-1);
    expect(findQuotedParagraph(paragraphs, 'MB')).toBe(-1);
  });
});
