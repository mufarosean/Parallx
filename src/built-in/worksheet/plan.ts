// plan.ts — Worksheets: a study plan, day by day, and the arithmetic over it.
//
// PURE (unit-tested in tests/unit/worksheetPlan.test.ts). A plan is data the
// user imports: a run of days, each with blocks in clock order. A block is a
// quiz drawn from named pools, an exam sat whole with a clock, or a session
// another tool runs (named by its command, finished when the activity
// journal says so). Nothing here names a tool: the plan's JSON carries the
// command ids and the journal lines to look for. There is no grading: the
// owner tracks by rating and starring, and an exam is done when it is sat.
//
// A day is full when every required block of it is done; the streak counts
// full days back from today; XP is the blocks' own XP plus a full-day bonus.
// Draws are deterministic for a day and a block and, once saved, never
// reshuffle.
import { dayKey, type InsightAttempt, type InsightItem } from './progressInsights.js';
import { normalizeRating } from './problemImport.js';
import { levelFor, addDays, type CampaignLevel } from './campaign.js';

export type BlockKind = 'quiz' | 'exam' | 'session';
/** Where a quiz block draws from, in order of preference. */
export type PoolSource = 'starred-hard' | 'starred-medium' | 'starred-easy' | 'starred' | 'hard' | 'easy-medium' | 'new';
export const POOL_SOURCES: readonly PoolSource[] = ['starred-hard', 'starred-medium', 'starred-easy', 'starred', 'hard', 'easy-medium', 'new'];

export interface PoolSpec {
  readonly from: readonly PoolSource[];
  readonly count: number;
}
export interface PlanBlock {
  readonly id: string;
  /** "5:30", "16:30": the clock, for the day's order and the card. */
  readonly start: string;
  readonly end: string;
  readonly kind: BlockKind;
  readonly title: string;
  readonly note?: string;
  readonly xp: number;
  /** A quiz: what to draw. */
  readonly pool?: PoolSpec;
  /** An exam: the paper that holds its questions (pe1). */
  readonly paper?: string;
  /** An exam: minutes on the clock. */
  readonly minutes?: number;
  /** A session: the command another tool registered, with its arguments. */
  readonly command?: string;
  readonly args?: readonly unknown[];
  /** A session: the journal line that means it was finished (verb and object, exact). */
  readonly done?: { readonly verb: string; readonly object: string };
  /** Off: the day is full without it. Default on. */
  readonly required?: boolean;
}
export interface PlanDay {
  readonly day: string;
  /** exam, practice, soft, hard, flashcards, pto, taper, sitting: the strip's word for the day. */
  readonly type: string;
  readonly label: string;
  readonly blocks: readonly PlanBlock[];
}
export interface StudyPlan {
  readonly title: string;
  /** The sitting: YYYY-MM-DD. */
  readonly examDay: string;
  readonly fullDayXp: number;
  readonly days: readonly PlanDay[];
}

/** One block's stored state: its draw, the quiz session it started, when it was done. */
export interface BlockState {
  readonly day: string;
  readonly blockId: string;
  readonly draw: readonly number[];
  readonly sessionId: string;
  readonly doneAt: number | null;
}
// ── Parsing ─────────────────────────────────────────────────────────────────

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{1,2}:\d{2}$/;
function str(v: unknown): string { return typeof v === 'string' ? v : ''; }
function num(v: unknown, d = 0): number { const n = Number(v); return Number.isFinite(n) ? n : d; }

/** The plan from its JSON, or null with the reason when it is not one. */
export function parsePlan(json: string): { plan: StudyPlan | null; error: string } {
  let raw: unknown;
  try { raw = JSON.parse(json); } catch (e) { return { plan: null, error: `Not JSON: ${(e as Error).message}` }; }
  if (!raw || typeof raw !== 'object') return { plan: null, error: 'The plan must be an object.' };
  const o = raw as Record<string, unknown>;
  if (!DAY_RE.test(str(o.examDay))) return { plan: null, error: 'examDay must be YYYY-MM-DD.' };
  if (!Array.isArray(o.days) || o.days.length === 0) return { plan: null, error: 'days must be a non-empty list.' };
  const days: PlanDay[] = [];
  const seen = new Set<string>();
  for (const d of o.days as unknown[]) {
    const dd = (d ?? {}) as Record<string, unknown>;
    const day = str(dd.day);
    if (!DAY_RE.test(day)) return { plan: null, error: `A day is missing its date: ${JSON.stringify(dd.day)}.` };
    if (seen.has(day)) return { plan: null, error: `${day} appears twice.` };
    seen.add(day);
    const blocks: PlanBlock[] = [];
    const ids = new Set<string>();
    for (const b of (Array.isArray(dd.blocks) ? dd.blocks : []) as unknown[]) {
      const bb = (b ?? {}) as Record<string, unknown>;
      const id = str(bb.id); const kind = str(bb.kind) as BlockKind;
      if (!id || ids.has(id)) return { plan: null, error: `${day}: a block has no id or a repeated one.` };
      ids.add(id);
      // Grading blocks from an older plan are left out: an exam is done when it is sat.
      if ((kind as string) === 'grade') continue;
      if (!['quiz', 'exam', 'session'].includes(kind)) return { plan: null, error: `${day}/${id}: kind must be quiz, exam or session.` };
      if (!TIME_RE.test(str(bb.start)) || !TIME_RE.test(str(bb.end))) return { plan: null, error: `${day}/${id}: start and end must be H:MM.` };
      const block: PlanBlock = {
        id, kind, start: str(bb.start), end: str(bb.end), title: str(bb.title) || id, xp: Math.max(0, Math.round(num(bb.xp))),
        ...(str(bb.note) ? { note: str(bb.note) } : {}),
        ...(bb.required === false ? { required: false } : {}),
      };
      if (kind === 'quiz') {
        const p = (bb.pool ?? {}) as Record<string, unknown>;
        // Pools an older plan named that no longer exist ("misses") are dropped.
        const from = (Array.isArray(p.from) ? p.from : []).map(str).filter((s): s is PoolSource => (POOL_SOURCES as readonly string[]).includes(s));
        if (from.length === 0 || num(p.count) < 1) return { plan: null, error: `${day}/${id}: a quiz needs pool.from and pool.count.` };
        blocks.push({ ...block, pool: { from, count: Math.round(num(p.count)) } });
      } else if (kind === 'exam') {
        if (!str(bb.paper)) return { plan: null, error: `${day}/${id}: an exam block names its paper.` };
        blocks.push({ ...block, paper: str(bb.paper), minutes: Math.max(0, Math.round(num(bb.minutes))) });
      } else {
        const done = (bb.done ?? {}) as Record<string, unknown>;
        // No command: a session done by hand (a formula sheet on paper), marked done on the dashboard.
        blocks.push({
          ...block, ...(str(bb.command) ? { command: str(bb.command), args: Array.isArray(bb.args) ? bb.args : [] } : {}),
          ...(str(done.verb) && str(done.object) ? { done: { verb: str(done.verb), object: str(done.object) } } : {}),
        });
      }
    }
    blocks.sort((a, b) => minutes(a.start) - minutes(b.start));
    days.push({ day, type: str(dd.type) || 'practice', label: str(dd.label), blocks });
  }
  days.sort((a, b) => a.day.localeCompare(b.day));
  return { plan: { title: str(o.title) || 'Study Plan', examDay: str(o.examDay), fullDayXp: Math.max(0, Math.round(num(o.fullDayXp, 50))), days }, error: '' };
}

export function minutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}
/** "5:30" to "5:30 am", "16:30" to "4:30 pm". */
export function clockLabel(t: string): string {
  const [h, m] = t.split(':').map(Number);
  const ap = h >= 12 ? 'pm' : 'am';
  const hh = h % 12 || 12;
  return `${hh}:${String(m || 0).padStart(2, '0')} ${ap}`;
}

export function planDayOf(plan: StudyPlan, day: string): PlanDay | null {
  return plan.days.find((d) => d.day === day) ?? null;
}
export function blockKey(day: string, blockId: string): string { return `${day}/${blockId}`; }

// ── Draws ───────────────────────────────────────────────────────────────────

function hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h;
}

export interface DrawContext {
  readonly items: readonly InsightItem[];
  readonly attempts: readonly InsightAttempt[];
  /** Item id to the last plan day it was drawn on, over every saved block state. */
  readonly drawnOn: ReadonlyMap<number, string>;
}

/** Item id to the day it was last drawn, from the saved block states. */
export function drawnOnMap(states: readonly BlockState[]): Map<number, string> {
  const m = new Map<number, string>();
  for (const s of states) for (const id of s.draw) { const cur = m.get(id); if (!cur || cur < s.day) m.set(id, s.day); }
  return m;
}

const isWorkbook = (it: InsightItem) => !!it.paper && it.kind !== 'essay' && (it.source === 'rf' || it.source === 'cas');

/** Candidates of one pool, best first, deterministic for `seed`. */
export function poolCandidates(source: PoolSource, ctx: DrawContext, seed: string): number[] {
  const { items, drawnOn } = ctx;
  const order = (a: InsightItem, b: InsightItem) => hash(`${seed}:${a.id}`) - hash(`${seed}:${b.id}`);
  const rating = (it: InsightItem) => normalizeRating(it.attemptState);
  const starred = (it: InsightItem) => !!it.starred;
  if (source === 'new') {
    // Never seen, never drawn: round robin across papers, the fullest paper first.
    const fresh = items.filter((it) => it.source === 'custom' && it.attemptCount === 0 && !it.worked && !drawnOn.has(it.id));
    return roundRobin(fresh, order).map((it) => it.id);
  }
  let pool: InsightItem[];
  switch (source) {
    case 'starred-hard': pool = items.filter((it) => isWorkbook(it) && starred(it) && rating(it) === 'hard'); break;
    case 'starred-medium': pool = items.filter((it) => isWorkbook(it) && starred(it) && rating(it) === 'medium'); break;
    case 'starred-easy': pool = items.filter((it) => isWorkbook(it) && starred(it) && rating(it) === 'easy'); break;
    case 'starred': pool = items.filter((it) => isWorkbook(it) && starred(it)); break;
    case 'hard': pool = items.filter((it) => isWorkbook(it) && rating(it) === 'hard'); break;
    case 'easy-medium': pool = items.filter((it) => isWorkbook(it) && (rating(it) === 'easy' || rating(it) === 'medium')); break;
    default: pool = [];
  }
  // Least recently drawn first, so the pool cycles before anything repeats.
  const lastDrawn = (it: InsightItem) => drawnOn.get(it.id) ?? '';
  return roundRobin(pool, (a, b) => lastDrawn(a).localeCompare(lastDrawn(b)) || order(a, b)).map((it) => it.id);
}

/** One from each paper in turn, the paper with the most left first; within a paper by `cmp`. */
function roundRobin(list: readonly InsightItem[], cmp: (a: InsightItem, b: InsightItem) => number): InsightItem[] {
  const byPaper = new Map<string, InsightItem[]>();
  for (const it of list) { if (!byPaper.has(it.paper)) byPaper.set(it.paper, []); byPaper.get(it.paper)!.push(it); }
  const queues = [...byPaper.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])).map(([, l]) => l.sort(cmp));
  const out: InsightItem[] = [];
  let took = true;
  while (took) {
    took = false;
    for (const q of queues) { const it = q.shift(); if (it) { out.push(it); took = true; } }
  }
  return out;
}

/** The problems a quiz block draws: `count` ids, pools in order, none twice. */
export function drawBlock(day: string, block: PlanBlock, ctx: DrawContext): number[] {
  if (!block.pool) return [];
  const out: number[] = [];
  const taken = new Set<number>();
  const seed = `${day}:${block.id}`;
  for (const source of block.pool.from) {
    if (out.length >= block.pool.count) break;
    for (const id of poolCandidates(source, ctx, seed)) {
      if (out.length >= block.pool.count) break;
      if (!taken.has(id)) { taken.add(id); out.push(id); }
    }
  }
  return out;
}

/** An exam's questions in the exam's order: the paper's items by sheet number. */
export function examItems(paper: string, items: readonly InsightItem[]): number[] {
  const qn = (it: InsightItem) => { const m = /Q\s*#?\s*(\d+)/i.exec(it.title); return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER; };
  return items.filter((it) => it.paper === paper && it.source === 'exam').sort((a, b) => qn(a) - qn(b) || a.id - b.id).map((it) => it.id);
}

// ── Status and progress ─────────────────────────────────────────────────────

export interface ResolveContext {
  /** Quiz session id to when it finished. */
  readonly finishedSessions: ReadonlyMap<string, number>;
  /** Block key (day/id) to when the journal saw its finishing line. */
  readonly journalHits: ReadonlyMap<string, number>;
}
export interface BlockView {
  readonly block: PlanBlock;
  readonly state: BlockState | null;
  readonly done: boolean;
  readonly doneAt: number | null;
  /** Started and not finished: a draw saved or a session open. */
  readonly started: boolean;
}
export interface DayView {
  readonly day: PlanDay;
  readonly blocks: readonly BlockView[];
  readonly required: number;
  readonly requiredDone: number;
  readonly full: boolean;
  readonly state: 'full' | 'partial' | 'missed' | 'today' | 'future';
  readonly xp: number;
}
export interface PlanProgress {
  readonly today: string;
  readonly dayIndex: number;
  readonly totalDays: number;
  readonly daysToExam: number;
  readonly days: readonly DayView[];
  readonly streak: number;
  readonly fullDays: number;
  readonly blocksDone: number;
  readonly xp: number;
  readonly level: CampaignLevel;
}

export function resolveBlock(day: string, block: PlanBlock, state: BlockState | null, ctx: ResolveContext): BlockView {
  let doneAt: number | null = state?.doneAt ?? null;
  if (doneAt === null) {
    if ((block.kind === 'quiz' || block.kind === 'exam') && state?.sessionId) doneAt = ctx.finishedSessions.get(state.sessionId) ?? null;
    else if (block.kind === 'session') doneAt = ctx.journalHits.get(blockKey(day, block.id)) ?? null;
  }
  const started = doneAt === null && !!state && (state.draw.length > 0 || !!state.sessionId);
  return { block, state, done: doneAt !== null, doneAt, started };
}

export function planProgress(plan: StudyPlan, states: readonly BlockState[], ctx: ResolveContext, now: number = Date.now(), bonusXp = 0): PlanProgress {
  const today = dayKey(now);
  const byKey = new Map(states.map((s) => [blockKey(s.day, s.blockId), s]));
  const days: DayView[] = plan.days.map((d) => {
    const blocks = d.blocks.map((b) => resolveBlock(d.day, b, byKey.get(blockKey(d.day, b.id)) ?? null, ctx));
    const req = blocks.filter((b) => b.block.required !== false);
    const requiredDone = req.filter((b) => b.done).length;
    const full = req.length > 0 && requiredDone === req.length;
    const anyDone = blocks.some((b) => b.done);
    const state: DayView['state'] = d.day > today ? 'future' : d.day === today && !full ? 'today' : full ? 'full' : anyDone ? 'partial' : 'missed';
    const xp = blocks.reduce((s, b) => s + (b.done ? b.block.xp : 0), 0) + (full ? plan.fullDayXp : 0);
    return { day: d, blocks, required: req.length, requiredDone, full, state, xp };
  });
  // Streak: full days back from today, or from yesterday while today is still open; days with nothing required are skipped.
  let streak = 0;
  const idx = new Map(days.map((d, i) => [d.day.day, i]));
  let cursor = today;
  const first = plan.days[0]?.day ?? today;
  const todayView = days[idx.get(today) ?? -1];
  if (todayView && !todayView.full) cursor = addDays(today, -1);
  while (cursor >= first) {
    const v = days[idx.get(cursor) ?? -1];
    if (v && v.required > 0) { if (!v.full) break; streak++; }
    cursor = addDays(cursor, -1);
  }
  const fullDays = days.filter((d) => d.full).length;
  const blocksDone = days.reduce((s, d) => s + d.blocks.filter((b) => b.done).length, 0);
  const xp = days.reduce((s, d) => s + d.xp, 0) + Math.max(0, bonusXp);
  const dayIndex = Math.max(1, Math.min(plan.days.length, (idx.get(today) ?? (today > (plan.days[plan.days.length - 1]?.day ?? '') ? plan.days.length - 1 : 0)) + 1));
  const daysToExam = Math.round((Date.UTC(...ymd(plan.examDay)) - Date.UTC(...ymd(today))) / 86400000);
  return { today, dayIndex, totalDays: plan.days.length, daysToExam, days, streak, fullDays, blocksDone, xp, level: levelFor(xp) };
}
function ymd(day: string): [number, number, number] { const [y, m, d] = day.split('-').map(Number); return [y, m - 1, d]; }

// ── Rewards ─────────────────────────────────────────────────────────────────

export interface PlanRewardContext {
  readonly progress: PlanProgress;
  /** Custom-bank problems done and in the bank. */
  readonly newDone: number;
  readonly newTotal: number;
}
export interface PlanRewardDef {
  readonly id: string;
  readonly title: string;
  readonly hint: string;
  readonly icon: string;
  readonly xp: number;
  readonly earned: (c: PlanRewardContext) => boolean;
}
const examBlocksDone = (c: PlanRewardContext, kind: BlockKind) => c.progress.days.reduce((n, d) => n + d.blocks.filter((b) => b.block.kind === kind && b.done).length, 0);

export const PLAN_REWARDS: readonly PlanRewardDef[] = [
  { id: 'plan:first-exam', title: 'First Exam Sat', hint: 'Sit a practice exam under the clock.', icon: 'timer', xp: 100, earned: (c) => examBlocksDone(c, 'exam') >= 1 },
  { id: 'plan:three-full', title: 'Three Full Days', hint: 'Three full days in a row.', icon: 'flame', xp: 100, earned: (c) => c.progress.streak >= 3 },
  { id: 'plan:seven-full', title: 'Seven Full Days', hint: 'A full week of full days.', icon: 'zap', xp: 250, earned: (c) => c.progress.streak >= 7 },
  { id: 'plan:half-bank', title: 'Half The Bank', hint: 'Half the new problems done.', icon: 'milestone', xp: 200, earned: (c) => c.newTotal > 0 && c.newDone * 2 >= c.newTotal },
  { id: 'plan:bank-done', title: 'Bank Done', hint: 'Every new problem done.', icon: 'trophy', xp: 500, earned: (c) => c.newTotal > 0 && c.newDone >= c.newTotal },
  { id: 'plan:three-exams', title: 'Three Exams Sat', hint: 'All three practice exams sat.', icon: 'award', xp: 300, earned: (c) => examBlocksDone(c, 'exam') >= 3 },
  { id: 'plan:taper', title: 'Taper Kept', hint: 'The last day before the sitting, done as planned.', icon: 'moon', xp: 150, earned: (c) => c.progress.days.some((d) => d.day.type === 'taper' && d.full) },
];
export function earnedPlanRewards(ctx: PlanRewardContext): PlanRewardDef[] {
  return PLAN_REWARDS.filter((r) => { try { return r.earned(ctx); } catch { return false; } });
}
export function planRewardXp(unlocked: Iterable<string>): number {
  const ids = new Set(unlocked);
  return PLAN_REWARDS.filter((r) => ids.has(r.id)).reduce((s, r) => s + r.xp, 0);
}
