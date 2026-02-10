// configurationTypes.ts — shared types for the configuration system
//
// Defines the interfaces for configuration read/write, change events,
// and schema registration used by the ConfigurationService and
// ConfigurationRegistry.

import { Event } from '../platform/events.js';
import { IDisposable } from '../platform/lifecycle.js';

// ─── Configuration Values ────────────────────────────────────────────────────

/**
 * Allowed configuration value types (JSON-serializable).
 */
export type ConfigurationValueType = string | number | boolean | null | undefined | object | unknown[];

/**
 * A read/write configuration object returned by `getConfiguration(section?)`.
 */
export interface IWorkspaceConfiguration {
  /** Read a setting value, falling back to the registered default. */
  get<T>(key: string, defaultValue?: T): T | undefined;

  /** Write a setting value. Returns a promise that resolves when persisted. */
  update(key: string, value: ConfigurationValueType): Promise<void>;

  /** Check if a setting exists (explicit value or registered default). */
  has(key: string): boolean;
}

// ─── Configuration Change Event ──────────────────────────────────────────────

/**
 * Fired when one or more configuration values change.
 */
export interface IConfigurationChangeEvent {
  /** Check whether a given section/key was affected by the change. */
  affectsConfiguration(section: string): boolean;

  /** The specific keys that changed. */
  readonly affectedKeys: readonly string[];
}

// ─── Configuration Schema ────────────────────────────────────────────────────

/**
 * A single registered configuration property schema.
 */
export interface IConfigurationPropertySchema {
  /** The full dot-separated key (e.g., `'myTool.setting1'`). */
  readonly key: string;

  /** Type constraint: 'string' | 'number' | 'boolean' | 'object' | 'array'. */
  readonly type: string;

  /** Default value used when no explicit value is set. */
  readonly defaultValue: unknown;

  /** Human-readable description. */
  readonly description: string;

  /** Allowed enum values (for string properties). */
  readonly enum?: readonly string[];

  /** The tool ID that contributed this property. */
  readonly toolId: string;

  /** The section title from the manifest. */
  readonly sectionTitle: string;
}

/**
 * A registered configuration section contributed by a tool.
 */
export interface IRegisteredConfigurationSection {
  /** The tool ID that contributed this section. */
  readonly toolId: string;

  /** Human-readable section title. */
  readonly title: string;

  /** All property schemas in this section. */
  readonly properties: readonly IConfigurationPropertySchema[];
}

// ─── Configuration Service Interface ─────────────────────────────────────────

/**
 * Service interface for the configuration system.
 */
export interface IConfigurationServiceShape extends IDisposable {
  /** Get a scoped configuration object for a section. */
  getConfiguration(section?: string): IWorkspaceConfiguration;

  /** Fires when any configuration value changes. */
  readonly onDidChangeConfiguration: Event<IConfigurationChangeEvent>;

  /** Register a configuration schema from a tool manifest. */
  registerSchema(toolId: string, title: string, properties: Record<string, { type: string; default?: unknown; description?: string; enum?: readonly string[] }>): IDisposable;

  /** Unregister all configuration schemas for a tool. */
  unregisterTool(toolId: string): void;

  /** Get the registered default value for a key. */
  getDefault(key: string): unknown;

  /** Check if a key has a registered schema. */
  hasSchema(key: string): boolean;

  /** Get all registered property schemas. */
  getAllSchemas(): readonly IConfigurationPropertySchema[];

  /** Get all registered sections. */
  getAllSections(): readonly IRegisteredConfigurationSection[];
}
