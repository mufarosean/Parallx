// Worksheets: campaign rest days. Weekdays with no quota: the target is set
// over working days, rest squares are neither full nor missed, the streak and
// the pace step over them, and today-as-rest-day carries no quota.
import { describe, it, expect } from 'vitest';
import {
  planCampaign, campaignProgress, campaignDone, drawToday, spanDays, workingDays, restDaysLabel, normalizeRestDays, isRestDay, weekdayOf, isCampaignProblem,
} from '../../src/built-in/worksheet/campaign.js';

const DAY = 86400000;
const START = Date.parse('2026-09-08T09:00:00'); // a Tuesday
const FRI = Date.parse('2026-09-11T12:00:00');
const THU = Date.parse('2026-09-10T12:00:00');
const item = (id: number, paper: string) => ({
  id, title: `P${id}`, paper, source: 'rf', kind: 'quant', quadrant: 0, attemptState: '', attemptCount: 0, seconds: 0, lastAttemptAt: 0,
});
const attempt = (itemId: number, selfGrade: string, at: number) => ({ itemId, selfGrade, at, seconds: 60, imported: false });

const bank = [item(1, 'brosius'), item(2, 'brosius'), item(3, 'brosius'), item(4, 'clark'), item(5, 'clark'), item(6, 'clark')];
// Tue, Wed, Thu (rest), Fri: 6 problems over 3 working days = 2 a day.
const campaign = planCampaign(6, 4, START, [4]);

describe('planning with rest days', () => {
  it('sets the target over working days, not calendar days', () => {
    expect(campaign).toMatchObject({ startDay: '2026-09-08', days: 4, dailyTarget: 2, restDays: [4] });
    expect(workingDays('2026-09-08', 4, [4])).toBe(3);
    // Mufaro's plan: Monday 14 September to Monday 5 October, Fridays off.
    expect(spanDays('2026-09-14', '2026-10-05')).toBe(22);
    expect(workingDays('2026-09-14', 22, [5])).toBe(19);
    expect(planCampaign(331, 22, Date.parse('2026-09-14T08:00:00'), [5]).dailyTarget).toBe(18);
    expect(planCampaign(331, 22, Date.parse('2026-09-14T08:00:00')).dailyTarget).toBe(16);
  });
  it('knows weekdays and names the rest days', () => {
    expect(weekdayOf('2026-09-11')).toBe(5);
    expect(isRestDay([5], '2026-09-11')).toBe(true);
    expect(isRestDay([5], '2026-09-12')).toBe(false);
    expect(restDaysLabel([])).toBe('');
    expect(restDaysLabel([5])).toBe('Fridays off');
    expect(restDaysLabel([0, 5])).toBe('Fridays and Sundays off');
    expect(restDaysLabel([6, 0, 5])).toBe('Fridays, Saturdays and Sundays off');
    expect(normalizeRestDays([0, 1, 2, 3, 4, 5, 6])).toEqual([]);
    expect(normalizeRestDays([7, -1, 3, 3])).toEqual([3]);
  });
});

describe('progress across a rest day', () => {
  const attempts = [
    attempt(1, 'easy', START + 3600000), attempt(2, 'easy', START + 2 * 3600000), // Tue: full
    attempt(3, 'hard', START + 1 * DAY), attempt(4, 'hard', START + 1 * DAY + 60000), // Wed: full
    // Thu: rest, nothing
    attempt(5, 'medium', FRI - 3600000), // Fri (today): one so far
  ];
  const p = campaignProgress(campaign, bank, attempts, FRI);
  it('marks the rest square and never counts it as missed or full', () => {
    expect(p.days.map((d) => d.state)).toEqual(['full', 'full', 'rest', 'today']);
    expect(p.days.map((d) => d.rest)).toEqual([false, false, true, false]);
    expect(p.fullDays).toBe(2);
    expect(p.workingDays).toBe(3);
    expect(p.restToday).toBe(false);
  });
  it('steps the streak over the rest day and paces by working days', () => {
    expect(p.streak).toBe(2);
    expect(p.expectedByToday).toBe(6);
    expect(p.done).toBe(5);
    expect(p.delta).toBe(-1);
    expect(p.leftToday).toBe(1);
    // Two full working days, five problems, two of them Easy.
    expect(p.xp).toBe(5 * 10 + 2 * 5 + 2 * 50);
  });
  it('gives a rest day no quota and no draw target', () => {
    const q = campaignProgress(campaign, bank, attempts.slice(0, 4), THU);
    expect(q.restToday).toBe(true);
    expect(q.leftToday).toBe(0);
    expect(q.expectedByToday).toBe(4);
    expect(q.delta).toBe(0);
    expect(q.streak).toBe(2);
    expect(q.days.map((d) => d.state)).toEqual(['full', 'full', 'today', 'future']);
    expect(q.days[2].rest).toBe(true);
  });
  it('does not pay a full-day bonus for work done on a rest day', () => {
    const busyRest = [...attempts.slice(0, 4), attempt(5, 'easy', THU), attempt(6, 'easy', THU + 60000)];
    const r = campaignProgress(campaign, bank, busyRest, FRI);
    expect(r.days[2]).toMatchObject({ state: 'rest', rest: true, done: 2 });
    expect(r.fullDays).toBe(2);
    expect(r.finished).toBe(true);
  });
});

describe('essay sheets stay out of the campaign', () => {
  // One RF_Essay sheet per paper: ten or more questions each, already flashcards.
  const essay = { ...item(7, 'clark'), kind: 'essay' };
  const withEssay = [...bank, essay];
  it('is not counted, not drawn, not needed to clear a paper, and never earns XP', () => {
    expect(isCampaignProblem(essay)).toBe(false);
    expect(isCampaignProblem(item(1, 'brosius'))).toBe(true);
    const all = bank.map((b, i) => attempt(b.id, 'easy', START + i * 60000));
    const p = campaignProgress(campaign, withEssay, [...all, attempt(7, 'easy', START + 3600000)], FRI);
    expect(p.total).toBe(6);
    expect(p.done).toBe(6);
    expect(p.finished).toBe(true);
    expect(p.clearedPapers).toEqual(['brosius', 'clark']);
    // All six rated on the first day: one full day, the essay's rating worth nothing.
    expect(p.xp).toBe(6 * 10 + 6 * 5 + 1 * 50);
    expect(drawToday(campaign, withEssay, [], 10, '2026-09-08')).not.toContain(7);
    expect(campaignDone(campaign, withEssay, [attempt(7, 'easy', START + 60000)]).size).toBe(0);
  });
  it('recomputes the quota from the bank, so a target stored before an exclusion goes stale harmlessly', () => {
    // Started when the essay still counted: 7 over 3 working days = 3 a day.
    const stale = { ...campaign, dailyTarget: 3 };
    const p = campaignProgress(stale, withEssay, [], FRI);
    expect(p.target).toBe(2);
    expect(p.leftToday).toBe(2);
    expect(p.expectedByToday).toBe(6);
    // And a bigger bank raises it: 12 problems over 3 working days.
    const bigger = [...bank, ...bank.map((b) => ({ ...b, id: b.id + 100 }))];
    expect(campaignProgress(campaign, bigger, [], FRI).target).toBe(4);
  });
});
