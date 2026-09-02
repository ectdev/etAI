/** A heading and the text that belongs to it, with the headings it sits under. */
export interface Section {
  /** Markdown heading level, 1 for `#`. Zero for text that appears before any heading. */
  level: number;
  /** Heading text without the hashes. Empty for the level zero section. */
  heading: string;
  /** The lines under this heading, up to the next heading. */
  body: string;
  /** The headings above this one, outermost first, including its own. */
  trail: string[];
}

const HEADING = /^(#{1,6})\s+(.*)$/;

/**
 * A fenced code block can contain lines that start with a hash, and those are
 * comments rather than headings. Tracking the fences avoids splitting a document in
 * the middle of a shell script.
 */
const FENCE = /^\s*(```|~~~)/;

/**
 * The document title, taken from the first heading.
 *
 * Falls back to the file name because a title is used in the interface and in search,
 * and a document with no heading still has to be identifiable.
 */
export function extractTitle(content: string, fallback: string): string {
  for (const line of content.split('\n')) {
    const match = HEADING.exec(line);
    if (match?.[2]) return match[2].trim();
  }
  return fallback;
}

/**
 * Breaks a document into its headed sections.
 *
 * Splitting here rather than at a character count is what keeps a chunk from starting
 * halfway through an explanation. A heading is a boundary the author already chose,
 * which makes it a better place to cut than any offset.
 */
export function parseSections(content: string): Section[] {
  const sections: Section[] = [];
  const lines = content.split('\n');

  // Heading text by level, so the trail for a deep heading can be rebuilt.
  const openHeadings: string[] = [];
  let current: Section | null = null;
  let inFence = false;

  const flush = () => {
    if (!current) return;
    current.body = current.body.replace(/\n+$/, '');
    if (current.heading || current.body.trim()) sections.push(current);
    current = null;
  };

  for (const line of lines) {
    if (FENCE.test(line)) inFence = !inFence;

    const match = inFence ? null : HEADING.exec(line);

    if (match) {
      flush();

      const level = match[1]?.length ?? 1;
      const heading = (match[2] ?? '').trim();

      // Drop any open headings at this level or deeper before adding this one.
      openHeadings.length = Math.min(openHeadings.length, level - 1);
      while (openHeadings.length < level - 1) openHeadings.push('');
      openHeadings[level - 1] = heading;

      current = {
        level,
        heading,
        body: '',
        trail: openHeadings.slice(0, level).filter((entry) => entry.length > 0),
      };
      continue;
    }

    if (!current) {
      current = { level: 0, heading: '', body: '', trail: [] };
    }

    current.body += `${line}\n`;
  }

  flush();
  return sections;
}

/** The heading trail as one readable string, for display and for keyword search. */
export function formatHeadingPath(trail: string[]): string | null {
  return trail.length > 0 ? trail.join(' > ') : null;
}
