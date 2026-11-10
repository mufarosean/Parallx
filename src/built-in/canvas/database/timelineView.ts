// timelineView.ts — the timeline (Gantt) view: rows down the left, days
// across the top, a bar from each row's start date to its end date. Drag a
// bar to move it (mouse or finger), drag its right edge to change the end;
// Arrows on a focused bar move it a day, Shift+Arrows change its end.

import type { DisposableStore } from '../../../platform/lifecycle.js';
import { createBlock, createButton, createIconButton } from '../../../ui/kit.js';
import { addDisposableListener } from '../../../ui/dom.js';
import { onDragPress } from '../../../ui/touchDrag.js';
import type { IDatabaseProperty, IDatabaseRow } from './databaseTypes.js';
import { readViewConfig } from './viewConfig.js';
import { addDays, addMonths, dayOfValue, daysBetween, daysInMonth, firstOfMonth, monthOf, monthTitle, shortDay, todayKey, weekdayOf, type DayKey } from './calendarDates.js';
import { calendarProperty, dateProperties } from './calendarView.js';
import { renderAddHere, type IViewDeps, type IViewState } from './viewShared.js';
import { isComputedType } from '../properties/propertyTypes.js';

const DAY_PX = 34;
const shownMonth = new Map<string, string>();

export function renderTimelineView(body: HTMLElement, state: IViewState, deps: IViewDeps, store: DisposableStore): void {
  const startProp = calendarProperty(state);
  const cfg = readViewConfig(state.view.config);
  const endProp = dateProperties(state.props).find((p) => p.id === cfg.endDateProperty && p.id !== startProp?.id) ?? null;
  const month = shownMonth.get(state.view.id) ?? monthOf(todayKey());
  const root = createBlock(body, 'div', { className: 'canvas-db-timeline' });

  const bar = createBlock(root, 'div', { className: 'canvas-db-calbar' });
  createBlock(bar, 'span', { className: 'canvas-db-calbar__title', text: monthTitle(month), attrs: { 'aria-live': 'polite' } });
  if (startProp) createBlock(bar, 'span', { className: 'canvas-db-calbar__by', text: endProp ? `${startProp.name} to ${endProp.name}` : `by ${startProp.name}` });
  const nav = createBlock(bar, 'div', { className: 'canvas-db-calbar__nav' });
  const go = (m: string): void => { shownMonth.set(state.view.id, m); body.textContent = ''; renderTimelineView(body, state, deps, store); };
  createIconButton(nav, { id: 'database.timeline.prev', icon: 'chevron-left', title: 'Previous Month', size: 'sm', onClick: () => go(addMonths(month, -1)) });
  createButton(nav, { id: 'database.timeline.today', label: 'Today', kind: 'ghost', size: 'sm', icon: 'calendar', onClick: () => go(monthOf(todayKey())) });
  createIconButton(nav, { id: 'database.timeline.next', icon: 'chevron-right', title: 'Next Month', size: 'sm', onClick: () => go(addMonths(month, 1)) });

  if (!startProp) {
    createBlock(root, 'div', { className: 'canvas-db-board-empty', text: 'A timeline needs a date property for its start, and another for its end. Add them from the table view, or pick them under Timeline By in the view settings.' });
    return;
  }
  const editable = !isComputedType(startProp.type) && !state.locked;
  // The window: the month shown with a week either side.
  const first = addDays(firstOfMonth(month), -7);
  const total = daysInMonth(month) + 14;
  const today = todayKey();

  const frame = createBlock(root, 'div', { className: 'canvas-db-tl' });
  const names = createBlock(frame, 'div', { className: 'canvas-db-tl__names' });
  createBlock(names, 'div', { className: 'canvas-db-tl__corner', text: 'Name' });
  const scroll = createBlock(frame, 'div', { className: 'canvas-db-tl__scroll' });
  const grid = createBlock(scroll, 'div', { className: 'canvas-db-tl__grid' });
  grid.style.width = `${total * DAY_PX}px`;
  // Day headers.
  const head = createBlock(grid, 'div', { className: 'canvas-db-tl__head' });
  for (let i = 0; i < total; i++) {
    const key = addDays(first, i);
    const wd = weekdayOf(key);
    const cell = createBlock(head, 'div', { className: `canvas-db-tl__day${key === today ? ' canvas-db-tl__day--today' : ''}${wd === 0 || wd === 6 ? ' canvas-db-tl__day--weekend' : ''}${key.endsWith('-01') ? ' canvas-db-tl__day--first' : ''}`, text: key.slice(8, 10).replace(/^0/, '') });
    cell.title = shortDay(key);
    if (key.endsWith('-01') || i === 0) createBlock(cell, 'span', { className: 'canvas-db-tl__month', text: monthTitle(monthOf(key)).split(' ')[0] });
  }
  const todayAt = daysBetween(first, today);
  if (todayAt >= 0 && todayAt < total) { const line = createBlock(grid, 'div', { className: 'canvas-db-tl__todayline' }); line.style.left = `${todayAt * DAY_PX + DAY_PX / 2}px`; }

  const undated: IDatabaseRow[] = [];
  for (const row of state.rows) {
    const start = dayOfValue(row.values[startProp.id]);
    if (!start) { undated.push(row); continue; }
    const endRaw = endProp ? dayOfValue(row.values[endProp.id]) : null;
    const end = endRaw && daysBetween(start, endRaw) >= 0 ? endRaw : start;
    const nameEl = createBlock(names, 'div', { className: 'canvas-db-tl__name' });
    const open = createButton(nameEl, { id: null, label: row.title || 'Untitled', kind: 'ghost', size: 'sm', icon: row.icon ? undefined : 'file', title: row.title || 'Untitled', onClick: () => deps.openRow(row.pageId) });
    const icon = deps.rowIcon(row.icon); if (icon) open.insertBefore(icon, open.firstChild);
    const lane = createBlock(grid, 'div', { className: 'canvas-db-tl__lane' });
    const offset = daysBetween(first, start);
    const span = daysBetween(start, end) + 1;
    const barEl = createBlock(lane, 'div', { className: 'canvas-db-tl__bar', attrs: { role: 'button', tabindex: '0', 'aria-label': `${row.title || 'Untitled'}, ${shortDay(start)}${end !== start ? ` to ${shortDay(end)}` : ''}` } });
    barEl.style.left = `${offset * DAY_PX}px`;
    barEl.style.width = `${span * DAY_PX - 4}px`;
    createBlock(barEl, 'span', { className: 'canvas-db-tl__barlabel', text: row.title || 'Untitled' });
    store.add(addDisposableListener(barEl, 'click', () => deps.openRow(row.pageId)));
    store.add(addDisposableListener(barEl, 'contextmenu', (e) => { e.preventDefault(); deps.openRowMenu(e, row); }));
    store.add(addDisposableListener(barEl, 'keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); deps.openRow(row.pageId); return; }
      if (!editable || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
      e.preventDefault();
      const d = e.key === 'ArrowLeft' ? -1 : 1;
      if (e.shiftKey && endProp) { const next = addDays(end, d); if (daysBetween(start, next) >= 0) void deps.setCell(row.pageId, endProp.id, keepTime(row.values[endProp.id], next, endProp)); }
      else void moveBar(row, start, end, d, startProp, endProp, deps);
    }));
    if (editable) {
      // Drag the bar: whole days, keeping its length.
      store.add(onDragPress(barEl, (e) => {
        if ((e.target as HTMLElement).classList.contains('canvas-db-tl__grip')) return;
        e.preventDefault();
        const x0 = e.clientX; let delta = 0;
        const onMove = (ev: MouseEvent): void => { delta = Math.round((ev.clientX - x0) / DAY_PX); barEl.style.left = `${(offset + delta) * DAY_PX}px`; };
        const onUp = (): void => {
          document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp);
          if (delta !== 0) void moveBar(row, start, end, delta, startProp, endProp, deps); else barEl.style.left = `${offset * DAY_PX}px`;
        };
        document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
      }));
      if (endProp && !isComputedType(endProp.type)) {
        const grip = createBlock(barEl, 'div', { className: 'canvas-db-tl__grip', attrs: { role: 'presentation' } });
        store.add(onDragPress(grip, (e) => {
          e.preventDefault(); e.stopPropagation();
          const x0 = e.clientX; let delta = 0;
          const onMove = (ev: MouseEvent): void => { delta = Math.round((ev.clientX - x0) / DAY_PX); barEl.style.width = `${Math.max(1, span + delta) * DAY_PX - 4}px`; };
          const onUp = (): void => {
            document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp);
            const next = addDays(end, Math.max(delta, -(span - 1)));
            if (next !== end) void deps.setCell(row.pageId, endProp.id, keepTime(row.values[endProp.id], next, endProp));
          };
          document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
        }));
        store.add(addDisposableListener(grip, 'click', (e) => e.stopPropagation()));
      }
    }
  }
  if (state.rows.length === 0) createBlock(names, 'div', { className: 'canvas-db-tl__name canvas-db-tl__name--empty', text: 'No rows yet' });
  if (undated.length > 0) {
    const tray = createBlock(root, 'div', { className: 'canvas-db-caltray' });
    createBlock(tray, 'span', { className: 'canvas-db-caltray__label', text: `No ${startProp.name}` });
    for (const row of undated) {
      const chip = createButton(tray, { id: null, label: row.title || 'Untitled', kind: 'ghost', size: 'sm', icon: 'file', onClick: () => deps.openRow(row.pageId) });
      chip.classList.add('canvas-db-calchip');
      if (editable) renderAddHere(tray, `Put ${row.title || 'Untitled'} on today`, () => void deps.setCell(row.pageId, startProp.id, keepTime(null, today, startProp)));
    }
  }
  // Start scrolled to the month's first day.
  scroll.scrollLeft = 7 * DAY_PX - 8;
}

function keepTime(current: unknown, day: DayKey, prop: IDatabaseProperty): string {
  if (prop.type === 'datetime') { const t = typeof current === 'string' && current.length > 10 ? current.slice(10) : 'T09:00'; return `${day}${t}`; }
  return day;
}

async function moveBar(row: IDatabaseRow, start: DayKey, end: DayKey, delta: number, startProp: IDatabaseProperty, endProp: IDatabaseProperty | null, deps: IViewDeps): Promise<void> {
  await deps.setCell(row.pageId, startProp.id, keepTime(row.values[startProp.id], addDays(start, delta), startProp));
  if (endProp && !isComputedType(endProp.type) && dayOfValue(row.values[endProp.id])) await deps.setCell(row.pageId, endProp.id, keepTime(row.values[endProp.id], addDays(end, delta), endProp));
}
