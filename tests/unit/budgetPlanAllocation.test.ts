// Plan › Budgets: a month as an allocation of expected income. Limits hold
// the bills, so everyday is limits less bills; a month ahead counts every
// time a bill falls due in it; a goal's monthly need spreads what is left.
import { describe, it, expect } from 'vitest';
// @ts-expect-error — JS module with no types
import { __testables } from '../../ext/budget/main.js';

const { billDueCount, goalMonthlyNeed, computeAllocation } = __testables;
const nov = { start: '2026-11-01', end: '2026-11-30' };
const feb = { start: '2027-02-01', end: '2027-02-28' };

describe('budget plan allocation', () => {
  it('splits limits into bills and everyday, and leaves what has no job', () => {
    const a = computeAllocation({ incomeCents: 825000, limitCents: 450000, billsCents: 218546, goalsCents: 273121 });
    expect(a.everydayCents).toBe(450000 - 218546);
    expect(a.unassignedCents).toBe(825000 - 450000 - 273121);
    expect(computeAllocation({ incomeCents: 100000, limitCents: 150000, billsCents: 0, goalsCents: 0 }).unassignedCents).toBe(-50000);
    // No limits yet (a month ahead): the bills are still committed.
    const ahead = computeAllocation({ incomeCents: 825000, limitCents: 0, billsCents: 218546, goalsCents: 273121 });
    expect(ahead.everydayCents).toBe(0);
    expect(ahead.unassignedCents).toBe(825000 - 218546 - 273121);
    expect(ahead.billsCents + ahead.everydayCents + ahead.goalsCents + ahead.unassignedCents).toBe(825000);
  });

  it('a bill in a category without a limit is committed but takes nothing from the limits', () => {
    const a = computeAllocation({ incomeCents: 540000, limitCents: 134000, billsCents: 208436, goalsCents: 0, billsInLimitsCents: 0 });
    expect(a.everydayCents).toBe(134000);
    expect(a.unassignedCents).toBe(540000 - 208436 - 134000);
  });

  it('counts each time a bill falls due in a month ahead', () => {
    expect(billDueCount('2026-10-12', 'monthly', nov)).toBe(1);
    expect(billDueCount('2026-10-05', 'weekly', nov)).toBe(5);   // Nov 2, 9, 16, 23, 30
    expect(billDueCount('2026-10-20', 'biweekly', nov)).toBe(2); // Nov 3, 17
    expect(billDueCount('2026-10-12', 'quarterly', nov)).toBe(0);
    expect(billDueCount('2026-08-15', 'quarterly', nov)).toBe(1);
    expect(billDueCount('2026-10-31', 'monthly', feb)).toBe(1);  // falls on Feb 28
    expect(billDueCount(null, 'monthly', nov)).toBe(0);
  });

  it('spreads what a goal still needs over the months to its date', () => {
    const now = new Date('2026-10-02T12:00:00Z').getTime();
    const need = goalMonthlyNeed({ target_cents: 1000000, current_cents: 400000, target_date: '2027-04-02' }, now);
    expect(need).toBeGreaterThan(95000);
    expect(need).toBeLessThan(105000);
    expect(goalMonthlyNeed({ target_cents: 1000, current_cents: 1000, target_date: '2027-01-01' }, now)).toBeNull();
    expect(goalMonthlyNeed({ target_cents: 1000, current_cents: 0, target_date: null }, now)).toBeNull();
    expect(goalMonthlyNeed({ target_cents: 1000, current_cents: 0, target_date: '2026-01-01' }, now)).toBeNull();
    // Due within a month, or today: what is left, never twice it.
    expect(goalMonthlyNeed({ target_cents: 30000, current_cents: 0, target_date: '2026-10-12' }, '2026-10-02')).toBe(30000);
    expect(goalMonthlyNeed({ target_cents: 10000, current_cents: 0, target_date: '2026-10-02' }, '2026-10-02')).toBe(10000);
  });
});
