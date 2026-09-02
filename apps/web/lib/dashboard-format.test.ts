import { describe, expect, it } from 'vitest';
import {
  countsLabel,
  documentsSeen,
  duration,
  latency,
  relativeTime,
  triggerLabel,
} from './dashboard-format';

/**
 * The dashboard's formatting, which fails by reading wrong rather than by throwing.
 *
 * Every case here has a version that renders, passes a build, returns 200, and is simply
 * incorrect on screen: a minute and a half printed as "84475 ms", four hours printed as
 * "240 minutes ago", a missing latency printed as "null ms", and a run that deleted three
 * documents reported as four zeros. None of those raise anything.
 */

const counts = { created: 4, updated: 1, skipped: 134, deleted: 3, failed: 2 };

describe('printing how long something took', () => {
  it('changes unit with the size of the number, across the range this pipeline produces', () => {
    // Both ends are ordinary here: the first full index of the corpus takes about 85
    // seconds and a rerun with nothing changed takes under a fifth of a second.
    expect(duration(170)).toBe('170 ms');
    expect(duration(4259)).toBe('4.3 s');
    expect(duration(84_475)).toBe('1 m 24 s');
  });

  it('says a run is still going rather than printing a duration of nothing', () => {
    // `finishedAt` is null while a run is in progress. Subtracting from it gives NaN, and
    // "NaN ms" beside four real numbers reads as a bug in the run rather than in the page.
    expect(duration(null)).toBe('still running');
  });

  it('says a latency was not recorded rather than printing nothing', () => {
    expect(latency(null)).toBe('not recorded');
  });
});

describe('printing how long ago something happened', () => {
  const now = new Date('2026-08-13T12:00:00Z');

  it('uses the coarsest unit that is still true', () => {
    expect(relativeTime(new Date('2026-08-13T11:54:00Z'), now)).toBe('6 minutes ago');
    expect(relativeTime(new Date('2026-08-13T08:00:00Z'), now)).toBe('4 hours ago');
    expect(relativeTime(new Date('2026-08-12T10:00:00Z'), now)).toBe('yesterday');
    expect(relativeTime(new Date('2026-06-01T10:00:00Z'), now)).toBe('2026-06-01');
  });

  it('does not print a negative age when a clock disagrees', () => {
    // The timestamp comes from the database and `now` from the web process. They are
    // usually the same machine and are not required to be, and "-3 seconds ago" is the
    // kind of detail that makes a reader stop trusting the rest of the page.
    expect(relativeTime(new Date('2026-08-13T12:00:03Z'), now)).toBe('just now');
  });
});

describe('printing what a run did', () => {
  it('reports deletions, which the design has no column for', () => {
    /**
     * The design's header names four outcomes and the pipeline produces five. A document
     * removed from the corpus is deleted from the index, and a run that removed three
     * while displaying four numbers would be quietly reporting the wrong thing.
     *
     * This test fails if somebody trims the column back to match the drawing.
     */
    expect(countsLabel(counts)).toBe('4 / 1 / 134 / 3 / 2');
  });

  it('counts every outcome towards the documents the run looked at', () => {
    expect(documentsSeen(counts)).toBe(144);
  });

  it('names where a run came from without inventing the command that started it', () => {
    // The design prints "CLI · pnpm ingest --write". The command is not stored anywhere,
    // so printing it would be stating a fact about a run that nobody recorded.
    expect(triggerLabel('cli', null)).toBe('Command line');
    expect(triggerLabel('dashboard', 'admin@etai.local')).toBe('Dashboard, admin@etai.local');
    expect(triggerLabel('cli', null)).not.toContain('pnpm');
    expect(triggerLabel('watch', null)).toBe('Corpus watcher');
    expect(triggerLabel('watch', null, true)).toBe(
      'Corpus watcher, queued behind the previous run',
    );
    // Not on a run nobody queued, or the phrase stops meaning anything.
    expect(triggerLabel('cli', null, false)).toBe('Command line');
  });
});
