// worksheetConstants.ts — shared Worksheets constants.
//
// Lives alone so BOTH bundles can import it: univerHost.ts (the separate
// engine bundle) and the main-bundle modules (itemFormat, main). Anything
// here must stay dependency-free — a Univer import in this file would leak
// the engine into dist/renderer/main.js.

/** The Pearson Athena per-item grid bounds (research doc: ~150 × 40). */
export const ATHENA_ROWS = 150;
export const ATHENA_COLUMNS = 40;

/**
 * What a sheet is held to: the functions it may use (null = every function
 * the engine has) and the grid it starts with. `grows` lets the grid extend
 * as the selection nears its end, so the sheet has no edge to run into.
 */
export interface SheetLimits {
  readonly functions: readonly string[] | null;
  readonly rows: number;
  readonly columns: number;
  readonly grows?: boolean;
}

/** A sheet of one's own (a `.sheet` file): every function, a grid that grows. */
export const FREE_SHEET_LIMITS: SheetLimits = { functions: null, rows: 1000, columns: 52, grows: true };
/** How near the end the selection comes before a growing sheet extends, and by how much. */
export const GROW_MARGIN_ROWS = 50;
export const GROW_STEP_ROWS = 1000;
export const GROW_MARGIN_COLUMNS = 8;
export const GROW_STEP_COLUMNS = 26;

/** The context key that is true while a sheet file is live on screen, as the tool names it. */
export const SHEET_ON_SCREEN_KEY = 'sheetFileOnScreen';
/** The same key as a menu entry's `when` reads it: the app puts the tool's id before a tool's key. */
export const SHEET_ON_SCREEN_WHEN = `parallx.worksheet.${SHEET_ON_SCREEN_KEY}`;

/** Worksheets' segment in a place's address: parallx://place/worksheet/<place>. */
export const WS_PLACES_ID = 'worksheet';
/** The instance ids of Worksheets' screens: its places (worksheetPlaces.ts). Anything else opens as a thing, in a tab of its own. */
const WS_PLACE_IDS = new Set(['home', 'bank', 'dashboard', 'plan', 'quizzes', 'practice', 'excel-import', 'create', 'settings']);
export function isWorksheetPlace(instanceId: string): boolean { return WS_PLACE_IDS.has(instanceId); }
