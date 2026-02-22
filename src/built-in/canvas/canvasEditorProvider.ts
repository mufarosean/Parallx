// canvasEditorProvider.ts — Canvas editor pane with Tiptap rich text editor
//
// Provides the editor provider registered via api.editors.registerEditorProvider.
// Each editor pane hosts a Tiptap instance, loads page content from
// CanvasDataService, and auto-saves content changes.
//
// Extensions loaded (Notion-parity):
//
// Tier 1 (core Notion feel):
//   • StarterKit (headings, bold, italic, strike, code, blockquote, lists,
//     hr, link, underline — all bundled in StarterKit v3)
//   • Placeholder, TaskList, TaskItem
//   • TextStyle, Color, Highlight, Image
//   • GlobalDragHandle (block drag-reorder)
//   • Custom BubbleMenu (floating toolbar on text selection)
//
// Tier 2 (power-user Notion features):
//   • Callout — custom Node.create() with emoji + colored background
//   • Details / DetailsContent / DetailsSummary (toggle list / collapsible)
//   • TableKit (Table + TableRow + TableCell + TableHeader, resizable)
//   • CodeBlockLowlight (syntax-highlighted code blocks via lowlight/highlight.js)
//   • CharacterCount (word/char counter)
//   • AutoJoiner (companion to drag handle — joins same-type adjacent blocks)
//   • MathExtension + InlineMathNode (@aarkue/tiptap-math-extension — inline LaTeX via $...$)
//   • MathBlock (custom block-level equation node with click-to-edit + KaTeX)
//   • Column + ColumnList (spatial partitions — not blocks; created via slash menu or drag-and-drop)
//   • ColumnDrop plugin (drag block to side of another to create/modify columns)

import { DisposableStore, type IDisposable } from '../../platform/lifecycle.js';
import type { IEditorInput } from '../../editor/editorInput.js';
import type { ICanvasDataService } from './canvasTypes.js';
import { Editor } from '@tiptap/core';
import { common, createLowlight } from 'lowlight';
import { $ } from '../../ui/dom.js';
import { createEditorExtensions, PageChromeController } from './config/blockRegistry.js';
import { BlockHandlesController, BlockSelectionController } from './handles/handleRegistry.js';
import { CanvasMenuRegistry, type IBlockActionMenu } from './menus/canvasMenuRegistry.js';

// Create lowlight instance with common language set (JS, TS, CSS, HTML, Python, etc.)
const lowlight = createLowlight(common);
// ─── Canvas Editor Provider ─────────────────────────────────────────────────

export type OpenEditorFn = (options: { typeId: string; title: string; icon?: string; instanceId?: string }) => Promise<void>;

export class CanvasEditorProvider {
  private _openEditor: OpenEditorFn | undefined;

  /**
   * External ribbon containers for editor-group-level rendering.
   * Keyed by pageId; populated by createRibbon(), consumed by pane init().
   */
  private readonly _ribbonContainers = new Map<string, HTMLElement>();

  /**
   * Page-menu handlers registered by initialised panes.
   * The ribbon's ⋯ button invokes these to show the full PageChromeController menu.
   */
  private readonly _pageMenuHandlers = new Map<string, () => void>();

  constructor(private readonly _dataService: ICanvasDataService) {}

  /**
   * Set the openEditor callback so panes can navigate to other pages.
   */
  setOpenEditor(fn: OpenEditorFn): void {
    this._openEditor = fn;
  }

  /**
   * Create an editor pane for a Canvas page.
   *
   * @param container — DOM element to render into
   * @param input — the ToolEditorInput (input.id === pageId)
   */
  createEditorPane(container: HTMLElement, input?: IEditorInput): IDisposable {
    const pageId = input?.id ?? '';
    const pane = new CanvasEditorPane(container, pageId, this._dataService, input, this._openEditor, this);
    pane.init().catch(err => {
      console.error('[CanvasEditorProvider] Editor pane initialization failed:', err);
    });
    return pane;
  }

  /**
   * Provide custom ribbon content for the editor group ribbon slot.
   *
   * Called by EditorGroupView before the pane has finished initializing.
   * We store the container reference so the pane's PageChromeController can
   * render into it once async init completes.
   */
  createRibbon(container: HTMLElement, input?: IEditorInput): IDisposable {
    const pageId = input?.id ?? '';
    this._ribbonContainers.set(pageId, container);

    // Set min-height so layout calculates correctly before pane fills it
    container.style.minHeight = '28px';

    return {
      dispose: () => {
        this._ribbonContainers.delete(pageId);
        this._pageMenuHandlers.delete(pageId);
        container.style.minHeight = '';
        container.innerHTML = '';
      },
    };
  }

  /** Get the external ribbon container stored by createRibbon(). */
  getRibbonContainer(pageId: string): HTMLElement | undefined {
    return this._ribbonContainers.get(pageId);
  }

  /** Register a page-menu handler (called by pane after init). */
  registerPageMenuHandler(pageId: string, handler: () => void): IDisposable {
    this._pageMenuHandlers.set(pageId, handler);
    return { dispose: () => { this._pageMenuHandlers.delete(pageId); } };
  }

  /** Get the page-menu handler (called by ribbon ⋯ button). */
  getPageMenuHandler(pageId: string): (() => void) | undefined {
    return this._pageMenuHandlers.get(pageId);
  }
}

// ─── Canvas Editor Pane ─────────────────────────────────────────────────────

class CanvasEditorPane implements IDisposable {
  private _editor: Editor | null = null;
  private _editorContainer: HTMLElement | null = null;
  private _menuRegistry!: CanvasMenuRegistry;
  private _disposed = false;
  private _initComplete = false;
  private _suppressUpdate = false;
  private readonly _saveDisposables = new DisposableStore();

  // ── Page chrome controller ──
  private _pageChrome!: PageChromeController;

  // ── Block handles controller ──
  private _blockHandles!: BlockHandlesController;

  // ── Block action menu (handle returned by registry factory) ──
  private _blockActionMenu!: IBlockActionMenu;

  // ── Block selection controller ──
  private _blockSelection!: BlockSelectionController;

  constructor(
    private readonly _container: HTMLElement,
    private readonly _pageId: string,
    private readonly _dataService: ICanvasDataService,
    private readonly _input: IEditorInput | undefined,
    private readonly _openEditor: OpenEditorFn | undefined,
    private readonly _provider: CanvasEditorProvider,
  ) {}

  // ── Public accessors for controller hosts ──
  get editor(): Editor | null { return this._editor; }
  get container(): HTMLElement { return this._container; }
  get editorContainer(): HTMLElement | null { return this._editorContainer; }
  get dataService(): ICanvasDataService { return this._dataService; }
  get pageId(): string { return this._pageId; }
  get suppressUpdate(): boolean { return this._suppressUpdate; }
  set suppressUpdate(v: boolean) { this._suppressUpdate = v; }
  get input(): IEditorInput | undefined { return this._input; }
  get openEditor(): OpenEditorFn | undefined { return this._openEditor; }
  get blockSelection(): BlockSelectionController { return this._blockSelection; }

  /** Registry-managed icon picker delegate — lazy because registry is created after pageChrome. */
  get showIconPicker(): (opts: {
    anchor: HTMLElement;
    showSearch?: boolean;
    showRemove?: boolean;
    iconSize?: number;
    onSelect: (iconId: string) => void;
    onRemove?: () => void;
  }) => void {
    return (opts) => this._menuRegistry?.showIconMenu(opts);
  }

  /** Registry-managed cover picker delegate — lazy because registry is created after pageChrome. */
  get showCoverPicker(): (opts: {
    editorContainer: HTMLElement | null;
    coverEl?: HTMLElement | null;
    pageHeader?: HTMLElement | null;
    onSelectCover: (coverUrl: string) => void;
  }) => void {
    return (opts) => this._menuRegistry?.showCoverMenu(opts);
  }

  requestSave(_reason: string): void {
    if (!this._editor || !this._pageId || !this._initComplete) return;
    const json = JSON.stringify(this._editor.getJSON());
    this._dataService.scheduleContentSave(this._pageId, json);
  }

  async init(): Promise<void> {
    // Create editor wrapper
    this._editorContainer = $('div.canvas-editor-wrapper');
    this._container.appendChild(this._editorContainer);

    // ── Load page data for header rendering ──
    this._pageChrome = new PageChromeController(this);
    try {
      this._pageChrome.currentPage = await this._dataService.getPage(this._pageId) ?? null;
    } catch {
      this._pageChrome.currentPage = null;
    }

    // ── Apply page display settings CSS classes ──
    this._pageChrome.applyPageSettings();

    // ── Create page chrome (ribbon, cover, header) ──
    // If an external ribbon container was provided by createRibbon(),
    // PageChromeController renders the ribbon there (editor-group level).
    const externalRibbon = this._provider.getRibbonContainer(this._pageId);
    this._pageChrome.createChrome(externalRibbon);

    // Create Tiptap editor with Notion-parity extensions
    this._editor = new Editor({
      element: this._editorContainer,
      extensions: createEditorExtensions(lowlight, {
        dataService: this._dataService,
        pageId: this._pageId,
        openEditor: this._openEditor,
        showIconPicker: (opts) => this._menuRegistry?.showIconMenu(opts),
      }),
      content: '',
      editorProps: {
        attributes: {
          class: 'canvas-tiptap-editor',
        },
        handleKeyDown: (_view, event) => {
          // Prevent Parallx keybinding system from capturing editor shortcuts
          if (event.ctrlKey || event.metaKey || event.altKey) {
            event.stopPropagation();
          }
          return false;
        },
      },
      onUpdate: ({ editor }) => {
        if (this._suppressUpdate) return;
        const json = JSON.stringify(editor.getJSON());
        this._dataService.scheduleContentSave(this._pageId, json);
      },
      onTransaction: ({ editor }) => {
        if (this._suppressUpdate) return;
        this._menuRegistry?.notifyTransaction(editor);
      },
      onSelectionUpdate: ({ editor }) => {
        this._menuRegistry?.notifySelectionUpdate(editor);
      },
      onBlur: () => {
        // Small delay so clicking menu buttons doesn't dismiss them
        setTimeout(() => {
          if (
            !this._menuRegistry.containsFocusedElement()
          ) {
            this._menuRegistry.hideAll();
          }
        }, 150);
      },
    });

    // Load content (skip corrupted content gracefully)
    try {
      await this._loadContent();
    } catch (err) {
      console.warn('[CanvasEditorPane] Content loading failed, starting with empty editor:', err);
    }

    // Bail out if disposed during async content load
    if (this._disposed) return;

    // Expose editor for E2E tests (test mode only)
    if ((window as any).parallxElectron?.testMode) {
      (window as any).__tiptapEditor = this._editor;
    }

    // ── Create menu registry and all menus ──
    this._menuRegistry = new CanvasMenuRegistry(() => this._editor);
    this._blockActionMenu = this._menuRegistry.createStandardMenus(this);

    // Setup block handles (+ button, drag-handle click menu)
    this._blockHandles = new BlockHandlesController(this, this._blockActionMenu);
    this._blockHandles.setup();

    // Setup block selection model
    this._blockSelection = new BlockSelectionController(this);
    this._blockSelection.setup();

    // Wire Esc shortcut → block selection (via extension storage)
    const kbExt = this._editor.extensionManager.extensions.find(
      (ext) => ext.name === 'blockKeyboardShortcuts',
    );
    if (kbExt) {
      (kbExt.storage as any).selectAtCursor = () => this._blockSelection.selectAtCursor();
    }

    // ── Click handler for inline math nodes (click-to-edit) ──
    this._editorContainer.addEventListener('click', (e) => {
      const target = (e.target as HTMLElement).closest('.tiptap-math.latex');
      if (!target || !this._editor) return;
      e.preventDefault();
      e.stopPropagation();
      // Find ProseMirror position of the clicked node
      const pos = this._editor.view.posAtDOM(target, 0);
      const node = this._editor.state.doc.nodeAt(pos);
      if (node && node.type.name === 'inlineMath') {
        this._menuRegistry.showInlineMathEditor(pos, node.attrs.latex || '', target as HTMLElement);
      }
    });

    // Subscribe to save completion (Task 6.1)
    this._saveDisposables.add(
      this._dataService.onDidSavePage((savedPageId) => {
        if (savedPageId === this._pageId) {
          // Auto-save completed — no dirty tracking needed for canvas
        }
      }),
    );

    // Subscribe to page changes for bidirectional sync (Task 7.2)
    this._saveDisposables.add(
      this._dataService.onDidChangePage((event) => {
        if (event.pageId !== this._pageId || !event.page) return;
        this._pageChrome.syncPageChange(event.page);
        this._pageChrome.applyPageSettings();
      }),
    );

    // Register page-menu handler so the external ribbon's ⋯ button can
    // trigger the full page menu (which lives in PageChromeController).
    this._saveDisposables.add(
      this._provider.registerPageMenuHandler(this._pageId, () => {
        this._pageChrome.showPageMenu();
      }),
    );

    this._initComplete = true;
  }

  // ══════════════════════════════════════════════════════════════════════════  // Content Loading
  // ══════════════════════════════════════════════════════════════════════════════

  private async _loadContent(): Promise<void> {
    if (!this._editor || !this._pageId) return;

    try {
      const page = await this._dataService.getPage(this._pageId);
      if (page && page.content) {
        this._suppressUpdate = true;
        try {
          const decoded = await this._dataService.decodePageContentForEditor(page);
          this._editor.commands.setContent(decoded.doc);
          if (decoded.recovered) {
            console.warn(`[CanvasEditorPane] Recovered and normalized content for page "${this._pageId}"`);
          }
        } finally {
          this._suppressUpdate = false;
        }
      }
    } catch (err) {
      this._suppressUpdate = false;
      console.error(`[CanvasEditorPane] Failed to load page "${this._pageId}":`, err);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════════  // Dispose
  // ══════════════════════════════════════════════════════════════════════════

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;

    this._menuRegistry?.hideAll();
    this._blockHandles?.hide();
    this._blockSelection?.clear();
    this._pageChrome?.dismissPopups();

    this._blockHandles?.dispose();
    this._blockSelection?.dispose();

    // Dispose save-state subscriptions
    this._saveDisposables.dispose();

    if (this._editor) {
      this._editor.destroy();
      this._editor = null;
    }

    if (this._editorContainer) {
      this._editorContainer.remove();
      this._editorContainer = null;
    }

    this._menuRegistry?.dispose(); // disposes all menus (slash, bubble, blockAction, inlineMath, etc.)
    this._pageChrome?.dispose();
  }
}
