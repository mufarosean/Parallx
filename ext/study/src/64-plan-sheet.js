// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 64: NEW PLAN — the sheet that makes a plan
// ═══════════════════════════════════════════════════════════════════════════════
//
// The New Subject sheet's frame (stSheetFrame: a dialog, Tab kept inside,
// Escape closes, the focus back to what opened it): Name, Exam date, Start
// date, Hours goal, and the usual week of the Standard plan, a personal and a
// work field for each weekday, then how many hours less a study day is on the
// Floor and how many more on the Stretch. Under the week, as he types, what
// that week comes to in each plan over the stretch, worked out by the same
// arithmetic as the plan's days (13-plan-model.js). Create makes the plan
// (29-plans.js) and opens its tab; an exam on or before the start is refused
// in words, and nothing is made.

/** The New Plan sheet on screen: its form, and what its Create does. */
let _stPlanSheet = null;

/**
 * New Plan…: the sheet for a subject (its id or name, else the only one, else
 * his pick). Given the sheet's own form, its Create; given what the sheet asks
 * ({ subject or subjectId, name, start, exam, goal, personal, work, less,
 * more }: a script or the audits), the plan is made without it.
 */
async function stCmdNewPlan(arg) {
  if (_stPlanSheet && arg === _stPlanSheet.form) return _stPlanSheet.create();
  if (arg && typeof arg === 'object' && arg.start && arg.exam) {
    const s = arg.subjectId ? null : await stPickSubject(arg.subject, 'A plan for which subject?');
    if (!arg.subjectId && !s) return null;
    const plan = await stCreatePlan({ ...arg, subjectId: arg.subjectId || s.id });
    await stOpenPlan(plan.id);
    return plan.id;
  }
  const s = await stPickSubject(arg, 'A plan for which subject?');
  if (!s) return null;
  stNoteSheetOpener();
  return stOpenPane({ view: 'newPlan', subjectId: s.id });
}

/** What the week of the form comes to over its dates: { Floor, Standard, Stretch, days }, or null while the dates do not make a stretch. */
function stPlanFormTotals(form) {
  const rules = stPlanRules({
    plan: { 'Start Date': form.start, 'Exam Date': form.exam, Following: 'Standard' },
    week: stPlanWeekRowsOf(form).map((r, i) => ({ pageId: String(i), title: r.title, values: r.values })),
    phases: [],
  });
  if (!stPlanHasStretch(rules)) return null;
  const days = stPlanDays(rules);
  return { ...stPlanTotals(days), days: days.length };
}

async function renderNewPlan(host, route, ctx) {
  const ui = _api.ui;
  const subjectId = Number(route.subjectId) || 0;
  const subject = await db.get('SELECT id, name FROM st_subjects WHERE id = ?', [subjectId]).catch(() => null);
  if (ctx.disposed()) return;
  if (!subject || !stSubjectDoor()) {
    ui.createEmptyState(host, { icon: 'calendar', headline: !subject ? 'This subject is no longer in Study.' : 'Plans need canvas databases.', hint: !subject ? 'Choose New Plan… on a subject that is.' : 'This version of Parallx does not offer them to Study.', action: { label: 'Close', command: ST_CLOSE_TAB } });
    return;
  }
  const form = { subjectId, name: '', exam: '', start: stPlanToday(), goal: '', personal: {}, work: {}, less: 1, more: 1, busy: false };
  const actions = { form, create: () => create() };
  _stPlanSheet = actions;
  ctx.add({ dispose: () => { if (_stPlanSheet === actions) _stPlanSheet = null; if (form.made) _stSubjectOpener = null; } });

  const { sheet, bd } = stSheetFrame(host, ctx, `For ${subject.name}: the dates, the goal and the week you usually have.`, { title: 'New Plan' });
  sheet.classList.add('st-psheet');
  bd.classList.add('st-subj');
  const inputs = [];
  const field = (label, { hint = '' } = {}) => {
    const row = ui.createBlock(bd, 'div', { className: 'st-subj__row' });
    ui.createBlock(row, 'span', { className: 'st-row__lab', text: label });
    const cell = ui.createBlock(row, 'div', { className: 'st-subj__cell' });
    const said = ui.createBlock(row, 'div', { className: 'st-subj__hint', text: hint });
    return { cell, said };
  };
  const input = (into, options, onInput) => {
    const box = ui.createInput(into, options);
    ctx.add(box);
    const el = box.element.querySelector('input');
    if (el) el.addEventListener('input', () => { onInput(box.value); refresh(); });
    inputs.push(el);
    return box;
  };

  const name = input(field('Name').cell, { id: 'study.plan.name', label: 'Name', placeholder: 'For example, Spring 2027' }, (v) => { form.name = v; });
  const dateField = (label, key, id, example) => {
    const f = field(label);
    input(f.cell, { id, label, placeholder: `YYYY-MM-DD, for example ${example}`, value: form[key] }, (v) => { form[key] = String(v).trim(); });
    return f.said;
  };
  const examSaid = dateField('Exam date', 'exam', 'study.plan.exam', '2027-04-20');
  const startSaid = dateField('Start date', 'start', 'study.plan.start', '2026-12-07');
  input(field('Hours goal', { hint: 'The hours you want in all. Each plan says how far it is from them.' }).cell, { id: 'study.plan.goal', label: 'Hours goal', placeholder: 'For example, 500' }, (v) => { form.goal = v; });

  // The usual week: a column per weekday, the personal hours over the work hours, each field named for both.
  const weekBox = ui.createBlock(bd, 'div', { className: 'st-psheet__week', attrs: { role: 'group', 'aria-label': 'The usual week, in hours of the Standard plan' } });
  ui.createBlock(weekBox, 'div', { className: 'st-psheet__weekhd', text: 'The usual week, in hours of the Standard plan' });
  const grid = ui.createBlock(weekBox, 'div', { className: 'st-psheet__grid' });
  ui.createBlock(grid, 'span', { className: 'st-psheet__corner', attrs: { 'aria-hidden': 'true' } });
  for (const d of ST_PLAN_WEEKDAYS) ui.createBlock(grid, 'span', { className: 'st-psheet__day', text: d, attrs: { 'aria-hidden': 'true' } });
  for (const [account, key] of [['Personal', 'personal'], ['Work', 'work']]) {
    ui.createBlock(grid, 'span', { className: 'st-psheet__acct', text: account, attrs: { 'aria-hidden': 'true' } });
    ST_PLAN_WEEKDAYS.forEach((d, i) => {
      const cell = ui.createBlock(grid, 'div', { className: 'st-psheet__h' });
      input(cell, { id: `study.plan.${key}.${d.toLowerCase()}`, label: `${ST_PLAN_WEEKDAY_NAMES[i]}, ${account.toLowerCase()} hours`, placeholder: '0' }, (v) => { form[key][d] = v; });
    });
  }
  const spread = ui.createBlock(weekBox, 'div', { className: 'st-psheet__spread' });
  const lessBox = ui.createBlock(spread, 'div', { className: 'st-psheet__pair' });
  ui.createBlock(lessBox, 'span', { className: 'st-row__lab', text: 'Floor', attrs: { 'aria-hidden': 'true' } });
  input(lessBox, { id: 'study.plan.less', label: 'Floor: hours less on a study day', value: '1' }, (v) => { form.less = v; });
  ui.createBlock(lessBox, 'span', { className: 'st-subj__hint', text: 'hours less on a study day', attrs: { 'aria-hidden': 'true' } });
  const moreBox = ui.createBlock(spread, 'div', { className: 'st-psheet__pair' });
  ui.createBlock(moreBox, 'span', { className: 'st-row__lab', text: 'Stretch', attrs: { 'aria-hidden': 'true' } });
  input(moreBox, { id: 'study.plan.more', label: 'Stretch: hours more on a study day', value: '1' }, (v) => { form.more = v; });
  ui.createBlock(moreBox, 'span', { className: 'st-subj__hint', text: 'hours more on a study day', attrs: { 'aria-hidden': 'true' } });
  const sums = ui.createBlock(weekBox, 'div', { className: 'st-psheet__sums', attrs: { 'aria-live': 'polite' } });

  // Footer: what is wrong (when something is), Cancel, Create.
  const ft = ui.createBlock(sheet, 'div', { className: 'st-sheet__ft' });
  const problem = ui.createBlock(ft, 'div', { className: 'st-subj__problem', attrs: { role: 'alert' } });
  const say = (text) => { problem.textContent = text; };
  const acts = ui.createBlock(ft, 'span', { className: 'st-sheet__acts' });
  ui.createButton(acts, { id: 'study.plan.cancel', label: 'Cancel', kind: 'ghost', command: ST_CLOSE_TAB });
  const createBtn = ui.createButton(acts, { id: 'study.plan.create', label: 'Create', icon: 'plus', kind: 'primary', title: 'Make the plan\'s page and its four databases, and work out every day.', command: 'study.newPlan', args: [form] });

  /** The dates in words as they are typed, and what the week comes to. */
  function refresh() {
    const words = (iso) => (stPlanDateOf(iso) ? stPlanDateWords(iso, { year: true, long: true }) : '');
    examSaid.textContent = words(form.exam);
    startSaid.textContent = words(form.start);
    const t = stPlanFormTotals(form);
    sums.textContent = t ? `Over ${t.days} days: Floor ${stPlanH(t.Floor)} h, Standard ${stPlanH(t.Standard)} h, Stretch ${stPlanH(t.Stretch)} h. Rest, holidays and phases are rows you add after.` : 'Give both dates to see what this week comes to.';
    // Only the dates' problem is said as he types; the rest waits for Create.
    if (stPlanDateOf(form.exam) && stPlanDateOf(form.start) && form.exam <= form.start) say('The exam date must be after the start date.');
    else if (/exam date must be after/.test(problem.textContent)) say('');
  }

  async function create() {
    if (form.busy) return;
    const wrong = stPlanFormProblem(form);
    if (wrong) { say(wrong); return; }
    form.busy = true;
    createBtn.disabled = true;
    say('');
    try {
      const plan = await stCreatePlan(form);
      form.made = true;
      await ctx.closeTab();
      await stOpenPlan(plan.id);
    } catch (err) {
      form.busy = false;
      createBtn.disabled = false;
      if (!stIsStopped(err) && !ctx.disposed()) say(stSentence(stErrText(err)));
    }
  }

  // Enter in a field creates; Escape in one closes the sheet (the field takes both keys, so the sheet's own Escape never hears it).
  sheet.addEventListener('keydown', (e) => {
    if (e.isComposing || !e.target || e.target.tagName !== 'INPUT') return;
    if (e.key === 'Enter') { e.preventDefault(); void create(); }
    else if (e.key === 'Escape') { e.stopPropagation(); void ctx.closeTab(); }
  });
  refresh();
  const first = name.element.querySelector('input');
  setTimeout(() => { if (!ctx.disposed() && first && first.isConnected) first.focus(); }, 0);
}
