// univerHost.ts — the Univer spreadsheet engine host (M99).
//
// THIS FILE IS A SEPARATE BUNDLE. scripts/build.mjs compiles it to
// dist/renderer/worksheet-univer.js (+ .css), and the worksheet pane loads it
// with a runtime dynamic import the moment a practice sheet first opens. It
// must NEVER be statically imported from the main renderer tree — the engine
// is several megabytes, and pulling it into dist/renderer/main.js would tax
// every app boot on machines that never open a worksheet (type-only imports
// are fine; they erase).
//
// Everything Athena-fidelity-related that the PRESET can express lives here
// (no sheet-tab footer, no status-bar statistics); grid bounds and item
// semantics (givens fencing, Reset Sheet) belong to the pane layer above.

import { createUniver, LocaleType, mergeLocales } from '@univerjs/presets';
import { UniverSheetsCorePreset } from '@univerjs/presets/preset-sheets-core';
import UniverPresetSheetsCoreEnUS from '@univerjs/presets/preset-sheets-core/locales/en-US';
import type { IWorkbookData, Univer } from '@univerjs/core';
import type { FUniver } from '@univerjs/core/lib/facade';
import '@univerjs/presets/lib/styles/preset-sheets-core.css';

/** The Pearson Athena per-item grid bounds (research doc: ~150 × 40). */
export const ATHENA_ROWS = 150;
export const ATHENA_COLUMNS = 40;

export interface IWorksheetHostOptions {
  /** Element the sheet mounts into. Must be attached and sized. */
  readonly container: HTMLElement;
  /**
   * Full workbook snapshot to restore (pane rebuilds, item loads). When
   * absent, a blank single-sheet Athena-bounded workbook is created.
   */
  readonly snapshot?: IWorkbookData | null;
}

export interface IWorksheetHost {
  /** Serializable full-workbook state (cells, formats, formulas). */
  getSnapshot(): IWorkbookData | null;
  /** Tear down the engine and all DOM it created. */
  dispose(): void;
}

let _hostCounter = 0;

/** A blank Athena-bounded workbook: one sheet, 150×40, no extras. */
export function blankWorkbookData(): Partial<IWorkbookData> {
  const unitId = `worksheet-${Date.now()}-${_hostCounter++}`;
  return {
    id: unitId,
    name: 'Practice Sheet',
    sheetOrder: ['sheet1'],
    sheets: {
      sheet1: {
        id: 'sheet1',
        name: 'Sheet1',
        rowCount: ATHENA_ROWS,
        columnCount: ATHENA_COLUMNS,
      },
    },
  };
}

export function createWorksheetHost(opts: IWorksheetHostOptions): IWorksheetHost {
  const created: { univer: Univer; univerAPI: FUniver } = createUniver({
    locale: LocaleType.EN_US,
    locales: {
      [LocaleType.EN_US]: mergeLocales(UniverPresetSheetsCoreEnUS as Record<string, unknown>),
    },
    presets: [
      UniverSheetsCorePreset({
        container: opts.container,
        // Athena has no workbook: hide the sheet-tab footer entirely.
        footer: false,
        // No selection-statistics strip (not part of the exam surface).
        statusBarStatistic: false,
        // Real formula bar + ribbon ARE part of the exam surface.
        formulaBar: true,
        header: true,
        toolbar: true,
        contextMenu: true,
      }),
    ],
  });

  const { univer, univerAPI } = created;
  univerAPI.createWorkbook(opts.snapshot ?? blankWorkbookData());

  let disposed = false;
  return {
    getSnapshot: () => {
      if (disposed) return null;
      try {
        return univerAPI.getActiveWorkbook()?.save() ?? null;
      } catch {
        return null;
      }
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      try { univer.dispose(); } catch { /* engine already gone */ }
    },
  };
}
