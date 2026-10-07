// manifestSettingsBridge.test.ts — the settings-store bridge (P1).
//
// THE defect this pins against regressing: manifest configuration keys
// were registered into the Settings hub's registry (settings.overrides)
// while extensions read them through the ConfigurationService (config:
// store) — two stores, never bridged, so a hub edit was a silent no-op
// for every extension setting. The bridge binds each manifest key to the
// ConfigurationService, making the config: store the single truth. These
// tests drive the REAL registry and REAL ConfigurationService end to end.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SettingsRegistryService } from '../../src/services/settingsRegistryService';
import { ConfigurationService } from '../../src/configuration/configurationService';
import { ConfigurationRegistry } from '../../src/configuration/configurationRegistry';
import { registerManifestConfiguration } from '../../src/services/manifestSettings';
import type { IStorage } from '../../src/platform/storage';

function memStorage(): IStorage {
  const map = new Map<string, string>();
  return {
    get: async (k) => map.get(k),
    set: async (k, v) => { map.set(k, v); },
    delete: async (k) => { map.delete(k); },
    has: async (k) => map.has(k),
    keys: async (prefix) => [...map.keys()].filter((k) => !prefix || k.startsWith(prefix)),
    clear: async () => { map.clear(); },
  };
}

const MANIFEST = {
  id: 'test.tool',
  name: 'Test Tool',
  contributes: {
    configuration: [{
      title: 'Test Tool',
      properties: {
        'testTool.color': { type: 'string', default: 'blue', description: 'A color.' },
        'testTool.limit': { type: 'number', default: 10, description: 'A limit.' },
        'testTool.enabled': { type: 'boolean', default: true, description: 'A switch.' },
      },
    }],
  },
};

describe('the manifest settings bridge — one store, both readers', () => {
  let registry: SettingsRegistryService;
  let config: ConfigurationService;
  let toolSettings: { dispose(): void };

  beforeEach(async () => {
    registry = new SettingsRegistryService(memStorage(), memStorage());
    await registry.initialize();
    config = new ConfigurationService(memStorage(), new ConfigurationRegistry());
    await config.load();
    toolSettings = registerManifestConfiguration(registry, MANIFEST, config);
  });

  it("a tool turned off takes its settings out of the hub; on again, they are back with the user's values", async () => {
    await registry.setValue('testTool.color', 'red');
    let schemaChanges = 0;
    registry.onDidChangeSchemas(() => { schemaChanges++; });
    toolSettings.dispose(); // the tool was turned off
    expect(registry.getAllSchemas().filter((s) => s.key.startsWith('testTool.'))).toEqual([]);
    expect(schemaChanges).toBe(3);
    toolSettings = registerManifestConfiguration(registry, MANIFEST, config); // turned on again
    expect(registry.getAllSchemas().filter((s) => s.key.startsWith('testTool.'))).toHaveLength(3);
    expect(registry.getValue('testTool.color')).toBe('red');
    await registry.setValue('testTool.limit', 7);
    expect(config.getConfiguration('testTool').get('limit')).toBe(7);
  });

  it('a hub edit reaches the extension (the original defect)', async () => {
    await registry.setValue('testTool.color', 'red');
    // What the extension reads via parallx.workspace.getConfiguration():
    expect(config.getConfiguration('testTool').get('color')).toBe('red');
    expect(config.getConfiguration().get('testTool.color')).toBe('red');
  });

  it('an extension write reaches the hub, live', async () => {
    const changes: string[] = [];
    registry.onDidChange((c) => changes.push(`${c.key}=${String(c.value)}`));

    await config.getConfiguration('testTool').update('limit', 25);

    expect(registry.getValue('testTool.limit')).toBe(25);
    expect(changes).toContain('testTool.limit=25');
  });

  it('defaults flow through when neither store has a value', () => {
    expect(registry.getValue('testTool.color')).toBe('blue');
    expect(registry.getValue('testTool.limit')).toBe(10);
    expect(registry.getValue('testTool.enabled')).toBe(true);
  });

  it('reset returns the key to its manifest default in the shared store', async () => {
    await registry.setValue('testTool.enabled', false);
    expect(config.getConfiguration('testTool').get('enabled')).toBe(false);

    await registry.reset('testTool.enabled');
    expect(registry.getValue('testTool.enabled')).toBe(true);
  });

  it('registration stays idempotent — a re-registered manifest binds once', () => {
    // Tool re-enable re-fires onDidRegisterTool; getSchema-guard must keep
    // bind() from throwing its duplicate-binding error.
    expect(() => registerManifestConfiguration(registry, MANIFEST, config)).not.toThrow();
  });

  it('a string with editPresentation multilineText is edited in a text area', async () => {
    const bare = new SettingsRegistryService(memStorage(), memStorage());
    await bare.initialize();
    registerManifestConfiguration(bare, { id: 't.m', contributes: { configuration: [{ properties: {
      't.notes': { type: 'string', default: '', description: 'Notes.', editPresentation: 'multilineText', rows: 8 },
      't.key': { type: 'string', default: '', description: 'A key.', editPresentation: 'multilineText', secret: true },
    } }] } });
    expect(bare.getSchema('t.notes')).toMatchObject({ type: 'multiline', rows: 8 });
    await bare.setValue('t.notes', 'line one\nline two');
    expect(bare.getValue('t.notes')).toBe('line one\nline two');
    expect(bare.getSchema('t.key')!.type).toBe('string');
  });

  it('works without the config bridge (legacy callers unchanged)', async () => {
    const bare = new SettingsRegistryService(memStorage(), memStorage());
    await bare.initialize();
    registerManifestConfiguration(bare, MANIFEST);
    await bare.setValue('testTool.color', 'green');
    expect(bare.getValue('testTool.color')).toBe('green');
  });

  it('ConfigurationService.inspect names the precedence branch (Phase C)', async () => {
    const cfg = new ConfigurationService(memStorage(), new ConfigurationRegistry());
    await cfg.load();
    cfg.registerSchema('testTool', 'Test', {
      'testTool.mode': { type: 'string', default: 'auto', description: 'mode' },
    });

    expect(cfg.inspect('testTool.mode')).toMatchObject({ origin: 'default', value: 'auto', schemaDefault: 'auto' });
    expect(cfg.inspect('testTool.unknown')).toMatchObject({ origin: 'unset', value: undefined });

    await cfg.getConfiguration('testTool').update('mode', 'manual');
    expect(cfg.inspect('testTool.mode')).toMatchObject({ origin: 'explicit', value: 'manual', schemaDefault: 'auto' });
    cfg.dispose();
  });
});
