import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Every corpus document the source names, checked against the corpus.
 *
 * A test that asserts on a document which does not exist fails for a reason that has
 * nothing to do with what it was written to check, and it fails only when somebody runs
 * the suite that needs a key. Two did. `search.test.ts` searched for a release note in a
 * series that stops eight versions earlier, and the MCP tool test read a file expecting a
 * limit the file states in different units. Both were left behind by renaming one corpus
 * into another, and both looked entirely plausible in a diff.
 *
 * The scan is narrow on purpose. It only looks at paths under a directory that exists in
 * the corpus, because a bare fixture name in a unit test is a fixture and always will be,
 * while a path under one of those directories is a claim about this collection.
 *
 * Comments come out before the scan runs. The first version of this file failed on its own
 * docblock, which named an example path to explain the rule, and a scan that cannot tell
 * code from the prose about the code is a scan somebody turns off.
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CORPUS = join(ROOT, 'corpus');

const SKIP_DIRECTORIES = new Set(['node_modules', '.git', '.next', 'dist', 'coverage', 'corpus']);
const SCANNED = new Set(['.ts', '.tsx', '.sh']);

/**
 * Paths that are meant not to exist, with the reason.
 *
 * Listed rather than pattern matched, so adding one is a decision somebody makes here
 * rather than a hole that opens quietly. Every entry is a pure function being fed a
 * shape, not a document being read.
 */
const SYNTHETIC: Record<string, string> = {
  'changelogs/thing-1.2.3.md': 'derive() on a version number with three parts',
  'meeting-notes/2026-06-15-sync.md': 'derive() on a day in the file name',
  'meeting-notes/2026-06-15-production-sync.md': 'derive() on a day followed by more words',
  'deployment-reports/2025-05-kestrel-freight.md': 'derive() on a month with no day',
  'deployment-reports/2026-01-something.md': 'resolveProjects() with no brief to match',
  'customers/ledger.md': 'resolveProjects() where one project name contains another',
};

/** The directories the corpus actually has, read rather than listed. */
const CORPUS_DIRECTORIES = new Set(
  readdirSync(CORPUS).filter((entry) => statSync(join(CORPUS, entry)).isDirectory()),
);

function walk(directory: string, found: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);

    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRECTORIES.has(entry)) walk(full, found);
      continue;
    }

    if (SCANNED.has(extname(entry))) found.push(full);
  }

  return found;
}

/** A quoted string ending in `.md`, in any of the three quote characters. */
const QUOTED_PATH = /['"`]([A-Za-z0-9._/-]+\.md)['"`]/g;

function corpusPathsIn(text: string): string[] {
  const code = text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

  return [...code.matchAll(QUOTED_PATH)]
    .map((match) => match[1] as string)
    .filter((path) => CORPUS_DIRECTORIES.has(path.split('/')[0] ?? ''));
}

describe('corpus documents the source names', () => {
  it('all exist, apart from the ones written not to', () => {
    const offences: string[] = [];

    for (const file of walk(ROOT)) {
      for (const path of corpusPathsIn(readFileSync(file, 'utf8'))) {
        if (path in SYNTHETIC) continue;
        if (existsSync(join(CORPUS, path))) continue;

        offences.push(`${relative(ROOT, file)}: ${path}`);
      }
    }

    expect(offences, offences.join('\n')).toEqual([]);
  });

  it('finds one when there is one, so a clean result means something', () => {
    /**
     * The premise. A scan that matched nothing, or walked past every test file, would
     * report a clean repository in exactly the same words as a clean one.
     */
    const directory = [...CORPUS_DIRECTORIES][0] ?? 'changelogs';

    // Built by hand rather than written as a literal, for the reason in the docblock: a
    // real one in this file is the thing the scan exists to find.

    expect(corpusPathsIn(`await read('${directory}/does-not-exist.md')`)).toEqual([
      `${directory}/does-not-exist.md`,
    ]);
    expect(corpusPathsIn("await read('a.md')")).toEqual([]);
    expect(walk(ROOT).length).toBeGreaterThan(50);
  });

  it('lists no exception that has become real, so the list stays honest', () => {
    // An entry here that now exists is an exception nobody needs, and the next reader
    // would take it as evidence that the path is meant to be missing.
    const stale = Object.keys(SYNTHETIC).filter((path) => existsSync(join(CORPUS, path)));

    expect(stale, stale.join('\n')).toEqual([]);
  });
});
