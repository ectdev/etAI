import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth.js';

/**
 * Tokens an MCP client presents to reach the search tools over HTTP.
 *
 * The application is behind a sign-in and the corpus is not public, so the HTTP
 * transport cannot be an unauthenticated way in. A desktop or editor MCP client does not
 * carry a session cookie, which is why this is a bearer token rather than a reuse of the
 * browser session.
 *
 * The token itself is never stored. What is stored is its SHA-256 hash, so a copy of
 * this table is not a copy of the credentials, and the value is shown once when it is
 * created. That also means a lost token is replaced rather than recovered, which is the
 * correct trade for something a client keeps in a config file.
 */
export const mcpToken = pgTable(
  'mcp_token',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** What this token is for, so a list of them can be read by a person. */
    name: text('name').notNull(),

    /** SHA-256 of the token. The token is shown once and never written down here. */
    tokenHash: text('token_hash').notNull().unique(),

    /**
     * What this token may call, as tool names.
     *
     * Scoped rather than all-or-nothing because the three tools cost very different
     * amounts. `search_corpus` is one embedding call; `answer_question` adds a model
     * call on top. A token handed to something that only needs to look things up should
     * not be able to spend the generation budget.
     */
    scopes: jsonb('scopes').notNull().$type<string[]>().default([]),

    createdByUserId: text('created_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),

    /** Updated on use, so an unused token is visible as one. */
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),

    /**
     * How many times this token has been accepted.
     *
     * `lastUsedAt` alone says a token is in use and nothing about how much. A token that
     * leaked is one that starts being used far more than whatever it was issued for, and
     * a count is the cheapest thing that makes that visible. Questions asked through a
     * token are attributable separately, on `search_query`, but the tools that do not
     * generate an answer would otherwise leave no trace at all.
     */
    useCount: integer('use_count').notNull().default(0),

    /** Set rather than deleted, so a revoked token cannot be recreated by accident. */
    revokedAt: timestamp('revoked_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('mcp_token_revoked_at_idx').on(table.revokedAt)],
);

export type McpToken = typeof mcpToken.$inferSelect;
