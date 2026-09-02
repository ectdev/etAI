import { describe, expect, it } from 'vitest';
import { normalizeQuestion, unusableQuestionMessage } from './question.js';

/**
 * What arrives in a search box.
 *
 * This is the only layer that sees a question before anything is spent on it, so it
 * decides what costs an embedding call and what does not. The cases below are the ones
 * that would otherwise reach the model wearing the shape of a question: text made
 * entirely of characters that carry no meaning to either search.
 *
 * The rule is one line of code and it is doing several jobs at once, which is exactly
 * why it is worth pinning. Counting `\p{L}` and `\p{N}` rather than string length is
 * what makes it work across scripts, and it is also what makes it handle emoji, and
 * neither of those is obvious from reading it.
 */
describe('deciding whether there is a question here', () => {
  it('accepts a question in a script with no ASCII in it', () => {
    // The reason the rule counts letters by Unicode property rather than by range. A
    // check written against ASCII would reject questions the rest of the system answers
    // correctly, and it would do it silently.
    for (const question of [
      'プレイアブルの最大サイズは?',
      'Какой максимальный размер?',
      '最大尺寸是多少',
    ]) {
      expect(normalizeQuestion(question).usable).toBe(true);
    }
  });

  it('accepts a question whose letters all carry diacritics', () => {
    expect(normalizeQuestion('Hangi diller zorunlu?').usable).toBe(true);
    expect(normalizeQuestion('ölçü').usable).toBe(true);
  });

  it('turns away text made only of emoji, however much of it there is', () => {
    // Emoji are neither letters nor digits, so a wall of them counts as nothing to
    // search for. Length would have accepted all three.
    for (const question of ['🎉', '🎉🎉🎉', '👍👍👍👍👍👍👍👍👍👍']) {
      expect(normalizeQuestion(question).usable).toBe(false);
    }
  });

  it('turns away an emoji that is several code points joined together', () => {
    // A family emoji is five code points and one grapheme. Counting code points would
    // have made this look like enough content to search for.
    expect(normalizeQuestion('👨‍👩‍👧‍👦').usable).toBe(false);
  });

  it('turns away characters that are invisible rather than absent', () => {
    // Zero-width spaces survive the whitespace collapse, because JavaScript's \s does
    // not match them. They are caught by the count instead, which is worth knowing: the
    // trimming is not what makes this safe.
    expect(normalizeQuestion('​​​​').usable).toBe(false);
    expect(normalizeQuestion('   ').problem).toBe('empty');
    expect(normalizeQuestion('').problem).toBe('empty');
  });

  it('keeps emoji that arrive alongside a real question', () => {
    // The opposite failure. Stripping them would edit what somebody typed, and the
    // question underneath is answerable.
    const result = normalizeQuestion('🎮 what is the maximum file size? 🎮');

    expect(result.usable).toBe(true);
    expect(result.text).toContain('🎮');
  });

  it('leaves a misspelled question exactly as it was typed', () => {
    // Correcting it here would be a guess applied before anything has been searched.
    // Retrieval handles these already, measured across the question set, so there is
    // nothing for this layer to fix.
    expect(normalizeQuestion('aplovin maksimum dosya boyutu').text).toBe(
      'aplovin maksimum dosya boyutu',
    );
  });

  it('collapses the whitespace a paste brings with it without touching the words', () => {
    expect(normalizeQuestion('  what   is\n\tthe  limit  ').text).toBe('what is the limit');
  });

  it('caps the length so a pasted document cannot become an embedding call', () => {
    const result = normalizeQuestion('a'.repeat(2000));

    expect(result.text).toHaveLength(500);
    expect(result.usable).toBe(true);
  });

  it('applies the cap after normalising, so padding cannot get around it', () => {
    // 600 words of one letter each. Measured on the raw string this is 1199 characters
    // and the cap would cut it mid-way; measured after collapsing it is what it says.
    const padded = Array.from({ length: 600 }, () => 'a').join('  ');
    const result = normalizeQuestion(padded);

    expect(result.text).toHaveLength(500);
    expect(result.text).not.toContain('  ');
  });

  it('normalises characters that look identical but are not', () => {
    // Composed and decomposed forms of the same letter must not be two different
    // questions, because a keyboard and a paste can produce either.
    expect(normalizeQuestion('ölçü').text).toBe(normalizeQuestion('ölçü').text);
  });

  it('leaves already normalised text alone', () => {
    /**
     * Idempotence, and it is load bearing rather than tidy.
     *
     * The answer path normalises once and hands the result to search, which normalises
     * again on the way in. Two callers, one string, and they must agree: if a second
     * pass changed the text, the question that was searched for and the question the
     * model was asked would drift apart, and the answer would be written from documents
     * retrieved for something slightly different.
     */
    for (const raw of ['  spaced   out  ', '🎮 what is the limit? 🎮', 'ölçü', 'a'.repeat(2000)]) {
      const once = normalizeQuestion(raw).text;
      expect(normalizeQuestion(once).text).toBe(once);
    }
  });

  it('names the two ways a question can be unusable, and says something different for each', () => {
    // The message is what a person reads when nothing happens, and "empty" and "too
    // short" call for different next steps.
    expect(unusableQuestionMessage('empty')).not.toBe(unusableQuestionMessage('too-short'));
    expect(unusableQuestionMessage('empty')).toBeTruthy();
    expect(unusableQuestionMessage('too-short')).toBeTruthy();
  });
});
