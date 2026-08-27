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

/** @see {@link import('../config/blockStateRegistry/columnInvariants.js')} — origin */
export { resolveBlockAncestry, resolveMovableBlock, normalizeAllColumnLists, notifyLinkedPageBlocksDeleted, growEmptiedAncestorDeletion } from '../config/blockStateRegistry/blockStateRegistry.js';
// ── Table operations (source: blockStateRegistry/tableOps.ts) ──────────────
// The grips aim and reorder; every structural edit they trigger is defined
// once in tableOps and shared with the menu and the keyboard policy.

/** @see {@link import('../config/blockStateRegistry/tableOps.js')} — origin */
export {
  tableFrameAt,
  resolveTableFrame,
  selectTableRow,
  selectTableColumn,
  selectTableNode,
  appendRow,
  appendColumn,
  moveRowBy,
  moveColumnBy,
  selectionIsInTable,
} from '../config/blockStateRegistry/blockStateRegistry.js';
export type { TableFrame } from '../config/blockStateRegistry/blockStateRegistry.js';

export {
  resolveBlockUnit,
  resolveUnitContainer,
  enumerateBlockUnits,
  resolveBlockUnitFromDOM,
  listItemContentElement,
} from '../config/blockStateRegistry/blockStateRegistry.js';
export type { BlockAncestry, MovableBlockContext, BlockUnitEntry, BlockUnitContainer, DomBlockUnit } from '../config/blockStateRegistry/blockStateRegistry.js';

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

// tableControls.ts opens the row/column menu the same way blockHandles opens
// the block-action menu — through an interface, never the implementation.
/** @see {@link import('../menus/canvasMenuRegistry.js').ITableActionMenu} */
export type { ITableActionMenu, TableMenuTarget } from '../menus/canvasMenuRegistry.js';

// ── Child controllers ───────────────────────────────────────────────────────
// canvasEditorProvider imports these through the gate rather than reaching
// into individual child files.

export { BlockHandlesController, type BlockHandlesHost } from './blockHandles.js';
export { BlockSelectionController, type BlockSelectionHost, blockSelectionPluginKey, createBlockSelectionPlugin } from './blockSelection.js';
export { BlockMarqueeController, type BlockMarqueeHost } from './blockMarquee.js';
export { BlockClipboardController, type BlockClipboardHost } from './blockClipboard.js';
export { TableControlsController, type TableControlsHost } from './tableControls.js';
