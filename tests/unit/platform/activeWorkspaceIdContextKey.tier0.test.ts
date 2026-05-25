/**
 * §86 / Slice B12 — `activeWorkspaceId` context key.
 *
 * Verifies that the third snapshot field carried by IContextService
 * (`workspaceId`) is mirrored into a workbench context key with the
 * same conventions as B3's `activeSurfaceKind` / `activeResourceType`:
 *
 *   - default value is the empty string (treated as falsy by truthiness)
 *   - propagates through the IContextService → WorkbenchContextManager
 *     binding established in B3
 *   - clears back to '' on binding disposal
 *
 * The whole point: `when`-clauses like `activeWorkspaceId == 'ws-1'` and
 * `activeWorkspaceId` (truthy) now light up automatically.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Emitter } from '../../../src/platform/events.js';
import { bindContextToWorkbenchContextManager } from '../../../src/workbench/resources/contextBinding.js';
import { ContextKeyService } from '../../../src/context/contextKey.js';
import { WorkbenchContextManager, CTX_ACTIVE_WORKSPACE_ID } from '../../../src/context/workbenchContext.js';
import type { WorkbenchContext } from '../../../src/workbench/resources/contextService.js';

class FakeContextService {
  readonly _emitter = new Emitter<WorkbenchContext>();
  readonly onDidChangeContext = this._emitter.event;
  current: WorkbenchContext = {
    workspaceId: undefined,
    activeSurface: undefined,
    activeSelection: undefined,
    activeResource: undefined,
    activeSurfaceKind: undefined,
    activeResourceType: undefined,
  };
  getContext(): WorkbenchContext { return this.current; }
  matches(p: (c: WorkbenchContext) => boolean): boolean { return p(this.current); }
  set(next: Partial<WorkbenchContext>): void {
    this.current = { ...this.current, ...next };
    this._emitter.fire(this.current);
  }
}

function makeRealStack() {
  const cks = new ContextKeyService();
  const wbc = new WorkbenchContextManager(cks, undefined);
  const ctx = new FakeContextService();
  const binding = bindContextToWorkbenchContextManager(
    ctx as unknown as Parameters<typeof bindContextToWorkbenchContextManager>[0],
    wbc,
  );
  return { cks, wbc, ctx, binding, dispose() { binding.dispose(); wbc.dispose(); cks.dispose(); } };
}

describe('§86 Slice B12 — activeWorkspaceId context key', () => {
  let env: ReturnType<typeof makeRealStack>;
  beforeEach(() => { env = makeRealStack(); });

  it('exports the canonical key name', () => {
    expect(CTX_ACTIVE_WORKSPACE_ID).toBe('activeWorkspaceId');
    env.dispose();
  });

  it('defaults to empty string (falsy) on cold start', () => {
    expect(env.cks.contextMatchesRules('activeWorkspaceId')).toBe(false);
    env.dispose();
  });

  it('propagates IContextService workspaceId changes to the context key', () => {
    env.ctx.set({ workspaceId: 'ws-alpha' });
    expect(env.cks.contextMatchesRules('activeWorkspaceId')).toBe(true);
    expect(env.cks.contextMatchesRules("activeWorkspaceId == 'ws-alpha'")).toBe(true);
    expect(env.cks.contextMatchesRules("activeWorkspaceId == 'ws-beta'")).toBe(false);
    env.dispose();
  });

  it('clears back to empty string when workspaceId becomes undefined', () => {
    env.ctx.set({ workspaceId: 'ws-1' });
    expect(env.cks.contextMatchesRules('activeWorkspaceId')).toBe(true);
    env.ctx.set({ workspaceId: undefined });
    expect(env.cks.contextMatchesRules('activeWorkspaceId')).toBe(false);
    env.dispose();
  });

  it('clears the key on binding dispose', () => {
    env.ctx.set({ workspaceId: 'ws-1' });
    expect(env.cks.contextMatchesRules('activeWorkspaceId')).toBe(true);
    env.binding.dispose();
    expect(env.cks.contextMatchesRules('activeWorkspaceId')).toBe(false);
    env.wbc.dispose();
    env.cks.dispose();
  });

  it('compounds with other §86 keys via &&', () => {
    env.ctx.set({
      workspaceId: 'ws-1',
      activeSurfaceKind: 'editor',
      activeResourceType: 'file',
    });
    expect(env.cks.contextMatchesRules(
      "activeWorkspaceId == 'ws-1' && activeSurfaceKind == 'editor' && activeResourceType == 'file'"
    )).toBe(true);
    env.ctx.set({ workspaceId: 'ws-2' });
    expect(env.cks.contextMatchesRules(
      "activeWorkspaceId == 'ws-1' && activeSurfaceKind == 'editor'"
    )).toBe(false);
    env.dispose();
  });
});
