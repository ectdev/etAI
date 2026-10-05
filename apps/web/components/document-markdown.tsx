import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { remarkQuoted } from '@/lib/remark-quoted';
import { quoteMark, REFUSED_ELEMENTS, SAFE_COMPONENTS } from './answer-markdown';

/**
 * A corpus document, rendered as the markdown it is written in, with the quoted block marked.
 *
 * The panel used to split a document on blank lines and print each piece as text, so a
 * code sample arrived as literal backticks on one line and every heading kept its hashes.
 * The corpus is untrusted in exactly the way the model's answer is, so the same rules
 * apply: raw HTML stays escaped, images are dropped, links show where they point.
 *
 * Headings keep their rank relative to each other but sit below the title the panel
 * already shows, so a document's own top heading cannot outrank the page.
 */

const heading: Components['h1'] = ({ children, ...props }) => (
  <h5 className="et-doc-heading" {...quoteMark(props)}>
    {children}
  </h5>
);

const subheading: Components['h3'] = ({ children, ...props }) => (
  <h6 className="et-doc-subheading" {...quoteMark(props)}>
    {children}
  </h6>
);

const COMPONENTS: Components = {
  ...SAFE_COMPONENTS,
  h1: heading,
  h2: heading,
  h3: subheading,
  h4: subheading,
  h5: subheading,
  h6: subheading,
};

export interface DocumentMarkdownProps {
  text: string;
  title?: string;
  quote?: string;
}

export function DocumentMarkdown({ text, title, quote }: DocumentMarkdownProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, [remarkQuoted, { quote, title }]]}
      disallowedElements={REFUSED_ELEMENTS}
      unwrapDisallowed
      components={COMPONENTS}
    >
      {typeof text === 'string' ? text : ''}
    </ReactMarkdown>
  );
}
