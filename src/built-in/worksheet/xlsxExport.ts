// xlsxExport.ts — a workbook snapshot written out as an .xlsx file.
//
// Values, formulas and merges travel; styles and widths do not. SheetJS
// builds the file and hands it to the browser as a download.

import * as XLSX from 'xlsx';
import type { IWorkbookData } from '@univerjs/core';

interface SnapshotSheet {
  name?: string;
  cellData?: Record<string, Record<string, { v?: unknown; f?: string }>>;
  mergeData?: { startRow: number; startColumn: number; endRow: number; endColumn: number }[];
}

/** Convert one workbook sheet into a SheetJS worksheet (values, formulas,
 *  merges). Null when the sheet holds nothing exportable. */
function sheetToSheetJs(sheet: SnapshotSheet): XLSX.WorkSheet | null {
  const ws: XLSX.WorkSheet = {};
  let maxRow = 0;
  let maxCol = 0;
  let any = false;
  for (const [rowStr, cols] of Object.entries(sheet.cellData ?? {})) {
    const r = Number(rowStr);
    for (const [colStr, data] of Object.entries(cols ?? {})) {
      const c = Number(colStr);
      if (data?.v === undefined && !data?.f) continue;
      const cell: XLSX.CellObject = { t: typeof data.v === 'number' ? 'n' : 's', v: data.v as string | number };
      if (data.f) cell.f = String(data.f).replace(/^=/, '');
      if (data.v === undefined) { cell.t = 'n'; delete cell.v; }
      ws[XLSX.utils.encode_cell({ r, c })] = cell;
      maxRow = Math.max(maxRow, r);
      maxCol = Math.max(maxCol, c);
      any = true;
    }
  }
  if (!any) return null;
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxRow, c: maxCol } });
  const merges = (sheet.mergeData ?? []).map((m) => ({
    s: { r: m.startRow, c: m.startColumn }, e: { r: m.endRow, c: m.endColumn },
  }));
  if (merges.length) ws['!merges'] = merges;
  return ws;
}

/** All sheets of a snapshot in tab order, as named SheetJS worksheets. */
export function snapshotToSheetJs(snapshot: IWorkbookData): { name: string; ws: XLSX.WorkSheet }[] {
  const cast = snapshot as unknown as { sheetOrder?: string[]; sheets?: Record<string, SnapshotSheet> };
  const sheets = cast.sheets ?? {};
  const order = Array.isArray(cast.sheetOrder) && cast.sheetOrder.length > 0
    ? cast.sheetOrder.filter((id) => sheets[id])
    : Object.keys(sheets);
  const out: { name: string; ws: XLSX.WorkSheet }[] = [];
  for (const id of order) {
    const ws = sheetToSheetJs(sheets[id]);
    if (ws) out.push({ name: (sheets[id].name || `Sheet${out.length + 1}`).slice(0, 31), ws });
  }
  return out;
}

/** Write the snapshot as `filename` (.xlsx added when missing). False when it holds nothing exportable. */
export function writeSnapshotXlsx(snapshot: IWorkbookData, filename: string): boolean {
  const sheets = snapshotToSheetJs(snapshot);
  if (sheets.length === 0) return false;
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();
  for (const { name, ws } of sheets) {
    let tab = name;
    for (let n = 2; used.has(tab); n++) tab = `${name.slice(0, 28)} ${n}`;
    used.add(tab);
    XLSX.utils.book_append_sheet(wb, ws, tab);
  }
  XLSX.writeFile(wb, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`);
  return true;
}
