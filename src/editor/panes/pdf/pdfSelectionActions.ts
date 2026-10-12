// pdfSelectionActions.ts — where a PDF selection can go.
//
// To a canvas note as text or as a picture of the region, to the AI as a
// discussion on a new highlight, to the chat panel, or to a running tool's
// action through the selection-action dispatcher. A canvas capture anchors
// a highlight on the passage and the highlight keeps the link back.

import type { PdfHighlight, PdfHighlightCanvasLink } from './pdfHighlights.js';
import type { PdfHighlightStore } from './pdfHighlightStore.js';
import { selectionRectsOnLayer } from './pdfSelectionOverlay.js';
import type { IPaneCommandService } from './pdfTypes.js';

/** What the selection actions need from the pane. */
export interface PdfSelectionActionsHost {
  /** The open file: its name and path. */
  file(): { name: string; fsPath: string } | null;
  /** The page being read (1-based). */
  currentPage(): number | undefined;
  /** The selected text, as captured when the menu or bubble opened. */
  capturedText(): string;
  /** The viewer's scrolling container, where selection events bubble from. */
  viewerContainer(): HTMLElement | null;
  /** pdf.js's view of a page (1-based), for its canvas. */
  pageView(pageNumber: number): any | null;
  commands(): IPaneCommandService | undefined;
  readonly highlights: PdfHighlightStore;
}

type CanvasCaptureDetail = { text?: string; imageDataUrl?: string; fileName?: string; page?: number; sourceUri?: string };

export class PdfSelectionActions {
  constructor(private readonly _host: PdfSelectionActionsHost) {}

  /** Copy the selected text. */
  copy(): void {
    const text = this._host.capturedText();
    if (text) void navigator.clipboard.writeText(text);
  }

  /** Send the selected text to a canvas study note, with a link back to the page and quote. */
  captureNote(): void {
    const text = this._host.capturedText();
    const file = this._host.file();
    if (!text || !file) return;
    const page = this._host.currentPage();
    // The explorer deep link: parallx://explorer/file?path=…&page=…&quote=…
    const params = new URLSearchParams();
    params.set('path', file.fsPath);
    if (page) params.set('page', String(page));
    params.set('quote', text.slice(0, 120));
    const sourceUri = `parallx://explorer/file?${params.toString()}`;

    // A highlight on the passage gives the link a home.
    const anchors = this._host.highlights.createFromSelection();
    void this._captureToCanvas({ text, fileName: file.name, page, sourceUri }, anchors);
  }

  /**
   * Send a picture of the selected region to a canvas note.
   *
   * Selecting text in math-typeset PDFs yields the glyph codes, which for
   * formulas, tables and figures rarely map to meaningful Unicode (an
   * integral may be `R`, subscripts are only positioned glyphs). LaTeX
   * cannot be recovered from the text layer, so the selection's box is
   * cropped from the drawn page instead, faithful to what is on the page.
   */
  captureRegion(): void {
    const selection = globalThis.getSelection?.();
    const container = this._host.viewerContainer();
    const file = this._host.file();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0 || !container || !file) return;

    for (const textLayer of Array.from(container.querySelectorAll<HTMLElement>('.textLayer'))) {
      const merged = selectionRectsOnLayer(selection, textLayer);
      if (merged.length === 0) continue;

      const pageEl = textLayer.closest<HTMLElement>('.page');
      const pageNumber = pageEl ? parseInt(pageEl.dataset.pageNumber ?? '', 10) : NaN;
      if (!Number.isFinite(pageNumber)) continue;

      const canvas: HTMLCanvasElement | undefined = this._host.pageView(pageNumber)?.canvas;
      if (!canvas) continue;

      // The selection's boxes are in text-layer px and the canvas shares the
      // layer's box, so the spaces line up. A little padding keeps
      // descenders and superscripts.
      const pad = 4;
      const cssBox = canvas.getBoundingClientRect();
      const minLeft = Math.max(0, Math.min(...merged.map((r) => r.left)) - pad);
      const minTop = Math.max(0, Math.min(...merged.map((r) => r.top)) - pad);
      const maxRight = Math.min(cssBox.width, Math.max(...merged.map((r) => r.left + r.width)) + pad);
      const maxBottom = Math.min(cssBox.height, Math.max(...merged.map((r) => r.top + r.height)) + pad);
      const cropW = maxRight - minLeft;
      const cropH = maxBottom - minTop;
      if (cropW <= 1 || cropH <= 1) continue;

      // CSS px to the canvas's own pixels (more of them on a HiDPI screen).
      const sx = canvas.width / cssBox.width;
      const sy = canvas.height / cssBox.height;

      const out = document.createElement('canvas');
      out.width = Math.round(cropW * sx);
      out.height = Math.round(cropH * sy);
      const ctx = out.getContext('2d');
      if (!ctx) continue;
      ctx.drawImage(canvas, minLeft * sx, minTop * sy, cropW * sx, cropH * sy, 0, 0, out.width, out.height);

      let imageDataUrl: string;
      try {
        imageDataUrl = out.toDataURL('image/png');
      } catch (err) {
        console.warn('[PdfEditorPane] region capture toDataURL failed:', err);
        return;
      }

      const params = new URLSearchParams();
      params.set('path', file.fsPath);
      params.set('page', String(pageNumber));
      const sourceUri = `parallx://explorer/file?${params.toString()}`;

      const anchors = this._host.highlights.createFromSelection();
      void this._captureToCanvas({ imageDataUrl, fileName: file.name, page: pageNumber, sourceUri }, anchors);
      return; // one region per invocation
    }
  }

  /** Highlight the selection and open its review panel with the AI question focused. */
  askAI(): void {
    const sel = window.getSelection();
    const rect = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).getBoundingClientRect() : null;
    const hl = this._host.highlights.createFromSelection()[0];
    if (!hl) return;
    const anchorRect = rect && rect.width + rect.height > 0
      ? rect
      : new DOMRect(window.innerWidth / 2, window.innerHeight / 2, 0, 0);
    this._host.highlights.openPopover(hl, anchorRect, true);
  }

  /** Hand the selection to the selection-action dispatcher (Send to Chat, a tool's action). */
  dispatch(actionId: string): void {
    const text = this._host.capturedText();
    const file = this._host.file();
    if (!text || !file) return;
    this._fire({
      selectedText: text,
      surface: 'pdf',
      actionId,
      source: { fileName: file.name, filePath: file.fsPath, pageNumber: this._host.currentPage() },
    });
  }

  /**
   * Take a highlight's AI discussion to the chat panel: the passage as the
   * selection and the whole thread as context (as canvas inline AI's
   * "Send to Chat").
   */
  continueInChat(hl: PdfHighlight): void {
    const file = this._host.file();
    if (!file) return;
    const conversationContext = (hl.thread ?? [])
      .map((t) => `[${t.role === 'ai' ? 'assistant' : 'user'}]: ${t.text}`)
      .join('\n\n');
    this._fire({
      selectedText: hl.text || '(image selection)',
      surface: 'pdf',
      actionId: 'add-to-chat',
      conversationContext: conversationContext || undefined,
      source: { fileName: file.name, filePath: file.fsPath, pageNumber: hl.page },
    });
  }

  /** A bubbling event the workbench routes to the selection-action dispatcher. */
  private _fire(detail: Record<string, unknown>): void {
    this._host.viewerContainer()?.dispatchEvent(new CustomEvent('parallx-selection-action', { bubbles: true, detail }));
  }

  /**
   * Send the capture to a canvas page (`canvas.captureSelection`) and record
   * the page on the anchoring highlights, which become the link between the
   * two. Without the command service, a window event carries it instead.
   */
  private async _captureToCanvas(detail: CanvasCaptureDetail, anchors: PdfHighlight[]): Promise<void> {
    const commands = this._host.commands();
    let result: { pageId: string; title: string } | null = null;
    if (commands) {
      try {
        result = await commands.executeCommand<{ pageId: string; title: string } | null>('canvas.captureSelection', detail);
      } catch (err) {
        console.warn('[PdfEditorPane] canvas.captureSelection failed:', err);
      }
    } else {
      window.dispatchEvent(new CustomEvent('parallx:capture-to-canvas', { detail }));
    }
    if (!result) return;
    const link: PdfHighlightCanvasLink = { pageId: result.pageId, title: result.title, at: Date.now() };
    this._host.highlights.addCanvasLink(anchors, link);
  }
}
