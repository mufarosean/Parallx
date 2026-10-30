// pageBundle.ts — a page with all its sub-pages, or every page, as one .zip
// of Markdown files.
//
// Export as Markdown wrote one page, so a course of notes kept as a page
// tree came out as its top page alone. This writes the tree: each page is
// `Name.md`, and a page with sub-pages also has a `Name/` folder beside it
// holding theirs, the layout Obsidian and most Markdown tools read. A
// sub-page's block and a link to another page in the export point at that
// page's file, so the files link to each other outside the app. Each file is
// the same Markdown Export as Markdown writes, carriers and all, so a page
// can still be read back in. One .zip, so the one file the Save dialog
// grants is all that is written.

import { decodeCanvasContent } from '../contentSchema.js';
import { tiptapJsonToMarkdown } from '../markdownExport.js';
import { loadJsZip } from '../../../vendor/lazy.js';
import type { IPage } from '../canvasTypes.js';

export interface IBundlePage {
  readonly id: string;
  readonly title: string;
  /** The page as Markdown. */
  readonly markdown: string;
  readonly children: readonly IBundlePage[];
}

/** As much of the canvas data service as the export reads. */
export interface IBundleSource {
  getPage(id: string): Promise<IPage | null>;
  getChildren(id: string): Promise<IPage[]>;
  getRootPages(): Promise<IPage[]>;
}

/** A page title as a file name: no characters a file system refuses, no trailing dots or spaces. */
export function fileNameFor(title: string): string {
  // eslint-disable-next-line no-control-regex
  return title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '').substring(0, 100).trim() || 'Untitled';
}

/** The pages under `rootIds` (or every top-level page) with their sub-pages, read as Markdown. */
export async function collectPages(source: IBundleSource, rootIds: readonly string[] | null): Promise<IBundlePage[]> {
  const read = async (page: IPage, seen: Set<string>): Promise<IBundlePage> => {
    seen.add(page.id);
    const markdown = tiptapJsonToMarkdown(decodeCanvasContent(page.content).doc, page.title || 'Untitled');
    const kids = (await source.getChildren(page.id)).filter((c) => !seen.has(c.id));
    const children: IBundlePage[] = [];
    for (const kid of kids) children.push(await read(kid, seen));
    return { id: page.id, title: page.title || 'Untitled', markdown, children };
  };
  const roots = rootIds
    ? (await Promise.all(rootIds.map((id) => source.getPage(id)))).filter((p): p is IPage => !!p && !p.isArchived)
    : await source.getRootPages();
  const seen = new Set<string>();
  const out: IBundlePage[] = [];
  for (const root of roots) out.push(await read(root, seen));
  return out;
}

/** The path from the folder holding `fromFile` to `toFile`, as a Markdown link destination. */
export function relativeLink(fromFile: string, toFile: string): string {
  const from = fromFile.split('/').slice(0, -1);
  const to = toFile.split('/');
  let same = 0;
  while (same < from.length && same < to.length - 1 && from[same] === to[same]) same++;
  const rel = [...from.slice(same).map(() => '..'), ...to.slice(same)].join('/');
  return encodeURI(rel).replace(/\(/g, '%28').replace(/\)/g, '%29');
}

const PAGE_LINK = /\]\(<?(?:parallx-page:|parallx:\/\/canvas\/page\/)([A-Za-z0-9_-]{1,64})(?:#[A-Za-z0-9_-]{1,64})?>?\)/g;
const PAGE_BLOCK = /(<!-- parallx:block (\{"type":"pageBlock".*?\}) -->\n)(.*)(\n<!-- \/parallx:block -->)/g;

/** Every file of the export: its path in the .zip, and its Markdown with page links pointing at files. */
export function bundleFiles(roots: readonly IBundlePage[]): Map<string, string> {
  const pathOf = new Map<string, string>();
  const place = (pages: readonly IBundlePage[], dir: string) => {
    const taken = new Set<string>();
    for (const page of pages) {
      const base = fileNameFor(page.title);
      let name = base;
      for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} (${n})`;
      taken.add(name.toLowerCase());
      pathOf.set(page.id, `${dir}${name}.md`);
      place(page.children, `${dir}${name}/`);
    }
  };
  place(roots, '');
  const files = new Map<string, string>();
  const write = (page: IBundlePage) => {
    const here = pathOf.get(page.id)!;
    const linkTo = (id: string) => { const there = pathOf.get(id); return there ? relativeLink(here, there) : undefined; };
    const text = page.markdown
      .replace(PAGE_LINK, (whole, id: string) => { const to = linkTo(id); return to ? `](${to})` : whole; })
      .replace(PAGE_BLOCK, (whole, open: string, json: string, line: string, close: string) => {
        const id = /"pageId":"([A-Za-z0-9_-]{1,64})"/.exec(json)?.[1];
        const to = id && linkTo(id);
        return to ? `${open}[${line.replace(/[[\]]/g, '\\$&')}](${to})${close}` : whole;
      });
    files.set(here, text);
    page.children.forEach(write);
  };
  roots.forEach(write);
  return files;
}

/** The files as a .zip, base64 (what the file bridge writes as bytes). */
export async function zipBundle(files: ReadonlyMap<string, string>): Promise<string> {
  const JSZip = (await loadJsZip()).default;
  const zip = new JSZip();
  for (const [path, text] of files) zip.file(path, text);
  return zip.generateAsync({ type: 'base64', compression: 'DEFLATE' });
}

/** How many pages an export holds. */
export function countPages(pages: readonly IBundlePage[]): number {
  return pages.reduce((n, p) => n + 1 + countPages(p.children), 0);
}

interface IBundleApi {
  commands: { registerCommand(id: string, handler: (...args: unknown[]) => unknown): { dispose(): void } };
  window: {
    showInformationMessage(message: string): Promise<unknown>;
    showErrorMessage(message: string): Promise<unknown>;
  };
}

/**
 * canvas.exportPageMarkdown (one page as a .md), canvas.exportPageWithSubPages
 * (a page id) and canvas.exportAllPages: pick where the file goes, write it,
 * say how many pages a .zip holds.
 */
export function registerPageBundleCommands(api: IBundleApi, source: () => IBundleSource | null): { dispose(): void }[] {
  const run = async (rootIds: string[] | null, defaultName: string) => {
    const data = source();
    const electron = (window as { parallxElectron?: { dialog?: { saveFile?(o: unknown): Promise<string | null> }; fs?: { writeFile?(p: string, c: string, e: string): Promise<{ error?: { message?: string } | null } | undefined> } } }).parallxElectron;
    if (!data || !electron?.dialog?.saveFile || !electron.fs?.writeFile) return false;
    try {
      const pages = await collectPages(data, rootIds);
      if (!pages.length) { await api.window.showInformationMessage('There are no pages to export.'); return false; }
      const filePath = await electron.dialog.saveFile({ filters: [{ name: 'Zip', extensions: ['zip'] }], defaultName: `${fileNameFor(defaultName)}.zip` });
      if (!filePath) return false;
      const result = await electron.fs.writeFile(filePath, await zipBundle(bundleFiles(pages)), 'base64');
      if (result?.error) throw new Error(result.error.message ?? 'The file could not be written.');
      const n = countPages(pages);
      await api.window.showInformationMessage(`Exported ${n} ${n === 1 ? 'page' : 'pages'} as Markdown.`);
      return true;
    } catch (err) {
      await api.window.showErrorMessage(`Could not export. ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  };
  return [
    api.commands.registerCommand('canvas.exportPageMarkdown', async (pageId: unknown) => {
      const page = typeof pageId === 'string' ? await source()?.getPage(pageId) : null;
      const electron = (window as { parallxElectron?: { dialog?: { saveFile?(o: unknown): Promise<string | null> }; fs?: { writeFile?(p: string, c: string, e: string): Promise<unknown> } } }).parallxElectron;
      if (!page || !electron?.dialog?.saveFile || !electron.fs?.writeFile) return false;
      const filePath = await electron.dialog.saveFile({ filters: [{ name: 'Markdown', extensions: ['md'] }], defaultName: `${fileNameFor(page.title || 'Untitled')}.md` });
      if (!filePath) return false;
      await electron.fs.writeFile(filePath, tiptapJsonToMarkdown(decodeCanvasContent(page.content).doc, page.title), 'utf-8');
      return true;
    }),
    api.commands.registerCommand('canvas.exportPageWithSubPages', async (pageId: unknown) => {
      if (typeof pageId !== 'string') return false;
      const page = await source()?.getPage(pageId);
      return page ? run([pageId], page.title || 'Untitled') : false;
    }),
    api.commands.registerCommand('canvas.exportAllPages', () => run(null, 'Pages')),
  ];
}
