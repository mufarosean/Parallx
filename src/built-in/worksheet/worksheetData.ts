// worksheetData.ts — Worksheets (M99) data layer over the workspace SQLite.
//
// Same access pattern as the planner: the shared workspace database via
// window.parallxElectron.database (worker-thread proxied; NEVER touch
// better-sqlite3 on the main process). Migrations live in ./migrations and
// are applied by main.ts on activate.

interface DatabaseBridge {
  isOpen(): Promise<{ isOpen: boolean }>;
  migrate(dir: string): Promise<{ error: { code: string; message: string } | null }>;
  run(sql: string, params?: unknown[]): Promise<{ error: { message: string } | null; lastInsertRowid?: number | bigint }>;
  get(sql: string, params?: unknown[]): Promise<{ error: { message: string } | null; row?: Record<string, unknown> | null }>;
  all(sql: string, params?: unknown[]): Promise<{ error: { message: string } | null; rows?: Record<string, unknown>[] }>;
}

/** Injected at activation: the IDatabaseService tool bridge, so writes
 *  land on the unified data stream. Raw preload bridge stays as the
 *  fallback (tests, pre-DI activation). */
let _attachedDb: DatabaseBridge | undefined;
export function attachWorksheetDatabase(bridge: DatabaseBridge): void {
  _attachedDb = bridge;
}

function db(): DatabaseBridge {
  if (_attachedDb) return _attachedDb;
  const electron = (window as { parallxElectron?: { database?: DatabaseBridge } }).parallxElectron;
  if (!electron?.database) throw new Error('[WorksheetData] window.parallxElectron.database not available');
  return electron.database;
}

async function run(sql: string, params: unknown[] = []): Promise<{ lastInsertRowid?: number | bigint }> {
  const res = await db().run(sql, params);
  if (res.error) throw new Error(`[WorksheetData] ${res.error.message}`);
  return res;
}

async function getRow(sql: string, params: unknown[] = []): Promise<Record<string, unknown> | null> {
  const res = await db().get(sql, params);
  if (res.error) throw new Error(`[WorksheetData] ${res.error.message}`);
  return res.row ?? null;
}

async function allRows(sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
  const res = await db().all(sql, params);
  if (res.error) throw new Error(`[WorksheetData] ${res.error.message}`);
  return res.rows ?? [];
}

// ── Change events ───────────────────────────────────────────────────────────

const _listeners = new Set<() => void>();

export function onWorksheetDataChanged(listener: () => void): { dispose(): void } {
  _listeners.add(listener);
  return { dispose: () => { _listeners.delete(listener); } };
}

function emitChange(): void {
  for (const fn of _listeners) { try { fn(); } catch { /* listener error is not our problem */ } }
}

// ── Items ───────────────────────────────────────────────────────────────────

export interface WorksheetItem {
  readonly id: number;
  readonly title: string;
  readonly questionMd: string;
  readonly givensJson: string;
  readonly solutionJson: string;
  readonly solutionNotesMd: string;
  readonly sourceUri: string;
  readonly sourceLabel: string;
  readonly sourcePage: number;
  readonly tags: string;
  readonly createdAt: number;
  // Problem Bank (docs/PROBLEM_BANK.md): one sheet per problem, as it was.
  /** The whole sheet, solution included; '' for legacy givens/solution items. */
  readonly sheetJson: string;
  /** First column of the worked solution, hidden until reveal; -1 = none. */
  readonly solutionCol: number;
  /** The "SHOW ALL WORK" row; -1 = none. */
  readonly workRow: number;
  readonly paper: string;
  readonly source: string;
  readonly kind: string;
  readonly quadrant: number;
  readonly sheetName: string;
}

export interface WorksheetItemSummary extends Omit<WorksheetItem, 'givensJson' | 'solutionJson' | 'sheetJson'> {
  /** '' = never attempted, 'open' = in progress, else the last self grade (easy | medium | hard, or a legacy value). */
  readonly attemptState: string;
  readonly attemptCount: number;
  /** Seconds spent across completed attempts. */
  readonly seconds: number;
  /** Timestamp of the last completed attempt, 0 when none. */
  readonly lastAttemptAt: number;
  /** True when the item carries a real sheet (Problem Bank model). */
  readonly hasSheet: boolean;
  /** The last grade came from the imported workbook, not from work done here. */
  readonly ratingImported: boolean;
  /** Cells were changed on this problem's sheet at some point: it was worked. */
  readonly worked: boolean;
  /** Starred: the student's bookmark on the problem, kept across quizzes. */
  readonly starred: boolean;
  readonly starredAt: number;
  /** The student's note on the problem (ws_problem_note), empty when none; noteAt is its last edit. */
  readonly note: string;
  readonly noteAt: number;
}

function rowToItem(row: Record<string, unknown>): WorksheetItem {
  return {
    id: Number(row.id),
    title: String(row.title ?? ''),
    questionMd: String(row.question_md ?? ''),
    givensJson: String(row.givens_json ?? ''),
    solutionJson: String(row.solution_json ?? ''),
    solutionNotesMd: String(row.solution_notes_md ?? ''),
    sourceUri: String(row.source_uri ?? ''),
    sourceLabel: String(row.source_label ?? ''),
    sourcePage: Number(row.source_page ?? 0),
    tags: String(row.tags ?? ''),
    createdAt: Number(row.created_at ?? 0),
    sheetJson: String(row.sheet_json ?? ''),
    solutionCol: Number(row.solution_col ?? -1),
    workRow: Number(row.work_row ?? -1),
    paper: String(row.paper ?? ''),
    source: String(row.source ?? ''),
    kind: String(row.kind ?? ''),
    quadrant: Number(row.quadrant ?? 0),
    sheetName: String(row.sheet_name ?? ''),
  };
}

export async function listItems(): Promise<WorksheetItemSummary[]> {
  const rows = await allRows(`
    SELECT i.id, i.title, i.question_md, i.solution_notes_md, i.source_uri,
           i.source_label, i.source_page, i.tags, i.created_at,
           i.solution_col, i.work_row, i.paper, i.source, i.kind, i.quadrant, i.sheet_name,
           (i.sheet_json != '') AS has_sheet,
           (SELECT COUNT(*) FROM ws_attempts a WHERE a.item_id = i.id AND a.completed = 1) AS done_count,
           (SELECT a.self_grade FROM ws_attempts a WHERE a.item_id = i.id AND a.completed = 1
             ORDER BY a.updated_at DESC LIMIT 1) AS last_grade,
           (SELECT a.imported FROM ws_attempts a WHERE a.item_id = i.id AND a.completed = 1
             ORDER BY a.updated_at DESC LIMIT 1) AS last_grade_imported,
           (SELECT MAX(a.worked_at) FROM ws_attempts a WHERE a.item_id = i.id) AS worked_at,
           (SELECT MAX(a.updated_at) FROM ws_attempts a WHERE a.item_id = i.id AND a.completed = 1) AS last_at,
           (SELECT COALESCE(SUM(t.seconds), 0) FROM ws_study_time t WHERE t.item_id = i.id) AS seconds,
           EXISTS(SELECT 1 FROM ws_attempts a WHERE a.item_id = i.id AND a.completed = 0
             AND a.cells_json != '') AS has_open,
           (SELECT s.starred_at FROM ws_star s WHERE s.item_id = i.id) AS starred_at,
           (SELECT n.note FROM ws_problem_note n WHERE n.item_id = i.id) AS note,
           (SELECT n.updated_at FROM ws_problem_note n WHERE n.item_id = i.id) AS note_at
    FROM ws_items i ORDER BY i.paper, i.sheet_name, i.created_at DESC
  `);
  return rows.map((row) => {
    const base = rowToItem(row);
    const doneCount = Number(row.done_count ?? 0);
    // The rating outlives later edits: a rated problem being worked on again stays rated in the bank.
    const lastGrade = String(row.last_grade ?? '');
    const attemptState = lastGrade || (row.has_open ? 'open' : '');
    return {
      id: base.id, title: base.title, questionMd: base.questionMd,
      solutionNotesMd: base.solutionNotesMd, sourceUri: base.sourceUri,
      sourceLabel: base.sourceLabel, sourcePage: base.sourcePage,
      tags: base.tags, createdAt: base.createdAt,
      solutionCol: base.solutionCol, workRow: base.workRow, paper: base.paper, source: base.source,
      kind: base.kind, quadrant: base.quadrant, sheetName: base.sheetName,
      attemptState, attemptCount: doneCount,
      seconds: Number(row.seconds ?? 0),
      lastAttemptAt: Number(row.last_at ?? 0),
      hasSheet: !!row.has_sheet,
      ratingImported: !!lastGrade && !!row.last_grade_imported,
      worked: Number(row.worked_at ?? 0) > 0,
      starred: Number(row.starred_at ?? 0) > 0,
      starredAt: Number(row.starred_at ?? 0),
      note: String(row.note ?? ''),
      noteAt: Number(row.note_at ?? 0),
    };
  });
}

/** Has this workbook sheet been imported before? (source label + sheet name.) */
export async function findItemBySheet(sourceLabel: string, sheetName: string): Promise<number | null> {
  const row = await getRow('SELECT id FROM ws_items WHERE source_label = ? AND sheet_name = ? LIMIT 1', [sourceLabel, sheetName]);
  return row ? Number(row.id) : null;
}

export async function getItem(id: number): Promise<WorksheetItem | null> {
  const row = await getRow('SELECT * FROM ws_items WHERE id = ?', [id]);
  return row ? rowToItem(row) : null;
}

/** Loose title lookup for the chat tools ("the Brosius item"). Most recent wins. */
export async function findItemByTitle(query: string): Promise<WorksheetItem | null> {
  const q = query.trim();
  if (!q) return null;
  const row = await getRow(
    'SELECT * FROM ws_items WHERE title LIKE ? ORDER BY created_at DESC LIMIT 1',
    [`%${q.replace(/[%_]/g, '')}%`],
  );
  return row ? rowToItem(row) : null;
}

export interface CreateItemInput {
  title: string;
  questionMd?: string;
  givensJson?: string;
  solutionJson?: string;
  solutionNotesMd?: string;
  sourceUri?: string;
  sourceLabel?: string;
  sourcePage?: number;
  tags?: string;
  sheetJson?: string;
  solutionCol?: number;
  workRow?: number;
  paper?: string;
  source?: string;
  kind?: string;
  quadrant?: number;
  sheetName?: string;
}

export async function createItem(input: CreateItemInput): Promise<number | null> {
  const res = await run(`
    INSERT INTO ws_items (title, question_md, givens_json, solution_json,
      solution_notes_md, source_uri, source_label, source_page, tags, created_at,
      sheet_json, solution_col, work_row, paper, source, kind, quadrant, sheet_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    input.title.trim(),
    input.questionMd ?? '',
    input.givensJson ?? '',
    input.solutionJson ?? '',
    input.solutionNotesMd ?? '',
    input.sourceUri ?? '',
    input.sourceLabel ?? '',
    Number.isInteger(input.sourcePage) && (input.sourcePage as number) > 0 ? (input.sourcePage as number) : 0,
    input.tags ?? '',
    Date.now(),
    input.sheetJson ?? '',
    Number.isInteger(input.solutionCol) ? (input.solutionCol as number) : -1,
    Number.isInteger(input.workRow) ? (input.workRow as number) : -1,
    input.paper ?? '',
    input.source ?? '',
    input.kind ?? '',
    Number.isInteger(input.quadrant) ? (input.quadrant as number) : 0,
    input.sheetName ?? '',
  ]);
  emitChange();
  return res.lastInsertRowid !== undefined ? Number(res.lastInsertRowid) : null;
}

export async function deleteItem(id: number): Promise<void> {
  await run('DELETE FROM ws_attempts WHERE item_id = ?', [id]);
  await run('DELETE FROM ws_star WHERE item_id = ?', [id]);
  await run('DELETE FROM ws_items WHERE id = ?', [id]);
  emitChange();
}

// ── Attempts ────────────────────────────────────────────────────────────────

export interface WorksheetAttempt {
  readonly id: number;
  readonly itemId: number;
  readonly startedAt: number;
  readonly updatedAt: number;
  readonly cellsJson: string;
  readonly selfGrade: string;
  readonly aiReviewMd: string;
  readonly completed: boolean;
  readonly seconds: number;
  readonly sessionId: string;
  /** The grade came from the workbook's own self-rating, not from work done here. */
  readonly imported: boolean;
  /** When a cell on the sheet was first changed (0 = never): the student worked this problem, rated or not. */
  readonly workedAt: number;
}

function rowToAttempt(row: Record<string, unknown>): WorksheetAttempt {
  return {
    id: Number(row.id),
    itemId: Number(row.item_id),
    startedAt: Number(row.started_at ?? 0),
    updatedAt: Number(row.updated_at ?? 0),
    cellsJson: String(row.cells_json ?? ''),
    selfGrade: String(row.self_grade ?? ''),
    aiReviewMd: String(row.ai_review_md ?? ''),
    completed: !!row.completed,
    seconds: Number(row.seconds ?? 0),
    sessionId: String(row.session_id ?? ''),
    imported: !!row.imported,
    workedAt: Number(row.worked_at ?? 0),
  };
}

/** The single in-progress attempt for an item, when one exists. */
export async function getOpenAttempt(itemId: number): Promise<WorksheetAttempt | null> {
  const row = await getRow(
    'SELECT * FROM ws_attempts WHERE item_id = ? AND completed = 0 ORDER BY started_at DESC LIMIT 1',
    [itemId],
  );
  return row ? rowToAttempt(row) : null;
}

/**
 * The newest attempt that holds work, open or completed. A rating completes
 * the attempt but the sheet is still his work; the problem tab reopens on it
 * rather than on the pristine sheet. Imported ratings carry no cells and are
 * never returned.
 */
export async function getLatestWork(itemId: number): Promise<WorksheetAttempt | null> {
  const row = await getRow(
    "SELECT * FROM ws_attempts WHERE item_id = ? AND imported = 0 AND cells_json != '' ORDER BY updated_at DESC LIMIT 1",
    [itemId],
  );
  return row ? rowToAttempt(row) : null;
}

/** The newest attempt for an item, open OR completed (chat-tool reads). */
export async function getLatestAttempt(itemId: number): Promise<WorksheetAttempt | null> {
  const row = await getRow(
    'SELECT * FROM ws_attempts WHERE item_id = ? ORDER BY updated_at DESC LIMIT 1',
    [itemId],
  );
  return row ? rowToAttempt(row) : null;
}

/** Upsert the open attempt's working cells (autosave path — no change event).
 *  `seconds`, when given, is the running time on the attempt so far. */
export async function saveAttemptCells(itemId: number, cellsJson: string, seconds?: number): Promise<void> {
  const now = Date.now();
  const open = await getOpenAttempt(itemId);
  const secs = Number.isFinite(seconds) ? Math.max(0, Math.round(seconds as number)) : null;
  if (open) {
    if (secs === null) await run('UPDATE ws_attempts SET cells_json = ?, updated_at = ? WHERE id = ?', [cellsJson, now, open.id]);
    else await run('UPDATE ws_attempts SET cells_json = ?, updated_at = ?, seconds = ? WHERE id = ?', [cellsJson, now, secs, open.id]);
  } else {
    await run(
      'INSERT INTO ws_attempts (item_id, started_at, updated_at, cells_json, seconds) VALUES (?, ?, ?, ?, ?)',
      [itemId, now, now, cellsJson, secs ?? 0],
    );
  }
}

/**
 * The student changed a cell on this problem's sheet. That is the campaign's
 * proof of work, independent of the rating: a problem that arrives carrying
 * its workbook rating still counts for the day once it has been worked.
 * Marked once per attempt; the announce keeps the dashboard honest live.
 */
export async function markAttemptWorked(itemId: number, seconds?: number): Promise<void> {
  const now = Date.now();
  const secs = Number.isFinite(seconds) ? Math.max(0, Math.round(seconds as number)) : 0;
  const open = await getOpenAttempt(itemId);
  if (open) {
    if (open.workedAt > 0) return;
    await run('UPDATE ws_attempts SET worked_at = ?, updated_at = ? WHERE id = ?', [now, now, open.id]);
  } else {
    await run(
      'INSERT INTO ws_attempts (item_id, started_at, updated_at, cells_json, seconds, worked_at) VALUES (?, ?, ?, ?, ?, ?)',
      [itemId, now, now, '', secs, now],
    );
  }
  emitChange();
}

/** Reset Sheet: discard the open attempt's work entirely. */
export async function discardOpenAttempt(itemId: number): Promise<void> {
  await run('DELETE FROM ws_attempts WHERE item_id = ? AND completed = 0', [itemId]);
  emitChange();
}

export interface CompleteAttemptOptions {
  readonly seconds?: number;
  readonly sessionId?: string;
}
/** Close the open attempt with a self grade (reveal flow). */
export async function completeAttempt(itemId: number, selfGrade: string, cellsJson: string, opts: CompleteAttemptOptions = {}): Promise<void> {
  const now = Date.now();
  const open = await getOpenAttempt(itemId);
  const secs = Number.isFinite(opts.seconds) ? Math.max(0, Math.round(opts.seconds as number)) : null;
  const sessionId = opts.sessionId ?? '';
  if (open) {
    await run(
      'UPDATE ws_attempts SET cells_json = ?, self_grade = ?, completed = 1, updated_at = ?, seconds = COALESCE(?, seconds), session_id = CASE WHEN ? != \'\' THEN ? ELSE session_id END WHERE id = ?',
      [cellsJson, selfGrade, now, secs, sessionId, sessionId, open.id],
    );
  } else {
    await run(
      'INSERT INTO ws_attempts (item_id, started_at, updated_at, cells_json, self_grade, completed, seconds, session_id) VALUES (?, ?, ?, ?, ?, 1, ?, ?)',
      [itemId, now, now, cellsJson, selfGrade, secs ?? 0, sessionId],
    );
  }
  emitChange();
}

/** A rating carried over from the workbook: a completed attempt with no work, dated as given. */
export async function recordImportedRating(itemId: number, selfGrade: string, at: number): Promise<void> {
  await run(
    'INSERT INTO ws_attempts (item_id, started_at, updated_at, cells_json, self_grade, completed, imported) VALUES (?, ?, ?, \'\', ?, 1, 1)',
    [itemId, at, at, selfGrade],
  );
  emitChange();
}

// ── Progress snapshots (dashboard timeline) ──────────────────────────────────

export interface ProgressRow { readonly day: string; readonly attempted: number; readonly score: number; readonly source: string }
export async function listProgressSnapshots(): Promise<ProgressRow[]> {
  const rows = await allRows('SELECT day, attempted, score, source FROM ws_progress ORDER BY day ASC');
  return rows.map((r) => ({ day: String(r.day), attempted: Number(r.attempted ?? 0), score: Number(r.score ?? 0), source: String(r.source ?? 'attempts') }));
}
/** Keep one row per day; the workbook's own history is never overwritten by a derived row. */
export async function upsertProgressSnapshot(day: string, attempted: number, score: number, source: 'workbook' | 'attempts'): Promise<void> {
  await run(
    `INSERT INTO ws_progress (day, attempted, score, source) VALUES (?, ?, ?, ?)
     ON CONFLICT(day) DO UPDATE SET attempted = excluded.attempted, score = excluded.score, source = excluded.source
     WHERE ws_progress.source != 'workbook' OR excluded.source = 'workbook'`,
    [day, attempted, score, source],
  );
}

// ── Campaign (every problem in the bank in N days) ───────────────────────────

export interface CampaignRow { readonly startDay: string; readonly days: number; readonly dailyTarget: number; readonly startedAt: number; readonly restDays: readonly number[] }
function parseRestDays(raw: unknown): number[] {
  try {
    const parsed = JSON.parse(String(raw ?? '[]'));
    return Array.isArray(parsed) ? parsed.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6) : [];
  } catch { return []; }
}
export async function getCampaign(): Promise<CampaignRow | null> {
  const row = await getRow('SELECT start_day, days, daily_target, started_at, rest_days FROM ws_campaign WHERE id = 1');
  return row ? { startDay: String(row.start_day), days: Number(row.days), dailyTarget: Number(row.daily_target), startedAt: Number(row.started_at), restDays: parseRestDays(row.rest_days) } : null;
}
/** One campaign at a time; starting a new one forgets the old draws. */
export async function startCampaign(c: CampaignRow): Promise<void> {
  await run(
    `INSERT INTO ws_campaign (id, start_day, days, daily_target, started_at, rest_days) VALUES (1, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET start_day = excluded.start_day, days = excluded.days, daily_target = excluded.daily_target, started_at = excluded.started_at, rest_days = excluded.rest_days`,
    [c.startDay, c.days, c.dailyTarget, c.startedAt, JSON.stringify([...c.restDays])],
  );
  await run('DELETE FROM ws_daily_draw');
  emitChange();
}
export async function endCampaign(): Promise<void> {
  await run('DELETE FROM ws_campaign');
  await run('DELETE FROM ws_daily_draw');
  emitChange();
}
export async function getDailyDraw(day: string): Promise<number[] | null> {
  const row = await getRow('SELECT item_ids FROM ws_daily_draw WHERE day = ?', [day]);
  if (!row) return null;
  try { const ids = JSON.parse(String(row.item_ids)); return Array.isArray(ids) ? ids.map(Number) : null; } catch { return null; }
}
export async function saveDailyDraw(day: string, ids: number[]): Promise<void> {
  await run('INSERT INTO ws_daily_draw (day, item_ids) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET item_ids = excluded.item_ids', [day, JSON.stringify(ids)]);
}

// ── Quiz sessions (saved quizzes: named, resumable, completed only by hand) ──
//
// A quiz is a saved thing (Mufaro, 2026-09-17): it has a name, several may
// be open at once, and nothing finishes it except Complete Quiz on its
// summary. Rating every problem, reaching the last one, or starting another
// quiz never closes it; that is what lost him a campaign quiz to "review".
// touched_at is the last save, so the most recently used open quiz is the
// one the Dashboard offers to resume.

export interface QuizSessionRow {
  readonly id: string;
  readonly name: string;
  readonly itemIds: number[];
  readonly position: number;
  readonly skipped: number[];
  /** Mark For Later: problems flagged inside this quiz to come back to (migration 011). Only the student clears one. */
  readonly marked: number[];
  readonly startedAt: number;
  readonly touchedAt: number;
  readonly finishedAt: number | null;
}
function parseIdList(raw: unknown): number[] {
  try { const v = JSON.parse(String(raw ?? '[]')); return Array.isArray(v) ? v.map(Number).filter((n) => Number.isFinite(n)) : []; } catch { return []; }
}
function rowToSession(row: Record<string, unknown>): QuizSessionRow {
  return {
    id: String(row.id), name: String(row.name ?? ''), itemIds: parseIdList(row.item_ids), position: Number(row.position ?? 0), skipped: parseIdList(row.skipped), marked: parseIdList(row.marked),
    startedAt: Number(row.started_at), touchedAt: Number(row.touched_at ?? row.started_at), finishedAt: row.finished_at == null ? null : Number(row.finished_at),
  };
}
const SESSION_COLS = 'id, name, item_ids, position, skipped, marked, started_at, touched_at, finished_at';
const LAST_USED = 'COALESCE(touched_at, started_at) DESC';
/** The open quiz used most recently: what Resume Quiz means. */
export async function getOpenQuizSession(): Promise<QuizSessionRow | null> {
  const row = await getRow(`SELECT ${SESSION_COLS} FROM ws_quiz_session WHERE finished_at IS NULL ORDER BY ${LAST_USED} LIMIT 1`);
  return row ? rowToSession(row) : null;
}
export async function getQuizSession(id: string): Promise<QuizSessionRow | null> {
  const row = await getRow(`SELECT ${SESSION_COLS} FROM ws_quiz_session WHERE id = ?`, [id]);
  return row ? rowToSession(row) : null;
}
/** Every quiz: the open ones first, then the completed ones, each by last use. */
export async function listQuizSessions(limit = 12): Promise<QuizSessionRow[]> {
  const rows = await allRows(`SELECT ${SESSION_COLS} FROM ws_quiz_session ORDER BY (finished_at IS NULL) DESC, ${LAST_USED} LIMIT ?`, [limit]);
  return rows.map(rowToSession).filter((s) => s.itemIds.length > 0);
}
export async function countFinishedQuizSessions(): Promise<number> {
  const row = await getRow('SELECT count(*) AS n FROM ws_quiz_session WHERE finished_at IS NOT NULL');
  return Number(row?.n ?? 0);
}
/** Upsert; every save is a touch. `announce` tells open panes (the Dashboard's Resume Quiz) when a quiz begins. */
export async function saveQuizSession(s: Omit<QuizSessionRow, 'touchedAt'>, announce = false): Promise<void> {
  await run(
    `INSERT INTO ws_quiz_session (id, name, item_ids, position, skipped, marked, started_at, touched_at, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, item_ids = excluded.item_ids, position = excluded.position, skipped = excluded.skipped, marked = excluded.marked, touched_at = excluded.touched_at, finished_at = excluded.finished_at`,
    [s.id, s.name, JSON.stringify(s.itemIds), s.position, JSON.stringify(s.skipped), JSON.stringify(s.marked), s.startedAt, Date.now(), s.finishedAt],
  );
  if (announce) emitChange();
}
export async function renameQuizSession(id: string, name: string): Promise<void> {
  await run('UPDATE ws_quiz_session SET name = ?, touched_at = ? WHERE id = ?', [name, Date.now(), id]);
  emitChange();
}
/** Complete Quiz: the one and only way a quiz finishes. */
export async function finishQuizSession(id: string): Promise<void> {
  await run('UPDATE ws_quiz_session SET finished_at = ?, touched_at = ? WHERE id = ? AND finished_at IS NULL', [Date.now(), Date.now(), id]);
  emitChange();
}
/** Reopen Quiz: a completed quiz goes back to open, where it was. */
export async function reopenQuizSession(id: string): Promise<void> {
  await run('UPDATE ws_quiz_session SET finished_at = NULL, touched_at = ? WHERE id = ?', [Date.now(), id]);
  emitChange();
}
/** Delete Quiz: the quiz goes; the ratings it produced stay on the problems. */
export async function deleteQuizSession(id: string): Promise<void> {
  await run('DELETE FROM ws_quiz_session WHERE id = ?', [id]);
  emitChange();
}

/**
 * Every attempt that is evidence of work, newest first: the completed ones,
 * which carry a rating, and the open ones a cell was changed on. The
 * campaign credits either; the score and the timeline read ratings only, so
 * a worked-but-unrated row is invisible to them.
 */
export async function listAttemptHistory(): Promise<{ itemId: number; selfGrade: string; at: number; seconds: number; sessionId: string; imported: boolean; workedAt: number }[]> {
  const rows = await allRows('SELECT item_id, self_grade, updated_at, seconds, session_id, imported, worked_at FROM ws_attempts WHERE completed = 1 OR worked_at > 0 ORDER BY updated_at DESC');
  return rows.map((r) => ({ itemId: Number(r.item_id), selfGrade: String(r.self_grade ?? ''), at: Number(r.updated_at ?? 0), seconds: Number(r.seconds ?? 0), sessionId: String(r.session_id ?? ''), imported: !!r.imported, workedAt: Number(r.worked_at ?? 0) }));
}

/** Grades earned on the given items since a timestamp (practice-session
 *  summaries). Later grades on the same item win. */
/** What happened to each problem since a quiz began: the latest rating, whether any work was saved, time spent. */
export interface SessionItemState {
  readonly itemId: number;
  readonly grade: string;
  /** Cells were saved since the quiz began (a Reveal Solution saves too). */
  readonly attempted: boolean;
  /** A cell was changed since the quiz began: the work the campaign counts. */
  readonly worked: boolean;
  readonly seconds: number;
}
export async function getSessionItemStates(itemIds: number[], sinceMs: number, sessionId = ''): Promise<Map<number, SessionItemState>> {
  const map = new Map<number, SessionItemState>();
  if (itemIds.length === 0) return map;
  // Time comes from the study ledger when the quiz is known: what the clock
  // counted on each problem inside this quiz, whatever the cells did.
  const study = sessionId ? await getStudySecondsBySession(sessionId).catch(() => new Map<number, number>()) : null;
  const ph = itemIds.map(() => '?').join(',');
  const rows = await allRows(
    `SELECT item_id, self_grade, completed, seconds, worked_at, length(cells_json) AS len FROM ws_attempts
     WHERE updated_at >= ? AND item_id IN (${ph}) ORDER BY updated_at ASC`,
    [sinceMs, ...itemIds],
  );
  for (const r of rows) {
    const id = Number(r.item_id);
    const prev = map.get(id) ?? { itemId: id, grade: '', attempted: false, worked: false, seconds: 0 };
    const grade = Number(r.completed) === 1 && String(r.self_grade ?? '') !== '' ? String(r.self_grade) : prev.grade;
    map.set(id, {
      itemId: id, grade,
      attempted: prev.attempted || Number(r.len ?? 0) > 2 || Number(r.completed) === 1,
      worked: prev.worked || Number(r.worked_at ?? 0) >= sinceMs,
      seconds: study ? (study.get(id) ?? 0) : prev.seconds + Number(r.seconds ?? 0),
    });
  }
  return map;
}

// ── Study time (ws_study_time, migration 012) ──────────────────────────────
// Seconds with a problem (or the quiz's own screens, item 0) on screen while
// the student is active, per day and per quiz. The clock writes them whatever
// the cells do and takes idle stretches back, so a delta may be negative.

export async function addStudySeconds(day: string, itemId: number, sessionId: string, seconds: number, announce = false): Promise<void> {
  const delta = Math.round(seconds);
  if (delta !== 0) {
    await run(
      `INSERT INTO ws_study_time (day, item_id, session_id, seconds) VALUES (?, ?, ?, MAX(0, ?))
       ON CONFLICT(day, item_id, session_id) DO UPDATE SET seconds = MAX(0, seconds + ?)`,
      [day, itemId, sessionId, delta, delta],
    );
  }
  if (announce) emitChange();
}
/** Every day's study seconds, problems and quiz screens together. */
export async function getStudySecondsByDay(): Promise<Map<string, number>> {
  const rows = await allRows('SELECT day, SUM(seconds) AS s FROM ws_study_time GROUP BY day');
  return new Map(rows.map((r) => [String(r.day), Number(r.s ?? 0)]));
}
/** Study seconds on one problem, every sitting. */
export async function getStudySecondsForItem(itemId: number): Promise<number> {
  const row = await getRow('SELECT COALESCE(SUM(seconds), 0) AS s FROM ws_study_time WHERE item_id = ?', [itemId]);
  return Number(row?.s ?? 0);
}
/** Study seconds per problem inside one quiz (item 0 is the quiz's own screens). */
export async function getStudySecondsBySession(sessionId: string): Promise<Map<number, number>> {
  const rows = await allRows('SELECT item_id, SUM(seconds) AS s FROM ws_study_time WHERE session_id = ? GROUP BY item_id', [sessionId]);
  return new Map(rows.map((r) => [Number(r.item_id), Number(r.s ?? 0)]));
}

/** Notes: one per problem, kept across quizzes. */
export async function getProblemNotes(itemIds: number[]): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  if (itemIds.length === 0) return map;
  const ph = itemIds.map(() => '?').join(',');
  const rows = await allRows(`SELECT item_id, note FROM ws_problem_note WHERE item_id IN (${ph})`, itemIds);
  for (const r of rows) map.set(Number(r.item_id), String(r.note ?? ''));
  return map;
}
export async function setProblemNote(itemId: number, note: string): Promise<void> {
  if (note.trim() === '') await run('DELETE FROM ws_problem_note WHERE item_id = ?', [itemId]);
  else await run('INSERT INTO ws_problem_note (item_id, note, updated_at) VALUES (?, ?, ?) ON CONFLICT(item_id) DO UPDATE SET note = excluded.note, updated_at = excluded.updated_at', [itemId, note, Date.now()]);
}

/** Stars: the student's bookmark on a problem, set from its sheet, the quiz
 *  overview or the bank, and kept across quizzes. Every pane listens, so a
 *  star set on the sheet shows in the bank and on the Dashboard at once. */
export async function setItemStarred(itemId: number, starred: boolean): Promise<void> {
  if (starred) await run('INSERT OR IGNORE INTO ws_star (item_id, starred_at) VALUES (?, ?)', [itemId, Date.now()]);
  else await run('DELETE FROM ws_star WHERE item_id = ?', [itemId]);
  emitChange();
}
export async function getStarred(itemIds: number[]): Promise<Set<number>> {
  if (itemIds.length === 0) return new Set();
  const ph = itemIds.map(() => '?').join(',');
  const rows = await allRows(`SELECT item_id FROM ws_star WHERE item_id IN (${ph})`, itemIds);
  return new Set(rows.map((r) => Number(r.item_id)));
}

/** Rewards: id to the time first earned. */
export async function listRewardUnlocks(): Promise<Map<string, number>> {
  const rows = await allRows('SELECT id, unlocked_at FROM ws_reward');
  return new Map(rows.map((r) => [String(r.id), Number(r.unlocked_at)]));
}
export async function unlockRewards(ids: string[], at: number = Date.now()): Promise<void> {
  for (const id of ids) await run('INSERT OR IGNORE INTO ws_reward (id, unlocked_at) VALUES (?, ?)', [id, at]);
  if (ids.length) emitChange();
}

export async function getSessionGrades(
  itemIds: number[],
  sinceMs: number,
  sessionId = '',
  untilMs: number | null = null,
): Promise<Map<number, string>> {
  if (itemIds.length === 0) return new Map();
  const ph = itemIds.map(() => '?').join(',');
  // A rating belongs to this quiz when it carries the quiz id, or when it was
  // made outside any quiz while this one was open. The start time alone used to
  // decide it, with no end: a later quiz's ratings then counted for every
  // earlier quiz, and a rating made minutes before a quiz opened counted for
  // none. Imported workbook ratings are never a quiz's own work.
  const scoped: string[] = [];
  const params: (string | number)[] = [];
  if (sessionId) {
    scoped.push('session_id = ?');
    params.push(sessionId);
    const win = ["session_id = ''", 'imported = 0', 'updated_at >= ?'];
    params.push(sinceMs);
    if (untilMs) { win.push('updated_at <= ?'); params.push(untilMs); }
    scoped.push(`(${win.join(' AND ')})`);
  } else {
    const win = ['updated_at >= ?'];
    params.push(sinceMs);
    if (untilMs) { win.push('updated_at <= ?'); params.push(untilMs); }
    scoped.push(`(${win.join(' AND ')})`);
  }
  const rows = await allRows(
    `SELECT item_id, self_grade FROM ws_attempts
     WHERE completed = 1 AND self_grade != '' AND (${scoped.join(' OR ')}) AND item_id IN (${ph})
     ORDER BY updated_at ASC`,
    [...params, ...itemIds],
  );
  const map = new Map<number, string>();
  for (const r of rows) map.set(Number(r.item_id), String(r.self_grade));
  return map;
}

/** Attach an AI critique to the most recent attempt (open or closed). */
export async function saveAttemptReview(itemId: number, aiReviewMd: string): Promise<void> {
  const row = await getRow(
    'SELECT id FROM ws_attempts WHERE item_id = ? ORDER BY updated_at DESC LIMIT 1',
    [itemId],
  );
  if (!row) return;
  await run('UPDATE ws_attempts SET ai_review_md = ?, updated_at = ? WHERE id = ?', [aiReviewMd, Date.now(), Number(row.id)]);
  emitChange();
}
