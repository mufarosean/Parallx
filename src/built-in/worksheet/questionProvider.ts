// questionProvider.ts — Worksheets' essay and qualitative items as questions
//
// The Problem Bank's essay sheets and qualitative problems, offered through
// the core's question-provider seam (src/services/questionProviders.ts) to
// any tool that practises questions. The quantitative sheets stay here,
// where the sheet is the point. The row-to-item mapping is pure and tested
// in tests/unit/questionProviders.test.ts.

import type { IQuestionItem, IQuestionProvider } from '../../services/questionProviders.js';
import { itemTags } from './practiceSession.js';
import { serializeWorkbookCells } from './itemFormat.js';

/**
 * The values of a sheet's solution cells (from the solution column across,
 * or the solution row down), one line per row; '' when the sheet has none.
 */
export function sheetSolutionText(sheetJson: string, solutionCol: number, solutionRow: number, maxCells = 500): string {
  if (!sheetJson || (solutionCol < 0 && solutionRow < 0)) return '';
  let snap: { sheetOrder?: string[]; sheets?: Record<string, { cellData?: Record<string, Record<string, { v?: unknown }>> }> } | null = null;
  try { snap = JSON.parse(sheetJson); } catch { return ''; }
  const sheets = snap?.sheets ?? {};
  const first = sheets[snap?.sheetOrder?.[0] ?? ''] ?? Object.values(sheets)[0];
  const cellData = first?.cellData ?? {};
  const lines: string[] = [];
  let cells = 0;
  for (const row of Object.keys(cellData).map(Number).sort((a, b) => a - b)) {
    const values: string[] = [];
    for (const col of Object.keys(cellData[row] ?? {}).map(Number).sort((a, b) => a - b)) {
      const inSolution = (solutionCol >= 0 && col >= solutionCol) || (solutionRow >= 0 && row >= solutionRow);
      const v = cellData[row][col]?.v;
      if (!inSolution || v === undefined || v === null || String(v).trim() === '') continue;
      if (cells++ >= maxCells) break;
      values.push(String(v).trim());
    }
    if (values.length) lines.push(values.join(' '));
  }
  return lines.join('\n');
}

/** One ws_items row (as listQuestionRows selects it) as a question item. Pure. */
export function worksheetQuestionItem(row: Record<string, unknown>): IQuestionItem {
  const notes = String(row.solution_notes_md ?? '');
  const answer = notes
    || sheetSolutionText(String(row.sheet_json ?? ''), Number(row.solution_col ?? -1), Number(row.solution_row ?? -1))
    || serializeWorkbookCells(String(row.solution_json ?? ''));
  const sourcePage = Number(row.source_page ?? 0);
  return {
    ref: String(row.id),
    question: String(row.question_md ?? ''),
    answer,
    kind: String(row.kind ?? '') === 'essay' ? 'essay' : 'short',
    paper: String(row.paper ?? ''),
    source: String(row.source ?? ''),
    label: String(row.title ?? ''),
    sourceUri: String(row.source_uri ?? ''),
    sourcePage: sourcePage > 0 ? sourcePage : undefined,
    tags: itemTags(String(row.tags ?? '')),
  };
}

export function worksheetQuestionProvider(deps: {
  listRows(limit: number): Promise<Record<string, unknown>[]>;
  getItem(id: number): Promise<{ readonly title: string; readonly kind: string } | null>;
  openItem(id: number, title: string): Promise<void>;
}): IQuestionProvider {
  return {
    id: 'worksheets.problems',
    displayName: 'Problem Bank',
    toolId: 'parallx.worksheet',
    async list(opts) {
      const rows = await deps.listRows(opts?.limit ?? 500);
      return rows.map(worksheetQuestionItem);
    },
    async open(ref) {
      const id = Number(ref);
      if (!Number.isInteger(id) || id <= 0) return false;
      const item = await deps.getItem(id);
      if (!item || (item.kind !== 'essay' && item.kind !== 'qual')) return false;
      await deps.openItem(id, item.title);
      return true;
    },
  };
}
