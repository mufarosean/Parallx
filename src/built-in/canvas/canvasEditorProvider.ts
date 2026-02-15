// canvasEditorProvider.ts — Canvas editor pane with Tiptap rich text editor
//
// Provides the editor provider registered via api.editors.registerEditorProvider.
// Each editor pane hosts a Tiptap instance, loads page content from
// CanvasDataService, and auto-saves content changes.

import type { IDisposable } from '../../platform/lifecycle.js';
import type { IEditorInput } from '../../editor/editorInput.js';
import type { CanvasDataService } from './canvasDataService.js';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { $ } from '../../ui/dom.js';

// ─── Slash Command Types ────────────────────────────────────────────────────

interface SlashMenuItem {
  label: string;
  icon: string;
  description: string;
  action: (editor: Editor) => void;
}

const SLASH_MENU_ITEMS: SlashMenuItem[] = [
  {
    label: 'Heading 1', icon: 'H1', description: 'Large heading',
    action: (e) => e.chain().focus().toggleHeading({ level: 1 }).run(),
  },
  {
    label: 'Heading 2', icon: 'H2', description: 'Medium heading',
    action: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    label: 'Heading 3', icon: 'H3', description: 'Small heading',
    action: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(),
  },
  {
    label: 'Bullet List', icon: '•', description: 'Unordered list',
    action: (e) => e.chain().focus().toggleBulletList().run(),
  },
  {
    label: 'Numbered List', icon: '1.', description: 'Ordered list',
    action: (e) => e.chain().focus().toggleOrderedList().run(),
  },
  {
    label: 'To-Do List', icon: '☐', description: 'Task list with checkboxes',
    action: (e) => e.chain().focus().toggleTaskList().run(),
  },
  {
    label: 'Quote', icon: '❝', description: 'Block quote',
    action: (e) => e.chain().focus().toggleBlockquote().run(),
  },
  {
    label: 'Code Block', icon: '{ }', description: 'Code with syntax highlighting',
    action: (e) => e.chain().focus().toggleCodeBlock().run(),
  },
  {
    label: 'Divider', icon: '—', description: 'Horizontal rule',
    action: (e) => e.chain().focus().setHorizontalRule().run(),
  },
];

// ─── Canvas Editor Provider ─────────────────────────────────────────────────

export class CanvasEditorProvider {
  constructor(private readonly _dataService: CanvasDataService) {}

  /**
   * Create an editor pane for a Canvas page.
   *
   * @param container — DOM element to render into
   * @param input — the ToolEditorInput (input.id === pageId)
   */
  createEditorPane(container: HTMLElement, input?: IEditorInput): IDisposable {
    const pageId = input?.id ?? '';
    const pane = new CanvasEditorPane(container, pageId, this._dataService, input);
    pane.init();
    return pane;
  }
}

// ─── Canvas Editor Pane ─────────────────────────────────────────────────────

class CanvasEditorPane implements IDisposable {
  private _editor: Editor | null = null;
  private _editorContainer: HTMLElement | null = null;
  private _slashMenu: HTMLElement | null = null;
  private _slashMenuVisible = false;
  private _slashFilterText = '';
  private _slashSelectedIndex = 0;
  private _disposed = false;
  private _suppressUpdate = false;
  private readonly _saveDisposables: IDisposable[] = [];

  constructor(
    private readonly _container: HTMLElement,
    private readonly _pageId: string,
    private readonly _dataService: CanvasDataService,
    private readonly _input: IEditorInput | undefined,
  ) {}

  async init(): Promise<void> {
    // Create editor wrapper
    this._editorContainer = $('div.canvas-editor-wrapper');
    this._container.appendChild(this._editorContainer);

    // Create Tiptap editor
    this._editor = new Editor({
      element: this._editorContainer,
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3] },
        }),
        Placeholder.configure({
          placeholder: "Type '/' for commands...",
        }),
        TaskList,
        TaskItem.configure({
          nested: true,
        }),
      ],
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

        // Mark input dirty while save is pending
        this._markDirty(true);

        // Check for slash command trigger
        this._checkSlashTrigger(editor);
      },
    });

    // Load content
    await this._loadContent();

    // Create slash menu (hidden by default)
    this._createSlashMenu();

    // Subscribe to save completion to clear dirty state (Task 6.1)
    this._saveDisposables.push(
      this._dataService.onDidSavePage((savedPageId) => {
        if (savedPageId === this._pageId) {
          this._markDirty(false);
        }
      }),
    );
  }

  private async _loadContent(): Promise<void> {
    if (!this._editor || !this._pageId) return;

    try {
      const page = await this._dataService.getPage(this._pageId);
      if (page && page.content) {
        this._suppressUpdate = true;
        try {
          const parsed = JSON.parse(page.content);
          this._editor.commands.setContent(parsed);
        } catch {
          // Content is not valid JSON — set as empty
          this._editor.commands.setContent('');
        }
        this._suppressUpdate = false;
      }
    } catch (err) {
      console.error(`[CanvasEditorPane] Failed to load page "${this._pageId}":`, err);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Dirty State (Task 6.1)
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Set the dirty state on the editor input.
   * ToolEditorInput.setDirty is public; we call it via runtime check
   * to avoid importing the concrete class.
   */
  private _markDirty(dirty: boolean): void {
    const input = this._input as any;
    if (input && typeof input.setDirty === 'function') {
      input.setDirty(dirty);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Slash Command Menu (Task 5.4)
  // ══════════════════════════════════════════════════════════════════════════

  private _createSlashMenu(): void {
    this._slashMenu = $('div.canvas-slash-menu');
    this._slashMenu.style.display = 'none';
    this._container.appendChild(this._slashMenu);
  }

  private _checkSlashTrigger(editor: Editor): void {
    const { state } = editor;
    const { $from } = state.selection;

    // Only trigger at the start of an empty or text-only paragraph
    if (!$from.parent.isTextblock) {
      this._hideSlashMenu();
      return;
    }

    const text = $from.parent.textContent;

    // Look for '/' at the start of the line
    if (text.startsWith('/')) {
      this._slashFilterText = text.slice(1).toLowerCase();
      this._showSlashMenu(editor);
    } else {
      this._hideSlashMenu();
    }
  }

  private _showSlashMenu(editor: Editor): void {
    if (!this._slashMenu) return;

    const filtered = this._getFilteredItems();
    if (filtered.length === 0) {
      this._hideSlashMenu();
      return;
    }

    this._slashSelectedIndex = 0;
    this._slashMenuVisible = true;
    this._renderSlashMenuItems(filtered, editor);

    // Position below cursor
    const coords = editor.view.coordsAtPos(editor.state.selection.from);
    this._slashMenu.style.display = 'block';
    this._slashMenu.style.left = `${coords.left}px`;
    this._slashMenu.style.top = `${coords.bottom + 4}px`;

    // Keyboard handler for menu
    if (!this._slashMenu.dataset.listening) {
      this._slashMenu.dataset.listening = '1';
      editor.view.dom.addEventListener('keydown', this._handleSlashKeydown);
    }
  }

  private _hideSlashMenu(): void {
    if (!this._slashMenu || !this._slashMenuVisible) return;
    this._slashMenu.style.display = 'none';
    this._slashMenuVisible = false;
    this._slashFilterText = '';
    if (this._editor) {
      this._editor.view.dom.removeEventListener('keydown', this._handleSlashKeydown);
      delete this._slashMenu.dataset.listening;
    }
  }

  private _getFilteredItems(): SlashMenuItem[] {
    if (!this._slashFilterText) return SLASH_MENU_ITEMS;
    return SLASH_MENU_ITEMS.filter(
      item =>
        item.label.toLowerCase().includes(this._slashFilterText) ||
        item.description.toLowerCase().includes(this._slashFilterText),
    );
  }

  private _renderSlashMenuItems(items: SlashMenuItem[], editor: Editor): void {
    if (!this._slashMenu) return;
    this._slashMenu.innerHTML = '';

    items.forEach((item, index) => {
      const row = $('div.canvas-slash-item');
      if (index === this._slashSelectedIndex) {
        row.classList.add('canvas-slash-item--selected');
      }

      const iconEl = $('span.canvas-slash-icon');
      iconEl.textContent = item.icon;
      row.appendChild(iconEl);

      const textEl = $('div.canvas-slash-text');
      const labelEl = $('div.canvas-slash-label');
      labelEl.textContent = item.label;
      const descEl = $('div.canvas-slash-desc');
      descEl.textContent = item.description;
      textEl.appendChild(labelEl);
      textEl.appendChild(descEl);
      row.appendChild(textEl);

      row.addEventListener('mousedown', (e) => {
        e.preventDefault();
        this._executeSlashItem(item, editor);
      });

      row.addEventListener('mouseenter', () => {
        this._slashSelectedIndex = index;
        this._renderSlashMenuItems(items, editor);
      });

      this._slashMenu!.appendChild(row);
    });
  }

  private readonly _handleSlashKeydown = (e: KeyboardEvent): void => {
    if (!this._slashMenuVisible || !this._editor) return;

    const filtered = this._getFilteredItems();
    if (filtered.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this._slashSelectedIndex = (this._slashSelectedIndex + 1) % filtered.length;
      this._renderSlashMenuItems(filtered, this._editor);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this._slashSelectedIndex = (this._slashSelectedIndex - 1 + filtered.length) % filtered.length;
      this._renderSlashMenuItems(filtered, this._editor);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      this._executeSlashItem(filtered[this._slashSelectedIndex], this._editor);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this._hideSlashMenu();
    }
  };

  private _executeSlashItem(item: SlashMenuItem, editor: Editor): void {
    // Delete the '/' and filter text first
    const { state } = editor;
    const { $from } = state.selection;
    const lineStart = $from.start();
    const lineEnd = $from.pos;

    editor.chain()
      .focus()
      .deleteRange({ from: lineStart, to: lineEnd })
      .run();

    // Execute the slash command action
    item.action(editor);
    this._hideSlashMenu();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Dispose
  // ══════════════════════════════════════════════════════════════════════════

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;

    this._hideSlashMenu();

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
      this._slashMenu.remove();
      this._slashMenu = null;
    }
  }
}
