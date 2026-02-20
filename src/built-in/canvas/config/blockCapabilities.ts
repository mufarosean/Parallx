// blockCapabilities.ts — Re-exports block capability constants from the
// canonical block registry.  Kept as a shim so existing import paths
// (editorExtensions.ts, columnNodes.ts) continue to work.
//
// See config/blockRegistry.ts for the single source of truth.

export {
  COLUMN_BLOCK_NODE_TYPES,
  COLUMN_CONTENT_NODE_TYPES,
  COLUMN_CONTENT_EXPRESSION,
  DRAG_HANDLE_CUSTOM_NODE_TYPES,
} from './blockRegistry.js';
