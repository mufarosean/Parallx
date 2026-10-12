// plannerCalendarViews.ts — the Planner's Calendar tab: its toolbar (today,
// previous and next, the date range, the month, week or day menu, sync,
// calendars, new event), the month, week and day grids with the tasks due
// in them and the day-load badges tools add, and drag-create on an empty
// slot. A narrow pane shows fewer days in the week view.

import { declareControl } from '../../ui/kit.js';
import type { PlannerCalendar, PlannerTask } from './plannerTypes.js';
import { googleSync } from './sync/googleClient.js';
import { createButton } from '../../ui/kit.js';
import { showExtensionContextMenu } from '../../ui/contextMenu.js';
import { appDateParts, appDateString, appTime } from '../../services/localTime.js';
import { startOfDay, endOfDay, startOfWeek, startOfMonth, endOfMonth, addDays, atTime, sameDay, formatHour, formatTimeShort, formatTimeRange } from './plannerDates.js';
import { type CalendarView, PANE_COMPACT_MAX, SYNC_SVG, el } from './plannerUi.js';
import type { PlannerEditorPane } from './plannerEditorProvider.js';

export class PlannerCalendarViews {
  constructor(private readonly _pane: PlannerEditorPane) {}

  async renderCalendarTab(body: HTMLElement, actions: HTMLElement): Promise<void> {
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
    declareControl(today, { id: 'planner.calendar.today', label: 'Today', hint: today.title });
    today.addEventListener('click', () => { this._pane._cursorDate = startOfDay(new Date()); void this._pane._renderTab(); });
    actions.appendChild(today);

    // Prev / Next — connected icon pair.
    const nav = el('div', 'planner-cnav');
    const prev = el('button', 'planner-iconbtn');
    prev.type = 'button';
    prev.title = 'Previous (←)';
    declareControl(prev, { id: 'planner.calendar.previous', label: 'Previous', kind: 'iconButton' });
    prev.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>';
    prev.addEventListener('click', () => { this.navigateCalendar(-1); void this._pane._renderTab(); });
    nav.appendChild(prev);
    const next = el('button', 'planner-iconbtn');
    next.type = 'button';
    next.title = 'Next (→)';
    declareControl(next, { id: 'planner.calendar.next', label: 'Next', kind: 'iconButton' });
    next.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>';
    next.addEventListener('click', () => { this.navigateCalendar(1); void this._pane._renderTab(); });
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
    const label = this._viewLabel(this._pane._calendarView);
    viewBtn.innerHTML = `<span>${label}</span><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><polyline points="6 9 12 15 18 9"/></svg>`;
    viewBtn.addEventListener('click', () => this._openViewMenu(viewBtn));
    declareControl(viewBtn, { id: 'planner.calendar.view', label: 'View', kind: 'select', state: () => ({ kind: 'value', value: this._pane._calendarView }) });
    actions.appendChild(viewBtn);

    // Sync — pull/push Google Calendar right from the planner (no trip to Settings).
    if (this._pane._sync) {
      const sync = this._pane._sync;
      const syncBtn = el('button', 'planner-iconbtn');
      syncBtn.type = 'button';
      syncBtn.title = 'Sync with Google Calendar';
      declareControl(syncBtn, { id: 'planner.calendar.sync', label: 'Sync with Google Calendar', kind: 'iconButton' });
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
            await this._pane._api.window.showErrorMessage(`Sync failed: ${errorMsg}`);
            return;
          }
          const choice = await this._pane._api.window.showErrorMessage(
            'Google sync stopped. Your connection expired or was revoked. Reconnect to resume syncing.',
            { title: 'Reconnect' },
          );
          if (choice?.title !== 'Reconnect') return;
          const res = await googleSync.authorize();
          if (res.ok) {
            await sync.refreshProviders();
            await this._pane._api.window.showInformationMessage('Reconnected to Google. Syncing will resume.');
          } else {
            await this._pane._api.window.showErrorMessage(`Couldn’t reconnect: ${res.error ?? 'unknown error'}`);
          }
        };

        try {
          const results = await sync.syncNow();
          if (results.length === 0) {
            await this._pane._api.window.showInformationMessage('No calendar connected. Connect Google Calendar in Settings → Planner.');
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
                await this._pane._api.window.showErrorMessage(
                  `Synced, but ${stuck} change${stuck === 1 ? '' : 's'} couldn’t be sent to Google (${why}). They’ll be retried on the next sync.`,
                );
              } else {
                await this._pane._api.window.showInformationMessage(changes > 0 ? `Synced ${changes} change${changes === 1 ? '' : 's'}.` : 'Synced. Already up to date.');
              }
            }
          }
        } catch (err) {
          await presentFailure(err instanceof Error ? err.message : String(err));
        } finally {
          syncBtn.classList.remove('planner-iconbtn--busy');
          syncBtn.disabled = false;
          void this._pane._renderTab();
        }
      });
      actions.appendChild(syncBtn);
    }

    // Calendars — manage colours, visibility, and create new calendars.
    const calsBtn = el('button', 'planner-iconbtn');
    calsBtn.type = 'button';
    calsBtn.title = 'Calendars';
    declareControl(calsBtn, { id: 'planner.calendar.calendars', label: 'Calendars', kind: 'iconButton' });
    calsBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>';
    calsBtn.addEventListener('click', () => void this._pane.calendarsMenu.openCalendarsMenu(calsBtn.getBoundingClientRect()));
    actions.appendChild(calsBtn);

    // Primary CTA.
    const addEvt = createButton(null, { id: 'planner.newEvent', command: 'planner.newEvent', label: 'New Event', icon: 'plus', kind: 'primary', title: 'New Event (C)' });
    addEvt.classList.add('planner-cta');
    addEvt.addEventListener('click', () => {
      const start = atTime(this._pane._cursorDate, 9);
      this._pane.eventPopover.openEventPopover({
        mode: 'create',
        startAt: start,
        endAt: start + 60 * 60 * 1000,
      }, addEvt.getBoundingClientRect());
    });
    actions.appendChild(addEvt);

    if (this._pane._calendarView === 'month') await this._renderMonthView(body);
    else if (this._pane._calendarView === 'week') await this._renderWeekView(body);
    else await this._renderDayView(body);
  }

  /** Month / Week / Day: the app's menu, with the current view checked. */
  private _openViewMenu(anchorBtn: HTMLElement): void {
    showExtensionContextMenu(anchorBtn, (['month', 'week', 'day'] as CalendarView[]).map((v) => ({
      label: this._viewLabel(v),
      checked: v === this._pane._calendarView,
      onSelect: () => { this.setCalendarView(v); void this._pane._renderTab(); },
    })), { anchorPosition: 'below' });
  }

  isCompact(): boolean {
    const w = this._pane._container.clientWidth;
    return w > 0 && w <= PANE_COMPACT_MAX;
  }

  private _weekSpan(): { start: Date; days: number } {
    return this.isCompact()
      ? { start: addDays(this._pane._cursorDate, -1), days: 3 }
      : { start: startOfWeek(this._pane._cursorDate), days: 7 };
  }

  /** "Week" names the view; a compact pane shows it as three days. */
  private _viewLabel(v: CalendarView): string {
    if (v === 'week' && this.isCompact()) return '3 Days';
    return v[0].toUpperCase() + v.slice(1);
  }

  /** Set the calendar view and persist it per-workspace. */
  setCalendarView(v: CalendarView): void {
    this._pane._calendarView = v;
    this._pane._api.viewState?.set('planner.calendarView', v);
  }

  navigateCalendar(direction: -1 | 1): void {
    const p = appDateParts(this._pane._cursorDate);
    let next: number;
    if (this._pane._calendarView === 'month') {
      // As Date's setMonth: Jan 31 + 1 month rolls into March.
      next = appTime(p.year, p.month + direction, p.day);
    } else if (this._pane._calendarView === 'week') {
      next = appTime(p.year, p.month, p.day + direction * this._weekSpan().days);
    } else {
      next = appTime(p.year, p.month, p.day + direction);
    }
    this._pane._cursorDate = startOfDay(new Date(next));
  }

  private _calendarRangeLabel(): string {
    if (this._pane._calendarView === 'month') {
      return appDateString(this._pane._cursorDate, { month: 'long', year: 'numeric' });
    }
    if (this._pane._calendarView === 'week') {
      const { start, days } = this._weekSpan();
      const end = addDays(start, days - 1);
      const s = appDateParts(start);
      const e = appDateParts(end);
      return s.month === e.month
        ? `${appDateString(start, { month: 'long' })} ${s.day}–${e.day}, ${s.year}`
        : `${appDateString(start, { month: 'short', day: 'numeric' })} – ${appDateString(end, { month: 'short', day: 'numeric' })}, ${e.year}`;
    }
    return appDateString(this._pane._cursorDate, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  }

  // ── Calendar colour + visibility context ────────────────────────────
  //
  // Resolves which calendars are currently shown and each item's display
  // colour (event/task override → calendar colour → fallback). Loaded once
  // per render so every view filters + colours consistently. Tolerates an
  // empty / missing calendars table (treats everything as visible).
  async loadCalCtx(): Promise<{
    isVisible: (calendarId: string | null) => boolean;
    colorOf: (calendarId: string | null, override: string | null) => string;
  }> {
    let cals: PlannerCalendar[] = [];
    try { cals = await this._pane._data.listCalendars(); } catch { /* table may be empty */ }
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
    const tasks = await this._pane._data.listTasks({ status: ['reviewing', 'planned', 'done'], dueFrom: from, dueTo: to, limit: 500 });
    return tasks.filter(t => t.dueAt != null && isVisible(t.calendarId));
  }

  /**
   * gather per-day loads from every registered provider for the given
   * window, keyed by LOCAL day start. Provider failures are isolated: a
   * throwing provider contributes nothing and cannot break the calendar.
   */
  private async _collectDayLoads(fromMs: number, toMs: number): Promise<Map<number, { count: number; label: string }[]>> {
    const byDay = new Map<number, { count: number; label: string }[]>();
    const providers = this._pane._api.dayLoads?.get() ?? [];
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
    const from = startOfMonth(this._pane._cursorDate).getTime();
    const to = endOfMonth(this._pane._cursorDate).getTime();
    const { isVisible, colorOf } = await this.loadCalCtx();
    const events = (await this._pane._data.listEvents({ from, to, limit: 500 })).filter(ev => isVisible(ev.calendarId));
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
    const firstOfMonth = startOfMonth(this._pane._cursorDate);
    const gridStart = startOfWeek(firstOfMonth);
    const lastOfMonth = endOfMonth(this._pane._cursorDate);
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
      if (appDateParts(day).month !== appDateParts(this._pane._cursorDate).month) cell.classList.add('planner-month__cell--other-month');
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
        this._pane.eventBars.installMonthChipDrag(chip, ev, dayStart);
        evWrap.appendChild(chip);
        shown++;
      }
      for (const t of dayTasks) {
        if (shown >= MAX_SHOWN) break;
        evWrap.appendChild(this._pane.eventBars.renderCalTaskChip(t, colorOf(t.calendarId, t.color)));
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
        this._pane._cursorDate = startOfDay(day);
        this._pane._calendarView = 'day';
        void this._pane._renderTab();
      });
      cells.appendChild(cell);
    }
    grid.appendChild(cells);
    body.appendChild(grid);
  }

  private async _renderWeekView(body: HTMLElement): Promise<void> {
    const { start, days } = this._weekSpan();
    this._pane._spanDays = days;
    const end = addDays(start, days);
    const { isVisible, colorOf } = await this.loadCalCtx();
    const allEvents = (await this._pane._data.listEvents({ from: start.getTime(), to: end.getTime(), limit: 500 })).filter(ev => isVisible(ev.calendarId));
    const allDayEvents = allEvents.filter(ev => this._pane.allDay.isAllDayLike(ev));
    const events = allEvents.filter(ev => !this._pane.allDay.isAllDayLike(ev));
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
    this._pane.allDay.renderWeekAllDayBand(grid, start, allDayEvents, colorOf);

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
      this._pane.eventBars.layoutTimedItems(dayCol, 'week', dayStart, dayEnd, events, tasks, colorOf);

      body2.appendChild(dayCol);
    }
    grid.appendChild(body2);
    body.appendChild(grid);
  }

  private async _renderDayView(body: HTMLElement): Promise<void> {
    const dayStart = startOfDay(this._pane._cursorDate).getTime();
    const dayEnd = endOfDay(this._pane._cursorDate).getTime();
    const { isVisible, colorOf } = await this.loadCalCtx();
    const allEvents = (await this._pane._data.listEvents({ from: dayStart, to: dayEnd, limit: 500 })).filter(ev => isVisible(ev.calendarId));
    const allDayEvents = allEvents.filter(ev => this._pane.allDay.isAllDayLike(ev));
    const events = allEvents.filter(ev => !this._pane.allDay.isAllDayLike(ev));
    const tasks = await this._tasksInWindow(dayStart, dayEnd, isVisible);

    // All-day strip above the time grid, mirroring the week view.
    this._pane.allDay.renderDayAllDaySection(body, this._pane._cursorDate, allDayEvents, colorOf);

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
    this._installDragCreate(col, this._pane._cursorDate);

    // Current-time indicator (only if cursor is on today).
    if (sameDay(this._pane._cursorDate, new Date())) {
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
    this._pane.eventBars.layoutTimedItems(col, 'day', dayStart, dayEnd, events, tasks, colorOf);

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

        this._pane.eventPopover.openEventPopover({
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
}
