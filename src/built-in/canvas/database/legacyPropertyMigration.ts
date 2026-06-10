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

/** Find a live database by exact page title (reuse on re-run). */
async function findDatabaseByTitle(bridge: DatabaseBridgeLike, title: string): Promise<string | null> {
  const res = await bridge.get(
    'SELECT d.id FROM databases d JOIN pages p ON p.id = d.id WHERE p.title = ? AND p.is_archived = 0',
    [title],
  );
  return res.row ? (res.row.id as string) : null;
}

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

  // 3. Tags → the "Tags" database.
  const nonEmptyTags = tagValues
    .map((v) => ({ pageId: v.page_id as string, tags: decode(v.value) }))
    .filter((v) => Array.isArray(v.tags) && v.tags.length > 0);
  if (nonEmptyTags.length > 0) {
    let tagsDbId = await findDatabaseByTitle(bridge, 'Tags');
    if (!tagsDbId) {
      tagsDbId = (await db.createDatabase({ title: 'Tags', seedDefaults: false })).id;
    }
    let tagsProp = (await db.listProperties(tagsDbId)).find((p) => p.name === 'Tags');
    if (!tagsProp) {
      const legacyTagsDef = defs.find((d) => d.name === 'tags');
      const config = mapOptions(decode(legacyTagsDef?.config ?? '{}') as Record<string, unknown>);
      tagsProp = await db.addProperty(tagsDbId, 'Tags', 'tags', config);
    }
    for (const { pageId, tags } of nonEmptyTags) {
      await db.addExistingPageAsRow(tagsDbId, pageId);
      await db.setCellValue(tagsDbId, pageId, tagsProp.id, tags);
      migratedTagPages++;
    }
  }

  // 4. Custom definitions → the "Migrated properties" database.
  const customDefNames = [...new Set(customValues.map((v) => v.key as string))];
  if (customDefNames.length > 0) {
    let customDbId = await findDatabaseByTitle(bridge, 'Migrated properties');
    if (!customDbId) {
      customDbId = (await db.createDatabase({ title: 'Migrated properties', seedDefaults: false })).id;
    }
    const existing = await db.listProperties(customDbId);
    const propIdByName = new Map(existing.map((p) => [p.name, p.id]));
    for (const name of customDefNames) {
      if (propIdByName.has(name)) continue;
      const def = defs.find((d) => d.name === name);
      const type = (def?.type as PropertyType) ?? 'text';
      const config = mapOptions(decode(def?.config ?? '{}') as Record<string, unknown>);
      const prop = await db.addProperty(customDbId, name, type, config);
      propIdByName.set(name, prop.id);
    }
    for (const v of customValues) {
      const propId = propIdByName.get(v.key as string);
      if (!propId) continue;
      await db.addExistingPageAsRow(customDbId, v.page_id as string);
      await db.setCellValue(customDbId, v.page_id as string, propId, decode(v.value));
      migratedCustomValues++;
    }
  }

  return { migratedTagPages, migratedCustomValues, skippedArchived };
}
