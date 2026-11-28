// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 66: A PLAN — the tab
// ═══════════════════════════════════════════════════════════════════════════════
//
// One tab per plan ('plan-<planId>', titled with the plan's name). Top to
// bottom: the exam and the days left; the three plans side by side, each with
// its total and how far it is from the goal, the one he follows checked (the
// kit's segmented switch as cards: choosing one writes Following); hours per
// day for that plan and the phases in date order, each with its days and
// hours and, for a study phase with Items, whether its work fits (the other
// two plans one press away); the rules that disagree, named; then every day,
// a real table grouped by week (a <tbody> each, its first row the week), the
// ordinary day quiet, Rest, Catch-up and Holiday told apart in words and by
// shape, a day he changed marked Edited, today marked, Done beside Total for
// today and the days gone by (under a tenth of an hour in minutes). Days he kept outside the dates are listed after it. The
// tab draws what 29-plans.js last worked out, and again only when that
// differs; the control that had the focus has it again.

/** The plan whose tab was just asked for and has not taken the focus yet (0: none). */
let _stPlanFocusFor = 0;

/** Open a plan's tab and put the focus in it. */
async function stOpenPlan(planId) {
  // A place: the core puts the keys on its title.
  if (stPlacesOn()) return stOpenPane({ view: 'plan', planId: Number(planId) || 0 });
  _stPlanFocusFor = Number(planId) || 0;
  const opened = await stOpenPane({ view: 'plan', planId: Number(planId) || 0 });
  const page = Array.from(document.querySelectorAll('.st-plan')).find((n) => n.isConnected && n.dataset.planId === String(planId));
  if (page) stPlanTakeFocus(planId, page.closest('.st-root'));
  return opened;
}

function stPlanTakeFocus(planId, root) {
  if (!root || _stPlanFocusFor !== Number(planId)) return;
  _stPlanFocusFor = 0;
  if (!root.contains(document.activeElement)) root.focus();
}

/** Open Plan: a plan ({ planId }, and { phaseId } to go to one of its phases); given a subject (its id or name, or nothing), the subject's plan shown in the sidebar, else his pick of its plans. */
async function stCmdOpenPlan(arg) {
  if (arg && typeof arg === 'object' && arg.planId) {
    const opened = await stOpenPlan(arg.planId);
    // With a phase too: its facts in the plan's list, in view and with the focus (a piece of the strip asks for this).
    const row = arg.phaseId == null ? null : Array.from(document.querySelectorAll('.st-plan')).filter((n) => n.dataset.planId === String(arg.planId)).flatMap((n) => Array.from(n.querySelectorAll('.st-plan__phase'))).find((n) => n.getAttribute('data-phase-id') === String(arg.phaseId));
    if (row) { row.scrollIntoView({ block: 'center' }); row.focus(); }
    return opened;
  }
  const named = arg != null && arg !== '' && typeof arg !== 'object';
  const subject = named ? stSubjectsShown().find((s) => s.id === Number(arg) || stSubjectSameName(s.name, arg)) : null;
  if (named && !subject) { await _api.window.showInformationMessage('That subject is not in Study.'); return null; }
  const all = [..._stPlans.values()].filter((st) => !subject || Number(st.plan.subjectId) === subject.id);
  if (!all.length) { await _api.window.showInformationMessage('No plans yet. New Plan… makes one for a subject.'); return null; }
  if (subject) { const { shown } = stPlansOfSubject(subject.id); if (shown) return stOpenPlan(shown.plan.id); }
  if (all.length === 1) return stOpenPlan(all[0].plan.id);
  const pick = await _api.window.showQuickPick(all.map((st) => ({ label: st.plan.name, description: st.rules && st.rules.exam ? `Exam ${stPlanDateWords(st.rules.exam, { year: true })}` : '', id: st.plan.id })), { placeholder: 'Open which plan?' });
  return pick ? stOpenPlan(pick.id) : null;
}

/** The words of a Type, and its class. */
const stPlanTypeClass = (type) => `st-plan__type--${String(type || 'none').toLowerCase().replace(/[^a-z]+/g, '')}`;
/** A phase's kind as an icon, on the strip. */
const ST_PLAN_KIND_ICONS = { Study: 'book-open', Rest: 'moon', 'Catch-up': 'rotate-ccw', Holiday: 'sun' };
/** Hours in a cell: a quiet dash for none. */
const stPlanCellHours = (n) => (n ? stPlanH(n) : '–');

async function renderPlan(host, route, ctx) {
  const ui = _api.ui;
  const planId = Number(route.planId) || 0;
  const page = ui.createBlock(host, 'div', { className: 'st-plan', attrs: { 'data-plan-id': String(planId) } });
  const inner = ui.createBlock(page, 'div', { className: 'st-plan__in' });
  const st0 = _stPlans.get(planId);
  if (!st0) {
    // A tab that came back with the app is drawn before Study has read its plans: it waits, and says so only when Study does not have it.
    ctx.add(onDataChanged(() => { if (_stPlans.get(planId)) ctx.rerender(); }));
    const kept = await db.get('SELECT id FROM st_plans WHERE id = ?', [planId]).catch(() => null);
    if (!kept && !ctx.disposed()) ui.createEmptyState(inner, { icon: 'calendar', headline: 'This plan is no longer in Study.', hint: 'Its subject was removed. The page and its databases are where they were.', action: { label: 'Close', command: ST_CLOSE_TAB } });
    return;
  }
  const plan = st0.plan;
  const head = ui.createBlock(inner, 'div', { className: 'st-plan__head' });
  const opens = ui.createBlock(inner, 'div', { className: 'st-plan__opens', attrs: { role: 'group', 'aria-label': 'The plan\'s databases' } });
  for (const [label, key] of [['Open Days', 'daysDb'], ['Open Week', 'weekDb'], ['Open Phases', 'phasesDb'], ['Open Plan Settings', 'planDb']]) {
    ui.createButton(opens, { id: `study.plan.${key}`, label, icon: 'database', kind: 'ghost', size: 'sm', title: `${label.replace('Open ', 'Open the ')} database.`, command: 'canvas.openPage', args: [plan[key]] });
  }
  // Said by the rules' own buttons: a change to Week, Phases or the dates never rewrites a day gone by.
  ui.createBlock(inner, 'div', { className: 'st-plan__applies', text: 'Changes apply from today on. A day gone by keeps the Type, Phase and hours it had.' });
  const body = ui.createBlock(inner, 'div', { className: 'st-plan__body' });
  const expanded = new Set();
  const editedNoteId = `st-plan-edited-${planId}`;
  let parts = [];
  let drawn = '';

  const header = (st, view) => {
    head.replaceChildren();
    const subject = stSubjectsShown().find((s) => s.id === Number(plan.subjectId));
    const sub = view && view.exam ? [subject ? subject.name : '', `Exam ${stPlanDateWords(view.exam, { year: true, long: true })}`].filter(Boolean).join(' · ') : (subject ? subject.name : '');
    ui.createPageHeader(head, { title: plan.name, ...(sub ? { subtitle: sub } : {}) });
    // The days left: the one large number of the page, at the title's right.
    if (!view || view.daysLeft === null) return;
    const left = ui.createBlock(head, 'div', { className: 'st-plan__left' });
    if (view.daysLeft > 0) {
      ui.createBlock(left, 'span', { className: 'st-plan__leftn', text: String(view.daysLeft) });
      left.appendChild(document.createTextNode(' '));
      ui.createBlock(left, 'span', { className: 'st-plan__leftw', text: `${view.daysLeft === 1 ? 'day' : 'days'} left` });
    } else ui.createBlock(left, 'span', { className: 'st-plan__leftw', text: view.daysLeft === 0 ? 'The exam is today' : 'The exam has passed' });
  };

  const section = (label, className) => {
    const box = ui.createBlock(body, 'section', { className: `st-plan__sec ${className || ''}`, attrs: { 'aria-label': label } });
    ui.createBlock(box, 'div', { className: 'st-plan__h', text: label, attrs: { role: 'heading', 'aria-level': '2' } });
    return box;
  };

  function paint() {
    if (ctx.disposed()) return;
    const st = _stPlans.get(planId);
    if (!st) { ctx.rerender(); return; }
    const today = stPlanToday();
    const view = st.rules ? stPlanView(st.rules, st.days, { today, outside: st.outside, done: st.done, pace: st.pace }) : null;
    const key = JSON.stringify([today, st.problem, st.synced, view, [...expanded]]);
    if (key === drawn) return;
    drawn = key;
    const active = document.activeElement;
    const focusedId = body.contains(active) ? (active.closest('[data-px-id]') || active).getAttribute('data-px-id') : '';
    const focusedValue = body.contains(active) ? active.getAttribute('data-value') || '' : '';
    const scroll = page.scrollTop;
    for (const p of parts) p.dispose();
    parts = [];
    body.replaceChildren();
    header(st, view);
    if (st.problem) {
      ui.createEmptyState(body, { icon: 'calendar', headline: st.problem, hint: 'The plan\'s page and the other databases stay as they are.' });
      return;
    }
    if (!st.synced || !view) { ui.createBlock(body, 'div', { className: 'st-plan__wait', text: 'Working out the days…' }); return; }

    // The three plans, side by side: choosing one writes Following.
    const plans = section('The three plans', 'st-plan__plans');
    if (view.goal > 0) ui.createBlock(plans, 'div', { className: 'st-plan__goal', text: `The goal is ${stPlanH(view.goal)} h. Choose the plan you follow; the days below are its hours.` });
    else ui.createBlock(plans, 'div', { className: 'st-plan__goal', text: 'Choose the plan you follow; the days below are its hours.' });
    const chooser = ui.createSegmented(plans, {
      id: 'study.plan.following', ariaLabel: 'The plan you follow', value: view.following,
      items: view.plans.map((p) => ({ value: p.plan, label: p.following ? `${p.plan} · Following` : p.plan, detail: [`${stPlanH(p.total)} h`, ...(view.goal > 0 ? [stPlanGoalWords(p.total, view.goal)] : [])] })),
      onChange: (value) => { void stPlanSetFollowing(planId, value).catch((err) => { if (!stIsStopped(err)) console.warn('[Study] the plan you follow could not be written:', err && err.message); }); },
    });
    parts.push(chooser);
    const planWords = ui.createBlock(plans, 'div', { className: 'st-plan__words' });
    for (const line of ST_PLAN_WORDS.plans) ui.createBlock(planWords, 'div', { text: line });

    phaseStrip(view, today);
    const pair = ui.createBlock(body, 'div', { className: 'st-plan__pair' });
    // Hours per day for the plan he follows, as a small bar each.
    const perDay = ui.createBlock(pair, 'section', { className: 'st-plan__sec st-plan__perday', attrs: { 'aria-label': 'Hours per day' } });
    ui.createBlock(perDay, 'div', { className: 'st-plan__h', text: 'Hours per day', attrs: { role: 'heading', 'aria-level': '2' } });
    const most = Math.max(1, ...view.perDay.map((r) => r.days));
    const list = ui.createBlock(perDay, 'ul', { className: 'st-plan__bars' });
    for (const r of view.perDay) {
      const li = ui.createBlock(list, 'li', { className: 'st-plan__barrow' });
      ui.createBlock(li, 'span', { className: 'st-plan__barh', text: `${stPlanH(r.hours)} h` });
      const track = ui.createBlock(li, 'span', { className: 'st-plan__track', attrs: { 'aria-hidden': 'true' } });
      ui.createBlock(track, 'span', { className: 'st-plan__fill', attrs: { style: `width: ${Math.round((r.days / most) * 100)}%` } });
      ui.createBlock(li, 'span', { className: 'st-plan__bard', text: `${r.days} ${r.days === 1 ? 'day' : 'days'}` });
    }
    ui.createBlock(perDay, 'div', { className: 'st-plan__note', text: `${view.studyDays} study ${view.studyDays === 1 ? 'day' : 'days'} · ${view.allDays} days in all, in the ${view.following} plan.` });

    // The phases in date order.
    const phases = ui.createBlock(pair, 'section', { className: 'st-plan__sec st-plan__phases', attrs: { 'aria-label': 'Phases' } });
    ui.createBlock(phases, 'div', { className: 'st-plan__h', text: 'Phases', attrs: { role: 'heading', 'aria-level': '2' } });
    // What the kinds other than Study do to a day's hours.
    const kindWords = ui.createBlock(phases, 'div', { className: 'st-plan__words' });
    for (const line of ST_PLAN_WORDS.kinds) ui.createBlock(kindWords, 'div', { text: line });
    const ol = ui.createBlock(phases, 'ol', { className: 'st-plan__plist' });
    if (!view.phases.length) ui.createBlock(phases, 'div', { className: 'st-plan__note', text: 'No phases yet. Add rows to Phases: study spans, rest, catch-up days, holidays.' });
    for (const p of view.phases) {
      const li = ui.createBlock(ol, 'li', { className: `st-plan__phase${p.fit && p.fit.short.includes(view.following) ? ' st-plan__phase--short' : ''}`, attrs: { 'data-phase-id': String(p.id), tabindex: '-1' } });
      const line = ui.createBlock(li, 'div', { className: 'st-plan__pline' });
      ui.createBlock(line, 'span', { className: 'st-plan__pname', text: p.name || 'A row with no name' });
      ui.createBlock(line, 'span', { className: `st-plan__kind ${stPlanTypeClass(p.kind)}`, text: p.kind || 'No kind' });
      const follows = p.follows === 'Whole plan' ? 'follows the plan\'s dates' : p.follows === 'Before exam' ? 'moves with the exam' : '';
      ui.createBlock(li, 'div', { className: 'st-plan__pfacts', text: [p.valid ? stPlanSpanWords(p.start, p.end) : 'No dates', `${p.days} ${p.days === 1 ? 'day' : 'days'}`, `${stPlanH(p.hours)} h`, ...(follows ? [follows] : [])].join(' · ') });
      if (!p.fit) continue;
      const fit = ui.createBlock(li, 'div', { className: 'st-plan__fit' });
      const short = p.fit.short.includes(view.following);
      const said = stPlanFitWords(p.fit, p.per[view.following]);
      ui.createBlock(fit, 'span', { className: short ? 'st-plan__needs' : 'st-plan__fits', text: said.charAt(0).toUpperCase() + said.slice(1) });
      const open = expanded.has(p.id);
      // A switch: the three plans' fit shown or not, kept while the tab is open; Escape on it hides them.
      const pairBox = ui.createBlock(fit, 'span', { className: 'st-plan__fitall' });
      const all = ui.createToggle(pairBox, { id: `study.plan.fit.${p.id}`, label: `All plans for ${p.name || 'this phase'}`, checked: open, onChange: (on) => { if (on) expanded.add(p.id); else expanded.delete(p.id); paint(); } });
      parts.push(all);
      ui.createBlock(pairBox, 'span', { text: 'All plans', attrs: { 'aria-hidden': 'true' } });
      all.element.addEventListener('keydown', (e) => { if (e.key === 'Escape' && expanded.has(p.id)) { e.preventDefault(); e.stopPropagation(); expanded.delete(p.id); paint(); } });
      if (open) {
        const all = ui.createBlock(li, 'div', { className: 'st-plan__all' });
        for (const pl of ST_PLAN_PLANS) ui.createBlock(all, 'span', { text: `${pl} ${stPlanFitWords(p.fit, p.per[pl])}` });
      }
      // His measured pace from the Work Log, beside the minutes per item he gave the phase.
      if (p.fit.measured) ui.createBlock(li, 'div', { className: `st-plan__pace ${p.fit.measured.short.includes(view.following) ? 'st-plan__needs' : 'st-plan__fits'}`, text: stPlanPaceWords(p.fit.measured, p.per[view.following]) });
    }

    // The rules that disagree, each named.
    if (view.contradictions.length) {
      const bad = section('Rules that disagree', 'st-plan__bad');
      const ul = ui.createBlock(bad, 'ul', { className: 'st-plan__badlist' });
      for (const c of view.contradictions) ui.createBlock(ul, 'li', { text: c.text });
    }

    dayTable(view);
    if (view.outside.length) outsideTable(view);

    page.scrollTop = scroll;
    if (focusedId) {
      const again = Array.from(body.querySelectorAll('[data-px-id]')).find((n) => n.getAttribute('data-px-id') === focusedId);
      const target = again && focusedValue ? again.querySelector(`[data-value="${CSS.escape(focusedValue)}"]`) || again : again;
      const checked = again && !focusedValue ? null : again && again.querySelector('[aria-checked="true"]');
      if (target && typeof target.focus === 'function') (checked && focusedValue && !again.querySelector(`[data-value="${CSS.escape(focusedValue)}"]`) ? checked : target).focus();
    }
  }

  /**
   * The phases as one strip from the start to the exam: each as wide as its
   * share of the days, the one today is in filled, one whose work does not
   * fit edged in the danger colour. A press goes to that phase's facts below.
   */
  function phaseStrip(view, today) {
    const dated = view.phases.filter((p) => p.valid && p.days > 0);
    if (!dated.length) return;
    const box = ui.createBlock(body, 'section', { className: 'st-plan__sec st-plan__stripsec', attrs: { 'aria-label': 'To the exam, by phase' } });
    ui.createBlock(box, 'div', { className: 'st-plan__h', text: 'To the exam, by phase', attrs: { role: 'heading', 'aria-level': '2' } });
    const strip = ui.createBlock(box, 'div', { className: 'st-plan__strip', attrs: { style: `grid-template-columns: ${dated.map((p) => `minmax(2.25rem, ${p.days}fr)`).join(' ')}` } });
    for (const p of dated) {
      const short = !!(p.fit && p.fit.short.includes(view.following));
      const now = today >= p.start && today <= p.end;
      const facts = `${stPlanSpanWords(p.start, p.end)} · ${p.days} ${p.days === 1 ? 'day' : 'days'} · ${stPlanH(p.hours)} h`;
      const said = [p.name || 'A row with no name', p.kind || 'No kind', facts, ...(now ? ['Today is in it'] : []), ...(short ? [stPlanFitWords(p.fit, p.per[view.following])] : [])].join(', ');
      // Its kind as an icon, so a piece too narrow for its name still says what it is.
      const b = ui.createButton(strip, { id: null, label: p.name || 'No name', icon: ST_PLAN_KIND_ICONS[p.kind] || 'calendar', kind: 'ghost', title: said, command: 'study.openPlan', args: [{ planId, phaseId: p.id }] });
      b.classList.add('st-plan__sphase', stPlanTypeClass(p.kind).replace('st-plan__type--', 'st-plan__sphase--'));
      if (now) b.classList.add('st-plan__sphase--now');
      if (short) b.classList.add('st-plan__sphase--short');
      b.setAttribute('aria-label', said);
      ui.createBlock(b, 'span', { className: 'st-plan__sfacts', text: short ? stPlanFitWords(p.fit, p.per[view.following]) : facts, attrs: { 'aria-hidden': 'true' } });
    }
  }

  /** Every day, a <tbody> per week: the week's own row first, then its days. */
  function dayTable(view) {
    const box = ui.createBlock(body, 'section', { className: 'st-plan__sec st-plan__days', attrs: { 'aria-label': 'Every day' } });
    const bar = ui.createBlock(box, 'div', { className: 'st-plan__daysbar' });
    ui.createBlock(bar, 'div', { className: 'st-plan__h', text: 'Every day', attrs: { role: 'heading', 'aria-level': '2' } });
    // Too wide for a narrow tab, it scrolls sideways on its own; named, so the browser's own Tab stop on a scroller says what it is.
    // What Edited means, in words on the tab, and each edited day's row described by it.
    const hourWords = ui.createBlock(box, 'div', { className: 'st-plan__words' });
    for (const line of ST_PLAN_WORDS.accounts) ui.createBlock(hourWords, 'div', { text: line });
    if (view.weeks.some((w) => w.days.some((d) => d.kept))) ui.createBlock(box, 'div', { className: 'st-plan__note', text: 'Edited: a day you changed in Days. It keeps what you gave it; untick Edited on a day still to come and it follows the rules again. A day gone by stays as it is.', attrs: { id: editedNoteId } });
    const scroller = ui.createBlock(box, 'div', { className: 'st-plan__scroll', attrs: { role: 'group', 'aria-label': 'Every day, by week' } });
    const table = ui.createBlock(scroller, 'table', { className: 'st-plan__table' });
    ui.createBlock(table, 'caption', { className: 'st-plan__cap', text: `Every day of ${plan.name}, ${stPlanSpanWords(view.start, stPlanAddDays(view.exam, -1))}, in the ${view.following} plan, by week` });
    const thead = ui.createBlock(table, 'thead');
    const hr = ui.createBlock(thead, 'tr');
    for (const [h, cls] of [['Date', ''], ['Type', ''], ['Phase', ''], ['Personal', 'n'], ['Work', 'n'], ['Total', 'n'], ['Done', 'n'], ['Running', 'n']]) ui.createBlock(hr, 'th', { className: cls ? `st-plan__${cls}` : '', text: h, attrs: { scope: 'col' } });
    for (const w of view.weeks) {
      const tb = ui.createBlock(table, 'tbody', { className: 'st-plan__week' });
      const wr = ui.createBlock(tb, 'tr', { className: 'st-plan__wkrow' });
      ui.createBlock(wr, 'th', { className: 'st-plan__wk', text: `Week ${w.n} · ${stPlanSpanWords(w.first, w.last)} · ${stPlanH(w.hours)} h`, attrs: { colspan: '8', scope: 'rowgroup' } });
      for (const d of w.days) dayRow(tb, d, view.following);
    }
  }

  function dayRow(tb, d, following) {
    const unusual = d.type && d.type !== 'Study';
    const tr = ui.createBlock(tb, 'tr', { className: ['st-plan__day', unusual ? `st-plan__day--${stPlanTypeClass(d.type).split('--')[1]}` : '', d.today ? 'st-plan__day--today' : '', d.kept ? 'st-plan__day--edited' : '', d.past ? 'st-plan__day--past' : ''].filter(Boolean).join(' '), attrs: { 'data-date': d.date, ...(d.today ? { 'aria-current': 'date' } : {}) } });
    const date = ui.createBlock(tr, 'th', { className: 'st-plan__date', attrs: { scope: 'row', ...(d.kept ? { 'aria-describedby': editedNoteId } : {}) } });
    ui.createBlock(date, 'span', { text: stPlanDateWords(d.date) });
    if (d.today) ui.createBlock(date, 'span', { className: 'st-plan__tag st-plan__tag--today', text: 'Today' });
    if (d.kept) ui.createBlock(date, 'span', { className: 'st-plan__tag', text: 'Edited' });
    const type = ui.createBlock(tr, 'td', { className: 'st-plan__tcell' });
    ui.createBlock(type, 'span', { className: `st-plan__type ${stPlanTypeClass(d.type)}`, text: d.type || '–' });
    ui.createBlock(tr, 'td', { className: 'st-plan__pcell', text: d.phase || '–' });
    ui.createBlock(tr, 'td', { className: 'st-plan__n', text: stPlanCellHours(d[following.toLowerCase()]) });
    ui.createBlock(tr, 'td', { className: 'st-plan__n', text: stPlanCellHours(d.work) });
    ui.createBlock(tr, 'td', { className: 'st-plan__n st-plan__total', text: stPlanCellHours(d.planned) });
    ui.createBlock(tr, 'td', { className: 'st-plan__n st-plan__done', text: (d.past || d.today) && d.done !== null ? stPlanDoneWords(d.done) : '' });
    ui.createBlock(tr, 'td', { className: 'st-plan__n st-plan__run', text: stPlanH(d.running) });
  }

  /** Days he changed whose dates the plan no longer holds: kept, listed apart. */
  function outsideTable(view) {
    const box = section('Outside the plan', 'st-plan__outside');
    ui.createBlock(box, 'div', { className: 'st-plan__note', text: 'Days you changed whose dates the plan no longer holds. They stay in Days as you left them, and come back when the dates do.' });
    const table = ui.createBlock(box, 'table', { className: 'st-plan__table st-plan__table--outside' });
    ui.createBlock(table, 'caption', { className: 'st-plan__cap', text: 'Days outside the plan' });
    const hr = ui.createBlock(ui.createBlock(table, 'thead'), 'tr');
    for (const h of ['Date', 'Type', 'Phase', 'Personal', 'Work']) ui.createBlock(hr, 'th', { text: h, attrs: { scope: 'col' } });
    const tb = ui.createBlock(table, 'tbody');
    for (const o of view.outside) {
      const tr = ui.createBlock(tb, 'tr', { attrs: { 'data-date': o.date } });
      ui.createBlock(tr, 'th', { text: stPlanDateWords(o.date, { year: true }), attrs: { scope: 'row' } });
      ui.createBlock(tr, 'td', { text: o.type || '–' });
      ui.createBlock(tr, 'td', { text: o.phase || '–' });
      ui.createBlock(tr, 'td', { className: 'st-plan__n', text: stPlanCellHours(o[view.following.toLowerCase()]) });
      ui.createBlock(tr, 'td', { className: 'st-plan__n', text: stPlanCellHours(o.work) });
    }
  }

  let timer = 0;
  const later = () => { clearTimeout(timer); timer = setTimeout(paint, 20); };
  ctx.add(onDataChanged(later));
  // Today's row and the days left move at local midnight.
  ctx.add(stAtEachNewDay(later));
  ctx.add({ dispose: () => { clearTimeout(timer); for (const p of parts) p.dispose(); parts = []; } });
  paint();
  stPlanTakeFocus(planId, ctx.root);
}
