// plannerEditorProvider.ts — Planner editor pane.
//
// Two tabs: Tasks (review queue + grouped list) and Calendar (month /
// week / day view). Pure DOM + CSS Grid; no layout engine.

import type { IDisposable } from '../../platform/lifecycle.js';
import { renderEmptyState } from '../../ui/emptyStates.js';
import type { PlannerDataService } from './plannerDataService.js';
import type { PlannerCalendar, PlannerEvent, PlannerTask, SeriesEditScope, TaskStatus, UpdateEventInput } from './plannerTypes.js';
import type { IPlannerSyncController } from './sync/plannerSyncOrchestrator.js';
import { googleSync } from './sync/googleClient.js';
import { takePendingPlannerTab } from './plannerNavState.js';
import { buildSimpleRRule, describeRRule, rruleToPreset } from './plannerRecurrence.js';
import { packLanes } from './plannerLayout.js';
import { PlannerAutomationsController, type CronServiceLike } from './plannerAutomations.js';
import { Dropdown } from '../../ui/dropdown.js';
import { getIcon } from '../../ui/iconRegistry.js';

interface PlannerEditorInput {
  readonly id: string;          // === instanceId; only one ('main') for M82
  setName?(name: string): void;
  setIconHtml?(html: string | undefined): void;
}

interface PlannerEditorApi {
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
  /** M86 — per-workspace persistence for small UI state (calendar view). */
  viewState?: {
    get<T>(key: string, defaultValue: T): T;
    set(key: string, value: unknown): void;
  };
  window: {
    showInputBox?(options?: { prompt?: string; value?: string; placeholder?: string }): Promise<string | undefined>;
    showInformationMessage(message: string, ...actions: { title: string }[]): Promise<{ title: string } | undefined>;
    showWarningMessage(message: string, ...actions: { title: string }[]): Promise<{ title: string } | undefined>;
    showErrorMessage(message: string, ...actions: { title: string }[]): Promise<{ title: string } | undefined>;
  };
  /** M93 — lazy handle to the workspace cron service for the Automations tab.
   *  Null until the chat built-in has registered it (activation order). */
  cron?: {
    get(): CronServiceLike | null;
  };
  /** M98 — lazy snapshot of registered day-load providers (generic seam:
   *  extensions decorate calendar days with per-day workload badges).
   *  Resolved per access because providers register at their own pace. */
  dayLoads?: {
    get(): readonly IDayLoadProviderLike[];
  };
}

/** Structural mirror of planner main's IDayLoadProvider (M98). */
export interface IDayLoadProviderLike {
  readonly id: string;
  getDayLoads(fromMs: number, toMs: number): Promise<readonly { dayStartMs: number; count: number; label: string }[]>;
  onDidChange?(listener: () => void): { dispose(): void };
}

type Tab = 'tasks' | 'calendar' | 'automations';
type CalendarView = 'month' | 'week' | 'day';

const PLANNER_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><path d="m9 16 2 2 4-4"/></svg>';

// Small task glyphs for calendar entries (open circle / filled check).
const TASK_DOT_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><circle cx="12" cy="12" r="9"/></svg>';
const TASK_DONE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>';

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const CALENDAR_LABEL_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg><span>Calendar</span>';
const REPEAT_LABEL_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg><span>Repeats</span>';

// Link-chip glyphs: web (anchor/chain) vs internal (document).
const LINK_WEB_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
const LINK_DOC_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
const LINK_PLUS_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 0 1 0 10h-2"/><line x1="8" y1="12" x2="16" y2="12"/></svg>';
const COLOR_LABEL_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.563-2.512 5.563-5.563C22 6.31 17.51 2 12 2z"/></svg><span>Color</span>';
const SYNC_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>';

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

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

/**
 * A row of colour swatches. `current` is the selected hex (or null = "default").
 * When `allowDefault`, a leading hollow chip clears the override (use the
 * calendar's colour). Calls `onPick(hex|null)` and re-highlights the selection.
 */
function buildColorSwatches(
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

function startOfDay(date: Date): Date { const d = new Date(date); d.setHours(0, 0, 0, 0); return d; }
function endOfDay(date: Date): Date { const d = new Date(date); d.setHours(23, 59, 59, 999); return d; }
function startOfWeek(date: Date): Date {
  // Week starts on Sunday for compatibility with most calendars; could be configurable later.
  const d = startOfDay(date);
  d.setDate(d.getDate() - d.getDay());
  return d;
}
function startOfMonth(date: Date): Date {
  const d = startOfDay(date);
  d.setDate(1);
  return d;
}
function endOfMonth(date: Date): Date {
  const d = startOfMonth(date);
  d.setMonth(d.getMonth() + 1);
  d.setMilliseconds(-1);
  return d;
}
function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

// ─── Provider ────────────────────────────────────────────────────────────────

export class PlannerEditorProvider {
  constructor(
    private readonly _data: PlannerDataService,
    private readonly _api: PlannerEditorApi,
    private readonly _sync?: IPlannerSyncController,
  ) {}

  createEditorPane(container: HTMLElement, input?: PlannerEditorInput): IDisposable {
    const pane = new PlannerEditorPane(container, input, this._data, this._api, this._sync);
    pane.init().catch(err => console.error('[PlannerEditorProvider] pane init failed:', err));
    return pane;
  }
}

// ─── Pane ────────────────────────────────────────────────────────────────────

class PlannerEditorPane implements IDisposable {
  private _root: HTMLElement | null = null;
  private _bodyEl: HTMLElement | null = null;
  private _activeTab: Tab = 'tasks';
  private _calendarView: CalendarView = 'month';
  private _cursorDate: Date = startOfDay(new Date());
  /** Persists the currently-selected filter inside the Tasks tab. */
  private _tasksFilter: string = 'all';
  private _disposed = false;
  /** Re-entrancy guard for _renderTab (async clear-then-append must not overlap). */
  private _rendering = false;
  private _renderQueued = false;
  private readonly _disposables: IDisposable[] = [];

  constructor(
    private readonly _container: HTMLElement,
    private readonly _input: PlannerEditorInput | undefined,
    private readonly _data: PlannerDataService,
    private readonly _api: PlannerEditorApi,
    private readonly _sync?: IPlannerSyncController,
  ) {}

  async init(): Promise<void> {
    if (this._disposed) return;
    // Honour a tab the sidebar requested before this pane existed (deterministic
    // first-open). The focusTab event below handles re-clicks while already open.
    // M86 — restore the full view state for this workspace. The pane is
    // rebuilt every time the user switches editor tabs away and back, so
    // anything not persisted silently resets to defaults ("why am I on
    // Tasks again?"). Restored: active tab, calendar view, tasks filter,
    // calendar cursor date.
    const vs = this._api.viewState;
    if (vs) {
      const savedTab = vs.get<string>('planner.activeTab', 'tasks');
      if (savedTab === 'tasks' || savedTab === 'calendar' || savedTab === 'automations') this._activeTab = savedTab;
      const savedView = vs.get<string>('planner.calendarView', 'month');
      if (savedView === 'month' || savedView === 'week' || savedView === 'day') {
        this._calendarView = savedView;
      }
      const savedFilter = vs.get<string>('planner.tasksFilter', 'all');
      if (savedFilter) this._tasksFilter = savedFilter;
      // Same-day guard: the persisted cursor exists so an intra-day tab
      // switch comes back to the week you were looking at — NOT so that
      // opening the planner on Thursday lands you on the Tuesday you last
      // had it open. A cursor saved on any earlier day is stale; fresh
      // opens always anchor on today.
      const savedCursor = vs.get<string>('planner.cursorDate', '');
      const savedAt = Number(vs.get<number>('planner.cursorSavedAt', 0)) || 0;
      const savedToday = savedAt > 0
        && startOfDay(new Date(savedAt)).getTime() === startOfDay(new Date()).getTime();
      if (savedCursor && savedToday) {
        const d = new Date(savedCursor);
        if (!Number.isNaN(d.getTime())) this._cursorDate = startOfDay(d);
      }
    }
    // An EXPLICIT tab request from the sidebar wins over restored state.
    const pendingTab = takePendingPlannerTab();
    if (pendingTab) this._activeTab = pendingTab;
    this._input?.setName?.('Planner');
    this._input?.setIconHtml?.(PLANNER_ICON_SVG);
    this._buildShell();
    await this._renderTab();

    this._disposables.push(this._data.onDidChange(() => {
      if (this._disposed) return;
      void this._renderTab();
    }));

    // M98 — day-load providers repaint the calendar when their data moves
    // (e.g. flashcards reviewed → tomorrow's badge shrinks). Providers that
    // register after this pane exists are still picked up per render; the
    // subscription is only for LIVE updates while the calendar is visible.
    for (const provider of this._api.dayLoads?.get() ?? []) {
      try {
        const sub = provider.onDidChange?.(() => {
          if (this._disposed) return;
          if (this._activeTab === 'calendar') void this._renderTab();
        });
        if (sub) this._disposables.push(sub);
      } catch { /* provider misbehaving must not break the pane */ }
    }

    // The sidebar dispatches a "focus tab" event when the user clicks
    // Calendar / Tasks. The active pane responds by switching to that
    // tab; non-active panes ignore it (root won't be connected).
    const onFocusTab = (e: Event) => {
      if (!this._root?.isConnected) return;
      const tab = (e as CustomEvent<{ tab?: Tab }>).detail?.tab;
      if (tab === 'tasks' || tab === 'calendar' || tab === 'automations') this._setTab(tab);
    };
    document.addEventListener('parallx.planner.focusTab', onFocusTab);

    // planner.newTask command dispatches this; the active pane opens
    // the dedicated task popover.
    const onNewTask = () => {
      if (!this._root?.isConnected) return;
      this._setTab('tasks');
      // Anchor in the top-left of the body, popover positioning will keep
      // it on-screen.
      const anchor = this._bodyEl?.getBoundingClientRect() ?? new DOMRect(120, 120, 0, 0);
      this._openTaskPopover({ mode: 'create' }, anchor);
    };
    document.addEventListener('parallx.planner.newTask', onNewTask);

    // Keyboard shortcuts — Notion Calendar / Cron parity. Only fire when
    // the pane is connected and the user isn't typing in an input.
    const onKey = (e: KeyboardEvent) => {
      if (!this._root?.isConnected) return;
      // Focus scope: these are BARE-KEY shortcuts (m / w / d / c / arrows …).
      // Only act when the planner is the focused surface — otherwise a planner
      // open in another split or a background tab would steal those letters and
      // arrows from whatever editor/surface the user is actually working in
      // (the same "surface eats another surface's keys" bug as the titlebar).
      // Allow when nothing specific is focused (activeElement is body/null) so
      // the shortcuts still work right after the calendar renders.
      const active = document.activeElement;
      if (active && active !== document.body && !this._root.contains(active)) return;
      const target = e.target as HTMLElement | null;
      // Skip when focus is inside any input / textarea / contenteditable —
      // those characters belong to the user's typing.
      if (target && (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable
      )) return;
      // Skip when a popover is open — it owns its own keyboard handling.
      if (document.querySelector('.planner-popover-overlay')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      switch (e.key.toLowerCase()) {
        case 't':
          // T — jump to today (calendar only)
          if (this._activeTab === 'calendar') {
            this._cursorDate = startOfDay(new Date());
            void this._renderTab();
            e.preventDefault();
          }
          break;
        case 'c':
          // C — quick create (event in calendar, task in tasks)
          if (this._activeTab === 'calendar') {
            const start = new Date(this._cursorDate);
            start.setHours(9, 0, 0, 0);
            this._openEventPopover({
              mode: 'create',
              startAt: start.getTime(),
              endAt: start.getTime() + 60 * 60 * 1000,
            }, new DOMRect(window.innerWidth / 2 - 180, 100, 0, 0));
          } else {
            this._openTaskPopover({ mode: 'create' }, new DOMRect(window.innerWidth / 2 - 180, 100, 0, 0));
          }
          e.preventDefault();
          break;
        case 'arrowleft':
          if (this._activeTab === 'calendar') {
            this._navigateCalendar(-1);
            void this._renderTab();
            e.preventDefault();
          }
          break;
        case 'arrowright':
          if (this._activeTab === 'calendar') {
            this._navigateCalendar(1);
            void this._renderTab();
            e.preventDefault();
          }
          break;
        case 'm':
          if (this._activeTab === 'calendar') {
            this._setCalendarView('month');
            void this._renderTab();
            e.preventDefault();
          }
          break;
        case 'w':
          if (this._activeTab === 'calendar') {
            this._setCalendarView('week');
            void this._renderTab();
            e.preventDefault();
          }
          break;
        case 'd':
          if (this._activeTab === 'calendar') {
            this._setCalendarView('day');
            void this._renderTab();
            e.preventDefault();
          }
          break;
      }
    };
    document.addEventListener('keydown', onKey);

    this._disposables.push({
      dispose() {
        document.removeEventListener('parallx.planner.focusTab', onFocusTab);
        document.removeEventListener('parallx.planner.newTask', onNewTask);
        document.removeEventListener('keydown', onKey);
      },
    });
  }

  // ── Shell ────────────────────────────────────────────────────────────

  private _buildShell(): void {
    this._container.innerHTML = '';
    this._container.classList.add('planner-pane-host');

    const root = el('div', 'planner-pane');
    this._root = root;

    // Header — tab toggles + contextual actions
    const header = el('header', 'planner-pane__header');

    const tabs = el('div', 'planner-pane__tabs');
    const tabsConfig: { key: Tab; label: string; icon: string }[] = [
      { key: 'tasks',    label: 'Tasks',    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/></svg>' },
      { key: 'calendar', label: 'Calendar', icon: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>' },
      { key: 'automations', label: 'Automations', icon: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>' },
    ];
    for (const t of tabsConfig) {
      const tab = el('button', 'planner-pane__tab');
      tab.type = 'button';
      tab.dataset.tab = t.key;
      tab.innerHTML = `${t.icon}<span>${t.label}</span>`;
      tab.addEventListener('click', () => this._setTab(t.key));
      tabs.appendChild(tab);
    }
    header.appendChild(tabs);

    const actions = el('div', 'planner-pane__actions');
    actions.dataset.role = 'tab-actions';
    header.appendChild(actions);

    root.appendChild(header);

    const body = el('div', 'planner-pane__body');
    body.dataset.role = 'body';
    this._bodyEl = body;
    root.appendChild(body);

    this._container.appendChild(root);
    this._syncTabClass();
  }

  private _setTab(tab: Tab): void {
    this._activeTab = tab;
    this._syncTabClass();
    void this._renderTab();
  }

  /**
   * Persist the pane's view state per-workspace (M86). Deduped by signature
   * so the render loop (which also fires on data changes) doesn't spam the
   * memento with identical writes.
   */
  private _lastViewStateSig = '';
  private _saveViewState(): void {
    const vs = this._api.viewState;
    if (!vs) return;
    const sig = `${this._activeTab}|${this._calendarView}|${this._tasksFilter}|${this._cursorDate.getTime()}`;
    if (sig === this._lastViewStateSig) return;
    this._lastViewStateSig = sig;
    vs.set('planner.activeTab', this._activeTab);
    vs.set('planner.calendarView', this._calendarView);
    vs.set('planner.tasksFilter', this._tasksFilter);
    vs.set('planner.cursorDate', this._cursorDate.toISOString());
    // Freshness stamp for the same-day restore guard in init().
    vs.set('planner.cursorSavedAt', Date.now());
  }

  private _syncTabClass(): void {
    const tabsEl = this._root?.querySelectorAll('.planner-pane__tab');
    if (!tabsEl) return;
    for (const t of Array.from(tabsEl)) {
      if (!(t instanceof HTMLElement)) continue;
      t.classList.toggle('planner-pane__tab--active', t.dataset.tab === this._activeTab);
    }
  }

  /**
   * Re-entrancy-safe tab render. `_renderTabOnce` clears the body up front but
   * appends its content only AFTER awaiting data — so two overlapping calls
   * (e.g. a burst of onDidChange events during a sync) would each clear-then-
   * append and stack DUPLICATE grids. Serialize them: only one runs at a time,
   * and a call arriving mid-render coalesces into a single trailing re-render.
   */
  private async _renderTab(): Promise<void> {
    // Every view-state mutation funnels through a render — one save hook
    // covers tab switches, calendar navigation, and view changes.
    this._saveViewState();
    if (this._rendering) { this._renderQueued = true; return; }
    this._rendering = true;
    try {
      do {
        this._renderQueued = false;
        await this._renderTabOnce();
      } while (this._renderQueued && !this._disposed);
    } finally {
      this._rendering = false;
    }
  }

  private async _renderTabOnce(): Promise<void> {
    const body = this._bodyEl;
    const actions = this._root?.querySelector('[data-role="tab-actions"]') as HTMLElement | null;
    if (!body || !actions) return;

    // Render into DETACHED containers and swap only when the content is
    // ready. The old clear-first approach left the pane an empty (black)
    // host for the full duration of the tab renderer's SQLite round-trips —
    // every background refresh (the 5-minute sync tick especially) read as
    // "the whole tab just reloaded".
    const nextBody = document.createElement('div');
    const nextActions = document.createElement('div');

    if (this._activeTab === 'tasks') {
      await this._renderTasksTab(nextBody, nextActions);
    } else if (this._activeTab === 'automations') {
      await this._renderAutomationsTab(nextBody, nextActions);
    } else {
      await this._renderCalendarTab(nextBody, nextActions);
    }
    if (this._disposed) return;

    body.replaceChildren(...Array.from(nextBody.childNodes));
    actions.replaceChildren(...Array.from(nextActions.childNodes));
  }

  // ── Automations tab (M93) ────────────────────────────────────────────

  private _automations: PlannerAutomationsController | null = null;

  private async _renderAutomationsTab(body: HTMLElement, actions: HTMLElement): Promise<void> {
    if (!this._automations) {
      this._automations = new PlannerAutomationsController({
        getCron: () => this._api.cron?.get() ?? null,
        settings: this._data,
        window: this._api.window,
        isActive: () => !this._disposed && this._activeTab === 'automations',
      });
      this._disposables.push(this._automations);
    }
    await this._automations.render(body, actions);
  }

  // ── Tasks tab ────────────────────────────────────────────────────────

  private async _renderTasksTab(body: HTMLElement, actions: HTMLElement): Promise<void> {
    const addBtn = el('button', 'planner-cta');
    addBtn.type = 'button';
    addBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg><span>Create</span>';
    addBtn.addEventListener('click', () => this._captureNewTask(addBtn.getBoundingClientRect()));
    actions.appendChild(addBtn);

    const all = await this._data.listTasks({
      status: ['reviewing', 'planned', 'done'],
      includeUndated: true,
      limit: 500,
    });

    if (all.length === 0) {
      body.appendChild(renderEmptyState('planner.day'));
      return;
    }

    // Two-column layout: left filter nav, right filtered content.
    const layout = el('div', 'planner-tasks');
    body.appendChild(layout);

    const nav = el('nav', 'planner-tasks__nav');
    nav.setAttribute('aria-label', 'Filter tasks');
    const content = el('div', 'planner-tasks__content');
    layout.appendChild(nav);
    layout.appendChild(content);

    type Filter = { key: string; label: string; pinned?: boolean; match: (t: typeof all[number]) => boolean };
    const filters: Filter[] = [
      { key: 'review',  label: 'Review queue', pinned: true, match: t => t.status === 'reviewing' },
      { key: 'today',   label: 'Today',     match: t => (t.status === 'planned' || t.status === 'reviewing') && t.dueAt != null && sameDay(new Date(t.dueAt), new Date()) },
      { key: 'week',    label: 'This week', match: t => (t.status === 'planned' || t.status === 'reviewing') && t.dueAt != null && t.dueAt >= startOfDayMs() && t.dueAt <= startOfDayMs() + 7 * 86_400_000 },
      { key: 'overdue', label: 'Overdue',   match: t => (t.status === 'planned' || t.status === 'reviewing') && t.dueAt != null && t.dueAt < Date.now() },
      { key: 'all',     label: 'All tasks', match: t => t.status !== 'cancelled' },
      { key: 'completed', label: 'Completed', match: t => t.status === 'done' },
    ];

    let activeKey = this._tasksFilter;

    const renderContent = () => {
      content.innerHTML = '';
      const filter = filters.find(f => f.key === activeKey) ?? filters[filters.length - 1];
      const matching = all.filter(filter.match);

      if (activeKey === 'all') {
        // "All tasks" uses the grouped section view so the user has the
        // full overview when no specific filter is active.
        const reviewing = matching.filter(t => t.status === 'reviewing');
        const overdue   = matching.filter(t => t.status === 'planned' && t.dueAt != null && t.dueAt < Date.now());
        const today     = matching.filter(t => t.status === 'planned' && t.dueAt != null && sameDay(new Date(t.dueAt), new Date()));
        const upcoming  = matching.filter(t => t.status === 'planned' && t.dueAt != null && t.dueAt > endOfDay(new Date()).getTime());
        const noDate    = matching.filter(t => t.status === 'planned' && !t.dueAt);
        const completed = matching.filter(t => t.status === 'done').slice(0, 12);
        if (reviewing.length > 0) content.appendChild(this._renderTaskSection('Review queue', reviewing, { accent: 'review', hint: 'Captured fast. Pick a real due date or mark cancelled.' }));
        if (overdue.length > 0)   content.appendChild(this._renderTaskSection('Overdue', overdue, { accent: 'overdue' }));
        if (today.length > 0)     content.appendChild(this._renderTaskSection('Today', today, { accent: 'today' }));
        if (upcoming.length > 0)  content.appendChild(this._renderTaskSection('Upcoming', upcoming));
        if (noDate.length > 0)    content.appendChild(this._renderTaskSection('No date', noDate));
        if (completed.length > 0) content.appendChild(this._renderTaskSection('Recently completed', completed, { collapsed: true }));
      } else {
        // Single-filter view: one flat section with the matching rows.
        if (matching.length === 0) {
          content.appendChild(renderEmptyState('planner.filter'));
          return;
        }
        // Completed reads best newest-first (by completion time).
        const rows = activeKey === 'completed'
          ? [...matching].sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))
          : matching;
        const accent = activeKey === 'review' ? 'review' : activeKey === 'overdue' ? 'overdue' : activeKey === 'today' ? 'today' : undefined;
        content.appendChild(this._renderTaskSection(filter.label, rows, { accent }));
      }
    };

    // Build the nav.
    let lastPinned: boolean | undefined;
    for (const f of filters) {
      if (lastPinned !== undefined && !!f.pinned !== !!lastPinned) {
        nav.appendChild(el('div', 'planner-tasks__navsep'));
      }
      lastPinned = !!f.pinned;
      const item = el('button', 'planner-tasks__navitem');
      item.type = 'button';
      item.dataset.key = f.key;
      const label = el('span', 'planner-tasks__navlabel');
      label.textContent = f.label;
      const count = el('span', 'planner-tasks__navcount');
      count.textContent = String(all.filter(f.match).length);
      item.appendChild(label);
      item.appendChild(count);
      item.addEventListener('click', () => {
        activeKey = f.key;
        this._tasksFilter = activeKey;
        this._saveViewState();
        for (const sibling of Array.from(nav.children)) {
          if (sibling instanceof HTMLElement && sibling.classList.contains('planner-tasks__navitem')) {
            sibling.classList.toggle('planner-tasks__navitem--active', sibling.dataset.key === activeKey);
          }
        }
        renderContent();
      });
      if (f.key === activeKey) item.classList.add('planner-tasks__navitem--active');
      nav.appendChild(item);
    }

    renderContent();
  }

  private _renderTaskSection(title: string, tasks: readonly PlannerTask[], opts: { accent?: string; hint?: string; collapsed?: boolean } = {}): HTMLElement {
    const section = el('section', 'planner-section');
    if (opts.accent) section.classList.add(`planner-section--${opts.accent}`);
    if (opts.collapsed) section.classList.add('planner-section--collapsed');

    const head = el('header', 'planner-section__head');
    if (opts.collapsed) {
      // Collapsible sections (e.g. "Recently completed") get a clickable header
      // + caret so the tasks are actually reachable, not just a count behind a
      // permanently-hidden list.
      head.classList.add('planner-section__head--toggle');
      head.setAttribute('role', 'button');
      head.tabIndex = 0;
      head.title = 'Show / hide';
      const caret = el('span', 'planner-section__caret');
      caret.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';
      head.appendChild(caret);
      const toggle = () => section.classList.toggle('planner-section--collapsed');
      head.addEventListener('click', toggle);
      head.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
      });
    }
    const titleEl = el('h2', 'planner-section__title');
    titleEl.textContent = title;
    head.appendChild(titleEl);
    const count = el('span', 'planner-section__count');
    count.textContent = String(tasks.length);
    head.appendChild(count);
    if (opts.hint) {
      const hint = el('p', 'planner-section__hint');
      hint.textContent = opts.hint;
      head.appendChild(hint);
    }
    section.appendChild(head);

    const list = el('div', 'planner-section__list');
    for (const t of tasks) list.appendChild(this._renderTaskRow(t));
    section.appendChild(list);
    return section;
  }

  private _renderTaskRow(task: PlannerTask): HTMLElement {
    const row = el('div', 'planner-task');
    row.dataset.taskId = task.id;
    if (task.status === 'done') row.classList.add('planner-task--done');

    const checkbox = el('button', 'planner-task__check');
    checkbox.type = 'button';
    checkbox.title = task.status === 'done' ? 'Mark not done' : 'Mark done';
    checkbox.innerHTML = task.status === 'done'
      ? '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>'
      : '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/></svg>';
    checkbox.addEventListener('click', () => {
      const next: TaskStatus = task.status === 'done' ? 'planned' : 'done';
      // M89 S3 — optimistic UI: flip the visuals NOW (Linear rule: common
      // actions feel instant); the data-change event repaints truth after
      // the worker-thread round-trip.
      row.classList.toggle('planner-task--done', next === 'done');
      checkbox.innerHTML = next === 'done'
        ? '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>'
        : '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/></svg>';
      void this._data.updateTask(task.id, { status: next });
    });
    row.appendChild(checkbox);

    const main = el('div', 'planner-task__main');
    const titleEl = el('span', 'planner-task__title');
    titleEl.textContent = task.title;
    titleEl.title = 'Click to edit';
    titleEl.addEventListener('click', () => this._openTaskPopover({ mode: 'edit', task }, titleEl.getBoundingClientRect()));
    main.appendChild(titleEl);
    if (task.description) {
      const desc = el('span', 'planner-task__desc');
      desc.textContent = task.description;
      main.appendChild(desc);
    }
    row.appendChild(main);

    const right = el('div', 'planner-task__right');

    if (task.dueAt) {
      const due = el('button', 'planner-task__due');
      due.type = 'button';
      due.title = 'Click to edit task';
      const overdue = task.dueAt < Date.now() && task.status !== 'done';
      if (overdue) due.classList.add('planner-task__due--overdue');
      due.textContent = formatDateShort(task.dueAt);
      due.addEventListener('click', () => this._openTaskPopover({ mode: 'edit', task }, due.getBoundingClientRect()));
      right.appendChild(due);
    } else {
      const setDue = el('button', 'planner-task__due planner-task__due--empty');
      setDue.type = 'button';
      setDue.title = 'Click to edit task';
      setDue.textContent = 'Set date';
      setDue.addEventListener('click', () => this._openTaskPopover({ mode: 'edit', task }, setDue.getBoundingClientRect()));
      right.appendChild(setDue);
    }

    if (task.status === 'reviewing') {
      const planBtn = el('button', 'planner-task__plan');
      planBtn.type = 'button';
      planBtn.title = 'Confirm date and promote to planned';
      planBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12l5 5L20 7"/></svg>';
      planBtn.addEventListener('click', () => void this._data.updateTask(task.id, { status: 'planned' }));
      right.appendChild(planBtn);
    }

    const more = el('button', 'planner-task__more');
    more.type = 'button';
    more.title = 'More';
    more.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>';
    more.addEventListener('click', () => void this._openTaskMenu(task, more.getBoundingClientRect()));
    right.appendChild(more);

    row.appendChild(right);
    return row;
  }


  private _openTaskMenu(task: PlannerTask, anchor: DOMRect): void {
    const overlay = el('div', 'planner-menu-overlay');
    overlay.addEventListener('click', () => overlay.remove());

    const menu = el('div', 'planner-menu');
    menu.style.position = 'fixed';

    const items: { label: string; action: () => void; danger?: boolean }[] = [
      { label: 'Edit task',      action: () => this._openTaskPopover({ mode: 'edit', task }, anchor) },
      { label: task.status === 'reviewing' ? 'Move to planned' : 'Move to review', action: () => void this._data.updateTask(task.id, { status: task.status === 'reviewing' ? 'planned' : 'reviewing' }) },
      { label: 'Cancel task',    action: () => void this._data.updateTask(task.id, { status: 'cancelled' }), danger: true },
      { label: 'Delete forever', action: () => void this._data.removeTask(task.id), danger: true },
    ];
    for (const it of items) {
      const btn = el('button', 'planner-menu__item');
      btn.type = 'button';
      if (it.danger) btn.classList.add('planner-menu__item--danger');
      btn.textContent = it.label;
      btn.addEventListener('click', () => { overlay.remove(); it.action(); });
      menu.appendChild(btn);
    }
    overlay.appendChild(menu);
    document.body.appendChild(overlay);

    const m = menu.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    let left = anchor.left;
    let top = anchor.bottom + 4;
    if (left + m.width > vw - 8) left = Math.max(8, vw - m.width - 8);
    if (top + m.height > vh - 8) top = Math.max(8, anchor.top - m.height - 4);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onKey); }
    };
    document.addEventListener('keydown', onKey);
  }

  private _captureNewTask(anchor?: DOMRect): void {
    const fallback = anchor ?? new DOMRect(window.innerWidth / 2 - 180, 120, 0, 0);
    this._openTaskPopover({ mode: 'create' }, fallback);
  }

  // ── Calendar tab ─────────────────────────────────────────────────────

  private async _renderCalendarTab(body: HTMLElement, actions: HTMLElement): Promise<void> {
    // Clean layout: one tight cluster of calendar controls on the left
    // (Today, prev/next, big date label, view dropdown), Create button on
    // the far right. No search/settings clutter — Settings lives in the
    // sidebar where it belongs. Every control sits on the same 28px
    // baseline so the chrome reads as one row of equal-weight elements.

    // Today — outlined sharp button, distinct from the arrow pair.
    const today = el('button', 'planner-todaybtn');
    today.type = 'button';
    today.textContent = 'Today';
    today.title = 'Jump to today (T)';
    today.addEventListener('click', () => { this._cursorDate = startOfDay(new Date()); void this._renderTab(); });
    actions.appendChild(today);

    // Prev / Next — connected icon pair.
    const nav = el('div', 'planner-cnav');
    const prev = el('button', 'planner-iconbtn');
    prev.type = 'button';
    prev.title = 'Previous (←)';
    prev.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>';
    prev.addEventListener('click', () => { this._navigateCalendar(-1); void this._renderTab(); });
    nav.appendChild(prev);
    const next = el('button', 'planner-iconbtn');
    next.type = 'button';
    next.title = 'Next (→)';
    next.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>';
    next.addEventListener('click', () => { this._navigateCalendar(1); void this._renderTab(); });
    nav.appendChild(next);
    actions.appendChild(nav);

    // Big inline date label — focal element of the left cluster.
    const dateLabel = el('span', 'planner-cdate');
    dateLabel.textContent = this._calendarRangeLabel();
    actions.appendChild(dateLabel);

    // Spacer pushes the view dropdown + Create to the far right, so the
    // header reads as two distinct clusters (navigation left, action right)
    // rather than one bunched-up row.
    const spacer = el('span', 'planner-pane__spacer');
    actions.appendChild(spacer);

    // View dropdown — right cluster.
    const viewBtn = el('button', 'planner-viewdrop');
    viewBtn.type = 'button';
    const label = this._calendarView[0].toUpperCase() + this._calendarView.slice(1);
    viewBtn.innerHTML = `<span>${label}</span><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><polyline points="6 9 12 15 18 9"/></svg>`;
    viewBtn.addEventListener('click', () => this._openViewMenu(viewBtn));
    actions.appendChild(viewBtn);

    // Sync — pull/push Google Calendar right from the planner (no trip to Settings).
    if (this._sync) {
      const sync = this._sync;
      const syncBtn = el('button', 'planner-iconbtn');
      syncBtn.type = 'button';
      syncBtn.title = 'Sync with Google Calendar';
      syncBtn.innerHTML = SYNC_SVG;
      syncBtn.addEventListener('click', async () => {
        if (syncBtn.classList.contains('planner-iconbtn--busy')) return;
        syncBtn.classList.add('planner-iconbtn--busy');
        syncBtn.disabled = true;

        // An expired/revoked Google token surfaces as a sync error. Rather than
        // a dead-end "Sync failed" toast, offer a one-click Reconnect that
        // re-runs OAuth (mints a fresh refresh token) and resumes syncing.
        const presentFailure = async (errorMsg: string): Promise<void> => {
          const authInvalid = /invalid_grant|token refresh failed|expired or revoked/i.test(errorMsg);
          if (!authInvalid) {
            await this._api.window.showErrorMessage(`Sync failed: ${errorMsg}`);
            return;
          }
          const choice = await this._api.window.showErrorMessage(
            'Google sync stopped. Your connection expired or was revoked. Reconnect to resume syncing.',
            { title: 'Reconnect' },
          );
          if (choice?.title !== 'Reconnect') return;
          const res = await googleSync.authorize();
          if (res.ok) {
            await sync.refreshProviders();
            await this._api.window.showInformationMessage('Reconnected to Google. Syncing will resume.');
          } else {
            await this._api.window.showErrorMessage(`Couldn’t reconnect: ${res.error ?? 'unknown error'}`);
          }
        };

        try {
          const results = await sync.syncNow();
          if (results.length === 0) {
            await this._api.window.showInformationMessage('No calendar connected. Connect Google Calendar in Settings → Planner.');
          } else {
            const failed = results.find(r => !r.ok);
            if (failed) {
              await presentFailure(failed.error ?? 'unknown error');
            } else {
              const changes = results.reduce((n, r) => n + r.pulledUpserts + r.pulledDeletes + r.pushed + r.pushedDeletes, 0);
              await this._api.window.showInformationMessage(changes > 0 ? `Synced ${changes} change${changes === 1 ? '' : 's'}.` : 'Synced. Already up to date.');
            }
          }
        } catch (err) {
          await presentFailure(err instanceof Error ? err.message : String(err));
        } finally {
          syncBtn.classList.remove('planner-iconbtn--busy');
          syncBtn.disabled = false;
          void this._renderTab();
        }
      });
      actions.appendChild(syncBtn);
    }

    // Calendars — manage colours, visibility, and create new calendars.
    const calsBtn = el('button', 'planner-iconbtn');
    calsBtn.type = 'button';
    calsBtn.title = 'Calendars';
    calsBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>';
    calsBtn.addEventListener('click', () => void this._openCalendarsMenu(calsBtn.getBoundingClientRect()));
    actions.appendChild(calsBtn);

    // Primary CTA.
    const addEvt = el('button', 'planner-cta');
    addEvt.type = 'button';
    addEvt.title = 'Create event (C)';
    addEvt.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg><span>Create</span>';
    addEvt.addEventListener('click', () => {
      const start = new Date(this._cursorDate);
      start.setHours(9, 0, 0, 0);
      this._openEventPopover({
        mode: 'create',
        startAt: start.getTime(),
        endAt: start.getTime() + 60 * 60 * 1000,
      }, addEvt.getBoundingClientRect());
    });
    actions.appendChild(addEvt);

    if (this._calendarView === 'month') await this._renderMonthView(body);
    else if (this._calendarView === 'week') await this._renderWeekView(body);
    else await this._renderDayView(body);
  }

  /** Dropdown menu for Month / Week / Day — replaces the inline tab strip. */
  private _openViewMenu(anchorBtn: HTMLElement): void {
    const overlay = el('div', 'planner-menu-overlay');
    overlay.addEventListener('click', () => overlay.remove());
    const menu = el('div', 'planner-menu planner-menu--narrow');
    menu.style.position = 'fixed';

    for (const v of ['month', 'week', 'day'] as CalendarView[]) {
      const item = el('button', 'planner-menu__item');
      item.type = 'button';
      const labelText = v[0].toUpperCase() + v.slice(1);
      const check = v === this._calendarView ? '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>' : '<span style="display:inline-block;width:13px"></span>';
      item.innerHTML = `${check}<span>${labelText}</span>`;
      item.addEventListener('click', () => {
        overlay.remove();
        this._setCalendarView(v);
        void this._renderTab();
      });
      menu.appendChild(item);
    }

    overlay.appendChild(menu);
    document.body.appendChild(overlay);

    const a = anchorBtn.getBoundingClientRect();
    const m = menu.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    let left = a.left;
    let top = a.bottom + 4;
    if (left + m.width > vw - 8) left = Math.max(8, vw - m.width - 8);
    if (top + m.height > vh - 8) top = Math.max(8, a.top - m.height - 4);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onKey); }
    };
    document.addEventListener('keydown', onKey);
  }

  /** Set the calendar view and persist it per-workspace (M86). */
  private _setCalendarView(v: CalendarView): void {
    this._calendarView = v;
    this._api.viewState?.set('planner.calendarView', v);
  }

  private _navigateCalendar(direction: -1 | 1): void {
    const d = new Date(this._cursorDate);
    if (this._calendarView === 'month') {
      d.setMonth(d.getMonth() + direction);
    } else if (this._calendarView === 'week') {
      d.setDate(d.getDate() + direction * 7);
    } else {
      d.setDate(d.getDate() + direction);
    }
    this._cursorDate = startOfDay(d);
  }

  private _calendarRangeLabel(): string {
    if (this._calendarView === 'month') {
      return this._cursorDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    }
    if (this._calendarView === 'week') {
      const start = startOfWeek(this._cursorDate);
      const end = addDays(start, 6);
      const same = start.getMonth() === end.getMonth();
      return same
        ? `${start.toLocaleDateString(undefined, { month: 'long' })} ${start.getDate()}–${end.getDate()}, ${start.getFullYear()}`
        : `${start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${end.getFullYear()}`;
    }
    return this._cursorDate.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  }

  // ── Calendar colour + visibility context ────────────────────────────
  //
  // Resolves which calendars are currently shown and each item's display
  // colour (event/task override → calendar colour → fallback). Loaded once
  // per render so every view filters + colours consistently. Tolerates an
  // empty / missing calendars table (treats everything as visible).
  private async _loadCalCtx(): Promise<{
    isVisible: (calendarId: string | null) => boolean;
    colorOf: (calendarId: string | null, override: string | null) => string;
  }> {
    let cals: PlannerCalendar[] = [];
    try { cals = await this._data.listCalendars(); } catch { /* table may be empty */ }
    const byId = new Map(cals.map(c => [c.id, c] as const));
    const visibleIds = new Set(cals.filter(c => c.visible).map(c => c.id));
    const isVisible = (calendarId: string | null): boolean => {
      // Unknown / unset calendar → always show (never silently swallow an item).
      if (calendarId == null || !byId.has(calendarId)) return true;
      return visibleIds.has(calendarId);
    };
    const colorOf = (calendarId: string | null, override: string | null): string =>
      override || (calendarId != null ? byId.get(calendarId)?.color : undefined) || '#4c8bf5';
    return { isVisible, colorOf };
  }

  /** Dated, visible tasks intersecting [from, to] — rendered alongside events. */
  private async _tasksInWindow(from: number, to: number, isVisible: (calendarId: string | null) => boolean): Promise<PlannerTask[]> {
    const tasks = await this._data.listTasks({ status: ['reviewing', 'planned', 'done'], dueFrom: from, dueTo: to, limit: 500 });
    return tasks.filter(t => t.dueAt != null && isVisible(t.calendarId));
  }

  /** Month-cell chip for a task — colour-coded, check glyph, opens the task popover. */
  private _renderCalTaskChip(task: PlannerTask, color: string): HTMLElement {
    const chip = el('button', 'planner-month__chip planner-month__chip--task');
    chip.type = 'button';
    chip.style.setProperty('--cal-color', color);
    if (task.status === 'done') chip.classList.add('planner-month__chip--done');
    const icon = el('span', 'planner-month__chipcheck');
    icon.innerHTML = task.status === 'done' ? TASK_DONE_SVG : TASK_DOT_SVG;
    chip.appendChild(icon);
    const label = el('span', 'planner-month__chiptext');
    label.textContent = task.title;
    chip.appendChild(label);
    chip.title = task.dueAt ? `${task.title}\nDue ${formatTimeShort(task.dueAt)}` : task.title;
    chip.addEventListener('click', (e) => { e.stopPropagation(); this._openTaskPopover({ mode: 'edit', task }, chip.getBoundingClientRect()); });
    return chip;
  }

  /** Thin time-column pill for a dated task in week / day views. */
  private _renderCalTaskPill(task: PlannerTask, color: string, variant: 'week' | 'day', dayStart: number): HTMLElement {
    const topPct = ((task.dueAt! - dayStart) / (24 * 3_600_000)) * 100;
    const pill = el('button', `planner-${variant}__task`);
    pill.type = 'button';
    pill.style.top = `${topPct}%`;
    pill.style.setProperty('--cal-color', color);
    if (task.status === 'done') pill.classList.add(`planner-${variant}__task--done`);
    pill.title = `${task.title}\nDue ${formatTimeShort(task.dueAt!)}`;
    pill.innerHTML = `<span class="planner-${variant}__task-check">${task.status === 'done' ? TASK_DONE_SVG : TASK_DOT_SVG}</span><span class="planner-${variant}__task-title">${escapeHtml(task.title)}</span>`;
    pill.addEventListener('click', (e) => { e.stopPropagation(); this._openTaskPopover({ mode: 'edit', task }, pill.getBoundingClientRect()); });
    return pill;
  }

  /** Absolutely-positioned event bar for week / day columns. */
  private _buildEventBar(
    ev: PlannerEvent,
    variant: 'week' | 'day',
    dayStart: number,
    dayEnd: number,
    colorOf: (calendarId: string | null, override: string | null) => string,
  ): HTMLElement {
    const DAY_MS = 24 * 3_600_000;
    const evStart = Math.max(ev.startAt, dayStart);
    const evEnd = Math.min(ev.endAt, dayEnd);
    const topPct = ((evStart - dayStart) / DAY_MS) * 100;
    const heightPct = Math.max(variant === 'day' ? 3 : 2, ((evEnd - evStart) / DAY_MS) * 100);
    const bar = el('button', `planner-${variant}__event`);
    bar.type = 'button';
    // Inset 1px top + bottom so back-to-back events (one ends as the next begins)
    // show a hairline gap instead of reading as a single fused block.
    bar.style.top = `calc(${topPct}% + 1px)`;
    bar.style.height = `calc(${heightPct}% - 2px)`;
    bar.style.setProperty('--cal-color', colorOf(ev.calendarId, ev.color));
    // Past events (already ended) render faded — the only special-case styling
    // on an event, matching Google Calendar.
    if (ev.endAt < Date.now()) bar.classList.add(`planner-${variant}__event--past`);
    bar.title = `${ev.title}\n${formatTimeRange(ev)}`;
    bar.innerHTML = variant === 'day'
      ? `
        <span class="planner-day__event-time">${escapeHtml(formatTimeRange(ev))}</span>
        <strong class="planner-day__event-title">${escapeHtml(ev.title)}</strong>
        ${ev.location ? `<span class="planner-day__event-loc">${escapeHtml(ev.location)}</span>` : ''}
      `
      : `<strong>${escapeHtml(ev.title)}</strong><span>${escapeHtml(formatTimeRange(ev))}</span>`;
    // Direct manipulation: drag the body to move (and, in week view, change
    // day), drag the top / bottom edge to resize. A bare click (no drag) opens
    // the editor. Series occurrences drag too — the commit prompts the
    // this/following/all scope (_commitEventMove).
    this._installEventInteractions(bar, ev, variant);
    return bar;
  }

  /**
   * Drag-to-move + drag-to-resize for a timed event bar. Mirrors Google /
   * Apple / Outlook: grab the body to reposition (vertical = time, and in
   * week view horizontal = day), grab the thin top / bottom edges to
   * change just the start or end. Snaps to 15 minutes. A movement under the
   * threshold is treated as a click and opens the editor instead.
   */
  /**
   * Ask which occurrences a series change applies to (Google-parity). Resolves
   * to the chosen scope, or null if cancelled.
   */
  private _askSeriesScope(kind: 'edit' | 'delete', anchor: DOMRect): Promise<SeriesEditScope | null> {
    return new Promise((resolve) => {
      let settled = false;
      const overlay = el('div', 'planner-popover-overlay');
      const done = (scope: SeriesEditScope | null): void => {
        if (settled) return;
        settled = true;
        try { overlay.remove(); } catch { /* noop */ }
        document.removeEventListener('keydown', onKey);
        resolve(scope);
      };
      overlay.addEventListener('click', (e) => { if (e.target === overlay) done(null); });

      const pop = el('div', 'planner-popover planner-scope-menu');
      pop.style.position = 'fixed';
      const head = el('div', 'planner-popover__head');
      const heading = el('h3', 'planner-popover__title');
      heading.textContent = kind === 'delete' ? 'Delete recurring event' : 'Edit recurring event';
      head.appendChild(heading);
      pop.appendChild(head);

      const bodyEl = el('div', 'planner-scope-body');
      const opts: { scope: SeriesEditScope; label: string }[] = [
        { scope: 'this', label: 'This event' },
        { scope: 'following', label: 'This and following events' },
        { scope: 'all', label: 'All events' },
      ];
      for (const o of opts) {
        const btn = el('button', 'planner-scope-opt');
        btn.type = 'button';
        btn.textContent = o.label;
        btn.addEventListener('click', () => done(o.scope));
        bodyEl.appendChild(btn);
      }
      pop.appendChild(bodyEl);

      const foot = el('div', 'planner-popover__foot');
      const spacer = el('span', 'planner-popover__spacer');
      foot.appendChild(spacer);
      const cancel = el('button', 'planner-popover__btn');
      cancel.type = 'button';
      cancel.textContent = 'Cancel';
      cancel.addEventListener('click', () => done(null));
      foot.appendChild(cancel);
      pop.appendChild(foot);

      const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') done(null); };
      document.addEventListener('keydown', onKey);

      overlay.appendChild(pop);
      document.body.appendChild(overlay);
      const m = pop.getBoundingClientRect();
      const vw = window.innerWidth, vh = window.innerHeight;
      const left = Math.max(12, Math.min(anchor.left, vw - m.width - 12));
      let top = anchor.bottom + 6;
      if (top + m.height > vh - 12) top = Math.max(12, anchor.top - m.height - 6);
      pop.style.left = `${left}px`;
      pop.style.top = `${top}px`;
    });
  }

  /**
   * Commit a drag-move/resize. Non-series events update directly; a series
   * occurrence prompts the this/following/all scope and routes accordingly.
   * A cancelled prompt re-renders so the dragged bar snaps back.
   */
  private async _commitEventMove(ev: PlannerEvent, patch: UpdateEventInput, anchor: DOMRect): Promise<void> {
    if (ev.seriesId) {
      const scope = await this._askSeriesScope('edit', anchor);
      if (!scope) { void this._renderTab(); return; }
      await this._data.applySeriesEdit(ev.id, patch, scope);
    } else {
      await this._data.updateEvent(ev.id, patch);
    }
  }

  /**
   * Month-view drag: drop an event chip on another day cell to move it by whole
   * days (time-of-day preserved). A sub-threshold press opens the editor instead.
   */
  private _installMonthChipDrag(chip: HTMLElement, ev: PlannerEvent, sourceDayStart: number): void {
    const THRESHOLD_PX = 4;
    chip.classList.add('planner-month__chip--draggable');
    // Swallow the click so a chip press never drills the cell into day view.
    chip.addEventListener('click', (e) => e.stopPropagation());

    chip.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startY = e.clientY;
      let dragging = false;
      let targetDayStart = sourceDayStart;

      const clearDrop = (): void => {
        for (const c of Array.from(document.querySelectorAll('.planner-month__cell--drop'))) {
          c.classList.remove('planner-month__cell--drop');
        }
      };
      const onMove = (pe: PointerEvent): void => {
        if (!dragging) {
          if (Math.abs(pe.clientX - startX) > THRESHOLD_PX || Math.abs(pe.clientY - startY) > THRESHOLD_PX) dragging = true;
          else return;
        }
        chip.classList.add('planner-evt--dragging');
        clearDrop();
        const under = document.elementFromPoint(pe.clientX, pe.clientY) as HTMLElement | null;
        const cell = under?.closest('.planner-month__cell') as HTMLElement | null;
        if (cell?.dataset.dayStart) {
          targetDayStart = Number(cell.dataset.dayStart);
          cell.classList.add('planner-month__cell--drop');
        }
      };
      const onUp = (pe: PointerEvent): void => {
        chip.removeEventListener('pointermove', onMove);
        chip.removeEventListener('pointerup', onUp);
        chip.removeEventListener('pointercancel', onUp);
        try { chip.releasePointerCapture(pe.pointerId); } catch { /* ok */ }
        chip.classList.remove('planner-evt--dragging');
        clearDrop();
        if (!dragging) {
          this._openEventPopover({ mode: 'edit', event: ev }, chip.getBoundingClientRect());
          return;
        }
        const dayDelta = targetDayStart - sourceDayStart;
        if (dayDelta !== 0) {
          void this._commitEventMove(ev, { startAt: ev.startAt + dayDelta, endAt: ev.endAt + dayDelta }, chip.getBoundingClientRect());
        }
      };

      try { chip.setPointerCapture(e.pointerId); } catch { /* ok */ }
      chip.addEventListener('pointermove', onMove);
      chip.addEventListener('pointerup', onUp);
      chip.addEventListener('pointercancel', onUp);
    });
  }

  private _installEventInteractions(bar: HTMLElement, ev: PlannerEvent, variant: 'week' | 'day'): void {
    const SNAP_MS = 15 * 60_000;
    const DAY_MS = 24 * 3_600_000;
    const MIN_MS = 15 * 60_000;
    const THRESHOLD_PX = 4;

    const topHandle = el('div', 'planner-evt-handle planner-evt-handle--top');
    const botHandle = el('div', 'planner-evt-handle planner-evt-handle--bottom');
    bar.appendChild(topHandle);
    bar.appendChild(botHandle);

    bar.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const target = e.target as HTMLElement;
      const mode: 'move' | 'resize-start' | 'resize-end' =
        target === topHandle ? 'resize-start' : target === botHandle ? 'resize-end' : 'move';

      const originCol = bar.parentElement as HTMLElement | null;
      if (!originCol) return;
      const colRect = originCol.getBoundingClientRect();
      const pxPerMs = colRect.height / DAY_MS;
      const duration = ev.endAt - ev.startAt;
      const originDayStart = Number(originCol.dataset.dayStart) || startOfDay(new Date(ev.startAt)).getTime();

      // Week view can move across day columns; collect them once.
      const body = variant === 'week' ? bar.closest('.planner-week__body') as HTMLElement | null : null;
      const cols = body ? (Array.from(body.querySelectorAll('.planner-week__col')) as HTMLElement[]) : [originCol];

      const startClientX = e.clientX;
      const startClientY = e.clientY;
      let dragging = false;
      let targetCol = originCol;
      let curStart = ev.startAt;
      let curEnd = ev.endAt;

      const snap = (ms: number) => Math.round(ms / SNAP_MS) * SNAP_MS;

      const apply = (pe: PointerEvent) => {
        const deltaMs = (pe.clientY - startClientY) / pxPerMs;
        if (mode === 'move') {
          let dayDeltaMs = 0;
          if (variant === 'week' && cols.length > 1) {
            const hit = cols.find(c => {
              const r = c.getBoundingClientRect();
              return pe.clientX >= r.left && pe.clientX <= r.right;
            });
            if (hit && hit.dataset.dayStart) {
              dayDeltaMs = Number(hit.dataset.dayStart) - originDayStart;
              targetCol = hit;
            }
          }
          curStart = snap(ev.startAt + deltaMs + dayDeltaMs);
          curEnd = curStart + duration;
        } else if (mode === 'resize-start') {
          curStart = Math.min(ev.endAt - MIN_MS, snap(ev.startAt + deltaMs));
          curEnd = ev.endAt;
        } else {
          curEnd = Math.max(ev.startAt + MIN_MS, snap(ev.endAt + deltaMs));
          curStart = ev.startAt;
        }

        const tcStart = Number(targetCol.dataset.dayStart) || originDayStart;
        if (targetCol !== bar.parentElement) targetCol.appendChild(bar);
        bar.style.top = `${((curStart - tcStart) / DAY_MS) * 100}%`;
        bar.style.height = `${((curEnd - curStart) / DAY_MS) * 100}%`;
        bar.classList.add('planner-evt--dragging');
        bar.title = `${formatTimeShort(curStart)} – ${formatTimeShort(curEnd)}`;
      };

      const onMove = (pe: PointerEvent) => {
        if (!dragging) {
          if (Math.abs(pe.clientX - startClientX) > THRESHOLD_PX || Math.abs(pe.clientY - startClientY) > THRESHOLD_PX) {
            dragging = true;
          } else return;
        }
        apply(pe);
      };
      const onUp = (pe: PointerEvent) => {
        bar.removeEventListener('pointermove', onMove);
        bar.removeEventListener('pointerup', onUp);
        bar.removeEventListener('pointercancel', onUp);
        try { bar.releasePointerCapture(pe.pointerId); } catch { /* ok */ }
        bar.classList.remove('planner-evt--dragging');
        if (!dragging) {
          this._openEventPopover({ mode: 'edit', event: ev }, bar.getBoundingClientRect());
          return;
        }
        if (curStart !== ev.startAt || curEnd !== ev.endAt) {
          void this._commitEventMove(ev, { startAt: curStart, endAt: curEnd }, bar.getBoundingClientRect());
        }
      };

      try { bar.setPointerCapture(e.pointerId); } catch { /* ok */ }
      bar.addEventListener('pointermove', onMove);
      bar.addEventListener('pointerup', onUp);
      bar.addEventListener('pointercancel', onUp);
    });
  }

  /**
   * Lay out a day's events + dated tasks into the time column. Items that
   * overlap in time are packed into side-by-side lanes (Google-style) so
   * nothing renders on top of anything else; a task is treated as a short
   * nominal block for collision purposes while keeping its thin pill shape.
   */
  private _layoutTimedItems(
    container: HTMLElement,
    variant: 'week' | 'day',
    dayStart: number,
    dayEnd: number,
    events: readonly PlannerEvent[],
    tasks: readonly PlannerTask[],
    colorOf: (calendarId: string | null, override: string | null) => string,
  ): void {
    const TASK_NOMINAL_MS = 30 * 60_000;
    type Entry =
      | { kind: 'event'; ev: PlannerEvent; startMs: number; endMs: number }
      | { kind: 'task'; task: PlannerTask; startMs: number; endMs: number };

    const entries: Entry[] = [];
    for (const ev of events) {
      if (!(ev.startAt <= dayEnd && ev.endAt >= dayStart)) continue;
      entries.push({ kind: 'event', ev, startMs: Math.max(ev.startAt, dayStart), endMs: Math.min(ev.endAt, dayEnd) });
    }
    for (const t of tasks) {
      if (t.dueAt == null || !(t.dueAt >= dayStart && t.dueAt <= dayEnd)) continue;
      entries.push({ kind: 'task', task: t, startMs: t.dueAt, endMs: Math.min(dayEnd, t.dueAt + TASK_NOMINAL_MS) });
    }

    for (const { item, lane, laneCount } of packLanes(entries)) {
      const node = item.kind === 'event'
        ? this._buildEventBar(item.ev, variant, dayStart, dayEnd, colorOf)
        : this._renderCalTaskPill(item.task, colorOf(item.task.calendarId, item.task.color), variant, dayStart);
      if (laneCount > 1) {
        // Split the column; 2px inset on each side keeps a hairline gutter.
        node.style.left = `calc(${(lane / laneCount) * 100}% + 2px)`;
        node.style.width = `calc(${100 / laneCount}% - 4px)`;
        node.style.right = 'auto';
      }
      container.appendChild(node);
    }
  }

  // ── All-day band (Outlook-style) ────────────────────────────────────

  /**
   * An event belongs in the all-day band when it's flagged all-day or when
   * it spans more than one calendar day (a multi-day event). Keeping these
   * out of the timed grid is what stops a several-day event from crowding
   * every hour of every column.
   */
  private _isAllDayLike(ev: PlannerEvent): boolean {
    if (ev.allDay) return true;
    return !sameDay(new Date(ev.startAt), new Date(ev.endAt));
  }

  /** Inclusive day index (0-6) of a timestamp within the visible week. */
  private _weekDayIndex(ms: number, weekStartMs: number): number {
    return Math.floor((startOfDay(new Date(ms)).getTime() - weekStartMs) / 86_400_000);
  }

  /**
   * The horizontal all-day band that sits between the weekday header and the
   * time grid. Multi-day events render as bars spanning their day range,
   * stacked into rows so they never overlap. Dragging across empty cells
   * creates a new all-day event; existing bars can be dragged to move or
   * resized from either edge.
   */
  private _renderWeekAllDayBand(
    host: HTMLElement,
    weekStart: Date,
    allDayEvents: readonly PlannerEvent[],
    colorOf: (calendarId: string | null, override: string | null) => string,
  ): void {
    const ROW_H = 22;
    const weekStartMs = weekStart.getTime();
    const weekEndMs = addDays(weekStart, 7).getTime();

    const band = el('div', 'planner-week__allday');
    const gutter = el('div', 'planner-week__allday-gutter');
    gutter.textContent = 'all-day';
    band.appendChild(gutter);

    const grid = el('div', 'planner-week__allday-grid');
    band.appendChild(grid);

    // Background day cells — these are the drag-create surface.
    for (let i = 0; i < 7; i++) {
      const cell = el('div', 'planner-week__allday-cell');
      cell.dataset.dayIndex = String(i);
      if (sameDay(addDays(weekStart, i), new Date())) cell.classList.add('planner-week__allday-cell--today');
      grid.appendChild(cell);
    }

    // Lane-pack the bars by day-range overlap.
    const visible = allDayEvents
      .filter(ev => ev.startAt < weekEndMs && ev.endAt >= weekStartMs)
      .sort((a, b) => a.startAt - b.startAt);
    const laneEnds: number[] = []; // last endCol occupied per lane
    let maxLane = 0;
    for (const ev of visible) {
      const startCol = Math.max(0, this._weekDayIndex(ev.startAt, weekStartMs));
      const endCol = Math.min(6, this._weekDayIndex(ev.endAt, weekStartMs));
      let lane = laneEnds.findIndex(end => startCol > end);
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(endCol); }
      else laneEnds[lane] = endCol;
      maxLane = Math.max(maxLane, lane);

      const span = endCol - startCol + 1;
      const bar = el('button', 'planner-week__alldaybar');
      bar.type = 'button';
      bar.style.left = `calc(${(startCol / 7) * 100}% + 2px)`;
      bar.style.width = `calc(${(span / 7) * 100}% - 4px)`;
      bar.style.top = `${lane * ROW_H + 2}px`;
      bar.style.setProperty('--cal-color', colorOf(ev.calendarId, ev.color));
      const continuesLeft = ev.startAt < weekStartMs;
      const continuesRight = ev.endAt >= weekEndMs;
      if (continuesLeft) bar.classList.add('planner-week__alldaybar--clip-left');
      if (continuesRight) bar.classList.add('planner-week__alldaybar--clip-right');
      bar.innerHTML = `<span class="planner-week__alldaybar-title">${escapeHtml(ev.title)}</span>`;
      bar.title = ev.title;
      // Series occurrences drag too — the commit prompts this/following/all.
      this._installAllDayBarInteractions(bar, ev, grid, weekStartMs);
      grid.appendChild(bar);
    }

    grid.style.minHeight = `${(maxLane + 1) * ROW_H + 6}px`;
    this._installAllDayDragCreate(grid, weekStart);
    host.appendChild(band);
  }

  /** Drag across empty all-day cells to create a multi-day all-day event. */
  private _installAllDayDragCreate(grid: HTMLElement, weekStart: Date): void {
    const THRESHOLD_PX = 3;
    grid.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      if (!(e.target instanceof HTMLElement) || !e.target.classList.contains('planner-week__allday-cell')) return;
      e.preventDefault();

      const gridRect = grid.getBoundingClientRect();
      const colW = gridRect.width / 7;
      const xToCol = (x: number) => Math.max(0, Math.min(6, Math.floor((x - gridRect.left) / colW)));
      const startCol = xToCol(e.clientX);
      let endCol = startCol;
      let moved = false;

      const ghost = el('div', 'planner-week__allday-ghost');
      grid.appendChild(ghost);
      const drawGhost = () => {
        const a = Math.min(startCol, endCol), b = Math.max(startCol, endCol);
        ghost.style.left = `calc(${(a / 7) * 100}% + 2px)`;
        ghost.style.width = `calc(${((b - a + 1) / 7) * 100}% - 4px)`;
      };
      drawGhost();

      try { grid.setPointerCapture(e.pointerId); } catch { /* ok */ }
      const onMove = (pe: PointerEvent) => {
        if (Math.abs(pe.clientX - e.clientX) > THRESHOLD_PX) moved = true;
        endCol = xToCol(pe.clientX);
        drawGhost();
      };
      const onUp = (pe: PointerEvent) => {
        grid.removeEventListener('pointermove', onMove);
        grid.removeEventListener('pointerup', onUp);
        grid.removeEventListener('pointercancel', onUp);
        try { grid.releasePointerCapture(pe.pointerId); } catch { /* ok */ }
        const a = Math.min(startCol, endCol), b = Math.max(startCol, endCol);
        const startMs = startOfDay(addDays(weekStart, a)).getTime();
        const endMs = endOfDay(addDays(weekStart, b)).getTime();
        const anchor = ghost.getBoundingClientRect();
        this._openEventPopover({ mode: 'create', startAt: startMs, endAt: endMs, allDay: true, pendingGhost: ghost }, anchor);
        void moved;
      };
      grid.addEventListener('pointermove', onMove);
      grid.addEventListener('pointerup', onUp);
      grid.addEventListener('pointercancel', onUp);
    });
  }

  /** Move / resize an existing all-day bar by whole-day steps. */
  private _installAllDayBarInteractions(bar: HTMLElement, ev: PlannerEvent, grid: HTMLElement, weekStartMs: number): void {
    const DAY_MS = 86_400_000;
    const THRESHOLD_PX = 4;
    const leftHandle = el('div', 'planner-evt-handle planner-evt-handle--left');
    const rightHandle = el('div', 'planner-evt-handle planner-evt-handle--right');
    bar.appendChild(leftHandle);
    bar.appendChild(rightHandle);

    bar.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const target = e.target as HTMLElement;
      const mode: 'move' | 'resize-start' | 'resize-end' =
        target === leftHandle ? 'resize-start' : target === rightHandle ? 'resize-end' : 'move';

      const gridRect = grid.getBoundingClientRect();
      const colW = gridRect.width / 7;
      const startClientX = e.clientX;
      let dragging = false;
      let curStart = ev.startAt;
      let curEnd = ev.endAt;

      const apply = (pe: PointerEvent) => {
        const dayDelta = Math.round((pe.clientX - startClientX) / colW);
        if (mode === 'move') {
          curStart = ev.startAt + dayDelta * DAY_MS;
          curEnd = ev.endAt + dayDelta * DAY_MS;
        } else if (mode === 'resize-start') {
          const ns = startOfDay(new Date(ev.startAt + dayDelta * DAY_MS)).getTime();
          curStart = Math.min(ns, startOfDay(new Date(ev.endAt)).getTime());
          curEnd = ev.endAt;
        } else {
          const ne = endOfDay(new Date(ev.endAt + dayDelta * DAY_MS)).getTime();
          curEnd = Math.max(ne, endOfDay(new Date(ev.startAt)).getTime());
          curStart = ev.startAt;
        }
        const startCol = Math.max(0, this._weekDayIndex(curStart, weekStartMs));
        const endCol = Math.min(6, this._weekDayIndex(curEnd, weekStartMs));
        bar.style.left = `calc(${(startCol / 7) * 100}% + 2px)`;
        bar.style.width = `calc(${((endCol - startCol + 1) / 7) * 100}% - 4px)`;
        bar.classList.add('planner-evt--dragging');
      };
      const onMove = (pe: PointerEvent) => {
        if (!dragging) {
          if (Math.abs(pe.clientX - startClientX) > THRESHOLD_PX) dragging = true;
          else return;
        }
        apply(pe);
      };
      const onUp = (pe: PointerEvent) => {
        bar.removeEventListener('pointermove', onMove);
        bar.removeEventListener('pointerup', onUp);
        bar.removeEventListener('pointercancel', onUp);
        try { bar.releasePointerCapture(pe.pointerId); } catch { /* ok */ }
        bar.classList.remove('planner-evt--dragging');
        if (!dragging) {
          this._openEventPopover({ mode: 'edit', event: ev }, bar.getBoundingClientRect());
          return;
        }
        if (curStart !== ev.startAt || curEnd !== ev.endAt) {
          void this._commitEventMove(ev, { startAt: curStart, endAt: curEnd, allDay: true }, bar.getBoundingClientRect());
        }
      };
      try { bar.setPointerCapture(e.pointerId); } catch { /* ok */ }
      bar.addEventListener('pointermove', onMove);
      bar.addEventListener('pointerup', onUp);
      bar.addEventListener('pointercancel', onUp);
    });
  }

  /** Compact all-day strip for the single-day view. */
  private _renderDayAllDaySection(
    host: HTMLElement,
    day: Date,
    allDayEvents: readonly PlannerEvent[],
    colorOf: (calendarId: string | null, override: string | null) => string,
  ): void {
    const dayStart = startOfDay(day).getTime();
    const dayEnd = endOfDay(day).getTime();
    const todays = allDayEvents.filter(ev => ev.startAt <= dayEnd && ev.endAt >= dayStart);

    const band = el('div', 'planner-day__allday');
    const gutter = el('div', 'planner-day__allday-gutter');
    gutter.textContent = 'all-day';
    band.appendChild(gutter);
    const list = el('div', 'planner-day__allday-list');
    band.appendChild(list);

    for (const ev of todays) {
      const chip = el('button', 'planner-day__alldaybar');
      chip.type = 'button';
      chip.style.setProperty('--cal-color', colorOf(ev.calendarId, ev.color));
      chip.innerHTML = `<span class="planner-week__alldaybar-title">${escapeHtml(ev.title)}</span>`;
      chip.title = ev.title;
      chip.addEventListener('click', () => this._openEventPopover({ mode: 'edit', event: ev }, chip.getBoundingClientRect()));
      list.appendChild(chip);
    }
    // Click the empty strip to add an all-day event for this day.
    list.addEventListener('click', (e) => {
      if (e.target !== list) return;
      this._openEventPopover({ mode: 'create', startAt: dayStart, endAt: dayEnd, allDay: true }, list.getBoundingClientRect());
    });
    host.appendChild(band);
  }

  // ── Description links (notes + clickable links) ─────────────────────

  /**
   * Render any links found in a description as clickable chips below the
   * notes field, live-updating as the user types. Lets a description double
   * as a notes scratchpad with real, openable references — external study
   * URLs as well as internal `parallx://` links (e.g. a canvas page with
   * review notes), which resolve to the page's title + icon.
   */
  private _attachDescriptionLinks(body: HTMLElement, descInput: HTMLTextAreaElement): void {
    const row = el('div', 'planner-popover__links');
    body.appendChild(row);
    const render = () => {
      row.innerHTML = '';
      const links = extractLinks(descInput.value);
      if (links.length === 0) { row.style.display = 'none'; return; }
      row.style.display = '';
      for (const link of links) {
        const chip = el('button', 'planner-popover__linkchip');
        if (link.kind === 'internal') chip.classList.add('planner-popover__linkchip--internal');
        chip.type = 'button';
        chip.title = link.href;
        const labelSpan = el('span', 'planner-popover__linkchip-label');
        labelSpan.textContent = link.label;
        chip.innerHTML = link.kind === 'internal' ? LINK_DOC_SVG : LINK_WEB_SVG;
        chip.appendChild(labelSpan);
        if (link.kind === 'internal') {
          chip.addEventListener('click', () => void this._api.links.open(link.href));
          // Resolve the page title/icon lazily so the chip reads naturally.
          void this._labelInternalChip(chip, labelSpan, link.href);
        } else {
          chip.addEventListener('click', () => void this._openExternalLink(link.href));
        }
        row.appendChild(chip);
      }
    };
    descInput.addEventListener('input', render);
    render();
  }

  /** Replace a raw internal-link chip label with the target's title + icon. */
  private async _labelInternalChip(chip: HTMLElement, labelSpan: HTMLElement, uri: string): Promise<void> {
    try {
      const meta = await this._api.links.resolveMetadata(uri);
      if (!meta) { chip.classList.add('planner-popover__linkchip--missing'); return; }
      labelSpan.textContent = meta.title;
      chip.title = meta.title;
      if (meta.icon) {
        // LinkMetadata.icon is a registry icon id (system UI never uses
        // emoji). Unknown ids fall back to rendering the raw string so
        // legacy providers still show something.
        const iconSpan = el('span', 'planner-popover__linkchip-icon');
        const svg = getIcon(meta.icon);
        if (svg) iconSpan.innerHTML = svg;
        else iconSpan.textContent = meta.icon;
        chip.querySelector('svg')?.replaceWith(iconSpan);
      }
    } catch {
      // Leave the raw label in place on failure — chip is still clickable.
    }
  }

  /** Open an http/https link in the user's external browser, safely. */
  private async _openExternalLink(rawUrl: string): Promise<void> {
    const url = normalizeWebLink(rawUrl);
    if (!url) return;
    try {
      const shell = (window as { parallxElectron?: { shell?: { openExternal?: (u: string) => Promise<{ ok?: boolean; error?: string } | void> } } }).parallxElectron?.shell;
      if (shell?.openExternal) {
        const result = await shell.openExternal(url);
        if (result && typeof result === 'object' && result.ok === false) throw new Error(result.error || 'openExternal failed');
        return;
      }
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      console.error('[PlannerEditorPane] open link failed:', err);
      await this._api.window.showErrorMessage('Failed to open link.');
    }
  }

  /**
   * A compact toolbar below the notes field. Currently offers "Link canvas
   * page" — the bridge between study notes (canvas) and the plan (events
   * and tasks). Kept minimal so notes stay lightweight.
   */
  private _appendNotesToolbar(body: HTMLElement, descInput: HTMLTextAreaElement): void {
    const bar = el('div', 'planner-popover__notesbar');
    const linkBtn = el('button', 'planner-popover__notesbtn');
    linkBtn.type = 'button';
    linkBtn.innerHTML = `${LINK_PLUS_SVG}<span>Link canvas page</span>`;
    linkBtn.title = 'Attach a canvas page to these notes';
    linkBtn.addEventListener('click', () => void this._linkCanvasPage(descInput));
    bar.appendChild(linkBtn);
    body.appendChild(bar);
  }

  /**
   * Open the canvas page picker and append the chosen page's link to the
   * notes field. Decoupled from the canvas schema — the link contract and
   * the `canvas.pickPageLink` command do the resolution.
   */
  private async _linkCanvasPage(descInput: HTMLTextAreaElement): Promise<void> {
    let result: { uri: string; title: string; icon: string | null } | null = null;
    try {
      result = await this._api.commands.executeCommand('canvas.pickPageLink');
    } catch (err) {
      console.error('[PlannerEditorPane] canvas.pickPageLink failed:', err);
      await this._api.window.showErrorMessage('Could not open the canvas page picker.');
      return;
    }
    if (!result) return;
    const current = descInput.value;
    const sep = current.length === 0 ? '' : (current.endsWith('\n') ? '' : '\n');
    descInput.value = `${current}${sep}${result.uri}`;
    // Fire input so the link chips re-render and any caller-bound listeners run.
    descInput.dispatchEvent(new Event('input', { bubbles: true }));
    descInput.focus();
  }

  /**
   * M98 — gather per-day loads from every registered provider for the given
   * window, keyed by LOCAL day start. Provider failures are isolated: a
   * throwing provider contributes nothing and cannot break the calendar.
   */
  private async _collectDayLoads(fromMs: number, toMs: number): Promise<Map<number, { count: number; label: string }[]>> {
    const byDay = new Map<number, { count: number; label: string }[]>();
    const providers = this._api.dayLoads?.get() ?? [];
    if (providers.length === 0) return byDay;
    // Per-provider timeout (M99 review): this await sits inside the
    // serialized render loop — a hung provider without a deadline would
    // freeze every future planner render, not just this one.
    const withTimeout = <T,>(p: Promise<T>): Promise<T> => Promise.race([
      p,
      new Promise<T>((_, reject) => setTimeout(() => reject(new Error('day-load provider timeout')), 3000)),
    ]);
    const results = await Promise.allSettled(providers.map(p => withTimeout(Promise.resolve(p.getDayLoads(fromMs, toMs)))));
    for (const r of results) {
      if (r.status !== 'fulfilled') continue;
      for (const load of r.value) {
        if (!Number.isFinite(load.dayStartMs) || !(load.count > 0)) continue;
        const key = startOfDay(new Date(load.dayStartMs)).getTime();
        const list = byDay.get(key) ?? [];
        list.push({ count: load.count, label: load.label });
        byDay.set(key, list);
      }
    }
    return byDay;
  }

  private async _renderMonthView(body: HTMLElement): Promise<void> {
    const from = startOfMonth(this._cursorDate).getTime();
    const to = endOfMonth(this._cursorDate).getTime();
    const { isVisible, colorOf } = await this._loadCalCtx();
    const events = (await this._data.listEvents({ from, to, limit: 500 })).filter(ev => isVisible(ev.calendarId));
    const tasks = await this._tasksInWindow(from, to, isVisible);
    const dayLoads = await this._collectDayLoads(from, to);

    const grid = el('div', 'planner-month');
    // Weekday header
    const weekdayRow = el('div', 'planner-month__weekdays');
    const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    for (const wd of weekdays) {
      const wdEl = el('div', 'planner-month__weekday');
      wdEl.textContent = wd;
      weekdayRow.appendChild(wdEl);
    }
    grid.appendChild(weekdayRow);

    const cells = el('div', 'planner-month__cells');
    const firstOfMonth = startOfMonth(this._cursorDate);
    const gridStart = startOfWeek(firstOfMonth);
    const lastOfMonth = endOfMonth(this._cursorDate);
    const gridEnd = addDays(startOfWeek(lastOfMonth), 6);
    const totalDays = Math.round((gridEnd.getTime() - gridStart.getTime()) / 86_400_000) + 1;

    for (let i = 0; i < totalDays; i++) {
      const day = addDays(gridStart, i);
      const dayStart = startOfDay(day).getTime();
      const dayEnd = endOfDay(day).getTime();
      const dayEvents = events.filter(ev => ev.startAt <= dayEnd && ev.endAt >= dayStart);
      const dayTasks = tasks.filter(t => t.dueAt! >= dayStart && t.dueAt! <= dayEnd);

      const cell = el('div', 'planner-month__cell');
      cell.dataset.dayStart = String(dayStart);
      if (day.getMonth() !== this._cursorDate.getMonth()) cell.classList.add('planner-month__cell--other-month');
      if (sameDay(day, new Date())) cell.classList.add('planner-month__cell--today');

      const number = el('span', 'planner-month__cellnum');
      number.textContent = String(day.getDate());
      cell.appendChild(number);

      // M98 — provider day-load badge ("38 cards"), a decoration, not a row.
      const loads = dayLoads.get(dayStart);
      if (loads?.length) {
        const badge = el('span', 'planner-month__load');
        badge.textContent = loads.map(l => `${l.count} ${l.label}`).join(' · ');
        badge.title = loads.map(l => `${l.count} ${l.label}`).join('\n');
        cell.appendChild(badge);
      }

      const evWrap = el('div', 'planner-month__cellevents');
      const MAX_SHOWN = 3;
      const total = dayEvents.length + dayTasks.length;
      let shown = 0;
      for (const ev of dayEvents) {
        if (shown >= MAX_SHOWN) break;
        const chip = el('button', 'planner-month__chip');
        chip.type = 'button';
        chip.style.setProperty('--cal-color', colorOf(ev.calendarId, ev.color));
        const dot = el('span', 'planner-month__chipdot');
        chip.appendChild(dot);
        const label = el('span', 'planner-month__chiptext');
        label.textContent = ev.title;
        chip.appendChild(label);
        chip.title = `${ev.title}\n${formatTimeRange(ev)}`;
        // Series occurrences drag too — the commit prompts this/following/all.
        this._installMonthChipDrag(chip, ev, dayStart);
        evWrap.appendChild(chip);
        shown++;
      }
      for (const t of dayTasks) {
        if (shown >= MAX_SHOWN) break;
        evWrap.appendChild(this._renderCalTaskChip(t, colorOf(t.calendarId, t.color)));
        shown++;
      }
      if (total > MAX_SHOWN) {
        const more = el('span', 'planner-month__more');
        more.textContent = `+${total - MAX_SHOWN} more`;
        evWrap.appendChild(more);
      }
      cell.appendChild(evWrap);

      // Month is for navigation. Clicking a cell drills into day view —
      // event creation happens there via click or drag on time slots, the
      // way every digital calendar (Google / Apple / Outlook) works.
      cell.addEventListener('click', () => {
        this._cursorDate = startOfDay(day);
        this._calendarView = 'day';
        void this._renderTab();
      });
      cells.appendChild(cell);
    }
    grid.appendChild(cells);
    body.appendChild(grid);
  }

  private async _renderWeekView(body: HTMLElement): Promise<void> {
    const start = startOfWeek(this._cursorDate);
    const end = addDays(start, 7);
    const { isVisible, colorOf } = await this._loadCalCtx();
    const allEvents = (await this._data.listEvents({ from: start.getTime(), to: end.getTime(), limit: 500 })).filter(ev => isVisible(ev.calendarId));
    const allDayEvents = allEvents.filter(ev => this._isAllDayLike(ev));
    const events = allEvents.filter(ev => !this._isAllDayLike(ev));
    const tasks = await this._tasksInWindow(start.getTime(), end.getTime(), isVisible);
    const dayLoads = await this._collectDayLoads(start.getTime(), end.getTime());

    const grid = el('div', 'planner-week');
    const headerRow = el('div', 'planner-week__header');
    headerRow.appendChild(el('div', 'planner-week__corner'));
    for (let i = 0; i < 7; i++) {
      const day = addDays(start, i);
      const wd = el('div', 'planner-week__weekday');
      const wdLabel = el('span', 'planner-week__weekday-label');
      wdLabel.textContent = day.toLocaleDateString(undefined, { weekday: 'short' });
      const wdNum = el('span', 'planner-week__weekday-num');
      wdNum.textContent = String(day.getDate());
      if (sameDay(day, new Date())) wd.classList.add('planner-week__weekday--today');
      wd.appendChild(wdLabel);
      wd.appendChild(wdNum);
      // M98 — provider day-load chip under the weekday header.
      const loads = dayLoads.get(startOfDay(day).getTime());
      if (loads?.length) {
        const chip = el('span', 'planner-week__load');
        chip.textContent = loads.map(l => `${l.count} ${l.label}`).join(' · ');
        wd.appendChild(chip);
      }
      headerRow.appendChild(wd);
    }
    grid.appendChild(headerRow);

    // Outlook-style all-day band — multi-day events live here, not in the grid.
    this._renderWeekAllDayBand(grid, start, allDayEvents, colorOf);

    const body2 = el('div', 'planner-week__body');
    const HOURS_START = 0, HOURS_END = 24;
    const hourScale = el('div', 'planner-week__hours');
    for (let h = HOURS_START; h < HOURS_END; h++) {
      const cell = el('div', 'planner-week__hour');
      const label = el('span', 'planner-week__hourlabel');
      label.textContent = formatHour(h);
      cell.appendChild(label);
      hourScale.appendChild(cell);
    }
    body2.appendChild(hourScale);

    for (let i = 0; i < 7; i++) {
      const dayCol = el('div', 'planner-week__col');
      const day = addDays(start, i);
      const dayStart = day.getTime();
      const dayEnd = endOfDay(day).getTime();
      dayCol.dataset.dayStart = String(dayStart);

      // Hour gridlines (visual only — interaction is on the column itself).
      for (let h = HOURS_START; h < HOURS_END; h++) {
        const cell = el('div', 'planner-week__cell');
        cell.dataset.hour = String(h);
        dayCol.appendChild(cell);
      }
      // Click + drag-to-create on the day column.
      this._installDragCreate(dayCol, day);

      // Current-time indicator on today's column.
      if (sameDay(day, new Date())) {
        const now = new Date();
        const elapsed = now.getTime() - startOfDay(now).getTime();
        const pct = (elapsed / (24 * 3_600_000)) * 100;
        const nowLine = el('div', 'planner-week__nowline');
        nowLine.style.top = `${pct}%`;
        const dot = el('span', 'planner-week__nowdot');
        nowLine.appendChild(dot);
        dayCol.appendChild(nowLine);
      }

      // Events + dated tasks, packed into side-by-side lanes where they overlap.
      this._layoutTimedItems(dayCol, 'week', dayStart, dayEnd, events, tasks, colorOf);

      body2.appendChild(dayCol);
    }
    grid.appendChild(body2);
    body.appendChild(grid);
  }

  private async _renderDayView(body: HTMLElement): Promise<void> {
    const dayStart = startOfDay(this._cursorDate).getTime();
    const dayEnd = endOfDay(this._cursorDate).getTime();
    const { isVisible, colorOf } = await this._loadCalCtx();
    const allEvents = (await this._data.listEvents({ from: dayStart, to: dayEnd, limit: 500 })).filter(ev => isVisible(ev.calendarId));
    const allDayEvents = allEvents.filter(ev => this._isAllDayLike(ev));
    const events = allEvents.filter(ev => !this._isAllDayLike(ev));
    const tasks = await this._tasksInWindow(dayStart, dayEnd, isVisible);

    // All-day strip above the time grid, mirroring the week view.
    this._renderDayAllDaySection(body, this._cursorDate, allDayEvents, colorOf);

    const grid = el('div', 'planner-day');
    const hours = el('div', 'planner-day__hours');
    const col = el('div', 'planner-day__col');
    col.dataset.dayStart = String(dayStart);
    const HOURS_START = 0, HOURS_END = 24;
    for (let h = HOURS_START; h < HOURS_END; h++) {
      const hourCell = el('div', 'planner-day__hour');
      const label = el('span', 'planner-day__hourlabel');
      label.textContent = formatHour(h);
      hourCell.appendChild(label);
      hours.appendChild(hourCell);

      const cell = el('div', 'planner-day__cell');
      cell.dataset.hour = String(h);
      col.appendChild(cell);
    }
    grid.appendChild(hours);
    grid.appendChild(col);
    this._installDragCreate(col, this._cursorDate);

    // Current-time indicator (only if cursor is on today).
    if (sameDay(this._cursorDate, new Date())) {
      const now = new Date();
      const elapsed = now.getTime() - startOfDay(now).getTime();
      const pct = (elapsed / (24 * 3_600_000)) * 100;
      const nowLine = el('div', 'planner-day__nowline');
      nowLine.style.top = `${pct}%`;
      const dot = el('span', 'planner-day__nowdot');
      nowLine.appendChild(dot);
      col.appendChild(nowLine);
    }

    // Events + dated tasks, packed into side-by-side lanes where they overlap.
    this._layoutTimedItems(col, 'day', dayStart, dayEnd, events, tasks, colorOf);

    body.appendChild(grid);
  }

  // ── Drag-to-create on week / day time columns ───────────────────────

  /**
   * Standard digital-calendar interaction: pointerdown on a time-slot,
   * drag to set the range, release to open the create popover with the
   * range prefilled. A bare click (no drag) defaults to a 1-hour event
   * starting on the snapped boundary closest to the click.
   *
   * The ghost rectangle previews the snap target during the drag (15-min
   * granularity) so the user can see what they'll get before releasing.
   *
   * Events that sit absolutely above the column have their own click
   * handlers with stopPropagation, so pointerdown on an event bar never
   * reaches this column-level handler.
   */
  private _installDragCreate(col: HTMLElement, day: Date): void {
    const SNAP_MIN = 15;
    const SNAP_MS = SNAP_MIN * 60_000;
    const DAY_MS = 24 * 3_600_000;
    const MIN_EVENT_MS = 30 * 60_000;
    const DRAG_THRESHOLD_PX = 3;

    col.addEventListener('pointerdown', (e) => {
      // Only start from a time-slot cell — not from an event bar that
      // happens to sit above. Event bars have their own click handlers.
      if (!(e.target instanceof HTMLElement)) return;
      const isCell = e.target.classList.contains('planner-week__cell')
                  || e.target.classList.contains('planner-day__cell');
      if (!isCell) return;
      e.preventDefault();

      const colRect = col.getBoundingClientRect();
      const startY = Math.max(0, Math.min(colRect.height, e.clientY - colRect.top));
      let endY = startY;
      let moved = false;

      // Convert Y position → ms, snapped to SNAP_MIN.
      const dayStartMs = startOfDay(day).getTime();
      const yToMs = (y: number): number => {
        const raw = dayStartMs + (y / colRect.height) * DAY_MS;
        return Math.round(raw / SNAP_MS) * SNAP_MS;
      };
      const msToPct = (ms: number): number => ((ms - dayStartMs) / DAY_MS) * 100;

      // Live preview ghost.
      const ghost = el('div', 'planner-cal__ghost');
      col.appendChild(ghost);

      const drawGhost = () => {
        const a = Math.min(startY, endY);
        const b = Math.max(startY, endY);
        const startMs = yToMs(a);
        let endMs = yToMs(b);
        if (!moved || endMs - startMs < MIN_EVENT_MS) endMs = startMs + MIN_EVENT_MS;
        const topPct = msToPct(startMs);
        const heightPct = ((endMs - startMs) / DAY_MS) * 100;
        ghost.style.top = `${topPct}%`;
        ghost.style.height = `${heightPct}%`;
        ghost.textContent = `${formatTimeShort(startMs)} – ${formatTimeShort(endMs)}`;
      };
      drawGhost();

      try { col.setPointerCapture(e.pointerId); } catch { /* ok */ }

      const onMove = (ev: PointerEvent) => {
        const delta = Math.abs(ev.clientY - e.clientY);
        if (delta > DRAG_THRESHOLD_PX) moved = true;
        endY = Math.max(0, Math.min(colRect.height, ev.clientY - colRect.top));
        drawGhost();
      };
      const onUp = (ev: PointerEvent) => {
        col.removeEventListener('pointermove', onMove);
        col.removeEventListener('pointerup', onUp);
        col.removeEventListener('pointercancel', onUp);
        try { col.releasePointerCapture(ev.pointerId); } catch { /* ok */ }

        const a = Math.min(startY, endY);
        const b = Math.max(startY, endY);
        const startMs = yToMs(a);
        let endMs = yToMs(b);
        // Bare click → 1h default. Drag (any meaningful movement) → snapped range.
        if (!moved || endMs - startMs < MIN_EVENT_MS) endMs = startMs + (moved ? MIN_EVENT_MS : 60 * 60_000);

        // Re-render the ghost so it matches the final committed range (in
        // case the drag ended mid-snap interval). Then hand it off to the
        // popover — the ghost survives until the popover closes, so the
        // user sees their selection while they fill in details.
        const finalTopPct = msToPct(startMs);
        const finalHeightPct = ((endMs - startMs) / DAY_MS) * 100;
        ghost.style.top = `${finalTopPct}%`;
        ghost.style.height = `${finalHeightPct}%`;
        ghost.textContent = `${formatTimeShort(startMs)} – ${formatTimeShort(endMs)}`;

        const ghostRect = ghost.getBoundingClientRect();

        this._openEventPopover({
          mode: 'create',
          startAt: startMs,
          endAt: endMs,
          pendingGhost: ghost,
        }, ghostRect);
      };
      col.addEventListener('pointermove', onMove);
      col.addEventListener('pointerup', onUp);
      col.addEventListener('pointercancel', onUp);
    });
  }

  // ── Task popover (create + edit) ────────────────────────────────────

  /**
   * Single popover for task create + edit. Comprehensive form so every
   * task-create path goes through one place instead of degrading to
   * "type a title and pray". Fields:
   *
   *   title  · due date + time · all-day toggle · reminder dropdown
   *   tags   · notes (description) · status segmented control
   *
   * Save commits via createTask / updateTask; Delete only shows in edit
   * mode. Same close() lifecycle as the event popover so cancel paths
   * (Escape, outside click, ×, Cancel) all clean up consistently.
   */
  private _openTaskPopover(
    init: { mode: 'create'; seedDueAt?: number; seedStatus?: TaskStatus; seedTitle?: string }
        | { mode: 'edit'; task: PlannerTask },
    anchor: DOMRect,
  ): void {
    // Dropdowns own document-level listeners — every close path disposes them.
    const popupDisposables: IDisposable[] = [];
    const close = () => {
      for (const d of popupDisposables) { try { d.dispose(); } catch { /* noop */ } }
      popupDisposables.length = 0;
      try { overlay.remove(); } catch { /* noop */ }
      document.removeEventListener('keydown', onKey);
    };

    const overlay = el('div', 'planner-popover-overlay');
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    const pop = el('div', 'planner-popover');
    pop.style.position = 'fixed';

    const isEdit = init.mode === 'edit';
    // Defaults on create: +5d due, 'reviewing' (the journaling flow).
    // Calendar drags pass seedDueAt + seedStatus='planned' to override.
    const seed: {
      title: string;
      dueAt: number;
      hasReminder: boolean;
      reminderOffsetMin: number;
      tagsCsv: string;
      description: string;
      status: TaskStatus;
      taskId: string | null;
    } = isEdit
      ? {
          title: init.task.title,
          dueAt: init.task.dueAt ?? Date.now() + 5 * 86_400_000,
          hasReminder: init.task.reminderAt != null,
          reminderOffsetMin: init.task.reminderAt != null && init.task.dueAt != null
            ? Math.max(0, Math.round((init.task.dueAt - init.task.reminderAt) / 60_000))
            : 60,
          tagsCsv: init.task.tags.join(', '),
          description: init.task.description ?? '',
          status: init.task.status,
          taskId: init.task.id,
        }
      : {
          title: init.seedTitle ?? '',
          dueAt: init.seedDueAt ?? Date.now() + 5 * 86_400_000,
          hasReminder: false,
          reminderOffsetMin: 60,
          tagsCsv: '',
          description: '',
          status: init.seedStatus ?? 'reviewing',
          taskId: null,
        };

    // Header
    const head = el('div', 'planner-popover__head');
    const heading = el('h3', 'planner-popover__title');
    heading.textContent = isEdit ? 'Edit task' : 'New task';
    head.appendChild(heading);
    const closeBtn = el('button', 'planner-popover__close');
    closeBtn.type = 'button';
    closeBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    closeBtn.addEventListener('click', () => close());
    head.appendChild(closeBtn);
    pop.appendChild(head);

    // Body
    const body = el('div', 'planner-popover__body');

    const titleInput = el('input', 'planner-popover__title-input') as HTMLInputElement;
    titleInput.type = 'text';
    titleInput.placeholder = 'What needs to happen?';
    titleInput.value = seed.title;
    body.appendChild(titleInput);

    // Due — date + time row, with an All-day toggle that hides the time field.
    const dueRow = el('div', 'planner-popover__row planner-popover__row--labeled');
    const dueLabel = el('span', 'planner-popover__rowlabel');
    dueLabel.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg><span>Due</span>';
    dueRow.appendChild(dueLabel);
    const dueDate = el('input', 'planner-popover__field planner-popover__field--date') as HTMLInputElement;
    dueDate.type = 'date';
    dueDate.value = toDateInputValue(seed.dueAt);
    dueRow.appendChild(dueDate);
    const dueTime = el('input', 'planner-popover__field planner-popover__field--time') as HTMLInputElement;
    dueTime.type = 'time';
    dueTime.value = toTimeInputValue(seed.dueAt);
    dueRow.appendChild(dueTime);
    body.appendChild(dueRow);

    const allDayRow = el('label', 'planner-popover__check');
    const allDayInput = el('input') as HTMLInputElement;
    allDayInput.type = 'checkbox';
    // All-day default: true if the seeded time is midnight (the user
    // didn't pick a time), false otherwise.
    allDayInput.checked = new Date(seed.dueAt).getHours() === 0 && new Date(seed.dueAt).getMinutes() === 0 && !isEdit;
    allDayRow.appendChild(allDayInput);
    const allDayText = el('span');
    allDayText.textContent = 'No specific time (all day)';
    allDayRow.appendChild(allDayText);
    body.appendChild(allDayRow);
    const updateAllDay = () => {
      const off = allDayInput.checked;
      dueTime.disabled = off;
      dueTime.style.opacity = off ? '0.4' : '';
    };
    allDayInput.addEventListener('change', updateAllDay);
    updateAllDay();

    // Reminder — dropdown of presets + None.
    const remindRow = el('div', 'planner-popover__row planner-popover__row--labeled');
    const remindLabel = el('span', 'planner-popover__rowlabel');
    remindLabel.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg><span>Remind</span>';
    remindRow.appendChild(remindLabel);
    const remindHost = el('div', 'planner-popover__field planner-popover__field--select');
    const REMINDER_PRESETS: { label: string; offsetMin: number | null }[] = [
      { label: 'No reminder',         offsetMin: null },
      { label: 'At time of due',      offsetMin: 0 },
      { label: '5 minutes before',    offsetMin: 5 },
      { label: '15 minutes before',   offsetMin: 15 },
      { label: '30 minutes before',   offsetMin: 30 },
      { label: '1 hour before',       offsetMin: 60 },
      { label: '1 day before',        offsetMin: 1440 },
      { label: '1 week before',       offsetMin: 10_080 },
    ];
    // Match the closest preset; if none matches exactly, default to "1 hour before".
    const seedRemind = seed.hasReminder
      ? (REMINDER_PRESETS.some(p => p.offsetMin === seed.reminderOffsetMin)
          ? String(seed.reminderOffsetMin)
          : '60')
      : 'none';
    const remindSelect = new Dropdown(remindHost, {
      items: REMINDER_PRESETS.map((p) => ({
        value: p.offsetMin === null ? 'none' : String(p.offsetMin),
        label: p.label,
      })),
      selected: seedRemind,
      ariaLabel: 'Reminder',
    });
    popupDisposables.push(remindSelect);
    remindRow.appendChild(remindHost);
    body.appendChild(remindRow);

    // Calendar — groups + colour-codes the task on the calendar views.
    const calRow = el('div', 'planner-popover__row planner-popover__row--labeled');
    const calLabel = el('span', 'planner-popover__rowlabel');
    calLabel.innerHTML = CALENDAR_LABEL_SVG;
    calRow.appendChild(calLabel);
    const calHost = el('div', 'planner-popover__field planner-popover__field--select');
    const calSelect = new Dropdown(calHost, { items: [], ariaLabel: 'Calendar' });
    popupDisposables.push(calSelect);
    calRow.appendChild(calHost);
    body.appendChild(calRow);
    const seedCalId = isEdit ? (init.task.calendarId ?? null) : null;
    void this._data.listCalendars().then((cals) => {
      calSelect.items = cals.map((c) => ({ value: c.id, label: c.name }));
      const want = seedCalId ?? cals.find(c => c.id === 'cal-tasks')?.id ?? cals.find(c => c.isDefault)?.id ?? (cals[0]?.id ?? '');
      if (want) calSelect.value = want;
    });

    // Tags
    const tagRow = el('div', 'planner-popover__row planner-popover__row--labeled');
    const tagLabel = el('span', 'planner-popover__rowlabel');
    tagLabel.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41L13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg><span>Tags</span>';
    tagRow.appendChild(tagLabel);
    const tagInput = el('input', 'planner-popover__field planner-popover__field--full') as HTMLInputElement;
    tagInput.type = 'text';
    tagInput.placeholder = 'e.g. errands, calls';
    tagInput.value = seed.tagsCsv;
    tagRow.appendChild(tagInput);
    body.appendChild(tagRow);

    // Notes
    const descInput = el('textarea', 'planner-popover__textarea') as HTMLTextAreaElement;
    descInput.placeholder = 'Notes & links';
    descInput.value = seed.description;
    body.appendChild(descInput);
    this._appendNotesToolbar(body, descInput);
    this._attachDescriptionLinks(body, descInput);

    // Status — segmented control (Reviewing / Planned), defaults from seed.
    const statusRow = el('div', 'planner-popover__statusrow');
    const statusLabel = el('span', 'planner-popover__statuslabel');
    statusLabel.textContent = 'Status';
    statusRow.appendChild(statusLabel);
    const statusGroup = el('div', 'planner-popover__statusgroup');
    let statusValue: TaskStatus = seed.status === 'cancelled' ? 'reviewing' : seed.status;
    const statusOptions: { value: TaskStatus; label: string }[] = [
      { value: 'reviewing', label: 'Reviewing' },
      { value: 'planned',   label: 'Planned' },
    ];
    if (isEdit) statusOptions.push({ value: 'done', label: 'Done' });
    for (const opt of statusOptions) {
      const btn = el('button', 'planner-popover__statusbtn');
      btn.type = 'button';
      btn.dataset.value = opt.value;
      btn.textContent = opt.label;
      if (opt.value === statusValue) btn.classList.add('planner-popover__statusbtn--active');
      btn.addEventListener('click', () => {
        statusValue = opt.value;
        for (const sib of Array.from(statusGroup.children)) {
          if (!(sib instanceof HTMLElement)) continue;
          sib.classList.toggle('planner-popover__statusbtn--active', sib.dataset.value === statusValue);
        }
      });
      statusGroup.appendChild(btn);
    }
    statusRow.appendChild(statusGroup);
    body.appendChild(statusRow);

    pop.appendChild(body);

    // Footer
    const foot = el('div', 'planner-popover__foot');
    if (isEdit && seed.taskId) {
      const delBtn = el('button', 'planner-popover__btn planner-popover__btn--danger');
      delBtn.type = 'button';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', async () => {
        await this._data.removeTask(seed.taskId!);
        close();
      });
      foot.appendChild(delBtn);
    }
    const spacer = el('span', 'planner-popover__spacer');
    foot.appendChild(spacer);
    const cancel = el('button', 'planner-popover__btn');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => close());
    foot.appendChild(cancel);
    const save = el('button', 'planner-popover__btn planner-popover__btn--primary');
    save.type = 'button';
    save.textContent = isEdit ? 'Save' : 'Create task';
    const doSave = async () => {
      const title = titleInput.value.trim();
      if (!title) { titleInput.focus(); return; }
      const allDay = allDayInput.checked;
      const dueMs = allDay
        ? fromDateTimeInputs(dueDate.value, '00:00')
        : fromDateTimeInputs(dueDate.value, dueTime.value);
      if (dueMs === null) {
        await this._api.window.showErrorMessage('Invalid due date or time.');
        return;
      }
      const offsetStr = remindSelect.value ?? 'none';
      const reminderAt = offsetStr === 'none' ? null : dueMs - parseInt(offsetStr, 10) * 60_000;
      const tags = tagInput.value.split(',').map(s => s.trim()).filter(Boolean);
      const description = descInput.value.trim() || null;

      try {
        if (isEdit && seed.taskId) {
          await this._data.updateTask(seed.taskId, {
            title,
            description,
            status: statusValue,
            dueAt: dueMs,
            reminderAt,
            tags,
            calendarId: calSelect.value || null,
          });
        } else {
          await this._data.createTask({
            title,
            description,
            status: statusValue,
            dueAt: dueMs,
            reminderAt: reminderAt ?? null,
            tags,
            calendarId: calSelect.value || null,
          });
        }
        close();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await this._api.window.showErrorMessage(`Could not save task: ${msg}`);
      }
    };
    save.addEventListener('click', () => void doSave());
    foot.appendChild(save);
    pop.appendChild(foot);

    overlay.appendChild(pop);
    document.body.appendChild(overlay);

    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') { close(); }
      else if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault(); void doSave();
      }
    }
    document.addEventListener('keydown', onKey);
    overlay.addEventListener('animationend', () => titleInput.focus(), { once: true });
    setTimeout(() => { if (document.activeElement !== titleInput) titleInput.focus(); }, 80);

    // Anchor positioning — same logic as the event popover.
    const m = pop.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    let left = anchor.left;
    let top = anchor.bottom + 6;
    if (anchor.left + m.width > vw - 12) left = Math.max(12, vw - m.width - 12);
    if (top + m.height > vh - 12) top = Math.max(12, anchor.top - m.height - 6);
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
  }

  // ── Event popover (create + edit) ───────────────────────────────────

  /**
   * Single popover for both creating a new event and editing an existing
   * one. Form: title, start time, end time, all-day toggle, location,
   * description. Save commits via createEvent / updateEvent; Delete only
   * shows in edit mode. Dismisses on Escape or outside click; never
   * navigates away.
   */
  private _openEventPopover(
    init: { mode: 'create'; startAt: number; endAt: number; allDay?: boolean; pendingGhost?: HTMLElement | null }
        | { mode: 'edit'; event: PlannerEvent },
    anchor: DOMRect,
  ): void {
    // Pending ghost from a drag selection — survives onto the popover so
    // the user sees what they're creating while they fill it in. Cleared
    // by close(), so cancel / escape / outside-click / save all dispose
    // of it without flicker.
    const pendingGhost = init.mode === 'create' ? init.pendingGhost ?? null : null;

    // Dropdowns own document-level listeners — every close path disposes them.
    const popupDisposables: IDisposable[] = [];
    const close = () => {
      for (const d of popupDisposables) { try { d.dispose(); } catch { /* noop */ } }
      popupDisposables.length = 0;
      try { overlay.remove(); } catch { /* noop */ }
      if (pendingGhost && pendingGhost.parentElement) {
        try { pendingGhost.remove(); } catch { /* noop */ }
      }
      document.removeEventListener('keydown', onKey);
    };

    const overlay = el('div', 'planner-popover-overlay');
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    // Highlight the pending ghost while the popover is open — it's the
    // visible "this is what you're creating" anchor.
    if (pendingGhost) pendingGhost.classList.add('planner-cal__ghost--pending');

    const pop = el('div', 'planner-popover');
    pop.style.position = 'fixed';

    const isEdit = init.mode === 'edit';
    const seed: { title: string; startAt: number; endAt: number; allDay: boolean; location: string; description: string; eventId: string | null } = isEdit
      ? {
          title: init.event.title,
          startAt: init.event.startAt,
          endAt: init.event.endAt,
          allDay: init.event.allDay,
          location: init.event.location ?? '',
          description: init.event.description ?? '',
          eventId: init.event.id,
        }
      : {
          title: '',
          startAt: init.startAt,
          endAt: init.endAt,
          allDay: init.allDay ?? false,
          location: '',
          description: '',
          eventId: null,
        };

    // Header
    const head = el('div', 'planner-popover__head');
    const heading = el('h3', 'planner-popover__title');
    heading.textContent = isEdit ? 'Edit event' : 'New event';
    head.appendChild(heading);
    const closeBtn = el('button', 'planner-popover__close');
    closeBtn.type = 'button';
    closeBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    closeBtn.addEventListener('click', () => close());
    head.appendChild(closeBtn);
    pop.appendChild(head);

    // Body
    const body = el('div', 'planner-popover__body');

    const titleInput = el('input', 'planner-popover__title-input') as HTMLInputElement;
    titleInput.type = 'text';
    titleInput.placeholder = 'Add a title';
    titleInput.value = seed.title;
    body.appendChild(titleInput);

    // Date / time row
    const timeRow = el('div', 'planner-popover__row');
    const startDate = el('input', 'planner-popover__field planner-popover__field--date') as HTMLInputElement;
    startDate.type = 'date';
    startDate.value = toDateInputValue(seed.startAt);
    const startTime = el('input', 'planner-popover__field planner-popover__field--time') as HTMLInputElement;
    startTime.type = 'time';
    startTime.value = toTimeInputValue(seed.startAt);
    const sep = el('span', 'planner-popover__sep');
    sep.textContent = '–';
    const endTime = el('input', 'planner-popover__field planner-popover__field--time') as HTMLInputElement;
    endTime.type = 'time';
    endTime.value = toTimeInputValue(seed.endAt);
    const endDate = el('input', 'planner-popover__field planner-popover__field--date') as HTMLInputElement;
    endDate.type = 'date';
    endDate.value = toDateInputValue(seed.endAt);
    timeRow.appendChild(startDate);
    timeRow.appendChild(startTime);
    timeRow.appendChild(sep);
    timeRow.appendChild(endTime);
    timeRow.appendChild(endDate);
    body.appendChild(timeRow);

    const allDayRow = el('label', 'planner-popover__check');
    const allDayInput = el('input') as HTMLInputElement;
    allDayInput.type = 'checkbox';
    allDayInput.checked = seed.allDay;
    const allDayText = el('span');
    allDayText.textContent = 'All day';
    allDayRow.appendChild(allDayInput);
    allDayRow.appendChild(allDayText);
    body.appendChild(allDayRow);
    const updateAllDayUI = () => {
      const off = allDayInput.checked;
      startTime.disabled = off; endTime.disabled = off;
      startTime.style.opacity = off ? '0.4' : '';
      endTime.style.opacity = off ? '0.4' : '';
    };
    allDayInput.addEventListener('change', updateAllDayUI);
    updateAllDayUI();

    // Calendar picker — colour + grouping come from the chosen calendar.
    const calRow = el('div', 'planner-popover__row planner-popover__row--labeled');
    const calLabel = el('span', 'planner-popover__rowlabel');
    calLabel.innerHTML = CALENDAR_LABEL_SVG;
    calRow.appendChild(calLabel);
    const calHost = el('div', 'planner-popover__field planner-popover__field--select');
    const calSelect = new Dropdown(calHost, { items: [], ariaLabel: 'Calendar' });
    popupDisposables.push(calSelect);
    calRow.appendChild(calHost);
    body.appendChild(calRow);
    const seedCalId = isEdit ? (init.event.calendarId ?? null) : null;
    void this._data.listCalendars().then((cals) => {
      calSelect.items = cals.map((c) => ({ value: c.id, label: c.name }));
      const want = seedCalId ?? cals.find(c => c.id === 'cal-personal')?.id ?? cals.find(c => c.isDefault)?.id ?? (cals[0]?.id ?? '');
      if (want) calSelect.value = want;
    });

    // Colour — overrides the calendar's colour for this event/series. Default
    // (hollow chip) inherits the calendar colour.
    let pendingColor: string | null = isEdit ? (init.event.color ?? null) : null;
    const colorRow = el('div', 'planner-popover__row planner-popover__row--labeled');
    const colorLabel = el('span', 'planner-popover__rowlabel');
    colorLabel.innerHTML = COLOR_LABEL_SVG;
    colorRow.appendChild(colorLabel);
    colorRow.appendChild(buildColorSwatches(pendingColor, (hex) => { pendingColor = hex; }, true));
    body.appendChild(colorRow);

    // Repeats — simple RRULE presets; the "Weekly on X" label tracks the start date.
    const repeatRow = el('div', 'planner-popover__row planner-popover__row--labeled');
    const repeatLabel = el('span', 'planner-popover__rowlabel');
    repeatLabel.innerHTML = REPEAT_LABEL_SVG;
    repeatRow.appendChild(repeatLabel);
    const repeatHost = el('div', 'planner-popover__field planner-popover__field--select');
    const seedRecurrence = isEdit ? (init.event.recurrence ?? null) : null;
    const seedPreset = rruleToPreset(seedRecurrence);
    const repeatSelect = new Dropdown(repeatHost, { items: [], selected: seedPreset, ariaLabel: 'Repeats' });
    popupDisposables.push(repeatSelect);
    const repeatDefs: { value: string; label: () => string }[] = [
      { value: 'none',    label: () => 'Does not repeat' },
      { value: 'daily',   label: () => 'Daily' },
      { value: 'weekly',  label: () => `Weekly on ${WEEKDAY_NAMES[new Date(fromDateTimeInputs(startDate.value, '12:00') ?? seed.startAt).getDay()]}` },
      { value: 'monthly', label: () => 'Monthly' },
      { value: 'yearly',  label: () => 'Yearly' },
    ];
    const buildRepeatOptions = (): void => {
      const keep = repeatSelect.value || seedPreset;
      const items = repeatDefs.map((def) => ({ value: def.value, label: def.label() }));
      if (seedPreset === 'custom') {
        items.push({ value: 'custom', label: describeRRule(seedRecurrence) });
      }
      repeatSelect.items = items;
      repeatSelect.value = keep;
    };
    buildRepeatOptions();
    startDate.addEventListener('change', buildRepeatOptions);
    repeatRow.appendChild(repeatHost);
    body.appendChild(repeatRow);

    const locationInput = el('input', 'planner-popover__field planner-popover__field--full') as HTMLInputElement;
    locationInput.type = 'text';
    locationInput.placeholder = 'Add location';
    locationInput.value = seed.location;
    body.appendChild(locationInput);

    const descInput = el('textarea', 'planner-popover__textarea') as HTMLTextAreaElement;
    descInput.placeholder = 'Add notes & links';
    descInput.value = seed.description;
    body.appendChild(descInput);
    this._appendNotesToolbar(body, descInput);
    this._attachDescriptionLinks(body, descInput);

    pop.appendChild(body);

    // Footer
    const foot = el('div', 'planner-popover__foot');
    if (isEdit) {
      const delBtn = el('button', 'planner-popover__btn planner-popover__btn--danger');
      delBtn.type = 'button';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', async () => {
        if (!seed.eventId) return;
        if (init.mode === 'edit' && init.event.seriesId) {
          const scope = await this._askSeriesScope('delete', delBtn.getBoundingClientRect());
          if (!scope) return;
          await this._data.deleteOccurrence(seed.eventId, scope);
        } else {
          await this._data.removeEvent(seed.eventId);
        }
        close();
      });
      foot.appendChild(delBtn);
    }
    const spacer = el('span', 'planner-popover__spacer');
    foot.appendChild(spacer);
    const cancel = el('button', 'planner-popover__btn');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => close());
    foot.appendChild(cancel);
    const save = el('button', 'planner-popover__btn planner-popover__btn--primary');
    save.type = 'button';
    save.textContent = isEdit ? 'Save' : 'Create';
    const doSave = async () => {
      const title = titleInput.value.trim();
      if (!title) { titleInput.focus(); return; }
      const startMs = fromDateTimeInputs(startDate.value, startTime.value);
      const endMs = fromDateTimeInputs(endDate.value, endTime.value);
      if (startMs === null || endMs === null) {
        await this._api.window.showErrorMessage('Invalid date or time.');
        return;
      }
      if (endMs < startMs) {
        await this._api.window.showErrorMessage('End time must be after start time.');
        return;
      }
      const calendarId = calSelect.value || null;
      const presetVal = repeatSelect.value ?? 'none';
      // 'custom' → leave the stored RRULE untouched; otherwise rebuild from the
      // preset against the current start weekday.
      const recurrence = presetVal === 'custom'
        ? undefined
        : buildSimpleRRule(presetVal as 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly', new Date(startMs).getDay());
      const isSeries = isEdit && init.mode === 'edit' && !!init.event.seriesId;
      try {
        if (isEdit && seed.eventId) {
          const patch: UpdateEventInput = {
            title,
            startAt: startMs,
            endAt: endMs,
            allDay: allDayInput.checked,
            location: locationInput.value.trim() || null,
            description: descInput.value.trim() || null,
            calendarId,
            color: pendingColor,
            ...(recurrence !== undefined ? { recurrence } : {}),
          };
          if (isSeries) {
            // Recurring occurrence → ask which occurrences the edit applies to.
            const scope = await this._askSeriesScope('edit', save.getBoundingClientRect());
            if (!scope) return; // keep the popover open; user can retry or cancel
            await this._data.applySeriesEdit(seed.eventId, patch, scope);
          } else {
            await this._data.updateEvent(seed.eventId, patch);
          }
        } else {
          await this._data.createEvent({
            title,
            startAt: startMs,
            endAt: endMs,
            allDay: allDayInput.checked,
            location: locationInput.value.trim() || null,
            description: descInput.value.trim() || null,
            calendarId,
            color: pendingColor,
            recurrence: recurrence ?? null,
          });
        }
        close();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await this._api.window.showErrorMessage(`Could not save event: ${msg}`);
      }
    };
    save.addEventListener('click', () => void doSave());
    foot.appendChild(save);
    pop.appendChild(foot);

    overlay.appendChild(pop);
    document.body.appendChild(overlay);

    // Keyboard: Enter saves (when not in textarea), Escape closes.
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') { close(); }
      else if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault(); void doSave();
      }
    }
    document.addEventListener('keydown', onKey);
    overlay.addEventListener('animationend', () => titleInput.focus(), { once: true });
    // Failsafe focus if animation doesn't fire (e.g. reduced-motion).
    setTimeout(() => { if (document.activeElement !== titleInput) titleInput.focus(); }, 80);

    // Position the popover next to the anchor; keep it on-screen.
    const m = pop.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    let left = anchor.left;
    let top = anchor.bottom + 6;
    // If anchor is in the right half, prefer left-align to its right edge so
    // long popovers don't fall off-screen.
    if (anchor.left + m.width > vw - 12) left = Math.max(12, vw - m.width - 12);
    if (top + m.height > vh - 12) top = Math.max(12, anchor.top - m.height - 6);
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
  }

  /**
   * Calendars manager — a popover to create calendars, recolour them (Google
   * palette), toggle visibility, rename, and delete. All backed by the existing
   * calendar CRUD; re-renders the grid on every change.
   */
  private async _openCalendarsMenu(anchor: DOMRect): Promise<void> {
    const overlay = el('div', 'planner-popover-overlay');
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    const pop = el('div', 'planner-popover planner-cals-menu');
    pop.style.position = 'fixed';

    const head = el('div', 'planner-popover__head');
    const heading = el('h3', 'planner-popover__title');
    heading.textContent = 'Calendars';
    head.appendChild(heading);
    const closeBtn = el('button', 'planner-popover__close');
    closeBtn.type = 'button';
    closeBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    closeBtn.addEventListener('click', () => overlay.remove());
    head.appendChild(closeBtn);
    pop.appendChild(head);

    const list = el('div', 'planner-cals-list');
    pop.appendChild(list);

    const rerenderGrid = (): void => { void this._renderTab(); };

    const renderList = async (): Promise<void> => {
      const cals = await this._data.listCalendars();
      list.innerHTML = '';
      for (const cal of cals) {
        const row = el('div', 'planner-cals-row');

        const swatch = el('button', 'planner-cals-swatch');
        swatch.type = 'button';
        swatch.style.setProperty('--sw', cal.color);
        swatch.title = 'Change colour';
        row.appendChild(swatch);

        const name = el('input', 'planner-cals-name') as HTMLInputElement;
        name.type = 'text';
        name.value = cal.name;
        const saveName = (): void => {
          const v = name.value.trim();
          if (v && v !== cal.name) void this._data.updateCalendar(cal.id, { name: v }).then(rerenderGrid);
        };
        name.addEventListener('blur', saveName);
        name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); name.blur(); } });
        row.appendChild(name);

        const vis = el('button', 'planner-cals-icon');
        vis.type = 'button';
        vis.title = cal.visible ? 'Hide on calendar' : 'Show on calendar';
        vis.classList.toggle('planner-cals-icon--off', !cal.visible);
        vis.innerHTML = cal.visible
          ? '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>'
          : '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
        vis.addEventListener('click', () => void this._data.updateCalendar(cal.id, { visible: !cal.visible }).then(() => { rerenderGrid(); void renderList(); }));
        row.appendChild(vis);

        if (!cal.isDefault) {
          const del = el('button', 'planner-cals-icon planner-cals-icon--danger');
          del.type = 'button';
          del.title = 'Delete calendar';
          del.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
          del.addEventListener('click', async () => {
            const res = await this._data.deleteCalendar(cal.id);
            if (!res.ok) { await this._api.window.showErrorMessage(res.reason || 'Cannot delete this calendar.'); return; }
            rerenderGrid();
            void renderList();
          });
          row.appendChild(del);
        }

        list.appendChild(row);

        // Inline palette, revealed by the swatch — recolours the calendar.
        const palette = buildColorSwatches(cal.color, (hex) => {
          if (!hex) return;
          swatch.style.setProperty('--sw', hex);
          void this._data.updateCalendar(cal.id, { color: hex }).then(rerenderGrid);
        }, false);
        palette.classList.add('planner-cals-palette');
        list.appendChild(palette);
        swatch.addEventListener('click', () => palette.classList.toggle('planner-cals-palette--open'));
      }
    };
    await renderList();

    const newRow = el('div', 'planner-cals-new');
    const newInput = el('input', 'planner-cals-name') as HTMLInputElement;
    newInput.type = 'text';
    newInput.placeholder = 'New calendar name';
    const addBtn = el('button', 'planner-popover__btn planner-popover__btn--primary');
    addBtn.type = 'button';
    addBtn.textContent = 'Add';
    const doAdd = async (): Promise<void> => {
      const v = newInput.value.trim();
      if (!v) { newInput.focus(); return; }
      const hex = PLANNER_COLORS[Math.floor(Math.random() * PLANNER_COLORS.length)].hex;
      await this._data.createCalendar({ name: v, color: hex });
      newInput.value = '';
      rerenderGrid();
      void renderList();
    };
    addBtn.addEventListener('click', () => void doAdd());
    newInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); void doAdd(); } });
    newRow.append(newInput, addBtn);
    pop.appendChild(newRow);

    overlay.appendChild(pop);
    document.body.appendChild(overlay);

    const m = pop.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const left = Math.max(12, Math.min(anchor.left, vw - m.width - 12));
    let top = anchor.bottom + 6;
    if (top + m.height > vh - 12) top = Math.max(12, anchor.top - m.height - 6);
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
  }

  // ── Disposal ─────────────────────────────────────────────────────────

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    for (const d of this._disposables) {
      try { d.dispose(); } catch { /* noop */ }
    }
    this._disposables.length = 0;
    if (this._root && this._root.parentElement) this._root.remove();
    this._root = null;
    this._bodyEl = null;
    this._container.classList.remove('planner-pane-host');
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function startOfDayMs(): number {
  const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime();
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function formatDateShort(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  if (sameDay(d, now)) return 'Today';
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  if (sameDay(d, tomorrow)) return 'Tomorrow';
  const diff = ts - now.getTime();
  if (diff > 0 && diff < 7 * 86_400_000) return d.toLocaleDateString(undefined, { weekday: 'short' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatHour(h: number): string {
  if (h === 0) return '12 AM';
  if (h === 12) return '12 PM';
  if (h < 12) return `${h} AM`;
  return `${h - 12} PM`;
}

function formatTimeShort(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function formatTimeRange(ev: PlannerEvent): string {
  const fmt = (ts: number) => new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (ev.allDay) return 'All day';
  return `${fmt(ev.startAt)} – ${fmt(ev.endAt)}`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

/** Normalize a raw href to a safe http/https URL, or null if not web-openable. */
function normalizeWebLink(rawHref: string): string | null {
  const trimmed = rawHref.trim();
  if (!trimmed) return null;
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed);
  const candidate = hasScheme ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Pull links out of free-form notes for the popover chip row.
 *  Recognizes internal `parallx://` URIs as well as web (http/https/www.)
 *  links. Internal links render as rich page chips; web links open the
 *  external browser. */
function extractLinks(text: string): { label: string; href: string; kind: 'web' | 'internal' }[] {
  if (!text) return [];
  const out: { label: string; href: string; kind: 'web' | 'internal' }[] = [];
  const seen = new Set<string>();
  const re = /(?:parallx:\/\/[^\s<>]+|(?:https?:\/\/|www\.)[^\s<>()]+)/gi;
  for (const match of text.matchAll(re)) {
    const raw = match[0].replace(/[.,;:!?]+$/, '');
    if (/^parallx:\/\//i.test(raw)) {
      if (seen.has(raw)) continue;
      seen.add(raw);
      out.push({ label: raw, href: raw, kind: 'internal' });
      continue;
    }
    const url = normalizeWebLink(raw);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    let label = url;
    try { const u = new URL(url); label = u.hostname.replace(/^www\./, '') + (u.pathname !== '/' ? u.pathname : ''); } catch { /* keep url */ }
    if (label.length > 42) label = label.slice(0, 41) + '\u2026';
    out.push({ label, href: url, kind: 'web' });
  }
  return out;
}

function toDateInputValue(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function toTimeInputValue(ms: number): string {
  const d = new Date(ms);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

function fromDateTimeInputs(dateStr: string, timeStr: string): number | null {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split('-').map(n => parseInt(n, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  let hour = 0, min = 0;
  if (timeStr) {
    const [hh, mm] = timeStr.split(':').map(n => parseInt(n, 10));
    if (Number.isFinite(hh)) hour = hh;
    if (Number.isFinite(mm)) min = mm;
  }
  const dt = new Date(y, m - 1, d, hour, min, 0, 0);
  return Number.isFinite(dt.getTime()) ? dt.getTime() : null;
}
