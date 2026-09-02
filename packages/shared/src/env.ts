import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';
import { HNSW_MAX_DIMENSIONS, VECTOR_DIMENSIONS } from './constants.js';

let envFileLoaded = false;
let projectRoot: string | undefined;

/**
 * Finds the nearest .env by walking up from the working directory, and loads it.
 *
 * There is one .env at the repository root, but the processes that need it start in
 * different places: Next.js runs inside apps/web, scripts run from wherever they are
 * invoked. Every tool that reads a .env looks in its own working directory, so
 * without this each entry point would need to know its own depth relative to the
 * root, and one of them would eventually get it wrong.
 *
 * Values already present in the environment are left alone, so a deployment that
 * injects real variables and has no .env at all behaves correctly.
 */
function ensureEnvFileLoaded(): void {
  if (envFileLoaded) return;
  envFileLoaded = true;

  let directory = process.cwd();

  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = join(directory, '.env');

    if (existsSync(candidate)) {
      loadDotenv({ path: candidate, quiet: true });
      // The directory holding the one .env is taken to be the project root, which is
      // what relative paths in it are resolved against.
      projectRoot = directory;
      return;
    }

    const parent = dirname(directory);
    if (parent === directory) return;
    directory = parent;
  }
}

/**
 * Copying .env.example leaves variables present but empty, and an empty string is
 * not the same thing as a configured value. Treating it as absent means the error
 * message is about the setting being missing rather than about its length.
 */
const optionalSecret = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().min(1).optional(),
);

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

    BETTER_AUTH_SECRET: z
      .string()
      .min(
        32,
        'BETTER_AUTH_SECRET must be at least 32 characters, generate one with: openssl rand -base64 32',
      ),
    BETTER_AUTH_URL: z.string().min(1).default('http://localhost:3000'),

    GENERATION_PROVIDER: z.enum(['google', 'anthropic']).default('google'),
    GENERATION_MODEL: z.string().min(1).default('gemini-3.6-flash'),
    ANTHROPIC_API_KEY: optionalSecret,

    GOOGLE_GENERATIVE_AI_API_KEY: z
      .string()
      .min(
        1,
        'GOOGLE_GENERATIVE_AI_API_KEY is required because embeddings always come from Google',
      ),
    EMBEDDING_MODEL: z.string().min(1).default('gemini-embedding-2'),
    EMBEDDING_DIMENSIONS: z.coerce
      .number()
      .int()
      .positive()
      .max(
        HNSW_MAX_DIMENSIONS,
        `EMBEDDING_DIMENSIONS must be at most ${HNSW_MAX_DIMENSIONS}, otherwise pgvector cannot build an HNSW index`,
      )
      .default(VECTOR_DIMENSIONS),

    CORPUS_PATH: z.string().min(1).default('./corpus'),

    /**
     * Keeps `pnpm ingest --write` running and reindexes when the corpus changes.
     *
     * Off unless the value is exactly "true", because a process that does not exit is a
     * surprising thing for a command to do by default, and because every reindex it
     * triggers spends money at the embedding API. Anything else, including "1" and "yes",
     * leaves it off rather than guessing what was meant.
     */
    INGEST_WATCH: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),

    MCP_HTTP_PORT: z.coerce.number().int().positive().default(3001),
  })
  .superRefine((env, ctx) => {
    if (env.GENERATION_PROVIDER === 'anthropic' && !env.ANTHROPIC_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['ANTHROPIC_API_KEY'],
        message: 'ANTHROPIC_API_KEY is required when GENERATION_PROVIDER is "anthropic"',
      });
    }

    // The vector column is a fixed width, so a mismatch here would only surface
    // as an insert failure once indexing is already under way.
    if (env.EMBEDDING_DIMENSIONS !== VECTOR_DIMENSIONS) {
      ctx.addIssue({
        code: 'custom',
        path: ['EMBEDDING_DIMENSIONS'],
        message:
          `EMBEDDING_DIMENSIONS is ${env.EMBEDDING_DIMENSIONS} but the database column holds ` +
          `${VECTOR_DIMENSIONS}. Changing the width means editing the schema and generating a ` +
          'new migration, not only editing .env.',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/**
 * Reads and validates the environment once, then caches the result.
 *
 * This is deliberately strict and fails at startup rather than at the first
 * request. A missing API key that only surfaces halfway through indexing 142
 * documents is much harder to diagnose than a process that refuses to boot.
 *
 * Passing an explicit source bypasses both the file loading and the cache, which
 * is how the tests check one configuration without affecting the next.
 */
export function getEnv(source?: NodeJS.ProcessEnv): Env {
  const isProcessEnv = source === undefined;

  if (isProcessEnv && cached) return cached;
  if (isProcessEnv) ensureEnvFileLoaded();

  const result = envSchema.safeParse(source ?? process.env);

  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');

    throw new Error(
      `Environment configuration is invalid:\n${problems}\n\n` +
        'Copy .env.example to .env and fill in the missing values.',
    );
  }

  if (isProcessEnv) {
    cached = result.data;
  }

  return result.data;
}

/**
 * Turns a configured relative path into an absolute one.
 *
 * `CORPUS_PATH` defaults to `./corpus`, and the workspace commands run from different
 * directories, so resolving it against whatever the working directory happens to be
 * gives a different answer depending on which script called it. It is resolved against
 * the project root instead, which is the directory the .env was found in.
 */
export function resolveFromProjectRoot(path: string): string {
  if (isAbsolute(path)) return path;

  // Reading the environment is what locates the root, so make sure that has happened.
  getEnv();

  return resolve(projectRoot ?? process.cwd(), path);
}
