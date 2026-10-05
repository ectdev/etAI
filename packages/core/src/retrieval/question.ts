/**
 * The shortest run of letters or digits a question needs before it is worth searching.
 *
 * Below this there is nothing for either search to work with. Two characters of
 * punctuation retrieve whatever happens to be nearest, which is noise presented in the
 * same shape as an answer.
 */
const MIN_MEANINGFUL_CHARACTERS = 3;

/**
 * The longest question accepted.
 *
 * Long enough for a real question with context, short enough that a pasted document does
 * not become an embedding call. The limit is on the normalised text, so padding does not
 * get around it.
 */
const MAX_LENGTH = 500;

export interface NormalizedQuestion {
  /** The question as it will be searched and embedded. */
  text: string;
  /** Whether there is enough here to search for. */
  usable: boolean;
  /** Why not, when it is not usable. */
  problem: 'empty' | 'too-short' | null;
}

/**
 * Cleans up a question and says whether it can be answered at all.
 *
 * Counting letters and digits rather than characters is what makes this work for the
 * languages the collection is asked about. The embedding model handles German, Turkish,
 * Spanish and Japanese questions about English documents, so a check that assumed ASCII
 * would reject questions the rest of the system answers correctly.
 */
export function normalizeQuestion(raw: string): NormalizedQuestion {
  const text = raw.normalize('NFC').replace(/\s+/g, ' ').trim().slice(0, MAX_LENGTH);

  if (text.length === 0) {
    return { text, usable: false, problem: 'empty' };
  }

  // \p{L} is any letter in any script and \p{N} is any digit, so this counts real content
  // in Japanese and Turkish the same way it does in English.
  const meaningful = text.match(/[\p{L}\p{N}]/gu)?.length ?? 0;

  if (meaningful < MIN_MEANINGFUL_CHARACTERS) {
    return { text, usable: false, problem: 'too-short' };
  }

  return { text, usable: true, problem: null };
}

/** What to say when there is nothing to search for. Shared so every surface says it once. */
export function unusableQuestionMessage(problem: 'empty' | 'too-short'): string {
  return problem === 'empty'
    ? 'Ask a question and it will be answered from the indexed documents.'
    : 'That is too short to search for. Try asking in a few words what you want to know.';
}
