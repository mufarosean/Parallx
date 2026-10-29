// Worksheets: the quiz builder.

import { declareControl, sceneSlug } from '../../../ui/kit.js';
import { createButton, createEmptyState, createFilterChip, createIconButton, createPageHeader, createSectionLabel, createSegmented } from '../../../ui/kit.js';
import { listItems, type WorksheetItemSummary } from '../worksheetData.js';
import { paperLabel, SOURCE_LABELS, KIND_LABELS } from '../problemImport.js';
import { buildPracticeSet } from '../practiceSession.js';
import { BACK_TO_HOME, openWorksheet, startQuizWith } from '../actions.js';
import { state } from '../state.js';
import { STAR_HINT, el } from '../widgets.js';

/** The longest quiz the builder makes: a whole roster fits in one. */
const MAX_QUIZ = 500;

export function createPracticeConfigPane(container: HTMLElement) {
  const root = el('div', 'ws-pane ws-create ws-builder');
  container.appendChild(root);
  let disposed = false;
  const disposables: { dispose(): void }[] = [];

  createPageHeader(root, {
    back: BACK_TO_HOME,
    title: 'New Quiz',
    subtitle: 'Choose what to draw from. Every rating you give lands on the problem.',
  });

  // The workbook's Quiz Generator, as chips: which papers, which sources,
  // which kinds (several each), then one rating band and one starred choice.
  // Generated items stay out unless their source chip is on.
  const filters = { papers: new Set<string>(), sources: new Set<string>(), kinds: new Set<string>(), state: 'all', starred: 'any' as 'any' | 'starred' | 'unstarred' };
  let bank: WorksheetItemSummary[] = [];
  // A set handed over from the Dashboard or the bank (Due Now, Quiz These…):
  // the filters then narrow within it, and the From chip says where it came
  // from until cleared.
  let presetIds: Set<number> | null = null;
  let presetName = '';
  const pool = (): WorksheetItemSummary[] => (presetIds ? bank.filter((it) => presetIds!.has(it.id)) : bank);

  const grid = el('div', 'ws-builder__grid');
  const left = el('div', 'ws-builder__filters');
  const side = el('div', 'ws-builder__side');
  grid.append(left, side);
  root.appendChild(grid);
  const group = (label: string) => {
    const g = el('div', 'ws-builder__group');
    createSectionLabel(g, label);
    const host = el('div', 'ws-chips');
    host.setAttribute('role', 'group');
    host.setAttribute('aria-label', label);
    g.appendChild(host);
    left.appendChild(g);
    return { g, host };
  };
  const from = group('From');
  const papers = group('Papers');
  const sources = group('Sources');
  const kinds = group('Kinds');
  const ratingGroup = group('Rating');
  const starGroup = group('Starred');
  left.appendChild(el('div', 'ws-hint', 'No chip on in a group means every one in it.'));

  // The side card: what you will get, and how.
  side.appendChild(el('div', 'ws-builder__label', 'Matching problems'));
  const bigCount = el('div', 'ws-builder__count', '0');
  const breakdown = el('div', 'ws-hint');
  side.append(bigCount, breakdown);
  const lenLabel = el('label', 'ws-builder__field');
  lenLabel.appendChild(el('span', 'ws-builder__fieldlabel', 'Length'));
  const stepper = el('div', 'ws-stepper');
  const countIn = el('input', 'ws-stepper__value') as HTMLInputElement;
  countIn.type = 'number'; countIn.min = '1'; countIn.max = String(MAX_QUIZ); countIn.value = '10';
  countIn.setAttribute('aria-label', 'Number of problems');
  declareControl(countIn, { id: 'worksheet.builder.length', label: 'Number of problems', kind: 'input', state: () => ({ kind: 'value', value: countIn.value }) });
  const ofLine = el('span', 'ws-hint');
  let matching = 0;
  const clampCount = () => {
    const n = Math.max(1, Math.min(Math.max(1, matching), parseInt(countIn.value, 10) || 10));
    countIn.value = String(n);
  };
  const minus = createIconButton(stepper, { id: 'worksheet.practice.fewer', icon: 'minus', title: 'Fewer', size: 'sm', onClick: () => { countIn.value = String((parseInt(countIn.value, 10) || 1) - 1); clampCount(); } });
  stepper.appendChild(countIn);
  const plus = createIconButton(stepper, { id: 'worksheet.practice.more', icon: 'plus', title: 'More', size: 'sm', onClick: () => { countIn.value = String((parseInt(countIn.value, 10) || 0) + 1); clampCount(); } });
  void minus; void plus;
  countIn.addEventListener('change', clampCount);
  const lenRow = el('div', 'ws-builder__row');
  lenRow.append(stepper, ofLine);
  lenLabel.appendChild(lenRow);
  side.appendChild(lenLabel);
  const shuffleWrap = el('label', 'ws-builder__check') as HTMLLabelElement;
  const shuffleIn = el('input') as HTMLInputElement;
  shuffleIn.type = 'checkbox'; shuffleIn.checked = true;
  shuffleWrap.append(shuffleIn, document.createTextNode('Shuffle'));
  declareControl(shuffleIn, { id: 'worksheet.builder.shuffle', label: 'Shuffle', kind: 'toggle', state: () => ({ kind: 'pressed', value: shuffleIn.checked }) });
  side.appendChild(shuffleWrap);
  // The quiz's name: what Home lists it under, filled from the choices until you type one.
  const nameLabel = el('label', 'ws-builder__field');
  nameLabel.appendChild(el('span', 'ws-builder__fieldlabel', 'Name'));
  const nameIn = el('input', 'ws-input') as HTMLInputElement;
  nameIn.type = 'text';
  nameIn.maxLength = 80;
  nameIn.title = 'The quiz is saved under this name and listed on Home until you complete it.';
  let nameEdited = false;
  nameIn.addEventListener('input', () => { nameEdited = nameIn.value.trim().length > 0; });
  declareControl(nameIn, { id: 'worksheet.builder.name', label: 'Quiz name', kind: 'input', hint: nameIn.title, state: () => ({ kind: 'value', value: nameIn.value }) });
  nameLabel.appendChild(nameIn);
  side.appendChild(nameLabel);
  const startBtn = createButton(side, { id: 'worksheet.builder.start', label: 'Start Quiz', icon: 'play', kind: 'primary' });
  startBtn.classList.add('ws-builder__start');

  const filtersName = (): string => {
    const ps = [...filters.papers].map(paperLabel);
    const parts = [presetIds ? presetName : ps.length ? ps.join(', ') : 'All papers'];
    const STATE_WORDS: Record<string, string> = { incomplete: 'incomplete', unseen: 'never tried', easy: 'easy', medium: 'medium', hard: 'hard', struggling: 'medium or hard' };
    if (STATE_WORDS[filters.state]) parts.push(STATE_WORDS[filters.state]);
    if (filters.starred === 'starred') parts.push('starred');
    if (filters.starred === 'unstarred') parts.push('not starred');
    return parts.join(' · ');
  };
  const currentFilters = () => ({
    tags: [] as string[],
    papers: [...filters.papers],
    sources: [...filters.sources],
    kinds: [...filters.kinds],
    state: filters.state,
    starred: filters.starred,
    count: Math.max(1, parseInt(countIn.value, 10) || 10),
    shuffle: shuffleIn.checked,
  });

  const syncSide = () => {
    const ids = buildPracticeSet(pool(), { ...currentFilters(), count: 10_000, shuffle: false });
    matching = ids.length;
    bigCount.textContent = String(matching);
    const byPaper = new Map<string, number>();
    const byId = new Map(bank.map((it) => [it.id, it]));
    for (const id of ids) { const p = byId.get(id)?.paper ?? ''; byPaper.set(p, (byPaper.get(p) ?? 0) + 1); }
    breakdown.textContent = matching === 0 ? 'No problems match.' : [...byPaper.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([p, n]) => `${p ? paperLabel(p) : 'Generated'} ${n}`).join(' · ') + (byPaper.size > 4 ? ' · …' : '');
    countIn.max = String(Math.max(1, matching));
    if ((parseInt(countIn.value, 10) || 0) > matching && matching > 0) countIn.value = String(matching);
    ofLine.textContent = `of ${matching}`;
    startBtn.disabled = matching === 0;
    if (!nameEdited) nameIn.value = filtersName();
  };

  const multi = (key: string, host: HTMLElement, values: [string, string, number][], selected: Set<string>) => {
    host.replaceChildren();
    for (const [value, label, n] of values) {
      createFilterChip(host, { id: `worksheet.builder.${key}.${sceneSlug(value)}`, label, count: n, pressed: selected.has(value), onToggle: (on) => { if (on) selected.add(value); else selected.delete(value); syncSide(); } });
    }
    if (selected.size) {
      createButton(host, { id: `worksheet.builder.${key}.clear`, label: 'Clear', icon: 'x', kind: 'ghost', size: 'sm', onClick: () => { selected.clear(); renderFilters(); } });
    }
  };
  const renderFilters = () => {
    from.g.style.display = presetIds ? '' : 'none';
    from.host.replaceChildren();
    if (presetIds) {
      createFilterChip(from.host, { id: 'worksheet.practice.preset', label: presetName, count: pool().length, pressed: true, title: 'The set handed over. Clear chooses from the whole bank.', onToggle: () => { presetIds = null; presetName = ''; renderFilters(); } });
    }
    const count = (pick: (it: WorksheetItemSummary) => string) => {
      const m = new Map<string, number>();
      for (const it of bank) { const k = pick(it); if (k) m.set(k, (m.get(k) ?? 0) + 1); }
      return m;
    };
    multi('papers', papers.host, [...count((it) => it.paper).entries()].sort((a, b) => paperLabel(a[0]).localeCompare(paperLabel(b[0]))).map(([k, n]) => [k, paperLabel(k), n]), filters.papers);
    multi('sources', sources.host, [...count((it) => it.source || 'generated').entries()].map(([k, n]) => [k, SOURCE_LABELS[k] ?? (k === 'generated' ? 'Generated' : k), n] as [string, string, number]), filters.sources);
    multi('kinds', kinds.host, [...count((it) => it.kind).entries()].map(([k, n]) => [k, KIND_LABELS[k] ?? k, n] as [string, string, number]), filters.kinds);
    syncSide();
  };
  const renderSwitches = () => {
    // One rating band and one starred choice: switches, made once.
    const rating = createSegmented(ratingGroup.host, {
      id: 'worksheet.builder.rating',
      ariaLabel: 'Rating',
      items: [['all', 'Any'], ['unseen', 'Never tried'], ['incomplete', 'Incomplete'], ['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard'], ['struggling', 'Medium or hard']].map(([value, label]) => ({ value, label })),
      value: filters.state,
      onChange: (v) => { filters.state = v; syncSide(); },
    });
    const nStarred = bank.filter((it) => it.starred).length;
    const star = createSegmented(starGroup.host, {
      id: 'worksheet.builder.starred',
      ariaLabel: 'Starred',
      items: [{ value: 'any', label: 'Any' }, { value: 'starred', label: `Starred (${nStarred})` }, { value: 'unstarred', label: 'Not starred' }],
      value: filters.starred,
      onChange: (v) => {
        filters.starred = v as 'any' | 'starred' | 'unstarred';
        // Starred means all of them unless the length is lowered by hand.
        if (v === 'starred' && nStarred > 0) countIn.value = String(Math.min(MAX_QUIZ, nStarred));
        syncSide();
      },
    });
    star.element.title = STAR_HINT;
    disposables.push(rating, star);
  };

  countIn.addEventListener('input', () => { ofLine.textContent = `of ${matching}`; });

  startBtn.addEventListener('click', () => {
    clampCount();
    const ids = buildPracticeSet(pool(), currentFilters());
    if (ids.length === 0) return;
    startQuizWith(ids, 0, nameIn.value.trim() || filtersName());
  });

  void (async () => {
    bank = await listItems().catch(() => []);
    if (disposed) return;
    if (bank.length === 0) {
      grid.remove();
      createEmptyState(root, {
        icon: 'list-checks',
        headline: 'The bank is empty.',
        hint: 'Import your practice workbook first; a quiz draws from it.',
        action: { label: 'Import Workbook…', onClick: () => void openWorksheet('excel-import', 'Import Workbook') },
      });
      return;
    }
    // Generated items are left out until asked for, so a quiz is the workbook's problems by default.
    const realSources = new Set(bank.map((it) => it.source).filter(Boolean));
    if (realSources.size > 0 && bank.some((it) => !it.source)) for (const src of realSources) filters.sources.add(src);
    if (state.quizPreset) {
      for (const p of state.quizPreset.papers ?? []) filters.papers.add(p);
      if (state.quizPreset.state) filters.state = state.quizPreset.state;
      if (state.quizPreset.starred) filters.starred = state.quizPreset.starred;
      if (state.quizPreset.ids && state.quizPreset.ids.length) {
        presetIds = new Set(state.quizPreset.ids);
        presetName = state.quizPreset.name || 'Problem Bank selection';
        countIn.value = String(Math.min(MAX_QUIZ, state.quizPreset.ids.length));
      }
      state.quizPreset = null;
    }
    renderSwitches();
    renderFilters();
  })();

  return { dispose: () => { disposed = true; for (const d of disposables) d.dispose(); root.remove(); } };
}

