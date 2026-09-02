import { getEnv } from '@etai/shared/env';

/**
 * Prints the resolved configuration so that a broken .env is obvious before any
 * other command is run. Values that are secrets are never printed, only whether
 * they are present.
 */
try {
  const env = getEnv();

  const rows: Array<[string, string]> = [
    ['NODE_ENV', env.NODE_ENV],
    ['DATABASE_URL', env.DATABASE_URL.replace(/:\/\/[^@]*@/, '://***@')],
    ['BETTER_AUTH_SECRET', 'set'],
    ['BETTER_AUTH_URL', env.BETTER_AUTH_URL],
    ['GENERATION_PROVIDER', env.GENERATION_PROVIDER],
    ['GENERATION_MODEL', env.GENERATION_MODEL],
    ['ANTHROPIC_API_KEY', env.ANTHROPIC_API_KEY ? 'set' : 'not set (only needed for anthropic)'],
    ['GOOGLE_GENERATIVE_AI_API_KEY', 'set'],
    ['EMBEDDING_MODEL', env.EMBEDDING_MODEL],
    ['EMBEDDING_DIMENSIONS', String(env.EMBEDDING_DIMENSIONS)],
    ['CORPUS_PATH', env.CORPUS_PATH],
    ['INGEST_WATCH', String(env.INGEST_WATCH)],
    ['MCP_HTTP_PORT', String(env.MCP_HTTP_PORT)],
  ];

  const width = Math.max(...rows.map(([key]) => key.length));
  console.log('Environment looks valid:\n');
  for (const [key, value] of rows) {
    console.log(`  ${key.padEnd(width)}  ${value}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
