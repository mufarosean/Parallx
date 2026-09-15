// Worksheets: rewards on top of the campaign's XP, and the bonus moving the level.
import { describe, it, expect } from 'vitest';
import { REWARDS, earnedRewards, rewardXp, turnedAround } from '../../src/built-in/worksheet/rewards.js';
import { planCampaign, campaignProgress, XP_PER_LEVEL } from '../../src/built-in/worksheet/campaign.js';

const DAY = 86400000;
const START = Date.parse('2026-09-08T09:00:00');
const NOW = Date.parse('2026-09-11T12:00:00');
const item = (id: number, paper: string) => ({ id, title: `P${id}`, paper, source: 'rf', kind: 'quant', quadrant: 0, attemptState: '', attemptCount: 0, seconds: 0, lastAttemptAt: 0 });
const attempt = (itemId: number, selfGrade: string, at: number, imported = false) => ({ itemId, selfGrade, at, seconds: 60, imported });
const bank = [item(1, 'brosius'), item(2, 'brosius'), item(3, 'clark'), item(4, 'clark')];
const campaign = planCampaign(4, 4, START); // 1 a day

describe('turnedAround', () => {
  it('is a Hard rating followed later by an Easy one on the same problem', () => {
    expect(turnedAround([attempt(1, 'hard', 1000), attempt(1, 'easy', 2000)])).toBe(true);
    expect(turnedAround([attempt(1, 'easy', 1000), attempt(1, 'hard', 2000)])).toBe(false);
    expect(turnedAround([attempt(1, 'hard', 1000), attempt(2, 'easy', 2000)])).toBe(false);
    expect(turnedAround([attempt(1, 'hard', 1000, true), attempt(1, 'easy', 2000)])).toBe(false);
  });
});

describe('earnedRewards', () => {
  it('needs a campaign for the campaign milestones', () => {
    const none = earnedRewards({ progress: null, items: bank, attempts: [], quizzesFinished: 0 });
    expect(none).toEqual([]);
    const quizzes = earnedRewards({ progress: null, items: bank, attempts: [attempt(1, 'hard', 1), attempt(1, 'easy', 2)], quizzesFinished: 10 });
    expect(quizzes.map((r) => r.id)).toEqual(['turned-around', 'quizzes-10']);
  });
  it('reads the campaign: first step, full days, streak, cleared papers, ahead of pace', () => {
    const attempts = [attempt(1, 'easy', START + 3600000), attempt(2, 'easy', START + DAY), attempt(3, 'easy', START + 2 * DAY), attempt(4, 'easy', START + 3 * DAY)];
    const progress = campaignProgress(campaign, bank, attempts, NOW);
    const ids = earnedRewards({ progress, items: bank, attempts, quizzesFinished: 0 }).map((r) => r.id);
    expect(ids).toContain('first-step');
    expect(ids).toContain('full-day');
    expect(ids).toContain('streak-3');
    expect(ids).toContain('paper-1');
    expect(ids).toContain('papers-all');
    expect(ids).toContain('done-all');
    expect(ids).not.toContain('done-25');
    expect(ids).not.toContain('streak-7');
  });
  it('has unique ids and positive XP', () => {
    expect(new Set(REWARDS.map((r) => r.id)).size).toBe(REWARDS.length);
    expect(REWARDS.every((r) => r.xp > 0 && r.title && r.hint && r.icon)).toBe(true);
  });
});

describe('reward XP on the campaign', () => {
  it('sums the unlocked rewards and moves the level', () => {
    expect(rewardXp(['first-step', 'full-day'])).toBe(75);
    expect(rewardXp(['nope'])).toBe(0);
    const attempts = [attempt(1, 'medium', START + 3600000)];
    const base = campaignProgress(campaign, bank, attempts, NOW);
    const boosted = campaignProgress(campaign, bank, attempts, NOW, XP_PER_LEVEL);
    expect(boosted.xp).toBe(base.xp + XP_PER_LEVEL);
    expect(boosted.level.level).toBe(base.level.level + 1);
  });
});
