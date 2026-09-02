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

describe('the sample collection', () => {
  it('reads all of it', () => {
    expect(result.documents).toHaveLength(142);
  });

  it('comes out as one chunk per document', () => {
    const summary = summarize(result);

    expect(summary.chunks).toBe(142);
    expect(summary.multiChunkDocuments).toBe(0);
  });

  it('has no document anywhere near the chunk budget', () => {
    // If this changes, documents will start being split and the assertion above will
    // fail for a reason that has nothing to do with a bug.
    const largest = Math.max(...result.documents.flatMap((d) => d.chunks.map((c) => c.tokenCount)));

    expect(largest).toBeLessThan(400);
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
      'client_brief',
      'delivery_report',
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

    expect(summary.withDate).toBe(117);
    expect(summary.dayPrecision).toBe(36);
    expect(summary.monthPrecision).toBe(81);
  });

  it('dates every release note from its title line', () => {
    const changelogs = result.documents.filter((document) => document.docType === 'changelog');

    expect(changelogs).toHaveLength(6);
    for (const changelog of changelogs) {
      expect(changelog.temporalSource).toBe('heading');
      expect(changelog.temporalPrecision).toBe('day');
    }
  });

  it('dates every meeting note to the day and every delivery report to the month', () => {
    for (const document of result.documents) {
      if (document.docType === 'meeting_note') expect(document.temporalPrecision).toBe('day');
      if (document.docType === 'delivery_report') expect(document.temporalPrecision).toBe('month');
    }
  });

  it('finds the date in the incident postmortem, whose name puts it at the end', () => {
    const incident = get('incident-postmortem-2026-03.md');

    expect(incident.temporalDate).toBe('2026-03-01');
    expect(incident.temporalPrecision).toBe('month');
    expect(incident.versionSeries).toBeNull();
  });
});

describe('the two SDK guides', () => {
  it('marks the retired one and not the current one', () => {
    expect(get('sdk-notes-v2.md').isDeprecated).toBe(true);
    expect(get('sdk-notes-v3.md').isDeprecated).toBe(false);
  });

  it('marks nothing else in the collection as retired', () => {
    const deprecated = result.documents.filter((document) => document.isDeprecated);

    expect(deprecated.map((document) => document.relativePath)).toEqual(['sdk-notes-v2.md']);
  });
});

describe('the release note series', () => {
  it('links each note to the next one and leaves the newest unlinked', () => {
    expect(get('changelogs/lumen-build-4.1.md').supersededByPath).toBe(
      'changelogs/lumen-build-4.2.md',
    );
    expect(get('changelogs/lumen-build-4.2.md').supersededByPath).toBe(
      'changelogs/lumen-build-4.3.md',
    );
    expect(get('changelogs/lumen-build-4.3.md').supersededByPath).toBeNull();
  });

  it('finds one series and only the release notes in it', () => {
    const versioned = result.documents.filter((document) => document.versionSeries !== null);

    expect(versioned).toHaveLength(6);
    expect(new Set(versioned.map((document) => document.versionSeries))).toEqual(
      new Set(['lumen-build']),
    );
  });
});

describe('projects', () => {
  it('labels the delivery reports with the project they are about', () => {
    expect(get('delivery-reports/2026-01-tidal-tycoon.md').project).toBe('tidal-tycoon');
    expect(get('client-briefs/tidal-tycoon.md').project).toBe('tidal-tycoon');
  });

  it('does not invent a project for documents that are not about one', () => {
    // An earlier rule took whatever was left of the file name after the date, which
    // produced projects called `incident-postmortem` and `production-sync`.
    expect(get('incident-postmortem-2026-03.md').project).toBeNull();
    expect(get('qa-checklist.md').project).toBeNull();

    const meetingNotes = result.documents.filter((d) => d.docType === 'meeting_note');
    for (const note of meetingNotes) expect(note.project).toBeNull();
  });

  it('only uses project names that have a brief of their own', () => {
    const briefs = new Set(
      result.documents
        .filter((document) => document.docType === 'client_brief')
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
      { path: 'delivery-reports/2026-01-something.md', docType: 'delivery_report' },
    ]);

    expect(assignments.size).toBe(0);
  });

  it('prefers the longer name when one project name contains another', () => {
    const assignments = resolveProjects([
      { path: 'client-briefs/marina.md', docType: 'client_brief' },
      { path: 'client-briefs/merge-marina.md', docType: 'client_brief' },
      { path: 'delivery-reports/2026-01-merge-marina.md', docType: 'delivery_report' },
    ]);

    expect(assignments.get('delivery-reports/2026-01-merge-marina.md')).toBe('merge-marina');
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
