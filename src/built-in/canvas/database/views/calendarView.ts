// calendarView.ts — Monthly calendar view for databases
//
// Renders a monthly calendar grid (7 columns × 5–6 rows) where database
// rows are placed on the date matching a configurable date property.
// Supports month navigation, click-day-to-create, click-item-to-open.
//
// Dependencies: platform/ (lifecycle), ui/ (dom),
// databaseRegistry (single gate for all database imports)

import { Disposable, DisposableStore } from '../../../../platform/lifecycle.js';
import { $, addDisposableListener, clearNode } from '../../../../ui/dom.js';
import {
  type IDatabaseDataService,
  type IDatabaseView,
  type IDatabaseProperty,
  type IDatabaseRow,
  type IRowGroup,
  type IPropertyValue,
} from '../databaseRegistry.js';
import type { OpenEditorFn } from '../databaseRegistry.js';

// ─── Day names ───────────────────────────────────────────────────────────────

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// ─── CalendarView ────────────────────────────────────────────────────────────

export class CalendarView extends Disposable {
  private readonly _calendarEl: HTMLElement;
  private readonly _renderDisposables = this._register(new DisposableStore());

  private _properties: IDatabaseProperty[];
  private _rows: IDatabaseRow[];
  private _groups: IRowGroup[];
  private _currentMonth: Date;
  private _dateProperty: IDatabaseProperty | null;

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
    this._currentMonth = new Date();
    this._currentMonth.setDate(1);
    this._currentMonth.setHours(0, 0, 0, 0);

    // Resolve date property from view config or find first date property
    this._dateProperty = this._resolveDateProperty();

    this._calendarEl = $('div.db-calendar');
    container.appendChild(this._calendarEl);

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
    this._dateProperty = this._resolveDateProperty();
    this._render();
  }

  // ─── Render ──────────────────────────────────────────────────────────

  private _render(): void {
    this._renderDisposables.clear();
    clearNode(this._calendarEl);

    // Navigation header
    this._renderHeader();

    // Day names header
    this._renderDayNames();

    // Calendar grid
    this._renderGrid();
  }

  private _renderHeader(): void {
    const headerEl = $('div.db-calendar-header');
    this._calendarEl.appendChild(headerEl);

    const prevBtn = $('button.db-calendar-nav-btn');
    prevBtn.textContent = '‹';
    prevBtn.title = 'Previous month';
    headerEl.appendChild(prevBtn);

    const titleEl = $('span.db-calendar-title');
    titleEl.textContent = `${MONTH_NAMES[this._currentMonth.getMonth()]} ${this._currentMonth.getFullYear()}`;
    headerEl.appendChild(titleEl);

    const nextBtn = $('button.db-calendar-nav-btn');
    nextBtn.textContent = '›';
    nextBtn.title = 'Next month';
    headerEl.appendChild(nextBtn);

    const todayBtn = $('button.db-calendar-today-btn');
    todayBtn.textContent = 'Today';
    headerEl.appendChild(todayBtn);

    this._renderDisposables.add(
      addDisposableListener(prevBtn, 'click', () => {
        this._currentMonth.setMonth(this._currentMonth.getMonth() - 1);
        this._render();
      }),
    );

    this._renderDisposables.add(
      addDisposableListener(nextBtn, 'click', () => {
        this._currentMonth.setMonth(this._currentMonth.getMonth() + 1);
        this._render();
      }),
    );

    this._renderDisposables.add(
      addDisposableListener(todayBtn, 'click', () => {
        this._currentMonth = new Date();
        this._currentMonth.setDate(1);
        this._currentMonth.setHours(0, 0, 0, 0);
        this._render();
      }),
    );
  }

  private _renderDayNames(): void {
    const rowEl = $('div.db-calendar-day-names');
    this._calendarEl.appendChild(rowEl);

    for (const day of DAY_NAMES) {
      const cell = $('div.db-calendar-day-name');
      cell.textContent = day;
      rowEl.appendChild(cell);
    }
  }

  private _renderGrid(): void {
    const gridEl = $('div.db-calendar-grid');
    this._calendarEl.appendChild(gridEl);

    const year = this._currentMonth.getFullYear();
    const month = this._currentMonth.getMonth();

    // First day of month and last day
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);

    // Start from the Sunday before (or on) the first day
    const startDate = new Date(firstDay);
    startDate.setDate(startDate.getDate() - startDate.getDay());

    // End on the Saturday after (or on) the last day
    const endDate = new Date(lastDay);
    endDate.setDate(endDate.getDate() + (6 - endDate.getDay()));

    // Build date → rows map
    const dateRowMap = this._buildDateRowMap();

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const current = new Date(startDate);
    while (current <= endDate) {
      const dateKey = this._formatDateKey(current);
      const isCurrentMonth = current.getMonth() === month;
      const isToday = current.getTime() === today.getTime();

      const cellEl = $('div.db-calendar-cell');
      if (!isCurrentMonth) cellEl.classList.add('db-calendar-cell--other-month');
      if (isToday) cellEl.classList.add('db-calendar-cell--today');
      gridEl.appendChild(cellEl);

      // Day number
      const dayNum = $('div.db-calendar-cell-day');
      dayNum.textContent = `${current.getDate()}`;
      cellEl.appendChild(dayNum);

      // Items for this date
      const items = dateRowMap.get(dateKey) ?? [];
      const itemsEl = $('div.db-calendar-cell-items');
      cellEl.appendChild(itemsEl);

      for (const row of items.slice(0, 3)) {
        const itemEl = $('div.db-calendar-item');
        itemEl.textContent = row.page.title || 'Untitled';
        itemsEl.appendChild(itemEl);

        this._renderDisposables.add(
          addDisposableListener(itemEl, 'click', (e) => {
            e.stopPropagation();
            this._openEditor?.({
              typeId: 'canvas',
              title: row.page.title || 'Untitled',
              icon: row.page.icon ?? undefined,
              instanceId: row.page.id,
            });
          }),
        );
      }

      if (items.length > 3) {
        const moreEl = $('div.db-calendar-item-more');
        moreEl.textContent = `+${items.length - 3} more`;
        itemsEl.appendChild(moreEl);
      }

      // Click day to create new row with that date
      const cellDate = new Date(current);
      this._renderDisposables.add(
        addDisposableListener(cellEl, 'click', async () => {
          if (!this._dateProperty) return;
          try {
            const newRow = await this._dataService.addRow(this._databaseId);
            if (newRow) {
              const dateStr = this._formatDateKey(cellDate);
              const dateValue: IPropertyValue = {
                type: 'date',
                date: { start: dateStr, end: null },
              };
              await this._dataService.setPropertyValue(
                this._databaseId,
                newRow.page.id,
                this._dateProperty.id,
                dateValue,
              );
            }
          } catch (err) {
            console.error('[CalendarView] Failed to add row:', err);
          }
        }),
      );

      current.setDate(current.getDate() + 1);
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────

  private _resolveDateProperty(): IDatabaseProperty | null {
    // Use configured dateProperty from view config
    const configPropId = this._view.config.dateProperty;
    if (configPropId) {
      const prop = this._properties.find(p => p.id === configPropId);
      if (prop) return prop;
    }
    // Fall back to first date property
    return this._properties.find(p => p.type === 'date') ?? null;
  }

  private _buildDateRowMap(): Map<string, IDatabaseRow[]> {
    const map = new Map<string, IDatabaseRow[]>();

    if (!this._dateProperty) return map;

    const allRows = this._getAllRows();
    for (const row of allRows) {
      const value = row.values[this._dateProperty.id];
      if (!value || value.type !== 'date' || !value.date?.start) continue;

      const dateKey = value.date.start.substring(0, 10); // YYYY-MM-DD
      if (!map.has(dateKey)) map.set(dateKey, []);
      map.get(dateKey)!.push(row);
    }

    return map;
  }

  private _getAllRows(): IDatabaseRow[] {
    if (this._groups.length === 1 && this._groups[0].key === '__all__') {
      return this._groups[0].rows;
    }
    const rows: IDatabaseRow[] = [];
    for (const group of this._groups) {
      rows.push(...group.rows);
    }
    return rows.length > 0 ? rows : this._rows;
  }

  private _formatDateKey(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // ─── Dispose ─────────────────────────────────────────────────────────

  override dispose(): void {
    this._renderDisposables.clear();
    this._calendarEl.remove();
    super.dispose();
  }
}
