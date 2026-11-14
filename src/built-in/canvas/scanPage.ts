// scanPage.ts — Open As Page: a document the reader read, as a page beside it.
//
// The command takes a document the document reader has read (a scan, a PDF)
// and makes a page of the app from it (scanPageDoc.ts): its headings,
// paragraphs and lists, its tables as real tables, its figures and formulas
// as pictures cut from the document. The page opens beside the document.
//
// Every block of the page remembers where on the document it came from. That
// record is kept beside the workspace's other files, one small file a page
// (.parallx/page-sources/<page id>.json), so it moves with the workspace and
// nothing about it is in the page itself. While such a page is open, the page
// and the document keep in step through services/scanPageLinks.ts:
//
// - the caret goes into a block, or a block is pressed: the document's view
//   frames where it came from (a table's cell: that very cell);
// - a press on the document: the block made from that spot is marked here;
// - either side scrolls: the other follows.
//
// A document is made into a page once: asking again opens the page it became.
//
// The page's side works on what any page shows in the window (its surface,
// and each block's id on its element), so the page editor itself is not
// touched, and nothing listens on the window unless such a page is open.

import { addDisposableListener } from '../../ui/dom.js';
import { createBlock } from '../../ui/kit.js';
import { rafThrottle } from '../../platform/rafThrottle.js';
import type { IDisposable } from '../../platform/lifecycle.js';
import { fetchDocumentReading } from '../../services/documentReading.js';
import { pictureOfRegion } from '../../services/pagePicture.js';
import { scanPageLinks, STEP_LINE, type IPageSpot, type IScanPageSource, type ScanAnchor } from '../../services/scanPageLinks.js';
import { buildScanPageDoc, fillScanPagePictures } from './scanPageDoc.js';
import { storeImageSrc } from './imageStore.js';
import type { TipTapNode } from './markdownImport.js';
import { encodeCanvasContentFromDoc } from './contentSchema.js';
import { IEditorService } from '../../services/serviceTypes.js';
import { URI } from '../../platform/uri.js';
import './scanPage.css';

export const OPEN_AS_PAGE_COMMAND = 'canvas.openFileAsPage';
/** Where each page's record of its source is kept, within the workspace. */
export const PAGE_SOURCES_DIR = '.parallx/page-sources';
/** A scroll made to follow the other side is this long in settling; scrolls within it are not sent back. */
const FOLLOW_MS = 400;
/** How long a block shown from the document stays marked. */
const MARK_MS = 1600;
/** The mark is drawn over the block, in the page's scrolling element: the page editor redraws a block whose own element is touched. */
const MARK = 'canvas-scan-mark';
const SURFACE = '[data-px-surface="canvas"]';

/** What Open As Page needs of the app around it (built-in/canvas/main.ts gives it). */
export interface IScanPageHost {
  /** The open workspace's folder. */
  workspaceRoot(): string | undefined;
  /** The document showing in the editor that has the focus, when a page can be made from it. */
  activeFile(): string | undefined;
  /** Make an empty page with this title; its id. */
  createPage(title: string): Promise<string>;
  writePage(pageId: string, doc: TipTapNode): Promise<void>;
  /** Is the page there, and not in the trash? */
  pageExists(pageId: string): Promise<boolean>;
  /** Open the page beside the editor that has the focus. */
  openPage(pageId: string): Promise<void>;
  /** Is the page open in an editor, showing or not? */
  isPageOpen(pageId: string): boolean;
  /** Which document became which page: the document as its record names it (its path within the workspace, lower case) to the page's id. */
  readonly made: { get(): Record<string, string>; set(value: Record<string, string>): void };
  notify(text: string): void;
}

// ── The record of where a page came from ──

interface IStoredSource { version: 1; file: string; anchors: Record<string, ScanAnchor>; pageSizes: Record<string, readonly [number, number]> }
type FileBridge = {
  readFile?(path: string, encoding?: string): Promise<{ content?: string; error?: unknown } | undefined>;
  writeFile?(path: string, content: string, encoding?: string): Promise<{ error?: unknown } | undefined>;
};
const files = (): FileBridge | undefined => (globalThis as { parallxElectron?: { fs?: FileBridge } }).parallxElectron?.fs;

const slashes = (path: string): string => path.replace(/\\/g, '/');
const nameOf = (fsPath: string): string => slashes(fsPath).split('/').pop() || fsPath;

/** The document as the record names it: within the workspace by its path there, so a moved workspace keeps its links; elsewhere by its full path. */
export function storedFileFor(fsPath: string, root: string | undefined): string {
  const file = slashes(fsPath), base = root ? slashes(root).replace(/\/+$/, '') : '';
  return base && file.toLowerCase().startsWith(`${base.toLowerCase()}/`) ? file.slice(base.length + 1) : file;
}

/** The document a record names, as a path on disk. */
export function resolveStoredFile(file: string, root: string | undefined): string {
  return /^([a-zA-Z]:\/|\/)/.test(file) || !root ? file : `${slashes(root).replace(/\/+$/, '')}/${file}`;
}

/** A record read back, checked: anything that is not an anchor or a size is dropped. Null when it is not a record. */
export function parseStoredSource(pageId: string, raw: unknown, root: string | undefined): IScanPageSource | null {
  const r = raw as Partial<IStoredSource> | null;
  if (!r || typeof r !== 'object' || typeof r.file !== 'string' || !r.file || !r.anchors || typeof r.anchors !== 'object') return null;
  const numbers = (v: unknown, n: number): v is number[] => Array.isArray(v) && v.length === n && v.every((x) => typeof x === 'number' && Number.isFinite(x));
  const anchors: Record<string, ScanAnchor> = {};
  for (const [id, a] of Object.entries(r.anchors)) if (numbers(a, 5)) anchors[id] = [a[0], a[1], a[2], a[3], a[4]];
  const pageSizes: Record<string, readonly [number, number]> = {};
  for (const [page, s] of Object.entries(r.pageSizes ?? {})) if (numbers(s, 2) && s[0] > 0 && s[1] > 0) pageSizes[page] = [s[0], s[1]];
  return { pageId, fsPath: resolveStoredFile(r.file, root), anchors, pageSizes };
}

const recordPath = (root: string, pageId: string): string => `${slashes(root).replace(/\/+$/, '')}/${PAGE_SOURCES_DIR}/${pageId}.json`;

// ── Open As Page ──

export class ScanPages implements IDisposable {
  /** Records read or written this session, by page id. */
  private readonly _sources = new Map<string, IScanPageSource>();
  /** The pages made from documents that are open now: page id to what closes its link. */
  private readonly _linked = new Map<string, IDisposable>();
  /** Open pages found to have no record: ordinary pages, not looked up again. */
  private readonly _plain = new Set<string>();
  private readonly _onLinks: IDisposable;
  /** What listens on the window while a linked page is open. */
  private _onWindow: IDisposable[] = [];
  private _syncing: Promise<void> = Promise.resolve();
  private _disposed = false;
  private _following = 0;
  /** The block the document's view was last shown for, so a caret that stays in it says nothing more. */
  private _shown = '';
  private _marked: { mark: HTMLElement; timer: ReturnType<typeof setTimeout> } | null = null;
  private readonly _scrolled = rafThrottle((scroller: HTMLElement) => this._onScroll(scroller));

  constructor(private readonly _host: IScanPageHost, private readonly _doc: Document = document) {
    this._onLinks = scanPageLinks.onDidPointAtPage((spot) => this._onSpot(spot));
  }

  /**
   * Make a page from a document the reader has read, and open it beside the
   * document; a document already made into a page opens that page. Returns
   * the page's id, or null when nothing was opened (and says why).
   */
  async openAsPage(file?: string): Promise<string | null> {
    const fsPath = file || this._host.activeFile();
    if (!fsPath) { this._host.notify('Open a PDF first: a page is made from the document that is showing.'); return null; }
    const root = this._host.workspaceRoot();
    // By its path within the workspace, so a workspace that moved does not make the same document into a second page.
    const key = storedFileFor(fsPath, root).toLowerCase();
    const known = this._host.made.get()[key];
    if (known && await this._host.pageExists(known)) {
      await this._host.openPage(known);
      void this.sync();
      return known;
    }
    if (scanPageLinks.isMaking(fsPath)) return null;
    const reading = await fetchDocumentReading(fsPath);
    if (!reading) {
      this._host.notify('The document reader has not read this document yet. Open the PDF\'s side panel, choose Reading, then Read Now.');
      return null;
    }
    scanPageLinks.setMaking(fsPath, true);
    try {
      const name = nameOf(fsPath);
      const built = buildScanPageDoc(reading, { source: { name, href: `parallx://explorer/file?${new URLSearchParams({ path: storedFileFor(fsPath, root) }).toString()}` } });
      // The figures and formulas, cut from the document one at a time and kept as files.
      const cut = new Map<string, string>();
      for (const picture of built.pictures) {
        const size = built.pageSizes[String(picture.page)];
        const data = size ? await pictureOfRegion(fsPath, picture.page, picture.box, size) : null;
        if (data) cut.set(picture.blockId, await storeImageSrc(data));
      }
      fillScanPagePictures(built, cut);
      const pageId = await this._host.createPage(name.replace(/\.[^.]+$/, '') || name);
      await this._host.writePage(pageId, built.doc);
      const source: IScanPageSource = { pageId, fsPath, anchors: built.anchors, pageSizes: built.pageSizes };
      this._sources.set(pageId, source);
      this._plain.delete(pageId);
      if (root) {
        const stored: IStoredSource = { version: 1, file: storedFileFor(fsPath, root), anchors: built.anchors, pageSizes: built.pageSizes };
        const wrote = await files()?.writeFile?.(recordPath(root, pageId), JSON.stringify(stored), 'utf-8').catch((error: unknown) => ({ error }));
        if (!wrote || wrote.error) console.warn('[ScanPages] The record of where the page came from could not be kept:', wrote?.error ?? 'no file bridge');
      }
      this._host.made.set({ ...this._host.made.get(), [key]: pageId });
      await this._host.openPage(pageId);
      void this.sync();
      return pageId;
    } catch (err) {
      console.error('[ScanPages] The page could not be made from', fsPath, err);
      this._host.notify(`The page could not be made. ${err instanceof Error ? err.message : String(err)}`);
      return null;
    } finally {
      scanPageLinks.setMaking(fsPath, false);
    }
  }

  private async _sourceOf(pageId: string): Promise<IScanPageSource | null> {
    const held = this._sources.get(pageId);
    if (held) return held;
    const root = this._host.workspaceRoot();
    if (!root) return null;
    try {
      const read = await files()?.readFile?.(recordPath(root, pageId), 'utf-8');
      const source = read?.content ? parseStoredSource(pageId, JSON.parse(read.content), root) : null;
      if (source) this._sources.set(pageId, source);
      return source;
    } catch {
      return null;
    }
  }

  /**
   * Link the open pages that were made from documents, and unlink the ones
   * that have closed. A page is one of them when it has a record, whichever
   * way it came to be open (made just now, left open last time, brought back
   * from the trash). One run at a time.
   */
  sync(): Promise<void> {
    this._syncing = this._syncing.then(async () => {
      // A look that was waiting when the canvas was turned off links nothing.
      if (this._disposed) return;
      for (const [pageId, link] of [...this._linked]) {
        if (this._host.isPageOpen(pageId)) continue;
        link.dispose();
        this._linked.delete(pageId);
      }
      const showing = Array.from(this._doc.querySelectorAll(SURFACE), (s) => this._pageOf(s)).filter(Boolean);
      for (const pageId of new Set([...Object.values(this._host.made.get()), ...showing])) {
        if (this._linked.has(pageId) || this._plain.has(pageId) || !this._host.isPageOpen(pageId)) continue;
        const source = await this._sourceOf(pageId);
        if (!source) { this._plain.add(pageId); continue; }
        if (!this._disposed && !this._linked.has(pageId) && this._host.isPageOpen(pageId)) this._linked.set(pageId, scanPageLinks.open(source));
      }
      this._listen(!this._disposed && this._linked.size > 0);
    }).catch((err) => { console.warn('[ScanPages] Linking the open pages stopped:', err); });
    return this._syncing;
  }

  /** The editors that are open changed: a page takes a moment to be ready after its tab appears, so look again shortly. */
  editorsChanged(): void {
    void this.sync();
    setTimeout(() => void this.sync(), 400);
    setTimeout(() => void this.sync(), 1600);
  }

  private _listen(on: boolean): void {
    if (on === (this._onWindow.length > 0)) return;
    for (const l of this._onWindow) l.dispose();
    this._onWindow = !on ? [] : [
      addDisposableListener(this._doc, 'click', (e) => this._pointFrom(e.target instanceof Element ? e.target : null, false)),
      // The caret moved by the keyboard: the selection says where it is now. Only a page that has the focus speaks:
      // a selection left behind in a page that was clicked away from says nothing.
      addDisposableListener(this._doc, 'selectionchange' as keyof HTMLElementEventMap, () => {
        const node = this._doc.getSelection()?.anchorNode ?? null;
        const at = node instanceof Element ? node : node?.parentElement ?? null;
        const surface = at?.closest(SURFACE);
        if (surface && surface.contains(this._doc.activeElement)) this._pointFrom(at, true);
      }),
      // Scrolls do not bubble: heard on their way down.
      addDisposableListener(this._doc, 'scroll', (e) => { if (e.target instanceof HTMLElement && e.target.closest(SURFACE)) this._scrolled(e.target); }, { capture: true, passive: true }),
    ];
  }

  private _pageOf(surface: Element): string {
    return (surface.getAttribute('data-px-instance') ?? '').split(':').pop() ?? '';
  }

  /** The block at `start` that has a place of its own on the document: a cell before its table, an item before its list. */
  private _blockAt(start: Element | null): { pageId: string; blockId: string } | null {
    const surface = start?.closest(SURFACE);
    if (!start || !surface) return null;
    const pageId = this._pageOf(surface);
    const source = scanPageLinks.forPage(pageId);
    if (!source) return null;
    for (let el = start.closest<HTMLElement>('[data-id]'); el && surface.contains(el); el = el.parentElement?.closest<HTMLElement>('[data-id]') ?? null) {
      const blockId = el.getAttribute('data-id') ?? '';
      if (source.anchors[blockId]) return { pageId, blockId };
    }
    return null;
  }

  /** The page points at a block. `once`: say nothing while the caret stays in the block last shown. */
  private _pointFrom(start: Element | null, once: boolean): void {
    const at = this._blockAt(start);
    if (!at) return;
    const mark = `${at.pageId}\n${at.blockId}`;
    if (once && mark === this._shown) return;
    this._shown = mark;
    scanPageLinks.pointFromPage(at.pageId, at.blockId, 'show');
  }

  /** The page scrolled: the block at the line both sides keep in step is where the document should be. */
  private _onScroll(scroller: HTMLElement): void {
    if (Date.now() < this._following || !scroller.isConnected) return;
    const box = scroller.getBoundingClientRect();
    const x = box.left + box.width / 2;
    // The line may fall in the gap between two blocks: look a little further down.
    for (const down of [0, 14, 30, 60]) {
      const at = this._blockAt(this._doc.elementFromPoint(x, box.top + box.height * STEP_LINE + down));
      if (at) { scanPageLinks.pointFromPage(at.pageId, at.blockId, 'scroll'); return; }
    }
  }

  /** The nearest thing above `el` that scrolls up and down. */
  private _scrollerOf(el: HTMLElement): HTMLElement | null {
    for (let up = el.parentElement; up; up = up.parentElement) {
      const overflow = up.ownerDocument.defaultView?.getComputedStyle(up).overflowY;
      if ((overflow === 'auto' || overflow === 'scroll') && up.scrollHeight > up.clientHeight) return up;
    }
    return null;
  }

  /** The document's view points at a block of a page: show it, or (the document scrolled) bring it to the line. */
  private _onSpot(spot: IPageSpot): void {
    const surface = Array.from(this._doc.querySelectorAll<HTMLElement>(SURFACE)).find((s) => this._pageOf(s) === spot.pageId && s.getClientRects().length > 0);
    const el = surface?.querySelector<HTMLElement>(`[data-id="${CSS.escape(spot.blockId)}"]`);
    if (!el) return;
    const scroller = this._scrollerOf(el);
    this._following = Date.now() + FOLLOW_MS;
    if (spot.how === 'scroll') {
      if (scroller) scroller.scrollTop += el.getBoundingClientRect().top - (scroller.getBoundingClientRect().top + scroller.clientHeight * STEP_LINE);
      return;
    }
    const view = (scroller ?? this._doc.documentElement).getBoundingClientRect();
    let at = el.getBoundingClientRect();
    if (at.top < view.top || at.bottom > view.bottom) { el.scrollIntoView({ block: 'center' }); at = el.getBoundingClientRect(); }
    this._unmark();
    // Drawn over the block, in the element that scrolls, so it stays on the block and the editor's own elements are left alone.
    const host = scroller ?? surface!;
    const from = host.getBoundingClientRect();
    const mark = createBlock(host, 'div', { className: MARK, attrs: { 'aria-hidden': 'true' } });
    mark.style.left = `${at.left - from.left - host.clientLeft + host.scrollLeft}px`;
    mark.style.top = `${at.top - from.top - host.clientTop + host.scrollTop}px`;
    mark.style.width = `${at.width}px`;
    mark.style.height = `${at.height}px`;
    this._marked = { mark, timer: setTimeout(() => this._unmark(), MARK_MS) };
  }

  private _unmark(): void {
    if (!this._marked) return;
    clearTimeout(this._marked.timer);
    this._marked.mark.remove();
    this._marked = null;
  }

  dispose(): void {
    this._disposed = true;
    this._unmark();
    this._scrolled.dispose();
    this._listen(false);
    this._onLinks.dispose();
    for (const link of this._linked.values()) link.dispose();
    this._linked.clear();
  }
}

// ── Wiring (built-in/canvas/main.ts calls this once) ──

/** Which document became which page, kept with the workspace's other small state. */
const MADE_KEY = 'canvas.pagesFromFiles';

interface IScanPagesApi {
  readonly commands: { registerCommand(id: string, handler: (...args: unknown[]) => unknown): IDisposable };
  readonly editors: { onDidChangeOpenEditors(listener: () => void): IDisposable };
  readonly window: { showInformationMessage(message: string): Promise<unknown> | unknown };
  readonly workspace: { readonly workspaceFolders?: ReadonlyArray<{ readonly uri: string }> | undefined };
  readonly services: { has(id: { readonly id: string }): boolean; get<T>(id: { readonly id: string }): T };
}

interface IScanPagesData {
  createPage(parentId?: string | null, title?: string): Promise<{ readonly id: string }>;
  updatePage(pageId: string, updates: { content: string; contentSchemaVersion: number }): Promise<unknown>;
  getPage(pageId: string): Promise<{ readonly isArchived: boolean } | null>;
  fireContentReload(pageId: string): void;
}

/** Register Open As Page and keep the pages made from documents linked while they are open. */
export function registerScanPages(
  api: IScanPagesApi,
  context: { readonly subscriptions: IDisposable[]; readonly workspaceState: { get<T>(key: string, defaultValue: T): T; update(key: string, value: unknown): unknown } },
  data: IScanPagesData,
  provider: () => { isPageOpen(pageId: string): boolean } | null,
  openPage: (pageId: string, opts?: { side?: boolean }) => Promise<void>,
): ScanPages {
  const activeEditor = (): { typeId?: string; uri?: { fsPath?: string } } | undefined => {
    try { return api.services.has(IEditorService) ? api.services.get<{ activeEditor?: { typeId?: string; uri?: { fsPath?: string } } }>(IEditorService).activeEditor : undefined; } catch { return undefined; }
  };
  const pages = new ScanPages({
    workspaceRoot: () => { const uri = api.workspace.workspaceFolders?.[0]?.uri; return uri ? URI.parse(uri).fsPath : undefined; },
    activeFile: () => { const active = activeEditor(); return active?.typeId === 'parallx.editor.pdf' ? active.uri?.fsPath : undefined; },
    createPage: async (title) => (await data.createPage(null, title)).id,
    writePage: async (pageId, doc) => {
      const encoded = encodeCanvasContentFromDoc(doc);
      await data.updatePage(pageId, { content: encoded.storedContent, contentSchemaVersion: encoded.schemaVersion });
      data.fireContentReload(pageId);
    },
    pageExists: async (pageId) => { const page = await data.getPage(pageId).catch(() => null); return !!page && !page.isArchived; },
    openPage: (pageId) => openPage(pageId, { side: true }),
    isPageOpen: (pageId) => provider()?.isPageOpen(pageId) ?? false,
    made: {
      get: () => context.workspaceState.get<Record<string, string>>(MADE_KEY, {}),
      set: (value) => { void context.workspaceState.update(MADE_KEY, value); },
    },
    notify: (text) => { void api.window.showInformationMessage(text); },
  });
  context.subscriptions.push(
    pages,
    api.commands.registerCommand(OPEN_AS_PAGE_COMMAND, (file?: unknown) => pages.openAsPage(typeof file === 'string' && file ? file : undefined)),
    api.editors.onDidChangeOpenEditors(() => pages.editorsChanged()),
  );
  // Pages left open from the last session are linked as they come up.
  pages.editorsChanged();
  return pages;
}
