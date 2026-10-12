// plannerEditorProvider.ts — Planner editor pane.
//
// Two tabs: Tasks (review queue + grouped list) and Calendar (month /
// week / day view). Pure DOM + CSS Grid; no layout engine.

import type { IDisposable } from '../../platform/lifecycle.js';
import { escapeHtml } from '../../ui/format.js';
import type { PlannerDataService } from './plannerDataService.js';
import type { PlannerCalendar, PlannerEvent, PlannerTask, UpdateEventInput } from './plannerTypes.js';
import type { IPlannerSyncController } from './sync/plannerSyncOrchestrator.js';
import { googleSync } from './sync/googleClient.js';
import { takePendingPlannerTab } from './plannerNavState.js';
import { packLanes } from './plannerLayout.js';
import { PlannerTodayView } from './plannerToday.js';
import { createIconElement } from '../../ui/iconRegistry.js';
import { createButton } from '../../ui/kit.js';
import { showExtensionContextMenu } from '../../ui/contextMenu.js';
import { appDateParts, appDateString, appTime } from '../../services/localTime.js';
import { startOfDay, endOfDay, startOfWeek, startOfMonth, endOfMonth, addDays, atTime, sameDay, formatHour, formatTimeShort, formatTimeRange } from './plannerDates.js';
import { PANE_COMPACT_MAX, PLANNER_ICON_SVG, TASK_DOT_SVG, TASK_DONE_SVG, SYNC_SVG, PLANNER_COLORS, el, buildColorSwatches, type PlannerEditorInput, type PlannerEditorApi, type Tab, type CalendarView } from './plannerUi.js';
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
  private _calendarView: CalendarView = 'month';
  private _cursorDate: Date = startOfDay(new Date());
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
  constructor(
    private readonly _container: HTMLElement,
    private readonly _input: PlannerEditorInput | undefined,
    readonly _data: PlannerDataService,
    readonly _api: PlannerEditorApi,
    private readonly _sync?: IPlannerSyncController,
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
    let wasCompact = this._isCompact();
    const resize = new ResizeObserver(() => {
      const compact = this._isCompact();
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

    if (this._activeTab === 'today') {
      await this._renderTodayTab(nextBody, nextActions);
    } else if (this._activeTab === 'tasks') {
      await this.taskList.renderTasksTab(nextBody, nextActions);
    } else {
      await this._renderCalendarTab(nextBody, nextActions);
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
        loadCalCtx: () => this._loadCalCtx(),
        openEvent: (ev, anchor) => this.eventPopover.openEventPopover({ mode: 'edit', event: ev }, anchor),
        newEvent: (anchor) => {
          // Next whole hour today, the default event length the popover applies.
          const start = atTime(Date.now(), appDateParts(Date.now()).hour + 1);
          this.eventPopover.openEventPopover({ mode: 'create', startAt: start, endAt: start + 60 * 60 * 1000 }, anchor);
        },
        openTask: (task, anchor) => this.taskPopover.openTaskPopover({ mode: 'edit', task }, anchor),
        openDay: (dayStart) => {
          this._cursorDate = startOfDay(new Date(dayStart));
          this._setCalendarView('day');
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
    const label = this._viewLabel(this._calendarView);
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
              // Pushes that failed used to be console-only, so a workspace that
              // sent nothing upstream still reported "already up to date" — the
              // reason a sync could look clean while the other workspace never
              // saw the edit. Say it out loud instead.
              const stuck = results.reduce((n, r) => n + r.pushFailed, 0);
              if (stuck > 0) {
                const why = results.find((r) => r.pushError)?.pushError ?? 'unknown error';
                await this._api.window.showErrorMessage(
                  `Synced, but ${stuck} change${stuck === 1 ? '' : 's'} couldn’t be sent to Google (${why}). They’ll be retried on the next sync.`,
                );
              } else {
                await this._api.window.showInformationMessage(changes > 0 ? `Synced ${changes} change${changes === 1 ? '' : 's'}.` : 'Synced. Already up to date.');
              }
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
    const addEvt = createButton(null, { label: 'New Event', icon: 'plus', kind: 'primary', title: 'New Event (C)' });
    addEvt.classList.add('planner-cta');
    addEvt.addEventListener('click', () => {
      const start = atTime(this._cursorDate, 9);
      this.eventPopover.openEventPopover({
        mode: 'create',
        startAt: start,
        endAt: start + 60 * 60 * 1000,
      }, addEvt.getBoundingClientRect());
    });
    actions.appendChild(addEvt);

    if (this._calendarView === 'month') await this._renderMonthView(body);
    else if (this._calendarView === 'week') await this._renderWeekView(body);
    else await this._renderDayView(body);
  }

  /** Month / Week / Day: the app's menu, with the current view checked. */
  private _openViewMenu(anchorBtn: HTMLElement): void {
    showExtensionContextMenu(anchorBtn, (['month', 'week', 'day'] as CalendarView[]).map((v) => ({
      label: this._viewLabel(v),
      checked: v === this._calendarView,
      onSelect: () => { this._setCalendarView(v); void this._renderTab(); },
    })), { anchorPosition: 'below' });
  }

  /** Days the week view shows: 7 from Sunday, or 3 around the cursor in a compact pane. */
  private _spanDays = 7;

  private _isCompact(): boolean {
    const w = this._container.clientWidth;
    return w > 0 && w <= PANE_COMPACT_MAX;
  }

  private _weekSpan(): { start: Date; days: number } {
    return this._isCompact()
      ? { start: addDays(this._cursorDate, -1), days: 3 }
      : { start: startOfWeek(this._cursorDate), days: 7 };
  }

  /** "Week" names the view; a compact pane shows it as three days. */
  private _viewLabel(v: CalendarView): string {
    if (v === 'week' && this._isCompact()) return '3 Days';
    return v[0].toUpperCase() + v.slice(1);
  }

  /** Set the calendar view and persist it per-workspace. */
  private _setCalendarView(v: CalendarView): void {
    this._calendarView = v;
    this._api.viewState?.set('planner.calendarView', v);
  }

  private _navigateCalendar(direction: -1 | 1): void {
    const p = appDateParts(this._cursorDate);
    let next: number;
    if (this._calendarView === 'month') {
      // As Date's setMonth: Jan 31 + 1 month rolls into March.
      next = appTime(p.year, p.month + direction, p.day);
    } else if (this._calendarView === 'week') {
      next = appTime(p.year, p.month, p.day + direction * this._weekSpan().days);
    } else {
      next = appTime(p.year, p.month, p.day + direction);
    }
    this._cursorDate = startOfDay(new Date(next));
  }

  private _calendarRangeLabel(): string {
    if (this._calendarView === 'month') {
      return appDateString(this._cursorDate, { month: 'long', year: 'numeric' });
    }
    if (this._calendarView === 'week') {
      const { start, days } = this._weekSpan();
      const end = addDays(start, days - 1);
      const s = appDateParts(start);
      const e = appDateParts(end);
      return s.month === e.month
        ? `${appDateString(start, { month: 'long' })} ${s.day}–${e.day}, ${s.year}`
        : `${appDateString(start, { month: 'short', day: 'numeric' })} – ${appDateString(end, { month: 'short', day: 'numeric' })}, ${e.year}`;
    }
    return appDateString(this._cursorDate, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
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
    chip.addEventListener('click', (e) => { e.stopPropagation(); this.taskPopover.openTaskPopover({ mode: 'edit', task }, chip.getBoundingClientRect()); });
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
    pill.addEventListener('click', (e) => { e.stopPropagation(); this.taskPopover.openTaskPopover({ mode: 'edit', task }, pill.getBoundingClientRect()); });
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
    // Under ~45 minutes the block has room for the title only.
    if (evEnd - evStart < 45 * 60_000) bar.classList.add(`planner-${variant}__event--short`);
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

  private async _commitEventMove(ev: PlannerEvent, patch: UpdateEventInput, anchor: DOMRect): Promise<void> {
    this._note('moved', `event "${ev.title}"`, undefined, undefined);
    if (ev.seriesId) {
      const scope = await this.eventPopover.askSeriesScope('edit', anchor);
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
          this.eventPopover.openEventPopover({ mode: 'edit', event: ev }, chip.getBoundingClientRect());
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
          this.eventPopover.openEventPopover({ mode: 'edit', event: ev }, bar.getBoundingClientRect());
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
    const days = this._spanDays;
    const weekEndMs = addDays(weekStart, days).getTime();

    const band = el('div', 'planner-week__allday');
    const gutter = el('div', 'planner-week__allday-gutter');
    gutter.textContent = 'All day';
    band.appendChild(gutter);

    const grid = el('div', 'planner-week__allday-grid');
    band.appendChild(grid);

    // Background day cells — these are the drag-create surface.
    for (let i = 0; i < days; i++) {
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
      const endCol = Math.min(days - 1, this._weekDayIndex(ev.endAt, weekStartMs));
      let lane = laneEnds.findIndex(end => startCol > end);
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(endCol); }
      else laneEnds[lane] = endCol;
      maxLane = Math.max(maxLane, lane);

      const span = endCol - startCol + 1;
      const bar = el('button', 'planner-week__alldaybar');
      bar.type = 'button';
      bar.style.left = `calc(${(startCol / days) * 100}% + 2px)`;
      bar.style.width = `calc(${(span / days) * 100}% - 4px)`;
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

      const days = this._spanDays;
      const gridRect = grid.getBoundingClientRect();
      const colW = gridRect.width / days;
      const xToCol = (x: number) => Math.max(0, Math.min(days - 1, Math.floor((x - gridRect.left) / colW)));
      const startCol = xToCol(e.clientX);
      let endCol = startCol;
      let moved = false;

      const ghost = el('div', 'planner-week__allday-ghost');
      grid.appendChild(ghost);
      const drawGhost = () => {
        const a = Math.min(startCol, endCol), b = Math.max(startCol, endCol);
        ghost.style.left = `calc(${(a / days) * 100}% + 2px)`;
        ghost.style.width = `calc(${((b - a + 1) / days) * 100}% - 4px)`;
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
        this.eventPopover.openEventPopover({ mode: 'create', startAt: startMs, endAt: endMs, allDay: true, pendingGhost: ghost }, anchor);
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

      const days = this._spanDays;
      const gridRect = grid.getBoundingClientRect();
      const colW = gridRect.width / days;
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
        const endCol = Math.min(days - 1, this._weekDayIndex(curEnd, weekStartMs));
        bar.style.left = `calc(${(startCol / days) * 100}% + 2px)`;
        bar.style.width = `calc(${((endCol - startCol + 1) / days) * 100}% - 4px)`;
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
          this.eventPopover.openEventPopover({ mode: 'edit', event: ev }, bar.getBoundingClientRect());
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
    gutter.textContent = 'All day';
    band.appendChild(gutter);
    const list = el('div', 'planner-day__allday-list');
    band.appendChild(list);

    for (const ev of todays) {
      const chip = el('button', 'planner-day__alldaybar');
      chip.type = 'button';
      chip.style.setProperty('--cal-color', colorOf(ev.calendarId, ev.color));
      chip.innerHTML = `<span class="planner-week__alldaybar-title">${escapeHtml(ev.title)}</span>`;
      chip.title = ev.title;
      chip.addEventListener('click', () => this.eventPopover.openEventPopover({ mode: 'edit', event: ev }, chip.getBoundingClientRect()));
      list.appendChild(chip);
    }
    // Click the empty strip to add an all-day event for this day.
    list.addEventListener('click', (e) => {
      if (e.target !== list) return;
      this.eventPopover.openEventPopover({ mode: 'create', startAt: dayStart, endAt: dayEnd, allDay: true }, list.getBoundingClientRect());
    });
    host.appendChild(band);
  }

  // ── Description links (notes + clickable links) ─────────────────────

  /**
   * gather per-day loads from every registered provider for the given
   * window, keyed by LOCAL day start. Provider failures are isolated: a
   * throwing provider contributes nothing and cannot break the calendar.
   */
  private async _collectDayLoads(fromMs: number, toMs: number): Promise<Map<number, { count: number; label: string }[]>> {
    const byDay = new Map<number, { count: number; label: string }[]>();
    const providers = this._api.dayLoads?.get() ?? [];
    if (providers.length === 0) return byDay;
    // Per-provider timeout: this await sits inside the
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
      if (appDateParts(day).month !== appDateParts(this._cursorDate).month) cell.classList.add('planner-month__cell--other-month');
      if (sameDay(day, new Date())) cell.classList.add('planner-month__cell--today');

      const number = el('span', 'planner-month__cellnum');
      number.textContent = String(appDateParts(day).day);
      cell.appendChild(number);

      // provider day-load badge ("38 cards"), a decoration, not a row.
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
    const { start, days } = this._weekSpan();
    this._spanDays = days;
    const end = addDays(start, days);
    const { isVisible, colorOf } = await this._loadCalCtx();
    const allEvents = (await this._data.listEvents({ from: start.getTime(), to: end.getTime(), limit: 500 })).filter(ev => isVisible(ev.calendarId));
    const allDayEvents = allEvents.filter(ev => this._isAllDayLike(ev));
    const events = allEvents.filter(ev => !this._isAllDayLike(ev));
    const tasks = await this._tasksInWindow(start.getTime(), end.getTime(), isVisible);
    const dayLoads = await this._collectDayLoads(start.getTime(), end.getTime());

    const grid = el('div', 'planner-week');
    grid.style.setProperty('--planner-week-days', String(days));
    const headerRow = el('div', 'planner-week__header');
    headerRow.appendChild(el('div', 'planner-week__corner'));
    for (let i = 0; i < days; i++) {
      const day = addDays(start, i);
      const wd = el('div', 'planner-week__weekday');
      const wdLabel = el('span', 'planner-week__weekday-label');
      wdLabel.textContent = appDateString(day, { weekday: 'short' });
      const wdNum = el('span', 'planner-week__weekday-num');
      wdNum.textContent = String(appDateParts(day).day);
      if (sameDay(day, new Date())) wd.classList.add('planner-week__weekday--today');
      wd.appendChild(wdLabel);
      wd.appendChild(wdNum);
      // provider day-load chip under the weekday header.
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

    for (let i = 0; i < days; i++) {
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

        this.eventPopover.openEventPopover({
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
