import { spawn, type ChildProcess } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * The switch, tested by running the command rather than by reading the flag.
 *
 * Everything else about watch mode is unit tested. What those tests cannot show is the
 * behaviour that matters most to somebody using this: `pnpm ingest --write` has always
 * been a command that finishes, and watch mode makes it a command that does not. Getting
 * that backwards is a defect nobody would notice until a script hung in CI, and no
 * assertion on a boolean would catch it.
 *
 * So both directions are exercised as processes: without the variable it must exit on its
 * own, and with it, it must stay up and then leave cleanly on the signal a person sends
 * with Ctrl-C.
 *
 * Requires the database. The corpus is already indexed by the time this runs, so the run
 * it performs finds nothing changed and reaches no embedding API.
 */

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ENTRY = join(PACKAGE_ROOT, 'src', 'ingestion', 'cli.ts');

let child: ChildProcess | undefined;

afterEach(() => {
  if (child && child.exitCode === null) child.kill('SIGKILL');
  child = undefined;
});

interface Session {
  output: string;
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}

function runIngest(env: NodeJS.ProcessEnv): Session {
  const session: Session = { output: '', exited: Promise.resolve({ code: null, signal: null }) };

  child = spawn('npx', ['tsx', ENTRY, '--write'], {
    cwd: PACKAGE_ROOT,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  for (const stream of [child.stdout, child.stderr]) {
    stream?.on('data', (chunk: Buffer) => {
      session.output += chunk.toString();
    });
  }

  const spawned = child;
  session.exited = new Promise((resolve) => {
    spawned.on('exit', (code, signal) => resolve({ code, signal }));
  });

  return session;
}

async function until(condition: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  return condition();
}

describe('INGEST_WATCH', () => {
  it('is off by default, and the command finishes as it always has', async () => {
    // Unset rather than "false", because the default is what a reviewer following the
    // README gets, and their .env will not mention this variable at all.
    const env = { ...process.env };
    delete env.INGEST_WATCH;

    const session = runIngest(env);
    const { code } = await session.exited;

    expect(code, `the command did not exit:\n${session.output}`).toBe(0);
    expect(session.output).not.toContain('Watching');
  }, 30_000);

  it('keeps running when it is on, and stops on the signal Ctrl-C sends', async () => {
    const session = runIngest({ INGEST_WATCH: 'true' });

    const watching = await until(() => session.output.includes('Watching'), 25_000);
    expect(watching, `never started watching:\n${session.output}`).toBe(true);

    // The premise. If it exited here despite the variable, the wait above would have
    // passed on a process that printed the line on its way out.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(child?.exitCode, 'exited while it was supposed to be watching').toBe(null);

    child?.kill('SIGINT');
    const { code, signal } = await session.exited;

    // Exit code 0 rather than death by signal: the handler ran, the watcher closed and
    // the database connection was released, instead of the default handler ending the
    // process where it stood.
    expect({ code, signal }, `did not shut down cleanly:\n${session.output}`).toEqual({
      code: 0,
      signal: null,
    });
    expect(session.output).toContain('Stopping.');
  }, 120_000);
});
