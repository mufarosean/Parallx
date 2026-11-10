// relations.ts — relation properties (docs/DATABASES.md step 5).
//
// A relation cell holds the page ids of rows in another database. A synced
// relation has a mirror property in that database, and a write on either
// side keeps the other true. The related databases' rows are loaded with
// the pane so relation cells show titles and rollups can read across.

import type { DatabaseDataService } from './databaseDataService.js';
import type { IDatabaseProperty, IDatabaseRow } from './databaseTypes.js';

export interface IRelationConfig {
  readonly databaseId: string;
  readonly synced: boolean;
  /** The mirror property's id in the related database, when synced. */
  readonly syncedWith: string | null;
}

export function relationConfig(prop: Pick<IDatabaseProperty, 'config'>): IRelationConfig {
  const c = prop.config;
  return {
    databaseId: typeof c['databaseId'] === 'string' ? c['databaseId'] : '',
    synced: c['synced'] === true,
    syncedWith: typeof c['syncedWith'] === 'string' && c['syncedWith'] ? c['syncedWith'] : null,
  };
}

/** The page ids a relation value holds (stored ids, or the display objects a derived row carries). */
export function relationIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const v of value) {
    const id = typeof v === 'string' ? v : (v && typeof v === 'object' && typeof (v as { id?: unknown }).id === 'string' ? (v as { id: string }).id : '');
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * Add a relation property to `databaseId` pointing at `targetId`. With
 * `synced`, the target gets a mirror property named after this database,
 * and the two point at each other.
 */
export async function createRelationProperty(db: DatabaseDataService, databaseId: string, name: string, targetId: string, synced: boolean): Promise<IDatabaseProperty> {
  const prop = await db.addProperty(databaseId, name, 'relation', { databaseId: targetId, synced, syncedWith: null });
  if (!synced) return prop;
  const here = await db.getDatabase(databaseId);
  const mirror = await db.addProperty(targetId, here?.title || 'Related', 'relation', { databaseId, synced: true, syncedWith: prop.id });
  await db.updateProperty(databaseId, prop.id, { config: { databaseId: targetId, synced: true, syncedWith: mirror.id } });
  return { ...prop, config: { databaseId: targetId, synced: true, syncedWith: mirror.id } };
}

/**
 * Store a relation cell, and keep the mirror cells true when the relation
 * is synced: pages newly linked gain this page, pages unlinked lose it.
 */
export async function setRelationValue(db: DatabaseDataService, databaseId: string, pageId: string, prop: IDatabaseProperty, value: unknown): Promise<void> {
  const next = relationIds(value);
  const cfg = relationConfig(prop);
  const before = relationIds((await db.getRowValues(databaseId, pageId))[prop.id]);
  await db.setCellValue(databaseId, pageId, prop.id, next);
  if (!cfg.synced || !cfg.syncedWith || !cfg.databaseId) return;
  const added = next.filter((id) => !before.includes(id));
  const removed = before.filter((id) => !next.includes(id));
  for (const other of [...added, ...removed]) {
    const theirs = relationIds((await db.getRowValues(cfg.databaseId, other))[cfg.syncedWith]);
    const mine = added.includes(other) ? (theirs.includes(pageId) ? theirs : [...theirs, pageId]) : theirs.filter((id) => id !== pageId);
    if (mine.length !== theirs.length) await db.setCellValue(cfg.databaseId, other, cfg.syncedWith, mine);
  }
}

export interface IRelatedDatabase { readonly id: string; readonly title: string; readonly props: readonly IDatabaseProperty[]; readonly rows: ReadonlyMap<string, IDatabaseRow> }

/** The databases this database's relations point at, with their rows by page id. */
export async function loadRelatedDatabases(db: DatabaseDataService, props: readonly IDatabaseProperty[]): Promise<Map<string, IRelatedDatabase>> {
  const out = new Map<string, IRelatedDatabase>();
  for (const p of props) {
    if (p.type !== 'relation') continue;
    const { databaseId } = relationConfig(p);
    if (!databaseId || out.has(databaseId)) continue;
    const [info, rprops, rows] = await Promise.all([db.getDatabase(databaseId), db.listProperties(databaseId), db.listRows(databaseId)]);
    if (!info) continue;
    out.set(databaseId, { id: databaseId, title: info.title, props: rprops, rows: new Map(rows.map((r) => [r.pageId, r])) });
  }
  return out;
}
