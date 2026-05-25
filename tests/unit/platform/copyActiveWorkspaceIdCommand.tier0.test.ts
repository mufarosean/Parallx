// copyActiveWorkspaceIdCommand.tier0.test.ts — Slice B13
//
// Verifies the workbench command `workbench.action.copyActiveWorkspaceId`
// is gated on `activeWorkspaceId` and returns the active workspace id
// (writing it to the clipboard as a side effect). Pure consumer of the
// B12 context key + the existing IContextService.

import { describe, it, expect } from 'vitest';
import { ALL_BUILTIN_COMMANDS } from '../../../src/commands/structuralCommands.js';

const COMMAND_ID = 'workbench.action.copyActiveWorkspaceId';

function find() {
  const d = ALL_BUILTIN_COMMANDS.find((c) => c.id === COMMAND_ID);
  if (!d) throw new Error(`${COMMAND_ID} not registered`);
  return d;
}

interface FakeCtxOpts { workspaceId?: string; clipboard?: string[]; missingService?: boolean; }
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
            workspaceId: opts.workspaceId,
            activeSurface: undefined,
            activeSelection: undefined,
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

describe('copyActiveWorkspaceId command (Slice B13)', () => {
  it('is registered with the right metadata', () => {
    const d = find();
    expect(d.title).toBe('Copy Active Workspace ID');
    expect(d.category).toBe('Workspace');
    expect(d.when).toBe('activeWorkspaceId');
    expect(d.keybinding).toBe('Ctrl+Alt+W');
    expect(d.aiInvocable).toBe(true);
  });

  it('returns the workspace id and writes it to the clipboard', async () => {
    const { ctx, captured } = makeCtx({ workspaceId: 'ws-alpha' });
    const id = await find().handler(ctx);
    expect(id).toBe('ws-alpha');
    expect(captured).toEqual(['ws-alpha']);
  });

  it('returns undefined when no workspace is active', async () => {
    const { ctx, captured } = makeCtx({ workspaceId: undefined });
    expect(await find().handler(ctx)).toBeUndefined();
    expect(captured).toEqual([]);
  });

  it('returns undefined when workspace id is empty string', async () => {
    const { ctx, captured } = makeCtx({ workspaceId: '' });
    expect(await find().handler(ctx)).toBeUndefined();
    expect(captured).toEqual([]);
  });

  it('returns undefined gracefully when IContextService is unavailable', async () => {
    const { ctx } = makeCtx({ missingService: true });
    expect(await find().handler(ctx)).toBeUndefined();
  });

  it('does not throw when clipboard write fails — still returns the id', async () => {
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
            workspaceId: 'ws-beta',
            activeSurface: undefined,
            activeSelection: undefined,
            activeResource: undefined,
            activeSurfaceKind: undefined,
            activeResourceType: undefined,
          }),
        } as unknown as T;
      },
    };
    expect(await d.handler(ctx)).toBe('ws-beta');
  });
});
