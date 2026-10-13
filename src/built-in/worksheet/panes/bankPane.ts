// Worksheets: the Home pane. The problem bank by paper, state and recipe,
// with the notes digest and the recipe sheets a quiz leaves behind.

import { BANK_FACETS, BANK_FILTERS, BANK_COUNTED, bankMatches, stateClass } from '../bankFilters.js';
import { declareControl } from '../../../ui/kit.js';
import { createButton, createEmptyState, createFilterChip, createIconButton, createPageHeader } from '../../../ui/kit.js';
import type { IExtensionMenuItem } from '../../../ui/contextMenu.js';
import { createIconElement } from '../../../ui/iconRegistry.js';
import { listItems, deleteItem, onWorksheetDataChanged, setItemStarred, type WorksheetItemSummary, setItemRecipe, listUnreadRecipeSheets, storeReadRecipe, notifyWorksheetDataChanged } from '../worksheetData.js';
import { normalizeRating, paperLabel, SOURCE_LABELS, KIND_LABELS, QUADRANT_LABELS } from '../problemImport.js';
import { recipeOfSheet, recipeGroups, recipeKey } from '../recipes.js';
import { appDateString } from '../../../services/localTime.js';
import { fmtStudy, gradeLabel } from '../labels.js';
import { BACK_TO_HOME, beginReview, openBuilder, openWorksheet, showMenu, startQuizWith } from '../actions.js';
import { discussNotesInChat } from '../chatReview.js';
import { state } from '../state.js';
import { el, starBtn } from '../widgets.js';

// ── Item browser (instanceId 'home') ────────────────────────────────────────

/** Papers opened in the Problem Bank page; survives re-renders. */
const _homeOpen = new Set<string>();

export function createBankPane(container: HTMLElement) {
  const root = el('div', 'ws-pane ws-home');
  container.appendChild(root);
  let disposed = false;
  let items: WorksheetItemSummary[] = [];
  // The header and the filter bar stay put while you type; only the list
  // and the counts repaint.
  const headHost = el('div');
  const barHost = el('div');
  const listHost = el('div');
  root.append(headHost, barHost, listHost);
  let countEl: HTMLElement | null = null;

  const shownProblems = () => items.filter((it) => it.paper && bankMatches(it, _bankFilters, _bankQuery, _bankRecipes));

  const paintHeader = () => {
    headHost.replaceChildren();
    const problems = items.filter((it) => it.paper);
    const rated = problems.filter((it) => normalizeRating(it.attemptState)).length;
    const papers = new Set(problems.map((it) => it.paper)).size;
    const noted = items.filter((it) => it.note);
    const generated = items.filter((it) => !it.paper);
    const shown = shownProblems();
    createPageHeader(headHost, {
      back: BACK_TO_HOME,
      title: 'Problem Bank',
      subtitle: problems.length ? `${problems.length} problems · ${rated} rated · ${papers} ${papers === 1 ? 'paper' : 'papers'}` : undefined,
      secondary: [
        ...(shown.length ? [{ id: 'worksheet.reviewShown', label: 'Review These', icon: 'eye', title: 'Walks through the problems shown here with your work and the solution showing. Not a quiz: nothing is scored or recorded.', onClick: () => void beginReview(shown.map((it) => it.id)) }] : []),
        ...(noted.length ? [{ id: 'worksheet.discussNotes', label: `Discuss Notes in Chat (${noted.length})`, icon: 'message-square', title: 'Stages every note, with its problem, paper and rating, in the chat. Add your question under the brief, then send.', onClick: () => void discussNotesInChat(items) }] : []),
      ],
      primary: shown.length ? { id: 'worksheet.quizShown', label: 'Quiz These…', title: 'Opens the quiz builder with the problems shown here.', onClick: () => { state.quizPreset = { ids: shown.map((it) => it.id), name: '' }; openBuilder(); } } : undefined,
      more: generated.length ? [{ label: `Delete All Generated Items (${generated.length})…`, icon: 'trash-2', danger: true, onSelect: () => void deleteGeneratedItems(generated) }] : [],
    });
  };

  // One row per problem, but only inside the paper you open: 331 rows in a
  // flat list is the workbook's 331 tabs all over again.
  const itemRow = (item: WorksheetItemSummary, generated: boolean): HTMLElement => {
    const row = el('div', 'ws-list__row ws-bankrow');
    row.appendChild(starBtn(item.id, item.starred));
    const info = el('button', 'ws-list__text') as HTMLButtonElement;
    info.type = 'button';
    const titleRow = el('span', 'ws-list__title');
    titleRow.appendChild(document.createTextNode(item.title));
    if (item.attemptState === 'open') titleRow.appendChild(el('span', 'ws-chip ws-chip--open', 'In progress'));
    else if (item.attemptState) titleRow.appendChild(el('span', `ws-chip ws-chip--${stateClass(item.attemptState)}`, gradeLabel(item.attemptState)));
    else titleRow.appendChild(el('span', 'ws-chip ws-chip--muted', 'Not rated'));
    info.appendChild(titleRow);
    const meta: string[] = [];
    if (item.paper) meta.push([SOURCE_LABELS[item.source] ?? '', KIND_LABELS[item.kind] ?? '', item.quadrant ? QUADRANT_LABELS[item.quadrant] : ''].filter(Boolean).join(' · '));
    if (item.paper && item.recipe) meta.push(item.recipePaper && item.recipePaper !== item.paper ? `${paperLabel(item.recipePaper)}: ${item.recipe}` : item.recipe);
    else if (item.sourceLabel) meta.push(item.sourcePage > 0 ? `${item.sourceLabel} · p.${item.sourcePage}` : item.sourceLabel);
    if (!item.paper && item.tags) meta.push(item.tags.split(',').filter(Boolean).map((t) => `#${t.trim()}`).join(' '));
    if (item.attemptCount > 0) meta.push(`${item.attemptCount} ${item.attemptCount === 1 ? 'attempt' : 'attempts'}`);
    if (item.seconds > 0) meta.push(fmtStudy(item.seconds));
    if (item.lastAttemptAt > 0) meta.push(`last ${appDateString(item.lastAttemptAt, { month: 'short', day: 'numeric' })}`);
    info.appendChild(el('span', 'ws-list__meta', meta.join(' · ')));
    // The note, in the row: what he told himself about this problem, where he picks it.
    if (item.note) {
      const n = el('span', 'ws-list__note');
      n.append(createIconElement('notebook-pen', 12), document.createTextNode(item.note));
      n.title = item.note;
      info.appendChild(n);
    }
    info.title = `Practice ${item.title}`;
    info.addEventListener('click', () => void openWorksheet(`item:${item.id}`, item.title));
    row.appendChild(info);
    const actions = el('div', 'ws-list__end ws-list__hover');
    createButton(actions, { id: null, label: 'Practice', size: 'sm', onClick: () => void openWorksheet(`item:${item.id}`, item.title) });
    const more = createIconButton(actions, { id: null, icon: 'ellipsis', title: `More actions for ${item.title}`, size: 'sm' });
    more.addEventListener('click', () => showMenu(more, [
      { label: 'Quiz This Problem', icon: 'play', onSelect: () => startQuizWith([item.id], 0, item.title) },
      { label: item.starred ? 'Unstar' : 'Star', icon: 'star', onSelect: () => void setItemStarred(item.id, !item.starred).catch(() => {}) },
      ...(item.paper ? [{ label: 'Set Recipe…', icon: 'tag', onSelect: () => void pickRecipe(item, items) }] : []),
      ...(generated ? [
        { separator: true },
        { label: 'Delete Item…', icon: 'trash-2', danger: true, onSelect: () => {
          void (async () => {
            const ok = await state.api?.window?.showConfirmModal?.({
              message: `Delete "${item.title}"?`,
              detail: 'This permanently deletes the item, its solution, and every attempt. This cannot be undone.',
              confirmLabel: 'Delete Item',
              danger: true,
            }) ?? false;
            if (ok) await deleteItem(item.id);
          })();
        } },
      ] : []),
    ]));
    row.appendChild(actions);
    return row;
  };

  const paintList = () => {
    listHost.replaceChildren();
    paintHeader();
    const all = items.filter((it) => it.paper);
    const problems = shownProblems();
    if (countEl) {
      countEl.replaceChildren(document.createTextNode(`${problems.length} of ${all.length}`));
      if (_bankFilters.size || _bankQuery || _bankRecipes.size) {
        const clear = el('button', 'ws-linkbtn', 'Clear filters') as HTMLButtonElement;
        clear.type = 'button';
        clear.addEventListener('click', () => { _bankFilters.clear(); _bankRecipes.clear(); _bankQuery = ''; paintBar(); paintList(); });
        declareControl(clear, { id: 'worksheet.bank.clearFilters', label: 'Clear filters' });
        countEl.append(document.createTextNode(' · '), clear);
      }
    }
    const filtering = _bankFilters.size > 0 || !!_bankQuery || _bankRecipes.size > 0;
    const generated = items.filter((it) => !it.paper);
    const byPaper = new Map<string, WorksheetItemSummary[]>();
    for (const it of all) { if (!byPaper.has(it.paper)) byPaper.set(it.paper, []); byPaper.get(it.paper)!.push(it); }
    const list = el('div', 'ws-list');
    for (const [key, group] of [...byPaper.entries()].sort((a, b) => paperLabel(a[0]).localeCompare(paperLabel(b[0])))) {
      const shown = group.filter((it) => problems.includes(it));
      const rated = group.filter((it) => normalizeRating(it.attemptState)).length;
      const secs = group.reduce((n, it) => n + it.seconds, 0);
      const open = filtering ? shown.length > 0 : _homeOpen.has(key);
      const head = el('button', 'ws-list__row ws-list__group') as HTMLButtonElement;
      head.type = 'button';
      head.setAttribute('aria-expanded', String(open));
      head.appendChild(createIconElement(open ? 'chevron-down' : 'chevron-right', 14));
      head.appendChild(el('span', 'ws-list__title', paperLabel(key)));
      if (filtering) head.appendChild(el('span', 'ws-list__meta', `${shown.length} shown`));
      const end = el('span', 'ws-list__end');
      const bar = el('span', 'ws-bank__bar');
      bar.title = 'Easy, medium and hard, of the paper';
      for (const cls of ['easy', 'medium', 'hard'] as const) {
        const n = group.filter((it) => stateClass(it.attemptState) === cls).length;
        if (n === 0) continue;
        const seg = el('span', cls);
        seg.style.width = `${(n / group.length) * 100}%`;
        bar.appendChild(seg);
      }
      end.append(bar, el('span', 'ws-list__meta', `${rated} of ${group.length} rated${secs > 0 ? ` · ${fmtStudy(secs)}` : ''}`));
      head.appendChild(end);
      head.addEventListener('click', () => { if (_homeOpen.has(key)) _homeOpen.delete(key); else _homeOpen.add(key); paintList(); });
      list.appendChild(head);
      if (open) for (const it of (filtering ? shown : group)) list.appendChild(itemRow(it, false));
    }
    if (generated.length > 0) {
      const open = _homeOpen.has('__generated');
      const head = el('button', 'ws-list__row ws-list__group') as HTMLButtonElement;
      head.type = 'button';
      head.setAttribute('aria-expanded', String(open));
      head.appendChild(createIconElement(open ? 'chevron-down' : 'chevron-right', 14));
      head.appendChild(el('span', 'ws-list__title', 'Generated items'));
      head.appendChild(el('span', 'ws-list__meta', `${generated.length} · not part of the workbook bank`));
      head.addEventListener('click', () => { if (open) _homeOpen.delete('__generated'); else _homeOpen.add('__generated'); paintList(); });
      list.appendChild(head);
      if (open) for (const it of generated) list.appendChild(itemRow(it, true));
    }
    listHost.appendChild(list);
  };

  const paintBar = () => {
    barHost.replaceChildren();
    if (items.length === 0) return;
    const bar = el('div', 'ws-home__filters');
    const search = el('label', 'ws-search');
    search.appendChild(createIconElement('search', 14));
    const input = el('input') as HTMLInputElement;
    input.type = 'search';
    input.placeholder = 'Search problems';
    input.title = 'Every word must appear, in any order. Quote a phrase to match it whole; put a minus before a word to leave those problems out: brosius credibility -essay';
    input.value = _bankQuery;
    input.setAttribute('aria-label', 'Search problems');
    declareControl(input, { id: 'worksheet.bank.search', label: 'Search problems', kind: 'input', hint: input.title, state: () => ({ kind: 'value', value: input.value }) });
    let searchTimer: ReturnType<typeof setTimeout> | null = null;
    input.addEventListener('input', () => {
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { _bankQuery = input.value.trim(); paintList(); }, 120);
    });
    search.appendChild(input);
    bar.appendChild(search);
    // One chip per filter, grouped by what they filter on; several can be on.
    // Within a group any may match, across groups all must.
    const chips = el('div', 'ws-chips');
    chips.setAttribute('role', 'group');
    chips.setAttribute('aria-label', 'Filters');
    const present = new Set<string>();
    for (const it of items) { present.add(it.source); present.add(it.kind); }
    const count = (f: string) => items.filter((it) => it.paper && bankMatches(it, new Set([f]), '')).length;
    for (const [value, label] of BANK_FILTERS) {
      if (([...BANK_FACETS.source, ...BANK_FACETS.kind] as readonly string[]).includes(value) && !present.has(value)) continue;
      const withCount = BANK_COUNTED.has(value);
      createFilterChip(chips, {
        id: `worksheet.bank.filter.${value}`, label, count: withCount ? count(value) : undefined, pressed: _bankFilters.has(value),
        onToggle: (on) => { if (on) _bankFilters.add(value); else _bankFilters.delete(value); paintList(); },
      });
    }
    bar.appendChild(chips);
    const groups = recipeGroups(items.filter((it) => it.paper));
    if (groups.size) {
      const n = _bankRecipes.size;
      const recipeBtn = createButton(bar, {
        id: 'worksheet.bank.recipes', label: n ? `Recipes (${n})` : 'Recipe', icon: 'tag', size: 'sm', kind: n ? 'secondary' : 'ghost',
        title: 'Show only problems that follow a recipe, grouped by paper',
        onClick: () => showMenu(recipeBtn, recipeMenu(groups, () => { paintBar(); paintList(); })),
      });
    }
    countEl = el('span', 'ws-home__summary');
    bar.appendChild(countEl);
    barHost.appendChild(bar);
  };

  const render = async () => {
    if (disposed) return;
    items = await listItems().catch(() => []);
    if (disposed) return;
    if (items.length === 0) {
      headHost.replaceChildren();
      createPageHeader(headHost, { back: BACK_TO_HOME, title: 'Problem Bank' });
      barHost.replaceChildren();
      listHost.replaceChildren();
      createEmptyState(listHost, {
        icon: 'library',
        headline: 'No problems yet.',
        hint: 'Import a practice workbook, or generate items from a PDF or pasted material.',
        action: { label: 'Import Workbook…', onClick: () => void openWorksheet('excel-import', 'Import Workbook') },
      });
      return;
    }
    if (!barHost.firstChild) paintBar();
    paintList();
  };

  void render();
  const sub = onWorksheetDataChanged(() => void render());

  return {
    dispose: () => {
      disposed = true;
      sub.dispose();
      root.remove();
    },
  };
}

// ── The bank (sidebar): papers with counts and rating colours, filters, search ──
//
// The workbook's sidebar was 331 hidden tabs and three unhide buttons; this
// is the same bank laid out as a list. Groups open and close, and the
// choice survives a re-render (module state, like the scratch cache).

const _bankOpen = new Set<string>();
/** The bank's chips: any number on; within a facet any may match, across facets all must (bankFilters.ts). */
const _bankFilters = new Set<string>();
/** The bank's recipe filter: recipeKey(paper, name) values; any may match. */
const _bankRecipes = new Set<string>();

/** One submenu per paper, a checked row per recipe with its problem count. */
function recipeMenu(groups: Map<string, Map<string, number>>, changed: () => void): IExtensionMenuItem[] {
  const papers = [...groups.keys()].sort((a, b) => (paperLabel(a) || '~').localeCompare(paperLabel(b) || '~'));
  const menu: IExtensionMenuItem[] = papers.map((paper) => {
    const recipes = [...groups.get(paper)!.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const on = recipes.filter(([name]) => _bankRecipes.has(recipeKey(paper, name))).length;
    return {
      label: `${paperLabel(paper) || 'Other'}${on ? ` (${on})` : ''}`,
      submenu: recipes.map(([name, count]) => {
        const key = recipeKey(paper, name);
        return {
          label: `${name} (${count})`,
          checked: _bankRecipes.has(key),
          onSelect: () => { if (_bankRecipes.has(key)) _bankRecipes.delete(key); else _bankRecipes.add(key); changed(); },
        };
      }),
    };
  });
  if (_bankRecipes.size) menu.push({ separator: true }, { label: 'Clear Recipes', onSelect: () => { _bankRecipes.clear(); changed(); } });
  return menu;
}

/** Set Recipe…: pick one the bank already uses (its paper's first), type a new one, or clear it. */
async function pickRecipe(item: WorksheetItemSummary, items: readonly WorksheetItemSummary[]): Promise<void> {
  const win = state.api?.window;
  if (!win?.showQuickPick) return;
  const groups = recipeGroups(items.filter((it) => it.paper));
  const known: { label: string; description: string; paper: string; name: string }[] = [];
  for (const [paper, recipes] of groups) {
    for (const name of recipes.keys()) known.push({ label: name, description: paperLabel(paper) || 'Other', paper, name });
  }
  known.sort((a, b) => Number(b.paper === item.paper) - Number(a.paper === item.paper) || a.description.localeCompare(b.description) || a.label.localeCompare(b.label));
  const NEW = 'New Recipe…';
  const NONE = 'No Recipe';
  const picks = [
    ...known.map((k) => ({ ...k, picked: k.paper === item.recipePaper && k.name === item.recipe })),
    { label: NEW, description: `for ${paperLabel(item.paper)}` },
    ...(item.recipe ? [{ label: NONE, description: 'clear it' }] : []),
  ];
  const chosen = await win.showQuickPick(picks, { placeholder: `Recipe for ${item.title}` }) as { label: string; paper?: string; name?: string } | undefined;
  if (!chosen) return;
  if (chosen.label === NONE && !chosen.paper) { await setItemRecipe(item.id, '', ''); return; }
  if (chosen.label === NEW && !chosen.paper) {
    const name = (await win.showInputBox?.({ prompt: `New recipe for ${paperLabel(item.paper)}`, placeholder: 'Direct Development Method', value: '' }))?.trim();
    if (name) await setItemRecipe(item.id, item.paper, name);
    return;
  }
  if (chosen.paper !== undefined && chosen.name) await setItemRecipe(item.id, chosen.paper, chosen.name);
}

/** Read the recipe from every sheet not read yet, a few at a time; once per sheet. */
let _recipesReading: Promise<void> | null = null;
export function readPendingRecipes(): Promise<void> {
  if (_recipesReading) return _recipesReading;
  _recipesReading = (async () => {
    let found = 0;
    try {
      for (;;) {
        if (!state.api) return;
        const batch = await listUnreadRecipeSheets(10);
        if (!batch.length) break;
        for (const row of batch) {
          const r = recipeOfSheet(row.sheetJson, row.paper);
          await storeReadRecipe(row.id, r ? r.paper : '', r ? r.name : '');
          if (r) found++;
        }
      }
    } catch (err) {
      console.warn('[Worksheet] reading recipes failed:', err);
    } finally {
      _recipesReading = null;
      if (found) notifyWorksheetDataChanged();
    }
  })();
  return _recipesReading;
}
let _bankQuery = '';

/** Remove every generated item (never a workbook problem), after one confirmation. */
async function deleteGeneratedItems(generated: WorksheetItemSummary[]): Promise<void> {
  const ok = await state.api?.window?.showConfirmModal?.({
    message: `Delete all ${generated.length} generated ${generated.length === 1 ? 'item' : 'items'}?`,
    detail: 'Items generated from PDFs or pasted material, with their attempts, are permanently deleted. Workbook problems are untouched. This cannot be undone.',
    confirmLabel: 'Delete Generated Items',
    danger: true,
  }) ?? false;
  if (!ok) return;
  for (const it of generated) await deleteItem(it.id);
  state.api?.activity?.note('deleted', `${generated.length} generated worksheet items`);
}

/** The bank in the sidebar: papers with their rating bars and counts, open to the problems, nothing else. */
export function renderBankSnapshot(root: HTMLElement, items: WorksheetItemSummary[]): void {
  const problems = items.filter((it) => it.paper);
  const generated = items.filter((it) => !it.paper);
  const section = el('div', 'ws-side__section');
  const title = el('button', 'ws-side__sectiontitle', 'Problem Bank') as HTMLButtonElement;
  title.type = 'button';
  title.title = 'Open the Problem Bank as a tab';
  title.addEventListener('click', () => void openWorksheet('bank', 'Problem Bank'));
  declareControl(title, { id: 'worksheet.side.bank', label: 'Problem Bank', hint: 'Opens the Problem Bank as a tab.' });
  section.appendChild(title);
  const ratedAll = problems.filter((it) => normalizeRating(it.attemptState)).length;
  section.appendChild(el('span', 'ws-side__sectioncount', `${ratedAll}/${problems.length}`));
  root.appendChild(section);
  const listHost = el('div', 'ws-bank__list');
  root.appendChild(listHost);

  const paint = () => {
    listHost.replaceChildren();
    const groups = new Map<string, WorksheetItemSummary[]>();
    for (const it of problems) { if (!groups.has(it.paper)) groups.set(it.paper, []); groups.get(it.paper)!.push(it); }
    for (const key of [...groups.keys()].sort((a, b) => paperLabel(a).localeCompare(paperLabel(b)))) {
      const list = groups.get(key)!;
      const head = el('div', 'ws-bank__paper');
      head.setAttribute('role', 'button');
      head.appendChild(el('span', 'ws-bank__papername', paperLabel(key)));
      const easy = list.filter((it) => stateClass(it.attemptState) === 'easy').length;
      const medium = list.filter((it) => stateClass(it.attemptState) === 'medium').length;
      const hard = list.filter((it) => stateClass(it.attemptState) === 'hard').length;
      const bar = el('div', 'ws-bank__bar');
      bar.title = `${easy} Easy · ${medium} Medium · ${hard} Hard · ${list.length - easy - medium - hard} not rated`;
      for (const [cls, n] of [['easy', easy], ['medium', medium], ['hard', hard]] as const) {
        if (n === 0) continue;
        const seg = el('span', cls);
        seg.style.width = `${(n / list.length) * 100}%`;
        bar.appendChild(seg);
      }
      head.appendChild(bar);
      head.appendChild(el('span', 'ws-bank__count', `${easy + medium + hard}/${list.length}`));
      head.addEventListener('click', () => { if (_bankOpen.has(key)) _bankOpen.delete(key); else _bankOpen.add(key); paint(); });
      listHost.appendChild(head);
      if (!_bankOpen.has(key)) continue;
      const rows = el('div', 'ws-bank__items');
      for (const it of list) {
        const row = el('div', 'ws-bank__item');
        // A workbook rating is a ring until the problem is touched here;
        // worked without a rating of his own, it takes the in-progress dot,
        // never the workbook's colour.
        const dot = it.attemptState === 'open' || (it.ratingImported && it.worked) ? 'open'
          : it.ratingImported ? `${stateClass(it.attemptState)} ws-bank__dot--workbook`
            : stateClass(it.attemptState);
        row.appendChild(el('span', `ws-bank__dot ${dot}`));
        row.appendChild(el('span', 'ws-bank__itemtitle', it.title));
        const secs = it.seconds > 0 ? ` · ${fmtStudy(it.seconds)}` : '';
        const stateLabel = !it.attemptState ? 'Never tried'
          : it.attemptState === 'open' ? 'In Progress'
            : it.ratingImported ? `${gradeLabel(it.attemptState)} in your workbook${it.worked ? ', worked here' : ''}`
              : gradeLabel(it.attemptState);
        row.title = `${it.title} · ${stateLabel}${secs}`;
        row.addEventListener('click', () => void openWorksheet(`item:${it.id}`, it.title));
        rows.appendChild(row);
      }
      listHost.appendChild(rows);
    }
    if (generated.length > 0) {
      const head = el('div', 'ws-bank__paper ws-bank__paper--generated');
      head.setAttribute('role', 'button');
      head.appendChild(el('span', 'ws-bank__papername', 'Generated Items'));
      head.appendChild(el('span', 'ws-bank__count', String(generated.length)));
      head.title = 'Items generated from PDFs or pasted material, kept apart from the workbook. Opens the Problem Bank.';
      head.addEventListener('click', () => void openWorksheet('bank', 'Problem Bank'));
      listHost.appendChild(head);
    }
  };
  paint();
}
