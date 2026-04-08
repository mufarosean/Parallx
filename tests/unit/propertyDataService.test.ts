/**
 * Unit tests for PropertyDataService — definition CRUD, page property CRUD,
 * default seeding, event firing, and JSON value serialization.
 *
 * Mocks `window.parallxElectron.database` to isolate from Electron IPC.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PropertyDataService } from '../../src/built-in/canvas/properties/propertyDataService';
import type { IPropertyDefinition } from '../../src/built-in/canvas/properties/propertyTypes';

// ─── Mock Database Bridge ────────────────────────────────────────────────────

function createMockDb() {
  return {
    run: vi.fn().mockResolvedValue({ error: null, changes: 1 }),
    get: vi.fn().mockResolvedValue({ error: null, row: null }),
    all: vi.fn().mockResolvedValue({ error: null, rows: [] }),
    runTransaction: vi.fn().mockResolvedValue({ error: null, results: [] }),
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function defRow(name: string, type = 'text', overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name,
    type,
    config: '{}',
    sort_order: 0,
    created_at: '2025-01-01T00:00:00',
    updated_at: '2025-01-01T00:00:00',
    ...overrides,
  };
}

function propRow(id: string, pageId: string, key: string, value: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    page_id: pageId,
    key,
    value_type: 'text',
    value,
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('PropertyDataService', () => {
  let mockDb: ReturnType<typeof createMockDb>;
  let service: PropertyDataService;

  beforeEach(() => {
    mockDb = createMockDb();
    (globalThis as any).window = {
      parallxElectron: { database: mockDb },
    };
    // Mock crypto.randomUUID
    vi.stubGlobal('crypto', { randomUUID: () => 'test-uuid-1234' });
    service = new PropertyDataService();
  });

  afterEach(() => {
    service.dispose();
    delete (globalThis as any).window;
    vi.unstubAllGlobals();
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Definition CRUD
  // ══════════════════════════════════════════════════════════════════════════

  describe('createDefinition', () => {
    it('inserts a definition and returns it', async () => {
      // First call: SELECT MAX(sort_order)
      mockDb.get.mockResolvedValueOnce({ error: null, row: { max_sort: 2 } });
      // Second call (run): INSERT
      mockDb.run.mockResolvedValueOnce({ error: null, changes: 1 });
      // Third call (get): read-back
      mockDb.get.mockResolvedValueOnce({ error: null, row: defRow('priority', 'select', { sort_order: 3 }) });

      const def = await service.createDefinition('priority', 'select', { options: [] });

      expect(def.name).toBe('priority');
      expect(def.type).toBe('select');
      expect(def.sortOrder).toBe(3);
      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO property_definitions'),
        ['priority', 'select', '{"options":[]}', 3],
      );
    });

    it('fires onDidChangeDefinition event', async () => {
      mockDb.get.mockResolvedValueOnce({ error: null, row: { max_sort: 0 } });
      mockDb.run.mockResolvedValueOnce({ error: null, changes: 1 });
      mockDb.get.mockResolvedValueOnce({ error: null, row: defRow('tags', 'tags') });

      const listener = vi.fn();
      service.onDidChangeDefinition(listener);

      await service.createDefinition('tags', 'tags');

      expect(listener).toHaveBeenCalledWith({ name: 'tags', kind: 'created' });
    });

    it('throws on database error', async () => {
      mockDb.get.mockResolvedValueOnce({ error: null, row: { max_sort: 0 } });
      mockDb.run.mockResolvedValueOnce({ error: { code: 'SQLITE_CONSTRAINT', message: 'UNIQUE constraint failed' } });

      await expect(service.createDefinition('dup', 'text')).rejects.toThrow('UNIQUE constraint failed');
    });
  });

  describe('getDefinition', () => {
    it('returns null when not found', async () => {
      mockDb.get.mockResolvedValueOnce({ error: null, row: null });

      const def = await service.getDefinition('nonexistent');
      expect(def).toBeNull();
    });

    it('returns a mapped definition', async () => {
      mockDb.get.mockResolvedValueOnce({
        error: null,
        row: defRow('status', 'select', { config: '{"options":[{"value":"done","color":"green"}]}' }),
      });

      const def = await service.getDefinition('status');
      expect(def).not.toBeNull();
      expect(def!.name).toBe('status');
      expect(def!.type).toBe('select');
      expect(def!.config).toEqual({ options: [{ value: 'done', color: 'green' }] });
    });
  });

  describe('getAllDefinitions', () => {
    it('returns all definitions ordered by sort_order', async () => {
      mockDb.all.mockResolvedValueOnce({
        error: null,
        rows: [
          defRow('tags', 'tags', { sort_order: 1 }),
          defRow('created', 'datetime', { sort_order: 2 }),
        ],
      });

      const defs = await service.getAllDefinitions();
      expect(defs).toHaveLength(2);
      expect(defs[0].name).toBe('tags');
      expect(defs[1].name).toBe('created');
    });
  });

  describe('updateDefinition', () => {
    it('updates type and config', async () => {
      mockDb.run.mockResolvedValueOnce({ error: null, changes: 1 });
      mockDb.get.mockResolvedValueOnce({
        error: null,
        row: defRow('priority', 'number', { config: '{"min":1,"max":5}' }),
      });

      const listener = vi.fn();
      service.onDidChangeDefinition(listener);

      const updated = await service.updateDefinition('priority', {
        type: 'number',
        config: { min: 1, max: 5 },
      });

      expect(updated.type).toBe('number');
      expect(updated.config).toEqual({ min: 1, max: 5 });
      expect(listener).toHaveBeenCalledWith({ name: 'priority', kind: 'updated' });
    });

    it('returns existing definition when no updates provided', async () => {
      mockDb.get.mockResolvedValueOnce({ error: null, row: defRow('tags', 'tags') });

      const def = await service.updateDefinition('tags', {});
      expect(def.name).toBe('tags');
      // No run call should have been made for actual update
      expect(mockDb.run).not.toHaveBeenCalled();
    });
  });

  describe('deleteDefinition', () => {
    it('deletes definition and associated page properties', async () => {
      mockDb.run.mockResolvedValueOnce({ error: null, changes: 3 }); // page_properties delete
      mockDb.run.mockResolvedValueOnce({ error: null, changes: 1 }); // definition delete

      const listener = vi.fn();
      service.onDidChangeDefinition(listener);

      await service.deleteDefinition('old-prop');

      expect(mockDb.run).toHaveBeenCalledTimes(2);
      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM page_properties'),
        ['old-prop'],
      );
      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM property_definitions'),
        ['old-prop'],
      );
      expect(listener).toHaveBeenCalledWith({ name: 'old-prop', kind: 'deleted' });
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Page Property CRUD
  // ══════════════════════════════════════════════════════════════════════════

  describe('getPropertiesForPage', () => {
    it('returns properties with joined definitions', async () => {
      mockDb.all.mockResolvedValueOnce({
        error: null,
        rows: [
          {
            id: 'pp-1',
            page_id: 'page-1',
            key: 'tags',
            value_type: 'tags',
            value: '["work","important"]',
            def_type: 'tags',
            def_config: '{}',
            def_sort_order: 1,
            def_created_at: '2025-01-01',
            def_updated_at: '2025-01-01',
          },
        ],
      });

      const props = await service.getPropertiesForPage('page-1');
      expect(props).toHaveLength(1);
      expect(props[0].key).toBe('tags');
      expect(props[0].value).toEqual(['work', 'important']);
      expect(props[0].definition.type).toBe('tags');
    });
  });

  describe('setProperty', () => {
    it('upserts a property and fires event', async () => {
      // getDefinition lookup
      mockDb.get.mockResolvedValueOnce({ error: null, row: defRow('tags', 'tags') });
      // INSERT OR REPLACE
      mockDb.run.mockResolvedValueOnce({ error: null, changes: 1 });
      // read-back
      mockDb.get.mockResolvedValueOnce({
        error: null,
        row: propRow('pp-1', 'page-1', 'tags', '["work"]'),
      });

      const listener = vi.fn();
      service.onDidChangePageProperty(listener);

      const prop = await service.setProperty('page-1', 'tags', ['work']);

      expect(prop.key).toBe('tags');
      expect(prop.value).toEqual(['work']);
      expect(listener).toHaveBeenCalledWith({ pageId: 'page-1', key: 'tags', kind: 'set' });
    });

    it('serializes values as JSON', async () => {
      mockDb.get.mockResolvedValueOnce({ error: null, row: defRow('count', 'number') });
      mockDb.run.mockResolvedValueOnce({ error: null, changes: 1 });
      mockDb.get.mockResolvedValueOnce({
        error: null,
        row: propRow('pp-2', 'page-1', 'count', '42'),
      });

      const prop = await service.setProperty('page-1', 'count', 42);
      expect(prop.value).toBe(42);

      // Verify the serialized value passed to DB
      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining('INSERT OR REPLACE'),
        expect.arrayContaining(['42']),
      );
    });
  });

  describe('removeProperty', () => {
    it('deletes property and fires event', async () => {
      mockDb.run.mockResolvedValueOnce({ error: null, changes: 1 });

      const listener = vi.fn();
      service.onDidChangePageProperty(listener);

      await service.removeProperty('page-1', 'tags');

      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM page_properties'),
        ['page-1', 'tags'],
      );
      expect(listener).toHaveBeenCalledWith({ pageId: 'page-1', key: 'tags', kind: 'removed' });
    });
  });

  describe('findPagesByProperty', () => {
    it('finds pages with equals operator', async () => {
      mockDb.all.mockResolvedValueOnce({
        error: null,
        rows: [
          { page_id: 'page-1', title: 'My Page', value: '"done"' },
        ],
      });

      const results = await service.findPagesByProperty('status', 'equals', 'done');
      expect(results).toHaveLength(1);
      expect(results[0].pageId).toBe('page-1');
      expect(results[0].value).toBe('done');
    });

    it('finds pages with is_empty operator', async () => {
      mockDb.all.mockResolvedValueOnce({ error: null, rows: [] });

      const results = await service.findPagesByProperty('tags', 'is_empty');
      expect(results).toHaveLength(0);
      expect(mockDb.all).toHaveBeenCalledWith(
        expect.stringContaining('IS NULL'),
        ['tags'],
      );
    });

    it('finds pages with greater_than operator', async () => {
      mockDb.all.mockResolvedValueOnce({
        error: null,
        rows: [
          { page_id: 'page-2', title: 'High Priority', value: '5' },
        ],
      });

      const results = await service.findPagesByProperty('priority', 'greater_than', 3);
      expect(results).toHaveLength(1);
      expect(results[0].value).toBe(5);
    });

    it('throws on unknown operator', async () => {
      await expect(service.findPagesByProperty('x', 'unknown_op')).rejects.toThrow('Unknown operator');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Default Properties
  // ══════════════════════════════════════════════════════════════════════════

  describe('ensureDefaultProperties', () => {
    it('inserts tags and created definitions when they do not exist', async () => {
      // getDefinition('tags') → null
      mockDb.get.mockResolvedValueOnce({ error: null, row: null });
      // INSERT tags
      mockDb.run.mockResolvedValueOnce({ error: null, changes: 1 });
      // getDefinition('created') → null
      mockDb.get.mockResolvedValueOnce({ error: null, row: null });
      // INSERT created
      mockDb.run.mockResolvedValueOnce({ error: null, changes: 1 });

      await service.ensureDefaultProperties();

      expect(mockDb.run).toHaveBeenCalledTimes(2);
      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO property_definitions'),
        ['tags', 'tags', '{}', 1],
      );
      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO property_definitions'),
        ['created', 'datetime', '{}', 2],
      );
    });

    it('skips insertion when defaults already exist', async () => {
      // getDefinition('tags') → exists
      mockDb.get.mockResolvedValueOnce({ error: null, row: defRow('tags', 'tags') });
      // getDefinition('created') → exists
      mockDb.get.mockResolvedValueOnce({ error: null, row: defRow('created', 'datetime') });

      await service.ensureDefaultProperties();

      expect(mockDb.run).not.toHaveBeenCalled();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Value Serialization Round-Trip
  // ══════════════════════════════════════════════════════════════════════════

  describe('value serialization', () => {
    it('round-trips a string value', async () => {
      mockDb.get.mockResolvedValueOnce({ error: null, row: defRow('url', 'url') });
      mockDb.run.mockResolvedValueOnce({ error: null, changes: 1 });
      mockDb.get.mockResolvedValueOnce({
        error: null,
        row: propRow('pp-1', 'p1', 'url', '"https://example.com"'),
      });

      const prop = await service.setProperty('p1', 'url', 'https://example.com');
      expect(prop.value).toBe('https://example.com');
    });

    it('round-trips a boolean value', async () => {
      mockDb.get.mockResolvedValueOnce({ error: null, row: defRow('done', 'checkbox') });
      mockDb.run.mockResolvedValueOnce({ error: null, changes: 1 });
      mockDb.get.mockResolvedValueOnce({
        error: null,
        row: propRow('pp-2', 'p1', 'done', 'true'),
      });

      const prop = await service.setProperty('p1', 'done', true);
      expect(prop.value).toBe(true);
    });

    it('round-trips an array value', async () => {
      mockDb.get.mockResolvedValueOnce({ error: null, row: defRow('tags', 'tags') });
      mockDb.run.mockResolvedValueOnce({ error: null, changes: 1 });
      mockDb.get.mockResolvedValueOnce({
        error: null,
        row: propRow('pp-3', 'p1', 'tags', '["a","b","c"]'),
      });

      const prop = await service.setProperty('p1', 'tags', ['a', 'b', 'c']);
      expect(prop.value).toEqual(['a', 'b', 'c']);
    });

    it('round-trips null value', async () => {
      mockDb.get.mockResolvedValueOnce({ error: null, row: defRow('note', 'text') });
      mockDb.run.mockResolvedValueOnce({ error: null, changes: 1 });
      mockDb.get.mockResolvedValueOnce({
        error: null,
        row: propRow('pp-4', 'p1', 'note', 'null'),
      });

      const prop = await service.setProperty('p1', 'note', null);
      expect(prop.value).toBeNull();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Error handling
  // ══════════════════════════════════════════════════════════════════════════

  describe('error handling', () => {
    it('throws when database bridge is not available', () => {
      delete (globalThis as any).window;
      (globalThis as any).window = { parallxElectron: {} };

      expect(() => service.getDefinition('x')).rejects.toThrow('not available');
    });
  });
});
