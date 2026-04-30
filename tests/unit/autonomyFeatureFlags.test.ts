// autonomyFeatureFlags.test.ts — M60 §3.8 controls layer
//
// Verifies:
//   - Defaults match §3.8 (followup + chat/notification/statusbar ON;
//     canvas + filesystem OFF).
//   - setEnabled persists overrides, fires onDidChange, idempotent
//     re-set is a no-op.
//   - initialize() rehydrates overrides from IStorage.

import { describe, expect, it, vi } from 'vitest';
import {
  AutonomyFeatureFlagsService,
  AUTONOMY_FLAG_DEFAULTS,
  FLAG_FOLLOWUP_ENABLED,
  FLAG_SURFACE_CANVAS_ENABLED,
  FLAG_SURFACE_CHAT_ENABLED,
  FLAG_SURFACE_FILESYSTEM_ENABLED,
  FLAG_SURFACE_NOTIFICATION_ENABLED,
  FLAG_SURFACE_STATUSBAR_ENABLED,
} from '../../src/services/autonomyFeatureFlags';
import type { IStorage } from '../../src/platform/storage';

function fakeStorage(initial: Record<string, string> = {}): IStorage {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    get: vi.fn(async (k: string) => store.get(k)),
    set: vi.fn(async (k: string, v: string) => { store.set(k, v); }),
    delete: vi.fn(async (k: string) => { store.delete(k); }),
    keys: vi.fn(async () => Array.from(store.keys())),
  } as unknown as IStorage;
}

describe('AutonomyFeatureFlagsService (M60 §3.8)', () => {
  it('returns the §3.8 defaults when no overrides are present', async () => {
    const svc = new AutonomyFeatureFlagsService(undefined);
    await svc.initialize();
    expect(svc.isEnabled(FLAG_FOLLOWUP_ENABLED)).toBe(true);
    expect(svc.isEnabled(FLAG_SURFACE_CHAT_ENABLED)).toBe(true);
    expect(svc.isEnabled(FLAG_SURFACE_NOTIFICATION_ENABLED)).toBe(true);
    expect(svc.isEnabled(FLAG_SURFACE_STATUSBAR_ENABLED)).toBe(true);
    expect(svc.isEnabled(FLAG_SURFACE_CANVAS_ENABLED)).toBe(false);
    expect(svc.isEnabled(FLAG_SURFACE_FILESYSTEM_ENABLED)).toBe(false);
    // Snapshot matches the frozen defaults exactly.
    expect(svc.getAll()).toStrictEqual({ ...AUTONOMY_FLAG_DEFAULTS });
  });

  it('setEnabled persists overrides and fires onDidChange', async () => {
    const storage = fakeStorage();
    const svc = new AutonomyFeatureFlagsService(storage);
    await svc.initialize();
    const events: Array<{ id: string; value: boolean }> = [];
    svc.onDidChange(e => events.push({ id: e.id, value: e.value }));

    await svc.setEnabled(FLAG_SURFACE_CANVAS_ENABLED, true);
    expect(svc.isEnabled(FLAG_SURFACE_CANVAS_ENABLED)).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0]).toStrictEqual({ id: FLAG_SURFACE_CANVAS_ENABLED, value: true });
    expect(storage.set).toHaveBeenCalled();

    // Idempotent re-set: same value should not fire change again.
    await svc.setEnabled(FLAG_SURFACE_CANVAS_ENABLED, true);
    expect(events).toHaveLength(1);
  });

  it('initialize() rehydrates overrides from storage', async () => {
    const storage = fakeStorage({
      'autonomy.featureFlags': JSON.stringify({
        [FLAG_FOLLOWUP_ENABLED]: false,
        [FLAG_SURFACE_CANVAS_ENABLED]: true,
      }),
    });
    const svc = new AutonomyFeatureFlagsService(storage);
    await svc.initialize();
    expect(svc.isEnabled(FLAG_FOLLOWUP_ENABLED)).toBe(false);
    expect(svc.isEnabled(FLAG_SURFACE_CANVAS_ENABLED)).toBe(true);
    // Unrelated flags fall back to defaults.
    expect(svc.isEnabled(FLAG_SURFACE_CHAT_ENABLED)).toBe(true);
  });

  it('rejects unknown flag ids on setEnabled', async () => {
    const svc = new AutonomyFeatureFlagsService(undefined);
    await svc.initialize();
    await expect(svc.setEnabled('autonomy.bogus' as never, true)).rejects.toThrow(/unknown flag/);
  });
});
