// notesWidget.ts — a real canvas page, embedded as a dashboard widget.
//
// The note IS a canvas page: it shows in the canvas sidebar, lands in the
// workspace graph, and opens full-screen — so mind-mapping / grouping works.
// The widget hosts the actual canvas editor (every block, the real slash
// menu, bubble, handles) THROUGH the embedded-note seam canvas registers as
// `canvas.getEmbeddedNoteHost` (Phase D step 2): this file holds only
// structural types, so the dashboard loads whether or not canvas does —
// the widget simply shows its unavailable state when canvas is absent.

import type {
  WidgetContext,
  WidgetHandle,
  WidgetTypeRegistration,
} from '../dashboardTypes.js';

interface NotesConfig {
  readonly textSize: 'sm' | 'md' | 'lg';
}

const DEFAULT_CONFIG: NotesConfig = { textSize: 'md' };

const ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9z"/><path d="M15 3v6h6"/><path d="M8 13h6"/><path d="M8 17h4"/></svg>';

interface DashboardApi {
  commands?: { executeCommand<T = unknown>(id: string, ...args: unknown[]): Promise<T> };
}

/** What the canvas offers an embedded note — structural, canvas-owned. */
interface EmbeddedNoteHandle {
  setContent(content: unknown): void;
  dispose(): void;
}
interface EmbeddedNoteHost {
  getPage(id: string): Promise<unknown | null>;
  createPage(parentId: string | null, title: string): Promise<{ readonly id: string }>;
  mount(host: HTMLElement, pageId: string): Promise<EmbeddedNoteHandle>;
}

function normalizeConfig(raw: unknown): NotesConfig {
  const cfg = (raw ?? {}) as Partial<NotesConfig>;
  const size = cfg.textSize;
  return { textSize: size === 'sm' || size === 'lg' ? size : 'md' };
}

export const NOTES_WIDGET: WidgetTypeRegistration<NotesConfig> = {
  typeId: 'parallx.dashboard.notes',
  displayName: 'Notes',
  description: 'A real canvas page, embedded. Type "/" for any block. It also shows in the canvas sidebar and the workspace graph.',
  icon: ICON_SVG,
  category: 'static',
  defaultSize: { colSpan: 4, rowSpan: 4 },
  defaultConfig: DEFAULT_CONFIG,
  configSchema: {
    fields: {
      textSize: {
        type: 'enum',
        label: 'Text size',
        options: [
          { value: 'sm', label: 'Small' },
          { value: 'md', label: 'Normal' },
          { value: 'lg', label: 'Large' },
        ],
      },
    },
  },
  defaultRefreshPolicy: { kind: 'manual' },

  createWidget(container: HTMLElement, ctx: WidgetContext<NotesConfig>): WidgetHandle {
    container.classList.add('ntw');
    let config = normalizeConfig(ctx.config);
    const applyTextSize = (): void => {
      container.classList.remove('ntw--sm', 'ntw--md', 'ntw--lg');
      container.classList.add(`ntw--${config.textSize}`);
    };
    applyTextSize();

    // Toolbar (open full page in canvas) + the editor host.
    const bar = document.createElement('div');
    bar.className = 'ntw__bar';
    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.className = 'ntw__open';
    openBtn.title = 'Open this page in the canvas';
    openBtn.innerHTML = '<span>↗</span> Open in canvas';
    bar.appendChild(openBtn);

    const host = document.createElement('div');
    host.className = 'ntw__host';
    container.append(bar, host);

    const api = ctx.api as DashboardApi;

    let view: EmbeddedNoteHandle | null = null;
    let pageId = '';
    let disposed = false;
    openBtn.addEventListener('click', () => {
      if (pageId) void api.commands?.executeCommand?.('canvas.openPage', pageId);
    });

    async function setup(): Promise<void> {
      // The seam: canvas offers embedding through a getter command; absent
      // (tool inactive or not installed) means the honest empty state.
      let noteHost: EmbeddedNoteHost | null = null;
      try {
        noteHost = (await api.commands?.executeCommand<EmbeddedNoteHost | undefined>('canvas.getEmbeddedNoteHost')) ?? null;
      } catch { noteHost = null; }
      if (!noteHost || typeof noteHost.mount !== 'function') {
        host.innerHTML = '<div class="ntw__empty"><strong>Canvas unavailable</strong><p>The canvas tool isn’t active, so this note can’t be hosted.</p></div>';
        return;
      }

      // Resolve the backing page from the widget's stored state.
      let legacyDoc: unknown = null;
      try {
        const saved = ctx.cachedOutput ? JSON.parse(ctx.cachedOutput) : null;
        if (saved && typeof saved.pageId === 'string') pageId = saved.pageId;
        else if (saved && saved.type === 'doc') legacyDoc = saved; // interim ProseMirror note → migrate
      } catch { /* legacy markdown string — handled below */ }

      // Validate an existing page (it may have been deleted from the canvas).
      if (pageId) {
        try { if (!(await noteHost.getPage(pageId))) pageId = ''; } catch { pageId = ''; }
      }
      if (disposed) return;

      // First run (or page gone): mint a real canvas page for this note.
      if (!pageId) {
        try {
          const page = await noteHost.createPage(null, 'Note');
          pageId = page.id;
          ctx.setCachedOutput(JSON.stringify({ pageId }));
        } catch (err) {
          console.warn('[Dashboard] notes: createPage failed:', err);
          host.innerHTML = '<div class="ntw__empty"><strong>Couldn’t create the note page</strong></div>';
          return;
        }
      }
      if (disposed) return;

      const v = await noteHost.mount(host, pageId);
      view = v;
      if (disposed) { v.dispose(); return; }

      // One-time migration of the previous in-widget note into the new page.
      if (legacyDoc) {
        v.setContent(legacyDoc);
      } else if (ctx.cachedOutput && !ctx.cachedOutput.trim().startsWith('{')) {
        // Oldest format: a raw markdown/text note. Seed it as plain text so the
        // content isn't lost; the user reformats with the real block tools.
        v.setContent(ctx.cachedOutput);
      }
    }
    void setup();

    const sub = ctx.onDidChangeConfig((next) => {
      config = normalizeConfig(next);
      applyTextSize();
    });

    return {
      dispose() {
        disposed = true;
        sub.dispose();
        view?.dispose();
      },
    };
  },
};
