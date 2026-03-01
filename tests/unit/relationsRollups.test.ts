/**
 * @vitest-environment jsdom
 */
/**
 * Unit tests for Phase 7 — Relations & Rollups
 *
 * Tests:
 *   - Relation resolver: resolve, candidates, link mutation, toggle, reciprocal
 *   - Rollup engine: all 21 aggregation functions, computeRollup, computeRollups
 *   - Relation renderer: DOM output for linked pages
 *   - Rollup renderer: different output types
 *   - Relation editor: candidate list rendering
 *   - Registry exports: all Phase 7 symbols accessible
 */
import { describe, it, expect, vi, type Mock } from 'vitest';
import {
  addRelationLink,
  removeRelationLink,
  toggleRelationLink,
  isSelfRelation,
  resolveRelation,
  getRelationCandidates,
  getSelfRelationCandidates,
  syncReciprocal,
  setRelationWithSync,
  createReciprocalRelation,
} from '../../src/built-in/canvas/database/relations/relationResolver';
import {
  evaluateRollupFunction,
  computeRollup,
  computeRollups,
  rollupResultToPropertyValue,
} from '../../src/built-in/canvas/database/relations/rollupEngine';
import type {
  RollupFunction,
  IRollupResult,
} from '../../src/built-in/canvas/database/relations/rollupEngine';
import {
  renderRelation,
  renderRollup,
} from '../../src/built-in/canvas/database/properties/propertyRenderers';
import type {
  IDatabaseDataService,
  IDatabaseProperty,
  IDatabaseRow,
  IPropertyValue,
  IRelationPropertyConfig,
  IRollupPropertyConfig,
} from '../../src/built-in/canvas/database/databaseTypes';

// ─── Mock Data Service ──────────────────────────────────────────────────────

function createMockDataService(overrides: Partial<IDatabaseDataService> = {}): IDatabaseDataService {
  return {
    onDidChangeDatabase: { subscribe: vi.fn() } as never,
    onDidChangeProperty: { subscribe: vi.fn() } as never,
    onDidChangeRow: { subscribe: vi.fn() } as never,
    onDidChangeView: { subscribe: vi.fn() } as never,
    createDatabase: vi.fn(),
    getDatabase: vi.fn().mockResolvedValue(null),
    getDatabaseByPageId: vi.fn().mockResolvedValue(null),
    getDatabasePageIds: vi.fn().mockResolvedValue(new Set()),
    getDatabaseRowPageIds: vi.fn().mockResolvedValue(new Set()),
    updateDatabase: vi.fn(),
    deleteDatabase: vi.fn(),
    addProperty: vi.fn(),
    updateProperty: vi.fn(),
    removeProperty: vi.fn(),
    reorderProperties: vi.fn(),
    getProperties: vi.fn().mockResolvedValue([]),
    addRow: vi.fn(),
    removeRow: vi.fn(),
    getRows: vi.fn().mockResolvedValue([]),
    reorderRows: vi.fn(),
    setPropertyValue: vi.fn(),
    getPropertyValues: vi.fn().mockResolvedValue({}),
    batchSetPropertyValues: vi.fn(),
    createView: vi.fn(),
    getViews: vi.fn().mockResolvedValue([]),
    getView: vi.fn().mockResolvedValue(null),
    updateView: vi.fn(),
    deleteView: vi.fn(),
    duplicateView: vi.fn(),
    reorderViews: vi.fn(),
    ...overrides,
  } as IDatabaseDataService;
}

function makeRow(pageId: string, title: string, values: Record<string, IPropertyValue> = {}): IDatabaseRow {
  return {
    page: { id: pageId, title, parentId: null, sortOrder: 0, icon: null, cover: null, isDeleted: false, createdAt: '', updatedAt: '' },
    values,
    sortOrder: 0,
  };
}

function makeRelationProperty(id: string, databaseId: string, targetDbId: string, syncedPropertyId?: string): IDatabaseProperty {
  const config: IRelationPropertyConfig = {
    databaseId: targetDbId,
    syncedPropertyId,
  };
  return {
    id,
    databaseId,
    name: `Relation to ${targetDbId}`,
    type: 'relation',
    config,
    sortOrder: 0,
    createdAt: '',
    updatedAt: '',
  };
}

function makeRollupProperty(
  id: string,
  databaseId: string,
  relationPropertyId: string,
  rollupPropertyId: string,
  fn: RollupFunction,
): IDatabaseProperty {
  const config: IRollupPropertyConfig = {
    relationPropertyId,
    relationPropertyName: 'Relation',
    rollupPropertyId,
    rollupPropertyName: 'Target',
    function: fn,
  };
  return {
    id,
    databaseId,
    name: 'Rollup',
    type: 'rollup',
    config,
    sortOrder: 0,
    createdAt: '',
    updatedAt: '',
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Relation Resolver
// ═══════════════════════════════════════════════════════════════════════════════

describe('Relation Resolver', () => {

  // ── Link Mutation (pure functions) ──

  describe('addRelationLink()', () => {
    it('adds a link to an empty relation', () => {
      const result = addRelationLink(undefined, 'p1');
      expect(result).toEqual({ type: 'relation', relation: [{ id: 'p1' }] });
    });

    it('adds a link to an existing relation', () => {
      const current: IPropertyValue = { type: 'relation', relation: [{ id: 'p1' }] };
      const result = addRelationLink(current, 'p2');
      expect(result.type).toBe('relation');
      if (result.type === 'relation') {
        expect(result.relation).toHaveLength(2);
        expect(result.relation.map(r => r.id)).toContain('p2');
      }
    });

    it('does not duplicate an existing link', () => {
      const current: IPropertyValue = { type: 'relation', relation: [{ id: 'p1' }] };
      const result = addRelationLink(current, 'p1');
      if (result.type === 'relation') {
        expect(result.relation).toHaveLength(1);
      }
    });
  });

  describe('removeRelationLink()', () => {
    it('removes a link from a relation', () => {
      const current: IPropertyValue = { type: 'relation', relation: [{ id: 'p1' }, { id: 'p2' }] };
      const result = removeRelationLink(current, 'p1');
      if (result.type === 'relation') {
        expect(result.relation).toHaveLength(1);
        expect(result.relation[0].id).toBe('p2');
      }
    });

    it('returns empty relation when removing last link', () => {
      const current: IPropertyValue = { type: 'relation', relation: [{ id: 'p1' }] };
      const result = removeRelationLink(current, 'p1');
      if (result.type === 'relation') {
        expect(result.relation).toHaveLength(0);
      }
    });

    it('handles removing non-existent link gracefully', () => {
      const current: IPropertyValue = { type: 'relation', relation: [{ id: 'p1' }] };
      const result = removeRelationLink(current, 'p999');
      if (result.type === 'relation') {
        expect(result.relation).toHaveLength(1);
      }
    });
  });

  describe('toggleRelationLink()', () => {
    it('adds a link when not present', () => {
      const { value, added } = toggleRelationLink(undefined, 'p1');
      expect(added).toBe(true);
      if (value.type === 'relation') {
        expect(value.relation).toHaveLength(1);
        expect(value.relation[0].id).toBe('p1');
      }
    });

    it('removes a link when already present', () => {
      const current: IPropertyValue = { type: 'relation', relation: [{ id: 'p1' }] };
      const { value, added } = toggleRelationLink(current, 'p1');
      expect(added).toBe(false);
      if (value.type === 'relation') {
        expect(value.relation).toHaveLength(0);
      }
    });
  });

  // ── Self-referential ──

  describe('isSelfRelation()', () => {
    it('returns true for self-referential relation', () => {
      const prop = makeRelationProperty('rel1', 'db1', 'db1');
      expect(isSelfRelation(prop)).toBe(true);
    });

    it('returns false for cross-database relation', () => {
      const prop = makeRelationProperty('rel1', 'db1', 'db2');
      expect(isSelfRelation(prop)).toBe(false);
    });
  });

  // ── Async Resolution ──

  describe('resolveRelation()', () => {
    it('resolves linked page IDs to titles', async () => {
      const ds = createMockDataService({
        getRows: vi.fn().mockResolvedValue([
          makeRow('p1', 'Task A'),
          makeRow('p2', 'Task B'),
          makeRow('p3', 'Task C'),
        ]),
      });
      const prop = makeRelationProperty('rel1', 'dbA', 'dbB');
      const value: IPropertyValue = { type: 'relation', relation: [{ id: 'p1' }, { id: 'p3' }] };
      const result = await resolveRelation(ds, prop, value);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ id: 'p1', title: 'Task A' });
      expect(result[1]).toEqual({ id: 'p3', title: 'Task C' });
    });

    it('returns empty array for empty relation', async () => {
      const ds = createMockDataService();
      const prop = makeRelationProperty('rel1', 'dbA', 'dbB');
      const result = await resolveRelation(ds, prop, undefined);
      expect(result).toEqual([]);
    });

    it('drops references to deleted pages silently', async () => {
      const ds = createMockDataService({
        getRows: vi.fn().mockResolvedValue([makeRow('p1', 'Existing')]),
      });
      const prop = makeRelationProperty('rel1', 'dbA', 'dbB');
      const value: IPropertyValue = { type: 'relation', relation: [{ id: 'p1' }, { id: 'p_deleted' }] };
      const result = await resolveRelation(ds, prop, value);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('p1');
    });
  });

  describe('getRelationCandidates()', () => {
    it('returns candidates with isLinked flags', async () => {
      const ds = createMockDataService({
        getRows: vi.fn().mockResolvedValue([
          makeRow('p1', 'Page A'),
          makeRow('p2', 'Page B'),
        ]),
      });
      const prop = makeRelationProperty('rel1', 'dbA', 'dbB');
      const value: IPropertyValue = { type: 'relation', relation: [{ id: 'p1' }] };
      const candidates = await getRelationCandidates(ds, prop, value);
      expect(candidates).toHaveLength(2);
      expect(candidates[0].isLinked).toBe(true);
      expect(candidates[1].isLinked).toBe(false);
    });
  });

  describe('getSelfRelationCandidates()', () => {
    it('excludes the current page from self-relation candidates', async () => {
      const ds = createMockDataService({
        getRows: vi.fn().mockResolvedValue([
          makeRow('p1', 'Page 1'),
          makeRow('p2', 'Page 2'),
          makeRow('p3', 'Page 3'),
        ]),
      });
      const prop = makeRelationProperty('rel1', 'db1', 'db1');
      const candidates = await getSelfRelationCandidates(ds, prop, 'p2', undefined);
      expect(candidates).toHaveLength(2);
      expect(candidates.every(c => c.id !== 'p2')).toBe(true);
    });
  });

  // ── Reciprocal Sync ──

  describe('syncReciprocal()', () => {
    it('adds link to reciprocal property when link is added', async () => {
      const ds = createMockDataService({
        getPropertyValues: vi.fn().mockResolvedValue({
          'reciprocal1': { type: 'relation', relation: [] },
        }),
      });
      const prop = makeRelationProperty('rel1', 'dbA', 'dbB', 'reciprocal1');

      await syncReciprocal(ds, prop, 'pageA1', 'pageB1', true);

      expect(ds.setPropertyValue).toHaveBeenCalledWith(
        'dbB',           // target database
        'pageB1',        // target page
        'reciprocal1',   // reciprocal property
        expect.objectContaining({
          type: 'relation',
          relation: [{ id: 'pageA1' }],
        }),
      );
    });

    it('removes link from reciprocal property when link is removed', async () => {
      const ds = createMockDataService({
        getPropertyValues: vi.fn().mockResolvedValue({
          'reciprocal1': { type: 'relation', relation: [{ id: 'pageA1' }, { id: 'pageA2' }] },
        }),
      });
      const prop = makeRelationProperty('rel1', 'dbA', 'dbB', 'reciprocal1');

      await syncReciprocal(ds, prop, 'pageA1', 'pageB1', false);

      expect(ds.setPropertyValue).toHaveBeenCalledWith(
        'dbB', 'pageB1', 'reciprocal1',
        expect.objectContaining({
          type: 'relation',
          relation: [{ id: 'pageA2' }],
        }),
      );
    });

    it('does nothing when no synced property exists', async () => {
      const ds = createMockDataService();
      const prop = makeRelationProperty('rel1', 'dbA', 'dbB'); // no syncedPropertyId
      await syncReciprocal(ds, prop, 'pageA1', 'pageB1', true);
      expect(ds.setPropertyValue).not.toHaveBeenCalled();
    });
  });

  describe('createReciprocalRelation()', () => {
    it('creates reciprocal property and updates source', async () => {
      const reciprocal: IDatabaseProperty = {
        id: 'new-reciprocal',
        databaseId: 'dbB',
        name: 'Related to dbA',
        type: 'relation',
        config: { databaseId: 'dbA', syncedPropertyId: 'rel1' },
        sortOrder: 0,
        createdAt: '',
        updatedAt: '',
      };
      const ds = createMockDataService({
        getDatabase: vi.fn().mockResolvedValue({ id: 'dbA', pageId: 'dbA', description: null, isLocked: false, createdAt: '', updatedAt: '' }),
        addProperty: vi.fn().mockResolvedValue(reciprocal),
        updateProperty: vi.fn().mockResolvedValue({}),
      });

      const sourceProperty = makeRelationProperty('rel1', 'dbA', 'dbB');
      const result = await createReciprocalRelation(ds, sourceProperty, 'dbA', 'dbB');

      expect(result.id).toBe('new-reciprocal');
      expect(ds.addProperty).toHaveBeenCalledWith('dbB', expect.any(String), 'relation', expect.objectContaining({
        databaseId: 'dbA',
        syncedPropertyId: 'rel1',
      }));
      expect(ds.updateProperty).toHaveBeenCalledWith('dbA', 'rel1', expect.objectContaining({
        config: expect.objectContaining({ syncedPropertyId: 'new-reciprocal' }),
      }));
    });
  });

  describe('setRelationWithSync()', () => {
    it('toggles a link and syncs reciprocal', async () => {
      const ds = createMockDataService({
        getPropertyValues: vi.fn()
          .mockResolvedValueOnce({ 'rel1': { type: 'relation', relation: [] } })       // source read
          .mockResolvedValueOnce({ 'reciprocal1': { type: 'relation', relation: [] } }), // reciprocal read
      });
      const prop = makeRelationProperty('rel1', 'dbA', 'dbB', 'reciprocal1');

      const { value, added } = await setRelationWithSync(ds, 'dbA', 'pageA1', prop, 'pageB1');

      expect(added).toBe(true);
      if (value.type === 'relation') {
        expect(value.relation).toEqual([{ id: 'pageB1' }]);
      }
      // Both source and reciprocal should be written
      expect(ds.setPropertyValue).toHaveBeenCalledTimes(2);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Rollup Engine
// ═══════════════════════════════════════════════════════════════════════════════

describe('Rollup Engine', () => {

  // ── evaluateRollupFunction — all 21 functions ──

  describe('evaluateRollupFunction()', () => {
    const numValues: IPropertyValue[] = [
      { type: 'number', number: 10 },
      { type: 'number', number: 20 },
      { type: 'number', number: 30 },
    ];

    const checkValues: IPropertyValue[] = [
      { type: 'checkbox', checkbox: true },
      { type: 'checkbox', checkbox: false },
      { type: 'checkbox', checkbox: true },
      { type: 'checkbox', checkbox: false },
    ];

    const emptyMixedValues: (IPropertyValue | undefined)[] = [
      { type: 'number', number: 5 },
      undefined,
      { type: 'number', number: null },
      { type: 'number', number: 10 },
    ];

    const dateValues: IPropertyValue[] = [
      { type: 'date', date: { start: '2025-01-15', end: null } },
      { type: 'date', date: { start: '2025-03-20', end: null } },
      { type: 'date', date: { start: '2025-02-10', end: null } },
    ];

    const textValues: IPropertyValue[] = [
      { type: 'rich_text', rich_text: [{ type: 'text', content: 'apple' }] },
      { type: 'rich_text', rich_text: [{ type: 'text', content: 'banana' }] },
      { type: 'rich_text', rich_text: [{ type: 'text', content: 'apple' }] },
    ];

    // Count functions
    it('count — returns total number of values', () => {
      expect(evaluateRollupFunction('count', numValues)).toEqual({ type: 'number', value: 3 });
    });

    it('count_values — counts non-empty values', () => {
      expect(evaluateRollupFunction('count_values', emptyMixedValues)).toEqual({ type: 'number', value: 2 });
    });

    // Numeric aggregations
    it('sum — adds numeric values', () => {
      expect(evaluateRollupFunction('sum', numValues)).toEqual({ type: 'number', value: 60 });
    });

    it('average', () => {
      expect(evaluateRollupFunction('average', numValues)).toEqual({ type: 'number', value: 20 });
    });

    it('median — odd count', () => {
      expect(evaluateRollupFunction('median', numValues)).toEqual({ type: 'number', value: 20 });
    });

    it('median — even count', () => {
      const vals: IPropertyValue[] = [
        { type: 'number', number: 10 },
        { type: 'number', number: 20 },
        { type: 'number', number: 30 },
        { type: 'number', number: 40 },
      ];
      const result = evaluateRollupFunction('median', vals);
      expect(result.value).toBe(25);
    });

    it('min', () => {
      expect(evaluateRollupFunction('min', numValues)).toEqual({ type: 'number', value: 10 });
    });

    it('max', () => {
      expect(evaluateRollupFunction('max', numValues)).toEqual({ type: 'number', value: 30 });
    });

    it('range', () => {
      expect(evaluateRollupFunction('range', numValues)).toEqual({ type: 'number', value: 20 });
    });

    // Date aggregations
    it('earliest_date', () => {
      const result = evaluateRollupFunction('earliest_date', dateValues);
      expect(result).toEqual({ type: 'date', value: '2025-01-15' });
    });

    it('latest_date', () => {
      const result = evaluateRollupFunction('latest_date', dateValues);
      expect(result).toEqual({ type: 'date', value: '2025-03-20' });
    });

    it('date_range — days between earliest and latest', () => {
      const result = evaluateRollupFunction('date_range', dateValues);
      expect(result.type).toBe('number');
      expect(result.value).toBe(64); // Jan 15 → Mar 20 = 64 days
    });

    // Checkbox aggregations
    it('checked', () => {
      expect(evaluateRollupFunction('checked', checkValues)).toEqual({ type: 'number', value: 2 });
    });

    it('unchecked', () => {
      expect(evaluateRollupFunction('unchecked', checkValues)).toEqual({ type: 'number', value: 2 });
    });

    it('percent_checked', () => {
      const result = evaluateRollupFunction('percent_checked', checkValues);
      expect(result).toEqual({ type: 'percent', value: 50 });
    });

    it('percent_unchecked', () => {
      const result = evaluateRollupFunction('percent_unchecked', checkValues);
      expect(result).toEqual({ type: 'percent', value: 50 });
    });

    // Emptiness aggregations
    it('empty', () => {
      const result = evaluateRollupFunction('empty', emptyMixedValues);
      expect(result).toEqual({ type: 'number', value: 2 });
    });

    it('not_empty', () => {
      const result = evaluateRollupFunction('not_empty', emptyMixedValues);
      expect(result).toEqual({ type: 'number', value: 2 });
    });

    it('percent_empty', () => {
      const result = evaluateRollupFunction('percent_empty', emptyMixedValues);
      expect(result).toEqual({ type: 'percent', value: 50 });
    });

    it('percent_not_empty', () => {
      const result = evaluateRollupFunction('percent_not_empty', emptyMixedValues);
      expect(result).toEqual({ type: 'percent', value: 50 });
    });

    // Collection functions
    it('show_original', () => {
      const result = evaluateRollupFunction('show_original', textValues);
      expect(result).toEqual({ type: 'array', value: ['apple', 'banana', 'apple'] });
    });

    it('show_unique', () => {
      const result = evaluateRollupFunction('show_unique', textValues);
      expect(result).toEqual({ type: 'array', value: ['apple', 'banana'] });
    });

    it('unique — count of unique values', () => {
      const result = evaluateRollupFunction('unique', textValues);
      expect(result).toEqual({ type: 'number', value: 2 });
    });

    // Edge cases
    it('returns 0 for empty value arrays', () => {
      expect(evaluateRollupFunction('sum', [])).toEqual({ type: 'number', value: 0 });
      expect(evaluateRollupFunction('average', [])).toEqual({ type: 'number', value: 0 });
      expect(evaluateRollupFunction('count', [])).toEqual({ type: 'number', value: 0 });
    });

    it('returns null date for empty date arrays', () => {
      expect(evaluateRollupFunction('earliest_date', [])).toEqual({ type: 'date', value: null });
      expect(evaluateRollupFunction('latest_date', [])).toEqual({ type: 'date', value: null });
    });

    it('returns 0 percent for empty arrays', () => {
      expect(evaluateRollupFunction('percent_checked', [])).toEqual({ type: 'percent', value: 0 });
    });
  });

  // ── computeRollup ──

  describe('computeRollup()', () => {
    it('computes rollup from linked rows', async () => {
      const relProp = makeRelationProperty('rel1', 'dbA', 'dbB');
      const rollupProp = makeRollupProperty('rollup1', 'dbA', 'rel1', 'numProp', 'sum');
      const relatedRows: IDatabaseRow[] = [
        makeRow('pb1', 'B1', { numProp: { type: 'number', number: 10 } }),
        makeRow('pb2', 'B2', { numProp: { type: 'number', number: 20 } }),
        makeRow('pb3', 'B3', { numProp: { type: 'number', number: 30 } }),
      ];

      const ds = createMockDataService({
        getRows: vi.fn().mockResolvedValue(relatedRows),
      });

      const rowValues: Record<string, IPropertyValue> = {
        rel1: { type: 'relation', relation: [{ id: 'pb1' }, { id: 'pb3' }] },
      };

      const result = await computeRollup(ds, rollupProp, rowValues, [relProp, rollupProp]);
      expect(result).toEqual({ type: 'number', value: 40 });
    });

    it('returns empty result when no links exist', async () => {
      const relProp = makeRelationProperty('rel1', 'dbA', 'dbB');
      const rollupProp = makeRollupProperty('rollup1', 'dbA', 'rel1', 'numProp', 'count');

      const ds = createMockDataService();
      const result = await computeRollup(ds, rollupProp, {}, [relProp, rollupProp]);
      expect(result).toEqual({ type: 'number', value: 0 });
    });

    it('returns null for incomplete config', async () => {
      const badRollup: IDatabaseProperty = {
        id: 'r1', databaseId: 'db1', name: 'Bad', type: 'rollup',
        config: { relationPropertyId: '', relationPropertyName: '', rollupPropertyId: 'x', rollupPropertyName: 'x', function: 'sum' } as IRollupPropertyConfig,
        sortOrder: 0, createdAt: '', updatedAt: '',
      };
      const ds = createMockDataService();
      const result = await computeRollup(ds, badRollup, {}, []);
      expect(result).toBeNull();
    });
  });

  // ── computeRollups (batch) ──

  describe('computeRollups()', () => {
    it('computes rollups for all rows', async () => {
      const relProp = makeRelationProperty('rel1', 'dbA', 'dbB');
      const rollupProp = makeRollupProperty('rollup1', 'dbA', 'rel1', 'numProp', 'sum');
      const properties = [relProp, rollupProp];

      const relatedRows: IDatabaseRow[] = [
        makeRow('pb1', 'B1', { numProp: { type: 'number', number: 10 } }),
        makeRow('pb2', 'B2', { numProp: { type: 'number', number: 20 } }),
      ];

      const ds = createMockDataService({
        getRows: vi.fn().mockResolvedValue(relatedRows),
      });

      const rows: IDatabaseRow[] = [
        makeRow('pa1', 'A1', { rel1: { type: 'relation', relation: [{ id: 'pb1' }] } }),
        makeRow('pa2', 'A2', { rel1: { type: 'relation', relation: [{ id: 'pb1' }, { id: 'pb2' }] } }),
      ];

      const result = await computeRollups(ds, 'dbA', rows, properties);
      expect(result.get('pa1')?.get('rollup1')).toEqual({ type: 'number', value: 10 });
      expect(result.get('pa2')?.get('rollup1')).toEqual({ type: 'number', value: 30 });
    });

    it('returns empty map when no rollup properties', async () => {
      const ds = createMockDataService();
      const result = await computeRollups(ds, 'db1', [], []);
      expect(result.size).toBe(0);
    });
  });

  // ── rollupResultToPropertyValue ──

  describe('rollupResultToPropertyValue()', () => {
    it('converts number result', () => {
      const pv = rollupResultToPropertyValue({ type: 'number', value: 42 });
      expect(pv).toEqual({ type: 'rollup', rollup: { type: 'number', number: 42 } });
    });

    it('converts percent result', () => {
      const pv = rollupResultToPropertyValue({ type: 'percent', value: 75 });
      expect(pv).toEqual({ type: 'rollup', rollup: { type: 'number', number: 75 } });
    });

    it('converts date result', () => {
      const pv = rollupResultToPropertyValue({ type: 'date', value: '2025-01-15' });
      expect(pv).toEqual({ type: 'rollup', rollup: { type: 'date', date: '2025-01-15' } });
    });

    it('converts array result', () => {
      const pv = rollupResultToPropertyValue({ type: 'array', value: ['a', 'b'] });
      expect(pv).toEqual({ type: 'rollup', rollup: { type: 'array', array: ['a', 'b'] } });
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Renderers
// ═══════════════════════════════════════════════════════════════════════════════

describe('Relation & Rollup Renderers', () => {
  let container: HTMLElement;

  function setup(): void {
    container = document.createElement('div');
  }

  describe('renderRelation()', () => {
    it('renders pills for each linked page', () => {
      setup();
      const value: IPropertyValue = { type: 'relation', relation: [{ id: 'p1' }, { id: 'p2' }] };
      const titles = new Map([['p1', 'Task A'], ['p2', 'Task B']]);
      renderRelation(value, container, titles);
      const pills = container.querySelectorAll('.db-cell-relation-pill');
      expect(pills).toHaveLength(2);
      expect(pills[0].textContent).toBe('Task A');
      expect(pills[1].textContent).toBe('Task B');
    });

    it('uses truncated IDs when no titles provided', () => {
      setup();
      const value: IPropertyValue = { type: 'relation', relation: [{ id: 'abcdefghijklmnop' }] };
      renderRelation(value, container);
      const pill = container.querySelector('.db-cell-relation-pill');
      expect(pill?.textContent).toBe('abcdefgh');
    });

    it('renders empty placeholder for no links', () => {
      setup();
      renderRelation(undefined, container);
      expect(container.querySelector('.db-cell-empty')).toBeTruthy();
    });
  });

  describe('renderRollup()', () => {
    it('renders number result', () => {
      setup();
      renderRollup(undefined, container, { type: 'number', value: 42 });
      expect(container.querySelector('.db-cell-rollup')?.textContent).toBe('42');
    });

    it('renders percent result with % suffix', () => {
      setup();
      renderRollup(undefined, container, { type: 'percent', value: 75 });
      expect(container.querySelector('.db-cell-rollup')?.textContent).toBe('75%');
    });

    it('renders array result as comma-separated', () => {
      setup();
      renderRollup(undefined, container, { type: 'array', value: ['a', 'b', 'c'] });
      expect(container.querySelector('.db-cell-rollup')?.textContent).toBe('a, b, c');
    });

    it('renders empty for no result', () => {
      setup();
      renderRollup(undefined, container);
      expect(container.querySelector('.db-cell-empty')).toBeTruthy();
    });

    it('renders from stored IPropertyValue', () => {
      setup();
      const value: IPropertyValue = {
        type: 'rollup',
        rollup: { type: 'number', number: 99 },
      };
      renderRollup(value, container);
      expect(container.querySelector('.db-cell-rollup')?.textContent).toBe('99');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Registry Exports
// ═══════════════════════════════════════════════════════════════════════════════

describe('Phase 7 Registry Exports', () => {
  it('relation resolver functions are accessible from databaseRegistry', async () => {
    const mod = await import('../../src/built-in/canvas/database/databaseRegistry');
    expect(mod.resolveRelation).toBeTypeOf('function');
    expect(mod.getRelationCandidates).toBeTypeOf('function');
    expect(mod.addRelationLink).toBeTypeOf('function');
    expect(mod.removeRelationLink).toBeTypeOf('function');
    expect(mod.toggleRelationLink).toBeTypeOf('function');
    expect(mod.createReciprocalRelation).toBeTypeOf('function');
    expect(mod.syncReciprocal).toBeTypeOf('function');
    expect(mod.setRelationWithSync).toBeTypeOf('function');
    expect(mod.isSelfRelation).toBeTypeOf('function');
    expect(mod.getSelfRelationCandidates).toBeTypeOf('function');
  });

  it('rollup engine functions are accessible from databaseRegistry', async () => {
    const mod = await import('../../src/built-in/canvas/database/databaseRegistry');
    expect(mod.evaluateRollupFunction).toBeTypeOf('function');
    expect(mod.computeRollup).toBeTypeOf('function');
    expect(mod.computeRollups).toBeTypeOf('function');
    expect(mod.rollupResultToPropertyValue).toBeTypeOf('function');
  });

  it('renderers are accessible from databaseRegistry', async () => {
    const mod = await import('../../src/built-in/canvas/database/databaseRegistry');
    expect(mod.renderRelation).toBeTypeOf('function');
    expect(mod.renderRollup).toBeTypeOf('function');
  });
});
