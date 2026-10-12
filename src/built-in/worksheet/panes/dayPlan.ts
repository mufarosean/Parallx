// dayPlan.ts — what the Dashboard and Home offer for today: the open quiz
// to resume, the campaign's draw, due and unrated problems, flashcards. A
// pure planner over the bank, the attempts and the campaign; the panes
// render what it returns.

import type { IKitAction } from '../../../ui/kit.js';
import type { DashboardActions } from './dashboardPane.js';
import { getDailyDraw, saveDailyDraw } from '../worksheetData.js';
import { dayKey, type InsightItem, type InsightAttempt } from '../progressInsights.js';
import { campaignProgress, campaignDone, drawToday, isCampaignProblem, type Campaign, type CampaignProgress } from '../campaign.js';
import { normalizeRating } from '../problemImport.js';

export type QuizResume = { name: string; position: number; total: number } | null;

/**
 * The day's story under the quota line: today's tally while the day is on,
 * the last working day's tally first thing in the morning, the week's on a
 * rest day. Nothing at all when there is nothing to tell.
 */

/** The day's actions, for a page header: one primary, the rest secondary. */
export interface DayActions {
  primary?: IKitAction;
  secondary: IKitAction[];
  /** Overrides the day (Draw Anyway on a rest day): drawn quietly in the card. */
  quiet: IKitAction[];
}

/** What today asks for: the campaign's numbers, today's saved draw and the
 *  actions that follow from them. Home and the Dashboard both draw from this,
 *  so the day's one action is the same in both places. */
export interface DayPlan {
  readonly campaign: Campaign | null;
  readonly progress: CampaignProgress | null;
  /** One line: "Day 8 of 22 · Rest day". */
  readonly title: string;
  /** The day's sentence. */
  readonly line: string;
  readonly drawPapers: number;
  readonly actions: DayActions;
}

export async function planDay(items: InsightItem[], attempts: InsightAttempt[], campaign: Campaign | null, due: number[], resume: QuizResume, bonusXp: number, actions: Pick<DashboardActions, 'startQuiz' | 'resumeQuiz' | 'studyFlashcards' | 'openSettings'>, now = Date.now()): Promise<DayPlan> {
  const problems = items.filter(isCampaignProblem);
  const out: DayActions = { secondary: [], quiet: [] };
  // A quiz left unfinished comes first, wherever it came from: resuming
  // keeps its order and lets you go back to what you rated.
  if (resume) out.primary = { id: 'worksheet.dashboard.resumeQuiz', label: `Resume ${resume.name || 'Quiz'} (${resume.position + 1} of ${resume.total})`, icon: 'play', title: 'The open quiz you used last, where it stands.', onClick: () => actions.resumeQuiz() };
  const add = (a: IKitAction) => { if (!out.primary) out.primary = a; else out.secondary.push(a); };

  if (!campaign) {
    out.secondary.push({ id: 'worksheet.dashboard.setUpCampaign', label: 'Set Up Campaign…', title: 'Every problem in the bank in a set number of days, drawn across all papers', onClick: () => actions.openSettings() });
    return { campaign, progress: null, title: 'No campaign running', line: `${problems.length} problems in the bank.`, drawPapers: 0, actions: out };
  }

  const today = dayKey(now);
  const p = campaignProgress(campaign, items, attempts, now, bonusXp);
  const byId = new Map(items.map((i) => [i.id, i]));
  const done = campaignDone(campaign, items, attempts);
  // A rest day draws nothing; the day belongs to repeats. Otherwise today's
  // saved draw is kept, minus anything no longer in the campaign (an essay
  // sheet, a deleted item), and topped up to the target.
  let draw: number[] = [];
  if (!p.restToday) {
    const saved = await getDailyDraw(today).catch(() => null);
    draw = (saved ?? []).filter((id) => { const it = byId.get(id); return !!it && isCampaignProblem(it); });
    if (draw.length < p.target) {
      const inDraw = new Set(draw);
      for (const id of drawToday(campaign, items, attempts, p.target + draw.length, today)) {
        if (draw.length >= p.target) break;
        if (!inDraw.has(id) && !done.has(id)) { draw.push(id); inDraw.add(id); }
      }
    }
    const changed = !saved || saved.length !== draw.length || saved.some((id, i) => id !== draw[i]);
    if (changed) void saveDailyDraw(today, draw).catch(() => {});
  }
  const drawLeft = draw.filter((id) => !done.has(id));
  const drawPapers = new Set(drawLeft.map((id) => byId.get(id)?.paper).filter(Boolean)).size;

  // Today's quiz is the whole draw, rated problems included, opened at the
  // first one not yet rated; once the quota is met the rest stays as a lead.
  if (p.restToday && !p.finished) {
    if (due.length > 0) add({ id: 'worksheet.dashboard.quizDue', label: `Quiz Due Problems (${due.length})`, onClick: () => actions.startQuiz(due, 0, 'Due Problems') });
    if (p.remaining > 0) out.quiet.push({
      id: 'worksheet.dashboard.quizRemaining',
      label: 'Draw Anyway',
      title: 'New problems on a rest day. They count toward the campaign, not toward a quota.',
      onClick: () => {
        const ids = drawToday(campaign, items, attempts, p.target, today);
        if (ids.length) actions.startQuiz(ids, 0, `Day ${p.dayIndex} Rest Day Draw`);
      },
    });
  } else if (drawLeft.length > 0) {
    const startAt = Math.max(0, draw.findIndex((id) => !done.has(id)));
    add({ id: 'worksheet.dashboard.startToday', label: p.leftToday > 0 ? `Start Today's Quiz (${drawLeft.length} left)` : `Keep Going (${drawLeft.length})`, onClick: () => actions.startQuiz(draw, startAt, `Day ${p.dayIndex} Draw`) });
  } else if (!p.finished && p.remaining > 0) {
    add({ id: 'worksheet.dashboard.drawMore', label: 'Draw More For Today', onClick: () => {
      const extra = drawToday(campaign, items, attempts, p.target, `${today}+`);
      if (extra.length) actions.startQuiz(extra, 0, `Day ${p.dayIndex} Extra Draw`);
    } });
  }
  // Worked without a rating of his own: counted already, and one click from
  // the rating that scores them, so the tally's chip is never a dead end.
  const unrated = problems.filter((it) => it.worked && (it.ratingImported || !normalizeRating(it.attemptState))).map((it) => it.id);
  if (unrated.length > 0 && !p.finished) add({ id: 'worksheet.dashboard.rateWorked', label: `Rate Worked Problems (${unrated.length})`, title: 'Problems you worked without rating. They count already; a rating scores them and sets when they come back.', onClick: () => actions.startQuiz(unrated, 0, 'Worked, Not Rated') });
  const study = actions.studyFlashcards;
  if (study) out.secondary.push({ id: 'worksheet.dashboard.reviewFlashcards', label: 'Review Due Flashcards', onClick: () => study() });

  const title = p.finished ? 'Campaign complete' : p.dayIndex > campaign.days ? `Day ${p.dayIndex}, ${p.dayIndex - campaign.days} past the plan` : p.restToday ? `Day ${p.dayIndex} of ${campaign.days} · Rest day` : `Day ${p.dayIndex} of ${campaign.days} · ${p.doneToday} of ${p.target} today`;
  const pace = p.delta === 0 ? 'on pace' : p.delta > 0 ? `${p.delta} ahead` : `${-p.delta} behind`;
  const line = p.finished ? 'Nothing left to draw. The bank is yours.'
    : `${p.done} of ${p.total} done · ${pace}${p.restToday && due.length ? ` · ${due.length} ${due.length === 1 ? 'problem' : 'problems'} due for a repeat` : ''}`;
  return { campaign, progress: p, title, line, drawPapers, actions: out };
}

/** One square per planned day; the tooltip says the day and how it went. */
