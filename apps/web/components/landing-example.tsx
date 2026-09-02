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
 * The text below is written rather than captured, and that is a debt rather than a
 * choice. It has to be replaced with verbatim output from a real run before this page can
 * claim to show one: ask the running system the question below, paste what comes back, and
 * delete this paragraph. Until then the example shows the shape of an answer and not an
 * answer, and saying so here is cheaper than a reader finding out.
 *
 * This question is the one worth showing because it exercises the whole design at once.
 * The answer comes from the current guide, names the retired one, and carries a chip for
 * each, so a reader sees citation and staleness handling in four sentences.
 *
 * It is static and inert on purpose. Making it interactive would mean a model call on a
 * page that has not signed anybody in yet. The one exception is the disclosure below,
 * which moves nothing but its own height.
 */

const QUESTION = 'How do I start the current drift agent, and what happened to report()?';

const ANSWER =
  'Call start() from the v3 agent and await it: it returns a handle rather than mutating ' +
  'a module level singleton, so two agents can exist in one process [1]. Registration is ' +
  'lazy, so a job that never reports anything never pays for a round trip [1]. As for ' +
  'report(), it belonged to agent v2, which was retired in March 2026 [2]. It was removed ' +
  'rather than renamed: the equivalent is emit(), which awaits delivery instead of ' +
  'returning immediately and losing the last steps of a fast job [1].';

/** The two documents the answer cited, as the API returned them. */
const CITATIONS: LinkedCitation[] = [
  {
    sourceNumber: 1,
    documentId: 'landing-example-1',
    documentPath: 'drift-agent-v3.md',
    title: 'drift agent v3 (current)',
    quote: '`start()` returns a handle rather than mutating a module level singleton',
  },
  {
    sourceNumber: 2,
    documentId: 'landing-example-2',
    documentPath: 'drift-agent-v2.md',
    title: 'drift agent v2 (DEPRECATED)',
    quote: 'Status: deprecated since March 2026.',
  },
];

const SOURCES = [
  { number: 1, name: 'drift-agent-v3.md', docType: 'reference', status: null },
  { number: 2, name: 'drift-agent-v2.md', docType: 'reference', status: 'Deprecated' },
];

/**
 * Counted rather than written out, so the closed row cannot end up disagreeing with the
 * cards it is hiding. The retired count stays visible while the list is closed because it
 * is the hardest thing this system does, and folding it away would be folding away the
 * point of the example.
 */
const RETIRED = SOURCES.filter((source) => source.status !== null);

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
          <span className="tag tag-outline">{RETIRED.length} retired</span>
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
