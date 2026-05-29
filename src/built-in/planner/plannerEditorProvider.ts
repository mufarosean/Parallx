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
  /** Persists the currently-selected filter inside the Tasks tab. */
  private _tasksFilter: string = 'all';
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

    // The sidebar dispatches a "focus tab" event when the user clicks
    // Calendar / Tasks. The active pane responds by switching to that
    // tab; non-active panes ignore it (root won't be connected).
    const onFocusTab = (e: Event) => {
      if (!this._root?.isConnected) return;
      const tab = (e as CustomEvent<{ tab?: Tab }>).detail?.tab;
      if (tab === 'tasks' || tab === 'calendar') this._setTab(tab);
    };
    document.addEventListener('parallx.planner.focusTab', onFocusTab);

    // planner.newTask command dispatches this; the active pane opens
    // the dedicated task popover.
    const onNewTask = () => {
      if (!this._root?.isConnected) return;
      this._setTab('tasks');
      // Anchor in the top-left of the body, popover positioning will keep
      // it on-screen.
      const anchor = this._bodyEl?.getBoundingClientRect() ?? new DOMRect(120, 120, 0, 0);
      this._openTaskPopover({ mode: 'create' }, anchor);
    };
    document.addEventListener('parallx.planner.newTask', onNewTask);

    this._disposables.push({
      dispose() {
        document.removeEventListener('parallx.planner.focusTab', onFocusTab);
        document.removeEventListener('parallx.planner.newTask', onNewTask);
      },
    });
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
    const addBtn = el('button', 'planner-cta');
    addBtn.type = 'button';
    addBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg><span>Create</span>';
    addBtn.addEventListener('click', () => this._captureNewTask(addBtn.getBoundingClientRect()));
    actions.appendChild(addBtn);

    const all = await this._data.listTasks({
      status: ['reviewing', 'planned', 'done'],
      includeUndated: true,
      limit: 500,
    });

    if (all.length === 0) {
      const empty = el('div', 'planner-empty');
      empty.innerHTML = `
        <h2>Nothing planned</h2>
        <p>Capture a task with "Create", or ask the AI in chat. New tasks land in the review queue with a default due date — no need to break flow to plan immediately.</p>
      `;
      body.appendChild(empty);
      return;
    }

    // Two-column layout: left filter nav, right filtered content.
    const layout = el('div', 'planner-tasks');
    body.appendChild(layout);

    const nav = el('nav', 'planner-tasks__nav');
    nav.setAttribute('aria-label', 'Filter tasks');
    const content = el('div', 'planner-tasks__content');
    layout.appendChild(nav);
    layout.appendChild(content);

    type Filter = { key: string; label: string; pinned?: boolean; match: (t: typeof all[number]) => boolean };
    const filters: Filter[] = [
      { key: 'review',  label: 'Review queue', pinned: true, match: t => t.status === 'reviewing' },
      { key: 'today',   label: 'Today',     match: t => (t.status === 'planned' || t.status === 'reviewing') && t.dueAt != null && sameDay(new Date(t.dueAt), new Date()) },
      { key: 'week',    label: 'This week', match: t => (t.status === 'planned' || t.status === 'reviewing') && t.dueAt != null && t.dueAt >= startOfDayMs() && t.dueAt <= startOfDayMs() + 7 * 86_400_000 },
      { key: 'overdue', label: 'Overdue',   match: t => (t.status === 'planned' || t.status === 'reviewing') && t.dueAt != null && t.dueAt < Date.now() },
      { key: 'all',     label: 'All tasks', match: t => t.status !== 'cancelled' },
    ];

    let activeKey = this._tasksFilter;

    const renderContent = () => {
      content.innerHTML = '';
      const filter = filters.find(f => f.key === activeKey) ?? filters[filters.length - 1];
      const matching = all.filter(filter.match);

      if (activeKey === 'all') {
        // "All tasks" uses the grouped section view so the user has the
        // full overview when no specific filter is active.
        const reviewing = matching.filter(t => t.status === 'reviewing');
        const overdue   = matching.filter(t => t.status === 'planned' && t.dueAt != null && t.dueAt < Date.now());
        const today     = matching.filter(t => t.status === 'planned' && t.dueAt != null && sameDay(new Date(t.dueAt), new Date()));
        const upcoming  = matching.filter(t => t.status === 'planned' && t.dueAt != null && t.dueAt > endOfDay(new Date()).getTime());
        const noDate    = matching.filter(t => t.status === 'planned' && !t.dueAt);
        const completed = matching.filter(t => t.status === 'done').slice(0, 12);
        if (reviewing.length > 0) content.appendChild(this._renderTaskSection('Review queue', reviewing, { accent: 'review', hint: 'Captured fast — pick a real due date or mark cancelled.' }));
        if (overdue.length > 0)   content.appendChild(this._renderTaskSection('Overdue', overdue, { accent: 'overdue' }));
        if (today.length > 0)     content.appendChild(this._renderTaskSection('Today', today, { accent: 'today' }));
        if (upcoming.length > 0)  content.appendChild(this._renderTaskSection('Upcoming', upcoming));
        if (noDate.length > 0)    content.appendChild(this._renderTaskSection('No date', noDate));
        if (completed.length > 0) content.appendChild(this._renderTaskSection('Recently completed', completed, { collapsed: true }));
      } else {
        // Single-filter view: one flat section with the matching rows.
        if (matching.length === 0) {
          const empty = el('div', 'planner-empty');
          empty.innerHTML = `<h2>Nothing here</h2><p>No tasks match this filter right now.</p>`;
          content.appendChild(empty);
          return;
        }
        const accent = activeKey === 'review' ? 'review' : activeKey === 'overdue' ? 'overdue' : activeKey === 'today' ? 'today' : undefined;
        content.appendChild(this._renderTaskSection(filter.label, matching, { accent }));
      }
    };

    // Build the nav.
    let lastPinned: boolean | undefined;
    for (const f of filters) {
      if (lastPinned !== undefined && !!f.pinned !== !!lastPinned) {
        nav.appendChild(el('div', 'planner-tasks__navsep'));
      }
      lastPinned = !!f.pinned;
      const item = el('button', 'planner-tasks__navitem');
      item.type = 'button';
      item.dataset.key = f.key;
      const label = el('span', 'planner-tasks__navlabel');
      label.textContent = f.label;
      const count = el('span', 'planner-tasks__navcount');
      count.textContent = String(all.filter(f.match).length);
      item.appendChild(label);
      item.appendChild(count);
      item.addEventListener('click', () => {
        activeKey = f.key;
        this._tasksFilter = activeKey;
        for (const sibling of Array.from(nav.children)) {
          if (sibling instanceof HTMLElement && sibling.classList.contains('planner-tasks__navitem')) {
            sibling.classList.toggle('planner-tasks__navitem--active', sibling.dataset.key === activeKey);
          }
        }
        renderContent();
      });
      if (f.key === activeKey) item.classList.add('planner-tasks__navitem--active');
      nav.appendChild(item);
    }

    renderContent();
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
    titleEl.title = 'Click to edit';
    titleEl.addEventListener('click', () => this._openTaskPopover({ mode: 'edit', task }, titleEl.getBoundingClientRect()));
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
      due.title = 'Click to edit task';
      const overdue = task.dueAt < Date.now() && task.status !== 'done';
      if (overdue) due.classList.add('planner-task__due--overdue');
      due.textContent = formatDateShort(task.dueAt);
      due.addEventListener('click', () => this._openTaskPopover({ mode: 'edit', task }, due.getBoundingClientRect()));
      right.appendChild(due);
    } else {
      const setDue = el('button', 'planner-task__due planner-task__due--empty');
      setDue.type = 'button';
      setDue.title = 'Click to edit task';
      setDue.textContent = 'Set date';
      setDue.addEventListener('click', () => this._openTaskPopover({ mode: 'edit', task }, setDue.getBoundingClientRect()));
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


  private _openTaskMenu(task: PlannerTask, anchor: DOMRect): void {
    const overlay = el('div', 'planner-menu-overlay');
    overlay.addEventListener('click', () => overlay.remove());

    const menu = el('div', 'planner-menu');
    menu.style.position = 'fixed';

    const items: { label: string; action: () => void; danger?: boolean }[] = [
      { label: 'Edit task',      action: () => this._openTaskPopover({ mode: 'edit', task }, anchor) },
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

  private _captureNewTask(anchor?: DOMRect): void {
    const fallback = anchor ?? new DOMRect(window.innerWidth / 2 - 180, 120, 0, 0);
    this._openTaskPopover({ mode: 'create' }, fallback);
  }

  // ── Calendar tab ─────────────────────────────────────────────────────

  private async _renderCalendarTab(body: HTMLElement, actions: HTMLElement): Promise<void> {
    // Clean layout: one tight cluster of calendar controls on the left
    // (Today, prev/next, big date label, view dropdown), Create button on
    // the far right. No search/settings clutter — Settings lives in the
    // sidebar where it belongs. Every control sits on the same 28px
    // baseline so the chrome reads as one row of equal-weight elements.

    // Today — outlined sharp button, distinct from the arrow pair.
    const today = el('button', 'planner-todaybtn');
    today.type = 'button';
    today.textContent = 'Today';
    today.addEventListener('click', () => { this._cursorDate = startOfDay(new Date()); void this._renderTab(); });
    actions.appendChild(today);

    // Prev / Next — connected icon pair.
    const nav = el('div', 'planner-cnav');
    const prev = el('button', 'planner-iconbtn');
    prev.type = 'button';
    prev.title = 'Previous';
    prev.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>';
    prev.addEventListener('click', () => { this._navigateCalendar(-1); void this._renderTab(); });
    nav.appendChild(prev);
    const next = el('button', 'planner-iconbtn');
    next.type = 'button';
    next.title = 'Next';
    next.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>';
    next.addEventListener('click', () => { this._navigateCalendar(1); void this._renderTab(); });
    nav.appendChild(next);
    actions.appendChild(nav);

    // Big inline date label — focal element of the cluster.
    const dateLabel = el('span', 'planner-cdate');
    dateLabel.textContent = this._calendarRangeLabel();
    actions.appendChild(dateLabel);

    // View dropdown sits next to the date as part of the same cluster.
    const viewBtn = el('button', 'planner-viewdrop');
    viewBtn.type = 'button';
    const label = this._calendarView[0].toUpperCase() + this._calendarView.slice(1);
    viewBtn.innerHTML = `<span>${label}</span><svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>`;
    viewBtn.addEventListener('click', () => this._openViewMenu(viewBtn));
    actions.appendChild(viewBtn);

    // Spacer pushes Create to the far right.
    const spacer = el('span', 'planner-pane__spacer');
    actions.appendChild(spacer);

    // Primary CTA.
    const addEvt = el('button', 'planner-cta');
    addEvt.type = 'button';
    addEvt.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg><span>Create</span>';
    addEvt.addEventListener('click', () => {
      const start = new Date(this._cursorDate);
      start.setHours(9, 0, 0, 0);
      this._openEventPopover({
        mode: 'create',
        startAt: start.getTime(),
        endAt: start.getTime() + 60 * 60 * 1000,
      }, addEvt.getBoundingClientRect());
    });
    actions.appendChild(addEvt);

    if (this._calendarView === 'month') await this._renderMonthView(body);
    else if (this._calendarView === 'week') await this._renderWeekView(body);
    else await this._renderDayView(body);
  }

  /** Dropdown menu for Month / Week / Day — replaces the inline tab strip. */
  private _openViewMenu(anchorBtn: HTMLElement): void {
    const overlay = el('div', 'planner-menu-overlay');
    overlay.addEventListener('click', () => overlay.remove());
    const menu = el('div', 'planner-menu planner-menu--narrow');
    menu.style.position = 'fixed';

    for (const v of ['month', 'week', 'day'] as CalendarView[]) {
      const item = el('button', 'planner-menu__item');
      item.type = 'button';
      const labelText = v[0].toUpperCase() + v.slice(1);
      const check = v === this._calendarView ? '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><polyline points="20 6 9 17 4 12"/></svg>' : '<span style="display:inline-block;width:13px"></span>';
      item.innerHTML = `${check}<span>${labelText}</span>`;
      item.addEventListener('click', () => {
        overlay.remove();
        this._calendarView = v;
        void this._renderTab();
      });
      menu.appendChild(item);
    }

    overlay.appendChild(menu);
    document.body.appendChild(overlay);

    const a = anchorBtn.getBoundingClientRect();
    const m = menu.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    let left = a.left;
    let top = a.bottom + 4;
    if (left + m.width > vw - 8) left = Math.max(8, vw - m.width - 8);
    if (top + m.height > vh - 8) top = Math.max(8, a.top - m.height - 4);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onKey); }
    };
    document.addEventListener('keydown', onKey);
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
        chip.addEventListener('click', (e) => { e.stopPropagation(); this._openEventPopover({ mode: 'edit', event: ev }, chip.getBoundingClientRect()); });
        evWrap.appendChild(chip);
      }
      if (dayEvents.length > MAX_SHOWN) {
        const more = el('span', 'planner-month__more');
        more.textContent = `+${dayEvents.length - MAX_SHOWN} more`;
        evWrap.appendChild(more);
      }
      cell.appendChild(evWrap);

      // Month is for navigation. Clicking a cell drills into day view —
      // event creation happens there via click or drag on time slots, the
      // way every digital calendar (Google / Apple / Outlook) works.
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

      // Hour gridlines (visual only — interaction is on the column itself).
      for (let h = HOURS_START; h < HOURS_END; h++) {
        const cell = el('div', 'planner-week__cell');
        cell.dataset.hour = String(h);
        dayCol.appendChild(cell);
      }
      // Click + drag-to-create on the day column.
      this._installDragCreate(dayCol, day);

      // Current-time indicator on today's column.
      if (sameDay(day, new Date())) {
        const now = new Date();
        const elapsed = now.getTime() - startOfDay(now).getTime();
        const pct = (elapsed / (24 * 3_600_000)) * 100;
        const nowLine = el('div', 'planner-week__nowline');
        nowLine.style.top = `${pct}%`;
        const dot = el('span', 'planner-week__nowdot');
        nowLine.appendChild(dot);
        dayCol.appendChild(nowLine);
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
        bar.addEventListener('click', (e) => {
          e.stopPropagation();
          this._openEventPopover({ mode: 'edit', event: ev }, bar.getBoundingClientRect());
        });
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

      const cell = el('div', 'planner-day__cell');
      cell.dataset.hour = String(h);
      col.appendChild(cell);
    }
    grid.appendChild(hours);
    grid.appendChild(col);
    this._installDragCreate(col, this._cursorDate);

    // Current-time indicator (only if cursor is on today).
    if (sameDay(this._cursorDate, new Date())) {
      const now = new Date();
      const elapsed = now.getTime() - startOfDay(now).getTime();
      const pct = (elapsed / (24 * 3_600_000)) * 100;
      const nowLine = el('div', 'planner-day__nowline');
      nowLine.style.top = `${pct}%`;
      const dot = el('span', 'planner-day__nowdot');
      nowLine.appendChild(dot);
      col.appendChild(nowLine);
    }

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
      bar.addEventListener('click', (e) => {
        e.stopPropagation();
        this._openEventPopover({ mode: 'edit', event: ev }, bar.getBoundingClientRect());
      });
      col.appendChild(bar);
    }

    body.appendChild(grid);
  }

  // ── Drag-to-create on week / day time columns ───────────────────────

  /**
   * Standard digital-calendar interaction: pointerdown on a time-slot,
   * drag to set the range, release to open the create popover with the
   * range prefilled. A bare click (no drag) defaults to a 1-hour event
   * starting on the snapped boundary closest to the click.
   *
   * The ghost rectangle previews the snap target during the drag (15-min
   * granularity) so the user can see what they'll get before releasing.
   *
   * Events that sit absolutely above the column have their own click
   * handlers with stopPropagation, so pointerdown on an event bar never
   * reaches this column-level handler.
   */
  private _installDragCreate(col: HTMLElement, day: Date): void {
    const SNAP_MIN = 15;
    const SNAP_MS = SNAP_MIN * 60_000;
    const DAY_MS = 24 * 3_600_000;
    const MIN_EVENT_MS = 30 * 60_000;
    const DRAG_THRESHOLD_PX = 3;

    col.addEventListener('pointerdown', (e) => {
      // Only start from a time-slot cell — not from an event bar that
      // happens to sit above. Event bars have their own click handlers.
      if (!(e.target instanceof HTMLElement)) return;
      const isCell = e.target.classList.contains('planner-week__cell')
                  || e.target.classList.contains('planner-day__cell');
      if (!isCell) return;
      e.preventDefault();

      const colRect = col.getBoundingClientRect();
      const startY = Math.max(0, Math.min(colRect.height, e.clientY - colRect.top));
      let endY = startY;
      let moved = false;

      // Convert Y position → ms, snapped to SNAP_MIN.
      const dayStartMs = startOfDay(day).getTime();
      const yToMs = (y: number): number => {
        const raw = dayStartMs + (y / colRect.height) * DAY_MS;
        return Math.round(raw / SNAP_MS) * SNAP_MS;
      };
      const msToPct = (ms: number): number => ((ms - dayStartMs) / DAY_MS) * 100;

      // Live preview ghost.
      const ghost = el('div', 'planner-cal__ghost');
      col.appendChild(ghost);

      const drawGhost = () => {
        const a = Math.min(startY, endY);
        const b = Math.max(startY, endY);
        const startMs = yToMs(a);
        let endMs = yToMs(b);
        if (!moved || endMs - startMs < MIN_EVENT_MS) endMs = startMs + MIN_EVENT_MS;
        const topPct = msToPct(startMs);
        const heightPct = ((endMs - startMs) / DAY_MS) * 100;
        ghost.style.top = `${topPct}%`;
        ghost.style.height = `${heightPct}%`;
        ghost.textContent = `${formatTimeShort(startMs)} – ${formatTimeShort(endMs)}`;
      };
      drawGhost();

      try { col.setPointerCapture(e.pointerId); } catch { /* ok */ }

      const onMove = (ev: PointerEvent) => {
        const delta = Math.abs(ev.clientY - e.clientY);
        if (delta > DRAG_THRESHOLD_PX) moved = true;
        endY = Math.max(0, Math.min(colRect.height, ev.clientY - colRect.top));
        drawGhost();
      };
      const onUp = (ev: PointerEvent) => {
        col.removeEventListener('pointermove', onMove);
        col.removeEventListener('pointerup', onUp);
        col.removeEventListener('pointercancel', onUp);
        try { col.releasePointerCapture(ev.pointerId); } catch { /* ok */ }

        const a = Math.min(startY, endY);
        const b = Math.max(startY, endY);
        const startMs = yToMs(a);
        let endMs = yToMs(b);
        // Bare click → 1h default. Drag (any meaningful movement) → snapped range.
        if (!moved || endMs - startMs < MIN_EVENT_MS) endMs = startMs + (moved ? MIN_EVENT_MS : 60 * 60_000);

        // Re-render the ghost so it matches the final committed range (in
        // case the drag ended mid-snap interval). Then hand it off to the
        // popover — the ghost survives until the popover closes, so the
        // user sees their selection while they fill in details.
        const finalTopPct = msToPct(startMs);
        const finalHeightPct = ((endMs - startMs) / DAY_MS) * 100;
        ghost.style.top = `${finalTopPct}%`;
        ghost.style.height = `${finalHeightPct}%`;
        ghost.textContent = `${formatTimeShort(startMs)} – ${formatTimeShort(endMs)}`;

        const ghostRect = ghost.getBoundingClientRect();

        this._openEventPopover({
          mode: 'create',
          startAt: startMs,
          endAt: endMs,
          pendingGhost: ghost,
        }, ghostRect);
      };
      col.addEventListener('pointermove', onMove);
      col.addEventListener('pointerup', onUp);
      col.addEventListener('pointercancel', onUp);
    });
  }

  // ── Task popover (create + edit) ────────────────────────────────────

  /**
   * Single popover for task create + edit. Comprehensive form so every
   * task-create path goes through one place instead of degrading to
   * "type a title and pray". Fields:
   *
   *   title  · due date + time · all-day toggle · reminder dropdown
   *   tags   · notes (description) · status segmented control
   *
   * Save commits via createTask / updateTask; Delete only shows in edit
   * mode. Same close() lifecycle as the event popover so cancel paths
   * (Escape, outside click, ×, Cancel) all clean up consistently.
   */
  private _openTaskPopover(
    init: { mode: 'create'; seedDueAt?: number; seedStatus?: TaskStatus; seedTitle?: string }
        | { mode: 'edit'; task: PlannerTask },
    anchor: DOMRect,
  ): void {
    const close = () => {
      try { overlay.remove(); } catch { /* noop */ }
      document.removeEventListener('keydown', onKey);
    };

    const overlay = el('div', 'planner-popover-overlay');
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    const pop = el('div', 'planner-popover');
    pop.style.position = 'fixed';

    const isEdit = init.mode === 'edit';
    // Defaults on create: +5d due, 'reviewing' (the journaling flow).
    // Calendar drags pass seedDueAt + seedStatus='planned' to override.
    const seed: {
      title: string;
      dueAt: number;
      hasReminder: boolean;
      reminderOffsetMin: number;
      tagsCsv: string;
      description: string;
      status: TaskStatus;
      taskId: string | null;
    } = isEdit
      ? {
          title: init.task.title,
          dueAt: init.task.dueAt ?? Date.now() + 5 * 86_400_000,
          hasReminder: init.task.reminderAt != null,
          reminderOffsetMin: init.task.reminderAt != null && init.task.dueAt != null
            ? Math.max(0, Math.round((init.task.dueAt - init.task.reminderAt) / 60_000))
            : 60,
          tagsCsv: init.task.tags.join(', '),
          description: init.task.description ?? '',
          status: init.task.status,
          taskId: init.task.id,
        }
      : {
          title: init.seedTitle ?? '',
          dueAt: init.seedDueAt ?? Date.now() + 5 * 86_400_000,
          hasReminder: false,
          reminderOffsetMin: 60,
          tagsCsv: '',
          description: '',
          status: init.seedStatus ?? 'reviewing',
          taskId: null,
        };

    // Header
    const head = el('div', 'planner-popover__head');
    const heading = el('h3', 'planner-popover__title');
    heading.textContent = isEdit ? 'Edit task' : 'New task';
    head.appendChild(heading);
    const closeBtn = el('button', 'planner-popover__close');
    closeBtn.type = 'button';
    closeBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    closeBtn.addEventListener('click', () => close());
    head.appendChild(closeBtn);
    pop.appendChild(head);

    // Body
    const body = el('div', 'planner-popover__body');

    const titleInput = el('input', 'planner-popover__title-input') as HTMLInputElement;
    titleInput.type = 'text';
    titleInput.placeholder = 'What needs to happen?';
    titleInput.value = seed.title;
    body.appendChild(titleInput);

    // Due — date + time row, with an All-day toggle that hides the time field.
    const dueRow = el('div', 'planner-popover__row planner-popover__row--labeled');
    const dueLabel = el('span', 'planner-popover__rowlabel');
    dueLabel.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg><span>Due</span>';
    dueRow.appendChild(dueLabel);
    const dueDate = el('input', 'planner-popover__field planner-popover__field--date') as HTMLInputElement;
    dueDate.type = 'date';
    dueDate.value = toDateInputValue(seed.dueAt);
    dueRow.appendChild(dueDate);
    const dueTime = el('input', 'planner-popover__field planner-popover__field--time') as HTMLInputElement;
    dueTime.type = 'time';
    dueTime.value = toTimeInputValue(seed.dueAt);
    dueRow.appendChild(dueTime);
    body.appendChild(dueRow);

    const allDayRow = el('label', 'planner-popover__check');
    const allDayInput = el('input') as HTMLInputElement;
    allDayInput.type = 'checkbox';
    // All-day default: true if the seeded time is midnight (the user
    // didn't pick a time), false otherwise.
    allDayInput.checked = new Date(seed.dueAt).getHours() === 0 && new Date(seed.dueAt).getMinutes() === 0 && !isEdit;
    allDayRow.appendChild(allDayInput);
    const allDayText = el('span');
    allDayText.textContent = 'No specific time (all day)';
    allDayRow.appendChild(allDayText);
    body.appendChild(allDayRow);
    const updateAllDay = () => {
      const off = allDayInput.checked;
      dueTime.disabled = off;
      dueTime.style.opacity = off ? '0.4' : '';
    };
    allDayInput.addEventListener('change', updateAllDay);
    updateAllDay();

    // Reminder — dropdown of presets + None.
    const remindRow = el('div', 'planner-popover__row planner-popover__row--labeled');
    const remindLabel = el('span', 'planner-popover__rowlabel');
    remindLabel.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg><span>Remind</span>';
    remindRow.appendChild(remindLabel);
    const remindSelect = el('select', 'planner-popover__field planner-popover__field--select') as HTMLSelectElement;
    const REMINDER_PRESETS: { label: string; offsetMin: number | null }[] = [
      { label: 'No reminder',         offsetMin: null },
      { label: 'At time of due',      offsetMin: 0 },
      { label: '5 minutes before',    offsetMin: 5 },
      { label: '15 minutes before',   offsetMin: 15 },
      { label: '30 minutes before',   offsetMin: 30 },
      { label: '1 hour before',       offsetMin: 60 },
      { label: '1 day before',        offsetMin: 1440 },
      { label: '1 week before',       offsetMin: 10_080 },
    ];
    for (const preset of REMINDER_PRESETS) {
      const opt = document.createElement('option');
      opt.value = preset.offsetMin === null ? 'none' : String(preset.offsetMin);
      opt.textContent = preset.label;
      remindSelect.appendChild(opt);
    }
    if (seed.hasReminder) {
      // Match the closest preset; if none matches exactly, default to "1 hour before".
      const matching = REMINDER_PRESETS.find(p => p.offsetMin === seed.reminderOffsetMin);
      remindSelect.value = matching ? String(matching.offsetMin) : '60';
    } else {
      remindSelect.value = 'none';
    }
    remindRow.appendChild(remindSelect);
    body.appendChild(remindRow);

    // Tags
    const tagRow = el('div', 'planner-popover__row planner-popover__row--labeled');
    const tagLabel = el('span', 'planner-popover__rowlabel');
    tagLabel.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41L13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg><span>Tags</span>';
    tagRow.appendChild(tagLabel);
    const tagInput = el('input', 'planner-popover__field planner-popover__field--full') as HTMLInputElement;
    tagInput.type = 'text';
    tagInput.placeholder = 'e.g. errands, calls';
    tagInput.value = seed.tagsCsv;
    tagRow.appendChild(tagInput);
    body.appendChild(tagRow);

    // Notes
    const descInput = el('textarea', 'planner-popover__textarea') as HTMLTextAreaElement;
    descInput.placeholder = 'Notes';
    descInput.value = seed.description;
    body.appendChild(descInput);

    // Status — segmented control (Reviewing / Planned), defaults from seed.
    const statusRow = el('div', 'planner-popover__statusrow');
    const statusLabel = el('span', 'planner-popover__statuslabel');
    statusLabel.textContent = 'Status';
    statusRow.appendChild(statusLabel);
    const statusGroup = el('div', 'planner-popover__statusgroup');
    let statusValue: TaskStatus = seed.status === 'cancelled' ? 'reviewing' : seed.status;
    const statusOptions: { value: TaskStatus; label: string }[] = [
      { value: 'reviewing', label: 'Reviewing' },
      { value: 'planned',   label: 'Planned' },
    ];
    if (isEdit) statusOptions.push({ value: 'done', label: 'Done' });
    for (const opt of statusOptions) {
      const btn = el('button', 'planner-popover__statusbtn');
      btn.type = 'button';
      btn.dataset.value = opt.value;
      btn.textContent = opt.label;
      if (opt.value === statusValue) btn.classList.add('planner-popover__statusbtn--active');
      btn.addEventListener('click', () => {
        statusValue = opt.value;
        for (const sib of Array.from(statusGroup.children)) {
          if (!(sib instanceof HTMLElement)) continue;
          sib.classList.toggle('planner-popover__statusbtn--active', sib.dataset.value === statusValue);
        }
      });
      statusGroup.appendChild(btn);
    }
    statusRow.appendChild(statusGroup);
    body.appendChild(statusRow);

    pop.appendChild(body);

    // Footer
    const foot = el('div', 'planner-popover__foot');
    if (isEdit && seed.taskId) {
      const delBtn = el('button', 'planner-popover__btn planner-popover__btn--danger');
      delBtn.type = 'button';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', async () => {
        await this._data.removeTask(seed.taskId!);
        close();
      });
      foot.appendChild(delBtn);
    }
    const spacer = el('span', 'planner-popover__spacer');
    foot.appendChild(spacer);
    const cancel = el('button', 'planner-popover__btn');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => close());
    foot.appendChild(cancel);
    const save = el('button', 'planner-popover__btn planner-popover__btn--primary');
    save.type = 'button';
    save.textContent = isEdit ? 'Save' : 'Create task';
    const doSave = async () => {
      const title = titleInput.value.trim();
      if (!title) { titleInput.focus(); return; }
      const allDay = allDayInput.checked;
      const dueMs = allDay
        ? fromDateTimeInputs(dueDate.value, '00:00')
        : fromDateTimeInputs(dueDate.value, dueTime.value);
      if (dueMs === null) {
        await this._api.window.showErrorMessage('Invalid due date or time.');
        return;
      }
      const offsetStr = remindSelect.value;
      const reminderAt = offsetStr === 'none' ? null : dueMs - parseInt(offsetStr, 10) * 60_000;
      const tags = tagInput.value.split(',').map(s => s.trim()).filter(Boolean);
      const description = descInput.value.trim() || null;

      try {
        if (isEdit && seed.taskId) {
          await this._data.updateTask(seed.taskId, {
            title,
            description,
            status: statusValue,
            dueAt: dueMs,
            reminderAt,
            tags,
          });
        } else {
          await this._data.createTask({
            title,
            description,
            status: statusValue,
            dueAt: dueMs,
            reminderAt: reminderAt ?? null,
            tags,
          });
        }
        close();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await this._api.window.showErrorMessage(`Could not save task: ${msg}`);
      }
    };
    save.addEventListener('click', () => void doSave());
    foot.appendChild(save);
    pop.appendChild(foot);

    overlay.appendChild(pop);
    document.body.appendChild(overlay);

    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') { close(); }
      else if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault(); void doSave();
      }
    }
    document.addEventListener('keydown', onKey);
    overlay.addEventListener('animationend', () => titleInput.focus(), { once: true });
    setTimeout(() => { if (document.activeElement !== titleInput) titleInput.focus(); }, 80);

    // Anchor positioning — same logic as the event popover.
    const m = pop.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    let left = anchor.left;
    let top = anchor.bottom + 6;
    if (anchor.left + m.width > vw - 12) left = Math.max(12, vw - m.width - 12);
    if (top + m.height > vh - 12) top = Math.max(12, anchor.top - m.height - 6);
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
  }

  // ── Event popover (create + edit) ───────────────────────────────────

  /**
   * Single popover for both creating a new event and editing an existing
   * one. Form: title, start time, end time, all-day toggle, location,
   * description. Save commits via createEvent / updateEvent; Delete only
   * shows in edit mode. Dismisses on Escape or outside click; never
   * navigates away.
   */
  private _openEventPopover(
    init: { mode: 'create'; startAt: number; endAt: number; pendingGhost?: HTMLElement | null }
        | { mode: 'edit'; event: PlannerEvent },
    anchor: DOMRect,
  ): void {
    // Pending ghost from a drag selection — survives onto the popover so
    // the user sees what they're creating while they fill it in. Cleared
    // by close(), so cancel / escape / outside-click / save all dispose
    // of it without flicker.
    const pendingGhost = init.mode === 'create' ? init.pendingGhost ?? null : null;

    const close = () => {
      try { overlay.remove(); } catch { /* noop */ }
      if (pendingGhost && pendingGhost.parentElement) {
        try { pendingGhost.remove(); } catch { /* noop */ }
      }
      document.removeEventListener('keydown', onKey);
    };

    const overlay = el('div', 'planner-popover-overlay');
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    // Highlight the pending ghost while the popover is open — it's the
    // visible "this is what you're creating" anchor.
    if (pendingGhost) pendingGhost.classList.add('planner-cal__ghost--pending');

    const pop = el('div', 'planner-popover');
    pop.style.position = 'fixed';

    const isEdit = init.mode === 'edit';
    const seed: { title: string; startAt: number; endAt: number; allDay: boolean; location: string; description: string; eventId: string | null } = isEdit
      ? {
          title: init.event.title,
          startAt: init.event.startAt,
          endAt: init.event.endAt,
          allDay: init.event.allDay,
          location: init.event.location ?? '',
          description: init.event.description ?? '',
          eventId: init.event.id,
        }
      : {
          title: '',
          startAt: init.startAt,
          endAt: init.endAt,
          allDay: false,
          location: '',
          description: '',
          eventId: null,
        };

    // Header
    const head = el('div', 'planner-popover__head');
    const heading = el('h3', 'planner-popover__title');
    heading.textContent = isEdit ? 'Edit event' : 'New event';
    head.appendChild(heading);
    const closeBtn = el('button', 'planner-popover__close');
    closeBtn.type = 'button';
    closeBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    closeBtn.addEventListener('click', () => close());
    head.appendChild(closeBtn);
    pop.appendChild(head);

    // Body
    const body = el('div', 'planner-popover__body');

    const titleInput = el('input', 'planner-popover__title-input') as HTMLInputElement;
    titleInput.type = 'text';
    titleInput.placeholder = 'Add a title';
    titleInput.value = seed.title;
    body.appendChild(titleInput);

    // Date / time row
    const timeRow = el('div', 'planner-popover__row');
    const startDate = el('input', 'planner-popover__field planner-popover__field--date') as HTMLInputElement;
    startDate.type = 'date';
    startDate.value = toDateInputValue(seed.startAt);
    const startTime = el('input', 'planner-popover__field planner-popover__field--time') as HTMLInputElement;
    startTime.type = 'time';
    startTime.value = toTimeInputValue(seed.startAt);
    const sep = el('span', 'planner-popover__sep');
    sep.textContent = '—';
    const endTime = el('input', 'planner-popover__field planner-popover__field--time') as HTMLInputElement;
    endTime.type = 'time';
    endTime.value = toTimeInputValue(seed.endAt);
    const endDate = el('input', 'planner-popover__field planner-popover__field--date') as HTMLInputElement;
    endDate.type = 'date';
    endDate.value = toDateInputValue(seed.endAt);
    timeRow.appendChild(startDate);
    timeRow.appendChild(startTime);
    timeRow.appendChild(sep);
    timeRow.appendChild(endTime);
    timeRow.appendChild(endDate);
    body.appendChild(timeRow);

    const allDayRow = el('label', 'planner-popover__check');
    const allDayInput = el('input') as HTMLInputElement;
    allDayInput.type = 'checkbox';
    allDayInput.checked = seed.allDay;
    const allDayText = el('span');
    allDayText.textContent = 'All day';
    allDayRow.appendChild(allDayInput);
    allDayRow.appendChild(allDayText);
    body.appendChild(allDayRow);
    const updateAllDayUI = () => {
      const off = allDayInput.checked;
      startTime.disabled = off; endTime.disabled = off;
      startTime.style.opacity = off ? '0.4' : '';
      endTime.style.opacity = off ? '0.4' : '';
    };
    allDayInput.addEventListener('change', updateAllDayUI);
    updateAllDayUI();

    const locationInput = el('input', 'planner-popover__field planner-popover__field--full') as HTMLInputElement;
    locationInput.type = 'text';
    locationInput.placeholder = 'Add location';
    locationInput.value = seed.location;
    body.appendChild(locationInput);

    const descInput = el('textarea', 'planner-popover__textarea') as HTMLTextAreaElement;
    descInput.placeholder = 'Add description';
    descInput.value = seed.description;
    body.appendChild(descInput);

    pop.appendChild(body);

    // Footer
    const foot = el('div', 'planner-popover__foot');
    if (isEdit) {
      const delBtn = el('button', 'planner-popover__btn planner-popover__btn--danger');
      delBtn.type = 'button';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', async () => {
        if (!seed.eventId) return;
        await this._data.removeEvent(seed.eventId);
        close();
      });
      foot.appendChild(delBtn);
    }
    const spacer = el('span', 'planner-popover__spacer');
    foot.appendChild(spacer);
    const cancel = el('button', 'planner-popover__btn');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => close());
    foot.appendChild(cancel);
    const save = el('button', 'planner-popover__btn planner-popover__btn--primary');
    save.type = 'button';
    save.textContent = isEdit ? 'Save' : 'Create';
    const doSave = async () => {
      const title = titleInput.value.trim();
      if (!title) { titleInput.focus(); return; }
      const startMs = fromDateTimeInputs(startDate.value, startTime.value);
      const endMs = fromDateTimeInputs(endDate.value, endTime.value);
      if (startMs === null || endMs === null) {
        await this._api.window.showErrorMessage('Invalid date or time.');
        return;
      }
      if (endMs < startMs) {
        await this._api.window.showErrorMessage('End time must be after start time.');
        return;
      }
      try {
        if (isEdit && seed.eventId) {
          await this._data.updateEvent(seed.eventId, {
            title,
            startAt: startMs,
            endAt: endMs,
            allDay: allDayInput.checked,
            location: locationInput.value.trim() || null,
            description: descInput.value.trim() || null,
          });
        } else {
          await this._data.createEvent({
            title,
            startAt: startMs,
            endAt: endMs,
            allDay: allDayInput.checked,
            location: locationInput.value.trim() || null,
            description: descInput.value.trim() || null,
          });
        }
        close();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await this._api.window.showErrorMessage(`Could not save event: ${msg}`);
      }
    };
    save.addEventListener('click', () => void doSave());
    foot.appendChild(save);
    pop.appendChild(foot);

    overlay.appendChild(pop);
    document.body.appendChild(overlay);

    // Keyboard: Enter saves (when not in textarea), Escape closes.
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') { close(); }
      else if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault(); void doSave();
      }
    }
    document.addEventListener('keydown', onKey);
    overlay.addEventListener('animationend', () => titleInput.focus(), { once: true });
    // Failsafe focus if animation doesn't fire (e.g. reduced-motion).
    setTimeout(() => { if (document.activeElement !== titleInput) titleInput.focus(); }, 80);

    // Position the popover next to the anchor; keep it on-screen.
    const m = pop.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    let left = anchor.left;
    let top = anchor.bottom + 6;
    // If anchor is in the right half, prefer left-align to its right edge so
    // long popovers don't fall off-screen.
    if (anchor.left + m.width > vw - 12) left = Math.max(12, vw - m.width - 12);
    if (top + m.height > vh - 12) top = Math.max(12, anchor.top - m.height - 6);
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
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

function startOfDayMs(): number {
  const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime();
}

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

function formatTimeShort(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function formatTimeRange(ev: PlannerEvent): string {
  const fmt = (ts: number) => new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (ev.allDay) return 'All day';
  return `${fmt(ev.startAt)} – ${fmt(ev.endAt)}`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

function toDateInputValue(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function toTimeInputValue(ms: number): string {
  const d = new Date(ms);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

function fromDateTimeInputs(dateStr: string, timeStr: string): number | null {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split('-').map(n => parseInt(n, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  let hour = 0, min = 0;
  if (timeStr) {
    const [hh, mm] = timeStr.split(':').map(n => parseInt(n, 10));
    if (Number.isFinite(hh)) hour = hh;
    if (Number.isFinite(mm)) min = mm;
  }
  const dt = new Date(y, m - 1, d, hour, min, 0, 0);
  return Number.isFinite(dt.getTime()) ? dt.getTime() : null;
}
