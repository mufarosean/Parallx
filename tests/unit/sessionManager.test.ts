// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { SessionManager } from '../../src/workspace/sessionManager';

// Minimal URI stub — matches the shape services expect
function makeUri(path: string) {
  return { scheme: 'file', authority: '', path, query: '', fragment: '', fsPath: path, toString: () => `file://${path}` } as any;
}

describe('SessionManager', () => {
  let mgr: SessionManager;

  beforeEach(() => {
    mgr = new SessionManager();
  });

  it('starts with no active context', () => {
    expect(mgr.activeContext).toBeUndefined();
  });

  it('beginSession() creates a context with a non-empty sessionId', () => {
    const ctx = mgr.beginSession('ws-1', [makeUri('/project')]);
    expect(ctx.sessionId).toBeTruthy();
    expect(ctx.sessionId.length).toBeGreaterThan(8);
  });

  it('beginSession() sets workspaceId and roots', () => {
    const root = makeUri('/project');
    const ctx = mgr.beginSession('ws-1', [root]);
    expect(ctx.workspaceId).toBe('ws-1');
    expect(ctx.roots).toEqual([root]);
    expect(ctx.primaryRoot).toBe(root);
  });

  it('beginSession() returns a context where isActive() is true', () => {
    const ctx = mgr.beginSession('ws-1', []);
    expect(ctx.isActive()).toBe(true);
  });

  it('beginSession() sets activeContext', () => {
    const ctx = mgr.beginSession('ws-1', []);
    expect(mgr.activeContext).toBe(ctx);
  });

  it('beginSession() produces a logPrefix', () => {
    const ctx = mgr.beginSession('abcdef12-3456', []);
    expect(ctx.logPrefix).toMatch(/\[ws:abcdef12 sid:\w+\]/);
  });

  it('endSession() causes old context isActive() to return false', () => {
    const ctx = mgr.beginSession('ws-1', []);
    mgr.endSession();
    expect(ctx.isActive()).toBe(false);
  });

  it('endSession() aborts the old context AbortController', () => {
    const ctx = mgr.beginSession('ws-1', []);
    expect(ctx.cancellationSignal.aborted).toBe(false);
    mgr.endSession();
    expect(ctx.cancellationSignal.aborted).toBe(true);
  });

  it('endSession() clears activeContext', () => {
    mgr.beginSession('ws-1', []);
    mgr.endSession();
    expect(mgr.activeContext).toBeUndefined();
  });

  it('beginSession() invalidates previous session', () => {
    const ctx1 = mgr.beginSession('ws-1', []);
    const ctx2 = mgr.beginSession('ws-2', []);
    expect(ctx1.isActive()).toBe(false);
    expect(ctx1.cancellationSignal.aborted).toBe(true);
    expect(ctx2.isActive()).toBe(true);
    expect(mgr.activeContext).toBe(ctx2);
  });

  it('consecutive sessions have different sessionIds', () => {
    const ctx1 = mgr.beginSession('ws-1', []);
    const id1 = ctx1.sessionId;
    mgr.beginSession('ws-1', []);
    expect(mgr.activeContext!.sessionId).not.toBe(id1);
  });

  it('onDidChangeSession fires on beginSession', () => {
    const events: any[] = [];
    mgr.onDidChangeSession((ctx) => events.push(ctx));
    const ctx = mgr.beginSession('ws-1', []);
    expect(events).toHaveLength(1);
    expect(events[0]).toBe(ctx);
  });

  it('onDidChangeSession fires undefined on endSession', () => {
    const events: any[] = [];
    mgr.beginSession('ws-1', []);
    mgr.onDidChangeSession((ctx) => events.push(ctx));
    mgr.endSession();
    expect(events).toHaveLength(1);
    expect(events[0]).toBeUndefined();
  });

  it('endSession() is no-op when no active session', () => {
    // Should not throw
    mgr.endSession();
    expect(mgr.activeContext).toBeUndefined();
  });

  it('dispose() ends any active session', () => {
    const ctx = mgr.beginSession('ws-1', []);
    mgr.dispose();
    expect(ctx.isActive()).toBe(false);
    expect(ctx.cancellationSignal.aborted).toBe(true);
  });

  it('empty workspace has undefined primaryRoot', () => {
    const ctx = mgr.beginSession('ws-1', []);
    expect(ctx.primaryRoot).toBeUndefined();
  });
});
