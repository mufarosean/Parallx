/**
 * Pin: autonomyFeatureFlags — flag id constants, AUTONOMY_FLAG_DEFAULTS map,
 * SURFACE_FLAG_BY_ID, AutonomyFeatureFlagsService (initialize/isEnabled/
 * setEnabled/getAll/onDidChange), isAutonomyTriggerAllowed kill-switch.
 */
import { describe, it, expect, vi } from "vitest";
import {
  FLAG_FOLLOWUP_ENABLED,
  FLAG_SURFACE_CHAT_ENABLED,
  FLAG_SURFACE_NOTIFICATION_ENABLED,
  FLAG_SURFACE_STATUSBAR_ENABLED,
  FLAG_SURFACE_CANVAS_ENABLED,
  FLAG_SURFACE_FILESYSTEM_ENABLED,
  FLAG_HEARTBEAT_ENABLED,
  FLAG_CRON_ENABLED,
  FLAG_SUBAGENT_ENABLED,
  FLAG_CANVAS_BLOCKIDS_ENABLED,
  FLAG_CANVAS_DATAVIEW_ENABLED,
  FLAG_PAUSED_GLOBAL,
  FLAG_RAIL_ENABLED,
  FLAG_PATTERN_MEMORY_ENABLED,
  FLAG_INDEXING_LAZY_MTIME_ENABLED,
  FLAG_INDEXING_WORKER_ENABLED,
  AUTONOMY_FLAG_DEFAULTS,
  SURFACE_FLAG_BY_ID,
  AutonomyFeatureFlagsService,
  isAutonomyTriggerAllowed,
} from "../../src/services/autonomyFeatureFlags";

describe("services/autonomyFeatureFlags — constants", () => {
  it("flag id strings are dotted namespaces under autonomy./canvas./indexing.", () => {
    expect(FLAG_FOLLOWUP_ENABLED).toBe("autonomy.followup.enabled");
    expect(FLAG_SURFACE_CHAT_ENABLED).toBe("autonomy.surface.chat.enabled");
    expect(FLAG_SURFACE_NOTIFICATION_ENABLED).toBe("autonomy.surface.notification.enabled");
    expect(FLAG_SURFACE_STATUSBAR_ENABLED).toBe("autonomy.surface.statusbar.enabled");
    expect(FLAG_SURFACE_CANVAS_ENABLED).toBe("autonomy.surface.canvas.enabled");
    expect(FLAG_SURFACE_FILESYSTEM_ENABLED).toBe("autonomy.surface.filesystem.enabled");
    expect(FLAG_HEARTBEAT_ENABLED).toBe("autonomy.heartbeat.enabled");
    expect(FLAG_CRON_ENABLED).toBe("autonomy.cron.enabled");
    expect(FLAG_SUBAGENT_ENABLED).toBe("autonomy.subagent.enabled");
    expect(FLAG_CANVAS_BLOCKIDS_ENABLED).toBe("canvas.blockIds.enabled");
    expect(FLAG_CANVAS_DATAVIEW_ENABLED).toBe("canvas.dataview.enabled");
    expect(FLAG_PAUSED_GLOBAL).toBe("autonomy.paused.global");
    expect(FLAG_RAIL_ENABLED).toBe("autonomy.rail.enabled");
    expect(FLAG_PATTERN_MEMORY_ENABLED).toBe("autonomy.patternMemory.enabled");
    expect(FLAG_INDEXING_LAZY_MTIME_ENABLED).toBe("indexing.lazyMtime.enabled");
    expect(FLAG_INDEXING_WORKER_ENABLED).toBe("indexing.worker.enabled");
  });

  it("AUTONOMY_FLAG_DEFAULTS is frozen with the documented per-flag defaults", () => {
    expect(Object.isFrozen(AUTONOMY_FLAG_DEFAULTS)).toBe(true);
    expect(AUTONOMY_FLAG_DEFAULTS).toEqual({
      [FLAG_FOLLOWUP_ENABLED]: true,
      [FLAG_SURFACE_CHAT_ENABLED]: true,
      [FLAG_SURFACE_NOTIFICATION_ENABLED]: true,
      [FLAG_SURFACE_STATUSBAR_ENABLED]: true,
      [FLAG_SURFACE_CANVAS_ENABLED]: false,
      [FLAG_SURFACE_FILESYSTEM_ENABLED]: false,
      [FLAG_HEARTBEAT_ENABLED]: false,
      [FLAG_CRON_ENABLED]: false,
      [FLAG_SUBAGENT_ENABLED]: false,
      [FLAG_CANVAS_BLOCKIDS_ENABLED]: true,
      [FLAG_CANVAS_DATAVIEW_ENABLED]: true,
      [FLAG_PAUSED_GLOBAL]: false,
      [FLAG_RAIL_ENABLED]: true,
      [FLAG_PATTERN_MEMORY_ENABLED]: true,
      [FLAG_INDEXING_LAZY_MTIME_ENABLED]: true,
      [FLAG_INDEXING_WORKER_ENABLED]: true,
    });
  });

  it("SURFACE_FLAG_BY_ID maps surface plugin ids to their gating flag", () => {
    expect(Object.isFrozen(SURFACE_FLAG_BY_ID)).toBe(true);
    expect(SURFACE_FLAG_BY_ID).toEqual({
      chat: FLAG_SURFACE_CHAT_ENABLED,
      notifications: FLAG_SURFACE_NOTIFICATION_ENABLED,
      status: FLAG_SURFACE_STATUSBAR_ENABLED,
      canvas: FLAG_SURFACE_CANVAS_ENABLED,
      filesystem: FLAG_SURFACE_FILESYSTEM_ENABLED,
    });
  });
});

function makeStorage(initial?: string) {
  let value: string | undefined = initial;
  return {
    api: {
      get: vi.fn(async (_k: string) => value),
      set: vi.fn(async (_k: string, v: string) => { value = v; }),
      delete: vi.fn(async (_k: string) => { value = undefined; }),
    },
    read: () => value,
  };
}

describe("services/autonomyFeatureFlags/AutonomyFeatureFlagsService", () => {
  it("isEnabled returns default when no override and no storage", () => {
    const svc = new AutonomyFeatureFlagsService(undefined);
    expect(svc.isEnabled(FLAG_FOLLOWUP_ENABLED)).toBe(true);
    expect(svc.isEnabled(FLAG_SURFACE_CANVAS_ENABLED)).toBe(false);
  });

  it("initialize hydrates overrides from storage; ignores non-string + invalid types", async () => {
    const s = makeStorage(JSON.stringify({
      [FLAG_FOLLOWUP_ENABLED]: false,
      [FLAG_SURFACE_CANVAS_ENABLED]: true,
      [FLAG_HEARTBEAT_ENABLED]: "yes", // non-boolean: ignored
      "unknown.flag": true,            // unknown key: ignored
    }));
    const svc = new AutonomyFeatureFlagsService(s.api as any);
    await svc.initialize();
    expect(svc.isEnabled(FLAG_FOLLOWUP_ENABLED)).toBe(false);
    expect(svc.isEnabled(FLAG_SURFACE_CANVAS_ENABLED)).toBe(true);
    expect(svc.isEnabled(FLAG_HEARTBEAT_ENABLED)).toBe(false); // ignored → default
  });

  it("initialize tolerates corrupt JSON (falls back to defaults silently)", async () => {
    const s = makeStorage("not-json{");
    const svc = new AutonomyFeatureFlagsService(s.api as any);
    await expect(svc.initialize()).resolves.toBeUndefined();
    expect(svc.isEnabled(FLAG_FOLLOWUP_ENABLED)).toBe(true);
  });

  it("setEnabled fires onDidChange and persists JSON to storage", async () => {
    const s = makeStorage();
    const svc = new AutonomyFeatureFlagsService(s.api as any);
    const fn = vi.fn();
    svc.onDidChange(fn);
    await svc.setEnabled(FLAG_SURFACE_CANVAS_ENABLED, true);
    expect(fn).toHaveBeenCalledWith({ id: FLAG_SURFACE_CANVAS_ENABLED, value: true });
    expect(s.api.set).toHaveBeenCalledTimes(1);
    expect(JSON.parse(s.read()!)).toEqual({ [FLAG_SURFACE_CANVAS_ENABLED]: true });
  });

  it("setEnabled is a no-op (no change event, no write) when value matches current", async () => {
    const s = makeStorage();
    const svc = new AutonomyFeatureFlagsService(s.api as any);
    const fn = vi.fn();
    svc.onDidChange(fn);
    await svc.setEnabled(FLAG_FOLLOWUP_ENABLED, true); // default already true
    expect(fn).not.toHaveBeenCalled();
    expect(s.api.set).not.toHaveBeenCalled();
  });

  it("setEnabled throws for unknown flag id", async () => {
    const svc = new AutonomyFeatureFlagsService(undefined);
    await expect(svc.setEnabled("not.a.flag" as any, true)).rejects.toThrow(/unknown flag id/);
  });

  it("getAll returns a fully-populated snapshot (defaults merged with overrides)", async () => {
    const svc = new AutonomyFeatureFlagsService(undefined);
    await svc.setEnabled(FLAG_PAUSED_GLOBAL, true);
    const all = svc.getAll();
    expect(all[FLAG_PAUSED_GLOBAL]).toBe(true);
    expect(all[FLAG_FOLLOWUP_ENABLED]).toBe(true);
    expect(Object.keys(all).sort()).toEqual(Object.keys(AUTONOMY_FLAG_DEFAULTS).sort());
  });

  it("isAutonomyTriggerAllowed: paused.global=true vetoes all triggers; otherwise reflects trigger flag", async () => {
    const svc = new AutonomyFeatureFlagsService(undefined);
    expect(isAutonomyTriggerAllowed(svc, FLAG_FOLLOWUP_ENABLED)).toBe(true);
    await svc.setEnabled(FLAG_PAUSED_GLOBAL, true);
    expect(isAutonomyTriggerAllowed(svc, FLAG_FOLLOWUP_ENABLED)).toBe(false);
    await svc.setEnabled(FLAG_PAUSED_GLOBAL, false);
    await svc.setEnabled(FLAG_FOLLOWUP_ENABLED, false);
    expect(isAutonomyTriggerAllowed(svc, FLAG_FOLLOWUP_ENABLED)).toBe(false);
  });
});
