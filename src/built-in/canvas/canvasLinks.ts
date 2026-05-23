// canvasLinks.ts — register the `canvas` segment with LinkResolverService
// via the public extension API. Mirrors the chat segment registration at
// src/built-in/chat/main.ts L2130 (api.links.register({...})).

import type { IDisposable } from '../../platform/lifecycle.js';
import type { LinksApi, LinksApiParsedLink } from '../../links/linksApi.js';

/** Minimum surface of `api.editors` needed by the canvas link handler. */
export interface CanvasLinksEditorsApi {
  openEditor(options: { typeId: string; title: string; instanceId?: string }): Promise<void>;
}

export interface CanvasLinksContext {
  subscriptions: Array<IDisposable | (() => void)>;
}

export interface CanvasLinksApiSlice {
  links: Pick<LinksApi, 'register'>;
  editors: CanvasLinksEditorsApi;
}

/**
 * Register the `canvas` link segment so `parallx://canvas/page/<pageId>`
 * URIs resolve into an open-canvas-editor call. The returned disposable
 * is pushed into `context.subscriptions` for clean teardown on deactivate.
 */
export function activateCanvasLinks(
  context: CanvasLinksContext,
  api: CanvasLinksApiSlice,
): void {
  const disposable = api.links.register({
    segment: 'canvas',
    displayName: 'Canvas',
    kinds: {
      page: {
        uriTemplate: 'parallx://canvas/page/<pageId>',
        description: 'Open a canvas page by id in the canvas editor. Returns false if the URI omits the page id or the editor cannot be opened.',
        examples: ['parallx://canvas/page/01HZX...'],
        async open(parsed: LinksApiParsedLink): Promise<boolean> {
          // `parallx://canvas/page/<pageId>` → pathSegments = ['page', '<pageId>'].
          // Mirrors the chat handler at chat/main.ts L2139 which reads
          // `parsed.pathSegments[1]` for the session id.
          const pageId = parsed.pathSegments[1];
          if (!pageId) return false;
          try {
            await api.editors.openEditor({
              typeId: 'canvas',
              title: 'Canvas',
              instanceId: pageId,
            });
            return true;
          } catch {
            return false;
          }
        },
      },
    },
  });
  context.subscriptions.push(disposable);
}
