import { InMemoryTransport } from '@modelcontextprotocol/server';
import { afterAll, describe, expect, it } from 'vitest';
import { closeDb, getDb, searchQuery } from '@etai/db';
import { eq } from 'drizzle-orm';
import { answerTool, createMcpServer, documentTool, searchTool, TOOL_NAMES } from './tools.js';

/**
 * The tools an MCP client can call.
 *
 * Two things here fail without saying anything. A client is configured against tool
 * names, so renaming one breaks a config file rather than a build. And `get_document`
 * is the only place in the system where an outside caller hands over a string that
 * names something to read, which is the shape of a path traversal whether or not this
 * one is vulnerable to it.
 *
 * Requires the corpus to have been indexed: pnpm ingest --write
 */
afterAll(async () => {
  await closeDb();
});

describe('reading a document by path', () => {
  it('returns the document a citation names', async () => {
    const result = await documentTool({ path: 'network-specs-applovin.md' });

    expect(result.found).toBe(true);
    expect(result.found && result.content).toMatch(/5 MB/);
  });

  it('treats a traversal attempt as a path that matches nothing', async () => {
    /**
     * The point is not that these are rejected, it is that they were never a path.
     *
     * The lookup compares the string to a database column, so nothing here reaches a
     * filesystem and there is no sanitiser to forget. If this function ever grew a
     * `readFile`, these would stop returning "not found" and start returning something,
     * which is what the test is watching for.
     */
    for (const path of [
      '../../etc/passwd',
      '../.env',
      '/etc/passwd',
      'corpus/../../../.env',
      'network-specs-applovin.md/../../../../etc/hosts',
    ]) {
      const result = await documentTool({ path });
      expect(result.found).toBe(false);
    }
  });

  it('does not return a document that was removed from the corpus', async () => {
    // Removed documents keep their row so the ingestion history still reads. A caller
    // asking for a document by path wants one that is still in the collection.
    const result = await documentTool({ path: 'a-file-that-was-never-here.md' });

    expect(result.found).toBe(false);
  });
});

describe('searching through the tool', () => {
  it('returns passages with the metadata that says whether a document is current', async () => {
    const result = await searchTool({
      query: 'maximum file size for an AppLovin playable',
      limit: 3,
    });

    expect(result.results).toHaveLength(3);
    expect(result.results[0]?.path).toBe('network-specs-applovin.md');
    // Without these an MCP client cannot tell a retired document from a current one, and
    // this collection contains both on purpose.
    expect(result.results[0]).toHaveProperty('isDeprecated');
    expect(result.results[0]).toHaveProperty('supersededByPath');
  });
});

describe('answering through the tool', () => {
  it('records the question, so the dashboard counts what an agent asked', async () => {
    /**
     * The runtime half of the check in `analytics/record.test.ts`, which can only assert
     * that the call is written. This asserts it happens.
     *
     * The gap it closes: the dashboard is headed "what people are asking" and counted
     * `/api/ask` alone, so every question asked by an agent was missing and the refusal
     * totals were short by the same number. Nothing failed. The page showed a smaller,
     * tidier version of the truth.
     */
    const question = `mcp tool test ${Date.now()}, what is the maximum AppLovin file size?`;

    const result = await answerTool({ question });
    expect(result.coverage).toBeTruthy();

    const [row] = await getDb()
      .select()
      .from(searchQuery)
      .where(eq(searchQuery.query, question))
      .limit(1);

    try {
      expect(row, 'the MCP answer was not recorded').toBeDefined();
      expect(row?.source).toBe('mcp');
      expect(row?.coverage).toBe(result.coverage);
    } finally {
      await getDb().delete(searchQuery).where(eq(searchQuery.query, question));
    }
  }, 60_000);
});

describe('what the server actually exposes', () => {
  it('registers exactly the tools a client is configured against', async () => {
    /**
     * Asked over the protocol rather than read off the object, because the registration
     * call is where a mistake would sit: the v2 API accepts both a Zod object and a raw
     * shape for `inputSchema`, and only one of them is current. Going through
     * `tools/list` is the same path a real client takes.
     */
    const server = createMcpServer();
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();

    await server.server.connect(serverSide);
    await clientSide.start();

    const listed = new Promise<string[]>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no tools/list response')), 5000);
      clientSide.onmessage = (message) => {
        const response = message as { id?: number; result?: { tools?: { name: string }[] } };
        if (response.id !== 1) return;
        clearTimeout(timer);
        resolve((response.result?.tools ?? []).map((tool) => tool.name));
      };
    });

    await clientSide.send({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });

    expect((await listed).sort()).toEqual([...TOOL_NAMES].sort());

    await clientSide.close();
    await serverSide.close();
  });
});
