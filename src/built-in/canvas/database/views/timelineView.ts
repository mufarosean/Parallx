// timelineView.ts — Gantt-style timeline view for databases
//
// Renders horizontal bars spanning date ranges on a time axis.
// Configurable dateProperty (start) and dateEndProperty (end) from view config.
// Supports day/week/month zoom, drag bar edges to adjust dates, click to open page.
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

// ─── Time scale configuration ────────────────────────────────────────────────

type TimeScale = 'day' | 'week' | 'month';

const SCALE_LABEL_MAP: Record<TimeScale, string> = {
  day: 'Day',
  week: 'Week',
  month: 'Month',
};

const SCALE_DAY_WIDTH: Record<TimeScale, number> = {
  day: 40,
  week: 12,
  month: 3,
};

const ROW_HEIGHT = 36;
const HEADER_HEIGHT = 50;
const LABEL_WIDTH = 200;

// ─── TimelineView ────────────────────────────────────────────────────────────

export class TimelineView extends Disposable {
  private readonly _timelineEl: HTMLElement;
  private readonly _renderDisposables = this._register(new DisposableStore());

  private _properties: IDatabaseProperty[];
  private _rows: IDatabaseRow[];
  private _groups: IRowGroup[];
  private _scale: TimeScale = 'week';
  private _startDateProp: IDatabaseProperty | null;
  private _endDateProp: IDatabaseProperty | null;

  // Computed view bounds
  private _viewStart: Date = new Date();
  private _viewEnd: Date = new Date();

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

    this._startDateProp = this._resolveStartDateProperty();
    this._endDateProp = this._resolveEndDateProperty();

    this._timelineEl = $('div.db-timeline');
    container.appendChild(this._timelineEl);

    this._computeViewBounds();
    this._render();
  }

  // ─── Public API ──────────────────────────────────────────────────────

  setRows(rows: IDatabaseRow[], groups?: IRowGroup[]): void {
    this._rows = rows;
    this._groups = groups ?? [{ key: '__all__', label: 'All', rows }];
    this._computeViewBounds();
    this._render();
  }

  setProperties(properties: IDatabaseProperty[]): void {
    this._properties = properties;
    this._startDateProp = this._resolveStartDateProperty();
    this._endDateProp = this._resolveEndDateProperty();
    this._computeViewBounds();
    this._render();
  }

  // ─── Render ──────────────────────────────────────────────────────────

  private _render(): void {
    this._renderDisposables.clear();
    clearNode(this._timelineEl);

    // Scale toggle buttons
    this._renderScaleToggle();

    // Timeline container with scroll
    const scrollContainer = $('div.db-timeline-scroll');
    this._timelineEl.appendChild(scrollContainer);

    const allRows = this._getAllRows();
    const totalDays = this._daysBetween(this._viewStart, this._viewEnd);
    const dayWidth = SCALE_DAY_WIDTH[this._scale];
    const timelineWidth = LABEL_WIDTH + totalDays * dayWidth;

    // Set scroll width
    scrollContainer.style.overflowX = 'auto';

    const innerEl = $('div.db-timeline-inner');
    innerEl.style.width = `${timelineWidth}px`;
    innerEl.style.minHeight = `${HEADER_HEIGHT + allRows.length * ROW_HEIGHT + 40}px`;
    scrollContainer.appendChild(innerEl);

    // Time axis header
    this._renderTimeAxis(innerEl, totalDays, dayWidth);

    // Row bars
    this._renderRows(innerEl, allRows, dayWidth);

    // Footer — add row
    this._renderFooter();
  }

  private _renderScaleToggle(): void {
    const toggleEl = $('div.db-timeline-scale-toggle');
    this._timelineEl.appendChild(toggleEl);

    for (const scale of ['day', 'week', 'month'] as TimeScale[]) {
      const btn = $('button.db-timeline-scale-btn');
      btn.textContent = SCALE_LABEL_MAP[scale];
      if (scale === this._scale) btn.classList.add('db-timeline-scale-btn--active');
      toggleEl.appendChild(btn);

      this._renderDisposables.add(
        addDisposableListener(btn, 'click', () => {
          this._scale = scale;
          this._render();
        }),
      );
    }
  }

  private _renderTimeAxis(parent: HTMLElement, totalDays: number, dayWidth: number): void {
    const axisEl = $('div.db-timeline-axis');
    axisEl.style.height = `${HEADER_HEIGHT}px`;
    axisEl.style.paddingLeft = `${LABEL_WIDTH}px`;
    parent.appendChild(axisEl);

    const current = new Date(this._viewStart);
    let lastLabel = '';

    for (let i = 0; i < totalDays; i++) {
      let label = '';

      if (this._scale === 'day') {
        label = `${current.getDate()}`;
        // Show month label at start and month boundaries
        if (i === 0 || current.getDate() === 1) {
          label = `${this._shortMonthName(current.getMonth())} ${current.getDate()}`;
        }
      } else if (this._scale === 'week') {
        // Label on Mondays or first day
        if (i === 0 || current.getDay() === 1) {
          label = `${this._shortMonthName(current.getMonth())} ${current.getDate()}`;
        }
      } else {
        // month scale: label on 1st of each month
        if (i === 0 || current.getDate() === 1) {
          label = `${this._shortMonthName(current.getMonth())} ${current.getFullYear()}`;
        }
      }

      if (label && label !== lastLabel) {
        const tick = $('div.db-timeline-tick');
        tick.style.left = `${LABEL_WIDTH + i * dayWidth}px`;
        tick.textContent = label;
        axisEl.appendChild(tick);
        lastLabel = label;
      }

      current.setDate(current.getDate() + 1);
    }
  }

  private _renderRows(parent: HTMLElement, allRows: IDatabaseRow[], dayWidth: number): void {
    const rowsEl = $('div.db-timeline-rows');
    rowsEl.style.position = 'relative';
    rowsEl.style.paddingTop = `${HEADER_HEIGHT}px`;
    parent.appendChild(rowsEl);

    for (let i = 0; i < allRows.length; i++) {
      const row = allRows[i];
      const y = i * ROW_HEIGHT;

      // Row label (left side)
      const labelEl = $('div.db-timeline-row-label');
      labelEl.style.top = `${y}px`;
      labelEl.style.height = `${ROW_HEIGHT}px`;
      labelEl.style.width = `${LABEL_WIDTH}px`;
      labelEl.textContent = row.page.title || 'Untitled';
      rowsEl.appendChild(labelEl);

      // Bar
      const startDate = this._getRowStartDate(row);
      const endDate = this._getRowEndDate(row);

      if (startDate) {
        const barStart = this._daysBetween(this._viewStart, startDate);
        const barDuration = endDate
          ? Math.max(1, this._daysBetween(startDate, endDate))
          : 1;

        const barEl = $('div.db-timeline-bar');
        barEl.style.left = `${LABEL_WIDTH + barStart * dayWidth}px`;
        barEl.style.width = `${barDuration * dayWidth}px`;
        barEl.style.top = `${y + 4}px`;
        barEl.style.height = `${ROW_HEIGHT - 8}px`;
        rowsEl.appendChild(barEl);

        // Bar title
        const barTitle = $('span.db-timeline-bar-title');
        barTitle.textContent = row.page.title || 'Untitled';
        barEl.appendChild(barTitle);

        // Click to open page
        this._renderDisposables.add(
          addDisposableListener(barEl, 'click', () => {
            this._openEditor?.({
              typeId: 'canvas',
              title: row.page.title || 'Untitled',
              icon: row.page.icon ?? undefined,
              instanceId: row.page.id,
            });
          }),
        );

        // Drag handles for resizing
        this._renderBarHandles(barEl, row, dayWidth);
      }

      // Row line
      this._renderDisposables.add(
        addDisposableListener(labelEl, 'click', () => {
          this._openEditor?.({
            typeId: 'canvas',
            title: row.page.title || 'Untitled',
            icon: row.page.icon ?? undefined,
            instanceId: row.page.id,
          });
        }),
      );
    }
  }

  private _renderBarHandles(barEl: HTMLElement, row: IDatabaseRow, dayWidth: number): void {
    // Left handle — adjust start date
    const leftHandle = $('div.db-timeline-handle.db-timeline-handle--left');
    barEl.appendChild(leftHandle);

    // Right handle — adjust end date
    const rightHandle = $('div.db-timeline-handle.db-timeline-handle--right');
    barEl.appendChild(rightHandle);

    // Drag to resize (start date)
    this._addDragHandler(leftHandle, barEl, row, 'start', dayWidth);
    this._addDragHandler(rightHandle, barEl, row, 'end', dayWidth);
  }

  private _addDragHandler(
    handle: HTMLElement,
    barEl: HTMLElement,
    row: IDatabaseRow,
    edge: 'start' | 'end',
    dayWidth: number,
  ): void {
    let startX = 0;
    let initialWidth = 0;
    let initialLeft = 0;

    const onMouseMove = (e: MouseEvent): void => {
      const dx = e.clientX - startX;
      const dayDelta = Math.round(dx / dayWidth);

      if (edge === 'start') {
        barEl.style.left = `${initialLeft + dayDelta * dayWidth}px`;
        barEl.style.width = `${Math.max(dayWidth, initialWidth - dayDelta * dayWidth)}px`;
      } else {
        barEl.style.width = `${Math.max(dayWidth, initialWidth + dayDelta * dayWidth)}px`;
      }
    };

    const onMouseUp = async (e: MouseEvent): Promise<void> => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);

      const dx = e.clientX - startX;
      const dayDelta = Math.round(dx / dayWidth);
      if (dayDelta === 0) return;

      try {
        if (edge === 'start' && this._startDateProp) {
          const currentStart = this._getRowStartDate(row);
          if (currentStart) {
            currentStart.setDate(currentStart.getDate() + dayDelta);
            const dateValue: IPropertyValue = {
              type: 'date',
              date: { start: this._formatDateKey(currentStart), end: null },
            };
            await this._dataService.setPropertyValue(
              this._databaseId, row.page.id, this._startDateProp.id, dateValue,
            );
          }
        } else if (edge === 'end' && this._endDateProp) {
          const currentEnd = this._getRowEndDate(row) ?? this._getRowStartDate(row);
          if (currentEnd) {
            currentEnd.setDate(currentEnd.getDate() + dayDelta);
            const dateValue: IPropertyValue = {
              type: 'date',
              date: { start: this._formatDateKey(currentEnd), end: null },
            };
            await this._dataService.setPropertyValue(
              this._databaseId, row.page.id, this._endDateProp.id, dateValue,
            );
          }
        }
      } catch (err) {
        console.error('[TimelineView] Failed to update date:', err);
      }
    };

    this._renderDisposables.add(
      addDisposableListener(handle, 'mousedown', (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        startX = e.clientX;
        initialWidth = barEl.offsetWidth;
        initialLeft = barEl.offsetLeft;
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
      }),
    );
  }

  private _renderFooter(): void {
    const footerEl = $('div.db-timeline-footer');
    this._timelineEl.appendChild(footerEl);

    const addBtn = $('button.db-timeline-add-row');
    addBtn.textContent = '+ New';
    footerEl.appendChild(addBtn);

    this._renderDisposables.add(
      addDisposableListener(addBtn, 'click', async () => {
        try {
          await this._dataService.addRow(this._databaseId);
        } catch (err) {
          console.error('[TimelineView] Failed to add row:', err);
        }
      }),
    );
  }

  // ─── Helpers ─────────────────────────────────────────────────────────

  private _resolveStartDateProperty(): IDatabaseProperty | null {
    const configId = this._view.config.dateProperty;
    if (configId) {
      const prop = this._properties.find(p => p.id === configId);
      if (prop) return prop;
    }
    return this._properties.find(p => p.type === 'date') ?? null;
  }

  private _resolveEndDateProperty(): IDatabaseProperty | null {
    const configId = this._view.config.dateEndProperty;
    if (configId) {
      const prop = this._properties.find(p => p.id === configId);
      if (prop) return prop;
    }
    // Look for a second date property
    const dateProps = this._properties.filter(p => p.type === 'date');
    if (dateProps.length >= 2 && this._startDateProp) {
      return dateProps.find(p => p.id !== this._startDateProp!.id) ?? null;
    }
    return null;
  }

  private _getRowStartDate(row: IDatabaseRow): Date | null {
    if (!this._startDateProp) return null;
    const value = row.values[this._startDateProp.id];
    if (!value || value.type !== 'date' || !value.date?.start) return null;
    return new Date(value.date.start);
  }

  private _getRowEndDate(row: IDatabaseRow): Date | null {
    if (!this._endDateProp) return null;
    const value = row.values[this._endDateProp.id];
    if (!value || value.type !== 'date' || !value.date?.start) return null;
    return new Date(value.date.start);
  }

  private _computeViewBounds(): void {
    const now = new Date();
    // Default: show 3 months centered on today
    this._viewStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    this._viewEnd = new Date(now.getFullYear(), now.getMonth() + 2, 0);

    // Expand bounds to fit all row dates
    const allRows = this._getAllRows();
    for (const row of allRows) {
      const start = this._getRowStartDate(row);
      const end = this._getRowEndDate(row);
      if (start && start < this._viewStart) {
        this._viewStart = new Date(start.getFullYear(), start.getMonth(), 1);
      }
      if (end && end > this._viewEnd) {
        this._viewEnd = new Date(end.getFullYear(), end.getMonth() + 1, 0);
      }
      if (start && !end && start > this._viewEnd) {
        this._viewEnd = new Date(start.getFullYear(), start.getMonth() + 1, 0);
      }
    }

    // Add padding
    this._viewStart.setDate(this._viewStart.getDate() - 7);
    this._viewEnd.setDate(this._viewEnd.getDate() + 7);
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

  private _daysBetween(a: Date, b: Date): number {
    const msPerDay = 86400000;
    return Math.round((b.getTime() - a.getTime()) / msPerDay);
  }

  private _formatDateKey(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  private _shortMonthName(monthIndex: number): string {
    const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return names[monthIndex] ?? '';
  }

  // ─── Dispose ─────────────────────────────────────────────────────────

  override dispose(): void {
    this._renderDisposables.clear();
    this._timelineEl.remove();
    super.dispose();
  }
}
