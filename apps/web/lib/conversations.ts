import { and, asc, desc, eq, gte, sql } from 'drizzle-orm';
import { conversation, conversationTurn, getDb } from '@etai/db';
import type { Coverage, LinkedCitation } from '@etai/shared';
import type { ChatSource } from './chat-types';

/**
 * Reading and writing conversations.
 *
 * Every function here takes the owner's id and puts it in the query, rather than checking
 * ownership after fetching. The difference matters: a check placed after the read is one
 * `return` away from being skipped, and the version that forgets it still works perfectly
 * for the person who owns the row. Written this way, a conversation belonging to somebody
 * else does not come back at all, so there is nothing to forget to check.
 */

/** Long enough to tell two questions apart, short enough for a sidebar. */
const TITLE_LIMIT = 60;

export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: Date;
}

export interface StoredTurn {
  id: string;
  question: string;
  answer: string;
  /** Null for a turn answered without consulting a document. */
  coverage: Coverage | null;
  gap: string | null;
  citations: LinkedCitation[];
  sources: ChatSource[];
}

/**
 * The first question, cut to fit.
 *
 * No model is called for this. A title is worth one line of string handling and not a
 * generation call per conversation, and a truncated question is more honest about what
 * the conversation contains than a paraphrase would be.
 */
export function titleFrom(question: string): string {
  const clean = question.replace(/\s+/g, ' ').trim();
  if (clean.length <= TITLE_LIMIT) return clean;

  // Cut at a word boundary when there is one nearby, so the title does not end mid-word.
  const cut = clean.slice(0, TITLE_LIMIT);
  const space = cut.lastIndexOf(' ');

  return `${space > TITLE_LIMIT - 15 ? cut.slice(0, space) : cut}...`;
}

/** The signed-in user's conversations, most recently used first. */
export async function listConversations(
  userId: string,
  limit = 30,
): Promise<ConversationSummary[]> {
  return getDb()
    .select({
      id: conversation.id,
      title: conversation.title,
      updatedAt: conversation.updatedAt,
    })
    .from(conversation)
    .where(eq(conversation.userId, userId))
    .orderBy(desc(conversation.updatedAt))
    .limit(limit);
}

/**
 * One conversation with its turns, or null when it is not this user's.
 *
 * Null rather than an exception for a conversation that does not exist and for one that
 * belongs to somebody else, on purpose. Telling them apart tells a stranger which ids are
 * real, and there is nothing a caller could usefully do differently.
 */
export async function getConversation(
  id: string,
  userId: string,
): Promise<{ id: string; title: string; turns: StoredTurn[] } | null> {
  const db = getDb();

  const [found] = await db
    .select({ id: conversation.id, title: conversation.title })
    .from(conversation)
    .where(and(eq(conversation.id, id), eq(conversation.userId, userId)))
    .limit(1);

  if (!found) return null;

  const turns = await db
    .select({
      id: conversationTurn.id,
      question: conversationTurn.question,
      answer: conversationTurn.answer,
      coverage: conversationTurn.coverage,
      gap: conversationTurn.gap,
      citations: conversationTurn.citations,
      sources: conversationTurn.sources,
    })
    .from(conversationTurn)
    .where(eq(conversationTurn.conversationId, found.id))
    .orderBy(asc(conversationTurn.position));

  return {
    id: found.id,
    title: found.title,
    turns: turns.map((turn) => ({
      ...turn,
      citations: turn.citations as LinkedCitation[],
      sources: turn.sources as ChatSource[],
    })),
  };
}

/**
 * Deletes a conversation, if it is this user's.
 *
 * Returns whether anything was deleted, so the caller can answer a request for somebody
 * else's conversation the same way it answers one that does not exist. The owner is in
 * the WHERE clause for the same reason as everywhere else in this file: a delete that
 * finds the row first and checks afterwards is a delete that can be written without the
 * check and still pass every test the owner runs.
 *
 * The turns go with it through the foreign key rather than through a second statement.
 */
export async function deleteConversation(id: string, userId: string): Promise<boolean> {
  const deleted = await getDb()
    .delete(conversation)
    .where(and(eq(conversation.id, id), eq(conversation.userId, userId)))
    .returning({ id: conversation.id });

  return deleted.length > 0;
}

export interface TurnToStore {
  question: string;
  answer: string;
  coverage: Coverage | null;
  gap: string | null;
  citations: LinkedCitation[];
  sources: ChatSource[];
}

/**
 * Stores one exchange, starting a conversation when there is not one yet.
 *
 * Returns the conversation id, which is how the browser learns what it is now in: the
 * first question of a new conversation is asked without one.
 *
 * A conversation id that is not this user's is treated as absent, so a crafted request
 * writes a turn into a new conversation of their own rather than into somebody else's.
 */
export async function recordTurn(
  userId: string,
  conversationId: string | null,
  turn: TurnToStore,
  /** When this question replaces an earlier one, the position it replaces from. */
  replaceFromPosition?: number | null,
): Promise<string> {
  const db = getDb();

  let target = conversationId;

  if (target) {
    const [owned] = await db
      .select({ id: conversation.id })
      .from(conversation)
      .where(and(eq(conversation.id, target), eq(conversation.userId, userId)))
      .limit(1);

    if (!owned) target = null;
  }

  if (!target) {
    const [created] = await db
      .insert(conversation)
      .values({ userId, title: titleFrom(turn.question) })
      .returning({ id: conversation.id });

    if (!created) throw new Error('Could not start a conversation');
    target = created.id;
  }

  /**
   * The rewind, when this question replaces an earlier one.
   *
   * Only ever inside a conversation this user owns, because `target` has already been
   * checked or freshly created above. Deleting first means the new turn takes the position
   * the old one had.
   */
  if (replaceFromPosition !== null && replaceFromPosition !== undefined) {
    await db
      .delete(conversationTurn)
      .where(
        and(
          eq(conversationTurn.conversationId, target),
          gte(conversationTurn.position, replaceFromPosition),
        ),
      );
  }

  /**
   * The next position, computed in the insert rather than read and then written.
   *
   * Two answers arriving at once would otherwise both read the same count and both claim
   * the same position, which is the one thing the ordering column exists to prevent.
   */
  await db.insert(conversationTurn).values({
    conversationId: target,
    position: sql`(select coalesce(max(${conversationTurn.position}) + 1, 0) from ${conversationTurn} where ${conversationTurn.conversationId} = ${target})`,
    question: turn.question,
    answer: turn.answer,
    coverage: turn.coverage,
    gap: turn.gap,
    citations: turn.citations,
    sources: turn.sources,
  });

  await db.update(conversation).set({ updatedAt: new Date() }).where(eq(conversation.id, target));

  return target;
}
