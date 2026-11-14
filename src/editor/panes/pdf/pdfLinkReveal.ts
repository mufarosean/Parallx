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
// pdf.js empties a page's element whenever it draws the page again (a zoom,
// a scroll back into view), so the frame is drawn again from renderPage.

import { createBlock } from '../../../ui/kit.js';
import type { PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs';
import { fetchDocumentReading } from '../../../services/documentReading.js';
import { locateCitedBlock, type ICitedBlock } from '../../../services/readingLocate.js';
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

export class PdfLinkReveal {
  private _cited: ICitedBlock | null = null;
  /** Counts reveals, so a reading that arrives for an earlier one is dropped. */
  private _turn = 0;
  private _stopWatching: (() => void) | null = null;

  constructor(private readonly _host: IPdfLinkRevealHost) {}

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
    this._cited = cited;
    this.renderPage(cited.page);
    this._host.pageView(cited.page)?.div?.querySelector(`.${FRAME}`)?.scrollIntoView({ block: 'center' });
    // It stays until the next press anywhere in the view.
    const container = this._host.viewerContainer();
    if (container) {
      const onPress = (): void => this.clear();
      container.addEventListener('pointerdown', onPress, { capture: true, once: true });
      this._stopWatching = () => container.removeEventListener('pointerdown', onPress, { capture: true });
    }
  }

  /** Draw the frame on `pageNumber` again, when that is the page it is on (pdf.js has just drawn the page). */
  renderPage(pageNumber: number): void {
    const cited = this._cited;
    if (!cited || cited.page !== pageNumber) return;
    const pageEl = this._host.pageView(pageNumber)?.div;
    if (!pageEl) return;
    pageEl.querySelector(`.${FRAME}`)?.remove();
    // The reading measured the page as it is shown upright; a page the reader has turned is left without a frame.
    if (((this._host.viewer()?.pagesRotation ?? 0) % 360) !== 0) return;
    const [left, top, right, bottom] = cited.box;
    const frame = createBlock(pageEl, 'div', { className: FRAME, attrs: { role: 'note', 'aria-label': `${cited.name}, the place this link points at` } });
    const pct = (v: number, of: number): string => `${Math.max(0, Math.min(100, (v / of) * 100))}%`;
    frame.style.left = pct(left, cited.pageWidth);
    frame.style.top = pct(top, cited.pageHeight);
    frame.style.width = pct(right - left, cited.pageWidth);
    frame.style.height = pct(bottom - top, cited.pageHeight);
    createBlock(frame, 'span', { className: `${FRAME}__name`, text: cited.name });
  }

  /** Take the frame away: a press in the view, another link, another document. */
  clear(): void {
    this._turn++;
    this._stopWatching?.();
    this._stopWatching = null;
    const cited = this._cited;
    this._cited = null;
    if (cited) this._host.pageView(cited.page)?.div?.querySelector(`.${FRAME}`)?.remove();
  }
}
