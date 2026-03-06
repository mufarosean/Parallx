// unifiedConfigTypes.ts — Unified AI Configuration types (M20 Task A.1)
//
// Merges all AI configuration from three sources into one type system:
//   1. AISettingsProfile (M15) — persona, chat, model, suggestions
//   2. IParallxConfig (M11) — retrieval, agent, context budget, indexing
//   3. NEW — memory settings
//
// Consumer code imports unified types from this file.
// The legacy types (AISettingsProfile, IParallxConfig) remain for migration.

import type { IDisposable } from '../platform/lifecycle.js';
import type { Event } from '../platform/events.js';
import type {
  AITone,
  AIFocusDomain,
  AIResponseLength,
  AISettingsProfile,
  DeepPartial,
} from './aiSettingsTypes.js';
import type { IParallxConfig } from '../services/parallxConfigService.js';
import type { IConfigFileSystem } from '../services/parallxConfigService.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Unified Configuration Shape
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Behavior (from M15 persona + chat) ──────────────────────────────────────

export interface IUnifiedPersonaConfig {
  /** Display name shown in UI and suggestion cards */
  readonly name: string;
  /** One-sentence description */
  readonly description: string;
  /** Emoji or icon key used as the avatar */
  readonly avatarEmoji: string;
}

export interface IUnifiedChatConfig {
  /** System prompt injected at top of every chat */
  readonly systemPrompt: string;
  /** Whether user has manually edited the system prompt */
  readonly systemPromptIsCustom: boolean;
  /** Controls response length preference */
  readonly responseLength: AIResponseLength;
  /**
   * User-editable description of what this workspace contains.
   * Injected prominently into every system prompt so the AI knows the
   * meaning of "workspace" / "my files" in context — preventing semantic
   * contamination from documents that use the same vocabulary.
   * Empty string = auto-generated from workspace digest.
   */
  readonly workspaceDescription: string;
}

// ─── Model (merged from M15 + config.json) ──────────────────────────────────

export interface IUnifiedModelConfig {
  /** Preferred model for chat sessions (empty = auto-select) */
  readonly chatModel: string;
  /** Embedding model for RAG pipeline */
  readonly embeddingModel: string;
  /** 0.0 = deterministic, 1.0 = creative */
  readonly temperature: number;
  /** Max tokens per response (0 = model default) */
  readonly maxTokens: number;
  /** Context window size override (0 = model default) */
  readonly contextWindow: number;
}

// ─── Retrieval (from config.json — newly surfaced in UI) ─────────────────────

/**
 * Elastic context budget configuration (M20 Phase G).
 *
 * Replaces the old fixed-percentage system. Trim priority controls which
 * slots are trimmed first when the context window is exceeded. Lower
 * numbers are trimmed first. Min-percent floors guarantee a slot keeps
 * at least that percentage of the window.
 */
export interface IUnifiedContextBudgetConfig {
  /** Trim priority per slot (lower = trimmed first). */
  readonly trimPriority: {
    readonly systemPrompt: number;
    readonly ragContext: number;
    readonly history: number;
    readonly userMessage: number;
  };
  /** Minimum percentage floor per slot (0–100). */
  readonly minPercent: {
    readonly systemPrompt: number;
    readonly ragContext: number;
    readonly history: number;
    readonly userMessage: number;
  };
}

export interface IUnifiedRetrievalConfig {
  /** Automatically search workspace for context on every message */
  readonly autoRag: boolean;
  /** Number of top results to return from hybrid search */
  readonly ragTopK: number;
  /** Maximum chunks from any single source (prevents one doc monopolizing context) */
  readonly ragMaxPerSource: number;
  /** Token budget for retrieved context. 0 = auto (30% of model context window). */
  readonly ragTokenBudget: number;
  /** Minimum RRF score to include a retrieval result (0–1) */
  readonly ragScoreThreshold: number;
  /** Minimum cosine similarity for re-ranking filter (0–1). 0 = disabled. */
  readonly ragCosineThreshold: number;
  /** Relative score drop-off ratio (0–1). Results below topScore × ratio are dropped. 0 = disabled. */
  readonly ragDropoffRatio: number;
  /** Token budget allocation across system/RAG/history/user */
  readonly contextBudget: IUnifiedContextBudgetConfig;
}

// ─── Suggestions (from M15) ──────────────────────────────────────────────────

export interface IUnifiedSuggestionsConfig {
  /** Friendly tone for proactive suggestions */
  readonly tone: AITone;
  /** Domain the AI pays extra attention to */
  readonly focusDomain: AIFocusDomain;
  /** Free-text when focusDomain === 'custom' */
  readonly customFocusDescription: string;
  /** Minimum confidence 0–1 to surface a suggestion */
  readonly suggestionConfidenceThreshold: number;
  /** Whether proactive suggestion cards are shown */
  readonly suggestionsEnabled: boolean;
  /** Max suggestion cards visible at once */
  readonly maxPendingSuggestions: number;
}

// ─── Agent (from config.json) ────────────────────────────────────────────────

export interface IUnifiedAgentConfig {
  /** Maximum agentic loop iterations before stopping */
  readonly maxIterations: number;
}

// ─── Memory (NEW in M20) ─────────────────────────────────────────────────────

export interface IUnifiedMemoryConfig {
  /** Whether automatic memory creation is enabled */
  readonly memoryEnabled: boolean;
  /** Whether post-chat summarization runs */
  readonly autoSummarize: boolean;
  /** Days before stale memories are evicted */
  readonly evictionDays: number;
}

// ─── Indexing (from config.json) ─────────────────────────────────────────────

export interface IUnifiedIndexingConfig {
  /** Automatically index workspace files on open */
  readonly autoIndex: boolean;
  /** Watch files for changes and re-index */
  readonly watchFiles: boolean;
  /** Max file size in bytes to index (0 = no limit) */
  readonly maxFileSize: number;
  /** Glob patterns to exclude from indexing */
  readonly excludePatterns: readonly string[];
}

// ─── Tool Overrides (M20 E.3) ────────────────────────────────────────────────

/**
 * Per-workspace tool enable/disable overrides.
 * Keys are tool names, values are whether the tool is enabled.
 * Tools not listed here use the global (service-level) default.
 */
export interface IUnifiedToolsConfig {
  /** Tool enablement overrides: { toolName: enabled } */
  readonly enabledOverrides: Readonly<Record<string, boolean>>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// The Full Unified Config
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Complete unified AI configuration — the merged result of global preset
 * + workspace overrides. This is what consumers read at runtime.
 */
export interface IUnifiedAIConfig {
  readonly persona: IUnifiedPersonaConfig;
  readonly chat: IUnifiedChatConfig;
  readonly model: IUnifiedModelConfig;
  readonly retrieval: IUnifiedRetrievalConfig;
  readonly suggestions: IUnifiedSuggestionsConfig;
  readonly agent: IUnifiedAgentConfig;
  readonly memory: IUnifiedMemoryConfig;
  readonly indexing: IUnifiedIndexingConfig;
  readonly tools: IUnifiedToolsConfig;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Preset Metadata
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * A named preset wrapping a full IUnifiedAIConfig with metadata.
 * Replaces AISettingsProfile as the primary preset type.
 */
export interface IUnifiedPreset {
  /** Unique preset ID */
  readonly id: string;
  /** Human-readable name shown in the switcher */
  readonly presetName: string;
  /** Whether this is a built-in read-only preset */
  readonly isBuiltIn: boolean;
  /** ISO timestamp of creation */
  readonly createdAt: number;
  /** ISO timestamp of last modification */
  readonly updatedAt: number;
  /** The full config values for this preset */
  readonly config: IUnifiedAIConfig;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Workspace Override
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Sparse patch stored per-workspace in `.parallx/ai-config.json`.
 * Only fields present here override the global active preset.
 */
export interface IWorkspaceAIOverride {
  /** Optional: pin a specific global preset for this workspace */
  readonly _presetId?: string;
  /** Sparse partial config — only overridden fields */
  readonly overrides: DeepPartial<IUnifiedAIConfig>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Service Interface
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Unified AI Configuration Service.
 *
 * Replaces both AISettingsService (M15) and ParallxConfigService (M11)
 * with a single source of truth. Provides:
 *   - Global preset management (create, delete, rename, switch)
 *   - Workspace override layer (sparse patch per-workspace)
 *   - Merged effective config (preset + workspace override)
 *   - Change events for all consumers
 *
 * Config resolution: built-in defaults → active preset → workspace override
 */
export interface IUnifiedAIConfigService extends IDisposable {
  // ── Effective Config ──

  /** Get the fully merged config (active preset + workspace overrides). */
  getEffectiveConfig(): IUnifiedAIConfig;

  // ── Preset Management ──

  /** Get the active preset (un-merged, global-level). */
  getActivePreset(): IUnifiedPreset;

  /** Get a preset by ID. */
  getPreset(id: string): IUnifiedPreset | undefined;

  /** List all saved presets. */
  getAllPresets(): IUnifiedPreset[];

  /** Switch the active global preset. */
  setActivePreset(id: string): Promise<void>;

  /** Update the active preset's config. Clones if built-in. */
  updateActivePreset(patch: DeepPartial<IUnifiedAIConfig>): Promise<void>;

  /** Create a new preset (cloned from baseId or active). */
  createPreset(name: string, baseId?: string): Promise<IUnifiedPreset>;

  /** Delete a preset (cannot delete built-in). */
  deletePreset(id: string): Promise<void>;

  /** Rename a preset. */
  renamePreset(id: string, newName: string): Promise<void>;

  /** Reset a section to factory defaults. */
  resetSection(section: keyof IUnifiedAIConfig): Promise<void>;

  /** Reset entire active preset to factory defaults. */
  resetAll(): Promise<void>;

  // ── Workspace Override ──

  /** Get current workspace override (sparse patch). */
  getWorkspaceOverride(): IWorkspaceAIOverride | undefined;

  /** Update workspace override with a sparse patch. */
  updateWorkspaceOverride(patch: DeepPartial<IUnifiedAIConfig>): Promise<void>;

  /** Clear one field or all workspace overrides. */
  clearWorkspaceOverride(path?: string): Promise<void>;

  /** Pin a specific preset for this workspace. */
  setWorkspacePreset(presetId: string): Promise<void>;

  /** Clear workspace preset pinning (fall back to global active). */
  clearWorkspacePreset(): Promise<void>;

  /** Check if a specific config path is overridden at workspace level. */
  isOverridden(path: string): boolean;

  /** List all overridden paths. */
  getOverriddenKeys(): string[];

  // ── Legacy Compatibility ──

  /**
   * Get the effective config as a legacy AISettingsProfile.
   * Enables gradual migration — consumers that still use the old shape
   * can call this until they switch to getEffectiveConfig().
   */
  getActiveProfile(): AISettingsProfile;

  /**
   * Generate system prompt from current effective config.
   * Convenience: calls systemPromptGenerator with the right inputs.
   */
  generateSystemPrompt(): string;

  // ── Preview ──

  /** Send a test message using current effective config. */
  runPreviewTest(userMessage: string): Promise<string>;

  // ── Filesystem ──

  /** Bind a filesystem accessor for reading workspace-level config files. */
  setFileSystem(fs: IConfigFileSystem): void;

  /** Load (or reload) workspace overrides from filesystem. Call after setFileSystem(). */
  loadWorkspaceConfig(): Promise<void>;

  // ── Events ──

  /** Fires whenever the effective config changes (preset switch, override, field edit). */
  readonly onDidChangeConfig: Event<IUnifiedAIConfig>;

  /** Fires when a built-in preset is cloned on write (D.3). */
  readonly onDidCloneBuiltIn: Event<{ originalName: string; cloneName: string }>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Defaults
// ═══════════════════════════════════════════════════════════════════════════════

export const DEFAULT_UNIFIED_CONFIG: IUnifiedAIConfig = {
  persona: {
    name: 'Parallx AI',
    description: 'Your intelligent workspace assistant',
    avatarEmoji: 'avatar-brain',
  },
  chat: {
    systemPrompt: '', // generated at runtime from tone/focus/length
    systemPromptIsCustom: false,
    responseLength: 'adaptive',
    workspaceDescription: '', // empty = auto-generated from workspace digest
  },
  model: {
    chatModel: '',               // auto-select
    embeddingModel: 'nomic-embed-text',
    temperature: 0.7,
    maxTokens: 0,                // model default
    contextWindow: 0,            // model default
  },
  retrieval: {
    autoRag: true,
    ragTopK: 20,
    ragMaxPerSource: 5,
    ragTokenBudget: 0,         // 0 = auto (30% of model context window)
    ragScoreThreshold: 0.01,
    ragCosineThreshold: 0.20,
    ragDropoffRatio: 0,         // 0 = disabled — let the AI decide what's relevant
    contextBudget: {
      trimPriority: {
        systemPrompt: 3,
        ragContext: 2,
        history: 1,
        userMessage: 4,
      },
      minPercent: {
        systemPrompt: 5,
        ragContext: 0,
        history: 0,
        userMessage: 0,
      },
    },
  },
  suggestions: {
    tone: 'balanced',
    focusDomain: 'general',
    customFocusDescription: '',
    suggestionConfidenceThreshold: 0.65,
    suggestionsEnabled: true,
    maxPendingSuggestions: 5,
  },
  agent: {
    maxIterations: 10,
  },
  memory: {
    memoryEnabled: true,
    autoSummarize: true,
    evictionDays: 90,
  },
  indexing: {
    autoIndex: true,
    watchFiles: true,
    maxFileSize: 262144, // 256 KB
    excludePatterns: [],
  },
  tools: {
    enabledOverrides: {},
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// Migration Helpers
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Convert a legacy AISettingsProfile (M15) into a unified preset.
 * Fields that don't exist in the old profile are filled from defaults.
 */
export function fromLegacyProfile(profile: AISettingsProfile): IUnifiedPreset {
  return {
    id: profile.id,
    presetName: profile.presetName,
    isBuiltIn: profile.isBuiltIn,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
    config: {
      persona: {
        name: profile.persona.name,
        description: profile.persona.description,
        avatarEmoji: profile.persona.avatarEmoji,
      },
      chat: {
        systemPrompt: profile.chat.systemPrompt,
        systemPromptIsCustom: profile.chat.systemPromptIsCustom,
        responseLength: profile.chat.responseLength,
        workspaceDescription: '', // not present in legacy profiles
      },
      model: {
        chatModel: profile.model.defaultModel,
        embeddingModel: DEFAULT_UNIFIED_CONFIG.model.embeddingModel,
        temperature: profile.model.temperature,
        maxTokens: profile.model.maxTokens,
        contextWindow: profile.model.contextWindow,
      },
      retrieval: { ...DEFAULT_UNIFIED_CONFIG.retrieval },
      suggestions: {
        tone: profile.suggestions.tone,
        focusDomain: profile.suggestions.focusDomain,
        customFocusDescription: profile.suggestions.customFocusDescription,
        suggestionConfidenceThreshold: profile.suggestions.suggestionConfidenceThreshold,
        suggestionsEnabled: profile.suggestions.suggestionsEnabled,
        maxPendingSuggestions: profile.suggestions.maxPendingSuggestions,
      },
      agent: { ...DEFAULT_UNIFIED_CONFIG.agent },
      memory: { ...DEFAULT_UNIFIED_CONFIG.memory },
      indexing: { ...DEFAULT_UNIFIED_CONFIG.indexing },
      tools: { ...DEFAULT_UNIFIED_CONFIG.tools },
    },
  };
}

/**
 * Convert a legacy IParallxConfig (M11 config.json) into a sparse
 * workspace override. Only imports fields that config.json controls.
 */
export function fromLegacyParallxConfig(config: IParallxConfig): DeepPartial<IUnifiedAIConfig> {
  return {
    model: {
      chatModel: config.model.chat,
      embeddingModel: config.model.embedding,
      ...(config.model.contextLength != null ? { contextWindow: config.model.contextLength } : {}),
    },
    retrieval: {
      autoRag: config.agent.autoRag,
      ragTopK: config.agent.ragTopK,
      ragScoreThreshold: config.agent.ragScoreThreshold,
      // New fields not in legacy config — omit to use defaults
      contextBudget: {
        trimPriority: {
          systemPrompt: 3,
          ragContext: 2,
          history: 1,
          userMessage: 4,
        },
        minPercent: {
          systemPrompt: 5,
          ragContext: 0,
          history: 0,
          userMessage: 0,
        },
      },
    },
    agent: {
      maxIterations: config.agent.maxIterations,
    },
    indexing: {
      autoIndex: config.indexing.autoIndex,
      watchFiles: config.indexing.watchFiles,
      maxFileSize: config.indexing.maxFileSize,
      excludePatterns: [...config.indexing.excludePatterns],
    },
  };
}

/**
 * Convert a unified preset back to a legacy AISettingsProfile.
 * Used by the compatibility facade for consumers not yet migrated.
 */
export function tolegacyProfile(preset: IUnifiedPreset): AISettingsProfile {
  return {
    id: preset.id,
    presetName: preset.presetName,
    isBuiltIn: preset.isBuiltIn,
    createdAt: preset.createdAt,
    updatedAt: preset.updatedAt,
    persona: { ...preset.config.persona },
    chat: { ...preset.config.chat },
    model: {
      defaultModel: preset.config.model.chatModel,
      temperature: preset.config.model.temperature,
      maxTokens: preset.config.model.maxTokens,
      contextWindow: preset.config.model.contextWindow,
    },
    suggestions: { ...preset.config.suggestions },
  };
}
