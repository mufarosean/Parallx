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

// ── Bootstrap: pdf_viewer.mjs requires globalThis.pdfjsLib ──────────────
import './pdfViewerBootstrap.js';

// ── PDF.js Viewer layer ─────────────────────────────────────────────────
import {
  PDFViewer,
  EventBus,
  PDFLinkService,
  PDFFindController,
  GenericL10n,
  FindState,
  SpreadMode,
  ScrollMode,
} from 'pdfjs-dist/web/pdf_viewer.mjs';

// ── PDF.js Display layer (for getDocument) ──────────────────────────────
import * as pdfjsLib from 'pdfjs-dist';
import { AnnotationMode } from 'pdfjs-dist';

// ── CSS ─────────────────────────────────────────────────────────────────
import 'pdfjs-dist/web/pdf_viewer.css';
import './pdfEditorPane.css';

// ── App imports ─────────────────────────────────────────────────────────
import { EditorPane } from '../../editor/editorPane.js';
import type { IEditorInput } from '../../editor/editorInput.js';
import { PdfEditorInput } from './pdfEditorInput.js';
import { $, hide, show } from '../../ui/dom.js';
import { beginPointerDrag } from '../../ui/interactionMode.js';
import { ContextMenu } from '../../ui/contextMenu.js';
import { toDisposable } from '../../platform/lifecycle.js';
import type { IStorage } from '../../platform/storage.js';
import { getIcon } from '../../ui/iconRegistry.js';
import { setupTooltip } from '../../ui/tooltip.js';
import type { IChatMessage, IChatResponseChunk } from '../../services/chatTypes.js';

// Inline-AI provider shape (chat extension's `chat.getInlineAIProvider`).
type InlineAISendChat = (
  messages: readonly IChatMessage[],
  options?: { temperature?: number; maxTokens?: number },
  signal?: AbortSignal,
) => AsyncIterable<IChatResponseChunk>;
type InlineAIProvider = {
  sendChatRequest: InlineAISendChat;
  retrieveContext?: (query: string) => Promise<string | undefined>;
};

// Minimal command-service shape the pane needs (avoids a hard service import).
interface IPaneCommandService {
  executeCommand<T = unknown>(id: string, ...args: unknown[]): Promise<T>;
}

const PANE_ID = 'pdf-editor-pane';
const PDFJS_CMAP_URL = './dist/renderer/pdfjs/cmaps/';
const PDFJS_STANDARD_FONT_URL = './dist/renderer/pdfjs/standard_fonts/';
const PDFJS_WASM_URL = './dist/renderer/pdfjs/wasm/';

// TextLayerMode is not exported from pdf_viewer.mjs
const TEXT_LAYER_ENABLE = 1;

// ─── SVG icons — from the central Lucide icon registry ─────────────────────

const ICON = {
  chevronLeft:  getIcon('chevron-left')!,
  chevronRight: getIcon('chevron-right')!,
  chevronUp:    getIcon('chevron-up')!,
  chevronDown:  getIcon('chevron-down')!,
  zoomOut:      getIcon('zoom-out')!,
  zoomIn:       getIcon('zoom-in')!,
  fitWidth:     getIcon('fit-width')!,
  fitPage:      getIcon('fit-page')!,
  search:       getIcon('search')!,
  listTree:     getIcon('list-tree')!,
  grid:         getIcon('grid')!,
  more:         getIcon('ellipsis')!,
  check:        getIcon('check')!,
  close:        getIcon('close')!,
  chevronDownSm:getIcon('chevron-down')!,
  highlighter:  getIcon('highlighter')!,
  note:         getIcon('sticky-note')!,
  moon:         getIcon('moon')!,
  sun:          getIcon('sun')!,
  chat:         getIcon('message-circle')!,
  sparkles:     getIcon('px-ai-mark')!,
  openExtSm:    getIcon('external-link')!,
} as const;

// ─── Highlight palette ─────────────────────────────────────────────────────
// Stored by key; rendered with the rgba value. Order = swatch order.
const HIGHLIGHT_COLORS: ReadonlyArray<{ key: string; label: string; rgba: string }> = [
  { key: 'yellow', label: 'Yellow', rgba: 'rgba(255, 214, 64, 0.40)' },
  { key: 'green',  label: 'Green',  rgba: 'rgba(118, 214, 122, 0.40)' },
  { key: 'blue',   label: 'Blue',   rgba: 'rgba(96, 170, 255, 0.38)' },
  { key: 'pink',   label: 'Pink',   rgba: 'rgba(255, 128, 191, 0.38)' },
  { key: 'orange', label: 'Orange', rgba: 'rgba(255, 167, 64, 0.40)' },
];
function highlightRgba(key: string): string {
  return (HIGHLIGHT_COLORS.find((c) => c.key === key) ?? HIGHLIGHT_COLORS[0]).rgba;
}

// ─── Outline types ───────────────────────────────────────────────────────

interface PdfOutlineItem {
  title: string;
  bold: boolean;
  italic: boolean;
  dest: string | any[] | null;
  url: string | null;
  items: PdfOutlineItem[];
}

interface SelectionOverlayRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

// A highlight rectangle stored in PDF user-space (rotation/scale independent).
interface PdfHighlightRect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

// M84: one saved turn of the per-highlight AI discussion (a review record,
// not a live session).
interface PdfHighlightThreadTurn {
  role: 'user' | 'ai';
  text: string;
  at: number;
}

// M84: a canvas page this highlight's passage was captured to.
interface PdfHighlightCanvasLink {
  pageId: string;
  title: string;
  at: number;
}

interface PdfHighlight {
  id: string;
  page: number;          // 1-based
  color: string;         // HIGHLIGHT_COLORS key
  rects: PdfHighlightRect[];
  text: string;          // captured selection text (for reference/export)
  note: string;          // optional margin note
  thread?: PdfHighlightThreadTurn[];      // M84: saved AI discussion
  canvasLinks?: PdfHighlightCanvasLink[]; // M84: pages this became
  createdAt: number;
}

// One reversible highlight action for the undo/redo stacks. `highlights` is a
// deep copy so a deleted highlight can be fully restored on undo.
interface PdfHighlightAction {
  kind: 'create' | 'delete';
  highlights: PdfHighlight[];
}

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
  private _capturedSelection = '';  // text captured at context-menu show time

  // Toolbar elements
  private _pageInput!: HTMLInputElement;
  private _pageLabelEl!: HTMLElement;
  private _pageTotalEl!: HTMLElement;
  private _outlineBtn!: HTMLButtonElement;
  private _thumbBtn!: HTMLButtonElement;
  private _invertBtn!: HTMLButtonElement;
  private _fitBtn!: HTMLButtonElement;
  private _zoomInput!: HTMLInputElement;

  // Search bar elements
  private _searchInput!: HTMLInputElement;
  private _matchCountEl!: HTMLElement;
  private _searchVisible = false;

  // Outline
  private _outlineVisible = false;
  private _outline: PdfOutlineItem[] | null = null;

  // Thumbnails
  private _thumbnailVisible = false;
  private _thumbObserver: IntersectionObserver | null = null;
  private _thumbCanvases: Map<number, HTMLCanvasElement> = new Map();
  private _activeThumb: HTMLElement | null = null;

  // Page labels
  private _pageLabels: string[] | null = null;

  // ── PDF.js components ────────────────────────────────────────────────
  private _eventBus: EventBus | null = null;
  private _linkService: PDFLinkService | null = null;
  private _findController: PDFFindController | null = null;
  private _pdfViewer: PDFViewer | null = null;
  private _pdfDoc: pdfjsLib.PDFDocumentProxy | null = null;

  // ── State ────────────────────────────────────────────────────────────
  private _scaleValue = 'page-fit';  // default fit mode
  private _resizeTimer: ReturnType<typeof setTimeout> | null = null;
  private _currentInput: PdfEditorInput | null = null;
  private _selectionOverlayFrame: number | null = null;
  private _globalStorage: IStorage | undefined;

  // ── Reading modes ────────────────────────────────────────────────────
  private _readingDark = false;

  // ── Highlights / margin notes ────────────────────────────────────────
  private _highlights: PdfHighlight[] = [];
  private _highlightColor = 'yellow';   // last-used color
  private _fileKey = '';                // storage key suffix (file path)
  private _highlightSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private _activeHighlightPopover: HTMLElement | null = null;
  /** Cleanup for the active popover's outside-click dismiss listener. */
  private _highlightPopoverDismiss: (() => void) | null = null;
  // Undo/redo for highlight create + delete. Each entry holds the action kind
  // and a deep copy of the affected highlights so it can be replayed in either
  // direction. A single selection can span pages → several highlights per entry.
  private _highlightUndoStack: PdfHighlightAction[] = [];
  private _highlightRedoStack: PdfHighlightAction[] = [];

  // ── M84: inline AI + canvas partnership ──────────────────────────────
  private _commandService: IPaneCommandService | undefined;
  private _inlineAIProvider: InlineAIProvider | null = null;
  private _inlineAILoaded = false;
  private _aiAbort: AbortController | null = null;

  // ── View state (page + scale persistence) ────────────────────────────

  constructor() {
    super(PANE_ID);
  }

  /** M53 D3.4: Late-bind global storage for preference persistence. */
  setGlobalStorage(storage: IStorage): void {
    this._globalStorage = storage;
  }

  /** M84: Late-bind the command service so the pane can reach the chat
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

    // Search bar (hidden by default)
    this._searchBar = $('div');
    this._searchBar.classList.add('pdf-search-bar');
    this._buildSearchBar();
    hide(this._searchBar);
    container.appendChild(this._searchBar);

    // Body: outline + viewer
    const body = $('div');
    body.classList.add('pdf-body');
    container.appendChild(body);

    // Outline sidebar (hidden by default)
    this._outlineSidebar = $('div');
    this._outlineSidebar.classList.add('pdf-outline-sidebar');
    hide(this._outlineSidebar);
    body.appendChild(this._outlineSidebar);

    // Outline resize sash (hidden with sidebar)
    this._outlineSash = $('div');
    this._outlineSash.classList.add('pdf-outline-sash');
    hide(this._outlineSash);
    this._wireOutlineSash();
    body.appendChild(this._outlineSash);

    const outlineHeader = $('div');
    outlineHeader.classList.add('pdf-outline-header');
    outlineHeader.textContent = 'Outline';
    this._outlineSidebar.appendChild(outlineHeader);

    this._outlineTree = $('div');
    this._outlineTree.classList.add('pdf-outline-tree');
    this._outlineSidebar.appendChild(this._outlineTree);

    // Thumbnail sidebar (hidden by default)
    this._thumbnailSidebar = $('div');
    this._thumbnailSidebar.classList.add('pdf-thumbnail-sidebar');
    hide(this._thumbnailSidebar);
    body.appendChild(this._thumbnailSidebar);

    const thumbHeader = $('div');
    thumbHeader.classList.add('pdf-outline-header');
    thumbHeader.textContent = 'Pages';
    this._thumbnailSidebar.appendChild(thumbHeader);

    this._thumbnailList = $('div');
    this._thumbnailList.classList.add('pdf-thumbnail-list');
    this._thumbnailSidebar.appendChild(this._thumbnailList);

    // Viewer wrapper (flex child that takes remaining space;
    // provides position: relative context for the absolutely-positioned container)
    const viewerWrapper = document.createElement('div');
    viewerWrapper.classList.add('pdf-viewer-wrapper');
    body.appendChild(viewerWrapper);

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
    this._wireSelectionOverlay();
    this._wireContextMenu();

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
      if (this._undoHighlight()) e.preventDefault();
    };
    const onEditRedo = (e: Event): void => {
      if (!this._ownsEditFocus()) return;
      if (this._redoHighlight()) e.preventDefault();
    };
    document.addEventListener('parallx:edit-undo', onEditUndo);
    document.addEventListener('parallx:edit-redo', onEditRedo);
    this._register(toDisposable(() => {
      document.removeEventListener('parallx:edit-undo', onEditUndo);
      document.removeEventListener('parallx:edit-redo', onEditRedo);
    }));

    // M66 Iter B — Listen for `parallx:pdf-reveal` deep-link requests. The
    // explorer link contract dispatches `{filePath, page?, quote?}` after
    // openFileEditor() resolves; this pane reacts only when the filePath
    // matches its currently loaded input. Best-effort, non-fatal.
    const revealController = new AbortController();
    this._register(toDisposable(() => revealController.abort()));
    window.addEventListener('parallx:pdf-reveal', (ev: Event) => {
      const detail = (ev as CustomEvent<{ filePath?: string; page?: number; quote?: string }>).detail;
      if (!detail) return;
      const ownPath = this._currentInput?.uri.fsPath;
      if (!ownPath || !detail.filePath) return;
      // Normalize slashes for cross-platform compare.
      const a = ownPath.replace(/\\/g, '/').toLowerCase();
      const b = detail.filePath.replace(/\\/g, '/').toLowerCase();
      if (a !== b) return;
      this._applyLinkReveal(detail.page, detail.quote);
    }, { signal: revealController.signal });
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

  private _wireSelectionOverlay(): void {
    const controller = new AbortController();
    this._register(toDisposable(() => controller.abort()));

    document.addEventListener('selectionchange', () => this._scheduleSelectionOverlayUpdate(), {
      signal: controller.signal,
    });

    window.addEventListener('resize', () => this._scheduleSelectionOverlayUpdate(), {
      signal: controller.signal,
    });
  }

  private _scheduleSelectionOverlayUpdate(): void {
    if (this._selectionOverlayFrame !== null) {
      return;
    }

    this._selectionOverlayFrame = requestAnimationFrame(() => {
      this._selectionOverlayFrame = requestAnimationFrame(() => {
        this._selectionOverlayFrame = null;
        this._updateSelectionOverlay();
      });
    });
  }

  private _updateSelectionOverlay(): void {
    this._clearSelectionOverlay();

    const selection = globalThis.getSelection?.();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0 || !this._viewerContainer) {
      return;
    }

    const textLayers = Array.from(this._viewerContainer.querySelectorAll<HTMLElement>('.textLayer'));
    for (const textLayer of textLayers) {
      const rects = this._collectSelectionRectsForTextLayer(selection, textLayer);
      if (rects.length === 0) {
        continue;
      }

      const mergedRects = this._mergeSelectionOverlayRects(rects);
      if (mergedRects.length === 0) {
        continue;
      }

      const overlayRoot = this._createSelectionOverlayRoot(textLayer);
      if (!overlayRoot) {
        continue;
      }

      for (const rect of mergedRects) {
        const box = document.createElement('div');
        box.classList.add('pdf-selection-overlay-box');
        box.style.left = `${rect.left}px`;
        box.style.top = `${rect.top}px`;
        box.style.width = `${rect.width}px`;
        box.style.height = `${rect.height}px`;
        overlayRoot.appendChild(box);
      }
    }
  }

  private _clearSelectionOverlay(): void {
    if (this._selectionOverlayFrame !== null) {
      cancelAnimationFrame(this._selectionOverlayFrame);
      this._selectionOverlayFrame = null;
    }

    this._viewerContainer?.querySelectorAll('.pdf-selection-overlay-root').forEach((node) => node.remove());
  }

  private _collectSelectionRectsForTextLayer(selection: Selection, textLayer: HTMLElement): SelectionOverlayRect[] {
    const textLayerRect = textLayer.getBoundingClientRect();
    if (textLayerRect.width === 0 || textLayerRect.height === 0) {
      return [];
    }

    // PDF.js makes its endOfContent element selectable (user-select: text)
    // and sizes it to the full text layer during active selection.  When the
    // selection range includes endOfContent, getClientRects() returns a rect
    // covering the _entire_ page — which our overlay draws as a page-sized
    // blue box (the "blue flash").  Normal text selection rects are at most
    // one line tall, so we filter out any rect taller than half the text
    // layer height.
    const maxRectHeight = textLayerRect.height * 0.5;

    const rects: SelectionOverlayRect[] = [];
    for (let index = 0; index < selection.rangeCount; index += 1) {
      const range = selection.getRangeAt(index);
      if (!range.intersectsNode(textLayer)) {
        continue;
      }

      for (const rect of Array.from(range.getClientRects())) {
        const clippedRect = this._clipRectToBounds(rect, textLayerRect);
        if (!clippedRect) {
          continue;
        }

        if (clippedRect.height > maxRectHeight) {
          continue;
        }

        rects.push({
          left: clippedRect.left - textLayerRect.left,
          top: clippedRect.top - textLayerRect.top,
          width: clippedRect.width,
          height: clippedRect.height,
        });
      }
    }

    return rects;
  }

  private _clipRectToBounds(rect: DOMRect | ClientRect, bounds: DOMRect): SelectionOverlayRect | null {
    const left = Math.max(rect.left, bounds.left);
    const top = Math.max(rect.top, bounds.top);
    const right = Math.min(rect.right, bounds.right);
    const bottom = Math.min(rect.bottom, bounds.bottom);
    const width = right - left;
    const height = bottom - top;

    if (width <= 0.5 || height <= 0.5) {
      return null;
    }

    return { left, top, width, height };
  }

  private _mergeSelectionOverlayRects(rects: SelectionOverlayRect[]): SelectionOverlayRect[] {
    const sortedRects = [...rects].sort((a, b) => {
      const centerYDelta = (a.top + a.height / 2) - (b.top + b.height / 2);
      if (Math.abs(centerYDelta) > 1.5) {
        return centerYDelta;
      }
      return a.left - b.left;
    });

    const lines: Array<{ centerY: number; rects: SelectionOverlayRect[] }> = [];
    for (const rect of sortedRects) {
      const centerY = rect.top + rect.height / 2;
      const line = lines.find((candidate) => {
        const referenceHeight = candidate.rects.reduce((sum, value) => sum + value.height, 0) / candidate.rects.length;
        const tolerance = Math.max(3, referenceHeight * 0.45);
        return Math.abs(candidate.centerY - centerY) <= tolerance;
      });

      if (line) {
        line.rects.push({ ...rect });
        line.centerY = (line.centerY * (line.rects.length - 1) + centerY) / line.rects.length;
      } else {
        lines.push({ centerY, rects: [{ ...rect }] });
      }
    }

    const mergedRects: SelectionOverlayRect[] = [];
    for (const line of lines) {
      const lineRects = line.rects.sort((a, b) => a.left - b.left);
      const averageHeight = lineRects.reduce((sum, value) => sum + value.height, 0) / lineRects.length;
      const gapTolerance = Math.max(6, Math.min(40, averageHeight * 1.5));
      let currentRect: SelectionOverlayRect | null = null;

      for (const rect of lineRects) {
        if (!currentRect) {
          currentRect = { ...rect };
          continue;
        }

        const currentRight = currentRect.left + currentRect.width;
        const rectRight = rect.left + rect.width;
        const gap = rect.left - currentRight;

        if (gap <= gapTolerance) {
          const mergedLeft = Math.min(currentRect.left, rect.left);
          const mergedTop = Math.min(currentRect.top, rect.top);
          const mergedRight = Math.max(currentRight, rectRight);
          const mergedBottom = Math.max(currentRect.top + currentRect.height, rect.top + rect.height);
          currentRect = {
            left: mergedLeft,
            top: mergedTop,
            width: mergedRight - mergedLeft,
            height: mergedBottom - mergedTop,
          };
          continue;
        }

        mergedRects.push(currentRect);
        currentRect = { ...rect };
      }

      if (currentRect) {
        mergedRects.push(currentRect);
      }
    }

    return mergedRects;
  }

  private _createSelectionOverlayRoot(textLayer: HTMLElement): HTMLElement | null {
    const overlayRoot = document.createElement('div');
    overlayRoot.classList.add('pdf-selection-overlay-root');
    textLayer.insertBefore(overlayRoot, textLayer.firstChild);
    return overlayRoot;
  }

  // ── Persistent highlights / margin notes ─────────────────────────────

  private _highlightStorageKey(): string {
    return `parallx.pdfHighlights:${this._fileKey}`;
  }

  private async _loadHighlights(): Promise<void> {
    this._highlights = [];
    if (!this._globalStorage || !this._fileKey) return;
    try {
      const raw = await this._globalStorage.get(this._highlightStorageKey());
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) this._highlights = parsed as PdfHighlight[];
      }
    } catch (err) {
      console.warn('[PdfEditorPane] Failed to load highlights:', err);
    }
  }

  private _saveHighlights(): void {
    if (!this._globalStorage || !this._fileKey) return;
    if (this._highlightSaveTimer) clearTimeout(this._highlightSaveTimer);
    this._highlightSaveTimer = setTimeout(() => {
      this._highlightSaveTimer = null;
      void this._globalStorage?.set(this._highlightStorageKey(), JSON.stringify(this._highlights));
    }, 300);
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

  /** Create highlight(s) from the live text selection, one per spanned page. */
  private _createHighlightFromSelection(colorKey: string): PdfHighlight[] {
    const selection = globalThis.getSelection?.();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0 || !this._viewerContainer) return [];
    this._highlightColor = colorKey;

    const textLayers = Array.from(this._viewerContainer.querySelectorAll<HTMLElement>('.textLayer'));
    const created: PdfHighlight[] = [];
    const removed: PdfHighlight[] = [];
    for (const textLayer of textLayers) {
      const pageEl = textLayer.closest<HTMLElement>('.page');
      const pageNumber = pageEl ? parseInt(pageEl.dataset.pageNumber ?? '', 10) : NaN;
      if (!Number.isFinite(pageNumber)) continue;

      const rects = this._collectSelectionRectsForTextLayer(selection, textLayer);
      if (rects.length === 0) continue;
      const merged = this._mergeSelectionOverlayRects(rects);
      if (merged.length === 0) continue;

      const viewport = this._getPageView(pageNumber)?.viewport;
      if (!viewport?.convertToPdfPoint) continue;

      const pdfRects: PdfHighlightRect[] = merged.map((r) => {
        const [x1, y1] = viewport.convertToPdfPoint(r.left, r.top);
        const [x2, y2] = viewport.convertToPdfPoint(r.left + r.width, r.top + r.height);
        return { x1, y1, x2, y2 };
      });

      // No layering: re-highlighting an overlapping region toggles or recolors
      // the existing highlight instead of stacking a second one on top.
      //   • same color  → remove it (toggle off)
      //   • diff color  → replace it (the new color takes over)
      const existing = this._highlights.find(
        (h) => h.page === pageNumber && this._rectsOverlap(h.rects, pdfRects),
      );
      if (existing) {
        removed.push(existing);
        if (existing.color === colorKey) continue; // toggle off — nothing new
      }

      created.push({
        id: `hl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        page: pageNumber,
        color: colorKey,
        rects: pdfRects,
        text: this._capturedSelection,
        note: existing?.note ?? '',
        thread: existing?.thread,
        canvasLinks: existing?.canvasLinks,
        createdAt: existing?.createdAt ?? Date.now(),
      });
    }

    // Apply removals first (toggle-off), then additions.
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
    this._saveHighlights();
    selection.removeAllRanges();
    this._clearSelectionOverlay();
    const touchedPages = new Set([...created, ...removed].map((h) => h.page));
    for (const page of touchedPages) {
      this._renderHighlightsForPage(page);
    }
    return created;
  }

  /**
   * Whether two highlight rect-sets overlap enough to be considered the "same"
   * highlight (for toggle-off). Uses intersection area over the smaller
   * rect-set's area, so re-selecting roughly the same passage matches even if
   * the new selection is a little tighter or looser.
   */
  private _rectsOverlap(a: readonly PdfHighlightRect[], b: readonly PdfHighlightRect[]): boolean {
    const area = (rs: readonly PdfHighlightRect[]): number =>
      rs.reduce((sum, r) => sum + Math.abs(r.x2 - r.x1) * Math.abs(r.y2 - r.y1), 0);
    let intersection = 0;
    for (const r1 of a) {
      const ax1 = Math.min(r1.x1, r1.x2), ax2 = Math.max(r1.x1, r1.x2);
      const ay1 = Math.min(r1.y1, r1.y2), ay2 = Math.max(r1.y1, r1.y2);
      for (const r2 of b) {
        const bx1 = Math.min(r2.x1, r2.x2), bx2 = Math.max(r2.x1, r2.x2);
        const by1 = Math.min(r2.y1, r2.y2), by2 = Math.max(r2.y1, r2.y2);
        const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(ax1, bx1));
        const iy = Math.max(0, Math.min(ay2, by2) - Math.max(ay1, by1));
        intersection += ix * iy;
      }
    }
    const smaller = Math.min(area(a), area(b));
    return smaller > 0 && intersection / smaller >= 0.5;
  }

  private _renderAllHighlights(): void {
    if (!this._viewerContainer) return;
    for (const page of new Set(this._highlights.map((h) => h.page))) {
      this._renderHighlightsForPage(page);
    }
  }

  private _renderHighlightsForPage(pageNumber: number): void {
    const pageView = this._getPageView(pageNumber);
    const pageEl: HTMLElement | undefined = pageView?.div;
    const viewport = pageView?.viewport;
    if (!pageEl || !viewport?.convertToViewportPoint) return;

    // Remove the previous box layer AND any previously-rendered margin tabs.
    pageEl.querySelector('.pdf-highlight-layer')?.remove();
    pageEl.querySelectorAll('.pdf-highlight-tab').forEach((n) => n.remove());

    const pageHighlights = this._highlights.filter((h) => h.page === pageNumber);
    if (pageHighlights.length === 0) return;

    const layer = document.createElement('div');
    layer.classList.add('pdf-highlight-layer');

    // Tabs are appended directly to the page (a sibling of the box layer), NOT
    // inside the `pointer-events: none` layer — keeping them in an interactive
    // container guarantees clicks land even though the box layer ignores them.
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
        // Bake the margin offset into the pixel position (no CSS transform), so
        // the tab sits at the exact same spot on every render and never shifts
        // as the SVG icon loads or the page re-renders.
        tab.style.left = `${firstBox.left - 18}px`;
        tab.style.top = `${firstBox.top - 2}px`;
        // Icon reflects the richest state: discussion > note > plain highlight.
        tab.innerHTML = hasThread ? ICON.chat : hl.note ? ICON.note : ICON.highlighter;
        // Open the review panel on mousedown (which always fires for this
        // element) rather than click, so a re-render of the box layer between
        // mousedown and mouseup can never swallow the gesture. stopPropagation
        // keeps the viewer's selection/mouseup handlers from reacting.
        tab.addEventListener('mousedown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this._showHighlightPopover(hl, (e.currentTarget as HTMLElement).getBoundingClientRect());
        });
        tab.addEventListener('mouseup', (e) => { e.stopPropagation(); });
        tab.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); });
        tabs.push(tab);
      }
    }

    pageEl.appendChild(layer);
    for (const tab of tabs) pageEl.appendChild(tab);
  }

  private _showHighlightPopover(hl: PdfHighlight, anchor: DOMRect): void {
    this._dismissHighlightPopover();
    const pop = document.createElement('div');
    pop.classList.add('pdf-highlight-popover');

    const swatches = document.createElement('div');
    swatches.classList.add('pdf-highlight-swatches');
    for (const c of HIGHLIGHT_COLORS) {
      const sw = document.createElement('button');
      sw.classList.add('pdf-highlight-swatch');
      if (c.key === hl.color) sw.classList.add('selected');
      sw.style.backgroundColor = c.rgba;
      setupTooltip(sw, c.label);
      sw.addEventListener('click', () => {
        hl.color = c.key;
        this._highlightColor = c.key;
        this._saveHighlights();
        this._renderHighlightsForPage(hl.page);
        swatches.querySelectorAll('.pdf-highlight-swatch').forEach((n) => n.classList.remove('selected'));
        sw.classList.add('selected');
      });
      swatches.appendChild(sw);
    }
    pop.appendChild(swatches);

    const ta = document.createElement('textarea');
    ta.classList.add('pdf-highlight-note');
    ta.placeholder = 'Add a note\u2026';
    ta.value = hl.note;
    ta.addEventListener('input', () => {
      hl.note = ta.value;
      this._saveHighlights();
    });
    pop.appendChild(ta);

    // M84: linked canvas pages — open them in the canvas editor.
    if (hl.canvasLinks && hl.canvasLinks.length > 0) {
      const section = document.createElement('div');
      section.classList.add('pdf-highlight-section');
      const label = document.createElement('div');
      label.classList.add('pdf-highlight-section-label');
      label.textContent = 'On canvas';
      section.appendChild(label);
      for (const link of hl.canvasLinks) {
        const row = document.createElement('button');
        row.classList.add('pdf-highlight-link');
        row.innerHTML = `<span class="pdf-highlight-link-icon">${ICON.openExtSm}</span><span class="pdf-highlight-link-title"></span>`;
        row.querySelector('.pdf-highlight-link-title')!.textContent = link.title || 'Untitled';
        row.addEventListener('click', () => {
          void this._commandService?.executeCommand('canvas.openPage', link.pageId);
        });
        section.appendChild(row);
      }
      pop.appendChild(section);
    }

    // M84: AI discussion thread anchored to this highlight.
    this._buildHighlightThreadSection(pop, hl);

    const footer = document.createElement('div');
    footer.classList.add('pdf-highlight-popover-footer');
    const del = document.createElement('button');
    del.classList.add('pdf-highlight-delete');
    del.textContent = 'Delete';
    del.addEventListener('click', () => {
      this._deleteHighlight(hl.id);
      this._dismissHighlightPopover();
    });
    footer.appendChild(del);
    pop.appendChild(footer);

    document.body.appendChild(pop);
    // Hide until positioned so it never paints once at its default flow
    // position (bottom of <body>) and then visibly jump to the anchor.
    pop.style.visibility = 'hidden';
    const margin = 8;
    const maxH = window.innerHeight - margin * 2;
    const pw = pop.offsetWidth;
    const ph = Math.min(pop.offsetHeight, maxH);

    // Horizontal: prefer anchor.left, clamp into the viewport.
    let left = anchor.left;
    if (left + pw > window.innerWidth - margin) left = window.innerWidth - pw - margin;
    left = Math.max(margin, left);

    // Vertical: try below the anchor; if it doesn't fit, try above; otherwise
    // pin to whichever side has more room and clamp so it never leaves screen.
    const spaceBelow = window.innerHeight - anchor.bottom - margin;
    const spaceAbove = anchor.top - margin;
    let top: number;
    if (ph <= spaceBelow) {
      top = anchor.bottom + 4;
    } else if (ph <= spaceAbove) {
      top = anchor.top - ph - 4;
    } else {
      // Taller than both gaps — fill the viewport and let content scroll.
      top = margin;
    }
    top = Math.min(Math.max(margin, top), window.innerHeight - ph - margin);

    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
    pop.style.maxHeight = `${maxH}px`;
    pop.style.visibility = '';
    this._activeHighlightPopover = pop;

    const dismiss = (e: MouseEvent) => {
      if (!this._activeHighlightPopover || this._activeHighlightPopover.contains(e.target as Node)) return;
      // Refresh the margin-tab icon state on dismiss, but NOT when the user is
      // pressing another tab — re-rendering would remove that tab mid-gesture
      // and swallow the click that should open its popover.
      const onTab = !!(e.target as HTMLElement | null)?.closest('.pdf-highlight-tab');
      this._dismissHighlightPopover();
      if (!onTab) this._renderHighlightsForPage(hl.page);
    };
    // Defer registration one tick so the mousedown that opened this popover
    // doesn't immediately dismiss it.
    let registered = false;
    const timer = setTimeout(() => {
      registered = true;
      document.addEventListener('mousedown', dismiss, true);
    }, 0);
    // Register cleanup so any dismiss path (delete, undo, re-open, pane teardown)
    // removes this global capture-phase listener — it must never leak.
    this._highlightPopoverDismiss = () => {
      clearTimeout(timer);
      if (registered) document.removeEventListener('mousedown', dismiss, true);
    };
  }

  /**
   * Build the AI-discussion section of a highlight's review panel: the saved
   * transcript plus an input that streams a fresh answer from the inline-AI
   * provider. Each turn is appended to `hl.thread` and persisted, so the
   * conversation about a passage lives on the highlight forever.
   */
  private _buildHighlightThreadSection(pop: HTMLElement, hl: PdfHighlight): void {
    const section = document.createElement('div');
    section.classList.add('pdf-highlight-section', 'pdf-highlight-thread');

    const header = document.createElement('div');
    header.classList.add('pdf-highlight-thread-header');
    const label = document.createElement('div');
    label.classList.add('pdf-highlight-section-label');
    label.innerHTML = `<span class="pdf-highlight-section-icon">${ICON.sparkles}</span> Discuss`;
    header.appendChild(label);

    // "Continue in Chat" — hand the passage + full thread to the main chat
    // panel for a larger conversation (mirrors canvas inline-AI "Send to Chat").
    const continueBtn = document.createElement('button');
    continueBtn.classList.add('pdf-highlight-continue-chat');
    continueBtn.innerHTML = `<span class="pdf-highlight-continue-icon">${ICON.openExtSm}</span> Continue in Chat`;
    setupTooltip(continueBtn, 'Open this discussion in the main chat panel');
    continueBtn.addEventListener('click', () => {
      this._continueHighlightInChat(hl);
      this._dismissHighlightPopover();
    });
    header.appendChild(continueBtn);
    section.appendChild(header);

    const transcript = document.createElement('div');
    transcript.classList.add('pdf-highlight-transcript');
    section.appendChild(transcript);

    const renderTurns = (): void => {
      transcript.replaceChildren();
      for (const turn of hl.thread ?? []) {
        const bubble = document.createElement('div');
        bubble.classList.add('pdf-highlight-turn', `is-${turn.role}`);
        bubble.textContent = turn.text;
        transcript.appendChild(bubble);
      }
      transcript.scrollTop = transcript.scrollHeight;
      // Only offer "Continue in Chat" once there's something to continue.
      continueBtn.style.display = (hl.thread?.length ?? 0) > 0 ? '' : 'none';
    };
    renderTurns();

    const inputRow = document.createElement('div');
    inputRow.classList.add('pdf-highlight-ask-row');
    const input = document.createElement('textarea');
    input.classList.add('pdf-highlight-ask');
    input.rows = 1;
    input.placeholder = 'Ask AI about this passage\u2026';
    const sendBtn = document.createElement('button');
    sendBtn.classList.add('pdf-highlight-ask-send');
    sendBtn.innerHTML = ICON.chat;
    setupTooltip(sendBtn, 'Ask AI');
    inputRow.appendChild(input);
    inputRow.appendChild(sendBtn);
    section.appendChild(inputRow);

    let streaming = false;
    const ask = async (): Promise<void> => {
      const question = input.value.trim();
      if (!question || streaming) return;
      const provider = await this._loadInlineAIProvider();
      if (!provider) {
        const warn = document.createElement('div');
        warn.classList.add('pdf-highlight-turn', 'is-ai');
        warn.textContent = 'AI is not available right now.';
        transcript.appendChild(warn);
        return;
      }
      input.value = '';
      input.style.height = 'auto';
      streaming = true;

      // Persist + render the user turn.
      (hl.thread ??= []).push({ role: 'user', text: question, at: Date.now() });
      renderTurns();
      this._saveHighlights();

      // Build the message list: system anchors the passage, prior turns give
      // continuity (decision A — feed the saved thread back as context).
      const messages: IChatMessage[] = [{
        role: 'system',
        content: 'You are helping a reader understand a passage from a PDF document. '
          + 'The passage is:\n\n---\n' + (hl.text || '(image selection)') + '\n---\n\n'
          + 'Answer their questions about it clearly and concisely.',
      }];
      for (const turn of hl.thread) {
        messages.push({ role: turn.role === 'ai' ? 'assistant' : 'user', content: turn.text });
      }

      const aiBubble = document.createElement('div');
      aiBubble.classList.add('pdf-highlight-turn', 'is-ai');
      transcript.appendChild(aiBubble);
      transcript.scrollTop = transcript.scrollHeight;

      this._aiAbort?.abort();
      this._aiAbort = new AbortController();
      const signal = this._aiAbort.signal;
      let answer = '';
      try {
        for await (const chunk of provider.sendChatRequest(messages, { temperature: 0.4 }, signal)) {
          if (signal.aborted) return;
          if (chunk.content) {
            answer += chunk.content;
            aiBubble.textContent = answer;
            transcript.scrollTop = transcript.scrollHeight;
          }
        }
      } catch (err) {
        aiBubble.textContent = `Error: ${err instanceof Error ? err.message : 'request failed'}`;
        aiBubble.classList.add('pdf-highlight-turn-error');
        streaming = false;
        return;
      }
      if (signal.aborted) { streaming = false; return; }

      // Persist the AI turn.
      hl.thread.push({ role: 'ai', text: answer, at: Date.now() });
      this._saveHighlights();
      streaming = false;
    };

    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 72) + 'px';
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void ask(); }
    });
    sendBtn.addEventListener('click', () => void ask());

    pop.appendChild(section);
  }

  private _deleteHighlight(id: string): void {
    const hl = this._highlights.find((h) => h.id === id);
    if (!hl) return;
    this._pushUndo({ kind: 'delete', highlights: [this._cloneHighlight(hl)] });
    this._highlights = this._highlights.filter((h) => h.id !== id);
    this._saveHighlights();
    this._renderHighlightsForPage(hl.page);
  }

  /** Structured deep copy of a highlight so undo/redo can restore it verbatim. */
  private _cloneHighlight(hl: PdfHighlight): PdfHighlight {
    return {
      ...hl,
      rects: hl.rects.map((r) => ({ ...r })),
      thread: hl.thread?.map((t) => ({ ...t })),
      canvasLinks: hl.canvasLinks?.map((l) => ({ ...l })),
    };
  }

  /** Record a reversible action and invalidate the redo stack. */
  private _pushUndo(action: PdfHighlightAction): void {
    this._highlightUndoStack.push({
      kind: action.kind,
      highlights: action.highlights.map((h) => this._cloneHighlight(h)),
    });
    this._highlightRedoStack = [];
  }

  /** Apply an action's effect (create→add, delete→remove); inverse undoes it. */
  private _applyHighlightAction(action: PdfHighlightAction, inverse: boolean): void {
    const ids = new Set(action.highlights.map((h) => h.id));
    const adding = inverse ? action.kind === 'delete' : action.kind === 'create';
    if (adding) {
      // Restore copies so later edits don't mutate the stacked snapshots.
      for (const h of action.highlights) {
        if (!this._highlights.some((e) => e.id === h.id)) {
          this._highlights.push(this._cloneHighlight(h));
        }
      }
    } else {
      this._highlights = this._highlights.filter((h) => !ids.has(h.id));
    }
    this._saveHighlights();
    for (const page of new Set(action.highlights.map((h) => h.page))) {
      this._renderHighlightsForPage(page);
    }
  }

  /**
   * Whether this pane should claim a delegated undo/redo. True when focus is
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

  /** Undo the most recent highlight action (Ctrl+Z). Returns true if applied. */
  private _undoHighlight(): boolean {
    const action = this._highlightUndoStack.pop();
    if (!action) return false;
    this._dismissHighlightPopover();
    this._applyHighlightAction(action, true);
    this._highlightRedoStack.push(action);
    return true;
  }

  /** Redo the most recently undone action (Ctrl+Y / Ctrl+Shift+Z). */
  private _redoHighlight(): boolean {
    const action = this._highlightRedoStack.pop();
    if (!action) return false;
    this._dismissHighlightPopover();
    this._applyHighlightAction(action, false);
    this._highlightUndoStack.push(action);
    return true;
  }

  private _dismissHighlightPopover(): void {
    // Always tear down the global outside-click listener, regardless of which
    // path dismisses the popover, so capture-phase mousedown listeners never
    // leak and accumulate on document.
    if (this._highlightPopoverDismiss) {
      this._highlightPopoverDismiss();
      this._highlightPopoverDismiss = null;
    }
    if (this._activeHighlightPopover) {
      this._activeHighlightPopover.remove();
      this._activeHighlightPopover = null;
    }
  }

  private _clearAllHighlightOverlays(): void {
    this._viewerContainer?.querySelectorAll('.pdf-highlight-layer').forEach((n) => n.remove());
    this._dismissHighlightPopover();
  }

  /**
   * Send the captured detail to a canvas page via the `canvas.captureSelection`
   * command, then record the returned page as a link on the anchoring
   * highlight(s) so the highlight becomes the durable hub between the two
   * surfaces (M84). Falls back to a fire-and-forget window event if the canvas
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
    if (!result || anchors.length === 0) return;
    const link: PdfHighlightCanvasLink = { pageId: result.pageId, title: result.title, at: Date.now() };
    for (const hl of anchors) {
      (hl.canvasLinks ??= []).push(link);
    }
    this._saveHighlights();
    for (const page of new Set(anchors.map((h) => h.page))) {
      this._renderHighlightsForPage(page);
    }
  }

  /**
   * Lazily fetch the inline-AI provider from the chat extension. Cached after
   * the first attempt; returns null if the chat extension isn't available.
   */
  private async _loadInlineAIProvider(): Promise<InlineAIProvider | null> {
    if (this._inlineAILoaded) return this._inlineAIProvider;
    this._inlineAILoaded = true;
    if (!this._commandService) return null;
    try {
      this._inlineAIProvider = await this._commandService.executeCommand<InlineAIProvider | null>(
        'chat.getInlineAIProvider',
      ) ?? null;
    } catch (err) {
      console.warn('[PdfEditorPane] chat.getInlineAIProvider failed:', err);
      this._inlineAIProvider = null;
    }
    return this._inlineAIProvider;
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
    const anchors = this._createHighlightFromSelection(this._highlightColor);
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
    const anchors = this._createHighlightFromSelection(this._highlightColor);
    const hl = anchors[0];
    if (!hl) return;
    const anchorRect = rect && rect.width + rect.height > 0
      ? rect
      : new DOMRect(window.innerWidth / 2, window.innerHeight / 2, 0, 0);
    this._showHighlightPopover(hl, anchorRect);
    setTimeout(() => {
      this._activeHighlightPopover
        ?.querySelector<HTMLTextAreaElement>('.pdf-highlight-ask')?.focus();
    }, 0);
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
      const rects = this._collectSelectionRectsForTextLayer(selection, textLayer);
      if (rects.length === 0) continue;
      const merged = this._mergeSelectionOverlayRects(rects);
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
      const anchors = this._createHighlightFromSelection(this._highlightColor);
      void this._captureToCanvas({ imageDataUrl, fileName, page: pageNumber, sourceUri }, anchors);
      return; // one region per invocation
    }
  }

  // ── Toolbar ──────────────────────────────────────────────────────────

  private _buildToolbar(): void {
    // ── Left: page navigation ──
    const nav = $('div');
    nav.classList.add('pdf-toolbar-cluster');

    const prev = this._btn(ICON.chevronLeft, 'Previous page');
    prev.addEventListener('click', () => this._pdfViewer?.previousPage());

    const pagePill = $('div');
    pagePill.classList.add('pdf-toolbar-pill');

    this._pageInput = document.createElement('input');
    this._pageInput.type = 'text';
    this._pageInput.classList.add('pdf-toolbar-page-input', 'px-input-bare');
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

    const next = this._btn(ICON.chevronRight, 'Next page');
    next.addEventListener('click', () => this._pdfViewer?.nextPage());

    nav.append(prev, pagePill, next);

    // ── Zoom ──
    const zoom = $('div');
    zoom.classList.add('pdf-toolbar-cluster');

    const zoomOut = this._btn(ICON.zoomOut, 'Zoom out');
    zoomOut.addEventListener('click', () => this._pdfViewer?.decreaseScale());

    // One pill: editable % input + preset dropdown chevron.
    const zoomPill = $('div');
    zoomPill.classList.add('pdf-toolbar-pill');

    this._zoomInput = document.createElement('input');
    this._zoomInput.type = 'text';
    this._zoomInput.classList.add('px-input-bare');
    this._zoomInput.classList.add('pdf-toolbar-zoom-input');
    this._zoomInput.value = '100%';
    setupTooltip(this._zoomInput, 'Zoom level (type a % and press Enter)');
    this._zoomInput.addEventListener('focus', () => this._zoomInput.select());
    this._zoomInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { this._applyZoomInput(); this._zoomInput.blur(); e.preventDefault(); }
      if (e.key === 'Escape') { this._syncZoomInput(); this._zoomInput.blur(); e.preventDefault(); }
    });
    this._zoomInput.addEventListener('blur', () => this._syncZoomInput());

    const zoomPreset = this._btn(ICON.chevronDownSm, 'Zoom presets');
    zoomPreset.classList.add('pdf-toolbar-zoom-preset');
    zoomPreset.addEventListener('click', (e) => {
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      this._showZoomPresets(r.left, r.bottom + 4);
    });

    zoomPill.append(this._zoomInput, zoomPreset);

    const zoomIn = this._btn(ICON.zoomIn, 'Zoom in');
    zoomIn.addEventListener('click', () => this._pdfViewer?.increaseScale());

    // Single fit button that alternates between the two fit modes.
    this._fitBtn = this._btn(ICON.fitWidth, 'Fit width');
    this._fitBtn.addEventListener('click', () => this._toggleFitMode());

    zoom.append(zoomOut, zoomPill, zoomIn, this._fitBtn);

    // ── Center spacer ──
    const spacer = $('span');
    spacer.classList.add('pdf-toolbar-spacer');

    // ── Right: search, panels, night reading, overflow ──
    const right = $('div');
    right.classList.add('pdf-toolbar-cluster');

    const searchBtn = this._btn(ICON.search, 'Find (Ctrl+F)');
    searchBtn.addEventListener('click', () => this._toggleSearch());

    this._outlineBtn = this._btn(ICON.listTree, 'Outline');
    this._outlineBtn.disabled = true; // enabled when a document provides one
    this._outlineBtn.addEventListener('click', () => this._toggleOutline());

    this._thumbBtn = this._btn(ICON.grid, 'Thumbnails');
    this._thumbBtn.addEventListener('click', () => this._toggleThumbnails());

    this._invertBtn = this._btn(ICON.moon, 'Night reading (invert colors)');
    this._invertBtn.addEventListener('click', () => this._toggleReadingDark());

    // Rarely-used actions live in the ⋯ menu (rotate, spread, scroll, print, open).
    const moreBtn = this._btn(ICON.more, 'More actions');
    moreBtn.addEventListener('click', (e) => {
      this._showOverflowMenu(e.currentTarget as HTMLElement);
    });

    right.append(searchBtn, this._outlineBtn, this._thumbBtn, this._invertBtn, moreBtn);

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
    setupTooltip(this._fitBtn, isWidth ? 'Fit page' : 'Fit width');
  }

  // ── Overflow menu (rotate / spread / scroll / print / open) ────────────

  private _showOverflowMenu(anchor: HTMLElement): void {
    this._dismissContextMenu();
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

    const menu = ContextMenu.show({
      items: [
        { id: 'pdf.rotate', label: 'Rotate 90°', keybinding: 'R' },
        {
          id: 'pdf.spread',
          label: 'Two-page spread',
          submenu: [
            { id: 'pdf.spread.none', label: 'Off',        renderIcon: checked(spread === SpreadMode.NONE) },
            { id: 'pdf.spread.odd',  label: 'Odd pages',  renderIcon: checked(spread === SpreadMode.ODD) },
            { id: 'pdf.spread.even', label: 'Even pages', renderIcon: checked(spread === SpreadMode.EVEN) },
          ],
        },
        {
          id: 'pdf.scroll',
          label: 'Scroll direction',
          submenu: [
            { id: 'pdf.scroll.vertical',   label: 'Vertical',    renderIcon: checked(scroll === ScrollMode.VERTICAL) },
            { id: 'pdf.scroll.horizontal', label: 'Horizontal',  renderIcon: checked(scroll === ScrollMode.HORIZONTAL) },
            { id: 'pdf.scroll.wrapped',    label: 'Wrapped',     renderIcon: checked(scroll === ScrollMode.WRAPPED) },
            { id: 'pdf.scroll.page',       label: 'Single page', renderIcon: checked(scroll === ScrollMode.PAGE) },
          ],
        },
        { id: 'pdf.print', label: 'Print…', keybinding: 'Ctrl+P', group: 'doc' },
        { id: 'pdf.openExternal', label: 'Open in system viewer', group: 'doc' },
      ],
      anchor: { x: r.left, y: r.bottom + 4 },
    });

    menu.onDidSelect((e) => {
      const id = e.item.id;
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

  private _btn(svgOrText: string, title: string): HTMLButtonElement {
    const b = document.createElement('button');
    b.classList.add('pdf-toolbar-btn');
    b.innerHTML = svgOrText;
    setupTooltip(b, title);
    return b;
  }

  // ── Search bar ───────────────────────────────────────────────────────

  private _buildSearchBar(): void {
    this._searchInput = document.createElement('input');
    this._searchInput.type = 'text';
    this._searchInput.classList.add('pdf-search-input');
    this._searchInput.placeholder = 'Find in document… (Ctrl+F)';
    this._searchInput.addEventListener('input', () => this._dispatchFind('find'));
    this._searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this._dispatchFind('again', e.shiftKey);
        e.preventDefault();
      }
      if (e.key === 'Escape') {
        this._toggleSearch(false);
        e.preventDefault();
      }
    });

    this._matchCountEl = $('span');
    this._matchCountEl.classList.add('pdf-search-match-count');

    const prevMatch = this._btn(ICON.chevronUp, 'Previous match');
    prevMatch.classList.add('pdf-search-btn');
    prevMatch.addEventListener('click', () => this._dispatchFind('again', true));

    const nextMatch = this._btn(ICON.chevronDown, 'Next match');
    nextMatch.classList.add('pdf-search-btn');
    nextMatch.addEventListener('click', () => this._dispatchFind('again', false));

    const closeBtn = this._btn(ICON.close, 'Close search');
    closeBtn.classList.add('pdf-search-btn');
    closeBtn.addEventListener('click', () => this._toggleSearch(false));

    this._searchBar.append(
      this._searchInput,
      this._matchCountEl,
      prevMatch, nextMatch, closeBtn,
    );
  }

  private _toggleSearch(forceState?: boolean): void {
    this._searchVisible = forceState ?? !this._searchVisible;
    if (this._searchVisible) {
      show(this._searchBar);
      this._searchInput.focus();
      this._searchInput.select();
      // Re-dispatch current query if any
      if (this._searchInput.value) {
        this._dispatchFind('find');
      }
    } else {
      hide(this._searchBar);
      // Clear search highlights
      this._eventBus?.dispatch('findbarclose', { source: this });
      this._matchCountEl.textContent = '';
    }
  }

  private _dispatchFind(type: string, findPrevious = false): void {
    if (!this._eventBus) return;
    this._eventBus.dispatch('find', {
      source: this,
      type,
      query: this._searchInput.value,
      caseSensitive: false,
      entireWord: false,
      highlightAll: true,
      findPrevious,
    });
  }

  // ── Outline sidebar ──────────────────────────────────────────────────

  private _toggleOutline(forceState?: boolean): void {
    this._outlineVisible = (forceState ?? !this._outlineVisible) && !!this._outline;
    this._outlineBtn?.classList.toggle('active', this._outlineVisible);
    if (this._outlineVisible && this._outline) {
      show(this._outlineSidebar);
      show(this._outlineSash);
      // Restore persisted width
      this._globalStorage?.get('parallx.pdfOutlineWidth').then(stored => {
        if (stored) {
          const w = parseInt(stored, 10);
          if (w >= 150 && w <= 500) {
            this._outlineSidebar.style.width = `${w}px`;
          }
        }
      });
    } else {
      hide(this._outlineSidebar);
      hide(this._outlineSash);
    }
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

  private _renderOutline(outline: PdfOutlineItem[]): void {
    this._outlineTree.replaceChildren();
    this._buildOutlineNodes(outline, this._outlineTree, 0);
    this._wireOutlineKeyboard();
  }

  private _buildOutlineNodes(
    items: PdfOutlineItem[],
    parent: HTMLElement,
    depth: number,
  ): void {
    for (const item of items) {
      const hasChildren = item.items?.length > 0;

      const row = $('div');
      row.classList.add('pdf-outline-item');
      if (hasChildren) row.classList.add('pdf-outline-item--parent');
      row.style.paddingLeft = `${depth * 14 + 4}px`;
      row.tabIndex = -1; // focusable via roving tabindex
      row.setAttribute('role', 'treeitem');

      // Store destination on the DOM node for keyboard Enter navigation
      if (item.dest) {
        (row as any).__pdfDest = item.dest;
      }

      // Toggle arrow
      const toggleEl = $('span');
      toggleEl.classList.add('pdf-outline-toggle');
      if (hasChildren) {
        toggleEl.innerHTML = ICON.chevronDown;
      } else {
        toggleEl.classList.add('pdf-outline-toggle--leaf');
      }
      row.appendChild(toggleEl);

      const title = $('span');
      title.classList.add('pdf-outline-title');
      title.textContent = item.title;
      if (item.bold) title.style.fontWeight = 'bold';
      if (item.italic) title.style.fontStyle = 'italic';
      row.appendChild(title);
      parent.appendChild(row);

      // Build children container and wire collapse
      let childContainer: HTMLElement | null = null;
      if (hasChildren) {
        childContainer = $('div');
        childContainer.classList.add('pdf-outline-children');
        childContainer.setAttribute('role', 'group');
        this._buildOutlineNodes(item.items, childContainer, depth + 1);
        parent.appendChild(childContainer);
      }

      // Collapse helper (captured by closures below)
      const doToggle = () => {
        if (!childContainer) return;
        const collapsed = childContainer.classList.toggle('pdf-outline-children--collapsed');
        toggleEl.innerHTML = collapsed ? ICON.chevronRight : ICON.chevronDown;
      };

      // Click chevron → toggle only (no navigation)
      toggleEl.addEventListener('click', (e) => {
        e.stopPropagation();
        doToggle();
      });

      // Click title → navigate only (no collapse)
      title.addEventListener('click', () => {
        if (item.dest && this._linkService) {
          void this._linkService.goToDestination(item.dest);
        }
      });
    }
  }

  /**
   * Wire keyboard navigation on the outline tree (B2.3).
   *
   * ArrowUp/Down — move focus between visible items
   * ArrowLeft   — collapse node (or move to parent if already collapsed/leaf)
   * ArrowRight  — expand node (or move to first child if already expanded)
   * Enter       — navigate to the focused item's destination
   */
  private _wireOutlineKeyboard(): void {
    this._outlineTree.setAttribute('role', 'tree');

    this._outlineTree.addEventListener('keydown', (e) => {
      const currentItem = document.activeElement as HTMLElement | null;
      if (!currentItem || !currentItem.classList.contains('pdf-outline-item')) return;

      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault();
          const next = this._getNextVisibleOutlineItem(currentItem);
          if (next) next.focus();
          break;
        }
        case 'ArrowUp': {
          e.preventDefault();
          const prev = this._getPreviousVisibleOutlineItem(currentItem);
          if (prev) prev.focus();
          break;
        }
        case 'ArrowRight': {
          e.preventDefault();
          const isParent = currentItem.classList.contains('pdf-outline-item--parent');
          if (!isParent) break;
          const childContainer = currentItem.nextElementSibling;
          if (childContainer && childContainer.classList.contains('pdf-outline-children')) {
            const isCollapsed = childContainer.classList.contains('pdf-outline-children--collapsed');
            if (isCollapsed) {
              // Expand
              const toggle = currentItem.querySelector('.pdf-outline-toggle') as HTMLElement | null;
              toggle?.click();
            } else {
              // Move to first child
              const firstChild = childContainer.querySelector('.pdf-outline-item') as HTMLElement | null;
              if (firstChild) firstChild.focus();
            }
          }
          break;
        }
        case 'ArrowLeft': {
          e.preventDefault();
          const isParent = currentItem.classList.contains('pdf-outline-item--parent');
          const childContainer = currentItem.nextElementSibling;
          const isExpanded = isParent && childContainer
            && childContainer.classList.contains('pdf-outline-children')
            && !childContainer.classList.contains('pdf-outline-children--collapsed');

          if (isExpanded) {
            // Collapse
            const toggle = currentItem.querySelector('.pdf-outline-toggle') as HTMLElement | null;
            toggle?.click();
          } else {
            // Move to parent
            const parentGroup = currentItem.parentElement;
            if (parentGroup && parentGroup.classList.contains('pdf-outline-children')) {
              // Parent row is the sibling before this group container
              const parentRow = parentGroup.previousElementSibling as HTMLElement | null;
              if (parentRow && parentRow.classList.contains('pdf-outline-item')) {
                parentRow.focus();
              }
            }
          }
          break;
        }
        case 'Enter': {
          e.preventDefault();
          const dest = (currentItem as any).__pdfDest;
          if (dest && this._linkService) {
            void this._linkService.goToDestination(dest);
          }
          break;
        }
      }
    });

    // Set initial roving tabindex on first item
    const firstItem = this._outlineTree.querySelector('.pdf-outline-item') as HTMLElement | null;
    if (firstItem) firstItem.tabIndex = 0;
  }

  /** Get the next visible outline item in DOM order. */
  private _getNextVisibleOutlineItem(current: HTMLElement): HTMLElement | null {
    const allItems = Array.from(this._outlineTree.querySelectorAll<HTMLElement>('.pdf-outline-item'));
    const visibleItems = allItems.filter(el => this._isOutlineItemVisible(el));
    const idx = visibleItems.indexOf(current);
    return idx >= 0 && idx < visibleItems.length - 1 ? visibleItems[idx + 1] : null;
  }

  /** Get the previous visible outline item in DOM order. */
  private _getPreviousVisibleOutlineItem(current: HTMLElement): HTMLElement | null {
    const allItems = Array.from(this._outlineTree.querySelectorAll<HTMLElement>('.pdf-outline-item'));
    const visibleItems = allItems.filter(el => this._isOutlineItemVisible(el));
    const idx = visibleItems.indexOf(current);
    return idx > 0 ? visibleItems[idx - 1] : null;
  }

  /** Check if an outline item is visible (not inside a collapsed ancestor). */
  private _isOutlineItemVisible(el: HTMLElement): boolean {
    let parent = el.parentElement;
    while (parent && parent !== this._outlineTree) {
      if (parent.classList.contains('pdf-outline-children--collapsed')) return false;
      parent = parent.parentElement;
    }
    return true;
  }

  // ── Load PDF ─────────────────────────────────────────────────────────

  protected override async renderInput(
    input: IEditorInput,
    _previous: IEditorInput | undefined,
  ): Promise<void> {
    this._cleanup();

    if (!(input instanceof PdfEditorInput)) {
      this._showError('Not a PDF input.');
      return;
    }

    this._currentInput = input;
    this._fileKey = input.uri.fsPath;
    show(this._loadingEl);
    hide(this._errorEl);
    show(this._toolbar);

    try {
      // Read file bytes via Electron bridge
      const electron = (globalThis as any).parallxElectron;
      if (!electron?.fs?.readFile) throw new Error('File-system bridge unavailable');

      // Load persisted highlights for this document (best-effort).
      await this._loadHighlights();

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

      this._eventBus = new EventBus();

      this._linkService = new PDFLinkService({
        eventBus: this._eventBus,
        // External anchors (http/https/mailto) render with target="_blank"
        // so the click hits window.open → caught by Electron's
        // setWindowOpenHandler in main.cjs, which forwards http(s)/mailto
        // to shell.openExternal (the user's OS browser).
        // LinkTarget enum: 0 NONE, 1 SELF, 2 BLANK, 3 PARENT, 4 TOP.
        externalLinkTarget: 2,
        externalLinkRel: 'noopener noreferrer',
      });

      this._findController = new PDFFindController({
        linkService: this._linkService,
        eventBus: this._eventBus,
      });

      this._pdfViewer = new PDFViewer({
        container: this._viewerContainer,
        viewer: this._viewerEl,
        eventBus: this._eventBus,
        linkService: this._linkService,
        findController: this._findController,
        textLayerMode: TEXT_LAYER_ENABLE,
        annotationMode: AnnotationMode.ENABLE_FORMS,
        removePageBorders: false,
        enableHWA: true,
        supportsPinchToZoom: true,
        enableAutoLinking: true,
        minDurationToUpdateCanvas: 0,
        l10n: new GenericL10n('en-US'),
      });

      this._linkService.setViewer(this._pdfViewer);

      // ── Listen to viewer events ────────────────────────────────────

      this._eventBus.on('pagechanging', (evt: any) => {
        const pageNum = evt.pageNumber;
        this._pageInput.value = String(pageNum);
        this._updatePageLabel(pageNum);
        this._highlightThumb(pageNum);
        if (this._currentInput) this._currentInput.page = pageNum;
      });

      this._eventBus.on('scalechanging', (evt: any) => {
        this._zoomInput.value = `${Math.round(evt.scale * 100)}%`;
        this._updateFitButton();
        this._pdfViewer?.update();
        this._scheduleSelectionOverlayUpdate();
        this._renderAllHighlights();
        if (this._currentInput && this._pdfViewer) {
          this._currentInput.scaleValue = this._pdfViewer.currentScaleValue;
        }
      });

      this._eventBus.on('textlayerrendered', (evt: any) => {
        this._scheduleSelectionOverlayUpdate();
        const pageNumber = evt?.pageNumber;
        if (typeof pageNumber === 'number') this._renderHighlightsForPage(pageNumber);
      });

      this._eventBus.on('updatefindmatchescount', (evt: any) => {
        const { current, total } = evt.matchesCount;
        if (total > 0) {
          this._matchCountEl.textContent = `${current} of ${total}`;
        } else {
          this._matchCountEl.textContent = '';
        }
      });

      this._eventBus.on('updatefindcontrolstate', (evt: any) => {
        const { state, matchesCount } = evt;
        if (state === FindState.NOT_FOUND) {
          this._matchCountEl.textContent = 'No matches';
          this._searchInput.classList.add('pdf-search-not-found');
        } else {
          this._searchInput.classList.remove('pdf-search-not-found');
          if (matchesCount) {
            const { current, total } = matchesCount;
            this._matchCountEl.textContent = total > 0 ? `${current} of ${total}` : '';
          }
        }
      });

      // ── Load document ──────────────────────────────────────────────

      this._pdfDoc = await pdfjsLib.getDocument({
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

        this._zoomInput.value = `${Math.round(this._pdfViewer!.currentScale * 100)}%`;
        this._updateFitButton();
        this._pdfViewer!.update();
        this._scheduleSelectionOverlayUpdate();
        this._renderAllHighlights();
      });

      this._pdfViewer.setDocument(this._pdfDoc);
      this._linkService.setDocument(this._pdfDoc, null);
      this._findController.setDocument(this._pdfDoc);
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
      if (outline?.length) {
        this._outline = outline;
        this._renderOutline(outline);
        this._outlineBtn.disabled = false;
        setupTooltip(this._outlineBtn, 'Outline');
      } else {
        this._outline = null;
        this._outlineBtn.disabled = true;
        setupTooltip(this._outlineBtn, 'No outline in this document');
      }

      // ── Build thumbnails ───────────────────────────────────────────

      this._buildThumbnails(this._pdfDoc);

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
        { id: 'zoom.page-width', label: 'Fit width', group: 'fit' },
        { id: 'zoom.page-fit', label: 'Fit page', group: 'fit' },
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
      setupTooltip(
        this._invertBtn,
        this._readingDark ? 'Day reading (normal colors)' : 'Night reading (invert colors)',
      );
    }
  }

  // ── Rotation ─────────────────────────────────────────────────────────

  private _rotate(): void {
    if (!this._pdfViewer) return;
    this._pdfViewer.pagesRotation = (this._pdfViewer.pagesRotation + 90) % 360;
  }

  // ── Thumbnail sidebar ────────────────────────────────────────────────

  private _toggleThumbnails(forceState?: boolean): void {
    this._thumbnailVisible = forceState ?? !this._thumbnailVisible;
    this._thumbBtn?.classList.toggle('active', this._thumbnailVisible);
    if (this._thumbnailVisible) {
      show(this._thumbnailSidebar);
      // Re-observe thumbnails for lazy rendering
      this._observeThumbnails();
    } else {
      hide(this._thumbnailSidebar);
    }
  }

  private _buildThumbnails(pdfDoc: pdfjsLib.PDFDocumentProxy): void {
    this._thumbnailList.replaceChildren();
    this._thumbCanvases.clear();

    const numPages = pdfDoc.numPages;
    for (let i = 1; i <= numPages; i++) {
      const item = $('div');
      item.classList.add('pdf-thumbnail-item');
      item.dataset.page = String(i);

      const canvas = document.createElement('canvas');
      canvas.classList.add('pdf-thumbnail-canvas');
      // Set placeholder size — will be resized when rendered
      canvas.width = 120;
      canvas.height = 160;
      item.appendChild(canvas);

      const label = $('span');
      label.classList.add('pdf-thumbnail-label');
      label.textContent = this._pageLabels?.[i - 1] ?? String(i);
      item.appendChild(label);

      item.addEventListener('click', () => {
        if (this._pdfViewer) {
          this._pdfViewer.currentPageNumber = i;
        }
      });

      this._thumbnailList.appendChild(item);
      this._thumbCanvases.set(i, canvas);
    }

    // Highlight page 1
    this._highlightThumb(1);
  }

  private _observeThumbnails(): void {
    if (this._thumbObserver) {
      this._thumbObserver.disconnect();
    }

    this._thumbObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const item = entry.target as HTMLElement;
            const pageNum = parseInt(item.dataset.page ?? '0', 10);
            if (pageNum > 0 && !item.dataset.rendered) {
              item.dataset.rendered = '1';
              void this._renderThumbnail(pageNum);
            }
          }
        }
      },
      { root: this._thumbnailList, rootMargin: '200px' },
    );

    // Observe all thumbnail items
    const items = this._thumbnailList.querySelectorAll('.pdf-thumbnail-item');
    for (const item of items) {
      this._thumbObserver.observe(item);
    }
  }

  private async _renderThumbnail(pageNum: number): Promise<void> {
    if (!this._pdfDoc) return;

    const canvas = this._thumbCanvases.get(pageNum);
    if (!canvas) return;

    try {
      const page = await this._pdfDoc.getPage(pageNum);
      const baseViewport = page.getViewport({ scale: 1 });
      const thumbWidth = 120;
      const scale = thumbWidth / baseViewport.width;
      const viewport = page.getViewport({ scale });

      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      await page.render({
        canvasContext: ctx,
        canvas,
        viewport,
      }).promise;
    } catch {
      // Silently ignore thumbnail render failures
    }
  }

  private _highlightThumb(pageNum: number): void {
    if (this._activeThumb) {
      this._activeThumb.classList.remove('pdf-thumbnail-active');
    }
    const items = this._thumbnailList.querySelectorAll('.pdf-thumbnail-item');
    const target = items[pageNum - 1] as HTMLElement | undefined;
    if (target) {
      target.classList.add('pdf-thumbnail-active');
      this._activeThumb = target;
      // Scroll thumb into view if sidebar is visible
      if (this._thumbnailVisible) {
        target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }

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

  /** Get the currently selected text in the PDF viewer (M48). */
  getSelectedText(): string {
    return this._capturedSelection;
  }

  /** Get selection source metadata for the AI action system (M48). */
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
      // Ignore mouseups that originate from our own overlay UI (highlight
      // margin tabs, the highlight popover, or the context menu itself) so
      // clicking those never re-triggers the text-selection context menu.
      if ((e.target as HTMLElement | null)?.closest('.pdf-highlight-tab, .pdf-highlight-popover, .context-menu')) {
        return;
      }
      requestAnimationFrame(() => {
        this._scheduleSelectionOverlayUpdate();
        const sel = window.getSelection();
        const text = sel?.toString()?.trim() ?? '';
        if (text.length > 0) {
          this._capturedSelection = text;
          this._showSelectionMenu(e.clientX, e.clientY);
        } else {
          this._capturedSelection = '';
          this._dismissContextMenu();
        }
      });
    }, { signal: controller.signal });

    // Dismiss on scroll
    this._viewerContainer.addEventListener('scroll', () => {
      this._dismissContextMenu();
      this._scheduleSelectionOverlayUpdate();
    }, { signal: controller.signal });
  }

  private _showSelectionMenu(x: number, y: number): void {
    this._dismissContextMenu();

    const hasSel = this._capturedSelection.length > 0;

    const menu = ContextMenu.show({
      items: [
        {
          id: 'pdf.copy',
          label: 'Copy',
          keybinding: 'Ctrl+C',
          disabled: !hasSel,
        },
        {
          id: 'pdf.highlight',
          label: 'Highlight',
          disabled: !hasSel,
          group: 'highlight',
        },
        ...HIGHLIGHT_COLORS.map((c) => ({
          id: `pdf.highlight.${c.key}`,
          label: `Highlight ${c.label}`,
          disabled: !hasSel,
          group: 'highlight',
        })),
        {
          id: 'pdf.findInDocument',
          label: 'Find in document',
          keybinding: 'Ctrl+F',
          disabled: !hasSel,
        },
        {
          id: 'canvas.captureNote',
          label: 'Add to Canvas Note',
          disabled: !hasSel,
          group: 'canvas',
        },
        {
          id: 'canvas.captureImage',
          label: 'Capture Region to Canvas',
          disabled: !hasSel,
          group: 'canvas',
        },
        // Inline AI — discuss the selection on the page (creates a highlight
        // and opens its review panel focused on the AI input).
        {
          id: 'ai.askInline',
          label: 'Ask AI about Selection',
          disabled: !hasSel,
          group: 'ai',
        },
        {
          id: 'ai.addToChat',
          label: 'Send Selection to Chat',
          disabled: !hasSel,
          group: 'ai',
        },
        // Routed through the selection-action dispatcher to the flashcards
        // extension's 'create-flashcard' handler (deck pick + AI generation).
        {
          id: 'flashcards.capture',
          label: 'Create Flashcard from Selection',
          disabled: !hasSel,
          group: 'ai',
        },
      ],
      anchor: { x, y },
    });

    menu.onDidSelect((e) => {
      if (e.item.id === 'pdf.copy') {
        if (this._capturedSelection) {
          void navigator.clipboard.writeText(this._capturedSelection);
        }
      } else if (e.item.id === 'pdf.highlight') {
        this._createHighlightFromSelection(this._highlightColor);
      } else if (e.item.id.startsWith('pdf.highlight.')) {
        this._createHighlightFromSelection(e.item.id.slice('pdf.highlight.'.length));
      } else if (e.item.id === 'pdf.findInDocument') {
        const sel = this._capturedSelection.trim();
        if (sel) {
          this._toggleSearch(true);
          this._searchInput.value = sel;
          this._dispatchFind('find');
        }
      } else if (e.item.id === 'canvas.captureNote') {
        this._captureSelectionToCanvas();
      } else if (e.item.id === 'canvas.captureImage') {
        this._captureSelectionRegionToCanvas();
      } else if (e.item.id === 'ai.askInline') {
        this._askAIAboutSelection();
      } else if (e.item.id === 'ai.addToChat') {
        this._dispatchSelectionAction('add-to-chat');
      } else if (e.item.id === 'flashcards.capture') {
        this._dispatchSelectionAction('create-flashcard');
      }
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

  /** Dispatch a selection action to the unified dispatcher (M48 Phase 4). */
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

  private _dismissContextMenu(): void {
    if (this._activeContextMenu) {
      this._activeContextMenu.dispose();
      this._activeContextMenu = null;
    }
  }

  // ── Keyboard ─────────────────────────────────────────────────────────

  private _onKeyDown(e: KeyboardEvent): void {
    // Ctrl+F — toggle search
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      this._toggleSearch(true);
      e.preventDefault();
      return;
    }

    // Ctrl+P — print
    if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
      this._print();
      e.preventDefault();
      return;
    }

    // Don't intercept keyboard when search input or page input is focused
    if (document.activeElement === this._searchInput ||
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
          if (sel) { this._capturedSelection = sel; this._createHighlightFromSelection(this._highlightColor); e.preventDefault(); }
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
        if (this._searchVisible) { this._toggleSearch(false); e.preventDefault(); }
        if (this._outlineVisible) { this._toggleOutline(false); e.preventDefault(); }
        if (this._thumbnailVisible) { this._toggleThumbnails(false); e.preventDefault(); }
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

          this._scheduleSelectionOverlayUpdate();
          this._renderAllHighlights();
        }
      }, 150);
    }
  }

  private _cleanup(): void {
    // A new document gets a fresh pagesinit cycle; stale pending state from
    // the previous document must not apply to it.
    this._pagesInited = false;
    this._pendingViewState = null;
    if (this._resizeTimer) { clearTimeout(this._resizeTimer); this._resizeTimer = null; }

    // Flush + tear down highlight state
    if (this._highlightSaveTimer) {
      clearTimeout(this._highlightSaveTimer);
      this._highlightSaveTimer = null;
      if (this._globalStorage && this._fileKey) {
        void this._globalStorage.set(this._highlightStorageKey(), JSON.stringify(this._highlights));
      }
    }
    this._clearAllHighlightOverlays();
    this._highlights = [];
    this._fileKey = '';

    // Disconnect thumbnail observer
    if (this._thumbObserver) { this._thumbObserver.disconnect(); this._thumbObserver = null; }

    // Tear down viewer components
    if (this._pdfViewer) {
      this._pdfViewer.cleanup();
    }
    this._pdfViewer = null;
    this._linkService = null;
    this._findController = null;
    this._eventBus = null;

    if (this._pdfDoc) { this._pdfDoc.destroy(); this._pdfDoc = null; }

    this._viewerEl?.replaceChildren();
    this._outlineTree?.replaceChildren();
    this._thumbnailList?.replaceChildren();
    this._clearSelectionOverlay();
    this._thumbCanvases.clear();
    this._activeThumb = null;
    this._outline = null;
    this._pageLabels = null;
    this._currentInput = null;
    this._removeTestDebugHook();

    // Reset UI
    this._searchVisible = false;
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
