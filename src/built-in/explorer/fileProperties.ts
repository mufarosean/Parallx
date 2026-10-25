// fileProperties.ts — Properties… for files and folders in the Explorer:
// what it is, where it is, how big, and when it was added and last changed.
// For a folder (or several items) the size and counts are added up in the
// background, so the dialog opens at once and fills in.

import { $ } from '../../ui/dom.js';
import { Overlay } from '../../ui/overlay.js';
import { createButton } from '../../ui/kit.js';
import { appDateTimeString } from '../../platform/localTime.js';

export interface IPropertiesItem {
  readonly name: string;
  /** The OS path. */
  readonly path: string;
  readonly isFolder: boolean;
}

interface IElectronFs {
  stat(p: string): Promise<{ type?: string; size?: number; mtime?: number; birthtime?: number; isReadonly?: boolean; error?: { message?: string } | null }>;
  readdir(p: string): Promise<{ entries?: { name: string; type: string; size?: number }[]; error?: unknown }>;
}

const KINDS: Record<string, string> = {
  pdf: 'PDF document', md: 'Markdown file', txt: 'Text file', docx: 'Word document', xlsx: 'Excel workbook', xlsm: 'Excel workbook',
  csv: 'CSV table', pptx: 'PowerPoint deck', json: 'JSON file', html: 'Web page', ipynb: 'Jupyter notebook', py: 'Python script',
  ts: 'TypeScript file', js: 'JavaScript file', css: 'Stylesheet', png: 'PNG image', jpg: 'JPEG image', jpeg: 'JPEG image',
  gif: 'GIF image', webp: 'WebP image', svg: 'SVG image', heic: 'HEIC photo', mp4: 'MP4 video', mov: 'QuickTime video',
  mp3: 'MP3 audio', wav: 'WAV audio', zip: 'ZIP archive',
};

/** "PDF document", "Folder", or "XYZ file" for an unknown extension. */
export function fileKind(name: string, isFolder: boolean): string {
  if (isFolder) return 'Folder';
  const ext = /\.([^.]+)$/.exec(name)?.[1]?.toLowerCase();
  if (!ext) return 'File';
  return KINDS[ext] ?? `${ext.toUpperCase()} file`;
}

/** "2.4 MB (2,516,582 bytes)"; plain "512 bytes" under a kilobyte. */
export function formatSize(bytes: number): string {
  const exact = `${bytes.toLocaleString('en-US')} ${bytes === 1 ? 'byte' : 'bytes'}`;
  if (bytes < 1024) return exact;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u++; }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[u]} (${exact})`;
}

/** Files, folders and bytes under a folder; stops counting at `cap` entries. */
async function measureFolder(fs: IElectronFs, dir: string, cap = 50_000): Promise<{ files: number; folders: number; bytes: number; capped: boolean }> {
  const out = { files: 0, folders: 0, bytes: 0, capped: false };
  const queue = [dir];
  const sep = dir.includes('\\') ? '\\' : '/';
  while (queue.length) {
    const d = queue.shift()!;
    const res = await fs.readdir(d).catch(() => null);
    for (const e of res?.entries ?? []) {
      if (out.files + out.folders >= cap) { out.capped = true; return out; }
      if (e.type === 'directory') { out.folders++; queue.push(d.replace(/[\\/]+$/, '') + sep + e.name); }
      else { out.files++; out.bytes += e.size ?? 0; }
    }
  }
  return out;
}

const parentOf = (p: string): string => p.replace(/[\\/][^\\/]*[\\/]?$/, '') || p;

/** Open the dialog for one item or several. */
export function showFileProperties(items: readonly IPropertiesItem[], copyText: (text: string) => void): void {
  const fs = (globalThis as { parallxElectron?: { fs?: IElectronFs } }).parallxElectron?.fs;
  if (!fs || items.length === 0) return;
  const one = items.length === 1 ? items[0] : null;
  const overlay = new Overlay(document.body, { contentClass: 'explorer-properties', label: 'Properties', centered: true });
  const dialog = overlay.contentElement;

  const title = $('div.explorer-properties-title');
  title.textContent = one ? one.name : `${items.length} items`;
  const grid = $('dl.explorer-properties-grid');
  const row = (label: string, value: string): HTMLElement => {
    const dt = $('dt');
    dt.textContent = label;
    const dd = $('dd');
    dd.textContent = value;
    grid.append(dt, dd);
    return dd;
  };
  const footer = $('div.explorer-properties-footer');
  createButton(footer, { id: 'explorer.properties.copyPath', label: one ? 'Copy Path' : 'Copy Paths', kind: 'secondary', onClick: () => copyText(items.map((i) => i.path).join('\n')) });
  createButton(footer, { id: 'explorer.properties.close', label: 'Close', kind: 'primary', onClick: () => overlay.hide() });
  dialog.append(title, grid, footer);
  overlay.onDidClose(() => overlay.dispose());
  overlay.show();

  if (one) {
    row('Kind', fileKind(one.name, one.isFolder));
    row('Location', parentOf(one.path)).title = one.path;
    const size = row('Size', 'Reading…');
    const contains = one.isFolder ? row('Contains', 'Counting…') : null;
    const added = row('Added', '…');
    const modified = row('Modified', '…');
    const access = row('Access', '…');
    void fs.stat(one.path).then(async (st) => {
      if (st.error) { size.textContent = 'Could not be read.'; return; }
      added.textContent = st.birthtime ? appDateTimeString(st.birthtime, { dateStyle: 'long', timeStyle: 'short' }) : 'Unknown';
      modified.textContent = st.mtime ? appDateTimeString(st.mtime, { dateStyle: 'long', timeStyle: 'short' }) : 'Unknown';
      access.textContent = st.isReadonly ? 'Read only' : 'Read and write';
      if (!one.isFolder) { size.textContent = formatSize(st.size ?? 0); return; }
      const m = await measureFolder(fs, one.path);
      size.textContent = `${m.capped ? 'At least ' : ''}${formatSize(m.bytes)}`;
      contains!.textContent = `${m.capped ? 'At least ' : ''}${m.files.toLocaleString('en-US')} ${m.files === 1 ? 'file' : 'files'}, ${m.folders.toLocaleString('en-US')} ${m.folders === 1 ? 'folder' : 'folders'}`;
    });
    return;
  }

  const files = items.filter((i) => !i.isFolder).length;
  row('Items', `${files} ${files === 1 ? 'file' : 'files'}, ${items.length - files} ${items.length - files === 1 ? 'folder' : 'folders'}`);
  const parents = new Set(items.map((i) => parentOf(i.path)));
  row('Location', parents.size === 1 ? [...parents][0] : 'Several folders');
  const size = row('Total size', 'Adding up…');
  void (async () => {
    let bytes = 0;
    let capped = false;
    for (const it of items) {
      if (it.isFolder) { const m = await measureFolder(fs, it.path); bytes += m.bytes; capped ||= m.capped; }
      else bytes += (await fs.stat(it.path).catch(() => ({ size: 0 }))).size ?? 0;
    }
    size.textContent = `${capped ? 'At least ' : ''}${formatSize(bytes)}`;
  })();
}
