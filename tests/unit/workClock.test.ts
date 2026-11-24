// The core's clock for time worked: it counts while the surface is showing
// and the person is at the desk; a stretch that ends idle is taken back; a
// look measures elapsed time, never a count of looks; midnight splits a look.
// Every time here is built from local wall-clock parts, so the tests read the
// same in any zone and on any date.
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  lookAtWorkClock, workClockState, workDayOf, createWorkClock, idleMinutesOf, registerWorkClockSetting, getIdleMinutes,
  IDLE_MINUTES_SETTING, IDLE_MINUTES_CHOICES, type IWorkClockCredit,
} from '../../src/services/workClock.js';

const IDLE = 10 * 60_000;
/** Noon of a fixed local day: far from midnight in every zone. */
const T0 = new Date(2026, 2, 10, 12, 0, 0).getTime();
const DAY = workDayOf(T0);
const sum = (counts: { ms: number }[]) => counts.reduce((t, c) => t + c.ms, 0);

describe('lookAtWorkClock', () => {
  it('counts elapsed time while showing and active', () => {
    const s = workClockState(T0, T0);
    expect(lookAtWorkClock(s, T0 + 1000, true, T0, IDLE)).toEqual([{ day: DAY, bucket: '', ms: 1000 }]);
    expect(sum(lookAtWorkClock(s, T0 + 2000, true, T0, IDLE))).toBe(1000);
  });
  it('counts nothing while hidden, and does not count a look twice', () => {
    const s = workClockState(T0, T0);
    expect(lookAtWorkClock(s, T0 + 1000, false, T0, IDLE)).toEqual([]);
    expect(sum(lookAtWorkClock(s, T0 + 2000, true, T0, IDLE))).toBe(1000);
  });
  it('caps one look so a stalled window or a sleeping machine counts nothing big', () => {
    const s = workClockState(T0, T0);
    expect(sum(lookAtWorkClock(s, T0 + 60_000, true, T0 + 59_000, IDLE))).toBe(5000);
  });
  it('takes the stretch back once the idle time passes, then counts nothing', () => {
    const s = workClockState(T0, T0);
    let total = 0;
    for (let t = 1000; t < IDLE; t += 1000) total += sum(lookAtWorkClock(s, T0 + t, true, T0, IDLE));
    expect(total).toBe(IDLE - 1000);
    expect(lookAtWorkClock(s, T0 + IDLE, true, T0, IDLE)).toEqual([{ day: DAY, bucket: '', ms: -(IDLE - 1000) }]);
    expect(lookAtWorkClock(s, T0 + IDLE + 1000, true, T0, IDLE)).toEqual([]);
    expect(lookAtWorkClock(s, T0 + IDLE + 2000, true, T0, IDLE)).toEqual([]);
  });
  it('starts a new stretch when input returns, counting from the input and not from the idle look before it', () => {
    const s = workClockState(T0, T0);
    for (let t = 1000; t <= IDLE; t += 1000) lookAtWorkClock(s, T0 + t, true, T0, IDLE);
    expect(sum(lookAtWorkClock(s, T0 + IDLE + 1000, true, T0 + IDLE + 400, IDLE))).toBe(600);
    expect(sum(lookAtWorkClock(s, T0 + IDLE + 2000, true, T0 + IDLE + 400, IDLE))).toBe(1000);
  });
  it('reading with the odd scroll keeps counting', () => {
    const s = workClockState(T0, T0);
    let total = 0;
    let lastInput = T0;
    for (let t = 1000; t <= 30 * 60_000; t += 1000) {
      if (t % (4 * 60_000) === 0) lastInput = T0 + t;
      total += sum(lookAtWorkClock(s, T0 + t, true, lastInput, IDLE));
    }
    expect(total).toBe(30 * 60_000);
  });
  it('a break with the tab up counts for nothing: seven minutes at the desk and an hour away are seven minutes', () => {
    const s = workClockState(T0, T0);
    let total = 0;
    for (let t = 1000; t <= 68 * 60_000; t += 1000) total += sum(lookAtWorkClock(s, T0 + t, true, T0 + Math.min(t - (t % 60_000), 7 * 60_000), IDLE));
    expect(total).toBe(7 * 60_000);
  });
  it('follows the idle time it is given: at five minutes, a key six minutes after the last one finds the stretch taken back', () => {
    const s = workClockState(T0, T0);
    let total = 0;
    const inputs = [0, 60_000, 120_000, 480_000, 840_000];
    for (let t = 1000; t <= 840_000; t += 1000) total += sum(lookAtWorkClock(s, T0 + t, true, T0 + Math.max(...inputs.filter((i) => i <= t)), 5 * 60_000));
    expect(total).toBe(120_000);
  });
  it('gives each side of local midnight to its own day', () => {
    const before = new Date(2026, 2, 10, 23, 59, 58).getTime();
    const s = workClockState(before, before);
    const counts = lookAtWorkClock(s, before + 5000, true, before, IDLE);
    expect(counts).toEqual([{ day: workDayOf(before), bucket: '', ms: 2000 }, { day: workDayOf(before + 5000), bucket: '', ms: 3000 }]);
    expect(counts[0].day).not.toBe(counts[1].day);
  });
  it('takes a stretch back from the days and the buckets it was counted in', () => {
    const start = new Date(2026, 2, 10, 23, 59, 0).getTime();
    const s = workClockState(start, start);
    for (let t = 1000; t <= 120_000; t += 1000) lookAtWorkClock(s, start + t, true, start, IDLE, t <= 30_000 ? 'a' : 'b');
    const back = lookAtWorkClock(s, start + IDLE, true, start, IDLE, 'b');
    const of = (day: string, bucket: string) => back.find((c) => c.day === day && c.bucket === bucket)?.ms;
    expect(of(workDayOf(start), 'a')).toBe(-30_000);
    expect(of(workDayOf(start), 'b')).toBe(-30_000);
    expect(of(workDayOf(start + 120_000), 'b')).toBe(-60_000);
    expect(back).toHaveLength(3);
  });
});

describe('the idle setting', () => {
  it('is one of 5, 10, 15 and 30 minutes, 10 when nothing or anything else is stored', () => {
    expect(IDLE_MINUTES_CHOICES).toEqual([5, 10, 15, 30]);
    expect(idleMinutesOf('5')).toBe(5);
    expect(idleMinutesOf(30)).toBe(30);
    expect(idleMinutesOf(undefined)).toBe(10);
    expect(idleMinutesOf('7')).toBe(10);
  });
  it('is registered once, for the whole app, and read from where it is stored', () => {
    const schemas = new Map<string, Record<string, unknown>>();
    let stored: unknown = '10';
    const registry = { register: (s: { key: string }) => { schemas.set(s.key, s as never); }, getSchema: (k: string) => schemas.get(k) as never, getValue: <T>() => stored as T };
    registerWorkClockSetting(registry as never);
    registerWorkClockSetting(registry as never);
    const schema = schemas.get(IDLE_MINUTES_SETTING)!;
    expect(schemas.size).toBe(1);
    expect(schema.scope).toBe('user');
    expect(schema.enumValues).toEqual(['5', '10', '15', '30']);
    expect(schema.default).toBe('10');
    expect(String(schema.description)).toMatch(/taken back/);
    expect(getIdleMinutes()).toBe(10);
    stored = '15';
    expect(getIdleMinutes()).toBe(15);
    registerWorkClockSetting(undefined);
    expect(getIdleMinutes()).toBe(10);
  });
});

describe('createWorkClock', () => {
  afterEach(() => { vi.useRealTimers(); });
  const run = (over: Partial<Parameters<typeof createWorkClock>[0]> = {}) => {
    vi.useFakeTimers({ now: T0 });
    const credits: { c: IWorkClockCredit; final: boolean }[] = [];
    const idle: boolean[] = [];
    let counted = 0;
    const clock = createWorkClock({ showing: () => true, credit: (list, final) => { for (const c of list) credits.push({ c, final }); }, onCount: (s) => { counted += s; }, idleMinutes: () => 10, ...over });
    clock.onDidChangeIdle((v) => idle.push(v));
    const kept = () => credits.reduce((t, x) => t + x.c.seconds, 0);
    return { clock, credits, idle, kept, counted: () => counted };
  };
  const key = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));

  it('hands whole seconds over every half minute and at dispose, by local day', () => {
    const r = run();
    vi.advanceTimersByTime(29_000);
    expect(r.kept()).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(r.credits).toEqual([{ c: { day: DAY, bucket: '', seconds: 30 }, final: false }]);
    vi.advanceTimersByTime(12_000);
    r.clock.dispose();
    expect(r.kept()).toBe(42);
    expect(r.counted()).toBe(42);
  });
  it('a key, a press, a tap and the wheel are being there; moving the mouse is not', () => {
    const r = run();
    vi.advanceTimersByTime(9 * 60_000);
    window.dispatchEvent(new MouseEvent('mousemove'));
    window.dispatchEvent(new Event('pointermove'));
    vi.advanceTimersByTime(2 * 60_000);
    expect(r.idle).toEqual([true]);
    expect(r.kept()).toBe(0);
    for (const type of ['keydown', 'pointerdown', 'wheel', 'touchstart']) {
      window.dispatchEvent(new Event(type));
      vi.advanceTimersByTime(9 * 60_000);
    }
    expect(r.idle).toEqual([true, false]);
    r.clock.dispose();
    expect(r.kept()).toBe(36 * 60);
  });
  it('says the stop once and the return once, and takes the stretch back from what it handed over', () => {
    const r = run();
    vi.advanceTimersByTime(7 * 60_000);
    key();
    vi.advanceTimersByTime(61 * 60_000);
    expect(r.idle).toEqual([true]);
    expect(r.clock.idle).toBe(true);
    expect(r.clock.idleMinutes).toBe(10);
    expect(r.kept()).toBe(7 * 60);
    key();
    vi.advanceTimersByTime(2000);
    expect(r.idle).toEqual([true, false]);
    r.clock.dispose();
  });
  it('does not say a stop where nobody can see it', () => {
    let showing = true;
    const r = run({ showing: () => showing });
    vi.advanceTimersByTime(60_000);
    showing = false;
    vi.advanceTimersByTime(20 * 60_000);
    expect(r.idle).toEqual([]);
    // What it counted before it was hidden went back all the same: the stretch ended idle.
    expect(r.kept()).toBe(0);
    r.clock.dispose();
  });
  it('hands over at once when the surface stops showing', () => {
    let showing = true;
    const r = run({ showing: () => showing });
    vi.advanceTimersByTime(10_000);
    showing = false;
    vi.advanceTimersByTime(1000);
    expect(r.kept()).toBe(10);
    r.clock.dispose();
  });
  it('counts each thing shown in its own bucket', () => {
    let bucket = 'a';
    const r = run({ bucket: () => bucket });
    vi.advanceTimersByTime(20_000);
    bucket = 'b';
    vi.advanceTimersByTime(5000);
    r.clock.dispose();
    const by = (b: string) => r.credits.filter((x) => x.c.bucket === b).reduce((t, x) => t + x.c.seconds, 0);
    expect(by('a')).toBe(20);
    expect(by('b')).toBe(5);
  });
  it('follows a change of the idle time while it runs', () => {
    let minutes = 10;
    const r = run({ idleMinutes: () => minutes });
    vi.advanceTimersByTime(6 * 60_000);
    expect(r.idle).toEqual([]);
    minutes = 5;
    vi.advanceTimersByTime(1000);
    expect(r.idle).toEqual([true]);
    expect(r.clock.idleMinutes).toBe(5);
    r.clock.dispose();
  });
  it('listens to the window only while a clock runs', () => {
    vi.useFakeTimers({ now: T0 });
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const a = createWorkClock({ showing: () => true });
    const b = createWorkClock({ showing: () => true });
    const added = add.mock.calls.length;
    expect(added).toBeGreaterThan(0);
    a.dispose();
    expect(remove.mock.calls.length).toBe(0);
    b.dispose();
    b.dispose();
    expect(remove.mock.calls.length).toBe(added);
    expect(remove.mock.calls.map((c) => c[0]).sort()).toEqual(add.mock.calls.map((c) => c[0]).sort());
    add.mockRestore(); remove.mockRestore();
  });
});
