// contextServiceMatches.tier0.test.ts — Slice A24

import { describe, it, expect } from 'vitest';
import { ContextService, type WorkbenchContext } from '../../../src/workbench/resources/contextService.js';
import { Emitter } from '../../../src/platform/events.js';

function makeService(opts: { workspaceId?: string; surface?: any; selection?: any } = {}) {
  const wEm = new Emitter<unknown>();
  const sEm = new Emitter<unknown>();
  const selEm = new Emitter<unknown>();
  const svc = new ContextService(
    {
      activeWorkspace: opts.workspaceId ? { id: opts.workspaceId } : undefined,
      onDidChangeWorkspace: wEm.event,
    },
    { getActive: () => opts.surface, onDidChangeSurface: sEm.event },
    { getSelection: () => opts.selection, onDidChangeSelection: selEm.event },
  );
  return svc;
}

describe('IContextService.matches (Slice A24)', () => {
  it('returns true when predicate returns true', () => {
    const svc = makeService({ workspaceId: 'w1' });
    expect(svc.matches(c => c.workspaceId === 'w1')).toBe(true);
  });

  it('returns false when predicate returns false', () => {
    const svc = makeService({ workspaceId: 'w1' });
    expect(svc.matches(c => c.workspaceId === 'other')).toBe(false);
  });

  it('passes a full WorkbenchContext to the predicate', () => {
    const svc = makeService({ workspaceId: 'w1' });
    let captured: WorkbenchContext | undefined;
    svc.matches(c => { captured = c; return true; });
    expect(captured).toBeDefined();
    expect(captured!.workspaceId).toBe('w1');
    expect(captured!.activeSurface).toBeUndefined();
    expect(captured!.activeSelection).toBeUndefined();
    expect(captured!.activeResource).toBeUndefined();
  });

  it('returns false when there is no workspace and predicate requires one', () => {
    const svc = makeService({});
    expect(svc.matches(c => c.workspaceId !== undefined)).toBe(false);
  });

  it('supports composite when-clause-style predicates', () => {
    const surface = { id: 's1', kind: 'editor', displayName: 'A' } as any;
    const svc = makeService({ workspaceId: 'w1', surface });
    expect(svc.matches(c => c.workspaceId === 'w1' && c.activeSurface?.kind === 'editor')).toBe(true);
    expect(svc.matches(c => c.activeSurface?.kind === 'canvas')).toBe(false);
  });

  it('reads activeResource derived from selection', () => {
    const selection = { resource: { type: 'file', path: '/a.md' } } as any;
    const svc = makeService({ selection });
    expect(svc.matches(c => c.activeResource?.type === 'file')).toBe(true);
  });
});
