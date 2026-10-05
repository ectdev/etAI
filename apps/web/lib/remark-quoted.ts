import { normaliseForQuote, quoteAppearsIn } from '@etai/shared';

/**
 * Marks the block of a document that a citation quoted, so the reader lands on it.
 *
 * Runs on the markdown tree before it becomes HTML. The candidates are the document's
 * top-level blocks, with lists broken into items and tables into rows, because a quote
 * from the third release check should light up that check rather than all four, and a
 * quote from a spec sheet should light up the one limit it names. Each candidate is
 * matched by its own source text, sliced from the file by position, which is the same
 * raw markdown the citation was quoted from.
 *
 * The heading that opens a document repeats the title the panel already shows above it,
 * so it is dropped when it says the same thing, unless it is the passage quoted. A
 * different first heading stays.
 */

/** Blocks whose parts are quoted on their own: one release check, one row of limits. */
const SPLIT = new Set(['list', 'table']);

interface MdastNode {
  type: string;
  value?: string;
  children?: MdastNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
  data?: { hProperties?: Record<string, unknown> };
}

export interface RemarkQuotedOptions {
  quote?: string;
  title?: string;
}

export function remarkQuoted({ quote, title }: RemarkQuotedOptions = {}) {
  return (tree: MdastNode, file: { value?: unknown }) => {
    const blocks = tree.children ?? [];
    const source = typeof file.value === 'string' ? file.value : '';

    const first = blocks[0];
    const repeatsTitle =
      title !== undefined && first?.type === 'heading' && textOf(first).trim() === title.trim();
    const body = repeatsTitle ? blocks.slice(1) : blocks;

    const target = quote
      ? locate(quote, source, body, repeatsTitle ? first : undefined)
      : undefined;

    if (repeatsTitle && target !== first) blocks.shift();
    if (!target) return;

    target.data = {
      ...target.data,
      hProperties: { ...target.data?.hProperties, dataQuoted: true },
    };
  };
}

/**
 * Where a quote lands, most specific match first.
 *
 * Every level is tried for an exact match before any level is tried for the prefix match,
 * because a quote that sits whole inside one list is better shown as that list than as
 * the item it happens to start in. Within a match kind, a single row or item beats the
 * block around it, the block beats the title, and the title beats a passage that runs
 * across blocks.
 *
 * The last level exists because the citation gate checks a quote against a whole section,
 * heading and paragraphs together, so it can accept one that starts at the end of one
 * block and carries on into the next. Such a quote lands on the block it starts in.
 */
function locate(
  quote: string,
  source: string,
  body: MdastNode[],
  title: MdastNode | undefined,
): MdastNode | undefined {
  const needle = normaliseForQuote(quote);
  const exact = (text: string) => needle.length >= 12 && normaliseForQuote(text).includes(needle);
  const loose = (text: string) => quoteAppearsIn(text, quote);

  const whole = title ? [title, ...body] : body;
  const levels = [
    body.flatMap((block) => (SPLIT.has(block.type) ? (block.children ?? []) : [block])),
    body,
    title ? [title] : [],
  ];
  const pick = (matches: (text: string) => boolean) => {
    for (const units of levels) {
      const hit = units.find((unit) => matches(sourceOf(unit, source)));
      if (hit) return hit;
    }
    return undefined;
  };

  return (
    pick(exact) ??
    pick(loose) ??
    whole.find((block, index) =>
      loose(sourceBetween(block, whole[index + 2] ?? whole.at(-1)!, source)),
    )
  );
}

function textOf(node: MdastNode): string {
  return node.value ?? (node.children ?? []).map(textOf).join('');
}

/** The file's text from the start of one block to the end of another, gaps included. */
function sourceBetween(from: MdastNode, to: MdastNode, source: string): string {
  const start = from.position?.start.offset;
  const end = to.position?.end.offset;
  return start === undefined || end === undefined || end < start
    ? sourceOf(from, source)
    : source.slice(start, end);
}

function sourceOf(node: MdastNode, source: string): string {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  return start === undefined || end === undefined ? textOf(node) : source.slice(start, end);
}
