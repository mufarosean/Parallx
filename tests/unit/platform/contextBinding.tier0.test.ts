// contextBinding.tier0.test.ts — Slice B3
//
// Verifies the binding between IContextService (§86 unified snapshot) and
// WorkbenchContextManager (legacy when-clause keys). The binding is the
// first real consumer of IContextService in product code.

import { describe, it, expect, beforeEach } from 'vitest';
import { Emitter } from '../../../src/platform/events.js';
import { bindContextToWorkbenchContextManager } from '../../../src/workbench/resources/contextBinding.js';
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

class FakeWorkbenchContext {
  surfaceKind: string | undefined;
  resourceType: string | undefined;
  workspaceId: string | undefined;
  selectionExists = false;
  surfaceCalls = 0;
  resourceCalls = 0;
  workspaceCalls = 0;
  selectionCalls = 0;
  setActiveSurfaceKind(k: string | undefined): void {
    this.surfaceCalls++;
    this.surfaceKind = k ?? '';
  }
  setActiveResourceType(t: string | undefined): void {
    this.resourceCalls++;
    this.resourceType = t ?? '';
  }
  setActiveWorkspaceId(id: string | undefined): void {
    this.workspaceCalls++;
    this.workspaceId = id ?? '';
  }
  setActiveSelectionExists(exists: boolean): void {
    this.selectionCalls++;
    this.selectionExists = exists;
  }
}

function make() {
  const ctx = new FakeContextService();
  const wbc = new FakeWorkbenchContext();
  const binding = bindContextToWorkbenchContextManager(
    ctx as unknown as Parameters<typeof bindContextToWorkbenchContextManager>[0],
    wbc as unknown as Parameters<typeof bindContextToWorkbenchContextManager>[1],
  );
  return { ctx, wbc, binding };
}

describe('contextBinding (Slice B3)', () => {
  let env: ReturnType<typeof make>;
  beforeEach(() => { env = make(); });

  it('seeds the workbench context with the current snapshot on construction', () => {
    // First push happened during bind() with the empty initial state.
    expect(env.wbc.surfaceKind).toBe('');
    expect(env.wbc.resourceType).toBe('');
    expect(env.wbc.surfaceCalls).toBe(1);
    expect(env.wbc.resourceCalls).toBe(1);
    env.binding.dispose();
  });

  it('propagates context changes to both context keys', () => {
    env.ctx.set({ activeSurfaceKind: 'editor', activeResourceType: 'file' });
    expect(env.wbc.surfaceKind).toBe('editor');
    expect(env.wbc.resourceType).toBe('file');
    env.binding.dispose();
  });

  it('handles canvas-page resource types', () => {
    env.ctx.set({ activeSurfaceKind: 'editor', activeResourceType: 'canvas-page' });
    expect(env.wbc.surfaceKind).toBe('editor');
    expect(env.wbc.resourceType).toBe('canvas-page');
    env.binding.dispose();
  });

  it('clears keys when the snapshot has no active surface', () => {
    env.ctx.set({ activeSurfaceKind: 'editor', activeResourceType: 'file' });
    expect(env.wbc.surfaceKind).toBe('editor');
    env.ctx.set({ activeSurfaceKind: undefined, activeResourceType: undefined });
    expect(env.wbc.surfaceKind).toBe('');
    expect(env.wbc.resourceType).toBe('');
    env.binding.dispose();
  });

  it('syncNow() re-applies the current snapshot without waiting for an event', () => {
    env.ctx.current = { ...env.ctx.current, activeSurfaceKind: 'canvas', activeResourceType: 'canvas-page' };
    // No event fired — keys still reflect prior push.
    expect(env.wbc.surfaceKind).toBe('');
    env.binding.syncNow();
    expect(env.wbc.surfaceKind).toBe('canvas');
    expect(env.wbc.resourceType).toBe('canvas-page');
    env.binding.dispose();
  });

  it('dispose stops subscriptions and clears the keys', () => {
    env.ctx.set({ activeSurfaceKind: 'editor', activeResourceType: 'file' });
    env.binding.dispose();
    expect(env.wbc.surfaceKind).toBe('');
    expect(env.wbc.resourceType).toBe('');
    // Post-dispose, further fires must be ignored.
    const surfaceCallsAfterDispose = env.wbc.surfaceCalls;
    env.ctx.set({ activeSurfaceKind: 'chat', activeResourceType: 'chat-session' });
    expect(env.wbc.surfaceCalls).toBe(surfaceCallsAfterDispose);
    expect(env.wbc.surfaceKind).toBe('');
  });
});
