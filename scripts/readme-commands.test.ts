import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The setup the README promises, checked against the repository it describes.
 *
 * A clean clone rehearsal found the README's third step failing with a module resolution
 * stack trace. Every command line tool here imports the workspace packages by their built
 * output, and nothing in the setup built them, so `pnpm check:env` could not load far
 * enough to do the one job it has, which is turning a broken setup into a readable error.
 * Steps five through eight would have failed the same way.
 *
 * Nothing caught it. The scripts all existed, the code was right, the tests passed, and
 * the only way to see it was to start from an empty directory and do what the file says.
 *
 * These two checks are what remains testable without cloning anything: that the commands
 * named in the README exist, and that the build comes before the first command that needs
 * it. Neither replaces the rehearsal. Both would have failed on the state that shipped.
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const README = readFileSync(join(ROOT, 'README.md'), 'utf8');
const SCRIPTS: Record<string, string> = JSON.parse(
  readFileSync(join(ROOT, 'package.json'), 'utf8'),
).scripts;

/** Run by pnpm itself rather than defined by this project. */
const BUILT_IN = new Set(['install', 'exec', 'dlx', 'add', 'run', 'why']);

/**
 * Only the shell blocks. The prose says "pnpm workspaces" as the name of a feature, and a
 * scan that cannot tell a command from a sentence about one reports that as a missing
 * script. The first run of this test did exactly that.
 */
const COMMAND_BLOCKS = [...README.matchAll(/```bash\n([\s\S]*?)```/g)]
  .map((match) => match[1])
  .join('\n');

describe('the setup the README describes', () => {
  it('names only commands this repository actually has', () => {
    const named = [...COMMAND_BLOCKS.matchAll(/\bpnpm ([a-z][a-z0-9:.-]*)/g)].map(
      (match) => match[1],
    );

    // The whole setup is nine commands, so anything much below this means the blocks
    // stopped being found rather than that the README got shorter.
    expect(named.length, 'no pnpm commands found in the README').toBeGreaterThan(7);

    const missing = [...new Set(named)].filter((name) => !BUILT_IN.has(name) && !(name in SCRIPTS));

    expect(missing, `README names commands that do not exist: ${missing.join(', ')}`).toEqual([]);
  });

  it('builds the packages before the first command that imports them', () => {
    /**
     * Order matters here, not presence. The build line existing further down the file
     * would satisfy a `toContain` and still leave a reader stranded at step four.
     *
     * Scoped to the setup block rather than the whole file, because the prose mentions
     * `pnpm ingest --write` while explaining what is deliberately not built, and that
     * sentence sits above the setup. Read whole-file, this failed on a README that was
     * correct.
     */
    const setup = README.slice(README.indexOf('## Setup'), README.indexOf('## Demo accounts'));

    const build = setup.indexOf('pnpm build:packages');
    const check = setup.indexOf('pnpm check:env');
    const migrate = setup.indexOf('pnpm db:migrate');
    const ingest = setup.indexOf('pnpm ingest');

    for (const [name, at] of Object.entries({ build, check, migrate, ingest })) {
      expect(at, `the setup block never runs ${name}`).toBeGreaterThan(-1);
    }

    expect(build).toBeLessThan(check);
    expect(build).toBeLessThan(migrate);
    expect(build).toBeLessThan(ingest);
  });

  it('keeps the numbered steps in order, since a reader follows them by number', () => {
    // Inserting a step is where numbering goes wrong, and it went wrong once already.
    const setup = README.slice(
      README.indexOf('## Setup'),
      README.indexOf('`pnpm check:env` prints'),
    );
    const numbers = [...setup.matchAll(/^# (\d+)\. /gm)].map((match) => Number(match[1]));

    expect(numbers.length, 'no numbered setup steps found').toBeGreaterThan(5);
    expect(numbers).toEqual(numbers.map((_, index) => index + 1));
  });
});
