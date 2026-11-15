// sheetLimits.ts — what a sheet is held to, applied to a live engine.
//
// Part of the ENGINE bundle (imported only by univerHost.ts). The exam
// tool's limits are one set of limits among others: a practice sheet is
// given them, a sheet of one's own is given none (worksheetConstants.ts).

import type { Univer } from '@univerjs/core';
import type { FUniver } from '@univerjs/core/lib/facade';
import { ICommandService, LifecycleService, LifecycleStages } from '@univerjs/core';
import { IFunctionService } from '@univerjs/engine-formula';
import { SetSelectionsOperation, SetWorksheetColumnCountMutation, SetWorksheetRowCountMutation } from '@univerjs/sheets';
import { ATHENA_FUNCTIONS } from './athenaFunctions.js';
import { ATHENA_ROWS, ATHENA_COLUMNS, GROW_MARGIN_COLUMNS, GROW_MARGIN_ROWS, GROW_STEP_COLUMNS, GROW_STEP_ROWS, type SheetLimits } from './worksheetConstants.js';

/** The exam tool's sheet: what a host is held to when it is given no limits. */
export const EXAM_LIMITS: SheetLimits = { functions: ATHENA_FUNCTIONS, rows: ATHENA_ROWS, columns: ATHENA_COLUMNS };

/** The engine computes +, -, *, /, comparisons and ranges through executors of its own, registered beside the functions (its FUNCTION_NAMES_META, which the package does not export): never removed. */
const ENGINE_OPERATORS: ReadonlySet<string> = new Set(['COMPARE', 'DIVIDED', 'MINUS', 'MULTIPLY', 'PLUS', 'UNION', 'CUBE']);

const saidFor = new WeakSet<Univer>();

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
    // What computes (the executors) and what the catalog lists (the descriptions) are two lists, and
    // some functions are only in the first: reading the catalog alone left those computing.
    const known = new Set<string>();
    for (const name of fnService.getExecutors().keys()) known.add(String(name));
    for (const name of fnService.getDescriptions().keys()) known.add(String(name));
    const toRemove = [...known].filter((name) => !allowed.has(name.toUpperCase()) && !ENGINE_OPERATORS.has(name.toUpperCase()));
    if (toRemove.length) {
      fnService.unregisterExecutors(...toRemove);
      fnService.unregisterDescriptions(...toRemove);
      // Said once per engine: the list is applied at each stage of the engine's start.
      if (!saidFor.has(univer)) console.log(`[WorksheetHost] function set applied: ${toRemove.length} of ${known.size} functions removed (${toRemove.sort().join(', ')})`);
      saidFor.add(univer);
    }
  } catch (err) {
    // Filtering is fidelity, not safety: an engine internals change must
    // degrade to "extra functions available", never to a broken sheet.
    console.warn('[WorksheetHost] function filtering skipped:', err);
  }
}

/**
 * Hold a live engine to a function list from now on. The engine registers
 * its functions as it starts (what computes when the first workbook is
 * made, the catalog as it renders), so the list is applied now and again at
 * each stage of the start, until the engine is steady. Applied only once,
 * before the workbook existed, it found nothing to remove and held nothing.
 */
export function holdToFunctions(univer: Univer, functions: readonly string[]): { dispose(): void } {
  applyFunctionSet(univer, functions);
  try {
    let sub: { unsubscribe(): void } | undefined;
    let steady = false;
    sub = univer.__getInjector().get(LifecycleService).lifecycle$.subscribe((stage) => {
      applyFunctionSet(univer, functions);
      if (stage >= LifecycleStages.Steady) { steady = true; sub?.unsubscribe(); }
    });
    if (steady) sub.unsubscribe();
    return { dispose: () => sub?.unsubscribe() };
  } catch (err) {
    console.warn('[WorksheetHost] the function list is not held through the start:', err);
    return { dispose: () => {} };
  }
}

/**
 * A sheet that grows has no edge to run into: as the selection nears the
 * last rows or columns, the grid extends. The engine's grid is a fixed
 * count, and at its end an arrow wraps to the other side of the sheet.
 */
export function installSheetGrowth(univer: Univer, univerAPI: FUniver, isDisposed: () => boolean): { dispose(): void } {
  try {
    const commands = univer.__getInjector().get(ICommandService);
    return commands.onCommandExecuted((c) => {
      if (c.id !== SetSelectionsOperation.id || isDisposed()) return;
      try {
        const workbook = univerAPI.getActiveWorkbook();
        const sheet = workbook?.getActiveSheet();
        const cell = sheet?.getSelection()?.getCurrentCell();
        if (!workbook || !sheet || !cell) return;
        const where = { unitId: workbook.getId(), subUnitId: sheet.getSheetId() };
        const rows = sheet.getMaxRows();
        const columns = sheet.getMaxColumns();
        // The engine's own change, not its command: growing is not something a person did, so Undo does not step through it.
        if (cell.actualRow >= rows - GROW_MARGIN_ROWS) commands.syncExecuteCommand(SetWorksheetRowCountMutation.id, { ...where, rowCount: rows + GROW_STEP_ROWS });
        if (cell.actualColumn >= columns - GROW_MARGIN_COLUMNS) commands.syncExecuteCommand(SetWorksheetColumnCountMutation.id, { ...where, columnCount: columns + GROW_STEP_COLUMNS });
      } catch (err) { console.warn('[Worksheet] the sheet did not grow:', err); }
    });
  } catch (err) {
    console.warn('[Worksheet] growth not attached:', err);
    return { dispose: () => {} };
  }
}
