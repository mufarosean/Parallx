// boardView.ts — the board (Kanban) view: a column per option of the group
// property; with a sub-group, a lane per value of that one. Dragging a card
// (mouse or finger), or Ctrl+Shift+Left/Right on it, writes the group
// property; the drop swaps one tag for another on a multi-select.

import type { DisposableStore } from '../../../platform/lifecycle.js';
import { createBlock, createEmptyState } from '../../../ui/kit.js';
import { addDisposableListener } from '../../../ui/dom.js';
import type { IDatabaseProperty, IDatabaseRow } from './databaseTypes.js';
import { boardDropValue, groupRows, type IRowGroup } from './databaseViewModel.js';
import { readViewConfig } from './viewConfig.js';
import { optionColor, pill } from './cellRender.js';
import { ROW_DRAG_TYPE, noValueLabel, renderAddHere, renderCard, type IViewDeps, type IViewState } from './viewShared.js';

const GROUP_DRAG_TYPE = 'text/parallx-db-group';

/** The property a board groups by: the view's, else the first status or select. */
export function boardGroupProperty(state: IViewState): IDatabaseProperty | null {
  return state.props.find((p) => p.id === state.view.groupBy)
    ?? state.props.find((p) => p.type === 'status' || p.type === 'select')
    ?? null;
}

function optionOrder(prop: IDatabaseProperty): string[] {
  return ((prop.config as { options?: { value: string }[] }).options ?? []).map((o) => o.value);
}

export function renderBoardView(body: HTMLElement, state: IViewState, deps: IViewDeps, store: DisposableStore): void {
  const groupProp = boardGroupProperty(state);
  if (!groupProp) {
    createEmptyState(body, { icon: 'kanban', headline: 'Nothing to group by yet', hint: 'A board needs a select, status or multi-select property. Add one from the table view, or pick one under Group By in the view settings.' });
    return;
  }
  const cfg = readViewConfig(state.view.config);
  const subProp = state.props.find((p) => p.id === cfg.subGroupBy && p.id !== groupProp.id && (p.type === 'select' || p.type === 'status' || p.type === 'tags' || p.type === 'checkbox')) ?? null;
  const root = createBlock(body, 'div', { className: 'canvas-db-boardroot' });
  if (!subProp) {
    renderLane(root, state.rows, groupProp, null, state, deps, store);
    return;
  }
  // Lanes: one per value of the sub-group property, in its option order; the no-value lane last.
  const lanes = subProp.type === 'checkbox'
    ? [{ key: 'true', rows: state.rows.filter((r) => r.values[subProp.id] === true) }, { key: '', rows: state.rows.filter((r) => r.values[subProp.id] !== true) }]
    : groupRows(state.rows, subProp.id, optionOrder(subProp));
  for (const lane of lanes) {
    if (state.view.hideEmptyGroups && lane.rows.length === 0) continue;
    const laneEl = createBlock(root, 'section', { className: 'canvas-db-lane' });
    const head = createBlock(laneEl, 'div', { className: 'canvas-db-lane__head' });
    if (subProp.type === 'checkbox') createBlock(head, 'span', { className: 'canvas-db-lane__title', text: lane.key ? `${subProp.name}: checked` : `${subProp.name}: unchecked` });
    else if (lane.key) pill(head, lane.key, optionColor(subProp, lane.key));
    else createBlock(head, 'span', { className: 'canvas-db-lane__title', text: noValueLabel(subProp) });
    createBlock(head, 'span', { className: 'canvas-db-board__count', text: String(lane.rows.length) });
    const seed = subProp.type === 'checkbox' ? { [subProp.id]: lane.key === 'true' } : (lane.key ? { [subProp.id]: subProp.type === 'tags' ? [lane.key] : lane.key } : {});
    renderLane(laneEl, lane.rows, groupProp, seed, state, deps, store);
  }
}

function renderLane(parent: HTMLElement, rows: readonly IDatabaseRow[], groupProp: IDatabaseProperty, laneSeed: Record<string, unknown> | null, state: IViewState, deps: IViewDeps, store: DisposableStore): void {
  const groups = groupRows(rows, groupProp.id, optionOrder(groupProp)).filter((g) => !(state.view.hideEmptyGroups && g.rows.length === 0));
  const board = createBlock(parent, 'div', { className: 'canvas-db-board' });
  const multi = groupProp.type === 'tags';
  const moveTo = (row: IDatabaseRow, from: IRowGroup, to: IRowGroup | undefined): void => {
    if (!to) return;
    void deps.setCell(row.pageId, groupProp.id, boardDropValue(row.values[groupProp.id], from.key, to.key, multi));
  };
  for (const group of groups) {
    const colEl = createBlock(board, 'div', { className: 'canvas-db-board__col' });
    colEl.dataset.group = group.key;
    const head = createBlock(colEl, 'div', { className: 'canvas-db-board__head' });
    if (group.key) pill(head, group.key, optionColor(groupProp, group.key));
    else createBlock(head, 'span', { className: 'canvas-db-pill canvas-db-pill--default', text: noValueLabel(groupProp) });
    createBlock(head, 'span', { className: 'canvas-db-board__count', text: String(group.rows.length) });
    if (!state.locked || true) renderAddHere(head, `New row in ${group.key || noValueLabel(groupProp)}`, () => void deps.addRow({ ...(laneSeed ?? {}), ...(group.key ? { [groupProp.id]: multi ? [group.key] : group.key } : {}) }));
    const list = createBlock(colEl, 'div', { className: 'canvas-db-board__cards' });
    for (const row of group.rows) {
      renderCard(list, row, state, deps, store, {
        omit: [groupProp.id],
        draggable: true,
        dragData: { [GROUP_DRAG_TYPE]: group.key },
        move: (step) => moveTo(row, group, groups[groups.indexOf(group) + step]),
      });
    }
    // Drop target: a card dropped here takes this column's value.
    store.add(addDisposableListener(colEl, 'dragover', (e) => { if (e.dataTransfer?.types.includes(ROW_DRAG_TYPE)) { e.preventDefault(); colEl.classList.add('canvas-db-board__col--over'); } }));
    store.add(addDisposableListener(colEl, 'dragleave', () => colEl.classList.remove('canvas-db-board__col--over')));
    store.add(addDisposableListener(colEl, 'drop', (e) => {
      e.preventDefault();
      colEl.classList.remove('canvas-db-board__col--over');
      const pageId = e.dataTransfer?.getData(ROW_DRAG_TYPE);
      if (!pageId) return;
      const fromKey = e.dataTransfer?.getData(GROUP_DRAG_TYPE) ?? '';
      const current = state.rows.find((r) => r.pageId === pageId)?.values[groupProp.id];
      void deps.setCell(pageId, groupProp.id, boardDropValue(current, fromKey, group.key, multi));
    }));
  }
}
