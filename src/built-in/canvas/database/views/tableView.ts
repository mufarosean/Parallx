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
import {
  renderPropertyValue,
  createPropertyEditor,
  showPropertyAddMenu,
  showPropertyHeaderMenu,
  startPropertyRename,
  PROPERTY_TYPE_ICONS,
  type IDatabaseDataService,
  type IDatabaseView,
  type IDatabaseProperty,
  type IDatabaseRow,
  type IPropertyValue,
} from '../databaseRegistry.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export type OpenEditorFn = (options: {
  typeId: string;
  title: string;
  icon?: string;
  instanceId?: string;
}) => Promise<void>;

// ─── TableView ───────────────────────────────────────────────────────────────

export class TableView extends Disposable {
  private readonly _tableEl: HTMLElement;
  private readonly _headerRow: HTMLElement;
  private readonly _bodyEl: HTMLElement;
  private readonly _footerEl: HTMLElement;

  private _properties: IDatabaseProperty[];
  private _rows: IDatabaseRow[];
  private _columnWidths: Record<string, number>;

  // ── Active cell editor ──
  private readonly _editorDisposables = this._register(new DisposableStore());

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
  ) {
    super();

    this._properties = properties;
    this._rows = rows;
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
  setRows(rows: IDatabaseRow[]): void {
    this._rows = rows;
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
      label.textContent = prop.name;
      cell.appendChild(label);

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

    // "+" add-column button
    const addCol = $('div.db-table-header-add');
    addCol.textContent = '+';
    addCol.title = 'Add a property';
    this._renderDisposables.add(addDisposableListener(addCol, 'click', () => {
      showPropertyAddMenu(addCol, this._dataService, this._databaseId);
    }));
    this._headerRow.appendChild(addCol);
  }

  private _renderBody(): void {
    clearNode(this._bodyEl);

    for (const row of this._rows) {
      this._renderRow(row);
    }
  }

  private _renderRow(row: IDatabaseRow): void {
    const rowEl = $('div.db-table-row');
    rowEl.dataset.pageId = row.page.id;

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

      // Render display value
      renderPropertyValue(prop.type, displayValue, prop.config, cell);

      // Click handler
      this._renderDisposables.add(addDisposableListener(cell, 'click', () => {
        if (prop.type === 'title') {
          // Click title → open page in canvas editor
          this._openEditor?.({
            typeId: 'canvas',
            title: row.page.title,
            icon: row.page.icon || undefined,
            instanceId: row.page.id,
          });
        } else if (prop.type === 'checkbox') {
          // Checkbox toggles immediately (no editor popup)
          this._toggleCheckbox(row, prop, value);
        } else {
          // All other types → open inline editor
          this._openCellEditor(cell, row, prop, displayValue);
        }
      }));

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

    const onMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - startX;
      const newWidth = Math.max(80, startWidth + delta);
      this._columnWidths[propertyId] = newWidth;
      this._updateGridTemplate();
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
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
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    }));
  }

  private _updateGridTemplate(): void {
    const columns = this._properties.map(
      prop => `${this._columnWidths[prop.id] ?? 200}px`,
    );
    // Add space for the "+" add-column button
    columns.push('40px');

    const template = columns.join(' ');
    this._headerRow.style.gridTemplateColumns = template;

    // Apply same grid to all row elements
    for (const row of this._bodyEl.children) {
      (row as HTMLElement).style.gridTemplateColumns = template;
    }
  }

  // ─── Dispose ─────────────────────────────────────────────────────────

  override dispose(): void {
    this._dismissEditor();
    if (this._tableEl.parentElement) {
      this._tableEl.remove();
    }
    super.dispose();
  }
}
