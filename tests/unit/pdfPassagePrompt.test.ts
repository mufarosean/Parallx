// pdfPassagePrompt.test.ts — what the AI is told about a highlighted passage:
// the page's text read from pdf.js, cut around the passage when long, and a
// prompt naming the file and page that says to admit what it cannot find.

import { describe, it, expect } from 'vitest';
import { pageSource, pageTextFromItems, pageWindow, passagePrompt } from '../../src/editor/panes/pdf/pdfPassagePrompt';

describe('pdf passage prompt', () => {
  it('reads a page from pdf.js text items, line by line', () => {
    const items = [{ str: 'Loss development', hasEOL: true }, { str: 'factors ', hasEOL: false }, { str: 'by age', hasEOL: true }, { type: 'beginMarkedContent' }];
    expect(pageTextFromItems(items)).toBe('Loss development\nfactors by age');
  });

  it('keeps a short page whole and cuts a long one around the passage', () => {
    expect(pageWindow('short page', 'page')).toBe('short page');
    const long = 'a'.repeat(5000) + ' THE PASSAGE ' + 'b'.repeat(5000);
    const cut = pageWindow(long, 'THE PASSAGE', 1000);
    expect(cut).toContain('THE PASSAGE');
    expect(cut.startsWith('…') && cut.endsWith('…')).toBe(true);
    expect(cut.length).toBeLessThanOrEqual(1002);
    expect(pageWindow(long, 'not on the page', 1000).startsWith('aaa')).toBe(true);
  });

  it('names the file and page, and leaves out what it does not have', () => {
    const full = passagePrompt('the tail factor', { fileName: 'clark.pdf', pageNumber: 3, pageCount: 20, pageText: 'all of page 3', related: '[1] p.9' });
    expect(full).toContain('"clark.pdf", page 3 of 20');
    expect(full).toContain('all of page 3');
    expect(full).toContain('[1] p.9');
    expect(full).toContain('not in what you were given, say so');
    const bare = passagePrompt('', { pageNumber: 2 });
    expect(bare).toContain('a PDF, page 2.');
    expect(bare).toContain('an image or figure');
    expect(bare).not.toContain('The whole of page');
    expect(bare).not.toContain('elsewhere in the same file');
  });

  it('reads the page it is asked for, and nothing past the end', async () => {
    const asked: number[] = [];
    const doc = { numPages: 2, getPage: async (n: number) => { asked.push(n); return { getTextContent: async () => ({ items: [{ str: `text of ${n}` }] }) }; } };
    const file = { name: 'a.pdf', uri: { fsPath: '/w/a.pdf' } };
    expect(await pageSource(doc, file, 2)).toEqual({ fileName: 'a.pdf', filePath: '/w/a.pdf', pageCount: 2, pageText: 'text of 2' });
    expect((await pageSource(doc, file, 3)).pageText).toBeUndefined();
    expect(asked).toEqual([2]);
    expect(await pageSource(null, null, 1)).toEqual({ fileName: undefined, filePath: undefined, pageCount: undefined, pageText: undefined });
  });
});
