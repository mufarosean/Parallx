// Worksheets: the review as a chat turn. The brief is staged in the input
// with room for the user's own question, the work goes as attached context;
// an empty sheet refuses before anything is staged.
import { describe, it, expect } from 'vitest';
import { buildReviewContext, buildReviewRequest } from '../../src/built-in/worksheet/worksheetAi.js';

const sheet = (cells: Record<number, Record<number, { v?: unknown; f?: string }>>) =>
  JSON.stringify({ sheetOrder: ['s1'], sheets: { s1: { name: 'Sheet1', cellData: cells } } });

const item = {
  title: 'Siewert 2018 Q3',
  questionMd: 'Estimate the excess ratio.',
  solutionJson: sheet({ 1: { 1: { v: 0.35, f: '=B1/B0' } } }),
  solutionNotesMd: 'Ratio of excess losses to total.',
};
const work = sheet({ 1: { 1: { v: 0.3, f: '=B1/B0*0.85' } } });

describe('buildReviewContext', () => {
  it('carries the item, the model solution, the notes and the learner cells', () => {
    const ctx = buildReviewContext(item, work);
    expect(ctx).toContain('ITEM: Siewert 2018 Q3');
    expect(ctx).toContain('Estimate the excess ratio.');
    expect(ctx).toContain('MODEL SOLUTION CELLS:\nB2: 0.35 (=B1/B0)');
    expect(ctx).toContain('MODEL SOLUTION NOTES:\nRatio of excess losses to total.');
    expect(ctx).toMatch(/LEARNER'S WORK[^\n]*\nB2: 0\.3 \(=B1\/B0\*0\.85\)/);
  });
  it('refuses an empty sheet before anything is sent', () => {
    expect(() => buildReviewContext(item, sheet({}))).toThrow(/no work on the sheet/);
    expect(() => buildReviewContext(item, '')).toThrow(/no work on the sheet/);
  });
});

describe('buildReviewRequest', () => {
  it('speaks in the learner voice, names the item, asks for method feedback and no score', () => {
    const { prompt, context } = buildReviewRequest(item, work);
    expect(prompt).toContain('Review my work on "Siewert 2018 Q3"');
    expect(prompt).toMatch(/never a score/);
    expect(prompt).toMatch(/naming the cell/);
    // One paragraph, then a blank line: the caret lands under the brief so
    // the user's question goes there before they send.
    expect(prompt).toMatch(/^[^\n]+\n\n$/);
    expect(context).toBe(buildReviewContext(item, work));
  });
});
