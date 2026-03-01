/**
 * @vitest-environment jsdom
 */
/**
 * Unit tests for database/views/galleryView.ts
 *
 * Tests gallery layout: card grid rendering, cover images, card sizes,
 * grouping, preview properties, setRows/setProperties, footer, dispose.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GalleryView } from '../../src/built-in/canvas/database/views/galleryView';
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

function makeRowWithCover(title: string, coverUrl: string, icon?: string): IDatabaseRow {
  const row = makeRow(title, {});
  return {
    ...row,
    page: { ...row.page, coverUrl, icon: icon ?? null } as any,
  };
}

function makeView(overrides: Partial<IDatabaseView> = {}): IDatabaseView {
  return {
    id: 'view-1',
    databaseId: 'db-1',
    name: 'Gallery',
    type: 'gallery',
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
const statusProp = makeProp({ id: 'prop-status', type: 'select', name: 'Status' });
const textProp = makeProp({ id: 'prop-text', type: 'rich_text', name: 'Notes' });

const allProps = [titleProp, statusProp, textProp];

// ─── Container ───────────────────────────────────────────────────────────────

let container: HTMLElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

// ═════════════════════════════════════════════════════════════════════════════
//  Gallery Layout: Card Grid
// ═════════════════════════════════════════════════════════════════════════════

describe('gallery layout: card grid', () => {
  it('renders one card per row', () => {
    const rows = [makeRow('A', {}), makeRow('B', {}), makeRow('C', {})];
    const view = makeView();
    const gallery = new GalleryView(container, mockDataService(), 'db-1', view, allProps, rows, undefined);

    const cards = container.querySelectorAll('.db-gallery-card');
    expect(cards.length).toBe(3);

    gallery.dispose();
  });

  it('wraps content in .db-gallery element', () => {
    const rows = [makeRow('Task', {})];
    const view = makeView();
    const gallery = new GalleryView(container, mockDataService(), 'db-1', view, allProps, rows, undefined);

    expect(container.querySelector('.db-gallery')).not.toBeNull();

    gallery.dispose();
  });

  it('renders card title', () => {
    const rows = [makeRow('My Card', {})];
    const view = makeView();
    const gallery = new GalleryView(container, mockDataService(), 'db-1', view, allProps, rows, undefined);

    const title = container.querySelector('.db-gallery-card-title-text')!.textContent;
    expect(title).toBe('My Card');

    gallery.dispose();
  });

  it('renders "Untitled" for empty title', () => {
    const rows = [makeRow('', {})];
    const view = makeView();
    const gallery = new GalleryView(container, mockDataService(), 'db-1', view, allProps, rows, undefined);

    const title = container.querySelector('.db-gallery-card-title-text')!.textContent;
    expect(title).toBe('Untitled');

    gallery.dispose();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  Gallery Layout: Card Sizes
// ═════════════════════════════════════════════════════════════════════════════

describe('gallery layout: card sizes', () => {
  it('uses 3-column grid for medium (default)', () => {
    const rows = [makeRow('Task', {})];
    const view = makeView({ config: { cardSize: 'medium' } });
    const gallery = new GalleryView(container, mockDataService(), 'db-1', view, allProps, rows, undefined);

    const grid = container.querySelector('.db-gallery-grid') as HTMLElement;
    expect(grid.style.gridTemplateColumns).toBe('repeat(3, 1fr)');

    gallery.dispose();
  });

  it('uses 4-column grid for small', () => {
    const rows = [makeRow('Task', {})];
    const view = makeView({ config: { cardSize: 'small' } });
    const gallery = new GalleryView(container, mockDataService(), 'db-1', view, allProps, rows, undefined);

    const grid = container.querySelector('.db-gallery-grid') as HTMLElement;
    expect(grid.style.gridTemplateColumns).toBe('repeat(4, 1fr)');

    gallery.dispose();
  });

  it('uses 2-column grid for large', () => {
    const rows = [makeRow('Task', {})];
    const view = makeView({ config: { cardSize: 'large' } });
    const gallery = new GalleryView(container, mockDataService(), 'db-1', view, allProps, rows, undefined);

    const grid = container.querySelector('.db-gallery-grid') as HTMLElement;
    expect(grid.style.gridTemplateColumns).toBe('repeat(2, 1fr)');

    gallery.dispose();
  });

  it('defaults to 3 columns when cardSize is unset', () => {
    const rows = [makeRow('Task', {})];
    const view = makeView({ config: {} });
    const gallery = new GalleryView(container, mockDataService(), 'db-1', view, allProps, rows, undefined);

    const grid = container.querySelector('.db-gallery-grid') as HTMLElement;
    expect(grid.style.gridTemplateColumns).toBe('repeat(3, 1fr)');

    gallery.dispose();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  Gallery Layout: Cover Images
// ═════════════════════════════════════════════════════════════════════════════

describe('gallery layout: cover images', () => {
  it('renders cover image when page has coverUrl', () => {
    const rows = [makeRowWithCover('Task', 'https://example.com/img.jpg')];
    const view = makeView();
    const gallery = new GalleryView(container, mockDataService(), 'db-1', view, allProps, rows, undefined);

    const cover = container.querySelector('.db-gallery-card-cover');
    expect(cover).not.toBeNull();

    const img = cover!.querySelector('.db-gallery-card-cover-img') as HTMLImageElement;
    expect(img).not.toBeNull();
    expect(img.src).toBe('https://example.com/img.jpg');

    gallery.dispose();
  });

  it('does not render cover when coverUrl is null', () => {
    const rows = [makeRow('Task', {})];
    const view = makeView();
    const gallery = new GalleryView(container, mockDataService(), 'db-1', view, allProps, rows, undefined);

    expect(container.querySelector('.db-gallery-card-cover')).toBeNull();

    gallery.dispose();
  });

  it('renders page icon in card title', () => {
    const rows = [makeRowWithCover('Task', 'https://example.com/img.jpg', '📋')];
    const view = makeView();
    const gallery = new GalleryView(container, mockDataService(), 'db-1', view, allProps, rows, undefined);

    const icon = container.querySelector('.db-gallery-card-icon');
    expect(icon).not.toBeNull();
    expect(icon!.textContent).toBe('📋');

    gallery.dispose();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  Gallery Layout: Preview Properties
// ═════════════════════════════════════════════════════════════════════════════

describe('gallery layout: preview properties', () => {
  it('shows up to 3 non-title properties in card body', () => {
    const rows = [makeRow('Task', {
      'prop-status': { type: 'select', select: { id: 'opt-1', name: 'To Do', color: 'red' } },
      'prop-text': { type: 'rich_text', rich_text: [] },
    })];
    const view = makeView();
    const gallery = new GalleryView(container, mockDataService(), 'db-1', view, allProps, rows, undefined);

    const propValues = container.querySelectorAll('.db-gallery-card-prop-value');
    // statusProp + textProp = 2 non-title props
    expect(propValues.length).toBe(2);

    gallery.dispose();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  Gallery Layout: Grouping
// ═════════════════════════════════════════════════════════════════════════════

describe('gallery layout: grouping', () => {
  it('renders groups with headers', () => {
    const groups: IRowGroup[] = [
      { key: 'g1', label: 'Group One', rows: [makeRow('T1', {})] },
      { key: 'g2', label: 'Group Two', rows: [makeRow('T2', {})] },
    ];
    const view = makeView();
    const gallery = new GalleryView(container, mockDataService(), 'db-1', view, allProps, [], undefined, groups);

    const labels = Array.from(container.querySelectorAll('.db-gallery-group-label'))
      .map(el => el.textContent);
    expect(labels).toEqual(['Group One', 'Group Two']);

    gallery.dispose();
  });

  it('collapses group on header click', () => {
    const groups: IRowGroup[] = [
      { key: 'g1', label: 'Group', rows: [makeRow('T1', {})] },
    ];
    const view = makeView();
    const gallery = new GalleryView(container, mockDataService(), 'db-1', view, allProps, [], undefined, groups);

    expect(container.querySelectorAll('.db-gallery-card').length).toBe(1);

    const header = container.querySelector('.db-gallery-group-header') as HTMLElement;
    header.click();

    expect(container.querySelectorAll('.db-gallery-card').length).toBe(0);

    gallery.dispose();
  });

  it('shows count in group header', () => {
    const groups: IRowGroup[] = [
      { key: 'g1', label: 'Group', rows: [makeRow('T1', {}), makeRow('T2', {}), makeRow('T3', {})] },
    ];
    const view = makeView();
    const gallery = new GalleryView(container, mockDataService(), 'db-1', view, allProps, [], undefined, groups);

    const count = container.querySelector('.db-gallery-group-count')!.textContent;
    expect(count).toBe('3');

    gallery.dispose();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  Gallery Layout: Footer
// ═════════════════════════════════════════════════════════════════════════════

describe('gallery layout: footer', () => {
  it('renders a "+ New" button', () => {
    const rows = [makeRow('Task', {})];
    const view = makeView();
    const gallery = new GalleryView(container, mockDataService(), 'db-1', view, allProps, rows, undefined);

    const addBtn = container.querySelector('.db-gallery-add-row');
    expect(addBtn).not.toBeNull();
    expect(addBtn!.textContent).toBe('+ New');

    gallery.dispose();
  });

  it('calls addRow on button click', async () => {
    const ds = mockDataService();
    const rows = [makeRow('Task', {})];
    const view = makeView();
    const gallery = new GalleryView(container, ds, 'db-1', view, allProps, rows, undefined);

    const addBtn = container.querySelector('.db-gallery-add-row') as HTMLElement;
    addBtn.click();

    await new Promise(resolve => setTimeout(resolve, 10));

    expect(ds.addRow).toHaveBeenCalledWith('db-1');

    gallery.dispose();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  Gallery Layout: Reactive Updates
// ═════════════════════════════════════════════════════════════════════════════

describe('gallery layout: reactive updates', () => {
  it('re-renders when setRows is called', () => {
    const rows = [makeRow('A', {})];
    const view = makeView();
    const gallery = new GalleryView(container, mockDataService(), 'db-1', view, allProps, rows, undefined);

    expect(container.querySelectorAll('.db-gallery-card').length).toBe(1);

    gallery.setRows([makeRow('A', {}), makeRow('B', {}), makeRow('C', {})]);

    expect(container.querySelectorAll('.db-gallery-card').length).toBe(3);

    gallery.dispose();
  });

  it('re-renders when setProperties is called', () => {
    const rows = [makeRow('Task', { 'prop-status': { type: 'select', select: { id: 'x', name: 'X', color: 'red' } } })];
    const view = makeView();
    const gallery = new GalleryView(container, mockDataService(), 'db-1', view, allProps, rows, undefined);

    // Initially 2 preview props (status, text)
    expect(container.querySelectorAll('.db-gallery-card-prop').length).toBe(2);

    gallery.setProperties([titleProp]); // Only title — no preview props

    expect(container.querySelectorAll('.db-gallery-card-prop').length).toBe(0);

    gallery.dispose();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  Gallery Layout: Click to Open
// ═════════════════════════════════════════════════════════════════════════════

describe('gallery layout: click to open', () => {
  it('calls openEditor when card is clicked', () => {
    const openEditor = vi.fn();
    const rows = [makeRow('My Card', {})];
    const view = makeView();
    const gallery = new GalleryView(container, mockDataService(), 'db-1', view, allProps, rows, openEditor);

    const card = container.querySelector('.db-gallery-card') as HTMLElement;
    card.click();

    expect(openEditor).toHaveBeenCalledWith(expect.objectContaining({
      typeId: 'canvas',
      title: 'My Card',
      instanceId: 'page-my-card',
    }));

    gallery.dispose();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  Gallery Layout: Dispose
// ═════════════════════════════════════════════════════════════════════════════

describe('gallery layout: dispose', () => {
  it('removes .db-gallery element from container on dispose', () => {
    const rows = [makeRow('Task', {})];
    const view = makeView();
    const gallery = new GalleryView(container, mockDataService(), 'db-1', view, allProps, rows, undefined);

    expect(container.querySelector('.db-gallery')).not.toBeNull();

    gallery.dispose();

    expect(container.querySelector('.db-gallery')).toBeNull();
  });
});
