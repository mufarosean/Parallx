// pageWriter.ts — the one way canvas AI tools write pages
//
// The AI tools used to write pages with their own SQL around the data
// service: they read a page, changed it and wrote it back, so an editor save
// that committed in between was overwritten, a page whose content cannot be
// read was written over, and the service's write queue and stale-save checks
// never saw the write.  Every tool write now goes through an
// ICanvasPageWriter.  In the app it is the data service
// (`dataServicePageWriter`): its `rewritePageContent` writes the page's
// pending editor save first and reads, changes and writes inside the page's
// write queue.  `rawDbPageWriter` is the same contract over the bare
// database, for tests and for hosts without a data service.

import type { IBuiltInToolDatabase } from '../../chat/chatTypes.js';
import { sqliteUtcNow } from '../../../platform/storedTime.js';
import { decodeCanvasContent, encodeCanvasContentFromDoc } from '../contentSchema.js';

export type PageDocJson = { type: 'doc'; content: any[]; [key: string]: unknown };

/** What a build sees of the page it changes. */
export interface PageWriteTarget {
  readonly id: string;
  readonly title: string;
}

/** Current doc (a copy) → new doc, or a sentence saying why not. */
export type BuildPageDoc = (doc: PageDocJson, page: PageWriteTarget) => PageDocJson | string;

export type PageWriteResult =
  | { readonly ok: true; readonly page: PageWriteTarget; readonly doc: PageDocJson }
  | { readonly ok: false; readonly reason: string; readonly notFound?: boolean };

export interface PageStyleFields {
  icon?: string | null;
  coverUrl?: string | null;
  fontFamily?: string;
  fullWidth?: boolean;
  smallText?: boolean;
}

export interface NewPageInit {
  readonly title: string;
  readonly icon: string | null;
  readonly doc: PageDocJson;
  readonly fullWidth: boolean;
  readonly smallText: boolean;
}

export interface ICanvasPageWriter {
  /** Change a page's body; nothing lands between the read and the write. */
  rewriteContent(pageId: string, build: BuildPageDoc, opts?: { checkpointBefore?: boolean }): Promise<PageWriteResult>;
  /** Change display fields. False when the page does not exist. */
  setStyle(pageId: string, style: PageStyleFields): Promise<boolean>;
  /** A new top-level page; returns its id. */
  createPage(init: NewPageInit): Promise<string>;
}

/** The parts of CanvasDataService the writer uses. */
export interface PageWriterDataService {
  rewritePageContent(
    pageId: string,
    build: (doc: any, page: { id: string; title: string }) => any | string,
    opts?: { source?: 'user' | 'ai' | 'restore'; checkpointBefore?: boolean },
  ): Promise<{ ok: true; page: { id: string; title: string }; doc: any } | { ok: false; reason: string; notFound?: boolean }>;
  getPage(pageId: string): Promise<{ id: string } | null>;
  updatePage(pageId: string, updates: Record<string, unknown>): Promise<unknown>;
  createPage(parentId?: string | null, title?: string): Promise<{ id: string }>;
}

export function dataServicePageWriter(ds: PageWriterDataService): ICanvasPageWriter {
  return {
    async rewriteContent(pageId, build, opts) {
      const res = await ds.rewritePageContent(
        pageId,
        (doc, page) => build(doc as PageDocJson, { id: page.id, title: page.title }),
        { source: 'ai', checkpointBefore: opts?.checkpointBefore },
      );
      return res.ok ? { ok: true, page: { id: res.page.id, title: res.page.title }, doc: res.doc as PageDocJson } : res;
    },
    async setStyle(pageId, style) {
      if (!(await ds.getPage(pageId))) return false;
      await ds.updatePage(pageId, { ...style });
      return true;
    },
    async createPage(init) {
      const page = await ds.createPage(null, init.title);
      const encoded = encodeCanvasContentFromDoc(init.doc as never);
      await ds.updatePage(page.id, {
        icon: init.icon,
        content: encoded.storedContent,
        contentSchemaVersion: encoded.schemaVersion,
        fullWidth: init.fullWidth,
        smallText: init.smallText,
        editSource: 'ai',
      });
      return page.id;
    },
  };
}

/** The same contract straight over the database (tests, hosts with no data service). */
export function rawDbPageWriter(
  db: IBuiltInToolDatabase,
  checkpointPage?: (pageId: string) => void | Promise<void>,
): ICanvasPageWriter {
  return {
    async rewriteContent(pageId, build, opts) {
      if (opts?.checkpointBefore) {
        try { await checkpointPage?.(pageId); } catch { /* never block the edit on checkpoint errors */ }
      }
      const row = await db.get<{ id: string; title: string; content: string }>(
        'SELECT id, title, content FROM pages WHERE id = ?',
        [pageId],
      );
      if (!row) return { ok: false, reason: `Page "${pageId}" not found.`, notFound: true };
      const decoded = decodeCanvasContent(row.content);
      if (decoded.unreadable) {
        return { ok: false, reason: `The content of page "${row.title}" cannot be read, so it is kept as is.` };
      }
      const page = { id: row.id, title: row.title };
      const next = build(structuredClone(decoded.doc) as PageDocJson, page);
      if (typeof next === 'string') return { ok: false, reason: next };
      const encoded = encodeCanvasContentFromDoc(next as never);
      // Bump `revision` so the data service's optimistic-concurrency check
      // sees this write and a pending editor save conflicts instead of
      // silently overwriting it.
      await db.run(
        'UPDATE pages SET content = ?, content_schema_version = ?, updated_at = ?, revision = revision + 1 WHERE id = ?',
        [encoded.storedContent, encoded.schemaVersion, sqliteUtcNow(), pageId],
      );
      return { ok: true, page, doc: next };
    },
    async setStyle(pageId, style) {
      const row = await db.get<{ id: string }>('SELECT id FROM pages WHERE id = ?', [pageId]);
      if (!row) return false;
      const sets: string[] = [];
      const params: unknown[] = [];
      if ('icon' in style) { sets.push('icon = ?'); params.push(style.icon ?? null); }
      if ('coverUrl' in style) { sets.push('cover_url = ?'); params.push(style.coverUrl ?? null); }
      if ('fontFamily' in style) { sets.push('font_family = ?'); params.push(style.fontFamily); }
      if ('fullWidth' in style) { sets.push('full_width = ?'); params.push(style.fullWidth ? 1 : 0); }
      if ('smallText' in style) { sets.push('small_text = ?'); params.push(style.smallText ? 1 : 0); }
      if (sets.length === 0) return true;
      sets.push('updated_at = ?', 'revision = revision + 1');
      params.push(sqliteUtcNow(), pageId);
      await db.run(`UPDATE pages SET ${sets.join(', ')} WHERE id = ?`, params);
      return true;
    },
    async createPage(init) {
      const id = crypto.randomUUID();
      const encoded = encodeCanvasContentFromDoc(init.doc as never);
      const now = sqliteUtcNow();
      await db.run(
        'INSERT INTO pages (id, title, icon, content, content_schema_version, is_archived, full_width, small_text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)',
        [id, init.title, init.icon, encoded.storedContent, encoded.schemaVersion, init.fullWidth ? 1 : 0, init.smallText ? 1 : 0, now, now],
      );
      return id;
    },
  };
}
