// homeSource.ts — the explorer's source for Home: recently opened files.
//
// What was opened comes from the core RecentsService (the one owner of
// recency). Each file is shown with its folder and, when it is plain text,
// its opening words, and an image as itself. Registered while the explorer runs.

import type { IDisposable } from '../../platform/lifecycle.js';
import { registerHomeSource, type HomeItem } from '../../services/homeSources.js';
import type { IRecentsServiceShape } from '../../services/recentsService.js';
import { FILE_TYPE_MAP } from '../../ui/fileTypeIcons.js';

interface HomeSourceApi {
  editors?: { openFileEditor?(uri: string, options?: { pinned?: boolean }): Promise<void> };
  workspace?: {
    readonly workspaceFolders?: readonly { uri: string; name: string }[];
    readonly fs?: { readFile(uri: string): Promise<{ content: string; encoding: string }>; stat?(uri: string): Promise<{ mtime: number }> };
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

const IMAGE_TYPES: Readonly<Record<string, string>> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
/** An image past this many base64 characters is not read for its picture. */
const IMAGE_MAX = 3_000_000;

interface FileLook { summary?: string; preview?: string; words?: number; image?: string }

export function registerExplorerHomeSource(api: HomeSourceApi, recents: IRecentsServiceShape): IDisposable {
  /** What each file shows of itself, kept while the file on disk has not changed (one reading a file, so an image is held once). */
  const looks = new Map<string, { mtime: number; look: FileLook }>();
  const read = async (uri: string, ext: string): Promise<FileLook> => {
    try {
      const file = await api.workspace?.fs?.readFile(uri);
      if (!file) return {};
      if (IMAGE_TYPES[ext]) return file.encoding === 'base64' && file.content.length <= IMAGE_MAX ? { image: `data:${IMAGE_TYPES[ext]};base64,${file.content}` } : {};
      const words = file.content.trim().split(/\s+/).filter((w) => /\w/.test(w)).length;
      return { summary: fileOpeningWords(file.content), preview: file.content.slice(0, 900).replace(/^---[\s\S]*?---\s*/, '').replace(/[#>*_`|]+ ?/g, ''), words };
    } catch { return {}; }
  };
  /** A text file's opening words, an image itself; nothing is read for other kinds. `at` is when the file last changed, 0 when it cannot be told. */
  const lookAt = async (uri: string, ext: string): Promise<{ look: FileLook; at: number; gone: boolean }> => {
    let mtime = 0;
    let gone = false;
    try { mtime = (await api.workspace?.fs?.stat?.(uri))?.mtime ?? 0; } catch { gone = true; }
    if (gone || (!TEXT_TYPES.has(ext) && !IMAGE_TYPES[ext])) return { look: {}, at: mtime, gone };
    const kept = looks.get(uri);
    if (kept && mtime && kept.mtime === mtime) return { look: kept.look, at: mtime, gone };
    const look = await read(uri, ext);
    looks.set(uri, { mtime, look });
    return { look, at: mtime, gone };
  };
  const toHome = async (uri: string, title: string, openedAt: number): Promise<HomeItem | null> => {
    const path = decoded(uri).replace(/\\/g, '/');
    const name = title || path.slice(path.lastIndexOf('/') + 1);
    const ext = (name.match(/\.([a-zA-Z0-9]+)$/)?.[1] ?? '').toLowerCase();
    const inFolder = (f: { uri: string }): string => decoded(f.uri).replace(/\\/g, '/').replace(/\/+$/, '');
    const folder = api.workspace?.workspaceFolders?.find((f) => path === inFolder(f) || path.startsWith(`${inFolder(f)}/`));
    const inside = folder ? path.slice(inFolder(folder).length).replace(/^\/+/, '') : '';
    const where = inside.includes('/') ? inside.slice(0, inside.lastIndexOf('/')).split('/').join(' / ') : folder?.name;
    const { look, at, gone } = await lookAt(uri, ext);
    if (gone && !openedAt) return null; // asked for by id (a pin) and no longer on disk
    return {
      id: uri, title: name, kind: ext ? `${ext.toUpperCase()} file` : 'File', icon: FILE_TYPE_MAP[ext] ?? 'file',
      where, summary: look.summary, preview: look.preview, image: look.image, touchedAt: openedAt || at,
      stat: look.words ? { value: String(look.words), unit: look.words === 1 ? 'word' : 'words' } : undefined,
      open: () => { void api.editors?.openFileEditor?.(uri, { pinned: true }); },
    };
  };
  const present = (items: (HomeItem | null)[]): HomeItem[] => items.filter((item): item is HomeItem => !!item);
  return registerHomeSource({
    id: 'explorer.files',
    label: 'Files',
    listRecent: async (limit) => {
      await recents.whenReady;
      return present(await Promise.all(recents.getRecentOpens().filter((o) => o.kind === 'file').slice(0, limit).map((o) => toHome(o.target, o.title, o.ts))));
    },
    find: async (ids) => present(await Promise.all(ids.map((uri) => toHome(uri, '', 0)))),
    onDidChange: (listener) => recents.onDidChangeOpens(() => listener()),
  });
}
