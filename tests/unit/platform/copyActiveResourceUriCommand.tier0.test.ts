// copyActiveResourceUriCommand.tier0.test.ts — Slice B5
//
// Verifies the workbench command `workbench.action.copyActiveResourceUri`
// is gated on `activeResourceType` and serializes the current
// IContextService.activeResource back to a canonical parallx:// URI.

import { describe, it, expect } from 'vitest';
import { ALL_BUILTIN_COMMANDS } from '../../../src/commands/structuralCommands.js';
import type { Resource } from '../../../src/workbench/resources/resource.js';
import {
  fileResource,
  canvasPageResource,
  chatSessionResource,
  toolArtifactResource,
} from '../../../src/workbench/resources/resource.js';

const COMMAND_ID = 'workbench.action.copyActiveResourceUri';

function find() {
  const d = ALL_BUILTIN_COMMANDS.find((c) => c.id === COMMAND_ID);
  if (!d) throw new Error(`${COMMAND_ID} not registered`);
  return d;
}

interface FakeCtxOpts { resource?: Resource; clipboard?: string[]; missingService?: boolean; }
function makeCtx(opts: FakeCtxOpts) {
  const captured = opts.clipboard ?? [];
  // Stub navigator.clipboard at the global level (read-only on Node).
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
            activeSelection: undefined,
            activeResource: opts.resource,
            activeSurfaceKind: opts.resource ? 'editor' : undefined,
            activeResourceType: opts.resource?.type,
          }),
        } as unknown as T;
      },
    },
    captured,
  };
}

describe('copyActiveResourceUri command (Slice B5)', () => {
  it('is registered with the right metadata', () => {
    const d = find();
    expect(d.title).toBe('Copy Active Resource URI');
    expect(d.category).toBe('View');
    expect(d.when).toBe('activeResourceType');
    expect(d.aiInvocable).toBe(true);
  });

  it('serializes file resources to parallx://file:<path>', async () => {
    const { ctx, captured } = makeCtx({ resource: fileResource('/tmp/a.md', { workspaceId: 'w1' }) });
    const uri = await find().handler(ctx);
    expect(uri).toBe('parallx://file:%2Ftmp%2Fa.md?workspace=w1');
    expect(captured).toEqual([uri]);
  });

  it('serializes canvas-page resources', async () => {
    const { ctx } = makeCtx({ resource: canvasPageResource('abc-123', { workspaceId: 'w1' }) });
    expect(await find().handler(ctx)).toBe('parallx://canvas-page:abc-123?workspace=w1');
  });

  it('serializes chat-session resources', async () => {
    const { ctx } = makeCtx({ resource: chatSessionResource('s7', { workspaceId: 'w1' }) });
    expect(await find().handler(ctx)).toBe('parallx://chat-session:s7?workspace=w1');
  });

  it('serializes tool-artifact resources', async () => {
    const { ctx } = makeCtx({
      resource: toolArtifactResource('research', 'p1', { workspaceId: 'w1' }),
    });
    expect(await find().handler(ctx)).toBe('parallx://tool-artifact:research/p1?workspace=w1');
  });

  it('returns undefined when no resource is active', async () => {
    const { ctx, captured } = makeCtx({ resource: undefined });
    expect(await find().handler(ctx)).toBeUndefined();
    expect(captured).toEqual([]);
  });

  it('returns undefined gracefully when IContextService is unavailable', async () => {
    const { ctx } = makeCtx({ missingService: true });
    expect(await find().handler(ctx)).toBeUndefined();
  });

  it('does not throw when clipboard write fails', async () => {
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
            activeSelection: undefined,
            activeResource: fileResource('/tmp/x', { workspaceId: 'w1' }),
            activeSurfaceKind: 'editor',
            activeResourceType: 'file',
          }),
        } as unknown as T;
      },
    };
    const uri = await d.handler(ctx);
    expect(uri).toBe('parallx://file:%2Ftmp%2Fx?workspace=w1');
  });
});
