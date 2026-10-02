// agentsSettings.ts — the Agents section in Settings.
//
// Everything about what the AI may do on its own is set here, owned by the
// Agents built-in like any other built-in owns its section:
//   Agents                   run in the background (the global pause)
//   Agents / Heartbeat       on, how often, how much it may do alone, and the
//                            finer thresholds
//   Agents / Routines        how often routines may interrupt you
//   Agents / Helpers         follow-ups, helper agents, remembered approvals
//   Agents / Where Results Go  which surfaces autonomous output may use
// Rows bind to the stores the runtime already reads (the autonomy flags, the
// unified AI config); nothing here is a second copy. Registration is
// idempotent so turning Agents off and on again never throws.

import { Emitter } from '../../platform/events.js';
import type { ISettingsRegistryService } from '../../services/settingsRegistryService.js';
import type { IUnifiedAIConfig, IUnifiedAIConfigService } from '../../aiSettings/unifiedConfigTypes.js';
import type { AgentAutonomyLevel } from '../../agent/agentTypes.js';
import { FLAG_PAUSED_GLOBAL, type AutonomyFeatureFlagsService } from '../../services/autonomyFeatureFlags.js';
import { registerAutonomyFlagSettings } from '../../services/autonomySettingsSchemas.js';

export const AGENTS_SETTINGS_GROUP = 'schema:Agents';

/** The autonomy level in words: what the settings row shows. Test seam. */
export const LEVEL_WORDS: Readonly<Record<AgentAutonomyLevel, string>> = {
  'manual': 'Ask before anything',
  'allow-readonly': 'Read on its own, ask before changes',
  'allow-safe-actions': 'Make safe changes, ask before risky ones',
  'allow-policy-actions': 'Do what its policy allows without asking',
};
const WORDS_TO_LEVEL = new Map(Object.entries(LEVEL_WORDS).map(([k, v]) => [v, k as AgentAutonomyLevel]));

interface IConfigRow {
  readonly key: string;
  readonly label: string;
  readonly category: string;
  readonly description: string;
  readonly type: 'boolean' | 'number' | 'enum';
  readonly default: unknown;
  readonly min?: number;
  readonly max?: number;
  readonly enumValues?: readonly string[];
  readonly read: (c: IUnifiedAIConfig) => unknown;
  readonly write: (v: unknown) => Record<string, unknown>;
}

const HEARTBEAT = 'Agents / Heartbeat';

const CONFIG_ROWS: readonly IConfigRow[] = [
  {
    key: 'agents.heartbeat.enabled', label: 'Heartbeat', category: HEARTBEAT, type: 'boolean', default: false,
    description: 'Let the agent look over your workspace now and then and suggest things. Its findings show up in Agents under Needs you.',
    read: (c) => c.heartbeat.enabled, write: (v) => ({ heartbeat: { enabled: v === true } }),
  },
  {
    key: 'agents.heartbeat.intervalMinutes', label: 'How Often (Minutes)', category: HEARTBEAT, type: 'number', default: 30, min: 5, max: 1440,
    description: 'Minutes between reviews. It also reacts sooner when files change.',
    read: (c) => Math.round(c.heartbeat.intervalMs / 60_000), write: (v) => ({ heartbeat: { intervalMs: Math.max(5, Number(v)) * 60_000 } }),
  },
  {
    key: 'agents.heartbeat.autonomy', label: 'What It May Do Alone', category: HEARTBEAT, type: 'enum',
    default: LEVEL_WORDS['allow-safe-actions'], enumValues: Object.values(LEVEL_WORDS),
    description: 'How far the heartbeat may act without asking you first.',
    read: (c) => LEVEL_WORDS[c.heartbeat.autonomy] ?? LEVEL_WORDS['allow-safe-actions'],
    write: (v) => ({ heartbeat: { autonomy: WORDS_TO_LEVEL.get(String(v)) ?? 'allow-safe-actions' } }),
  },
  {
    key: 'autonomy.heartbeat.senseExtensionSignals', label: 'Listen To Extensions', category: HEARTBEAT, type: 'boolean', default: true,
    description: 'Let extensions tell the heartbeat about things worth a look.',
    read: (c) => c.heartbeat.senseExtensionSignals, write: (v) => ({ heartbeat: { senseExtensionSignals: v === true } }),
  },
  {
    key: 'autonomy.heartbeat.triggerStallDays', label: 'Stalled Plan After (Days)', category: HEARTBEAT, type: 'number', default: 4, min: 1, max: 60,
    description: 'Days a plan step may sit untouched before the heartbeat files a follow-up.',
    read: (c) => c.heartbeat.triggerStallDays, write: (v) => ({ heartbeat: { triggerStallDays: Number(v) } }),
  },
  {
    key: 'autonomy.heartbeat.triggerReviewQueueSize', label: 'Review Queue Nudge At', category: HEARTBEAT, type: 'number', default: 5, min: 1, max: 100,
    description: 'Captured tasks waiting (the oldest 3 or more days old) before it nudges you to sort them.',
    read: (c) => c.heartbeat.triggerReviewQueueSize, write: (v) => ({ heartbeat: { triggerReviewQueueSize: Number(v) } }),
  },
  {
    key: 'autonomy.heartbeat.triggerOverdueDays', label: 'Overdue Follow-Up After (Days)', category: HEARTBEAT, type: 'number', default: 1, min: 1, max: 30,
    description: 'Days past due before it files a follow-up for a task that is still open.',
    read: (c) => c.heartbeat.triggerOverdueDays, write: (v) => ({ heartbeat: { triggerOverdueDays: Number(v) } }),
  },
  {
    key: 'autonomy.heartbeat.coalesceMs', label: 'Group File Changes (ms)', category: HEARTBEAT, type: 'number', default: 1500, min: 0, max: 60_000,
    description: 'Bursts of file changes inside this window count as one. 0 reacts to each change.',
    read: (c) => c.heartbeat.coalesceWindowMs, write: (v) => ({ heartbeat: { coalesceWindowMs: Number(v) } }),
  },
  {
    key: 'autonomy.heartbeat.dedupMs', label: 'Repeat Findings After (ms)', category: HEARTBEAT, type: 'number', default: 86_400_000, min: 0, max: 7 * 86_400_000,
    description: 'The same finding is not shown again inside this window.',
    read: (c) => c.heartbeat.outputDedupWindowMs, write: (v) => ({ heartbeat: { outputDedupWindowMs: Number(v) } }),
  },
];

export function registerAgentsSettings(
  registry: ISettingsRegistryService,
  flags: AutonomyFeatureFlagsService | undefined,
  unified: IUnifiedAIConfigService | undefined,
): void {
  // Run in the background: the global pause, said the right way round.
  if (flags && !registry.getSchema('agents.runInBackground')) {
    registry.register({
      key: 'agents.runInBackground',
      label: 'Run In The Background',
      type: 'boolean',
      default: true,
      scope: 'workspace',
      category: 'Agents',
      description: 'Let agents, the heartbeat and routines run on their own. Turn off to pause all of it; anything running stops after its current step.',
    });
    const changed = new Emitter<boolean>();
    flags.onDidChange((e) => { if (e.id === FLAG_PAUSED_GLOBAL) changed.fire(!e.value); });
    registry.bind<boolean>('agents.runInBackground', {
      getValue: () => !flags.isEnabled(FLAG_PAUSED_GLOBAL),
      setValue: (v) => flags.setEnabled(FLAG_PAUSED_GLOBAL, !v),
      onDidChange: changed.event,
    });
  }

  if (flags) registerAutonomyFlagSettings(registry, flags, 'agents');

  if (unified) {
    const emitters = new Map<string, Emitter<unknown>>();
    for (const row of CONFIG_ROWS) {
      if (registry.getSchema(row.key)) continue;
      registry.register({
        key: row.key,
        label: row.label,
        type: row.type,
        default: row.default,
        scope: 'workspace',
        category: row.category,
        description: row.description,
        ...(row.min !== undefined ? { min: row.min } : {}),
        ...(row.max !== undefined ? { max: row.max } : {}),
        ...(row.enumValues ? { enumValues: row.enumValues } : {}),
      });
      const em = new Emitter<unknown>();
      emitters.set(row.key, em);
      registry.bind(row.key, {
        getValue: () => row.read(unified.getEffectiveConfig()),
        setValue: async (v: unknown) => { await unified.updateActivePreset(row.write(v) as never); },
        onDidChange: em.event,
      });
    }
    if (emitters.size) {
      unified.onDidChangeConfig((c) => {
        for (const row of CONFIG_ROWS) emitters.get(row.key)?.fire(row.read(c));
      });
    }
  }

  // Routines: the attention budget the workflow arbiter reads lazily.
  if (!registry.getSchema('workflows.attentionInterruptionsPerDay')) {
    registry.register({
      key: 'workflows.attentionInterruptionsPerDay',
      label: 'Interruptions Per Day',
      type: 'number',
      default: 6,
      min: 0,
      max: 50,
      scope: 'workspace',
      category: 'Agents / Routines',
      description: 'How many times a day routines may interrupt you on their own. Held runs are kept in their history.',
    });
  }
}
