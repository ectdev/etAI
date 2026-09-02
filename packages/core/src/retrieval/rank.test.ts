import { describe, expect, it } from 'vitest';
import { demotionFor, rankChunks, type RankableChunk } from './rank.js';

/**
 * Builds a chunk with scores shaped the way rank fusion produces them.
 *
 * The flatness is the point. Fused scores across the top twelve results span about
 * eighteen percent, and a ranking rule that behaves sensibly on a spread of 0 to 1 can
 * behave absurdly here. These tests use realistic numbers so they can catch that.
 */
const chunk = (
  id: string,
  position: number,
  overrides: Partial<RankableChunk> = {},
): RankableChunk => ({
  chunkId: id,
  path: `${id}.md`,
  docType: 'reference',
  isDeprecated: false,
  supersededByPath: null,
  score: 1 / (60 + position),
  ...overrides,
});

describe('demotionFor', () => {
  it('leaves a current document where it is', () => {
    expect(demotionFor({ isDeprecated: false, supersededByPath: null })).toBe(0);
  });

  it('moves a document that has been followed by a newer one', () => {
    expect(demotionFor({ isDeprecated: false, supersededByPath: 'newer.md' })).toBeGreaterThan(0);
  });

  it('does not move a retired document', () => {
    // Measured rather than assumed. Retrieval already puts the current guide first,
    // because a question about how something works now matches it better, so a demotion
    // changed no ordering and only pushed the retired guide out of the results. One of
    // the sample questions asks what happened to a call that no longer exists, and
    // answering that needs the retired guide present.
    expect(demotionFor({ isDeprecated: true, supersededByPath: null })).toBe(0);
  });

  it('takes an amount from the caller, which is how the sweep varies it', () => {
    expect(demotionFor({ isDeprecated: true, supersededByPath: null }, { deprecated: 4 })).toBe(4);
  });
});

describe('rankChunks', () => {
  it('leaves an order alone when nothing is out of date', () => {
    const ranked = rankChunks([chunk('a', 1), chunk('b', 2), chunk('c', 3)], { limit: 3 });

    expect(ranked.map((item) => item.chunkId)).toEqual(['a', 'b', 'c']);
  });

  it('keeps both SDK guides, leaving the order to how well each matched', () => {
    // Retirement is acted on where it belongs, in the context the model reads, rather
    // than by moving the document. Both have to reach the model for it to be able to say
    // that one of them is retired.
    const ranked = rankChunks([chunk('retired', 1, { isDeprecated: true }), chunk('current', 2)], {
      limit: 2,
    });

    expect(ranked.map((item) => item.chunkId)).toEqual(['retired', 'current']);
  });

  /**
   * The case that decides whether one of the sample questions can be answered.
   *
   * Asking whether the old SDK is still supported has to return the current guide and
   * keep the retired one in the results, because the answer has to be able to say the old
   * call is gone. A demotion that removes it produces a correct answer missing half of
   * what was asked for.
   */
  it('keeps a retired document in the results rather than dropping it out', () => {
    const chunks = [
      chunk('retired-sdk', 1, { isDeprecated: true }),
      chunk('current-sdk', 2),
      chunk('unrelated-1', 3, { docType: 'meeting_note' }),
      chunk('unrelated-2', 4, { docType: 'meeting_note' }),
      chunk('unrelated-3', 5, { docType: 'deployment_report' }),
      chunk('unrelated-4', 6, { docType: 'deployment_report' }),
    ];

    const ids = rankChunks(chunks, { limit: 5 }).map((item) => item.chunkId);

    expect(ids).toContain('retired-sdk');
    expect(ids).toContain('current-sdk');
  });

  it('does not let a demotion behave like a removal on flat fused scores', () => {
    // Fused scores span about eighteen percent across the top twelve, so a demotion
    // measured as a fraction of the score removes a document rather than moving it. This
    // holds the positional form in place: even a large demotion leaves the document in
    // the results.
    const chunks = [
      chunk('older', 1, { supersededByPath: 'newer.md' }),
      ...Array.from({ length: 15 }, (_, i) => chunk(`filler-${i}`, i + 2)),
    ];

    const ranked = rankChunks(chunks, { limit: 8, supersededDemotion: 4 });
    const position = ranked.findIndex((item) => item.chunkId === 'older');

    expect(position).toBeGreaterThan(0);
    expect(position).toBeLessThanOrEqual(5);
  });

  it('puts a release note behind the one that followed it', () => {
    const ranked = rankChunks(
      [
        chunk('older', 1, { docType: 'changelog', supersededByPath: 'newer.md' }),
        chunk('newer', 2, { docType: 'changelog' }),
      ],
      { limit: 2 },
    );

    expect(ranked.map((item) => item.chunkId)).toEqual(['newer', 'older']);
  });

  describe('the quota', () => {
    it('stops a template written type from filling every slot', () => {
      // The failure this exists for: 61 deployment reports written from one template, so
      // a question matching the template returns the template rather than the answer.
      const chunks = [
        ...Array.from({ length: 10 }, (_, i) =>
          chunk(`report-${i}`, i + 1, { docType: 'deployment_report' }),
        ),
        chunk('checklist', 11),
      ];

      const ids = rankChunks(chunks, { limit: 5 }).map((item) => item.chunkId);

      // The guarantee is not that the crowd is capped in the final results. It is that
      // the document answering the question gets in, and gets in ahead of the third
      // member of the crowd rather than being pushed off the end by it.
      expect(ids).toContain('checklist');
      expect(ids.indexOf('checklist')).toBeLessThan(ids.indexOf('report-2'));
    });

    it('still fills the results when only one kind of document matches', () => {
      const chunks = Array.from({ length: 10 }, (_, i) =>
        chunk(`report-${i}`, i + 1, { docType: 'deployment_report' }),
      );

      const ranked = rankChunks(chunks, { limit: 5 });

      expect(ranked).toHaveLength(5);
    });

    it('takes the best of a crowded type rather than an arbitrary two', () => {
      const chunks = Array.from({ length: 6 }, (_, i) =>
        chunk(`report-${i}`, i + 1, { docType: 'deployment_report' }),
      );

      const ranked = rankChunks(chunks, { limit: 2 });

      expect(ranked.map((item) => item.chunkId)).toEqual(['report-0', 'report-1']);
    });

    it('does not cap a type that is not written from a template', () => {
      // Fourteen reference documents share a type and have nothing else in common. A
      // question needing three of them should get three, and an earlier version capped
      // them alongside the templates and cut the third off.
      const chunks = Array.from({ length: 5 }, (_, i) =>
        chunk(`reference-${i}`, i + 1, { docType: 'reference' }),
      );

      const ranked = rankChunks(chunks, { limit: 4 });

      expect(ranked).toHaveLength(4);
      expect(ranked.map((item) => item.chunkId)).toEqual([
        'reference-0',
        'reference-1',
        'reference-2',
        'reference-3',
      ]);
    });

    it('caps customer briefs, which repeat most of their sentences across all twelve', () => {
      // The briefs are the second template in the collection. Twelve of them repeat the
      // same sentences about scope, handover and the four week timeline, so a question
      // touching any of those matches all twelve about equally well and can push out the
      // one document that actually answers it.
      const chunks = [
        ...Array.from({ length: 6 }, (_, i) => chunk(`brief-${i}`, i + 1, { docType: 'customer' })),
        chunk('overview', 7),
      ];

      const ids = rankChunks(chunks, { limit: 4 }).map((item) => item.chunkId);

      expect(ids).toContain('overview');
      expect(ids.indexOf('overview')).toBeLessThan(ids.indexOf('brief-2'));
    });

    it('takes the crowded types from the caller when asked', () => {
      const chunks = [
        ...Array.from({ length: 5 }, (_, i) => chunk(`guide-${i}`, i + 1, { docType: 'guide' })),
        chunk('other', 6, { docType: 'reference' }),
      ];

      const ids = rankChunks(chunks, { limit: 4, crowdedTypes: ['guide'] }).map((i) => i.chunkId);

      expect(ids).toContain('other');
    });

    it('respects a quota given by the caller', () => {
      const chunks = [
        ...Array.from({ length: 6 }, (_, i) =>
          chunk(`report-${i}`, i + 1, { docType: 'deployment_report' }),
        ),
        chunk('other', 7, { docType: 'guide' }),
      ];

      const ranked = rankChunks(chunks, { limit: 4, perTypeLimit: 1 });
      const reports = ranked.filter((item) => item.docType === 'deployment_report');

      expect(reports.length).toBeGreaterThanOrEqual(1);
      expect(ranked.map((item) => item.chunkId)).toContain('other');
    });

    it('never returns the same chunk twice', () => {
      const chunks = Array.from({ length: 8 }, (_, i) =>
        chunk(`item-${i}`, i + 1, { docType: i < 4 ? 'a' : 'b' }),
      );

      const ranked = rankChunks(chunks, { limit: 8 });
      const ids = ranked.map((item) => item.chunkId);

      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  it('is stable, so the same candidates give the same order', () => {
    const chunks = [chunk('a', 1), chunk('b', 1), chunk('c', 2)];

    expect(rankChunks(chunks, { limit: 3 })).toEqual(rankChunks(chunks, { limit: 3 }));
  });

  it('handles an empty candidate list', () => {
    expect(rankChunks([], { limit: 5 })).toEqual([]);
  });
});
