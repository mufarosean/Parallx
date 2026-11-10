// calendarView.ts — the calendar view: a month, rows as chips on the day
// their date property says. Drag a chip to another day (mouse or finger), or
// Ctrl+Shift+Arrows on it, to change the date; + in a day makes a row there.

import type { DisposableStore } from '../../../platform/lifecycle.js';
import { createBlock, createButton, createIconButton } from '../../../ui/kit.js';
import { addDisposableListener } from '../../../ui/dom.js';
import type { IDatabaseProperty, IDatabaseRow } from './databaseTypes.js';
import { readViewConfig } from './viewConfig.js';
import { addDays, addMonths, dayOfValue, monthGrid, monthOf, monthTitle, todayKey, weekdayLabels, type DayKey } from './calendarDates.js';
import { ROW_DRAG_TYPE, renderAddHere, type IViewDeps, type IViewState } from './viewShared.js';
import { renderCellValue } from './cellRender.js';
import { isComputedType } from '../properties/propertyTypes.js';

/** The month each calendar view shows, for the session (not a saved setting). */
const shownMonth = new Map<string, string>();

export function dateProperties(props: readonly IDatabaseProperty[]): IDatabaseProperty[] {
  return props.filter((p) => p.type === 'date' || p.type === 'datetime' || p.type === 'created_time' || p.type === 'last_edited_time');
}

/** The property a calendar or timeline places rows by: the view's, else the first date one. */
export function calendarProperty(state: IViewState): IDatabaseProperty | null {
  const cfg = readViewConfig(state.view.config);
  return dateProperties(state.props).find((p) => p.id === cfg.dateProperty) ?? dateProperties(state.props)[0] ?? null;
}

export function renderCalendarView(body: HTMLElement, state: IViewState, deps: IViewDeps, store: DisposableStore): void {
  const dateProp = calendarProperty(state);
  const cfg = readViewConfig(state.view.config);
  const weekStart = (state.view.config['weekStart'] === 1 ? 1 : 0) as 0 | 1;
  const month = shownMonth.get(state.view.id) ?? monthOf(todayKey());
  const root = createBlock(body, 'div', { className: 'canvas-db-calendar' });

  // Toolbar: month, Today, previous and next.
  const bar = createBlock(root, 'div', { className: 'canvas-db-calbar' });
  createBlock(bar, 'span', { className: 'canvas-db-calbar__title', text: monthTitle(month), attrs: { 'aria-live': 'polite' } });
  if (dateProp) createBlock(bar, 'span', { className: 'canvas-db-calbar__by', text: `by ${dateProp.name}` });
  const nav = createBlock(bar, 'div', { className: 'canvas-db-calbar__nav' });
  const go = (m: string): void => { shownMonth.set(state.view.id, m); body.textContent = ''; renderCalendarView(body, state, deps, store); };
  createIconButton(nav, { id: 'database.calendar.prev', icon: 'chevron-left', title: 'Previous Month', size: 'sm', onClick: () => go(addMonths(month, -1)) });
  createButton(nav, { id: 'database.calendar.today', label: 'Today', kind: 'ghost', size: 'sm', icon: 'calendar', onClick: () => go(monthOf(todayKey())) });
  createIconButton(nav, { id: 'database.calendar.next', icon: 'chevron-right', title: 'Next Month', size: 'sm', onClick: () => go(addMonths(month, 1)) });

  if (!dateProp) {
    createBlock(root, 'div', { className: 'canvas-db-board-empty', text: 'A calendar needs a date property. Add one from the table view, or pick one under Calendar By in the view settings.' });
    return;
  }
  const editable = !isComputedType(dateProp.type);
  const byDay = new Map<DayKey, IDatabaseRow[]>();
  const undated: IDatabaseRow[] = [];
  for (const r of state.rows) {
    const day = dayOfValue(r.values[dateProp.id]);
    if (!day) { undated.push(r); continue; }
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push(r);
  }
  const today = todayKey();
  const grid = createBlock(root, 'div', { className: 'canvas-db-calgrid', attrs: { role: 'grid', 'aria-label': monthTitle(month) } });
  const headRow = createBlock(grid, 'div', { className: 'canvas-db-calgrid__head', attrs: { role: 'row' } });
  for (const w of weekdayLabels(weekStart)) createBlock(headRow, 'div', { className: 'canvas-db-calgrid__weekday', text: w, attrs: { role: 'columnheader' } });
  for (const week of monthGrid(month, weekStart)) {
    const rowEl = createBlock(grid, 'div', { className: 'canvas-db-calgrid__row', attrs: { role: 'row' } });
    for (const cell of week) {
      const dayEl = createBlock(rowEl, 'div', { className: `canvas-db-calday${cell.inMonth ? '' : ' canvas-db-calday--out'}${cell.key === today ? ' canvas-db-calday--today' : ''}`, attrs: { role: 'gridcell', 'data-day': cell.key } });
      const top = createBlock(dayEl, 'div', { className: 'canvas-db-calday__top' });
      createBlock(top, 'span', { className: 'canvas-db-calday__num', text: String(Number(cell.key.slice(8, 10))) });
      if (editable && !state.locked) renderAddHere(top, `New row on ${cell.key}`, () => void deps.addRow({ [dateProp.id]: dateProp.type === 'datetime' ? `${cell.key}T09:00` : cell.key })).classList.add('canvas-db-calday__add');
      const chips = createBlock(dayEl, 'div', { className: 'canvas-db-calday__chips' });
      for (const r of byDay.get(cell.key) ?? []) renderChip(chips, r, dateProp, cell.key, state, deps, store, editable);
      if (editable) {
        store.add(addDisposableListener(dayEl, 'dragover', (e) => { if (e.dataTransfer?.types.includes(ROW_DRAG_TYPE)) { e.preventDefault(); dayEl.classList.add('canvas-db-calday--over'); } }));
        store.add(addDisposableListener(dayEl, 'dragleave', () => dayEl.classList.remove('canvas-db-calday--over')));
        store.add(addDisposableListener(dayEl, 'drop', (e) => {
          e.preventDefault(); dayEl.classList.remove('canvas-db-calday--over');
          const pageId = e.dataTransfer?.getData(ROW_DRAG_TYPE);
          const row = state.rows.find((r) => r.pageId === pageId);
          if (row) void deps.setCell(row.pageId, dateProp.id, moved(row.values[dateProp.id], cell.key, dateProp));
        }));
      }
    }
  }
  if (undated.length > 0) {
    const tray = createBlock(root, 'div', { className: 'canvas-db-caltray' });
    createBlock(tray, 'span', { className: 'canvas-db-caltray__label', text: `No ${dateProp.name}` });
    for (const r of undated) renderChip(tray, r, dateProp, null, state, deps, store, editable);
  }
  void cfg;
}

/** The stored value for a row moved to `day`: a datetime keeps its time. */
function moved(current: unknown, day: DayKey, prop: IDatabaseProperty): string {
  if (prop.type === 'datetime') { const t = typeof current === 'string' && current.length > 10 ? current.slice(10) : 'T09:00'; return `${day}${t}`; }
  return day;
}

function renderChip(parent: HTMLElement, row: IDatabaseRow, dateProp: IDatabaseProperty, day: DayKey | null, state: IViewState, deps: IViewDeps, store: DisposableStore, editable: boolean): void {
  const chip = createButton(parent, { id: null, label: row.title || 'Untitled', kind: 'ghost', size: 'sm', icon: row.icon ? undefined : 'file', title: row.title || 'Untitled', onClick: () => deps.openRow(row.pageId) });
  chip.classList.add('canvas-db-calchip');
  const icon = deps.rowIcon(row.icon);
  if (icon) { icon.classList.add('canvas-db-calchip__icon'); chip.insertBefore(icon, chip.firstChild); }
  // One visible property after the title, when the chip has room (a status pill, say).
  const extra = state.props.find((p) => p.id !== dateProp.id && (p.type === 'select' || p.type === 'status') && row.values[p.id]);
  if (extra) { const v = createBlock(chip, 'span', { className: 'canvas-db-calchip__extra' }); renderCellValue(v, extra, row.values[extra.id]); }
  store.add(addDisposableListener(chip, 'contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); deps.openRowMenu(e, row); }));
  if (!editable) return;
  chip.draggable = true;
  store.add(addDisposableListener(chip, 'dragstart', (e) => { e.dataTransfer?.setData(ROW_DRAG_TYPE, row.pageId); chip.classList.add('canvas-db-card--dragging'); }));
  store.add(addDisposableListener(chip, 'dragend', () => chip.classList.remove('canvas-db-card--dragging')));
  // Ctrl+Shift+Arrows move a day or a week.
  store.add(addDisposableListener(chip, 'keydown', (e) => {
    if (!(e.ctrlKey && e.shiftKey) || !/^Arrow(Left|Right|Up|Down)$/.test(e.key)) return;
    e.preventDefault();
    const from = day ?? todayKey();
    const n = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' ? -7 : 7;
    void deps.setCell(row.pageId, dateProp.id, moved(row.values[dateProp.id], addDays(from, n), dateProp));
  }));
}
