// Worksheets: the study clock. Time counts while the surface is visible and
// the student active; an idle stretch is taken back; ticks measure elapsed
// time, never tick counts.
import { describe, it, expect } from 'vitest';
import { advance, createClockState } from '../../src/built-in/worksheet/studyClock.js';

const IDLE = 10 * 60_000;

describe('advance', () => {
  it('credits elapsed time while visible and active', () => {
    const s = createClockState(0, 0);
    expect(advance(s, 1000, true, 0, IDLE)).toBe(1000);
    expect(advance(s, 2000, true, 0, IDLE)).toBe(1000);
  });
  it('credits nothing while hidden, and does not count a tick twice', () => {
    const s = createClockState(0, 0);
    expect(advance(s, 1000, false, 0, IDLE)).toBe(0);
    expect(advance(s, 2000, true, 0, IDLE)).toBe(1000);
  });
  it('caps one tick so a stalled tab or a sleeping laptop credits nothing big', () => {
    const s = createClockState(0, 0);
    expect(advance(s, 60_000, true, 59_000, IDLE)).toBe(5000);
  });
  it('takes the stretch back once the idle threshold passes, then credits nothing', () => {
    const s = createClockState(0, 0);
    let total = 0;
    for (let t = 1000; t < IDLE; t += 1000) total += advance(s, t, true, 0, IDLE);
    expect(total).toBe(IDLE - 1000);
    expect(advance(s, IDLE, true, 0, IDLE)).toBe(-(IDLE - 1000));
    expect(advance(s, IDLE + 1000, true, 0, IDLE)).toBe(0);
    expect(advance(s, IDLE + 2000, true, 0, IDLE)).toBe(0);
  });
  it('starts a new stretch when input returns', () => {
    const s = createClockState(0, 0);
    for (let t = 1000; t <= IDLE; t += 1000) advance(s, t, true, 0, IDLE);
    expect(advance(s, IDLE + 1000, true, IDLE + 500, IDLE)).toBe(1000);
    expect(advance(s, IDLE + 2000, true, IDLE + 500, IDLE)).toBe(1000);
  });
  it('reading with the odd scroll keeps counting', () => {
    const s = createClockState(0, 0);
    let total = 0;
    let lastInput = 0;
    for (let t = 1000; t <= 30 * 60_000; t += 1000) {
      if (t % (4 * 60_000) === 0) lastInput = t;
      total += advance(s, t, true, lastInput, IDLE);
    }
    expect(total).toBe(30 * 60_000);
  });
  it('a break with the tab up counts for nothing', () => {
    const s = createClockState(0, 0);
    let total = 0;
    // A minute of work, then hands off for the rest: the seconds before the
    // last input stay, and everything after it, break included, never counts.
    for (let t = 1000; t <= 40 * 60_000; t += 1000) total += advance(s, t, true, t >= 60_000 ? 60_000 : 0, IDLE);
    expect(total).toBe(59_000);
  });
});
