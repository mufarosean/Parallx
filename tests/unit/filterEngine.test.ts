/**
 * Unit tests for database/filters/filterEngine.ts
 *
 * Tests the pure data-transformation functions: evaluateFilter, applySorts,
 * groupRows, applyViewDataPipeline. No DOM, no side effects.
 */
import { describe, it, expect } from 'vitest';
import {
  evaluateFilter,
  applySorts,
  groupRows,
  applyViewDataPipeline,
} from '../../src/built-in/canvas/database/filters/filterEngine';
import type {
  IDatabaseRow,
  IDatabaseProperty,
  IFilterGroup,
  IFilterRule,
  ISortRule,
  IPropertyValue,
  ISelectOption,
} from '../../src/built-in/canvas/database/databaseTypes';

// ─── Test Helpers ────────────────────────────────────────────────────────────

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

function makeRow(
  title: string,
  values: Record<string, IPropertyValue>,
  sortOrder = 0,
): IDatabaseRow {
  return {
    page: {
      id: `page-${title}`,
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

function textVal(content: string): IPropertyValue {
  return { type: 'rich_text', rich_text: [{ type: 'text', content }] };
}

function numVal(n: number | null): IPropertyValue {
  return { type: 'number', number: n };
}

function selectVal(name: string, color = 'gray'): IPropertyValue {
  return { type: 'select', select: { id: `opt-${name}`, name, color } };
}

function statusVal(name: string, color = 'gray'): IPropertyValue {
  return { type: 'status', status: { id: `status-${name}`, name, color } };
}

function multiSelectVal(...names: string[]): IPropertyValue {
  return {
    type: 'multi_select',
    multi_select: names.map(n => ({ id: `ms-${n}`, name: n, color: 'gray' })),
  };
}

function checkboxVal(checked: boolean): IPropertyValue {
  return { type: 'checkbox', checkbox: checked };
}

function dateVal(start: string, end: string | null = null): IPropertyValue {
  return { type: 'date', date: { start, end } };
}

function urlVal(url: string): IPropertyValue {
  return { type: 'url', url };
}

function emailVal(email: string): IPropertyValue {
  return { type: 'email', email };
}

function relationVal(...ids: string[]): IPropertyValue {
  return { type: 'relation', relation: ids.map(id => ({ id })) };
}

function uniqueIdVal(prefix: string | null, number: number): IPropertyValue {
  return { type: 'unique_id', unique_id: { prefix, number } };
}

// ═════════════════════════════════════════════════════════════════════════════
//  evaluateFilter
// ═════════════════════════════════════════════════════════════════════════════

describe('evaluateFilter', () => {
  const titleProp = makeProp({ id: 'title', type: 'title', name: 'Title' });
  const textProp = makeProp({ id: 'desc', type: 'rich_text', name: 'Description' });
  const numProp = makeProp({ id: 'price', type: 'number', name: 'Price' });
  const selectProp = makeProp({ id: 'status', type: 'select', name: 'Status' });
  const multiProp = makeProp({ id: 'tags', type: 'multi_select', name: 'Tags' });
  const checkProp = makeProp({ id: 'done', type: 'checkbox', name: 'Done' });
  const dateProp = makeProp({ id: 'due', type: 'date', name: 'Due' });
  const urlProp = makeProp({ id: 'link', type: 'url', name: 'Link' });
  const emailProp = makeProp({ id: 'email', type: 'email', name: 'Email' });
  const relationProp = makeProp({ id: 'rel', type: 'relation', name: 'Relation' });
  const uidProp = makeProp({ id: 'uid', type: 'unique_id', name: 'ID' });
  const allProps = [titleProp, textProp, numProp, selectProp, multiProp, checkProp, dateProp, urlProp, emailProp, relationProp, uidProp];

  // ── Empty filters always pass ──

  it('passes when filter has no rules', () => {
    const row = makeRow('Test', {});
    const filter: IFilterGroup = { conjunction: 'and', rules: [] };
    expect(evaluateFilter(row, filter, allProps)).toBe(true);
  });

  // ── Text operators ──

  describe('text operators', () => {
    const row = makeRow('Hello World', { desc: textVal('Good morning') });

    it('contains (case-insensitive)', () => {
      const filter: IFilterGroup = {
        conjunction: 'and',
        rules: [{ propertyId: 'desc', operator: 'contains', value: 'MORNING' }],
      };
      expect(evaluateFilter(row, filter, allProps)).toBe(true);
    });

    it('does_not_contain', () => {
      const filter: IFilterGroup = {
        conjunction: 'and',
        rules: [{ propertyId: 'desc', operator: 'does_not_contain', value: 'night' }],
      };
      expect(evaluateFilter(row, filter, allProps)).toBe(true);
    });

    it('equals', () => {
      const filter: IFilterGroup = {
        conjunction: 'and',
        rules: [{ propertyId: 'desc', operator: 'equals', value: 'good morning' }],
      };
      expect(evaluateFilter(row, filter, allProps)).toBe(true);
    });

    it('does_not_equal', () => {
      const filter: IFilterGroup = {
        conjunction: 'and',
        rules: [{ propertyId: 'desc', operator: 'does_not_equal', value: 'something else' }],
      };
      expect(evaluateFilter(row, filter, allProps)).toBe(true);
    });

    it('starts_with', () => {
      const filter: IFilterGroup = {
        conjunction: 'and',
        rules: [{ propertyId: 'desc', operator: 'starts_with', value: 'good' }],
      };
      expect(evaluateFilter(row, filter, allProps)).toBe(true);
    });

    it('ends_with', () => {
      const filter: IFilterGroup = {
        conjunction: 'and',
        rules: [{ propertyId: 'desc', operator: 'ends_with', value: 'morning' }],
      };
      expect(evaluateFilter(row, filter, allProps)).toBe(true);
    });

    it('title property uses page title', () => {
      const filter: IFilterGroup = {
        conjunction: 'and',
        rules: [{ propertyId: 'title', operator: 'contains', value: 'hello' }],
      };
      expect(evaluateFilter(row, filter, allProps)).toBe(true);
    });
  });

  // ── Number operators ──

  describe('number operators', () => {
    const row = makeRow('Item', { price: numVal(42) });

    it('equals', () => {
      const filter: IFilterGroup = {
        conjunction: 'and',
        rules: [{ propertyId: 'price', operator: 'equals', value: 42 }],
      };
      expect(evaluateFilter(row, filter, allProps)).toBe(true);
    });

    it('does_not_equal', () => {
      const filter: IFilterGroup = {
        conjunction: 'and',
        rules: [{ propertyId: 'price', operator: 'does_not_equal', value: 99 }],
      };
      expect(evaluateFilter(row, filter, allProps)).toBe(true);
    });

    it('greater_than', () => {
      const filter: IFilterGroup = {
        conjunction: 'and',
        rules: [{ propertyId: 'price', operator: 'greater_than', value: 40 }],
      };
      expect(evaluateFilter(row, filter, allProps)).toBe(true);
    });

    it('less_than', () => {
      const filter: IFilterGroup = {
        conjunction: 'and',
        rules: [{ propertyId: 'price', operator: 'less_than', value: 50 }],
      };
      expect(evaluateFilter(row, filter, allProps)).toBe(true);
    });

    it('greater_than_or_equal', () => {
      const filter: IFilterGroup = {
        conjunction: 'and',
        rules: [{ propertyId: 'price', operator: 'greater_than_or_equal', value: 42 }],
      };
      expect(evaluateFilter(row, filter, allProps)).toBe(true);
    });

    it('less_than_or_equal', () => {
      const filter: IFilterGroup = {
        conjunction: 'and',
        rules: [{ propertyId: 'price', operator: 'less_than_or_equal', value: 42 }],
      };
      expect(evaluateFilter(row, filter, allProps)).toBe(true);
    });

    it('null number fails numeric comparisons', () => {
      const row = makeRow('Item', { price: numVal(null) });
      const filter: IFilterGroup = {
        conjunction: 'and',
        rules: [{ propertyId: 'price', operator: 'greater_than', value: 0 }],
      };
      expect(evaluateFilter(row, filter, allProps)).toBe(false);
    });
  });

  // ── Select operators ──

  describe('select operators', () => {
    const row = makeRow('Item', { status: selectVal('Done') });

    it('equals (case-insensitive)', () => {
      const filter: IFilterGroup = {
        conjunction: 'and',
        rules: [{ propertyId: 'status', operator: 'equals', value: 'done' }],
      };
      expect(evaluateFilter(row, filter, allProps)).toBe(true);
    });

    it('does_not_equal', () => {
      const filter: IFilterGroup = {
        conjunction: 'and',
        rules: [{ propertyId: 'status', operator: 'does_not_equal', value: 'In Progress' }],
      };
      expect(evaluateFilter(row, filter, allProps)).toBe(true);
    });
  });

  // ── Multi-select operators ──

  describe('multi_select operators', () => {
    const row = makeRow('Item', { tags: multiSelectVal('Bug', 'Frontend') });

    it('contains matches option name', () => {
      const filter: IFilterGroup = {
        conjunction: 'and',
        rules: [{ propertyId: 'tags', operator: 'contains', value: 'Bug' }],
      };
      expect(evaluateFilter(row, filter, allProps)).toBe(true);
    });

    it('does_not_contain', () => {
      const filter: IFilterGroup = {
        conjunction: 'and',
        rules: [{ propertyId: 'tags', operator: 'does_not_contain', value: 'Backend' }],
      };
      expect(evaluateFilter(row, filter, allProps)).toBe(true);
    });

    it('contains returns false for missing option', () => {
      const filter: IFilterGroup = {
        conjunction: 'and',
        rules: [{ propertyId: 'tags', operator: 'contains', value: 'Backend' }],
      };
      expect(evaluateFilter(row, filter, allProps)).toBe(false);
    });
  });

  // ── Checkbox operators ──

  describe('checkbox operators', () => {
    it('equals true', () => {
      const row = makeRow('Item', { done: checkboxVal(true) });
      const filter: IFilterGroup = {
        conjunction: 'and',
        rules: [{ propertyId: 'done', operator: 'equals', value: true }],
      };
      expect(evaluateFilter(row, filter, allProps)).toBe(true);
    });

    it('equals false', () => {
      const row = makeRow('Item', { done: checkboxVal(false) });
      const filter: IFilterGroup = {
        conjunction: 'and',
        rules: [{ propertyId: 'done', operator: 'equals', value: false }],
      };
      expect(evaluateFilter(row, filter, allProps)).toBe(true);
    });

    it('equals with string "true"', () => {
      const row = makeRow('Item', { done: checkboxVal(true) });
      const filter: IFilterGroup = {
        conjunction: 'and',
        rules: [{ propertyId: 'done', operator: 'equals', value: 'true' }],
      };
      expect(evaluateFilter(row, filter, allProps)).toBe(true);
    });
  });

  // ── Date operators ──

  describe('date operators', () => {
    const row = makeRow('Item', { due: dateVal('2025-06-15') });

    it('equals (same day)', () => {
      const filter: IFilterGroup = {
        conjunction: 'and',
        rules: [{ propertyId: 'due', operator: 'equals', value: '2025-06-15' }],
      };
      expect(evaluateFilter(row, filter, allProps)).toBe(true);
    });

    it('before', () => {
      const filter: IFilterGroup = {
        conjunction: 'and',
        rules: [{ propertyId: 'due', operator: 'before', value: '2025-07-01' }],
      };
      expect(evaluateFilter(row, filter, allProps)).toBe(true);
    });

    it('after', () => {
      const filter: IFilterGroup = {
        conjunction: 'and',
        rules: [{ propertyId: 'due', operator: 'after', value: '2025-06-01' }],
      };
      expect(evaluateFilter(row, filter, allProps)).toBe(true);
    });

    it('on_or_before', () => {
      const filter: IFilterGroup = {
        conjunction: 'and',
        rules: [{ propertyId: 'due', operator: 'on_or_before', value: '2025-06-15' }],
      };
      expect(evaluateFilter(row, filter, allProps)).toBe(true);
    });

    it('on_or_after', () => {
      const filter: IFilterGroup = {
        conjunction: 'and',
        rules: [{ propertyId: 'due', operator: 'on_or_after', value: '2025-06-15' }],
      };
      expect(evaluateFilter(row, filter, allProps)).toBe(true);
    });

    it('null date fails all date comparisons', () => {
      const row = makeRow('Item', { due: { type: 'date', date: null } });
      const filter: IFilterGroup = {
        conjunction: 'and',
        rules: [{ propertyId: 'due', operator: 'before', value: '2030-01-01' }],
      };
      expect(evaluateFilter(row, filter, allProps)).toBe(false);
    });
  });

  // ── URL operators ──

  describe('url operators', () => {
    const row = makeRow('Item', { link: urlVal('https://example.com/path') });

    it('contains', () => {
      const filter: IFilterGroup = {
        conjunction: 'and',
        rules: [{ propertyId: 'link', operator: 'contains', value: 'example' }],
      };
      expect(evaluateFilter(row, filter, allProps)).toBe(true);
    });
  });

  // ── Relation operators ──

  describe('relation operators', () => {
    const row = makeRow('Item', { rel: relationVal('page-abc', 'page-xyz') });

    it('contains matching id', () => {
      const filter: IFilterGroup = {
        conjunction: 'and',
        rules: [{ propertyId: 'rel', operator: 'contains', value: 'page-abc' }],
      };
      expect(evaluateFilter(row, filter, allProps)).toBe(true);
    });

    it('does_not_contain', () => {
      const filter: IFilterGroup = {
        conjunction: 'and',
        rules: [{ propertyId: 'rel', operator: 'does_not_contain', value: 'page-nope' }],
      };
      expect(evaluateFilter(row, filter, allProps)).toBe(true);
    });
  });

  // ── Unique ID operators ──

  describe('unique_id operators', () => {
    const row = makeRow('Item', { uid: uniqueIdVal('TASK', 42) });

    it('contains on formatted string', () => {
      const filter: IFilterGroup = {
        conjunction: 'and',
        rules: [{ propertyId: 'uid', operator: 'contains', value: 'TASK-42' }],
      };
      expect(evaluateFilter(row, filter, allProps)).toBe(true);
    });

    it('unique_id with null prefix', () => {
      const row = makeRow('Item', { uid: uniqueIdVal(null, 7) });
      const filter: IFilterGroup = {
        conjunction: 'and',
        rules: [{ propertyId: 'uid', operator: 'equals', value: '7' }],
      };
      expect(evaluateFilter(row, filter, allProps)).toBe(true);
    });
  });

  // ── is_empty / is_not_empty ──

  describe('emptiness checks', () => {
    it('is_empty passes for missing value', () => {
      const row = makeRow('Item', {});
      const filter: IFilterGroup = {
        conjunction: 'and',
        rules: [{ propertyId: 'desc', operator: 'is_empty' }],
      };
      expect(evaluateFilter(row, filter, allProps)).toBe(true);
    });

    it('is_not_empty passes for present value', () => {
      const row = makeRow('Item', { desc: textVal('Hello') });
      const filter: IFilterGroup = {
        conjunction: 'and',
        rules: [{ propertyId: 'desc', operator: 'is_not_empty' }],
      };
      expect(evaluateFilter(row, filter, allProps)).toBe(true);
    });

    it('checkbox is never empty', () => {
      const row = makeRow('Item', { done: checkboxVal(false) });
      const filter: IFilterGroup = {
        conjunction: 'and',
        rules: [{ propertyId: 'done', operator: 'is_empty' }],
      };
      expect(evaluateFilter(row, filter, allProps)).toBe(false);
    });

    it('empty multi_select is empty', () => {
      const row = makeRow('Item', { tags: multiSelectVal() });
      const filter: IFilterGroup = {
        conjunction: 'and',
        rules: [{ propertyId: 'tags', operator: 'is_empty' }],
      };
      expect(evaluateFilter(row, filter, allProps)).toBe(true);
    });

    it('null select is empty', () => {
      const row = makeRow('Item', { status: { type: 'select', select: null } });
      const filter: IFilterGroup = {
        conjunction: 'and',
        rules: [{ propertyId: 'status', operator: 'is_empty' }],
      };
      expect(evaluateFilter(row, filter, allProps)).toBe(true);
    });

    it('null number is empty', () => {
      const row = makeRow('Item', { price: numVal(null) });
      const filter: IFilterGroup = {
        conjunction: 'and',
        rules: [{ propertyId: 'price', operator: 'is_empty' }],
      };
      expect(evaluateFilter(row, filter, allProps)).toBe(true);
    });

    it('empty url string is empty', () => {
      const row = makeRow('Item', { link: urlVal('') });
      const filter: IFilterGroup = {
        conjunction: 'and',
        rules: [{ propertyId: 'link', operator: 'is_empty' }],
      };
      expect(evaluateFilter(row, filter, allProps)).toBe(true);
    });
  });

  // ── Conjunction logic ──

  describe('conjunction logic', () => {
    const row = makeRow('Item', { price: numVal(42), desc: textVal('Hello') });

    it('AND: all rules must pass', () => {
      const filter: IFilterGroup = {
        conjunction: 'and',
        rules: [
          { propertyId: 'price', operator: 'greater_than', value: 40 },
          { propertyId: 'desc', operator: 'contains', value: 'Hello' },
        ],
      };
      expect(evaluateFilter(row, filter, allProps)).toBe(true);
    });

    it('AND: fails if any rule fails', () => {
      const filter: IFilterGroup = {
        conjunction: 'and',
        rules: [
          { propertyId: 'price', operator: 'greater_than', value: 40 },
          { propertyId: 'desc', operator: 'contains', value: 'Nope' },
        ],
      };
      expect(evaluateFilter(row, filter, allProps)).toBe(false);
    });

    it('OR: passes if any rule passes', () => {
      const filter: IFilterGroup = {
        conjunction: 'or',
        rules: [
          { propertyId: 'price', operator: 'greater_than', value: 100 },
          { propertyId: 'desc', operator: 'contains', value: 'Hello' },
        ],
      };
      expect(evaluateFilter(row, filter, allProps)).toBe(true);
    });

    it('OR: fails if all rules fail', () => {
      const filter: IFilterGroup = {
        conjunction: 'or',
        rules: [
          { propertyId: 'price', operator: 'greater_than', value: 100 },
          { propertyId: 'desc', operator: 'contains', value: 'Nope' },
        ],
      };
      expect(evaluateFilter(row, filter, allProps)).toBe(false);
    });
  });

  // ── Nested groups ──

  describe('nested groups', () => {
    const row = makeRow('Item', {
      price: numVal(42),
      desc: textVal('Hello'),
      done: checkboxVal(true),
    });

    it('nested AND inside OR', () => {
      const filter: IFilterGroup = {
        conjunction: 'or',
        rules: [
          {
            conjunction: 'and',
            rules: [
              { propertyId: 'price', operator: 'equals', value: 99 },
              { propertyId: 'desc', operator: 'equals', value: 'Nope' },
            ],
          },
          { propertyId: 'done', operator: 'equals', value: true },
        ],
      };
      expect(evaluateFilter(row, filter, allProps)).toBe(true);
    });

    it('nested OR inside AND', () => {
      const filter: IFilterGroup = {
        conjunction: 'and',
        rules: [
          {
            conjunction: 'or',
            rules: [
              { propertyId: 'price', operator: 'equals', value: 42 },
              { propertyId: 'price', operator: 'equals', value: 99 },
            ],
          },
          { propertyId: 'done', operator: 'equals', value: true },
        ],
      };
      expect(evaluateFilter(row, filter, allProps)).toBe(true);
    });

    it('deeply nested group evaluates correctly', () => {
      const filter: IFilterGroup = {
        conjunction: 'and',
        rules: [
          {
            conjunction: 'or',
            rules: [
              {
                conjunction: 'and',
                rules: [
                  { propertyId: 'price', operator: 'greater_than', value: 40 },
                  { propertyId: 'desc', operator: 'contains', value: 'Hello' },
                ],
              },
              { propertyId: 'done', operator: 'equals', value: false },
            ],
          },
        ],
      };
      expect(evaluateFilter(row, filter, allProps)).toBe(true);
    });
  });

  // ── Edge cases ──

  describe('edge cases', () => {
    it('unknown property passes through', () => {
      const row = makeRow('Item', {});
      const filter: IFilterGroup = {
        conjunction: 'and',
        rules: [{ propertyId: 'nonexistent', operator: 'equals', value: 'x' }],
      };
      expect(evaluateFilter(row, filter, allProps)).toBe(true);
    });

    it('unknown operator falls through to true', () => {
      const row = makeRow('Item', { desc: textVal('Hello') });
      const filter: IFilterGroup = {
        conjunction: 'and',
        rules: [{ propertyId: 'desc', operator: 'some_future_operator' as any, value: 'x' }],
      };
      expect(evaluateFilter(row, filter, allProps)).toBe(true);
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  applySorts
// ═════════════════════════════════════════════════════════════════════════════

describe('applySorts', () => {
  const titleProp = makeProp({ id: 'title', type: 'title', name: 'Title' });
  const numProp = makeProp({ id: 'price', type: 'number', name: 'Price' });
  const textProp = makeProp({ id: 'name', type: 'rich_text', name: 'Name' });
  const selectProp = makeProp({ id: 'status', type: 'select', name: 'Status' });
  const checkProp = makeProp({ id: 'done', type: 'checkbox', name: 'Done' });
  const dateProp = makeProp({ id: 'due', type: 'date', name: 'Due' });
  const allProps = [titleProp, numProp, textProp, selectProp, checkProp, dateProp];

  it('returns copy when no sorts (preserves original order)', () => {
    const rows = [
      makeRow('B', {}, 1),
      makeRow('A', {}, 0),
    ];
    const result = applySorts(rows, [], allProps);
    expect(result).not.toBe(rows); // new array
    expect(result[0].page.title).toBe('B');
    expect(result[1].page.title).toBe('A');
  });

  it('sorts by title ascending', () => {
    const rows = [
      makeRow('Charlie', {}, 2),
      makeRow('Alpha', {}, 0),
      makeRow('Bravo', {}, 1),
    ];
    const sorts: ISortRule[] = [{ propertyId: 'title', direction: 'ascending' }];
    const result = applySorts(rows, sorts, allProps);
    expect(result.map(r => r.page.title)).toEqual(['Alpha', 'Bravo', 'Charlie']);
  });

  it('sorts by title descending', () => {
    const rows = [
      makeRow('Alpha', {}, 0),
      makeRow('Charlie', {}, 2),
      makeRow('Bravo', {}, 1),
    ];
    const sorts: ISortRule[] = [{ propertyId: 'title', direction: 'descending' }];
    const result = applySorts(rows, sorts, allProps);
    expect(result.map(r => r.page.title)).toEqual(['Charlie', 'Bravo', 'Alpha']);
  });

  it('sorts by number ascending', () => {
    const rows = [
      makeRow('C', { price: numVal(30) }, 2),
      makeRow('A', { price: numVal(10) }, 0),
      makeRow('B', { price: numVal(20) }, 1),
    ];
    const sorts: ISortRule[] = [{ propertyId: 'price', direction: 'ascending' }];
    const result = applySorts(rows, sorts, allProps);
    expect(result.map(r => (r.values.price as any).number)).toEqual([10, 20, 30]);
  });

  it('sorts by number descending', () => {
    const rows = [
      makeRow('A', { price: numVal(10) }, 0),
      makeRow('B', { price: numVal(20) }, 1),
      makeRow('C', { price: numVal(30) }, 2),
    ];
    const sorts: ISortRule[] = [{ propertyId: 'price', direction: 'descending' }];
    const result = applySorts(rows, sorts, allProps);
    expect(result.map(r => (r.values.price as any).number)).toEqual([30, 20, 10]);
  });

  it('empty values sort to bottom (ascending)', () => {
    const rows = [
      makeRow('Empty', {}, 2),
      makeRow('A', { price: numVal(10) }, 0),
      makeRow('Null', { price: numVal(null) }, 1),
    ];
    const sorts: ISortRule[] = [{ propertyId: 'price', direction: 'ascending' }];
    const result = applySorts(rows, sorts, allProps);
    expect(result[0].page.title).toBe('A');
    // Empty/null go to bottom
    expect(result[2].page.title).toBe('Empty');
  });

  it('multi-sort: primary then secondary', () => {
    const rows = [
      makeRow('B2', { status: selectVal('Done'), price: numVal(20) }, 3),
      makeRow('A1', { status: selectVal('Active'), price: numVal(10) }, 0),
      makeRow('A2', { status: selectVal('Active'), price: numVal(20) }, 1),
      makeRow('B1', { status: selectVal('Done'), price: numVal(10) }, 2),
    ];
    const sorts: ISortRule[] = [
      { propertyId: 'status', direction: 'ascending' },
      { propertyId: 'price', direction: 'ascending' },
    ];
    const result = applySorts(rows, sorts, allProps);
    expect(result.map(r => r.page.title)).toEqual(['A1', 'A2', 'B1', 'B2']);
  });

  it('sorts by checkbox (checked first ascending)', () => {
    const rows = [
      makeRow('Unchecked', { done: checkboxVal(false) }, 0),
      makeRow('Checked', { done: checkboxVal(true) }, 1),
    ];
    const sorts: ISortRule[] = [{ propertyId: 'done', direction: 'ascending' }];
    const result = applySorts(rows, sorts, allProps);
    expect(result[0].page.title).toBe('Checked');
    expect(result[1].page.title).toBe('Unchecked');
  });

  it('does not mutate the original array', () => {
    const rows = [
      makeRow('B', {}, 1),
      makeRow('A', {}, 0),
    ];
    const sorts: ISortRule[] = [{ propertyId: 'title', direction: 'ascending' }];
    applySorts(rows, sorts, allProps);
    expect(rows[0].page.title).toBe('B'); // unchanged
  });

  it('stable sort: ties use sortOrder', () => {
    const rows = [
      makeRow('B', { price: numVal(10) }, 5),
      makeRow('A', { price: numVal(10) }, 2),
    ];
    const sorts: ISortRule[] = [{ propertyId: 'price', direction: 'ascending' }];
    const result = applySorts(rows, sorts, allProps);
    // same price → fallback to sortOrder: A (2) before B (5)
    expect(result[0].page.title).toBe('A');
    expect(result[1].page.title).toBe('B');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  groupRows
// ═════════════════════════════════════════════════════════════════════════════

describe('groupRows', () => {
  const selectProp = makeProp({
    id: 'status',
    type: 'select',
    name: 'Status',
    config: {
      options: [
        { id: 'opt-1', name: 'To Do', color: 'red' },
        { id: 'opt-2', name: 'In Progress', color: 'yellow' },
        { id: 'opt-3', name: 'Done', color: 'green' },
      ],
    } as any,
  });
  const checkProp = makeProp({ id: 'done', type: 'checkbox', name: 'Done' });
  const allProps = [selectProp, checkProp];

  it('returns single "__all__" group when groupByPropId is null', () => {
    const rows = [makeRow('A', {}), makeRow('B', {})];
    const groups = groupRows(rows, null, null, allProps, false);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe('__all__');
    expect(groups[0].label).toBe('All');
    expect(groups[0].rows).toHaveLength(2);
  });

  it('groups by select property following option order', () => {
    const rows = [
      makeRow('Task1', { status: selectVal('Done') }),
      makeRow('Task2', { status: selectVal('To Do') }),
      makeRow('Task3', { status: selectVal('In Progress') }),
    ];
    const groups = groupRows(rows, 'status', null, allProps, false);
    // Groups follow option order: To Do, In Progress, Done
    expect(groups.map(g => g.label)).toEqual(['To Do', 'In Progress', 'Done']);
    expect(groups[0].rows[0].page.title).toBe('Task2');
    expect(groups[1].rows[0].page.title).toBe('Task3');
    expect(groups[2].rows[0].page.title).toBe('Task1');
  });

  it('assigns rows without value to "No value" group', () => {
    const rows = [
      makeRow('Task1', { status: selectVal('Done') }),
      makeRow('Task2', {}), // no status
    ];
    const groups = groupRows(rows, 'status', null, allProps, false);
    const noValueGroup = groups.find(g => g.key === '__no_value__');
    expect(noValueGroup).toBeDefined();
    expect(noValueGroup!.label).toBe('No value');
    expect(noValueGroup!.rows).toHaveLength(1);
    expect(noValueGroup!.rows[0].page.title).toBe('Task2');
  });

  it('includes colors from property config', () => {
    const rows = [makeRow('Task1', { status: selectVal('Done') })];
    const groups = groupRows(rows, 'status', null, allProps, false);
    const doneGroup = groups.find(g => g.label === 'Done');
    expect(doneGroup!.color).toBe('green');
  });

  it('hides empty groups when hideEmptyGroups is true', () => {
    const rows = [
      makeRow('Task1', { status: selectVal('Done') }),
      // No "To Do" or "In Progress" rows
    ];
    const groups = groupRows(rows, 'status', null, allProps, true);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('Done');
  });

  it('shows empty groups when hideEmptyGroups is false', () => {
    const rows = [
      makeRow('Task1', { status: selectVal('Done') }),
    ];
    const groups = groupRows(rows, 'status', null, allProps, false);
    // All 3 option groups exist even if empty
    expect(groups.length).toBeGreaterThanOrEqual(3);
  });

  it('groups by checkbox', () => {
    const rows = [
      makeRow('A', { done: checkboxVal(true) }),
      makeRow('B', { done: checkboxVal(false) }),
      makeRow('C', { done: checkboxVal(true) }),
    ];
    const groups = groupRows(rows, 'done', null, allProps, false);
    const checkedGroup = groups.find(g => g.key === 'Checked');
    const uncheckedGroup = groups.find(g => g.key === 'Unchecked');
    expect(checkedGroup!.rows).toHaveLength(2);
    expect(uncheckedGroup!.rows).toHaveLength(1);
  });

  it('sub-grouping creates nested groups', () => {
    const rows = [
      makeRow('Task1', { status: selectVal('Done'), done: checkboxVal(true) }),
      makeRow('Task2', { status: selectVal('Done'), done: checkboxVal(false) }),
    ];
    const groups = groupRows(rows, 'status', 'done', allProps, true);
    const doneGroup = groups.find(g => g.label === 'Done');
    expect(doneGroup).toBeDefined();
    expect(doneGroup!.subGroups).toBeDefined();
    expect(doneGroup!.subGroups!.length).toBeGreaterThan(0);
  });

  it('returns fallback single group for unknown groupBy property', () => {
    const rows = [makeRow('A', {})];
    const groups = groupRows(rows, 'nonexistent', null, allProps, false);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe('__all__');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  applyViewDataPipeline
// ═════════════════════════════════════════════════════════════════════════════

describe('applyViewDataPipeline', () => {
  const numProp = makeProp({ id: 'price', type: 'number', name: 'Price' });
  const selectProp = makeProp({
    id: 'status',
    type: 'select',
    name: 'Status',
    config: {
      options: [
        { id: 'opt-1', name: 'Open', color: 'blue' },
        { id: 'opt-2', name: 'Closed', color: 'gray' },
      ],
    } as any,
  });
  const allProps = [numProp, selectProp];

  it('chains filter → sort → group', () => {
    const rows = [
      makeRow('Cheap-Open', { price: numVal(10), status: selectVal('Open') }, 0),
      makeRow('Expensive-Open', { price: numVal(50), status: selectVal('Open') }, 1),
      makeRow('Medium-Closed', { price: numVal(30), status: selectVal('Closed') }, 2),
      makeRow('Tiny-Closed', { price: numVal(5), status: selectVal('Closed') }, 3),
    ];

    const view = {
      filterConfig: {
        conjunction: 'and' as const,
        rules: [{ propertyId: 'price', operator: 'greater_than' as const, value: 8 }],
      },
      sortConfig: [{ propertyId: 'price', direction: 'ascending' as const }] as ISortRule[],
      groupBy: 'status',
      subGroupBy: null,
      hideEmptyGroups: true,
    };

    const result = applyViewDataPipeline(rows, view, allProps);

    // Filter: Tiny-Closed (price=5) excluded
    expect(result.filteredRows).toHaveLength(3);

    // Sort: 10, 30, 50
    expect(result.sortedRows.map(r => (r.values.price as any).number)).toEqual([10, 30, 50]);

    // Group: Open [Cheap-Open, Expensive-Open], Closed [Medium-Closed]
    expect(result.groups.length).toBeGreaterThanOrEqual(2);
    const openGroup = result.groups.find(g => g.label === 'Open');
    const closedGroup = result.groups.find(g => g.label === 'Closed');
    expect(openGroup!.rows).toHaveLength(2);
    expect(closedGroup!.rows).toHaveLength(1);
  });

  it('empty filter passes all rows through', () => {
    const rows = [makeRow('A', {}), makeRow('B', {})];
    const view = {
      filterConfig: { conjunction: 'and' as const, rules: [] },
      sortConfig: [] as ISortRule[],
      groupBy: null,
      subGroupBy: null,
      hideEmptyGroups: false,
    };
    const result = applyViewDataPipeline(rows, view, allProps);
    expect(result.filteredRows).toHaveLength(2);
    expect(result.sortedRows).toHaveLength(2);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].key).toBe('__all__');
  });
});
