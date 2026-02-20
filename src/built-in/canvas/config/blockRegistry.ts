// blockRegistry.ts — Single source of truth for canvas block type metadata
//
// Every consumer that needs to know about block types (menus, handles,
// mutations, plugins, capabilities) reads from this registry instead of
// maintaining its own hardcoded lists.
//
// See docs/BLOCK_REGISTRY.md for architecture rationale.

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

const PAGE_CONTAINER_CAP: BlockCapabilities = {
  allowInColumn: false,
  customDragHandle: false,
  isPageContainer: true,
  suppressBubbleMenu: false,
};

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
    defaultContent: undefined, // Uses custom popup action
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
    defaultContent: undefined, // Complex insert action
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
  },

  // ── Custom Extensions ──

  {
    id: 'callout',
    name: 'callout',
    label: 'Callout',
    icon: 'lightbulb',
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
    defaultContent: undefined, // Uses custom column insertion logic
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
    defaultContent: undefined, // Uses custom popup action
  },
  {
    id: 'pageBlock',
    name: 'pageBlock',
    label: 'Page',
    icon: 'page',
    source: 'custom',
    kind: 'atom',
    capabilities: CUSTOM_DRAG,
    slashMenu: { description: 'Create and open a nested sub-page', order: 0, category: 'basic' },
    turnInto: undefined,
    defaultContent: undefined, // Uses custom async page creation action
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
    defaultContent: undefined, // Uses custom popup action
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
