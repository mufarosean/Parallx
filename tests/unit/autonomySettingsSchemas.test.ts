// autonomySettingsSchemas.test.ts — pin registerAutonomyFlagSettings +
// registerAutonomySubstrateSettings shape.
//
// Pins:
//   - registerAutonomyFlagSettings registers one schema per AUTONOMY_FLAG_DEFAULTS
//     id with type='boolean', scope='workspace', default mirroring the constant,
//     a non-empty description, and a category.
//   - Each flag is also bound: getValue → flags.isEnabled(id); setValue → flags.setEnabled(id, v).
//   - The local-emitter wired via flags.onDidChange forwards ONLY the matching id's
//     value to registry.bind's onDidChange. Cross-id events are filtered.
//   - registerAutonomySubstrateSettings registers exactly 4 schemas with the keys:
//       autonomy.heartbeat.intervalMs (number, min=15000, max=3600000)
//       autonomy.followup.maxDepth (number, min=1, max=10)
//       autonomy.subagent.approvalMode (enum, values ['always-ask','session-allow','remember'])
//       autonomy.cron.persistencePath (string)
//     All scope='workspace', category='Autonomy'.

import { describe, it, expect, vi } from 'vitest';
import {
  registerAutonomyFlagSettings,
  registerAutonomySubstrateSettings,
} from '../../src/services/autonomySettingsSchemas';
import { AUTONOMY_FLAG_DEFAULTS } from '../../src/services/autonomyFeatureFlags';
import { Emitter } from '../../src/platform/events';

function mkRegistry() {
  const registered: any[] = [];
  const bound = new Map<string, any>();
  return {
    registered,
    bound,
    register: vi.fn((s: any) => registered.push(s)),
    bind: vi.fn((key: string, b: any) => bound.set(key, b)),
  } as any;
}

function mkFlagsService() {
  const emitter = new Emitter<{ id: string; value: boolean }>();
  const store = new Map<string, boolean>();
  return {
    emitter,
    onDidChange: emitter.event,
    isEnabled: vi.fn((id: string) => store.get(id) ?? AUTONOMY_FLAG_DEFAULTS[id as keyof typeof AUTONOMY_FLAG_DEFAULTS] ?? false),
    setEnabled: vi.fn((id: string, value: boolean) => { store.set(id, value); emitter.fire({ id, value }); }),
  } as any;
}

describe('registerAutonomyFlagSettings', () => {
  it('registers one boolean schema per AUTONOMY_FLAG_DEFAULTS id with workspace scope', () => {
    const reg = mkRegistry();
    const flags = mkFlagsService();
    registerAutonomyFlagSettings(reg, flags);
    const ids = Object.keys(AUTONOMY_FLAG_DEFAULTS);
    expect(reg.registered.length).toBe(ids.length);
    for (const id of ids) {
      const schema = reg.registered.find((s: any) => s.key === id);
      expect(schema).toBeDefined();
      expect(schema.type).toBe('boolean');
      expect(schema.scope).toBe('workspace');
      expect(schema.default).toBe((AUTONOMY_FLAG_DEFAULTS as any)[id]);
      expect(typeof schema.description).toBe('string');
      expect(schema.description.length).toBeGreaterThan(0);
      expect(typeof schema.category).toBe('string');
      expect(schema.category.length).toBeGreaterThan(0);
    }
  });

  it('bind.getValue delegates to flags.isEnabled; bind.setValue to flags.setEnabled', () => {
    const reg = mkRegistry();
    const flags = mkFlagsService();
    registerAutonomyFlagSettings(reg, flags);
    const id = 'autonomy.followup.enabled';
    const b = reg.bound.get(id);
    expect(b).toBeDefined();
    expect(b.getValue()).toBe((AUTONOMY_FLAG_DEFAULTS as any)[id]);
    b.setValue(false);
    expect(flags.setEnabled).toHaveBeenCalledWith(id, false);
    expect(b.getValue()).toBe(false);
  });

  it('bind.onDidChange forwards only matching-id events with the new value', () => {
    const reg = mkRegistry();
    const flags = mkFlagsService();
    registerAutonomyFlagSettings(reg, flags);
    const heard: boolean[] = [];
    reg.bound.get('autonomy.followup.enabled').onDidChange((v: boolean) => heard.push(v));
    flags.emitter.fire({ id: 'autonomy.heartbeat.enabled', value: true });
    flags.emitter.fire({ id: 'autonomy.followup.enabled', value: false });
    flags.emitter.fire({ id: 'autonomy.followup.enabled', value: true });
    expect(heard).toEqual([false, true]);
  });
});

describe('registerAutonomySubstrateSettings', () => {
  it('registers 4 substrate schemas with documented keys and constraints', () => {
    const reg = mkRegistry();
    registerAutonomySubstrateSettings(reg);
    expect(reg.registered.length).toBe(4);

    const hb = reg.registered.find((s: any) => s.key === 'autonomy.heartbeat.intervalMs');
    expect(hb).toMatchObject({ type: 'number', default: 60000, scope: 'workspace', category: 'Autonomy', min: 15000, max: 3600000 });

    const depth = reg.registered.find((s: any) => s.key === 'autonomy.followup.maxDepth');
    expect(depth).toMatchObject({ type: 'number', default: 5, scope: 'workspace', category: 'Autonomy', min: 1, max: 10 });

    const ap = reg.registered.find((s: any) => s.key === 'autonomy.subagent.approvalMode');
    expect(ap).toMatchObject({ type: 'enum', default: 'always-ask', scope: 'workspace', category: 'Autonomy' });
    expect(ap.enumValues).toEqual(['always-ask', 'session-allow', 'remember']);

    const cron = reg.registered.find((s: any) => s.key === 'autonomy.cron.persistencePath');
    expect(cron).toMatchObject({ type: 'string', scope: 'workspace', category: 'Autonomy' });
    expect(typeof cron.default).toBe('string');
  });
});
