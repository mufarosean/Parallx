// autonomyKillSwitch.test.ts — M60 §8 Phase ζ T5.E2
//
// Verifies the global pause kill-switch contract:
//   - isAutonomyTriggerAllowed returns false when paused.global is on,
//     regardless of per-trigger flag value
//   - returns the per-trigger flag value when paused.global is off
//   - persistence: setEnabled survives a fresh service instance with the
//     same storage backing

import { describe, expect, it } from 'vitest';
import {
  AutonomyFeatureFlagsService,
  FLAG_PAUSED_GLOBAL,
  FLAG_HEARTBEAT_ENABLED,
  FLAG_CRON_ENABLED,
  FLAG_SUBAGENT_ENABLED,
  FLAG_FOLLOWUP_ENABLED,
  isAutonomyTriggerAllowed,
} from '../../src/services/autonomyFeatureFlags';
import type { IStorage } from '../../src/platform/storage';

function memoryStorage(): IStorage {
  const map = new Map<string, string>();
  return {
    async get(key: string) { return map.get(key); },
    async set(key: string, value: string) { map.set(key, value); },
    async delete(key: string) { map.delete(key); },
    async has(key: string) { return map.has(key); },
    async keys(prefix?: string) {
      const out = [];
      for (const k of map.keys()) {
        if (!prefix || k.startsWith(prefix)) out.push(k);
      }
      return out;
    },
    async clear() { map.clear(); },
  };
}

describe('isAutonomyTriggerAllowed (M60 §8 ζ T5.E2)', () => {
  const TRIGGERS = [
    FLAG_HEARTBEAT_ENABLED,
    FLAG_CRON_ENABLED,
    FLAG_SUBAGENT_ENABLED,
    FLAG_FOLLOWUP_ENABLED,
  ] as const;

  it('returns false for every trigger when paused.global is on', async () => {
    const flags = new AutonomyFeatureFlagsService(memoryStorage());
    await flags.initialize();
    await flags.setEnabled(FLAG_PAUSED_GLOBAL, true);
    for (const t of TRIGGERS) {
      // Even when the per-trigger flag is true, the global pause wins.
      await flags.setEnabled(t, true);
      expect(isAutonomyTriggerAllowed(flags, t)).toBe(false);
    }
  });

  it('returns the per-trigger flag value when paused.global is off', async () => {
    const flags = new AutonomyFeatureFlagsService(memoryStorage());
    await flags.initialize();
    expect(flags.isEnabled(FLAG_PAUSED_GLOBAL)).toBe(false);
    for (const t of TRIGGERS) {
      await flags.setEnabled(t, true);
      expect(isAutonomyTriggerAllowed(flags, t)).toBe(true);
      await flags.setEnabled(t, false);
      expect(isAutonomyTriggerAllowed(flags, t)).toBe(false);
    }
  });

  it('persists the global pause across service instances', async () => {
    const storage = memoryStorage();
    const a = new AutonomyFeatureFlagsService(storage);
    await a.initialize();
    await a.setEnabled(FLAG_PAUSED_GLOBAL, true);

    const b = new AutonomyFeatureFlagsService(storage);
    await b.initialize();
    expect(b.isEnabled(FLAG_PAUSED_GLOBAL)).toBe(true);
    expect(isAutonomyTriggerAllowed(b, FLAG_HEARTBEAT_ENABLED)).toBe(false);
  });
});
