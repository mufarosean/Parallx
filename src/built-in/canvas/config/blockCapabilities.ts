// blockCapabilities.ts — Single-source block capability registry for Canvas

// Block-level nodes that can live inside a column.
export const COLUMN_BLOCK_NODE_TYPES = [
  'paragraph',
  'heading',
  'bulletList',
  'orderedList',
  'taskList',
  'blockquote',
  'codeBlock',
  'horizontalRule',
  'image',
  'table',
  'callout',
  'details',
  'toggleHeading',
  'mathBlock',
  'pageBlock',
  'bookmark',
  'tableOfContents',
  'video',
  'audio',
  'fileAttachment',
] as const;

// Column nodes can also contain nested column lists.
export const COLUMN_CONTENT_NODE_TYPES = [
  ...COLUMN_BLOCK_NODE_TYPES,
  'columnList',
] as const;

// Build a ProseMirror content expression from node names.
const toContentExpression = (nodeTypes: readonly string[]): string => `(${nodeTypes.join(' | ')})+`;

export const COLUMN_CONTENT_EXPRESSION = toContentExpression(COLUMN_CONTENT_NODE_TYPES);

// Non-standard block nodes that need explicit drag-handle registration.
// Standard paragraph/heading/list blocks are already handled by default selectors.
export const DRAG_HANDLE_CUSTOM_NODE_TYPES = [
  'mathBlock',
  'callout',
  'details',
  'toggleHeading',
  'pageBlock',
  'bookmark',
  'tableOfContents',
  'video',
  'audio',
  'fileAttachment',
  'horizontalRule',
  'image',
] as const;
