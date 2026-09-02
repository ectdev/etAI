/**
 * What the dashboard reads, kept behind its own entry point.
 *
 * The main entry point of this package publishes five names, which is what the system
 * does. Reporting on the system is a different job from doing it, so it lives here for
 * the same reason the measurement harness lives behind `@etai/core/eval`.
 */
export {
  indexHealth,
  recentRuns,
  questionStats,
  recentQueries,
  type IndexHealth,
  type RunCounts,
  type RunSummary,
  type QuestionStats,
  type RecentQuery,
} from './overview.js';

export {
  listDocuments,
  documentTypes,
  type DocumentRow,
  type IndexingStatus,
} from './documents.js';
