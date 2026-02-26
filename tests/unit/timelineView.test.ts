/**
 * @vitest-environment jsdom
 */
/**
 * Unit tests for database/views/timelineView.ts
 *
 * Tests timeline layout: Gantt bar rendering, scale toggle, date range bars,
 * row labels, drag handles, footer, setRows/setProperties, dispose.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TimelineView } from '../../src/built-in/canvas/database/views/timelineView';
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
    name: 'Timeline',
    type: 'timeline',
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
const startDateProp = makeProp({ id: 'prop-start', type: 'date', name: 'Start Date' });
const endDateProp = makeProp({ id: 'prop-end', type: 'date', name: 'End Date' });
const textProp = makeProp({ id: 'prop-text', type: 'rich_text', name: 'Notes' });

const allProps = [titleProp, startDateProp, endDateProp, textProp];

// ─── Container ───────────────────────────────────────────────────────────────

let container: HTMLElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

// ═════════════════════════════════════════════════════════════════════════════
//  Timeline Layout: Structure
// ═════════════════════════════════════════════════════════════════════════════

describe('timeline layout: structure', () => {
  it('renders .db-timeline wrapper element', () => {
    const rows: IDatabaseRow[] = [];
    const view = makeView();
    const tl = new TimelineView(container, mockDataService(), 'db-1', view, allProps, rows, undefined);

    expect(container.querySelector('.db-timeline')).not.toBeNull();

    tl.dispose();
  });

  it('renders scale toggle buttons', () => {
    const rows: IDatabaseRow[] = [];
    const view = makeView();
    const tl = new TimelineView(container, mockDataService(), 'db-1', view, allProps, rows, undefined);

    const btns = container.querySelectorAll('.db-timeline-scale-btn');
    expect(btns.length).toBe(3);

    const labels = Array.from(btns).map(b => b.textContent);
    expect(labels).toEqual(['Day', 'Week', 'Month']);

    tl.dispose();
  });

  it('marks default scale (week) as active', () => {
    const rows: IDatabaseRow[] = [];
    const view = makeView();
    const tl = new TimelineView(container, mockDataService(), 'db-1', view, allProps, rows, undefined);

    const activeBtn = container.querySelector('.db-timeline-scale-btn--active');
    expect(activeBtn).not.toBeNull();
    expect(activeBtn!.textContent).toBe('Week');

    tl.dispose();
  });

  it('renders scroll container', () => {
    const rows: IDatabaseRow[] = [];
    const view = makeView();
    const tl = new TimelineView(container, mockDataService(), 'db-1', view, allProps, rows, undefined);

    const scroll = container.querySelector('.db-timeline-scroll');
    expect(scroll).not.toBeNull();

    tl.dispose();
  });

  it('renders time axis', () => {
    const rows: IDatabaseRow[] = [];
    const view = makeView();
    const tl = new TimelineView(container, mockDataService(), 'db-1', view, allProps, rows, undefined);

    const axis = container.querySelector('.db-timeline-axis');
    expect(axis).not.toBeNull();

    tl.dispose();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  Timeline Layout: Bar Rendering
// ═════════════════════════════════════════════════════════════════════════════

describe('timeline layout: bar rendering', () => {
  it('renders a bar for each row with a start date', () => {
    const rows = [
      makeRow('Task1', { 'prop-start': dateVal('2025-06-15'), 'prop-end': dateVal('2025-06-20') }),
      makeRow('Task2', { 'prop-start': dateVal('2025-06-18') }),
    ];
    const view = makeView({ config: { dateProperty: 'prop-start', dateEndProperty: 'prop-end' } });
    const tl = new TimelineView(container, mockDataService(), 'db-1', view, allProps, rows, undefined);

    const bars = container.querySelectorAll('.db-timeline-bar');
    expect(bars.length).toBe(2);

    tl.dispose();
  });

  it('renders bar title', () => {
    const rows = [
      makeRow('My Project', { 'prop-start': dateVal('2025-06-15'), 'prop-end': dateVal('2025-06-25') }),
    ];
    const view = makeView({ config: { dateProperty: 'prop-start', dateEndProperty: 'prop-end' } });
    const tl = new TimelineView(container, mockDataService(), 'db-1', view, allProps, rows, undefined);

    const barTitle = container.querySelector('.db-timeline-bar-title');
    expect(barTitle).not.toBeNull();
    expect(barTitle!.textContent).toBe('My Project');

    tl.dispose();
  });

  it('renders "Untitled" for empty title bars', () => {
    const rows = [
      makeRow('', { 'prop-start': dateVal('2025-06-15') }),
    ];
    const view = makeView({ config: { dateProperty: 'prop-start' } });
    const tl = new TimelineView(container, mockDataService(), 'db-1', view, allProps, rows, undefined);

    const barTitle = container.querySelector('.db-timeline-bar-title');
    expect(barTitle!.textContent).toBe('Untitled');

    tl.dispose();
  });

  it('renders row labels on left side', () => {
    const rows = [
      makeRow('Alpha', { 'prop-start': dateVal('2025-06-10') }),
      makeRow('Beta', { 'prop-start': dateVal('2025-06-12') }),
    ];
    const view = makeView({ config: { dateProperty: 'prop-start' } });
    const tl = new TimelineView(container, mockDataService(), 'db-1', view, allProps, rows, undefined);

    const labels = Array.from(container.querySelectorAll('.db-timeline-row-label'))
      .map(el => el.textContent);
    expect(labels).toEqual(['Alpha', 'Beta']);

    tl.dispose();
  });

  it('does not render bar for rows without start date', () => {
    const rows = [
      makeRow('No Date', {}),
    ];
    const view = makeView({ config: { dateProperty: 'prop-start' } });
    const tl = new TimelineView(container, mockDataService(), 'db-1', view, allProps, rows, undefined);

    // Label still rendered, but no bar
    expect(container.querySelectorAll('.db-timeline-row-label').length).toBe(1);
    expect(container.querySelectorAll('.db-timeline-bar').length).toBe(0);

    tl.dispose();
  });

  it('renders drag handles on bars', () => {
    const rows = [
      makeRow('Task', { 'prop-start': dateVal('2025-06-15'), 'prop-end': dateVal('2025-06-20') }),
    ];
    const view = makeView({ config: { dateProperty: 'prop-start', dateEndProperty: 'prop-end' } });
    const tl = new TimelineView(container, mockDataService(), 'db-1', view, allProps, rows, undefined);

    const leftHandle = container.querySelector('.db-timeline-handle--left');
    const rightHandle = container.querySelector('.db-timeline-handle--right');
    expect(leftHandle).not.toBeNull();
    expect(rightHandle).not.toBeNull();

    tl.dispose();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  Timeline Layout: Scale Toggle
// ═════════════════════════════════════════════════════════════════════════════

describe('timeline layout: scale toggle', () => {
  it('changes active scale on button click', () => {
    const rows: IDatabaseRow[] = [];
    const view = makeView();
    const tl = new TimelineView(container, mockDataService(), 'db-1', view, allProps, rows, undefined);

    // Click "Day" button
    const dayBtn = container.querySelectorAll('.db-timeline-scale-btn')[0] as HTMLElement;
    dayBtn.click();

    const activeBtn = container.querySelector('.db-timeline-scale-btn--active');
    expect(activeBtn!.textContent).toBe('Day');

    tl.dispose();
  });

  it('re-renders timeline on scale change', () => {
    const rows = [
      makeRow('Task', { 'prop-start': dateVal('2025-06-15'), 'prop-end': dateVal('2025-06-25') }),
    ];
    const view = makeView({ config: { dateProperty: 'prop-start', dateEndProperty: 'prop-end' } });
    const tl = new TimelineView(container, mockDataService(), 'db-1', view, allProps, rows, undefined);

    const initialWidth = (container.querySelector('.db-timeline-inner') as HTMLElement)?.style.width;

    // Switch to month scale
    const monthBtn = container.querySelectorAll('.db-timeline-scale-btn')[2] as HTMLElement;
    monthBtn.click();

    const newWidth = (container.querySelector('.db-timeline-inner') as HTMLElement)?.style.width;
    // Width should change since day width changes
    expect(newWidth).not.toBe(initialWidth);

    tl.dispose();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  Timeline Layout: Date Property Resolution
// ═════════════════════════════════════════════════════════════════════════════

describe('timeline layout: date property resolution', () => {
  it('uses configured dateProperty for start', () => {
    const rows = [makeRow('Task', { 'prop-start': dateVal('2025-06-15') })];
    const view = makeView({ config: { dateProperty: 'prop-start' } });
    const tl = new TimelineView(container, mockDataService(), 'db-1', view, allProps, rows, undefined);

    expect(container.querySelectorAll('.db-timeline-bar').length).toBe(1);

    tl.dispose();
  });

  it('falls back to first date property when config is unset', () => {
    const rows = [makeRow('Task', { 'prop-start': dateVal('2025-06-15') })];
    const view = makeView({ config: {} });
    const tl = new TimelineView(container, mockDataService(), 'db-1', view, allProps, rows, undefined);

    // Should auto-resolve to startDateProp (first date prop)
    expect(container.querySelectorAll('.db-timeline-bar').length).toBe(1);

    tl.dispose();
  });

  it('auto-resolves second date property as end date', () => {
    const rows = [
      makeRow('Task', {
        'prop-start': dateVal('2025-06-15'),
        'prop-end': dateVal('2025-06-20'),
      }),
    ];
    const view = makeView({ config: {} }); // no explicit config
    const tl = new TimelineView(container, mockDataService(), 'db-1', view, allProps, rows, undefined);

    const bar = container.querySelector('.db-timeline-bar') as HTMLElement;
    expect(bar).not.toBeNull();
    // Bar width should reflect a multi-day range (not just 1 day)
    const width = parseInt(bar.style.width, 10);
    expect(width).toBeGreaterThan(12); // weekScale dayWidth=12, 5 days ≥ 60px

    tl.dispose();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  Timeline Layout: Click to Open
// ═════════════════════════════════════════════════════════════════════════════

describe('timeline layout: click to open', () => {
  it('calls openEditor when bar is clicked', () => {
    const openEditor = vi.fn();
    const rows = [
      makeRow('My Task', { 'prop-start': dateVal('2025-06-15') }),
    ];
    const view = makeView({ config: { dateProperty: 'prop-start' } });
    const tl = new TimelineView(container, mockDataService(), 'db-1', view, allProps, rows, openEditor);

    const bar = container.querySelector('.db-timeline-bar') as HTMLElement;
    bar.click();

    expect(openEditor).toHaveBeenCalledWith(expect.objectContaining({
      typeId: 'canvas',
      title: 'My Task',
      instanceId: 'page-my-task',
    }));

    tl.dispose();
  });

  it('calls openEditor when row label is clicked', () => {
    const openEditor = vi.fn();
    const rows = [
      makeRow('My Task', { 'prop-start': dateVal('2025-06-15') }),
    ];
    const view = makeView({ config: { dateProperty: 'prop-start' } });
    const tl = new TimelineView(container, mockDataService(), 'db-1', view, allProps, rows, openEditor);

    const label = container.querySelector('.db-timeline-row-label') as HTMLElement;
    label.click();

    expect(openEditor).toHaveBeenCalledWith(expect.objectContaining({
      typeId: 'canvas',
      instanceId: 'page-my-task',
    }));

    tl.dispose();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  Timeline Layout: Footer
// ═════════════════════════════════════════════════════════════════════════════

describe('timeline layout: footer', () => {
  it('renders a "+ New" button', () => {
    const rows: IDatabaseRow[] = [];
    const view = makeView();
    const tl = new TimelineView(container, mockDataService(), 'db-1', view, allProps, rows, undefined);

    const addBtn = container.querySelector('.db-timeline-add-row');
    expect(addBtn).not.toBeNull();
    expect(addBtn!.textContent).toBe('+ New');

    tl.dispose();
  });

  it('calls addRow on button click', async () => {
    const ds = mockDataService();
    const rows: IDatabaseRow[] = [];
    const view = makeView();
    const tl = new TimelineView(container, ds, 'db-1', view, allProps, rows, undefined);

    const addBtn = container.querySelector('.db-timeline-add-row') as HTMLElement;
    addBtn.click();

    await new Promise(resolve => setTimeout(resolve, 10));

    expect(ds.addRow).toHaveBeenCalledWith('db-1');

    tl.dispose();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  Timeline Layout: Reactive Updates
// ═════════════════════════════════════════════════════════════════════════════

describe('timeline layout: reactive updates', () => {
  it('re-renders when setRows is called', () => {
    const view = makeView({ config: { dateProperty: 'prop-start' } });
    const tl = new TimelineView(container, mockDataService(), 'db-1', view, allProps, [], undefined);

    expect(container.querySelectorAll('.db-timeline-bar').length).toBe(0);

    tl.setRows([
      makeRow('Task1', { 'prop-start': dateVal('2025-06-15') }),
      makeRow('Task2', { 'prop-start': dateVal('2025-06-18') }),
    ]);

    expect(container.querySelectorAll('.db-timeline-bar').length).toBe(2);

    tl.dispose();
  });

  it('re-resolves date properties when setProperties is called', () => {
    const rows = [makeRow('Task', { 'prop-start': dateVal('2025-06-15') })];
    const view = makeView({ config: {} });
    const tl = new TimelineView(container, mockDataService(), 'db-1', view, allProps, rows, undefined);

    expect(container.querySelectorAll('.db-timeline-bar').length).toBe(1);

    // Remove all date props
    tl.setProperties([titleProp, textProp]);

    // No date property → no bars
    expect(container.querySelectorAll('.db-timeline-bar').length).toBe(0);

    tl.dispose();
  });

  it('accepts pre-computed groups via setRows', () => {
    const view = makeView({ config: { dateProperty: 'prop-start' } });
    const tl = new TimelineView(container, mockDataService(), 'db-1', view, allProps, [], undefined);

    const groups: IRowGroup[] = [
      { key: 'g1', label: 'Phase 1', rows: [makeRow('A', { 'prop-start': dateVal('2025-06-10') })] },
      { key: 'g2', label: 'Phase 2', rows: [makeRow('B', { 'prop-start': dateVal('2025-06-20') })] },
    ];
    tl.setRows([], groups);

    expect(container.querySelectorAll('.db-timeline-bar').length).toBe(2);
    expect(container.querySelectorAll('.db-timeline-row-label').length).toBe(2);

    tl.dispose();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  Timeline Layout: Dispose
// ═════════════════════════════════════════════════════════════════════════════

describe('timeline layout: dispose', () => {
  it('removes .db-timeline element from container on dispose', () => {
    const rows: IDatabaseRow[] = [];
    const view = makeView();
    const tl = new TimelineView(container, mockDataService(), 'db-1', view, allProps, rows, undefined);

    expect(container.querySelector('.db-timeline')).not.toBeNull();

    tl.dispose();

    expect(container.querySelector('.db-timeline')).toBeNull();
  });
});
