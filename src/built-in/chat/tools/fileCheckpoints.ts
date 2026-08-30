// fileCheckpoints.ts — HARNESS.md §2.2: recovery over permission.
//
// Before any file mutation (fs_write_file overwrite, fs_edit_file,
// fs_delete_file), the prior state is checkpointed so a bad change is a
// /rewind away from undone. Canvas pages already have DB revisions; files
// had NOTHING — this is the missing half of the safety net that makes
// default-allow trustworthy. Upstream pattern: Claude Code checkpoints file
// edits per session and restores them via /rewind.
//
// Scope, stated plainly: checkpoints are in-memory for the app run (ring of
// CHECKPOINT_CAP entries), matching Claude Code's session-scoped model. The
// deep safety nets beneath this remain trash (deletes) and git.
//
// Module-level store, same pattern as toolResourceRegistry (M85 Slice C):
// write tools and the /rewind command import it directly instead of
// threading yet another parameter through the registration chain.

import type { IBuiltInToolFileSystem, IBuiltInToolFileWriter } from '../chatTypes.js';

export interface IFileCheckpointEntry {
  /** Monotonic id, 1-based within this app run. */
  readonly id: number;
  /** Workspace-relative path of the mutated file. */
  readonly path: string;
  /** Content before the mutation; null = the file did not exist. */
  readonly priorContent: string | null;
  /** Tool (or 'rewind') that caused the mutation. */
  readonly tool: string;
  /** Model-written intent for the mutation, when provided (§2.1). */
  readonly intent?: string;
  /** Unix ms. */
  readonly at: number;
}

const CHECKPOINT_CAP = 50;

interface ICheckpointEnvironment {
  readonly fs?: IBuiltInToolFileSystem;
  readonly writer?: IBuiltInToolFileWriter;
  readonly workspaceRoot?: string;
}

let _env: ICheckpointEnvironment = {};
let _entries: IFileCheckpointEntry[] = [];
let _nextId = 1;

/** Called once from registerBuiltInTools; rebinding on re-registration is fine. */
export function bindCheckpointEnvironment(env: ICheckpointEnvironment): void {
  _env = env;
}

export function recordCheckpoint(
  entry: Omit<IFileCheckpointEntry, 'id' | 'at'>,
): IFileCheckpointEntry {
  const full: IFileCheckpointEntry = { ...entry, id: _nextId++, at: Date.now() };
  _entries.push(full);
  if (_entries.length > CHECKPOINT_CAP) {
    _entries = _entries.slice(_entries.length - CHECKPOINT_CAP);
  }
  return full;
}

/** Newest first. */
export function listCheckpoints(limit = 10): readonly IFileCheckpointEntry[] {
  return [..._entries].reverse().slice(0, Math.max(1, limit));
}

export function getCheckpoint(id: number): IFileCheckpointEntry | undefined {
  return _entries.find((e) => e.id === id);
}

export function latestCheckpoint(): IFileCheckpointEntry | undefined {
  return _entries.length > 0 ? _entries[_entries.length - 1] : undefined;
}

export interface IRevertResult {
  readonly ok: boolean;
  readonly message: string;
}

/**
 * Restore the file state a checkpoint captured. The current state is
 * checkpointed first (tool 'rewind'), so a revert is itself revertible.
 */
export async function revertCheckpoint(id: number): Promise<IRevertResult> {
  const entry = getCheckpoint(id);
  if (!entry) {
    return { ok: false, message: `No checkpoint #${id} — see the list with /rewind.` };
  }
  const { fs, writer, workspaceRoot } = _env;
  if (!writer) {
    return { ok: false, message: 'File writer is not available — no workspace folder is open.' };
  }

  // Capture the CURRENT state as the inverse checkpoint before touching it.
  let currentContent: string | null = null;
  if (fs) {
    try {
      if (await fs.exists(entry.path)) {
        currentContent = (await fs.readFileContent(entry.path)).content;
      }
    } catch {
      // Unreadable current state — the inverse checkpoint records absence.
    }
  }

  if (entry.priorContent !== null) {
    try {
      await writer.writeFile(entry.path, entry.priorContent);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, message: `Failed to restore "${entry.path}": ${msg}` };
    }
    recordCheckpoint({ path: entry.path, priorContent: currentContent, tool: 'rewind', intent: `Undo of checkpoint #${entry.id}` });
    return { ok: true, message: `Restored "${entry.path}" to its state before checkpoint #${entry.id} (${entry.tool}).` };
  }

  // priorContent === null: the checkpointed mutation CREATED the file — revert
  // removes it (to trash, via the same bridge fs_delete_file uses).
  const electron = (globalThis as Record<string, unknown>).parallxElectron as Record<string, unknown> | undefined;
  const fsBridge = electron?.fs as { delete?: (path: string, options?: { useTrash?: boolean }) => Promise<{ error: { code: string; message: string } | null }> } | undefined;
  if (!fsBridge?.delete || !workspaceRoot) {
    return { ok: false, message: `Cannot remove "${entry.path}": no file system bridge available. Delete it manually from the explorer.` };
  }
  const absPath = (workspaceRoot.replace(/[\\/]$/, '') + '/' + entry.path.replace(/^[\\/]/, ''))
    .replace(/\//g, (globalThis as Record<string, unknown>).process ? '\\' : '/');
  const result = await fsBridge.delete(absPath, { useTrash: 'auto' as unknown as boolean });
  if (result.error) {
    return { ok: false, message: `Failed to remove "${entry.path}": ${result.error.message}` };
  }
  recordCheckpoint({ path: entry.path, priorContent: currentContent, tool: 'rewind', intent: `Undo of checkpoint #${entry.id}` });
  return { ok: true, message: `Removed "${entry.path}" (moved to trash) — it did not exist before checkpoint #${entry.id} (${entry.tool}).` };
}

/** Test-only: reset module state. */
export function _resetCheckpointsForTests(): void {
  _entries = [];
  _nextId = 1;
  _env = {};
}
