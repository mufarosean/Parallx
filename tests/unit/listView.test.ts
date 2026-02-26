/**
 * @vitest-environment jsdom
 */
/**
 * Unit tests for database/views/listView.ts
 *
 * Tests list layout logic: row rendering, title display, preview properties,
 * grouping, collapse/expand, setRows/setProperties, add-row footer, dispose.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ListView } from '../../src/built-in/canvas/database/views/listView';
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

function makeView(overrides: Partial<IDatabaseView> = {}): IDatabaseView {
  return {
    id: 'view-1',
    databaseId: 'db-1',
    name: 'List',
    type: 'list',
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
const statusProp = makeProp({
  id: 'prop-status', type: 'select', name: 'Status',
  config: { options: [{ id: 'opt-todo', name: 'To Do', color: 'red' }] } as any,
});
const priorityProp = makeProp({ id: 'prop-priority', type: 'select', name: 'Priority' });
const textProp = makeProp({ id: 'prop-text', type: 'rich_text', name: 'Notes' });
const extraProp = makeProp({ id: 'prop-extra', type: 'number', name: 'Score' });

const allProps = [titleProp, statusProp, priorityProp, textProp, extraProp];

// ─── Container ───────────────────────────────────────────────────────────────

let container: HTMLElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

// ═════════════════════════════════════════════════════════════════════════════
//  List Layout: Row Rendering
// ═════════════════════════════════════════════════════════════════════════════

describe('list layout: row rendering', () => {
  it('renders one row per database row', () => {
    const rows = [
      makeRow('Task1', {}),
      makeRow('Task2', {}),
      makeRow('Task3', {}),
    ];
    const view = makeView();
    const list = new ListView(container, mockDataService(), 'db-1', view, allProps, rows, undefined);

    const rowEls = container.querySelectorAll('.db-list-row');
    expect(rowEls.length).toBe(3);

    list.dispose();
  });

  it('renders row title', () => {
    const rows = [makeRow('My Task', {})];
    const view = makeView();
    const list = new ListView(container, mockDataService(), 'db-1', view, allProps, rows, undefined);

    const title = container.querySelector('.db-list-row-title')!.textContent;
    expect(title).toBe('My Task');

    list.dispose();
  });

  it('renders "Untitled" for empty title', () => {
    const rows = [makeRow('', {})];
    const view = makeView();
    const list = new ListView(container, mockDataService(), 'db-1', view, allProps, rows, undefined);

    const title = container.querySelector('.db-list-row-title')!.textContent;
    expect(title).toBe('Untitled');

    list.dispose();
  });

  it('wraps content in a .db-list element', () => {
    const rows = [makeRow('Task', {})];
    const view = makeView();
    const list = new ListView(container, mockDataService(), 'db-1', view, allProps, rows, undefined);

    expect(container.querySelector('.db-list')).not.toBeNull();

    list.dispose();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  List Layout: Preview Properties
// ═════════════════════════════════════════════════════════════════════════════

describe('list layout: preview properties', () => {
  it('shows up to 3 non-title properties per row', () => {
    const rows = [makeRow('Task', {
      'prop-status': { type: 'select', select: { id: 'opt-todo', name: 'To Do', color: 'red' } },
      'prop-priority': { type: 'select', select: { id: 'opt-high', name: 'High', color: 'red' } },
      'prop-text': { type: 'rich_text', rich_text: [{ type: 'text', content: 'Hello' }] },
      'prop-extra': { type: 'number', number: 42 },
    })];
    const view = makeView();
    const list = new ListView(container, mockDataService(), 'db-1', view, allProps, rows, undefined);

    const propLabels = Array.from(container.querySelectorAll('.db-list-row-prop-label'))
      .map(el => el.textContent);
    // 3 non-title properties: status, priority, notes (extra would be 4th)
    expect(propLabels).toHaveLength(3);
    expect(propLabels).toEqual(['Status', 'Priority', 'Notes']);
    expect(propLabels).not.toContain('Title');
    expect(propLabels).not.toContain('Score');

    list.dispose();
  });

  it('renders property value labels', () => {
    const rows = [makeRow('Task', {
      'prop-status': { type: 'select', select: { id: 'opt-todo', name: 'To Do', color: 'red' } },
    })];
    const view = makeView();
    const list = new ListView(container, mockDataService(), 'db-1', view, allProps, rows, undefined);

    const propLabel = container.querySelector('.db-list-row-prop-label')!.textContent;
    expect(propLabel).toBe('Status');
    // Value container exists
    expect(container.querySelector('.db-list-row-prop-value')).not.toBeNull();

    list.dispose();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  List Layout: Grouping
// ═════════════════════════════════════════════════════════════════════════════

describe('list layout: grouping', () => {
  it('renders groups with headers when multiple groups are provided', () => {
    const r1 = makeRow('Task1', {});
    const r2 = makeRow('Task2', {});
    const groups: IRowGroup[] = [
      { key: 'group-a', label: 'Group A', rows: [r1] },
      { key: 'group-b', label: 'Group B', rows: [r2] },
    ];
    const view = makeView();
    const list = new ListView(container, mockDataService(), 'db-1', view, allProps, [], undefined, groups);

    const headers = container.querySelectorAll('.db-list-group-header');
    expect(headers.length).toBe(2);

    const labels = Array.from(container.querySelectorAll('.db-list-group-label'))
      .map(el => el.textContent);
    expect(labels).toEqual(['Group A', 'Group B']);

    list.dispose();
  });

  it('shows row count in group header', () => {
    const groups: IRowGroup[] = [
      { key: 'group-a', label: 'Group A', rows: [makeRow('T1', {}), makeRow('T2', {})] },
    ];
    const view = makeView();
    const list = new ListView(container, mockDataService(), 'db-1', view, allProps, [], undefined, groups);

    const count = container.querySelector('.db-list-group-count')!.textContent;
    expect(count).toBe('2');

    list.dispose();
  });

  it('collapses group on header click', () => {
    const groups: IRowGroup[] = [
      { key: 'group-a', label: 'Group A', rows: [makeRow('T1', {})] },
    ];
    const view = makeView();
    const list = new ListView(container, mockDataService(), 'db-1', view, allProps, [], undefined, groups);

    // Initially expanded — rows visible
    expect(container.querySelectorAll('.db-list-row').length).toBe(1);

    // Click header to collapse
    let header = container.querySelector('.db-list-group-header') as HTMLElement;
    header.click();

    // After collapse — no rows visible
    expect(container.querySelectorAll('.db-list-row').length).toBe(0);

    // Re-query header (DOM was re-rendered) and click to expand
    header = container.querySelector('.db-list-group-header') as HTMLElement;
    header.click();
    expect(container.querySelectorAll('.db-list-row').length).toBe(1);

    list.dispose();
  });

  it('renders sub-groups inside groups', () => {
    const subGroups: IRowGroup[] = [
      { key: 'sub-1', label: 'SubGroup 1', rows: [makeRow('Sub Task', {})] },
    ];
    const groups: IRowGroup[] = [
      { key: 'group-a', label: 'Group A', rows: [makeRow('T1', {})], subGroups },
    ];
    const view = makeView();
    const list = new ListView(container, mockDataService(), 'db-1', view, allProps, [], undefined, groups);

    expect(container.querySelector('.db-list-subgroup')).not.toBeNull();
    const subHeader = container.querySelector('.db-list-subgroup-header');
    expect(subHeader).not.toBeNull();

    list.dispose();
  });

  it('does not render group headers when single __all__ group', () => {
    const rows = [makeRow('Task', {})];
    const view = makeView();
    const list = new ListView(container, mockDataService(), 'db-1', view, allProps, rows, undefined);

    // No group headers
    expect(container.querySelectorAll('.db-list-group-header').length).toBe(0);
    // But rows are still rendered
    expect(container.querySelectorAll('.db-list-row').length).toBe(1);

    list.dispose();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  List Layout: Footer
// ═════════════════════════════════════════════════════════════════════════════

describe('list layout: footer', () => {
  it('renders a "+ New" button', () => {
    const rows = [makeRow('Task', {})];
    const view = makeView();
    const list = new ListView(container, mockDataService(), 'db-1', view, allProps, rows, undefined);

    const addBtn = container.querySelector('.db-list-add-row');
    expect(addBtn).not.toBeNull();
    expect(addBtn!.textContent).toBe('+ New');

    list.dispose();
  });

  it('calls addRow on button click', async () => {
    const ds = mockDataService();
    const rows = [makeRow('Task', {})];
    const view = makeView();
    const list = new ListView(container, ds, 'db-1', view, allProps, rows, undefined);

    const addBtn = container.querySelector('.db-list-add-row') as HTMLElement;
    addBtn.click();

    await new Promise(resolve => setTimeout(resolve, 10));

    expect(ds.addRow).toHaveBeenCalledWith('db-1');

    list.dispose();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  List Layout: Reactive Updates
// ═════════════════════════════════════════════════════════════════════════════

describe('list layout: reactive updates', () => {
  it('re-renders when setRows is called', () => {
    const rows = [makeRow('Task1', {})];
    const view = makeView();
    const list = new ListView(container, mockDataService(), 'db-1', view, allProps, rows, undefined);

    expect(container.querySelectorAll('.db-list-row').length).toBe(1);

    list.setRows([makeRow('Task1', {}), makeRow('Task2', {})]);

    expect(container.querySelectorAll('.db-list-row').length).toBe(2);

    list.dispose();
  });

  it('re-renders with new groups via setRows', () => {
    const rows = [makeRow('Task1', {})];
    const view = makeView();
    const list = new ListView(container, mockDataService(), 'db-1', view, allProps, rows, undefined);

    const newGroups: IRowGroup[] = [
      { key: 'g1', label: 'New Group', rows: [makeRow('G1 Task', {})] },
    ];
    list.setRows(rows, newGroups);

    const labels = Array.from(container.querySelectorAll('.db-list-group-label'))
      .map(el => el.textContent);
    expect(labels).toEqual(['New Group']);

    list.dispose();
  });

  it('re-renders when setProperties is called', () => {
    const rows = [makeRow('Task', { 'prop-text': { type: 'rich_text', rich_text: [] } })];
    const view = makeView();
    const list = new ListView(container, mockDataService(), 'db-1', view, allProps, rows, undefined);

    // Initially 3 preview props
    expect(container.querySelectorAll('.db-list-row-prop-label').length).toBe(3);

    // Change to only title + 1 non-title
    list.setProperties([titleProp, statusProp]);

    expect(container.querySelectorAll('.db-list-row-prop-label').length).toBe(1);

    list.dispose();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  List Layout: Click to Open
// ═════════════════════════════════════════════════════════════════════════════

describe('list layout: click to open', () => {
  it('calls openEditor when a row is clicked', () => {
    const openEditor = vi.fn();
    const rows = [makeRow('My Task', {})];
    const view = makeView();
    const list = new ListView(container, mockDataService(), 'db-1', view, allProps, rows, openEditor);

    const rowEl = container.querySelector('.db-list-row') as HTMLElement;
    rowEl.click();

    expect(openEditor).toHaveBeenCalledWith(expect.objectContaining({
      typeId: 'canvas',
      title: 'My Task',
      instanceId: 'page-my-task',
    }));

    list.dispose();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  List Layout: Dispose
// ═════════════════════════════════════════════════════════════════════════════

describe('list layout: dispose', () => {
  it('removes .db-list element from container on dispose', () => {
    const rows = [makeRow('Task', {})];
    const view = makeView();
    const list = new ListView(container, mockDataService(), 'db-1', view, allProps, rows, undefined);

    expect(container.querySelector('.db-list')).not.toBeNull();

    list.dispose();

    expect(container.querySelector('.db-list')).toBeNull();
  });
});
