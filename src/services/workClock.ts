// workClock.ts — the one clock that counts time worked, for every tool
//
// Time worked is time with the work showing and the person at the desk. A
// clock cannot tell reading from a break: it sees only input. So it counts
// while its surface is showing and the last input (a key, a click, a tap, a
// scroll; moving the mouse is not one) is younger than the idle time, and
// when the idle time passes with none it takes the whole stretch since that
// input back, once. A break with the tab up counts for nothing, and an hour
// left open adds no hour to anything. Time is the wall time between two
// looks, capped, never a count of looks. A look that crosses local midnight
// gives each side to its own day.
//
// The idle time is one setting for the whole app (`clock.idleMinutes`: 5, 10,
// 15 or 30 minutes), read at every look, so every running clock follows a
// change at once. The window is listened to only while a clock runs.
//
// The pure part (workClockState, lookAtWorkClock) is tested; the ticker
// around it is a thin shell. A tool reaches it through `api.work.createClock`.

import { Emitter, type Event } from '../platform/events.js';
import type { IDisposable } from '../platform/lifecycle.js';
import { appDateParts, appDayKey } from '../platform/localTime.js';
import type { ISettingsRegistryService } from './serviceTypes.js';

export const IDLE_MINUTES_SETTING = 'clock.idleMinutes';
export const IDLE_MINUTES_CHOICES: readonly number[] = [5, 10, 15, 30];
export const DEFAULT_IDLE_MINUTES = 10;
/** The most one look may count: a machine asleep, or a stalled window, does not count its nap. */
const MAX_LOOK_MS = 5000;

// ── The setting ─────────────────────────────────────────────────────────────

type RegistryLike = Pick<ISettingsRegistryService, 'register' | 'getSchema' | 'getValue'>;
let _settings: RegistryLike | undefined;

/** Register the idle time (once) and remember where to read it. */
export function registerWorkClockSetting(registry: RegistryLike | undefined): void {
  _settings = registry;
  if (!registry || registry.getSchema(IDLE_MINUTES_SETTING)) return;
  registry.register({
    key: IDLE_MINUTES_SETTING,
    type: 'enum',
    default: String(DEFAULT_IDLE_MINUTES),
    scope: 'user',
    label: 'Idle Time',
    description: 'How long the clock keeps counting after your last key, click, tap or scroll. Time worked is counted only while the work is showing and you are at the desk. A stretch that ends idle is taken back, so time away is not counted. Moving the mouse alone does not count as being there.',
    category: 'General',
    enumValues: IDLE_MINUTES_CHOICES.map(String),
    enumLabels: Object.fromEntries(IDLE_MINUTES_CHOICES.map((m) => [String(m), `${m} min`])),
  } as Parameters<RegistryLike['register']>[0]);
}

/** One of the choices, whatever was stored. */
export function idleMinutesOf(value: unknown): number {
  const n = Number(value);
  return IDLE_MINUTES_CHOICES.includes(n) ? n : DEFAULT_IDLE_MINUTES;
}

/** The idle time as it is set now, in minutes. */
export function getIdleMinutes(): number {
  try { return idleMinutesOf(_settings?.getValue<string>(IDLE_MINUTES_SETTING)); } catch { return DEFAULT_IDLE_MINUTES; }
}

// ── The pure part ───────────────────────────────────────────────────────────

/** The person's local day of a moment, 'YYYY-MM-DD' (the app's zone, which is this computer's unless they chose another). */
export function workDayOf(ms: number): string {
  return appDayKey(ms);
}

export interface IWorkClockState {
  /** When the clock last looked. */
  at: number;
  /** The input the clock has already seen; a newer one means the person is back. */
  inputSeen: number;
  /** The stretch since that input was found idle and taken back. */
  idle: boolean;
  /** What the stretch since that input has counted, by day and bucket: what an idle verdict takes back. */
  counted: Map<string, IWorkClockCount>;
}

/** Milliseconds counted for one local day and one bucket (below zero: taken back). */
export interface IWorkClockCount { day: string; bucket: string; ms: number }

/** A clock that starts at `now`; `inputAt` is when the person last touched the app. */
export function workClockState(now: number, inputAt: number = now): IWorkClockState {
  return { at: now, inputSeen: inputAt, idle: false, counted: new Map() };
}

/**
 * One look at the clock. Returns what to count: above zero while the surface
 * is `showing` and the person is there (two entries when the look crosses
 * local midnight), below zero once when the stretch since the last input is
 * found idle (everything it counted comes back, each part to its own day and
 * bucket), nothing otherwise. `bucket` names what is showing now (a card, a
 * problem); time is taken back from the bucket it was counted in.
 */
export function lookAtWorkClock(state: IWorkClockState, now: number, showing: boolean, inputAt: number, idleMs: number, bucket = ''): IWorkClockCount[] {
  const passed = Math.min(MAX_LOOK_MS, Math.max(0, now - state.at));
  state.at = now;
  const out: IWorkClockCount[] = [];
  /** Count `ms` that end at `end`, each side of local midnight to its own day; `keep` puts it in the stretch an idle verdict takes back. */
  const count = (ms: number, end: number, keep: boolean): void => {
    if (ms <= 0) return;
    const add = (day: string, part: number): void => {
      if (part <= 0) return;
      if (keep) {
        const key = `${day}\u0000${bucket}`;
        const had = state.counted.get(key);
        if (had) had.ms += part; else state.counted.set(key, { day, bucket, ms: part });
      }
      const last = out[out.length - 1];
      if (last && last.day === day) last.ms += part; else out.push({ day, bucket, ms: part });
    };
    const day = workDayOf(end);
    const before = workDayOf(end - ms);
    if (before === day) { add(day, ms); return; }
    const p = appDateParts(end);
    const sinceMidnight = ((p.hour * 60 + p.minute) * 60 + p.second) * 1000 + p.millisecond;
    const early = Math.min(ms, Math.max(0, ms - sinceMidnight));
    add(before, early);
    add(day, ms - early);
  };
  if (inputAt > state.inputSeen) {
    // The person is back, or still here: a new stretch starts at this input. What passed up to it belongs to the
    // stretch before, which stands (nothing, when that one had gone idle); what passed since is the new stretch's.
    const since = Math.min(passed, Math.max(0, now - inputAt));
    const wasIdle = state.idle;
    state.inputSeen = inputAt;
    state.idle = false;
    state.counted = new Map();
    if (showing) {
      if (!wasIdle) count(passed - since, now - since, false);
      count(since, now, true);
    }
    return out;
  }
  if (state.idle) return out;
  if (now - inputAt >= idleMs) {
    state.idle = true;
    const back = [...state.counted.values()].filter((c) => c.ms > 0).map((c) => ({ ...c, ms: -c.ms }));
    state.counted = new Map();
    return back;
  }
  if (showing) count(passed, now, true);
  return out;
}

// ── Presence: one set of listeners on the window, only while a clock runs ────

const PRESENCE_EVENTS = ['keydown', 'pointerdown', 'wheel', 'touchstart', 'touchmove'] as const;
let _lastInputAt = 0;
let _holders = 0;
const notePresence = (): void => { _lastInputAt = Date.now(); };

function holdPresence(): IDisposable {
  // Whoever starts a clock is there: opening the thing was their doing.
  _lastInputAt = Date.now();
  if (_holders === 0 && typeof window !== 'undefined') {
    for (const type of PRESENCE_EVENTS) window.addEventListener(type, notePresence, { capture: true, passive: true });
  }
  _holders += 1;
  let done = false;
  return {
    dispose: () => {
      if (done) return;
      done = true;
      _holders -= 1;
      if (_holders === 0 && typeof window !== 'undefined') {
        for (const type of PRESENCE_EVENTS) window.removeEventListener(type, notePresence, { capture: true });
      }
    },
  };
}

/** When the person last pressed a key, clicked, tapped or scrolled (while a clock was running). */
export function lastPresenceAt(): number {
  return _lastInputAt;
}

// ── The clock ───────────────────────────────────────────────────────────────

/** Whole seconds for one local day and one bucket; below zero when a stretch is taken back. */
export interface IWorkClockCredit { readonly day: string; readonly bucket: string; readonly seconds: number }

export interface IWorkClockOptions {
  /** The surface is on screen now: its pane laid out, the window not hidden. */
  showing(): boolean;
  /** What is showing now, when one clock serves several things (a card of a session). */
  bucket?(): string;
  /**
   * Seconds to keep, by day and bucket. Called every `flushMs`, as soon as
   * the surface stops showing or a stretch is taken back, and at dispose
   * (`final`), so a closed window loses under a minute.
   */
  credit?(credits: readonly IWorkClockCredit[], final: boolean): void;
  /** The running total moved by this many whole seconds (for a clock on screen). */
  onCount?(seconds: number): void;
  flushMs?: number;
  tickMs?: number;
  /** Test seams. */
  now?(): number;
  lastInput?(): number;
  idleMinutes?(): number;
}

export interface IWorkClock extends IDisposable {
  /** The stretch since the last input was found idle and taken back; false again at the next input. */
  readonly idle: boolean;
  /** How long the idle time was when the clock last stopped, in minutes. */
  readonly idleMinutes: number;
  /** Fires with true when the clock stops for idleness while its surface shows, with false when it goes on. */
  readonly onDidChangeIdle: Event<boolean>;
  /** Hand what is counted so far to `credit` now. */
  flush(): void;
}

/** Run the clock against a surface until disposed. */
export function createWorkClock(opts: IWorkClockOptions): IWorkClock {
  const now = opts.now ?? (() => Date.now());
  const presence = opts.lastInput ? null : holdPresence();
  const input = opts.lastInput ?? lastPresenceAt;
  const idleMinutes = opts.idleMinutes ?? getIdleMinutes;
  const state = workClockState(now(), input());
  const onIdle = new Emitter<boolean>();
  /** Milliseconds not yet handed to `credit`, by day and bucket; the part of a second stays for the next flush. */
  const pending = new Map<string, IWorkClockCount>();
  let shownMs = 0;
  let wasShowing = false;
  let saidIdle = false;
  let stoppedAt = DEFAULT_IDLE_MINUTES;
  let disposed = false;

  const flush = (final = false): void => {
    const credits: IWorkClockCredit[] = [];
    for (const c of pending.values()) {
      const seconds = Math.trunc(c.ms / 1000);
      if (!seconds) continue;
      c.ms -= seconds * 1000;
      credits.push({ day: c.day, bucket: c.bucket, seconds });
    }
    if (credits.length || final) { try { opts.credit?.(credits, final); } catch (err) { console.warn('[workClock] credit failed:', err); } }
  };
  const look = (): void => {
    let showing = false;
    try { showing = !!opts.showing(); } catch { showing = false; }
    const minutes = idleMinutes();
    const wasIdle = state.idle;
    const counts = lookAtWorkClock(state, now(), showing, input(), minutes * 60_000, opts.bucket ? String(opts.bucket() ?? '') : '');
    let moved = 0;
    for (const c of counts) {
      const key = `${c.day}\u0000${c.bucket}`;
      const had = pending.get(key);
      if (had) had.ms += c.ms; else pending.set(key, { ...c });
      moved += c.ms;
    }
    if (moved) {
      shownMs += moved;
      const whole = Math.trunc(shownMs / 1000);
      if (whole) { shownMs -= whole * 1000; try { opts.onCount?.(whole); } catch { /* the surface's own */ } }
    }
    // The stop is said only where the person can see it; the return, only after a stop that was said.
    if (state.idle && !wasIdle) { stoppedAt = minutes; if (showing) { saidIdle = true; onIdle.fire(true); } }
    else if (!state.idle && saidIdle) { saidIdle = false; onIdle.fire(false); }
    const tookBack = counts.some((c) => c.ms < 0);
    if (tookBack || (wasShowing && !showing)) flush();
    wasShowing = showing;
  };
  const tickTimer = setInterval(look, opts.tickMs ?? 1000);
  const flushTimer = setInterval(() => flush(), opts.flushMs ?? 30_000);
  return {
    get idle() { return state.idle; },
    get idleMinutes() { return stoppedAt; },
    onDidChangeIdle: onIdle.event,
    flush: () => { if (!disposed) { look(); flush(); } },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      clearInterval(tickTimer);
      clearInterval(flushTimer);
      look();
      flush(true);
      presence?.dispose();
      onIdle.dispose();
    },
  };
}
