'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import type { ConversationSummary } from '@/lib/conversations';

/**
 * The list of past conversations.
 *
 * Collapsible on narrow screens the same way the source panel is: a real button carrying
 * `aria-expanded` and `aria-controls`, and a grid row that animates from 0fr to 1fr so
 * nothing jumps. On wide screens the disclosure is not rendered at all and the list is
 * always there.
 *
 * Every entry is a link rather than a click handler, so a conversation has a URL, opens in
 * a new tab, and survives a reload. The server decides what a URL shows, which is also
 * where the ownership check is.
 */

interface Props {
  conversations: ConversationSummary[];
  /** The one being read, so it can be marked. Null on a new conversation. */
  currentId: string | null;
  /**
   * Which of the two placements this is.
   *
   * `rail` sits in the navigation column and is the desktop one. `drawer` slides in from
   * the left, for the widths where the rail is icons only or gone.
   *
   * Both are rendered and CSS shows exactly one. That is a duplicate list in the DOM,
   * which is worth naming: it is at most thirty short strings, and the alternative is
   * measuring the window in JavaScript, which gets the first paint wrong.
   */
  placement: 'rail' | 'drawer';
}

export function HistoryRail({ conversations, currentId, placement }: Props) {
  const router = useRouter();
  const panelId = useId();

  /** The conversation waiting on a yes or no, or null when nothing is being deleted. */
  const [confirming, setConfirming] = useState<ConversationSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [failed, setFailed] = useState(false);
  const confirm = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = confirm.current;
    if (!element) return;
    if (confirming && !element.open) element.showModal();
    if (!confirming && element.open) element.close();
  }, [confirming]);

  async function remove() {
    if (!confirming) return;

    setDeleting(true);
    setFailed(false);

    const response = await fetch(`/api/conversations/${confirming.id}`, { method: 'DELETE' });

    setDeleting(false);

    if (!response.ok) {
      setFailed(true);
      return;
    }

    const wasOpen = confirming.id === currentId;
    setConfirming(null);

    // Leaving the conversation that was just deleted on screen would show turns that no
    // longer exist anywhere.
    if (wasOpen) router.push('/chat/new');
    else router.refresh();
  }

  return (
    <aside className="et-history" data-placement={placement}>
      <div className="et-history-head">
        <span className="text-muted et-eyebrow">Conversations</span>

        {/* The page it lands on records that this was where you were, so returning
            from the dashboard comes back to a new conversation rather than to the one
            before it. */}
        <Link href="/chat/new" className="et-history-new" prefetch={false}>
          New chat
        </Link>
      </div>

      <div id={panelId} className="et-history-panel">
        <div className="et-history-list">
          {conversations.length === 0 ? (
            <p className="text-muted et-history-empty">
              Nothing yet. Ask a question and it will be kept here.
            </p>
          ) : (
            conversations.map((row) => (
              <div key={row.id} className="et-history-row">
                <Link
                  href={`/chat/${row.id}`}
                  className="et-history-item"
                  data-current={row.id === currentId || undefined}
                  aria-current={row.id === currentId ? 'page' : undefined}
                >
                  <span>{row.title}</span>
                </Link>

                <button
                  type="button"
                  className="et-history-delete"
                  aria-label={`Delete conversation: ${row.title}`}
                  onClick={() => {
                    setFailed(false);
                    setConfirming(row);
                  }}
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
                    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
                  </svg>
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Asked before deleting, because there is no undo and the turns go with it. */}
      <dialog
        ref={confirm}
        className="et-dialog"
        aria-labelledby={`${panelId}-confirm`}
        onClose={() => setConfirming(null)}
        onClick={(event) => {
          if (event.target === confirm.current) setConfirming(null);
        }}
      >
        <div className="et-dialog-panel">
          <header className="et-dialog-head">
            <h6 id={`${panelId}-confirm`}>Delete this conversation?</h6>
          </header>

          <p className="text-muted et-dialog-lead">
            &ldquo;{confirming?.title}&rdquo; and every question and answer in it will be removed.
            This cannot be undone.
          </p>

          {failed ? (
            <p className="et-field-error" role="alert">
              That conversation could not be deleted. Try again.
            </p>
          ) : null}

          <div className="et-dialog-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setConfirming(null)}>
              Keep it
            </button>
            <button type="button" className="btn btn-danger" disabled={deleting} onClick={remove}>
              {deleting ? 'Deleting' : 'Delete'}
            </button>
          </div>
        </div>
      </dialog>
    </aside>
  );
}
