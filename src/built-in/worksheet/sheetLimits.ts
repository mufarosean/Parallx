// sheetLimits.ts — what a sheet is held to, applied to a live engine.
//
// Part of the ENGINE bundle (imported only by univerHost.ts). The exam
// tool's limits are one set of limits among others: a practice sheet is
// given them, a sheet of one's own is given none (worksheetConstants.ts).

import type { Univer } from '@univerjs/core';
import type { FUniver } from '@univerjs/core/lib/facade';
import { ICommandService } from '@univerjs/core';
import { IFunctionService } from '@univerjs/engine-formula';
import { SetSelectionsOperation } from '@univerjs/sheets';
import { ATHENA_FUNCTIONS } from './athenaFunctions.js';
import { ATHENA_ROWS, ATHENA_COLUMNS, GROW_MARGIN_COLUMNS, GROW_MARGIN_ROWS, GROW_STEP_COLUMNS, GROW_STEP_ROWS, type SheetLimits } from './worksheetConstants.js';

/** The exam tool's sheet: what a host is held to when it is given no limits. */
export const EXAM_LIMITS: SheetLimits = { functions: ATHENA_FUNCTIONS, rows: ATHENA_ROWS, columns: ATHENA_COLUMNS };

/**
 * Hold the engine to a function list: every function not on it is
 * unregistered, so using one gives the #NAME? the real tool would, and it
 * leaves the fx catalog and autocomplete. The exam's list is generated from
 * Pearson's own comparison workbook (athenaFunctions.ts).
 */
export function applyFunctionSet(univer: Univer, functions: readonly string[]): void {
  try {
    const fnService = univer.__getInjector().get(IFunctionService);
    const allowed = new Set(functions.map((name) => name.toUpperCase()));
    const toRemove: string[] = [];
    for (const name of fnService.getDescriptions().keys()) {
      if (!allowed.has(String(name).toUpperCase())) toRemove.push(String(name));
    }
    if (toRemove.length) {
      fnService.unregisterExecutors(...toRemove);
      fnService.unregisterDescriptions(...toRemove);
      console.log(`[WorksheetHost] function set applied: ${toRemove.length} functions removed, ${allowed.size} allowed`);
    }
  } catch (err) {
    // Filtering is fidelity, not safety: an engine internals change must
    // degrade to "extra functions available", never to a broken sheet.
    console.warn('[WorksheetHost] function filtering skipped:', err);
  }
}

/**
 * A sheet that grows has no edge to run into: as the selection nears the
 * last rows or columns, the grid extends. The engine's grid is a fixed
 * count, and at its end an arrow wraps to the other side of the sheet.
 */
export function installSheetGrowth(univer: Univer, univerAPI: FUniver, isDisposed: () => boolean): { dispose(): void } {
  try {
    return univer.__getInjector().get(ICommandService).onCommandExecuted((c) => {
      if (c.id !== SetSelectionsOperation.id || isDisposed()) return;
      try {
        const sheet = univerAPI.getActiveWorkbook()?.getActiveSheet();
        const cell = sheet?.getSelection()?.getCurrentCell();
        if (!sheet || !cell) return;
        const rows = sheet.getMaxRows();
        const columns = sheet.getMaxColumns();
        if (cell.actualRow >= rows - GROW_MARGIN_ROWS) sheet.setRowCount(rows + GROW_STEP_ROWS);
        if (cell.actualColumn >= columns - GROW_MARGIN_COLUMNS) sheet.setColumnCount(columns + GROW_STEP_COLUMNS);
      } catch (err) { console.warn('[Worksheet] the sheet did not grow:', err); }
    });
  } catch (err) {
    console.warn('[Worksheet] growth not attached:', err);
    return { dispose: () => {} };
  }
}
