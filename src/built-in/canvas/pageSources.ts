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
import { decodeCanvasContent } from './contentSchema.js';

interface ServiceHost {
  readonly services: { registerInstance<T>(id: unknown, instance: T): void };
}

export function registerCanvasPageSources(
  api: ServiceHost,
  subscriptions: IDisposable[],
  dataService: ICanvasDataService,
  openPage: (pageId: string) => Promise<void>,
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
  // Home: recent pages with their opening words; a query finds any page by title.
  const texts = new Map<string, PageText>();
  const toHome = async (page: IPageSummaryTreeNode | Awaited<ReturnType<ICanvasDataService['getRecentPages']>>[number], where?: string): Promise<HomeItem> => {
    const stamp = `${page.id}@${page.updatedAt}`;
    if (!texts.has(stamp)) texts.set(stamp, pageText((await dataService.getPage(page.id))?.content));
    const text = texts.get(stamp)!;
    return {
      id: page.id, title: page.title || 'Untitled', kind: 'Page', icon: 'px-canvas', where,
      summary: text.opening, preview: text.preview, touchedAt: Date.parse(page.updatedAt) || 0,
      stat: text.words ? { value: String(text.words), unit: text.words === 1 ? 'word' : 'words' } : undefined,
      open: () => { void openPage(page.id); },
    };
  };
  subscriptions.push(registerHomeSource({
    id: 'canvas.pages',
    label: 'Canvas',
    listRecent: async (limit) => Promise.all((await dataService.getRecentPages(limit)).map((p) => toHome(p))),
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
    onDidChange: (listener) => dataService.onDidChangePage(() => listener()),
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
