// pdfReadingTextLayer.ts — a text layer for pages that have no text.
//
// A scanned PDF is pictures of pages. pdf.js builds its text layer, its find,
// its selection and the highlight of a citation's quote from the text a page
// reports (getTextContent / streamTextContent), and a scanned page reports
// none. The document reader has read those pages (documentReading.ts): every
// line, with its box. This module makes a page with no text of its own report
// the reader's lines as its text, placed where they are on the picture, so
// everything pdf.js does with text works on a scan with no second mechanism.
//
// Only pages with no text of their own are touched: a page that has text
// keeps it, whatever the reader found.

import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { fetchDocumentReading, isBlankPageText, type IDocumentReading, type IReadingPage } from '../../../services/documentReading.js';

export type { PDFDocumentProxy };

/** The font name the lines are reported under; its metrics are in `STYLE`. */
const FONT_NAME = 'parallx_reading';
/** Where the baseline sits in a line's box, from its top. */
const ASCENT = 0.8;
const STYLE = { fontFamily: 'sans-serif', ascent: ASCENT, descent: ASCENT - 1, vertical: false };

interface TextItem {
  str: string;
  dir: string;
  transform: number[];
  width: number;
  height: number;
  fontName: string;
  hasEOL: boolean;
}
interface TextContent { items: TextItem[]; styles: Record<string, typeof STYLE>; lang: string | null }

interface PatchablePage {
  getTextContent(params?: unknown): Promise<{ items: Array<{ str?: string }> }>;
  streamTextContent(params?: unknown): ReadableStream<unknown>;
  getViewport(params: { scale: number }): { width: number; height: number; convertToPdfPoint(x: number, y: number): number[] };
}

const PATCHED = Symbol('parallxReadingTextLayer');

/**
 * The reader's lines for one page as pdf.js text items, in the page's own
 * coordinate space. `viewport` is the page as shown at scale 1 (rotation and
 * crop applied), which is the picture the reader measured its boxes on.
 */
export function readingTextContent(
  page: IReadingPage,
  viewport: { width: number; height: number; convertToPdfPoint(x: number, y: number): number[] },
): TextContent {
  const sx = viewport.width / page.width;
  const sy = viewport.height / page.height;
  const items: TextItem[] = [];
  for (const line of page.lines) {
    const [l, t, r, b] = line.box;
    const height = (b - t) * sy;
    const width = (r - l) * sx;
    if (!(height > 0) || !(width > 0)) continue;
    // The baseline's start, then one unit along the line and one unit up, all
    // in page space: that is the text matrix whatever the page's rotation.
    const x = l * sx;
    const y = (t + (b - t) * ASCENT) * sy;
    const [ox, oy] = viewport.convertToPdfPoint(x, y);
    const [ax, ay] = viewport.convertToPdfPoint(x + 1, y);
    const [ux, uy] = viewport.convertToPdfPoint(x, y - 1);
    items.push({
      str: line.text,
      dir: 'ltr',
      transform: [(ax - ox) * height, (ay - oy) * height, (ux - ox) * height, (uy - oy) * height, ox, oy],
      width,
      height,
      fontName: FONT_NAME,
      hasEOL: true,
    });
  }
  return { items, styles: { [FONT_NAME]: STYLE }, lang: null };
}

function patchPage(page: PatchablePage & { [PATCHED]?: boolean }, lines: IReadingPage): void {
  if (page[PATCHED]) return;
  page[PATCHED] = true;
  const ownGet = page.getTextContent.bind(page);
  const ownStream = page.streamTextContent.bind(page);

  // Asked once: does this page have text of its own? Read from the page's own
  // stream: pdf.js builds getTextContent on streamTextContent, so asking
  // through getTextContent would come back here and wait on itself.
  let blank: Promise<boolean> | null = null;
  const ownText = async (): Promise<string> => {
    let text = '';
    const reader = ownStream({}).getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const item of (value as { items?: Array<{ str?: string }> })?.items ?? []) text += item.str ?? '';
    }
    return text;
  };
  const isBlank = () => (blank ??= ownText().then((text) => isBlankPageText(text), () => false));
  const fromReading = () => readingTextContent(lines, page.getViewport({ scale: 1 }));

  page.getTextContent = async (params?: unknown) => ((await isBlank()) ? fromReading() : ownGet(params));
  page.streamTextContent = (params?: unknown) => new ReadableStream<unknown>({
    async start(controller) {
      try {
        if (await isBlank()) {
          controller.enqueue(fromReading());
        } else {
          const reader = ownStream(params).getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value);
          }
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });
}

/**
 * Give `pdfDoc`'s textless pages the reader's lines as their text. Call it
 * before the viewer and the find controller get the document. Returns how
 * many pages the reading has lines for (0: nothing to do, nothing changed).
 */
export function applyReadingTextLayer(pdfDoc: PDFDocumentProxy, reading: IDocumentReading | null | undefined): number {
  if (!reading) return 0;
  const byPage = new Map<number, IReadingPage>();
  for (const p of reading.pages) if (p.lines.length > 0) byPage.set(p.page, p);
  if (byPage.size === 0) return 0;

  const doc = pdfDoc as unknown as { getPage(n: number): Promise<PDFPageProxy> };
  const ownGetPage = doc.getPage.bind(pdfDoc);
  doc.getPage = async (n: number) => {
    const page = await ownGetPage(n);
    const lines = byPage.get(n);
    // pdf.js hands out the same page object every time, so it is patched once.
    if (lines) patchPage(page as unknown as PatchablePage, lines);
    return page;
  };
  return byPage.size;
}

/** The same, for the file a document was opened from: its kept reading is fetched first. */
export async function applyReadingTextLayerFor(pdfDoc: PDFDocumentProxy, fsPath: string | undefined): Promise<number> {
  return fsPath ? applyReadingTextLayer(pdfDoc, await fetchDocumentReading(fsPath)) : 0;
}
