import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { document } from './corpus.js';
import { user } from './auth.js';
import { mcpToken } from './mcp.js';

/**
 * `partial` is the interesting one. If three documents out of a hundred and forty
 * fail to embed, the other hundred and thirty-seven are still indexed and the run
 * says so, rather than reporting a success that hides the gap or a failure that
 * throws away the work.
 */
export const ingestionStatus = pgEnum('ingestion_status', [
  'running',
  'completed',
  'partial',
  'failed',
]);

export const ingestionTrigger = pgEnum('ingestion_trigger', [
  'cli',
  'dashboard',
  'watch',
  'schedule',
  'seed',
]);

export const ingestionAction = pgEnum('ingestion_action', [
  'created',
  'updated',
  'skipped',
  'deleted',
  'failed',
]);

/**
 * What happened to a question.
 *
 * The four values match `coverageSchema` in `@etai/shared`, which is where they are
 * explained. `out_of_scope` is the one decided without a model: the best match fell
 * below the similarity floor, so nothing was generated.
 */
export const answerCoverage = pgEnum('answer_coverage', [
  'full',
  'partial',
  'not_documented',
  'out_of_scope',
]);

/**
 * One row per ingestion run. This is what makes the pipeline observable rather than
 * merely repeatable: what was indexed, when, and whether it worked.
 */
export const ingestionRun = pgTable(
  'ingestion_run',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    status: ingestionStatus('status').notNull().default('running'),
    trigger: ingestionTrigger('trigger').notNull(),

    /** Null when the run came from the command line rather than from the dashboard. */
    triggeredByUserId: text('triggered_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),

    /** Counts per outcome, so the dashboard needs one row rather than an aggregate query. */
    stats: jsonb('stats')
      .notNull()
      .default({ created: 0, updated: 0, skipped: 0, deleted: 0, failed: 0 }),

    corpusPath: text('corpus_path').notNull(),
    error: text('error'),

    /**
     * True when this run exists because files changed while another run was in progress.
     *
     * Watch mode never runs two ingestions at once, since both write the same documents.
     * A change arriving mid-run is remembered rather than dropped, and it produces exactly
     * one follow-up run however many changes arrived. Without this column that follow-up
     * is indistinguishable from somebody saving a file the moment a run ended, and the two
     * mean different things when reading the log.
     */
    queued: boolean('queued').notNull().default(false),

    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (table) => [index('ingestion_run_started_at_idx').on(table.startedAt)],
);

/** One row per file per run, which is where a partial failure becomes readable. */
export const ingestionItem = pgTable(
  'ingestion_item',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => ingestionRun.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    action: ingestionAction('action').notNull(),
    documentId: uuid('document_id').references(() => document.id, { onDelete: 'set null' }),
    error: text('error'),
    durationMs: integer('duration_ms'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('ingestion_item_run_id_idx').on(table.runId),
    index('ingestion_item_action_idx').on(table.action),
  ],
);

/**
 * Which surface a question came in through.
 *
 * Added because the dashboard was reporting on `/api/ask` alone and calling it "what
 * people are asking". Every question asked through the MCP server was missing from the
 * count, which also made the refusal totals wrong. A question is a question whichever
 * door it arrived at, and the door is worth recording rather than assuming.
 */
export const questionSource = pgEnum('question_source', ['web', 'mcp']);

/**
 * One row per question asked. Recording the coverage alongside the query is what
 * lets the dashboard show how often the collection could not answer, which is more
 * useful than a raw count of searches.
 */
export const searchQuery = pgTable(
  'search_query',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),

    source: questionSource('source').notNull().default('web'),

    /**
     * The token an MCP question arrived on, when it arrived on one.
     *
     * Null for the web and for the stdio transport, which is a local process the
     * operating system already trusts and has no token to present. Set for HTTP, which
     * is what makes a question asked with a leaked token attributable to that token.
     */
    mcpTokenId: uuid('mcp_token_id').references(() => mcpToken.id, { onDelete: 'set null' }),

    query: text('query').notNull(),
    coverage: answerCoverage('coverage'),
    resultCount: integer('result_count').notNull().default(0),

    /** Ids of the documents that were put in front of the model, in rank order. */
    topDocumentIds: jsonb('top_document_ids').notNull().default([]),

    /** Whether the answer came from the retrieved documents or was refused outright. */
    answered: text('answered'),

    generationModel: text('generation_model'),
    latencyMs: integer('latency_ms'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('search_query_created_at_idx').on(table.createdAt),
    index('search_query_coverage_idx').on(table.coverage),
  ],
);

export type IngestionRun = typeof ingestionRun.$inferSelect;
export type IngestionItem = typeof ingestionItem.$inferSelect;
export type SearchQuery = typeof searchQuery.$inferSelect;
