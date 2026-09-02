import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb, ingestionItem, ingestionRun, searchQuery } from '@etai/db';
import { isAnswered, VECTOR_DIMENSIONS, type Coverage } from '@etai/shared';
import { eq, sql } from 'drizzle-orm';
import { indexHealth, questionStats, recentQueries, recentRuns } from './overview.js';

/**
 * What the dashboard reports, checked against what it reports on.
 *
 * A dashboard is the one screen whose failure mode is being confidently wrong. Every
 * number here renders whatever it is: a count that double-counts, a split that disagrees
 * with the rule the rest of the system uses, or a stored total that no longer matches the
 * rows it was summarised from. None of that raises anything, and the page that shows it
 * is the page a reader turns to in order to find out whether anything is wrong.
 *
 * So these do not check that the queries return values. They check that the values agree
 * with the other place the same fact is recorded.
 *
 * Two of these carry their own data, and that is the point rather than convenience. The
 * first versions read whatever the database happened to hold, which was thirteen full
 * answers, eight refusals and two clean runs. Against that, a split that moved `partial`
 * to the wrong side and a join that returned no failures at all both passed, because the
 * counts they got wrong were zero. A fixture makes the case exist, and a premise
 * assertion makes it impossible for the case to quietly stop existing again.
 *
 * Needs the database and the corpus indexed, and no provider: pnpm ingest --write
 */

/** Marks every row this file writes, so cleaning up cannot take anything else with it. */
const FIXTURE = 'dashboard-overview-test-fixture';

let fixtureRunId: string;

beforeAll(async () => {
  const db = getDb();
  const startedAt = new Date();

  const [run] = await db
    .insert(ingestionRun)
    .values({
      status: 'partial',
      trigger: 'seed',
      corpusPath: FIXTURE,
      stats: { created: 2, updated: 0, skipped: 0, deleted: 1, failed: 1 },
      startedAt,
      finishedAt: new Date(startedAt.getTime() + 4200),
    })
    .returning({ id: ingestionRun.id });

  if (!run) throw new Error('could not write the fixture run');
  fixtureRunId = run.id;

  await db.insert(ingestionItem).values([
    { runId: run.id, path: `${FIXTURE}/one.md`, action: 'created' },
    { runId: run.id, path: `${FIXTURE}/two.md`, action: 'created' },
    { runId: run.id, path: `${FIXTURE}/gone.md`, action: 'deleted' },
    {
      runId: run.id,
      path: `${FIXTURE}/broken.md`,
      action: 'failed',
      error: 'embedding failed after 3 attempts, 429 rate_limited',
    },
  ]);

  // One question per coverage, so the split below has all four to get wrong.
  await db.insert(searchQuery).values(
    (['full', 'partial', 'not_documented', 'out_of_scope'] as const).map((coverage) => ({
      query: `${FIXTURE} ${coverage}`,
      coverage,
      resultCount: 8,
      answered: isAnswered(coverage) ? 'yes' : 'no',
      latencyMs: 1000,
    })),
  );
});

afterAll(async () => {
  const db = getDb();

  await db.delete(ingestionItem).where(eq(ingestionItem.runId, fixtureRunId));
  await db.delete(ingestionRun).where(eq(ingestionRun.corpusPath, FIXTURE));
  await db.delete(searchQuery).where(sql`${searchQuery.query} like ${`${FIXTURE}%`}`);

  await closeDb();
});

describe('index health against the index it describes', () => {
  it('reports the vector index that retrieval depends on being able to reach', async () => {
    /**
     * Read out of the catalogue rather than printed from the schema, because a vector
     * index that failed to build changes nothing a user can see: results stay correct
     * and every search scans the whole table instead.
     *
     * The operator class matters as much as the index. An HNSW index built for the wrong
     * distance function is never used by a cosine query, and the plan test in
     * `search.test.ts` asserts the planner reaches for this exact one.
     */
    const health = await indexHealth();

    expect(health.vectorIndex).toBe('HNSW, vector_cosine_ops');
    expect(health.keywordIndex).toBe('GIN, generated tsvector');
    expect(health.vectorDimensions).toBe(VECTOR_DIMENSIONS);
  });

  it('reports every chunk as embedded, which is what lets the vector query skip the join', async () => {
    // The shipped vector query reads `chunk` alone, with no join to `document`, and that
    // is what makes the index reachable. It is only correct while these agree.
    const health = await indexHealth();

    expect(health.chunks).toBeGreaterThan(0);
    expect(health.embedded).toBe(health.chunks);
  });
});

describe('the run history against the rows it summarises', () => {
  it('agrees with the per-document outcomes recorded for the same run', async () => {
    /**
     * The counts on a run are a stored summary, written once when the run finishes. The
     * per-document rows are written as it goes. Two records of one fact, and the summary
     * is the one on screen, so a drift between them is invisible exactly where it
     * matters: a run reporting three failures and holding thirty.
     */
    const runs = await recentRuns(5);
    expect(runs.length).toBeGreaterThan(0);

    const db = getDb();

    for (const run of runs) {
      const rows = await db
        .select({ action: ingestionItem.action, count: sql<number>`count(*)::int` })
        .from(ingestionItem)
        .where(eq(ingestionItem.runId, run.id))
        .groupBy(ingestionItem.action);

      const recorded = new Map(rows.map((row) => [row.action, row.count]));

      expect(run.counts.created, `run ${run.id} created`).toBe(recorded.get('created') ?? 0);
      expect(run.counts.updated, `run ${run.id} updated`).toBe(recorded.get('updated') ?? 0);
      expect(run.counts.skipped, `run ${run.id} skipped`).toBe(recorded.get('skipped') ?? 0);
      expect(run.counts.deleted, `run ${run.id} deleted`).toBe(recorded.get('deleted') ?? 0);
      expect(run.counts.failed, `run ${run.id} failed`).toBe(recorded.get('failed') ?? 0);
    }
  });

  it('lists the failed documents behind every failure it counted', async () => {
    // A partial run is only useful if it says which documents failed. The count and the
    // list come from different queries, so this is where they are made to agree.
    const runs = await recentRuns(5);

    // The premise. Without a run that actually failed something, every comparison below
    // is zero against zero, and a join returning nothing at all would pass.
    expect(runs.some((run) => run.counts.failed > 0)).toBe(true);

    for (const run of runs) {
      expect(run.failures.length, `run ${run.id}`).toBe(run.counts.failed);
    }

    const fixture = runs.find((run) => run.id === fixtureRunId);
    expect(fixture?.failures[0]?.error).toContain('rate_limited');
  });

  it('gives a finished run a duration and an unfinished one none', async () => {
    for (const run of await recentRuns(5)) {
      if (run.finishedAt === null) expect(run.durationMs).toBeNull();
      else expect(run.durationMs).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('the question statistics against the rule the rest of the system uses', () => {
  it('splits answered from declined the way isAnswered does, not its own way', async () => {
    /**
     * The split is written twice: once as a SQL filter on the coverage column, and once
     * as `isAnswered` in `@etai/shared`, which every other surface calls. Two spellings
     * of one rule is how a dashboard comes to report a different number from the chat
     * page for the same set of questions.
     *
     * This recomputes the split from `isAnswered` over the same counts and requires the
     * two to match, so changing the rule in one place fails here rather than showing up
     * as a discrepancy somebody notices months later.
     */
    const stats = await questionStats();

    // The premise, and the reason this test has a fixture behind it. With no `partial`
    // and no `not_documented` rows recorded, moving either to the wrong side of the split
    // changes nothing, and the first version of this test passed against exactly that.
    for (const [coverage, count] of Object.entries(stats.byCoverage)) {
      expect(count, `no ${coverage} question recorded, so the split is untested`).toBeGreaterThan(
        0,
      );
    }

    const entries = Object.entries(stats.byCoverage) as Array<[Coverage, number]>;
    const answered = entries
      .filter(([coverage]) => isAnswered(coverage))
      .reduce((total, [, count]) => total + count, 0);
    const declined = entries
      .filter(([coverage]) => !isAnswered(coverage))
      .reduce((total, [, count]) => total + count, 0);

    expect(stats.answered).toBe(answered);
    expect(stats.declined).toBe(declined);
  });

  it('counts today inside the last seven days rather than beside them', async () => {
    const stats = await questionStats();

    expect(stats.today).toBeLessThanOrEqual(stats.lastSevenDays);
  });
});

describe('the recent questions', () => {
  it('returns them newest first, which is the only order the column claims', async () => {
    const queries = await recentQueries(6);

    const times = queries.map((query) => query.createdAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });
});
