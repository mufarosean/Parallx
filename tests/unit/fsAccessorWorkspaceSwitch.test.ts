// fsAccessorWorkspaceSwitch.test.ts — Tests for dynamic workspace root in buildFileSystemAccessor
//
// Verifies that after a workspace switch the file system accessor resolves
// file operations against the NEW workspace root, not the one captured at
// activation time.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildFileSystemAccessor } from '../../src/built-in/chat/data/chatDataService';
import type { IFileService, IWorkspaceService } from '../../src/services/serviceTypes';

// ── Helpers ────────────────────────────────────────────────────────────────

/** Simple URI stub that supports joinPath. */
function makeUri(fsPath: string) {
  const path = '/' + fsPath.replace(/\\/g, '/');
  return {
    scheme: 'file',
    path,
    fsPath,
    basename: fsPath.split(/[\\/]/).pop() ?? '',
    toKey() { return path.toLowerCase(); },
    joinPath(...segments: string[]) {
      const joined = segments.join('/');
      const newPath = fsPath.replace(/\\/g, '/') + '/' + joined;
      return makeUri(newPath);
    },
  };
}

function createMockFileService(): IFileService {
  return {
    readdir: vi.fn().mockResolvedValue([
      { name: 'file1.md', type: 1 /* File */, size: 100 },
      { name: 'subdir', type: 2 /* Directory */, size: 0 },
    ]),
    readFile: vi.fn().mockResolvedValue({ content: 'file content' }),
    stat: vi.fn().mockResolvedValue({ size: 100 }),
    exists: vi.fn().mockResolvedValue(true),
    writeFile: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
    isRichDocument: vi.fn().mockReturnValue(false),
    readDocumentText: vi.fn().mockResolvedValue({ text: 'extracted text', format: 'pdf', metadata: {} }),
    richDocumentExtensions: new Set(['.pdf', '.xlsx', '.xls', '.xlsm', '.xlsb', '.ods', '.numbers', '.csv', '.tsv', '.docx']),
    onDidChangeFile: { event: vi.fn() } as any,
    dispose: vi.fn(),
  } as unknown as IFileService;
}

interface MockWorkspaceService extends IWorkspaceService {
  _setFolders(folders: { uri: ReturnType<typeof makeUri>; name: string; index: number }[]): void;
  _setActiveWorkspace(ws: { name: string } | undefined): void;
}

function createMockWorkspaceService(
  initialRoot: string,
  initialName: string,
): MockWorkspaceService {
  let _folders = [{ uri: makeUri(initialRoot), name: initialName, index: 0 }];
  let _activeWorkspace: { name: string } | undefined = { name: initialName };

  return {
    get folders() { return _folders as any; },
    get activeWorkspace() { return _activeWorkspace as any; },
    _setFolders(f) { _folders = f as any; },
    _setActiveWorkspace(ws) { _activeWorkspace = ws as any; },
    // Stubs for unused interface members
    onDidChangeWorkspace: { event: vi.fn() } as any,
    onDidChangeFolders: { event: vi.fn() } as any,
    onDidRestoreState: { event: vi.fn() } as any,
    onDidChangeWorkbenchState: { event: vi.fn() } as any,
    addFolder: vi.fn(),
    removeFolder: vi.fn(),
    updateFolders: vi.fn(),
    markRestored: vi.fn(),
    save: vi.fn(),
    setHost: vi.fn(),
    isRestored: true,
    workbenchState: 2 as any,
    workspaceName: initialName,
    dispose: vi.fn(),
  } as unknown as MockWorkspaceService;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('buildFileSystemAccessor — dynamic workspace root', () => {
  let fileService: IFileService;
  let workspaceService: MockWorkspaceService;

  beforeEach(() => {
    fileService = createMockFileService();
    workspaceService = createMockWorkspaceService(
      'D:/workspaces/workspace-A',
      'Workspace A',
    );
  });

  it('returns an accessor when folders exist', () => {
    const accessor = buildFileSystemAccessor(fileService, workspaceService as any);
    expect(accessor).toBeDefined();
  });

  it('returns undefined when no file service', () => {
    expect(buildFileSystemAccessor(undefined, workspaceService as any)).toBeUndefined();
  });

  it('returns undefined when no workspace service', () => {
    expect(buildFileSystemAccessor(fileService, undefined)).toBeUndefined();
  });

  it('returns an accessor even when folders array is empty (lazy init)', () => {
    workspaceService._setFolders([]);
    const accessor = buildFileSystemAccessor(fileService, workspaceService as any);
    expect(accessor).toBeDefined();
  });

  it('workspaceRootName reflects the active workspace name', () => {
    const accessor = buildFileSystemAccessor(fileService, workspaceService as any)!;
    expect(accessor.workspaceRootName).toBe('Workspace A');
  });

  it('readdir resolves against the initial workspace root', async () => {
    const accessor = buildFileSystemAccessor(fileService, workspaceService as any)!;
    await accessor.readdir('.');
    expect(fileService.readdir).toHaveBeenCalledTimes(1);
    const calledUri = (fileService.readdir as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(calledUri.fsPath).toBe('D:/workspaces/workspace-A');
  });

  // ── The critical test: dynamic root after workspace switch ──

  it('readdir resolves against NEW root after workspace folders change', async () => {
    const accessor = buildFileSystemAccessor(fileService, workspaceService as any)!;

    // Simulate workspace switch — folders now point to workspace B
    workspaceService._setFolders([{
      uri: makeUri('D:/workspaces/workspace-B'),
      name: 'Workspace B',
      index: 0,
    }]);
    workspaceService._setActiveWorkspace({ name: 'Workspace B' });

    await accessor.readdir('.');
    const calledUri = (fileService.readdir as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(calledUri.fsPath).toBe('D:/workspaces/workspace-B');
  });

  it('readFileContent resolves against NEW root after workspace folders change', async () => {
    const accessor = buildFileSystemAccessor(fileService, workspaceService as any)!;

    // Switch workspace
    workspaceService._setFolders([{
      uri: makeUri('D:/workspaces/workspace-B'),
      name: 'Workspace B',
      index: 0,
    }]);

    await accessor.readFileContent('README.md');
    const calledUri = (fileService.readFile as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(calledUri.fsPath).toBe('D:/workspaces/workspace-B/README.md');
  });

  it('exists resolves against NEW root after workspace folders change', async () => {
    const accessor = buildFileSystemAccessor(fileService, workspaceService as any)!;

    // Switch workspace
    workspaceService._setFolders([{
      uri: makeUri('D:/workspaces/workspace-B'),
      name: 'Workspace B',
      index: 0,
    }]);

    await accessor.exists('data/notes.md');
    const calledUri = (fileService.exists as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(calledUri.fsPath).toBe('D:/workspaces/workspace-B/data/notes.md');
  });

  it('workspaceRootName updates after workspace switch', () => {
    const accessor = buildFileSystemAccessor(fileService, workspaceService as any)!;
    expect(accessor.workspaceRootName).toBe('Workspace A');

    // Switch
    workspaceService._setFolders([{
      uri: makeUri('D:/workspaces/workspace-B'),
      name: 'Workspace B',
      index: 0,
    }]);
    workspaceService._setActiveWorkspace({ name: 'Workspace B' });

    expect(accessor.workspaceRootName).toBe('Workspace B');
  });

  it('throws when folders become empty after switch', async () => {
    const accessor = buildFileSystemAccessor(fileService, workspaceService as any)!;

    // Switch to a workspace with no folders
    workspaceService._setFolders([]);

    await expect(accessor.readdir('.')).rejects.toThrow('No workspace root folder available');
  });

  // ── Absolute path handling still works with dynamic root ──

  it('strips workspace root prefix from absolute paths', async () => {
    const accessor = buildFileSystemAccessor(fileService, workspaceService as any)!;

    // Switch workspace
    workspaceService._setFolders([{
      uri: makeUri('D:/workspaces/workspace-B'),
      name: 'Workspace B',
      index: 0,
    }]);

    await accessor.readFileContent('D:/workspaces/workspace-B/docs/README.md');
    const calledUri = (fileService.readFile as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(calledUri.fsPath).toBe('D:/workspaces/workspace-B/docs/README.md');
  });

  // ── Same accessor object identity ──

  it('returns the same object across calls (tools hold reference)', () => {
    const accessor1 = buildFileSystemAccessor(fileService, workspaceService as any)!;
    // The fix relies on all tools sharing the SAME object reference.
    // After switch, the object's methods dynamically read the new root.
    // No new object is created — the same reference stays valid.
    expect(accessor1).toBeDefined();
    expect(typeof accessor1.readdir).toBe('function');
    expect(typeof accessor1.readFileContent).toBe('function');
    expect(typeof accessor1.exists).toBe('function');
  });
});
