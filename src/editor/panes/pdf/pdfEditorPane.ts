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
// The pane builds its DOM, loads pdf.js and owns the side panel and keys;
// each other part is a module in this folder: pdfToolbar(+Menus),
// pdfSearchBar, pdfOutline, pdfThumbnails, pdfHighlightStore(+Popover),
// pdfSelectionOverlay, -Menu and -Actions, pdfViewState, pdfDebugHook.

// ── pdf.js: types here, the library on the first PDF ───────────────────
// The display and viewer layers are their own bundle (src/vendor/pdfjs.ts),
// loaded by renderInput, so a boot with no PDF open never parses them.
import type { PDFViewer, EventBus, PDFLinkService, PDFFindController } from 'pdfjs-dist/web/pdf_viewer.mjs';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { loadPdfjs } from '../../../vendor/lazy.js';

type PdfVendor = Awaited<ReturnType<typeof loadPdfjs>>;
// ── CSS ─────────────────────────────────────────────────────────────────
import 'pdfjs-dist/web/pdf_viewer.css';
import './pdfEditorPane.css';

// ── App imports ─────────────────────────────────────────────────────────
import { EditorPane } from '../../../editor/editorPane.js';
import type { IEditorInput } from '../../../editor/editorInput.js';
import { PdfEditorInput } from './pdfEditorInput.js';
import { $, hide, show } from '../../../ui/dom.js';
import { beginPointerDrag, onDragPress } from '../../../ui/interactionMode.js';
import { registerKeyboardResize } from '../../../ui/keyboardResize.js';
import { ContextMenu } from '../../../ui/contextMenu.js';
import { toDisposable } from '../../../platform/lifecycle.js';
import type { IStorage } from '../../../platform/storage.js';
import type { IPaneCommandService, PdfOutlineItem } from './pdfTypes.js';
import { PdfHighlightStore } from './pdfHighlightStore.js';
import { PdfSelectionOverlay, selectionRectsOnLayer } from './pdfSelectionOverlay.js';
import { PdfSelectionActions } from './pdfSelectionActions.js';
import { PdfSelectionMenu } from './pdfSelectionMenu.js';
import { PdfToolbar } from './pdfToolbar.js';
import { showOverflowMenu, showZoomPresets } from './pdfToolbarMenus.js';
import { applyViewState, parseViewState, readViewState, type PdfViewState } from './pdfViewState.js';
import { installPdfDebugHook, removePdfDebugHook } from './pdfDebugHook.js';
import { SegmentedControl } from '../../../ui/segmentedControl.js';
import { declareControl } from '../../../ui/kit.js';
import { takeFileReveal } from '../../fileReveal.js';
import { PdfThumbnails } from './pdfThumbnails.js';
import { pageSource } from './pdfPassagePrompt.js';
import { PdfOutline } from './pdfOutline.js';
import { PdfSearchBar } from './pdfSearchBar.js';

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

  private _toolbarView: PdfToolbar | null = null;

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
    capturedText: () => this._selectionMenu?.capturedText ?? '',
    clearSelectionOverlay: () => this._selectionOverlay.clear(),
    continueInChat: (hl) => this._selectionActions.continueInChat(hl),
    pageSource: (n) => pageSource(this._pdfDoc, this._currentInput, n),
  });
  private readonly _selectionActions = new PdfSelectionActions({
    file: () => (this._currentInput ? { name: this._currentInput.name, fsPath: this._currentInput.uri.fsPath } : null),
    currentPage: () => this._pdfViewer?.currentPageNumber,
    capturedText: () => this._selectionMenu?.capturedText ?? '',
    viewerContainer: () => this._viewerContainer ?? null,
    pageView: (pageNumber) => this._getPageView(pageNumber),
    commands: () => this._commandService,
    highlights: this._highlightStore,
  });
  private _selectionMenu: PdfSelectionMenu | null = null;
  // ── M84: inline AI + canvas partnership ──────────────────────────────
  private _commandService: IPaneCommandService | undefined;

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
    return readViewState(this._pdfViewer, this._viewerContainer ?? null, this._scaleValue);
  }

  /**
   * Saved state arrives while pdf.js may still be parsing the document, so
   * it is stashed and applied on 'pagesinit' (or immediately when the pages
   * are already up — the workbench restores after setInput resolves, which
   * can land either side of pagesinit).
   */
  private _pendingViewState: PdfViewState | null = null;
  private _pagesInited = false;
  /**
   * The group has shown this document (laid out, view state restored). A
   * citation reveal needs this AND the pages laid out; whichever comes last
   * applies it, so a restore that lands after 'pagesinit' cannot undo it.
   */
  private _shownSinceLoad = false;

  protected override restorePaneViewState(state: Record<string, unknown>): void {
    this._pendingViewState = parseViewState(state);
    if (this._pagesInited) this._applyPendingViewState();
  }

  private _applyPendingViewState(): void {
    const pending = this._pendingViewState;
    if (!pending || !this._pdfViewer) return;
    this._pendingViewState = null;
    if (pending.scaleValue) this._scaleValue = pending.scaleValue;
    applyViewState(pending, this._pdfViewer, this._viewerContainer ?? null, this._pdfDoc?.numPages ?? 1);
    this._toolbarView?.showScale(this._pdfViewer.currentScale, this._pdfViewer.currentScaleValue);
  }

  // ── DOM setup ────────────────────────────────────────────────────────

  protected override createPaneContent(container: HTMLElement): void {
    container.classList.add('pdf-editor-pane');

    // Toolbar
    this._toolbar = $('div');
    this._toolbar.classList.add('pdf-toolbar');
    this._toolbarView = new PdfToolbar(this._toolbar, {
      previousPage: () => this._pdfViewer?.previousPage(),
      nextPage: () => this._pdfViewer?.nextPage(),
      goToPage: (pageNum) => { if (this._pdfViewer) this._pdfViewer.currentPageNumber = pageNum; },
      currentPage: () => this._pdfViewer?.currentPageNumber,
      zoomOut: () => this._pdfViewer?.decreaseScale(),
      zoomIn: () => this._pdfViewer?.increaseScale(),
      applyScale: (value) => this._setScaleValue(value),
      scale: () => (this._pdfViewer ? { scale: this._pdfViewer.currentScale, value: this._pdfViewer.currentScaleValue } : null),
      toggleFind: () => this._search?.toggle(),
      togglePanel: () => this._togglePanel(),
      toggleNight: () => this._toggleReadingDark(),
      showZoomPresets: (x, y) => this._showZoomPresets(x, y),
      showMore: (anchor) => this._showOverflowMenu(anchor),
    });
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
      selected: this._panelSide, ariaLabel: 'Show',
    }));
    this._register(declareControl(this._panelSwitch.element, { id: 'pdf.panelSide', label: 'Show', kind: 'segmented', state: () => ({ kind: 'value', value: this._panelSwitch.value }) }));
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
    this._selectionMenu = new PdfSelectionMenu(this._viewerContainer, {
      scheduleOverlay: () => this._selectionOverlay.schedule(),
      closeMenu: () => this._closeMenu(),
      setMenu: (menu) => { this._activeContextMenu = menu; },
      find: (query) => this._search?.find(query),
      actions: this._selectionActions,
      highlights: this._highlightStore,
    });
    // Its bubble lives on <body>; it goes with the pane.
    this._register(this._selectionMenu.listen());

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
      this._toolbarView?.setPage(page);
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

  // ── Toolbar ──────────────────────────────────────────────────────────

  /** The ⋯ menu: rotate, spread, scroll, print, open, and tools' entries. */
  private _showOverflowMenu(anchor: HTMLElement): void {
    this._dismissContextMenu();
    this._activeContextMenu = showOverflowMenu(anchor, {
      viewer: () => this._pdfViewer,
      modes: () => (this._pdf ? { SpreadMode: this._pdf.SpreadMode, ScrollMode: this._pdf.ScrollMode } : null),
      file: () => (this._currentInput ? { uri: this._currentInput.uri.toString(), fsPath: this._currentInput.uri.fsPath } : null),
      commands: () => this._commandService,
      rotate: () => this._rotate(),
    });
  }

  private _showZoomPresets(x: number, y: number): void {
    this._dismissContextMenu();
    this._activeContextMenu = showZoomPresets(x, y, (value) => {
      this._setScaleValue(value);
      this._toolbarView?.syncScale();
    });
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
    this._toolbarView?.setPanelOpen(open);
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

  /** Resize the outline by dragging its sash, or by the resize keys while focus is in it. */
  private _wireOutlineSash(): void {
    const setWidth = (w: number): number => {
      const next = Math.max(150, Math.min(500, w));
      this._outlineSidebar.style.width = `${next}px`;
      return next;
    };
    const save = (w: number) => this._globalStorage?.set('parallx.pdfOutlineWidth', String(w)); // fire-and-forget
    this._register(registerKeyboardResize(this._outlineSidebar, { axis: 'width', resize: (d) => {
      const before = this._outlineSidebar.offsetWidth, after = setWidth(before + d);
      save(after);
      return after !== before;
    } }));
    this._register(onDragPress(this._outlineSash, (startEvt: MouseEvent) => {
      startEvt.preventDefault();
      let startX = startEvt.clientX;
      let currentW = this._outlineSidebar.offsetWidth;
      this._outlineSash.classList.add('active');
      // Guarded drag (interactionMode.ts): every end path — release,
      // Escape, window blur — runs the one cleanup.
      beginPointerDrag(startEvt, {
        id: 'pdf-outline-sash',
        cursor: 'col-resize',
        onMove: (e) => { currentW = setWidth(currentW + e.clientX - startX); startX = e.clientX; },
        onEnd: () => { this._outlineSash.classList.remove('active'); save(currentW); },
      });
    }));
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
        this._toolbarView?.setPage(pageNum);
        this._updatePageLabel(pageNum);
        this._thumbs?.markActive(pageNum, this._thumbnailVisible);
        if (this._currentInput) this._currentInput.page = pageNum;
      });

      this._eventBus.on('scalechanging', (evt: any) => {
        this._toolbarView?.showScale(evt.scale, this._pdfViewer?.currentScaleValue);
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

        this._toolbarView?.showScale(this._pdfViewer!.currentScale, this._pdfViewer!.currentScaleValue);
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
      installPdfDebugHook({
        viewer: () => this._pdfViewer,
        container: () => this._viewerContainer ?? null,
        setScaleValue: (value) => this._setScaleValue(value),
      });

      // Update toolbar page count
      this._toolbarView?.setPageCount(this._pdfDoc.numPages);
      this._toolbarView?.setPage(1);

      // ── Load page labels ───────────────────────────────────────────

      const labels = await this._pdfDoc.getPageLabels();
      if (labels && labels.some((l: string | null) => l !== null)) {
        this._pageLabels = labels;
        this._updatePageLabel(1);
      } else {
        this._pageLabels = null;
        this._toolbarView?.setPageLabel(null);
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

  // ── Reading modes (night invert / scroll mode) ───────────────────────

  private _toggleReadingDark(): void {
    this._readingDark = !this._readingDark;
    this._applyReadingDark();
    this._globalStorage?.set('parallx.pdfReadingDark', this._readingDark ? '1' : '0');
  }

  private _applyReadingDark(): void {
    if (!this._viewerContainer) return;
    this._viewerContainer.classList.toggle('pdf-reading-dark', this._readingDark);
    this._toolbarView?.setNight(this._readingDark);
  }

  // ── Rotation ─────────────────────────────────────────────────────────

  private _rotate(): void {
    if (!this._pdfViewer) return;
    this._pdfViewer.pagesRotation = (this._pdfViewer.pagesRotation + 90) % 360;
  }

  // ── Page labels ──────────────────────────────────────────────────────

  private _updatePageLabel(pageNum: number): void {
    if (!this._pageLabels) return;
    this._toolbarView?.setPageLabel(this._pageLabels[pageNum - 1]);
  }

  // ── Text selection context menu ────────────────────────────────────

  /** Get the currently selected text in the PDF viewer. */
  getSelectedText(): string {
    return this._selectionMenu?.capturedText ?? '';
  }

  /** Get selection source metadata for the AI action system. */
  getSelectionSource(): { fileName: string; filePath: string; pageNumber?: number } | undefined {
    if (!this.getSelectedText() || !this._currentInput) return undefined;
    return {
      fileName: this._currentInput.name,
      filePath: this._currentInput.uri.fsPath,
      pageNumber: this._pdfViewer?.currentPageNumber,
    };
  }

  /** Close the open menu (selection, overflow or zoom). */
  private _closeMenu(): void {
    this._activeContextMenu?.dispose();
    this._activeContextMenu = null;
  }

  /** Close the open menu and the selection bubble. */
  private _dismissContextMenu(): void {
    this._closeMenu();
    this._selectionMenu?.dismissBubble();
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
        this._toolbarView?.ownsFocus()) {
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
        if (e.ctrlKey || e.metaKey) { this._setScaleValue('page-fit'); this._toolbarView?.syncScale(); e.preventDefault(); } break;
      case 'h': case 'H':
        if (!e.ctrlKey && !e.metaKey) {
          const sel = window.getSelection()?.toString()?.trim() ?? '';
          if (sel) { this._selectionMenu?.capture(sel); this._highlightStore.createFromSelection(); e.preventDefault(); }
        }
        break;
      case 'g':
        if (e.ctrlKey || e.metaKey) { this._toolbarView?.focusPage(); e.preventDefault(); } break;
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
    removePdfDebugHook();

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
