// plannerUi.ts — what the Planner pane's parts share: the editor API it is
// handed, the tab and view names, its glyphs and colour palette, and the
// small DOM helpers (el, the colour swatches, the event dialog's calendar
// options).

import type { IDropdownItem } from '../../ui/dropdown.js';
import type { PlannerCalendar } from './plannerTypes.js';

export interface PlannerEditorInput {
  readonly id: string;          // === instanceId; the Planner has one ('main')
  setName?(name: string): void;
  setIconHtml?(html: string | undefined): void;
}

export interface PlannerEditorApi {
  editors: {
    openEditor(options: { typeId: string; title: string; icon?: string; iconHtml?: string; instanceId?: string }): Promise<void>;
  };
  commands: {
    executeCommand<T = unknown>(id: string, ...args: unknown[]): Promise<T>;
  };
  links: {
    open(uri: string): Promise<boolean>;
    resolveMetadata(uri: string): Promise<{ title: string; icon?: string } | null>;
  };
  /** per-workspace persistence for small UI state (calendar view). */
  viewState?: {
    get<T>(key: string, defaultValue: T): T;
    set(key: string, value: unknown): void;
  };
  window: {
    showInputBox?(options?: { prompt?: string; value?: string; placeholder?: string }): Promise<string | undefined>;
    showInformationMessage(message: string, ...actions: { title: string }[]): Promise<{ title: string } | undefined>;
    showWarningMessage(message: string, ...actions: { title: string }[]): Promise<{ title: string } | undefined>;
    showErrorMessage(message: string, ...actions: { title: string }[]): Promise<{ title: string } | undefined>;
    showConfirmModal?(options: { message: string; detail?: string; confirmLabel?: string; cancelLabel?: string | null; danger?: boolean }): Promise<boolean>;
  };
  /** The activity journal: the planner narrates the user's own task work. */
  activity?: {
    note(n: { actor?: 'user' | 'ai' | 'system'; source: string; verb: string; object: string; detail?: string; ref?: string }): void;
  };
  /** lazy snapshot of registered day-load providers (generic seam:
   *  extensions decorate calendar days with per-day workload badges).
   *  Resolved per access because providers register at their own pace. */
  dayLoads?: {
    get(): readonly IDayLoadProviderLike[];
  };
}

/** Structural mirror of planner main's IDayLoadProvider. */
export interface IDayLoadProviderLike {
  readonly id: string;
  getDayLoads(fromMs: number, toMs: number): Promise<readonly { dayStartMs: number; count: number; label: string }[]>;
  onDidChange?(listener: () => void): { dispose(): void };
}

export type Tab = 'today' | 'tasks' | 'calendar';
export type CalendarView = 'month' | 'week' | 'day';

/** Widest pane that gets the compact layout. Mirrors the `compact` step in
 *  the planner tokens block of planner.css (CSS can't share it with TS). */
export const PANE_COMPACT_MAX = 719;

export const PLANNER_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><path d="m9 16 2 2 4-4"/></svg>';

// Small task glyphs for calendar entries (open circle / filled check).
export const TASK_DOT_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><circle cx="12" cy="12" r="9"/></svg>';
export const TASK_DONE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>';

export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const CALENDAR_LABEL_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg><span>Calendar</span>';
export const REPEAT_LABEL_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg><span>Repeats</span>';

// Link-chip glyphs: web (anchor/chain) vs internal (document).
export const LINK_WEB_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
export const LINK_DOC_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
export const LINK_PLUS_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 0 1 0 10h-2"/><line x1="8" y1="12" x2="16" y2="12"/></svg>';
export const COLOR_LABEL_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.563-2.512 5.563-5.563C22 6.31 17.51 2 12 2z"/></svg><span>Color</span>';
export const SYNC_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>';

// Google Calendar's event palette (colorId → hex). Used by the colour pickers
// AND to import synced event colours (see mapGoogleEventToSynced).
export const PLANNER_COLORS: readonly { readonly id: string; readonly name: string; readonly hex: string }[] = [
  { id: '11', name: 'Tomato',    hex: '#d50000' },
  { id: '4',  name: 'Flamingo',  hex: '#e67c73' },
  { id: '6',  name: 'Tangerine', hex: '#f4511e' },
  { id: '5',  name: 'Banana',    hex: '#f6bf26' },
  { id: '2',  name: 'Sage',      hex: '#33b679' },
  { id: '10', name: 'Basil',     hex: '#0b8043' },
  { id: '7',  name: 'Peacock',   hex: '#039be5' },
  { id: '9',  name: 'Blueberry', hex: '#3f51b5' },
  { id: '1',  name: 'Lavender',  hex: '#7986cb' },
  { id: '3',  name: 'Grape',     hex: '#8e24aa' },
  { id: '8',  name: 'Graphite',  hex: '#616161' },
];

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

/**
 * A row of colour swatches. `current` is the selected hex (or null = "default").
 * When `allowDefault`, a leading hollow chip clears the override (use the
 * calendar's colour). Calls `onPick(hex|null)` and re-highlights the selection.
 */
export function buildColorSwatches(
  current: string | null,
  onPick: (hex: string | null) => void,
  allowDefault: boolean,
): HTMLElement {
  const wrap = el('div', 'planner-swatches');
  let selected = current;
  const chips: { el: HTMLElement; hex: string | null }[] = [];
  const same = (a: string | null, b: string | null): boolean =>
    (a ?? null) === (b ?? null) || (a != null && b != null && a.toLowerCase() === b.toLowerCase());
  const refresh = (): void => {
    for (const c of chips) c.el.classList.toggle('planner-swatch--on', same(c.hex, selected));
  };
  const addChip = (hex: string | null, title: string): void => {
    const chip = el('button', 'planner-swatch');
    chip.type = 'button';
    chip.title = title;
    if (hex) chip.style.setProperty('--sw', hex);
    else chip.classList.add('planner-swatch--default');
    chip.addEventListener('click', () => { selected = hex; refresh(); onPick(hex); });
    chips.push({ el: chip, hex });
    wrap.appendChild(chip);
  };
  if (allowDefault) addChip(null, 'Use calendar colour');
  for (const c of PLANNER_COLORS) addChip(c.hex, c.name);
  refresh();
  return wrap;
}

/**
 * Calendar options for the event dialog.
 *
 * An event only reaches Google if its calendar is a Google MIRROR row
 * (`source_provider = 'google'`, created when you tick a calendar in Settings).
 * Put an event on a local calendar and it stays on this machine forever — no
 * error, no upstream copy, and invisible in every other workspace on the same
 * account. The picker showed bare names, so a local "Personal" and a synced
 * "Nutty Plan" looked like equivalent choices.
 *
 * The hint is only added once something actually syncs; with Google not
 * connected, "Not Synced" on every row would be noise.
 */
export function eventCalendarItems(cals: readonly PlannerCalendar[]): IDropdownItem[] {
  const anySynced = cals.some((c) => !!c.sourceProvider);
  return cals.map((c) => ({
    value: c.id,
    label: anySynced && !c.sourceProvider ? `${c.name} · Not Synced` : c.name,
  }));
}
