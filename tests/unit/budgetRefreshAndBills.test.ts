// Budget: a page refresh never overlaps itself (an older read cannot paint
// over a newer one), and a bill's payments are read from the month's rows in
// memory with the same rule the per-bill query used.
import { describe, it, expect } from 'vitest';
// @ts-expect-error — JS module with no types
import { __testables } from '../../ext/budget/main.js';

const { serialRefresh, billPaidIn } = __testables;
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('budget serialRefresh', () => {
  it('runs one at a time and reruns once with the latest state', async () => {
    let state = 0;
    const painted: number[] = [];
    let release: (() => void) | null = null;
    let running = 0, maxRunning = 0;
    const draw = serialRefresh(async () => {
      running++; maxRunning = Math.max(maxRunning, running);
      const seen = state;
      if (!release) await new Promise<void>((r) => { release = r; });
      painted.push(seen);
      running--;
    });
    const first = draw();          // slow read of state 0
    state = 1; void draw();        // ledger changed twice while it runs
    state = 2; void draw();
    await tick();
    release!();
    await first;
    await tick(); await tick();
    expect(maxRunning).toBe(1);
    expect(painted).toEqual([0, 2]); // the last paint is the latest state
  });
});

describe('budget billPaidIn', () => {
  const rows = [
    { id: 't1', merchant: 'NETFLIX.COM', amount_cents: 1549, transaction_date: '2026-10-05' },
    { id: 't2', merchant: 'Parkview Apartments', amount_cents: 185000, transaction_date: '2026-10-01' },
    { id: 't3', merchant: 'ACH 4471', amount_cents: 7999, transaction_date: '2026-10-18' },
    { id: 't4', merchant: 'Netflix', amount_cents: 1549, transaction_date: '2026-10-20' },
  ];
  it('matches by pattern in any case and by linked occurrence', () => {
    expect(billPaidIn({ merchant_pattern: 'netflix' }, rows, undefined)).toEqual({ cents: 3098, last: '2026-10-20' });
    expect(billPaidIn({ merchant_pattern: 'comcast' }, rows, new Set(['t3']))).toEqual({ cents: 7999, last: '2026-10-18' });
  });
  it('an empty pattern matches nothing by name', () => {
    expect(billPaidIn({ merchant_pattern: '' }, rows, undefined)).toEqual({ cents: 0, last: null });
  });
  it('treats pattern text literally (an underscore is not a wildcard)', () => {
    expect(billPaidIn({ merchant_pattern: 'ach_4471' }, rows, undefined).cents).toBe(0);
  });
});
