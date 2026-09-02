export interface RankableChunk {
  chunkId: string;
  path: string;
  docType: string;
  isDeprecated: boolean;
  supersededByPath: string | null;
  score: number;
}

export interface RankOptions {
  /** How many results to keep. */
  limit?: number;
  /** How many results a crowded document type may take in the first pass. */
  perTypeLimit?: number;
  /** Which types the quota applies to. Defaults to the crowded ones. */
  crowdedTypes?: readonly string[];
  /** Positions a retired document gives up. Exposed so the sweep can vary it. */
  deprecatedDemotion?: number;
  /** Positions a document with a newer version gives up. */
  supersededDemotion?: number;
}

/**
 * Retirement does not move a document at all.
 *
 * A penalty here looks obviously right and is wrong twice over. As a score multiplier it
 * removes the document rather than demoting it, because fused scores are nearly flat:
 * first place scores around 0.0164 and twelfth around 0.0139, so a factor of 0.7 throws a
 * document past twenty others. As a demotion of three positions it costs more than it
 * returns, because the current document already outranks the retired one: a question about
 * how something works now genuinely matches the current guide better.
 *
 * The case that decides it is in this collection. `drift-agent-v2.md` is retired and
 * `drift-agent-v3.md` replaced it, and one of the questions people actually ask is what
 * happened to `report()`, which only the retired guide describes. Demoting it answers that
 * question worse.
 *
 * Retirement is still acted on. It is marked in the context the model reads, which is
 * where it belongs, because the model needs to know a document is retired in order to say
 * so.
 *
 * The zero is carried over from a collection of the same shape and has not been re-swept
 * against this one. Run `pnpm eval --sweep` before describing it as measured here.
 */
export const DEPRECATED_DEMOTION = 0;

/**
 * How far down a document with a newer version of itself is moved.
 *
 * One position. Release notes in a series are close in wording, so the ordering between
 * them has to come from somewhere, and the date is the only thing that carries it.
 *
 * It stays gentle because being followed by a later release is not the same as being
 * wrong, and this collection contains the case that proves it: runner 5.2 changed how
 * cache retention is counted and 5.3 reverted the change, so 5.3 holds the current answer
 * while 5.4 through 5.10 all exist and are newer. A heavier demotion would push the
 * correct document down with the outdated one.
 *
 * The one is carried over from a collection of the same shape and has not been re-swept
 * against this one. Run `pnpm eval --sweep` before describing it as measured here.
 */
export const SUPERSEDED_DEMOTION = 1;

const DEFAULT_LIMIT = 8;

/**
 * How many results a crowded document type may take in the first pass.
 *
 * This is the fix for the failure vector and keyword search share. The collection holds
 * 61 deployment reports written from one template and 26 meeting notes from another, so a
 * question whose words appear in a template retrieves the template many times over and
 * the single reference document that answers never reaches the results.
 *
 * A quota rather than deduplication by similarity: the problem is not that two results
 * resemble each other, it is that one kind of document crowds out the others. A quota
 * addresses that directly and is deterministic, so a measurement can be repeated.
 *
 * The two is carried over from a collection of the same shape and has not been re-swept
 * against this one. Run `pnpm eval --sweep` before describing it as measured here.
 */
export const DEFAULT_PER_TYPE_LIMIT = 2;

/**
 * The types the quota applies to.
 *
 * Applying it to every type would be simpler to state and wrong, because crowding is a
 * property of how documents were written rather than of which folder they sit in. These
 * three types are filled in from a template: 61 deployment reports, 26 meeting notes and
 * 12 customer briefs, with whole sentences repeating word for word across every report
 * and every brief.
 *
 * The briefs belong here for the same reason the reports do. All twelve carry the same
 * sentence about migration timelines, so a question about timelines retrieves briefs
 * rather than the overview that answers it.
 *
 * The fourteen reference documents share a type and have nothing else in common. Capping
 * them would cut off the third document a question needed, and the retired agent guide is
 * the clearest case: a question about a call that no longer exists needs both that guide
 * and the one that replaced it.
 *
 * Naming the types rather than capping everything is kept because it is the version that
 * can be explained, and because it does not cut off a question that genuinely needs
 * several documents of a kind nobody writes from a template.
 */
export const CROWDED_TYPES = ['deployment_report', 'meeting_note', 'customer'] as const;

/**
 * Applies what is known about a document to the order search produced.
 *
 * Similarity has no way to know that a document was retired in January or that a later
 * release reversed it. That knowledge is in the metadata, and this is where it is used.
 */
export function rankChunks<T extends RankableChunk>(chunks: T[], options: RankOptions = {}): T[] {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const perTypeLimit = options.perTypeLimit ?? DEFAULT_PER_TYPE_LIMIT;
  const crowdedTypes = new Set(options.crowdedTypes ?? CROWDED_TYPES);
  const demotion = {
    deprecated: options.deprecatedDemotion ?? DEPRECATED_DEMOTION,
    superseded: options.supersededDemotion ?? SUPERSEDED_DEMOTION,
  };

  const byScore = [...chunks].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.chunkId.localeCompare(b.chunkId);
  });

  const demoted = byScore
    .map((chunk, position) => ({ chunk, position: position + demotionFor(chunk, demotion) }))
    .sort((a, b) => {
      if (a.position !== b.position) return a.position - b.position;
      return a.chunk.chunkId.localeCompare(b.chunk.chunkId);
    });

  return applyQuota(demoted, limit, perTypeLimit, crowdedTypes).map((entry) => entry.chunk);
}

/** How many positions a document gives up for being out of date. */
export function demotionFor(
  chunk: Pick<RankableChunk, 'isDeprecated' | 'supersededByPath'>,
  amounts: { deprecated?: number; superseded?: number } = {},
): number {
  let positions = 0;
  if (chunk.isDeprecated) positions += amounts.deprecated ?? DEPRECATED_DEMOTION;
  if (chunk.supersededByPath) positions += amounts.superseded ?? SUPERSEDED_DEMOTION;
  return positions;
}

/**
 * Fills the result list, holding the crowded types back on the first pass.
 *
 * Two passes. The first applies the quota, the second takes whatever is left, so a
 * question that genuinely is about deployment reports still fills its results with them
 * rather than coming back half empty.
 */
function applyQuota<T extends RankableChunk>(
  entries: Array<{ chunk: T; position: number }>,
  limit: number,
  perTypeLimit: number,
  crowdedTypes: Set<string>,
): Array<{ chunk: T; position: number }> {
  const kept: Array<{ chunk: T; position: number }> = [];
  const takenByType = new Map<string, number>();
  const used = new Set<string>();

  for (const cap of [perTypeLimit, Number.POSITIVE_INFINITY]) {
    for (const entry of entries) {
      if (kept.length >= limit) return kept;
      if (used.has(entry.chunk.chunkId)) continue;

      // Types that are not written from a template are never capped. A question needing
      // three reference documents should get three.
      if (crowdedTypes.has(entry.chunk.docType)) {
        const taken = takenByType.get(entry.chunk.docType) ?? 0;
        if (taken >= cap) continue;
        takenByType.set(entry.chunk.docType, taken + 1);
      }

      used.add(entry.chunk.chunkId);
      kept.push(entry);
    }
  }

  return kept;
}
