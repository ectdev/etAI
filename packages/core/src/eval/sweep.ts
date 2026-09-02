import { searchChunks } from '../retrieval/search.js';
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
 * costs an embedding call per question per setting.
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

export async function sweep(settings: SweepSetting[]): Promise<SweepResult[]> {
  const results: SweepResult[] = [];

  for (const setting of settings) {
    const measured = await measureQueries(async (question) => {
      const result = await searchChunks(question, {
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
      'delivery_report',
      'meeting_note',
      'reference',
      'client_brief',
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
