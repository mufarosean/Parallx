// Worksheets: the launcher pane.

import { stateClass } from '../bankFilters.js';
import { declareControl } from '../../../ui/kit.js';
import { createButton, createPageHeader, createSectionLabel } from '../../../ui/kit.js';
import { createIconElement } from '../../../ui/iconRegistry.js';
import { listItems, onWorksheetDataChanged, getCampaign, listAttemptHistory, getOpenQuizSession, listQuizSessions, type WorksheetItemSummary } from '../worksheetData.js';
import { normalizeRating, paperLabel } from '../problemImport.js';
import { dayStrip } from './dashboardPane.js';
import { planDay } from './dayPlan.js';
import { isCampaignProblem } from '../campaign.js';
import { syncRewards } from '../rewardsSync.js';
import { computeInsights } from '../progressInsights.js';
import { gradeLabel, whenCap } from '../labels.js';
import { openBuilder, openPastQuiz, openWorksheet, showMenu, startQuizWith, studyFlashcards } from '../actions.js';
import { discussNotesInChat } from '../chatReview.js';
import { el } from '../widgets.js';

// ── Home (instanceId 'home'): the launcher ──────────────────────────────────

export function createLauncherPane(container: HTMLElement) {
  const root = el('div', 'ws-pane ws-launch');
  container.appendChild(root);
  let disposed = false;

  // Only the newest render may touch the DOM (a reward unlock announces a
  // data change mid-render and starts another).
  let renderSeq = 0;
  const render = async () => {
    if (disposed) return;
    const seq = ++renderSeq;
    const [items, campaign, attempts] = await Promise.all([
      listItems().catch(() => []),
      getCampaign().catch(() => null),
      listAttemptHistory().catch(() => []),
    ]);
    const rewards = await syncRewards(items, attempts, campaign).catch(() => null);
    const open = await getOpenQuizSession().catch(() => null);
    const quizzes = await listQuizSessions().catch(() => []);
    if (disposed || seq !== renderSeq) return;
    const problems = items.filter((it) => it.paper);
    const rated = problems.filter((it) => normalizeRating(it.attemptState)).length;
    // Noted: what he told himself to review, newest note first.
    const noted = items.filter((it) => it.note).sort((a, b) => b.noteAt - a.noteAt);
    const ins = computeInsights(items, attempts);
    const due = ins.due.filter((d) => isCampaignProblem(d.item)).map((d) => d.item.id);
    const resume = open ? { name: open.name, position: Math.min(open.position, open.itemIds.length - 1), total: open.itemIds.length } : null;
    const plan = await planDay(items, attempts, campaign, due, resume, rewards?.bonusXp ?? 0, {
      startQuiz: (ids, startAt, name) => startQuizWith(ids, startAt, name),
      resumeQuiz: () => { if (open) void openPastQuiz(open.id); },
      studyFlashcards: studyFlashcards(),
      openSettings: () => void openWorksheet('settings', 'Worksheets Settings'),
    });
    if (disposed || seq !== renderSeq) return;
    root.replaceChildren();
    // Home is where you continue and where you go (nine
    // tiles was a wall). The three places you go every day are cards with a
    // live line; the ways to add problems sit in the header's Add menu.
    const col = el('div', 'ws-home__col');
    root.appendChild(col);
    const header = createPageHeader(col, {
      title: 'Worksheets',
      subtitle: problems.length ? `${problems.length} problems · ${rated} rated${noted.length ? ` · ${noted.length} noted` : ''}` : 'The bank is empty. Import a workbook to begin.',
      secondary: [{ id: 'worksheet.home.addProblems', label: 'Add Problems', icon: 'plus', onClick: () => {} }],
      primary: problems.length ? { id: 'worksheet.newQuiz', label: 'New Quiz', onClick: () => openBuilder() } : { id: 'worksheet.importWorkbook', label: 'Import Workbook…', onClick: () => void openWorksheet('excel-import', 'Import Workbook') },
      more: [
        ...(noted.length ? [{ label: `Discuss Notes in Chat (${noted.length})`, icon: 'message-square', onSelect: () => void discussNotesInChat(items) }] : []),
        { label: 'Worksheets Settings', icon: 'settings', onSelect: () => void openWorksheet('settings', 'Worksheets Settings') },
      ],
    });
    // Add Problems opens its menu under itself.
    const add = header.querySelector<HTMLButtonElement>('.px-page-header__actions .px-btn--secondary');
    if (add) {
      add.appendChild(createIconElement('chevron-down', 12));
      add.setAttribute('aria-haspopup', 'menu');
      add.addEventListener('click', () => showMenu(add, [
        { label: 'Import Workbook…', icon: 'folder-input', onSelect: () => void openWorksheet('excel-import', 'Import Workbook') },
        { label: 'Generate Items…', icon: 'sparkles', onSelect: () => void openWorksheet('create', 'Generate Items') },
        { separator: true },
        { label: 'Open Scratch Sheet', icon: 'table-2', onSelect: () => void openWorksheet('scratch', 'Scratch Sheet') },
      ]));
    }

    const dest = el('div', 'ws-home__dest');
    const card = (label: string, line: string, icon: string, go: () => void) => {
      const b = el('button', 'ws-home__destcard') as HTMLButtonElement;
      b.type = 'button';
      const ic = el('span', 'ws-home__desticon');
      ic.appendChild(createIconElement(icon, 20));
      const text = el('span', 'ws-home__desttext');
      text.append(el('span', 'ws-home__desttitle', label), el('span', 'ws-home__destline', line));
      b.append(ic, text);
      declareControl(b, { id: `worksheet.home.${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`, label, hint: line });
      b.addEventListener('click', go);
      dest.appendChild(b);
    };
    const openCount = quizzes.filter((q) => !q.finishedAt).length;
    card('Study Dashboard', ins.rated > 0 ? `${Math.round(ins.attempted * 100)}% attempted · ${Math.round(ins.score * 100)}% score` : 'Progress, pace, what to work on next', 'gauge', () => void openWorksheet('dashboard', 'Study Dashboard'));
    card('Problem Bank', problems.length ? `${problems.length} problems in ${new Set(problems.map((it) => it.paper)).size} papers` : 'Empty until you import a workbook', 'library', () => void openWorksheet('bank', 'Problem Bank'));
    card('Quizzes', quizzes.length ? `${openCount} open · ${quizzes.length - openCount} completed` : 'None yet', 'list-checks', () => void openWorksheet('quizzes', 'Quizzes'));
    card('Campaign', 'The study plan, day by day', 'calendar-check', () => void openWorksheet('plan', 'Campaign'));
    col.appendChild(dest);

    // Today: the campaign's line, its days, and the day's one action.
    const today = el('div', 'ws-home__today');
    const text = el('div', 'ws-home__todaytext');
    text.appendChild(el('div', 'ws-home__todaytitle', plan.title));
    text.appendChild(el('div', 'ws-home__todayline', plan.line));
    if (plan.progress) text.appendChild(dayStrip(plan.progress));
    today.appendChild(text);
    const acts = el('div', 'ws-home__todayacts');
    const first = plan.actions.secondary.find((a) => !a.label.startsWith('Review Due Flashcards'));
    if (first) createButton(acts, { id: first.id, label: first.label, title: first.title, onClick: () => first.onClick() });
    if (plan.actions.primary) {
      const a = plan.actions.primary;
      createButton(acts, { id: a.id, label: a.label, icon: a.icon, title: a.title, kind: 'primary', onClick: () => a.onClick() });
    }
    if (acts.childElementCount) today.appendChild(acts);
    col.appendChild(today);

    // What you touched last, and what you told yourself to review: two short
    // lists, each row opens the problem.
    const lists = el('div', 'ws-launch__lists');
    const listOf = (title: string, rows: WorksheetItemSummary[], meta: (it: WorksheetItemSummary) => string) => {
      if (rows.length === 0) return;
      const box = el('div', 'ws-launch__list');
      createSectionLabel(box, title);
      const list = el('div', 'ws-list');
      for (const it of rows) {
        const row = el('button', 'ws-list__row') as HTMLButtonElement;
        row.type = 'button';
        row.appendChild(el('span', `ws-bank__dot ${stateClass(it.attemptState) || 'rest'}`));
        const t = el('span', 'ws-list__text');
        t.appendChild(el('span', 'ws-list__title', it.title));
        t.appendChild(el('span', 'ws-list__meta', meta(it)));
        row.appendChild(t);
        row.title = `Open ${it.title}`;
        row.addEventListener('click', () => void openWorksheet(`item:${it.id}`, it.title));
        list.appendChild(row);
      }
      box.appendChild(list);
      lists.appendChild(box);
    };
    const recent = items.filter((it) => it.lastAttemptAt > 0).sort((a, b) => b.lastAttemptAt - a.lastAttemptAt).slice(0, 5);
    listOf('Recent', recent, (it) => [it.paper ? paperLabel(it.paper) : it.sourceLabel, it.attemptState === 'open' ? 'In progress' : gradeLabel(it.attemptState), whenCap(it.lastAttemptAt)].filter(Boolean).join(' · '));
    listOf('Noted', noted.slice(0, 5), (it) => it.note);
    col.appendChild(lists);
  };

  void render();
  const sub = onWorksheetDataChanged(() => void render());
  return { dispose: () => { disposed = true; sub.dispose(); root.remove(); } };
}
