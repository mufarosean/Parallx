// rewardsSync.ts — Worksheets: earn rewards and carry their XP.
//
// Called wherever the campaign is shown (Dashboard, Home). Works out what is
// earned now from the campaign's progress WITHOUT the bonus, stores the
// first unlock time of anything new, and returns the bonus XP that the
// panes then feed into campaignProgress so the level reflects it.
import { listRewardUnlocks, unlockRewards, countFinishedQuizSessions } from './worksheetData.js';
import { earnedRewards, rewardXp, type RewardDef } from './rewards.js';
import { campaignProgress, type Campaign } from './campaign.js';
import type { InsightAttempt, InsightItem } from './progressInsights.js';

export interface RewardState {
  /** Reward id to the time it was first earned. */
  readonly unlocks: Map<string, number>;
  /** Earned in this very call. */
  readonly fresh: RewardDef[];
  readonly bonusXp: number;
  readonly quizzesFinished: number;
}

export async function syncRewards(items: readonly InsightItem[], attempts: readonly InsightAttempt[], campaign: Campaign | null, now: number = Date.now()): Promise<RewardState> {
  const [unlocks, quizzesFinished] = await Promise.all([
    listRewardUnlocks().catch(() => new Map<string, number>()),
    countFinishedQuizSessions().catch(() => 0),
  ]);
  const progress = campaign ? campaignProgress(campaign, items, attempts, now) : null;
  const earned = earnedRewards({ progress, items, attempts, quizzesFinished });
  const fresh = earned.filter((r) => !unlocks.has(r.id));
  if (fresh.length > 0) {
    await unlockRewards(fresh.map((r) => r.id), now).catch(() => {});
    for (const r of fresh) unlocks.set(r.id, now);
  }
  return { unlocks, fresh, bonusXp: rewardXp(unlocks.keys()), quizzesFinished };
}
