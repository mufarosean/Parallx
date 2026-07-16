// recentItemsWidget.ts — the "Recent items" dashboard widget + its tracker.
//
// M86 ownership: this widget belongs to the explorer (it is file/page recency
// semantics), contributed to the dashboard via `api.dashboard`. The typeId
// keeps its pre-M86 value ('parallx.dashboard.recent-files') so persisted
// dashboard instances keep working — the id string is frozen, the OWNER moved
// (see LEGACY_WIDGET_TYPE_OWNERS in the dashboard bridge).
//
// The tracker hooks the editor service's active-editor changes — explorer
// files, canvas pages, and Ctrl+P opens are all captured uniformly — and
// persists a small recency list in the explorer's workspaceState. Widgets and
// other tools read it via `explorer.getRecentItems` (the pre-M86 alias
// `dashboard.getRecentItems` stays registered for back-compat).
//
// Visual styles (`rfw__*`) intentionally remain in dashboard.css: the widget
// renders inside the dashboard pane's DOM.

import type {
  WidgetContext,
  WidgetHandle,
  WidgetRefreshContext,
  WidgetTypeRegistration,
} from '../../api/bridges/dashboardBridge.js';
import type { IDisposable } from '../../platform/lifecycle.js';
import type { ToolContext } from '../../tools/toolModuleLoader.js';
import { IEditorService } from '../../services/serviceTypes.js';

// ─── Recency tracking (source of truth) ──────────────────────────────────────

interface RecentItem {
  /** Dedup key: `file:<uri>` or `page:<pageId>`. */
  readonly key: string;
  readonly kind: 'file' | 'page';
  readonly title: string;
  /** File URI (kind 'file') or page id (kind 'page') — used to reopen. */
  readonly target: string;
  readonly ts: number;
}

const RECENT_ITEMS_KEY = 'explorer.recentItems';
const RECENT_ITEMS_CAP = 30;
let _recentItems: RecentItem[] = [];

interface TrackerApi {
  commands: { registerCommand(id: string, handler: (...args: unknown[]) => unknown): IDisposable };
  services: { get<T>(id: { readonly id: string }): T; has(id: { readonly id: string }): boolean };
}

/**
 * Track recently-opened files + canvas pages. ONE recency-ordered list of
 * everything the user opened, captured from the editor service's
 * active-editor changes — the single signal both surfaces flow through.
 * Persisted per-workspace so it survives reloads.
 */
export function setupRecentItemsTracking(api: TrackerApi, context: ToolContext): void {
  try {
    const saved = context.workspaceState.get<RecentItem[]>(RECENT_ITEMS_KEY, []);
    if (Array.isArray(saved)) {
      _recentItems = saved.filter((x): x is RecentItem => !!x && typeof x.key === 'string' && typeof x.title === 'string');
    }
  } catch { /* fresh start */ }

  // Expose the read commands regardless — if the editor service is
  // unavailable the widget still shows whatever was persisted.
  context.subscriptions.push(
    api.commands.registerCommand('explorer.getRecentItems', () => _recentItems),
  );
  // Pre-M86 alias — the widget shipped reading this id; external callers may too.
  context.subscriptions.push(
    api.commands.registerCommand('dashboard.getRecentItems', () => _recentItems),
  );

  let editorService: IEditorService | undefined;
  try {
    editorService = api.services.has(IEditorService) ? api.services.get<IEditorService>(IEditorService) : undefined;
  } catch { editorService = undefined; }
  if (!editorService) return;

  const record = (input: { readonly id: string; readonly name: string; readonly uri?: { toString(): string } } | undefined): void => {
    if (!input) return;
    let item: RecentItem | null = null;
    if (input.uri) {
      const uri = input.uri.toString();
      item = { key: 'file:' + uri, kind: 'file', title: input.name || _basename(uri), target: uri, ts: Date.now() };
    } else {
      // Canvas editor ids look like `parallx.canvas:canvas:<pageId>` /
      // `…:database:<pageId>`. Anything else (dashboard, welcome) is skipped.
      const parts = (input.id || '').split(':');
      if (parts.length >= 3 && (parts[1] === 'canvas' || parts[1] === 'database')) {
        const pageId = parts.slice(2).join(':');
        item = { key: 'page:' + pageId, kind: 'page', title: input.name || 'Untitled', target: pageId, ts: Date.now() };
      }
    }
    if (!item) return;
    const next = item;
    _recentItems = [next, ..._recentItems.filter((r) => r.key !== next.key)].slice(0, RECENT_ITEMS_CAP);
    void context.workspaceState.update(RECENT_ITEMS_KEY, _recentItems);
  };

  record(editorService.activeEditor);
  context.subscriptions.push(editorService.onDidActiveEditorChange(record));
}

function _basename(uri: string): string {
  const clean = uri.split('?')[0].replace(/\\/g, '/').replace(/\/+$/, '');
  const idx = clean.lastIndexOf('/');
  const name = idx >= 0 ? clean.slice(idx + 1) : clean;
  try { return decodeURIComponent(name) || uri; } catch { return name || uri; }
}

// ─── Widget ──────────────────────────────────────────────────────────────────

interface RecentFilesConfig {
  readonly maxItems: number;
}

const DEFAULT_CONFIG: RecentFilesConfig = { maxItems: 8 };

const ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>';

// Per-kind row glyphs.
const FILE_GLYPH = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>';
const PAGE_GLYPH = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="2"/><line x1="8" y1="8" x2="16" y2="8"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="16" x2="13" y2="16"/></svg>';

interface CommandApi {
  commands?: { executeCommand<T = unknown>(id: string, ...args: unknown[]): Promise<T> };
  editors?: { openFileEditor?(uri: string, opts?: { pinned?: boolean }): Promise<void> };
}

async function fetchRecentItems(api: unknown): Promise<RecentItem[]> {
  const exec = (api as CommandApi).commands?.executeCommand;
  if (!exec) return [];
  try {
    const rows = await exec<RecentItem[]>('explorer.getRecentItems');
    return Array.isArray(rows)
      ? rows.filter((r): r is RecentItem => !!r && (r.kind === 'file' || r.kind === 'page') && typeof r.title === 'string')
      : [];
  } catch {
    return [];
  }
}

function fileFolder(uri: string): string {
  try {
    if (uri.startsWith('file:///')) {
      const decoded = decodeURIComponent(uri.slice(8)).replace(/\\/g, '/');
      const idx = decoded.lastIndexOf('/');
      const folderFull = idx >= 0 ? decoded.slice(0, idx) : '';
      if (folderFull.length <= 40) return folderFull;
      const parts = folderFull.split('/');
      return parts.length <= 2 ? folderFull : '…/' + parts.slice(-2).join('/');
    }
  } catch { /* fall through */ }
  return '';
}

function relativeTime(ts: number): string {
  if (!Number.isFinite(ts)) return '';
  const sec = Math.round((Date.now() - ts) / 1000);
  if (sec < 60) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

export const RECENT_ITEMS_WIDGET: WidgetTypeRegistration<RecentFilesConfig> = {
  typeId: 'parallx.dashboard.recent-files',
  displayName: 'Recent items',
  description: 'Files and canvas pages you\'ve opened recently. Click to jump back in.',
  icon: ICON_SVG,
  category: 'query',
  defaultSize: { colSpan: 4, rowSpan: 3 },
  defaultConfig: DEFAULT_CONFIG,
  configSchema: {
    fields: {
      maxItems: {
        type: 'number',
        label: 'How many to show',
        description: '1-20.',
      },
    },
  },
  defaultRefreshPolicy: { kind: 'interval', ms: 60_000 },

  async refresh(ctx: WidgetRefreshContext<RecentFilesConfig>): Promise<string> {
    const items = await fetchRecentItems((ctx as { api?: unknown }).api);
    const max = clampMax(ctx.config?.maxItems);
    return JSON.stringify(items.slice(0, max));
  },

  createWidget(container: HTMLElement, ctx: WidgetContext<RecentFilesConfig>): WidgetHandle {
    container.classList.add('rfw');

    const list = document.createElement('div');
    list.className = 'rfw__list';
    container.appendChild(list);

    function openItem(item: RecentItem): void {
      const api = ctx.api as CommandApi;
      if (item.kind === 'file') {
        api?.editors?.openFileEditor?.(item.target, { pinned: false }).catch((err: unknown) => {
          console.warn('[Explorer] openFileEditor failed:', err);
        });
      } else {
        api?.commands?.executeCommand?.('canvas.openPage', item.target).catch((err: unknown) => {
          console.warn('[Explorer] canvas.openPage failed:', err);
        });
      }
    }

    function paintFrom(cached: string | null): void {
      list.innerHTML = '';
      let items: RecentItem[] = [];
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed)) {
            items = parsed.filter((x: unknown): x is RecentItem => {
              const r = x as RecentItem;
              return !!r && (r.kind === 'file' || r.kind === 'page') && typeof r.title === 'string';
            });
          }
        } catch { /* malformed */ }
      }

      if (items.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'rfw__empty';
        empty.innerHTML = `
          <strong>No recent items yet</strong>
          <p>Open a file or a canvas page and it will appear here.</p>
        `;
        list.appendChild(empty);
        return;
      }

      for (const item of items) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = `rfw__row rfw__row--${item.kind}`;
        row.title = item.kind === 'file' ? item.target : item.title;

        const iconEl = document.createElement('span');
        iconEl.className = `rfw__icon rfw__icon--${item.kind}`;
        iconEl.innerHTML = item.kind === 'page' ? PAGE_GLYPH : FILE_GLYPH;
        row.appendChild(iconEl);

        const text = document.createElement('span');
        text.className = 'rfw__text';
        const nameEl = document.createElement('span');
        nameEl.className = 'rfw__name';
        nameEl.textContent = item.title;
        text.appendChild(nameEl);
        const subEl = document.createElement('span');
        subEl.className = 'rfw__folder';
        subEl.textContent = item.kind === 'file' ? (fileFolder(item.target) || relativeTime(item.ts)) : `Canvas page · ${relativeTime(item.ts)}`;
        text.appendChild(subEl);
        row.appendChild(text);

        row.addEventListener('click', () => openItem(item));
        list.appendChild(row);
      }
    }

    paintFrom(ctx.cachedOutput);

    const sub = ctx.onDidChangeConfig(() => {
      ctx.requestRefresh();
    });

    // Always refresh on mount — recent items change between renders.
    ctx.requestRefresh();

    return {
      refreshFromCache(cached: string | null) {
        paintFrom(cached);
      },
      renderError(message: string | null) {
        if (!message) { paintFrom(ctx.cachedOutput); return; }
        list.innerHTML = '';
        const err = document.createElement('div');
        err.className = 'rfw__empty';
        err.innerHTML = `<strong>Couldn’t load recent items</strong><p></p>`;
        const p = err.querySelector('p');
        if (p) p.textContent = message;
        list.appendChild(err);
      },
      dispose() {
        sub.dispose();
      },
    };
  },
};

function clampMax(n: unknown): number {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return DEFAULT_CONFIG.maxItems;
  return Math.max(1, Math.min(20, Math.floor(v)));
}
