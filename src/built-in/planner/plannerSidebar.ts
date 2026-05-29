// plannerSidebar.ts — workbench sidebar view for the planner.
//
// Navigation only. Three tiles: Calendar, Tasks, Settings. Clicking a
// tile opens the planner editor at the matching tab (or invokes a
// settings command). The task list + filter groupings live INSIDE the
// editor's Tasks tab — the sidebar is just the way in.
//
// This matches every other built-in tool's sidebar role (Explorer for
// files, Canvas for pages, Dashboards for dashboards, …) — a flat list
// of jump-off points, not a working surface in its own right.

import { toDisposable, type IDisposable } from '../../platform/lifecycle.js';
import type { PlannerDataService } from './plannerDataService.js';

interface SidebarApi {
  editors: {
    openEditor(options: { typeId: string; title: string; icon?: string; iconHtml?: string; instanceId?: string }): Promise<void>;
  };
  commands: {
    executeCommand<T = unknown>(id: string, ...args: unknown[]): Promise<T>;
  };
  window: {
    showInformationMessage(message: string, ...actions: { title: string }[]): Promise<{ title: string } | undefined>;
    showErrorMessage(message: string, ...actions: { title: string }[]): Promise<{ title: string } | undefined>;
  };
}

const ICONS = {
  calendar: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
  tasks:    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
  settings: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
} as const;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

export class PlannerSidebar implements IDisposable {
  private _root: HTMLElement | null = null;
  private _disposed = false;
  private readonly _disposables: IDisposable[] = [];

  constructor(
    private readonly _data: PlannerDataService,
    private readonly _api: SidebarApi,
  ) {}

  createView(container: HTMLElement): IDisposable {
    container.classList.add('planner-sidebar-host');
    const root = el('nav', 'planner-sidebar');
    root.setAttribute('aria-label', 'Planner navigation');
    this._root = root;

    type Item = { key: string; label: string; icon: string; subtitle?: string; onClick: () => void };
    const items: Item[] = [
      {
        key: 'calendar',
        label: 'Calendar',
        icon: ICONS.calendar,
        subtitle: 'Month, week, day views',
        onClick: () => void this._openTab('calendar'),
      },
      {
        key: 'tasks',
        label: 'Tasks',
        icon: ICONS.tasks,
        subtitle: 'Capture, plan, complete',
        onClick: () => void this._openTab('tasks'),
      },
      {
        key: 'settings',
        label: 'Settings',
        icon: ICONS.settings,
        onClick: () => {
          this._api.commands.executeCommand('settings.open').catch(() =>
            this._api.window.showInformationMessage('Planner settings are coming soon.'),
          );
        },
      },
    ];

    for (const item of items) {
      const tile = el('button', 'planner-sidebar__tile');
      tile.type = 'button';
      tile.dataset.key = item.key;

      const iconEl = el('span', 'planner-sidebar__tile-icon');
      iconEl.innerHTML = item.icon;
      tile.appendChild(iconEl);

      const text = el('span', 'planner-sidebar__tile-text');
      const labelEl = el('span', 'planner-sidebar__tile-label');
      labelEl.textContent = item.label;
      text.appendChild(labelEl);
      if (item.subtitle) {
        const subEl = el('span', 'planner-sidebar__tile-sub');
        subEl.textContent = item.subtitle;
        text.appendChild(subEl);
      }
      tile.appendChild(text);

      const chev = el('span', 'planner-sidebar__tile-chev');
      chev.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>';
      tile.appendChild(chev);

      tile.addEventListener('click', item.onClick);

      // Small live badge on the Tasks tile — reviewing-queue count. It's
      // the one piece of state the user wants visible without clicking in.
      if (item.key === 'tasks') {
        const badge = el('span', 'planner-sidebar__tile-badge');
        badge.dataset.role = 'review-count';
        badge.style.display = 'none';
        tile.insertBefore(badge, chev);
      }

      root.appendChild(tile);
    }

    container.appendChild(root);

    // Hydrate + keep the review-queue badge live.
    const updateReviewBadge = async () => {
      if (this._disposed || !this._root) return;
      let count = 0;
      try {
        const pending = await this._data.listTasks({ status: 'reviewing', includeUndated: true });
        count = pending.length;
      } catch { /* swallow — badge defaults to hidden */ }
      const badge = this._root.querySelector('[data-role="review-count"]') as HTMLElement | null;
      if (!badge) return;
      if (count > 0) {
        badge.textContent = String(count);
        badge.style.display = '';
      } else {
        badge.style.display = 'none';
      }
    };
    void updateReviewBadge();
    this._disposables.push(this._data.onDidChange((e) => {
      if (e.kind === 'task-created' || e.kind === 'task-updated' || e.kind === 'task-removed') {
        void updateReviewBadge();
      }
    }));

    return toDisposable(() => {
      this.dispose();
      container.classList.remove('planner-sidebar-host');
    });
  }

  private async _openTab(tab: 'tasks' | 'calendar'): Promise<void> {
    try {
      await this._api.editors.openEditor({
        typeId: 'planner',
        title: 'Planner',
        instanceId: 'main',
      });
      // After the editor mounts, the cross-pane event bus could signal
      // which tab to focus — for now the editor remembers the last tab.
      document.dispatchEvent(new CustomEvent('parallx.planner.focusTab', { detail: { tab } }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this._api.window.showErrorMessage(`Could not open Planner: ${msg}`);
    }
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    for (const d of this._disposables) {
      try { d.dispose(); } catch { /* noop */ }
    }
    this._disposables.length = 0;
    if (this._root && this._root.parentElement) this._root.remove();
    this._root = null;
  }
}
