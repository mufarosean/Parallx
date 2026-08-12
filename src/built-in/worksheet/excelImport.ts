// excelImport.ts — Worksheets: turn real Excel practice workbooks into
// practice items. PURE functions (unit-tested); no Univer imports.
//
// Grounded in the two real formats in Mufaro's study folder (2026-08-12):
// - Rising Fellow workbook (338 sheets): one problem per sheet named
//   "Paper.Source_NN"; the QUESTION occupies the left columns and the worked
//   SOLUTION sits to the RIGHT of a "Solution ->" marker cell (with live
//   formulas). Machinery sheets (Dashboard, Quiz Generator, ...) carry no
//   marker and no pair, so they fall into the opt-in "other sheets" group.
// - CAS-style item files: "Item N" / "Answer N" sheet PAIRS — the Item sheet
//   is the exam-presented question; the Answer sheet restates it with the
//   grading metadata, full-credit answer, and shown work.

import { ATHENA_ROWS, ATHENA_COLUMNS } from './worksheetConstants.js';

export interface GridSheet {
  readonly name: string;
  /** [row, col, value, formulaOrNull] tuples (0-based, SheetJS order). */
  readonly cells: readonly (readonly [number, number, string | number, string | null])[];
  readonly merges: readonly (readonly [number, number, number, number])[];
  readonly colWidths: readonly (readonly [number, number])[];
}

interface SnapshotSheetSpec {
  readonly name: string;
  readonly sheet: GridSheet;
  /** Keep only cells with col < clipCol (side-by-side givens). */
  readonly clipCol?: number;
  /** Drop specific cells (row,col) — workbook machinery like Self-Rating. */
  readonly dropCells?: ReadonlySet<string>;
}

export interface ExcelItem {
  readonly title: string;
  readonly questionMd: string;
  readonly points: number;
  readonly tags: string;
  /** Sheet names consumed by this item (for the selection UI). */
  readonly sheetNames: readonly string[];
  readonly givensJson: string;
  readonly solutionJson: string;
  /** 'pair' | 'split' | 'whole' — how the item was detected. */
  readonly kind: string;
}

let _wbCounter = 0;

function buildSnapshot(name: string, specs: readonly SnapshotSheetSpec[]): string {
  const sheetOrder: string[] = [];
  const sheets: Record<string, unknown> = {};
  specs.forEach((spec, i) => {
    const id = `s${i}`;
    sheetOrder.push(id);
    const cellData: Record<number, Record<number, { v?: string | number; f?: string }>> = {};
    let maxRow = 0;
    let maxCol = 0;
    for (const [r, c, v, f] of spec.sheet.cells) {
      if (spec.clipCol !== undefined && c >= spec.clipCol) continue;
      if (spec.dropCells?.has(`${r}:${c}`)) continue;
      const data: { v?: string | number; f?: string } = {};
      if (v !== '' && v !== null && v !== undefined) data.v = v;
      if (f) data.f = f.startsWith('=') ? f : `=${f}`;
      if (data.v === undefined && data.f === undefined) continue;
      (cellData[r] ??= {})[c] = data;
      maxRow = Math.max(maxRow, r);
      maxCol = Math.max(maxCol, c);
    }
    const mergeData = spec.sheet.merges
      .filter(([, c0]) => spec.clipCol === undefined || c0 < spec.clipCol)
      .map(([r0, c0, r1, c1]) => ({ startRow: r0, startColumn: c0, endRow: r1, endColumn: Math.min(c1, spec.clipCol !== undefined ? spec.clipCol - 1 : c1) }));
    const columnData: Record<number, { w: number }> = {};
    for (const [i2, w] of spec.sheet.colWidths) {
      if (spec.clipCol !== undefined && i2 >= spec.clipCol) continue;
      columnData[i2] = { w };
    }
    sheets[id] = {
      id,
      name: spec.name,
      rowCount: Math.max(ATHENA_ROWS, maxRow + 20),
      columnCount: Math.max(ATHENA_COLUMNS, maxCol + 4),
      cellData,
      ...(mergeData.length ? { mergeData } : {}),
      ...(Object.keys(columnData).length ? { columnData } : {}),
    };
  });
  return JSON.stringify({
    id: `ws-xl-${Date.now()}-${_wbCounter++}`,
    name,
    sheetOrder,
    sheets,
  });
}

/** Cells sorted reading-order for text scans. */
function readingOrder(sheet: GridSheet) {
  return [...sheet.cells].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

function extractQuestionText(sheet: GridSheet, clipCol?: number): string {
  const lines: string[] = [];
  for (const [, c, v] of readingOrder(sheet)) {
    if (clipCol !== undefined && c >= clipCol) continue;
    if (typeof v !== 'string') continue;
    const t = v.trim();
    if (t.length < 4) continue;
    if (/^self-rating/i.test(t) || /^solution\b/i.test(t) || /^show all work/i.test(t)) continue;
    lines.push(t);
    if (lines.join(' ').length > 700) break;
  }
  return lines.join('\n');
}

function extractPoints(sheet: GridSheet): number {
  for (const [, , v] of readingOrder(sheet).slice(0, 12)) {
    const m = /^([\d.]+)\s*points?\b/i.exec(String(v));
    if (m) return Number(m[1]) || 0;
  }
  return 0;
}

/** The "Solution ->" split column: a string cell in the top rows, right of
 *  the question area, starting with "Solution". */
function findSolutionSplit(sheet: GridSheet): number | null {
  for (const [r, c, v] of sheet.cells) {
    if (r > 3 || c < 6) continue;
    if (typeof v === 'string' && /^solution\b/i.test(v.trim())) return c;
  }
  return null;
}

/** Cells to drop from an item's GIVENS: workbook machinery like the
 *  Self-Rating cell and its value neighbor. */
function machineryCells(sheet: GridSheet): Set<string> {
  const drop = new Set<string>();
  for (const [r, c, v] of sheet.cells) {
    if (r > 2) continue;
    if (typeof v === 'string' && /^self-rating/i.test(v.trim())) {
      drop.add(`${r}:${c}`);
      drop.add(`${r}:${c + 1}`);
    }
  }
  return drop;
}

/**
 * Detect practice items in a workbook grid. Returns detected items plus the
 * names of leftover sheets (offered as opt-in whole-sheet imports).
 */
export function detectExcelItems(sheetsIn: readonly GridSheet[], fileLabel: string): { items: ExcelItem[]; leftovers: string[] } {
  const byName = new Map(sheetsIn.map((s) => [s.name.trim().toLowerCase(), s]));
  const consumed = new Set<string>();
  const items: ExcelItem[] = [];

  // 1. "Item N" / "Answer N" pairs.
  for (const sheet of sheetsIn) {
    const m = /^item\s*(\d+)$/i.exec(sheet.name.trim());
    if (!m) continue;
    const answer = byName.get(`answer ${m[1]}`) ?? byName.get(`answer${m[1]}`);
    if (!answer) continue;
    consumed.add(sheet.name);
    consumed.add(answer.name);
    items.push({
      title: `${fileLabel} - Item ${m[1]}`,
      questionMd: extractQuestionText(sheet),
      points: extractPoints(sheet),
      tags: 'imported',
      sheetNames: [sheet.name, answer.name],
      givensJson: buildSnapshot('Item', [{ name: 'Item', sheet }]),
      // Solution keeps the question tab alongside the answer tab.
      solutionJson: buildSnapshot('Solution', [
        { name: 'Item', sheet },
        { name: 'Answer', sheet: answer },
      ]),
      kind: 'pair',
    });
  }

  // 2. Side-by-side sheets (question left, "Solution ->" right).
  for (const sheet of sheetsIn) {
    if (consumed.has(sheet.name)) continue;
    const split = findSolutionSplit(sheet);
    if (split === null) continue;
    consumed.add(sheet.name);
    const drop = machineryCells(sheet);
    const a1 = sheet.cells.find(([r, c]) => r === 0 && c === 0);
    const title = a1 && typeof a1[2] === 'string' && a1[2].trim() ? a1[2].trim() : sheet.name;
    const paper = sheet.name.includes('.') ? sheet.name.split('.')[0].toLowerCase() : '';
    items.push({
      title,
      questionMd: extractQuestionText(sheet, split),
      points: extractPoints(sheet),
      tags: paper || 'imported',
      sheetNames: [sheet.name],
      givensJson: buildSnapshot('Item', [{ name: 'Item', sheet, clipCol: split, dropCells: drop }]),
      solutionJson: buildSnapshot('Solution', [{ name: sheet.name.slice(0, 28) || 'Solution', sheet, dropCells: drop }]),
      kind: 'split',
    });
  }

  const leftovers = sheetsIn.filter((s) => !consumed.has(s.name)).map((s) => s.name);
  return { items, leftovers };
}

/** Opt-in fallback: import one sheet whole (solution = givens). */
export function wholeSheetItem(sheet: GridSheet, fileLabel: string): ExcelItem {
  const snapshot = buildSnapshot(sheet.name.slice(0, 28) || 'Sheet', [{ name: sheet.name.slice(0, 28) || 'Sheet', sheet }]);
  return {
    title: `${fileLabel} - ${sheet.name}`,
    questionMd: extractQuestionText(sheet),
    points: extractPoints(sheet),
    tags: 'imported',
    sheetNames: [sheet.name],
    givensJson: snapshot,
    solutionJson: snapshot,
    kind: 'whole',
  };
}
