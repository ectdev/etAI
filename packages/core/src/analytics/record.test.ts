import { afterAll, describe, expect, it } from 'vitest';
import { closeDb, getDb, searchQuery } from '@etai/db';
import type { AnswerResponse } from '@etai/shared';
import { fileURLToPath } from 'node:url';
import { desc, eq, sql } from 'drizzle-orm';
import { recordQuestion } from './record.js';

/**
 * That every surface which answers a question records it.
 *
 * The dashboard is headed "what people are asking" and for a while it meant "what people
 * asked in a browser". The MCP tools call `answerQuestion` directly, so an agent's
 * questions were absent from the list and the refusal counts were short by the same
 * number. Nothing failed. The page rendered a smaller, tidier version of the truth.
 *
 * These tests are about the recording, not about MCP, because the failure was not in the
 * MCP code: it was one caller of a shared function that nobody had noticed was missing.
 * The assertion that would have caught it is the last one here, which counts callers
 * rather than trusting them.
 *
 * Needs the database, and no provider.
 */

const MARKER = 'analytics-record-test-fixture';

function answerFor(coverage: AnswerResponse['coverage']): AnswerResponse {
  return {
    answer: coverage === 'full' ? 'Five megabytes [1].' : '',
    coverage,
    gap: null,
    citations: [],
    sources: [
      {
        documentId: '00000000-0000-0000-0000-000000000001',
        path: 'runner-specs-aws.md',
        title: 'AWS',
        headingPath: null,
        docType: 'reference',
        temporalDate: null,
        isDeprecated: false,
        supersededByPath: null,
        distance: 0.2,
      },
    ],
    droppedCitations: [],
    coherence: [],
    timings: { retrievalMs: 400, generationMs: 3000 },
    model: 'gemini-3.6-flash',
  };
}

afterAll(async () => {
  await getDb()
    .delete(searchQuery)
    .where(sql`${searchQuery.query} like ${`${MARKER}%`}`);
  await closeDb();
});

describe('recording a question', () => {
  it('keeps a question asked through MCP, attributed to no user', async () => {
    await recordQuestion({
      source: 'mcp',
      question: `${MARKER} from an agent`,
      result: answerFor('full'),
    });

    const [row] = await getDb()
      .select()
      .from(searchQuery)
      .where(eq(searchQuery.query, `${MARKER} from an agent`))
      .limit(1);

    expect(row, 'the question was not recorded at all').toBeDefined();
    expect(row?.source).toBe('mcp');
    expect(row?.userId).toBeNull();
    expect(row?.answered).toBe('yes');
    expect(row?.latencyMs).toBe(3400);
  });

  it('attributes a question over HTTP to the token it arrived on', async () => {
    /**
     * The security half. A token that leaks is used, and the only way to see what it was
     * used for afterwards is to have written it down at the time.
     */
    const db = getDb();
    const [token] = await db
      .insert((await import('@etai/db')).mcpToken)
      .values({ name: MARKER, tokenHash: `${MARKER}-hash`, scopes: ['answer_question'] })
      .returning({ id: sql<string>`id` });

    try {
      await recordQuestion({
        source: 'mcp',
        mcpTokenId: token?.id,
        question: `${MARKER} with a token`,
        result: answerFor('full'),
      });

      const [row] = await db
        .select()
        .from(searchQuery)
        .where(eq(searchQuery.query, `${MARKER} with a token`))
        .limit(1);

      expect(row?.mcpTokenId).toBe(token?.id);
    } finally {
      const { mcpToken } = await import('@etai/db');
      await db.delete(searchQuery).where(eq(searchQuery.query, `${MARKER} with a token`));
      await db.delete(mcpToken).where(eq(mcpToken.name, MARKER));
    }
  });

  it('records a refusal as a question, so the decline count is not short', async () => {
    // A refusal is the outcome the dashboard is most useful for. Recording only the
    // answers would make the collection look better covered than it is.
    await recordQuestion({
      source: 'web',
      userId: undefined,
      question: `${MARKER} a refusal`,
      result: answerFor('out_of_scope'),
    });

    const [row] = await getDb()
      .select()
      .from(searchQuery)
      .where(eq(searchQuery.query, `${MARKER} a refusal`))
      .orderBy(desc(searchQuery.createdAt))
      .limit(1);

    expect(row?.coverage).toBe('out_of_scope');
    expect(row?.answered).toBe('no');
  });

  it('is called by every surface that answers a question', async () => {
    /**
     * The one that would have caught the original gap, and the only one here that does
     * not test behaviour.
     *
     * Two places answer a question: the web route and the MCP answer tool. Both have to
     * record it, and a third surface added later has to as well. Asserting on the source
     * files is blunt, and it is the only check that fails when somebody writes a new
     * caller of `answerQuestion` and forgets this, which is exactly what happened.
     */
    const { readFileSync } = await import('node:fs');
    const root = fileURLToPath(new URL('../../../..', import.meta.url));

    const callers = ['apps/web/app/api/ask/route.ts', 'packages/core/src/mcp/tools.ts'];

    for (const caller of callers) {
      const source = readFileSync(`${root}/${caller}`, 'utf8');

      expect(source, `${caller} answers questions`).toContain('answerQuestion');

      /**
       * The call, not the mention. The first version of this looked for the name
       * `recordQuestion` anywhere in the file, and the import line alone satisfied it:
       * deleting the call left the check green. A test whose subject is a string has to
       * be specific about which string.
       */
      expect(source, `${caller} answers questions and does not record them`).toMatch(
        /recordQuestion\(\{/,
      );
    }
  });
});
