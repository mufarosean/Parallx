// dashboardMarkdownHandle.ts — the dashboard's own body for widget types that
// render Markdown: their cached output, the same empty and error states as
// the AI widgets, and a repaint only when the content changed.

import { renderMarkdownToDom } from './widgets/markdownRenderer.js';
import { ILinkResolverService } from '../../links/linkResolverService.js';
import type { WidgetContext, WidgetHandle } from './dashboardTypes.js';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

/**
 * Built-in body renderer for `renderMode: 'markdown'` widget types:
 * paints the cached output as Markdown, mirrors the AI widgets' empty and
 * error states, and re-paints from cache on delivery.
 */
export function createMarkdownHandle(body: HTMLElement, ctx: WidgetContext<unknown>, api: unknown): WidgetHandle {
  body.classList.add('dashboard-md');
  const surface = el('div', 'dashboard-md__surface');
  body.appendChild(surface);

  // Doors, not posters: parallx:// links in rendered markdown route
  // through the link resolver (e.g. the canvas page-embed's heading link
  // opens the real page). Plain web links open externally as usual.
  surface.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest('a');
    if (!a) return;
    const href = a.getAttribute('href') ?? '';
    if (!href.startsWith('parallx://')) return;
    e.preventDefault();
    try {
      const services = (api as { services?: { has(id: { id: string }): boolean; get<T>(id: { id: string }): T } }).services;
      if (services?.has(ILinkResolverService)) {
        void services.get<import('../../links/linkResolverService.js').ILinkResolverService>(ILinkResolverService).open(href);
      }
    } catch (err) {
      console.warn('[Dashboard] parallx:// link open failed:', err);
    }
  });

  // What is on screen; painting the same again only flashed it.
  let shown: string | null | undefined;
  let latest = ctx.cachedOutput;
  const paint = (cached: string | null): void => {
    if (cached === shown) return;
    shown = cached;
    surface.innerHTML = '';
    if (!cached) {
      const empty = el('div', 'dashboard-md__empty');
      empty.innerHTML = '<strong>Nothing here yet</strong><p>Click the refresh icon above to fill this widget.</p>';
      surface.appendChild(empty);
      return;
    }
    const md = el('div', 'dashboard-md__body');
    md.appendChild(renderMarkdownToDom(cached));
    surface.appendChild(md);
  };
  const paintError = (message: string): void => {
    shown = undefined;
    surface.innerHTML = '';
    const err = el('div', 'dashboard-md__error');
    const title = document.createElement('strong');
    title.textContent = 'Couldn’t update this widget';
    const detail = document.createElement('p');
    detail.textContent = message;
    err.appendChild(title);
    err.appendChild(detail);
    surface.appendChild(err);
  };

  if (ctx.errorMessage && !ctx.cachedOutput) paintError(ctx.errorMessage);
  else paint(ctx.cachedOutput);

  return {
    refreshFromCache(cached: string | null) { latest = cached; paint(cached); },
    renderError(message: string | null) {
      if (message) paintError(message);
      else paint(latest);
    },
    dispose() { /* nothing owned */ },
  };
}
