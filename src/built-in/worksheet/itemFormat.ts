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

export interface GeneratedItem {
  readonly title: string;
  readonly question: string;
  readonly tags: string[];
  readonly givens: ItemCell[];
  readonly solution: ItemCell[];
  readonly solutionNotes: string;
  /** Page attribution when the material was page-tagged (M98 pattern). */
  readonly page?: number;
}

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
  s?: { bl?: number; bg?: { rgb: string } };
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

function toWorkbook(name: string, matrix: Record<number, Record<number, CellData>>): IWorkbookData {
  return {
    id: `ws-item-${Date.now()}-${_wbCounter++}`,
    name,
    sheetOrder: ['sheet1'],
    sheets: {
      sheet1: {
        id: 'sheet1',
        name: 'Sheet1',
        rowCount: ATHENA_ROWS,
        columnCount: ATHENA_COLUMNS,
        cellData: matrix,
      },
    },
  } as unknown as IWorkbookData;
}

/**
 * Build the two stored snapshots from a generated item:
 * - givens: the item as presented (given cells tinted; values only — a
 *   given carrying a formula would leak solution method).
 * - solution: givens + solution cells layered on top (formulas intact).
 */
export function itemToWorkbooks(item: GeneratedItem): { givensJson: string; solutionJson: string } {
  const givensOnly = item.givens.map((c) => ({ ...c, formula: undefined }));
  const givensMatrix = buildCellMatrix(givensOnly, true);

  // Solution = tinted givens with the work layered over (untinted).
  const solutionMatrix = buildCellMatrix(givensOnly, true);
  const workMatrix = buildCellMatrix(item.solution, false);
  for (const [rowStr, cols] of Object.entries(workMatrix)) {
    const row = Number(rowStr);
    for (const [colStr, data] of Object.entries(cols)) {
      (solutionMatrix[row] ??= {})[Number(colStr)] = data;
    }
  }

  return {
    givensJson: JSON.stringify(toWorkbook('Item', givensMatrix)),
    solutionJson: JSON.stringify(toWorkbook('Solution', solutionMatrix)),
  };
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
    const question = String(e.question ?? '').trim();
    const givens = normalizeCells(e.givens);
    const solution = normalizeCells(e.solution);
    // An item without a title, question, or any solution work is unusable.
    if (!title || !question || solution.length === 0) continue;
    const page = Number(e.page ?? NaN);
    items.push({
      title,
      question,
      tags: Array.isArray(e.tags) ? e.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 8) : [],
      givens,
      solution,
      solutionNotes: String(e.solution_notes ?? e.solutionNotes ?? '').trim(),
      ...(Number.isInteger(page) && page > 0 ? { page } : {}),
    });
  }
  if (items.length === 0) return { items: [], error: 'No usable items in the model output.' };
  return { items, error: null };
}

function normalizeCells(value: unknown): ItemCell[] {
  if (!Array.isArray(value)) return [];
  const out: ItemCell[] = [];
  for (const entry of value.slice(0, 400)) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const cell = String(e.cell ?? '').trim().toUpperCase();
    if (!parseA1(cell)) continue;
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
 * can read. Empty cells are skipped; order is row-major for scanability.
 */
export function serializeWorkbookCells(json: string, maxCells = 500): string {
  let wb: IWorkbookData | null = null;
  try { wb = JSON.parse(json) as IWorkbookData; } catch { return ''; }
  const sheets = (wb as unknown as { sheets?: Record<string, { cellData?: Record<string, Record<string, CellData>> }> })?.sheets;
  if (!sheets) return '';
  const lines: string[] = [];
  for (const sheet of Object.values(sheets)) {
    const cellData = sheet.cellData ?? {};
    const rows = Object.keys(cellData).map(Number).sort((a, b) => a - b);
    for (const row of rows) {
      const cols = Object.keys(cellData[row] ?? {}).map(Number).sort((a, b) => a - b);
      for (const col of cols) {
        if (lines.length >= maxCells) return lines.join('\n');
        const data = cellData[row][col];
        if (data?.v === undefined && data?.f === undefined) continue;
        const ref = `${colToLetters(col)}${row + 1}`;
        const value = data.v !== undefined ? String(data.v) : '';
        const formula = data.f ? ` (${data.f})` : '';
        lines.push(`${ref}: ${value}${formula}`.trim());
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
