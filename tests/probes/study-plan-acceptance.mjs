// @acceptance: Study's plan: an exam date, a usual week, phases and rest as rows he can edit, and every day worked out from them, in three plans
// Written from the request (piece 3 of the Study system, "the plan", 2026-11-19)
// before the build, by a verifier that did not build it, and seen to fail on
// the app as it was (cf75f2be). The builder does not edit this file: a check
// that is wrong is reported, not changed.
//
// What a person must be able to do when the piece is done (a phase's number is
// the request's statement; PARALLX_PROBE_ONLY takes these numbers):
//
//    1  Make a plan: "New Plan…" in a subject's More Actions, "Study: New
//       Plan…" (study.newPlan) in the palette; a sheet for Name, Exam date,
//       Start date, Hours goal and the usual week; Create makes a page named
//       for the plan under the subject's page with the databases Plan, Week,
//       Phases and Days, fills them and opens the tab "<Plan name>"; an exam
//       date on or before the start date is refused in words
//    2  See the plan: the exam date and the days left; the three plans with
//       their totals, the one he follows marked, the goal and how far each is
//       from it; a way to choose the plan he follows; hours per day by number
//       of days; the phases in date order; every day in a table grouped by
//       week; Open Days, Open Week, Open Phases, Open Plan Settings
//    3  Change a rule in a database and the Days rows and the open tab follow
//       within 2 s (each time is printed): a Week row's hours, days and dates,
//       a row added and a row deleted, a Phases row, the Exam Date later and
//       earlier, the Start Date, Following
//    4  A day he changed is marked Edited by Study and is never worked out
//       again, while Running and Done still follow; unticked, it goes back to
//       the rules; outside new dates it is kept and listed as outside the plan
//    5  A study phase that does not fit says "needs 84 h, has 72 h", and the
//       same for Floor and Stretch is one press away
//    6  The goal missed or passed, by how much, for each of the three plans;
//       a Week block with no days, a span ending before it starts and two
//       Study phases over one date are each named
//    7  His spring 2027 draft, entered as rows, gives the days of his sheet
//       exactly: 134 days, 385, 486 and 557 hours, 97 days with hours
//    8  Find it: the plan and its days left under the subject in the sidebar,
//       "Open Plan" in More Actions, the soonest exam that has not passed
//    9  Everyone can use it: the keyboard, names, focus, a real table, Type in
//       words, the sheet keeps Tab inside, 900 px, light and dark
//   10  Study off and nothing of the plan runs while the databases stay
//       editable; a database in the Trash is said in words and nothing is
//       written; 134 days from Create to the tab in under 20 s (printed)
//    0  is not in the request: it is the ground the other checks stand on,
//       the app as it is today and the reference itself. Its checks pass
//       before the build and must go on passing; every other check fails
//       before the build
//
// How it runs. Every phase gets its own app, profile and workspace. Phases 0,
// 1, 7, 8 and 10 start from a copy of a workspace in which the app itself made
// the subject "Exam 7" (New Subject…, the piece before the one before). Phases
// 2 to 6 and 9 start from a copy in which the probe then made the plan "Winter
// Block" through the New Plan sheet; until that sheet exists their checks say
// so. The mouse and the keys are real. No model is used.
//
//   xvfb-run -a node tests/probes/study-plan-acceptance.mjs [outDir]
//   PARALLX_PROBE_ONLY=1,4,7-9   only those phases
//   PARALLX_PROBE_TZ=Asia/Tokyo  the app's time zone (default America/Chicago;
//                                Linux and macOS only, Windows keeps its own)
//   node tests/probes/study-plan-acceptance.mjs --reference
//                                prints the reference table and stops
//
// Dates. The app runs in a fixed zone that is not UTC, so a date kept as a
// moment instead of a local date shows up as the day before. Every plan has
// fixed dates in 2027, except where the request itself speaks of today (days
// left, today's row, the days already past, the exam that has passed): there
// the dates are counted from today as the app's own window gives it.
//
// The reference of statement 7. REFERENCE below is the output of the rules in
// campaign/spring-2027/plan_days.py on branch exam7-campaign (its functions
// work and personal), run in Python: 134 days, per day the work hours and the
// personal hours of Floor, Standard and Stretch. The probe enters the draft
// as 10 Week rows and 15 Phases rows (SPRING_WEEK, SPRING_PHASES); check 0.1
// proves, without the app, that the request's model over those rows gives
// REFERENCE day for day, so what the app is held to is his sheet and not the
// probe's reading of it.
//
// Where a result is read from. Never from what the probe typed: from the
// workspace's own database file (<workspace>/.parallx/data.db: the four
// databases, their columns and rows as the app wrote them) and from the tab
// on screen (its words, its table, the names its controls speak).
//
// How the probe writes (none of it is Study): the chat's own tools
// canvas_add_database_row and canvas_set_page_property, and the canvas table
// with the mouse and keys (a number typed into a cell, a checkbox clicked, a
// row deleted from its menu). The plan itself is made only through the sheet.
//
// What the probe holds on to (the builder keeps these, or the check fails):
//   - the words of the request, found as a person reads them: the command
//     study.newPlan titled "Study: New Plan…"; "New Plan…" and "Open Plan" in
//     the subject's More Actions; the sheet's fields Name, Exam date, Start
//     date, Hours goal, a personal and a work field for each weekday (the
//     label holds the weekday, "Mon" or "Monday", and the word Personal or
//     Work), one field with Floor and one with Stretch in its label (both 1
//     to begin with), and the button Create; the tab titled with the plan's
//     name; "Open Days", "Open Week", "Open Phases", "Open Plan Settings";
//     "Standard 486 h · 14 under 500" (the plan's word, its hours with "h",
//     then the distance with "under" or "over" and the goal: punctuation
//     between them is free); "N days left"; "0 h: 37 days" pairs; "N study
//     days"; "needs 84 h, has 72 h"; "outside the plan"; "no days"; a span
//     that "ends before it starts"; "overlap"; the word Trash
//   - the databases, by exact name, under a page named for the plan under the
//     subject's page: Plan (Exam Date and Start Date: date; Hours Goal:
//     number; Following: select Floor, Standard, Stretch), Week (Days: tags
//     Mon to Sun; Account: select Personal, Work; From, Until: date; Floor,
//     Standard, Stretch: number), Phases (Kind: select Study, Rest, Catch-up,
//     Holiday; Start, End: date; Items, Minutes per Item: number), Days (Date:
//     date; Type: select Study, Rest, Catch-up, Holiday; Phase; Work, Floor,
//     Standard, Stretch, Planned, Running, Done: number; Edited: checkbox;
//     Note: text). The first column of Week and Phases is Name
//   - THE HOOKS (the few things that are not words or roles):
//       1. each day's row in the tab's table is a <tr data-date="YYYY-MM-DD">,
//          in a <table> with a <caption> and column headers (<th>) reading
//          Date, Type, Phase, Personal, Work, Total, Running; a day listed as
//          outside the plan carries data-date too, inside a block (or a row)
//          that says "outside the plan" and holds no day of the plan
//       2. today's row has aria-current ("date" or "true")
//       3. weeks are told apart in the table's structure: a <tbody> per week,
//          or a row without data-date before each week's days
//       4. the plan he follows: three controls whose names begin Floor,
//          Standard and Stretch, exactly one marked by aria-checked,
//          aria-pressed or aria-selected = "true"; pressing one writes
//          Following
//       5. "Hours per day" and "Phases" are parts of the tab that carry those
//          names (aria-label, aria-labelledby, or a heading that starts the
//          part); a phase is a row there (<tr>, <li>, role row or listitem)
//   - a date field of the sheet is an <input type="date">, or a text field
//     that takes 2027-04-20 typed
//   - as they are today: Study's sidebar, More Actions and sheet (.st-sheet or
//     the app's modal), the canvas table ([data-px-surface="database"],
//     .canvas-db-th__name, tr.canvas-db-row, .canvas-db-cell__titletext,
//     .canvas-db-checkbtn), canvas.openPage, canvas.deletePage, Appearance
//
// How the request is read where it leaves room (told to the builder):
//   - the model: a Week row counts on a date when Days holds its weekday and
//     From <= date <= Until (an empty end is open); a Work row's hours are the
//     same number in its three columns and Days.Work is the one of the plan he
//     follows; a Rest or Holiday span empties work too; a span is Start to End
//     inclusive; a day's Phase is the first Study span by Start that holds it,
//     empty when none does (a rest day or a holiday inside a Study span keeps
//     that span as its Phase); Type is Study when work plus the
//     personal hours of the plan he follows is more than nothing
//   - a phase's hours, the three totals and "hours per day" count work and
//     personal together (Planned); "study days" are days with hours
//   - Create leaves Following at Standard; the Floor of the form is the
//     Standard less the given hours and never below nothing; the one Study
//     phase runs from the start to the day before the exam
//   - Study writes Planned, Running and Done into Days as numbers (not as
//     formula columns), and a Days row's first cell is unique to its day
//   - Days.Phase is read as the phase's name: text, select, or a relation to
//     the Phases row
//   - "within 2 seconds" is counted from the moment the change is stored (the
//     tool has answered; Enter was pressed in the cell). For the one change
//     made in the table the tab's time includes the click back to its tab
//   - Done on a date is the Minutes of the Work Log rows whose Date falls on
//     that local date, in hours; it is given 5 s
//   - a fitting phase may say what it likes except "needs"; "one press away"
//     is one press of a control in the phase's row, after which the screen
//     says Floor's "needs … has …" and names Stretch
//   - each contradiction is "named" when one small block of the tab (at most
//     260 characters) holds the row's name and the words
//   - Study off: its commands and the plan's tab are gone; turned on again
//     the days catch up within 15 s without a restart
//   - "told apart at a glance": the row of a Rest, a Catch-up and a Holiday
//     day each look different from a Study day's row and from each other (the
//     row's or the Type cell's background, the Type's colour, weight or icon)
//   - contrast: the Type's words at 4.5 to 1 on what they sit on, light and
//     dark; at 900 px nothing of the tab is cut off (it fits, or it scrolls)
//
// Not checked here: the look beyond what is above (the visual bar's probe),
// touch and the full keyboard audit (their own probes: this one walks the tab
// by Tab and the sheet's trap); a screen reader's actual speech; a database
// deleted for ever as opposed to in the Trash; a change of a Week row's days
// or dates typed in the table (those go through the chat's tool; hours go
// through the table); the Start Date moved earlier; Type and Phase edited by
// hand in the table (Type is edited through the tool, Phase is not); several
// subjects (the palette command asking which); "nothing depends on the
// machine's speed" beyond the printed times; the pieces before (their own
// probes must keep passing).
import { _electron as electron } from 'playwright';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.resolve(process.argv[2] ?? path.join(REPO, 'test-results', 'study-plan-acceptance'));
const ELECTRON = path.join(REPO, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const ONLY = (() => {
  const raw = String(process.env.PARALLX_PROBE_ONLY || '').trim();
  if (!raw) return null;
  const set = new Set();
  for (const part of raw.split(/[\s,]+/).filter(Boolean)) {
    const m = /^(\d+)-(\d+)$/.exec(part);
    if (m) for (let i = Number(m[1]); i <= Number(m[2]); i++) set.add(i);
    else if (/^\d+$/.test(part)) set.add(Number(part));
  }
  return set;
})();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const low = (s) => norm(s).toLowerCase();
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const exact = (s) => new RegExp(`^${esc(s)}$`, 'i');
async function until(fn, ms = 5000, step = 100) {
  const end = Date.now() + ms;
  for (;;) {
    let v = null;
    try { v = await fn(); } catch { v = null; }
    if (v) return v;
    if (Date.now() >= end) return null;
    await sleep(step);
  }
}
function must(value, what) {
  if (!value) throw new Error(`could not find ${what}`);
  return value;
}
const num = (v) => (v === null || v === undefined || v === '' ? 0 : Number(v));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** Two maps with the same entries, whatever their order. */
const sameMap = (a, b) => same(Object.entries(a).sort(), Object.entries(b).sort());

// ── The checks ────────────────────────────────────────────────────────────────
const results = []; // { id, label, ok }
function record(id, label, ok, got) {
  const detail = got === undefined ? '' : ` :: ${String(typeof got === 'string' ? got : JSON.stringify(got)).replace(/\s+/g, ' ').slice(0, 520)}`;
  console.log(`${ok ? '  ok ' : ' FAIL'} ${id} ${label}${ok && !detail ? '' : detail}`);
  results.push({ id, label, ok: !!ok });
}

/** A new profile under runs/<name>, and a workspace at `workspace` copied from `from` (or empty). */
async function newRoot(name, from, workspace = path.join(OUT, 'runs', name, 'workspace')) {
  const dir = path.join(OUT, 'runs', name);
  await fs.rm(dir, { recursive: true, force: true });
  await fs.rm(workspace, { recursive: true, force: true });
  await fs.mkdir(path.join(dir, 'app', 'data'), { recursive: true });
  if (from) await fs.cp(from, workspace, { recursive: true }); else await fs.mkdir(workspace, { recursive: true });
  // No background indexing, suggestions or heartbeat: the probe is the only thing calling the model.
  await fs.mkdir(path.join(workspace, '.parallx'), { recursive: true });
  await fs.writeFile(path.join(workspace, '.parallx', 'ai-config.json'), JSON.stringify({ overrides: { indexing: { autoIndex: false, watchFiles: false }, suggestions: { suggestionsEnabled: false }, heartbeat: { enabled: false } } }));
  return { dir, workspace };
}

// ── The workspace's database file, read as the app left it ──────────────────
function fileAll(file, sql, params = []) {
  if (!existsSync(file)) return [];
  const d = new DatabaseSync(file, { readOnly: true });
  try { return d.prepare(sql).all(...params); } finally { d.close(); }
}
const coreFile = (workspace) => path.join(workspace, '.parallx', 'data.db');
const coreAll = (workspace, sql, params = []) => fileAll(coreFile(workspace), sql, params);
const parse = (s) => { try { return JSON.parse(s); } catch { return s; } };
const pagesTitled = (ws, title) => coreAll(ws, 'SELECT id, title, parent_id FROM pages WHERE title = ? AND is_archived = 0 AND id NOT IN (SELECT id FROM databases)', [title]);
const databases = (ws, parentId = undefined) => coreAll(ws, `SELECT d.id, p.title, p.parent_id FROM databases d JOIN pages p ON p.id = d.id WHERE p.is_archived = 0 ${parentId === undefined ? '' : 'AND p.parent_id = ?'} ORDER BY p.sort_order`, parentId === undefined ? [] : [parentId]);
const columns = (ws, dbId) => coreAll(ws, 'SELECT id, name, type, config, sort_order FROM database_properties WHERE database_id = ? ORDER BY sort_order', [dbId]).map((p) => ({ ...p, config: parse(p.config) }));
/** A database's rows: { pageId, title, sort, values by column name }. */
function rowsOf(ws, dbId) {
  const cols = columns(ws, dbId);
  const rows = coreAll(ws, 'SELECT p.id AS pageId, p.title, dp.sort_order AS sort FROM database_pages dp JOIN pages p ON p.id = dp.page_id WHERE dp.database_id = ? AND p.is_archived = 0 ORDER BY dp.sort_order, p.id', [dbId]);
  const by = new Map(rows.map((r) => [r.pageId, { ...r, values: {} }]));
  for (const v of coreAll(ws, 'SELECT page_id, property_id, value FROM page_property_values WHERE database_id = ?', [dbId])) {
    const r = by.get(v.page_id); const c = cols.find((x) => x.id === v.property_id);
    if (r && c) r.values[c.name] = parse(v.value);
  }
  return [...by.values()];
}
const rowTitled = (ws, dbId, title) => rowsOf(ws, dbId).find((r) => norm(r.title) === norm(title)) || null;
const col = (cols, ...names) => cols.find((c) => names.some((n) => low(c.name) === n.toLowerCase())) || null;

// <reference>
// ── Dates, the request's model, and his spring 2027 draft ───────────────────
// A date is 'YYYY-MM-DD' throughout; such strings compare in date order.
const DAY_MS = 86400000;
const utc = (s) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
const addDays = (s, n) => new Date(utc(s) + n * DAY_MS).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((utc(b) - utc(a)) / DAY_MS);
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const weekdayOf = (s) => WEEKDAYS[(new Date(utc(s)).getUTCDay() + 6) % 7];
const PLANS = ['Floor', 'Standard', 'Stretch'];
/**
 * The request's model, as the probe reads it. `week` rows are
 * { name, days: ['Mon', …], account: 'Personal' | 'Work', from, until, floor, standard, stretch },
 * `phases` rows { name, kind, start, end }. Returns a row per date from
 * `start` to the day before `exam`.
 */
function modelDays({ start, exam, following = 'Standard' }, week, phases) {
  const inSpan = (d, a, b) => (!a || a <= d) && (!b || d <= b);
  const spans = phases.filter((p) => p.start && p.end && p.start <= p.end);
  const study = spans.filter((p) => p.kind === 'Study').sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  const out = [];
  let running = 0;
  for (let d = start; d < exam; d = addDays(d, 1)) {
    const wd = weekdayOf(d);
    const h = { work: 0, floor: 0, standard: 0, stretch: 0 };
    for (const w of week) {
      if (!w.days.includes(wd) || !inSpan(d, w.from, w.until)) continue;
      if (w.account === 'Work') h.work += w[following.toLowerCase()];
      else { h.floor += w.floor; h.standard += w.standard; h.stretch += w.stretch; }
    }
    const off = spans.find((p) => (p.kind === 'Rest' || p.kind === 'Holiday') && inSpan(d, p.start, p.end));
    if (off) { h.work = 0; h.floor = 0; h.standard = 0; h.stretch = 0; }
    const personal = h[following.toLowerCase()];
    const type = off ? off.kind : spans.some((p) => p.kind === 'Catch-up' && inSpan(d, p.start, p.end)) ? 'Catch-up' : h.work + personal > 0 ? 'Study' : 'Rest';
    running += h.work + personal;
    out.push({ date: d, type, phase: (study.find((p) => inSpan(d, p.start, p.end)) || { name: '' }).name, ...h, planned: h.work + personal, running });
  }
  return out;
}
const totalsOf = (days) => Object.fromEntries(PLANS.map((p) => [p, days.reduce((t, d) => t + d.work + d[p.toLowerCase()], 0)]));

// His draft. REFERENCE is the output of the rules in campaign/spring-2027/plan_days.py
// (branch exam7-campaign, its functions work and personal), run in Python on
// 2026-11-19: for each of the 134 days from Dec 7, 2026 to Apr 19, 2027, four
// digits: work, then the personal hours of Floor, Standard and Stretch.
const SPRING = { name: 'Spring 2027', start: '2026-12-07', exam: '2027-04-20', goal: 500 };
const REFERENCE = '02340234023402340000034503450234023402340234000003450345000000000000000000000000000000000000000000000000000000000234023402340234000003450345023402340234223400000345034522342234223422340000000000002234223422342234000003450345223422342234223400000345034522342234223422340000000000002344234423442344000003450345234423442344234400000345034523442344234423440000034503452344234423442344000003450345234423442344234400000000000023442344234423440000034503452344234423442344000000000345434643464346434640020345034542444244424442444244068804480000';
const REFERENCE_DAYS = Array.from({ length: REFERENCE.length / 4 }, (_, i) => ({ date: addDays(SPRING.start, i), work: Number(REFERENCE[4 * i]), floor: Number(REFERENCE[4 * i + 1]), standard: Number(REFERENCE[4 * i + 2]), stretch: Number(REFERENCE[4 * i + 3]) }));
const REFERENCE_TOTALS = { Floor: 385, Standard: 486, Stretch: 557 };
// The same draft as rows the request's model allows: these are what the probe
// enters into Week and Phases. Phase 0 checks that the model over these rows
// gives REFERENCE day for day, so the rows are a true transcription.
const MON_THU = ['Mon', 'Tue', 'Wed', 'Thu']; const MON_FRI = [...MON_THU, 'Fri'];
const wk = (name, days, account, from, until, floor, standard, stretch) => ({ name, days, account, from, until, floor, standard, stretch });
const SPRING_WEEK = [
  wk('Mornings', MON_THU, 'Personal', '2026-12-07', '2027-04-11', 2, 2, 2),
  wk('Evenings before the ramp', MON_THU, 'Personal', '2026-12-07', '2027-02-14', 0, 1, 2),
  wk('Evenings from the ramp', MON_THU, 'Personal', '2027-02-15', '2027-04-11', 1, 2, 2),
  wk('Weekends', ['Sat', 'Sun'], 'Personal', '2026-12-07', '2027-04-11', 3, 4, 5),
  wk('Half days, extra', MON_FRI, 'Personal', '2027-04-05', '2027-04-11', 0, 0, 2),
  wk('Off work, weekdays', MON_FRI, 'Personal', '2027-04-12', '2027-04-16', 2, 4, 4),
  wk('Off work, Saturday', ['Sat'], 'Personal', '2027-04-17', '2027-04-17', 6, 8, 8),
  wk('Off work, Sunday', ['Sun'], 'Personal', '2027-04-18', '2027-04-18', 4, 4, 8),
  wk('Work study', MON_THU, 'Work', '2027-01-14', '2027-04-04', 2, 2, 2),
  wk('Work study, last two weeks', MON_FRI, 'Work', '2027-04-05', '2027-04-16', 4, 4, 4),
];
const ph = (name, kind, start, end, items = null, minutes = null) => ({ name, kind, start, end, items, minutes });
const SPRING_PHASES = [
  ph('Read only', 'Study', '2026-12-07', '2026-12-20'),
  ph('Read and notes', 'Study', '2027-01-04', '2027-01-24'),
  ph('Read, problems, recipes', 'Study', '2027-01-25', '2027-02-14'),
  ph('Every problem, mixed', 'Study', '2027-02-15', '2027-03-21'),
  ph('Hard ones + source review', 'Study', '2027-03-22', '2027-04-04'),
  ph('Practice exams + mixed quizzes', 'Study', '2027-04-05', '2027-04-18'),
  ph('Holidays', 'Holiday', '2026-12-21', '2027-01-03'),
  ph('Rest, January', 'Rest', '2027-01-22', '2027-01-24'),
  ph('Rest, February', 'Rest', '2027-02-12', '2027-02-14'),
  ph('Rest, March', 'Rest', '2027-03-19', '2027-03-21'),
  ph('Rest, April 3', 'Rest', '2027-04-03', '2027-04-03'),
  ph('Catch-up, January', 'Catch-up', '2027-01-21', '2027-01-21'),
  ph('Catch-up, February', 'Catch-up', '2027-02-11', '2027-02-11'),
  ph('Catch-up, March', 'Catch-up', '2027-03-18', '2027-03-18'),
  ph('Catch-up, April', 'Catch-up', '2027-04-01', '2027-04-01'),
];
/** What differs between days as found and days as wanted: the first few, in words. */
function dayDiffs(got, want, keys = ['work', 'floor', 'standard', 'stretch']) {
  const out = [];
  const by = new Map(got.map((g) => [g.date, g]));
  for (const w of want) {
    const g = by.get(w.date);
    if (!g) { out.push(`${w.date}: no row`); continue; }
    const bad = keys.filter((k) => (typeof w[k] === 'number' ? Number(g[k] ?? 0) !== w[k] : String(g[k] ?? '') !== String(w[k] ?? '')));
    if (bad.length) out.push(`${w.date} ${weekdayOf(w.date)}: ${bad.map((k) => `${k} ${g[k] ?? 'empty'}, wanted ${w[k] === '' ? 'empty' : w[k]}`).join('; ')}`);
  }
  for (const g of got) if (!want.some((w) => w.date === g.date)) out.push(`${g.date}: a row too many`);
  return out;
}
// </reference>

if (process.argv.includes('--reference')) {
  console.log(JSON.stringify(REFERENCE_DAYS.map((d) => [d.date, d.work, d.floor, d.standard, d.stretch])));
  process.exit(0);
}

// <page>
// What the probe reads off the page: a control by the name a person reads, the
// card on screen, a field of the dialog by its label, a cell of the table, and
// the bars with their parts.
function installPageHelpers() {
  const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  const shown = (n) => !!n && n.getClientRects().length > 0 && n.getBoundingClientRect().width > 0 && getComputedStyle(n).visibility !== 'hidden';
  const CLICKABLE = 'button, [role="button"], [role="menuitem"], [role="menuitemradio"], [role="option"], [role="radio"], [role="tab"], [role="treeitem"], [role="checkbox"], [role="switch"], a[href], summary, input[type="checkbox"], input[type="radio"]';
  const FIELDS = 'input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"]), textarea, select, [role="combobox"], [role="radiogroup"], [role="listbox"], [role="group"], button[aria-haspopup]';
  const form = () => { const all = Array.from(document.querySelectorAll('[role="dialog"], .parallx-modal-box, .st-sheet')).filter(shown); return all.length ? all[all.length - 1] : null; };
  const scopeEl = (scope) => {
    if (scope === 'root') { const roots = Array.from(document.querySelectorAll('.st-root')).filter(shown); return roots.find((r) => r.closest('.editor-group--active')) || roots[0] || null; }
    if (scope === 'sidebar') return document.querySelector('[data-part-id="workbench.parts.sidebar"]');
    if (scope === 'editor') return document.querySelector('[data-part-id="workbench.parts.editor"]');
    // The tab in front: what the active group shows under its tabs.
    if (scope === 'pane') return Array.from(document.querySelectorAll('.editor-group--active .editor-pane-container, .editor-pane-container')).find(shown) || document.querySelector('[data-part-id="workbench.parts.editor"]');
    if (scope === 'form') return form();
    if (scope === 'body') return document.body;
    return Array.from(document.querySelectorAll(scope)).find(shown) || null;
  };
  // The name a person reads: the words on the control; its tooltip only when it shows no words (an icon).
  const namesOf = (n) => {
    const words = norm(n.textContent);
    return (words ? [n.getAttribute('aria-label'), words] : [n.getAttribute('aria-label'), n.getAttribute('title'), n.getAttribute('data-parallx-title')]).map(norm).filter(Boolean);
  };
  /** The name a screen reader speaks: aria-label, else what aria-labelledby points at. */
  const spokenName = (n) => {
    const own = norm(n.getAttribute('aria-label'));
    if (own) return own;
    const by = n.getAttribute('aria-labelledby');
    return by ? norm(by.split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ')) : '';
  };
  const labelsOf = (n) => {
    const out = [n.getAttribute('aria-label')];
    const by = n.getAttribute('aria-labelledby');
    if (by) out.push(by.split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' '));
    if (n.id) { const l = document.querySelector(`label[for="${CSS.escape(n.id)}"]`); if (l) out.push(l.textContent); }
    const wrap = n.closest('label'); if (wrap) out.push(wrap.textContent);
    out.push(n.getAttribute('placeholder'), n.getAttribute('title'));
    return out.map(norm).filter(Boolean);
  };
  const point = (n) => {
    let r = n.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) { n.scrollIntoView({ block: 'center', inline: 'center' }); r = n.getBoundingClientRect(); }
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  };
  const fieldValue = (n) => {
    if (n.tagName === 'SELECT') return norm(n.selectedOptions[0]?.textContent);
    if (n.tagName === 'INPUT' || n.tagName === 'TEXTAREA') return n.value;
    const on = n.querySelector('[aria-checked="true"], [aria-selected="true"], input:checked');
    if (on) return norm(on.tagName === 'INPUT' ? (labelsOf(on)[0] || '') : on.textContent || on.getAttribute('aria-label'));
    return norm(n.textContent);
  };
  const table = (dbId) => {
    const surfaces = Array.from(document.querySelectorAll('[data-px-surface="database"]')).filter(shown);
    const s = dbId ? surfaces.find((e) => (e.getAttribute('data-px-instance') || '').endsWith(dbId)) : surfaces[0];
    return s ? { surface: s, heads: Array.from(s.querySelectorAll('.canvas-db-th__name')).map((h) => norm(h.textContent)), rows: Array.from(s.querySelectorAll('tr.canvas-db-row')) } : null;
  };
  // A colour as the browser computed it: rgb(), rgba() or color(srgb …).
  const colour = (s) => {
    const str = String(s || '');
    let m = /rgba?\(([^)]+)\)/.exec(str);
    if (m) { const p = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; }
    m = /color\(srgb\s+([^)]+)\)/.exec(str);
    if (m) { const p = m[1].split(/[\s/]+/).filter(Boolean).map(parseFloat); return { r: p[0] * 255, g: p[1] * 255, b: p[2] * 255, a: p.length > 3 ? p[3] : 1 }; }
    return null;
  };
  /** The opaque colour an element sits on. */
  const ground = (e) => {
    const layers = [];
    for (let p = e; p; p = p.parentElement) { const c = colour(getComputedStyle(p).backgroundColor); if (c && c.a > 0) { layers.push(c); if (c.a >= 0.999) break; } }
    let base = { r: 255, g: 255, b: 255, a: 1 };
    for (const c of layers.reverse()) base = { r: c.r * c.a + base.r * (1 - c.a), g: c.g * c.a + base.g * (1 - c.a), b: c.b * c.a + base.b * (1 - c.a), a: 1 };
    return base;
  };
  const over = (c, base) => (c ? { r: c.r * c.a + base.r * (1 - c.a), g: c.g * c.a + base.g * (1 - c.a), b: c.b * c.a + base.b * (1 - c.a) } : null);
  window.__ap = {
    shown, scopeEl, colour, ground, over, norm, spokenName, namesOf, point, CLICKABLE,
    has: (scope, sel) => { const s = scopeEl(scope); return !!s && Array.from(s.querySelectorAll(sel)).some(shown); },
    text: (scope) => { const s = scopeEl(scope); return s ? String(s.innerText || '') : ''; },
    /** Visible controls in `scope` whose name (label, text or title) matches. */
    find(scope, source, flags, sel) {
      const s = scopeEl(scope);
      if (!s) return [];
      const re = new RegExp(source, flags);
      const out = [];
      for (const n of s.querySelectorAll(sel || CLICKABLE)) {
        if (!shown(n)) continue;
        const name = namesOf(n).find((x) => re.test(x));
        if (name === undefined) continue;
        const pressed = n.getAttribute('aria-pressed') ?? n.getAttribute('aria-checked') ?? n.getAttribute('aria-selected') ?? (n.tagName === 'INPUT' && (n.type === 'checkbox' || n.type === 'radio') ? String(n.checked) : null);
        out.push({ ...point(n), name, disabled: !!n.disabled || n.getAttribute('aria-disabled') === 'true', pressed, tag: n.tagName, popup: n.getAttribute('aria-haspopup') || '' });
      }
      return out;
    },
    field(source, flags) {
      const f = form();
      if (!f) return null;
      const re = new RegExp(source, flags);
      for (const n of f.querySelectorAll(FIELDS)) {
        if (!shown(n)) continue;
        const label = labelsOf(n).find((x) => re.test(x));
        if (label === undefined) continue;
        document.querySelectorAll('[data-probe-field]').forEach((x) => x.removeAttribute('data-probe-field'));
        n.setAttribute('data-probe-field', '1');
        return { ...point(n), label, tag: n.tagName, role: n.getAttribute('role') || '', type: n.getAttribute('type') || '', value: fieldValue(n), disabled: !!n.disabled, options: n.tagName === 'SELECT' ? Array.from(n.options).map((o) => norm(o.textContent)) : null };
      }
      return null;
    },
    formOpen: () => !!form(),
    formText: () => { const f = form(); return f ? String(f.innerText || '') : ''; },
    /** The deepest visible element in `scope` whose words are exactly `text`, after the element whose words are `after` (document order). */
    textPoint(scope, text, after) {
      const s = scopeEl(scope);
      if (!s) return null;
      const deepest = (want) => Array.from(s.querySelectorAll('*')).filter((n) => shown(n) && norm(n.innerText) === want && !Array.from(n.children).some((c) => shown(c) && norm(c.innerText) === want));
      const re = after ? new RegExp(after, 'i') : null;
      const anchor = re ? Array.from(s.querySelectorAll('*')).filter((n) => shown(n) && re.test(norm(n.innerText)) && !Array.from(n.children).some((c) => shown(c) && re.test(norm(c.innerText))))[0] : null;
      if (after && !anchor) return null;
      const follows = (n) => !anchor || (anchor.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING);
      const want = norm(text);
      const withCount = (n) => { const t = norm(n.innerText); return t.startsWith(`${want} `) && /^\W{0,3}\d+ of \d+$/.test(t.slice(want.length).trim()); };
      const hit = deepest(want).find(follows) || Array.from(s.querySelectorAll('*')).filter((n) => shown(n) && follows(n) && withCount(n) && !Array.from(n.children).some((c) => shown(c) && withCount(c)))[0];
      return hit ? point(hit) : null;
    },
    /** The question on screen, or null. */
    card() {
      const r = scopeEl('root');
      const c = r && Array.from(r.querySelectorAll('.st-card')).find(shown);
      if (!c) return null;
      const fb = Array.from(r.querySelectorAll('.st-fb')).find((f) => f.classList.contains('st-fb--show') && shown(f)) || null;
      const field = Array.from(c.querySelectorAll('textarea, input[type="text"], input:not([type])')).find(shown) || null;
      return {
        stem: norm(c.querySelector('.st-card__q')?.innerText),
        options: Array.from(c.querySelectorAll('.st-opt')).filter(shown).length,
        field: field ? { ...point(field), value: field.value, disabled: !!field.disabled } : null,
        verdict: fb ? norm(fb.querySelector('.st-fb__text')?.innerText || fb.innerText).slice(0, 80) : '',
      };
    },
    results: () => { const r = scopeEl('root'); return !!r && Array.from(r.querySelectorAll('.st-res')).some(shown); },
    tabs: () => Array.from(document.querySelectorAll('.ui-tab')).map((t) => { const l = t.querySelector('.ui-tab-label') || t; return { id: t.getAttribute('data-tab-id') || '', active: t.classList.contains('ui-tab--active'), label: norm(t.querySelector('.ui-tab-label')?.textContent), ...point(l) }; }),
    tableState(dbId) { const t = table(dbId); return t ? { heads: t.heads, titles: t.rows.map((r) => norm(r.querySelector('.canvas-db-cell__titletext')?.textContent)) } : null; },
    cell(dbId, rowTitle, column) {
      const t = table(dbId);
      if (!t) return null;
      const i = t.heads.findIndex((h) => h.toLowerCase() === String(column).toLowerCase());
      const tr = t.rows.find((r) => norm(r.querySelector('.canvas-db-cell__titletext')?.textContent) === norm(rowTitle));
      if (i < 0 || !tr) return null;
      const td = tr.querySelectorAll('td[role="gridcell"]')[i];
      if (!td) return null;
      const target = td.querySelector('.canvas-db-cell__titletext, .canvas-db-cell__value, .canvas-db-checkbtn') || td;
      const says = [td, ...td.querySelectorAll('*')].flatMap((n) => [n.getAttribute('title'), n.getAttribute('aria-label'), n.getAttribute('data-parallx-title'), n.getAttribute('aria-description')]).concat(td.innerText).map(norm).filter(Boolean).join(' | ');
      return { ...point(target), text: norm(td.innerText), editable: td.dataset.editable === 'true', says };
    },
    editorOpen: () => { const a = document.activeElement; return !!a && !!a.closest('[data-px-surface="database"]') && (a.matches('input, textarea, [contenteditable="true"]')); },
    /** What has the focus, and how it looks while it has it. */
    focused() {
      const drawn = (cs) => {
        const line = colour(cs.outlineColor);
        if (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0 && line && line.a > 0) return true;
        // A shadow counts when it has a colour and a size: the app's resting "0 0 0 0 transparent" does not.
        return String(cs.boxShadow || 'none').split(/,(?![^(]*\))/).some((part) => { const k = colour(part); const sizes = (part.replace(/rgba?\([^)]*\)|color\([^)]*\)/g, '').match(/-?[\d.]+px/g) || []).map(parseFloat); return !!k && k.a > 0 && sizes.some((v) => v !== 0); });
      };
      const a = document.activeElement;
      if (!a || a === document.body) return null;
      const cs = getComputedStyle(a);
      return { name: spokenName(a) || norm(a.textContent) || norm(a.getAttribute('title')), tag: a.tagName, role: a.getAttribute('role') || '', inPane: !!scopeEl('pane')?.contains(a),
        ring: `${cs.outlineStyle}|${parseFloat(cs.outlineWidth) || 0}|${cs.outlineColor}|${cs.boxShadow}`, hasRing: drawn(cs), keyboard: a.matches(':focus-visible') };
    },
  };
  return true;
}
// </page>

// <plan>
// What the probe reads off the plan's tab: the day table, a part of the tab by
// its name, the smallest block that holds some words, how a day's row looks.
function installPlanHelpers() {
  const { shown, scopeEl, colour, ground, over, norm, spokenName, namesOf, point, CLICKABLE } = window.__ap;
  const pane = () => scopeEl('pane');
  const cellsOf = (tr) => Array.from(tr.children).filter((c) => c.tagName === 'TD' || c.tagName === 'TH');
  const dayTableEl = () => { const p = pane(); return p ? Array.from(p.querySelectorAll('table')).filter(shown).find((t) => t.querySelector('tr[data-date]')) || null : null; };
  const headRow = (t) => t.querySelector('thead tr') || Array.from(t.querySelectorAll('tr')).find((r) => !r.hasAttribute('data-date') && r.querySelectorAll('th').length > 3) || null;
  const headKeys = (t) => { const r = headRow(t); return r ? cellsOf(r).map((c) => norm(c.innerText || c.getAttribute('aria-label')).toLowerCase()) : []; };
  /** Is the element that carries data-date listed in a block that says "outside the plan" and holds no day of the plan? */
  const outside = (el, firstDate) => {
    const p = pane();
    for (let a = el; a && a !== p; a = a.parentElement) {
      if (/outside the plan/i.test(a.innerText || '')) return !a.querySelector(`[data-date="${firstDate}"]`) || a === el;
    }
    return false;
  };
  const inkOf = (cell) => {
    if (!cell) return null;
    const leaf = Array.from(cell.querySelectorAll('*')).filter((n) => shown(n) && norm(n.innerText) && !Array.from(n.children).some((k) => norm(k.innerText))).pop() || cell;
    const cs = getComputedStyle(leaf); const base = ground(leaf);
    return { fg: over(colour(cs.color), base), bg: base, weight: cs.fontWeight, style: cs.fontStyle };
  };
  const rgb = (c) => (c ? `${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)}` : 'none');
  window.__pp = {
    /** The table of days in the tab in front, as a screen reader finds it. `firstDate` is the plan's first day. */
    dayTable(firstDate) {
      const t = dayTableEl();
      if (!t) return null;
      const keys = headKeys(t);
      const hr = headRow(t);
      const bodies = Array.from(t.tBodies);
      let headerGroup = 0; let sawDay = false;
      const rows = [];
      for (const tr of t.querySelectorAll('tr')) {
        if (tr.closest('thead')) continue;
        if (!tr.hasAttribute('data-date')) { headerGroup += 1; continue; }
        sawDay = true;
        const cells = {};
        cellsOf(tr).forEach((cell, i) => { if (keys[i]) cells[keys[i]] = norm(cell.innerText); });
        const said = [tr, ...tr.querySelectorAll('*')].flatMap((n) => [n.getAttribute('aria-label'), n.getAttribute('title')]).map(norm).filter(Boolean).join(' | ');
        rows.push({
          date: tr.getAttribute('data-date'), cells, text: norm(tr.innerText), said, rowHeader: !!tr.querySelector('th'),
          current: tr.getAttribute('aria-current') || tr.querySelector('[aria-current]')?.getAttribute('aria-current') || '',
          body: bodies.indexOf(tr.closest('tbody')), headerGroup, outside: firstDate ? outside(tr, firstDate) : false,
        });
      }
      const inPlan = rows.filter((r) => !r.outside);
      const byBody = new Set(inPlan.map((r) => r.body)).size; const byHeader = new Set(inPlan.map((r) => r.headerGroup)).size;
      const groupOf = (r) => (byBody >= byHeader ? r.body : r.headerGroup);
      const sizes = {};
      for (const r of inPlan) sizes[groupOf(r)] = (sizes[groupOf(r)] || 0) + 1;
      return {
        caption: norm(t.caption?.innerText), heads: keys, headsAreTh: !!hr && cellsOf(hr).every((c) => c.tagName === 'TH'), sawDay,
        rows, groups: Object.keys(sizes).length, largestGroup: Math.max(0, ...Object.values(sizes)),
      };
    },
    /** Is the day `date` listed as outside the plan (anywhere in the tab)? */
    outsideListed(date, firstDate) {
      const p = pane();
      return !!p && Array.from(p.querySelectorAll(`[data-date="${date}"]`)).some((el) => shown(el) && outside(el, firstDate));
    },
    /** How a day's row looks, as one string, and the ink of its Type. */
    look(date) {
      const t = dayTableEl(); const tr = t && t.querySelector(`tr[data-date="${date}"]`);
      if (!tr) return null;
      const i = headKeys(t).indexOf('type'); const cell = cellsOf(tr)[i] || null;
      const ink = inkOf(cell); const first = cellsOf(tr)[0];
      const edge = (n) => { const cs = getComputedStyle(n); return parseFloat(cs.borderLeftWidth) >= 2 && cs.borderLeftStyle !== 'none' ? rgb(over(colour(cs.borderLeftColor), ground(n))) : 'none'; };
      const icon = cell ? Array.from(cell.querySelectorAll('svg, img, [class*="icon"]')).filter(shown).map((n) => n.getAttribute('data-icon') || n.getAttribute('class') || n.tagName).join('+') : '';
      const badge = cell ? Array.from(cell.querySelectorAll('*')).filter(shown).map((n) => rgb(over(colour(getComputedStyle(n).backgroundColor), ground(n.parentElement || n)))).join('/') : '';
      return { word: cell ? norm(cell.innerText) : '', look: [rgb(ground(tr)), cell ? rgb(ground(cell)) : '', badge, ink ? rgb(ink.fg) : '', ink ? `${ink.weight}${ink.style}` : '', icon, edge(tr), first ? edge(first) : ''].join(' | '), ink };
    },
    /** The smallest visible block in `scope` whose words match every pattern, when it is at most `max` characters. */
    block(scope, sources, max) {
      const s = scopeEl(scope);
      if (!s) return null;
      const res = sources.map((x) => new RegExp(x, 'i'));
      let best = null;
      for (const n of s.querySelectorAll('*')) {
        if (!shown(n)) continue;
        const text = norm(n.innerText);
        if (!text || text.length > max || !res.every((re) => re.test(text))) continue;
        if (!best || text.length < best.text.length) best = { n, text };
      }
      return best ? { text: best.text, ...point(best.n) } : null;
    },
    /** A part of the tab by its name: the words in it and its rows, top to bottom. */
    region(source) {
      const p = pane();
      if (!p) return null;
      const re = new RegExp(source, 'i');
      let el = Array.from(p.querySelectorAll('[aria-label], [aria-labelledby]')).find((n) => shown(n) && !n.matches(CLICKABLE) && re.test(spokenName(n))) || null;
      let via = 'name';
      if (!el) { const h = Array.from(p.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"], caption, legend')).find((n) => shown(n) && re.test(norm(n.innerText))); el = h ? h.parentElement : null; via = 'heading'; }
      if (!el) return null;
      const rows = Array.from(el.querySelectorAll('tr, li, [role="row"], [role="listitem"]')).filter((r) => shown(r) && norm(r.innerText) && !r.hasAttribute('data-date') && !(r.tagName === 'TR' && cellsOf(r).length && cellsOf(r).every((c) => c.tagName === 'TH')));
      return {
        via, text: norm(el.innerText),
        rows: rows.map((r) => ({ text: norm(r.innerText), y: r.getBoundingClientRect().y, controls: Array.from(r.querySelectorAll(CLICKABLE)).concat(r.matches(CLICKABLE) ? [r] : []).filter(shown).map((b) => ({ name: namesOf(b)[0] || '', ...point(b) })) })).sort((a, b) => a.y - b.y),
      };
    },
    /** Every control of the tab in front, with the name it has. */
    controls() {
      const p = pane();
      return p ? Array.from(p.querySelectorAll(`${CLICKABLE}, input, select, textarea`)).filter(shown).map((n) => ({ name: spokenName(n) || namesOf(n)[0] || '', tag: n.tagName, role: n.getAttribute('role') || '' })) : [];
    },
    /** What of the tab is cut off at this width: parts past the tab's right edge that no scroller holds. */
    cutOff() {
      const p = pane();
      if (!p) return null;
      const right = Math.min(p.getBoundingClientRect().right, window.innerWidth) + 1;
      const held = (n) => { for (let a = n.parentElement; a && a !== p.parentElement; a = a.parentElement) { const cs = getComputedStyle(a); if (/(auto|scroll)/.test(cs.overflowX) && a.scrollWidth > a.clientWidth) return true; } return false; };
      const cut = Array.from(p.querySelectorAll('th, td, button, [role="radio"], [role="button"], h1, h2, h3')).filter((n) => shown(n) && n.getBoundingClientRect().right > right && !held(n));
      return { width: window.innerWidth, pane: Math.round(p.getBoundingClientRect().width), pageScrolls: document.documentElement.scrollWidth > window.innerWidth + 1, cut: cut.slice(0, 5).map((n) => `${n.tagName} ${norm(n.innerText).slice(0, 30)}`), cutCount: cut.length };
    },
    inForm: () => { const f = Array.from(document.querySelectorAll('[role="dialog"], .parallx-modal-box, .st-sheet')).filter(shown).pop(); const a = document.activeElement; return !!f && !!a && f.contains(a); },
    focusShown: () => { const a = document.activeElement; return !!a && a !== document.body && shown(a) ? (spokenName(a) || namesOf(a)[0] || a.tagName) : ''; },
    unnamedFields: () => { const f = Array.from(document.querySelectorAll('[role="dialog"], .parallx-modal-box, .st-sheet')).filter(shown).pop(); return f ? Array.from(f.querySelectorAll('input:not([type="hidden"]), select, textarea, button')).filter((n) => shown(n) && !spokenName(n) && !norm(n.textContent) && !(n.id && document.querySelector(`label[for="${CSS.escape(n.id)}"]`)) && !n.closest('label') && !norm(n.getAttribute('title'))).length : -1; },
  };
  return true;
}
// </plan>

// ── One app ──────────────────────────────────────────────────────────────────
const TOOLS = { study: 'parallx-community.study' };
const TOOL_COMMAND = { study: 'study.open' };
const ZONE = process.env.PARALLX_PROBE_TZ || 'America/Chicago';
const pageErrors = [];
let shotN = 0;
async function launch(dir, workspace) {
  const appRoot = path.join(dir, 'app');
  await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: workspace }));
  const extDir = path.join(appRoot, 'ext');
  if (!existsSync(extDir)) {
    await fs.mkdir(extDir, { recursive: true });
    for (const d of await fs.readdir(path.join(REPO, 'ext'), { withFileTypes: true })) if (d.isDirectory()) await fs.symlink(path.join(REPO, 'ext', d.name), path.join(extDir, d.name), 'junction');
  }
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE') env[k] = v;
  Object.assign(env, { PARALLX_TEST_MODE: '1', PARALLX_RENDERER_PORT: '0', PARALLX_APP_ROOT: appRoot, PARALLX_USER_DATA: path.join(appRoot, 'data', 'chromium-cache'), TZ: ZONE });
  // Chromium refuses to run as root with its sandbox on (a container's user).
  const args = process.getuid?.() === 0 ? ['--no-sandbox', '.', '--mute-audio', '--disable-gpu'] : ['.', '--mute-audio', '--disable-gpu'];
  const app = await electron.launch({ executablePath: ELECTRON, args, cwd: REPO, env, timeout: 90_000 });
  const page = await app.firstWindow();
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 300)));
  await page.setViewportSize({ width: 1440, height: 900 }).catch(() => {});
  await page.waitForSelector('.parallx-ready', { state: 'attached', timeout: 120_000 });
  await page.waitForFunction(() => !!window.__parallx_workbench__?._services, null, { timeout: 60_000 });
  await page.waitForTimeout(1_200);
  const on = await page.evaluate(async (ids) => {
    const s = window.__parallx_workbench__._services.get({ id: 'IToolEnablementService' });
    try { for (const id of ids) await s.setEnablement(id, true); return true; } catch (e) { return String(e); }
  }, Object.values(TOOLS));
  if (on !== true) throw new Error(`Study could not be turned on: ${on}`);
  // Study has finished starting once its last registration (the chat tools) is in.
  await page.waitForFunction(() => { try { return !!window.__parallx_workbench__._services.get({ id: 'ILanguageModelToolsService' }).getTool('study_results'); } catch { return false; } }, null, { timeout: 60_000 });
  await page.waitForFunction((ids) => { try { const c = window.__parallx_workbench__._services.get({ id: 'ICommandService' }); return ids.every((id) => c.hasCommand(id)); } catch { return false; } }, Object.values(TOOL_COMMAND), { timeout: 60_000 });
  await page.waitForTimeout(600);
  await page.evaluate(installPageHelpers);
  await page.evaluate(installPlanHelpers);
  return { app, page };
}

/** The handle a phase works through. */
function makeSession({ dir, workspace }) {
  const S = {
    dir, workspace, app: null, page: null,
    async open() {
      const a = await launch(dir, workspace); S.app = a.app; S.page = a.page;
      // Seen once in three runs: the New Subject sheet's tab comes back with the app when the app was closed
      // soon after a subject was made. It is the piece before's, not this one's: it is cancelled and said.
      if ((await S.tabs()).some((t) => t.label === 'New Subject') && (await S.formOpen())) {
        (await S.press('form', /^cancel$/i, 'button')) || (await S.page.keyboard.press('Escape'));
        await sleep(600);
        console.log('   note: a "New Subject" tab came back with the app and was cancelled');
      }
    },
    async close() { try { await S.app?.close(); } catch { /* gone */ } S.app = null; S.page = null; },
    async relaunch() { await S.close(); await S.open(); },
    cmd: (id, ...args) => S.page.evaluate(async ({ id, args }) => {
      const svc = window.__parallx_workbench__._services.get({ id: 'ICommandService' });
      try { const r = await svc.executeCommand(id, ...args); return { ok: true, r: r === undefined ? null : (typeof r === 'object' ? JSON.parse(JSON.stringify(r)) : r) }; } catch (e) { return { ok: false, e: String((e && e.message) || e) }; }
    }, { id, args }),
    hasCommand: (id) => S.page.evaluate((id) => !!window.__parallx_workbench__._services.get({ id: 'ICommandService' }).hasCommand(id), id),
    commandIds: () => S.page.evaluate(() => { const c = window.__parallx_workbench__._services.get({ id: 'ICommandService' }); const m = c.getCommands?.(); return m ? [...(m.keys ? m.keys() : Object.keys(m))] : []; }),
    /** Start a command and do not wait for it: one that opens a dialog only returns when the dialog goes. */
    run: (id, ...args) => { void S.page.evaluate(({ id, args }) => { void window.__parallx_workbench__._services.get({ id: 'ICommandService' }).executeCommand(id, ...args).catch(() => {}); }, { id, args }).catch(() => {}); },
    /** One of the chat's own tools, run as the chat runs it. */
    tool: (name, args) => S.page.evaluate(async ({ name, args }) => {
      const t = window.__parallx_workbench__._services.get({ id: 'ILanguageModelToolsService' }).getTool(name);
      if (!t) return `no tool ${name}`;
      try { const r = await t.handler(args, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) }); return String((r && r.content) || ''); } catch (e) { return `threw: ${e && e.message}`; }
    }, { name, args }),
    shot: async (name) => { try { const f = path.join(OUT, 'shots', `${String(++shotN).padStart(2, '0')}-${name}.png`); await S.page.screenshot({ path: f }); return f; } catch { return ''; } },
    text: (scope = 'root') => S.page.evaluate((scope) => window.__ap.text(scope), scope),
    has: (scope, sel) => S.page.evaluate(({ scope, sel }) => window.__ap.has(scope, sel), { scope, sel }),
    card: () => S.page.evaluate(() => window.__ap.card()),
    tabs: () => S.page.evaluate(() => window.__ap.tabs()),
    focused: () => S.page.evaluate(() => window.__ap.focused()),
    find: (scope, re, sel) => S.page.evaluate(({ scope, source, flags, sel }) => window.__ap.find(scope, source, flags, sel), { scope, source: re.source, flags: re.flags, sel }),
    field: (re) => S.page.evaluate(({ source, flags }) => window.__ap.field(source, flags), { source: re.source, flags: re.flags }),
    formOpen: () => S.page.evaluate(() => window.__ap.formOpen()),
    formText: () => S.page.evaluate(() => window.__ap.formText()),
    textPoint: (scope, text, after) => S.page.evaluate(({ scope, text, after }) => window.__ap.textPoint(scope, text, after), { scope, text, after }),
    cell: (dbId, row, column) => S.page.evaluate(({ dbId, row, column }) => window.__ap.cell(dbId, row, column), { dbId, row, column }),
    /** Click, with the real mouse, the first enabled control in `scope` named like `re`. */
    async press(scope, re, sel) {
      const hit = (await S.find(scope, re, sel)).find((h) => !h.disabled);
      if (!hit) return null;
      await S.page.mouse.click(hit.x, hit.y);
      return hit;
    },
    click: (pt, opts) => S.page.mouse.click(pt.x, pt.y, opts),
    /** A tool turned on or off, as Settings does it; returns when its commands have come or gone. */
    async setTool(tool, on) {
      const r = await S.page.evaluate(async ({ id, on }) => { try { await window.__parallx_workbench__._services.get({ id: 'IToolEnablementService' }).setEnablement(id, on); return true; } catch (e) { return String(e); } }, { id: TOOLS[tool], on });
      if (r !== true) throw new Error(`${tool} could not be turned ${on ? 'on' : 'off'}: ${r}`);
      const at = Date.now();
      must(await until(async () => (await S.hasCommand(TOOL_COMMAND[tool])) === on, 30_000, 50), `${tool} turned ${on ? 'on' : 'off'} (its command ${TOOL_COMMAND[tool]})`);
      if (on && tool === 'study') await S.page.waitForFunction(() => { try { return !!window.__parallx_workbench__._services.get({ id: 'ILanguageModelToolsService' }).getTool('study_results'); } catch { return false; } }, null, { timeout: 30_000 });
      return at;
    },
  };
  return S;
}

/** The handle of a phase, with what the plan's checks read. */
function planSession(root) {
  const S = makeSession(root);
  /** Today as the app's own window has it, and its zone. */
  S.today = () => S.page.evaluate(() => { const n = new Date(); const p = (v) => String(v).padStart(2, '0'); return { date: `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())}`, zone: Intl.DateTimeFormat().resolvedOptions().timeZone, offset: n.getTimezoneOffset() }; });
  S.dayTable = (firstDate) => S.page.evaluate((d) => window.__pp.dayTable(d), firstDate || '');
  S.block = (scope, res, max = 260) => S.page.evaluate(({ scope, sources, max }) => window.__pp.block(scope, sources, max), { scope, sources: res.map((r) => (typeof r === 'string' ? esc(r) : r.source)), max });
  S.region = (re) => S.page.evaluate((source) => window.__pp.region(source), re.source);
  S.look = (date) => S.page.evaluate((d) => window.__pp.look(d), date);
  S.paneWords = async () => norm(await S.text('pane'));
  return S;
}

// ── Steps a person takes (Study as the pieces before left it) ───────────────
const sidebarShown = (S) => S.page.evaluate(() => { const sb = window.__ap.scopeEl('sidebar'); return !!sb && window.__ap.shown(sb) && /(^|\n)\s*Materials\b/.test(sb.innerText); });
async function showStudySidebar(S) {
  if (await sidebarShown(S)) return true;
  await S.press('body', /^Study$/, '.activity-bar-item');
  return !!(await until(() => sidebarShown(S), 5000));
}
/** The words of the sidebar's Subjects section, or null when there is none. */
async function subjectsText(S) {
  const lines = (await S.text('sidebar')).split('\n').map(norm).filter(Boolean);
  const i = lines.findIndex((l) => /^Subjects\b/i.test(l));
  if (i < 0) return null;
  const j = lines.findIndex((l, k) => k > i && /^(Materials|Review|Sessions|Question banks)\b/i.test(l));
  return lines.slice(i + 1, j < 0 ? undefined : j).join(' ');
}
/** A subject's (or a unit's) name under Subjects: where to click. A folded subject is opened once. */
async function subjectPoint(S, name, { under = null } = {}) {
  await showStudySidebar(S);
  let pt = await S.textPoint('sidebar', name, '^Subjects( \\d+)?$');
  if (!pt && under) { const parent = await S.textPoint('sidebar', under, '^Subjects( \\d+)?$'); if (parent) { await S.click(parent); await sleep(500); pt = await S.textPoint('sidebar', name, '^Subjects( \\d+)?$'); } }
  return pt;
}
const MENU_ITEMS = '[role="menuitem"], [role="menuitemradio"], [role="option"], .parallx-quickpick-row';
/** The subject's More Actions menu, opened: its items in order. */
async function subjectMenu(S, subject) {
  const row = must(await subjectPoint(S, subject), `the subject "${subject}" under Subjects in the sidebar`);
  await S.page.mouse.move(row.x, row.y);
  await sleep(250);
  const more = (await S.find('sidebar', /^More Actions/i)).filter((h) => !h.disabled).sort((a, b) => Math.abs(a.y - row.y) - Math.abs(b.y - row.y))[0];
  if (!more || Math.abs(more.y - row.y) > 40) return null;
  await S.click(more);
  await sleep(450);
  return (await S.find('body', /./, '[role="menuitem"], [role="menuitemradio"]')).filter((h) => h.y > 48).map((h) => ({ name: h.name, x: h.x, y: h.y }));
}
const F = { name: /^(subject )?name\b/i, questions: /^questions?\b/i };
const MAP_ANSWER = /^answer\b/i;
const CONFIRM = [/^(create|create subject|new subject|add subject)\b/i, /^(continue|next)\b/i, /^(done|ok|save|use|adopt|confirm|finish)\b/i];
async function pressConfirm(S) {
  for (const re of CONFIRM) {
    const hit = (await S.find('form', re, 'button')).find((h) => !h.disabled && !/add a column|browse|choose|cancel/i.test(h.name));
    if (hit) { await S.click(hit); return hit; }
  }
  return null;
}
async function chooseIn(S, re, option) {
  const f = await S.field(re);
  if (!f) return { ok: false, why: 'no such field' };
  if (f.tag === 'SELECT') {
    const label = (f.options || []).find((o) => option.test(o));
    if (!label) return { ok: false, why: 'not offered', offered: f.options };
    await S.page.selectOption('[data-probe-field]', { label });
    return { ok: true };
  }
  const inForm = (await S.find('form', option, '[role="radio"], [role="option"], input[type="radio"], label')).find((h) => !h.disabled);
  if (inForm && /radiogroup|listbox|group/.test(f.role)) { await S.click(inForm); return { ok: true }; }
  await S.click(f);
  await sleep(400);
  const hit = await S.press('body', option, MENU_ITEMS);
  if (!hit) { await S.page.keyboard.press('Escape'); return { ok: false, why: 'not offered' }; }
  await sleep(300);
  return { ok: true };
}
/** New Subject…, as a person fills it in (the piece before). `questions` is the title of an existing database. */
async function newSubject(S, { name, questions = null }) {
  S.run('study.newSubject');
  must(await until(() => S.formOpen(), 6000), 'the New Subject dialog after study.newSubject');
  await sleep(400);
  const nameField = must(await S.field(F.name), 'the Name field of the New Subject dialog');
  await S.click(nameField); await S.page.keyboard.press('Control+A'); await S.page.keyboard.type(name);
  if (questions) { const r = await chooseIn(S, F.questions, exact(questions)); if (!r.ok) throw new Error(`"${questions}" could not be chosen as the Questions: ${JSON.stringify(r)}`); }
  await sleep(300);
  let mapped = false;
  for (let step = 0; step < 4; step++) {
    if (!(await S.formOpen())) break;
    if (questions && !mapped && (await S.field(MAP_ANSWER))) mapped = true;
    must(await pressConfirm(S), `a button to confirm the New Subject dialog (it shows: ${norm(await S.formText()).slice(0, 160)})`);
    await until(async () => !(await S.formOpen()) || (questions && !mapped && (await S.field(MAP_ANSWER))), 6000);
    await sleep(300);
  }
  if (await S.formOpen()) throw new Error(`the New Subject dialog did not close: ${norm(await S.formText()).slice(0, 200)}`);
}
function subjectOf(ws, name) {
  const page = pagesTitled(ws, name)[0] || null;
  const under = page ? databases(ws, page.id) : [];
  const named = (t) => under.find((d) => low(d.title) === t.toLowerCase()) || null;
  return { page, under, units: named('Units'), questions: named('Questions'), log: named('Work Log') };
}
const waitSubject = (S, name, ms = 15_000) => until(() => { const s = subjectOf(S.workspace, name); return s.page && s.units && s.log ? s : null; }, ms, 150);

// The canvas table, with the mouse and the keys.
async function openDb(S, dbId) {
  await S.cmd('canvas.openPage', dbId);
  return !!(await until(() => S.page.evaluate((dbId) => !!window.__ap.tableState(dbId)?.heads?.length, dbId), 8000));
}
/** Type `text` into a cell's editor and press Enter. Returns the moment Enter was pressed, or null when the cell opens no editor. */
async function typeCell(S, dbId, rowTitle, column, text) {
  const cell = must(await until(() => S.cell(dbId, rowTitle, column), 4000), `the cell ${column} of "${String(rowTitle).slice(0, 40)}" in the table`);
  await sleep(250);                                   // the table may have scrolled to the row
  await S.click((await S.cell(dbId, rowTitle, column)) || cell);
  const open = await until(() => S.page.evaluate(() => window.__ap.editorOpen()), 1500, 60);
  if (!open) return null;
  await S.page.keyboard.press('Control+A');
  await S.page.keyboard.type(String(text));
  await S.page.keyboard.press('Enter');
  return Date.now();
}
/** Click a checkbox cell. Returns the moment of the click. */
async function clickCell(S, dbId, rowTitle, column) {
  const cell = must(await until(() => S.cell(dbId, rowTitle, column), 4000), `the cell ${column} of "${String(rowTitle).slice(0, 40)}" in the table`);
  await sleep(250);
  await S.click((await S.cell(dbId, rowTitle, column)) || cell);
  return Date.now();
}
async function deleteRow(S, dbId, rowTitle) {
  const cell = must(await S.cell(dbId, rowTitle, 'Name'), `the row "${rowTitle.slice(0, 40)}" in the table`);
  await S.click(cell, { button: 'right' });
  await sleep(400);
  must(await S.press('body', /^Delete Row/, MENU_ITEMS), 'Delete Row… in the row\'s menu');
  await sleep(400);
  must(await S.press('body', /^Delete Row$/, '.parallx-modal-box button'), 'the Delete Row button of the question');
  await sleep(600);
}
/** A row deleted from its menu in the table, once the table has scrolled to it. */
async function removeRow(S, dbId, rowTitle) {
  must(await until(() => S.cell(dbId, rowTitle, 'Name'), 4000), `the row "${String(rowTitle).slice(0, 40)}" in the table, under the column Name`);
  await sleep(350);
  await deleteRow(S, dbId, rowTitle);
}
const tabTitled = async (S, title) => (await S.tabs()).filter((t) => t.label === title);
/** Bring the tab titled `title` to the front with the mouse; false when there is none. */
async function showTab(S, title) {
  const t = (await tabTitled(S, title))[0];
  if (!t) return false;
  if (!t.active) { await S.click(t); await until(async () => (await tabTitled(S, title)).some((x) => x.active), 3000, 50); }
  return true;
}
async function closeTab(S, title) {
  if (!(await showTab(S, title))) return false;
  await S.press('body', /./, '.ui-tab--active .ui-tab-close');
  return !!(await until(async () => (await tabTitled(S, title)).length === 0, 3000));
}
/** A page or a database moved to the Trash by the canvas's own command, its question answered. */
async function toTrash(S, pageId) {
  S.run('canvas.deletePage', pageId);
  must(await until(() => S.press('body', /^Move to Trash$/, 'button'), 5000), 'the Move to Trash button of the canvas\'s question');
  await sleep(400);
}
async function setMode(S, mode) {
  await S.cmd('settings.openAppearance');
  const sel = `[data-px-id="appearance.mode.${mode}"]`;
  must(await until(() => S.press('body', /./, sel), 8000), `Appearance's ${mode} mode`);
  await sleep(600);
  await S.press('body', /./, '.ui-tab--active .ui-tab-close');
  await sleep(400);
}
const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const ratio = (a, b) => { const A = lum(a), B = lum(b); return (Math.max(A, B) + 0.05) / (Math.min(A, B) + 0.05); };
async function seedDatabase(S, title, properties, rows) {
  const made = await S.tool('canvas_create_database', { title, properties });
  const id = must((/id: ([0-9a-f-]{20,})/i.exec(made) || [])[1], `the id of the seeded database "${title}" (${made.slice(0, 120)})`);
  const failed = await S.page.evaluate(async ({ id, rows }) => {
    const t = window.__parallx_workbench__._services.get({ id: 'ILanguageModelToolsService' }).getTool('canvas_add_database_row');
    const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };
    let bad = 0;
    for (const r of rows) { const out = await t.handler({ databaseId: id, title: r.title, values: r.values }, token); if (out?.isError || /skipped|not set/i.test(String(out?.content))) bad++; }
    return bad;
  }, { id, rows });
  if (failed) throw new Error(`${failed} seeded rows of "${title}" were not stored as given`);
  return id;
}

// ── The plan: making it, and reading it from the file and from the tab ──────
const SUBJECT = 'Exam 7';
const week7 = (monThu, fri, sat, sun) => ({ Mon: monThu, Tue: monThu, Wed: monThu, Thu: monThu, Fri: fri, Sat: sat, Sun: sun });
// The plan most phases start from: eight whole weeks, Monday to Sunday.
const BASIC = { name: 'Winter Block', start: '2027-01-04', exam: '2027-03-01', goal: 200, personal: week7(2, 0, 4, 0), work: week7(1, 2, 0, 0) };
const BASIC_TOTALS = { Floor: 104, Standard: 144, Stretch: 184 };
/** The usual week of the sheet as Week rows of the model: the Floor less, the Stretch more, a day with no personal hours at none. */
const formWeek = (spec) => WEEKDAYS.flatMap((d) => {
  const p = spec.personal[d] || 0; const w = spec.work[d] || 0; const less = spec.less ?? 1; const more = spec.more ?? 1;
  return [p ? wk(`${d} personal`, [d], 'Personal', '', '', Math.max(0, p - less), p, p + more) : null, w ? wk(`${d} work`, [d], 'Work', '', '', w, w, w) : null].filter(Boolean);
});
const lastDay = (spec) => addDays(spec.exam, -1);
/** The days the sheet's Create must give, with the one Study phase named `phaseName`. */
const formDays = (spec, phaseName = '', following = 'Standard') => modelDays({ start: spec.start, exam: spec.exam, following }, formWeek(spec), [ph(phaseName, 'Study', spec.start, lastDay(spec))]);

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** A date as a person may read it: "Apr 20, 2027", "April 20", "20 Apr 2027", "2027-04-20", "4/20/2027". */
function dateWords(iso, year = false) {
  const [y, m, d] = iso.split('-').map(Number);
  const mon = `${MONTHS[m - 1].slice(0, 3)}(?:${MONTHS[m - 1].slice(3)})?\\.?`;
  return new RegExp([`${mon}\\s+${d}(?:st|nd|rd|th)?${year ? `,?\\s+${y}` : '(?!\\d)'}`, `\\b${d}\\s+${mon}${year ? `,?\\s+${y}` : ''}`, iso, `\\b0?${m}/0?${d}${year ? `/${y}` : '(?!\\d)'}`].join('|'), 'i');
}
const DAY_REST = { Mon: 'day', Tue: 'sday', Wed: 'nesday', Thu: 'rsday', Fri: 'day', Sat: 'urday', Sun: 'day' };
const PF = {
  name: /^(plan )?name\b/i, exam: /^exam( date)?\b/i, start: /^start( date)?\b/i, goal: /^hours goal\b/i, floor: /\bfloor\b/i, stretch: /\bstretch\b/i,
  day: (d, account) => new RegExp(`^(?=.*\\b${d}(?:${DAY_REST[d]})?\\b)(?=.*\\b${account}\\b)`, 'i'),
};
const CREATE = /^create( plan)?$/i;
async function fillField(S, re, value, what) {
  const f = must(await S.field(re), what);
  if (f.tag === 'INPUT' && f.type === 'date') await S.page.locator('[data-probe-field]').fill(String(value));
  else { await S.click(f); await S.page.keyboard.press('Control+A'); await S.page.keyboard.type(String(value)); }
  await sleep(50);
}
/** study.newPlan, until its sheet is open. */
async function openPlanSheet(S) {
  if (!(await S.hasCommand('study.newPlan'))) throw new Error('there is no command study.newPlan');
  S.run('study.newPlan');
  const seen = await until(async () => ((await S.formOpen()) && (await S.field(PF.exam)) ? 'sheet' : (await S.find('body', new RegExp(`^${esc(SUBJECT)}(?![A-Za-z0-9])`), '.parallx-quickpick-row, [role="dialog"] [role="option"], .parallx-modal-box [role="option"]')).length ? 'asked' : null), 8000, 80);
  if (seen === 'asked') await S.press('body', new RegExp(`^${esc(SUBJECT)}(?![A-Za-z0-9])`), '.parallx-quickpick-row, [role="dialog"] [role="option"], .parallx-modal-box [role="option"]');
  must(await until(async () => (await S.formOpen()) && (await S.field(PF.exam)), 8000, 80), 'the New Plan sheet (a form with an Exam date field) after study.newPlan');
  await sleep(400);
}
/** The sheet filled in as a person does. Floor and Stretch are left as they are unless the plan says otherwise. */
async function fillPlanSheet(S, spec) {
  await fillField(S, PF.name, spec.name, 'the Name field of the New Plan sheet');
  await fillField(S, PF.exam, spec.exam, 'the Exam date field of the New Plan sheet');
  await fillField(S, PF.start, spec.start, 'the Start date field of the New Plan sheet');
  await fillField(S, PF.goal, spec.goal, 'the Hours goal field of the New Plan sheet');
  for (const d of WEEKDAYS) {
    await fillField(S, PF.day(d, 'Personal'), spec.personal[d] || 0, `the personal hours field of ${d} (a label with "${d}" and "Personal")`);
    await fillField(S, PF.day(d, 'Work'), spec.work[d] || 0, `the work hours field of ${d} (a label with "${d}" and "Work")`);
  }
  if (spec.less !== undefined) await fillField(S, PF.floor, spec.less, 'the field for how many hours less the Floor is');
  if (spec.more !== undefined) await fillField(S, PF.stretch, spec.more, 'the field for how many hours more the Stretch is');
}
const pressCreate = async (S) => { must(await S.press('form', CREATE, 'button'), `the Create button of the New Plan sheet (it shows: ${norm(await S.formText()).slice(0, 160)})`); return Date.now(); };
/** New Plan…, filled in and created. Returns the moment Create was pressed, with the plan's tab in front. */
async function makePlan(S, spec) {
  await openPlanSheet(S);
  await fillPlanSheet(S, spec);
  const at = await pressCreate(S);
  must(await until(async () => (await tabTitled(S, spec.name)).some((t) => t.active), 40_000, 50), `a tab titled "${spec.name}" in front after Create (the sheet says: ${norm(await S.formText()).slice(0, 200) || 'nothing'}; tabs: ${(await S.tabs()).map((t) => t.label).join(' | ')})`);
  return at;
}

/** A plan as the file has it: its page under the subject's page and the four databases by their exact names. */
function planOf(ws, name, subject = SUBJECT) {
  const subj = subjectOf(ws, subject);
  const page = subj.page ? pagesTitled(ws, name).find((p) => p.parent_id === subj.page.id) || null : null;
  const under = page ? databases(ws, page.id) : [];
  const named = (t) => under.find((d) => norm(d.title) === t) || null;
  return { name, subject: subj, page, under, plan: named('Plan'), week: named('Week'), phases: named('Phases'), days: named('Days') };
}
const wholePlan = (p) => !!(p.page && p.plan && p.week && p.phases && p.days);
const mustPlan = (ws, name) => { const p = planOf(ws, name); if (!wholePlan(p)) throw new Error(`no page "${name}" under the subject's page with the databases Plan, Week, Phases and Days (found: ${p.page ? p.under.map((d) => d.title).join(', ') || 'no database' : 'no such page'})`); return p; };
const dateOf = (v) => (typeof v === 'string' ? v.slice(0, 10) : '');
/** The rules as the file has them, in the model's shape. */
function rulesIn(ws, p) {
  const row = rowsOf(ws, p.plan.id)[0] || { values: {} };
  return {
    planRow: row,
    plan: { start: dateOf(row.values['Start Date']), exam: dateOf(row.values['Exam Date']), goal: num(row.values['Hours Goal']), following: PLANS.includes(row.values.Following) ? row.values.Following : 'Standard' },
    week: rowsOf(ws, p.week.id).map((r) => ({ pageId: r.pageId, name: r.title, days: Array.isArray(r.values.Days) ? r.values.Days : [], account: r.values.Account ?? '', from: dateOf(r.values.From), until: dateOf(r.values.Until), floor: num(r.values.Floor), standard: num(r.values.Standard), stretch: num(r.values.Stretch) })),
    phases: rowsOf(ws, p.phases.id).map((r) => ({ pageId: r.pageId, name: r.title, kind: r.values.Kind ?? '', start: dateOf(r.values.Start), end: dateOf(r.values.End), items: r.values.Items ?? null, minutes: r.values['Minutes per Item'] ?? null })),
  };
}
/** The Days rows as the file has them, in date order. */
function daysIn(ws, p) {
  const phaseTitle = new Map(rowsOf(ws, p.phases.id).map((r) => [r.pageId, r.title]));
  const phaseName = (v) => (Array.isArray(v) ? v.map((id) => phaseTitle.get(id) ?? id).join(', ') : norm(v));
  return rowsOf(ws, p.days.id).map((r) => ({
    pageId: r.pageId, title: r.title, date: dateOf(r.values.Date), type: r.values.Type ?? '', phase: phaseName(r.values.Phase),
    work: num(r.values.Work), floor: num(r.values.Floor), standard: num(r.values.Standard), stretch: num(r.values.Stretch),
    planned: num(r.values.Planned), running: num(r.values.Running), done: num(r.values.Done), edited: r.values.Edited === true || r.values.Edited === 1, note: r.values.Note ?? '',
  })).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
const FILE_KEYS = ['type', 'phase', 'work', 'floor', 'standard', 'stretch', 'planned', 'running'];
const TAB_KEYS = ['type', 'phase', 'personal', 'work', 'total', 'running'];
/** Planned and Running again, after some days were set by hand. */
function rerun(days, following) {
  let running = 0;
  for (const d of days) { d.planned = d.work + d[following.toLowerCase()]; running += d.planned; d.running = running; }
  return days;
}
/** The days the rules in the file give. `kept` are days he edited: date -> the values that stay. */
function expectedDays(ws, p, kept = {}) {
  const r = rulesIn(ws, p);
  const days = modelDays(r.plan, r.week, r.phases);
  for (const d of days) if (kept[d.date]) Object.assign(d, kept[d.date]);
  return { rules: r, days: rerun(days, r.plan.following) };
}
const hoursIn = (t) => { const m = /-?\d+(?:\.\d+)?/.exec(String(t ?? '')); return m ? Number(m[0]) : 0; };
const wordIn = (t) => (/^[\s—–-]*$/.test(String(t ?? '')) ? '' : norm(t));
/** The days of the plan as the tab's table shows them (a day listed as outside the plan is left out). */
async function tabDays(S, firstDate) {
  const t = await S.dayTable(firstDate);
  if (!t) return null;
  return t.rows.filter((r) => !r.outside).map((r) => ({ date: r.date, type: wordIn(r.cells.type), phase: wordIn(r.cells.phase), personal: hoursIn(r.cells.personal), work: hoursIn(r.cells.work), total: hoursIn(r.cells.total), running: hoursIn(r.cells.running) }));
}
const asTab = (days, following) => days.map((d) => ({ date: d.date, type: d.type, phase: d.phase, personal: d[following.toLowerCase()], work: d.work, total: d.planned, running: d.running }));
/**
 * After a change stored at `t0`: how long until the Days rows in the file, and
 * then the tab, show the plan the rules now give. `outside` are dates of kept
 * days that the new dates leave out; `tab` brings the plan's tab to the front
 * first (the change was made in another tab).
 */
async function follows(S, p, t0, { kept = {}, outside = [], tab = null, ms = 8000 } = {}) {
  const ws = S.workspace;
  const want = () => expectedDays(ws, p, kept);
  const gotRows = () => daysIn(ws, p).filter((d) => !outside.includes(d.date));
  const rowsAt = await until(() => (dayDiffs(gotRows(), want().days, FILE_KEYS).length ? null : Date.now()), ms, 40);
  if (tab) await showTab(S, tab);
  const gotTab = async () => (await tabDays(S, want().rules.plan.start)) || [];
  const tabAt = await until(async () => { const w = want(); return dayDiffs(await gotTab(), asTab(w.days, w.rules.plan.following), TAB_KEYS).length ? null : Date.now(); }, ms, 60);
  const w = want();
  const out = { rowsMs: rowsAt ? Math.max(0, rowsAt - t0) : null, tabMs: tabAt ? Math.max(0, tabAt - t0) : null, days: w.days.length, totals: totalsOf(w.days) };
  if (!rowsAt) out.rowsDiffer = dayDiffs(gotRows(), w.days, FILE_KEYS).slice(0, 4);
  if (!tabAt) out.tabDiffers = dayDiffs(await gotTab(), asTab(w.days, w.rules.plan.following), TAB_KEYS).slice(0, 4);
  return out;
}
/** A change of the rules, and whether the days followed: `act` makes the change and returns the moment it was stored. */
async function ruleChange(S, p, act, opts = {}) {
  const before = JSON.stringify(expectedDays(S.workspace, p, opts.kept).days);
  const t0 = await act();
  if (!t0) return { stored: false };
  const r = await follows(S, p, t0, opts);
  r.planChanged = JSON.stringify(expectedDays(S.workspace, p, opts.kept).days) !== before;
  return r;
}
const inTime = (r, limit = 2000) => !!r && r.planChanged === true && r.rowsMs !== null && r.rowsMs <= limit && r.tabMs !== null && r.tabMs <= limit;

/** The chat's tool that sets one cell of a row. Returns the moment it answered; throws when it refused. */
async function setProp(S, pageId, propertyName, value) {
  const out = await S.tool('canvas_set_page_property', { pageId, propertyName, value });
  if (/not set|not found|threw|no tool|cannot|is required|not in any database/i.test(out)) throw new Error(`canvas_set_page_property ${propertyName}: ${out.slice(0, 160)}`);
  return Date.now();
}
/** The chat's tool that adds a row. Returns { at, pageId }. */
async function addRow(S, dbId, title, values) {
  const out = await S.tool('canvas_add_database_row', { databaseId: dbId, title, values });
  const pageId = (/page id: ([0-9a-f-]{20,})/i.exec(out) || [])[1];
  if (!pageId || /skipped|not set/i.test(out)) throw new Error(`canvas_add_database_row "${title}": ${out.slice(0, 200)}`);
  return { at: Date.now(), pageId };
}
const weekValues = (w) => ({ Days: w.days, Account: w.account, ...(w.from ? { From: w.from } : {}), ...(w.until ? { Until: w.until } : {}), Floor: w.floor, Standard: w.standard, Stretch: w.stretch });
const phaseValues = (p) => ({ Kind: p.kind, Start: p.start, End: p.end, ...(p.items !== null && p.items !== undefined ? { Items: p.items } : {}), ...(p.minutes !== null && p.minutes !== undefined ? { 'Minutes per Item': p.minutes } : {}) });

/** The plan's tab in front: as it is, or through "Open Plan" in the subject's More Actions. */
async function openPlan(S, name) {
  if (await showTab(S, name)) return;
  const items = must(await subjectMenu(S, SUBJECT), `the More Actions menu of "${SUBJECT}"`);
  const item = items.find((i) => /^Open Plan$/.test(i.name));
  if (!item) { await S.page.keyboard.press('Escape'); throw new Error(`no "Open Plan" in the subject's More Actions (it has: ${items.map((i) => i.name).join(', ')})`); }
  await S.click(item);
  must(await until(async () => (await tabTitled(S, name)).some((t) => t.active), 8000, 50), `a tab titled "${name}" in front after Open Plan`);
}
/** The tab's table with `n` days in it. */
const tabShows = (S, n, firstDate, ms = 10_000) => until(async () => { const d = await tabDays(S, firstDate); return d && d.length === n ? d : null; }, ms, 80);
/** The three controls that choose the plan he follows, and the one marked. */
async function chooser(S) {
  const all = (await S.find('pane', /^(Floor|Standard|Stretch)\b/)).filter((h) => h.pressed !== null);
  const by = Object.fromEntries(PLANS.map((p) => [p, all.find((h) => new RegExp(`^${p}\\b`).test(h.name)) || null]));
  const marked = PLANS.filter((p) => by[p] && by[p].pressed === 'true');
  return { by, marked, whole: PLANS.every((p) => by[p]) };
}
// Words that stand side by side on screen may reach the probe with nothing between them ("200Standard",
// "72 hAll Plans"), so a number ends where the digits end and a unit where its lower-case letters end.
const H = 'h(?![a-z])'; const DAYS = '[Dd]ays?(?![a-z])';
const totalWords = (plan, hours) => new RegExp(`(?<![A-Za-z])${plan}\\b\\D{0,30}(?<!\\d)${hours}\\s*${H}`);
const goalWords = (plan, hours, goal) => new RegExp(`(?<![A-Za-z])${plan}\\b\\D{0,30}(?<!\\d)${hours}\\s*${H}\\D{0,12}(?<!\\d)${Math.abs(goal - hours)}\\s+${hours < goal ? 'under' : 'over'}\\s+${goal}(?!\\d)`);
const count = (n, unit) => new RegExp(`(?<![\\d.])${n}\\s*${unit}`);
/** "0 h: 37 days, 2 h: 4 days" read into { hours: days }. */
const perDay = (text) => Object.fromEntries([...String(text || '').matchAll(/(\d+(?:\.\d+)?)\s*h\b\s*[:·,-]?\s*(\d+)\s+days?(?![a-z])/g)].map((m) => [m[1], Number(m[2])]));
const perDayOf = (days) => { const out = {}; for (const d of days) out[String(d.planned)] = (out[String(d.planned)] || 0) + 1; return out; };
/** The plan's name and its days left under the subject in the sidebar: the number, or null. */
async function sidebarPlan(S, name) {
  const t = await subjectsText(S);
  const m = t ? new RegExp(`${esc(name)}\\D{0,24}(-?\\d+)\\s+days?(?![a-z])`).exec(t) : null;
  return m ? Number(m[1]) : null;
}

// ── The phases ───────────────────────────────────────────────────────────────
const PHASES = [];
const phase = (n, title, base, checks, fn) => PHASES.push({ n, title, base, checks, fn });
/** One check that cannot stop the ones after it. `fn` returns [ok, what came back]. */
async function check(c, id, fn) {
  try { const [ok, got] = await fn(); c(id, ok, got); } catch (err) { c(id, false, `stopped: ${String((err && err.message) || err).split('\n')[0].slice(0, 300)}`); }
}

phase(0, 'The ground the checks stand on (the app as it is today, and the reference; none of it is new)', 'subject', {
  '0.1': 'the reference is his sheet: 134 days from Dec 7, 2026 to Apr 19, 2027, 385, 486 and 557 hours, 97 days with hours in Standard; and the draft as Week and Phases rows gives it day for day under the request\'s model',
  '0.2': 'the palette can be read (F1, then the words), and the subject\'s More Actions menu',
  '0.3': 'the chat\'s tool adds rows with tags, a select, a date, a number and a checkbox, and the file holds them as given',
  '0.4': 'a number is typed into a cell of the 131st row of a table, and a checkbox cell is clicked on and off',
  '0.5': 'the chat\'s tool sets a date, a select, tags and a number on a row, and empties a date',
  '0.6': 'a row is deleted in the table',
  '0.7': 'a Work Log row is added with a date and time and its minutes',
  '0.8': 'Study is turned off and on without a restart',
  '0.9': 'Appearance switches to light and back to dark, and the window can be made 900 px wide',
  '0.10': 'a database is put in the Trash by the canvas\'s own command',
  '0.11': 'the app runs in the zone the probe asked for, and gives today as a local date',
}, async (S, c, A) => {
  const ws = S.workspace;
  await check(c, '0.1', async () => {
    const days = modelDays({ start: SPRING.start, exam: SPRING.exam }, SPRING_WEEK, SPRING_PHASES);
    const diffs = dayDiffs(days, REFERENCE_DAYS);
    const totals = totalsOf(REFERENCE_DAYS);
    const withHours = REFERENCE_DAYS.filter((d) => d.work + d.standard > 0).length;
    // Whether a day has hours does not depend on the plan, so Type is the same whichever he follows.
    const oneType = days.every((d) => (d.work + d.floor > 0) === (d.work + d.stretch > 0) && (d.work + d.floor > 0) === (d.work + d.standard > 0));
    return [REFERENCE_DAYS.length === 134 && REFERENCE_DAYS[0].date === '2026-12-07' && REFERENCE_DAYS[133].date === '2027-04-19' && same(totals, REFERENCE_TOTALS) && withHours === 97 && diffs.length === 0 && oneType,
      { days: REFERENCE_DAYS.length, totals, withHoursInStandard: withHours, rowsAgainstReference: diffs.length ? diffs.slice(0, 5) : 'equal day for day' }];
  });
  await check(c, '0.2', async () => {
    await S.page.keyboard.press('F1');
    await sleep(500);
    await S.page.keyboard.type('New Subject');
    await sleep(700);
    const rows = (await S.find('body', /New Subject/i, '.parallx-quickpick-row, [role="option"]')).map((r) => r.name);
    await S.page.keyboard.press('Escape');
    await sleep(300);
    const items = await subjectMenu(S, SUBJECT);
    await S.page.keyboard.press('Escape');
    return [rows.some((r) => /Study: New Subject/.test(r)) && !!items && items.some((i) => /^Open Work Log$/.test(i.name)), { paletteRows: rows, menu: items ? items.map((i) => i.name) : null }];
  });
  let scratch = null;
  const rowName = (i) => `Row ${String(i).padStart(3, '0')}`;
  await check(c, '0.3', async () => {
    scratch = await seedDatabase(S, 'Scratch Rules', [{ name: 'Days', type: 'tags', options: WEEKDAYS }, { name: 'Account', type: 'select', options: ['Personal', 'Work'] }, { name: 'From', type: 'date' }, { name: 'Hours', type: 'number' }, { name: 'Edited', type: 'checkbox' }],
      Array.from({ length: 140 }, (_, i) => ({ title: rowName(i + 1), values: { Days: ['Mon', 'Thu'], Account: 'Personal', From: '2027-01-14', Hours: i + 1, Edited: false } })));
    const rows = rowsOf(ws, scratch); const r = rowTitled(ws, scratch, rowName(7));
    return [rows.length === 140 && !!r && same(r.values.Days, ['Mon', 'Thu']) && r.values.Account === 'Personal' && r.values.From === '2027-01-14' && r.values.Hours === 7, { rows: rows.length, row7: r ? r.values : null }];
  });
  await check(c, '0.4', async () => {
    must(await openDb(S, must(scratch, 'the scratch database')), 'the scratch database open in the app');
    const typed = await typeCell(S, scratch, rowName(131), 'Hours', 77);
    const stored = await until(() => rowTitled(ws, scratch, rowName(131))?.values.Hours === 77, 3000, 20);
    await clickCell(S, scratch, rowName(131), 'Edited');
    const on = await until(() => rowTitled(ws, scratch, rowName(131))?.values.Edited === true, 3000, 20);
    await sleep(300);
    await clickCell(S, scratch, rowName(131), 'Edited');
    const off = await until(() => rowTitled(ws, scratch, rowName(131))?.values.Edited === false, 3000, 20);
    return [!!typed && !!stored && !!on && !!off, { typed: !!typed, hours: rowTitled(ws, scratch, rowName(131))?.values.Hours, ticked: !!on, unticked: !!off }];
  });
  await check(c, '0.5', async () => {
    const r = must(rowTitled(ws, must(scratch, 'the scratch database'), rowName(3)), 'row 3');
    await setProp(S, r.pageId, 'From', '2027-02-15'); await setProp(S, r.pageId, 'Account', 'Work'); await setProp(S, r.pageId, 'Days', ['Sat', 'Sun']); await setProp(S, r.pageId, 'Hours', 2.5);
    const a = await until(() => { const v = rowTitled(ws, scratch, rowName(3))?.values; return v && v.From === '2027-02-15' && v.Account === 'Work' && same(v.Days, ['Sat', 'Sun']) && v.Hours === 2.5 ? v : null; }, 3000, 20);
    await setProp(S, r.pageId, 'From', '');
    const b = await until(() => { const v = rowTitled(ws, scratch, rowName(3))?.values; return v && !v.From ? v : null; }, 3000, 20);
    return [!!a && !!b, rowTitled(ws, scratch, rowName(3))?.values];
  });
  await check(c, '0.6', async () => {
    must(await openDb(S, must(scratch, 'the scratch database')), 'the scratch database open in the app');
    await removeRow(S, scratch, rowName(2));
    const gone = await until(() => !rowTitled(ws, scratch, rowName(2)), 4000, 20);
    return [!!gone, { rows: rowsOf(ws, scratch).length }];
  });
  await check(c, '0.7', async () => {
    await addRow(S, A.log, 'An evening of reading', { Date: '2027-01-13T23:30', Minutes: 90 });
    const r = rowTitled(ws, A.log, 'An evening of reading');
    return [!!r && String(r.values.Date).startsWith('2027-01-13T23:30') && r.values.Minutes === 90, r ? r.values : null];
  });
  await check(c, '0.8', async () => {
    await S.setTool('study', false); const off = !(await S.hasCommand('study.newSubject'));
    await S.setTool('study', true); const on = await S.hasCommand('study.newSubject');
    await showStudySidebar(S);
    const back = await until(async () => /Exam 7/.test((await subjectsText(S)) || ''), 10_000);
    return [off && on && !!back, { off, on, subjectBack: !!back }];
  });
  await check(c, '0.9', async () => {
    const ground = () => S.page.evaluate(() => { const m = /rgba?\(([^)]+)\)/.exec(getComputedStyle(document.body).backgroundColor); const p = m ? m[1].split(',').map(parseFloat) : [0, 0, 0]; return (p[0] + p[1] + p[2]) / 3; });
    await setMode(S, 'light'); const light = await ground();
    await setMode(S, 'dark'); const dark = await ground();
    const width = await setWidth(S, 900);
    await setWidth(S, 1440);
    return [light > 180 && dark < 80 && width <= 900, { light, dark, widthAt900: width }];
  });
  await check(c, '0.10', async () => {
    await toTrash(S, must(scratch, 'the scratch database'));
    const trashed = await until(() => coreAll(ws, 'SELECT is_archived FROM pages WHERE id = ?', [scratch])[0]?.is_archived === 1, 5000);
    return [!!trashed, { archived: coreAll(ws, 'SELECT is_archived FROM pages WHERE id = ?', [scratch])[0] }];
  });
  await check(c, '0.11', async () => {
    const t = await S.today();
    return [/^\d{4}-\d{2}-\d{2}$/.test(t.date) && (process.platform === 'win32' || t.zone === ZONE), { ...t, asked: ZONE }];
  });
});

phase(1, 'Make a plan', 'subject', {
  '1.1': 'the command study.newPlan is there, and the command palette lists it as "Study: New Plan…"',
  '1.2': 'the subject\'s More Actions has "New Plan…", and it opens the sheet',
  '1.3': 'the sheet asks Name, Exam date, Start date, Hours goal, and for each weekday the personal and the work hours; the Floor\'s hours less and the Stretch\'s hours more both start at 1',
  '1.4': 'an exam date on the start date, and one before it, are refused in words and nothing is made',
  '1.5': 'Create makes a page named for the plan under the subject\'s page, with the databases Plan, Week, Phases and Days under it and no other',
  '1.6': 'the four databases have the columns of the model by name and kind, with the option words of Following, Account, Days, Kind and Type',
  '1.7': 'Plan has one row: the Exam Date, Start Date and Hours Goal of the form, Following Standard',
  '1.8': 'Week holds the usual week of the form: each row has days and an account, and together they give each weekday its work hours and its Floor, Standard and Stretch hours (one less, one more, a day with no personal hours at none)',
  '1.9': 'Phases has one row: a Study phase from the start date to the day before the exam',
  '1.10': 'Days has one row per date from the start date to the day before the exam, with the hours, Type, Phase, Planned and Running the rules give, and none Edited',
  '1.11': 'the tab titled with the plan\'s name is in front and shows every day',
}, async (S, c) => {
  const ws = S.workspace;
  await check(c, '1.1', async () => {
    const has = await S.hasCommand('study.newPlan');
    await S.page.keyboard.press('F1');
    await sleep(500);
    await S.page.keyboard.type('New Plan');
    await sleep(700);
    const rows = (await S.find('body', /New Plan/i, '.parallx-quickpick-row, [role="option"]')).map((r) => r.name);
    await S.page.keyboard.press('Escape');
    await sleep(300);
    return [has && rows.some((r) => /Study: New Plan…/.test(r)), { command: has, paletteRows: rows }];
  });
  await check(c, '1.2', async () => {
    const items = must(await subjectMenu(S, SUBJECT), 'the subject\'s More Actions menu');
    const item = items.find((i) => /^New Plan…$/.test(i.name));
    if (!item) { await S.page.keyboard.press('Escape'); return [false, { menu: items.map((i) => i.name) }]; }
    await S.click(item);
    const open = await until(async () => (await S.formOpen()) && (await S.field(PF.exam)), 6000, 80);
    await S.shot('new-plan-sheet');
    if (open) { (await S.press('form', /^cancel$/i, 'button')) || (await S.page.keyboard.press('Escape')); await until(async () => !(await S.formOpen()), 3000); }
    return [!!open, { menu: items.map((i) => i.name), sheetOpened: !!open }];
  });
  await check(c, '1.3', async () => {
    await openPlanSheet(S);
    const got = {};
    for (const [k, re] of [['Name', PF.name], ['Exam date', PF.exam], ['Start date', PF.start], ['Hours goal', PF.goal]]) got[k] = (await S.field(re))?.label ?? null;
    const days = {};
    for (const d of WEEKDAYS) days[d] = [(await S.field(PF.day(d, 'Personal')))?.label ?? null, (await S.field(PF.day(d, 'Work')))?.label ?? null];
    const less = await S.field(PF.floor); const more = await S.field(PF.stretch);
    const distinct = new Set(Object.values(days).flat().filter(Boolean)).size;
    return [Object.values(got).every(Boolean) && distinct === 14 && !!less && !!more && Number(less.value) === 1 && Number(more.value) === 1 && less.label !== more.label,
      { fields: got, weekdayFields: distinct, floor: less ? `${less.label} = ${less.value}` : null, stretch: more ? `${more.label} = ${more.value}` : null }];
  });
  await check(c, '1.4', async () => {
    if (!(await S.formOpen())) await openPlanSheet(S);
    const said = [];
    for (const exam of [BASIC.start, addDays(BASIC.start, -3)]) {
      await fillPlanSheet(S, { ...BASIC, name: 'Refused Plan', exam });
      const before = norm(await S.formText());
      const create = (await S.find('form', CREATE, 'button'))[0];
      if (create && !create.disabled) await S.click(create);
      await sleep(1200);
      const open = await S.formOpen();
      const words = open ? norm(await S.formText()) : '';
      const m = /[^.!?\n]*\bexam\b[^.!?\n]*\b(after|before|later|earlier|past)\b[^.!?\n]*/i.exec(words);
      said.push({ exam, sheetStayed: open, createWasThere: !!create, words: m ? m[0].trim().slice(0, 120) : null, saidBeforeCreate: m ? before.includes(m[0].trim()) : false });
    }
    const made = pagesTitled(ws, 'Refused Plan').length;
    if (await S.formOpen()) { (await S.press('form', /^cancel$/i, 'button')) || (await S.page.keyboard.press('Escape')); await until(async () => !(await S.formOpen()), 3000); }
    return [said.every((s) => s.sheetStayed && s.createWasThere && s.words) && made === 0, { said, pagesMade: made }];
  });
  let made = null;
  try { await makePlan(S, BASIC); made = await until(() => { const p = planOf(ws, BASIC.name); return wholePlan(p) ? p : null; }, 20_000, 100); } catch (err) { made = { error: String((err && err.message) || err).slice(0, 260) }; }
  const plan = () => { if (!made || made.error) throw new Error(made ? made.error : `no page "${BASIC.name}" with Plan, Week, Phases and Days under the subject's page (${JSON.stringify(planOf(ws, BASIC.name).under.map((d) => d.title))})`); return made; };
  await check(c, '1.5', async () => {
    const p = planOf(ws, BASIC.name);
    return [wholePlan(p) && p.under.length === 4, { page: p.page ? p.page.title : (made && made.error) || null, underTheSubjectsPage: !!p.page, databases: p.under.map((d) => d.title) }];
  });
  await check(c, '1.6', async () => {
    const p = plan();
    const WANT = {
      Plan: { 'Exam Date': 'date', 'Start Date': 'date', 'Hours Goal': 'number', Following: ['select', PLANS] },
      Week: { Days: ['tags', WEEKDAYS], Account: ['select', ['Personal', 'Work']], From: 'date', Until: 'date', Floor: 'number', Standard: 'number', Stretch: 'number' },
      Phases: { Kind: ['select', ['Study', 'Rest', 'Catch-up', 'Holiday']], Start: 'date', End: 'date', Items: 'number', 'Minutes per Item': 'number' },
      Days: { Date: 'date', Type: ['select', ['Study', 'Rest', 'Catch-up', 'Holiday']], Phase: null, Work: 'number', Floor: 'number', Standard: 'number', Stretch: 'number', Planned: 'number', Running: 'number', Done: 'number', Edited: 'checkbox', Note: 'text' },
    };
    const wrong = []; const extra = [];
    for (const [db, wantCols] of Object.entries(WANT)) {
      const cols = columns(ws, p[db.toLowerCase()].id);
      for (const [name, kind] of Object.entries(wantCols)) {
        const col1 = cols.find((x) => x.name === name);
        if (!col1) { wrong.push(`${db}: no column "${name}"`); continue; }
        const type = Array.isArray(kind) ? kind[0] : kind;
        if (type && col1.type !== type) wrong.push(`${db}.${name} is ${col1.type}, wanted ${type}`);
        if (Array.isArray(kind)) { const opts = (col1.config?.options || []).map((o) => o.value ?? o.name ?? o); if (!same(opts, kind[1])) wrong.push(`${db}.${name} offers ${opts.join(', ') || 'nothing'}, wanted ${kind[1].join(', ')}`); }
      }
      extra.push(...cols.filter((x) => !(x.name in wantCols) && x.type !== 'title' && x.name !== 'Name').map((x) => `${db}.${x.name}`));
    }
    // The first column of Week and of Phases reads Name.
    must(await openDb(S, p.week.id), 'the Week database open in the app');
    const weekHeads = (await S.page.evaluate((id) => window.__ap.tableState(id), p.week.id))?.heads || [];
    must(await openDb(S, p.phases.id), 'the Phases database open in the app');
    const phaseHeads = (await S.page.evaluate((id) => window.__ap.tableState(id), p.phases.id))?.heads || [];
    await showTab(S, BASIC.name);
    if (weekHeads[0] !== 'Name') wrong.push(`Week's first column reads "${weekHeads[0]}"`);
    if (phaseHeads[0] !== 'Name') wrong.push(`Phases' first column reads "${phaseHeads[0]}"`);
    return [wrong.length === 0, { wrong, otherColumns: extra }];
  });
  await check(c, '1.7', async () => {
    const rows = rowsOf(ws, plan().plan.id); const v = rows[0]?.values || {};
    return [rows.length === 1 && v['Exam Date'] === BASIC.exam && v['Start Date'] === BASIC.start && v['Hours Goal'] === BASIC.goal && v.Following === 'Standard', { rows: rows.length, values: v }];
  });
  await check(c, '1.8', async () => {
    const r = rulesIn(ws, plan());
    const bad = r.week.filter((w) => !w.days.length || !w.days.every((d) => WEEKDAYS.includes(d)) || !['Personal', 'Work'].includes(w.account) || !norm(w.name));
    // One week of days under each reading: the form's own, and the rows the app made of it.
    const oneWeek = { start: BASIC.start, exam: addDays(BASIC.start, 7) };
    const got = modelDays(oneWeek, r.week, []); const want = modelDays(oneWeek, formWeek(BASIC), []);
    const diffs = dayDiffs(got, want);
    return [r.week.length > 0 && bad.length === 0 && diffs.length === 0, { rows: r.week.map((w) => `${w.name}: ${w.days.join(' ')} ${w.account} ${w.floor}/${w.standard}/${w.stretch}${w.from || w.until ? ` ${w.from}..${w.until}` : ''}`), notWhole: bad.map((w) => w.name), weekDiffers: diffs }];
  });
  await check(c, '1.9', async () => {
    const r = rulesIn(ws, plan());
    const p = r.phases[0];
    return [r.phases.length === 1 && p.kind === 'Study' && p.start === BASIC.start && p.end === lastDay(BASIC) && !!norm(p.name), r.phases];
  });
  await check(c, '1.10', async () => {
    const p = plan();
    const want = formDays(BASIC, rulesIn(ws, p).phases[0]?.name ?? '');
    const ok = await until(() => dayDiffs(daysIn(ws, p), want, FILE_KEYS).length === 0, 20_000, 100);
    const got = daysIn(ws, p);
    const titles = new Set(got.map((d) => norm(d.title))).size;
    return [!!ok && got.length === 56 && got.every((d) => !d.edited) && titles === got.length && same(totalsOf(got), BASIC_TOTALS), { rows: got.length, totals: totalsOf(got), edited: got.filter((d) => d.edited).length, distinctFirstCells: titles, differs: dayDiffs(got, want, FILE_KEYS).slice(0, 5) }];
  });
  await check(c, '1.11', async () => {
    plan();
    const front = (await tabTitled(S, BASIC.name)).some((t) => t.active);
    const days = await tabShows(S, 56, BASIC.start);
    await S.shot('plan-made');
    return [front && !!days && days[0].date === BASIC.start && days[55].date === lastDay(BASIC), { tabInFront: front, daysShown: days ? days.length : ((await S.dayTable(BASIC.start))?.rows.length ?? 'no table of days') }];
  });
});

phase(2, 'See the plan', 'plan', {
  '2.1': 'the tab shows the exam date',
  '2.2': 'the three plans stand side by side with their total hours: Floor 104 h, Standard 144 h, Stretch 184 h',
  '2.3': 'the hours goal and how far each plan is from it: "Standard 144 h · 56 under 200"',
  '2.4': 'the plan he follows is marked, and choosing Stretch in the tab writes Following and shows Stretch\'s days',
  '2.5': 'hours per day by number of days for the plan he follows ("0 h: 8 days, 2 h: 8 days, 3 h: 32 days, 4 h: 8 days"), with the study days and all the days counted',
  '2.6': 'every day from the start to the day before the exam is one row of a table with a caption and the headers Date, Type, Phase, Personal, Work, Total, Running; the date carries its weekday; the cells are the day\'s',
  '2.7': 'the days are grouped by week: eight groups of seven',
  '2.8': 'the phases stand in date order, each with its name, kind, dates, number of days and hours in the plan he follows',
  '2.9': 'Rest, Catch-up and Holiday days say so in words, and each looks different from a study day and from the others',
  '2.10': 'Open Days, Open Week, Open Phases and Open Plan Settings each open their database',
  '2.11': 'the days left until the exam are shown, counted from today',
  '2.12': 'today\'s row is marked',
  '2.13': 'days already past carry Done: the hours of the Work Log on that local date, late evening included',
}, async (S, c) => {
  const ws = S.workspace; const p = mustPlan(ws, BASIC.name);
  await openPlan(S, BASIC.name);
  must(await tabShows(S, 56, BASIC.start), 'the tab showing the 56 days of the plan');
  await S.shot('plan-tab');
  await check(c, '2.1', async () => { const t = await S.paneWords(); const m = dateWords(BASIC.exam, true).exec(t); return [!!m, m ? m[0] : t.slice(0, 200)]; });
  await check(c, '2.2', async () => {
    const t = await S.paneWords();
    const got = Object.fromEntries(PLANS.map((pl) => [pl, (totalWords(pl, BASIC_TOTALS[pl]).exec(t) || [null])[0]]));
    return [PLANS.every((pl) => got[pl]), got];
  });
  await check(c, '2.3', async () => {
    const t = await S.paneWords();
    const got = Object.fromEntries(PLANS.map((pl) => [pl, (goalWords(pl, BASIC_TOTALS[pl], BASIC.goal).exec(t) || [null])[0]]));
    return [PLANS.every((pl) => got[pl]), got];
  });
  await check(c, '2.4', async () => {
    const before = await chooser(S);
    if (!before.whole || !same(before.marked, ['Standard'])) return [false, { controls: Object.fromEntries(PLANS.map((pl) => [pl, before.by[pl] ? before.by[pl].name : null])), marked: before.marked }];
    const r = await ruleChange(S, p, async () => { await S.click(before.by.Stretch); return (await until(() => (rulesIn(ws, p).planRow.values.Following === 'Stretch' ? Date.now() : null), 3000, 20)); });
    const after = await chooser(S);
    return [inTime(r) && same(after.marked, ['Stretch']), { following: rulesIn(ws, p).planRow.values.Following, marked: after.marked, ...r }];
  });
  // Back to Standard through the database, for the checks that name its numbers.
  try { await setProp(S, rulesIn(ws, p).planRow.pageId, 'Following', 'Standard'); await sleep(1500); } catch { /* the checks below say so */ }
  await check(c, '2.5', async () => {
    const following = rulesIn(ws, p).plan.following;
    const days = expectedDays(ws, p).days; const want = perDayOf(days);
    const part = must(await S.region(/hours per day/i), 'a part of the tab named "Hours per day"');
    const got = perDay(part.text);
    const t = await S.paneWords();
    const studyDays = days.filter((d) => d.planned > 0).length;
    return [sameMap(got, want) && count(studyDays, `[Ss]tudy ${DAYS}`).test(t) && count(days.length, DAYS).test(t), { following, shown: got, wanted: want, part: part.text.slice(0, 200), studyDaysWanted: studyDays, allDaysWanted: days.length }];
  });
  await check(c, '2.6', async () => {
    const t = must(await S.dayTable(BASIC.start), 'a table in the tab whose rows carry data-date');
    const w = expectedDays(ws, p);
    const diffs = dayDiffs(await tabDays(S, BASIC.start), asTab(w.days, w.rules.plan.following), TAB_KEYS);
    const heads = ['date', 'type', 'phase', 'personal', 'work', 'total', 'running'];
    const weekdays = t.rows.filter((r) => !new RegExp(`\\b${weekdayOf(r.date)}`, 'i').test(r.cells.date || '')).length;
    const dates = t.rows.filter((r) => !dateWords(r.date).test(r.cells.date || '')).length;
    return [!!t.caption && t.headsAreTh && heads.every((h) => t.heads.includes(h)) && t.rows.length === 56 && diffs.length === 0 && weekdays === 0 && dates === 0,
      { caption: t.caption, heads: t.heads, headersAreTh: t.headsAreTh, rows: t.rows.length, firstRow: t.rows[0]?.text, cellsDiffer: diffs.slice(0, 4), dateCellsWithoutTheirWeekday: weekdays, dateCellsWithoutTheirDate: dates }];
  });
  await check(c, '2.7', async () => { const t = must(await S.dayTable(BASIC.start), 'the table of days'); return [t.groups === 8 && t.largestGroup === 7, { groups: t.groups, largest: t.largestGroup }]; });
  // More spans, through the chat's tool: a shorter first phase, a second one, a day of rest, a catch-up day, a holiday.
  const SPANS = [ph('Second Half', 'Study', '2027-02-01', '2027-02-28'), ph('Day Off', 'Rest', '2027-01-20', '2027-01-20'), ph('Loose Ends', 'Catch-up', '2027-01-28', '2027-01-28'), ph('Ski Trip', 'Holiday', '2027-02-13', '2027-02-14')];
  let spansIn = '';
  try {
    await setProp(S, rulesIn(ws, p).phases[0].pageId, 'End', '2027-01-31');
    let at = 0;
    for (const s of SPANS) at = (await addRow(S, p.phases.id, s.name, phaseValues(s))).at;
    const r = await follows(S, p, at);
    if (r.rowsMs === null || r.tabMs === null) spansIn = `the days did not follow the new spans: ${JSON.stringify(r).slice(0, 220)}`;
  } catch (err) { spansIn = String((err && err.message) || err).slice(0, 200); }
  await S.shot('plan-tab-spans');
  await check(c, '2.8', async () => {
    if (spansIn) throw new Error(spansIn);
    const w = expectedDays(ws, p);
    const part = must(await S.region(/^phases\b/i), 'a part of the tab named "Phases"');
    const first = w.rules.phases.find((x) => x.start === BASIC.start && x.kind === 'Study');
    const want = [first, ...SPANS].sort((a, b) => (a.start < b.start ? -1 : 1)).map((s) => {
      const inSpan = w.days.filter((d) => s.start <= d.date && d.date <= s.end);
      return { name: s.name, kind: s.kind, start: s.start, end: s.end, days: inSpan.length, hours: inSpan.reduce((t, d) => t + d.planned, 0) };
    });
    const rows = want.map((s) => part.rows.find((r) => r.text.includes(s.name)) || null);
    const faults = [];
    want.forEach((s, i) => {
      const r = rows[i];
      if (!r) { faults.push(`${s.name}: no row`); return; }
      if (!new RegExp(`\\b${esc(s.kind)}\\b`, 'i').test(r.text.replace(s.name, ''))) faults.push(`${s.name}: no kind ${s.kind}`);
      if (!dateWords(s.start).test(r.text) || !dateWords(s.end).test(r.text)) faults.push(`${s.name}: its dates`);
      if (!count(s.days, DAYS).test(r.text)) faults.push(`${s.name}: no "${s.days} days"`);
      if (!count(s.hours, H).test(r.text)) faults.push(`${s.name}: no "${s.hours} h"`);
    });
    const ys = rows.filter(Boolean).map((r) => r.y);
    const ordered = ys.every((y, i) => i === 0 || y > ys[i - 1]);
    return [faults.length === 0 && ordered && rows.every(Boolean), { faults, inDateOrder: ordered, rows: part.rows.map((r) => r.text.slice(0, 90)), wanted: want.map((s) => `${s.name} ${s.kind} ${s.start}..${s.end} ${s.days} days ${s.hours} h`) }];
  });
  await check(c, '2.9', async () => {
    if (spansIn) throw new Error(spansIn);
    const at = { Study: '2027-01-19', Rest: '2027-01-20', 'Catch-up': '2027-01-28', Holiday: '2027-02-13', 'Rest (no hours)': '2027-01-10' };
    const looks = {};
    for (const [k, d] of Object.entries(at)) looks[k] = await S.look(d);
    const words = Object.entries(at).every(([k, d]) => looks[k] && new RegExp(`\\b${esc(k.replace(/ \(.*/, ''))}\\b`, 'i').test(looks[k].word));
    const four = ['Study', 'Rest', 'Catch-up', 'Holiday'].map((k) => looks[k]?.look);
    return [words && four.every(Boolean) && new Set(four).size === 4, Object.fromEntries(Object.entries(looks).map(([k, v]) => [k, v ? `${v.word} :: ${v.look}` : null]))];
  });
  await check(c, '2.10', async () => {
    const got = {};
    for (const [label, db] of [['Open Days', p.days], ['Open Week', p.week], ['Open Phases', p.phases], ['Open Plan Settings', p.plan]]) {
      await showTab(S, BASIC.name);
      const hit = await S.press('pane', exact(label));
      got[label] = hit ? !!(await until(() => S.page.evaluate((id) => !!window.__ap.tableState(id), db.id), 6000)) : 'no such control';
    }
    await showTab(S, BASIC.name);
    return [Object.values(got).every((v) => v === true), got];
  });
  // A plan around today: it began nine days ago and its exam is in three weeks.
  const today = (await S.today()).date;
  const NOW = { name: 'Sprint', start: addDays(today, -9), exam: addDays(today, 21), goal: 60, personal: week7(2, 2, 2, 2), work: week7(1, 1, 1, 1) };
  let nowMade = '';
  try { await makePlan(S, NOW); must(await tabShows(S, 30, NOW.start, 20_000), 'the tab showing the 30 days of the plan around today'); } catch (err) { nowMade = String((err && err.message) || err).slice(0, 240); }
  await check(c, '2.11', async () => {
    if (nowMade) throw new Error(nowMade);
    const t = await S.paneWords(); const m = /(-?\d+)\s+days?\s+left(?![a-z])/.exec(t);
    return [!!m && Number(m[1]) === 21 && dateWords(NOW.exam, true).test(t), { said: m ? m[0] : null, wanted: 21, today }];
  });
  await check(c, '2.12', async () => {
    if (nowMade) throw new Error(nowMade);
    const t = must(await S.dayTable(NOW.start), 'the table of days');
    const marked = t.rows.filter((r) => r.current);
    await S.shot('plan-tab-today');
    return [marked.length === 1 && marked[0].date === today && /^(date|true)$/.test(marked[0].current), { marked: marked.map((r) => `${r.date} aria-current=${r.current}`), today }];
  });
  await check(c, '2.13', async () => {
    if (nowMade) throw new Error(nowMade);
    const np = mustPlan(ws, NOW.name);
    const d3 = addDays(today, -3); const d5 = addDays(today, -5);
    await addRow(S, np.subject.log.id, 'Morning problems', { Date: `${d3}T10:00`, Minutes: 90 });
    await addRow(S, np.subject.log.id, 'Afternoon notes', { Date: `${d3}T15:00`, Minutes: 30 });
    const { at } = await addRow(S, np.subject.log.id, 'Late reading', { Date: `${d5}T23:30`, Minutes: 60 });
    const want = { [d3]: 2, [d5]: 1, [addDays(d5, 1)]: 0, [addDays(today, 2)]: 0 };
    const inFile = () => Object.fromEntries(daysIn(ws, np).filter((d) => d.date in want).map((d) => [d.date, d.done]));
    const rowsAt = await until(() => (sameMap(inFile(), want) ? Date.now() : null), 5000, 50);
    const doneOf = (r) => { if (!r) return null; if ('done' in r.cells) return hoursIn(r.cells.done); const m = /done\D{0,6}(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*h?\s*done/i.exec(`${r.text} | ${r.said}`); return m ? Number(m[1] ?? m[2]) : null; };
    const inTab = async () => { const t = await S.dayTable(NOW.start); return t ? Object.fromEntries(t.rows.filter((r) => r.date === d3 || r.date === d5).map((r) => [r.date, doneOf(r)])) : {}; };
    const tabAt = await until(async () => (sameMap(await inTab(), { [d3]: 2, [d5]: 1 }) ? Date.now() : null), 5000, 80);
    return [!!rowsAt && !!tabAt, { doneInDays: inFile(), wanted: want, doneInTheTab: await inTab(), rowsMs: rowsAt ? rowsAt - at : null, tabMs: tabAt ? tabAt - at : null }];
  });
});

phase(3, 'Change a rule and watch the days follow (each time is printed; the limit is 2 s)', 'plan', {
  '3.1': 'a Week row\'s hours changed in the table with the keys: the Days rows and the open tab follow',
  '3.2': 'a Week row\'s days changed through the chat\'s tool',
  '3.3': 'a Week row\'s From and Until changed through the chat\'s tool',
  '3.4': 'a Week row added through the chat\'s tool, and a Week row deleted in the table',
  '3.5': 'a Phases row\'s End changed, and a Rest span added',
  '3.6': 'a later Exam Date adds days',
  '3.7': 'an earlier Exam Date removes days',
  '3.8': 'a later Start Date removes the first days and Running starts anew',
  '3.9': 'Following changed in the Plan database: Planned, Running and the tab\'s totals follow, and the tab marks the plan',
}, async (S, c) => {
  const ws = S.workspace; const p = mustPlan(ws, BASIC.name);
  await openPlan(S, BASIC.name);
  must(await tabShows(S, 56, BASIC.start), 'the tab showing the 56 days of the plan');
  const weekRow = (pred, what) => must(rulesIn(ws, p).week.find(pred), what);
  const planRowId = () => rulesIn(ws, p).planRow.pageId;
  await check(c, '3.1', async () => {
    const sat = weekRow((w) => w.account === 'Personal' && w.days.includes('Sat'), 'the Week row that holds Saturday\'s personal hours');
    must(await openDb(S, p.week.id), 'the Week database open in the app');
    const r = await ruleChange(S, p, async () => { const at = await typeCell(S, p.week.id, sat.name, 'Standard', 6); return at && (await until(() => rulesIn(ws, p).week.find((w) => w.pageId === sat.pageId)?.standard === 6, 3000, 20)) ? at : null; }, { tab: BASIC.name });
    return [inTime(r), r];
  });
  await showTab(S, BASIC.name);
  await check(c, '3.2', async () => {
    const sat = weekRow((w) => w.account === 'Personal' && w.days.includes('Sat'), 'the Week row that holds Saturday\'s personal hours');
    const r = await ruleChange(S, p, () => setProp(S, sat.pageId, 'Days', [...new Set([...sat.days, 'Sun'])]));
    return [inTime(r), r];
  });
  await check(c, '3.3', async () => {
    const sat = weekRow((w) => w.account === 'Personal' && w.days.includes('Sat'), 'the Week row that holds Saturday\'s personal hours');
    const r1 = await ruleChange(S, p, () => setProp(S, sat.pageId, 'From', '2027-01-18'));
    const r2 = await ruleChange(S, p, () => setProp(S, sat.pageId, 'Until', '2027-02-07'));
    return [inTime(r1) && inTime(r2), { from: r1, until: r2 }];
  });
  await check(c, '3.4', async () => {
    const r1 = await ruleChange(S, p, async () => (await addRow(S, p.week.id, 'Lunch Hours', weekValues(wk('Lunch Hours', ['Tue', 'Thu'], 'Work', '2027-01-11', '', 1, 1, 1)))).at);
    must(await openDb(S, p.week.id), 'the Week database open in the app');
    const r2 = await ruleChange(S, p, async () => { await removeRow(S, p.week.id, 'Lunch Hours'); return until(() => (rulesIn(ws, p).week.some((w) => w.name === 'Lunch Hours') ? null : Date.now()), 4000, 20); }, { tab: BASIC.name });
    await showTab(S, BASIC.name);
    return [inTime(r1) && r2.planChanged === true && r2.rowsMs !== null && r2.rowsMs <= 2000 && r2.tabMs !== null, { added: r1, deletedInTheTable: r2 }];
  });
  await showTab(S, BASIC.name);
  await check(c, '3.5', async () => {
    const first = must(rulesIn(ws, p).phases[0], 'the plan\'s phase');
    const r1 = await ruleChange(S, p, () => setProp(S, first.pageId, 'End', '2027-02-07'));
    const r2 = await ruleChange(S, p, async () => (await addRow(S, p.phases.id, 'Long Weekend', phaseValues(ph('Long Weekend', 'Rest', '2027-01-15', '2027-01-18')))).at);
    const rest = daysIn(ws, p).filter((d) => d.date >= '2027-01-15' && d.date <= '2027-01-18');
    return [inTime(r1) && inTime(r2) && rest.length === 4 && rest.every((d) => d.type === 'Rest' && d.planned === 0), { end: r1, restSpan: r2, itsDays: rest.map((d) => `${d.date} ${d.type} ${d.planned}`) }];
  });
  await check(c, '3.6', async () => {
    const r = await ruleChange(S, p, () => setProp(S, planRowId(), 'Exam Date', '2027-03-08'));
    const n = daysIn(ws, p).length;
    return [inTime(r) && n === 63 && r.days === 63, { ...r, rowsInDays: n }];
  });
  await check(c, '3.7', async () => {
    const r = await ruleChange(S, p, () => setProp(S, planRowId(), 'Exam Date', '2027-02-22'));
    const got = daysIn(ws, p);
    return [inTime(r) && got.length === 49 && got[got.length - 1]?.date === '2027-02-21', { ...r, rowsInDays: got.length, lastDay: got[got.length - 1]?.date }];
  });
  await check(c, '3.8', async () => {
    const r = await ruleChange(S, p, () => setProp(S, planRowId(), 'Start Date', '2027-01-11'));
    const got = daysIn(ws, p);
    return [inTime(r) && got.length === 42 && got[0]?.date === '2027-01-11' && got[0].running === got[0].planned, { ...r, rowsInDays: got.length, firstDay: got[0] ? `${got[0].date} planned ${got[0].planned} running ${got[0].running}` : null }];
  });
  await check(c, '3.9', async () => {
    const r = await ruleChange(S, p, () => setProp(S, planRowId(), 'Following', 'Floor'));
    const marked = await until(async () => { const ch = await chooser(S); return same(ch.marked, ['Floor']) ? ch.marked : null; }, 2000, 60);
    const t = await S.paneWords();
    await S.shot('plan-tab-after-changes');
    return [inTime(r) && !!marked && totalWords('Floor', r.totals.Floor).test(t) && totalWords('Stretch', r.totals.Stretch).test(t), { ...r, marked: marked || (await chooser(S)).marked }];
  });
});

phase(4, 'Keep a day he changed', 'plan', {
  '4.1': 'a day\'s Standard hours changed in the Days table with the keys: Study ticks Edited on that row, on no other, and the hours stay',
  '4.2': 'Planned and Running follow the day he changed, in Days and in the tab',
  '4.3': 'a later rule change leaves that row as it is while its neighbours follow, and Running still follows',
  '4.4': 'a day\'s Type changed through the chat\'s tool is marked Edited too, and a later rule change leaves it alone',
  '4.5': 'Done still follows on a day he changed',
  '4.6': 'Edited unticked in the table: the day goes back to the rules',
  '4.7': 'an earlier Exam Date leaves the day he edited outside the plan: its row is kept as it is, the other days after the exam go, and the tab lists it as outside the plan',
  '4.8': 'the Exam Date moved back: the day is in the plan again, still Edited, and the tab no longer says outside the plan',
}, async (S, c) => {
  const ws = S.workspace; const p = mustPlan(ws, BASIC.name);
  await openPlan(S, BASIC.name);
  must(await tabShows(S, 56, BASIC.start), 'the tab showing the 56 days of the plan');
  const X = '2027-01-13'; const Y = '2027-02-25';       // a Wednesday, and a Thursday in the last week
  const kept = {};
  const dayRow = (date) => must(daysIn(ws, p).find((d) => d.date === date), `the Days row of ${date}`);
  const frozen = (d) => ({ type: d.type, phase: d.phase, work: d.work, floor: d.floor, standard: d.standard, stretch: d.stretch });
  await check(c, '4.1', async () => {
    const x = dayRow(X);
    must(await openDb(S, p.days.id), 'the Days database open in the app');
    const at = must(await typeCell(S, p.days.id, x.title, 'Standard', 5), 'an editor in the Standard cell of the day');
    const ticked = await until(() => (dayRow(X).edited && dayRow(X).standard === 5 ? Date.now() : null), 4000, 30);
    await sleep(600);
    const now = daysIn(ws, p);
    kept[X] = { ...frozen(x), standard: 5 };
    return [!!ticked && ticked - at <= 2000 && now.filter((d) => d.edited).length === 1 && dayRow(X).standard === 5, { editedTickedAfterMs: ticked ? ticked - at : null, standard: dayRow(X).standard, rowsEdited: now.filter((d) => d.edited).map((d) => d.date) }];
  });
  await check(c, '4.2', async () => {
    must(kept[X], 'the day changed in 4.1');
    const r = await follows(S, p, Date.now(), { kept, tab: BASIC.name });
    const x = dayRow(X); const last = daysIn(ws, p).pop();
    return [r.rowsMs !== null && r.tabMs !== null && x.planned === x.work + 5 && last.running === BASIC_TOTALS.Standard + 3, { ...r, planned: x.planned, lastRunning: last.running, wantedLastRunning: BASIC_TOTALS.Standard + 3 }];
  });
  await showTab(S, BASIC.name);
  await check(c, '4.3', async () => {
    must(kept[X], 'the day changed in 4.1');
    const before = { x: dayRow(X), prev: dayRow(addDays(X, -1)), next: dayRow(addDays(X, 1)) };
    const r = await ruleChange(S, p, async () => (await addRow(S, p.week.id, 'Every Day Extra', weekValues(wk('Every Day Extra', WEEKDAYS, 'Personal', '', '', 1, 1, 1)))).at, { kept });
    const after = { x: dayRow(X), prev: dayRow(addDays(X, -1)), next: dayRow(addDays(X, 1)) };
    return [inTime(r) && same(frozen(after.x), frozen(before.x)) && after.x.edited && after.prev.standard === before.prev.standard + 1 && after.next.standard === before.next.standard + 1 && after.next.running === before.next.running + 10,
      { ...r, theDay: `${after.x.floor}/${after.x.standard}/${after.x.stretch} (was ${before.x.floor}/${before.x.standard}/${before.x.stretch})`, neighbours: `${after.prev.standard} and ${after.next.standard} (were ${before.prev.standard} and ${before.next.standard})`, runningOfTheNextDay: `${after.next.running} (was ${before.next.running}; the ten other days up to it gained an hour, the edited day none)` }];
  });
  await check(c, '4.4', async () => {
    const y = dayRow(Y);
    const at = await setProp(S, y.pageId, 'Type', 'Catch-up');
    const ticked = await until(() => (dayRow(Y).edited ? Date.now() : null), 4000, 30);
    kept[Y] = { ...frozen(y), type: 'Catch-up' };
    const extra = must(rulesIn(ws, p).week.find((w) => w.name === 'Every Day Extra') || rulesIn(ws, p).week.find((w) => w.account === 'Personal' && w.days.includes('Thu')), 'a Week row that holds Thursday');
    const r = await ruleChange(S, p, () => setProp(S, extra.pageId, 'Standard', extra.standard + 3), { kept });
    const now = dayRow(Y);
    return [!!ticked && ticked - at <= 2000 && inTime(r) && now.type === 'Catch-up' && now.standard === y.standard && now.edited, { editedTickedAfterMs: ticked ? ticked - at : null, ...r, theDay: `${now.type} ${now.standard} (was ${y.type} ${y.standard})` }];
  });
  await check(c, '4.5', async () => {
    must(kept[X], 'the day changed in 4.1');
    const { at } = await addRow(S, p.subject.log.id, 'Worked ahead', { Date: `${X}T19:00`, Minutes: 90 });
    const done = await until(() => (dayRow(X).done === 1.5 ? Date.now() : null), 5000, 50);
    return [!!done && dayRow(X).edited && dayRow(addDays(X, 1)).done === 0, { done: dayRow(X).done, afterMs: done ? done - at : null, nextDayDone: dayRow(addDays(X, 1)).done }];
  });
  await check(c, '4.6', async () => {
    must(kept[X], 'the day changed in 4.1');
    must(await openDb(S, p.days.id), 'the Days database open in the app');
    const at = await clickCell(S, p.days.id, dayRow(X).title, 'Edited');
    must(await until(() => !rowsOf(ws, p.days.id).find((r) => dateOf(r.values.Date) === X)?.values.Edited, 3000, 20), 'Edited unticked in the file after the click');
    delete kept[X];
    const r = await follows(S, p, at, { kept, tab: BASIC.name });
    const x = dayRow(X); const want = expectedDays(ws, p, kept).days.find((d) => d.date === X);
    return [r.rowsMs !== null && r.rowsMs <= 2000 && r.tabMs !== null && !x.edited && x.standard === want.standard && x.standard !== 5, { ...r, standard: x.standard, wanted: want.standard, edited: x.edited }];
  });
  await showTab(S, BASIC.name);
  await check(c, '4.7', async () => {
    must(kept[Y], 'the day changed in 4.4');
    const before = dayRow(Y);
    const r = await ruleChange(S, p, () => setProp(S, rulesIn(ws, p).planRow.pageId, 'Exam Date', '2027-02-22'), { kept, outside: [Y] });
    const all = daysIn(ws, p); const y = all.find((d) => d.date === Y) || null;
    const after = all.filter((d) => d.date >= '2027-02-22').map((d) => d.date);
    const listed = await until(() => S.page.evaluate(({ d, first }) => window.__pp.outsideListed(d, first), { d: Y, first: BASIC.start }), 2000, 80);
    await S.shot('plan-tab-outside');
    return [inTime(r) && !!y && y.edited && same(frozen(y), frozen(before)) && same(after, [Y]) && !!listed, { ...r, keptRow: y ? `${y.date} ${y.type} ${y.standard} edited ${y.edited}` : 'gone', rowsOnOrAfterTheExam: after, listedAsOutsideThePlan: !!listed, saysOutsideThePlan: /outside the plan/i.test(await S.paneWords()) }];
  });
  await check(c, '4.8', async () => {
    must(kept[Y], 'the day changed in 4.4');
    const r = await ruleChange(S, p, () => setProp(S, rulesIn(ws, p).planRow.pageId, 'Exam Date', BASIC.exam), { kept });
    const y = dayRow(Y);
    const says = /outside the plan/i.test(await S.paneWords());
    return [inTime(r) && y.edited && y.type === 'Catch-up' && !says && daysIn(ws, p).length === 56, { ...r, theDay: `${y.type} edited ${y.edited}`, stillSaysOutside: says, rows: daysIn(ws, p).length }];
  });
});

phase(5, 'Be told when a phase does not fit', 'plan', {
  '5.1': '560 items at 9 minutes in a phase of 72 hours: its row says "needs 84 h, has 72 h"',
  '5.2': 'the same for Floor ("needs 84 h, has 52 h") and Stretch is one press away',
  '5.3': 'following Floor, the row says "needs 84 h, has 52 h"',
  '5.4': '100 items at 45 minutes: "needs 75 h, has 72 h"; 100 items at 43 minutes fit, and the row stops saying "needs"',
  '5.5': 'a phase without those numbers says nothing of the kind, and a phase whose Minutes per Item was emptied stops saying it',
}, async (S, c) => {
  const ws = S.workspace; const p = mustPlan(ws, BASIC.name);
  await openPlan(S, BASIC.name);
  must(await tabShows(S, 56, BASIC.start), 'the tab showing the 56 days of the plan');
  const first = must(rulesIn(ws, p).phases[0], 'the plan\'s phase');
  const phaseRow = async (name) => { const part = await S.region(/^phases\b/i); return part ? part.rows.find((r) => r.text.includes(name)) || null : null; };
  const needs = (n, h) => new RegExp(`[Nn]eeds\\s+${n}\\s*${H}\\W{0,4}has\\s+${h}\\s*${H}`);
  const says = (name, re, ms = 2000) => until(async () => { const r = await phaseRow(name); return r && re.test(r.text) ? r : null; }, ms, 60);
  // The first phase ends on Jan 31 (four weeks: 52, 72 and 92 hours); a second one follows with no numbers.
  await setProp(S, first.pageId, 'End', '2027-01-31');
  await addRow(S, p.phases.id, 'Second Half', phaseValues(ph('Second Half', 'Study', '2027-02-01', '2027-02-28')));
  await setProp(S, first.pageId, 'Items', 560);
  const at = await setProp(S, first.pageId, 'Minutes per Item', 9);
  await check(c, '5.1', async () => {
    const r = await says(first.name, needs(84, 72));
    const ms = Date.now() - at;
    await S.shot('plan-tab-fit');
    return [!!r, { row: (r || (await phaseRow(first.name)))?.text ?? 'no row for the phase in a part named "Phases"', afterMs: r ? ms : null }];
  });
  await check(c, '5.2', async () => {
    const row = must(await phaseRow(first.name), 'the phase\'s row in the part named "Phases"');
    const floor = new RegExp(`(?<![A-Za-z])Floor\\b[^|]{0,60}?${needs(84, 52).source}`);
    const already = floor.test(norm(await S.text('body')));
    const tried = [];
    let shown = null;
    for (const b of row.controls.filter((x) => !/^Open /.test(x.name))) {
      await S.click(b);
      tried.push(b.name);
      shown = await until(async () => { const t = norm(await S.text('body')); return floor.test(t) && /\bStretch\b/.test(t.slice(t.search(floor))) ? floor.exec(t)[0] : null; }, 1500, 80);
      await S.shot('plan-tab-fit-all-plans');
      if (shown) break;
      await S.page.keyboard.press('Escape');
      await sleep(200);
    }
    await S.page.keyboard.press('Escape');
    return [!already && !!shown, { shownBeforeAnyPress: already, pressed: tried, said: shown, controlsInTheRow: row.controls.map((x) => x.name) }];
  });
  await check(c, '5.3', async () => {
    await showTab(S, BASIC.name);
    await setProp(S, rulesIn(ws, p).planRow.pageId, 'Following', 'Floor');
    const r = await says(first.name, needs(84, 52));
    await setProp(S, rulesIn(ws, p).planRow.pageId, 'Following', 'Standard');
    const back = await says(first.name, needs(84, 72));
    return [!!r && !!back, { followingFloor: r ? r.text : (await phaseRow(first.name))?.text, backOnStandard: !!back }];
  });
  await check(c, '5.4', async () => {
    await setProp(S, first.pageId, 'Items', 100); await setProp(S, first.pageId, 'Minutes per Item', 45);
    const tight = await says(first.name, needs(75, 72));
    await setProp(S, first.pageId, 'Minutes per Item', 43);
    const fits = await until(async () => { const r = await phaseRow(first.name); return r && !/\bneeds\b/i.test(r.text) ? r : null; }, 2000, 60);
    return [!!tight && !!fits, { at45Minutes: tight ? tight.text : (await phaseRow(first.name))?.text, at43Minutes: fits ? fits.text : (await phaseRow(first.name))?.text }];
  });
  await check(c, '5.5', async () => {
    await setProp(S, first.pageId, 'Minutes per Item', 45);
    must(await says(first.name, needs(75, 72)), 'the phase saying "needs 75 h, has 72 h" again');
    const other = must(await phaseRow('Second Half'), 'the row of the phase "Second Half"');
    await setProp(S, first.pageId, 'Minutes per Item', '');
    const quiet = await until(async () => { const r = await phaseRow(first.name); return r && !/\bneeds\b/i.test(r.text) ? r : null; }, 2000, 60);
    return [!/\bneeds\b/i.test(other.text) && !!quiet, { phaseWithoutNumbers: other.text, afterMinutesEmptied: quiet ? quiet.text : (await phaseRow(first.name))?.text }];
  });
});

phase(6, 'Be told when the plan misses the goal, and when rules contradict', 'plan', {
  '6.1': 'each plan under the goal says by how much: Floor 96 under 200, Standard 56 under 200, Stretch 16 under 200',
  '6.2': 'the Hours Goal changed in the database to 150: Floor 46 under, Standard 6 under, Stretch 34 over, within 2 s',
  '6.3': 'a Week block with no days is named, and gives no hours',
  '6.4': 'a span that ends before it starts is named, and rests no day',
  '6.5': 'two Study phases over one date: the days keep the phase that starts first, and the tab names the overlap with both phases',
  '6.6': 'each of the three goes when its row is put right',
}, async (S, c) => {
  const ws = S.workspace; const p = mustPlan(ws, BASIC.name);
  await openPlan(S, BASIC.name);
  must(await tabShows(S, 56, BASIC.start), 'the tab showing the 56 days of the plan');
  const goalSaid = async (goal) => { const t = await S.paneWords(); return Object.fromEntries(PLANS.map((pl) => [pl, (goalWords(pl, BASIC_TOTALS[pl], goal).exec(t) || [null])[0]])); };
  await check(c, '6.1', async () => { const got = await goalSaid(200); return [PLANS.every((pl) => got[pl]), got]; });
  await check(c, '6.2', async () => {
    const at = await setProp(S, rulesIn(ws, p).planRow.pageId, 'Hours Goal', 150);
    const ok = await until(async () => { const g = await goalSaid(150); return PLANS.every((pl) => g[pl]) ? Date.now() : null; }, 2000, 60);
    await S.shot('plan-tab-goal');
    return [!!ok, { said: await goalSaid(150), afterMs: ok ? ok - at : null }];
  });
  const calm = expectedDays(ws, p).days;
  const ids = {};
  await check(c, '6.3', async () => {
    ids.ghost = (await addRow(S, p.week.id, 'Ghost Block', { Account: 'Personal', Floor: 9, Standard: 9, Stretch: 9 })).pageId;
    const b = await until(() => S.block('pane', ['Ghost Block', /no days/]), 2000, 80);
    await sleep(500);
    const same1 = dayDiffs(daysIn(ws, p), calm, FILE_KEYS).length === 0;
    return [!!b && same1, { said: b ? b.text : null, daysUnchanged: same1 }];
  });
  await check(c, '6.4', async () => {
    ids.backwards = (await addRow(S, p.phases.id, 'Backwards', phaseValues(ph('Backwards', 'Rest', '2027-02-10', '2027-02-05')))).pageId;
    const b = await until(() => S.block('pane', ['Backwards', /ends? before|before it starts|end\w*\b[^.]{0,30}\bbefore\b[^.]{0,30}\bstart/]), 2000, 80);
    await sleep(500);
    const rested = daysIn(ws, p).filter((d) => d.date >= '2027-02-05' && d.date <= '2027-02-10' && d.type === 'Rest' && weekdayOf(d.date) !== 'Sun').map((d) => d.date);
    return [!!b && rested.length === 0, { said: b ? b.text : null, daysItRested: rested }];
  });
  await check(c, '6.5', async () => {
    const first = must(rulesIn(ws, p).phases.find((x) => x.kind === 'Study' && x.start === BASIC.start), 'the plan\'s first phase');
    const { at, pageId } = await addRow(S, p.phases.id, 'Overlapper', phaseValues(ph('Overlapper', 'Study', '2027-02-15', '2027-03-10')));
    ids.overlap = pageId;
    const b = await until(() => S.block('pane', ['Overlapper', first.name, /overlap/]), 2000, 80);
    await sleep(500);
    const theirs = daysIn(ws, p).filter((d) => d.date >= '2027-02-15');
    await S.shot('plan-tab-contradictions');
    return [!!b && theirs.length === 14 && theirs.every((d) => d.phase === first.name), { said: b ? b.text : null, afterMs: b ? Date.now() - at : null, phaseOfTheSharedDays: [...new Set(theirs.map((d) => d.phase))] }];
  });
  await check(c, '6.6', async () => {
    must(ids.ghost && ids.backwards && ids.overlap, 'the three rows of 6.3 to 6.5');
    await setProp(S, ids.ghost, 'Days', ['Sun']);
    await setProp(S, ids.backwards, 'End', '2027-02-11');
    const at = await setProp(S, ids.overlap, 'Kind', 'Catch-up');
    const gone = await until(async () => { const t = (await S.paneWords()).replace(/Overlapper/g, ''); return !/no days/i.test(t) && !/overlap/i.test(t) && !/before it starts|ends? before/i.test(t) ? Date.now() : null; }, 2000, 80);
    const r = await follows(S, p, at);
    const sun = daysIn(ws, p).find((d) => d.date === '2027-01-10');
    return [!!gone && r.rowsMs !== null && r.tabMs !== null && sun.standard === 9, { goneAfterMs: gone ? gone - at : null, ...r, aSundayNow: sun.standard }];
  });
});

phase(7, 'His spring 2027 draft is reproduced exactly', 'subject', {
  '7.1': 'the plan is made through the sheet (start Dec 7, 2026, exam Apr 20, 2027, goal 500), the rows the form made are deleted in the tables, and his 10 Week blocks and 15 spans are entered through the chat\'s tool',
  '7.2': 'Days has 134 rows, one for each date from Dec 7, 2026 to Apr 19, 2027',
  '7.3': 'every day\'s Work, Floor, Standard and Stretch equal his sheet (the first differences are printed)',
  '7.4': 'the totals are 385, 486 and 557 hours: in Days, and in the tab as "Floor 385 h · 115 under 500", "Standard 486 h · 14 under 500", "Stretch 557 h · 57 over 500"',
  '7.5': '97 days have hours in the Standard plan: in Days, and the tab says 97 study days of 134 and "0 h: 37 days, 3 h: 15 days, 4 h: 27 days, 5 h: 17 days, 6 h: 28 days, 8 h: 10 days"',
  '7.6': 'the 14 holidays are Holiday, the 10 rest days of his spans are Rest, the 4 catch-up days are Catch-up, and the rest are Study with hours and Rest without',
  '7.7': 'each day\'s Phase is the study phase that holds it, and Planned and Running are Standard\'s (Running ends at 486)',
  '7.8': 'the tab\'s table shows the 134 days in 20 weeks with his hours, and the six phases with their days and hours',
  '7.9': 'Floor and then Stretch chosen in the tab: Running ends at 385 and at 557',
}, async (S, c) => {
  const ws = S.workspace;
  let p = null; let entered = '';
  const want = modelDays({ start: SPRING.start, exam: SPRING.exam }, SPRING_WEEK, SPRING_PHASES);
  await check(c, '7.1', async () => {
    await makePlan(S, { ...SPRING, personal: week7(2, 0, 4, 4), work: week7(0, 0, 0, 0) });
    p = must(await until(() => { const x = planOf(ws, SPRING.name); return wholePlan(x) ? x : null; }, 20_000, 100), `the page "${SPRING.name}" with its four databases`);
    must(await until(() => daysIn(ws, p).length === 134, 30_000, 100), 'the 134 Days rows of the plan the form made');
    // The rows the form made go, in the tables, as a person deletes them.
    for (const db of [p.week, p.phases]) {
      must(await openDb(S, db.id), `the ${db.title} database open in the app`);
      for (let i = 0; i < 20 && rowsOf(ws, db.id).length; i++) { const r = rowsOf(ws, db.id)[0]; await removeRow(S, db.id, r.title); await until(() => !rowsOf(ws, db.id).some((x) => x.pageId === r.pageId), 4000, 30); }
      must(rowsOf(ws, db.id).length === 0, `${db.title} emptied of the rows the form made`);
    }
    for (const w of SPRING_WEEK) await addRow(S, p.week.id, w.name, weekValues(w));
    for (const s of SPRING_PHASES) await addRow(S, p.phases.id, s.name, phaseValues(s));
    const r = rulesIn(ws, p);
    const strip = (rows) => rows.map(({ pageId, ...x }) => x).sort((a, b) => (a.name < b.name ? -1 : 1));
    const asGiven = same(strip(r.week), strip(SPRING_WEEK)) && same(strip(r.phases), strip(SPRING_PHASES)) && r.plan.start === SPRING.start && r.plan.exam === SPRING.exam && r.plan.goal === 500;
    entered = asGiven ? 'yes' : 'the rows in the file are not the rows given';
    await showTab(S, SPRING.name);
    return [asGiven, { weekRows: r.week.length, phaseRows: r.phases.length, plan: r.plan }];
  });
  const ready = () => { if (entered !== 'yes') throw new Error(entered || 'the draft was not entered (see 7.1)'); return p; };
  let settled = false;
  await check(c, '7.2', async () => {
    ready();
    settled = !!(await until(() => dayDiffs(daysIn(ws, p), want, FILE_KEYS).length === 0, 30_000, 150));
    const got = daysIn(ws, p);
    const dates = got.map((d) => d.date);
    return [got.length === 134 && same(dates, REFERENCE_DAYS.map((d) => d.date)), { rows: got.length, first: dates[0], last: dates[dates.length - 1], settledOnTheReference: settled }];
  });
  await check(c, '7.3', async () => {
    const diffs = dayDiffs(daysIn(ws, ready()), REFERENCE_DAYS);
    if (diffs.length) { console.log(`   ${diffs.length} days differ from his sheet; the first:`); for (const d of diffs.slice(0, 12)) console.log(`     ${d}`); }
    return [diffs.length === 0, diffs.length ? { daysThatDiffer: diffs.length, first: diffs.slice(0, 3) } : '134 days equal'];
  });
  await check(c, '7.4', async () => {
    const totals = totalsOf(daysIn(ws, ready()));
    await showTab(S, SPRING.name);
    const said = await until(async () => { const t = await S.paneWords(); const g = PLANS.map((pl) => (goalWords(pl, REFERENCE_TOTALS[pl], 500).exec(t) || [null])[0]); return g.every(Boolean) ? g : null; }, 4000, 100);
    await S.shot('spring-2027');
    const t = await S.paneWords();
    return [same(totals, REFERENCE_TOTALS) && !!said, { inDays: totals, inTheTab: said || PLANS.map((pl) => (totalWords(pl, REFERENCE_TOTALS[pl]).exec(t) || [`${pl}: not said`])[0]) }];
  });
  await check(c, '7.5', async () => {
    const got = daysIn(ws, ready());
    const withHours = got.filter((d) => d.work + d.standard > 0).length;
    const t = await S.paneWords();
    const part = await S.region(/hours per day/i);
    const shown = part ? perDay(part.text) : null;
    const wanted = { 0: 37, 3: 15, 4: 27, 5: 17, 6: 28, 8: 10 };
    return [withHours === 97 && count(97, `[Ss]tudy ${DAYS}`).test(t) && count(134, DAYS).test(t) && !!shown && sameMap(shown, wanted), { daysWithHoursInStandard: withHours, says97StudyDays: count(97, `[Ss]tudy ${DAYS}`).test(t), says134Days: count(134, DAYS).test(t), hoursPerDay: shown, wanted }];
  });
  await check(c, '7.6', async () => {
    const got = daysIn(ws, ready());
    const diffs = dayDiffs(got, want, ['type']);
    const typed1 = (k) => got.filter((d) => d.type === k).length;
    const by = { Study: typed1('Study'), Rest: typed1('Rest'), Holiday: typed1('Holiday'), 'Catch-up': typed1('Catch-up') };
    const spans = (kind) => SPRING_PHASES.filter((s) => s.kind === kind).flatMap((s) => want.filter((d) => s.start <= d.date && d.date <= s.end).map((d) => d.date));
    const typed = (kind) => spans(kind).every((date) => got.find((d) => d.date === date)?.type === kind);
    return [diffs.length === 0 && same(by, { Study: 93, Rest: 23, Holiday: 14, 'Catch-up': 4 }) && typed('Holiday') && typed('Rest') && typed('Catch-up') && spans('Holiday').length === 14 && spans('Rest').length === 10 && spans('Catch-up').length === 4, { types: by, differs: diffs.slice(0, 5) }];
  });
  await check(c, '7.7', async () => {
    const got = daysIn(ws, ready());
    const diffs = dayDiffs(got, want, ['phase', 'planned', 'running']);
    return [diffs.length === 0 && got[133]?.running === 486, { lastRunning: got[133]?.running, differs: diffs.slice(0, 5) }];
  });
  await check(c, '7.8', async () => {
    ready();
    await showTab(S, SPRING.name);
    const shown = await until(async () => { const d = await tabDays(S, SPRING.start); return d && dayDiffs(d, asTab(want, 'Standard'), TAB_KEYS).length === 0 ? d : null; }, 6000, 100);
    const t = await S.dayTable(SPRING.start);
    const part = await S.region(/^phases\b/i);
    const six = SPRING_PHASES.filter((s) => s.kind === 'Study').map((s) => { const inSpan = want.filter((d) => s.start <= d.date && d.date <= s.end); return { name: s.name, days: inSpan.length, hours: inSpan.reduce((a, d) => a + d.planned, 0) }; });
    const phaseFaults = six.filter((s) => { const r = part && part.rows.find((x) => x.text.includes(s.name)); return !r || !count(s.days, DAYS).test(r.text) || !count(s.hours, H).test(r.text); }).map((s) => `${s.name}: ${s.days} days, ${s.hours} h`);
    return [!!shown && !!t && t.groups === 20 && t.largestGroup <= 7 && phaseFaults.length === 0, { daysShown: t ? t.rows.length : 'no table of days', weeks: t ? t.groups : null, cellsDiffer: shown ? [] : dayDiffs((await tabDays(S, SPRING.start)) || [], asTab(want, 'Standard'), TAB_KEYS).slice(0, 5), phasesNotAsWanted: phaseFaults }];
  });
  await check(c, '7.9', async () => {
    ready();
    const ends = {};
    for (const pl of ['Floor', 'Stretch']) {
      const ch = await chooser(S);
      await S.click(must(ch.by[pl], `the control that chooses ${pl}`));
      const wantPl = modelDays({ start: SPRING.start, exam: SPRING.exam, following: pl }, SPRING_WEEK, SPRING_PHASES);
      const ok = await until(async () => dayDiffs(daysIn(ws, p), wantPl, FILE_KEYS).length === 0 && dayDiffs((await tabDays(S, SPRING.start)) || [], asTab(wantPl, pl), TAB_KEYS).length === 0, 4000, 80);
      ends[pl] = { followed: !!ok, lastRunning: daysIn(ws, p)[133]?.running };
    }
    return [ends.Floor.followed && ends.Floor.lastRunning === 385 && ends.Stretch.followed && ends.Stretch.lastRunning === 557, ends];
  });
});

phase(8, 'Find it', 'subject', {
  '8.1': 'a subject with a plan shows it in the sidebar under the subject: the plan\'s name and the days left',
  '8.2': 'pressing it in the sidebar opens the plan\'s tab',
  '8.3': 'the subject\'s More Actions has "Open Plan", and it opens the plan\'s tab',
  '8.4': 'with a second plan whose exam is sooner, the sidebar shows that one',
  '8.5': 'when that exam has passed, the sidebar shows the other again',
  '8.6': 'after the app is closed and opened the plan is still under the subject, and its tab shows its days',
}, async (S, c) => {
  const ws = S.workspace;
  const today = (await S.today()).date;
  const FAR = { name: 'Sprint', start: addDays(today, -9), exam: addDays(today, 21), goal: 60, personal: week7(2, 2, 2, 2), work: week7(1, 1, 1, 1) };
  const NEAR = { name: 'Mock Exam', start: addDays(today, -2), exam: addDays(today, 10), goal: 20, personal: week7(2, 2, 2, 2), work: week7(0, 0, 0, 0) };
  let madeErr = '';
  try { await makePlan(S, FAR); must(await tabShows(S, 30, FAR.start, 20_000), 'the tab showing the 30 days of the plan'); } catch (err) { madeErr = String((err && err.message) || err).slice(0, 240); }
  const ready = () => { if (madeErr) throw new Error(madeErr); };
  const planPoint = async (name) => { await showStudySidebar(S); return (await subjectPoint(S, name, { under: SUBJECT })) || (await S.block('sidebar', [name, /\d+\s+days?/], 80)); };
  await check(c, '8.1', async () => {
    ready();
    await showStudySidebar(S);
    const left = await until(async () => { const n = await sidebarPlan(S, FAR.name); return n === null ? null : { n }; }, 5000, 100);
    await S.shot('sidebar-plan');
    return [!!left && left.n === 21, { daysLeftSaid: left ? left.n : null, wanted: 21, subjects: (await subjectsText(S))?.slice(0, 200) }];
  });
  await check(c, '8.2', async () => {
    ready();
    await closeTab(S, FAR.name);
    const pt = must(await planPoint(FAR.name), `"${FAR.name}" under the subject in the sidebar`);
    await S.click(pt);
    const front = await until(async () => (await tabTitled(S, FAR.name)).some((t) => t.active), 5000, 60);
    return [!!front && !!(await tabShows(S, 30, FAR.start, 6000)), { tabInFront: !!front }];
  });
  await check(c, '8.3', async () => {
    ready();
    await closeTab(S, FAR.name);
    await openPlan(S, FAR.name);
    return [!!(await tabShows(S, 30, FAR.start, 6000)), 'opened through More Actions'];
  });
  await check(c, '8.4', async () => {
    ready();
    await makePlan(S, NEAR);
    await showStudySidebar(S);
    const left = await until(async () => { const n = await sidebarPlan(S, NEAR.name); return n === null ? null : { n }; }, 5000, 100);
    const other = await sidebarPlan(S, FAR.name);
    return [!!left && left.n === 10 && other === null, { shown: left ? `${NEAR.name}, ${left.n} days` : null, theLaterOneAlsoShown: other !== null, subjects: (await subjectsText(S))?.slice(0, 200) }];
  });
  await check(c, '8.5', async () => {
    ready();
    const near = mustPlan(ws, NEAR.name);
    await setProp(S, rulesIn(ws, near).planRow.pageId, 'Start Date', addDays(today, -12));
    await setProp(S, rulesIn(ws, near).planRow.pageId, 'Exam Date', addDays(today, -1));
    const back = await until(async () => ((await sidebarPlan(S, FAR.name)) === 21 && (await sidebarPlan(S, NEAR.name)) === null ? true : null), 5000, 100);
    return [!!back, { subjects: (await subjectsText(S))?.slice(0, 200) }];
  });
  await check(c, '8.6', async () => {
    ready();
    await S.relaunch();
    await showStudySidebar(S);
    const left = await until(async () => { const n = await sidebarPlan(S, FAR.name); return n === null ? null : { n }; }, 15_000, 150);
    if (!(await showTab(S, FAR.name))) { const pt = must(await planPoint(FAR.name), `"${FAR.name}" under the subject in the sidebar after the restart`); await S.click(pt); }
    const days = await tabShows(S, 30, FAR.start, 10_000);
    const want = asTab(expectedDays(S.workspace, mustPlan(S.workspace, FAR.name)).days, 'Standard');
    return [!!left && left.n === 21 && !!days && dayDiffs(days, want, TAB_KEYS).length === 0, { daysLeftSaid: left ? left.n : null, daysShown: days ? days.length : null }];
  });
});

phase(9, 'Everyone can use it', 'plan', {
  '9.1': 'the sheet keeps Tab inside it, every field and button of it has a name, and Escape closes it and gives the focus back',
  '9.2': 'every control of the tab has a name',
  '9.3': 'the Tab key reaches the choice of plan and the four Open buttons, and each shows where the focus is',
  '9.4': 'the plan he follows can be chosen with the keys alone',
  '9.5': 'the table of days is a real table: a caption, column headers, a header cell in each day\'s row',
  '9.6': 'Type is in words on every row, never by colour alone',
  '9.7': 'the words of each Type have a contrast of 4.5 to 1, in dark and in light',
  '9.8': 'at 900 px wide nothing of the tab is cut off, and the totals and the table are still there',
}, async (S, c) => {
  const ws = S.workspace; const p = mustPlan(ws, BASIC.name);
  await check(c, '9.1', async () => {
    const items = must(await subjectMenu(S, SUBJECT), 'the subject\'s More Actions menu');
    const item = items.find((i) => /^New Plan…$/.test(i.name));
    if (!item) { await S.page.keyboard.press('Escape'); throw new Error(`no "New Plan…" in More Actions (${items.map((i) => i.name).join(', ')})`); }
    await S.click(item);
    must(await until(async () => (await S.formOpen()) && (await S.field(PF.exam)), 6000, 80), 'the New Plan sheet');
    await sleep(400);
    await S.click(must(await S.field(PF.name), 'the Name field'));
    let escaped = 0; const stops = new Set();
    for (let i = 0; i < 45; i++) { await S.page.keyboard.press('Tab'); if (!(await S.page.evaluate(() => window.__pp.inForm()))) escaped += 1; else stops.add(await S.page.evaluate(() => window.__pp.focusShown())); }
    for (let i = 0; i < 5; i++) { await S.page.keyboard.press('Shift+Tab'); if (!(await S.page.evaluate(() => window.__pp.inForm()))) escaped += 1; }
    const unnamed = await S.page.evaluate(() => window.__pp.unnamedFields());
    await S.page.keyboard.press('Escape');
    const closed = await until(async () => !(await S.formOpen()), 3000);
    await sleep(300);
    const back = await S.page.evaluate(() => window.__pp.focusShown());
    return [escaped === 0 && stops.size >= 19 && unnamed === 0 && !!closed && !!back, { tabsThatLeftTheSheet: escaped, stopsInside: stops.size, unnamed, closedByEscape: !!closed, focusAfter: back || 'nowhere (the page body)' }];
  });
  await openPlan(S, BASIC.name);
  must(await tabShows(S, 56, BASIC.start), 'the tab showing the 56 days of the plan');
  // A day of rest, a catch-up day and a holiday, so every Type is on screen.
  for (const s of [ph('Day Off', 'Rest', '2027-01-20', '2027-01-20'), ph('Loose Ends', 'Catch-up', '2027-01-28', '2027-01-28'), ph('Ski Trip', 'Holiday', '2027-02-13', '2027-02-14')]) await addRow(S, p.phases.id, s.name, phaseValues(s));
  await follows(S, p, Date.now());
  await check(c, '9.2', async () => {
    const all = await S.page.evaluate(() => window.__pp.controls());
    const unnamed = all.filter((x) => !x.name);
    return [all.length >= 7 && unnamed.length === 0, { controls: all.length, unnamed: unnamed.map((x) => `${x.tag} ${x.role}`).slice(0, 6) }];
  });
  const stops = [];
  await check(c, '9.3', async () => {
    const tab = must((await tabTitled(S, BASIC.name))[0], 'the plan\'s tab');
    await S.click(tab);
    let entered = false;
    for (let i = 0; i < 120; i++) {
      await S.page.keyboard.press('Tab');
      const f = await S.focused();
      if (f && f.inPane) { entered = true; if (stops.some((s) => s.name === f.name && s.tag === f.tag) && stops.length > 4) break; stops.push(f); } else if (entered) break;
    }
    const reached = (re) => stops.some((s) => re.test(s.name));
    const noRing = stops.filter((s) => !s.hasRing || !s.keyboard).map((s) => s.name);
    const need = { 'a choice of plan': /^(Floor|Standard|Stretch)\b/, 'Open Days': /^Open Days$/, 'Open Week': /^Open Week$/, 'Open Phases': /^Open Phases$/, 'Open Plan Settings': /^Open Plan Settings$/ };
    const missing = Object.entries(need).filter(([, re]) => !reached(re)).map(([k]) => k);
    return [missing.length === 0 && noRing.length === 0, { stops: stops.map((s) => s.name.slice(0, 30)), notReached: missing, withoutVisibleFocus: noRing }];
  });
  await check(c, '9.4', async () => {
    const tab = must((await tabTitled(S, BASIC.name))[0], 'the plan\'s tab');
    await S.click(tab);
    let on = null;
    for (let i = 0; i < 120 && !on; i++) { await S.page.keyboard.press('Tab'); const f = await S.focused(); if (f && f.inPane && /^(Floor|Standard|Stretch)\b/.test(f.name)) on = f; }
    must(on, 'a choice of plan reached by Tab');
    // A radio group moves with the arrows; separate buttons are reached by Tab.
    for (let i = 0; i < 4 && !/^Floor\b/.test((await S.focused())?.name || ''); i++) await S.page.keyboard.press(on.role === 'radio' ? 'ArrowLeft' : 'Shift+Tab');
    for (let i = 0; i < 4 && !/^Floor\b/.test((await S.focused())?.name || ''); i++) await S.page.keyboard.press(on.role === 'radio' ? 'ArrowRight' : 'Tab');
    const f = await S.focused();
    if (/^Floor\b/.test(f?.name || '') && rulesIn(ws, p).planRow.values.Following !== 'Floor') await S.page.keyboard.press('Space');
    const at = Date.now();
    const stored = await until(() => rulesIn(ws, p).planRow.values.Following === 'Floor', 2500, 30);
    const r = stored ? await follows(S, p, at) : null;
    return [!!stored && !!r && r.rowsMs !== null && r.tabMs !== null && same((await chooser(S)).marked, ['Floor']), { focusedBeforeSpace: f?.name ?? null, following: rulesIn(ws, p).planRow.values.Following, ...(r || {}) }];
  });
  await check(c, '9.5', async () => {
    const t = must(await S.dayTable(BASIC.start), 'a table in the tab whose rows carry data-date');
    const noHeader = t.rows.filter((r) => !r.rowHeader).length;
    return [!!t.caption && t.headsAreTh && t.heads.length >= 7 && noHeader === 0, { caption: t.caption, columnHeadersAreTh: t.headsAreTh, heads: t.heads, rowsWithoutAHeaderCell: noHeader }];
  });
  await check(c, '9.6', async () => {
    const want = expectedDays(ws, p).days;
    const t = must(await S.dayTable(BASIC.start), 'the table of days');
    const wordless = t.rows.filter((r) => { const w = want.find((d) => d.date === r.date); return !w || !new RegExp(`\\b${esc(w.type)}\\b`, 'i').test(r.cells.type || ''); }).map((r) => `${r.date}: "${r.cells.type ?? ''}"`);
    const kinds = new Set(want.map((d) => d.type));
    return [t.rows.length === 56 && wordless.length === 0 && kinds.size === 4, { rows: t.rows.length, rowsWithoutTheirTypeInWords: wordless.slice(0, 5), typesOnScreen: [...kinds] }];
  });
  await check(c, '9.7', async () => {
    const at = { Study: '2027-01-19', Rest: '2027-01-20', 'Catch-up': '2027-01-28', Holiday: '2027-02-13' };
    const got = {};
    for (const mode of ['dark', 'light']) {
      await setMode(S, mode);
      await showTab(S, BASIC.name);
      await sleep(400);
      for (const [k, d] of Object.entries(at)) { const l = await S.look(d); got[`${k}, ${mode}`] = l && l.ink && l.ink.fg ? Number(ratio(l.ink.fg, l.ink.bg).toFixed(2)) : null; }
      await S.shot(`plan-tab-${mode}`);
    }
    await setMode(S, 'dark');
    await showTab(S, BASIC.name);
    return [Object.values(got).length === 8 && Object.values(got).every((v) => v !== null && v >= 4.5), got];
  });
  await check(c, '9.8', async () => {
    await showTab(S, BASIC.name);
    const width = await setWidth(S, 900);
    await sleep(600);
    const cut = await S.page.evaluate(() => window.__pp.cutOff());
    const t = await S.paneWords(); const table = await S.dayTable(BASIC.start);
    const totals = PLANS.every((pl) => new RegExp(`(?<![A-Za-z])${pl}\\b\\D{0,30}\\d+\\s*${H}`).test(t));
    await S.shot('plan-tab-900');
    await setWidth(S, 1440);
    return [width <= 900 && !!cut && !cut.pageScrolls && cut.cutCount === 0 && totals && !!table && table.rows.length === 56, { ...cut, totalsStillThere: totals, daysStillThere: table ? table.rows.length : 0 }];
  });
});

phase(10, 'Study off, the Trash, and how long it takes', 'subject', {
  '10.1': 'a plan of 134 days: from Create to the tab showing every day in under 20 s (the time is printed)',
  '10.2': 'a rule changed in the plan of 134 days shows within 2 s',
  '10.3': 'Study off: its plan commands and the plan\'s tab are gone, a rule edited and a note typed meanwhile are stored, and nothing in Days is worked out',
  '10.4': 'Study on again, without a restart: the days catch up with the rule that changed while it was off',
  '10.5': 'the Days database in the Trash: the tab says so in words, and a rule changed meanwhile writes nothing and makes no new database',
  '10.6': 'a plan whose Week database is in the Trash says so in its tab, and its Days stay as they are',
}, async (S, c) => {
  const ws = S.workspace;
  const BIG = { ...SPRING, name: 'Long Haul', personal: week7(2, 0, 4, 4), work: week7(1, 1, 0, 0) };
  let p = null;
  await check(c, '10.1', async () => {
    const at = await makePlan(S, BIG);
    const shown = await until(async () => { const d = await tabDays(S, BIG.start); return d && d.length === 134 ? Date.now() : null; }, 60_000, 60);
    p = await until(() => { const x = planOf(ws, BIG.name); return wholePlan(x) ? x : null; }, 10_000, 100);
    const want = p ? formDays(BIG, rulesIn(ws, p).phases[0]?.name ?? '') : [];
    const right = !!p && !!(await until(async () => dayDiffs(daysIn(ws, p), want, FILE_KEYS).length === 0 && dayDiffs((await tabDays(S, BIG.start)) || [], asTab(want, 'Standard'), TAB_KEYS).length === 0, 10_000, 100));
    console.log(`   from Create to the tab showing 134 days: ${shown ? `${shown - at} ms` : 'not within 60 s'}`);
    return [!!shown && shown - at < 20_000 && right, { ms: shown ? shown - at : null, daysAsTheFormGives: right }];
  });
  const plan = () => must(p && wholePlan(p) ? p : null, `the plan "${BIG.name}" made in 10.1`);
  await check(c, '10.2', async () => {
    const r = await ruleChange(S, plan(), async () => (await addRow(S, p.week.id, 'Friday Evenings', weekValues(wk('Friday Evenings', ['Fri'], 'Personal', '2027-01-01', '', 1, 2, 3)))).at);
    console.log(`   a rule changed over 134 days: Days rows after ${r.rowsMs} ms, the tab after ${r.tabMs} ms`);
    return [inTime(r), r];
  });
  let offSnapshot = null;
  await check(c, '10.3', async () => {
    plan();
    const snap = () => JSON.stringify(daysIn(ws, p).map(({ note, ...d }) => d));
    await S.setTool('study', false);
    await sleep(800);
    const gone = { newPlan: !(await S.hasCommand('study.newPlan')), tab: (await tabTitled(S, BIG.name)).length === 0 };
    offSnapshot = snap();
    await addRow(S, p.week.id, 'While Off', weekValues(wk('While Off', ['Sun'], 'Work', '', '', 3, 3, 3)));
    must(await openDb(S, p.days.id), 'the Days database open in the app with Study off');
    const day = daysIn(ws, p)[5];
    const typed = await typeCell(S, p.days.id, day.title, 'Note', 'dentist at four');
    const noted = await until(() => daysIn(ws, p)[5].note === 'dentist at four', 3000, 30);
    await sleep(4000);
    const still = snap() === offSnapshot;
    const whole = wholePlan(planOf(ws, BIG.name));
    return [gone.newPlan && gone.tab && !!typed && !!noted && still && whole && rulesIn(ws, p).week.some((w) => w.name === 'While Off'), { commandGone: gone.newPlan, tabGone: gone.tab, noteStored: !!noted, ruleStored: rulesIn(ws, p).week.some((w) => w.name === 'While Off'), daysUntouched: still, fourDatabasesWhole: whole }];
  });
  await check(c, '10.4', async () => {
    plan();
    if (await S.hasCommand('study.newPlan')) await S.setTool('study', false);
    const at = await S.setTool('study', true);
    const caught = await until(() => (dayDiffs(daysIn(ws, p), expectedDays(ws, p).days, FILE_KEYS).length === 0 && rulesIn(ws, p).week.some((w) => w.name === 'While Off') ? Date.now() : null), 15_000, 100);
    await showStudySidebar(S);
    await openPlan(S, BIG.name);
    const r = await follows(S, p, at, { ms: 10_000 });
    const sunday = daysIn(ws, p).find((d) => weekdayOf(d.date) === 'Sun');
    console.log(`   Study on again: the days caught up after ${caught ? caught - at : 'more than 15000'} ms`);
    return [!!caught && r.tabMs !== null && sunday.work === 3 && daysIn(ws, p)[5].note === 'dentist at four' && daysIn(ws, p).every((d) => !d.edited), { caughtUpAfterMs: caught ? caught - at : null, aSundaysWork: sunday.work, noteKept: daysIn(ws, p)[5].note, rowsMarkedEdited: daysIn(ws, p).filter((d) => d.edited).length, tabFollowed: r.tabMs !== null }];
  });
  await check(c, '10.5', async () => {
    plan();
    await openPlan(S, BIG.name);
    must(await tabShows(S, 134, BIG.start, 10_000), 'the tab showing the 134 days before the Trash');
    const values = () => coreAll(ws, 'SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(value)), 0) AS bytes FROM page_property_values WHERE database_id = ?', [p.days.id])[0];
    await toTrash(S, p.days.id);
    must(await until(() => coreAll(ws, 'SELECT is_archived FROM pages WHERE id = ?', [p.days.id])[0]?.is_archived === 1, 5000), 'the Days database in the Trash');
    await showTab(S, BIG.name);
    const said = await until(async () => { const t = await S.paneWords(); const m = /[^.]*\bTrash\b[^.]*/i.exec(t); return m ? m[0].trim().slice(0, 160) : null; }, 5000, 100);
    await S.shot('plan-tab-days-in-trash');
    const before = values(); const dbs = coreAll(ws, 'SELECT COUNT(*) AS n FROM databases')[0].n;
    await addRow(S, p.week.id, 'After The Trash', weekValues(wk('After The Trash', ['Mon'], 'Personal', '', '', 5, 5, 5)));
    await sleep(4000);
    const after = values(); const dbsAfter = coreAll(ws, 'SELECT COUNT(*) AS n FROM databases')[0].n;
    return [!!said && same(before, after) && dbs === dbsAfter && before.n > 0, { said, valuesInDays: [before, after], databases: [dbs, dbsAfter] }];
  });
  await check(c, '10.6', async () => {
    const SMALL = { ...BASIC, name: 'Short Block' };
    await makePlan(S, SMALL);
    const sp = must(await until(() => { const x = planOf(ws, SMALL.name); return wholePlan(x) ? x : null; }, 20_000, 100), `the plan "${SMALL.name}"`);
    must(await tabShows(S, 56, SMALL.start, 20_000), 'the tab showing its 56 days');
    const snap = () => JSON.stringify(daysIn(ws, sp));
    const before = snap();
    await toTrash(S, sp.week.id);
    must(await until(() => coreAll(ws, 'SELECT is_archived FROM pages WHERE id = ?', [sp.week.id])[0]?.is_archived === 1, 5000), 'the Week database in the Trash');
    await showTab(S, SMALL.name);
    const said = await until(async () => { const t = await S.paneWords(); const m = /[^.]*\bTrash\b[^.]*/i.exec(t); return m ? m[0].trim().slice(0, 160) : null; }, 5000, 100);
    await sleep(2500);
    return [!!said && snap() === before && daysIn(ws, sp).length === 56, { said, daysUnchanged: snap() === before, rows: daysIn(ws, sp).length }];
  });
});

/** The window made `width` wide; what the page then measures. */
async function setWidth(S, width) {
  await S.app.evaluate(({ BrowserWindow }, w) => { const win = BrowserWindow.getAllWindows()[0]; win.setMinimumSize(400, 300); win.setContentSize(w, 900); }, width);
  await S.page.setViewportSize({ width, height: 900 }).catch(() => {});
  await sleep(500);
  return S.page.evaluate(() => window.innerWidth);
}

// ── The workspaces the phases start from: made by the app, once each ────────
// Study may know a subject by its workspace, so the phases all run on the one
// workspace path it was made in, put back from a snapshot before each.
const BASE_WORKSPACE = path.join(OUT, 'runs', 'subject-workspace');
const bases = { subject: { snapshot: null, failed: '' }, plan: { snapshot: null, failed: '' } };
async function baseOf(kind) {
  const b = bases[kind];
  if (b.snapshot) return b.snapshot;
  if (b.failed) throw new Error(b.failed);
  const from = kind === 'plan' ? await baseOf('subject') : null;
  const S = planSession(await newRoot(`${kind}-made`, from, BASE_WORKSPACE));
  try {
    await S.open();
    if (kind === 'subject') {
      await newSubject(S, { name: SUBJECT });
      must(await waitSubject(S, SUBJECT), `the page "${SUBJECT}" with Units and Work Log under it`);
      await showStudySidebar(S);
      must(await until(async () => /Exam 7/.test((await subjectsText(S)) || ''), 12_000), 'the subject in the sidebar');
      console.log(`[probe] the workspace was made by the app: the subject "${SUBJECT}" (zone ${(await S.today()).zone}, today ${(await S.today()).date})`);
    } else {
      await makePlan(S, BASIC);
      const p = must(await until(() => { const x = planOf(S.workspace, BASIC.name); return wholePlan(x) ? x : null; }, 20_000, 100), `the page "${BASIC.name}" with Plan, Week, Phases and Days under the subject's page`);
      must(await until(() => same(totalsOf(daysIn(S.workspace, p)), BASIC_TOTALS) && daysIn(S.workspace, p).length === 56, 30_000, 150), `the 56 days of "${BASIC.name}" with ${JSON.stringify(BASIC_TOTALS)} hours (they give ${JSON.stringify(totalsOf(daysIn(S.workspace, p)))} over ${daysIn(S.workspace, p).length} rows)`);
      must(await tabShows(S, 56, BASIC.start, 20_000), 'the plan\'s tab showing its 56 days');
      console.log(`[probe] the plan "${BASIC.name}" was made through the sheet`);
    }
    await sleep(2000);
  } catch (err) {
    b.failed = `the workspace the phase starts from could not be made (${kind === 'plan' ? 'a subject with the plan "Winter Block" made through the New Plan sheet' : 'a subject'}): ${String((err && err.message) || err).split('\n')[0].slice(0, 260)}`;
    throw new Error(b.failed);
  } finally {
    await S.close();
  }
  const snapshot = path.join(OUT, 'runs', `${kind}-snapshot`);
  await fs.rm(snapshot, { recursive: true, force: true });
  await fs.cp(BASE_WORKSPACE, snapshot, { recursive: true });
  await fs.rename(BASE_WORKSPACE, path.join(OUT, 'runs', `${kind}-made`, 'workspace-after')).catch(() => {});
  b.snapshot = snapshot;
  return snapshot;
}
/** The ids a phase on the subject works with, from the file. */
function subjectIds(ws) {
  const s = subjectOf(ws, SUBJECT);
  return { page: s.page?.id ?? null, units: s.units?.id ?? null, log: s.log?.id ?? null };
}

async function main() {
  await fs.mkdir(path.join(OUT, 'shots'), { recursive: true });
  await fs.rm(path.join(OUT, 'runs'), { recursive: true, force: true });
  const t0 = Date.now();
  for (const p of PHASES) {
    if (ONLY && !ONLY.has(p.n)) continue;
    console.log(`\n── ${p.n}. ${p.title}`);
    const tp = Date.now();
    const done = new Set();
    const c = (id, ok, got) => { if (done.has(id)) return; done.add(id); record(id, p.checks[id] ?? '(unnamed check)', ok, got); };
    let S = null;
    let stopped = '';
    try {
      S = planSession(await newRoot(`phase-${String(p.n).padStart(2, '0')}`, await baseOf(p.base), BASE_WORKSPACE));
      await S.open();
      await p.fn(S, c, subjectIds(S.workspace));
    } catch (err) {
      stopped = String((err && err.message) || err).split('\n')[0].slice(0, 300);
      if (S && S.page) await S.shot(`${String(p.n).padStart(2, '0')}-stopped`);
    } finally {
      if (S) await S.close();
      if (S) await fs.rename(BASE_WORKSPACE, path.join(S.dir, 'workspace-after')).catch(() => {});
    }
    // A check the phase never reached has not passed.
    for (const id of Object.keys(p.checks)) if (!done.has(id)) c(id, false, stopped ? `not reached: ${stopped}` : 'not reached');
    console.log(`   (${Math.round((Date.now() - tp) / 1000)} s)`);
  }
  const failed = results.filter((r) => !r.ok);
  const ground = results.filter((r) => r.id.startsWith('0.'));
  console.log(`\n[probe] page errors: ${pageErrors.length}`);
  for (const e of [...new Set(pageErrors)].slice(0, 8)) console.log(`   ${e}`);
  console.log(`[probe] ${results.length} checks: ${results.length - failed.length} ok, ${failed.length} FAIL${failed.length ? ` (${failed.map((r) => r.id).join(' ')})` : ''}`);
  console.log(`[probe] of them the ground (phase 0): ${ground.filter((r) => r.ok).length} of ${ground.length} ok; the plan (phases 1 to 10): ${results.filter((r) => !r.id.startsWith('0.') && r.ok).length} of ${results.length - ground.length} ok`);
  console.log(`[probe] ${Math.round((Date.now() - t0) / 1000)} s; screenshots in ${path.join(OUT, 'shots')}`);
  process.exitCode = failed.length ? 1 : 0;
}
main().catch((err) => { console.log(`[probe] FAIL the probe itself stopped: ${err && err.stack ? err.stack : err}`); process.exitCode = 1; });
