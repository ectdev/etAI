import { drizzle } from 'drizzle-orm/node-postgres';
import pg, { Pool } from 'pg';
import { getEnv } from '@etai/shared/env';

/**
 * Return `date` columns as the string they are stored as.
 *
 * The driver turns them into a JavaScript Date by default, which quietly adds a time and
 * a timezone to a value that has neither. The dates here are calendar dates taken from
 * file names, some of them known only to the month, and attaching midnight in whatever
 * zone the process happens to run in can move one across a day boundary.
 *
 * It also caused a plain bug: code that read the column as a string and called a string
 * method on it compiled, because the declared row type said string, and failed at
 * runtime because the driver had decided otherwise.
 *
 * 1082 is the type identifier PostgreSQL uses for `date`.
 */
pg.types.setTypeParser(1082, (value: string) => value);
import * as schema from './schema/index.js';

export * from './schema/index.js';
export { schema };

let pool: Pool | undefined;
let db: ReturnType<typeof createDb> | undefined;

function createDb(connection: Pool) {
  return drizzle(connection, { schema });
}

/**
 * A single pool is shared across the process. Next.js reloads modules during
 * development, so creating a pool per import would slowly exhaust the database's
 * connection limit.
 */
export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: getEnv().DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  }
  return pool;
}

export function getDb(): ReturnType<typeof createDb> {
  if (!db) {
    db = createDb(getPool());
  }
  return db;
}

export type Database = ReturnType<typeof createDb>;

/** Closes the pool so that CLI scripts can exit instead of hanging. */
export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
    db = undefined;
  }
}
