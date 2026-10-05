import { listTokens, mintToken, revokeToken, TOOL_NAMES, type ToolName } from '@etai/core/mcp';
import { closeDb } from '@etai/db';

/**
 * Creates, lists and revokes the tokens an MCP client uses.
 *
 * A command rather than a dashboard page. Minting a credential is something done once
 * during setup, and the value is shown once, so a terminal is the honest place for it:
 * a browser would put it in a page that can be left open, screenshotted, or restored
 * from history.
 */

function usage(): never {
  console.log(`
Manage the tokens an MCP client presents over HTTP.

  pnpm mcp:token new <name> [--scope <tool>]...   Create one and print it once
  pnpm mcp:token list                             Show what exists, without the values
  pnpm mcp:token revoke <id>                      Stop one working, from the next request

Scopes are tool names. Without --scope a token gets all of them:
  ${TOOL_NAMES.join(', ')}

  pnpm mcp:token new "read only" --scope search_corpus --scope get_document
`);
  process.exit(1);
}

async function create(argv: string[]): Promise<void> {
  const name = argv[0];
  if (!name || name.startsWith('--')) usage();

  const scopes: ToolName[] = [];
  for (let i = 1; i < argv.length; i += 1) {
    if (argv[i] === '--scope') {
      const value = argv[i + 1];
      if (!value) usage();
      scopes.push(value as ToolName);
      i += 1;
    } else {
      usage();
    }
  }

  const minted = await mintToken({
    name,
    scopes: scopes.length > 0 ? scopes : [...TOOL_NAMES],
  });

  console.log(`\nCreated "${minted.name}"`);
  console.log(`  id     ${minted.id}`);
  console.log(`  scopes ${minted.scopes.join(', ')}`);
  console.log(`\n  ${minted.token}\n`);
  console.log('That value is not stored and cannot be shown again. Copy it now.\n');
}

async function list(): Promise<void> {
  const rows = await listTokens();

  if (rows.length === 0) {
    console.log('\nNo tokens. Create one with: pnpm mcp:token new <name>\n');
    return;
  }

  console.log('');
  for (const row of rows) {
    const state = row.revokedAt ? 'revoked' : 'active';
    /**
     * The count as well as the time. When a token leaks, the thing that changes is how
     * much it is used, and a last-used timestamp says only that it is live. This was
     * recorded and not printed for a while, which is the same failure as recording a
     * question nobody reads.
     */
    const used = row.lastUsedAt
      ? `${row.lastUsedAt.toISOString().slice(0, 16)}, ${row.useCount} calls`
      : 'never used';

    console.log(`  ${state.padEnd(8)} ${row.name.padEnd(24)} ${used.padEnd(30)} ${row.id}`);
    console.log(`  ${' '.repeat(8)} ${row.scopes.join(', ')}`);
  }
  console.log('');
}

async function revoke(argv: string[]): Promise<void> {
  const id = argv[0];
  if (!id) usage();

  const done = await revokeToken(id);
  console.log(done ? `\nRevoked ${id}\n` : `\nNo active token with id ${id}\n`);
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);

  if (command === 'new') await create(rest);
  else if (command === 'list') await list();
  else if (command === 'revoke') await revoke(rest);
  else usage();

  await closeDb();
}

main().catch(async (error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  await closeDb();
  process.exit(1);
});
