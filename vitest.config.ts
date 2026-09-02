import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { LIVE_TESTS } from './vitest.live.config.js';

/**
 * The suite a reviewer runs, which asks nothing of them but a database.
 *
 * The tests that call a model provider are excluded here and run under
 * `vitest.live.config.ts` instead. They were together until the provider ran out of
 * credit mid-run and turned the whole suite red, which reads as a defect in this project
 * rather than as a missing prerequisite. Somebody cloning this repository should be able
 * to check that it works without an API key, without spending anything, and in seconds
 * rather than five minutes.
 *
 * The split is also what makes the timeout below honest. Twenty seconds is generous for
 * PostgreSQL and tight for a model that has been asked to write a numbered list, and one
 * number cannot serve both.
 */
export default defineConfig({
  resolve: {
    alias: {
      /**
       * The web app's own alias, so a test can import a route handler.
       *
       * Without it the API routes are only reachable over HTTP, which means the checks
       * on them live in a shell script and need a server running. The password endpoint
       * makes a decision the library does not make for it, and that is worth asserting in
       * the suite a reviewer runs with no server at all.
       */
      '@': fileURLToPath(new URL('./apps/web', import.meta.url)),
    },
  },
  test: {
    // Tests sit next to the code they cover, so a reader finds them without
    // hunting through a parallel directory tree.
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts', 'scripts/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**', ...LIVE_TESTS],
    // These talk to PostgreSQL, which is slower than the default allows.
    testTimeout: 20_000,

    /**
     * Test files run one after another rather than side by side.
     *
     * Several of them use the same database, and one inserts fixture rows while another
     * counts what is in the table. Run in parallel those two disagree at random, which
     * is the worst kind of failing test: it points at the assertion rather than at the
     * fact that the two files share state. This suite takes about half a minute, so
     * there is little to win by overlapping them and a repeatable result to lose.
     */
    fileParallelism: false,
  },
});
