// boardView.ts — Kanban board view for databases
//
// Renders cards grouped into vertical columns by a Select or Status property.
// Dragging a card between columns updates the grouping property value.
// Each column has a "+ New" button that creates a row with that column's value.
//
// Dependencies: platform/ (lifecycle, events), ui/ (dom),
// databaseRegistry (single gate for all database imports)

import { Disposable, DisposableStore } from '../../../../platform/lifecycle.js';
import { $, addDisposableListener, clearNode } from '../../../../ui/dom.js';
import {
  renderPropertyValue,
  type IDatabaseDataService,
  type IDatabaseView,
  type IDatabaseProperty,
  type IDatabaseRow,
  type IPropertyValue,
  type IRowGroup,
  type ISelectOption,
  type ISelectPropertyConfig,
  type IStatusPropertyConfig,
} from '../databaseRegistry.js';
import type { OpenEditorFn } from '../databaseRegistry.js';

// ─── BoardView ───────────────────────────────────────────────────────────────

export class BoardView extends Disposable {
  private readonly _boardEl: HTMLElement;
  private readonly _renderDisposables = this._register(new DisposableStore());

  private _properties: IDatabaseProperty[];
  private _rows: IDatabaseRow[];
  private _groups: IRowGroup[];
  private _groupProperty: IDatabaseProperty | null;
  private _collapsedColumns = new Set<string>();

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
    this._groupProperty = this._resolveGroupProperty();

    // If groups already provided, use them; otherwise build from board_group_property
    this._groups = groups && groups.length > 0 && !(groups.length === 1 && groups[0].key === '__all__')
      ? groups
      : this._buildBoardGroups();

    // Build board structure
    this._boardEl = $('div.db-board');
    container.appendChild(this._boardEl);

    this._render();
  }

  // ─── Public API ──────────────────────────────────────────────────────

  setRows(rows: IDatabaseRow[], groups?: IRowGroup[]): void {
    this._rows = rows;
    this._groups = groups && groups.length > 0 && !(groups.length === 1 && groups[0].key === '__all__')
      ? groups
      : this._buildBoardGroups();
    this._render();
  }

  setProperties(properties: IDatabaseProperty[]): void {
    this._properties = properties;
    this._groupProperty = this._resolveGroupProperty();
    this._groups = this._buildBoardGroups();
    this._render();
  }

  // ─── Group Property Resolution ───────────────────────────────────────

  private _resolveGroupProperty(): IDatabaseProperty | null {
    // Use boardGroupProperty from view config, or fall back to first Select/Status
    const boardPropId = this._view.boardGroupProperty ?? this._view.groupBy;
    if (boardPropId) {
      return this._properties.find(p => p.id === boardPropId) ?? null;
    }
    return this._properties.find(p => p.type === 'select' || p.type === 'status') ?? null;
  }

  private _buildBoardGroups(): IRowGroup[] {
    if (!this._groupProperty) {
      return [{ key: '__all__', label: 'All', rows: this._rows }];
    }

    const prop = this._groupProperty;
    const config = prop.config as ISelectPropertyConfig | IStatusPropertyConfig | undefined;
    const options = config?.options ?? [];

    // Pre-build columns from option order
    const groupMap = new Map<string, IDatabaseRow[]>();
    const orderedKeys: string[] = [];

    for (const opt of options) {
      groupMap.set(opt.name, []);
      orderedKeys.push(opt.name);
    }
    groupMap.set('__no_value__', []);
    orderedKeys.push('__no_value__');

    // Assign rows
    for (const row of this._rows) {
      const value = row.values[prop.id];
      let key = '__no_value__';

      if (value) {
        if (value.type === 'select' && value.select) {
          key = value.select.name;
        } else if (value.type === 'status' && value.status) {
          key = value.status.name;
        }
      }

      if (!groupMap.has(key)) {
        groupMap.set(key, []);
        orderedKeys.push(key);
      }
      groupMap.get(key)!.push(row);
    }

    // Filter empty groups if configured
    let groups: IRowGroup[] = orderedKeys.map(key => {
      const opt = options.find(o => o.name === key);
      return {
        key,
        label: key === '__no_value__' ? 'No value' : key,
        color: opt?.color,
        rows: groupMap.get(key) ?? [],
      };
    });

    if (this._view.hideEmptyGroups) {
      groups = groups.filter(g => g.rows.length > 0);
    }

    return groups;
  }

  // ─── Rendering ───────────────────────────────────────────────────────

  private _render(): void {
    this._renderDisposables.clear();
    clearNode(this._boardEl);

    for (const group of this._groups) {
      this._renderColumn(group);
    }
  }

  private _renderColumn(group: IRowGroup): void {
    const collapsed = this._collapsedColumns.has(group.key);

    const columnEl = $('div.db-board-column');
    if (collapsed) columnEl.classList.add('db-board-column--collapsed');
    columnEl.dataset.groupKey = group.key;

    // ── Column Header ──
    const headerEl = $('div.db-board-column-header');

    const headerLeft = $('div.db-board-column-header-left');

    if (group.color) {
      const dot = $('span.db-board-column-dot');
      dot.classList.add(`db-cell-pill--${group.color}`);
      headerLeft.appendChild(dot);
    }

    const nameEl = $('span.db-board-column-name');
    nameEl.textContent = group.label;
    headerLeft.appendChild(nameEl);

    const countEl = $('span.db-board-column-count');
    countEl.textContent = String(group.rows.length);
    headerLeft.appendChild(countEl);

    headerEl.appendChild(headerLeft);

    // Collapse/expand button
    const collapseBtn = $('button.db-board-column-collapse');
    collapseBtn.textContent = collapsed ? '›' : '‹';
    collapseBtn.title = collapsed ? 'Expand' : 'Collapse';
    this._renderDisposables.add(addDisposableListener(collapseBtn, 'click', () => {
      if (this._collapsedColumns.has(group.key)) {
        this._collapsedColumns.delete(group.key);
      } else {
        this._collapsedColumns.add(group.key);
      }
      this._render();
    }));
    headerEl.appendChild(collapseBtn);

    this._renderDisposables.add(addDisposableListener(headerEl, 'click', (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('.db-board-column-collapse')) return;
      if (this._collapsedColumns.has(group.key)) {
        this._collapsedColumns.delete(group.key);
      } else {
        this._collapsedColumns.add(group.key);
      }
      this._render();
    }));

    columnEl.appendChild(headerEl);

    if (!collapsed) {
      // ── Cards ──
      const cardsEl = $('div.db-board-cards');
      this._setupDropZone(cardsEl, group);

      for (const row of group.rows) {
        this._renderCard(cardsEl, row, group);
      }

      columnEl.appendChild(cardsEl);

      // ── Add Row ──
      const addBtn = $('button.db-board-add-row');
      addBtn.textContent = '+ New';
      this._renderDisposables.add(addDisposableListener(addBtn, 'click', async () => {
        try {
          const newRow = await this._dataService.addRow(this._databaseId);
          // Set the grouping property value for this column
          if (this._groupProperty && group.key !== '__no_value__') {
            const option = this._findOptionByName(group.key);
            if (option) {
              const propValue: IPropertyValue = this._groupProperty.type === 'status'
                ? { type: 'status', status: option }
                : { type: 'select', select: option };
              await this._dataService.setPropertyValue(
                this._databaseId,
                newRow.page.id,
                this._groupProperty.id,
                propValue,
              );
            }
          }
        } catch (err) {
          console.error('[BoardView] Add row failed:', err);
        }
      }));
      columnEl.appendChild(addBtn);
    }

    this._boardEl.appendChild(columnEl);
  }

  private _renderCard(container: HTMLElement, row: IDatabaseRow, _group: IRowGroup): void {
    const card = $('div.db-board-card');
    card.dataset.pageId = row.page.id;
    card.draggable = true;

    // ── Page cover (if available) ──
    if (row.page.coverUrl) {
      const cover = $('div.db-board-card-cover');
      cover.style.setProperty('--db-cover-url', `url(${row.page.coverUrl})`);
      card.appendChild(cover);
    }

    // ── Title ──
    const titleEl = $('div.db-board-card-title');
    titleEl.textContent = row.page.title || 'Untitled';
    card.appendChild(titleEl);

    // ── Preview properties (skip title and group property) ──
    const previewProps = this._properties.filter(p =>
      p.type !== 'title' && p.id !== this._groupProperty?.id,
    ).slice(0, 3); // Show up to 3 preview properties

    if (previewProps.length > 0) {
      const previewEl = $('div.db-board-card-props');
      for (const prop of previewProps) {
        const value = row.values[prop.id];
        if (!value) continue;
        const propRow = $('div.db-board-card-prop');
        const propLabel = $('span.db-board-card-prop-label');
        propLabel.textContent = prop.name;
        propRow.appendChild(propLabel);
        const propValue = $('span.db-board-card-prop-value');
        renderPropertyValue(prop.type, value, prop.config, propValue);
        propRow.appendChild(propValue);
        previewEl.appendChild(propRow);
      }
      card.appendChild(previewEl);
    }

    // ── Click → open page ──
    this._renderDisposables.add(addDisposableListener(card, 'click', () => {
      this._openEditor?.({
        typeId: 'canvas',
        title: row.page.title,
        icon: row.page.icon || undefined,
        instanceId: row.page.id,
      });
    }));

    // ── Drag start ──
    this._renderDisposables.add(addDisposableListener(card, 'dragstart', (e: DragEvent) => {
      e.dataTransfer?.setData('application/x-parallx-board-card', row.page.id);
      e.dataTransfer!.effectAllowed = 'move';
      card.classList.add('db-board-card--dragging');
    }));

    this._renderDisposables.add(addDisposableListener(card, 'dragend', () => {
      card.classList.remove('db-board-card--dragging');
    }));

    container.appendChild(card);
  }

  // ─── Drag & Drop ─────────────────────────────────────────────────────

  private _setupDropZone(container: HTMLElement, group: IRowGroup): void {
    this._renderDisposables.add(addDisposableListener(container, 'dragover', (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('application/x-parallx-board-card')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        container.classList.add('db-board-cards--dragover');

        // Find the nearest card to show insertion indicator
        this._updateDropIndicator(container, e.clientY);
      }
    }));

    this._renderDisposables.add(addDisposableListener(container, 'dragleave', (e: DragEvent) => {
      if (e.currentTarget === container) {
        container.classList.remove('db-board-cards--dragover');
        this._clearDropIndicators(container);
      }
    }));

    this._renderDisposables.add(addDisposableListener(container, 'drop', async (e: DragEvent) => {
      e.preventDefault();
      container.classList.remove('db-board-cards--dragover');
      this._clearDropIndicators(container);

      const pageId = e.dataTransfer?.getData('application/x-parallx-board-card');
      if (!pageId || !this._groupProperty) return;

      // Determine the drop target index within this column
      const dropIndex = this._getDropIndex(container, e.clientY);

      // Check if the card is from the same column (reorder) or a different column (change value)
      const isFromSameColumn = group.rows.some(r => r.page.id === pageId);

      try {
        if (!isFromSameColumn) {
          // Cross-column: update the grouping property value
          let propValue: IPropertyValue;

          if (group.key === '__no_value__') {
            propValue = this._groupProperty.type === 'status'
              ? { type: 'status', status: null }
              : { type: 'select', select: null };
          } else {
            const option = this._findOptionByName(group.key);
            if (!option) return;
            propValue = this._groupProperty.type === 'status'
              ? { type: 'status', status: option }
              : { type: 'select', select: option };
          }

          await this._dataService.setPropertyValue(
            this._databaseId,
            pageId,
            this._groupProperty.id,
            propValue,
          );
        }

        // Reorder within column — build new order for ALL rows in this column
        const columnPageIds = group.rows.map(r => r.page.id).filter(id => id !== pageId);
        const insertAt = Math.min(dropIndex, columnPageIds.length);
        columnPageIds.splice(insertAt, 0, pageId);

        // Build full row order: keep non-column rows in their original order,
        // then place column rows at the positions of the column-relative reorder
        const allPageIds = this._rows.map(r => r.page.id);
        const nonColumnIds = allPageIds.filter(id => !group.rows.some(r => r.page.id === id) && id !== pageId);
        const reordered = [...nonColumnIds, ...columnPageIds];
        await this._dataService.reorderRows(this._databaseId, reordered);
      } catch (err) {
        console.error('[BoardView] Drag-to-change failed:', err);
      }
    }));
  }

  private _updateDropIndicator(container: HTMLElement, mouseY: number): void {
    this._clearDropIndicators(container);
    const cards = Array.from(container.querySelectorAll('.db-board-card'));
    for (const card of cards) {
      const rect = card.getBoundingClientRect();
      if (mouseY < rect.top + rect.height / 2) {
        (card as HTMLElement).classList.add('db-board-card--drop-before');
        return;
      }
    }
    // After last card
    if (cards.length > 0) {
      (cards[cards.length - 1] as HTMLElement).classList.add('db-board-card--drop-after');
    }
  }

  private _clearDropIndicators(container: HTMLElement): void {
    container.querySelectorAll('.db-board-card--drop-before, .db-board-card--drop-after')
      .forEach(el => {
        el.classList.remove('db-board-card--drop-before', 'db-board-card--drop-after');
      });
  }

  private _getDropIndex(container: HTMLElement, mouseY: number): number {
    const cards = Array.from(container.querySelectorAll('.db-board-card'));
    for (let i = 0; i < cards.length; i++) {
      const rect = cards[i].getBoundingClientRect();
      if (mouseY < rect.top + rect.height / 2) {
        return i;
      }
    }
    return cards.length;
  }

  // ─── Helpers ─────────────────────────────────────────────────────────

  private _findOptionByName(name: string): ISelectOption | null {
    if (!this._groupProperty) return null;
    const config = this._groupProperty.config as { options?: ISelectOption[] };
    return config?.options?.find(o => o.name === name) ?? null;
  }

  // ─── Dispose ─────────────────────────────────────────────────────────

  override dispose(): void {
    this._renderDisposables.clear();
    if (this._boardEl.parentElement) {
      this._boardEl.remove();
    }
    super.dispose();
  }
}
