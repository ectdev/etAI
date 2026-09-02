import { describe, expect, it } from 'vitest';
import { chunkDocument } from './chunk.js';
import { extractTitle, parseSections } from './markdown.js';

describe('parseSections', () => {
  it('splits on headings and records the trail above each one', () => {
    const sections = parseSections(
      ['# SDK', '', 'Intro.', '', '## Initialization', '', 'Call init.'].join('\n'),
    );

    expect(sections).toHaveLength(2);
    expect(sections[0]?.trail).toEqual(['SDK']);
    expect(sections[1]?.trail).toEqual(['SDK', 'Initialization']);
  });

  it('keeps text that appears before any heading', () => {
    const sections = parseSections('Loose opening line.\n\n# Heading\n\nBody.');

    expect(sections[0]?.level).toBe(0);
    expect(sections[0]?.body).toContain('Loose opening line.');
  });

  it('does not treat a comment inside a code block as a heading', () => {
    const sections = parseSections(
      ['# Guide', '', '```bash', '# this is a shell comment', 'run --now', '```', ''].join('\n'),
    );

    expect(sections).toHaveLength(1);
    expect(sections[0]?.heading).toBe('Guide');
  });

  it('drops a deeper trail when a shallower heading follows', () => {
    const sections = parseSections(
      ['# A', '', '## B', '', '### C', '', '## D', '', 'Body.'].join('\n'),
    );

    expect(sections.at(-1)?.trail).toEqual(['A', 'D']);
  });
});

describe('extractTitle', () => {
  it('uses the first heading', () => {
    expect(extractTitle('# Runner specification: AWS\n\nBody.', 'fallback')).toBe(
      'Runner specification: AWS',
    );
  });

  it('falls back to the file name when there is no heading', () => {
    expect(extractTitle('Just a paragraph.', 'notes.md')).toBe('notes.md');
  });
});

describe('chunkDocument', () => {
  /**
   * The result for every file in the sample collection. It matters that this comes out
   * of the same code that would split a longer document, rather than out of a rule that
   * says not to split: pointing ingestion at a corpus of longer documents then needs no
   * change.
   */
  it('keeps a short document whole, however many headings it has', () => {
    const document = [
      '# Runner specification: AWS',
      '',
      'Max file size is 5 MB.',
      '',
      '## Submission',
      '',
      'Ship a single HTML file.',
      '',
      '## Review',
      '',
      'Two business days.',
    ].join('\n');

    const chunks = chunkDocument(document);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.content).toContain('Max file size is 5 MB.');
    expect(chunks[0]?.content).toContain('Two business days.');
    expect(chunks[0]?.position).toBe(0);
  });

  it('splits a document that is over the budget', () => {
    const bigSection = (heading: string) => [`## ${heading}`, '', 'x'.repeat(1200), ''].join('\n');

    const chunks = chunkDocument(
      ['# Long', '', bigSection('One'), bigSection('Two'), bigSection('Three')].join('\n'),
      { maxTokens: 400 },
    );

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.tokenCount).toBeLessThanOrEqual(400);
    }
  });

  it('numbers chunks in reading order', () => {
    const chunks = chunkDocument(
      ['# Doc', '', '## A', '', 'y'.repeat(900), '', '## B', '', 'z'.repeat(900)].join('\n'),
      { maxTokens: 300 },
    );

    expect(chunks.map((chunk) => chunk.position)).toEqual(chunks.map((_, index) => index));
  });

  it('does not repeat text between chunks', () => {
    // Overlap exists to stop a fixed-width cut from landing mid-thought, and cutting on
    // headings and paragraphs already avoids that. Repeating text would also make two
    // chunks of one document compete with each other for a result slot.
    const chunks = chunkDocument(
      ['# Doc', '', '## A', '', 'alpha '.repeat(200), '', '## B', '', 'beta '.repeat(200)].join(
        '\n',
      ),
      { maxTokens: 300 },
    );

    const joined = chunks.map((chunk) => chunk.content).join('\n');
    const alphaCount = (joined.match(/alpha/g) ?? []).length;

    expect(alphaCount).toBe(200);
  });

  it('records the heading trail of each section that stands on its own', () => {
    const chunks = chunkDocument(
      [
        '# SDK',
        '',
        '## Initialization',
        '',
        'w'.repeat(900),
        '',
        '## Events',
        '',
        'v'.repeat(900),
        '',
        '## Errors',
        '',
        'u'.repeat(900),
      ].join('\n'),
      { maxTokens: 260 },
    );

    const paths = chunks.map((chunk) => chunk.headingPath);

    // The title has no body of its own, so it travels with the first section and that
    // chunk is labelled with what the two share.
    expect(paths[0]).toBe('SDK');
    expect(paths).toContain('SDK > Events');
    expect(paths).toContain('SDK > Errors');
  });

  it('labels a merged chunk with the heading the merged parts share', () => {
    // A chunk holding both the introduction and the first section is under both of
    // them, not under one. Naming the deeper heading would describe only half of what
    // the chunk contains. The heading text is in the content either way, so keyword
    // search still finds it.
    const chunks = chunkDocument(
      ['# SDK', '', 'Intro.', '', '## Initialization', '', 'Call init.'].join('\n'),
    );

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.headingPath).toBe('SDK');
    expect(chunks[0]?.content).toContain('## Initialization');
  });

  it('splits a single oversized section rather than leaving it over the budget', () => {
    const paragraphs = Array.from({ length: 12 }, (_, i) => `Paragraph ${i}. ${'q'.repeat(200)}`);
    const chunks = chunkDocument(['# One Section', '', ...paragraphs].join('\n\n'), {
      maxTokens: 200,
    });

    expect(chunks.length).toBeGreaterThan(1);
  });

  it('keeps a sentence whole even when it alone is over the budget', () => {
    const sentence = `${'word '.repeat(400)}.`;
    const chunks = chunkDocument(`# Doc\n\n${sentence}`, { maxTokens: 100 });

    // Cutting inside a sentence loses more than it saves, so the budget gives way.
    expect(chunks.some((chunk) => chunk.tokenCount > 100)).toBe(true);
  });

  it('gives every chunk a hash of its own text, so unchanged chunks can be skipped', () => {
    const chunks = chunkDocument(
      ['# Doc', '', '## A', '', 'r'.repeat(900), '', '## B', '', 's'.repeat(900)].join('\n'),
      { maxTokens: 300 },
    );

    const hashes = chunks.map((chunk) => chunk.contentHash);
    expect(new Set(hashes).size).toBe(hashes.length);
    for (const hash of hashes) expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is stable, so a second run produces identical chunks', () => {
    const document = '# Doc\n\n## A\n\nSome text.\n\n## B\n\nMore text.';

    expect(chunkDocument(document)).toEqual(chunkDocument(document));
  });

  it('returns nothing for an empty document instead of one empty chunk', () => {
    expect(chunkDocument('')).toEqual([]);
    expect(chunkDocument('   \n\n  ')).toEqual([]);
  });

  it('handles a document with no headings at all', () => {
    const chunks = chunkDocument('Just one paragraph with no heading.');

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.headingPath).toBeNull();
  });
});
