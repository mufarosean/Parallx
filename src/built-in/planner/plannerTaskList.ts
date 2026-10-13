// plannerTaskList.ts — the Planner's Tasks tab: the filters down the side
// (Review Queue, Today, This Week, Overdue, All Tasks, Completed), the task
// sections, each task's row (done check, due date, quick plan, its menu),
// and capturing a new task.

import { declareControl } from '../../ui/kit.js';
import { renderEmptyStateEntry } from '../../ui/emptyStates.js';
import { PLANNER_EMPTY_STATES } from './plannerEmptyStates.js';
import type { PlannerTask, TaskStatus } from './plannerTypes.js';
import { isLate, isOverdue, quickPlanOptions } from './plannerToday.js';
import { createIconElement } from '../../ui/iconRegistry.js';
import { createButton } from '../../ui/kit.js';
import { showExtensionContextMenu } from '../../ui/contextMenu.js';
import { appDateString, isSameAppDay } from '../../services/localTime.js';
import { endOfDay, startOfDayMs, formatDateShort } from './plannerDates.js';
import { el } from './plannerUi.js';
import type { PlannerEditorPane } from './plannerEditorProvider.js';

export class PlannerTaskList {
  constructor(private readonly _pane: PlannerEditorPane) {}

  async renderTasksTab(body: HTMLElement, actions: HTMLElement): Promise<void> {
    const addBtn = createButton(null, { id: 'planner.newTask', command: 'planner.newTask', label: 'New Task', icon: 'plus', kind: 'primary', title: 'New Task (C)' });
    addBtn.classList.add('planner-cta');
    addBtn.addEventListener('click', () => this._captureNewTask(addBtn.getBoundingClientRect()));
    actions.appendChild(addBtn);

    const all = await this._pane._data.listTasks({
      status: ['reviewing', 'planned', 'done'],
      includeUndated: true,
      limit: 500,
    });

    if (all.length === 0) {
      body.appendChild(renderEmptyStateEntry(PLANNER_EMPTY_STATES.day));
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
      { key: 'review',  label: 'Review Queue', pinned: true, match: t => t.status === 'reviewing' },
      { key: 'today',   label: 'Today',     match: t => (t.status === 'planned' || t.status === 'reviewing') && t.dueAt != null && isSameAppDay(t.dueAt, Date.now()) },
      { key: 'week',    label: 'This Week', match: t => (t.status === 'planned' || t.status === 'reviewing') && t.dueAt != null && t.dueAt >= startOfDayMs() && t.dueAt <= startOfDayMs() + 7 * 86_400_000 },
      { key: 'overdue', label: 'Overdue',   match: t => (t.status === 'planned' || t.status === 'reviewing') && isOverdue(t, Date.now()) },
      { key: 'all',     label: 'All Tasks', match: t => t.status !== 'cancelled' },
      { key: 'completed', label: 'Completed', match: t => t.status === 'done' },
    ];

    let activeKey = this._pane._tasksFilter;

    const renderContent = () => {
      content.innerHTML = '';
      const filter = filters.find(f => f.key === activeKey) ?? filters[filters.length - 1];
      const matching = all.filter(filter.match);

      if (activeKey === 'all') {
        // "All tasks" uses the grouped section view so the user has the
        // full overview when no specific filter is active.
        const reviewing = matching.filter(t => t.status === 'reviewing');
        const overdue   = matching.filter(t => t.status === 'planned' && isOverdue(t, Date.now()));
        const today     = matching.filter(t => t.status === 'planned' && t.dueAt != null && isSameAppDay(t.dueAt, Date.now()));
        const upcoming  = matching.filter(t => t.status === 'planned' && t.dueAt != null && t.dueAt > endOfDay(new Date()).getTime());
        const noDate    = matching.filter(t => t.status === 'planned' && !t.dueAt);
        const completed = matching.filter(t => t.status === 'done').slice(0, 12);
        if (reviewing.length > 0) content.appendChild(this._renderTaskSection('Review Queue', reviewing, { accent: 'review', hint: 'Captured without a date. Pick a day for each.' }));
        if (overdue.length > 0)   content.appendChild(this._renderTaskSection('Overdue', overdue, { accent: 'overdue' }));
        if (today.length > 0)     content.appendChild(this._renderTaskSection('Today', today, { accent: 'today' }));
        if (upcoming.length > 0)  content.appendChild(this._renderTaskSection('Upcoming', upcoming));
        if (noDate.length > 0)    content.appendChild(this._renderTaskSection('No Date', noDate));
        if (completed.length > 0) content.appendChild(this._renderTaskSection('Recently Completed', completed, { collapsed: true }));
      } else {
        // Single-filter view: one flat section with the matching rows.
        if (matching.length === 0) {
          content.appendChild(renderEmptyStateEntry(PLANNER_EMPTY_STATES.filter));
          return;
        }
        // Completed reads best newest-first (by completion time).
        const rows = activeKey === 'completed'
          ? [...matching].sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))
          : matching;
        const accent = activeKey === 'review' ? 'review' : activeKey === 'overdue' ? 'overdue' : activeKey === 'today' ? 'today' : undefined;
        content.appendChild(this._renderTaskSection(filter.label, rows, { accent }));
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
      declareControl(item, { id: `planner.tasks.nav.${f.key}`, label: f.label, state: () => ({ kind: 'pressed', value: item.classList.contains('planner-tasks__navitem--active') }) });
      const label = el('span', 'planner-tasks__navlabel');
      label.textContent = f.label;
      const count = el('span', 'planner-tasks__navcount');
      count.textContent = String(all.filter(f.match).length);
      item.appendChild(label);
      item.appendChild(count);
      item.addEventListener('click', () => {
        activeKey = f.key;
        this._pane._tasksFilter = activeKey;
        this._pane._saveViewState();
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
    if (opts.collapsed) {
      // Collapsible sections (e.g. "Recently completed") get a clickable header
      // + caret so the tasks are actually reachable, not just a count behind a
      // permanently-hidden list.
      head.classList.add('planner-section__head--toggle');
      head.setAttribute('role', 'button');
      head.tabIndex = 0;
      head.title = 'Show or Hide';
      const caret = el('span', 'planner-section__caret');
      caret.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';
      head.appendChild(caret);
      const toggle = () => section.classList.toggle('planner-section--collapsed');
      head.addEventListener('click', toggle);
      head.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
      });
    }
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
    checkbox.title = task.status === 'done' ? 'Mark Not Done' : 'Mark Done';
    checkbox.setAttribute('aria-label', checkbox.title);
    checkbox.innerHTML = task.status === 'done'
      ? '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>'
      : '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/></svg>';
    checkbox.addEventListener('click', () => {
      const next: TaskStatus = task.status === 'done' ? 'planned' : 'done';
      // optimistic UI: flip the visuals NOW (Linear rule: common
      // actions feel instant); the data-change event repaints truth after
      // the worker-thread round-trip.
      row.classList.toggle('planner-task--done', next === 'done');
      checkbox.innerHTML = next === 'done'
        ? '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>'
        : '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/></svg>';
      void this._pane._data.updateTask(task.id, { status: next });
      this._pane._note(next === 'done' ? 'completed' : 'reopened', `task "${task.title}"`, task.id);
    });
    row.appendChild(checkbox);

    const main = el('div', 'planner-task__main');
    const titleEl = el('span', 'planner-task__title');
    titleEl.textContent = task.title;
    titleEl.title = 'Click to edit';
    titleEl.addEventListener('click', () => this._pane.taskPopover.openTaskPopover({ mode: 'edit', task }, titleEl.getBoundingClientRect()));
    main.appendChild(titleEl);
    if (task.description) {
      const desc = el('span', 'planner-task__desc');
      desc.textContent = task.description;
      main.appendChild(desc);
    }
    // Review Queue: plan it in one click, the same days Today offers.
    if (task.status === 'reviewing') {
      const plan = el('div', 'planner-task__quickplan');
      plan.setAttribute('role', 'group');
      plan.setAttribute('aria-label', `Plan “${task.title}”`);
      for (const opt of quickPlanOptions(Date.now())) {
        const day = appDateString(opt.dueAt, { weekday: 'short', month: 'short', day: 'numeric' });
        createButton(plan, { id: null,
          label: opt.label, size: 'sm', kind: 'secondary', title: `Plan for ${day}`,
          onClick: () => {
            row.classList.add('planner-task--leaving');
            void this._pane._data.updateTask(task.id, { status: 'planned', dueAt: opt.dueAt });
            this._pane._note('planned', `task "${task.title}"`, task.id, `for ${day}`);
          },
        });
      }
      main.appendChild(plan);
    }
    row.appendChild(main);

    const right = el('div', 'planner-task__right');

    if (task.dueAt) {
      const due = el('button', 'planner-task__due');
      due.type = 'button';
      due.title = 'Click to edit task';
      if (isLate(task, Date.now())) due.classList.add('planner-task__due--overdue');
      due.textContent = formatDateShort(task.dueAt);
      due.addEventListener('click', () => this._pane.taskPopover.openTaskPopover({ mode: 'edit', task }, due.getBoundingClientRect()));
      right.appendChild(due);
    } else {
      const setDue = el('button', 'planner-task__due planner-task__due--empty');
      setDue.type = 'button';
      setDue.title = 'Pick a date';
      setDue.textContent = 'Pick Date…';
      setDue.addEventListener('click', () => this._pane.taskPopover.openTaskPopover({ mode: 'edit', task }, setDue.getBoundingClientRect()));
      right.appendChild(setDue);
    }

    // A captured task that already carries a date: confirm that date as is.
    if (task.status === 'reviewing' && task.dueAt) {
      const planBtn = el('button', 'planner-task__plan');
      planBtn.type = 'button';
      planBtn.title = 'Keep This Date';
      planBtn.setAttribute('aria-label', 'Keep This Date');
      planBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12l5 5L20 7"/></svg>';
      planBtn.addEventListener('click', () => {
        void this._pane._data.updateTask(task.id, { status: 'planned' });
        this._pane._note('planned', `task "${task.title}"`, task.id);
      });
      right.appendChild(planBtn);
    }

    const more = el('button', 'planner-task__more');
    more.type = 'button';
    more.title = 'More Actions';
    more.setAttribute('aria-label', 'More Actions');
    more.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>';
    more.addEventListener('click', () => this._openTaskMenu(task, more));
    right.appendChild(more);

    row.appendChild(right);
    return row;
  }


  private _openTaskMenu(task: PlannerTask, anchor: HTMLElement): void {
    const reviewing = task.status === 'reviewing';
    showExtensionContextMenu(anchor, [
      { label: 'Edit Task', icon: 'pencil', onSelect: () => this._pane.taskPopover.openTaskPopover({ mode: 'edit', task }, anchor.getBoundingClientRect()) },
      { label: reviewing ? 'Move to Planned' : 'Move to Review', onSelect: () => {
        const to = reviewing ? 'planned' : 'reviewing';
        void this._pane._data.updateTask(task.id, { status: to });
        this._pane._note('moved', `task "${task.title}"`, task.id, `to ${to}`);
      } },
      { separator: true },
      { label: 'Cancel Task', onSelect: () => { void this._pane._data.updateTask(task.id, { status: 'cancelled' }); this._pane._note('cancelled', `task "${task.title}"`, task.id); } },
      { label: 'Delete Forever…', icon: 'trash', danger: true, onSelect: () => void this._deleteTaskForever(task) },
    ], { anchorPosition: 'below' }, (icon, c) => c.appendChild(createIconElement(icon, 14)));
  }

  /** Deleting cannot be undone (Cancel Task keeps it), so it asks first. */
  private async _deleteTaskForever(task: PlannerTask): Promise<void> {
    const ok = this._pane._api.window.showConfirmModal
      ? await this._pane._api.window.showConfirmModal({
        message: `Delete “${task.title}” forever?`,
        detail: 'It cannot be brought back. Cancel Task keeps it in the record instead.',
        confirmLabel: 'Delete Task',
        danger: true,
      })
      : true;
    if (!ok) return;
    void this._pane._data.removeTask(task.id);
    this._pane._note('deleted', `task "${task.title}"`, task.id);
  }

  private _captureNewTask(anchor?: DOMRect): void {
    const fallback = anchor ?? new DOMRect(window.innerWidth / 2 - 180, 120, 0, 0);
    this._pane.taskPopover.openTaskPopover({ mode: 'create' }, fallback);
  }

  // ── Calendar tab ─────────────────────────────────────────────────────
}
