// pdfScanReading.ts — a scan's text in the PDF view: the reading kept for it,
// or a reading made now.
//
// When a PDF opens, the reading the document reader kept for it gives its
// textless pages their text (pdfReadingTextLayer.ts). A scan that had not
// been read yet (the indexer has not reached it, or it is not in the index)
// opened as pictures: nothing to find, nothing to select, and a citation's
// quote could not light up. Now it is read when it is opened. The reader is
// asked for it, one quiet line in the view says so, and when the reading
// arrives the pages on screen get their text without the document being
// loaded again or the place in it being lost.
//
// Rules:
// - Only a scan is read: most of the pages looked at have no text of their own.
// - A document the reader has read before is never read again here, whatever
//   it found on it. (The reader keeps a reading even when it found no lines.)
// - Nothing is started for it: with no reader set up, the scan opens as it did.
// - The reader takes one document at a time, the indexer's included, on the
//   processor (electron/doclingBridge.cjs), so this never touches the card.

import { createBlock } from '../../../ui/kit.js';
import type { IDisposable } from '../../../platform/lifecycle.js';
import type { PDFFindController, PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs';
import { fetchDocumentReading, isBlankPageText, type IDocumentReading } from '../../../services/documentReading.js';
import { applyReadingTextLayer, type PDFDocumentProxy } from './pdfReadingTextLayer.js';
import './pdfScanReading.css';

export type { PDFDocumentProxy };

/** How many pages are looked at to tell a scan from a document with text. */
const SAMPLE_PAGES = 6;
/** A reader still starting up (the app has just opened) is waited for this long. */
const READER_WAIT_MS = 60_000;
const READER_POLL_MS = 2_000;

export interface IScanReadingHost {
  /** Where the pages are shown: the status line is placed over it. */
  readonly element: HTMLElement | null | undefined;
  /** The document the view holds now: another one, or none, and a reading that arrives is for a view that has moved on. */
  document(): PDFDocumentProxy | null;
  /** The viewer and the find controller, once there are any. */
  viewer(): PDFViewer | null;
  find(): PDFFindController | null;
}

/** The reader's bridge, as the preload exposes it. */
interface IReaderBridge {
  status(): Promise<{ status?: string } | null | undefined>;
  convert(filePath: string, options?: { ocr?: boolean }): Promise<{ ok?: boolean; error?: string } | null | undefined>;
}

function readerBridge(): IReaderBridge | undefined {
  const api = (globalThis as { parallxElectron?: { docling?: Partial<IReaderBridge> } }).parallxElectron?.docling;
  return api?.status && api.convert ? api as IReaderBridge : undefined;
}

/** The page numbers looked at: up to SAMPLE_PAGES, spread over the document. */
export function samplePages(pageCount: number, sample: number = SAMPLE_PAGES): number[] {
  const n = Math.max(0, Math.floor(pageCount));
  const take = Math.min(sample, n);
  const out = new Set<number>();
  for (let i = 0; i < take; i++) out.add(1 + Math.floor((i * n) / take));
  return [...out];
}

/** Is this document a scan: do most of the pages looked at have no text of their own? */
export async function looksLikeScan(doc: PDFDocumentProxy): Promise<boolean> {
  const pages = samplePages(doc.numPages);
  if (pages.length === 0) return false;
  let blank = 0;
  for (const n of pages) {
    try {
      const content = await (await doc.getPage(n)).getTextContent();
      const text = (content.items as Array<{ str?: string }>).map((item) => item.str ?? '').join('');
      if (isBlankPageText(text)) blank++;
    } catch { /* a page that cannot be read counts as having text: nothing is started for it */ }
  }
  return blank * 2 > pages.length;
}

/** Wait for a reader that is starting up; false when there is none, or it did not come up in time. */
async function readerReady(bridge: IReaderBridge, stopped: () => boolean): Promise<boolean> {
  const until = Date.now() + READER_WAIT_MS;
  for (;;) {
    let status: string | undefined;
    try { status = (await bridge.status())?.status; } catch { return false; }
    if (status === 'available') return true;
    if (status !== 'starting' || stopped() || Date.now() >= until) return false;
    await new Promise((resolve) => setTimeout(resolve, READER_POLL_MS));
  }
}

/**
 * Give the pages already on screen the text of a reading that has just
 * arrived. pdf.js hands out one object per page, so patching the pages (the
 * reading's getPage hook does it) reaches the views that hold them; a page
 * that was drawn is drawn again with its text, and Find forgets the empty
 * text it had gathered. Returns how many pages the reading has lines for.
 */
export async function showReadingOnOpenDocument(doc: PDFDocumentProxy, reading: IDocumentReading, host: IScanReadingHost): Promise<number> {
  const count = applyReadingTextLayer(doc, reading);
  const viewer = host.viewer();
  // Not handed to the viewer yet: its pages get their text when they are first drawn.
  if (count === 0 || !viewer || viewer.pdfDocument !== doc) return count;
  const pages = reading.pages.filter((p) => p.lines.length > 0).map((p) => p.page).filter((n) => n >= 1 && n <= doc.numPages);
  await Promise.all(pages.map((n) => doc.getPage(n).catch(() => null)));
  if (host.viewer() !== viewer || viewer.pdfDocument !== doc) return count;
  for (const n of pages) {
    const view = viewer.getPageView(n - 1) as { pdfPage?: unknown; renderingState?: number; reset?: () => void } | undefined;
    // 0 is pdf.js's "not drawn yet": such a page gets its text when it is first drawn.
    if (view?.pdfPage && view.renderingState !== 0) view.reset?.();
  }
  viewer.update();
  host.find()?.setDocument(doc);
  return count;
}

/**
 * Call it with the document just loaded, before the viewer gets it. A kept
 * reading is applied at once, as before. With none, and the document a scan,
 * the reader is asked for it in the background; the returned handle stops
 * caring about the answer (the document was closed).
 */
export async function openScanReading(doc: PDFDocumentProxy, fsPath: string | undefined, host: IScanReadingHost): Promise<IDisposable> {
  const nothing: IDisposable = { dispose: () => { /* nothing was started */ } };
  if (!fsPath) return nothing;
  const kept = await fetchDocumentReading(fsPath);
  if (kept) { applyReadingTextLayer(doc, kept); return nothing; }
  const bridge = readerBridge();
  if (!bridge) return nothing;

  let stopped = false;
  const gone = (): boolean => stopped || host.document() !== doc;
  let line: HTMLElement | null = null;
  const say = (text: string): void => {
    line?.remove();
    line = text && host.element ? createBlock(host.element, 'div', { className: 'pdf-scan-status', text, attrs: { role: 'status', 'aria-live': 'polite' } }) : null;
  };

  void (async () => {
    try {
      if (!(await readerReady(bridge, gone)) || gone() || !(await looksLikeScan(doc)) || gone()) return;
      say('Reading this scan so its text can be found and selected…');
      const result = await bridge.convert(fsPath, { ocr: true });
      const reading = result?.ok ? await fetchDocumentReading(fsPath) : null;
      say('');
      if (gone()) return;
      if (reading) await showReadingOnOpenDocument(doc, reading, host);
      else if (result && !result.ok) console.warn('[PdfScanReading] The reader could not read', fsPath, result.error ?? '');
    } catch (err) {
      if (!stopped) say('');
      console.warn('[PdfScanReading] Reading on open stopped:', err);
    }
  })();

  return { dispose: () => { stopped = true; say(''); } };
}
