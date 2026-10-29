// searchDocuments.test.ts — Find in Files reads documents, a PDF by page, and
// extracts each one again only when it has changed.
import { describe, it, expect, vi } from 'vitest';
import { SearchDocumentReader, documentLines } from '../../src/built-in/search/searchDocuments';

describe('Find in Files over documents', () => {
  it('a PDF\'s lines carry their page', () => {
    expect(documentLines({ text: 'ignored', pageTexts: ['Clark\nLDF method', 'Cape Cod method'] })).toEqual([
      { text: 'Clark', page: 1 }, { text: 'LDF method', page: 1 }, { text: 'Cape Cod method', page: 2 },
    ]);
    expect(documentLines({ text: 'a\nb' })).toEqual([{ text: 'a' }, { text: 'b' }]);
  });

  it('reads a document once, and again only after it changed', async () => {
    const read = vi.fn(async () => ({ text: 'Tail factor' }));
    const docs = new SearchDocumentReader({ isRichDocument: (ext) => ext === '.pdf', readDocumentText: read });
    expect(docs.isDocument('.PDF')).toBe(true);
    expect(docs.isDocument('.md')).toBe(false);
    await docs.read('file:///ws/clark.pdf', { mtime: 1, size: 10 });
    await docs.read('file:///ws/clark.pdf', { mtime: 1, size: 10 });
    expect(read).toHaveBeenCalledTimes(1);
    await docs.read('file:///ws/clark.pdf', { mtime: 2, size: 10 });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('a document that will not open is skipped', async () => {
    const docs = new SearchDocumentReader({ isRichDocument: () => true, readDocumentText: async () => { throw new Error('encrypted'); } });
    expect(await docs.read('file:///ws/locked.pdf', { mtime: 1 })).toBeUndefined();
  });
});
