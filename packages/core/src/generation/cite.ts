import type { AnswerSource, Citation, LinkedCitation } from '@etai/shared';

/**
 * Gives each citation the identity a reader needs to follow it.
 *
 * The model cites a document by its path, because a path is what it can see in the
 * context and copy without transcribing it. Asking it for the database id instead would
 * mean asking it to copy a UUID correctly every time, which is a way of inviting a
 * mistake that looks like a citation.
 *
 * So the path is what crosses the model boundary and everything else is worked out here:
 * the number a reader sees next to the claim, and the id that opens the document. Both
 * come from the retrieved set rather than from the answer, which means neither can be
 * invented.
 *
 * This is deliberately not part of `verifyAnswer`. That function decides whether a
 * citation is allowed to exist, and it is a safety gate. This one decides how an allowed
 * citation is displayed. Keeping them apart means the gate can be read on its own, and
 * changing how citations are numbered cannot weaken what gets through.
 */
/**
 * Where each document sits in the retrieved list, counting from zero.
 *
 * A document may contribute more than one chunk, and a citation names the document rather
 * than the chunk. The first match is the best ranked one, which is the right place to
 * open.
 *
 * This is the numbering rule, and it is exported because the gate has to agree with it.
 * A gate that worked out the numbers its own way would accept a marker the reader's
 * interface then failed to resolve, and both halves would look correct on their own.
 */
export function firstIndexByPath(paths: string[]): Map<string, number> {
  const first = new Map<string, number>();

  paths.forEach((path, index) => {
    if (!first.has(path)) first.set(path, index);
  });

  return first;
}

export function linkCitations(citations: Citation[], sources: AnswerSource[]): LinkedCitation[] {
  const firstByPath = firstIndexByPath(sources.map((source) => source.path));

  const linked: LinkedCitation[] = [];

  for (const citation of citations) {
    const index = firstByPath.get(citation.documentPath);

    /**
     * Unreachable while `verifyAnswer` runs first, because it has already removed every
     * citation naming a path outside this set. It is a filter rather than a throw so a
     * mistake in that ordering costs one citation instead of the whole answer, and a
     * test asserts the two agree so the mistake cannot go unnoticed.
     */
    if (index === undefined) continue;

    const source = sources[index];
    if (!source) continue;

    linked.push({
      ...citation,
      // One based, because this is the number a person reads beside a claim.
      sourceNumber: index + 1,
      documentId: source.documentId,
      title: source.title,
    });
  }

  return linked;
}
