import { describe, expect, it } from 'vitest';
import * as core from './index.js';

/**
 * What this package offers to everything outside it.
 *
 * The list started at thirty names and two of them were used, both in `apps/web`.
 * Nothing broke because of that, which is the problem: an export nobody calls costs
 * nothing until somebody has to decide which of these capabilities becomes an MCP tool,
 * and then twenty-eight of the options are noise.
 *
 * This test is a decision rather than a check. Adding a name here is fine and takes one
 * line, but it should be a thing somebody chose to publish rather than something that
 * arrived because a file happened to export it.
 */
describe('the public surface', () => {
  it('offers search, answering, and indexing, and nothing else', () => {
    expect(Object.keys(core).sort()).toEqual([
      'answerQuestion',
      'getDocumentByPath',
      'indexStats',
      'ingestCorpus',
      'searchChunks',
    ]);
  });

  it('does not re-export the measurement harness', () => {
    // It lives at `@etai/core/eval`. Running a measurement is a thing done to the
    // system, not a thing the system does, and the two lists read very differently when
    // they are mixed together.
    expect(core).not.toHaveProperty('measureQueries');
    expect(core).not.toHaveProperty('evalQueries');
    expect(core).not.toHaveProperty('sweep');
  });
});
