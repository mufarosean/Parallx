// dashboardSidebar.ts — workbench sidebar view for dashboards.
//
// Renders the list of dashboard pages with click-to-open, double-click-to-
// rename, right-click for context actions (rename / duplicate / delete),
// active-tab highlight that follows the editor, and a "+ New dashboard"
// affordance at the bottom. The sidebar is the discovery surface — the
// ribbon icon takes the user here, and from here they jump into any
// dashboard page.

import { toDisposable, type IDisposable } from '../../platform/lifecycle.js';
import { attachPopupDismiss } from '../../ui/dom.js';
import type { DashboardDataService } from './dashboardDataService.js';
import type { DashboardPageRow } from './dashboardTypes.js';

interface SidebarApi {
  editors: {
    openEditor(options: { typeId: string; title: string; icon?: string; iconHtml?: string; instanceId?: string }): Promise<void>;
    closeEditor(editorId: string): Promise<boolean>;
    focusEditor?(editorId: string): Promise<boolean>;
    readonly openEditors: readonly { id: string; name: string; description: string; isDirty: boolean; isActive: boolean; groupId: string }[];
    onDidChangeOpenEditors(listener: () => void): IDisposable;
  };
  commands: {
    executeCommand<T = unknown>(id: string, ...args: unknown[]): Promise<T>;
  };
  window: {
    showInputBox?(options?: { prompt?: string; value?: string; placeholder?: string }): Promise<string | undefined>;
    showInformationMessage(message: string, ...actions: { title: string }[]): Promise<{ title: string } | undefined>;
    showWarningMessage(message: string, ...actions: { title: string }[]): Promise<{ title: string } | undefined>;
    showErrorMessage(message: string, ...actions: { title: string }[]): Promise<{ title: string } | undefined>;
  };
}

const DASH_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

// The dashboard editor's id IS the page id. The sidebar opens dashboards with
// `instanceId: page.id`, and the editor bridge uses that instanceId verbatim as
// the editor input id (editorsBridge.ts openEditor: `inputId = options.instanceId
// ?? ...`), which is what editorService.focusEditor / getOpenEditors match on.
// The old `${toolId}:${typeId}:${instanceId}` form never matched any open
// editor — so focusEditor missed and fell through to openEditor, spawning a
// duplicate tab (and the active-row highlight + close-on-remove silently
// no-op'd too).
function dashboardEditorIdForPage(pageId: string): string {
  return pageId;
}

export class DashboardSidebar implements IDisposable {
  private _root: HTMLElement | null = null;
  private _list: HTMLElement | null = null;
  private _disposed = false;
  private readonly _disposables: IDisposable[] = [];
  private _pages: DashboardPageRow[] = [];

  constructor(
    private readonly _data: DashboardDataService,
    private readonly _api: SidebarApi,
  ) {}

  /** Called by the workbench view contribution to render into a container. */
  createView(container: HTMLElement): IDisposable {
    container.classList.add('dashboard-sidebar-host');

    const root = el('div', 'dashboard-sidebar');
    this._root = root;

    // Toolbar
    const toolbar = el('div', 'dashboard-sidebar__toolbar');
    const newBtn = el('button', 'dashboard-sidebar__newbtn');
    newBtn.type = 'button';
    newBtn.title = 'New dashboard';
    newBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg><span>New dashboard</span>';
    newBtn.addEventListener('click', () => void this._createPage());
    toolbar.appendChild(newBtn);
    root.appendChild(toolbar);

    // List
    const list = el('div', 'dashboard-sidebar__list');
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', 'Dashboards');
    this._list = list;
    root.appendChild(list);

    container.appendChild(root);

    // Initial load + subscriptions
    void this._refresh();
    this._disposables.push(this._data.onDidChange((e) => {
      if (this._disposed) return;
      if (e.kind === 'page-created' || e.kind === 'page-renamed' || e.kind === 'page-removed') {
        void this._refresh();
      }
    }));
    this._disposables.push(this._api.editors.onDidChangeOpenEditors(() => {
      if (this._disposed) return;
      this._updateActiveHighlight();
    }));

    return toDisposable(() => {
      this.dispose();
      container.classList.remove('dashboard-sidebar-host');
    });
  }

  // ── Render ───────────────────────────────────────────────────────────

  private async _refresh(): Promise<void> {
    if (!this._list) return;
    this._pages = await this._data.listPages();
    this._renderList();
    this._updateActiveHighlight();
  }

  private _renderList(): void {
    if (!this._list) return;
    this._list.innerHTML = '';

    if (this._pages.length === 0) {
      const empty = el('div', 'dashboard-sidebar__empty');
      empty.innerHTML = `
        <div class="dashboard-sidebar__empty-icon">${DASH_ICON_SVG}</div>
        <strong>No dashboards yet</strong>
        <p>Use the button above to create one.</p>
      `;
      this._list.appendChild(empty);
      return;
    }

    for (const page of this._pages) {
      const row = el('div', 'dashboard-sidebar__row');
      row.dataset.pageId = page.id;
      row.setAttribute('role', 'option');
      row.tabIndex = 0;

      const icon = el('span', 'dashboard-sidebar__row-icon');
      icon.innerHTML = DASH_ICON_SVG;
      row.appendChild(icon);

      const label = el('span', 'dashboard-sidebar__row-label');
      label.textContent = page.name || 'Untitled';
      row.appendChild(label);

      const more = el('button', 'dashboard-sidebar__row-more');
      more.type = 'button';
      more.title = 'More actions';
      more.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>';
      more.addEventListener('click', (e) => {
        e.stopPropagation();
        this._openContextMenu(page, more.getBoundingClientRect());
      });
      row.appendChild(more);

      row.addEventListener('click', () => void this._openPage(page));
      row.addEventListener('dblclick', () => void this._renamePage(page));
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          void this._openPage(page);
        } else if (e.key === 'F2') {
          e.preventDefault();
          void this._renamePage(page);
        } else if (e.key === 'Delete') {
          e.preventDefault();
          void this._deletePage(page);
        }
      });
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this._openContextMenu(page, { left: e.clientX, top: e.clientY, right: e.clientX, bottom: e.clientY, width: 0, height: 0 } as DOMRect);
      });

      this._list.appendChild(row);
    }
  }

  private _updateActiveHighlight(): void {
    if (!this._list) return;
    const openIds = new Set(this._api.editors.openEditors.filter(e => e.isActive).map(e => e.id));
    for (const row of Array.from(this._list.children)) {
      if (!(row instanceof HTMLElement)) continue;
      const pageId = row.dataset.pageId;
      if (!pageId) continue;
      const isActive = openIds.has(dashboardEditorIdForPage(pageId));
      row.classList.toggle('dashboard-sidebar__row--active', isActive);
    }
  }

  // ── Actions ──────────────────────────────────────────────────────────

  private async _openPage(page: DashboardPageRow): Promise<void> {
    try {
      // Prefer focusEditor for an already-open page so it doesn't get
      // re-instantiated; fall back to openEditor.
      const editorId = dashboardEditorIdForPage(page.id);
      if (this._api.editors.focusEditor) {
        const focused = await this._api.editors.focusEditor(editorId);
        if (focused) return;
      }
      await this._api.editors.openEditor({
        typeId: 'dashboard',
        title: page.name || 'Dashboard',
        iconHtml: DASH_ICON_SVG,
        instanceId: page.id,
      });
    } catch (err) {
      console.warn('[Dashboard] openPage failed:', err);
      await this._api.window.showErrorMessage('Could not open dashboard.');
    }
  }

  private async _createPage(): Promise<void> {
    try {
      const page = await this._data.createPage(this._nextDefaultName());
      // Open immediately so the user lands on the fresh page.
      await this._openPage(page);
    } catch (err) {
      console.error('[Dashboard] createPage failed:', err);
      const msg = err instanceof Error ? err.message : String(err);
      await this._api.window.showErrorMessage(`Could not create dashboard: ${msg}`);
    }
  }

  private _nextDefaultName(): string {
    const used = new Set(this._pages.map(p => p.name));
    if (!used.has('Dashboard')) return 'Dashboard';
    for (let i = 2; i < 99; i++) {
      const candidate = `Dashboard ${i}`;
      if (!used.has(candidate)) return candidate;
    }
    return 'Dashboard';
  }

  private async _renamePage(page: DashboardPageRow): Promise<void> {
    if (!this._api.window.showInputBox) return;
    const next = await this._api.window.showInputBox({
      prompt: 'Rename dashboard',
      value: page.name,
      placeholder: 'Dashboard',
    });
    if (!next || next.trim() === page.name) return;
    try {
      await this._data.renamePage(page.id, next.trim());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this._api.window.showErrorMessage(`Could not rename dashboard: ${msg}`);
    }
  }

  private async _duplicatePage(page: DashboardPageRow): Promise<void> {
    try {
      const newName = `${page.name} (copy)`;
      const newPage = await this._data.createPage(newName);
      // Copy widgets too — listWidgets returns the source rows.
      const widgets = await this._data.listWidgets(page.id);
      for (const w of widgets) {
        await this._data.createWidget({
          pageId: newPage.id,
          widgetTypeId: w.widgetTypeId,
          placement: w.placement,
          config: w.config,
          refreshPolicy: w.refreshPolicy,
        });
      }
      await this._openPage(newPage);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this._api.window.showErrorMessage(`Could not duplicate dashboard: ${msg}`);
    }
  }

  private async _deletePage(page: DashboardPageRow): Promise<void> {
    // Confirm via standard message box.
    const result = await this._api.window.showWarningMessage(
      `Delete dashboard "${page.name}"? Widgets on this page will be removed too.`,
      { title: 'Delete' }, { title: 'Cancel' },
    );
    if (!result || result.title !== 'Delete') return;
    try {
      // Close the editor if it's open.
      const editorId = dashboardEditorIdForPage(page.id);
      await this._api.editors.closeEditor(editorId).catch(() => {});
      await this._data.removePage(page.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this._api.window.showErrorMessage(`Could not delete dashboard: ${msg}`);
    }
  }

  // ── Context menu ─────────────────────────────────────────────────────

  private _openContextMenu(page: DashboardPageRow, anchor: { left: number; top: number; right: number; bottom: number; width: number; height: number }): void {
    // Lightweight, self-contained context menu — no dependency on
    // workbench-level menu services. Closes on outside click / Escape.
    const overlay = el('div', 'dashboard-sidebar-menu-overlay');
    // One close path — the Escape listener this replaces was removed only
    // in its own branch, leaking one document handler per right-click,
    // unbounded, never cleaned by dispose().
    const close = (): void => {
      detach();
      overlay.remove();
    };
    overlay.addEventListener('click', close);
    overlay.addEventListener('contextmenu', (e) => { e.preventDefault(); close(); });

    const menu = el('div', 'dashboard-sidebar-menu');
    menu.style.position = 'fixed';

    const items: { label: string; icon: string; danger?: boolean; action: () => Promise<void> | void }[] = [
      { label: 'Open',     icon: 'M5 12l5 5L20 7',                                       action: () => this._openPage(page) },
      { label: 'Rename',   icon: 'M12 20h9 M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z', action: () => this._renamePage(page) },
      { label: 'Duplicate', icon: 'M20 9h-9 a2 2 0 0 0 -2 2v9 M5 5h4 v4 M5 1h4 a2 2 0 0 1 2 2v3', action: () => this._duplicatePage(page) },
      { label: 'Delete',   icon: 'M3 6h18 M19 6l-1 14a2 2 0 0 1 -2 2H8a2 2 0 0 1 -2 -2L5 6 M8 6V4a2 2 0 0 1 2 -2h4a2 2 0 0 1 2 2v2', danger: true, action: () => this._deletePage(page) },
    ];

    for (const item of items) {
      const btn = el('button', 'dashboard-sidebar-menu__item');
      btn.type = 'button';
      if (item.danger) btn.classList.add('dashboard-sidebar-menu__item--danger');
      btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${item.icon}"/></svg><span>${item.label}</span>`;
      btn.addEventListener('click', () => {
        close();
        void item.action();
      });
      menu.appendChild(btn);
    }

    overlay.appendChild(menu);
    document.body.appendChild(overlay);

    // Position after mount so we can measure.
    const m = menu.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = anchor.left;
    let top = anchor.bottom + 4;
    if (left + m.width > vw - 8) left = Math.max(8, vw - m.width - 8);
    if (top + m.height > vh - 8) top = Math.max(8, anchor.top - m.height - 4);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;

    // Standard popup contract (Escape / outside press / window blur).
    const detach = attachPopupDismiss(menu, close);
  }

  // ── Disposal ─────────────────────────────────────────────────────────

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    for (const d of this._disposables) {
      try { d.dispose(); } catch { /* noop */ }
    }
    this._disposables.length = 0;
    if (this._root && this._root.parentElement) this._root.remove();
    this._root = null;
    this._list = null;
  }
}
