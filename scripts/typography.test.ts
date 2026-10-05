import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * No long dashes anywhere in the repository.
 *
 * A house rule rather than a correctness one, and held by a test for the same reason the
 * invisible characters are: a rule that depends on everyone remembering it lasts until
 * the first paste from somewhere else. Sentences here use a comma, a colon or a full stop
 * where other writing reaches for a dash, and a range is written "5 to 10".
 *
 * The scan covers what git would publish: tracked files plus new ones that are not
 * ignored. A file `next dev` regenerates on every run is ignored on purpose and is not
 * part of the repository, so it is not this test's business.
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const SCANNED = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.css',
  '.json',
  '.md',
  '.sh',
  '.sql',
  '.yml',
  '.yaml',
  '.svg',
]);

/** Em dash, en dash and horizontal bar. Built from code points so this file stays clean. */
const LONG_DASH = new RegExp(`[${String.fromCodePoint(0x2013, 0x2014, 0x2015)}]`, 'gu');

function publishedFiles(): string[] {
  return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
    .split('\n')
    .filter((path) => path.length > 0 && SCANNED.has(extname(path)));
}

function offencesIn(path: string, text: string): string[] {
  const found: string[] = [];
  text.split('\n').forEach((line, index) => {
    if (LONG_DASH.test(line)) found.push(`${path}:${index + 1}`);
    LONG_DASH.lastIndex = 0;
  });
  return found;
}

describe('typography', () => {
  it('has no long dash in any file the repository publishes', () => {
    const offences = publishedFiles().flatMap((path) => {
      let text: string;
      try {
        text = readFileSync(join(ROOT, path), 'utf8');
      } catch {
        // Deleted in the working tree but still in the index. Nothing to read.
        return [];
      }
      return offencesIn(path, text);
    });

    expect(offences, offences.join('\n')).toEqual([]);
  });

  it('finds one when there is one, so a clean result means something', () => {
    const emDash = String.fromCodePoint(0x2014);
    const enDash = String.fromCodePoint(0x2013);

    expect(offencesIn('a.md', `one${emDash}two`)).toEqual(['a.md:1']);
    expect(offencesIn('a.md', `fine\n5${enDash}10`)).toEqual(['a.md:2']);
    expect(offencesIn('a.md', 'a hyphen-ated word, and a - spaced hyphen')).toEqual([]);
    expect(publishedFiles().length).toBeGreaterThan(200);
  });
});
