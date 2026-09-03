// plannerSidebar.ts — workbench sidebar view for the planner.
//
// Navigation only. Three rows: Calendar, Tasks, Settings. Same list-row
// idiom every other Parallx sidebar uses (Explorer file tree, Canvas
// page tree, Dashboards list) — 26px row height, plain monochrome icon
// + label, workbench list-selection treatment on hover and active. The
// task list and filter groupings live inside the editor pane's Tasks
// tab; the sidebar is just the way in.

import { toDisposable, type IDisposable } from '../../platform/lifecycle.js';
import type { PlannerDataService } from './plannerDataService.js';
import { setPendingPlannerTab } from './plannerNavState.js';

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

type NavKey = 'calendar' | 'tasks' | 'scheduled' | 'settings';

const ICONS: Record<NavKey, string> = {
  calendar: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
  tasks:    '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
  scheduled: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h5"/><circle cx="17" cy="17" r="4"/><path d="M17 15.5V17l1 1"/></svg>',
  settings: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

export class PlannerSidebar implements IDisposable {
  private _root: HTMLElement | null = null;
  private _activeKey: NavKey = 'calendar';
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

    const list = el('div', 'planner-sidebar__list');
    root.appendChild(list);

    const rows: { key: NavKey; label: string; onClick: () => void }[] = [
      {
        key: 'calendar',
        label: 'Calendar',
        onClick: () => void this._openTab('calendar'),
      },
      {
        key: 'tasks',
        label: 'Tasks',
        onClick: () => void this._openTab('tasks'),
      },
      {
        key: 'scheduled',
        label: 'Scheduled',
        onClick: () => void this._openTab('scheduled'),
      },
      {
        key: 'settings',
        label: 'Settings',
        onClick: () => {
          this._setActive('settings');
          // Deep-link the Settings hub straight to the planner panel
          // (registered in main.ts via settingsPanelRegistry).
          this._api.commands.executeCommand('settings.open', 'planner').catch(() =>
            this._api.window.showInformationMessage('Could not open Planner settings.'),
          );
        },
      },
    ];

    for (const r of rows) {
      const row = el('button', 'planner-sidebar__row');
      row.type = 'button';
      row.dataset.key = r.key;
      row.setAttribute('role', 'option');
      row.tabIndex = 0;

      const icon = el('span', 'planner-sidebar__row-icon');
      icon.innerHTML = ICONS[r.key];
      row.appendChild(icon);

      const label = el('span', 'planner-sidebar__row-label');
      label.textContent = r.label;
      row.appendChild(label);

      if (r.key === 'tasks') {
        const count = el('span', 'planner-sidebar__row-count');
        count.dataset.role = 'review-count';
        count.style.display = 'none';
        row.appendChild(count);
      }

      row.addEventListener('click', r.onClick);
      list.appendChild(row);
    }

    container.appendChild(root);
    this._syncActive();

    // Live review-queue count on the Tasks row.
    const updateReviewBadge = async () => {
      if (this._disposed || !this._root) return;
      let count = 0;
      try {
        const pending = await this._data.listTasks({ status: 'reviewing', includeUndated: true });
        count = pending.length;
      } catch { /* keep hidden */ }
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

  private async _openTab(tab: 'calendar' | 'tasks' | 'scheduled'): Promise<void> {
    try {
      this._setActive(tab);
      // Record the target tab BEFORE opening so a first-open pane initialises to
      // it deterministically (the focusTab event below only catches panes that
      // already exist — on first open it races pane creation and was lost).
      setPendingPlannerTab(tab);
      await this._api.editors.openEditor({
        typeId: 'planner',
        title: 'Planner',
        instanceId: 'main',
      });
      document.dispatchEvent(new CustomEvent('parallx.planner.focusTab', { detail: { tab } }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this._api.window.showErrorMessage(`Could not open Planner: ${msg}`);
    }
  }

  private _setActive(key: NavKey): void {
    this._activeKey = key;
    this._syncActive();
  }

  private _syncActive(): void {
    const list = this._root?.querySelector('.planner-sidebar__list');
    if (!list) return;
    for (const child of Array.from(list.children)) {
      if (!(child instanceof HTMLElement)) continue;
      child.classList.toggle('planner-sidebar__row--active', child.dataset.key === this._activeKey);
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
