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
}

export interface WorksheetItemSummary extends Omit<WorksheetItem, 'givensJson' | 'solutionJson'> {
  /** '' = never attempted, 'open' = in progress, else the last self grade. */
  readonly attemptState: string;
  readonly attemptCount: number;
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
  };
}

export async function listItems(): Promise<WorksheetItemSummary[]> {
  const rows = await allRows(`
    SELECT i.id, i.title, i.question_md, i.solution_notes_md, i.source_uri,
           i.source_label, i.source_page, i.tags, i.created_at,
           (SELECT COUNT(*) FROM ws_attempts a WHERE a.item_id = i.id AND a.completed = 1) AS done_count,
           (SELECT a.self_grade FROM ws_attempts a WHERE a.item_id = i.id AND a.completed = 1
             ORDER BY a.updated_at DESC LIMIT 1) AS last_grade,
           EXISTS(SELECT 1 FROM ws_attempts a WHERE a.item_id = i.id AND a.completed = 0
             AND a.cells_json != '') AS has_open
    FROM ws_items i ORDER BY i.created_at DESC
  `);
  return rows.map((row) => {
    const base = rowToItem(row);
    const doneCount = Number(row.done_count ?? 0);
    const attemptState = row.has_open ? 'open' : String(row.last_grade ?? '');
    return {
      id: base.id, title: base.title, questionMd: base.questionMd,
      solutionNotesMd: base.solutionNotesMd, sourceUri: base.sourceUri,
      sourceLabel: base.sourceLabel, sourcePage: base.sourcePage,
      tags: base.tags, createdAt: base.createdAt,
      attemptState, attemptCount: doneCount,
    };
  });
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
}

export async function createItem(input: CreateItemInput): Promise<number | null> {
  const res = await run(`
    INSERT INTO ws_items (title, question_md, givens_json, solution_json,
      solution_notes_md, source_uri, source_label, source_page, tags, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

/** The newest attempt for an item, open OR completed (chat-tool reads). */
export async function getLatestAttempt(itemId: number): Promise<WorksheetAttempt | null> {
  const row = await getRow(
    'SELECT * FROM ws_attempts WHERE item_id = ? ORDER BY updated_at DESC LIMIT 1',
    [itemId],
  );
  return row ? rowToAttempt(row) : null;
}

/** Upsert the open attempt's working cells (autosave path — no change event). */
export async function saveAttemptCells(itemId: number, cellsJson: string): Promise<void> {
  const now = Date.now();
  const open = await getOpenAttempt(itemId);
  if (open) {
    await run('UPDATE ws_attempts SET cells_json = ?, updated_at = ? WHERE id = ?', [cellsJson, now, open.id]);
  } else {
    await run(
      'INSERT INTO ws_attempts (item_id, started_at, updated_at, cells_json) VALUES (?, ?, ?, ?)',
      [itemId, now, now, cellsJson],
    );
  }
}

/** Reset Sheet: discard the open attempt's work entirely. */
export async function discardOpenAttempt(itemId: number): Promise<void> {
  await run('DELETE FROM ws_attempts WHERE item_id = ? AND completed = 0', [itemId]);
  emitChange();
}

/** Close the open attempt with a self grade (reveal flow). */
export async function completeAttempt(itemId: number, selfGrade: string, cellsJson: string): Promise<void> {
  const now = Date.now();
  const open = await getOpenAttempt(itemId);
  if (open) {
    await run(
      'UPDATE ws_attempts SET cells_json = ?, self_grade = ?, completed = 1, updated_at = ? WHERE id = ?',
      [cellsJson, selfGrade, now, open.id],
    );
  } else {
    await run(
      'INSERT INTO ws_attempts (item_id, started_at, updated_at, cells_json, self_grade, completed) VALUES (?, ?, ?, ?, ?, 1)',
      [itemId, now, now, cellsJson, selfGrade],
    );
  }
  emitChange();
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
