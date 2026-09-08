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
           (SELECT MAX(a.updated_at) FROM ws_attempts a WHERE a.item_id = i.id AND a.completed = 1) AS last_at,
           (SELECT COALESCE(SUM(a.seconds), 0) FROM ws_attempts a WHERE a.item_id = i.id AND a.completed = 1) AS seconds,
           EXISTS(SELECT 1 FROM ws_attempts a WHERE a.item_id = i.id AND a.completed = 0
             AND a.cells_json != '') AS has_open
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

/** Every completed attempt, newest first, for the dashboard's timeline and score. */
export async function listCompletedAttempts(): Promise<{ itemId: number; selfGrade: string; at: number; seconds: number; sessionId: string; imported: boolean }[]> {
  const rows = await allRows('SELECT item_id, self_grade, updated_at, seconds, session_id, imported FROM ws_attempts WHERE completed = 1 ORDER BY updated_at DESC');
  return rows.map((r) => ({ itemId: Number(r.item_id), selfGrade: String(r.self_grade ?? ''), at: Number(r.updated_at ?? 0), seconds: Number(r.seconds ?? 0), sessionId: String(r.session_id ?? ''), imported: !!r.imported }));
}

/** Grades earned on the given items since a timestamp (practice-session
 *  summaries). Later grades on the same item win. */
export async function getSessionGrades(itemIds: number[], sinceMs: number): Promise<Map<number, string>> {
  if (itemIds.length === 0) return new Map();
  const ph = itemIds.map(() => '?').join(',');
  const rows = await allRows(
    `SELECT item_id, self_grade FROM ws_attempts
     WHERE completed = 1 AND self_grade != '' AND updated_at >= ? AND item_id IN (${ph})
     ORDER BY updated_at ASC`,
    [sinceMs, ...itemIds],
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
