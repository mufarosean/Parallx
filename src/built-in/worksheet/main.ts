// Worksheets (M99) — exam-faithful practice sheets.
//
// A generic substrate surface: bounded spreadsheet items with givens and
// solutions, for practicing under a target tool's constraints (first user:
// CAS Exam 7 / Pearson Athena — docs/research/CAS_Pearson_Spreadsheet_Environment.md).
//
// The Univer engine ships as a SEPARATE lazily-imported bundle
// (dist/renderer/worksheet-univer.js, built from ./univerHost.ts) so the main
// bundle never pays for it. This module only type-imports from univerHost.
//
// Pane lifecycle contract (see editor-pane-lifecycle memory): panes are
// DESTROYED and rebuilt on every same-group tab switch. The workbook snapshot
// is captured in saveViewState and re-applied on the next build — without
// that, every tab switch would wipe the user's in-progress work.

import type { IWorksheetHost, IWorksheetHostOptions } from './univerHost.js';
import './worksheet.css';

// ── Module state ────────────────────────────────────────────────────────────

interface ParallxApiLike {
  editors: {
    registerEditorProvider(typeId: string, provider: unknown): { dispose(): void };
    openEditor(options: {
      typeId: string; title: string; iconHtml?: string; instanceId?: string;
    }): Promise<void>;
  };
  commands: {
    registerCommand(id: string, handler: (...args: unknown[]) => unknown): { dispose(): void };
  };
  window?: {
    showErrorMessage?(message: string): Promise<unknown>;
  };
}

interface ToolContextLike {
  subscriptions: { push(d: { dispose(): void }): void };
}

/**
 * Workbook snapshots cached across pane rebuilds, keyed by instanceId.
 * In-memory only for slice 1 (the scratch sheet); item attempts get SQLite
 * persistence in slice 2.
 */
const _snapshotCache = new Map<string, unknown>();

const WS_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/></svg>';

// ── Univer bundle loader ────────────────────────────────────────────────────

type UniverHostModule = {
  createWorksheetHost(opts: IWorksheetHostOptions): IWorksheetHost;
};

let _univerModule: Promise<UniverHostModule> | null = null;

/**
 * Load the engine bundle once per window. The specifier is computed at
 * runtime so esbuild cannot inline the multi-megabyte engine into the main
 * bundle; Chromium resolves it against the renderer's HTTP origin.
 */
function loadUniverModule(): Promise<UniverHostModule> {
  if (_univerModule) return _univerModule;
  const jsUrl = new URL('dist/renderer/worksheet-univer.js', document.baseURI).href;
  // The engine's stylesheet is emitted next to the JS bundle; link it once.
  const cssId = 'worksheet-univer-css';
  if (!document.getElementById(cssId)) {
    const link = document.createElement('link');
    link.id = cssId;
    link.rel = 'stylesheet';
    link.href = new URL('dist/renderer/worksheet-univer.css', document.baseURI).href;
    document.head.appendChild(link);
  }
  _univerModule = import(/* webpackIgnore: true */ jsUrl) as Promise<UniverHostModule>;
  return _univerModule;
}

// ── Editor pane ─────────────────────────────────────────────────────────────

function createWorksheetPane(container: HTMLElement, input?: { id?: string; instanceId?: string }) {
  // Provenance contract (M98 lesson): key domain state on instanceId, never
  // parse the namespaced input.id.
  const instanceId = input?.instanceId ?? input?.id ?? 'scratch';

  const root = document.createElement('div');
  root.className = 'ws-pane';
  const sheetHost = document.createElement('div');
  sheetHost.className = 'ws-pane__sheet';
  const loading = document.createElement('div');
  loading.className = 'ws-pane__loading';
  loading.textContent = 'Loading the practice sheet engine…';
  root.append(loading, sheetHost);
  container.appendChild(root);

  let host: IWorksheetHost | null = null;
  let disposed = false;

  void (async () => {
    try {
      const mod = await loadUniverModule();
      if (disposed) return;
      loading.remove();
      host = mod.createWorksheetHost({
        container: sheetHost,
        snapshot: (_snapshotCache.get(instanceId) ?? null) as IWorksheetHostOptions['snapshot'],
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      loading.textContent = `The sheet engine failed to load: ${message}`;
      console.error('[Worksheet] engine load failed:', err);
    }
  })();

  const capture = () => {
    const snap = host?.getSnapshot();
    if (snap) _snapshotCache.set(instanceId, snap);
  };

  return {
    saveViewState: () => {
      capture();
      return { instanceId };
    },
    restoreViewState: (_state: unknown) => {
      // Snapshot restore rides the cache keyed by instanceId (applied in the
      // async init above); nothing positional to restore yet.
    },
    dispose: () => {
      // Belt and braces: saveViewState is the contract, but capture here too
      // so a close-without-save path cannot silently drop work.
      capture();
      disposed = true;
      host?.dispose();
      host = null;
      root.remove();
    },
  };
}

// ── Activation ──────────────────────────────────────────────────────────────

export async function activate(api: ParallxApiLike, context: ToolContextLike): Promise<void> {
  context.subscriptions.push(
    api.editors.registerEditorProvider('worksheet', {
      createEditorPane: (container: HTMLElement, input?: { id?: string; instanceId?: string }) =>
        createWorksheetPane(container, input),
    }),
  );

  context.subscriptions.push(
    api.commands.registerCommand('worksheet.open', async () => {
      await api.editors.openEditor({
        typeId: 'worksheet',
        title: 'Practice Sheet',
        iconHtml: WS_ICON_SVG,
        instanceId: 'scratch',
      });
    }),
  );
}

export function deactivate(): void {
  _snapshotCache.clear();
}
