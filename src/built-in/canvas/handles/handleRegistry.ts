// handleRegistry.ts — Handle interaction gate (5th registry)
//
// Mediates all imports for handle-layer children (blockHandles.ts,
// blockSelection.ts).  Children import ONLY from this file — never from
// blockRegistry, canvasMenuRegistry, or any other registry directly.
//
// canvasEditorProvider imports handle controllers through this gate.

// ── Re-exports from BlockRegistry (registry-to-registry gate) ───────────────
// Handle children need block metadata constants and drag session helpers.
// They get them through this gate instead of importing blockRegistry directly.

export {
  svgIcon,
  CANVAS_BLOCK_DRAG_MIME,
  clearActiveCanvasDragSession,
  setActiveCanvasDragSession,
  PAGE_CONTAINERS,
  isContainerBlockType,
} from '../config/blockRegistry.js';

// ── Re-exports from CanvasMenuRegistry (registry-to-registry gate) ──────────
// blockHandles.ts needs the IBlockActionMenu interface to delegate
// block-action menu show/hide.  It gets it through this gate.

export type { IBlockActionMenu } from '../menus/canvasMenuRegistry.js';

// ── Child controllers ───────────────────────────────────────────────────────
// canvasEditorProvider imports these through the gate rather than reaching
// into individual child files.

export { BlockHandlesController, type BlockHandlesHost } from './blockHandles.js';
export { BlockSelectionController, type BlockSelectionHost } from './blockSelection.js';
