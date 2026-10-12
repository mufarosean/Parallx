// plannerEditorProvider.ts — Planner editor pane.
//
// Three tabs: Today, Tasks and Calendar. The pane keeps the shell, the tab
// and view state, Today and the keys; each other part is a module here:
// plannerTaskList (Tasks), plannerCalendarViews (Calendar), plannerEventBars
// and plannerAllDay (what the grids draw and drag), plannerTaskPopover and
// plannerEventPopover (the dialogs), plannerNotes, plannerCalendarsMenu, and
// plannerUi (what they share). Pure DOM + CSS Grid; no layout engine.

import { declareControl } from '../../ui/kit.js';
import type { IDisposable } from '../../platform/lifecycle.js';
import type { PlannerDataService } from './plannerDataService.js';
import type { IPlannerSyncController } from './sync/plannerSyncOrchestrator.js';
import { takePendingPlannerTab } from './plannerNavState.js';
import { PlannerTodayView } from './plannerToday.js';
import { createIconElement } from '../../ui/iconRegistry.js';
import { appDateParts } from '../../services/localTime.js';
import { startOfDay, atTime } from './plannerDates.js';
import { PLANNER_ICON_SVG, el, type PlannerEditorInput, type PlannerEditorApi, type Tab, type CalendarView } from './plannerUi.js';
import { PlannerCalendarViews } from './plannerCalendarViews.js';
import { PlannerAllDay } from './plannerAllDay.js';
import { PlannerEventBars } from './plannerEventBars.js';
import { PlannerCalendarsMenu } from './plannerCalendarsMenu.js';
import { PlannerTaskList } from './plannerTaskList.js';
import { PlannerTaskPopover } from './plannerTaskPopover.js';
import { PlannerEventPopover } from './plannerEventPopover.js';
import { PlannerNotes } from './plannerNotes.js';

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

export class PlannerEditorPane implements IDisposable {
  private _root: HTMLElement | null = null;
  /** True when the last pointerdown landed inside this pane (see onKey). */
  private _pointerInside = false;
  private _bodyEl: HTMLElement | null = null;
  private _activeTab: Tab = 'today';
  _calendarView: CalendarView = 'month';
  _cursorDate: Date = startOfDay(new Date());
  /** Persists the currently-selected filter inside the Tasks tab. */
  _tasksFilter: string = 'all';
  private _disposed = false;
  /** Re-entrancy guard for _renderTab (async clear-then-append must not overlap). */
  private _rendering = false;
  private _renderQueued = false;
  private readonly _disposables: IDisposable[] = [];

  readonly notes = new PlannerNotes(this);
  readonly eventPopover = new PlannerEventPopover(this);
  readonly taskPopover = new PlannerTaskPopover(this);
  readonly taskList = new PlannerTaskList(this);
  readonly calendarsMenu = new PlannerCalendarsMenu(this);
  readonly eventBars = new PlannerEventBars(this);
  readonly allDay = new PlannerAllDay(this);
  readonly calendar = new PlannerCalendarViews(this);
  constructor(
    readonly _container: HTMLElement,
    private readonly _input: PlannerEditorInput | undefined,
    readonly _data: PlannerDataService,
    readonly _api: PlannerEditorApi,
    readonly _sync?: IPlannerSyncController,
  ) {}

  async init(): Promise<void> {
    if (this._disposed) return;
    // Honour a tab the sidebar requested before this pane existed (deterministic
    // first-open). The focusTab event below handles re-clicks while already open.
    // restore the full view state for this workspace. The pane is
    // rebuilt every time the user switches editor tabs away and back, so
    // anything not persisted silently resets to defaults ("why am I on
    // Tasks again?"). Restored: active tab, calendar view, tasks filter,
    // calendar cursor date.
    const vs = this._api.viewState;
    if (vs) {
      const savedTab = vs.get<string>('planner.activeTab', 'today');
      // 'scheduled' and 'automations' were retired tabs: routines live in Agents.
      if (savedTab === 'today' || savedTab === 'tasks' || savedTab === 'calendar') this._activeTab = savedTab;
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

    // The week view shows 3 days in a compact pane and 7 otherwise; repaint
    // the calendar when the pane crosses that width (a split, a sidebar).
    let wasCompact = this.calendar.isCompact();
    const resize = new ResizeObserver(() => {
      const compact = this.calendar.isCompact();
      if (compact === wasCompact || this._disposed) return;
      wasCompact = compact;
      if (this._activeTab === 'calendar') void this._renderTab();
    });
    resize.observe(this._container);
    this._disposables.push({ dispose: () => resize.disconnect() });

    this._disposables.push(this._data.onDidChange(() => {
      if (this._disposed) return;
      void this._renderTab();
    }));

    // day-load providers repaint the calendar when their data moves
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
      if (tab === 'today' || tab === 'tasks' || tab === 'calendar') this._setTab(tab);
    };
    document.addEventListener('parallx.planner.focusTab', onFocusTab);

    // planner.newTask command dispatches this; the active pane opens
    // the dedicated task popover.
    const onNewTask = () => {
      if (!this._root?.isConnected) return;
      this._setTab('tasks');
      // Open beside the Create button it stands for (the body's top-left
      // corner put the popover over the menu bar); centred if it is hidden.
      const cta = this._root.querySelector<HTMLElement>('.planner-cta');
      const r = cta?.getBoundingClientRect();
      const anchor = r && r.width > 0 ? r : new DOMRect(window.innerWidth / 2 - 180, 100, 0, 0);
      this.taskPopover.openTaskPopover({ mode: 'create' }, anchor);
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
      // Nothing focused at all: the letters belong to the planner only if the
      // planner was the last surface the pointer touched. Without this, a
      // canvas page open beside a planner tab handed its first keystrokes to
      // these shortcuts ("n" opened a task popover over the page).
      if ((!active || active === document.body) && !this._pointerInside) return;
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
          // C — quick create (event in calendar and today, task in tasks)
          if (this._activeTab === 'calendar' || this._activeTab === 'today') {
            const start = atTime(this._cursorDate, 9);
            this.eventPopover.openEventPopover({
              mode: 'create',
              startAt: start,
              endAt: start + 60 * 60 * 1000,
            }, new DOMRect(window.innerWidth / 2 - 180, 100, 0, 0));
          } else {
            this.taskPopover.openTaskPopover({ mode: 'create' }, new DOMRect(window.innerWidth / 2 - 180, 100, 0, 0));
          }
          e.preventDefault();
          break;
        case 'arrowleft':
          if (this._activeTab === 'calendar') {
            this.calendar.navigateCalendar(-1);
            void this._renderTab();
            e.preventDefault();
          }
          break;
        case 'arrowright':
          if (this._activeTab === 'calendar') {
            this.calendar.navigateCalendar(1);
            void this._renderTab();
            e.preventDefault();
          }
          break;
        case 'm':
          if (this._activeTab === 'calendar') {
            this.calendar.setCalendarView('month');
            void this._renderTab();
            e.preventDefault();
          }
          break;
        case 'w':
          if (this._activeTab === 'calendar') {
            this.calendar.setCalendarView('week');
            void this._renderTab();
            e.preventDefault();
          }
          break;
        case 'd':
          if (this._activeTab === 'calendar') {
            this.calendar.setCalendarView('day');
            void this._renderTab();
            e.preventDefault();
          }
          break;
      }
    };
    document.addEventListener('keydown', onKey);
    const onPointer = (e: PointerEvent) => {
      this._pointerInside = !!this._root?.contains(e.target as Node);
    };
    document.addEventListener('pointerdown', onPointer, true);
    this._disposables.push({ dispose: () => document.removeEventListener('pointerdown', onPointer, true) });

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
      { key: 'today',     label: 'Today',     icon: 'sun' },
      { key: 'tasks',     label: 'Tasks',     icon: 'list-checks' },
      { key: 'calendar',  label: 'Calendar',  icon: 'calendar' },
    ];
    for (const t of tabsConfig) {
      const tab = el('button', 'planner-pane__tab');
      tab.type = 'button';
      tab.dataset.tab = t.key;
      tab.title = t.label;
      tab.setAttribute('aria-label', t.label);
      tab.appendChild(createIconElement(t.icon, 14));
      const label = el('span', 'planner-pane__tab-label');
      label.textContent = t.label;
      tab.appendChild(label);
      tab.addEventListener('click', () => this._setTab(t.key));
      declareControl(tab, { id: `planner.tab.${t.key}`, label: t.label, state: () => ({ kind: 'pressed', value: tab.dataset.tab === this._activeTab }) });
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
   * Persist the pane's view state per-workspace. Deduped by signature
   * so the render loop (which also fires on data changes) doesn't spam the
   * memento with identical writes.
   */
  private _lastViewStateSig = '';
  _saveViewState(): void {
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
  async _renderTab(): Promise<void> {
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

    if (this._activeTab === 'today') {
      await this._renderTodayTab(nextBody, nextActions);
    } else if (this._activeTab === 'tasks') {
      await this.taskList.renderTasksTab(nextBody, nextActions);
    } else {
      await this.calendar.renderCalendarTab(nextBody, nextActions);
    }
    if (this._disposed) return;

    body.replaceChildren(...Array.from(nextBody.childNodes));
    actions.replaceChildren(...Array.from(nextActions.childNodes));
  }

  // ── Today tab ────────────────────────────────────────────────────────

  private _today: PlannerTodayView | null = null;

  private async _renderTodayTab(body: HTMLElement, actions: HTMLElement): Promise<void> {
    if (!this._today) {
      this._today = new PlannerTodayView({
        data: this._data,
        loadCalCtx: () => this.calendar.loadCalCtx(),
        openEvent: (ev, anchor) => this.eventPopover.openEventPopover({ mode: 'edit', event: ev }, anchor),
        newEvent: (anchor) => {
          // Next whole hour today, the default event length the popover applies.
          const start = atTime(Date.now(), appDateParts(Date.now()).hour + 1);
          this.eventPopover.openEventPopover({ mode: 'create', startAt: start, endAt: start + 60 * 60 * 1000 }, anchor);
        },
        openTask: (task, anchor) => this.taskPopover.openTaskPopover({ mode: 'edit', task }, anchor),
        openDay: (dayStart) => {
          this._cursorDate = startOfDay(new Date(dayStart));
          this.calendar.setCalendarView('day');
          this._setTab('calendar');
        },
        openReviewQueue: () => {
          this._tasksFilter = 'review';
          this._setTab('tasks');
        },
        note: (verb, object, taskId, detail) => this._note(verb, object, taskId, detail),
      });
      this._disposables.push(this._today);
    }
    await this._today.render(body, actions);
  }

  // ── Tasks tab ────────────────────────────────────────────────────────

  /** Days the week view shows: 7 from Sunday, or 3 around the cursor in a compact pane. */
  _spanDays = 7;

  /**
   * Commit a drag-move/resize. Non-series events update directly; a series
   * occurrence prompts the this/following/all scope and routes accordingly.
   * A cancelled prompt re-renders so the dragged bar snaps back.
   */
  /** The planner's own narration: the user's task gestures, at the gesture. */
  _note(verb: string, object: string, taskId?: string, detail?: string): void {
    try {
      this._api.activity?.note({ actor: 'user', source: 'planner', verb, object, detail, ref: taskId ? `task:${taskId}` : undefined });
    } catch { /* narration never breaks the gesture */ }
  }

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
