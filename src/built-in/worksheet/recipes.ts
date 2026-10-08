// recipes.ts — Worksheets: the recipe a problem's solution names.
//
// PURE (unit-tested in tests/unit/worksheetRecipes.test.ts). A workbook's
// solution can name the worked method it follows: a cell reading "Recipe"
// with the name under it, as "Paper - Recipe name". A problem keeps the
// name (ws_items.recipe) and the paper it belongs to (recipe_paper), so the
// Problem Bank can filter by recipe, grouped by paper.

import { paperKeyFromLabel } from './problemImport.js';

export interface ProblemRecipe {
  /** Paper key (as ws_items.paper); '' when the name carries no paper. */
  readonly paper: string;
  readonly name: string;
}

/** How far below the "Recipe" label its name may sit (rows). */
const RECIPE_LOOKAHEAD_ROWS = 3;

type CellLike = { v?: unknown; p?: { body?: { dataStream?: string } } };
type SnapshotLike = { sheetOrder?: string[]; sheets?: Record<string, { cellData?: Record<string, Record<string, CellLike>> }> };

function cellText(cell: CellLike | undefined): string {
  if (!cell) return '';
  if (cell.v !== undefined && cell.v !== null && String(cell.v).trim()) return String(cell.v);
  const stream = cell.p?.body?.dataStream;
  return typeof stream === 'string' ? stream : '';
}

/** Whitespace, dashes and accents made plain: one line, " - " between parts. */
export function cleanRecipeText(raw: string): string {
  return String(raw ?? '')
    .normalize('NFC')
    .replace(/[–—−�]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/\s*-\s+|\s+-\s*/g, ' - ')
    .trim();
}

/** The raw text under the sheet's "Recipe" label, or '' when the sheet names none. */
export function readRecipeCell(snapshot: unknown): string {
  const snap = snapshot as SnapshotLike | null;
  const sheets = snap?.sheets ?? {};
  const first = sheets[snap?.sheetOrder?.[0] ?? ''] ?? Object.values(sheets)[0];
  const cellData = first?.cellData ?? {};
  const rows = Object.keys(cellData).map(Number).sort((a, b) => a - b);
  for (const row of rows) {
    for (const col of Object.keys(cellData[row] ?? {}).map(Number)) {
      if (!/^recipes?:?$/i.test(cellText(cellData[row][col]).trim())) continue;
      for (let r = row + 1; r <= row + RECIPE_LOOKAHEAD_ROWS; r++) {
        const text = cellText(cellData[r]?.[col]).trim();
        if (text) return text;
      }
    }
  }
  return '';
}

/**
 * "Paper - Recipe name" as a recipe: the paper is read from the part before
 * the first " - " (falling back to `fallbackPaper`), the name is the rest.
 * Null when the text names no recipe (empty, or a lone word such as "Source").
 */
export function parseRecipe(raw: string, fallbackPaper = ''): ProblemRecipe | null {
  const text = cleanRecipeText(raw);
  const parts = text.split(' - ');
  if (parts.length < 2) return null;
  // A bare author with two papers says which in a second part:
  // "Mack - Chain Ladder - MSE Calculation".
  const headParts = parts.length > 2 && /^[A-Za-z]+$/.test(parts[0]) && paperKeyFromLabel(parts.slice(0, 2).join(' ')) !== paperKeyFromLabel(parts[0]) ? 2 : 1;
  const name = parts.slice(headParts).join(' - ').trim();
  if (!name) return null;
  const paper = paperKeyFromLabel(parts.slice(0, headParts).join(' ')) || fallbackPaper;
  return { paper, name };
}

/** The recipe a problem's sheet names, or null. */
export function recipeOfSheet(sheetJson: string, fallbackPaper = ''): ProblemRecipe | null {
  if (!sheetJson) return null;
  let snap: unknown = null;
  try { snap = JSON.parse(sheetJson); } catch { return null; }
  const raw = readRecipeCell(snap);
  return raw ? parseRecipe(raw, fallbackPaper) : null;
}

/** A recipe's filter key: paper and name together (a name can recur across papers). */
export function recipeKey(paper: string, name: string): string {
  return `${paper}\u0000${name}`;
}

/** The recipes in use, grouped by paper, each with how many problems name it. */
export function recipeGroups(items: readonly { recipe?: string; recipePaper?: string }[]): Map<string, Map<string, number>> {
  const groups = new Map<string, Map<string, number>>();
  for (const it of items) {
    const name = it.recipe ?? '';
    if (!name) continue;
    const paper = it.recipePaper ?? '';
    if (!groups.has(paper)) groups.set(paper, new Map());
    const g = groups.get(paper)!;
    g.set(name, (g.get(name) ?? 0) + 1);
  }
  return groups;
}
