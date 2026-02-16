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

import type { IDisposable } from '../../platform/lifecycle.js';
import type { IEditorInput } from '../../editor/editorInput.js';
import type { CanvasDataService } from './canvasDataService.js';
import { Editor, Node, mergeAttributes } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
// Link and Underline are included in StarterKit v3 — configure via StarterKit options
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import Image from '@tiptap/extension-image';
import GlobalDragHandle from 'tiptap-extension-global-drag-handle';
// Tier 2 extensions
import { Details, DetailsSummary, DetailsContent } from '@tiptap/extension-details';
import { TableKit } from '@tiptap/extension-table';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import CharacterCount from '@tiptap/extension-character-count';
import AutoJoiner from 'tiptap-extension-auto-joiner';
import { common, createLowlight } from 'lowlight';
import { $ } from '../../ui/dom.js';

// ─── TipTap Command Augmentation ────────────────────────────────────────────
declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: {
      setCallout: (attrs?: { emoji?: string }) => ReturnType;
      toggleCallout: (attrs?: { emoji?: string }) => ReturnType;
      unsetCallout: () => ReturnType;
    };
  }
}

// Create lowlight instance with common language set (JS, TS, CSS, HTML, Python, etc.)
const lowlight = createLowlight(common);

// ─── Custom Callout Node ────────────────────────────────────────────────────
// Notion-style callout: a colored info box with an emoji icon and rich content.
// Rendered as <div data-type="callout"> with a non-editable emoji and editable content area.

const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      emoji: {
        default: '💡',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-emoji') || '💡',
        renderHTML: (attributes: Record<string, any>) => ({ 'data-emoji': attributes.emoji }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="callout"]' }];
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, any> }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'callout',
        class: 'canvas-callout',
      }),
      [
        'span',
        {
          class: 'canvas-callout-emoji',
          contenteditable: 'false',
          'data-emoji': HTMLAttributes['data-emoji'] || '💡',
        },
        HTMLAttributes['data-emoji'] || '💡',
      ],
      ['div', { class: 'canvas-callout-content' }, 0],
    ];
  },

  addCommands() {
    return {
      setCallout:
        (attrs?: { emoji?: string }) =>
        ({ commands }: any) =>
          commands.wrapIn(this.name, attrs),
      toggleCallout:
        (attrs?: { emoji?: string }) =>
        ({ commands }: any) =>
          commands.toggleWrap(this.name, attrs),
      unsetCallout:
        () =>
        ({ commands }: any) =>
          commands.lift(this.name),
    };
  },
});

// ─── Slash Command Types ────────────────────────────────────────────────────

interface SlashMenuItem {
  label: string;
  icon: string;
  description: string;
  action: (editor: Editor) => void;
}

const SLASH_MENU_ITEMS: SlashMenuItem[] = [
  // ── Basic blocks ──
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
  // ── Lists ──
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
  // ── Rich blocks ──
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
  {
    label: 'Callout', icon: '💡', description: 'Highlighted info box',
    action: (e) => (e.commands as any).toggleCallout({ emoji: '💡' }),
  },
  {
    label: 'Toggle List', icon: '▶', description: 'Collapsible content',
    action: (e) => e.chain().focus().setDetails().run(),
  },
  {
    label: 'Table', icon: '▦', description: 'Insert a table',
    action: (e) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  // ── Media ──
  {
    label: 'Image', icon: '🖼', description: 'Embed an image from URL',
    action: (e) => {
      const url = prompt('Enter image URL:');
      if (url) e.chain().focus().setImage({ src: url }).run();
    },
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
  private _bubbleMenu: HTMLElement | null = null;
  private _linkInput: HTMLElement | null = null;
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

    // Create Tiptap editor with Notion-parity extensions
    // Link and Underline are part of StarterKit v3 — configure via StarterKit options
    this._editor = new Editor({
      element: this._editorContainer,
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3] },
          codeBlock: false,  // Replaced by CodeBlockLowlight
          link: {
            openOnClick: false,
            HTMLAttributes: { class: 'canvas-link' },
          },
          // underline: enabled by default via StarterKit, no extra config needed
        }),
        Placeholder.configure({
          placeholder: "Type '/' for commands...",
          includeChildren: true,  // Show placeholders inside Details summary
        }),
        TaskList,
        TaskItem.configure({
          nested: true,
        }),
        TextStyle,
        Color,
        Highlight.configure({
          multicolor: true,
        }),
        Image.configure({
          inline: false,
          allowBase64: true,
        }),
        GlobalDragHandle.configure({
          dragHandleWidth: 24,
          scrollTreshold: 100,
        }),
        // ── Tier 2 extensions ──
        Callout,
        Details.configure({
          persist: true,
          HTMLAttributes: { class: 'canvas-details' },
        }),
        DetailsSummary,
        DetailsContent,
        TableKit.configure({
          table: {
            resizable: true,
            HTMLAttributes: { class: 'canvas-table' },
          },
        }),
        CodeBlockLowlight.configure({
          lowlight,
          defaultLanguage: 'plaintext',
          HTMLAttributes: { class: 'canvas-code-block' },
        }),
        CharacterCount,
        AutoJoiner,
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
      onSelectionUpdate: ({ editor }) => {
        this._updateBubbleMenu(editor);
      },
      onBlur: () => {
        // Small delay so clicking bubble menu buttons doesn't dismiss it
        setTimeout(() => {
          if (!this._bubbleMenu?.contains(document.activeElement)) {
            this._hideBubbleMenu();
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

    // Create slash menu (hidden by default)
    this._createSlashMenu();

    // Create bubble menu (hidden by default)
    this._createBubbleMenu();

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
  // Floating Bubble Menu (formatting toolbar on text selection)
  // ══════════════════════════════════════════════════════════════════════════

  private _createBubbleMenu(): void {
    this._bubbleMenu = $('div.canvas-bubble-menu');
    this._bubbleMenu.style.display = 'none';

    // ── Formatting buttons ──
    const buttons: { label: string; title: string; command: (e: Editor) => void; active: (e: Editor) => boolean }[] = [
      {
        label: '<b>B</b>', title: 'Bold (Ctrl+B)',
        command: (e) => e.chain().focus().toggleBold().run(),
        active: (e) => e.isActive('bold'),
      },
      {
        label: '<i>I</i>', title: 'Italic (Ctrl+I)',
        command: (e) => e.chain().focus().toggleItalic().run(),
        active: (e) => e.isActive('italic'),
      },
      {
        label: '<u>U</u>', title: 'Underline (Ctrl+U)',
        command: (e) => e.chain().focus().toggleUnderline().run(),
        active: (e) => e.isActive('underline'),
      },
      {
        label: '<s>S</s>', title: 'Strikethrough',
        command: (e) => e.chain().focus().toggleStrike().run(),
        active: (e) => e.isActive('strike'),
      },
      {
        label: '<code>&lt;/&gt;</code>', title: 'Inline code',
        command: (e) => e.chain().focus().toggleCode().run(),
        active: (e) => e.isActive('code'),
      },
      {
        label: '🔗', title: 'Link',
        command: () => this._toggleLinkInput(),
        active: (e) => e.isActive('link'),
      },
      {
        label: '<span class="canvas-bubble-highlight-icon">H</span>', title: 'Highlight',
        command: (e) => e.chain().focus().toggleHighlight({ color: '#fef08a' }).run(),
        active: (e) => e.isActive('highlight'),
      },
    ];

    for (const btn of buttons) {
      const el = $('button.canvas-bubble-btn');
      el.innerHTML = btn.label;
      el.title = btn.title;
      el.addEventListener('mousedown', (ev) => {
        ev.preventDefault();  // prevent editor blur
        if (this._editor) btn.command(this._editor);
        // Refresh active states
        setTimeout(() => { if (this._editor) this._refreshBubbleActiveStates(); }, 10);
      });
      el.dataset.action = btn.title;
      this._bubbleMenu.appendChild(el);
    }

    // ── Link input row (hidden by default) ──
    this._linkInput = $('div.canvas-bubble-link-input');
    this._linkInput.style.display = 'none';
    const linkField = $('input.canvas-bubble-link-field') as HTMLInputElement;
    linkField.type = 'url';
    linkField.placeholder = 'Paste link…';
    const linkApply = $('button.canvas-bubble-link-apply');
    linkApply.textContent = '✓';
    linkApply.title = 'Apply link';
    const linkRemove = $('button.canvas-bubble-link-remove');
    linkRemove.textContent = '✕';
    linkRemove.title = 'Remove link';

    linkApply.addEventListener('mousedown', (ev) => {
      ev.preventDefault();
      const url = linkField.value.trim();
      if (url && this._editor) {
        this._editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
      }
      this._linkInput!.style.display = 'none';
    });

    linkRemove.addEventListener('mousedown', (ev) => {
      ev.preventDefault();
      if (this._editor) {
        this._editor.chain().focus().extendMarkRange('link').unsetLink().run();
      }
      this._linkInput!.style.display = 'none';
      linkField.value = '';
    });

    linkField.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        linkApply.click();
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        this._linkInput!.style.display = 'none';
      }
    });

    this._linkInput.appendChild(linkField);
    this._linkInput.appendChild(linkApply);
    this._linkInput.appendChild(linkRemove);
    this._bubbleMenu.appendChild(this._linkInput);

    this._container.appendChild(this._bubbleMenu);
  }

  private _toggleLinkInput(): void {
    if (!this._linkInput || !this._editor) return;
    const visible = this._linkInput.style.display !== 'none';
    if (visible) {
      this._linkInput.style.display = 'none';
    } else {
      this._linkInput.style.display = 'flex';
      const field = this._linkInput.querySelector('input') as HTMLInputElement;
      // Pre-fill with existing link href
      const attrs = this._editor.getAttributes('link');
      field.value = attrs.href ?? '';
      field.focus();
      field.select();
    }
  }

  private _updateBubbleMenu(editor: Editor): void {
    if (!this._bubbleMenu) return;

    const { from, to, empty } = editor.state.selection;
    if (empty || from === to) {
      this._hideBubbleMenu();
      return;
    }

    // Don't show for code blocks or node selections
    const { $from } = editor.state.selection;
    if ($from.parent.type.name === 'codeBlock') {
      this._hideBubbleMenu();
      return;
    }

    // Position above selection
    const start = editor.view.coordsAtPos(from);
    const end = editor.view.coordsAtPos(to);
    const midX = (start.left + end.left) / 2;
    const topY = Math.min(start.top, end.top);

    this._bubbleMenu.style.display = 'flex';

    // Wait for layout to get accurate width
    requestAnimationFrame(() => {
      if (!this._bubbleMenu) return;
      const menuWidth = this._bubbleMenu.offsetWidth;
      this._bubbleMenu.style.left = `${Math.max(8, midX - menuWidth / 2)}px`;
      this._bubbleMenu.style.top = `${topY - this._bubbleMenu.offsetHeight - 8}px`;
    });

    this._refreshBubbleActiveStates();
    // Hide link input when selection changes
    if (this._linkInput) this._linkInput.style.display = 'none';
  }

  private _refreshBubbleActiveStates(): void {
    if (!this._bubbleMenu || !this._editor) return;
    const buttons = this._bubbleMenu.querySelectorAll('.canvas-bubble-btn');
    const activeChecks = [
      (e: Editor) => e.isActive('bold'),
      (e: Editor) => e.isActive('italic'),
      (e: Editor) => e.isActive('underline'),
      (e: Editor) => e.isActive('strike'),
      (e: Editor) => e.isActive('code'),
      (e: Editor) => e.isActive('link'),
      (e: Editor) => e.isActive('highlight'),
    ];
    buttons.forEach((btn, i) => {
      if (i < activeChecks.length) {
        btn.classList.toggle('canvas-bubble-btn--active', activeChecks[i](this._editor!));
      }
    });
  }

  private _hideBubbleMenu(): void {
    if (!this._bubbleMenu) return;
    this._bubbleMenu.style.display = 'none';
    if (this._linkInput) this._linkInput.style.display = 'none';
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
        e.stopPropagation();
        this._executeSlashItem(item, editor);
      });

      row.addEventListener('mouseenter', () => {
        this._slashSelectedIndex = index;
        // Update selection highlight without rebuilding DOM
        const rows = this._slashMenu!.querySelectorAll('.canvas-slash-item');
        rows.forEach((r, i) => {
          r.classList.toggle('canvas-slash-item--selected', i === index);
        });
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
    // Suppress onUpdate to prevent _checkSlashTrigger from firing mid-execution
    this._suppressUpdate = true;

    try {
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
    } finally {
      this._suppressUpdate = false;
    }

    // Manually schedule save since onUpdate was suppressed
    const json = JSON.stringify(editor.getJSON());
    this._dataService.scheduleContentSave(this._pageId, json);
    this._markDirty(true);

    this._hideSlashMenu();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Dispose
  // ══════════════════════════════════════════════════════════════════════════

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;

    this._hideSlashMenu();
    this._hideBubbleMenu();

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

    if (this._bubbleMenu) {
      this._bubbleMenu.remove();
      this._bubbleMenu = null;
    }
  }
}
