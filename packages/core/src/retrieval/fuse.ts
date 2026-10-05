export interface RankedItem {
  chunkId: string;
  /** Position in the list this came from, one based. */
  rank: number;
  /**
   * What breaks a tie, the same in every database holding the same corpus.
   *
   * The chunk id is a random UUID, so two installs of the same collection broke ties
   * differently, and in rank fusion ties are routine: the third result of one search and
   * the third result of the other score exactly the same. Which of them came first was
   * decided by two random ids.
   */
  key?: string;
}

export interface FusedItem {
  chunkId: string;
  key: string;
  score: number;
  vectorRank: number | null;
  keywordRank: number | null;
}

/**
 * The constant in reciprocal rank fusion.
 *
 * It sets how quickly the reward falls off with position. At 60, first place is worth
 * 1/61 and tenth is worth 1/70, so being in both lists at all matters more than being
 * first in one of them. That is the behaviour wanted here: the two searches fail in
 * different ways, and something both of them found is the safer bet.
 *
 * Sixty is the value from the paper the method comes from, and it is left alone because
 * tuning it on 71 questions would be fitting noise.
 */
const RRF_K = 60;

/**
 * Combines two ranked lists into one.
 *
 * Vector search and keyword search disagree usefully. Vector search finds a document
 * that answers the question in different words, and misses one that uses the exact term
 * the person typed. Keyword search does the opposite: it is the only one that reliably
 * finds a product name, a version number or a spelling nobody would paraphrase.
 *
 * Fusing by rank rather than by score is what makes this work without tuning. The two
 * searches produce numbers that are not comparable, a cosine distance and a text rank,
 * and any attempt to weigh one against the other needs a constant that has to be
 * guessed. Positions are comparable on their own.
 */
export function fuseByRank(vector: RankedItem[], keyword: RankedItem[]): FusedItem[] {
  const scores = new Map<string, FusedItem>();

  const add = (items: RankedItem[], field: 'vectorRank' | 'keywordRank') => {
    for (const item of items) {
      const existing = scores.get(item.chunkId) ?? {
        chunkId: item.chunkId,
        key: item.key ?? item.chunkId,
        score: 0,
        vectorRank: null,
        keywordRank: null,
      };

      existing.score += 1 / (RRF_K + item.rank);
      existing[field] = item.rank;
      scores.set(item.chunkId, existing);
    }
  };

  add(vector, 'vectorRank');
  add(keyword, 'keywordRank');

  return [...scores.values()].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Stable across databases, not only across runs: see `RankedItem.key`.
    return compareKeys(a.key, b.key) || compareKeys(a.chunkId, b.chunkId);
  });
}

/** Turns rows that came back in order into the shape fusion expects. */
export function toRanked<T>(
  rows: T[],
  getId: (row: T) => string,
  getKey?: (row: T) => string,
): RankedItem[] {
  return rows.map((row, index) => ({
    chunkId: getId(row),
    rank: index + 1,
    ...(getKey ? { key: getKey(row) } : {}),
  }));
}

/** Plain code point order, so the result does not depend on the machine's locale. */
function compareKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
