// databaseCsvActions.ts — Export as CSV… and Import CSV… for a database.
//
// The view menu (right-click a view tab) offers both; the commands
// canvas.importCsvToDatabase (a database id) and canvas.exportDatabaseCsv
// (a database id and, optionally, a view id) run the same code.  The files
// go through the Electron dialogs: a picked path is the one place outside
// the workspace the renderer may read or write, once.  The text work is in
// databaseCsv.ts.

import type { IDisposable } from '../../../platform/lifecycle.js';
import type { DatabaseDataService } from './databaseDataService.js';
import type { IDatabaseView } from './databaseTypes.js';
import { EMPTY_FILTER } from './databaseTypes.js';
import { csvFileText, csvRecordToRow, databaseViewToRecords, parseCsv, planCsvImport } from './databaseCsv.js';
import { fileNameFor } from '../export/pageBundle.js';
import type { PropertyType } from '../properties/propertyTypes.js';

interface ICsvWindow {
  showInformationMessage(message: string): Promise<unknown>;
  showErrorMessage(message: string): Promise<unknown>;
  showQuickPick?(items: readonly { label: string; description?: string }[], options?: { placeholder?: string }): Promise<{ label: string; description?: string } | undefined>;
}

interface ICsvApi {
  commands: { registerCommand(id: string, handler: (...args: unknown[]) => unknown): IDisposable };
  window: ICsvWindow;
}

interface IElectronFiles {
  dialog?: {
    openFile?(o: unknown): Promise<string[] | null | undefined>;
    saveFile?(o: unknown): Promise<string | null | undefined>;
  };
  fs?: {
    readFile?(p: string, encoding?: string): Promise<{ content?: string; encoding?: string; error?: { message?: string } | null } | undefined>;
    writeFile?(p: string, content: string, encoding?: string): Promise<{ error?: { message?: string } | null } | undefined>;
  };
}

/** Where messages go: the app's notifications once the commands are registered. */
let _window: ICsvWindow | null = null;

function electron(): IElectronFiles | undefined {
  return (globalThis as { parallxElectron?: IElectronFiles }).parallxElectron;
}

function say(message: string): void {
  if (_window) void _window.showInformationMessage(message); else console.info('[Database CSV]', message);
}

function fail(message: string): void {
  if (_window) void _window.showErrorMessage(message); else console.error('[Database CSV]', message);
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Save what a view shows as a .csv the user picks.  True when written. */
export async function exportDatabaseCsv(db: DatabaseDataService, databaseId: string, viewId?: string): Promise<boolean> {
  const files = electron();
  if (!files?.dialog?.saveFile || !files.fs?.writeFile) { fail('Saving files is not available here.'); return false; }
  try {
    const [info, props, views, rows] = await Promise.all([
      db.getDatabase(databaseId), db.listProperties(databaseId), db.listViews(databaseId), db.listRows(databaseId),
    ]);
    if (!info) { fail('That database no longer exists.'); return false; }
    const view: Pick<IDatabaseView, 'config' | 'filter' | 'sort'> =
      views.find((v) => v.id === viewId) ?? views[0] ?? { config: {}, filter: EMPTY_FILTER, sort: [] };
    const records = databaseViewToRecords(props, view, rows);
    const path = await files.dialog.saveFile({ filters: [{ name: 'CSV', extensions: ['csv'] }], defaultName: `${fileNameFor(info.title || 'Untitled')}.csv` });
    if (!path) return false;
    const result = await files.fs.writeFile(path, csvFileText(records), 'utf-8');
    if (result?.error) throw new Error(result.error.message ?? 'The file could not be written.');
    const n = records.length - 1;
    say(`Exported ${n} ${n === 1 ? 'row' : 'rows'} as CSV.`);
    return true;
  } catch (err) {
    fail(`Could not export the CSV. ${errorText(err)}`);
    return false;
  }
}

/**
 * Add a CSV's records to a database as rows, filling properties by column
 * name and making a text property for each column that has none.  Returns
 * how many rows were added, or null when nothing was read.
 */
export async function importCsvIntoDatabase(db: DatabaseDataService, databaseId: string): Promise<number | null> {
  const files = electron();
  if (!files?.dialog?.openFile || !files.fs?.readFile) { fail('Opening files is not available here.'); return null; }
  try {
    const picked = await files.dialog.openFile({ title: 'Import CSV', filters: [{ name: 'CSV', extensions: ['csv'] }] });
    const path = picked?.[0];
    if (!path) return null;
    const read = await files.fs.readFile(path, 'utf-8');
    if (!read || read.error) throw new Error(read?.error?.message ?? 'The file could not be read.');
    if (read.encoding === 'base64' || typeof read.content !== 'string') throw new Error('The file is not text. Save it as CSV (UTF-8) and try again.');
    const table = parseCsv(read.content);
    const props = await db.listProperties(databaseId);
    const plan = planCsvImport(table, props);
    if (plan.records.length === 0) { say('The file has no rows to import.'); return 0; }

    const columns: { index: number; propertyId: string; type: PropertyType }[] = [];
    for (const col of plan.columns) {
      const prop = col.propertyId ? props.find((p) => p.id === col.propertyId) : await db.addProperty(databaseId, col.name, 'text');
      if (prop) columns.push({ index: col.index, propertyId: prop.id, type: prop.type });
    }
    let added = 0, skipped = 0, failed = 0;
    for (const record of plan.records) {
      const row = csvRecordToRow(record, plan.titleColumn, columns);
      try {
        await db.addRow(databaseId, row.title || undefined, row.values);
        added++;
        skipped += row.skipped;
      } catch (err) {
        failed++;
        console.error('[Database CSV] A row could not be added:', err);
      }
    }
    const made = plan.columns.filter((c) => !c.propertyId).length;
    const parts = [`Added ${added} ${added === 1 ? 'row' : 'rows'}.`];
    if (made > 0) parts.push(`Made ${made} new text ${made === 1 ? 'property' : 'properties'}.`);
    if (skipped > 0) parts.push(`${skipped} ${skipped === 1 ? 'cell did' : 'cells did'} not fit its property and ${skipped === 1 ? 'was' : 'were'} left empty.`);
    if (failed > 0) parts.push(`${failed} ${failed === 1 ? 'row' : 'rows'} could not be added.`);
    say(parts.join(' '));
    return added;
  } catch (err) {
    fail(`Could not import the CSV. ${errorText(err)}`);
    return null;
  }
}

/** The view menu's two entries, built with the menu's own item maker. */
export function databaseCsvMenuItems(
  db: DatabaseDataService, databaseId: string, viewId: string,
  item: (label: string, run: () => void) => HTMLElement,
): HTMLElement[] {
  return [
    item('Export as CSV…', () => void exportDatabaseCsv(db, databaseId, viewId)),
    item('Import CSV…', () => void importCsvIntoDatabase(db, databaseId)),
  ];
}

/** A database to work on: the one given, or one the user picks. */
async function pickDatabase(api: ICsvApi, db: DatabaseDataService, arg: unknown, placeholder: string): Promise<string | null> {
  if (typeof arg === 'string' && arg) {
    if (db.isDatabase(arg) || (await db.getDatabase(arg))) return arg;
    fail('That database no longer exists.');
    return null;
  }
  const all = await db.listDatabases();
  if (all.length === 0) { say('There is no database yet. Make one with New Database.'); return null; }
  if (!api.window.showQuickPick) return null;
  const items = all.map((d) => ({ label: d.title }));
  const chosen = await api.window.showQuickPick(items, { placeholder });
  if (!chosen) return null;
  const index = items.indexOf(chosen);
  return all[index >= 0 ? index : items.findIndex((i) => i.label === chosen.label)]?.id ?? null;
}

/** canvas.importCsvToDatabase and canvas.exportDatabaseCsv. */
export function registerDatabaseCsvCommands(api: ICsvApi, db: () => DatabaseDataService | null): IDisposable[] {
  _window = api.window;
  return [
    { dispose: () => { if (_window === api.window) _window = null; } },
    api.commands.registerCommand('canvas.importCsvToDatabase', async (databaseId: unknown) => {
      const service = db();
      const id = service ? await pickDatabase(api, service, databaseId, 'Import the CSV into which database?') : null;
      return service && id ? importCsvIntoDatabase(service, id) : null;
    }),
    api.commands.registerCommand('canvas.exportDatabaseCsv', async (databaseId: unknown, viewId: unknown) => {
      const service = db();
      const id = service ? await pickDatabase(api, service, databaseId, 'Export which database as CSV?') : null;
      return service && id ? exportDatabaseCsv(service, id, typeof viewId === 'string' ? viewId : undefined) : false;
    }),
  ];
}
