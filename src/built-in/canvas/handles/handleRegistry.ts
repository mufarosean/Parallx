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

/** @see {@link import('../config/iconRegistry.js').svgIcon} — original source (IconRegistry → BlockRegistry → here) */
export { svgIcon } from '../config/blockRegistry.js';
/** @see {@link import('../config/blockStateRegistry/dragSession.js')} — original source (dragSession → BlockStateRegistry → BlockRegistry → here) */
export { CANVAS_BLOCK_DRAG_MIME, clearActiveCanvasDragSession, setActiveCanvasDragSession } from '../config/blockRegistry.js';
/** @see {@link import('../config/blockRegistry.js').PAGE_CONTAINERS} */
export { PAGE_CONTAINERS, isContainerBlockType } from '../config/blockRegistry.js';

// ── Re-exports from CanvasMenuRegistry (registry-to-registry gate) ──────────
// blockHandles.ts needs the IBlockActionMenu interface to delegate
// block-action menu show/hide.  It gets it through this gate.

/** @see {@link import('../menus/canvasMenuRegistry.js').IBlockActionMenu} */
export type { IBlockActionMenu } from '../menus/canvasMenuRegistry.js';

// ── Child controllers ───────────────────────────────────────────────────────
// canvasEditorProvider imports these through the gate rather than reaching
// into individual child files.

export { BlockHandlesController, type BlockHandlesHost } from './blockHandles.js';
export { BlockSelectionController, type BlockSelectionHost } from './blockSelection.js';
