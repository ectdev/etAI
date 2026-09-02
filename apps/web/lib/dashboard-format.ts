import type { RunCounts } from '@etai/core/dashboard';
import type { Coverage } from '@etai/shared';

/**
 * Turning stored values into what the dashboard prints.
 *
 * Pure functions, kept away from the components, because every one of these has a case
 * that reads wrong rather than throwing: a duration of 84492 ms printed as "84492 ms", a
 * run from four hours ago printed as "240 minutes ago", a null latency printed as "null
 * ms". None of those fail a build or a request. They are just wrong on screen.
 */

/**
 * How long ago, in the coarsest unit that is still true.
 *
 * `now` is a parameter rather than read inside, so the tests are not comparing against a
 * clock that moves while they run.
 */
export function relativeTime(at: Date, now: Date = new Date()): string {
  const seconds = Math.round((now.getTime() - at.getTime()) / 1000);

  if (seconds < 0) return 'just now';
  if (seconds < 60) return seconds < 10 ? 'just now' : `${seconds} seconds ago`;

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return minutes === 1 ? 'a minute ago' : `${minutes} minutes ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? 'an hour ago' : `${hours} hours ago`;

  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;

  return at.toISOString().slice(0, 10);
}

/** The timestamp itself, to the minute, in the shape the design prints it. */
export function timestamp(at: Date): string {
  return at.toISOString().slice(0, 16).replace('T', ' ');
}

/**
 * A duration a person can compare at a glance.
 *
 * Three bands, because a run can take 170 ms or a minute and a half and one format
 * cannot serve both. The first full index of this corpus takes about 85 seconds and a
 * rerun takes under a fifth of a second, so both ends are ordinary here.
 */
export function duration(ms: number | null): string {
  if (ms === null) return 'still running';
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;

  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);

  return `${minutes} m ${seconds} s`;
}

/** A recorded latency, or a dash where nothing was recorded. */
export function latency(ms: number | null): string {
  return ms === null ? 'not recorded' : duration(ms);
}

/**
 * The five outcomes of a run, in the order the column header names them.
 *
 * Deletions are printed. The design's header lists four numbers and the pipeline produces
 * five: a document removed from the corpus is a real outcome, and a run that removed
 * three documents while showing four zeros would be reporting the wrong thing quietly.
 */
export function countsLabel(counts: RunCounts): string {
  return [counts.created, counts.updated, counts.skipped, counts.deleted, counts.failed].join(
    ' / ',
  );
}

/** How many documents the run looked at, which is what the counts add up to. */
export function documentsSeen(counts: RunCounts): number {
  return counts.created + counts.updated + counts.skipped + counts.deleted + counts.failed;
}

/**
 * Where a run came from.
 *
 * The design prints "CLI · pnpm ingest --write", including the command. The command is
 * not stored, and writing it here would be inventing a fact about a run nobody recorded,
 * so the source is named and the command is not.
 */
export function triggerLabel(trigger: string, email: string | null, queued = false): string {
  const source =
    trigger === 'cli'
      ? 'Command line'
      : trigger === 'dashboard'
        ? 'Dashboard'
        : trigger === 'watch'
          ? 'Corpus watcher'
          : trigger === 'schedule'
            ? 'Schedule'
            : 'Seed';

  // Two watcher runs in a row otherwise look like two separate edits. This one started
  // because files changed while the run above it was still going.
  const detail = email ?? (queued ? 'queued behind the previous run' : null);

  return detail ? `${source}, ${detail}` : source;
}

/**
 * A document's date, at the precision it is actually known to.
 *
 * Most dates in this collection come out of a file name, and a monthly report gives a
 * month. Printing `2026-03-01` for it would invent a day nobody wrote down, which is the
 * same mistake as a driver turning a calendar date into midnight in some timezone.
 */
export function documentDate(date: string | null, precision: 'day' | 'month' | null): string {
  if (!date) return 'not dated';

  return precision === 'month' ? date.slice(0, 7) : date;
}

/** Whether a document can actually be found by a search, which is not whether it exists. */
export const DOCUMENT_STATUS: Record<string, string> = {
  indexed: 'Indexed',
  not_embedded: 'No embedding',
};

/** The outcome tag, as the design words it. */
export const RUN_OUTCOME: Record<string, string> = {
  running: 'Running',
  completed: 'Completed',
  partial: 'Partial',
  failed: 'Failed',
};

/**
 * Coverage in one or two words, for a table column.
 *
 * Deliberately shorter than the badge on the chat page, which has room to explain itself
 * to somebody reading an answer. This is the same four values seen by somebody scanning a
 * list of them, and "Answered from the corpus" repeated down a column says less than
 * "Full" does.
 */
export const COVERAGE_SHORT: Record<Coverage, string> = {
  full: 'Full',
  partial: 'Partial',
  not_documented: 'Not documented',
  out_of_scope: 'Out of scope',
};
