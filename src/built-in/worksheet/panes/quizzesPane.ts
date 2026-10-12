// Worksheets: the Quizzes pane, past and running quizzes.

import { createButton, createEmptyState, createIconButton, createPageHeader, createSectionLabel } from '../../../ui/kit.js';
import { listItems, onWorksheetDataChanged, getSessionGrades, renameQuizSession, reopenQuizSession, deleteQuizSession, listQuizSessions } from '../worksheetData.js';
import { normalizeRating } from '../problemImport.js';
import { appDateTimeString } from '../../../services/localTime.js';
import { when } from '../labels.js';
import { BACK_TO_HOME, openBuilder, openPastQuiz, showMenu, startQuizWith } from '../actions.js';
import { practiceListeners, state } from '../state.js';
import { el } from '../widgets.js';

// ── Quizzes ───────────────────────────────────────────────────────────────
// Every quiz, open ones first, with its lifecycle beside it: the one place
// to see every quiz and act on it.
// Complete Quiz stays on a quiz's summary, where the ratings are in view;
// here a quiz is opened, renamed, copied, reopened or deleted.
export function createQuizzesPane(container: HTMLElement) {
  const root = el('div', 'ws-pane ws-home');
  container.appendChild(root);
  let disposed = false;
  let renderSeq = 0;
  createPageHeader(root, {
    back: BACK_TO_HOME,
    title: 'Quizzes',
    subtitle: 'A quiz stays open until you complete it from its summary.',
    primary: { label: 'New Quiz', icon: 'plus', title: 'The quiz builder: papers, sources, kinds, a rating band, a length, a name.', onClick: () => openBuilder() },
  });
  const listHost = el('div', 'ws-quizzes');
  root.appendChild(listHost);

  const render = async () => {
    const seq = ++renderSeq;
    const [sessions, bank] = await Promise.all([listQuizSessions(500).catch(() => []), listItems().catch(() => [])]);
    if (disposed || seq !== renderSeq) return;
    listHost.replaceChildren();
    if (sessions.length === 0) {
      createEmptyState(listHost, {
        icon: 'list-checks',
        headline: 'No quizzes yet.',
        // New Quiz is the header's primary action; a second one here made
        // two primaries for the same thing (one per view).
        hint: 'New Quiz builds one from the problems you choose. Starred and due problems can also start one from Home.',
      });
      return;
    }
    const bankById = new Map(bank.map((i) => [i.id, i]));
    const groups: { label: string; host: HTMLElement }[] = [];
    const groupFor = (label: string) => {
      let g = groups.find((x) => x.label === label);
      if (!g) {
        createSectionLabel(listHost, label);
        g = { label, host: el('div', 'ws-list') };
        listHost.appendChild(g.host);
        groups.push(g);
      }
      return g.host;
    };
    for (const q of sessions) {
      const grades = await getSessionGrades(q.itemIds, q.startedAt, q.id, q.finishedAt ?? null).catch(() => new Map<number, string>());
      if (disposed || seq !== renderSeq) return;
      const counts = { easy: 0, medium: 0, hard: 0 };
      let unrated = 0;
      for (const id of q.itemIds) {
        const r = normalizeRating(grades.get(id) ?? bankById.get(id)?.attemptState ?? '');
        if (r === 'easy' || r === 'medium' || r === 'hard') counts[r]++; else unrated++;
      }
      const started = appDateTimeString(q.startedAt, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      const n = q.itemIds.length;
      const row = el('div', 'ws-list__row ws-quizrow');
      row.appendChild(el('span', `ws-bank__dot ${q.finishedAt ? 'rest' : 'open'}`));
      const info = el('button', 'ws-list__text ws-quizrow__info') as HTMLButtonElement;
      info.type = 'button';
      const nameEl = el('span', 'ws-list__title', q.name || started);
      info.appendChild(nameEl);
      // The date only when the name does not already say it (an auto-named quiz is its date).
      const showStarted = !(q.name || '').includes(started);
      const tally = [`${n} ${n === 1 ? 'problem' : 'problems'}`, `${counts.easy} easy`, counts.medium ? `${counts.medium} medium` : '', `${counts.hard} hard`, unrated ? `${unrated} not rated` : ''].filter(Boolean);
      const dated = q.finishedAt ? `completed ${when(q.finishedAt)}` : showStarted ? `started ${started}` : '';
      info.appendChild(el('span', 'ws-list__meta', [...tally, dated].filter(Boolean).join(' · ')));
      info.title = q.finishedAt ? 'Open this completed quiz to review it.' : 'Resume this quiz where it stands.';
      info.addEventListener('click', () => void openPastQuiz(q.id));
      row.appendChild(info);
      const end = el('div', 'ws-list__end');
      if (!q.finishedAt) {
        const at = Math.min(q.position, n);
        const prog = el('div', 'ws-quizrow__progress');
        const bar = el('div', 'ws-bar');
        const fill = el('span', 'ws-bar__fill');
        fill.style.width = `${Math.round((at / Math.max(1, n)) * 100)}%`;
        bar.appendChild(fill);
        prog.append(bar, el('span', 'ws-list__meta', q.position >= n ? 'At the summary' : `${q.position + 1} of ${n}`));
        end.appendChild(prog);
      }
      createButton(end, {
        label: q.finishedAt ? 'Review' : 'Resume',
        icon: q.finishedAt ? undefined : 'play',
        kind: q.finishedAt ? 'secondary' : 'primary',
        size: 'sm',
        title: q.finishedAt ? 'Open this completed quiz to review the work and the ratings.' : 'Continue this quiz where it stands.',
        onClick: () => void openPastQuiz(q.id),
      });
      const rename = () => {
        const input = el('input', 'ws-input') as HTMLInputElement;
        input.type = 'text';
        input.maxLength = 80;
        input.value = q.name;
        input.placeholder = 'Quiz name';
        input.setAttribute('aria-label', 'Quiz name');
        let done = false;
        const commit = () => {
          if (done) return;
          done = true;
          const v = input.value.trim();
          if (v && v !== q.name) void renameQuizSession(q.id, v).catch(() => {});
          else input.replaceWith(nameEl);
        };
        input.addEventListener('click', (e) => e.stopPropagation());
        input.addEventListener('keydown', (e) => {
          e.stopPropagation();
          if (e.key === 'Enter') input.blur();
          if (e.key === 'Escape') { input.value = q.name; input.blur(); }
        });
        input.addEventListener('blur', commit);
        nameEl.replaceWith(input);
        input.focus();
        input.select();
      };
      const remove = async () => {
        const ok = await state.api?.window?.showConfirmModal?.({
          message: `Delete the quiz "${q.name || started}"?`,
          detail: 'The quiz and its position are removed. Ratings and work on the problems are kept. This cannot be undone.',
          confirmLabel: 'Delete Quiz',
          danger: true,
        }) ?? false;
        if (!ok || disposed) return;
        await deleteQuizSession(q.id).catch(() => {});
        if (state.practice?.id === q.id) {
          state.practice = null;
          for (const fn of practiceListeners) { try { fn(); } catch { /* pane torn down */ } }
        }
      };
      const more = createIconButton(end, { icon: 'ellipsis', title: `More actions for ${q.name || started}`, size: 'sm' });
      more.addEventListener('click', () => showMenu(more, [
        { label: 'Rename…', icon: 'pencil', onSelect: rename },
        { label: 'Copy as New Quiz', icon: 'copy', tooltip: 'A new open quiz over the same problems in the same order. Ratings start fresh for the copy.', onSelect: () => startQuizWith(q.itemIds, 0, `${q.name || 'Quiz'} Copy`) },
        ...(q.finishedAt ? [{ label: 'Reopen', icon: 'rotate-ccw', tooltip: 'Makes this completed quiz open again, at its last problem.', onSelect: () => void reopenQuizSession(q.id).catch(() => {}) }] : []),
        { separator: true },
        { label: 'Delete Quiz…', icon: 'trash-2', danger: true, onSelect: () => void remove() },
      ]));
      row.appendChild(end);
      groupFor(q.finishedAt ? 'Completed' : 'Open').appendChild(row);
    }
  };
  const sub = onWorksheetDataChanged(() => void render());
  void render();
  return { dispose: () => { disposed = true; sub.dispose(); root.remove(); } };
}
