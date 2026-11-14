// pdfScanPageLink.ts — the PDF view's half of a page made from its document.
//
// Open As Page makes a page of the app out of what the document reader read,
// and every block of that page remembers its place on the document
// (services/scanPageLinks.ts). While such a page is open, this keeps the PDF
// view in step with it:
//
// - the page points at a block (the caret went into it): the view goes to
//   where the block came from and frames it;
// - the page scrolls: the view brings the same place to the same height;
// - a press on the document (not a selection): the block made from that spot
//   is shown on the page, and framed here so it is plain what was picked;
// - the view scrolls: the page follows.
//
// It listens on the view itself (presses, scrolls) only while a page made
// from the open document is open. A scroll this side made to follow the page
// is not sent back, or the two would chase each other.

import { addDisposableListener } from '../../../ui/dom.js';
import { rafThrottle } from '../../../platform/rafThrottle.js';
import type { IDisposable } from '../../../platform/lifecycle.js';
import type { PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs';
import { scanPageLinks, STEP_LINE, type IScanSpot } from '../../../services/scanPageLinks.js';

export interface IPdfScanPageLinkHost {
  viewer(): PDFViewer | null;
  /** The file on screen. */
  fsPath(): string | undefined;
  /** pdf.js's view of a page, whose `div` holds what is drawn on it. */
  pageView(page: number): { div?: HTMLElement } | null;
  /** The scrolling element the pages are in. */
  viewerContainer(): HTMLElement | null;
}

/** A scroll made to follow the other side is this long in settling; scrolls within it are not sent back. */
const FOLLOW_MS = 400;

const samePath = (a: string | undefined, b: string | undefined): boolean => !!a && !!b && a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase();

export class PdfScanPageLink implements IDisposable {
  /** What listens on the view while a page made from the open document is open. */
  private _onView: IDisposable[] = [];
  private _container: HTMLElement | null = null;
  private readonly _onLinks: IDisposable[];
  private _following = 0;
  private readonly _scrolled = rafThrottle(() => this._onScroll());

  /** `frame` shows a spot of the document, framed (pdfLinkReveal.ts draws it). */
  constructor(private readonly _host: IPdfScanPageLinkHost, private readonly _frame: (spot: IScanSpot) => void) {
    this._onLinks = [
      scanPageLinks.onDidChange(() => this.sync()),
      scanPageLinks.onDidPointAtScan((spot) => this._onSpot(spot)),
    ];
  }

  /** Listen on the view when a page made from the open document is open, and stop when none is. */
  sync(): void {
    const container = scanPageLinks.forFile(this._host.fsPath()) ? this._host.viewerContainer() : null;
    if (container === this._container) return;
    for (const l of this._onView) l.dispose();
    this._onView = [];
    this._container = container;
    if (!container) return;
    this._onView = [
      addDisposableListener(container, 'click', (e) => this._onPress(e)),
      addDisposableListener(container, 'scroll', () => this._scrolled(), { passive: true }),
    ];
  }

  /** The spot of the document at a point of the window: its page and (x, y) there, in the reading's units. */
  private _spotAt(clientX: number, clientY: number, target?: Element | null): { page: number; x: number; y: number } | null {
    const source = scanPageLinks.forFile(this._host.fsPath());
    const container = this._container;
    // The reading measured the pages as they are shown upright: a turned view is left alone.
    if (!source || !container || ((this._host.viewer()?.pagesRotation ?? 0) % 360) !== 0) return null;
    const pageEl = (target ?? container.ownerDocument.elementFromPoint(clientX, clientY))?.closest<HTMLElement>('.page') ?? null;
    if (!pageEl || !container.contains(pageEl)) return null;
    const page = Number(pageEl.dataset.pageNumber);
    const size = source.pageSizes[String(page)];
    const rect = pageEl.getBoundingClientRect();
    if (!size || rect.width <= 0 || rect.height <= 0) return null;
    return { page, x: ((clientX - rect.left) / rect.width) * size[0], y: ((clientY - rect.top) / rect.height) * size[1] };
  }

  private _onPress(e: MouseEvent): void {
    const fsPath = this._host.fsPath();
    if (!fsPath || e.button !== 0 || !(e.target instanceof Element)) return;
    // Selecting text is not pointing at a block.
    if (e.target.ownerDocument.getSelection()?.isCollapsed === false) return;
    const at = this._spotAt(e.clientX, e.clientY, e.target);
    const spot = at ? scanPageLinks.pointFromScan(fsPath, at.page, at.x, at.y, 'show') : undefined;
    if (spot) this._frame(spot);
  }

  private _onScroll(): void {
    const fsPath = this._host.fsPath();
    const container = this._container;
    if (!fsPath || !container || Date.now() < this._following) return;
    const box = container.getBoundingClientRect();
    const at = this._spotAt(box.left + box.width / 2, box.top + box.height * STEP_LINE);
    if (at) scanPageLinks.pointFromScan(fsPath, at.page, at.x, at.y, 'scroll');
  }

  /** The page points at a place on this document. */
  private _onSpot(spot: IScanSpot): void {
    if (!samePath(spot.fsPath, this._host.fsPath())) return;
    this._following = Date.now() + FOLLOW_MS;
    if (spot.how === 'show') { this._frame(spot); return; }
    // The page scrolled: the same place comes to the same height, quietly.
    const container = this._host.viewerContainer();
    const pageEl = this._host.pageView(spot.page)?.div;
    if (!container || !pageEl) return;
    const rect = pageEl.getBoundingClientRect();
    const at = rect.top + (spot.box[1] / spot.pageHeight) * rect.height;
    const want = container.getBoundingClientRect().top + container.clientHeight * STEP_LINE;
    container.scrollTop += at - want;
  }

  dispose(): void {
    this._scrolled.dispose();
    for (const l of [...this._onView, ...this._onLinks]) l.dispose();
    this._onView = [];
    this._container = null;
  }
}
