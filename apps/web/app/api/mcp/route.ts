import { registerTools, verifyToken, type ToolName } from '@etai/core/mcp';
import { createMcpHandler, withMcpAuth } from 'mcp-handler';

/**
 * The MCP tools over HTTP, inside the web application.
 *
 * A second process would mean a reviewer has to start two things to see this work, and
 * there is nothing about the HTTP transport that needs its own runtime. The stdio server
 * stays separate only because a desktop client has to spawn it.
 *
 * Both surfaces register the same tools from `@etai/core/mcp`, so there is one
 * definition of what `search_corpus` does rather than one per transport.
 */

/**
 * The server is built per request, with only the tools this token may call.
 *
 * That is what makes the scope real. A token limited to search does not see
 * `answer_question` in `tools/list` and cannot call it, rather than seeing it and being
 * refused, and there is no second place where the permission has to be checked again.
 *
 * Building per request is not a cost worth avoiding: the protocol has been stateless
 * since the 2026-07-28 revision, so a request already carries everything it needs.
 */
async function serve(request: Request): Promise<Response> {
  const scopes = (request.auth?.scopes ?? []) as ToolName[];

  // `clientId` is the token's own id, set below. Threading it into the tools is what
  // makes a question asked through this transport attributable to the token it arrived
  // on, rather than appearing on the dashboard as a question from nobody.
  const caller = { tokenId: request.auth?.clientId };

  const handler = createMcpHandler((server) => registerTools(server, scopes, caller), {
    serverInfo: { name: 'etai-search', version: '0.1.0' },
  });

  return handler(request);
}

/**
 * `withMcpAuth` writes the challenge response for us.
 *
 * A 401 from an MCP server has to carry a `WWW-Authenticate` header in the shape the
 * specification describes, and hand-writing that is how a client ends up unable to tell
 * "wrong token" from "no auth configured". The check itself is ours, because the token
 * model is: a hash lookup against `mcp_token`, refusing anything revoked.
 */
const handler = withMcpAuth(
  serve,
  async (_request, bearerToken) => {
    const token = await verifyToken(bearerToken);
    if (!token) return undefined;

    return {
      token: bearerToken ?? '',
      // The token's own identity. There is no OAuth client here, and inventing one would
      // suggest a registration step that does not exist.
      clientId: token.id,
      scopes: token.scopes,
    };
  },
  { required: true },
);

export { handler as GET, handler as POST, handler as DELETE };
