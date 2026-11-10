// databaseEditorPane.ts — the full-page database editor (docs/DATABASES.md).
//
// Anatomy (Notion's):
//   icon + title
//   view tabs row (type icon + name per view, + add view) ··· toolbar:
//     [Filter] [Sort] [⋯ view settings] [New]
//   active-rule chips row (when the view has filters/sorts)
//   body → one of the views: TABLE (tableView.ts) or BOARD (here, until
//     step 4 moves it out).
//
// View state (filter/sort/groupBy/column widths/hidden props/order/wrap/
// freeze/calculations/how rows open) is VIEW-LOCAL and persisted through
// DatabaseDataService.updateView — matching Notion. viewConfig.ts reads it.

import { DisposableStore, type IDisposable } from '../../../platform/lifecycle.js';
import type { DatabaseDataService } from './databaseDataService.js';
import type {
  DatabaseViewType, FilterOp, IDatabaseProperty, IDatabaseRow, IDatabaseView, IFilterRule, ISortRule,
} from './databaseTypes.js';
import { TITLE_KEY } from './databaseTypes.js';
import { applyFilter, applySort, seedForFilter } from './databaseViewModel.js';
import { normalizeDateValue, toNumber } from './cellValues.js';
import { createPropertyEditor, createTypeIconElement } from '../properties/propertyEditors.js';
import type { IPropertyDefinition, PropertyType } from '../properties/propertyTypes.js';
import { createIconElement, resolvePageIcon } from '../config/iconRegistry.js';
import { createButton, createIconButton, createMenu } from '../../../ui/kit.js';
import { showConfirmModal } from '../../../api/notificationService.js';
import { Dropdown } from '../../../ui/dropdown.js';
import { attachPopupDismiss } from '../../../ui/dom.js';
import { databaseCsvMenuItems } from './databaseCsvActions.js';
import { renderTableView, type ITableViewDeps } from './tableView.js';
import { renderBoardView } from './boardView.js';
import { renderListView } from './listView.js';
import { renderGalleryView } from './galleryView.js';
import { renderCalendarView } from './calendarView.js';
import { renderTimelineView } from './timelineView.js';
import { renderChartView } from './chartView.js';
import { firstImageSrc } from './pagePreview.js';
import type { IViewDeps } from './viewShared.js';
import { DATABASE_VIEW_TYPES } from './databaseTypes.js';
import { VIEW_META, calcMenuItems, viewSettingsItems } from './viewSettings.js';
import { renderDatabaseHeader, type IDatabaseIdentity } from './databaseHeader.js';
import { updateDatabaseMeta } from './databaseMeta.js';
import { withDerivedValues } from './rowCompute.js';
import { loadRelatedDatabases, relationConfig, setRelationValue, type IRelatedDatabase } from './relations.js';
import { rollupDisplayProperty, rollupValue } from './rollups.js';
import { showRelationDialog, showRollupDialog } from './relationDialogs.js';
import { showFormulaDialog } from './formulaDialog.js';
import { createRowFromTemplate, createTemplate, defaultTemplateId, listTemplates, removeTemplate, setDefaultTemplate, type ITemplatePages } from './templates.js';
import { formulaResultType, formulaValue, type Ast, FormulaError } from './formula.js';
import { PROPERTY_TYPE_META, STATUS_GROUPS, defaultConfigFor } from '../properties/propertyTypeMeta.js';
import { moveInOrder, patchRecord, readViewConfig, visibleProperties } from './viewConfig.js';
import { PILL_COLORS } from './cellRender.js';
import type { IExtensionMenuItem } from '../../../ui/contextMenu.js';

export { PILL_COLORS };


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
    case 'unique_id':
      return FILTER_OPS.filter((o) => o.op !== 'contains');
    case 'date':
    case 'datetime':
    case 'created_time':
    case 'last_edited_time':
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
    case 'status':
      return FILTER_OPS.filter((o) => o.op !== 'greater_than' && o.op !== 'less_than');
    default:
      return FILTER_OPS;
  }
}

/** A database shown inside a page (the Linked Database block). */
export interface IDatabasePaneEmbedOptions {
  /** The view to show first (the block remembers it). */
  readonly viewId?: string;
  /** A tab was chosen: the block stores it. */
  onViewChange?(viewId: string): void;
}

export interface IDatabasePaneDeps {
  readonly db: DatabaseDataService;
  /** Open a row as a page (canvas editor). */
  openPage(pageId: string): void;
  /** Open a row beside this editor (the view's "side peek"); without it, rows open as pages. */
  openPageBeside?(pageId: string): void;
  /** Rename the database page (title lives on pages). */
  renamePage(pageId: string, title: string): Promise<void>;
  /** The database's page row (cover, lock) and its writer; without them the header shows title and icon only. */
  getPage?(pageId: string): Promise<{ title: string; icon: string | null; coverUrl: string | null; coverYOffset: number; content?: string } | null>;
  updatePage?(pageId: string, patch: { title?: string; icon?: string | null; coverUrl?: string | null; coverYOffset?: number; content?: string }): Promise<void>;
  /** A page under `parentId` that is not a row (a template). */
  createPage?(parentId: string, title: string): Promise<string>;
  /** The page world's changes (an icon set from the sidebar): the header follows. */
  onDidChangePage?(listener: (pageId: string) => void): IDisposable;
  /** The app's confirmation modal, for actions that lose data. */
  confirm?(options: { message: string; detail?: string; confirmLabel?: string; danger?: boolean }): Promise<boolean>;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
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
  /** What the current body render registered (listeners, drags); cleared on each render. */
  private _bodyStore = new DisposableStore();
  private _headerStore = new DisposableStore();
  private _disposed = false;

  private _props: IDatabaseProperty[] = [];
  /** The databases relations point at, with their rows (for titles and rollups). */
  private _related = new Map<string, IRelatedDatabase>();
  private _views: IDatabaseView[] = [];
  private _rows: IDatabaseRow[] = [];
  private _activeViewId: string | null = null;
  private _title = '';
  private _icon: string | null = null;
  private _wantDescription = false;
  private _identity: IDatabaseIdentity = { title: '', icon: null, coverUrl: null, coverYOffset: 0.5, description: null, isLocked: false };

  private readonly _root: HTMLElement;
  private _activePopover: HTMLElement | null = null;

  constructor(
    private readonly _container: HTMLElement,
    private readonly _databaseId: string,
    private readonly _deps: IDatabasePaneDeps,
    private readonly _embed?: IDatabasePaneEmbedOptions,
  ) {
    this._root = el('div', 'canvas-db-pane');
    if (_embed) {
      this._root.classList.add('canvas-db-pane--embedded');
      this._activeViewId = _embed.viewId ?? null;
    }
    this._container.appendChild(this._root);
    this._disposables.add(this._deps.db.onDidChangeStructure((id) => { if (id === this._databaseId) void this._reload(); }));
    this._disposables.add(this._deps.db.onDidChangeRows((id) => { if (id === this._databaseId || this._related.has(id)) void this._reloadRows(); }));
    if (this._deps.onDidChangePage) this._disposables.add(this._deps.onDidChangePage((id) => { if (id === this._databaseId) void this._reload(); }));
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
    const [info, props, views, rows, page] = await Promise.all([
      db.getDatabase(this._databaseId),
      db.listProperties(this._databaseId),
      db.listViews(this._databaseId),
      db.listRows(this._databaseId),
      this._deps.getPage?.(this._databaseId).catch(() => null) ?? Promise.resolve(null),
    ]);
    if (this._disposed || seq !== this._loadSeq) return;
    const related = await loadRelatedDatabases(db, props);
    if (this._disposed || seq !== this._loadSeq) return;
    this._rowsSignature = JSON.stringify(rows);
    this._title = info?.title ?? 'Untitled';
    this._icon = info?.icon ?? null;
    this._identity = { title: this._title, icon: this._icon, coverUrl: page?.coverUrl ?? null, coverYOffset: page?.coverYOffset ?? 0.5, description: info?.description ?? null, isLocked: !!info?.isLocked };
    this._related = related;
    this._props = props;
    this._views = views;
    this._rows = this._derive(rows);
    if (!this._activeViewId || !views.some((v) => v.id === this._activeViewId)) {
      this._activeViewId = views[0]?.id ?? null;
    }
    this._renderWhenIdle('all');
  }

  private async _reloadRows(): Promise<void> {
    const seq = ++this._loadSeq;
    const rows = await this._deps.db.listRows(this._databaseId);
    if (this._disposed || seq !== this._loadSeq) return;
    if (this._related.size > 0) {
      this._related = await loadRelatedDatabases(this._deps.db, this._props);
      if (this._disposed || seq !== this._loadSeq) return;
    }
    // A write that changed nothing shown (the same rows come back) does not
    // rebuild the table.
    const signature = JSON.stringify(rows) + (this._related.size ? JSON.stringify([...this._related.values()].map((r) => [...r.rows.values()])) : '');
    if (signature === this._rowsSignature) return;
    this._rowsSignature = signature;
    this._rows = this._derive(rows);
    this._previews.clear();
    this._renderWhenIdle('body');
  }

  /** Parsed formulas, by expression; cleared when properties change. */
  private readonly _formulaCache = new Map<string, Ast | FormulaError>();

  /** Rows with their computed cells: relations as titles, rollups, created and edited times, formulas. */
  private _derive(rows: IDatabaseRow[]): IDatabaseRow[] {
    const stored = this._props;
    this._formulaCache.clear();
    return withDerivedValues(rows, stored, {
      formula: (prop, row, values) => formulaValue(String(prop.config['expression'] ?? ''), (name) => {
        if (name.toLowerCase() === 'name') return row.title;
        const p = stored.find((x) => x.name.toLowerCase() === name.toLowerCase());
        if (!p) throw new FormulaError(`No property named "${name}"`);
        if (p.id === prop.id) throw new FormulaError('A formula cannot use itself');
        return values[p.id];
      }, this._formulaCache),
      relation: (prop, ids) => {
        const target = this._related.get(relationConfig(prop).databaseId);
        return ids.map((id) => { const r = target?.rows.get(id); return r ? { id, title: r.title || 'Untitled', icon: r.icon } : { id, title: 'Untitled', icon: null }; });
      },
      rollup: (prop, _row, values) => rollupValue(prop, values, stored, this._related),
    });
  }

  /** The properties as the views show them: a rollup or a formula as what it computes (a number, a date, the original type). */
  private get _displayProps(): IDatabaseProperty[] {
    return this._props.map((p) => {
      if (p.type === 'rollup') return { ...rollupDisplayProperty(p, this._props, this._related), sourceType: 'rollup' as const };
      if (p.type === 'formula') return { ...p, type: formulaResultType(this._rows.map((r) => r.values[p.id])), config: {}, sourceType: 'formula' as const };
      return p;
    });
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

    // Header: cover, icon, title, description, the database menu (databaseHeader.ts).
    this._headerStore.dispose();
    this._headerStore = new DisposableStore();
    renderDatabaseHeader(this._root, this._identity, {
      embed: !!this._embed,
      wantDescription: this._wantDescription,
      requestDescription: () => { this._wantDescription = true; this._render(); },
      rename: (title) => { this._title = title; void this._deps.renamePage(this._databaseId, title); },
      setIcon: (icon) => void this._deps.updatePage?.(this._databaseId, { icon }).then(() => this._reload()),
      setCover: (url, y) => void this._deps.updatePage?.(this._databaseId, url === null ? { coverUrl: null } : y === undefined ? { coverUrl: url } : { coverUrl: url, coverYOffset: y }).then(() => this._reload()),
      setDescription: (text) => void updateDatabaseMeta(this._deps.db, this._databaseId, { description: text }),
      setLocked: (locked) => void updateDatabaseMeta(this._deps.db, this._databaseId, { isLocked: locked }),
      openDatabase: () => this._deps.openPage(this._databaseId),
      menuItems: () => this.activeView ? databaseCsvMenuItems<IExtensionMenuItem>(this._deps.db, this._databaseId, this.activeView.id, (label, run) => ({ label, icon: label.startsWith('Export') ? 'download' : 'upload', onSelect: run })) : [],
    }, this._headerStore);
    const locked = this._identity.isLocked;

    // View tabs + toolbar.
    const bar = el('div', 'canvas-db-tabbar');
    const tabs = el('div', 'canvas-db-tabs');
    for (const view of this._views) {
      const tab = el('button', `canvas-db-tab${view.id === this.activeView?.id ? ' canvas-db-tab--active' : ''}`);
      tab.appendChild(createIconElement(VIEW_META[view.type].icon, 14));
      tab.appendChild(el('span', '', view.name));
      tab.addEventListener('click', () => { this._activeViewId = view.id; this._embed?.onViewChange?.(view.id); this._render(); });
      tab.addEventListener('contextmenu', (e) => { e.preventDefault(); this._openViewMenu(tab, view); });
      tabs.appendChild(tab);
    }
    if (!locked) {
      const addView = createIconButton(null, { id: 'database.addView', icon: 'plus', title: 'Add a View…', size: 'sm', onClick: () => this._openAddViewMenu(addView) });
      addView.classList.add('canvas-db-tab--add');
      tabs.appendChild(addView);
    }
    bar.appendChild(tabs);

    const toolbar = el('div', 'canvas-db-toolbar');
    const filterBtn = createButton(null, { id: 'database.filter', label: 'Filter', kind: 'ghost', size: 'sm', icon: 'filter', onClick: () => this._openFilterPopover(filterBtn) });
    const sortBtn = createButton(null, { id: 'database.sort', label: 'Sort', kind: 'ghost', size: 'sm', icon: 'arrow-up-down', onClick: () => this._openSortPopover(sortBtn) });
    const settingsBtn = createIconButton(null, { id: 'database.viewSettings', icon: 'more-horizontal', title: 'View Settings…', size: 'sm', onClick: () => this._openViewSettings(settingsBtn) });
    const newBtn = createButton(null, { id: 'database.newRow', label: 'New', kind: 'primary', size: 'sm', icon: 'plus', onClick: () => void this._addRow() });
    newBtn.classList.add('canvas-db-newbtn');
    toolbar.append(filterBtn, sortBtn, settingsBtn, newBtn);
    if (this._templatePages() && !locked) {
      const tplBtn = createIconButton(null, { id: 'database.templates', icon: 'chevron-down', title: 'Templates…', size: 'sm', onClick: () => void this._openTemplatesMenu(tplBtn) });
      tplBtn.classList.add('canvas-db-newbtn__more');
      toolbar.appendChild(tplBtn);
    }
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
        x.setAttribute('aria-label', 'Remove filter');
        x.addEventListener('click', () => void this._updateActiveView({ filter: { ...view.filter, rules: view.filter.rules.filter((_, j) => j !== i) } }));
        chip.appendChild(x);
        chips.appendChild(chip);
      }
      for (const [i, rule] of view.sort.entries()) {
        const chip = el('span', 'canvas-db-chip canvas-db-chip--sort');
        chip.textContent = `↕ ${this._propName(rule.propertyId)} ${rule.dir === 'asc' ? '↑' : '↓'}`;
        const x = el('button', 'canvas-db-chip__x', '×');
        x.setAttribute('aria-label', 'Remove sort');
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
    return visibleProperties(this._props, view);
  }

  private _viewRows(view: IDatabaseView): IDatabaseRow[] {
    return applySort(applyFilter(this._rows, view.filter, (id) => this._props.find((p) => p.id === id)?.type), view.sort);
  }

  private _renderBody(): void {
    const body = this._root.querySelector('.canvas-db-body');
    const view = this.activeView;
    if (!body || !view) return;
    this._bodyStore.dispose();
    this._bodyStore = new DisposableStore();
    body.textContent = '';
    const state = { view, props: this._displayProps, rows: this._viewRows(view), locked: this._identity.isLocked };
    const host = body as HTMLElement;
    switch (view.type) {
      case 'board': renderBoardView(host, state, this._viewDeps(), this._bodyStore); break;
      case 'list': renderListView(host, state, this._viewDeps(), this._bodyStore); break;
      case 'gallery': renderGalleryView(host, state, this._viewDeps(), this._bodyStore); break;
      case 'calendar': renderCalendarView(host, state, this._viewDeps(), this._bodyStore); break;
      case 'timeline': renderTimelineView(host, state, this._viewDeps(), this._bodyStore); break;
      case 'chart': renderChartView(host, state, this._viewDeps(), this._bodyStore); break;
      default: renderTableView(host, state, this._tableDeps(), this._bodyStore);
    }
  }

  /** A page's first picture, once per page per pane. */
  private readonly _previews = new Map<string, Promise<string | null>>();
  private _pagePreview(pageId: string): Promise<string | null> {
    let p = this._previews.get(pageId);
    if (!p) {
      p = this._deps.getPage ? this._deps.getPage(pageId).then((page) => firstImageSrc(page?.content ?? null)).catch(() => null) : Promise.resolve(null);
      this._previews.set(pageId, p);
    }
    return p;
  }

  private _viewDeps(): IViewDeps {
    const t = this._tableDeps();
    return {
      setCell: t.setCell, openRow: t.openRow, updateView: (patch) => this._updateActiveView(patch), openRowMenu: t.openRowMenu, rowIcon: t.rowIcon,
      addRow: (seed) => this._addRow(seed),
      pagePreview: (id) => this._pagePreview(id),
    };
  }

  /** How a row opens from the active view: beside the table (side peek) or as a page. */
  private _openRow(pageId: string): void {
    const view = this.activeView;
    const beside = view ? readViewConfig(view.config).openIn === 'side' : false;
    if (beside && this._deps.openPageBeside) this._deps.openPageBeside(pageId);
    else this._deps.openPage(pageId);
  }

  private _tableDeps(): ITableViewDeps {
    return {
      setCell: (pageId, propertyId, value) => this._setCell(pageId, propertyId, value),
      renameRow: (pageId, title) => this._deps.db.renameRow(this._databaseId, pageId, title),
      openRow: (pageId) => this._openRow(pageId),
      addRow: () => this._addRow(),
      updateView: (patch) => this._updateActiveView(patch),
      openHeaderMenu: (anchor, prop) => (prop ? this._openHeaderMenu(anchor, prop, this.activeView!) : this._openTitleMenu(anchor, this.activeView!)),
      openAddProperty: (anchor) => this._openAddPropertyPopover(anchor),
      openRowMenu: (e, row) => this._openRowMenu(e, row),
      openCalcMenu: (anchor, key, type) => this._openCalcMenu(anchor, key, type),
      editorFor: (prop, value, onChange) => createPropertyEditor(asDefinition(prop), value, onChange, { relations: this._relationHost() }),
      rowIcon: (icon) => { if (!icon) return null; const id = resolvePageIcon(icon); return id ? createIconElement(id, 16) : null; },
      openOptionMenu: (anchor, prop, value) => this._openOptionColorMenu(anchor, prop, value),
    };
  }

  /** Store a cell; a relation keeps its mirror true. A refused value comes back and the reason is logged. */
  private _setCell(pageId: string, propertyId: string, value: unknown): Promise<void> {
    const prop = this._props.find((p) => p.id === propertyId);
    const write = prop?.type === 'relation'
      ? setRelationValue(this._deps.db, this._databaseId, pageId, prop, value)
      : this._deps.db.setCellValue(this._databaseId, pageId, propertyId, value);
    return write.catch((err) => { console.warn('[Database] cell not set:', err instanceof Error ? err.message : err); this._renderBody(); });
  }

  /** What a relation editor needs from the pane. */
  private _relationHost(): NonNullable<Parameters<typeof createPropertyEditor>[3]>['relations'] {
    return {
      listRows: async (databaseId) => (await this._deps.db.listRows(databaseId)).map((r) => ({ pageId: r.pageId, title: r.title, icon: r.icon })),
      createRow: async (databaseId, title) => (await this._deps.db.addRow(databaseId, title)).pageId,
      openPage: (id) => this._deps.openPage(id),
    };
  }

  /** An option's colour, changed from a cell that shows it (Notion lets you, from the pill's menu). */
  private _openOptionColorMenu(anchor: HTMLElement, prop: IDatabaseProperty, value: string): void {
    const options = ((prop.config as { options?: { value: string; color: string; group?: string }[] }).options ?? []);
    const current = options.find((o) => o.value === value)?.color ?? 'default';
    const items: IExtensionMenuItem[] = PILL_COLORS.filter((c) => c !== 'gray').map((c) => ({
      label: c === 'default' ? 'Default' : c.charAt(0).toUpperCase() + c.slice(1), checked: c === current,
      onSelect: () => void this._deps.db.setOptions(this._databaseId, prop.id, options.map((o) => (o.value === value ? { ...o, color: c } : o))),
    }));
    this._menu(anchor, `Colour of ${value}`, [{ label: value, disabled: true }, { separator: true }, ...items]);
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  /** A new row starts with what the view's filter asks for (so it stays in
   *  view) plus `seedValues` (a board column's value), in one write. */
  private async _addRow(seedValues: Record<string, unknown> = {}, templateId?: string | null): Promise<void> {
    const seed = seedForFilter(this.activeView?.filter, (id) => this._props.find((p) => p.id === id)?.type);
    try {
      const pages = this._templatePages();
      const template = templateId === undefined && pages ? await defaultTemplateId(this._deps.db, pages, this._databaseId) : templateId;
      if (template && pages) await createRowFromTemplate(this._deps.db, pages, this._databaseId, template, { ...seed.values, ...seedValues }, seed.title);
      else await this._deps.db.addRow(this._databaseId, seed.title, { ...seed.values, ...seedValues });
    } catch (err) {
      console.error('[Database] Add row failed:', err);
    }
  }

  /** The page reader and writer templates need; null when the host gave none. */
  private _templatePages(): ITemplatePages | null {
    const { getPage, updatePage, createPage } = this._deps;
    return getPage && updatePage && createPage ? { getPage, updatePage, createPage } : null;
  }

  /** The menu beside New: each template, a blank row, and the templates' upkeep. */
  private async _openTemplatesMenu(anchor: HTMLElement): Promise<void> {
    const pages = this._templatePages();
    if (!pages) return;
    const templates = await listTemplates(this._deps.db, pages, this._databaseId);
    const items: IExtensionMenuItem[] = [
      ...templates.map((t) => ({ label: t.title, icon: 'file', checked: t.isDefault, tooltip: t.isDefault ? 'The default: what New makes' : undefined, onSelect: () => void this._addRow({}, t.id) })),
      { label: 'Blank Row', icon: 'plus', onSelect: () => void this._addRow({}, null) },
      { separator: true },
      { label: 'New Template…', icon: 'copy', onSelect: () => void createTemplate(this._deps.db, pages, this._databaseId).then((id) => this._deps.openPage(id)) },
    ];
    if (templates.length) {
      items.push(
        { label: 'Default Template', icon: 'check', submenu: [
          { label: 'Blank', checked: !templates.some((t) => t.isDefault), onSelect: () => void setDefaultTemplate(this._deps.db, this._databaseId, null) },
          ...templates.map((t) => ({ label: t.title, checked: t.isDefault, onSelect: () => void setDefaultTemplate(this._deps.db, this._databaseId, t.id) })),
        ] },
        { label: 'Edit Template', icon: 'pencil', submenu: templates.map((t) => ({ label: t.title, onSelect: () => this._deps.openPage(t.id) })) },
        { label: 'Remove Template', icon: 'trash-2', submenu: templates.map((t) => ({ label: t.title, danger: true, onSelect: () => void removeTemplate(this._deps.db, this._databaseId, t.id) })) },
      );
    }
    this._menu(anchor, 'Templates', items);
  }

  private async _updateActiveView(patch: Parameters<DatabaseDataService['updateView']>[2]): Promise<void> {
    const view = this.activeView;
    if (!view) return;
    await this._deps.db.updateView(this._databaseId, view.id, patch);
  }

  private _patchConfig(patch: Record<string, unknown>): Promise<void> {
    const view = this.activeView;
    return view ? this._updateActiveView({ config: { ...view.config, ...patch } }) : Promise.resolve();
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
    // The popup contract (mode subsystem): a hand-rolled listener leaked on
    // close and shut the NEXT popover on its first click.
    const detach = attachPopupDismiss(pop, () => this._closePopover());
    this._popoverDisposables.push({ dispose: detach });
  }

  private _menuItem(label: string, onClick: () => void, danger = false): HTMLElement {
    const item = el('button', `canvas-db-menuitem${danger ? ' canvas-db-menuitem--danger' : ''}`, label);
    item.addEventListener('click', () => { this._closePopover(); onClick(); });
    return item;
  }

  /** The kit's menu, anchored below `anchor`. */
  private _menu(anchor: HTMLElement, label: string, items: readonly IExtensionMenuItem[]): void {
    this._closePopover();
    createMenu(anchor, { id: null, label, items });
  }

  /** The items a column shares with the Name column: wrap, freeze, sort. */
  private _columnItems(key: string, view: IDatabaseView): IExtensionMenuItem[] {
    const cfg = readViewConfig(view.config);
    const frozen = cfg.freeze === key;
    return [
      { label: 'Sort Ascending', icon: 'arrow-up', onSelect: () => void this._updateActiveView({ sort: [{ propertyId: key, dir: 'asc' }] }) },
      { label: 'Sort Descending', icon: 'arrow-down', onSelect: () => void this._updateActiveView({ sort: [{ propertyId: key, dir: 'desc' }] }) },
      { separator: true },
      { label: 'Wrap Text', icon: 'rows', checked: !!cfg.wrap[key], onSelect: () => void this._updateActiveView({ config: patchRecord(view.config, 'wrap', key, cfg.wrap[key] ? null : true) }) },
      { label: frozen ? 'Unfreeze Columns' : 'Freeze Up to This Column', icon: 'pin', onSelect: () => void this._patchConfig({ freeze: frozen ? null : key }) },
    ];
  }

  private _openTitleMenu(anchor: HTMLElement, view: IDatabaseView): void {
    this._menu(anchor, 'Name column', this._columnItems(TITLE_KEY, view));
  }

  private _openHeaderMenu(th: HTMLElement, prop: IDatabaseProperty, view: IDatabaseView): void {
    // Locked: the column's name, options and existence are fixed; its view settings are not.
    if (this._identity.isLocked) { this._menu(th, prop.name, this._columnItems(prop.id, view)); return; }
    this._openPopover(th, (pop) => {
      const rename = el('input', 'canvas-db-popover__input') as HTMLInputElement;
      rename.value = prop.name;
      rename.setAttribute('aria-label', 'Property name');
      rename.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const name = rename.value.trim();
          this._closePopover();
          if (name && name !== prop.name) void this._deps.db.updateProperty(this._databaseId, prop.id, { name });
        }
      });
      pop.appendChild(rename);
      const cfg = readViewConfig(view.config);
      const ordered = this._visibleProps(view).map((p) => p.id);
      const at = ordered.indexOf(prop.id);
      pop.appendChild(this._menuItem('Sort ascending', () => void this._updateActiveView({ sort: [{ propertyId: prop.id, dir: 'asc' }] })));
      pop.appendChild(this._menuItem('Sort descending', () => void this._updateActiveView({ sort: [{ propertyId: prop.id, dir: 'desc' }] })));
      pop.appendChild(this._menuItem(cfg.wrap[prop.id] ? 'Clip text' : 'Wrap text', () => void this._updateActiveView({ config: patchRecord(view.config, 'wrap', prop.id, cfg.wrap[prop.id] ? null : true) })));
      pop.appendChild(this._menuItem(cfg.freeze === prop.id ? 'Unfreeze columns' : 'Freeze up to this column', () => void this._patchConfig({ freeze: cfg.freeze === prop.id ? null : prop.id })));
      if (at > 0) pop.appendChild(this._menuItem('Move left', () => void this._patchConfig({ order: moveInOrder(this._props, view, prop.id, -1) })));
      if (at >= 0 && at < ordered.length - 1) pop.appendChild(this._menuItem('Move right', () => void this._patchConfig({ order: moveInOrder(this._props, view, prop.id, 1) })));
      pop.appendChild(this._menuItem('Hide in view', () => {
        const hidden = [...cfg.hidden, prop.id];
        void this._patchConfig({ hidden });
      }));
      if (prop.type === 'select' || prop.type === 'tags' || prop.type === 'status') {
        pop.appendChild(this._menuItem('Edit options…', () => this._openOptionsEditor(th, prop)));
      }
      const stored = this._props.find((p) => p.id === prop.id) ?? prop;
      if (stored.type === 'rollup') pop.appendChild(this._menuItem('Edit rollup…', () => void showRollupDialog(th, this._deps.db, this._databaseId, this._props, stored, () => {})));
      if (stored.type === 'formula') pop.appendChild(this._menuItem('Edit formula…', () => void showFormulaDialog(th, this._deps.db, this._databaseId, this._props, this._rows[0] ?? null, stored, () => {})));
      if (stored.type === 'relation') {
        const target = this._related.get(relationConfig(stored).databaseId);
        if (target) pop.appendChild(this._menuItem(`Open ${target.title}`, () => this._deps.openPage(target.id)));
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

  /** The calculation under a column. */
  private _openCalcMenu(anchor: HTMLElement, key: string, type: PropertyType | 'title'): void {
    const view = this.activeView;
    if (view) this._menu(anchor, 'Calculate', calcMenuItems(view, key, type, (config) => void this._updateActiveView({ config })));
  }

  /** The view's settings (viewSettings.ts). */
  private _openViewSettings(anchor: HTMLElement): void {
    const view = this.activeView;
    if (!view) return;
    this._menu(anchor, 'View settings', viewSettingsItems({
      view, props: this._props, viewCount: this._views.length, db: this._deps.db, databaseId: this._databaseId,
      updateView: (patch) => this._updateActiveView(patch), patchConfig: (patch) => this._patchConfig(patch),
      renameView: () => this._openViewMenu(anchor, view), deleteView: () => void this._deps.db.deleteView(this._databaseId, view.id),
    }));
  }

  private _openOptionsEditor(anchor: HTMLElement, prop: IDatabaseProperty): void {
    this._openPopover(anchor, (pop) => {
      // `orig` is the option's stored name: renaming one renames it in every
      // cell that holds it (DatabaseDataService.setOptions).
      const options = ((((prop.config as { options?: { value: string; color: string; group?: string }[] }).options) ?? []))
        .map((o) => ({ value: o.value, color: o.color, group: o.group, orig: o.value as string | undefined }));
      const isStatus = prop.type === 'status';
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
          if (isStatus) {
            // A status option belongs to a group: To-do, In progress or Complete. The button cycles it.
            const groupBtn = el('button', 'canvas-db-options__group', STATUS_GROUPS.find((g) => g.id === opt.group)?.label ?? 'To-do');
            groupBtn.title = 'Change group';
            groupBtn.addEventListener('click', () => {
              const at = STATUS_GROUPS.findIndex((g) => g.id === (opt.group ?? 'todo'));
              options[i] = { ...options[i]!, group: STATUS_GROUPS[(at + 1) % STATUS_GROUPS.length]!.id };
              renderList();
            });
            rowEl.appendChild(groupBtn);
          }
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
      add.setAttribute('aria-label', 'New option');
      add.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && add.value.trim()) {
          options.push({ value: add.value.trim(), color: PILL_COLORS[(options.length + 1) % PILL_COLORS.length], group: isStatus ? 'todo' : undefined, orig: undefined });
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
        const next = options.map(({ value, color, group }) => (isStatus ? { value: value.trim(), color, group: group ?? 'todo' } : { value: value.trim(), color }));
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
      name.setAttribute('aria-label', 'Property name');
      pop.appendChild(name);
      const list = el('div', 'canvas-db-typelist');
      let group: string | null = null;
      for (const { type, label, group: g } of PROPERTY_TYPE_META) {

        if (g !== group) { group = g; list.appendChild(el('div', 'canvas-db-popover__label', g === 'basic' ? 'Basic' : 'Advanced')); }
        const item = el('button', 'canvas-db-menuitem');
        item.appendChild(createTypeIconElement(type, 14));
        item.appendChild(el('span', '', label));
        item.addEventListener('click', () => {
          const propName = name.value.trim() || label;
          this._closePopover();
          // The + cell may have been rebuilt since the popover opened: anchor the dialog to the live one.
          const live = (): HTMLElement => this._root.querySelector<HTMLElement>('[data-px-id="database.addProperty"]') ?? anchor;
          if (type === 'relation') { void showRelationDialog(live(), this._deps.db, this._databaseId, () => {}); return; }
          if (type === 'rollup') { void showRollupDialog(live(), this._deps.db, this._databaseId, this._props, null, () => {}); return; }
          if (type === 'formula') { void showFormulaDialog(live(), this._deps.db, this._databaseId, this._props, this._rows[0] ?? null, null, () => {}); return; }
          void this._deps.db.addProperty(this._databaseId, propName, type, defaultConfigFor(type));
        });
        list.appendChild(item);
      }
      pop.appendChild(list);
      setTimeout(() => name.focus(), 0);
    });
  }

  private _openAddViewMenu(anchor: HTMLElement): void {
    const mk = (label: string, icon: string, type: DatabaseViewType): IExtensionMenuItem => ({ label, icon, onSelect: async () => {
      const v = await this._deps.db.addView(this._databaseId, label, type);
      this._activeViewId = v.id;
    } });
    this._menu(anchor, 'Add a view', DATABASE_VIEW_TYPES.map((t) => mk(VIEW_META[t].label, VIEW_META[t].icon, t)));
  }

  private _openViewMenu(anchor: HTMLElement, view: IDatabaseView): void {
    this._openPopover(anchor, (pop) => {
      const rename = el('input', 'canvas-db-popover__input') as HTMLInputElement;
      rename.value = view.name;
      rename.setAttribute('aria-label', 'View name');
      rename.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const name = rename.value.trim();
          this._closePopover();
          if (name) void this._deps.db.updateView(this._databaseId, view.id, { name });
        }
      });
      pop.appendChild(rename);
      if (view.type === 'board') {
        for (const p of this._props.filter((p) => p.type === 'select' || p.type === 'tags' || p.type === 'status')) {
          pop.appendChild(this._menuItem(`Group by ${p.name}`, () => void this._deps.db.updateView(this._databaseId, view.id, { groupBy: p.id })));
        }
      }
      const hidden = readViewConfig(view.config).hidden; // hidden properties can be shown again
      for (const id of hidden) {
        pop.appendChild(this._menuItem(`Show "${this._propName(id)}"`, () => {
          void this._deps.db.updateView(this._databaseId, view.id, { config: { ...view.config, hidden: hidden.filter((h) => h !== id) } });
        }));
      }
      pop.append(...databaseCsvMenuItems(this._deps.db, this._databaseId, view.id, (label, run) => this._menuItem(label, run)));
      if (this._views.length > 1) {
        pop.appendChild(this._menuItem('Delete view', () => void this._deps.db.deleteView(this._databaseId, view.id), true));
      }
      setTimeout(() => rename.focus(), 0);
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
      const apply = el('button', 'canvas-db-popover__primary', 'Add Sort');
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
    this._closePopover();
    createMenu(new DOMRect(e.clientX, e.clientY, 0, 0), { id: null, label: 'Row', items: [
      { label: 'Open', icon: 'maximize', onSelect: () => this._openRow(row.pageId) },
      { label: 'Open as Page', icon: 'file', onSelect: () => this._deps.openPage(row.pageId) },
      { separator: true },
      { label: 'Delete Row…', icon: 'trash-2', danger: true, onSelect: () => void this._deleteRow(row) },
    ] });
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._closePopover();
    this._bodyStore.dispose();
    this._headerStore.dispose();
    this._disposables.dispose();
    this._root.remove();
  }
}
