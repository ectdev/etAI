import { formatHeadingPath, parseSections, type Section } from './markdown.js';
import { estimateTokens, hashText } from './text.js';

export interface ChunkInput {
  position: number;
  headingPath: string | null;
  content: string;
  contentHash: string;
  tokenCount: number;
}

export interface ChunkOptions {
  /**
   * Token budget for one chunk.
   *
   * Chosen with the embedding model's 8192 token input limit well out of reach, so the
   * budget is about what makes a useful unit of retrieval rather than about what fits.
   * Every file in the sample collection is far below this, which is why each of them
   * comes out whole.
   */
  maxTokens?: number;
  /**
   * A chunk below this is merged into its neighbour instead of standing alone. A
   * two-line section retrieved on its own rarely answers anything, and it competes for
   * a result slot with the section that would have.
   */
  minTokens?: number;
}

const DEFAULT_MAX_TOKENS = 800;
const DEFAULT_MIN_TOKENS = 64;

/**
 * Splits a document into the pieces that get embedded.
 *
 * The strategy is structural: split on the headings the author wrote, then merge
 * neighbouring sections while they fit in the budget, and only fall back to splitting
 * inside a section when one section alone is over budget. In that case it splits on
 * blank lines, and on sentence ends if a single paragraph is still too long.
 *
 * There is no overlap between chunks. Overlap exists to stop a fixed-width cut from
 * landing mid-thought, and cutting on headings and paragraphs already avoids that. It
 * would also duplicate text across rows, which makes two chunks of the same document
 * compete with each other in the results.
 */
export function chunkDocument(content: string, options: ChunkOptions = {}): ChunkInput[] {
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  const minTokens = options.minTokens ?? DEFAULT_MIN_TOKENS;

  const sections = parseSections(content);

  if (sections.length === 0) {
    return content.trim().length > 0 ? [toChunk(0, null, content.trim())] : [];
  }

  // Sections that are over budget on their own are broken down first, so the merge
  // step only ever deals with pieces that can fit.
  const pieces: Array<{ trail: string[]; text: string }> = [];

  for (const section of sections) {
    const text = sectionText(section);
    if (text.length === 0) continue;

    if (estimateTokens(text) <= maxTokens) {
      pieces.push({ trail: section.trail, text });
      continue;
    }

    for (const part of splitOversized(text, maxTokens)) {
      pieces.push({ trail: section.trail, text: part });
    }
  }

  const merged = mergePieces(pieces, maxTokens, minTokens);

  return merged.map((piece, index) => toChunk(index, formatHeadingPath(piece.trail), piece.text));
}

function sectionText(section: Section): string {
  const heading = section.heading ? `${'#'.repeat(section.level)} ${section.heading}` : '';
  const body = section.body.trim();

  if (heading && body) return `${heading}\n\n${body}`;
  return (heading || body).trim();
}

/**
 * Merges neighbouring pieces while they fit.
 *
 * Pieces are only merged when they share a heading trail or when the piece being
 * merged is below the minimum on its own. Joining two unrelated sections just because
 * there was room would produce a chunk that answers neither question well.
 */
function mergePieces(
  pieces: Array<{ trail: string[]; text: string }>,
  maxTokens: number,
  minTokens: number,
): Array<{ trail: string[]; text: string }> {
  const merged: Array<{ trail: string[]; text: string }> = [];

  for (const piece of pieces) {
    const previous = merged.at(-1);

    if (!previous) {
      merged.push({ ...piece });
      continue;
    }

    const combined = `${previous.text}\n\n${piece.text}`;
    const fits = estimateTokens(combined) <= maxTokens;
    const related = sharesRoot(previous.trail, piece.trail);
    const tooSmall =
      estimateTokens(piece.text) < minTokens || estimateTokens(previous.text) < minTokens;

    if (fits && (related || tooSmall)) {
      previous.text = combined;
      previous.trail = commonTrail(previous.trail, piece.trail);
      continue;
    }

    merged.push({ ...piece });
  }

  return merged;
}

function sharesRoot(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) return true;
  return a[0] === b[0];
}

function commonTrail(a: string[], b: string[]): string[] {
  const shared: string[] = [];
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    if (a[i] !== b[i]) break;
    shared.push(a[i] as string);
  }
  return shared.length > 0 ? shared : a.length > 0 ? [a[0] as string] : [];
}

/** Breaks a single over-budget section on blank lines, then on sentence ends. */
function splitOversized(text: string, maxTokens: number): string[] {
  const paragraphs = text.split(/\n\s*\n/).filter((part) => part.trim().length > 0);
  const parts: string[] = [];
  let buffer = '';

  const push = () => {
    if (buffer.trim().length > 0) parts.push(buffer.trim());
    buffer = '';
  };

  for (const paragraph of paragraphs) {
    if (estimateTokens(paragraph) > maxTokens) {
      push();
      parts.push(...splitSentences(paragraph, maxTokens));
      continue;
    }

    const candidate = buffer ? `${buffer}\n\n${paragraph}` : paragraph;

    if (estimateTokens(candidate) > maxTokens) {
      push();
      buffer = paragraph;
    } else {
      buffer = candidate;
    }
  }

  push();
  return parts;
}

/**
 * Last resort for a paragraph that is over budget by itself.
 *
 * If even one sentence is too long the sentence is kept whole and allowed over budget,
 * because cutting mid-sentence loses more than it saves.
 */
function splitSentences(paragraph: string, maxTokens: number): string[] {
  const sentences = paragraph.split(/(?<=[.!?])\s+/);
  const parts: string[] = [];
  let buffer = '';

  for (const sentence of sentences) {
    const candidate = buffer ? `${buffer} ${sentence}` : sentence;

    if (buffer && estimateTokens(candidate) > maxTokens) {
      parts.push(buffer.trim());
      buffer = sentence;
    } else {
      buffer = candidate;
    }
  }

  if (buffer.trim().length > 0) parts.push(buffer.trim());
  return parts;
}

function toChunk(position: number, headingPath: string | null, content: string): ChunkInput {
  return {
    position,
    headingPath,
    content,
    contentHash: hashText(content),
    tokenCount: estimateTokens(content),
  };
}
