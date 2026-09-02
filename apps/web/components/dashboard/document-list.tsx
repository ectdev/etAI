'use client';

import type { DocumentRow } from '@etai/core/dashboard';
import { useMemo, useState } from 'react';
import { fetchDocument, RequestFailed } from '@/lib/ask-client';
import { DOCUMENT_STATUS, documentDate, timestamp } from '@/lib/dashboard-format';
import type { DocumentDetail } from '@/lib/chat-types';

/**
 * Every indexed document, filtered in the browser.
 *
 * All 142 arrive in one payload of about 57 KB, so filtering is an array operation rather
 * than a request. Server-side paging would be machinery protecting against a page that
 * does not exist here, and the cost of adding it if the corpus grows is one query and one
 * component rather than a rewrite.
 *
 * A row expands into the document itself, which is fetched when it is opened rather than
 * shipped with the list: the bodies are 111 KB and a table of names does not need them.
 * The fetch reuses `/api/documents`, the same endpoint the chat panel opens a citation
 * with, because a second endpoint returning the same document is a second thing to keep
 * in step.
 */

interface Props {
  documents: DocumentRow[];
  types: string[];
}

type StatusFilter = 'all' | 'indexed' | 'not_embedded' | 'retired' | 'replaced';

const STATUS_FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'Any status' },
  { value: 'indexed', label: 'Indexed' },
  { value: 'not_embedded', label: 'No embedding' },
  { value: 'retired', label: 'Retired' },
  { value: 'replaced', label: 'Replaced by a newer one' },
];

function matchesStatus(row: DocumentRow, filter: StatusFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'retired':
      return row.isDeprecated;
    case 'replaced':
      return row.supersededByPath !== null;
    default:
      return row.status === filter;
  }
}

export function DocumentList({ documents, types }: Props) {
  const [type, setType] = useState('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [open, setOpen] = useState<string | null>(null);
  const [detail, setDetail] = useState<DocumentDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const shown = useMemo(
    () =>
      documents.filter(
        (row) => (type === 'all' || row.docType === type) && matchesStatus(row, status),
      ),
    [documents, type, status],
  );

  async function toggle(row: DocumentRow) {
    if (open === row.id) {
      setOpen(null);
      return;
    }

    setOpen(row.id);
    setDetail(null);
    setDetailError(null);
    setLoading(true);

    try {
      setDetail(await fetchDocument(row.path, new AbortController().signal));
    } catch (error) {
      setDetailError(
        error instanceof RequestFailed ? error.failure.message : 'That document could not be read.',
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="et-doc-filters">
        <label>
          <span className="text-muted et-eyebrow">Type</span>
          <select className="input" value={type} onChange={(event) => setType(event.target.value)}>
            <option value="all">Any type</option>
            {types.map((value) => (
              <option key={value} value={value}>
                {value.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span className="text-muted et-eyebrow">Status</span>
          <select
            className="input"
            value={status}
            onChange={(event) => setStatus(event.target.value as StatusFilter)}
          >
            {STATUS_FILTERS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <span className="text-muted et-doc-count" aria-live="polite">
          {shown.length === documents.length
            ? `${documents.length} documents`
            : `${shown.length} of ${documents.length} documents`}
        </span>
      </div>

      <div className="et-docs">
        <div className="et-row-head text-muted">
          <span>Name</span>
          <span className="et-row-trigger">Type</span>
          <span className="et-row-date">Date</span>
          <span className="et-row-outcome">Status</span>
        </div>

        {shown.length === 0 ? (
          <div className="et-dash-empty">
            <div className="et-dash-empty-title">No document matches that filter</div>
            <p className="text-muted">
              The corpus holds {documents.length} documents. Widen the filter to see them.
            </p>
          </div>
        ) : null}

        {shown.map((row) => {
          const expanded = open === row.id;

          return (
            <div key={row.id}>
              <button
                type="button"
                className="et-row"
                aria-expanded={expanded}
                aria-controls={`doc-${row.id}`}
                onClick={() => void toggle(row)}
              >
                <span className="et-row-question">
                  {row.title}
                  <span className="text-muted et-row-path">{row.path}</span>
                </span>
                <span className="et-row-trigger text-muted">{row.docType.replace(/_/g, ' ')}</span>
                <span className="et-row-date">
                  {documentDate(row.temporalDate, row.temporalPrecision)}
                </span>
                <span className="et-row-outcome">
                  {/* Retirement first: it is the one that changes how an answer reads. */}
                  {row.isDeprecated ? <span className="tag tag-accent">Retired</span> : null}
                  {row.supersededByPath ? <span className="tag tag-outline">Replaced</span> : null}
                  {!row.isDeprecated && !row.supersededByPath ? (
                    <span
                      className={row.status === 'indexed' ? 'tag tag-neutral' : 'tag tag-accent'}
                    >
                      {DOCUMENT_STATUS[row.status] ?? row.status}
                    </span>
                  ) : null}
                </span>
              </button>

              {expanded ? (
                <div className="et-row-detail" id={`doc-${row.id}`}>
                  <div className="et-row-facts">
                    <span>
                      <span className="text-muted">Path</span> <code>{row.path}</code>
                    </span>
                    <span>
                      <span className="text-muted">Type</span> {row.docType.replace(/_/g, ' ')}
                    </span>
                    <span>
                      <span className="text-muted">Date</span>{' '}
                      {documentDate(row.temporalDate, row.temporalPrecision)}
                    </span>
                    {row.project ? (
                      <span>
                        <span className="text-muted">Project</span> {row.project}
                      </span>
                    ) : null}
                    {row.versionSeries ? (
                      <span>
                        <span className="text-muted">Version</span> {row.versionSeries}{' '}
                        {row.versionNumber}
                      </span>
                    ) : null}
                    <span>
                      <span className="text-muted">Chunks embedded</span> {row.embeddedChunks} of{' '}
                      {row.chunks}
                    </span>
                    <span>
                      <span className="text-muted">Indexed</span>{' '}
                      {row.indexedAt ? timestamp(row.indexedAt) : 'never'}
                    </span>
                  </div>

                  {row.isDeprecated ? (
                    <p className="et-doc-status-note">
                      Marked as retired. It stays in the index and in retrieval on purpose, because
                      an answer sometimes has to say that something is out of date.
                    </p>
                  ) : null}

                  {row.supersededByPath ? (
                    <p className="et-doc-status-note">
                      Replaced by{' '}
                      <button
                        type="button"
                        className="et-link-button"
                        onClick={() => {
                          const next = documents.find(
                            (candidate) => candidate.path === row.supersededByPath,
                          );
                          if (next) void toggle(next);
                        }}
                      >
                        {row.supersededByPath}
                      </button>
                      . Retrieval prefers the newer one, and this is still searchable so a question
                      about what changed can reach it.
                    </p>
                  ) : null}

                  {loading ? <div className="et-skeleton-stack" aria-hidden="true" /> : null}
                  {detailError ? <p className="et-panel-error-body">{detailError}</p> : null}
                  {detail && !loading ? <pre className="et-doc-body">{detail.content}</pre> : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </>
  );
}
