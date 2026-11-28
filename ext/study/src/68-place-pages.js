// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 68: THE PLACES' OWN PAGES — a subject, Weak Spots, Marked
// ═══════════════════════════════════════════════════════════════════════════════
//
// Three places that had no screen before (68-places.js). A subject: its
// header (Study…, its actions), its plan and Progress, then its units, each a
// link to the unit's place. Weak Spots and Marked: what they hold, listed,
// with Start Session at the header (the commands Study Weak Spots and Study
// Marked Questions, as before). They draw in the lists' quiet style of a
// unit's page (40-css.js), and draw again only when what they show changed.

/** A page of a place: the frame, its inner column, and the body under the header. */
function stPlacePage(host, className) {
  const ui = _api.ui;
  const page = ui.createBlock(host, 'div', { className: `st-place ${className}` });
  const inner = ui.createBlock(page, 'div', { className: 'st-place__in' });
  return { page, inner };
}

/** A group: its heading with its count, then a list; as a unit's page draws its groups. */
function stPlaceGroup(into, name, count) {
  const ui = _api.ui;
  const sec = ui.createBlock(into, 'section', { className: 'st-unit__sec' });
  const hd = ui.createBlock(sec, 'div', { className: 'st-unit__hd' });
  const h = ui.createBlock(hd, 'div', { className: 'st-unit__name', text: name, attrs: { role: 'heading', 'aria-level': '2' } });
  h.id = `st-place-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  sec.setAttribute('aria-labelledby', h.id);
  if (count != null) { h.appendChild(document.createTextNode(' ')); ui.createBlock(h, 'span', { className: 'st-unit__n', text: String(count) }); }
  const acts = ui.createBlock(hd, 'div', { className: 'st-unit__acts' });
  return { sec, acts, list: () => ui.createBlock(sec, 'div', { className: 'st-unit__list', attrs: { role: 'list' } }) };
}

/** One line of a list: its text and, faint after it, where it is from. */
function stPlaceLine(list, text, where) {
  const ui = _api.ui;
  const line = ui.createBlock(list, 'div', { className: 'st-unit__item st-place__line', attrs: { role: 'listitem' } });
  ui.createBlock(line, 'span', { className: 'st-place__text', text });
  if (where) ui.createBlock(line, 'span', { className: 'st-unit__where', text: where });
  return line;
}

/** Draw the page again when what it shows changed: `read()` gives what it shows, `draw(data)` draws it. */
async function stPlaceRedrawn(ctx, read, draw) {
  let drawn = '';
  const paint = async () => {
    const data = await read();
    if (ctx.disposed()) return;
    const key = JSON.stringify(data);
    if (key === drawn) return;
    drawn = key;
    draw(data);
  };
  ctx.add(onDataChanged(() => void paint().catch(() => {})));
  await paint();
}

/** A subject whose page came back with the app before Study read its subjects waits for it, and says so when it is gone. */
async function stPlaceWaitForSubject(inner, subjectId, ctx) {
  ctx.add(onDataChanged(() => { if (stPlaceSubject(subjectId)) ctx.rerender(); }));
  const kept = await db.get('SELECT id FROM st_subjects WHERE id = ?', [subjectId]).catch(() => null);
  if (!kept && !ctx.disposed()) _api.ui.createEmptyState(inner, { icon: 'graduation-cap', headline: 'This subject is no longer in Study.', hint: 'It was removed. Its page and its databases are where they were.', action: { label: 'Close', command: ST_CLOSE_TAB } });
}

// ── A subject ──────────────────────────────────────────────────────────────

async function renderSubject(host, route, ctx) {
  const ui = _api.ui;
  const subjectId = Number(route.subjectId) || 0;
  const { inner } = stPlacePage(host, 'st-subj');
  if (!stPlaceSubject(subjectId)) { await stPlaceWaitForSubject(inner, subjectId, ctx); return; }
  const head = ui.createBlock(inner, 'div', { className: 'st-place__head' });
  const body = ui.createBlock(inner, 'div', { className: 'st-unit__body' });
  await stPlaceRedrawn(ctx, async () => {
    const s = stPlaceSubject(subjectId);
    const { shown } = s ? stPlansOfSubject(s.id) : { shown: null };
    return s ? {
      name: s.name, answered: s.answered, total: s.total, problem: s.problem, ready: s.ready, folded: s.folded, plans: stPlansOfSubject(s.id).all.length,
      plan: shown ? { id: shown.plan.id, name: String(shown.plan.name), exam: (shown.rules && shown.rules.exam) || '' } : null,
      units: s.units.map((u) => [u.rowId, u.name, u.answered, u.total]),
    } : null;
  }, (d) => {
    if (!d) { ctx.rerender(); return; }
    const s = stPlaceSubject(subjectId);
    const focused = inner.contains(document.activeElement) ? document.activeElement.getAttribute('data-px-id') : '';
    const left = d.plan && d.plan.exam ? stPlanDaysBetween(stPlanToday(), d.plan.exam) : null;
    const sub = [d.problem || (d.ready ? `${d.answered} of ${d.total} questions answered` : ''), d.plan && d.plan.exam ? `exam ${stPlanDateWords(d.plan.exam, { year: true, long: true })}` : ''].filter(Boolean).join(' · ');
    // The header is drawn again with what changed (its subtitle, its menu: Open Plan, Show or Hide Units); the keys stay on its title.
    const onTitle = !!document.activeElement && document.activeElement.classList.contains('px-page-header__title') && head.contains(document.activeElement);
    head.replaceChildren();
    ui.createPageHeader(head, {
      title: d.name,
      ...(sub ? { subtitle: sub } : {}),
      primary: { id: 'study.subject.study', label: 'Study…', icon: 'px-study', title: `Study ${d.name}`, command: 'study.studySubject', args: [subjectId] },
      more: stSubjectMenuItems(s),
    });
    const title = head.querySelector('.px-page-header__title');
    if (onTitle && title) { title.tabIndex = -1; title.focus({ preventScroll: true }); }
    body.replaceChildren();

    // Its plan and its Progress: the two places inside it besides its units.
    const about = stPlaceGroup(body, 'Plan and progress', null);
    const list = about.list();
    if (d.plan) {
      const words = left === null ? '' : left === 0 ? 'exam today' : `${left} ${left === 1 ? 'day' : 'days'} left`;
      const line = ui.createBlock(list, 'div', { className: 'st-unit__item', attrs: { role: 'listitem' } });
      const btn = ui.createButton(line, { id: 'study.subject.plan', label: d.plan.name, icon: 'calendar', kind: 'ghost', size: 'sm', title: `Open the plan ${d.plan.name}${words ? `: ${words}` : ''}.`, command: 'study.openPlan', args: [{ planId: d.plan.id }] });
      btn.classList.add('st-unit__open');
      stPlaceLink(btn, { view: 'plan', planId: d.plan.id });
      if (words) ui.createBlock(line, 'span', { className: 'st-unit__where', text: words });
    } else if (stSubjectDoor()) {
      ui.createButton(about.acts, { id: 'study.subject.newPlan', label: 'New Plan…', icon: 'calendar-plus', kind: 'ghost', size: 'sm', title: `A plan for ${d.name}: its exam, its week and its phases.`, command: 'study.newPlan', args: [subjectId] });
    }
    if (!d.problem && d.ready) {
      const line = ui.createBlock(list, 'div', { className: 'st-unit__item', attrs: { role: 'listitem' } });
      const btn = ui.createButton(line, { id: 'study.subject.progress', label: 'Progress', icon: 'bar-chart-3', kind: 'ghost', size: 'sm', title: `What you know of ${d.name}, unit by unit.`, command: 'study.openProgress', args: [subjectId] });
      btn.classList.add('st-unit__open');
      stPlaceLink(btn, { view: 'progress', subjectId });
    }

    // Its units, each a place inside it.
    const units = stPlaceGroup(body, 'Units', d.units.length);
    ui.createButton(units.acts, { id: 'study.subject.openUnits', label: 'Open Units', icon: 'database', kind: 'ghost', size: 'sm', command: 'canvas.openPage', args: [s.subject.unitsDb] });
    if (!d.units.length) ui.createBlock(units.sec, 'div', { className: 'st-unit__none', text: 'No units yet. Add them in Open Units.' });
    else {
      const ul = units.list();
      for (const [rowId, name, answered, total] of d.units) {
        const line = ui.createBlock(ul, 'div', { className: 'st-unit__item', attrs: { role: 'listitem' } });
        const btn = ui.createButton(line, { id: `study.subject.unit.${rowId}`, label: name, icon: total > 0 && answered >= total ? 'circle-check' : answered > 0 ? 'circle-dot' : 'circle', kind: 'ghost', size: 'sm', title: `Open ${name}: ${answered} of ${total} questions answered.`, command: 'study.openUnit', args: [subjectId, rowId] });
        btn.classList.add('st-unit__open');
        stPlaceLink(btn, { view: 'unit', subjectId, rowId });
        ui.createBlock(line, 'span', { className: 'st-unit__where', text: `${answered} of ${total}` });
      }
    }
    if (focused) { const again = Array.from(inner.querySelectorAll('[data-px-id]')).find((n) => n.getAttribute('data-px-id') === focused); if (again) again.focus(); }
  });
}

// ── Weak Spots ─────────────────────────────────────────────────────────────

async function renderWeakSpots(host, route, ctx) {
  const ui = _api.ui;
  const { inner } = stPlacePage(host, 'st-weak');
  const head = ui.createBlock(inner, 'div', { className: 'st-place__head' });
  const body = ui.createBlock(inner, 'div', { className: 'st-unit__body' });
  await stPlaceRedrawn(ctx, async () => {
    const materials = (await stListMaterials()) || [];
    const concepts = materials.length ? (await stScopeConcepts({ kind: 'weak', materialIds: materials.map((m) => m.id), label: 'All materials' })) || [] : [];
    const labels = new Map(materials.map((m) => [Number(m.id), String(m.label || '')]));
    return {
      none: concepts.length ? '' : materials.length ? await stNoWeakSpotsText() : 'Add a material first: the concepts you miss in it show up here.',
      rows: concepts.map((c) => [c.title, labels.get(Number(c.materialId)) || '', c.state, Number(c.misses) || 0, Number(c.answers) || 0]),
    };
  }, (d) => {
    head.replaceChildren();
    const n = d.rows.length;
    ui.createPageHeader(head, {
      title: 'Weak Spots',
      subtitle: n ? `${n} ${n === 1 ? 'concept' : 'concepts'} weak or stale, across every material` : 'The concepts you miss, across every material',
      ...(n ? { primary: { id: 'study.weak.start', label: 'Start Session', icon: 'play', title: 'Study Weak Spots: one session over these concepts.', command: 'study.weakSpots', args: [{ start: true }] } } : {}),
    });
    body.replaceChildren();
    if (!n) { ui.createEmptyState(body, { icon: 'target', headline: 'No weak spots.', hint: d.none }); return; }
    const group = stPlaceGroup(body, 'Concepts', n);
    const list = group.list();
    for (const [title, material, state, misses, answers] of d.rows) {
      stPlaceLine(list, title, [material, state === 'stale' ? 'not answered lately' : `missed ${misses} of ${answers}`].filter(Boolean).join(' · '));
    }
  });
}

// ── Marked ─────────────────────────────────────────────────────────────────

async function renderMarked(host, route, ctx) {
  const ui = _api.ui;
  const { inner } = stPlacePage(host, 'st-marked');
  const head = ui.createBlock(inner, 'div', { className: 'st-place__head' });
  const body = ui.createBlock(inner, 'div', { className: 'st-unit__body' });
  await stPlaceRedrawn(ctx, async () => {
    const marked = (await stListMarkedQuestions()) || [];
    const materials = (await stListMaterials()) || [];
    const labels = new Map(materials.map((m) => [Number(m.id), String(m.label || '')]));
    return marked.map((q) => [stTruncate(String(q.stem || '').replace(/\s+/g, ' ').trim(), 160), labels.get(Number(q.materialId)) || q.originLabel || '', Number(q.sourcePage) || 0]);
  }, (rows) => {
    head.replaceChildren();
    const n = rows.length;
    ui.createPageHeader(head, {
      title: 'Marked',
      subtitle: n ? `${n} ${n === 1 ? 'question' : 'questions'} marked to come back to` : 'The questions you mark to come back to',
      ...(n ? { primary: { id: 'study.marked.start', label: 'Start Session', icon: 'play', title: 'Study Marked Questions: one session over exactly these.', command: 'study.studyMarked', args: [{ start: true }] } } : {}),
    });
    body.replaceChildren();
    if (!n) { ui.createEmptyState(body, { icon: 'bookmark', headline: 'Nothing is marked yet.', hint: 'Mark a question on its card to come back to it.' }); return; }
    const group = stPlaceGroup(body, 'Questions', n);
    const list = group.list();
    for (const [stem, from, page] of rows) stPlaceLine(list, stem, [from, page ? `p. ${page}` : ''].filter(Boolean).join(' · '));
  });
}
