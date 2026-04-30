// settingsRegistryService.test.ts — M60 Phase ε §7 T4.D1
//
// Verifies the registry contract: registration, type validation, scope
// routing, persistence round-trip, and binding adapter precedence.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  SettingsRegistryService,
  type ISettingSchema,
} from '../../src/services/settingsRegistryService.js';
import { Emitter } from '../../src/platform/events.js';
import type { IStorage } from '../../src/platform/storage.js';

// ── In-memory IStorage mock (mirrors the M53 contract) ────────────────────

function createMockStorage(): IStorage {
  const map = new Map<string, string>();
  return {
    async get(key: string): Promise<string | undefined> {
      return map.get(key);
    },
    async set(key: string, value: string): Promise<void> {
      map.set(key, value);
    },
    async delete(key: string): Promise<void> {
      map.delete(key);
    },
    async has(key: string): Promise<boolean> {
      return map.has(key);
    },
    async keys(prefix?: string): Promise<string[]> {
      const all = Array.from(map.keys());
      return prefix ? all.filter((k) => k.startsWith(prefix)) : all;
    },
    async clear(): Promise<void> {
      map.clear();
    },
  };
}

async function readOverrides(storage: IStorage): Promise<Record<string, unknown> | undefined> {
  const raw = await storage.get('settings.overrides');
  if (typeof raw !== 'string') return undefined;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('SettingsRegistryService — D1 contract', () => {
  let userStore: IStorage;
  let wsStore: IStorage;
  let registry: SettingsRegistryService;

  beforeEach(async () => {
    userStore = createMockStorage();
    wsStore = createMockStorage();
    registry = new SettingsRegistryService(userStore, wsStore);
    await registry.initialize();
  });

  it('registers schemas and rejects duplicate keys', () => {
    const schema: ISettingSchema = {
      key: 'test.flag',
      type: 'boolean',
      default: false,
      scope: 'user',
      description: 'A test flag',
    };
    registry.register(schema);
    expect(registry.getSchema('test.flag')).toBe(schema);
    expect(() => registry.register(schema)).toThrow(/duplicate/i);
  });

  it('returns the schema default before any override is set', () => {
    registry.register({
      key: 'test.count',
      type: 'number',
      default: 42,
      scope: 'user',
      description: 'count',
    });
    expect(registry.getValue<number>('test.count')).toBe(42);
  });

  it('validates types on setValue (boolean expected)', async () => {
    registry.register({
      key: 'test.flag',
      type: 'boolean',
      default: false,
      scope: 'user',
      description: 'flag',
    });
    await expect(registry.setValue('test.flag', 'not-a-bool' as unknown)).rejects.toThrow(
      /expected boolean/,
    );
  });

  it('enforces number range bounds', async () => {
    registry.register({
      key: 'test.count',
      type: 'number',
      default: 5,
      scope: 'user',
      description: 'count',
      min: 1,
      max: 10,
    });
    await expect(registry.setValue('test.count', 0)).rejects.toThrow(/below min/);
    await expect(registry.setValue('test.count', 11)).rejects.toThrow(/above max/);
    await registry.setValue('test.count', 7);
    expect(registry.getValue<number>('test.count')).toBe(7);
  });

  it('rejects enum values not in the allowlist', async () => {
    registry.register({
      key: 'test.mode',
      type: 'enum',
      default: 'a',
      scope: 'user',
      description: 'mode',
      enumValues: ['a', 'b', 'c'],
    });
    await expect(registry.setValue('test.mode', 'z')).rejects.toThrow(/must be one of/);
    await registry.setValue('test.mode', 'b');
    expect(registry.getValue<string>('test.mode')).toBe('b');
  });

  it('round-trips set → get → onDidChange', async () => {
    registry.register({
      key: 'test.flag',
      type: 'boolean',
      default: false,
      scope: 'user',
      description: 'flag',
    });
    const seen: { key: string; value: unknown }[] = [];
    registry.onDidChange((e) => seen.push({ key: e.key, value: e.value }));
    await registry.setValue('test.flag', true);
    expect(registry.getValue<boolean>('test.flag')).toBe(true);
    expect(seen).toEqual([{ key: 'test.flag', value: true }]);
  });

  it('routes user-scope and workspace-scope to different stores', async () => {
    registry.register({
      key: 'user.thing',
      type: 'string',
      default: '',
      scope: 'user',
      description: 'u',
    });
    registry.register({
      key: 'ws.thing',
      type: 'string',
      default: '',
      scope: 'workspace',
      description: 'w',
    });
    await registry.setValue('user.thing', 'U');
    await registry.setValue('ws.thing', 'W');

    expect(await readOverrides(userStore)).toEqual({ 'user.thing': 'U' });
    expect(await readOverrides(wsStore)).toEqual({ 'ws.thing': 'W' });
  });

  it('persists overrides across registry instances (same store)', async () => {
    const schema: ISettingSchema = {
      key: 'test.count',
      type: 'number',
      default: 0,
      scope: 'user',
      description: 'count',
    };
    registry.register(schema);
    await registry.setValue('test.count', 99);

    // New registry over the same backing store sees the persisted value.
    const reg2 = new SettingsRegistryService(userStore, wsStore);
    await reg2.initialize();
    reg2.register(schema);
    expect(reg2.getValue<number>('test.count')).toBe(99);
  });

  it('reset() removes the override and falls back to default', async () => {
    registry.register({
      key: 'test.flag',
      type: 'boolean',
      default: false,
      scope: 'user',
      description: 'flag',
    });
    await registry.setValue('test.flag', true);
    expect(registry.getValue<boolean>('test.flag')).toBe(true);
    await registry.reset('test.flag');
    expect(registry.getValue<boolean>('test.flag')).toBe(false);
  });

  it('bind() routes get/set through the adapter, bypassing storage', async () => {
    registry.register({
      key: 'autonomy.flag',
      type: 'boolean',
      default: false,
      scope: 'user',
      description: 'autonomy',
    });

    let external = false;
    const onChange = new Emitter<boolean>();
    registry.bind<boolean>('autonomy.flag', {
      getValue: () => external,
      setValue: (v) => {
        external = v;
        onChange.fire(v);
      },
      onDidChange: onChange.event,
    });

    expect(registry.getValue<boolean>('autonomy.flag')).toBe(false);
    await registry.setValue('autonomy.flag', true);
    expect(external).toBe(true);
    expect(registry.getValue<boolean>('autonomy.flag')).toBe(true);

    // No override should have been written to storage when bound.
    expect(await readOverrides(userStore)).toBeUndefined();
  });

  it('getAllSchemas returns schemas sorted by key', () => {
    registry.register({
      key: 'b.thing',
      type: 'boolean',
      default: false,
      scope: 'user',
      description: 'b',
    });
    registry.register({
      key: 'a.thing',
      type: 'boolean',
      default: false,
      scope: 'user',
      description: 'a',
    });
    const keys = registry.getAllSchemas().map((s) => s.key);
    expect(keys).toEqual(['a.thing', 'b.thing']);
  });
});
