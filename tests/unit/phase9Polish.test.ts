// phase9Polish.test.ts — Phase 9 tests: templates, conditional color, locking,
// unique ID, property visibility, property bar
/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi } from 'vitest';

import {
  resolveTemplateValue,
  applyTemplate,
  selectTemplate,
  createTemplate,
  evaluateColorRules,
  colorRuleToStyle,
  isDatabaseLocked,
  isViewLocked,
  assertDatabaseNotLocked,
  assertViewNotLocked,
  computeNextUniqueId,
  makeUniqueIdValue,
  formatUniqueId,
  isPropertyVisibleOnPage,
  getPropertyBarData,
} from '../../src/built-in/canvas/database/polish/databaseTemplateService';

import type {
  IDatabaseTemplate,
  TemplatePropertyValue,
  IPropertyValue,
  IDatabaseProperty,
  IDatabaseRow,
  IDatabaseView,
  IDatabase,
  IColorRule,
  PropertyVisibility,
  IFilterRule,
  IDatabaseDataService,
} from '../../src/built-in/canvas/database/databaseTypes';

// ─── Test Helpers ────────────────────────────────────────────────────────────

function makeProp(
  id: string,
  name: string,
  type: IDatabaseProperty['type'],
  visibility: PropertyVisibility = 'always_show',
): IDatabaseProperty {
  return {
    id,
    databaseId: 'db1',
    name,
    type,
    config: {},
    visibility,
    sortOrder: 0,
    createdAt: '2025-01-01',
    updatedAt: '2025-01-01',
  } as IDatabaseProperty;
}

function makeRow(
  pageId: string,
  values: Record<string, IPropertyValue>,
): IDatabaseRow {
  return {
    page: { id: pageId, title: `Page ${pageId}`, parentId: null, icon: null, coverUrl: null, sortOrder: 0, createdAt: '', updatedAt: '' } as any,
    values,
    sortOrder: 0,
  };
}

function makeDatabase(overrides: Partial<IDatabase> = {}): IDatabase {
  return {
    id: 'db1',
    pageId: 'db1',
    description: null,
    isLocked: false,
    createdAt: '2025-01-01',
    updatedAt: '2025-01-01',
    ...overrides,
  } as IDatabase;
}

function makeView(overrides: Partial<IDatabaseView> = {}): IDatabaseView {
  return {
    id: 'v1',
    databaseId: 'db1',
    name: 'Table',
    type: 'table',
    sortOrder: 0,
    isLocked: false,
    createdAt: '2025-01-01',
    updatedAt: '2025-01-01',
    groupBy: null,
    subGroupBy: null,
    boardGroupProperty: null,
    hideEmptyGroups: false,
    filterConfig: { conjunction: 'and', rules: [] },
    sortConfig: [],
    config: {},
    ...overrides,
  } as IDatabaseView;
}

function makeTemplate(
  id: string,
  name: string,
  values: Record<string, TemplatePropertyValue>,
  overrides?: Partial<IDatabaseTemplate>,
): IDatabaseTemplate {
  return createTemplate(id, 'db1', name, values, overrides);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 9.1 — Database Templates
// ═══════════════════════════════════════════════════════════════════════════════

describe('Phase 9 — Templates', () => {
  describe('resolveTemplateValue', () => {
    it('resolves static values as-is', () => {
      const tv: TemplatePropertyValue = {
        mode: 'static',
        value: { type: 'number', number: 42 } as IPropertyValue,
      };
      const result = resolveTemplateValue(tv);
      expect(result).toEqual({ type: 'number', number: 42 });
    });

    it('resolves "now" dynamic token to a date', () => {
      const tv: TemplatePropertyValue = { mode: 'dynamic', token: 'now' };
      const result = resolveTemplateValue(tv);
      expect(result.type).toBe('date');
      expect((result as any).date.start).toBeTruthy();
    });

    it('resolves "today" dynamic token to date-only string', () => {
      const tv: TemplatePropertyValue = { mode: 'dynamic', token: 'today' };
      const result = resolveTemplateValue(tv);
      expect(result.type).toBe('date');
      expect((result as any).date.start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe('applyTemplate', () => {
    it('resolves all template values for matching properties', () => {
      const props = [
        makeProp('p1', 'Priority', 'select'),
        makeProp('p2', 'Due Date', 'date'),
        makeProp('p3', 'Notes', 'rich_text'),
      ];
      const template = makeTemplate('t1', 'Task Template', {
        p1: { mode: 'static', value: { type: 'select', select: { name: 'High', color: 'red' } } as IPropertyValue },
        p2: { mode: 'dynamic', token: 'today' },
      });

      const result = applyTemplate(template, props);
      expect(Object.keys(result)).toEqual(['p1', 'p2']); // p3 not in template
      expect(result.p1.type).toBe('select');
      expect(result.p2.type).toBe('date');
    });

    it('skips properties not in the property list', () => {
      const props = [makeProp('p1', 'Title', 'title')];
      const template = makeTemplate('t1', 'Test', {
        p1: { mode: 'static', value: { type: 'rich_text', rich_text: [{ content: 'Hello' }] } as IPropertyValue },
        p_missing: { mode: 'static', value: { type: 'number', number: 1 } as IPropertyValue },
      });

      const result = applyTemplate(template, props);
      expect(Object.keys(result)).toEqual(['p1']);
    });
  });

  describe('selectTemplate', () => {
    it('returns undefined for empty template list', () => {
      const view = makeView();
      expect(selectTemplate([], view)).toBeUndefined();
    });

    it('returns single template automatically', () => {
      const t = makeTemplate('t1', 'Only', {});
      const view = makeView();
      expect(selectTemplate([t], view)).toBe(t);
    });

    it('returns view default template when set', () => {
      const t1 = makeTemplate('t1', 'A', {});
      const t2 = makeTemplate('t2', 'B', {});
      const view = makeView({ config: { defaultTemplateId: 't2' } });
      expect(selectTemplate([t1, t2], view)).toBe(t2);
    });

    it('returns undefined for multiple templates with no default', () => {
      const t1 = makeTemplate('t1', 'A', {});
      const t2 = makeTemplate('t2', 'B', {});
      const view = makeView();
      expect(selectTemplate([t1, t2], view)).toBeUndefined();
    });
  });

  describe('createTemplate', () => {
    it('creates a template object with defaults', () => {
      const t = createTemplate('t1', 'db1', 'My Template', {}, { description: 'Test' });
      expect(t.id).toBe('t1');
      expect(t.databaseId).toBe('db1');
      expect(t.name).toBe('My Template');
      expect(t.description).toBe('Test');
      expect(t.contentJson).toBeNull();
      expect(t.sortOrder).toBe(0);
      expect(t.createdAt).toBeTruthy();
    });

    it('creates a template with content JSON', () => {
      const t = createTemplate('t1', 'db1', 'Rich', {}, { contentJson: '{"type":"doc"}' });
      expect(t.contentJson).toBe('{"type":"doc"}');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9.2 — Conditional Color
// ═══════════════════════════════════════════════════════════════════════════════

describe('Phase 9 — Conditional Color', () => {
  describe('evaluateColorRules', () => {
    const props = [makeProp('p1', 'Status', 'select')];

    it('returns undefined with no rules', () => {
      const row = makeRow('r1', {});
      expect(evaluateColorRules([], row, props)).toBeUndefined();
    });

    it('returns first matching color', () => {
      const rule: IColorRule = {
        filter: { propertyId: 'p1', operator: 'equals', value: 'Done' } as IFilterRule,
        color: 'green',
      };
      const row = makeRow('r1', {
        p1: { type: 'select', select: { name: 'Done', color: 'green' } } as IPropertyValue,
      });
      expect(evaluateColorRules([rule], row, props)).toBe('green');
    });

    it('returns undefined when no rule matches', () => {
      const rule: IColorRule = {
        filter: { propertyId: 'p1', operator: 'equals', value: 'Done' } as IFilterRule,
        color: 'green',
      };
      const row = makeRow('r1', {
        p1: { type: 'select', select: { name: 'In Progress', color: 'blue' } } as IPropertyValue,
      });
      expect(evaluateColorRules([rule], row, props)).toBeUndefined();
    });

    it('returns first matching rule from multiple', () => {
      const rules: IColorRule[] = [
        { filter: { propertyId: 'p1', operator: 'equals', value: 'Urgent' } as IFilterRule, color: 'red' },
        { filter: { propertyId: 'p1', operator: 'equals', value: 'Done' } as IFilterRule, color: 'green' },
      ];
      const row = makeRow('r1', {
        p1: { type: 'select', select: { name: 'Done', color: 'green' } } as IPropertyValue,
      });
      expect(evaluateColorRules(rules, row, props)).toBe('green');
    });
  });

  describe('colorRuleToStyle', () => {
    it('generates CSS with custom property and fallback', () => {
      const style = colorRuleToStyle('red');
      expect(style).toContain('var(--db-row-color-red');
      expect(style).toContain('background-color');
    });

    it('handles unknown colors with a gray fallback', () => {
      const style = colorRuleToStyle('unknown');
      expect(style).toContain('rgba(128, 128, 128');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9.3 — Database & View Locking
// ═══════════════════════════════════════════════════════════════════════════════

describe('Phase 9 — Locking', () => {
  describe('isDatabaseLocked / isViewLocked', () => {
    it('returns false for unlocked database', () => {
      expect(isDatabaseLocked(makeDatabase())).toBe(false);
    });

    it('returns true for locked database', () => {
      expect(isDatabaseLocked(makeDatabase({ isLocked: true }))).toBe(true);
    });

    it('returns false for unlocked view', () => {
      expect(isViewLocked(makeView())).toBe(false);
    });

    it('returns true for locked view', () => {
      expect(isViewLocked(makeView({ isLocked: true }))).toBe(true);
    });
  });

  describe('assertDatabaseNotLocked / assertViewNotLocked', () => {
    it('does not throw for unlocked database', () => {
      expect(() => assertDatabaseNotLocked(makeDatabase())).not.toThrow();
    });

    it('throws for locked database', () => {
      expect(() => assertDatabaseNotLocked(makeDatabase({ isLocked: true }))).toThrow('locked');
    });

    it('does not throw for unlocked view', () => {
      expect(() => assertViewNotLocked(makeView())).not.toThrow();
    });

    it('throws for locked view', () => {
      expect(() => assertViewNotLocked(makeView({ isLocked: true }))).toThrow('locked');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9.4 — Unique ID Auto-Increment
// ═══════════════════════════════════════════════════════════════════════════════

describe('Phase 9 — Unique ID', () => {
  const uidProp = makeProp('uid', 'ID', 'unique_id');

  describe('computeNextUniqueId', () => {
    it('returns 1 for empty database', () => {
      expect(computeNextUniqueId([], uidProp)).toBe(1);
    });

    it('returns max + 1', () => {
      const rows = [
        makeRow('r1', { uid: { type: 'unique_id', unique_id: { prefix: null, number: 5 } } as IPropertyValue }),
        makeRow('r2', { uid: { type: 'unique_id', unique_id: { prefix: null, number: 3 } } as IPropertyValue }),
        makeRow('r3', { uid: { type: 'unique_id', unique_id: { prefix: null, number: 10 } } as IPropertyValue }),
      ];
      expect(computeNextUniqueId(rows, uidProp)).toBe(11);
    });

    it('handles rows without unique_id values', () => {
      const rows = [
        makeRow('r1', {}),
        makeRow('r2', { uid: { type: 'unique_id', unique_id: { prefix: 'T', number: 7 } } as IPropertyValue }),
      ];
      expect(computeNextUniqueId(rows, uidProp)).toBe(8);
    });
  });

  describe('makeUniqueIdValue', () => {
    it('creates value without prefix', () => {
      const val = makeUniqueIdValue(42, null);
      expect(val.type).toBe('unique_id');
      expect((val as any).unique_id).toEqual({ prefix: null, number: 42 });
    });

    it('creates value with prefix', () => {
      const val = makeUniqueIdValue(1, 'TASK');
      expect((val as any).unique_id).toEqual({ prefix: 'TASK', number: 1 });
    });
  });

  describe('formatUniqueId', () => {
    it('formats with prefix', () => {
      expect(formatUniqueId('TASK', 42)).toBe('TASK-42');
    });

    it('formats without prefix', () => {
      expect(formatUniqueId(null, 42)).toBe('42');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9.5 — Property Page-Top Visibility
// ═══════════════════════════════════════════════════════════════════════════════

describe('Phase 9 — Property Visibility', () => {
  describe('isPropertyVisibleOnPage', () => {
    it('always_show returns true regardless of value', () => {
      expect(isPropertyVisibleOnPage('always_show', undefined)).toBe(true);
      expect(isPropertyVisibleOnPage('always_show', { type: 'number', number: 0 } as IPropertyValue)).toBe(true);
    });

    it('always_hide returns false regardless of value', () => {
      expect(isPropertyVisibleOnPage('always_hide', { type: 'number', number: 42 } as IPropertyValue)).toBe(false);
    });

    it('hide_when_empty returns false for undefined', () => {
      expect(isPropertyVisibleOnPage('hide_when_empty', undefined)).toBe(false);
    });

    it('hide_when_empty returns false for null number', () => {
      expect(isPropertyVisibleOnPage('hide_when_empty', { type: 'number', number: null } as unknown as IPropertyValue)).toBe(false);
    });

    it('hide_when_empty returns true for non-empty number', () => {
      expect(isPropertyVisibleOnPage('hide_when_empty', { type: 'number', number: 42 } as IPropertyValue)).toBe(true);
    });

    it('hide_when_empty returns false for empty text', () => {
      expect(isPropertyVisibleOnPage('hide_when_empty', { type: 'rich_text', rich_text: [{ content: '' }] } as IPropertyValue)).toBe(false);
    });

    it('hide_when_empty returns true for non-empty text', () => {
      expect(isPropertyVisibleOnPage('hide_when_empty', { type: 'rich_text', rich_text: [{ content: 'Hello' }] } as IPropertyValue)).toBe(true);
    });

    it('hide_when_empty returns false for empty multi_select', () => {
      expect(isPropertyVisibleOnPage('hide_when_empty', { type: 'multi_select', multi_select: [] } as IPropertyValue)).toBe(false);
    });

    it('hide_when_empty returns true for non-empty multi_select', () => {
      expect(isPropertyVisibleOnPage('hide_when_empty', { type: 'multi_select', multi_select: [{ name: 'A', color: 'red' }] } as IPropertyValue)).toBe(true);
    });

    it('hide_when_empty returns false for null select', () => {
      expect(isPropertyVisibleOnPage('hide_when_empty', { type: 'select', select: null } as unknown as IPropertyValue)).toBe(false);
    });

    it('hide_when_empty returns false for null date', () => {
      expect(isPropertyVisibleOnPage('hide_when_empty', { type: 'date', date: null } as unknown as IPropertyValue)).toBe(false);
    });

    it('hide_when_empty returns true for checkbox (never empty)', () => {
      expect(isPropertyVisibleOnPage('hide_when_empty', { type: 'checkbox', checkbox: false } as IPropertyValue)).toBe(true);
    });

    it('hide_when_empty returns false for empty url', () => {
      expect(isPropertyVisibleOnPage('hide_when_empty', { type: 'url', url: null } as unknown as IPropertyValue)).toBe(false);
    });

    it('hide_when_empty returns false for empty files', () => {
      expect(isPropertyVisibleOnPage('hide_when_empty', { type: 'files', files: [] } as IPropertyValue)).toBe(false);
    });

    it('hide_when_empty returns false for empty relation', () => {
      expect(isPropertyVisibleOnPage('hide_when_empty', { type: 'relation', relation: [] } as IPropertyValue)).toBe(false);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getPropertyBarData
// ═══════════════════════════════════════════════════════════════════════════════

describe('Phase 9 — getPropertyBarData', () => {
  function mockDataService(opts: {
    dbPageIds?: string[];
    rows?: IDatabaseRow[];
    properties?: IDatabaseProperty[];
    dbByPageId?: IDatabase | null;
  }): IDatabaseDataService {
    return {
      getDatabaseByPageId: vi.fn().mockResolvedValue(opts.dbByPageId ?? null),
      getDatabasePageIds: vi.fn().mockResolvedValue(new Set(opts.dbPageIds ?? [])),
      getRows: vi.fn().mockResolvedValue(opts.rows ?? []),
      getProperties: vi.fn().mockResolvedValue(opts.properties ?? []),
    } as unknown as IDatabaseDataService;
  }

  it('returns null for a page that is a database itself', async () => {
    const ds = mockDataService({ dbByPageId: makeDatabase() });
    const result = await getPropertyBarData(ds, 'db1');
    expect(result).toBeNull();
  });

  it('returns null for a page not found in any database', async () => {
    const ds = mockDataService({ dbPageIds: ['db1'], rows: [] });
    const result = await getPropertyBarData(ds, 'unknown');
    expect(result).toBeNull();
  });

  it('returns visible properties and values for a database row page', async () => {
    const props = [
      makeProp('p1', 'Name', 'title', 'always_show'),
      makeProp('p2', 'Score', 'number', 'hide_when_empty'),
      makeProp('p3', 'Notes', 'rich_text', 'always_hide'),
    ];
    const values: Record<string, IPropertyValue> = {
      p1: { type: 'title', title: [{ content: 'Test' }] } as IPropertyValue,
      p2: { type: 'number', number: 95 } as IPropertyValue,
      p3: { type: 'rich_text', rich_text: [{ content: 'Hidden' }] } as IPropertyValue,
    };
    const row = makeRow('page1', values);

    const ds = mockDataService({
      dbByPageId: null,
      dbPageIds: ['db1'],
      rows: [row],
      properties: props,
    });

    const result = await getPropertyBarData(ds, 'page1');
    expect(result).not.toBeNull();
    // p1 (always_show) + p2 (hide_when_empty, has value) = 2 visible
    // p3 (always_hide) = excluded
    expect(result!.properties.length).toBe(2);
    expect(result!.properties.map(p => p.id)).toEqual(['p1', 'p2']);
    expect(result!.values).toBe(values);
  });

  it('hides properties with empty values when hide_when_empty', async () => {
    const props = [
      makeProp('p1', 'Score', 'number', 'hide_when_empty'),
    ];
    const values: Record<string, IPropertyValue> = {
      p1: { type: 'number', number: null } as unknown as IPropertyValue,
    };
    const row = makeRow('page1', values);

    const ds = mockDataService({
      dbByPageId: null,
      dbPageIds: ['db1'],
      rows: [row],
      properties: props,
    });

    const result = await getPropertyBarData(ds, 'page1');
    expect(result).not.toBeNull();
    expect(result!.properties.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Registry Exports
// ═══════════════════════════════════════════════════════════════════════════════

describe('Phase 9 — Registry Exports', () => {
  it('exports all Phase 9 functions from databaseRegistry', async () => {
    const registry = await import('../../src/built-in/canvas/database/databaseRegistry');

    // Templates
    expect(typeof registry.resolveTemplateValue).toBe('function');
    expect(typeof registry.applyTemplate).toBe('function');
    expect(typeof registry.selectTemplate).toBe('function');
    expect(typeof registry.createTemplate).toBe('function');

    // Conditional color
    expect(typeof registry.evaluateColorRules).toBe('function');
    expect(typeof registry.colorRuleToStyle).toBe('function');

    // Locking
    expect(typeof registry.isDatabaseLocked).toBe('function');
    expect(typeof registry.isViewLocked).toBe('function');
    expect(typeof registry.assertDatabaseNotLocked).toBe('function');
    expect(typeof registry.assertViewNotLocked).toBe('function');

    // Unique ID
    expect(typeof registry.computeNextUniqueId).toBe('function');
    expect(typeof registry.makeUniqueIdValue).toBe('function');
    expect(typeof registry.formatUniqueId).toBe('function');

    // Visibility
    expect(typeof registry.isPropertyVisibleOnPage).toBe('function');
    expect(typeof registry.getPropertyBarData).toBe('function');
  });
});
