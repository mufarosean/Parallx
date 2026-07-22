// dashboardWidgets.ts — canvas's dashboard widget contributions (M86 C2).
//
// The canvas owns page data, so the canvas contributes the page-embed
// widget: a live rendering of any canvas page on a dashboard. renderMode
// 'markdown' means the dashboard renders the exported Markdown — no DOM
// code here — and the leading parallx:// link is the door back into the
// real page. Instantiations: a study-notes index page; a home-inventory
// or emergency-contacts page.

import type {
  WidgetRefreshContext,
  WidgetTypeRegistration,
} from '../../api/bridges/dashboardBridge.js';
import type { CanvasDataService } from './canvasDataService.js';
import type { IPageTreeNode } from './canvasTypes.js';
import { tiptapJsonToMarkdown } from './markdownExport.js';
import { decodeCanvasContent } from './contentSchema.js';

interface PageEmbedConfig {
  readonly page: string;
}

const MAX_EMBED_CHARS = 24_000;

const ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="2"/><line x1="8" y1="8" x2="16" y2="8"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="16" x2="13" y2="16"/></svg>';

function flattenTree(nodes: readonly IPageTreeNode[], out: IPageTreeNode[] = []): IPageTreeNode[] {
  for (const n of nodes) {
    out.push(n);
    if (n.children?.length) flattenTree(n.children, out);
  }
  return out;
}

export function buildPageEmbedWidget(
  getData: () => CanvasDataService | null,
): WidgetTypeRegistration<PageEmbedConfig> {
  return {
    typeId: 'parallx.canvas.page-embed',
    displayName: 'Canvas page',
    description: 'A live view of any canvas page, right on the dashboard. Pin your notes index, an emergency-contacts page, or a home inventory.',
    icon: ICON_SVG,
    category: 'query',
    renderMode: 'markdown',
    defaultSize: { colSpan: 5, rowSpan: 5 },
    defaultConfig: { page: '' },
    configSchema: {
      fields: {
        page: {
          type: 'string',
          label: 'Page',
          description: 'Page title (case-insensitive) or page id.',
          placeholder: 'e.g. "Phase 1 Study Notes"',
        },
      },
    },
    defaultRefreshPolicy: { kind: 'interval', ms: 5 * 60_000 },

    async refresh(ctx: WidgetRefreshContext<PageEmbedConfig>): Promise<string> {
      const data = getData();
      if (!data) throw new Error('Canvas is not ready yet.');
      const identifier = String((ctx.config as PageEmbedConfig)?.page ?? '').trim();
      if (!identifier) {
        return '_No page set. Open this widget’s settings and name the canvas page to embed._';
      }

      // Resolve by id first, then by title against the live page tree.
      let page = await data.getPage(identifier);
      if (!page) {
        const all = flattenTree(await data.getPageTree());
        const lower = identifier.toLowerCase();
        const found = all.find((p) => p.title.toLowerCase() === lower)
          ?? all.find((p) => p.title.toLowerCase().includes(lower));
        if (found) page = await data.getPage(found.id);
      }
      if (!page) {
        throw new Error(`No canvas page matches "${identifier}".`);
      }

      let body = '';
      try {
        // Versioned envelope, not a bare doc — decode through the schema.
        body = tiptapJsonToMarkdown(decodeCanvasContent(page.content || '{}').doc);
      } catch {
        body = '_This page could not be rendered._';
      }
      if (body.length > MAX_EMBED_CHARS) {
        body = `${body.slice(0, MAX_EMBED_CHARS)}\n\n_…truncated — open the page for the rest._`;
      }
      const icon = page.icon ? `${page.icon} ` : '';
      // The heading link is the door: parallx://canvas/page/<id> opens the
      // real page (the dashboard's markdown surface routes parallx:// links
      // through the link resolver).
      return `### ${icon}[${page.title || 'Untitled'}](parallx://canvas/page/${page.id})\n\n${body}`;
    },
  };
}
