// scanPageLinks.ts — a page made from a document, and the document, in step.
//
// Open As Page turns what the document reader read (a scan, a PDF, a photo
// of a page) into a page of the app. Every block of that page remembers where
// it came from: the document's page and its box there (its anchor). While the
// page is open, this module is what the two sides speak through:
//
// - the page says "this block" (the caret went into it, or it is at the top
//   of the view after a scroll), and the document's view shows that place;
// - the document's view says "this spot" (a press on it, or what is at the
//   top after a scroll), and the page shows the block made from it.
//
// It holds no DOM and knows neither side: the canvas registers the pages
// that are open (built-in/canvas/scanPage.ts), the PDF view hears what is
// said about its file (editor/panes/pdf/pdfScanPageLink.ts). Each side
// listens on its own view (presses, scrolls) only while such a page is open.

import { Emitter, type Event } from '../platform/events.js';
import type { IDisposable } from '../platform/lifecycle.js';

/** Where a block came from: the document's page, and its box there, [page, left, top, right, bottom], in the reading's units. */
export type ScanAnchor = readonly [page: number, left: number, top: number, right: number, bottom: number];

export interface IScanPageSource {
  readonly pageId: string;
  /** The document the page was made from, as a path on disk. */
  readonly fsPath: string;
  /** Block id to where the block came from. */
  readonly anchors: Readonly<Record<string, ScanAnchor>>;
  /** The size of each of the document's pages as the reader measured it: page number to [width, height]. */
  readonly pageSizes: Readonly<Record<string, readonly [number, number]>>;
}

/** How far down a view the line is that both sides keep in step when one scrolls: a quarter of its height. */
export const STEP_LINE = 0.25;

/** `show`: someone pointed (a press, the caret): light it up. `scroll`: the other side scrolled: follow quietly. */
export type ScanPointing = 'show' | 'scroll';

/** A place on the document for its view to go to. */
export interface IScanSpot {
  readonly fsPath: string;
  readonly page: number;
  /** [left, top, right, bottom] on that page, measured against pageWidth and pageHeight. */
  readonly box: readonly [number, number, number, number];
  readonly pageWidth: number;
  readonly pageHeight: number;
  readonly how: ScanPointing;
}

/** A block of a page for the page's view to go to. */
export interface IPageSpot { readonly pageId: string; readonly blockId: string; readonly how: ScanPointing }

const samePath = (a: string, b: string): boolean => a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase();

/** The block made from the spot (x, y) of a page of the document: the smallest anchor that holds it. */
export function blockAt(source: IScanPageSource, page: number, x: number, y: number): string | undefined {
  let best: { id: string; area: number } | undefined;
  for (const [id, a] of Object.entries(source.anchors)) {
    if (a[0] !== page || x < a[1] || x > a[3] || y < a[2] || y > a[4]) continue;
    const area = (a[3] - a[1]) * (a[4] - a[2]);
    if (!best || area < best.area) best = { id, area };
  }
  return best?.id;
}

/**
 * The block to keep in step with a document scrolled to `y` on `page`: the
 * one whose box holds that height, else the first one below it on the page,
 * else the last one above it. Undefined when the page gave the page nothing.
 */
export function blockNear(source: IScanPageSource, page: number, y: number): string | undefined {
  let holding: { id: string; top: number } | undefined;
  let below: { id: string; top: number } | undefined;
  let above: { id: string; bottom: number } | undefined;
  for (const [id, a] of Object.entries(source.anchors)) {
    if (a[0] !== page) continue;
    if (y >= a[2] && y <= a[4]) { if (!holding || a[2] > holding.top) holding = { id, top: a[2] }; }
    else if (a[2] > y) { if (!below || a[2] < below.top) below = { id, top: a[2] }; }
    else if (!above || a[4] > above.bottom) above = { id, bottom: a[4] };
  }
  return holding?.id ?? below?.id ?? above?.id;
}

export class ScanPageLinks {
  private readonly _open: IScanPageSource[] = [];
  private readonly _onDidChange = new Emitter<void>();
  /** A page made from a document was opened or closed, or one started or stopped being made. */
  readonly onDidChange: Event<void> = this._onDidChange.event;
  private readonly _onDidPointAtScan = new Emitter<IScanSpot>();
  /** The page pointed at a place on its document. */
  readonly onDidPointAtScan: Event<IScanSpot> = this._onDidPointAtScan.event;
  private readonly _onDidPointAtPage = new Emitter<IPageSpot>();
  /** The document's view pointed at a block of the page made from it. */
  readonly onDidPointAtPage: Event<IPageSpot> = this._onDidPointAtPage.event;

  private readonly _making = new Set<string>();

  /** A page is being made from this document (or has just been made): its view says so in place of offering to make one. */
  setMaking(fsPath: string, making: boolean): void {
    const key = fsPath.replace(/\\/g, '/').toLowerCase();
    if (making === this._making.has(key)) return;
    if (making) this._making.add(key); else this._making.delete(key);
    this._onDidChange.fire();
  }

  isMaking(fsPath: string | undefined): boolean {
    return !!fsPath && this._making.has(fsPath.replace(/\\/g, '/').toLowerCase());
  }

  /** A page made from a document is open. The returned handle says it has closed. */
  open(source: IScanPageSource): IDisposable {
    this._open.push(source);
    this._onDidChange.fire();
    return { dispose: () => { const at = this._open.indexOf(source); if (at >= 0) { this._open.splice(at, 1); this._onDidChange.fire(); } } };
  }

  /** The open page made from this document: the one opened last, when there are several. */
  forFile(fsPath: string | undefined): IScanPageSource | undefined {
    if (!fsPath) return undefined;
    for (let i = this._open.length - 1; i >= 0; i--) if (samePath(this._open[i].fsPath, fsPath)) return this._open[i];
    return undefined;
  }

  forPage(pageId: string): IScanPageSource | undefined {
    return this._open.find((s) => s.pageId === pageId);
  }

  /** The page points at where one of its blocks came from. False when the block came from nowhere. */
  pointFromPage(pageId: string, blockId: string, how: ScanPointing): boolean {
    const source = this.forPage(pageId);
    const anchor = source?.anchors[blockId];
    const size = anchor && source.pageSizes[String(anchor[0])];
    if (!source || !anchor || !size) return false;
    this._onDidPointAtScan.fire({ fsPath: source.fsPath, page: anchor[0], box: [anchor[1], anchor[2], anchor[3], anchor[4]], pageWidth: size[0], pageHeight: size[1], how });
    return true;
  }

  /**
   * The document's view points at a spot: (x, y) on `page`, in the reading's
   * units. A press (`show`) finds the block that holds the spot; a scroll
   * finds the block to keep in step with. Returns the spot on the document
   * that block came from, so the view can light up what was picked; undefined
   * when no block of the page was made from there.
   */
  pointFromScan(fsPath: string, page: number, x: number, y: number, how: ScanPointing): IScanSpot | undefined {
    const source = this.forFile(fsPath);
    if (!source) return undefined;
    const blockId = how === 'show' ? blockAt(source, page, x, y) : blockNear(source, page, y);
    const anchor = blockId ? source.anchors[blockId] : undefined;
    const size = anchor && source.pageSizes[String(anchor[0])];
    if (!blockId || !anchor || !size) return undefined;
    this._onDidPointAtPage.fire({ pageId: source.pageId, blockId, how });
    return { fsPath: source.fsPath, page: anchor[0], box: [anchor[1], anchor[2], anchor[3], anchor[4]], pageWidth: size[0], pageHeight: size[1], how };
  }
}

/** The one registry of the app. */
export const scanPageLinks = new ScanPageLinks();
