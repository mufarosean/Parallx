// autonomySettingsSchemas.ts — M60 Phase ε §7 T4.D1
//
// Helpers that register autonomy-related schemas into the
// SettingsRegistryService and adapter-bind them to existing flat stores
// (AutonomyFeatureFlagsService for the 11 boolean flags).
//
// Co-located in src/services/ because two built-ins register from it: the
// Agents built-in its own flags (Settings › Agents), Chat the canvas and
// indexing ones. built-in/settings/ owns the editor view.

import {
  AUTONOMY_FLAG_DEFAULTS,
  type AutonomyFlagId,
  type IAutonomyFeatureFlagsService,
} from './autonomyFeatureFlags.js';
import type { ISettingsRegistryService } from './settingsRegistryService.js';
import { Emitter } from '../platform/events.js';

// ─── Per-flag descriptions ─────────────────────────────────────────────────
//
// Mirrors M60 §3.8 rationale column. Editor surfaces this verbatim.

const FLAG_DESCRIPTIONS: Readonly<Record<AutonomyFlagId, string>> = Object.freeze({
  'autonomy.followup.enabled':
    'Let Chat take one more turn on its own when its answer says there is more to do.',
  'autonomy.surface.chat.enabled':
    'Agents may post their results into Chat.',
  'autonomy.surface.notification.enabled':
    'Agents may show a notification when they finish something.',
  'autonomy.surface.statusbar.enabled':
    'Agents may show what they are doing in the status bar.',
  'autonomy.surface.canvas.enabled':
    'Agents may write their results onto canvas pages.',
  'autonomy.surface.filesystem.enabled':
    'Agents may write their results to files in the workspace.',
  'autonomy.heartbeat.enabled':
    'Retired: the heartbeat is turned on and off in Agents › Heartbeat.',
  'autonomy.cron.enabled':
    'Let scheduled jobs run on their schedule. Routines built as workflows run whenever agents may run in the background.',
  'autonomy.subagent.enabled':
    'Let an agent start helper agents for parts of a task. Each one still asks before acting unless you remembered its approval.',
  'canvas.blockIds.enabled':
    'Stamp every canvas block with a stable unique ID for cross-block references. Default on; toggle off only for emergency rollback.',
  'canvas.dataview.enabled':
    'Render dataview blocks (live property-filtered page lists) inside canvas pages. Default on; toggle off only for emergency rollback.',
  'autonomy.paused.global':
    'Pause everything agents do on their own. Shown in Settings as Run In The Background.',
  'autonomy.rail.enabled':
    'Retired: nothing reads this.',
  'autonomy.patternMemory.enabled':
    'When you approve a helper agent and choose to remember it, don\u2019t ask again for the same kind of work.',
  'indexing.lazyMtime.enabled':
    'Use page mtime fast-skip during workspace re-open. Avoids re-hashing pages whose `updated_at` predates the persisted `indexed_at` timestamp. Default on (M60 §6 B5).',
  'indexing.worker.enabled':
    'Run embedding generation inside a Web Worker so the renderer thread stays responsive during bulk indexing. Default off; bake before flipping (M60 §3.8 line 188, §6 B3).',
});

const FLAG_LABELS: Readonly<Partial<Record<AutonomyFlagId, string>>> = Object.freeze({
  'autonomy.followup.enabled': 'Follow-Ups In Chat',
  'autonomy.surface.chat.enabled': 'Chat',
  'autonomy.surface.notification.enabled': 'Notifications',
  'autonomy.surface.statusbar.enabled': 'Status Bar',
  'autonomy.surface.canvas.enabled': 'Canvas Pages',
  'autonomy.surface.filesystem.enabled': 'Files',
  'autonomy.cron.enabled': 'Scheduled Jobs',
  'autonomy.subagent.enabled': 'Helper Agents',
  'autonomy.patternMemory.enabled': 'Remember Approvals',
});

const FLAG_CATEGORY: Readonly<Record<AutonomyFlagId, string>> = Object.freeze({
  'autonomy.followup.enabled': 'Agents / Helpers',
  'autonomy.surface.chat.enabled': 'Agents / Where Results Go',
  'autonomy.surface.notification.enabled': 'Agents / Where Results Go',
  'autonomy.surface.statusbar.enabled': 'Agents / Where Results Go',
  'autonomy.surface.canvas.enabled': 'Agents / Where Results Go',
  'autonomy.surface.filesystem.enabled': 'Agents / Where Results Go',
  'autonomy.heartbeat.enabled': 'Agents',
  'autonomy.cron.enabled': 'Agents / Routines',
  'autonomy.subagent.enabled': 'Agents / Helpers',
  'canvas.blockIds.enabled': 'Canvas',
  'canvas.dataview.enabled': 'Canvas',
  'autonomy.paused.global': 'Agents',
  'autonomy.rail.enabled': 'Agents',
  'autonomy.patternMemory.enabled': 'Agents / Helpers',
  'indexing.lazyMtime.enabled': 'Indexing',
  'indexing.worker.enabled': 'Indexing',
});

/** Flags with no settings row: retired ones nothing reads, and the pause,
 *  which Agents shows the right way round as Run In The Background. */
const NO_ROW: ReadonlySet<AutonomyFlagId> = new Set<AutonomyFlagId>([
  'autonomy.heartbeat.enabled',
  'autonomy.rail.enabled',
  'autonomy.paused.global',
]);

// NOTE: the non-flag autonomy settings the runtime ACTUALLY reads (heartbeat
// cadence/reasons, autonomy level, the per-sense toggles) live in the unified AI
// config — the single source of truth (see aiProfileSettingsSchemas.ts). The old
// `autonomy.*` substrate schemas here (heartbeat.intervalMs, followup.maxDepth,
// subagent.approvalMode, cron.persistencePath) were registered but read by NO
// runtime consumer — settings that did nothing — so they were removed rather than
// leave knobs wired to nothing.

// ─── Registration helpers ──────────────────────────────────────────────────

/**
 * Register the boolean flags into the registry and adapter-bind them to the
 * AutonomyFeatureFlagsService (the single source of truth; the registry is a
 * schema + change-event facade for the editor). `which` splits ownership:
 * the Agents built-in registers its own ('agents'), Chat the rest
 * ('other': canvas and indexing). Already-registered keys are skipped, so a
 * built-in that is turned off and on again never throws.
 */
export function registerAutonomyFlagSettings(
  registry: ISettingsRegistryService,
  flags: IAutonomyFeatureFlagsService,
  which: 'agents' | 'other' = 'other',
): void {
  for (const id of Object.keys(AUTONOMY_FLAG_DEFAULTS) as AutonomyFlagId[]) {
    if (NO_ROW.has(id)) continue;
    const isAgents = FLAG_CATEGORY[id].startsWith('Agents');
    if ((which === 'agents') !== isAgents) continue;
    if (registry.getSchema(id)) continue;
    registry.register({
      key: id,
      type: 'boolean',
      default: AUTONOMY_FLAG_DEFAULTS[id],
      scope: 'workspace',
      description: FLAG_DESCRIPTIONS[id],
      category: FLAG_CATEGORY[id],
      ...(FLAG_LABELS[id] ? { label: FLAG_LABELS[id] } : {}),
    });

    // Adapter-bind so editor reads/writes flow through the existing service.
    // Mirror flags-service onDidChange (filtered) → registry change events.
    const localEmitter = new Emitter<boolean>();
    flags.onDidChange((e) => {
      if (e.id === id) localEmitter.fire(e.value);
    });

    registry.bind<boolean>(id, {
      getValue: () => flags.isEnabled(id),
      setValue: (value: boolean) => flags.setEnabled(id, value),
      onDidChange: localEmitter.event,
    });
  }
}
