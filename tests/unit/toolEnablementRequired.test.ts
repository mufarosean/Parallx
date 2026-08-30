// toolEnablementRequired.test.ts — real enablement (Phase D step 10).
//
// Pins the contract that "add or remove things as they please" is
// structurally true: only tools marked `required` in their manifest are
// pinned always-on; every other tool — built-in or external — can be
// toggled. A stale disable record can never win over `required`.

import { describe, it, expect } from 'vitest';
import { ToolEnablementService } from '../../src/tools/toolEnablementService.js';

function entry(id: string, isBuiltin: boolean, required?: boolean) {
  return {
    description: {
      manifest: { id, name: id, version: '1', publisher: 'p', main: './main.js', manifestVersion: 1, engines: { parallx: '^0.1.0' }, activationEvents: [], ...(required ? { required: true } : {}) },
      toolPath: `/${id}`,
      isBuiltin,
    },
    state: 'registered',
  };
}

function makeService(entries: ReturnType<typeof entry>[]) {
  const byId = new Map(entries.map((e) => [e.description.manifest.id, e]));
  const registry = { getById: (id: string) => byId.get(id) } as never;
  const storage = {
    get: async () => undefined,
    set: async () => {},
    delete: async () => {},
    has: async () => false,
    keys: async () => [],
    clear: async () => {},
  } as never;
  return new ToolEnablementService(storage, registry);
}

describe('real enablement — required pins, everything else toggles', () => {
  it('required tools cannot change enablement; other built-ins and externals can', () => {
    const svc = makeService([
      entry('parallx.chat', true, true),
      entry('parallx.welcome', true),
      entry('community.budget', false),
    ]);
    expect(svc.canChangeEnablement('parallx.chat')).toBe(false);
    expect(svc.canChangeEnablement('parallx.welcome')).toBe(true);
    expect(svc.canChangeEnablement('community.budget')).toBe(true);
    expect(svc.canChangeEnablement('no.such')).toBe(false);
    svc.dispose();
  });

  it('a non-required built-in disables and re-enables; required stays on even with a stale disable record', async () => {
    const svc = makeService([
      entry('parallx.chat', true, true),
      entry('parallx.welcome', true),
    ]);

    expect(svc.isEnabled('parallx.welcome')).toBe(true);
    await svc.setEnablement('parallx.welcome', false);
    expect(svc.isEnabled('parallx.welcome')).toBe(false);
    await svc.setEnablement('parallx.welcome', true);
    expect(svc.isEnabled('parallx.welcome')).toBe(true);

    // The write path refuses required tools outright…
    await expect(svc.setEnablement('parallx.chat', false)).rejects.toThrow(/required/);
    // …and the read path pins them on even against a stale persisted
    // record (e.g. disabled before the tool became required).
    (svc as unknown as { _disabled: Set<string> })._disabled.add('parallx.chat');
    expect(svc.isEnabled('parallx.chat')).toBe(true);
    svc.dispose();
  });
});
