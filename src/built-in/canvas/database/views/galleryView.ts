// galleryView.ts — Card gallery view for databases
//
// Renders database rows as cards in a responsive CSS grid.
// Each card shows a cover image (from page coverUrl), title, and
// configurable preview properties. Supports small/medium/large card sizes.
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

// ─── Card size configuration ─────────────────────────────────────────────────

const CARD_SIZE_COLUMNS: Record<string, number> = {
  small: 4,
  medium: 3,
  large: 2,
};

// ─── GalleryView ─────────────────────────────────────────────────────────────

export class GalleryView extends Disposable {
  private readonly _galleryEl: HTMLElement;
  private readonly _renderDisposables = this._register(new DisposableStore());

  private _properties: IDatabaseProperty[];
  private _rows: IDatabaseRow[];
  private _groups: IRowGroup[];
  private readonly _collapsedGroups = new Set<string>();

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

    this._galleryEl = $('div.db-gallery');
    container.appendChild(this._galleryEl);

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
    clearNode(this._galleryEl);

    const hasGroups = this._groups.length > 1 ||
      (this._groups.length === 1 && this._groups[0].key !== '__all__');

    if (hasGroups) {
      for (const group of this._groups) {
        this._renderGroup(group);
      }
    } else {
      const allRows = this._groups.length > 0 ? this._groups[0].rows : this._rows;
      const grid = this._createGrid();
      this._galleryEl.appendChild(grid);
      for (const row of allRows) {
        this._renderCard(row, grid);
      }
    }

    // Footer — add row
    this._renderFooter();
  }

  private _renderGroup(group: IRowGroup): void {
    const groupEl = $('div.db-gallery-group');
    this._galleryEl.appendChild(groupEl);

    const isCollapsed = this._collapsedGroups.has(group.key);

    // Group header
    const headerEl = $('div.db-gallery-group-header');
    groupEl.appendChild(headerEl);

    const toggleEl = $('span.db-gallery-group-toggle');
    toggleEl.textContent = isCollapsed ? '▸' : '▾';
    headerEl.appendChild(toggleEl);

    const labelEl = $('span.db-gallery-group-label');
    labelEl.textContent = group.label || 'No value';
    headerEl.appendChild(labelEl);

    const countEl = $('span.db-gallery-group-count');
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

    if (!isCollapsed) {
      const grid = this._createGrid();
      groupEl.appendChild(grid);
      for (const row of group.rows) {
        this._renderCard(row, grid);
      }
    }
  }

  private _renderCard(row: IDatabaseRow, parent: HTMLElement): void {
    const cardEl = $('div.db-gallery-card');
    parent.appendChild(cardEl);

    // Cover image
    if (row.page.coverUrl) {
      const coverEl = $('div.db-gallery-card-cover');
      const img = $('img.db-gallery-card-cover-img') as HTMLImageElement;
      img.src = row.page.coverUrl;
      img.alt = row.page.title || 'Cover';
      img.loading = 'lazy';
      if (row.page.coverYOffset !== undefined) {
        img.style.objectPosition = `center ${row.page.coverYOffset * 100}%`;
      }
      coverEl.appendChild(img);
      cardEl.appendChild(coverEl);
    }

    // Card body
    const bodyEl = $('div.db-gallery-card-body');
    cardEl.appendChild(bodyEl);

    // Icon + title
    const titleEl = $('div.db-gallery-card-title');
    if (row.page.icon) {
      const iconEl = $('span.db-gallery-card-icon');
      iconEl.textContent = row.page.icon;
      titleEl.appendChild(iconEl);
    }
    const titleText = $('span.db-gallery-card-title-text');
    titleText.textContent = row.page.title || 'Untitled';
    titleEl.appendChild(titleText);
    bodyEl.appendChild(titleEl);

    // Preview properties (first 3 non-title visible properties)
    const previewProps = this._getPreviewProperties();
    if (previewProps.length > 0) {
      const propsEl = $('div.db-gallery-card-props');
      bodyEl.appendChild(propsEl);

      for (const prop of previewProps) {
        const propEl = $('div.db-gallery-card-prop');
        propsEl.appendChild(propEl);

        const valueEl = $('span.db-gallery-card-prop-value');
        propEl.appendChild(valueEl);

        const value = row.values[prop.id];
        renderPropertyValue(prop.type, value, prop.config, valueEl);
      }
    }

    // Click to open
    this._renderDisposables.add(
      addDisposableListener(cardEl, 'click', () => {
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
    const footerEl = $('div.db-gallery-footer');
    this._galleryEl.appendChild(footerEl);

    const addBtn = $('button.db-gallery-add-row');
    addBtn.textContent = '+ New';
    footerEl.appendChild(addBtn);

    this._renderDisposables.add(
      addDisposableListener(addBtn, 'click', async () => {
        try {
          await this._dataService.addRow(this._databaseId);
        } catch (err) {
          console.error('[GalleryView] Failed to add row:', err);
        }
      }),
    );
  }

  // ─── Helpers ─────────────────────────────────────────────────────────

  private _createGrid(): HTMLElement {
    const grid = $('div.db-gallery-grid');
    const size = this._view.config.cardSize ?? 'medium';
    const cols = CARD_SIZE_COLUMNS[size] ?? 3;
    grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    return grid;
  }

  private _getPreviewProperties(): IDatabaseProperty[] {
    return this._properties
      .filter(p => p.type !== 'title')
      .slice(0, 3);
  }

  // ─── Dispose ─────────────────────────────────────────────────────────

  override dispose(): void {
    this._renderDisposables.clear();
    this._galleryEl.remove();
    super.dispose();
  }
}
