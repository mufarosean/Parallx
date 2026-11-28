// plannerEditorProvider.ts — Planner editor pane.
//
// Three tabs: Today, Tasks and Calendar. The pane keeps the shell, the tab
// and view state, Today and the keys; each other part is a module here:
// plannerTaskList (Tasks), plannerCalendarViews (Calendar), plannerEventBars
// and plannerAllDay (what the grids draw and drag), plannerTaskPopover and
// plannerEventPopover (the dialogs), plannerNotes, plannerCalendarsMenu, and
// plannerUi (what they share). Pure DOM + CSS Grid; no layout engine.

import type { IDisposable } from '../../platform/lifecycle.js';
import type { PlannerDataService } from './plannerDataService.js';
import type { IPlannerSyncController } from './sync/plannerSyncOrchestrator.js';
import { plannerDayFrom, takePlannerOver, type PlannerOver } from './plannerNavState.js';
import type { PlaceLocation, PlaceView, PlaceViewHost } from '../../services/places.js';
import { PlannerTodayView } from './plannerToday.js';
import { appDateParts } from '../../services/localTime.js';
import { startOfDay, endOfDay, atTime } from './plannerDates.js';
import { el, type PlannerEditorApi, type Tab, type CalendarView } from './plannerUi.js';
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

  /** Planner's places in one tab (services/places.ts): the core says where, the pane draws it. */
  createView(container: HTMLElement, host: PlaceViewHost): PlaceView {
    const pane = new PlannerEditorPane(container, host, this._data, this._api, this._sync);
    const ready = pane.init().catch(err => console.error('[PlannerEditorProvider] pane init failed:', err));
    return {
      show: async (location) => { await ready; await pane.showLocation(location); },
      dispose: () => pane.dispose(),
    };
  }
}

/** Planner's places, as the core's places name them. */
export const PLANNER_PLACES = [
  { id: 'today', title: 'Today' },
  { id: 'calendar', title: 'Calendar' },
  { id: 'tasks', title: 'Tasks' },
] as const;

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
    private readonly _host: PlaceViewHost,
    readonly _data: PlannerDataService,
    readonly _api: PlannerEditorApi,
    readonly _sync?: IPlannerSyncController,
  ) {}

  async init(): Promise<void> {
    if (this._disposed) return;
    // Which page is the core's (services/places.ts): it calls showLocation.
    // Restore the rest of the view state for this workspace. The pane is
    // rebuilt every time the user switches editor tabs away and back, so
    // anything not persisted silently resets to defaults ("why am I on
    // Tasks again?"). Restored: active tab, calendar view, tasks filter,
    // calendar cursor date.
    const vs = this._api.viewState;
    if (vs) {
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
    this._buildShell();

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
      // A key a control already handled (the month grid's arrows) is not a shortcut too.
      if (e.defaultPrevented) return;
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

    // Header: the page's own actions. The three pages (Today, Tasks, Calendar)
    // are chosen in Planner's list in the sidebar and by the command
    // planner.show; the page had a second copy of that switch as tabs.
    const header = el('header', 'planner-pane__header');

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

  private _shown = false;

  /** The core moved this tab (services/places.ts): draw the place it names, then what a command sent to open over it. */
  async showLocation(location: PlaceLocation): Promise<void> {
    if (this._disposed) return;
    location = this._olderBuildPlace(location);
    const tab: Tab = location.place === 'calendar' || location.place === 'tasks' ? location.place : 'today';
    const params = location.params ?? {};
    if (tab === 'tasks') this._tasksFilter = params.list || 'all';
    if (tab === 'calendar') {
      this._cursorDate = plannerDayFrom(params.date) ?? this._cursorDate;
      if (params.view === 'month' || params.view === 'week' || params.view === 'day') this._calendarView = params.view;
      // A day or a view asked for once: after it, the calendar goes where it is moved, so the tab's address is the calendar alone.
      if (params.date || params.view) this._host.replace({ place: 'calendar' });
    }
    this._shown = true;
    this._activeTab = tab;
    this._syncTabClass();
    await this._renderTab();
    const over = takePlannerOver(tab);
    if (over && !this._disposed) await this._openOver(over);
  }

  /**
   * A tab saved by a build before the places point carried no address, and its
   * page was kept in Planner's workspace state: the first drawing after it
   * goes to that page, once (the old key is then cleared).
   */
  private _olderBuildPlace(location: PlaceLocation): PlaceLocation {
    const vs = this._api.viewState;
    const older = vs?.get<string>('planner.activeTab', '');
    if (!vs || !older) return location;
    vs.set('planner.activeTab', undefined);
    if (location.place !== 'today' || location.params || (older !== 'calendar' && older !== 'tasks')) return location;
    this._host.replace({ place: older });
    return { place: older };
  }

  /** A form, or an item in detail, as a popover over the place drawn; when it closes the keys go back to its opener or to the page's title. */
  private async _openOver(over: PlannerOver): Promise<void> {
    const root = this._root;
    if (!root) return;
    const near = (sel: string, w: number): DOMRect => {
      const r = root.querySelector<HTMLElement>(sel)?.getBoundingClientRect();
      return r && r.width > 0 ? r : new DOMRect(window.innerWidth / 2 - w, 100, 0, 0);
    };
    if (over.form === 'newTask') {
      this.taskPopover.openTaskPopover({ mode: 'create' }, near('.planner-cta', 180));
    } else if (over.form === 'newEvent') {
      // On the calendar at 9 on the day in view, on Today at the next whole hour.
      const start = this._activeTab === 'calendar' ? atTime(this._cursorDate, 9) : atTime(Date.now(), appDateParts(Date.now()).hour + 1);
      await this.eventPopover.openEventPopover({ mode: 'create', startAt: start, endAt: start + 60 * 60 * 1000 }, near('[data-px-id="planner.newEvent"]', 230));
    } else if (over.form === 'task') {
      const task = await this._data.getTask(over.id).catch(() => null);
      if (task && !this._disposed) this.taskPopover.openTaskPopover({ mode: 'edit', task }, near(`[data-task-id="${CSS.escape(task.id)}"]`, 180));
    } else {
      // The occurrence drawn that day (one of a series has its own id), else the event itself.
      const day = new Date(over.at);
      const base = (id: string) => id.split('::')[0];
      const events = await this._data.listEvents({ from: startOfDay(day).getTime(), to: endOfDay(day).getTime() }).catch(() => []);
      const event = events.find((e) => e.id === over.id) ?? events.find((e) => base(e.id) === base(over.id) && e.startAt === over.at)
        ?? events.find((e) => base(e.id) === base(over.id)) ?? await this._data.getEvent(over.id).catch(() => null);
      if (event && !this._disposed) await this.eventPopover.openEventPopover({ mode: 'edit', event }, near(`[data-event-id="${CSS.escape(event.id)}"]`, 230));
    }
  }

  /** The bar or chip this event is drawn as on the page, when it is. */
  eventElement(id: string): HTMLElement | null {
    return [...(this._root?.querySelectorAll<HTMLElement>(`[data-event-id="${CSS.escape(id)}"]`) ?? [])].find((e) => e.getClientRects().length) ?? null;
  }

  /** Where the keys go when a popover over the page closes: its opener when it is still on the page (or drawn again), else the page's title. */
  returnFocus(opener: HTMLElement | null): void {
    const active = document.activeElement;
    if (active && active !== document.body) return;
    const root = this._root;
    if (opener?.isConnected) { opener.focus(); return; }
    // Drawn again since (a data change, a move): the control with the same id, or the same event's bar or task's row.
    const by = (['data-px-id', 'data-event-id', 'data-task-id'] as const).find((a) => opener?.hasAttribute(a));
    const again = by && root ? root.querySelector<HTMLElement>(`[${by}="${CSS.escape(opener!.getAttribute(by)!)}"]`) : null;
    if (again) { again.focus(); return; }
    const title = root?.querySelector<HTMLElement>('.px-page-header__title');
    if (title) { if (!title.hasAttribute('tabindex')) title.tabIndex = -1; title.focus({ preventScroll: true }); }
  }

  /** Where this pane is, as a place's location. */
  _location(tab: Tab = this._activeTab): PlaceLocation {
    return tab === 'tasks' && this._tasksFilter !== 'all' ? { place: 'tasks', params: { list: this._tasksFilter } } : { place: tab };
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
    const sig = `${this._calendarView}|${this._tasksFilter}|${this._cursorDate.getTime()}`;
    if (sig === this._lastViewStateSig) return;
    this._lastViewStateSig = sig;
    vs.set('planner.calendarView', this._calendarView);
    vs.set('planner.tasksFilter', this._tasksFilter);
    vs.set('planner.cursorDate', this._cursorDate.toISOString());
    // Freshness stamp for the same-day restore guard in init().
    vs.set('planner.cursorSavedAt', Date.now());
  }

  /** The page shown, on the pane's root: its styles and whoever reads the app find it there. */
  private _syncTabClass(): void {
    if (this._root) this._root.dataset.tab = this._activeTab;
  }

  /**
   * Re-entrancy-safe tab render. `_renderTabOnce` clears the body up front but
   * appends its content only AFTER awaiting data — so two overlapping calls
   * (e.g. a burst of onDidChange events during a sync) would each clear-then-
   * append and stack DUPLICATE grids. Serialize them: only one runs at a time,
   * and a call arriving mid-render coalesces into a single trailing re-render.
   */
  async _renderTab(): Promise<void> {
    // Nothing is drawn before the core has said which page (a data change can come first).
    if (!this._shown) return;
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

    // A control pressed (the calendar's arrows, Today, Month, Week and Day) is drawn
    // again with the page: the keys stay on it rather than falling to nothing.
    const on = this._root?.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
    const held = (on?.getAttribute('role') === 'radio' ? on.closest('[role="radiogroup"]') : on)?.getAttribute('data-px-id') ?? null;
    body.replaceChildren(...Array.from(nextBody.childNodes));
    actions.replaceChildren(...Array.from(nextActions.childNodes));
    if (held && (!document.activeElement || document.activeElement === document.body)) this._refocus(held);
  }

  /** The control with this id on the page (for a switch, its chosen option), focused. */
  private _refocus(id: string): void {
    const el = this._root?.querySelector<HTMLElement>(`[data-px-id="${CSS.escape(id)}"]`);
    if (!el) return;
    const inner = el.matches('button, input, select, textarea, [tabindex]') ? el : el.querySelector<HTMLElement>('[aria-checked="true"], [tabindex="0"]');
    (inner ?? el).focus({ preventScroll: true });
  }

  // ── Today tab ────────────────────────────────────────────────────────

  private _today: PlannerTodayView | null = null;

  private async _renderTodayTab(body: HTMLElement, actions: HTMLElement): Promise<void> {
    if (!this._today) {
      this._today = new PlannerTodayView({
        data: this._data,
        loadCalCtx: () => this.calendar.loadCalCtx(),
        openEvent: (ev, anchor) => this.eventPopover.openEventPopover({ mode: 'edit', event: ev }, anchor),
        openTask: (task, anchor) => this.taskPopover.openTaskPopover({ mode: 'edit', task }, anchor),
        // A day pressed: the calendar on that day, a move like any other.
        openDay: (dayStart) => {
          const d = new Date(dayStart);
          const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          this._host.go({ place: 'calendar', params: { date, view: 'day' } });
        },
        openReviewQueue: () => { this._host.go({ place: 'tasks', params: { list: 'review' } }); },
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
