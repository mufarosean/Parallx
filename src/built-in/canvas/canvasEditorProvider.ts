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
import type { IPage } from './canvasTypes.js';
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
import { tiptapJsonToMarkdown } from './markdownExport.js';

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

  // ── Page header elements (Cap 7/8/9) ──
  private _pageHeader: HTMLElement | null = null;
  private _coverEl: HTMLElement | null = null;
  private _coverControls: HTMLElement | null = null;
  private _breadcrumbsEl: HTMLElement | null = null;
  private _iconEl: HTMLElement | null = null;
  private _titleEl: HTMLElement | null = null;
  private _hoverAffordances: HTMLElement | null = null;
  private _pageMenuBtn: HTMLElement | null = null;
  private _pageMenuDropdown: HTMLElement | null = null;
  private _emojiPicker: HTMLElement | null = null;
  private _coverPicker: HTMLElement | null = null;

  // ── Page state ──
  private _currentPage: IPage | null = null;
  private _titleSaveTimer: ReturnType<typeof setTimeout> | null = null;

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

    // ── Load page data for header rendering ──
    try {
      this._currentPage = await this._dataService.getPage(this._pageId) ?? null;
    } catch {
      this._currentPage = null;
    }

    // ── Apply page display settings CSS classes ──
    this._applyPageSettings();

    // ── Cover image (Cap 8) ──
    this._createCover();

    // ── Page header: breadcrumbs, icon, title, hover affordances ──
    this._createPageHeader();

    // ── Page menu button ("⋯") at top-right (uses CSS order: -1 for visual ordering) ──
    this._createPageMenu();

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
            HTMLAttributes: {
              class: 'canvas-link',
            },
          },
          dropcursor: {
            color: 'rgba(45, 170, 219, 0.4)',
            width: 3,
          },
          // underline: enabled by default via StarterKit, no extra config needed
        }),
        Placeholder.configure({
          placeholder: ({ node }: { node: any }) => {
            if (node.type.name === 'heading') {
              return `Heading ${node.attrs.level}`;
            }
            return "Type '/' for commands...";
          },
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

    // Subscribe to page changes for bidirectional sync (Task 7.2)
    this._saveDisposables.push(
      this._dataService.onDidChangePage((event) => {
        if (event.pageId !== this._pageId || !event.page) return;
        this._currentPage = event.page;

        // Update title if changed externally (e.g. sidebar rename)
        if (this._titleEl && event.page.title !== this._titleEl.textContent) {
          this._titleEl.textContent = event.page.title || '';
        }

        // Update icon
        if (this._iconEl) {
          this._iconEl.textContent = event.page.icon || '';
          this._iconEl.style.display = event.page.icon ? '' : 'none';
        }

        // Update cover
        this._refreshCover();

        // Update display settings
        this._applyPageSettings();
      }),
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Page Header — Title, Icon, Breadcrumbs (Cap 7)
  // ══════════════════════════════════════════════════════════════════════════

  private _createPageHeader(): void {
    if (!this._editorContainer) return;

    this._pageHeader = $('div.canvas-page-header');

    // ── Breadcrumbs ──
    this._breadcrumbsEl = $('div.canvas-breadcrumbs');
    this._pageHeader.appendChild(this._breadcrumbsEl);
    this._loadBreadcrumbs();

    // ── Icon (large, clickable) ──
    this._iconEl = $('span.canvas-page-icon');
    this._iconEl.textContent = this._currentPage?.icon || '';
    this._iconEl.style.display = this._currentPage?.icon ? '' : 'none';
    this._iconEl.title = 'Change icon';
    this._iconEl.addEventListener('click', (e) => {
      e.stopPropagation();
      this._showEmojiPicker();
    });
    this._pageHeader.appendChild(this._iconEl);

    // ── Hover affordances (Add icon / Add cover) ──
    this._hoverAffordances = $('div.canvas-page-affordances');

    if (!this._currentPage?.icon) {
      const addIconBtn = $('button.canvas-affordance-btn');
      addIconBtn.dataset.action = 'add-icon';
      addIconBtn.innerHTML = '😀 <span>Add icon</span>';
      addIconBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._showEmojiPicker();
      });
      this._hoverAffordances.appendChild(addIconBtn);
    }

    if (!this._currentPage?.coverUrl) {
      const addCoverBtn = $('button.canvas-affordance-btn');
      addCoverBtn.dataset.action = 'add-cover';
      addCoverBtn.innerHTML = '🖼️ <span>Add cover</span>';
      addCoverBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._showCoverPicker();
      });
      this._hoverAffordances.appendChild(addCoverBtn);
    }

    this._pageHeader.appendChild(this._hoverAffordances);

    // ── Title (contenteditable) ──
    this._titleEl = $('div.canvas-page-title');
    this._titleEl.contentEditable = 'true';
    this._titleEl.spellcheck = false;
    this._titleEl.setAttribute('data-placeholder', 'Untitled');
    this._titleEl.textContent = this._currentPage?.title || '';

    // Title input → debounced save
    this._titleEl.addEventListener('input', () => {
      const newTitle = this._titleEl?.textContent?.trim() || 'Untitled';
      if (this._titleSaveTimer) clearTimeout(this._titleSaveTimer);
      this._titleSaveTimer = setTimeout(() => {
        this._dataService.updatePage(this._pageId, { title: newTitle });
      }, 300);
    });

    // Enter → move focus to editor, prevent newline
    this._titleEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this._editor?.commands.focus('start');
      }
    });

    // Paste → strip to plain text, prevent newlines
    this._titleEl.addEventListener('paste', (e) => {
      e.preventDefault();
      const text = e.clipboardData?.getData('text/plain')?.replace(/[\r\n]+/g, ' ') || '';
      document.execCommand('insertText', false, text);
    });

    this._pageHeader.appendChild(this._titleEl);

    // Insert header BEFORE the TipTap editor element
    this._editorContainer.prepend(this._pageHeader);
  }

  private async _loadBreadcrumbs(): Promise<void> {
    if (!this._breadcrumbsEl || !this._pageId) return;
    try {
      const ancestors = await this._dataService.getAncestors(this._pageId);
      if (ancestors.length === 0) {
        this._breadcrumbsEl.style.display = 'none';
        return;
      }
      this._breadcrumbsEl.style.display = '';
      this._breadcrumbsEl.innerHTML = '';
      for (let i = 0; i < ancestors.length; i++) {
        const crumb = $('span.canvas-breadcrumb');
        crumb.textContent = ancestors[i].icon
          ? `${ancestors[i].icon} ${ancestors[i].title}`
          : ancestors[i].title;
        crumb.addEventListener('click', () => {
          // Navigate to ancestor by dispatching to the editor service
          const input = this._input as any;
          if (input?._api?.editors) {
            input._api.editors.openEditor({
              typeId: 'canvas',
              title: ancestors[i].title,
              icon: ancestors[i].icon ?? '📄',
              instanceId: ancestors[i].id,
            });
          }
        });
        this._breadcrumbsEl.appendChild(crumb);
        if (i < ancestors.length - 1) {
          const sep = $('span.canvas-breadcrumb-sep');
          sep.textContent = '›';
          this._breadcrumbsEl.appendChild(sep);
        }
      }
    } catch {
      this._breadcrumbsEl.style.display = 'none';
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Cover Image (Cap 8)
  // ══════════════════════════════════════════════════════════════════════════

  private _createCover(): void {
    if (!this._editorContainer) return;

    this._coverEl = $('div.canvas-page-cover');
    this._coverControls = $('div.canvas-cover-controls');

    const repositionBtn = $('button.canvas-cover-btn');
    repositionBtn.textContent = 'Reposition';
    repositionBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._startCoverReposition();
    });

    const changeBtn = $('button.canvas-cover-btn');
    changeBtn.textContent = 'Change cover';
    changeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._showCoverPicker();
    });

    const removeBtn = $('button.canvas-cover-btn');
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._dataService.updatePage(this._pageId, { coverUrl: null });
    });

    this._coverControls.appendChild(repositionBtn);
    this._coverControls.appendChild(changeBtn);
    this._coverControls.appendChild(removeBtn);
    this._coverEl.appendChild(this._coverControls);

    this._editorContainer.prepend(this._coverEl);
    this._refreshCover();
  }

  private _refreshCover(): void {
    if (!this._coverEl || !this._coverControls) return;
    const url = this._currentPage?.coverUrl;
    if (!url) {
      this._coverEl.style.display = 'none';
      return;
    }
    this._coverEl.style.display = '';
    const yPct = ((this._currentPage?.coverYOffset ?? 0.5) * 100).toFixed(1);

    if (url.startsWith('linear-gradient') || url.startsWith('radial-gradient')) {
      this._coverEl.style.backgroundImage = url;
      this._coverEl.style.backgroundPosition = '';
      this._coverEl.style.backgroundSize = '';
    } else {
      this._coverEl.style.backgroundImage = `url(${url})`;
      this._coverEl.style.backgroundPosition = `center ${yPct}%`;
      this._coverEl.style.backgroundSize = 'cover';
    }

    // Update hover affordances
    this._refreshHoverAffordances();
  }

  private _refreshHoverAffordances(): void {
    if (!this._hoverAffordances) return;
    // Remove existing buttons and rebuild
    this._hoverAffordances.innerHTML = '';

    if (!this._currentPage?.icon) {
      const addIconBtn = $('button.canvas-affordance-btn');
      addIconBtn.dataset.action = 'add-icon';
      addIconBtn.innerHTML = '😀 <span>Add icon</span>';
      addIconBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._showEmojiPicker();
      });
      this._hoverAffordances.appendChild(addIconBtn);
    }

    if (!this._currentPage?.coverUrl) {
      const addCoverBtn = $('button.canvas-affordance-btn');
      addCoverBtn.dataset.action = 'add-cover';
      addCoverBtn.innerHTML = '🖼️ <span>Add cover</span>';
      addCoverBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._showCoverPicker();
      });
      this._hoverAffordances.appendChild(addCoverBtn);
    }
  }

  private _startCoverReposition(): void {
    if (!this._coverEl || !this._currentPage?.coverUrl) return;

    const overlay = $('div.canvas-cover-reposition-overlay');
    overlay.textContent = 'Drag to reposition • Click Done when finished';
    this._coverEl.appendChild(overlay);
    this._coverEl.classList.add('canvas-cover--repositioning');

    let startY = 0;
    let startOffset = this._currentPage?.coverYOffset ?? 0.5;

    const onMouseDown = (e: MouseEvent) => {
      startY = e.clientY;
      startOffset = this._currentPage?.coverYOffset ?? 0.5;
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    };

    const onMouseMove = (e: MouseEvent) => {
      const delta = (startY - e.clientY) / (this._coverEl?.offsetHeight ?? 200);
      const newOffset = Math.max(0, Math.min(1, startOffset + delta));
      const yPct = (newOffset * 100).toFixed(1);
      if (this._coverEl) {
        this._coverEl.style.backgroundPosition = `center ${yPct}%`;
      }
      // Store temporarily
      if (this._currentPage) {
        (this._currentPage as any).coverYOffset = newOffset;
      }
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      const finalOffset = this._currentPage?.coverYOffset ?? 0.5;
      this._dataService.updatePage(this._pageId, { coverYOffset: finalOffset });
    };

    overlay.addEventListener('mousedown', onMouseDown);

    // Done button
    const doneBtn = $('button.canvas-cover-done-btn');
    doneBtn.textContent = 'Done';
    doneBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      overlay.remove();
      doneBtn.remove();
      this._coverEl?.classList.remove('canvas-cover--repositioning');
      const finalOffset = this._currentPage?.coverYOffset ?? 0.5;
      this._dataService.updatePage(this._pageId, { coverYOffset: finalOffset });
    });
    this._coverEl.appendChild(doneBtn);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Cover Picker Popup (Cap 8)
  // ══════════════════════════════════════════════════════════════════════════

  private _showCoverPicker(): void {
    this._dismissPopups();

    this._coverPicker = $('div.canvas-cover-picker');

    // ── Tab bar ──
    const tabs = $('div.canvas-cover-picker-tabs');
    const tabGallery = $('button.canvas-cover-picker-tab.canvas-cover-picker-tab--active');
    tabGallery.textContent = 'Gallery';
    const tabUpload = $('button.canvas-cover-picker-tab');
    tabUpload.textContent = 'Upload';
    const tabLink = $('button.canvas-cover-picker-tab');
    tabLink.textContent = 'Link';
    tabs.appendChild(tabGallery);
    tabs.appendChild(tabUpload);
    tabs.appendChild(tabLink);
    this._coverPicker.appendChild(tabs);

    // ── Content area ──
    const content = $('div.canvas-cover-picker-content');
    this._coverPicker.appendChild(content);

    // Gallery (default view)
    const GRADIENTS = [
      'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
      'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
      'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
      'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
      'linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)',
      'linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)',
      'linear-gradient(135deg, #667eea 0%, #f093fb 100%)',
      'linear-gradient(180deg, #2c3e50 0%, #3498db 100%)',
      'linear-gradient(180deg, #141e30 0%, #243b55 100%)',
      'linear-gradient(135deg, #0c0c0c 0%, #1a1a2e 100%)',
      'linear-gradient(180deg, #232526 0%, #414345 100%)',
    ];

    const renderGallery = () => {
      content.innerHTML = '';
      const grid = $('div.canvas-cover-gallery');
      for (const grad of GRADIENTS) {
        const swatch = $('div.canvas-cover-swatch');
        swatch.style.background = grad;
        swatch.addEventListener('click', () => {
          this._dataService.updatePage(this._pageId, { coverUrl: grad });
          this._dismissPopups();
        });
        grid.appendChild(swatch);
      }
      content.appendChild(grid);
    };

    const renderUpload = () => {
      content.innerHTML = '';
      const uploadBtn = $('button.canvas-cover-upload-btn');
      uploadBtn.textContent = '📁 Choose an image';
      uploadBtn.addEventListener('click', async () => {
        try {
          const electron = (window as any).parallxElectron;
          if (!electron?.showOpenDialog) return;
          const result = await electron.showOpenDialog({
            filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
            properties: ['openFile'],
          });
          if (result?.filePaths?.[0]) {
            const filePath = result.filePaths[0];
            // Read file as base64
            const fileData = await electron.readFileBase64?.(filePath);
            if (fileData) {
              const ext = filePath.split('.').pop()?.toLowerCase() || 'png';
              const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
              const dataUrl = `data:${mime};base64,${fileData}`;
              // Check rough size (2MB limit)
              if (fileData.length > 2 * 1024 * 1024 * 1.37) {
                alert('Image is too large (max 2MB). Please choose a smaller image.');
                return;
              }
              this._dataService.updatePage(this._pageId, { coverUrl: dataUrl });
              this._dismissPopups();
            }
          }
        } catch (err) {
          console.error('[CanvasEditorPane] Cover upload failed:', err);
        }
      });
      content.appendChild(uploadBtn);
      const hint = $('div.canvas-cover-upload-hint');
      hint.textContent = 'Recommended: 1500×600px or wider. Max 2MB.';
      content.appendChild(hint);
    };

    const renderLink = () => {
      content.innerHTML = '';
      const row = $('div.canvas-cover-link-row');
      const input = $('input.canvas-cover-link-input') as HTMLInputElement;
      input.type = 'url';
      input.placeholder = 'Paste image URL…';
      const applyBtn = $('button.canvas-cover-link-apply');
      applyBtn.textContent = 'Apply';
      applyBtn.addEventListener('click', () => {
        const url = input.value.trim();
        if (url) {
          this._dataService.updatePage(this._pageId, { coverUrl: url });
          this._dismissPopups();
        }
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') applyBtn.click();
        if (e.key === 'Escape') this._dismissPopups();
      });
      row.appendChild(input);
      row.appendChild(applyBtn);
      content.appendChild(row);
    };

    renderGallery();

    // Tab switching
    const allTabs = [tabGallery, tabUpload, tabLink];
    const renderers = [renderGallery, renderUpload, renderLink];
    allTabs.forEach((tab, i) => {
      tab.addEventListener('click', () => {
        allTabs.forEach(t => t.classList.remove('canvas-cover-picker-tab--active'));
        tab.classList.add('canvas-cover-picker-tab--active');
        renderers[i]();
      });
    });

    this._container.appendChild(this._coverPicker);

    // Dismiss on click outside
    setTimeout(() => {
      document.addEventListener('mousedown', this._handlePopupOutsideClick);
    }, 0);
    // Dismiss on Escape
    document.addEventListener('keydown', this._handlePopupEscape);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Emoji Picker (Cap 7 — Task 7.4)
  // ══════════════════════════════════════════════════════════════════════════

  private static readonly EMOJI_CATEGORIES: { label: string; emojis: string[] }[] = [
    { label: 'Smileys', emojis: ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩','😘','😗','😚','😙','🥲','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🫡','🤐','🤨','😐','😑','😶','🫥','😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🥵','🥶','🥴','😵','🤯','🤠','🥳','🥸','😎'] },
    { label: 'People', emojis: ['👋','🤚','🖐️','✋','🖖','🫱','🫲','👌','🤌','🤏','✌️','🤞','🫰','🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝️','🫵','👍','👎','✊','👊','🤛','🤜','👏','🙌','🫶','👐','🤲','🤝','🙏','💪','🦾','🦿','🦵','🦶','👂','🦻','👃','🧠','🫀','🫁','🦷','🦴','👀','👁️','👅','👄'] },
    { label: 'Animals', emojis: ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐻‍❄️','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🙈','🙉','🙊','🐒','🐔','🐧','🐦','🐤','🐣','🐥','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🪱','🐛','🦋','🐌','🐞','🐜','🪰','🦟','🦗','🕷️','🦂','🐢','🐍','🦎','🦖','🦕','🐙','🦑'] },
    { label: 'Food', emojis: ['🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍈','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🍆','🥑','🥦','🥬','🥒','🌶️','🫑','🌽','🥕','🫒','🧄','🧅','🥔','🍠','🫘','🥐','🥯','🍞','🥖','🥨','🧀','🥚','🍳','🧈','🥞','🧇','🥓','🥩','🍗','🍖','🌭','🍔','🍟','🍕','🫓','🥪','🥙','🧆'] },
    { label: 'Travel', emojis: ['🚗','🚕','🚙','🚌','🚎','🏎️','🚓','🚑','🚒','🚐','🛻','🚚','🚛','🚜','🏍️','🛵','🚲','🛴','🛹','🛼','🚏','🛣️','🛤️','⛽','🛞','🚨','🚥','🚦','🛑','🚧','⚓','🛟','⛵','🛶','🚤','🛳️','⛴️','🛥️','🚢','✈️','🛩️','🛫','🛬','🪂','💺','🚁','🚟','🚠','🚡','🛰️','🚀','🛸','🌍','🌎','🌏'] },
    { label: 'Objects', emojis: ['💡','🔦','🏮','🪔','📔','📕','📖','📗','📘','📙','📚','📓','📒','📃','📜','📄','📰','🗞️','📑','🔖','🏷️','💰','🪙','💴','💵','💶','💷','💸','💳','🧾','💹','✉️','📧','📨','📩','📤','📥','📦','📫','📪','📬','📭','📮','🗳️','✏️','✒️','🖋️','🖊️','🖌️','🖍️','📝','💼','📁','📂','🗂️','📅','📆'] },
    { label: 'Symbols', emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❤️‍🔥','❤️‍🩹','❣️','💕','💞','💓','💗','💖','💘','💝','⭐','🌟','✨','⚡','🔥','💥','🎯','💎','🔔','🎵','🎶','🔇','🔈','🔉','🔊','📢','📣','💬','💭','🗯️','♠️','♣️','♥️','♦️','🃏','🎴','🀄','🔴','🟠','🟡','🟢','🔵','🟣','⚫','⚪','🟤','✅','❌','⭕','❓','❗','‼️'] },
    { label: 'Flags', emojis: ['🏁','🚩','🎌','🏴','🏳️','🏳️‍🌈','🏳️‍⚧️','🏴‍☠️','🇺🇸','🇬🇧','🇨🇦','🇦🇺','🇩🇪','🇫🇷','🇯🇵','🇰🇷','🇨🇳','🇮🇳','🇧🇷','🇲🇽','🇪🇸','🇮🇹','🇷🇺','🇳🇱','🇸🇪','🇳🇴','🇩🇰','🇫🇮','🇵🇱','🇹🇷','🇿🇦','🇪🇬','🇳🇬','🇰🇪','🇸🇦','🇦🇪','🇮🇱','🇹🇭','🇻🇳','🇮🇩','🇵🇭','🇸🇬','🇲🇾','🇳🇿','🇦🇷','🇨🇴','🇨🇱','🇵🇪'] },
  ];

  private _showEmojiPicker(): void {
    this._dismissPopups();

    this._emojiPicker = $('div.canvas-emoji-picker');

    // Search
    const searchInput = $('input.canvas-emoji-search') as HTMLInputElement;
    searchInput.type = 'text';
    searchInput.placeholder = 'Search emoji…';
    this._emojiPicker.appendChild(searchInput);

    // Remove button (if icon is set)
    if (this._currentPage?.icon) {
      const removeBtn = $('button.canvas-emoji-remove');
      removeBtn.textContent = '✕ Remove icon';
      removeBtn.addEventListener('click', () => {
        this._dataService.updatePage(this._pageId, { icon: null as any });
        this._dismissPopups();
      });
      this._emojiPicker.appendChild(removeBtn);
    }

    // Category tabs
    const tabBar = $('div.canvas-emoji-tabs');
    const contentArea = $('div.canvas-emoji-content');

    const cats = CanvasEditorPane.EMOJI_CATEGORIES;
    const categoryLabels = cats.map(c => c.label);

    const renderCategory = (catIndex: number) => {
      contentArea.innerHTML = '';
      const grid = $('div.canvas-emoji-grid');
      for (const emoji of cats[catIndex].emojis) {
        const btn = $('button.canvas-emoji-btn');
        btn.textContent = emoji;
        btn.addEventListener('click', () => {
          this._dataService.updatePage(this._pageId, { icon: emoji });
          this._dismissPopups();
        });
        grid.appendChild(btn);
      }
      contentArea.appendChild(grid);
    };

    const renderSearch = (query: string) => {
      contentArea.innerHTML = '';
      const grid = $('div.canvas-emoji-grid');
      const q = query.toLowerCase();
      let count = 0;
      for (const cat of cats) {
        for (const emoji of cat.emojis) {
          // Simple fuzzy: match category name or emoji itself
          if (cat.label.toLowerCase().includes(q) || count < 80) {
            const btn = $('button.canvas-emoji-btn');
            btn.textContent = emoji;
            btn.addEventListener('click', () => {
              this._dataService.updatePage(this._pageId, { icon: emoji });
              this._dismissPopups();
            });
            grid.appendChild(btn);
            count++;
          }
        }
      }
      contentArea.appendChild(grid);
    };

    categoryLabels.forEach((label, i) => {
      const tab = $('button.canvas-emoji-tab');
      tab.textContent = cats[i].emojis[0]; // First emoji as tab icon
      tab.title = label;
      if (i === 0) tab.classList.add('canvas-emoji-tab--active');
      tab.addEventListener('click', () => {
        tabBar.querySelectorAll('.canvas-emoji-tab').forEach(t => t.classList.remove('canvas-emoji-tab--active'));
        tab.classList.add('canvas-emoji-tab--active');
        searchInput.value = '';
        renderCategory(i);
      });
      tabBar.appendChild(tab);
    });

    this._emojiPicker.appendChild(tabBar);
    this._emojiPicker.appendChild(contentArea);

    // Render first category
    renderCategory(0);

    // Search handler
    searchInput.addEventListener('input', () => {
      const q = searchInput.value.trim();
      if (q.length > 0) {
        renderSearch(q);
      } else {
        // Re-render active category
        const activeIdx = [...tabBar.children].findIndex(t => t.classList.contains('canvas-emoji-tab--active'));
        renderCategory(activeIdx >= 0 ? activeIdx : 0);
      }
    });

    this._container.appendChild(this._emojiPicker);

    // Position near icon
    if (this._iconEl || this._pageHeader) {
      const target = this._iconEl?.style.display !== 'none' ? this._iconEl : this._pageHeader;
      const rect = target?.getBoundingClientRect();
      if (rect) {
        this._emojiPicker.style.left = `${rect.left}px`;
        this._emojiPicker.style.top = `${rect.bottom + 4}px`;
      }
    }

    // Focus search
    setTimeout(() => searchInput.focus(), 50);

    // Dismiss
    setTimeout(() => {
      document.addEventListener('mousedown', this._handlePopupOutsideClick);
    }, 0);
    document.addEventListener('keydown', this._handlePopupEscape);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Page Menu — "⋯" dropdown (Cap 9)
  // ══════════════════════════════════════════════════════════════════════════

  private _createPageMenu(): void {
    if (!this._editorContainer) return;

    this._pageMenuBtn = $('button.canvas-page-menu-btn');
    this._pageMenuBtn.textContent = '⋯';
    this._pageMenuBtn.title = 'Page settings';
    this._pageMenuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this._pageMenuDropdown) {
        this._dismissPopups();
        return;
      }
      this._showPageMenu();
    });
    this._editorContainer.appendChild(this._pageMenuBtn);
  }

  private _showPageMenu(): void {
    this._dismissPopups();

    this._pageMenuDropdown = $('div.canvas-page-menu');
    const page = this._currentPage;

    // ── Font selection ──
    const fontLabel = $('div.canvas-page-menu-label');
    fontLabel.textContent = 'Font';
    this._pageMenuDropdown.appendChild(fontLabel);

    const fonts: { id: 'default' | 'serif' | 'mono'; label: string }[] = [
      { id: 'default', label: 'Default' },
      { id: 'serif', label: 'Serif' },
      { id: 'mono', label: 'Mono' },
    ];

    const fontGroup = $('div.canvas-page-menu-font-group');
    for (const font of fonts) {
      const btn = $('button.canvas-page-menu-font-btn');
      btn.classList.add(`canvas-font-preview-${font.id}`);
      btn.textContent = font.label;
      if (page?.fontFamily === font.id) btn.classList.add('canvas-page-menu-font-btn--active');
      btn.addEventListener('click', () => {
        this._dataService.updatePage(this._pageId, { fontFamily: font.id });
        fontGroup.querySelectorAll('.canvas-page-menu-font-btn').forEach(b => b.classList.remove('canvas-page-menu-font-btn--active'));
        btn.classList.add('canvas-page-menu-font-btn--active');
      });
      fontGroup.appendChild(btn);
    }
    this._pageMenuDropdown.appendChild(fontGroup);

    // ── Toggles ──
    const toggles: { label: string; key: 'fullWidth' | 'smallText' | 'isLocked'; icon: string }[] = [
      { label: 'Full width', key: 'fullWidth', icon: '↔' },
      { label: 'Small text', key: 'smallText', icon: 'Aa' },
      { label: 'Lock page', key: 'isLocked', icon: '🔒' },
    ];

    for (const toggle of toggles) {
      const row = $('div.canvas-page-menu-toggle');
      const label = $('span.canvas-page-menu-toggle-label');
      label.textContent = `${toggle.icon}  ${toggle.label}`;
      const switchEl = $('div.canvas-page-menu-switch');
      const isOn = !!(page as any)?.[toggle.key];
      if (isOn) switchEl.classList.add('canvas-page-menu-switch--on');

      row.appendChild(label);
      row.appendChild(switchEl);
      row.addEventListener('click', () => {
        const current = !!(this._currentPage as any)?.[toggle.key];
        this._dataService.updatePage(this._pageId, { [toggle.key]: !current } as any);
        switchEl.classList.toggle('canvas-page-menu-switch--on');
      });
      this._pageMenuDropdown.appendChild(row);
    }

    // ── Divider ──
    this._pageMenuDropdown.appendChild($('div.canvas-page-menu-divider'));

    // ── Action buttons ──
    const actions: { label: string; action: () => void; danger?: boolean }[] = [
      {
        label: '⭐ Favorite',
        action: () => {
          this._dataService.toggleFavorite(this._pageId);
          this._dismissPopups();
        },
      },
      {
        label: '📋 Duplicate',
        action: async () => {
          try {
            const newPage = await this._dataService.duplicatePage(this._pageId);
            // Open the duplicated page
            const input = this._input as any;
            if (input?._api?.editors) {
              input._api.editors.openEditor({
                typeId: 'canvas',
                title: newPage.title,
                icon: newPage.icon ?? '📄',
                instanceId: newPage.id,
              });
            }
          } catch (err) {
            console.error('[Canvas] Duplicate failed:', err);
          }
          this._dismissPopups();
        },
      },
      {
        label: '📥 Export Markdown',
        action: async () => {
          try {
            await this._exportMarkdown();
          } catch (err) {
            console.error('[Canvas] Export failed:', err);
          }
          this._dismissPopups();
        },
      },
      {
        label: '🗑️ Delete',
        action: () => {
          this._dataService.archivePage(this._pageId);
          this._dismissPopups();
        },
        danger: true,
      },
    ];

    // Update favorite label based on current state
    if (page?.isFavorited) {
      actions[0].label = '⭐ Remove from Favorites';
    }

    for (const act of actions) {
      const btn = $('button.canvas-page-menu-action');
      btn.textContent = act.label;
      if (act.danger) btn.classList.add('canvas-page-menu-action--danger');
      btn.addEventListener('click', act.action);
      this._pageMenuDropdown.appendChild(btn);
    }

    this._container.appendChild(this._pageMenuDropdown);

    // Position below menu button
    if (this._pageMenuBtn) {
      const rect = this._pageMenuBtn.getBoundingClientRect();
      this._pageMenuDropdown.style.top = `${rect.bottom + 4}px`;
      this._pageMenuDropdown.style.right = `${window.innerWidth - rect.right}px`;
    }

    setTimeout(() => {
      document.addEventListener('mousedown', this._handlePopupOutsideClick);
    }, 0);
    document.addEventListener('keydown', this._handlePopupEscape);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Page Display Settings (Cap 9)
  // ══════════════════════════════════════════════════════════════════════════

  private _applyPageSettings(): void {
    if (!this._editorContainer) return;
    const page = this._currentPage;

    // Font family
    this._editorContainer.classList.remove('canvas-font-default', 'canvas-font-serif', 'canvas-font-mono');
    this._editorContainer.classList.add(`canvas-font-${page?.fontFamily || 'default'}`);

    // Full width
    this._editorContainer.classList.toggle('canvas-full-width', !!page?.fullWidth);

    // Small text
    this._editorContainer.classList.toggle('canvas-small-text', !!page?.smallText);

    // Lock page
    if (this._editor) {
      this._editor.setEditable(!page?.isLocked);
    }
    if (this._titleEl) {
      this._titleEl.contentEditable = page?.isLocked ? 'false' : 'true';
    }
    this._editorContainer.classList.toggle('canvas-locked', !!page?.isLocked);

    // Cover presence affects header padding
    this._editorContainer.classList.toggle('canvas-has-cover', !!page?.coverUrl);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Markdown Export (Cap 10 — Task 10.6)
  // ══════════════════════════════════════════════════════════════════════════

  private async _exportMarkdown(): Promise<void> {
    if (!this._editor || !this._currentPage) return;

    const doc = this._editor.getJSON();
    const title = this._currentPage.title || 'Untitled';
    const markdown = tiptapJsonToMarkdown(doc, title);

    // Sanitize filename
    const safeName = title.replace(/[<>:"/\\|?*]/g, '_').substring(0, 100).trim() || 'Untitled';

    const electron = (window as any).parallxElectron;
    if (!electron?.dialog?.saveFile || !electron?.fs?.writeFile) {
      console.error('[Canvas] Electron file dialog not available');
      return;
    }

    const filePath = await electron.dialog.saveFile({
      filters: [{ name: 'Markdown', extensions: ['md'] }],
      defaultName: `${safeName}.md`,
    });

    if (!filePath) return; // User cancelled

    await electron.fs.writeFile(filePath, markdown, 'utf-8');
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Popup dismiss helpers
  // ══════════════════════════════════════════════════════════════════════════

  private _dismissPopups(): void {
    if (this._emojiPicker) {
      this._emojiPicker.remove();
      this._emojiPicker = null;
    }
    if (this._coverPicker) {
      this._coverPicker.remove();
      this._coverPicker = null;
    }
    if (this._pageMenuDropdown) {
      this._pageMenuDropdown.remove();
      this._pageMenuDropdown = null;
    }
    document.removeEventListener('mousedown', this._handlePopupOutsideClick);
    document.removeEventListener('keydown', this._handlePopupEscape);
  }

  private readonly _handlePopupOutsideClick = (e: MouseEvent): void => {
    const target = e.target as HTMLElement;
    if (
      this._emojiPicker?.contains(target) ||
      this._coverPicker?.contains(target) ||
      this._pageMenuDropdown?.contains(target) ||
      this._pageMenuBtn?.contains(target)
    ) return;
    this._dismissPopups();
  };

  private readonly _handlePopupEscape = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      this._dismissPopups();
    }
  };

  // ══════════════════════════════════════════════════════════════════════════
  // Content Loading
  // ══════════════════════════════════════════════════════════════════════════

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
    this._dismissPopups();

    // Cancel pending title save
    if (this._titleSaveTimer) clearTimeout(this._titleSaveTimer);

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

    this._pageHeader = null;
    this._coverEl = null;
    this._coverControls = null;
    this._breadcrumbsEl = null;
    this._iconEl = null;
    this._titleEl = null;
    this._hoverAffordances = null;
    this._pageMenuBtn = null;
    this._currentPage = null;
  }
}
