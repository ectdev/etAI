/**
 * When to run an ingestion, given a stream of "something changed" notifications.
 *
 * Separate from the file watcher on purpose. This half is the part with the awkward
 * cases in it, and keeping it free of `fs.watch` means the tests for those cases use a
 * fake clock and a counter instead of real files, real timers and a real corpus.
 *
 * It never decides *what* changed. That is the hash diff's job, and the observations
 * below are why: the event names cannot carry it.
 */

/**
 * How long to wait after the last notification before running.
 *
 * Measured rather than chosen. Watching `corpus/` with `fs.watch` on macOS:
 *
 *   one file appended, six runs   2 to 3 events each, largest gap 443 ms
 *   two saves 40 ms apart          3 events, largest gap 77 ms
 *   a file deleted                 1 event
 *   branch switch, 30 files        42 events over 1118 ms, largest gap 474 ms,
 *                                  but only 13 distinct filenames for 30 changed files
 *
 * So a single logical change is not a single event, and the gaps inside one change reach
 * 474 ms. A 300 ms window would have split the first observation into two runs, and two
 * runs means paying the embedding API twice for one edit. One second clears every gap
 * observed with room to spare, and the cost of it being too long is that a reindex starts
 * a second later, which nobody is waiting on.
 *
 * The 13-of-30 result is the other half. Those 30 files really did change; macOS coalesced
 * the notifications and dropped most of the names. Anything built on the names would have
 * missed 17 files.
 */
export const DEBOUNCE_MS = 1000;

export interface Scheduler {
  /** Something changed. Starts or extends the wait. */
  notify(): void;
  /** Stops accepting work and waits for a run already in progress. */
  close(): Promise<void>;
}

export interface SchedulerOptions {
  /**
   * `queued` is true when this run exists because changes arrived while the previous one
   * was still going, which is recorded against the run so the log distinguishes it from
   * somebody saving a file the moment a run ended.
   */
  run: (context: { queued: boolean }) => Promise<void>;
  debounceMs?: number;
  /** Reports what the scheduler decided. Errors from `run` arrive here too. */
  onEvent?: (event: SchedulerEvent) => void;
}

export type SchedulerEvent =
  | { kind: 'waiting'; ms: number }
  | { kind: 'started'; queued: boolean }
  | { kind: 'finished'; queued: boolean; ms: number }
  | { kind: 'coalesced' }
  | { kind: 'failed'; error: Error }
  | { kind: 'dropped' };

export function createScheduler(options: SchedulerOptions): Scheduler {
  const debounceMs = options.debounceMs ?? DEBOUNCE_MS;
  const report = options.onEvent ?? (() => {});

  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> | undefined;
  let closed = false;

  /** A change arrived mid-run. One flag rather than a count: the diff reads the corpus. */
  let changedDuringRun = false;
  /** Whether the next run was caused by that flag. */
  let nextIsQueued = false;

  function schedule(): void {
    // Only announced when the wait begins. A branch switch produces 42 notifications and
    // one run, so reporting each extension would be 42 lines describing one decision.
    if (timer === undefined) report({ kind: 'waiting', ms: debounceMs });
    else clearTimeout(timer);

    timer = setTimeout(start, debounceMs);
  }

  function start(): void {
    timer = undefined;
    if (closed) return;

    const queued = nextIsQueued;
    nextIsQueued = false;
    changedDuringRun = false;

    report({ kind: 'started', queued });
    const startedAt = Date.now();

    // An async wrapper rather than `options.run(...).then(...)`, so that a callback which
    // throws before returning its promise becomes a rejection here instead of an
    // exception thrown out of a timer callback, where nothing can catch it and the
    // process ends.
    running = (async () => {
      try {
        await options.run({ queued });
        report({ kind: 'finished', queued, ms: Date.now() - startedAt });
      } catch (error: unknown) {
        // A failed run must not stop the watcher. The next save gets another attempt,
        // because the usual cause is the embedding API being briefly unavailable rather
        // than anything wrong with the file that was saved.
        report({
          kind: 'failed',
          error: error instanceof Error ? error : new Error(String(error)),
        });
      } finally {
        running = undefined;

        if (changedDuringRun) {
          changedDuringRun = false;

          if (closed) {
            // Deliberately not started. Shutdown means stop, and the hash diff picks these
            // files up on the next run whenever that happens.
            report({ kind: 'dropped' });
          } else {
            nextIsQueued = true;
            schedule();
          }
        }
      }
    })();
  }

  return {
    notify(): void {
      if (closed) return;

      if (running !== undefined) {
        // Not queued as a second run. Two ingestions at once write the same rows, and
        // the second would be diffing against a database the first is halfway through
        // updating. However many changes arrive during a run, they produce one follow-up.
        if (!changedDuringRun) report({ kind: 'coalesced' });
        changedDuringRun = true;
        return;
      }

      schedule();
    },

    async close(): Promise<void> {
      closed = true;

      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
        // Changes were waiting out the debounce and will not be indexed now. Saying so is
        // better than a silent exit, since the corpus and the index are out of step until
        // the next run.
        report({ kind: 'dropped' });
      }

      await running;
    },
  };
}
