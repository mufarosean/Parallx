// manifestSettings.ts — the declarative path for extension settings.
//
// An extension can either call ISettingsRegistryService.register() imperatively
// (what built-ins do), OR declare `contributes.configuration` in its manifest.
// This maps the manifest form into the same unified registry, so declared
// settings show up in the Settings hub and read/write through one service —
// the standard way new extensions wire settings into the app.
//
// THE BRIDGE (standardization P1): manifest keys are ALSO what extensions
// read through `parallx.workspace.getConfiguration()` — a different store
// (`config:` keys) from the registry's `settings.overrides`. Before this
// bridge the two never met: editing an extension setting in the Settings
// hub wrote a value the extension never read (media-organizer documents
// the defect in its own comments). Every manifest key now registers WITH
// a binding onto the ConfigurationService, making the `config:` store the
// single truth: hub edits write it, extension reads see them, extension
// writes flow back into the hub via the change event.

import type { ISettingSchema, SettingType, ISettingBinding } from './settingsRegistryService.js';
import { Emitter } from '../platform/events.js';
import type { Event } from '../platform/events.js';

interface ManifestConfigProperty {
  type?: string;
  default?: unknown;
  description?: string;
  enum?: readonly string[];
  // Tolerated if a manifest includes them, though not in the core type.
  minimum?: number;
  maximum?: number;
  scope?: string;
  category?: string;
}

interface ManifestLike {
  id: string;
  name?: string;
  contributes?: {
    configuration?: readonly { title?: string; properties?: Record<string, ManifestConfigProperty> }[];
  };
}

/** Minimal slice of the settings registry this bridge needs. */
interface RegistryLike {
  register(schema: ISettingSchema): void;
  getSchema(key: string): ISettingSchema | undefined;
  bind?<T>(key: string, binding: ISettingBinding<T>): void;
}

/** Minimal slice of the ConfigurationService the binding routes through. */
export interface ConfigBridgeLike {
  getConfiguration(section?: string): {
    get<T>(key: string, defaultValue?: T): T | undefined;
    update(key: string, value: unknown): Promise<void>;
  };
  onDidChangeConfiguration?: Event<{ affectedKeys: readonly string[] }>;
}

function mapType(t: string | undefined, hasEnum: boolean): SettingType | null {
  if (hasEnum) return 'enum';
  switch (t) {
    case 'boolean': return 'boolean';
    case 'number': case 'integer': return 'number';
    case 'string': return 'string';
    case 'object': case 'array': return 'object';
    default: return null;
  }
}

function defaultFor(type: SettingType, prop: ManifestConfigProperty): unknown {
  if (prop.default !== undefined) return prop.default;
  switch (type) {
    case 'boolean': return false;
    case 'number': return 0;
    case 'enum': return prop.enum?.[0] ?? '';
    case 'object': return {};
    default: return '';
  }
}

/**
 * Register every `contributes.configuration` property from a manifest into the
 * unified settings registry. Idempotent — keys already registered (e.g. by the
 * extension imperatively) are skipped.
 *
 * When `config` is provided, each key is BOUND to the ConfigurationService:
 * the `config:` store the extension reads becomes the single truth, and hub
 * edits finally reach the extension (and vice versa, live).
 */
export function registerManifestConfiguration(
  registry: RegistryLike,
  manifest: ManifestLike,
  config?: ConfigBridgeLike,
): void {
  const sections = manifest.contributes?.configuration;
  if (!sections || sections.length === 0) return;

  for (const section of sections) {
    const category = section.title || manifest.name || manifest.id;
    for (const [key, prop] of Object.entries(section.properties ?? {})) {
      if (registry.getSchema(key)) continue;
      const type = mapType(prop.type, Array.isArray(prop.enum) && prop.enum.length > 0);
      if (!type) {
        console.warn(`[manifestSettings] "${manifest.id}" config "${key}": unsupported type "${prop.type}" — skipped.`);
        continue;
      }
      const schema: ISettingSchema = {
        key,
        type,
        default: defaultFor(type, prop),
        scope: prop.scope === 'user' ? 'user' : 'workspace',
        description: prop.description ?? key,
        category,
        ...(type === 'enum' ? { enumValues: prop.enum } : {}),
        ...(prop.minimum !== undefined ? { min: prop.minimum } : {}),
        ...(prop.maximum !== undefined ? { max: prop.maximum } : {}),
      };
      try {
        registry.register(schema);
        if (config && registry.bind) {
          registry.bind(key, _configBinding(key, schema.default, config));
        }
      } catch (err) {
        console.warn(`[manifestSettings] failed to register "${key}" from "${manifest.id}":`, err);
      }
    }
  }
}

/** A registry binding that routes one key through the ConfigurationService. */
function _configBinding(key: string, schemaDefault: unknown, config: ConfigBridgeLike): ISettingBinding {
  const cfg = config.getConfiguration();

  // External mutations (the extension calling cfg.update) propagate into
  // the registry so the hub stays live. One filtered subscription per key —
  // manifest keys are bounded and app-lifetime, matching bind() semantics.
  let onDidChange: Event<unknown> | undefined;
  if (config.onDidChangeConfiguration) {
    const emitter = new Emitter<unknown>();
    config.onDidChangeConfiguration((e) => {
      if (e.affectedKeys.includes(key)) emitter.fire(cfg.get(key) ?? schemaDefault);
    });
    onDidChange = emitter.event;
  }

  return {
    getValue: () => {
      const v = cfg.get(key);
      return v === undefined ? schemaDefault : v;
    },
    setValue: (value) => cfg.update(key, value),
    ...(onDidChange ? { onDidChange } : {}),
  };
}
