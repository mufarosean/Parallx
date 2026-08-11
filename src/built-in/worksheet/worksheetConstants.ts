// worksheetConstants.ts — shared Worksheets constants (M99).
//
// Lives alone so BOTH bundles can import it: univerHost.ts (the separate
// engine bundle) and the main-bundle modules (itemFormat, main). Anything
// here must stay dependency-free — a Univer import in this file would leak
// the engine into dist/renderer/main.js.

/** The Pearson Athena per-item grid bounds (research doc: ~150 × 40). */
export const ATHENA_ROWS = 150;
export const ATHENA_COLUMNS = 40;
