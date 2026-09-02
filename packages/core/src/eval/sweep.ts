import { embedQuery } from '../embedding/embed.js';
import { normalizeQuestion } from '../retrieval/question.js';
import { searchChunks } from '../retrieval/search.js';
import { evalQueries } from './queries.js';
import { measureQueries, scoreRetrieval, TOP_K, type RetrievalScore } from './measure.js';

/**
 * Runs the question set at several settings and reports what each one scores.
 *
 * The ranking constants were picked by reasoning about what they should do, which is a
 * fine way to arrive at a first value and a poor way to defend one. This runs the
 * measurement across a range so the value in the code is the one that measured best
 * rather than the one that sounded right.
 *
 * It is a command rather than a test. The result is a judgement about what to set, and it
 * costs one embedding call per question for the whole run.
 *
 * Once per question rather than once per question per setting, which it used to be. None
 * of the settings below changes what a question means, so the twelve vectors it produced
 * for each one were twelve copies. Twelve settings times the question set is more calls
 * than a free key gets in a day, and the run died partway through the table with the rows
 * it had already printed looking perfectly reasonable.
 */

export interface SweepSetting {
  label: string;
  perTypeLimit?: number;
  crowdedTypes?: readonly string[];
  deprecatedDemotion?: number;
  supersededDemotion?: number;
  candidates?: number;
}

export interface SweepResult extends RetrievalScore {
  label: string;
}

/**
 * A search that fell back to keyword only, retried rather than counted.
 *
 * A sweep is twelve times as many embedding calls as an ordinary run, sent one after
 * another, and that is enough to meet a rate limit that a single run never does. When it
 * does, `searchChunks` does the right thing for a user and the wrong thing for a
 * measurement: it returns keyword results and sets `degraded`, and the row goes into the
 * table looking like a ranking result rather than a search that never ran.
 *
 * Every number in the table has to come from the same path, so a degraded result waits
 * and asks again, and a setting that cannot get a clean answer stops the run instead of
 * reporting a contaminated one. Losing the sweep is cheap; publishing a comparison
 * between one setting measured properly and another measured without vectors is not.
 */
const RETRY_PAUSE_MS = 20_000;
const MAX_ATTEMPTS = 4;

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function sweep(settings: SweepSetting[]): Promise<SweepResult[]> {
  const results: SweepResult[] = [];
  const vectors = await embedOnce(evalQueries.map((query) => query.question));

  for (const setting of settings) {
    const measured = await measureQueries(async (question) => {
      const result = await searchUntilNotDegraded(question, {
        ...(vectors.get(question) === undefined ? {} : { embedding: vectors.get(question) }),
        limit: TOP_K,
        ...(setting.perTypeLimit === undefined ? {} : { perTypeLimit: setting.perTypeLimit }),
        ...(setting.crowdedTypes === undefined ? {} : { crowdedTypes: setting.crowdedTypes }),
        ...(setting.deprecatedDemotion === undefined
          ? {}
          : { deprecatedDemotion: setting.deprecatedDemotion }),
        ...(setting.supersededDemotion === undefined
          ? {}
          : { supersededDemotion: setting.supersededDemotion }),
        ...(setting.candidates === undefined ? {} : { candidates: setting.candidates }),
      });

      return {
        paths: [...new Set(result.chunks.map((chunk) => chunk.path))],
        nearestDistance: result.nearestDistance,
      };
    });

    results.push({ label: setting.label, ...scoreRetrieval(measured) });
  }

  return results;
}

/**
 * Every question turned into a vector once, before any setting runs.
 *
 * Done here rather than inside the loop so that a quota failure stops the run before it
 * has printed half a table, and so the twelve rows are compared on identical input rather
 * than on twelve separate embeddings of the same words.
 *
 * It embeds `normalizeQuestion(question).text` rather than the question, because that is
 * what `searchChunks` embeds. Passing a vector for the raw text would measure a pipeline
 * slightly different from the one that ships, and the difference would be invisible in
 * the table. A question the normaliser rejects gets no entry and falls through to the
 * ordinary path, which returns nothing for it either way.
 */
async function embedOnce(questions: string[]): Promise<Map<string, number[]>> {
  const vectors = new Map<string, number[]>();

  for (const question of new Set(questions)) {
    const normalized = normalizeQuestion(question);
    if (!normalized.usable) continue;

    vectors.set(question, await embedQuery(normalized.text));
  }

  return vectors;
}

async function searchUntilNotDegraded(
  question: string,
  options: Parameters<typeof searchChunks>[1],
): Promise<Awaited<ReturnType<typeof searchChunks>>> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const result = await searchChunks(question, options);
    if (!result.degraded) return result;

    if (attempt < MAX_ATTEMPTS) {
      console.error(
        `  embedding unavailable on "${question.slice(0, 48)}", waiting ${RETRY_PAUSE_MS / 1000}s (attempt ${attempt} of ${MAX_ATTEMPTS})`,
      );
      await pause(RETRY_PAUSE_MS);
    }
  }

  throw new Error(
    `Embedding stayed unavailable after ${MAX_ATTEMPTS} attempts on: ${question}\n` +
      'The sweep is stopping rather than reporting a row measured without vector search.',
  );
}

/**
 * The settings worth checking.
 *
 * Each varies one thing at a time from what is in the code, because a sweep over every
 * combination costs an embedding call per question per combination and answers a question
 * nobody asked.
 */
export const SWEEP_SETTINGS: SweepSetting[] = [
  { label: 'as configured' },

  {
    label: 'quota on every type',
    crowdedTypes: [
      'deployment_report',
      'meeting_note',
      'reference',
      'customer',
      'changelog',
      'guide',
      'postmortem',
    ],
  },
  { label: 'quota on nothing', crowdedTypes: [] },

  { label: 'per type limit 1', perTypeLimit: 1 },
  { label: 'per type limit 3', perTypeLimit: 3 },
  { label: 'per type limit 4', perTypeLimit: 4 },

  { label: 'retired demotion 3', deprecatedDemotion: 3 },
  { label: 'retired demotion 10', deprecatedDemotion: 10 },

  { label: 'superseded demotion 0', supersededDemotion: 0 },
  { label: 'superseded demotion 3', supersededDemotion: 3 },

  { label: 'candidates 15', candidates: 15 },
  { label: 'candidates 60', candidates: 60 },
];
