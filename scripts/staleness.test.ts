import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Claims about what exists, checked against what exists.
 *
 * Three times a description outlived the thing it described. The README said the chat
 * page was planned for three commits after it shipped. It then said the dashboard was
 * planned for a day after that shipped. And the home page, the first screen anybody
 * opens, told visitors that neither was built for as long as both had been.
 *
 * Every one was found by a person reading it. None of them broke a build, a type, a lint
 * rule or a test, because none of them is wrong in a way a compiler can see: the code was
 * right and the sentence next to it was not.
 *
 * A general check for "this text is true" cannot be written. These two can:
 *
 *   a page may not say a route is missing when the route is in the repository
 *   a feature table may not say something is planned when its entry point exists
 *
 * Both are narrow, both are cheap, and both would have fired on all three.
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * A route, the file that would exist if it were built, and the words that would be a lie
 * if it were.
 */
const ROUTES = [
  { name: 'chat page', file: 'apps/web/app/chat/page.tsx', row: 'Chat page' },
  { name: 'dashboard', file: 'apps/web/app/dashboard/page.tsx', row: 'Dashboard for the' },
  { name: 'document list', file: 'apps/web/app/dashboard/documents/page.tsx', row: null },
  { name: 'MCP over HTTP', file: 'apps/web/app/api/mcp/route.ts', row: 'MCP server over' },
];

/** Phrases that claim absence. Any of these beside a route that exists is a stale claim. */
const CLAIMS_ABSENCE = [
  'not built yet',
  'are not built',
  'is not built',
  'coming soon',
  'not implemented yet',
];

describe('what the interface says about itself', () => {
  it('has no page claiming a feature is missing while its route exists', () => {
    /**
     * Scoped to the pages a signed-out or signed-in visitor reads, rather than to the
     * whole repository, because a test file or a plan may legitimately describe something
     * as unbuilt. The subject is what a person is shown.
     */
    const built = ROUTES.filter((route) => existsSync(join(ROOT, route.file)));
    expect(built.length, 'no routes found, so this test is checking nothing').toBeGreaterThan(0);

    const pages: string[] = [];
    const walk = (directory: string) => {
      for (const entry of readdirSync(directory)) {
        const full = join(directory, entry);
        if (statSync(full).isDirectory()) {
          if (entry !== 'node_modules' && entry !== '.next') walk(full);
        } else if (extname(entry) === '.tsx') {
          pages.push(full);
        }
      }
    };
    walk(join(ROOT, 'apps/web/app'));
    walk(join(ROOT, 'apps/web/components'));

    const offences: string[] = [];

    for (const page of pages) {
      const text = readFileSync(page, 'utf8');
      for (const claim of CLAIMS_ABSENCE) {
        if (text.toLowerCase().includes(claim)) {
          offences.push(`${relative(ROOT, page)} says "${claim}"`);
        }
      }
    }

    expect(offences, offences.join('\n')).toEqual([]);
  });

  it('has no feature row marked planned while the feature is in the repository', () => {
    const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
    const offences: string[] = [];

    for (const route of ROUTES) {
      if (!route.row) continue;
      if (!existsSync(join(ROOT, route.file))) continue;

      for (const line of readme.split('\n')) {
        if (line.includes(route.row) && line.includes('planned')) {
          offences.push(`README calls the ${route.name} planned, and ${route.file} exists`);
        }
      }
    }

    expect(offences, offences.join('\n')).toEqual([]);
  });

  it('styles every screen with the design system rather than what came before it', () => {
    /**
     * The other half of the same failure. The signed-out pages kept a token set from
     * before the design landed, so they rendered light and plain while everything behind
     * sign-in rendered dark and designed. Nothing failed: both sets of class names are
     * valid, and only opening the page shows it.
     */
    const retired = ['text-ink-muted', 'bg-surface-muted', 'border-line', 'bg-ink', 'text-surface'];

    const offences: string[] = [];
    const walk = (directory: string) => {
      for (const entry of readdirSync(directory)) {
        const full = join(directory, entry);
        if (statSync(full).isDirectory()) {
          if (entry !== 'node_modules' && entry !== '.next') walk(full);
        } else if (['.tsx', '.ts'].includes(extname(entry))) {
          const text = readFileSync(full, 'utf8');
          for (const token of retired) {
            if (text.includes(token)) offences.push(`${relative(ROOT, full)} uses ${token}`);
          }
        }
      }
    };

    walk(join(ROOT, 'apps/web/app'));
    walk(join(ROOT, 'apps/web/components'));

    expect(offences, offences.join('\n')).toEqual([]);
  });
});
