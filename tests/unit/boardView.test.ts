/**
 * @vitest-environment jsdom
 */
/**
 * Unit tests for database/views/boardView.ts
 *
 * Tests board layout logic: column grouping, group property resolution,
 * card rendering, and DOM structure. Uses a mock IDatabaseDataService.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BoardView } from '../../src/built-in/canvas/database/views/boardView';
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

function makeRowWithCover(title: string, coverUrl: string, values: Record<string, IPropertyValue>): IDatabaseRow {
  const row = makeRow(title, values);
  return {
    ...row,
    page: { ...row.page, coverUrl } as any,
  };
}

function selectVal(name: string, color = 'blue'): IPropertyValue {
  return { type: 'select', select: { id: `opt-${name}`, name, color } };
}

function statusVal(name: string, color = 'green'): IPropertyValue {
  return { type: 'status', status: { id: `status-${name}`, name, color } };
}

function makeView(overrides: Partial<IDatabaseView> = {}): IDatabaseView {
  return {
    id: 'view-1',
    databaseId: 'db-1',
    name: 'Board',
    type: 'board',
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
    // Stub all other required methods
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

const statusProp = makeProp({
  id: 'prop-status',
  type: 'select',
  name: 'Status',
  config: {
    options: [
      { id: 'opt-todo', name: 'To Do', color: 'red' },
      { id: 'opt-ip', name: 'In Progress', color: 'yellow' },
      { id: 'opt-done', name: 'Done', color: 'green' },
    ],
  } as any,
});

const priorityProp = makeProp({
  id: 'prop-priority',
  type: 'select',
  name: 'Priority',
  config: {
    options: [
      { id: 'opt-high', name: 'High', color: 'red' },
      { id: 'opt-low', name: 'Low', color: 'gray' },
    ],
  } as any,
});

const titleProp = makeProp({ id: 'prop-title', type: 'title', name: 'Title' });
const textProp = makeProp({ id: 'prop-text', type: 'rich_text', name: 'Notes' });

const allProps = [titleProp, statusProp, priorityProp, textProp];

// ─── Container ───────────────────────────────────────────────────────────────

let container: HTMLElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

// ═════════════════════════════════════════════════════════════════════════════
//  Board Layout: Column Rendering
// ═════════════════════════════════════════════════════════════════════════════

describe('board layout: column rendering', () => {
  it('renders columns matching option order + "No value"', () => {
    const rows = [
      makeRow('Task1', { 'prop-status': selectVal('Done') }),
      makeRow('Task2', { 'prop-status': selectVal('To Do') }),
    ];
    const view = makeView({ boardGroupProperty: 'prop-status' });
    const board = new BoardView(container, mockDataService(), 'db-1', view, allProps, rows, undefined);

    const columns = container.querySelectorAll('.db-board-column');
    // 3 option columns + 1 "No value" = 4 (hideEmptyGroups=false)
    expect(columns.length).toBe(4);

    const labels = Array.from(columns).map(c =>
      c.querySelector('.db-board-column-name')!.textContent,
    );
    expect(labels).toEqual(['To Do', 'In Progress', 'Done', 'No value']);

    board.dispose();
  });

  it('hides empty columns when hideEmptyGroups is true', () => {
    const rows = [
      makeRow('Task1', { 'prop-status': selectVal('Done') }),
    ];
    const view = makeView({ boardGroupProperty: 'prop-status', hideEmptyGroups: true });
    const board = new BoardView(container, mockDataService(), 'db-1', view, allProps, rows, undefined);

    const columns = container.querySelectorAll('.db-board-column');
    expect(columns.length).toBe(1);
    expect(columns[0].querySelector('.db-board-column-name')!.textContent).toBe('Done');

    board.dispose();
  });

  it('shows row count in column header', () => {
    const rows = [
      makeRow('Task1', { 'prop-status': selectVal('To Do') }),
      makeRow('Task2', { 'prop-status': selectVal('To Do') }),
      makeRow('Task3', { 'prop-status': selectVal('Done') }),
    ];
    const view = makeView({ boardGroupProperty: 'prop-status' });
    const board = new BoardView(container, mockDataService(), 'db-1', view, allProps, rows, undefined);

    const columns = container.querySelectorAll('.db-board-column');
    // To Do column
    const todoCount = columns[0].querySelector('.db-board-column-count')!.textContent;
    expect(todoCount).toBe('2');
    // Done column
    const doneCount = columns[2].querySelector('.db-board-column-count')!.textContent;
    expect(doneCount).toBe('1');

    board.dispose();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  Board Layout: Group Property Resolution
// ═════════════════════════════════════════════════════════════════════════════

describe('board layout: group property resolution', () => {
  it('uses boardGroupProperty from view config', () => {
    const rows = [makeRow('Task1', { 'prop-priority': selectVal('High') })];
    const view = makeView({ boardGroupProperty: 'prop-priority' });
    const board = new BoardView(container, mockDataService(), 'db-1', view, allProps, rows, undefined);

    const labels = Array.from(container.querySelectorAll('.db-board-column-name'))
      .map(el => el.textContent);
    expect(labels).toContain('High');
    expect(labels).toContain('Low');

    board.dispose();
  });

  it('falls back to groupBy when boardGroupProperty is null', () => {
    const rows = [makeRow('Task1', { 'prop-status': selectVal('Done') })];
    const view = makeView({ boardGroupProperty: null, groupBy: 'prop-status' });
    const board = new BoardView(container, mockDataService(), 'db-1', view, allProps, rows, undefined);

    const labels = Array.from(container.querySelectorAll('.db-board-column-name'))
      .map(el => el.textContent);
    expect(labels).toContain('To Do');

    board.dispose();
  });

  it('falls back to first select/status property when both are null', () => {
    const rows = [makeRow('Task1', { 'prop-status': selectVal('Done') })];
    const view = makeView({ boardGroupProperty: null, groupBy: null });
    const board = new BoardView(container, mockDataService(), 'db-1', view, allProps, rows, undefined);

    // statusProp is the first select/status property in allProps
    const labels = Array.from(container.querySelectorAll('.db-board-column-name'))
      .map(el => el.textContent);
    expect(labels).toContain('To Do');
    expect(labels).toContain('In Progress');
    expect(labels).toContain('Done');

    board.dispose();
  });

  it('renders single "All" group when no select/status property exists', () => {
    const propsWithoutSelect = [titleProp, textProp]; // no select or status
    const rows = [makeRow('Task1', {})];
    const view = makeView({ boardGroupProperty: null });
    const board = new BoardView(container, mockDataService(), 'db-1', view, propsWithoutSelect, rows, undefined);

    const columns = container.querySelectorAll('.db-board-column');
    expect(columns.length).toBe(1);
    expect(columns[0].querySelector('.db-board-column-name')!.textContent).toBe('All');

    board.dispose();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  Board Layout: Card Rendering
// ═════════════════════════════════════════════════════════════════════════════

describe('board layout: card rendering', () => {
  it('renders card with title', () => {
    const rows = [makeRow('My Task', { 'prop-status': selectVal('To Do') })];
    const view = makeView({ boardGroupProperty: 'prop-status' });
    const board = new BoardView(container, mockDataService(), 'db-1', view, allProps, rows, undefined);

    const card = container.querySelector('.db-board-card');
    expect(card).not.toBeNull();
    expect(card!.querySelector('.db-board-card-title')!.textContent).toBe('My Task');

    board.dispose();
  });

  it('renders "Untitled" for empty title', () => {
    const rows = [makeRow('', { 'prop-status': selectVal('To Do') })];
    const view = makeView({ boardGroupProperty: 'prop-status' });
    const board = new BoardView(container, mockDataService(), 'db-1', view, allProps, rows, undefined);

    const title = container.querySelector('.db-board-card-title')!.textContent;
    expect(title).toBe('Untitled');

    board.dispose();
  });

  it('renders card cover image with CSS custom property', () => {
    const rows = [makeRowWithCover('Task', 'https://example.com/cover.jpg', { 'prop-status': selectVal('To Do') })];
    const view = makeView({ boardGroupProperty: 'prop-status' });
    const board = new BoardView(container, mockDataService(), 'db-1', view, allProps, rows, undefined);

    const cover = container.querySelector('.db-board-card-cover') as HTMLElement;
    expect(cover).not.toBeNull();
    expect(cover.style.getPropertyValue('--db-cover-url')).toContain('https://example.com/cover.jpg');

    board.dispose();
  });

  it('cards are draggable', () => {
    const rows = [makeRow('Task', { 'prop-status': selectVal('To Do') })];
    const view = makeView({ boardGroupProperty: 'prop-status' });
    const board = new BoardView(container, mockDataService(), 'db-1', view, allProps, rows, undefined);

    const card = container.querySelector('.db-board-card') as HTMLElement;
    expect(card.draggable).toBe(true);

    board.dispose();
  });

  it('renders up to 3 preview properties (excluding title and group prop)', () => {
    const rows = [makeRow('Task', {
      'prop-status': selectVal('To Do'),
      'prop-priority': selectVal('High'),
      'prop-text': { type: 'rich_text', rich_text: [{ type: 'text', content: 'Notes here' }] },
    })];
    const view = makeView({ boardGroupProperty: 'prop-status' });
    const board = new BoardView(container, mockDataService(), 'db-1', view, allProps, rows, undefined);

    const propLabels = Array.from(container.querySelectorAll('.db-board-card-prop-label'))
      .map(el => el.textContent);
    // Should show priority and notes, NOT title or status (group prop)
    expect(propLabels).toContain('Priority');
    expect(propLabels).toContain('Notes');
    expect(propLabels).not.toContain('Title');
    expect(propLabels).not.toContain('Status');

    board.dispose();
  });

  it('each column has a "+ New" button', () => {
    const rows = [makeRow('Task', { 'prop-status': selectVal('To Do') })];
    const view = makeView({ boardGroupProperty: 'prop-status', hideEmptyGroups: true });
    const board = new BoardView(container, mockDataService(), 'db-1', view, allProps, rows, undefined);

    const addBtns = container.querySelectorAll('.db-board-add-row');
    expect(addBtns.length).toBe(1); // Only the "To Do" column (hideEmpty)
    expect(addBtns[0].textContent).toBe('+ New');

    board.dispose();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  Board Layout: setRows (reactive update)
// ═════════════════════════════════════════════════════════════════════════════

describe('board layout: reactive updates', () => {
  it('re-renders when setRows is called', () => {
    const rows = [makeRow('Task1', { 'prop-status': selectVal('To Do') })];
    const view = makeView({ boardGroupProperty: 'prop-status', hideEmptyGroups: true });
    const board = new BoardView(container, mockDataService(), 'db-1', view, allProps, rows, undefined);

    // Initially 1 column with 1 card
    expect(container.querySelectorAll('.db-board-card')).toHaveLength(1);

    // Add a new row
    const newRows = [
      ...rows,
      makeRow('Task2', { 'prop-status': selectVal('Done') }),
    ];
    board.setRows(newRows);

    // Now 2 columns with 1 card each
    expect(container.querySelectorAll('.db-board-card')).toHaveLength(2);
    const columns = container.querySelectorAll('.db-board-column');
    expect(columns.length).toBe(2);

    board.dispose();
  });

  it('accepts pre-computed groups via setRows', () => {
    const rows = [makeRow('Task1', { 'prop-status': selectVal('To Do') })];
    const view = makeView({ boardGroupProperty: 'prop-status' });
    const board = new BoardView(container, mockDataService(), 'db-1', view, allProps, rows, undefined);

    const customGroups: IRowGroup[] = [
      { key: 'custom', label: 'Custom Group', rows: [makeRow('Custom Task', {})] },
    ];
    board.setRows(rows, customGroups);

    const labels = Array.from(container.querySelectorAll('.db-board-column-name'))
      .map(el => el.textContent);
    expect(labels).toEqual(['Custom Group']);

    board.dispose();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  Board Layout: Drag-to-Change-Status
// ═════════════════════════════════════════════════════════════════════════════

describe('board layout: drag-to-change-status', () => {
  it('calls setPropertyValue when card is dropped in a different column', async () => {
    const ds = mockDataService();
    const rows = [
      makeRow('Task1', { 'prop-status': selectVal('To Do') }),
    ];
    const view = makeView({ boardGroupProperty: 'prop-status' });
    const board = new BoardView(container, ds, 'db-1', view, allProps, rows, undefined);

    // Find the "Done" column's cards container
    const columns = container.querySelectorAll('.db-board-column');
    const doneColumn = Array.from(columns).find(c =>
      c.querySelector('.db-board-column-name')!.textContent === 'Done',
    );
    expect(doneColumn).not.toBeNull();

    const cardsContainer = doneColumn!.querySelector('.db-board-cards')!;

    // Simulate drop event
    const dropEvent = new Event('drop', { bubbles: true }) as any;
    dropEvent.dataTransfer = {
      getData: vi.fn().mockReturnValue('page-task1'),
      types: ['application/x-parallx-board-card'],
    };
    dropEvent.clientY = 0;
    dropEvent.preventDefault = vi.fn();

    cardsContainer.dispatchEvent(dropEvent);

    // Wait for async
    await new Promise(resolve => setTimeout(resolve, 10));

    // Verify setPropertyValue was called to change status to "Done"
    expect(ds.setPropertyValue).toHaveBeenCalledWith(
      'db-1',
      'page-task1',
      'prop-status',
      expect.objectContaining({
        type: 'select',
        select: expect.objectContaining({ name: 'Done' }),
      }),
    );

    board.dispose();
  });

  it('calls reorderRows after cross-column drop', async () => {
    const ds = mockDataService();
    const rows = [
      makeRow('Task1', { 'prop-status': selectVal('To Do') }),
    ];
    const view = makeView({ boardGroupProperty: 'prop-status' });
    const board = new BoardView(container, ds, 'db-1', view, allProps, rows, undefined);

    // Drop in "Done" column
    const columns = container.querySelectorAll('.db-board-column');
    const doneColumn = Array.from(columns).find(c =>
      c.querySelector('.db-board-column-name')!.textContent === 'Done',
    );
    const cardsContainer = doneColumn!.querySelector('.db-board-cards')!;

    const dropEvent = new Event('drop', { bubbles: true }) as any;
    dropEvent.dataTransfer = {
      getData: vi.fn().mockReturnValue('page-task1'),
      types: ['application/x-parallx-board-card'],
    };
    dropEvent.clientY = 0;
    dropEvent.preventDefault = vi.fn();

    cardsContainer.dispatchEvent(dropEvent);

    await new Promise(resolve => setTimeout(resolve, 10));

    expect(ds.reorderRows).toHaveBeenCalledWith('db-1', expect.any(Array));

    board.dispose();
  });
});
