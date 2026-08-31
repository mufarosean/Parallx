// blockRegistry.ts — Single source of truth for canvas block type metadata
//
// Every consumer that needs to know about block types (menus, handles,
// mutations, plugins, capabilities) reads from this registry instead of
// maintaining its own hardcoded lists.
//
// Adding a new block:
//   1. Write `extensions/myNode.ts` with Node.create({ name, schema, … })
//   2. Add a BlockDefinition here with an `extension` factory.
//   That's it — slash menu, turn-into, placeholder, bubble menu, drag handle,
//   and extension loading all flow from the single registry entry.
//
// See docs/BLOCK_REGISTRY.md for architecture rationale.

// ── Extension imports ───────────────────────────────────────────────────────
// Tiptap packages (non-StarterKit blocks)
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Image from '@tiptap/extension-image';
import { Details, DetailsSummary, DetailsContent } from '@tiptap/extension-details';
import { TableKit } from '@tiptap/extension-table';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { InlineMathNode } from '@aarkue/tiptap-math-extension';
// Custom extensions
import { Callout } from '../extensions/calloutNode.js';
import { Column, ColumnList } from '../extensions/columnNodes.js';
import { MathBlock } from '../extensions/mathBlockNode.js';
import { ToggleHeading, ToggleHeadingText } from '../extensions/toggleHeadingNode.js';
import { Bookmark } from '../extensions/bookmarkNode.js';
import { PageBlock } from '../extensions/pageBlockNode.js';
import { TableOfContents } from '../extensions/tableOfContentsNode.js';
import { Video, Audio, FileAttachment } from '../extensions/mediaNodes.js';
// Types
import type { AnyExtension, Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import type { ICanvasDataService } from '../canvasTypes.js';
import type { OpenEditorFn } from '../canvasEditorProvider.js';

// Popup insertion helpers (block-owned insertion UI)
// These are provided at runtime through InsertActionContext by canvasMenuRegistry.
// blockRegistry does NOT import popup files directly — they are menu-layer children.

// ── EditorExtensionContext ──────────────────────────────────────────────────
// Runtime dependencies passed to extension factories that need configuration.

/** Options shape for the showIconPicker callback threaded to extensions. */
export interface ShowIconPickerOptions {
  readonly anchor: HTMLElement;
  readonly showSearch?: boolean;
  readonly showRemove?: boolean;
  readonly iconSize?: number;
  readonly onSelect: (iconId: string) => void;
  readonly onRemove?: () => void;
}

export interface EditorExtensionContext {
  readonly lowlight?: any;
  readonly dataService?: ICanvasDataService;
  readonly pageId?: string;
  readonly openEditor?: OpenEditorFn;
  readonly showIconPicker?: (options: ShowIconPickerOptions) => void;
  /** Editor routing for linked pages — a card must open a database page in
   *  the database editor and a mindmap page in the mindmap editor. */
  readonly resolveEditorTypeId?: (pageId: string) => string;
}

// ── InsertActionContext ─────────────────────────────────────────────────────
// Runtime dependencies passed to insertAction callbacks at slash-menu
// execution time.  The menu registry constructs this from the editor pane.
//
// Split into two layers:
//   • InsertActionBaseContext — caller-provided fields (page ID, services)
//   • InsertActionContext — full context with popup functions (required)
//
// Callers of executeBlockInsert() provide the *base* context.
// canvasMenuRegistry augments it with popup functions to produce the
// *full* context.  This makes missing popups a compile-time error
// rather than a silent runtime no-op.

export interface InsertActionBaseContext {
  readonly pageId?: string;
  readonly dataService?: ICanvasDataService;
  /** Database engine — used by the /database slash command. */
  readonly databaseService?: import('../database/databaseDataService.js').DatabaseDataService;
  /** Mindmap engine — used by the /mindmap slash command. */
  readonly mindmapService?: import('../mindmap/mindmapDataService.js').MindmapDataService;
  readonly openEditor?: OpenEditorFn;
}

export interface InsertActionContext extends InsertActionBaseContext {
  /** Show the image upload/embed popup (provided by CanvasMenuRegistry). */
  readonly showImageInsertPopup: (editor: Editor, range: { from: number; to: number }) => void;
  /** Show the media upload/embed popup (provided by CanvasMenuRegistry). */
  readonly showMediaInsertPopup: (editor: Editor, range: { from: number; to: number }, kind: 'video' | 'audio' | 'fileAttachment') => void;
  /** Show the bookmark URL input popup (provided by CanvasMenuRegistry). */
  readonly showBookmarkInsertPopup: (editor: Editor, range: { from: number; to: number }) => void;
}

// ── BlockDefinition Interface ───────────────────────────────────────────────

export interface BlockCapabilities {
  /** Can this block live inside a column? */
  readonly allowInColumn: boolean;
  /** Does this block need explicit drag-handle registration? */
  readonly customDragHandle: boolean;
  /** Is this node a page-container (vertical block host)? */
  readonly isPageContainer: boolean;
  /** Should the bubble format toolbar be suppressed inside this block? */
  readonly suppressBubbleMenu: boolean;
}

export interface SlashMenuConfig {
  /** Optional display label override (uses BlockDefinition.label when omitted). */
  readonly label?: string;
  readonly description: string;
  /** Sort order within the slash menu (lower = higher in list). */
  readonly order: number;
  /** Category for grouping in slash menu UI. */
  readonly category: 'basic' | 'list' | 'rich' | 'media' | 'layout' | 'math' | 'advanced';
}

export interface TurnIntoConfig {
  /** Menu sort order. */
  readonly order: number;
  /** Keyboard shortcut hint displayed in the submenu. */
  readonly shortcut?: string;
}

export interface BlockDefinition {
  /** Unique registry key (e.g. 'heading-1', 'columnList-2'). */
  readonly id: string;
  /** ProseMirror node type name — must match the Tiptap extension's name. */
  readonly name: string;
  /** Human-readable label (e.g. 'Bulleted list', 'Heading 1'). */
  readonly label: string;
  /** Icon key consumed by svgIcon(), or a text glyph (e.g. 'H₁'). */
  readonly icon: string;
  /** True when icon is a text glyph rather than an SVG key. */
  readonly iconIsText?: boolean;
  /**
   * True when the user can change this block's icon via the icon picker.
   * Only blocks whose identity is partly expressed by a choosable icon
   * (callout, pageBlock) set this.  All other blocks have fixed icons.
   */
  readonly iconSelectable?: boolean;
  /** Origin of the node type definition. */
  readonly source: 'starterkit' | 'tiptap-package' | 'custom';
  /** Structural classification. */
  readonly kind: 'leaf' | 'container' | 'atom' | 'inline' | 'structural';
  /** Default attrs when this block variant is created. */
  readonly defaultAttrs?: Record<string, any>;
  /** Capabilities — gates which subsystems interact with this block. */
  readonly capabilities: BlockCapabilities;
  /** Slash menu configuration. Omit to exclude from slash menu. */
  readonly slashMenu?: SlashMenuConfig;
  /** Turn-into configuration. Omit to exclude from turn-into menu. */
  readonly turnInto?: TurnIntoConfig;
  /** Default JSON content template for insertion via slash menu. */
  readonly defaultContent?: Record<string, any>;
  /** Placeholder text when block is empty (string or 'special' for complex logic). */
  readonly placeholder?: string;
  /**
   * Lazy factory returning the configured Tiptap extension(s) for this block.
   * Omit for StarterKit blocks (bundled by StarterKit.configure).
   * For multi-variant entries sharing a node type, only the first variant
   * carries the factory — the rest leave it undefined.
   */
  readonly extension?: (context: EditorExtensionContext) => AnyExtension | AnyExtension[];

  /**
   * Custom insertion logic executed when the user picks this block from the
   * slash menu (or any future insertion surface).
   *
   * When present, the menu registry calls this instead of the simple
   * `insertContentAt(range, defaultContent)` fallback.  Blocks that need
   * async operations (page creation), popup UI (image/video/audio/bookmark),
   * or cursor-placement (callout, toggle) define an insertAction.
   *
   * The block registry is the single owner of block insertion semantics —
   * menu files never contain orchestration logic.
   */
  readonly insertAction?: (
    editor: Editor,
    range: { from: number; to: number },
    context: InsertActionContext,
  ) => void | Promise<void>;
}

// ── Default capabilities (DRY helpers) ──────────────────────────────────────

const STD_LEAF: BlockCapabilities = {
  allowInColumn: true,
  customDragHandle: false,
  isPageContainer: false,
  suppressBubbleMenu: false,
};

const CUSTOM_DRAG: BlockCapabilities = {
  allowInColumn: true,
  customDragHandle: true,
  isPageContainer: false,
  suppressBubbleMenu: false,
};

const CONTAINER_CAP: BlockCapabilities = {
  allowInColumn: true,
  customDragHandle: true,
  isPageContainer: false,
  suppressBubbleMenu: false,
};

/** Recursively check whether a node of `type` with matching attr exists anywhere in a doc tree. */
function _docContainsNode(node: any, type: string, attrKey: string, attrValue: string): boolean {
  if (!node || typeof node !== 'object') return false;
  if (node.type === type && node.attrs?.[attrKey] === attrValue) return true;
  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      if (_docContainsNode(child, type, attrKey, attrValue)) return true;
    }
  }
  return false;
}

const PAGE_CONTAINER_CAP: BlockCapabilities = {
  allowInColumn: false,
  customDragHandle: false,
  isPageContainer: true,
  suppressBubbleMenu: false,
};

// ── Insertion helpers (used by insertAction callbacks) ───────────────────────

/** Insert content at a range and place cursor inside a target child node. */
function _insertAndFocusChild(
  editor: Editor,
  range: { from: number; to: number },
  content: Record<string, any>,
  targetNodeName: string,
  cursorOffset: number = 1,
): void {
  editor.chain().insertContentAt(range, content).run();
  const { doc } = editor.state;
  doc.nodesBetween(range.from, doc.content.size, (node, pos) => {
    if (node.type.name === targetNodeName) {
      editor.chain().setTextSelection(pos + cursorOffset).focus().run();
      return false;
    }
    return true;
  });
}

/** Replace a block with a columnList containing N columns. */
function _replaceBlockWithColumns(editor: Editor, range: { from: number; to: number }, columnCount: number): void {
  const { schema } = editor.state;
  const columnType = schema.nodes.column;
  const columnListType = schema.nodes.columnList;
  const paragraphType = schema.nodes.paragraph;

  if (!columnType || !columnListType || !paragraphType || columnCount < 2) {
    return;
  }

  const columns: any[] = [];
  for (let i = 0; i < columnCount; i++) {
    const paragraph = paragraphType.createAndFill();
    if (!paragraph) return;
    columns.push(columnType.create({ width: null }, [paragraph]));
  }

  const columnList = columnListType.create(null, columns);
  const tr = editor.state.tr.replaceWith(range.from, range.to, columnList);
  const selectionPos = Math.min(range.from + 3, tr.doc.content.size);
  tr.setSelection(TextSelection.near(tr.doc.resolve(selectionPos), 1));
  editor.view.dispatch(tr);
  editor.commands.focus();
}

// ── Block Definitions ───────────────────────────────────────────────────────

const definitions: BlockDefinition[] = [

  // ── StarterKit blocks ──

  {
    id: 'paragraph',
    name: 'paragraph',
    label: 'Text',
    icon: 'T',
    iconIsText: true,
    source: 'starterkit',
    kind: 'leaf',
    capabilities: STD_LEAF,
    slashMenu: undefined, // Paragraph is the default — not in slash menu
    turnInto: { order: 0 },
    defaultContent: { type: 'paragraph' },
  },
  {
    id: 'heading-1',
    name: 'heading',
    label: 'Heading 1',
    icon: 'H\u2081',
    iconIsText: true,
    source: 'starterkit',
    kind: 'leaf',
    defaultAttrs: { level: 1 },
    capabilities: STD_LEAF,
    slashMenu: { description: 'Large heading', order: 1, category: 'basic' },
    turnInto: { order: 1, shortcut: '#' },
    defaultContent: { type: 'heading', attrs: { level: 1 } },
    placeholder: 'Heading 1',
  },
  {
    id: 'heading-2',
    name: 'heading',
    label: 'Heading 2',
    icon: 'H\u2082',
    iconIsText: true,
    source: 'starterkit',
    kind: 'leaf',
    defaultAttrs: { level: 2 },
    capabilities: STD_LEAF,
    slashMenu: { description: 'Medium heading', order: 2, category: 'basic' },
    turnInto: { order: 2, shortcut: '##' },
    defaultContent: { type: 'heading', attrs: { level: 2 } },
    placeholder: 'Heading 2',
  },
  {
    id: 'heading-3',
    name: 'heading',
    label: 'Heading 3',
    icon: 'H\u2083',
    iconIsText: true,
    source: 'starterkit',
    kind: 'leaf',
    defaultAttrs: { level: 3 },
    capabilities: STD_LEAF,
    slashMenu: { description: 'Small heading', order: 3, category: 'basic' },
    turnInto: { order: 3, shortcut: '###' },
    defaultContent: { type: 'heading', attrs: { level: 3 } },
    placeholder: 'Heading 3',
  },
  {
    id: 'bulletList',
    name: 'bulletList',
    label: 'Bulleted list',
    icon: 'bullet-list',
    source: 'starterkit',
    kind: 'leaf',
    capabilities: STD_LEAF,
    slashMenu: { label: 'Bullet List', description: 'Unordered list', order: 10, category: 'list' },
    turnInto: { order: 4 },
    defaultContent: {
      type: 'bulletList',
      content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }],
    },
  },
  {
    id: 'orderedList',
    name: 'orderedList',
    label: 'Numbered list',
    icon: 'numbered-list',
    source: 'starterkit',
    kind: 'leaf',
    capabilities: STD_LEAF,
    slashMenu: { label: 'Numbered List', description: 'Ordered list', order: 11, category: 'list' },
    turnInto: { order: 5 },
    defaultContent: {
      type: 'orderedList',
      content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }],
    },
  },
  {
    id: 'blockquote',
    name: 'blockquote',
    label: 'Quote',
    icon: 'quote',
    source: 'starterkit',
    kind: 'container',
    capabilities: { ...STD_LEAF, isPageContainer: true },
    slashMenu: { description: 'Block quote', order: 20, category: 'rich' },
    turnInto: { order: 12 },
    defaultContent: {
      type: 'blockquote',
      content: [{ type: 'paragraph' }],
    },
  },
  {
    id: 'horizontalRule',
    name: 'horizontalRule',
    label: 'Divider',
    icon: 'divider',
    source: 'starterkit',
    kind: 'atom',
    capabilities: CUSTOM_DRAG,
    slashMenu: { description: 'Horizontal rule', order: 22, category: 'rich' },
    turnInto: undefined,
    defaultContent: { type: 'horizontalRule' },
  },

  // ── Tiptap Package blocks ──

  {
    id: 'taskList',
    name: 'taskList',
    label: 'To-do list',
    icon: 'checklist',
    source: 'tiptap-package',
    kind: 'leaf',
    capabilities: STD_LEAF,
    slashMenu: { label: 'To-Do List', description: 'Task list with checkboxes', order: 12, category: 'list' },
    turnInto: { order: 6 },
    defaultContent: {
      type: 'taskList',
      content: [{
        type: 'taskItem',
        attrs: { checked: false },
        content: [{ type: 'paragraph' }],
      }],
    },
    extension: () => [TaskList, TaskItem.configure({ nested: true })],
  },
  {
    id: 'codeBlock',
    name: 'codeBlock',
    label: 'Code',
    icon: 'code',
    source: 'tiptap-package',
    kind: 'leaf',
    capabilities: { ...STD_LEAF, suppressBubbleMenu: true },
    slashMenu: { label: 'Code Block', description: 'Code with syntax highlighting', order: 21, category: 'rich' },
    turnInto: { order: 11 },
    defaultContent: { type: 'codeBlock' },
    extension: (ctx) => CodeBlockLowlight.configure({
      lowlight: ctx.lowlight,
      defaultLanguage: 'plaintext',
      HTMLAttributes: { class: 'canvas-code-block' },
    }),
  },
  {
    id: 'image',
    name: 'image',
    label: 'Image',
    icon: 'image',
    source: 'tiptap-package',
    kind: 'atom',
    capabilities: CUSTOM_DRAG,
    slashMenu: { description: 'Upload or embed an image', order: 30, category: 'media' },
    turnInto: undefined,
    defaultContent: undefined,
    insertAction: (_editor, range, context) => context.showImageInsertPopup(_editor, range),
    extension: () => Image.configure({ inline: false, allowBase64: true }),
  },
  {
    id: 'details',
    name: 'details',
    label: 'Toggle list',
    icon: 'chevron-right',
    source: 'tiptap-package',
    kind: 'container',
    capabilities: CONTAINER_CAP,
    slashMenu: { label: 'Toggle List', description: 'Collapsible content', order: 23, category: 'rich' },
    turnInto: { order: 7 },
    defaultContent: {
      type: 'details',
      content: [
        { type: 'detailsSummary' },
        { type: 'detailsContent', content: [{ type: 'paragraph' }] },
      ],
    },
    insertAction: (editor, range) => {
      _insertAndFocusChild(editor, range, {
        type: 'details',
        content: [
          { type: 'detailsSummary' },
          { type: 'detailsContent', content: [{ type: 'paragraph' }] },
        ],
      }, 'detailsSummary', 1);
    },
    extension: () => Details.configure({ persist: true, HTMLAttributes: { class: 'canvas-details' } }),
  },
  {
    id: 'table',
    name: 'table',
    label: 'Table',
    icon: 'grid',
    source: 'tiptap-package',
    kind: 'leaf',
    capabilities: { ...STD_LEAF, allowInColumn: true },
    slashMenu: { description: 'Insert a table', order: 24, category: 'rich' },
    turnInto: undefined,
    defaultContent: undefined,
    insertAction: (editor, range) => {
      const headerCells = Array.from({ length: 3 }, () => ({
        type: 'tableHeader', content: [{ type: 'paragraph' }],
      }));
      const bodyRow = () => ({
        type: 'tableRow',
        content: Array.from({ length: 3 }, () => ({
          type: 'tableCell', content: [{ type: 'paragraph' }],
        })),
      });
      editor.chain().insertContentAt(range, {
        type: 'table',
        content: [{ type: 'tableRow', content: headerCells }, bodyRow(), bodyRow()],
      }).focus().run();
    },
    extension: () => TableKit.configure({
      table: {
        resizable: true,
        HTMLAttributes: { class: 'canvas-table' },
        // The canvas block model treats a table as ONE unit (drag handle,
        // marquee, block selection all resolve a cursor inside a cell to the
        // table).  prosemirror-tables' default (`false`) actively fights that:
        // its `normalizeSelection` rewrites any NodeSelection on a table into
        // a CellSelection spanning every cell.  Two consequences, both shipped
        // bugs:
        //   • the drag handle's slice became `CellSelection.content()` —
        //     openStart/openEnd = 1 — so columnDropPlugin's closed-slice guard
        //     bailed and ProseMirror's fallback drop ran `tr.deleteSelection()`
        //     on the cell selection: the cells emptied, the TABLE STAYED.
        //     That is the "moving a table leaves an empty husk behind" report.
        //   • Backspace into a table from the block below silently produced an
        //     invisible whole-table cell selection whose next keystroke ate the
        //     table with no select-then-confirm step.
        // Letting a table be node-selected makes PM agree with the canvas.
        allowTableNodeSelection: true,
        // Match the CSS floor (`table td/th { min-width: 80px }`) so the
        // resize handle and the rendered cell agree on the minimum.
        cellMinWidth: 80,
      },
    }),
  },
  {
    id: 'inlineMath',
    name: 'inlineMath',
    label: 'Inline Equation',
    icon: 'math',
    source: 'tiptap-package',
    kind: 'inline',
    capabilities: { ...STD_LEAF, allowInColumn: false },
    slashMenu: { description: 'Inline math within text', order: 41, category: 'math' },
    turnInto: undefined,
    defaultContent: { type: 'inlineMath', attrs: { latex: 'f(x)', display: 'no' } },
    extension: () => InlineMathNode.configure({
      evaluation: false,
      katexOptions: { throwOnError: false },
      delimiters: 'dollar',
    }),
  },

  // ── Custom Extensions ──

  {
    id: 'callout',
    name: 'callout',
    label: 'Callout',
    icon: 'lightbulb',
    iconSelectable: true,
    source: 'custom',
    kind: 'container',
    capabilities: { allowInColumn: true, customDragHandle: true, isPageContainer: true, suppressBubbleMenu: false },
    slashMenu: { description: 'Highlighted info box', order: 25, category: 'rich' },
    turnInto: { order: 13 },
    defaultContent: {
      type: 'callout',
      attrs: { emoji: 'lightbulb' },
      content: [{ type: 'paragraph' }],
    },
    insertAction: (editor, range) => {
      _insertAndFocusChild(editor, range, {
        type: 'callout',
        attrs: { emoji: 'lightbulb' },
        content: [{ type: 'paragraph' }],
      }, 'callout', 2);
    },
    extension: (ctx) => Callout.configure({
      showIconPicker: ctx.showIconPicker,
    }),
  },
  {
    id: 'mathBlock',
    name: 'mathBlock',
    label: 'Block Equation',
    icon: 'math-block',
    source: 'custom',
    kind: 'atom',
    capabilities: CUSTOM_DRAG,
    slashMenu: { description: 'Full-width math equation', order: 40, category: 'math' },
    turnInto: { order: 14 },
    defaultContent: { type: 'mathBlock', attrs: { latex: '' } },
    extension: () => MathBlock,
  },
  {
    id: 'toggleHeading-1',
    name: 'toggleHeading',
    label: 'Toggle Heading 1',
    icon: 'chevron-right',
    source: 'custom',
    kind: 'container',
    defaultAttrs: { level: 1 },
    capabilities: CONTAINER_CAP,
    slashMenu: { description: 'Collapsible large heading', order: 50, category: 'advanced' },
    turnInto: undefined,
    defaultContent: {
      type: 'toggleHeading',
      attrs: { level: 1 },
      content: [
        { type: 'toggleHeadingText' },
        { type: 'detailsContent', content: [{ type: 'paragraph' }] },
      ],
    },
    insertAction: (editor, range) => {
      _insertAndFocusChild(editor, range, {
        type: 'toggleHeading',
        attrs: { level: 1 },
        content: [
          { type: 'toggleHeadingText' },
          { type: 'detailsContent', content: [{ type: 'paragraph' }] },
        ],
      }, 'toggleHeadingText', 1);
    },
    extension: () => [ToggleHeading, ToggleHeadingText],
  },
  {
    id: 'toggleHeading-2',
    name: 'toggleHeading',
    label: 'Toggle Heading 2',
    icon: 'chevron-right',
    source: 'custom',
    kind: 'container',
    defaultAttrs: { level: 2 },
    capabilities: CONTAINER_CAP,
    slashMenu: { description: 'Collapsible medium heading', order: 51, category: 'advanced' },
    turnInto: undefined,
    defaultContent: {
      type: 'toggleHeading',
      attrs: { level: 2 },
      content: [
        { type: 'toggleHeadingText' },
        { type: 'detailsContent', content: [{ type: 'paragraph' }] },
      ],
    },
    insertAction: (editor, range) => {
      _insertAndFocusChild(editor, range, {
        type: 'toggleHeading',
        attrs: { level: 2 },
        content: [
          { type: 'toggleHeadingText' },
          { type: 'detailsContent', content: [{ type: 'paragraph' }] },
        ],
      }, 'toggleHeadingText', 1);
    },
  },
  {
    id: 'toggleHeading-3',
    name: 'toggleHeading',
    label: 'Toggle Heading 3',
    icon: 'chevron-right',
    source: 'custom',
    kind: 'container',
    defaultAttrs: { level: 3 },
    capabilities: CONTAINER_CAP,
    slashMenu: { description: 'Collapsible small heading', order: 52, category: 'advanced' },
    turnInto: undefined,
    defaultContent: {
      type: 'toggleHeading',
      attrs: { level: 3 },
      content: [
        { type: 'toggleHeadingText' },
        { type: 'detailsContent', content: [{ type: 'paragraph' }] },
      ],
    },
    insertAction: (editor, range) => {
      _insertAndFocusChild(editor, range, {
        type: 'toggleHeading',
        attrs: { level: 3 },
        content: [
          { type: 'toggleHeadingText' },
          { type: 'detailsContent', content: [{ type: 'paragraph' }] },
        ],
      }, 'toggleHeadingText', 1);
    },
  },
  {
    id: 'columnList-2',
    name: 'columnList',
    label: '2 Columns',
    icon: 'columns',
    source: 'custom',
    kind: 'structural',
    defaultAttrs: { columns: 2 },
    capabilities: { ...STD_LEAF, allowInColumn: false },
    slashMenu: { description: 'Split into 2 columns', order: 60, category: 'layout' },
    turnInto: { order: 8, },
    defaultContent: undefined,
    insertAction: (editor, range) => _replaceBlockWithColumns(editor, range, 2),
    extension: () => [Column, ColumnList],
  },
  {
    id: 'columnList-3',
    name: 'columnList',
    label: '3 Columns',
    icon: 'columns',
    source: 'custom',
    kind: 'structural',
    defaultAttrs: { columns: 3 },
    capabilities: { ...STD_LEAF, allowInColumn: false },
    slashMenu: { description: 'Split into 3 columns', order: 61, category: 'layout' },
    turnInto: { order: 9, },
    defaultContent: undefined,
    insertAction: (editor, range) => _replaceBlockWithColumns(editor, range, 3),
  },
  {
    id: 'columnList-4',
    name: 'columnList',
    label: '4 Columns',
    icon: 'columns',
    source: 'custom',
    kind: 'structural',
    defaultAttrs: { columns: 4 },
    capabilities: { ...STD_LEAF, allowInColumn: false },
    slashMenu: { description: 'Split into 4 columns', order: 62, category: 'layout' },
    turnInto: { order: 10, },
    defaultContent: undefined,
    insertAction: (editor, range) => _replaceBlockWithColumns(editor, range, 4),
  },
  {
    id: 'bookmark',
    name: 'bookmark',
    label: 'Bookmark',
    icon: 'globe',
    source: 'custom',
    kind: 'atom',
    capabilities: CUSTOM_DRAG,
    slashMenu: { description: 'Link preview card', order: 70, category: 'advanced' },
    turnInto: undefined,
    defaultContent: undefined,
    insertAction: (_editor, range, context) => context.showBookmarkInsertPopup(_editor, range),
    extension: () => Bookmark,
  },
  {
    id: 'pageBlock',
    name: 'pageBlock',
    label: 'Page',
    icon: 'page',
    iconSelectable: true,
    source: 'custom',
    kind: 'atom',
    capabilities: CUSTOM_DRAG,
    slashMenu: { description: 'Create and open a nested sub-page', order: 0, category: 'basic' },
    turnInto: undefined,
    defaultContent: undefined,
    insertAction: async (editor, range, context) => {
      if (!context?.dataService || !context.pageId) return;

      let child: { id: string; title: string; icon: string | null } | null = null;
      try {
        // Cancel any debounced auto-save on the parent BEFORE creating
        // the child row. The slash-menu flow runs as: createPage →
        // editor insertContentAt → flushContentSave. If a debounced
        // save fires between the create and the flush it can persist
        // the parent's pre-block content, leaving the child row in the
        // DB but no pageBlock in the parent's saved content. The
        // atomic helpers do this themselves; this manual path has to
        // do it explicitly.
        context.dataService.cancelPendingSave(context.pageId);

        child = await context.dataService.createPage(context.pageId, 'Untitled');
        const childPage = child;
        const pageBlockAttrs = {
          pageId: childPage.id,
          title: childPage.title,
          icon: childPage.icon,
        };

        let inserted = editor
          .chain()
          .insertContentAt(range, {
            type: 'pageBlock',
            attrs: pageBlockAttrs,
          })
          .focus()
          .run();

        if (!inserted) {
          const pageBlockType = editor.state.schema.nodes.pageBlock;
          if (!pageBlockType) {
            throw new Error('pageBlock schema node is unavailable');
          }
          const node = pageBlockType.create(pageBlockAttrs);
          const tr = editor.state.tr.replaceWith(range.from, range.to, node);
          editor.view.dispatch(tr);
          editor.commands.focus();
          inserted = true;
        }

        if (!inserted) {
          throw new Error('Failed to insert pageBlock');
        }

        const docJson = editor.getJSON();
        if (!_docContainsNode(docJson, 'pageBlock', 'pageId', childPage.id)) {
          throw new Error('Inserted pageBlock not found in parent doc');
        }

        // Flush parent doc content through data service (encodes internally)
        await context.dataService.flushContentSave(context.pageId, docJson);

        if (context.openEditor) {
          await context.openEditor({
            typeId: 'canvas',
            title: childPage.title,
            icon: childPage.icon ?? undefined,
            iconHtml: renderPageIconHtml(childPage.icon),
            instanceId: childPage.id,
          });
        }
      } catch (error) {
        if (child) {
          // Rollback the orphaned database row.
          try {
            await context.dataService.deletePage(child.id);
          } catch {
            // Best-effort rollback only.
          }
          // Also strip the pageBlock node out of the editor's in-memory doc \u2014
          // otherwise the next save would persist a reference to the deleted
          // child page, leaving a permanently-broken card.
          try {
            const { state, view } = editor;
            const tr = state.tr;
            const toRemove: { from: number; to: number }[] = [];
            state.doc.descendants((node: any, pos: number) => {
              if (node.type?.name === 'pageBlock' && node.attrs?.pageId === child!.id) {
                toRemove.push({ from: pos, to: pos + node.nodeSize });
                return false;
              }
              return true;
            });
            // Delete from the end so earlier positions stay valid.
            for (let i = toRemove.length - 1; i >= 0; i--) {
              const r = toRemove[i];
              tr.delete(r.from, r.to);
            }
            if (toRemove.length > 0) view.dispatch(tr);
          } catch {
            // Best-effort cleanup; the throw below still surfaces the failure.
          }
        }
        throw error;
      }
    },
    extension: (ctx) => PageBlock.configure({
      dataService: ctx.dataService,
      currentPageId: ctx.pageId,
      openEditor: ctx.openEditor,
      showIconPicker: ctx.showIconPicker,
      resolveEditorTypeId: ctx.resolveEditorTypeId,
    }),
  },
  {
    // /database — creates a Notion-style DATABASE as a child page and drops its
    // card at the cursor (the card opens the database editor: table/board views,
    // typed columns, rows-as-pages). Reuses the pageBlock node — a database IS a
    // page — so no new node type; `extension` stays undefined (pageBlock's own
    // definition registers the node).
    id: 'database',
    name: 'pageBlock',
    label: 'Database',
    // 'database' is a REGISTERED icon id — the old 'table' wasn't, so the
    // slash menu printed the literal word and turn-into fell back to the
    // page icon.
    icon: 'database',
    source: 'custom',
    kind: 'atom',
    capabilities: CUSTOM_DRAG,
    slashMenu: { description: 'New database with table & board views', order: 1, category: 'basic' },
    turnInto: undefined,
    defaultContent: undefined,
    insertAction: async (editor, range, context) => {
      if (!context?.dataService || !context.databaseService || !context.pageId) return;
      let dbId: string | null = null;
      try {
        // Same manual-flow discipline as /page: the editor doc is the source of
        // truth for the parent's content; the final flush persists it.
        context.dataService.cancelPendingSave(context.pageId);

        // 1. Create the database as a ROOT page (no auto-card — the card goes
        //    at the cursor), then reparent the row only.
        const info = await context.databaseService.createDatabase({ title: 'Untitled database' });
        dbId = info.id;
        await context.dataService.movePage(info.id, context.pageId);

        // 2. Card at the cursor.
        const attrs = { pageId: info.id, title: info.title, icon: info.icon };
        const inserted = editor.chain().insertContentAt(range, { type: 'pageBlock', attrs }).focus().run();
        if (!inserted) {
          const nodeType = editor.state.schema.nodes.pageBlock;
          if (!nodeType) throw new Error('pageBlock schema node is unavailable');
          const tr = editor.state.tr.replaceWith(range.from, range.to, nodeType.create(attrs));
          editor.view.dispatch(tr);
          editor.commands.focus();
        }

        // 3. Persist the parent with the card, then open the database.
        await context.dataService.flushContentSave(context.pageId, editor.getJSON());
        if (context.openEditor) {
          await context.openEditor({
            typeId: 'database',
            title: info.title,
            icon: info.icon ?? undefined,
            instanceId: info.id,
          });
        }
      } catch (error) {
        console.error('[Canvas] /database insert failed:', error);
        if (dbId) {
          try { await context.dataService.deletePage(dbId); } catch { /* best-effort rollback */ }
        }
      }
    },
  },
  {
    // /mindmap — creates a MINDMAP as a child page and drops its card at the
    // cursor (docs/MINDMAP_BRIEF.md: the map is its own editor; the card is a
    // pageBlock because a mindmap IS a page — the same reuse as /database).
    id: 'mindmap',
    name: 'pageBlock',
    label: 'Mindmap',
    icon: 'waypoints',
    source: 'custom',
    kind: 'atom',
    capabilities: CUSTOM_DRAG,
    slashMenu: { description: 'Map ideas visually — AI drafts, you shape', order: 2, category: 'basic' },
    turnInto: undefined,
    defaultContent: undefined,
    insertAction: async (editor, range, context) => {
      if (!context?.dataService || !context.mindmapService || !context.pageId) return;
      let mapId: string | null = null;
      try {
        // Same manual-flow discipline as /database: the editor doc is the
        // source of truth for the parent; the final flush persists it.
        context.dataService.cancelPendingSave(context.pageId);

        const page = await context.mindmapService.createMindmap({ title: 'Untitled Mindmap' });
        mapId = page.id;
        await context.dataService.movePage(page.id, context.pageId);

        const attrs = { pageId: page.id, title: page.title, icon: 'waypoints' };
        const inserted = editor.chain().insertContentAt(range, { type: 'pageBlock', attrs }).focus().run();
        if (!inserted) {
          const nodeType = editor.state.schema.nodes.pageBlock;
          if (!nodeType) throw new Error('pageBlock schema node is unavailable');
          const tr = editor.state.tr.replaceWith(range.from, range.to, nodeType.create(attrs));
          editor.view.dispatch(tr);
          editor.commands.focus();
        }

        await context.dataService.flushContentSave(context.pageId, editor.getJSON());
        if (context.openEditor) {
          await context.openEditor({
            typeId: 'mindmap',
            title: page.title,
            icon: 'waypoints',
            instanceId: page.id,
          });
        }
      } catch (error) {
        console.error('[Canvas] /mindmap insert failed:', error);
        if (mapId) {
          try { await context.dataService.deletePage(mapId); } catch { /* best-effort rollback */ }
        }
      }
    },
  },
  {
    id: 'tableOfContents',
    name: 'tableOfContents',
    label: 'Table of Contents',
    icon: 'toc',
    source: 'custom',
    kind: 'atom',
    capabilities: CUSTOM_DRAG,
    slashMenu: { description: 'Auto-generated from headings', order: 71, category: 'advanced' },
    turnInto: undefined,
    defaultContent: { type: 'tableOfContents' },
    extension: () => TableOfContents,
  },
  {
    id: 'video',
    name: 'video',
    label: 'Video',
    icon: 'video',
    source: 'custom',
    kind: 'atom',
    capabilities: CUSTOM_DRAG,
    slashMenu: { description: 'Embed a video', order: 31, category: 'media' },
    turnInto: undefined,
    defaultContent: undefined,
    insertAction: (_editor, range, context) => context.showMediaInsertPopup(_editor, range, 'video'),
    extension: () => Video,
  },
  {
    id: 'audio',
    name: 'audio',
    label: 'Audio',
    icon: 'audio',
    source: 'custom',
    kind: 'atom',
    capabilities: CUSTOM_DRAG,
    slashMenu: { description: 'Embed audio', order: 32, category: 'media' },
    turnInto: undefined,
    defaultContent: undefined,
    insertAction: (_editor, range, context) => context.showMediaInsertPopup(_editor, range, 'audio'),
    extension: () => Audio,
  },
  {
    id: 'fileAttachment',
    name: 'fileAttachment',
    label: 'File',
    icon: 'file-attachment',
    source: 'custom',
    kind: 'atom',
    capabilities: CUSTOM_DRAG,
    slashMenu: { description: 'Attach a file', order: 33, category: 'media' },
    turnInto: undefined,
    defaultContent: undefined,
    insertAction: (_editor, range, context) => context.showMediaInsertPopup(_editor, range, 'fileAttachment'),
    extension: () => FileAttachment,
  },

  // ── Structural node types (not user-facing, but needed for capabilities) ──

  {
    id: 'column',
    name: 'column',
    label: 'Column',
    icon: '',
    source: 'custom',
    kind: 'structural',
    capabilities: { ...PAGE_CONTAINER_CAP },
  },
  {
    id: 'detailsContent',
    name: 'detailsContent',
    label: 'Details Content',
    icon: '',
    source: 'tiptap-package',
    kind: 'structural',
    capabilities: { ...PAGE_CONTAINER_CAP },
    extension: () => DetailsContent,
  },
  // Note: 'blockquote' is already registered above as a user-facing block
  // with isPageContainer: true. 'callout' also has isPageContainer: true above.

  {
    id: 'detailsSummary',
    name: 'detailsSummary',
    label: 'Toggle Title',
    icon: '',
    source: 'tiptap-package',
    kind: 'structural',
    capabilities: { ...STD_LEAF, allowInColumn: false },
    placeholder: 'Toggle title…',
    extension: () => DetailsSummary,
  },
  {
    id: 'toggleHeadingText',
    name: 'toggleHeadingText',
    label: 'Toggle Heading Text',
    icon: '',
    source: 'custom',
    kind: 'structural',
    capabilities: { ...STD_LEAF, allowInColumn: false },
    placeholder: 'Toggle heading',
  },
];

// ── Build the Registry Map ──────────────────────────────────────────────────

const _registry = new Map<string, BlockDefinition>();
for (const def of definitions) {
  _registry.set(def.id, def);
}

/** All registered block definitions, keyed by unique ID. */
export const BLOCK_REGISTRY: ReadonlyMap<string, BlockDefinition> = _registry;

// ── Derived Constants ───────────────────────────────────────────────────────
// These reproduce the exact same values previously hardcoded in
// blockCapabilities.ts, blockHandles.ts, blockSelection.ts, etc.

/** Node types that act as vertical block containers (Pages in the model). */
export const PAGE_CONTAINERS: ReadonlySet<string> = new Set(
  definitions
    .filter((d) => d.capabilities.isPageContainer)
    .map((d) => d.name),
);

/** Atom block types (kind: 'atom') — no editable inner content, resolved as whole units. */
export const ATOM_BLOCK_TYPES: ReadonlySet<string> = new Set(
  definitions
    .filter((d) => d.kind === 'atom')
    .map((d) => d.name),
);

/**
 * Node types whose blocks carry a `backgroundColor` attribute — THE single
 * source for block colouring.  Drives BOTH the Tiptap global-attribute
 * registration (extensions/blockBackground.ts receives this via configure)
 * AND the canTakeBackgroundColor() capability predicate in blockLifecycle.
 *
 * listItem/taskItem hold the colour on their own <li>, which wraps the row's
 * line AND its nested sub-list — one continuous region (Notion-style).
 * They have no BlockDefinition (rows are schema-level, not insertables),
 * so they are listed explicitly rather than derived.
 */
export const BLOCK_BG_TYPES: readonly string[] = [
  'paragraph', 'heading', 'blockquote', 'codeBlock',
  'callout', 'details', 'bulletList', 'orderedList', 'taskList',
  'listItem', 'taskItem',
];

/** Container blocks that accept Tab-indented children (kind: 'container'). */
export const INDENT_CONTAINER_TYPES: ReadonlySet<string> = new Set(
  definitions
    .filter((d) => d.kind === 'container')
    .map((d) => d.name),
);

/** Block-level nodes that can live inside a column. */
export const COLUMN_BLOCK_NODE_TYPES: readonly string[] = (() => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const def of definitions) {
    if (def.capabilities.allowInColumn && !seen.has(def.name)) {
      seen.add(def.name);
      result.push(def.name);
    }
  }
  return result;
})();

/** Column nodes can also contain nested column lists. */
export const COLUMN_CONTENT_NODE_TYPES: readonly string[] = [
  ...COLUMN_BLOCK_NODE_TYPES,
  'columnList',
];

/** Build a ProseMirror content expression from node names. */
export const COLUMN_CONTENT_EXPRESSION: string =
  `(${COLUMN_CONTENT_NODE_TYPES.join(' | ')})+`;

/** Non-standard block nodes that need explicit drag-handle registration. */
export const DRAG_HANDLE_CUSTOM_NODE_TYPES: readonly string[] = (() => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const def of definitions) {
    if (def.capabilities.customDragHandle && !seen.has(def.name)) {
      seen.add(def.name);
      result.push(def.name);
    }
  }
  return result;
})();

// ── Helper Functions ────────────────────────────────────────────────────────

/**
 * Collect all Tiptap extensions registered in the block registry.
 * Called by `createEditorExtensions()` to assemble the editor extension array.
 */
export function getBlockExtensions(context: EditorExtensionContext): AnyExtension[] {
  const result: AnyExtension[] = [];
  for (const def of definitions) {
    if (def.extension) {
      const ext = def.extension(context);
      if (Array.isArray(ext)) {
        result.push(...ext);
      } else {
        result.push(ext);
      }
    }
  }
  return result;
}

/** Blocks that appear in the slash menu, sorted by order. */
export function getSlashMenuBlocks(): BlockDefinition[] {
  return definitions
    .filter((d): d is BlockDefinition & { slashMenu: SlashMenuConfig } => !!d.slashMenu)
    .sort((a, b) => a.slashMenu!.order - b.slashMenu!.order);
}

/** Blocks that appear in the turn-into submenu, sorted by order. */
export function getTurnIntoBlocks(): BlockDefinition[] {
  return definitions
    .filter((d): d is BlockDefinition & { turnInto: TurnIntoConfig } => !!d.turnInto)
    .sort((a, b) => a.turnInto!.order - b.turnInto!.order);
}

/**
 * Generic labels for ProseMirror node types that have multiple registry
 * entries (e.g. heading → 'Heading 1'/'Heading 2'/'Heading 3' but the
 * action menu header should show just 'Heading').
 */
const GENERIC_LABELS: Record<string, string> = {
  heading: 'Heading',
  columnList: 'Columns',
  toggleHeading: 'Toggle Heading',
  mathBlock: 'Equation',
};

/** Map a ProseMirror node type name to a human-readable label. */
export function getBlockLabel(typeName: string): string {
  // Check for a generic override first (multi-variant node types).
  if (typeName in GENERIC_LABELS) return GENERIC_LABELS[typeName];

  // Then check for an exact id match.
  const byId = _registry.get(typeName);
  if (byId) return byId.label;

  // Finally scan by ProseMirror name.
  for (const def of definitions) {
    if (def.name === typeName) return def.label;
  }
  return typeName;
}

/** Look up a block definition by ProseMirror node type name (returns first match). */
export function getBlockByName(typeName: string): BlockDefinition | undefined {
  for (const def of definitions) {
    if (def.name === typeName) return def;
  }
  return undefined;
}

/** Check whether a node type name is a "container" block for turn-into purposes. */
export function isContainerBlockType(typeName: string): boolean {
  const def = getBlockByName(typeName);
  return def?.kind === 'container';
}

// ── Transform shapes ─────────────────────────────────────────────────────────
// Declarative description of how a block type decomposes into / rebuilds from
// universal parts (inline title content + child blocks + attrs).  The generic
// transform engine in blockStateRegistry/blockTransforms.ts is driven entirely
// by these shapes — adding a block type never requires editing the engine.

export type TransformShape =
  /** Textblock: inline content directly inside the node (paragraph, heading, codeBlock). */
  | { readonly kind: 'textblock' }
  /** Wrapper: child blocks directly inside the node (callout, blockquote). */
  | { readonly kind: 'wrapper' }
  /** Title child + body child holding blocks (details, toggleHeading). */
  | { readonly kind: 'summary-content'; readonly summaryType: string; readonly contentType: string }
  /** List: rows of `itemType`, each row a paragraph + optional nested blocks. */
  | { readonly kind: 'list'; readonly itemType: 'listItem' | 'taskItem'; readonly itemAttrs?: Record<string, any> }
  /** Atom whose text lives in an attribute (mathBlock's latex). */
  | { readonly kind: 'atom-text'; readonly textAttr: string };

const TEXTBLOCK_SHAPE: TransformShape = { kind: 'textblock' };
const WRAPPER_SHAPE: TransformShape = { kind: 'wrapper' };

/** Shape overrides for types whose structure the kind-based default can't infer. */
const TRANSFORM_SHAPE_OVERRIDES: Record<string, TransformShape> = {
  details: { kind: 'summary-content', summaryType: 'detailsSummary', contentType: 'detailsContent' },
  toggleHeading: { kind: 'summary-content', summaryType: 'toggleHeadingText', contentType: 'detailsContent' },
  bulletList: { kind: 'list', itemType: 'listItem' },
  orderedList: { kind: 'list', itemType: 'listItem' },
  taskList: { kind: 'list', itemType: 'taskItem', itemAttrs: { checked: false } },
  mathBlock: { kind: 'atom-text', textAttr: 'latex' },
};

/**
 * Resolve the transform shape for a node type.  Explicit overrides win;
 * otherwise registry `kind: 'container'` types are wrappers and everything
 * else is treated as a textblock (correct for all turn-into sources, which
 * canTurnInto() restricts to content-bearing types).
 */
export function getTransformShape(typeName: string): TransformShape {
  const override = TRANSFORM_SHAPE_OVERRIDES[typeName];
  if (override) return override;
  return isContainerBlockType(typeName) ? WRAPPER_SHAPE : TEXTBLOCK_SHAPE;
}

/**
 * Containers whose block content lives inside a nested wrapper child
 * (details/toggleHeading → detailsContent) — derived from transform shapes.
 * Declared after the shape tables so the module-eval derivation sees them.
 */
export const CONTENT_WRAPPER_TYPES: ReadonlySet<string> = new Set(
  [...INDENT_CONTAINER_TYPES].filter(
    (name) => getTransformShape(name).kind === 'summary-content',
  ),
);

/**
 * Look up placeholder text for a specific node from the registry.
 * Returns `undefined` when the registry has no configured placeholder,
 * signalling the caller should fall back to context-dependent logic
 * (e.g. ancestor walk for paragraphs).
 */
export function getNodePlaceholder(typeName: string, attrs?: Record<string, any>): string | undefined {
  // Multi-variant nodes: try variant-specific lookup first (e.g. heading-1).
  if (attrs?.level !== undefined) {
    const variantDef = _registry.get(`${typeName}-${attrs.level}`);
    if (variantDef?.placeholder !== undefined) return variantDef.placeholder;
  }
  const def = getBlockByName(typeName);
  return def?.placeholder;
}

// ── Icon Access (registry-to-registry gate) ─────────────────────────────────
// BlockRegistry talks to IconRegistry so that block extensions, chrome, and
// sidebar never import iconRegistry directly.  They import these re-exports
// from blockRegistry — their single entry point.
//
// See docs/ICON_REGISTRY.md for the three-registry architecture.

import {
  svgIcon as _ir_svgIcon,
  resolvePageIcon as _ir_resolvePageIcon,
  createIconElement as _ir_createIconElement,
  PAGE_SELECTABLE_ICONS as _ir_PAGE_SELECTABLE_ICONS,
  ALL_PAGE_SELECTABLE_ICONS as _ir_ALL_PAGE_SELECTABLE_ICONS,
} from './iconRegistry.js';

/** @see {@link import('./iconRegistry.js').svgIcon} — original source */
export const svgIcon: (id: string) => string = _ir_svgIcon;

/** @see {@link import('./iconRegistry.js').resolvePageIcon} — original source */
export const resolvePageIcon: (icon: string | null | undefined) => string = _ir_resolvePageIcon;

/** @see {@link import('./iconRegistry.js').createIconElement} — original source */
export const createIconElement: (id: string, size?: number) => HTMLElement = _ir_createIconElement;

/** @see {@link import('./iconRegistry.js').PAGE_SELECTABLE_ICONS} — original source */
export const PAGE_SELECTABLE_ICONS: readonly string[] = _ir_PAGE_SELECTABLE_ICONS;

/**
 * Render a page's icon as SVG markup suitable for passing to
 * `editors.openEditor({ iconHtml })`. Resolves the page's icon string
 * (Lucide id or null) through the canvas icon registry and returns the
 * raw SVG — the consuming view sizes it via its container element.
 *
 * Returns an empty string when no icon could be resolved (caller will
 * fall back to extension-derived defaults).
 */
export function renderPageIconHtml(icon: string | null | undefined): string {
  const id = _ir_resolvePageIcon(icon);
  if (!id) return '';
  return _ir_svgIcon(id) || '';
}

/** @see {@link import('./iconRegistry.js').ALL_PAGE_SELECTABLE_ICONS} — full Lucide catalog for search */
export const ALL_PAGE_SELECTABLE_ICONS: readonly string[] = _ir_ALL_PAGE_SELECTABLE_ICONS;

/**
 * localStorage key for the page-icon picker's "Recently used" list. Shared by
 * every page-icon picker (sidebar page options, page chrome, page block,
 * callout) so the recents follow the user regardless of where they pick from.
 */
export const PAGE_ICON_RECENT_STORAGE_KEY = 'parallx.iconPicker.recent.pageIcon';

// ── Block State Access (registry gate) ───────────────────────────────────────
// Block extensions (columnNodes, pageBlockNode) get state helpers through
// blockRegistry — their single entry point — instead of reaching into
// blockStateRegistry directly.
//
// blockStateRegistry is split by concern:
//   blockLifecycle.ts   — deletion, duplication, styling
//   blockTransforms.ts  — "turn into" type conversions
//   blockMovement.ts    — all positional changes + column utilities
//
// ⚠️  CYCLE: This file and blockStateRegistry.ts form a permitted circular
// dependency.  Both directions use `export { } from` (live re-exports) —
// safe because no evaluation-time reads cross the boundary.  NEVER convert
// these to `import X; export const Y = X`.  Enforced by gateCompliance.test.ts.

export {
  duplicateBlockAt,
  deleteBlockAt,
  applyTextColorToBlock,
  applyBackgroundColorToBlock,
  indentBlock,
  outdentBlock,
  resolveBlockAncestry,
  resolveMovableBlock,
  resolveBlockUnit,
  resolveUnitContainer,
  enumerateBlockUnits,
  resolveBlockUnitFromDOM,
  listItemContentElement,
  setOnLinkedPageBlockDeleted,
} from './blockStateRegistry/blockStateRegistry.js';

export {
  turnBlockWithSharedStrategy,
  turnBlockIntoColumns,
  createColumnLayoutFromDrop,
  addColumnToLayoutFromDrop,
  areAllDraggedNodesListItems,
  wrapDraggedListItemsForDrop,
} from './blockStateRegistry/blockStateRegistry.js';

export {
  isColumnEffectivelyEmpty,
  normalizeColumnList,
  normalizeAllColumnLists,
  dissolveOrphanedColumnLists,
  resetColumnListWidths,
  deleteDraggedSource,
  moveBlockAcrossColumnBoundary,
  moveBlockDownWithinPageFlow,
  moveBlockUpWithinPageFlow,
} from './blockStateRegistry/blockStateRegistry.js';

// ── Column Plugin Access (via blockStateRegistry gate) ───────────────────
// Column plugins are block-state concerns (resize, drop, auto-dissolve).
// They live under blockStateRegistry; blockRegistry re-exports for consumers.

export {
  columnResizePlugin,
  columnDropPlugin,
  columnAutoDissolvePlugin,
} from './blockStateRegistry/blockStateRegistry.js';

// ── Editor Assembly Access (registry gate) ────────────────────────────────
// canvasEditorProvider gets the fully assembled extension array through
// blockRegistry — its single entry point — instead of importing
// tiptapExtensions.ts directly.

export { createEditorExtensions } from './tiptapExtensions.js';

// ── Page Chrome Access (registry gate) ───────────────────────────────────
// PageChromeController lives in header/pageChrome.ts.  External consumers
// (canvasEditorProvider) reach it through blockRegistry — its owning gate.

export { PageChromeController } from '../header/pageChrome.js';

// ── Drag Session + Cross-Page Movement (registry gate) ──────────────────
// Drag session state lives in dragSession.ts.  Cross-page movement
// (async persistence orchestration) lives in crossPageMovement.ts.
// Both are gated through blockStateRegistry.

export {
  CANVAS_BLOCK_DRAG_MIME,
  setActiveCanvasDragSession,
  getActiveCanvasDragSession,
  clearActiveCanvasDragSession,
  classifyPageBlockDropZone,
  getPageBlockDropThresholds,
  moveBlockToLinkedPage,
} from './blockStateRegistry/blockStateRegistry.js';
export type { CanvasDragSession, CrossPageMoveParams } from './blockStateRegistry/blockStateRegistry.js';

// ── Cover gallery (M93 slop audit, finding 7) ────────────────────────────
// The default page-cover art, derived from the three Parallx moods
// (Slate / Warm / Ember): quiet, desaturated, confident. Covers appear in
// every canvas screenshot, so even content art carries the identity — no
// template-purple hero gradients. ONE list; pageChrome (Add cover) and the
// cover picker gallery both import it from this gate.

export const COVER_GALLERY: readonly string[] = [
  // Slate — graphite + steel.
  'linear-gradient(135deg, #22303c 0%, #56789c 100%)',
  'linear-gradient(180deg, #16171a 0%, #2b3a4d 100%)',
  'linear-gradient(135deg, #1f2125 0%, #41454d 100%)',
  'linear-gradient(135deg, #aebac6 0%, #e6ebf0 100%)',
  // Warm — charcoal, indigo, paper.
  'linear-gradient(135deg, #201e1b 0%, #52527a 100%)',
  'linear-gradient(180deg, #1d2030 0%, #3c4568 100%)',
  'linear-gradient(135deg, #cfc4b0 0%, #ece7dc 100%)',
  // Ember — warm graphite, amber, clay.
  'linear-gradient(135deg, #26221d 0%, #a9763d 100%)',
  'linear-gradient(135deg, #3a2e28 0%, #8a5a44 100%)',
  // Quiet naturals.
  'linear-gradient(135deg, #24312b 0%, #4f7a62 100%)',
  'linear-gradient(180deg, #1c2420 0%, #2e4639 100%)',
  'linear-gradient(135deg, #322a33 0%, #6e5462 100%)',
];
