// pythonSettingsRegistration.test.ts — the settings-panel blank-body bug (M94/M97)
//
// Reproduces the real boot order, which is the whole point:
//
//   workbench.ts:734   registerWorkbenchServices()  → constructs PythonEnvService
//   chat/main.ts:545   setGlobalSettingsRegistry()  → registry finally exists
//
// The service registered its settings in its constructor, when there was no
// registry, so nothing was ever registered. Two visible consequences:
//
//   1. No `python.*` rows in Settings.
//   2. SettingsRegistryService.getValue THROWS on an unregistered key, so the
//      first read blew up inside the Settings panel constructor and the panel
//      rendered its heading with an empty body — indistinguishable from a
//      feature that was never built.
//
// These tests fail against the original code and pass against the fix.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  SettingsRegistryService,
  setGlobalSettingsRegistry,
  getGlobalSettingsRegistry,
} from '../../src/services/settingsRegistryService.js';
import {
  PythonEnvService,
  PYTHON_ENABLED_KEY,
  PYTHON_SCRIPTS_DIR_KEY,
  PYTHON_OUTPUT_DIR_KEY,
  PYTHON_RUN_TIMEOUT_KEY,
} from '../../src/services/pythonEnvService.js';

const ALL_KEYS = [
  PYTHON_ENABLED_KEY,
  PYTHON_SCRIPTS_DIR_KEY,
  PYTHON_OUTPUT_DIR_KEY,
  PYTHON_RUN_TIMEOUT_KEY,
];

let service: PythonEnvService | undefined;

afterEach(() => {
  service?.dispose();
  service = undefined;
  setGlobalSettingsRegistry(undefined);
});

beforeEach(() => {
  setGlobalSettingsRegistry(undefined);
});

describe('SettingsRegistryService.getValue — the sharp edge', () => {
  it('throws on an unregistered key rather than returning a default', () => {
    // Documented here because it is the reason a missed registration became a
    // blank panel instead of a setting stuck at its default.
    const registry = new SettingsRegistryService();
    expect(() => registry.getValue('python.enabled')).toThrow(/unregistered key/);
  });
});

describe('PythonEnvService settings registration', () => {
  it('survives construction with NO registry present', () => {
    // This is the real boot order: the service exists long before the registry.
    expect(() => { service = new PythonEnvService(); }).not.toThrow();
  });

  it('reading isEnabled before any registry exists does not throw', () => {
    service = new PythonEnvService();
    expect(() => service!.isEnabled).not.toThrow();
    expect(service.isEnabled).toBe(false);
  });

  it('registers its schemas once the registry appears late', () => {
    service = new PythonEnvService();          // constructed first…
    const registry = new SettingsRegistryService();
    setGlobalSettingsRegistry(registry);       // …registry arrives afterwards

    service.ensureSettingsRegistered();

    for (const key of ALL_KEYS) {
      expect(registry.getSchema(key), key).toBeDefined();
    }
  });

  it('registers lazily on first read, without an explicit call', () => {
    service = new PythonEnvService();
    const registry = new SettingsRegistryService();
    setGlobalSettingsRegistry(registry);

    // Merely reading is enough — this is the path the Settings panel takes.
    expect(() => service!.isEnabled).not.toThrow();
    expect(registry.getSchema(PYTHON_ENABLED_KEY)).toBeDefined();
  });

  it('reading every setting is safe with a registry but no schemas yet', () => {
    service = new PythonEnvService();
    setGlobalSettingsRegistry(new SettingsRegistryService());
    // The original failure: registry present, schema absent, getValue throws.
    expect(() => {
      void service!.isEnabled;
      void service!.scriptsDir;
      void service!.outputDir;
    }).not.toThrow();
  });

  it('is idempotent — repeated registration does not throw on duplicates', () => {
    // SettingsRegistryService.register() throws on a duplicate key, so the
    // guard has to be a getSchema check, not a boolean flag that could be
    // wrong after a registry swap.
    service = new PythonEnvService();
    setGlobalSettingsRegistry(new SettingsRegistryService());
    expect(() => {
      service!.ensureSettingsRegistered();
      service!.ensureSettingsRegistered();
      service!.ensureSettingsRegistered();
    }).not.toThrow();
  });

  it('re-registers against a REPLACED registry', () => {
    // Workspace switches dispose and rebuild the chat tool, which owns the
    // global registry — so the service can outlive the registry it registered
    // with.
    service = new PythonEnvService();
    setGlobalSettingsRegistry(new SettingsRegistryService());
    service.ensureSettingsRegistered();

    const second = new SettingsRegistryService();
    setGlobalSettingsRegistry(second);
    expect(second.getSchema(PYTHON_ENABLED_KEY)).toBeUndefined();

    void service.isEnabled;
    expect(second.getSchema(PYTHON_ENABLED_KEY)).toBeDefined();
  });

  it('declares the gate off by default, at workspace scope', () => {
    service = new PythonEnvService();
    const registry = new SettingsRegistryService();
    setGlobalSettingsRegistry(registry);
    service.ensureSettingsRegistered();

    const schema = registry.getSchema(PYTHON_ENABLED_KEY)!;
    expect(schema.default).toBe(false);
    expect(schema.scope).toBe('workspace');
    // Category drives the grouping in the flat Settings list.
    expect(schema.category).toBe('Python');
  });

  it('setEnabled is a no-op rather than a throw when there is no registry', async () => {
    service = new PythonEnvService();
    await expect(service.setEnabled(true)).resolves.toBeUndefined();
  });

  it('every python.* schema lands in getAllSchemas, so Settings can list them', () => {
    service = new PythonEnvService();
    const registry = new SettingsRegistryService();
    setGlobalSettingsRegistry(registry);
    service.ensureSettingsRegistered();

    const listed = new Set(registry.getAllSchemas().map((s) => s.key));
    for (const key of ALL_KEYS) expect(listed.has(key), key).toBe(true);
  });

  it('the global accessor is what the service reads through', () => {
    // Guards against a refactor that captures the registry at construction —
    // which would reintroduce exactly this bug.
    service = new PythonEnvService();
    expect(getGlobalSettingsRegistry()).toBeUndefined();
    const registry = new SettingsRegistryService();
    setGlobalSettingsRegistry(registry);
    void service.isEnabled;
    expect(registry.getSchema(PYTHON_ENABLED_KEY)).toBeDefined();
  });
});
