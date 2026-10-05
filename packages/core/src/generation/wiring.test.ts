import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * That the gate is called with everything it needs to do its job.
 *
 * `verifyAnswer` takes the retrieved text as an optional third argument, and skips the
 * quote check without it. Optional is right for the unit tests, which are about which
 * citations survive and have no documents to give. It is a trap everywhere else: the call
 * still compiles, every test still passes, and the only symptom is that invented quotes
 * stop being caught, which is invisible until somebody clicks a citation and lands at the
 * top of a document.
 *
 * This is the same shape as an earlier problem in this project, where the MCP surface
 * stopped recording questions and the only sign was a dashboard heading that had quietly
 * become a lie. The fix there was also a static check on the call rather than on the
 * behaviour, because the behaviour is expensive to observe and the call is not.
 *
 * Reading the source is crude and it is the only thing that fails for the right reason
 * here. A behavioural test would need a model call and a document the model is willing to
 * misquote, which is not something to wait for.
 */

const ANSWER_SOURCE = readFileSync(new URL('./answer.ts', import.meta.url), 'utf8');

describe('the production call into the citation gate', () => {
  it('passes the retrieved text, so the quote check runs', () => {
    const call = ANSWER_SOURCE.slice(
      ANSWER_SOURCE.indexOf('verifyAnswer('),
      ANSWER_SOURCE.indexOf('const generationMs') === -1 ? undefined : ANSWER_SOURCE.length,
    );

    expect(ANSWER_SOURCE, 'answer.ts no longer calls the gate at all').toContain('verifyAnswer(');

    // The argument itself: a map from path to the text that path contributed.
    expect(call, 'the gate is called without the retrieved text').toMatch(
      /new Map<string, string>/,
    );
    expect(call).toMatch(/chunk\.content/);
  });

  it('builds that text from the same chunks the model was shown', () => {
    /**
     * The premise. Checking a quote against a different set of documents than the model
     * saw would report invented quotes for text it was never given, which is a check that
     * fails for the wrong reason on every answer.
     */
    expect(ANSWER_SOURCE).toMatch(/search\.chunks\.reduce/);
    expect(ANSWER_SOURCE).toMatch(/search\.chunks\.map\(\(chunk\) => chunk\.path\)/);
  });
});
