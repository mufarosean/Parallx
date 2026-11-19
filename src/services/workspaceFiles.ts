// workspaceFiles.ts — every file of the open workspace, for a tool that lets a person choose among them
//
// A picker over "any file" (a tool's Add… picker, anything a tool lets
// a person attach) needs the workspace's files with where each one is. The
// folders the app never shows as a person's own are left out: machinery
// (node_modules, .git, venv, caches: WATCH_IGNORE_SEGMENTS, the watcher's
// own list) and hidden folders (a name that starts with a dot, the app's own
// .parallx among them). The walk is breadth first and stops at `maxFiles`, so
// a huge folder never holds a picker up. Pure over its `readdir`: tested in
// tests/unit/workspaceFiles.test.ts.

import { WATCH_IGNORE_SEGMENTS } from './parallxIgnore.js';

/** One file of the workspace as a tool sees it. */
export interface WorkspaceFileInfo {
  /** Its file:// URI. */
  readonly uri: string;
  /** Its name, with its extension. */
  readonly name: string;
  /** Its path from its workspace folder, with forward slashes ("Readings/Week 1/Mack 1993.pdf"). */
  readonly relativePath: string;
  /** The name of the workspace folder it is in. */
  readonly folder: string;
}

/** An entry as a directory listing gives it: 1 a file, 2 a folder. */
export interface WorkspaceFilesEntry {
  readonly name: string;
  readonly uri: string;
  readonly type: number;
}

const SKIPPED = new Set(WATCH_IGNORE_SEGMENTS);

/** Is this folder one a person's files are never in? */
export function isSkippedFolder(name: string): boolean {
  return name.startsWith('.') || SKIPPED.has(name);
}

/** The default most files a walk returns. */
export const WORKSPACE_FILES_MAX = 20_000;

/**
 * Every file under `folders`, folder by folder, in listing order level by
 * level. A folder that cannot be read is passed over.
 */
export async function listWorkspaceFiles(
  folders: readonly { readonly uri: string; readonly name: string }[],
  readdir: (uri: string) => Promise<readonly WorkspaceFilesEntry[]>,
  maxFiles: number = WORKSPACE_FILES_MAX,
): Promise<WorkspaceFileInfo[]> {
  const out: WorkspaceFileInfo[] = [];
  for (const folder of folders) {
    let level: { uri: string; rel: string }[] = [{ uri: folder.uri, rel: '' }];
    while (level.length && out.length < maxFiles) {
      const next: { uri: string; rel: string }[] = [];
      const listings = await Promise.all(level.map((d) => readdir(d.uri).catch(() => [] as readonly WorkspaceFilesEntry[])));
      listings.forEach((entries, i) => {
        const parent = level[i]!;
        for (const e of entries) {
          if (!e || !e.name) continue;
          const rel = parent.rel ? `${parent.rel}/${e.name}` : e.name;
          if (e.type === 2) { if (!isSkippedFolder(e.name)) next.push({ uri: e.uri, rel }); continue; }
          if (e.type !== 1 || out.length >= maxFiles) continue;
          out.push({ uri: e.uri, name: e.name, relativePath: rel, folder: folder.name });
        }
      });
      level = next;
    }
  }
  return out;
}
