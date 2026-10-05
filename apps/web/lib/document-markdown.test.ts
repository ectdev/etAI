import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { quoteAppearsIn } from '@etai/shared';
import { describe, expect, it } from 'vitest';
import { renderDocument } from './render-answer';

/**
 * The source panel's view of a document: rendered markdown, with the quoted block marked.
 *
 * Opening a citation is how a reader checks an answer, so the two things that matter are
 * that the document reads as the author wrote it and that the panel lands on the passage
 * the answer leaned on. The corpus is also untrusted text, so it gets the same refusals
 * as an answer does.
 */

const CORPUS = fileURLToPath(new URL('../../../corpus', import.meta.url));

const DOC = [
  '# Release checks',
  '',
  'Every runner release must pass four checks before it ships.',
  '',
  '## The checks',
  '',
  '1. Green on all four providers, including Hetzner.',
  '2. Schema compatibility for every existing pipeline.',
  '3. Rollback rehearsed from the candidate artifacts.',
  '4. No secret in the cache, checked by a scripted scan.',
  '',
  '```sh',
  'halcyon release check --all',
  '',
  'halcyon release publish',
  '```',
].join('\n');

function quotedCount(html: string): number {
  return (html.match(/data-quoted/g) ?? []).length;
}

describe('rendering', () => {
  it('drops an opening heading that repeats the title the panel already shows', () => {
    const { html } = renderDocument(DOC, { title: 'Release checks' });

    expect(html).not.toContain('Release checks</h5>');
    expect(html).toContain('<h5 class="et-doc-heading">The checks</h5>');
    expect(html).not.toContain('#');
  });

  it('keeps an opening heading that says something else', () => {
    expect(renderDocument(DOC, { title: 'Another name' }).html).toContain(
      '<h5 class="et-doc-heading">Release checks</h5>',
    );
    expect(renderDocument(DOC).html).toContain('<h5 class="et-doc-heading">Release checks</h5>');
  });

  it('keeps a code block whole, blank lines included, instead of splitting it into paragraphs', () => {
    const { html } = renderDocument(DOC);

    expect(html).toMatch(
      /<pre><code class="language-sh">halcyon release check --all\n\nhalcyon release publish\n<\/code><\/pre>/,
    );
    expect(html).not.toContain('```');
  });

  it('renders lists as lists and ranks headings below the panel title', () => {
    const { html } = renderDocument('### Deep\n\n- one\n- two\n\n1. first\n2. second');

    expect(html).toContain('<h6 class="et-doc-subheading">Deep</h6>');
    expect(html).toMatch(/<ul>\s*<li>one<\/li>\s*<li>two<\/li>\s*<\/ul>/);
    expect(html).toMatch(/<ol>\s*<li>first<\/li>/);
    expect(html).not.toMatch(/<h[1-4]/);
  });

  it('wraps a table so it scrolls inside the narrow panel', () => {
    expect(renderDocument('| a | b |\n|---|---|\n| 1 | 2 |').html).toMatch(
      /<div class="et-answer-table"><table>/,
    );
  });
});

describe('the quoted passage', () => {
  it('marks the paragraph a citation quoted, and only that one', () => {
    const { html, quoted } = renderDocument(DOC, {
      quote: 'Every runner release must pass four checks',
    });

    expect(quotedCount(html)).toBe(1);
    expect(quoted).toMatch(/^<p data-quoted="true">Every runner release/);
  });

  it('marks the one list item quoted, not the whole list', () => {
    const { html, quoted } = renderDocument(DOC, {
      quote: 'Rollback rehearsed from the candidate artifacts.',
    });

    expect(quotedCount(html)).toBe(1);
    expect(quoted).toBe(
      '<li data-quoted="true">Rollback rehearsed from the candidate artifacts.</li>',
    );
  });

  it('marks the one table row quoted, padding and pipes included, as a model quotes it', () => {
    // The live answer that found this: a spec sheet, quoted row by row with its padding.
    const sheet = [
      '| Limit                        | Value                      |',
      '| ---------------------------- | -------------------------- |',
      '| Maximum job duration         | 6 hours                    |',
      '| Maximum artifact size        | 5 GB per job, uncompressed |',
    ].join('\n');
    const { html, quoted } = renderDocument(sheet, {
      quote: 'Maximum artifact size        | 5 GB per job, uncompressed',
    });

    expect(quotedCount(html)).toBe(1);
    expect(quoted).toMatch(/^<tr data-quoted="true"><td>Maximum artifact size<\/td>/);
    expect(html).toContain('<div class="et-answer-table"><table>');
  });

  it('keeps the mark on a heading the panel renders with its own component', () => {
    const { quoted } = renderDocument(
      '# Title\n\n## Before the first run of a customer pipeline\n\nText.',
      { title: 'Title', quote: 'Before the first run of a customer pipeline' },
    );

    expect(quoted).toBe(
      '<h5 class="et-doc-heading" data-quoted="true">Before the first run of a customer pipeline</h5>',
    );
  });

  it('marks a code block when the quote came from inside it', () => {
    const { quoted } = renderDocument(DOC, { quote: 'halcyon release check --all' });

    expect(quoted).toMatch(/^<code class="language-sh" data-quoted="true">/);
  });

  it('prefers the block that holds the whole quote over one that only shares its start', () => {
    const doc = [
      'Artifacts on AWS are limited to 5 GB per job.',
      '',
      'Artifacts on AWS are limited to 5 GB per job, measured after extraction.',
    ].join('\n');
    const { quoted } = renderDocument(doc, {
      quote: 'limited to 5 GB per job, measured after extraction',
    });

    expect(quoted).toBe(
      '<p data-quoted="true">Artifacts on AWS are limited to 5 GB per job, measured after extraction.</p>',
    );
  });

  it('falls back to the start of a quote that runs past the end of its block', () => {
    // A model quotes the sentence it used and sometimes carries on past where it ended.
    const { quoted } = renderDocument(DOC, {
      quote: 'Every runner release must pass four checks before it ships, and nothing else',
    });

    expect(quoted).toMatch(/^<p data-quoted="true">Every runner release/);
  });

  it('lands on the block a quote starts in when it runs on into the next one', () => {
    // The citation gate checks a whole section, so it accepts a quote across a heading.
    const { quoted } = renderDocument(DOC, {
      title: 'Release checks',
      quote: 'before it ships.\n\n## The checks\n\n1. Green on all four providers',
    });

    expect(quoted).toMatch(/^<p data-quoted="true">Every runner release/);
  });

  it('finds a quote whose spacing and line breaks differ from the file', () => {
    const { quoted } = renderDocument(DOC, {
      quote: 'Every runner   release must\npass four checks',
    });

    expect(quoted).not.toBeNull();
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['too short to mean anything', 'four'],
    ['from another document', 'The cache is keyed on the lockfile hash.'],
  ])('marks nothing when the quote is %s', (_, quote) => {
    const { html, quoted } = renderDocument(DOC, { quote });

    expect(quoted).toBeNull();
    expect(quotedCount(html)).toBe(0);
  });

  it('keeps the opening heading after all when it is the passage quoted', () => {
    const { html, quoted } = renderDocument(DOC, {
      title: 'Release checks',
      quote: 'Release checks',
    });

    expect(quoted).toBe('<h5 class="et-doc-heading" data-quoted="true">Release checks</h5>');
    expect(quotedCount(html)).toBe(1);
  });

  it('marks the whole list when the quote runs across two of its items', () => {
    const { quoted } = renderDocument(DOC, {
      quote:
        '3. Rollback rehearsed from the candidate artifacts.\n4. No secret in the cache, checked by a scripted scan.',
    });

    expect(quoted).toMatch(/^<ol data-quoted="true">/);
  });

  it('marks the whole table when the quote runs across two rows', () => {
    const sheet = '| Limit | Value |\n| --- | --- |\n| Duration | 6 hours |\n| Artifact | 5 GB |';
    const { quoted } = renderDocument(sheet, {
      quote: '| Duration | 6 hours |\n| Artifact | 5 GB |',
    });

    expect(quoted).toMatch(/^<table data-quoted="true">/);
  });
});

describe('untrusted content', () => {
  it('escapes raw HTML rather than rendering it', () => {
    const { html } = renderDocument(
      'Before\n\n<script>alert(1)</script>\n\n<img src=x onerror="alert(2)">\n\nAfter <b onclick="x()">bold</b>',
    );

    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toMatch(/<[a-z][^>]*onclick/i);
    expect(html).not.toMatch(/<[a-z][^>]*onerror/i);
    expect(html).toContain('&lt;script&gt;');
  });

  it('drops images, which a browser would fetch the moment they render', () => {
    const { html } = renderDocument('See ![chart](https://elsewhere.example/?q=secret) here.');

    expect(html).not.toMatch(/<img/i);
    expect(html).not.toContain('elsewhere.example');
  });

  it('shows where a link points instead of making it clickable', () => {
    const { html } = renderDocument('Read [the guide](https://evil.example/login).');

    expect(html).not.toMatch(/<a[\s>]/);
    expect(html).toContain('the guide');
    expect(html).toContain('(https://evil.example/login)');
  });

  it.each([
    ['empty', ''],
    ['whitespace', ' \n\n \t'],
    ['not a string', 42 as unknown as string],
    ['an unclosed fence', '```js\nconst a = 1;'],
    ['a lone hash', '#'],
  ])('renders %s without throwing', (_, text) => {
    expect(() => renderDocument(text, { title: 'x', quote: 'anything at all here' })).not.toThrow();
  });
});

describe('the real corpus', () => {
  function documents(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return documents(path);
      return name.endsWith('.md') ? [path] : [];
    });
  }

  const files = documents(CORPUS);

  it('lands on every passage the paragraph splitter it replaced could land on', () => {
    // The panel used to split on blank lines. Any paragraph that splitter could show, a
    // citation could quote, so each one has to find somewhere to land in the rendered
    // document too: a heading, a whole code block, a table, the title itself.
    const misses: string[] = [];
    let checked = 0;

    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      const title = /^#+\s+(.+)$/m.exec(content)?.[1]?.trim();
      const paragraphs = content
        .split(/\n{2,}/)
        .map((paragraph) => paragraph.trim())
        .filter((paragraph) => paragraph.length >= 12);

      for (const quote of paragraphs) {
        checked += 1;
        if (renderDocument(content, { title, quote }).quoted === null) {
          misses.push(`${file}: ${quote.slice(0, 70)}`);
        }
      }
    }

    expect(misses, misses.join('\n')).toEqual([]);
    expect(checked).toBeGreaterThan(1000);
  });

  it('lands on any stretch of a document the citation gate would accept as a quote', () => {
    // The gate accepts a quote that appears anywhere in a section, so the panel has to
    // land on any stretch of the file: one starting mid-word, one running from a
    // paragraph into a heading, one inside a code fence. Sixty characters every 53,
    // across the whole corpus, is every shape a quote takes, deterministically.
    const misses: string[] = [];
    let checked = 0;

    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      const title = /^#+\s+(.+)$/m.exec(content)?.[1]?.trim();

      for (let offset = 0; offset < content.length; offset += 53) {
        const quote = content.slice(offset, offset + 60);
        if (!quoteAppearsIn(content, quote)) continue;
        checked += 1;
        if (renderDocument(content, { title, quote }).quoted === null) {
          misses.push(`${file}@${offset}: ${JSON.stringify(quote)}`);
        }
      }
    }

    expect(misses.slice(0, 15), `${misses.length} missed`).toEqual([]);
    // 2478 windows when this was written.
    expect(checked).toBeGreaterThan(2400);
  });

  it('has the documents this test is about', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('renders every document safely and lands on prose, list items and table rows quoted from it', () => {
    const misses: string[] = [];
    const checked = { prose: 0, item: 0, row: 0 };

    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      const title = /^#+\s+(.+)$/m.exec(content)?.[1]?.trim();
      const { html } = renderDocument(content, { title });

      expect(html, file).not.toMatch(/<(img|script|a|iframe)[\s>]/i);
      expect(html.length, file).toBeGreaterThan(0);

      // What a citation quotes: a sentence of prose, one list item, one table row.
      const lines = content.split('\n');
      const prose = content
        .split(/\n{2,}/)
        .map((block) => block.trim())
        .find((block) => block.length > 60 && /^[A-Za-z]/.test(block) && !block.includes('`'));
      const item = lines
        .map((line) => /^\s*(?:[-*]|\d+\.)\s+(.{24,})$/.exec(line)?.[1])
        .find((text) => text !== undefined && !text.includes('`'));
      const row = lines.filter(
        (line) => /^\|.*\|\s*$/.test(line) && !/^\|[\s:|-]+\|$/.test(line),
      )[1];

      const quotes: Array<[kind: keyof typeof checked, quote: string | undefined, lands: RegExp]> =
        [
          ['prose', prose?.split(/(?<=\.)\s/)[0], /^<p/],
          ['item', item, /^<li/],
          ['row', row?.replace(/^\|\s*/, '').replace(/\s*\|\s*$/, ''), /^<tr/],
        ];

      for (const [kind, quote, lands] of quotes) {
        if (quote === undefined || quote.length < 12) continue;
        checked[kind] += 1;
        const { quoted } = renderDocument(content, { title, quote });
        if (!quoted || !lands.test(quoted)) {
          misses.push(
            `${file} (${kind}): ${quote.slice(0, 60)} -> ${quoted?.slice(0, 40) ?? 'nothing'}`,
          );
        }
      }
    }

    expect(misses, misses.join('\n')).toEqual([]);
    // Measured when this was written: 130 sentences, 5 table rows, and 1 list item, since
    // the corpus keeps most of its lists inside YAML code blocks. A parser change that
    // quietly stops finding a kind fails here.
    expect(checked.prose).toBeGreaterThanOrEqual(125);
    expect(checked.item).toBeGreaterThanOrEqual(1);
    expect(checked.row).toBeGreaterThanOrEqual(5);
  });
});
