// plannerSidebar.ts — workbench sidebar view for the planner.
//
// Planner's own list in the column: Today, Calendar, Tasks with its six
// lists under it (each with its count), a small month that opens the
// calendar on the day pressed, the Calendars toggles, and Settings. Same
// list-row idiom every other Parallx sidebar uses: plain monochrome icon +
// label, the shared hover and selection surfaces.

import './plannerColumn.css';
import { toDisposable, type IDisposable } from '../../platform/lifecycle.js';
import type { PlannerDataService } from './plannerDataService.js';
import { createIconElement } from '../../ui/iconRegistry.js';
import { createButton, createSectionLabel } from '../../ui/kit.js';
import { createSmallMonth } from '../../ui/dateTimeField.js';
import { PLANNER_TASK_FILTERS, PLANNER_TASK_LIST_QUERY } from './plannerTaskFilters.js';

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
  private _activeKey: string = 'today';
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

    /**
     * One row of the list: a kit button that runs a command. With an icon it
     * is one of the pages; without, a list under Tasks, indented to the name.
     */
    const addRow = (parent: HTMLElement, key: string, label: string, icon: string | undefined, command: string, args: readonly unknown[]): HTMLElement => {
      const row = createButton(parent, { id: `planner.side.${key}`, label, icon, kind: 'ghost', size: 'sm', command, args });
      row.classList.add('planner-sidebar__row');
      if (!icon) row.classList.add('planner-sidebar__row--sub');
      row.dataset.key = key;
      const count = el('span', 'planner-sidebar__row-count');
      count.dataset.role = 'count';
      count.hidden = true;
      row.appendChild(count);
      return row;
    };

    for (const [key, label] of [['today', 'Today'], ['calendar', 'Calendar'], ['tasks', 'Tasks']] as const) {
      addRow(list, key, label, ICONS[key], 'planner.show', [key]);
      if (key !== 'tasks') continue;
      // Tasks' six lists hang under it: the same lists, counted the same way, as on its page.
      const lists = el('div', 'planner-sidebar__sublist');
      lists.setAttribute('role', 'group');
      lists.setAttribute('aria-label', 'Task lists');
      for (const f of PLANNER_TASK_FILTERS) addRow(lists, `tasks.${f.key}`, f.label, undefined, 'planner.show', ['tasks', f.key]);
      list.appendChild(lists);
    }

    // A small month: the day pressed opens the calendar on it.
    const month = el('div', 'planner-sidebar__month');
    createSmallMonth(month, { ariaLabel: 'Go to a day', onPick: (date) => void this._api.commands.executeCommand('planner.show', 'calendar', null, date) });
    list.appendChild(month);

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

    // Planner's own panel in Settings.
    const foot = el('div', 'planner-sidebar__foot');
    addRow(foot, 'settings', 'Settings', ICONS.settings, 'settings.open', ['planner']);
    list.appendChild(foot);

    // The row lit is the page the pane was last asked for, whoever asked (a row here, a command, the palette).
    const onShown = (e: Event) => {
      const { tab, tasksFilter } = (e as CustomEvent<{ tab?: string; tasksFilter?: string }>).detail ?? {};
      if (tab) this._setActive(tab === 'tasks' && tasksFilter ? `tasks.${tasksFilter}` : tab);
    };
    document.addEventListener('parallx.planner.focusTab', onShown);
    this._disposables.push(toDisposable(() => document.removeEventListener('parallx.planner.focusTab', onShown)));

    container.appendChild(root);
    this._syncActive();

    // Live counts: on each list under Tasks, and on Tasks itself what waits in the Review Queue.
    const updateCounts = async () => {
      if (this._disposed || !this._root) return;
      let all: Awaited<ReturnType<PlannerDataService['listTasks']>> = [];
      try { all = await this._data.listTasks(PLANNER_TASK_LIST_QUERY); } catch { return; /* keep the last counts */ }
      if (this._disposed || !this._root) return;
      const show = (key: string, n: number, always: boolean) => {
        const badge = this._root?.querySelector<HTMLElement>(`[data-key="${key}"] [data-role="count"]`);
        if (!badge) return;
        badge.textContent = String(n);
        badge.hidden = !always && n === 0;
      };
      for (const f of PLANNER_TASK_FILTERS) show(`tasks.${f.key}`, all.filter((t) => f.match(t)).length, true);
      show('tasks', all.filter((t) => t.status === 'reviewing').length, false);
    };
    void updateCounts();
    this._disposables.push(this._data.onDidChange((e) => {
      if (e.kind === 'task-created' || e.kind === 'task-updated' || e.kind === 'task-removed') void updateCounts();
    }));

    return toDisposable(() => {
      this.dispose();
      container.classList.remove('planner-sidebar-host');
    });
  }

  private _setActive(key: string): void {
    this._activeKey = key;
    this._syncActive();
  }

  private _syncActive(): void {
    for (const row of Array.from(this._root?.querySelectorAll<HTMLElement>('.planner-sidebar__row[data-key]') ?? [])) {
      row.classList.toggle('planner-sidebar__row--active', row.dataset.key === this._activeKey);
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
