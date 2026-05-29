// plannerSidebar.ts — Tasks list in the workbench sidebar.
//
// One view, several filter chips (Reviewing / Today / This week /
// Overdue / All). Click a row to inline-toggle done; double-click to
// open the Planner editor at that task. A "+ New" affordance creates a
// task with the standard "+5d / reviewing" defaults so the sidebar is
// itself a capture surface.

import { toDisposable, type IDisposable } from '../../platform/lifecycle.js';
import type { PlannerDataService } from './plannerDataService.js';
import type { PlannerTask, TaskQuery, TaskStatus } from './plannerTypes.js';

interface SidebarApi {
  editors: {
    openEditor(options: { typeId: string; title: string; icon?: string; iconHtml?: string; instanceId?: string }): Promise<void>;
  };
  commands: {
    executeCommand<T = unknown>(id: string, ...args: unknown[]): Promise<T>;
  };
  window: {
    showInputBox?(options?: { prompt?: string; value?: string; placeholder?: string }): Promise<string | undefined>;
    showErrorMessage(message: string, ...actions: { title: string }[]): Promise<{ title: string } | undefined>;
  };
}

type FilterKey = 'reviewing' | 'today' | 'week' | 'overdue' | 'all';

const FILTERS: { key: FilterKey; label: string; build: () => TaskQuery }[] = [
  { key: 'reviewing', label: 'Review',  build: () => ({ status: 'reviewing', includeUndated: true }) },
  { key: 'today',     label: 'Today',   build: () => ({ status: ['reviewing', 'planned'], dueFrom: startOfDay(), dueTo: endOfDay() }) },
  { key: 'week',      label: 'Week',    build: () => ({ status: ['reviewing', 'planned'], dueFrom: startOfDay(), dueTo: startOfDay() + 7 * 86_400_000 }) },
  { key: 'overdue',   label: 'Overdue', build: () => ({ status: ['reviewing', 'planned'], dueTo: Date.now() - 1 }) },
  { key: 'all',       label: 'All',     build: () => ({ status: ['reviewing', 'planned', 'done'], includeUndated: true, limit: 200 }) },
];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}
function startOfDay(date = new Date()): number {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function endOfDay(date = new Date()): number {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

function formatDue(t: PlannerTask): string {
  if (!t.dueAt) return '—';
  const now = Date.now();
  const diff = t.dueAt - now;
  if (diff < 0 && t.status !== 'done') return 'Overdue';
  const day = 86_400_000;
  if (Math.abs(diff) < day && new Date(t.dueAt).toDateString() === new Date().toDateString()) return 'Today';
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  if (new Date(t.dueAt).toDateString() === tomorrow.toDateString()) return 'Tomorrow';
  if (diff > 0 && diff < 7 * day) {
    return new Date(t.dueAt).toLocaleDateString(undefined, { weekday: 'short' });
  }
  return new Date(t.dueAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export class PlannerSidebar implements IDisposable {
  private _root: HTMLElement | null = null;
  private _list: HTMLElement | null = null;
  private _activeFilter: FilterKey = 'reviewing';
  private _disposed = false;
  private readonly _disposables: IDisposable[] = [];
  private _tasks: PlannerTask[] = [];

  constructor(
    private readonly _data: PlannerDataService,
    private readonly _api: SidebarApi,
  ) {}

  createView(container: HTMLElement): IDisposable {
    container.classList.add('planner-sidebar-host');
    const root = el('div', 'planner-sidebar');
    this._root = root;

    // Toolbar — "New task" + chips
    const toolbar = el('div', 'planner-sidebar__toolbar');

    const newBtn = el('button', 'planner-sidebar__newbtn');
    newBtn.type = 'button';
    newBtn.title = 'New task';
    newBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg><span>New task</span>';
    newBtn.addEventListener('click', () => void this._captureTask());
    toolbar.appendChild(newBtn);

    const openBtn = el('button', 'planner-sidebar__openbtn');
    openBtn.type = 'button';
    openBtn.title = 'Open Planner';
    openBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>';
    openBtn.addEventListener('click', () => void this._api.commands.executeCommand('planner.open'));
    toolbar.appendChild(openBtn);

    root.appendChild(toolbar);

    const chips = el('div', 'planner-sidebar__chips');
    for (const f of FILTERS) {
      const chip = el('button', 'planner-sidebar__chip');
      chip.type = 'button';
      chip.dataset.key = f.key;
      chip.textContent = f.label;
      chip.addEventListener('click', () => this._setFilter(f.key));
      chips.appendChild(chip);
    }
    root.appendChild(chips);

    const list = el('div', 'planner-sidebar__list');
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', 'Tasks');
    this._list = list;
    root.appendChild(list);

    container.appendChild(root);

    this._setFilter(this._activeFilter, /*skipRender=*/ false);

    this._disposables.push(this._data.onDidChange((e) => {
      if (this._disposed) return;
      if (e.kind === 'task-created' || e.kind === 'task-updated' || e.kind === 'task-removed') {
        void this._refresh();
      }
    }));

    return toDisposable(() => {
      this.dispose();
      container.classList.remove('planner-sidebar-host');
    });
  }

  // ── Filtering / rendering ─────────────────────────────────────────────

  private _setFilter(key: FilterKey, skipRender = false): void {
    this._activeFilter = key;
    const chipsEl = this._root?.querySelector('.planner-sidebar__chips');
    if (chipsEl) {
      for (const child of Array.from(chipsEl.children)) {
        if (!(child instanceof HTMLElement)) continue;
        child.classList.toggle('planner-sidebar__chip--active', child.dataset.key === key);
      }
    }
    if (!skipRender) void this._refresh();
  }

  private async _refresh(): Promise<void> {
    if (!this._list) return;
    const filter = FILTERS.find(f => f.key === this._activeFilter);
    if (!filter) return;
    this._tasks = await this._data.listTasks(filter.build());
    this._renderList();
  }

  private _renderList(): void {
    if (!this._list) return;
    this._list.innerHTML = '';

    if (this._tasks.length === 0) {
      const empty = el('div', 'planner-sidebar__empty');
      empty.innerHTML = `<strong>Nothing here yet</strong><p>Capture a task with the "+ New task" button above, or via chat (the AI can call <code>planner.captureTask</code>).</p>`;
      this._list.appendChild(empty);
      return;
    }

    for (const task of this._tasks) {
      const row = el('div', 'planner-sidebar__row');
      row.dataset.taskId = task.id;
      row.setAttribute('role', 'option');
      row.tabIndex = 0;
      if (task.status === 'reviewing') row.classList.add('planner-sidebar__row--reviewing');
      if (task.status === 'done') row.classList.add('planner-sidebar__row--done');
      if (task.dueAt && task.dueAt < Date.now() && task.status !== 'done') row.classList.add('planner-sidebar__row--overdue');

      const checkbox = el('button', 'planner-sidebar__check');
      checkbox.type = 'button';
      checkbox.title = task.status === 'done' ? 'Mark not done' : 'Mark done';
      checkbox.innerHTML = task.status === 'done'
        ? '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>'
        : '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/></svg>';
      checkbox.addEventListener('click', (e) => {
        e.stopPropagation();
        void this._toggleDone(task);
      });
      row.appendChild(checkbox);

      const text = el('div', 'planner-sidebar__text');
      const title = el('span', 'planner-sidebar__title');
      title.textContent = task.title;
      text.appendChild(title);
      const meta = el('span', 'planner-sidebar__meta');
      meta.textContent = formatDue(task);
      text.appendChild(meta);
      row.appendChild(text);

      row.addEventListener('dblclick', () => void this._api.commands.executeCommand('planner.open'));
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          void this._toggleDone(task);
        } else if (e.key === 'Delete') {
          e.preventDefault();
          void this._data.removeTask(task.id);
        }
      });

      this._list.appendChild(row);
    }
  }

  // ── Actions ───────────────────────────────────────────────────────────

  private async _captureTask(): Promise<void> {
    if (!this._api.window.showInputBox) return;
    const title = await this._api.window.showInputBox({
      prompt: 'New task',
      placeholder: 'What needs to happen?',
    });
    if (!title?.trim()) return;
    try {
      // Default-date capture: +5d, status='reviewing' — same flow the AI
      // uses, so a hand-captured task lands in the same Review queue.
      await this._data.createTask({
        title: title.trim(),
        dueAt: Date.now() + 5 * 86_400_000,
        status: 'reviewing',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this._api.window.showErrorMessage(`Could not create task: ${msg}`);
    }
  }

  private async _toggleDone(task: PlannerTask): Promise<void> {
    const nextStatus: TaskStatus = task.status === 'done' ? 'planned' : 'done';
    try {
      await this._data.updateTask(task.id, { status: nextStatus });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this._api.window.showErrorMessage(`Could not update task: ${msg}`);
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
    this._list = null;
  }
}
