'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { classifySmallTalk } from '@etai/shared';
import { CHAT_LOCATION_COOKIE, CHAT_LOCATION_MAX_AGE } from '@/lib/chat-location';
import { askFor, fetchDocument, RequestFailed, searchFor } from '@/lib/ask-client';
import {
  COVERAGE_GLYPH,
  COVERAGE_LABEL,
  findQuotedParagraph,
  parseAnswer,
  type ChatSource,
  type DocumentDetail,
  type Turn,
} from '@/lib/chat-types';
import { Composer } from './composer';
import { SourcePanel } from './source-panel';

/**
 * The chat surface.
 *
 * A question runs in two stages, which is what the design shows and what the brief asks
 * for: retrieval returns the passages, they are rendered, and only then is the answer
 * requested. The gap between the two is a real wait rather than a rendering order.
 *
 * State lives here rather than in a store because there is one screen and it owns all of
 * it. The panel is part of that state: which document is open, and which paragraph to
 * scroll to, both belong to the conversation rather than to the panel itself.
 */

/**
 * What to suggest on an empty screen.
 *
 * Five real questions. Three the collection answers, one it mentions without answering,
 * and one nobody wrote down, so the four coverage states a person is likely to meet are
 * all reachable from here.
 *
 * The design's list ended with an instruction aimed at the system. That is handled
 * correctly when somebody types it, and suggesting it is a different thing: nobody asks
 * it as a genuine question, and offering it invites poking at the system instead of using
 * it. The vacation one stays, because it is a plausible question and being told plainly
 * that the collection does not cover it is a useful answer.
 */
const EXAMPLES = [
  'How do I start the current drift agent, and what happened to report()?',
  'Why is the build cache kept separate from the artifact store?',
  'What are the Azure runner limits?',
  'Bir sürüm yayınlanmadan önce hangi dört kontrolden geçmeli?',
  'How many vacation days do employees get?',
];

interface ChatScreenProps {
  /** Set when an existing conversation was opened, null on a new one. */
  conversationId: string | null;
  /** The turns already stored, rendered exactly as they were answered. */
  initialTurns: Turn[];
}

export function ChatScreen({ conversationId, initialTurns }: ChatScreenProps) {
  const [turns, setTurns] = useState<Turn[]>(initialTurns);
  /**
   * Held in a ref rather than in state, because nothing renders differently for it and a
   * setState here would land in the middle of an in-flight request.
   */
  const currentConversation = useRef<string | null>(conversationId);
  const router = useRouter();
  const [openDoc, setOpenDoc] = useState<{ path: string; quote?: string } | null>(null);
  const [doc, setDoc] = useState<DocumentDetail | null>(null);
  const [docError, setDocError] = useState<string | null>(null);
  const [docLoading, setDocLoading] = useState(false);
  const [inlineOpen, setInlineOpen] = useState<Record<string, boolean>>({});

  /**
   * The turn being edited, and the text to put back in the box.
   *
   * Editing a question rewinds the conversation to that point: the turn and everything
   * after it go, and the edited question is asked as if it were new. Keeping the old
   * answer would leave an answer to a question that is no longer on the page.
   */
  const [editing, setEditing] = useState<{ turnId: string; text: string; nonce: number } | null>(
    null,
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const inFlight = useRef<AbortController | null>(null);

  // Abandon whatever is in flight when the screen goes away, so a resolved request does
  // not set state on something that is gone.
  useEffect(() => () => inFlight.current?.abort(), []);

  useEffect(() => {
    if (stickToBottom.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  });

  const updateTurn = useCallback((id: string, change: Partial<Turn>) => {
    setTurns((current) => current.map((turn) => (turn.id === id ? { ...turn, ...change } : turn)));
  }, []);

  const ask = useCallback(
    async (question: string, replaceFromTurnId?: string) => {
      const trimmed = question.trim();
      if (trimmed.length === 0) return;

      /**
       * A rewind, when this question replaces an earlier one.
       *
       * Done before the request so the page stops showing the old answer immediately.
       * The server is told separately, because the browser dropping turns from a list
       * does not remove them from the database.
       */
      let dropFromPosition: number | null = null;

      if (replaceFromTurnId) {
        setTurns((current) => {
          const at = current.findIndex((item) => item.id === replaceFromTurnId);
          if (at === -1) return current;
          dropFromPosition = at;
          return current.slice(0, at);
        });
      }

      const id = `turn-${Date.now()}`;
      stickToBottom.current = true;
      setOpenDoc(null);

      /**
       * A greeting skips the search stage, and only that.
       *
       * The answer itself comes from the server like any other, so the turn is stored and
       * is still there when the conversation is reopened. What this avoids is one
       * pointless embedding call: retrieving eight documents for "hello" costs money and
       * shows the reader a source panel for an answer that cites nothing.
       */
      const pleasantry = classifySmallTalk(trimmed);

      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;

      setTurns((current) => [
        ...current,
        {
          id,
          question: trimmed,
          phase: 'retrieving',
          sources: [],
          retrievalMs: null,
          answer: null,
          error: null,
        },
      ]);

      try {
        if (!pleasantry) {
          const { sources, retrievalMs } = await searchFor(trimmed, controller.signal);
          updateTurn(id, { phase: 'sourced', sources, retrievalMs });
        }

        const answer = await askFor(
          trimmed,
          currentConversation.current,
          dropFromPosition,
          controller.signal,
        );

        // The first question of a new conversation comes back with the id it created, so
        // the second question lands in the same one. The URL is corrected without a
        // navigation, so the page is not remounted mid-answer.
        if (answer.conversationId && answer.conversationId !== currentConversation.current) {
          currentConversation.current = answer.conversationId;
          window.history.replaceState(null, '', `/chat/${answer.conversationId}`);
          document.cookie = `${CHAT_LOCATION_COOKIE}=${answer.conversationId}; path=/; max-age=${CHAT_LOCATION_MAX_AGE}; samesite=lax`;

          // The rail was rendered before this conversation existed, so without this the
          // conversation you are in is missing from the list until the next navigation.
          // refresh() re-renders the server component and keeps the turns on screen.
          router.refresh();
        }
        updateTurn(id, {
          phase: 'answered',
          answer,
          // The answer knows which documents it was actually given, which is the set the
          // citation numbers point into. Retrieval ran twice, so trusting the first set
          // would let a number point at the wrong card.
          sources: answer.sources,
        });
      } catch (error) {
        if (controller.signal.aborted) return;

        const failure =
          error instanceof RequestFailed
            ? error.failure
            : {
                message: 'The request could not be sent. Check your connection.',
                upstream: false,
                retryable: true,
              };

        updateTurn(id, { phase: 'failed', error: failure });
      }
    },
    [updateTurn, router],
  );

  const retry = useCallback(
    (turn: Turn) => {
      setTurns((current) => current.filter((item) => item.id !== turn.id));
      void ask(turn.question);
    },
    [ask],
  );

  /**
   * Puts a question back in the box, ready to be changed and asked again.
   *
   * Nothing is removed yet. The turn goes when the edited question is sent, so cancelling
   * leaves the conversation as it was.
   */
  const beginEdit = useCallback((turn: Turn) => {
    setEditing((previous) => ({
      turnId: turn.id,
      text: turn.question,
      nonce: (previous?.nonce ?? 0) + 1,
    }));
  }, []);

  // The panel shows the sources of the most recent turn that has any.
  const panelTurn = useMemo(
    () => [...turns].reverse().find((turn) => turn.sources.length > 0) ?? null,
    [turns],
  );

  useEffect(() => {
    if (!openDoc) {
      setDoc(null);
      setDocError(null);
      return;
    }

    const controller = new AbortController();
    setDocLoading(true);
    setDocError(null);

    fetchDocument(openDoc.path, controller.signal)
      .then((loaded) => setDoc(loaded))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setDocError(
          error instanceof RequestFailed
            ? error.failure.message
            : 'That document could not be read.',
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setDocLoading(false);
      });

    return () => controller.abort();
  }, [openDoc]);

  const empty = turns.length === 0;

  return (
    <div className="et-chat">
      <div className="et-chat-column">
        <div
          ref={scrollRef}
          className="et-chat-scroll"
          onScroll={(event) => {
            const element = event.currentTarget;
            stickToBottom.current =
              element.scrollHeight - element.scrollTop - element.clientHeight < 90;
          }}
        >
          <div className="et-chat-inner">
            {empty ? (
              <div className="et-intro">
                <div className="card-kicker">Grounded in the indexed documents</div>
                <h2 className="et-intro-heading">Ask a question about the corpus.</h2>
                <p className="text-muted et-intro-body">
                  Answers are written only from the indexed documents and cite the ones they came
                  from. When the corpus does not cover a question, the answer says so rather than
                  guessing.
                </p>
                <div className="et-examples">
                  <div className="text-muted et-eyebrow">Try one of these</div>
                  <div className="et-example-grid">
                    {EXAMPLES.map((example) => (
                      <button
                        key={example}
                        type="button"
                        className="et-example"
                        onClick={() => void ask(example)}
                      >
                        {example}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}

            {turns.map((turn) => (
              <TurnView
                key={turn.id}
                turn={turn}
                inlineOpen={!!inlineOpen[turn.id]}
                onToggleInline={() =>
                  setInlineOpen((current) => ({ ...current, [turn.id]: !current[turn.id] }))
                }
                onOpenDocument={(path, quote) => setOpenDoc({ path, quote })}
                onRetry={() => retry(turn)}
                onEdit={() => beginEdit(turn)}
              />
            ))}

            <div className="et-chat-tail" />
          </div>
        </div>

        <Composer
          onSubmit={(text) => {
            const replacing = editing?.turnId;
            setEditing(null);
            void ask(text, replacing);
          }}
          hasHistory={turns.length > 0}
          refill={editing ? { text: editing.text, nonce: editing.nonce } : null}
          editing={Boolean(editing)}
          onCancelEdit={() => setEditing(null)}
        />
      </div>

      <SourcePanel
        sources={panelTurn?.sources ?? []}
        openPath={openDoc?.path ?? null}
        quote={openDoc?.quote}
        document={doc}
        loading={docLoading}
        error={docError}
        onOpenDocument={(path, quote) => setOpenDoc({ path, quote })}
        onBack={() => setOpenDoc(null)}
      />
    </div>
  );
}

interface TurnProps {
  turn: Turn;
  inlineOpen: boolean;
  onToggleInline: () => void;
  onOpenDocument: (path: string, quote?: string) => void;
  onRetry: () => void;
  onEdit: () => void;
}

function TurnView({
  turn,
  inlineOpen,
  onToggleInline,
  onOpenDocument,
  onRetry,
  onEdit,
}: TurnProps) {
  const answer = turn.answer;
  const coverage = answer?.coverage;

  return (
    <article className="et-turn">
      {/* The question sits on the right and the answer on the left, the way every
          messaging surface does it, so the two sides are told apart by position and
          colour rather than by a label above each one. */}
      <div className="et-said et-said-you">
        <div className="et-bubble-row">
          {/* Shown on hover and on focus-within, so it is reachable from a keyboard and
              does not sit on every question at rest. */}
          <button
            type="button"
            className="et-bubble-edit"
            aria-label={`Edit and ask again: ${turn.question}`}
            onClick={onEdit}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              aria-hidden="true"
            >
              <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3z" strokeLinejoin="round" />
            </svg>
          </button>
          <div className="et-bubble et-bubble-you">{turn.question}</div>
        </div>
      </div>

      {turn.phase === 'retrieving' ? (
        <div className="et-retrieving et-said et-said-them">
          <div className="et-retrieving-line">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="et-spinner"
              aria-hidden="true"
            >
              <path d="M12 3a9 9 0 0 1 9 9" strokeLinecap="round" />
              <circle cx="12" cy="12" r="9" opacity=".22" />
            </svg>
            <span>Searching the collection</span>
          </div>
          <div className="et-skeleton-stack">
            <div className="et-skeleton" />
            <div className="et-skeleton" style={{ width: '88%', animationDelay: '.15s' }} />
            <div className="et-skeleton" style={{ width: '54%', animationDelay: '.3s' }} />
          </div>
        </div>
      ) : null}

      {turn.phase === 'sourced' || turn.phase === 'answered' ? (
        <div className="et-turn-body et-said et-said-them">
          <div className="et-turn-meta">
            {/* A greeting has no coverage, because no document was consulted. Without a
                tag its answer is the only one on the page with nothing above it, which
                reads as a fragment rather than as a reply. This says why there are no
                sources beside it. */}
            {turn.phase === 'answered' && answer && !coverage ? (
              <span className="tag tag-neutral et-coverage et-coverage-aside">
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <path d="M4 5.5h16v10H9.5L4.5 19.5V5.5z" />
                </svg>
                No documents consulted
              </span>
            ) : null}

            {coverage ? (
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
                  {COVERAGE_GLYPH[coverage].fill ? (
                    <path d={COVERAGE_GLYPH[coverage].fill} fill="currentColor" stroke="none" />
                  ) : null}
                  {COVERAGE_GLYPH[coverage].slash ? (
                    <path d={COVERAGE_GLYPH[coverage].slash} strokeLinecap="round" />
                  ) : null}
                </svg>
                {COVERAGE_LABEL[coverage]}
              </span>
            ) : null}
            {/*
              Beside the coverage badge rather than as a banner, because it is a fact about
              this answer and not an alert about the system. A reader deciding how much to
              trust what they are reading needs it in the same glance as the coverage.
            */}
            {turn.answer?.degraded ? (
              <span className="tag tag-outline" title="Semantic search was unavailable">
                Keyword search only
              </span>
            ) : null}
            <span className="text-muted et-turn-timing">
              {turn.phase === 'sourced'
                ? `retrieved ${turn.sources.length} ${
                    turn.sources.length === 1 ? 'document' : 'documents'
                  }${
                    turn.retrievalMs === null ? '' : ` in ${turn.retrievalMs} ms`
                  } · writing the answer`
                : answer?.timings
                  ? `${answer.model} · retrieval ${answer.timings.retrievalMs} ms · generation ${(
                      answer.timings.generationMs / 1000
                    ).toFixed(2)} s`
                  : ''}
            </span>
          </div>

          {turn.sources.length > 0 ? (
            <InlineSources
              sources={turn.sources}
              open={inlineOpen}
              onToggle={onToggleInline}
              onOpen={onOpenDocument}
            />
          ) : null}

          {turn.phase === 'sourced' ? (
            <div className="et-skeleton-stack et-answer-pending">
              <div className="et-skeleton" />
              <div className="et-skeleton" style={{ width: '92%', animationDelay: '.15s' }} />
              <div className="et-skeleton" style={{ width: '61%', animationDelay: '.3s' }} />
            </div>
          ) : null}

          {answer && answer.answer ? (
            <div className="et-answer">
              {parseAnswer(answer.answer, answer.citations).map((paragraph, index) => (
                <p key={index}>
                  {paragraph.map((segment, position) =>
                    segment.kind === 'text' ? (
                      <span key={position}>{segment.text}</span>
                    ) : (
                      <button
                        key={position}
                        type="button"
                        className="et-chip"
                        /**
                         * The number alone is meaningless read aloud, so the label says
                         * what the button does and which document it opens. The document
                         * opens at the passage this citation quoted rather than at the
                         * top, which is the whole reason a citation carries a quote.
                         */
                        aria-label={`Open source ${segment.number}, ${segment.citation.documentPath}, at the passage it quotes`}
                        title={`Open ${segment.citation.documentPath}`}
                        onClick={() =>
                          onOpenDocument(segment.citation.documentPath, segment.citation.quote)
                        }
                      >
                        {segment.number}
                      </button>
                    ),
                  )}
                </p>
              ))}
            </div>
          ) : null}

          {answer?.gap ? (
            <div className="et-gap">
              <div className="text-muted et-eyebrow">What the corpus does not cover</div>
              <div className="et-gap-body">{answer.gap}</div>
            </div>
          ) : null}
        </div>
      ) : null}

      {turn.phase === 'failed' && turn.error ? (
        <div className="et-failure">
          <div className="et-failure-title">
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7.5v5.5" strokeLinecap="round" />
              <circle cx="12" cy="16.4" r="1" fill="currentColor" stroke="none" />
            </svg>
            The answer could not be generated
          </div>
          <p className="text-muted et-failure-body">{turn.error.message}</p>

          {/**
           * A rejected question comes back with the same text however many times it is
           * sent, so "Try again" on one is a button that cannot work. It was reported as
           * a button that does nothing, which is exactly what it was.
           */}
          {turn.error.retryable ? (
            <button type="button" className="btn btn-primary et-failure-retry" onClick={onRetry}>
              Try again
            </button>
          ) : (
            <button type="button" className="btn btn-primary et-failure-retry" onClick={onEdit}>
              Edit the question
            </button>
          )}
        </div>
      ) : null}
    </article>
  );
}

interface InlineProps {
  sources: ChatSource[];
  open: boolean;
  onToggle: () => void;
  onOpen: (path: string, quote?: string) => void;
}

/**
 * The sources, folded into the conversation on narrow screens.
 *
 * The side panel is hidden below the desktop breakpoint, and a citation chip has to keep
 * leading somewhere, so the same numbered list appears here instead. The numbers are the
 * ones the API assigned, so a chip still matches a card at every width.
 */
function InlineSources({ sources, open, onToggle, onOpen }: InlineProps) {
  return (
    <div className="et-inline-sources">
      <button type="button" className="et-inline-toggle" onClick={onToggle} aria-expanded={open}>
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
        <span>
          {sources.length === 1
            ? '1 source retrieved before the answer'
            : `${sources.length} sources retrieved before the answer`}
        </span>
      </button>
      {open ? (
        <div className="et-inline-list">
          {sources.map((source, index) => (
            <SourceCard
              key={source.documentId + index}
              source={source}
              number={index + 1}
              onOpen={() => onOpen(source.path)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function SourceCard({
  source,
  number,
  active,
  onOpen,
}: {
  source: ChatSource;
  number: number;
  active?: boolean;
  onOpen: () => void;
}) {
  const status = source.isDeprecated ? 'Deprecated' : source.supersededByPath ? 'Superseded' : null;

  return (
    <button
      type="button"
      className="et-source-card"
      data-active={active || undefined}
      onClick={onOpen}
    >
      <span className="et-source-number">{number}</span>
      <span className="et-source-detail">
        <span className="et-source-name">{source.path.split('/').pop()}</span>
        <span className="et-source-tags">
          <span className="tag tag-neutral">{source.docType}</span>
          <span className="text-muted et-source-date">
            {source.temporalDate ?? 'no date in file'}
          </span>
        </span>
        {status ? (
          <span className="et-source-status">
            <span className="tag tag-outline">
              <svg
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                style={{ marginRight: 5 }}
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="9" />
                <path d="M6 18L18 6" strokeLinecap="round" />
              </svg>
              {status}
            </span>
            {source.supersededByPath ? (
              <span className="text-muted et-source-note">
                replaced by {source.supersededByPath.split('/').pop()}
              </span>
            ) : null}
          </span>
        ) : null}
        {source.distance === undefined ? null : source.distance === null ? (
          <span className="text-muted et-source-score">found by keyword · rank {number}</span>
        ) : (
          <span className="text-muted et-source-score">
            cosine distance {source.distance.toFixed(4)} · rank {number}
          </span>
        )}
      </span>
    </button>
  );
}

export { findQuotedParagraph };
