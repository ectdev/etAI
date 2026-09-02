'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * The question box.
 *
 * Empty and whitespace-only input cannot be sent. The send control is disabled and the
 * Enter handler returns early, and the server refuses the same input independently: the
 * ask endpoint validates against a schema that requires three characters after trimming.
 * Neither check is there to catch the other's mistakes. The client one exists so nothing
 * happens when a person presses Enter on an empty box, and the server one exists because
 * a client is not a place to enforce anything.
 */

/**
 * Real questions, cycling as a typed placeholder.
 *
 * They double as a hint about what the collection holds, which is why they are specific
 * rather than generic. Every one of them is answerable, since a placeholder is an
 * invitation and inviting somebody to ask something that gets refused is a poor one.
 */
const PLACEHOLDERS = [
  'What is the maximum artifact size on AWS?',
  'Which four checks must every release pass?',
  'How is cache retention counted?',
  'Hetzner runner limitleri neler?',
];

const TYPE_MS = 55;
const HOLD_TICKS = 26;

interface Props {
  onSubmit: (text: string) => void;
  hasHistory: boolean;
  /**
   * Text to load into the box, from editing an earlier question.
   *
   * A counter travels with it so that editing the same question twice still refills the
   * box. Comparing the text alone would treat the second edit as no change.
   */
  refill?: { text: string; nonce: number } | null;
  /** Called when the person abandons an edit. */
  onCancelEdit?: () => void;
  editing?: boolean;
}

export function Composer({ onSubmit, hasHistory, refill, onCancelEdit, editing }: Props) {
  const [draft, setDraft] = useState('');
  const [phrase, setPhrase] = useState(0);
  const [typed, setTyped] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const holdRef = useRef(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const idle = draft.length === 0 && !hasHistory;

  useEffect(() => {
    if (!refill) return;

    setDraft(refill.text);

    const box = textareaRef.current;
    if (!box) return;

    box.focus();
    // At the end rather than selecting it all, because an edit is usually a change to
    // part of the question rather than a replacement of the whole thing.
    box.setSelectionRange(refill.text.length, refill.text.length);
  }, [refill]);

  useEffect(() => {
    // The animation stops once there is anything to look at. It exists to suggest what
    // to ask, and once a person has asked something it is only motion.
    if (!idle) return;

    const timer = setInterval(() => {
      const full = PLACEHOLDERS[phrase % PLACEHOLDERS.length] ?? '';

      if (!deleting) {
        if (typed < full.length) {
          setTyped((value) => value + 1);
          return;
        }
        holdRef.current += 1;
        if (holdRef.current > HOLD_TICKS) {
          holdRef.current = 0;
          setDeleting(true);
        }
        return;
      }

      if (typed > 3) {
        setTyped((value) => value - 2);
        return;
      }
      setDeleting(false);
      setTyped(0);
      setPhrase((value) => value + 1);
    }, TYPE_MS);

    return () => clearInterval(timer);
  }, [idle, phrase, typed, deleting]);

  const send = () => {
    const trimmed = draft.trim();
    if (trimmed.length === 0) return;
    setDraft('');
    onSubmit(trimmed);
  };

  const placeholder = hasHistory
    ? 'Ask another question'
    : (PLACEHOLDERS[phrase % PLACEHOLDERS.length] ?? '').slice(0, typed);

  return (
    <div className="et-composer-region">
      <div className="et-composer-inner">
        {editing ? (
          <div className="et-editing-note">
            <span>Editing</span>
            <button
              type="button"
              className="et-editing-cancel"
              aria-label="Cancel editing"
              onClick={onCancelEdit}
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        ) : null}

        <div className="et-composer" data-editing={editing || undefined}>
          <textarea
            ref={textareaRef}
            rows={1}
            value={draft}
            placeholder={placeholder}
            aria-label="Ask a question about the corpus"
            className="et-composer-input"
            onChange={(event) => {
              setDraft(event.target.value);
              const element = event.target;
              element.style.height = 'auto';
              element.style.height = `${Math.min(element.scrollHeight, 150)}px`;
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                send();
              }
              // Escape abandons an edit, which is what it does in every other text box
              // that has a way out.
              if (event.key === 'Escape' && editing) {
                setDraft('');
                onCancelEdit?.();
              }
            }}
          />
          <button
            type="button"
            className="btn btn-primary et-send"
            disabled={draft.trim().length === 0}
            aria-label="Send question"
            onClick={send}
          >
            <svg
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
            >
              <path d="M12 19V6" strokeLinecap="round" />
              <path d="M6 11.5l6-6 6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
        <div className="text-muted et-composer-hint">
          <span>Enter to send · Shift+Enter for a new line</span>
          <span>Answers cite documents. A refusal is an answer too.</span>
        </div>
      </div>
    </div>
  );
}
