import { connection } from 'next/server';
import { checkHealth } from '@etai/core';
import { handler } from '@/lib/route';

/**
 * Whether this instance can serve questions. Public, for a load balancer or an uptime
 * check, so it says which state each part is in and nothing about what is indexed.
 *
 * 503 only when the database cannot be reached, because that is the one state a load
 * balancer should route around. An empty or stale index still answers, worse, and is
 * reported as `degraded` with a 200 so an instance is not pulled for needing a reindex.
 */
export const GET = handler(async () => {
  // Measured at request time, never at build time.
  await connection();
  const health = await checkHealth();

  return Response.json(health, {
    status: health.status === 'down' ? 503 : 200,
    headers: { 'cache-control': 'no-store' },
  });
});
