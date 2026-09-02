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
// Module-level store in the SERVICES layer, same pattern (and for the same
// gate-compliance reason) as toolResourceRegistry (M85 Slice C): the chat
// write tools and the openclaw /rewind command both import it, and neither
// tree may import from the other. File access is bound structurally so this
// module needs no chat-tree type imports.

/** Structural subset of the chat fs accessor — no cross-tree import. */
export interface ICheckpointFileReader {
  exists(relativePath: string): Promise<boolean>;
  readFileContent(relativePath: string): Promise<{ readonly content: string }>;
}

/** Structural subset of the chat writer accessor — no cross-tree import. */
export interface ICheckpointFileWriter {
  writeFile(relativePath: string, content: string): Promise<void>;
}

/** Move a workspace file to the trash; bound by the chat tools layer. */
export type CheckpointFileRemover = (relativePath: string) => Promise<{ readonly error: { readonly message: string } | null }>;

/** A single checkpoint never holds more than this (4 MB of text). */
export const CHECKPOINT_MAX_ENTRY_CHARS = 4 * 1024 * 1024;
/** The whole ring never holds more than this (24 MB of text). */
export const CHECKPOINT_MAX_TOTAL_CHARS = 24 * 1024 * 1024;

export interface IFileCheckpointEntry {
  /** Monotonic id, 1-based within this app run. */
  readonly id: number;
  /** Workspace-relative path of the mutated file. */
  readonly path: string;
  /**
   * Content before the mutation; null = the file did NOT exist (revert
   * removes it). A file that existed but could not be read is never
   * checkpointed at all — that distinction is what keeps /rewind from
   * deleting a real file (review fix 2026-09-02).
   */
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
  readonly fs?: ICheckpointFileReader;
  readonly writer?: ICheckpointFileWriter;
  readonly workspaceRoot?: string;
  /** The same trash path fs_delete_file uses; bound, never re-implemented. */
  readonly remove?: CheckpointFileRemover;
}

let _env: ICheckpointEnvironment = {};
let _entries: IFileCheckpointEntry[] = [];
let _nextId = 1;

/** Called once from registerBuiltInTools; rebinding on re-registration is fine. */
export function bindCheckpointEnvironment(env: ICheckpointEnvironment): void {
  _env = env;
}

/**
 * Record a checkpoint. Throws when the prior content exceeds the per-entry
 * cap (the caller reports "no checkpoint" honestly rather than holding a
 * multi-MB body in the renderer heap for the whole run). The ring is
 * bounded by count AND by total text, oldest evicted first.
 */
export function recordCheckpoint(
  entry: Omit<IFileCheckpointEntry, 'id' | 'at'>,
): IFileCheckpointEntry {
  const size = entry.priorContent?.length ?? 0;
  if (size > CHECKPOINT_MAX_ENTRY_CHARS) {
    throw new Error(`Checkpoint for "${entry.path}" skipped: ${size} chars exceeds the ${CHECKPOINT_MAX_ENTRY_CHARS} char cap.`);
  }
  const full: IFileCheckpointEntry = { ...entry, id: _nextId++, at: Date.now() };
  _entries.push(full);
  if (_entries.length > CHECKPOINT_CAP) {
    _entries = _entries.slice(_entries.length - CHECKPOINT_CAP);
  }
  let total = _entries.reduce((sum, e) => sum + (e.priorContent?.length ?? 0), 0);
  while (total > CHECKPOINT_MAX_TOTAL_CHARS && _entries.length > 1) {
    total -= _entries[0].priorContent?.length ?? 0;
    _entries = _entries.slice(1);
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
    return { ok: false, message: `No checkpoint #${id}. See the list with /rewind.` };
  }
  const { fs, writer, remove } = _env;
  if (!writer) {
    return { ok: false, message: 'File writer is not available: no workspace folder is open.' };
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
  // removes it (to trash, through the ONE remover fs_delete_file also uses).
  if (!remove) {
    return { ok: false, message: `Cannot remove "${entry.path}": no file system bridge available. Delete it manually from the explorer.` };
  }
  const result = await remove(entry.path);
  if (result.error) {
    return { ok: false, message: `Failed to remove "${entry.path}": ${result.error.message}` };
  }
  recordCheckpoint({ path: entry.path, priorContent: currentContent, tool: 'rewind', intent: `Undo of checkpoint #${entry.id}` });
  return { ok: true, message: `Removed "${entry.path}" (moved to trash). It did not exist before checkpoint #${entry.id} (${entry.tool}).` };
}

/** Test-only: reset module state. */
export function _resetCheckpointsForTests(): void {
  _entries = [];
  _nextId = 1;
  _env = {};
}
