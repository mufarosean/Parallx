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
//   • BlockHandlesController (native drag handle — block drag-reorder)
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
import { diffTopLevel, computeReplaceRange } from './canvasDocDiff.js';
import { ComposeStreamSession } from './composeStreamSession.js';
import { Editor } from '@tiptap/core';
import { common, createLowlight } from 'lowlight';
import { $ } from '../../ui/dom.js';
import { createEditorExtensions, PageChromeController, renderPageIconHtml } from './config/blockRegistry.js';
import { BlockHandlesController, BlockSelectionController, BlockMarqueeController, createBlockSelectionPlugin } from './handles/handleRegistry.js';
import { CanvasMenuRegistry, type IBlockActionMenu } from './menus/canvasMenuRegistry.js';
import type { SendChatRequestFn, RetrieveContextFn } from './menus/canvasMenuRegistry.js';
import type { IPropertyDataService } from './properties/propertyTypes.js';
import { PropertyBar } from './properties/propertyBar.js';

// Create lowlight instance with common language set (JS, TS, CSS, HTML, Python, etc.)
const lowlight = createLowlight(common);
// ─── Canvas Editor Provider ─────────────────────────────────────────────────

export type OpenEditorFn = (options: { typeId: string; title: string; icon?: string; iconHtml?: string; instanceId?: string }) => Promise<void>;

interface CanvasWindowApi {
  showInformationMessage(message: string, ...actions: { title: string }[]): Promise<{ title: string } | undefined>;
  showWarningMessage(message: string, ...actions: { title: string }[]): Promise<{ title: string } | undefined>;
  showErrorMessage(message: string, ...actions: { title: string }[]): Promise<{ title: string } | undefined>;
}

interface ElectronLinkBridge {
  shell?: {
    openExternal?: (url: string) => Promise<{ ok?: boolean; error?: string } | void>;
  };
  clipboard?: {
    writeText?: (text: string) => void;
  };
}

function getElectronLinkBridge(): ElectronLinkBridge | undefined {
  return (globalThis as unknown as { parallxElectron?: ElectronLinkBridge }).parallxElectron;
}

function normalizeExternalWebLink(rawHref: string): string | null {
  const trimmed = rawHref.trim();
  if (!trimmed) return null;

  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed);
  const candidate = hasScheme ? trimmed : `https://${trimmed}`;

  try {
    const url = new URL(candidate);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

async function writeClipboardText(text: string): Promise<boolean> {
  const bridge = getElectronLinkBridge();
  if (bridge?.clipboard?.writeText) {
    try {
      bridge.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the browser clipboard API.
    }
  }

  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * A pane's live-compose sink — lets canvas_compose_page type the model's
 * streamed markdown into the visible editor block-by-block.
 */
export interface IPageStreamSink {
  /** Enter compose mode (snapshot + read-only). False if a stream is already active. */
  begin(): boolean;
  /** Ingest a raw model content delta; applies the minimal block patch live. */
  push(delta: string): void;
  /** Leave compose mode. Commit persists the streamed doc through the standard
   *  save path; revert restores the pre-stream snapshot. Returns false when the
   *  pane could not commit (e.g. closed mid-stream) — caller must persist the
   *  accumulated markdown itself. */
  end(commit: boolean): Promise<boolean>;
}

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

  /** Live-compose stream sinks registered by open panes (keyed by pageId). */
  private readonly _streamSinks = new Map<string, IPageStreamSink>();

  /** Inline AI provider functions (set after chat tool activation). */
  private _inlineAISendChat: SendChatRequestFn | undefined;
  private _inlineAIRetrieveContext: RetrieveContextFn | undefined;

  /** Property data service (set from main.ts after activation). */
  private _propertyService: IPropertyDataService | undefined;

  /** Database data service (set from main.ts) — drives the row-page
   *  properties section when an opened page is a database row. */
  private _databaseService: import('./database/databaseDataService.js').DatabaseDataService | undefined;
  setDatabaseService(db: import('./database/databaseDataService.js').DatabaseDataService): void {
    this._databaseService = db;
  }
  get databaseService(): import('./database/databaseDataService.js').DatabaseDataService | undefined {
    return this._databaseService;
  }

  constructor(
    private readonly _dataService: ICanvasDataService,
    private readonly _window: CanvasWindowApi | undefined,
  ) {}

  /**
   * Set the openEditor callback so panes can navigate to other pages.
   */
  setOpenEditor(fn: OpenEditorFn): void {
    this._openEditor = fn;
  }

  /**
   * Set the inline AI provider so canvas panes can create inline AI menus.
   * Called from canvas main.ts after the chat tool registers its provider.
   */
  setInlineAIProvider(sendChat: SendChatRequestFn, retrieveContext?: RetrieveContextFn): void {
    this._inlineAISendChat = sendChat;
    this._inlineAIRetrieveContext = retrieveContext;
  }

  /**
   * Set the property data service so panes can show the property bar.
   * Called from canvas main.ts after PropertyDataService creation.
   */
  setPropertyService(service: IPropertyDataService): void {
    this._propertyService = service;
  }

  /** Get the property service (consumed by panes for PropertyBar). */
  get propertyService(): IPropertyDataService | undefined { return this._propertyService; }

  /** Whether the inline AI provider has been configured. */
  get hasInlineAI(): boolean { return !!this._inlineAISendChat; }
  get inlineAISendChat(): SendChatRequestFn | undefined { return this._inlineAISendChat; }
  get inlineAIRetrieveContext(): RetrieveContextFn | undefined { return this._inlineAIRetrieveContext; }

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

  /** Whether a live editor pane exists for this page (panes register their
   *  page-menu handler on init and remove it on dispose). Used to skip the
   *  redundant focus-steal when an AI edit targets an already-open page. */
  isPageOpen(pageId: string): boolean {
    return this._pageMenuHandlers.has(pageId);
  }

  /** Register a pane's live-compose stream sink (called by pane after init). */
  registerStreamSink(pageId: string, sink: IPageStreamSink): IDisposable {
    this._streamSinks.set(pageId, sink);
    return { dispose: () => { this._streamSinks.delete(pageId); } };
  }

  /** The live-compose sink for an OPEN page, if any. canvas_compose_page uses
   *  this to type the model's output into the visible editor; absent (page not
   *  open) it falls back to a plain DB write. */
  getStreamSink(pageId: string): IPageStreamSink | undefined {
    return this._streamSinks.get(pageId);
  }

  get window(): CanvasWindowApi | undefined {
    return this._window;
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

  /**
   * Snapshot of pageBlock pageIds present in the editor doc, kept in sync
   * by `onTransaction`.  When the user deletes or pastes a pageBlock card,
   * the diff against this snapshot tells us to archive/restore the linked
   * page (single source of truth: pages.parent_id mirrors what the user sees).
   */
  private _pageBlockIds = new Set<string>();

  /**
   * Monotonic generation counter for `_loadContent` calls (M77 Phase 8.3).
   * Each call increments and captures the new value; before applying its
   * result it checks the captured value still matches `_loadGeneration`.
   * A later call invalidates earlier in-flight loads so a slow reload
   * can't overwrite a newer one (the bug: open editor receives two
   * onRequestContentReload events; the older's `setContent` lands after
   * the newer's, reverting the editor to stale content).
   */
  private _loadGeneration = 0;

  /**
   * Set true after the first `_loadContent()` finishes seeding `_pageBlockIds`
   * from the freshly loaded doc.  Until then any `docChanged` transaction
   * (e.g. UniqueID's `appendTransaction` adding ids to legacy nodes, or any
   * plugin firing during editor construction) would be diffed against an
   * EMPTY snapshot and incorrectly conclude every existing pageBlock had
   * been “removed” — triggering archivePage cascades that walk every page
   * and prune referenced pageBlock cards.  Gating the reconciler on this
   * flag prevents that whole class of false-positive archive cascades.
   */
  private _initialContentLoaded = false;
  private readonly _saveDisposables = new DisposableStore();

  // ── Page chrome controller ──
  private _pageChrome!: PageChromeController;

  // ── Block handles controller ──
  private _blockHandles!: BlockHandlesController;

  // ── Block action menu (handle returned by registry factory) ──
  private _blockActionMenu!: IBlockActionMenu;

  // ── Block selection controller ──
  private _blockSelection!: BlockSelectionController;

  // ── Block marquee (box-drag lasso selection) ──
  private _blockMarquee!: BlockMarqueeController;

  // ── Property bar ──
  private _propertyBar: PropertyBar | null = null;

  private readonly _handleEditorLinkClick = (event: MouseEvent): void => {
    if (event.defaultPrevented || event.button !== 0) return;

    const target = event.target as HTMLElement | null;
    if (!target?.closest('.canvas-tiptap-editor')) return;

    const link = target.closest<HTMLAnchorElement>('a[href]');
    if (!link || !this._editorContainer?.contains(link)) return;

    const href = link.getAttribute('href') ?? '';
    if (!href.trim()) return;

    event.preventDefault();
    event.stopPropagation();
    void this.openLinkInExternalBrowser(href);
  };

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

  async copyLinkToClipboard(href: string): Promise<void> {
    const text = href.trim();
    if (!text) return;

    const copied = await writeClipboardText(text);
    if (copied) {
      await this._provider.window?.showInformationMessage('Link copied.');
    } else {
      await this._provider.window?.showWarningMessage('Could not copy link.');
    }
  }

  async openLinkInExternalBrowser(href: string): Promise<void> {
    const url = normalizeExternalWebLink(href);
    if (!url) {
      await this._provider.window?.showWarningMessage('Only http:// and https:// links can be opened.');
      return;
    }

    const confirmation = await this._provider.window?.showWarningMessage(
      'Open link in external browser?',
      { title: 'Open' },
      { title: 'Cancel' },
    );
    if (confirmation?.title !== 'Open') return;

    try {
      const shell = getElectronLinkBridge()?.shell;
      if (shell?.openExternal) {
        const result = await shell.openExternal(url);
        if (result && typeof result === 'object' && result.ok === false) {
          throw new Error(result.error || 'openExternal failed');
        }
        return;
      }

      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      console.error('[CanvasEditorPane] Failed to open external link:', err);
      await this._provider.window?.showErrorMessage('Failed to open link.');
    }
  }

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

    // ── Restore tab label + icon on the input ──
    // On workspace restore the deserializer intentionally omits iconHtml
    // (it's a view artefact, not persisted). Re-seed it now from the loaded
    // page so Open Editors / tab bar show the user-chosen icon immediately
    // rather than falling back to the generic filetype icon until the next
    // page edit triggers syncPageChange.
    const restoredPage = this._pageChrome.currentPage;
    if (this._input && restoredPage) {
      if (typeof (this._input as any).setName === 'function') {
        (this._input as any).setName(restoredPage.title || 'Untitled');
      }
      if (typeof (this._input as any).setIconHtml === 'function') {
        (this._input as any).setIconHtml(renderPageIconHtml(restoredPage.icon));
      }
    }

    // ── Apply page display settings CSS classes ──
    this._pageChrome.applyPageSettings();

    // ── Create page chrome (ribbon, cover, header) ──
    // If an external ribbon container was provided by createRibbon(),
    // PageChromeController renders the ribbon there (editor-group level).
    const externalRibbon = this._provider.getRibbonContainer(this._pageId);
    this._pageChrome.createChrome(externalRibbon);

    // ── Create property bar (below header, above editor) ──
    const propService = this._provider.propertyService;
    const pageHeader = this._pageChrome.pageHeader;
    if (propService && pageHeader) {
      this._propertyBar = new PropertyBar(
        this._editorContainer!,
        pageHeader,
        this._pageId,
        propService,
        this._dataService,
        this._provider.window,
        // M85 — let tag chips navigate to other pages sharing the tag.
        (pageId, title) => {
          void this._openEditor?.({ typeId: 'canvas', title: title || 'Untitled', instanceId: pageId });
        },
      );
      this._propertyBar.init().catch(err => {
        console.warn('[CanvasEditorPane] PropertyBar init failed:', err);
      });
    }

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
          spellcheck: 'true',
        },
        handleDOMEvents: {
          mousedown: (_view, event) => {
            if (event.button === 2) {
              this._menuRegistry?.markContextMenuGesture();
            } else if (event.button === 0) {
              this._menuRegistry?.clearContextMenuGesture();
            }
            return false;
          },
          contextmenu: () => {
            this._menuRegistry?.markContextMenuGesture();
            return false;
          },
        },
        handleKeyDown: (_view, event) => {
          this._menuRegistry?.clearContextMenuGesture();
          // Prevent Parallx keybinding system from capturing editor shortcuts
          if (event.ctrlKey || event.metaKey || event.altKey) {
            event.stopPropagation();
          }
          return false;
        },
      },
      onUpdate: ({ editor }) => {
        if (this._suppressUpdate) return;
        // Critical: do NOT auto-save until the initial content load has
        // populated the editor.  Plugins (notably UniqueID's
        // appendTransaction) fire `docChanged` transactions during Editor
        // construction \u2014 BEFORE _loadContent runs setContent under
        // _suppressUpdate.  Without this guard, scheduleContentSave would
        // queue the empty default doc; the debounced timer would then
        // overwrite the page's stored content with the empty doc, causing
        // permanent data loss.
        if (!this._initialContentLoaded) return;
        const json = JSON.stringify(editor.getJSON());
        this._dataService.scheduleContentSave(this._pageId, json);
      },
      onTransaction: ({ editor, transaction }) => {
        if (this._suppressUpdate) return;
        this._menuRegistry?.notifyTransaction(editor);
        // Invalidate cached DOM refs in the handle layer when the document
        // structure changes — prevents stale _lastHoverElement from causing
        // _resolveBlockFromHandle() to target the wrong block.
        if (transaction.docChanged) {
          this._blockHandles?.notifyDocChanged();
          // Only reconcile after the initial content load has seeded the
          // pageBlock snapshot.  Otherwise an early docChanged transaction
          // (UniqueID id assignment, etc.) would diff against an empty set
          // and erroneously archive every existing pageBlock target.
          if (this._initialContentLoaded) {
            this._reconcilePageBlockHierarchy(editor, transaction);
          }
        }
      },
      onSelectionUpdate: ({ editor }) => {
        this._menuRegistry?.notifySelectionUpdate(editor);
      },
      onBlur: () => {
        // Small delay so clicking menu buttons doesn't dismiss them.
        // Also skip if the blur was caused by a handle interaction
        // (mousedown on drag handle transfers focus away from PM).
        setTimeout(() => {
          if (this._menuRegistry.isInteractionLocked()) return;
          if (
            !this._menuRegistry.containsFocusedElement()
          ) {
            this._menuRegistry.hideAll();
          }
        }, 150);
      },
    });

    // Register the block-selection decoration plugin so that .block-selected
    // classes are applied via PM decorations (survives DOM reconciliation).
    this._editor.registerPlugin(createBlockSelectionPlugin());

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

    // ── Create inline AI chat if chat tool has registered its provider ──
    if (this._provider.hasInlineAI) {
      this._menuRegistry.createAIChat(
        this,
        this._provider.inlineAISendChat!,
        this._provider.inlineAIRetrieveContext,
      );
    }

    // Setup block handles (+ button, drag-handle click menu)
    this._blockHandles = new BlockHandlesController(this, this._blockActionMenu);
    this._blockHandles.setup();

    // Setup block selection model
    this._blockSelection = new BlockSelectionController(this);
    this._blockSelection.setup();

    // Setup block marquee (box-drag selection)
    this._blockMarquee = new BlockMarqueeController(this);
    this._blockMarquee.setup();

    // Wire block-selection callbacks into the extension storage.
    //
    // The keymap handlers in `BlockKeyboardShortcuts.addKeyboardShortcuts()`
    // read from `this.storage.<fn>` which Tiptap resolves to
    // `editor.storage.blockKeyboardShortcuts.<fn>`. We MUST mutate that
    // object directly — `extensionManager.extensions[i].storage` is the
    // extension *descriptor's* storage and is a distinct instance from the
    // per-editor storage the keymap reads, so writes there never reach the
    // keymap. Caught by the diagnostic spec on 2026-05-27: every storage
    // function was null at runtime, breaking Mod-Shift-Arrow movement (and
    // by extension every other shortcut that bootstraps from cursor).
    const kbStorage = (this._editor.storage as any).blockKeyboardShortcuts;
    if (kbStorage) {
      kbStorage.selectAtCursor = () => this._blockSelection.selectAtCursor();
      kbStorage.extendSelectionUp = () => this._blockSelection.extendSelectionUp();
      kbStorage.extendSelectionDown = () => this._blockSelection.extendSelectionDown();
      kbStorage.deleteSelected = () => this._blockSelection.deleteSelected();
      kbStorage.duplicateSelected = () => this._blockSelection.duplicateSelected();
      kbStorage.moveSelectedUp = () => this._blockSelection.moveSelectedUp();
      kbStorage.moveSelectedDown = () => this._blockSelection.moveSelectedDown();
      kbStorage.enterEditFirstSelected = () => this._blockSelection.enterEditFirstSelected();
      kbStorage.hasSelection = () => this._blockSelection.hasSelection;
    }

    // ── Click handler for inline math nodes (click-to-edit) ──
    // Link clicks prompt before leaving Parallx for the external browser.
    this._editorContainer.addEventListener('click', this._handleEditorLinkClick);
    this._saveDisposables.add({
      dispose: () => this._editorContainer?.removeEventListener('click', this._handleEditorLinkClick),
    });

    // Inline math nodes open their in-place editor on click.
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
      this._dataService.onDidSavePage((event) => {
        if (event.pageId === this._pageId) {
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

    // Reload editor content when an external consumer (sidebar) changed it
    this._saveDisposables.add(
      this._dataService.onRequestContentReload((reloadPageId) => {
        if (reloadPageId !== this._pageId) return;
        this._loadContent();
      }),
    );

    // Register page-menu handler so the external ribbon's ⋯ button can
    // trigger the full page menu (which lives in PageChromeController).
    this._saveDisposables.add(
      this._provider.registerPageMenuHandler(this._pageId, () => {
        this._pageChrome.showPageMenu();
      }),
    );

    // Register the live-compose stream sink so canvas_compose_page can type the
    // model's output into this pane block-by-block (removed on dispose).
    this._saveDisposables.add(
      this._provider.registerStreamSink(this._pageId, {
        begin: () => this._beginAIStream(),
        push: (delta) => this._pushAIStreamDelta(delta),
        end: (commit) => this._endAIStream(commit),
      }),
    );

    this._initComplete = true;

    // Database-row pages show their database properties between the title and
    // the content (Notion parity: title → properties → body). Best-effort.
    const dbService = this._provider.databaseService;
    if (dbService && this._editorContainer && this._editor) {
      const editorDom = this._editor.view.dom as HTMLElement;
      import('./database/rowPropertiesSection.js')
        .then((m) => m.mountRowPropertiesSection(this._editorContainer!, this._pageId, dbService, editorDom))
        .then((d) => { if (d) this._saveDisposables.add(d); })
        .catch((err) => console.warn('[CanvasEditorPane] Row-properties section failed:', err));
    }

    // M66 Iter B — Listen for `parallx:canvas-reveal-block` events emitted
    // by the canvas link contract's open() handler. The contract dispatches
    // the event after openPageInEditor(); the pane filters by pageId so
    // only the right tab scrolls. Best-effort, non-fatal: a missing block
    // simply no-ops.
    const revealHandler = (ev: Event) => {
      const detail = (ev as CustomEvent<{ pageId?: string; blockId?: string }>).detail;
      if (!detail || detail.pageId !== this._pageId || !detail.blockId) return;
      const wrapper = this._editorContainer;
      if (!wrapper) return;
      const el = wrapper.querySelector<HTMLElement>(`[data-id="${CSS.escape(detail.blockId)}"]`);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('parallx-link-highlight');
      window.setTimeout(() => el.classList.remove('parallx-link-highlight'), 2000);
    };
    window.addEventListener('parallx:canvas-reveal-block', revealHandler);
    this._saveDisposables.add({
      dispose: () => window.removeEventListener('parallx:canvas-reveal-block', revealHandler),
    });
  }

  // ══════════════════════════════════════════════════════════════════════════  // Content Loading
  // ══════════════════════════════════════════════════════════════════════════════

  // ══════════════════════════════════════════════════════════════════════════  // PageBlock <-> hierarchy reconciliation
  // ══════════════════════════════════════════════════════════════════════════════

  /**
   * Walk the current editor doc and return the set of pageIds referenced by
   * pageBlock nodes anywhere in the tree (including nested in columns,
   * callouts, details, etc.).
   */
  private _collectPageBlockIds(editor: Editor): Set<string> {
    const ids = new Set<string>();
    editor.state.doc.descendants((node: any) => {
      if (node.type?.name === 'pageBlock') {
        const pid = node.attrs?.pageId;
        if (typeof pid === 'string' && pid.length > 0) ids.add(pid);
      }
      return true;
    });
    return ids;
  }

  /**
   * Diff the current pageBlock set against the previous snapshot.  When the
   * user deletes a pageBlock, archive the linked page so it disappears from
   * the sidebar.  When the user undoes that or pastes the card back, restore
   * the page.  Keeps the visual layer (pageBlock cards) and the authoritative
   * layer (pages.parent_id + is_archived) coherent.
   */
  private _reconcilePageBlockHierarchy(editor: Editor, transaction?: { getMeta(key: string): unknown }): void {
    const current = this._collectPageBlockIds(editor);
    const previous = this._pageBlockIds;

    const removed: string[] = [];
    for (const id of previous) if (!current.has(id)) removed.push(id);
    const added: string[] = [];
    for (const id of current) if (!previous.has(id)) added.push(id);

    // ALWAYS update the snapshot so future diffs are correct, even when
    // we skip the archive/restore side effects below. Without this, a
    // suppressed transaction would leave the snapshot stale and the
    // next legitimate edit would diff against a phantom baseline.
    this._pageBlockIds = current;

    // Cross-page move escape hatch. crossPageMovement sets this meta on
    // its mirror-delete dispatch so we don't archive a page that was
    // just relocated to another canvas — without this, dragging a
    // pageBlock between pages would silently archive the child page.
    if (transaction?.getMeta('canvas-cross-page-move')) return;

    for (const id of removed) {
      void this._dataService.archivePage(id).catch((err) => {
        console.warn(`[CanvasEditorPane] Failed to archive removed pageBlock target "${id}":`, err);
      });
    }

    for (const id of added) {
      void this._dataService.getPage(id).then((page) => {
        if (page?.isArchived) {
          return this._dataService.restorePage(id);
        }
        return undefined;
      }).catch((err) => {
        console.warn(`[CanvasEditorPane] Failed to restore re-added pageBlock target "${id}":`, err);
      });
    }
  }

  private async _loadContent(): Promise<void> {
    if (!this._editor || !this._pageId) return;

    // M77 Phase 8.3 — capture this call's generation. Each async await
    // below re-checks against `_loadGeneration` and bails if a newer
    // call has started, preventing a slow load from clobbering a fast
    // subsequent one.
    const generation = ++this._loadGeneration;
    const isCurrent = (): boolean =>
      !this._disposed && this._loadGeneration === generation && !!this._editor;

    // M77 Phase 1 — repair any pageBlock drift before loading content.
    // No-op when no orphan blocks exist (just one DB read + content scan).
    // Reconciliation does NOT fire its own reload event so we don't
    // re-enter this method; we're about to read the (now-repaired) page
    // below.
    try {
      const repaired = await this._dataService.reconcileParentBlockState(this._pageId);
      if (!isCurrent()) return;
      if (repaired > 0) {
        console.log(`[CanvasEditorPane] Reconciled ${repaired} orphan pageBlock(s) on page "${this._pageId}"`);
      }
    } catch (err) {
      console.warn('[CanvasEditorPane] reconcileParentBlockState failed:', err);
      if (!isCurrent()) return;
    }

    try {
      const page = await this._dataService.getPage(this._pageId);
      if (!isCurrent()) return;
      if (page && page.content) {
        this._suppressUpdate = true;
        try {
          const decoded = await this._dataService.decodePageContentForEditor(page);
          if (!isCurrent()) return;
          // Reloads (external writers — AI tools, sidebar ops) apply SURGICALLY:
          // only the changed top-level blocks are replaced, so the user's
          // cursor/scroll/selection survive and nothing flickers. The full
          // setContent rebuild is reserved for the initial open (no user state
          // to preserve yet) and as the fallback when the surgical path can't
          // represent the change.
          const surgical = this._initialContentLoaded && this._applyExternalDoc(decoded.doc as { type: string; content?: unknown[] });
          if (!surgical) {
            this._editor!.commands.setContent(decoded.doc);
          }
          if (decoded.recovered) {
            console.warn(`[CanvasEditorPane] Recovered and normalized content for page "${this._pageId}"`);
          }
          // Seed the pageBlock snapshot so onTransaction diffs against the
          // freshly loaded doc, not whatever was there before. M77 Phase
          // 8.4 — assigned together with the load completion so no
          // transaction observes an empty snapshot.
          this._pageBlockIds = this._collectPageBlockIds(this._editor!);
        } finally {
          this._suppressUpdate = false;
        }
      } else {
        // New / empty page: the editor doc is whatever TipTap created by
        // default (an empty paragraph).  Seed the snapshot from that doc so
        // any subsequent docChanged diff is well-defined.
        this._pageBlockIds = this._collectPageBlockIds(this._editor);
      }
      // Mark that the snapshot is now valid (regardless of whether content
      // existed) — safe to enable reconciler.
      this._initialContentLoaded = true;
    } catch (err) {
      this._suppressUpdate = false;
      if (!isCurrent()) return;
      console.error(`[CanvasEditorPane] Failed to load page "${this._pageId}":`, err);
    }
  }

  /**
   * Surgically reconcile the live editor with an externally written doc (AI
   * tools, sidebar ops) — the live co-authoring core. Instead of rebuilding the
   * whole document (which resets cursor/scroll/selection and flickers), diff the
   * top-level blocks by content/UniqueID, and replace only the changed span in
   * ONE history-free transaction, mapping the user's selection through it.
   *
   * Focused-block protection: when the user's cursor sits INSIDE the changed
   * span and the editor has focus, their in-progress block is kept verbatim
   * (the AI never clobbers the block you're typing in); everything around it
   * still updates.
   *
   * Returns false when the change can't be applied surgically (schema mismatch,
   * unexpected shape) — the caller falls back to a full setContent.
   */
  private _applyExternalDoc(newDocJson: { type: string; content?: unknown[] }): boolean {
    const editor = this._editor;
    if (!editor) return false;
    try {
      const view = editor.view;
      const state = view.state;
      const oldChildren = ((state.doc.toJSON() as { content?: unknown[] }).content ?? []);
      const newChildren = (newDocJson.content ?? []);
      if (newChildren.length === 0) return false; // empty doc → let setContent normalize

      const diff = diffTopLevel(oldChildren, newChildren);
      if (!diff) return true; // identical — nothing to apply

      const schema = state.schema;
      const buildNodes = (jsons: readonly unknown[]) => jsons.map((j) => schema.nodeFromJSON(j));

      // Block-index → doc-position helper (top-level children start at 0).
      const posOf = (index: number): number => {
        let pos = 0;
        for (let i = 0; i < index; i++) pos += state.doc.child(i).nodeSize;
        return pos;
      };

      // Focused-block protection — only when the user is actually in the span.
      const sel = state.selection;
      const cursorBlock = sel.$from.depth > 0 ? sel.$from.index(0) : -1;
      const userInSpan = view.hasFocus() && cursorBlock >= diff.start && cursorBlock < diff.oldEnd;

      const tr = state.tr;
      if (userInSpan) {
        const curId = (state.doc.child(cursorBlock).attrs as { id?: string } | null)?.id;
        // Locate the user's block in the incoming span by its stable id.
        let ni = -1;
        if (typeof curId === 'string' && curId) {
          for (let i = diff.start; i < diff.newEnd; i++) {
            const attrs = (newChildren[i] as { attrs?: { id?: string } })?.attrs;
            if (attrs?.id === curId) { ni = i; break; }
          }
        }
        // Keep the user's block verbatim; update everything around it. Apply
        // the LATER range first so the earlier range's positions stay valid.
        const before = buildNodes(newChildren.slice(diff.start, ni >= 0 ? ni : diff.newEnd));
        const after = ni >= 0 ? buildNodes(newChildren.slice(ni + 1, diff.newEnd)) : [];
        const pStart = posOf(diff.start);
        const pCur = posOf(cursorBlock);
        const pCurEnd = pCur + state.doc.child(cursorBlock).nodeSize;
        const pOldEnd = posOf(diff.oldEnd);
        if (pCurEnd < pOldEnd || after.length > 0) tr.replaceWith(pCurEnd, pOldEnd, after);
        if (pStart < pCur || before.length > 0) tr.replaceWith(pStart, pCur, before);
      } else {
        const { from, to } = computeReplaceRange(state.doc, diff);
        tr.replaceWith(from, to, buildNodes(newChildren.slice(diff.start, diff.newEnd)));
      }
      if (!tr.docChanged) return true;

      tr.setMeta('addToHistory', false);
      tr.setSelection(sel.map(tr.doc, tr.mapping));
      view.dispatch(tr);
      return true;
    } catch (err) {
      // Schema mismatch / unexpected shape — let the caller do a full reload.
      console.warn(`[CanvasEditorPane] Surgical apply failed for "${this._pageId}", falling back to full reload:`, err);
      return false;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Live compose stream (canvas_compose_page types into the open editor)
  // ══════════════════════════════════════════════════════════════════════════

  /** Active compose-stream state; null when no stream is running. */
  private _streamState: {
    session: ComposeStreamSession;
    snapshot: unknown;          // pre-stream doc JSON for revert
    wasEditable: boolean;
  } | null = null;

  /** Enter compose mode: snapshot the doc, lock editing, mark the pane. */
  private _beginAIStream(): boolean {
    const editor = this._editor;
    if (!editor || this._disposed || this._streamState) return false;
    this._streamState = {
      session: new ComposeStreamSession(),
      snapshot: editor.getJSON(),
      wasEditable: editor.isEditable,
    };
    editor.setEditable(false);
    this._editorContainer?.classList.add('canvas-ai-writing');
    return true;
  }

  /**
   * Ingest a model content delta: parse, diff against the previous parse, and
   * replace only the changed block span — completed blocks sit still while the
   * tail visibly grows. Index-based positions stay valid because the editor is
   * read-only during the stream (only these patches mutate the doc).
   */
  private _pushAIStreamDelta(delta: string): void {
    const editor = this._editor;
    const st = this._streamState;
    if (!editor || !st || this._disposed) return;
    const patch = st.session.push(delta);
    if (!patch) return;
    this._suppressUpdate = true;
    try {
      const state = editor.view.state;
      const posOf = (index: number): number => {
        let pos = 0;
        for (let i = 0; i < index; i++) pos += state.doc.child(i).nodeSize;
        return pos;
      };
      const from = posOf(patch.start);
      const to = posOf(Math.min(patch.oldEnd, state.doc.childCount));
      const nodes = patch.blocks.map((j) => state.schema.nodeFromJSON(j));
      const tr = state.tr.replaceWith(from, to, nodes);
      tr.setMeta('addToHistory', false);
      editor.view.dispatch(tr);
      // Keep the growing tail in view so the user watches it type.
      const last = this._editorContainer?.querySelector('.ProseMirror')?.lastElementChild;
      last?.scrollIntoView({ block: 'nearest' });
    } catch (err) {
      // A partial parse the schema rejects — recover with a full set of the
      // session's current children; the next delta resumes surgical patches.
      console.warn(`[CanvasEditorPane] Stream patch failed for "${this._pageId}", resyncing:`, err);
      try { editor.commands.setContent({ type: 'doc', content: [...this._streamState!.session.children] } as never); }
      catch { /* keep streaming; commit still persists the full markdown */ }
    } finally {
      this._suppressUpdate = false;
    }
  }

  /** Leave compose mode. Commit persists via the standard revision-checked save
   *  path; revert restores the pre-stream snapshot. */
  private async _endAIStream(commit: boolean): Promise<boolean> {
    const st = this._streamState;
    if (!st) return false;
    this._streamState = null;
    const editor = this._editor;
    this._editorContainer?.classList.remove('canvas-ai-writing');
    if (!editor || this._disposed) return false; // pane died mid-stream — caller persists
    try {
      if (commit) {
        await this._dataService.flushContentSave(this._pageId, editor.getJSON());
        this._pageBlockIds = this._collectPageBlockIds(editor);
      } else {
        this._suppressUpdate = true;
        try { editor.commands.setContent(st.snapshot as never); }
        finally { this._suppressUpdate = false; }
      }
      return true;
    } catch (err) {
      console.error(`[CanvasEditorPane] Stream ${commit ? 'commit' : 'revert'} failed for "${this._pageId}":`, err);
      return false;
    } finally {
      editor.setEditable(st.wasEditable);
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

    // M77 Phase 8.1 — flush any pending debounced save BEFORE we destroy
    // the editor. The debounce timer can hold the user's last keystrokes
    // for up to `_autoSaveMs`; if the pane is disposed (tab closed, app
    // shutdown) inside that window, those bytes are otherwise dropped.
    // Best-effort: a flush failure here can't be surfaced (the pane is
    // going away), but the data service has its own retry queue.
    if (this._pageId && this._dataService.hasPendingSave(this._pageId)) {
      void this._dataService.flushPendingSaves().catch((err) => {
        console.warn(`[CanvasEditorPane] Failed to flush pending saves on dispose for "${this._pageId}":`, err);
      });
    }

    this._blockHandles?.dispose();
    this._blockSelection?.dispose();
    this._blockMarquee?.dispose();
    this._propertyBar?.dispose();

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
