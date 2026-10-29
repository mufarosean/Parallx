// Worksheets: importing problems from a workbook.

import { declareControl } from '../../../ui/kit.js';
import { createButton, createPageHeader, createSectionLabel } from '../../../ui/kit.js';
import { createIconElement } from '../../../ui/iconRegistry.js';
import { listItems, createItem, recordImportedRating, upsertProgressSnapshot, type WorksheetItemSummary, updateItemPoints, replaceItemSheet } from '../worksheetData.js';
import { openXlsx } from '../ooxml.js';
import { detectProblems, readWorkbookTimeline, ratingLabel, paperLabel, SOURCE_LABELS, KIND_LABELS, QUADRANT_LABELS, type ProblemImport, type WorkbookSnapshot } from '../problemImport.js';
import { detectExcelItems, wholeSheetItem, type GridSheet, type ExcelItem } from '../excelImport.js';
import { BACK_TO_HOME, openWorksheet } from '../actions.js';
import { readPendingRecipes } from './bankPane.js';
import { workingCache, state } from '../state.js';
import { el } from '../widgets.js';

export function createExcelImportPane(container: HTMLElement) {
  const root = el('div', 'ws-pane ws-create');
  container.appendChild(root);
  let disposed = false;

  createPageHeader(root, {
    back: BACK_TO_HOME,
    title: 'Import Workbook',
    subtitle: 'A practice workbook: one problem per sheet, named Paper.Source_NN.',
  });

  // Before a file: one place to choose it, and what will happen. After: a
  // slim line with the file's status and Choose Another….
  const pickRow = el('div', 'ws-drop');
  const dropIcon = createIconElement('upload', 28);
  dropIcon.classList.add('ws-drop__icon');
  const dropHead = el('div', 'ws-drop__head', 'Choose an Excel workbook');
  const dropHint = el('div', 'ws-hint', 'Every sheet comes in with its formatting, the solution hidden until you reveal it, your ratings carried over. Importing the same workbook again adds new problems and can replace the sheets already in the bank.');
  dropHint.title = 'Other spreadsheets: Item/Answer sheet pairs and question-left, solution-right sheets are detected; anything else can be imported whole.';
  const pickBtn = createButton(null, { id: 'worksheet.import.chooseFile', label: 'Choose Excel File…', icon: 'file-spreadsheet', kind: 'primary' });
  const status = el('span', 'ws-hint ws-drop__status');
  pickRow.append(dropIcon, dropHead, dropHint, pickBtn, status);
  root.appendChild(pickRow);
  /** Once a workbook is read, the chooser shrinks to a line. */
  const compactPicker = () => {
    pickRow.classList.add('ws-drop--compact');
    const lbl = pickBtn.querySelector('.px-btn__label');
    if (lbl) lbl.textContent = 'Choose Another…';
    pickBtn.className = 'px-btn px-btn--secondary';
  };
  // The import's one action, in a footer that says what it will do.
  const footer = el('div', 'ws-footbar');
  const footNote = el('span', 'ws-hint');
  footer.appendChild(footNote);
  const footHost = el('div', 'ws-footbar__actions');
  footer.appendChild(footHost);
  footer.style.display = 'none';

  const err = el('div', 'ws-error');
  err.style.display = 'none';
  root.appendChild(err);
  const listHost = el('div', 'ws-create__review');
  root.appendChild(listHost);
  root.appendChild(footer);

  const renderSelection = (items: ExcelItem[], leftovers: GridSheet[], filePath: string, fileLabel: string) => {
    listHost.replaceChildren();
    err.style.display = 'none';

    interface Row { item: ExcelItem; include: boolean; box: HTMLInputElement }
    const rows: Row[] = [];
    const addRow = (item: ExcelItem, include: boolean, host: HTMLElement) => {
      const row = el('div', 'ws-genitem ws-xlrow');
      const line = el('label', 'ws-xlrow__line');
      const box = el('input') as HTMLInputElement;
      box.type = 'checkbox';
      box.checked = include;
      line.appendChild(box);
      line.appendChild(el('span', 'ws-xlrow__title', item.title));
      const meta: string[] = [];
      if (item.points > 0) meta.push(`${item.points} pts`);
      meta.push(item.kind === 'pair' ? 'Item + Answer sheets' : item.kind === 'split' ? 'solution alongside' : 'whole sheet');
      line.appendChild(el('span', 'ws-list__meta', meta.join(' · ')));
      row.appendChild(line);
      host.appendChild(row);
      rows.push({ item, include, box });
    };

    if (items.length > 0) {
      createSectionLabel(listHost, `${items.length} practice ${items.length === 1 ? 'item' : 'items'} detected`);
      const toggles = el('div', 'ws-create__controls');
      createButton(toggles, { id: 'worksheet.import.items.selectAll', label: 'Select All', icon: 'list-checks', kind: 'ghost', size: 'sm', onClick: () => { for (const r of rows) if (r.item.kind !== 'whole') r.box.checked = true; } });
      createButton(toggles, { id: 'worksheet.import.items.selectNone', label: 'Select None', icon: 'square', kind: 'ghost', size: 'sm', onClick: () => { for (const r of rows) r.box.checked = false; } });
      listHost.appendChild(toggles);
      for (const item of items) addRow(item, true, listHost);
    }
    if (leftovers.length > 0) {
      createSectionLabel(listHost, `Other sheets (${leftovers.length})`);
      listHost.appendChild(el('div', 'ws-hint', 'No question and solution found. Tick any to import the whole sheet as a practice surface.'));
      for (const sheet of leftovers) addRow(wholeSheetItem(sheet, fileLabel), false, listHost);
    }
    if (items.length === 0 && leftovers.length === 0) {
      listHost.appendChild(el('div', 'ws-hint', 'That workbook has no importable sheets.'));
      return;
    }

    footHost.replaceChildren();
    const importBtn = createButton(footHost, { id: 'worksheet.import.importItems', label: 'Import Selected Items', icon: 'download', kind: 'primary' });
    const countSelected = () => { const n = rows.filter((r) => r.box.checked).length; footNote.textContent = `${n} selected`; const l = importBtn.querySelector('.px-btn__label'); if (l) l.textContent = n ? `Import ${n} ${n === 1 ? 'Item' : 'Items'}` : 'Import Selected Items'; };
    listHost.onchange = () => countSelected();
    footer.style.display = '';
    countSelected();
    importBtn.addEventListener('click', () => {
      void (async () => {
        const keep = rows.filter((r) => r.box.checked);
        if (keep.length === 0) {
          err.textContent = 'Nothing selected to import.';
          err.style.display = '';
          return;
        }
        importBtn.disabled = true;
        try {
          let done = 0;
          for (const r of keep) {
            await createItem({
              title: r.item.title,
              questionMd: r.item.questionMd,
              givensJson: r.item.givensJson,
              solutionJson: r.item.solutionJson,
              solutionNotesMd: '',
              sourceUri: filePath,
              sourceLabel: fileLabel,
              sourcePage: 0,
              tags: r.item.tags,
            });
            done++;
            if (done % 10 === 0) status.textContent = `Importing ${done} of ${keep.length}…`;
          }
          state.api?.activity?.note('imported', `${keep.length} worksheet practice ${keep.length === 1 ? 'item' : 'items'}`, fileLabel);
          await state.api?.window?.showInformationMessage?.(`Imported ${keep.length} ${keep.length === 1 ? 'item' : 'items'}.`);
          await openWorksheet('home', 'Worksheets');
        } catch (e) {
          err.textContent = (e as Error).message;
          err.style.display = '';
          importBtn.disabled = false;
        }
      })();
    });
  };

  /** Problem Bank import: problems grouped by paper, already-imported ones marked. */
  const renderProblems = async (problems: ProblemImport[], filePath: string, fileLabel: string, timeline: WorkbookSnapshot[]) => {
    listHost.replaceChildren();
    err.style.display = 'none';
    // One pass over the bank, not a query per problem: 331 round trips left
    // the pane blank for seconds with nothing to say.
    const existing = new Map<string, number>();
    for (const it of await listItems().catch(() => [] as WorksheetItemSummary[])) {
      if (it.sourceLabel === fileLabel && it.sheetName) existing.set(it.sheetName, it.id);
    }
    if (disposed) return;
    const rows: { problem: ProblemImport; box: HTMLInputElement }[] = [];
    // Problems already in the bank take the workbook's sheet only when asked:
    // a corrected or re-laid-out workbook replaces their sheets in place.
    let replace = false;
    const willImport = (r: { problem: ProblemImport; box: HTMLInputElement }): boolean => r.box.checked && (replace || !existing.has(r.problem.sheetName));
    // The footer says what Import will do; with nothing new it brings the history.
    const countSelected = () => {
      const chosen = rows.filter(willImport);
      const r = chosen.filter((x) => existing.has(x.problem.sheetName)).length;
      const n = chosen.length - r;
      const papersOn = new Set(chosen.map((x) => x.problem.paper)).size;
      footNote.textContent = chosen.length ? `${chosen.length} selected · ${papersOn} ${papersOn === 1 ? 'paper' : 'papers'}` : timeline.length ? 'Nothing new selected' : 'Nothing selected';
      const l = importBtn.querySelector('.px-btn__label');
      if (l) {
        l.textContent = n && r ? `Import ${n}, Replace ${r}`
          : r ? `Replace ${r} ${r === 1 ? 'Sheet' : 'Sheets'}`
            : n ? `Import ${n} ${n === 1 ? 'Problem' : 'Problems'}` : timeline.length > 0 ? 'Import Dashboard History' : 'Import Selected Problems';
      }
    };
    listHost.onchange = () => countSelected();
    const rated = problems.filter((p) => p.rating).length;
    const fresh = problems.length - existing.size;
    createSectionLabel(listHost, `${problems.length} problems in ${fileLabel}`);
    listHost.appendChild(el('div', 'ws-hint', `${fresh} new, ${existing.size} already in the bank, ${rated} with a rating to carry over${timeline.length ? `, ${timeline.length} ${timeline.length === 1 ? 'day' : 'days'} of dashboard history` : ''}.`));
    const toggles = el('div', 'ws-create__controls');
    createButton(toggles, { id: 'worksheet.import.problems.selectNew', label: 'Select New', icon: 'sparkles', kind: 'ghost', size: 'sm', onClick: () => { for (const r of rows) r.box.checked = !existing.has(r.problem.sheetName); countSelected(); } });
    createButton(toggles, { id: 'worksheet.import.problems.selectNone', label: 'Select None', icon: 'square', kind: 'ghost', size: 'sm', onClick: () => { for (const r of rows) r.box.checked = false; countSelected(); } });
    listHost.appendChild(toggles);
    if (existing.size > 0) {
      const replaceRow = el('label', 'ws-import__row');
      const replaceBox = el('input') as HTMLInputElement;
      replaceBox.type = 'checkbox';
      replaceRow.appendChild(replaceBox);
      replaceRow.appendChild(el('span', 'ws-xlrow__title', 'Replace sheets already in the bank'));
      replaceRow.title = 'Their ratings, stars, notes, time and history stay. Work saved on an old sheet stays in the history; the problem opens on the new sheet.';
      declareControl(replaceBox, { id: 'worksheet.import.replaceExisting', label: 'Replace sheets already in the bank', kind: 'toggle', hint: replaceRow.title, state: () => ({ kind: 'pressed', value: replaceBox.checked }) });
      replaceBox.addEventListener('change', () => {
        replace = replaceBox.checked;
        for (const r of rows) if (existing.has(r.problem.sheetName)) r.box.checked = replace;
        countSelected();
      });
      listHost.appendChild(replaceRow);
    }
    const byPaper = new Map<string, ProblemImport[]>();
    for (const p of problems) { if (!byPaper.has(p.paper)) byPaper.set(p.paper, []); byPaper.get(p.paper)!.push(p); }
    for (const [paper, list] of [...byPaper.entries()].sort((a, b) => paperLabel(a[0]).localeCompare(paperLabel(b[0])))) {
      const group = el('div', 'ws-import__group');
      const head = el('div', 'ws-import__grouphead');
      const groupBox = el('input') as HTMLInputElement;
      groupBox.type = 'checkbox';
      groupBox.checked = list.some((p) => !existing.has(p.sheetName));
      head.appendChild(groupBox);
      head.appendChild(el('span', undefined, `${paperLabel(paper)} (${list.length})`));
      group.appendChild(head);
      const groupRows: HTMLInputElement[] = [];
      for (const p of list) {
        const row = el('label', 'ws-import__row');
        const box = el('input') as HTMLInputElement;
        box.type = 'checkbox';
        box.checked = !existing.has(p.sheetName);
        row.appendChild(box);
        row.appendChild(el('span', 'ws-xlrow__title', p.title));
        const meta = [SOURCE_LABELS[p.source] ?? p.source, KIND_LABELS[p.kind] ?? p.kind, p.quadrant ? QUADRANT_LABELS[p.quadrant] : ''].filter(Boolean).join(' · ');
        row.appendChild(el('span', 'ws-list__meta', meta));
        if (p.rating) row.appendChild(el('span', `ws-chip ws-chip--${p.rating}`, ratingLabel(p.rating)));
        if (existing.has(p.sheetName)) row.appendChild(el('span', 'ws-chip ws-chip--muted', 'In the bank'));
        else row.appendChild(el('span', 'ws-chip ws-chip--open', 'New'));
        if (p.stats.imagesSkipped > 0) row.appendChild(el('span', 'ws-chip ws-chip--muted', `${p.stats.imagesSkipped} picture${p.stats.imagesSkipped === 1 ? '' : 's'} not shown`));
        group.appendChild(row);
        rows.push({ problem: p, box });
        groupRows.push(box);
      }
      groupBox.addEventListener('change', () => { for (const b of groupRows) b.checked = groupBox.checked; });
      listHost.appendChild(group);
    }
    footHost.replaceChildren();
    const importBtn = createButton(footHost, { id: 'worksheet.import.importProblems', label: 'Import Selected Problems', icon: 'download', kind: 'primary' });
    footer.style.display = '';
    countSelected();
    importBtn.addEventListener('click', () => {
      void (async () => {
        const keep = rows.filter((r) => r.box.checked);
        // A bank that already holds every problem can still take the workbook's history.
        if (keep.length === 0 && timeline.length === 0) { err.textContent = 'Nothing selected to import.'; err.style.display = ''; return; }
        importBtn.disabled = true;
        let done = 0;
        let carried = 0;
        let replaced = 0;
        try {
          for (const r of keep) {
            const p = r.problem;
            const known = existing.get(p.sheetName);
            if (known != null && replace) {
              await replaceItemSheet(known, {
                title: p.title, questionMd: p.questionMd, sheetJson: p.sheetJson,
                solutionCol: p.solutionCol, workRow: p.workRow, solutionRow: p.solutionRow, points: p.points ?? null,
              });
              replaced++;
              if (replaced % 10 === 0) status.textContent = `Replacing ${replaced} of ${keep.length}…`;
              continue;
            }
            if (existing.has(p.sheetName)) {
              // Already in the bank: a point value the workbook gives now fills a blank one.
              if (known != null && typeof p.points === 'number') await updateItemPoints(known, p.points).catch(() => {});
              done++; continue;
            }
            const id = await createItem({
              title: p.title, questionMd: p.questionMd, sourceUri: filePath, sourceLabel: fileLabel, tags: p.tags,
              sheetJson: p.sheetJson, solutionCol: p.solutionCol, workRow: p.workRow, solutionRow: p.solutionRow,
              paper: p.paper, source: p.source, kind: p.kind, quadrant: p.quadrant, sheetName: p.sheetName, points: p.points ?? null,
            });
            if (id != null && p.rating) { await recordImportedRating(id, p.rating, Date.now()); carried++; }
            done++;
            if (done % 10 === 0) status.textContent = `Importing ${done} of ${keep.length}…`;
          }
          // Sheets cached by closed problem tabs hold the old layouts; every entry is
          // already saved to its attempt, so the cache can simply start over.
          if (replaced) workingCache.clear();
          await readPendingRecipes();
          // The workbook's own dashboard history, so the timeline starts where his did.
          for (const s of timeline) await upsertProgressSnapshot(s.day, s.attempted, s.score, 'workbook');
          status.textContent = '';
          state.api?.activity?.note('imported', `${done} problems from ${fileLabel}`, [carried ? `${carried} ratings carried over` : '', replaced ? `${replaced} sheets replaced` : ''].filter(Boolean).join(', ') || undefined);
          const history = timeline.length ? `${timeline.length} ${timeline.length === 1 ? 'day' : 'days'} of dashboard history` : '';
          const sheets = replaced ? `Replaced ${replaced} ${replaced === 1 ? 'sheet' : 'sheets'}` : '';
          await state.api?.window?.showInformationMessage?.(
            done === 0 && (history || sheets) ? `${[sheets, history ? `Added ${history}` : ''].filter(Boolean).join('. ')}.`
              : `Imported ${done} ${done === 1 ? 'problem' : 'problems'}${carried ? `, ${carried} with your rating` : ''}${history ? `, ${history}` : ''}${sheets ? `. ${sheets}` : ''}.`,
          );
          await openWorksheet('bank', 'Problem Bank');
        } catch (e) {
          err.textContent = (e as Error).message;
          err.style.display = '';
          importBtn.disabled = false;
        }
      })();
    });
    listHost.appendChild(importBtn);
  };

  const importPath = async (filePath: string): Promise<void> => {
      const electron = (window as {
        parallxElectron?: {
          document?: { extractWorkbookGrid?(p: string): Promise<{ error?: { message: string }; sheets?: GridSheet[] }> };
          fs?: { readFile?(p: string): Promise<{ error?: { message: string }; content?: string; encoding?: string }> };
        };
      }).parallxElectron;
      // An .xlsx/.xlsm goes through the app's own reader (fs.readFile); only
      // the legacy .xls path needs the document extractor.
      const ooxml = /\.(xlsx|xlsm)$/i.test(filePath);
      if (!electron || (ooxml ? !electron.fs?.readFile : !electron.document?.extractWorkbookGrid)) {
        err.textContent = 'Excel import needs the desktop app.';
        err.style.display = '';
        return;
      }
      if (!filePath || disposed) return;
      const fileLabel = filePath.split(/[\\/]/).pop() || 'Workbook';
      status.textContent = `Reading ${fileLabel}…`;
      err.style.display = 'none';
      // The Problem Bank path first: our own reader keeps the formatting.
      if (electron.fs?.readFile && /\.(xlsx|xlsm)$/i.test(filePath)) {
        try {
          const read = await electron.fs.readFile(filePath);
          if (read?.error) throw new Error(read.error.message);
          if (read?.encoding === 'base64' && read.content) {
            const bin = atob(read.content);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            const book = await openXlsx(bytes);
            const { problems } = await detectProblems(book, (done, total) => { status.textContent = `Reading ${fileLabel}: ${done} / ${total} problems…`; });
            if (disposed) return;
            if (problems.length > 0) {
              const timeline = await readWorkbookTimeline(book).catch(() => [] as WorkbookSnapshot[]);
              status.textContent = `${fileLabel}: ${problems.length} problems found${timeline.length ? `, ${timeline.length} days of history` : ''}.`;
              compactPicker();
              // A failure listing the problems is shown, never swallowed into the legacy path.
              try {
                await renderProblems(problems, filePath, fileLabel, timeline);
              } catch (e) {
                status.textContent = '';
                err.textContent = `Could not list the problems: ${(e as Error).message}`;
                err.style.display = '';
              }
              return;
            }
          }
        } catch (e) {
          console.warn('[Worksheet] problem-bank import fell back to sheet detection:', e);
        }
      }
      try {
        if (!electron.document?.extractWorkbookGrid) throw new Error('the document extractor is not available');
        const grid = await electron.document.extractWorkbookGrid(filePath);
        if (grid?.error) throw new Error(grid.error.message);
        const sheets = grid?.sheets ?? [];
        if (disposed) return;
        const { items, leftovers } = detectExcelItems(sheets, fileLabel.replace(/\.(xlsx|xlsm|xls)$/i, ''));
        const leftoverSheets = sheets.filter((s) => leftovers.includes(s.name));
        status.textContent = `${fileLabel}: ${sheets.length} sheets, ${items.length} items detected.`;
        compactPicker();
        renderSelection(items, leftoverSheets, filePath, fileLabel);
      } catch (e) {
        status.textContent = '';
        err.textContent = `Could not read the workbook: ${(e as Error).message}`;
        err.style.display = '';
      }
  };
  state.importPaneHooks = { importPath };
  pickBtn.addEventListener('click', () => {
    void (async () => {
      const dialog = (window as { parallxElectron?: { dialog?: { openFile?(opts: unknown): Promise<string[] | null> } } }).parallxElectron?.dialog;
      if (!dialog?.openFile) { err.textContent = 'Excel import needs the desktop app.'; err.style.display = ''; return; }
      const res = await dialog.openFile({ title: 'Import practice problems', filters: [{ name: 'Excel Workbooks', extensions: ['xlsx', 'xlsm', 'xls'] }] });
      const filePath = Array.isArray(res) ? res[0] : undefined;
      if (filePath) await importPath(filePath);
    })();
  });
  if (state.pendingImportPath) { const p = state.pendingImportPath; state.pendingImportPath = null; void importPath(p); }

  return {
    dispose: () => {
      disposed = true;
      if (state.importPaneHooks?.importPath === importPath) state.importPaneHooks = null;
      root.remove();
    },
  };
}
