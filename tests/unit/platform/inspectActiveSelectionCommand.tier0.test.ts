// inspectActiveSelectionCommand.tier0.test.ts — Slice B15
//
// Verifies the workbench command `workbench.action.inspectActiveSelection`
// is gated on `activeSelectionExists` (B14) and returns a JSON description
// of the active selection.

import { describe, it, expect } from 'vitest';
import { ALL_BUILTIN_COMMANDS } from '../../../src/commands/structuralCommands.js';

const COMMAND_ID = 'workbench.action.inspectActiveSelection';

function find() {
  const d = ALL_BUILTIN_COMMANDS.find((c) => c.id === COMMAND_ID);
  if (!d) throw new Error(`${COMMAND_ID} not registered`);
  return d;
}

interface FakeCtxOpts { selection?: object; clipboard?: string[]; missingService?: boolean; }
function makeCtx(opts: FakeCtxOpts) {
  const captured = opts.clipboard ?? [];
  Object.defineProperty(globalThis, 'navigator', {
    value: { clipboard: { writeText: async (s: string) => { captured.push(s); } } },
    configurable: true,
    writable: true,
  });
  return {
    ctx: {
      getService<T>(id: string): T | undefined {
        if (id !== 'IContextService' || opts.missingService) return undefined;
        return {
          getContext: () => ({
            workspaceId: undefined,
            activeSurface: undefined,
            activeSelection: opts.selection,
            activeResource: undefined,
            activeSurfaceKind: undefined,
            activeResourceType: undefined,
          }),
        } as unknown as T;
      },
    },
    captured,
  };
}

describe('inspectActiveSelection command (Slice B15)', () => {
  it('is registered with the right metadata', () => {
    const d = find();
    expect(d.title).toBe('Inspect Active Selection');
    expect(d.category).toBe('View');
    expect(d.when).toBe('activeSelectionExists');
    expect(d.keybinding).toBe('Ctrl+Alt+S');
    expect(d.aiInvocable).toBe(true);
  });

  it('returns a JSON description of the active selection and writes it to the clipboard', async () => {
    const sel = { range: [3, 7], surfaceId: 'editor-1' };
    const { ctx, captured } = makeCtx({ selection: sel });
    const out = await find().handler(ctx);
    expect(out).toBe(JSON.stringify(sel));
    expect(captured).toEqual([JSON.stringify(sel)]);
  });

  it('returns undefined when no selection is active', async () => {
    const { ctx, captured } = makeCtx({ selection: undefined });
    expect(await find().handler(ctx)).toBeUndefined();
    expect(captured).toEqual([]);
  });

  it('returns empty string and does not write when selection is not JSON-serializable', async () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    const { ctx, captured } = makeCtx({ selection: cyclic });
    expect(await find().handler(ctx)).toBe('');
    // empty string is falsy → not written
    expect(captured).toEqual([]);
  });

  it('returns undefined gracefully when IContextService is unavailable', async () => {
    const { ctx } = makeCtx({ missingService: true });
    expect(await find().handler(ctx)).toBeUndefined();
  });

  it('does not throw when clipboard write fails — still returns the JSON', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { clipboard: { writeText: async () => { throw new Error('denied'); } } },
      configurable: true,
      writable: true,
    });
    const d = find();
    const ctx = {
      getService<T>(id: string): T | undefined {
        if (id !== 'IContextService') return undefined;
        return {
          getContext: () => ({
            workspaceId: undefined,
            activeSurface: undefined,
            activeSelection: { x: 1 },
            activeResource: undefined,
            activeSurfaceKind: undefined,
            activeResourceType: undefined,
          }),
        } as unknown as T;
      },
    };
    expect(await d.handler(ctx)).toBe('{"x":1}');
  });
});
