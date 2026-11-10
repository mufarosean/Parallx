// templates.ts — new-row templates (docs/DATABASES.md step 7).
//
// A template is a page under the database that is not a row: its title,
// icon, cover, content and property values are what a new row starts from.
// The database's config lists its templates and the default one; New makes
// a row from the default (or blank), and the menu beside New offers each.

import type { DatabaseDataService } from './databaseDataService.js';
import { getDatabaseConfig, updateDatabaseMeta } from './databaseMeta.js';

export interface ITemplatePages {
  getPage(pageId: string): Promise<{ title: string; icon: string | null; coverUrl: string | null; coverYOffset: number; content?: string } | null>;
  updatePage(pageId: string, patch: { title?: string; icon?: string | null; coverUrl?: string | null; coverYOffset?: number; content?: string }): Promise<void>;
  /** A page under `parentId` that is not a row. */
  createPage(parentId: string, title: string): Promise<string>;
}

export interface ITemplate { readonly id: string; readonly title: string; readonly icon: string | null; readonly isDefault: boolean }

/** The database's templates, in order, with the default marked; ids whose page is gone are dropped. */
export async function listTemplates(db: DatabaseDataService, pages: ITemplatePages, databaseId: string): Promise<ITemplate[]> {
  const cfg = await getDatabaseConfig(db, databaseId);
  const out: ITemplate[] = [];
  for (const id of cfg.templates) {
    const page = await pages.getPage(id).catch(() => null);
    if (page) out.push({ id, title: page.title || 'Untitled template', icon: page.icon, isDefault: cfg.defaultTemplate === id });
  }
  return out;
}

/** Make a template page under the database and list it. Returns its page id (open it to fill it in). */
export async function createTemplate(db: DatabaseDataService, pages: ITemplatePages, databaseId: string, title = 'New template'): Promise<string> {
  const id = await pages.createPage(databaseId, title);
  const cfg = await getDatabaseConfig(db, databaseId);
  await updateDatabaseMeta(db, databaseId, { config: { templates: [...cfg.templates, id] } });
  return id;
}

/** Forget a template (its page stays, as a page under the database). */
export async function removeTemplate(db: DatabaseDataService, databaseId: string, templateId: string): Promise<void> {
  const cfg = await getDatabaseConfig(db, databaseId);
  await updateDatabaseMeta(db, databaseId, { config: { templates: cfg.templates.filter((t) => t !== templateId), defaultTemplate: cfg.defaultTemplate === templateId ? null : cfg.defaultTemplate } });
}

export async function setDefaultTemplate(db: DatabaseDataService, databaseId: string, templateId: string | null): Promise<void> {
  await updateDatabaseMeta(db, databaseId, { config: { defaultTemplate: templateId } });
}

/**
 * A new row from a template: the template's values (the caller's `seed`
 * wins), then its title, icon, cover and content copied onto the new page.
 * Returns the new row's page id.
 */
export async function createRowFromTemplate(db: DatabaseDataService, pages: ITemplatePages, databaseId: string, templateId: string, seed: Record<string, unknown> = {}, title?: string): Promise<string> {
  const template = await pages.getPage(templateId);
  const values = await db.getRowValues(databaseId, templateId);
  const props = await db.listProperties(databaseId);
  const copy: Record<string, unknown> = {};
  for (const p of props) {
    if (p.type === 'unique_id' || p.type === 'created_time' || p.type === 'last_edited_time' || p.type === 'formula' || p.type === 'rollup') continue;
    const v = values[p.id];
    if (v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0)) copy[p.id] = v;
  }
  const row = await db.addRow(databaseId, title ?? template?.title ?? undefined, { ...copy, ...seed });
  if (template) {
    const patch: Parameters<ITemplatePages['updatePage']>[1] = {};
    if (template.icon) patch.icon = template.icon;
    if (template.coverUrl) { patch.coverUrl = template.coverUrl; patch.coverYOffset = template.coverYOffset; }
    if (template.content) patch.content = template.content;
    if (Object.keys(patch).length) await pages.updatePage(row.pageId, patch);
  }
  return row.pageId;
}

/** The template a plain New uses, when the database has a default and its page still exists. */
export async function defaultTemplateId(db: DatabaseDataService, pages: ITemplatePages, databaseId: string): Promise<string | null> {
  const cfg = await getDatabaseConfig(db, databaseId);
  if (!cfg.defaultTemplate) return null;
  return (await pages.getPage(cfg.defaultTemplate).catch(() => null)) ? cfg.defaultTemplate : null;
}
