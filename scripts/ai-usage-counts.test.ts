import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The numbers AI_USAGE.md gives about itself, checked against itself.
 *
 * The file said 19 entries when it had 22, and its theme table said four entries in a
 * section holding seven. Both were true when written. Neither had any reason to stay true,
 * because adding an entry is one edit and updating two counts and a table row is three
 * more, and nothing anywhere fails when the last three are skipped.
 *
 * That is the whole argument for this file. A document that miscounts its own contents is
 * the one kind of wrong a reader can check in ten seconds, and it costs the rest of the
 * document its credibility.
 *
 * The test counts headings rather than trusting a number written next to them, which is
 * the same rule the log itself keeps arriving at.
 *
 * The prose used to state a total twice as well, and that was checked here too. Both
 * sentences were cut as padding, so the table is the only claim left to check.
 */

const AI_USAGE = readFileSync(new URL('../AI_USAGE.md', import.meta.url), 'utf8');

/** Each `###` is one entry. Each `##` after the log begins is a theme holding some. */
function entriesByTheme(): Map<string, number> {
  const counts = new Map<string, number>();
  let theme = '';

  for (const line of AI_USAGE.split('\n')) {
    if (line.startsWith('## ')) theme = line.slice(3).trim();
    else if (line.startsWith('### ')) counts.set(theme, (counts.get(theme) ?? 0) + 1);
  }

  return counts;
}

describe('the AI usage log', () => {
  it('has a theme table whose rows match the sections they link to', () => {
    const byTheme = entriesByTheme();
    const total = [...byTheme.values()].reduce((sum, n) => sum + n, 0);

    expect(total, 'no entries found, so this test is checking nothing').toBeGreaterThan(10);
    const rows = [...AI_USAGE.matchAll(/^\| \[([^\]]+)\]\([^)]+\)\s*\|\s*(\d+)\s*\|$/gm)];

    expect(rows.length, 'no theme rows found').toBeGreaterThan(3);

    for (const [, theme, count] of rows) {
      expect(byTheme.get(theme), `the table says ${count} under "${theme}"`).toBe(Number(count));
    }

    // And the table has to cover every theme, or a whole section could go unlisted.
    const themesWithEntries = [...byTheme.keys()];
    const listed = rows.map(([, theme]) => theme);

    expect(listed.sort()).toEqual(themesWithEntries.sort());
  });
});
