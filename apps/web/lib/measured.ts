/**
 * The retrieval figures the landing page shows.
 *
 * docs/evaluation.md owns every measured number in this project, and this is a copy for
 * one screen. Each figure carries the sentence of that document it was taken from, and
 * `measured.test.ts` fails when the sentence stops being there, so a re-measurement that
 * changes the document cannot leave the landing page quoting the old result.
 */
export interface MeasuredFigure {
  value: string;
  label: string;
  /** Words from docs/evaluation.md that state this figure, compared with spacing collapsed. */
  evidence: string;
}

export const MEASURED_QUESTIONS = 106;

export const MEASURED_FIGURES: MeasuredFigure[] = [
  {
    value: '66 of 67',
    label: 'answerable questions find the right document in the top five',
    evidence: '| Plus what is known about each document | 66 of 67 | 59 | 0.925 |',
  },
  {
    value: '0.925',
    label: 'mean reciprocal rank of the first right document',
    evidence: '| Plus what is known about each document | 66 of 67 | 59 | 0.925 |',
  },
  {
    value: '0 of 67',
    label: 'answerable questions refused before a model is asked',
    evidence: 'refuses none of the 67 answerable ones',
  },
  {
    value: '24 of 34',
    label: 'unrelated questions turned away without any model call',
    evidence: 'it turns away 24 of the 34 out of scope questions',
  },
];
