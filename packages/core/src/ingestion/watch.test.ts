import { mkdtempSync, rmSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { watchCorpus, type CorpusWatcher } from './watch.js';

/**
 * The watcher against real files and a real clock.
 *
 * `schedule.test.ts` covers the timing decisions on a fake clock. This file covers the
 * part that cannot be faked without testing the fake: that `fs.watch` actually reports
 * what this code expects it to report. The observations that shaped the design came from
 * running it, so the tests confirm them rather than restating them.
 *
 * Nothing here reaches the database or a model. `ingest` is replaced by a counter, since
 * what is being tested is when a run starts, not what a run does.
 */

const DEBOUNCE = 100;

/**
 * Above the thirty seconds `until` and `startLive` will wait, so a missing event fails
 * with the message that names it rather than with the runner's generic timeout.
 */
const TIMEOUT = 45_000;

let corpus: string;
let watcher: CorpusWatcher | undefined;
let runs: Array<{ queued: boolean }>;

beforeEach(() => {
  corpus = mkdtempSync(join(tmpdir(), 'etai-watch-'));
  runs = [];
});

afterEach(async () => {
  await watcher?.close();
  watcher = undefined;
  rmSync(corpus, { recursive: true, force: true });
});

function start() {
  watcher = watchCorpus({
    corpusPath: corpus,
    debounceMs: DEBOUNCE,
    ingest: async ({ queued }) => {
      runs.push({ queued });
    },
  });
}

/**
 * Waits until a condition holds, or gives up.
 *
 * The delay between writing a file and `fs.watch` reporting it was 216 to 817 ms in the
 * observations behind this design, so a fixed sleep would either be slow or flake. This
 * returns as soon as the thing happened.
 *
 * The ceiling is thirty seconds. It started at four, which was ample when this file ran
 * alone and not when it ran inside the full suite, where one case timed out at 4031 ms.
 * Ten was not enough either: with six busy cores on the machine, the recursive case timed
 * out at 10019 ms, reproducibly, about one run in three.
 *
 * That is the operating system rather than the watcher. FSEvents makes no promise about
 * when it delivers, which is the same property the watcher is built around: it ignores
 * the event names entirely and re-diffs, because a branch switch touching thirty files
 * arrives as forty-two events naming thirteen of them.
 *
 * So the number is a limit on waiting rather than a claim about the delay. A generous one
 * costs nothing when the event arrives, since this returns the moment the condition holds,
 * and it still fails when the event never comes at all.
 */
async function until(condition: () => boolean, timeoutMs = 30_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  return condition();
}

/** Long enough for an event to have arrived and the debounce to have elapsed. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 1500));

/**
 * Starts the watcher and returns once it has demonstrably reported a write.
 *
 * `fs.watch` returns before the operating system is delivering events for it. On macOS
 * the recursive watch is an FSEvents stream, and a write landing in the gap between the
 * call returning and the stream going live is never reported at all. The tests here
 * used to write straight after starting, and about one run in three the write fell into
 * that gap: no event, no run, and a timeout that looked like a broken watcher. Node's
 * own test suite works around the same libuv behaviour by waiting before its first write
 * (nodejs/node 4f82673).
 *
 * A fixed wait is a guess about the machine. This writes a file of its own until a run
 * shows the watcher is live, waits until runs have stopped arriving, and then forgets
 * them, so each test starts from a watcher known to be listening and an empty record. It
 * also gives the tests that expect no run something to stand on: zero runs from a watcher
 * proven live means the filter worked, not that nothing was listening.
 *
 * The product does not need this. The command line runs a full ingestion before it starts
 * watching, so a change made in that gap is already in the index.
 */
async function startLive(): Promise<void> {
  start();

  const deadline = Date.now() + 30_000;
  for (let poke = 0; runs.length === 0; poke += 1) {
    if (Date.now() > deadline) throw new Error('the watcher never reported a write');
    writeFileSync(join(corpus, 'ready.md'), `# ready ${poke}\n`);
    await until(() => runs.length > 0, 300);
  }

  // Late events for the handshake file still trigger runs; wait for a quiet spell.
  for (let seen = -1; seen !== runs.length;) {
    seen = runs.length;
    await new Promise((resolve) => setTimeout(resolve, 600));
  }
  runs.length = 0;
}

describe('a corpus file changing on disk', { timeout: TIMEOUT }, () => {
  it('starts a run', async () => {
    writeFileSync(join(corpus, 'a.md'), '# one\n');
    await startLive();

    writeFileSync(join(corpus, 'a.md'), '# one\n\nchanged\n');

    expect(await until(() => runs.length > 0), 'no run started for a real edit').toBe(true);
    expect(runs).toEqual([{ queued: false }]);
  });

  it('starts a run when the file is in a subdirectory', async () => {
    // The corpus has nested folders and the watch is recursive. Worth its own case, because
    // recursive watching is the option most likely to differ between platforms.
    mkdirSync(join(corpus, 'releases'));
    writeFileSync(join(corpus, 'releases', 'b.md'), '# two\n');
    await startLive();

    writeFileSync(join(corpus, 'releases', 'b.md'), '# two\n\nchanged\n');

    expect(await until(() => runs.length > 0), 'a nested file was not noticed').toBe(true);
  });

  it('starts a run when a file is deleted', async () => {
    // A deletion arrives as "rename", the same event type as a creation, which is why the
    // watcher does not read the event type at all. What the run then does about the
    // missing file is covered by diff.test.ts and persist.test.ts.
    writeFileSync(join(corpus, 'c.md'), '# three\n');
    await startLive();

    unlinkSync(join(corpus, 'c.md'));

    expect(await until(() => runs.length > 0), 'a deletion was not noticed').toBe(true);
  });

  it('turns several quick saves into one run', async () => {
    writeFileSync(join(corpus, 'd.md'), '# four\n');
    await startLive();

    writeFileSync(join(corpus, 'd.md'), '# four\n\none\n');
    await new Promise((resolve) => setTimeout(resolve, 30));
    writeFileSync(join(corpus, 'd.md'), '# four\n\ntwo\n');

    expect(await until(() => runs.length > 0)).toBe(true);
    await settle();

    expect(runs, 'two saves became two runs').toHaveLength(1);
  });
});

describe('what it ignores', { timeout: TIMEOUT }, () => {
  it('does not run for a file that is not markdown', async () => {
    // .DS_Store, editor swap files and lock files all land in a watched directory. None
    // of them is read by ingestion, so a run for one would be a wasted embedding call.
    await startLive();

    writeFileSync(join(corpus, '.DS_Store'), 'noise');
    writeFileSync(join(corpus, 'notes.txt'), 'not part of the corpus');

    await settle();
    expect(runs, 'ran for a file ingestion does not read').toHaveLength(0);
  });

  it('still runs for a markdown file written straight after one it ignored', async () => {
    // The premise for the test above. A watcher that had simply stopped working would
    // also record zero runs.
    await startLive();

    writeFileSync(join(corpus, 'notes.txt'), 'ignored');
    writeFileSync(join(corpus, 'e.md'), '# five\n');

    expect(await until(() => runs.length > 0), 'the filter swallowed a real change').toBe(true);
  });
});

describe('shutdown', { timeout: TIMEOUT }, () => {
  it('releases the file handle, so the process can actually exit', async () => {
    /**
     * Added after a falsification run found nothing.
     *
     * Removing the `watcher.close()` call failed no test, because the scheduler refuses
     * work after close and so no run started either way. What it would have broken is
     * invisible from the runs: an open watch handle keeps the event loop alive, so
     * `pnpm ingest --write` under watch mode would print "Stopping." on Ctrl-C and then
     * hang. Node reports the handle, so the assertion can be on the handle.
     */
    // Counted rather than compared to zero: closing is not instant, so a handle from the
    // test before this one may still be on its way out when this one starts.
    const handles = () =>
      process.getActiveResourcesInfo().filter((resource) => resource === 'FSEventWrap').length;

    const before = handles();

    start();
    expect(handles(), 'no watch handle was open while watching').toBe(before + 1);

    await watcher?.close();
    watcher = undefined;

    // Released on a later tick rather than inside close(), which is why this polls.
    expect(await until(() => handles() <= before, 2000), 'the handle outlived close()').toBe(true);
  });

  it('stops running after close', async () => {
    writeFileSync(join(corpus, 'f.md'), '# six\n');
    await startLive();

    writeFileSync(join(corpus, 'f.md'), '# six\n\nchanged\n');
    expect(await until(() => runs.length > 0)).toBe(true);

    await watcher?.close();
    watcher = undefined;
    const after = runs.length;

    writeFileSync(join(corpus, 'f.md'), '# six\n\nchanged again\n');
    await settle();

    expect(runs, 'a change after close still started a run').toHaveLength(after);
  });
});
