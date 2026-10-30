// pdfHighlightStore.ts — a PDF's highlights and margin notes.
//
// Highlights are made from the text selection (one per page it spans),
// drawn as boxes over the page with a tab in the margin that opens the
// review panel, saved per file in global storage, and undone and redone
// with Ctrl+Z / Ctrl+Shift+Z. The pane hands this class what it reads from
// the viewer and the selection.

import type { IStorage } from '../../../platform/storage.js';
import { ICON } from './pdfIcons.js';
import { highlightRgba, rectsOverlap, cloneHighlight } from './pdfHighlights.js';
import type { PdfHighlight, PdfHighlightAction, PdfHighlightCanvasLink, PdfHighlightRect } from './pdfHighlights.js';
import { openHighlightPopover, type HighlightPopover } from './pdfHighlightPopover.js';
import type { InlineAIProvider, IPaneCommandService, SelectionOverlayRect } from './pdfTypes.js';
import type { PassageContext } from './pdfPassagePrompt.js';

/** What the highlights need from the pane. */
export interface PdfHighlightStoreHost {
  storage(): IStorage | undefined;
  commands(): IPaneCommandService | undefined;
  /** The viewer's scrolling container, or null before it exists. */
  viewerContainer(): HTMLElement | null;
  /** pdf.js's view of a page (1-based): its div, viewport and canvas. */
  pageView(pageNumber: number): any | null;
  /** The selection's boxes on one text layer, merged, in layer-local px. */
  selectionRects(selection: Selection, textLayer: HTMLElement): SelectionOverlayRect[];
  /** The selected text, as captured when the menu or bubble opened. */
  capturedText(): string;
  clearSelectionOverlay(): void;
  /** Take a highlight and its discussion to the chat panel. */
  continueInChat(hl: PdfHighlight): void;
  /** The open file and one page's text, for a question about a passage on it. */
  pageSource(pageNumber: number): Promise<{ fileName?: string; filePath?: string; pageCount?: number; pageText?: string }>;
}

const SAVE_DELAY_MS = 300;

export class PdfHighlightStore {
  private _highlights: PdfHighlight[] = [];
  private _color = 'yellow';
  private _fileKey = '';
  private _saveTimer: ReturnType<typeof setTimeout> | null = null;
  private _popover: HighlightPopover | null = null;
  // Each entry holds the action and a deep copy of the highlights it touched,
  // so it replays in either direction; one selection across pages makes
  // several highlights in one entry.
  private _undoStack: PdfHighlightAction[] = [];
  private _redoStack: PdfHighlightAction[] = [];
  private _inlineAI: InlineAIProvider | null = null;
  private _inlineAILoaded = false;
  private _aiAbort: AbortController | null = null;

  constructor(private readonly _host: PdfHighlightStoreHost) {}

  /** The colour last used, which the next highlight takes. */
  get color(): string {
    return this._color;
  }

  /** Read a file's highlights. Undo starts empty for each document. */
  async load(fileKey: string): Promise<void> {
    this._highlights = [];
    this._undoStack = [];
    this._redoStack = [];
    this._fileKey = fileKey;
    const storage = this._host.storage();
    if (!storage || !fileKey) return;
    try {
      const raw = await storage.get(this._storageKey());
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) this._highlights = parsed as PdfHighlight[];
      }
    } catch (err) {
      console.warn('[PdfEditorPane] Failed to load highlights:', err);
    }
  }

  /** The document closes: write a pending save now, then forget it all. */
  close(): void {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
      const storage = this._host.storage();
      if (storage && this._fileKey) void storage.set(this._storageKey(), JSON.stringify(this._highlights));
    }
    this._host.viewerContainer()?.querySelectorAll('.pdf-highlight-layer').forEach((n) => n.remove());
    this.dismissPopover();
    this._highlights = [];
    this._fileKey = '';
  }

  /**
   * Highlight the live text selection, one highlight per page it spans.
   * Highlights do not stack: re-highlighting an overlapping passage in the
   * same colour removes it, in another colour recolours it.
   */
  createFromSelection(colorKey: string = this._color): PdfHighlight[] {
    const selection = globalThis.getSelection?.();
    const container = this._host.viewerContainer();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0 || !container) return [];
    this._color = colorKey;

    const created: PdfHighlight[] = [];
    const removed: PdfHighlight[] = [];
    for (const textLayer of Array.from(container.querySelectorAll<HTMLElement>('.textLayer'))) {
      const pageEl = textLayer.closest<HTMLElement>('.page');
      const pageNumber = pageEl ? parseInt(pageEl.dataset.pageNumber ?? '', 10) : NaN;
      if (!Number.isFinite(pageNumber)) continue;

      const merged = this._host.selectionRects(selection, textLayer);
      if (merged.length === 0) continue;

      const viewport = this._host.pageView(pageNumber)?.viewport;
      if (!viewport?.convertToPdfPoint) continue;

      const pdfRects: PdfHighlightRect[] = merged.map((r) => {
        const [x1, y1] = viewport.convertToPdfPoint(r.left, r.top);
        const [x2, y2] = viewport.convertToPdfPoint(r.left + r.width, r.top + r.height);
        return { x1, y1, x2, y2 };
      });

      const existing = this._highlights.find((h) => h.page === pageNumber && rectsOverlap(h.rects, pdfRects));
      if (existing) {
        removed.push(existing);
        if (existing.color === colorKey) continue; // toggle off: nothing new
      }

      created.push({
        id: `hl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        page: pageNumber,
        color: colorKey,
        rects: pdfRects,
        text: this._host.capturedText(),
        note: existing?.note ?? '',
        thread: existing?.thread,
        canvasLinks: existing?.canvasLinks,
        createdAt: existing?.createdAt ?? Date.now(),
      });
    }

    // Removals first (toggle-off), then additions.
    if (removed.length > 0) {
      const removedIds = new Set(removed.map((h) => h.id));
      this._highlights = this._highlights.filter((h) => !removedIds.has(h.id));
      this._pushUndo({ kind: 'delete', highlights: removed });
    }
    if (created.length > 0) {
      this._highlights.push(...created);
      this._pushUndo({ kind: 'create', highlights: created });
    }

    if (removed.length === 0 && created.length === 0) return [];
    this._save();
    selection.removeAllRanges();
    this._host.clearSelectionOverlay();
    for (const page of new Set([...created, ...removed].map((h) => h.page))) this.renderPage(page);
    return created;
  }

  /** The passage was sent to a canvas page: the highlights link to it. */
  addCanvasLink(anchors: PdfHighlight[], link: PdfHighlightCanvasLink): void {
    if (anchors.length === 0) return;
    for (const hl of anchors) (hl.canvasLinks ??= []).push(link);
    this._save();
    for (const page of new Set(anchors.map((h) => h.page))) this.renderPage(page);
  }

  /** Draw every page that has highlights (after a zoom, rotation or relayout). */
  renderAll(): void {
    if (!this._host.viewerContainer()) return;
    for (const page of new Set(this._highlights.map((h) => h.page))) this.renderPage(page);
  }

  /** Draw a page's highlight boxes and margin tabs, replacing the last drawing. */
  renderPage(pageNumber: number): void {
    const pageView = this._host.pageView(pageNumber);
    const pageEl: HTMLElement | undefined = pageView?.div;
    const viewport = pageView?.viewport;
    if (!pageEl || !viewport?.convertToViewportPoint) return;

    pageEl.querySelector('.pdf-highlight-layer')?.remove();
    pageEl.querySelectorAll('.pdf-highlight-tab').forEach((n) => n.remove());

    const pageHighlights = this._highlights.filter((h) => h.page === pageNumber);
    if (pageHighlights.length === 0) return;

    const layer = document.createElement('div');
    layer.classList.add('pdf-highlight-layer');

    // Tabs go on the page itself, beside the box layer, not inside it: the
    // layer ignores the pointer, and the tabs must take clicks.
    const tabs: HTMLButtonElement[] = [];

    for (const hl of pageHighlights) {
      let firstBox: { left: number; top: number } | null = null;
      for (const r of hl.rects) {
        const [vx1, vy1] = viewport.convertToViewportPoint(r.x1, r.y1);
        const [vx2, vy2] = viewport.convertToViewportPoint(r.x2, r.y2);
        const left = Math.min(vx1, vx2);
        const top = Math.min(vy1, vy2);
        const box = document.createElement('div');
        box.classList.add('pdf-highlight-box');
        box.style.left = `${left}px`;
        box.style.top = `${top}px`;
        box.style.width = `${Math.abs(vx2 - vx1)}px`;
        box.style.height = `${Math.abs(vy2 - vy1)}px`;
        box.style.backgroundColor = highlightRgba(hl.color);
        layer.appendChild(box);
        if (!firstBox) firstBox = { left, top };
      }

      if (firstBox) {
        const hasThread = (hl.thread?.length ?? 0) > 0;
        const hasCanvas = (hl.canvasLinks?.length ?? 0) > 0;
        const tab = document.createElement('button');
        tab.classList.add('pdf-highlight-tab');
        if (hl.note) tab.classList.add('has-note');
        if (hasThread) tab.classList.add('has-discussion');
        if (hasCanvas) tab.classList.add('has-canvas-link');
        // The margin offset is baked into the position (no CSS transform), so
        // the tab sits at the same spot on every draw.
        tab.style.left = `${firstBox.left - 18}px`;
        tab.style.top = `${firstBox.top - 2}px`;
        // The icon shows the richest state: discussion, then note, then none.
        tab.innerHTML = hasThread ? ICON.chat : hl.note ? ICON.note : ICON.highlighter;
        // The panel opens on mousedown, which always reaches this element, so
        // a redraw between press and release can never swallow the gesture;
        // stopPropagation keeps the viewer's selection handlers out of it.
        tab.addEventListener('mousedown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.openPopover(hl, (e.currentTarget as HTMLElement).getBoundingClientRect());
        });
        tab.addEventListener('mouseup', (e) => { e.stopPropagation(); });
        tab.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); });
        tabs.push(tab);
      }
    }

    pageEl.appendChild(layer);
    for (const tab of tabs) pageEl.appendChild(tab);
  }

  /** Open a highlight's review panel; `focusAsk` puts the cursor in its AI question. */
  openPopover(hl: PdfHighlight, anchor: DOMRect, focusAsk = false): void {
    this.dismissPopover();
    this._popover = openHighlightPopover(hl, anchor, {
      recolor: (h, key) => {
        h.color = key;
        this._color = key;
        this._save();
        this.renderPage(h.page);
      },
      save: () => this._save(),
      remove: (h) => {
        this._delete(h.id);
        this.dismissPopover();
      },
      openCanvasPage: (pageId) => { void this._host.commands()?.executeCommand('canvas.openPage', pageId); },
      continueInChat: (h) => {
        this._host.continueInChat(h);
        this.dismissPopover();
      },
      inlineAI: () => this._loadInlineAI(),
      passageContext: (h, question) => this._passageContext(h, question),
      newAISignal: () => {
        this._aiAbort?.abort();
        this._aiAbort = new AbortController();
        return this._aiAbort.signal;
      },
      closedOutside: (h, onTab) => {
        this.dismissPopover();
        if (!onTab) this.renderPage(h.page);
      },
    });
    if (focusAsk) {
      const pop = this._popover.element;
      setTimeout(() => pop.querySelector<HTMLTextAreaElement>('.pdf-highlight-ask')?.focus(), 0);
    }
  }

  /** The page and file around a passage, and the file's passages that bear on the question. */
  private async _passageContext(hl: PdfHighlight, question: string): Promise<PassageContext> {
    const src = await this._host.pageSource(hl.page).catch(() => ({} as Awaited<ReturnType<PdfHighlightStoreHost['pageSource']>>));
    const ai = await this._loadInlineAI();
    const related = src.filePath && ai?.retrieveContext
      ? await ai.retrieveContext(`${question}\n${hl.text}`.slice(0, 1000), { filePath: src.filePath }).catch(() => undefined)
      : undefined;
    return { fileName: src.fileName, pageNumber: hl.page, pageCount: src.pageCount, pageText: src.pageText, related };
  }

  /** Close the review panel, wherever the close comes from. */
  dismissPopover(): void {
    this._popover?.close();
    this._popover = null;
  }

  /** Undo the last highlight action. True when there was one. */
  undo(): boolean {
    const action = this._undoStack.pop();
    if (!action) return false;
    this.dismissPopover();
    this._apply(action, true);
    this._redoStack.push(action);
    return true;
  }

  /** Redo the last undone action. True when there was one. */
  redo(): boolean {
    const action = this._redoStack.pop();
    if (!action) return false;
    this.dismissPopover();
    this._apply(action, false);
    this._undoStack.push(action);
    return true;
  }

  private _storageKey(): string {
    return `parallx.pdfHighlights:${this._fileKey}`;
  }

  private _save(): void {
    const storage = this._host.storage();
    if (!storage || !this._fileKey) return;
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      void this._host.storage()?.set(this._storageKey(), JSON.stringify(this._highlights));
    }, SAVE_DELAY_MS);
  }

  private _delete(id: string): void {
    const hl = this._highlights.find((h) => h.id === id);
    if (!hl) return;
    this._pushUndo({ kind: 'delete', highlights: [cloneHighlight(hl)] });
    this._highlights = this._highlights.filter((h) => h.id !== id);
    this._save();
    this.renderPage(hl.page);
  }

  /** Record a reversible action; a new action ends what redo could replay. */
  private _pushUndo(action: PdfHighlightAction): void {
    this._undoStack.push({ kind: action.kind, highlights: action.highlights.map((h) => cloneHighlight(h)) });
    this._redoStack = [];
  }

  /** Apply an action (create adds, delete removes); `inverse` undoes it. */
  private _apply(action: PdfHighlightAction, inverse: boolean): void {
    const ids = new Set(action.highlights.map((h) => h.id));
    const adding = inverse ? action.kind === 'delete' : action.kind === 'create';
    if (adding) {
      // Copies, so later edits never change the snapshots on the stacks.
      for (const h of action.highlights) {
        if (!this._highlights.some((e) => e.id === h.id)) this._highlights.push(cloneHighlight(h));
      }
    } else {
      this._highlights = this._highlights.filter((h) => !ids.has(h.id));
    }
    this._save();
    for (const page of new Set(action.highlights.map((h) => h.page))) this.renderPage(page);
  }

  /** The chat's inline-AI provider, asked for once; null when chat is off. */
  private async _loadInlineAI(): Promise<InlineAIProvider | null> {
    if (this._inlineAILoaded) return this._inlineAI;
    this._inlineAILoaded = true;
    const commands = this._host.commands();
    if (!commands) return null;
    try {
      this._inlineAI = await commands.executeCommand<InlineAIProvider | null>('chat.getInlineAIProvider') ?? null;
    } catch (err) {
      console.warn('[PdfEditorPane] chat.getInlineAIProvider failed:', err);
      this._inlineAI = null;
    }
    return this._inlineAI;
  }
}
