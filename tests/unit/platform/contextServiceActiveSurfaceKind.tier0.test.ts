// contextServiceActiveSurfaceKind.tier0.test.ts — Slice A28

import { describe, it, expect } from 'vitest';
import { ContextService } from '../../../src/workbench/resources/contextService.js';
import { Emitter } from '../../../src/platform/events.js';
import { surface as makeSurface } from '../../../src/workbench/resources/surface.js';

function makeService(opts: { workspaceId?: string; surface?: any } = {}) {
  const wEm = new Emitter<unknown>();
  const sEm = new Emitter<unknown>();
  const selEm = new Emitter<unknown>();
  return new ContextService(
    {
      activeWorkspace: opts.workspaceId ? { id: opts.workspaceId } : undefined,
      onDidChangeWorkspace: wEm.event,
    },
    { getActive: () => opts.surface, onDidChangeSurface: sEm.event },
    { getSelection: () => undefined, onDidChangeSelection: selEm.event },
  );
}

describe('WorkbenchContext.activeSurfaceKind (Slice A28)', () => {
  it('is undefined when no surface is active', () => {
    const svc = makeService({});
    expect(svc.getContext().activeSurfaceKind).toBeUndefined();
  });

  it('reflects editor kind', () => {
    const s = makeSurface('e1', 'editor', 'A');
    const svc = makeService({ surface: s });
    expect(svc.getContext().activeSurfaceKind).toBe('editor');
  });

  it('reflects canvas kind', () => {
    const s = makeSurface('c1', 'canvas', 'C');
    const svc = makeService({ surface: s });
    expect(svc.getContext().activeSurfaceKind).toBe('canvas');
  });

  it('reflects chat kind', () => {
    const s = makeSurface('ch1', 'chat', 'Chat');
    const svc = makeService({ surface: s });
    expect(svc.getContext().activeSurfaceKind).toBe('chat');
  });

  it('matches() can predicate on activeSurfaceKind', () => {
    const s = makeSurface('e1', 'editor', 'A');
    const svc = makeService({ surface: s });
    expect(svc.matches(c => c.activeSurfaceKind === 'editor')).toBe(true);
    expect(svc.matches(c => c.activeSurfaceKind === 'canvas')).toBe(false);
  });

  it('agrees with activeSurface?.kind', () => {
    const s = makeSurface('e1', 'editor', 'A');
    const svc = makeService({ surface: s });
    const ctx = svc.getContext();
    expect(ctx.activeSurfaceKind).toBe(ctx.activeSurface?.kind);
  });
});
