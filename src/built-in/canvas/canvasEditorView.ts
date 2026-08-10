// canvasEditorView.ts — reusable canvas rich-text editor host.
//
// The editor-hosting CORE of the canvas, extracted into a standalone view that
// can be embedded anywhere (a dashboard notes widget, a side panel, …) and is
// backed by a real canvas page. It wires the SAME TipTap extensions, slash /
// bubble menus, and block handles the canvas pane uses — so an embedded editor
// IS the canvas editor, not a lookalike. Page chrome (title, properties, cover,
// ribbon, sub-page reconciliation) stays in CanvasEditorPane; this is only the
// document surface. Content loads/saves through the canvas data service, and an
// external edit (the full editor, an AI tool) live-reloads here via
// `onRequestContentReload`.

import { Editor } from '@tiptap/core';
import { common, createLowlight } from 'lowlight';
import type { IDisposable } from '../../platform/lifecycle.js';
import { DisposableStore } from '../../platform/lifecycle.js';
import { createEditorExtensions } from './config/tiptapExtensions.js';
import {
  CanvasMenuRegistry,
  type CanvasMenuHost,
  type IBlockActionMenu,
} from './menus/canvasMenuRegistry.js';
import {
  BlockHandlesController,
  BlockSelectionController,
  BlockMarqueeController,
  createBlockSelectionPlugin,
} from './handles/handleRegistry.js';
import type { ICanvasDataService } from './canvasTypes.js';
import type { DatabaseDataService } from './database/databaseDataService.js';
import type { OpenEditorFn } from './canvasEditorProvider.js';

// Shared syntax-highlighting instance (same common language set as the pane).
const lowlight = createLowlight(common);

interface ViewWindow {
  showInformationMessage(message: string, ...actions: { title: string }[]): Promise<{ title: string } | undefined>;
  showWarningMessage(message: string, ...actions: { title: string }[]): Promise<{ title: string } | undefined>;
  showErrorMessage(message: string, ...actions: { title: string }[]): Promise<{ title: string } | undefined>;
}

export interface CanvasEditorViewDeps {
  /** Database engine, for database/property blocks. Optional. */
  readonly databaseService?: DatabaseDataService;
  /** Open another editor (used by page-block / mention navigation). Optional. */
  readonly openEditor?: OpenEditorFn;
  /** Host window for link confirmations / copy toasts. Optional. */
  readonly window?: ViewWindow;
}

/**
 * Embeddable canvas editor for a single page. Implements the menu + handle host
 * contracts so it reuses CanvasMenuRegistry / BlockHandlesController unchanged.
 */
export class CanvasEditorView implements CanvasMenuHost {
  private readonly _container: HTMLElement;
  private _editorContainer: HTMLElement | null = null;
  private _editor: Editor | null = null;
  private _menuRegistry: CanvasMenuRegistry | null = null;
  private _blockActionMenu: IBlockActionMenu | null = null;
  private _blockHandles: BlockHandlesController | null = null;
  private _blockSelection!: BlockSelectionController;
  private _blockMarquee: BlockMarqueeController | null = null;
  private readonly _store = new DisposableStore();

  private _disposed = false;
  private _initialContentLoaded = false;
  private _suppressUpdate = false;

  constructor(
    container: HTMLElement,
    private readonly _pageId: string,
    private readonly _dataService: ICanvasDataService,
    private readonly _deps: CanvasEditorViewDeps = {},
  ) {
    this._container = container;
  }

  // ── Host contract (CanvasMenuHost + Block* hosts) ──
  get editor(): Editor | null { return this._editor; }
  get container(): HTMLElement { return this._container; }
  get editorContainer(): HTMLElement | null { return this._editorContainer; }
  get pageId(): string { return this._pageId; }
  get blockSelection(): BlockSelectionController { return this._blockSelection; }
  get dataService(): ICanvasDataService { return this._dataService; }
  get databaseService(): DatabaseDataService | undefined { return this._deps.databaseService; }
  get openEditor(): OpenEditorFn | undefined { return this._deps.openEditor; }
  get suppressUpdate(): boolean { return this._suppressUpdate; }
  set suppressUpdate(v: boolean) { this._suppressUpdate = v; }

  /** BubbleMenuHost (M98): page identity for selection-action provenance.
   * No synchronous title source here — consumers fall back to a generic label. */
  getPageContext(): { pageId: string; pageTitle: string } {
    return { pageId: this._pageId, pageTitle: '' };
  }

  get showIconPicker(): (opts: {
    anchor: HTMLElement; showSearch?: boolean; showRemove?: boolean; iconSize?: number;
    onSelect: (iconId: string) => void; onRemove?: () => void;
  }) => void {
    return (opts) => this._menuRegistry?.showIconMenu(opts);
  }
  get showCoverPicker(): (opts: {
    editorContainer: HTMLElement | null; coverEl?: HTMLElement | null;
    pageHeader?: HTMLElement | null; onSelectCover: (coverUrl: string) => void;
  }) => void {
    return (opts) => this._menuRegistry?.showCoverMenu(opts);
  }

  requestSave(_reason: string): void {
    if (!this._editor || !this._initialContentLoaded) return;
    this._dataService.scheduleContentSave(this._pageId, JSON.stringify(this._editor.getJSON()));
  }

  async copyLinkToClipboard(href: string): Promise<void> {
    const text = href.trim();
    if (!text) return;
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch { ok = false; }
    await (ok
      ? this._deps.window?.showInformationMessage('Link copied.')
      : this._deps.window?.showWarningMessage('Could not copy link.'));
  }

  async openLinkInExternalBrowser(href: string): Promise<void> {
    const raw = href.trim();
    if (!/^https?:\/\//i.test(raw)) {
      await this._deps.window?.showWarningMessage('Only http:// and https:// links can be opened.');
      return;
    }
    try {
      const shell = (window as { parallxElectron?: { shell?: { openExternal?(u: string): Promise<unknown> } } })
        .parallxElectron?.shell;
      if (shell?.openExternal) { await shell.openExternal(raw); return; }
      window.open(raw, '_blank', 'noopener,noreferrer');
    } catch (err) {
      console.error('[CanvasEditorView] Failed to open external link:', err);
      await this._deps.window?.showErrorMessage('Failed to open link.');
    }
  }

  // ── Lifecycle ──
  async init(): Promise<void> {
    if (this._disposed) return;

    this._editorContainer = document.createElement('div');
    this._editorContainer.className = 'canvas-editor-wrapper';
    this._container.appendChild(this._editorContainer);

    this._editor = new Editor({
      element: this._editorContainer,
      extensions: createEditorExtensions(lowlight, {
        dataService: this._dataService,
        pageId: this._pageId,
        openEditor: this._deps.openEditor,
        showIconPicker: (opts) => this._menuRegistry?.showIconMenu(opts),
      }),
      content: '',
      editorProps: { attributes: { class: 'canvas-tiptap-editor', spellcheck: 'true' } },
      onUpdate: ({ editor }) => {
        if (this._suppressUpdate || !this._initialContentLoaded) return;
        this._dataService.scheduleContentSave(this._pageId, JSON.stringify(editor.getJSON()));
      },
      onTransaction: ({ editor, transaction }) => {
        if (this._suppressUpdate) return;
        this._menuRegistry?.notifyTransaction(editor);
        if (transaction.docChanged) this._blockHandles?.notifyDocChanged();
      },
      onSelectionUpdate: ({ editor }) => {
        this._menuRegistry?.notifySelectionUpdate(editor);
      },
      onBlur: () => {
        setTimeout(() => {
          if (this._disposed || !this._menuRegistry) return;
          if (this._menuRegistry.isInteractionLocked()) return;
          if (!this._menuRegistry.containsFocusedElement()) this._menuRegistry.hideAll();
        }, 150);
      },
    });
    this._editor.registerPlugin(createBlockSelectionPlugin());

    await this._loadContent();
    if (this._disposed) return;

    // Menus + handles — the real canvas controllers, unchanged.
    this._menuRegistry = new CanvasMenuRegistry(() => this._editor);
    this._blockActionMenu = this._menuRegistry.createStandardMenus(this);
    this._blockHandles = new BlockHandlesController(this, this._blockActionMenu);
    this._blockHandles.setup();
    this._blockSelection = new BlockSelectionController(this);
    this._blockSelection.setup();
    this._blockMarquee = new BlockMarqueeController(this);

    // Live-reload when an external writer (the full editor, an AI tool) edits
    // this page — keeps the embed and the full page in sync both ways.
    this._store.add(this._dataService.onRequestContentReload((reloadPageId) => {
      if (reloadPageId !== this._pageId) return;
      void this._loadContent();
    }));
    this._initialContentLoaded = true;
  }

  private async _loadContent(): Promise<void> {
    if (this._disposed || !this._editor) return;
    try {
      const page = await this._dataService.getPage(this._pageId);
      if (this._disposed || !this._editor) return;
      this._suppressUpdate = true;
      try {
        if (page && page.content) {
          const decoded = await this._dataService.decodePageContentForEditor(page);
          if (this._disposed || !this._editor) return;
          this._editor.commands.setContent(decoded.doc);
        }
      } finally {
        this._suppressUpdate = false;
      }
    } catch (err) {
      this._suppressUpdate = false;
      console.warn(`[CanvasEditorView] Failed to load page "${this._pageId}":`, err);
    }
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._store.dispose();
    this._blockMarquee?.dispose();
    this._blockHandles?.dispose();
    this._blockSelection?.dispose();
    this._menuRegistry?.dispose();
    if (this._editor) {
      try { this._dataService.scheduleContentSave(this._pageId, JSON.stringify(this._editor.getJSON())); } catch { /* best-effort flush */ }
      this._editor.destroy();
      this._editor = null;
    }
    this._editorContainer?.remove();
    this._editorContainer = null;
  }
}

export type { IDisposable };
