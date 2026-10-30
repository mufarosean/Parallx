// pageSources.ts — what the canvas offers the rest of the app about its pages.
//
// Two contribution points, registered while the canvas runs: the read-only
// page query other tools see (lists, trees and change events, never a page
// body), and the Quick Open source that lets Ctrl+P find a page beside the
// files, most recently edited first, each with the pages above it as its
// place.

import type { IPageSummaryTreeNode, ICanvasDataService } from './canvasTypes.js';
import { ICanvasPageQueryService } from '../../services/serviceTypes.js';
import { registerQuickOpenSource } from '../../services/quickOpenSources.js';
import type { IDisposable } from '../../platform/lifecycle.js';

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
}
