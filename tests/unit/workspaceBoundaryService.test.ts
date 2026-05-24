/**
 * Pin-the-invariant: WorkspaceBoundaryService.
 *
 * The path-traversal defense at the agent boundary. Every agent filesystem
 * access goes through `assertUriWithinWorkspace`. Zero prior unit coverage.
 *
 * Pins:
 *  - Only `file:` URIs are ever considered "within workspace" — every other
 *    scheme (untitled, vscode-userdata, https, etc.) is rejected.
 *  - No workspace folders → `assertUriWithinWorkspace` throws with a distinct
 *    "no workspace folders open" message (so callers can distinguish setup
 *    failure from out-of-bounds access).
 *  - Boundary check: `targetPath === folderPath` OR `targetPath.startsWith(folderPath + '/')`.
 *    This is the critical traversal-defense detail — checking only `startsWith(folderPath)`
 *    would let `/workspace-evil/secret.txt` slip past a `/workspace` folder.
 *  - Case-insensitive comparison (Windows-friendly): mixed-case roots and paths still match.
 *  - Multiple folders: any folder match passes; no folder match fails.
 *  - assertUriWithinWorkspace error messages include the requester label
 *    (callers depend on this for diagnostics).
 */

import { describe, expect, it } from 'vitest';
import { WorkspaceBoundaryService } from '../../src/services/workspaceBoundaryService';
import { URI } from '../../src/platform/uri';
import type { WorkspaceFolder } from '../../src/workspace/workspaceTypes';

function folder(fsPath: string, idx = 0): WorkspaceFolder {
  return { uri: URI.file(fsPath), name: `f-${idx}`, index: idx };
}

function makeService(folders: WorkspaceFolder[] = []) {
  const svc = new WorkspaceBoundaryService();
  svc.setHost({ folders });
  return svc;
}

describe('WorkspaceBoundaryService.isUriWithinWorkspace', () => {
  it('returns false when no host has been set', () => {
    const svc = new WorkspaceBoundaryService();
    expect(svc.isUriWithinWorkspace(URI.file('/anything'))).toBe(false);
  });

  it('returns false when host has zero folders', () => {
    const svc = makeService([]);
    expect(svc.isUriWithinWorkspace(URI.file('/anything'))).toBe(false);
  });

  it('returns false for non-file URI schemes', () => {
    const svc = makeService([folder('/workspace')]);
    expect(svc.isUriWithinWorkspace(URI.parse('untitled:/Untitled-1'))).toBe(false);
    expect(svc.isUriWithinWorkspace(URI.parse('https://example.com/x'))).toBe(false);
    expect(svc.isUriWithinWorkspace(URI.parse('vscode-userdata:/foo'))).toBe(false);
  });

  it('returns true for the folder root itself', () => {
    const svc = makeService([folder('/workspace')]);
    expect(svc.isUriWithinWorkspace(URI.file('/workspace'))).toBe(true);
  });

  it('returns true for descendants of a folder', () => {
    const svc = makeService([folder('/workspace')]);
    expect(svc.isUriWithinWorkspace(URI.file('/workspace/a.txt'))).toBe(true);
    expect(svc.isUriWithinWorkspace(URI.file('/workspace/nested/dir/b.txt'))).toBe(true);
  });

  it('returns false for siblings that share a name PREFIX (traversal defense)', () => {
    // This is the security-critical test: `/workspace-evil/secret`
    // must NOT match a folder rooted at `/workspace`. Naive startsWith
    // (without the trailing slash) would falsely accept this.
    const svc = makeService([folder('/workspace')]);
    expect(svc.isUriWithinWorkspace(URI.file('/workspace-evil/secret.txt'))).toBe(false);
    expect(svc.isUriWithinWorkspace(URI.file('/workspaceextra'))).toBe(false);
  });

  it('returns false for paths outside the folder', () => {
    const svc = makeService([folder('/workspace')]);
    expect(svc.isUriWithinWorkspace(URI.file('/etc/passwd'))).toBe(false);
    expect(svc.isUriWithinWorkspace(URI.file('/home/user/file.txt'))).toBe(false);
  });

  it('matches case-insensitively (Windows-friendly)', () => {
    const svc = makeService([folder('/Workspace/Project')]);
    expect(svc.isUriWithinWorkspace(URI.file('/workspace/project/a.txt'))).toBe(true);
    expect(svc.isUriWithinWorkspace(URI.file('/WORKSPACE/PROJECT/B.TXT'))).toBe(true);
  });

  it('returns true if ANY of multiple folders contain the path', () => {
    const svc = makeService([folder('/a'), folder('/b'), folder('/c')]);
    expect(svc.isUriWithinWorkspace(URI.file('/a/x'))).toBe(true);
    expect(svc.isUriWithinWorkspace(URI.file('/b/y/z'))).toBe(true);
    expect(svc.isUriWithinWorkspace(URI.file('/c'))).toBe(true);
    expect(svc.isUriWithinWorkspace(URI.file('/d/x'))).toBe(false);
  });
});

describe('WorkspaceBoundaryService.assertUriWithinWorkspace', () => {
  it('throws a distinct "no workspace folders open" error when host has no folders', () => {
    const svc = makeService([]);
    expect(() => svc.assertUriWithinWorkspace(URI.file('/anything'), 'TestCaller'))
      .toThrow(/no workspace folders open/);
  });

  it('throws an "outside workspace folders" error for an out-of-bounds file URI', () => {
    const svc = makeService([folder('/workspace')]);
    expect(() => svc.assertUriWithinWorkspace(URI.file('/etc/passwd'), 'TestCaller'))
      .toThrow(/outside workspace folders/);
  });

  it('throws "outside workspace folders" for prefix-traversal attempts', () => {
    const svc = makeService([folder('/workspace')]);
    expect(() => svc.assertUriWithinWorkspace(URI.file('/workspace-evil/x'), 'TestCaller'))
      .toThrow(/outside workspace folders/);
  });

  it('throws for non-file schemes (either the boundary check or the fsPath rendering must reject)', () => {
    // Belt-and-suspenders: `isUriWithinWorkspace` returns false for any
    // non-file URI, so assert throws. The exact message depends on whether
    // `uri.fsPath` (used in the error message) bails out first or the
    // boundary check throws; both outcomes are correct — we just need a throw.
    const svc = makeService([folder('/workspace')]);
    expect(() => svc.assertUriWithinWorkspace(URI.parse('untitled:/Untitled-1'), 'TestCaller'))
      .toThrow();
  });

  it('does NOT throw when uri is within a folder', () => {
    const svc = makeService([folder('/workspace')]);
    expect(() => svc.assertUriWithinWorkspace(URI.file('/workspace/file.txt'), 'TestCaller')).not.toThrow();
    expect(() => svc.assertUriWithinWorkspace(URI.file('/workspace'), 'TestCaller')).not.toThrow();
  });

  it('error message includes the requester label (for diagnostics)', () => {
    const svc = makeService([folder('/workspace')]);
    expect(() => svc.assertUriWithinWorkspace(URI.file('/etc/passwd'), 'AgentExecutor'))
      .toThrow(/AgentExecutor/);
    const svc2 = makeService([]);
    expect(() => svc2.assertUriWithinWorkspace(URI.file('/etc/passwd'), 'BoundaryCheck'))
      .toThrow(/BoundaryCheck/);
  });
});

describe('WorkspaceBoundaryService — host swap', () => {
  it('reflects folder changes after setHost is called again', () => {
    const svc = new WorkspaceBoundaryService();
    svc.setHost({ folders: [folder('/a')] });
    expect(svc.isUriWithinWorkspace(URI.file('/a/x'))).toBe(true);
    expect(svc.isUriWithinWorkspace(URI.file('/b/x'))).toBe(false);

    svc.setHost({ folders: [folder('/b')] });
    expect(svc.isUriWithinWorkspace(URI.file('/a/x'))).toBe(false);
    expect(svc.isUriWithinWorkspace(URI.file('/b/x'))).toBe(true);
  });

  it('folders getter returns empty array when host is unset', () => {
    const svc = new WorkspaceBoundaryService();
    expect(svc.folders).toEqual([]);
  });
});
