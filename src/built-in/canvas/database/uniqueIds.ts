// uniqueIds.ts — the ID property: a number no other row of the database has.
//
// A new row takes the next number for every ID column; a new ID column
// numbers the rows that exist, in their order. Numbers are never reused,
// so a deleted row leaves a gap, as Notion's do.

import type { DatabaseDataService } from './databaseDataService.js';
import type { IDatabaseProperty } from './databaseTypes.js';

async function maxId(db: DatabaseDataService, databaseId: string, propertyId: string): Promise<number> {
  const res = await db.bridge.get(
    'SELECT MAX(CAST(value AS INTEGER)) AS m FROM page_property_values WHERE database_id = ? AND property_id = ?',
    [databaseId, propertyId],
  );
  const m = res.row?.m;
  return typeof m === 'number' && Number.isFinite(m) ? m : 0;
}

/** The ID values a new row starts with: the next number for each ID column. */
export async function nextUniqueIds(db: DatabaseDataService, databaseId: string, props: readonly IDatabaseProperty[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const p of props) if (p.type === 'unique_id') out[p.id] = (await maxId(db, databaseId, p.id)) + 1;
  return out;
}

/** Number the rows that have no ID yet, in the database's order. Returns how many were numbered. */
export async function backfillUniqueIds(db: DatabaseDataService, databaseId: string, propertyId: string): Promise<number> {
  const rows = await db.listRows(databaseId);
  let next = await maxId(db, databaseId, propertyId);
  const ops: { type: 'run'; sql: string; params: unknown[] }[] = [];
  for (const row of rows) {
    const v = row.values[propertyId];
    if (typeof v === 'number') continue;
    next += 1;
    ops.push({
      type: 'run',
      sql: `INSERT INTO page_property_values (page_id, property_id, database_id, value, updated_at) VALUES (?, ?, ?, ?, datetime('now'))
            ON CONFLICT(page_id, property_id, database_id) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
      params: [row.pageId, propertyId, databaseId, JSON.stringify(next)],
    });
  }
  if (ops.length === 0) return 0;
  const res = await db.bridge.runTransaction(ops);
  if (res.error) throw new Error(res.error.message);
  db.notifyRowsChanged(databaseId);
  return ops.length;
}
