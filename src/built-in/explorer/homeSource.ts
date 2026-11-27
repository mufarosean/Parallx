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

const IMAGE_TYPES: Readonly<Record<string, string>> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
/** An image past this many base64 characters is not read for its picture. */
const IMAGE_MAX = 3_000_000;

interface FileLook { summary?: string; preview?: string; words?: number; image?: string }

export function registerExplorerHomeSource(api: HomeSourceApi, recents: IRecentsServiceShape): IDisposable {
  const looks = new Map<string, FileLook>();
  /** What a file shows of itself: a text file its opening words, an image itself. Read once per time it was opened. */
  const lookAt = async (uri: string, ext: string): Promise<FileLook> => {
    if (!TEXT_TYPES.has(ext) && !IMAGE_TYPES[ext]) return {};
    try {
      const file = await api.workspace?.fs?.readFile(uri);
      if (!file) return {};
      if (IMAGE_TYPES[ext]) return file.encoding === 'base64' && file.content.length <= IMAGE_MAX ? { image: `data:${IMAGE_TYPES[ext]};base64,${file.content}` } : {};
      const words = file.content.trim().split(/\s+/).filter((w) => /\w/.test(w)).length;
      return { summary: fileOpeningWords(file.content), preview: file.content.slice(0, 900).replace(/^---[\s\S]*?---\s*/, '').replace(/[#>*_`|]+ ?/g, ''), words };
    } catch { return {}; }
  };
  const toHome = async (uri: string, title: string, ts: number): Promise<HomeItem> => {
    const path = decoded(uri).replace(/\\/g, '/');
    const name = title || path.slice(path.lastIndexOf('/') + 1);
    const ext = (name.match(/\.([a-zA-Z0-9]+)$/)?.[1] ?? '').toLowerCase();
    const folder = api.workspace?.workspaceFolders?.find((f) => path.startsWith(decoded(f.uri).replace(/\\/g, '/')));
    const inside = folder ? path.slice(decoded(folder.uri).length).replace(/^\/+/, '') : '';
    const where = inside.includes('/') ? inside.slice(0, inside.lastIndexOf('/')).split('/').join(' / ') : folder?.name;
    const stamp = `${uri}@${ts}`;
    if (!looks.has(stamp)) looks.set(stamp, await lookAt(uri, ext));
    const look = looks.get(stamp)!;
    return {
      id: uri, title: name, kind: ext ? `${ext.toUpperCase()} file` : 'File', icon: FILE_TYPE_MAP[ext] ?? 'file',
      where, summary: look.summary, preview: look.preview, image: look.image, touchedAt: ts,
      stat: look.words ? { value: String(look.words), unit: look.words === 1 ? 'word' : 'words' } : undefined,
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
