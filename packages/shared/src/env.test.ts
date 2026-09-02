import { describe, expect, it } from 'vitest';
import { VECTOR_DIMENSIONS, HNSW_MAX_DIMENSIONS } from './constants.js';
import { getEnv } from './env.js';

/**
 * A configuration that satisfies every rule. Each test starts from this and breaks
 * exactly one thing, so a failure points at the rule that was broken rather than at
 * whichever check happened to run first.
 */
function validEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    DATABASE_URL: 'postgresql://etai:etai@localhost:5432/etai',
    BETTER_AUTH_SECRET: 'a'.repeat(32),
    GOOGLE_GENERATIVE_AI_API_KEY: 'test-google-key',
    ...overrides,
  } as NodeJS.ProcessEnv;
}

describe('getEnv', () => {
  it('accepts a minimal configuration and applies the documented defaults', () => {
    const env = getEnv(validEnv());

    expect(env.GENERATION_PROVIDER).toBe('google');
    expect(env.GENERATION_MODEL).toBe('gemini-3.6-flash');
    expect(env.EMBEDDING_MODEL).toBe('gemini-embedding-2');
    expect(env.EMBEDDING_DIMENSIONS).toBe(VECTOR_DIMENSIONS);
    expect(env.CORPUS_PATH).toBe('./corpus');
    expect(env.NODE_ENV).toBe('development');
    expect(env.INGEST_WATCH).toBe(false);
  });

  describe('INGEST_WATCH', () => {
    it('turns on for "true" and nothing else', () => {
      expect(getEnv(validEnv({ INGEST_WATCH: 'true' })).INGEST_WATCH).toBe(true);
      expect(getEnv(validEnv({ INGEST_WATCH: 'false' })).INGEST_WATCH).toBe(false);
    });

    it('refuses a value it would have to guess about', () => {
      /**
       * "1", "yes" and "TRUE" all look like they mean on. Reading any of them as off
       * would leave somebody watching a log that never reindexes, and reading them as on
       * would make a typo start a process that does not exit. Failing at startup names
       * the variable and the two values it takes.
       */
      for (const value of ['1', 'yes', 'TRUE', 'on', '']) {
        expect(() => getEnv(validEnv({ INGEST_WATCH: value })), `accepted ${value}`).toThrow(
          /INGEST_WATCH/,
        );
      }
    });
  });

  it('names every missing setting at once rather than stopping at the first', () => {
    let message = '';
    try {
      getEnv({} as NodeJS.ProcessEnv);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain('DATABASE_URL');
    expect(message).toContain('BETTER_AUTH_SECRET');
    expect(message).toContain('GOOGLE_GENERATIVE_AI_API_KEY');
  });

  it('rejects a signing secret that is too short to be worth having', () => {
    expect(() => getEnv(validEnv({ BETTER_AUTH_SECRET: 'short' }))).toThrow(
      /at least 32 characters/,
    );
  });

  describe('provider selection', () => {
    it('does not require an Anthropic key when generation comes from Google', () => {
      const env = getEnv(validEnv({ GENERATION_PROVIDER: 'google' }));
      expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    });

    it('requires an Anthropic key when generation is switched to Anthropic', () => {
      expect(() => getEnv(validEnv({ GENERATION_PROVIDER: 'anthropic' }))).toThrow(
        /ANTHROPIC_API_KEY is required/,
      );
    });

    it('treats an empty key as absent, since copying .env.example leaves it blank', () => {
      expect(() =>
        getEnv(validEnv({ GENERATION_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: '   ' })),
      ).toThrow(/ANTHROPIC_API_KEY is required/);
    });

    it('accepts Anthropic once a key is present', () => {
      const env = getEnv(
        validEnv({ GENERATION_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sk-test' }),
      );
      expect(env.GENERATION_PROVIDER).toBe('anthropic');
      expect(env.ANTHROPIC_API_KEY).toBe('sk-test');
    });

    it('rejects a provider that has no implementation behind it', () => {
      expect(() => getEnv(validEnv({ GENERATION_PROVIDER: 'openai' }))).toThrow();
    });
  });

  describe('embedding width', () => {
    it('refuses a width the vector index cannot be built on', () => {
      expect(() => getEnv(validEnv({ EMBEDDING_DIMENSIONS: '3072' }))).toThrow(
        new RegExp(`at most ${HNSW_MAX_DIMENSIONS}`),
      );
    });

    it('refuses a width the database column does not have, and says a migration is needed', () => {
      expect(() => getEnv(validEnv({ EMBEDDING_DIMENSIONS: '768' }))).toThrow(/migration/);
    });

    it('reads the width as a number even though the environment holds strings', () => {
      const env = getEnv(validEnv({ EMBEDDING_DIMENSIONS: String(VECTOR_DIMENSIONS) }));
      expect(env.EMBEDDING_DIMENSIONS).toBe(VECTOR_DIMENSIONS);
      expect(typeof env.EMBEDDING_DIMENSIONS).toBe('number');
    });
  });

  it('does not cache a result that came from an explicit source', () => {
    const first = getEnv(validEnv({ GENERATION_MODEL: 'model-one' }));
    const second = getEnv(validEnv({ GENERATION_MODEL: 'model-two' }));

    expect(first.GENERATION_MODEL).toBe('model-one');
    expect(second.GENERATION_MODEL).toBe('model-two');
  });
});
