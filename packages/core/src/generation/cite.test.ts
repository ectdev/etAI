import { describe, expect, it } from 'vitest';
import type { AnswerSource, Citation, GroundedAnswer } from '@etai/shared';
import { linkCitations } from './cite.js';
import { verifyAnswer } from './verify.js';

const source = (path: string, overrides: Partial<AnswerSource> = {}): AnswerSource => ({
  documentId: `id-${path}`,
  path,
  title: `Title of ${path}`,
  headingPath: null,
  docType: 'reference',
  temporalDate: null,
  isDeprecated: false,
  supersededByPath: null,
  distance: 0.2,
  ...overrides,
});

const SOURCES: AnswerSource[] = [
  source('runner-specs-aws.md'),
  source('release-checklist.md'),
  source('secrets-policy.md'),
];

const cite = (documentPath: string): Citation => ({ documentPath, quote: 'a quote' });

describe('giving a citation the identity a reader follows', () => {
  it('numbers a citation by where its document sits in the sources', () => {
    // The number is what an interface prints beside a claim and on the card it refers
    // to. It has to come from the retrieved order, not from the order the model happened
    // to cite things in.
    const linked = linkCitations([cite('secrets-policy.md')], SOURCES);

    expect(linked[0]?.sourceNumber).toBe(3);
    expect(linked[0]?.documentId).toBe('id-secrets-policy.md');
  });

  it('numbers from one, because a person reads the number', () => {
    expect(linkCitations([cite('runner-specs-aws.md')], SOURCES)[0]?.sourceNumber).toBe(1);
  });

  it('gives two citations of the same document the same number', () => {
    /**
     * The case that breaks a naive interface.
     *
     * A document with more than one chunk can be cited twice, once per claim. Both
     * chips must point at the same card, so both carry the same number. An interface
     * matching on path would work here and stop working as soon as numbering was
     * involved, which is why the number is assigned rather than derived at render time.
     */
    const linked = linkCitations(
      [cite('release-checklist.md'), cite('release-checklist.md')],
      SOURCES,
    );

    expect(linked.map((citation) => citation.sourceNumber)).toEqual([2, 2]);
  });

  it('points a citation at the best ranked chunk when a document supplied several', () => {
    // Two chunks of one document, in rank order. The citation should open the one that
    // ranked highest rather than whichever was seen last.
    const withDuplicate = [
      source('build-cache.md', { documentId: 'chunk-a', headingPath: 'Overview' }),
      source('release-checklist.md'),
      source('build-cache.md', { documentId: 'chunk-b', headingPath: 'Sound' }),
    ];

    const linked = linkCitations([cite('build-cache.md')], withDuplicate);

    expect(linked[0]?.sourceNumber).toBe(1);
    expect(linked[0]?.documentId).toBe('chunk-a');
  });

  it('keeps the quote the model wrote untouched', () => {
    // The quote is the only part of a citation a reader can check without opening the
    // document, so nothing here may rewrite it.
    const linked = linkCitations(
      [{ documentPath: 'release-checklist.md', quote: 'Every delivery passes the checklist.' }],
      SOURCES,
    );

    expect(linked[0]?.quote).toBe('Every delivery passes the checklist.');
  });

  it('returns nothing when there were no sources to link against', () => {
    expect(linkCitations([cite('anything.md')], [])).toEqual([]);
  });
});

describe('the gate and the numbering, together', () => {
  /**
   * The property that makes the two functions safe to run in sequence.
   *
   * `verifyAnswer` decides what may be cited and `linkCitations` decides how it is
   * shown. Linking silently skips a citation it cannot place, which is correct as a last
   * resort and wrong as a routine, because a citation that vanishes between the two
   * steps would be invisible: the answer still reads, it just has one fewer source than
   * the model provided.
   *
   * So the two have to agree. Everything the gate keeps, the numbering must place.
   */
  it('places every citation the gate allowed through', () => {
    const answer: GroundedAnswer = {
      answer: 'The limit is 5 MB and the checklist covers it.',
      citations: [
        cite('runner-specs-aws.md'),
        cite('invented-document.md'),
        cite('release-checklist.md'),
      ],
      coverage: 'full',
      gap: null,
    };

    const verified = verifyAnswer(
      answer,
      SOURCES.map((item) => item.path),
    );
    const linked = linkCitations(verified.citations, SOURCES);

    expect(verified.droppedCitations).toEqual(['invented-document.md']);
    expect(linked).toHaveLength(verified.citations.length);
    expect(linked.map((citation) => citation.sourceNumber)).toEqual([1, 2]);
  });

  it('never numbers something the gate refused', () => {
    // The direction that matters for trust. An invented path must not acquire a number,
    // a title and an id on its way to the reader, because those are what make a citation
    // look checked.
    const answer: GroundedAnswer = {
      answer: 'Invented.',
      citations: [cite('runner-specs-azure.md')],
      coverage: 'full',
      gap: null,
    };

    const verified = verifyAnswer(
      answer,
      SOURCES.map((item) => item.path),
    );

    expect(linkCitations(verified.citations, SOURCES)).toEqual([]);
  });
});
