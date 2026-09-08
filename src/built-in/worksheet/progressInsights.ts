// progressInsights.ts — Worksheets: what the dashboard says, computed.
//
// PURE (unit-tested in tests/unit/worksheetProgressInsights.test.ts). Takes
// the bank (item summaries) and every completed attempt, and returns the
// numbers the dashboard shows and the lists it recommends. The workbook's
// arithmetic is kept so his numbers stay comparable: attempted % = rated
// problems over all problems; score = Easy 1, Medium 0.5, Hard 0 over rated
// problems. Everything else is what the workbook could not do: time, a
// timeline drawn from every rating, what is due again, what keeps going
// wrong, and where to start next.
import { normalizeRating, RATING_SCORE, type Rating } from './problemImport.js';

export interface InsightItem {
  readonly id: number;
  readonly title: string;
  readonly paper: string;
  readonly source: string;
  readonly kind: string;
  readonly quadrant: number;
  readonly attemptState: string;
  readonly attemptCount: number;
  readonly seconds: number;
  readonly lastAttemptAt: number;
}
export interface InsightAttempt {
  readonly itemId: number;
  readonly selfGrade: string;
  readonly at: number;
  readonly seconds: number;
  readonly imported: boolean;
}
export interface ProgressSnapshot { readonly day: string; readonly attempted: number; readonly score: number }

export interface PaperProgress {
  readonly paper: string;
  readonly total: number;
  readonly easy: number;
  readonly medium: number;
  readonly hard: number;
  readonly rated: number;
  /** 0..1 over all problems of the paper. */
  readonly attempted: number;
  /** 0..1 over rated problems; 0 when none rated. */
  readonly score: number;
  readonly seconds: number;
}
export interface DueItem { readonly item: InsightItem; readonly rating: Rating; readonly daysAgo: number }
export interface StrugglingItem { readonly item: InsightItem; readonly hardCount: number; readonly attempts: number }
export interface TimelinePoint { readonly day: string; readonly attempted: number; readonly score: number; readonly source: 'workbook' | 'attempts' }

export interface Insights {
  readonly totalProblems: number;
  readonly rated: number;
  readonly attempted: number;
  readonly score: number;
  readonly seconds: number;
  readonly ratedThisWeek: number;
  readonly byPaper: PaperProgress[];
  readonly due: DueItem[];
  readonly struggling: StrugglingItem[];
  readonly quickWins: InsightItem[];
  readonly weakestPapers: PaperProgress[];
  readonly timeline: TimelinePoint[];
}

/** Hard comes back after three days, Medium after seven. */
export const DUE_DAYS: Record<'hard' | 'medium', number> = { hard: 3, medium: 7 };
const DAY = 24 * 60 * 60 * 1000;

export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function paperProgress(paper: string, items: readonly InsightItem[]): PaperProgress {
  let easy = 0; let medium = 0; let hard = 0; let seconds = 0;
  for (const it of items) {
    const r = normalizeRating(it.attemptState);
    if (r === 'easy') easy++; else if (r === 'medium') medium++; else if (r === 'hard') hard++;
    seconds += it.seconds;
  }
  const rated = easy + medium + hard;
  return {
    paper, total: items.length, easy, medium, hard, rated,
    attempted: items.length ? rated / items.length : 0,
    score: rated ? (easy * RATING_SCORE.easy + medium * RATING_SCORE.medium + hard * RATING_SCORE.hard) / rated : 0,
    seconds,
  };
}

/**
 * The timeline from attempts: for every day something was rated, the bank's
 * attempted % and score at the end of that day (latest rating per problem as
 * of then). Workbook snapshots older than the first rating here come first.
 */
export function buildTimeline(items: readonly InsightItem[], attempts: readonly InsightAttempt[], snapshots: readonly ProgressSnapshot[]): TimelinePoint[] {
  const total = items.length;
  const known = new Set(items.map((i) => i.id));
  const sorted = [...attempts].filter((a) => known.has(a.itemId) && normalizeRating(a.selfGrade)).sort((a, b) => a.at - b.at);
  const points: TimelinePoint[] = [];
  const latest = new Map<number, Rating>();
  let i = 0;
  while (i < sorted.length) {
    const day = dayKey(sorted[i].at);
    while (i < sorted.length && dayKey(sorted[i].at) === day) { latest.set(sorted[i].itemId, normalizeRating(sorted[i].selfGrade)); i++; }
    let easy = 0; let medium = 0; let hard = 0;
    for (const r of latest.values()) { if (r === 'easy') easy++; else if (r === 'medium') medium++; else if (r === 'hard') hard++; }
    const rated = easy + medium + hard;
    points.push({ day, attempted: total ? rated / total : 0, score: rated ? (easy + medium * 0.5) / rated : 0, source: 'attempts' });
  }
  const firstDay = points[0]?.day ?? '9999-12-31';
  const older = snapshots.filter((s) => s.day < firstDay).map((s) => ({ day: s.day, attempted: s.attempted, score: s.score, source: 'workbook' as const }));
  return [...older.sort((a, b) => a.day.localeCompare(b.day)), ...points];
}

export function computeInsights(items: readonly InsightItem[], attempts: readonly InsightAttempt[], snapshots: readonly ProgressSnapshot[] = [], now: number = Date.now()): Insights {
  const problems = items.filter((i) => i.paper);
  const byPaperMap = new Map<string, InsightItem[]>();
  for (const it of problems) { if (!byPaperMap.has(it.paper)) byPaperMap.set(it.paper, []); byPaperMap.get(it.paper)!.push(it); }
  const byPaper = [...byPaperMap.entries()].map(([paper, list]) => paperProgress(paper, list)).sort((a, b) => a.paper.localeCompare(b.paper));
  const all = paperProgress('', problems);

  // Due: last rating Hard three or more days ago, Medium seven or more; oldest first.
  const due: DueItem[] = [];
  for (const it of problems) {
    const r = normalizeRating(it.attemptState);
    if ((r !== 'hard' && r !== 'medium') || !it.lastAttemptAt) continue;
    const daysAgo = Math.floor((now - it.lastAttemptAt) / DAY);
    if (daysAgo >= DUE_DAYS[r]) due.push({ item: it, rating: r, daysAgo });
  }
  due.sort((a, b) => b.daysAgo - a.daysAgo || (a.rating === 'hard' ? -1 : 1));

  // Struggling: rated Hard twice or more, ever, and still not Easy.
  const hardCounts = new Map<number, number>();
  const attemptCounts = new Map<number, number>();
  for (const a of attempts) {
    if (!normalizeRating(a.selfGrade)) continue;
    attemptCounts.set(a.itemId, (attemptCounts.get(a.itemId) ?? 0) + 1);
    if (normalizeRating(a.selfGrade) === 'hard') hardCounts.set(a.itemId, (hardCounts.get(a.itemId) ?? 0) + 1);
  }
  const struggling: StrugglingItem[] = [];
  for (const it of problems) {
    const hardCount = hardCounts.get(it.id) ?? 0;
    if (hardCount >= 2 && normalizeRating(it.attemptState) !== 'easy') struggling.push({ item: it, hardCount, attempts: attemptCounts.get(it.id) ?? 0 });
  }
  struggling.sort((a, b) => b.hardCount - a.hardCount || b.attempts - a.attempts);

  // Quick wins: the vendor's Easy & Likely quadrant, never attempted.
  const quickWins = problems.filter((it) => it.quadrant === 1 && it.attemptCount === 0 && it.attemptState !== 'open');

  // Weakest papers: rated at least three, lowest score first; then the least covered.
  const weakestPapers = [...byPaper]
    .filter((p) => p.total > 0)
    .sort((a, b) => {
      const aRated = a.rated >= 3; const bRated = b.rated >= 3;
      if (aRated && bRated) return a.score - b.score || a.attempted - b.attempted;
      if (aRated !== bRated) return aRated ? -1 : 1;
      return a.attempted - b.attempted;
    });

  const weekAgo = now - 7 * DAY;
  const ratedThisWeek = attempts.filter((a) => !a.imported && a.at >= weekAgo && normalizeRating(a.selfGrade)).length;

  return {
    totalProblems: problems.length,
    rated: all.rated,
    attempted: all.attempted,
    score: all.score,
    seconds: all.seconds,
    ratedThisWeek,
    byPaper,
    due,
    struggling,
    quickWins,
    weakestPapers,
    timeline: buildTimeline(problems, attempts, snapshots),
  };
}
