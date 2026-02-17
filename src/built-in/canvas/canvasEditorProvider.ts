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

import type { IDisposable } from '../../platform/lifecycle.js';
import type { IEditorInput } from '../../editor/editorInput.js';
import type { CanvasDataService } from './canvasDataService.js';
import { Editor } from '@tiptap/core';
import { common, createLowlight } from 'lowlight';
import { $ } from '../../ui/dom.js';
import { createEditorExtensions } from './config/editorExtensions.js';
import { InlineMathEditorController } from './math/inlineMathEditor.js';
import { BubbleMenuController } from './menus/bubbleMenu.js';
import { SlashMenuController } from './menus/slashMenu.js';
import { BlockHandlesController } from './handles/blockHandles.js';
import { BlockSelectionController } from './handles/blockSelection.js';
import { PageChromeController } from './header/pageChrome.js';

// Create lowlight instance with common language set (JS, TS, CSS, HTML, Python, etc.)
const lowlight = createLowlight(common);
// ─── Canvas Editor Provider ─────────────────────────────────────────────────

export type OpenEditorFn = (options: { typeId: string; title: string; icon?: string; instanceId?: string }) => Promise<void>;

export class CanvasEditorProvider {
  private _openEditor: OpenEditorFn | undefined;

  constructor(private readonly _dataService: CanvasDataService) {}

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
    const pane = new CanvasEditorPane(container, pageId, this._dataService, input, this._openEditor);
    pane.init();
    return pane;
  }
}

// ─── Canvas Editor Pane ─────────────────────────────────────────────────────

class CanvasEditorPane implements IDisposable {
  private _editor: Editor | null = null;
  private _editorContainer: HTMLElement | null = null;
  private _slashMenu!: SlashMenuController;
  private _bubbleMenu!: BubbleMenuController;
  private _inlineMath!: InlineMathEditorController;
  private _disposed = false;
  private _suppressUpdate = false;
  private readonly _saveDisposables: IDisposable[] = [];

  // ── Page chrome controller ──
  private _pageChrome!: PageChromeController;

  // ── Block handles controller ──
  private _blockHandles!: BlockHandlesController;

  // ── Block selection controller ──
  private _blockSelection!: BlockSelectionController;

  constructor(
    private readonly _container: HTMLElement,
    private readonly _pageId: string,
    private readonly _dataService: CanvasDataService,
    private readonly _input: IEditorInput | undefined,
    private readonly _openEditor: OpenEditorFn | undefined,
  ) {}

  // ── Public accessors for controller hosts ──
  get editor(): Editor | null { return this._editor; }
  get container(): HTMLElement { return this._container; }
  get editorContainer(): HTMLElement | null { return this._editorContainer; }
  get inlineMath(): InlineMathEditorController { return this._inlineMath; }
  get dataService(): CanvasDataService { return this._dataService; }
  get pageId(): string { return this._pageId; }
  get suppressUpdate(): boolean { return this._suppressUpdate; }
  set suppressUpdate(v: boolean) { this._suppressUpdate = v; }
  get input(): IEditorInput | undefined { return this._input; }
  get openEditor(): OpenEditorFn | undefined { return this._openEditor; }
  get blockSelection(): BlockSelectionController { return this._blockSelection; }

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
    this._pageChrome.createChrome();

    // Create Tiptap editor with Notion-parity extensions
    this._editor = new Editor({
      element: this._editorContainer,
      extensions: createEditorExtensions(lowlight),
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

        // Check for slash command trigger
        this._slashMenu.checkTrigger(editor);
      },
      onSelectionUpdate: ({ editor }) => {
        this._bubbleMenu.update(editor);
      },
      onBlur: () => {
        // Small delay so clicking bubble menu buttons doesn't dismiss it
        setTimeout(() => {
          if (
            !this._bubbleMenu.menu?.contains(document.activeElement) &&
            !this._inlineMath.popup?.contains(document.activeElement)
          ) {
            this._bubbleMenu.hide();
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

    // Expose editor for E2E tests (test mode only)
    if ((window as any).parallxElectron?.testMode) {
      (window as any).__tiptapEditor = this._editor;
    }

    // Create slash menu (hidden by default)
    this._slashMenu = new SlashMenuController(this);
    this._slashMenu.create();

    // Create bubble menu (hidden by default)
    this._bubbleMenu = new BubbleMenuController(this);
    this._bubbleMenu.create();

    // Create inline math editor popup (hidden by default)
    this._inlineMath = new InlineMathEditorController(this);
    this._inlineMath.create();

    // Setup block handles (+ button, drag-handle click menu)
    this._blockHandles = new BlockHandlesController(this);
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
        this._inlineMath.show(pos, node.attrs.latex || '', target as HTMLElement);
      }
    });

    // Subscribe to save completion (Task 6.1)
    this._saveDisposables.push(
      this._dataService.onDidSavePage((savedPageId) => {
        if (savedPageId === this._pageId) {
          // Auto-save completed — no dirty tracking needed for canvas
        }
      }),
    );

    // Subscribe to page changes for bidirectional sync (Task 7.2)
    this._saveDisposables.push(
      this._dataService.onDidChangePage((event) => {
        if (event.pageId !== this._pageId || !event.page) return;
        this._pageChrome.syncPageChange(event.page);
        this._pageChrome.applyPageSettings();
      }),
    );
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
          const parsed = JSON.parse(page.content);
          // Validate that parsed content has a valid TipTap document structure
          if (parsed && parsed.type === 'doc' && Array.isArray(parsed.content)) {
            // Filter out nodes with undefined/missing type (corrupted data)
            parsed.content = parsed.content.filter(
              (node: any) => node && typeof node.type === 'string',
            );
            // Only set content if there are valid nodes remaining
            if (parsed.content.length > 0) {
              this._editor.commands.setContent(parsed);
            }
          } else if (typeof parsed === 'string') {
            // Plain text content — set as paragraph
            this._editor.commands.setContent(`<p>${parsed}</p>`);
          }
          // If parsed is empty or invalid, editor keeps its default empty state
        } catch {
          // Content is not valid JSON or has incompatible nodes — start fresh
          console.warn(`[CanvasEditorPane] Invalid content for page "${this._pageId}", starting fresh`);
          this._editor.commands.clearContent();
        }
        this._suppressUpdate = false;
      }
    } catch (err) {
      console.error(`[CanvasEditorPane] Failed to load page "${this._pageId}":`, err);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════════  // Dispose
  // ══════════════════════════════════════════════════════════════════════════

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;

    this._slashMenu.hide();
    this._bubbleMenu.hide();
    this._blockHandles.hide();
    this._blockSelection.clear();
    this._pageChrome.dismissPopups();

    // Block handles cleanup
    this._blockHandles.dispose();
    this._blockSelection.dispose();

    // Dispose save-state subscriptions
    for (const d of this._saveDisposables) d.dispose();
    this._saveDisposables.length = 0;

    if (this._editor) {
      this._editor.destroy();
      this._editor = null;
    }

    if (this._editorContainer) {
      this._editorContainer.remove();
      this._editorContainer = null;
    }

    if (this._slashMenu) {
      this._slashMenu.dispose();
    }

    if (this._bubbleMenu) {
      this._bubbleMenu.dispose();
    }

    if (this._inlineMath) {
      this._inlineMath.dispose();
    }

    this._pageChrome.dispose();
  }
}
