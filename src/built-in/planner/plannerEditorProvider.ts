// plannerEditorProvider.ts — Planner editor pane.
//
// Two tabs: Tasks (review queue + grouped list) and Calendar (month /
// week / day view). Pure DOM + CSS Grid; no layout engine.

import type { IDisposable } from '../../platform/lifecycle.js';
import type { PlannerDataService } from './plannerDataService.js';
import type { PlannerEvent, PlannerTask, TaskStatus } from './plannerTypes.js';

interface PlannerEditorInput {
  readonly id: string;          // === instanceId; only one ('main') for M82
  setName?(name: string): void;
  setIconHtml?(html: string | undefined): void;
}

interface PlannerEditorApi {
  editors: {
    openEditor(options: { typeId: string; title: string; icon?: string; iconHtml?: string; instanceId?: string }): Promise<void>;
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

type Tab = 'tasks' | 'calendar';
type CalendarView = 'month' | 'week' | 'day';

const PLANNER_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><path d="m9 16 2 2 4-4"/></svg>';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function startOfDay(date: Date): Date { const d = new Date(date); d.setHours(0, 0, 0, 0); return d; }
function endOfDay(date: Date): Date { const d = new Date(date); d.setHours(23, 59, 59, 999); return d; }
function startOfWeek(date: Date): Date {
  // Week starts on Sunday for compatibility with most calendars; could be configurable later.
  const d = startOfDay(date);
  d.setDate(d.getDate() - d.getDay());
  return d;
}
function startOfMonth(date: Date): Date {
  const d = startOfDay(date);
  d.setDate(1);
  return d;
}
function endOfMonth(date: Date): Date {
  const d = startOfMonth(date);
  d.setMonth(d.getMonth() + 1);
  d.setMilliseconds(-1);
  return d;
}
function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

// ─── Provider ────────────────────────────────────────────────────────────────

export class PlannerEditorProvider {
  constructor(
    private readonly _data: PlannerDataService,
    private readonly _api: PlannerEditorApi,
  ) {}

  createEditorPane(container: HTMLElement, input?: PlannerEditorInput): IDisposable {
    const pane = new PlannerEditorPane(container, input, this._data, this._api);
    pane.init().catch(err => console.error('[PlannerEditorProvider] pane init failed:', err));
    return pane;
  }
}

// ─── Pane ────────────────────────────────────────────────────────────────────

class PlannerEditorPane implements IDisposable {
  private _root: HTMLElement | null = null;
  private _bodyEl: HTMLElement | null = null;
  private _activeTab: Tab = 'tasks';
  private _calendarView: CalendarView = 'month';
  private _cursorDate: Date = startOfDay(new Date());
  private _disposed = false;
  private readonly _disposables: IDisposable[] = [];

  constructor(
    private readonly _container: HTMLElement,
    private readonly _input: PlannerEditorInput | undefined,
    private readonly _data: PlannerDataService,
    private readonly _api: PlannerEditorApi,
  ) {}

  async init(): Promise<void> {
    if (this._disposed) return;
    this._input?.setName?.('Planner');
    this._input?.setIconHtml?.(PLANNER_ICON_SVG);
    this._buildShell();
    await this._renderTab();

    this._disposables.push(this._data.onDidChange(() => {
      if (this._disposed) return;
      void this._renderTab();
    }));
  }

  // ── Shell ────────────────────────────────────────────────────────────

  private _buildShell(): void {
    this._container.innerHTML = '';
    this._container.classList.add('planner-pane-host');

    const root = el('div', 'planner-pane');
    this._root = root;

    // Header — tab toggles + contextual actions
    const header = el('header', 'planner-pane__header');

    const tabs = el('div', 'planner-pane__tabs');
    const tabsConfig: { key: Tab; label: string; icon: string }[] = [
      { key: 'tasks',    label: 'Tasks',    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/></svg>' },
      { key: 'calendar', label: 'Calendar', icon: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>' },
    ];
    for (const t of tabsConfig) {
      const tab = el('button', 'planner-pane__tab');
      tab.type = 'button';
      tab.dataset.tab = t.key;
      tab.innerHTML = `${t.icon}<span>${t.label}</span>`;
      tab.addEventListener('click', () => this._setTab(t.key));
      tabs.appendChild(tab);
    }
    header.appendChild(tabs);

    const actions = el('div', 'planner-pane__actions');
    actions.dataset.role = 'tab-actions';
    header.appendChild(actions);

    root.appendChild(header);

    const body = el('div', 'planner-pane__body');
    body.dataset.role = 'body';
    this._bodyEl = body;
    root.appendChild(body);

    this._container.appendChild(root);
    this._syncTabClass();
  }

  private _setTab(tab: Tab): void {
    this._activeTab = tab;
    this._syncTabClass();
    void this._renderTab();
  }

  private _syncTabClass(): void {
    const tabsEl = this._root?.querySelectorAll('.planner-pane__tab');
    if (!tabsEl) return;
    for (const t of Array.from(tabsEl)) {
      if (!(t instanceof HTMLElement)) continue;
      t.classList.toggle('planner-pane__tab--active', t.dataset.tab === this._activeTab);
    }
  }

  private async _renderTab(): Promise<void> {
    const body = this._bodyEl;
    const actions = this._root?.querySelector('[data-role="tab-actions"]') as HTMLElement | null;
    if (!body || !actions) return;
    body.innerHTML = '';
    actions.innerHTML = '';

    if (this._activeTab === 'tasks') {
      await this._renderTasksTab(body, actions);
    } else {
      await this._renderCalendarTab(body, actions);
    }
  }

  // ── Tasks tab ────────────────────────────────────────────────────────

  private async _renderTasksTab(body: HTMLElement, actions: HTMLElement): Promise<void> {
    const addBtn = el('button', 'planner-btn planner-btn--primary');
    addBtn.type = 'button';
    addBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg><span>New task</span>';
    addBtn.addEventListener('click', () => void this._captureNewTask());
    actions.appendChild(addBtn);

    const tasks = await this._data.listTasks({
      status: ['reviewing', 'planned', 'done'],
      includeUndated: true,
      limit: 500,
    });
    const reviewing = tasks.filter(t => t.status === 'reviewing');
    const overdue   = tasks.filter(t => t.status === 'planned' && t.dueAt && t.dueAt < Date.now());
    const today     = tasks.filter(t => t.status === 'planned' && t.dueAt && sameDay(new Date(t.dueAt), new Date()));
    const upcoming  = tasks.filter(t => t.status === 'planned' && t.dueAt && t.dueAt > endOfDay(new Date()).getTime());
    const noDate    = tasks.filter(t => t.status === 'planned' && !t.dueAt);
    const completed = tasks.filter(t => t.status === 'done').slice(0, 12);

    if (tasks.length === 0) {
      const empty = el('div', 'planner-empty');
      empty.innerHTML = `
        <h2>Nothing planned</h2>
        <p>Capture a task with "New task", or ask the AI in chat. New tasks land in the review queue with a default due date — no need to break flow to plan immediately.</p>
      `;
      body.appendChild(empty);
      return;
    }

    if (reviewing.length > 0) {
      body.appendChild(this._renderTaskSection('Review queue', reviewing, {
        accent: 'review',
        hint: 'Captured fast — pick a real due date or mark cancelled.',
      }));
    }
    if (overdue.length > 0)  body.appendChild(this._renderTaskSection('Overdue', overdue, { accent: 'overdue' }));
    if (today.length > 0)    body.appendChild(this._renderTaskSection('Today', today, { accent: 'today' }));
    if (upcoming.length > 0) body.appendChild(this._renderTaskSection('Upcoming', upcoming));
    if (noDate.length > 0)   body.appendChild(this._renderTaskSection('No date', noDate));
    if (completed.length > 0) body.appendChild(this._renderTaskSection('Recently completed', completed, { collapsed: true }));
  }

  private _renderTaskSection(title: string, tasks: readonly PlannerTask[], opts: { accent?: string; hint?: string; collapsed?: boolean } = {}): HTMLElement {
    const section = el('section', 'planner-section');
    if (opts.accent) section.classList.add(`planner-section--${opts.accent}`);
    if (opts.collapsed) section.classList.add('planner-section--collapsed');

    const head = el('header', 'planner-section__head');
    const titleEl = el('h2', 'planner-section__title');
    titleEl.textContent = title;
    head.appendChild(titleEl);
    const count = el('span', 'planner-section__count');
    count.textContent = String(tasks.length);
    head.appendChild(count);
    if (opts.hint) {
      const hint = el('p', 'planner-section__hint');
      hint.textContent = opts.hint;
      head.appendChild(hint);
    }
    section.appendChild(head);

    const list = el('div', 'planner-section__list');
    for (const t of tasks) list.appendChild(this._renderTaskRow(t));
    section.appendChild(list);
    return section;
  }

  private _renderTaskRow(task: PlannerTask): HTMLElement {
    const row = el('div', 'planner-task');
    row.dataset.taskId = task.id;
    if (task.status === 'done') row.classList.add('planner-task--done');

    const checkbox = el('button', 'planner-task__check');
    checkbox.type = 'button';
    checkbox.title = task.status === 'done' ? 'Mark not done' : 'Mark done';
    checkbox.innerHTML = task.status === 'done'
      ? '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>'
      : '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/></svg>';
    checkbox.addEventListener('click', () => {
      const next: TaskStatus = task.status === 'done' ? 'planned' : 'done';
      void this._data.updateTask(task.id, { status: next });
    });
    row.appendChild(checkbox);

    const main = el('div', 'planner-task__main');
    const titleEl = el('span', 'planner-task__title');
    titleEl.textContent = task.title;
    titleEl.title = 'Click to rename';
    titleEl.addEventListener('click', () => void this._promptRenameTask(task));
    main.appendChild(titleEl);
    if (task.description) {
      const desc = el('span', 'planner-task__desc');
      desc.textContent = task.description;
      main.appendChild(desc);
    }
    row.appendChild(main);

    const right = el('div', 'planner-task__right');

    if (task.dueAt) {
      const due = el('button', 'planner-task__due');
      due.type = 'button';
      due.title = 'Click to reschedule';
      const overdue = task.dueAt < Date.now() && task.status !== 'done';
      if (overdue) due.classList.add('planner-task__due--overdue');
      due.textContent = formatDateShort(task.dueAt);
      due.addEventListener('click', () => void this._promptReschedule(task));
      right.appendChild(due);
    } else {
      const setDue = el('button', 'planner-task__due planner-task__due--empty');
      setDue.type = 'button';
      setDue.title = 'Click to set a due date';
      setDue.textContent = 'Set date';
      setDue.addEventListener('click', () => void this._promptReschedule(task));
      right.appendChild(setDue);
    }

    if (task.status === 'reviewing') {
      const planBtn = el('button', 'planner-task__plan');
      planBtn.type = 'button';
      planBtn.title = 'Confirm date — promote to planned';
      planBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12l5 5L20 7"/></svg>';
      planBtn.addEventListener('click', () => void this._data.updateTask(task.id, { status: 'planned' }));
      right.appendChild(planBtn);
    }

    const more = el('button', 'planner-task__more');
    more.type = 'button';
    more.title = 'More';
    more.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>';
    more.addEventListener('click', () => void this._openTaskMenu(task, more.getBoundingClientRect()));
    right.appendChild(more);

    row.appendChild(right);
    return row;
  }

  private async _promptRenameTask(task: PlannerTask): Promise<void> {
    if (!this._api.window.showInputBox) return;
    const next = await this._api.window.showInputBox({
      prompt: 'Rename task',
      value: task.title,
    });
    if (next && next.trim() && next !== task.title) {
      await this._data.updateTask(task.id, { title: next.trim() });
    }
  }

  private async _promptReschedule(task: PlannerTask): Promise<void> {
    if (!this._api.window.showInputBox) return;
    const cur = task.dueAt ? new Date(task.dueAt).toISOString().slice(0, 10) : '';
    const next = await this._api.window.showInputBox({
      prompt: 'New due date',
      value: cur,
      placeholder: 'YYYY-MM-DD or "+5d"',
    });
    if (!next) return;
    const ms = parseRelativeOrIso(next);
    if (ms === null) {
      await this._api.window.showErrorMessage('Could not parse that date. Use YYYY-MM-DD or "+5d".');
      return;
    }
    await this._data.updateTask(task.id, {
      dueAt: ms,
      // Promote a "reviewing" task to "planned" if the user explicitly picks a date.
      status: task.status === 'reviewing' ? 'planned' : undefined,
    });
  }

  private _openTaskMenu(task: PlannerTask, anchor: DOMRect): void {
    const overlay = el('div', 'planner-menu-overlay');
    overlay.addEventListener('click', () => overlay.remove());

    const menu = el('div', 'planner-menu');
    menu.style.position = 'fixed';

    const items: { label: string; action: () => void; danger?: boolean }[] = [
      { label: 'Rename',         action: () => void this._promptRenameTask(task) },
      { label: 'Set due date',   action: () => void this._promptReschedule(task) },
      { label: task.status === 'reviewing' ? 'Confirm — planned' : 'Move to review', action: () => void this._data.updateTask(task.id, { status: task.status === 'reviewing' ? 'planned' : 'reviewing' }) },
      { label: 'Cancel task',    action: () => void this._data.updateTask(task.id, { status: 'cancelled' }), danger: true },
      { label: 'Delete forever', action: () => void this._data.removeTask(task.id), danger: true },
    ];
    for (const it of items) {
      const btn = el('button', 'planner-menu__item');
      btn.type = 'button';
      if (it.danger) btn.classList.add('planner-menu__item--danger');
      btn.textContent = it.label;
      btn.addEventListener('click', () => { overlay.remove(); it.action(); });
      menu.appendChild(btn);
    }
    overlay.appendChild(menu);
    document.body.appendChild(overlay);

    const m = menu.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    let left = anchor.left;
    let top = anchor.bottom + 4;
    if (left + m.width > vw - 8) left = Math.max(8, vw - m.width - 8);
    if (top + m.height > vh - 8) top = Math.max(8, anchor.top - m.height - 4);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onKey); }
    };
    document.addEventListener('keydown', onKey);
  }

  private async _captureNewTask(): Promise<void> {
    if (!this._api.window.showInputBox) return;
    const title = await this._api.window.showInputBox({
      prompt: 'New task',
      placeholder: 'What needs to happen?',
    });
    if (!title?.trim()) return;
    try {
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

  // ── Calendar tab ─────────────────────────────────────────────────────

  private async _renderCalendarTab(body: HTMLElement, actions: HTMLElement): Promise<void> {
    // View toggle
    const viewBar = el('div', 'planner-calendar__viewbar');
    for (const v of ['month', 'week', 'day'] as CalendarView[]) {
      const btn = el('button', 'planner-btn planner-btn--ghost planner-btn--small');
      btn.type = 'button';
      btn.textContent = v[0].toUpperCase() + v.slice(1);
      if (v === this._calendarView) btn.classList.add('planner-btn--active');
      btn.addEventListener('click', () => { this._calendarView = v; void this._renderTab(); });
      viewBar.appendChild(btn);
    }
    actions.appendChild(viewBar);

    // Date nav
    const nav = el('div', 'planner-calendar__nav');
    const prev = el('button', 'planner-btn planner-btn--ghost planner-btn--small planner-btn--icon-only');
    prev.type = 'button';
    prev.title = 'Previous';
    prev.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>';
    prev.addEventListener('click', () => { this._navigateCalendar(-1); void this._renderTab(); });
    nav.appendChild(prev);
    const today = el('button', 'planner-btn planner-btn--ghost planner-btn--small');
    today.type = 'button';
    today.textContent = 'Today';
    today.addEventListener('click', () => { this._cursorDate = startOfDay(new Date()); void this._renderTab(); });
    nav.appendChild(today);
    const next = el('button', 'planner-btn planner-btn--ghost planner-btn--small planner-btn--icon-only');
    next.type = 'button';
    next.title = 'Next';
    next.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>';
    next.addEventListener('click', () => { this._navigateCalendar(1); void this._renderTab(); });
    nav.appendChild(next);
    actions.appendChild(nav);

    const addEvt = el('button', 'planner-btn planner-btn--primary planner-btn--small');
    addEvt.type = 'button';
    addEvt.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg><span>New event</span>';
    addEvt.addEventListener('click', () => void this._captureNewEvent());
    actions.appendChild(addEvt);

    // Header — date range label
    const header = el('div', 'planner-calendar__header');
    header.textContent = this._calendarRangeLabel();
    body.appendChild(header);

    if (this._calendarView === 'month') await this._renderMonthView(body);
    else if (this._calendarView === 'week') await this._renderWeekView(body);
    else await this._renderDayView(body);
  }

  private _navigateCalendar(direction: -1 | 1): void {
    const d = new Date(this._cursorDate);
    if (this._calendarView === 'month') {
      d.setMonth(d.getMonth() + direction);
    } else if (this._calendarView === 'week') {
      d.setDate(d.getDate() + direction * 7);
    } else {
      d.setDate(d.getDate() + direction);
    }
    this._cursorDate = startOfDay(d);
  }

  private _calendarRangeLabel(): string {
    if (this._calendarView === 'month') {
      return this._cursorDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    }
    if (this._calendarView === 'week') {
      const start = startOfWeek(this._cursorDate);
      const end = addDays(start, 6);
      const same = start.getMonth() === end.getMonth();
      return same
        ? `${start.toLocaleDateString(undefined, { month: 'long' })} ${start.getDate()}–${end.getDate()}, ${start.getFullYear()}`
        : `${start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${end.getFullYear()}`;
    }
    return this._cursorDate.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  }

  private async _renderMonthView(body: HTMLElement): Promise<void> {
    const from = startOfMonth(this._cursorDate).getTime();
    const to = endOfMonth(this._cursorDate).getTime();
    const events = await this._data.listEvents({ from, to, limit: 500 });

    const grid = el('div', 'planner-month');
    // Weekday header
    const weekdayRow = el('div', 'planner-month__weekdays');
    const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    for (const wd of weekdays) {
      const wdEl = el('div', 'planner-month__weekday');
      wdEl.textContent = wd;
      weekdayRow.appendChild(wdEl);
    }
    grid.appendChild(weekdayRow);

    const cells = el('div', 'planner-month__cells');
    const firstOfMonth = startOfMonth(this._cursorDate);
    const gridStart = startOfWeek(firstOfMonth);
    const lastOfMonth = endOfMonth(this._cursorDate);
    const gridEnd = addDays(startOfWeek(lastOfMonth), 6);
    const totalDays = Math.round((gridEnd.getTime() - gridStart.getTime()) / 86_400_000) + 1;

    for (let i = 0; i < totalDays; i++) {
      const day = addDays(gridStart, i);
      const dayStart = startOfDay(day).getTime();
      const dayEnd = endOfDay(day).getTime();
      const dayEvents = events.filter(ev => ev.startAt <= dayEnd && ev.endAt >= dayStart);

      const cell = el('div', 'planner-month__cell');
      if (day.getMonth() !== this._cursorDate.getMonth()) cell.classList.add('planner-month__cell--other-month');
      if (sameDay(day, new Date())) cell.classList.add('planner-month__cell--today');

      const number = el('span', 'planner-month__cellnum');
      number.textContent = String(day.getDate());
      cell.appendChild(number);

      const evWrap = el('div', 'planner-month__cellevents');
      const MAX_SHOWN = 3;
      for (const ev of dayEvents.slice(0, MAX_SHOWN)) {
        const chip = el('button', 'planner-month__chip');
        chip.type = 'button';
        chip.textContent = ev.title;
        chip.title = `${ev.title}\n${formatTimeRange(ev)}`;
        chip.addEventListener('click', (e) => { e.stopPropagation(); void this._openEvent(ev); });
        evWrap.appendChild(chip);
      }
      if (dayEvents.length > MAX_SHOWN) {
        const more = el('span', 'planner-month__more');
        more.textContent = `+${dayEvents.length - MAX_SHOWN} more`;
        evWrap.appendChild(more);
      }
      cell.appendChild(evWrap);

      cell.addEventListener('click', () => {
        this._cursorDate = startOfDay(day);
        this._calendarView = 'day';
        void this._renderTab();
      });
      cells.appendChild(cell);
    }
    grid.appendChild(cells);
    body.appendChild(grid);
  }

  private async _renderWeekView(body: HTMLElement): Promise<void> {
    const start = startOfWeek(this._cursorDate);
    const end = addDays(start, 7);
    const events = await this._data.listEvents({ from: start.getTime(), to: end.getTime(), limit: 500 });

    const grid = el('div', 'planner-week');
    const headerRow = el('div', 'planner-week__header');
    headerRow.appendChild(el('div', 'planner-week__corner'));
    for (let i = 0; i < 7; i++) {
      const day = addDays(start, i);
      const wd = el('div', 'planner-week__weekday');
      const wdLabel = el('span', 'planner-week__weekday-label');
      wdLabel.textContent = day.toLocaleDateString(undefined, { weekday: 'short' });
      const wdNum = el('span', 'planner-week__weekday-num');
      wdNum.textContent = String(day.getDate());
      if (sameDay(day, new Date())) wd.classList.add('planner-week__weekday--today');
      wd.appendChild(wdLabel);
      wd.appendChild(wdNum);
      headerRow.appendChild(wd);
    }
    grid.appendChild(headerRow);

    const body2 = el('div', 'planner-week__body');
    const HOURS_START = 0, HOURS_END = 24;
    const hourScale = el('div', 'planner-week__hours');
    for (let h = HOURS_START; h < HOURS_END; h++) {
      const cell = el('div', 'planner-week__hour');
      const label = el('span', 'planner-week__hourlabel');
      label.textContent = formatHour(h);
      cell.appendChild(label);
      hourScale.appendChild(cell);
    }
    body2.appendChild(hourScale);

    for (let i = 0; i < 7; i++) {
      const dayCol = el('div', 'planner-week__col');
      const day = addDays(start, i);
      const dayStart = day.getTime();
      const dayEnd = endOfDay(day).getTime();

      // Hour gridlines
      for (let h = HOURS_START; h < HOURS_END; h++) {
        dayCol.appendChild(el('div', 'planner-week__cell'));
      }

      // Events as absolutely-positioned bars
      const dayEvents = events.filter(ev => ev.startAt <= dayEnd && ev.endAt >= dayStart);
      for (const ev of dayEvents) {
        const evStart = Math.max(ev.startAt, dayStart);
        const evEnd = Math.min(ev.endAt, dayEnd);
        const topPct = ((evStart - dayStart) / (24 * 3_600_000)) * 100;
        const heightPct = Math.max(2, ((evEnd - evStart) / (24 * 3_600_000)) * 100);
        const bar = el('button', 'planner-week__event');
        bar.type = 'button';
        bar.style.top = `${topPct}%`;
        bar.style.height = `${heightPct}%`;
        bar.title = `${ev.title}\n${formatTimeRange(ev)}`;
        bar.innerHTML = `<strong>${escapeHtml(ev.title)}</strong><span>${escapeHtml(formatTimeRange(ev))}</span>`;
        bar.addEventListener('click', () => void this._openEvent(ev));
        dayCol.appendChild(bar);
      }

      body2.appendChild(dayCol);
    }
    grid.appendChild(body2);
    body.appendChild(grid);
  }

  private async _renderDayView(body: HTMLElement): Promise<void> {
    const dayStart = startOfDay(this._cursorDate).getTime();
    const dayEnd = endOfDay(this._cursorDate).getTime();
    const events = await this._data.listEvents({ from: dayStart, to: dayEnd, limit: 500 });

    const grid = el('div', 'planner-day');
    const hours = el('div', 'planner-day__hours');
    const col = el('div', 'planner-day__col');
    const HOURS_START = 0, HOURS_END = 24;
    for (let h = HOURS_START; h < HOURS_END; h++) {
      const hourCell = el('div', 'planner-day__hour');
      const label = el('span', 'planner-day__hourlabel');
      label.textContent = formatHour(h);
      hourCell.appendChild(label);
      hours.appendChild(hourCell);
      col.appendChild(el('div', 'planner-day__cell'));
    }
    grid.appendChild(hours);
    grid.appendChild(col);

    for (const ev of events) {
      const evStart = Math.max(ev.startAt, dayStart);
      const evEnd = Math.min(ev.endAt, dayEnd);
      const topPct = ((evStart - dayStart) / (24 * 3_600_000)) * 100;
      const heightPct = Math.max(3, ((evEnd - evStart) / (24 * 3_600_000)) * 100);
      const bar = el('button', 'planner-day__event');
      bar.type = 'button';
      bar.style.top = `${topPct}%`;
      bar.style.height = `${heightPct}%`;
      bar.title = `${ev.title}\n${formatTimeRange(ev)}`;
      bar.innerHTML = `
        <span class="planner-day__event-time">${escapeHtml(formatTimeRange(ev))}</span>
        <strong class="planner-day__event-title">${escapeHtml(ev.title)}</strong>
        ${ev.location ? `<span class="planner-day__event-loc">${escapeHtml(ev.location)}</span>` : ''}
      `;
      bar.addEventListener('click', () => void this._openEvent(ev));
      col.appendChild(bar);
    }

    body.appendChild(grid);
  }

  private async _captureNewEvent(): Promise<void> {
    if (!this._api.window.showInputBox) return;
    const title = await this._api.window.showInputBox({
      prompt: 'New event',
      placeholder: 'Title',
    });
    if (!title?.trim()) return;
    const dayStart = new Date(this._cursorDate);
    dayStart.setHours(9, 0, 0, 0);
    try {
      await this._data.createEvent({
        title: title.trim(),
        startAt: dayStart.getTime(),
        endAt: dayStart.getTime() + 60 * 60 * 1000,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this._api.window.showErrorMessage(`Could not create event: ${msg}`);
    }
  }

  private async _openEvent(ev: PlannerEvent): Promise<void> {
    // Simple detail popup. Edit path: rename via input; reschedule via input box.
    if (!this._api.window.showInputBox) return;
    const result = await this._api.window.showInformationMessage(
      `${ev.title}\n${formatTimeRange(ev)}${ev.location ? `\n${ev.location}` : ''}${ev.description ? `\n\n${ev.description}` : ''}`,
      { title: 'Rename' }, { title: 'Delete' }, { title: 'Close' },
    );
    if (result?.title === 'Rename') {
      const next = await this._api.window.showInputBox({ prompt: 'Rename event', value: ev.title });
      if (next?.trim()) await this._data.updateEvent(ev.id, { title: next.trim() });
    } else if (result?.title === 'Delete') {
      await this._data.removeEvent(ev.id);
    }
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
    this._bodyEl = null;
    this._container.classList.remove('planner-pane-host');
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function formatDateShort(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  if (sameDay(d, now)) return 'Today';
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  if (sameDay(d, tomorrow)) return 'Tomorrow';
  const diff = ts - now.getTime();
  if (diff > 0 && diff < 7 * 86_400_000) return d.toLocaleDateString(undefined, { weekday: 'short' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatHour(h: number): string {
  if (h === 0) return '12 AM';
  if (h === 12) return '12 PM';
  if (h < 12) return `${h} AM`;
  return `${h - 12} PM`;
}

function formatTimeRange(ev: PlannerEvent): string {
  const fmt = (ts: number) => new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (ev.allDay) return 'All day';
  return `${fmt(ev.startAt)} – ${fmt(ev.endAt)}`;
}

function parseRelativeOrIso(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const rel = trimmed.match(/^\+(\d+)\s*([dhm])$/i);
  if (rel) {
    const n = parseInt(rel[1], 10);
    const unit = rel[2].toLowerCase();
    const ms = unit === 'd' ? n * 86_400_000 : unit === 'h' ? n * 3_600_000 : n * 60_000;
    return Date.now() + ms;
  }
  const ts = Date.parse(trimmed);
  return Number.isFinite(ts) ? ts : null;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}
