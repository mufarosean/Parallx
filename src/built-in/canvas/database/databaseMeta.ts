// databaseMeta.ts — what a database is beyond its rows: its description,
// its lock, and its own settings (templates, in step 7). The page part of
// its identity (title, icon, cover) lives on the pages row and goes through
// the canvas data service like any page's.

import type { DatabaseDataService } from './databaseDataService.js';

export interface IDatabaseConfig {
  /** Row templates: the page ids of template pages, in order. */
  readonly templates: readonly string[];
  /** The template a new row starts from; null = blank. */
  readonly defaultTemplate: string | null;
}

export function readDatabaseConfig(json: string | null | undefined): IDatabaseConfig {
  try {
    const c = JSON.parse(json || '{}') as Record<string, unknown>;
    return {
      templates: Array.isArray(c['templates']) ? (c['templates'] as unknown[]).filter((x): x is string => typeof x === 'string') : [],
      defaultTemplate: typeof c['defaultTemplate'] === 'string' && c['defaultTemplate'] ? c['defaultTemplate'] : null,
    };
  } catch {
    return { templates: [], defaultTemplate: null };
  }
}

export async function getDatabaseConfig(db: DatabaseDataService, databaseId: string): Promise<IDatabaseConfig> {
  const res = await db.bridge.get('SELECT config FROM databases WHERE id = ?', [databaseId]);
  return readDatabaseConfig(res.row ? (res.row.config as string) : null);
}

/** Set a database's description, lock or settings. Open editors reload on the structure event. */
export async function updateDatabaseMeta(
  db: DatabaseDataService,
  databaseId: string,
  patch: { description?: string | null; isLocked?: boolean; config?: Partial<IDatabaseConfig> },
): Promise<void> {
  const sets: string[] = []; const params: unknown[] = [];
  if (patch.description !== undefined) { sets.push('description = ?'); params.push(patch.description === '' ? null : patch.description); }
  if (patch.isLocked !== undefined) { sets.push('is_locked = ?'); params.push(patch.isLocked ? 1 : 0); }
  if (patch.config !== undefined) {
    const current = await getDatabaseConfig(db, databaseId);
    sets.push('config = ?'); params.push(JSON.stringify({ ...current, ...patch.config }));
  }
  if (sets.length === 0) return;
  sets.push("updated_at = datetime('now')");
  params.push(databaseId);
  const res = await db.bridge.run(`UPDATE databases SET ${sets.join(', ')} WHERE id = ?`, params);
  if (res.error) throw new Error(res.error.message);
  db.notifyStructureChanged(databaseId);
}
