// campaign.ts — Worksheets: the campaign, every problem in the bank in N days.
//
// PURE (unit-tested in tests/unit/worksheetCampaign.test.ts). A campaign is
// a start day, a length and a daily target. Progress counts problems rated
// since it began (imported ratings never count, and a problem counts once,
// on the day it was first rated in the campaign). From that: today's quota,
// pace against the plan, the streak of full days, XP and a level, one
// square per day, and which papers are cleared. The draw picks each day's
// problems across all papers, deterministically for that day.
import { normalizeRating } from './problemImport.js';
import { dayKey, type InsightItem, type InsightAttempt } from './progressInsights.js';

export interface Campaign {
  readonly startDay: string;
  readonly days: number;
  readonly dailyTarget: number;
  readonly startedAt: number;
}
export interface CampaignDay {
  readonly day: string;
  readonly index: number;
  readonly done: number;
  readonly target: number;
  readonly state: 'full' | 'partial' | 'missed' | 'today' | 'future';
}
export interface CampaignLevel { readonly level: number; readonly title: string; readonly floor: number; readonly nextAt: number }
export interface CampaignPaper { readonly paper: string; readonly total: number; readonly done: number }
export interface CampaignProgress {
  readonly dayIndex: number;
  readonly total: number;
  readonly done: number;
  readonly remaining: number;
  readonly doneToday: number;
  readonly target: number;
  readonly leftToday: number;
  /** What the plan expected done by the end of today. */
  readonly expectedByToday: number;
  /** done minus expected: positive is ahead. */
  readonly delta: number;
  readonly streak: number;
  readonly fullDays: number;
  readonly xp: number;
  readonly level: CampaignLevel;
  readonly days: CampaignDay[];
  readonly papers: CampaignPaper[];
  readonly clearedPapers: string[];
  readonly finished: boolean;
}

export const LEVEL_TITLES = ['Warm-Up', 'Showing Up', 'Steady', 'On Pace', 'Grinding', 'Relentless', 'Locked In', 'Unstoppable', 'Fellow Material', 'Legend'];
export const XP_PER_PROBLEM = 10;
export const XP_EASY_BONUS = 5;
export const XP_FULL_DAY = 50;
export const XP_PER_LEVEL = 300;

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return dayKey(new Date(y, m - 1, d + n).getTime());
}
function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((new Date(by, bm - 1, bd).getTime() - new Date(ay, am - 1, ad).getTime()) / 86400000);
}

export function planCampaign(total: number, days: number, startedAt: number = Date.now()): Campaign {
  const d = Math.max(1, Math.round(days));
  return { startDay: dayKey(startedAt), days: d, dailyTarget: Math.max(1, Math.ceil(Math.max(0, total) / d)), startedAt };
}

/** Problems rated in the campaign, each with the day it first counted and its latest rating. */
function campaignRatings(campaign: Campaign, items: readonly InsightItem[], attempts: readonly InsightAttempt[]): Map<number, { day: string; latest: string }> {
  const known = new Set(items.filter((i) => i.paper).map((i) => i.id));
  const out = new Map<number, { day: string; latest: string; at: number }>();
  for (const a of attempts) {
    if (a.imported || a.at < campaign.startedAt || !known.has(a.itemId) || !normalizeRating(a.selfGrade)) continue;
    const day = dayKey(a.at);
    const cur = out.get(a.itemId);
    if (!cur) out.set(a.itemId, { day, latest: normalizeRating(a.selfGrade), at: a.at });
    else {
      if (day < cur.day) cur.day = day;
      if (a.at >= cur.at) { cur.latest = normalizeRating(a.selfGrade); cur.at = a.at; }
    }
  }
  return out;
}
/** The problems already done in this campaign. */
export function campaignDone(campaign: Campaign, items: readonly InsightItem[], attempts: readonly InsightAttempt[]): Set<number> {
  return new Set(campaignRatings(campaign, items, attempts).keys());
}

export function levelFor(xp: number): CampaignLevel {
  const level = Math.min(LEVEL_TITLES.length, Math.floor(Math.max(0, xp) / XP_PER_LEVEL) + 1);
  return { level, title: LEVEL_TITLES[level - 1], floor: (level - 1) * XP_PER_LEVEL, nextAt: level * XP_PER_LEVEL };
}

export function campaignProgress(campaign: Campaign, items: readonly InsightItem[], attempts: readonly InsightAttempt[], now: number = Date.now()): CampaignProgress {
  const problems = items.filter((i) => i.paper);
  const total = problems.length;
  const ratings = campaignRatings(campaign, items, attempts);
  const today = dayKey(now);
  const dayIndex = Math.max(1, daysBetween(campaign.startDay, today) + 1);

  const doneByDay = new Map<string, number>();
  let easy = 0;
  for (const r of ratings.values()) {
    doneByDay.set(r.day, (doneByDay.get(r.day) ?? 0) + 1);
    if (r.latest === 'easy') easy++;
  }
  const done = ratings.size;
  const target = campaign.dailyTarget;
  const days: CampaignDay[] = [];
  let fullDays = 0;
  for (let i = 0; i < campaign.days; i++) {
    const day = addDays(campaign.startDay, i);
    const n = doneByDay.get(day) ?? 0;
    const full = n >= target;
    if (full && day <= today) fullDays++;
    const state: CampaignDay['state'] = day > today ? 'future' : full ? 'full' : day === today ? 'today' : n > 0 ? 'partial' : 'missed';
    days.push({ day, index: i + 1, done: n, target, state });
  }
  // Days past the planned end still count for the streak and XP.
  for (const [day, n] of doneByDay) {
    if (day > addDays(campaign.startDay, campaign.days - 1) && day <= today && n >= target) fullDays++;
  }
  // Streak: consecutive full days ending today (if full) or yesterday.
  let streak = 0;
  let cursor = (doneByDay.get(today) ?? 0) >= target ? today : addDays(today, -1);
  while (cursor >= campaign.startDay && (doneByDay.get(cursor) ?? 0) >= target) { streak++; cursor = addDays(cursor, -1); }

  const doneToday = doneByDay.get(today) ?? 0;
  const remaining = Math.max(0, total - done);
  const leftToday = Math.min(remaining, Math.max(0, target - doneToday));
  const expectedByToday = Math.min(total, target * Math.min(dayIndex, campaign.days));
  const xp = done * XP_PER_PROBLEM + easy * XP_EASY_BONUS + fullDays * XP_FULL_DAY;

  const byPaper = new Map<string, { total: number; done: number }>();
  for (const it of problems) {
    const e = byPaper.get(it.paper) ?? { total: 0, done: 0 };
    e.total++;
    if (ratings.has(it.id)) e.done++;
    byPaper.set(it.paper, e);
  }
  const papers = [...byPaper.entries()].map(([paper, v]) => ({ paper, ...v })).sort((a, b) => a.paper.localeCompare(b.paper));
  const clearedPapers = papers.filter((p) => p.total > 0 && p.done >= p.total).map((p) => p.paper);

  return {
    dayIndex, total, done, remaining, doneToday, target, leftToday,
    expectedByToday, delta: done - expectedByToday,
    streak, fullDays, xp, level: levelFor(xp), days, papers, clearedPapers,
    finished: total > 0 && done >= total,
  };
}

function hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h;
}

/**
 * Today's draw: `count` problems not yet done in the campaign, taken round
 * robin across papers (largest remaining first), never-attempted problems
 * ahead of ones seen before, in an order fixed by the day so the draw does
 * not reshuffle every time the dashboard is opened.
 */
export function drawToday(campaign: Campaign, items: readonly InsightItem[], attempts: readonly InsightAttempt[], count: number, day: string): number[] {
  const done = campaignDone(campaign, items, attempts);
  const pool = items.filter((i) => i.paper && !done.has(i.id));
  const byPaper = new Map<string, InsightItem[]>();
  for (const it of pool) { if (!byPaper.has(it.paper)) byPaper.set(it.paper, []); byPaper.get(it.paper)!.push(it); }
  const rank = (it: InsightItem) => (it.attemptCount === 0 && !it.attemptState ? 0 : 1);
  const queues = [...byPaper.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([, list]) => list.sort((a, b) => rank(a) - rank(b) || hash(`${day}:${a.id}`) - hash(`${day}:${b.id}`)));
  const out: number[] = [];
  const n = Math.max(0, Math.min(count, pool.length));
  while (out.length < n) {
    let took = false;
    for (const q of queues) {
      if (out.length >= n) break;
      const next = q.shift();
      if (next) { out.push(next.id); took = true; }
    }
    if (!took) break;
  }
  return out;
}
