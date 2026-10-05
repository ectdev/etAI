import { describe, expect, it } from 'vitest';
import { deriveMetadata } from './metadata.js';

const derive = (relativePath: string, content = '# Heading\n\nBody.') =>
  deriveMetadata({ relativePath, content });

describe('document type', () => {
  it.each([
    ['migrations/alpine-ledger/2026-01.md', 'migration'],
    ['syncs/2026-06-15.md', 'sync'],
    ['accounts/quillfeed.md', 'account'],
    ['releases/runner/5.2.md', 'release'],
    ['incidents/2026-02-19-queue-stall.md', 'incident'],
    ['handbook/naming.md', 'handbook'],
    ['policies/release-gate.md', 'policy'],
    ['platform/runners/aws.md', 'platform'],
  ])('reads %s as %s', (path, expected) => {
    expect(derive(path).docType).toBe(expected);
  });

  it('takes the type from the top-level folder, however deep the file sits', () => {
    // An account's updates live in a folder named after the account, and a type called
    // `alpine_ledger` would describe one customer rather than a kind of document.
    expect(derive('migrations/alpine-ledger/2026-01.md').docType).toBe('migration');
    expect(derive('platform/agent/drift.md').docType).toBe('platform');
  });

  it('calls a file at the root a reference document, since no folder describes it', () => {
    expect(derive('halcyon.md').docType).toBe('reference');
  });

  it.each([
    ['policies', 'policy'],
    ['syncs', 'sync'],
    ['runbooks', 'runbook'],
    ['processes', 'processe'],
    ['process', 'process'],
    ['status', 'status'],
    ['analysis', 'analysis'],
    ['keys', 'key'],
    ['handbook', 'handbook'],
    ['release-notes', 'release_note'],
  ])('names the folder %s as the type %s', (folder, expected) => {
    expect(derive(`${folder}/a.md`).docType).toBe(expected);
  });
});

describe('dates', () => {
  it('reads a full date from a file name', () => {
    const result = derive('syncs/2026-06-15.md');

    expect(result.temporalDate).toBe('2026-06-15');
    expect(result.temporalPrecision).toBe('day');
    expect(result.temporalSource).toBe('filename');
  });

  it('reads a full date followed by more words', () => {
    expect(derive('incidents/2026-02-19-queue-stall.md').temporalDate).toBe('2026-02-19');
  });

  it('reads a year and month from a file name, and records that the day is not known', () => {
    const result = derive('migrations/kestrel-freight/2025-05.md');

    expect(result.temporalDate).toBe('2025-05-01');
    expect(result.temporalPrecision).toBe('month');
  });

  it('reads a date from the title line, which is where the release notes keep theirs', () => {
    const result = derive('releases/runner/5.1.md', '# Halcyon runner 5.1 (2026-02-03)\n\nBody.');

    expect(result.temporalDate).toBe('2026-02-03');
    expect(result.temporalPrecision).toBe('day');
    expect(result.temporalSource).toBe('heading');
  });

  it('keeps a month as a month even when words follow it', () => {
    // The April incident is named by its month alone, and the precision column is what
    // stops the first of the month from being read as the day it happened.
    const result = derive('incidents/2026-04-cache-poisoning.md');

    expect(result.temporalDate).toBe('2026-04-01');
    expect(result.temporalPrecision).toBe('month');
  });

  it('leaves the date empty rather than guessing when the document has none', () => {
    const result = derive('policies/secrets.md');

    expect(result.temporalDate).toBeNull();
    expect(result.temporalPrecision).toBeNull();
    expect(result.temporalSource).toBeNull();
  });

  it('prefers a full date in the name over a date in the heading', () => {
    const result = derive('syncs/2026-06-15.md', '# Sync (2020-01-01)\n\nBody.');

    expect(result.temporalDate).toBe('2026-06-15');
  });

  it('only reads a heading date from the title line, not from anywhere in the body', () => {
    const result = derive('notes.md', '# Notes\n\nThe incident (2026-03-04) was resolved.');

    expect(result.temporalDate).toBeNull();
  });
});

describe('versions', () => {
  it('takes the series from the folder when the file is named by its version alone', () => {
    const result = derive('releases/runner/5.2.md');

    expect(result.versionSeries).toBe('releases/runner');
    expect(result.versionNumber).toBe('5.2');
  });

  it('keeps two products in one releases folder apart', () => {
    expect(derive('releases/runner/5.2.md').versionSeries).not.toBe(
      derive('releases/agent/5.2.md').versionSeries,
    );
  });

  it('splits a series from its version number when both are in the name', () => {
    const result = derive('notes/agent-1.2.3.md');

    expect(result.versionSeries).toBe('agent');
    expect(result.versionNumber).toBe('1.2.3');
  });

  it.each([
    ['a bare version at the root, with no folder to name it', '5.2.md'],
    ['a single number, which could be anything', 'releases/runner/5.md'],
    ['a year', 'reports/2026.md'],
    ['a month', 'migrations/alpine-ledger/2026-01.md'],
    ['a day', 'syncs/2026-06-15.md'],
    ['an account profile', 'accounts/quillfeed.md'],
    ['a policy', 'policies/release-gate.md'],
  ])('finds no version in %s', (_, path) => {
    expect(derive(path).versionSeries).toBeNull();
    expect(derive(path).versionNumber).toBeNull();
  });

  it('does not read a date as a version', () => {
    // `outage-2026-03` used to come out as version 03 of a series called `outage-2026`,
    // because a trailing group of digits after a dash looks exactly like a version.
    const result = derive('outage-2026-03.md');

    expect(result.versionSeries).toBeNull();
    expect(result.versionNumber).toBeNull();
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

    expect(derive('platform/agent/drift-legacy.md', v2).isDeprecated).toBe(true);
  });

  it('does not mark the current guide, even though it talks about the retired one', () => {
    const v3 = [
      '# drift agent v3 (current)',
      '',
      'v3 is the current agent for all new pipelines, mandatory since January 2026.',
      'It supersedes v2 and is not backward compatible.',
    ].join('\n');

    expect(derive('platform/agent/drift.md', v3).isDeprecated).toBe(false);
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
    // only thing keeping the current agent guide from being marked retired by the word
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
