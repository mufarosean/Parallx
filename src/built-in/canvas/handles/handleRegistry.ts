// handleRegistry.ts — Handle interaction gate (5th registry)
//
// Mediates all imports for handle-layer children (blockHandles.ts,
// blockSelection.ts).  Children import ONLY from this file — never from
// blockRegistry, canvasMenuRegistry, or any other registry directly.
//
// canvasEditorProvider imports handle controllers through this gate.

// ── Re-exports from IconRegistry (source owner) ─────────────────────────────
// Handle children need svgIcon for rendering drag grips and action buttons.

/** @see {@link import('../config/iconRegistry.js').svgIcon} — origin */
export { svgIcon } from '../config/iconRegistry.js';

// ── Re-exports from BlockStateRegistry (source owner) ───────────────────────
// Handle children need drag session state helpers.  BlockStateRegistry owns
// these (via dragSession.ts) — we go to the source, not through BlockRegistry.

/** @see {@link import('../config/blockStateRegistry/dragSession.js')} — origin */
export { CANVAS_BLOCK_DRAG_MIME, clearActiveCanvasDragSession, setActiveCanvasDragSession } from '../config/blockStateRegistry/blockStateRegistry.js';

// ── Re-exports from BlockRegistry (source owner) ────────────────────────────
// BlockRegistry owns PAGE_CONTAINERS and isContainerBlockType — computed from
// the block definitions it defines.

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
