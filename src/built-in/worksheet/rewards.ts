// rewards.ts — Worksheets: rewards on top of the campaign's XP.
//
// PURE (unit-tested in tests/unit/worksheetRewards.test.ts). A reward is a
// named milestone with an XP bonus. Whether it is earned is decided from the
// campaign's progress, the attempts and the quizzes finished; when it was
// first earned is stored (ws_reward) so it stays earned and dated even if
// the campaign later ends. The XP of every earned reward is added to the
// campaign's XP, so rewards move the level (rewardsSync.ts).
import type { CampaignProgress } from './campaign.js';
import type { InsightAttempt, InsightItem } from './progressInsights.js';
import { normalizeRating } from './problemImport.js';

export interface RewardContext {
  /** The running campaign's progress, without the reward bonus; null when none runs. */
  readonly progress: CampaignProgress | null;
  readonly items: readonly InsightItem[];
  readonly attempts: readonly InsightAttempt[];
  readonly quizzesFinished: number;
}
export interface RewardDef {
  readonly id: string;
  readonly title: string;
  readonly hint: string;
  /** Icon registry id. */
  readonly icon: string;
  readonly xp: number;
  readonly earned: (ctx: RewardContext) => boolean;
}

/** A problem rated Hard and, later, rated Easy: the comeback. Imported ratings never count. */
export function turnedAround(attempts: readonly InsightAttempt[]): boolean {
  const firstHard = new Map<number, number>();
  const sorted = attempts.filter((a) => !a.imported).sort((a, b) => a.at - b.at);
  for (const a of sorted) {
    const r = normalizeRating(a.selfGrade);
    if (r === 'hard') { if (!firstHard.has(a.itemId)) firstHard.set(a.itemId, a.at); }
    else if (r === 'easy') { const hardAt = firstHard.get(a.itemId); if (hardAt !== undefined && a.at > hardAt) return true; }
  }
  return false;
}

const p = (c: RewardContext) => c.progress;

export const REWARDS: readonly RewardDef[] = [
  { id: 'first-step', title: 'First Step', hint: 'Rate the first problem of a campaign.', icon: 'footprints', xp: 25, earned: (c) => (p(c)?.done ?? 0) >= 1 },
  { id: 'full-day', title: 'Full Day', hint: 'Meet a whole day\'s quota.', icon: 'calendar-check', xp: 50, earned: (c) => (p(c)?.fullDays ?? 0) >= 1 },
  { id: 'streak-3', title: 'Three Straight', hint: 'Three full days in a row.', icon: 'flame', xp: 100, earned: (c) => (p(c)?.streak ?? 0) >= 3 },
  { id: 'streak-7', title: 'Seven Straight', hint: 'A full week of full days.', icon: 'zap', xp: 250, earned: (c) => (p(c)?.streak ?? 0) >= 7 },
  { id: 'streak-14', title: 'Fortnight', hint: 'Fourteen full days in a row.', icon: 'mountain', xp: 500, earned: (c) => (p(c)?.streak ?? 0) >= 14 },
  { id: 'done-25', title: 'Twenty-Five Down', hint: 'Twenty-five problems rated in the campaign.', icon: 'milestone', xp: 100, earned: (c) => (p(c)?.done ?? 0) >= 25 },
  { id: 'done-50', title: 'Fifty Down', hint: 'Fifty problems rated in the campaign.', icon: 'medal', xp: 150, earned: (c) => (p(c)?.done ?? 0) >= 50 },
  { id: 'done-100', title: 'One Hundred', hint: 'A hundred problems rated in the campaign.', icon: 'award', xp: 300, earned: (c) => (p(c)?.done ?? 0) >= 100 },
  { id: 'done-200', title: 'Two Hundred', hint: 'Two hundred problems rated in the campaign.', icon: 'gem', xp: 500, earned: (c) => (p(c)?.done ?? 0) >= 200 },
  { id: 'done-all', title: 'Every Last One', hint: 'Every problem in the bank, rated.', icon: 'trophy', xp: 1000, earned: (c) => !!p(c)?.finished },
  { id: 'paper-1', title: 'First Paper Cleared', hint: 'Every problem of one paper rated.', icon: 'book-open', xp: 150, earned: (c) => (p(c)?.clearedPapers.length ?? 0) >= 1 },
  { id: 'paper-5', title: 'Five Papers Cleared', hint: 'Five papers with nothing left in them.', icon: 'shield', xp: 400, earned: (c) => (p(c)?.clearedPapers.length ?? 0) >= 5 },
  { id: 'papers-all', title: 'Every Paper', hint: 'Every paper cleared.', icon: 'crown', xp: 800, earned: (c) => { const q = p(c); return !!q && q.papers.length > 0 && q.clearedPapers.length === q.papers.length; } },
  { id: 'ahead', title: 'Ahead Of Pace', hint: 'A full day ahead of the plan.', icon: 'rocket', xp: 200, earned: (c) => { const q = p(c); return !!q && q.target > 0 && q.delta >= q.target; } },
  { id: 'turned-around', title: 'Turned It Around', hint: 'A problem rated Hard, later rated Easy.', icon: 'repeat', xp: 150, earned: (c) => turnedAround(c.attempts) },
  { id: 'quizzes-10', title: 'Ten Quizzes', hint: 'Finish ten quizzes.', icon: 'list-checks', xp: 200, earned: (c) => c.quizzesFinished >= 10 },
  { id: 'quizzes-25', title: 'Twenty-Five Quizzes', hint: 'Finish twenty-five quizzes.', icon: 'star', xp: 400, earned: (c) => c.quizzesFinished >= 25 },
];

export function earnedRewards(ctx: RewardContext): RewardDef[] {
  return REWARDS.filter((r) => { try { return r.earned(ctx); } catch { return false; } });
}

/** The XP bonus of the rewards with these ids. */
export function rewardXp(unlocked: Iterable<string>): number {
  const ids = new Set(unlocked);
  let xp = 0;
  for (const r of REWARDS) if (ids.has(r.id)) xp += r.xp;
  return xp;
}
