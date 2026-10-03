// Budget: a page refresh never overlaps itself (an older read cannot paint
// over a newer one), and a bill's payments are read from the month's rows in
// memory, near their usual amount, and each charge pays one bill.
import { describe, it, expect } from 'vitest';
// @ts-expect-error — JS module with no types
import { __testables } from '../../ext/budget/main.js';

const { serialRefresh, matchBillPayments, billMonthView } = __testables;
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

describe('budget bills in a month', () => {
  const oct = { start: '2026-10-01', end: '2026-10-31' };
  const nowIso = '2026-10-03';
  const row = (id: string, merchant: string, cents: number, date: string) => ({ id, merchant, amount_cents: cents, transaction_date: date });

  it('a weekly bill counts every due date still ahead this month', () => {
    const gym = { id: 'g', merchant_pattern: 'gym', cadence: 'weekly', last_amount_cents: 2500, next_due_date: '2026-10-08' };
    const paid = [{ id: 'p', cents: 2500, date: '2026-10-01' }];
    const v = billMonthView(gym, paid, oct, '2026-10-03', nowIso);
    expect(v.toComeCents).toBe(2500 * 4); // Oct 8, 15, 22, 29
    expect(v.paidCents).toBe(2500);
  });

  it('a bill past its date and unpaid is still to come', () => {
    const rent = { id: 'r', merchant_pattern: 'parkview', cadence: 'monthly', last_amount_cents: 150000, next_due_date: '2026-10-01' };
    const v = billMonthView(rent, [], oct, '2026-10-03', nowIso);
    expect(v.toComeCents).toBe(150000);
    expect(v.overdue).toBe(true);
    // Paid the day before its date, in the month before: settled, and not
    // counted as paid in October.
    const early = billMonthView(rent, [{ id: 'x', cents: 150000, date: '2026-09-30' }], oct, '2026-10-03', nowIso);
    expect(early.toComeCents).toBe(0);
    expect(early.paidCents).toBe(0);
    expect(billMonthView(rent, [{ id: 'x', cents: 150000, date: '2026-10-02' }], oct, '2026-10-03', nowIso).toComeCents).toBe(0);
  });

  it('a month that is over has nothing still to come', () => {
    const sep = { start: '2026-09-01', end: '2026-09-30' };
    const rent = { id: 'r', merchant_pattern: 'parkview', cadence: 'monthly', last_amount_cents: 150000, next_due_date: '2026-09-15' };
    expect(billMonthView(rent, [], sep, null, nowIso).toComeCents).toBe(0);
  });

  it('a refund as the last row does not make the bill negative', () => {
    const tv = { id: 't', merchant_pattern: 'netflix', cadence: 'monthly', last_amount_cents: -1549, next_due_date: '2026-11-05' };
    expect(billMonthView(tv, [], { start: '2026-11-01', end: '2026-11-30' }, null, nowIso).toComeCents).toBe(1549);
  });

  it('a big purchase from the same merchant does not pay a small bill', () => {
    const icloud = { id: 'i', merchant_pattern: 'apple', last_amount_cents: 299 };
    const m = matchBillPayments([icloud], [row('a', 'Apple.com/bill', 299, '2026-10-24'), row('b', 'Apple Store', 99900, '2026-10-10')], new Map());
    expect(m.get('i').map((p: { id: string }) => p.id)).toEqual(['a']);
  });

  it('one charge pays one bill: linked first, then the longer name', () => {
    const a = { id: 'a', merchant_pattern: 'netflix', last_amount_cents: 1549 };
    const b = { id: 'b', merchant_pattern: 'netflix.com', last_amount_cents: 1549 };
    const c = { id: 'c', merchant_pattern: 'comcast', last_amount_cents: 7999 };
    const rows = [row('n', 'NETFLIX.COM', 1549, '2026-10-05'), row('k', 'ACH 4471', 7999, '2026-10-18')];
    const m = matchBillPayments([a, b, c], rows, new Map([['c', new Set(['k'])]]));
    expect(m.get('a')).toEqual([]);
    expect(m.get('b').map((p: { id: string }) => p.id)).toEqual(['n']);
    expect(m.get('c').map((p: { id: string }) => p.id)).toEqual(['k']);
  });

  it('a varying bill (utilities) still matches within half its usual amount', () => {
    const pge = { id: 'p', merchant_pattern: 'pg&e', last_amount_cents: 11000 };
    expect(matchBillPayments([pge], [row('u', 'PG&E WEB', 13800, '2026-10-18')], new Map()).get('p')).toHaveLength(1);
  });
});
