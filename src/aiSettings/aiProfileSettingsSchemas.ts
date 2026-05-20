// aiProfileSettingsSchemas.ts — M61 Phase 4 §B
//
// Registers every "AI profile" setting (persona, chat, model, suggestions,
// retrieval, indexing, agent, heartbeat) into ISettingsRegistryService and
// adapter-binds them to IUnifiedAIConfigService so the unified-overlay editor
// (`Ctrl+Alt+S` → `settings.open`) is the single UI for these values.
//
// All settings here are workspace-scoped. The audit (docs/SETTINGS_AUDIT.md)
// confirmed the underlying storage already lives in workspace state via
// UnifiedAIConfigService → IWorkspaceStorageService — so this file only
// adds schema/binding plumbing; no storage changes.

import { Emitter } from '../platform/events.js';
import type {
  ISettingsRegistryService,
  ISettingSchema,
  ISettingBinding,
} from '../services/settingsRegistryService.js';
import type { IUnifiedAIConfigService } from './unifiedConfigTypes.js';
import type { IUnifiedAIConfig } from './unifiedConfigTypes.js';
import type { DeepPartial } from './aiSettingsTypes.js';

// ─── Schema declarations ───────────────────────────────────────────────────
//
// Each entry pairs a schema with two functions:
//   read  : (cfg) → primitive value
//   write : (value) → DeepPartial patch for updateActivePreset
//
// Keep type/default/scope aligned with docs/SETTINGS_AUDIT.md §1.

interface IBoundSchema<T = unknown> {
  readonly schema: ISettingSchema;
  readonly read: (cfg: IUnifiedAIConfig) => T;
  readonly write: (value: T) => DeepPartial<IUnifiedAIConfig>;
}

const SCHEMAS: readonly IBoundSchema[] = ([
  // ── Persona ──
  {
    schema: {
      key: 'persona.name',
      type: 'string',
      default: 'Parallx AI',
      scope: 'workspace',
      description: 'Display name shown in the chat header and suggestion cards.',
      category: 'Persona',
    },
    read: (c) => c.persona.name,
    write: (v) => ({ persona: { name: v as string } }),
  } as IBoundSchema<string>,
  {
    schema: {
      key: 'persona.description',
      type: 'string',
      default: 'Your intelligent workspace assistant',
      scope: 'workspace',
      description: 'One-sentence description shown under the agent name.',
      category: 'Persona',
    },
    read: (c) => c.persona.description,
    write: (v) => ({ persona: { description: v as string } }),
  } as IBoundSchema<string>,
  {
    schema: {
      key: 'persona.avatar',
      type: 'string',
      default: 'avatar-brain',
      scope: 'workspace',
      description: 'Avatar icon ID (e.g. avatar-brain, avatar-coins, avatar-pen).',
      category: 'Persona',
    },
    read: (c) => c.persona.avatarEmoji,
    write: (v) => ({ persona: { avatarEmoji: v as string } }),
  } as IBoundSchema<string>,

  // ── Chat ──
  {
    schema: {
      key: 'chat.systemPrompt',
      type: 'multiline',
      default: '',
      scope: 'workspace',
      description: 'System prompt injected at the top of every chat. Empty = use the built-in default.',
      category: 'Chat',
      rows: 6,
    },
    read: (c) => c.chat.systemPrompt,
    write: (v) => ({ chat: { systemPrompt: v as string, systemPromptIsCustom: (v as string).length > 0 } }),
  } as IBoundSchema<string>,
  {
    schema: {
      key: 'chat.responseLength',
      type: 'enum',
      default: 'adaptive',
      scope: 'workspace',
      description: 'Preferred response length: short, medium, long, or adaptive (chooses based on the prompt).',
      category: 'Chat',
      enumValues: ['short', 'medium', 'long', 'adaptive'],
    },
    read: (c) => c.chat.responseLength,
    write: (v) => ({ chat: { responseLength: v as 'short' | 'medium' | 'long' | 'adaptive' } }),
  } as IBoundSchema<string>,

  // ── Model ──
  {
    schema: {
      key: 'model.temperature',
      type: 'number',
      default: 0.7,
      scope: 'workspace',
      description: 'Sampling temperature. 0 = deterministic, 1 = creative. Default 0.7.',
      category: 'Model',
      min: 0,
      max: 2,
    },
    read: (c) => c.model.temperature,
    write: (v) => ({ model: { temperature: v as number } }),
  } as IBoundSchema<number>,
  {
    schema: {
      key: 'model.maxTokens',
      type: 'number',
      default: 0,
      scope: 'workspace',
      description: 'Max tokens per response. 0 = no limit (use the model default).',
      category: 'Model',
      min: 0,
      max: 32000,
    },
    read: (c) => c.model.maxTokens,
    write: (v) => ({ model: { maxTokens: v as number } }),
  } as IBoundSchema<number>,

  // ── Suggestions ──
  {
    schema: {
      key: 'suggestions.enabled',
      type: 'boolean',
      default: true,
      scope: 'workspace',
      description: 'Show proactive suggestion cards in the chat panel.',
      category: 'Suggestions',
    },
    read: (c) => c.suggestions.suggestionsEnabled,
    write: (v) => ({ suggestions: { suggestionsEnabled: v as boolean } }),
  } as IBoundSchema<boolean>,
  {
    schema: {
      key: 'suggestions.tone',
      type: 'enum',
      default: 'balanced',
      scope: 'workspace',
      description: 'Tone the AI uses when crafting suggestions.',
      category: 'Suggestions',
      enumValues: ['concise', 'balanced', 'detailed'],
    },
    read: (c) => c.suggestions.tone,
    write: (v) => ({ suggestions: { tone: v as 'concise' | 'balanced' | 'detailed' } }),
  } as IBoundSchema<string>,
  {
    schema: {
      key: 'suggestions.focusDomain',
      type: 'enum',
      default: 'general',
      scope: 'workspace',
      description: 'Domain the AI pays extra attention to when generating suggestions.',
      category: 'Suggestions',
      enumValues: ['general', 'finance', 'writing', 'coding', 'research', 'custom'],
    },
    read: (c) => c.suggestions.focusDomain,
    write: (v) => ({ suggestions: { focusDomain: v as 'general' | 'finance' | 'writing' | 'coding' | 'research' | 'custom' } }),
  } as IBoundSchema<string>,
  {
    schema: {
      key: 'suggestions.customFocus',
      type: 'string',
      default: '',
      scope: 'workspace',
      description: 'Free-text description of the custom focus domain (used when focusDomain = custom).',
      category: 'Suggestions',
    },
    read: (c) => c.suggestions.customFocusDescription,
    write: (v) => ({ suggestions: { customFocusDescription: v as string } }),
  } as IBoundSchema<string>,
  {
    schema: {
      key: 'suggestions.confidenceThreshold',
      type: 'number',
      default: 0.65,
      scope: 'workspace',
      description: 'Minimum confidence (0–1) for a suggestion to surface.',
      category: 'Suggestions',
      min: 0,
      max: 1,
    },
    read: (c) => c.suggestions.suggestionConfidenceThreshold,
    write: (v) => ({ suggestions: { suggestionConfidenceThreshold: v as number } }),
  } as IBoundSchema<number>,
  {
    schema: {
      key: 'suggestions.maxPending',
      type: 'number',
      default: 5,
      scope: 'workspace',
      description: 'Max number of suggestion cards visible at once.',
      category: 'Suggestions',
      min: 1,
      max: 20,
    },
    read: (c) => c.suggestions.maxPendingSuggestions,
    write: (v) => ({ suggestions: { maxPendingSuggestions: v as number } }),
  } as IBoundSchema<number>,

  // ── Retrieval ──
  {
    schema: {
      key: 'retrieval.autoRag',
      type: 'boolean',
      default: true,
      scope: 'workspace',
      description: 'Run retrieval automatically on every chat turn.',
      category: 'Retrieval',
    },
    read: (c) => c.retrieval.autoRag,
    write: (v) => ({ retrieval: { autoRag: v as boolean } }),
  } as IBoundSchema<boolean>,
  {
    schema: {
      key: 'retrieval.ragTopK',
      type: 'number',
      default: 10,
      scope: 'workspace',
      description: 'Top-K chunks fetched for each retrieval.',
      category: 'Retrieval',
      min: 1,
      max: 50,
    },
    read: (c) => c.retrieval.ragTopK,
    write: (v) => ({ retrieval: { ragTopK: v as number } }),
  } as IBoundSchema<number>,
  {
    schema: {
      key: 'retrieval.scoreThreshold',
      type: 'number',
      default: 0.3,
      scope: 'workspace',
      description: 'Minimum RRF score for a chunk to be included.',
      category: 'Retrieval',
      min: 0,
      max: 1,
    },
    read: (c) => c.retrieval.ragScoreThreshold,
    write: (v) => ({ retrieval: { ragScoreThreshold: v as number } }),
  } as IBoundSchema<number>,

  // ── Indexing ──
  {
    schema: {
      key: 'indexing.autoIndex',
      type: 'boolean',
      default: true,
      scope: 'workspace',
      description: 'Index workspace files automatically when the workspace opens.',
      category: 'Indexing',
    },
    read: (c) => c.indexing.autoIndex,
    write: (v) => ({ indexing: { autoIndex: v as boolean } }),
  } as IBoundSchema<boolean>,
  {
    schema: {
      key: 'indexing.watchFiles',
      type: 'boolean',
      default: true,
      scope: 'workspace',
      description: 'Watch the workspace for file changes and re-index incrementally.',
      category: 'Indexing',
    },
    read: (c) => c.indexing.watchFiles,
    write: (v) => ({ indexing: { watchFiles: v as boolean } }),
  } as IBoundSchema<boolean>,
  {
    schema: {
      key: 'indexing.maxFileSize',
      type: 'number',
      default: 262144,
      scope: 'workspace',
      description: 'Max file size in bytes to index. 0 = no limit.',
      category: 'Indexing',
      min: 0,
      max: 50_000_000,
    },
    read: (c) => c.indexing.maxFileSize,
    write: (v) => ({ indexing: { maxFileSize: v as number } }),
  } as IBoundSchema<number>,

  // ── Agent ──
  {
    schema: {
      key: 'agent.maxIterations',
      type: 'number',
      default: 25,
      scope: 'workspace',
      description: 'Maximum tool-loop iterations per agent run before the runner refuses to continue.',
      category: 'Agent',
      min: 1,
      max: 50,
    },
    read: (c) => c.agent.maxIterations,
    write: (v) => ({ agent: { maxIterations: v as number } }),
  } as IBoundSchema<number>,

  // ── Tools (M70 App Command Control) ──
  {
    schema: {
      key: 'tools.workbenchControl',
      type: 'boolean',
      default: false,
      scope: 'workspace',
      description: 'Let the AI run Parallx app commands — switching themes, toggling views, opening panels, etc. When off, the underlying tools aren’t injected into the chat context at all.',
      category: 'Tools',
    },
    read: (c) => c.tools.workbenchControlEnabled,
    write: (v) => ({ tools: { workbenchControlEnabled: v as boolean } }),
  } as IBoundSchema<boolean>,

  // ── Heartbeat (extra knobs beyond intervalMs already registered) ──
  {
    schema: {
      key: 'autonomy.heartbeat.coalesceMs',
      type: 'number',
      default: 1500,
      scope: 'workspace',
      description: 'Coalesce window (ms) for bursty file-change events. 0 = fire each event immediately.',
      category: 'Autonomy',
      min: 0,
      max: 60_000,
    },
    read: (c) => c.heartbeat.coalesceWindowMs,
    write: (v) => ({ heartbeat: { coalesceWindowMs: v as number } }),
  } as IBoundSchema<number>,
  {
    schema: {
      key: 'autonomy.heartbeat.dedupMs',
      type: 'number',
      default: 86_400_000,
      scope: 'workspace',
      description: 'Output-dedup window (ms). Identical heartbeat outputs inside this window are dropped silently.',
      category: 'Autonomy',
      min: 0,
      max: 7 * 86_400_000,
    },
    read: (c) => c.heartbeat.outputDedupWindowMs,
    write: (v) => ({ heartbeat: { outputDedupWindowMs: v as number } }),
  } as IBoundSchema<number>,
] as readonly IBoundSchema<unknown>[]);

// ─── Registration ──────────────────────────────────────────────────────────

/**
 * Register all profile-shaped AI settings. Idempotent against duplicate
 * registration of independent keys, but throws if called twice for the
 * same registry instance (the registry rejects duplicate keys, by design).
 */
export function registerAIProfileSettings(
  registry: ISettingsRegistryService,
  unified: IUnifiedAIConfigService,
): void {
  // One emitter per key, fed by the unified service's onDidChangeConfig.
  // Each emitter fires whenever its specific value changes — keeps the
  // editor controls live without re-rendering the whole panel.
  const emitters = new Map<string, Emitter<unknown>>();
  let lastConfig: IUnifiedAIConfig = unified.getEffectiveConfig();

  for (const entry of SCHEMAS) {
    registry.register(entry.schema);
    const emitter = new Emitter<unknown>();
    emitters.set(entry.schema.key, emitter);

    const binding: ISettingBinding<unknown> = {
      getValue: () => entry.read(unified.getEffectiveConfig()),
      setValue: async (value: unknown) => {
        const patch = entry.write(value);
        await unified.updateActivePreset(patch);
      },
      onDidChange: emitter.event,
    };
    registry.bind(entry.schema.key, binding);
  }

  // Fan out unified → per-key emitters.
  unified.onDidChangeConfig(() => {
    const next = unified.getEffectiveConfig();
    for (const entry of SCHEMAS) {
      const before = entry.read(lastConfig);
      const after = entry.read(next);
      if (!_shallowEq(before, after)) {
        emitters.get(entry.schema.key)?.fire(after);
      }
    }
    lastConfig = next;
  });
}

// ─── Action-row helpers ────────────────────────────────────────────────────

export interface ISettingsActionDescriptor {
  readonly key: string;
  readonly category: string;
  readonly description: string;
  readonly actionLabel: string;
  readonly command: string;
}

/**
 * Register manager / export / import / reset action rows. The owning
 * extension (chat / mcp / etc.) provides the command implementation; this
 * helper only declares the schema entries so they show up in the editor.
 */
export function registerSettingsActions(
  registry: ISettingsRegistryService,
  actions: readonly ISettingsActionDescriptor[],
): void {
  for (const a of actions) {
    registry.register({
      key: a.key,
      type: 'action',
      default: null,
      scope: 'workspace',
      description: a.description,
      category: a.category,
      actionLabel: a.actionLabel,
      command: a.command,
    });
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function _shallowEq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return false;
  }
  // Arrays of primitives — quick check; keys covered here are flat enough.
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  return false;
}
