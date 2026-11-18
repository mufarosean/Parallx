// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 63: PROGRESS — the tab
// ═══════════════════════════════════════════════════════════════════════════════
//
// One tab per subject ('progress-<subjectId>', titled "<Subject> Progress"):
// the subject's totals per kind, then a row for every unit in the Units
// order with one bar per kind of work. Each bar is the kit's stacked bar
// (api.ui.createStackedBar), never Study's own: green, yellow, red and the
// rest, with "N of M" beside it. A part of a Questions bar starts the unit's
// setup on the questions in that state; a part of a tool's bar opens that
// tool on those items when the tool offers it. Under the rows, what a tool
// has that matched no unit. The tab redraws when a count changes (Study's
// own data, or a provider's event), only if what it shows differs, and the
// control that had the focus has it again. The arithmetic is
// 14-progress-model.js; the providers are 28-progress.js.

/** Progress is in order unless he chose weakest first (the setting study.progressSort). */
function stProgressSort() {
  return cfg('progressSort', 'order') === 'weakest' ? 'weakest' : 'order';
}

/** Remember the order he chose, for every Progress tab and the next start. */
function stProgressSetSort(value) {
  try {
    const config = _api.workspace.getConfiguration('study');
    if (config && typeof config.update === 'function') return Promise.resolve(config.update('progressSort', value)).catch(() => {});
  } catch { /* a host that keeps no settings: the choice lasts while the tab does */ }
  return Promise.resolve();
}

/** Open Progress…: a subject's Progress tab. With `where` ({ provider, groups, state }) it opens that tool on the items behind one part of a bar instead. */
async function stCmdOpenProgress(arg, where) {
  if (where && typeof where === 'object' && where.provider) return stProgressOpenItems(where.provider, where.groups, where.state);
  const s = await stPickSubject(arg, 'Progress of which subject?');
  if (!s) return null;
  return stOpenPane({ view: 'progress', subjectId: s.id });
}

/** The parts of a kit bar for `counts`. `act(state, i)` gives a part's command, or nothing for a plain part. */
function stProgressParts(owner, kind, counts, words, { idBase = '', act = null, action = '' } = {}) {
  return ST_PROGRESS_STATES.map((state, i) => {
    const word = stProgressWord(words, state);
    const run = act ? act(state, i) : null;
    const said = `${word.charAt(0).toUpperCase()}${word.slice(1)}: ${counts[i]}`;
    return {
      state, count: counts[i],
      label: stProgressPartName(owner, kind, word, counts[i], run ? action : ''),
      // The row and the column already say whose bar it is: the tooltip is the state and its count.
      title: run ? `${said}. ${action}` : said,
      ...(run ? { id: `${idBase}.${state}`, command: run.command, args: run.args } : {}),
    };
  });
}

async function renderProgress(host, route, ctx) {
  const subjectId = Number(route.subjectId) || 0;
  const ui = _api.ui;
  const page = ui.createBlock(host, 'div', { className: 'st-prog' });
  const inner = ui.createBlock(page, 'div', { className: 'st-prog__in' });
  const shownNow = () => stSubjectsShown().find((s) => s.id === subjectId) || null;
  const first = shownNow();
  const st = _stSubjects.get(subjectId);
  if (!first || !st) {
    // A tab that came back with the app is drawn before Study has read its subjects: it waits for this one, and says so only when Study does not have it at all.
    ctx.add(onDataChanged(() => { if (shownNow() && _stSubjects.get(subjectId)) ctx.rerender(); }));
    const kept = await db.get('SELECT id FROM st_subjects WHERE id = ?', [subjectId]).catch(() => null);
    if (!kept && !ctx.disposed()) ui.createEmptyState(inner, { icon: 'graduation-cap', headline: 'This subject is no longer in Study.', hint: 'It was removed. Its page and its databases are where they were.', action: { label: 'Close', command: ST_CLOSE_TAB } });
    return;
  }
  const subject = st.subject;
  const slug = (v) => (typeof ui.sceneSlug === 'function' ? ui.sceneSlug(String(v)) : String(v).toLowerCase().replace(/[^a-z0-9]+/g, '-'));
  ui.createPageHeader(inner, {
    title: `${subject.name} Progress`,
    more: [
      { label: 'Study…', icon: 'px-study', onSelect: () => void stOpenSetup({ bankIds: [subject.bankId] }) },
      { separator: true },
      { label: 'Open Units', icon: 'database', onSelect: () => void stOpenSubjectDatabase(subject.unitsDb) },
      { label: 'Open Questions', icon: 'database', onSelect: () => void stOpenSubjectDatabase(subject.questionsDb) },
    ],
  });
  const body = ui.createBlock(inner, 'div', { className: 'st-prog__body' });
  const top = ui.createBlock(body, 'div', { className: 'st-prog__top' });
  const bar = ui.createBlock(body, 'div', { className: 'st-prog__bar' });
  ui.createSectionLabel(bar, 'Units');
  ui.createBlock(bar, 'span', { className: 'st-sp' });
  let sort = stProgressSort();
  const order = ui.createSegmented(bar, {
    id: 'study.progress.sort', ariaLabel: 'Order of the units', value: sort,
    items: [{ value: 'order', label: 'In Order' }, { value: 'weakest', label: 'Weakest First' }],
    onChange: (value) => { sort = value === 'weakest' ? 'weakest' : 'order'; void stProgressSetSort(sort); paint(); },
  });
  ctx.add(order);
  const list = ui.createBlock(body, 'div', { className: 'st-prog__list' });
  const under = ui.createBlock(body, 'div', { className: 'st-prog__under' });

  let bars = [];
  let drawn = '';
  // Columns while each kind has room for a bar with its count (four parts a finger can press, and "N of M"); stacked under the name when not.
  let kinds = 0;
  const fit = () => { const w = list.clientWidth; list.classList.toggle('st-prog__list--stacked', w > 0 && w < 200 * (kinds + 1)); };
  if (typeof ResizeObserver === 'function') { const seen = new ResizeObserver(fit); seen.observe(list); ctx.add({ dispose: () => seen.disconnect() }); }
  const clear = () => { for (const b of bars) b.dispose(); bars = []; top.replaceChildren(); list.replaceChildren(); under.replaceChildren(); };
  const stacked = (into, options) => { const b = ui.createStackedBar(into, options); bars.push(b); return b; };
  /** One kind's bar with its "N of M": the cell of a row, or a line of the totals. */
  const cell = (into, kindName, options, counts) => {
    const box = ui.createBlock(into, 'div', { className: 'st-prog__cell' });
    ui.createBlock(box, 'span', { className: 'st-prog__kind', text: kindName });
    stacked(box, options);
    ui.createBlock(box, 'span', { className: 'st-prog__n', text: stProgressCountText(counts) });
    return box;
  };
  const says = (headline, hint, action) => {
    clear();
    bar.hidden = true;
    ui.createEmptyState(top, { icon: 'chart-column', headline, hint, ...(action ? { action } : {}) });
  };

  function paint() {
    if (ctx.disposed()) return;
    const s = shownNow();
    if (!s) { ctx.rerender(); return; }
    const view = s.problem || !s.ready ? null : stProgressOfSubject(subjectId);
    const key = JSON.stringify([s.problem, s.ready, sort, view]);
    if (key === drawn) return;
    drawn = key;
    const focused = body.contains(document.activeElement) ? document.activeElement.getAttribute('data-px-id') : '';
    const scroll = page.scrollTop;
    if (s.problem) {
      const inTrash = /in the Trash/.test(s.problem);
      says(s.problem, inTrash ? 'Restore it from the Trash and its progress is here again, as it was.' : 'Study has nothing to count without it. Remove the subject, or put the database back.');
      return;
    }
    if (!view) { clear(); bar.hidden = true; return; }
    if (!view.kinds.length) {
      says('No questions yet.', 'Add rows to its Questions database, each with its unit, and the units show here as bars.', { id: 'study.progress.openQuestions', label: 'Open Questions', icon: 'database', command: 'canvas.openPage', args: [subject.questionsDb] });
      return;
    }
    clear();
    bar.hidden = false;
    order.value = sort;

    // The subject's totals, one line per kind, and the legend in words.
    const totals = ui.createBlock(top, 'div', { className: 'st-prog__totals' });
    for (const t of view.totals) {
      cell(totals, t.kind, { label: stProgressBarName('All units', t.kind, t.counts, t.words), parts: stProgressParts('All units', t.kind, t.counts, t.words) }, t.counts);
    }
    const legend = ui.createBlock(top, 'div', { className: 'st-prog__legend' });
    for (const state of ST_PROGRESS_STATES) {
      const item = ui.createBlock(legend, 'span', { className: 'st-prog__key' });
      ui.createBlock(item, 'span', { className: `st-prog__sw st-prog__sw--${state}`, attrs: { 'aria-hidden': 'true' } });
      ui.createBlock(item, 'span', { text: ST_PROGRESS_WORDS[state] });
    }

    // A row per unit: its name (the unit's setup, as in the sidebar), then one bar per kind.
    list.style.setProperty('--st-prog-kinds', String(view.kinds.length));
    kinds = view.kinds.length;
    fit();
    list.setAttribute('role', 'list');
    const head = ui.createBlock(list, 'div', { className: 'st-prog__row st-prog__row--head', attrs: { 'aria-hidden': 'true' } });
    ui.createBlock(head, 'span', { text: 'Unit' });
    for (const k of view.kinds) ui.createBlock(head, 'span', { text: k.kind });
    const rows = sort === 'weakest' ? stProgressWeakestFirst(view.rows) : view.rows;
    for (const row of rows) {
      const line = ui.createBlock(list, 'div', { className: 'st-prog__row', attrs: { role: 'listitem' } });
      const done = row.all[3] === 0 && row.all[0] + row.all[1] + row.all[2] > 0;
      const started = row.all[0] + row.all[1] + row.all[2] > 0;
      const name = ui.createButton(line, { id: `study.progress.unit.${row.rowId}`, label: row.name, icon: done ? 'circle-check' : started ? 'circle-dot' : 'circle', kind: 'ghost', size: 'sm',
        title: `Study ${row.name}`, command: 'study.studySubject', args: [subjectId, row.name] });
      name.classList.add('st-prog__name');
      if (done) name.classList.add('st-prog__name--done');
      for (const k of view.kinds) {
        const own = row.kinds.find((x) => x.id === k.id);
        if (!own) { ui.createBlock(line, 'div', { className: 'st-prog__cell st-prog__cell--none', attrs: { 'aria-hidden': 'true' } }); continue; }
        const idBase = `study.progress.part.${row.rowId}.${slug(k.id)}`;
        const mine = own.id === ST_PROGRESS_QUESTIONS;
        const act = !own.canOpen ? null : mine
          ? (state) => ({ command: 'study.studySubject', args: [subjectId, row.name, state] })
          : (state) => ({ command: 'study.openProgress', args: [subjectId, { provider: own.id, groups: own.groups.map((g) => g.group), state }] });
        cell(line, own.kind, { label: stProgressBarName(row.name, own.kind, own.counts, own.words), parts: stProgressParts(row.name, own.kind, own.counts, own.words, { idBase, act, action: mine ? 'Study these' : 'Open these' }) }, own.counts);
      }
      if (!row.kinds.length) line.classList.add('st-prog__row--none');
    }

    // What a tool has that no unit claims, and the questions that name no unit: said, not dropped.
    for (const u of view.unmatched) ui.createBlock(under, 'div', { className: 'st-prog__loose', text: stProgressUnmatchedText(u.kind, u.groups) });
    if (view.unmatched.length) {
      const hint = ui.createBlock(under, 'div', { className: 'st-prog__hint' });
      ui.createBlock(hint, 'span', { text: 'To match one, add its name to Also Called in Units, on the row of the unit it belongs to. Commas separate several.' });
      ui.createButton(hint, { id: 'study.progress.openUnits', label: 'Open Units', icon: 'database', kind: 'ghost', size: 'sm', command: 'canvas.openPage', args: [subject.unitsDb] });
    }
    if (view.noUnit) ui.createBlock(under, 'div', { className: 'st-prog__loose', text: `${view.noUnit} ${view.noUnit === 1 ? 'question names' : 'questions name'} no unit. Give each its unit in Questions and it joins that unit's bar.` });

    page.scrollTop = scroll;
    if (focused) {
      const again = Array.from(body.querySelectorAll('[data-px-id]')).find((n) => n.getAttribute('data-px-id') === focused);
      if (again) again.focus();
    }
  }

  let timer = 0;
  const later = () => { clearTimeout(timer); timer = setTimeout(paint, 30); };
  ctx.add(onDataChanged(later));
  ctx.add(bus.on('progress', later));
  ctx.add({ dispose: () => { clearTimeout(timer); clear(); } });
  stProgressWant();
  paint();
}
