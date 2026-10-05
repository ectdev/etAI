import { CITATION_MARKER, splitOnCitationMarkers } from '@etai/shared';

/**
 * Turns citation markers in rendered markdown into chip elements.
 *
 * Runs on the HTML tree after markdown has been parsed, so a marker is found wherever the
 * model put it: inside a list item, a bold run, a table cell. The grammar is the shared
 * one in `@etai/shared`, the same parser the citation gate checks with, so the interface
 * cannot show a chip the gate never examined.
 *
 * Text inside code and links is left alone. `[1]` in a code sample is code, and in a link
 * it is the link's own text.
 *
 * A number the answer did not cite stays as the text the model wrote, `[7]`, rather than
 * becoming a chip that points nowhere. Chips are emitted as `button` elements carrying
 * the number, which is safe because raw HTML in the answer is escaped by the renderer:
 * the only buttons in the tree are the ones made here.
 */

interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

const LEAVE_ALONE = new Set(['code', 'pre', 'a']);

export interface RehypeCitationOptions {
  cited: ReadonlySet<number>;
}

export function rehypeCitations(options: RehypeCitationOptions) {
  return (tree: HastNode) => {
    walk(tree, options.cited);
  };
}

function walk(node: HastNode, cited: ReadonlySet<number>): void {
  if (!node.children) return;
  if (node.type === 'element' && node.tagName && LEAVE_ALONE.has(node.tagName)) return;

  const next: HastNode[] = [];

  for (const child of mergeAdjacentText(node.children)) {
    if (
      child.type === 'text' &&
      typeof child.value === 'string' &&
      CITATION_MARKER.test(child.value)
    ) {
      for (const segment of splitOnCitationMarkers(child.value)) {
        if (segment.kind === 'text') {
          next.push({ type: 'text', value: segment.text });
          continue;
        }
        for (const number of segment.numbers) {
          next.push(
            cited.has(number)
              ? {
                  type: 'element',
                  tagName: 'button',
                  properties: { dataCitation: String(number) },
                  children: [],
                }
              : { type: 'text', value: `[${number}]` },
          );
        }
      }
      continue;
    }

    walk(child, cited);
    next.push(child);
  }

  node.children = glueTrailingPunctuation(next);
}

const isChip = (node: HastNode | undefined) =>
  node?.type === 'element' && node.tagName === 'button';
const LEADING_PUNCTUATION = /^[.,;:!?)\]]+/;

/**
 * Keeps a run of chips and the punctuation straight after it on one line.
 *
 * Without this a line could break between `[1]` and the full stop that ends the
 * sentence, leaving the full stop alone at the start of the next line. The run is wrapped
 * in a span the stylesheet marks as unbreakable; the rest of the text flows as before.
 */
function glueTrailingPunctuation(children: HastNode[]): HastNode[] {
  const out: HastNode[] = [];
  let index = 0;

  while (index < children.length) {
    const child = children[index] as HastNode;
    if (!isChip(child)) {
      out.push(child);
      index += 1;
      continue;
    }

    const run: HastNode[] = [];
    while (isChip(children[index])) {
      run.push(children[index] as HastNode);
      index += 1;
    }

    const after = children[index];
    const punctuation =
      after?.type === 'text' ? (after.value ?? '').match(LEADING_PUNCTUATION)?.[0] : undefined;

    if (!punctuation) {
      out.push(...run);
      continue;
    }

    out.push({
      type: 'element',
      tagName: 'span',
      properties: { className: ['et-chip-glue'] },
      children: [...run, { type: 'text', value: punctuation }],
    });
    const rest = (after?.value ?? '').slice(punctuation.length);
    if (rest.length > 0) out.push({ type: 'text', value: rest });
    index += 1;
  }

  return out;
}

/**
 * Joins neighbouring text nodes, so a marker the parser happened to split across two of
 * them is still seen whole.
 */
function mergeAdjacentText(children: HastNode[]): HastNode[] {
  const merged: HastNode[] = [];
  for (const child of children) {
    const previous = merged.at(-1);
    if (child.type === 'text' && previous?.type === 'text') {
      previous.value = `${previous.value ?? ''}${child.value ?? ''}`;
    } else {
      merged.push(child.type === 'text' ? { ...child } : child);
    }
  }
  return merged;
}
