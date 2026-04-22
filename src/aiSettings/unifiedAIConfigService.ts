// unifiedAIConfigService.ts — Unified AI Configuration Service (M20 Task A.2)
//
// Single source of truth for all AI configuration.
// Replaces both AISettingsService (M15) and ParallxConfigService (M11).
//
// Config resolution (lowest → highest priority):
//   Built-in defaults → Active global preset → Workspace override
//
// Backwards-compatible: exposes getActiveProfile() for M15 consumers.

import { Disposable } from '../platform/lifecycle.js';
import { Emitter } from '../platform/events.js';
import type { Event } from '../platform/events.js';
import type { IStorage } from '../platform/storage.js';
import type { AISettingsProfile, DeepPartial, IAISettingsService } from './aiSettingsTypes.js';
import type {
  IUnifiedAIConfig,
  IUnifiedAIConfigService,
  IUnifiedPreset,
  IWorkspaceAIOverride,
} from './unifiedConfigTypes.js';
import {
  DEFAULT_UNIFIED_CONFIG,
  fromLegacyProfile,
  tolegacyProfile,
} from './unifiedConfigTypes.js';
import type { ILanguageModelsService, IChatResponseChunk } from '../services/chatTypes.js';
import type { IConfigFileSystem } from '../services/parallxConfigService.js';

// ─── Storage Keys ──────────────────────────────────────────────────────────

const STORAGE_KEY_PRESETS = 'unified-ai.presets';
const STORAGE_KEY_ACTIVE_ID = 'unified-ai.activePresetId';
const LEGACY_KEY_PROFILES = 'ai-settings.profiles';
const LEGACY_KEY_ACTIVE_ID = 'ai-settings.activeProfileId';

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

// ─── Stream Collector ──────────────────────────────────────────────────────

async function collectStreamedResponse(
  stream: AsyncIterable<IChatResponseChunk>,
): Promise<string> {
  const parts: string[] = [];
  for await (const chunk of stream) {
    if (chunk.content) {
      parts.push(chunk.content);
    }
  }
  return parts.join('');
}

// ─── Built-in Presets ──────────────────────────────────────────────────────

function makeBuiltInPresets(): IUnifiedPreset[] {

  const defaultPreset: IUnifiedPreset = {
    id: 'default',
    presetName: 'Default',
    isBuiltIn: true,
    createdAt: 0,
    updatedAt: 0,
    config: { ...DEFAULT_UNIFIED_CONFIG },
  };

  const financePreset: IUnifiedPreset = {
    id: 'finance-focus',
    presetName: 'Finance Focus',
    isBuiltIn: true,
    createdAt: 0,
    updatedAt: 0,
    config: {
      ...DEFAULT_UNIFIED_CONFIG,
      persona: {
        name: 'Finance Assistant',
        description: 'Focused on transactions, budgeting, and financial insights',
        avatarEmoji: 'avatar-coins',
      },
      suggestions: {
        ...DEFAULT_UNIFIED_CONFIG.suggestions,
        tone: 'concise',
        focusDomain: 'finance',
        suggestionConfidenceThreshold: 0.6,
      },
    },
  };

  const creativePreset: IUnifiedPreset = {
    id: 'creative-mode',
    presetName: 'Creative Mode',
    isBuiltIn: true,
    createdAt: 0,
    updatedAt: 0,
    config: {
      ...DEFAULT_UNIFIED_CONFIG,
      persona: {
        name: 'Creative Partner',
        description: 'Playful and exploratory — great for writing and brainstorming',
        avatarEmoji: 'avatar-pen',
      },
      model: {
        ...DEFAULT_UNIFIED_CONFIG.model,
        temperature: 0.9,
      },
      suggestions: {
        ...DEFAULT_UNIFIED_CONFIG.suggestions,
        tone: 'detailed',
        focusDomain: 'writing',
      },
    },
  };

  return [defaultPreset, financePreset, creativePreset];
}

const BUILT_IN_PRESETS = makeBuiltInPresets();

// ─── Workspace Override File ───────────────────────────────────────────────

const WORKSPACE_OVERRIDE_PATH = '.parallx/ai-config.json';
const LEGACY_CONFIG_PATH = '.parallx/config.json';

// ═══════════════════════════════════════════════════════════════════════════════
// Service Implementation
// ═══════════════════════════════════════════════════════════════════════════════

export class UnifiedAIConfigService extends Disposable implements IUnifiedAIConfigService, IAISettingsService {
  private _presets: IUnifiedPreset[] = [];
  private _activePresetId: string = 'default';
  private _workspaceOverride: IWorkspaceAIOverride | undefined;
  private _fs: IConfigFileSystem | undefined;

  private readonly _onDidChangeUnified: Emitter<IUnifiedAIConfig>;
  /** Unified change event — fires effective IUnifiedAIConfig. */
  readonly onDidChangeConfig: Event<IUnifiedAIConfig>;
  /**
   * Legacy change event — fires AISettingsProfile for M15 consumers.
   * Satisfies IAISettingsService.onDidChange.
   */
  readonly onDidChange: Event<AISettingsProfile>;

  private readonly _onDidChangeLegacy: Emitter<AISettingsProfile>;

  /** Fires when a built-in preset is cloned on write. */
  private readonly _onDidCloneBuiltInEmitter: Emitter<{ originalName: string; cloneName: string }>;
  readonly onDidCloneBuiltIn: Event<{ originalName: string; cloneName: string }>;

  constructor(
    private readonly _storage: IStorage,
    private readonly _languageModelsService: ILanguageModelsService | undefined,
  ) {
    super();
    this._onDidChangeUnified = this._register(new Emitter<IUnifiedAIConfig>());
    this.onDidChangeConfig = this._onDidChangeUnified.event;
    this._onDidChangeLegacy = this._register(new Emitter<AISettingsProfile>());
    this.onDidChange = this._onDidChangeLegacy.event;
    this._onDidCloneBuiltInEmitter = this._register(new Emitter<{ originalName: string; cloneName: string }>());
    this.onDidCloneBuiltIn = this._onDidCloneBuiltInEmitter.event;
  }

  // ── Initialization ──

  /**
   * Initialize: load presets from storage (migrating from legacy if needed),
   * load workspace overrides, import legacy config.json if applicable.
   * Must be called after construction.
   */
  async initialize(): Promise<void> {
    await this._loadPresets();
    await this._loadWorkspaceOverride();
    console.log(`[UnifiedAIConfigService] Loaded ${this._presets.length} presets, active: ${this._activePresetId}`);
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
    this._onDidChangeUnified.fire(this.getEffectiveConfig());
    this._onDidChangeLegacy.fire(this.getActiveProfile());
  }

  // ── Effective Config ──

  getEffectiveConfig(): IUnifiedAIConfig {
    // Resolve the active preset: workspace pin overrides global active
    const resolvedId = this._workspaceOverride?._presetId ?? this._activePresetId;
    const preset = this._presets.find(p => p.id === resolvedId);
    const baseConfig = preset?.config ?? DEFAULT_UNIFIED_CONFIG;

    if (!this._workspaceOverride?.overrides) {
      return baseConfig;
    }

    return deepMerge(
      baseConfig as unknown as Record<string, unknown>,
      this._workspaceOverride.overrides as DeepPartial<Record<string, unknown>>,
    ) as unknown as IUnifiedAIConfig;
  }

  // ── Preset Management ──

  getActivePreset(): IUnifiedPreset {
    const resolvedId = this._workspaceOverride?._presetId ?? this._activePresetId;
    const preset = this._presets.find(p => p.id === resolvedId);
    return preset ?? this._presets[0] ?? { ...BUILT_IN_PRESETS[0] };
  }

  getPreset(id: string): IUnifiedPreset | undefined {
    return this._presets.find(p => p.id === id);
  }

  getAllPresets(): IUnifiedPreset[] {
    return [...this._presets];
  }

  async setActivePreset(id: string): Promise<void> {
    const preset = this._presets.find(p => p.id === id);
    if (!preset) {
      throw new Error(`[UnifiedAIConfigService] Preset not found: ${id}`);
    }
    this._activePresetId = id;
    await this._persist();
    this._fireChange();
  }

  async updateActivePreset(patch: DeepPartial<IUnifiedAIConfig>): Promise<void> {
    let preset = this.getActivePreset();

    // Clone on write for built-in presets
    if (preset.isBuiltIn) {
      preset = await this._cloneBuiltIn(preset);
    }

    const updatedConfig = deepMerge(
      preset.config as unknown as Record<string, unknown>,
      patch as DeepPartial<Record<string, unknown>>,
    ) as unknown as IUnifiedAIConfig;

    const updatedPreset: IUnifiedPreset = {
      ...preset,
      updatedAt: Date.now(),
      config: updatedConfig,
    };

    const idx = this._presets.findIndex(p => p.id === updatedPreset.id);
    if (idx >= 0) {
      this._presets[idx] = updatedPreset;
    }

    await this._persist();
    this._fireChange();
  }

  async createPreset(name: string, baseId?: string): Promise<IUnifiedPreset> {
    const base = baseId
      ? this._presets.find(p => p.id === baseId)
      : this.getActivePreset();
    if (!base) {
      throw new Error(`[UnifiedAIConfigService] Base preset not found: ${baseId}`);
    }

    const newPreset: IUnifiedPreset = {
      id: this._generateId(),
      presetName: name,
      isBuiltIn: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      config: structuredClone(base.config),
    };

    this._presets.push(newPreset);
    this._activePresetId = newPreset.id;
    await this._persist();
    this._fireChange();
    return newPreset;
  }

  async deletePreset(id: string): Promise<void> {
    const preset = this._presets.find(p => p.id === id);
    if (!preset) {
      throw new Error(`[UnifiedAIConfigService] Preset not found: ${id}`);
    }
    if (preset.isBuiltIn) {
      throw new Error(`[UnifiedAIConfigService] Cannot delete built-in preset: ${preset.presetName}`);
    }

    this._presets = this._presets.filter(p => p.id !== id);
    if (this._activePresetId === id) {
      this._activePresetId = 'default';
    }

    await this._persist();
    this._fireChange();
  }

  async renamePreset(id: string, newName: string): Promise<void> {
    const preset = this._presets.find(p => p.id === id);
    if (!preset) {
      throw new Error(`[UnifiedAIConfigService] Preset not found: ${id}`);
    }
    if (preset.isBuiltIn) {
      throw new Error(`[UnifiedAIConfigService] Cannot rename built-in preset: ${preset.presetName}`);
    }

    const updated: IUnifiedPreset = {
      ...preset,
      presetName: newName,
      updatedAt: Date.now(),
    };
    const idx = this._presets.findIndex(p => p.id === id);
    if (idx >= 0) {
      this._presets[idx] = updated;
    }

    await this._persist();
    if (this._activePresetId === id) {
      this._fireChange();
    }
  }

  async resetSection(section: keyof IUnifiedAIConfig): Promise<void> {
    const preset = this.getActivePreset();
    if (preset.isBuiltIn) return; // already at defaults

    const defaultSection = DEFAULT_UNIFIED_CONFIG[section];
    const updatedConfig = {
      ...preset.config,
      [section]: structuredClone(defaultSection),
    };

    const updatedPreset: IUnifiedPreset = {
      ...preset,
      updatedAt: Date.now(),
      config: updatedConfig,
    };

    const idx = this._presets.findIndex(p => p.id === preset.id);
    if (idx >= 0) {
      this._presets[idx] = updatedPreset;
    }

    await this._persist();
    this._fireChange();
  }

  async resetAll(): Promise<void> {
    const preset = this.getActivePreset();
    if (preset.isBuiltIn) return;

    const updatedPreset: IUnifiedPreset = {
      ...preset,
      updatedAt: Date.now(),
      config: structuredClone(DEFAULT_UNIFIED_CONFIG),
    };

    const idx = this._presets.findIndex(p => p.id === preset.id);
    if (idx >= 0) {
      this._presets[idx] = updatedPreset;
    }

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

    this._workspaceOverride = {
      _presetId: this._workspaceOverride?._presetId,
      overrides: merged as DeepPartial<IUnifiedAIConfig>,
    };

    await this._writeWorkspaceOverride();
    this._fireChange();
  }

  async clearWorkspaceOverride(path?: string): Promise<void> {
    if (!this._workspaceOverride) return;

    if (!path) {
      // Clear all overrides
      this._workspaceOverride = this._workspaceOverride._presetId
        ? { _presetId: this._workspaceOverride._presetId, overrides: {} }
        : undefined;
    } else {
      // Clear a specific path (dot-notation)
      const overrides = { ...(this._workspaceOverride.overrides as Record<string, unknown>) };
      const parts = path.split('.');
      _deleteNestedKey(overrides, parts);
      this._workspaceOverride = {
        _presetId: this._workspaceOverride._presetId,
        overrides: overrides as DeepPartial<IUnifiedAIConfig>,
      };
    }

    await this._writeWorkspaceOverride();
    this._fireChange();
  }

  async setWorkspacePreset(presetId: string): Promise<void> {
    const preset = this._presets.find(p => p.id === presetId);
    if (!preset) {
      throw new Error(`[UnifiedAIConfigService] Preset not found: ${presetId}`);
    }

    this._workspaceOverride = {
      _presetId: presetId,
      overrides: this._workspaceOverride?.overrides ?? {},
    };
    await this._writeWorkspaceOverride();
    this._fireChange();
  }

  async clearWorkspacePreset(): Promise<void> {
    if (!this._workspaceOverride) return;
    this._workspaceOverride = {
      overrides: this._workspaceOverride.overrides,
    };
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
    return tolegacyProfile(this.getActivePreset());
  }

  getAllProfiles(): AISettingsProfile[] {
    return this._presets.map(tolegacyProfile);
  }

  async setActiveProfile(id: string): Promise<void> {
    return this.setActivePreset(id);
  }

  async updateActiveProfile(patch: DeepPartial<AISettingsProfile>): Promise<void> {
    // Convert legacy profile patch to unified config patch
    const configPatch: Record<string, unknown> = {};
    if (patch.persona) {
      configPatch.persona = patch.persona;
    }
    if (patch.chat) {
      configPatch.chat = patch.chat;
    }
    if (patch.model) {
      const modelPatch: Record<string, unknown> = {};
      if (patch.model.defaultModel !== undefined) {
        modelPatch.chatModel = patch.model.defaultModel;
      }
      if (patch.model.temperature !== undefined) {
        modelPatch.temperature = patch.model.temperature;
      }
      if (patch.model.maxTokens !== undefined) {
        modelPatch.maxTokens = patch.model.maxTokens;
      }
      if (patch.model.contextWindow !== undefined) {
        modelPatch.contextWindow = patch.model.contextWindow;
      }
      configPatch.model = modelPatch;
    }
    if (patch.suggestions) {
      configPatch.suggestions = patch.suggestions;
    }
    return this.updateActivePreset(configPatch as DeepPartial<IUnifiedAIConfig>);
  }

  async createProfile(name: string, baseId?: string): Promise<AISettingsProfile> {
    const preset = await this.createPreset(name, baseId);
    return tolegacyProfile(preset);
  }

  async deleteProfile(id: string): Promise<void> {
    return this.deletePreset(id);
  }

  async renameProfile(id: string, newName: string): Promise<void> {
    return this.renamePreset(id, newName);
  }

  async runPreviewTest(userMessage: string): Promise<string> {
    if (!this._languageModelsService) {
      throw new Error('[UnifiedAIConfigService] Language models service not available');
    }

    const config = this.getEffectiveConfig();
    const modelId = this._languageModelsService.getActiveModel();
    if (!modelId) {
      throw new Error('[UnifiedAIConfigService] No active model available');
    }

    const stream = this._languageModelsService.sendChatRequest(
      [
        { role: 'system', content: config.chat.systemPrompt },
        { role: 'user', content: userMessage },
      ],
      {
        temperature: config.model.temperature,
        maxTokens: config.model.maxTokens || undefined,
      },
    );

    return collectStreamedResponse(stream);
  }

  // ── Private: Storage ──

  private async _loadPresets(): Promise<void> {
    try {
      // Try loading new-format presets first
      const presetsJson = await this._storage.get(STORAGE_KEY_PRESETS);
      const activeId = await this._storage.get(STORAGE_KEY_ACTIVE_ID);

      if (presetsJson) {
        const parsed = JSON.parse(presetsJson);
        if (Array.isArray(parsed) && parsed.length > 0) {
          this._presets = this._healthCheckPresets(parsed);
          this._activePresetId = activeId ?? 'default';
          return;
        }
      }

      // Try migrating from legacy M15 format
      const legacyJson = await this._storage.get(LEGACY_KEY_PROFILES);
      const legacyActiveId = await this._storage.get(LEGACY_KEY_ACTIVE_ID);

      if (legacyJson) {
        const parsed = JSON.parse(legacyJson);
        if (Array.isArray(parsed) && parsed.length > 0) {
          this._presets = this._migrateLegacyProfiles(parsed);
          this._activePresetId = legacyActiveId ?? 'default';
          console.log(`[UnifiedAIConfigService] Migrated ${parsed.length} legacy profiles`);
          await this._persist();
          return;
        }
      }
    } catch (e) {
      console.warn('[UnifiedAIConfigService] Failed to load presets, resetting to defaults:', e);
    }

    // Seed with built-in presets
    this._presets = BUILT_IN_PRESETS.map(p => structuredClone(p));
    this._activePresetId = 'default';
    await this._persist();
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
          this._workspaceOverride = json as IWorkspaceAIOverride;
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
    await this._storage.set(STORAGE_KEY_PRESETS, JSON.stringify(this._presets));
    await this._storage.set(STORAGE_KEY_ACTIVE_ID, this._activePresetId);
  }

  private async _writeWorkspaceOverride(): Promise<void> {
    if (!this._fs?.writeFile) return; // No write capability — skip silently

    try {
      if (!this._workspaceOverride || (
        !this._workspaceOverride._presetId &&
        Object.keys(this._workspaceOverride.overrides).length === 0
      )) {
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
    const effective = this.getEffectiveConfig();
    this._onDidChangeUnified.fire(effective);
    this._onDidChangeLegacy.fire(tolegacyProfile(this.getActivePreset()));
  }

  // ── Private: Health Check & Migration ──

  private _healthCheckPresets(raw: unknown[]): IUnifiedPreset[] {
    const result: IUnifiedPreset[] = [];
    const builtInIds = new Set(BUILT_IN_PRESETS.map(p => p.id));

    // Ensure all built-in presets exist
    for (const builtIn of BUILT_IN_PRESETS) {
      const existing = raw.find(
        (p: any) => typeof p === 'object' && p !== null && p.id === builtIn.id,
      );
      if (existing && typeof existing === 'object') {
        // Merge stored values over current built-in defaults to fill new fields
        result.push(
          _mergePreset(builtIn, existing as Partial<IUnifiedPreset>),
        );
      } else {
        result.push(structuredClone(builtIn));
      }
    }

    // Add custom presets
    for (const item of raw) {
      if (
        typeof item === 'object' &&
        item !== null &&
        'id' in item &&
        typeof (item as any).id === 'string' &&
        !builtInIds.has((item as any).id)
      ) {
        const merged = _mergePreset(
          { ...BUILT_IN_PRESETS[0], isBuiltIn: false },
          item as Partial<IUnifiedPreset>,
        );
        const filled: IUnifiedPreset = { ...merged, isBuiltIn: false };
        result.push(filled);
      }
    }

    return result;
  }

  private _migrateLegacyProfiles(raw: unknown[]): IUnifiedPreset[] {
    const result: IUnifiedPreset[] = [];
    const builtInIds = new Set(BUILT_IN_PRESETS.map(p => p.id));

    for (const item of raw) {
      if (typeof item !== 'object' || item === null || !('id' in item)) continue;

      const legacy = item as AISettingsProfile;
      if (builtInIds.has(legacy.id)) {
        // Built-in: use our new defaults, merge any customizations
        const builtIn = BUILT_IN_PRESETS.find(p => p.id === legacy.id)!;
        result.push(structuredClone(builtIn));
      } else {
        // Custom profile: convert via migration helper
        result.push(fromLegacyProfile(legacy));
      }
    }

    // Ensure all built-in presets exist
    for (const builtIn of BUILT_IN_PRESETS) {
      if (!result.find(p => p.id === builtIn.id)) {
        result.push(structuredClone(builtIn));
      }
    }

    return result;
  }

  private async _cloneBuiltIn(preset: IUnifiedPreset): Promise<IUnifiedPreset> {
    const clone: IUnifiedPreset = {
      id: this._generateId(),
      presetName: `${preset.presetName} (Modified)`,
      isBuiltIn: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      config: structuredClone(preset.config),
    };
    this._presets.push(clone);
    this._activePresetId = clone.id;
    this._onDidCloneBuiltInEmitter.fire({
      originalName: preset.presetName,
      cloneName: clone.presetName,
    });
    return clone;
  }

  private _generateId(): string {
    return `preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

/** Merge a stored preset over a built-in one, filling missing fields. */
function _mergePreset(
  builtIn: IUnifiedPreset,
  stored: Partial<IUnifiedPreset>,
): IUnifiedPreset {
  const config = stored.config
    ? deepMerge(
        structuredClone(builtIn.config) as unknown as Record<string, unknown>,
        stored.config as unknown as DeepPartial<Record<string, unknown>>,
      ) as unknown as IUnifiedAIConfig
    : structuredClone(builtIn.config);

  return {
    id: stored.id ?? builtIn.id,
    presetName: stored.presetName ?? builtIn.presetName,
    isBuiltIn: builtIn.isBuiltIn,
    createdAt: stored.createdAt ?? builtIn.createdAt,
    updatedAt: stored.updatedAt ?? builtIn.updatedAt,
    config,
  };
}

/** Strip // and /* comments before parsing (jsonc → json). */
function _parseJsonWithComments(text: string): unknown {
  let cleaned = text.replace(/\/\/.*$/gm, '');
  cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, '');
  cleaned = cleaned.replace(/,\s*([}\]])/g, '$1');
  return JSON.parse(cleaned);
}
