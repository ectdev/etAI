'use client';

import { useId, useState } from 'react';
import { COVERAGE_GLYPH, COVERAGE_LABEL, parseAnswer } from '@/lib/chat-types';
import type { LinkedCitation } from '@etai/shared';

/**
 * One real answer, rendered with the components the chat page uses.
 *
 * Describing a citation is weaker than showing one, and this is the screen where a
 * reviewer decides whether the rest is worth opening. So the example is the interface
 * rather than a picture of it: the same coverage badge, the same chip parser, the same
 * source card.
 *
 * Everything below is verbatim from one request to `/api/ask` on 2026-09-03: the answer
 * as the model wrote it, the citations as the gate returned them, and all eight sources
 * retrieval found, in the order and with the numbering it gave them. Nothing is trimmed
 * to look better, which is why three meeting notes it did not cite are in the list.
 *
 * This question is the one worth showing because it exercises the whole design at once.
 * The collection contains a decision and its reversal: runner 5.2 changed cache retention
 * to count from the write, 5.3 changed it back, and eight later releases sit on top of
 * both. An answer that reads 5.2 and stops is fluent, cited and wrong. This one reaches
 * the current rule, names the release that reversed it, and marks 5.2 as replaced.
 *
 * It also shows the citation marker doing the thing it exists for. `[2, 4]` in the first
 * sentence is one claim resting on two documents, and it renders as two chips rather than
 * one that has to choose.
 *
 * It is static and inert on purpose. Making it interactive would mean a model call on a
 * page that has not signed anybody in yet. The one exception is the disclosure below,
 * which moves nothing but its own height.
 */

const QUESTION =
  'Is cache retention counted from when an entry is written or when it was last read?';

const ANSWER =
  'Cache retention is counted from when an entry was last read [2, 4]. Although Halcyon ' +
  'runner 5.2 temporarily changed retention to be counted from the write [1], that change ' +
  'was reverted in Halcyon runner 5.3 [4], and the 5.2 changelog document is retired and ' +
  'replaced by 5.3 [1].';

/** The three documents the answer cited, with the numbers the API gave them. */
const CITATIONS: LinkedCitation[] = [
  {
    sourceNumber: 1,
    documentId: 'landing-example-1',
    documentPath: 'changelogs/halcyon-runner-5.2.md',
    title: 'Halcyon runner 5.2 (2026-02-24)',
    quote: 'Cache retention is now counted from the write rather than from the last read.',
  },
  {
    sourceNumber: 2,
    documentId: 'landing-example-2',
    documentPath: 'build-cache.md',
    title: 'The build cache, and why it is a separate layer',
    quote:
      'Retention is counted from the last read, not from the write, so a cache that is used stays alive.',
  },
  {
    sourceNumber: 4,
    documentId: 'landing-example-4',
    documentPath: 'changelogs/halcyon-runner-5.3.md',
    title: 'Halcyon runner 5.3 (2026-03-10)',
    quote: 'Cache retention is counted from the last read again, undoing the change made in 5.2.',
  },
];

/** Every source retrieval returned, numbered as it numbered them. */
const SOURCES = [
  { number: 1, name: 'changelogs/halcyon-runner-5.2.md', docType: 'changelog', status: 'Replaced' },
  { number: 2, name: 'build-cache.md', docType: 'reference', status: null },
  {
    number: 3,
    name: 'meeting-notes/2026-04-29-platform-sync.md',
    docType: 'meeting note',
    status: null,
  },
  { number: 4, name: 'changelogs/halcyon-runner-5.3.md', docType: 'changelog', status: 'Replaced' },
  {
    number: 5,
    name: 'meeting-notes/2026-08-19-platform-sync.md',
    docType: 'meeting note',
    status: null,
  },
  {
    number: 6,
    name: 'deployment-reports/2025-11-saltbox-retail.md',
    docType: 'deployment report',
    status: null,
  },
  {
    number: 7,
    name: 'deployment-reports/2025-11-runeberg-health.md',
    docType: 'deployment report',
    status: null,
  },
  {
    number: 8,
    name: 'meeting-notes/2026-03-18-platform-sync.md',
    docType: 'meeting note',
    status: null,
  },
];

/**
 * Counted rather than written out, so the closed row cannot end up disagreeing with the
 * cards it is hiding. The count stays visible while the list is folded because a source
 * that is no longer current is the hardest thing this system handles, and folding it away
 * would be folding away the point of the example.
 *
 * "Not current" rather than "retired", because these two are superseded rather than
 * deprecated and those are different states. A document nobody replaced can be retired,
 * and a document that was replaced is usually not.
 */
const NOT_CURRENT = SOURCES.filter((source) => source.status !== null);

export function LandingExample() {
  const coverage = 'full' as const;
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <section className="et-landing-example" aria-label="An example answer from the collection">
      <div className="et-landing-head">
        <div className="et-landing-eyebrow text-muted">A question, answered from the corpus</div>
        <div className="et-landing-question">{QUESTION}</div>
      </div>

      <div className="et-landing-body">
        <span className="tag tag-neutral et-coverage">
          <svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="9" />
            <path d={COVERAGE_GLYPH[coverage].fill} fill="currentColor" stroke="none" />
          </svg>
          {COVERAGE_LABEL[coverage]}
        </span>

        <div className="et-answer et-landing-answer">
          {parseAnswer(ANSWER, CITATIONS).map((paragraph, index) => (
            <p key={index}>
              {paragraph.map((segment, position) =>
                segment.kind === 'text' ? (
                  <span key={position}>{segment.text}</span>
                ) : (
                  /* A span rather than a button: this one does not open anything. */
                  <span key={position} className="et-chip" aria-hidden="true">
                    {segment.number}
                  </span>
                ),
              )}
            </p>
          ))}
        </div>
      </div>

      {/*
        Not the chat page's `InlineSources`, and the difference is the closed state rather
        than the appearance. That list holds buttons that open a document, so when it is
        folded it has to leave the tab order, and it does that by not being rendered. This
        one holds two spans that open nothing, so it can stay mounted and let its height
        animate. A shared component would need a flag for which of those two it is, which
        is more machinery than the twenty lines it would save. What they do share is the
        part that is actually the same: `.et-inline-toggle` and its chevron, which turns
        from `aria-expanded` in the stylesheet so both rotate from one rule.
      */}
      <div className="et-landing-refs">
        <button
          type="button"
          className="et-inline-toggle et-landing-refs-toggle"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen(!open)}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            aria-hidden="true"
          >
            <path d="M9 5l7 7-7 7" />
          </svg>
          <span>{SOURCES.length} references</span>
          <span className="tag tag-outline">{NOT_CURRENT.length} not current</span>
        </button>

        {/*
          The cards stay mounted so their height has something to animate from, and `inert`
          keeps them out of the tab order and the accessibility tree while they are folded
          away. Clipped is not the same as absent, and `aria-expanded="false"` above a list
          a screen reader can still read is a lie.
        */}
        <div
          id={panelId}
          className="et-landing-refs-panel"
          data-open={open || undefined}
          inert={!open}
        >
          <div className="et-landing-sources">
            {SOURCES.map((source) => (
              <div key={source.number} className="et-source-card et-landing-source">
                <span className="et-source-number">{source.number}</span>
                <span className="et-source-detail">
                  <span className="et-source-name">{source.name}</span>
                  <span className="et-source-tags">
                    <span className="tag tag-neutral">{source.docType}</span>
                    {source.status ? (
                      <span className="tag tag-outline">{source.status}</span>
                    ) : null}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
