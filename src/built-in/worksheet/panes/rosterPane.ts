// rosterPane.ts — Worksheets: the roster's dashboard, in the Campaign tab.
//
// A roster (roster.ts) is a tagged set worked down day by day: each day's
// quiz is every problem still starred, in a new order, and the student
// unstars what they get right the first time. This page counts: done today,
// what is left, one square per day, the papers, and every roster quiz so far.
// Its buttons run commands (worksheet.startRoster, worksheet.openQuiz).
import { listItems, listAttemptHistory, listQuizSessions, type QuizSessionRow } from '../worksheetData.js';
import { getRoster, listStarChanges } from '../rosterData.js';
import { rosterProgress, rosterTitle, shuffled, type RosterSpec, type RosterProgress } from '../roster.js';
import { paperLabel } from '../problemImport.js';
import { BACK_TO_HOME, openPastQuiz, openWorksheet, startQuizWith } from '../actions.js';
import { createButton, createPageHeader } from '../../../ui/kit.js';
import { escapeHtml } from '../../../ui/format.js';
import { htmlFragment } from '../../../ui/answerForms.js';

export const START_ROSTER_COMMAND = 'worksheet.startRoster';
export const OPEN_QUIZ_COMMAND = 'worksheet.openQuiz';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function dateOf(day: string): Date { const [y, m, d] = day.split('-').map(Number); return new Date(y, m - 1, d); }
function fmtLong(day: string): string { const dt = dateOf(day); return `${WEEKDAYS[dt.getDay()]}, ${dt.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}`; }
function fmtShort(day: string): string { const dt = dateOf(day); return `${WEEKDAYS[dt.getDay()].slice(0, 3)} ${dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`; }

/** The quiz a roster day makes: "Final Roster · Mon Oct 19". */
export function rosterQuizName(spec: RosterSpec, day: string): string { return `${rosterTitle(spec.tag)} · ${fmtShort(day)}`; }

interface Loaded { readonly spec: RosterSpec; readonly p: RosterProgress; readonly quizzes: QuizSessionRow[] }

async function load(spec: RosterSpec): Promise<Loaded> {
  const since = Date.parse(`${spec.startDay}T00:00:00`) || 0;
  const [items, attempts, changes, sessions] = await Promise.all([
    listItems().catch(() => []), listAttemptHistory().catch(() => []), listStarChanges(since).catch(() => []), listQuizSessions(200).catch(() => []),
  ]);
  const p = rosterProgress(spec, items, attempts, changes);
  const prefix = `${rosterTitle(spec.tag)} · `;
  return { spec, p, quizzes: sessions.filter((s) => s.name.startsWith(prefix)) };
}

/** Today's roster quiz: the open one resumes; otherwise a new one over what is still starred, in a new order. */
export async function startTodaysRoster(): Promise<void> {
  const spec = await getRoster().catch(() => null);
  if (!spec) { await openWorksheet('settings', 'Worksheets Settings'); return; }
  const { p, quizzes } = await load(spec);
  const name = rosterQuizName(spec, p.today);
  const open = quizzes.find((q) => q.name === name && q.finishedAt == null);
  if (open) { await openPastQuiz(open.id); return; }
  if (p.leftIds.length) startQuizWith(shuffled(p.leftIds), 0, name);
}

function subtitle(L: Loaded): string {
  const { p, spec } = L;
  if (p.dayIndex === 0) return `Starts ${fmtLong(spec.startDay)} · ${p.total} problems`;
  if (p.dayIndex > p.length) return `Ended ${fmtLong(spec.endDay)}`;
  return `Day ${p.dayIndex} of ${p.length} · ${fmtLong(p.today)}`;
}

function pageHtml(L: Loaded): string {
  const { p } = L;
  const tile = (label: string, value: string, sub: string) =>
    `<div class="ws-dash__tile"><div class="ws-dash__tilelabel">${escapeHtml(label)}</div><div class="ws-dash__tilevalue">${escapeHtml(value)}</div><div class="ws-dash__tilesub">${escapeHtml(sub)}</div></div>`;
  const tiles = '<div class="ws-dash__tiles">'
    + tile('Done today', String(p.doneToday), `${p.unstarredToday} unstarred today`)
    + tile('Still starred', `${p.left} of ${p.total}`, p.left ? 'The next roster quizzes these.' : 'Every one unstarred.')
    + tile('Unstarred so far', String(p.total - p.left), 'Right the first time.')
    + tile('Days', p.dayIndex >= 1 && p.dayIndex <= p.length ? `${p.dayIndex} of ${p.length}` : String(p.length), `${fmtShort(L.spec.startDay)} to ${fmtShort(L.spec.endDay)}`)
    + '</div>';
  const days = p.days.map((d) => {
    const cls = d.state === 'today' ? ' ws-plan__day--today' : d.state === 'past' ? ' ws-plan__day--full' : '';
    const lines = d.state === 'future'
      ? '<div class="ws-roster__dayline">Ahead</div>'
      : `<div class="ws-roster__dayline">${d.done} done</div><div class="ws-roster__dayline">${d.unstarred} unstarred</div><div class="ws-roster__dayline">${d.left} left</div>`;
    return `<div class="ws-plan__day ws-roster__day${cls}"><div class="ws-plan__dayhead"><span class="ws-plan__daydate">${escapeHtml(fmtShort(d.day))}</span>`
      + `<span class="ws-plan__daystate">${d.state === 'today' ? 'Today' : ''}</span></div>${lines}</div>`;
  }).join('');
  const papers = p.papers.map((pp) => {
    const off = pp.total - pp.left;
    const name = paperLabel(pp.paper);
    return `<div class="ws-dash__paperrow"><span class="ws-roster__papername">${escapeHtml(name)}</span>`
      + `<div class="ws-dash__bar ws-roster__bar" role="img" aria-label="${escapeHtml(`${name}: ${pp.left} of ${pp.total} still starred`)}">`
      + (off ? `<span class="easy" style="flex-grow: ${off}"></span>` : '') + (pp.left ? `<span class="rest" style="flex-grow: ${pp.left}"></span>` : '')
      + `</div><span class="ws-dash__barlabel">${pp.left} of ${pp.total} left</span></div>`;
  }).join('');
  return `<div class="ws-roster__start"></div>${tiles}`
    + `<div class="ws-dash__sectiontitle">Day by day</div><div class="ws-plan__days">${days}</div>`
    + `<div class="ws-dash__sectiontitle">By paper</div><div class="ws-dash__papers">${papers}</div>`
    + '<div class="ws-dash__sectiontitle">Roster quizzes</div><div class="ws-roster__quizzes"></div>';
}

function quizRow(host: HTMLElement, q: QuizSessionRow): void {
  const where = q.finishedAt != null ? 'Finished' : `At ${Math.min(q.position + 1, q.itemIds.length)} of ${q.itemIds.length}`;
  host.appendChild(htmlFragment(`<div class="ws-roster__quiz"><div class="ws-dash__rowtext"><span class="ws-dash__rowtitle">${escapeHtml(q.name)}</span>`
    + `<span class="ws-dash__rowmeta">${q.itemIds.length} problems · ${escapeHtml(where)}</span></div><span class="ws-roster__quizopen"></span></div>`));
  const slot = host.lastElementChild?.querySelector<HTMLElement>('.ws-roster__quizopen');
  if (slot) createButton(slot, { id: null, label: q.finishedAt != null ? 'Review' : 'Resume', kind: 'ghost', size: 'sm', command: OPEN_QUIZ_COMMAND, args: [q.id] });
}

/**
 * Draws the roster into `root` once its numbers are in; `current` says
 * whether this render is still the latest (the Campaign tab re-renders on
 * every data change). Returns false when no roster is set.
 */
export async function renderRoster(root: HTMLElement, current: () => boolean): Promise<boolean> {
  const spec = await getRoster().catch(() => null);
  if (!spec) return false;
  const L = await load(spec);
  if (!current()) return true;
  root.replaceChildren();
  createPageHeader(root, {
    back: BACK_TO_HOME, title: rosterTitle(spec.tag), subtitle: subtitle(L),
    more: [{ label: 'Roster Settings', icon: 'settings', onSelect: () => void openWorksheet('settings', 'Worksheets Settings') }],
  });
  root.appendChild(htmlFragment(pageHtml(L)));
  const start = root.querySelector<HTMLElement>('.ws-roster__start');
  const todayName = rosterQuizName(spec, L.p.today);
  const open = L.quizzes.find((q) => q.name === todayName && q.finishedAt == null);
  if (start) {
    if (open) createButton(start, { id: 'worksheet.roster.start', label: "Resume Today's Roster", icon: 'play', kind: 'primary', command: START_ROSTER_COMMAND, title: `${open.itemIds.length} problems, at ${Math.min(open.position + 1, open.itemIds.length)}.` });
    else if (L.p.left) createButton(start, { id: 'worksheet.roster.start', label: "Start Today's Roster", icon: 'play', kind: 'primary', command: START_ROSTER_COMMAND, title: `All ${L.p.left} still starred, in a new order.` });
    else start.appendChild(htmlFragment('<span class="ws-hint">Every problem is unstarred. The roster is done.</span>'));
  }
  const list = root.querySelector<HTMLElement>('.ws-roster__quizzes');
  if (list) {
    if (!L.quizzes.length) list.appendChild(htmlFragment('<div class="ws-dash__cardempty">None yet. Each day\'s quiz stays here.</div>'));
    for (const q of L.quizzes) quizRow(list, q);
  }
  return true;
}
