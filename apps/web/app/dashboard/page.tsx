import { indexHealth, questionStats, recentQueries, recentRuns } from '@etai/core/dashboard';
import { AppShell } from '@/components/app-shell';
import { DashboardOverview, type Panel } from '@/components/dashboard/overview';
import { analyticsRecordingFailures } from '@etai/core/analytics';
import { requireRoleForPage } from '@/lib/session';

export const metadata = { title: 'Dashboard' };

/** Read every request. A dashboard showing a cached count of today's questions is wrong. */
export const dynamic = 'force-dynamic';

/**
 * Turns a rejected query into a panel that can render.
 *
 * The alternative is one failed query taking the page down, which would report a database
 * hiccup as "the dashboard is broken" and hide the three panels that still have something
 * true to show. The reason is logged rather than shown: it is a database error, and the
 * reader is not the person who can act on it.
 */
function panel<T>(result: PromiseSettledResult<T>, name: string): Panel<T> {
  if (result.status === 'fulfilled') return { ok: true, data: result.value };

  console.error(
    `Dashboard could not read ${name}:`,
    result.reason instanceof Error ? result.reason.message : result.reason,
  );

  return { ok: false, reason: name };
}

/**
 * The dashboard.
 *
 * The middleware keeps signed-out visitors away from this path, but the check that
 * decides whether this page renders is the one below. Middleware only sees a cookie, so
 * it cannot tell an admin from an ordinary user, and everything on this page is
 * diagnostic: what is indexed, what ingestion did, and what people have asked.
 */
export default async function DashboardPage() {
  const session = await requireRoleForPage(['admin'], '/dashboard');

  // In parallel, and settled rather than awaited together, so a slow or failing query
  // costs its own panel instead of all four.
  const [health, runs, stats, queries] = await Promise.allSettled([
    indexHealth(),
    recentRuns(5),
    questionStats(analyticsRecordingFailures()),
    recentQueries(6),
  ]);

  return (
    <AppShell
      title="Dashboard, overview"
      user={{ email: session.user.email, role: session.user.role ?? 'admin' }}
      showDashboard
    >
      <DashboardOverview
        health={panel(health, 'index health')}
        runs={panel(runs, 'ingestion runs')}
        stats={panel(stats, 'question statistics')}
        queries={panel(queries, 'recent questions')}
        now={Date.now()}
      />
    </AppShell>
  );
}
