// pdfEditorPane.ts — PDF viewer pane (PDF.js Viewer layer)
//
// Production PDF viewer using Mozilla's PDF.js Viewer layer — the same
// rendering engine that powers Firefox's built-in PDF reader.
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
import { $, hide, show, startDrag, endDrag } from '../../ui/dom.js';
import { ContextMenu } from '../../ui/contextMenu.js';

const PANE_ID = 'pdf-editor-pane';

// TextLayerMode is not exported from pdf_viewer.mjs
const TEXT_LAYER_ENABLE = 1;

// ─── SVG icons (16×16 codicon-style, fill="currentColor") ────────────────

const ICON = {
  chevronLeft:  '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M10.07 2.22L4.29 8l5.78 5.78.71-.71L5.71 8l5.07-5.07-.71-.71z"/></svg>',
  chevronRight: '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M5.93 2.22L11.71 8 5.93 13.78l-.71-.71L10.29 8 5.22 2.93l.71-.71z"/></svg>',
  chevronUp:    '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M2.22 10.07L8 4.29l5.78 5.78-.71.71L8 5.71l-5.07 5.07-.71-.71z"/></svg>',
  chevronDown:  '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M2.22 5.93L8 11.71l5.78-5.78-.71-.71L8 10.29 2.93 5.22l-.71.71z"/></svg>',
  zoomOut:      '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zM2.5 8a5.5 5.5 0 1 1 11 0 5.5 5.5 0 0 1-11 0z"/><path d="M5 7.25h6v1.5H5z"/></svg>',
  zoomIn:       '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zM2.5 8a5.5 5.5 0 1 1 11 0 5.5 5.5 0 0 1-11 0z"/><path d="M5 7.25h6v1.5H5z"/><path d="M7.25 5v6h1.5V5z"/></svg>',
  fitWidth:     '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M1 8l3-3v2h8V5l3 3-3 3V9H4v2L1 8z"/></svg>',
  fitPage:      '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M3 3h10v10H3V3zm1 1v8h8V4H4z"/><path d="M1 1h4v1H2v3H1V1zM11 1h4v4h-1V2h-3V1zM1 11h1v3h3v1H1v-4zM14 11h1v4h-4v-1h3v-3z"/></svg>',
  search:       '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M6.5 2a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zm0 1.75a2.75 2.75 0 1 1 0 5.5 2.75 2.75 0 0 1 0-5.5z"/><path d="M9.9 8.5L14.7 13.3 13.3 14.7 8.5 9.9z"/></svg>',
  listTree:     '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M1 2h14v1H1V2zm2 3h12v1H3V5zm2 3h10v1H5V8zm2 3h8v1H7v-1zm-6 3h14v1H1v-1z"/></svg>',
  grid:         '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M2 2h5v5H2V2zm1 1v3h3V3H3zm6-1h5v5H9V2zm1 1v3h3V3h-3zM2 9h5v5H2V9zm1 1v3h3v-3H3zm6-1h5v5H9V9zm1 1v3h3v-3h-3z"/></svg>',
  rotate:       '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M13.45 5.67A6 6 0 0 0 2 8h1a5 5 0 0 1 9.55-2H10v1h4.5V2.5h-1v3.17zM2.55 10.33A6 6 0 0 0 14 8h-1a5 5 0 0 1-9.55 2H6v1H1.5V15.5h1v-3.17z"/></svg>',
  spread:       '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M1 2h6v12H1V2zm1 1v10h4V3H2zm7-1h6v12H9V2zm1 1v10h4V3h-4z"/></svg>',
  print:        '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M4 1h8v3h3v7h-3v4H4v-4H1V4h3V1zm1 3h6V2H5v2zm-3 1v5h2V8h8v2h2V5H2zm3 4v5h6V9H5z"/></svg>',
  openExt:      '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M1.5 1H8v1H2.5A.5.5 0 0 0 2 2.5v11a.5.5 0 0 0 .5.5h11a.5.5 0 0 0 .5-.5V8h1v5.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 13.5v-11A1.5 1.5 0 0 1 2.5 1h-.001zM10 1h5v5h-1V2.707L8.354 8.354l-.708-.708L13.293 2H10V1z"/></svg>',
  close:        '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 7.29L12.15 3.14l.71.71L8.71 8l4.14 4.15-.71.71L8 8.71l-4.15 4.14-.71-.71L7.29 8 3.14 3.85l.71-.71L8 7.29z"/></svg>',
} as const;

// ─── Outline types ───────────────────────────────────────────────────────

interface PdfOutlineItem {
  title: string;
  bold: boolean;
  italic: boolean;
  dest: string | any[] | null;
  url: string | null;
  items: PdfOutlineItem[];
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
  private _errorEl!: HTMLElement;
  private _activeContextMenu: ContextMenu | null = null;
  private _capturedSelection = '';  // text captured at context-menu show time

  // Toolbar elements
  private _pageInput!: HTMLInputElement;
  private _pageLabelEl!: HTMLElement;
  private _pageTotalEl!: HTMLElement;
  private _zoomLabelEl!: HTMLElement;
  private _outlineBtn!: HTMLButtonElement;
  private _thumbBtn!: HTMLButtonElement;
  private _spreadBtn!: HTMLButtonElement;

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

  constructor() {
    super(PANE_ID);
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
    this._wireContextMenu();

    container.tabIndex = 0;
    container.addEventListener('keydown', (e) => this._onKeyDown(e));
  }

  // ── Toolbar ──────────────────────────────────────────────────────────

  private _buildToolbar(): void {
    // ── Group 1: Page navigation ──
    const navGroup = $('div');
    navGroup.classList.add('pdf-toolbar-group');

    const prev = this._btn(ICON.chevronLeft, 'Previous page');
    prev.addEventListener('click', () => this._pdfViewer?.previousPage());

    this._pageInput = document.createElement('input');
    this._pageInput.type = 'text';
    this._pageInput.classList.add('pdf-toolbar-page-input');
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

    const next = this._btn(ICON.chevronRight, 'Next page');
    next.addEventListener('click', () => this._pdfViewer?.nextPage());

    navGroup.append(prev, this._pageInput, sep, this._pageTotalEl, this._pageLabelEl, next);

    // ── Group 2: Zoom controls ──
    const zoomGroup = $('div');
    zoomGroup.classList.add('pdf-toolbar-group');

    const zoomOut = this._btn(ICON.zoomOut, 'Zoom out');
    zoomOut.addEventListener('click', () => this._pdfViewer?.decreaseScale());

    this._zoomLabelEl = $('span');
    this._zoomLabelEl.classList.add('pdf-toolbar-zoom-label');
    this._zoomLabelEl.textContent = '100%';

    const zoomIn = this._btn(ICON.zoomIn, 'Zoom in');
    zoomIn.addEventListener('click', () => this._pdfViewer?.increaseScale());

    const fitW = this._btn(ICON.fitWidth, 'Fit width');
    fitW.addEventListener('click', () => this._setScaleValue('page-width'));

    const fitP = this._btn(ICON.fitPage, 'Fit page');
    fitP.addEventListener('click', () => this._setScaleValue('page-fit'));

    zoomGroup.append(zoomOut, this._zoomLabelEl, zoomIn, fitW, fitP);

    // ── Center spacer ──
    const spacer = $('span');
    spacer.classList.add('pdf-toolbar-spacer');

    // ── Group 3: View & navigation panels ──
    const viewGroup = $('div');
    viewGroup.classList.add('pdf-toolbar-group');

    const searchBtn = this._btn(ICON.search, 'Find (Ctrl+F)');
    searchBtn.addEventListener('click', () => this._toggleSearch());

    this._outlineBtn = this._btn(ICON.listTree, 'Outline');
    this._outlineBtn.addEventListener('click', () => this._toggleOutline());

    this._thumbBtn = this._btn(ICON.grid, 'Thumbnails');
    this._thumbBtn.addEventListener('click', () => this._toggleThumbnails());

    viewGroup.append(searchBtn, this._outlineBtn, this._thumbBtn);

    // ── Group 4: Layout & transform ──
    const layoutGroup = $('div');
    layoutGroup.classList.add('pdf-toolbar-group');

    const rotateBtn = this._btn(ICON.rotate, 'Rotate (R)');
    rotateBtn.addEventListener('click', () => this._rotate());

    this._spreadBtn = this._btn(ICON.spread, 'Spread view');
    this._spreadBtn.addEventListener('click', () => this._cycleSpreadMode());

    layoutGroup.append(rotateBtn, this._spreadBtn);

    // ── Group 5: Document actions ──
    const actionGroup = $('div');
    actionGroup.classList.add('pdf-toolbar-group');

    const printBtn = this._btn(ICON.print, 'Print (Ctrl+P)');
    printBtn.addEventListener('click', () => this._print());

    const openExtBtn = this._btn(ICON.openExt, 'Open in system viewer');
    openExtBtn.addEventListener('click', () => this._openExternal());

    actionGroup.append(printBtn, openExtBtn);

    this._toolbar.append(navGroup, zoomGroup, spacer, viewGroup, layoutGroup, actionGroup);
  }

  private _btn(svgOrText: string, title: string): HTMLButtonElement {
    const b = document.createElement('button');
    b.classList.add('pdf-toolbar-btn');
    b.innerHTML = svgOrText;
    b.title = title;
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
    this._outlineVisible = forceState ?? !this._outlineVisible;
    if (this._outlineVisible && this._outline) {
      show(this._outlineSidebar);
      show(this._outlineSash);
      // Restore persisted width
      const stored = localStorage.getItem('parallx.pdfOutlineWidth');
      if (stored) {
        const w = parseInt(stored, 10);
        if (w >= 150 && w <= 500) {
          this._outlineSidebar.style.width = `${w}px`;
        }
      }
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
      startDrag('col-resize');

      const onMouseMove = (e: MouseEvent): void => {
        const delta = e.clientX - startX;
        startX = e.clientX;
        currentW = Math.max(MIN_W, Math.min(MAX_W, currentW + delta));
        this._outlineSidebar.style.width = `${currentW}px`;
      };

      const onMouseUp = (): void => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        this._outlineSash.classList.remove('active');
        endDrag();
        // Persist width
        localStorage.setItem('parallx.pdfOutlineWidth', String(currentW));
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
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
    show(this._loadingEl);
    hide(this._errorEl);
    show(this._toolbar);

    try {
      // Read file bytes via Electron bridge
      const electron = (globalThis as any).parallxElectron;
      if (!electron?.fs?.readFile) throw new Error('File-system bridge unavailable');

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
        maxCanvasPixels: 32 * 1024 * 1024,
        enableDetailCanvas: true,
        enableHWA: false,
        supportsPinchToZoom: true,
        enableAutoLinking: true,
        l10n: new GenericL10n('en-US'),
      });

      this._linkService.setViewer(this._pdfViewer);

      // ── Listen to viewer events ────────────────────────────────────

      this._eventBus.on('pagechanging', (evt: any) => {
        const pageNum = evt.pageNumber;
        this._pageInput.value = String(pageNum);
        this._updatePageLabel(pageNum);
        this._highlightThumb(pageNum);
      });

      this._eventBus.on('scalechanging', (evt: any) => {
        this._zoomLabelEl.textContent = `${Math.round(evt.scale * 100)}%`;
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

      this._pdfDoc = await pdfjsLib.getDocument({ data }).promise;

      this._pdfViewer.setDocument(this._pdfDoc);
      this._linkService.setDocument(this._pdfDoc, null);
      this._findController.setDocument(this._pdfDoc);

      // Update toolbar page count
      this._pageTotalEl.textContent = String(this._pdfDoc.numPages);
      this._pageInput.value = '1';

      // Set initial scale after pages are initialized
      // B5.2: Restore user's persisted scale preference (fallback to 'page-fit')
      const storedScale = localStorage.getItem('parallx.pdfScaleValue');
      if (storedScale) {
        this._scaleValue = storedScale;
      }
      this._eventBus.on('pagesinit', () => {
        this._pdfViewer!.currentScaleValue = this._scaleValue;
        this._zoomLabelEl.textContent = `${Math.round(this._pdfViewer!.currentScale * 100)}%`;
      });

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
        this._outlineBtn.style.opacity = '1';
      } else {
        this._outline = null;
        this._outlineBtn.style.opacity = '0.4';
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
    localStorage.setItem('parallx.pdfScaleValue', value);
  }

  // ── Rotation ─────────────────────────────────────────────────────────

  private _rotate(): void {
    if (!this._pdfViewer) return;
    this._pdfViewer.pagesRotation = (this._pdfViewer.pagesRotation + 90) % 360;
  }

  // ── Thumbnail sidebar ────────────────────────────────────────────────

  private _toggleThumbnails(forceState?: boolean): void {
    this._thumbnailVisible = forceState ?? !this._thumbnailVisible;
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

  // ── Spread & scroll modes ────────────────────────────────────────────

  private _cycleSpreadMode(): void {
    if (!this._pdfViewer) return;
    const current = this._pdfViewer.spreadMode;
    if (current === SpreadMode.NONE) {
      this._pdfViewer.spreadMode = SpreadMode.ODD;
      this._spreadBtn.title = 'Spread: Odd (click to cycle)';
    } else if (current === SpreadMode.ODD) {
      this._pdfViewer.spreadMode = SpreadMode.EVEN;
      this._spreadBtn.title = 'Spread: Even (click to cycle)';
    } else {
      this._pdfViewer.spreadMode = SpreadMode.NONE;
      this._spreadBtn.title = 'Spread: Off (click to cycle)';
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

  private _print(): void {
    window.print();
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

  private _wireContextMenu(): void {
    // Show shared ContextMenu on mouseup when text is selected
    this._viewerContainer.addEventListener('mouseup', (e) => {
      requestAnimationFrame(() => {
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
    });

    // Dismiss on scroll
    this._viewerContainer.addEventListener('scroll', () => this._dismissContextMenu());
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
          id: 'pdf.findInDocument',
          label: 'Find in document',
          keybinding: 'Ctrl+F',
          disabled: !hasSel,
        },
      ],
      anchor: { x, y },
    });

    menu.onDidSelect((e) => {
      if (e.item.id === 'pdf.copy') {
        if (this._capturedSelection) {
          void navigator.clipboard.writeText(this._capturedSelection);
        }
      } else if (e.item.id === 'pdf.findInDocument') {
        const sel = this._capturedSelection.trim();
        if (sel) {
          this._toggleSearch(true);
          this._searchInput.value = sel;
          this._dispatchFind('find');
        }
      }
    });

    this._activeContextMenu = menu;
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
        if (this._pdfViewer) {
          // Re-apply the current scale value — the viewer recalculates
          // 'page-width' / 'page-fit' / 'auto' to the new container size.
          this._pdfViewer.currentScaleValue = this._pdfViewer.currentScaleValue;
        }
      }, 150);
    }
  }

  private _cleanup(): void {
    if (this._resizeTimer) { clearTimeout(this._resizeTimer); this._resizeTimer = null; }

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
    this._thumbCanvases.clear();
    this._activeThumb = null;
    this._outline = null;
    this._pageLabels = null;
    this._currentInput = null;

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
