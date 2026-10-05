import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createScratchDatabase, type ScratchDatabase } from '@etai/db/testing';

/**
 * The keyless configuration, measured on the real corpus.
 *
 * With `EMBEDDING_PROVIDER=hashing` nobody needs a key to index or search, which is how
 * CI runs. Those vectors put every question far from everything, and a refusal limit
 * measured on Google's model refused every answerable question here by arithmetic,
 * before any model was asked. The limit is now per provider; this file is the
 * measurement behind the hashing value, re-taken on every run, so a change to the
 * hashing scheme or the corpus that moves the distances fails here rather than quietly
 * refusing real questions.
 *
 * Its own database, indexed from scratch, so it measures what a fresh clone gets.
 */

const CORPUS = fileURLToPath(new URL('../../../../corpus', import.meta.url));

let scratch: ScratchDatabase;
type Db = typeof import('@etai/db');
let db: Db;
let measure: typeof import('./measure.js');
let queries: typeof import('./queries.js');
let embed: typeof import('../embedding/embed.js');

beforeAll(async () => {
  loadDotenv({ path: join(process.cwd(), '.env'), quiet: true });
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error('DATABASE_URL is needed to create a scratch database');

  scratch = await createScratchDatabase(base);
  process.env.DATABASE_URL = scratch.url;
  process.env.EMBEDDING_PROVIDER = 'hashing';

  db = await import('@etai/db');
  const persist = await import('../ingestion/persist.js');
  measure = await import('./measure.js');
  queries = await import('./queries.js');
  embed = await import('../embedding/embed.js');

  await persist.ingestCorpus({ corpusPath: CORPUS });
}, 120_000);

afterAll(async () => {
  await db?.closeDb();
  await scratch?.drop();
});

describe('keyless retrieval over the real corpus', () => {
  let results: Awaited<ReturnType<typeof measure.measureQueries>>;

  beforeAll(async () => {
    results = await measure.measureQueries(measure.hybridRetriever, queries.evalQueries);
  }, 120_000);

  it('runs with the hashing limit, not the one measured for Google', () => {
    expect(embed.relevanceLimit()).toBe(0.97);
    expect(embed.relevanceLimitFor({ EMBEDDING_PROVIDER: 'google' })).toBe(0.4);
  });

  it('refuses no question the collection can answer, by distance alone', () => {
    const limit = embed.relevanceLimit();
    const refused = results
      .filter((result) => result.expect !== 'out_of_scope' && result.nearest > limit)
      .map((result) => `${result.nearest.toFixed(4)} ${result.question}`);

    expect(refused).toEqual([]);
  });

  it('still turns away the questions that are plainly nothing', () => {
    // Measured: "?????", "42", "Hello", a run of one letter, and a capital city.
    const turnedAway = results.filter(
      (result) => result.expect === 'out_of_scope' && result.nearest > embed.relevanceLimit(),
    );

    expect(turnedAway.length).toBeGreaterThanOrEqual(3);
  });

  it('finds the expected documents nearly as often as it did when measured', () => {
    // 64 of 67 when the hashing limit was set. Keyword search carries most of this.
    const score = measure.scoreRetrieval(results);

    expect(score.recallAtK).toBeGreaterThanOrEqual(60);
  });
});
