/**
 * The MCP surface, behind its own entry point.
 *
 * Separate from the package's main entry for the same reason the measurement harness is:
 * the main entry says what the system does with documents, and this says how one
 * particular protocol reaches those capabilities. Both transports import from here.
 */

export {
  createMcpServer,
  registerTools,
  searchTool,
  answerTool,
  documentTool,
  TOOL_NAMES,
  type McpServerInfo,
  type ToolName,
} from './tools.js';

export {
  mintToken,
  verifyToken,
  tokenAllows,
  revokeToken,
  listTokens,
  hashToken,
  type MintedToken,
  type VerifiedToken,
  type TokenSummary,
} from './token.js';
