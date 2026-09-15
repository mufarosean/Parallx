// Worksheets: the day's story on the campaign card. A day's tally counts the
// problems that first counted on it, split by the rating given that day, with
// the time on every rated attempt (repeats included), the papers touched and
// the XP earned. The story names the last day with work, whether today is the
// best day yet, and what the week (Monday through today) adds up to.
import { describe, it, expect } from 'vitest';
import { planCampaign, dayStory } from '../../src/built-in/worksheet/campaign.js';

const H = 3600000;
const START = Date.parse('2026-09-14T05:30:00'); // a Monday
const at = (day: string, hour: number) => Date.parse(`${day}T00:00:00`) + hour * H;
const item = (id: number, paper: string, kind = 'quant') => ({
  id, title: `P${id}`, paper, source: 'rf', kind, quadrant: 0, attemptState: '', attemptCount: 0, seconds: 0, lastAttemptAt: 0,
});
const rate = (itemId: number, selfGrade: string, when: number, seconds = 300, imported = false) => ({ itemId, selfGrade, at: when, seconds, imported });

// 8 problems over Mon..Thu with Friday off: 2 a day.
const bank = [item(1, 'brosius'), item(2, 'brosius'), item(3, 'clark'), item(4, 'clark'), item(5, 'mack'), item(6, 'mack'), item(7, 'siewert'), item(8, 'siewert'), item(9, 'siewert', 'essay')];
const campaign = planCampaign(8, 5, START, [5]);

describe('a day\'s tally', () => {
  it('splits the day by the rating given, times every attempt, and pays the full-day bonus', () => {
    const attempts = [
      rate(1, 'easy', at('2026-09-14', 6), 240),
      rate(3, 'hard', at('2026-09-14', 7), 900),
      rate(3, 'medium', at('2026-09-14', 8), 120), // re-rated the same day: Medium is the day's word
      rate(9, 'easy', at('2026-09-14', 9)), // an essay sheet: not a campaign problem
      rate(2, 'easy', at('2026-09-01', 9)), // before the campaign
      rate(5, 'easy', at('2026-09-14', 9), 0, true), // imported never counts
    ];
    const s = dayStory(campaign, bank, attempts, at('2026-09-14', 10));
    expect(s.today).toEqual({ day: '2026-09-14', done: 2, easy: 1, medium: 1, hard: 0, seconds: 1260, papers: 2, xp: 2 * 10 + 5 + 50, full: true, rest: false });
    expect(s.last).toBeNull();
    expect(s.best).toBeNull();
    expect(s.bestToday).toBe(false);
    expect(s.week).toEqual({ done: 2, easy: 1, medium: 1, hard: 0, seconds: 1260, fullDays: 1, days: 1, papers: 2 });
  });

  it('counts a repeat on its first day only, but keeps its time on the day it was worked', () => {
    const attempts = [
      rate(1, 'hard', at('2026-09-14', 6), 600),
      rate(1, 'easy', at('2026-09-15', 6), 200), // the comeback: no new problem today
      rate(2, 'medium', at('2026-09-15', 7), 400),
    ];
    const s = dayStory(campaign, bank, attempts, at('2026-09-15', 8));
    expect(s.today).toMatchObject({ done: 1, easy: 0, medium: 1, hard: 0, seconds: 600, full: false, xp: 10 });
    expect(s.last).toMatchObject({ day: '2026-09-14', done: 1, hard: 1, seconds: 600 });
    expect(s.lastAgo).toBe(1);
  });
});

describe('the story', () => {
  const attempts = [
    rate(1, 'easy', at('2026-09-14', 6)), rate(2, 'easy', at('2026-09-14', 7)), // Mon: 2, full
    rate(3, 'medium', at('2026-09-15', 6)), // Tue: 1
    rate(4, 'easy', at('2026-09-17', 6)), rate(5, 'hard', at('2026-09-17', 7)), rate(6, 'easy', at('2026-09-17', 8)), // Thu: 3, best
  ];
  it('looks back to the last day with work and says how far back it lies', () => {
    const wed = dayStory(campaign, bank, attempts, at('2026-09-16', 5));
    expect(wed.today.done).toBe(0);
    expect(wed.last?.day).toBe('2026-09-15');
    expect(wed.lastAgo).toBe(1);
    const thuMorning = dayStory(campaign, bank, attempts.slice(0, 3), at('2026-09-17', 5));
    expect(thuMorning.last?.day).toBe('2026-09-15');
    expect(thuMorning.lastAgo).toBe(2);
  });
  it('knows the best day yet, and that today beats it only once it has more', () => {
    const thuEarly = dayStory(campaign, bank, attempts.slice(0, 5), at('2026-09-17', 8));
    expect(thuEarly.best?.day).toBe('2026-09-14');
    expect(thuEarly.bestToday).toBe(false); // 2 done, ties Monday
    const thuLate = dayStory(campaign, bank, attempts, at('2026-09-17', 9));
    expect(thuLate.bestToday).toBe(true);
    // Friday, the rest day: Thursday is now the best, and the week is Monday through Friday.
    const fri = dayStory(campaign, bank, attempts, at('2026-09-18', 9));
    expect(fri.today).toMatchObject({ done: 0, rest: true, full: false });
    expect(fri.best?.day).toBe('2026-09-17');
    expect(fri.bestToday).toBe(false);
    expect(fri.week).toEqual({ done: 6, easy: 4, medium: 1, hard: 1, seconds: 1800, fullDays: 2, days: 3, papers: 3 });
  });
  it('starts the week over on Monday', () => {
    const nextMon = dayStory(campaign, bank, [...attempts, rate(7, 'easy', at('2026-09-21', 6))], at('2026-09-21', 7));
    expect(nextMon.week).toMatchObject({ done: 1, days: 1, papers: 1 });
    expect(nextMon.last?.day).toBe('2026-09-17');
    expect(nextMon.lastAgo).toBe(4);
  });
});
