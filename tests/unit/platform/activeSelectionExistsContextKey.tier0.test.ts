/**
 * §86 / Slice B14 — `activeSelectionExists` context key.
 *
 * Adds a boolean §86 context key driven by the IContextService snapshot's
 * `activeSelection` field. Distinct from M81's older `selectionExists`
 * key (which mirrors `SelectionService.hasAnySelection()` aggregate) —
 * this one specifically tracks what the active surface declares through
 * the §86 ContextService.
 *
 * Verifies end-to-end through the real
 *   ContextKeyService + WorkbenchContextManager + contextBinding
 * stack — no fakes.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Emitter } from '../../../src/platform/events.js';
import { bindContextToWorkbenchContextManager } from '../../../src/workbench/resources/contextBinding.js';
import { ContextKeyService } from '../../../src/context/contextKey.js';
import {
  WorkbenchContextManager,
  CTX_ACTIVE_SELECTION_EXISTS,
} from '../../../src/context/workbenchContext.js';
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

function make() {
  const cks = new ContextKeyService();
  const wbc = new WorkbenchContextManager(cks, undefined);
  const ctx = new FakeContextService();
  const binding = bindContextToWorkbenchContextManager(
    ctx as unknown as Parameters<typeof bindContextToWorkbenchContextManager>[0],
    wbc,
  );
  return { cks, wbc, ctx, binding, dispose() { binding.dispose(); wbc.dispose(); cks.dispose(); } };
}

describe('§86 Slice B14 — activeSelectionExists context key', () => {
  let env: ReturnType<typeof make>;
  beforeEach(() => { env = make(); });

  it('exports the canonical key name', () => {
    expect(CTX_ACTIVE_SELECTION_EXISTS).toBe('activeSelectionExists');
    env.dispose();
  });

  it('defaults to false on cold start', () => {
    expect(env.cks.contextMatchesRules('activeSelectionExists')).toBe(false);
    env.dispose();
  });

  it('flips to true when ctx.activeSelection becomes defined', () => {
    env.ctx.set({ activeSelection: { kind: 'demo' } as object });
    expect(env.cks.contextMatchesRules('activeSelectionExists')).toBe(true);
    env.dispose();
  });

  it('flips back to false when ctx.activeSelection clears', () => {
    env.ctx.set({ activeSelection: { kind: 'demo' } as object });
    expect(env.cks.contextMatchesRules('activeSelectionExists')).toBe(true);
    env.ctx.set({ activeSelection: undefined });
    expect(env.cks.contextMatchesRules('activeSelectionExists')).toBe(false);
    env.dispose();
  });

  it('clears the key on binding dispose', () => {
    env.ctx.set({ activeSelection: { x: 1 } as object });
    expect(env.cks.contextMatchesRules('activeSelectionExists')).toBe(true);
    env.binding.dispose();
    expect(env.cks.contextMatchesRules('activeSelectionExists')).toBe(false);
    env.wbc.dispose();
    env.cks.dispose();
  });

  it('compounds with other §86 keys via &&', () => {
    env.ctx.set({
      workspaceId: 'ws-1',
      activeSurfaceKind: 'editor',
      activeResourceType: 'file',
      activeSelection: { range: [0, 10] } as object,
    });
    expect(env.cks.contextMatchesRules(
      "activeSelectionExists && activeSurfaceKind == 'editor' && activeResourceType == 'file'"
    )).toBe(true);
    env.ctx.set({ activeSelection: undefined });
    expect(env.cks.contextMatchesRules(
      "activeSelectionExists && activeSurfaceKind == 'editor'"
    )).toBe(false);
    env.dispose();
  });

  it('is independent of M81 selectionExists (workbench-wide aggregate)', () => {
    // The §86 binding only sets `activeSelectionExists`, never touches
    // M81's `selectionExists`. So setting an active selection through
    // the §86 path must NOT activate the M81 key.
    env.ctx.set({ activeSelection: { foo: 1 } as object });
    expect(env.cks.contextMatchesRules('activeSelectionExists')).toBe(true);
    expect(env.cks.contextMatchesRules('selectionExists')).toBe(false);
    env.dispose();
  });
});
