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

  it('gives every document a type from its directory', () => {
    expect(summarize(result).docTypes).toEqual([
      'changelog',
      'customer',
      'deployment_report',
      'guide',
      'meeting_note',
      'postmortem',
      'reference',
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
    const changelogs = result.documents.filter((document) => document.docType === 'changelog');

    expect(changelogs).toHaveLength(11);
    for (const changelog of changelogs) {
      expect(changelog.temporalSource).toBe('heading');
      expect(changelog.temporalPrecision).toBe('day');
    }
  });

  it('dates every meeting note to the day and every deployment report to the month', () => {
    for (const document of result.documents) {
      if (document.docType === 'meeting_note') expect(document.temporalPrecision).toBe('day');
      if (document.docType === 'deployment_report')
        expect(document.temporalPrecision).toBe('month');
    }
  });

  it('finds the date in the incident postmortem, whose name puts it at the end', () => {
    const incident = get('incident-postmortem-2026-04.md');

    expect(incident.temporalDate).toBe('2026-04-01');
    expect(incident.temporalPrecision).toBe('month');
    expect(incident.versionSeries).toBeNull();
  });
});

describe('the two agent guides', () => {
  it('marks the retired one and not the current one', () => {
    // The current guide says "It supersedes v2" three lines in. A rule that scanned for
    // words about deprecation would match on that and mark the wrong document.
    expect(get('drift-agent-v2.md').isDeprecated).toBe(true);
    expect(get('drift-agent-v3.md').isDeprecated).toBe(false);
  });

  it('marks nothing else in the collection as retired', () => {
    const deprecated = result.documents.filter((document) => document.isDeprecated);

    expect(deprecated.map((document) => document.relativePath)).toEqual(['drift-agent-v2.md']);
  });
});

describe('the release note series', () => {
  it('links each note to the next one and leaves the newest unlinked', () => {
    expect(get('changelogs/halcyon-runner-5.2.md').supersededByPath).toBe(
      'changelogs/halcyon-runner-5.3.md',
    );
    expect(get('changelogs/halcyon-runner-5.3.md').supersededByPath).toBe(
      'changelogs/halcyon-runner-5.4.md',
    );
    expect(get('changelogs/halcyon-runner-5.10.md').supersededByPath).toBeNull();
  });

  it('finds one series and only the release notes in it', () => {
    const versioned = result.documents.filter((document) => document.versionSeries !== null);

    expect(versioned).toHaveLength(11);
    expect(new Set(versioned.map((document) => document.versionSeries))).toEqual(
      new Set(['halcyon-runner']),
    );
  });

  it('orders 5.10 after 5.9 rather than before it', () => {
    // A string comparison puts 5.10 before 5.9. The ordering is numeric per part, and
    // this series exists at these two numbers so the rule has something to be wrong about.
    expect(get('changelogs/halcyon-runner-5.9.md').supersededByPath).toBe(
      'changelogs/halcyon-runner-5.10.md',
    );
  });
});

describe('projects', () => {
  it('labels the deployment reports with the customer they are about', () => {
    expect(get('deployment-reports/2025-11-kestrel-freight.md').project).toBe('kestrel-freight');
    expect(get('customers/kestrel-freight.md').project).toBe('kestrel-freight');
  });

  it('does not invent a project for documents that are not about one', () => {
    // An earlier rule took whatever was left of the file name after the date, which
    // produced projects called `incident-postmortem` and `production-sync`.
    expect(get('incident-postmortem-2026-04.md').project).toBeNull();
    expect(get('release-checklist.md').project).toBeNull();

    const meetingNotes = result.documents.filter((d) => d.docType === 'meeting_note');
    for (const note of meetingNotes) expect(note.project).toBeNull();
  });

  it('only uses project names that have a brief of their own', () => {
    const briefs = new Set(
      result.documents
        .filter((document) => document.docType === 'customer')
        .map((document) => document.relativePath.split('/').at(-1)?.replace('.md', '')),
    );

    for (const document of result.documents) {
      if (document.project) expect(briefs).toContain(document.project);
    }
  });
});

describe('resolveProjects', () => {
  it('gives no labels when the corpus has no briefs to read them from', () => {
    const assignments = resolveProjects([
      { path: 'deployment-reports/2026-01-something.md', docType: 'deployment_report' },
    ]);

    expect(assignments.size).toBe(0);
  });

  it('prefers the longer name when one project name contains another', () => {
    const assignments = resolveProjects([
      { path: 'customers/ledger.md', docType: 'customer' },
      { path: 'customers/alpine-ledger.md', docType: 'customer' },
      { path: 'deployment-reports/2026-01-alpine-ledger.md', docType: 'deployment_report' },
    ]);

    expect(assignments.get('deployment-reports/2026-01-alpine-ledger.md')).toBe('alpine-ledger');
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
