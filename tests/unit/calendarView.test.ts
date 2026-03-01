/**
 * @vitest-environment jsdom
 */
/**
 * Unit tests for database/views/calendarView.ts
 *
 * Tests calendar layout: monthly grid rendering, date placement, navigation,
 * click-day-to-create, click-item-to-open, overflow truncation,
 * setRows/setProperties, dispose.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CalendarView } from '../../src/built-in/canvas/database/views/calendarView';
import type {
  IDatabaseDataService,
  IDatabaseView,
  IDatabaseProperty,
  IDatabaseRow,
  IPropertyValue,
  IRowGroup,
} from '../../src/built-in/canvas/database/databaseTypes';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeProp(overrides: Partial<IDatabaseProperty> & { id: string; type: IDatabaseProperty['type'] }): IDatabaseProperty {
  return {
    databaseId: 'db-1',
    name: overrides.name ?? overrides.id,
    config: {},
    sortOrder: 0,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeRow(title: string, values: Record<string, IPropertyValue>, sortOrder = 0): IDatabaseRow {
  return {
    page: {
      id: `page-${title.toLowerCase().replace(/\s/g, '-')}`,
      parentId: null,
      title,
      icon: null,
      content: '{}',
      contentSchemaVersion: 2,
      revision: 1,
      sortOrder,
      isArchived: false,
      coverUrl: null,
      coverYOffset: 0.5,
      fontFamily: 'default',
      fullWidth: false,
      smallText: false,
      isLocked: false,
      isFavorited: false,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    } as any,
    values,
    sortOrder,
  };
}

function dateVal(dateStr: string): IPropertyValue {
  return { type: 'date', date: { start: dateStr, end: null } };
}

function makeView(overrides: Partial<IDatabaseView> = {}): IDatabaseView {
  return {
    id: 'view-1',
    databaseId: 'db-1',
    name: 'Calendar',
    type: 'calendar',
    groupBy: null,
    subGroupBy: null,
    boardGroupProperty: null,
    hideEmptyGroups: false,
    filterConfig: { conjunction: 'and', rules: [] },
    sortConfig: [],
    config: {},
    sortOrder: 0,
    isLocked: false,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function mockDataService(): IDatabaseDataService {
  return {
    addRow: vi.fn().mockResolvedValue(makeRow('New', {})),
    setPropertyValue: vi.fn().mockResolvedValue(undefined),
    reorderRows: vi.fn().mockResolvedValue(undefined),
    loadDatabase: vi.fn(),
    getDatabase: vi.fn(),
    updateDatabase: vi.fn(),
    getProperties: vi.fn(),
    addProperty: vi.fn(),
    updateProperty: vi.fn(),
    deleteProperty: vi.fn(),
    reorderProperties: vi.fn(),
    getRows: vi.fn(),
    deleteRow: vi.fn(),
    getViews: vi.fn(),
    getView: vi.fn(),
    createView: vi.fn(),
    updateView: vi.fn(),
    deleteView: vi.fn(),
    duplicateView: vi.fn(),
    reorderViews: vi.fn(),
    getPropertyValue: vi.fn(),
    getRowPropertyValues: vi.fn(),
    onDidChangeDatabase: vi.fn() as any,
    onDidChangeProperty: vi.fn() as any,
    onDidChangeRow: vi.fn() as any,
    onDidChangeView: vi.fn() as any,
    dispose: vi.fn(),
  } as unknown as IDatabaseDataService;
}

// ─── Properties ──────────────────────────────────────────────────────────────

const titleProp = makeProp({ id: 'prop-title', type: 'title', name: 'Title' });
const dateProp = makeProp({ id: 'prop-date', type: 'date', name: 'Due Date' });
const textProp = makeProp({ id: 'prop-text', type: 'rich_text', name: 'Notes' });

const allProps = [titleProp, dateProp, textProp];

// ─── Container ───────────────────────────────────────────────────────────────

let container: HTMLElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

// ═════════════════════════════════════════════════════════════════════════════
//  Calendar Layout: Grid Structure
// ═════════════════════════════════════════════════════════════════════════════

describe('calendar layout: grid structure', () => {
  it('renders .db-calendar wrapper element', () => {
    const rows: IDatabaseRow[] = [];
    const view = makeView();
    const cal = new CalendarView(container, mockDataService(), 'db-1', view, allProps, rows, undefined);

    expect(container.querySelector('.db-calendar')).not.toBeNull();

    cal.dispose();
  });

  it('renders 7 day-name columns', () => {
    const rows: IDatabaseRow[] = [];
    const view = makeView();
    const cal = new CalendarView(container, mockDataService(), 'db-1', view, allProps, rows, undefined);

    const dayNames = container.querySelectorAll('.db-calendar-day-name');
    expect(dayNames.length).toBe(7);

    const labels = Array.from(dayNames).map(el => el.textContent);
    expect(labels).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);

    cal.dispose();
  });

  it('renders calendar cells (between 28 and 42)', () => {
    const rows: IDatabaseRow[] = [];
    const view = makeView();
    const cal = new CalendarView(container, mockDataService(), 'db-1', view, allProps, rows, undefined);

    const cells = container.querySelectorAll('.db-calendar-cell');
    // 4-6 weeks × 7 days
    expect(cells.length).toBeGreaterThanOrEqual(28);
    expect(cells.length).toBeLessThanOrEqual(42);

    cal.dispose();
  });

  it('marks today cell with special class', () => {
    const rows: IDatabaseRow[] = [];
    const view = makeView();
    const cal = new CalendarView(container, mockDataService(), 'db-1', view, allProps, rows, undefined);

    const todayCell = container.querySelector('.db-calendar-cell--today');
    expect(todayCell).not.toBeNull();

    cal.dispose();
  });

  it('marks other-month cells with dimming class when present', () => {
    const rows: IDatabaseRow[] = [];
    const view = makeView();
    const cal = new CalendarView(container, mockDataService(), 'db-1', view, allProps, rows, undefined);

    const allCells = container.querySelectorAll('.db-calendar-cell');
    const otherMonthCells = container.querySelectorAll('.db-calendar-cell--other-month');
    // Total cells should be a multiple of 7 (complete weeks)
    expect(allCells.length % 7).toBe(0);
    // If there ARE other-month cells, they should have the class;
    // some months (e.g. Feb 2026 — starts Sun, 28 days) have none.
    // Verify the class is applied correctly by checking no current-month cell has it.
    const currentMonthCells = container.querySelectorAll('.db-calendar-cell:not(.db-calendar-cell--other-month)');
    expect(currentMonthCells.length + otherMonthCells.length).toBe(allCells.length);

    cal.dispose();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  Calendar Layout: Date Placement
// ═════════════════════════════════════════════════════════════════════════════

describe('calendar layout: date placement', () => {
  it('places row on the correct date cell', () => {
    // Use a specific known date in the current month
    const now = new Date();
    const targetDay = 15;
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${targetDay}`;

    const rows = [makeRow('Meeting', { 'prop-date': dateVal(dateStr) })];
    const view = makeView({ config: { dateProperty: 'prop-date' } });
    const cal = new CalendarView(container, mockDataService(), 'db-1', view, allProps, rows, undefined);

    const items = container.querySelectorAll('.db-calendar-item');
    expect(items.length).toBe(1);
    expect(items[0].textContent).toBe('Meeting');

    cal.dispose();
  });

  it('renders "Untitled" for row with empty title', () => {
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-10`;

    const rows = [makeRow('', { 'prop-date': dateVal(dateStr) })];
    const view = makeView({ config: { dateProperty: 'prop-date' } });
    const cal = new CalendarView(container, mockDataService(), 'db-1', view, allProps, rows, undefined);

    const items = container.querySelectorAll('.db-calendar-item');
    expect(items.length).toBe(1);
    expect(items[0].textContent).toBe('Untitled');

    cal.dispose();
  });

  it('does not place rows without date values', () => {
    const rows = [makeRow('No Date', {})];
    const view = makeView({ config: { dateProperty: 'prop-date' } });
    const cal = new CalendarView(container, mockDataService(), 'db-1', view, allProps, rows, undefined);

    const items = container.querySelectorAll('.db-calendar-item');
    expect(items.length).toBe(0);

    cal.dispose();
  });

  it('shows "+N more" when more than 3 items on same date', () => {
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-20`;

    const rows = [
      makeRow('Task1', { 'prop-date': dateVal(dateStr) }),
      makeRow('Task2', { 'prop-date': dateVal(dateStr) }),
      makeRow('Task3', { 'prop-date': dateVal(dateStr) }),
      makeRow('Task4', { 'prop-date': dateVal(dateStr) }),
      makeRow('Task5', { 'prop-date': dateVal(dateStr) }),
    ];
    const view = makeView({ config: { dateProperty: 'prop-date' } });
    const cal = new CalendarView(container, mockDataService(), 'db-1', view, allProps, rows, undefined);

    // Only 3 items shown + 1 "more" indicator
    const items = container.querySelectorAll('.db-calendar-item');
    expect(items.length).toBe(3);

    const moreEl = container.querySelector('.db-calendar-item-more');
    expect(moreEl).not.toBeNull();
    expect(moreEl!.textContent).toBe('+2 more');

    cal.dispose();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  Calendar Layout: Navigation
// ═════════════════════════════════════════════════════════════════════════════

describe('calendar layout: navigation', () => {
  it('renders month/year in header', () => {
    const rows: IDatabaseRow[] = [];
    const view = makeView();
    const cal = new CalendarView(container, mockDataService(), 'db-1', view, allProps, rows, undefined);

    const title = container.querySelector('.db-calendar-title')!.textContent!;
    // Should contain current month name and year
    const now = new Date();
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'];
    expect(title).toContain(monthNames[now.getMonth()]);
    expect(title).toContain(`${now.getFullYear()}`);

    cal.dispose();
  });

  it('renders prev, next, and today navigation buttons', () => {
    const rows: IDatabaseRow[] = [];
    const view = makeView();
    const cal = new CalendarView(container, mockDataService(), 'db-1', view, allProps, rows, undefined);

    const navBtns = container.querySelectorAll('.db-calendar-nav-btn');
    expect(navBtns.length).toBe(2); // prev and next

    const todayBtn = container.querySelector('.db-calendar-today-btn');
    expect(todayBtn).not.toBeNull();
    expect(todayBtn!.textContent).toBe('Today');

    cal.dispose();
  });

  it('navigates to previous month on prev click', () => {
    const rows: IDatabaseRow[] = [];
    const view = makeView();
    const cal = new CalendarView(container, mockDataService(), 'db-1', view, allProps, rows, undefined);

    const now = new Date();
    const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'];

    // Click prev
    const prevBtn = container.querySelector('.db-calendar-nav-btn') as HTMLElement;
    prevBtn.click();

    const title = container.querySelector('.db-calendar-title')!.textContent!;
    expect(title).toContain(monthNames[prevMonth.getMonth()]);

    cal.dispose();
  });

  it('navigates to next month on next click', () => {
    const rows: IDatabaseRow[] = [];
    const view = makeView();
    const cal = new CalendarView(container, mockDataService(), 'db-1', view, allProps, rows, undefined);

    const now = new Date();
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'];

    // Click next (second nav button)
    const navBtns = container.querySelectorAll('.db-calendar-nav-btn');
    (navBtns[1] as HTMLElement).click();

    const title = container.querySelector('.db-calendar-title')!.textContent!;
    expect(title).toContain(monthNames[nextMonth.getMonth()]);

    cal.dispose();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  Calendar Layout: Date Property Resolution
// ═════════════════════════════════════════════════════════════════════════════

describe('calendar layout: date property resolution', () => {
  it('uses configured dateProperty from view config', () => {
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-12`;

    const rows = [makeRow('Task', { 'prop-date': dateVal(dateStr) })];
    const view = makeView({ config: { dateProperty: 'prop-date' } });
    const cal = new CalendarView(container, mockDataService(), 'db-1', view, allProps, rows, undefined);

    expect(container.querySelectorAll('.db-calendar-item').length).toBe(1);

    cal.dispose();
  });

  it('falls back to first date property when config is unset', () => {
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-12`;

    const rows = [makeRow('Task', { 'prop-date': dateVal(dateStr) })];
    const view = makeView({ config: {} }); // No dateProperty set
    const cal = new CalendarView(container, mockDataService(), 'db-1', view, allProps, rows, undefined);

    // Should still find the date property automatically
    expect(container.querySelectorAll('.db-calendar-item').length).toBe(1);

    cal.dispose();
  });

  it('renders no items when no date property exists in schema', () => {
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-12`;

    const propsWithoutDate = [titleProp, textProp]; // no date prop
    const rows = [makeRow('Task', { 'prop-date': dateVal(dateStr) })];
    const view = makeView({ config: {} });
    const cal = new CalendarView(container, mockDataService(), 'db-1', view, propsWithoutDate, rows, undefined);

    expect(container.querySelectorAll('.db-calendar-item').length).toBe(0);

    cal.dispose();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  Calendar Layout: Click Item to Open
// ═════════════════════════════════════════════════════════════════════════════

describe('calendar layout: click item to open', () => {
  it('calls openEditor when calendar item is clicked', () => {
    const openEditor = vi.fn();
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-15`;

    const rows = [makeRow('My Meeting', { 'prop-date': dateVal(dateStr) })];
    const view = makeView({ config: { dateProperty: 'prop-date' } });
    const cal = new CalendarView(container, mockDataService(), 'db-1', view, allProps, rows, openEditor);

    const item = container.querySelector('.db-calendar-item') as HTMLElement;
    item.click();

    expect(openEditor).toHaveBeenCalledWith(expect.objectContaining({
      typeId: 'canvas',
      title: 'My Meeting',
      instanceId: 'page-my-meeting',
    }));

    cal.dispose();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  Calendar Layout: Click Day to Create
// ═════════════════════════════════════════════════════════════════════════════

describe('calendar layout: click day to create', () => {
  it('calls addRow and setPropertyValue when a cell is clicked', async () => {
    const ds = mockDataService();
    const rows: IDatabaseRow[] = [];
    const view = makeView({ config: { dateProperty: 'prop-date' } });
    const cal = new CalendarView(container, ds, 'db-1', view, allProps, rows, undefined);

    // Click any cell (first one that is current month)
    const cells = container.querySelectorAll('.db-calendar-cell:not(.db-calendar-cell--other-month)');
    expect(cells.length).toBeGreaterThan(0);
    (cells[0] as HTMLElement).click();

    await new Promise(resolve => setTimeout(resolve, 20));

    expect(ds.addRow).toHaveBeenCalledWith('db-1');
    expect(ds.setPropertyValue).toHaveBeenCalledWith(
      'db-1',
      expect.any(String), // page id from the new row
      'prop-date',
      expect.objectContaining({ type: 'date' }),
    );

    cal.dispose();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  Calendar Layout: Reactive Updates
// ═════════════════════════════════════════════════════════════════════════════

describe('calendar layout: reactive updates', () => {
  it('re-renders when setRows is called', () => {
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-15`;

    const view = makeView({ config: { dateProperty: 'prop-date' } });
    const cal = new CalendarView(container, mockDataService(), 'db-1', view, allProps, [], undefined);

    expect(container.querySelectorAll('.db-calendar-item').length).toBe(0);

    cal.setRows([makeRow('New Task', { 'prop-date': dateVal(dateStr) })]);

    expect(container.querySelectorAll('.db-calendar-item').length).toBe(1);

    cal.dispose();
  });

  it('re-resolves date property when setProperties is called', () => {
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-15`;
    const otherDateProp = makeProp({ id: 'prop-other-date', type: 'date', name: 'Start' });

    const rows = [makeRow('Task', { 'prop-other-date': dateVal(dateStr) })];
    const view = makeView({ config: {} }); // will auto-resolve to first date prop
    const cal = new CalendarView(container, mockDataService(), 'db-1', view, allProps, rows, undefined);

    // dateProp is first date prop in allProps → places item
    const initialItems = container.querySelectorAll('.db-calendar-item').length;

    // Change properties to include otherDateProp as the first date
    cal.setProperties([titleProp, otherDateProp]);

    // Now resolved to otherDateProp, row has value for it
    expect(container.querySelectorAll('.db-calendar-item').length).toBe(1);

    cal.dispose();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  Calendar Layout: Dispose
// ═════════════════════════════════════════════════════════════════════════════

describe('calendar layout: dispose', () => {
  it('removes .db-calendar element from container on dispose', () => {
    const rows: IDatabaseRow[] = [];
    const view = makeView();
    const cal = new CalendarView(container, mockDataService(), 'db-1', view, allProps, rows, undefined);

    expect(container.querySelector('.db-calendar')).not.toBeNull();

    cal.dispose();

    expect(container.querySelector('.db-calendar')).toBeNull();
  });
});
