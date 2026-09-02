import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The stdio server, started the way a client starts it.
 *
 * This spawns the compiled entry as a subprocess and speaks JSON-RPC over the pipe,
 * because that is the only thing a desktop MCP client does and none of it is exercised
 * by importing the module. Two failures live here and neither shows up any other way.
 *
 * A client launches a file path, not a package script, so the entry has to work as
 * compiled JavaScript under plain `node`. Running it through `tsx` in a test would pass
 * while the thing named in `claude_desktop_config.json` does not exist.
 *
 * And stdout is the protocol. One `console.log` reachable from the import path turns
 * every response into a parse error on the client side, with nothing in the message
 * saying where the extra bytes came from.
 *
 * Requires a build first: pnpm build
 */

const ENTRY = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'index.js');

interface Session {
  stdout: string;
  stderr: string;
  responses: Array<Record<string, unknown>>;
}

/** Sends a few requests to a freshly spawned server and collects everything it wrote. */
async function talkToServer(requests: unknown[], env: NodeJS.ProcessEnv = {}): Promise<Session> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [ENTRY], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`server did not answer in time. stderr:\n${stderr}\nstdout:\n${stdout}`));
    }, 20_000);

    const finish = () => {
      clearTimeout(timer);
      child.kill();

      const responses = stdout
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as Record<string, unknown>);

      resolve({ stdout, stderr, responses });
    };

    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on('exit', () => {
      // An early exit is a result too: the configuration test relies on it.
      clearTimeout(timer);
      resolve({ stdout, stderr, responses: [] });
    });

    for (const request of requests) {
      child.stdin.write(`${JSON.stringify(request)}\n`);
    }

    // Long enough for an initialize and a tools/list, which touch no model and no
    // database. A tool call would need both and belongs in the core tests, which have
    // it.
    setTimeout(finish, 2500);
  });
}

const INITIALIZE = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2026-07-28',
    capabilities: {},
    clientInfo: { name: 'test-client', version: '0.0.0' },
  },
};

describe('the compiled stdio entry', () => {
  it('starts under plain node and answers the opening handshake', async () => {
    const session = await talkToServer([INITIALIZE]);

    const initialized = session.responses.find((message) => message.id === 1);
    expect(initialized, `no response. stderr:\n${session.stderr}`).toBeDefined();
    expect(initialized).toHaveProperty('result');
  }, 30_000);

  it('lists the three tools over the pipe', async () => {
    const session = await talkToServer([
      INITIALIZE,
      { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    ]);

    const listed = session.responses.find((message) => message.id === 2);
    const tools = (listed?.result as { tools?: { name: string }[] } | undefined)?.tools ?? [];

    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'answer_question',
      'get_document',
      'search_corpus',
    ]);
  }, 30_000);

  it('writes nothing to stdout that is not a protocol message', async () => {
    /**
     * The failure this exists for. The server prints a readiness line and any error it
     * hits, and both go to stderr. If one of them ever went to stdout, or a dependency
     * logged something on import, every line here would stop parsing as JSON and a
     * client would report a protocol error pointing at nothing in particular.
     */
    const session = await talkToServer([
      INITIALIZE,
      { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    ]);

    for (const line of session.stdout.split('\n').filter((l) => l.trim().length > 0)) {
      expect(() => JSON.parse(line)).not.toThrow();
      expect(JSON.parse(line)).toHaveProperty('jsonrpc', '2.0');
    }

    // And the diagnostics really are being written, just to the other stream.
    expect(session.stderr).toContain('ready on stdio');
  }, 30_000);

  it('explains an incomplete configuration instead of failing silently', async () => {
    // A client shows a connection failure and its log, so the log has to name what is
    // missing. An empty DATABASE_URL fails the environment check.
    const session = await talkToServer([INITIALIZE], { DATABASE_URL: '' });

    expect(session.stderr).toContain('configuration is incomplete');
    expect(session.stderr).toContain('check:env');
    expect(session.stdout).toBe('');
  }, 30_000);
});
