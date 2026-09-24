// problemImport.ts — Worksheets: a practice workbook becomes problems, one
// sheet each, with the ProblemTrack vocabulary the study workbook uses.
//
// PURE (unit-tested in tests/unit/worksheetProblemImport.test.ts). Reads a
// workbook opened by ooxml.ts and describes every problem sheet: which
// paper, which source (Rising Fellow, CAS, custom), which kind (quantitative,
// qualitative, essay), the vendor's quadrant, the student's own rating, where
// the solution starts and where the work area begins, plus the whole sheet
// as a snapshot with the rating dropdown stripped. The sheet keeps its
// formatting; nothing here reshapes it.
import { cellText, findCell, sheetToSnapshot, type XlsxSheet, type XlsxWorkbook, type SnapshotStats } from './ooxml.js';
import { enrichSheetDrawings } from './equationImage.js';

// ── Ratings ─────────────────────────────────────────────────────────────────
// Stored as easy | medium | hard. Older attempts wrote nailed | partial |
// missed for the same three levels; both read back as the same thing.

export type Rating = 'easy' | 'medium' | 'hard' | '';

export function normalizeRating(value: string | null | undefined): Rating {
  const v = String(value ?? '').trim().toLowerCase();
  if (v === 'easy' || v === 'nailed') return 'easy';
  if (v === 'medium' || v === 'partial') return 'medium';
  if (v === 'hard' || v === 'missed') return 'hard';
  return '';
}
export function ratingLabel(value: string | null | undefined): string {
  const r = normalizeRating(value);
  return r === 'easy' ? 'Easy' : r === 'medium' ? 'Medium' : r === 'hard' ? 'Hard' : '';
}
/** The workbook's score: Easy counts in full, Medium half, Hard nothing. */
export const RATING_SCORE: Record<Exclude<Rating, ''>, number> = { easy: 1, medium: 0.5, hard: 0 };

// ── Papers ──────────────────────────────────────────────────────────────────

const PAPER_LABELS: Record<string, string> = {
  brosius: 'Brosius', clark: 'Clark', friedland: 'Friedland', hurlimann: 'Hürlimann', mack1994: 'Mack (1994)', mack2000: 'Mack (2000)',
  marshall: 'Marshall', meyers: 'Meyers', sahas: 'Sahasrabuddhe', shapland: 'Shapland', siewert: 'Siewert', taylor: 'Taylor',
  teng: 'Teng & Perkins', tengdisc: 'Teng & Perkins (Discussion)', venter: 'Venter', verrall: 'Verrall',
};
export function paperKey(name: string): string {
  return String(name ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}
export function paperLabel(key: string): string {
  const k = paperKey(key);
  if (PAPER_LABELS[k]) return PAPER_LABELS[k];
  return k ? k.charAt(0).toUpperCase() + k.slice(1) : '';
}
export const SOURCE_LABELS: Record<string, string> = { rf: 'Rising Fellow', cas: 'CAS Exam', custom: 'Custom', generated: 'Generated', other: 'Other' };
export const KIND_LABELS: Record<string, string> = { quant: 'Quantitative', qual: 'Qualitative', essay: 'Essay' };
export const QUADRANT_LABELS: Record<number, string> = { 1: 'Easy & Likely', 2: 'Difficult & Likely', 3: 'Easy & Unlikely', 4: 'Difficult & Unlikely' };

// ── Detection ───────────────────────────────────────────────────────────────

export interface ProblemImport {
  readonly sheetName: string;
  readonly title: string;
  readonly paper: string;
  readonly source: 'rf' | 'cas' | 'custom' | 'other';
  readonly kind: 'quant' | 'qual' | 'essay';
  readonly quadrant: number;
  readonly rating: Rating;
  /** Zero-based column where the worked solution starts; -1 when the sheet has no solution split. */
  readonly solutionCol: number;
  /** Zero-based row of the "SHOW ALL WORK" line; -1 when absent. */
  readonly workRow: number;
  /** Zero-based first row of a solution laid out below the work area ("SOLUTION"); -1 when absent. */
  readonly solutionRow: number;
  readonly sheetJson: string;
  readonly questionMd: string;
  readonly tags: string;
  readonly stats: SnapshotStats;
}
export interface DetectResult {
  readonly problems: ProblemImport[];
  readonly skipped: { name: string; reason: string }[];
}

const MACHINERY = new Set(['dashboard', 'quiz template', 'instructions', 'quiz generator', 'problems', 'dashboard_data', 'template', 'flashcards']);

/**
 * Problem sheets are named Paper.Source_NN (ProblemTrack), "Q #N" (a Rising
 * Fellow practice exam or problem bank), "2016 #15" (a past CAS question in
 * an RF bank) or "MAC-01" (the question bank's codes); everything else is
 * the workbook's machinery.
 */
const PRACTICE_SHEET = /^(Q\s*#?\s*\d+|\d{4}\s*#\s*\d+|[A-Z]{2,4}-\d{2,3})$/i;
export function isProblemSheetName(name: string): boolean {
  const n = String(name ?? '').trim();
  if (MACHINERY.has(n.toLowerCase())) return false;
  return n.includes('.') || PRACTICE_SHEET.test(n);
}

export function sourceOf(sheetName: string): ProblemImport['source'] {
  if (/\.RF_/i.test(sheetName)) return 'rf';
  if (/\.CAS_/i.test(sheetName)) return 'cas';
  if (/custom/i.test(sheetName)) return 'custom';
  if (/^\d{4}\s*#/.test(sheetName)) return 'cas';
  if (/^Q\s*#?\s*\d+$/i.test(sheetName)) return 'rf';
  if (/^[A-Z]{2,4}-\d{2,3}$/i.test(sheetName)) return 'custom';
  return 'other';
}

/** A paper as a point sheet or a contents page names it ("Mack - Chain Ladder") to its key. */
export function paperKeyFromLabel(label: string): string {
  const l = String(label ?? '').toLowerCase();
  if (!l.trim()) return '';
  if (l.includes('mack')) return /benktander|2000/.test(l) ? 'mack2000' : /chain|1994/.test(l) ? 'mack1994' : 'mack2000';
  if (/h[üu]rlimann/.test(l)) return 'hurlimann';
  if (l.includes('sahas')) return 'sahas';
  if (l.includes('teng')) return /disc/.test(l) ? 'tengdisc' : 'teng';
  return paperKey(/[a-z]+/.exec(l)?.[0] ?? '');
}

/** "RF Meyers - 3" names its paper; a practice-exam sheet leaves A1 empty. */
function paperFromTitle(a1: string): string {
  const m = /^RF\s+(.+?)\s*-\s*\d+/i.exec(a1.trim());
  return m ? paperKeyFromLabel(m[1]) : '';
}

interface SheetHint { paper?: string; title?: string; task?: string; points?: number }
const cellsByRow = (sheet: XlsxSheet): Map<number, Map<number, string | number | boolean>> => {
  const rows = new Map<number, Map<number, string | number | boolean>>();
  for (const c of sheet.cells) {
    if (c.value === undefined) continue;
    let row = rows.get(c.row);
    if (!row) { row = new Map(); rows.set(c.row, row); }
    row.set(c.col, c.value);
  }
  return rows;
};
/**
 * What the workbook says about its sheets beyond their names: a practice
 * exam's PointSheet (question, paper, points, task) and the question bank's
 * Contents (code, paper, title, points, task).
 */
async function readSheetHints(book: XlsxWorkbook): Promise<Map<string, SheetHint>> {
  const hints = new Map<string, SheetHint>();
  const str = (v: string | number | boolean | undefined): string => (v === undefined ? '' : String(v).trim());
  if (book.sheetNames.includes('PointSheet')) {
    try {
      const rows = cellsByRow(await book.readSheet('PointSheet'));
      for (const row of rows.values()) {
        const q = row.get(0);
        if (typeof q !== 'number') continue;
        const paper = str(row.get(2)); const points = row.get(3); const task = str(row.get(5));
        const hint: SheetHint = { paper, task, ...(typeof points === 'number' ? { points } : {}) };
        hints.set(`Q #${q}`, hint);
        hints.set(`Q#${q}`, hint);
      }
    } catch { /* no hints, the sheets still import */ }
  }
  if (book.sheetNames.includes('Contents')) {
    try {
      const rows = cellsByRow(await book.readSheet('Contents'));
      for (const row of rows.values()) {
        const code = str(row.get(1));
        if (!/^[A-Z]{2,4}-\d{2,3}$/.test(code)) continue;
        const points = row.get(4);
        hints.set(code, { paper: str(row.get(2)), title: str(row.get(3)), task: str(row.get(5)), ...(typeof points === 'number' ? { points } : {}) });
      }
    } catch { /* as above */ }
  }
  return hints;
}

/** The workbook's index sheet, when present: sheet name → type and quadrant. */
async function readIndex(book: XlsxWorkbook): Promise<Map<string, { kind: string; quadrant: number }>> {
  const map = new Map<string, { kind: string; quadrant: number }>();
  if (!book.sheetNames.includes('Problems')) return map;
  let sheet: XlsxSheet;
  try { sheet = await book.readSheet('Problems'); } catch { return map; }
  const rows = new Map<number, { name?: string; kind?: string; quadrant?: number }>();
  for (const c of sheet.cells) {
    if (c.row === 0) continue;
    const entry = rows.get(c.row) ?? {};
    if (c.col === 0 && typeof c.value === 'string') entry.name = c.value.trim();
    if (c.col === 6 && typeof c.value === 'number') entry.quadrant = c.value;
    if (c.col === 8 && typeof c.value === 'string') entry.kind = c.value.trim().toLowerCase();
    rows.set(c.row, entry);
  }
  for (const e of rows.values()) {
    if (e.name) map.set(e.name, { kind: e.kind ?? '', quadrant: e.quadrant ?? 0 });
  }
  return map;
}

/** The question as text: strings above the work row and left of the solution, in reading order. */
export function questionText(sheet: XlsxSheet, solutionCol: number, workRow: number): string {
  const lines: string[] = [];
  const sorted = [...sheet.cells].sort((a, b) => a.row - b.row || a.col - b.col);
  for (const c of sorted) {
    if (typeof c.value !== 'string') continue;
    if (c.row === 0) continue; // the title and marker row
    if (solutionCol >= 0 && c.col >= solutionCol) continue;
    if (workRow >= 0 && c.row >= workRow) continue;
    const t = c.value.trim();
    if (t.length < 4) continue;
    if (/^self-rating/i.test(t) || /^solutions?\b/i.test(t) || /^show all work/i.test(t) || /^(unrated|easy|medium|hard)$/i.test(t)) continue;
    lines.push(t);
    if (lines.join(' ').length > 700) break;
  }
  return lines.join('\n');
}

export function problemTags(p: Pick<ProblemImport, 'paper' | 'source' | 'kind' | 'quadrant'>): string {
  const tags = [p.paper, p.source, p.kind];
  if (p.quadrant >= 1 && p.quadrant <= 4) tags.push(`q${p.quadrant}`);
  return tags.filter(Boolean).join(',');
}

/**
 * Every problem sheet of the workbook, described and snapshotted. Sheets
 * without the workbook's naming are reported as skipped, never guessed at.
 */
export async function detectProblems(book: XlsxWorkbook, onProgress?: (done: number, total: number) => void): Promise<DetectResult> {
  const index = await readIndex(book);
  const hints = await readSheetHints(book);
  const names = book.sheetNames.filter(isProblemSheetName);
  const problems: ProblemImport[] = [];
  const skipped: { name: string; reason: string }[] = [];
  for (const name of book.sheetNames) {
    if (!isProblemSheetName(name)) { skipped.push({ name, reason: 'workbook machinery' }); continue; }
  }
  let done = 0;
  for (const name of names) {
    let sheet: XlsxSheet;
    try { sheet = await book.readSheet(name); } catch (err) { skipped.push({ name, reason: `could not read: ${(err as Error).message}` }); continue; }
    // Equations to pictures, metafiles to PNG, before the snapshot fixes what the sheet shows.
    await enrichSheetDrawings(sheet);
    const solution = findCell(sheet, (t, r) => r <= 2 && /^solutions?\b/i.test(t.trim()));
    const work = findCell(sheet, (t) => /^show all work/i.test(t.trim()));
    // The rating cell stays as it is, thick border and all: the problem tab
    // writes the current rating into it, the way the workbook showed it.
    const ratingCell = findCell(sheet, (t, r) => r <= 2 && /^self-rating/i.test(t.trim()));
    const drop = new Set<string>();
    const rating: Rating = ratingCell ? normalizeRating(cellText(sheet, ratingCell.row, ratingCell.col + 1)) : '';
    const a1 = cellText(sheet, 0, 0).trim();
    const hint = hints.get(name) ?? hints.get(name.replace(/\s+/g, ''));
    const paper = name.includes('.') ? paperKey(name.split('.')[0])
      : hint?.paper ? paperKeyFromLabel(hint.paper)
        : paperFromTitle(a1);
    const source = sourceOf(name);
    const indexed = index.get(name);
    // A solution below the question: a "SOLUTION" row in column A after SHOW ALL WORK.
    const below = solution ? null : findCell(sheet, (t, r, c) => c === 0 && (!work || r > work.row) && /^solutions?\b/i.test(t.trim()));
    const solutionRow = below ? below.row : -1;
    const hasFormulaBelow = below ? sheet.cells.some((c) => c.row > below.row && !!c.formula) : false;
    const kind: ProblemImport['kind'] = /essay/i.test(name) ? 'essay'
      : indexed?.kind.startsWith('qual') ? 'qual'
        : indexed?.kind.startsWith('quant') ? 'quant'
          : solution || hasFormulaBelow ? 'quant' : 'qual';
    const quadrant = indexed && indexed.quadrant >= 1 && indexed.quadrant <= 4 ? indexed.quadrant : 0;
    const { workbook, stats } = sheetToSnapshot(sheet, book, { dropCells: drop });
    // A practice-exam sheet has no title in A1: "Source: | PE 1 | Exam 7 | Q #3".
    // Name it by the exam and the question, with the paper when the point
    // sheet gives one; a bank code takes the contents page's title.
    const exam = /^source:?$/i.test(cellText(sheet, 0, 1).trim()) ? cellText(sheet, 0, 2).trim()
      : /^source:?$/i.test(a1) ? cellText(sheet, 0, 1).trim() : '';
    const title = a1 && !/^source:?$/i.test(a1) && !(a1 === name && hint?.title) ? a1
      : hint?.title ? `${name} · ${hint.title}`
        : [exam, name, paper ? paperLabel(paper) : ''].filter(Boolean).join(' · ');
    const problem: ProblemImport = {
      sheetName: name,
      title: title || name,
      paper,
      source,
      kind,
      quadrant,
      rating,
      solutionCol: solution ? solution.col : -1,
      workRow: work ? work.row : -1,
      solutionRow,
      sheetJson: JSON.stringify(workbook),
      questionMd: questionText(sheet, solution ? solution.col : -1, work ? work.row : below ? below.row : -1),
      tags: '',
      stats,
    };
    // The content-outline task (A.iii.2) rides along as a tag when the workbook names one.
    problems.push({ ...problem, tags: problemTags(problem) + (hint?.task ? `,${hint.task}` : '') });
    done++;
    onProgress?.(done, names.length);
  }
  return { problems, skipped };
}

// ── The workbook's own progress history ─────────────────────────────────────

export interface WorkbookSnapshot { readonly day: string; readonly attempted: number; readonly score: number }

/** Excel serial date → local calendar day, yyyy-mm-dd. */
export function serialToDay(serial: number): string {
  const ms = Math.round((serial - 25569) * 86400000);
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/**
 * The Dashboard_Data timeline (Date, % Attempted, Score), written by the
 * workbook's refresh macro one row per day it was pressed. Only rows that
 * hold a value are history; the rest of the table is empty future dates.
 */
export async function readWorkbookTimeline(book: XlsxWorkbook): Promise<WorkbookSnapshot[]> {
  if (!book.sheetNames.includes('Dashboard_Data')) return [];
  let sheet: XlsxSheet;
  try { sheet = await book.readSheet('Dashboard_Data'); } catch { return []; }
  const rows = new Map<number, { day?: string; attempted?: number; score?: number }>();
  for (const c of sheet.cells) {
    if (c.row === 0) continue;
    if (c.col < 10 || c.col > 12) continue;
    const entry = rows.get(c.row) ?? {};
    if (c.col === 10) {
      if (typeof c.value === 'number') entry.day = serialToDay(c.value);
      else if (typeof c.value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(c.value)) entry.day = c.value.slice(0, 10);
    }
    if (c.col === 11 && typeof c.value === 'number') entry.attempted = c.value;
    if (c.col === 12 && typeof c.value === 'number') entry.score = c.value;
    rows.set(c.row, entry);
  }
  const out: WorkbookSnapshot[] = [];
  for (const e of rows.values()) {
    if (!e.day || (e.attempted === undefined && e.score === undefined)) continue;
    out.push({ day: e.day, attempted: e.attempted ?? 0, score: e.score ?? 0 });
  }
  return out.sort((a, b) => a.day.localeCompare(b.day));
}
