// listView.ts — Minimal vertical list view for databases
//
// Renders one row per database page in a compact vertical list.
// Each row shows the title plus 2–3 configurable preview properties inline.
// Click a row to open the page. Supports grouping, filtering, and sorting
// through the shared view data pipeline.
//
// Dependencies: platform/ (lifecycle), ui/ (dom),
// databaseRegistry (single gate for all database imports)

import { Disposable, DisposableStore } from '../../../../platform/lifecycle.js';
import { $, addDisposableListener, clearNode } from '../../../../ui/dom.js';
import {
  renderPropertyValue,
  type IDatabaseDataService,
  type IDatabaseView,
  type IDatabaseProperty,
  type IDatabaseRow,
  type IRowGroup,
} from '../databaseRegistry.js';
import type { OpenEditorFn } from '../databaseRegistry.js';

// ─── ListView ────────────────────────────────────────────────────────────────

export class ListView extends Disposable {
  private readonly _listEl: HTMLElement;
  private readonly _renderDisposables = this._register(new DisposableStore());

  private _properties: IDatabaseProperty[];
  private _rows: IDatabaseRow[];
  private _groups: IRowGroup[];
  private readonly _collapsedGroups = new Set<string>();

  constructor(
    container: HTMLElement,
    private readonly _dataService: IDatabaseDataService,
    private readonly _databaseId: string,
    _view: IDatabaseView,
    properties: IDatabaseProperty[],
    rows: IDatabaseRow[],
    private readonly _openEditor: OpenEditorFn | undefined,
    groups?: IRowGroup[],
  ) {
    super();

    this._properties = properties;
    this._rows = rows;
    this._groups = groups ?? [{ key: '__all__', label: 'All', rows }];

    this._listEl = $('div.db-list');
    container.appendChild(this._listEl);

    this._render();
  }

  // ─── Public API ──────────────────────────────────────────────────────

  setRows(rows: IDatabaseRow[], groups?: IRowGroup[]): void {
    this._rows = rows;
    this._groups = groups ?? [{ key: '__all__', label: 'All', rows }];
    this._render();
  }

  setProperties(properties: IDatabaseProperty[]): void {
    this._properties = properties;
    this._render();
  }

  // ─── Render ──────────────────────────────────────────────────────────

  private _render(): void {
    this._renderDisposables.clear();
    clearNode(this._listEl);

    const hasGroups = this._groups.length > 1 ||
      (this._groups.length === 1 && this._groups[0].key !== '__all__');

    if (hasGroups) {
      for (const group of this._groups) {
        this._renderGroup(group);
      }
    } else {
      const allRows = this._groups.length > 0 ? this._groups[0].rows : this._rows;
      for (const row of allRows) {
        this._renderRow(row, this._listEl);
      }
    }

    // Footer — add row
    this._renderFooter();
  }

  private _renderGroup(group: IRowGroup): void {
    const groupEl = $('div.db-list-group');
    this._listEl.appendChild(groupEl);

    const isCollapsed = this._collapsedGroups.has(group.key);

    // Group header
    const headerEl = $('div.db-list-group-header');
    groupEl.appendChild(headerEl);

    const toggleEl = $('span.db-list-group-toggle');
    toggleEl.textContent = isCollapsed ? '▸' : '▾';
    headerEl.appendChild(toggleEl);

    const labelEl = $('span.db-list-group-label');
    labelEl.textContent = group.label || 'No value';
    headerEl.appendChild(labelEl);

    const countEl = $('span.db-list-group-count');
    countEl.textContent = `${group.rows.length}`;
    headerEl.appendChild(countEl);

    this._renderDisposables.add(
      addDisposableListener(headerEl, 'click', () => {
        if (this._collapsedGroups.has(group.key)) {
          this._collapsedGroups.delete(group.key);
        } else {
          this._collapsedGroups.add(group.key);
        }
        this._render();
      }),
    );

    // Group rows
    if (!isCollapsed) {
      const rowsContainer = $('div.db-list-group-rows');
      groupEl.appendChild(rowsContainer);

      for (const row of group.rows) {
        this._renderRow(row, rowsContainer);
      }

      // Sub-groups
      if (group.subGroups) {
        for (const sub of group.subGroups) {
          this._renderSubGroup(sub, rowsContainer);
        }
      }
    }
  }

  private _renderSubGroup(group: IRowGroup, parent: HTMLElement): void {
    const subEl = $('div.db-list-subgroup');
    parent.appendChild(subEl);

    const isCollapsed = this._collapsedGroups.has(`sub:${group.key}`);

    const headerEl = $('div.db-list-subgroup-header');
    subEl.appendChild(headerEl);

    const toggleEl = $('span.db-list-group-toggle');
    toggleEl.textContent = isCollapsed ? '▸' : '▾';
    headerEl.appendChild(toggleEl);

    const labelEl = $('span.db-list-group-label');
    labelEl.textContent = group.label || 'No value';
    headerEl.appendChild(labelEl);

    const countEl = $('span.db-list-group-count');
    countEl.textContent = `${group.rows.length}`;
    headerEl.appendChild(countEl);

    this._renderDisposables.add(
      addDisposableListener(headerEl, 'click', () => {
        const key = `sub:${group.key}`;
        if (this._collapsedGroups.has(key)) {
          this._collapsedGroups.delete(key);
        } else {
          this._collapsedGroups.add(key);
        }
        this._render();
      }),
    );

    if (!isCollapsed) {
      for (const row of group.rows) {
        this._renderRow(row, subEl);
      }
    }
  }

  private _renderRow(row: IDatabaseRow, parent: HTMLElement): void {
    const rowEl = $('div.db-list-row');
    parent.appendChild(rowEl);

    // Title
    const titleEl = $('div.db-list-row-title');
    titleEl.textContent = row.page.title || 'Untitled';
    rowEl.appendChild(titleEl);

    // Preview properties (first 3 non-title visible properties)
    const previewProps = this._getPreviewProperties();
    if (previewProps.length > 0) {
      const propsEl = $('div.db-list-row-props');
      rowEl.appendChild(propsEl);

      for (const prop of previewProps) {
        const propEl = $('div.db-list-row-prop');
        propsEl.appendChild(propEl);

        const labelEl = $('span.db-list-row-prop-label');
        labelEl.textContent = prop.name;
        propEl.appendChild(labelEl);

        const valueEl = $('span.db-list-row-prop-value');
        propEl.appendChild(valueEl);

        const value = row.values[prop.id];
        renderPropertyValue(prop.type, value, prop.config, valueEl);
      }
    }

    // Click to open page
    this._renderDisposables.add(
      addDisposableListener(rowEl, 'click', () => {
        this._openEditor?.({
          typeId: 'canvas',
          title: row.page.title || 'Untitled',
          icon: row.page.icon ?? undefined,
          instanceId: row.page.id,
        });
      }),
    );
  }

  private _renderFooter(): void {
    const footerEl = $('div.db-list-footer');
    this._listEl.appendChild(footerEl);

    const addBtn = $('button.db-list-add-row');
    addBtn.textContent = '+ New';
    footerEl.appendChild(addBtn);

    this._renderDisposables.add(
      addDisposableListener(addBtn, 'click', async () => {
        try {
          await this._dataService.addRow(this._databaseId);
        } catch (err) {
          console.error('[ListView] Failed to add row:', err);
        }
      }),
    );
  }

  // ─── Helpers ─────────────────────────────────────────────────────────

  private _getPreviewProperties(): IDatabaseProperty[] {
    return this._properties
      .filter(p => p.type !== 'title')
      .slice(0, 3);
  }

  // ─── Dispose ─────────────────────────────────────────────────────────

  override dispose(): void {
    this._renderDisposables.clear();
    this._listEl.remove();
    super.dispose();
  }
}
