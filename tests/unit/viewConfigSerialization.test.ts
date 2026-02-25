/**
 * Unit tests for view config serialization — ensuring denormalized column data
 * and JSON config blobs are correctly parsed by `rowToView()`.
 *
 * The milestone requires: "view config serialization (both column and JSON paths)"
 * — denormalized columns (group_by, sub_group_by, filter_config, sort_config, etc.)
 * — JSON config blob (visibleProperties, columnWidths, colorRules, etc.)
 *
 * Simple rowToView parsing is in databaseDataService.test.ts; this file focuses
 * on realistic complex configs and edge cases specific to the view system.
 */
import { describe, it, expect } from 'vitest';
import { rowToView } from '../../src/built-in/canvas/database/databaseDataService';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function viewRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'view-001',
    database_id: 'db-001',
    name: 'Default view',
    type: 'table',
    group_by: null,
    sub_group_by: null,
    board_group_property: null,
    hide_empty_groups: 0,
    filter_config: JSON.stringify({ conjunction: 'and', rules: [] }),
    sort_config: JSON.stringify([]),
    config: JSON.stringify({}),
    sort_order: 0,
    is_locked: 0,
    created_at: '2025-01-01T00:00:00.000Z',
    updated_at: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
//  Denormalized Column Path — filter_config
// ═════════════════════════════════════════════════════════════════════════════

describe('view config: filter_config (denormalized column)', () => {

  it('parses complex nested filter groups', () => {
    const filter = {
      conjunction: 'and',
      rules: [
        { propertyId: 'prop-status', operator: 'equals', value: 'Active' },
        {
          conjunction: 'or',
          rules: [
            { propertyId: 'prop-priority', operator: 'greater_than', value: 3 },
            { propertyId: 'prop-due', operator: 'before', value: '2025-12-31' },
          ],
        },
      ],
    };
    const view = rowToView(viewRow({ filter_config: JSON.stringify(filter) }));
    expect(view.filterConfig.conjunction).toBe('and');
    expect(view.filterConfig.rules).toHaveLength(2);

    const nestedGroup = view.filterConfig.rules[1] as any;
    expect(nestedGroup.conjunction).toBe('or');
    expect(nestedGroup.rules).toHaveLength(2);
  });

  it('preserves filter rule values of different types', () => {
    const filter = {
      conjunction: 'and',
      rules: [
        { propertyId: 'p1', operator: 'equals', value: 'text-value' },
        { propertyId: 'p2', operator: 'greater_than', value: 42 },
        { propertyId: 'p3', operator: 'equals', value: true },
        { propertyId: 'p4', operator: 'is_empty' }, // no value field
      ],
    };
    const view = rowToView(viewRow({ filter_config: JSON.stringify(filter) }));
    const rules = view.filterConfig.rules as any[];
    expect(rules[0].value).toBe('text-value');
    expect(rules[1].value).toBe(42);
    expect(rules[2].value).toBe(true);
    expect(rules[3].value).toBeUndefined();
  });

  it('defaults to empty AND group when filter_config is null', () => {
    const view = rowToView(viewRow({ filter_config: null }));
    expect(view.filterConfig).toEqual({ conjunction: 'and', rules: [] });
  });

  it('defaults to empty AND group when filter_config is empty string', () => {
    const view = rowToView(viewRow({ filter_config: '' }));
    expect(view.filterConfig).toEqual({ conjunction: 'and', rules: [] });
  });

  it('defaults to empty AND group on corrupted JSON', () => {
    const view = rowToView(viewRow({ filter_config: '{"conjunction: broken' }));
    expect(view.filterConfig).toEqual({ conjunction: 'and', rules: [] });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  Denormalized Column Path — sort_config
// ═════════════════════════════════════════════════════════════════════════════

describe('view config: sort_config (denormalized column)', () => {

  it('parses multiple sort rules with priority order', () => {
    const sorts = [
      { propertyId: 'prop-status', direction: 'ascending' },
      { propertyId: 'prop-date', direction: 'descending' },
      { propertyId: 'prop-name', direction: 'ascending' },
    ];
    const view = rowToView(viewRow({ sort_config: JSON.stringify(sorts) }));
    expect(view.sortConfig).toHaveLength(3);
    expect(view.sortConfig[0].propertyId).toBe('prop-status');
    expect(view.sortConfig[0].direction).toBe('ascending');
    expect(view.sortConfig[1].direction).toBe('descending');
    expect(view.sortConfig[2].propertyId).toBe('prop-name');
  });

  it('defaults to empty array when sort_config is null', () => {
    const view = rowToView(viewRow({ sort_config: null }));
    expect(view.sortConfig).toEqual([]);
  });

  it('defaults to empty array on corrupted JSON', () => {
    const view = rowToView(viewRow({ sort_config: '[{bad' }));
    expect(view.sortConfig).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  Denormalized Column Path — grouping columns
// ═════════════════════════════════════════════════════════════════════════════

describe('view config: denormalized grouping columns', () => {

  it('preserves group_by + sub_group_by + board_group_property', () => {
    const view = rowToView(viewRow({
      group_by: 'prop-status',
      sub_group_by: 'prop-priority',
      board_group_property: 'prop-stage',
    }));
    expect(view.groupBy).toBe('prop-status');
    expect(view.subGroupBy).toBe('prop-priority');
    expect(view.boardGroupProperty).toBe('prop-stage');
  });

  it('null grouping columns map to null (not undefined)', () => {
    const view = rowToView(viewRow({
      group_by: null,
      sub_group_by: null,
      board_group_property: null,
    }));
    expect(view.groupBy).toBeNull();
    expect(view.subGroupBy).toBeNull();
    expect(view.boardGroupProperty).toBeNull();
  });

  it('hide_empty_groups coerces 1→true, 0→false', () => {
    expect(rowToView(viewRow({ hide_empty_groups: 1 })).hideEmptyGroups).toBe(true);
    expect(rowToView(viewRow({ hide_empty_groups: 0 })).hideEmptyGroups).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  JSON Config Blob — IDatabaseViewConfig
// ═════════════════════════════════════════════════════════════════════════════

describe('view config: JSON config blob', () => {

  it('parses visibleProperties array', () => {
    const config = { visibleProperties: ['prop-title', 'prop-status', 'prop-date'] };
    const view = rowToView(viewRow({ config: JSON.stringify(config) }));
    expect(view.config.visibleProperties).toEqual(['prop-title', 'prop-status', 'prop-date']);
  });

  it('parses columnWidths record', () => {
    const config = { columnWidths: { 'prop-title': 300, 'prop-status': 150, 'prop-date': 200 } };
    const view = rowToView(viewRow({ config: JSON.stringify(config) }));
    expect(view.config.columnWidths).toEqual({ 'prop-title': 300, 'prop-status': 150, 'prop-date': 200 });
  });

  it('parses cardSize enum', () => {
    const config = { cardSize: 'large' };
    const view = rowToView(viewRow({ config: JSON.stringify(config) }));
    expect(view.config.cardSize).toBe('large');
  });

  it('parses dateProperty for calendar/timeline views', () => {
    const config = { dateProperty: 'prop-due', dateEndProperty: 'prop-end' };
    const view = rowToView(viewRow({ config: JSON.stringify(config) }));
    expect(view.config.dateProperty).toBe('prop-due');
    expect(view.config.dateEndProperty).toBe('prop-end');
  });

  it('defaults to empty object when config is null', () => {
    const view = rowToView(viewRow({ config: null }));
    expect(view.config).toEqual({});
  });

  it('defaults to empty object on corrupted JSON', () => {
    const view = rowToView(viewRow({ config: '{{broken' }));
    expect(view.config).toEqual({});
  });

  it('preserves all config fields together', () => {
    const config = {
      visibleProperties: ['p1', 'p2'],
      columnWidths: { p1: 250, p2: 180 },
      cardSize: 'medium',
      dateProperty: 'p3',
    };
    const view = rowToView(viewRow({ config: JSON.stringify(config) }));
    expect(view.config.visibleProperties).toEqual(['p1', 'p2']);
    expect(view.config.columnWidths).toEqual({ p1: 250, p2: 180 });
    expect(view.config.cardSize).toBe('medium');
    expect(view.config.dateProperty).toBe('p3');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  Both Paths Combined — Full View Config Round-Trip
// ═════════════════════════════════════════════════════════════════════════════

describe('view config: full round-trip (columns + JSON combined)', () => {

  it('board view with all config paths populated', () => {
    const view = rowToView(viewRow({
      type: 'board',
      group_by: 'prop-status',
      sub_group_by: null,
      board_group_property: 'prop-status',
      hide_empty_groups: 1,
      filter_config: JSON.stringify({
        conjunction: 'and',
        rules: [{ propertyId: 'prop-priority', operator: 'greater_than', value: 2 }],
      }),
      sort_config: JSON.stringify([
        { propertyId: 'prop-due', direction: 'ascending' },
      ]),
      config: JSON.stringify({
        visibleProperties: ['prop-title', 'prop-priority', 'prop-due'],
        cardSize: 'small',
      }),
    }));

    // Denormalized columns
    expect(view.type).toBe('board');
    expect(view.groupBy).toBe('prop-status');
    expect(view.boardGroupProperty).toBe('prop-status');
    expect(view.hideEmptyGroups).toBe(true);

    // Filter (denormalized JSON column)
    expect(view.filterConfig.rules).toHaveLength(1);
    expect((view.filterConfig.rules[0] as any).propertyId).toBe('prop-priority');

    // Sort (denormalized JSON column)
    expect(view.sortConfig).toHaveLength(1);
    expect(view.sortConfig[0].propertyId).toBe('prop-due');

    // JSON config blob
    expect(view.config.visibleProperties).toEqual(['prop-title', 'prop-priority', 'prop-due']);
    expect(view.config.cardSize).toBe('small');
  });

  it('table view with column widths and complex filters', () => {
    const view = rowToView(viewRow({
      type: 'table',
      group_by: 'prop-category',
      hide_empty_groups: 0,
      filter_config: JSON.stringify({
        conjunction: 'or',
        rules: [
          { propertyId: 'prop-status', operator: 'equals', value: 'Active' },
          {
            conjunction: 'and',
            rules: [
              { propertyId: 'prop-priority', operator: 'greater_than_or_equal', value: 3 },
              { propertyId: 'prop-due', operator: 'before', value: '2025-12-31' },
            ],
          },
        ],
      }),
      sort_config: JSON.stringify([
        { propertyId: 'prop-priority', direction: 'descending' },
        { propertyId: 'prop-name', direction: 'ascending' },
      ]),
      config: JSON.stringify({
        visibleProperties: ['prop-title', 'prop-status', 'prop-priority', 'prop-due'],
        columnWidths: { 'prop-title': 300, 'prop-status': 120 },
      }),
    }));

    // Denormalized columns
    expect(view.type).toBe('table');
    expect(view.groupBy).toBe('prop-category');
    expect(view.hideEmptyGroups).toBe(false);

    // Complex nested filter
    expect(view.filterConfig.conjunction).toBe('or');
    expect(view.filterConfig.rules).toHaveLength(2);
    const nestedGroup = view.filterConfig.rules[1] as any;
    expect(nestedGroup.conjunction).toBe('and');
    expect(nestedGroup.rules).toHaveLength(2);

    // Multi-sort
    expect(view.sortConfig).toHaveLength(2);
    expect(view.sortConfig[0].direction).toBe('descending');
    expect(view.sortConfig[1].direction).toBe('ascending');

    // JSON config with column widths
    expect(view.config.visibleProperties).toHaveLength(4);
    expect(view.config.columnWidths!['prop-title']).toBe(300);
  });
});
