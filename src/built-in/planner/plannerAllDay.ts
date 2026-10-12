// plannerAllDay.ts — all-day events on the Planner's calendar: the band
// across the top of the week (bars spanning their days, drag across days to
// create one, drag a bar to move it or its ends to resize it) and the
// all-day list at the top of the day view.

import { escapeHtml } from '../../ui/format.js';
import type { PlannerEvent } from './plannerTypes.js';
import { startOfDay, endOfDay, addDays, sameDay } from './plannerDates.js';
import { el } from './plannerUi.js';
import type { PlannerEditorPane } from './plannerEditorProvider.js';

export class PlannerAllDay {
  constructor(private readonly _pane: PlannerEditorPane) {}

  /**
   * An event belongs in the all-day band when it's flagged all-day or when
   * it spans more than one calendar day (a multi-day event). Keeping these
   * out of the timed grid is what stops a several-day event from crowding
   * every hour of every column.
   */
  isAllDayLike(ev: PlannerEvent): boolean {
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
  renderWeekAllDayBand(
    host: HTMLElement,
    weekStart: Date,
    allDayEvents: readonly PlannerEvent[],
    colorOf: (calendarId: string | null, override: string | null) => string,
  ): void {
    const ROW_H = 22;
    const weekStartMs = weekStart.getTime();
    const days = this._pane._spanDays;
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

      const days = this._pane._spanDays;
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
        this._pane.eventPopover.openEventPopover({ mode: 'create', startAt: startMs, endAt: endMs, allDay: true, pendingGhost: ghost }, anchor);
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

      const days = this._pane._spanDays;
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
          this._pane.eventPopover.openEventPopover({ mode: 'edit', event: ev }, bar.getBoundingClientRect());
          return;
        }
        if (curStart !== ev.startAt || curEnd !== ev.endAt) {
          void this._pane.eventBars.commitEventMove(ev, { startAt: curStart, endAt: curEnd, allDay: true }, bar.getBoundingClientRect());
        }
      };
      try { bar.setPointerCapture(e.pointerId); } catch { /* ok */ }
      bar.addEventListener('pointermove', onMove);
      bar.addEventListener('pointerup', onUp);
      bar.addEventListener('pointercancel', onUp);
    });
  }

  /** Compact all-day strip for the single-day view. */
  renderDayAllDaySection(
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
      chip.addEventListener('click', () => this._pane.eventPopover.openEventPopover({ mode: 'edit', event: ev }, chip.getBoundingClientRect()));
      list.appendChild(chip);
    }
    // Click the empty strip to add an all-day event for this day.
    list.addEventListener('click', (e) => {
      if (e.target !== list) return;
      this._pane.eventPopover.openEventPopover({ mode: 'create', startAt: dayStart, endAt: dayEnd, allDay: true }, list.getBoundingClientRect());
    });
    host.appendChild(band);
  }

  // ── Description links (notes + clickable links) ─────────────────────
}
