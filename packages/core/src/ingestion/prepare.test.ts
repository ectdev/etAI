import { describe, expect, it } from 'vitest';
import { resolveFromProjectRoot } from '@etai/shared/env';
import { prepareCorpus, summarize, type PreparedDocument } from './prepare.js';
import { normalizeText } from './text.js';
import { resolveProjects } from './project.js';

/**
 * Runs the whole first half of ingestion over the collection that ships with the
 * repository.
 *
 * These assertions are about the real files rather than about invented ones, which is
 * the point. Every rule in the pipeline is general, so the only way to know that the
 * general rules produce the right answer here is to check the answer here.
 */
const result = await prepareCorpus(resolveFromProjectRoot('./corpus'));
const byPath = new Map(result.documents.map((document) => [document.relativePath, document]));

function get(path: string): PreparedDocument {
  const document = byPath.get(path);
  if (!document) throw new Error(`Expected the corpus to contain ${path}`);
  return document;
}

describe('the collection', () => {
  it('reads all of it', () => {
    expect(result.documents).toHaveLength(131);
  });

  it('comes out as one chunk per document', () => {
    const summary = summarize(result);

    expect(summary.chunks).toBe(131);
    expect(summary.multiChunkDocuments).toBe(0);
  });

  it('has no document anywhere near the chunk budget', () => {
    // If this changes, documents will start being split and the assertion above will
    // fail for a reason that has nothing to do with a bug.
    const largest = Math.max(...result.documents.flatMap((d) => d.chunks.map((c) => c.tokenCount)));

    expect(largest).toBeLessThan(600);
  });

  it('needs no normalisation, which was worth measuring rather than assuming', () => {
    // The files are plain ASCII with Unix line endings. Normalising is a no-op here, and
    // exists for the corpus this gets pointed at next.
    for (const document of result.documents) {
      expect(normalizeText(document.content)).toBe(document.content);
    }
  });

  it('gives every document a type from the area it is filed under', () => {
    expect(summarize(result).docTypes).toEqual([
      'account',
      'handbook',
      'incident',
      'migration',
      'platform',
      'policy',
      'reference',
      'release',
      'sync',
    ]);
  });
});

describe('dates across the collection', () => {
  it('dates the documents that carry one and leaves the rest alone', () => {
    const summary = summarize(result);

    expect(summary.withDate).toBe(102);
    expect(summary.dayPrecision).toBe(40);
    expect(summary.monthPrecision).toBe(62);
  });

  it('dates every release note from its title line', () => {
    const releases = result.documents.filter((document) => document.docType === 'release');

    expect(releases).toHaveLength(11);
    for (const release of releases) {
      expect(release.temporalSource).toBe('heading');
      expect(release.temporalPrecision).toBe('day');
    }
  });

  it('dates every sync to the day and every migration update to the month', () => {
    for (const document of result.documents) {
      if (document.docType === 'sync') expect(document.temporalPrecision).toBe('day');
      if (document.docType === 'migration') expect(document.temporalPrecision).toBe('month');
    }
  });

  it('keeps the April incident to its month, which is all its name says', () => {
    const incident = get('incidents/2026-04-cache-poisoning.md');

    expect(incident.temporalDate).toBe('2026-04-01');
    expect(incident.temporalPrecision).toBe('month');
    expect(incident.versionSeries).toBeNull();
  });
});

describe('the two agent guides', () => {
  it('marks the retired one and not the current one', () => {
    // The current guide says "It supersedes v2" three lines in. A rule that scanned for
    // words about deprecation would match on that and mark the wrong document.
    expect(get('platform/agent/drift-legacy.md').isDeprecated).toBe(true);
    expect(get('platform/agent/drift.md').isDeprecated).toBe(false);
  });

  it('marks nothing else in the collection as retired', () => {
    const deprecated = result.documents.filter((document) => document.isDeprecated);

    expect(deprecated.map((document) => document.relativePath)).toEqual([
      'platform/agent/drift-legacy.md',
    ]);
  });
});

describe('the release note series', () => {
  it('links each note to the next one and leaves the newest unlinked', () => {
    expect(get('releases/runner/5.2.md').supersededByPath).toBe('releases/runner/5.3.md');
    expect(get('releases/runner/5.3.md').supersededByPath).toBe('releases/runner/5.4.md');
    expect(get('releases/runner/5.10.md').supersededByPath).toBeNull();
  });

  it('finds one series and only the release notes in it', () => {
    const versioned = result.documents.filter((document) => document.versionSeries !== null);

    expect(versioned).toHaveLength(11);
    expect(new Set(versioned.map((document) => document.versionSeries))).toEqual(
      new Set(['releases/runner']),
    );
  });

  it('orders 5.10 after 5.9 rather than before it', () => {
    // A string comparison puts 5.10 before 5.9. The ordering is numeric per part, and
    // this series exists at these two numbers so the rule has something to be wrong about.
    expect(get('releases/runner/5.9.md').supersededByPath).toBe('releases/runner/5.10.md');
  });
});

describe('projects', () => {
  it('labels the migration updates with the account they are about', () => {
    expect(get('migrations/kestrel-freight/2025-11.md').project).toBe('kestrel-freight');
    expect(get('accounts/kestrel-freight.md').project).toBe('kestrel-freight');
  });

  it('does not invent a project for documents that are not about one', () => {
    // An earlier rule took whatever was left of the file name after the date, which
    // produced a project for every dated record that was not about an account.
    expect(get('incidents/2026-04-cache-poisoning.md').project).toBeNull();
    expect(get('policies/release-gate.md').project).toBeNull();

    const syncs = result.documents.filter((d) => d.docType === 'sync');
    for (const sync of syncs) expect(sync.project).toBeNull();
  });

  it('only uses project names that have an account profile of their own', () => {
    const profiles = new Set(
      result.documents
        .filter((document) => document.docType === 'account')
        .map((document) => document.relativePath.split('/').at(-1)?.replace('.md', '')),
    );

    for (const document of result.documents) {
      if (document.project) expect(profiles).toContain(document.project);
    }
  });
});

describe('resolveProjects', () => {
  it('gives no labels when the corpus has no account profiles to read them from', () => {
    const assignments = resolveProjects([
      { path: 'migrations/something/2026-01.md', docType: 'migration' },
    ]);

    expect(assignments.size).toBe(0);
  });

  it('prefers the longer name when one project name contains another', () => {
    const assignments = resolveProjects([
      { path: 'accounts/ledger.md', docType: 'account' },
      { path: 'accounts/alpine-ledger.md', docType: 'account' },
      { path: 'migrations/alpine-ledger/2026-01.md', docType: 'migration' },
    ]);

    expect(assignments.get('migrations/alpine-ledger/2026-01.md')).toBe('alpine-ledger');
  });

  it('reads the account from a folder as well as from a file name', () => {
    const assignments = resolveProjects([
      { path: 'accounts/kestrel-freight.md', docType: 'account' },
      { path: 'migrations/kestrel-freight/2025-11.md', docType: 'migration' },
      { path: 'incidents/2026-03-kestrel-freight-outage.md', docType: 'incident' },
      { path: 'syncs/2026-06-15.md', docType: 'sync' },
    ]);

    expect(assignments.get('migrations/kestrel-freight/2025-11.md')).toBe('kestrel-freight');
    expect(assignments.get('incidents/2026-03-kestrel-freight-outage.md')).toBe('kestrel-freight');
    expect(assignments.has('syncs/2026-06-15.md')).toBe(false);
    expect(assignments.get('accounts/kestrel-freight.md')).toBe('kestrel-freight');
  });
});

describe('re-running', () => {
  it('produces identical output, which is what makes a re-index cheap', async () => {
    const second = await prepareCorpus(resolveFromProjectRoot('./corpus'));

    expect(second.documents.map((d) => d.contentHash)).toEqual(
      result.documents.map((d) => d.contentHash),
    );
    expect(second.documents.map((d) => d.chunks.map((c) => c.contentHash))).toEqual(
      result.documents.map((d) => d.chunks.map((c) => c.contentHash)),
    );
  });

  it('reads the files in a stable order', async () => {
    const second = await prepareCorpus(resolveFromProjectRoot('./corpus'));

    expect(second.documents.map((d) => d.relativePath)).toEqual(
      result.documents.map((d) => d.relativePath),
    );
  });
});
