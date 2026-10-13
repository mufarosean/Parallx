// Worksheets: the running quiz, one problem at a time.

import { stateClass } from '../bankFilters.js';
import { createButton, createEmptyState, createIconButton, createPageHeader } from '../../../ui/kit.js';
import { createIconElement } from '../../../ui/iconRegistry.js';
import { listItems, onWorksheetDataChanged, getSessionGrades, finishQuizSession, renameQuizSession, reopenQuizSession, getSessionItemStates, getProblemNotes, setProblemNote, addStudySeconds, getPlanBlockBySession } from '../worksheetData.js';
import { normalizeRating, paperLabel } from '../problemImport.js';
import { examClockFor } from './planPane.js';
import { dayKey } from '../progressInsights.js';
import { itemTags, nextMarkedIndex } from '../practiceSession.js';
import { createStudyTicker } from '../studyClock.js';
import { appDateTimeString } from '../../../services/localTime.js';
import { fmtStudy, gradeLabel, when } from '../labels.js';
import { openBuilder, openWorksheet, startQuizWith } from '../actions.js';
import { createSheetPane } from './sheetPane.js';
import { markListeners, practiceListeners, getIdleMinutes, paneOnScreen, persistPractice, restorePractice, state, type RunningPractice } from '../state.js';
import { el, iconBtn, markBtn, paintIconBtn, starBtn } from '../widgets.js';

export function createPracticeRunPane(container: HTMLElement, input?: { setName?(name: string): void }) {
  const root = el('div', 'ws-pane');
  /** The tab carries the running quiz's name. */
  const nameTab = (name: string) => { try { input?.setName?.(name || 'Quiz'); } catch { /* not a tool input */ } };
  container.appendChild(root);
  let disposed = false;
  let player: { dispose(): void } | null = null;
  let changeSub: { dispose(): void } | null = null;
  /** The study clock for the quiz's own screens (overview, summary); a problem on screen has its own. */
  let quizTicker: { dispose(): void } | null = null;
  /** Bumped by every change of what the player shows; a sheet still being staged for an older step is thrown away. */
  let serveSeq = 0;
  let markCleanup: (() => void) | null = null;
  /** An exam block's clock, when this quiz is one: counted down in the bar. */
  let clockTimer: ReturnType<typeof setInterval> | null = null;
  const clockEl = el('span', 'ws-sessionbar__clock');
  clockEl.hidden = true;
  const stopClock = () => { if (clockTimer) clearInterval(clockTimer); clockTimer = null; clockEl.hidden = true; };
  const bar = el('div', 'ws-sessionbar');
  const playerHost = el('div', 'ws-session__player');
  root.append(bar, playerHost);
  const gradeLabelFor = (g: string | undefined) => (g ? gradeLabel(g) : '');

  // No quiz: the tab came back with nothing to resume, or a quiz ended.
  const renderIdle = () => {
    serveSeq++;
    stopClock();
    bar.style.display = 'none';
    bar.replaceChildren();
    playerHost.replaceChildren();
    nameTab('Quiz');
    createEmptyState(playerHost, {
      icon: 'list-checks',
      headline: 'No quiz is running.',
      hint: 'Build one, or start one from the Study Dashboard or Quizzes.',
      action: { label: 'New Quiz', onClick: () => openBuilder() },
    });
  };

  const run = (session: RunningPractice) => {
    bar.style.display = '';
    nameTab(session.name);
    markCleanup?.();
    let view: 'sheet' | 'overview' = 'sheet';
    // Reviewing the overview or the summary is study too: it counts under
    // item 0 of this quiz, only while no problem sheet is on screen.
    quizTicker?.dispose();
    // The exam clock: an exam block's minutes from the quiz's start, in the bar.
    stopClock();
    let timeCalled = false;
    void examClockFor(session.id, getPlanBlockBySession).then((clock) => {
      if (disposed || !clock) return;
      const paint = () => {
        if (disposed) { stopClock(); return; }
        const left = session.startedAt + clock.minutes * 60_000 - Date.now();
        clockEl.hidden = false;
        clockEl.classList.toggle('ws-sessionbar__clock--over', left <= 0);
        const s = Math.max(0, Math.floor(left / 1000));
        clockEl.textContent = left > 0 ? `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : 'Time';
        clockEl.title = `${clock.title}: ${clock.minutes} minutes from ${appDateTimeString(session.startedAt)}.`;
        if (left <= 0 && !timeCalled) { timeCalled = true; void state.api?.window?.showInformationMessage?.(`Time. ${clock.title} is over: finish the line you are on, then complete the quiz from its summary.`); }
      };
      paint();
      clockTimer = setInterval(paint, 1000);
    });
    quizTicker = createStudyTicker({
      visible: () => !disposed && paneOnScreen(root) && (view === 'overview' || session.index >= session.ids.length),
      idleMs: getIdleMinutes() * 60_000,
      credit: (secs, final) => { void addStudySeconds(dayKey(Date.now()), 0, session.id, secs, final).catch(() => {}); },
    });

    // The quiz's lifecycle, one action each (one button
    // used to start, finish and replace). Complete Quiz is the only way a
    // quiz finishes; Reopen Quiz undoes it; Copy Quiz is a new open quiz over
    // the same problems; Rename changes what Home lists it under.
    const completeQuiz = async () => {
      if (session.finishedAt) return;
      // A quiz never closes quietly one short. Anything neither worked nor
      // rated is counted out loud first (a day ended 16
      // of 17 with every problem in it gone over).
      const states = await getSessionItemStates(session.ids, session.startedAt).catch(() => new Map());
      const byId = new Map((await listItems().catch(() => [])).map((s) => [s.id, s]));
      const undone = session.ids.filter((id) => {
        const st = states.get(id);
        if (st?.worked || normalizeRating(st?.grade ?? '')) return false;
        const it = byId.get(id);
        return !(it?.worked || (!it?.ratingImported && normalizeRating(it?.attemptState ?? '')));
      });
      // Marks are the student's own "come back to this"; completing over
      // them is asked about in those words.
      const marked = session.ids.filter((id) => session.marked.has(id));
      if (undone.length > 0 || marked.length > 0) {
        const n = undone.length > 0 ? undone.length : marked.length;
        const noun = n === 1 ? 'problem' : 'problems';
        const marksLeft = marked.length > 0 ? ` ${marked.length} ${marked.length === 1 ? 'is' : 'are'} still marked for later.` : '';
        const ok = await state.api?.window?.showConfirmModal?.({
          message: undone.length > 0 ? `Complete this quiz with ${n} ${noun} not done?` : `Complete this quiz with ${n} ${noun} still marked for later?`,
          detail: undone.length > 0
            ? `Nothing was worked or rated on them, so they count for nothing today and stay in the bank for another day. Back To Quiz takes you to them.${marksLeft}`
            : 'You marked them to come back to. Next Marked on the summary takes you to them; a completed quiz keeps its marks.',
          confirmLabel: 'Complete Anyway',
        }) ?? true;
        if (!ok || disposed) return;
      }
      await finishQuizSession(session.id).catch(() => {});
      session.finishedAt = Date.now();
      state.api?.activity?.note('finished', `the quiz "${session.name}"`);
      if (disposed) return;
      session.index = session.ids.length;
      view = 'sheet';
      serve();
    };
    const reopenQuiz = async () => {
      if (!session.finishedAt) return;
      await reopenQuizSession(session.id).catch(() => {});
      session.finishedAt = null;
      state.practice = session;
      if (disposed) return;
      session.index = Math.max(0, Math.min(session.index, session.ids.length - 1));
      view = 'sheet';
      serve();
    };
    const copyQuiz = () => startQuizWith(session.ids, 0, `${session.name || 'Quiz'} Copy`);
    const renameQuiz = async (name: string) => {
      const v = name.trim();
      if (!v || v === session.name) return;
      session.name = v;
      nameTab(v);
      await renameQuizSession(session.id, v).catch(() => {});
    };

    const renderSummary = async () => {
      serveSeq++;
      player?.dispose();
      player = null;
      bar.style.display = 'none';
      bar.replaceChildren();
      playerHost.replaceChildren();
      // The summary finishes nothing. Complete Quiz is the one way a quiz
      // ends; until then it stays open and resumable, however many problems
      // are rated.
      if (disposed) return;
      const wrap = el('div', 'ws-home ws-summary');
      const [grades, bank, states] = await Promise.all([
        getSessionGrades(session.ids, session.startedAt, session.id, session.finishedAt ?? null),
        listItems().catch(() => []),
        getSessionItemStates(session.ids, session.startedAt, session.id).catch(() => new Map<number, { grade: string; attempted: boolean; worked: boolean; seconds: number }>()),
      ]);
      if (disposed) return;
      const byId = new Map(bank.map((i) => [i.id, i]));
      // What this quiz rated, then what the problem already carried.
      const resolved = new Map<number, { grade: string; own: boolean }>();
      for (const id of session.ids) {
        const own = grades.get(id);
        if (own) { resolved.set(id, { grade: own, own: true }); continue; }
        const prev = byId.get(id)?.attemptState ?? '';
        if (normalizeRating(prev)) resolved.set(id, { grade: prev, own: false });
      }
      const counts = { nailed: 0, partial: 0, missed: 0, ungraded: 0 };
      let seconds = 0;
      const list = el('div', 'ws-list');
      session.ids.forEach((id, i) => {
        const item = byId.get(id);
        const hit = resolved.get(id);
        const grade = hit?.grade;
        const r = grade ? normalizeRating(grade) : '';
        if (r === 'easy') counts.nailed++;
        else if (r === 'medium') counts.partial++;
        else if (r === 'hard') counts.missed++;
        else counts.ungraded++;
        const row = el('button', 'ws-list__row') as HTMLButtonElement;
        row.type = 'button';
        row.appendChild(el('span', 'ws-list__idx', String(i + 1)));
        row.appendChild(el('span', 'ws-list__title ws-list__grow', item?.title ?? `Item ${id}`));
        // Own rating, then an earlier one of his, then work without one, then
        // what the workbook carried: the summary never dresses a workbook
        // rating up as his.
        let pill: HTMLElement;
        if (grade && hit!.own) pill = el('span', `ws-chip ws-chip--${stateClass(grade)}`, gradeLabelFor(grade));
        else if (grade && !item?.ratingImported) pill = el('span', `ws-chip ws-chip--${stateClass(grade)}`, `${gradeLabelFor(grade)} earlier`);
        else if (item?.worked) pill = el('span', 'ws-chip ws-chip--open', 'Worked, not rated');
        else if (grade) pill = el('span', `ws-chip ws-chip--${stateClass(grade)}`, `${gradeLabelFor(grade)} in workbook`);
        else pill = el('span', 'ws-chip ws-chip--muted', session.skipped.has(id) ? 'Skipped' : 'Not rated');
        row.appendChild(pill);
        // The flag keeps its own column beside the time, so flags line up.
        const flagSlot = el('span', 'ws-list__flag');
        if (session.marked.has(id)) {
          flagSlot.appendChild(createIconElement('flag', 14));
          flagSlot.setAttribute('role', 'img');
          flagSlot.setAttribute('aria-label', 'Marked for later');
        }
        row.appendChild(flagSlot);
        const secs = states.get(id)?.seconds ?? 0;
        seconds += secs;
        row.appendChild(el('span', 'ws-list__time', secs ? fmtStudy(secs) : '–'));
        row.title = `Open ${item?.title ?? 'this problem'}`;
        row.addEventListener('click', () => { state.practice = session; view = 'sheet'; goTo(i); });
        list.appendChild(row);
      });
      const tagRoll = new Map<string, { n: number; nailed: number }>();
      for (const id of session.ids) {
        const item = byId.get(id);
        if (!item) continue;
        for (const t of itemTags(item.tags)) {
          const entry = tagRoll.get(t) ?? { n: 0, nailed: 0 };
          entry.n++;
          if (normalizeRating(resolved.get(id)?.grade) === 'easy') entry.nailed++;
          tagRoll.set(t, entry);
        }
      }

      const n = session.ids.length;
      createPageHeader(wrap, {
        back: { id: 'worksheet.quizzes', label: 'Quizzes', onClick: () => void openWorksheet('quizzes', 'Quizzes') },
        title: session.name || 'Quiz',
        subtitle: [`Quiz summary · ${n} ${n === 1 ? 'problem' : 'problems'}`, seconds ? fmtStudy(seconds) : '', session.finishedAt ? `completed ${when(session.finishedAt)}` : 'open'].filter(Boolean).join(' · '),
        secondary: session.finishedAt ? [] : [{ id: 'worksheet.quiz.backToQuiz', label: 'Back to Quiz', title: 'Continues where the quiz was. It stays open.', onClick: () => { state.practice = session; goTo(session.ids.length - 1); } }],
        primary: session.finishedAt
          ? { label: 'Reopen Quiz', title: 'Makes this completed quiz open again, at its last problem.', onClick: () => void reopenQuiz() }
          : { label: 'Complete Quiz…', icon: 'check', title: 'Marks this quiz completed. Ratings stay on the problems; Reopen Quiz undoes it.', onClick: () => void completeQuiz() },
        more: [
          ...(!session.finishedAt && session.marked.size > 0 ? [{ label: `Next Marked (${session.marked.size})`, icon: 'skip-forward', onSelect: () => { state.practice = session; goToMarked(-1); } }] : []),
          { label: 'Quiz Overview', icon: 'list', onSelect: () => { state.practice = session; session.index = Math.min(session.index, session.ids.length - 1); view = 'overview'; serve(); } },
          { label: 'Copy as New Quiz', icon: 'copy', tooltip: 'A new open quiz over the same problems in the same order. Ratings start fresh for the copy.', onSelect: copyQuiz },
        ],
      });

      // The quiz at a glance: one bar, then the counts it is made of.
      const glance = el('div', 'ws-summary__glance');
      const bar2 = el('div', 'ws-ratingbar');
      bar2.setAttribute('role', 'img');
      bar2.setAttribute('aria-label', `${counts.nailed} easy, ${counts.partial} medium, ${counts.missed} hard, ${counts.ungraded} not rated`);
      for (const [cls, v] of [['easy', counts.nailed], ['medium', counts.partial], ['hard', counts.missed]] as const) {
        if (!v) continue;
        const seg = el('span', `ws-ratingbar__seg ws-ratingbar__seg--${cls}`);
        seg.style.width = `${(v / Math.max(1, n)) * 100}%`;
        bar2.appendChild(seg);
      }
      glance.appendChild(bar2);
      const legend = (cls: string, text: string) => {
        const k = el('span', 'ws-summary__key');
        k.append(el('span', `ws-bank__dot ${cls}`), document.createTextNode(text));
        glance.appendChild(k);
      };
      legend('easy', `${counts.nailed} easy`);
      legend('medium', `${counts.partial} medium`);
      legend('hard', `${counts.missed} hard`);
      legend('rest', `${counts.ungraded} not rated`);
      if (session.marked.size) {
        const k = el('span', 'ws-summary__key ws-summary__key--marked');
        k.append(createIconElement('flag', 12), document.createTextNode(`${session.marked.size} marked`));
        glance.appendChild(k);
      }
      // The per-tag rollup rides as the tooltip: twenty hashtags in a row was noise on screen.
      if (tagRoll.size > 0) glance.title = `By tag (easy / seen): ${[...tagRoll.entries()].map(([t, e]) => `#${t} ${e.nailed}/${e.n}`).join(' · ')}`;
      wrap.appendChild(glance);
      wrap.appendChild(list);
      playerHost.appendChild(wrap);
    };

    const gradeNote = el('span', 'ws-sessionbar__grade');
    /** What this quiz knows about the item on screen: its rating and whether it was worked. */
    let currentState: { grade: string; attempted: boolean } | undefined;
    const refreshGradeNote = async () => {
      if (disposed || session.index >= session.ids.length) return;
      const id = session.ids[session.index];
      const [grades, states] = await Promise.all([
        getSessionGrades([id], session.startedAt, session.id, session.finishedAt ?? null),
        getSessionItemStates([id], session.startedAt, session.id).catch(() => new Map<number, { grade: string; attempted: boolean; worked: boolean; seconds: number }>()),
      ]);
      if (disposed || id !== session.ids[session.index]) return;
      const g = grades.get(id);
      const st = states.get(id);
      currentState = { grade: g ?? st?.grade ?? '', attempted: !!st?.attempted };
      gradeNote.textContent = g ? `Rated ${gradeLabelFor(g)}` : '';
      // Work on a problem cancels an earlier skip: a rated or attempted item
      // never reads as one left undone.
      if ((currentState.grade || currentState.attempted) && session.skipped.delete(id)) void persistPractice();
    };
    changeSub?.dispose();
    changeSub = onWorksheetDataChanged(() => { void refreshGradeNote(); void paintDots(); });

    // Every move is stored, so a restart lands on the same item.
    const goTo = (index: number) => {
      session.index = Math.max(0, Math.min(session.ids.length, index));
      void persistPractice();
      view = 'sheet';
      serve();
    };
    /** Next Marked: the marked problem after `from`, round the quiz; -1 starts at the first. */
    const goToMarked = (from: number) => {
      const i = nextMarkedIndex(session.ids, session.marked, from);
      if (i >= 0) goTo(i);
    };

    // The overview: every problem in the quiz with what happened to it, a
    // note per problem, and a click to jump. Skipping problem 1 no longer
    // means clicking through the rest to get back to it.
    const renderOverview = async () => {
      player?.dispose();
      player = null;
      playerHost.replaceChildren();
      const wrap = el('div', 'ws-quiz__overview');
      playerHost.appendChild(wrap);
      const [states, notes, bank] = await Promise.all([
        getSessionItemStates(session.ids, session.startedAt, session.id).catch(() => new Map<number, { grade: string; attempted: boolean; worked: boolean; seconds: number }>()),
        getProblemNotes(session.ids).catch(() => new Map<number, string>()),
        listItems().catch(() => []),
      ]);
      if (disposed || view !== 'overview') return;
      const byId = new Map(bank.map((i) => [i.id, i]));
      const counts = { rated: 0, attempted: 0, skipped: 0, untouched: 0, marked: 0 };
      const countsLine = el('span', 'ws-hint');
      const paintCounts = () => {
        countsLine.textContent = [`${counts.rated} rated`, `${counts.attempted} worked`, `${counts.skipped} skipped`, `${counts.untouched} not started`, counts.marked ? `${counts.marked} marked for later` : ''].filter(Boolean).join(' · ');
      };
      const rows: HTMLElement[] = [];
      let paintCountsHook = paintCounts;
      session.ids.forEach((id, i) => {
        const item = byId.get(id);
        const st = states.get(id);
        const sessionGrade = st?.grade ? normalizeRating(st.grade) : '';
        // Rated before this quiz began: the rating still shows, marked as earlier.
        const earlierGrade = !sessionGrade && item ? normalizeRating(item.attemptState) : '';
        const gradeText = sessionGrade ? st!.grade : (item?.attemptState ?? '');
        if ((sessionGrade || st?.attempted) && session.skipped.delete(id)) void persistPractice();
        const skipped = session.skipped.has(id);
        if (session.marked.has(id)) counts.marked++;
        // Work outranks an old rating here: working a problem is what counts
        // it for the day, and a rating that came in with the workbook is said
        // in those words so it is never mistaken for one given here.
        const earlierText = item?.ratingImported ? `${gradeLabel(item.attemptState)} in workbook` : `${gradeLabel(item?.attemptState ?? '')} earlier`;
        const status = sessionGrade ? gradeLabel(st!.grade) : st?.worked ? 'Worked, not rated' : earlierGrade ? earlierText : st?.attempted ? 'Opened' : skipped ? 'Skipped' : 'Not started';
        if (sessionGrade) counts.rated++; else if (st?.worked) counts.attempted++; else if (skipped) counts.skipped++; else counts.untouched++;
        const row = el('div', `ws-quiz__row${i === session.index ? ' ws-quiz__row--current' : ''}`);
        row.setAttribute('role', 'button');
        row.tabIndex = 0;
        row.appendChild(el('span', 'ws-quiz__num', String(i + 1)));
        const text = el('div', 'ws-quiz__rowtext');
        text.appendChild(el('div', 'ws-quiz__rowtitle', item?.title ?? `Item ${id}`));
        text.appendChild(el('div', 'ws-quiz__rowmeta', item?.paper ? paperLabel(item.paper) : (item?.sourceLabel ?? '')));
        const note = notes.get(id) ?? '';
        const preview = el('div', 'ws-quiz__notepreview', note);
        if (!note) preview.style.display = 'none';
        text.appendChild(preview);
        row.appendChild(text);
        const chipCls = sessionGrade ? `ws-chip--${stateClass(gradeText)}` : st?.worked ? 'ws-chip--open' : earlierGrade ? `ws-chip--${stateClass(gradeText)}` : 'ws-chip--muted';
        row.appendChild(el('span', `ws-chip ${chipCls}`, status));
        row.appendChild(el('span', 'ws-quiz__time', st?.seconds ? fmtStudy(st.seconds) : ''));
        const noteBtn = iconBtn('notebook-pen', note ? 'Edit Note' : 'Add Note', { hint: 'A note on this problem, kept with it across quizzes.' });
        row.appendChild(noteBtn);
        const editor = el('div', 'ws-quiz__note');
        editor.style.display = 'none';
        const ta = el('textarea', 'ws-quiz__notetext') as HTMLTextAreaElement;
        ta.value = note;
        ta.placeholder = 'What to remember about this problem.';
        ta.addEventListener('click', (e) => e.stopPropagation());
        ta.addEventListener('keydown', (e) => e.stopPropagation());
        ta.addEventListener('blur', () => {
          const v = ta.value.trim();
          void setProblemNote(id, v).catch(() => {});
          preview.textContent = v;
          preview.style.display = v ? '' : 'none';
          paintIconBtn(noteBtn, 'notebook-pen', v ? 'Edit Note' : 'Add Note', 'A note on this problem, kept with it across quizzes.');
        });
        editor.appendChild(ta);
        noteBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const open = editor.style.display === 'none';
          editor.style.display = open ? '' : 'none';
          if (open) ta.focus();
        });
        row.appendChild(markBtn(session, id, (on) => { counts.marked += on ? 1 : -1; paintCountsHook(); }));
        row.appendChild(starBtn(id, item?.starred ?? false));
        row.appendChild(editor);
        row.addEventListener('click', () => goTo(i));
        row.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === row) goTo(i); });
        rows.push(row);
      });
      // The kit header: the quiz's name (renamed from ⋯), the counts, the way
      // back to the problem and on to the summary.
      paintCounts();
      const back = Math.min(session.index, session.ids.length - 1);
      const header = createPageHeader(wrap, {
        title: session.name || 'Quiz',
        subtitle: countsLine.textContent ?? '',
        secondary: [{ id: 'worksheet.quiz.backToProblem', label: `Back to Problem ${back + 1}`, title: 'The problem you were on.', onClick: () => { view = 'sheet'; goTo(back); } }],
        primary: session.finishedAt
          ? { id: 'worksheet.quiz.reopen', label: 'Reopen Quiz', title: 'Makes this completed quiz open again.', onClick: () => void reopenQuiz() }
          : { id: 'worksheet.quiz.summary', label: 'Quiz Summary', title: 'The ratings so far, and Complete Quiz when you are done.', onClick: () => goTo(session.ids.length) },
        more: [
          { label: 'Rename…', icon: 'pencil', onSelect: () => {
            const nameEl = header.querySelector('.px-page-header__title') as HTMLElement | null;
            if (!nameEl) return;
            const input = el('input', 'ws-input ws-input--title') as HTMLInputElement;
            input.type = 'text';
            input.maxLength = 80;
            input.value = session.name;
            input.placeholder = 'Quiz name';
            input.setAttribute('aria-label', 'Quiz name');
            const commit = () => { void renameQuiz(input.value).then(() => { nameEl.textContent = session.name || 'Quiz'; input.replaceWith(nameEl); }); };
            input.addEventListener('keydown', (e) => {
              e.stopPropagation();
              if (e.key === 'Enter') input.blur();
              if (e.key === 'Escape') { input.value = session.name; input.blur(); }
            });
            input.addEventListener('blur', commit);
            nameEl.replaceWith(input);
            input.focus();
            input.select();
          } },
          { label: 'Copy as New Quiz', icon: 'copy', tooltip: 'A new open quiz over the same problems in the same order.', onSelect: copyQuiz },
        ],
      });
      // The counts follow a mark set from a row.
      const subEl = header.querySelector('.px-page-header__subtitle');
      const repaint = paintCounts;
      paintCountsHook = () => { repaint(); if (subEl) subEl.textContent = countsLine.textContent; };
      const list = el('div', 'ws-list ws-quiz__list');
      for (const r of rows) list.appendChild(r);
      wrap.appendChild(list);
    };

    // One dot per problem: rated in its colour, worked in the accent, the
    // rest quiet; the current one ringed. A click goes there.
    const dots = el('div', 'ws-sessionbar__dots');
    dots.setAttribute('role', 'group');
    dots.setAttribute('aria-label', 'Problems in this quiz');
    let dotsSeq = 0;
    const paintDots = async () => {
      const seq = ++dotsSeq;
      const [states, bank] = await Promise.all([
        getSessionItemStates(session.ids, session.startedAt, session.id).catch(() => new Map<number, { grade: string; attempted: boolean; worked: boolean; seconds: number }>()),
        listItems().catch(() => []),
      ]);
      if (disposed || seq !== dotsSeq) return;
      const byId = new Map(bank.map((i) => [i.id, i]));
      dots.replaceChildren();
      session.ids.forEach((id, i) => {
        const st = states.get(id);
        const item = byId.get(id);
        const own = st?.grade ? normalizeRating(st.grade) : '';
        const earlier = !own && item && !item.ratingImported ? normalizeRating(item.attemptState) : '';
        const cls = own || earlier || (st?.worked ? 'open' : 'rest');
        const words = own ? gradeLabel(st!.grade) : earlier ? `${gradeLabel(item!.attemptState)} earlier` : st?.worked ? 'worked' : session.skipped.has(id) ? 'skipped' : 'not started';
        const d = el('button', `ws-sessionbar__dot ws-bank__dot ${cls}${i === session.index && view === 'sheet' ? ' ws-sessionbar__dot--current' : ''}`) as HTMLButtonElement;
        d.type = 'button';
        const label = `Problem ${i + 1}, ${words}${session.marked.has(id) ? ', marked' : ''}`;
        d.setAttribute('aria-label', label);
        d.title = `${item?.title ?? `Problem ${i + 1}`}: ${words}${session.marked.has(id) ? ', marked for later' : ''}`;
        if (i === session.index) d.setAttribute('aria-current', 'step');
        d.addEventListener('click', () => goTo(i));
        dots.appendChild(d);
      });
    };

    const paintBar = () => {
      bar.replaceChildren();
      const prev = createIconButton(bar, { id: 'worksheet.run.previous', icon: 'chevron-left', title: 'Previous Problem', size: 'sm', onClick: () => goTo(session.index - 1) });
      prev.disabled = session.index === 0;
      const pos = el('span', 'ws-sessionbar__pos');
      pos.append(el('span', 'ws-sessionbar__name', session.name || 'Quiz'), el('span', 'ws-sessionbar__count', ` · ${session.index + 1} of ${session.ids.length}`));
      bar.appendChild(pos);
      bar.appendChild(clockEl);
      // The last Next opens the summary, where Complete Quiz is a separate
      // decision; nothing here finishes the quiz.
      const last = session.index === session.ids.length - 1;
      createIconButton(bar, { id: 'worksheet.run.next', icon: last ? 'check' : 'chevron-right', title: last ? 'Quiz Summary' : 'Next Problem', size: 'sm', onClick: () => goTo(session.index + 1) });
      bar.appendChild(dots);
      void paintDots();
      if (session.finishedAt) {
        const chip = el('span', 'ws-chip ws-chip--muted', 'Reviewing');
        chip.title = 'A completed quiz, reopened. Ratings you give still count on the problems; Reopen Quiz on the summary makes it open again.';
        bar.appendChild(chip);
      }
      gradeNote.textContent = '';
      bar.appendChild(gradeNote);
      const spacer = el('div'); spacer.style.flex = '1';
      bar.appendChild(spacer);
      const overviewBtn = createButton(bar, {
        id: 'worksheet.quiz.overview', label: 'Overview', icon: 'list', kind: 'ghost', size: 'sm',
        title: view === 'overview' ? 'Back to the problem' : 'Every problem in this quiz, with status, rating, time and notes',
        onClick: () => { view = view === 'overview' ? 'sheet' : 'overview'; serve(); },
      });
      overviewBtn.setAttribute('aria-pressed', String(view === 'overview'));
      // Next Marked carries its count, shown only while there is one.
      const nextMarkedBtn = createButton(bar, { id: 'worksheet.quiz.nextMarked', label: 'Next Marked', icon: 'skip-forward', kind: 'ghost', size: 'sm', title: 'Goes to the next problem you marked for later, round the quiz.', onClick: () => goToMarked(session.index) });
      const paintNextMarked = () => {
        const n = session.marked.size;
        const lbl = nextMarkedBtn.querySelector('.px-btn__label');
        if (lbl) lbl.textContent = `Next Marked (${n})`;
        nextMarkedBtn.style.display = n ? '' : 'none';
      };
      paintNextMarked();
      markRepaint = () => { paintNextMarked(); void paintDots(); };
      // Skipping an item already rated or worked moves on without marking anything.
      createIconButton(bar, {
        id: 'worksheet.run.skip', icon: 'chevron-last', title: 'Skip Problem', size: 'sm',
        onClick: () => {
          if (!(currentState?.grade || currentState?.attempted)) session.skipped.add(session.ids[session.index]);
          goTo(session.index + 1);
        },
      });
    };
    /** Marks set from the problem's header repaint the bar. */
    let markRepaint = () => {};
    const onMark = () => markRepaint();
    markListeners.add(onMark);
    markCleanup = () => markListeners.delete(onMark);

    const serve = () => {
      if (disposed) return;
      const seq = ++serveSeq;
      if (session.index >= session.ids.length) { void renderSummary(); return; }
      bar.style.display = '';
      paintBar();
      if (view === 'overview') {
        player?.dispose();
        player = null;
        playerHost.replaceChildren();
        void renderOverview();
        return;
      }
      // The next sheet is built behind the one on screen and swapped in once
      // its engine has painted. Tearing the old one down first showed the
      // empty pane, the loading line and the first paint one after another
      // on every Next and Previous (the flash).
      const stage = el('div', 'ws-session__stage ws-session__stage--staging');
      playerHost.appendChild(stage);
      const next = createSheetPane(stage, `item:${session.ids[session.index]}`);
      void next.ready.then(() => requestAnimationFrame(() => requestAnimationFrame(() => {
        if (disposed || seq !== serveSeq) { next.dispose(); stage.remove(); return; }
        player?.dispose();
        player = null;
        for (const old of [...playerHost.children]) if (old !== stage) old.remove();
        stage.classList.remove('ws-session__stage--staging');
        player = next;
      })));
      void refreshGradeNote();
    };
    serve();
  };

  // The quiz in memory, or the stored one after a restart or a tool reload.
  const init = async () => {
    player?.dispose();
    player = null;
    const session = await restorePractice();
    if (disposed) return;
    if (session) run(session); else renderIdle();
  };
  const onPractice = () => void init();
  practiceListeners.add(onPractice);
  void init();

  return {
    dispose: () => {
      disposed = true;
      practiceListeners.delete(onPractice);
      markCleanup?.();
      changeSub?.dispose();
      quizTicker?.dispose();
      quizTicker = null;
      player?.dispose();
      root.remove();
    },
  };
}
