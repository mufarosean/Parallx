// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 29: PLANS — the rules and the days, kept in canvas databases
// ═══════════════════════════════════════════════════════════════════════════════
//
// A plan (st_plans, migration study_006) names a canvas page under its
// subject's page and four databases under it: Plan (one row: the dates, the
// goal, the plan he follows), Week (a row per block of study time), Phases (a
// row per span of dates) and Days (a row per date, worked out). All of it goes
// through the core's door, api.canvas.databases. Whenever one of them changes,
// or the subject's Work Log does (Done), the plan is read again and Days is
// made to agree with the rules: only the cells that differ are written, all
// of them in one write (the door's updateRows), the days added or removed in
// one more. A day he changed is his (13-plan-model.js decides it from what
// Study last wrote there, st_plans.written_json): Study ticks Edited on it and
// never works it out again. One plan's work runs in order (a chain), and
// nothing is written while one of its databases is in the Trash or gone, or
// while its dates make no stretch. Everything running belongs to the
// activation and goes with it.

/** id → the live state of a plan: { plan, rules, days, outside, done, problem, synced, ... }. */
const _stPlans = new Map();

function stRowToPlan(row) {
  return {
    id: row.id, subjectId: row.subject_id, name: row.name, pageId: row.page_id || '',
    planDb: row.plan_db || '', weekDb: row.week_db || '', phasesDb: row.phases_db || '', daysDb: row.days_db || '',
    createdAt: row.created_at || 0,
  };
}

async function stListPlans() {
  return (await db.all('SELECT * FROM st_plans ORDER BY created_at, id')).map(stRowToPlan);
}

/**
 * The columns of a plan's four databases (each has its title column, "Name",
 * first), each with the width it opens at: narrow numbers and dates, so the
 * cells he types into (a block's hours, a day's hours and Edited) are on
 * screen in a tab beside the sidebar.
 */
function stPlanColumns() {
  const kept = (name, width) => ({ name, type: 'number', config: { computedBy: true }, width });
  const hours = (width) => ['Floor', 'Standard', 'Stretch'].map((name) => ({ name, type: 'number', width }));
  const title = (width) => ({ name: 'Name', type: 'title', width });
  return {
    plan: [title(200), { name: 'Exam Date', type: 'date', width: 130 }, { name: 'Start Date', type: 'date', width: 130 }, { name: 'Hours Goal', type: 'number', width: 110 }, { name: 'Following', type: 'select', config: { options: ST_PLAN_PLANS }, width: 120 }],
    week: [title(240), { name: 'Days', type: 'tags', config: { options: ST_PLAN_WEEKDAYS }, width: 200 }, { name: 'Account', type: 'select', config: { options: ['Personal', 'Work'] }, width: 110 }, { name: 'From', type: 'date', width: 120 }, { name: 'Until', type: 'date', width: 120 }, ...hours(84)],
    phases: [title(240), { name: 'Kind', type: 'select', config: { options: ST_PLAN_KINDS }, width: 110 }, { name: 'Start', type: 'date', width: 120 }, { name: 'End', type: 'date', width: 120 }, { name: 'Items', type: 'number', width: 84 }, { name: 'Minutes per Item', type: 'number', width: 140 }],
    days: [
      title(150), { name: 'Date', type: 'date', width: 110 }, { name: 'Type', type: 'select', config: { options: ST_PLAN_KINDS }, width: 100 }, { name: 'Phase', type: 'text', width: 150 },
      { name: 'Work', type: 'number', width: 66 }, { name: 'Floor', type: 'number', width: 66 }, { name: 'Standard', type: 'number', width: 84 }, { name: 'Stretch', type: 'number', width: 72 },
      kept('Planned', 80), kept('Running', 80), kept('Done', 66),
      { name: 'Edited', type: 'checkbox', width: 72 }, { name: 'Note', type: 'text', width: 200 },
    ],
  };
}

/** The person's date today, from this machine's clock in its own zone. */
function stPlanToday() {
  const n = new Date();
  const p = (v) => String(v).padStart(2, '0');
  return `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())}`;
}

/** The person's date of a moment written with a zone ("…Z", "…+02:00"). */
function stPlanLocalDate(raw) {
  const t = new Date(raw);
  if (Number.isNaN(t.getTime())) return '';
  const p = (v) => String(v).padStart(2, '0');
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`;
}

// ── Making a plan ───────────────────────────────────────────────────────────

/** A weekday list in words: "Mon to Thu", "Sat and Sun", "Mon, Wed and Fri". */
function stPlanDaysWords(days) {
  const idx = days.map((d) => ST_PLAN_WEEKDAYS.indexOf(d));
  if (idx.length > 2 && idx.every((v, i) => i === 0 || v === idx[i - 1] + 1)) return `${days[0]} to ${days[days.length - 1]}`;
  return days.length > 1 ? `${days.slice(0, -1).join(', ')} and ${days[days.length - 1]}` : days[0] || '';
}

/**
 * The usual week of the New Plan sheet as Week rows: the weekdays that have
 * the same hours share a row. Personal hours are the Standard plan's; the
 * Floor is `less` fewer (never below none) and the Stretch `more` more; a day
 * with no personal hours has none in any plan. Work is the same in all three.
 */
function stPlanWeekRowsOf({ personal = {}, work = {}, less = 1, more = 1 }) {
  const rows = [];
  for (const [account, hoursOf] of [['Personal', personal], ['Work', work]]) {
    const groups = new Map();
    for (const d of ST_PLAN_WEEKDAYS) {
      const h = stPlanHours(hoursOf[d]);
      if (!h) continue;
      const hours = account === 'Work' ? [h, h, h] : [Math.max(0, stPlanHours(h - stPlanHours(less))), h, stPlanHours(h + stPlanHours(more))];
      const key = hours.join('/');
      if (!groups.has(key)) groups.set(key, { days: [], hours });
      groups.get(key).days.push(d);
    }
    for (const g of groups.values()) rows.push({ title: `${account}, ${stPlanDaysWords(g.days)}`, values: { Days: g.days, Account: account, Floor: g.hours[0], Standard: g.hours[1], Stretch: g.hours[2] } });
  }
  return rows;
}

/** What is wrong with the New Plan sheet's answers, in words; '' when nothing is. */
function stPlanFormProblem({ name, start, exam }) {
  if (!String(name || '').trim()) return 'Give the plan a name.';
  if (!stPlanDateOf(start)) return 'Give the start date as a date, for example 2027-01-04.';
  if (!stPlanDateOf(exam)) return 'Give the exam date as a date, for example 2027-04-20.';
  if (exam <= start) return 'The exam date must be after the start date.';
  return '';
}

/**
 * New Plan: a page named for it under the subject's page, its four
 * databases, Plan and Week filled from the form, one Study phase from the
 * start to the day before the exam. The days are worked out right after,
 * behind this (the tab shows them as they land).
 */
async function stCreatePlan({ subjectId, name, start, exam, goal = 0, personal = {}, work = {}, less = 1, more = 1 }) {
  const door = stSubjectDoorOrThrow();
  const problem = stPlanFormProblem({ name, start, exam });
  if (problem) throw new Error(problem);
  const subject = await db.get('SELECT * FROM st_subjects WHERE id = ?', [Number(subjectId) || 0]);
  if (!subject) throw new Error('That subject is no longer in Study.');
  const title = String(name).trim();
  const cols = stPlanColumns();
  const page = await door.createPage({ title, parentPageId: subject.page_id || null });
  const plan = await door.create({ title: 'Plan', parentPageId: page.id, columns: cols.plan });
  const week = await door.create({ title: 'Week', parentPageId: page.id, columns: cols.week });
  const phases = await door.create({ title: 'Phases', parentPageId: page.id, columns: cols.phases });
  const days = await door.create({ title: 'Days', parentPageId: page.id, columns: cols.days });
  await door.addRow(plan.id, { title, values: { 'Start Date': start, 'Exam Date': exam, 'Hours Goal': stPlanHours(goal), Following: 'Standard' } });
  const weekRows = stPlanWeekRowsOf({ personal, work, less, more });
  if (weekRows.length) await door.addRows(week.id, weekRows);
  await door.addRow(phases.id, { title: 'Start to exam', values: { Kind: 'Study', Start: start, End: stPlanAddDays(exam, -1) } });
  const res = await db.run(
    'INSERT INTO st_plans (subject_id, name, page_id, plan_db, week_db, phases_db, days_db, written_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [subject.id, title, page.id, plan.id, week.id, phases.id, days.id, '{}', stNow()],
  );
  const made = stRowToPlan(await db.get('SELECT * FROM st_plans WHERE id = ?', [res.lastInsertRowid]));
  stPlanWatch(null, made, stActivation(), { ensure: false });
  _emitDataChanged();
  return made;
}

// ── Reading the plan and writing its days ───────────────────────────────────

const ST_PLAN_DBS = [['planDb', 'Plan'], ['weekDb', 'Week'], ['phasesDb', 'Phases'], ['daysDb', 'Days']];

/** Before each write: work that outlived its activation stops here. */
function stPlanLive(st) {
  if (!stIsCurrent(st.token) || _stPlans.get(st.plan.id) !== st) throw stStoppedError();
}

/**
 * Read a plan's databases and make Days agree with the rules. Nothing is
 * written while one of the four is in the Trash or gone (said in its tab),
 * or while the dates make no stretch (said as a contradiction; the days
 * stay as they are).
 */
async function stPlanSyncNow(st, { ensure = false } = {}) {
  const door = stSubjectDoor();
  if (!door) return;
  const plan = st.plan;
  const subject = await db.get('SELECT log_db FROM st_subjects WHERE id = ?', [plan.subjectId]);
  const logId = subject ? String(subject.log_db || '') : '';
  const infos = await Promise.all(ST_PLAN_DBS.map(([key]) => door.get(plan[key]).catch(() => null)));
  const gone = ST_PLAN_DBS.find((_, i) => !infos[i]);
  const trashed = ST_PLAN_DBS.find((_, i) => infos[i] && infos[i].trashed);
  if (gone || trashed) {
    st.problem = gone ? `Its ${gone[1]} database is gone, so Study cannot work the plan out. Nothing is written until it is back.`
      : `Its ${trashed[1]} database is in the Trash. Restore it and the plan follows again; nothing is written meanwhile.`;
    st.synced = true;
    return;
  }
  if (ensure) {
    const cols = stPlanColumns();
    for (const [key, name] of ST_PLAN_DBS) { stPlanLive(st); await door.ensureColumns(plan[key], cols[name.toLowerCase()]); }
  }
  const log = logId ? await door.get(logId).catch(() => null) : null;
  const [planRows, weekRows, phaseRows, dayRows, logRows] = await Promise.all([
    door.listRows(plan.planDb), door.listRows(plan.weekDb), door.listRows(plan.phasesDb), door.listRows(plan.daysDb),
    log && !log.trashed ? door.listRows(logId).catch(() => null) : null,
  ]);
  const rules = stPlanRules({ plan: planRows[0] ? planRows[0].values : null, week: weekRows, phases: phaseRows });
  const done = logRows ? stPlanDoneByDate(logRows, stPlanLocalDate) : null;
  const rec = await db.get('SELECT written_json FROM st_plans WHERE id = ?', [plan.id]);
  const before = rec ? String(rec.written_json || '{}') : '{}';
  const r = stPlanReconcile({ rules, rows: dayRows, written: stParseJson(before, {}) || {}, done });
  let written = r.written;
  if (stPlanHasStretch(rules)) {
    if (r.removes.length) { stPlanLive(st); await door.removeRows(plan.daysDb, r.removes); }
    if (r.updates.length) { stPlanLive(st); await door.updateRows(plan.daysDb, r.updates); }
    if (r.adds.length) {
      stPlanLive(st);
      const made = await door.addRows(plan.daysDb, r.adds.map((a) => ({ title: a.title, values: a.values })));
      written = { ...written, ...stPlanWrittenOfAdds(r.adds, made) };
    }
    const after = stJsonCol(written, '{}');
    if (after !== before) { stPlanLive(st); await db.run('UPDATE st_plans SET written_json = ? WHERE id = ?', [after, plan.id]); }
  }
  st.problem = '';
  st.rules = rules;
  st.days = r.days;
  st.outside = r.outside;
  st.done = done;
  st.planRowId = planRows[0] ? planRows[0].pageId : '';
  st.synced = true;
}

/** Run `fn` after whatever this plan is doing; a failure does not stop what follows. */
function stPlanEnqueue(st, fn) {
  const run = () => (stIsCurrent(st.token) && _stPlans.get(st.plan.id) === st ? fn() : undefined);
  st.chain = st.chain.then(run, run);
  return st.chain;
}

/** What the tab and the sidebar show of a plan, as one key: a redraw only when it differs. */
const stPlanShownKey = (st) => JSON.stringify([st.problem, st.synced, st.rules, st.days, st.outside, st.done ? [...st.done] : null]);

async function stPlanFlush(st) {
  if (!st.dirty && st.synced) return;
  const ensure = st.ensure;
  st.dirty = false; st.ensure = false;
  clearTimeout(st.timer);
  const shown = stPlanShownKey(st);
  try {
    await stPlanSyncNow(st, { ensure });
    st.tries = 0;
  } catch (err) {
    if (stIsStopped(err) || !stIsCurrent(st.token)) return;
    // The canvas is still starting, or a write was refused: look again shortly, and say so once.
    st.dirty = true; st.ensure = st.ensure || ensure;
    st.tries = (st.tries || 0) + 1;
    if (st.tries <= 20) st.timer = setTimeout(() => void stPlanEnqueue(st, () => stPlanFlush(st)), 1500);
    if (st.tries === 1 || st.tries === 20) console.warn(`[Study] ${st.plan.name}: the plan could not be worked out:`, err && err.message);
    if (st.tries >= 20) st.problem = 'Its databases could not be read.';
    return;
  }
  if (stIsCurrent(st.token) && stPlanShownKey(st) !== shown) _emitDataChanged();
}

/** One of the plan's databases (or its subject's Work Log) changed: read again shortly. */
function stPlanTouched(st, kind) {
  st.dirty = true;
  // A column deleted is put back with the next change of rows or cells, not under his hands.
  if (kind !== 'columns') st.ensure = true;
  clearTimeout(st.timer);
  st.timer = setTimeout(() => void stPlanEnqueue(st, () => stPlanFlush(st)), 80);
}

/** Start following a plan: hear its four databases and its subject's Work Log, and read them once. */
function stPlanWatch(context, plan, token = stActivation(), { ensure = true } = {}) {
  const door = stSubjectDoor();
  if (!door || !stIsCurrent(token)) return null;
  const old = _stPlans.get(plan.id);
  if (old) stPlanForget(old);
  const st = { plan, token, rules: null, days: [], outside: [], done: null, problem: '', synced: false, dirty: true, ensure, timer: 0, tries: 0, chain: Promise.resolve(), listeners: [], planRowId: '' };
  _stPlans.set(plan.id, st);
  const hear = (id) => { if (id) st.listeners.push(stOwn(context, token, door.onDidChange(id, (e) => { if (stIsCurrent(token) && _stPlans.get(plan.id) === st) stPlanTouched(st, e && e.kind); }))); };
  for (const [key] of ST_PLAN_DBS) hear(plan[key]);
  void db.get('SELECT log_db FROM st_subjects WHERE id = ?', [plan.subjectId]).then((s) => { if (s && _stPlans.get(plan.id) === st) hear(String(s.log_db || '')); }).catch(() => {});
  void stPlanEnqueue(st, () => stPlanFlush(st));
  return st;
}

function stPlanForget(st) {
  clearTimeout(st.timer);
  for (const off of st.listeners) { try { off.dispose(); } catch { /* gone */ } }
  if (_stPlans.get(st.plan.id) === st) _stPlans.delete(st.plan.id);
}

/** Forget the plans of a subject Study forgets (its pages and databases stay). */
async function stForgetSubjectPlans(subjectId) {
  for (const st of [..._stPlans.values()]) if (Number(st.plan.subjectId) === Number(subjectId)) stPlanForget(st);
  await db.run('DELETE FROM st_plans WHERE subject_id = ?', [Number(subjectId) || 0]);
}

/** Stop following every plan (deactivate): no timer left, nothing written. */
function stPlansReset() {
  for (const st of _stPlans.values()) clearTimeout(st.timer);
  _stPlans.clear();
}

// ── What others ask of a plan ───────────────────────────────────────────────

/** A subject's plans, the soonest exam first; `shown` is the one whose exam has not passed and is soonest. */
function stPlansOfSubject(subjectId, today = stPlanToday()) {
  const all = [..._stPlans.values()].filter((st) => Number(st.plan.subjectId) === Number(subjectId));
  const exam = (st) => (st.rules && st.rules.exam) || '';
  all.sort((a, b) => (exam(a) || '9999') < (exam(b) || '9999') ? -1 : (exam(a) || '9999') > (exam(b) || '9999') ? 1 : a.plan.id - b.plan.id);
  const shown = all.find((st) => exam(st) && exam(st) >= today) || null;
  return { all, shown };
}

/** Write the plan he follows into the Plan row; the days follow when the change is heard. */
async function stPlanSetFollowing(planId, value) {
  const st = _stPlans.get(Number(planId));
  const door = stSubjectDoor();
  if (!st || !door || !ST_PLAN_PLANS.includes(value) || st.problem) return false;
  if (!st.planRowId) return false;
  stPlanLive(st);
  await door.updateRow(st.plan.planDb, st.planRowId, { values: { Following: value } });
  return true;
}

/** Follow every plan for this activation. */
function registerPlans(context, token = stActivation()) {
  if (!stSubjectDoor() || !stIsCurrent(token)) return;
  stListPlans()
    .then((plans) => {
      if (!stIsCurrent(token)) return;
      for (const plan of plans) stPlanWatch(context, plan, token);
      _emitDataChanged();
    })
    .catch((err) => { if (!stIsStopped(err) && stIsCurrent(token)) console.warn('[Study] plans could not be loaded:', err); });
}
