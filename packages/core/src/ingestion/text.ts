import { createHash } from 'node:crypto';

/**
 * Characters that look like nothing, or like an ordinary space, and are neither.
 *
 * They are listed by code point rather than typed into the source. Two of them count as
 * line breaks in a JavaScript file, so a literal version does not even parse, and the
 * rest would be invisible to whoever reads this next. A number with a name beside it can
 * be checked.
 *
 * The sample collection contains none of these, which was worth measuring rather than
 * assuming: it is plain ASCII with Unix line endings throughout. They are handled anyway
 * because ingestion is meant to be pointed at a real corpus, and a real corpus has been
 * through editors, spreadsheets and copy-paste. A stray zero width space would otherwise
 * make an unchanged file look changed on every run, and quietly pay to embed it again.
 */
const REMOVED = [
  0x200b, // zero width space
  0x200c, // zero width non-joiner
  0x200d, // zero width joiner
  0x2060, // word joiner
  0xfeff, // byte order mark, also used mid-text as a zero width no-break space
  0x00ad, // soft hyphen
];

/** Spaces that stop a word from matching the same word typed normally. */
const SPACE_LIKE = [
  0x00a0, // no-break space
  0x2007, // figure space
  0x2009, // thin space
  0x200a, // hair space
  0x202f, // narrow no-break space
  0x205f, // medium mathematical space
  0x3000, // ideographic space
];

/** Separators that mean a new line, but that no editor shows as one. */
const LINE_LIKE = [
  0x2028, // line separator
  0x2029, // paragraph separator
];

function charClass(codePoints: number[]): RegExp {
  return new RegExp(`[${codePoints.map((point) => String.fromCodePoint(point)).join('')}]`, 'g');
}

const REMOVED_PATTERN = charClass(REMOVED);
const SPACE_LIKE_PATTERN = charClass(SPACE_LIKE);
const LINE_LIKE_PATTERN = charClass(LINE_LIKE);

/**
 * Puts text into one predictable form before anything reads it.
 *
 * Order matters. Composing accents first means the later passes see a stable sequence,
 * and trimming line ends last catches whatever the earlier passes left behind.
 */
export function normalizeText(input: string): string {
  return input
    .normalize('NFC')
    .replace(REMOVED_PATTERN, '')
    .replace(SPACE_LIKE_PATTERN, ' ')
    .replace(LINE_LIKE_PATTERN, '\n')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .trim();
}

/** SHA-256 as hex. Used to decide whether a file or a chunk needs any work. */
export function hashText(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Rough token count, at four characters per token.
 *
 * This is an estimate rather than a tokeniser, and it is used only to decide where to
 * split. The chunk budget sits far below the embedding model's input limit, so being off
 * by a fifth changes nothing. A real tokeniser would add a dependency and a
 * model-specific vocabulary to be precise about a number that only needs to be roughly
 * right.
 */
export function estimateTokens(input: string): number {
  return Math.ceil(input.length / 4);
}
