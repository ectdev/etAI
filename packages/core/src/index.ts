/**
 * What the rest of the repository may call.
 *
 * This package holds everything the system does with the document collection, and until
 * now it exported almost all of it: thirty names, including the internals of the
 * measurement harness. Two were used from outside, both in `apps/web`. Everything inside
 * the package imports its neighbours by relative path, so the other twenty-eight were
 * surface that existed without being asked for.
 *
 * That matters more now than it did. The MCP server has to choose which capabilities
 * become tools, and choosing from thirty exports where two are load bearing is a
 * different exercise from choosing from the list below.
 *
 * The rule is that a name appears here when something outside `packages/core` needs it.
 * Ingestion, retrieval, answering and the measurement harness all reach their own
 * internals directly, and a test importing a private module by path is fine, since tests
 * live inside the package.
 *
 * The measurement harness is reachable at `@etai/core/eval` for the commands that run
 * it. It is not part of what the application does.
 *
 * Nothing here depends on Next.js, React or HTTP. That is what lets the web routes, the
 * MCP server over stdio and the MCP route over HTTP call the same functions instead of
 * growing three versions of them.
 */

/** Search the collection. */
export {
  searchChunks,
  type RetrievedChunk,
  type SearchOptions,
  type SearchResult,
} from './retrieval/search.js';

/** Read one indexed document, by the path a citation names. */
export { getDocumentByPath, type StoredDocumentDetail } from './retrieval/document.js';

/** Answer a question from the collection, or explain why it cannot be answered. */
export { answerQuestion, type AskOptions } from './generation/answer.js';

/**
 * Index a folder of markdown files, and report on what is indexed.
 *
 * Here because the dashboard triggers a run and reads these numbers. The ingestion
 * command line uses the same functions through a relative import.
 */
export {
  ingestCorpus,
  indexStats,
  type IngestOptions,
  type IngestSummary,
  type IngestionTrigger,
} from './ingestion/persist.js';
