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
  fmtClock, fmtTimeOfDay, fmtHours, MAX_LOG, MAX_TASKS, dayKeyLocal, mergePlannerItems,
  type TimerConfig, type TimerMode, type TimerState, type TimerTask, type PlannerLinkItem,
} from './timerLogic.js';

// The planner's public registry, reached through its command so the two
// tools stay independent: the timer works without the planner installed.
interface PlannerTaskLike { readonly id: string; readonly title: string; readonly status: string; readonly dueAt: number | null }
interface PlannerEventLike { readonly id: string; readonly title: string; readonly startAt: number; readonly endAt: number; readonly allDay: boolean }
interface PlannerDataLike {
  listTasks(query: { status?: readonly string[]; dueFrom?: number; dueTo?: number }): Promise<PlannerTaskLike[]>;
  listEvents(query: { from: number; to: number }): Promise<PlannerEventLike[]>;
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
/** Today's open planner tasks and timed events, as things to work on. */
async function plannerItemsForToday(data: PlannerDataLike, now: number): Promise<PlannerLinkItem[]> {
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const end = new Date(start.getTime()); end.setDate(end.getDate() + 1);
  const [tasks, events] = await Promise.all([
    data.listTasks({ status: ['planned', 'reviewing'], dueFrom: start.getTime(), dueTo: end.getTime() - 1 }).catch(() => [] as PlannerTaskLike[]),
    data.listEvents({ from: start.getTime(), to: end.getTime() - 1 }).catch(() => [] as PlannerEventLike[]),
  ]);
  // Timed blocks first, in the order of the day; loose tasks after them.
  const out: PlannerLinkItem[] = [];
  for (const e of [...events].sort((a, b) => a.startAt - b.startAt)) {
    if (e.allDay) continue;
    out.push({ id: e.id, title: e.title, minutes: Math.round((e.endAt - e.startAt) / 60_000), kind: 'event' });
  }
  for (const t of tasks) out.push({ id: t.id, title: t.title, minutes: null, kind: 'task' });
  return out;
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
      plannerSync: { type: 'boolean', label: 'Pull today from the planner', description: "Today's open tasks and timed events join the list; a planned block becomes as many intervals as it holds." },
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
    container.appendChild(modes);

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

    const tasksBox = h('div', 'dtimer__tasks');
    const tasksHead = h('div', 'dtimer__taskshead');
    tasksHead.appendChild(h('span', 'dtimer__taskstitle', 'Tasks'));
    const tasksSummary = h('span', 'dtimer__taskssummary');
    tasksHead.appendChild(tasksSummary);
    const syncBtn = button('Sync', 'dtimer__tasksmall dtimer__sync', () => { void syncPlanner(true); }, "Pull today's planner tasks and events into the list");
    tasksHead.appendChild(syncBtn);
    tasksBox.appendChild(tasksHead);
    const taskList = h('div', 'dtimer__tasklist');
    tasksBox.appendChild(taskList);
    const addRow = h('form', 'dtimer__add') as HTMLFormElement;
    const addInput = h('input', 'dtimer__input') as HTMLInputElement;
    addInput.type = 'text'; addInput.placeholder = 'What are you working on?'; addInput.maxLength = 120;
    addInput.setAttribute('aria-label', 'Task');
    const estInput = h('input', 'dtimer__input dtimer__input--est') as HTMLInputElement;
    estInput.type = 'number'; estInput.min = '1'; estInput.max = '99'; estInput.value = '1';
    estInput.title = 'Estimated intervals'; estInput.setAttribute('aria-label', 'Estimated intervals');
    const addBtn = button('Add', 'dtimer__btn dtimer__btn--quiet', () => {});
    addBtn.type = 'submit';
    addRow.append(addInput, estInput, addBtn);
    addRow.addEventListener('submit', (e) => {
      e.preventDefault();
      const title = addInput.value.trim();
      if (!title || state.tasks.length >= MAX_TASKS) return;
      const task: TimerTask = { id: `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, title, est: Math.max(1, Math.min(99, parseInt(estInput.value, 10) || 1)), act: 0, done: false, createdAt: Date.now() };
      state.tasks = [...state.tasks, task];
      if (!state.activeTaskId) state.activeTaskId = task.id;
      addInput.value = ''; estInput.value = '1';
      persist(); renderTasks(); addInput.focus();
    });
    tasksBox.appendChild(addRow);
    container.appendChild(tasksBox);

    const report = h('div', 'dtimer__report');
    const stats = h('div', 'dtimer__stats');
    const week = h('div', 'dtimer__week');
    week.setAttribute('role', 'img');
    report.append(stats, week);
    container.appendChild(report);

    // ── State helpers ──
    const persist = (): void => { ctx.setCachedOutput(JSON.stringify(state)); };
    const fullMs = (): number => minutesFor(state.mode, cfg) * 60_000;
    const remainingMs = (): number => {
      if (state.endsAt !== null) return state.endsAt - Date.now();
      if (state.pausedRemaining !== null) return state.pausedRemaining;
      return fullMs();
    };
    const running = (): boolean => state.endsAt !== null;
    const activeTask = (): TimerTask | undefined => state.tasks.find((t) => t.id === state.activeTaskId && !t.done);

    // ── Planner link ──
    let syncing = false;
    const syncPlanner = async (byHand: boolean): Promise<void> => {
      if (syncing || !cfg.showTasks) return;
      const today = dayKeyLocal(Date.now());
      if (state.syncDay !== today) { state.ignoredSourceIds = []; state.syncDay = today; }
      const data = await plannerData(ctx.api);
      if (!data) { if (byHand) { syncBtn.textContent = 'No Planner'; setTimeout(() => { syncBtn.textContent = 'Sync'; }, 1500); } return; }
      syncing = true; syncBtn.disabled = true;
      try {
        const items = await plannerItemsForToday(data, Date.now());
        state.tasks = mergePlannerItems(state.tasks, items, cfg.focusMinutes, state.ignoredSourceIds, Date.now());
        if (!state.activeTaskId || !state.tasks.some((t) => t.id === state.activeTaskId && !t.done)) state.activeTaskId = state.tasks.find((t) => !t.done)?.id ?? null;
        persist(); render();
      } finally { syncing = false; syncBtn.disabled = false; }
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
        render();
      }, 250);
    };

    const start = (): void => {
      const rem = state.pausedRemaining ?? fullMs();
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
      state.endsAt = null; state.pausedRemaining = null;
      stopTick();
      persist(); render();
    };
    const switchMode = (m: TimerMode): void => {
      if (m === state.mode && !running() && state.pausedRemaining === null) return;
      state.mode = m; state.endsAt = null; state.pausedRemaining = null;
      stopTick();
      persist(); render();
    };

    /**
     * The interval is over: log it (a focus, with what it was worth), credit
     * the active task, move to what comes next and start it if the settings
     * say so. `ring` is false when the end happened while the app was closed.
     */
    const advance = (finished: boolean, ring: boolean): void => {
      const wasFocus = state.mode === 'focus';
      const endedAt = state.endsAt ?? Date.now();
      const spentMs = fullMs() - Math.max(0, remainingMs());
      stopTick();
      if (finished && wasFocus) {
        const minutes = state.endsAt !== null && state.endsAt <= Date.now() ? minutesFor('focus', cfg) : Math.max(0, Math.round(spentMs / 60_000));
        if (minutes > 0) {
          const task = activeTask();
          state.log = [...state.log, { startedAt: endedAt - minutes * 60_000, minutes, label: cfg.label, mode: 'focus' as const, taskId: task?.id }].slice(-MAX_LOG);
          if (task) task.act += 1;
        }
      } else if (finished && state.endsAt !== null && state.endsAt <= Date.now()) {
        state.log = [...state.log, { startedAt: endedAt - fullMs(), minutes: minutesFor(state.mode, cfg), label: MODE_LABEL[state.mode], mode: state.mode }].slice(-MAX_LOG);
      }
      const nx = wasFocus && finished ? nextMode('focus', state.cycle, cfg.longBreakInterval) : nextMode(state.mode, state.cycle, cfg.longBreakInterval);
      state.mode = nx.mode; state.cycle = nx.cycle;
      state.endsAt = null; state.pausedRemaining = null;
      if (ring) {
        chime.alarm(cfg.alarm, cfg.alarmRepeat, cfg.alarmVolume);
        try {
          if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && (document.hidden || !document.hasFocus())) {
            new Notification(wasFocus ? `${cfg.label} done` : 'Break over', { body: wasFocus ? `Time for a ${MODE_LABEL[state.mode].toLowerCase()}.` : `Time to ${cfg.label.toLowerCase()}.`, silent: true });
          }
        } catch { /* notifications unavailable */ }
        const auto = state.mode === 'focus' ? cfg.autoStartFocus : cfg.autoStartBreaks;
        if (auto) { state.endsAt = Date.now() + fullMs(); startTick(); }
      }
      persist(); render();
    };

    // ── Rendering ──
    const render = (): void => {
      container.dataset.mode = state.mode;
      container.dataset.running = running() ? 'true' : 'false';
      for (const [m, b] of modeBtns) {
        b.textContent = m === 'focus' ? cfg.label : MODE_LABEL[m];
        b.setAttribute('aria-selected', m === state.mode ? 'true' : 'false');
        b.classList.toggle('is-active', m === state.mode);
      }
      face.textContent = fmtClock(remainingMs());
      startBtn.textContent = running() ? 'Pause' : (state.pausedRemaining !== null ? 'Resume' : 'Start');
      skipBtn.hidden = !running() && state.pausedRemaining === null;
      resetBtn.hidden = !running() && state.pausedRemaining === null;
      const today = todaySummary(state.log, Date.now());
      const n = today.sessions + (state.mode === 'focus' ? 1 : 0);
      const task = activeTask();
      caption.textContent = state.mode === 'focus'
        ? `#${n} · ${task ? task.title : `Time to ${cfg.label.toLowerCase()}`}`
        : `#${today.sessions} · Time for a break`;
      tasksBox.hidden = !cfg.showTasks;
      renderTasks();
      // The report stays short: a figure or two, the sentence in the tooltip.
      report.hidden = !cfg.showReport;
      const streak = dayStreak(state.log, Date.now());
      stats.textContent = today.sessions === 0 ? (streak > 0 ? `${streak}d` : '') : `${fmtHours(today.minutes)}${streak > 1 ? ` · ${streak}d` : ''}`;
      report.title = today.sessions === 0
        ? (streak > 0 ? `Nothing yet today. ${streak} day streak.` : 'Nothing yet today.')
        : `${today.sessions} ${today.sessions === 1 ? 'session' : 'sessions'}, ${today.minutes} minutes today${streak > 1 ? `, ${streak} day streak` : ''}.`;
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

    const renderTasks = (): void => {
      if (!cfg.showTasks) return;
      taskList.replaceChildren();
      const now = Date.now();
      for (const t of state.tasks) {
        const row = h('div', 'dtimer__task');
        row.dataset.active = t.id === state.activeTaskId ? 'true' : 'false';
        row.dataset.done = t.done ? 'true' : 'false';
        row.dataset.linked = t.sourceId ? 'true' : 'false';
        const check = button('', 'dtimer__check', () => { t.done = !t.done; if (t.done && state.activeTaskId === t.id) state.activeTaskId = state.tasks.find((x) => !x.done)?.id ?? null; writeBackDone(t); persist(); render(); }, t.done ? 'Mark not done' : 'Mark done');
        check.setAttribute('aria-pressed', t.done ? 'true' : 'false');
        row.appendChild(check);
        const title = button(t.title, 'dtimer__tasktitle', () => { if (!t.done) { state.activeTaskId = t.id; persist(); render(); } }, t.sourceId ? `From the planner (${t.sourceKind}). Click to make active, double-click to rename.` : 'Click to make active, double-click to rename');
        // Double-click renames in place: Enter keeps, Escape drops.
        title.addEventListener('dblclick', () => {
          const input = h('input', 'dtimer__input dtimer__taskedit') as HTMLInputElement;
          input.type = 'text'; input.value = t.title; input.maxLength = 120;
          const finish = (keep: boolean) => { if (keep && input.value.trim()) t.title = input.value.trim(); persist(); renderTasks(); };
          input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') { e.preventDefault(); finish(false); } });
          input.addEventListener('blur', () => finish(true));
          row.replaceChild(input, title); input.focus(); input.select();
        });
        row.appendChild(title);
        const count = h('span', 'dtimer__taskcount', `${t.act}/${t.est}`);
        count.title = t.sourceKind === 'event' ? `Finished intervals / the planned block at ${cfg.focusMinutes} minutes a round` : 'Finished intervals / estimated';
        row.appendChild(count);
        const less = button('−', 'dtimer__tasksmall', () => { t.est = Math.max(1, t.est - 1); t.estEdited = true; persist(); renderTasks(); }, 'One interval fewer');
        row.appendChild(less);
        const more = button('+', 'dtimer__tasksmall', () => { t.est = Math.min(99, t.est + 1); t.estEdited = true; persist(); renderTasks(); }, 'One more interval');
        row.appendChild(more);
        const del = button('×', 'dtimer__tasksmall', () => {
          state.tasks = state.tasks.filter((x) => x.id !== t.id);
          // A removed planner item stays out for the rest of the day.
          if (t.sourceId) { const today = dayKeyLocal(Date.now()); if (state.syncDay !== today) { state.ignoredSourceIds = []; state.syncDay = today; } if (!state.ignoredSourceIds.includes(t.sourceId)) state.ignoredSourceIds = [...state.ignoredSourceIds, t.sourceId]; }
          if (state.activeTaskId === t.id) state.activeTaskId = state.tasks.find((x) => !x.done)?.id ?? null;
          persist(); render();
        }, t.sourceId ? 'Remove from the list for today. The planner keeps it.' : 'Remove task');
        row.appendChild(del);
        taskList.appendChild(row);
      }
      const act = state.tasks.reduce((s, t) => s + t.act, 0);
      const est = state.tasks.reduce((s, t) => s + t.est, 0);
      const fin = finishEstimate(state.tasks, cfg, state.mode, state.cycle, remainingMs(), now);
      tasksSummary.textContent = state.tasks.length === 0 ? '' : fin
        ? `${act}/${est} · Finish at ${fmtTimeOfDay(fin.at)} (${fmtHours(fin.minutes)})`
        : `${act}/${est} · All done`;
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
    // Once a day, the planner's day joins the list on its own; Sync does it again on demand.
    if (cfg.plannerSync && cfg.showTasks && state.syncDay !== dayKeyLocal(Date.now())) void syncPlanner(false);

    const sub = ctx.onDidChangeConfig((next) => {
      const before = cfg;
      cfg = readConfig(next);
      if (cfg.plannerSync && cfg.showTasks && (!before.plannerSync || !before.showTasks)) void syncPlanner(false);
      render();
    });

    return {
      refreshFromCache(cached: string | null) {
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
