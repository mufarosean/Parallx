// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 13: A PLAN — the pure part
// ═══════════════════════════════════════════════════════════════════════════════
//
// A plan is one stretch of time over a subject, ending at an exam. Its rules
// are rows he reads and edits in three canvas databases (Plan, Week, Phases);
// its days are worked out from them into a fourth (Days). This part is the
// arithmetic of that, with no database, no DOM and no clock: the dates, a
// day's hours summed from the Week blocks per account and per plan, its Type
// and Phase from the spans, Planned and Running, the totals and the goal, the
// hours per day, each phase's hours and whether its work fits, the rules that
// contradict each other, and which Days rows to add, change or leave alone
// (a day he changed is kept). 29-plans.js reads and writes; 64-plan-view.js
// draws.
//
// Dates are local calendar dates as 'YYYY-MM-DD' strings. They are counted
// as whole days from a fixed day with integer arithmetic, never through
// Date, so nothing here depends on the machine's time zone.

const ST_PLAN_WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const ST_PLAN_WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const ST_PLAN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** The three plans, least first. */
const ST_PLAN_PLANS = ['Floor', 'Standard', 'Stretch'];
const ST_PLAN_KINDS = ['Study', 'Rest', 'Catch-up', 'Holiday'];
const ST_PLAN_ACCOUNTS = ['Personal', 'Work'];
/** The Days cells that the rules give, and that make a day his when he changes one. */
const ST_PLAN_RULE_CELLS = ['Type', 'Phase', 'Work', 'Floor', 'Standard', 'Stretch'];

// ── Dates ───────────────────────────────────────────────────────────────────

/** Whole days from 1970-01-01 to a civil date (proleptic Gregorian). */
function stPlanDayNumber(iso) {
  let y = Number(iso.slice(0, 4)); const m = Number(iso.slice(5, 7)); const d = Number(iso.slice(8, 10));
  y -= m <= 2 ? 1 : 0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** The civil date of a day number. */
function stPlanDateOfNumber(n) {
  const z = n + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  const y = yoe + era * 400 + (m <= 2 ? 1 : 0);
  const p = (v, w) => String(v).padStart(w, '0');
  return `${p(y, 4)}-${p(m, 2)}-${p(d, 2)}`;
}

/** A real calendar date as 'YYYY-MM-DD' (a date-time keeps its date), else ''. */
function stPlanDateOf(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(typeof value === 'string' ? value.trim() : '');
  if (!m) return '';
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  return stPlanDateOfNumber(stPlanDayNumber(iso)) === iso ? iso : '';
}

const stPlanAddDays = (iso, n) => stPlanDateOfNumber(stPlanDayNumber(iso) + n);
const stPlanDaysBetween = (a, b) => stPlanDayNumber(b) - stPlanDayNumber(a);
/** 0 for Monday to 6 for Sunday. */
const stPlanWeekdayIndex = (iso) => (((stPlanDayNumber(iso) + 3) % 7) + 7) % 7;
const stPlanWeekday = (iso) => ST_PLAN_WEEKDAYS[stPlanWeekdayIndex(iso)];

/** A date in words: "Mon, Jan 4", with `year` "Mon, Jan 4, 2027", with `long` "Monday, January 4, 2027". */
function stPlanDateWords(iso, { year = false, weekday = true, long = false } = {}) {
  if (!stPlanDateOf(iso)) return '';
  const m = Number(iso.slice(5, 7)) - 1; const d = Number(iso.slice(8, 10));
  const month = long ? ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m] : ST_PLAN_MONTHS[m];
  const day = long ? ST_PLAN_WEEKDAY_NAMES[stPlanWeekdayIndex(iso)] : stPlanWeekday(iso);
  return `${weekday ? `${day}, ` : ''}${month} ${d}${year ? `, ${iso.slice(0, 4)}` : ''}`;
}

/** Two dates as a span in words: "Jan 4 – Jan 31", the year on the end when it is not the same. */
function stPlanSpanWords(a, b) {
  if (!a || !b) return a ? stPlanDateWords(a, { weekday: false }) : b ? stPlanDateWords(b, { weekday: false }) : '';
  const year = a.slice(0, 4) !== b.slice(0, 4);
  return a === b ? stPlanDateWords(a, { weekday: false }) : `${stPlanDateWords(a, { weekday: false, year })} – ${stPlanDateWords(b, { weekday: false, year })}`;
}

// ── Numbers ─────────────────────────────────────────────────────────────────

/** A cell as hours: a number, '' and nothing as 0, never below 0. Two decimals. */
function stPlanHours(v) {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : 0;
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
}
const stPlanRound = (n) => Math.round(n * 100) / 100;
/** Hours as they are read: "3", "2.5", "71.7". */
const stPlanH = (n) => String(Math.round(n * 10) / 10);

// ── The rules, read from the rows ───────────────────────────────────────────

const stPlanFold = (s) => String(s ?? '').toLowerCase().replace(/[^a-z]/g, '');

/** A cell's value by column name, whatever the case. */
function stPlanCell(values, name) {
  const v = values || {};
  if (name in v) return v[name];
  const key = Object.keys(v).find((k) => k.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : v[key];
}

/** The weekdays a Days cell names ("Mon", "monday", tags or "Mon, Thu"), in week order, once each. */
function stPlanWeekdaysOf(value) {
  const parts = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,;\s]+/) : [];
  const out = new Set();
  for (const p of parts) {
    const k = stPlanFold(p).slice(0, 3);
    const i = ST_PLAN_WEEKDAYS.findIndex((d) => d.toLowerCase() === k);
    if (i >= 0) out.add(i);
  }
  return [...out].sort((a, b) => a - b).map((i) => ST_PLAN_WEEKDAYS[i]);
}

/** One of `words` as it is spelled there, matched without case or punctuation; '' when none. */
function stPlanWordOf(value, words) {
  const k = stPlanFold(Array.isArray(value) ? value[0] : value);
  return words.find((w) => stPlanFold(w) === k) || '';
}

/**
 * The rules of a plan from its rows: `plan` the Plan row's values, `week`
 * and `phases` rows as the door gives them ({ pageId, title, values }).
 */
function stPlanRules({ plan, week, phases }) {
  const p = plan || {};
  return {
    start: stPlanDateOf(stPlanCell(p, 'Start Date')),
    exam: stPlanDateOf(stPlanCell(p, 'Exam Date')),
    goal: stPlanHours(stPlanCell(p, 'Hours Goal')),
    following: stPlanWordOf(stPlanCell(p, 'Following'), ST_PLAN_PLANS) || 'Standard',
    week: (week || []).map((r) => {
      const v = r.values || {};
      return {
        id: r.pageId, name: String(r.title || '').trim(),
        days: stPlanWeekdaysOf(stPlanCell(v, 'Days')),
        account: stPlanWordOf(stPlanCell(v, 'Account'), ST_PLAN_ACCOUNTS) || 'Personal',
        from: stPlanDateOf(stPlanCell(v, 'From')), until: stPlanDateOf(stPlanCell(v, 'Until')),
        floor: stPlanHours(stPlanCell(v, 'Floor')), standard: stPlanHours(stPlanCell(v, 'Standard')), stretch: stPlanHours(stPlanCell(v, 'Stretch')),
      };
    }),
    phases: (phases || []).map((r, order) => {
      const v = r.values || {};
      const items = stPlanHours(stPlanCell(v, 'Items')); const minutes = stPlanHours(stPlanCell(v, 'Minutes per Item'));
      return {
        id: r.pageId, name: String(r.title || '').trim(), order,
        kind: stPlanWordOf(stPlanCell(v, 'Kind'), ST_PLAN_KINDS),
        start: stPlanDateOf(stPlanCell(v, 'Start')), end: stPlanDateOf(stPlanCell(v, 'End')),
        items, minutes,
      };
    }),
  };
}

/** A span that counts: both dates, the end not before the start. */
const stPlanSpanValid = (s) => !!(s.start && s.end && s.start <= s.end);
const stPlanInSpan = (d, s) => s.start <= d && d <= s.end;
const stPlanByStart = (a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.order - b.order);

// ── The days ────────────────────────────────────────────────────────────────

/** Is there a stretch to plan: both dates, the exam after the start? */
const stPlanHasStretch = (rules) => !!(rules.start && rules.exam && rules.start < rules.exam);

/**
 * Every day from the start to the day before the exam, worked out from the
 * rules: { date, type, phase, work, floor, standard, stretch, planned,
 * running, per: { Floor, Standard, Stretch } (work and personal in each
 * plan), kept }. `kept` is date → the cells of a day he changed ({ type,
 * phase, work, floor, standard, stretch }): those stand as he left them,
 * and Planned and Running follow them.
 */
function stPlanDays(rules, kept = new Map()) {
  if (!stPlanHasStretch(rules)) return [];
  const spans = rules.phases.filter(stPlanSpanValid);
  const study = spans.filter((s) => s.kind === 'Study').sort(stPlanByStart);
  const blocks = rules.week.filter((w) => w.days.length && (!w.from || !w.until || w.from <= w.until));
  const plan = rules.following.toLowerCase();
  const out = [];
  let running = 0;
  const last = stPlanDayNumber(rules.exam);
  for (let n = stPlanDayNumber(rules.start); n < last; n++) {
    const date = stPlanDateOfNumber(n);
    const wd = stPlanWeekday(date);
    const work = { floor: 0, standard: 0, stretch: 0 };
    const own = { floor: 0, standard: 0, stretch: 0 };
    for (const w of blocks) {
      if (!w.days.includes(wd) || (w.from && date < w.from) || (w.until && date > w.until)) continue;
      const into = w.account === 'Work' ? work : own;
      into.floor += w.floor; into.standard += w.standard; into.stretch += w.stretch;
    }
    const off = spans.find((s) => (s.kind === 'Rest' || s.kind === 'Holiday') && stPlanInSpan(date, s));
    if (off) for (const k of ['floor', 'standard', 'stretch']) { work[k] = 0; own[k] = 0; }
    const catchUp = !off && spans.some((s) => s.kind === 'Catch-up' && stPlanInSpan(date, s));
    const phase = (study.find((s) => stPlanInSpan(date, s)) || { name: '' }).name;
    let day;
    const his = kept.get(date);
    if (his) {
      const w = stPlanHours(his.work);
      const o = { floor: stPlanHours(his.floor), standard: stPlanHours(his.standard), stretch: stPlanHours(his.stretch) };
      day = { date, type: stPlanWordOf(his.type, ST_PLAN_KINDS) || '', phase: String(his.phase ?? ''), work: w, ...o, per: { Floor: stPlanRound(w + o.floor), Standard: stPlanRound(w + o.standard), Stretch: stPlanRound(w + o.stretch) }, kept: true };
    } else {
      const per = { Floor: stPlanRound(work.floor + own.floor), Standard: stPlanRound(work.standard + own.standard), Stretch: stPlanRound(work.stretch + own.stretch) };
      const type = off ? off.kind : catchUp ? 'Catch-up' : per[rules.following] > 0 ? 'Study' : 'Rest';
      day = { date, type, phase, work: stPlanRound(work[plan]), floor: stPlanRound(own.floor), standard: stPlanRound(own.standard), stretch: stPlanRound(own.stretch), per, kept: false };
    }
    day.planned = day.per[rules.following];
    running = stPlanRound(running + day.planned);
    day.running = running;
    out.push(day);
  }
  return out;
}

/** Each plan's total hours over the days. */
function stPlanTotals(days) {
  const out = { Floor: 0, Standard: 0, Stretch: 0 };
  for (const d of days) for (const p of ST_PLAN_PLANS) out[p] = stPlanRound(out[p] + d.per[p]);
  return out;
}

/** A plan's total against the goal: { word: 'under' | 'over' | 'on', by }; null with no goal. */
function stPlanGoalOf(total, goal) {
  if (!(goal > 0)) return null;
  const by = stPlanRound(Math.abs(goal - total));
  return { word: by === 0 ? 'on' : total < goal ? 'under' : 'over', by };
}

/** "14 under 500", "57 over 500", "on 500". */
function stPlanGoalWords(total, goal) {
  const g = stPlanGoalOf(total, goal);
  return !g ? '' : g.word === 'on' ? `on ${stPlanH(goal)}` : `${stPlanH(g.by)} ${g.word} ${stPlanH(goal)}`;
}

/** Hours per day for the plan he follows: [{ hours, days }] by hours, least first. */
function stPlanHoursPerDay(days) {
  const by = new Map();
  for (const d of days) by.set(d.planned, (by.get(d.planned) || 0) + 1);
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([hours, n]) => ({ hours, days: n }));
}

/**
 * The phases in date order, each with its days in the plan and its hours
 * in every plan, and for a study phase with Items and Minutes per Item
 * what that work needs (`fit`: { needs, short: plans whose hours are less }).
 * A phase without valid dates comes last, with nothing counted.
 */
function stPlanPhases(rules, days) {
  return rules.phases.slice().sort((a, b) => {
    const av = stPlanSpanValid(a); const bv = stPlanSpanValid(b);
    return av !== bv ? (av ? -1 : 1) : av ? stPlanByStart(a, b) : a.order - b.order;
  }).map((s) => {
    const valid = stPlanSpanValid(s);
    const inside = valid ? days.filter((d) => stPlanInSpan(d.date, s)) : [];
    const per = { Floor: 0, Standard: 0, Stretch: 0 };
    for (const d of inside) for (const p of ST_PLAN_PLANS) per[p] = stPlanRound(per[p] + d.per[p]);
    const needs = s.kind === 'Study' && s.items > 0 && s.minutes > 0 ? stPlanRound((s.items * s.minutes) / 60) : 0;
    return {
      id: s.id, name: s.name, kind: s.kind, start: s.start, end: s.end, valid, days: inside.length, per, hours: per[rules.following],
      fit: needs ? { needs, short: ST_PLAN_PLANS.filter((p) => needs > per[p] + 1e-9) } : null,
    };
  });
}

/** "needs 84 h, has 72 h" for one plan, or "fits: 71.7 h of work in 72 h". */
function stPlanFitWords(fit, has) {
  if (!fit) return '';
  return fit.needs > has + 1e-9 ? `needs ${stPlanH(fit.needs)} h, has ${stPlanH(has)} h` : `fits: ${stPlanH(fit.needs)} h of work in ${stPlanH(has)} h`;
}

/**
 * Where the rules contradict, in words, each naming the row: a plan with
 * no stretch, a Week block with no days, a block or a span that ends
 * before it starts, a span with a date missing or no kind, and two Study
 * phases over one date (the first by start keeps those days).
 */
function stPlanContradictions(rules) {
  const out = [];
  const called = (r, what) => r.name || `A ${what} row`;
  if (!rules.start || !rules.exam) out.push({ kind: 'dates', text: 'The plan needs a start date and an exam date.' });
  else if (rules.exam <= rules.start) out.push({ kind: 'dates', text: 'The exam date is on or before the start date, so the plan has no days.' });
  for (const w of rules.week) {
    if (!w.days.length) out.push({ kind: 'week', id: w.id, text: `${called(w, 'Week')} has no days, so it gives no hours.` });
    else if (w.from && w.until && w.until < w.from) out.push({ kind: 'week', id: w.id, text: `${called(w, 'Week')} ends before it starts, so it gives no hours.` });
  }
  for (const s of rules.phases) {
    if (!s.start || !s.end) out.push({ kind: 'phase', id: s.id, text: `${called(s, 'Phases')} needs a start and an end, so it holds no day.` });
    else if (s.end < s.start) out.push({ kind: 'phase', id: s.id, text: `${called(s, 'Phases')} ends before it starts, so it holds no day.` });
    else if (!s.kind) out.push({ kind: 'phase', id: s.id, text: `${called(s, 'Phases')} has no kind: Study, Rest, Catch-up or Holiday.` });
  }
  const study = rules.phases.filter((s) => s.kind === 'Study' && stPlanSpanValid(s)).sort(stPlanByStart);
  for (let i = 0; i < study.length; i++) {
    for (let j = i + 1; j < study.length; j++) {
      const a = study[i]; const b = study[j];
      if (b.start > a.end) continue;
      const until = a.end < b.end ? a.end : b.end;
      out.push({ kind: 'overlap', id: b.id, text: `${called(b, 'Phases')} overlaps ${called(a, 'Phases')} from ${stPlanSpanWords(b.start, until)}: those days stay in ${called(a, 'Phases')}, which starts first.` });
    }
  }
  return out;
}

// ── The Days rows: what to add, change and leave ────────────────────────────

/** A Days cell as Study compares it: numbers as hours, words as text, a date as its date. */
function stPlanCellKey(name, value) {
  if (name === 'Type' || name === 'Phase') return String(Array.isArray(value) ? value.join(', ') : value ?? '').trim();
  if (name === 'Date') return stPlanDateOf(value);
  if (name === 'Edited') return value === true || value === 1;
  return stPlanHours(value);
}

/** The cells of a row that the rules give, as Study compares them. */
const stPlanRuleCellsOf = (values) => Object.fromEntries(ST_PLAN_RULE_CELLS.map((c) => [c, stPlanCellKey(c, stPlanCell(values, c))]));
const stPlanSameCells = (a, b) => ST_PLAN_RULE_CELLS.every((c) => JSON.stringify(a[c]) === JSON.stringify(b[c]));

/** A Days row's title: unique to its day. */
const stPlanDayTitle = (iso) => stPlanDateWords(iso, { year: true });

/**
 * What the Days rows must become. `rows` are the Days rows as they are
 * (values by column name), `written` what Study last wrote to each row (row
 * id → its rule cells and Edited), `done` date → hours in the Work Log (null
 * when the log cannot be read: Done is then left as it is).
 *
 * A row is his (kept) when Edited is ticked, or when one of its rule cells
 * differs from what Study last wrote (Study ticks Edited then). Unticked
 * after Study ticked it, it goes back to the rules. A kept row outside the
 * plan's dates is kept as it is and listed (`outside`); any other row of
 * Study's outside them, or a second row of Study's for one date, goes. A
 * row Study never wrote that is not a day of the plan is left alone.
 *
 * Returns { days, adds: [{ title, values }], updates: [{ pageId, values }],
 * removes: [pageId], written (the next record, by row id), outside: [{
 * pageId, date, ...cells }] }. Only differences are in `updates`.
 */
function stPlanReconcile({ rules, rows, written = {}, done = null }) {
  const prior = written || {};
  const start = rules.start; const end = stPlanHasStretch(rules) ? stPlanAddDays(rules.exam, -1) : '';
  const inPlan = (d) => !!end && start <= d && d <= end;
  const seen = [];
  for (const r of rows || []) {
    const v = r.values || {};
    const date = stPlanDateOf(stPlanCell(v, 'Date'));
    const w = prior[r.pageId] || null;
    const ticked = stPlanCellKey('Edited', stPlanCell(v, 'Edited'));
    const cells = stPlanRuleCellsOf(v);
    // His when ticked; when Study's record says it ticked it and he has unticked it, the rules again.
    const changed = !ticked && !!w && !w.Edited && !stPlanSameCells(cells, w);
    seen.push({ row: r, date, w, cells, kept: ticked || changed, tick: changed });
  }
  const byDate = new Map();
  const removes = [];
  const outside = [];
  for (const s of seen) {
    if (!s.date) continue;
    if (!inPlan(s.date)) {
      if (s.kept) outside.push({ pageId: s.row.pageId, date: s.date, type: s.cells.Type, phase: s.cells.Phase, work: s.cells.Work, floor: s.cells.Floor, standard: s.cells.Standard, stretch: s.cells.Stretch });
      else if (s.w) removes.push(s.row.pageId);
      continue;
    }
    const have = byDate.get(s.date);
    if (!have || (s.kept && !have.kept)) {
      if (have && have.w) removes.push(have.row.pageId);
      byDate.set(s.date, s);
    } else if (s.w && !s.kept) removes.push(s.row.pageId);
  }
  const kept = new Map();
  for (const [date, s] of byDate) if (s.kept) kept.set(date, { type: s.cells.Type, phase: s.cells.Phase, work: s.cells.Work, floor: s.cells.Floor, standard: s.cells.Standard, stretch: s.cells.Stretch });
  const days = stPlanDays(rules, kept);
  const next = {};
  // A row left as it is keeps its record (a day he kept outside the dates comes back as his).
  for (const s of seen) if (prior[s.row.pageId] && !removes.includes(s.row.pageId) && byDate.get(s.date) !== s) next[s.row.pageId] = prior[s.row.pageId];
  const adds = []; const updates = [];
  for (const d of days) {
    const want = d.kept
      ? { Planned: d.planned, Running: d.running }
      : { Date: d.date, Type: d.type, Phase: d.phase, Work: d.work, Floor: d.floor, Standard: d.standard, Stretch: d.stretch, Planned: d.planned, Running: d.running };
    if (done) want.Done = stPlanRound(done.get(d.date) || 0);
    const s = byDate.get(d.date);
    if (!s) {
      adds.push({ date: d.date, title: stPlanDayTitle(d.date), values: Object.fromEntries(Object.entries(want).map(([k, v]) => [k, v === '' ? null : v])) });
      continue;
    }
    if (s.tick) want.Edited = true;
    const values = {};
    for (const [k, v] of Object.entries(want)) {
      if (JSON.stringify(stPlanCellKey(k, stPlanCell(s.row.values, k))) !== JSON.stringify(stPlanCellKey(k, v))) values[k] = v === '' ? null : v;
    }
    if (Object.keys(values).length) updates.push({ pageId: s.row.pageId, values });
    next[s.row.pageId] = d.kept
      ? { ...(s.w || s.cells), Edited: true }
      : { Type: d.type, Phase: d.phase, Work: d.work, Floor: d.floor, Standard: d.standard, Stretch: d.stretch, Edited: false };
  }
  return { days, adds, updates, removes, written: next, outside };
}

/** The record Study keeps of rows it has just added: their rule cells, by row id. */
function stPlanWrittenOfAdds(adds, made) {
  const out = {};
  adds.forEach((a, i) => {
    const row = made[i];
    if (!row || !row.pageId) return;
    const v = a.values;
    out[row.pageId] = { Type: stPlanCellKey('Type', v.Type), Phase: stPlanCellKey('Phase', v.Phase), Work: stPlanHours(v.Work), Floor: stPlanHours(v.Floor), Standard: stPlanHours(v.Standard), Stretch: stPlanHours(v.Stretch), Edited: false };
  });
  return out;
}

/** Done per local date from the Work Log's rows: their Minutes, in hours. `localDate` turns a moment with a zone into the person's date. */
function stPlanDoneByDate(logRows, localDate = null) {
  const out = new Map();
  for (const r of logRows || []) {
    const v = r.values || {};
    const raw = stPlanCell(v, 'Date');
    const zoned = typeof raw === 'string' && /T.*(Z|[+-]\d{2}:?\d{2})$/.test(raw);
    const date = zoned && localDate ? localDate(raw) : stPlanDateOf(raw);
    const minutes = stPlanHours(stPlanCell(v, 'Minutes'));
    if (!date || !minutes) continue;
    out.set(date, stPlanRound((out.get(date) || 0) + minutes / 60));
  }
  return out;
}

// ── What the tab shows ──────────────────────────────────────────────────────

/**
 * The tab's view of a plan worked out: the three plans against the goal,
 * hours per day, the phases, the days by week (Monday to Sunday), the days
 * left and the contradictions. `today` is the person's local date.
 */
function stPlanView(rules, days, { today = '', outside = [], done = null } = {}) {
  const totals = stPlanTotals(days);
  const weeks = [];
  for (const d of days) {
    const monday = stPlanAddDays(d.date, -stPlanWeekdayIndex(d.date));
    let w = weeks[weeks.length - 1];
    if (!w || w.monday !== monday) { w = { monday, days: [], hours: 0 }; weeks.push(w); }
    w.days.push({ ...d, done: done ? stPlanRound(done.get(d.date) || 0) : null, past: !!today && d.date < today, today: d.date === today });
    w.hours = stPlanRound(w.hours + d.planned);
  }
  weeks.forEach((w, i) => { w.n = i + 1; w.first = w.days[0].date; w.last = w.days[w.days.length - 1].date; });
  return {
    start: rules.start, exam: rules.exam, goal: rules.goal, following: rules.following,
    daysLeft: today && rules.exam ? stPlanDaysBetween(today, rules.exam) : null,
    plans: ST_PLAN_PLANS.map((p) => ({ plan: p, total: totals[p], goal: stPlanGoalOf(totals[p], rules.goal), following: p === rules.following })),
    perDay: stPlanHoursPerDay(days),
    studyDays: days.filter((d) => d.planned > 0).length,
    allDays: days.length,
    phases: stPlanPhases(rules, days),
    weeks,
    outside: outside.slice().sort((a, b) => (a.date < b.date ? -1 : 1)),
    contradictions: stPlanContradictions(rules),
  };
}
