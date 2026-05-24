/**
 * Workspace folder canonical ownership (M81 §8 verification gate — closes §22 debt).
 *
 * Manifest M81 §8 listed `workspaceFolderCanonicalOwnership.test.ts` as a
 * required gate before Slice C merge. This file is that gate.
 *
 * The `Workspace` class is the single canonical owner of the open folder
 * set. Bugs here cascade into the file explorer, file watcher, search
 * results, and every extension that resolves a URI to a folder. The
 * invariants this guard locks in:
 *
 *   1. M53 single-folder constraint — a second `addFolder` is a rejected
 *      no-op (returns undefined, no event fires).
 *   2. Duplicate URI rejection — adding the same URI twice is a no-op.
 *   3. Folder ownership — `getWorkspaceFolder(uri)` returns the folder
 *      whose path is a prefix of `uri.path` (case-insensitive), or
 *      undefined when no folder owns it.
 *   4. State transitions — `EMPTY → FOLDER` on add, `FOLDER → EMPTY` on
 *      remove, with `onDidChangeState` firing exactly on the transition.
 *   5. setFolders atomic replace — emits `added`+`removed` once, reindexes.
 *   6. Reindex correctness — every folder's `index` matches its position.
 *   7. Serialize/restore round-trip preserves folder identity.
 *   8. removeFolder returns true/false correctly.
 *   9. Events fire on add/remove with correct payload; no event on no-op.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Workspace } from '../../src/workspace/workspace.js';
import { WorkbenchState } from '../../src/workspace/workspaceTypes.js';
import { URI } from '../../src/platform/uri.js';

describe('Workspace folder canonical ownership', () => {
  let ws: Workspace;

  beforeEach(() => {
    ws = Workspace.create('Test');
    // Silence the M53 single-folder warning during negative tests.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  // ── single-folder constraint ──────────────────────────────────────────

  it('starts empty', () => {
    expect(ws.folders).toEqual([]);
    expect(ws.state).toBe(WorkbenchState.EMPTY);
  });

  it('accepts the first folder', () => {
    const folder = ws.addFolder(URI.file('/projects/alpha'));
    expect(folder).toBeDefined();
    expect(ws.folders.length).toBe(1);
    expect(ws.state).toBe(WorkbenchState.FOLDER);
  });

  it('rejects a second folder (M53 single-folder constraint)', () => {
    ws.addFolder(URI.file('/projects/alpha'));
    const second = ws.addFolder(URI.file('/projects/beta'));
    expect(second).toBeUndefined();
    expect(ws.folders.length).toBe(1);
    expect(ws.folders[0].uri.path).toBe('/projects/alpha');
  });

  it('rejects duplicate URI add', () => {
    ws.addFolder(URI.file('/projects/alpha'));
    const dup = ws.addFolder(URI.file('/projects/alpha'));
    expect(dup).toBeUndefined();
    expect(ws.folders.length).toBe(1);
  });

  // ── ownership lookup ──────────────────────────────────────────────────

  it('getWorkspaceFolder returns owner for the folder URI itself', () => {
    ws.addFolder(URI.file('/projects/alpha'));
    const owner = ws.getWorkspaceFolder(URI.file('/projects/alpha'));
    expect(owner?.uri.path).toBe('/projects/alpha');
  });

  it('getWorkspaceFolder returns owner for nested URIs', () => {
    ws.addFolder(URI.file('/projects/alpha'));
    const owner = ws.getWorkspaceFolder(URI.file('/projects/alpha/src/main.ts'));
    expect(owner?.uri.path).toBe('/projects/alpha');
  });

  it('getWorkspaceFolder returns undefined for unrelated URIs', () => {
    ws.addFolder(URI.file('/projects/alpha'));
    expect(ws.getWorkspaceFolder(URI.file('/elsewhere'))).toBeUndefined();
  });

  it('getWorkspaceFolder does NOT match a sibling whose path shares a prefix-substring', () => {
    ws.addFolder(URI.file('/projects/alpha'));
    // /projects/alphabet would match a naive `startsWith` without the
    // trailing-slash guard. The canonical owner is undefined here.
    expect(ws.getWorkspaceFolder(URI.file('/projects/alphabet/x.ts'))).toBeUndefined();
  });

  it('getWorkspaceFolder is case-insensitive', () => {
    ws.addFolder(URI.file('/Projects/Alpha'));
    const owner = ws.getWorkspaceFolder(URI.file('/projects/alpha/src/main.ts'));
    expect(owner?.uri.path).toBe('/Projects/Alpha');
  });

  // ── removeFolder ──────────────────────────────────────────────────────

  it('removeFolder returns true and drops the folder', () => {
    ws.addFolder(URI.file('/a'));
    expect(ws.removeFolder(URI.file('/a'))).toBe(true);
    expect(ws.folders.length).toBe(0);
    expect(ws.state).toBe(WorkbenchState.EMPTY);
  });

  it('removeFolder returns false for an unknown URI', () => {
    expect(ws.removeFolder(URI.file('/never-added'))).toBe(false);
  });

  // ── state transitions and events ──────────────────────────────────────

  it('fires onDidChangeFolders with added on first folder', () => {
    const events: { added: unknown[]; removed: unknown[] }[] = [];
    ws.onDidChangeFolders((e) => events.push({ added: [...e.added], removed: [...e.removed] }));
    ws.addFolder(URI.file('/a'));
    expect(events.length).toBe(1);
    expect(events[0].added.length).toBe(1);
    expect(events[0].removed.length).toBe(0);
  });

  it('does NOT fire onDidChangeFolders on rejected duplicate add', () => {
    ws.addFolder(URI.file('/a'));
    const events: unknown[] = [];
    ws.onDidChangeFolders((e) => events.push(e));
    const result = ws.addFolder(URI.file('/a'));
    expect(result).toBeUndefined();
    expect(events.length).toBe(0);
  });

  it('does NOT fire onDidChangeFolders on rejected second-folder add', () => {
    ws.addFolder(URI.file('/a'));
    const events: unknown[] = [];
    ws.onDidChangeFolders((e) => events.push(e));
    const result = ws.addFolder(URI.file('/b'));
    expect(result).toBeUndefined();
    expect(events.length).toBe(0);
  });

  it('fires onDidChangeState only on EMPTY↔FOLDER transition', () => {
    const states: WorkbenchState[] = [];
    ws.onDidChangeState((s) => states.push(s));
    ws.addFolder(URI.file('/a')); // EMPTY → FOLDER
    ws.removeFolder(URI.file('/a')); // FOLDER → EMPTY
    expect(states).toEqual([WorkbenchState.FOLDER, WorkbenchState.EMPTY]);
  });

  // ── setFolders atomic replace ─────────────────────────────────────────

  it('setFolders replaces atomically and fires added+removed once', () => {
    ws.addFolder(URI.file('/old'));
    const events: { added: number; removed: number }[] = [];
    ws.onDidChangeFolders((e) => events.push({ added: e.added.length, removed: e.removed.length }));
    ws.setFolders([{ uri: URI.file('/new'), name: 'new', index: 0 }]);
    expect(events.length).toBe(1);
    expect(events[0].added).toBe(1);
    expect(events[0].removed).toBe(1);
    expect(ws.folders[0].uri.path).toBe('/new');
  });

  it('setFolders reindexes contiguously from 0', () => {
    ws.setFolders([
      { uri: URI.file('/x'), name: 'x', index: 99 }, // wrong index — should be normalized
    ]);
    expect(ws.folders[0].index).toBe(0);
  });

  // ── serialize / restore round-trip ────────────────────────────────────

  it('serializeFolders → restoreFolders is a faithful round-trip', () => {
    ws.addFolder(URI.file('/projects/alpha'), 'Alpha');
    const data = ws.serializeFolders();
    const ws2 = Workspace.create('Restored');
    ws2.restoreFolders(data);
    expect(ws2.folders.length).toBe(1);
    expect(ws2.folders[0].uri.path).toBe('/projects/alpha');
    expect(ws2.folders[0].name).toBe('Alpha');
    expect(ws2.folders[0].index).toBe(0);
    expect(ws2.state).toBe(WorkbenchState.FOLDER);
  });
});
