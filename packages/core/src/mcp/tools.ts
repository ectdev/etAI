import { McpServer } from '@modelcontextprotocol/server';
import { askSchema, documentPathSchema, searchInputSchema } from '@etai/shared';
import { recordQuestion } from '../analytics/record.js';
import { answerQuestion } from '../generation/answer.js';
import { getDocumentByPath } from '../retrieval/document.js';
import { searchChunks } from '../retrieval/search.js';

/**
 * The three things an MCP client can do with this collection.
 *
 * The handlers are plain functions taking validated input and returning plain data, so
 * they can be tested without starting a server or speaking the protocol. `registerTools`
 * is the only part that knows what MCP is, and both transports call it, which is what
 * stops the stdio server and the HTTP route from drifting into two implementations of
 * the same three tools.
 *
 * The input schemas are the ones the web API already validates against. Writing separate
 * schemas for the MCP surface would mean two definitions of what a valid query is, and
 * the second one is always the one that falls behind.
 */

/**
 * Who is on the other end, as far as the tools need to know.
 *
 * Empty for stdio, which is a local process the operating system already trusts and which
 * presents no token. Carries the token id over HTTP, which is what makes a question asked
 * with a leaked token attributable to that token afterwards.
 */
export interface McpCaller {
  tokenId?: string;
}

/** The tool names, so a test and a scope check can agree on what exists. */
export const TOOL_NAMES = ['search_corpus', 'answer_question', 'get_document'] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export interface McpServerInfo {
  name: string;
  version: string;
}

const DEFAULT_INFO: McpServerInfo = { name: 'etai-search', version: '0.1.0' };

/** Searches the collection and returns passages, without generating an answer. */
export async function searchTool(input: { query: string; limit: number; docType?: string }) {
  const result = await searchChunks(input.query, {
    limit: input.limit,
    docType: input.docType,
  });

  return {
    results: result.chunks.map((chunk) => ({
      path: chunk.path,
      title: chunk.title,
      docType: chunk.docType,
      headingPath: chunk.headingPath,
      content: chunk.content,
      temporalDate: chunk.temporalDate,
      isDeprecated: chunk.isDeprecated,
      supersededByPath: chunk.supersededByPath,
      distance: chunk.distance,
    })),
    nearestDistance: result.nearestDistance,
  };
}

/**
 * Answers a question from the collection, with citations, or explains why it cannot.
 *
 * Records the question through the same recorder the web route uses. It did not, for a
 * while, and the effect was a dashboard headed "what people are asking" that was missing
 * every question an agent had asked and reporting refusal counts that were wrong by the
 * same number. Recording is allowed to fail without failing the answer.
 */
export async function answerTool(input: { question: string }, caller: McpCaller = {}) {
  const result = await answerQuestion(input.question);

  await recordQuestion({
    source: 'mcp',
    mcpTokenId: caller.tokenId,
    question: input.question,
    result,
  });

  return {
    answer: result.answer,
    coverage: result.coverage,
    gap: result.gap,
    citations: result.citations.map((citation) => ({
      sourceNumber: citation.sourceNumber,
      documentPath: citation.documentPath,
      title: citation.title,
      quote: citation.quote,
    })),
    sources: result.sources.map((source) => source.path),
  };
}

/** Returns one document in full, by the path a citation names. */
export async function documentTool(input: { path: string }) {
  const found = await getDocumentByPath(input.path);

  if (!found) {
    return { found: false as const, path: input.path };
  }

  return {
    found: true as const,
    path: found.path,
    title: found.title,
    docType: found.docType,
    content: found.content,
    temporalDate: found.temporalDate,
    isDeprecated: found.isDeprecated,
    supersededByPath: found.supersededByPath,
  };
}

/**
 * Registers the tools on a server somebody else made.
 *
 * Two shapes are needed because the transports hand over control differently. The stdio
 * entry wants a factory that returns a server; the HTTP handler builds one and passes it
 * in to be configured. This is the half they share, so the tools are defined once and
 * neither transport can drift.
 *
 * `allowed` limits which are registered. A caller whose token does not cover a tool does
 * not see it in `tools/list` at all, rather than seeing it and being refused on use.
 * That is the more honest of the two: the list a client is shown is the list it can act
 * on, and there is no second place where a permission has to be checked and could be
 * forgotten.
 */
export function registerTools(
  server: McpServer,
  allowed: readonly ToolName[] = TOOL_NAMES,
  caller: McpCaller = {},
): McpServer {
  const permitted = new Set(allowed);

  if (permitted.has('search_corpus'))
    server.registerTool(
      'search_corpus',
      {
        title: 'Search the document collection',
        description:
          'Finds passages in the indexed collection by meaning and by keyword, and returns ' +
          'them with the metadata that says whether a document is current. Does not write ' +
          'an answer. Use answer_question when you want one.',
        inputSchema: searchInputSchema,
      },
      async (input) => {
        const output = await searchTool(input);
        return {
          content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
          structuredContent: output,
        };
      },
    );

  if (permitted.has('answer_question'))
    server.registerTool(
      'answer_question',
      {
        title: 'Answer a question from the collection',
        description:
          'Answers from the indexed documents only, with citations. Says so rather than ' +
          'guessing when the collection does not cover the question: coverage is one of ' +
          'full, partial, not_documented or out_of_scope, and the last two carry no answer.',
        inputSchema: askSchema,
      },
      async (input) => {
        const output = await answerTool(input, caller);
        return {
          content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
          structuredContent: output,
        };
      },
    );

  if (permitted.has('get_document'))
    server.registerTool(
      'get_document',
      {
        title: 'Read one document in full',
        description:
          'Returns the whole text of an indexed document, given the path that a search ' +
          'result or a citation names. Use it to read the source behind a claim.',
        inputSchema: documentPathSchema,
      },
      async (input) => {
        const output = await documentTool(input);
        return {
          content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
          structuredContent: output,
        };
      },
    );

  return server;
}

/**
 * Builds a server with the three tools registered.
 *
 * A factory rather than a shared instance, because the protocol is stateless from the
 * 2026-07-28 revision onwards and both transports create one per connection or per
 * request.
 */
export function createMcpServer(info: McpServerInfo = DEFAULT_INFO): McpServer {
  return registerTools(new McpServer(info));
}
