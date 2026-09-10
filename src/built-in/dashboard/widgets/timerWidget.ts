// timerWidget.ts — an interval timer with a break cycle, tasks with
// estimates, and a log that becomes data (M86 C3).
//
// Domain-blind by design: a pomodoro is the 25/5/15 preset, not a feature.
// The shape follows what people know from pomofocus: three intervals as tabs
// (focus, short break, long break) with a colour each, a long break every
// fourth focus, auto-start options, an alarm that repeats, optional ticking,
// tasks with estimated intervals and a finish-time estimate, and the day's
// report (sessions, minutes, streak, the last seven days). Completed
// intervals append to a log in cached_output, so anything else can chart
// time per day without new storage. All arithmetic lives in timerLogic.ts.

import type { WidgetContext, WidgetHandle, WidgetTypeRegistration } from '../dashboardTypes.js';
import {
  readConfig, parseState, minutesFor, nextMode, finishEstimate, dayStreak, todaySummary, lastDays,
  fmtClock, fmtTimeOfDay, fmtHours, MAX_LOG, MAX_TASKS, mergePlannerItems, planTimeBudget, budgetRemaining, isTimerTask,
  type TimerConfig, type TimerMode, type TimerState, type TimerTask, type PlannerLinkItem,
} from './timerLogic.js';

// The planner's public registry, reached through its command so the two
// tools stay independent: the timer works without the planner installed.
interface PlannerTaskLike { readonly id: string; readonly title: string; readonly status: string; readonly dueAt: number | null }
interface PlannerDataLike {
  listTasks(query: { status?: readonly string[]; dueFrom?: number; dueTo?: number; includeUndated?: boolean }): Promise<PlannerTaskLike[]>;
  updateTask(id: string, patch: { status?: string; completedAt?: number | null }): Promise<unknown>;
}
async function plannerData(api: unknown): Promise<PlannerDataLike | null> {
  try {
    const cmds = (api as { commands?: { executeCommand<T>(id: string): Promise<T> } } | null)?.commands;
    if (!cmds?.executeCommand) return null;
    const reg = await cmds.executeCommand<{ data?: PlannerDataLike } | null>('planner.getRegistry');
    return reg?.data && typeof reg.data.listTasks === 'function' ? reg.data : null;
  } catch { return null; }
}
/** Tasks are offered explicitly, including overdue, future, and undated work. */
async function plannerTaskItems(data: PlannerDataLike): Promise<PlannerLinkItem[]> {
  const tasks = await data.listTasks({ status: ['planned', 'reviewing'], includeUndated: true });
  return tasks.filter((t) => t.status === 'planned' || t.status === 'reviewing')
    .map((t) => ({ id: t.id, title: t.title, minutes: null, kind: 'task' }));
}

const ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2"/><path d="M9 2h6"/><path d="M12 2v3"/></svg>';

const MODE_LABEL: Record<TimerMode, string> = { focus: 'Focus', short: 'Short Break', long: 'Long Break' };

function h(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function button(label: string, className: string, onClick: () => void, title?: string): HTMLButtonElement {
  const b = h('button', className) as HTMLButtonElement;
  b.type = 'button';
  b.textContent = label;
  if (title) b.title = title;
  b.addEventListener('click', onClick);
  return b;
}

// ── Sound, synthesised: no asset to ship, nothing to load ──
class Chime {
  private _ctx: AudioContext | null = null;
  private ctx(): AudioContext | null {
    try { if (!this._ctx) this._ctx = new AudioContext(); return this._ctx; } catch { return null; }
  }
  private tone(at: number, freq: number, dur: number, gain: number, type: OscillatorType): void {
    const c = this.ctx(); if (!c) return;
    const o = c.createOscillator(); const g = c.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain), at + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g); g.connect(c.destination);
    o.start(at); o.stop(at + dur + 0.02);
  }
  alarm(kind: TimerConfig['alarm'], repeat: number, volume: number): void {
    if (kind === 'none' || volume <= 0) return;
    const c = this.ctx(); if (!c) return;
    const v = volume / 100;
    let t = c.currentTime + 0.02;
    for (let r = 0; r < repeat; r++) {
      if (kind === 'bell') { this.tone(t, 880, 0.9, 0.5 * v, 'sine'); this.tone(t + 0.05, 1320, 0.6, 0.15 * v, 'sine'); this.tone(t + 0.9, 660, 0.9, 0.4 * v, 'sine'); t += 2.0; }
      else { for (let i = 0; i < 3; i++) this.tone(t + i * 0.22, 1000, 0.12, 0.35 * v, 'square'); t += 1.2; }
    }
  }
  tick(volume: number): void {
    if (volume <= 0) return;
    const c = this.ctx(); if (!c) return;
    this.tone(c.currentTime, 1800, 0.02, 0.05 * (volume / 100), 'square');
  }
}

export const TIMER_WIDGET: WidgetTypeRegistration<TimerConfig> = {
  typeId: 'parallx.dashboard.timer',
  displayName: 'Timer',
  description: 'Focus and break intervals with a long break every few rounds, tasks with estimated intervals and a finish time, an alarm, and a log of every completed session.',
  icon: ICON_SVG,
  category: 'static',
  chromeStyle: 'minimal',
  defaultSize: { colSpan: 4, rowSpan: 5 },
  sizeBounds: { minColSpan: 3, minRowSpan: 3 },
  defaultConfig: { ...readConfig(undefined) },
  configSchema: {
    fields: {
      focusMinutes: { type: 'number', label: 'Focus minutes', description: '1 to 240. The classic is 25.' },
      shortBreakMinutes: { type: 'number', label: 'Short break minutes', description: 'The classic is 5.' },
      longBreakMinutes: { type: 'number', label: 'Long break minutes', description: 'The classic is 15.' },
      longBreakInterval: { type: 'number', label: 'Long break after', description: 'How many focus intervals earn the long break. The classic is 4.' },
      autoStartBreaks: { type: 'boolean', label: 'Start breaks automatically' },
      autoStartFocus: { type: 'boolean', label: 'Start the next focus automatically' },
      alarm: { type: 'enum', label: 'Alarm', options: [{ value: 'bell', label: 'Bell' }, { value: 'digital', label: 'Digital' }, { value: 'none', label: 'None' }] },
      alarmRepeat: { type: 'number', label: 'Alarm repeats', description: '1 to 10.' },
      alarmVolume: { type: 'number', label: 'Volume', description: '0 to 100.' },
      ticking: { type: 'boolean', label: 'Ticking while running' },
      showTasks: { type: 'boolean', label: 'Show tasks' },
      plannerSync: { type: 'boolean', label: 'Planner button', description: 'Choose open Planner tasks to study. Calendar events are excluded.' },
      showReport: { type: 'boolean', label: 'Show the report row', description: "Today's minutes, the streak and seven small bars." },
      label: { type: 'string', label: 'Focus label', description: 'Logged with each completed focus interval.', placeholder: 'Focus' },
    },
  },

  createWidget(container: HTMLElement, ctx: WidgetContext<TimerConfig>): WidgetHandle {
    container.classList.add('dtimer');
    container.tabIndex = 0;
    let state: TimerState = parseState(ctx.cachedOutput);
    let cfg = readConfig(ctx.config);
    const chime = new Chime();
    let notified = false;

    // ── Skeleton ──
    const modes = h('div', 'dtimer__modes');
    modes.setAttribute('role', 'tablist');
    const modeBtns = new Map<TimerMode, HTMLButtonElement>();
    for (const m of ['focus', 'short', 'long'] as TimerMode[]) {
      const b = button(m === 'focus' ? cfg.label : MODE_LABEL[m], 'dtimer__mode', () => switchMode(m));
      b.setAttribute('role', 'tab');
      modeBtns.set(m, b);
      modes.appendChild(b);
    }
    // The top row: the interval tabs on the left, the small report on the right.
    const top = h('div', 'dtimer__top');
    top.appendChild(modes);
    container.appendChild(top);

    const face = h('div', 'dtimer__face');
    face.setAttribute('aria-live', 'off');
    container.appendChild(face);

    const controls = h('div', 'dtimer__controls');
    const startBtn = button('Start', 'dtimer__btn dtimer__btn--primary', () => toggle());
    const skipBtn = button('Skip', 'dtimer__btn dtimer__btn--quiet', () => advance(true, false), 'Finish this interval now. A finished focus counts.');
    const resetBtn = button('Reset', 'dtimer__btn dtimer__btn--quiet', () => reset(), 'Back to the start of this interval.');
    controls.append(startBtn, skipBtn, resetBtn);
    container.appendChild(controls);

    const caption = h('div', 'dtimer__caption');
    container.appendChild(caption);
    let editingBudgetId: string | null = null;
    const budgetBox = h('form', 'dtimer__budget') as HTMLFormElement;
    const budgetRow = h('div', 'dtimer__budgetrow');
    const budgetLabel = h('label', 'dtimer__budgetlabel', 'Total');
    const budgetInput = h('input', 'dtimer__input dtimer__input--budget') as HTMLInputElement;
    budgetInput.type = 'number'; budgetInput.min = '1'; budgetInput.max = '1440'; budgetInput.required = true;
    budgetInput.setAttribute('aria-label', 'Task time budget in minutes');
    budgetLabel.appendChild(budgetInput);
    const budgetSave = button('Set', 'dtimer__btn dtimer__btn--quiet', () => {});
    budgetSave.type = 'submit';
    const closeBudgetEditor = (): void => {
      const id = editingBudgetId;
      editingBudgetId = null;
      render();
      [...taskList.querySelectorAll<HTMLElement>('.dtimer__task')]
        .find((row) => row.dataset.taskId === id)?.querySelector<HTMLButtonElement>('.dtimer__taskcount')?.focus();
    };
    const budgetCancel = button('Cancel', 'dtimer__btn dtimer__btn--quiet', closeBudgetEditor);
    budgetRow.append(budgetLabel, h('span', '', 'min'), budgetSave, budgetCancel);
    const budgetPreview = h('div', 'dtimer__budgetpreview');
    const budgetNote = h('div', 'dtimer__budgetnote', 'Includes breaks. Pauses extend the finish time.');
    budgetBox.append(budgetRow, budgetPreview, budgetNote);
    container.appendChild(budgetBox);
    const previewBudget = (): void => {
      const plan = planTimeBudget(Number(budgetInput.value), cfg);
      const focus = plan.filter((s) => s.mode === 'focus');
      const focusMins = focus.reduce((sum, s) => sum + s.minutes, 0);
      const breakMins = plan.filter((s) => s.mode !== 'focus').reduce((sum, s) => sum + s.minutes, 0);
      budgetPreview.textContent = `${focus.length} focus ${focus.length === 1 ? 'session' : 'sessions'} · ${focusMins} min focus · ${breakMins} min breaks`;
    };
    budgetInput.addEventListener('input', previewBudget);
    budgetBox.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeBudgetEditor(); }
    });
    budgetBox.addEventListener('submit', (e) => {
      e.preventDefault();
      const task = activeTask();
      if (!task || running() || state.pausedRemaining !== null || !budgetBox.reportValidity()) return;
      task.budgetMinutes = Math.round(Number(budgetInput.value));
      task.spentMinutes ??= state.log.filter((s) => s.taskId === task.id).reduce((sum,s) => sum+s.minutes, 0);
      task.estEdited = true;
      state.cycle = 0; state.mode = 'focus';
      persist(); closeBudgetEditor();
    });

    const tasksBox = h('div', 'dtimer__tasks');
    const tasksHead = h('div', 'dtimer__taskshead');
    tasksHead.appendChild(h('span', 'dtimer__taskstitle', 'Tasks'));
    const tasksSummary = h('span', 'dtimer__taskssummary');
    tasksHead.appendChild(tasksSummary);
    const syncBtn = button('Choose tasks', 'dtimer__tasksmall dtimer__sync', () => { void openPlannerPicker(); }, 'Choose open tasks from Planner');
    tasksHead.appendChild(syncBtn);
    tasksBox.appendChild(tasksHead);
    const taskList = h('div', 'dtimer__tasklist');
    tasksBox.appendChild(taskList);
    const addRow = h('form', 'dtimer__add') as HTMLFormElement;
    const addInput = h('input', 'dtimer__input') as HTMLInputElement;
    addInput.type = 'text'; addInput.placeholder = 'What are you working on?'; addInput.maxLength = 120;
    addInput.setAttribute('aria-label', 'Task');
    const estInput = h('input', 'dtimer__input dtimer__input--est') as HTMLInputElement;
    estInput.type = 'number'; estInput.min = '1'; estInput.max = '1440'; estInput.value = '60';
    estInput.title = 'Total minutes, including breaks'; estInput.setAttribute('aria-label', 'New task time budget in minutes');
    const addBtn = button('Add', 'dtimer__btn dtimer__btn--quiet', () => {});
    addBtn.type = 'submit';
    addRow.append(addInput, estInput, h('span', 'dtimer__budgetnote', 'min'), addBtn);
    addRow.addEventListener('submit', (e) => {
      e.preventDefault();
      const title = addInput.value.trim();
      if (!title || queue().length >= MAX_TASKS) return;
      const task: TimerTask = { id: `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, title, est: 1, act: 0, done: false, createdAt: Date.now(), budgetMinutes: Math.max(1, Math.min(1440, parseInt(estInput.value, 10) || 60)), spentMinutes: 0 };
      state.tasks = [...state.tasks, task];
      if (!state.activeTaskId) { reset(); state.activeTaskId = task.id; state.mode = 'focus'; state.cycle = 0; }
      addInput.value = ''; estInput.value = '60';
      addRow.hidden = true; addGhost.hidden = false;
      persist(); render();
    });
    // The add control sits where a new task will appear: a quiet row at the
    // foot of the list. It becomes the input row when clicked; Escape or a
    // finished entry turns it back.
    addRow.hidden = true;
    addInput.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); addRow.hidden = true; addGhost.hidden = false; addGhost.focus(); } });
    tasksBox.appendChild(addRow);
    const addGhost = button('+ Add Task', 'dtimer__addghost', () => { addGhost.hidden = true; addRow.hidden = false; addInput.focus(); });
    tasksBox.appendChild(addGhost);
    container.appendChild(tasksBox);

    const report = h('div', 'dtimer__report');
    const stats = h('div', 'dtimer__stats');
    const week = h('div', 'dtimer__week');
    week.setAttribute('role', 'img');
    report.append(week, stats);
    top.appendChild(report);

    // ── State helpers ──
    // What we last wrote. The host echoes every cache write back through
    // refreshFromCache; replacing the state with a re-parse of our own write
    // would orphan the task objects a rename or an open menu is holding.
    let lastPersisted: string | null = null;
    const persist = (): void => { lastPersisted = JSON.stringify(state); ctx.setCachedOutput(lastPersisted); };
    const fullMs = (): number => state.intervalDurationMs ?? Math.min(minutesFor(state.mode, cfg), activeTask() ? (budgetRemaining(activeTask()!) ?? Infinity) : Infinity) * 60_000;
    const remainingMs = (): number => {
      if (state.endsAt !== null) return state.endsAt - Date.now();
      if (state.pausedRemaining !== null) return state.pausedRemaining;
      return fullMs();
    };
    const running = (): boolean => state.endsAt !== null;
    const activeTask = (): TimerTask | undefined => state.tasks.find((t) => t.id === state.activeTaskId && !t.done);
    const queue = (): TimerTask[] => state.tasks.filter(isTimerTask);
    const readyTask = (): TimerTask | undefined => queue().find((t) => !t.done && (budgetRemaining(t) ?? 1) > 0);
    // Keep old calendar imports stored for history, outside the task queue.
    // An interval already in progress is allowed to finish before switching.
    if (activeTask()?.sourceKind === 'event' && state.endsAt === null && state.pausedRemaining === null) state.activeTaskId = readyTask()?.id ?? null;

    // ── Planner link: nothing arrives unasked. Sync shows today's planner
    // items with a checkbox each; only the ones you tick join the list. ──
    let picker: HTMLElement | null = null;
    const closePicker = (): void => {
      if (picker) { picker.remove(); picker = null; }
      taskList.hidden = false; addGhost.hidden = false;
    };
    const openPlannerPicker = async (): Promise<void> => {
      if (!cfg.showTasks) return;
      if (picker) { closePicker(); return; }
      const data = await plannerData(ctx.api);
      if (!data) { syncBtn.textContent = 'No Planner'; setTimeout(() => { syncBtn.textContent = 'Choose tasks'; }, 1500); return; }
      let items: PlannerLinkItem[];
      try { items = await plannerTaskItems(data); }
      catch { syncBtn.textContent = 'Try again'; return; }
      const linked = new Set(state.tasks.map((t) => t.sourceId).filter((s): s is string => !!s));
      const box = h('div', 'dtimer__picker');
      const search = h('input', 'dtimer__input') as HTMLInputElement;
      search.type = 'search'; search.placeholder = 'Find a Planner task'; search.setAttribute('aria-label', 'Find a Planner task');
      box.appendChild(search);
      const noMatch = h('div', 'dtimer__pickerempty', 'No matching tasks.'); noMatch.hidden = true;
      if (items.length === 0) box.appendChild(h('div', 'dtimer__pickerempty', 'No open tasks in Planner.'));
      const choices: { item: PlannerLinkItem; input: HTMLInputElement }[] = [];
      for (const it of items) {
        const row = h('label', 'dtimer__pickrow');
        const input = h('input') as HTMLInputElement;
        input.type = 'checkbox';
        const already = linked.has(it.id);
        input.checked = already; input.disabled = already;
        row.appendChild(input);
        row.appendChild(h('span', 'dtimer__pickname', it.title));
        row.dataset.title = it.title.toLocaleLowerCase();
        row.appendChild(h('span', 'dtimer__pickmeta', already ? 'Added' : '60 min · editable'));
        box.appendChild(row);
        if (!already) choices.push({ item: it, input });
      }
      box.appendChild(noMatch);
      search.addEventListener('input', () => {
        let visible = 0;
        for (const row of box.querySelectorAll<HTMLElement>('.dtimer__pickrow')) {
          row.hidden = !row.dataset.title!.includes(search.value.trim().toLocaleLowerCase());
          if (!row.hidden) visible++;
        }
        noMatch.hidden = !search.value.trim() || visible > 0;
      });
      const foot = h('div', 'dtimer__pickfoot');
      const addSelected = async (): Promise<void> => {
        const chosen = new Set(choices.filter((c) => c.input.checked).map((c) => c.item.id));
        if (chosen.size > 0) {
          // Linked tasks stay linked; only the ticked ones are new. A linked
          // planner task is finished here only when the planner no longer
          // lists it open anywhere, never because it fell outside today's
          // window; with no answer from the planner, nothing is assumed.
          const keep = items.filter((i) => linked.has(i.id) || chosen.has(i.id));
          const open = await data.listTasks({ status: ['planned', 'reviewing'], includeUndated: true })
            .then((ts) => new Set(ts.map((t) => t.id))).catch(() => null);
          state.tasks = mergePlannerItems(state.tasks, keep, cfg.focusMinutes, [], Date.now(), open);
          for (const task of state.tasks) if (task.sourceId && chosen.has(task.sourceId) && !linked.has(task.sourceId)) { task.budgetMinutes = 60; task.spentMinutes = 0; }
          if (!state.activeTaskId || !state.tasks.some((t) => t.id === state.activeTaskId && !t.done)) { reset(); state.activeTaskId = readyTask()?.id ?? null; state.mode = 'focus'; state.cycle = 0; }
          persist();
        }
        closePicker(); render();
      };
      foot.appendChild(button('Add Selected', 'dtimer__btn dtimer__btn--primary', () => { void addSelected(); }));
      foot.appendChild(button('Cancel', 'dtimer__btn dtimer__btn--quiet', () => closePicker()));
      box.appendChild(foot);
      taskList.hidden = true; addRow.hidden = true; addGhost.hidden = true;
      tasksBox.insertBefore(box, addRow);
      picker = box;
      search.focus();
    };
    /** Finishing a linked planner task here finishes it there too; events are only read. */
    const writeBackDone = (t: TimerTask): void => {
      if (!t.sourceId || t.sourceKind !== 'task') return;
      void plannerData(ctx.api).then((data) => data?.updateTask(t.sourceId!, t.done ? { status: 'done', completedAt: Date.now() } : { status: 'planned', completedAt: null })).catch(() => {});
    };

    let tick: ReturnType<typeof setInterval> | null = null;
    let lastTickSecond = -1;
    const stopTick = (): void => { if (tick) { clearInterval(tick); tick = null; } };
    const startTick = (): void => {
      stopTick();
      tick = setInterval(() => {
        if (state.endsAt !== null && state.endsAt - Date.now() <= 0) { advance(true, true); return; }
        if (cfg.ticking && state.endsAt !== null) {
          const sec = Math.floor((state.endsAt - Date.now()) / 1000);
          if (sec !== lastTickSecond) { lastTickSecond = sec; chime.tick(cfg.alarmVolume); }
        }
        // The clock only. A full render here rebuilt the task list four times
        // a second, which wiped a rename in progress while the timer ran.
        renderClock();
      }, 250);
    };

    const start = (): void => {
      const rem = state.pausedRemaining ?? fullMs();
      if (rem <= 0) return;
      editingBudgetId = null;
      state.intervalDurationMs ??= fullMs();
      state.endsAt = Date.now() + rem;
      state.pausedRemaining = null;
      startTick();
      persist(); render();
    };
    const pause = (): void => {
      if (state.endsAt === null) return;
      state.pausedRemaining = Math.max(0, state.endsAt - Date.now());
      state.endsAt = null;
      stopTick();
      persist(); render();
    };
    const toggle = (): void => {
      if (!notified) {
        notified = true;
        try { if (typeof Notification !== 'undefined' && Notification.permission === 'default') void Notification.requestPermission(); } catch { /* not available */ }
      }
      if (running()) pause(); else start();
    };
    const reset = (): void => {
      recordElapsed(false);
      state.endsAt = null; state.pausedRemaining = null;
      state.intervalDurationMs = undefined;
      stopTick();
      persist(); render();
    };
    const switchMode = (m: TimerMode): void => {
      if (m === state.mode && !running() && state.pausedRemaining === null) return;
      recordElapsed(false);
      state.mode = m; state.endsAt = null; state.pausedRemaining = null;
      state.intervalDurationMs = undefined;
      stopTick();
      persist(); render();
    };

    const selectTask = (task: TimerTask): void => {
      if (task.done || task.id === state.activeTaskId) return;
      editingBudgetId = null;
      reset();
      state.activeTaskId = task.id; state.mode = 'focus'; state.cycle = 0;
      persist(); render();
    };
    const markTask = (task: TimerTask): void => {
      if (task.id === state.activeTaskId) reset();
      task.done = !task.done;
      if (task.done && task.id === state.activeTaskId) state.activeTaskId = readyTask()?.id ?? null;
      writeBackDone(task); persist(); render();
    };
    /** Credit elapsed timer time once, including partial intervals and breaks. */
    const recordElapsed = (completed: boolean): void => {
      if (state.endsAt === null && state.pausedRemaining === null) return;
      const elapsed = Math.max(0, fullMs() - Math.max(0, remainingMs()));
      const minutes = elapsed / 60_000;
      if (minutes <= 0) return;
      const task = activeTask();
      if (task?.budgetMinutes !== undefined) task.spentMinutes = Math.min(task.budgetMinutes, (task.spentMinutes ?? 0) + minutes);
      if (task && completed && state.mode === 'focus') task.act++;
      const endedAt = state.endsAt !== null ? Math.min(state.endsAt, Date.now()) : Date.now();
      state.log = [...state.log, { startedAt: endedAt - elapsed, minutes, label: state.mode === 'focus' ? cfg.label : MODE_LABEL[state.mode], mode: state.mode, taskId: task?.id }].slice(-MAX_LOG);
    };

    /**
     * The interval is over: log it (a focus, with what it was worth), credit
     * the active task, move to what comes next and start it if the settings
     * say so. `ring` is false when the end happened while the app was closed.
     */
    const advance = (finished: boolean, ring: boolean): void => {
      const wasFocus = state.mode === 'focus';
      stopTick();
      recordElapsed(finished);
      const budgetReached = activeTask() !== undefined && budgetRemaining(activeTask()!) === 0;
      const calendarFinished = activeTask()?.sourceKind === 'event';
      const nx = wasFocus && finished ? nextMode('focus', state.cycle, cfg.longBreakInterval) : nextMode(state.mode, state.cycle, cfg.longBreakInterval);
      state.mode = nx.mode; state.cycle = nx.cycle;
      state.endsAt = null; state.pausedRemaining = null;
      state.intervalDurationMs = undefined;
      if (budgetReached) state.mode = 'focus';
      if (calendarFinished) { state.activeTaskId = readyTask()?.id ?? null; state.mode = 'focus'; state.cycle = 0; }
      if (ring) {
        chime.alarm(cfg.alarm, cfg.alarmRepeat, cfg.alarmVolume);
        try {
          if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && (document.hidden || !document.hasFocus())) {
            new Notification(budgetReached ? 'Task time budget reached' : wasFocus ? `${cfg.label} done` : 'Break over', { body: budgetReached ? 'Review the task or increase its time budget to continue.' : wasFocus ? `Time for a ${MODE_LABEL[state.mode].toLowerCase()}.` : `Time to ${cfg.label.toLowerCase()}.`, silent: true });
          }
        } catch { /* notifications unavailable */ }
        const auto = state.mode === 'focus' ? cfg.autoStartFocus : cfg.autoStartBreaks;
        if (auto && !budgetReached && !calendarFinished) { state.intervalDurationMs = fullMs(); state.endsAt = Date.now() + fullMs(); startTick(); }
      }
      persist(); render();
    };

    // ── Rendering ──
    // The parts that move with the clock: the face, the buttons, the finish
    // time in the task summary. The tick calls this alone.
    const renderClock = (): void => {
      container.dataset.running = running() ? 'true' : 'false';
      face.textContent = fmtClock(remainingMs());
      startBtn.textContent = running() ? 'Pause' : (state.pausedRemaining !== null ? 'Resume' : 'Start');
      startBtn.disabled = !running() && fullMs() <= 0;
      skipBtn.hidden = !running() && state.pausedRemaining === null;
      resetBtn.hidden = !running() && state.pausedRemaining === null;
      // Update the active task's counter without rebuilding an in-progress edit.
      for (const row of taskList.querySelectorAll<HTMLElement>('.dtimer__task')) {
        const task = state.tasks.find((t) => t.id === row.dataset.taskId);
        if (task?.budgetMinutes === undefined) continue;
        const elapsed = task.id === state.activeTaskId && (running() || state.pausedRemaining !== null) ? Math.max(0, fullMs() - Math.max(0, remainingMs())) / 60_000 : 0;
        row.querySelector('.dtimer__taskcount')!.textContent = `${Math.floor((task.spentMinutes ?? 0) + elapsed)}/${task.budgetMinutes} min`;
      }
      renderSummary();
    };
    const render = (): void => {
      container.dataset.mode = state.mode;
      for (const [m, b] of modeBtns) {
        b.textContent = m === 'focus' ? cfg.label : MODE_LABEL[m];
        b.setAttribute('aria-selected', m === state.mode ? 'true' : 'false');
        b.classList.toggle('is-active', m === state.mode);
      }
      renderClock();
      const today = todaySummary(state.log, Date.now());
      const task = activeTask();
      caption.textContent = task && budgetRemaining(task) === 0 ? `Time budget reached · ${task.title}` : state.mode === 'focus'
        ? (task ? task.title : `Time to ${cfg.label.toLowerCase()}`)
        : 'Time for a break';
      if (editingBudgetId !== task?.id) editingBudgetId = null;
      budgetBox.hidden = !editingBudgetId || !task || !isTimerTask(task) || !cfg.showTasks;
      budgetInput.value = String(task?.budgetMinutes ?? 60);
      budgetInput.disabled = budgetSave.disabled = running() || state.pausedRemaining !== null;
      budgetNote.textContent = budgetInput.disabled ? 'Reset the current interval to edit its budget.' : 'Includes breaks. Pauses extend the finish time.';
      previewBudget();
      tasksBox.hidden = !cfg.showTasks;
      syncBtn.hidden = !cfg.plannerSync;
      renderTasks();
      // The report stays short: a figure or two, the sentence in the tooltip.
      report.hidden = !cfg.showReport;
      const streak = dayStreak(state.log, Date.now());
      stats.textContent = today.sessions === 0 ? (streak > 0 ? `${streak}d` : '') : `${fmtHours(today.minutes)}${streak > 1 ? ` · ${streak}d` : ''}`;
      report.title = today.sessions === 0
        ? (streak > 0 ? `Nothing yet today. ${streak} day streak.` : 'Nothing yet today.')
        : `${today.sessions} ${today.sessions === 1 ? 'session' : 'sessions'}, ${Math.round(today.minutes)} minutes today${streak > 1 ? `, ${streak} day streak` : ''}.`;
      week.replaceChildren();
      const days = lastDays(state.log, Date.now(), 7);
      const max = Math.max(1, ...days.map((d) => d.minutes));
      week.setAttribute('aria-label', `Last seven days: ${days.map((d) => `${d.minutes} minutes`).join(', ')}`);
      for (const d of days) {
        const col = h('span', 'dtimer__daybar');
        const fill = h('span');
        fill.style.height = `${Math.max(d.minutes > 0 ? 8 : 0, Math.round((d.minutes / max) * 100))}%`;
        col.appendChild(fill);
        col.title = `${d.day}: ${d.minutes} min`;
        week.appendChild(col);
      }
    };

    // Rename in place: Enter keeps, Escape drops, leaving keeps.
    const startRename = (row: HTMLElement, title: HTMLElement, t: TimerTask): void => {
      const input = h('input', 'dtimer__input dtimer__taskedit') as HTMLInputElement;
      input.type = 'text'; input.value = t.title; input.maxLength = 120;
      // Settles once: Enter and Escape both remove the input, and a browser
      // that fires blur on removal must not turn an Escape into a keep. The
      // task is looked up again in case the state was replaced meanwhile.
      let settled = false;
      const finish = (keep: boolean) => {
        if (settled) return; settled = true;
        const cur = state.tasks.find((x) => x.id === t.id) ?? t;
        if (keep && input.value.trim()) cur.title = input.value.trim();
        persist(); renderTasks();
      };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') { e.preventDefault(); finish(false); } });
      input.addEventListener('blur', () => finish(true));
      row.replaceChild(input, title); input.focus(); input.select();
    };
    // The workbench's own context menu, through api.ui (not api.window, where
    // this first looked and found nothing, so right-click did nothing at all).
    // A host without it (a probe) shows nothing.
    type MenuItem = { label?: string; danger?: boolean; disabled?: boolean; separator?: boolean; onSelect?: () => void };
    const showMenu = (x: number, y: number, items: MenuItem[]): void => {
      const ui = (ctx.api as { ui?: { showContextMenu?: (anchor: { x: number; y: number }, items: MenuItem[]) => unknown } } | null)?.ui;
      if (ui?.showContextMenu) ui.showContextMenu({ x, y }, items);
    };

    const openBudgetEditor = (task: TimerTask): void => {
      selectTask(task);
      editingBudgetId = task.id;
      render();
      if (budgetInput.disabled) budgetCancel.focus();
      else { budgetInput.focus(); budgetInput.select(); }
    };
    const renderTasks = (): void => {
      if (!cfg.showTasks) return;
      taskList.replaceChildren();
      for (const t of queue()) {
        const row = h('div', 'dtimer__task');
        row.dataset.taskId = t.id;
        row.dataset.active = t.id === state.activeTaskId ? 'true' : 'false';
        row.dataset.done = t.done ? 'true' : 'false';
        row.dataset.linked = t.sourceId ? 'true' : 'false';
        const check = button('', 'dtimer__check', () => markTask(t), t.done ? 'Mark not done' : 'Mark done');
        check.setAttribute('aria-pressed', t.done ? 'true' : 'false');
        row.appendChild(check);
        const title = button(t.title, 'dtimer__tasktitle', () => selectTask(t), t.sourceId ? 'From Planner. Click to make active; right-click for more.' : 'Click to make active; right-click for more.');
        title.addEventListener('dblclick', () => startRename(row, title, t));
        row.appendChild(title);
        // The count closes the row at the far right; everything else about a task is a right-click away.
        const count = button(t.budgetMinutes === undefined ? 'Set time' : `${Math.floor(t.spentMinutes ?? 0)}/${t.budgetMinutes} min`, 'dtimer__taskcount', () => openBudgetEditor(t), 'Set total time, including breaks');
        count.setAttribute('aria-label', `Time budget for ${t.title}`);
        count.setAttribute('aria-expanded', String(editingBudgetId === t.id));
        count.disabled = t.done;
        row.appendChild(count);
        row.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          // Nothing arrives unasked, so a removed planner item simply leaves;
          // Sync offers it again, unticked. (The old "ignored for today" list
          // is no longer written; it was never read once the picker arrived.)
          const remove = () => {
            if (state.activeTaskId === t.id) reset();
            state.tasks = state.tasks.filter((x) => x.id !== t.id);
            if (state.activeTaskId === t.id) state.activeTaskId = readyTask()?.id ?? null;
            persist(); render();
          };
          showMenu(e.clientX, e.clientY, [
            { label: 'Make Active', disabled: t.done || state.activeTaskId === t.id, onSelect: () => selectTask(t) },
            { label: 'Rename', onSelect: () => startRename(row, title, t) },
            { separator: true },
            { label: 'Set Time Budget', disabled: t.done, onSelect: () => openBudgetEditor(t) },
            { separator: true },
            { label: t.done ? 'Mark Not Done' : 'Mark Done', onSelect: () => markTask(t) },
            { label: 'Remove', danger: true, onSelect: remove },
          ]);
        });
        taskList.appendChild(row);
      }
      renderSummary();
    };
    const renderSummary = (): void => {
      if (!cfg.showTasks) return;
      const now = Date.now();
      const task = activeTask();
      const budget = task ? budgetRemaining(task) : null;
      if (budget !== null) {
        const elapsed = (running() || state.pausedRemaining !== null) ? Math.max(0, fullMs() - Math.max(0, remainingMs())) : 0;
        const left = Math.max(0, budget * 60_000 - elapsed);
        tasksSummary.textContent = left <= 0 ? 'Budget reached' : `${fmtHours(Math.ceil(left / 60_000))} left`;
        tasksSummary.title = left <= 0 ? '' : `${running() ? 'Finish' : 'If started now'} ${fmtTimeOfDay(now + left)}. Includes breaks; pauses extend the finish time.`;
      } else {
        const fin = finishEstimate(queue(), cfg, state.mode, state.cycle, remainingMs(), now);
        tasksSummary.textContent = fin ? `Finish ${fmtTimeOfDay(fin.at)}` : '';
        tasksSummary.title = '';
      }
    };

    // Space or Enter on the widget itself starts and pauses.
    container.addEventListener('keydown', (e) => {
      if (e.target !== container) return;
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(); }
    });

    // A timer that was running when the page closed resumes (endsAt is
    // absolute); one that ended while closed is logged now, without the alarm.
    if (state.endsAt !== null) {
      if (state.endsAt - Date.now() <= 0) advance(true, false);
      else startTick();
    }
    render();

    const sub = ctx.onDidChangeConfig((next) => {
      cfg = readConfig(next);
      render();
    });

    return {
      refreshFromCache(cached: string | null) {
        if (cached !== null && cached === lastPersisted) return; // our own write, echoed back
        const next = parseState(cached);
        // Keep the live clock if this instance is the one running it.
        if (state.endsAt !== null && next.endsAt === state.endsAt) next.endsAt = state.endsAt;
        state = next;
        if (state.endsAt !== null && !tick) startTick();
        render();
      },
      dispose() {
        stopTick();
        sub.dispose();
      },
    };
  },
};
