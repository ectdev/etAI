import { describe, expect, it } from 'vitest';
import { VECTOR_DIMENSIONS } from '@etai/shared';
import { HASHING_MODEL, hashEmbedding, tokenize } from './hashing.js';
import { signatureFor } from './embed.js';

const cosine = (a: number[], b: number[]) =>
  a.reduce((sum, value, i) => sum + value * (b[i] ?? 0), 0);
const length = (v: number[]) => Math.sqrt(v.reduce((sum, value) => sum + value * value, 0));
const allFinite = (v: number[]) => v.every((value) => Number.isFinite(value));

describe('hashEmbedding', () => {
  it('returns the same vector for the same text, every time', () => {
    const text = 'What is the maximum artifact size on AWS?';
    expect(hashEmbedding(text)).toEqual(hashEmbedding(text));
  });

  it('is the width the database column holds, and unit length', () => {
    const vector = hashEmbedding('runner specification for Hetzner');
    expect(vector).toHaveLength(VECTOR_DIMENSIONS);
    expect(length(vector)).toBeCloseTo(1, 9);
    expect(allFinite(vector)).toBe(true);
  });

  it('puts texts that share words closer than texts that share none', () => {
    const question = hashEmbedding('maximum artifact size on AWS');
    const related = hashEmbedding('Maximum artifact size: 5 GB per job on AWS, uncompressed');
    const unrelated = hashEmbedding('The on call rotation is one person for one week');

    expect(cosine(question, related)).toBeGreaterThan(cosine(question, unrelated));
    expect(cosine(question, related)).toBeGreaterThan(0.3);
  });

  it('ignores case, punctuation and compatibility forms, which are not differences in wording', () => {
    expect(hashEmbedding('Artifact LIMIT!')).toEqual(hashEmbedding('artifact, limit'));
    // U+FB01 is the "fi" ligature, which NFKC unfolds into two letters.
    expect(hashEmbedding(`${String.fromCodePoint(0xfb01)}le`)).toEqual(hashEmbedding('file'));
  });

  it('is a bag of words, so word order does not move it', () => {
    expect(hashEmbedding('cache retention policy')).toEqual(
      hashEmbedding('policy retention cache'),
    );
  });

  it('damps repetition rather than letting one repeated word dominate', () => {
    const once = hashEmbedding('cache retention');
    const spammed = hashEmbedding(`${'cache '.repeat(500)}retention`);
    // Still recognisably about both words, which a raw count of 500 against 1 would not be.
    expect(cosine(once, spammed)).toBeGreaterThan(0.6);
  });

  it.each([
    ['an empty string', ''],
    ['whitespace', '   \n\t  '],
    ['only stopwords', 'the and of to is'],
    ['only punctuation', '?!?! ... ---'],
    ['only emoji', String.fromCodePoint(0x1f600, 0x1f680)],
  ])('gives %s a fixed unit vector rather than the zero vector', (_label, text) => {
    const vector = hashEmbedding(text);
    expect(length(vector)).toBeCloseTo(1, 9);
    expect(allFinite(vector)).toBe(true);
    expect(vector).toEqual(hashEmbedding(''));
  });

  it('handles text in scripts other than Latin', () => {
    for (const text of [
      'Hetzner runner limitleri neler? ğüşıöç',
      '日本語のテキスト',
      'Привет мир',
    ]) {
      const vector = hashEmbedding(text);
      expect(length(vector)).toBeCloseTo(1, 9);
      expect(vector).not.toEqual(hashEmbedding(''));
    }
  });

  it('finishes on a very long text and stays unit length', () => {
    const vector = hashEmbedding('artifact cache runner pipeline '.repeat(40_000));
    expect(length(vector)).toBeCloseTo(1, 9);
  });

  it('does not throw on values a caller should never pass', () => {
    for (const value of [null, undefined, 42, {}] as unknown as string[]) {
      expect(() => hashEmbedding(value)).not.toThrow();
      expect(allFinite(hashEmbedding(value))).toBe(true);
    }
  });

  it('honours another width, and refuses one that is not a positive whole number', () => {
    expect(hashEmbedding('artifact', 8)).toHaveLength(8);
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => hashEmbedding('artifact', bad)).toThrow(RangeError);
    }
  });
});

describe('tokenize', () => {
  it('splits on anything that is not a letter or a digit and drops stopwords', () => {
    expect(tokenize('What is the AWS artifact-limit, in GB (5)?')).toEqual([
      'aws',
      'artifact',
      'limit',
      'gb',
      '5',
    ]);
  });

  it('keeps letters from every script and version numbers as digits', () => {
    expect(tokenize('5.10 sürümü')).toEqual(['5', '10', 'sürümü']);
  });
});

describe('signatureFor', () => {
  const base = { EMBEDDING_PROVIDER: 'google' as const, EMBEDDING_MODEL: 'gemini-embedding-2' };

  it('names provider, model, width and text format, with no whitespace', () => {
    const signature = signatureFor(base);
    expect(signature).toBe(`google:gemini-embedding-2:${VECTOR_DIMENSIONS}:text-v1`);
    expect(signature).toMatch(/^[a-z]+:[^\s:]+:\d+:text-v\d+$/);
  });

  it('changes when the model changes, which is the whole point of storing it', () => {
    expect(signatureFor({ ...base, EMBEDDING_MODEL: 'gemini-embedding-3' })).not.toBe(
      signatureFor(base),
    );
  });

  it('uses the algorithm name for hashing whatever EMBEDDING_MODEL says, since that model is not used', () => {
    expect(
      signatureFor({ EMBEDDING_PROVIDER: 'hashing', EMBEDDING_MODEL: 'gemini-embedding-2' }),
    ).toBe(`hashing:${HASHING_MODEL}:${VECTOR_DIMENSIONS}:text-v1`);
    expect(signatureFor({ EMBEDDING_PROVIDER: 'hashing', EMBEDDING_MODEL: 'anything else' })).toBe(
      signatureFor({ EMBEDDING_PROVIDER: 'hashing', EMBEDDING_MODEL: 'gemini-embedding-2' }),
    );
  });

  it('trims a model name copied with stray spaces, so it does not read as a different model', () => {
    expect(signatureFor({ ...base, EMBEDDING_MODEL: '  gemini-embedding-2 ' })).toBe(
      signatureFor(base),
    );
  });
});
