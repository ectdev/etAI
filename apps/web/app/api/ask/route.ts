import { answerQuestion } from '@etai/core';
import { askSchema, classifySmallTalk, smallTalkReply } from '@etai/shared';
import { recordQuestion } from '@etai/core/analytics';
import { recordTurn } from '@/lib/conversations';
import { handler, json, readJson } from '@/lib/route';
import { requireRole } from '@/lib/session';
import { answerForRole } from '@/lib/visibility';

/**
 * Answers a question from the indexed documents.
 *
 * Every question is recorded, which is what the dashboard reports on. Recording cannot
 * fail the request; see `@etai/core/analytics` for what that costs and how it is
 * accounted for. The MCP tools call the same recorder, so the dashboard counts every
 * question rather than only the ones asked in a browser.
 *
 * The turn is also stored against a conversation, and the id comes back in the response
 * because the first question of a new conversation is asked without one. That happens
 * here rather than through a second endpoint so a question and its answer reach the
 * database together; two calls could store one without the other.
 */
/**
 * How long a greeting takes to come back.
 *
 * Answering instantly is its own tell: every real answer takes seconds and a pleasantry
 * arriving before the composer has cleared reads as a canned string rather than a reply.
 * The range is short enough not to waste anybody's time and varied so two hellos in a row
 * do not land on the same beat.
 */
const SMALL_TALK_PAUSE = { least: 420, most: 900 };

export const POST = handler(async (request) => {
  const session = await requireRole('admin', 'user');
  const input = await readJson(request, askSchema);

  /**
   * A greeting is answered here, without retrieval or a model call.
   *
   * It runs on the server rather than in the browser so that the turn is stored like any
   * other and is still there when the conversation is reopened, and so the same rule
   * applies to every caller rather than to whichever one remembered to check.
   *
   * Deliberately not recorded in the analytics: it is not a question about the documents,
   * and counting every hello as a refusal would make the refusal rate meaningless.
   */
  const pleasantry = classifySmallTalk(input.question);

  if (pleasantry) {
    const pause =
      SMALL_TALK_PAUSE.least +
      Math.floor(Math.random() * (SMALL_TALK_PAUSE.most - SMALL_TALK_PAUSE.least));

    await new Promise((resolve) => setTimeout(resolve, pause));

    const answer = smallTalkReply(pleasantry, input.question);

    const stored = await saveTurn(
      session.user.id,
      input.conversationId ?? null,
      {
        question: input.question,
        answer,
        // No document was consulted, so there is nothing for this to be covered by.
        coverage: null,
        gap: null,
        citations: [],
        sources: [],
      },
      input.replaceFromPosition,
    );

    return json({ answer, coverage: null, gap: null, citations: [], sources: [], ...stored });
  }

  const result = await answerQuestion(input.question);
  const visible = answerForRole(result, session.user.role === 'admin');

  /**
   * Two writes that need the answer and not each other, so they run together.
   *
   * The analytics record never fails the request; see `@etai/core/analytics`. The turn is
   * part of what the person asked for, a conversation to come back to, so its failure is
   * reported rather than swallowed. It is reported beside the answer, though, not instead
   * of it: the answer exists, it cost a model call, and a storage problem is no reason to
   * throw it away. The record keeps everything; what goes back over the wire is cut by
   * role, since timings, the model name and the distances are diagnostic.
   */
  const [, stored] = await Promise.all([
    recordQuestion({ source: 'web', userId: session.user.id, question: input.question, result }),
    saveTurn(
      session.user.id,
      input.conversationId ?? null,
      {
        question: input.question,
        answer: visible.answer,
        coverage: visible.coverage,
        gap: visible.gap,
        citations: visible.citations,
        sources: visible.sources,
      },
      input.replaceFromPosition,
    ),
  ]);

  return json({ ...visible, ...stored });
});

/**
 * Stores the turn, and says so when it could not.
 *
 * `saved: false` travels with the answer, and the chat shows it under the turn. The
 * conversation the browser is already in is kept, so the next question still goes there.
 */
async function saveTurn(
  ...args: Parameters<typeof recordTurn>
): Promise<{ conversationId: string | null; saved?: false }> {
  try {
    return { conversationId: await recordTurn(...args) };
  } catch (error) {
    console.error('A turn could not be saved to its conversation', error);
    return { conversationId: args[1], saved: false };
  }
}
