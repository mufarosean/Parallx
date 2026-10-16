// aiProfileSettingsSchemas.ts — M61 Phase 4 §B
//
// Registers every "AI profile" setting (time zone, model, retrieval, agent,
// tools, heartbeat) into ISettingsRegistryService and
// adapter-binds them to IUnifiedAIConfigService so the unified-overlay editor
// (`Ctrl+Alt+S` → `settings.open`) is the single UI for these values.
//
// All settings here are workspace-scoped. The audit (docs/archive/root-audits/SETTINGS_AUDIT.md)
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
import type { ChatThinkingView, IUnifiedAIConfig } from './unifiedConfigTypes.js';
import type { DeepPartial } from './aiSettingsTypes.js';

// ─── Schema declarations ───────────────────────────────────────────────────
//
// Each entry pairs a schema with two functions:
//   read  : (cfg) → primitive value
//   write : (value) → DeepPartial patch for updateConfig
//
// Keep type/default/scope aligned with docs/archive/root-audits/SETTINGS_AUDIT.md §1.

interface IBoundSchema<T = unknown> {
  readonly schema: ISettingSchema;
  readonly read: (cfg: IUnifiedAIConfig) => T;
  readonly write: (value: T) => DeepPartial<IUnifiedAIConfig>;
}

const SCHEMAS: readonly IBoundSchema[] = ([

  // ── General (app-wide, stored with the chat profile) ──
  {
    schema: {
      key: 'chat.timeZone',
      type: 'string',
      default: '',
      scope: 'workspace',
      // One zone for the whole app (the assistant, every tool's today, day
      // boundaries and date labels), so it lives with the general settings,
      // not under AI. The stored key keeps its historical `chat.` prefix so
      // nobody's value is lost; this is the only place it is edited.
      label: 'Time Zone',
      description: 'Empty uses this computer\'s zone. Set it if the computer reports the wrong one, using a name such as America/Chicago or Europe/London.',
      category: 'General',
    },
    read: (c) => c.chat.timeZone ?? '',
    write: (v) => ({ chat: { timeZone: String(v ?? '').trim() } }),
  } as IBoundSchema<string>,

  // ── Chat ──
  {
    schema: {
      key: 'chat.thinkingView',
      type: 'enum',
      default: 'auto',
      enumValues: ['auto', 'open', 'closed'],
      enumLabels: { auto: 'Open While Thinking', open: 'Always Open', closed: 'Always Closed' },
      scope: 'workspace',
      label: 'Thinking',
      description: 'How the Thinking section above a reply shows. Open While Thinking closes it once the reply moves on; you can always open or close it with a click.',
      category: 'Chat',
    },
    read: (c) => c.chat.thinkingView ?? 'auto',
    write: (v) => ({ chat: { thinkingView: (['auto', 'open', 'closed'].includes(String(v)) ? v : 'auto') as ChatThinkingView } }),
  } as IBoundSchema<string>,

  // ── Model ──
  {
    schema: {
      key: 'model.defaultModel',
      type: 'string',
      default: '',
      scope: 'workspace',
      description: 'Default model for new chat sessions in this workspace (e.g. `qwen2.5:7b-instruct`). When set, this wins over the last-used model on startup, so background jobs (cron, budget) can\'t hijack the chat picker. Empty = use whichever model Ollama returns first.',
      category: 'Model',
    },
    read: (c) => c.model.chatModel,
    write: (v) => ({ model: { chatModel: v as string } }),
  } as IBoundSchema<string>,
  {
    schema: {
      key: 'model.contextSize',
      type: 'number',
      default: 0,
      scope: 'workspace',
      description: 'Default context window (num_ctx) for new chat sessions in this workspace. 0 = use the model\'s reported context length. Override per-session with the context-window picker in the chat header.',
      category: 'Model',
      min: 0,
      max: 1_000_000,
    },
    read: (c) => c.model.contextWindow,
    write: (v) => ({ model: { contextWindow: v as number } }),
  } as IBoundSchema<number>,
  {
    schema: {
      key: 'model.temperature',
      type: 'number',
      default: -1,
      scope: 'workspace',
      description: 'Sampling temperature. -1 = use the model default (recommended, lets each model use its own tuned value). 0 to 2 sets an explicit override.',
      category: 'Model',
      min: -1,
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
      key: 'retrieval.standingContextLate',
      type: 'boolean',
      default: true,
      scope: 'workspace',
      description: 'Place the standing-context block (plan, retrieved content, memories) after conversation history, just before your message. Keeps long chats fast (stable cache prefix) and retrieved content closest to the question. Turn off to restore the old position before history.',
      category: 'Retrieval',
    },
    read: (c) => c.retrieval.standingContextLate,
    write: (v) => ({ retrieval: { standingContextLate: v as boolean } }),
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

  // ── Tools ──
  {
    schema: {
      key: 'tools.workbenchControl',
      type: 'boolean',
      default: false,
      scope: 'workspace',
      description: 'Let the AI run Parallx app commands: switching themes, toggling views, opening panels, etc. When off, the underlying tools aren’t injected into the chat context at all.',
      category: 'Tools',
    },
    read: (c) => c.tools.workbenchControlEnabled,
    write: (v) => ({ tools: { workbenchControlEnabled: v as boolean } }),
  } as IBoundSchema<boolean>,

  // (The heartbeat rows moved to Settings › Agents: built-in/agents/agentsSettings.ts.)
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
        await unified.updateConfig(patch);
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
