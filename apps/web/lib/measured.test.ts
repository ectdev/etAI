import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MEASURED_FIGURES, MEASURED_QUESTIONS } from './measured';

/**
 * The landing page's numbers, held to the document that owns them.
 */

const EVALUATION = readFileSync(new URL('../../../docs/evaluation.md', import.meta.url), 'utf8');
const collapse = (text: string) => text.replace(/\s+/g, ' ').trim();

describe('the figures on the landing page', () => {
  it.each(MEASURED_FIGURES)('$value is stated in docs/evaluation.md', ({ evidence }) => {
    expect(collapse(EVALUATION)).toContain(collapse(evidence));
  });

  it.each(MEASURED_FIGURES)('$value is the number its evidence states', ({ value, evidence }) => {
    // "0 of 67" is written "none of the 67", "24 of 34" as "24 of the 34".
    const [count, , total] = value.split(' ');
    if (total === undefined) {
      expect(evidence).toContain(value);
      return;
    }
    const written = count === '0' ? 'none' : count;
    expect(evidence).toMatch(new RegExp(`\\b${written} of (the )?${total}\\b`));
  });

  it('counts the questions the document says were measured', () => {
    expect(EVALUATION).toContain(`runs ${MEASURED_QUESTIONS} questions`);
  });

  it('notices a figure that is not in the document, so a pass means something', () => {
    expect(collapse(EVALUATION)).not.toContain('it turns away 25 of the 34 out of scope questions');
  });
});
