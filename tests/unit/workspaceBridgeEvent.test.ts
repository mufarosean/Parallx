// workspaceBridgeEvent.test.ts — Tests for WorkspaceBridge.onDidChangeWorkspace
//
// Verifies that the WorkspaceBridge correctly forwards workspace-switch
// events from IWorkspaceService to the tool API surface, providing the
// authoritative signal for workspace transitions.

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Emitter } from '../../src/platform/events';
import { WorkspaceBridge } from '../../src/api/bridges/workspaceBridge';
import type { WorkspaceChangeInfo } from '../../src/api/bridges/workspaceBridge';

// ── Minimal mocks ──

function createMockWorkspaceService() {
  const foldersEmitter = new Emitter<{ added: any[]; removed: any[] }>();
  const workspaceEmitter = new Emitter<{ id: string; name: string } | undefined>();
  return {
    folders: [],
    workspaceName: 'TestWorkspace',
    onDidChangeFolders: foldersEmitter.event,
    onDidChangeWorkspace: workspaceEmitter.event,
    getWorkspaceFolder: () => undefined,
    // Expose emitters for testing
    _foldersEmitter: foldersEmitter,
    _workspaceEmitter: workspaceEmitter,
  };
}

describe('WorkspaceBridge.onDidChangeWorkspace', () => {
  let bridge: WorkspaceBridge;
  let mockWs: ReturnType<typeof createMockWorkspaceService>;

  beforeEach(() => {
    mockWs = createMockWorkspaceService();
    bridge = new WorkspaceBridge('test-tool', [], undefined, mockWs as any, undefined);
  });

  it('exposes onDidChangeWorkspace as an event', () => {
    expect(typeof bridge.onDidChangeWorkspace).toBe('function');
  });

  it('fires when workspace service fires with workspace info', () => {
    const listener = vi.fn();
    bridge.onDidChangeWorkspace(listener);

    mockWs._workspaceEmitter.fire({ id: 'ws-123', name: 'My Project' });

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith({ id: 'ws-123', name: 'My Project' });
  });

  it('fires with undefined when workspace is undefined', () => {
    const listener = vi.fn();
    bridge.onDidChangeWorkspace(listener);

    mockWs._workspaceEmitter.fire(undefined);

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(undefined);
  });

  it('serializes only id and name (no raw Workspace leaked)', () => {
    const listener = vi.fn();
    bridge.onDidChangeWorkspace(listener);

    // Simulate a full Workspace-like object with extra fields
    const fullWorkspace = {
      id: 'ws-456',
      name: 'ProjectX',
      path: 'D:\\projects\\x',
      metadata: { createdAt: '2026-01-01' },
    };
    mockWs._workspaceEmitter.fire(fullWorkspace as any);

    const received: WorkspaceChangeInfo = listener.mock.calls[0][0];
    expect(received).toEqual({ id: 'ws-456', name: 'ProjectX' });
    // Should not leak internal fields
    expect((received as any).path).toBeUndefined();
    expect((received as any).metadata).toBeUndefined();
  });

  it('stops firing after dispose', () => {
    const listener = vi.fn();
    bridge.onDidChangeWorkspace(listener);

    bridge.dispose();

    // Fire after dispose — listener should NOT receive
    mockWs._workspaceEmitter.fire({ id: 'ws-999', name: 'Gone' });
    expect(listener).not.toHaveBeenCalled();
  });

  it('multiple listeners all receive the event', () => {
    const listener1 = vi.fn();
    const listener2 = vi.fn();
    bridge.onDidChangeWorkspace(listener1);
    bridge.onDidChangeWorkspace(listener2);

    mockWs._workspaceEmitter.fire({ id: 'ws-multi', name: 'Multi' });

    expect(listener1).toHaveBeenCalledOnce();
    expect(listener2).toHaveBeenCalledOnce();
  });

  it('provides a no-op event when workspace service is not available', () => {
    const noWsBridge = new WorkspaceBridge('test-tool', [], undefined, undefined, undefined);
    const listener = vi.fn();

    // Should not throw — returns a working (but never-firing) event
    const disposable = noWsBridge.onDidChangeWorkspace(listener);
    expect(disposable).toBeDefined();
    expect(listener).not.toHaveBeenCalled();

    noWsBridge.dispose();
  });
});
