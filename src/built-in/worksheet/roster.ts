// roster.ts — Worksheets: a roster, one tagged set of problems worked down
// day by day.
//
// PURE (unit-tested in tests/unit/worksheetRoster.test.ts). A roster is a tag
// and a run of days. Each day the student quizzes every tagged problem still
// starred, in a new order, and unstars the ones they get right the first
// time, so the set shrinks. From the attempts and the star log: what was done
// each day, what was unstarred, what was left at the end of it, by paper.
import { dayKey } from './progressInsights.js';
import { itemTags } from './practiceSession.js';
import { normalizeRating } from './problemImport.js';
import { addDays } from './campaign.js';

export interface RosterSpec { readonly tag: string; readonly startDay: string; readonly endDay: string }
export interface RosterItem { readonly id: number; readonly paper: string; readonly tags: string; readonly starred: boolean }
export interface RosterAttempt { readonly itemId: number; readonly selfGrade: string; readonly at: number; readonly imported: boolean }
/** A real change of a star (worksheet_018), oldest first or in any order. */
export interface StarChange { readonly itemId: number; readonly starred: boolean; readonly at: number }
export interface RosterDay {
  readonly day: string;
  /** Problems rated that day, each once. */
  readonly done: number;
  /** Starred when the day began, not when it ended. */
  readonly unstarred: number;
  /** Still starred at the end of the day (now, for today). */
  readonly left: number;
  readonly state: 'past' | 'today' | 'future';
}
export interface RosterPaper { readonly paper: string; readonly total: number; readonly left: number }
export interface RosterProgress {
  readonly today: string;
  readonly total: number;
  readonly left: number;
  /** The problems still starred: what today's roster quizzes. */
  readonly leftIds: number[];
  readonly doneToday: number;
  readonly unstarredToday: number;
  readonly days: RosterDay[];
  readonly papers: RosterPaper[];
  /** 1-based; 0 before the first day, past the length after the last. */
  readonly dayIndex: number;
  readonly length: number;
}

/** The roster's name from its tag: final-roster reads Final Roster. */
export function rosterTitle(tag: string): string {
  return tag.split(/[-_\s]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ') || 'Roster';
}

export function rosterItems<T extends RosterItem>(items: readonly T[], tag: string): T[] {
  const want = tag.trim().toLowerCase();
  if (!want) return [];
  return items.filter((i) => itemTags(i.tags).some((t) => t.toLowerCase() === want));
}

function dayStartMs(day: string): number { return Date.parse(`${day}T00:00:00`); }

export function rosterProgress(spec: RosterSpec, items: readonly RosterItem[], attempts: readonly RosterAttempt[], changes: readonly StarChange[], now: number = Date.now()): RosterProgress {
  const today = dayKey(now);
  const set = rosterItems(items, spec.tag);
  const ids = new Set(set.map((i) => i.id));
  const byItem = new Map<number, StarChange[]>();
  for (const c of changes) {
    if (!ids.has(c.itemId)) continue;
    const list = byItem.get(c.itemId) ?? [];
    list.push(c);
    byItem.set(c.itemId, list);
  }
  for (const list of byItem.values()) list.sort((a, b) => a.at - b.at);
  // The star at a moment: undo every change after it, from the star now.
  const starredAt = (item: RosterItem, t: number): boolean => {
    const next = byItem.get(item.id)?.find((c) => c.at > t);
    return next ? !next.starred : item.starred;
  };
  const doneBy = new Map<string, Set<number>>();
  for (const a of attempts) {
    if (a.imported || !ids.has(a.itemId) || !normalizeRating(a.selfGrade)) continue;
    const d = dayKey(a.at);
    const s = doneBy.get(d) ?? new Set<number>();
    s.add(a.itemId);
    doneBy.set(d, s);
  }
  const days: RosterDay[] = [];
  for (let d = spec.startDay; d <= spec.endDay && days.length < 60; d = addDays(d, 1)) {
    const state = d < today ? 'past' : d === today ? 'today' : 'future';
    if (state === 'future') { days.push({ day: d, done: 0, unstarred: 0, left: 0, state }); continue; }
    const from = dayStartMs(d);
    const to = state === 'today' ? now : dayStartMs(addDays(d, 1)) - 1;
    let unstarred = 0, left = 0;
    for (const i of set) {
      const end = starredAt(i, to);
      if (end) left++;
      else if (starredAt(i, from - 1)) unstarred++;
    }
    days.push({ day: d, done: doneBy.get(d)?.size ?? 0, unstarred, left, state });
  }
  const papers = new Map<string, { total: number; left: number }>();
  for (const i of set) {
    const p = papers.get(i.paper) ?? { total: 0, left: 0 };
    p.total++;
    if (i.starred) p.left++;
    papers.set(i.paper, p);
  }
  const todayRow = days.find((d) => d.state === 'today');
  const leftIds = set.filter((i) => i.starred).map((i) => i.id);
  const length = days.length;
  const dayIndex = today < spec.startDay ? 0 : today > spec.endDay ? length + 1 : days.findIndex((d) => d.day === today) + 1;
  return {
    today, total: set.length, left: leftIds.length, leftIds,
    doneToday: todayRow?.done ?? doneBy.get(today)?.size ?? 0,
    unstarredToday: todayRow?.unstarred ?? 0,
    days,
    papers: [...papers].map(([paper, p]) => ({ paper, ...p })).sort((a, b) => b.left - a.left || a.paper.localeCompare(b.paper)),
    dayIndex, length,
  };
}

/** A new order (Fisher-Yates); `rng` is injectable for tests. */
export function shuffled(ids: readonly number[], rng: () => number = Math.random): number[] {
  const out = [...ids];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
