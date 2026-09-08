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
  fmtClock, fmtTimeOfDay, fmtHours, MAX_LOG, MAX_TASKS,
  type TimerConfig, type TimerMode, type TimerState, type TimerTask,
} from './timerLogic.js';

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
      const streak = dayStreak(state.log, Date.now());
      stats.textContent = today.sessions === 0
        ? (streak > 0 ? `No ${cfg.label.toLowerCase()} yet today · ${streak} day streak` : `No ${cfg.label.toLowerCase()} yet today`)
        : `${today.sessions} ${today.sessions === 1 ? 'session' : 'sessions'} · ${fmtHours(today.minutes)} today${streak > 1 ? ` · ${streak} day streak` : ''}`;
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
        const check = button('', 'dtimer__check', () => { t.done = !t.done; if (t.done && state.activeTaskId === t.id) state.activeTaskId = state.tasks.find((x) => !x.done)?.id ?? null; persist(); render(); }, t.done ? 'Mark not done' : 'Mark done');
        check.setAttribute('aria-pressed', t.done ? 'true' : 'false');
        row.appendChild(check);
        const title = button(t.title, 'dtimer__tasktitle', () => { if (!t.done) { state.activeTaskId = t.id; persist(); render(); } }, 'Make this the active task');
        row.appendChild(title);
        const count = h('span', 'dtimer__taskcount', `${t.act}/${t.est}`);
        count.title = 'Finished intervals / estimated';
        row.appendChild(count);
        const more = button('+', 'dtimer__tasksmall', () => { t.est = Math.min(99, t.est + 1); persist(); renderTasks(); }, 'One more interval');
        row.appendChild(more);
        const del = button('×', 'dtimer__tasksmall', () => { state.tasks = state.tasks.filter((x) => x.id !== t.id); if (state.activeTaskId === t.id) state.activeTaskId = state.tasks.find((x) => !x.done)?.id ?? null; persist(); render(); }, 'Remove task');
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

    const sub = ctx.onDidChangeConfig((next) => {
      cfg = readConfig(next);
      if (!running() && state.pausedRemaining === null) { /* idle: the face shows the new length */ }
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
