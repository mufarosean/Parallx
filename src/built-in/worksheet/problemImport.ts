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

/** Problem sheets are named Paper.Source_NN; everything else is the workbook's machinery. */
export function isProblemSheetName(name: string): boolean {
  const n = String(name ?? '').trim();
  return n.includes('.') && !MACHINERY.has(n.toLowerCase());
}

export function sourceOf(sheetName: string): ProblemImport['source'] {
  if (/\.RF_/i.test(sheetName)) return 'rf';
  if (/\.CAS_/i.test(sheetName)) return 'cas';
  if (/custom/i.test(sheetName)) return 'custom';
  return 'other';
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
    const solution = findCell(sheet, (t, r) => r <= 2 && /^solutions?\b/i.test(t.trim()));
    const work = findCell(sheet, (t) => /^show all work/i.test(t.trim()));
    // The rating cell stays as it is, thick border and all: the problem tab
    // writes the current rating into it, the way the workbook showed it.
    const ratingCell = findCell(sheet, (t, r) => r <= 2 && /^self-rating/i.test(t.trim()));
    const drop = new Set<string>();
    const rating: Rating = ratingCell ? normalizeRating(cellText(sheet, ratingCell.row, ratingCell.col + 1)) : '';
    const paper = paperKey(name.split('.')[0]);
    const source = sourceOf(name);
    const indexed = index.get(name);
    const kind: ProblemImport['kind'] = /essay/i.test(name) ? 'essay'
      : indexed?.kind.startsWith('qual') ? 'qual'
        : indexed?.kind.startsWith('quant') ? 'quant'
          : solution ? 'quant' : 'qual';
    const quadrant = indexed && indexed.quadrant >= 1 && indexed.quadrant <= 4 ? indexed.quadrant : 0;
    const { workbook, stats } = sheetToSnapshot(sheet, book, { dropCells: drop });
    const a1 = cellText(sheet, 0, 0).trim();
    const problem: ProblemImport = {
      sheetName: name,
      title: a1 || name,
      paper,
      source,
      kind,
      quadrant,
      rating,
      solutionCol: solution ? solution.col : -1,
      workRow: work ? work.row : -1,
      sheetJson: JSON.stringify(workbook),
      questionMd: questionText(sheet, solution ? solution.col : -1, work ? work.row : -1),
      tags: '',
      stats,
    };
    problems.push({ ...problem, tags: problemTags(problem) });
    done++;
    onProgress?.(done, names.length);
  }
  return { problems, skipped };
}
