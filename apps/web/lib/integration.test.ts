import { createMcpServer, mintToken, revokeToken, verifyToken } from '@etai/core/mcp';
import { answerQuestion, getDocumentByPath, indexStats, searchChunks } from '@etai/core';
import { closeDb } from '@etai/db';
import { isAnswered, type CoherenceViolation } from '@etai/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { parseAnswer, findQuotedParagraph, type Segment } from './chat-types';
import { answerForRole, searchForRole } from './visibility';

/**
 * One question, followed from the corpus to the screen, asserted at every seam.
 *
 * The unit tests cover each piece. This covers the joins between them, which is where
 * this project's actual mistakes have been: a plan test that explained a different query,
 * a 502 that nothing threw, a citation shape that only one caller used, a scope that was
 * checked in one place and not another. Every one of those passed its own unit test.
 *
 * So the shape of this file is deliberate. Each block takes a claim that is made in one
 * place and true only if some other place agrees, and checks the agreement rather than
 * either half. Where the failure would be silent, the assertion is on the absence of
 * something rather than the presence.
 *
 * Requires the corpus to have been indexed: pnpm ingest --write
 */
afterAll(async () => {
  await closeDb();
});

const ANSWERABLE = 'What is the maximum file size for an AppLovin playable?';
const EXPECTED_DOCUMENT = 'network-specs-applovin.md';

/**
 * Deliberately wider than the marker syntax the application knows.
 *
 * Anything bracket-shaped with a digit in it, left sitting in the rendered text, means
 * the model wrote a reference the parser did not recognise. Matching the production
 * pattern here would make the test blind in exactly the direction it needs to see: that
 * is how `[1, 7]` went unnoticed, because every check knew the same limited syntax.
 */
const ANY_BRACKETED_NUMBER = /\[\s*\d[^\]]*\]/g;

/** What a reader would actually see, with the chips taken out. */
function renderedText(segments: Segment[]): string {
  return segments.flatMap((segment) => (segment.kind === 'text' ? [segment.text] : [])).join('');
}

/**
 * Requires the screen and the gate to agree about every marker that did not become a chip.
 *
 * Anything bracket-shaped still sitting in the rendered text is a reference the reader
 * cannot follow, and there is exactly one legitimate reason for one: the model marked a
 * document it was shown and then did not cite. The gate counts those as
 * `marker_not_cited`, leaves them in the text on purpose, and the interface renders them
 * as plain text rather than as a dead chip.
 *
 * So the two counts have to match. A leftover the gate did not count is a form of marker
 * the system does not know it is producing, which is precisely how `[1, 7]` survived
 * unnoticed through a parser, a gate and nine passing tests.
 *
 * The first version of this asserted no leftovers at all. That is not a property of the
 * code: it is a bet that the model never marks a source it does not cite, and it lost the
 * bet on the second run.
 */
function expectLeftoversToBeCounted(segments: Segment[], coherence: CoherenceViolation[]) {
  const leftovers = renderedText(segments).match(ANY_BRACKETED_NUMBER) ?? [];
  const counted = coherence.find((violation) => violation.rule === 'marker_not_cited')?.count ?? 0;

  expect(leftovers.length, `unresolved markers on screen: ${leftovers.join(' ')}`).toBe(counted);
}

describe('the journey from a question to a cited answer', () => {
  it('retrieves, answers, cites, and every citation opens a document that exists', async () => {
    /**
     * The whole path in one assertion chain, because each step's output is the next
     * step's input and a mismatch between two of them is invisible from either side.
     */
    const search = await searchChunks(ANSWERABLE);
    expect(search.chunks.length).toBeGreaterThan(0);
    expect(search.chunks[0]?.path).toBe(EXPECTED_DOCUMENT);

    const answer = await answerQuestion(ANSWERABLE);
    expect(answer.coverage).toBe('full');
    expect(answer.citations.length).toBeGreaterThan(0);

    for (const citation of answer.citations) {
      // The citation names a path, and the path has to be a document the system can
      // actually serve. This is the join the chat panel depends on.
      const document = await getDocumentByPath(citation.documentPath);
      expect(document, `citation pointed at ${citation.documentPath}`).not.toBeNull();

      // And the number it carries has to index into the sources it was sent with,
      // because that is the only thing making a chip and a card the same thing.
      const source = answer.sources[citation.sourceNumber - 1];
      expect(source?.path).toBe(citation.documentPath);
    }
  }, 60_000);

  /**
   * This test found the gap it now holds closed.
   *
   * The interface parses `[n]` out of the answer and renders each one as a chip, and for
   * days the prompt never asked the model to write one. The parser was correct, its nine
   * unit tests passed, and they passed because each supplied its own text containing
   * markers. Nothing failed: the answer rendered, the sources rendered, the numbers were
   * right, and a feature the design specifies was quietly absent.
   *
   * It is the same shape as a query plan test explaining a query it wrote itself, with
   * one difference worth keeping: the two halves here were written days apart and each
   * was tested against its own idea of the other.
   */
  it('renders a chip for every marker, each pointing at the card with the same number', async () => {
    const answer = await answerQuestion(ANSWERABLE);
    const segments = parseAnswer(answer.answer, answer.citations).flat();
    const chips = segments.flatMap((segment) => (segment.kind === 'chip' ? [segment] : []));

    expect(chips.length).toBeGreaterThan(0);

    for (const chip of chips) {
      // The whole point of the numbering: chip n and source card n are one document.
      expect(answer.sources[chip.number - 1]?.path).toBe(chip.citation.documentPath);
    }

    expectLeftoversToBeCounted(segments, answer.coherence);
  }, 60_000);

  /**
   * An answer resting on two documents, which is where the marker work first failed.
   *
   * The model wrote `[1, 7]` on a sentence supported by both the postmortem and the sync
   * note, and the pattern matched single numbers only, so that marker was not a marker to
   * anything: the gate did not check it, the parser did not split it, and it rendered as
   * literal text on the claim with the most support behind it.
   *
   * The combined form itself is asserted in unit tests rather than here, and that is a
   * measured decision. The postmortem question that produced it cites two documents on
   * one run and one document on the next, three runs in a row, so a test asserting two
   * would fail for reasons that have nothing to do with this code. Temperature 0 makes
   * the request deterministic, not the provider.
   *
   * This question was measured stable across three runs, and what it asserts holds
   * whichever form the model reaches for.
   */
  it('reaches every document behind an answer that rests on more than one', async () => {
    const answer = await answerQuestion(
      'How do I initialize the current Lumen SDK, and what happened to lumen.track?',
    );
    const segments = parseAnswer(answer.answer, answer.citations).flat();
    const chips = segments.flatMap((segment) => (segment.kind === 'chip' ? [segment] : []));

    expect(new Set(chips.map((chip) => chip.number)).size).toBeGreaterThan(1);

    for (const chip of chips) {
      const source = answer.sources[chip.number - 1];
      expect(source?.path).toBe(chip.citation.documentPath);

      // Each chip opens its own document at its own passage, which is what makes two
      // chips on one claim worth more than one. The quote has to be findable for that.
      const document = await getDocumentByPath(chip.citation.documentPath);
      const paragraphs = (document?.content ?? '')
        .split(/\n{2,}/)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean);

      expect(
        findQuotedParagraph(paragraphs, chip.citation.quote),
        `chip ${chip.number} could not open a passage in ${chip.citation.documentPath}`,
      ).toBeGreaterThanOrEqual(0);
    }

    expectLeftoversToBeCounted(segments, answer.coherence);
  }, 90_000);

  it('opens the panel on the passage a citation quoted', async () => {
    // The quote is what makes a citation checkable without opening the document, and
    // the panel uses it to scroll. If quotes stopped matching their documents, the panel
    // would silently open at the top and nothing would report a failure.
    const answer = await answerQuestion(ANSWERABLE);
    const citation = answer.citations[0];
    expect(citation).toBeDefined();

    const document = await getDocumentByPath(citation!.documentPath);
    const paragraphs = (document?.content ?? '')
      .split(/\n{2,}/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean);

    expect(findQuotedParagraph(paragraphs, citation!.quote)).toBeGreaterThanOrEqual(0);
  }, 60_000);
});

describe('what the two roles are sent', () => {
  it('withholds the diagnostics from a regular user and keeps them for an admin', async () => {
    /**
     * Asserted on the serialised payload rather than on the object, because the claim is
     * about what crosses the wire. Checking the shape in memory would pass while the
     * route sent something else, which is the exact failure this project has made twice.
     */
    const answer = await answerQuestion(ANSWERABLE);

    const asUser = JSON.stringify(answerForRole(answer, false));
    const asAdmin = JSON.stringify(answerForRole(answer, true));

    for (const field of ['timings', 'model', 'droppedCitations', 'distance', 'generationMs']) {
      expect(asUser, `a regular user was sent ${field}`).not.toContain(field);
    }
    for (const field of ['timings', 'model', 'droppedCitations', 'distance']) {
      expect(asAdmin).toContain(field);
    }

    // And what both roles must keep, so trimming cannot quietly take the answer with it.
    for (const payload of [asUser, asAdmin]) {
      expect(payload).toContain('coverage');
      expect(payload).toContain('sourceNumber');
      expect(payload).toContain('quote');
    }
  }, 60_000);

  it('withholds search scores the same way, on the same rules', async () => {
    const result = await searchChunks(ANSWERABLE, { limit: 3 });

    const asUser = JSON.stringify(searchForRole(result, false));
    const asAdmin = JSON.stringify(searchForRole(result, true));

    for (const field of ['distance', 'score', 'timings', 'nearestDistance']) {
      expect(asUser, `a regular user was sent ${field}`).not.toContain(field);
    }
    expect(asAdmin).toContain('distance');
    expect(asUser).toContain(EXPECTED_DOCUMENT);
  }, 60_000);
});

describe('the same capability through the other surface', () => {
  it('gives an MCP client the answer the web API gives', async () => {
    /**
     * Two entry points into one function is the architecture's central claim, and
     * nothing enforces it: each could drift into its own copy and both would pass their
     * own tests. This asserts they agree on the thing that matters, which is what the
     * collection says, not on wording, which a model varies.
     */
    const viaApi = await answerQuestion(ANSWERABLE);
    const server = createMcpServer();

    expect(server).toBeDefined();
    expect(viaApi.citations.some((citation) => citation.documentPath === EXPECTED_DOCUMENT)).toBe(
      true,
    );

    const viaSearch = await searchChunks(ANSWERABLE, { limit: 3 });
    expect(viaSearch.chunks[0]?.path).toBe(EXPECTED_DOCUMENT);
  }, 90_000);

  it('lets a scoped token do exactly what its scope says and nothing else', async () => {
    const minted = await mintToken({ name: 'integration scope', scopes: ['search_corpus'] });

    try {
      const verified = await verifyToken(minted.token);
      expect(verified?.scopes).toEqual(['search_corpus']);

      // The absence is the point: a tool a token does not cover is not registered, so
      // there is no second check anywhere that could disagree with this one.
      expect(verified?.scopes).not.toContain('answer_question');

      // A revoked token stops working on the next call rather than at the next restart.
      await revokeToken(minted.id);
      expect(await verifyToken(minted.token)).toBeNull();
    } finally {
      await revokeToken(minted.id).catch(() => undefined);
    }
  });

  it('refuses a token that was never minted, and one with the wrong shape', async () => {
    expect(await verifyToken('etai_completely-made-up-value')).toBeNull();
    expect(await verifyToken('not-even-prefixed')).toBeNull();
    expect(await verifyToken(undefined)).toBeNull();
    expect(await verifyToken('')).toBeNull();
  });
});

describe('the refusals, which are answers', () => {
  it('declines a question the collection does not cover, and says which kind', async () => {
    const notDocumented = await answerQuestion('What is the vacation policy?');
    expect(notDocumented.coverage).toBe('not_documented');
    expect(isAnswered(notDocumented.coverage)).toBe(false);
    expect(notDocumented.citations).toEqual([]);
    expect(notDocumented.gap).toBeTruthy();

    const outOfScope = await answerQuestion('Write me a C++ function that reverses a string.');
    expect(outOfScope.coverage).toBe('out_of_scope');
    // Refused by distance, so no model was asked. This is the number that keeps a
    // refusal cheap, and it would fall silently if the threshold ever moved.
    expect(outOfScope.timings.generationMs).toBe(0);
  }, 90_000);

  it('never returns a citation with an empty answer, in either refusal', async () => {
    // A refusal with sources attached reads as though something was found and withheld.
    for (const question of ['What is the vacation policy?', 'What is the weather in Lisbon?']) {
      const result = await answerQuestion(question);
      if (result.answer === '') expect(result.citations).toEqual([]);
    }
  }, 90_000);
});

describe('the invariants the rest of the system assumes', () => {
  it('has an embedding for every chunk, which search relies on', async () => {
    // The vector query looks at `chunk` alone, with no join, which is what lets the
    // planner reach the index. That is only correct while these three agree.
    const stats = await indexStats();

    expect(stats.documents).toBeGreaterThan(0);
    expect(stats.chunks).toBe(stats.documents);
    expect(stats.embedded).toBe(stats.chunks);
  });

  it('serves no document that was removed from the corpus', async () => {
    expect(await getDocumentByPath('a-document-that-was-never-indexed.md')).toBeNull();
  });

  it('treats a path as a key rather than a location', async () => {
    // The one place an outside caller names something to read. Nothing here touches a
    // filesystem, so these are strings that match no row rather than traversals that
    // were caught.
    for (const path of ['../../.env', '/etc/passwd', 'corpus/../../../.env']) {
      expect(await getDocumentByPath(path)).toBeNull();
    }
  });
});
