// tableView.ts — the table view of a database (docs/DATABASES.md step 1).
//
// A grid: the pinned Name column, a typed column per visible property in the
// view's order, and a + column. Columns resize by pointer (the grip at a
// header's edge) and by keyboard (View: Make Focused Area Wider / Narrower on
// the header), reorder by dragging a header or from its menu, wrap or clip
// per column, and freeze up to a column. Under the rows: + New, then the
// calculations row. Arrow keys move between cells; Enter edits one.
//
// Built with the kit and `createBlock`; no DOM by hand.

import type { DisposableStore } from '../../../platform/lifecycle.js';
import { createBlock, createButton, createIconButton, createInput, declareControl, sceneSlug } from '../../../ui/kit.js';
import { addDisposableListener } from '../../../ui/dom.js';
import { onDragPress } from '../../../ui/touchDrag.js';
import { registerKeyboardResize } from '../../../ui/keyboardResize.js';
import { createTypeIconElement } from '../properties/propertyEditors.js';
import type { PropertyType } from '../properties/propertyTypes.js';
import { isComputedType } from '../properties/propertyTypes.js';
import type { IDatabaseProperty, IDatabaseRow, IDatabaseView } from './databaseTypes.js';
import { TITLE_KEY } from './databaseTypes.js';
import { MIN_COLUMN_WIDTH, columnWidth, frozenKeys, patchRecord, placeInOrder, readViewConfig, visibleProperties, type IViewConfig } from './viewConfig.js';
import { calcLabel, calculate } from './calculations.js';
import { renderCellValue } from './cellRender.js';
import { isChecked } from './cellValues.js';

export interface ITableViewDeps {
  setCell(pageId: string, propertyId: string, value: unknown): Promise<void>;
  renameRow(pageId: string, title: string): Promise<void>;
  /** Open a row the way the view says (beside the table or as a page). */
  openRow(pageId: string): void;
  addRow(): Promise<void>;
  updateView(patch: { config: Record<string, unknown> }): Promise<void>;
  /** The column menu; `prop` null is the Name column. */
  openHeaderMenu(anchor: HTMLElement, prop: IDatabaseProperty | null): void;
  openAddProperty(anchor: HTMLElement): void;
  openRowMenu(e: MouseEvent, row: IDatabaseRow): void;
  openCalcMenu(anchor: HTMLElement, key: string, type: PropertyType | 'title'): void;
  /** The inline editor for a cell (the shared property editors). */
  editorFor(prop: IDatabaseProperty, value: unknown, onChange: (v: unknown) => void): HTMLElement;
  /** A row's page icon as an element, or null for none. */
  rowIcon(icon: string | null): HTMLElement | null;
  /** The menu on an option pill (its colour), where the option is used. */
  openOptionMenu?(anchor: HTMLElement, prop: IDatabaseProperty, value: string): void;
}

export interface ITableViewState {
  readonly view: IDatabaseView;
  readonly props: readonly IDatabaseProperty[];
  /** Filtered and sorted already. */
  readonly rows: readonly IDatabaseRow[];
  /** A locked database: no new columns from here. */
  readonly locked?: boolean;
}

const COL_DRAG_TYPE = 'text/parallx-db-col';

export function renderTableView(body: HTMLElement, state: ITableViewState, deps: ITableViewDeps, store: DisposableStore): void {
  const { view, rows } = state;
  const cfg = readViewConfig(view.config);
  const props = visibleProperties(state.props, view);
  const frozen = new Set(frozenKeys(props, cfg.freeze));
  const keys = [TITLE_KEY, ...props.map((p) => p.id)];
  const lefts = new Map<string, number>();
  let left = 0;
  for (const k of keys) { lefts.set(k, left); left += columnWidth(cfg, k); }
  const lastFrozen = [...keys].reverse().find((k) => frozen.has(k)) ?? null;
  const freezeClass = (el: HTMLElement, key: string): void => {
    if (!frozen.has(key)) return;
    el.classList.add('canvas-db-col--frozen');
    el.style.left = `${lefts.get(key) ?? 0}px`;
    if (key === lastFrozen) el.classList.add('canvas-db-col--frozen-last');
  };
  const wrapClass = (el: HTMLElement, key: string): void => { if (cfg.wrap[key]) el.classList.add('canvas-db-cell--wrap'); };

  const scroll = createBlock(body, 'div', { className: 'canvas-db-scroll' });
  const table = tableEl(scroll, 'canvas-db-table');
  table.setAttribute('role', 'grid');
  table.setAttribute('aria-label', view.name);
  table.setAttribute('aria-rowcount', String(rows.length));

  // Column widths.
  const colgroup = tableEl(table, '', 'colgroup');
  for (const k of keys) { const col = tableEl(colgroup, '', 'col'); col.style.width = `${columnWidth(cfg, k)}px`; }
  tableEl(colgroup, '', 'col'); // the + column

  // Header.
  const thead = tableEl(table, '', 'thead');
  const headRow = tableEl(thead, '', 'tr');
  const titleTh = tableEl(headRow, 'canvas-db-th canvas-db-th--title', 'th');
  titleTh.setAttribute('scope', 'col');
  titleTh.appendChild(createTypeIconElement('text', 14));
  const titleName = createBlock(titleTh, 'span', { className: 'canvas-db-th__name', text: 'Name' });
  store.add(declareControl(titleName, { id: 'database.column.name', label: 'Name' }));
  store.add(addDisposableListener(titleTh, 'click', () => deps.openHeaderMenu(titleTh, null)));
  attachResize(titleTh, TITLE_KEY, view, deps, store);
  freezeClass(titleTh, TITLE_KEY);

  for (const p of props) {
    const th = tableEl(headRow, 'canvas-db-th', 'th');
    th.setAttribute('scope', 'col');
    th.appendChild(createTypeIconElement(p.sourceType ?? p.type, 14));
    const name = createBlock(th, 'span', { className: 'canvas-db-th__name', text: p.name });
    store.add(declareControl(name, { id: `database.column.${sceneSlug(p.id)}`, label: p.name || 'Property' }));
    store.add(addDisposableListener(th, 'click', () => deps.openHeaderMenu(th, p)));
    attachResize(th, p.id, view, deps, store);
    attachReorder(th, p.id, state, deps, store);
    freezeClass(th, p.id);
  }
  const addTh = tableEl(headRow, 'canvas-db-th canvas-db-th--add', 'th');
  addTh.setAttribute('scope', 'col');
  if (!state.locked) createIconButton(addTh, { id: 'database.addProperty', icon: 'plus', title: 'Add a Property', size: 'sm', command: 'database.addProperty' });
  // Dropping a dragged column on + puts it last.
  store.add(addDisposableListener(addTh, 'dragover', (e) => { if (e.dataTransfer?.types.includes(COL_DRAG_TYPE)) { e.preventDefault(); addTh.classList.add('canvas-db-th--drop'); } }));
  store.add(addDisposableListener(addTh, 'dragleave', () => addTh.classList.remove('canvas-db-th--drop')));
  store.add(addDisposableListener(addTh, 'drop', (e) => {
    addTh.classList.remove('canvas-db-th--drop');
    const id = e.dataTransfer?.getData(COL_DRAG_TYPE);
    if (!id) return;
    e.preventDefault();
    void deps.updateView({ config: { ...view.config, order: placeInOrder(state.props, view, id, null) } });
  }));

  // Rows.
  const tbody = tableEl(table, '', 'tbody');
  rows.forEach((row, index) => {
    const tr = tableEl(tbody, 'canvas-db-row', 'tr');
    tr.setAttribute('aria-rowindex', String(index + 1));
    const titleTd = tableEl(tr, 'canvas-db-cell canvas-db-cell--title', 'td');
    titleTd.setAttribute('role', 'gridcell');
    titleTd.tabIndex = -1;
    freezeClass(titleTd, TITLE_KEY);
    wrapClass(titleTd, TITLE_KEY);
    const wrap = createBlock(titleTd, 'div', { className: 'canvas-db-cell__titlewrap' });
    const icon = deps.rowIcon(row.icon);
    if (icon) { icon.classList.add('canvas-db-cell__icon'); wrap.appendChild(icon); }
    const text = createBlock(wrap, 'span', { className: 'canvas-db-cell__titletext', text: row.title || 'Untitled' });
    store.add(addDisposableListener(text, 'click', () => beginRename(text, row, deps)));
    createIconButton(wrap, { id: null, icon: 'maximize', title: 'Open', size: 'sm', command: 'database.openRow', args: [row.pageId] }).classList.add('canvas-db-openbtn');
    store.add(addDisposableListener(titleTd, 'contextmenu', (e) => { e.preventDefault(); deps.openRowMenu(e, row); }));

    for (const p of props) {
      const td = tableEl(tr, 'canvas-db-cell', 'td');
      td.setAttribute('role', 'gridcell');
      td.tabIndex = -1;
      freezeClass(td, p.id);
      wrapClass(td, p.id);
      renderCell(td, p, row, deps, store);
    }
    tableEl(tr, 'canvas-db-cell canvas-db-cell--pad', 'td');
  });
  const first = tbody.querySelector<HTMLElement>('td[role="gridcell"]');
  if (first) first.tabIndex = 0;

  // + New.
  const newTr = tableEl(tbody, 'canvas-db-newrow', 'tr');
  const newTd = tableEl(newTr, 'canvas-db-newrow__cell', 'td');
  (newTd as HTMLTableCellElement).colSpan = props.length + 2;
  createButton(newTd, { id: 'database.newRowCell', label: 'New', icon: 'plus', kind: 'ghost', size: 'sm', command: 'database.addRow' });

  // Calculations.
  const tfoot = tableEl(table, '', 'tfoot');
  const calcRow = tableEl(tfoot, 'canvas-db-calcrow', 'tr');
  const calcCell = (key: string, type: PropertyType | 'title', values: unknown[]): void => {
    const td = tableEl(calcRow, 'canvas-db-calc', 'td');
    freezeClass(td, key);
    const kind = cfg.calc[key] ?? (key === TITLE_KEY ? 'count' : 'none');
    const result = kind === 'none' ? '' : calculate(kind, values, type);
    const btn = createButton(td, {
      id: null, kind: 'ghost', size: 'sm', icon: 'chevron-down',
      label: kind === 'none' ? 'Calculate' : calcLabel(kind),
      title: `Calculate ${key === TITLE_KEY ? 'Name' : (props.find((p) => p.id === key)?.name ?? '')}`,
      command: 'database.calculate', args: [key, type],
    });
    btn.classList.add('canvas-db-calc__btn');
    if (kind === 'none') btn.classList.add('canvas-db-calc__btn--empty');
    else createBlock(btn, 'span', { className: 'canvas-db-calc__value', text: result });
  };
  calcCell(TITLE_KEY, 'title', rows.map((r) => r.title));
  for (const p of props) calcCell(p.id, p.type, rows.map((r) => r.values[p.id]));
  tableEl(calcRow, 'canvas-db-calc canvas-db-calc--pad', 'td');

  wireGridKeys(table, store);
}

/** A table element (table, thead, tr, th, td, col …): layout, never a control, so a kit block. */
function tableEl(parent: HTMLElement, className: string, tag: 'table' | 'thead' | 'tbody' | 'tfoot' | 'tr' | 'th' | 'td' | 'colgroup' | 'col' = 'table'): HTMLElement {
  return createBlock(parent, tag, className ? { className } : {});
}

function renderCell(td: HTMLElement, prop: IDatabaseProperty, row: IDatabaseRow, deps: ITableViewDeps, store: DisposableStore): void {
  const value = row.values[prop.id];
  if (prop.type === 'checkbox') {
    const checked = isChecked(value);
    const box = createIconButton(td, { id: null, icon: checked ? 'check-square' : 'square', title: checked ? 'Checked' : 'Unchecked', size: 'sm', command: 'database.setCell', args: [row.pageId, prop.id, !checked] });
    box.classList.add('canvas-db-checkbtn');
    box.setAttribute('aria-pressed', String(checked));
    return;
  }
  const display = createBlock(td, 'div', { className: 'canvas-db-cell__value' });
  renderCellValue(display, prop, value);
  if (isComputedType(prop.sourceType ?? prop.type)) { display.classList.add('canvas-db-cell__value--computed'); return; }
  if (deps.openOptionMenu && (prop.type === 'select' || prop.type === 'tags' || prop.type === 'status')) {
    store.add(addDisposableListener(display, 'contextmenu', (e) => {
      const pillEl = (e.target as HTMLElement).closest<HTMLElement>('.canvas-db-pill');
      if (!pillEl) return;
      e.preventDefault(); e.stopPropagation();
      deps.openOptionMenu!(pillEl, prop, pillEl.textContent ?? '');
    }));
  }
  const edit = (): void => {
    td.textContent = '';
    const editor = deps.editorFor(prop, value ?? null, (next) => { void deps.setCell(row.pageId, prop.id, next); });
    editor.classList.add('canvas-db-cell__editor');
    td.appendChild(editor);
    const input = editor.querySelector<HTMLElement>('input, [contenteditable]') ?? editor;
    input.focus();
  };
  store.add(addDisposableListener(display, 'click', edit));
  td.dataset.editable = 'true';
}

function beginRename(text: HTMLElement, row: IDatabaseRow, deps: ITableViewDeps): void {
  const field = createInput(null, { id: null, label: 'Row name', value: row.title });
  field.element.classList.add('canvas-db-titlefield');
  const input = field.element.querySelector<HTMLInputElement>('input') ?? (field.element as HTMLInputElement);
  input.classList.add('canvas-db-titleinput');
  text.replaceWith(field.element);
  input.focus();
  input.select();
  let done = false;
  const commit = (): void => {
    if (done) return; done = true;
    const next = field.value.trim() || 'Untitled';
    if (next !== row.title) void deps.renameRow(row.pageId, next);
    else { field.element.replaceWith(text); field.dispose(); }
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { field.value = row.title; input.blur(); }
  });
}

/** The grip at a header's right edge: drag it (mouse, pen or finger) or, with the header focused, resize by keys. */
function attachResize(th: HTMLElement, key: string, view: IDatabaseView, deps: ITableViewDeps, store: DisposableStore): void {
  const grip = createBlock(th, 'div', { className: 'canvas-db-resize', attrs: { role: 'presentation' } });
  const min = key === TITLE_KEY ? 120 : MIN_COLUMN_WIDTH;
  const save = (w: number): void => { void deps.updateView({ config: patchRecord(view.config, 'widths', key, Math.max(min, Math.round(w))) }); };
  store.add(registerKeyboardResize(th, { axis: 'width', resize: (d) => { const w = th.getBoundingClientRect().width; if (d < 0 && w <= min) return false; save(w + d); return true; } }));
  const colOf = (): HTMLElement | undefined => {
    const table = th.closest('table');
    const index = [...th.parentElement!.children].indexOf(th);
    return table?.querySelectorAll<HTMLElement>('col')[index];
  };
  store.add(onDragPress(grip, (e) => {
    e.preventDefault(); e.stopPropagation();
    const startX = e.clientX, startW = th.getBoundingClientRect().width;
    const col = colOf();
    th.classList.add('canvas-db-th--resizing');
    let moved = false;
    const onMove = (ev: MouseEvent): void => {
      moved = true;
      const w = Math.max(min, Math.round(startW + (ev.clientX - startX)));
      if (col) col.style.width = `${w}px`;
    };
    const onUp = (ev: MouseEvent): void => {
      document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp);
      th.classList.remove('canvas-db-th--resizing');
      if (moved) save(startW + (ev.clientX - startX));
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }));
  // The grip is not the header's menu.
  store.add(addDisposableListener(grip, 'click', (e) => e.stopPropagation()));
}

/** Drag a header onto another to put the column before it (a finger drags too, through the touch bridge). */
function attachReorder(th: HTMLElement, id: string, state: ITableViewState, deps: ITableViewDeps, store: DisposableStore): void {
  th.draggable = true;
  store.add(addDisposableListener(th, 'dragstart', (e) => {
    e.dataTransfer?.setData(COL_DRAG_TYPE, id);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    th.classList.add('canvas-db-th--dragging');
  }));
  store.add(addDisposableListener(th, 'dragend', () => th.classList.remove('canvas-db-th--dragging')));
  store.add(addDisposableListener(th, 'dragover', (e) => { if (e.dataTransfer?.types.includes(COL_DRAG_TYPE)) { e.preventDefault(); th.classList.add('canvas-db-th--drop'); } }));
  store.add(addDisposableListener(th, 'dragleave', () => th.classList.remove('canvas-db-th--drop')));
  store.add(addDisposableListener(th, 'drop', (e) => {
    th.classList.remove('canvas-db-th--drop');
    const moved = e.dataTransfer?.getData(COL_DRAG_TYPE);
    if (!moved || moved === id) return;
    e.preventDefault();
    void deps.updateView({ config: { ...state.view.config, order: placeInOrder(state.props, state.view, moved, id) } });
  }));
}

/** Arrow keys move between cells; Enter or F2 edits the focused one; Space toggles a checkbox. */
function wireGridKeys(table: HTMLElement, store: DisposableStore): void {
  store.add(addDisposableListener(table, 'keydown', (e) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    // Keys inside an editor or a field are its own.
    if (target.matches('input, textarea, select, [contenteditable="true"]') || target.closest('.canvas-db-cell__editor')) return;
    const cell = target.closest<HTMLElement>('td[role="gridcell"]');
    if (!cell) return;
    const row = cell.parentElement!;
    const cells = [...row.querySelectorAll<HTMLElement>('td[role="gridcell"]')];
    const col = cells.indexOf(cell);
    const focusCell = (c: HTMLElement | null | undefined): void => {
      if (!c) return;
      for (const t of table.querySelectorAll<HTMLElement>('td[role="gridcell"]')) t.tabIndex = -1;
      c.tabIndex = 0;
      c.focus();
    };
    switch (e.key) {
      case 'ArrowRight': e.preventDefault(); focusCell(cells[col + 1]); break;
      case 'ArrowLeft': e.preventDefault(); focusCell(cells[col - 1]); break;
      case 'ArrowDown': { e.preventDefault(); const next = row.nextElementSibling; focusCell(next?.querySelectorAll<HTMLElement>('td[role="gridcell"]')[col]); break; }
      case 'ArrowUp': { e.preventDefault(); const prev = row.previousElementSibling; focusCell(prev?.querySelectorAll<HTMLElement>('td[role="gridcell"]')[col]); break; }
      case 'Home': e.preventDefault(); focusCell(cells[0]); break;
      case 'End': e.preventDefault(); focusCell(cells[cells.length - 1]); break;
      case 'Enter': case 'F2': {
        if (target !== cell) return;
        e.preventDefault();
        (cell.querySelector<HTMLElement>('.canvas-db-cell__value, .canvas-db-cell__titletext, .canvas-db-checkbtn'))?.click();
        break;
      }
      case ' ': {
        const box = cell.querySelector<HTMLElement>('.canvas-db-checkbtn');
        if (box && target === cell) { e.preventDefault(); box.click(); }
        break;
      }
      default: return;
    }
  }));
}

export { readViewConfig as readTableConfig };
export type { IViewConfig };
