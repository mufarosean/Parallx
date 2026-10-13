// plannerEventBars.ts — events and tasks drawn on the Planner's calendar:
// timed events as bars in the week and day grids (laid out in lanes when
// they overlap), tasks as chips and pills, and dragging them: a bar moves
// or resizes in 15-minute steps, a month chip moves to another day. A move
// is saved through the series question when the event repeats.

import { escapeHtml } from '../../ui/format.js';
import type { PlannerEvent, PlannerTask, UpdateEventInput } from './plannerTypes.js';
import { packLanes } from './plannerLayout.js';
import { startOfDay, formatTimeShort, formatTimeRange } from './plannerDates.js';
import { TASK_DOT_SVG, TASK_DONE_SVG, el } from './plannerUi.js';
import type { PlannerEditorPane } from './plannerEditorProvider.js';

const DAY = 24 * 3_600_000;

export class PlannerEventBars {
  constructor(private readonly _pane: PlannerEditorPane) {}

  /** Month-cell chip for a task — colour-coded, check glyph, opens the task popover. */
  renderCalTaskChip(task: PlannerTask, color: string): HTMLElement {
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
    chip.addEventListener('click', (e) => { e.stopPropagation(); this._pane.taskPopover.openTaskPopover({ mode: 'edit', task }, chip.getBoundingClientRect()); });
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
    pill.addEventListener('click', (e) => { e.stopPropagation(); this._pane.taskPopover.openTaskPopover({ mode: 'edit', task }, pill.getBoundingClientRect()); });
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

  async commitEventMove(ev: PlannerEvent, patch: UpdateEventInput, anchor: DOMRect): Promise<void> {
    this._pane._note('moved', `event "${ev.title}"`, undefined, undefined);
    if (ev.seriesId) {
      const scope = await this._pane.eventPopover.askSeriesScope('edit', anchor);
      if (!scope) { void this._pane._renderTab(); return; }
      await this._pane._data.applySeriesEdit(ev.id, patch, scope);
    } else {
      await this._pane._data.updateEvent(ev.id, patch);
    }
  }

  /**
   * Month-view drag: drop an event chip on another day cell to move it by whole
   * days (time-of-day preserved). A sub-threshold press opens the editor instead.
   */
  installMonthChipDrag(chip: HTMLElement, ev: PlannerEvent, sourceDayStart: number): void {
    const THRESHOLD_PX = 4;
    chip.classList.add('planner-month__chip--draggable');
    // Swallow the click so a chip press never drills the cell into day view.
    chip.addEventListener('click', (e) => e.stopPropagation());
    // The keyboard: Enter edits it; Alt+Left/Right move it a day, Alt+Up/Down a week (the drop's move).
    this.installEventKeys(chip, ev, { ArrowLeft: -DAY, ArrowRight: DAY, ArrowUp: -7 * DAY, ArrowDown: 7 * DAY }, false);

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
          this._pane.eventPopover.openEventPopover({ mode: 'edit', event: ev }, chip.getBoundingClientRect());
          return;
        }
        const dayDelta = targetDayStart - sourceDayStart;
        if (dayDelta !== 0) {
          void this.commitEventMove(ev, { startAt: ev.startAt + dayDelta, endAt: ev.endAt + dayDelta }, chip.getBoundingClientRect());
        }
      };

      try { chip.setPointerCapture(e.pointerId); } catch { /* ok */ }
      chip.addEventListener('pointermove', onMove);
      chip.addEventListener('pointerup', onUp);
      chip.addEventListener('pointercancel', onUp);
    });
  }

  /**
   * An event's bar or chip from the keyboard: Enter or Space opens its editor
   * (the press a click makes), Alt+arrows move it by `steps`, and with
   * `resize`, Alt+Shift+arrows move only its end. Committed as a drag's
   * drop is (with `extra`, an all-day bar's allDay); focus comes back to the
   * event's bar when the view redraws.
   */
  installEventKeys(el: HTMLElement, ev: PlannerEvent, steps: Record<string, number>, resize: boolean, extra: Partial<UpdateEventInput> = {}): void {
    el.dataset.eventId = ev.id;
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault(); e.stopPropagation();
        this._pane.eventPopover.openEventPopover({ mode: 'edit', event: ev }, el.getBoundingClientRect());
        return;
      }
      const step = e.altKey && !e.ctrlKey && !e.metaKey ? steps[e.key] : undefined;
      if (step === undefined) return;
      e.preventDefault(); e.stopPropagation();
      const endOnly = resize && e.shiftKey;
      const startAt = endOnly ? ev.startAt : ev.startAt + step;
      const endAt = Math.max(startAt + 15 * 60_000, ev.endAt + step);
      void this.commitEventMove(ev, { ...extra, startAt, endAt }, el.getBoundingClientRect()).then(() => {
        setTimeout(() => (document.querySelector(`[data-event-id="${ev.id}"]`) as HTMLElement | null)?.focus(), 80);
      });
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
    // The keyboard: Enter edits it; Alt+Up/Down move it 15 minutes (Alt+Shift: its end), Alt+Left/Right a day.
    this.installEventKeys(bar, ev, { ArrowUp: -SNAP_MS, ArrowDown: SNAP_MS, ArrowLeft: -DAY_MS, ArrowRight: DAY_MS }, true);

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
          this._pane.eventPopover.openEventPopover({ mode: 'edit', event: ev }, bar.getBoundingClientRect());
          return;
        }
        if (curStart !== ev.startAt || curEnd !== ev.endAt) {
          void this.commitEventMove(ev, { startAt: curStart, endAt: curEnd }, bar.getBoundingClientRect());
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
  layoutTimedItems(
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
}
