import type { IndexHealth, QuestionStats, RecentQuery, RunSummary } from '@etai/core/dashboard';
import Link from 'next/link';
import { duration, latency, relativeTime, timestamp } from '@/lib/dashboard-format';
import { QueryRows } from './query-rows';
import { RunRows } from './run-rows';

/**
 * The dashboard overview.
 *
 * Four panels, and each one is given its own result rather than a shared blob, because
 * each can fail on its own. A statistics query that times out should cost the reader the
 * statistics and nothing else; the index health beside it comes from a different query
 * and is still true. The design draws each panel with its own error state for that
 * reason, and this passes a `Failed` union through instead of throwing.
 */

export type Panel<T> = { ok: true; data: T } | { ok: false; reason: string };

interface Props {
  health: Panel<IndexHealth>;
  runs: Panel<RunSummary[]>;
  stats: Panel<QuestionStats>;
  queries: Panel<RecentQuery[]>;
  /** Fixed once on the server, so every relative time on the page agrees with the others. */
  now: number;
}

function PanelError({ title, body }: { title: string; body: string }) {
  return (
    <div className="et-panel-error">
      <div className="et-panel-error-title">{title}</div>
      <p className="et-panel-error-body">{body}</p>
    </div>
  );
}

function Metric({
  label,
  value,
  sub,
  small,
  tag,
  bar,
}: {
  label: string;
  value: string;
  sub: string;
  small?: boolean;
  tag?: string;
  bar?: { of: number; total: number };
}) {
  return (
    <div className="card elev-sm et-metric">
      <div className="text-muted et-eyebrow">{label}</div>
      <div className="et-metric-value">
        <strong className={small ? 'et-metric-small' : undefined}>{value}</strong>
        {tag ? <span className="tag tag-neutral">{tag}</span> : null}
      </div>
      {bar && bar.total > 0 ? (
        <div className="et-metric-bar">
          <span style={{ width: `${Math.round((bar.of / bar.total) * 100)}%` }} />
        </div>
      ) : null}
      <div className="text-muted et-metric-sub">{sub}</div>
    </div>
  );
}

export function DashboardOverview({ health, runs, stats, queries, now }: Props) {
  const lastRun = runs.ok ? runs.data[0] : undefined;

  return (
    <div className="et-dash">
      <div className="et-dash-inner">
        <div className="et-dash-head">
          <h3>Overview</h3>
          <p className="text-muted">
            Corpus health, ingestion history and what people are asking.{' '}
            <Link href="/dashboard/documents">See the indexed documents</Link>.
          </p>
        </div>

        <section>
          {health.ok || stats.ok ? (
            <div className="et-metrics">
              {health.ok ? (
                <Metric
                  label="Documents indexed"
                  value={String(health.data.documentsIndexed)}
                  sub={
                    health.data.filesInLastRun === null
                      ? 'nothing has been read in yet'
                      : `${health.data.chunks} chunks, ${health.data.embedded} with an embedding`
                  }
                />
              ) : null}

              {lastRun ? (
                <Metric
                  label="Last ingestion"
                  small
                  value={relativeTime(lastRun.startedAt, new Date(now))}
                  tag={lastRun.status === 'completed' ? 'Completed' : 'Partial'}
                  sub={`${lastRun.counts.created} added, ${lastRun.counts.updated} updated, ${lastRun.counts.skipped} skipped in ${duration(lastRun.durationMs)}`}
                />
              ) : null}

              {stats.ok ? (
                <Metric
                  label="Questions, last 7 days"
                  value={String(stats.data.lastSevenDays)}
                  sub={
                    stats.data.bySource.mcp > 0
                      ? `${stats.data.bySource.web} through the browser, ${stats.data.bySource.mcp} through MCP`
                      : stats.data.medianLatencyMs === null
                        ? `${stats.data.today} today`
                        : `${stats.data.today} today, median ${latency(stats.data.medianLatencyMs)} end to end`
                  }
                />
              ) : null}

              {stats.ok ? (
                <Metric
                  label="Answered or declined"
                  value={`${stats.data.answered} / ${stats.data.declined}`}
                  bar={{
                    of: stats.data.answered,
                    total: stats.data.answered + stats.data.declined,
                  }}
                  sub={`${stats.data.answered} carried an answer, ${stats.data.declined} said the corpus does not cover it`}
                />
              ) : null}
            </div>
          ) : (
            <PanelError
              title="Headline numbers are unavailable"
              body="The statistics query did not return. Nothing else on this page depends on it."
            />
          )}
        </section>

        <section>
          <div className="et-dash-section-head">
            <h6>Index health</h6>
            {health.ok && health.data.lastSynchronised ? (
              <span className="text-muted et-dash-checked">
                read {relativeTime(health.data.lastSynchronised, new Date(now))}
              </span>
            ) : null}
          </div>

          {health.ok ? (
            <div className="et-health">
              {health.data.documentsIndexed === 0 ? (
                <p style={{ margin: '0 0 var(--space-3)', fontSize: '13px', lineHeight: 1.6 }}>
                  The schema and both indexes are in place. Nothing has been read into them yet, so
                  every reading below is zero.
                </p>
              ) : null}

              <div className="et-health-grid">
                <span className="text-muted">Documents indexed</span>
                <span>
                  {health.data.filesInLastRun === null
                    ? String(health.data.documentsIndexed)
                    : `${health.data.documentsIndexed} of ${health.data.filesInLastRun} files`}
                </span>

                <span className="text-muted">Chunks with an embedding</span>
                <span
                  className={health.data.embedded === health.data.chunks ? '' : 'et-health-wrong'}
                >
                  {health.data.embedded} of {health.data.chunks}
                </span>

                <span className="text-muted">Embedding model</span>
                <span>{health.data.embeddingModel}</span>

                <span className="text-muted">Vector dimensions</span>
                <span>{health.data.vectorDimensions}</span>

                <span className="text-muted">Vector index</span>
                <span className={health.data.vectorIndex ? '' : 'et-health-wrong'}>
                  {health.data.vectorIndex ?? 'missing'}
                </span>

                <span className="text-muted">Keyword index</span>
                <span className={health.data.keywordIndex ? '' : 'et-health-wrong'}>
                  {health.data.keywordIndex ?? 'missing'}
                </span>

                <span className="text-muted">Corpus last synchronised</span>
                <span>
                  {health.data.lastSynchronised ? timestamp(health.data.lastSynchronised) : 'never'}
                </span>
              </div>
            </div>
          ) : (
            <PanelError
              title="Could not read the index"
              body="The database did not answer. Search and answering read the same tables, so they are likely affected too."
            />
          )}
        </section>

        <section style={{ minWidth: 0 }}>
          <div className="et-dash-section-head">
            <h6>Recent ingestion runs</h6>
          </div>

          {!runs.ok ? (
            <PanelError
              title="Run history is unavailable"
              body="The query failed. Ingestion itself is unaffected and can still be run from the command line."
            />
          ) : runs.data.length === 0 ? (
            <div className="et-dash-empty">
              <div className="et-dash-empty-title">No ingestion has run yet</div>
              <p className="text-muted">
                Reading the corpus takes about ninety seconds the first time and under a second on
                every run after that, because unchanged files are recognised by their hash and
                skipped. Run <code>pnpm ingest --write</code> to index it.
              </p>
            </div>
          ) : (
            <RunRows runs={runs.data} now={now} />
          )}
        </section>

        <section>
          <div className="et-dash-section-head">
            <h6>Recent questions</h6>
            {stats.ok && stats.data.unrecorded > 0 ? (
              <span className="text-muted et-dash-checked">
                {stats.data.unrecorded} could not be recorded since this process started, so these
                counts are short by at least that many
              </span>
            ) : null}
          </div>

          {!queries.ok ? (
            <PanelError
              title="Question history is unavailable"
              body="Recording a question is allowed to fail without failing the question itself, so answers are still being served while this is down."
            />
          ) : queries.data.length === 0 ? (
            <div className="et-dash-empty">
              <div className="et-dash-empty-title">Nobody has asked anything yet</div>
              <p className="text-muted">
                Every question is recorded here with the coverage it reached and how long it took,
                including the ones the collection correctly declines.
              </p>
            </div>
          ) : (
            <QueryRows queries={queries.data} now={now} />
          )}
        </section>
      </div>
    </div>
  );
}
