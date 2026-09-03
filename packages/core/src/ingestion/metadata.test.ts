import { describe, expect, it } from 'vitest';
import { deriveMetadata } from './metadata.js';

const derive = (relativePath: string, content = '# Heading\n\nBody.') =>
  deriveMetadata({ relativePath, content });

describe('document type', () => {
  it.each([
    ['deployment-reports/2026-01-alpine-ledger.md', 'deployment_report'],
    ['meeting-notes/2026-06-15-production-sync.md', 'meeting_note'],
    ['customers/quillfeed.md', 'customer'],
    ['changelogs/halcyon-runner-5.2.md', 'changelog'],
    ['postmortems/2026-02-19-queue-stall.md', 'postmortem'],
    ['guides/naming-conventions.md', 'guide'],
  ])('reads %s as %s', (path, expected) => {
    expect(derive(path).docType).toBe(expected);
  });

  it('calls a file at the root a reference document, since no directory describes it', () => {
    expect(derive('release-checklist.md').docType).toBe('reference');
  });
});

describe('dates', () => {
  it('reads a full date from the start of a file name', () => {
    const result = derive('meeting-notes/2026-06-15-production-sync.md');

    expect(result.temporalDate).toBe('2026-06-15');
    expect(result.temporalPrecision).toBe('day');
    expect(result.temporalSource).toBe('filename');
  });

  it('reads a year and month from a file name, and records that the day is not known', () => {
    const result = derive('deployment-reports/2025-05-kestrel-freight.md');

    expect(result.temporalDate).toBe('2025-05-01');
    expect(result.temporalPrecision).toBe('month');
  });

  it('reads a date from the title line, which is where the release notes keep theirs', () => {
    const result = derive(
      'changelogs/halcyon-runner-5.1.md',
      '# Halcyon runner 5.1 (2026-02-03)\n\nBody.',
    );

    expect(result.temporalDate).toBe('2026-02-03');
    expect(result.temporalPrecision).toBe('day');
    expect(result.temporalSource).toBe('heading');
  });

  it('finds a date that is not at the start of the file name', () => {
    // This one is easy to miss, and it is the document that answers the question about
    // the March 2026 incident, so missing it would be expensive.
    const result = derive('incident-postmortem-2026-03.md');

    expect(result.temporalDate).toBe('2026-03-01');
    expect(result.temporalPrecision).toBe('month');
  });

  it('leaves the date empty rather than guessing when the document has none', () => {
    const result = derive('secrets-policy.md');

    expect(result.temporalDate).toBeNull();
    expect(result.temporalPrecision).toBeNull();
    expect(result.temporalSource).toBeNull();
  });

  it('prefers a full date in the name over a date in the heading', () => {
    const result = derive('meeting-notes/2026-06-15-sync.md', '# Sync (2020-01-01)\n\nBody.');

    expect(result.temporalDate).toBe('2026-06-15');
  });

  it('only reads a heading date from the title line, not from anywhere in the body', () => {
    const result = derive('notes.md', '# Notes\n\nThe incident (2026-03-04) was resolved.');

    expect(result.temporalDate).toBeNull();
  });
});

describe('versions', () => {
  it('splits a series from its version number', () => {
    const result = derive('changelogs/halcyon-runner-5.2.md');

    expect(result.versionSeries).toBe('halcyon-runner');
    expect(result.versionNumber).toBe('5.2');
  });

  it('does not read a date as a version', () => {
    // `incident-postmortem-2026-03` used to come out as version 03 of a series called
    // `incident-postmortem-2026`, because a trailing group of digits after a dash looks
    // exactly like a version.
    const result = derive('incident-postmortem-2026-03.md');

    expect(result.versionSeries).toBeNull();
    expect(result.versionNumber).toBeNull();
  });

  it.each([
    'deployment-reports/2026-01-alpine-ledger.md',
    'meeting-notes/2026-06-15-production-sync.md',
    'customers/quillfeed.md',
    'release-checklist.md',
  ])('leaves %s without a version', (path) => {
    expect(derive(path).versionSeries).toBeNull();
  });

  it('handles a version with more than two parts', () => {
    const result = derive('changelogs/thing-1.2.3.md');

    expect(result.versionSeries).toBe('thing');
    expect(result.versionNumber).toBe('1.2.3');
  });
});

describe('deprecation', () => {
  /**
   * The two cases this rule exists for. Getting them the wrong way round does not make
   * the answer worse, it makes it wrong: the retired guide would be presented as current
   * and the current one pushed away.
   */
  it('marks the retired guide, which says so in its title and in a status line', () => {
    const v2 = [
      '# drift agent v2 (DEPRECATED)',
      '',
      'Status: deprecated since January 2026. Do not use for new pipelines.',
      '',
      'In v2, the agent starts with drift.init({ token }).',
    ].join('\n');

    expect(derive('drift-agent-v2.md', v2).isDeprecated).toBe(true);
  });

  it('does not mark the current guide, even though it talks about the retired one', () => {
    const v3 = [
      '# drift agent v3 (current)',
      '',
      'v3 is the current agent for all new pipelines, mandatory since January 2026.',
      'It supersedes v2 and is not backward compatible.',
    ].join('\n');

    expect(derive('drift-agent-v3.md', v3).isDeprecated).toBe(false);
  });

  it('is not fooled by a document that merely mentions deprecation in passing', () => {
    const content = [
      '# Migration Notes',
      '',
      'Some projects still call the deprecated helper, which was retired last year.',
    ].join('\n');

    expect(derive('migration-notes.md', content).isDeprecated).toBe(false);
  });

  it('accepts other words for the same thing in a title', () => {
    expect(derive('a.md', '# Old Guide (ARCHIVED)').isDeprecated).toBe(true);
    expect(derive('b.md', '# Old Guide (retired)').isDeprecated).toBe(true);
  });

  it('reads a status line that declares it, wherever the line sits', () => {
    const content = '# Guide\n\nIntro paragraph.\n\nStatus: obsolete as of March 2026.\n';
    expect(derive('c.md', content).isDeprecated).toBe(true);
  });

  it('does not treat a status line about something else as deprecation', () => {
    const content = '# Guide\n\nStatus: approved and in use.\n';
    expect(derive('d.md', content).isDeprecated).toBe(false);
  });

  it('reads a line that opens with the word and a colon', () => {
    /**
     * Found by pointing ingestion at a corpus it had never seen.
     *
     * A retired handbook announced itself in the body rather than in its title or a
     * `Status:` line, and was indexed as current. Nothing complained, which is the whole
     * problem: a retired document presented as current is a wrong answer rather than a
     * missing one.
     */
    const content = '# Old Handbook\n\nDEPRECATED: replaced by the widget spec.\n';
    expect(derive('old-handbook.md', content).isDeprecated).toBe(true);
  });

  it('still refuses the same words when they are part of a sentence', () => {
    // The line above is a declaration. These are mentions, and the distinction is the
    // only thing keeping the current SDK guide from being marked retired by the word
    // "supersedes" in its own description of what it replaced.
    for (const line of [
      'This guide is not deprecated: it is the current one.',
      'We retired the old helper: see the migration notes.',
      'Anything obsolete: check with the team before removing it.',
    ]) {
      expect(derive('e.md', `# Guide\n\n${line}\n`).isDeprecated).toBe(false);
    }
  });
});
