import { closeDb } from '@etai/db';
import {
  comparisonSet,
  PROVIDERS,
  questionsThatReachTheModel,
  scoreProvider,
  type ProviderScore,
} from './providers.js';

/**
 * `pnpm compare:providers`
 *
 * Costs two generation calls per question, so it is a command rather than a test. It is
 * run when the choice of model is in question, and its result goes into the README.
 */

function percentage(part: number, whole: number): string {
  return whole === 0 ? '-' : `${Math.round((part / whole) * 100)}%`;
}

function printScores(scores: ProviderScore[]): void {
  const columns = [
    ['metric', ...scores.map((score) => score.label)],
    [
      'coverage correct',
      ...scores.map(
        (score) =>
          `${score.coverageCorrect}/${score.questions} ${percentage(score.coverageCorrect, score.questions)}`,
      ),
    ],
    [
      'cited nothing invented',
      ...scores.map(
        (score) =>
          `${score.citationsClean}/${score.questions} ${percentage(score.citationsClean, score.questions)}`,
      ),
    ],
    [
      'cited when answering',
      ...scores.map(
        (score) =>
          `${score.citedWhenAnswering}/${score.answersExpected} ${percentage(score.citedWhenAnswering, score.answersExpected)}`,
      ),
    ],
    ['median generation', ...scores.map((score) => `${score.medianLatencyMs} ms`)],
  ];

  const width = 24;
  for (const [label, ...values] of columns) {
    console.log(
      `  ${(label ?? '').padEnd(width)}${values.map((v) => (v ?? '').padEnd(width)).join('')}`,
    );
  }
}

async function main(): Promise<void> {
  const all = comparisonSet();

  console.log(`\nFinding which of ${all.length} questions reach a model at all.`);
  const reaching = await questionsThatReachTheModel(all);
  console.log(
    `${reaching.length} do. The other ${all.length - reaching.length} are refused by distance ` +
      `before any model is called, so both providers answer them identically and comparing ` +
      `them would measure nothing.\n`,
  );

  const scores: ProviderScore[] = [];

  for (const choice of PROVIDERS) {
    console.log(`Running ${choice.label} over ${reaching.length} questions.`);
    scores.push(await scoreProvider(choice, reaching));
  }

  console.log('');
  printScores(scores);

  for (const score of scores) {
    if (score.disagreements.length === 0) continue;
    console.log(`\n${score.label} read these differently:`);
    for (const item of score.disagreements) {
      console.log(`  expected ${item.expected.join(' or ')}, got ${item.got}`);
      console.log(`    ${item.question}`);
    }
  }

  console.log('');
  await closeDb();
}

main().catch(async (error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  await closeDb();
  process.exit(1);
});
