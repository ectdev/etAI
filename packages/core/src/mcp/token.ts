import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { getDb, mcpToken } from '@etai/db';
import { TOOL_NAMES, type ToolName } from './tools.js';

/**
 * Minting and checking the bearer tokens an MCP client presents.
 *
 * The token is a random string with a recognisable prefix, so one that leaks into a log
 * or a screenshot can be identified as a credential rather than mistaken for an id. Only
 * its SHA-256 hash is stored, which means the value is shown once and a lost token is
 * replaced rather than recovered.
 *
 * A plain hash is the right choice here and would be the wrong one for a password. These
 * are 256 bits of randomness, so there is no dictionary to run against them and nothing
 * for a slow hash to protect. Passwords are handled by the auth library, which uses a
 * slow hash, because a password is short and chosen by a person.
 */

const PREFIX = 'etai_';

export interface MintedToken {
  /** Shown once. Never stored, never recoverable. */
  token: string;
  id: string;
  name: string;
  scopes: ToolName[];
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Creates a token, stores its hash, and returns the value for the one time it exists. */
export async function mintToken(input: {
  name: string;
  scopes: ToolName[];
  createdByUserId?: string | null;
}): Promise<MintedToken> {
  const unknown = input.scopes.filter((scope) => !TOOL_NAMES.includes(scope));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown scope: ${unknown.join(', ')}. Scopes are tool names: ${TOOL_NAMES.join(', ')}`,
    );
  }
  if (input.scopes.length === 0) {
    throw new Error('A token with no scopes can call nothing. Give it at least one tool name.');
  }

  const token = PREFIX + randomBytes(32).toString('base64url');

  const [row] = await getDb()
    .insert(mcpToken)
    .values({
      name: input.name,
      tokenHash: hashToken(token),
      scopes: input.scopes,
      createdByUserId: input.createdByUserId ?? null,
    })
    .returning({ id: mcpToken.id });

  if (!row) throw new Error('Could not store the token');

  return { token, id: row.id, name: input.name, scopes: input.scopes };
}

export interface VerifiedToken {
  id: string;
  name: string;
  scopes: ToolName[];
}

/**
 * Looks a token up by its hash and returns what it may do, or null.
 *
 * The lookup is by hash rather than by a scan and compare, so the database index does
 * the work and there is no list of candidates to iterate. The constant-time comparison
 * afterwards is on the hash of what was presented against the hash that was stored,
 * which closes the timing channel that a plain string equality would leave on the last
 * comparison.
 *
 * A revoked token fails here rather than being filtered later, so revocation takes
 * effect on the next request rather than at the next restart.
 */
export async function verifyToken(presented: string | undefined): Promise<VerifiedToken | null> {
  if (!presented || !presented.startsWith(PREFIX)) return null;

  const hash = hashToken(presented);

  const rows = await getDb()
    .select({
      id: mcpToken.id,
      name: mcpToken.name,
      scopes: mcpToken.scopes,
      tokenHash: mcpToken.tokenHash,
    })
    .from(mcpToken)
    .where(and(eq(mcpToken.tokenHash, hash), isNull(mcpToken.revokedAt)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  const presentedBytes = Buffer.from(hash, 'hex');
  const storedBytes = Buffer.from(row.tokenHash, 'hex');

  if (
    presentedBytes.length !== storedBytes.length ||
    !timingSafeEqual(presentedBytes, storedBytes)
  ) {
    return null;
  }

  /**
   * Recorded so an unused token is visible as one, and so a token being used far more
   * than whatever it was issued for is visible too. `lastUsedAt` alone says a token is
   * live and nothing about how much, and the tools that do not generate an answer leave
   * no other trace: only `answer_question` writes a row anybody can count.
   *
   * Failing to record must not fail the request. The token is valid whether or not the
   * bookkeeping worked.
   */
  void getDb()
    .update(mcpToken)
    .set({ lastUsedAt: new Date(), useCount: sql`${mcpToken.useCount} + 1` })
    .where(eq(mcpToken.id, row.id))
    .catch(() => undefined);

  return { id: row.id, name: row.name, scopes: row.scopes as ToolName[] };
}

/** Whether a verified token may call a given tool. */
export function tokenAllows(token: VerifiedToken, tool: ToolName): boolean {
  return token.scopes.includes(tool);
}

/** Marks a token as revoked. Returns whether there was one to revoke. */
export async function revokeToken(id: string): Promise<boolean> {
  const rows = await getDb()
    .update(mcpToken)
    .set({ revokedAt: new Date() })
    .where(and(eq(mcpToken.id, id), isNull(mcpToken.revokedAt)))
    .returning({ id: mcpToken.id });

  return rows.length > 0;
}

export interface TokenSummary {
  id: string;
  name: string;
  scopes: ToolName[];
  lastUsedAt: Date | null;
  useCount: number;
  revokedAt: Date | null;
  createdAt: Date;
}

/**
 * Every token, without any value that could be used as one.
 *
 * The query lives here rather than in the command that prints it, so the web app does
 * not need the ORM and there is one place that knows the shape of this table.
 */
export async function listTokens(): Promise<TokenSummary[]> {
  const rows = await getDb()
    .select({
      id: mcpToken.id,
      name: mcpToken.name,
      scopes: mcpToken.scopes,
      lastUsedAt: mcpToken.lastUsedAt,
      useCount: mcpToken.useCount,
      revokedAt: mcpToken.revokedAt,
      createdAt: mcpToken.createdAt,
    })
    .from(mcpToken)
    .orderBy(desc(mcpToken.createdAt));

  return rows.map((row) => ({ ...row, scopes: row.scopes as ToolName[] }));
}
