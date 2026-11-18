// workspaceDatabases.ts — the databases the app keeps for itself, and the
// one-home rule.
//
// Three databases are found by role, not by title: Tags (every page can be
// tagged; tagging joins the page to it), Page properties (a property added
// to a page that is in no database) and Migrated properties. They are made
// when first needed. `reconcileSingleHome` repairs what earlier versions
// left: a page that is a row of more than one database.
//
// These were methods of DatabaseDataService and still are, by name: the
// service forwards here.

import type { PropertyType } from '../properties/propertyTypes.js';
import type { DatabaseDataService } from './databaseDataService.js';

/** Databases the app keeps for itself, found by role (not by title). */
export type WorkspaceDatabaseRole = 'tags' | 'page-properties' | 'migrated-properties';
const WORKSPACE_DATABASE_TITLES: Record<WorkspaceDatabaseRole, string> = {
  'tags': 'Tags',
  'page-properties': 'Page properties',
  'migrated-properties': 'Migrated properties',
};

/** The Status options a database the person makes starts with. */
export const DEFAULT_STATUS_OPTIONS = [
  { value: 'To do', color: 'gray' },
  { value: 'In progress', color: 'blue' },
  { value: 'Done', color: 'green' },
];

/** The live database that holds a workspace role, if any. */
export async function findDatabaseByRole(db: DatabaseDataService, role: WorkspaceDatabaseRole): Promise<string | null> {
  const res = await db.bridge.get(
    'SELECT d.id FROM databases d JOIN pages p ON p.id = d.id WHERE d.role = ? AND p.is_archived = 0',
    [role],
  );
  return res.row ? (res.row.id as string) : null;
}

/**
 * A database made before roles existed that can take `role`: the oldest
 * live one with the role's title that the app made, not the user.  The
 * user's own databases start with the default Status column; the app's
 * never had one (and Tags has its Tags column).
 */
async function adoptableForRole(db: DatabaseDataService, role: WorkspaceDatabaseRole): Promise<string | null> {
  const res = await db.bridge.all(
    `SELECT d.id FROM databases d JOIN pages p ON p.id = d.id
      WHERE p.title = ? AND p.is_archived = 0 AND d.role IS NULL ORDER BY d.created_at`,
    [WORKSPACE_DATABASE_TITLES[role]],
  );
  for (const row of res.rows ?? []) {
    const id = row.id as string;
    const props = await db.listProperties(id);
    const seededStatus = props.some((p) => p.name === 'Status' && p.type === 'select'
      && JSON.stringify(((p.config['options'] as { value: string }[] | undefined) ?? []).map((o) => o.value))
        === JSON.stringify(DEFAULT_STATUS_OPTIONS.map((o) => o.value)));
    if (seededStatus) continue;
    if (role === 'tags' && !props.some((p) => p.type === 'tags' && p.name.toLowerCase() === 'tags')) continue;
    return id;
  }
  return null;
}

/**
 * Ensure a well-known workspace database exists (created lazily, no Status
 * seed), optionally with one seeded property. Returns the database id and —
 * when a seed property name is given — that property's id.
 *
 * Backs the always-present property panel: the 'Tags' database (every page
 * can be tagged; tagging joins the page to it) and the 'Page properties'
 * bucket ('+ Add property' on a page that's in no other database).
 */
export async function ensureWorkspaceDatabase(
  db: DatabaseDataService,
  role: WorkspaceDatabaseRole,
  seedProperty?: { name: string; type: PropertyType; config?: Record<string, unknown> },
): Promise<{ databaseId: string; propertyId?: string }> {
  let databaseId = await findDatabaseByRole(db, role);
  if (!databaseId) {
    // One in the Trash gives up the role: tagging must not join a page to a
    // database nobody can see.  Restoring it brings it back as a database.
    await db.bridge.run(
      'UPDATE databases SET role = NULL WHERE role = ? AND id IN (SELECT id FROM pages WHERE is_archived = 1)',
      [role],
    );
    databaseId = await adoptableForRole(db, role)
      ?? (await db.createDatabase({ title: WORKSPACE_DATABASE_TITLES[role], seedDefaults: false })).id;
    const res = await db.bridge.run('UPDATE databases SET role = ? WHERE id = ?', [role, databaseId]);
    if (res.error) throw new Error(res.error.message);
  }
  if (!seedProperty) return { databaseId };
  const props = await db.listProperties(databaseId);
  const existing = props.find((p) => p.name.toLowerCase() === seedProperty.name.toLowerCase());
  if (existing) return { databaseId, propertyId: existing.id };
  const created = await db.addProperty(databaseId, seedProperty.name, seedProperty.type, seedProperty.config ?? {});
  return { databaseId, propertyId: created.id };
}

/**
 * Collapse any multi-membership left by earlier versions into the
 * single-home model: the page's home is its first NON-"Tags" membership
 * (richer schema) — else the first membership. Every other membership's
 * values are MERGED into the home (same-named columns created as needed,
 * values copied when the home's cell is empty), then dropped. Idempotent and
 * cheap (no-op when no page has more than one membership).
 */
export async function reconcileSingleHome(db: DatabaseDataService): Promise<number> {
  const multi = await db.bridge.all(
    'SELECT page_id FROM database_pages GROUP BY page_id HAVING COUNT(*) > 1',
  );
  const pageIds = (multi.rows ?? []).map((r) => r.page_id as string);
  if (pageIds.length === 0) return 0;
  // The workspace Tags database, also when it predates roles.
  const tagsDb = (await findDatabaseByRole(db, 'tags')) ?? (await adoptableForRole(db, 'tags'));

  for (const pageId of pageIds) {
    const memberships = await db.bridge.all(
      'SELECT database_id FROM database_pages WHERE page_id = ? ORDER BY created_at',
      [pageId],
    );
    const rows = memberships.rows ?? [];
    if (rows.length <= 1) continue;
    // The workspace Tags database is home only when nothing else is.
    const home = (rows.find((r) => r.database_id !== tagsDb) ?? rows[0]).database_id as string;
    const homeProps = await db.listProperties(home);
    const homeValues = await db.getRowValues(home, pageId);

    for (const m of rows) {
      const otherId = m.database_id as string;
      if (otherId === home) continue;
      const otherProps = await db.listProperties(otherId);
      const otherValues = await db.getRowValues(otherId, pageId);
      for (const prop of otherProps) {
        const value = otherValues[prop.id];
        if (value === null || value === undefined) continue;
        let target = homeProps.find((p) => p.name.toLowerCase() === prop.name.toLowerCase());
        if (!target) {
          target = await db.addProperty(home, prop.name, prop.type, prop.config);
          homeProps.push(target);
        }
        const existing = homeValues[target.id];
        const empty = existing === null || existing === undefined || existing === '' || (Array.isArray(existing) && existing.length === 0);
        if (!empty) continue;
        try {
          await db.setCellValue(home, pageId, target.id, value);
        } catch {
          // The home's column of that name has another type: the value
          // keeps its own column rather than being dropped with the
          // membership below.
          const own = await db.addProperty(home, `${prop.name} (${prop.type})`, prop.type, prop.config);
          homeProps.push(own);
          await db.setCellValue(home, pageId, own.id, value);
        }
      }
      // Drop the extra membership + its cells (values merged above).
      await db.bridge.runTransaction([
        { type: 'run', sql: 'DELETE FROM page_property_values WHERE page_id = ? AND database_id = ?', params: [pageId, otherId] },
        { type: 'run', sql: 'DELETE FROM database_pages WHERE database_id = ? AND page_id = ?', params: [otherId, pageId] },
      ]);
      db.notifyRowsChanged(otherId);
    }
    db.notifyRowsChanged(home);
  }
  return pageIds.length;
}
