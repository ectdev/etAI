import { VECTOR_DIMENSIONS } from '@etai/shared';

/**
 * A keyless, offline embedding built with the hashing trick.
 *
 * Every word of the text is hashed to one of the vector's positions and a sign, the
 * counts are damped, and the result is scaled to unit length. Two texts that share words
 * share positions, so their cosine distance falls as their vocabulary overlaps. That is
 * lexical similarity rather than meaning: "artifact limit" finds documents that say
 * "artifact" and "limit", and does not find one that only says "maximum upload size".
 *
 * It is the technique behind scikit-learn's HashingVectorizer (Weinberger et al., 2009),
 * chosen here over a random vector seeded by the text, which is what most test doubles
 * use, because a random vector makes every search return noise. With this one the whole
 * pipeline still does something a person can check by eye, with no key and no network.
 *
 * The signed hash matters: adding +1 and -1 into the same position lets collisions
 * cancel rather than accumulate, which keeps the inner product an unbiased estimate of
 * word overlap at a width this size.
 */

/** Names the algorithm in an embedding signature. Change it if the output changes. */
export const HASHING_MODEL = 'fnv1a-unigram-v1';

/**
 * Words that carry no subject. Left in, they put every English sentence close to every
 * other one, and the overlap that matters is in the nouns. Kept short on purpose: a long
 * list starts deciding what the corpus is about.
 */
const STOPWORDS = new Set(
  (
    'a an and are as at be but by for from has have how i if in into is it its of on or ' +
    'that the their there these this to was were what when where which who why will with'
  ).split(' '),
);

/** FNV-1a, 32 bit. Fast, dependency free, and stable across platforms and runs. */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function tokenize(text: string): string[] {
  return (
    text
      .normalize('NFKC')
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? []
  ).filter((token) => !STOPWORDS.has(token));
}

export function hashEmbedding(text: string, dimensions = VECTOR_DIMENSIONS): number[] {
  if (!Number.isInteger(dimensions) || dimensions < 1) {
    throw new RangeError(`dimensions must be a positive whole number. Got ${dimensions}.`);
  }

  const counts = new Map<string, number>();
  for (const token of tokenize(String(text ?? ''))) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }

  const vector = new Array<number>(dimensions).fill(0);
  for (const [token, count] of counts) {
    const hash = fnv1a(token);
    const position = hash % dimensions;
    // A second, independent bit for the sign, so position and sign are not correlated.
    const sign = fnv1a(`${token}#sign`) & 1 ? 1 : -1;
    vector[position] = (vector[position] ?? 0) + sign * (1 + Math.log(count));
  }

  let sumOfSquares = 0;
  for (const value of vector) sumOfSquares += value * value;
  const norm = Math.sqrt(sumOfSquares);

  // A text with no words at all would be the zero vector, and cosine distance to the zero
  // vector is undefined: pgvector returns NaN, which sorts unpredictably. One fixed unit
  // vector keeps every text comparable and puts the empty ones together.
  if (norm === 0) {
    vector[0] = 1;
    return vector;
  }

  return vector.map((value) => value / norm);
}
