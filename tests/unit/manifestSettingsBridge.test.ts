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

  beforeEach(async () => {
    registry = new SettingsRegistryService(memStorage(), memStorage());
    await registry.initialize();
    config = new ConfigurationService(memStorage(), new ConfigurationRegistry());
    await config.load();
    registerManifestConfiguration(registry, MANIFEST, config);
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

  it('works without the config bridge (legacy callers unchanged)', async () => {
    const bare = new SettingsRegistryService(memStorage(), memStorage());
    await bare.initialize();
    registerManifestConfiguration(bare, MANIFEST);
    await bare.setValue('testTool.color', 'green');
    expect(bare.getValue('testTool.color')).toBe('green');
  });
});
