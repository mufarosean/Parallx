// unifiedAIConfigService.ts — Unified AI Configuration Service
//
// Single source of truth for all AI configuration.
//
// Config resolution (lowest → highest priority):
//   Built-in defaults → Global AI settings → Workspace override
//
// Backwards-compatible: exposes getActiveProfile() for consumers that read
// the older profile shape.

import { Disposable } from '../platform/lifecycle.js';
import { Emitter } from '../platform/events.js';
import type { Event } from '../platform/events.js';
import type { IStorage } from '../platform/storage.js';
import type { AISettingsProfile, DeepPartial, IAISettingsService } from './aiSettingsTypes.js';
import type {
  IUnifiedAIConfig,
  IUnifiedAIConfigService,
  IWorkspaceAIOverride,
} from './unifiedConfigTypes.js';
import {
  DEFAULT_UNIFIED_CONFIG,
  tolegacyProfile,
} from './unifiedConfigTypes.js';
import type { IConfigFileSystem } from '../services/parallxConfigService.js';

// ─── Storage Keys ──────────────────────────────────────────────────────────

const STORAGE_KEY_CONFIG = 'unified-ai.config';
// The settings used to live in a list of presets with one active. They are
// read from there once, when the config key is still empty; the old keys
// are left as they were.
const STORAGE_KEY_OLD_PRESETS = 'unified-ai.presets';
const STORAGE_KEY_OLD_ACTIVE_ID = 'unified-ai.activePresetId';

// ─── Deep Merge ────────────────────────────────────────────────────────────

/** Deep merge a partial patch onto a target. Only non-undefined patch values override. */
export function deepMerge<T extends Record<string, unknown>>(
  target: T,
  patch: DeepPartial<T>,
): T {
  const result = { ...target };
  for (const key of Object.keys(patch) as Array<keyof T>) {
    const patchVal = patch[key];
    if (
      patchVal !== undefined &&
      typeof patchVal === 'object' &&
      patchVal !== null &&
      !Array.isArray(patchVal) &&
      typeof target[key] === 'object' &&
      target[key] !== null &&
      !Array.isArray(target[key])
    ) {
      result[key] = deepMerge(
        target[key] as Record<string, unknown>,
        patchVal as DeepPartial<Record<string, unknown>>,
      ) as T[keyof T];
    } else if (patchVal !== undefined) {
      result[key] = patchVal as T[keyof T];
    }
  }
  return result;
}

/** Stored values over the current defaults, so fields added since are filled. */
function withDefaults(stored: unknown): IUnifiedAIConfig {
  const base = structuredClone(DEFAULT_UNIFIED_CONFIG);
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return base;
  return deepMerge(
    base as unknown as Record<string, unknown>,
    stored as DeepPartial<Record<string, unknown>>,
  ) as unknown as IUnifiedAIConfig;
}

// ─── Workspace Override File ───────────────────────────────────────────────

const WORKSPACE_OVERRIDE_PATH = '.parallx/ai-config.json';
const LEGACY_CONFIG_PATH = '.parallx/config.json';

// ═══════════════════════════════════════════════════════════════════════════════
// Service Implementation
// ═══════════════════════════════════════════════════════════════════════════════

export class UnifiedAIConfigService extends Disposable implements IUnifiedAIConfigService, IAISettingsService {
  private _config: IUnifiedAIConfig = structuredClone(DEFAULT_UNIFIED_CONFIG);
  private _workspaceOverride: IWorkspaceAIOverride | undefined;
  private _fs: IConfigFileSystem | undefined;

  private readonly _onDidChangeUnified: Emitter<IUnifiedAIConfig>;
  /** Unified change event — fires effective IUnifiedAIConfig. */
  readonly onDidChangeConfig: Event<IUnifiedAIConfig>;
  /**
   * Legacy change event — fires AISettingsProfile.
   * Satisfies IAISettingsService.onDidChange.
   */
  readonly onDidChange: Event<AISettingsProfile>;

  private readonly _onDidChangeLegacy: Emitter<AISettingsProfile>;

  /** Fires when workspace overrides are (re)loaded from disk (hydration). */
  private readonly _onDidLoadWorkspace: Emitter<void>;
  readonly onDidLoadWorkspaceConfig: Event<void>;

  constructor(
    private readonly _storage: IStorage,
  ) {
    super();
    this._onDidChangeUnified = this._register(new Emitter<IUnifiedAIConfig>());
    this.onDidChangeConfig = this._onDidChangeUnified.event;
    this._onDidChangeLegacy = this._register(new Emitter<AISettingsProfile>());
    this.onDidChange = this._onDidChangeLegacy.event;
    this._onDidLoadWorkspace = this._register(new Emitter<void>());
    this.onDidLoadWorkspaceConfig = this._onDidLoadWorkspace.event;
  }

  // ── Initialization ──

  /**
   * Initialize: load the global settings from storage, load workspace
   * overrides, import legacy config.json if applicable. Must be called after
   * construction.
   */
  async initialize(): Promise<void> {
    await this._loadConfig();
    await this._loadWorkspaceOverride();
  }

  /** Bind a filesystem accessor for reading workspace-level config files. */
  setFileSystem(fs: IConfigFileSystem): void {
    this._fs = fs;
  }

  /**
   * Load (or reload) workspace overrides from the filesystem.
   * Call this after setFileSystem() to pick up .parallx/ai-config.json
   * or legacy .parallx/config.json. Safe to call multiple times.
   */
  async loadWorkspaceConfig(): Promise<void> {
    await this._loadWorkspaceOverride();
    // Signal hydration BEFORE the change event so listeners can re-baseline
    // and not mistake a saved override loaded from disk for a fresh save.
    this._onDidLoadWorkspace.fire();
    this._onDidChangeUnified.fire(this.getEffectiveConfig());
    this._onDidChangeLegacy.fire(this.getActiveProfile());
  }

  // ── Effective Config ──

  getEffectiveConfig(): IUnifiedAIConfig {
    if (!this._workspaceOverride?.overrides) {
      return this._config;
    }

    return deepMerge(
      this._config as unknown as Record<string, unknown>,
      this._workspaceOverride.overrides as DeepPartial<Record<string, unknown>>,
    ) as unknown as IUnifiedAIConfig;
  }

  // ── Global Settings ──

  async updateConfig(patch: DeepPartial<IUnifiedAIConfig>): Promise<void> {
    this._config = deepMerge(
      this._config as unknown as Record<string, unknown>,
      patch as DeepPartial<Record<string, unknown>>,
    ) as unknown as IUnifiedAIConfig;
    await this._persist();
    this._fireChange();
  }

  async resetSection(section: keyof IUnifiedAIConfig): Promise<void> {
    this._config = {
      ...this._config,
      [section]: structuredClone(DEFAULT_UNIFIED_CONFIG[section]),
    };
    await this._persist();
    this._fireChange();
  }

  async resetAll(): Promise<void> {
    this._config = structuredClone(DEFAULT_UNIFIED_CONFIG);
    await this._persist();
    this._fireChange();
  }

  // ── Workspace Override ──

  getWorkspaceOverride(): IWorkspaceAIOverride | undefined {
    return this._workspaceOverride;
  }

  async updateWorkspaceOverride(patch: DeepPartial<IUnifiedAIConfig>): Promise<void> {
    const current = this._workspaceOverride?.overrides ?? {};
    const merged = deepMerge(
      current as Record<string, unknown>,
      patch as DeepPartial<Record<string, unknown>>,
    );

    this._workspaceOverride = { overrides: merged as DeepPartial<IUnifiedAIConfig> };

    await this._writeWorkspaceOverride();
    this._fireChange();
  }

  async clearWorkspaceOverride(path?: string): Promise<void> {
    if (!this._workspaceOverride) return;

    if (!path) {
      // Clear all overrides
      this._workspaceOverride = undefined;
    } else {
      // Clear a specific path (dot-notation)
      const overrides = { ...(this._workspaceOverride.overrides as Record<string, unknown>) };
      const parts = path.split('.');
      _deleteNestedKey(overrides, parts);
      this._workspaceOverride = { overrides: overrides as DeepPartial<IUnifiedAIConfig> };
    }

    await this._writeWorkspaceOverride();
    this._fireChange();
  }

  isOverridden(path: string): boolean {
    if (!this._workspaceOverride?.overrides) return false;
    return _getNestedValue(this._workspaceOverride.overrides as Record<string, unknown>, path.split('.')) !== undefined;
  }

  getOverriddenKeys(): string[] {
    if (!this._workspaceOverride?.overrides) return [];
    return _collectPaths(this._workspaceOverride.overrides as Record<string, unknown>);
  }

  // ── Legacy Compatibility (IAISettingsService) ──

  getActiveProfile(): AISettingsProfile {
    return tolegacyProfile(this._config);
  }

  // ── Private: Storage ──

  private async _loadConfig(): Promise<void> {
    try {
      const json = await this._storage.get(STORAGE_KEY_CONFIG);
      if (json) {
        this._config = withDefaults(JSON.parse(json));
        return;
      }
      this._config = withDefaults(await this._readOldActivePreset());
    } catch (e) {
      console.warn('[UnifiedAIConfigService] Failed to load AI settings, using defaults:', e);
      this._config = structuredClone(DEFAULT_UNIFIED_CONFIG);
    }
    await this._persist();
  }

  /** The settings of the preset that was active, from before presets went. */
  private async _readOldActivePreset(): Promise<unknown> {
    const presetsJson = await this._storage.get(STORAGE_KEY_OLD_PRESETS);
    if (!presetsJson) return undefined;
    const presets: unknown = JSON.parse(presetsJson);
    if (!Array.isArray(presets)) return undefined;
    const activeId = (await this._storage.get(STORAGE_KEY_OLD_ACTIVE_ID)) || 'default';
    const active = presets.find((p) => p && typeof p === 'object' && (p as { id?: unknown }).id === activeId)
      ?? presets.find((p) => p && typeof p === 'object' && (p as { id?: unknown }).id === 'default');
    return (active as { config?: unknown } | undefined)?.config;
  }

  private async _loadWorkspaceOverride(): Promise<void> {
    if (!this._fs) return;

    try {
      // Try new workspace override file
      const exists = await this._fs.exists(WORKSPACE_OVERRIDE_PATH);
      if (exists) {
        const content = await this._fs.readFile(WORKSPACE_OVERRIDE_PATH);
        const json = _parseJsonWithComments(content);
        if (json && typeof json === 'object' && !Array.isArray(json)) {
          // An older file may also name a preset to use (_presetId); only
          // the overrides are read.
          const overrides = (json as { overrides?: unknown }).overrides;
          this._workspaceOverride = {
            overrides: (overrides && typeof overrides === 'object' ? overrides : {}) as DeepPartial<IUnifiedAIConfig>,
          };
          return;
        }
      }

      // Try importing legacy config.json
      await this._importLegacyConfig();
    } catch {
      // best-effort — workspace override is optional
    }
  }

  /** Import .parallx/config.json as workspace override (one-time migration). */
  private async _importLegacyConfig(): Promise<void> {
    if (!this._fs) return;

    try {
      const exists = await this._fs.exists(LEGACY_CONFIG_PATH);
      if (!exists) return;

      const content = await this._fs.readFile(LEGACY_CONFIG_PATH);
      const json = _parseJsonWithComments(content);
      if (!json || typeof json !== 'object' || Array.isArray(json)) return;

      // Dynamic import to avoid circular deps
      const { mergeConfig } = await import('../services/parallxConfigService.js');
      const legacyConfig = mergeConfig(json as Record<string, unknown>);

      // Only import if values differ from defaults
      const { fromLegacyParallxConfig } = await import('./unifiedConfigTypes.js');
      const overrides = fromLegacyParallxConfig(legacyConfig);
      if (Object.keys(overrides).length > 0) {
        this._workspaceOverride = { overrides };
        await this._writeWorkspaceOverride();
        console.log('[UnifiedAIConfigService] Imported workspace settings from .parallx/config.json');
      }
    } catch {
      // best-effort
    }
  }

  private async _persist(): Promise<void> {
    await this._storage.set(STORAGE_KEY_CONFIG, JSON.stringify(this._config));
  }

  private async _writeWorkspaceOverride(): Promise<void> {
    if (!this._fs?.writeFile) return; // No write capability — skip silently

    try {
      if (!this._workspaceOverride || Object.keys(this._workspaceOverride.overrides).length === 0) {
        // Nothing to persist — could optionally delete the file, but leave it.
        return;
      }

      const json = JSON.stringify(this._workspaceOverride, null, 2);
      await this._fs.writeFile(WORKSPACE_OVERRIDE_PATH, json);
    } catch (err) {
      console.warn('[UnifiedAIConfigService] Failed to write workspace override:', err);
    }
  }

  private _fireChange(): void {
    this._onDidChangeUnified.fire(this.getEffectiveConfig());
    this._onDidChangeLegacy.fire(this.getActiveProfile());
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Utility Functions
// ═══════════════════════════════════════════════════════════════════════════════

/** Delete a nested key by dot-path parts. */
function _deleteNestedKey(obj: Record<string, unknown>, parts: string[]): void {
  if (parts.length === 0) return;
  if (parts.length === 1) {
    delete obj[parts[0]];
    return;
  }
  const child = obj[parts[0]];
  if (child && typeof child === 'object' && !Array.isArray(child)) {
    _deleteNestedKey(child as Record<string, unknown>, parts.slice(1));
    // Clean up empty parents
    if (Object.keys(child as object).length === 0) {
      delete obj[parts[0]];
    }
  }
}

/** Get a nested value by dot-path parts. */
function _getNestedValue(obj: Record<string, unknown>, parts: string[]): unknown {
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** Collect all leaf paths from a nested object. */
function _collectPaths(obj: Record<string, unknown>, prefix = ''): string[] {
  const paths: string[] = [];
  for (const key of Object.keys(obj)) {
    const fullPath = prefix ? `${prefix}.${key}` : key;
    const val = obj[key];
    if (val !== undefined && val !== null && typeof val === 'object' && !Array.isArray(val)) {
      paths.push(..._collectPaths(val as Record<string, unknown>, fullPath));
    } else if (val !== undefined) {
      paths.push(fullPath);
    }
  }
  return paths;
}

/** Strip // and /* comments before parsing (jsonc → json). */
function _parseJsonWithComments(text: string): unknown {
  let cleaned = text.replace(/\/\/.*$/gm, '');
  cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, '');
  cleaned = cleaned.replace(/,\s*([}\]])/g, '$1');
  return JSON.parse(cleaned);
}
