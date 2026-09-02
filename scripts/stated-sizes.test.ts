import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * A document claiming how long another document is, checked against how long it is.
 *
 * AI_USAGE.md carries an entry about the brief asking for a short README, and it ended by
 * saying the README is a 319 line map now. It was, on the day it was written. The README
 * has been edited four times since and the sentence stayed at 319, inside the very entry
 * whose subject is checking your work against a summary instead of the thing itself.
 *
 * Tense is the whole distinction here. "The README was 906 lines" is history and has to
 * stay wrong; that is the point of writing it. "The README is a 347 line map" is a claim
 * about now, and now moves. Only present-tense claims are checked.
 *
 * The tolerance is zero on purpose. An approximate count would need a word like "about"
 * in the sentence, and if the sentence had one it would not match this pattern at all.
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DOCUMENTS = ['README.md', 'AI_USAGE.md', 'docs/architecture.md', 'docs/retrieval.md'];

/** What a sentence can call a file, and the file it means. */
const NAMES: Array<[RegExp, string]> = [
  [/README/, 'README.md'],
  [/this (?:file|log)/i, 'AI_USAGE.md'],
];

function lineCount(file: string): number {
  return readFileSync(join(ROOT, file), 'utf8').split('\n').length - 1;
}

describe('sizes a document states about another', () => {
  it('states the size the file actually is', () => {
    const offences: string[] = [];
    let claims = 0;

    for (const document of DOCUMENTS) {
      const text = readFileSync(join(ROOT, document), 'utf8');

      // Present tense only: "is a 347 line map", "is 347 lines".
      for (const match of text.matchAll(/\b(is a|is) (\d{2,5}) lines?\b/g)) {
        const before = text.slice(Math.max(0, match.index - 90), match.index);
        const named = NAMES.find(([pattern]) => pattern.test(before));
        if (!named) continue;

        claims += 1;
        const [, file] = named;
        const stated = Number(match[2]);
        const actual = lineCount(file);

        if (stated !== actual) {
          offences.push(`${document} says ${file} is ${stated} lines; it is ${actual}`);
        }
      }
    }

    expect(claims, 'no present tense size claims found, so this test is checking nothing').toBe(1);
    expect(offences, offences.join('\n')).toEqual([]);
  });
});
