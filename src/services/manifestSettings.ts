// manifestSettings.ts — the declarative path for extension settings.
//
// An extension can either call ISettingsRegistryService.register() imperatively
// (what built-ins do), OR declare `contributes.configuration` in its manifest.
// This maps the manifest form into the same unified registry, so declared
// settings show up in the Settings hub and read/write through one service —
// the standard way new extensions wire settings into the app.

import type { ISettingSchema, SettingType } from './settingsRegistryService.js';

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
 */
export function registerManifestConfiguration(registry: RegistryLike, manifest: ManifestLike): void {
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
      } catch (err) {
        console.warn(`[manifestSettings] failed to register "${key}" from "${manifest.id}":`, err);
      }
    }
  }
}
