import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createScheduler, DEBOUNCE_MS, type SchedulerEvent } from './schedule.js';

/**
 * The scheduler, on a fake clock.
 *
 * Every case here is about timing, and testing timing against a real clock means either
 * sleeping through it or picking a margin and hoping. The fake clock makes "a change
 * arrived 3 ms before the run finished" something that can be written down exactly.
 *
 * The thing being protected is money. Each run this starts reads the corpus and embeds
 * whatever changed, so a scheduler that turns one edit into two runs pays twice, and one
 * that starts a second run while the first is writing gives the second a database view
 * that is halfway updated.
 */

/** A run whose duration and completion the test controls. */
function controllableRun() {
  const calls: Array<{ queued: boolean }> = [];
  let release: (() => void) | undefined;

  return {
    calls,
    /** Lets the run in progress finish. */
    finish(): void {
      release?.();
      release = undefined;
    },
    fn: (context: { queued: boolean }): Promise<void> => {
      calls.push(context);
      return new Promise<void>((resolve) => {
        release = resolve;
      });
    },
  };
}

let events: SchedulerEvent[] = [];
const record = (event: SchedulerEvent) => events.push(event);
const kinds = () => events.map((event) => event.kind);

beforeEach(() => {
  vi.useFakeTimers();
  events = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe('one logical change', () => {
  it('produces exactly one run, after the debounce and not before', async () => {
    const run = controllableRun();
    const scheduler = createScheduler({ run: run.fn, debounceMs: 50, onEvent: record });

    scheduler.notify();

    // The premise. If this fired immediately the test below would pass for the wrong
    // reason, because one run is one run whenever it happens.
    await vi.advanceTimersByTimeAsync(49);
    expect(run.calls, 'ran before the debounce elapsed').toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1);
    expect(run.calls).toEqual([{ queued: false }]);

    run.finish();
    await scheduler.close();
  });

  it('is still one run when the platform reports it as several events', async () => {
    /**
     * The measured case. One `appendFileSync` to a corpus file produced two or three
     * events on macOS, with gaps up to 443 ms, and a branch switch across 30 files
     * produced 42 events over 1118 ms with a largest gap of 474 ms.
     *
     * Replayed here at the real spacing against the real DEBOUNCE_MS, so this fails if
     * somebody lowers that constant to a number that sounds tidier.
     */
    const run = controllableRun();
    const scheduler = createScheduler({ run: run.fn, onEvent: record });

    const gaps = [0, 51, 443, 22, 474, 423, 100];
    for (const gap of gaps) {
      await vi.advanceTimersByTimeAsync(gap);
      scheduler.notify();
    }

    expect(run.calls, 'a burst was still waiting').toHaveLength(0);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(run.calls, 'one burst became more than one run').toHaveLength(1);

    // And the wait was announced once rather than once per event.
    expect(kinds().filter((kind) => kind === 'waiting')).toHaveLength(1);

    run.finish();
    await scheduler.close();
  });
});

describe('a change arriving while a run is in progress', () => {
  it('starts nothing while that run is going, however long it takes', async () => {
    /**
     * Added after a falsification run found nothing.
     *
     * The test below held the run open and checked the count immediately, so a scheduler
     * that set a timer during the run passed it: the timer had not fired yet. A real
     * ingestion over 142 documents takes far longer than a second, so the timer firing
     * mid-run is the ordinary case, not an edge, and it would mean two runs writing the
     * same rows while each diffs against what the other is halfway through changing.
     */
    const run = controllableRun();
    const scheduler = createScheduler({ run: run.fn, debounceMs: 50, onEvent: record });

    scheduler.notify();
    await vi.advanceTimersByTimeAsync(50);
    expect(run.calls).toHaveLength(1);

    scheduler.notify();
    await vi.advanceTimersByTimeAsync(500); // ten debounce intervals, run still going

    expect(run.calls, 'a second run started on top of the first').toHaveLength(1);

    run.finish();
    await vi.advanceTimersByTimeAsync(50);
    expect(run.calls).toEqual([{ queued: false }, { queued: true }]);

    run.finish();
    await scheduler.close();
  });

  it('starts one more run afterwards, marked queued, however many changes arrived', async () => {
    const run = controllableRun();
    const scheduler = createScheduler({ run: run.fn, debounceMs: 50, onEvent: record });

    scheduler.notify();
    await vi.advanceTimersByTimeAsync(50);
    expect(run.calls).toHaveLength(1);

    // Four changes during the run. One follow-up, not four.
    scheduler.notify();
    scheduler.notify();
    scheduler.notify();
    scheduler.notify();
    expect(run.calls, 'started a second run on top of the first').toHaveLength(1);

    run.finish();
    await vi.advanceTimersByTimeAsync(50);

    expect(run.calls).toEqual([{ queued: false }, { queued: true }]);
    expect(kinds().filter((kind) => kind === 'coalesced')).toHaveLength(1);

    run.finish();
    await scheduler.close();
  });

  it('does not mark a run queued when the change arrived after the previous one ended', async () => {
    // The distinction the `queued` column exists to record. Without this, the assertion
    // above would pass for a scheduler that marked every second run queued.
    const run = controllableRun();
    const scheduler = createScheduler({ run: run.fn, debounceMs: 50, onEvent: record });

    scheduler.notify();
    await vi.advanceTimersByTimeAsync(50);
    run.finish();
    await vi.advanceTimersByTimeAsync(0);

    scheduler.notify();
    await vi.advanceTimersByTimeAsync(50);

    expect(run.calls).toEqual([{ queued: false }, { queued: false }]);

    run.finish();
    await scheduler.close();
  });
});

describe('a run that throws', () => {
  it('is reported and leaves the scheduler working', async () => {
    // The watcher runs unattended. If a failed run stopped it, an embedding API outage
    // would silently end reindexing and the index would drift from the corpus with
    // nothing on screen to say so.
    const failing = vi.fn().mockRejectedValueOnce(new Error('embedding provider is down'));
    const scheduler = createScheduler({ run: failing, debounceMs: 50, onEvent: record });

    scheduler.notify();
    await vi.advanceTimersByTimeAsync(50);

    expect(events.find((event) => event.kind === 'failed')).toBeDefined();

    failing.mockResolvedValueOnce(undefined);
    scheduler.notify();
    await vi.advanceTimersByTimeAsync(50);

    expect(failing, 'the scheduler stopped after a failure').toHaveBeenCalledTimes(2);
    await scheduler.close();
  });

  it('survives a callback that throws before returning a promise', async () => {
    // A synchronous throw inside a timer callback has nothing to catch it and ends the
    // process. This was true of the first version of this file.
    const scheduler = createScheduler({
      run: () => {
        throw new Error('thrown, not rejected');
      },
      debounceMs: 50,
      onEvent: record,
    });

    scheduler.notify();
    await vi.advanceTimersByTimeAsync(50);

    expect(events.find((event) => event.kind === 'failed')).toBeDefined();
    await scheduler.close();
  });
});

describe('shutdown', () => {
  it('waits for a run in progress rather than cutting it off', async () => {
    // The run holds a database connection and is partway through writing documents.
    // Returning from close() before it finishes would let the caller close the pool
    // underneath it.
    const run = controllableRun();
    const scheduler = createScheduler({ run: run.fn, debounceMs: 50, onEvent: record });

    scheduler.notify();
    await vi.advanceTimersByTimeAsync(50);

    let closed = false;
    const closing = scheduler.close().then(() => {
      closed = true;
    });

    await vi.advanceTimersByTimeAsync(1000);
    expect(closed, 'close() returned while a run was still going').toBe(false);

    run.finish();
    await closing;
    expect(closed).toBe(true);
  });

  it('starts nothing new, and says so when changes were still waiting', async () => {
    const run = controllableRun();
    const scheduler = createScheduler({ run: run.fn, debounceMs: 50, onEvent: record });

    scheduler.notify();
    await scheduler.close();
    await vi.advanceTimersByTimeAsync(1000);

    expect(run.calls, 'a run started after close()').toHaveLength(0);
    expect(kinds()).toContain('dropped');
  });

  it('ignores a notification that arrives after close', async () => {
    const run = controllableRun();
    const scheduler = createScheduler({ run: run.fn, debounceMs: 50, onEvent: record });

    await scheduler.close();
    scheduler.notify();
    await vi.advanceTimersByTimeAsync(1000);

    expect(run.calls).toHaveLength(0);
  });

  it('does not start the queued follow-up if the change arrived during the last run', async () => {
    const run = controllableRun();
    const scheduler = createScheduler({ run: run.fn, debounceMs: 50, onEvent: record });

    scheduler.notify();
    await vi.advanceTimersByTimeAsync(50);
    scheduler.notify();

    const closing = scheduler.close();
    run.finish();
    await closing;
    await vi.advanceTimersByTimeAsync(1000);

    expect(run.calls, 'shutdown started the queued run anyway').toHaveLength(1);
    expect(kinds()).toContain('dropped');
  });
});
