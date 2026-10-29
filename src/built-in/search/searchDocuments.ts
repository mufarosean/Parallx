// searchDocuments.ts — Find in Files reads PDF, Word, Excel and the other
// documents the app can open, not only plain text.
//
// Their bytes are not their text, so Find in Files skipped them, and the
// papers a study workspace is made of could not be searched. A document is
// read through the file service's text extraction (the same reader the AI
// and the index use), a PDF page by page so a match can say and open its
// page. Extraction is slow next to reading a text file, so each document's
// text is kept, keyed by its size and modification time, until it changes;
// the cache holds a bounded amount of text, the least recently searched
// documents going first.

import { URI } from '../../platform/uri.js';

/** One line to search: its text and, in a PDF, its page (1-based). */
export interface ISearchLine {
  readonly text: string;
  readonly page?: number;
}

export interface IDocumentTextSource {
  isRichDocument(ext: string): boolean;
  readDocumentText(uri: URI): Promise<{ text: string; pageTexts?: readonly string[] }>;
}

/** About 40 MB of text kept between searches. */
const CACHE_CHARS = 20_000_000;

/** A document's text as lines, a PDF's numbered by page. */
export function documentLines(doc: { text: string; pageTexts?: readonly string[] }): ISearchLine[] {
  if (doc.pageTexts?.length) {
    return doc.pageTexts.flatMap((page, i) => page.split('\n').map((text) => ({ text, page: i + 1 })));
  }
  return doc.text.split('\n').map((text) => ({ text }));
}

export class SearchDocumentReader {
  /** Insertion order is use order: a read moves an entry to the end. */
  private readonly _cache = new Map<string, { key: string; lines: ISearchLine[]; chars: number }>();
  private _chars = 0;

  constructor(private readonly _source: IDocumentTextSource) {}

  isDocument(ext: string): boolean {
    return this._source.isRichDocument(ext.toLowerCase());
  }

  /** The document's lines; undefined when it cannot be read. */
  async read(uri: string, stamp: { mtime?: number; size?: number }): Promise<ISearchLine[] | undefined> {
    const key = `${stamp.mtime ?? ''}:${stamp.size ?? ''}`;
    const known = this._cache.get(uri);
    if (known && known.key === key && stamp.mtime !== undefined) {
      this._cache.delete(uri); this._cache.set(uri, known);
      return known.lines;
    }
    try {
      const lines = documentLines(await this._source.readDocumentText(URI.parse(uri)));
      const chars = lines.reduce((n, l) => n + l.text.length, 0);
      if (known) { this._chars -= known.chars; this._cache.delete(uri); }
      if (chars <= CACHE_CHARS / 4) {
        this._cache.set(uri, { key, lines, chars });
        this._chars += chars;
        this._trim();
      }
      return lines;
    } catch {
      return undefined; // a document that will not open is skipped, as an unreadable file is
    }
  }

  private _trim(): void {
    while (this._chars > CACHE_CHARS) {
      const oldest = this._cache.keys().next().value as string | undefined;
      if (oldest === undefined) return;
      this._chars -= this._cache.get(oldest)?.chars ?? 0;
      this._cache.delete(oldest);
    }
  }
}
