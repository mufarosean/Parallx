// configurationRegistry.ts — configuration schema registration
//
// Processes `contributes.configuration` sections from tool manifests
// and maintains a registry of all configuration property schemas.
// The registry is the single source of truth for registered defaults,
// types, and descriptions.

import { IDisposable, toDisposable } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';
import type {
  IConfigurationPropertySchema,
  IRegisteredConfigurationSection,
} from './configurationTypes.js';
import type {
  IManifestConfigurationDescriptor,
  IManifestConfigurationProperty,
} from '../tools/toolManifest.js';

// ─── Events ──────────────────────────────────────────────────────────────────

export interface ConfigurationSchemaChangeEvent {
  /** The tool whose schemas changed. */
  readonly toolId: string;
  /** The property keys that were added or removed. */
  readonly affectedKeys: readonly string[];
}

// ─── ConfigurationRegistry ───────────────────────────────────────────────────

/**
 * Central registry for configuration schemas contributed by tools.
 *
 * When a tool's manifest declares `contributes.configuration`, the shell
 * parses the schema and registers each property here. The
 * ConfigurationService uses this registry to resolve defaults and
 * validate written values.
 */
export class ConfigurationRegistry implements IDisposable {
  /** All registered property schemas, keyed by full property key. */
  private readonly _properties = new Map<string, IConfigurationPropertySchema>();

  /** Sections grouped by tool ID. */
  private readonly _sectionsByTool = new Map<string, IRegisteredConfigurationSection[]>();

  private readonly _onDidChangeSchema = new Emitter<ConfigurationSchemaChangeEvent>();
  /** Fires when schemas are added or removed. */
  readonly onDidChangeSchema: Event<ConfigurationSchemaChangeEvent> = this._onDidChangeSchema.event;

  // ── Registration ─────────────────────────────────────────────────────

  /**
   * Register configuration schemas from a tool manifest.
   *
   * @param toolId The tool's ID.
   * @param configurations Array of configuration descriptors from the manifest.
   * @returns A disposable that unregisters all schemas for the tool.
   */
  registerFromManifest(
    toolId: string,
    configurations: readonly IManifestConfigurationDescriptor[],
  ): IDisposable {
    const registeredKeys: string[] = [];

    for (const config of configurations) {
      const section = this._processSection(toolId, config);
      // Store section
      const existing = this._sectionsByTool.get(toolId) ?? [];
      existing.push(section);
      this._sectionsByTool.set(toolId, existing);

      // Register each property
      for (const prop of section.properties) {
        if (this._properties.has(prop.key)) {
          console.warn(
            `[ConfigurationRegistry] Duplicate configuration key "${prop.key}" ` +
            `(tool: ${toolId}). Overwriting previous registration.`,
          );
        }
        this._properties.set(prop.key, prop);
        registeredKeys.push(prop.key);
      }
    }

    if (registeredKeys.length > 0) {
      this._onDidChangeSchema.fire({ toolId, affectedKeys: registeredKeys });
    }

    return toDisposable(() => {
      this.unregisterTool(toolId);
    });
  }

  /**
   * Register configuration schemas from a simple properties map.
   * Used by the ConfigurationService for programmatic registration.
   */
  registerProperties(
    toolId: string,
    title: string,
    properties: Record<string, { type: string; default?: unknown; description?: string; enum?: readonly string[] }>,
  ): IDisposable {
    const registeredKeys: string[] = [];
    const schemas: IConfigurationPropertySchema[] = [];

    for (const [key, prop] of Object.entries(properties)) {
      const schema: IConfigurationPropertySchema = {
        key,
        type: prop.type,
        defaultValue: prop.default,
        description: prop.description ?? '',
        enum: prop.enum,
        toolId,
        sectionTitle: title,
      };

      if (this._properties.has(key)) {
        console.warn(
          `[ConfigurationRegistry] Duplicate configuration key "${key}" ` +
          `(tool: ${toolId}). Overwriting previous registration.`,
        );
      }

      this._properties.set(key, schema);
      schemas.push(schema);
      registeredKeys.push(key);
    }

    // Store section
    const section: IRegisteredConfigurationSection = {
      toolId,
      title,
      properties: schemas,
    };
    const existing = this._sectionsByTool.get(toolId) ?? [];
    existing.push(section);
    this._sectionsByTool.set(toolId, existing);

    if (registeredKeys.length > 0) {
      this._onDidChangeSchema.fire({ toolId, affectedKeys: registeredKeys });
    }

    return toDisposable(() => {
      this.unregisterTool(toolId);
    });
  }

  /**
   * Unregister all configuration schemas for a tool.
   */
  unregisterTool(toolId: string): void {
    const sections = this._sectionsByTool.get(toolId);
    if (!sections) return;

    const removedKeys: string[] = [];
    for (const section of sections) {
      for (const prop of section.properties) {
        this._properties.delete(prop.key);
        removedKeys.push(prop.key);
      }
    }
    this._sectionsByTool.delete(toolId);

    if (removedKeys.length > 0) {
      this._onDidChangeSchema.fire({ toolId, affectedKeys: removedKeys });
    }
  }

  // ── Queries ──────────────────────────────────────────────────────────

  /**
   * Get the registered schema for a property key.
   */
  getPropertySchema(key: string): IConfigurationPropertySchema | undefined {
    return this._properties.get(key);
  }

  /**
   * Get the registered default value for a key.
   */
  getDefault(key: string): unknown {
    return this._properties.get(key)?.defaultValue;
  }

  /**
   * Check if a key has a registered schema.
   */
  hasSchema(key: string): boolean {
    return this._properties.has(key);
  }

  /**
   * Get all registered property schemas.
   */
  getAllSchemas(): readonly IConfigurationPropertySchema[] {
    return [...this._properties.values()];
  }

  /**
   * Get all registered sections.
   */
  getAllSections(): readonly IRegisteredConfigurationSection[] {
    const result: IRegisteredConfigurationSection[] = [];
    for (const sections of this._sectionsByTool.values()) {
      result.push(...sections);
    }
    return result;
  }

  /**
   * Get all schemas contributed by a specific tool.
   */
  getToolSchemas(toolId: string): readonly IConfigurationPropertySchema[] {
    const sections = this._sectionsByTool.get(toolId);
    if (!sections) return [];
    return sections.flatMap(s => [...s.properties]);
  }

  /**
   * Validate a value against its registered schema.
   * Returns `true` if valid, or a string error message if invalid.
   */
  validateValue(key: string, value: unknown): true | string {
    const schema = this._properties.get(key);
    if (!schema) {
      return true; // Unknown keys are allowed (forward compatibility)
    }

    return _validateType(key, value, schema);
  }

  // ── Internal ─────────────────────────────────────────────────────────

  /**
   * Process a single configuration section from a manifest.
   */
  private _processSection(
    toolId: string,
    config: IManifestConfigurationDescriptor,
  ): IRegisteredConfigurationSection {
    const properties: IConfigurationPropertySchema[] = [];

    for (const [key, prop] of Object.entries(config.properties)) {
      properties.push({
        key,
        type: prop.type,
        defaultValue: prop.default,
        description: prop.description ?? '',
        enum: prop.enum,
        toolId,
        sectionTitle: config.title,
      });
    }

    return {
      toolId,
      title: config.title,
      properties,
    };
  }

  // ── Disposal ─────────────────────────────────────────────────────────

  dispose(): void {
    this._properties.clear();
    this._sectionsByTool.clear();
    this._onDidChangeSchema.dispose();
  }
}

// ─── Validation Helpers ──────────────────────────────────────────────────────

function _validateType(
  key: string,
  value: unknown,
  schema: IConfigurationPropertySchema,
): true | string {
  if (value === null || value === undefined) {
    return true; // null/undefined are always allowed (resets to default)
  }

  switch (schema.type) {
    case 'string':
      if (typeof value !== 'string') {
        return `Configuration "${key}" expects a string, got ${typeof value}`;
      }
      if (schema.enum && schema.enum.length > 0) {
        if (!schema.enum.includes(value as string)) {
          return `Configuration "${key}" must be one of [${schema.enum.join(', ')}], got "${value}"`;
        }
      }
      return true;

    case 'number':
      if (typeof value !== 'number' || Number.isNaN(value)) {
        return `Configuration "${key}" expects a number, got ${typeof value}`;
      }
      return true;

    case 'boolean':
      if (typeof value !== 'boolean') {
        return `Configuration "${key}" expects a boolean, got ${typeof value}`;
      }
      return true;

    case 'object':
      if (typeof value !== 'object' || Array.isArray(value)) {
        return `Configuration "${key}" expects an object, got ${Array.isArray(value) ? 'array' : typeof value}`;
      }
      return true;

    case 'array':
      if (!Array.isArray(value)) {
        return `Configuration "${key}" expects an array, got ${typeof value}`;
      }
      return true;

    default:
      return true; // Unknown types pass validation (forward compatibility)
  }
}
