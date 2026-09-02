import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth.js';
import { answerCoverage } from './ops.js';

/**
 * Conversations, so a question survives navigating away from the page.
 *
 * This is persistence and not continuity. Each turn is answered from the corpus alone,
 * with no memory of the turn before it, and storing them together does not change that.
 * The distinction is written into the README as well, because a list of past
 * conversations is exactly the interface element that implies a system remembers what you
 * said, and this one does not.
 */
export const conversation = pgTable(
  'conversation',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /**
     * Cascades, so deleting a user takes their conversations with them. The alternative
     * leaves rows whose owner is null, and a row with no owner in a table whose whole
     * access rule is ownership is a row nobody can be stopped from reading.
     */
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),

    /** The first question, truncated. No model is called to write it. */
    title: text('title').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** Moved on every new turn, so the sidebar orders by last used rather than by age. */
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('conversation_user_updated_idx').on(table.userId, table.updatedAt)],
);

/**
 * One question and its answer.
 *
 * The answer is stored as it was given, including the citations and the sources behind
 * them. Re-running the question later would produce a different answer once the corpus
 * changes, and a history that quietly rewrites itself is worse than no history.
 */
export const conversationTurn = pgTable(
  'conversation_turn',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversation.id, { onDelete: 'cascade' }),

    /** 0, 1, 2. Ordering by timestamp would tie for two turns in the same millisecond. */
    position: integer('position').notNull(),

    question: text('question').notNull(),
    answer: text('answer').notNull(),

    /**
     * Null when no document was consulted.
     *
     * A greeting is answered without a search, so there is nothing for it to be covered
     * by. Storing `out_of_scope` instead would be defensible and would make every hello
     * count as a question the corpus failed, which is the number the dashboard reports.
     */
    coverage: answerCoverage('coverage'),
    gap: text('gap'),

    /**
     * The citations and the source cards, exactly as the browser received them.
     *
     * JSON rather than two more tables. They are read and written whole, never queried
     * into, and nothing joins to them, so columns would buy nothing and cost two joins on
     * every reopened conversation.
     */
    citations: jsonb('citations').notNull().$type<unknown[]>().default([]),
    sources: jsonb('sources').notNull().$type<unknown[]>().default([]),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('conversation_turn_conversation_idx').on(table.conversationId, table.position)],
);
