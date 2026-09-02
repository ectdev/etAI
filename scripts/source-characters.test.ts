import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The source, scanned for the characters the corpus is already scanned for.
 *
 * `ingestion/text.ts` normalises the documents by code point, and there is a test
 * asserting it is a no-op on this collection. Nothing did the same for the code, and it
 * cost an hour: a NUL byte reached a template literal in the citation gate where a space
 * was meant. It compiled. Prettier reformatted the file around it. ESLint and TypeScript
 * both accepted it. The tests passed, because a NUL is a perfectly consistent separator.
 *
 * What it broke was a falsification run: the mutation would not apply, because the text I
 * was searching for was not the text in the file. That is a slow way to find out.
 *
 * The scan is deliberately narrow. It looks for characters that are invisible in an
 * editor and mean something to a parser or a person reading a diff, not for anything
 * unusual. Every hit is either a mistake or a decision worth writing down, which is why
 * the exceptions below are listed by file rather than by pattern.
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const SKIP_DIRECTORIES = new Set(['node_modules', '.git', '.next', 'dist', 'coverage']);

const SCANNED = new Set(['.ts', '.tsx', '.css', '.json', '.sh', '.sql', '.yml', '.yaml', '.md']);

/**
 * Control characters, zero-width characters, and the spaces that are not spaces.
 *
 * Tab, newline and carriage return are excluded, since those are ordinary in source.
 * Everything else here renders as nothing, or as a space that no search for a space will
 * find.
 */
const INVISIBLE = new RegExp(
  '[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F' +
    '\\u00A0\\u200B-\\u200F\\u2028\\u2029\\u202A-\\u202E\\u2060\\uFEFF]',
  'gu',
);

/**
 * Files allowed to contain them, with the reason.
 *
 * Listed rather than pattern matched, so adding one is a decision somebody makes here.
 */
const DELIBERATE: Record<string, string> = {
  'packages/core/src/retrieval/question.test.ts':
    'asserts a zero-width-joiner emoji and four zero-width spaces are unusable as questions',
};

/**
 * `ingestion/text.test.ts` was on this list and is not any more.
 *
 * It tests the corpus normaliser, so an exception looked obviously right. It contains no
 * invisible characters at all: it writes them as escapes, which is what the normaliser
 * itself does and for the same reason. An exception nobody needs is a hole in the scan
 * with a plausible reason attached, so the list is checked rather than assumed.
 */

function walk(directory: string, found: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);

    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRECTORIES.has(entry)) walk(full, found);
      continue;
    }

    if (SCANNED.has(extname(entry))) found.push(full);
  }

  return found;
}

describe('the source, scanned the way the corpus is', () => {
  it('contains no invisible character outside the files that mean to', () => {
    const offences: string[] = [];

    for (const file of walk(ROOT)) {
      const path = relative(ROOT, file);
      if (path in DELIBERATE) continue;

      for (const match of readFileSync(file, 'utf8').matchAll(INVISIBLE)) {
        const point = match[0].codePointAt(0) ?? 0;
        offences.push(`${path}: U+${point.toString(16).toUpperCase().padStart(4, '0')}`);
      }
    }

    expect(offences, offences.join('\n')).toEqual([]);
  });

  it('finds one when there is one, so a clean result means something', () => {
    /**
     * The premise. A scan that walks the wrong directory, or matches nothing, reports a
     * clean repository in exactly the same words as a clean repository. This is the only
     * assertion here that would fail if the pattern above stopped working.
     */
    // Built with `fromCharCode` rather than typed. A literal one in this file is the
    // thing the scan exists to find, and writing this test the obvious way put one here.
    const withNul = 'const key = `a' + String.fromCharCode(0) + 'b`;';

    expect(withNul.match(INVISIBLE)).toHaveLength(1);
    expect('const key = `a b`;'.match(INVISIBLE)).toBeNull();

    // And that it is actually reading files, rather than walking an empty tree.
    expect(walk(ROOT).length).toBeGreaterThan(50);
  });
});
