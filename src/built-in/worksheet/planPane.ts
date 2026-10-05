// planPane.ts — Worksheets: the study plan's dashboard, and the grading of an exam.
//
// The plan is imported data (plan.ts): days of blocks in clock order. This
// tab shows where the plan stands, today's blocks each with its one action,
// the exams with their scores, every day as a strip, the pools the quizzes
// draw from, what other tools reported finishing, and the plan's rewards.
// A block's draw is made here the first time the day is opened and saved,
// so it never reshuffles. Starting a quiz or an exam links the quiz session
// to the block; finishing that session is what marks the block done.
import {
  listItems, listAttemptHistory, onWorksheetDataChanged, getPlanJson, listPlanBlocks, savePlanBlock, listExamGrades, upsertExamGrade, deleteExamGrade,
  getSessionFinishes, listRewardUnlocks, unlockRewards, getItem, type PlanBlockRow,
} from './worksheetData.js';
import { dayKey, type InsightAttempt, type InsightItem } from './progressInsights.js';
import {
  parsePlan, planProgress, drawBlock, drawnOnMap, examItems, examSummary, resolveBlock, blockKey, clockLabel, readingOf, earnedPlanRewards, planRewardXp, PLAN_REWARDS,
  type StudyPlan, type PlanDay, type PlanBlock, type BlockState, type BlockView, type DayView, type ExamGrade, type ExamSummary, type PlanProgress, type ResolveContext,
} from './plan.js';
import { normalizeRating, paperLabel } from './problemImport.js';
import { LEVEL_TITLES } from './campaign.js';
import { el, tile, card, pct, makeTooltip, fmtStudyTime } from './dashboardPane.js';
import { createButton, createEmptyState, createPageHeader, createSegmented, type IKitAction } from '../../ui/kit.js';
import { appTimeString } from '../../services/localTime.js';

export interface PlanActions {
  openItem(id: number, title: string): void;
  /** A new quiz over these problems, named; resolves to the session's id once it runs. */
  startQuiz(ids: number[], name: string): Promise<string>;
  /** Reopen a quiz session: an open one resumes, a finished one reviews. */
  openQuiz(id: string): void;
  openGrading(paper: string, title: string): void;
  /** Run a command another tool registered; false when it does not exist. */
  runCommand(command: string, args: readonly unknown[]): Promise<boolean>;
  commandExists(command: string): Promise<boolean>;
  /** Times the activity journal saw this verb and object (exact) since `sinceTs`. */
  journalHits(verb: string, object: string, sinceTs: number): Promise<number[]>;
  /** Everything the journal saw finished since `sinceTs`: object and detail. */
  journalFinished(sinceTs: number): Promise<{ object: string; detail: string; ts: number }[]>;
  renderIcon?(id: string, size: number): string;
  openHome?(): void;
  importPlan(): void;
  removePlan(): void;
}

const DAY_MS = 86_400_000;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function dayStartMs(day: string): number { return Date.parse(`${day}T00:00:00`); }
function fmtDayLong(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return `${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dt.getDay()]}, ${dt.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}`;
}
function fmtDayShort(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return `${WEEKDAYS[dt.getDay()]} ${dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}
function fmtClock(ms: number): string { return appTimeString(ms, { hour: 'numeric', minute: '2-digit' }); }

const CAUSES: readonly { value: string; label: string }[] = [
  { value: 'did not know', label: 'Did Not Know' },
  { value: 'knew but slow', label: 'Knew, Slow' },
  { value: 'misread', label: 'Misread' },
  { value: 'arithmetic', label: 'Arithmetic' },
];
export function causeLabel(cause: string): string { return CAUSES.find((c) => c.value === cause)?.label ?? cause; }

/** What a quiz draw holds, by pool, for the block's line: "4 misses, 6 starred Hard". */
function describeDraw(ids: readonly number[], items: ReadonlyMap<number, InsightItem>, grades: ReadonlyMap<number, ExamGrade>): string {
  let misses = 0, hard = 0, medium = 0, easy = 0, fresh = 0, other = 0;
  for (const id of ids) {
    const it = items.get(id);
    if (!it) continue;
    if (it.source === 'exam' && (grades.get(id)?.lost ?? 0) > 0) misses++;
    else if (it.source === 'custom') fresh++;
    else { const r = normalizeRating(it.attemptState); if (r === 'hard') hard++; else if (r === 'medium') medium++; else if (r === 'easy') easy++; else other++; }
  }
  const parts: string[] = [];
  if (misses) parts.push(`${misses} exam ${misses === 1 ? 'miss' : 'misses'}`);
  if (hard) parts.push(`${hard} Hard`);
  if (medium) parts.push(`${medium} Medium`);
  if (easy) parts.push(`${easy} Easy`);
  if (fresh) parts.push(`${fresh} new`);
  if (other) parts.push(`${other} unrated`);
  const papers = new Set(ids.map((id) => items.get(id)?.paper).filter(Boolean)).size;
  return parts.length ? `${ids.length} drawn: ${parts.join(', ')}${papers > 1 ? `, ${papers} papers` : ''}` : `${ids.length} drawn`;
}

interface Loaded {
  readonly plan: StudyPlan;
  readonly items: InsightItem[];
  readonly byId: Map<number, InsightItem>;
  readonly attempts: InsightAttempt[];
  readonly states: BlockState[];
  readonly grades: Map<number, ExamGrade>;
  readonly ctx: ResolveContext;
  readonly progress: PlanProgress;
  readonly unlocks: Map<string, number>;
  readonly exams: ExamSummary[];
}

/** Every exam paper the plan names, in plan order. */
function examPapers(plan: StudyPlan): string[] {
  const out: string[] = [];
  for (const d of plan.days) for (const b of d.blocks) if (b.kind === 'exam' && b.paper && !out.includes(b.paper)) out.push(b.paper);
  return out;
}

export function createPlanPane(container: HTMLElement, actions: PlanActions): { dispose(): void } {
  const pane = el('div', 'ws-pane ws-dash ws-plan');
  container.appendChild(pane);
  const content = el('div', 'ws-dash__content');
  pane.appendChild(content);
  let disposed = false;
  const tip = makeTooltip(pane);
  /** The day whose blocks the card shows; today unless a day in the strip was chosen. */
  let selectedDay = '';
  let renderSeq = 0;

  const load = async (now: number): Promise<Loaded | null> => {
    const row = await getPlanJson().catch(() => null);
    if (!row) return null;
    const { plan } = parsePlan(row.json);
    if (!plan) return null;
    const [items, attempts, blockRows, gradeRows] = await Promise.all([
      listItems().catch(() => []), listAttemptHistory().catch(() => []), listPlanBlocks().catch(() => [] as PlanBlockRow[]), listExamGrades().catch(() => []),
    ]);
    const byId = new Map<number, InsightItem>(items.map((i) => [i.id, i]));
    const states: BlockState[] = blockRows.map((r) => ({ day: r.day, blockId: r.blockId, draw: r.draw, sessionId: r.sessionId, doneAt: r.doneAt }));
    const grades = new Map<number, ExamGrade>(gradeRows.map((g) => [g.itemId, g]));
    const finishedSessions = await getSessionFinishes(states.map((s) => s.sessionId)).catch(() => new Map<string, number>());
    // An exam is graded when every one of its questions carries a grade.
    const gradedPapers = new Map<string, number>();
    for (const paper of examPapers(plan)) {
      const qs = examItems(paper, items);
      if (qs.length > 0 && qs.every((id) => grades.has(id))) gradedPapers.set(paper, Math.max(...qs.map((id) => grades.get(id)!.gradedAt)));
    }
    // Sessions other tools run: the journal line the block names, seen on that day.
    const today = dayKey(now);
    const journalHits = new Map<string, number>();
    for (const d of plan.days) {
      if (d.day > today) continue;
      for (const b of d.blocks) {
        if (b.kind !== 'session' || !b.done) continue;
        const hits = await actions.journalHits(b.done.verb, b.done.object, dayStartMs(d.day)).catch(() => [] as number[]);
        const hit = hits.find((t) => t < dayStartMs(d.day) + DAY_MS);
        if (hit !== undefined) journalHits.set(blockKey(d.day, b.id), hit);
      }
    }
    const ctx: ResolveContext = { finishedSessions, gradedPapers, journalHits };
    // Rewards: earned once, dated, kept.
    const all = await listRewardUnlocks().catch(() => new Map<string, number>());
    const unlocks = new Map([...all].filter(([id]) => id.startsWith('plan:')));
    const exams = examPapers(plan).map((paper) => examSummary(paper, items, grades));
    const base = planProgress(plan, states, ctx, now, 0);
    const newTotal = items.filter((i) => i.source === 'custom').length;
    const newDone = items.filter((i) => i.source === 'custom' && (i.attemptCount > 0 || i.worked)).length;
    const missIds = items.filter((i) => (grades.get(i.id)?.lost ?? 0) > 0).map((i) => i.id);
    const missesRedone = missIds.filter((id) => attempts.some((a) => a.itemId === id && !a.imported && Math.max(a.at, a.workedAt ?? 0) > (grades.get(id)?.gradedAt ?? 0))).length;
    const fresh = earnedPlanRewards({ progress: base, exams, newDone, newTotal, missesRedone, misses: missIds.length }).filter((r) => !unlocks.has(r.id));
    if (fresh.length) {
      await unlockRewards(fresh.map((r) => r.id), now).catch(() => {});
      for (const r of fresh) unlocks.set(r.id, now);
    }
    const progress = planProgress(plan, states, ctx, now, planRewardXp(unlocks.keys()));
    return { plan, items, byId, attempts, states, grades, ctx, progress, unlocks, exams };
  };

  /** Today's quiz blocks get their draw the first time the day is opened; the draw is kept. */
  const ensureDraws = async (L: Loaded, day: string): Promise<boolean> => {
    const d = L.plan.days.find((x) => x.day === day);
    if (!d || day > L.progress.today) return false;
    let changed = false;
    for (const b of d.blocks) {
      if (b.kind !== 'quiz' || !b.pool) continue;
      const st = L.states.find((s) => s.day === day && s.blockId === b.id);
      if (st && st.draw.length > 0) continue;
      const draw = drawBlock(day, b, { items: L.items, attempts: L.attempts, grades: L.grades, drawnOn: drawnOnMap(L.states) });
      if (draw.length === 0) continue;
      await savePlanBlock(day, b.id, { draw }).catch(() => {});
      L.states.push({ day, blockId: b.id, draw, sessionId: '', doneAt: null });
      changed = true;
    }
    return changed;
  };

  const startBlock = async (L: Loaded, day: string, b: PlanBlock, view: BlockView) => {
    if (b.kind === 'quiz') {
      let ids = view.state?.draw ?? [];
      if (ids.length === 0) {
        ids = drawBlock(day, b, { items: L.items, attempts: L.attempts, grades: L.grades, drawnOn: drawnOnMap(L.states) });
        if (ids.length === 0) return;
        await savePlanBlock(day, b.id, { draw: ids }).catch(() => {});
      }
      if (view.state?.sessionId && !view.done) { actions.openQuiz(view.state.sessionId); return; }
      const sessionId = await actions.startQuiz([...ids], `${b.title} · ${fmtDayShort(day)}`);
      if (sessionId) await savePlanBlock(day, b.id, { sessionId }).catch(() => {});
      return;
    }
    if (b.kind === 'exam' && b.paper) {
      if (view.state?.sessionId) { actions.openQuiz(view.state.sessionId); return; }
      const ids = examItems(b.paper, L.items);
      if (ids.length === 0) return;
      await savePlanBlock(day, b.id, { draw: ids }).catch(() => {});
      const sessionId = await actions.startQuiz(ids, b.title);
      if (sessionId) await savePlanBlock(day, b.id, { sessionId }).catch(() => {});
      return;
    }
    if (b.kind === 'grade' && b.paper) { actions.openGrading(b.paper, b.title); return; }
    if (b.kind === 'session' && b.command) {
      const ok = await actions.runCommand(b.command, b.args ?? []);
      if (ok && !view.state) await savePlanBlock(day, b.id, { sessionId: '' }).catch(() => {});
    }
  };

  const blockRow = (L: Loaded, day: string, v: BlockView, isToday: boolean, canStart: boolean): HTMLElement => {
    const b = v.block;
    const row = el('div', `ws-plan__block${v.done ? ' ws-plan__block--done' : v.started ? ' ws-plan__block--started' : ''}`);
    const time = el('div', 'ws-plan__time');
    time.append(el('span', '', clockLabel(b.start)), el('span', '', clockLabel(b.end)));
    row.appendChild(time);
    const text = el('div', 'ws-plan__blocktext');
    text.appendChild(el('div', 'ws-plan__blocktitle', b.title));
    let line = b.note ?? '';
    if (b.kind === 'quiz') {
      const draw = v.state?.draw ?? [];
      line = draw.length ? describeDraw(draw, L.byId, L.grades) : `${b.pool?.count ?? 0} to draw${b.note ? ` · ${b.note}` : ''}`;
    } else if (b.kind === 'exam' && b.paper) {
      const n = examItems(b.paper, L.items).length;
      line = `${n} ${n === 1 ? 'question' : 'questions'}${b.minutes ? `, ${fmtStudyTime(b.minutes * 60)} on the clock` : ''}${b.note ? ` · ${b.note}` : ''}`;
    } else if (b.kind === 'grade' && b.paper) {
      const ex = L.exams.find((e) => e.paper === b.paper);
      line = ex ? `${ex.graded} of ${ex.questions} graded${ex.graded ? ` · ${pct(ex.score)} so far` : ''}${b.note ? ` · ${b.note}` : ''}` : line;
    }
    if (line) text.appendChild(el('div', 'ws-plan__blockline', line));
    row.appendChild(text);
    const state = el('div', 'ws-plan__blockstate');
    if (v.done) state.appendChild(el('span', 'ws-chip ws-chip--easy', v.doneAt ? `Done ${fmtClock(v.doneAt)}` : 'Done'));
    else if (v.started) state.appendChild(el('span', 'ws-chip ws-chip--medium', 'Started'));
    else if (b.required === false) state.appendChild(el('span', 'ws-chip ws-chip--muted', 'Optional'));
    row.appendChild(state);
    const xp = el('div', 'ws-plan__blockxp', `+${b.xp} XP`);
    xp.title = 'Earned when the block is done.';
    row.appendChild(xp);
    const act = el('div', 'ws-plan__blockact');
    const label = v.done ? (b.kind === 'grade' ? 'Grades' : b.kind === 'session' ? '' : 'Review')
      : v.started ? (b.kind === 'grade' ? 'Grade' : b.kind === 'session' ? (b.command ? 'Open' : '') : 'Resume')
        : b.kind === 'exam' ? 'Start the Clock' : b.kind === 'grade' ? 'Grade' : b.kind === 'quiz' ? 'Start Quiz' : b.command ? 'Start' : '';
    if (label) {
      const primary = !v.done && isToday && canStart;
      createButton(act, {
        label, kind: primary ? 'primary' : 'secondary', size: 'sm',
        disabled: !v.done && !canStart,
        title: !v.done && !canStart ? `Opens on ${fmtDayShort(day)}.` : undefined,
        onClick: () => { void startBlock(L, day, b, v); },
      });
    }
    if (b.kind === 'session' && !v.done && canStart) {
      createButton(act, { label: 'Mark Done', kind: 'ghost', size: 'sm', title: 'When the session ran outside the app, or the tool did not report it.', onClick: () => { void savePlanBlock(day, b.id, { doneAt: Date.now() }); } });
    }
    row.appendChild(act);
    return row;
  };

  const render = async () => {
    if (disposed) return;
    const seq = ++renderSeq;
    const now = Date.now();
    const L = await load(now);
    if (disposed || seq !== renderSeq) return;
    tip.hide();
    content.replaceChildren();
    const root = content;
    const back = actions.openHome ? { label: 'Worksheets', onClick: () => actions.openHome!() } : undefined;
    if (!L) {
      createPageHeader(root, { back, title: 'Campaign' });
      createEmptyState(root, {
        icon: 'calendar-check',
        headline: 'No plan yet.',
        hint: 'Import a plan file: days of blocks, each a quiz, an exam, its grading or a session. The dashboard fills in from it.',
        action: { label: 'Import Plan…', onClick: () => actions.importPlan() },
      });
      return;
    }
    const { plan, progress: p } = L;
    const today = p.today;
    if (!selectedDay || !plan.days.some((d) => d.day === selectedDay)) selectedDay = plan.days.some((d) => d.day === today) ? today : (plan.days.find((d) => d.day > today)?.day ?? plan.days[plan.days.length - 1].day);
    if (await ensureDraws(L, today)) { if (!disposed && seq === renderSeq) void render(); return; }

    const todayView = p.days.find((d) => d.day.day === today) ?? null;
    const next = todayView?.blocks.find((b) => !b.done) ?? null;
    const sub = [
      p.daysToExam > 0 ? `Day ${p.dayIndex} of ${p.totalDays}` : p.daysToExam === 0 ? 'Exam day' : 'After the sitting',
      fmtDayLong(today),
      p.daysToExam > 1 ? `${p.daysToExam} days to the sitting` : p.daysToExam === 1 ? 'The sitting is tomorrow' : '',
    ].filter(Boolean).join(' · ');
    const primary: IKitAction | undefined = next && todayView ? {
      label: next.block.kind === 'exam' && !next.started ? 'Start the Clock' : next.started ? `Resume ${next.block.title}` : `Start ${next.block.title}`,
      icon: 'play', onClick: () => { void startBlock(L, today, next.block, next); },
    } : undefined;
    createPageHeader(root, {
      back, title: plan.title, subtitle: sub, primary,
      more: [
        { label: 'Import Plan…', icon: 'folder-input', onSelect: () => actions.importPlan() },
        { label: 'Remove Plan', icon: 'trash', onSelect: () => actions.removePlan() },
      ],
    });

    // The numbers that pull: streak, level, today.
    const tiles = el('div', 'ws-dash__tiles');
    tiles.appendChild(tile('Streak', p.streak > 0 ? `${p.streak} ${p.streak === 1 ? 'day' : 'days'}` : 'None yet', `${p.fullDays} full ${p.fullDays === 1 ? 'day' : 'days'} so far`));
    const lvl = tile(`Level ${p.level.level} · ${p.level.title}`, `${p.xp} XP`, p.level.level >= LEVEL_TITLES.length ? 'Top level' : `${p.level.nextAt - p.xp} to level ${p.level.level + 1}`);
    const bar = el('div', 'ws-camp__xpbar');
    const fill = el('span');
    fill.style.width = `${Math.min(100, Math.round(((p.xp - p.level.floor) / Math.max(1, p.level.nextAt - p.level.floor)) * 100))}%`;
    bar.appendChild(fill);
    lvl.appendChild(bar);
    tiles.appendChild(lvl);
    tiles.appendChild(tile('Today', todayView ? `${todayView.requiredDone} of ${todayView.required}` : '–', todayView ? `blocks done · full day +${plan.fullDayXp} XP` : 'Nothing planned today'));
    tiles.appendChild(tile('Days to the sitting', p.daysToExam > 0 ? String(p.daysToExam) : p.daysToExam === 0 ? 'Today' : '–', fmtDayLong(plan.examDay)));
    root.appendChild(tiles);

    // Today's blocks, or the chosen day's, beside the exams.
    const top = el('div', 'ws-plan__top');
    root.appendChild(top);
    const dayView = p.days.find((d) => d.day.day === selectedDay) ?? todayView;
    const isToday = dayView?.day.day === today;
    const dayCard = card(isToday ? 'Today' : fmtDayShort(dayView?.day.day ?? today), dayView ? `${dayView.day.label}${dayView.full ? ' · full day' : ''}` : 'Nothing planned');
    if (dayView) {
      const canStart = dayView.day.day <= today;
      for (const v of dayView.blocks) dayCard.body.appendChild(blockRow(L, dayView.day.day, v, !!isToday, canStart));
      const foot = dayView.full ? `Full day: every block done, +${plan.fullDayXp} XP.` : dayView.required > 0 ? `${dayView.required - dayView.requiredDone} of ${dayView.required} required blocks to go. A full day earns +${plan.fullDayXp} XP.` : 'Nothing required today.';
      dayCard.foot.appendChild(el('span', 'ws-hint', foot));
    }
    top.appendChild(dayCard.root);

    const examsCard = card('Practice exams', 'Each exam is its own paper. Grading is Reveal and Rate, plus the points lost and why.');
    for (const d of plan.days) {
      for (const b of d.blocks) {
        if (b.kind !== 'exam' || !b.paper) continue;
        const v = p.days.find((x) => x.day.day === d.day)?.blocks.find((x) => x.block.id === b.id);
        const ex = L.exams.find((e) => e.paper === b.paper);
        const gradeBlock = plan.days.flatMap((x) => x.blocks.map((y) => ({ day: x.day, b: y }))).find((x) => x.b.kind === 'grade' && x.b.paper === b.paper);
        const box = el('div', 'ws-plan__exam');
        const head = el('div', 'ws-plan__examhead');
        head.appendChild(el('span', 'ws-plan__examtitle', `${b.title} · ${fmtDayShort(d.day)}`));
        if (ex && ex.graded > 0) head.appendChild(el('span', 'ws-plan__examscore', pct(ex.score)));
        box.appendChild(head);
        const chips = el('div', 'ws-chips');
        chips.appendChild(el('span', `ws-chip ${v?.done ? 'ws-chip--easy' : v?.started ? 'ws-chip--medium' : 'ws-chip--muted'}`, v?.done ? `Sat${v.doneAt ? ' ' + fmtDayShort(dayKey(v.doneAt)) : ''}` : v?.started ? 'In progress' : d.day > today ? `In ${Math.round((dayStartMs(d.day) - dayStartMs(today)) / DAY_MS)} days` : 'Not sat'));
        if (ex) chips.appendChild(el('span', `ws-chip ${ex.graded >= ex.questions && ex.questions > 0 ? 'ws-chip--easy' : ex.graded > 0 ? 'ws-chip--medium' : 'ws-chip--muted'}`, ex.questions === 0 ? 'Not imported' : `${ex.graded} of ${ex.questions} graded`));
        box.appendChild(chips);
        if (ex && ex.graded > 0) {
          const list = el('div', 'ws-plan__readings');
          for (const r of ex.byReading.slice(0, 6)) {
            const line = el('div', 'ws-plan__reading');
            line.appendChild(el('span', 'ws-plan__readingname', paperLabel(r.reading) || 'Unknown reading'));
            const track = el('div', 'ws-plan__readingbar');
            const f = el('span');
            f.style.width = `${r.points > 0 ? Math.round((r.lost / r.points) * 100) : 0}%`;
            track.appendChild(f);
            line.appendChild(track);
            line.appendChild(el('span', 'ws-plan__readingnum', `${r.lost} of ${r.points} lost`));
            list.appendChild(line);
          }
          box.appendChild(list);
          if (ex.causes.length) box.appendChild(el('div', 'ws-hint', `Causes: ${ex.causes.map((c) => `${causeLabel(c.cause).toLowerCase()} ${c.count}`).join(', ')}`));
        }
        const acts = el('div', 'ws-plan__examacts');
        if (v?.state?.sessionId) createButton(acts, { label: v.done ? 'Review Exam' : 'Resume Exam', size: 'sm', onClick: () => actions.openQuiz(v.state!.sessionId) });
        if (ex && ex.questions > 0) createButton(acts, { label: ex.graded > 0 ? 'Grades' : 'Grade…', size: 'sm', onClick: () => actions.openGrading(b.paper!, gradeBlock?.b.title ?? `Grade ${b.title}`) });
        box.appendChild(acts);
        examsCard.body.appendChild(box);
      }
    }
    top.appendChild(examsCard.root);

    // Every day as a strip: the type, a dot per block, the state.
    root.appendChild(el('div', 'ws-dash__sectiontitle', 'The plan, day by day'));
    const strip = el('div', 'ws-plan__days');
    for (const dv of p.days) {
      const cell = el('button', `ws-plan__day ws-plan__day--${dv.state}${dv.day.day === selectedDay ? ' ws-plan__day--selected' : ''}`) as HTMLButtonElement;
      cell.type = 'button';
      const headRow = el('div', 'ws-plan__dayhead');
      headRow.appendChild(el('span', 'ws-plan__daydate', fmtDayShort(dv.day.day)));
      headRow.appendChild(el('span', 'ws-plan__daystate', dv.state === 'full' ? 'Full' : dv.state === 'today' ? 'Today' : dv.state === 'partial' ? 'Partial' : dv.state === 'missed' ? 'Missed' : ''));
      cell.appendChild(headRow);
      cell.appendChild(el('div', 'ws-plan__daylabel', dv.day.label || dv.day.type));
      const dots = el('div', 'ws-plan__dots');
      for (const b of dv.blocks) dots.appendChild(el('span', `ws-plan__dot ws-plan__dot--${b.done ? 'done' : b.started ? 'started' : dv.state === 'missed' || (dv.state === 'partial' && dv.day.day < today) ? 'missed' : 'none'}`));
      cell.appendChild(dots);
      cell.title = `${fmtDayLong(dv.day.day)}: ${dv.day.label}. ${dv.blocks.filter((b) => b.done).length} of ${dv.blocks.length} blocks done${dv.xp ? `, +${dv.xp} XP` : ''}.`;
      cell.addEventListener('click', () => { selectedDay = dv.day.day; void render(); });
      strip.appendChild(cell);
    }
    root.appendChild(strip);

    // Pools, sessions reported, rewards.
    const grid = el('div', 'ws-dash__grid');
    root.appendChild(grid);
    const pools = card('Problem pools', 'Where the quizzes draw from, by latest rating');
    const workbook = L.items.filter((i) => !!i.paper && i.kind !== 'essay' && (i.source === 'rf' || i.source === 'cas'));
    const rating = (i: InsightItem) => normalizeRating(i.attemptState);
    const planStart = dayStartMs(plan.days[0].day);
    const sinceStart = (i: InsightItem) => L.attempts.some((a) => a.itemId === i.id && !a.imported && Math.max(a.at, a.workedAt ?? 0) >= planStart);
    const poolLine = (label: string, list: InsightItem[], note: string) => {
      const done = list.filter(sinceStart).length;
      const row = el('div', 'ws-plan__pool');
      const head = el('div', 'ws-plan__poolhead');
      head.appendChild(el('span', 'ws-plan__poolname', label));
      head.appendChild(el('span', 'ws-plan__poolnum', `${done} of ${list.length}`));
      row.appendChild(head);
      const track = el('div', 'ws-plan__poolbar');
      const f = el('span');
      f.style.width = `${list.length ? Math.round((done / list.length) * 100) : 0}%`;
      track.appendChild(f);
      row.appendChild(track);
      if (note) row.appendChild(el('div', 'ws-hint', note));
      pools.body.appendChild(row);
    };
    const misses = L.items.filter((i) => (L.grades.get(i.id)?.lost ?? 0) > 0);
    const redone = misses.filter((i) => L.attempts.some((a) => a.itemId === i.id && !a.imported && Math.max(a.at, a.workedAt ?? 0) > (L.grades.get(i.id)?.gradedAt ?? 0)));
    const missRow = el('div', 'ws-plan__pool');
    const mh = el('div', 'ws-plan__poolhead');
    mh.appendChild(el('span', 'ws-plan__poolname', 'Exam misses'));
    mh.appendChild(el('span', 'ws-plan__poolnum', `${redone.length} of ${misses.length} redone`));
    missRow.appendChild(mh);
    const mt = el('div', 'ws-plan__poolbar ws-plan__poolbar--miss');
    const mf = el('span'); mf.style.width = `${misses.length ? Math.round((redone.length / misses.length) * 100) : 0}%`; mt.appendChild(mf);
    missRow.appendChild(mt);
    missRow.appendChild(el('div', 'ws-hint', 'Every question with lost points. First in line on the next old-problems block.'));
    pools.body.appendChild(missRow);
    poolLine('Starred, rated Hard', workbook.filter((i) => i.starred && rating(i) === 'hard'), 'Hard-focus days');
    poolLine('Starred, rated Medium', workbook.filter((i) => i.starred && rating(i) === 'medium'), 'Medium-focus days');
    poolLine('New problems', L.items.filter((i) => i.source === 'custom'), 'Never seen before the plan; drawn across papers');
    poolLine('Easy and Medium', workbook.filter((i) => rating(i) === 'easy' || rating(i) === 'medium'), 'Soft sessions');
    grid.appendChild(pools.root);

    const sessions = card('Sessions reported', 'What other tools said they finished, from the activity journal');
    const finished = await actions.journalFinished(dayStartMs(today) - 6 * DAY_MS).catch(() => []);
    if (disposed || seq !== renderSeq) return;
    const byDay = new Map<string, { object: string; detail: string; ts: number }[]>();
    for (const f of finished) { const d = dayKey(f.ts); if (!byDay.has(d)) byDay.set(d, []); byDay.get(d)!.push(f); }
    if (finished.length === 0) sessions.body.appendChild(el('div', 'ws-dash__cardempty', 'Nothing reported in the last week. A session another tool finishes shows up here.'));
    for (const d of [...byDay.keys()].sort().reverse().slice(0, 4)) {
      sessions.body.appendChild(el('div', 'ws-plan__sessionday', d === today ? 'Today' : fmtDayShort(d)));
      for (const f of byDay.get(d)!.slice(0, 6)) {
        const line = el('div', 'ws-plan__session');
        line.appendChild(el('span', 'ws-plan__sessionwhat', f.object));
        line.appendChild(el('span', 'ws-plan__sessiondetail', `${f.detail ? `${f.detail} · ` : ''}${fmtClock(f.ts)}`));
        sessions.body.appendChild(line);
      }
    }
    grid.appendChild(sessions.root);

    const rewards = card('Rewards', 'Milestones of the plan. Each one earned adds its XP.');
    const list = el('div', 'ws-plan__rewards');
    const sorted = [...PLAN_REWARDS].sort((a, b) => Number(L.unlocks.has(b.id)) - Number(L.unlocks.has(a.id)));
    for (const r of sorted) {
      const at = L.unlocks.get(r.id);
      const rowEl = el('div', `ws-plan__reward${at ? '' : ' ws-plan__reward--locked'}`);
      const ic = el('span', 'ws-reward__icon');
      ic.innerHTML = actions.renderIcon?.(at ? r.icon : 'lock', 16) ?? '';
      rowEl.appendChild(ic);
      const t = el('div', 'ws-plan__rewardtext');
      t.appendChild(el('div', 'ws-plan__rewardtitle', r.title));
      t.appendChild(el('div', 'ws-plan__rewardhint', at ? `Earned ${fmtDayShort(dayKey(at))}, +${r.xp} XP` : `${r.hint} +${r.xp} XP`));
      rowEl.appendChild(t);
      if (at && now - at < 10 * 60000) rowEl.appendChild(el('span', 'ws-chip ws-chip--easy ws-reward__new', 'New'));
      list.appendChild(rowEl);
    }
    rewards.body.appendChild(list);
    grid.appendChild(rewards.root);
  };

  void render();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const sub = onWorksheetDataChanged(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; void render(); }, 300);
  });
  // Another tool's session finishing reaches the journal, not the worksheet data: look again every minute.
  const tick = setInterval(() => { if (!disposed && document.visibilityState === 'visible') void render(); }, 60_000);
  return {
    dispose: () => {
      disposed = true;
      sub.dispose();
      clearInterval(tick);
      if (timer) clearTimeout(timer);
      pane.remove();
    },
  };
}

// ── Grading an exam ─────────────────────────────────────────────────────────

export interface GradingActions {
  openItem(id: number, title: string): void;
  openHome?(): void;
  openPlan(): void;
}

/** One row per question: points, points lost, the cause. Saved as typed; the exam is graded when every row has a grade. */
export function createGradingPane(container: HTMLElement, paper: string, title: string, actions: GradingActions): { dispose(): void } {
  const pane = el('div', 'ws-pane ws-dash ws-grade');
  container.appendChild(pane);
  const content = el('div', 'ws-dash__content');
  pane.appendChild(content);
  let disposed = false;
  let renderSeq = 0;
  /** Edits in flight are not redrawn over: a save announces a change, which would rebuild the inputs mid-typing. */
  let editing = false;

  const render = async () => {
    if (disposed || editing) return;
    const seq = ++renderSeq;
    const [items, gradeRows] = await Promise.all([listItems().catch(() => []), listExamGrades().catch(() => [])]);
    if (disposed || seq !== renderSeq) return;
    const grades = new Map<number, ExamGrade>(gradeRows.map((g) => [g.itemId, g]));
    const ids = examItems(paper, items);
    const byId = new Map(items.map((i) => [i.id, i]));
    const summary = examSummary(paper, items, grades);
    content.replaceChildren();
    const back = { label: 'Campaign', onClick: () => actions.openPlan() };
    createPageHeader(content, {
      back, title,
      subtitle: ids.length ? `${summary.graded} of ${ids.length} graded${summary.graded ? ` · ${pct(summary.score)} · ${summary.lost} of ${summary.points} points lost` : ''}` : 'This exam is not in the bank.',
    });
    if (ids.length === 0) {
      createEmptyState(content, { icon: 'file-spreadsheet', headline: 'No questions found.', hint: `Import the exam workbook first; its questions arrive as the paper ${paperLabel(paper)}.` });
      return;
    }
    content.appendChild(el('div', 'ws-hint ws-grade__hint', 'Open a question, Reveal its solution and Rate it there. Here, write the points it carried, the points you lost, and why. A question with nothing lost needs only its points.'));
    const table = el('div', 'ws-grade__rows');
    const head = el('div', 'ws-grade__row ws-grade__row--head');
    for (const h of ['Question', 'Points', 'Lost', 'Why', '']) head.appendChild(el('span', '', h));
    table.appendChild(head);
    for (const id of ids) {
      const it = byId.get(id)!;
      const g = grades.get(id);
      const row = el('div', `ws-grade__row${g ? (g.lost > 0 ? ' ws-grade__row--lost' : ' ws-grade__row--clean') : ''}`);
      const name = el('button', 'ws-grade__q') as HTMLButtonElement;
      name.type = 'button';
      name.textContent = it.title.replace(/^PE\s*\d+\s*·\s*/i, '');
      name.title = `Open ${it.title}`;
      name.addEventListener('click', () => actions.openItem(id, it.title));
      row.appendChild(name);
      const points = el('input', 'ws-grade__input') as HTMLInputElement;
      points.type = 'number'; points.min = '0'; points.step = '0.25'; points.id = `ws-grade-points-${id}`;
      points.value = g ? String(g.points) : it.points != null ? String(it.points) : '';
      points.setAttribute('aria-label', 'Points the question carries');
      const lost = el('input', 'ws-grade__input') as HTMLInputElement;
      lost.type = 'number'; lost.min = '0'; lost.step = '0.25'; lost.id = `ws-grade-lost-${id}`;
      lost.value = g ? String(g.lost) : '';
      lost.setAttribute('aria-label', 'Points lost');
      row.append(points, lost);
      const causeHost = el('div', 'ws-grade__cause');
      let cause = g?.cause ?? '';
      const seg = createSegmented(causeHost, { items: CAUSES.map((c) => ({ value: c.value, label: c.label })), value: cause || CAUSES[0].value, ariaLabel: 'Why the points were lost', onChange: (v) => { cause = v; void save(); } });
      row.appendChild(causeHost);
      const clear = el('div', 'ws-grade__clear');
      if (g) createButton(clear, { label: 'Clear', kind: 'ghost', size: 'sm', onClick: () => { void deleteExamGrade(id); } });
      row.appendChild(clear);
      const save = async () => {
        const pts = Number(points.value);
        const lst = Number(lost.value);
        if (!Number.isFinite(pts) || pts <= 0 || points.value === '') return;
        if (lost.value === '' || !Number.isFinite(lst) || lst < 0) return;
        editing = true;
        try { await upsertExamGrade({ itemId: id, points: pts, lost: Math.min(pts, lst), cause: lst > 0 ? (cause || seg.value) : '' }); }
        finally { editing = false; }
      };
      for (const input of [points, lost]) {
        input.addEventListener('focus', () => { editing = true; });
        input.addEventListener('blur', () => { editing = false; void save().then(() => render()); });
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); });
      }
      table.appendChild(row);
    }
    content.appendChild(table);
    const foot = el('div', 'ws-grade__foot');
    foot.appendChild(el('span', 'ws-hint', summary.graded >= ids.length ? 'Every question graded. The misses join the pool and lead the next old-problems block.' : `${ids.length - summary.graded} ${ids.length - summary.graded === 1 ? 'question' : 'questions'} still to grade.`));
    createButton(foot, { label: 'Back to Campaign', size: 'sm', onClick: () => actions.openPlan() });
    content.appendChild(foot);
  };
  void render();
  const sub = onWorksheetDataChanged(() => { void render(); });
  return { dispose: () => { disposed = true; sub.dispose(); pane.remove(); } };
}

/** For the quiz run: the exam block a session belongs to, if any, with its clock. */
export async function examClockFor(sessionId: string, lookup: (sessionId: string) => Promise<PlanBlockRow | null>): Promise<{ minutes: number; title: string } | null> {
  const row = await lookup(sessionId).catch(() => null);
  if (!row) return null;
  const planRow = await getPlanJson().catch(() => null);
  if (!planRow) return null;
  const { plan } = parsePlan(planRow.json);
  const block = plan?.days.find((d) => d.day === row.day)?.blocks.find((b) => b.id === row.blockId);
  if (!block || block.kind !== 'exam' || !block.minutes) return null;
  return { minutes: block.minutes, title: block.title };
}

// Referenced so the pure helpers stay reachable from here for tests and the run pane.
export { resolveBlock, readingOf, getItem, type PlanDay, type DayView };
