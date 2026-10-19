// rosterData.ts — Worksheets: the roster's rows (roster.ts, worksheet_018).
import { allRows, getRow, notifyWorksheetDataChanged, run } from './worksheetData.js';
import type { RosterSpec, StarChange } from './roster.js';

/** The roster, or null when none is set. */
export async function getRoster(): Promise<RosterSpec | null> {
  const r = await getRow('SELECT tag, start_day, end_day FROM ws_roster WHERE id = 1');
  if (!r || !String(r.tag ?? '').trim()) return null;
  return { tag: String(r.tag), startDay: String(r.start_day), endDay: String(r.end_day) };
}

export async function saveRoster(spec: RosterSpec): Promise<void> {
  await run(
    'INSERT INTO ws_roster (id, tag, start_day, end_day, created_at) VALUES (1, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET tag = excluded.tag, start_day = excluded.start_day, end_day = excluded.end_day',
    [spec.tag.trim(), spec.startDay, spec.endDay, Date.now()],
  );
  notifyWorksheetDataChanged();
}

/** Ends the roster. Its quizzes, stars and the star log stay. */
export async function clearRoster(): Promise<void> {
  await run('DELETE FROM ws_roster');
  notifyWorksheetDataChanged();
}

export async function listStarChanges(sinceMs = 0): Promise<StarChange[]> {
  const rows = await allRows('SELECT item_id, starred, at FROM ws_star_log WHERE at >= ? ORDER BY at', [sinceMs]);
  return rows.map((r) => ({ itemId: Number(r.item_id), starred: Number(r.starred) === 1, at: Number(r.at) }));
}
