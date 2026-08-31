// mindmapDataService.ts — renderer-side data service for mindmaps, over the
// schema from migration 014.
//
// Composition with the page world — the database pattern, exactly:
//   - a mindmap IS a page (mindmaps.id = pages.id): title/icon/sidebar/
//     archival/rename all come from the pages row via CanvasDataService;
//   - this service owns only the graph document (one JSON blob per map) and
//     the "which pages are mindmaps" answer that editor routing needs;
//   - self-healing: deleting the mindmap page (any path) also deletes the
//     mindmaps row via the page-change subscription — the FK cascade is the
//     backstop, this is the guarantee (SQLite FK enforcement may be off).
//
// docs/MINDMAP_BRIEF.md is the contract; docs/CUSTOM_BLOCK_BRIEF.md's
// refresh rule (a regenerate never moves what the user placed) is enforced
// one layer up, in mindmapModel's layoutNewNodes.

import { Disposable } from '../../../platform/lifecycle.js';
import { Emitter, Event } from '../../../platform/events.js';
import type { ICanvasDataService, IPage } from '../canvasTypes.js';
import { PageChangeKind } from '../canvasTypes.js';
import {
  emptyMindmapDoc,
  parseMindmapDoc,
  serializeMindmapDoc,
  type MindmapDoc,
} from './mindmapModel.js';

/** Icon stamped on new mindmap pages (Lucide, registered in the app set). */
export const MINDMAP_PAGE_ICON = 'waypoints';

interface DatabaseBridge {
  run(sql: string, params?: unknown[]): Promise<{ error: { code: string; message: string } | null; changes?: number }>;
  get(sql: string, params?: unknown[]): Promise<{ error: { code: string; message: string } | null; row?: Record<string, unknown> | null }>;
  all(sql: string, params?: unknown[]): Promise<{ error: { code: string; message: string } | null; rows?: Record<string, unknown>[] }>;
}

export interface MindmapDocChange {
  readonly pageId: string;
  /** Who wrote: the open editor ignores its own writes and reloads on others'. */
  readonly source: 'user' | 'ai';
}

export class MindmapDataService extends Disposable {
  private readonly _onDidChangeDoc = this._register(new Emitter<MindmapDocChange>());
  /** A map's document was saved. */
  readonly onDidChangeDoc: Event<MindmapDocChange> = this._onDidChangeDoc.event;

  /** Known mindmap page ids — kept fresh for cheap sync isMindmap checks
   *  (editor routing runs on every page open). */
  private readonly _mindmapIds = new Set<string>();
  private _idsLoaded = false;

  constructor(private readonly _pages: ICanvasDataService) {
    super();
    this._register(this._pages.onDidChangePage((e) => {
      if (e.kind === PageChangeKind.Deleted && this._mindmapIds.has(e.pageId)) {
        this._mindmapIds.delete(e.pageId);
        void this._db.run('DELETE FROM mindmaps WHERE id = ?', [e.pageId]).catch(() => { /* cascade is the backstop */ });
      }
    }));
  }

  /** Injected at activation: the IDatabaseService tool bridge. Raw preload
   *  bridge stays as the fallback (tests, pre-DI construction). */
  private _attachedDb: DatabaseBridge | undefined;
  attachDatabase(bridge: DatabaseBridge): void { this._attachedDb = bridge; }

  private get _db(): DatabaseBridge {
    if (this._attachedDb) return this._attachedDb;
    const electron = (window as unknown as { parallxElectron?: { database?: DatabaseBridge } }).parallxElectron;
    if (!electron?.database) {
      throw new Error('[MindmapDataService] window.parallxElectron.database not available');
    }
    return electron.database;
  }

  // ── Identity ────────────────────────────────────────────────────────────

  async ensureIdsLoaded(): Promise<void> {
    if (this._idsLoaded) return;
    const res = await this._db.all('SELECT id FROM mindmaps', []);
    if (res.error) return; // table may predate the migration — stay empty
    this._mindmapIds.clear();
    for (const r of res.rows ?? []) this._mindmapIds.add(r.id as string);
    this._idsLoaded = true;
  }

  /** Sync check for editor routing. Only trustworthy after loadIds(). */
  isMindmap(pageId: string): boolean {
    return this._mindmapIds.has(pageId);
  }

  get idsLoaded(): boolean { return this._idsLoaded; }

  // ── CRUD ────────────────────────────────────────────────────────────────

  /**
   * Create a mindmap page. With a parentId the page nests as a sub-page and
   * the parent gets its card (one transaction, the /database discipline via
   * createChildPageWithBlock); without one it lands at the root.
   */
  async createMindmap(opts: { title?: string; parentId?: string | null } = {}): Promise<IPage> {
    const title = opts.title?.trim() || 'Untitled Mindmap';
    const page = opts.parentId
      ? await this._pages.createChildPageWithBlock({ parentId: opts.parentId, title })
      : await this._pages.createPage(null, title);
    await this._pages.updatePage(page.id, { icon: MINDMAP_PAGE_ICON });
    const doc = emptyMindmapDoc(title);
    const res = await this._db.run(
      'INSERT INTO mindmaps (id, data) VALUES (?, ?)',
      [page.id, serializeMindmapDoc(doc)],
    );
    if (res.error) throw new Error(`Failed to create mindmap: ${res.error.message}`);
    this._mindmapIds.add(page.id);
    return page;
  }

  async getDoc(pageId: string): Promise<MindmapDoc | null> {
    const raw = await this.getData(pageId);
    return raw === null ? null : parseMindmapDoc(raw);
  }

  /** The stored payload verbatim — a BoardEnvelope for engine documents, a
   *  v1 doc for maps that predate the board (boardConvert migrates). */
  async getData(pageId: string): Promise<string | null> {
    const res = await this._db.get('SELECT data FROM mindmaps WHERE id = ?', [pageId]);
    if (res.error || !res.row) return null;
    return String(res.row.data ?? '');
  }

  async saveData(pageId: string, json: string, source: 'user' | 'ai'): Promise<void> {
    const res = await this._db.run(
      "UPDATE mindmaps SET data = ?, updated_at = datetime('now') WHERE id = ?",
      [json, pageId],
    );
    if (res.error) throw new Error(`Failed to save mindmap: ${res.error.message}`);
    this._onDidChangeDoc.fire({ pageId, source });
  }

  async saveDoc(pageId: string, doc: MindmapDoc, source: 'user' | 'ai'): Promise<void> {
    await this.saveData(pageId, serializeMindmapDoc(doc), source);
  }

  // ── Page passthroughs the editor needs ──────────────────────────────────

  getPage(pageId: string): Promise<IPage | null> {
    return this._pages.getPage(pageId);
  }

  async renameMindmap(pageId: string, title: string): Promise<void> {
    await this._pages.updatePage(pageId, { title });
  }
}
