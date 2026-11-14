// pagePicture.ts — a piece of a page as a picture: the place a quote is on.
//
// A citation carries the words it rests on. To judge it without opening the
// file, the chat shows the piece of the page those words are on. This module
// makes that piece:
//
// - It finds where the quote is: on a page read from its pixels, the lines
//   the document reader found it on (readingLocate.ts); on a page with text
//   of its own, the text items pdf.js reports. When the quote sits in a
//   table or is a figure's caption, the table or the figure is the piece.
// - It sizes the piece to be read: a line of the page is shown about as tall
//   as a line of the chat, as far as the room allows. A table too tall for
//   the room is shown as its heading rows and the rows the quote is in, so a
//   number keeps the column it belongs to.
// - It draws only that piece of the page with pdf.js (or cuts it from the
//   picture, for a photo of a page) and washes the quote in the colour a
//   found quote has in the PDF and image views.
//
// No model is asked where anything is. A quote that is not found on the
// page gives no picture, and the caller says where in words instead.
//
// A document opened for a piece is kept for a short while, so pointing at
// one citation after another of the same file does not load it again.

import { createBlock } from '../ui/kit.js';
import { loadPdfjs } from '../vendor/lazy.js';
import { fetchDocumentReading, type IDocumentReading, type ReadingBox } from './documentReading.js';
import { locateCitedBlock, locateQuoteLines } from './readingLocate.js';
import { quoteSkeleton } from './quoteLocator.js';
import { isPicturePath } from './readerPolicy.js';

/** Where pdf.js's own files are, from the app's page (the PDF view uses the same). */
export const PDFJS_CMAP_URL = './dist/renderer/pdfjs/cmaps/';
export const PDFJS_STANDARD_FONT_URL = './dist/renderer/pdfjs/standard_fonts/';
export const PDFJS_WASM_URL = './dist/renderer/pdfjs/wasm/';

export interface IRect { readonly x: number; readonly y: number; readonly w: number; readonly h: number }

/** One picture of a piece, with the size it is to be shown at. It holds more pixels than that, for a sharp screen. */
export interface IPagePicture { readonly url: string; readonly width: number; readonly height: number }

export interface IPagePiece {
  /**
   * The piece, top to bottom. One picture; or two when a table is too tall
   * to show whole: its heading, then the rows the quote is in.
   */
  readonly parts: readonly IPagePicture[];
  /** What it shows: the quote's lines, or the table or figure the quote sits in. */
  readonly what: 'lines' | 'table' | 'figure';
  /** The table's or figure's own name ("Table 3"), when it has one. */
  readonly name?: string;
}

/** The room a piece has, in the pixels it is shown at. */
export interface IPieceLimits { readonly maxWidth: number; readonly maxHeight: number }
export const DEFAULT_PIECE_LIMITS: IPieceLimits = { maxWidth: 540, maxHeight: 420 };

/** A text item as pdf.js reports it (the part used here). */
export interface ITextItem { readonly str?: string; readonly transform?: readonly number[]; readonly width?: number; readonly height?: number }

// ── Where the quote is, and what to show of the page ──

const rectOf = (b: ReadingBox, kx = 1, ky = 1): IRect => ({ x: b[0] * kx, y: b[1] * ky, w: (b[2] - b[0]) * kx, h: (b[3] - b[1]) * ky });
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/**
 * The text items of a page that hold the quote, as rectangles on the page
 * as it is shown. `toView` turns a point of the page's own space into one of
 * the shown page (pdf.js's viewport.convertToViewportPoint).
 */
export function quoteItemRects(items: readonly ITextItem[], quote: string, toView: (x: number, y: number) => readonly number[]): IRect[] {
  const needle = quoteSkeleton(quote);
  if (needle.length < 4) return [];
  const skeletons = items.map((i) => quoteSkeleton(i.str ?? ''));
  const at = skeletons.join('').indexOf(needle);
  if (at < 0) return [];
  const out: IRect[] = [];
  let offset = 0;
  for (let i = 0; i < items.length; i++) {
    const end = offset + skeletons[i].length;
    const t = items[i].transform;
    if (skeletons[i].length > 0 && end > at && offset < at + needle.length && t && t.length >= 6) {
      const height = items[i].height || Math.hypot(t[2], t[3]);
      // From a little under the baseline (descenders) to the top of the line.
      const [x1, y1] = toView(t[4], t[5] - height * 0.25);
      const [x2, y2] = toView(t[4] + (items[i].width ?? 0), t[5] + height);
      const rect = { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
      if (rect.w > 0 && rect.h > 0) out.push(rect);
    }
    offset = end;
  }
  return out;
}

/** The least of a page's width a piece of lines takes: enough to read as part of a page. */
const PIECE_MIN_SHARE = 0.55;
/** Lines of the page shown above and below the quote. */
const PIECE_LINES_ROUND = 2.4;

/**
 * The piece of a page to show: the block the quote sits in, or the quote's
 * lines with a little of the page round them. Null when there is nothing to
 * show (the quote was not found, and it sits in no block).
 */
export function pieceRegion(page: { readonly width: number; readonly height: number }, marks: readonly IRect[], block?: IRect): IRect | null {
  if (block) {
    const pad = page.width * 0.02;
    const x = clamp(block.x - pad, 0, page.width), y = clamp(block.y - pad, 0, page.height);
    return { x, y, w: clamp(block.x + block.w + pad, 0, page.width) - x, h: clamp(block.y + block.h + pad, 0, page.height) - y };
  }
  if (marks.length === 0) return null;
  const left = Math.min(...marks.map((m) => m.x)), right = Math.max(...marks.map((m) => m.x + m.w));
  const top = Math.min(...marks.map((m) => m.y)), bottom = Math.max(...marks.map((m) => m.y + m.h));
  const line = Math.max(...marks.map((m) => m.h));
  const w = Math.min(page.width, Math.max(right - left + 2 * line, page.width * PIECE_MIN_SHARE));
  const x = clamp((left + right) / 2 - w / 2, 0, page.width - w);
  const y = Math.max(0, top - line * PIECE_LINES_ROUND);
  return { x, y, w, h: Math.min(page.height, bottom + line * PIECE_LINES_ROUND) - y };
}

/** A table's heading takes this much of the room at most; the rows the quote is in take the rest. */
const HEAD_SHARE = 0.4;

/**
 * The parts of a piece to show when it is taller than the room (`maxHeight`,
 * in the page's units): a table's heading, down to `headBottom`, and the
 * rows round the quote. One part when the piece fits, when the quote sits
 * right under the heading, or when there is no heading to keep. A cut falls
 * between two rows (`edges`: where the rows part) and never through one.
 */
export function pieceBands(region: IRect, marks: readonly IRect[], maxHeight: number, headBottom?: number, edges: readonly number[] = []): IRect[] {
  if (region.h <= maxHeight) return [region];
  const bottom = region.y + region.h;
  const band = (y: number, end: number): IRect => ({ x: region.x, y, w: region.w, h: end - y });
  /** The last place rows part at or above `y`, no higher than `least`; `y` itself when there is none. */
  const partAbove = (y: number, least: number): number => { const at = edges.filter((e) => e <= y && e >= least); return at.length > 0 ? Math.max(...at) : y; };
  /** The first place rows part at or below `y`, no lower than `most`. */
  const partBelow = (y: number, most: number): number => { const at = edges.filter((e) => e >= y && e <= most); return at.length > 0 ? Math.min(...at) : y; };
  // Nothing to centre on: the top of it.
  if (marks.length === 0) return [band(region.y, partAbove(region.y + maxHeight, region.y + maxHeight / 2))];
  const line = Math.max(...marks.map((m) => m.h));
  const top = Math.min(...marks.map((m) => m.y)), end = Math.max(...marks.map((m) => m.y + m.h));
  const head = headBottom !== undefined && headBottom > region.y
    ? (headBottom - region.y <= maxHeight * HEAD_SHARE ? headBottom : partAbove(region.y + maxHeight * HEAD_SHARE, region.y + line)) - region.y
    : 0;
  const room = maxHeight - head;
  const y = clamp((top + end) / 2 - room / 2, region.y + head, bottom - room);
  /** Where a part that would run to `to` ends: at the piece's own end, or between two rows under the quote. */
  const ending = (to: number): number => (to >= bottom - 0.5 ? bottom : partAbove(to, end));
  // The rows start where the heading ends (or there is no heading to keep): one part.
  if (head === 0) return [band(y <= region.y + 0.5 ? region.y : partBelow(y, top), ending(y + maxHeight))];
  if (y - (region.y + head) < line) return [band(region.y, ending(region.y + maxHeight))];
  return [band(region.y, region.y + head), band(partBelow(y, top), ending(y + room))];
}

/**
 * A line of the page is shown this tall: about a line of the chat's own
 * text. (A line's box is taller than its letters: about 1.25 times the font
 * for a page's own text, more for a line read from pixels.)
 */
const LINE_SHOWN_PX = 18;

export interface IPiecePlan {
  /** Shown pixels to one unit of the page. */
  readonly scale: number;
  /** The parts to draw, top to bottom, in the page's units. */
  readonly bands: readonly IRect[];
}

/**
 * What to draw of a page, and how large. The quote's line decides the size
 * (text is shown to be read), the room decides the most. A figure is shown
 * whole; a table or a run of lines too tall for the room is cut (pieceBands).
 */
export function planPiece(
  page: { readonly width: number; readonly height: number },
  marks: readonly IRect[],
  limits: IPieceLimits,
  block?: { readonly kind: 'table' | 'figure'; readonly box: IRect; readonly headBottom?: number; readonly rowEdges?: readonly number[] },
): IPiecePlan | null {
  const region = pieceRegion(page, marks, block?.box);
  if (!region || region.w <= 0 || region.h <= 0) return null;
  const line = marks.length > 0 ? Math.max(...marks.map((m) => m.h)) : 0;
  // With no line to go by, a page is never shown larger than twice the room's width.
  const most = (2 * limits.maxWidth) / page.width;
  let scale = Math.min(limits.maxWidth / region.w, most, line > 0 ? LINE_SHOWN_PX / line : most);
  if (block?.kind === 'figure') scale = Math.min(scale, limits.maxHeight / region.h);
  return { scale, bands: block?.kind === 'figure' ? [region] : pieceBands(region, marks, limits.maxHeight / scale, block?.headBottom, block?.rowEdges) };
}

// ── Drawing ──

/** A piece holds this many pixels for each pixel it is shown at. */
const DENSITY = 2;
/** An opened document is let go this long after it was last used. */
const DOCUMENT_IDLE_MS = 45_000;
const MAX_KEPT_PIECES = 40;

type PdfDocument = { numPages: number; getPage(n: number): Promise<PdfPage>; destroy(): Promise<void> };
type PdfViewport = { width: number; height: number; convertToViewportPoint(x: number, y: number): number[] };
type PdfPage = { getViewport(o: { scale: number }): PdfViewport; getTextContent(): Promise<{ items: unknown[] }>; render(o: unknown): { promise: Promise<void> } };

const canvasOf = (width: number, height: number): HTMLCanvasElement => {
  const canvas = createBlock(null, 'canvas') as HTMLCanvasElement;
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
};

/** The colour a found quote has in the PDF and image views (the theme's yellow), for a canvas. */
function washColour(): string {
  const rgb = getComputedStyle(document.documentElement).getPropertyValue('--px-yellow-rgb').trim();
  return rgb ? `rgba(${rgb}, 0.5)` : 'rgba(255, 200, 0, 0.5)';
}

/** Wash the quote on a drawn band and hand the picture out. `k` is the canvas's pixels to a unit of the page. */
function finish(canvas: HTMLCanvasElement, band: IRect, marks: readonly IRect[], k: number, scale: number): IPagePicture | null {
  const g = canvas.getContext('2d');
  if (!g) return null;
  g.setTransform(1, 0, 0, 1, 0, 0);
  // Multiplied in, the wash tints the paper and leaves the ink dark.
  g.globalCompositeOperation = 'multiply';
  g.fillStyle = washColour();
  for (const m of marks) g.fillRect((m.x - band.x) * k - 2, (m.y - band.y) * k - 2, m.w * k + 4, m.h * k + 4);
  return { url: canvas.toDataURL('image/jpeg', 0.88), width: Math.round(band.w * scale), height: Math.round(band.h * scale) };
}

async function fileBytes(fsPath: string): Promise<{ bytes: Uint8Array; base64: string } | null> {
  const fs = (globalThis as { parallxElectron?: { fs?: { readFile?: (p: string) => Promise<{ content?: string; encoding?: string; error?: unknown }> } } }).parallxElectron?.fs;
  if (!fs?.readFile) return null;
  const result = await fs.readFile(fsPath);
  if (!result || result.error || result.encoding !== 'base64' || !result.content) return null;
  const bin = atob(result.content);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, base64: result.content };
}

const _documents = new Map<string, { doc: Promise<PdfDocument | null>; timer: ReturnType<typeof setTimeout> | null }>();

/** The document at `fsPath`, opened once and kept while it is in use. */
function pdfDocument(fsPath: string): Promise<PdfDocument | null> {
  let kept = _documents.get(fsPath);
  if (!kept) {
    const doc = (async (): Promise<PdfDocument | null> => {
      const file = await fileBytes(fsPath);
      if (!file) return null;
      const { pdfjsLib } = await loadPdfjs();
      return await pdfjsLib.getDocument({ data: file.bytes, cMapUrl: PDFJS_CMAP_URL, cMapPacked: true, standardFontDataUrl: PDFJS_STANDARD_FONT_URL, wasmUrl: PDFJS_WASM_URL }).promise as unknown as PdfDocument;
    })().catch(() => null);
    kept = { doc, timer: null };
    _documents.set(fsPath, kept);
  }
  if (kept.timer) clearTimeout(kept.timer);
  const mine = kept;
  kept.timer = setTimeout(() => {
    if (_documents.get(fsPath) === mine) _documents.delete(fsPath);
    void mine.doc.then((d) => d?.destroy()).catch(() => { /* already gone */ });
  }, DOCUMENT_IDLE_MS);
  return kept.doc;
}

/** The table or figure a quote sits in, in the units of the page as it is drawn. */
function citedBlock(reading: IDocumentReading | null, page: number, quote: string, kx: number, ky: number): { kind: 'table' | 'figure'; box: IRect; headBottom?: number; rowEdges?: number[]; name: string } | undefined {
  const cited = locateCitedBlock(reading, page, quote);
  if (!cited) return undefined;
  return {
    kind: cited.kind, name: cited.name, box: rectOf(cited.box, kx, ky),
    ...(cited.headBottom === undefined ? {} : { headBottom: cited.headBottom * ky }),
    ...(cited.rowEdges ? { rowEdges: cited.rowEdges.map((e) => e * ky) } : {}),
  };
}

async function pieceOfPdfPage(fsPath: string, pageNumber: number | undefined, quote: string, limits: IPieceLimits): Promise<IPagePiece | null> {
  const doc = await pdfDocument(fsPath);
  if (!doc) return null;
  const n = pageNumber && pageNumber >= 1 && pageNumber <= doc.numPages ? pageNumber : 1;
  const page = await doc.getPage(n);
  const view = page.getViewport({ scale: 1 });
  const reading = await fetchDocumentReading(fsPath);
  const sheet = reading?.pages.find((p) => p.page === n);
  // The reading measured the page as it is shown; its units become the shown page's.
  const kx = sheet ? view.width / sheet.width : 1, ky = sheet ? view.height / sheet.height : 1;
  let marks = locateQuoteLines(sheet, quote).map((b) => rectOf(b, kx, ky));
  if (marks.length === 0) {
    const content = await page.getTextContent();
    marks = quoteItemRects(content.items as ITextItem[], quote, (x, y) => view.convertToViewportPoint(x, y));
  }
  const block = citedBlock(reading, n, quote, kx, ky);
  const plan = planPiece(view, marks, limits, block);
  if (!plan) return null;
  const k = plan.scale * DENSITY;
  const viewport = page.getViewport({ scale: k });
  const parts: IPagePicture[] = [];
  for (const band of plan.bands) {
    // Only the band is drawn: the page is moved so the band's corner is the canvas's.
    const canvas = canvasOf(band.w * k, band.h * k);
    const g = canvas.getContext('2d');
    if (!g) return null;
    await page.render({ canvasContext: g, canvas, viewport, transform: [1, 0, 0, 1, -band.x * k, -band.y * k] }).promise;
    const part = finish(canvas, band, marks, k, plan.scale);
    if (!part) return null;
    parts.push(part);
  }
  return { parts, what: block?.kind ?? 'lines', ...(block ? { name: block.name } : {}) };
}

async function pieceOfPicture(fsPath: string, quote: string, limits: IPieceLimits): Promise<IPagePiece | null> {
  const reading = await fetchDocumentReading(fsPath);
  const sheet = reading?.pages[0];
  if (!sheet) return null;
  const boxes = locateQuoteLines(sheet, quote);
  const cited = locateCitedBlock(reading, sheet.page, quote);
  if (boxes.length === 0 && !cited) return null;
  const file = await fileBytes(fsPath);
  if (!file) return null;
  const image = new Image();
  const mime = /\.png$/i.test(fsPath) ? 'image/png' : /\.webp$/i.test(fsPath) ? 'image/webp' : /\.gif$/i.test(fsPath) ? 'image/gif' : 'image/jpeg';
  image.src = `data:${mime};base64,${file.base64}`;
  await image.decode();
  // The reading's units are the picture's own pixels, or a fixed share of them.
  const kx = image.naturalWidth / sheet.width, ky = image.naturalHeight / sheet.height;
  const marks = boxes.map((b) => rectOf(b, kx, ky));
  const block = citedBlock(reading, sheet.page, quote, kx, ky);
  const plan = planPiece({ width: image.naturalWidth, height: image.naturalHeight }, marks, limits, block);
  if (!plan) return null;
  // Cut from the picture's own pixels: never more of them than it has.
  const k = Math.min(1, plan.scale * DENSITY);
  const parts: IPagePicture[] = [];
  for (const band of plan.bands) {
    const canvas = canvasOf(band.w * k, band.h * k);
    const g = canvas.getContext('2d');
    if (!g) return null;
    g.imageSmoothingQuality = 'high';
    g.drawImage(image, band.x, band.y, band.w, band.h, 0, 0, canvas.width, canvas.height);
    const part = finish(canvas, band, marks, k, plan.scale);
    if (!part) return null;
    parts.push(part);
  }
  return { parts, what: block?.kind ?? 'lines', ...(block ? { name: block.name } : {}) };
}

const _pieces = new Map<string, Promise<IPagePiece | null>>();

/**
 * The piece of the page a link's quote is on: for a PDF (its `page`, or its
 * first) or a picture of a page. Null when the file is neither, there is no
 * quote, or the quote is not found on the page.
 */
export function pieceOfPage(fsPath: string, target: { readonly page?: number; readonly quote?: string }, limits: IPieceLimits = DEFAULT_PIECE_LIMITS): Promise<IPagePiece | null> {
  const quote = target.quote?.replace(/\s+/g, ' ').trim() ?? '';
  const pdf = /\.pdf$/i.test(fsPath);
  if (!quote || (!pdf && !isPicturePath(fsPath))) return Promise.resolve(null);
  const key = `${fsPath}\n${target.page ?? ''}\n${quote}\n${Math.round(limits.maxWidth)}x${Math.round(limits.maxHeight)}`;
  let piece = _pieces.get(key);
  if (!piece) {
    const made = (pdf ? pieceOfPdfPage(fsPath, target.page, quote, limits) : pieceOfPicture(fsPath, quote, limits)).catch((err) => {
      console.warn('[PagePicture] No piece could be made for', fsPath, err);
      return null;
    });
    piece = made;
    _pieces.set(key, made);
    // Only a piece that was made is kept: a file that could not be read yet is tried again the next time.
    void made.then((p) => { if (!p && _pieces.get(key) === made) _pieces.delete(key); });
    while (_pieces.size > MAX_KEPT_PIECES) { const oldest = _pieces.keys().next().value; if (oldest === undefined) break; _pieces.delete(oldest); }
  }
  return piece;
}
