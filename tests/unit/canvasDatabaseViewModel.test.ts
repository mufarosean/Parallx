import { describe, expect, it } from 'vitest';
import { applyFilter, applySort, groupRows, parseFilterConfig, parseSortConfig } from '../../src/built-in/canvas/database/databaseViewModel';
import type { IDatabaseRow } from '../../src/built-in/canvas/database/databaseTypes';
import { TITLE_KEY } from '../../src/built-in/canvas/database/databaseTypes';

function row(pageId: string, title: string, values: Record<string, unknown>, sortOrder = 0): IDatabaseRow {
  return { pageId, title, icon: null, sortOrder, values, createdAt: '2026-01-01', updatedAt: '2026-01-01' };
}

const ROWS = [
  row('a', 'Alpha', { status: 'Done', est: 5, tags: ['x', 'y'], due: '2026-06-01' }, 1),
  row('b', 'Beta', { status: 'To do', est: 2, tags: [], due: '2026-07-15' }, 2),
  row('c', 'Gamma', { status: 'In progress', est: 8, due: '2026-05-20' }, 3),
  row('d', 'Delta', { status: 'To do', est: null }, 4),
];

describe('database view model — filtering', () => {
  it('equals / not_equals on select values', () => {
    expect(applyFilter(ROWS, { conjunction: 'and', rules: [{ propertyId: 'status', op: 'equals', value: 'To do' }] }).map((r) => r.pageId)).toEqual(['b', 'd']);
    expect(applyFilter(ROWS, { conjunction: 'and', rules: [{ propertyId: 'status', op: 'not_equals', value: 'To do' }] }).map((r) => r.pageId)).toEqual(['a', 'c']);
  });

  it('contains works on strings, arrays, and the title sentinel', () => {
    expect(applyFilter(ROWS, { conjunction: 'and', rules: [{ propertyId: 'tags', op: 'contains', value: 'x' }] }).map((r) => r.pageId)).toEqual(['a']);
    expect(applyFilter(ROWS, { conjunction: 'and', rules: [{ propertyId: TITLE_KEY, op: 'contains', value: 'eta' }] }).map((r) => r.pageId)).toEqual(['b']);
  });

  it('is_empty / is_not_empty treat null, missing, "", and [] as empty', () => {
    expect(applyFilter(ROWS, { conjunction: 'and', rules: [{ propertyId: 'est', op: 'is_empty' }] }).map((r) => r.pageId)).toEqual(['d']);
    expect(applyFilter(ROWS, { conjunction: 'and', rules: [{ propertyId: 'tags', op: 'is_not_empty' }] }).map((r) => r.pageId)).toEqual(['a']);
  });

  it('greater_than / less_than compare numbers numerically and dates lexically', () => {
    expect(applyFilter(ROWS, { conjunction: 'and', rules: [{ propertyId: 'est', op: 'greater_than', value: 4 }] }).map((r) => r.pageId)).toEqual(['a', 'c']);
    expect(applyFilter(ROWS, { conjunction: 'and', rules: [{ propertyId: 'due', op: 'less_than', value: '2026-06-15' }] }).map((r) => r.pageId)).toEqual(['a', 'c']);
  });

  it('AND requires all rules; OR requires any', () => {
    const rules = [
      { propertyId: 'status', op: 'equals' as const, value: 'To do' },
      { propertyId: 'est', op: 'greater_than' as const, value: 1 },
    ];
    expect(applyFilter(ROWS, { conjunction: 'and', rules }).map((r) => r.pageId)).toEqual(['b']);
    expect(applyFilter(ROWS, { conjunction: 'or', rules }).map((r) => r.pageId)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('database view model — sorting', () => {
  it('defaults to manual membership order with no sort rules', () => {
    const shuffled = [ROWS[2], ROWS[0], ROWS[3], ROWS[1]];
    expect(applySort(shuffled, []).map((r) => r.pageId)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('sorts numerically, desc, with empties always last', () => {
    expect(applySort(ROWS, [{ propertyId: 'est', dir: 'desc' }]).map((r) => r.pageId)).toEqual(['c', 'a', 'b', 'd']);
    expect(applySort(ROWS, [{ propertyId: 'est', dir: 'asc' }]).map((r) => r.pageId)).toEqual(['b', 'a', 'c', 'd']);
  });

  it('multi-level sort: status asc then est desc', () => {
    const sorted = applySort(ROWS, [
      { propertyId: 'status', dir: 'asc' },
      { propertyId: 'est', dir: 'desc' },
    ]);
    expect(sorted.map((r) => r.pageId)).toEqual(['a', 'c', 'b', 'd']); // Done, In progress, To do(est 2), To do(est null→last within group)
  });

  it('sorts by title via the sentinel', () => {
    expect(applySort(ROWS, [{ propertyId: TITLE_KEY, dir: 'desc' }]).map((r) => r.title)).toEqual(['Gamma', 'Delta', 'Beta', 'Alpha']);
  });
});

describe('database view model — grouping (board columns)', () => {
  it('orders groups by the select options, no-value group last', () => {
    const groups = groupRows(ROWS, 'status', ['To do', 'In progress', 'Done']);
    expect(groups.map((g) => g.key)).toEqual(['To do', 'In progress', 'Done']);
    expect(groups[0].rows.map((r) => r.pageId)).toEqual(['b', 'd']);
    expect(groups[1].rows.map((r) => r.pageId)).toEqual(['c']);
    expect(groups[2].rows.map((r) => r.pageId)).toEqual(['a']);
  });

  it('rows with no value land in the trailing empty group', () => {
    const groups = groupRows([row('x', 'X', {})], 'status', ['To do']);
    expect(groups.map((g) => g.key)).toEqual(['To do', '']);
    expect(groups[1].rows.map((r) => r.pageId)).toEqual(['x']);
  });

  it('multi-value (tags) rows appear in every matching group', () => {
    const groups = groupRows(ROWS, 'tags', []);
    const keys = groups.map((g) => g.key);
    expect(keys).toContain('x');
    expect(keys).toContain('y');
    expect(groups.find((g) => g.key === 'x')!.rows[0].pageId).toBe('a');
  });
});

describe('database view model — persisted config parsing', () => {
  it('parses valid configs and falls back safely on garbage', () => {
    expect(parseFilterConfig('{"conjunction":"or","rules":[{"propertyId":"p","op":"equals","value":1}]}').conjunction).toBe('or');
    expect(parseFilterConfig('not json')).toEqual({ conjunction: 'and', rules: [] });
    expect(parseSortConfig('[{"propertyId":"p","dir":"desc"}]')).toHaveLength(1);
    expect(parseSortConfig('[{"propertyId":"p","dir":"sideways"}]')).toHaveLength(0);
    expect(parseSortConfig(null)).toEqual([]);
  });
});
