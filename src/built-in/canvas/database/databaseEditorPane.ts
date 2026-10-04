// databaseEditorPane.ts — the full-page database editor (Notion-parity UI).
//
// Anatomy (researched against Notion's help-center docs):
//   icon + title
//   view tabs row (type icon + name per view, + add view) ··· toolbar:
//     [Filter] [Sort] [New]
//   active-rule chips row (when the view has filters/sorts)
//   body → TABLE view (typed column headers with menus, pinned title column
//     with hover-OPEN, inline cell editors, + new column, + New row) or
//     BOARD view (columns per group option: colored pill header + count,
//     cards, drag between columns writes the group property, + add card).
//
// View state (filter/sort/groupBy/column widths/hidden props) is VIEW-LOCAL
// and persisted through DatabaseDataService.updateView — matching Notion.

import type { IDisposable } from '../../../platform/lifecycle.js';
import { DisposableStore } from '../../../platform/lifecycle.js';
import type { DatabaseDataService } from './databaseDataService.js';
import type {
  DatabaseViewType, FilterOp, IDatabaseProperty, IDatabaseRow, IDatabaseView, IFilterRule, ISortRule,
} from './databaseTypes.js';
import { TITLE_KEY } from './databaseTypes.js';
import { applyFilter, applySort, boardDropValue, groupRows, seedForFilter } from './databaseViewModel.js';
import { isChecked, normalizeDateValue, toNumber } from './cellValues.js';
import { createPropertyEditor, createTypeIconElement } from '../properties/propertyEditors.js';
import type { IPropertyDefinition, PropertyType } from '../properties/propertyTypes.js';
import { resolvePageIcon, svgIcon } from '../config/iconRegistry.js';
import { showConfirmModal } from '../../../api/notificationService.js';
import { Dropdown } from '../../../ui/dropdown.js';
import { attachPopupDismiss } from '../../../ui/dom.js';

function renderPageIconHtml(icon: string | null | undefined): string {
  const id = resolvePageIcon(icon);
  return id ? (svgIcon(id) || '') : '';
}

/** Notion's named option-pill palette. */
export const PILL_COLORS = ['default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'] as const;

const PROPERTY_TYPES: { type: PropertyType; label: string }[] = [
  { type: 'text', label: 'Text' },
  { type: 'number', label: 'Number' },
  { type: 'select', label: 'Select' },
  { type: 'tags', label: 'Multi-select' },
  { type: 'date', label: 'Date' },
  { type: 'datetime', label: 'Date & time' },
  { type: 'checkbox', label: 'Checkbox' },
  { type: 'url', label: 'URL' },
];

const FILTER_OPS: { op: FilterOp; label: string }[] = [
  { op: 'equals', label: 'is' },
  { op: 'not_equals', label: 'is not' },
  { op: 'contains', label: 'contains' },
  { op: 'greater_than', label: '>' },
  { op: 'less_than', label: '<' },
  { op: 'is_empty', label: 'is empty' },
  { op: 'is_not_empty', label: 'is not empty' },
];

/** The filter operations that mean something for a column type. */
function filterOpsFor(type: PropertyType | 'title'): { op: FilterOp; label: string }[] {
  switch (type) {
    case 'checkbox':
      // Unchecked and never set read the same (cellValues.ts).
      return [{ op: 'is_not_empty', label: 'is checked' }, { op: 'is_empty', label: 'is not checked' }];
    case 'number':
      return FILTER_OPS.filter((o) => o.op !== 'contains');
    case 'date':
    case 'datetime':
      return [
        { op: 'equals', label: 'is' },
        { op: 'not_equals', label: 'is not' },
        { op: 'less_than', label: 'is before' },
        { op: 'greater_than', label: 'is after' },
        { op: 'is_empty', label: 'is empty' },
        { op: 'is_not_empty', label: 'is not empty' },
      ];
    case 'select':
    case 'tags':
      return FILTER_OPS.filter((o) => o.op !== 'greater_than' && o.op !== 'less_than');
    default:
      return FILTER_OPS;
  }
}

export interface IDatabasePaneDeps {
  readonly db: DatabaseDataService;
  /** Open a row as a page (canvas editor). */
  openPage(pageId: string): void;
  /** Rename the database page (title lives on pages). */
  renamePage(pageId: string, title: string): Promise<void>;
  /** The app's confirmation modal, for actions that lose data. */
  confirm?(options: { message: string; detail?: string; confirmLabel?: string; danger?: boolean }): Promise<boolean>;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function pill(text: string, color: string): HTMLElement {
  const span = el('span', `canvas-db-pill canvas-db-pill--${PILL_COLORS.includes(color as never) ? color : 'default'}`, text);
  return span;
}

function optionColor(prop: IDatabaseProperty, value: string): string {
  const options = (prop.config as { options?: { value: string; color?: string }[] }).options ?? [];
  return options.find((o) => o.value === value)?.color ?? 'default';
}

/** Adapt a database property to the IPropertyDefinition shape the shared
 *  property editors consume. */
function asDefinition(prop: IDatabaseProperty): IPropertyDefinition {
  return {
    name: prop.name, type: prop.type, config: prop.config,
    sortOrder: prop.sortOrder, createdAt: '', updatedAt: '',
  };
}

export class DatabaseEditorPane implements IDisposable {
  private readonly _disposables = new DisposableStore();
  private _disposed = false;

  private _props: IDatabaseProperty[] = [];
  private _views: IDatabaseView[] = [];
  private _rows: IDatabaseRow[] = [];
  private _activeViewId: string | null = null;
  private _title = '';
  private _icon: string | null = null;

  private readonly _root: HTMLElement;
  private _activePopover: HTMLElement | null = null;

  constructor(
    private readonly _container: HTMLElement,
    private readonly _databaseId: string,
    private readonly _deps: IDatabasePaneDeps,
  ) {
    this._root = el('div', 'canvas-db-pane');
    this._container.appendChild(this._root);
    this._disposables.add(this._deps.db.onDidChangeStructure((id) => { if (id === this._databaseId) void this._reload(); }));
    this._disposables.add(this._deps.db.onDidChangeRows((id) => { if (id === this._databaseId) void this._reloadRows(); }));
    void this._reload();
  }

  get activeView(): IDatabaseView | null {
    return this._views.find((v) => v.id === this._activeViewId) ?? this._views[0] ?? null;
  }

  /** Loads can finish out of order (a slow full reload after a quick rows
   *  reload); only the newest one is shown. */
  private _loadSeq = 0;
  private _rowsSignature = '';
  private _deferredRender: 'all' | 'body' | null = null;

  private async _reload(): Promise<void> {
    const seq = ++this._loadSeq;
    const db = this._deps.db;
    const [info, props, views, rows] = await Promise.all([
      db.getDatabase(this._databaseId),
      db.listProperties(this._databaseId),
      db.listViews(this._databaseId),
      db.listRows(this._databaseId),
    ]);
    if (this._disposed || seq !== this._loadSeq) return;
    this._rowsSignature = JSON.stringify(rows);
    this._title = info?.title ?? 'Untitled database';
    this._icon = info?.icon ?? null;
    this._props = props;
    this._views = views;
    this._rows = rows;
    if (!this._activeViewId || !views.some((v) => v.id === this._activeViewId)) {
      this._activeViewId = views[0]?.id ?? null;
    }
    this._renderWhenIdle('all');
  }

  private async _reloadRows(): Promise<void> {
    const seq = ++this._loadSeq;
    const rows = await this._deps.db.listRows(this._databaseId);
    if (this._disposed || seq !== this._loadSeq) return;
    // A write that changed nothing shown (the same rows come back) does not
    // rebuild the table.
    const signature = JSON.stringify(rows);
    if (signature === this._rowsSignature) return;
    this._rowsSignature = signature;
    this._rows = rows;
    this._renderWhenIdle('body');
  }

  /** Rebuilding the table under a field being typed in threw the typing
   *  away; the rebuild waits until that field is left. */
  private _renderWhenIdle(kind: 'all' | 'body'): void {
    const active = document.activeElement as HTMLElement | null;
    const typing = !!active && this._root.contains(active)
      && (active.matches('input, textarea, select') || active.isContentEditable);
    if (!typing) {
      this._deferredRender = null;
      if (kind === 'all') this._render(); else this._renderBody();
      return;
    }
    const pending = this._deferredRender;
    this._deferredRender = pending === 'all' || kind === 'all' ? 'all' : 'body';
    if (pending) return;
    // Checked on a short timer: a field that is removed while focused fires
    // no focusout in Chromium, and the render must not wait forever.
    const field = active!;
    const timer = setInterval(() => {
      if (this._disposed) { clearInterval(timer); return; }
      if (field.isConnected && document.activeElement === field) return;
      clearInterval(timer);
      const next = this._deferredRender;
      this._deferredRender = null;
      if (next) this._renderWhenIdle(next);
    }, 150);
    this._disposables.add({ dispose: () => clearInterval(timer) });
  }

  // ── Render: shell ──────────────────────────────────────────────────────────

  private _render(): void {
    this._closePopover();
    this._root.textContent = '';

    // Header: icon + editable title.
    const header = el('div', 'canvas-db-header');
    const iconEl = el('span', 'canvas-db-header__icon');
    iconEl.innerHTML = renderPageIconHtml(this._icon);
    header.appendChild(iconEl);
    const titleEl = el('div', 'canvas-db-header__title', this._title);
    titleEl.contentEditable = 'true';
    titleEl.spellcheck = false;
    titleEl.addEventListener('blur', () => {
      const next = (titleEl.textContent ?? '').trim() || 'Untitled database';
      if (next !== this._title) { this._title = next; void this._deps.renamePage(this._databaseId, next); }
    });
    titleEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); titleEl.blur(); } });
    header.appendChild(titleEl);
    this._root.appendChild(header);

    // View tabs + toolbar.
    const bar = el('div', 'canvas-db-tabbar');
    const tabs = el('div', 'canvas-db-tabs');
    for (const view of this._views) {
      const tab = el('button', `canvas-db-tab${view.id === this.activeView?.id ? ' canvas-db-tab--active' : ''}`);
      tab.appendChild(createTypeIconElement(view.type === 'board' ? 'tags' : 'text', 14));
      tab.appendChild(el('span', '', view.name));
      tab.addEventListener('click', () => { this._activeViewId = view.id; this._render(); });
      tab.addEventListener('contextmenu', (e) => { e.preventDefault(); this._openViewMenu(tab, view); });
      tabs.appendChild(tab);
    }
    const addView = el('button', 'canvas-db-tab canvas-db-tab--add', '+');
    addView.title = 'Add a view';
    addView.addEventListener('click', () => this._openAddViewMenu(addView));
    tabs.appendChild(addView);
    bar.appendChild(tabs);

    const toolbar = el('div', 'canvas-db-toolbar');
    const filterBtn = el('button', 'canvas-db-toolbtn', 'Filter');
    filterBtn.addEventListener('click', () => this._openFilterPopover(filterBtn));
    const sortBtn = el('button', 'canvas-db-toolbtn', 'Sort');
    sortBtn.addEventListener('click', () => this._openSortPopover(sortBtn));
    const newBtn = el('button', 'canvas-db-newbtn', 'New');
    newBtn.addEventListener('click', () => void this._addRow());
    toolbar.append(filterBtn, sortBtn, newBtn);
    bar.appendChild(toolbar);
    this._root.appendChild(bar);

    // Active filter/sort chips.
    const view = this.activeView;
    if (view && (view.filter.rules.length > 0 || view.sort.length > 0)) {
      const chips = el('div', 'canvas-db-chips');
      for (const [i, rule] of view.filter.rules.entries()) {
        const chip = el('span', 'canvas-db-chip');
        chip.textContent = `${this._propName(rule.propertyId)} ${FILTER_OPS.find((f) => f.op === rule.op)?.label ?? rule.op}${rule.value !== undefined && rule.op !== 'is_empty' && rule.op !== 'is_not_empty' ? ` ${String(rule.value)}` : ''}`;
        const x = el('button', 'canvas-db-chip__x', '×');
        x.addEventListener('click', () => void this._updateActiveView({ filter: { ...view.filter, rules: view.filter.rules.filter((_, j) => j !== i) } }));
        chip.appendChild(x);
        chips.appendChild(chip);
      }
      for (const [i, rule] of view.sort.entries()) {
        const chip = el('span', 'canvas-db-chip canvas-db-chip--sort');
        chip.textContent = `↕ ${this._propName(rule.propertyId)} ${rule.dir === 'asc' ? '↑' : '↓'}`;
        const x = el('button', 'canvas-db-chip__x', '×');
        x.addEventListener('click', () => void this._updateActiveView({ sort: view.sort.filter((_, j) => j !== i) }));
        chip.appendChild(x);
        chips.appendChild(chip);
      }
      this._root.appendChild(chips);
    }

    const body = el('div', 'canvas-db-body');
    this._root.appendChild(body);
    this._renderBody();
  }

  private _propName(propertyId: string): string {
    if (propertyId === TITLE_KEY) return 'Name';
    return this._props.find((p) => p.id === propertyId)?.name ?? '?';
  }

  private _visibleProps(view: IDatabaseView): IDatabaseProperty[] {
    const hidden = new Set((view.config.hidden as string[] | undefined) ?? []);
    return this._props.filter((p) => !hidden.has(p.id));
  }

  private _viewRows(view: IDatabaseView): IDatabaseRow[] {
    return applySort(applyFilter(this._rows, view.filter, (id) => this._props.find((p) => p.id === id)?.type), view.sort);
  }

  private _renderBody(): void {
    const body = this._root.querySelector('.canvas-db-body');
    const view = this.activeView;
    if (!body || !view) return;
    body.textContent = '';
    if (view.type === 'board') this._renderBoard(body as HTMLElement, view);
    else this._renderTable(body as HTMLElement, view);
  }

  // ── Render: table view ─────────────────────────────────────────────────────

  private _renderTable(body: HTMLElement, view: IDatabaseView): void {
    const props = this._visibleProps(view);
    const widths = (view.config.widths as Record<string, number> | undefined) ?? {};
    const rows = this._viewRows(view);

    const table = el('table', 'canvas-db-table');
    const colgroup = el('colgroup');
    const titleCol = el('col');
    titleCol.style.width = `${widths[TITLE_KEY] ?? 260}px`;
    colgroup.appendChild(titleCol);
    for (const p of props) {
      const col = el('col');
      col.style.width = `${widths[p.id] ?? 160}px`;
      colgroup.appendChild(col);
    }
    colgroup.appendChild(el('col')); // + column
    table.appendChild(colgroup);

    // Header.
    const thead = el('thead');
    const headRow = el('tr');
    const titleTh = el('th', 'canvas-db-th canvas-db-th--title');
    titleTh.appendChild(createTypeIconElement('text', 14));
    titleTh.appendChild(el('span', '', 'Name'));
    this._attachResize(titleTh, TITLE_KEY, view);
    headRow.appendChild(titleTh);
    for (const p of props) {
      const th = el('th', 'canvas-db-th');
      th.appendChild(createTypeIconElement(p.type, 14));
      th.appendChild(el('span', '', p.name));
      th.addEventListener('click', () => this._openHeaderMenu(th, p, view));
      this._attachResize(th, p.id, view);
      headRow.appendChild(th);
    }
    const addTh = el('th', 'canvas-db-th canvas-db-th--add', '+');
    addTh.title = 'Add a property';
    addTh.addEventListener('click', () => this._openAddPropertyPopover(addTh));
    headRow.appendChild(addTh);
    thead.appendChild(headRow);
    table.appendChild(thead);

    // Body.
    const tbody = el('tbody');
    for (const row of rows) {
      const tr = el('tr', 'canvas-db-row');
      // Title cell: icon + title, hover OPEN.
      const titleTd = el('td', 'canvas-db-cell canvas-db-cell--title');
      const titleWrap = el('div', 'canvas-db-cell__titlewrap');
      if (row.icon) {
        const ic = el('span', 'canvas-db-cell__icon');
        ic.innerHTML = renderPageIconHtml(row.icon);
        titleWrap.appendChild(ic);
      }
      const titleText = el('span', 'canvas-db-cell__titletext', row.title || 'Untitled');
      titleText.addEventListener('click', () => this._beginRenameRow(titleText, row));
      titleWrap.appendChild(titleText);
      const openBtn = el('button', 'canvas-db-openbtn', 'OPEN');
      openBtn.addEventListener('click', (e) => { e.stopPropagation(); this._deps.openPage(row.pageId); });
      titleWrap.appendChild(openBtn);
      titleTd.appendChild(titleWrap);
      titleTd.addEventListener('contextmenu', (e) => { e.preventDefault(); this._openRowMenu(e, row); });
      tr.appendChild(titleTd);

      for (const p of props) {
        const td = el('td', 'canvas-db-cell');
        this._renderCell(td, p, row);
        tr.appendChild(td);
      }
      tr.appendChild(el('td', 'canvas-db-cell canvas-db-cell--pad'));
      tbody.appendChild(tr);
    }

    // + New row.
    const newTr = el('tr', 'canvas-db-newrow');
    const newTd = el('td', 'canvas-db-newrow__cell', '+ New');
    newTd.colSpan = props.length + 2;
    newTd.addEventListener('click', () => void this._addRow());
    newTr.appendChild(newTd);
    tbody.appendChild(newTr);
    table.appendChild(tbody);
    body.appendChild(table);

    // Footer count (calculations row, minimal: count).
    body.appendChild(el('div', 'canvas-db-count', `${rows.length} ${rows.length === 1 ? 'row' : 'rows'}`));
  }

  private _renderCell(td: HTMLElement, prop: IDatabaseProperty, row: IDatabaseRow): void {
    td.textContent = '';
    const value = row.values[prop.id];
    // Checkbox toggles immediately (no edit mode).
    if (prop.type === 'checkbox') {
      // isChecked: an older "false" string reads unchecked, as it filters.
      const checked = isChecked(value);
      const box = el('div', `canvas-db-check${checked ? ' canvas-db-check--on' : ''}`);
      box.addEventListener('click', () => void this._deps.db.setCellValue(this._databaseId, row.pageId, prop.id, !checked));
      td.appendChild(box);
      return;
    }
    const display = el('div', 'canvas-db-cell__value');
    if (prop.type === 'select' && typeof value === 'string' && value) {
      display.appendChild(pill(value, optionColor(prop, value)));
    } else if (prop.type === 'tags' && Array.isArray(value) && value.length > 0) {
      for (const v of value) display.appendChild(pill(String(v), optionColor(prop, String(v))));
    } else if (prop.type === 'url' && typeof value === 'string' && value) {
      const a = el('a', 'canvas-db-cell__link', value);
      a.addEventListener('click', (e) => e.stopPropagation());
      (a as HTMLAnchorElement).href = value;
      (a as HTMLAnchorElement).target = '_blank';
      display.appendChild(a);
    } else if (value !== null && value !== undefined && value !== '') {
      display.textContent = Array.isArray(value) ? value.join(', ') : String(value);
    }
    display.addEventListener('click', () => {
      // Swap to the shared inline editor for this type.
      td.textContent = '';
      const editor = createPropertyEditor(asDefinition(prop), value ?? null, (next) => {
        void this._deps.db.setCellValue(this._databaseId, row.pageId, prop.id, next);
      });
      editor.classList.add('canvas-db-cell__editor');
      td.appendChild(editor);
      const input = editor.querySelector('input, [contenteditable]') as HTMLElement | null;
      input?.focus();
    });
    td.appendChild(display);
  }

  private _beginRenameRow(titleText: HTMLElement, row: IDatabaseRow): void {
    const input = el('input', 'canvas-db-titleinput') as HTMLInputElement;
    input.value = row.title;
    titleText.replaceWith(input);
    input.focus();
    input.select();
    const commit = () => {
      const next = input.value.trim() || 'Untitled';
      if (next !== row.title) void this._deps.db.renameRow(this._databaseId, row.pageId, next);
      else this._renderBody();
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { input.value = row.title; input.blur(); }
    });
  }

  private _attachResize(th: HTMLElement, key: string, view: IDatabaseView): void {
    const grip = el('div', 'canvas-db-resize');
    grip.addEventListener('mousedown', (e) => {
      e.preventDefault(); e.stopPropagation();
      const startX = e.clientX;
      const startW = th.getBoundingClientRect().width;
      const onMove = (ev: MouseEvent) => {
        const w = Math.max(80, Math.round(startW + (ev.clientX - startX)));
        const table = th.closest('table');
        const index = [...th.parentElement!.children].indexOf(th);
        const col = table?.querySelectorAll('col')[index] as HTMLElement | undefined;
        if (col) col.style.width = `${w}px`;
      };
      const onUp = (ev: MouseEvent) => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        const w = Math.max(80, Math.round(startW + (ev.clientX - startX)));
        const widths = { ...((view.config.widths as Record<string, number>) ?? {}), [key]: w };
        void this._updateActiveView({ config: { ...view.config, widths } });
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
    th.appendChild(grip);
  }

  // ── Render: board view ─────────────────────────────────────────────────────

  private _renderBoard(body: HTMLElement, view: IDatabaseView): void {
    const groupProp = this._props.find((p) => p.id === view.groupBy)
      ?? this._props.find((p) => p.type === 'select')
      ?? null;
    if (!groupProp) {
      const empty = el('div', 'canvas-db-board-empty', 'Board view needs a select property to group by. Add one with + in the table view.');
      body.appendChild(empty);
      return;
    }
    const optionOrder = ((groupProp.config as { options?: { value: string; color?: string }[] }).options ?? []).map((o) => o.value);
    const rows = this._viewRows(view);
    const groups = groupRows(rows, groupProp.id, optionOrder)
      .filter((g) => !(view.hideEmptyGroups && g.rows.length === 0));

    const board = el('div', 'canvas-db-board');
    for (const group of groups) {
      const colEl = el('div', 'canvas-db-board__col');
      colEl.dataset.group = group.key;

      const head = el('div', 'canvas-db-board__head');
      head.appendChild(group.key
        ? pill(group.key, optionColor(groupProp, group.key))
        : el('span', 'canvas-db-pill canvas-db-pill--default', `No ${groupProp.name}`));
      head.appendChild(el('span', 'canvas-db-board__count', String(group.rows.length)));
      const addCard = el('button', 'canvas-db-board__add', '+');
      addCard.title = 'New row in this group';
      addCard.addEventListener('click', () => void this._addRow(group.key ? { [groupProp.id]: group.key } : {}));
      head.appendChild(addCard);
      colEl.appendChild(head);

      const list = el('div', 'canvas-db-board__cards');
      for (const row of group.rows) {
        const card = el('div', 'canvas-db-card');
        card.draggable = true;
        card.dataset.pageId = row.pageId;
        const cardTitle = el('div', 'canvas-db-card__title', row.title || 'Untitled');
        card.appendChild(cardTitle);
        // A couple of visible non-group properties on the card.
        for (const p of this._visibleProps(view).filter((p) => p.id !== groupProp.id).slice(0, 3)) {
          const v = row.values[p.id];
          if (v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) continue;
          const line = el('div', 'canvas-db-card__prop');
          if (p.type === 'select') line.appendChild(pill(String(v), optionColor(p, String(v))));
          else if (p.type === 'tags' && Array.isArray(v)) { for (const t of v) line.appendChild(pill(String(t), optionColor(p, String(t)))); }
          else line.textContent = Array.isArray(v) ? v.join(', ') : String(v);
          card.appendChild(line);
        }
        card.addEventListener('click', () => this._deps.openPage(row.pageId));
        card.addEventListener('dragstart', (e) => {
          e.dataTransfer?.setData('text/parallx-db-row', row.pageId);
          // The column it leaves: a tags card stands in one column per tag.
          e.dataTransfer?.setData('text/parallx-db-group', group.key);
          card.classList.add('canvas-db-card--dragging');
        });
        card.addEventListener('dragend', () => card.classList.remove('canvas-db-card--dragging'));
        card.addEventListener('contextmenu', (e) => { e.preventDefault(); this._openRowMenu(e, row); });
        list.appendChild(card);
      }
      colEl.appendChild(list);

      // Drop target: dragging a card here writes the group property.
      colEl.addEventListener('dragover', (e) => { e.preventDefault(); colEl.classList.add('canvas-db-board__col--over'); });
      colEl.addEventListener('dragleave', () => colEl.classList.remove('canvas-db-board__col--over'));
      colEl.addEventListener('drop', (e) => {
        e.preventDefault();
        colEl.classList.remove('canvas-db-board__col--over');
        const pageId = e.dataTransfer?.getData('text/parallx-db-row');
        if (pageId) {
          const fromKey = e.dataTransfer?.getData('text/parallx-db-group') ?? '';
          const current = rows.find((r) => r.pageId === pageId)?.values[groupProp.id];
          const value = boardDropValue(current, fromKey, group.key, groupProp.type === 'tags');
          void this._deps.db.setCellValue(this._databaseId, pageId, groupProp.id, value);
        }
      });
      board.appendChild(colEl);
    }
    body.appendChild(board);
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  /** A new row starts with what the view's filter asks for (so it stays in
   *  view) plus `seedValues` (a board column's value), in one write. */
  private async _addRow(seedValues: Record<string, unknown> = {}): Promise<void> {
    const seed = seedForFilter(this.activeView?.filter, (id) => this._props.find((p) => p.id === id)?.type);
    try {
      await this._deps.db.addRow(this._databaseId, seed.title, { ...seed.values, ...seedValues });
    } catch (err) {
      console.error('[Database] Add row failed:', err);
    }
  }

  private async _updateActiveView(patch: Parameters<DatabaseDataService['updateView']>[2]): Promise<void> {
    const view = this.activeView;
    if (!view) return;
    await this._deps.db.updateView(this._databaseId, view.id, patch);
  }

  // ── Popovers & menus ───────────────────────────────────────────────────────

  /** Controls (Dropdowns) owned by the CURRENT popover — they register
   *  document-level listeners, so closing the popover must dispose them. */
  private _popoverDisposables: IDisposable[] = [];

  private _closePopover(): void {
    for (const d of this._popoverDisposables) { try { d.dispose(); } catch { /* noop */ } }
    this._popoverDisposables = [];
    this._activePopover?.remove();
    this._activePopover = null;
  }

  private _openPopover(anchor: HTMLElement, build: (pop: HTMLElement) => void): void {
    this._closePopover();
    const pop = el('div', 'canvas-db-popover');
    build(pop);
    document.body.appendChild(pop);
    const rect = anchor.getBoundingClientRect();
    pop.style.left = `${Math.min(rect.left, window.innerWidth - pop.offsetWidth - 12)}px`;
    pop.style.top = `${rect.bottom + 4}px`;
    this._activePopover = pop;
    // Standard popup contract via the mode subsystem. The hand-rolled
    // listener this replaces removed itself ONLY in its own outside-click
    // branch — closing via a menu-item click or a re-open leaked it bound
    // to the OLD popover, and the stale check then closed the NEXT
    // popover on its first inside click (the "header rename input cannot
    // be clicked on the 2nd open" bug).
    const detach = attachPopupDismiss(pop, () => this._closePopover());
    this._popoverDisposables.push({ dispose: detach });
  }

  private _menuItem(label: string, onClick: () => void, danger = false): HTMLElement {
    const item = el('button', `canvas-db-menuitem${danger ? ' canvas-db-menuitem--danger' : ''}`, label);
    item.addEventListener('click', () => { this._closePopover(); onClick(); });
    return item;
  }

  private _openHeaderMenu(th: HTMLElement, prop: IDatabaseProperty, view: IDatabaseView): void {
    this._openPopover(th, (pop) => {
      const rename = el('input', 'canvas-db-popover__input') as HTMLInputElement;
      rename.value = prop.name;
      rename.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const name = rename.value.trim();
          this._closePopover();
          if (name && name !== prop.name) void this._deps.db.updateProperty(this._databaseId, prop.id, { name });
        }
      });
      pop.appendChild(rename);
      pop.appendChild(this._menuItem('Sort ascending', () => void this._updateActiveView({ sort: [{ propertyId: prop.id, dir: 'asc' }] })));
      pop.appendChild(this._menuItem('Sort descending', () => void this._updateActiveView({ sort: [{ propertyId: prop.id, dir: 'desc' }] })));
      pop.appendChild(this._menuItem('Hide in view', () => {
        const hidden = [...(((view.config.hidden as string[]) ?? [])), prop.id];
        void this._updateActiveView({ config: { ...view.config, hidden } });
      }));
      if (prop.type === 'select' || prop.type === 'tags') {
        pop.appendChild(this._menuItem('Edit options…', () => this._openOptionsEditor(th, prop)));
      }
      pop.appendChild(this._menuItem('Delete property', () => {
        void showConfirmModal(document.body, {
          message: `Delete the "${prop.name}" property?`,
          detail: 'Every value stored in this property is removed with it.',
          confirmLabel: 'Delete',
          danger: true,
        }).then((ok) => {
          if (ok) void this._deps.db.deleteProperty(this._databaseId, prop.id);
        });
      }, true));
    });
  }

  private _openOptionsEditor(anchor: HTMLElement, prop: IDatabaseProperty): void {
    this._openPopover(anchor, (pop) => {
      // `orig` is the option's stored name: renaming one renames it in every
      // cell that holds it (DatabaseDataService.setOptions).
      const options = ((((prop.config as { options?: { value: string; color: string }[] }).options) ?? []))
        .map((o) => ({ value: o.value, color: o.color, orig: o.value as string | undefined }));
      const list = el('div', 'canvas-db-options');
      const error = el('div', 'canvas-db-popover__error');
      const renderList = () => {
        list.textContent = '';
        for (const [i, opt] of options.entries()) {
          const rowEl = el('div', 'canvas-db-options__row');
          const colorBtn = el('button', `canvas-db-options__color canvas-db-pill--${PILL_COLORS.includes(opt.color as never) ? opt.color : 'default'}`, '◐');
          colorBtn.title = 'Change color';
          colorBtn.setAttribute('aria-label', `Change color of ${opt.value}`);
          colorBtn.addEventListener('click', () => {
            const idx = PILL_COLORS.indexOf((opt.color as never) ?? 'default');
            options[i] = { ...opt, color: PILL_COLORS[(idx + 1) % PILL_COLORS.length] };
            renderList();
          });
          const name = el('input', 'canvas-db-popover__input canvas-db-options__name') as HTMLInputElement;
          name.value = opt.value;
          name.setAttribute('aria-label', 'Option name');
          name.addEventListener('input', () => { options[i] = { ...options[i]!, value: name.value }; });
          const del = el('button', 'canvas-db-options__del', '×');
          del.title = 'Remove option';
          del.setAttribute('aria-label', `Remove ${opt.value}`);
          del.addEventListener('click', () => { options.splice(i, 1); renderList(); });
          rowEl.append(colorBtn, name, del);
          list.appendChild(rowEl);
        }
      };
      renderList();
      pop.appendChild(list);
      const add = el('input', 'canvas-db-popover__input') as HTMLInputElement;
      add.placeholder = 'New option, Enter to add';
      add.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && add.value.trim()) {
          options.push({ value: add.value.trim(), color: PILL_COLORS[(options.length + 1) % PILL_COLORS.length], orig: undefined });
          add.value = '';
          renderList();
        }
      });
      pop.appendChild(add);
      pop.appendChild(error);
      const save = el('button', 'canvas-db-popover__primary', 'Save Options');
      save.addEventListener('click', () => {
        const renames: Record<string, string> = {};
        for (const o of options) if (o.orig !== undefined && o.orig !== o.value.trim()) renames[o.orig] = o.value.trim();
        const next = options.map(({ value, color }) => ({ value: value.trim(), color }));
        void this._deps.db.setOptions(this._databaseId, prop.id, next, renames)
          .then(() => this._closePopover())
          .catch((err) => { error.textContent = err instanceof Error ? err.message : String(err); });
      });
      pop.appendChild(save);
    });
  }

  private _openAddPropertyPopover(anchor: HTMLElement): void {
    this._openPopover(anchor, (pop) => {
      const name = el('input', 'canvas-db-popover__input') as HTMLInputElement;
      name.placeholder = 'Property name';
      pop.appendChild(name);
      for (const { type, label } of PROPERTY_TYPES) {
        const item = el('button', 'canvas-db-menuitem');
        item.appendChild(createTypeIconElement(type, 14));
        item.appendChild(el('span', '', label));
        item.addEventListener('click', () => {
          const propName = name.value.trim() || label;
          this._closePopover();
          const config = type === 'select' || type === 'tags' ? { options: [] } : {};
          void this._deps.db.addProperty(this._databaseId, propName, type, config);
        });
        pop.appendChild(item);
      }
      setTimeout(() => name.focus(), 0);
    });
  }

  private _openAddViewMenu(anchor: HTMLElement): void {
    this._openPopover(anchor, (pop) => {
      const mk = (label: string, type: DatabaseViewType) => this._menuItem(label, async () => {
        const v = await this._deps.db.addView(this._databaseId, label, type);
        this._activeViewId = v.id;
      });
      pop.appendChild(mk('Table', 'table'));
      pop.appendChild(mk('Board', 'board'));
    });
  }

  private _openViewMenu(anchor: HTMLElement, view: IDatabaseView): void {
    this._openPopover(anchor, (pop) => {
      const rename = el('input', 'canvas-db-popover__input') as HTMLInputElement;
      rename.value = view.name;
      rename.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const name = rename.value.trim();
          this._closePopover();
          if (name) void this._deps.db.updateView(this._databaseId, view.id, { name });
        }
      });
      pop.appendChild(rename);
      if (view.type === 'board') {
        for (const p of this._props.filter((p) => p.type === 'select' || p.type === 'tags')) {
          pop.appendChild(this._menuItem(`Group by ${p.name}`, () => void this._deps.db.updateView(this._databaseId, view.id, { groupBy: p.id })));
        }
      }
      // Unhide any hidden properties.
      const hidden = (view.config.hidden as string[] | undefined) ?? [];
      for (const id of hidden) {
        pop.appendChild(this._menuItem(`Show "${this._propName(id)}"`, () => {
          void this._deps.db.updateView(this._databaseId, view.id, { config: { ...view.config, hidden: hidden.filter((h) => h !== id) } });
        }));
      }
      if (this._views.length > 1) {
        pop.appendChild(this._menuItem('Delete view', () => void this._deps.db.deleteView(this._databaseId, view.id), true));
      }
    });
  }

  /** Property items for filter/sort pickers: the pinned Name column + props. */
  private _propItems(): { value: string; label: string }[] {
    return [
      { value: TITLE_KEY, label: 'Name' },
      ...this._props.map((p) => ({ value: p.id, label: p.name })),
    ];
  }

  private _openFilterPopover(anchor: HTMLElement): void {
    const view = this.activeView;
    if (!view) return;
    this._openPopover(anchor, (pop) => {
      pop.appendChild(el('div', 'canvas-db-popover__label', 'Add filter'));
      const propHost = el('div', 'canvas-db-popover__select');
      const propSel = new Dropdown(propHost, {
        items: this._propItems(),
        selected: TITLE_KEY,
        ariaLabel: 'Filter property',
      });
      const typeOf = (id: string | undefined): PropertyType | 'title' =>
        !id || id === TITLE_KEY ? 'title' : (this._props.find((p) => p.id === id)?.type ?? 'text');
      const opHost = el('div', 'canvas-db-popover__select');
      const opSel = new Dropdown(opHost, {
        items: filterOpsFor('title').map(({ op, label }) => ({ value: op, label })),
        selected: filterOpsFor('title')[0]?.op,
        ariaLabel: 'Filter operator',
      });
      this._popoverDisposables.push(propSel, opSel);
      const valInput = el('input', 'canvas-db-popover__input') as HTMLInputElement;
      valInput.placeholder = 'Value';
      valInput.setAttribute('aria-label', 'Filter value');
      // The value field follows the column: a date picker for dates, a
      // number field for numbers, none where the operation needs no value.
      const syncValue = () => {
        const type = typeOf(propSel.value);
        const op = opSel.value as FilterOp | undefined;
        const needsValue = type !== 'checkbox' && op !== 'is_empty' && op !== 'is_not_empty';
        valInput.style.display = needsValue ? '' : 'none';
        valInput.type = type === 'date' ? 'date' : type === 'datetime' ? 'datetime-local' : type === 'number' ? 'number' : 'text';
        valInput.classList.remove('canvas-db-popover__input--invalid');
        valInput.removeAttribute('aria-invalid');
      };
      this._popoverDisposables.push(propSel.onDidChange(() => {
        const ops = filterOpsFor(typeOf(propSel.value));
        opSel.items = ops.map(({ op, label }) => ({ value: op, label }));
        opSel.value = ops[0]?.op;
        valInput.value = '';
        syncValue();
      }));
      this._popoverDisposables.push(opSel.onDidChange(syncValue));
      const apply = el('button', 'canvas-db-popover__primary', 'Add Filter');
      apply.addEventListener('click', () => {
        const type = typeOf(propSel.value);
        const op = (opSel.value ?? filterOpsFor(type)[0]?.op) as FilterOp;
        const raw = valInput.value.trim();
        const needsValue = type !== 'checkbox' && op !== 'is_empty' && op !== 'is_not_empty';
        // A number or date rule with a value that is not one would match
        // nothing; say so instead of adding it.
        const bad = needsValue && raw !== '' && (
          (type === 'number' && toNumber(raw) === null)
          || ((type === 'date' || type === 'datetime') && normalizeDateValue(raw) === null));
        if (bad) {
          valInput.classList.add('canvas-db-popover__input--invalid');
          valInput.setAttribute('aria-invalid', 'true');
          valInput.focus();
          return;
        }
        const rule: IFilterRule = {
          propertyId: propSel.value ?? TITLE_KEY,
          op,
          value: !needsValue || raw === '' ? undefined : raw,
        };
        this._closePopover();
        void this._updateActiveView({ filter: { ...view.filter, rules: [...view.filter.rules, rule] } });
      });
      syncValue();
      pop.append(propHost, opHost, valInput, apply);
    });
  }

  private _openSortPopover(anchor: HTMLElement): void {
    const view = this.activeView;
    if (!view) return;
    this._openPopover(anchor, (pop) => {
      pop.appendChild(el('div', 'canvas-db-popover__label', 'Add sort'));
      const propHost = el('div', 'canvas-db-popover__select');
      const propSel = new Dropdown(propHost, {
        items: this._propItems(),
        selected: TITLE_KEY,
        ariaLabel: 'Sort property',
      });
      const dirHost = el('div', 'canvas-db-popover__select');
      const dirSel = new Dropdown(dirHost, {
        items: [
          { value: 'asc', label: 'Ascending' },
          { value: 'desc', label: 'Descending' },
        ],
        selected: 'asc',
        ariaLabel: 'Sort direction',
      });
      this._popoverDisposables.push(propSel, dirSel);
      const apply = el('button', 'canvas-db-popover__primary', 'Add sort');
      apply.addEventListener('click', () => {
        const rule: ISortRule = {
          propertyId: propSel.value ?? TITLE_KEY,
          dir: (dirSel.value ?? 'asc') as 'asc' | 'desc',
        };
        this._closePopover();
        void this._updateActiveView({ sort: [...view.sort, rule] });
      });
      pop.append(propHost, dirHost, apply);
    });
  }

  /** A row's page goes to Trash, but its values in this database are gone
   *  for good, so it asks first. */
  private async _deleteRow(row: IDatabaseRow): Promise<void> {
    const ok = this._deps.confirm
      ? await this._deps.confirm({
        message: 'Delete this row?',
        detail: 'Its page moves to Trash. The values it held in this database are removed and do not come back with it.',
        confirmLabel: 'Delete Row',
        danger: true,
      })
      : true;
    if (ok) await this._deps.db.removeRow(this._databaseId, row.pageId);
  }

  private _openRowMenu(e: MouseEvent, row: IDatabaseRow): void {
    const anchor = el('span');
    anchor.style.position = 'fixed';
    anchor.style.left = `${e.clientX}px`;
    anchor.style.top = `${e.clientY}px`;
    document.body.appendChild(anchor);
    this._openPopover(anchor, (pop) => {
      pop.appendChild(this._menuItem('Open', () => this._deps.openPage(row.pageId)));
      pop.appendChild(this._menuItem('Delete Row…', () => void this._deleteRow(row), true));
    });
    setTimeout(() => anchor.remove(), 0);
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._closePopover();
    this._disposables.dispose();
    this._root.remove();
  }
}
