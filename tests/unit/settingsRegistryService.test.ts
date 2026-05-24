// settingsRegistryService.test.ts — pin schema validation, scope routing,
// binding precedence, secret handling, persistence, reset, and migration.
//
// Storage backing uses an in-memory Map<string,string> implementing IStorage.

import { describe, it, expect, vi } from 'vitest';
import {
  SettingsRegistryService,
  setGlobalSettingsRegistry,
  getGlobalSettingsRegistry,
} from '../../src/services/settingsRegistryService';
import { Emitter } from '../../src/platform/events';

function mkStorage() {
  const map = new Map<string, string>();
  return {
    map,
    get: vi.fn(async (k: string) => map.get(k)),
    set: vi.fn(async (k: string, v: string) => { map.set(k, v); }),
    delete: vi.fn(async (k: string) => { map.delete(k); }),
  } as any;
}

describe('SettingsRegistryService — register + schema validation', () => {
  it('throws on duplicate key registration', () => {
    const s = new SettingsRegistryService(mkStorage(), mkStorage());
    s.register({ key: 'k1', type: 'boolean', default: false, scope: 'user', description: '' });
    expect(() => s.register({ key: 'k1', type: 'boolean', default: true, scope: 'user', description: '' }))
      .toThrow(/duplicate key registration/);
  });

  it('rejects malformed defaults per type', () => {
    const s = new SettingsRegistryService(undefined, undefined);
    expect(() => s.register({ key: 'a', type: 'boolean', default: 'no' as any, scope: 'user', description: '' })).toThrow(/boolean default required/);
    expect(() => s.register({ key: 'b', type: 'number', default: NaN, scope: 'user', description: '' })).toThrow(/number default required/);
    expect(() => s.register({ key: 'c', type: 'number', default: 5, scope: 'user', description: '', min: 10 })).toThrow(/default below min/);
    expect(() => s.register({ key: 'd', type: 'number', default: 100, scope: 'user', description: '', max: 50 })).toThrow(/default above max/);
    expect(() => s.register({ key: 'e', type: 'string', default: 42 as any, scope: 'user', description: '' })).toThrow(/string default required/);
    expect(() => s.register({ key: 'f', type: 'enum', default: 'a', scope: 'user', description: '' })).toThrow(/enumValues required/);
    expect(() => s.register({ key: 'g', type: 'enum', default: 'x', scope: 'user', description: '', enumValues: ['a', 'b'] })).toThrow(/must be one of enumValues/);
    expect(() => s.register({ key: 'h', type: 'object', default: null as any, scope: 'user', description: '' })).toThrow(/object default required/);
    expect(() => s.register({ key: 'i', type: 'action', default: undefined, scope: 'user', description: '' })).toThrow(/action requires command id/);
    expect(() => s.register({ key: 'j', type: 'weird' as any, default: 0, scope: 'user', description: '' })).toThrow(/unknown type/);
  });

  it('getAllSchemas returns sorted-by-key snapshot', () => {
    const s = new SettingsRegistryService(undefined, undefined);
    s.register({ key: 'b', type: 'boolean', default: false, scope: 'user', description: '' });
    s.register({ key: 'a', type: 'boolean', default: true, scope: 'user', description: '' });
    expect(s.getAllSchemas().map(x => x.key)).toEqual(['a', 'b']);
  });
});

describe('SettingsRegistryService — getValue + setValue', () => {
  it('getValue returns default when no override; throws on unregistered key', () => {
    const s = new SettingsRegistryService(undefined, undefined);
    s.register({ key: 'x', type: 'string', default: 'hi', scope: 'user', description: '' });
    expect(s.getValue('x')).toBe('hi');
    expect(() => s.getValue('nope')).toThrow(/unregistered key/);
  });

  it('setValue validates type/range; throws on mismatch', async () => {
    const s = new SettingsRegistryService(mkStorage(), mkStorage());
    s.register({ key: 'n', type: 'number', default: 5, scope: 'user', description: '', min: 0, max: 10 });
    await expect(s.setValue('n', 'str' as any)).rejects.toThrow(/expected number/);
    await expect(s.setValue('n', -1)).rejects.toThrow(/below min/);
    await expect(s.setValue('n', 99)).rejects.toThrow(/above min|above max/);
    await s.setValue('n', 7);
    expect(s.getValue('n')).toBe(7);
  });

  it('setValue with explicit scope must match schema scope', async () => {
    const s = new SettingsRegistryService(mkStorage(), mkStorage());
    s.register({ key: 'w', type: 'boolean', default: true, scope: 'workspace', description: '' });
    await expect(s.setValue('w', false, 'user')).rejects.toThrow(/scope mismatch/);
    await s.setValue('w', false, 'workspace');
    expect(s.getValue('w')).toBe(false);
  });

  it('setValue fires onDidChange with key/value/scope', async () => {
    const s = new SettingsRegistryService(mkStorage(), mkStorage());
    s.register({ key: 'p', type: 'boolean', default: false, scope: 'workspace', description: '' });
    const heard: any[] = [];
    s.onDidChange(e => heard.push(e));
    await s.setValue('p', true);
    expect(heard).toEqual([{ key: 'p', value: true, scope: 'workspace' }]);
  });

  it('enum + object value validation', async () => {
    const s = new SettingsRegistryService(mkStorage(), mkStorage());
    s.register({ key: 'e', type: 'enum', default: 'a', scope: 'user', description: '', enumValues: ['a', 'b', 'c'] });
    await expect(s.setValue('e', 'z')).rejects.toThrow(/must be one of/);
    await s.setValue('e', 'b');
    expect(s.getValue('e')).toBe('b');

    s.register({ key: 'o', type: 'object', default: { x: 1 }, scope: 'user', description: '' });
    await expect(s.setValue('o', [] as any)).rejects.toThrow(/expected object/);
    await expect(s.setValue('o', null as any)).rejects.toThrow(/expected object/);
    await s.setValue('o', { y: 2 });
    expect(s.getValue('o')).toEqual({ y: 2 });
  });
});

describe('SettingsRegistryService — binding precedence', () => {
  it('bind() throws for unregistered key + duplicate binding', () => {
    const s = new SettingsRegistryService(undefined, undefined);
    expect(() => s.bind('z', { getValue: () => 0, setValue: () => {} })).toThrow(/cannot bind unregistered/);
    s.register({ key: 'z', type: 'boolean', default: false, scope: 'user', description: '' });
    s.bind('z', { getValue: () => false, setValue: () => {} });
    expect(() => s.bind('z', { getValue: () => true, setValue: () => {} })).toThrow(/duplicate binding/);
  });

  it('getValue/setValue route through binding when present', async () => {
    const s = new SettingsRegistryService(mkStorage(), mkStorage());
    s.register({ key: 'b', type: 'boolean', default: false, scope: 'user', description: '' });
    let stored = false;
    const setSpy = vi.fn(async (v: boolean) => { stored = v; });
    s.bind<boolean>('b', { getValue: () => stored, setValue: setSpy });
    expect(s.getValue('b')).toBe(false);
    await s.setValue('b', true);
    expect(setSpy).toHaveBeenCalledWith(true);
    expect(s.getValue('b')).toBe(true);
  });

  it('binding.onDidChange forwards as registry change event', () => {
    const s = new SettingsRegistryService(mkStorage(), mkStorage());
    s.register({ key: 'b', type: 'boolean', default: false, scope: 'workspace', description: '' });
    const emitter = new Emitter<boolean>();
    s.bind<boolean>('b', { getValue: () => false, setValue: () => {}, onDidChange: emitter.event });
    const heard: any[] = [];
    s.onDidChange(e => heard.push(e));
    emitter.fire(true);
    expect(heard).toEqual([{ key: 'b', value: true, scope: 'workspace' }]);
  });
});

describe('SettingsRegistryService — persistence + scope routing', () => {
  it('user vs workspace overrides land in separate storages', async () => {
    const user = mkStorage();
    const ws = mkStorage();
    const s = new SettingsRegistryService(user, ws);
    s.register({ key: 'u', type: 'string', default: '', scope: 'user', description: '' });
    s.register({ key: 'w', type: 'string', default: '', scope: 'workspace', description: '' });
    await s.setValue('u', 'U-VAL');
    await s.setValue('w', 'W-VAL');
    expect(JSON.parse(user.map.get('settings.overrides')!)).toEqual({ u: 'U-VAL' });
    expect(JSON.parse(ws.map.get('settings.overrides')!)).toEqual({ w: 'W-VAL' });
  });

  it('initialize hydrates overrides from storage; corrupt JSON ignored', async () => {
    const user = mkStorage();
    user.map.set('settings.overrides', JSON.stringify({ k: 'hello' }));
    const ws = mkStorage();
    ws.map.set('settings.overrides', 'NOT-JSON');
    const s = new SettingsRegistryService(user, ws);
    s.register({ key: 'k', type: 'string', default: 'def', scope: 'user', description: '' });
    s.register({ key: 'q', type: 'string', default: 'qdef', scope: 'workspace', description: '' });
    await s.initialize();
    expect(s.getValue('k')).toBe('hello');
    expect(s.getValue('q')).toBe('qdef'); // workspace fell back to default
  });

  it('initialize ignores non-object / array JSON', async () => {
    const user = mkStorage();
    user.map.set('settings.overrides', JSON.stringify([1, 2]));
    const s = new SettingsRegistryService(user, undefined);
    s.register({ key: 'k', type: 'string', default: 'def', scope: 'user', description: '' });
    await s.initialize();
    expect(s.getValue('k')).toBe('def');
  });
});

describe('SettingsRegistryService — secrets', () => {
  it('getValue for secret returns schema.default; getSecretValue uses safeStorage', async () => {
    const s = new SettingsRegistryService(mkStorage(), mkStorage());
    s.register({ key: 'api', type: 'string', default: '', scope: 'user', description: '', secret: true });
    const secretSvc = {
      getString: vi.fn(async () => ({ ok: true, value: 'SECRET-VALUE' })),
      setString: vi.fn(async () => ({ ok: true })),
    };
    s.setSecretStorage(secretSvc as any);
    expect(s.getValue('api')).toBe(''); // never the real secret
    await expect(s.getSecretValue('api')).resolves.toBe('SECRET-VALUE');
    expect(secretSvc.getString).toHaveBeenCalledWith('api');
  });

  it('getSecretValue throws when schema is not secret', async () => {
    const s = new SettingsRegistryService(mkStorage(), mkStorage());
    s.register({ key: 'k', type: 'string', default: '', scope: 'user', description: '' });
    await expect(s.getSecretValue('k')).rejects.toThrow(/called for non-secret/);
  });

  it('getSecretValue returns null when safeStorage unavailable', async () => {
    const s = new SettingsRegistryService(mkStorage(), mkStorage());
    s.register({ key: 'api', type: 'string', default: '', scope: 'user', description: '', secret: true });
    await expect(s.getSecretValue('api')).resolves.toBeNull();
  });

  it('setValue for secret routes to safeStorage and stripped from JSON persist', async () => {
    const user = mkStorage();
    const s = new SettingsRegistryService(user, mkStorage());
    s.register({ key: 'api', type: 'string', default: '', scope: 'user', description: '', secret: true });
    const setSecret = vi.fn(async () => ({ ok: true }));
    s.setSecretStorage({ getString: async () => ({ ok: false }), setString: setSecret } as any);
    await s.setValue('api', 'SECRET-VALUE');
    expect(setSecret).toHaveBeenCalledWith('api', 'SECRET-VALUE');
    expect(user.map.get('settings.overrides')).toBeUndefined();
  });
});

describe('SettingsRegistryService — reset', () => {
  it('removes override and fires change with schema.default', async () => {
    const s = new SettingsRegistryService(mkStorage(), mkStorage());
    s.register({ key: 'k', type: 'string', default: 'def', scope: 'user', description: '' });
    await s.setValue('k', 'override');
    const heard: any[] = [];
    s.onDidChange(e => heard.push(e));
    await s.reset('k');
    expect(s.getValue('k')).toBe('def');
    expect(heard).toEqual([{ key: 'k', value: 'def', scope: 'user' }]);
  });

  it('reset throws on unregistered key', async () => {
    const s = new SettingsRegistryService(undefined, undefined);
    await expect(s.reset('unknown')).rejects.toThrow(/unregistered key/);
  });
});

describe('SettingsRegistryService — migrateSecretsFromJson', () => {
  it('migrates plaintext secret keys out of JSON overrides into safeStorage', async () => {
    const user = mkStorage();
    user.map.set('settings.overrides', JSON.stringify({ api: 'SECRET', other: 'keep' }));
    const s = new SettingsRegistryService(user, mkStorage());
    s.register({ key: 'api', type: 'string', default: '', scope: 'user', description: '', secret: true });
    s.register({ key: 'other', type: 'string', default: '', scope: 'user', description: '' });
    await s.initialize();
    const setSecret = vi.fn(async () => ({ ok: true }));
    s.setSecretStorage({ getString: async () => ({ ok: false }), setString: setSecret } as any);
    await s.migrateSecretsFromJson();
    expect(setSecret).toHaveBeenCalledWith('api', 'SECRET');
    expect(JSON.parse(user.map.get('settings.overrides')!)).toEqual({ other: 'keep' });
  });
});

describe('SettingsRegistryService — global accessor', () => {
  it('setGlobalSettingsRegistry / getGlobalSettingsRegistry roundtrip', () => {
    const s = new SettingsRegistryService(undefined, undefined);
    setGlobalSettingsRegistry(s);
    expect(getGlobalSettingsRegistry()).toBe(s);
    setGlobalSettingsRegistry(undefined);
    expect(getGlobalSettingsRegistry()).toBeUndefined();
  });
});
