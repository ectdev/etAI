import { getDb, searchQuery } from '@etai/db';
import { isAnswered, type AnswerResponse } from '@etai/shared';

/**
 * Recording how a question turned out, for every surface that answers one.
 *
 * This lived in `apps/web` and was called from `/api/ask` alone. The MCP tools call
 * `answerQuestion` directly, so every question asked by an agent was missing from the
 * record, and the dashboard displayed what was left under the heading "what people are
 * asking". The counts of refusals were wrong by the same amount. A screen stating
 * something false about the system is worse than a screen with less on it.
 *
 * So it moved here, where both surfaces can reach it, which is the same reason retrieval
 * and answering live in this package rather than behind the web app.
 */

/**
 * How many times recording has failed since the process started.
 *
 * A failure that is only logged is a failure nobody counts. Analytics that quietly drops
 * rows reports a smaller, cheerier picture than the truth and gives no sign it is doing
 * so, so the dashboard reads this to say whether its own numbers are complete.
 */
let failures = 0;

/** Failed writes since the process started. Zero means the recorded history is complete. */
export function analyticsRecordingFailures(): number {
  return failures;
}

export interface QuestionRecord {
  question: string;
  result: AnswerResponse;
  /** Which door the question came in through. */
  source: 'web' | 'mcp';
  /** The signed-in person, for a web question. */
  userId?: string;
  /** The bearer token, for a question over the MCP HTTP transport. */
  mcpTokenId?: string;
}

/**
 * Records how a question turned out.
 *
 * Recording must not be able to fail the request. The person asked a question and got an
 * answer; losing that answer because a statistics row could not be written would trade
 * something that matters for something that does not. So this never throws, and the cost
 * of never throwing is paid by the counter above rather than by silence.
 *
 * It is written after the answer rather than before, so the row carries how the question
 * actually turned out: whether the collection covered it, how long it took, and which
 * documents were used.
 */
export async function recordQuestion(input: QuestionRecord): Promise<void> {
  const { question, result, source, userId, mcpTokenId } = input;

  try {
    await getDb()
      .insert(searchQuery)
      .values({
        userId: userId ?? null,
        mcpTokenId: mcpTokenId ?? null,
        source,
        query: question,
        coverage: result.coverage,
        resultCount: result.sources.length,
        topDocumentIds: result.sources.slice(0, 5).map((item) => item.documentId),
        answered: isAnswered(result.coverage) ? 'yes' : 'no',
        generationModel: result.model,
        latencyMs: result.timings.retrievalMs + result.timings.generationMs,
      });
  } catch (error) {
    failures += 1;
    // A warning rather than an error, because nothing the caller asked for went wrong.
    // The running count is what makes it noticeable if this stops being occasional.
    console.warn(
      `Could not record a question (${failures} failed since start):`,
      error instanceof Error ? error.message : error,
    );
  }
}
