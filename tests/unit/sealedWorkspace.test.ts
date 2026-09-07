/**
 * The sealed-workspace flag: registered once, read without throwing, and the
 * owners whose tools it hides. The enforcement points (provider sync, tool
 * filter, egress chokepoint, title bar) all read through these helpers.
 */
import { describe, it, expect } from 'vitest';
import {
  SEALED_WORKSPACE_SETTING,
  registerSealedSetting,
  isWorkspaceSealed,
  isSealedOutOwner,
  applyWorkspaceSeal,
} from '../../src/services/sealedWorkspace';

function fakeRegistry(initial?: Record<string, unknown>) {
  const schemas = new Map<string, { default: unknown }>();
  const values = new Map<string, unknown>(Object.entries(initial ?? {}));
  let registrations = 0;
  return {
    registrations: () => registrations,
    register(schema: { key: string; default: unknown }) { registrations++; schemas.set(schema.key, schema); },
    getSchema(key: string) { return schemas.get(key); },
    getValue<T>(key: string): T {
      const s = schemas.get(key);
      if (!s) throw new Error(`unregistered: ${key}`);
      return (values.has(key) ? values.get(key) : s.default) as T;
    },
    set(key: string, v: unknown) { values.set(key, v); },
  };
}

describe('sealed workspace', () => {
  it('registers the setting once and defaults to open', () => {
    const reg = fakeRegistry();
    registerSealedSetting(reg);
    registerSealedSetting(reg);
    expect(reg.registrations()).toBe(1);
    expect(isWorkspaceSealed(reg)).toBe(false);
  });

  it('reads the flag, registering lazily so getValue never throws', () => {
    const reg = fakeRegistry({ [SEALED_WORKSPACE_SETTING]: true });
    expect(isWorkspaceSealed(reg)).toBe(true);
    expect(reg.registrations()).toBe(1);
    expect(isWorkspaceSealed(undefined)).toBe(false);
  });

  it('hides the network tool owners and nothing else', () => {
    expect(isSealedOutOwner('parallx.web-research')).toBe(true);
    expect(isSealedOutOwner('parallx.browser')).toBe(true);
    expect(isSealedOutOwner('parallx-community.media-organizer')).toBe(false);
    expect(isSealedOutOwner(undefined)).toBe(false);
  });

  it('pushes the state to the title bar and the egress chokepoint', async () => {
    const reg = fakeRegistry({ [SEALED_WORKSPACE_SETTING]: true });
    const seen: boolean[] = [];
    let egress: boolean | null = null;
    const sealed = applyWorkspaceSeal(reg, {
      titlebar: { setSealed: (s) => { seen.push(s); } },
      egress: { setSealed: async (s) => { egress = s; } },
    });
    expect(sealed).toBe(true);
    expect(seen).toEqual([true]);
    expect(egress).toBe(true);
    // A surface that throws does not break the others.
    expect(applyWorkspaceSeal(reg, { titlebar: { setSealed: () => { throw new Error('x'); } } })).toBe(true);
  });
});
