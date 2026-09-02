import { afterAll, describe, expect, it } from 'vitest';
import { closeDb } from '@etai/db';
import { answerQuestion } from './answer.js';

/**
 * Answers real questions against the indexed collection.
 *
 * Each of these costs a model call, so there are few and each covers a behaviour the
 * collection was built to test rather than a variation on one. The full walkthrough,
 * with the answers printed for a person to read, is `pnpm answers`.
 *
 * Requires the corpus to have been indexed: pnpm ingest --write
 */
afterAll(async () => {
  await closeDb();
});

describe('answering from the documents', () => {
  it('answers a question the collection covers, and cites what it used', async () => {
    const result = await answerQuestion('What is the maximum file size for an AppLovin playable?');

    expect(result.coverage).toBe('full');
    expect(result.answer).toMatch(/5\s*MB/i);
    expect(result.citations.length).toBeGreaterThan(0);
    expect(result.citations[0]?.documentPath).toBe('network-specs-applovin.md');
  });

  it('cites nothing it was not given', async () => {
    const result = await answerQuestion('Which languages must every playable ship with?');
    const allowed = new Set(result.sources.map((source) => source.path));

    for (const citation of result.citations) {
      expect(allowed).toContain(citation.documentPath);
    }
    expect(result.droppedCitations).toEqual([]);
  });

  it('quotes the document rather than paraphrasing it in the citation', async () => {
    const result = await answerQuestion('Which languages must every playable ship with?');

    expect(result.citations[0]?.quote.length).toBeGreaterThan(10);
  });

  /**
   * The trap the collection was built around. One release note introduces a change and
   * the next reverses it, and a third, later note exists that has nothing to do with
   * either. Similarity ranks the first one highest because it is the one that talks
   * about the change at length.
   */
  it('answers from the release note that reversed a decision, not the one that made it', async () => {
    const result = await answerQuestion(
      'Was the shared compression path for audio kept or reverted?',
    );

    expect(result.answer).toMatch(/revert/i);
    expect(result.answer).toMatch(/4\.2/);
  });

  it('says the old SDK call no longer works when asked about it', async () => {
    const result = await answerQuestion(
      'How do I initialize the current Lumen SDK, and what happened to lumen.track?',
    );

    expect(result.answer).toMatch(/LumenSDK\.init/);
    // The second half of the question. An answer that only gives the new call has
    // answered half of what was asked.
    expect(result.answer).toMatch(/no longer|not recognized|fail silently|deprecated|retired/i);
  });

  /**
   * The other half of the rule about retired documents, and the half that fails quietly.
   *
   * The test above checks the rule fires. This checks it stays put. A rule that always
   * fires looks correct from the answers it was written for and is wrong everywhere else:
   * the answer is still right, there is just an extra paragraph at the end about a
   * document that was never out of date. Nothing about the output says it is wrong, which
   * is exactly why it needs a test rather than a reading.
   */
  it('says nothing about supersession when nothing it cited is retired', async () => {
    const result = await answerQuestion('Which languages must every playable ship with?');

    /**
     * The premise, and it used to be the wrong one.
     *
     * This asserted that no retired document appeared anywhere in the eight sources, and
     * it failed, correctly, on a live run. Rank eight of this question is a near tie:
     * 0.3795 against 0.3798, close enough that which document lands there is decided by
     * approximate search rather than by relevance. A superseded changelog took the slot
     * and the test went red for a reason that has nothing to do with the rule it covers.
     *
     * The rule is about what the answer talks about, and an answer talks about what it
     * cited. Scoping the premise to the citations makes the test stable, and it makes it
     * say more: a retired document can now sit in the context, and the answer still must
     * not volunteer a paragraph about it.
     */
    const retired = new Set(
      result.sources
        .filter((source) => source.isDeprecated || source.supersededByPath !== null)
        .map((source) => source.path),
    );

    expect(
      result.citations.length,
      'nothing was cited, so there is nothing to check',
    ).toBeGreaterThan(0);

    for (const citation of result.citations) {
      expect(retired.has(citation.documentPath), `${citation.documentPath} is retired`).toBe(false);
    }

    expect(result.answer).not.toMatch(/retired|deprecat|superseded|replaced by|no longer current/i);
  });
});

describe('refusing', () => {
  it('refuses a reasonable question nobody wrote the answer to', async () => {
    const result = await answerQuestion('What is the vacation policy?');

    expect(result.coverage).toBe('not_documented');
    expect(result.answer).toBe('');
    expect(result.citations).toEqual([]);
    expect(result.gap).toBeTruthy();
  });

  it('refuses a question about something else entirely, without a model call', async () => {
    const result = await answerQuestion('Write me a C++ function that reverses a string.');

    expect(result.coverage).toBe('out_of_scope');
    // Nothing was generated, which is the point of the distance check.
    expect(result.timings.generationMs).toBe(0);
  });

  it('says what the collection is about when turning a question away', async () => {
    const result = await answerQuestion('What is the weather in Lisbon tomorrow?');

    expect(result.coverage).toBe('out_of_scope');
    expect(result.gap).toBeTruthy();
  });
});

describe('answering partly', () => {
  /**
   * Six client briefs name ironSource as a target network and no document specifies
   * anything about it, so the question retrieves confidently and cannot be answered. A
   * distance threshold cannot catch this, which is why coverage is a judgement made with
   * the documents in view.
   */
  it('says what it has and names what is missing', async () => {
    const result = await answerQuestion('What is the ironSource file size limit?');

    expect(result.coverage).toBe('partial');
    expect(result.gap).toMatch(/ironsource/i);
    expect(result.gap).toMatch(/not|no /i);
  });
});

describe('what comes back', () => {
  it('reports the sources it was allowed to use, with their metadata', async () => {
    const result = await answerQuestion('Why are sound assets built in a separate pass?');

    expect(result.sources.length).toBeGreaterThan(0);
    for (const source of result.sources) {
      expect(source.path).toBeTruthy();
      expect(typeof source.isDeprecated).toBe('boolean');
    }
  });

  it('reports where the time went', async () => {
    const result = await answerQuestion('What has to pass before a delivery goes to a client?');

    expect(result.timings.retrievalMs).toBeGreaterThan(0);
    expect(result.model).toBeTruthy();
  });
});
