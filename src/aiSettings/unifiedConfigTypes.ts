// unifiedConfigTypes.ts — Unified AI Configuration types
//
// Merges all AI configuration from three sources into one type system:
//   1. AISettingsProfile — chat, model
//   2. IParallxConfig — retrieval, agent, context budget, indexing
//   3. NEW — memory settings
//
// Consumer code imports unified types from this file.
// The legacy types (AISettingsProfile, IParallxConfig) remain for migration.

import type { IDisposable } from '../platform/lifecycle.js';
import type { Event } from '../platform/events.js';
import type { AISettingsProfile, DeepPartial } from './aiSettingsTypes.js';
import type { IParallxConfig } from '../services/parallxConfigService.js';
import type { IConfigFileSystem } from '../services/parallxConfigService.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Unified Configuration Shape
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Behavior ──────────────────────────────────────

export interface IUnifiedChatConfig {
  /**
   * The one zone every time the assistant reads or writes is in (an IANA
   * name such as America/Chicago). Empty: this computer's zone. Resolved by
   * services/localTime.ts; the prompt, the journal and tool results all
   * stamp in it, and never in UTC.
   */
  readonly timeZone: string;
}

// ─── Model (merged from M15 + config.json) ──────────────────────────────────

export interface IUnifiedModelConfig {
  /** The workspace's default chat model ('' = auto-select). */
  readonly chatModel: string;
  /** -1 = use the model default (not sent); 0.0 = deterministic, 2.0 = most random */
  readonly temperature: number;
  /** Max tokens per response (0 = model default) */
  readonly maxTokens: number;
  /** Context size sent to Ollama as num_ctx (0 = the chat's own or last size). */
  readonly contextWindow: number;
}

// ─── Retrieval (from config.json — newly surfaced in UI) ─────────────────────

export interface IUnifiedRetrievalConfig {
  /** @parallx-specific No upstream OpenClaw equivalent. Upstream context engine always runs if registered. Desktop toggle to disable RAG when workspace is empty. */
  readonly autoRag: boolean;
  /**
   * HARNESS.md §3.4 — place the standing-context block (plan, retrieved
   * content, memories) AFTER conversation history, immediately before the
   * user's message. Frontier pattern (reminders ride near the end): the
   * per-turn-changing block no longer invalidates the KV-cache/prompt-cache
   * prefix for the whole history, and retrieved content sits closest to the
   * question. Off restores the pre-M103 position (block before history).
   */
  readonly standingContextLate: boolean;
  /** Upstream: memorySearch.query.maxResults. Controls retrievalService top-K. */
  readonly ragTopK: number;
  /** Upstream: memorySearch.query.minScore. RRF noise floor for retrievalService. */
  readonly ragScoreThreshold: number;
}

// ─── Agent (from config.json) ────────────────────────────────────────────────

export const AGENT_VERBOSITY_OPTIONS = ['concise', 'balanced', 'detailed'] as const;
export type AgentVerbosityPreference = typeof AGENT_VERBOSITY_OPTIONS[number];

export const AGENT_APPROVAL_STRICTNESS_OPTIONS = ['strict', 'balanced', 'streamlined'] as const;
export type AgentApprovalStrictness = typeof AGENT_APPROVAL_STRICTNESS_OPTIONS[number];

export const AGENT_EXECUTION_STYLE_OPTIONS = ['stepwise', 'balanced', 'batch'] as const;
export type AgentExecutionStylePreference = typeof AGENT_EXECUTION_STYLE_OPTIONS[number];

export const AGENT_PROACTIVITY_OPTIONS = ['low', 'balanced', 'high'] as const;
export type AgentProactivityPreference = typeof AGENT_PROACTIVITY_OPTIONS[number];

/** Serializable agent definition for persistence in unified config.
 *  Mirrors IAgentConfig from openclawAgentConfig.ts without circular import. */
export interface IAgentConfigData {
  readonly id: string;
  readonly name: string;
  readonly isDefault?: boolean;
  readonly surface?: 'default' | 'workspace' | 'canvas';
  readonly model?: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly maxIterations?: number;
  readonly autoRag?: boolean;
  readonly systemPromptOverlay?: string;
  readonly identity?: { readonly name?: string; readonly theme?: string; readonly emoji?: string };
  readonly tools?: { readonly allow?: readonly string[]; readonly deny?: readonly string[] };
}

export interface IUnifiedAgentConfig {
  /** @parallx-specific Upstream hardcodes MAX_RUN_LOOP_ITERATIONS = 24 + 8/profile. Parallx exposes as user setting (default 25, ceiling 50). */
  readonly maxIterations: number;
  /** @deprecated F11: No OpenClaw consumer. */
  readonly verbosity: AgentVerbosityPreference;
  /** @deprecated F11: No OpenClaw consumer. */
  readonly approvalStrictness: AgentApprovalStrictness;
  /** @deprecated F11: No OpenClaw consumer. */
  readonly executionStyle: AgentExecutionStylePreference;
  /** @deprecated F11: No OpenClaw consumer. */
  readonly proactivity: AgentProactivityPreference;
  /** User-defined agent configurations. Merged with DEFAULT_AGENT_CONFIGS on load.
   *  Upstream: AgentsConfig.list (src/config/types.agents.ts:89-101) */
  readonly agentDefinitions?: readonly IAgentConfigData[];
}

export interface IUnifiedRuntimeConfig {
  /** Active chat runtime implementation used for the default chat surface. */
  readonly implementation: 'openclaw';
}

// ─── Memory (NEW in M20) ─────────────────────────────────────────────────────

export interface IUnifiedMemoryConfig {
  /** Whether automatic memory creation is enabled */
  readonly memoryEnabled: boolean;
  /** Whether canonical session transcripts are indexed for explicit transcript recall. */
  readonly transcriptIndexingEnabled: boolean;
}

// ─── Tool Overrides ────────────────────────────────────────────────

export interface IUnifiedToolsConfig {
  /**
   * M70 App Command Control — opt-in for the `app__find_commands` and
   * `app__run_command` tools that let the AI act on the workbench command
   * palette. Defaults to `false`; when off, the two tool schemas are NOT
   * injected into the chat context (zero context window footprint).
   */
  readonly workbenchControlEnabled: boolean;
}

// ─── Heartbeat ──────────────────────────────────────────────────────

/**
 * All allowed heartbeat trigger reasons. Mirrors
 * {@link `src/openclaw/openclawHeartbeatRunner.ts`.HeartbeatReason} but kept
 * as a separate config-facing union so the settings layer doesn't reach into
 * openclaw/.
 */
export const HEARTBEAT_REASON_OPTIONS = ['interval', 'system-event', 'cron', 'wake', 'hook'] as const;
export type HeartbeatReasonKey = typeof HEARTBEAT_REASON_OPTIONS[number];

/**
 * Configuration for the proactive heartbeat loop.
 *
 * Safety defaults (non-negotiable per M58 plan §5 "Critical safety defaults"):
 *   - `enabled: false` — heartbeat ships OFF; user must opt in explicitly
 *   - `intervalMs: 5 min` — clamped at runtime to `MIN/MAX_HEARTBEAT_INTERVAL_MS`
 *   - `reasons`: allow all 5 by default; user can narrow the allowlist
 *
 * Upstream analog: heartbeat agent state + user-facing `heartbeat.md` controls.
 */
export interface IUnifiedHeartbeatConfig {
  /** Master switch. Default `false`. */
  readonly enabled: boolean;
  /** Tick interval in ms. Runtime-clamped to [30s, 1h]. */
  readonly intervalMs: number;
  /** Reason allowlist. Reasons not in this set are silently ignored. */
  readonly reasons: readonly HeartbeatReasonKey[];
  /**
   * File-change events only wake the heartbeat when the changed path ends
   * with one of these extensions (leading dot required, lowercase). Empty
   * array = no extension filter. Applied to `file-change` events only;
   * `index-complete` and `workspace-change` events bypass this list.
   */
  readonly watchIncludeExtensions: readonly string[];
  /**
   * File-change events are dropped if the changed path matches any of
   * these minimal globs. Supports `**` (any path segments), `*` (any chars
   * except `/`), `?` (single char). Applied to `file-change` events only.
   */
  readonly watchExcludeGlobs: readonly string[];
  /**
   * Burst-coalescing window in ms for `file-change` events. Multiple
   * events arriving within this window collapse to one heartbeat turn
   * with all events in the seed. `0` = disabled (each event fires
   * immediately, legacy behavior).
   */
  readonly coalesceWindowMs: number;
  /**
   * Output-dedup window in ms. If the heartbeat produces a final text
   * whose normalized form was already delivered in this window, the
   * delivery is dropped silently. Mirrors upstream OpenClaw
   * `isDuplicateMain` (24h window). `0` = disabled.
   */
  readonly outputDedupWindowMs: number;
  /**
   * Autonomy level applied to heartbeat-originated tool calls. Mirrors the
   * `AgentAutonomyLevel` enum from `src/agent/agentTypes.ts`.
   *
   *   - `manual`               -> heartbeat tool calls blocked outright
   *   - `allow-readonly`       -> only always-allowed tools run; others queue in autonomy log
   *   - `allow-safe-actions`   -> requires-approval tools queue in autonomy log (default)
   *   - `allow-policy-actions` -> requires-approval tools auto-approve
   *
   * Heartbeat never opens a UI approval modal regardless of level.
   */
  readonly autonomy: import('../agent/agentTypes.js').AgentAutonomyLevel;
  /**
   * Sense toggles — which app-wide signals the heartbeat reviews. Default on.
   *   - `senseExtensionSignals`: forward `api.autonomy.signal(...)` events from
   *     extensions onto the heartbeat queue.
   * (File-change sensing is governed by `watchIncludeExtensions` / `watchExcludeGlobs`.)
   */
  readonly senseExtensionSignals: boolean;
  /**
   * M87 deterministic triggers (docs/Parallx_Milestone_87.md §4) — thresholds
   * for the model-free fact→finding rules.
   */
  /** UC1: days an active plan step may sit untouched before a nudge. */
  readonly triggerStallDays: number;
  /** UC2: review-queue size that warrants a triage nudge. */
  readonly triggerReviewQueueSize: number;
  /** UC3: days past due before an overdue follow-up. */
  readonly triggerOverdueDays: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// The Full Unified Config
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Complete unified AI configuration — the merged result of the global
 * settings + workspace overrides. This is what consumers read at runtime.
 */
export interface IUnifiedAIConfig {
  readonly chat: IUnifiedChatConfig;
  readonly model: IUnifiedModelConfig;
  readonly retrieval: IUnifiedRetrievalConfig;
  readonly agent: IUnifiedAgentConfig;
  readonly runtime: IUnifiedRuntimeConfig;
  readonly memory: IUnifiedMemoryConfig;
  readonly tools: IUnifiedToolsConfig;
  /** Heartbeat / proactive tick config. */
  readonly heartbeat: IUnifiedHeartbeatConfig;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Workspace Override
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Sparse patch stored per-workspace in `.parallx/ai-config.json`.
 * Only fields present here override the global settings.
 */
export interface IWorkspaceAIOverride {
  /** Sparse partial config — only overridden fields */
  readonly overrides: DeepPartial<IUnifiedAIConfig>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Service Interface
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Unified AI Configuration Service.
 *
 * Replaces both AISettingsService and ParallxConfigService
 * with a single source of truth. Provides:
 *   - The global AI settings
 *   - Workspace override layer (sparse patch per-workspace)
 *   - Merged effective config (global settings + workspace override)
 *   - Change events for all consumers
 *
 * Config resolution: built-in defaults → global settings → workspace override
 */
export interface IUnifiedAIConfigService extends IDisposable {
  // ── Effective Config ──

  /** Get the fully merged config (global settings + workspace overrides). */
  getEffectiveConfig(): IUnifiedAIConfig;

  // ── Global Settings ──

  /** Update the global AI settings with a sparse patch. */
  updateConfig(patch: DeepPartial<IUnifiedAIConfig>): Promise<void>;

  /** Reset a section to factory defaults. */
  resetSection(section: keyof IUnifiedAIConfig): Promise<void>;

  /** Reset all global AI settings to factory defaults. */
  resetAll(): Promise<void>;

  // ── Workspace Override ──

  /** Get current workspace override (sparse patch). */
  getWorkspaceOverride(): IWorkspaceAIOverride | undefined;

  /** Update workspace override with a sparse patch. */
  updateWorkspaceOverride(patch: DeepPartial<IUnifiedAIConfig>): Promise<void>;

  /** Clear one field or all workspace overrides. */
  clearWorkspaceOverride(path?: string): Promise<void>;

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

  // ── Filesystem ──

  /** Bind a filesystem accessor for reading workspace-level config files. */
  setFileSystem(fs: IConfigFileSystem): void;

  /** Load (or reload) workspace overrides from filesystem. Call after setFileSystem(). */
  loadWorkspaceConfig(): Promise<void>;

  // ── Events ──

  /** Fires whenever the effective config changes (a field edit or a workspace override). */
  readonly onDidChangeConfig: Event<IUnifiedAIConfig>;

  /**
   * Fires when workspace overrides are (re)loaded from disk — i.e. hydration,
   * not a user edit. Fired BEFORE the accompanying onDidChangeConfig so
   * listeners can re-establish a baseline and not mistake a saved override
   * loaded on startup for a fresh save.
   */
  readonly onDidLoadWorkspaceConfig: Event<void>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Defaults
// ═══════════════════════════════════════════════════════════════════════════════

export const DEFAULT_UNIFIED_CONFIG: IUnifiedAIConfig = {
  chat: {
    timeZone: '',                // this computer's zone
  },
  model: {
    chatModel: '',               // auto-select
    temperature: -1,             // model default
    maxTokens: 0,                // model default
    contextWindow: 0,            // model default
  },
  retrieval: {
    autoRag: true,
    standingContextLate: true,
    ragTopK: 20,
    ragScoreThreshold: 0.01,
  },
  agent: {
    maxIterations: 25,
    verbosity: 'balanced',
    approvalStrictness: 'balanced',
    executionStyle: 'balanced',
    proactivity: 'balanced',
    agentDefinitions: [],
  },
  runtime: {
    implementation: 'openclaw',
  },
  memory: {
    memoryEnabled: true,
    transcriptIndexingEnabled: false,
  },
  tools: {
    workbenchControlEnabled: false, // ships OFF; user opts in explicitly
  },
  heartbeat: {
    enabled: false, // non-negotiable default — user opts in explicitly
    // 30 min: the interval now runs a REAL periodic app-awareness review (not a
    // status flash), so the cadence matches OpenClaw's default rather than the
    // old 5-min reflex. Runtime-clamped to [15s, 1h]; user-configurable.
    intervalMs: 30 * 60 * 1000,
    reasons: [...HEARTBEAT_REASON_OPTIONS], // allow all 5 by default
    watchIncludeExtensions: [
      // Source
      '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
      '.py', '.rs', '.go', '.java', '.c', '.cpp', '.h', '.hpp', '.cs',
      '.rb', '.php', '.swift', '.kt',
      // Text
      '.md', '.mdx', '.txt',
      // Config
      '.json', '.yaml', '.yml', '.toml', '.xml', '.html', '.css', '.scss',
    ],
    watchExcludeGlobs: [
      // Parallx's own internal workspace state — workspace-state/storage JSON,
      // the memory store + daily logs, the search index, etc. These churn from
      // routine housekeeping (and the heartbeat's OWN memory writes), so watching
      // them is pure noise and risks the heartbeat self-triggering on its work.
      '**/.parallx/**',
      '**/node_modules/**',
      '**/.git/**',
      '**/dist/**',
      '**/build/**',
      '**/out/**',
      '**/.next/**',
      '**/target/**',
      '**/*.log',
    ],
    coalesceWindowMs: 2000,           // 2s burst window
    outputDedupWindowMs: 24 * 60 * 60 * 1000, // 24h (OpenClaw parity)
    autonomy: 'allow-safe-actions',
    senseExtensionSignals: true,
    // M87 deterministic-trigger thresholds (approved defaults).
    triggerStallDays: 4,
    triggerReviewQueueSize: 5,
    triggerOverdueDays: 1,
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// Migration Helpers
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Convert a legacy IParallxConfig into a sparse
 * workspace override. Only imports fields that config.json controls.
 */
export function fromLegacyParallxConfig(config: IParallxConfig): DeepPartial<IUnifiedAIConfig> {
  return {
    model: {
      chatModel: config.model.chat,
      ...(config.model.contextLength != null ? { contextWindow: config.model.contextLength } : {}),
    },
    retrieval: {
      autoRag: config.agent.autoRag,
      ragTopK: config.agent.ragTopK,
      ragScoreThreshold: config.agent.ragScoreThreshold,
    },
    agent: {
      maxIterations: config.agent.maxIterations,
    },
  };
}

/**
 * Convert a unified config to a legacy AISettingsProfile.
 * Used by the compatibility facade for consumers not yet migrated.
 */
export function tolegacyProfile(config: IUnifiedAIConfig): AISettingsProfile {
  return {
    chat: { ...config.chat },
    model: {
      defaultModel: config.model.chatModel,
      temperature: config.model.temperature,
      maxTokens: config.model.maxTokens,
      contextWindow: config.model.contextWindow,
    },
  };
}
