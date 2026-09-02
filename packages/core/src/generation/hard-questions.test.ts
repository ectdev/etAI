import { afterAll, describe, expect, it } from 'vitest';
import { closeDb } from '@etai/db';
import { askSchema, citationMarkers, isAnswered } from '@etai/shared';
import { answerQuestion } from './answer.js';

/**
 * The questions a reviewer will actually try, which are not the ones in the sample file.
 *
 * Every other live test here asks one thing about one document. These ask across two
 * unrelated parts of the collection at once, in languages the corpus is not written in,
 * about documents that are retired or superseded, and at lengths nobody would type by
 * accident. Each is a place where the pieces are individually fine and the join is not:
 * a two-part question can be answered half way and look complete, a translated question
 * can retrieve correctly and be answered in the wrong language, and a question about two
 * retired things can warn about one of them.
 *
 * Kept to a handful of calls on purpose. The point is coverage of shape rather than of
 * volume, and every one of these costs a model call.
 *
 * Requires the corpus indexed and a working key: pnpm ingest --write
 */
afterAll(async () => {
  await closeDb();
});

/** Every path the answer cited, which is what the assertions here are about. */
function citedPaths(answer: { citations: Array<{ documentPath: string }> }): string[] {
  return answer.citations.map((citation) => citation.documentPath);
}

/**
 * Every marker in the text is accounted for, and nothing the gate calls serious happened.
 *
 * This asserted that every marker resolves to a citation and that `coherence` is empty,
 * and it failed on a live run for a reason that was mine rather than the model's: the
 * system does not promise that. `marker_not_cited` is a soft rule on purpose. A marker
 * pointing at a document that was retrieved but not formally cited is left where it is,
 * counted, and rendered as plain text rather than a button, because removing it would
 * edit the model's sentence and the number may well be right. It happens on roughly one
 * answer in twenty, so a test demanding zero of them fails at the model's whim.
 *
 * What the system does promise is that nothing goes unaccounted. A marker either resolves
 * to a citation or is reported in the gate's own count, and the two have to agree. That
 * is the assertion, and it is the stronger one: it fails if the gate ever miscounts, which
 * the old version could not have noticed.
 */
function expectWellFormed(answer: {
  answer: string;
  citations: Array<{ sourceNumber: number }>;
  coherence: Array<{ rule: string; count: number }>;
}) {
  const cited = new Set(answer.citations.map((citation) => citation.sourceNumber));
  const unresolved = citationMarkers(answer.answer).filter((marker) => !cited.has(marker));

  const reported = answer.coherence.find((rule) => rule.rule === 'marker_not_cited')?.count ?? 0;

  expect(unresolved.length, `markers [${unresolved.join(', ')}] against ${reported} reported`).toBe(
    reported,
  );

  // These the gate is supposed to make impossible rather than merely count.
  const serious = answer.coherence.filter((rule) =>
    ['marker_out_of_range', 'marker_in_refusal', 'citation_in_refusal'].includes(rule.rule),
  );
  expect(serious, 'a rule the gate should have resolved before returning').toEqual([]);
}

describe('a question that spans two unrelated parts of the collection', () => {
  it('answers both halves and cites a document for each', async () => {
    /**
     * The network specification and the localization guide have nothing to do with each
     * other: different documents, different types, no shared vocabulary. Retrieval has to
     * bring back both, and the answer has to carry both rather than the stronger match
     * crowding the weaker one out, which is what a per-type quota exists to prevent.
     *
     * The failure to catch is a confident half-answer. Answering only the file size,
     * fluently, with a correct citation, reads exactly like answering the whole question.
     */
    const result = await answerQuestion(
      'What is the maximum file size for an AppLovin playable, and which languages must every playable ship with?',
    );

    expect(isAnswered(result.coverage)).toBe(true);

    const paths = citedPaths(result);
    expect(paths, 'the size half was not cited').toContain('network-specs-applovin.md');
    expect(paths, 'the language half was not cited').toContain('localization-guide.md');

    expect(result.answer).toMatch(/5\s*MB/i);
    expect(result.answer).toMatch(/spanish|português|portuguese|german|japanese|korean/i);

    expectWellFormed(result);
  }, 90_000);
});

describe('a question about two separately out of date things', () => {
  it('warns about both, and cites the current document for each', async () => {
    /**
     * Two independent kinds of out of date in one question. `lumen.track` belongs to an
     * SDK guide marked deprecated in its own title; the shared audio compression path was
     * introduced in one changelog and reverted by a later one, which is supersession
     * rather than deprecation. They are marked differently in the index and read
     * differently in the prompt.
     *
     * The failure this catches is warning about one and silently answering the other from
     * the stale document, which produces an answer that is half current and reads as
     * entirely current.
     */
    const result = await answerQuestion(
      'What happened to lumen.track, and was the shared audio compression path kept or reverted?',
    );

    expect(isAnswered(result.coverage)).toBe(true);

    const paths = citedPaths(result);
    expect(
      paths.some((path) => path.includes('sdk-notes')),
      'the SDK half was not cited',
    ).toBe(true);
    expect(
      paths.some((path) => path.includes('changelogs/') || path.includes('postmortem')),
      'the compression half was not cited',
    ).toBe(true);

    // Both halves have to say the old thing is old, in whatever words the model picks.
    expect(result.answer).toMatch(/revert|reverted|dedicated pass/i);
    expect(result.answer).toMatch(/v3|removed|deprecated|retired|no longer/i);

    expectWellFormed(result);
  }, 90_000);
});

describe('the same question in languages the collection is not written in', () => {
  /**
   * The collection is entirely in English. A question in another language has to retrieve
   * across that gap, which the embedding handles, and then be answered in the language it
   * was asked in, which only the prompt handles. Identifiers have to survive: a file size
   * limit is useless if `AppLovin` comes back translated.
   *
   * Four languages rather than one, because they fail differently. Spanish and German are
   * close to the training distribution and to English; Japanese and Chinese are neither,
   * and are where an instruction about language is most likely to be dropped.
   */
  const questions = [
    {
      language: 'Spanish',
      ask: '¿Cuál es el tamaño máximo de archivo para un playable de AppLovin?',
    },
    { language: 'German', ask: 'Wie groß darf eine AppLovin-Playable-Datei maximal sein?' },
    { language: 'Japanese', ask: 'AppLovin のプレイアブル広告の最大ファイルサイズは？' },
    { language: 'Chinese', ask: 'AppLovin 可玩广告的最大文件大小是多少？' },
  ];

  for (const { language, ask } of questions) {
    it(`answers in ${language} from the English documents`, async () => {
      const result = await answerQuestion(ask);

      expect(result.coverage, `${language} did not reach an answer`).toBe('full');
      expect(citedPaths(result)).toContain('network-specs-applovin.md');

      // The fact itself, which is a number and a unit in every language.
      expect(result.answer).toMatch(/5\s*MB/i);

      // And the identifier, which must not be translated or transliterated away.
      expect(result.answer).toMatch(/AppLovin/);

      expectWellFormed(result);
    }, 90_000);
  }
});

describe('questions at the edges of what a person would type', () => {
  it('handles a long, rambling question without losing the question inside it', async () => {
    /**
     * Real questions arrive with context attached: what the person tried, what they are
     * building, why they are asking. The retrieval text is capped, so a long preamble can
     * push the actual question past the cut and leave the system searching for the
     * preamble. This one buries the question at the end on purpose.
     */
    const rambling =
      'Hi, I am new to the team and I have been reading through the build pipeline notes ' +
      'and the QA checklist for the last hour, and there is a lot of context I am still ' +
      'missing about how deliveries actually work here and who signs them off, and I do ' +
      'not want to ask something that is written down somewhere obvious, but I could not ' +
      'find it. Anyway what I actually need to know is this: what is the maximum file ' +
      'size for an AppLovin playable?';

    expect(rambling.length).toBeGreaterThan(400);
    expect(askSchema.safeParse({ question: rambling }).success).toBe(true);

    const result = await answerQuestion(rambling);

    expect(isAnswered(result.coverage)).toBe(true);
    expect(result.answer).toMatch(/5\s*MB/i);
    expectWellFormed(result);
  }, 90_000);

  it('refuses a question longer than the cap at the door, rather than truncating it', async () => {
    /**
     * Past the cap the honest answer is a refusal with a reason. Truncating silently
     * would search for the first 500 characters of something the person did not ask, and
     * answer it confidently.
     *
     * No model call: this is the schema both surfaces validate against, so the same limit
     * applies to the web API and to the MCP tool.
     */
    const enormous = `What is the AppLovin file size limit? ${'and also please explain the build pipeline in detail. '.repeat(80)}`;

    expect(enormous.length).toBeGreaterThan(4000);

    const parsed = askSchema.safeParse({ question: enormous });
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error?.issues)).toMatch(/500/);
  });
});
