// homeSource.ts — the explorer's source for Home: recently opened files.
//
// What was opened comes from the core RecentsService (the one owner of
// recency). Each file is shown with its folder and, when it is plain text,
// its opening words. Registered while the explorer runs.

import type { IDisposable } from '../../platform/lifecycle.js';
import { registerHomeSource, type HomeItem } from '../../services/homeSources.js';
import type { IRecentsServiceShape } from '../../services/recentsService.js';
import { FILE_TYPE_MAP } from '../../ui/fileTypeIcons.js';

interface HomeSourceApi {
  editors?: { openFileEditor?(uri: string, options?: { pinned?: boolean }): Promise<void> };
  workspace?: {
    readonly workspaceFolders?: readonly { uri: string; name: string }[];
    readonly fs?: { readFile(uri: string): Promise<{ content: string; encoding: string }> };
  };
}

const TEXT_TYPES = new Set(['md', 'markdown', 'txt', 'csv', 'tsv', 'json', 'yaml', 'yml', 'log']);
const SUMMARY_MAX = 160;

/** The first words of a text file, markdown marks dropped. */
export function fileOpeningWords(text: string, max = SUMMARY_MAX): string {
  const words = text.slice(0, 4000).replace(/^---[\s\S]*?---/, '').replace(/[#>*_`|]+/g, ' ').replace(/\s+/g, ' ').trim();
  return words.length > max ? `${words.slice(0, max).replace(/\s+\S*$/, '')}…` : words;
}

const decoded = (uri: string): string => { try { return decodeURIComponent(uri); } catch { return uri; } };

export function registerExplorerHomeSource(api: HomeSourceApi, recents: IRecentsServiceShape): IDisposable {
  const summaries = new Map<string, string>();
  const toHome = async (uri: string, title: string, ts: number): Promise<HomeItem> => {
    const path = decoded(uri).replace(/\\/g, '/');
    const name = title || path.slice(path.lastIndexOf('/') + 1);
    const ext = (name.match(/\.([a-zA-Z0-9]+)$/)?.[1] ?? '').toLowerCase();
    const folder = api.workspace?.workspaceFolders?.find((f) => path.startsWith(decoded(f.uri).replace(/\\/g, '/')));
    const inside = folder ? path.slice(decoded(folder.uri).length).replace(/^\/+/, '') : '';
    const where = inside.includes('/') ? inside.slice(0, inside.lastIndexOf('/')).split('/').join(' / ') : folder?.name;
    const stamp = `${uri}@${ts}`;
    if (TEXT_TYPES.has(ext) && !summaries.has(stamp)) {
      try { summaries.set(stamp, fileOpeningWords((await api.workspace?.fs?.readFile(uri))?.content ?? '')); } catch { summaries.set(stamp, ''); }
    }
    return {
      id: uri, title: name, kind: ext ? `${ext.toUpperCase()} file` : 'File', icon: FILE_TYPE_MAP[ext] ?? 'file',
      where, summary: summaries.get(stamp), touchedAt: ts,
      open: () => { void api.editors?.openFileEditor?.(uri, { pinned: true }); },
    };
  };
  return registerHomeSource({
    id: 'explorer.files',
    label: 'Files',
    listRecent: async (limit) => {
      await recents.whenReady;
      return Promise.all(recents.getRecentOpens().filter((o) => o.kind === 'file').slice(0, limit).map((o) => toHome(o.target, o.title, o.ts)));
    },
    onDidChange: (listener) => recents.onDidChangeOpens(() => listener()),
  });
}
