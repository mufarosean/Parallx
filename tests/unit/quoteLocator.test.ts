// quoteLocator.test.ts — finding a quoted passage in a document's own text.
//
// A citation's page, line or cell has to come from where the words are, not
// from arithmetic. These cover what text extraction and retyping change
// (case, spacing, line-end hyphens, quote styles, ligatures, math letters)
// and the page-marker trap that put every cited page one off.

import { describe, it, expect } from 'vitest';
import {
  locateQuote,
  locatePassageUnits,
  pageLabelForPassage,
  isLocatableQuote,
  columnLetters,
  parseCellRef,
  formatPagesForReading,
} from '../../src/services/quoteLocator';

const pages = [
  'Clark (2003)\nIntroduction to the LDF and Cape Cod methods.',
  'Growth curve truncation. Clark only truncates growth curves when estimating reserves.',
  'The ultimate loss is NOT the same as the ex-\npected loss! This is super important!\nThe expected loss is used to calculate the reserves.',
];

describe('locateQuote', () => {
  it('finds a quote on its page, ignoring case, spacing, punctuation and a line-end hyphen', () => {
    const [m] = locateQuote(pages, '"The ultimate loss is not the same as the expected loss!"');
    expect(m.startUnit).toBe(2);
    expect(m.endUnit).toBe(2);
    // The passage comes back in the document's own wording (for the viewer's find).
    // A word split by a line-end hyphen is joined, as the PDF viewer's find
    // joins it in the page text, so the highlight lands.
    expect(m.text).toBe('The ultimate loss is NOT the same as the expected loss');
  });

  it('treats curly quotes, dashes and ligatures like their plain forms', () => {
    const units = ['The ‘expected’ loss — not the ultimate — is used to ﬁnd the reserve.'];
    expect(locateQuote(units, "the 'expected' loss - not the ultimate - is used to find the reserve")).toHaveLength(1);
  });

  it('matches math letters (𝑥, 𝐺) to plain letters', () => {
    const units = ['Expected incremental = Ult · [𝐺(𝑥ₖ) − 𝐺(𝑥ₖ₋₁)] for each age'];
    const [m] = locateQuote(units, 'Expected incremental = Ult [G(xk) - G(xk-1)]');
    expect(m).toBeDefined();
    // A match runs from its first letter or digit to its last.
    expect(m.text).toBe('Expected incremental = Ult · [𝐺(𝑥ₖ) − 𝐺(𝑥ₖ₋₁');
    // Ending on a two-unit character keeps the whole character.
    const [n] = locateQuote(units, 'Expected incremental = Ult [G(x');
    expect(n.text.endsWith('𝑥')).toBe(true);
  });

  it('reports a quote that runs from one page onto the next', () => {
    const [m] = locateQuote(pages, 'and Cape Cod methods. Growth curve truncation');
    expect(m.startUnit).toBe(0);
    expect(m.endUnit).toBe(1);
  });

  it('reports every occurrence in document order', () => {
    const units = ['the expected loss ratio here', 'nothing', 'and the expected loss ratio again'];
    expect(locateQuote(units, 'the expected loss ratio').map((m) => m.startUnit)).toEqual([0, 2]);
  });

  it('finds nothing for a quote that is not there, or too short to place', () => {
    expect(locateQuote(pages, 'the ultimate loss equals the expected loss')).toEqual([]);
    expect(isLocatableQuote('ELR')).toBe(false);
    expect(locateQuote(['ELR ELR ELR'], 'ELR')).toEqual([]);
    expect(isLocatableQuote('unified linking')).toBe(true);
  });
});

describe('locatePassageUnits', () => {
  it('places a search chunk whose layout differs from the page text', () => {
    const chunk = '## Growth Curve Truncation\n\n**Clark only truncates growth curves** when estimating reserves.';
    expect(locatePassageUnits(pages, chunk)).toEqual([1]);
  });

  it('returns nothing when the chunk is not from these pages', () => {
    expect(locatePassageUnits(pages, 'Venter factors and the Mack chain ladder variance estimator')).toEqual([]);
  });

  it('labels the page or pages a passage is on', () => {
    expect(pageLabelForPassage(pages, 'Clark only truncates growth curves when estimating reserves')).toBe('page 2 of 3');
    expect(pageLabelForPassage(pages, 'and Cape Cod methods. Growth curve truncation. Clark only truncates growth curves when estimating reserves. The ultimate loss is NOT the same')).toBe('pages 1 to 3 of 3');
    expect(pageLabelForPassage(pages, 'Venter factors and the Mack chain ladder')).toBe('');
  });
});

describe('cell references', () => {
  it('names columns the way spreadsheets do', () => {
    expect(columnLetters(0)).toBe('A');
    expect(columnLetters(25)).toBe('Z');
    expect(columnLetters(26)).toBe('AA');
    expect(columnLetters(27)).toBe('AB');
    expect(columnLetters(701)).toBe('ZZ');
    expect(columnLetters(702)).toBe('AAA');
  });

  it('parses A1 references, absolute or not, and rejects anything else', () => {
    expect(parseCellRef('B206')).toEqual({ row: 205, col: 1 });
    expect(parseCellRef('$aa$3')).toEqual({ row: 2, col: 26 });
    expect(parseCellRef('B0')).toBeUndefined();
    expect(parseCellRef('row 206')).toBeUndefined();
  });
});

describe('formatPagesForReading', () => {
  it('puts each page header BEFORE that page\'s text, so text under a header is that page', () => {
    const out = formatPagesForReading(pages);
    const header2 = out.indexOf('===== Page 2 of 3 =====');
    const header3 = out.indexOf('===== Page 3 of 3 =====');
    const truncation = out.indexOf('Clark only truncates growth curves');
    // The page-2 sentence sits between the page-2 and page-3 headers.
    expect(header2).toBeGreaterThan(-1);
    expect(truncation).toBeGreaterThan(header2);
    expect(truncation).toBeLessThan(header3);
    expect(out.startsWith('===== Page 1 of 3 =====')).toBe(true);
  });

  it('reads a page range, clamped to the document', () => {
    const out = formatPagesForReading(pages, 2, 9);
    expect(out.startsWith('===== Page 2 of 3 =====')).toBe(true);
    expect(out).toContain('===== Page 3 of 3 =====');
    expect(out).not.toContain('Page 1 of 3');
  });
});
