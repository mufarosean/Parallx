// legacyPropertyMigration.ts — one-time migration of the PRE-database property
// system (workspace property_definitions + per-page page_properties) into
// Notion-parity databases.
//
// Decisions (user-confirmed):
//   - tags  → a workspace "Tags" database: every tagged page becomes a MEMBER
//     (membership only — the page tree is untouched), tags become its
//     multi-select column.
//   - custom definitions → a "Migrated properties" database, same membership
//     pattern, columns = the legacy definitions, values copied.
//   - created/modified → backup only (redundant — derived from pages.*_at).
//   - A JSON BACKUP of everything is written BEFORE any write; the migration
//     aborts if the backup cannot be written. Legacy tables are left on disk
//     untouched as a second safety net; all code reads/writes stop.
//
// Idempotent: callers gate on a workspace memento; the module additionally
// reuses existing target databases by title instead of duplicating them.

import type { DatabaseDataService } from './databaseDataService.js';
import type { PropertyType } from '../properties/propertyTypes.js';

interface DatabaseBridgeLike {
  all(sql: string, params?: unknown[]): Promise<{ error: { code: string; message: string } | null; rows?: Record<string, unknown>[] }>;
  get(sql: string, params?: unknown[]): Promise<{ error: { code: string; message: string } | null; row?: Record<string, unknown> | null }>;
}

export interface IMigrationDeps {
  readonly bridge: DatabaseBridgeLike;
  readonly db: DatabaseDataService;
  /** Persist the backup JSON. MUST throw on failure — the migration aborts. */
  writeBackup(json: string): Promise<void>;
}

export interface IMigrationResult {
  readonly migratedTagPages: number;
  readonly migratedCustomValues: number;
  readonly skippedArchived: number;
}

/** Notion's named pill palette (sans 'default'). */
const NAMED = ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'] as const;

/** Exact map for the legacy TAG_COLOR_PALETTE rgba strings. */
const LEGACY_COLOR_MAP: Record<string, string> = {
  'rgba(125, 145, 235, 0.30)': 'blue',    // indigo
  'rgba(95, 178, 140, 0.30)': 'green',    // sage
  'rgba(224, 162, 78, 0.30)': 'orange',   // amber
  'rgba(222, 122, 142, 0.30)': 'pink',    // rose
  'rgba(86, 156, 214, 0.30)': 'blue',     // steel
  'rgba(178, 138, 222, 0.30)': 'purple',  // violet
  'rgba(120, 200, 200, 0.30)': 'green',   // teal
  'rgba(200, 170, 120, 0.30)': 'brown',   // tan
};

/** Map any legacy option color to the named palette (deterministic fallback). */
export function mapLegacyColor(color: string | undefined, optionValue: string): string {
  if (color && (NAMED as readonly string[]).includes(color)) return color;
  if (color && LEGACY_COLOR_MAP[color]) return LEGACY_COLOR_MAP[color];
  let hash = 0;
  for (let i = 0; i < optionValue.length; i++) hash = (hash * 31 + optionValue.charCodeAt(i)) | 0;
  return NAMED[Math.abs(hash) % NAMED.length];
}

function mapOptions(config: Record<string, unknown>): Record<string, unknown> {
  const options = Array.isArray((config as { options?: unknown }).options)
    ? ((config as { options: { value?: unknown; color?: unknown }[] }).options)
    : [];
  if (options.length === 0) return config;
  return {
    ...config,
    options: options
      .filter((o) => typeof o?.value === 'string' && o.value)
      .map((o) => ({ value: o.value as string, color: mapLegacyColor(typeof o.color === 'string' ? o.color : undefined, o.value as string) })),
  };
}

const SYSTEM_KEYS = new Set(['tags', 'created', 'modified']);

export async function runLegacyPropertyMigration(deps: IMigrationDeps): Promise<IMigrationResult | 'nothing-to-migrate'> {
  const { bridge, db } = deps;

  // 1. Read everything legacy. Values joined to pages so we know archived state.
  const [defsRes, valsRes] = await Promise.all([
    bridge.all('SELECT name, type, config, sort_order FROM property_definitions'),
    bridge.all(
      `SELECT pp.page_id, pp.key, pp.value_type, pp.value, p.is_archived
         FROM page_properties pp JOIN pages p ON p.id = pp.page_id`,
    ),
  ]);
  if (defsRes.error || valsRes.error) {
    // Legacy tables absent (fresh workspace) — nothing to do.
    return 'nothing-to-migrate';
  }
  const defs = defsRes.rows ?? [];
  const values = valsRes.rows ?? [];
  // Only non-system values (and tags) are worth migrating; created/modified are
  // derived from the pages table.
  const liveValues = values.filter((v) => !(v.is_archived as number));
  const tagValues = liveValues.filter((v) => v.key === 'tags');
  const customValues = liveValues.filter((v) => !SYSTEM_KEYS.has(v.key as string));
  if (tagValues.length === 0 && customValues.length === 0) return 'nothing-to-migrate';

  // 2. BACKUP FIRST — abort on failure (writeBackup throws).
  await deps.writeBackup(JSON.stringify(
    {
      migratedAt: new Date().toISOString(),
      note: 'Pre-migration backup of the legacy workspace property system. Legacy tables are also left untouched in the database.',
      definitions: defs,
      values,
    },
    null,
    2,
  ));

  const decode = (raw: unknown): unknown => {
    try { return JSON.parse(String(raw ?? 'null')); } catch { return raw; }
  };

  let migratedTagPages = 0;
  let migratedCustomValues = 0;
  const skippedArchived = values.length - liveValues.length;

  // SINGLE-HOME INVARIANT: a page belongs to exactly ONE database — its home,
  // whose schema is the page's properties. Pages with custom properties get
  // "Migrated properties" as their home (their tags merge into a Tags column
  // THERE — never a second membership); pages with ONLY tags get "Tags".
  // Re-run safe: a page that already has a home (earlier run, or a real
  // database) receives the columns + values on THAT home instead.
  const tagsByPage = new Map<string, unknown>();
  for (const v of tagValues) {
    const tags = decode(v.value);
    if (Array.isArray(tags) && tags.length > 0) tagsByPage.set(v.page_id as string, tags);
  }
  const customByPage = new Map<string, { key: string; value: unknown }[]>();
  for (const v of customValues) {
    const pageId = v.page_id as string;
    if (!customByPage.has(pageId)) customByPage.set(pageId, []);
    customByPage.get(pageId)!.push({ key: v.key as string, value: decode(v.value) });
  }
  const legacyTagsDef = defs.find((d) => d.name === 'tags');
  const tagsConfig = mapOptions(decode(legacyTagsDef?.config ?? '{}') as Record<string, unknown>);

  // Lazily-created targets.
  let customDbId: string | null = null;
  const ensureCustomDb = async (): Promise<string> => {
    if (customDbId) return customDbId;
    customDbId = (await db.ensureWorkspaceDatabase('migrated-properties')).databaseId;
    return customDbId;
  };
  let tagsDbId: string | null = null;
  const ensureTagsDb = async (): Promise<string> => {
    if (tagsDbId) return tagsDbId;
    tagsDbId = (await db.ensureWorkspaceDatabase('tags')).databaseId;
    return tagsDbId;
  };

  /** Property id by name on a database, creating the column when missing. */
  const ensureColumn = async (databaseId: string, name: string, type: PropertyType, config: Record<string, unknown>): Promise<string> => {
    const props = await db.listProperties(databaseId);
    const found = props.find((p) => p.name.toLowerCase() === name.toLowerCase());
    if (found) return found.id;
    return (await db.addProperty(databaseId, name, type, config)).id;
  };

  const allPages = new Set<string>([...customByPage.keys(), ...tagsByPage.keys()]);
  for (const pageId of allPages) {
    const customs = customByPage.get(pageId) ?? [];
    const tags = tagsByPage.get(pageId);

    // Resolve the page's home: keep an existing one; else custom pages go to
    // "Migrated properties", tag-only pages to "Tags".
    let home = await db.getHomeDatabaseForPage(pageId);
    if (!home) {
      home = customs.length > 0 ? await ensureCustomDb() : await ensureTagsDb();
      await db.addExistingPageAsRow(home, pageId);
    }

    // Fill, never overwrite: on a re-run (the workspace flag lost, a retry
    // after a partial run) the database holds values the user may have
    // changed since — the legacy value is older, so it only fills an empty
    // cell (C15).
    const current = await db.getRowValues(home, pageId);
    const isEmpty = (v: unknown) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);

    for (const { key, value } of customs) {
      const def = defs.find((d) => d.name === key);
      const type = (def?.type as PropertyType) ?? 'text';
      const config = mapOptions(decode(def?.config ?? '{}') as Record<string, unknown>);
      const propId = await ensureColumn(home, key, type, config);
      if (!isEmpty(current[propId])) continue;
      try {
        await db.setCellValue(home, pageId, propId, value);
        migratedCustomValues++;
      } catch (err) {
        // A same-named column of another type cannot take it; the legacy
        // table keeps the value untouched.
        console.warn('[legacyPropertyMigration] value not migrated:', key, err instanceof Error ? err.message : err);
      }
    }
    if (tags) {
      const tagsPropId = await ensureColumn(home, 'Tags', 'tags', tagsConfig);
      if (isEmpty(current[tagsPropId])) {
        await db.setCellValue(home, pageId, tagsPropId, tags);
        migratedTagPages++;
      }
    }
  }

  // Collapse any multi-membership left by EARLIER migration versions
  // (values merged into the surviving home, extra memberships dropped).
  await db.reconcileSingleHome();

  return { migratedTagPages, migratedCustomValues, skippedArchived };
}
