// bulkRows.ts — many rows of one database added, changed or removed in one go.
//
// A tool that keeps a long table (a plan's every day, a log imported at
// once) writes a hundred rows where a person writes one. Row by row that is
// a transaction and a change event each, and every open view of the table
// reloads each time. Here the cells of all the rows are checked first,
// written in one transaction, and told in one change event, so a view
// reloads once. The same checks as one row's write: a value its column
// cannot take is refused with the reason and nothing is written; a column a
// tool keeps is written by that tool only; a select or tag name that is not
// an option yet becomes one (once, however many rows name it).

import type { ICanvasDataService } from '../canvasTypes.js';
import type { IDatabaseProperty } from './databaseTypes.js';
import type { DatabaseBridge } from './databaseDataService.js';
import { missingOptions } from './cellValues.js';
import { mayWrite } from './keptColumns.js';

type Op = { type: 'run'; sql: string; params: unknown[] };

/** What the data service lends this module: its store, its pages, its one cell check, its events. */
export interface IBulkRowsHost {
  readonly bridge: DatabaseBridge;
  readonly pages: ICanvasDataService;
  listProperties(databaseId: string): Promise<IDatabaseProperty[]>;
  nextUniqueIds(databaseId: string, props: readonly IDatabaseProperty[]): Promise<Record<string, number>>;
  cellWrite(databaseId: string, pageId: string, propertyId: string, value: unknown, writer: string | undefined, prop: IDatabaseProperty): Promise<{ ops: Op[]; value: unknown }>;
  /** After the write: one change event for the database (`structure` when options were added). */
  changed(databaseId: string, kind: 'rows' | 'cells', pageIds: readonly string[], structure: boolean): void;
}

/** Colors given to options created by typing a new name (PILL_COLORS minus default). */
export const NEW_OPTION_COLORS = ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'] as const;

/**
 * Every select, status or tags name the rows give that is not an option
 * yet, added to its column once: the write that adds them, and the
 * columns as they are with them (so each cell's own check finds them).
 */
function withNewOptions(databaseId: string, props: IDatabaseProperty[], cells: readonly Readonly<Record<string, unknown>>[]): { ops: Op[]; props: IDatabaseProperty[] } {
  const ops: Op[] = [];
  const next = props.map((prop) => {
    const options = Array.isArray(prop.config['options']) ? prop.config['options'] as { value: string; color: string }[] : [];
    const added: string[] = [];
    for (const values of cells) {
      if (!(prop.id in values)) continue;
      for (const name of missingOptions(prop.type, values[prop.id], [...options, ...added.map((value) => ({ value }))])) added.push(name);
    }
    if (!added.length) return prop;
    const config = { ...prop.config, options: [...options, ...added.map((value, i) => ({ value, color: NEW_OPTION_COLORS[(options.length + i) % NEW_OPTION_COLORS.length]! }))] };
    ops.push({ type: 'run', sql: "UPDATE database_properties SET config = ?, updated_at = datetime('now') WHERE id = ? AND database_id = ?", params: [JSON.stringify(config), prop.id, databaseId] });
    return { ...prop, config };
  });
  return { ops, props: next };
}

async function run(host: IBulkRowsHost, ops: Op[]): Promise<void> {
  if (!ops.length) return;
  const res = await host.bridge.runTransaction(ops);
  if (res.error) throw new Error(res.error.message);
}

/** Rows added in order after the last one: their pages, membership and cells. Returns each row as made, values by property id. */
export async function addRows(host: IBulkRowsHost, databaseId: string, rows: readonly { title?: string; values?: Readonly<Record<string, unknown>> }[], writer?: string): Promise<{ pageId: string; title: string; values: Record<string, unknown> }[]> {
  if (!rows.length) return [];
  const { ops: optionOps, props } = withNewOptions(databaseId, await host.listProperties(databaseId), rows.map((r) => r.values ?? {}));
  const ids = await host.nextUniqueIds(databaseId, props);
  const order = await host.bridge.get('SELECT MAX(sort_order) as max_sort FROM database_pages WHERE database_id = ?', [databaseId]);
  if (order.error) throw new Error(order.error.message);
  let sort = (order.row?.max_sort as number) ?? 0;
  const made: { pageId: string; title: string; values: Record<string, unknown> }[] = [];
  const ops: Op[] = [...optionOps];
  try {
    for (const [i, row] of rows.entries()) {
      const page = await host.pages.createPage(databaseId, String(row.title ?? '').trim() || 'Untitled');
      made.push({ pageId: page.id, title: page.title, values: {} });
      ops.push({ type: 'run', sql: 'INSERT INTO database_pages (database_id, page_id, sort_order) VALUES (?, ?, ?)', params: [databaseId, page.id, (sort += 1)] });
      const values: Record<string, unknown> = { ...Object.fromEntries(Object.entries(ids).map(([id, n]) => [id, n + i])), ...(row.values ?? {}) };
      for (const [propertyId, value] of Object.entries(values)) {
        const prop = props.find((p) => p.id === propertyId);
        if (!prop) throw new Error(`Property "${propertyId}" is not in this database.`);
        // As one row's add: a column a tool keeps is not seeded by anyone else.
        if (!mayWrite(prop, writer)) continue;
        const cell = await host.cellWrite(databaseId, page.id, propertyId, value, writer, prop);
        ops.push(...cell.ops);
        made[i]!.values[propertyId] = cell.value;
      }
    }
    await run(host, ops);
  } catch (err) {
    // The pages were made by this call a moment ago and hold nothing yet.
    for (const m of made) { try { await host.pages.deletePage(m.pageId); } catch { /* best effort */ } }
    throw err;
  }
  host.changed(databaseId, 'rows', made.map((m) => m.pageId), optionOps.length > 0);
  return made;
}

/** Rows changed in one go: each its title and any cells (by property id). Every value is checked before anything is written. */
export async function updateRows(host: IBulkRowsHost, databaseId: string, patches: readonly { pageId: string; title?: string; values?: Readonly<Record<string, unknown>> }[], writer?: string): Promise<void> {
  if (!patches.length) return;
  const members = await host.bridge.all('SELECT page_id FROM database_pages WHERE database_id = ?', [databaseId]);
  if (members.error) throw new Error(members.error.message);
  const rows = new Set((members.rows ?? []).map((r) => r.page_id as string));
  const missing = patches.find((p) => !rows.has(p.pageId));
  if (missing) throw new Error(`Page ${missing.pageId} is not a row of this database.`);
  const { ops, props } = withNewOptions(databaseId, await host.listProperties(databaseId), patches.map((p) => p.values ?? {}));
  const structure = ops.length > 0;
  for (const p of patches) {
    for (const [propertyId, value] of Object.entries(p.values ?? {})) {
      const prop = props.find((x) => x.id === propertyId);
      if (!prop) throw new Error(`Property "${propertyId}" is not in this database.`);
      ops.push(...(await host.cellWrite(databaseId, p.pageId, propertyId, value, writer, prop)).ops);
    }
  }
  const retitled = patches.filter((p) => p.title !== undefined);
  for (const p of retitled) await host.pages.updatePage(p.pageId, { title: String(p.title).trim() || 'Untitled' });
  await run(host, ops);
  host.changed(databaseId, retitled.length ? 'rows' : 'cells', patches.map((p) => p.pageId), structure);
}

/** Rows removed in one go: membership and cells, and each row's page to the Trash. */
export async function removeRows(host: IBulkRowsHost, databaseId: string, pageIds: readonly string[]): Promise<void> {
  const ids = [...new Set(pageIds)];
  if (!ids.length) return;
  const ops: Op[] = [];
  for (const id of ids) {
    ops.push({ type: 'run', sql: 'DELETE FROM page_property_values WHERE page_id = ? AND database_id = ?', params: [id, databaseId] });
    ops.push({ type: 'run', sql: 'DELETE FROM database_pages WHERE database_id = ? AND page_id = ?', params: [databaseId, id] });
  }
  await run(host, ops);
  for (const id of ids) { try { await host.pages.archivePage(id); } catch { /* membership already gone; the page's archive is best-effort */ } }
  host.changed(databaseId, 'rows', ids, false);
}
