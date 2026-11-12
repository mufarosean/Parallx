// documentReading.test.ts — the reader's record of where everything on a
// document's pages is: checked on the way in, turned into page text, and
// used to fill in pages that have no text of their own (a scan).

import { describe, it, expect } from 'vitest';
import {
  isBlankPageText, mergePageTexts, parseReading, readingPageTexts, type IDocumentReading,
} from '../../src/services/documentReading';

const scan: IDocumentReading = {
  version: 1,
  ocr: true,
  pages: [
    { page: 1, width: 600, height: 800, lines: [{ text: 'Chapter 1', box: [50, 40, 200, 60] }, { text: 'The ultimate loss', box: [50, 80, 300, 98] }] },
    { page: 2, width: 600, height: 800, lines: [{ text: 'is not the expected loss.', box: [50, 40, 320, 58] }] },
  ],
  blocks: [{ label: 'section_header', page: 1, box: [50, 40, 200, 60], text: 'Chapter 1' }],
  tables: [],
};

describe('parseReading', () => {
  it('keeps a well-formed reading as it is', () => {
    expect(parseReading(JSON.parse(JSON.stringify(scan)))).toEqual(scan);
  });

  it('drops what is malformed and never throws', () => {
    expect(parseReading(null)).toBeNull();
    expect(parseReading('text')).toBeNull();
    expect(parseReading({ blocks: [] })).toBeNull();
    const r = parseReading({
      pages: [
        { page: 1, width: 600, height: 800, lines: [{ text: 'kept', box: [1, 2, 3, 4] }, { text: 'no box' }, { text: '', box: [1, 2, 3, 4] }, { text: 'bad box', box: [1, 2, 'x', 4] }] },
        { page: 0, width: 600, height: 800, lines: [] },
        { page: 2, width: 0, height: 800, lines: [] },
        'junk',
      ],
      blocks: [{ label: 'text', page: 1, box: [1, 2, 3, 4] }, { label: 'text', page: 1 }, null],
      tables: [{ page: 1, box: [0, 0, 10, 10], rows: 1, cols: 2, cells: [{ r: 0, c: 0, rs: 1, cs: 1, text: 'a', box: [0, 0, 5, 5], header: true }, { r: 0, c: 1 }] }, { page: 1 }],
    });
    expect(r?.pages).toEqual([{ page: 1, width: 600, height: 800, lines: [{ text: 'kept', box: [1, 2, 3, 4] }] }]);
    expect(r?.blocks).toEqual([{ label: 'text', page: 1, box: [1, 2, 3, 4] }]);
    expect(r?.tables).toEqual([{ page: 1, box: [0, 0, 10, 10], rows: 1, cols: 2, cells: [{ r: 0, c: 0, rs: 1, cs: 1, text: 'a', box: [0, 0, 5, 5], header: true }] }]);
    expect(r?.ocr).toBe(false);
  });
});

describe('page text', () => {
  it('is the lines of each page, in page order', () => {
    expect(readingPageTexts(scan)).toEqual(['Chapter 1\nThe ultimate loss', 'is not the expected loss.']);
  });

  it('leaves a gap for a page the reading skips', () => {
    const r: IDocumentReading = { ...scan, pages: [scan.pages[1]] };
    expect(readingPageTexts(r)).toEqual(['', 'is not the expected loss.']);
  });

  it('tells a page with no text from one with some', () => {
    expect(isBlankPageText('')).toBe(true);
    expect(isBlankPageText(' \n . ')).toBe(true);
    expect(isBlankPageText(undefined)).toBe(true);
    expect(isBlankPageText('Page 12')).toBe(false);
  });
});

describe('mergePageTexts', () => {
  it('fills in only the pages that have no text of their own', () => {
    // A mixed PDF: page 1 is born-digital, page 2 is a scan.
    expect(mergePageTexts(['Its own first page', ''], scan)).toEqual(['Its own first page', 'is not the expected loss.']);
  });

  it('gives a fully scanned PDF the reader\'s text on every page', () => {
    expect(mergePageTexts(['', ' '], scan)).toEqual(readingPageTexts(scan));
    expect(mergePageTexts([], scan)).toEqual(readingPageTexts(scan));
  });

  it('changes nothing without a reading, or with one that found no lines', () => {
    const own = ['', ''];
    expect(mergePageTexts(own, null)).toBe(own);
    const empty: IDocumentReading = { ...scan, ocr: false, pages: scan.pages.map((p) => ({ ...p, lines: [] })) };
    expect(mergePageTexts(own, empty)).toBe(own);
  });
});
