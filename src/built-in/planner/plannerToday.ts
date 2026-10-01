// plannerToday.ts — the planner's Today tab: one day, events and tasks on a
// single timeline, with what still needs a decision beside it.
//
// The model (`buildTodayModel`, `quickPlanOptions`, `todaySummary`) is pure so
// it can be tested without a DOM; `PlannerTodayView` paints it with the kit
// (page header, buttons, section labels) and the planner's tokens. The pane
// owns the popovers, so opening an event or task goes back through `deps`.

import type { IDisposable } from '../../platform/lifecycle.js';
import { createButton, createIconButton, createPageHeader, createSectionLabel } from '../../ui/kit.js';
import { createIconElement } from '../../ui/iconRegistry.js';
import type { PlannerDataService } from './plannerDataService.js';
import type { PlannerEvent, PlannerTask } from './plannerTypes.js';

const REVIEW_PREVIEW = 3;

// ─── Model ───────────────────────────────────────────────────────────────────

export type ScheduleItem =
  | { readonly kind: 'event'; readonly at: number; readonly end: number; readonly event: PlannerEvent; readonly past: boolean }
  | { readonly kind: 'task'; readonly at: number; readonly task: PlannerTask; readonly past: boolean };

export interface TodayModel {
  readonly dayStart: number;
  /** All-day and multi-day events touching today. */
  readonly allDay: readonly PlannerEvent[];
  /** Timed events and timed tasks, in start order. */
  readonly schedule: readonly ScheduleItem[];
  /** How many schedule items start at or before now: the current-time line goes before item [nowIndex]. */
  readonly nowIndex: number;
  /** Tasks due today with no time of day (stored at local midnight). */
  readonly anytime: readonly PlannerTask[];
  /** Open tasks due before today. */
  readonly overdue: readonly PlannerTask[];
  /** Tasks still in the Review Queue. */
  readonly review: readonly PlannerTask[];
}

export interface TodayInput {
  readonly tasks: readonly PlannerTask[];
  readonly events: readonly PlannerEvent[];
  readonly isVisible: (calendarId: string | null) => boolean;
  readonly now: number;
}

export function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function addLocalDays(dayStart: number, n: number): number {
  const d = new Date(dayStart);
  d.setDate(d.getDate() + n);
  return d.getTime();
}

/** A due time at local midnight means the user picked no time of day. */
export function isUntimed(ms: number): boolean {
  const d = new Date(ms);
  return d.getHours() === 0 && d.getMinutes() === 0;
}

/** An open task whose due day has passed. A task due earlier today is late,
 *  not overdue: it stays on today's list until the day ends. */
export function isOverdue(task: Pick<PlannerTask, 'status' | 'dueAt'>, now: number): boolean {
  return task.status !== 'done' && task.status !== 'cancelled' && task.dueAt != null && task.dueAt < startOfLocalDay(now);
}

/** Past its due time today, or overdue. Untimed tasks are never late on their own day. */
export function isLate(task: Pick<PlannerTask, 'status' | 'dueAt'>, now: number): boolean {
  if (task.status === 'done' || task.dueAt == null) return false;
  return isOverdue(task, now) || (!isUntimed(task.dueAt) && task.dueAt < now);
}

/** Flagged all-day, or spanning more than one calendar day (the calendar's own rule). */
export function isAllDayLike(ev: PlannerEvent): boolean {
  return ev.allDay || startOfLocalDay(ev.startAt) !== startOfLocalDay(ev.endAt - 1);
}

export function buildTodayModel(input: TodayInput): TodayModel {
  const { now } = input;
  const dayStart = startOfLocalDay(now);
  const dayEnd = addLocalDays(dayStart, 1);

  const events = input.events.filter((ev) => ev.startAt < dayEnd && ev.endAt > dayStart && input.isVisible(ev.calendarId));
  const allDay = events.filter(isAllDayLike).sort((a, b) => a.startAt - b.startAt);

  const items: ScheduleItem[] = events
    .filter((ev) => !isAllDayLike(ev))
    .map((ev) => ({ kind: 'event' as const, at: Math.max(ev.startAt, dayStart), end: ev.endAt, event: ev, past: ev.endAt <= now }));

  const anytime: PlannerTask[] = [];
  const overdue: PlannerTask[] = [];
  const review: PlannerTask[] = [];
  for (const task of input.tasks) {
    if (task.status === 'cancelled') continue;
    if (task.status === 'reviewing') { review.push(task); continue; }
    if (task.dueAt == null || !input.isVisible(task.calendarId)) continue;
    if (task.dueAt < dayStart) {
      if (isOverdue(task, now)) overdue.push(task);
    } else if (task.dueAt < dayEnd) {
      if (isUntimed(task.dueAt)) anytime.push(task);
      else items.push({ kind: 'task', at: task.dueAt, task, past: task.dueAt <= now });
    }
  }

  items.sort((a, b) => a.at - b.at);
  overdue.sort((a, b) => (a.dueAt ?? 0) - (b.dueAt ?? 0));
  review.sort((a, b) => b.createdAt - a.createdAt);
  anytime.sort((a, b) => Number(a.status === 'done') - Number(b.status === 'done') || a.createdAt - b.createdAt);

  return {
    dayStart,
    allDay,
    schedule: items,
    nowIndex: items.filter((i) => i.at <= now).length,
    anytime,
    overdue,
    review,
  };
}

export interface QuickPlanOption {
  readonly label: string;
  /** Local midnight of the target day: a date with no time of day. */
  readonly dueAt: number;
}

/** The one-click days a Review Queue task can be planned for. */
export function quickPlanOptions(now: number): readonly QuickPlanOption[] {
  const today = startOfLocalDay(now);
  const weekday = new Date(today).getDay();
  const toMonday = ((8 - weekday) % 7) || 7;
  return [
    { label: 'Today', dueAt: today },
    { label: 'Tomorrow', dueAt: addLocalDays(today, 1) },
    { label: 'Next Week', dueAt: addLocalDays(today, toMonday) },
  ];
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The quiet line under the date: what today holds, zero parts left out. */
export function todaySummary(model: TodayModel): string {
  const events = model.allDay.length + model.schedule.filter((i) => i.kind === 'event').length;
  const due = model.schedule.filter((i) => i.kind === 'task' && i.task.status !== 'done').length
    + model.anytime.filter((t) => t.status !== 'done').length;
  const parts: string[] = [];
  if (events) parts.push(plural(events, 'event', 'events'));
  if (due) parts.push(plural(due, 'task due', 'tasks due'));
  if (model.review.length) parts.push(`${model.review.length} to review`);
  return parts.length ? parts.join(', ') : 'Nothing planned yet';
}

// ─── View ────────────────────────────────────────────────────────────────────

type IsVisible = (calendarId: string | null) => boolean;
/** An item's display colour: its own override, else its calendar's. */
type ColorOf = (calendarId: string | null, override: string | null) => string;

export interface PlannerTodayDeps {
  readonly data: PlannerDataService;
  readonly loadCalCtx: () => Promise<{ isVisible: IsVisible; colorOf: ColorOf }>;
  readonly openEvent: (ev: PlannerEvent, anchor: DOMRect) => void;
  readonly newEvent: (anchor: DOMRect) => void;
  readonly openTask: (task: PlannerTask, anchor: DOMRect) => void;
  readonly openDay: (dayStart: number) => void;
  readonly openReviewQueue: () => void;
  readonly note: (verb: string, object: string, taskId?: string, detail?: string) => void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

const timeFmt = (ms: number): string => new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const dayFmt = (ms: number): string => new Date(ms).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

export class PlannerTodayView implements IDisposable {
  /** Months away from the current one in the mini calendar. */
  private _monthOffset = 0;

  constructor(private readonly _deps: PlannerTodayDeps) {}

  async render(body: HTMLElement, actions: HTMLElement): Promise<void> {
    const newBtn = createButton(actions, { label: 'New Event', icon: 'plus', kind: 'primary' });
    newBtn.addEventListener('click', () => this._deps.newEvent(newBtn.getBoundingClientRect()));

    const now = Date.now();
    const dayStart = startOfLocalDay(now);
    const [ctx, tasks, events] = await Promise.all([
      this._deps.loadCalCtx(),
      this._deps.data.listTasks({ status: ['reviewing', 'planned', 'done'], includeUndated: true, limit: 500 }),
      this._deps.data.listEvents({ from: dayStart, to: addLocalDays(dayStart, 1) }),
    ]);
    const model = buildTodayModel({ tasks, events, isVisible: ctx.isVisible, now });

    const root = el('div', 'planner-today');
    const main = el('div', 'planner-today__main');
    const side = el('aside', 'planner-today__side');
    side.setAttribute('aria-label', 'Plan ahead');
    root.append(main, side);

    createPageHeader(main, {
      title: new Date(now).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }),
      subtitle: todaySummary(model),
    });
    main.appendChild(this._capture());
    main.appendChild(this._schedule(model, ctx.colorOf, now));
    if (model.anytime.length) main.appendChild(this._anytime(model.anytime));

    side.appendChild(await this._month(now, ctx.isVisible));
    if (model.review.length) side.appendChild(this._review(model.review, now));
    if (model.overdue.length) side.appendChild(this._overdue(model.overdue, dayStart));

    body.appendChild(root);
  }

  // ── Capture ──────────────────────────────────────────────────────────

  private _capture(): HTMLElement {
    const wrap = el('div', 'planner-today__capture');
    const input = el('input', 'planner-today__capture-input');
    input.type = 'text';
    input.placeholder = 'Capture a task, like “Call Priya about the trip”';
    input.setAttribute('aria-label', 'Capture a task');
    const hint = el('p', 'planner-today__hint', 'Press Enter to add it to the Review Queue. Give it a day when you are ready.');
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const title = input.value.trim();
      if (!title) return;
      input.value = '';
      void this._deps.data.createTask({ title, status: 'reviewing' }).then((t) => this._deps.note('captured', `task "${t.title}"`, t.id));
    });
    wrap.append(input, hint);
    return wrap;
  }

  // ── Schedule ─────────────────────────────────────────────────────────

  private _schedule(model: TodayModel, colorOf: ColorOf, now: number): HTMLElement {
    const section = el('section', 'planner-today__section');
    createSectionLabel(section, 'Schedule');

    if (model.allDay.length) {
      const band = el('div', 'planner-today__allday');
      for (const ev of model.allDay) {
        const chip = el('button', 'planner-today__allday-chip');
        chip.type = 'button';
        chip.style.setProperty('--cal-color', colorOf(ev.calendarId, ev.color));
        chip.textContent = ev.title;
        chip.title = ev.title;
        chip.addEventListener('click', () => this._deps.openEvent(ev, chip.getBoundingClientRect()));
        band.appendChild(chip);
      }
      section.appendChild(band);
    }

    if (!model.schedule.length) {
      section.appendChild(el('p', 'planner-today__empty', 'Nothing at a set time today.'));
      return section;
    }

    const list = el('div', 'planner-today__timeline');
    model.schedule.forEach((item, i) => {
      if (i === model.nowIndex) list.appendChild(this._nowLine(now));
      list.appendChild(item.kind === 'event' ? this._eventRow(item, colorOf) : this._taskRow(item.task, item.past, true));
    });
    if (model.nowIndex === model.schedule.length) list.appendChild(this._nowLine(now));
    section.appendChild(list);
    return section;
  }

  private _nowLine(now: number): HTMLElement {
    const row = el('div', 'planner-today__now');
    row.setAttribute('aria-label', `Now, ${timeFmt(now)}`);
    row.append(el('span', 'planner-today__time planner-today__now-time', timeFmt(now)), el('span', 'planner-today__now-rule'));
    return row;
  }

  private _eventRow(item: Extract<ScheduleItem, { kind: 'event' }>, colorOf: ColorOf): HTMLElement {
    const ev = item.event;
    const row = el('div', 'planner-today__row');
    if (item.past) row.classList.add('planner-today__row--past');
    row.appendChild(el('span', 'planner-today__time', timeFmt(item.at)));
    const card = el('button', 'planner-today__event');
    card.type = 'button';
    card.style.setProperty('--cal-color', colorOf(ev.calendarId, ev.color));
    card.appendChild(el('span', 'planner-today__event-title', ev.title));
    const meta = el('span', 'planner-today__meta');
    meta.appendChild(el('span', undefined, `${timeFmt(ev.startAt)} – ${timeFmt(ev.endAt)}`));
    if (ev.location) {
      const where = el('span', 'planner-today__where');
      where.append(createIconElement('map-pin', 12), el('span', undefined, ev.location));
      meta.appendChild(where);
    }
    card.appendChild(meta);
    card.addEventListener('click', () => this._deps.openEvent(ev, card.getBoundingClientRect()));
    row.appendChild(card);
    return row;
  }

  /** One task line: check, title (opens the task), and its time or tag. */
  private _taskRow(task: PlannerTask, past: boolean, timed: boolean): HTMLElement {
    const done = task.status === 'done';
    const row = el('div', timed ? 'planner-today__row' : 'planner-today__task-line');
    if (past && timed) row.classList.add('planner-today__row--past');
    if (timed) row.appendChild(el('span', 'planner-today__time', timeFmt(task.dueAt!)));

    const box = el('div', 'planner-today__task');
    if (done) box.classList.add('planner-today__task--done');
    const check = el('button', 'planner-today__check');
    check.type = 'button';
    check.setAttribute('role', 'checkbox');
    check.setAttribute('aria-checked', String(done));
    check.setAttribute('aria-label', done ? `Mark “${task.title}” Not Done` : `Mark “${task.title}” Done`);
    if (done) check.appendChild(createIconElement('check', 12));
    check.addEventListener('click', () => {
      const next = done ? 'planned' : 'done';
      box.classList.toggle('planner-today__task--done', next === 'done');
      void this._deps.data.updateTask(task.id, { status: next });
      this._deps.note(next === 'done' ? 'completed' : 'reopened', `task "${task.title}"`, task.id);
    });
    const title = el('button', 'planner-today__task-title', task.title);
    title.type = 'button';
    title.addEventListener('click', () => this._deps.openTask(task, title.getBoundingClientRect()));
    box.append(check, title);
    if (task.tags.length) box.appendChild(el('span', 'planner-today__tag', task.tags.map((t) => `#${t}`).join(' ')));
    row.appendChild(box);
    return row;
  }

  private _anytime(tasks: readonly PlannerTask[]): HTMLElement {
    const section = el('section', 'planner-today__section');
    createSectionLabel(section, 'Anytime today');
    const list = el('div', 'planner-today__list');
    for (const t of tasks) list.appendChild(this._taskRow(t, false, false));
    section.appendChild(list);
    return section;
  }

  // ── Side column ──────────────────────────────────────────────────────

  private async _month(now: number, isVisible: IsVisible): Promise<HTMLElement> {
    const card = el('section', 'planner-today__card planner-today__month');
    const first = new Date(now);
    first.setDate(1);
    first.setHours(0, 0, 0, 0);
    first.setMonth(first.getMonth() + this._monthOffset);
    const gridStart = addLocalDays(first.getTime(), -first.getDay());
    const gridEnd = addLocalDays(gridStart, 42);

    const head = el('div', 'planner-today__card-head');
    const title = el('h2', 'planner-today__card-title', first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }));
    card.setAttribute('aria-label', title.textContent ?? '');
    head.appendChild(title);
    const nav = el('div', 'planner-today__month-nav');
    const repaint = () => void this._repaintMonth(card, now, isVisible);
    createIconButton(nav, { icon: 'chevron-left', title: 'Previous Month', size: 'sm', onClick: () => { this._monthOffset--; repaint(); } });
    createIconButton(nav, { icon: 'chevron-right', title: 'Next Month', size: 'sm', onClick: () => { this._monthOffset++; repaint(); } });
    head.appendChild(nav);
    card.appendChild(head);

    const [events, tasks] = await Promise.all([
      this._deps.data.listEvents({ from: gridStart, to: gridEnd }),
      this._deps.data.listTasks({ status: ['planned', 'done'], dueFrom: gridStart, dueTo: gridEnd, limit: 1000 }),
    ]);
    const load = new Map<number, number>();
    const bump = (ms: number) => { const k = startOfLocalDay(ms); load.set(k, (load.get(k) ?? 0) + 1); };
    for (const ev of events) if (isVisible(ev.calendarId)) bump(ev.startAt);
    for (const t of tasks) if (t.dueAt != null && isVisible(t.calendarId)) bump(t.dueAt);

    const grid = el('div', 'planner-today__month-grid');
    for (let i = 0; i < 7; i++) {
      const dow = new Date(addLocalDays(gridStart, i)).toLocaleDateString(undefined, { weekday: 'narrow' });
      grid.appendChild(el('span', 'planner-today__dow', dow));
    }
    const today = startOfLocalDay(now);
    for (let i = 0; i < 42; i++) {
      const day = addLocalDays(gridStart, i);
      const d = new Date(day);
      const btn = el('button', 'planner-today__day');
      btn.type = 'button';
      if (d.getMonth() !== first.getMonth()) btn.classList.add('planner-today__day--out');
      if (day === today) btn.classList.add('planner-today__day--today');
      const count = load.get(day) ?? 0;
      btn.setAttribute('aria-label', `${dayFmt(day)}${count ? `, ${plural(count, 'item', 'items')}` : ''}`);
      btn.appendChild(el('span', 'planner-today__day-num', String(d.getDate())));
      const dots = el('span', 'planner-today__dots');
      for (let k = 0; k < Math.min(count, 3); k++) dots.appendChild(el('span', 'planner-today__dot'));
      btn.appendChild(dots);
      btn.addEventListener('click', () => this._deps.openDay(day));
      grid.appendChild(btn);
    }
    card.appendChild(grid);
    return card;
  }

  private async _repaintMonth(card: HTMLElement, now: number, isVisible: IsVisible): Promise<void> {
    const next = await this._month(now, isVisible);
    if (card.isConnected) card.replaceWith(next);
  }

  private _review(review: readonly PlannerTask[], now: number): HTMLElement {
    const card = el('section', 'planner-today__card planner-today__review');
    const head = el('div', 'planner-today__card-head');
    const title = el('h2', 'planner-today__card-title');
    title.append(createIconElement('inbox', 16), el('span', undefined, 'Review Queue'));
    head.append(title, el('span', 'planner-today__count', String(review.length)));
    card.append(head, el('p', 'planner-today__hint', 'Captured without a date. Pick a day for each.'));

    const options = quickPlanOptions(now);
    for (const task of review.slice(0, REVIEW_PREVIEW)) {
      const item = el('div', 'planner-today__review-item');
      const name = el('button', 'planner-today__task-title', task.title);
      name.type = 'button';
      name.addEventListener('click', () => this._deps.openTask(task, name.getBoundingClientRect()));
      item.append(name, el('span', 'planner-today__meta', `Captured ${dayFmt(task.createdAt)}`));
      const row = el('div', 'planner-today__plan');
      row.setAttribute('role', 'group');
      row.setAttribute('aria-label', `Plan “${task.title}”`);
      for (const opt of options) {
        createButton(row, {
          label: opt.label, size: 'sm', kind: 'secondary',
          title: `Plan for ${dayFmt(opt.dueAt)}`,
          onClick: () => {
            item.classList.add('planner-today__review-item--leaving');
            void this._deps.data.updateTask(task.id, { status: 'planned', dueAt: opt.dueAt });
            this._deps.note('planned', `task "${task.title}"`, task.id, `for ${dayFmt(opt.dueAt)}`);
          },
        });
      }
      item.appendChild(row);
      card.appendChild(item);
    }
    createButton(card, {
      label: review.length > REVIEW_PREVIEW ? `Open Review Queue (${review.length})` : 'Open Review Queue',
      icon: 'chevron-right', kind: 'ghost', size: 'sm',
      onClick: () => this._deps.openReviewQueue(),
    }).classList.add('planner-today__more');
    return card;
  }

  private _overdue(overdue: readonly PlannerTask[], dayStart: number): HTMLElement {
    const card = el('section', 'planner-today__card planner-today__overdue');
    const head = el('div', 'planner-today__card-head');
    const title = el('h2', 'planner-today__card-title');
    title.append(createIconElement('circle-alert', 16), el('span', undefined, 'Overdue'));
    head.append(title, el('span', 'planner-today__count', String(overdue.length)));
    card.appendChild(head);
    for (const task of overdue.slice(0, REVIEW_PREVIEW)) {
      const item = el('div', 'planner-today__overdue-item');
      const text = el('div', 'planner-today__overdue-text');
      const name = el('button', 'planner-today__task-title', task.title);
      name.type = 'button';
      name.addEventListener('click', () => this._deps.openTask(task, name.getBoundingClientRect()));
      text.append(name, el('span', 'planner-today__meta', `Due ${dayFmt(task.dueAt!)}`));
      item.appendChild(text);
      createButton(item, {
        label: 'Move to Today', size: 'sm', kind: 'secondary',
        onClick: () => {
          // Keep the time of day it had; only the date moves.
          const due = new Date(task.dueAt!);
          const moved = new Date(dayStart);
          moved.setHours(due.getHours(), due.getMinutes(), 0, 0);
          void this._deps.data.updateTask(task.id, { dueAt: moved.getTime() });
          this._deps.note('rescheduled', `task "${task.title}"`, task.id, 'to today');
        },
      });
      card.appendChild(item);
    }
    return card;
  }

  dispose(): void { /* nothing held beyond the DOM the pane replaces */ }
}
