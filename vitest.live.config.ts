import { defineConfig } from 'vitest/config';

/**
 * The tests that call a model provider.
 *
 * Every file here spends real credit on every run and cannot pass without a working key.
 * They are the tests that matter most, because they are the only ones that see what a
 * model actually writes rather than what a test wrote for it, and they are exactly the
 * tests a reviewer should not be forced to run in order to find out whether the project
 * works.
 *
 * Listed by name rather than by a naming convention, so adding a provider call to an
 * existing file is a decision somebody makes here rather than something that happens
 * quietly. A file that calls a provider and is missing from this list will be run by the
 * ordinary suite and fail for whoever has no key.
 */
export const LIVE_TESTS = [
  'packages/core/src/generation/answer.test.ts',
  'packages/core/src/generation/markers.test.ts',
  'packages/core/src/generation/hard-questions.test.ts',
  'packages/core/src/retrieval/search.test.ts',
  'packages/core/src/mcp/tools.test.ts',
  'packages/core/src/index.test.ts',
  'apps/web/lib/integration.test.ts',
];

export default defineConfig({
  test: {
    include: LIVE_TESTS,
    /**
     * A minute, because the ceiling is a model writing prose rather than a database
     * answering a query.
     *
     * This was twenty seconds, shared with the offline suite, and the marker instruction
     * pushed one list-shaped answer past it. What failed was the timeout rather than the
     * answer, and the error said "Test timed out" while pointing at a test about
     * timings, which is a confusing way to learn that a prompt got longer.
     */
    testTimeout: 60_000,
    fileParallelism: false,
  },
});
