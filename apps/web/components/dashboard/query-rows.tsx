'use client';

import type { RecentQuery } from '@etai/core/dashboard';
import { useState } from 'react';
import { COVERAGE_SHORT, latency, relativeTime } from '@/lib/dashboard-format';

/**
 * What people have been asking, and how much of it the collection could answer.
 *
 * The coverage column is the point of this table rather than decoration on it. A count of
 * searches says the system was used; a count of searches by coverage says whether the
 * collection holds what people came for, and a run of `not_documented` on one subject is
 * a gap in the corpus rather than a fault in retrieval.
 *
 * The expansion shows total latency rather than splitting retrieval from generation. The
 * split exists in the answer and is not stored on the row, and printing a guess at it
 * beside three measured numbers would be worse than not printing it.
 */
export function QueryRows({ queries, now }: { queries: RecentQuery[]; now: number }) {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div className="et-queries">
      <div className="et-row-head text-muted">
        <span>Question</span>
        <span>Coverage</span>
        <span className="et-row-number">Latency</span>
        <span className="et-row-ago">When</span>
      </div>

      {queries.map((query) => {
        const expanded = open === query.id;

        return (
          <div key={query.id}>
            <button
              type="button"
              className="et-row"
              aria-expanded={expanded}
              aria-controls={`query-${query.id}`}
              onClick={() => setOpen(expanded ? null : query.id)}
            >
              <span className="et-row-question">{query.query}</span>
              <span>
                <span className="tag tag-neutral">
                  {query.coverage ? COVERAGE_SHORT[query.coverage] : 'Not recorded'}
                </span>
              </span>
              <span className="et-row-number">{latency(query.latencyMs)}</span>
              <span className="et-row-ago text-muted">
                {relativeTime(query.createdAt, new Date(now))}
              </span>
            </button>

            {expanded ? (
              <div className="et-row-detail" id={`query-${query.id}`}>
                <p style={{ margin: '0 0 var(--space-3)', fontSize: '14px' }}>{query.query}</p>
                <div className="et-row-facts">
                  <span>
                    <span className="text-muted">End to end</span> {latency(query.latencyMs)}
                  </span>
                  <span>
                    <span className="text-muted">Documents retrieved</span> {query.resultCount}
                  </span>
                  <span>
                    <span className="text-muted">Model</span>{' '}
                    {query.generationModel ?? 'no model was called'}
                  </span>
                  <span>
                    <span className="text-muted">Asked through</span>{' '}
                    {query.source === 'mcp' ? 'the MCP server' : 'the browser'}
                  </span>
                </div>
                {query.coverage === 'out_of_scope' && query.latencyMs !== null ? (
                  <p className="text-muted">
                    Refusals that never reach a model cost one embedding call and show a latency in
                    the hundreds of milliseconds rather than the seconds an answer takes.
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
