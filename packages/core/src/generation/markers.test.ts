import { afterAll, describe, expect, it } from 'vitest';
import { closeDb } from '@etai/db';
import { citationMarkers, isAnswered } from '@etai/shared';
import { answerQuestion } from './answer.js';

/**
 * The markers a model actually writes, against the indexed collection.
 *
 * The interface has nine tests for the code that turns `[1]` into a chip. All nine pass,
 * and all nine supply their own text containing markers, so the whole feature was absent
 * for days while its tests were green: the prompt had never asked for a marker, and the
 * parser was correctly parsing nothing.
 *
 * That is why these run against real output. A test that writes its own input can only
 * check that a function does what it was written to do; it cannot notice that nothing
 * upstream produces the input in the first place.
 *
 * Removing the sentence from the system prompt turns four of these six red, which is the
 * property the file exists to hold. The other two stay green, and it is worth being exact
 * about why rather than claiming a stronger result: they assert that a refusal carries no
 * markers, and a prompt that never asks for markers satisfies that trivially. They guard
 * the opposite direction, where the instruction leaks into a reply that has no claims.
 *
 * Requires the corpus to have been indexed: pnpm ingest --write
 */
afterAll(async () => {
  await closeDb();
});

/** Each marker in the text points at a document the answer actually cited. */
function markersResolve(answer: { answer: string; citations: Array<{ sourceNumber: number }> }) {
  const cited = new Set(answer.citations.map((citation) => citation.sourceNumber));

  return citationMarkers(answer.answer).every((marker) => cited.has(marker));
}

describe('the markers a model writes into an answer', () => {
  it('marks the claim with the number of the one document it used', async () => {
    const result = await answerQuestion('What is the maximum file size for an AppLovin playable?');

    expect(citationMarkers(result.answer).length).toBeGreaterThan(0);
    expect(markersResolve(result)).toBe(true);
    expect(result.coherence).toEqual([]);
  }, 60_000);

  it('marks two documents separately when it uses the retired guide beside the current one', async () => {
    /**
     * The hardest case in the collection for this. Two versions of one SDK guide are in
     * front of the model, it has to answer from the current one and warn about the other,
     * and the two claims have to carry different numbers. A single number covering both
     * would look right in the interface and point the reader at the wrong guide for half
     * the answer.
     */
    const result = await answerQuestion(
      'How do I initialize the current Lumen SDK, and what happened to lumen.track?',
    );

    const paths = new Map(
      result.citations.map((citation) => [citation.sourceNumber, citation.documentPath]),
    );
    const markers = new Set(citationMarkers(result.answer));

    expect(markers.size).toBeGreaterThan(1);
    expect(markersResolve(result)).toBe(true);
    expect([...markers].map((marker) => paths.get(marker))).toEqual(
      expect.arrayContaining(['sdk-notes-v3.md', 'sdk-notes-v2.md']),
    );
    expect(result.coherence).toEqual([]);
  }, 60_000);

  it('marks what a partial answer does have, at whatever number that document sits at', async () => {
    /**
     * The number here is not 1. The brief that names ironSource is sixth among the
     * retrieved documents, and the answer cites only that one, so the single citation in
     * a correct answer is numbered 6.
     *
     * Worth asserting rather than assuming: a rule requiring citation numbers to run
     * contiguously from 1 would reject this, and it is the correct answer.
     */
    const result = await answerQuestion('What is the ironSource file size limit?');

    expect(result.coverage).toBe('partial');
    expect(citationMarkers(result.answer).length).toBeGreaterThan(0);
    expect(markersResolve(result)).toBe(true);
    expect(result.coherence).toEqual([]);
  }, 60_000);

  it('writes no marker into a refusal for a question nobody wrote the answer to', async () => {
    const result = await answerQuestion('What is the vacation policy?');

    // The model was genuinely asked. Without this the test would pass on a question the
    // distance check turned away, proving nothing about what the instruction does to a
    // reply that has no claims to mark.
    expect(result.timings.generationMs).toBeGreaterThan(0);
    expect(result.coverage).toBe('not_documented');
    expect(citationMarkers(result.answer)).toEqual([]);
    expect(result.coherence).toEqual([]);
  }, 60_000);

  it('writes no marker into an out of scope refusal the model was actually asked for', async () => {
    /**
     * Most out of scope questions never reach a model: 25 of the 34 in the measured set
     * are turned away by distance first, and asserting "no markers" on one of those
     * asserts something about the distance check.
     *
     * This one retrieves at 0.3135, comfortably inside the floor, so the model reads the
     * documents and decides for itself. That is the case where the marker instruction
     * could leak into a reply with nothing to mark.
     */
    const result = await answerQuestion('How do I set up a Google Ads campaign for a mobile game?');

    expect(result.timings.generationMs).toBeGreaterThan(0);
    expect(isAnswered(result.coverage)).toBe(false);
    expect(citationMarkers(result.answer)).toEqual([]);
    expect(result.coherence).toEqual([]);
  }, 60_000);

  it('keeps the markers when the answer is written in another language', async () => {
    // Rule 6 tells the model to answer in the language it was asked in, and a marker is
    // not a word. An instruction that only survives in English would leave every
    // non-English reader without a single chip.
    const result = await answerQuestion('AppLovin icin maksimum dosya boyutu nedir?');

    expect(result.coverage).toBe('full');
    expect(citationMarkers(result.answer).length).toBeGreaterThan(0);
    expect(markersResolve(result)).toBe(true);
    expect(result.coherence).toEqual([]);
  }, 60_000);
});
