// configurationService.ts — configuration read/write/events
//
// The ConfigurationService is the runtime API for reading and writing
// configuration values. It delegates schema registration to the
// ConfigurationRegistry and persists explicit values in IStorage
// (per-workspace).
//
// Tools access this through `parallx.workspace.getConfiguration(section)`.

import { Disposable, IDisposable, toDisposable } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';
import { IStorage } from '../platform/storage.js';
import { ConfigurationRegistry } from './configurationRegistry.js';
import type {
  IWorkspaceConfiguration,
  IConfigurationChangeEvent,
  IConfigurationPropertySchema,
  IRegisteredConfigurationSection,
  IConfigurationServiceShape,
  ConfigurationValueType,
} from './configurationTypes.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Storage key prefix for explicit configuration values. */
const CONFIG_STORAGE_PREFIX = 'config:';

// ─── ConfigurationService ────────────────────────────────────────────────────

/**
 * Runtime configuration service.
 *
 * Responsibilities:
 * - Reads configuration values (explicit or default from registry)
 * - Writes configuration values to storage
 * - Fires change events when values are updated
 * - Delegates schema management to ConfigurationRegistry
 */
export class ConfigurationService extends Disposable implements IConfigurationServiceShape {
  /** In-memory cache of explicit (non-default) configuration values. */
  private readonly _values = new Map<string, unknown>();

  /** Whether initial load from storage has completed. */
  private _loaded = false;

  private readonly _onDidChangeConfiguration = this._register(new Emitter<IConfigurationChangeEvent>());
  /** Fires when any configuration value changes. */
  readonly onDidChangeConfiguration: Event<IConfigurationChangeEvent> = this._onDidChangeConfiguration.event;

  constructor(
    private readonly _storage: IStorage,
    private readonly _registry: ConfigurationRegistry,
  ) {
    super();

    // Forward schema changes as configuration change events
    // (so tools see new defaults when schemas are registered)
    this._register(this._registry.onDidChangeSchema((e) => {
      this._onDidChangeConfiguration.fire({
        affectsConfiguration: (section: string) =>
          e.affectedKeys.some(k => k === section || k.startsWith(section + '.') || section.startsWith(k + '.')),
        affectedKeys: e.affectedKeys,
      });
    }));
  }

  // ── Lifecycle ────────────────────────────────────────────────────────

  /**
   * Load all persisted configuration values from storage.
   * Call once during initialization.
   */
  async load(): Promise<void> {
    if (this._loaded) return;

    const allKeys = await this._storage.keys(CONFIG_STORAGE_PREFIX);
    for (const storageKey of allKeys) {
      const raw = await this._storage.get(storageKey);
      if (raw !== undefined) {
        const configKey = storageKey.slice(CONFIG_STORAGE_PREFIX.length);
        try {
          this._values.set(configKey, JSON.parse(raw));
        } catch {
          console.warn(`[ConfigurationService] Skipping corrupt config entry "${configKey}"`);
        }
      }
    }

    this._loaded = true;
  }

  // ── IConfigurationServiceShape ───────────────────────────────────────

  /**
   * Get a scoped configuration object.
   *
   * If `section` is provided, keys are relative to that section.
   * For example: `getConfiguration('myTool').get('fontSize')` reads `myTool.fontSize`.
   *
   * If `section` is omitted, keys are absolute.
   */
  getConfiguration(section?: string): IWorkspaceConfiguration {
    return new ScopedConfiguration(this, section);
  }

  /**
   * Register configuration schemas from a tool.
   * Delegates to ConfigurationRegistry.
   */
  registerSchema(
    toolId: string,
    title: string,
    properties: Record<string, { type: string; default?: unknown; description?: string; enum?: readonly string[] }>,
  ): IDisposable {
    return this._registry.registerProperties(toolId, title, properties);
  }

  /**
   * Unregister all schemas for a tool.
   */
  unregisterTool(toolId: string): void {
    this._registry.unregisterTool(toolId);
  }

  /**
   * Get the registered default for a key.
   */
  getDefault(key: string): unknown {
    return this._registry.getDefault(key);
  }

  /**
   * Check if a key has a registered schema.
   */
  hasSchema(key: string): boolean {
    return this._registry.hasSchema(key);
  }

  /**
   * Get all registered property schemas.
   */
  getAllSchemas(): readonly IConfigurationPropertySchema[] {
    return this._registry.getAllSchemas();
  }

  /**
   * Get all registered sections.
   */
  getAllSections(): readonly IRegisteredConfigurationSection[] {
    return this._registry.getAllSections();
  }

  // ── Internal Read/Write ──────────────────────────────────────────────

  /**
   * Read a configuration value. Falls back to registered default.
   */
  _getValue<T>(key: string, defaultValue?: T): T | undefined {
    // Explicit value takes precedence
    if (this._values.has(key)) {
      return this._values.get(key) as T;
    }

    // Fall back to registered default from schema
    const registeredDefault = this._registry.getDefault(key);
    if (registeredDefault !== undefined) {
      return registeredDefault as T;
    }

    // Fall back to caller-provided default
    return defaultValue;
  }

  /**
   * Check if a key has an explicit value or a registered schema.
   */
  _hasValue(key: string): boolean {
    return this._values.has(key) || this._registry.hasSchema(key);
  }

  /**
   * Update a configuration value and persist to storage.
   */
  async _updateValue(key: string, value: ConfigurationValueType): Promise<void> {
    // Validate against schema
    const validationResult = this._registry.validateValue(key, value);
    if (validationResult !== true) {
      console.warn(`[ConfigurationService] ${validationResult}`);
      // Still allow the write (warn, don't block)
    }

    if (value === undefined || value === null) {
      // Delete the explicit value (falls back to default)
      this._values.delete(key);
      await this._storage.delete(CONFIG_STORAGE_PREFIX + key);
    } else {
      this._values.set(key, value);
      await this._storage.set(CONFIG_STORAGE_PREFIX + key, JSON.stringify(value));
    }

    // Fire change event
    this._onDidChangeConfiguration.fire({
      affectsConfiguration: (section: string) =>
        key === section || key.startsWith(section + '.') || section.startsWith(key + '.'),
      affectedKeys: [key],
    });
  }

  // ── Disposal ─────────────────────────────────────────────────────────

  override dispose(): void {
    this._values.clear();
    super.dispose();
  }
}

// ─── ScopedConfiguration ─────────────────────────────────────────────────────

/**
 * A section-scoped view into the configuration service.
 * Returned by `getConfiguration(section)`.
 */
class ScopedConfiguration implements IWorkspaceConfiguration {
  constructor(
    private readonly _service: ConfigurationService,
    private readonly _section: string | undefined,
  ) {}

  get<T>(key: string, defaultValue?: T): T | undefined {
    const fullKey = this._section ? `${this._section}.${key}` : key;
    return this._service._getValue(fullKey, defaultValue);
  }

  async update(key: string, value: ConfigurationValueType): Promise<void> {
    const fullKey = this._section ? `${this._section}.${key}` : key;
    await this._service._updateValue(fullKey, value);
  }

  has(key: string): boolean {
    const fullKey = this._section ? `${this._section}.${key}` : key;
    return this._service._hasValue(fullKey);
  }
}
