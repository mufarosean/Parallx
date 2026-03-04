import { describe, it, expect, beforeEach } from 'vitest';
import { SessionManager } from '../../src/workspace/sessionManager';
import { captureSession } from '../../src/workspace/staleGuard';

describe('captureSession (stale guard)', () => {
  let mgr: SessionManager;

  beforeEach(() => {
    mgr = new SessionManager();
  });

  it('isValid() returns false when no session exists', () => {
    const guard = captureSession(mgr);
    expect(guard.isValid()).toBe(false);
    expect(guard.sessionId).toBe('');
  });

  it('isValid() returns true for the active session', () => {
    mgr.beginSession('ws-1', []);
    const guard = captureSession(mgr);
    expect(guard.isValid()).toBe(true);
    expect(guard.sessionId).toBeTruthy();
  });

  it('isValid() returns false after endSession()', () => {
    mgr.beginSession('ws-1', []);
    const guard = captureSession(mgr);
    mgr.endSession();
    expect(guard.isValid()).toBe(false);
  });

  it('isValid() returns false after beginSession() with different workspace', () => {
    mgr.beginSession('ws-1', []);
    const guard = captureSession(mgr);
    mgr.beginSession('ws-2', []);
    expect(guard.isValid()).toBe(false);
  });

  it('isValid() returns false after beginSession() with same workspace (new session)', () => {
    mgr.beginSession('ws-1', []);
    const guard = captureSession(mgr);
    mgr.beginSession('ws-1', []);
    expect(guard.isValid()).toBe(false);
  });

  it('guard captures the correct sessionId', () => {
    const ctx = mgr.beginSession('ws-1', []);
    const guard = captureSession(mgr);
    expect(guard.sessionId).toBe(ctx.sessionId);
  });

  it('multiple guards from the same session are all valid', () => {
    mgr.beginSession('ws-1', []);
    const g1 = captureSession(mgr);
    const g2 = captureSession(mgr);
    expect(g1.isValid()).toBe(true);
    expect(g2.isValid()).toBe(true);
  });

  it('old guard invalid, new guard valid after session change', () => {
    mgr.beginSession('ws-1', []);
    const oldGuard = captureSession(mgr);
    mgr.beginSession('ws-2', []);
    const newGuard = captureSession(mgr);
    expect(oldGuard.isValid()).toBe(false);
    expect(newGuard.isValid()).toBe(true);
  });
});
