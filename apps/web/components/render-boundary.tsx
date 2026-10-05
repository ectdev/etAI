'use client';

import { catchError, type ErrorInfo } from 'next/error';

/**
 * Boundaries around the two places that render text nobody here wrote.
 *
 * An answer comes from a model and a source document from the corpus, and both go
 * through a markdown renderer. If that ever throws on something it was handed, the
 * failure should cost the one turn or the one document, not the conversation around it,
 * and the reader should still get the text. So the fallback shows it plain, which is
 * always possible, and offers to try the formatted version again.
 *
 * `catchError` rather than a hand-written class boundary, because it leaves Next.js's own
 * `redirect()` and `notFound()` alone and clears itself on navigation.
 */

interface PlainTextProps {
  text: string;
}

function PlainText({ text }: PlainTextProps, { retry }: ErrorInfo, what: string) {
  return (
    <div className="et-render-fallback" role="status">
      <p className="text-muted et-render-fallback-note">
        This {what} could not be formatted, so here it is as plain text.{' '}
        <button type="button" className="et-render-fallback-retry" onClick={() => retry()}>
          Try formatting it again
        </button>
      </p>
      <div className="et-render-fallback-text">{text}</div>
    </div>
  );
}

export const AnswerBoundary = catchError((props: PlainTextProps, info: ErrorInfo) =>
  PlainText(props, info, 'answer'),
);

export const DocumentBoundary = catchError((props: PlainTextProps, info: ErrorInfo) =>
  PlainText(props, info, 'document'),
);
