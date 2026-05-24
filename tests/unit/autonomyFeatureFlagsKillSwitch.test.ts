/**
 * Pin-the-invariant: autonomyFeatureFlags kill-switch + surface mapping +
 * defaults table integrity.
 *
 * The existing autonomyFeatureFlags.test.ts covers basic CRUD. This file
 * pins the safety-critical edges that test does not cover:
 *
 *   - isAutonomyTriggerAllowed kill-switch (paused.global wins over every flag)
 *   - SURFACE_FLAG_BY_ID router gating mapping
 *   - AUTONOMY_FLAG_DEFAULTS exact values per M60 §3.8 (any default flip is
 *     a deliberate decision; this catches accidental ones)
 *   - Defaults table + surface mapping are frozen (no runtime mutation)
 *   - Corrupt JSON storage falls back to defaults silently
 *   - Non-boolean stored values are filtered out at init
 *   - getAll() returns every flag with overrides applied
 *   - setEnabled with current value does NOT fire onDidChange (idempotent no-op)
 *   - Works when constructed with undefined storage
 */

import { describe, expect, it, vi } from 'vitest';
import {
  AutonomyFeatureFlagsService,
  AUTONOMY_FLAG_DEFAULTS,
  SURFACE_FLAG_BY_ID,
  isAutonomyTriggerAllowed,
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
} from '../../src/services/autonomyFeatureFlags';
import { InMemoryStorage } from '../../src/platform/storage';

describe('AUTONOMY_FLAG_DEFAULTS — pinned values per M60 §3.8', () => {
  it('followup + chat/notification/statusbar surfaces default ON', () => {
    expect(AUTONOMY_FLAG_DEFAULTS[FLAG_FOLLOWUP_ENABLED]).toBe(true);
    expect(AUTONOMY_FLAG_DEFAULTS[FLAG_SURFACE_CHAT_ENABLED]).toBe(true);
    expect(AUTONOMY_FLAG_DEFAULTS[FLAG_SURFACE_NOTIFICATION_ENABLED]).toBe(true);
    expect(AUTONOMY_FLAG_DEFAULTS[FLAG_SURFACE_STATUSBAR_ENABLED]).toBe(true);
  });

  it('canvas + filesystem surfaces default OFF', () => {
    expect(AUTONOMY_FLAG_DEFAULTS[FLAG_SURFACE_CANVAS_ENABLED]).toBe(false);
    expect(AUTONOMY_FLAG_DEFAULTS[FLAG_SURFACE_FILESYSTEM_ENABLED]).toBe(false);
  });

  it('heartbeat / cron / subagent default OFF (Phase γ controls)', () => {
    expect(AUTONOMY_FLAG_DEFAULTS[FLAG_HEARTBEAT_ENABLED]).toBe(false);
    expect(AUTONOMY_FLAG_DEFAULTS[FLAG_CRON_ENABLED]).toBe(false);
    expect(AUTONOMY_FLAG_DEFAULTS[FLAG_SUBAGENT_ENABLED]).toBe(false);
  });

  it('canvas blockIds + dataview default ON (already shipped)', () => {
    expect(AUTONOMY_FLAG_DEFAULTS[FLAG_CANVAS_BLOCKIDS_ENABLED]).toBe(true);
    expect(AUTONOMY_FLAG_DEFAULTS[FLAG_CANVAS_DATAVIEW_ENABLED]).toBe(true);
  });

  it('global pause kill-switch defaults OFF; rail UI + pattern memory default ON', () => {
    expect(AUTONOMY_FLAG_DEFAULTS[FLAG_PAUSED_GLOBAL]).toBe(false);
    expect(AUTONOMY_FLAG_DEFAULTS[FLAG_RAIL_ENABLED]).toBe(true);
    expect(AUTONOMY_FLAG_DEFAULTS[FLAG_PATTERN_MEMORY_ENABLED]).toBe(true);
  });

  it('indexing lazy mtime + embedding worker default ON (M78 Phase 3)', () => {
    expect(AUTONOMY_FLAG_DEFAULTS[FLAG_INDEXING_LAZY_MTIME_ENABLED]).toBe(true);
    expect(AUTONOMY_FLAG_DEFAULTS[FLAG_INDEXING_WORKER_ENABLED]).toBe(true);
  });

  it('defaults table is frozen (no mutation after definition)', () => {
    expect(Object.isFrozen(AUTONOMY_FLAG_DEFAULTS)).toBe(true);
  });
});

describe('SURFACE_FLAG_BY_ID — router gating mapping', () => {
  it('maps every router surface to its corresponding flag', () => {
    expect(SURFACE_FLAG_BY_ID.chat).toBe(FLAG_SURFACE_CHAT_ENABLED);
    expect(SURFACE_FLAG_BY_ID.notifications).toBe(FLAG_SURFACE_NOTIFICATION_ENABLED);
    expect(SURFACE_FLAG_BY_ID.status).toBe(FLAG_SURFACE_STATUSBAR_ENABLED);
    expect(SURFACE_FLAG_BY_ID.canvas).toBe(FLAG_SURFACE_CANVAS_ENABLED);
    expect(SURFACE_FLAG_BY_ID.filesystem).toBe(FLAG_SURFACE_FILESYSTEM_ENABLED);
  });

  it('mapping is frozen', () => {
    expect(Object.isFrozen(SURFACE_FLAG_BY_ID)).toBe(true);
  });
});

describe('AutonomyFeatureFlagsService — edge behaviors not covered by the basic suite', () => {
  it('setEnabled does NOT fire onDidChange when value already matches', async () => {
    const svc = new AutonomyFeatureFlagsService(new InMemoryStorage());
    await svc.initialize();
    const handler = vi.fn();
    svc.onDidChange(handler);
    await svc.setEnabled(FLAG_FOLLOWUP_ENABLED, true); // already true (default)
    expect(handler).not.toHaveBeenCalled();
    svc.dispose();
  });

  it('initialize() with corrupt JSON storage falls back to defaults silently', async () => {
    const storage = new InMemoryStorage();
    await storage.set('autonomy.featureFlags', '{ not valid json');
    const svc = new AutonomyFeatureFlagsService(storage);
    await expect(svc.initialize()).resolves.not.toThrow();
    expect(svc.isEnabled(FLAG_FOLLOWUP_ENABLED)).toBe(true);
    expect(svc.isEnabled(FLAG_SURFACE_CANVAS_ENABLED)).toBe(false);
    svc.dispose();
  });

  it('initialize() ignores non-boolean stored values', async () => {
    const storage = new InMemoryStorage();
    await storage.set(
      'autonomy.featureFlags',
      JSON.stringify({
        [FLAG_SURFACE_CANVAS_ENABLED]: 'yes',   // wrong type → ignored
        [FLAG_HEARTBEAT_ENABLED]: 1,            // wrong type → ignored
        [FLAG_CRON_ENABLED]: true,              // valid → applied
      }),
    );
    const svc = new AutonomyFeatureFlagsService(storage);
    await svc.initialize();
    expect(svc.isEnabled(FLAG_SURFACE_CANVAS_ENABLED)).toBe(false);
    expect(svc.isEnabled(FLAG_HEARTBEAT_ENABLED)).toBe(false);
    expect(svc.isEnabled(FLAG_CRON_ENABLED)).toBe(true);
    svc.dispose();
  });

  it('getAll returns every flag with overrides applied', async () => {
    const svc = new AutonomyFeatureFlagsService(new InMemoryStorage());
    await svc.initialize();
    await svc.setEnabled(FLAG_PAUSED_GLOBAL, true);
    const snap = svc.getAll();
    expect(snap[FLAG_PAUSED_GLOBAL]).toBe(true);
    expect(snap[FLAG_FOLLOWUP_ENABLED]).toBe(true);
    expect(snap[FLAG_SURFACE_CANVAS_ENABLED]).toBe(false);
    for (const key of Object.keys(AUTONOMY_FLAG_DEFAULTS)) {
      expect(snap).toHaveProperty(key);
    }
    svc.dispose();
  });

  it('works without storage (undefined) — defaults only, no persistence', async () => {
    const svc = new AutonomyFeatureFlagsService(undefined);
    await svc.initialize();
    expect(svc.isEnabled(FLAG_FOLLOWUP_ENABLED)).toBe(true);
    await svc.setEnabled(FLAG_HEARTBEAT_ENABLED, true);
    expect(svc.isEnabled(FLAG_HEARTBEAT_ENABLED)).toBe(true);
    svc.dispose();
  });
});

describe('isAutonomyTriggerAllowed — kill-switch semantics', () => {
  it('returns true when paused.global=false AND trigger flag is true', async () => {
    const svc = new AutonomyFeatureFlagsService(new InMemoryStorage());
    await svc.initialize();
    expect(isAutonomyTriggerAllowed(svc, FLAG_FOLLOWUP_ENABLED)).toBe(true);
    svc.dispose();
  });

  it('returns false when paused.global=true REGARDLESS of trigger flag', async () => {
    const svc = new AutonomyFeatureFlagsService(new InMemoryStorage());
    await svc.initialize();
    await svc.setEnabled(FLAG_PAUSED_GLOBAL, true);
    // Followup is still ON in its own right, but kill-switch overrides:
    expect(svc.isEnabled(FLAG_FOLLOWUP_ENABLED)).toBe(true);
    expect(isAutonomyTriggerAllowed(svc, FLAG_FOLLOWUP_ENABLED)).toBe(false);
    expect(isAutonomyTriggerAllowed(svc, FLAG_SURFACE_CHAT_ENABLED)).toBe(false);
    svc.dispose();
  });

  it('returns false when paused.global=false but trigger flag is false', async () => {
    const svc = new AutonomyFeatureFlagsService(new InMemoryStorage());
    await svc.initialize();
    expect(isAutonomyTriggerAllowed(svc, FLAG_SURFACE_CANVAS_ENABLED)).toBe(false);
    svc.dispose();
  });
});
