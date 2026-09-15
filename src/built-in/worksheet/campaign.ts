// campaign.ts — Worksheets: the campaign, every problem in the bank in N days.
//
// PURE (unit-tested in tests/unit/worksheetCampaign.test.ts). A campaign is
// a start day, a length and a daily target. Progress counts problems rated
// since it began (imported ratings never count, and a problem counts once,
// on the day it was first rated in the campaign). From that: today's quota,
// pace against the plan, the streak of full days, XP and a level, one
// square per day, and which papers are cleared. The draw picks each day's
// problems across all papers, deterministically for that day. Rest days are
// weekdays with no quota: the target is set over working days, the streak
// and the pace step over them, and the dashboard gives them to repeats.
// Essay sheets (one per paper, ten or more questions each) are not campaign
// problems: they live on as flashcards.
import { normalizeRating } from './problemImport.js';
import { dayKey, type InsightItem, type InsightAttempt } from './progressInsights.js';

export interface Campaign {
  readonly startDay: string;
  readonly days: number;
  /** The quota as planned at the start; progress recomputes it from the bank. */
  readonly dailyTarget: number;
  readonly startedAt: number;
  /** Weekdays with no quota, 0 = Sunday .. 6 = Saturday. */
  readonly restDays: readonly number[];
}
export interface CampaignDay {
  readonly day: string;
  readonly index: number;
  readonly done: number;
  readonly target: number;
  readonly state: 'full' | 'partial' | 'missed' | 'today' | 'future' | 'rest';
  /** A rest day: no quota, never full, never missed. Today's rest day reads 'today'. */
  readonly rest: boolean;
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
  /** Today is a rest day: no quota, no draw. */
  readonly restToday: boolean;
  /** Planned days that carry a quota. */
  readonly workingDays: number;
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

/** A workbook problem the campaign counts, draws and clears: has a paper, is not an essay sheet. */
export function isCampaignProblem(item: Pick<InsightItem, 'paper' | 'kind'>): boolean {
  return !!item.paper && item.kind !== 'essay';
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return dayKey(new Date(y, m - 1, d + n).getTime());
}
function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((new Date(by, bm - 1, bd).getTime() - new Date(ay, am - 1, ad).getTime()) / 86400000);
}

/** Calendar days from `startDay` to `endDay`, both included. */
export function spanDays(startDay: string, endDay: string): number {
  return daysBetween(startDay, endDay) + 1;
}

export const WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export function weekdayOf(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}
/** Valid weekdays only, Monday first; all seven off means none off. */
export function normalizeRestDays(restDays: readonly number[]): number[] {
  const set = new Set(restDays.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6));
  if (set.size >= 7) return [];
  return [...set].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
}
export function isRestDay(restDays: readonly number[], day: string): boolean {
  return restDays.includes(weekdayOf(day));
}
/** Planned days that carry a quota. */
export function workingDays(startDay: string, days: number, restDays: readonly number[]): number {
  let n = 0;
  for (let i = 0; i < days; i++) if (!isRestDay(restDays, addDays(startDay, i))) n++;
  return n;
}
/** "Fridays off", "Fridays and Sundays off", or '' when every day counts. */
export function restDaysLabel(restDays: readonly number[]): string {
  const names = normalizeRestDays(restDays).map((d) => `${WEEKDAY_LABELS[d]}s`);
  if (names.length === 0) return '';
  if (names.length === 1) return `${names[0]} off`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} off`;
}

export function planCampaign(total: number, days: number, startedAt: number = Date.now(), restDays: readonly number[] = []): Campaign {
  const d = Math.max(1, Math.round(days));
  const startDay = dayKey(startedAt);
  const rest = normalizeRestDays(restDays);
  const working = Math.max(1, workingDays(startDay, d, rest));
  return { startDay, days: d, dailyTarget: Math.max(1, Math.ceil(Math.max(0, total) / working)), startedAt, restDays: rest };
}

/** Problems rated in the campaign, each with the day it first counted and its latest rating. */
function campaignRatings(campaign: Campaign, items: readonly InsightItem[], attempts: readonly InsightAttempt[]): Map<number, { day: string; latest: string }> {
  const known = new Set(items.filter(isCampaignProblem).map((i) => i.id));
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

export function campaignProgress(campaign: Campaign, items: readonly InsightItem[], attempts: readonly InsightAttempt[], now: number = Date.now(), bonusXp = 0): CampaignProgress {
  const problems = items.filter(isCampaignProblem);
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
  const rest = (day: string) => isRestDay(campaign.restDays ?? [], day);
  // The quota follows the bank: what the campaign holds now over the working
  // days planned, so an import or an exclusion after the start never leaves
  // a stale target behind.
  const working = Math.max(1, workingDays(campaign.startDay, campaign.days, campaign.restDays ?? []));
  const target = Math.max(1, Math.ceil(total / working));
  const days: CampaignDay[] = [];
  let fullDays = 0;
  let workingThroughToday = 0;
  for (let i = 0; i < campaign.days; i++) {
    const day = addDays(campaign.startDay, i);
    const n = doneByDay.get(day) ?? 0;
    const r = rest(day);
    if (!r && day <= today) workingThroughToday++;
    const full = !r && n >= target;
    if (full && day <= today) fullDays++;
    const state: CampaignDay['state'] = day === today && !full ? 'today' : r ? 'rest' : day > today ? 'future' : full ? 'full' : n > 0 ? 'partial' : 'missed';
    days.push({ day, index: i + 1, done: n, target, state, rest: r });
  }
  // Days past the planned end still count for the streak and XP; rest days never do.
  const endDay = addDays(campaign.startDay, campaign.days - 1);
  for (const [day, n] of doneByDay) {
    if (day > endDay && day <= today && !rest(day) && n >= target) fullDays++;
  }
  // Streak: consecutive full working days ending today (if full) or the last
  // working day before it. Rest days are stepped over, never broken on.
  const fullOn = (day: string) => !rest(day) && (doneByDay.get(day) ?? 0) >= target;
  let streak = 0;
  let cursor = fullOn(today) ? today : addDays(today, -1);
  while (cursor >= campaign.startDay) {
    if (rest(cursor)) { cursor = addDays(cursor, -1); continue; }
    if (!fullOn(cursor)) break;
    streak++;
    cursor = addDays(cursor, -1);
  }

  const restToday = rest(today);
  const doneToday = doneByDay.get(today) ?? 0;
  const remaining = Math.max(0, total - done);
  const leftToday = restToday ? 0 : Math.min(remaining, Math.max(0, target - doneToday));
  const expectedByToday = Math.min(total, target * workingThroughToday);
  // Rewards (rewards.ts) add their XP on top, so they move the level.
  const xp = done * XP_PER_PROBLEM + easy * XP_EASY_BONUS + fullDays * XP_FULL_DAY + Math.max(0, bonusXp);

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
    dayIndex, total, done, remaining, doneToday, target, leftToday, restToday, workingDays: working,
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
  const pool = items.filter((i) => isCampaignProblem(i) && !done.has(i.id));
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
