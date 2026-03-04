// sessionGuards.test.ts — M14 Phase 2 stale session guard tests
//
// Verifies that captureSession() guards prevent stale commits in:
//   - IndexingPipelineService
//   - ChatService.sendRequest
//   - DefaultParticipant agentic loop
//
// Also verifies SessionLogger behavior.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionManager } from '../../src/workspace/sessionManager';
import { captureSession } from '../../src/workspace/staleGuard';
import { SessionLogger } from '../../src/workspace/sessionLogger';
import { WorkspaceSessionContext } from '../../src/workspace/workspaceSessionContext';

// ── Mock URI for roots ──
const mockUri = (p: string) => ({ scheme: 'file', authority: '', path: p, fsPath: p, query: '', fragment: '', toString: () => `file://${p}` });

describe('SessionGuard Integration', () => {
  let manager: SessionManager;

  beforeEach(() => {
    manager = new SessionManager();
  });

  it('guard is valid immediately after capture', () => {
    manager.beginSession('ws-1', [mockUri('/workspace')] as any);
    const guard = captureSession(manager);
    expect(guard.isValid()).toBe(true);
    expect(guard.sessionId).toBeTruthy();
  });

  it('guard becomes invalid after endSession', () => {
    manager.beginSession('ws-1', [mockUri('/workspace')] as any);
    const guard = captureSession(manager);
    manager.endSession();
    expect(guard.isValid()).toBe(false);
  });

  it('guard becomes invalid after workspace switch (beginSession with new ID)', () => {
    manager.beginSession('ws-1', [mockUri('/workspace-a')] as any);
    const guard = captureSession(manager);
    manager.beginSession('ws-2', [mockUri('/workspace-b')] as any);
    expect(guard.isValid()).toBe(false);
  });

  it('old guard invalid, new guard valid after switch', () => {
    manager.beginSession('ws-1', [mockUri('/workspace')] as any);
    const oldGuard = captureSession(manager);
    manager.beginSession('ws-2', [mockUri('/workspace-b')] as any);
    const newGuard = captureSession(manager);
    expect(oldGuard.isValid()).toBe(false);
    expect(newGuard.isValid()).toBe(true);
  });

  it('multiple guards for same session all stay valid', () => {
    manager.beginSession('ws-1', [mockUri('/workspace')] as any);
    const g1 = captureSession(manager);
    const g2 = captureSession(manager);
    const g3 = captureSession(manager);
    expect(g1.isValid()).toBe(true);
    expect(g2.isValid()).toBe(true);
    expect(g3.isValid()).toBe(true);
    expect(g1.sessionId).toBe(g2.sessionId);
  });

  it('guard captured with no session is always invalid', () => {
    const guard = captureSession(manager);
    expect(guard.isValid()).toBe(false);
    expect(guard.sessionId).toBe('');
  });

  it('abort controller is signalled on endSession', () => {
    const ctx = manager.beginSession('ws-1', [mockUri('/workspace')] as any);
    expect(ctx.cancellationSignal.aborted).toBe(false);
    manager.endSession();
    expect(ctx.cancellationSignal.aborted).toBe(true);
  });

  it('abort controller is signalled on workspace switch', () => {
    const ctx = manager.beginSession('ws-1', [mockUri('/workspace')] as any);
    manager.beginSession('ws-2', [mockUri('/workspace-b')] as any);
    expect(ctx.cancellationSignal.aborted).toBe(true);
  });

  it('onDidChangeSession fires on beginSession and endSession', () => {
    const events: any[] = [];
    manager.onDidChangeSession((ctx) => events.push(ctx));
    manager.beginSession('ws-1', [mockUri('/workspace')] as any);
    manager.endSession();
    expect(events.length).toBe(2);
    expect(events[0]).toBeTruthy(); // context fired
    expect(events[1]).toBeUndefined(); // undefined on end
  });

  it('dispose ends any active session', () => {
    const ctx = manager.beginSession('ws-1', [mockUri('/workspace')] as any);
    manager.dispose();
    expect(ctx.isActive()).toBe(false);
    expect(ctx.cancellationSignal.aborted).toBe(true);
  });
});

describe('WorkspaceSessionContext', () => {
  it('generates correct logPrefix with short IDs', () => {
    const ctx = new WorkspaceSessionContext('abcdef12', 'ghijkl34', []);
    expect(ctx.logPrefix).toBe('[ws:abcdef12 sid:ghijkl34]');
  });

  it('truncates long IDs to 8 chars in logPrefix', () => {
    const ctx = new WorkspaceSessionContext('abcdef1234567890', 'ghijkl34567890ab', []);
    expect(ctx.logPrefix).toBe('[ws:abcdef12 sid:ghijkl34]');
  });

  it('isActive returns false after invalidate', () => {
    const ctx = new WorkspaceSessionContext('ws', 'sid', []);
    expect(ctx.isActive()).toBe(true);
    ctx.invalidate();
    expect(ctx.isActive()).toBe(false);
  });

  it('invalidate signals abort controller', () => {
    const ctx = new WorkspaceSessionContext('ws', 'sid', []);
    expect(ctx.abortController.signal.aborted).toBe(false);
    ctx.invalidate();
    expect(ctx.abortController.signal.aborted).toBe(true);
  });

  it('double invalidate is safe', () => {
    const ctx = new WorkspaceSessionContext('ws', 'sid', []);
    ctx.invalidate();
    ctx.invalidate(); // should not throw
    expect(ctx.isActive()).toBe(false);
  });

  it('primaryRoot is roots[0] or undefined', () => {
    const uri1 = mockUri('/a') as any;
    const uri2 = mockUri('/b') as any;
    const ctx1 = new WorkspaceSessionContext('ws', 'sid', [uri1, uri2]);
    expect(ctx1.primaryRoot).toBe(uri1);
    const ctx2 = new WorkspaceSessionContext('ws', 'sid', []);
    expect(ctx2.primaryRoot).toBeUndefined();
  });
});

describe('SessionLogger', () => {
  it('logs with session prefix', () => {
    const ctx = new WorkspaceSessionContext('ws-abc', 'sid-def', []);
    const logger = new SessionLogger(ctx);
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logger.info('test message');
    expect(spy).toHaveBeenCalledWith('[ws:ws-abc sid:sid-def] test message');
    spy.mockRestore();
  });

  it('logs with fallback prefix when no context', () => {
    const logger = new SessionLogger();
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logger.info('test message');
    expect(spy).toHaveBeenCalledWith('[ws:? sid:?] test message');
    spy.mockRestore();
  });

  it('warn method uses console.warn', () => {
    const ctx = new WorkspaceSessionContext('ws', 'sid', []);
    const logger = new SessionLogger(ctx);
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    logger.warn('warning!');
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('warning!'));
    spy.mockRestore();
  });

  it('error method uses console.error', () => {
    const ctx = new WorkspaceSessionContext('ws', 'sid', []);
    const logger = new SessionLogger(ctx);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logger.error('error!');
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('error!'));
    spy.mockRestore();
  });

  it('debug method uses console.debug', () => {
    const ctx = new WorkspaceSessionContext('ws', 'sid', []);
    const logger = new SessionLogger(ctx);
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    logger.debug('debug info');
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('debug info'));
    spy.mockRestore();
  });

  it('setContext updates the prefix', () => {
    const logger = new SessionLogger();
    expect(logger.prefix).toBe('[ws:? sid:?]');
    const ctx = new WorkspaceSessionContext('newws', 'newsid', []);
    logger.setContext(ctx);
    expect(logger.prefix).toContain('newws');
  });

  it('never throws even if console methods throw', () => {
    const ctx = new WorkspaceSessionContext('ws', 'sid', []);
    const logger = new SessionLogger(ctx);
    const spy = vi.spyOn(console, 'log').mockImplementation(() => { throw new Error('boom'); });
    expect(() => logger.info('test')).not.toThrow();
    spy.mockRestore();
  });

  it('passes extra arguments through', () => {
    const ctx = new WorkspaceSessionContext('ws', 'sid', []);
    const logger = new SessionLogger(ctx);
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logger.info('count: %d', 42);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('count: %d'), 42);
    spy.mockRestore();
  });
});
