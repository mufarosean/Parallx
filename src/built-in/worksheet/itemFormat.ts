// itemFormat.ts — Worksheets (M99): the model-facing item format and its
// conversion to real workbook snapshots. PURE functions only (unit-tested in
// tests/unit/worksheetItemFormat.test.ts); no Univer imports beyond types.
//
// Why an intermediate format: IWorkbookData is deeply nested and merciless —
// a model asked to emit it directly hallucinates structure. Models are
// reliable at flat cell lists ("B4 holds 1250.5", "C9 computes =B4*C4"), so
// generation speaks THAT, and this file builds the snapshots.

import type { IWorkbookData } from '@univerjs/core';
import { ATHENA_ROWS, ATHENA_COLUMNS } from './worksheetConstants.js';

// ── Model-facing shapes ─────────────────────────────────────────────────────

export interface ItemCell {
  /** A1-style reference, e.g. "B4". */
  readonly cell: string;
  /** Displayed value. Numbers stay numbers; strings render as text. */
  readonly value?: string | number;
  /** Formula (leading '='). Solution cells may carry both formula and value. */
  readonly formula?: string;
  /** Bold text — headers/labels. */
  readonly bold?: boolean;
}

/**
 * One part of an item — one sheet TAB in the built workbook (Mufaro's
 * workbook model: "every part of a question on a page"). The part's question
 * text is written ONTO the sheet (merged block at the top), not into pane
 * chrome — working the item reads like the exam page itself.
 */
export interface ItemPart {
  /** Tab label, e.g. "a" → tab "(a)". Single unnamed part → "Item". */
  readonly name: string;
  /** Plain exam wording, rendered on-sheet (no markdown — it's cell text). */
  readonly question: string;
  readonly givens: ItemCell[];
  readonly solution: ItemCell[];
}

export interface GeneratedItem {
  readonly title: string;
  readonly tags: string[];
  readonly parts: ItemPart[];
  readonly solutionNotes: string;
  /** Page attribution when the material was page-tagged (M98 pattern). */
  readonly page?: number;
}

/** Rows 1-4 (indices 0-3) hold the merged on-sheet question block; row 5 is
 *  a gutter. Generated cells live at row 6+ — refs below this are dropped. */
export const QUESTION_BLOCK_ROWS = 4;
export const FIRST_CONTENT_ROW = 5; // zero-based: A1-row 6
/** Question block merges A..J — wide enough to wrap exam wording legibly. */
const QUESTION_BLOCK_COLS = 10;

// ── A1 reference parsing ────────────────────────────────────────────────────

const A1_RE = /^([A-Z]{1,2})([0-9]{1,3})$/;

/** "B4" → { row: 3, col: 1 } (zero-based). Null when malformed or out of the Athena grid. */
export function parseA1(ref: string): { row: number; col: number } | null {
  const m = A1_RE.exec(String(ref ?? '').trim().toUpperCase());
  if (!m) return null;
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  col -= 1;
  const row = Number(m[2]) - 1;
  if (row < 0 || row >= ATHENA_ROWS || col < 0 || col >= ATHENA_COLUMNS) return null;
  return { row, col };
}

// ── Workbook building ───────────────────────────────────────────────────────

/** Background tint that visually fences the given-data region (Athena uses a
 *  heavy border; a tint fences just as clearly and never misaligns). */
const GIVENS_BG = 'rgb(244,241,232)';

interface CellData {
  v?: string | number;
  f?: string;
  s?: { bl?: number; bg?: { rgb: string }; tb?: number; vt?: number };
}

function buildCellMatrix(cells: readonly ItemCell[], tintGivens: boolean): Record<number, Record<number, CellData>> {
  const matrix: Record<number, Record<number, CellData>> = {};
  for (const cell of cells) {
    const pos = parseA1(cell.cell);
    if (!pos) continue; // out-of-grid refs are dropped, never crash
    const data: CellData = {};
    if (cell.formula && String(cell.formula).startsWith('=')) data.f = String(cell.formula);
    if (cell.value !== undefined && cell.value !== null && cell.value !== '') data.v = cell.value;
    if (data.v === undefined && data.f === undefined) continue;
    const style: CellData['s'] = {};
    if (cell.bold) style.bl = 1;
    if (tintGivens) style.bg = { rgb: GIVENS_BG };
    if (style.bl || style.bg) data.s = style;
    (matrix[pos.row] ??= {})[pos.col] = data;
  }
  return matrix;
}

let _wbCounter = 0;

/** Tab label: "a" → "(a)"; blank name (single-part items) → "Item". */
function partSheetName(part: ItemPart, index: number, total: number): string {
  const raw = part.name.trim().replace(/^[(\[]|[)\]]$/g, '');
  if (!raw) return total === 1 ? 'Item' : `Part ${index + 1}`;
  return raw.length <= 3 ? `(${raw})` : raw;
}

/** Estimate the merged question block's total height from its text. The
 *  block spans ~10 default-width columns (~730px, ~90 chars/line at 11pt). */
function questionBlockHeights(question: string): Record<number, { h: number }> {
  let lines = 0;
  for (const para of question.split('\n')) lines += Math.max(1, Math.ceil(para.length / 90));
  const total = Math.min(400, Math.max(76, lines * 20 + 16));
  const per = Math.ceil(total / QUESTION_BLOCK_ROWS);
  const heights: Record<number, { h: number }> = {};
  for (let r = 0; r < QUESTION_BLOCK_ROWS; r++) heights[r] = { h: per };
  return heights;
}

interface SheetSpec {
  readonly name: string;
  readonly question: string;
  readonly matrix: Record<number, Record<number, CellData>>;
}

function toWorkbook(name: string, sheetSpecs: readonly SheetSpec[]): IWorkbookData {
  const sheetOrder: string[] = [];
  const sheets: Record<string, unknown> = {};
  sheetSpecs.forEach((spec, i) => {
    const id = `p${i}`;
    sheetOrder.push(id);
    const matrix = spec.matrix;
    // The question lives ON the sheet: merged wrap block at the top.
    if (spec.question) {
      (matrix[0] ??= {})[0] = { v: spec.question, s: { tb: 3, vt: 1 } };
    }
    sheets[id] = {
      id,
      name: spec.name,
      rowCount: ATHENA_ROWS,
      columnCount: ATHENA_COLUMNS,
      cellData: matrix,
      ...(spec.question ? {
        mergeData: [{ startRow: 0, startColumn: 0, endRow: QUESTION_BLOCK_ROWS - 1, endColumn: QUESTION_BLOCK_COLS - 1 }],
        rowData: questionBlockHeights(spec.question),
      } : {}),
    };
  });
  return {
    id: `ws-item-${Date.now()}-${_wbCounter++}`,
    name,
    sheetOrder,
    sheets,
  } as unknown as IWorkbookData;
}

/**
 * Build the two stored snapshots from a generated item. One sheet TAB per
 * part, the part's question written onto the sheet:
 * - givens: parts as presented (given cells tinted; values only — a given
 *   carrying a formula would leak solution method).
 * - solution: givens + solution cells layered on top (formulas intact).
 */
export function itemToWorkbooks(item: GeneratedItem): { givensJson: string; solutionJson: string } {
  const givensSheets: SheetSpec[] = [];
  const solutionSheets: SheetSpec[] = [];
  item.parts.forEach((part, i) => {
    const name = partSheetName(part, i, item.parts.length);
    const givensOnly = part.givens.map((c) => ({ ...c, formula: undefined }));
    givensSheets.push({ name, question: part.question, matrix: buildCellMatrix(givensOnly, true) });

    // Solution = tinted givens with the work layered over (untinted).
    const solutionMatrix = buildCellMatrix(givensOnly, true);
    const workMatrix = buildCellMatrix(part.solution, false);
    for (const [rowStr, cols] of Object.entries(workMatrix)) {
      const row = Number(rowStr);
      for (const [colStr, data] of Object.entries(cols)) {
        (solutionMatrix[row] ??= {})[Number(colStr)] = data;
      }
    }
    solutionSheets.push({ name, question: part.question, matrix: solutionMatrix });
  });

  return {
    givensJson: JSON.stringify(toWorkbook('Item', givensSheets)),
    solutionJson: JSON.stringify(toWorkbook('Solution', solutionSheets)),
  };
}

/** True when the stored workbook carries its question on-sheet (merged block)
 *  — legacy single-sheet items don't, and keep the pane-chrome question. */
export function workbookHasOnSheetQuestion(json: string): boolean {
  try {
    const wb = JSON.parse(json) as { sheets?: Record<string, { mergeData?: unknown[] }> };
    return Object.values(wb.sheets ?? {}).some((s) => Array.isArray(s.mergeData) && s.mergeData.length > 0);
  } catch {
    return false;
  }
}

// ── Model output extraction ─────────────────────────────────────────────────

/**
 * Extract generated items from raw model output. Tolerates code fences and
 * prose around the array. Returns { items, error } — items is [] on failure.
 */
export function extractItemsJson(raw: string): { items: GeneratedItem[]; error: string | null } {
  const text = String(raw ?? '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```(?:json)?/gi, '')
    .trim();

  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end <= start) return { items: [], error: 'No JSON array found in the model output.' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch (err) {
    return { items: [], error: `The model output was not valid JSON: ${(err as Error).message}` };
  }
  if (!Array.isArray(parsed)) return { items: [], error: 'The model output was not a JSON array.' };

  const items: GeneratedItem[] = [];
  for (const entry of parsed.slice(0, 10)) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const title = String(e.title ?? '').trim();
    if (!title) continue;

    // Parts shape (workbook model). Legacy flat shape (question/givens/
    // solution at the item root) folds into a single unnamed part.
    const rawParts = Array.isArray(e.parts) && e.parts.length > 0
      ? e.parts
      : [{ name: '', question: e.question, givens: e.givens, solution: e.solution }];
    const parts: ItemPart[] = [];
    for (const rawPart of rawParts.slice(0, 8)) {
      if (!rawPart || typeof rawPart !== 'object') continue;
      const p = rawPart as Record<string, unknown>;
      const question = String(p.question ?? '').trim();
      const solution = normalizeCells(p.solution, FIRST_CONTENT_ROW);
      // A part without a question or any solution work is unusable.
      if (!question || solution.length === 0) continue;
      parts.push({
        name: String(p.name ?? '').trim().slice(0, 24),
        question,
        givens: normalizeCells(p.givens, FIRST_CONTENT_ROW),
        solution,
      });
    }
    if (parts.length === 0) continue;

    const page = Number(e.page ?? NaN);
    items.push({
      title,
      tags: Array.isArray(e.tags) ? e.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 8) : [],
      parts,
      solutionNotes: String(e.solution_notes ?? e.solutionNotes ?? '').trim(),
      ...(Number.isInteger(page) && page > 0 ? { page } : {}),
    });
  }
  if (items.length === 0) return { items: [], error: 'No usable items in the model output.' };
  return { items, error: null };
}

/** minRow: cells above it are dropped — the on-sheet question block owns
 *  those rows, and shifting refs would break the emitted formulas. */
function normalizeCells(value: unknown, minRow = 0): ItemCell[] {
  if (!Array.isArray(value)) return [];
  const out: ItemCell[] = [];
  for (const entry of value.slice(0, 400)) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const cell = String(e.cell ?? '').trim().toUpperCase();
    const pos = parseA1(cell);
    if (!pos || pos.row < minRow) continue;
    const rawValue = e.value;
    const formula = typeof e.formula === 'string' && e.formula.trim().startsWith('=') ? e.formula.trim() : undefined;
    const valueOk = typeof rawValue === 'number' || (typeof rawValue === 'string' && rawValue.trim() !== '');
    if (!valueOk && !formula) continue;
    out.push({
      cell,
      ...(valueOk ? { value: typeof rawValue === 'number' ? rawValue : String(rawValue).trim() } : {}),
      ...(formula ? { formula } : {}),
      ...(e.bold ? { bold: true } : {}),
    });
  }
  return out;
}

// ── Attempt serialization (for AI review, M99 S6) ───────────────────────────

/**
 * Flatten a workbook snapshot into compact "B4: 123 (=C2*D2)" lines the model
 * can read. Multi-sheet workbooks (one tab per part) get a "[Tab: name]"
 * header per sheet, in tab order. Empty cells are skipped; row-major.
 */
export function serializeWorkbookCells(json: string, maxCells = 500): string {
  let wb: IWorkbookData | null = null;
  try { wb = JSON.parse(json) as IWorkbookData; } catch { return ''; }
  const cast = wb as unknown as {
    sheetOrder?: string[];
    sheets?: Record<string, { name?: string; cellData?: Record<string, Record<string, CellData>> }>;
  };
  const sheets = cast?.sheets;
  if (!sheets) return '';
  const order = Array.isArray(cast.sheetOrder) && cast.sheetOrder.length > 0
    ? cast.sheetOrder.filter((id) => sheets[id])
    : Object.keys(sheets);
  const multi = order.length > 1;
  const lines: string[] = [];
  let cells = 0;
  for (const sheetId of order) {
    const sheet = sheets[sheetId];
    if (multi) lines.push(`[Tab: ${sheet.name || sheetId}]`);
    const cellData = sheet.cellData ?? {};
    const rows = Object.keys(cellData).map(Number).sort((a, b) => a - b);
    for (const row of rows) {
      const cols = Object.keys(cellData[row] ?? {}).map(Number).sort((a, b) => a - b);
      for (const col of cols) {
        if (cells >= maxCells) return lines.join('\n');
        const data = cellData[row][col];
        if (data?.v === undefined && data?.f === undefined) continue;
        const ref = `${colToLetters(col)}${row + 1}`;
        const value = data.v !== undefined ? String(data.v) : '';
        const formula = data.f ? ` (${data.f})` : '';
        lines.push(`${ref}: ${value}${formula}`.trim());
        cells++;
      }
    }
  }
  return lines.join('\n');
}

function colToLetters(col: number): string {
  let n = col + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}
