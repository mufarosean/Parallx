// workspaceService.test.ts — pin WorkspaceService facade behavior.

import { describe, it, expect, vi } from 'vitest';
import { WorkspaceService } from '../../src/services/workspaceService';
import { Emitter } from '../../src/platform/events';
import { URI } from '../../src/platform/uri';

function mkWorkspace(name = 'ws', folders: any[] = []) {
  const foldersEmitter = new Emitter<any>();
  const stateEmitter = new Emitter<number>();
  const renameEmitter = new Emitter<string>();
  return {
    name,
    folders,
    state: 2,
    onDidChangeFolders: foldersEmitter.event,
    onDidChangeState: stateEmitter.event,
    onDidRename: renameEmitter.event,
    addFolder: vi.fn(),
    removeFolder: vi.fn(),
    setFolders: vi.fn(),
    getWorkspaceFolder: vi.fn((uri: any) => folders[0]),
    _foldersEmitter: foldersEmitter,
    _stateEmitter: stateEmitter,
    _renameEmitter: renameEmitter,
  } as any;
}

function mkHost(workspace: any) {
  const switchEmitter = new Emitter<any>();
  return {
    workspace,
    _workspaceSaver: { save: vi.fn(async () => {}), requestSave: vi.fn() },
    createWorkspace: vi.fn(async () => workspace),
    switchWorkspace: vi.fn(async () => {}),
    getRecentWorkspaces: vi.fn(async () => [{ id: 'w1', name: 'a', path: '/p', lastOpened: 0 }] as const),
    removeRecentWorkspace: vi.fn(async () => {}),
    onDidSwitchWorkspace: switchEmitter.event,
    _switchEmitter: switchEmitter,
  } as any;
}

describe('WorkspaceService — unhosted defaults', () => {
  it('activeWorkspace/folders/workspaceName fall back when no host bound', () => {
    const s = new WorkspaceService();
    expect(s.activeWorkspace).toBeUndefined();
    expect(s.folders).toEqual([]);
    expect(s.workspaceName).toBe('Parallx');
    expect(s.isRestored).toBe(false);
  });

  it('mutators are no-ops without host', () => {
    const s = new WorkspaceService();
    expect(() => s.addFolder(URI.parse('file:///a'))).not.toThrow();
    expect(() => s.removeFolder(URI.parse('file:///a'))).not.toThrow();
    expect(() => s.updateFolders([{ uri: URI.parse('file:///a') }])).not.toThrow();
    s.requestSave();
    expect(s.getWorkspaceFolder(URI.parse('file:///a'))).toBeUndefined();
    expect(s.workbenchState).toBe(1);
  });

  it('save resolves silently without host; recents returns []', async () => {
    const s = new WorkspaceService();
    await expect(s.save()).resolves.toBeUndefined();
    await expect(s.getRecentWorkspaces()).resolves.toEqual([]);
    await expect(s.removeRecentWorkspace('x')).resolves.toBeUndefined();
  });

  it('createWorkspace / switchWorkspace throw before host bound', async () => {
    const s = new WorkspaceService();
    await expect(s.createWorkspace('x')).rejects.toThrow(/not initialized/);
    await expect(s.switchWorkspace('id')).rejects.toThrow(/not initialized/);
  });
});

describe('WorkspaceService — host delegation', () => {
  it('setHost exposes workspace + delegates create/switch/recents/save', async () => {
    const ws = mkWorkspace('demo');
    const host = mkHost(ws);
    const s = new WorkspaceService();
    s.setHost(host);

    expect(s.activeWorkspace).toBe(ws);
    expect(s.workspaceName).toBe('demo');
    expect(s.workbenchState).toBe(2);

    await s.createWorkspace('NewWs', '/p', true);
    expect(host.createWorkspace).toHaveBeenCalledWith('NewWs', '/p', true);

    await s.switchWorkspace('id-1');
    expect(host.switchWorkspace).toHaveBeenCalledWith('id-1');

    const recents = await s.getRecentWorkspaces();
    expect(recents.length).toBe(1);

    await s.save();
    expect(host._workspaceSaver.save).toHaveBeenCalled();

    s.requestSave();
    expect(host._workspaceSaver.requestSave).toHaveBeenCalled();
  });

  it('forwards workspace folder mutators to active workspace', () => {
    const ws = mkWorkspace('x');
    const host = mkHost(ws);
    const s = new WorkspaceService();
    s.setHost(host);
    const u = URI.parse('file:///x');
    s.addFolder(u, 'A');
    expect(ws.addFolder).toHaveBeenCalledWith(u, 'A');
    s.removeFolder(u);
    expect(ws.removeFolder).toHaveBeenCalledWith(u);
    s.updateFolders([{ uri: u, name: 'A' }, { uri: URI.parse('file:///y') }]);
    expect(ws.setFolders).toHaveBeenCalled();
    const passed = (ws.setFolders.mock.calls[0][0]) as any[];
    expect(passed.length).toBe(2);
    expect(passed[0]).toMatchObject({ uri: u, name: 'A', index: 0 });
    expect(passed[1].name).toBeDefined(); // defaults to basename
  });

  it('updateFolders is a no-op when host not bound', () => {
    const s = new WorkspaceService();
    expect(() => s.updateFolders([{ uri: URI.parse('file:///a') }])).not.toThrow();
  });
});

describe('WorkspaceService — event forwarding', () => {
  it('onDidSwitchWorkspace fires onDidChangeWorkspace and rebinds folder events', () => {
    const ws1 = mkWorkspace('one');
    const host = mkHost(ws1);
    const s = new WorkspaceService();
    s.setHost(host);

    const seen: any[] = [];
    s.onDidChangeWorkspace(w => seen.push(w));

    const ws2 = mkWorkspace('two');
    host._switchEmitter.fire(ws2);
    expect(seen.length).toBe(1);

    // Folder events from ws2 propagate; ws1 events do NOT (sub disposed)
    const folderEvents: any[] = [];
    s.onDidChangeFolders(e => folderEvents.push(e));
    ws2._foldersEmitter.fire({ added: [], removed: [], changed: [] });
    ws1._foldersEmitter.fire({ added: [{ x: 1 }], removed: [], changed: [] });
    expect(folderEvents.length).toBe(1);
  });

  it('folder change requests workspace save', () => {
    const ws = mkWorkspace();
    const host = mkHost(ws);
    const s = new WorkspaceService();
    s.setHost(host);
    ws._foldersEmitter.fire({ added: [], removed: [], changed: [] });
    expect(host._workspaceSaver.requestSave).toHaveBeenCalled();
  });

  it('state and rename events propagate', () => {
    const ws = mkWorkspace();
    const host = mkHost(ws);
    const s = new WorkspaceService();
    s.setHost(host);
    const states: number[] = [];
    const names: string[] = [];
    s.onDidChangeWorkbenchState(v => states.push(v));
    s.onDidRename(n => names.push(n));
    ws._stateEmitter.fire(3);
    ws._renameEmitter.fire('newName');
    expect(states).toEqual([3]);
    expect(names).toEqual(['newName']);
  });
});

describe('WorkspaceService — restored flag', () => {
  it('markRestored flips isRestored and fires onDidRestoreState', () => {
    const s = new WorkspaceService();
    const heard: any[] = [];
    s.onDidRestoreState(v => heard.push(v));
    const state = { foo: 1 } as any;
    s.markRestored(state);
    expect(s.isRestored).toBe(true);
    expect(heard).toEqual([state]);
  });
});

describe('WorkspaceService — dispose', () => {
  it('dispose cleans folder subscriptions; later workspace events do not fire', () => {
    const ws = mkWorkspace();
    const host = mkHost(ws);
    const s = new WorkspaceService();
    s.setHost(host);
    const events: any[] = [];
    s.onDidChangeFolders(e => events.push(e));
    s.dispose();
    ws._foldersEmitter.fire({ added: [], removed: [], changed: [] });
    expect(events.length).toBe(0);
  });
});
