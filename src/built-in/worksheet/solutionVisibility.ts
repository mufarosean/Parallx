// solutionVisibility.ts — Worksheets: which columns hide the worked solution.
//
// PURE (unit-tested in tests/unit/worksheetSolutionVisibility.test.ts). A
// problem sheet keeps its worked solution to the right of a marker column;
// the student works beside it. The solution span runs from the marker to the
// pristine sheet's last column with CONTENT (a value, a formula, rich text),
// never to the last column that merely carries a border or a fill: the
// workbook's banner rows are styled out to column BL, and measuring those
// once hid fifty columns, the student's work among them (2026-09-14).
//
// Two guarantees: a column the student has written in is never hidden, and
// visibility is rebuilt on every mount, so flags left in an earlier snapshot
// cannot hide work again.

export interface SheetLike {
  columnCount?: number;
  columnData?: Record<number, { hd?: number; w?: number }>;
  cellData?: Record<number, Record<number, Record<string, unknown>>>;
  mergeData?: { startColumn: number; endColumn: number }[];
}
export interface PristineIndex {
  /** "row:col" of every pristine cell with content. */
  readonly content: ReadonlySet<string>;
  /** The last column with content (or a merge starting in the solution), -1 when none. */
  readonly lastContentCol: number;
}
export interface ColumnSegment { readonly start: number; readonly last: number }

/** Columns kept free to the right of the solution, revealed or not. */
export const WORK_COLUMNS_AFTER_SOLUTION = 27;

export function cellHasContent(cell: Record<string, unknown> | null | undefined): boolean {
  if (!cell) return false;
  if (cell.f != null && cell.f !== '') return true;
  if (cell.p != null) return true;
  return cell.v != null && cell.v !== '';
}

/** What the pristine sheet holds: where content ends, and which cells are its own. */
export function indexPristine(sheet: SheetLike, solutionCol: number): PristineIndex {
  const content = new Set<string>();
  let last = -1;
  for (const [r, row] of Object.entries(sheet.cellData ?? {})) {
    for (const [c, cell] of Object.entries(row ?? {})) {
      if (!cellHasContent(cell)) continue;
      content.add(`${r}:${c}`);
      const col = Number(c);
      if (col > last) last = col;
    }
  }
  for (const m of sheet.mergeData ?? []) {
    if (m.startColumn >= solutionCol && m.endColumn > last) last = m.endColumn;
  }
  return { content, lastContentCol: last };
}

/** Columns holding cells the student wrote (content not in the pristine sheet). */
export function studentColumns(sheet: SheetLike, pristine: PristineIndex): Set<number> {
  const out = new Set<number>();
  for (const [r, row] of Object.entries(sheet.cellData ?? {})) {
    for (const [c, cell] of Object.entries(row ?? {})) {
      if (cellHasContent(cell) && !pristine.content.has(`${r}:${c}`)) out.add(Number(c));
    }
  }
  return out;
}

/** The solution's columns to hide, as runs: marker to last content, minus the student's columns. */
export function solutionSegments(sheet: SheetLike, solutionCol: number, pristine: PristineIndex): ColumnSegment[] {
  if (solutionCol < 0 || pristine.lastContentCol < solutionCol) return [];
  const student = studentColumns(sheet, pristine);
  const segs: { start: number; last: number }[] = [];
  for (let c = solutionCol; c <= pristine.lastContentCol; c++) {
    if (student.has(c)) continue;
    const tail = segs[segs.length - 1];
    if (tail && tail.last === c - 1) tail.last = c;
    else segs.push({ start: c, last: c });
  }
  return segs;
}

/**
 * Rebuild column visibility from the marker on: hidden only while the
 * solution is hidden and only where the student has not written; every
 * other column from the marker on is shown, whatever an earlier snapshot
 * said. Keeps room to work past the solution. Mutates and returns `sheet`.
 */
export function applySolutionVisibility(sheet: SheetLike, solutionCol: number, pristine: PristineIndex, show: boolean): SheetLike {
  if (solutionCol < 0) return sheet;
  const columnData = (sheet.columnData ??= {});
  const hide = new Set<number>();
  if (!show) for (const s of solutionSegments(sheet, solutionCol, pristine)) for (let c = s.start; c <= s.last; c++) hide.add(c);
  const end = Math.max(sheet.columnCount ?? 0, pristine.lastContentCol + 1, ...Object.keys(columnData).map(Number).map((k) => k + 1));
  for (let c = solutionCol; c < end; c++) {
    if (hide.has(c)) (columnData[c] ??= {}).hd = 1;
    else if (columnData[c]?.hd) delete columnData[c].hd;
  }
  sheet.columnCount = Math.max(sheet.columnCount ?? 0, pristine.lastContentCol + WORK_COLUMNS_AFTER_SOLUTION);
  return sheet;
}
