import type { LinkedCitation } from '@etai/shared';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AnswerMarkdown } from '@/components/answer-markdown';
import { DocumentMarkdown } from '@/components/document-markdown';

/**
 * An answer rendered exactly as the screen renders it, read back for assertions.
 *
 * For tests. They used to check a paragraph splitter that the interface called, and
 * once the interface rendered markdown instead, a test of the splitter would have kept
 * passing about a function nothing displayed. This goes through the real component, with
 * each chip drawn as a marker element so its number can be read back out.
 */
export interface RenderedAnswer {
  html: string;
  /** Chip numbers in the order they appear. */
  chips: number[];
  /** What a reader sees, with tags removed and the chips taken out. */
  text: string;
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#x27;': "'",
};

export function renderAnswer(text: string, citations: LinkedCitation[]): RenderedAnswer {
  const html = renderToStaticMarkup(
    createElement(AnswerMarkdown, {
      text,
      citations,
      renderChip: (number: number) => createElement('cite', { 'data-chip': number }),
    }),
  );

  const chips = [...html.matchAll(/data-chip="(\d+)"/g)].map((match) => Number(match[1]));
  const visible = html
    .replace(/<cite data-chip="\d+"><\/cite>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&(?:amp|lt|gt|quot|#x27);/g, (entity) => ENTITIES[entity] ?? entity);

  return { html, chips, text: visible };
}

/**
 * A document rendered as the source panel renders it, with the quoted block's markup.
 *
 * `quoted` is the HTML of the element the panel would scroll to, or null when the quote
 * matched nothing and the panel would open at the top.
 */
export function renderDocument(
  text: string,
  options: { title?: string; quote?: string } = {},
): { html: string; quoted: string | null } {
  const html = renderToStaticMarkup(createElement(DocumentMarkdown, { text, ...options }));
  const marked = /<(\w+)[^>]*data-quoted[^>]*>[\s\S]*?<\/\1>/.exec(html);
  return { html, quoted: marked ? marked[0] : null };
}
