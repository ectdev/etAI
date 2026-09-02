import { describe, expect, it } from 'vitest';
import { answerForRole, searchForRole } from './visibility';

/**
 * What each role receives, asserted on the payload rather than on the interface.
 *
 * This rule was only covered by a test that needs a database, a key and a live search.
 * That is the wrong place for it to live alone: it is the security boundary of this
 * application, it is one function, and it should fail in fifteen seconds on a laptop with
 * no credentials rather than four minutes into a suite that costs money.
 *
 * The assertions are on absence, and on the serialised body rather than on the object,
 * because that is what actually leaves the server. Checking `result.distance` is undefined
 * would pass for a key that is present and explicitly undefined, which serialises away in
 * JSON but is still there in a structured log.
 */

const chunk = {
  documentId: 'doc-1',
  path: 'network-specs-applovin.md',
  title: 'AppLovin network specification',
  headingPath: null,
  docType: 'reference',
  temporalDate: null,
  isDeprecated: false,
  supersededByPath: null,
  distance: 0.2466,
  score: 0.0312,
  chunkId: 'chunk-1',
  content: 'Maximum file size: 5 MB.',
};

const searchResult = (degraded: boolean) => ({
  chunks: [chunk],
  nearestDistance: 0.2466,
  timings: { embedMs: 120, searchMs: 8 },
  degraded,
});

const answer = (degraded: boolean) => ({
  answer: 'The limit is 5 MB [1].',
  coverage: 'full' as const,
  gap: null,
  citations: [
    {
      sourceNumber: 1,
      documentId: 'doc-1',
      documentPath: 'network-specs-applovin.md',
      title: 'AppLovin network specification',
      quote: 'Maximum file size: 5 MB.',
    },
  ],
  sources: [chunk],
  droppedCitations: [],
  coherence: [],
  timings: { retrievalMs: 128, generationMs: 3400 },
  model: 'gemini-3.6-flash',
  ...(degraded ? { degraded: true } : {}),
});

describe('what a regular user is sent', () => {
  it('has no retrieval scores or timings anywhere in the body', () => {
    const body = JSON.stringify(searchForRole(searchResult(false), false));

    for (const field of ['distance', 'score', 'timings', 'nearestDistance', 'embedMs']) {
      expect(body, `a regular user was sent ${field}`).not.toContain(field);
    }
  });

  it('has no scores or model name in an answer either', () => {
    const body = JSON.stringify(answerForRole(answer(false), false));

    for (const field of ['distance', 'score', 'timings', 'model', 'droppedCitations']) {
      expect(body, `a regular user was sent ${field}`).not.toContain(field);
    }
  });

  it('still gets everything needed to recognise and open a document', () => {
    // The premise. A function that returned nothing would pass every assertion above.
    const body = JSON.stringify(searchForRole(searchResult(false), false));

    for (const field of ['path', 'title', 'docType', 'isDeprecated', 'content']) {
      expect(body, `a regular user was not sent ${field}`).toContain(field);
    }
  });
});

describe('what an administrator is sent', () => {
  it('carries the numbers, so the cut above is a cut rather than a deletion', () => {
    const body = JSON.stringify(searchForRole(searchResult(false), true));

    for (const field of ['distance', 'score', 'nearestDistance', 'embedMs']) {
      expect(body, `an admin was not sent ${field}`).toContain(field);
    }
  });
});

describe('the degraded flag', () => {
  /**
   * The one field in this file that goes to everybody, and the reason it is worth a test
   * is that it sits in a module whose whole job is withholding things. The obvious mistake
   * is to add it to the admin block by habit, and the symptom would be a regular user
   * reading a keyword-only answer with nothing to say so.
   */
  it('reaches a regular user, not only an administrator', () => {
    expect(searchForRole(searchResult(true), false).degraded).toBe(true);
    expect(searchForRole(searchResult(true), true).degraded).toBe(true);
    expect(answerForRole(answer(true), false).degraded).toBe(true);
    expect(answerForRole(answer(true), true).degraded).toBe(true);
  });

  it('is absent rather than false when the search was normal', () => {
    // An ordinary answer should not grow a field, and `degraded: false` in a payload
    // invites an interface to render something for it.
    expect(JSON.stringify(searchForRole(searchResult(false), false))).not.toContain('degraded');
    expect(JSON.stringify(answerForRole(answer(false), true))).not.toContain('degraded');
  });
});
