// recentFilesWidget.ts — query-backed widget showing recent workspace files.
//
// Reads the same workspace storage key the welcome page uses
// (`parallx:quickAccess:recentFiles`). Clicking a row opens the file in
// whatever editor handles it. Refreshes on interval (default 60s) so
// changes from the workspace propagate without the user clicking.

import type {
  WidgetContext,
  WidgetHandle,
  WidgetRefreshContext,
  WidgetTypeRegistration,
} from '../dashboardTypes.js';

const RECENT_FILES_STORAGE_KEY = 'parallx:quickAccess:recentFiles';

interface RecentFilesConfig {
  readonly maxItems: number;
}

const DEFAULT_CONFIG: RecentFilesConfig = { maxItems: 8 };

const ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>';

// ─── Storage access ──────────────────────────────────────────────────────────
//
// The workspace KV bridge isn't passed into widgets directly — but the
// welcome page reads this same key via IStorage. For the widget we can
// either go through window.parallxElectron.storage (if exposed) or use
// localStorage as a fallback. The actual canonical source is the workspace
// storage; we look it up via parallxElectron at refresh time.

interface ParallxStorage {
  getWorkspace?(key: string): Promise<string | undefined>;
  get?(key: string): Promise<string | undefined>;
}

function getStorageBridge(): ParallxStorage | null {
  const electron = (window as { parallxElectron?: { storage?: ParallxStorage } }).parallxElectron;
  return electron?.storage ?? null;
}

async function readRecentFiles(): Promise<string[]> {
  const bridge = getStorageBridge();
  let raw: string | undefined;
  try {
    if (bridge?.getWorkspace) raw = await bridge.getWorkspace(RECENT_FILES_STORAGE_KEY);
    else if (bridge?.get) raw = await bridge.get(RECENT_FILES_STORAGE_KEY);
  } catch {
    raw = undefined;
  }
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((x: unknown): x is string => typeof x === 'string');
  } catch { /* malformed */ }
  return [];
}

function uriToDisplayParts(uri: string): { name: string; folder: string } {
  try {
    if (uri.startsWith('file:///')) {
      const decoded = decodeURIComponent(uri.slice(8)).replace(/\\/g, '/');
      const idx = decoded.lastIndexOf('/');
      const name = idx >= 0 ? decoded.slice(idx + 1) : decoded;
      const folderFull = idx >= 0 ? decoded.slice(0, idx) : '';
      // Shorten very long folders to "…/last-two-segments".
      const folder = (() => {
        if (folderFull.length <= 40) return folderFull;
        const parts = folderFull.split('/');
        if (parts.length <= 2) return folderFull;
        return '…/' + parts.slice(-2).join('/');
      })();
      return { name: name || uri, folder };
    }
  } catch { /* fall through */ }
  return { name: uri, folder: '' };
}

function fileExtIconClass(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return 'rfw__icon';
  const ext = name.slice(dot + 1).toLowerCase();
  return `rfw__icon rfw__icon--${ext}`;
}

// ─── Widget ──────────────────────────────────────────────────────────────────

export const RECENT_FILES_WIDGET: WidgetTypeRegistration<RecentFilesConfig> = {
  typeId: 'parallx.dashboard.recent-files',
  displayName: 'Recent files',
  description: 'Latest files you\'ve opened. Click to jump back in.',
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
    const files = await readRecentFiles();
    const max = clampMax(ctx.config?.maxItems);
    return JSON.stringify(files.slice(0, max));
  },

  createWidget(container: HTMLElement, ctx: WidgetContext<RecentFilesConfig>): WidgetHandle {
    container.classList.add('rfw');

    const list = document.createElement('div');
    list.className = 'rfw__list';
    container.appendChild(list);

    function paintFrom(cached: string | null): void {
      list.innerHTML = '';
      let files: string[] = [];
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed)) files = parsed.filter((x: unknown): x is string => typeof x === 'string');
        } catch { /* malformed */ }
      }

      if (files.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'rfw__empty';
        empty.innerHTML = `
          <strong>No recent files yet</strong>
          <p>Open a file from the explorer and it will appear here.</p>
        `;
        list.appendChild(empty);
        return;
      }

      for (const uri of files) {
        const { name, folder } = uriToDisplayParts(uri);
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'rfw__row';
        row.title = uri;

        const iconEl = document.createElement('span');
        iconEl.className = fileExtIconClass(name);
        iconEl.textContent = inferExtBadge(name);
        row.appendChild(iconEl);

        const text = document.createElement('span');
        text.className = 'rfw__text';
        const nameEl = document.createElement('span');
        nameEl.className = 'rfw__name';
        nameEl.textContent = name;
        text.appendChild(nameEl);
        if (folder) {
          const folderEl = document.createElement('span');
          folderEl.className = 'rfw__folder';
          folderEl.textContent = folder;
          text.appendChild(folderEl);
        }
        row.appendChild(text);

        row.addEventListener('click', () => {
          const api = ctx.api as {
            editors?: { openFileEditor?(uri: string, opts?: { pinned?: boolean }): Promise<void> };
          };
          api?.editors?.openFileEditor?.(uri, { pinned: false }).catch((err: unknown) => {
            console.warn('[Dashboard] openFileEditor failed:', err);
          });
        });

        list.appendChild(row);
      }
    }

    paintFrom(ctx.cachedOutput);

    const sub = ctx.onDidChangeConfig(() => {
      // Re-trigger refresh — config controls how many items we want.
      ctx.requestRefresh();
    });

    // Kick off an initial refresh if we don't have a cache yet.
    if (!ctx.cachedOutput) ctx.requestRefresh();

    return {
      refreshFromCache(cached: string | null) {
        paintFrom(cached);
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

function inferExtBadge(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return '·';
  const ext = name.slice(dot + 1).toLowerCase();
  if (ext.length <= 4) return ext;
  return ext.slice(0, 3);
}
