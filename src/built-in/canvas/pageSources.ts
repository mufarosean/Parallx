// pageSources.ts — what the canvas offers the rest of the app about its pages.
//
// Three contribution points, registered while the canvas runs: the read-only
// page query other tools see (lists, trees and change events, never a page
// body), the Quick Open source that lets Ctrl+P find a page beside the
// files, most recently edited first, each with the pages above it as its
// place, and the Home source: recent pages, each with its opening words.

import type { IPageSummaryTreeNode, ICanvasDataService } from './canvasTypes.js';
import { ICanvasPageQueryService } from '../../services/serviceTypes.js';
import { registerQuickOpenSource } from '../../services/quickOpenSources.js';
import { registerHomeSource, type HomeItem } from '../../services/homeSources.js';
import type { IDisposable } from '../../platform/lifecycle.js';
import type { IRecentsServiceShape } from '../../services/recentsService.js';
import { decodeCanvasContent } from './contentSchema.js';
import { parseStoredTime } from '../../platform/storedTime.js';

interface ServiceHost {
  readonly services: { registerInstance<T>(id: unknown, instance: T): void };
}

export function registerCanvasPageSources(
  api: ServiceHost,
  subscriptions: IDisposable[],
  dataService: ICanvasDataService,
  openPage: (pageId: string) => Promise<void>,
  recents?: IRecentsServiceShape,
): void {
  const pageQuery: ICanvasPageQueryService = {
    getRootPages: () => dataService.getRootPages(),
    getChildren: (parentId) => dataService.getChildren(parentId),
    getPageTree: () => dataService.getPageSummaryTree(),
    onDidChangePage: dataService.onDidChangePage,
  };
  api.services.registerInstance(ICanvasPageQueryService, pageQuery);

  subscriptions.push(registerQuickOpenSource({
    id: 'canvas.pages',
    group: 'pages',
    kind: 'Page',
    listItems: async () => {
      const flat: { page: IPageSummaryTreeNode; path: string }[] = [];
      const walk = (nodes: readonly IPageSummaryTreeNode[], path: string): void => {
        for (const node of nodes) {
          flat.push({ page: node, path });
          walk(node.children, path ? `${path} / ${node.title || 'Untitled'}` : (node.title || 'Untitled'));
        }
      };
      walk(await dataService.getPageSummaryTree(), '');
      flat.sort((a, b) => (b.page.updatedAt ?? '').localeCompare(a.page.updatedAt ?? ''));
      return flat.map(({ page, path }) => ({
        id: page.id,
        label: page.title || 'Untitled',
        detail: path || undefined,
        open: () => { void openPage(page.id); },
      }));
    },
  }));
  // Home: the pages a person last opened, each with its opening words. What
  // was opened comes from the core's record of it, not from when a page last
  // changed: tools write pages too (a plan's days, a table's rows), and those
  // are not what he was working on. A query finds any page by title.
  /** One reading per page, kept while the page has not changed since. */
  const texts = new Map<string, { stamp: string; text: PageText }>();
  type Listed = Pick<IPageSummaryTreeNode, 'id' | 'title' | 'updatedAt'> & { readonly content?: string };
  const toHome = async (page: Listed, where?: string, openedAt = 0): Promise<HomeItem> => {
    if (texts.get(page.id)?.stamp !== page.updatedAt) texts.set(page.id, { stamp: page.updatedAt, text: pageText(page.content ?? (await dataService.getPage(page.id))?.content) });
    const text = texts.get(page.id)!.text;
    return {
      id: page.id, title: page.title || 'Untitled', kind: 'Page', icon: 'px-canvas', where,
      // Opened by him: that time. Found another way: when it last changed (stored in UTC with no zone mark).
      summary: text.opening, preview: text.preview, touchedAt: openedAt || parseStoredTime(page.updatedAt) || 0,
      stat: text.words ? { value: String(text.words), unit: text.words === 1 ? 'word' : 'words' } : undefined,
      open: () => { void openPage(page.id); },
    };
  };
  const listOpened = async (limit: number): Promise<HomeItem[]> => {
    if (!recents) return Promise.all((await dataService.getRecentPages(limit)).map((p) => toHome(p)));
    await recents.whenReady;
    const opened = recents.getRecentOpens().filter((o) => o.kind === 'page').slice(0, limit);
    const items = await Promise.all(opened.map(async (o) => {
      const page = await dataService.getPage(o.target);
      return page && !page.isArchived ? toHome(page, undefined, o.ts) : null; // gone or in Trash since it was opened
    }));
    return items.filter((item): item is HomeItem => !!item);
  };
  subscriptions.push(registerHomeSource({
    id: 'canvas.pages',
    label: 'Canvas',
    listRecent: listOpened,
    find: async (ids) => {
      const pages = await Promise.all(ids.map((id) => dataService.getPage(id)));
      return Promise.all(pages.filter((p): p is NonNullable<typeof p> => !!p && !p.isArchived).map((p) => toHome(p)));
    },
    search: async (query, limit) => {
      const q = query.toLowerCase();
      const found: Promise<HomeItem>[] = [];
      const walk = (nodes: readonly IPageSummaryTreeNode[], path: string): void => {
        for (const node of nodes) {
          const title = node.title || 'Untitled';
          if (found.length < limit && title.toLowerCase().includes(q)) found.push(toHome(node, path || undefined));
          walk(node.children, path ? `${path} / ${title}` : title);
        }
      };
      walk(await dataService.getPageSummaryTree(), '');
      return Promise.all(found);
    },
    onDidChange: (listener) => {
      const page = dataService.onDidChangePage(() => listener());
      const opens = recents?.onDidChangeOpens(() => listener());
      return { dispose: () => { page.dispose(); opens?.dispose(); } };
    },
  }));
}

export interface PageText {
  /** The first words, for the line under a page's title. */
  readonly opening: string;
  /** The first blocks, a line each, for a small picture of the page. */
  readonly preview: string;
  readonly words: number;
}

/** A page's body (as stored) read as words: how it opens, its first lines, and how many words it has. */
export function pageText(content: string | undefined, max = 160): PageText {
  if (!content) return { opening: '', preview: '', words: 0 };
  const lines: string[] = [];
  const textOf = (node: unknown, into: string[]): void => {
    if (!node || typeof node !== 'object') return;
    const n = node as { text?: unknown; content?: unknown };
    if (typeof n.text === 'string' && n.text.trim()) into.push(n.text.trim());
    if (Array.isArray(n.content)) for (const child of n.content) textOf(child, into);
  };
  for (const block of decodeCanvasContent(content).doc?.content ?? []) {
    const parts: string[] = [];
    textOf(block, parts);
    if (parts.length) lines.push(parts.join(' ').replace(/\s+/g, ' '));
  }
  const text = lines.join(' ');
  return {
    opening: text.length > max ? `${text.slice(0, max).replace(/\s+\S*$/, '')}…` : text,
    preview: lines.join('\n').slice(0, 900),
    words: text ? text.split(' ').length : 0,
  };
}
