import { describe, expect, it } from 'vitest';
import { compareVersionNumbers, resolveSupersedence } from './supersede.js';

const doc = (path: string, versionNumber: string | null, temporalDate: string | null) => ({
  path,
  versionSeries: versionNumber ? 'halcyon-runner' : null,
  versionNumber,
  temporalDate,
});

describe('resolveSupersedence', () => {
  it('links each release to the one that follows it', () => {
    const links = resolveSupersedence([
      doc('changelogs/halcyon-runner-4.1.md', '4.1', '2026-02-16'),
      doc('changelogs/halcyon-runner-4.2.md', '4.2', '2026-03-30'),
      doc('changelogs/halcyon-runner-4.3.md', '4.3', '2026-05-25'),
    ]);

    expect(links).toEqual([
      {
        path: 'changelogs/halcyon-runner-4.1.md',
        supersededByPath: 'changelogs/halcyon-runner-4.2.md',
      },
      {
        path: 'changelogs/halcyon-runner-4.2.md',
        supersededByPath: 'changelogs/halcyon-runner-4.3.md',
      },
    ]);
  });

  /**
   * The reason each document points at its immediate successor rather than at the newest
   * in the series.
   *
   * A change introduced in 4.1 is reversed in 4.2, and 4.2 is the current answer even
   * though 4.3 exists. Pointing everything at 4.3 would put 4.1 and 4.2 in the same
   * position, which loses the ordering that makes 4.2 the right one to read.
   */
  it('does not collapse a series onto its newest member', () => {
    const links = resolveSupersedence([
      doc('a-4.1.md', '4.1', '2026-02-16'),
      doc('a-4.2.md', '4.2', '2026-03-30'),
      doc('a-4.3.md', '4.3', '2026-05-25'),
    ]);

    const from41 = links.find((link) => link.path === 'a-4.1.md');
    expect(from41?.supersededByPath).toBe('a-4.2.md');
    expect(from41?.supersededByPath).not.toBe('a-4.3.md');
  });

  it('leaves the newest release pointing at nothing', () => {
    const links = resolveSupersedence([
      doc('a-1.0.md', '1.0', '2025-01-01'),
      doc('a-2.0.md', '2.0', '2025-02-01'),
    ]);

    expect(links.some((link) => link.path === 'a-2.0.md')).toBe(false);
  });

  it('orders by date even when the version numbers say otherwise', () => {
    // A release numbered lower but published later is still the later document. Dates
    // decide, because that is the question being asked: what is current.
    const links = resolveSupersedence([
      doc('a-5.0.md', '5.0', '2025-01-01'),
      doc('a-4.0.md', '4.0', '2026-01-01'),
    ]);

    expect(links).toEqual([{ path: 'a-5.0.md', supersededByPath: 'a-4.0.md' }]);
  });

  it('falls back to the version number when two releases share a date', () => {
    const links = resolveSupersedence([
      doc('a-4.10.md', '4.10', '2026-01-01'),
      doc('a-4.9.md', '4.9', '2026-01-01'),
    ]);

    expect(links).toEqual([{ path: 'a-4.9.md', supersededByPath: 'a-4.10.md' }]);
  });

  it('ignores documents that belong to no series', () => {
    const links = resolveSupersedence([
      {
        path: 'release-checklist.md',
        versionSeries: null,
        versionNumber: null,
        temporalDate: null,
      },
      {
        path: 'guides/oncall-rotation.md',
        versionSeries: null,
        versionNumber: null,
        temporalDate: null,
      },
    ]);

    expect(links).toEqual([]);
  });

  it('keeps separate series apart', () => {
    const links = resolveSupersedence([
      { path: 'a-1.0.md', versionSeries: 'a', versionNumber: '1.0', temporalDate: '2025-01-01' },
      { path: 'b-1.0.md', versionSeries: 'b', versionNumber: '1.0', temporalDate: '2025-02-01' },
    ]);

    expect(links).toEqual([]);
  });

  it('does nothing for a series with only one member', () => {
    expect(resolveSupersedence([doc('a-1.0.md', '1.0', '2025-01-01')])).toEqual([]);
  });
});

describe('compareVersionNumbers', () => {
  it('compares each part as a number, not as text', () => {
    // As strings, '4.10' sorts before '4.9', which would put the releases in the wrong
    // order as soon as a series reaches double digits.
    expect(compareVersionNumbers('4.9', '4.10')).toBeLessThan(0);
    expect(compareVersionNumbers('4.10', '4.9')).toBeGreaterThan(0);
  });

  it('treats a missing part as zero', () => {
    expect(compareVersionNumbers('4', '4.0')).toBe(0);
    expect(compareVersionNumbers('4', '4.1')).toBeLessThan(0);
  });

  it('sorts a version above no version at all', () => {
    expect(compareVersionNumbers(null, '1.0')).toBeLessThan(0);
    expect(compareVersionNumbers('1.0', null)).toBeGreaterThan(0);
  });
});
