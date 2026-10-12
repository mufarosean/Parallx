// pdfEditorPane.ts — PDF viewer pane (PDF.js Viewer layer)
//
// Production PDF viewer using Mozilla's PDF.js Viewer layer.
//
// The Viewer layer provides:
//   - Canvas buffer with eviction (ring buffer, bounded memory)
//   - Render queue with priority (visible → adjacent → idle)
//   - Render cancellation for stale pages
//   - DPR-correct rendering (crisp on HiDPI)
//   - Detail canvas (zoom uses CSS scaling + focused overlay)
//   - Text layer with search highlight integration
//   - Annotation layer (links, form fields)
//   - Internal link navigation
//
// Custom additions:
//   - Toolbar (page nav, zoom, search toggle, outline toggle, rotation)
//   - Search bar (Ctrl+F)
//   - Outline sidebar (document TOC)
//   - Keyboard shortcuts

// ── pdf.js: types here, the library on the first PDF ───────────────────
// The display and viewer layers are their own bundle (src/vendor/pdfjs.ts),
// loaded by renderInput, so a boot with no PDF open never parses them.
import type { PDFViewer, EventBus, PDFLinkService, PDFFindController } from 'pdfjs-dist/web/pdf_viewer.mjs';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { loadPdfjs } from '../../../vendor/lazy.js';

type PdfVendor = Awaited<ReturnType<typeof loadPdfjs>>;
import { getToolSelectionActions } from '../../../services/selectionActionDispatcher.js';

// ── CSS ─────────────────────────────────────────────────────────────────
import 'pdfjs-dist/web/pdf_viewer.css';
import './pdfEditorPane.css';

// ── App imports ─────────────────────────────────────────────────────────
import { EditorPane } from '../../../editor/editorPane.js';
import type { IEditorInput } from '../../../editor/editorInput.js';
import { PdfEditorInput } from './pdfEditorInput.js';
import { $, hide, show } from '../../../ui/dom.js';
import { beginPointerDrag } from '../../../ui/interactionMode.js';
import { ContextMenu } from '../../../ui/contextMenu.js';
import type { IContextMenuItem } from '../../../ui/contextMenu.js';
import { getEditorTitleActions } from '../../../contributions/menuContribution.js';
import { toDisposable } from '../../../platform/lifecycle.js';
import type { IStorage } from '../../../platform/storage.js';
import { ICON } from './pdfIcons.js';
import type { IPaneCommandService, PdfOutlineItem } from './pdfTypes.js';
import { HIGHLIGHT_COLORS, highlightSolid } from './pdfHighlights.js';
import type { PdfHighlightCanvasLink, PdfHighlight } from './pdfHighlights.js';
import { PdfHighlightStore } from './pdfHighlightStore.js';
import { PdfSelectionOverlay, selectionRectsOnLayer } from './pdfSelectionOverlay.js';
import { setupTooltip } from '../../../ui/tooltip.js';
import { SegmentedControl } from '../../../ui/segmentedControl.js';
import { takeFileReveal } from '../../fileReveal.js';
import { PdfThumbnails } from './pdfThumbnails.js';
import { PdfOutline } from './pdfOutline.js';
import { PdfSearchBar } from './pdfSearchBar.js';
import { pdfButton, labelButton } from './pdfButtons.js';

const PANE_ID = 'pdf-editor-pane';
const PDFJS_CMAP_URL = './dist/renderer/pdfjs/cmaps/';
const PDFJS_STANDARD_FONT_URL = './dist/renderer/pdfjs/standard_fonts/';
const PDFJS_WASM_URL = './dist/renderer/pdfjs/wasm/';

// TextLayerMode is not exported from pdf_viewer.mjs
const TEXT_LAYER_ENABLE = 1;
/** How long a closed document waits for pdf.js's page lookups before it is destroyed anyway. */
const PDF_DESTROY_GRACE_MS = 3000;

// ─── PdfEditorPane ───────────────────────────────────────────────────────

export class PdfEditorPane extends EditorPane {
  static readonly PANE_ID = PANE_ID;

  // ── DOM ──────────────────────────────────────────────────────────────
  private _toolbar!: HTMLElement;
  private _searchBar!: HTMLElement;
  private _outlineSidebar!: HTMLElement;
  private _outlineSash!: HTMLElement;
  private _outlineTree!: HTMLElement;
  private _thumbnailSidebar!: HTMLElement;
  private _thumbnailList!: HTMLElement;
  private _viewerContainer!: HTMLDivElement;
  private _viewerEl!: HTMLDivElement;
  private _loadingEl!: HTMLElement;
  private _paneContainer: HTMLElement | null = null;
  private _errorEl!: HTMLElement;
  private _activeContextMenu: ContextMenu | null = null;
  private _selectionBubble: HTMLElement | null = null;
  private _capturedSelection = '';  // text captured at context-menu show time

  // Toolbar elements
  private _pageInput!: HTMLInputElement;
  private _pageLabelEl!: HTMLElement;
  private _pageTotalEl!: HTMLElement;
  private _panelBtn!: HTMLButtonElement;
  private _invertBtn!: HTMLButtonElement;
  private _fitBtn!: HTMLButtonElement;
  private _zoomInput!: HTMLInputElement;

  // Find widget
  private _search: PdfSearchBar | null = null;

  // Side panel (Outline | Pages). _outlineVisible / _thumbnailVisible say
  // which side is showing while the panel is open.
  private _panelOpen = false;
  private _panelSide: 'outline' | 'pages' = 'outline';
  private _panelSwitch!: SegmentedControl;
  private _outlineView!: HTMLElement;
  private _outlineEmpty!: HTMLElement;
  private _outlineVisible = false;
  private _outline: PdfOutline | null = null;

  // Thumbnails
  private _thumbnailVisible = false;
  private _thumbs: PdfThumbnails | null = null;

  // Page labels
  private _pageLabels: string[] | null = null;

  // ── PDF.js components ────────────────────────────────────────────────
  private _eventBus: EventBus | null = null;
  private _linkService: PDFLinkService | null = null;
  private _findController: PDFFindController | null = null;
  private _pdfViewer: PDFViewer | null = null;
  private _pdfDoc: PDFDocumentProxy | null = null;
  /** The loaded pdf.js, from the first renderInput on. */
  private _pdf: PdfVendor | null = null;

  // ── State ────────────────────────────────────────────────────────────
  private _scaleValue = 'page-fit';  // default fit mode
  private _resizeTimer: ReturnType<typeof setTimeout> | null = null;
  private _currentInput: PdfEditorInput | null = null;
  private readonly _selectionOverlay = new PdfSelectionOverlay(() => this._viewerContainer ?? null);
  private _globalStorage: IStorage | undefined;

  // ── Reading modes ────────────────────────────────────────────────────
  private _readingDark = false;

  // ── Highlights / margin notes ────────────────────────────────────────
  private readonly _highlightStore = new PdfHighlightStore({
    storage: () => this._globalStorage,
    commands: () => this._commandService,
    viewerContainer: () => this._viewerContainer ?? null,
    pageView: (pageNumber) => this._getPageView(pageNumber),
    selectionRects: (selection, textLayer) => selectionRectsOnLayer(selection, textLayer),
    capturedText: () => this._capturedSelection,
    clearSelectionOverlay: () => this._selectionOverlay.clear(),
    continueInChat: (hl) => this._continueHighlightInChat(hl),
  });

  // ── M84: inline AI + canvas partnership ──────────────────────────────
  private _commandService: IPaneCommandService | undefined;

  // ── View state (page + scale persistence) ────────────────────────────

  constructor() {
    super(PANE_ID);
  }

  /** Late-bind global storage for preference persistence. */
  setGlobalStorage(storage: IStorage): void {
    this._globalStorage = storage;
  }

  /** Late-bind the command service so the pane can reach the chat
   *  extension's inline-AI provider and the canvas capture command. */
  setCommandService(commandService: IPaneCommandService): void {
    this._commandService = commandService;
  }

  // ── View state persistence ───────────────────────────────────────────

  protected override savePaneViewState(): Record<string, unknown> {
    const page = this._pdfViewer?.currentPageNumber ?? 1;
    const scaleValue = this._pdfViewer?.currentScaleValue ?? this._scaleValue;
    const scrollLeft = this._viewerContainer?.scrollLeft ?? 0;
    // scrollTop is the EXACT reading position; page alone lands the user at
    // the top of the page they were halfway down.
    const scrollTop = this._viewerContainer?.scrollTop ?? 0;
    return { page, scaleValue, scrollLeft, scrollTop };
  }

  /**
   * Saved state arrives while pdf.js may still be parsing the document, so
   * it is stashed and applied on 'pagesinit' (or immediately when the pages
   * are already up — the workbench restores after setInput resolves, which
   * can land either side of pagesinit).
   */
  private _pendingViewState: {
    page?: number; scaleValue?: string; scrollLeft?: number; scrollTop?: number;
  } | null = null;
  private _pagesInited = false;
  /**
   * The group has shown this document (laid out, view state restored). A
   * citation reveal needs this AND the pages laid out; whichever comes last
   * applies it, so a restore that lands after 'pagesinit' cannot undo it.
   */
  private _shownSinceLoad = false;

  protected override restorePaneViewState(state: Record<string, unknown>): void {
    this._pendingViewState = {
      page: typeof state.page === 'number' ? state.page : undefined,
      scaleValue: typeof state.scaleValue === 'string' ? state.scaleValue : undefined,
      scrollLeft: typeof state.scrollLeft === 'number' ? state.scrollLeft : undefined,
      scrollTop: typeof state.scrollTop === 'number' ? state.scrollTop : undefined,
    };
    if (this._pagesInited) this._applyPendingViewState();
  }

  private _applyPendingViewState(): void {
    const pending = this._pendingViewState;
    if (!pending || !this._pdfViewer) return;
    this._pendingViewState = null;
    if (pending.scaleValue) {
      this._scaleValue = pending.scaleValue;
      this._pdfViewer.currentScaleValue = pending.scaleValue;
    }
    if (pending.page && pending.page >= 1 && pending.page <= (this._pdfDoc?.numPages ?? 1)) {
      this._pdfViewer.currentPageNumber = pending.page;
    }
    // Absolute offsets AFTER the page jump: pdf.js scrolls to the page top
    // synchronously, then the exact reading position wins.
    if (this._viewerContainer) {
      if (typeof pending.scrollTop === 'number' && pending.scrollTop > 0) {
        this._viewerContainer.scrollTop = pending.scrollTop;
      }
      if (typeof pending.scrollLeft === 'number' && pending.scrollLeft > 0) {
        this._viewerContainer.scrollLeft = pending.scrollLeft;
      }
    }
    this._zoomInput.value = `${Math.round(this._pdfViewer.currentScale * 100)}%`;
    this._updateFitButton();
  }

  private _installTestDebugHook(): void {
    if (!(globalThis as any).parallxElectron?.testMode) {
      return;
    }

    (globalThis as any).__parallxPdfDebug = {
      getState: () => this._collectDebugState(),
      setScaleValue: (value: string) => {
        this._setScaleValue(value);
        return this._collectDebugState();
      },
      setNumericScale: (value: number) => {
        if (this._pdfViewer) {
          this._pdfViewer.currentScale = value;
        }
        return this._collectDebugState();
      },
    };
  }

  private _removeTestDebugHook(): void {
    if ((globalThis as any).__parallxPdfDebug?.getState === undefined) {
      return;
    }
    delete (globalThis as any).__parallxPdfDebug;
  }

  private _collectDebugState(): Record<string, unknown> {
    const pageView = this._pdfViewer?.getPageView(0) as any;
    const pageDiv = pageView?.div ?? this._viewerContainer?.querySelector('.page');
    const canvas = pageView?.canvas ?? pageDiv?.querySelector('canvas');
    const textLayerDiv = pageView?.textLayer?.div ?? pageDiv?.querySelector('.textLayer');
    const rectOf = (node: Element | null | undefined) => {
      if (!node) {
        return null;
      }
      const rect = node.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      };
    };
    const fonts = typeof document !== 'undefined' && 'fonts' in document
      ? Array.from(document.fonts as FontFaceSet).slice(0, 40).map((font) => {
        const face = font as FontFace;
        return {
          family: face.family,
          status: face.status,
          weight: face.weight,
          style: face.style,
        };
      })
      : [];

    return {
      currentScale: this._pdfViewer?.currentScale ?? null,
      currentScaleValue: this._pdfViewer?.currentScaleValue ?? null,
      pagesCount: this._pdfViewer?.pagesCount ?? 0,
      devicePixelRatio: globalThis.devicePixelRatio ?? 1,
      pageView: pageView ? {
        renderingState: pageView.renderingState ?? null,
        scale: pageView.scale ?? null,
        hasRestrictedScaling: pageView.hasRestrictedScaling ?? null,
      } : null,
      pageRect: rectOf(pageDiv),
      canvas: canvas ? {
        width: (canvas as HTMLCanvasElement).width,
        height: (canvas as HTMLCanvasElement).height,
        styleWidth: (canvas as HTMLElement).style.width || null,
        styleHeight: (canvas as HTMLElement).style.height || null,
        rect: rectOf(canvas),
      } : null,
      textLayer: textLayerDiv ? {
        rect: rectOf(textLayerDiv),
        spanCount: textLayerDiv.querySelectorAll('span').length,
      } : null,
      selectionOverlay: {
        rootCount: this._viewerContainer?.querySelectorAll('.pdf-selection-overlay-root').length ?? 0,
        boxCount: this._viewerContainer?.querySelectorAll('.pdf-selection-overlay-box').length ?? 0,
        boxes: Array.from(this._viewerContainer?.querySelectorAll<HTMLElement>('.pdf-selection-overlay-box') ?? []).slice(0, 20).map((box) => rectOf(box)),
        endOfContent: (() => {
          const endOfContent = this._viewerContainer?.querySelector<HTMLElement>('.textLayer .endOfContent');
          if (!endOfContent) {
            return null;
          }
          return {
            parentClassName: endOfContent.parentElement?.className ?? null,
            widthStyle: endOfContent.style.width || null,
            heightStyle: endOfContent.style.height || null,
            rect: rectOf(endOfContent),
          };
        })(),
      },
      fonts,
    };
  }

  // ── DOM setup ────────────────────────────────────────────────────────

  protected override createPaneContent(container: HTMLElement): void {
    container.classList.add('pdf-editor-pane');

    // Toolbar
    this._toolbar = $('div');
    this._toolbar.classList.add('pdf-toolbar');
    this._buildToolbar();
    container.appendChild(this._toolbar);

    // Find widget (hidden by default): floats over the top right of the
    // viewer, like the text editor's, so it never pushes the page down.
    this._searchBar = $('div');
    this._searchBar.classList.add('pdf-find-widget');
    this._search = new PdfSearchBar(this._searchBar, { eventBus: () => this._eventBus, source: this });
    hide(this._searchBar);

    // Body: outline + viewer
    const body = $('div');
    body.classList.add('pdf-body');
    container.appendChild(body);

    // Side panel (hidden by default): Outline and Pages in one panel with
    // a switch, so one toolbar button opens it and it keeps one width.
    this._outlineSidebar = $('div');
    this._outlineSidebar.classList.add('pdf-side-panel');
    hide(this._outlineSidebar);
    body.appendChild(this._outlineSidebar);

    const panelHeader = $('div');
    panelHeader.classList.add('pdf-side-panel-header');
    this._outlineSidebar.appendChild(panelHeader);
    this._panelSwitch = this._register(new SegmentedControl(panelHeader, {
      segments: [{ value: 'outline', label: 'Outline' }, { value: 'pages', label: 'Pages' }],
      selected: this._panelSide,
      ariaLabel: 'Show',
    }));
    this._register(this._panelSwitch.onDidChange((v) => {
      this._setPanelSide(v === 'pages' ? 'pages' : 'outline', true);
    }));

    this._outlineView = $('div');
    this._outlineView.classList.add('pdf-side-panel-view', 'pdf-outline-view');
    this._outlineSidebar.appendChild(this._outlineView);

    this._outlineTree = $('div');
    this._outlineTree.classList.add('pdf-outline-tree');
    this._outlineView.appendChild(this._outlineTree);
    this._outline = new PdfOutline(this._outlineTree, {
      document: () => this._pdfDoc,
      pageLabel: (pageNum) => this._pageLabels?.[pageNum - 1],
      goToDestination: (dest) => { void this._linkService?.goToDestination(dest as string | any[]); },
      scale: () => this._pdfViewer?.currentScale ?? 1,
      viewHeight: () => this._viewerContainer?.clientHeight ?? 0,
      isShowing: () => this._outlineVisible,
    });

    this._outlineEmpty = $('div');
    this._outlineEmpty.classList.add('pdf-side-panel-empty');
    this._outlineEmpty.textContent = 'This document has no outline.';
    hide(this._outlineEmpty);
    this._outlineView.appendChild(this._outlineEmpty);

    // Thumbnails: the Pages side of the same panel. _thumbnailSidebar is the
    // view that shows and hides; the list inside it scrolls.
    this._thumbnailSidebar = $('div');
    this._thumbnailSidebar.classList.add('pdf-side-panel-view', 'pdf-pages-view');
    this._outlineSidebar.appendChild(this._thumbnailSidebar);

    this._thumbnailList = $('div');
    this._thumbnailList.classList.add('pdf-thumbnail-list');
    this._thumbnailSidebar.appendChild(this._thumbnailList);
    this._thumbs = new PdfThumbnails(this._thumbnailList, {
      document: () => this._pdfDoc,
      pageLabel: (pageNum) => this._pageLabels?.[pageNum - 1],
      goToPage: (pageNum) => { if (this._pdfViewer) this._pdfViewer.currentPageNumber = pageNum; },
    });

    // Resize edge for the panel (hidden with it)
    this._outlineSash = $('div');
    this._outlineSash.classList.add('pdf-outline-sash');
    hide(this._outlineSash);
    this._wireOutlineSash();
    body.appendChild(this._outlineSash);

    // Viewer wrapper (flex child that takes remaining space;
    // provides position: relative context for the absolutely-positioned container)
    const viewerWrapper = document.createElement('div');
    viewerWrapper.classList.add('pdf-viewer-wrapper');
    body.appendChild(viewerWrapper);
    viewerWrapper.appendChild(this._searchBar);

    // Viewer container (scrollable region — PDFViewer binds to this)
    // Must be position: absolute per PDFViewer constructor requirement
    this._viewerContainer = document.createElement('div');
    this._viewerContainer.classList.add('pdf-viewer-container');
    viewerWrapper.appendChild(this._viewerContainer);

    // Inner viewer div (PDFViewer appends pages here)
    this._viewerEl = document.createElement('div');
    this._viewerEl.classList.add('pdfViewer');
    this._viewerContainer.appendChild(this._viewerEl);

    // Loading overlay
    this._loadingEl = $('div');
    this._loadingEl.classList.add('pdf-loading');
    this._loadingEl.textContent = 'Loading PDF…';
    container.appendChild(this._loadingEl);

    // Error overlay
    this._errorEl = $('div');
    this._errorEl.classList.add('pdf-error');
    hide(this._errorEl);
    container.appendChild(this._errorEl);

    // Wire text selection context menu (shows on mouseup via shared ContextMenu)
    this._register(this._selectionOverlay.listen());
    this._wireContextMenu();
    // The bubble lives on <body>; it must not outlive the pane.
    this._register(toDisposable(() => this._dismissSelectionBubble()));

    container.tabIndex = 0;
    container.addEventListener('keydown', (e) => this._onKeyDown(e));
    this._paneContainer = container;

    // Undo/redo of highlights is delegated from the global `edit.undo` /
    // `edit.redo` commands (Ctrl+Z / Ctrl+Shift+Z). The PDF page isn't an
    // editable surface, so the native execCommand path is a no-op; the global
    // command fires a cancelable DOM event instead, and we claim it (and call
    // preventDefault) only when this pane holds focus.
    const onEditUndo = (e: Event): void => {
      if (!this._ownsEditFocus()) return;
      if (this._highlightStore.undo()) e.preventDefault();
    };
    const onEditRedo = (e: Event): void => {
      if (!this._ownsEditFocus()) return;
      if (this._highlightStore.redo()) e.preventDefault();
    };
    document.addEventListener('parallx:edit-undo', onEditUndo);
    document.addEventListener('parallx:edit-redo', onEditRedo);
    this._register(toDisposable(() => {
      document.removeEventListener('parallx:edit-undo', onEditUndo);
      document.removeEventListener('parallx:edit-redo', onEditRedo);
    }));
  }

  /**
   * M66 Iter B — citation links open a PDF at a page and quote. The open
   * path files the request (fileReveal.ts). Shown with its pages laid out,
   * the pane applies it here; a document still loading leaves it for
   * 'pagesinit' (a fresh open used to drop the page because the document was
   * still loading when a fixed 100 ms timer fired).
   */
  protected override onDidShow(): void {
    this._shownSinceLoad = true;
    if (!this._pagesInited) return;
    const ownPath = this._currentInput?.uri.fsPath;
    const target = ownPath ? takeFileReveal(ownPath) : undefined;
    if (target) this._applyLinkReveal(target.page, target.quote);
  }

  /**
   * M66 Iter B — Apply a `parallx://` link's `?page=` / `?quote=` anchors to
   * the live viewer. Page goes first (it's authoritative); quote is then
   * dispatched as a find request so pdf.js highlights matching text.
   * Both are clamped/no-op on invalid input — the link contract never wants
   * to crash the editor.
   */
  private _applyLinkReveal(page: number | undefined, quote: string | undefined): void {
    if (!this._pdfViewer) return;
    if (typeof page === 'number' && page > 0 && page <= (this._pdfDoc?.numPages ?? 0)) {
      this._pdfViewer.currentPageNumber = page;
      if (this._pageInput) this._pageInput.value = String(page);
    }
    if (typeof quote === 'string' && quote.length > 0 && this._eventBus) {
      // Normalize whitespace so URI-encoded quotes still match the text
      // layer. pdf.js's find controller treats `\s+` as a single space
      // internally, so passing collapsed text is friendlier.
      const normalized = quote.replace(/\s+/g, ' ').trim();
      this._eventBus.dispatch('find', {
        source: this,
        type: 'find',
        query: normalized,
        caseSensitive: false,
        entireWord: false,
        highlightAll: true,
        findPrevious: false,
      });
    }
  }

  private _getPageView(pageNumber: number): any | null {
    const viewer = this._pdfViewer as any;
    if (!viewer?.getPageView) return null;
    try {
      return viewer.getPageView(pageNumber - 1) ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Whether this pane should claim a delegated undo/redo. True ONLY when DOM
   * focus is genuinely inside the pane container. We deliberately do NOT claim
   * when "nothing" is focused — that over-broad rule let the PDF pane intercept
   * global Ctrl+Z/Ctrl+Shift+Z away from other editors (e.g. canvas) whenever
   * it was merely visible, which is a key-stealing regression.
   */
  private _ownsEditFocus(): boolean {
    const c = this._paneContainer;
    if (!c) return false;
    const active = document.activeElement;
    return !!active && c.contains(active);
  }

  /**
   * Send the captured detail to a canvas page via the `canvas.captureSelection`
   * command, then record the returned page as a link on the anchoring
   * highlight(s) so the highlight becomes the durable hub between the two
   * surfaces. Falls back to a fire-and-forget window event if the canvas
   * command isn't available (canvas extension not activated).
   */
  private async _captureToCanvas(
    detail: { text?: string; imageDataUrl?: string; fileName?: string; page?: number; sourceUri?: string },
    anchors: PdfHighlight[],
  ): Promise<void> {
    let result: { pageId: string; title: string } | null = null;
    if (this._commandService) {
      try {
        result = await this._commandService.executeCommand<{ pageId: string; title: string } | null>(
          'canvas.captureSelection', detail,
        );
      } catch (err) {
        console.warn('[PdfEditorPane] canvas.captureSelection failed:', err);
      }
    } else {
      window.dispatchEvent(new CustomEvent('parallx:capture-to-canvas', { detail }));
    }
    if (!result) return;
    const link: PdfHighlightCanvasLink = { pageId: result.pageId, title: result.title, at: Date.now() };
    this._highlightStore.addCanvasLink(anchors, link);
  }

  /** Send the current selection to a Canvas study note and link it back. */
  private _captureSelectionToCanvas(): void {
    if (!this._capturedSelection || !this._currentInput) return;
    const fsPath = this._currentInput.uri.fsPath;
    const page = this._pdfViewer?.currentPageNumber;
    // Build the documented explorer deep-link so the canvas note can jump
    // back to this page + quote. (parallx://explorer/file?path=…&page=…&quote=…)
    const params = new URLSearchParams();
    params.set('path', fsPath);
    if (page) params.set('page', String(page));
    params.set('quote', this._capturedSelection.slice(0, 120));
    const sourceUri = `parallx://explorer/file?${params.toString()}`;
    const text = this._capturedSelection;
    const fileName = this._currentInput.name;

    // Auto-anchor a highlight on the captured passage so the link has a home.
    const anchors = this._highlightStore.createFromSelection();
    void this._captureToCanvas({ text, fileName, page, sourceUri }, anchors);
  }

  /**
   * Inline AI entry point from the selection menu: anchor a highlight on the
   * selection, then open its review panel with the AI "Discuss" input focused
   * so the user can ask about the passage without leaving the page.
   */
  private _askAIAboutSelection(): void {
    const sel = window.getSelection();
    const rect = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).getBoundingClientRect() : null;
    const anchors = this._highlightStore.createFromSelection();
    const hl = anchors[0];
    if (!hl) return;
    const anchorRect = rect && rect.width + rect.height > 0
      ? rect
      : new DOMRect(window.innerWidth / 2, window.innerHeight / 2, 0, 0);
    this._highlightStore.openPopover(hl, anchorRect, true);
  }

  /**
   * Capture the selected region as an image and send it to a canvas page.
   *
   * Text selection on math-typeset PDFs extracts the underlying glyph codes,
   * which for formulas/tables/figures rarely map to meaningful Unicode (an
   * integral sign may be encoded `R`, subscripts are just positioned glyphs
   * with no `_`). There's no reliable way to recover LaTeX from the text
   * layer, so for that content we crop the selection's bounding box straight
   * from the rendered page canvas and insert it as an image — faithful to what
   * is on the page. Reuses the same selection-rect machinery as highlights.
   */
  private _captureSelectionRegionToCanvas(): void {
    const selection = globalThis.getSelection?.();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0 || !this._viewerContainer || !this._currentInput) return;

    for (const textLayer of Array.from(this._viewerContainer.querySelectorAll<HTMLElement>('.textLayer'))) {
      const merged = selectionRectsOnLayer(selection, textLayer);
      if (merged.length === 0) continue;

      const pageEl = textLayer.closest<HTMLElement>('.page');
      const pageNumber = pageEl ? parseInt(pageEl.dataset.pageNumber ?? '', 10) : NaN;
      if (!Number.isFinite(pageNumber)) continue;

      const canvas: HTMLCanvasElement | undefined = this._getPageView(pageNumber)?.canvas;
      if (!canvas) continue;

      // Selection rects are in text-layer-local CSS px; the canvas shares the
      // same inset:0 box, so the coordinate spaces line up. Pad slightly so
      // descenders / superscripts aren't clipped.
      const pad = 4;
      const cssBox = canvas.getBoundingClientRect();
      const minLeft = Math.max(0, Math.min(...merged.map((r) => r.left)) - pad);
      const minTop = Math.max(0, Math.min(...merged.map((r) => r.top)) - pad);
      const maxRight = Math.min(cssBox.width, Math.max(...merged.map((r) => r.left + r.width)) + pad);
      const maxBottom = Math.min(cssBox.height, Math.max(...merged.map((r) => r.top + r.height)) + pad);
      const cropW = maxRight - minLeft;
      const cropH = maxBottom - minTop;
      if (cropW <= 1 || cropH <= 1) continue;

      // Map CSS px → canvas backing-store px (HiDPI: canvas.width > cssBox.width).
      const sx = canvas.width / cssBox.width;
      const sy = canvas.height / cssBox.height;

      const out = document.createElement('canvas');
      out.width = Math.round(cropW * sx);
      out.height = Math.round(cropH * sy);
      const ctx = out.getContext('2d');
      if (!ctx) continue;
      ctx.drawImage(
        canvas,
        minLeft * sx, minTop * sy, cropW * sx, cropH * sy,
        0, 0, out.width, out.height,
      );

      let imageDataUrl: string;
      try {
        imageDataUrl = out.toDataURL('image/png');
      } catch (err) {
        console.warn('[PdfEditorPane] region capture toDataURL failed:', err);
        return;
      }

      const fsPath = this._currentInput.uri.fsPath;
      const params = new URLSearchParams();
      params.set('path', fsPath);
      params.set('page', String(pageNumber));
      const sourceUri = `parallx://explorer/file?${params.toString()}`;
      const fileName = this._currentInput.name;

      // Auto-anchor a highlight on the cropped region so the link has a home.
      const anchors = this._highlightStore.createFromSelection();
      void this._captureToCanvas({ imageDataUrl, fileName, page: pageNumber, sourceUri }, anchors);
      return; // one region per invocation
    }
  }

  // ── Toolbar ──────────────────────────────────────────────────────────

  private _buildToolbar(): void {
    // ── Left: page navigation ──
    const nav = $('div');
    nav.classList.add('pdf-toolbar-cluster');

    const prev = pdfButton(ICON.chevronLeft, 'Previous Page');
    prev.addEventListener('click', () => this._pdfViewer?.previousPage());

    const pagePill = $('div');
    pagePill.classList.add('pdf-toolbar-pill');

    this._pageInput = document.createElement('input');
    this._pageInput.type = 'text';
    this._pageInput.classList.add('pdf-toolbar-page-input', 'px-input-bare');
    this._pageInput.setAttribute('aria-label', 'Page number');
    this._pageInput.value = '1';
    this._pageInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const n = parseInt(this._pageInput.value, 10);
        if (!isNaN(n) && this._pdfViewer) {
          this._pdfViewer.currentPageNumber = n;
        }
      }
    });
    this._pageInput.addEventListener('blur', () => {
      if (this._pdfViewer) {
        this._pageInput.value = String(this._pdfViewer.currentPageNumber);
      }
    });

    const sep = $('span');
    sep.classList.add('pdf-toolbar-page-sep');
    sep.textContent = '/';

    this._pageTotalEl = $('span');
    this._pageTotalEl.classList.add('pdf-toolbar-page-total');
    this._pageTotalEl.textContent = '0';

    // Page label (shown when document has custom labels like i, ii, iii)
    this._pageLabelEl = $('span');
    this._pageLabelEl.classList.add('pdf-toolbar-page-label');
    hide(this._pageLabelEl);

    pagePill.append(this._pageInput, sep, this._pageTotalEl, this._pageLabelEl);

    const next = pdfButton(ICON.chevronRight, 'Next Page');
    next.addEventListener('click', () => this._pdfViewer?.nextPage());

    nav.append(prev, pagePill, next);

    // ── Zoom ──
    const zoom = $('div');
    zoom.classList.add('pdf-toolbar-cluster');

    const zoomOut = pdfButton(ICON.zoomOut, 'Zoom Out');
    zoomOut.addEventListener('click', () => this._pdfViewer?.decreaseScale());

    // One pill: editable % input + preset dropdown chevron.
    const zoomPill = $('div');
    zoomPill.classList.add('pdf-toolbar-pill');

    this._zoomInput = document.createElement('input');
    this._zoomInput.type = 'text';
    this._zoomInput.classList.add('px-input-bare');
    this._zoomInput.classList.add('pdf-toolbar-zoom-input');
    this._zoomInput.value = '100%';
    this._zoomInput.setAttribute('aria-label', 'Zoom level');
    setupTooltip(this._zoomInput, 'Zoom level (type a % and press Enter)');
    this._zoomInput.addEventListener('focus', () => this._zoomInput.select());
    this._zoomInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { this._applyZoomInput(); this._zoomInput.blur(); e.preventDefault(); }
      if (e.key === 'Escape') { this._syncZoomInput(); this._zoomInput.blur(); e.preventDefault(); }
    });
    this._zoomInput.addEventListener('blur', () => this._syncZoomInput());

    const zoomPreset = pdfButton(ICON.chevronDownSm, 'Zoom Presets');
    zoomPreset.classList.add('pdf-toolbar-zoom-preset');
    zoomPreset.addEventListener('click', (e) => {
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      this._showZoomPresets(r.left, r.bottom + 4);
    });

    zoomPill.append(this._zoomInput, zoomPreset);

    const zoomIn = pdfButton(ICON.zoomIn, 'Zoom In');
    zoomIn.addEventListener('click', () => this._pdfViewer?.increaseScale());

    // Single fit button that alternates between the two fit modes.
    this._fitBtn = pdfButton(ICON.fitWidth, 'Fit Width');
    this._fitBtn.addEventListener('click', () => this._toggleFitMode());

    zoom.append(zoomOut, zoomPill, zoomIn, this._fitBtn);

    // ── Center spacer ──
    const spacer = $('span');
    spacer.classList.add('pdf-toolbar-spacer');

    // ── Right: search, panels, night reading, overflow ──
    const right = $('div');
    right.classList.add('pdf-toolbar-cluster');

    const searchBtn = pdfButton(ICON.search, 'Find (Ctrl+F)');
    searchBtn.addEventListener('click', () => this._search?.toggle());

    this._panelBtn = pdfButton(ICON.panelLeft, 'Outline And Pages');
    this._panelBtn.setAttribute('aria-pressed', 'false');
    this._panelBtn.addEventListener('click', () => this._togglePanel());

    this._invertBtn = pdfButton(ICON.moon, 'Night Reading');
    this._invertBtn.addEventListener('click', () => this._toggleReadingDark());

    // Rarely-used actions live in the ⋯ menu (rotate, spread, scroll, print, open).
    const moreBtn = pdfButton(ICON.more, 'More Actions');
    moreBtn.addEventListener('click', (e) => {
      this._showOverflowMenu(e.currentTarget as HTMLElement);
    });

    right.append(searchBtn, this._panelBtn, this._invertBtn, moreBtn);

    this._toolbar.append(nav, zoom, spacer, right);
  }

  /** One fit button that alternates fit-width ↔ fit-page (advertises the mode it switches TO). */
  private _toggleFitMode(): void {
    const next = this._pdfViewer?.currentScaleValue === 'page-width' ? 'page-fit' : 'page-width';
    this._setScaleValue(next);
    this._syncZoomInput();
    this._updateFitButton();
  }

  private _updateFitButton(): void {
    if (!this._fitBtn) return;
    const isWidth = this._pdfViewer?.currentScaleValue === 'page-width';
    this._fitBtn.innerHTML = isWidth ? ICON.fitPage : ICON.fitWidth;
    labelButton(this._fitBtn, isWidth ? 'Fit Page' : 'Fit Width');
  }

  // ── Overflow menu (rotate / spread / scroll / print / open) ────────────

  private _showOverflowMenu(anchor: HTMLElement): void {
    this._dismissContextMenu();
    const pdf = this._pdf;
    if (!pdf) return;
    const { SpreadMode, ScrollMode } = pdf;
    const r = anchor.getBoundingClientRect();
    const spread = this._pdfViewer?.spreadMode ?? SpreadMode.NONE;
    const scroll = this._pdfViewer?.scrollMode ?? ScrollMode.VERTICAL;
    // Every submenu item gets an icon slot so labels stay aligned; only the
    // current mode draws the check. The icon span has no CSS sizing of its
    // own, so size it (and the SVG) inline — same as viewContainer's menu.
    const checked = (on: boolean) => (el: HTMLElement) => {
      el.style.width = '16px';
      el.style.display = 'inline-flex';
      el.style.alignItems = 'center';
      if (on) {
        el.innerHTML = ICON.check;
        const svg = el.querySelector('svg');
        if (svg) { svg.style.width = '13px'; svg.style.height = '13px'; }
      }
    };

    // Entries running tools added through the `editor/title` menu location
    // (when: activeEditor == this pane's typeId). The pane names no tool: it
    // lists what is there, with the tool's name at the right so the user can
    // tell what added it. ContextMenu has no slot for trailing text other
    // than the keybinding span (muted, right-aligned), so the tag goes there.
    const toolActions = getEditorTitleActions();
    const toolItems: IContextMenuItem[] = toolActions.map((a) => ({
      id: `tool:${a.commandId}`,
      label: a.label,
      keybinding: a.toolName,
      group: 'tools',
    }));

    const menu = ContextMenu.show({
      items: [
        { id: 'pdf.rotate', label: 'Rotate 90°', keybinding: 'R' },
        {
          id: 'pdf.spread',
          label: 'Two-page spread',
          submenu: [
            { id: 'pdf.spread.none', label: 'Off',        renderIcon: checked(spread === SpreadMode.NONE) },
            { id: 'pdf.spread.odd',  label: 'Odd Pages',  renderIcon: checked(spread === SpreadMode.ODD) },
            { id: 'pdf.spread.even', label: 'Even Pages', renderIcon: checked(spread === SpreadMode.EVEN) },
          ],
        },
        {
          id: 'pdf.scroll',
          label: 'Scroll Direction',
          submenu: [
            { id: 'pdf.scroll.vertical',   label: 'Vertical',    renderIcon: checked(scroll === ScrollMode.VERTICAL) },
            { id: 'pdf.scroll.horizontal', label: 'Horizontal',  renderIcon: checked(scroll === ScrollMode.HORIZONTAL) },
            { id: 'pdf.scroll.wrapped',    label: 'Wrapped',     renderIcon: checked(scroll === ScrollMode.WRAPPED) },
            { id: 'pdf.scroll.page',       label: 'Single Page', renderIcon: checked(scroll === ScrollMode.PAGE) },
          ],
        },
        { id: 'pdf.print', label: 'Print…', group: 'doc' },
        { id: 'pdf.openExternal', label: 'Open in System Viewer', group: 'doc' },
        ...toolItems,
      ],
      anchor: { x: r.left, y: r.bottom + 4 },
    });

    menu.onDidSelect((e) => {
      const id = e.item.id;
      const toolAction = toolActions.find((a) => `tool:${a.commandId}` === id);
      if (toolAction) {
        // One argument: where the reader is. The command decides what to do with it.
        const uri = this._currentInput?.uri;
        if (!uri || !this._commandService) return;
        void this._commandService.executeCommand(toolAction.commandId, {
          uri: uri.toString(),
          fsPath: uri.fsPath,
          page: this._pdfViewer?.currentPageNumber ?? 1,
        }).catch((err) => console.error(`[PdfEditorPane] "${toolAction.commandId}" failed:`, err));
        return;
      }
      if (id === 'pdf.rotate') this._rotate();
      else if (id === 'pdf.print') this._print();
      else if (id === 'pdf.openExternal') this._openExternal();
      else if (id.startsWith('pdf.spread.') && this._pdfViewer) {
        const mode = id.slice('pdf.spread.'.length);
        this._pdfViewer.spreadMode =
          mode === 'odd' ? SpreadMode.ODD : mode === 'even' ? SpreadMode.EVEN : SpreadMode.NONE;
      } else if (id.startsWith('pdf.scroll.') && this._pdfViewer) {
        const mode = id.slice('pdf.scroll.'.length);
        this._pdfViewer.scrollMode =
          mode === 'horizontal' ? ScrollMode.HORIZONTAL
          : mode === 'wrapped' ? ScrollMode.WRAPPED
          : mode === 'page' ? ScrollMode.PAGE
          : ScrollMode.VERTICAL;
      }
    });

    this._activeContextMenu = menu;
  }

  // ── Outline sidebar ──────────────────────────────────────────────────

  /** Open or close the side panel, on whichever side it last showed. */
  private _togglePanel(forceState?: boolean): void {
    this._panelOpen = forceState ?? !this._panelOpen;
    this._applyPanel();
  }

  /** Show one side of the panel (opening it); `remember` keeps the choice. */
  private _setPanelSide(side: 'outline' | 'pages', remember = false): void {
    this._panelSide = side;
    this._panelSwitch.value = side;
    if (remember) this._globalStorage?.set('parallx.pdfPanelSide', side); // fire-and-forget
    this._panelOpen = true;
    this._applyPanel();
  }

  private _applyPanel(): void {
    const open = this._panelOpen;
    this._outlineVisible = open && this._panelSide === 'outline';
    this._thumbnailVisible = open && this._panelSide === 'pages';
    this._panelBtn?.classList.toggle('active', open);
    this._panelBtn?.setAttribute('aria-pressed', String(open));
    if (!open) {
      hide(this._outlineSidebar);
      hide(this._outlineSash);
      return;
    }
    show(this._outlineSidebar);
    show(this._outlineSash);
    this._outlineView.style.display = this._outlineVisible ? '' : 'none';
    this._thumbnailSidebar.style.display = this._thumbnailVisible ? '' : 'none';
    const hasOutline = !!this._outline?.hasItems;
    this._outlineTree.style.display = hasOutline ? '' : 'none';
    this._outlineEmpty.style.display = hasOutline ? 'none' : '';
    if (this._thumbnailVisible) {
      this._thumbs?.observe();
      this._thumbs?.revealActive();
    }
    if (this._outlineVisible) this._outline?.revealCurrent();
    // Restore persisted width
    this._globalStorage?.get('parallx.pdfOutlineWidth').then(stored => {
      if (stored) {
        const w = parseInt(stored, 10);
        if (w >= 150 && w <= 500) {
          this._outlineSidebar.style.width = `${w}px`;
        }
      }
    });
  }

  /** T: show the pages, or close the panel when they already show. */
  private _toggleThumbnails(forceState?: boolean): void {
    const want = forceState ?? !this._thumbnailVisible;
    if (want) this._setPanelSide('pages');
    else this._togglePanel(false);
  }

  /** Wire drag-to-resize on the outline sash. */
  private _wireOutlineSash(): void {
    const MIN_W = 150;
    const MAX_W = 500;

    this._outlineSash.addEventListener('mousedown', (startEvt: MouseEvent) => {
      startEvt.preventDefault();
      let startX = startEvt.clientX;
      let currentW = this._outlineSidebar.offsetWidth;
      this._outlineSash.classList.add('active');

      // Guarded drag (interactionMode.ts): every end path — release,
      // Escape, window blur — runs the one cleanup.
      beginPointerDrag(startEvt, {
        id: 'pdf-outline-sash',
        cursor: 'col-resize',
        onMove: (e) => {
          const delta = e.clientX - startX;
          startX = e.clientX;
          currentW = Math.max(MIN_W, Math.min(MAX_W, currentW + delta));
          this._outlineSidebar.style.width = `${currentW}px`;
        },
        onEnd: () => {
          this._outlineSash.classList.remove('active');
          this._globalStorage?.set('parallx.pdfOutlineWidth', String(currentW)); // fire-and-forget
        },
      });
    });
  }

  // ── Load PDF ─────────────────────────────────────────────────────────

  protected override async renderInput(
    input: IEditorInput,
    _previous: IEditorInput | undefined,
  ): Promise<void> {
    this._cleanup();
    const pdf = await loadPdfjs();
    this._pdf = pdf;

    if (!(input instanceof PdfEditorInput)) {
      this._showError('Not a PDF input.');
      return;
    }

    this._currentInput = input;
    show(this._loadingEl);
    hide(this._errorEl);
    show(this._toolbar);

    try {
      // Read file bytes via Electron bridge
      const electron = (globalThis as any).parallxElectron;
      if (!electron?.fs?.readFile) throw new Error('File-system bridge unavailable');

      // Load persisted highlights for this document (best-effort).
      await this._highlightStore.load(input.uri.fsPath);

      const result = await electron.fs.readFile(input.uri.fsPath);
      if (result.error) throw new Error(result.error.message || 'Read failed');

      // Convert to Uint8Array — handle both base64 and text encodings safely
      let data: Uint8Array;
      if (result.encoding === 'base64') {
        const bin = atob(result.content);
        data = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
      } else {
        // Fallback: encode text to bytes via TextEncoder (safe for any Unicode)
        data = new TextEncoder().encode(result.content);
      }

      // ── Initialize PDF.js Viewer components ────────────────────────

      this._eventBus = new pdf.EventBus();

      this._linkService = new pdf.PDFLinkService({
        eventBus: this._eventBus,
        // External anchors (http/https/mailto) render with target="_blank"
        // so the click hits window.open → caught by Electron's
        // setWindowOpenHandler in main.cjs, which forwards http(s)/mailto
        // to shell.openExternal (the user's OS browser).
        // LinkTarget enum: 0 NONE, 1 SELF, 2 BLANK, 3 PARENT, 4 TOP.
        externalLinkTarget: 2,
        externalLinkRel: 'noopener noreferrer',
      });

      this._findController = new pdf.PDFFindController({
        linkService: this._linkService,
        eventBus: this._eventBus,
      });

      this._pdfViewer = new pdf.PDFViewer({
        container: this._viewerContainer,
        viewer: this._viewerEl,
        eventBus: this._eventBus,
        linkService: this._linkService,
        findController: this._findController,
        textLayerMode: TEXT_LAYER_ENABLE,
        annotationMode: pdf.AnnotationMode.ENABLE_FORMS,
        removePageBorders: false,
        enableHWA: true,
        supportsPinchToZoom: true,
        enableAutoLinking: true,
        minDurationToUpdateCanvas: 0,
        l10n: new pdf.GenericL10n('en-US'),
      });

      this._linkService.setViewer(this._pdfViewer);

      // ── Listen to viewer events ────────────────────────────────────

      // Where the view's top edge is, for the outline's current section.
      this._eventBus.on('updateviewarea', (evt: any) => {
        const loc = evt?.location;
        if (!loc) return;
        this._outline?.updateViewArea(loc.pageNumber, typeof loc.top === 'number' ? loc.top : null);
      });

      this._eventBus.on('pagechanging', (evt: any) => {
        const pageNum = evt.pageNumber;
        this._pageInput.value = String(pageNum);
        this._updatePageLabel(pageNum);
        this._thumbs?.markActive(pageNum, this._thumbnailVisible);
        if (this._currentInput) this._currentInput.page = pageNum;
      });

      this._eventBus.on('scalechanging', (evt: any) => {
        this._zoomInput.value = `${Math.round(evt.scale * 100)}%`;
        this._updateFitButton();
        this._pdfViewer?.update();
        this._selectionOverlay.schedule();
        this._highlightStore.renderAll();
        if (this._currentInput && this._pdfViewer) {
          this._currentInput.scaleValue = this._pdfViewer.currentScaleValue;
        }
      });

      this._eventBus.on('textlayerrendered', (evt: any) => {
        this._selectionOverlay.schedule();
        const pageNumber = evt?.pageNumber;
        if (typeof pageNumber === 'number') this._highlightStore.renderPage(pageNumber);
      });

      this._search?.attach(this._eventBus, pdf.FindState.NOT_FOUND);

      // ── Load document ──────────────────────────────────────────────

      this._pdfDoc = await pdf.pdfjsLib.getDocument({
        data,
        cMapUrl: PDFJS_CMAP_URL,
        cMapPacked: true,
        standardFontDataUrl: PDFJS_STANDARD_FONT_URL,
        wasmUrl: PDFJS_WASM_URL,
        enableHWA: true,
      }).promise;

      // Storage reads and the pagesinit listener BOTH come before
      // setDocument(): pdf.js dispatches 'pagesinit' on a synchronous
      // EventBus with no replay, so a listener registered after setDocument
      // raced the first page's parse — when parsing won, the restore never
      // ran and the pane silently reset to page 1 at default scale.
      // B5.2: Restore user's persisted scale preference (fallback to 'page-fit')
      const storedScale = await this._globalStorage?.get('parallx.pdfScaleValue');
      if (storedScale) {
        this._scaleValue = storedScale;
      }
      // Restore night-reading preference.
      this._readingDark = (await this._globalStorage?.get('parallx.pdfReadingDark')) === '1';
      this._applyReadingDark();
      this._eventBus.on('pagesinit', () => {
        this._pagesInited = true;

        // Workbench view state (tab switched away and back) beats the
        // input's page/scale (set during deserialization) — it is newer.
        const pending = this._pendingViewState;
        const input = this._currentInput;
        const restoredScale = pending?.scaleValue ?? input?.scaleValue ?? this._scaleValue;
        const restoredPage = pending?.page ?? input?.page ?? 1;

        this._scaleValue = restoredScale;
        this._pdfViewer!.currentScaleValue = restoredScale;
        if (restoredPage > 1 && restoredPage <= (this._pdfDoc?.numPages ?? 1)) {
          this._pdfViewer!.currentPageNumber = restoredPage;
        }
        if (pending) this._applyPendingViewState();
        // Setting the scale re-anchors the current page at its sheet's top
        // edge, past the viewer padding and pdf.js's page border, so page 1
        // opened flush under the toolbar. A fresh open at page 1 starts at
        // the very top instead.
        else if (restoredPage <= 1 && this._viewerContainer) this._viewerContainer.scrollTop = 0;

        this._zoomInput.value = `${Math.round(this._pdfViewer!.currentScale * 100)}%`;
        this._updateFitButton();
        this._pdfViewer!.update();
        this._selectionOverlay.schedule();
        this._highlightStore.renderAll();

        // A citation link that opened this file: its page and quote win over
        // the restored reading position. Not yet shown, the group's didShow
        // (after layout and restore) applies it instead.
        if (this._shownSinceLoad) {
          const linkPath = this._currentInput?.uri.fsPath;
          const linkTarget = linkPath ? takeFileReveal(linkPath) : undefined;
          if (linkTarget) this._applyLinkReveal(linkTarget.page, linkTarget.quote);
        }
      });

      // The viewer hands the find controller its document itself, once the
      // first page has rendered, and that call resets the controller. Giving
      // it the document here as well meant a find sent in between (a
      // citation's quote) was wiped and never highlighted; with the viewer's
      // one call, an early find waits for the document and then runs.
      this._pdfViewer.setDocument(this._pdfDoc);
      this._linkService.setDocument(this._pdfDoc, null);
      this._installTestDebugHook();

      // Update toolbar page count
      this._pageTotalEl.textContent = String(this._pdfDoc.numPages);
      this._pageInput.value = '1';

      // ── Load page labels ───────────────────────────────────────────

      const labels = await this._pdfDoc.getPageLabels();
      if (labels && labels.some((l: string | null) => l !== null)) {
        this._pageLabels = labels;
        this._updatePageLabel(1);
        show(this._pageLabelEl);
      } else {
        this._pageLabels = null;
        hide(this._pageLabelEl);
      }

      // ── Load outline ───────────────────────────────────────────────

      const outline = await this._pdfDoc.getOutline() as PdfOutlineItem[] | null;
      // The panel opens on the side last chosen, except that a document
      // with no outline opens on its pages.
      const storedSide = await this._globalStorage?.get('parallx.pdfPanelSide');
      this._outline?.render(outline);
      this._panelSide = outline?.length && storedSide !== 'pages' ? 'outline' : 'pages';
      this._panelSwitch.value = this._panelSide;
      if (this._panelOpen) this._applyPanel();

      // ── Build thumbnails ───────────────────────────────────────────

      this._thumbs?.build(this._pdfDoc.numPages);

      hide(this._loadingEl);
    } catch (err) {
      console.error('[PdfEditorPane] Load error:', err);
      this._showError(`Error: ${(err as Error).message}`);
    }
  }

  // ── Zoom helpers ─────────────────────────────────────────────────────

  private _setScaleValue(value: string): void {
    this._scaleValue = value;
    if (this._pdfViewer) {
      this._pdfViewer.currentScaleValue = value;
    }
    // B5.2: Persist user scale preference
    this._globalStorage?.set('parallx.pdfScaleValue', value);  // fire-and-forget
  }

  /** Reflect the viewer's current scale back into the editable zoom input. */
  private _syncZoomInput(): void {
    if (!this._pdfViewer) return;
    this._zoomInput.value = `${Math.round(this._pdfViewer.currentScale * 100)}%`;
  }

  /** Parse the zoom input and apply it as an explicit numeric scale. */
  private _applyZoomInput(): void {
    if (!this._pdfViewer) return;
    const pct = parseInt(this._zoomInput.value.replace(/[^0-9.]/g, ''), 10);
    if (isNaN(pct) || pct <= 0) { this._syncZoomInput(); return; }
    const clamped = Math.max(25, Math.min(1000, pct));
    this._setScaleValue(String(clamped / 100));
    this._syncZoomInput();
  }

  private _showZoomPresets(x: number, y: number): void {
    this._dismissContextMenu();
    const presets = [50, 75, 100, 125, 150, 200, 400];
    const menu = ContextMenu.show({
      items: [
        ...presets.map((p) => ({ id: `zoom.${p}`, label: `${p}%` })),
        { id: 'zoom.page-width', label: 'Fit Width', group: 'fit' },
        { id: 'zoom.page-fit', label: 'Fit Page', group: 'fit' },
      ],
      anchor: { x, y },
    });
    menu.onDidSelect((e) => {
      const v = e.item.id.slice('zoom.'.length);
      if (v === 'page-width' || v === 'page-fit') this._setScaleValue(v);
      else this._setScaleValue(String(parseInt(v, 10) / 100));
      this._syncZoomInput();
    });
    this._activeContextMenu = menu;
  }

  // ── Reading modes (night invert / scroll mode) ───────────────────────

  private _toggleReadingDark(): void {
    this._readingDark = !this._readingDark;
    this._applyReadingDark();
    this._globalStorage?.set('parallx.pdfReadingDark', this._readingDark ? '1' : '0');
  }

  private _applyReadingDark(): void {
    if (!this._viewerContainer) return;
    this._viewerContainer.classList.toggle('pdf-reading-dark', this._readingDark);
    if (this._invertBtn) {
      this._invertBtn.classList.toggle('active', this._readingDark);
      this._invertBtn.innerHTML = this._readingDark ? ICON.sun : ICON.moon;
      labelButton(this._invertBtn, this._readingDark ? 'Day Reading' : 'Night Reading');
      this._invertBtn.setAttribute('aria-pressed', String(this._readingDark));
    }
  }

  // ── Rotation ─────────────────────────────────────────────────────────

  private _rotate(): void {
    if (!this._pdfViewer) return;
    this._pdfViewer.pagesRotation = (this._pdfViewer.pagesRotation + 90) % 360;
  }

  // ── Thumbnail sidebar ────────────────────────────────────────────────

  // ── Page labels ──────────────────────────────────────────────────────

  private _updatePageLabel(pageNum: number): void {
    if (!this._pageLabels) return;
    const label = this._pageLabels[pageNum - 1];
    if (label) {
      this._pageLabelEl.textContent = `(${label})`;
      show(this._pageLabelEl);
    } else {
      hide(this._pageLabelEl);
    }
  }

  // ── Print ────────────────────────────────────────────────────────────

  // The renderer hosts the whole workbench, so window.print() would print
  // the app chrome, and the Chromium PDF plugin is disabled. Hand the file
  // to the OS default PDF viewer, which prints with full fidelity.
  private _print(): void {
    if (!this._currentInput) return;
    const shell = (globalThis as any).parallxElectron?.shell;
    if (shell?.openPath) {
      void shell.openPath(this._currentInput.uri.fsPath);
    } else {
      window.print();
    }
  }

  // ── Open externally ──────────────────────────────────────────────────

  private _openExternal(): void {
    if (!this._currentInput) return;
    const shell = (globalThis as any).parallxElectron?.shell;
    if (shell?.openPath) {
      void shell.openPath(this._currentInput.uri.fsPath);
    } else if (shell?.showItemInFolder) {
      void shell.showItemInFolder(this._currentInput.uri.fsPath);
    }
  }

  // ── Text selection context menu ────────────────────────────────────

  /** Get the currently selected text in the PDF viewer. */
  getSelectedText(): string {
    return this._capturedSelection;
  }

  /** Get selection source metadata for the AI action system. */
  getSelectionSource(): { fileName: string; filePath: string; pageNumber?: number } | undefined {
    if (!this._capturedSelection || !this._currentInput) return undefined;
    return {
      fileName: this._currentInput.name,
      filePath: this._currentInput.uri.fsPath,
      pageNumber: this._pdfViewer?.currentPageNumber,
    };
  }

  private _wireContextMenu(): void {
    const controller = new AbortController();
    this._register(toDisposable(() => controller.abort()));

    // Show shared ContextMenu on mouseup when text is selected
    this._viewerContainer.addEventListener('mouseup', (e) => {
      // Left button only: a right-click's release would otherwise replace
      // the menu it just opened with the bubble.
      if (e.button !== 0) return;
      // Ignore mouseups that originate from our own overlay UI (highlight
      // margin tabs, the highlight popover, or the context menu itself) so
      // clicking those never re-triggers the text-selection context menu.
      if ((e.target as HTMLElement | null)?.closest('.pdf-highlight-tab, .pdf-highlight-popover, .context-menu')) {
        return;
      }
      requestAnimationFrame(() => {
        this._selectionOverlay.schedule();
        const sel = window.getSelection();
        const text = sel?.toString()?.trim() ?? '';
        if (text.length > 0) {
          this._capturedSelection = text;
          this._showSelectionBubble();
        } else {
          this._capturedSelection = '';
          this._dismissContextMenu();
        }
      });
    }, { signal: controller.signal });

    // A new press on the page starts a new selection: the bubble goes until
    // the button is released.
    this._viewerContainer.addEventListener('mousedown', (e) => {
      if (e.button === 0) this._dismissSelectionBubble();
    }, { signal: controller.signal });

    // Right-click on a selection: the full (short) menu.
    this._viewerContainer.addEventListener('contextmenu', (e) => {
      const text = window.getSelection()?.toString()?.trim() ?? '';
      if (!text) return;
      e.preventDefault();
      this._capturedSelection = text;
      this._showSelectionMenu(e.clientX, e.clientY);
    }, { signal: controller.signal });

    // Dismiss on scroll
    this._viewerContainer.addEventListener('scroll', () => {
      this._dismissContextMenu();
      this._selectionOverlay.schedule();
    }, { signal: controller.signal });
  }

  /**
   * The bubble over a fresh selection: highlight colours, Copy, Ask AI, Add to
   * Canvas Note, and ⋯ for the rest (the right-click menu). Shown on release,
   * never while dragging, so it never covers what is still being selected.
   */
  private _showSelectionBubble(): void {
    this._dismissContextMenu();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    if (!rect.width && !rect.height) return;

    const bubble = document.createElement('div');
    bubble.classList.add('pdf-selection-bubble');
    bubble.setAttribute('role', 'toolbar');
    bubble.setAttribute('aria-label', 'Selection');
    // Pressing a bubble button must not collapse the selection it acts on.
    bubble.addEventListener('mousedown', (e) => e.preventDefault());

    for (const c of HIGHLIGHT_COLORS) {
      const dot = document.createElement('button');
      dot.classList.add('pdf-selection-dot');
      dot.style.backgroundColor = highlightSolid(c.rgba);
      dot.setAttribute('aria-label', `Highlight ${c.label}`);
      setupTooltip(dot, `Highlight ${c.label}`);
      dot.addEventListener('click', () => {
        this._highlightStore.createFromSelection(c.key);
        this._dismissContextMenu();
      });
      bubble.appendChild(dot);
    }
    const sep = document.createElement('span');
    sep.classList.add('pdf-selection-sep');
    bubble.appendChild(sep);

    const act = (icon: string, label: string, run: () => void): void => {
      const b = pdfButton(icon, label);
      b.addEventListener('click', () => { run(); });
      bubble.appendChild(b);
    };
    act(ICON.copy, 'Copy (Ctrl+C)', () => {
      if (this._capturedSelection) void navigator.clipboard.writeText(this._capturedSelection);
      this._dismissContextMenu();
    });
    act(ICON.sparkles, 'Ask AI About Selection', () => { this._dismissContextMenu(); this._askAIAboutSelection(); });
    act(ICON.canvasNote, 'Add to Canvas Note', () => { this._dismissContextMenu(); this._captureSelectionToCanvas(); });
    act(ICON.more, 'More Actions', () => {
      const r = bubble.getBoundingClientRect();
      this._showSelectionMenu(r.right - 4, r.bottom + 4, true);
    });

    document.body.appendChild(bubble);
    bubble.style.visibility = 'hidden';
    const margin = 8;
    const bw = bubble.offsetWidth;
    const bh = bubble.offsetHeight;
    const host = this._viewerContainer.getBoundingClientRect();
    let left = Math.max(margin, Math.min(rect.left, window.innerWidth - bw - margin));
    // Above the selection; below it when there is no room under the toolbar.
    let top = rect.top - bh - 8;
    if (top < host.top + 4) top = rect.bottom + 8;
    top = Math.max(margin, Math.min(top, window.innerHeight - bh - margin));
    left = Math.round(left);
    bubble.style.left = `${left}px`;
    bubble.style.top = `${Math.round(top)}px`;
    bubble.style.visibility = '';
    this._selectionBubble = bubble;
  }

  private _dismissSelectionBubble(): void {
    this._selectionBubble?.remove();
    this._selectionBubble = null;
  }

  /**
   * The menu for a selection (right-click, or the bubble's ⋯). Highlight
   * colours sit in a submenu; `keepBubble` leaves the bubble up behind it.
   */
  private _showSelectionMenu(x: number, y: number, keepBubble = false): void {
    if (this._activeContextMenu) { this._activeContextMenu.dispose(); this._activeContextMenu = null; }
    if (!keepBubble) this._dismissSelectionBubble();

    const hasSel = this._capturedSelection.length > 0;
    const colourDot = (rgba: string) => (el: HTMLElement) => {
      el.style.display = 'inline-flex';
      el.style.alignItems = 'center';
      el.style.width = '16px';
      const dot = document.createElement('span');
      dot.classList.add('pdf-menu-dot');
      dot.style.backgroundColor = highlightSolid(rgba);
      el.appendChild(dot);
    };

    const menu = ContextMenu.show({
      items: [
        { id: 'pdf.copy', label: 'Copy', keybinding: 'Ctrl+C', disabled: !hasSel },
        {
          id: 'pdf.highlight',
          label: 'Highlight',
          disabled: !hasSel,
          submenu: HIGHLIGHT_COLORS.map((c) => ({
            id: `pdf.highlight.${c.key}`,
            label: c.label,
            renderIcon: colourDot(c.rgba),
          })),
        },
        { id: 'pdf.findInDocument', label: 'Find in Document', disabled: !hasSel },
        { id: 'canvas.captureNote', label: 'Add to Canvas Note', disabled: !hasSel, group: 'canvas' },
        { id: 'canvas.captureImage', label: 'Capture Region to Canvas', disabled: !hasSel, group: 'canvas' },
        // Inline AI — discuss the selection on the page (creates a highlight
        // and opens its review panel focused on the AI input).
        { id: 'ai.askInline', label: 'Ask AI About Selection', disabled: !hasSel, group: 'ai' },
        { id: 'ai.addToChat', label: 'Send to Chat', disabled: !hasSel, group: 'ai' },
        // Actions running tools added (selection-action dispatcher), e.g.
        // a study tool's "make a card"; none when no tool offers one.
        ...getToolSelectionActions().map((a) => ({ id: `sel:${a.actionId}`, label: a.label, disabled: !hasSel, group: 'ai' })),
      ],
      anchor: { x, y },
    });

    menu.onDidSelect((e) => {
      if (e.item.id === 'pdf.copy') {
        if (this._capturedSelection) {
          void navigator.clipboard.writeText(this._capturedSelection);
        }
      } else if (e.item.id === 'pdf.highlight') {
        this._highlightStore.createFromSelection();
      } else if (e.item.id.startsWith('pdf.highlight.')) {
        this._highlightStore.createFromSelection(e.item.id.slice('pdf.highlight.'.length));
      } else if (e.item.id === 'pdf.findInDocument') {
        const sel = this._capturedSelection.trim();
        if (sel) this._search?.find(sel);
      } else if (e.item.id === 'canvas.captureNote') {
        this._captureSelectionToCanvas();
      } else if (e.item.id === 'canvas.captureImage') {
        this._captureSelectionRegionToCanvas();
      } else if (e.item.id === 'ai.askInline') {
        this._askAIAboutSelection();
      } else if (e.item.id === 'ai.addToChat') {
        this._dispatchSelectionAction('add-to-chat');
      } else if (e.item.id.startsWith('sel:')) {
        this._dispatchSelectionAction(e.item.id.slice(4));
      }
      this._dismissSelectionBubble();
    });

    this._activeContextMenu = menu;
  }

  /**
   * Hand a highlight's saved AI discussion to the main chat panel so the user
   * can continue a larger conversation. Sends the passage text as the selection
   * and the full thread as conversation context (mirrors canvas inline-AI
   * "Send to Chat").
   */
  private _continueHighlightInChat(hl: PdfHighlight): void {
    if (!this._currentInput) return;
    const conversationContext = (hl.thread ?? [])
      .map((t) => `[${t.role === 'ai' ? 'assistant' : 'user'}]: ${t.text}`)
      .join('\n\n');

    const detail = {
      selectedText: hl.text || '(image selection)',
      surface: 'pdf',
      actionId: 'add-to-chat',
      conversationContext: conversationContext || undefined,
      source: {
        fileName: this._currentInput.name,
        filePath: this._currentInput.uri.fsPath,
        pageNumber: hl.page,
      },
    };

    this._viewerContainer.dispatchEvent(
      new CustomEvent('parallx-selection-action', { bubbles: true, detail }),
    );
  }

  /** Dispatch a selection action to the unified dispatcher. */
  private _dispatchSelectionAction(actionId: string): void {
    if (!this._capturedSelection || !this._currentInput) return;

    const detail = {
      selectedText: this._capturedSelection,
      surface: 'pdf',
      actionId,
      source: {
        fileName: this._currentInput.name,
        filePath: this._currentInput.uri.fsPath,
        pageNumber: this._pdfViewer?.currentPageNumber,
      },
    };

    // Fire a bubbling custom event — the workbench picks this up and
    // routes it to the SelectionActionDispatcher.
    this._viewerContainer.dispatchEvent(
      new CustomEvent('parallx-selection-action', { bubbles: true, detail }),
    );
  }

  /** Dismiss the selection menu and the selection bubble. */
  private _dismissContextMenu(): void {
    if (this._activeContextMenu) {
      this._activeContextMenu.dispose();
      this._activeContextMenu = null;
    }
    this._dismissSelectionBubble();
  }

  // ── Keyboard ─────────────────────────────────────────────────────────

  /**
   * Ctrl+F. The workbench keybinding service owns Ctrl+F (edit.find): it
   * catches the key in the capture phase, stops it, and calls showFind() on
   * the active pane — so the pane's own keydown never sees it.
   */
  showFind(): void {
    this._search?.toggle(true);
  }

  private _onKeyDown(e: KeyboardEvent): void {
    // Ctrl+F and Ctrl+P never arrive here: the workbench keybinding service
    // takes them first (edit.find → showFind() above; Ctrl+P is Go to File).
    // Print lives in the ⋯ menu.

    // Don't intercept keyboard when search input or page input is focused
    if (this._search?.ownsFocus() ||
        document.activeElement === this._pageInput) {
      return;
    }

    switch (e.key) {
      case 'ArrowRight': case 'PageDown':
        this._pdfViewer?.nextPage(); e.preventDefault(); break;
      case 'ArrowLeft': case 'PageUp':
        this._pdfViewer?.previousPage(); e.preventDefault(); break;
      case '+': case '=':
        if (e.ctrlKey || e.metaKey) { this._pdfViewer?.increaseScale(); e.preventDefault(); } break;
      case '-':
        if (e.ctrlKey || e.metaKey) { this._pdfViewer?.decreaseScale(); e.preventDefault(); } break;
      case '0':
        if (e.ctrlKey || e.metaKey) { this._setScaleValue('page-fit'); this._syncZoomInput(); e.preventDefault(); } break;
      case 'h': case 'H':
        if (!e.ctrlKey && !e.metaKey) {
          const sel = window.getSelection()?.toString()?.trim() ?? '';
          if (sel) { this._capturedSelection = sel; this._highlightStore.createFromSelection(); e.preventDefault(); }
        }
        break;
      case 'g':
        if (e.ctrlKey || e.metaKey) { this._pageInput.focus(); this._pageInput.select(); e.preventDefault(); } break;
      case 'r': case 'R':
        if (!e.ctrlKey && !e.metaKey) { this._rotate(); e.preventDefault(); } break;
      case 't': case 'T':
        if (!e.ctrlKey && !e.metaKey) { this._toggleThumbnails(); e.preventDefault(); } break;
      case 'Home':
        if (this._pdfViewer) { this._pdfViewer.currentPageNumber = 1; e.preventDefault(); } break;
      case 'End':
        if (this._pdfViewer) { this._pdfViewer.currentPageNumber = this._pdfViewer.pagesCount; e.preventDefault(); } break;
      case 'Escape':
        if (this._search?.isOpen) { this._search.toggle(false); e.preventDefault(); }
        else if (this._panelOpen) { this._togglePanel(false); e.preventDefault(); }
        break;
    }
  }

  // ── Lifecycle ────────────────────────────────────────────────────────

  protected override clearPaneContent(_previous: IEditorInput | undefined): void {
    this._cleanup();
  }

  protected override layoutPaneContent(_width: number, _height: number): void {
    if (this._pdfViewer && this._pdfDoc) {
      if (this._resizeTimer) clearTimeout(this._resizeTimer);
      this._resizeTimer = setTimeout(() => {
        // NEVER refit while a sash drag is still in progress. Layout calls
        // stream in per mousemove, so any micro-pause longer than the
        // debounce used to fire a full 'page-fit' recalculation mid-drag —
        // a page re-raster plus geometry shift plus a page-restore scroll,
        // under the user's hand. Adjacent panes became "impossible to
        // resize": every hesitation snapped the layout. The grid marks the
        // dragged sash with `.active` for exactly this kind of consumer;
        // while it is present, re-arm and wait for the drag to end.
        if (document.querySelector('.grid-sash.active')) {
          this._resizeTimer = setTimeout(() => this.layoutPaneContent(_width, _height), 150);
          return;
        }
        if (this._pdfViewer) {
          // Capture current page before re-applying scale — the scale
          // recalculation changes page geometry which can shift the scroll
          // position and cause PDFViewer to report a different page.
          const currentPage = this._pdfViewer.currentPageNumber;

          // Re-apply the current scale value — the viewer recalculates
          // 'page-width' / 'page-fit' / 'auto' to the new container size.
          this._pdfViewer.currentScaleValue = this._pdfViewer.currentScaleValue;
          this._pdfViewer.update();

          // Restore the page the user was on before the layout change.
          if (currentPage && this._pdfViewer.currentPageNumber !== currentPage) {
            this._pdfViewer.currentPageNumber = currentPage;
          }

          this._selectionOverlay.schedule();
          this._highlightStore.renderAll();
        }
      }, 150);
    }
  }

  private _cleanup(): void {
    // A new document gets a fresh pagesinit cycle; stale pending state from
    // the previous document must not apply to it.
    this._pagesInited = false;
    this._shownSinceLoad = false;
    this._pendingViewState = null;
    this._dismissContextMenu();
    if (this._resizeTimer) { clearTimeout(this._resizeTimer); this._resizeTimer = null; }

    // Write pending highlights and forget them.
    this._highlightStore.close();

    // Tear down viewer components. Once the first page has rendered, pdf.js
    // looks up every other page; destroying the document while those lookups
    // are in flight fails each one with a console error ("Unable to get page
    // N to initialize viewer"), as when a tab moves from one PDF to the next.
    // The document is destroyed once they settle, or after a few seconds when
    // they never started.
    const pagesSettled = this._pdfViewer?.pagesPromise ?? null;
    if (this._pdfViewer) {
      this._pdfViewer.cleanup();
    }
    this._pdfViewer = null;
    this._linkService = null;
    this._findController = null;
    this._eventBus = null;

    const doc = this._pdfDoc;
    this._pdfDoc = null;
    if (doc) {
      if (!pagesSettled) void doc.destroy();
      else void Promise.race([pagesSettled, new Promise((r) => setTimeout(r, PDF_DESTROY_GRACE_MS))]).then(() => doc.destroy());
    }

    this._viewerEl?.replaceChildren();
    this._outline?.clear();
    this._thumbs?.clear();
    this._selectionOverlay.clear();
    this._pageLabels = null;
    this._currentInput = null;
    this._removeTestDebugHook();

    // Reset UI
    this._search?.reset();
    this._outlineVisible = false;
    this._thumbnailVisible = false;
  }

  private _showError(msg: string): void {
    hide(this._loadingEl);
    hide(this._toolbar);
    hide(this._searchBar);
    show(this._errorEl);
    this._errorEl.textContent = msg;
  }
}
