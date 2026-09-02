import { describe, expect, it } from 'vitest';
import { estimateTokens, hashText, normalizeText } from './text.js';

const ch = (code: number) => String.fromCodePoint(code);

describe('normalizeText', () => {
  it('leaves ordinary text alone', () => {
    expect(normalizeText('# Title\n\nA sentence.')).toBe('# Title\n\nA sentence.');
  });

  it.each([
    ['zero width space', 0x200b],
    ['zero width non-joiner', 0x200c],
    ['zero width joiner', 0x200d],
    ['word joiner', 0x2060],
    ['byte order mark', 0xfeff],
    ['soft hyphen', 0x00ad],
  ])(
    'removes a %s, which would otherwise change the hash without changing the text',
    (_l, code) => {
      const polluted = `App${ch(code)}Lovin`;

      expect(polluted).not.toBe('AppLovin');
      expect(normalizeText(polluted)).toBe('AppLovin');
      expect(hashText(normalizeText(polluted))).toBe(hashText('AppLovin'));
    },
  );

  it.each([
    ['no-break space', 0x00a0],
    ['narrow no-break space', 0x202f],
    ['ideographic space', 0x3000],
  ])('turns a %s into an ordinary space so words still match', (_l, code) => {
    expect(normalizeText(`under${ch(code)}5 MB`)).toBe('under 5 MB');
  });

  it.each([
    ['line separator', 0x2028],
    ['paragraph separator', 0x2029],
  ])('treats a %s as the line break it means', (_l, code) => {
    expect(normalizeText(`first${ch(code)}second`)).toBe('first\nsecond');
  });

  it('normalises Windows and old Mac line endings', () => {
    expect(normalizeText('a\r\nb\rc')).toBe('a\nb\nc');
  });

  it('strips trailing spaces and tabs from each line', () => {
    expect(normalizeText('a   \nb\t\nc')).toBe('a\nb\nc');
  });

  it('composes accents, so the same word written two ways hashes the same', () => {
    const composed = 'Ferro Gañes';
    const decomposed = 'Ferro Gañes';

    expect(composed).not.toBe(decomposed);
    expect(normalizeText(composed)).toBe(normalizeText(decomposed));
  });

  it('is stable, so running ingestion twice sees no change', () => {
    const once = normalizeText(`  # Title${ch(0x200b)}  \r\n\r\nBody${ch(0x00a0)}text.  `);
    expect(normalizeText(once)).toBe(once);
  });
});

describe('hashText', () => {
  it('gives the same hash for the same text', () => {
    expect(hashText('a')).toBe(hashText('a'));
  });

  it('gives a different hash for a one character change', () => {
    expect(hashText('under 5 MB')).not.toBe(hashText('under 6 MB'));
  });

  it('is a hex sha-256, which is what the column expects', () => {
    expect(hashText('anything')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('estimateTokens', () => {
  it('scales with length', () => {
    expect(estimateTokens('a'.repeat(400))).toBe(100);
  });

  it('never reports zero for text that exists, so an empty budget check cannot pass it', () => {
    expect(estimateTokens('a')).toBe(1);
  });

  it('puts the largest document in this collection far below the chunk budget', () => {
    // The largest file is a little over 1000 bytes. If this ever stops being true the
    // chunking tests below stop describing the real collection.
    expect(estimateTokens('a'.repeat(1027))).toBeLessThan(800);
  });
});
