// Worksheets: one problem on a sheet, the Univer engine under it.

import type { IWorkbookData } from '@univerjs/core';
import type { IWorksheetHost, SheetViewState } from '../univerHost.js';
import { renderMarkdown } from '../../../ui/renderMarkdown.js';
import { declareControl } from '../../../ui/kit.js';
import { createButton, createIconButton, createSegmented } from '../../../ui/kit.js';
import { listItems, getItem, getOpenAttempt, getLatestWork, saveAttemptCells, discardOpenAttempt, completeAttempt, markAttemptWorked, saveAttemptReview, onWorksheetDataChanged, getProblemNotes, setProblemNote, getStarred, addStudySeconds, getStudySecondsForItem, type WorksheetItem, getItemSheetAt } from '../worksheetData.js';
import { normalizeRating, ratingLabel, paperLabel, SOURCE_LABELS, KIND_LABELS, QUADRANT_LABELS } from '../problemImport.js';
import { indexPristine, solutionSegments as pureSolutionSegments, applySolutionVisibility as pureApplySolutionVisibility, type PristineIndex } from '../solutionVisibility.js';
import { dayKey } from '../progressInsights.js';
import { workbookHasOnSheetQuestion } from '../itemFormat.js';
import { reviewAttempt } from '../worksheetAi.js';
import { createStudyTicker } from '../studyClock.js';
import { fmtSeconds } from '../labels.js';
import { openWorksheet, showMenu } from '../actions.js';
import { reviewInChat } from '../chatReview.js';
import { AUTOSAVE_MS, appearanceListeners, decimalsListeners, scratchCache, workingCache, appIsDark, getDisplayDecimals, getIdleMinutes, getSheetAppearance, loadUniverModule, paneOnScreen, parseWorkbook, quizSessionIdFor, resolveSheetDark, setSheetAppearance, state, type SheetAppearance } from '../state.js';
import { el, iconBtn, makeSheetThemeButton, markBtn, paintSheetThemeButton, starBtn } from '../widgets.js';

// ── Sheet panes (scratch + item player) ─────────────────────────────────────

export function createSheetPane(container: HTMLElement, instanceId: string, opts: { revealed?: boolean } = {}) {
  const itemId = instanceId.startsWith('item:') ? Number(instanceId.slice(5)) : null;

  const root = el('div', 'ws-pane');
  // flex: 0 0 auto or the sheet (flex:1) CRUSHES the header — the question
  // text vanished entirely in the e2e screenshot (resize-thrash lesson:
  // pin non-growing flex children).
  const headerHost = el('div', 'ws-pane__headerhost');
  const sheetHost = el('div', 'ws-pane__sheet');
  const loading = el('div', 'ws-pane__loading', 'Loading the practice sheet engine…');
  root.append(headerHost, loading, sheetHost);
  container.appendChild(root);

  let host: IWorksheetHost | null = null;
  /** Where the user was when the tab was switched away; applied once the engine has painted. */
  let pendingView: SheetViewState | null = null;
  const applyPendingView = (): void => {
    if (!pendingView || !host || disposed) return;
    host.restoreViewState(pendingView);
    pendingView = null;
  };
  let disposed = false;
  let item: WorksheetItem | null = null;
  let itemStarred = false;
  /** Resolves once the first sheet has painted (or the pane gave up), so the quiz can swap it in whole. */
  let readyResolve: () => void = () => {};
  const ready = new Promise<void>((resolve) => { readyResolve = resolve; });
  /** 'working' = user's attempt on screen; 'solution' = model solution. */
  let mode: 'working' | 'solution' = 'working';
  let revealed = !!opts.revealed;
  /** Set by the problem tab: re-reads the solution's visibility from the live sheet. */
  let syncRevealFromSheet: (() => void) | null = null;
  let visibilitySub: { dispose(): void } | null = null;
  /** Set by a Problem Bank item: the first cell edit is the proof it was worked. */
  let onSheetEdited: (() => void) | null = null;
  /** Something changed since the last snapshot; the autosave tick skips a clean sheet. */
  let dirty = false;
  let editedSub: { dispose(): void } | null = null;
  let changedSub: { dispose(): void } | null = null;
  let autosaveTimer: ReturnType<typeof setInterval> | null = null;
  let lastSavedCells = '';
  /** Problem Bank items: time on the open attempt (-1 = not a problem item). */
  /** Study seconds on this problem, every sitting (the header clock); -1 before a problem is loaded. */
  let problemSeconds = -1;
  let studyTicker: { dispose(): void } | null = null;
  let sheetSub: { dispose(): void } | null = null;

  const captureWorking = (): IWorkbookData | null => {
    if (mode !== 'working') return null;
    return host?.getSnapshot() ?? null;
  };

  // The timer passes nothing and saves only after an edit; every other
  // caller (leaving the problem, rating it, closing) saves regardless.
  const persistWorking = async (force = true): Promise<void> => {
    if (!force && !dirty) return;
    dirty = false;
    if (itemId == null) {
      const snap = captureWorking();
      if (snap) scratchCache.set(instanceId, snap);
      return;
    }
    const snap = captureWorking();
    if (!snap) return;
    workingCache.set(instanceId, snap);
    const json = JSON.stringify(snap);
    if (json === lastSavedCells) return;
    lastSavedCells = json;
    await saveAttemptCells(itemId, json, problemSeconds >= 0 ? problemSeconds : undefined).catch((err) => {
      console.error('[Worksheet] attempt autosave failed:', err);
    });
  };

  // The engine keeps normalising a freshly mounted sheet for a moment (rich
  // text cells gain document margins and render config), so a snapshot taken
  // right after mount differs from one taken a second later with no edit at
  // all. The autosave baseline is the snapshot once it has stopped moving;
  // otherwise merely opening a problem wrote an "attempt".
  const settledSnapshotJson = async (): Promise<string> => {
    let prev = JSON.stringify(host?.getSnapshot() ?? null);
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 300));
      if (disposed) return prev;
      const next = JSON.stringify(host?.getSnapshot() ?? null);
      if (next === prev) return next;
      prev = next;
    }
    return prev;
  };

  const mountSheet = async (snapshot: IWorkbookData | null): Promise<void> => {
    const mod = await loadUniverModule();
    if (disposed) return;
    loading.remove();
    host?.dispose();
    sheetHost.replaceChildren();
    host = mod.createWorksheetHost({
      container: sheetHost, snapshot, darkMode: resolveSheetDark(), displayDecimals: getDisplayDecimals(),
      // Evidence for the intermittent formula failures: the journal keeps it.
      onFormulaError: (summary, detail) => { try { state.api?.activity?.note('formula error', `${item?.title ?? instanceId}: ${summary}`, detail); } catch { /* no journal */ } },
      onEngineFault: (summary, detail) => { try { state.api?.activity?.note('engine fault', `${item?.title ?? instanceId}: ${summary}`, detail); } catch { /* no journal */ } },
    });
    // Probe hook (tests/probes): the live host, reachable from the DOM.
    (sheetHost as unknown as { __wsHost?: unknown }).__wsHost = host;
    void host.whenRendered().then(() => { readyResolve(); applyPendingView(); });
    // Unhiding the solution columns by hand is the same act as Reveal
    // Solution: the button follows the sheet, whichever way the columns moved.
    visibilitySub?.dispose();
    visibilitySub = host.onColumnsVisibilityChanged(() => syncRevealFromSheet?.());
    editedSub?.dispose();
    editedSub = host.onEdited(() => onSheetEdited?.());
    changedSub?.dispose();
    changedSub = host.onChanged(() => { dirty = true; });
  };

  // Sheet appearance: re-skin the live engine when the setting changes
  // (toggle on any pane) or, in 'app' mode, when the workbench theme flips.
  let scratchThemeBtn: HTMLButtonElement | null = null;
  const applyAppearance = (appearance: SheetAppearance) => {
    host?.setDarkMode(resolveSheetDark(appearance));
    if (item) renderItemHeader();
    else if (scratchThemeBtn) paintSheetThemeButton(scratchThemeBtn);
  };
  appearanceListeners.add(applyAppearance);
  const applyDecimals = (decimals: number | null) => host?.setDisplayDecimals(decimals);
  decimalsListeners.add(applyDecimals);
  const modeObserver = new MutationObserver(() => {
    if (getSheetAppearance() === 'app') host?.setDarkMode(appIsDark());
  });
  modeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-px-mode'] });

  const renderItemHeader = () => {
    if (!item) return;
    headerHost.replaceChildren();
    const header = el('div', 'ws-item__header');
    const titleRow = el('div', 'ws-item__titlerow');
    titleRow.appendChild(el('div', 'ws-item__title', item.title));
    const spacer = el('div'); spacer.style.flex = '1';
    titleRow.appendChild(spacer);

    titleRow.appendChild(starBtn(item.id, itemStarred, (on) => { itemStarred = on; }, { id: 'worksheet.sheet.star' }));
    titleRow.appendChild(makeSheetThemeButton());

    if (mode === 'working') {
      titleRow.appendChild(iconBtn('file-spreadsheet', 'Export to Excel', {
        id: 'worksheet.sheet.export',
        hint: 'Saves this sheet as a real .xlsx, values and formulas, in your Downloads folder.',
        onClick: () => {
          const name = (item?.title || 'practice-sheet').replace(/[^\w\- ]+/g, '').trim() || 'practice-sheet';
          if (!host?.exportToXlsx(name)) {
            void state.api?.window?.showInformationMessage?.('Nothing on the sheet to export yet.');
          }
        },
      }));

      const resetBtn = iconBtn('rotate-ccw', 'Reset Sheet', { id: 'worksheet.sheet.reset', danger: true, hint: 'Restores the item to its original state. Cannot be undone.' });
      resetBtn.addEventListener('click', () => {
        void (async () => {
          const ok = await state.api?.window?.showConfirmModal?.({
            message: 'Reset this sheet?',
            detail: 'Your work on this item is discarded and the sheet returns to its original state. This cannot be undone.',
            confirmLabel: 'Reset Sheet',
            danger: true,
          }) ?? false;
          if (!ok || disposed || !item) return;
          lastSavedCells = '';
          await discardOpenAttempt(item.id);
          await mountSheet(parseWorkbook(item.givensJson));
        })();
      });
      titleRow.appendChild(resetBtn);

      titleRow.appendChild(iconBtn('eye', 'Reveal Solution', { id: 'worksheet.sheet.reveal', primary: true, hint: 'Shows the worked solution.', onClick: () => void revealSolution() }));
    } else {
      titleRow.appendChild(iconBtn('eye-off', 'Show My Work', { id: 'worksheet.sheet.showWork', hint: 'Back to your own sheet.', onClick: () => void showWorking() }));
    }
    header.appendChild(titleRow);

    // New-style items carry the question ON the sheet (merged block per
    // part tab, directly on the page);
    // legacy items still need it here or it would vanish.
    if (item.questionMd && !workbookHasOnSheetQuestion(item.givensJson)) {
      const q = el('div', 'ws-item__question');
      q.appendChild(renderMarkdown(item.questionMd));
      header.appendChild(q);
    }

    if (mode === 'solution') {
      const sol = el('div', 'ws-item__solutionbar');
      sol.appendChild(el('span', 'ws-item__solutiontag', 'Model Solution'));
      if (!revealed) {
        // First reveal this session: ask for the self grade.
        const gradeWrap = el('span', 'ws-item__grades');
        gradeWrap.appendChild(el('span', 'ws-item__gradeprompt', 'How did it go?'));
        for (const [grade, label] of [['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard']] as const) {
          const b = createButton(null, { id: `worksheet.sheet.grade.${grade}`, label, size: 'sm' });
          b.classList.add('ws-grade', `ws-grade--${grade}`);
          b.addEventListener('click', () => {
            void (async () => {
              if (!item) return;
              revealed = true;
              await completeAttempt(item.id, grade, lastSavedCells);
              state.api?.activity?.note('practiced', `worksheet item "${item.title}"`, `self-graded ${label.toLowerCase()}`);
              renderItemHeader();
            })();
          });
          gradeWrap.appendChild(b);
        }
        sol.appendChild(gradeWrap);
      } else {
        const again = createButton(null, { id: 'worksheet.sheet.tryAgain', label: 'Try Again', title: 'Start a fresh attempt from the original sheet.' });
        again.addEventListener('click', () => {
          void (async () => {
            if (!item) return;
            revealed = false;
            mode = 'working';
            lastSavedCells = '';
            await discardOpenAttempt(item.id);
            renderItemHeader();
            await mountSheet(parseWorkbook(item.givensJson));
          })();
        });
        sol.appendChild(again);
      }
      header.appendChild(sol);

      if (item.solutionNotesMd) {
        const notes = el('div', 'ws-item__solutionnotes');
        notes.appendChild(renderMarkdown(item.solutionNotesMd));
        header.appendChild(notes);
      }

      // AI critique of the work vs the model solution. Feedback,
      // never a score: CAS grades method, and false precision misleads.
      const reviewWrap = el('div', 'ws-item__review');
      const reviewBtn = createButton(null, { id: 'worksheet.sheet.reviewInChat', label: 'Review in Chat', title: 'Stages your cells, the model solution and a review brief in the chat. Add your question under the brief, then send.' });
      const reviewOut = el('div', 'ws-item__reviewout');
      reviewOut.style.display = 'none';
      reviewBtn.addEventListener('click', () => {
        void (async () => {
          if (!item || !state.api?.lm) return;
          if (!lastSavedCells.trim()) {
            reviewOut.style.display = '';
            reviewOut.textContent = 'There is no work on the sheet to review yet.';
            return;
          }
          reviewBtn.disabled = true;
          try {
            if (await reviewInChat(item, item.id, lastSavedCells) === 'chat') { reviewOut.style.display = 'none'; return; }
            // No chat surface: the one-shot review, in place.
            reviewBtn.textContent = 'Reviewing…';
            reviewOut.style.display = '';
            reviewOut.textContent = 'Reading your work…';
            const review = await reviewAttempt(state.api.lm, item, lastSavedCells, (partial) => {
              reviewOut.textContent = partial;
            });
            reviewOut.replaceChildren(renderMarkdown(review));
            await saveAttemptReview(item.id, review);
            state.api?.activity?.note('reviewed', `worksheet attempt on "${item.title}"`, 'AI method feedback saved');
          } catch (err) {
            reviewOut.style.display = '';
            reviewOut.textContent = `Review failed: ${(err as Error).message}`;
          } finally {
            reviewBtn.disabled = false;
            reviewBtn.textContent = 'Review in Chat';
          }
        })();
      });
      reviewWrap.append(reviewBtn, reviewOut);
      header.appendChild(reviewWrap);
    }

    headerHost.appendChild(header);
  };

  const revealSolution = async (): Promise<void> => {
    if (!item || mode === 'solution') return;
    await persistWorking();
    mode = 'solution';
    renderItemHeader();
    await mountSheet(parseWorkbook(item.solutionJson));
  };

  const showWorking = async (): Promise<void> => {
    if (!item || mode === 'working') return;
    mode = 'working';
    renderItemHeader();
    const open = await getOpenAttempt(item.id);
    const prior = open ? null : await getLatestWork(item.id);
    const snap = workingCache.get(instanceId) ?? ((open ?? prior) ? parseWorkbook((open ?? prior)!.cellsJson) : null);
    await mountSheet(snap ?? parseWorkbook(item.givensJson));
  };

  // ── Problem Bank item: one sheet, the solution hidden until revealed ──
  // The sheet is the workbook's sheet. Columns from the solution marker on
  // are hidden; Reveal unhides them beside the work, Hide puts them away;
  // neither touches the student's cells. Rating is Easy, Medium or Hard,
  // any time; time on the attempt runs while the tab is on screen.
  type SheetShape = { columnCount?: number; columnData?: Record<number, { hd?: number; w?: number }>; cellData?: Record<number, Record<number, Record<string, unknown>>>; mergeData?: { startColumn: number; endColumn: number }[] };
  const firstSheet = (snap: IWorkbookData): SheetShape | null => (snap.sheets[snap.sheetOrder[0]] as unknown as SheetShape) ?? null;
  /** The pristine sheet: where its CONTENT ends (the solution ends there and
   *  the student works after it; a styled empty cell does not count, the
   *  banner rows run to BL) and which cells are its own, so the student's
   *  columns are known and never hidden (solutionVisibility.ts). */
  let pristine: PristineIndex = { content: new Set(), lastContentCol: -1 };
  let ratingCell: { row: number; col: number } | null = null;
  const readPristine = (problem: WorksheetItem): void => {
    const snap = parseWorkbook(problem.sheetJson) as IWorkbookData | null;
    const sheet = snap ? firstSheet(snap) : null;
    if (!sheet) return;
    pristine = indexPristine(sheet, problem.solutionCol);
    for (const [r, row] of Object.entries(sheet.cellData ?? {})) {
      if (Number(r) > 2) continue;
      for (const [c, cell] of Object.entries(row)) {
        // The workbook's own rating cell: "Self-Rating:" with the value beside it.
        if (typeof cell.v === 'string' && /^self-rating/i.test(cell.v.trim())) ratingCell = { row: Number(r), col: Number(c) + 1 };
      }
    }
  };
  /** The solution's columns to hide, as runs; the student's own columns are left out. */
  const solutionSegments = (snap: IWorkbookData): { start: number; last: number }[] => {
    if (!item || item.solutionCol < 0) return [];
    const sheet = firstSheet(snap);
    return sheet ? pureSolutionSegments(sheet, item.solutionCol, pristine) : [];
  };
  /** Rebuild visibility from the marker on: only the solution hides, never the
   *  student's columns, whatever an earlier snapshot had flagged. */
  const applySolutionVisibility = (snap: IWorkbookData, show: boolean): IWorkbookData => {
    if (!item || (item.solutionCol < 0 && item.solutionRow < 0)) return snap;
    const sheet = firstSheet(snap);
    if (sheet && item.solutionCol >= 0) pureApplySolutionVisibility(sheet, item.solutionCol, pristine, show);
    // A solution below the question hides by rows, from its "SOLUTION" row to the last row with content.
    if (sheet && item.solutionRow >= 0) {
      const rows = ((sheet as unknown as { rowData?: Record<number, { hd?: number }> }).rowData ??= {});
      const last = Math.max(item.solutionRow, ...Object.keys(sheet.cellData ?? {}).map(Number));
      for (let r = item.solutionRow; r <= last; r++) {
        if (!show) (rows[r] ??= {}).hd = 1;
        else if (rows[r]?.hd) delete rows[r].hd;
      }
    }
    return snap;
  };
  /** Show the current rating in the workbook's own rating cell. */
  const applyRatingCell = (snap: IWorkbookData, rating: string): IWorkbookData => {
    if (!ratingCell) return snap;
    const sheet = firstSheet(snap);
    if (!sheet) return snap;
    const row = ((sheet.cellData ??= {})[ratingCell.row] ??= {});
    const cell = (row[ratingCell.col] ??= {});
    cell.v = ratingLabel(rating) || 'Unrated';
    cell.t = 1;
    delete cell.p;
    return snap;
  };
  // `open` is the attempt in progress; `prior` is the last rated attempt's
  // sheet when nothing is in progress. Rating never takes the work away: the
  // sheet comes back as he left it, and the next edit starts a fresh attempt
  // (its own timer) from that sheet.
  const initProblem = async (problem: WorksheetItem, open: Awaited<ReturnType<typeof getOpenAttempt>>, prior: Awaited<ReturnType<typeof getLatestWork>> = null): Promise<void> => {
    problemSeconds = await getStudySecondsForItem(problem.id).catch(() => 0);
    readPristine(problem);
    let latestRating = '';
    /** The rating shown came in with the workbook, not from work done here. */
    let ratingImported = false;
    /** A cell on this sheet has been changed: the campaign counts it done. */
    let worked = false;
    /** The rating landing in its cell is a write on the sheet, not work. */
    let ratingWrite = false;
    let starred = false;
    const refreshRating = async () => {
      const summary = (await listItems().catch(() => [])).find((s) => s.id === problem.id);
      latestRating = summary ? normalizeRating(summary.attemptState) : '';
      ratingImported = summary?.ratingImported ?? false;
      worked = summary?.worked ?? false;
      starred = summary?.starred ?? false;
    };
    await refreshRating();
    const timerEl = el('span', 'ws-problem__timer', fmtSeconds(problemSeconds));
    timerEl.title = 'Study time on this problem, every sitting. Counts while it is on screen and you are active; idle stretches are taken back.';
    // The note on this problem, taken where the work is (
    // it lived only on the quiz overview, a screen away). One button on the
    // header opens the editor under it; saved on blur, kept across quizzes.
    let problemNote = (await getProblemNotes([problem.id]).catch(() => new Map<number, string>())).get(problem.id) ?? '';
    const noteHost = el('div', 'ws-item__note');
    noteHost.style.display = 'none';
    const noteArea = el('textarea', 'ws-quiz__notetext') as HTMLTextAreaElement;
    declareControl(noteArea, { id: 'worksheet.sheet.note', label: 'Note', kind: 'input', state: () => ({ kind: 'value', value: noteArea.value }) });
    noteArea.placeholder = 'What to remember about this problem.';
    noteArea.value = problemNote;
    noteArea.setAttribute('aria-label', 'Note on this problem');
    noteArea.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') noteArea.blur(); });
    noteArea.addEventListener('blur', () => {
      const v = noteArea.value.trim();
      if (v === problemNote) return;
      problemNote = v;
      void setProblemNote(problem.id, v).catch(() => {});
      paintHeader();
    });
    noteHost.appendChild(noteArea);
    const header = el('div', 'ws-item__header');
    const titleRow = el('div', 'ws-item__titlerow');
    const paintHeader = () => {
      titleRow.replaceChildren();
      titleRow.appendChild(el('div', 'ws-item__title', problem.title));
      const meta = el('div', 'ws-problem__meta');
      const bits = [paperLabel(problem.paper), SOURCE_LABELS[problem.source] ?? '', KIND_LABELS[problem.kind] ?? '', problem.quadrant ? QUADRANT_LABELS[problem.quadrant] : ''].filter(Boolean);
      if (bits.length) meta.appendChild(el('span', undefined, bits.join(' · ')));
      titleRow.appendChild(meta);
      const spacer = el('div'); spacer.style.flex = '1';
      titleRow.appendChild(spacer);
      titleRow.appendChild(timerEl);
      // A rating carried in from the workbook is not a rating given here: it
      // never lights a button, because a lit button reads as "done" and the
      // work then goes uncounted. It is said in words
      // instead, beside a plain statement of whether the problem was worked.
      const ownRating = ratingImported ? '' : latestRating;
      // A lit button is the one sign of a rating given here; the chip speaks
      // only when the buttons cannot say it, in the accent, never a grade colour.
      const status = ownRating ? null
        : worked ? { text: 'Worked, not rated', cls: 'ws-chip--open', hint: ratingImported ? `Counts as done for the day. Your workbook rated this ${ratingLabel(latestRating)}; rate it here to score it and set when it comes back.` : 'Counts as done for the day. A rating scores it and sets when it comes back.' }
          : ratingImported ? { text: `${ratingLabel(latestRating)} in your workbook`, cls: 'ws-chip--muted', hint: 'Carried in with the import. It counts for the campaign once you work it here or rate it again.' }
            : null;
      if (status) {
        const chip = el('span', `ws-chip ${status.cls} ws-problem__status`, status.text);
        chip.title = status.hint;
        titleRow.appendChild(chip);
      }
      titleRow.appendChild(el('span', 'ws-vdiv'));
      // The rating is one choice of three: the switch. A click on the lit
      // one rates again (a later sitting), so the click is caught before the
      // switch decides it is no change.
      const rateWith = (grade: 'easy' | 'medium' | 'hard') => {
        void (async () => {
          await persistWorking();
          await completeAttempt(problem.id, grade, lastSavedCells, { seconds: problemSeconds, sessionId: quizSessionIdFor(problem.id) });
          state.api?.activity?.note('practiced', `problem "${problem.title}"`, `rated ${ratingLabel(grade)}`);
          latestRating = grade;
          ratingImported = false;
          if (ratingCell) {
            ratingWrite = true;
            host?.setCellText(ratingCell.row, ratingCell.col, ratingLabel(grade));
            setTimeout(() => { ratingWrite = false; }, 100);
          }
          paintHeader();
        })();
      };
      const rate = createSegmented(titleRow, {
        id: 'worksheet.sheet.rating',
        ariaLabel: 'Rate this problem',
        items: (['easy', 'medium', 'hard'] as const).map((g) => ({ value: g, label: ratingLabel(g) })),
        value: ownRating || '',
        onChange: (v) => rateWith(v as 'easy' | 'medium' | 'hard'),
      });
      rate.element.classList.add('ws-rate');
      rate.element.title = 'Your rating feeds the dashboard and the quiz filters.';
      rate.element.addEventListener('click', (e) => {
        const seg = (e.target as HTMLElement).closest<HTMLElement>('[data-value]');
        if (seg?.classList.contains('ui-segmented-control__segment--active') && seg.dataset.value === ownRating) rateWith(ownRating as 'easy' | 'medium' | 'hard');
      }, true);
      titleRow.appendChild(el('span', 'ws-vdiv'));
      titleRow.appendChild(starBtn(problem.id, starred, (on) => { starred = on; }, { id: 'worksheet.sheet.star' }));
      // The flag belongs to a quiz: shown only while this problem is in the running one.
      if (state.practice && state.practice.ids.includes(problem.id)) titleRow.appendChild(markBtn(state.practice, problem.id, undefined, { id: 'worksheet.sheet.mark' }));
      const noteBtn = iconBtn('notebook-pen', problemNote ? 'Edit Note' : 'Add Note', {
        id: 'worksheet.sheet.noteToggle',
        hint: problemNote || 'A note on this problem, kept with it across quizzes and shown in the bank.',
        onClick: () => { const open = noteHost.style.display === 'none'; noteHost.style.display = open ? '' : 'none'; if (open) noteArea.focus(); },
      });
      noteBtn.classList.toggle('ws-note--on', !!problemNote);
      noteBtn.setAttribute('aria-pressed', problemNote ? 'true' : 'false');
      titleRow.appendChild(noteBtn);
      if (problem.solutionCol >= 0 || problem.solutionRow >= 0) {
        // Revealing changes the whole sheet, so it says so in words.
        createButton(titleRow, {
          id: 'worksheet.sheet.reveal',
          label: revealed ? 'Hide Solution' : 'Reveal Solution',
          icon: revealed ? 'eye-off' : 'eye',
          title: revealed ? 'Hides the worked solution again. Your work stays.' : 'Shows the worked solution beside your work, as in the workbook.',
          onClick: () => {
            void (async () => {
              const live = host?.getSnapshot();
              if (!live || !host) return;
              revealed = !revealed;
              // In place: the engine hides or shows the solution columns
              // itself, so the canvas, scroll and selection stay. The remount
              // remains only as the fallback when the engine refuses.
              const segs = solutionSegments(live);
              const h = host;
              const inPlace = segs.length > 0 && segs.every((seg) => h.setColumnsHidden(seg.start, seg.last - seg.start + 1, !revealed));
              if (!inPlace) await mountSheet(applySolutionVisibility(live, revealed));
              // Revealing is not work. With work on the sheet the column state
              // is saved alongside it; without any, the baseline moves instead,
              // so a look at the solution never writes an attempt.
              if (worked) { lastSavedCells = ''; await persistWorking(); }
              else lastSavedCells = JSON.stringify(host?.getSnapshot() ?? null);
              paintHeader();
            })();
          },
        });
      }
      // The rest of the sheet's tools, behind ⋯.
      const resetWork = async () => {
        const ok = await state.api?.window?.showConfirmModal?.({
          message: 'Reset your work on this problem?',
          detail: 'Everything you typed on this sheet is discarded. Your ratings and study time are kept. This cannot be undone.',
          confirmLabel: 'Reset Work',
          danger: true,
        }) ?? false;
        if (!ok || disposed) return;
        lastSavedCells = '';
        workingCache.delete(instanceId);
        await discardOpenAttempt(problem.id);
        await mountSheet(applyRatingCell(applySolutionVisibility(parseWorkbook(problem.sheetJson) as IWorkbookData, revealed), latestRating));
        lastSavedCells = await settledSnapshotJson();
      };
      const moreBtn = createIconButton(titleRow, { id: 'worksheet.sheet.more', icon: 'ellipsis', title: 'More Actions' });
      moreBtn.addEventListener('click', () => {
        const dark = resolveSheetDark();
        showMenu(moreBtn, [
          { label: dark ? 'Light Sheet' : 'Dark Sheet', icon: dark ? 'sun' : 'moon', tooltip: 'Flips this practice sheet only. Light matches the real exam surface.', onSelect: () => void setSheetAppearance(dark ? 'light' : 'dark') },
          { label: 'Export to Excel', icon: 'file-spreadsheet', tooltip: 'Saves this sheet as a real .xlsx, values and formulas, in your Downloads folder.', onSelect: () => {
            const name = (problem.sheetName || problem.title || 'problem').replace(/[^\w\- .]+/g, '').trim() || 'problem';
            if (!host?.exportToXlsx(name)) void state.api?.window?.showInformationMessage?.('Nothing on the sheet to export yet.');
          } },
          ...(instanceId.startsWith('item:') && state.practice?.ids.includes(problem.id) ? [{ label: 'Open Problem in Its Own Tab', icon: 'file-spreadsheet', onSelect: () => void openWorksheet(`item:${problem.id}`, problem.title) }] : []),
          { label: 'Show in Problem Bank', icon: 'library', onSelect: () => void openWorksheet('bank', 'Problem Bank') },
          { separator: true },
          { label: 'Reset Work…', icon: 'rotate-ccw', danger: true, tooltip: 'Clears your work and the timer; the problem returns to the sheet as imported. Ratings stay.', onSelect: () => void resetWork() },
        ]);
      });
      header.replaceChildren(titleRow, noteHost);
      if (revealed && state.api?.lm) {
        const reviewWrap = el('div', 'ws-item__review');
        const reviewBtn = createButton(null, { id: 'worksheet.sheet.reviewInChat', label: 'Review in Chat', title: 'Stages your cells, the worked solution and a review brief in the chat. Add your question under the brief, then send.' });
        const reviewOut = el('div', 'ws-item__reviewout');
        reviewOut.style.display = 'none';
        reviewBtn.addEventListener('click', () => {
          void (async () => {
            if (!state.api?.lm) return;
            await persistWorking();
            reviewBtn.disabled = true;
            try {
              const reviewItem = { ...problem, solutionJson: problem.sheetJson };
              if (await reviewInChat(reviewItem, problem.id, lastSavedCells) === 'chat') { reviewOut.style.display = 'none'; return; }
              // No chat surface: the one-shot review, in place.
              reviewBtn.textContent = 'Reviewing…';
              reviewOut.style.display = '';
              reviewOut.textContent = 'Reading your work…';
              const review = await reviewAttempt(state.api.lm, reviewItem, lastSavedCells, (partial) => { reviewOut.textContent = partial; });
              reviewOut.replaceChildren(renderMarkdown(review));
              await saveAttemptReview(problem.id, review);
            } catch (e) {
              reviewOut.style.display = '';
              reviewOut.textContent = `Review failed: ${(e as Error).message}`;
            } finally {
              reviewBtn.disabled = false;
              reviewBtn.textContent = 'Review in Chat';
            }
          })();
        });
        reviewWrap.append(reviewBtn, reviewOut);
        header.appendChild(reviewWrap);
      }
    };
    headerHost.replaceChildren(header);
    syncRevealFromSheet = () => {
      if (disposed || !host) return;
      const live = host.getSnapshot();
      if (!live) return;
      const segs = solutionSegments(live);
      if (segs.length === 0) return;
      const columnData = firstSheet(live)?.columnData ?? {};
      let hidden = 0;
      for (const seg of segs) for (let c = seg.start; c <= seg.last; c++) if (columnData[c]?.hd) hidden++;
      const nowRevealed = hidden === 0;
      if (nowRevealed === revealed) return;
      revealed = nowRevealed;
      paintHeader();
      if (worked) { lastSavedCells = ''; void persistWorking(); }
      else lastSavedCells = JSON.stringify(host?.getSnapshot() ?? null);
    };
    paintHeader();
    // Work saved before the sheet was replaced sits on the old layout: the new sheet opens instead.
    const carried = [open, prior].find((a) => a && a.updatedAt >= problem.sheetAt) ?? null;
    const base = workingCache.get(instanceId) ?? (carried ? (parseWorkbook(carried.cellsJson) as IWorkbookData | null) : null);
    await mountSheet(applyRatingCell(applySolutionVisibility((base ?? parseWorkbook(problem.sheetJson)) as IWorkbookData, revealed), latestRating));
    // Baseline = what the sheet holds once the engine has settled after the
    // mount, so merely reopening a problem (rated or not) starts no new attempt.
    lastSavedCells = await settledSnapshotJson();
    if (disposed) return;
    // The sheet replaced from its workbook while this tab is open: the new layout takes over.
    sheetSub?.dispose();
    sheetSub = onWorksheetDataChanged(() => {
      void (async () => {
        const at = await getItemSheetAt(problem.id).catch(() => 0);
        if (disposed || at <= problem.sheetAt) return;
        const fresh = await getItem(problem.id).catch(() => null);
        if (disposed || !fresh) return;
        problem = fresh;
        item = fresh;
        workingCache.delete(instanceId);
        await mountSheet(applyRatingCell(applySolutionVisibility(parseWorkbook(problem.sheetJson) as IWorkbookData, revealed), latestRating));
        lastSavedCells = await settledSnapshotJson();
      })();
    });
    // Work is what the campaign counts, not the rating alone. The first cell
    // edit records it, so a problem that arrived carrying its workbook rating
    // still closes out the day once it has actually been done. Armed only
    // now, after the engine has settled, so nothing the mount does counts.
    onSheetEdited = () => {
      if (disposed || worked || ratingWrite) return;
      worked = true;
      void (async () => {
        await persistWorking();
        await markAttemptWorked(problem.id, problemSeconds >= 0 ? problemSeconds : undefined).catch(() => {});
        if (!disposed) paintHeader();
      })();
    };
    autosaveTimer = setInterval(() => { void persistWorking(false); }, AUTOSAVE_MS);
    // The study clock: elapsed time on screen while active, whatever the
    // cells do; flushed to the ledger every half minute and at teardown,
    // which announces the change so the dashboard's day catches up.
    studyTicker?.dispose();
    studyTicker = createStudyTicker({
      visible: () => !disposed && paneOnScreen(root),
      idleMs: getIdleMinutes() * 60_000,
      credit: (secs, final) => { void addStudySeconds(dayKey(Date.now()), problem.id, quizSessionIdFor(problem.id) ?? '', secs, final).catch(() => {}); },
      onTotal: (delta) => { problemSeconds = Math.max(0, problemSeconds + delta); timerEl.textContent = fmtSeconds(problemSeconds); },
    });
  };

  void (async () => {
    try {
      if (itemId != null) {
        item = await getItem(itemId);
        if (!item) {
          loading.textContent = 'This practice item no longer exists.';
          readyResolve();
          return;
        }
        if (item.sheetJson) {
          const open = await getOpenAttempt(itemId);
          await initProblem(item, open, open ? null : await getLatestWork(itemId));
          return;
        }
        itemStarred = (await getStarred([itemId]).catch(() => new Set<number>())).has(itemId);
        renderItemHeader();
        const open = await getOpenAttempt(itemId);
        const prior = open ? null : await getLatestWork(itemId);
        const snap = workingCache.get(instanceId) ?? ((open ?? prior) ? parseWorkbook((open ?? prior)!.cellsJson) : null);
        await mountSheet(snap ?? parseWorkbook(item.givensJson));
        // Baseline = what the sheet holds RIGHT AFTER mount. Autosave only
        // writes when the snapshot moves off this baseline — without it,
        // merely opening an item wrote the givens as an "attempt" and
        // flagged it In Progress forever.
        lastSavedCells = await settledSnapshotJson();
        if (disposed) return;
        autosaveTimer = setInterval(() => { void persistWorking(false); }, AUTOSAVE_MS);
      } else {
        // Scratch sheet: a slim bar so export is reachable without an item.
        const bar = el('div', 'ws-scratchbar');
        bar.appendChild(el('span', 'ws-scratchbar__label', 'Scratch Sheet'));
        const spacer = el('div'); spacer.style.flex = '1';
        bar.appendChild(spacer);
        scratchThemeBtn = makeSheetThemeButton();
        bar.appendChild(scratchThemeBtn);
        bar.appendChild(iconBtn('file-spreadsheet', 'Export to Excel', {
          id: 'worksheet.sheet.export',
          hint: 'Saves this sheet as a real .xlsx, values and formulas, in your Downloads folder.',
          onClick: () => {
            if (!host?.exportToXlsx('scratch-sheet')) {
              void state.api?.window?.showInformationMessage?.('Nothing on the sheet to export yet.');
            }
          },
        }));
        headerHost.appendChild(bar);
        await mountSheet(scratchCache.get(instanceId) ?? null);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      loading.textContent = `The sheet engine failed to load: ${message}`;
      readyResolve();
      console.error('[Worksheet] engine load failed:', err);
    }
  })();

  return {
    // One live engine per window: the sheet is torn down when its tab is
    // switched away and rebuilt on return. The engine keeps module-level
    // state that every live instance in the window shares, and it is built
    // for one instance per page; hidden instances are where the shared
    // caches, the focus tracking and the render loops crossed.
    retainOnHide: false,
    saveViewState: () => {
      void persistWorking();
      return { instanceId, view: host?.getViewState() ?? null };
    },
    ready,
    restoreViewState: (state: unknown) => {
      // Content rides SQLite and the working cache, applied in the async init
      // above; the place on the sheet rides here.
      const view = (state as { view?: SheetViewState | null } | null)?.view ?? null;
      if (!view) return;
      pendingView = view;
      applyPendingView();
    },
    dispose: () => {
      readyResolve();
      if (autosaveTimer) clearInterval(autosaveTimer);
      studyTicker?.dispose();
      studyTicker = null;
      sheetSub?.dispose();
      sheetSub = null;
      // Capture-before-teardown so close-without-save cannot drop work.
      void persistWorking();
      disposed = true;
      appearanceListeners.delete(applyAppearance);
      decimalsListeners.delete(applyDecimals);
      visibilitySub?.dispose();
      editedSub?.dispose();
      changedSub?.dispose();
      modeObserver.disconnect();
      host?.dispose();
      host = null;
      root.remove();
    },
  };
}
