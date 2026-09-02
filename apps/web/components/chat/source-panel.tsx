'use client';

import { useEffect, useRef } from 'react';
import { findQuotedParagraph, type ChatSource, type DocumentDetail } from '@/lib/chat-types';
import { SourceCard } from './chat-screen';

/**
 * The panel beside the answer, in two modes.
 *
 * Sources mode lists what retrieval returned, numbered to match the chips in the text.
 * Document mode shows one document in full with the quoted passage marked, which is what
 * a chip or a card opens.
 *
 * It is absent rather than empty when there is nothing to show. A refusal carries no
 * citations, so `not_documented` and `out_of_scope` leave no panel behind, and an empty
 * region labelled "Sources" would suggest something failed rather than that the answer
 * correctly had none.
 *
 * On desktop it is a column beside the conversation. Below that width it becomes an
 * overlay, entered from a chip or from the folded list inside the turn, so the mapping
 * from a number to a document survives at every width.
 */

interface Props {
  sources: ChatSource[];
  openPath: string | null;
  quote: string | undefined;
  document: DocumentDetail | null;
  loading: boolean;
  error: string | null;
  onOpenDocument: (path: string, quote?: string) => void;
  onBack: () => void;
}

export function SourcePanel({
  sources,
  openPath,
  quote,
  document,
  loading,
  error,
  onOpenDocument,
  onBack,
}: Props) {
  const highlightRef = useRef<HTMLParagraphElement>(null);

  const paragraphs = document
    ? document.content
        .split(/\n{2,}/)
        .map((paragraph) => paragraph.trim())
        .filter((paragraph) => paragraph.length > 0)
    : [];

  const highlighted = findQuotedParagraph(paragraphs, quote);

  useEffect(() => {
    // Bringing the quoted passage into view is the point of opening a citation. Without
    // this the panel opens at the top of a document and the reader has to find the
    // sentence the answer was talking about.
    highlightRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [document, highlighted]);

  const showing = openPath !== null;

  if (sources.length === 0 && !showing) return null;

  return (
    <aside className="et-panel" data-open={showing || undefined} aria-label="Sources">
      <div className="et-panel-head">
        {showing ? (
          <button type="button" className="et-panel-back" onClick={onBack}>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              aria-hidden="true"
            >
              <path d="M15 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Sources
          </button>
        ) : (
          <h6 className="et-panel-title">Sources</h6>
        )}
        {!showing && sources.length > 0 ? (
          <span className="text-muted et-panel-count">
            {sources.length === 1 ? '1 document' : `${sources.length} documents`}
          </span>
        ) : null}
      </div>

      <div className="et-panel-body">
        {!showing ? (
          <div className="et-panel-sources">
            <p className="text-muted et-panel-note">Numbers match the citations in the answer.</p>
            {sources.map((source, index) => (
              <SourceCard
                key={source.documentId + index}
                source={source}
                number={index + 1}
                onOpen={() => onOpenDocument(source.path)}
              />
            ))}
          </div>
        ) : loading ? (
          <div className="et-skeleton-stack">
            <div className="et-skeleton" style={{ height: 18, width: '70%' }} />
            <div className="et-skeleton" style={{ animationDelay: '.1s' }} />
            <div className="et-skeleton" style={{ width: '92%', animationDelay: '.2s' }} />
            <div className="et-skeleton" style={{ width: '78%', animationDelay: '.3s' }} />
          </div>
        ) : error ? (
          <div className="et-panel-error">
            <div className="et-panel-error-title">That document could not be opened</div>
            <p className="text-muted et-panel-error-body">{error}</p>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => openPath && onOpenDocument(openPath, quote)}
            >
              Try again
            </button>
          </div>
        ) : document ? (
          <div className="et-doc">
            <h4 className="et-doc-title">{document.title}</h4>
            <div className="text-muted et-doc-path">{document.path}</div>

            {document.isDeprecated || document.supersededByPath ? (
              <div className="et-doc-status">
                <div className="et-doc-status-title">
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    aria-hidden="true"
                  >
                    <circle cx="12" cy="12" r="9" />
                    <path d="M6 18L18 6" strokeLinecap="round" />
                  </svg>
                  {document.isDeprecated ? 'Deprecated' : 'Superseded'}
                </div>
                <div className="et-doc-status-note">
                  {document.isDeprecated
                    ? 'Marked out of date in the document itself. It stays in the index and in retrieval on purpose: an answer sometimes has to say that something is no longer current.'
                    : 'A later document exists in the same series.'}
                </div>
                {document.supersededByPath ? (
                  <button
                    type="button"
                    className="btn btn-ghost et-doc-successor"
                    onClick={() =>
                      document.supersededByPath && onOpenDocument(document.supersededByPath)
                    }
                  >
                    Open {document.supersededByPath.split('/').pop()} →
                  </button>
                ) : null}
              </div>
            ) : null}

            <dl className="et-doc-meta">
              <dt className="text-muted">Type</dt>
              <dd>{document.docType}</dd>
              <dt className="text-muted">Date</dt>
              <dd>
                {document.temporalDate
                  ? `${document.temporalDate}${
                      document.temporalPrecision ? ` · ${document.temporalPrecision} precision` : ''
                    }`
                  : 'none found in the file'}
              </dd>
              <dt className="text-muted">Project</dt>
              <dd>{document.project ?? 'none'}</dd>
            </dl>

            <hr className="hr" />

            <div className="et-doc-body">
              {paragraphs.map((paragraph, index) => (
                <p
                  key={index}
                  ref={index === highlighted ? highlightRef : undefined}
                  data-quoted={index === highlighted || undefined}
                >
                  {paragraph}
                </p>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
