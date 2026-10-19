// tagData.ts — Worksheets: the tags the student puts on problems (worksheet_019).
import { allRows, notifyWorksheetDataChanged, run } from './worksheetData.js';

/** One way to write a tag: lower case, words joined by hyphens, no commas. "Final Roster" is final-roster. */
export function normalizeTag(raw: string): string {
  return raw.trim().toLowerCase().replace(/[,\s]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

export async function listItemTags(itemId: number): Promise<string[]> {
  const rows = await allRows('SELECT tag FROM ws_item_tag WHERE item_id = ? ORDER BY added_at', [itemId]);
  return rows.map((r) => String(r.tag));
}

/** Every tag in use, the most used first. */
export async function listAllItemTags(): Promise<{ tag: string; count: number }[]> {
  const rows = await allRows('SELECT tag, COUNT(*) AS n FROM ws_item_tag GROUP BY tag ORDER BY n DESC, tag');
  return rows.map((r) => ({ tag: String(r.tag), count: Number(r.n) }));
}

export async function addItemTag(itemId: number, raw: string): Promise<void> {
  const tag = normalizeTag(raw);
  if (!tag || !Number.isFinite(itemId)) return;
  await run('INSERT OR IGNORE INTO ws_item_tag (item_id, tag, added_at) VALUES (?, ?, ?)', [itemId, tag, Date.now()]);
  notifyWorksheetDataChanged();
}

export async function removeItemTag(itemId: number, tag: string): Promise<void> {
  await run('DELETE FROM ws_item_tag WHERE item_id = ? AND tag = ?', [itemId, tag]);
  notifyWorksheetDataChanged();
}
