// dashboardPane.ts — Worksheets: the Problem Bank dashboard tab.
//
// The workbook's Dashboard sheet, rebuilt from the bank: the two headline
// numbers it kept (attempted %, score), time and pace it could not keep,
// progress by paper weakest first, the timeline (its own history ahead of
// every rating given here), and four lists that answer "what next": what
// is due again, what keeps going wrong, the weakest papers, and the vendor's
// easy-and-likely problems never tried. Every row opens the problem or
// starts a quiz; the arithmetic lives in progressInsights.ts.
import { listItems, listAttemptHistory, listProgressSnapshots, onWorksheetDataChanged, getCampaign, getDailyDraw, saveDailyDraw, getOpenQuizSession, getStudySecondsByDay, getXpCashouts } from './worksheetData.js';
import { computeInsights, dayKey, type Insights, type PaperProgress, type InsightItem, type InsightAttempt, type TimelinePoint } from './progressInsights.js';
import { campaignProgress, campaignDone, drawToday, dayStory, addDays, restDaysLabel, isCampaignProblem, LEVEL_TITLES, XP_PER_PROBLEM, XP_EASY_BONUS, XP_FULL_DAY, type Campaign, type CampaignProgress, type DayStory } from './campaign.js';
import { syncRewards, type RewardState } from './rewardsSync.js';
import { REWARDS } from './rewards.js';
import { paperLabel, ratingLabel, normalizeRating, QUADRANT_LABELS } from './problemImport.js';

export interface DashboardActions {
  openItem(id: number, title: string): void;
  /** Start a new, named quiz over exactly these problems, in this order, at `startAt`. */
  startQuiz(ids: number[], startAt?: number, name?: string): void;
  /** Reopen the open quiz used most recently, where it was. */
  resumeQuiz(): void;
  /** Reopen a past quiz to review it. */
  openQuiz(id: string): void;
  /** Icon markup from the registry, for the rewards. */
  renderIcon?(id: string, size: number): string;
  /** Open the quiz builder with these filters already chosen. */
  configureQuiz(preset: { papers?: string[]; state?: string; starred?: 'starred' | 'unstarred'; ids?: number[]; name?: string }): void;
  importWorkbook(): void;
  /** The exam date (YYYY-MM-DD) from Settings, '' when not set. */
  examDate?(): string;
  /** Dollars per 100 XP from Settings; 0 when cash is off. */
  xpCashRate?(): number;
  /** Record a cash-out of this much XP for this many cents (asks first). */
  cashOut?(xp: number, cents: number): Promise<void>;
  /** The day's other quest: the flashcards extension's due cards. */
  studyFlashcards(): void;
  /** Worksheets Settings: where a campaign is set up and ended. */
  openSettings(): void;
}

function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function btn(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', className) as HTMLButtonElement;
  b.type = 'button';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}
const pct = (v: number): string => `${Math.round(v * 100)}%`;
const DAY_MS = 86400000;

export function fmtStudyTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return s === 0 ? '0m' : '<1m';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${String(m).padStart(2, '0')}m`;
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function dayMs(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}
function fmtDay(day: string, withYear = false): string {
  const [y, m, d] = day.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}${withYear ? ` ${y}` : ''}`;
}
function daysAgoLabel(n: number): string {
  return n <= 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`;
}

// ── Pieces ──────────────────────────────────────────────────────────────────

/** A label and a number; the sentence behind them is the tooltip (Mufaro, 2026-09-21: no wording the number already says). */
function tile(label: string, value: string, sub: string): HTMLElement {
  const t = el('div', 'ws-dash__tile');
  t.title = sub;
  t.appendChild(el('div', 'ws-dash__tilelabel', label));
  t.appendChild(el('div', 'ws-dash__tilevalue', value));
  return t;
}

/** A card: its title carries the explanation as a tooltip, the body carries the content. */
function card(title: string, hint: string, onQuiz?: () => void): { root: HTMLElement; body: HTMLElement; foot: HTMLElement } {
  const root = el('section', 'ws-dash__card');
  const head = el('div', 'ws-dash__cardhead');
  const t = el('div', 'ws-dash__cardtitle', title);
  t.title = onQuiz ? `${hint}. Click the card for a quiz of these.` : hint;
  // The card is the way to a quiz of what it lists (Mufaro, 2026-09-21: no
  // button repeated under every card). A problem row keeps its own click;
  // anywhere else on the card opens the builder with the set handed over.
  if (onQuiz) {
    root.classList.add('ws-dash__card--link');
    root.setAttribute('role', 'button');
    root.tabIndex = 0;
    root.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('.ws-dash__row, .ws-dash__paperline, button, a')) return; onQuiz(); });
    root.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === root) { e.preventDefault(); onQuiz(); } });
  }
  head.appendChild(t);
  root.appendChild(head);
  const body = el('div', 'ws-dash__cardbody');
  root.appendChild(body);
  const foot = el('div', 'ws-dash__cardfoot');
  root.appendChild(foot);
  return { root, body, foot };
}

function problemRow(item: InsightItem, meta: string, dot: string, onOpen: () => void): HTMLElement {
  const row = btn('', 'ws-dash__row', onOpen);
  const d = el('span', `ws-bank__dot ${dot}`);
  row.appendChild(d);
  const text = el('span', 'ws-dash__rowtext');
  text.appendChild(el('span', 'ws-dash__rowtitle', item.title));
  text.appendChild(el('span', 'ws-dash__rowmeta', [paperLabel(item.paper), meta].filter(Boolean).join(' · ')));
  row.appendChild(text);
  row.title = `Open ${item.title}`;
  return row;
}

/** A floating tooltip that follows the pointer inside the pane. */
function makeTooltip(pane: HTMLElement): { show(x: number, y: number, lines: string[]): void; hide(): void } {
  const tip = el('div', 'ws-dash__tip');
  tip.hidden = true;
  pane.appendChild(tip);
  return {
    show(x, y, lines) {
      tip.replaceChildren();
      lines.forEach((line, i) => tip.appendChild(el('div', i === 0 ? 'ws-dash__tiphead' : 'ws-dash__tipline', line)));
      tip.hidden = false;
      const box = pane.getBoundingClientRect();
      const left = Math.min(x - box.left + 14, pane.clientWidth - tip.offsetWidth - 8);
      const top = y - box.top + pane.scrollTop - tip.offsetHeight - 10;
      tip.style.left = `${Math.max(4, left)}px`;
      tip.style.top = `${Math.max(pane.scrollTop + 4, top)}px`;
    },
    hide() { tip.hidden = true; },
  };
}

// ── Progress by paper: horizontal stacked bars, weakest first ───────────────

function paperBars(host: HTMLElement, papers: PaperProgress[], items: readonly InsightItem[], tip: ReturnType<typeof makeTooltip>, actions: DashboardActions): void {
  const legend = el('div', 'ws-dash__legend');
  for (const [cls, label] of [['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard'], ['rest', 'Not Rated']]) {
    const item = el('span', 'ws-dash__legenditem');
    item.appendChild(el('span', `ws-dash__swatch ${cls}`));
    item.appendChild(document.createTextNode(label));
    legend.appendChild(item);
  }
  host.appendChild(legend);
  for (const p of papers) {
    const row = el('div', 'ws-dash__paperrow');
    const name = btn(paperLabel(p.paper), 'ws-dash__papername', () => actions.configureQuiz({ papers: [p.paper] }));
    name.title = `Quiz ${paperLabel(p.paper)}`;
    row.appendChild(name);
    const bar = el('div', 'ws-dash__bar');
    bar.setAttribute('role', 'group');
    bar.setAttribute('aria-label', `${paperLabel(p.paper)}: ${p.easy} easy, ${p.medium} medium, ${p.hard} hard, ${p.total - p.rated} not rated`);
    // Each segment is a quiz: the red of a paper opens its Hard problems
    // (Mufaro, 2026-09-21), the grey its problems never rated.
    const segNames: Record<string, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard', rest: 'Not Rated' };
    const segIds = (cls: string) => items
      .filter((it) => it.paper === p.paper && (cls === 'rest' ? !normalizeRating(it.attemptState) : normalizeRating(it.attemptState) === cls))
      .map((it) => it.id);
    const seg = (cls: string, n: number) => {
      if (n <= 0) return;
      const s = el('span', cls);
      s.style.flexGrow = String(n);
      s.setAttribute('role', 'button');
      s.tabIndex = 0;
      s.setAttribute('aria-label', `Quiz ${paperLabel(p.paper)} ${segNames[cls]}, ${n} problems`);
      const go = () => { const ids = segIds(cls); if (ids.length) actions.startQuiz(ids, 0, `${paperLabel(p.paper)} ${segNames[cls]}`); };
      s.addEventListener('click', (e) => { e.stopPropagation(); go(); });
      s.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
      s.addEventListener('mousemove', (e) => { e.stopPropagation(); tip.show(e.clientX, e.clientY, [`${paperLabel(p.paper)} ${segNames[cls]}: ${n}`, 'Click for a quiz of just these.']); });
      bar.appendChild(s);
    };
    seg('easy', p.easy); seg('medium', p.medium); seg('hard', p.hard); seg('rest', p.total - p.rated);
    row.appendChild(bar);
    const label = p.rated > 0 ? `${p.rated}/${p.total} · ${pct(p.score)}` : `0/${p.total}`;
    row.appendChild(el('span', 'ws-dash__barlabel', label));
    const lines = [
      paperLabel(p.paper),
      `Easy ${p.easy} · Medium ${p.medium} · Hard ${p.hard} · Not rated ${p.total - p.rated}`,
      p.rated > 0 ? `Score ${pct(p.score)} over ${p.rated} rated, ${p.total - p.rated} left` : `Nothing rated yet, ${p.total} left`,
      p.seconds > 0 ? `Time ${fmtStudyTime(p.seconds)}${p.perProblem > 0 ? `, ${fmtStudyTime(p.perProblem)} per problem` : ''}` : '',
      'Click a segment for a quiz of just those problems.',
    ].filter(Boolean);
    row.addEventListener('mousemove', (e) => tip.show(e.clientX, e.clientY, lines));
    row.addEventListener('mouseleave', () => tip.hide());
    host.appendChild(row);
  }
}

// ── Progress over time: one line per chart, a dashed target, a crosshair ────

interface ChartPoint { day: string; value: number; source: TimelinePoint['source'] }

/** `opts.max` is the top of the y axis (1 for a share), `opts.fmt` the value's text (percent by default); `target` null draws no target line. */
function lineChart(host: HTMLElement, title: string, points: ChartPoint[], target: number | null, tip: ReturnType<typeof makeTooltip>, opts: { max?: number; fmt?: (v: number) => string } = {}): () => void {
  const max = opts.max && opts.max > 0 ? opts.max : 1;
  const fmt = opts.fmt ?? pct;
  const wrap = el('div', 'ws-dash__chart');
  wrap.appendChild(el('div', 'ws-dash__charttitle', title));
  const svgHost = el('div', 'ws-dash__svghost');
  wrap.appendChild(svgHost);
  host.appendChild(wrap);
  if (points.length === 0) {
    svgHost.appendChild(el('div', 'ws-dash__chartempty', 'Rate a problem and the line starts here.'));
    return () => {};
  }
  const NS = 'http://www.w3.org/2000/svg';
  const H = 190; const TOP = 14; const BOTTOM = 24; const LEFT = 38; const RIGHT = 44;
  const t0 = dayMs(points[0].day); const t1 = dayMs(points[points.length - 1].day);
  const span = Math.max(1, t1 - t0);

  const draw = (width: number) => {
    const W = Math.max(160, Math.floor(width));
    const plotW = W - LEFT - RIGHT; const plotH = H - TOP - BOTTOM;
    const x = (day: string) => points.length === 1 ? LEFT + plotW / 2 : LEFT + ((dayMs(day) - t0) / span) * plotW;
    const y = (v: number) => TOP + (1 - Math.max(0, Math.min(1, v / max))) * plotH;
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', String(W)); svg.setAttribute('height', String(H));
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `${title}: ${fmt(points[points.length - 1].value)} on ${fmtDay(points[points.length - 1].day, true)}`);
    const mk = (name: string, attrs: Record<string, string | number>) => {
      const n = document.createElementNS(NS, name);
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
      svg.appendChild(n);
      return n;
    };
    // Recessive grid and y labels.
    for (const g of [0, 0.5, 1]) {
      mk('line', { x1: LEFT, x2: W - RIGHT, y1: y(g * max), y2: y(g * max), class: 'ws-dash__gridline' });
      const t = mk('text', { x: LEFT - 6, y: y(g * max) + 4, class: 'ws-dash__axis', 'text-anchor': 'end' });
      t.textContent = fmt(g * max);
    }
    if (target != null) {
      // The target, dashed and neutral, named once.
      mk('line', { x1: LEFT, x2: W - RIGHT, y1: y(target), y2: y(target), class: 'ws-dash__target' });
      // Named at the left end, above the line, clear of the last value's label on the right.
      const tl = mk('text', { x: LEFT + 4, y: y(target) - 4, class: 'ws-dash__axis' });
      tl.textContent = `Target ${fmt(target)}`;
    }
    // X labels: first and last day, month starts between when there is room.
    const labels: { day: string; text: string }[] = [{ day: points[0].day, text: fmtDay(points[0].day) }];
    if (points.length > 1) {
      const first = new Date(t0); const last = new Date(t1);
      const cursor = new Date(first.getFullYear(), first.getMonth() + 1, 1);
      while (cursor.getTime() < t1) {
        const d = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-01`;
        labels.push({ day: d, text: MONTHS[cursor.getMonth()] });
        cursor.setMonth(cursor.getMonth() + 1);
      }
      labels.push({ day: points[points.length - 1].day, text: fmtDay(points[points.length - 1].day) });
      void last;
    }
    let lastX = -Infinity;
    for (const l of labels) {
      const lx = x(l.day);
      if (lx - lastX < 46) continue;
      const anchor = lx > W - RIGHT - 20 ? 'end' : lx < LEFT + 20 ? 'start' : 'middle';
      const t = mk('text', { x: lx, y: H - 6, class: 'ws-dash__axis', 'text-anchor': anchor });
      t.textContent = l.text;
      lastX = lx;
    }
    // The series: the workbook's history in the same line, its part dashed.
    const wb = points.filter((p) => p.source === 'workbook');
    const own = points.filter((p) => p.source === 'attempts');
    const path = (ps: ChartPoint[]) => ps.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.day).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
    if (wb.length > 0) {
      const joined = own.length > 0 ? [...wb, own[0]] : wb;
      mk('path', { d: path(joined), class: 'ws-dash__series ws-dash__series--history' });
    }
    if (own.length > 0) mk('path', { d: path(own), class: 'ws-dash__series' });
    if (points.length === 1) mk('circle', { cx: x(points[0].day), cy: y(points[0].value), r: 4, class: 'ws-dash__marker' });
    // The last value, labeled directly.
    const last = points[points.length - 1];
    mk('circle', { cx: x(last.day), cy: y(last.value), r: 4, class: 'ws-dash__marker' });
    const lv = mk('text', { x: x(last.day) + 8, y: y(last.value) - 8, class: 'ws-dash__value', 'text-anchor': x(last.day) > W - RIGHT - 30 ? 'end' : 'start' });
    lv.textContent = fmt(last.value);
    // Crosshair + tooltip.
    const cross = mk('line', { x1: 0, x2: 0, y1: TOP, y2: H - BOTTOM, class: 'ws-dash__cross' });
    const ring = mk('circle', { cx: 0, cy: 0, r: 5, class: 'ws-dash__ring' });
    cross.setAttribute('visibility', 'hidden'); ring.setAttribute('visibility', 'hidden');
    const hit = mk('rect', { x: LEFT, y: 0, width: plotW, height: H, fill: 'transparent' });
    hit.addEventListener('mousemove', (e: MouseEvent) => {
      const box = svg.getBoundingClientRect();
      const px = e.clientX - box.left;
      let best = points[0]; let bestD = Infinity;
      for (const p of points) { const d = Math.abs(x(p.day) - px); if (d < bestD) { bestD = d; best = p; } }
      cross.setAttribute('x1', String(x(best.day))); cross.setAttribute('x2', String(x(best.day)));
      ring.setAttribute('cx', String(x(best.day))); ring.setAttribute('cy', String(y(best.value)));
      cross.setAttribute('visibility', 'visible'); ring.setAttribute('visibility', 'visible');
      tip.show(e.clientX, e.clientY, [fmtDay(best.day, true), `${title} ${fmt(best.value)}`, best.source === 'workbook' ? 'From the workbook' : '']);
    });
    hit.addEventListener('mouseleave', () => { cross.setAttribute('visibility', 'hidden'); ring.setAttribute('visibility', 'hidden'); tip.hide(); });
    svgHost.replaceChildren(svg);
  };

  draw(svgHost.clientWidth || 320);
  const ro = new ResizeObserver((entries) => { for (const en of entries) draw(en.contentRect.width); });
  ro.observe(svgHost);
  return () => ro.disconnect();
}

// ── The campaign: every problem in the bank in N days ───────────────────────

type Tip = ReturnType<typeof makeTooltip>;

type QuizResume = { name: string; position: number; total: number } | null;

/**
 * The day's story under the quota line: today's tally while the day is on,
 * the last working day's tally first thing in the morning, the week's on a
 * rest day. Nothing at all when there is nothing to tell.
 */
function storyRow(story: DayStory, p: CampaignProgress): HTMLElement | null {
  const row = el('div', 'ws-camp__tally');
  const chip = (cls: string, text: string, title?: string) => {
    const c = el('span', `ws-chip ${cls}`, text);
    if (title) c.title = title;
    row.appendChild(c);
  };
  const split = (t: { easy: number; medium: number; hard: number; unrated: number }) => {
    if (t.easy) chip('ws-chip--easy', `${t.easy} Easy`);
    if (t.medium) chip('ws-chip--medium', `${t.medium} Medium`);
    if (t.hard) chip('ws-chip--hard', `${t.hard} Hard`);
    // Worked and never rated: it counts for the day, and saying so is the
    // only way the missing rating is ever visible.
    if (t.unrated) chip('ws-chip--open', `${t.unrated} Worked, Not Rated`, 'Counted for the day. Rating them scores them and sets when they come back.');
  };
  const xpTip = `${XP_PER_PROBLEM} a problem, ${XP_EASY_BONUS} more for Easy, ${XP_FULL_DAY} for a full day`;
  if (p.restToday) {
    const w = story.week;
    if (w.done === 0) return null;
    row.appendChild(el('span', 'ws-camp__tallylabel', 'This Week'));
    chip('ws-chip--muted', `${w.done} Done`);
    split(w);
    if (w.seconds >= 60) chip('ws-chip--muted', fmtStudyTime(w.seconds));
    if (w.fullDays) chip('ws-chip--muted', `${w.fullDays} Full ${w.fullDays === 1 ? 'Day' : 'Days'}`);
    if (w.papers > 1) chip('ws-chip--muted', `${w.papers} Papers`);
    return row;
  }
  const t = story.today;
  if (t.done > 0) {
    split(t);
    if (t.seconds >= 60) chip('ws-chip--muted', fmtStudyTime(t.seconds));
    if (t.papers > 1) chip('ws-chip--muted', `${t.papers} Papers`);
    chip('ws-chip--muted', `+${t.xp} XP`, xpTip);
    return row;
  }
  const last = story.last;
  if (!last) return null;
  row.appendChild(el('span', 'ws-camp__tallylabel', story.lastAgo === 1 ? 'Yesterday' : fmtDay(last.day)));
  chip('ws-chip--muted', `${last.done} Done`);
  split(last);
  if (last.seconds >= 60) chip('ws-chip--muted', fmtStudyTime(last.seconds));
  chip('ws-chip--muted', `+${last.xp} XP`, xpTip);
  return row;
}

async function campaignSection(root: HTMLElement, items: InsightItem[], attempts: InsightAttempt[], campaign: Campaign | null, due: number[], resume: QuizResume, bonusXp: number, actions: DashboardActions, tip: Tip, studyByDay: ReadonlyMap<string, number>, cash: { xp: number; cents: number }): Promise<boolean> {
  const problems = items.filter(isCampaignProblem);
  const sec = el('section', 'ws-camp');
  root.appendChild(sec);
  // A quiz left unfinished comes first, wherever it came from: resuming
  // keeps its order and lets you go back to what you rated.
  const resumeBtn = () => {
    const b = btn(`Resume ${resume!.name || 'Quiz'} (${resume!.position + 1} of ${resume!.total})`, 'ws-btn ws-btn--primary', () => actions.resumeQuiz());
    b.title = 'The open quiz you used last, where it stands. Every open quiz is listed on Home.';
    return b;
  };

  if (!campaign) {
    // No campaign: one quiet line. Setting one up is a Settings matter.
    sec.classList.add('ws-camp--idle');
    sec.appendChild(el('span', 'ws-hint', `No campaign running. ${problems.length} problems in the bank.`));
    const setup = btn('Set Up Campaign', 'ws-btn ws-btn--small', () => actions.openSettings());
    setup.title = 'Every problem in the bank in a set number of days, drawn across all papers';
    sec.appendChild(setup);
    if (resume) sec.appendChild(resumeBtn());
    return false;
  }

  const now = Date.now();
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
  const endDay = addDays(campaign.startDay, campaign.days - 1);
  const off = restDaysLabel(campaign.restDays);

  // Three columns, the same facts as before, each in its own place: today,
  // the plan, the level with the actions (Mufaro, 2026-09-21: "busy,
  // imbalanced"). The per-paper chips went: the paper bars below say it.
  const grid = el('div', 'ws-camp__grid');
  sec.appendChild(grid);
  const colToday = el('div', 'ws-camp__col ws-camp__col--today');
  const colPlan = el('div', 'ws-camp__col ws-camp__col--plan');
  const colLevel = el('div', 'ws-camp__col ws-camp__col--level');
  grid.append(colToday, colPlan, colLevel);
  const planTitle = el('div', 'ws-camp__title', p.finished ? 'Campaign Complete' : p.dayIndex > campaign.days ? `Day ${p.dayIndex}, ${p.dayIndex - campaign.days} past the plan` : `Day ${p.dayIndex} of ${campaign.days}`);
  // The plan's sentence is the tooltip; the stats under it say the rest.
  planTitle.title = p.finished
    ? `Every one of the ${p.total} problems, rated in this campaign.`
    : `${p.total} problems by ${fmtDay(endDay, true)}, ${p.target} a day across every paper${off ? `, ${off}` : ''}.`;
  colPlan.appendChild(planTitle);
  const lvl = el('div', 'ws-camp__level');
  lvl.appendChild(el('div', 'ws-camp__lvl', `Level ${p.level.level}`));
  lvl.appendChild(el('div', 'ws-camp__lvlname', p.level.title));
  const xpbar = el('div', 'ws-camp__xpbar');
  const fill = el('span');
  const span = Math.max(1, p.level.nextAt - p.level.floor);
  fill.style.width = `${Math.min(100, Math.round(((p.xp - p.level.floor) / span) * 100))}%`;
  xpbar.appendChild(fill);
  lvl.appendChild(xpbar);
  lvl.appendChild(el('div', 'ws-camp__xp', p.level.level >= LEVEL_TITLES.length ? `${p.xp} XP` : `${p.xp} XP, ${p.level.nextAt - p.xp} to Level ${p.level.level + 1}`));
  // XP as cash, at the rate set: what is left to cash out, and Cash Out.
  const rate = actions.xpCashRate?.() ?? 0;
  if (rate > 0) {
    const availXp = Math.max(0, p.xp - cash.xp);
    const cents = Math.round(availXp * rate);
    const cashRow = el('div', 'ws-camp__cash');
    const worth = el('span', 'ws-camp__xp', `$${(cents / 100).toFixed(2)} to cash out`);
    worth.title = `${availXp} XP at $${rate} per 100 XP.${cash.cents ? ` Cashed out so far: $${(cash.cents / 100).toFixed(2)} for ${cash.xp} XP.` : ''}`;
    cashRow.appendChild(worth);
    if (availXp > 0 && actions.cashOut) cashRow.appendChild(btn('Cash Out', 'ws-btn ws-btn--small', () => void actions.cashOut!(availXp, cents)));
    lvl.appendChild(cashRow);
  }
  colLevel.appendChild(lvl);

  const todayRow = colToday;
  todayRow.appendChild(el('div', 'ws-camp__label', 'Today'));
  const big = el('div', 'ws-camp__big');
  if (p.restToday && !p.finished) big.appendChild(document.createTextNode('Rest'));
  else {
    big.appendChild(document.createTextNode(String(p.doneToday)));
    big.appendChild(el('span', 'ws-camp__of', ` / ${p.target}`));
  }
  todayRow.appendChild(big);
  const text = el('div', 'ws-camp__todaytext');
  const story = dayStory(campaign, items, attempts, now, studyByDay);
  const line = p.finished ? 'Nothing left to draw. The bank is yours.'
    : p.restToday ? (due.length > 0 ? `Rest day. ${due.length} ${due.length === 1 ? 'problem is' : 'problems are'} due for a repeat.` : 'Rest day. Nothing is due for a repeat.')
    : p.leftToday === 0 ? (story.bestToday ? `Day ${p.dayIndex} done. Your best day yet.` : `Day ${p.dayIndex} done. Anything more is a lead you keep.`)
      : p.doneToday === 0 ? `${p.leftToday} problems today, drawn across ${drawPapers} ${drawPapers === 1 ? 'paper' : 'papers'}.`
        : `${p.leftToday} to go today.`;
  // The day's sentence is the big number's tooltip.
  big.title = line;
  // The campaign's numbers as four labelled stats under the plan, not a
  // lowercase run-on line.
  const stats = el('div', 'ws-camp__stats');
  const stat = (label: string, value: string) => {
    const s = el('div', 'ws-camp__stat');
    s.appendChild(el('div', 'ws-camp__statvalue', value));
    s.appendChild(el('div', 'ws-camp__statlabel', label));
    stats.appendChild(s);
  };
  stat('Done', `${p.done} of ${p.total}`);
  stat('Pace', p.delta === 0 ? 'On pace' : p.delta > 0 ? `${p.delta} ahead` : `${-p.delta} behind`);
  stat('Streak', p.streak > 0 ? `${p.streak} ${p.streak === 1 ? 'day' : 'days'}` : 'None yet');
  stat('Papers Cleared', `${p.clearedPapers.length} of ${p.papers.length}`);
  colPlan.appendChild(stats);
  const tally = storyRow(story, p);
  if (tally) text.appendChild(tally);
  todayRow.appendChild(text);
  // One primary action; the rest are quiet words in a row under it.
  const acts = el('div', 'ws-camp__actions');
  const more = el('div', 'ws-camp__more');
  const place = (b: HTMLElement) => { (b.classList.contains('ws-btn--primary') ? acts : more).appendChild(b); };
  if (resume) acts.appendChild(resumeBtn());
  const primary = resume ? 'ws-btn ws-btn--quiet' : 'ws-btn ws-btn--primary';
  // Today's quiz is the whole draw, rated problems included, opened at the
  // first one not yet rated; once the quota is met the rest stays as a lead.
  if (p.restToday && !p.finished) {
    if (due.length > 0) place(btn(`Quiz Due Problems (${due.length})`, primary, () => actions.startQuiz(due, 0, 'Due Problems')));
    if (p.remaining > 0) {
      const anyway = btn('Draw Anyway', 'ws-btn ws-btn--quiet', () => {
        const ids = drawToday(campaign, items, attempts, p.target, today);
        if (ids.length) actions.startQuiz(ids, 0, `Day ${p.dayIndex} Rest Day Draw`);
      });
      anyway.title = 'New problems on a rest day. They count toward the campaign, not toward a quota.';
      place(anyway);
    }
  } else if (drawLeft.length > 0) {
    const startAt = Math.max(0, draw.findIndex((id) => !done.has(id)));
    place(btn(p.leftToday > 0 ? `Start Today's Quiz (${drawLeft.length} left)` : `Keep Going (${drawLeft.length})`, primary, () => actions.startQuiz(draw, startAt, `Day ${p.dayIndex} Draw`)));
  } else if (!p.finished && p.remaining > 0) place(btn('Draw More For Today', primary, () => {
    const extra = drawToday(campaign, items, attempts, p.target, `${today}+`);
    if (extra.length) actions.startQuiz(extra, 0, `Day ${p.dayIndex} Extra Draw`);
  }));
  // Worked without a rating of his own: counted already, and one click from
  // the rating that scores them, so the tally's chip is never a dead end.
  const unrated = problems.filter((it) => it.worked && (it.ratingImported || !normalizeRating(it.attemptState))).map((it) => it.id);
  if (unrated.length > 0 && !p.finished) {
    const rateBtn = btn(`Rate Worked Problems (${unrated.length})`, 'ws-btn ws-btn--quiet', () => actions.startQuiz(unrated, 0, 'Worked, Not Rated'));
    rateBtn.title = 'Problems you worked without rating. They count already; a rating scores them and sets when they come back.';
    place(rateBtn);
  }
  place(btn('Review Due Flashcards', 'ws-btn ws-btn--quiet', () => actions.studyFlashcards()));
  if (more.childElementCount) acts.appendChild(more);
  colLevel.appendChild(acts);

  // One square per planned day.
  const strip = el('div', 'ws-camp__strip');
  strip.setAttribute('role', 'img');
  strip.setAttribute('aria-label', `${p.fullDays} full days of ${p.workingDays}`);
  for (const d of p.days) {
    const sq = el('span', `ws-camp__day ws-camp__day--${d.state}${d.rest && d.state !== 'rest' ? ' ws-camp__day--rest' : ''}`);
    const lines = [fmtDay(d.day, true), d.rest ? (d.done > 0 ? `Rest day, ${d.done} done` : 'Rest day') : d.state === 'future' ? `Day ${d.index}` : `${d.done} of ${d.target}`];
    sq.addEventListener('mousemove', (e) => tip.show(e.clientX, e.clientY, lines));
    sq.addEventListener('mouseleave', () => tip.hide());
    strip.appendChild(sq);
  }
  colPlan.appendChild(strip);

  return true;
}

// ── The pane ────────────────────────────────────────────────────────────────

function rewardsSection(root: HTMLElement, state: RewardState, icon: (id: string, size: number) => string, rate = 0): void {
  const title = el('div', 'ws-dash__sectiontitle', 'Rewards');
  title.title = rate > 0
    ? `Milestones of the campaign. Each one earned adds its XP to yours, and XP is worth $${rate} per 100.`
    : 'Milestones of the campaign. Each one earned adds its XP to yours, so rewards move the level.';
  root.appendChild(title);
  const row = el('div', 'ws-rewards');
  const now = Date.now();
  const sorted = [...REWARDS].sort((a, b) => Number(state.unlocks.has(b.id)) - Number(state.unlocks.has(a.id)));
  const worth = (xp: number) => (rate > 0 ? ` · $${((xp * rate) / 100).toFixed(2)}` : '');
  for (const r of sorted) {
    const at = state.unlocks.get(r.id);
    const chip = el('span', `ws-reward${at ? '' : ' ws-reward--locked'}`);
    const ic = el('span', 'ws-reward__icon');
    ic.innerHTML = icon(r.icon, 16);
    chip.appendChild(ic);
    chip.appendChild(el('span', 'ws-reward__title', r.title));
    if (at && now - at < 10 * 60000) chip.appendChild(el('span', 'ws-chip ws-chip--easy ws-reward__new', 'New'));
    chip.title = at ? `${r.hint} Earned ${fmtDay(dayKey(at), true)}: +${r.xp} XP${worth(r.xp)}.` : `${r.hint} +${r.xp} XP${worth(r.xp)}.`;
    row.appendChild(chip);
  }
  root.appendChild(row);
}

export function createDashboardPane(container: HTMLElement, actions: DashboardActions): { dispose(): void } {
  const pane = el('div', 'ws-pane ws-dash');
  container.appendChild(pane);
  const content = el('div', 'ws-dash__content');
  pane.appendChild(content);
  let disposed = false;
  let cleanups: (() => void)[] = [];
  const tip = makeTooltip(pane);

  // Renders overlap: unlocking a reward mid-render announces a data change
  // that starts another. Only the newest render may touch the DOM.
  let renderSeq = 0;
  const render = async () => {
    if (disposed) return;
    const seq = ++renderSeq;
    const [items, attempts, snapshots, campaign, studyByDay] = await Promise.all([
      listItems().catch(() => []),
      listAttemptHistory().catch(() => []),
      listProgressSnapshots().catch(() => []),
      getCampaign().catch(() => null),
      getStudySecondsByDay().catch(() => new Map<string, number>()),
    ]);
    if (disposed || seq !== renderSeq) return;
    for (const c of cleanups) c();
    cleanups = [];
    tip.hide();
    content.replaceChildren();
    const root = content;
    const ins: Insights = computeInsights(items, attempts, snapshots);

    const head = el('div', 'ws-dash__head');
    const title = el('div', 'ws-home__title', 'Dashboard');
    title.title = 'Every rating you give moves these numbers. The score counts Easy in full, Medium half, Hard nothing.';
    head.appendChild(title);
    root.appendChild(head);

    if (ins.totalProblems === 0) {
      const empty = el('div', 'ws-empty');
      empty.appendChild(el('div', 'ws-empty__headline', 'No problems in the bank yet.'));
      empty.appendChild(el('div', 'ws-empty__hint', 'Import your practice workbook and the dashboard fills in from its ratings and history.'));
      const b = btn('Import Workbook', 'ws-btn ws-btn--primary', () => actions.importWorkbook());
      b.style.marginTop = 'var(--px-space-3)';
      empty.appendChild(b);
      root.appendChild(empty);
      return;
    }

    // The campaign first: what today asks for, before the numbers.
    const quiz = await getOpenQuizSession().catch(() => null);
    // An open quiz resumes wherever it stands, its summary included.
    const resume: QuizResume = quiz ? { name: quiz.name, position: Math.min(quiz.position, quiz.itemIds.length - 1), total: quiz.itemIds.length } : null;
    const rewards = await syncRewards(items, attempts, campaign).catch(() => null);
    if (disposed || seq !== renderSeq) return;
    const cash = campaign ? await getXpCashouts(campaign.startedAt).catch(() => ({ xp: 0, cents: 0, count: 0 })) : { xp: 0, cents: 0, count: 0 };
    if (disposed || seq !== renderSeq) return;
    await campaignSection(root, items, attempts, campaign, ins.due.filter((d) => isCampaignProblem(d.item)).map((d) => d.item.id), resume, rewards?.bonusXp ?? 0, actions, tip, studyByDay, cash);
    if (disposed || seq !== renderSeq) return;
    if (disposed) return;

    // Headline numbers.
    const tiles = el('div', 'ws-dash__tiles');
    tiles.appendChild(tile('Attempted', pct(ins.attempted), `${ins.rated} of ${ins.totalProblems} problems rated`));
    tiles.appendChild(tile('Score', ins.rated > 0 ? pct(ins.score) : '–', ins.rated > 0 ? `Over ${ins.rated} rated problems` : 'Nothing rated yet'));
    // The study ledger, not the attempt clocks: time with a problem or the
    // quiz on screen while active, whatever the cells did (2026-09-21).
    let studied = 0;
    for (const s of studyByDay.values()) studied += s;
    tiles.appendChild(tile('Time Studied', fmtStudyTime(studied), 'With a problem or the quiz on screen. Idle stretches taken back.'));
    const now = Date.now();
    tiles.appendChild(tile('Rated This Week', String(ins.ratedThisWeek), 'Ratings in the last 7 days'));
    // Days to the exam, from Settings.
    const examDate = actions.examDate?.() ?? '';
    if (examDate) {
      const days = Math.round((Date.parse(`${examDate}T00:00:00`) - Date.parse(`${dayKey(now)}T00:00:00`)) / DAY_MS);
      tiles.appendChild(tile('Days To Exam', days > 0 ? String(days) : days === 0 ? 'Today' : '–', days >= 0 ? fmtDay(examDate, true) : `Was ${fmtDay(examDate, true)}`));
    } else {
      tiles.appendChild(tile('Days To Exam', '–', 'Set the exam date in Settings'));
    }
    root.appendChild(tiles);

    // Rewards: earned first, then what is still out there.
    // What next.
    root.appendChild(el('div', 'ws-dash__sectiontitle', 'Work On Next'));
    const grid = el('div', 'ws-dash__grid');
    root.appendChild(grid);
    const LIMIT = 5;

    const due = card('Due Now', 'Hard comes back after 3 days, Medium after 7', ins.due.length ? () => actions.configureQuiz({ ids: ins.due.map((d) => d.item.id), name: 'Due Problems' }) : undefined);
    if (ins.due.length === 0) due.body.appendChild(el('div', 'ws-dash__cardempty', 'Nothing is due. Rate something Hard or Medium and it returns here.'));
    for (const d of ins.due.slice(0, LIMIT)) {
      due.body.appendChild(problemRow(d.item, `${ratingLabel(d.rating)} ${daysAgoLabel(d.daysAgo)}`, d.rating, () => actions.openItem(d.item.id, d.item.title)));
    }
    if (ins.due.length > LIMIT) due.body.appendChild(el('div', 'ws-dash__more', `and ${ins.due.length - LIMIT} more`));
    grid.appendChild(due.root);

    const strug = card('Keeps Going Wrong', 'Rated Hard twice or more, still not Easy', ins.struggling.length ? () => actions.configureQuiz({ ids: ins.struggling.map((s) => s.item.id), name: 'Keeps Going Wrong' }) : undefined);
    if (ins.struggling.length === 0) strug.body.appendChild(el('div', 'ws-dash__cardempty', 'Nothing has been rated Hard twice.'));
    for (const s of ins.struggling.slice(0, LIMIT)) {
      strug.body.appendChild(problemRow(s.item, `Hard ${s.hardCount} of ${s.attempts} ${s.attempts === 1 ? 'attempt' : 'attempts'}`, 'hard', () => actions.openItem(s.item.id, s.item.title)));
    }
    if (ins.struggling.length > LIMIT) strug.body.appendChild(el('div', 'ws-dash__more', `and ${ins.struggling.length - LIMIT} more`));
    grid.appendChild(strug.root);

    const weak = card('Weakest Papers', 'Lowest score once three are rated, else least covered');
    for (const p of ins.weakestPapers.slice(0, 5)) {
      // The paper row is the way to its quiz; no button beside each one.
      const row = btn('', 'ws-dash__paperline', () => actions.configureQuiz({ papers: [p.paper] }));
      row.title = `Quiz ${paperLabel(p.paper)}`;
      const text = el('span', 'ws-dash__rowtext');
      text.appendChild(el('span', 'ws-dash__rowtitle', paperLabel(p.paper)));
      text.appendChild(el('span', 'ws-dash__rowmeta', p.rated >= 3 ? `Score ${pct(p.score)} · ${p.rated} of ${p.total} rated` : `${p.rated} of ${p.total} rated`));
      row.appendChild(text);
      weak.body.appendChild(row);
    }
    grid.appendChild(weak.root);

    const wins = card('Quick Wins', "The workbook's Easy & Likely problems never tried", ins.quickWins.length ? () => actions.configureQuiz({ ids: ins.quickWins.map((q) => q.id), name: 'Quick Wins' }) : undefined);
    const hasQuadrants = items.some((it) => it.quadrant > 0);
    if (!hasQuadrants) wins.body.appendChild(el('div', 'ws-dash__cardempty', 'The workbook did not carry quadrants for these problems.'));
    else if (ins.quickWins.length === 0) wins.body.appendChild(el('div', 'ws-dash__cardempty', `Every ${QUADRANT_LABELS[1]} problem has been tried.`));
    for (const q of ins.quickWins.slice(0, LIMIT)) {
      wins.body.appendChild(problemRow(q, 'Never Tried', 'rest', () => actions.openItem(q.id, q.title)));
    }
    if (ins.quickWins.length > LIMIT) wins.body.appendChild(el('div', 'ws-dash__more', `and ${ins.quickWins.length - LIMIT} more`));
    grid.appendChild(wins.root);

    // Starred: the student's own set, kept on the problems across quizzes.
    const starred = items.filter((it) => it.starred);
    const star = card('Starred', 'Problems you starred from their sheet, the quiz overview or the bank', starred.length ? () => actions.configureQuiz({ starred: 'starred', name: 'Starred' }) : undefined);
    if (starred.length === 0) star.body.appendChild(el('div', 'ws-dash__cardempty', 'Nothing starred. Star a problem from its sheet and it collects here.'));
    for (const s of starred.slice(0, LIMIT)) {
      const r = normalizeRating(s.attemptState);
      const open = s.attemptState === 'open';
      star.body.appendChild(problemRow(s, open ? 'In Progress' : r ? ratingLabel(r) : 'Never Tried', open ? 'open' : r || 'rest', () => actions.openItem(s.id, s.title)));
    }
    if (starred.length > LIMIT) star.body.appendChild(el('div', 'ws-dash__more', `and ${starred.length - LIMIT} more`));
    grid.appendChild(star.root);

    // Papers, weakest first.
    root.appendChild(el('div', 'ws-dash__sectiontitle', 'Progress By Paper'));
    const papers = el('div', 'ws-dash__papers');
    paperBars(papers, ins.weakestPapers, items, tip, actions);
    root.appendChild(papers);

    // Over time.
    root.appendChild(el('div', 'ws-dash__sectiontitle', 'Progress Over Time'));
    const charts = el('div', 'ws-dash__charts');
    root.appendChild(charts);
    cleanups.push(lineChart(charts, 'Attempted', ins.timeline.map((p) => ({ day: p.day, value: p.attempted, source: p.source })), 0.8, tip));
    cleanups.push(lineChart(charts, 'Score', ins.timeline.map((p) => ({ day: p.day, value: p.score, source: p.source })), 0.8, tip));
    // Per problem: study minutes over problems rated, a seven-day window
    // ending each day something was rated, so one long problem does not
    // spike it. The line that should fall as the exam nears (Mufaro,
    // 2026-09-21: "a graph with the other charts, not a box").
    const ratedByDay = new Map<string, number>();
    for (const a of attempts) {
      if (a.imported || !normalizeRating(a.selfGrade)) continue;
      const d = dayKey(a.at);
      ratedByDay.set(d, (ratedByDay.get(d) ?? 0) + 1);
    }
    const perProblem: ChartPoint[] = [];
    for (const day of [...ratedByDay.keys()].sort()) {
      let secs = 0; let rated = 0;
      const end = dayMs(day);
      for (let i = 0; i < 7; i++) {
        const d = dayKey(end - i * DAY_MS);
        secs += studyByDay.get(d) ?? 0;
        rated += ratedByDay.get(d) ?? 0;
      }
      if (rated > 0 && secs > 0) perProblem.push({ day, value: secs / rated / 60, source: 'attempts' });
    }
    const top = Math.max(10, Math.ceil(Math.max(0, ...perProblem.map((p) => p.value)) / 10) * 10);
    cleanups.push(lineChart(charts, 'Minutes Per Problem', perProblem, null, tip, { max: top, fmt: (v) => `${Math.round(v)}m` }));

    // Rewards last: milestones as a row of chips, each worth its XP and, at
    // the rate set, its cash (Mufaro, 2026-09-21: "should be at the bottom").
    if (rewards) rewardsSection(root, rewards, (id, size) => actions.renderIcon?.(id, size) ?? '', actions.xpCashRate?.() ?? 0);
  };

  void render();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const sub = onWorksheetDataChanged(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; void render(); }, 300);
  });

  return {
    dispose: () => {
      disposed = true;
      sub.dispose();
      if (timer) clearTimeout(timer);
      for (const c of cleanups) c();
      pane.remove();
    },
  };
}
