// autonomySettingsSchemas.ts — M60 Phase ε §7 T4.D1
//
// Helpers that register autonomy-related schemas into the
// SettingsRegistryService and adapter-bind them to existing flat stores
// (AutonomyFeatureFlagsService for the 11 boolean flags).
//
// Co-located in src/services/ rather than built-in/settings/ because the
// chat extension owns the autonomy services and is responsible for
// registering them; built-in/settings/ owns the editor view.

import {
  AUTONOMY_FLAG_DEFAULTS,
  type AutonomyFlagId,
  type IAutonomyFeatureFlagsService,
} from './autonomyFeatureFlags.js';
import type { ISettingsRegistryService, ISettingSchema } from './settingsRegistryService.js';
import { Emitter } from '../platform/events.js';

// ─── Per-flag descriptions ─────────────────────────────────────────────────
//
// Mirrors M60 §3.8 rationale column. Editor surfaces this verbatim.

const FLAG_DESCRIPTIONS: Readonly<Record<AutonomyFlagId, string>> = Object.freeze({
  'autonomy.followup.enabled':
    'Allow the agent to fire a follow-up turn after a user message when the response signals more work is needed. Lowest-risk autonomy.',
  'autonomy.surface.chat.enabled':
    'Allow autonomous-turn output to be routed to the chat panel.',
  'autonomy.surface.notification.enabled':
    'Allow autonomous-turn output to fire toast notifications.',
  'autonomy.surface.statusbar.enabled':
    'Allow autonomous-turn output to update the status bar.',
  'autonomy.surface.canvas.enabled':
    'Allow autonomous-turn output to land on canvas pages. Off until C3 dogfood completes.',
  'autonomy.surface.filesystem.enabled':
    'Allow autonomous-turn output to write to the filesystem. Off until C3 dogfood completes.',
  'autonomy.heartbeat.enabled':
    'Allow background heartbeat ticks to wake the agent. Off until 1 week of clean dogfood (M60 §3.8).',
  'autonomy.cron.enabled':
    'Allow scheduled cron jobs to fire autonomous turns. Off until heartbeat is proven (depends on heartbeat).',
  'autonomy.subagent.enabled':
    'Allow the default participant to spawn sub-agents. Off until autonomy eval ≥10/12 for 5 runs (highest blast radius).',
  'canvas.blockIds.enabled':
    'Stamp every canvas block with a stable unique ID for cross-block references. Default on; toggle off only for emergency rollback.',
  'canvas.dataview.enabled':
    'Render dataview blocks (live property-filtered page lists) inside canvas pages. Default on; toggle off only for emergency rollback.',
  'autonomy.paused.global':
    'Global autonomy pause. When on, every autonomous trigger (followup, heartbeat, cron, sub-agent) is gated regardless of its individual flag. Survives reload (M60 §8 E2).',
  'autonomy.rail.enabled':
    'Show the Autonomy Rail panel. Default on; toggle off to hide the rail UI without disabling autonomy itself.',
  'autonomy.patternMemory.enabled':
    'Allow remembering "approve this pattern" decisions for sub-agent spawns. When off, every spawn requires a fresh approval (M60 §8 E3).',
  'indexing.lazyMtime.enabled':
    'Use page mtime fast-skip during workspace re-open. Avoids re-hashing pages whose `updated_at` predates the persisted `indexed_at` timestamp. Default on (M60 §6 B5).',
  'indexing.worker.enabled':
    'Run embedding generation inside a Web Worker so the renderer thread stays responsive during bulk indexing. Default off; bake before flipping (M60 §3.8 line 188, §6 B3).',
});

const FLAG_CATEGORY: Readonly<Record<AutonomyFlagId, string>> = Object.freeze({
  'autonomy.followup.enabled': 'Autonomy',
  'autonomy.surface.chat.enabled': 'Autonomy / Surfaces',
  'autonomy.surface.notification.enabled': 'Autonomy / Surfaces',
  'autonomy.surface.statusbar.enabled': 'Autonomy / Surfaces',
  'autonomy.surface.canvas.enabled': 'Autonomy / Surfaces',
  'autonomy.surface.filesystem.enabled': 'Autonomy / Surfaces',
  'autonomy.heartbeat.enabled': 'Autonomy',
  'autonomy.cron.enabled': 'Autonomy',
  'autonomy.subagent.enabled': 'Autonomy',
  'canvas.blockIds.enabled': 'Canvas',
  'canvas.dataview.enabled': 'Canvas',
  'autonomy.paused.global': 'Autonomy',
  'autonomy.rail.enabled': 'Autonomy',
  'autonomy.patternMemory.enabled': 'Autonomy',
  'indexing.lazyMtime.enabled': 'Indexing',
  'indexing.worker.enabled': 'Indexing',
});

// ─── Substrate (non-flag) autonomy settings ────────────────────────────────
//
// Per the M60 §7.2 acceptance criteria: heartbeat cadence, max followup
// depth, cron persistence, sub-agent approval mode are all editable here.
// These are NOT yet wired to a runtime consumer in Phase ε — they are
// schema-only stubs that the runners will read in T1 polish (Phase ζ).

const SUBSTRATE_SCHEMAS: readonly ISettingSchema[] = [
  {
    key: 'autonomy.heartbeat.intervalMs',
    type: 'number',
    default: 60_000,
    scope: 'workspace',
    description:
      'Heartbeat tick interval in milliseconds. Minimum 15 000 ms per M60 §3.6 floor; default 60 000 ms.',
    category: 'Autonomy',
    min: 15_000,
    max: 3_600_000,
  },
  {
    key: 'autonomy.followup.maxDepth',
    type: 'number',
    default: 5,
    scope: 'workspace',
    description:
      'Maximum follow-up chain depth before the runner refuses to continue. Existing MAX_FOLLOWUP_DEPTH constant.',
    category: 'Autonomy',
    min: 1,
    max: 10,
  },
  {
    key: 'autonomy.subagent.approvalMode',
    type: 'enum',
    default: 'always-ask',
    scope: 'workspace',
    description:
      'How sub-agent spawn requests are gated. always-ask = prompt every time; session-allow = remember for the session; remember = persist across sessions (T5.E3).',
    category: 'Autonomy',
    enumValues: ['always-ask', 'session-allow', 'remember'],
  },
  {
    key: 'autonomy.cron.persistencePath',
    type: 'string',
    default: '<workspace>/.parallx/cron.json',
    scope: 'workspace',
    description:
      'Filesystem path used to persist cron jobs across restarts. Stored per-workspace so jobs in one workspace do not fire in another (M61 Phase 2). Use the literal token <workspace> for the active workspace folder.',
    category: 'Autonomy',
  },
  // T2 toggles per §7.2 acceptance criteria are now flag-bound via
  // `registerAutonomyFlagSettings` (`indexing.worker.enabled`,
  // `indexing.lazyMtime.enabled`). Old schema-only stubs were removed when
  // the flags landed in Phase θ.
];

// ─── Registration helpers ──────────────────────────────────────────────────

/**
 * Register all 11 autonomy boolean flags into the registry and adapter-bind
 * them to the existing AutonomyFeatureFlagsService. The flags service stays
 * the single source of truth — the registry is a schema + change-event
 * façade for the editor.
 */
export function registerAutonomyFlagSettings(
  registry: ISettingsRegistryService,
  flags: IAutonomyFeatureFlagsService,
): void {
  for (const id of Object.keys(AUTONOMY_FLAG_DEFAULTS) as AutonomyFlagId[]) {
    registry.register({
      key: id,
      type: 'boolean',
      default: AUTONOMY_FLAG_DEFAULTS[id],
      scope: 'workspace',
      description: FLAG_DESCRIPTIONS[id],
      category: FLAG_CATEGORY[id],
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

/**
 * Register the non-flag autonomy substrate schemas (heartbeat cadence,
 * followup depth, subagent approval, cron path) plus T2 indexing toggles.
 */
export function registerAutonomySubstrateSettings(
  registry: ISettingsRegistryService,
): void {
  for (const schema of SUBSTRATE_SCHEMAS) {
    registry.register(schema);
  }
}
