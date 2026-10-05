import type { Coverage } from '@etai/shared';
import { describe, expect, it } from 'vitest';
import { panelSources, type ChatAnswer, type ChatSource, type Turn } from './chat-types';

/**
 * What the side panel may show beside a turn.
 *
 * Its cards are numbered to match citation chips, so the rule is about when numbering
 * means something: while waiting, the retrieved documents are the point; after an answer
 * that cites, they are what the numbers point into; after a refusal, there is nothing to
 * number.
 */

const source = (path: string): ChatSource => ({
  documentId: `id-${path}`,
  path,
  title: path,
  headingPath: null,
  docType: 'reference',
  temporalDate: null,
  isDeprecated: false,
  supersededByPath: null,
});

const SOURCES = [source('policies/release-gate.md'), source('platform/runners/aws.md')];

function answer(coverage: Coverage | null): ChatAnswer {
  return {
    answer: coverage ? 'text' : 'Hello!',
    coverage,
    gap: null,
    citations: [],
    sources: SOURCES,
  };
}

function turn(overrides: Partial<Turn>): Pick<Turn, 'sources' | 'answer'> {
  return { sources: SOURCES, answer: null, ...overrides };
}

describe('panelSources', () => {
  it('shows what retrieval found while the answer is still being written', () => {
    expect(panelSources(turn({ answer: null }))).toEqual(SOURCES);
  });

  it.each<Coverage>(['full', 'partial'])('shows the sources beside a %s answer', (coverage) => {
    expect(panelSources(turn({ answer: answer(coverage) }))).toEqual(SOURCES);
  });

  it.each<Coverage>(['not_documented', 'out_of_scope'])(
    'shows nothing beside a %s refusal, however much was retrieved',
    (coverage) => {
      expect(panelSources(turn({ answer: answer(coverage) }))).toEqual([]);
    },
  );

  it('shows nothing beside a greeting, which consulted no document', () => {
    expect(panelSources(turn({ sources: [], answer: answer(null) }))).toEqual([]);
    expect(panelSources(turn({ answer: answer(null) }))).toEqual([]);
  });

  it('keeps what was retrieved when the request failed, since nothing was refused', () => {
    expect(panelSources(turn({ answer: null, sources: SOURCES }))).toEqual(SOURCES);
    expect(panelSources(turn({ answer: null, sources: [] }))).toEqual([]);
  });
});
