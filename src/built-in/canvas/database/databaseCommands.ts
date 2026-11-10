// databaseCommands.ts — the database editor's actions as commands.
//
// A kit control that declares a command is in the palette, the keybindings
// and the model's reach (docs/SELF_DESCRIBING_UI_DESIGN.md, 6.3); one with
// a local handler is only on its surface. The database views declare these
// commands; the one database editor the user is in (the last focused pane)
// answers them. A menu's anchor is the control that was pressed, which has
// focus when the command runs.

import type { IDisposable } from '../../../platform/lifecycle.js';

/** What a database editor pane does on command (databaseEditorPane.ts). */
export interface IDatabasePaneActions {
  addRow(seed?: Record<string, unknown>, templateId?: string | null): Promise<void>;
  openRow(pageId: string): void;
  /** The database itself, as a page (an embedded view's title). */
  openDatabase(): void;
  setCell(pageId: string, propertyId: string, value: unknown): Promise<void>;
  openTemplatesMenu(anchor: HTMLElement): void;
  openViewSettings(anchor: HTMLElement): void;
  openFilter(anchor: HTMLElement): void;
  openSort(anchor: HTMLElement): void;
  openAddView(anchor: HTMLElement): void;
  openAddProperty(anchor: HTMLElement): void;
  openCalcMenu(anchor: HTMLElement, key: string, type: string): void;
  /** Header actions (icon, cover, description, the database menu). */
  header: {
    openIconPicker(anchor: HTMLElement): void;
    openMenu(anchor: HTMLElement): void;
    openCoverPicker(anchor: HTMLElement): void;
    removeCover(): void;
    startReposition(): void;
    finishReposition(save: boolean): void;
    addDescription(): void;
  } | null;
  /** The calendar or timeline shown moves a month, or to today. */
  navigate(how: 'previous' | 'next' | 'today'): void;
}

let active: IDatabasePaneActions | null = null;

/** The pane the commands act on: set when a pane is made or focused, cleared when it goes. */
export function setActiveDatabasePane(pane: IDatabasePaneActions | null): void { active = pane; }
export function activeDatabasePane(): IDatabasePaneActions | null { return active; }
export function clearActiveDatabasePane(pane: IDatabasePaneActions): void { if (active === pane) active = null; }

function anchor(): HTMLElement {
  const el = document.activeElement as HTMLElement | null;
  return el && el !== document.body ? el : document.body;
}

/** Every command id and what it does on the active pane. */
export const DATABASE_COMMANDS: Record<string, (pane: IDatabasePaneActions, args: unknown[]) => unknown> = {
  'database.addRow': (p, a) => p.addRow((a[0] as Record<string, unknown> | undefined) ?? {}, a[1] as string | null | undefined),
  'database.openRow': (p, a) => p.openRow(String(a[0] ?? '')),
  'database.openDatabase': (p) => p.openDatabase(),
  'database.setCell': (p, a) => p.setCell(String(a[0] ?? ''), String(a[1] ?? ''), a[2]),
  'database.templates': (p) => p.openTemplatesMenu(anchor()),
  'database.viewSettings': (p) => p.openViewSettings(anchor()),
  'database.filter': (p) => p.openFilter(anchor()),
  'database.sort': (p) => p.openSort(anchor()),
  'database.addView': (p) => p.openAddView(anchor()),
  'database.addProperty': (p) => p.openAddProperty(anchor()),
  'database.calculate': (p, a) => p.openCalcMenu(anchor(), String(a[0] ?? ''), String(a[1] ?? 'text')),
  'database.icon': (p) => p.header?.openIconPicker(anchor()),
  'database.menu': (p) => p.header?.openMenu(anchor()),
  'database.cover.add': (p) => p.header?.openCoverPicker(anchor()),
  'database.cover.change': (p) => p.header?.openCoverPicker(anchor()),
  'database.cover.remove': (p) => p.header?.removeCover(),
  'database.cover.reposition': (p) => p.header?.startReposition(),
  'database.cover.saveReposition': (p) => p.header?.finishReposition(true),
  'database.cover.cancelReposition': (p) => p.header?.finishReposition(false),
  'database.addDescription': (p) => p.header?.addDescription(),
  'database.previous': (p) => p.navigate('previous'),
  'database.next': (p) => p.navigate('next'),
  'database.today': (p) => p.navigate('today'),
};

/** Run a database command on the active pane. False when there is none or the id is not one. */
export function executeDatabaseCommand(id: string, args: unknown[]): boolean {
  const run = DATABASE_COMMANDS[id];
  if (!run || !active) return false;
  void run(active, args);
  return true;
}

/** Register every database command with the app (canvas activation). */
export function registerDatabaseCommands(register: (id: string, handler: (...args: unknown[]) => unknown) => IDisposable): IDisposable {
  const subs = Object.keys(DATABASE_COMMANDS).map((id) => register(id, (...args) => executeDatabaseCommand(id, args)));
  return { dispose: () => { for (const s of subs) s.dispose(); } };
}
