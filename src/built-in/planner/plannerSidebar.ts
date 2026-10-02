// plannerSidebar.ts — workbench sidebar view for the planner.
//
// Navigation (Today, Calendar, Tasks, Scheduled, Settings) and the Calendars
// toggles. Same list-row idiom every other Parallx sidebar uses (Explorer
// file tree, Canvas page tree, Dashboards list): plain monochrome icon +
// label, the shared hover and selection surfaces. The task list and filter
// groupings live inside the editor pane's Tasks tab; the sidebar is the way in.

import { toDisposable, type IDisposable } from '../../platform/lifecycle.js';
import type { PlannerDataService } from './plannerDataService.js';
import { setPendingPlannerTab } from './plannerNavState.js';
import { createIconElement } from '../../ui/iconRegistry.js';
import { createSectionLabel } from '../../ui/kit.js';

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

type NavKey = 'today' | 'calendar' | 'tasks' | 'settings';

/** Registry icon ids (ui/iconRegistry), the same ids the pane's tabs use. */
const ICONS: Record<NavKey, string> = {
  today: 'sun',
  calendar: 'calendar',
  tasks: 'list-checks',
  settings: 'settings',
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

export class PlannerSidebar implements IDisposable {
  private _root: HTMLElement | null = null;
  private _activeKey: NavKey = 'today';
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
        key: 'today',
        label: 'Today',
        onClick: () => void this._openTab('today'),
      },
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
      icon.appendChild(createIconElement(ICONS[r.key], 14));
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

    // Calendars — which ones the calendar and Today draw. The same toggle the
    // calendar toolbar's Calendars menu flips, kept in view here.
    const cals = el('div', 'planner-sidebar__cals');
    createSectionLabel(cals, 'Calendars').classList.add('planner-sidebar__label');
    const calList = el('div', 'planner-sidebar__cal-list');
    cals.appendChild(calList);
    list.appendChild(cals);
    const renderCalendars = async () => {
      if (this._disposed) return;
      let all: Awaited<ReturnType<PlannerDataService['listCalendars']>> = [];
      try { all = await this._data.listCalendars(); } catch { /* keep the last list */ return; }
      calList.replaceChildren(...all.map((cal) => {
        const row = el('button', 'planner-sidebar__row planner-sidebar__cal');
        row.type = 'button';
        row.setAttribute('role', 'checkbox');
        row.setAttribute('aria-checked', String(cal.visible));
        row.title = cal.visible ? `Hide ${cal.name}` : `Show ${cal.name}`;
        row.style.setProperty('--cal-color', cal.color);
        const box = el('span', 'planner-sidebar__cal-box');
        if (cal.visible) box.appendChild(createIconElement('check', 12));
        row.appendChild(box);
        const label = el('span', 'planner-sidebar__row-label');
        label.textContent = cal.name;
        row.appendChild(label);
        row.addEventListener('click', () => { void this._data.updateCalendar(cal.id, { visible: !cal.visible }); });
        return row;
      }));
    };
    void renderCalendars();
    this._disposables.push(this._data.onDidChange((e) => {
      if (e.kind === 'calendar-changed') void renderCalendars();
    }));

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

  private async _openTab(tab: 'today' | 'calendar' | 'tasks'): Promise<void> {
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
