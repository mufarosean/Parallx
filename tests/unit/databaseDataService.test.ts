/**
 * Unit tests for database/databaseDataService.ts — row mapper functions
 *
 * Tests the pure functions that convert raw SQLite rows to typed interfaces,
 * including boolean coercion, JSON parsing, default values, and null handling.
 */
import { describe, it, expect } from 'vitest';
import {
  rowToDatabase,
  rowToProperty,
  rowToView,
  rowToPage,
  parsePropertyValue,
} from '../../src/built-in/canvas/database/databaseDataService';

// ─── Helpers: full rows with all columns populated ───────────────────────────

function fullDatabaseRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'db-001',
    page_id: 'db-001',
    description: null,
    is_locked: 0,
    created_at: '2025-01-01T00:00:00.000Z',
    updated_at: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function fullPropertyRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'prop-001',
    database_id: 'db-001',
    name: 'Status',
    type: 'select',
    config: JSON.stringify({ options: [{ id: 'opt-1', name: 'Done', color: 'green' }] }),
    sort_order: 0,
    created_at: '2025-01-01T00:00:00.000Z',
    updated_at: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function fullViewRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'view-001',
    database_id: 'db-001',
    name: 'Table',
    type: 'table',
    group_by: null,
    sub_group_by: null,
    board_group_property: null,
    hide_empty_groups: 0,
    filter_config: JSON.stringify({ conjunction: 'and', rules: [] }),
    sort_config: JSON.stringify([]),
    config: JSON.stringify({ visibleProperties: ['prop-001'] }),
    sort_order: 0,
    is_locked: 0,
    created_at: '2025-01-01T00:00:00.000Z',
    updated_at: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function fullPageRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'page-001',
    parent_id: null,
    title: 'Test Page',
    icon: '📄',
    content: '{"type":"doc","content":[]}',
    content_schema_version: 2,
    revision: 1,
    sort_order: 0,
    is_archived: 0,
    cover_url: null,
    cover_y_offset: 0.5,
    font_family: 'default',
    full_width: 0,
    small_text: 0,
    is_locked: 0,
    is_favorited: 0,
    created_at: '2025-01-01T00:00:00.000Z',
    updated_at: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ═════════════════════════════════════════════════════════════════════════════

describe('rowToDatabase', () => {

  it('maps all fields from a full row', () => {
    const db = rowToDatabase(fullDatabaseRow());
    expect(db.id).toBe('db-001');
    expect(db.pageId).toBe('db-001');
    expect(db.description).toBeNull();
    expect(db.isLocked).toBe(false);
    expect(db.createdAt).toBe('2025-01-01T00:00:00.000Z');
    expect(db.updatedAt).toBe('2025-01-01T00:00:00.000Z');
  });

  it('maps description when set', () => {
    expect(rowToDatabase(fullDatabaseRow({ description: 'Task tracker' })).description).toBe('Task tracker');
  });

  describe('boolean coercion', () => {
    it('coerces is_locked = 1 to true', () => {
      expect(rowToDatabase(fullDatabaseRow({ is_locked: 1 })).isLocked).toBe(true);
    });

    it('coerces is_locked = 0 to false', () => {
      expect(rowToDatabase(fullDatabaseRow({ is_locked: 0 })).isLocked).toBe(false);
    });
  });

  it('enforces DD-0 invariant: id equals page_id', () => {
    const db = rowToDatabase(fullDatabaseRow());
    expect(db.id).toBe(db.pageId);
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe('rowToProperty', () => {

  it('maps all fields from a full row', () => {
    const prop = rowToProperty(fullPropertyRow());
    expect(prop.id).toBe('prop-001');
    expect(prop.databaseId).toBe('db-001');
    expect(prop.name).toBe('Status');
    expect(prop.type).toBe('select');
    expect(prop.sortOrder).toBe(0);
    expect(prop.createdAt).toBe('2025-01-01T00:00:00.000Z');
    expect(prop.updatedAt).toBe('2025-01-01T00:00:00.000Z');
  });

  it('parses JSON config', () => {
    const prop = rowToProperty(fullPropertyRow());
    expect(prop.config).toEqual({ options: [{ id: 'opt-1', name: 'Done', color: 'green' }] });
  });

  it('defaults config to empty object when null', () => {
    const prop = rowToProperty(fullPropertyRow({ config: null }));
    expect(prop.config).toEqual({});
  });

  it('defaults config to empty object when empty string', () => {
    const prop = rowToProperty(fullPropertyRow({ config: '' }));
    expect(prop.config).toEqual({});
  });

  it('defaults config to empty object on invalid JSON', () => {
    const prop = rowToProperty(fullPropertyRow({ config: '{bad json' }));
    expect(prop.config).toEqual({});
  });

  it('maps different property types', () => {
    expect(rowToProperty(fullPropertyRow({ type: 'title' })).type).toBe('title');
    expect(rowToProperty(fullPropertyRow({ type: 'number' })).type).toBe('number');
    expect(rowToProperty(fullPropertyRow({ type: 'checkbox' })).type).toBe('checkbox');
    expect(rowToProperty(fullPropertyRow({ type: 'files' })).type).toBe('files');
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe('rowToView', () => {

  it('maps all fields from a full row', () => {
    const view = rowToView(fullViewRow());
    expect(view.id).toBe('view-001');
    expect(view.databaseId).toBe('db-001');
    expect(view.name).toBe('Table');
    expect(view.type).toBe('table');
    expect(view.groupBy).toBeNull();
    expect(view.subGroupBy).toBeNull();
    expect(view.boardGroupProperty).toBeNull();
    expect(view.hideEmptyGroups).toBe(false);
    expect(view.sortOrder).toBe(0);
    expect(view.isLocked).toBe(false);
    expect(view.createdAt).toBe('2025-01-01T00:00:00.000Z');
    expect(view.updatedAt).toBe('2025-01-01T00:00:00.000Z');
  });

  it('parses filter_config JSON', () => {
    const view = rowToView(fullViewRow());
    expect(view.filterConfig).toEqual({ conjunction: 'and', rules: [] });
  });

  it('parses sort_config JSON', () => {
    const sortConfig = [{ propertyId: 'prop-001', direction: 'ascending' }];
    const view = rowToView(fullViewRow({ sort_config: JSON.stringify(sortConfig) }));
    expect(view.sortConfig).toEqual(sortConfig);
  });

  it('parses config JSON', () => {
    const view = rowToView(fullViewRow());
    expect(view.config).toEqual({ visibleProperties: ['prop-001'] });
  });

  it('defaults filter_config to empty group on invalid JSON', () => {
    const view = rowToView(fullViewRow({ filter_config: '{bad' }));
    expect(view.filterConfig).toEqual({ conjunction: 'and', rules: [] });
  });

  it('defaults sort_config to empty array on invalid JSON', () => {
    const view = rowToView(fullViewRow({ sort_config: '{bad' }));
    expect(view.sortConfig).toEqual([]);
  });

  it('defaults config to empty object on invalid JSON', () => {
    const view = rowToView(fullViewRow({ config: '{bad' }));
    expect(view.config).toEqual({});
  });

  describe('boolean coercion', () => {
    it('coerces hide_empty_groups = 1 to true', () => {
      expect(rowToView(fullViewRow({ hide_empty_groups: 1 })).hideEmptyGroups).toBe(true);
    });

    it('coerces is_locked = 1 to true', () => {
      expect(rowToView(fullViewRow({ is_locked: 1 })).isLocked).toBe(true);
    });
  });

  it('maps denormalized view columns', () => {
    const view = rowToView(fullViewRow({
      group_by: 'prop-001',
      sub_group_by: 'prop-002',
      board_group_property: 'prop-003',
    }));
    expect(view.groupBy).toBe('prop-001');
    expect(view.subGroupBy).toBe('prop-002');
    expect(view.boardGroupProperty).toBe('prop-003');
  });

  it('maps view type variants', () => {
    expect(rowToView(fullViewRow({ type: 'board' })).type).toBe('board');
    expect(rowToView(fullViewRow({ type: 'list' })).type).toBe('list');
    expect(rowToView(fullViewRow({ type: 'gallery' })).type).toBe('gallery');
    expect(rowToView(fullViewRow({ type: 'calendar' })).type).toBe('calendar');
    expect(rowToView(fullViewRow({ type: 'timeline' })).type).toBe('timeline');
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe('rowToPage (database service)', () => {

  it('maps all fields from a full row', () => {
    const page = rowToPage(fullPageRow());
    expect(page.id).toBe('page-001');
    expect(page.parentId).toBeNull();
    expect(page.title).toBe('Test Page');
    expect(page.icon).toBe('📄');
    expect(page.sortOrder).toBe(0);
    expect(page.isArchived).toBe(false);
    expect(page.isLocked).toBe(false);
    expect(page.isFavorited).toBe(false);
  });

  it('coerces boolean fields from integers', () => {
    const page = rowToPage(fullPageRow({
      is_archived: 1,
      full_width: 1,
      small_text: 1,
      is_locked: 1,
      is_favorited: 1,
    }));
    expect(page.isArchived).toBe(true);
    expect(page.fullWidth).toBe(true);
    expect(page.smallText).toBe(true);
    expect(page.isLocked).toBe(true);
    expect(page.isFavorited).toBe(true);
  });

  it('defaults optional fields', () => {
    const row = fullPageRow();
    delete row.parent_id;
    delete row.icon;
    delete row.cover_url;
    delete row.cover_y_offset;
    delete row.font_family;
    const page = rowToPage(row);
    expect(page.parentId).toBeNull();
    expect(page.icon).toBeNull();
    expect(page.coverUrl).toBeNull();
    expect(page.coverYOffset).toBe(0.5);
    expect(page.fontFamily).toBe('default');
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe('parsePropertyValue', () => {

  it('parses a select value', () => {
    const json = JSON.stringify({ type: 'select', select: { id: 's1', name: 'Done', color: 'green' } });
    const value = parsePropertyValue(json);
    expect(value.type).toBe('select');
    expect((value as any).select).toEqual({ id: 's1', name: 'Done', color: 'green' });
  });

  it('parses a number value', () => {
    const json = JSON.stringify({ type: 'number', number: 42 });
    const value = parsePropertyValue(json);
    expect(value.type).toBe('number');
    expect((value as any).number).toBe(42);
  });

  it('parses a checkbox value', () => {
    const json = JSON.stringify({ type: 'checkbox', checkbox: true });
    const value = parsePropertyValue(json);
    expect(value.type).toBe('checkbox');
    expect((value as any).checkbox).toBe(true);
  });

  it('parses a date value', () => {
    const json = JSON.stringify({ type: 'date', date: { start: '2025-03-01', end: null } });
    const value = parsePropertyValue(json);
    expect(value.type).toBe('date');
    expect((value as any).date).toEqual({ start: '2025-03-01', end: null });
  });

  it('parses a multi_select value', () => {
    const json = JSON.stringify({ type: 'multi_select', multi_select: [{ id: '1', name: 'A', color: 'blue' }] });
    const value = parsePropertyValue(json);
    expect(value.type).toBe('multi_select');
    expect((value as any).multi_select).toHaveLength(1);
  });

  it('parses a files value', () => {
    const json = JSON.stringify({ type: 'files', files: [{ name: 'doc.pdf', type: 'external', external: { url: 'https://example.com/doc.pdf' } }] });
    const value = parsePropertyValue(json);
    expect(value.type).toBe('files');
    expect((value as any).files).toHaveLength(1);
  });

  it('parses a relation value', () => {
    const json = JSON.stringify({ type: 'relation', relation: [{ id: 'page-123' }] });
    const value = parsePropertyValue(json);
    expect(value.type).toBe('relation');
    expect((value as any).relation).toHaveLength(1);
  });

  it('parses a title value', () => {
    const json = JSON.stringify({ type: 'title', title: [{ type: 'text', content: 'Hello' }] });
    const value = parsePropertyValue(json);
    expect(value.type).toBe('title');
    expect((value as any).title).toHaveLength(1);
  });

  it('returns fallback rich_text on invalid JSON', () => {
    const value = parsePropertyValue('{bad json');
    expect(value.type).toBe('rich_text');
    expect((value as any).rich_text).toEqual([]);
  });

  it('returns fallback rich_text on empty string', () => {
    // Empty string is invalid JSON
    const value = parsePropertyValue('');
    expect(value.type).toBe('rich_text');
    expect((value as any).rich_text).toEqual([]);
  });
});
