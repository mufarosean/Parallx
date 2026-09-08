// Worksheets: the campaign arithmetic. Every problem in N days, a quota per
// day, pace, streak, XP and levels, cleared papers, and a daily draw across
// papers that does not reshuffle within the day.
import { describe, it, expect } from 'vitest';
import { planCampaign, campaignProgress, drawToday, campaignDone, addDays, levelFor, LEVEL_TITLES, XP_PER_LEVEL } from '../../src/built-in/worksheet/campaign.js';

const DAY = 86400000;
const START = Date.parse('2026-09-08T09:00:00');
const NOW = Date.parse('2026-09-11T12:00:00'); // day 4 of the campaign
const item = (id: number, paper: string, attemptState = '', attemptCount = 0) => ({
  id, title: `P${id}`, paper, source: 'rf', kind: 'quant', quadrant: 0, attemptState, attemptCount, seconds: 0, lastAttemptAt: 0,
});
const attempt = (itemId: number, selfGrade: string, at: number, imported = false) => ({ itemId, selfGrade, at, seconds: 60, imported });

const bank = [
  item(1, 'brosius'), item(2, 'brosius'), item(3, 'brosius'), item(4, 'brosius'),
  item(5, 'clark'), item(6, 'clark', 'hard', 1), item(7, 'clark'), item(8, 'clark'),
  item(9, '', 'easy', 1), // generated, never part of a campaign
];
const campaign = planCampaign(8, 4, START); // 2 a day

describe('planCampaign', () => {
  it('sizes the daily target from what is left and the days given', () => {
    expect(campaign).toMatchObject({ startDay: '2026-09-08', days: 4, dailyTarget: 2 });
    expect(planCampaign(331, 18).dailyTarget).toBe(19);
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
  });
});

describe('campaignProgress', () => {
  const attempts = [
    attempt(1, 'easy', START + 1 * 3600000), attempt(2, 'hard', START + 2 * 3600000),   // day 1: full
    attempt(3, 'medium', START + 1 * DAY),                                               // day 2: partial
    attempt(3, 'easy', START + 1 * DAY + 3600000),                                       // re-rated the same day: still one problem
                                                                                         // day 3: missed
    attempt(5, 'easy', NOW - 3600000),                                                   // day 4 (today): one so far
    attempt(6, 'hard', START - 5 * DAY),                                                 // before the campaign: does not count
    attempt(7, 'easy', START + 2 * DAY, true),                                           // imported: never counts
    attempt(9, 'easy', START + 1 * DAY),                                                 // generated item: not a workbook problem
  ];
  const p = campaignProgress(campaign, bank, attempts, NOW);
  it('counts each problem once, on the day it first counted, workbook problems only', () => {
    expect(p.total).toBe(8);
    expect(p.done).toBe(4);
    expect(p.remaining).toBe(4);
    expect(p.dayIndex).toBe(4);
    expect(p.doneToday).toBe(1);
    expect(p.leftToday).toBe(1);
    expect(campaignDone(campaign, bank, attempts)).toEqual(new Set([1, 2, 3, 5]));
  });
  it('knows the pace and the streak', () => {
    expect(p.expectedByToday).toBe(8);
    expect(p.delta).toBe(-4);
    expect(p.streak).toBe(0); // yesterday was missed
    expect(p.fullDays).toBe(1);
    expect(p.days.map((d) => d.state)).toEqual(['full', 'partial', 'missed', 'today']);
  });
  it('pays XP for problems, Easy and full days, and names the level', () => {
    // 4 problems, 3 latest-Easy (1, 3, 5), 1 full day.
    expect(p.xp).toBe(4 * 10 + 3 * 5 + 50);
    expect(p.level).toMatchObject({ level: 1, title: 'Warm-Up', floor: 0, nextAt: XP_PER_LEVEL });
    expect(levelFor(XP_PER_LEVEL * 3 + 1).title).toBe(LEVEL_TITLES[3]);
    expect(levelFor(10_000).level).toBe(LEVEL_TITLES.length);
  });
  it('tracks papers and clears one when every problem in it is done', () => {
    expect(p.papers).toEqual([{ paper: 'brosius', total: 4, done: 3 }, { paper: 'clark', total: 4, done: 1 }]);
    expect(p.clearedPapers).toEqual([]);
    const more = campaignProgress(campaign, bank, [...attempts, attempt(4, 'medium', NOW - 60000)], NOW);
    expect(more.clearedPapers).toEqual(['brosius']);
    expect(more.streak).toBe(1); // today became full
  });
  it('is finished when every problem is done', () => {
    const all = bank.filter((b) => b.paper).map((b, i) => attempt(b.id, 'easy', START + i * 60000));
    expect(campaignProgress(campaign, bank, all, NOW).finished).toBe(true);
  });
});

describe('drawToday', () => {
  const attempts = [attempt(1, 'easy', START + 3600000), attempt(5, 'easy', START + 3600000)];
  it('draws across papers, never-attempted first, and does not reshuffle within the day', () => {
    const draw = drawToday(campaign, bank, attempts, 4, '2026-09-11');
    expect(draw).toHaveLength(4);
    expect(draw).not.toContain(1);
    expect(draw).not.toContain(5);
    expect(draw).not.toContain(9);
    const papers = draw.map((id) => bank.find((b) => b.id === id)!.paper);
    expect(papers.filter((x) => x === 'brosius')).toHaveLength(2);
    expect(papers.filter((x) => x === 'clark')).toHaveLength(2);
    // Problem 6 was attempted before; it comes after Clark's untouched ones.
    expect(draw.indexOf(6)).toBe(-1);
    expect(drawToday(campaign, bank, attempts, 4, '2026-09-11')).toEqual(draw);
  });
  it('never asks for more than is left', () => {
    expect(drawToday(campaign, bank, attempts, 50, '2026-09-11')).toHaveLength(6);
  });
});
