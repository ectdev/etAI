/**
 * The measurement harness, behind its own entry point.
 *
 * Separate from the package's main entry because it is not something the application
 * does. `pnpm eval`, `pnpm answers` and `pnpm compare:providers` are commands that judge
 * the system rather than parts of it, and mixing them into the main surface made the
 * list of things this package offers twice as long as the list of things it is for.
 *
 * The commands themselves reach these modules by relative path. This entry exists so
 * that anything outside the package which wants to run a measurement has one door.
 */

export { evalQueries, queryCounts, type EvalQuery, type QueryExpectation } from './queries.js';
export {
  measureQueries,
  scoreRetrieval,
  hybridRetriever,
  fusedOnlyRetriever,
  vectorOnlyRetriever,
  TOP_K,
  type QueryMeasurement,
  type RetrievalScore,
  type Retriever,
} from './measure.js';
export { sweep, SWEEP_SETTINGS, type SweepSetting, type SweepResult } from './sweep.js';
export {
  scoreProvider,
  questionsThatReachTheModel,
  expectedCoverage,
  PROVIDERS,
  type ProviderScore,
  type ProviderChoice,
} from './providers.js';
