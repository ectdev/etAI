import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createMcpServer } from '@etai/core/mcp';
import { closeDb } from '@etai/db';
import { getEnv } from '@etai/shared/env';

/**
 * The MCP server over stdio.
 *
 * stdio runs as its own process because it is the only transport a desktop MCP client
 * can start on its own: the client spawns this and talks to it over the pipe. The same
 * tools are served over HTTP from inside the web application, so nobody has to run two
 * things to see it work.
 *
 * One rule governs everything in this file. **stdout is the protocol.** Every byte
 * written there has to be a JSON-RPC message, so a stray `console.log` anywhere in the
 * import path corrupts the stream and the client reports a parse error that says nothing
 * about where it came from. Diagnostics go to stderr, which the client shows in its
 * logs, and there is a test asserting that a full session leaves nothing else on stdout.
 */

function fail(message: string): never {
  process.stderr.write(`etai-mcp: ${message}\n`);
  process.exit(1);
}

/**
 * Reads the configuration before serving anything.
 *
 * A client that spawns this process shows a connection failure, not a stack trace, so an
 * unreadable error here becomes "the server did not start" with nothing to act on. This
 * turns a missing key into a sentence naming the key.
 */
function checkConfiguration(): void {
  try {
    getEnv();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    fail(
      `configuration is incomplete, so the server did not start.\n${detail}\n` +
        `Copy .env.example to .env and fill it in, then run "pnpm check:env" to confirm.`,
    );
  }
}

function main(): void {
  checkConfiguration();

  const handle = serveStdio(() => createMcpServer(), {
    // Reporting only. Writing this to stdout would put a non-protocol line into the
    // stream that is the protocol.
    onerror: (error) => process.stderr.write(`etai-mcp: ${error.message}\n`),
  });

  const shutdown = () => {
    void handle
      .close()
      .catch(() => undefined)
      .then(() => closeDb())
      .catch(() => undefined)
      .then(() => process.exit(0));
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  process.stderr.write('etai-mcp: ready on stdio\n');
}

main();
