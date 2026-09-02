import { closeDb } from '@etai/db';
import { RELEVANCE_DISTANCE_LIMIT } from '@etai/shared';
import {
  fusedOnlyRetriever,
  hybridRetriever,
  measureQueries,
  scoreRetrieval,
  vectorOnlyRetriever,
  TOP_K,
  type QueryMeasurement,
  type Retriever,
} from './measure.js';
import { queryCounts } from './queries.js';
import { sweep, SWEEP_SETTINGS } from './sweep.js';

/**
 * Prints what the measurement found.
 *
 * Kept apart from the measuring itself so that importing the library does not run a few
 * dozen embedding calls as a side effect of loading a module.
 */

function quantile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return Number.NaN;
  const index = Math.min(sorted.length - 1, Math.floor(fraction * (sorted.length - 1)));
  return sorted[index] ?? Number.NaN;
}

function describe(label: string, values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    label,
    count: sorted.length,
    min: sorted[0] ?? Number.NaN,
    p25: quantile(sorted, 0.25),
    median: quantile(sorted, 0.5),
    p75: quantile(sorted, 0.75),
    max: sorted.at(-1) ?? Number.NaN,
  };
}

function reportDistances(results: QueryMeasurement[]) {
  const groups = [
    describe(
      'answerable',
      results.filter((r) => r.expect === 'answerable').map((r) => r.nearest),
    ),
    describe(
      'partly covered',
      results.filter((r) => r.expect === 'partial').map((r) => r.nearest),
    ),
    describe(
      'out of scope',
      results.filter((r) => r.expect === 'out_of_scope').map((r) => r.nearest),
    ),
  ];

  console.log('\nDistance to the nearest chunk, by kind of question');
  console.log('  kind             n     min    p25  median    p75     max');
  for (const group of groups) {
    console.log(
      `  ${group.label.padEnd(15)} ${String(group.count).padStart(2)}  ` +
        [group.min, group.p25, group.median, group.p75, group.max]
          .map((value) => value.toFixed(4).padStart(6))
          .join(' '),
    );
  }
}

function reportThreshold(results: QueryMeasurement[]) {
  const answerable = results.filter((r) => r.expect === 'answerable');
  const outOfScope = results.filter((r) => r.expect === 'out_of_scope');

  const answerableMax = Math.max(...answerable.map((r) => r.nearest));
  const caught = outOfScope.filter((r) => r.nearest > RELEVANCE_DISTANCE_LIMIT).length;
  const wronglyRefused = answerable.filter((r) => r.nearest > RELEVANCE_DISTANCE_LIMIT).length;

  console.log(
    `\nRefusing without a model call, at the configured limit of ${RELEVANCE_DISTANCE_LIMIT}`,
  );
  console.log(`  furthest answerable question   ${answerableMax.toFixed(4)}`);
  console.log(`  out of scope turned away       ${caught} of ${outOfScope.length}`);
  console.log(`  answerable wrongly refused     ${wronglyRefused} of ${answerable.length}`);

  if (wronglyRefused > 0) {
    console.log('  the limit is too tight, these real questions would be refused:');
    for (const result of answerable
      .filter((r) => r.nearest > RELEVANCE_DISTANCE_LIMIT)
      .sort((a, b) => a.nearest - b.nearest)) {
      console.log(`    ${result.nearest.toFixed(4)}  ${result.question}`);
    }
  }
}

function reportMisses(label: string, results: QueryMeasurement[]) {
  const missed = results.filter((r) => r.expect === 'answerable' && r.hit !== true);
  if (missed.length === 0) return;

  console.log(`\n${label}: questions where an expected document did not come back`);
  for (const result of missed) {
    console.log(`  [${result.group}] ${result.question}`);
    console.log(`    got: ${result.top.slice(0, 3).join(', ')}`);
  }
}

async function run(label: string, retrieve: Retriever) {
  const results = await measureQueries(retrieve);
  const score = scoreRetrieval(results);

  console.log(
    `\n${label.padEnd(14)} recall@${TOP_K} ${score.recallAtK}/${score.answerable}   ` +
      `first place ${score.firstPlace}/${score.answerable}   ` +
      `MRR ${score.mrr.toFixed(3)}`,
  );

  return { results, score };
}

async function runSweep() {
  console.log(`\nRunning ${queryCounts.total} questions at ${SWEEP_SETTINGS.length} settings.`);
  console.log('Each row varies one thing from what is in the code.\n');

  const results = await sweep(SWEEP_SETTINGS);
  const baseline = results[0];

  console.log('  setting                 recall@5   first place   MRR      vs configured');
  for (const result of results) {
    const delta = baseline ? result.recallAtK - baseline.recallAtK : 0;
    const marker = delta === 0 ? '' : delta > 0 ? `  +${delta}` : `  ${delta}`;

    console.log(
      `  ${result.label.padEnd(22)} ${String(result.recallAtK).padStart(2)}/${result.answerable}` +
        `      ${String(result.firstPlace).padStart(2)}/${result.answerable}` +
        `      ${result.mrr.toFixed(3)}${marker}`,
    );
  }

  console.log('');
  await closeDb();
}

async function main() {
  if (process.argv.includes('--sweep')) {
    await runSweep();
    return;
  }

  const compare = process.argv.includes('--compare');

  console.log(
    `\nMeasuring ${queryCounts.total} questions: ${queryCounts.answerable} answerable, ` +
      `${queryCounts.partial} partly covered, ${queryCounts.outOfScope} out of scope.`,
  );

  const hybrid = await run('hybrid', hybridRetriever);

  if (compare) {
    // The baseline is only worth the extra embedding calls when a change is being
    // judged, so it is behind a flag rather than run every time.
    const baseline = await run('vector only', vectorOnlyRetriever);
    const fusedOnly = await run('fused, no rank', fusedOnlyRetriever);

    const show = (label: string, from: number) => {
      const delta = hybrid.score.recallAtK - from;
      console.log(
        `  against ${label.padEnd(16)} ${delta > 0 ? '+' : ''}${delta} on recall@${TOP_K}`,
      );
    };

    console.log('\n  What each step is worth');
    show('vector only', baseline.score.recallAtK);
    show('fused, no rank', fusedOnly.score.recallAtK);

    reportMisses('vector only', baseline.results);
    reportMisses('fused, no rank', fusedOnly.results);
  }

  reportDistances(hybrid.results);
  reportThreshold(hybrid.results);
  reportMisses('hybrid', hybrid.results);

  console.log('');
  await closeDb();
}

main().catch(async (error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  await closeDb();
  process.exit(1);
});
