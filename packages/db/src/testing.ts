import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

/**
 * A throwaway database, migrated from empty, for tests that write.
 *
 * Ingestion soft-deletes every document it does not find in the folder it was given, so
 * a test that ingests a small fixture corpus into the development database would empty
 * the real index as a side effect. This creates a database of its own on the same
 * server, applies every migration to it exactly as `pnpm db:migrate` would, and drops it
 * afterwards. Applying the real migrations is also the test that they work from empty,
 * which nothing else checks.
 *
 * Needs a role allowed to create databases, which the Docker image and a CI service
 * container both provide.
 */
export interface ScratchDatabase {
  url: string;
  name: string;
  drop: () => Promise<void>;
}

const MIGRATIONS = fileURLToPath(new URL('../drizzle', import.meta.url));

export async function createScratchDatabase(baseUrl: string): Promise<ScratchDatabase> {
  const name = `etai_scratch_${Date.now()}_${randomBytes(4).toString('hex')}`;
  const url = new URL(baseUrl);

  const admin = new pg.Client({ connectionString: baseUrl });
  await admin.connect();
  try {
    // An identifier, not a value, so it cannot be a parameter. The name is generated
    // above from digits and hex and never contains anything a caller supplied.
    await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }

  url.pathname = `/${name}`;
  const scratchUrl = url.toString();

  const pool = new pg.Pool({ connectionString: scratchUrl, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS });
  } finally {
    await pool.end();
  }

  return {
    url: scratchUrl,
    name,
    drop: async () => {
      const client = new pg.Client({ connectionString: baseUrl });
      await client.connect();
      try {
        await client.query(
          'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
          [name],
        );
        await client.query(`DROP DATABASE IF EXISTS "${name}"`);
      } finally {
        await client.end();
      }
    },
  };
}
