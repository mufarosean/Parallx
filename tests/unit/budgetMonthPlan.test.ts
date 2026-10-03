// The month model behind Budget's sidebar and Overview: bills are committed,
// not pace. The day-2 case is the one the old Overview got wrong (rent on the
// 1st projected as "$25,858 over budget").
import { describe, it, expect } from 'vitest';
// @ts-expect-error — JS module with no types
import { __testables } from '../../ext/budget/main.js';

const { computeMonthPlan, planScope } = __testables;

describe('budget month plan', () => {
  it('day 2 with rent paid: plenty left, under pace, no projection yet', () => {
    const p = computeMonthPlan({
      limitCents: 450000, spentCents: 195864, billsPaidCents: 186549, billsToComeCents: 43497,
      daysInMonth: 31, dayOfMonth: 2,
    });
    expect(p.leftCents).toBe(450000 - 195864 - 43497);
    expect(p.everydayBudgetCents).toBe(450000 - 186549 - 43497);
    expect(p.everydaySpentCents).toBe(195864 - 186549);
    expect(p.projectedCents).toBeNull();
    expect(p.pace).toBe('under');
    expect(p.daysLeft).toBe(29);
  });

  it('projects from day 7 on, from everyday spending only', () => {
    const p = computeMonthPlan({ limitCents: 300000, spentCents: 250000, billsPaidCents: 200000, billsToComeCents: 0, daysInMonth: 30, dayOfMonth: 10 });
    expect(p.everydaySpentCents).toBe(50000);
    expect(p.projectedCents).toBe(150000);
    expect(p.pace).toBe('ahead');
  });

  it('over when everyday spending passes the everyday budget', () => {
    const p = computeMonthPlan({ limitCents: 100000, spentCents: 120000, billsPaidCents: 10000, billsToComeCents: 0, daysInMonth: 30, dayOfMonth: 20 });
    expect(p.leftCents).toBe(-20000);
    expect(p.pace).toBe('over');
  });

  it('no limits set: no pace, left is negative spending', () => {
    const p = computeMonthPlan({ limitCents: 0, spentCents: 5000, billsPaidCents: 0, billsToComeCents: 0, daysInMonth: 30, dayOfMonth: 5 });
    expect(p.pace).toBe('none');
    expect(p.leftCents).toBe(-5000);
  });

  it('bills paid can never exceed what was spent', () => {
    const p = computeMonthPlan({ limitCents: 100000, spentCents: 1000, billsPaidCents: 5000, billsToComeCents: 0, daysInMonth: 30, dayOfMonth: 5 });
    expect(p.billsPaidCents).toBe(1000);
    expect(p.everydaySpentCents).toBe(0);
  });

  it('only categories with a limit are planned: a mortgage in an unlimited Housing is not "over plan"', () => {
    const statuses = [
      { id: 'housing', effective_limit_cents: 0, spent_cents: 185000 },
      { id: 'groceries', effective_limit_cents: 55000, spent_cents: 0 },
      { id: 'transport', effective_limit_cents: 15000, spent_cents: 4100 },
    ];
    const bills = [
      { categoryId: 'housing', paidCents: 185000, toComeCents: 0 },
      { categoryId: 'transport', paidCents: 0, toComeCents: 2000 },
    ];
    const scope = planScope(statuses, bills, 189100);
    expect(scope.limitCents).toBe(70000);
    expect(scope.spentCents).toBe(4100);
    expect(scope.billsPaidCents).toBe(0);
    expect(scope.billsToComeCents).toBe(2000);
    expect(scope.unplannedSpentCents).toBe(185000);
    expect(scope.allBillsPaidCents).toBe(185000);
    const p = computeMonthPlan({ ...scope, daysInMonth: 31, dayOfMonth: 3 });
    expect(p.leftCents).toBe(70000 - 4100 - 2000);
  });
});
