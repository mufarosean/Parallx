// tableView.ts — Database table view renderer
//
// Renders a spreadsheet-like table for a database view. Renders header row
// with property names and type indicators, data rows with cell values,
// column resize handles, and a "+ New" button at the bottom.
//
// Dependencies: platform/ (lifecycle, events), ui/ (dom),
// databaseRegistry (single gate for all database imports)

import { Disposable, DisposableStore } from '../../../../platform/lifecycle.js';
import { $, addDisposableListener, clearNode } from '../../../../ui/dom.js';
import { IconPicker } from '../../../../ui/iconPicker.js';
import {
  renderPropertyValue,
  createPropertyEditor,
  showPropertyAddMenu,
  showPropertyHeaderMenu,
  startPropertyRename,
  PROPERTY_TYPE_ICONS,
  PAGE_SELECTABLE_ICONS,
  resolvePageIcon,
  svgIcon,
  type IDatabaseDataService,
  type IDatabaseView,
  type IDatabaseProperty,
  type IDatabaseRow,
  type IPropertyValue,
  type IRowGroup,
  type ISortRule,
} from '../databaseRegistry.js';
import type { OpenEditorFn } from '../databaseRegistry.js';

// ─── TableView ───────────────────────────────────────────────────────────────

export class TableView extends Disposable {
  private readonly _tableEl: HTMLElement;
  private readonly _headerRow: HTMLElement;
  private readonly _bodyEl: HTMLElement;
  private readonly _footerEl: HTMLElement;

  private _properties: IDatabaseProperty[];
  private _rows: IDatabaseRow[];
  private _groups: IRowGroup[];
  private _columnWidths: Record<string, number>;
  private readonly _collapsedGroups = new Set<string>();

  // ── Active cell editor ──
  private readonly _editorDisposables = this._register(new DisposableStore());
  private _iconPicker: IconPicker | null = null;

  // ── Per-render disposables (cleared on each re-render to prevent leak) ──
  private readonly _renderDisposables = this._register(new DisposableStore());

  constructor(
    container: HTMLElement,
    private readonly _dataService: IDatabaseDataService,
    private readonly _databaseId: string,
    private readonly _view: IDatabaseView,
    properties: IDatabaseProperty[],
    rows: IDatabaseRow[],
    private readonly _openEditor: OpenEditorFn | undefined,
    groups?: IRowGroup[],
  ) {
    super();

    this._properties = properties;
    this._rows = rows;
    this._groups = groups ?? [{ key: '__all__', label: 'All', rows }];
    this._columnWidths = { ...(this._view.config.columnWidths ?? {}) };

    // Build table structure
    this._tableEl = $('div.db-table');
    container.appendChild(this._tableEl);

    this._headerRow = $('div.db-table-header');
    this._tableEl.appendChild(this._headerRow);

    this._bodyEl = $('div.db-table-body');
    this._tableEl.appendChild(this._bodyEl);

    this._footerEl = $('div.db-table-footer');
    this._tableEl.appendChild(this._footerEl);

    this._render();
  }

  // ─── Public API ──────────────────────────────────────────────────────

  /** Update rows without full re-render. */
  setRows(rows: IDatabaseRow[], groups?: IRowGroup[]): void {
    this._rows = rows;
    this._groups = groups ?? [{ key: '__all__', label: 'All', rows }];
    this._renderDisposables.clear();
    this._renderHeader();
    this._renderBody();
    this._renderFooter();
  }

  /** Update properties and re-render everything. */
  setProperties(properties: IDatabaseProperty[]): void {
    this._properties = properties;
    this._render();
  }

  // ─── Rendering ───────────────────────────────────────────────────────

  private _render(): void {
    this._renderDisposables.clear();
    this._renderHeader();
    this._renderBody();
    this._renderFooter();
  }

  private _renderHeader(): void {
    clearNode(this._headerRow);

    // Column grid template
    this._updateGridTemplate();

    for (const prop of this._properties) {
      const cell = $('div.db-table-header-cell');
      cell.dataset.propertyId = prop.id;

      // Type icon
      const icon = $('span.db-table-header-icon');
      icon.textContent = PROPERTY_TYPE_ICONS[prop.type] ?? '·';
      cell.appendChild(icon);

      // Name label
      const label = $('span.db-table-header-label');
      label.textContent = prop.type === 'title' && prop.name === 'Title' ? 'Name' : prop.name;
      cell.appendChild(label);

      // Sort indicator arrow (if this property has an active sort rule)
      const sortRule = this._getSortForProperty(prop.id);
      if (sortRule) {
        const arrow = $('span.db-table-sort-arrow');
        arrow.textContent = sortRule.direction === 'ascending' ? ' ↑' : ' ↓';
        cell.appendChild(arrow);
      }

      // Double-click → inline rename
      this._renderDisposables.add(addDisposableListener(cell, 'dblclick', () => {
        startPropertyRename(cell, prop, this._dataService, this._databaseId);
      }));

      // Right-click → property context menu
      this._renderDisposables.add(addDisposableListener(cell, 'contextmenu', (e: MouseEvent) => {
        showPropertyHeaderMenu(e, prop, this._dataService, this._databaseId, () => {
          startPropertyRename(cell, prop, this._dataService, this._databaseId);
        });
      }));

      // Column resize handle
      const resizeHandle = $('div.db-table-resize-handle');
      this._setupColumnResize(resizeHandle, prop.id);
      cell.appendChild(resizeHandle);

      this._headerRow.appendChild(cell);
    }

    // "+ Add property" add-column button
    const addCol = $('div.db-table-header-add');
    addCol.textContent = '+ Add property';
    addCol.title = 'Add a property';
    this._renderDisposables.add(addDisposableListener(addCol, 'click', () => {
      showPropertyAddMenu(addCol, this._dataService, this._databaseId);
    }));
    this._headerRow.appendChild(addCol);
  }

  private _renderBody(): void {
    clearNode(this._bodyEl);

    const hasGrouping = this._groups.length > 0
      && !(this._groups.length === 1 && this._groups[0].key === '__all__');

    if (hasGrouping) {
      for (const group of this._groups) {
        this._renderGroup(group);
      }
    } else {
      // No grouping — render all rows flat
      const allRows = this._groups.length > 0 ? this._groups[0].rows : this._rows;
      for (const row of allRows) {
        this._renderRow(row);
      }
    }
  }

  private _renderGroup(group: IRowGroup): void {
    const collapsed = this._collapsedGroups.has(group.key);

    // Group header
    const headerEl = $('div.db-table-group-header');
    const template = this._headerRow.style.gridTemplateColumns;
    headerEl.style.gridTemplateColumns = template;

    const toggleCell = $('div.db-table-group-toggle');
    toggleCell.style.gridColumn = `1 / -1`;

    const arrow = $('span.db-table-group-arrow');
    arrow.textContent = collapsed ? '▸' : '▾';
    toggleCell.appendChild(arrow);

    const label = $('span.db-table-group-label');
    if (group.color) {
      const dot = $('span.db-table-group-dot');
      dot.classList.add(`db-cell-pill--${group.color}`);
      label.appendChild(dot);
    }
    const labelText = document.createTextNode(`${group.label} (${group.rows.length})`);
    label.appendChild(labelText);
    toggleCell.appendChild(label);

    this._renderDisposables.add(addDisposableListener(toggleCell, 'click', () => {
      if (this._collapsedGroups.has(group.key)) {
        this._collapsedGroups.delete(group.key);
      } else {
        this._collapsedGroups.add(group.key);
      }
      this._renderBody();
    }));

    headerEl.appendChild(toggleCell);
    this._bodyEl.appendChild(headerEl);

    // Render rows if not collapsed
    if (!collapsed) {
      // Sub-groups
      if (group.subGroups && group.subGroups.length > 0) {
        for (const sub of group.subGroups) {
          this._renderGroup(sub);
        }
      } else {
        for (const row of group.rows) {
          this._renderRow(row);
        }
      }
    }
  }

  private _renderRow(row: IDatabaseRow): void {
    const rowEl = $('div.db-table-row');
    rowEl.dataset.pageId = row.page.id;
    rowEl.style.gridTemplateColumns = this._headerRow.style.gridTemplateColumns;

    for (const prop of this._properties) {
      const cell = $('div.db-table-cell');
      cell.dataset.propertyId = prop.id;
      cell.dataset.pageId = row.page.id;

      const value = row.values[prop.id];

      // Title column: use page title from page object
      const displayValue: IPropertyValue | undefined =
        prop.type === 'title'
          ? { type: 'title', title: [{ type: 'text', content: row.page.title }] }
          : value;

      if (prop.type === 'title') {
        this._renderTitleCell(cell, row, prop, displayValue);
      } else {
        // Render display value
        renderPropertyValue(prop.type, displayValue, prop.config, cell);

        // Click handler
        this._renderDisposables.add(addDisposableListener(cell, 'click', () => {
          if (prop.type === 'checkbox') {
          // Checkbox toggles immediately (no editor popup)
            this._toggleCheckbox(row, prop, value);
          } else {
          // All other types → open inline editor
            this._openCellEditor(cell, row, prop, displayValue);
          }
        }));
      }

      rowEl.appendChild(cell);
    }

    // Empty add-column spacer to match header
    const spacer = $('div.db-table-cell.db-table-cell--spacer');
    rowEl.appendChild(spacer);

    this._bodyEl.appendChild(rowEl);
  }

  private _renderFooter(): void {
    clearNode(this._footerEl);

    const addRowBtn = $('button.db-table-add-row');
    addRowBtn.textContent = '+ New';
    this._renderDisposables.add(addDisposableListener(addRowBtn, 'click', async () => {
      try {
        await this._dataService.addRow(this._databaseId);
        // Row change event will trigger setRows() via pane
      } catch (err) {
        console.error('[TableView] Add row failed:', err);
      }
    }));
    this._footerEl.appendChild(addRowBtn);
  }

  // ─── Cell Editing ────────────────────────────────────────────────────

  private _openCellEditor(
    cell: HTMLElement,
    row: IDatabaseRow,
    property: IDatabaseProperty,
    currentValue: IPropertyValue | undefined,
  ): void {
    // Dismiss any active editor
    this._dismissEditor();

    // Clear cell content before creating the editor (prevents input alongside text)
    clearNode(cell);

    const editor = createPropertyEditor(
      property.type,
      cell,
      cell,
      currentValue,
      property.config,
    );

    if (!editor) {
      // Read-only type — restore display content
      renderPropertyValue(property.type, currentValue, property.config, cell);
      return;
    }

    this._editorDisposables.add(editor);

    // Track most recent committed value for immediate re-render (avoids stale data flash)
    let lastCommittedValue: IPropertyValue | undefined;

    editor.onDidChange(newValue => {
      lastCommittedValue = newValue;
      this._dataService.setPropertyValue(
        this._databaseId,
        row.page.id,
        property.id,
        newValue,
      ).catch(err => {
        console.error('[TableView] Set value failed:', err);
      });
    });

    editor.onDidDismiss(() => {
      this._dismissEditor();
      // Re-render this cell using the committed value (not the stale row closure)
      const display = lastCommittedValue
        ?? (property.type === 'title'
          ? { type: 'title' as const, title: [{ type: 'text' as const, content: row.page.title }] }
          : row.values[property.id]);
      renderPropertyValue(property.type, display, property.config, cell);
    });

    editor.focus();
  }

  private _renderTitleCell(
    cell: HTMLElement,
    row: IDatabaseRow,
    property: IDatabaseProperty,
    displayValue: IPropertyValue | undefined,
  ): void {
    cell.classList.add('db-table-cell--title');
    clearNode(cell);

    const wrap = $('div.db-cell-title-wrap');

    const iconBtn = $('button.db-cell-page-icon-btn') as HTMLButtonElement;
    iconBtn.type = 'button';
    iconBtn.title = 'Change page icon';
    iconBtn.setAttribute('aria-label', 'Change page icon');
    const resolvedIcon = resolvePageIcon(row.page.icon);
    iconBtn.innerHTML = `<span class="db-cell-page-icon">${svgIcon(resolvedIcon)}</span>`;
    this._renderDisposables.add(addDisposableListener(iconBtn, 'click', (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      this._showRowIconPicker(iconBtn, row);
    }));
    wrap.appendChild(iconBtn);

    const titleBtn = $('button.db-cell-title-btn') as HTMLButtonElement;
    titleBtn.type = 'button';
    titleBtn.title = row.page.title || 'Untitled';
    const titleText = $('span.db-cell-title');
    titleText.textContent = row.page.title || 'Untitled';
    titleBtn.appendChild(titleText);
    this._renderDisposables.add(addDisposableListener(titleBtn, 'click', (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      this._openCellEditor(cell, row, property, displayValue);
    }));
    wrap.appendChild(titleBtn);

    const openBtn = $('button.db-cell-open-btn') as HTMLButtonElement;
    openBtn.type = 'button';
    openBtn.textContent = 'OPEN';
    openBtn.title = 'Open page';
    openBtn.setAttribute('aria-label', 'Open page');
    this._renderDisposables.add(addDisposableListener(openBtn, 'click', (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      this._openEditor?.({
        typeId: 'canvas',
        title: row.page.title,
        icon: row.page.icon || undefined,
        instanceId: row.page.id,
      });
    }));
    wrap.appendChild(openBtn);

    cell.appendChild(wrap);
  }

  private _showRowIconPicker(anchor: HTMLElement, row: IDatabaseRow): void {
    this._dismissIconPicker();

    this._iconPicker = new IconPicker(this._tableEl, {
      anchor,
      icons: [...PAGE_SELECTABLE_ICONS],
      renderIcon: (id) => svgIcon(id),
      showSearch: true,
      showRemove: true,
      iconSize: 18,
    });

    this._iconPicker.onDidSelectIcon((iconId) => {
      this._dataService.updatePageIcon(this._databaseId, row.page.id, iconId).catch((err) => {
        console.error('[TableView] Update page icon failed:', err);
      });
    });

    this._iconPicker.onDidRemoveIcon(() => {
      this._dataService.updatePageIcon(this._databaseId, row.page.id, null).catch((err) => {
        console.error('[TableView] Remove page icon failed:', err);
      });
    });

    this._iconPicker.onDidDismiss(() => {
      this._iconPicker = null;
    });
  }

  private _dismissIconPicker(): void {
    if (!this._iconPicker) return;
    this._iconPicker.dismiss();
    this._iconPicker = null;
  }

  private _toggleCheckbox(row: IDatabaseRow, property: IDatabaseProperty, currentValue: IPropertyValue | undefined): void {
    const checked = currentValue?.type === 'checkbox' ? currentValue.checkbox : false;
    this._dataService.setPropertyValue(
      this._databaseId,
      row.page.id,
      property.id,
      { type: 'checkbox', checkbox: !checked },
    ).catch(err => {
      console.error('[TableView] Toggle checkbox failed:', err);
    });
  }

  private _dismissEditor(): void {
    this._editorDisposables.clear();
  }

  // ─── Column Resize ──────────────────────────────────────────────────

  private _setupColumnResize(handle: HTMLElement, propertyId: string): void {
    let startX = 0;
    let startWidth = 0;

    // Track document-level listeners in a store so they're cleaned up on dispose
    const resizeStore = new DisposableStore();

    const onMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - startX;
      const newWidth = Math.max(80, startWidth + delta);
      this._columnWidths[propertyId] = newWidth;
      this._updateGridTemplate();
    };

    const onMouseUp = () => {
      resizeStore.clear();
      document.body.classList.remove('db-resizing');

      // Persist column widths to view config
      this._dataService.updateView(this._view.id, {
        config: {
          ...this._view.config,
          columnWidths: { ...this._columnWidths },
        },
      }).catch(err => {
        console.error('[TableView] Save column widths failed:', err);
      });
    };

    this._register(addDisposableListener(handle, 'mousedown', (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      startX = e.clientX;
      startWidth = this._columnWidths[propertyId] ?? 200;
      document.body.classList.add('db-resizing');
      resizeStore.clear();
      resizeStore.add(addDisposableListener(document, 'mousemove', onMouseMove));
      resizeStore.add(addDisposableListener(document, 'mouseup', onMouseUp));
    }));

    // Ensure document listeners are cleaned up if we're disposed mid-resize
    this._register(resizeStore);
  }

  private _updateGridTemplate(): void {
    const columns = this._properties.map(
      prop => `${this._columnWidths[prop.id] ?? 200}px`,
    );
    // Add space for the "+ Add property" button
    columns.push('190px');

    const template = columns.join(' ');
    this._headerRow.style.gridTemplateColumns = template;
    this._tableEl.style.setProperty('--db-table-grid-template', template);

    // Apply same grid to all row elements
    for (const row of this._bodyEl.children) {
      (row as HTMLElement).style.gridTemplateColumns = template;
    }
  }

  // ─── Sort Helper ──────────────────────────────────────────────────────

  private _getSortForProperty(propertyId: string): ISortRule | undefined {
    return this._view.sortConfig?.find(s => s.propertyId === propertyId);
  }

  // ─── Dispose ─────────────────────────────────────────────────────────

  override dispose(): void {
    this._dismissIconPicker();
    this._dismissEditor();
    if (this._tableEl.parentElement) {
      this._tableEl.remove();
    }
    super.dispose();
  }
}
