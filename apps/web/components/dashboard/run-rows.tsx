'use client';

import type { RunSummary } from '@etai/core/dashboard';
import { useState } from 'react';
import {
  countsLabel,
  documentsSeen,
  duration,
  relativeTime,
  RUN_OUTCOME,
  timestamp,
  triggerLabel,
} from '@/lib/dashboard-format';

/**
 * The ingestion history, one row per run, expanding to what happened inside it.
 *
 * The expansion is where a partial run becomes readable. A run that indexed 139 documents
 * and failed on 3 reports itself as partial, and the only useful question after that is
 * which three and why. That answer is a row in `ingestion_item`, and it is the reason
 * ingestion records per file rather than only per run.
 */
export function RunRows({ runs, now }: { runs: RunSummary[]; now: number }) {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div className="et-runs">
      <div className="et-row-head text-muted">
        <span>Started</span>
        <span className="et-row-trigger">Trigger</span>
        <span className="et-row-counts">Added / updated / skipped / deleted / failed</span>
        <span className="et-row-outcome">Outcome</span>
      </div>

      {runs.map((run) => {
        const expanded = open === run.id;

        return (
          <div key={run.id}>
            <button
              type="button"
              className="et-row"
              aria-expanded={expanded}
              aria-controls={`run-${run.id}`}
              onClick={() => setOpen(expanded ? null : run.id)}
            >
              <span className="et-row-when">
                {timestamp(run.startedAt)}
                <span className="text-muted">{relativeTime(run.startedAt, new Date(now))}</span>
              </span>
              <span className="et-row-trigger text-muted">
                {triggerLabel(run.trigger, run.triggeredBy, run.queued)}
              </span>
              <span className="et-row-counts">{countsLabel(run.counts)}</span>
              <span className="et-row-outcome">
                <span
                  className="tag tag-neutral"
                  style={
                    run.status === 'completed'
                      ? undefined
                      : {
                          border: '1px solid var(--color-accent)',
                          background: 'transparent',
                          color: 'var(--color-accent)',
                        }
                  }
                >
                  {RUN_OUTCOME[run.status] ?? run.status}
                </span>
              </span>
            </button>

            {expanded ? (
              <div className="et-row-detail" id={`run-${run.id}`}>
                <div className="et-row-facts">
                  <span>
                    <span className="text-muted">Run</span> <code>{run.id.slice(0, 8)}</code>
                  </span>
                  <span>
                    <span className="text-muted">Duration</span> {duration(run.durationMs)}
                  </span>
                  <span>
                    <span className="text-muted">Documents</span> {documentsSeen(run.counts)}
                  </span>
                </div>

                {run.error ? <p>{run.error}</p> : null}

                {run.failures.length > 0 ? (
                  <div className="et-failures">
                    <div className="et-failures-title text-muted">
                      Documents that failed, and what the rest of the run did anyway
                    </div>
                    {run.failures.map((failure) => (
                      <div key={failure.path} className="et-failure-row">
                        <code>{failure.path}</code>
                        <span className="text-muted">{failure.error}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
