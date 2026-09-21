// studyClock.ts — study time is time with the work on screen and the student
// at the desk, whatever the cells do (Mufaro, 2026-09-21: "I care more about
// the amount of time I spend studying. Sometimes I look through a problem and
// the answer and change no cells; sometimes I work it against the model
// solution; hyperfocusing on cell changes does not capture the spectrum").
//
// The clock cannot tell reading from a break: it only sees input. So it
// counts while the surface is visible and the last input is under the idle
// threshold, and when the threshold passes it takes the whole stretch back,
// so a break with the tab up counts for nothing. Time is measured as elapsed
// wall time between ticks, capped, never as a tick count: a busy engine that
// delays a tick loses nothing.
//
// The pure core (advance) is tested; the ticker around it is a thin DOM shell.

/** Ten minutes without any input: the default point at which a stretch stops being study. */
export const DEFAULT_IDLE_MINUTES = 10;
/** The most one tick may credit; a suspended laptop or a stalled tab must not credit its whole nap. */
const MAX_TICK_MS = 5000;

export interface ClockState {
  /** When the clock last looked. */
  lastTick: number;
  /** Milliseconds credited since the last input, the amount an idle verdict takes back. */
  sinceInputMs: number;
  /** The lastInputAt the clock has already seen; a newer one means the student is back. */
  inputSeen: number;
  /** The current stretch has been ruled idle and taken back. */
  idle: boolean;
}

export function createClockState(now: number, lastInputAt: number = now): ClockState {
  return { lastTick: now, sinceInputMs: 0, inputSeen: lastInputAt, idle: false };
}

/**
 * One look at the clock. Returns the milliseconds to credit: positive while
 * the surface is visible and the student active, negative once when a
 * stretch is ruled idle (its credited time comes back), zero otherwise.
 */
export function advance(state: ClockState, now: number, visible: boolean, lastInputAt: number, idleMs: number): number {
  const delta = Math.max(0, Math.min(now - state.lastTick, MAX_TICK_MS));
  state.lastTick = now;
  if (lastInputAt > state.inputSeen) {
    // Input arrived: whatever the stretch was, a new one starts here.
    state.inputSeen = lastInputAt;
    state.sinceInputMs = 0;
    state.idle = false;
  }
  if (state.idle) return 0;
  if (now - lastInputAt >= idleMs) {
    // The stretch since the last input was not study. Take it back, once.
    state.idle = true;
    const back = state.sinceInputMs;
    state.sinceInputMs = 0;
    return -back;
  }
  if (!visible) return 0;
  state.sinceInputMs += delta;
  return delta;
}

// ── Input tracking, one set of listeners for the window ─────────────────────

let _lastInputAt = Date.now();
let _tracking = false;
function trackInput(): void {
  if (_tracking || typeof window === 'undefined') return;
  _tracking = true;
  const mark = () => { _lastInputAt = Date.now(); };
  // Movement is throttled by hand rather than the shared rAF throttle: this
  // needs one timestamp a second at most, not one a frame.
  let lastMove = 0;
  const onMove = () => { const t = Date.now(); if (t - lastMove > 1000) { lastMove = t; _lastInputAt = t; } };
  window.addEventListener('keydown', mark, { capture: true, passive: true });
  window.addEventListener('pointerdown', mark, { capture: true, passive: true });
  window.addEventListener('wheel', mark, { capture: true, passive: true });
  window.addEventListener('pointermove', onMove, { capture: true, passive: true });
}
/** When the student last touched the app. */
export function lastInputAt(): number {
  return _lastInputAt;
}

// ── The ticker ──────────────────────────────────────────────────────────────

export interface StudyTickerOptions {
  /** The surface is on screen: pane connected, laid out, document not hidden. */
  visible: () => boolean;
  /** Whole seconds to credit to the ledger, negative when a stretch is taken back. `final` is the flush at dispose. */
  credit: (seconds: number, final: boolean) => void;
  /** The running total moved by this many seconds (for a clock on screen). */
  onTotal?: (deltaSeconds: number) => void;
  idleMs?: number;
  /** How often credited time reaches the ledger. */
  flushMs?: number;
  tickMs?: number;
  now?: () => number;
  /** Test seam: the last-input source. */
  lastInput?: () => number;
}

/**
 * Runs the clock against a surface until disposed. Credits reach the ledger
 * in whole seconds every `flushMs` and at dispose, so a closed window loses
 * under a minute; the on-screen clock moves every tick.
 */
export function createStudyTicker(opts: StudyTickerOptions): { dispose(): void } {
  trackInput();
  const now = opts.now ?? (() => Date.now());
  const input = opts.lastInput ?? lastInputAt;
  const idleMs = Math.max(60_000, opts.idleMs ?? DEFAULT_IDLE_MINUTES * 60_000);
  const state = createClockState(now(), input());
  let pendingMs = 0;
  let shownMs = 0;
  const flush = (final: boolean) => {
    const secs = Math.trunc(pendingMs / 1000);
    if (secs !== 0 || final) {
      pendingMs -= secs * 1000;
      if (secs !== 0) opts.credit(secs, final);
      else if (final) opts.credit(0, true);
    }
  };
  const tick = () => {
    const ms = advance(state, now(), opts.visible(), input(), idleMs);
    if (ms === 0) return;
    pendingMs += ms;
    shownMs += ms;
    const shownSecs = Math.trunc(shownMs / 1000);
    if (shownSecs !== 0 && opts.onTotal) { shownMs -= shownSecs * 1000; opts.onTotal(shownSecs); }
  };
  const tickTimer = setInterval(tick, opts.tickMs ?? 1000);
  const flushTimer = setInterval(() => flush(false), opts.flushMs ?? 30_000);
  return {
    dispose: () => {
      clearInterval(tickTimer);
      clearInterval(flushTimer);
      tick();
      flush(true);
    },
  };
}
