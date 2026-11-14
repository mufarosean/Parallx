// @vitest-environment jsdom
// pdfScanReading.test.ts — a scan that has not been read is read when it is
// opened, and the pages on screen get their text when the reading arrives.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { looksLikeScan, openScanReading, samplePages, type IScanReadingHost } from '../../src/editor/panes/pdf/pdfScanReading';
import type { PDFDocumentProxy } from '../../src/editor/panes/pdf/pdfReadingTextLayer';

const READING = { version: 1, ocr: true, pages: [{ page: 1, width: 1200, height: 1600, lines: [{ text: 'The ultimate loss', box: [100, 200, 700, 240] }] }, { page: 2, width: 1200, height: 1600, lines: [{ text: 'is the sum', box: [100, 200, 500, 240] }] }], blocks: [], tables: [] };

/** A pdf.js document of `texts.length` pages, each with the text given ('' for a scanned page). */
function fakeDoc(texts: string[]) {
  const pages = texts.map((text) => ({
    getTextContent: async () => ({ items: text ? [{ str: text }] : [] }),
    streamTextContent: () => new ReadableStream({ start(c) { c.enqueue({ items: text ? [{ str: text }] : [] }); c.close(); } }),
    getViewport: () => ({ width: 600, height: 800, convertToPdfPoint: (x: number, y: number) => [x, 800 - y] }),
  }));
  return { numPages: texts.length, getPage: async (n: number) => pages[n - 1] } as unknown as PDFDocumentProxy;
}

/** The reader's bridge: no reading kept until `convert` has run. */
function fakeReader(o: { status?: string[]; convert?: () => Promise<{ ok: boolean; error?: string }>; kept?: unknown } = {}) {
  const statuses = [...(o.status ?? ['available'])];
  let read = o.kept !== undefined;
  const bridge = {
    status: vi.fn(async () => ({ status: statuses.length > 1 ? statuses.shift() : statuses[0] })),
    convert: vi.fn(async (_path: string, _options?: { ocr?: boolean }) => { const r = await (o.convert?.() ?? Promise.resolve({ ok: true })); if (r.ok) read = true; return r; }),
    reading: vi.fn(async () => (read ? (o.kept ?? READING) : null)),
  };
  (globalThis as { parallxElectron?: unknown }).parallxElectron = { docling: bridge };
  return bridge;
}

function fakeHost(doc: PDFDocumentProxy | null, drawn: number[] = [3, 0]) {
  const element = document.createElement('div');
  document.body.appendChild(element);
  const views = drawn.map((renderingState) => ({ pdfPage: {}, renderingState, reset: vi.fn() }));
  const viewer = { pdfDocument: doc, getPageView: (i: number) => views[i], update: vi.fn() };
  const find = { setDocument: vi.fn() };
  const state = { doc };
  const host: IScanReadingHost = { element, document: () => state.doc, viewer: () => viewer as never, find: () => find as never };
  return { host, element, views, viewer, find, state, status: () => element.querySelector('.pdf-scan-status') };
}

const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); };
const firstLine = async (doc: PDFDocumentProxy, n: number) => ((await (await doc.getPage(n)).getTextContent()).items[0] as { str?: string } | undefined)?.str;

afterEach(() => { vi.useRealTimers(); delete (globalThis as { parallxElectron?: unknown }).parallxElectron; document.body.innerHTML = ''; });

describe('telling a scan from a document with text', () => {
  it('looks at up to six pages, spread over the document', () => {
    expect(samplePages(0)).toEqual([]);
    expect(samplePages(1)).toEqual([1]);
    expect(samplePages(3)).toEqual([1, 2, 3]);
    expect(samplePages(100)).toEqual([1, 17, 34, 51, 67, 84]);
  });

  it('is a scan when most of the pages looked at have no text of their own', async () => {
    expect(await looksLikeScan(fakeDoc(['', '', '']))).toBe(true);
    expect(await looksLikeScan(fakeDoc(['', 'A page of text', '']))).toBe(true);
    expect(await looksLikeScan(fakeDoc(['', 'A page of text', 'Another page of text', 'More']))).toBe(false); // a blank cover does not make a scan
    expect(await looksLikeScan(fakeDoc(['Text', 'Text']))).toBe(false);
    expect(await looksLikeScan(fakeDoc([]))).toBe(false);
  });
});

describe('opening a scan', () => {
  it('uses the reading kept for it at once, and asks the reader for nothing', async () => {
    const reader = fakeReader({ kept: READING });
    const doc = fakeDoc(['', '']);
    const h = fakeHost(doc);
    await openScanReading(doc, 'D:/scans/exam.pdf', h.host);
    await settle();
    expect(await firstLine(doc, 1)).toBe('The ultimate loss');
    expect(reader.convert).not.toHaveBeenCalled();
    expect(h.status()).toBeNull();
  });

  it('a reading that found nothing is still a reading: the scan is not read again', async () => {
    const reader = fakeReader({ kept: { version: 1, ocr: true, pages: [{ page: 1, width: 100, height: 100, lines: [] }], blocks: [], tables: [] } });
    const doc = fakeDoc(['']);
    await openScanReading(doc, 'D:/scans/blank.pdf', fakeHost(doc).host);
    await settle();
    expect(reader.convert).not.toHaveBeenCalled();
  });

  it('reads a scan that was never read: says so, then gives the pages on screen their text', async () => {
    let finish!: (r: { ok: boolean }) => void;
    const reader = fakeReader({ convert: () => new Promise((resolve) => { finish = resolve; }) });
    const doc = fakeDoc(['', '']);
    const h = fakeHost(doc);
    await openScanReading(doc, 'D:/scans/exam.pdf', h.host);
    await settle();
    expect(reader.convert).toHaveBeenCalledWith('D:/scans/exam.pdf', { ocr: true });
    expect(h.status()?.textContent).toContain('Reading this scan');
    expect(h.status()?.getAttribute('role')).toBe('status');
    expect(await firstLine(doc, 1)).toBeUndefined(); // no text yet

    finish({ ok: true });
    await settle();
    expect(h.status()).toBeNull();
    expect(await firstLine(doc, 1)).toBe('The ultimate loss');
    expect(await firstLine(doc, 2)).toBe('is the sum');
    expect(h.views[0].reset).toHaveBeenCalledOnce();       // the page that was drawn is drawn again, with its text
    expect(h.views[1].reset).not.toHaveBeenCalled();       // a page not drawn yet gets its text when it is
    expect(h.viewer.update).toHaveBeenCalledOnce();
    expect(h.find.setDocument).toHaveBeenCalledWith(doc);  // Find forgets the empty text it had gathered
  });

  it('leaves a document with text of its own alone', async () => {
    const reader = fakeReader();
    const doc = fakeDoc(['A page of text', 'Another']);
    const h = fakeHost(doc);
    await openScanReading(doc, 'D:/papers/mack.pdf', h.host);
    await settle();
    expect(reader.convert).not.toHaveBeenCalled();
    expect(h.status()).toBeNull();
  });

  it('does nothing with no reader set up, and starts none', async () => {
    const reader = fakeReader({ status: ['unavailable'] });
    const doc = fakeDoc(['', '']);
    const h = fakeHost(doc);
    await openScanReading(doc, 'D:/scans/exam.pdf', h.host);
    await settle();
    expect(reader.convert).not.toHaveBeenCalled();
    expect(h.status()).toBeNull();
    delete (globalThis as { parallxElectron?: unknown }).parallxElectron;
    await expect(openScanReading(doc, 'D:/scans/exam.pdf', h.host)).resolves.toBeTruthy(); // no desktop bridge at all
  });

  it('waits for a reader that is still starting up', async () => {
    vi.useFakeTimers();
    const reader = fakeReader({ status: ['starting', 'starting', 'available'] });
    const doc = fakeDoc(['', '']);
    const h = fakeHost(doc);
    await openScanReading(doc, 'D:/scans/exam.pdf', h.host);
    await vi.advanceTimersByTimeAsync(1000);
    expect(reader.convert).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5000);
    expect(reader.convert).toHaveBeenCalledOnce();
  });

  it('a closed document takes its status line with it and gets no late text', async () => {
    let finish!: (r: { ok: boolean }) => void;
    fakeReader({ convert: () => new Promise((resolve) => { finish = resolve; }) });
    const doc = fakeDoc(['', '']);
    const h = fakeHost(doc);
    const handle = await openScanReading(doc, 'D:/scans/exam.pdf', h.host);
    await settle();
    expect(h.status()).not.toBeNull();
    handle.dispose();
    expect(h.status()).toBeNull();
    finish({ ok: true });
    await settle();
    expect(h.views[0].reset).not.toHaveBeenCalled();
    expect(h.find.setDocument).not.toHaveBeenCalled();
  });

  it('a view that moved on to another document is left alone', async () => {
    let finish!: (r: { ok: boolean }) => void;
    fakeReader({ convert: () => new Promise((resolve) => { finish = resolve; }) });
    const doc = fakeDoc(['', '']);
    const h = fakeHost(doc);
    await openScanReading(doc, 'D:/scans/exam.pdf', h.host);
    await settle();
    h.state.doc = fakeDoc(['Text']); // the tab shows another PDF now
    finish({ ok: true });
    await settle();
    expect(h.status()).toBeNull();
    expect(h.views[0].reset).not.toHaveBeenCalled();
    expect(h.viewer.update).not.toHaveBeenCalled();
  });

  it('a scan the reader could not read opens as it did: no text, no line left behind', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fakeReader({ convert: async () => ({ ok: false, error: 'The file is damaged.' }) });
    const doc = fakeDoc(['', '']);
    const h = fakeHost(doc);
    await openScanReading(doc, 'D:/scans/bad.pdf', h.host);
    await settle();
    expect(h.status()).toBeNull();
    expect(h.views[0].reset).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
