// pdfLinkReveal.ts — a link's page and quote, applied to the open PDF.
//
// A citation link opens a PDF at the spot it cites. The page comes first,
// then the quote is sent to pdf.js as a find, which washes the matching
// text. That is right for a sentence. A table or a figure is a block, not a
// line: a wash over a table sits on the numbers the reader came for, and a
// figure has no text to wash. So when the quote sits in a table, or is a
// figure's caption (readingLocate.ts places it by the document reader's
// reading), the block gets a thin frame with its name on it ("Table 3").
// The frame stays until the next press in the view.
//
// The same frame, with no name on it, shows where a block of a page made
// from this document came from (Open As Page; pdfScanPageLink.ts keeps the
// view and that page in step).
//
// pdf.js empties a page's element whenever it draws the page again (a zoom,
// a scroll back into view), so the frame is drawn again from renderPage.

import { createBlock } from '../../../ui/kit.js';
import type { IDisposable } from '../../../platform/lifecycle.js';
import type { PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs';
import { fetchDocumentReading } from '../../../services/documentReading.js';
import { locateCitedBlock } from '../../../services/readingLocate.js';
import type { IScanSpot } from '../../../services/scanPageLinks.js';
import { PdfScanPageLink } from './pdfScanPageLink.js';
import './pdfLinkReveal.css';

export interface IPdfLinkRevealHost {
  viewer(): PDFViewer | null;
  pageCount(): number;
  /** The file on screen, for its reading. */
  fsPath(): string | undefined;
  /** Find and wash these words in the document (the view's one queue of finds: pdfSearchBar.ts). */
  find(query: string): void;
  /** Show the page number in the toolbar. */
  showPage(page: number): void;
  /** pdf.js's view of a page, whose `div` holds what is drawn on it. */
  pageView(page: number): { div?: HTMLElement } | null;
  /** The scrolling element the pages are in. */
  viewerContainer(): HTMLElement | null;
}

const FRAME = 'pdf-cited-block';

/** What is framed: a box on a page, measured against that page's size. */
interface IFramed {
  readonly page: number;
  readonly box: readonly [number, number, number, number];
  readonly pageWidth: number;
  readonly pageHeight: number;
  /** Written on the frame's tag; no tag when empty. */
  readonly name: string;
  /** What a screen reader is told it is. */
  readonly label: string;
}

export class PdfLinkReveal implements IDisposable {
  private _framed: IFramed | null = null;
  /** Counts reveals, so a reading that arrives for an earlier one is dropped. */
  private _turn = 0;
  private _stopWatching: (() => void) | null = null;
  private readonly _pageLink: PdfScanPageLink;

  constructor(private readonly _host: IPdfLinkRevealHost) {
    this._pageLink = new PdfScanPageLink(_host, (spot) => this.showSpot(spot));
  }

  /**
   * Apply a link's `page` and `quote`. Both are optional and both are
   * checked: a link never breaks the view it opens.
   */
  apply(page: number | undefined, quote: string | undefined): void {
    const viewer = this._host.viewer();
    if (!viewer) return;
    this.clear();
    const onPage = typeof page === 'number' && page > 0 && page <= this._host.pageCount();
    if (onPage) {
      viewer.currentPageNumber = page;
      this._host.showPage(page);
    }
    const words = typeof quote === 'string' ? quote.replace(/\s+/g, ' ').trim() : '';
    if (!words) return;
    // pdf.js treats a run of white space as one space, so the collapsed text matches what a link encoded.
    this._host.find(words);
    void this._frame(onPage ? page : viewer.currentPageNumber, words);
  }

  /** Frame the table or figure the quote points at, if it points at one. */
  private async _frame(page: number, quote: string): Promise<void> {
    const turn = ++this._turn;
    const fsPath = this._host.fsPath();
    if (!fsPath) return;
    const cited = locateCitedBlock(await fetchDocumentReading(fsPath), page, quote);
    if (turn !== this._turn || !cited || this._host.fsPath() !== fsPath) return;
    this._show({ page: cited.page, box: cited.box, pageWidth: cited.pageWidth, pageHeight: cited.pageHeight, name: cited.name, label: `${cited.name}, the place this link points at` }, true);
  }

  /**
   * Frame a place on the document that a block of the page made from it came
   * from. The view goes there only when the place is not already in sight, so
   * moving through a page line by line does not make the document jump.
   */
  showSpot(spot: IScanSpot): void {
    this.clear();
    this._show({ page: spot.page, box: spot.box, pageWidth: spot.pageWidth, pageHeight: spot.pageHeight, name: '', label: 'Where this part of the page came from' }, false);
  }

  /** Draw the frame, bring it into view (`always`, or only when it is out of sight), and take it away at the next press in the view. */
  private _show(framed: IFramed, always: boolean): void {
    this._framed = framed;
    this.renderPage(framed.page);
    const container = this._host.viewerContainer();
    const frame = this._host.pageView(framed.page)?.div?.querySelector(`.${FRAME}`);
    if (frame && container) {
      const f = frame.getBoundingClientRect(), c = container.getBoundingClientRect();
      if (always || f.top < c.top || f.bottom > c.bottom) frame.scrollIntoView({ block: 'center' });
    }
    if (container) {
      const onPress = (): void => this.clear();
      container.addEventListener('pointerdown', onPress, { capture: true, once: true });
      this._stopWatching = () => container.removeEventListener('pointerdown', onPress, { capture: true });
    }
  }

  /** Draw the frame on `pageNumber` again, when that is the page it is on (pdf.js has just drawn the page). */
  renderPage(pageNumber: number): void {
    // A page was drawn: the view may now be showing a document a page was made from.
    this._pageLink.sync();
    const framed = this._framed;
    if (!framed || framed.page !== pageNumber) return;
    const pageEl = this._host.pageView(pageNumber)?.div;
    if (!pageEl) return;
    pageEl.querySelector(`.${FRAME}`)?.remove();
    // The reading measured the page as it is shown upright; a page the reader has turned is left without a frame.
    if (((this._host.viewer()?.pagesRotation ?? 0) % 360) !== 0) return;
    const [left, top, right, bottom] = framed.box;
    const frame = createBlock(pageEl, 'div', { className: FRAME, attrs: { role: 'note', 'aria-label': framed.label } });
    const pct = (v: number, of: number): string => `${Math.max(0, Math.min(100, (v / of) * 100))}%`;
    frame.style.left = pct(left, framed.pageWidth);
    frame.style.top = pct(top, framed.pageHeight);
    frame.style.width = pct(right - left, framed.pageWidth);
    frame.style.height = pct(bottom - top, framed.pageHeight);
    if (framed.name) createBlock(frame, 'span', { className: `${FRAME}__name`, text: framed.name });
  }

  /** Take the frame away: a press in the view, another link, another document. */
  clear(): void {
    this._turn++;
    this._stopWatching?.();
    this._stopWatching = null;
    const framed = this._framed;
    this._framed = null;
    if (framed) this._host.pageView(framed.page)?.div?.querySelector(`.${FRAME}`)?.remove();
  }

  dispose(): void {
    this.clear();
    this._pageLink.dispose();
  }
}
