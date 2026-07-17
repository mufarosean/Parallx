// timerWidget.ts — a generic interval timer whose completed sessions become
// queryable data (M86 C3).
//
// Domain-blind by design: a pomodoro is just a preset (25m "Focus"), not a
// feature. Someone else's instantiation is workout sets or billable client
// time. Completed sessions append to a log persisted in cached_output (the
// same self-owned store the tasks/notes widgets use), so future widgets can
// chart "time per day" without any new storage.

import type {
  WidgetContext,
  WidgetHandle,
  WidgetTypeRegistration,
} from '../dashboardTypes.js';

interface TimerConfig {
  readonly minutes: number;
  readonly label: string;
}

const DEFAULT_CONFIG: TimerConfig = { minutes: 25, label: 'Focus' };

interface TimerSession {
  readonly startedAt: number;
  readonly minutes: number;
  readonly label: string;
}

interface TimerState {
  /** Completed sessions, newest last. Capped. */
  log: TimerSession[];
  /** Absolute epoch-ms the running timer ends at; null when idle/paused. */
  endsAt: number | null;
  /** Remaining ms when paused; null when idle or running. */
  pausedRemaining: number | null;
}

const MAX_LOG = 500;

const ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2"/><path d="M9 2h6"/></svg>';

function parseState(cached: string | null): TimerState {
  if (cached) {
    try {
      const p = JSON.parse(cached) as Partial<TimerState>;
      return {
        log: Array.isArray(p.log) ? p.log.slice(-MAX_LOG) : [],
        endsAt: typeof p.endsAt === 'number' ? p.endsAt : null,
        pausedRemaining: typeof p.pausedRemaining === 'number' ? p.pausedRemaining : null,
      };
    } catch { /* fresh */ }
  }
  return { log: [], endsAt: null, pausedRemaining: null };
}

function clampMinutes(n: unknown): number {
  const v = Math.floor(Number(n));
  return Number.isFinite(v) ? Math.max(1, Math.min(240, v)) : DEFAULT_CONFIG.minutes;
}

function fmt(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export const TIMER_WIDGET: WidgetTypeRegistration<TimerConfig> = {
  typeId: 'parallx.dashboard.timer',
  displayName: 'Timer',
  description: 'An interval timer that logs completed sessions. Study pomodoros for one person, workout sets or billable time for another.',
  icon: ICON_SVG,
  category: 'static',
  chromeStyle: 'minimal',
  defaultSize: { colSpan: 3, rowSpan: 3 },
  defaultConfig: DEFAULT_CONFIG,
  configSchema: {
    fields: {
      minutes: {
        type: 'number',
        label: 'Minutes per session',
        description: '1-240. The classic pomodoro is 25.',
      },
      label: {
        type: 'string',
        label: 'Session label',
        description: 'Logged with each completed session.',
        placeholder: 'Focus',
      },
    },
  },

  createWidget(container: HTMLElement, ctx: WidgetContext<TimerConfig>): WidgetHandle {
    container.classList.add('dtimer');
    let state = parseState(ctx.cachedOutput);
    let cfg: TimerConfig = {
      minutes: clampMinutes(ctx.config?.minutes),
      label: (ctx.config?.label ?? DEFAULT_CONFIG.label).trim() || DEFAULT_CONFIG.label,
    };

    const face = document.createElement('div');
    face.className = 'dtimer__face';
    container.appendChild(face);

    const controls = document.createElement('div');
    controls.className = 'dtimer__controls';
    container.appendChild(controls);

    const startBtn = document.createElement('button');
    startBtn.type = 'button';
    startBtn.className = 'dtimer__btn dtimer__btn--primary';
    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.className = 'dtimer__btn';
    resetBtn.textContent = 'Reset';
    controls.appendChild(startBtn);
    controls.appendChild(resetBtn);

    const stats = document.createElement('div');
    stats.className = 'dtimer__stats';
    container.appendChild(stats);

    const persist = (): void => {
      ctx.setCachedOutput(JSON.stringify(state));
    };

    const remainingMs = (): number => {
      if (state.endsAt !== null) return state.endsAt - Date.now();
      if (state.pausedRemaining !== null) return state.pausedRemaining;
      return cfg.minutes * 60_000;
    };

    const todayStats = (): string => {
      const dayStart = new Date();
      dayStart.setHours(0, 0, 0, 0);
      const today = state.log.filter((s) => s.startedAt >= dayStart.getTime());
      if (today.length === 0) return 'No sessions yet today';
      const mins = today.reduce((sum, s) => sum + s.minutes, 0);
      return `${today.length} session${today.length === 1 ? '' : 's'} · ${mins}m today`;
    };

    const render = (): void => {
      const rem = remainingMs();
      const running = state.endsAt !== null;
      const done = running && rem <= 0;
      face.textContent = done ? 'Done!' : fmt(rem);
      face.classList.toggle('dtimer__face--done', done);
      startBtn.textContent = running ? 'Pause' : (state.pausedRemaining !== null ? 'Resume' : `Start ${cfg.label}`);
      stats.textContent = todayStats();
    };

    let tick: ReturnType<typeof setInterval> | null = null;
    const stopTick = (): void => { if (tick) { clearInterval(tick); tick = null; } };
    const startTick = (): void => {
      stopTick();
      tick = setInterval(() => {
        if (state.endsAt !== null && state.endsAt - Date.now() <= 0) {
          // Session complete — log it and go idle.
          state.log = [...state.log, { startedAt: state.endsAt - cfg.minutes * 60_000, minutes: cfg.minutes, label: cfg.label }].slice(-MAX_LOG);
          state.endsAt = null;
          state.pausedRemaining = null;
          persist();
          stopTick();
        }
        render();
      }, 500);
    };

    startBtn.addEventListener('click', () => {
      if (state.endsAt !== null) {
        // Pause
        state.pausedRemaining = Math.max(0, state.endsAt - Date.now());
        state.endsAt = null;
        stopTick();
      } else {
        // Start / resume
        const rem = state.pausedRemaining ?? cfg.minutes * 60_000;
        state.endsAt = Date.now() + rem;
        state.pausedRemaining = null;
        startTick();
      }
      persist();
      render();
    });

    resetBtn.addEventListener('click', () => {
      state.endsAt = null;
      state.pausedRemaining = null;
      stopTick();
      persist();
      render();
    });

    // A timer that was running when the page closed resumes seamlessly
    // (endsAt is absolute); one that finished while closed logs on reopen.
    if (state.endsAt !== null) {
      if (state.endsAt - Date.now() <= 0) {
        state.log = [...state.log, { startedAt: state.endsAt - cfg.minutes * 60_000, minutes: cfg.minutes, label: cfg.label }].slice(-MAX_LOG);
        state.endsAt = null;
        persist();
      } else {
        startTick();
      }
    }
    render();

    const sub = ctx.onDidChangeConfig((next) => {
      cfg = {
        minutes: clampMinutes((next as TimerConfig)?.minutes),
        label: ((next as TimerConfig)?.label ?? DEFAULT_CONFIG.label).trim() || DEFAULT_CONFIG.label,
      };
      render();
    });

    return {
      refreshFromCache(cached: string | null) {
        state = parseState(cached);
        render();
      },
      dispose() {
        stopTick();
        sub.dispose();
      },
    };
  },
};
