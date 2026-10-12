// pdfThumbnails.ts — the Pages side of the PDF pane's side panel.
//
// One small canvas per page, drawn when it scrolls near view, and a mark on
// the page being read. The pane owns the panel (whether the Pages side shows)
// and hands this class the list element and what it needs from the document.

import type { PDFDocumentProxy } from 'pdfjs-dist';
import { $ } from '../../../ui/dom.js';

/** What the thumbnails need from the pane. */
export interface PdfThumbnailsHost {
  /** The open document, or null between documents. */
  document(): PDFDocumentProxy | null;
  /** The printed label of a page (1-based), when the document has labels. */
  pageLabel(pageNum: number): string | undefined;
  /** Show this page in the viewer. */
  goToPage(pageNum: number): void;
}

/** Drawn wider than shown, so a thumbnail stays crisp in a wide panel. */
const THUMB_DRAW_WIDTH = 200;

export class PdfThumbnails {
  private _observer: IntersectionObserver | null = null;
  private readonly _canvases = new Map<number, HTMLCanvasElement>();
  private _active: HTMLElement | null = null;

  constructor(
    private readonly _list: HTMLElement,
    private readonly _host: PdfThumbnailsHost,
  ) {}

  /** One placeholder per page; page 1 marked. Drawing waits for observe(). */
  build(numPages: number): void {
    this._list.replaceChildren();
    this._canvases.clear();

    for (let i = 1; i <= numPages; i++) {
      const item = $('div');
      item.classList.add('pdf-thumbnail-item');
      item.dataset.page = String(i);

      const canvas = document.createElement('canvas');
      canvas.classList.add('pdf-thumbnail-canvas');
      // Placeholder size until the page is drawn.
      canvas.width = 120;
      canvas.height = 160;
      item.appendChild(canvas);

      const label = $('span');
      label.classList.add('pdf-thumbnail-label');
      label.textContent = this._host.pageLabel(i) ?? String(i);
      item.appendChild(label);

      item.addEventListener('click', () => this._host.goToPage(i));

      this._list.appendChild(item);
      this._canvases.set(i, canvas);
    }

    this.markActive(1, false);
  }

  /** Draw each thumbnail once it comes within reach of the visible list. */
  observe(): void {
    this._observer?.disconnect();
    this._observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const item = entry.target as HTMLElement;
          const pageNum = parseInt(item.dataset.page ?? '0', 10);
          if (pageNum > 0 && !item.dataset.rendered) {
            item.dataset.rendered = '1';
            void this._render(pageNum);
          }
        }
      },
      { root: this._list, rootMargin: '200px' },
    );
    for (const item of this._list.querySelectorAll('.pdf-thumbnail-item')) {
      this._observer.observe(item);
    }
  }

  /** Mark the page being read; scroll it into the list when the list shows. */
  markActive(pageNum: number, scroll: boolean): void {
    this._active?.classList.remove('pdf-thumbnail-active');
    const target = this._list.querySelectorAll('.pdf-thumbnail-item')[pageNum - 1] as HTMLElement | undefined;
    if (!target) return;
    target.classList.add('pdf-thumbnail-active');
    this._active = target;
    if (scroll) target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  /** Bring the marked page into the list, as the panel opens on Pages. */
  revealActive(): void {
    this._active?.scrollIntoView({ block: 'nearest' });
  }

  /** Forget the document's thumbnails. */
  clear(): void {
    this._observer?.disconnect();
    this._observer = null;
    this._list.replaceChildren();
    this._canvases.clear();
    this._active = null;
  }

  private async _render(pageNum: number): Promise<void> {
    const doc = this._host.document();
    const canvas = this._canvases.get(pageNum);
    if (!doc || !canvas) return;

    try {
      const page = await doc.getPage(pageNum);
      const baseViewport = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: THUMB_DRAW_WIDTH / baseViewport.width });

      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      await page.render({ canvasContext: ctx, canvas, viewport }).promise;
    } catch {
      // A thumbnail that fails to draw keeps its placeholder.
    }
  }
}
