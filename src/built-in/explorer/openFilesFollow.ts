// openFilesFollow.ts — an open file follows what the Explorer does to it.
//
// A file editor's tab is described by its file's path: the whole path, or
// (a text file in the workspace) the path from its workspace folder. Before
// the Explorer renames, moves or deletes a file, its tabs are closed, so
// each one's last save lands in the file while it is still there; after a
// rename or a move they are opened again under the new path. Closing a tab
// through the editors API waits for that last save.

import { URI } from '../../platform/uri.js';

interface OpenEditor { readonly id: string; readonly description: string; readonly isDirty: boolean }
export interface OpenFilesFollow {
  readonly editors: {
    readonly openEditors: readonly OpenEditor[];
    closeEditor(editorId: string): Promise<boolean>;
    openFileEditor(path: string): Promise<void>;
  };
  /** The workspace folders' paths: a text file's tab is described from one of them. */
  readonly roots: readonly string[];
}

const slashes = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '');
const isWholePath = (p: string): boolean => /^(\/|[A-Za-z]:\/)/.test(p);

/** The path an editor's description stands for, when it is under `path` (or is `path`); undefined otherwise. */
function pathUnder(editor: OpenEditor, path: string, roots: readonly string[]): string | undefined {
  const described = slashes(editor.description);
  if (!described) return undefined;
  const from = slashes(path).toLowerCase();
  const candidates = isWholePath(described) ? [described] : roots.map((root) => `${slashes(root)}/${described}`);
  return candidates.find((c) => c.toLowerCase() === from || c.toLowerCase().startsWith(`${from}/`));
}

/**
 * Do a rename, a move (`newPath` given) or a delete (`newPath` null) of
 * `path` with its open tabs closed first, and opened again after: under the
 * new path when the work succeeded, where they were when it threw. A rename
 * leaves a tab with unsaved changes as it is, so closing never drops or
 * questions the work in it; a delete closes every tab of what is deleted.
 */
export async function withOpenFilesFollowing<T>(follow: OpenFilesFollow, path: string, newPath: string | null, work: () => Promise<T>): Promise<T> {
  const closed: string[] = [];
  for (const editor of [...follow.editors.openEditors]) {
    const at = pathUnder(editor, path, follow.roots);
    if (!at || (newPath !== null && editor.isDirty)) continue;
    try { if (await follow.editors.closeEditor(editor.id)) closed.push(at); } catch (err) { console.warn('[Explorer] an open file could not be closed:', err); }
  }
  const reopen = async (to: (was: string) => string): Promise<void> => {
    for (const was of closed) {
      try { await follow.editors.openFileEditor(to(was)); } catch (err) { console.warn('[Explorer] a file could not be opened again:', err); }
    }
  };
  let result: T;
  try {
    result = await work();
  } catch (err) {
    await reopen((was) => was);
    throw err;
  }
  if (newPath !== null) await reopen((was) => slashes(newPath) + was.slice(slashes(path).length));
  return result;
}

/** A file operation's result, thrown when it says it failed (the shell's file calls answer `{ error }` instead of throwing). */
export async function orThrow(op: Promise<{ error?: { message?: string } } | undefined>, what: string): Promise<undefined> {
  const result = await op;
  if (result?.error) throw new Error(result.error.message || what);
}

/**
 * Move or rename on disk through the app's file service (`fs`, the
 * workspace.fs of the api), so whoever keeps a link to the file hears where it
 * went (workspace.onDidMoveFiles). The bare bridge only when there is no
 * service.
 */
export async function moveOnDisk(fs: { rename(source: string, target: string): Promise<void> } | undefined, fromPath: string, toPath: string, what = 'Move failed'): Promise<undefined> {
  if (fs) {
    try { await fs.rename(URI.file(fromPath).toString(), URI.file(toPath).toString()); } catch (err) { throw new Error((err as Error)?.message || what); }
    return undefined;
  }
  const electronFs = (globalThis as { parallxElectron?: { fs?: { rename(a: string, b: string): Promise<{ error?: { message?: string } } | undefined> } } }).parallxElectron?.fs;
  return electronFs ? orThrow(electronFs.rename(fromPath, toPath), what) : undefined;
}
