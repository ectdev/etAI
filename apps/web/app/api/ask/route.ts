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

    const conversationId = await recordTurn(
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

    return json({
      answer,
      coverage: null,
      gap: null,
      citations: [],
      sources: [],
      conversationId,
    });
  }

  const result = await answerQuestion(input.question);

  await recordQuestion({
    source: 'web',
    userId: session.user.id,
    question: input.question,
    result,
  });

  const visible = answerForRole(result, session.user.role === 'admin');

  /**
   * Stored after the answer exists, and allowed to fail loudly.
   *
   * Unlike the analytics record above, this one is part of what the person asked for: a
   * conversation they can come back to. Swallowing a failure here would show them a
   * history that quietly loses turns.
   */
  const conversationId = await recordTurn(
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
  );

  // The record above keeps everything. What goes back over the wire is cut by role:
  // timings, the model name and the retrieval distances are diagnostic.
  return json({ ...visible, conversationId });
});
