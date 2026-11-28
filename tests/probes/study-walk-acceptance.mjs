// @acceptance: Study after the student walk-through: past days kept, a phase that follows the exam, one unit per paper, more matches, today's Done, a clock without idle time, words, Enter
// Written from the request ("Study, after the student walk-through: fix what
// shipped", 2026-11-23, its eight numbered points) before the build, by a
// verifier that did not build it, and seen to fail on the app as it was
// (a2630374). The builder does not edit this file: a check that is wrong is
// reported, not changed.
//
// What a person must be able to do when the piece is done (a phase's number is
// the request's point; PARALLX_PROBE_ONLY takes these numbers):
//
//    1  Days gone by are never rewritten: a Week row, a Phases row or the
//       plan's dates changed, and today and the days after follow while every
//       day before today keeps its Type, Phase and hours, unmarked; Running
//       and Done still follow; so too after a restart and two days later; the
//       tab says "Changes apply from today on"
//    2  A phase can follow the exam: Phases has a column Follows (Whole plan,
//       Before exam); Create's "Start to exam" follows Whole plan; the sheet
//       asks "Days off before the exam" and more than 0 makes the Rest phase
//       "Days off" that follows Before exam; the exam date moved, both move
//       within 2 s in Phases and in the tab; a dated phase left outside the
//       plan and study days in no Study phase are named in "Rules that
//       disagree"
//    3  New Subject with a sources folder and a question bank makes one unit
//       per paper: a file whose name holds a bank unit's name as whole words
//       joins it (Material, and its name in Also Called), any other file is
//       its own unit holding its file; a unit's tab lists its PDF; "Remove
//       Unit…" in a unit row's More Actions asks first and puts the row in the
//       Trash, questions and files staying; a tab of a unit that is gone says
//       so and can be closed, after a restart too
//    4  Find Matches… also proposes a page or file whose name holds a unit's
//       name or an Also Called name as whole words, in any letter case, exact
//       names first, all unticked, each row with its unit and why ("name
//       holds Mack"); it opens whenever there is something to propose and says
//       so in words when there is nothing
//    5  Today's Done shows on today's row; under 0.1 h it is said in minutes
//       ("2 min"), never "0"; a session finished now is there within 2 s
//    6  Study's clock leaves out idle time: seconds count only while the
//       session's tab is showing and there was input in the last 10 minutes;
//       a stretch that ends idle is taken back
//    7  Words: what Personal and Work hours are and what Floor, Standard and
//       Stretch are, in the New Plan sheet and in the tab; what Rest, Catch-up
//       and Holiday do to a day's hours, by the phases; the sheet's hours less
//       and more are said to fill the columns once
//    8  Enter starts: in the Study setup sheet, Enter does what Start does
//    9  is the request's last line: everyone can use every new control (the
//       keys, a name, the focus shown, a finger)
//    0  is not in the request: the ground the other checks stand on (the seed
//       as the app shows it, a plan begun nine days ago, a session, the page's
//       clock, Find Matches as it is, the Trash, menus by keys and by finger,
//       light and dark). Its checks pass before the build and must go on
//       passing. Three checks in other phases are ground too and are printed
//       with "(holds today)": 1.6 (Running and Done follow), 3.9 (a tab of a
//       unit trashed in Units says so) and 6.4 (the four kinds of input each
//       count). Every other check fails before the build.
//
// On the app as it was (a2630374, 2026-11-23, Linux, zone America/Chicago,
// one run of 7 minutes): 74 checks. The 18 of the ground pass (phase 0's 15,
// and 1.6, 3.9 and 6.4). The 56 of the new behaviour all fail. No page error.
//
// How it runs. Every phase gets its own app, profile and workspace, so one
// failure hides nothing. A phase starts from a copy of one of three
// workspaces the app itself made, each from the one before:
//   seed  the files written to disk (six PDFs in Readings/, four notes in
//         Notes/, one at the root), five pages and a question bank with a
//         Paper column, made through the chat's own tools; no subject
//   bank  the subject "Exam 7" made from the bank through the New Subject
//         sheet (five units), Mack's Also Called set to "Chain Ladder" by the
//         table's own command
//   plan  the plan "Sprint" made through the New Plan sheet: it began nine
//         days before today and its exam is three weeks from today
// Phase 3 starts from seed (it makes its own subject, with the folder);
// phases 2, 4, 6, 8 and 9 from bank; phases 0, 1, 5 and 7 from plan. The
// mouse, the keys and the finger are real. A scripted model stands in for the
// owner's: it grades a typed answer by its words, which proves the plumbing
// and never the grading.
//
//   xvfb-run -a node tests/probes/study-walk-acceptance.mjs [outDir]
//   PARALLX_PROBE_ONLY=0,3,5-7   only those phases
//   PARALLX_PROBE_TZ=Asia/Tokyo  the app's time zone (default America/Chicago;
//                                Linux and macOS only, Windows keeps its own)
//
// Today and the clock. "Today" is the real today as the app's own window
// gives it: Sprint's dates are counted from it (nine days back, 21 on), and
// the plans of phases 2 and 9 lie wholly ahead (a week on to seven weeks on),
// so no date is fixed and none can drift into the past. Time that must pass
// is not waited for: the checks below install Playwright's clock on the page
// (page.clock) and move it, so the app's own timers and Date run on, and an
// hour takes seconds. Which checks use it:
//   0.6, 5.1 and all of phase 6   minutes at the desk and idle time: the
//         clock is run forward a stretch at a time (clock.runFor, which fires
//         every timer in between) with a real key, wheel, click or tap after
//         a stretch where one is meant
//   1.8   the clock is installed two days ahead: "today" is then two days on
// Everything else runs on the real clock. The only real waits are for the
// app to answer, and each limit of the request ("within 2 seconds") is
// measured and printed. A run that crosses local midnight between making the
// plan and using it will fail phases 1 and 5; run it again.
//
// Where a result is read from. Never from what the probe typed: from the
// workspace's own database file (<workspace>/.parallx/data.db: Units, the
// bank, the Work Log, the plan's Plan, Week, Phases and Days as the app wrote
// them), from the files on disk, from the tab on screen (its words, its day
// table, the names its controls speak) and from what the workbench reports
// as the editor in front.
//
// How the probe writes (none of it is Study): the chat's own tools
// canvas_add_database_row and canvas_set_page_property, the canvas table with
// the mouse and keys (a number typed into a cell), canvas.deletePage with its
// "Move to Trash". The subject and the plans are made only through their
// sheets. canvas_set_page_property answers "set" for a column that does not
// exist, so after every write the file is asked.
//
// What the probe holds on to (the builder keeps these, or the check fails):
//   - the words of the request, exactly: "Changes apply from today on" in the
//     plan's tab; the Phases column "Follows", a select offering "Whole plan"
//     and "Before exam" in that order; the phases "Start to exam" and "Days
//     off"; the sheet's field "Days off before the exam" (its label begins
//     so), holding 0 to begin with; "Rules that disagree" as the name of a
//     part of the tab; "Remove Unit…" (with the one-character ellipsis) in a
//     unit row's More Actions; a row of Find Matches that says "holds Mack"
//     ("name holds Mack": the word holds, then the name it found, a quote
//     mark before it allowed); "2 min" in a Done cell
//   - THE HOOKS (the few things that are not the request's words):
//       1. a line that explains a term (point 7) is a line of its own, not
//          inside a control or a table cell and not aria-hidden, that begins
//          with the term ("Personal …", "The Floor …", "Catch-up: …") and
//          has five words or more; the five of Personal, Work, Floor,
//          Standard and Stretch are five different lines, in the sheet and
//          again in the tab; the three of Rest, Catch-up and Holiday are
//          inside the tab's part named Phases and each has the word "hours"
//       2. the sheet's line about hours less and more has the word "once"
//          and one of less, more, Floor, Stretch
//       3. a rule that disagrees is a row (li, tr, role row or listitem) of
//          the part named "Rules that disagree"; the row for a dated phase
//          outside the plan holds the phase's name and the word "outside";
//          the row for study days in no Study phase has the word "phase" and
//          either their number ("6 study days", "6 days") or the first of
//          those days as a date
//       4. the question "Remove Unit…" asks is the app's modal (role=dialog
//          or .parallx-modal-box); its words hold the unit's name; it has a
//          button "Cancel" and a confirming button named "Remove", "Remove
//          Unit" or "Move to Trash"
//       5. a tab of a unit that is gone says one of: no longer, is gone, was
//          removed, has been removed, in the Trash, not in Units, deleted;
//          on screen, in the tab in front
//       6. a unit made from a file is named for the file without its
//          extension (as today), and Also Called holds a joined file's name
//          without its extension, whatever else it holds
//   - as they are today: the day table of the plan's tab (tr[data-date],
//     today's aria-current, the column headers Date, Type, Phase, Personal,
//     Work, Total, Done, Running), the parts "Phases" and "Rules that
//     disagree" named by aria-label or heading, the plan's four databases and
//     their columns, the New Plan sheet's fields, the unit's tab (a heading
//     per group, "Open <title>", "Study…"), Find Matches as a list of
//     checkable rows in the app's dialog with "Attach Selected" and, when
//     there is nothing, a notification (.parallx-notification-message), the
//     setup sheet (.st-sheet, its Start), a session's card, "End Session"
//     and the results, the Work Log row titled "<Subject> · <Unit>" with
//     Minutes, the sidebar's Subjects with a unit's row followed by its More
//     Actions, the app's menu ([role=menuitem], the item the keys are on
//     marked .context-menu-item--selected), the canvas table, Appearance
//
// How the request is read where it leaves room (told to the builder):
//   1  "keeps the hours it had": the Days columns Type, Phase, Work, Floor,
//      Standard and Stretch of a day before today are as they were, its
//      Edited is not ticked, and its row is still in Days; this holds when
//      the start date moves later than that day (the row stays; where the
//      tab shows it is not checked) and when the exam date moves. What a
//      start date moved earlier puts into the new past days is not checked.
//      "Today" is the day the change is made, not the day the plan was made
//      (1.8). Following changed is not a change of this point and is not
//      checked. A day he changes by hand is still his (Edited), past or not
//   2  the exam or the start moved while a phase follows: its Start and End
//      in the Phases rows are rewritten by Study (that is "keeps"), and the
//      2 s run from the chat's tool answering to the file and then to the
//      tab. A phase with Follows empty keeps its dates ("dated"). "Before
//      exam" keeps the number of days from Start to End. What Study does
//      when he edits by hand the Start or End of a phase that follows is not
//      checked. Follows is emptied through the chat's tool with ''
//   3  "holds a bank unit's name as whole words": the name stands in the
//      file's name between characters that are not letters or digits, in the
//      same letter case here ("Mackenzie 2001 - Notes.pdf" does not hold
//      Mack). The seed has no file that holds two units' names. "Remove
//      Unit…" leaves every other unit's row untouched. After a restart the
//      tab of a unit that is gone may say so and close, or not come back at
//      all; to tell the second from tabs not being brought back, the tab of
//      a unit that is there is open beside it and must be back
//   4  "exact matches first": every row whose name is a unit's or an Also
//      Called name stands above every row that only holds one. One row per
//      item and unit: the PDF that holds both "Mack" and Mack's "Chain
//      Ladder" is one row, and may give either as its reason. The row "says
//      which unit": the unit's name stands in the row outside the item's own
//      title line. Nothing else is proposed: ten rows from this seed
//   5  "within 2 seconds" runs from the results being on screen (a session)
//      or the tool answering (a Work Log row) to Days, and to the tab once
//      its tab is clicked. A session of three minutes at the desk is logged
//      as 3 to 5 Minutes and today's Done reads that many "min". Hours are
//      read as the tab writes them ("1.6", "1.6 h", "1 h 34 min")
//   6  the Work Log's Minutes of the session are what is read (they are the
//      session's seconds, rounded up). "No hour": 5 minutes at most after 61
//      idle. Ten minutes is not made a setting here; Worksheets' own setting
//      is not looked at. Being "on another tab" is the session's tab not in
//      front in its group; the window hidden or minimised is not driven
//   8  the setup sheet over a bank has only buttons, so "the focus anywhere
//      but a button" is the sheet itself (where the focus is when it opens,
//      and after a press on its title). 8.2 holds that Enter starts wherever
//      the focus lands when the sheet is opened by the keys; if the build
//      puts it on a button other than Start, that check fails and says so
//
// Where an earlier probe contradicts a point here (said, not edited):
//   - study-plan-acceptance sets the End of the phase Create made ("Start to
//     exam") by hand and expects it to stay (its 2.8, 3.5, phase 5 and 6.x).
//     Point 2 has Study keep that phase's End at the day before the exam.
//     One of the two gives; the request does not say what a hand edit of a
//     following phase's dates does
//   - study-plan-acceptance has fixed dates in 2027 and expects every day to
//     follow a rule (its phase 3). From 2027-01-05 on some of those days are
//     past, and point 1 keeps them
//
// What each phase needs, and what only the owner's machine can show. All
// phases need the built app (npm run build) and nothing else: no model, no
// graphics card, no network. Not shown here, for his machine:
//   - Windows: the app's zone is the machine's there (PARALLX_PROBE_TZ is not
//     applied), so run it once as it is: node tests/probes/study-walk-acceptance.mjs
//   - a real idle hour on the real clock, the lid closed, the window
//     minimised or behind another program (phase 6 moves the page's clock and
//     switches tabs inside the app)
//   - a pen or a real touch screen (the finger here is Chromium's own touch
//     events), and what a screen reader says
//   - real PDFs with long names from his folders, and his own model's grading
//
// Not checked here: the look beyond contrast of the new lines (the visual
// bar's probe); the full keyboard and touch audits (their own probes: this one
// walks the new controls only); a setup sheet with a text field (a material's
// page range) and its multi-line fields; a file that matches two bank units;
// Find Matches from the command palette; a Follows phase edited by hand;
// several subjects; Study turned off (the plan and unit probes hold that);
// that no core code names Study (the modularity reviewer reads that); the
// pieces before (their own probes must keep passing).
import { _electron as electron } from 'playwright';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.resolve(process.argv[2] ?? path.join(REPO, 'test-results', 'study-walk-acceptance'));
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
const sha = (file) => (existsSync(file) ? createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 16) : null);

// ── The checks ────────────────────────────────────────────────────────────────
const results = []; // { id, label, ok }
function record(id, label, ok, got) {
  const detail = got === undefined ? '' : ` :: ${String(typeof got === 'string' ? got : JSON.stringify(got)).replace(/\s+/g, ' ').slice(0, 560)}`;
  console.log(`${ok ? '  ok ' : ' FAIL'} ${id} ${label}${ok && !detail ? '' : detail}`);
  results.push({ id, label, ok: !!ok });
}

async function newRoot(name, from, workspace = path.join(OUT, 'runs', name, 'workspace')) {
  const dir = path.join(OUT, 'runs', name);
  await fs.rm(dir, { recursive: true, force: true });
  await fs.rm(workspace, { recursive: true, force: true });
  await fs.mkdir(path.join(dir, 'app', 'data'), { recursive: true });
  if (from) await fs.cp(from, workspace, { recursive: true }); else await fs.mkdir(workspace, { recursive: true });
  await fs.mkdir(path.join(workspace, '.parallx'), { recursive: true });
  await fs.writeFile(path.join(workspace, '.parallx', 'ai-config.json'), JSON.stringify({ overrides: { indexing: { autoIndex: false, watchFiles: false }, suggestions: { suggestionsEnabled: false }, heartbeat: { enabled: false } } }));
  return { dir, workspace };
}

// ── The workspace's database files, read as the app left them ───────────────
function fileAll(file, sql, params = []) {
  if (!existsSync(file)) return [];
  const d = new DatabaseSync(file, { readOnly: true });
  try { return d.prepare(sql).all(...params); } finally { d.close(); }
}
const coreFile = (ws) => path.join(ws, '.parallx', 'data.db');
const coreAll = (ws, sql, params = []) => fileAll(coreFile(ws), sql, params);
const parse = (s) => { try { return JSON.parse(s); } catch { return s; } };
const pagesTitled = (ws, title) => coreAll(ws, 'SELECT id, title, parent_id, is_archived FROM pages WHERE title = ? AND id NOT IN (SELECT id FROM databases)', [title]);
const pageRow = (ws, id) => coreAll(ws, 'SELECT * FROM pages WHERE id = ?', [id])[0] || null;
const databases = (ws, parentId = undefined) => coreAll(ws, `SELECT d.id, p.title, p.parent_id FROM databases d JOIN pages p ON p.id = d.id WHERE p.is_archived = 0 ${parentId === undefined ? '' : 'AND p.parent_id = ?'} ORDER BY p.sort_order`, parentId === undefined ? [] : [parentId]);
const columns = (ws, dbId) => coreAll(ws, 'SELECT id, name, type, config, sort_order FROM database_properties WHERE database_id = ? ORDER BY sort_order', [dbId]).map((p) => ({ ...p, config: parse(p.config) }));
function rowsOf(ws, dbId) {
  const cols = columns(ws, dbId);
  const rows = coreAll(ws, 'SELECT p.id AS pageId, p.title, dp.sort_order AS sort FROM database_pages dp JOIN pages p ON p.id = dp.page_id WHERE dp.database_id = ? AND p.is_archived = 0 ORDER BY dp.sort_order, p.id', [dbId]);
  const by = new Map(rows.map((r) => [r.pageId, { ...r, values: {}, raw: {} }]));
  for (const v of coreAll(ws, 'SELECT page_id, property_id, value FROM page_property_values WHERE database_id = ?', [dbId])) {
    const r = by.get(v.page_id); const c = cols.find((x) => x.id === v.property_id);
    if (r && c) { r.values[c.name] = parse(v.value); r.raw[c.name] = v.value; }
  }
  return [...by.values()];
}
const rowTitled = (ws, dbId, title) => rowsOf(ws, dbId).find((r) => norm(r.title) === norm(title)) || null;
const col = (cols, ...names) => cols.find((c) => names.some((n) => low(c.name) === n.toLowerCase())) || null;
/** Every column of Units named Material (one, or one per kind if the builder split it). */
const materialCols = (ws, unitsDb) => columns(ws, unitsDb).filter((c) => /^material\b/i.test(norm(c.name)));
/** What a unit's Material holds in the file, as one string, for "does it name this item". */
function materialOf(ws, unitsDb, unit) {
  const r = rowTitled(ws, unitsDb, unit);
  if (!r) return '';
  return materialCols(ws, unitsDb).map((c) => String(r.raw[c.name] ?? '')).join(' | ');
}
/** The keys an item can be held by: a page's id, a file's paths and name. */
function keysOf(ws, item) {
  if (item.pageId) return [item.pageId];
  const abs = path.join(ws, item.file);
  const rel = item.file.split(path.sep).join('/');
  return [abs, abs.split(path.sep).join('/'), `file://${abs.split(path.sep).join('/')}`, encodeURI(`file://${abs.split(path.sep).join('/')}`), rel, path.basename(item.file)];
}
const holds = (text, keys) => keys.some((k) => String(text).includes(k) || String(text).includes(JSON.stringify(k).slice(1, -1)));

function pdfBytes(text) {
  const s = `BT /F1 18 Tf 72 700 Td (${text}) Tj ET`;
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>', `<< /Length ${s.length} >>\nstream\n${s}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let out = '%PDF-1.4\n'; const off = [];
  objs.forEach((o, i) => { off.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${off.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return out;
}
// <model>
function installProbeModel() {
  const svc = window.__parallx_workbench__?._services?.get?.({ id: 'ILanguageModelsService' });
  if (!svc?.registerProvider) return 'no models service';
  const long = (s) => String(s).toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 4);
  const info = { id: 'probe-model', displayName: 'Probe Model', family: 'probe', parameterSize: '1B', quantization: 'none', contextLength: 32768, capabilities: ['completion'] };
  function answerFor(kind, user) {
    if (kind === 'grade') {
      const [before, after = ''] = user.split(/Student's answer:/i);
      const answer = after.toLowerCase();
      const block = (before.split(/Points to mark[^\n]*:/i)[1] || '');
      let pts = block.split('\n').map((l) => l.trim()).filter((l) => /^\d+\.\s/.test(l)).map((l) => l.replace(/^\d+\.\s*/, '').replace(/\s*\(supporting detail\)$/, ''));
      if (!pts.length) pts = [long(answer).filter((w) => before.toLowerCase().includes(w)).length >= Math.max(1, Math.ceil(long(answer).length * 0.6)) && long(answer).length ? answer : '\u0000missing'];
      const points = pts.map((p) => { const ws = long(p); const hit = ws.filter((w) => answer.includes(w)).length; return { status: ws.length && hit / ws.length >= 0.6 ? 'hit' : hit > 0 ? 'partial' : 'miss', note: '' }; });
      return JSON.stringify({ points, contradiction: false, note: points.every((p) => p.status === 'hit') ? '' : 'The answer leaves out what the reference says.' });
    }
    if (kind === 'rubric') { const ref = (user.split(/answer:\n/i)[1] || user).split('\n')[0]; return JSON.stringify({ rubric: [{ text: ref, required: true }], contradictions: [] }); }
    if (kind === 'explain') return 'The reference says this in so many words.';
    return 'Understood.';
  }
  svc.registerProvider({
    id: 'probe', displayName: 'Probe', local: true,
    async listModels() { return [info]; }, async checkAvailability() { return { available: true }; }, async getModelInfo() { return info; },
    async *sendChatRequest(modelId, messages, options, signal) {
      const text = (m) => (typeof m?.content === 'string' ? m.content : JSON.stringify(m?.content ?? ''));
      const system = messages.filter((m) => m.role === 'system').map(text).join('\n');
      const user = messages.filter((m) => m.role !== 'system').map(text).join('\n');
      const kind = /"points"\s*:/.test(system) && /contradiction/.test(system) ? 'grade' : /"rubric"\s*:/.test(system) ? 'rubric' : /^You explain/.test(system) ? 'explain' : 'other';
      const out = answerFor(kind, user);
      for (let i = 0; i < out.length; i += 200) { if (signal?.aborted) return; yield { content: out.slice(i, i + 200), done: false }; }
      yield { content: '', done: true };
    },
  });
  svc.setActiveModel?.('probe-model');
  return 'ok';
}
// </model>

// <page>
// What the probe reads off the page: controls by the name a person reads or a
// screen reader speaks, the unit tab's groups and items, the dialog in front,
// the canvas table, the active editor, focus and contrast.
function installPageHelpers() {
  const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  // Study's screens became places in its one tab (editor type study-place, c3eebb8f): the tab is named for the
  // place ("Progress", "Mack") and the trail under the tabs reads Study › Exam 7 › Progress. A place tab is named
  // here by the screen it shows, read from the place (its address and its trail), as its own tab was named
  // before: "Exam 7 Progress", "Exam 7 · Mack", the plan's name, "Study" for Home. Any other tab keeps its label.
  const studyPlaceName = (id, label) => {
    if (!/:study-place:/.test(id)) return label;
    const groups = window.__parallx_workbench__?._services.get({ id: 'IEditorGroupService' })?.groups || [];
    const e = groups.flatMap((g) => g.model?.editors || []).find((x) => x.id === id);
    const m = /^parallx:\/\/place\/study\/([^?#/]+)/.exec(String(e?.place || ''));
    if (!m) return label;
    const trail = (e.trail || []).map((c) => norm(c.label));
    const subject = trail.length >= 3 ? trail[trail.length - 2] : '';
    const here = trail[trail.length - 1] || label;
    if (m[1] === 'progress' && subject) return `${subject} Progress`;
    if (m[1] === 'unit' && subject) return `${subject} · ${here}`;
    if (m[1] === 'home') return 'Study';
    return label;
  };
  /** The address of a Study place tab (parallx://place/study/…), '' for any other tab. */
  const studyPlaceAddress = (id) => {
    if (!/:study-place:/.test(id)) return '';
    const groups = window.__parallx_workbench__?._services.get({ id: 'IEditorGroupService' })?.groups || [];
    return String(groups.flatMap((g) => g.model?.editors || []).find((x) => x.id === id)?.place || '');
  };
  const shown = (n) => !!n && n.getClientRects().length > 0 && n.getBoundingClientRect().width > 0 && getComputedStyle(n).visibility !== 'hidden';
  const CLICKABLE = 'button, [role="button"], [role="menuitem"], [role="menuitemradio"], [role="option"], [role="radio"], [role="tab"], [role="treeitem"], [role="checkbox"], [role="switch"], [role="link"], a[href], summary, input[type="checkbox"], input[type="radio"]';
  const FIELDS = 'input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"]), textarea, select, [role="combobox"], [role="radiogroup"], [role="listbox"], [role="group"], button[aria-haspopup]';
  const CHECKABLE = 'input[type="checkbox"], [role="checkbox"], [role="option"], [role="menuitemcheckbox"]';
  const form = () => { const all = Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"], .parallx-modal-box, .st-sheet')).filter(shown); return all.length ? all[all.length - 1] : null; };
  const scopeEl = (scope) => {
    if (scope === 'sidebar') return document.querySelector('[data-part-id="workbench.parts.sidebar"]');
    if (scope === 'editor') return document.querySelector('[data-part-id="workbench.parts.editor"]');
    if (scope === 'pane') return Array.from(document.querySelectorAll('.editor-group--active .editor-pane-container, .editor-pane-container')).find(shown) || document.querySelector('[data-part-id="workbench.parts.editor"]');
    if (scope === 'root') { const roots = Array.from(document.querySelectorAll('.st-root')).filter(shown); return roots.find((r) => r.closest('.editor-group--active')) || roots[0] || null; }
    if (scope === 'form') return form();
    if (scope === 'body') return document.body;
    return Array.from(document.querySelectorAll(scope)).find(shown) || null;
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
  /** The name a screen reader speaks, near enough: aria-label, aria-labelledby, a label, the words, the title. */
  const accName = (n) => {
    const own = norm(n.getAttribute('aria-label'));
    if (own) return own;
    const by = n.getAttribute('aria-labelledby');
    if (by) { const t = norm(by.split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ')); if (t) return t; }
    if (n.matches('input, select, textarea')) return labelsOf(n)[0] || '';
    return norm(n.textContent) || norm(n.getAttribute('title')) || norm(n.getAttribute('data-parallx-title'));
  };
  /** The names a person can find a control by: its spoken name, its words, its tooltip. */
  const namesOf = (n) => [accName(n), norm(n.textContent), norm(n.getAttribute('title')), norm(n.getAttribute('data-parallx-title'))].filter(Boolean);
  const point = (n) => {
    let r = n.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) { n.scrollIntoView({ block: 'nearest', inline: 'nearest' }); r = n.getBoundingClientRect(); }
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, left: r.left, right: r.right, top: r.top, bottom: r.bottom };
  };
  const isOn = (n) => {
    if (n.tagName === 'INPUT') return n.checked;
    const a = n.getAttribute('aria-checked') ?? n.getAttribute('aria-selected') ?? n.getAttribute('aria-pressed');
    if (a !== null) return a === 'true';
    const inner = n.querySelector('input[type="checkbox"]');
    return inner ? inner.checked : false;
  };
  const fieldValue = (n) => {
    if (n.tagName === 'SELECT') return norm(n.selectedOptions[0]?.textContent);
    if (n.tagName === 'INPUT' || n.tagName === 'TEXTAREA') return n.value;
    return norm(n.textContent);
  };
  const before = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
  const headingsIn = (s, names) => {
    const re = new RegExp(`^(${names.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'i');
    return Array.from(s.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]')).filter((h) => shown(h) && re.test(norm(h.innerText)) && !Array.from(h.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]')).some((x) => x !== h && re.test(norm(x.innerText))))
      .map((h) => ({ h, name: re.exec(norm(h.innerText))[1] }));
  };
  /** The unit tab's groups: each heading of a known group and what follows it up to the next. */
  const groups = (names) => {
    const s = scopeEl('pane');
    if (!s) return [];
    const heads = headingsIn(s, names);
    const sectionOf = (n) => { let k = -1; heads.forEach((g, i) => { if (g.h === n || g.h.contains(n) || before(g.h, n)) k = i; }); return k; };
    const out = heads.map(({ h, name }) => {
      const words = norm(h.innerText);
      const m = /(\d[\d,]*)/.exec(words.slice(name.length));
      return { name, heading: words, count: m ? Number(m[1].replace(/,/g, '')) : null, lines: [], controls: [], y: h.getBoundingClientRect().y };
    });
    const walker = document.createTreeWalker(s, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      const p = t.parentElement; const w = norm(t.textContent);
      if (!w || !p || !shown(p)) continue;
      const k = sectionOf(p); if (k >= 0) out[k].lines.push(w);
    }
    for (const n of s.querySelectorAll(CLICKABLE)) {
      if (!shown(n)) continue;
      const k = sectionOf(n); if (k < 0) continue;
      const r = n.getBoundingClientRect();
      out[k].controls.push({ name: accName(n), x: r.x + r.width / 2, y: r.y + r.height / 2, disabled: !!n.disabled || n.getAttribute('aria-disabled') === 'true' });
    }
    return out.map((g) => ({ ...g, text: g.lines.join(' ') }));
  };
  /** The items in the tab: "Open <title>" with its "Remove <title> from <Unit>", the row that holds both, and its group. */
  const items = (names) => {
    const s = scopeEl('pane');
    if (!s) return [];
    const heads = headingsIn(s, names);
    const ctl = Array.from(s.querySelectorAll(CLICKABLE)).filter(shown);
    const out = [];
    for (const n of ctl) {
      const m = /^Open (.+)$/.exec(accName(n));
      if (!m) continue;
      const title = m[1];
      if (/^(questions|units|work log|progress)$/i.test(title)) continue;
      let row = n.parentElement; let rm = null;
      for (; row && s.contains(row); row = row.parentElement) {
        rm = Array.from(row.querySelectorAll(CLICKABLE)).find((x) => x !== n && shown(x) && accName(x).startsWith(`Remove ${title} from `));
        if (rm) break;
      }
      let k = -1; heads.forEach((g, i) => { if (before(g.h, n)) k = i; });
      const r = n.getBoundingClientRect();
      const rr = rm ? rm.getBoundingClientRect() : null;
      out.push({ title, group: k >= 0 ? heads[k].name : '', row: row && rm ? norm(row.innerText) : '', open: { x: r.x + r.width / 2, y: r.y + r.height / 2, left: r.left, right: r.right }, remove: rr ? { x: rr.x + rr.width / 2, y: rr.y + rr.height / 2, name: accName(rm) } : null, tag: n.tagName, role: n.getAttribute('role') || '' });
    }
    return out;
  };
  /** The choices of the dialog in front: each checkbox with the words of its row. */
  const choices = () => {
    const f = form();
    if (!f) return [];
    const boxes = Array.from(f.querySelectorAll(CHECKABLE)).filter((b) => shown(b) || (b.tagName === 'INPUT' && shown(b.parentElement)));
    return boxes.map((b, i) => {
      let row = b;
      while (row.parentElement && row.parentElement !== f && Array.from(row.parentElement.querySelectorAll(CHECKABLE)).length <= 1) row = row.parentElement;
      const linesOf = (n) => { const out = []; const w = document.createTreeWalker(n, NodeFilter.SHOW_TEXT); for (let t = w.nextNode(); t; t = w.nextNode()) { const x = norm(t.textContent); if (x) out.push(x); } return out; };
      const lines = [...linesOf(row), ...labelsOf(b)];
      b.setAttribute('data-probe-choice', String(i));
      const target = shown(b) ? b : b.parentElement;
      const pt = point(target);
      return { i, probeChoice: i, lines, text: norm(row.innerText || lines.join(' ')), on: isOn(b), x: pt.x, y: pt.y };
    });
  };
  window.__ap = {
    shown, scopeEl, accName, groups, items, choices,
    has: (scope, sel) => { const s = scopeEl(scope); return !!s && Array.from(s.querySelectorAll(sel)).some(shown); },
    text: (scope) => { const s = scopeEl(scope); return s ? String(s.innerText || '') : ''; },
    find(scope, source, flags, sel) {
      const s = scopeEl(scope);
      if (!s) return [];
      const re = new RegExp(source, flags);
      const out = [];
      for (const n of s.querySelectorAll(sel || CLICKABLE)) {
        if (!shown(n)) continue;
        const name = namesOf(n).find((x) => re.test(x));
        if (name === undefined) continue;
        out.push({ ...point(n), name, disabled: !!n.disabled || n.getAttribute('aria-disabled') === 'true', pressed: n.getAttribute('aria-pressed') ?? n.getAttribute('aria-checked') ?? n.getAttribute('aria-selected'), tag: n.tagName });
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
    /** Every field of the dialog in front, by its labels. */
    fieldLabels() { const f = form(); return f ? Array.from(f.querySelectorAll(FIELDS)).filter(shown).map((n) => labelsOf(n).join(' / ')) : []; },
    /** The text field of the dialog in front (the picker's search). */
    searchField() {
      const f = form();
      const n = f && Array.from(f.querySelectorAll('input[type="search"], input[type="text"], input:not([type]), [role="searchbox"], [role="combobox"]')).find(shown);
      return n ? { ...point(n), value: n.value } : null;
    },
    formOpen: () => !!form(),
    formText: () => { const f = form(); return f ? String(f.innerText || '') : ''; },
    inForm: () => { const f = form(); return !!f && f.contains(document.activeElement); },
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
    card() {
      const r = scopeEl('root');
      const c = r && Array.from(r.querySelectorAll('.st-card')).find(shown);
      if (!c) return null;
      const fb = Array.from(r.querySelectorAll('.st-fb')).find((f) => f.classList.contains('st-fb--show') && shown(f)) || null;
      const field = Array.from(c.querySelectorAll('textarea, input[type="text"], input:not([type])')).find(shown) || null;
      return { stem: norm(c.querySelector('.st-card__q')?.innerText), options: Array.from(c.querySelectorAll('.st-opt')).filter(shown).length, field: field ? { ...point(field), value: field.value } : null, verdict: fb ? norm(fb.innerText).slice(0, 80) : '' };
    },
    results: () => { const r = scopeEl('root'); return !!r && Array.from(r.querySelectorAll('.st-res')).some(shown); },
    tabs: () => Array.from(document.querySelectorAll('.ui-tab')).map((t) => { const l = t.querySelector('.ui-tab-label') || t; return { id: t.getAttribute('data-tab-id') || '', probeTab: t.getAttribute('data-tab-id') || '', active: t.classList.contains('ui-tab--active'), label: studyPlaceName(t.getAttribute('data-tab-id') || '', norm(t.querySelector('.ui-tab-label')?.textContent)), place: studyPlaceAddress(t.getAttribute('data-tab-id') || ''), ...point(l) }; }),
    /** A tab's or a choice's point read again just before the press: reading the others may have scrolled the strip or the list since. */
    relocate(pt) {
      let n = null;
      if (pt.probeTab !== undefined) { const t = Array.from(document.querySelectorAll('.ui-tab')).find((x) => x.getAttribute('data-tab-id') === pt.probeTab); n = t && (t.querySelector('.ui-tab-label') || t); }
      else if (pt.probeChoice !== undefined) { const b = document.querySelector(`[data-probe-choice="${pt.probeChoice}"]`); n = b && (shown(b) ? b : b.parentElement); }
      if (!n) return null;
      n.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      const r = n.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    },
    cell(dbId, rowTitle, column) {
      const surfaces = Array.from(document.querySelectorAll('[data-px-surface="database"]')).filter(shown);
      const sf = dbId ? surfaces.find((e) => (e.getAttribute('data-px-instance') || '').endsWith(dbId)) : surfaces[0];
      if (!sf) return null;
      const heads = Array.from(sf.querySelectorAll('.canvas-db-th__name')).map((h) => norm(h.textContent));
      const i = heads.findIndex((h) => h.toLowerCase() === String(column).toLowerCase());
      const tr = Array.from(sf.querySelectorAll('tr.canvas-db-row')).find((r) => norm(r.querySelector('.canvas-db-cell__titletext')?.textContent) === norm(rowTitle));
      if (i < 0 || !tr) return { heads, found: false };
      const td = tr.querySelectorAll('td[role="gridcell"]')[i];
      if (!td) return { heads, found: false };
      const says = [td, ...td.querySelectorAll('*')].flatMap((n) => [n.getAttribute('title'), n.getAttribute('aria-label')]).concat(td.innerText).map(norm).filter(Boolean).join(' | ');
      return { ...point(td), heads, found: true, text: norm(td.innerText), editable: td.dataset.editable === 'true', says };
    },
    active() {
      const es = window.__parallx_workbench__._services.get({ id: 'IEditorService' });
      const e = es.activeEditor;
      if (!e) return null;
      const u = e.uri ?? e._uri;
      return { typeId: String(e.typeId || ''), id: String(e.id || ''), name: String(e.name || ''), file: String(u?.fsPath ?? u?.path ?? '') };
    },
    focused() {
      const colour = (s) => { const m = /rgba?\(([^)]+)\)/.exec(String(s || '')); if (!m) return null; const p = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat); return { a: p.length > 3 ? p[3] : 1 }; };
      const drawn = (cs) => {
        const line = colour(cs.outlineColor);
        if (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0 && line && line.a > 0) return true;
        return String(cs.boxShadow || 'none').split(/,(?![^(]*\))/).some((part) => { const k = colour(part); const sizes = (part.replace(/rgba?\([^)]*\)/g, '').match(/-?[\d.]+px/g) || []).map(parseFloat); return !!k && k.a > 0 && sizes.some((v) => v !== 0); });
      };
      const a = document.activeElement;
      if (!a || a === document.body) return null;
      const f = form();
      return { name: accName(a), tag: a.tagName, inPane: !!scopeEl('pane')?.contains(a), inForm: !!f && f.contains(a), hasRing: drawn(getComputedStyle(a)), keyboard: a.matches(':focus-visible') };
    },
    /** Every visible piece of text in `scope` below 4.5:1 (3:1 when large) against what it sits on. */
    contrast(scope) {
      const s = scopeEl(scope);
      if (!s) return null;
      const colour = (str) => { const m = /rgba?\(([^)]+)\)/.exec(String(str || '')); if (m) { const p = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; } const k = /color\(srgb\s+([^)]+)\)/.exec(String(str || '')); if (k) { const p = k[1].split(/[\s/]+/).filter(Boolean).map(parseFloat); return { r: p[0] * 255, g: p[1] * 255, b: p[2] * 255, a: p.length > 3 ? p[3] : 1 }; } return null; };
      const ground = (e) => { const layers = []; for (let p = e; p; p = p.parentElement) { const c = colour(getComputedStyle(p).backgroundColor); if (c && c.a > 0) { layers.push(c); if (c.a >= 0.999) break; } } let base = { r: 255, g: 255, b: 255 }; for (const c of layers.reverse()) base = { r: c.r * c.a + base.r * (1 - c.a), g: c.g * c.a + base.g * (1 - c.a), b: c.b * c.a + base.b * (1 - c.a) }; return base; };
      const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
      const ratio = (a, b) => { const A = lum(a), B = lum(b); return (Math.max(A, B) + 0.05) / (Math.min(A, B) + 0.05); };
      const bad = []; let n = 0;
      const walker = document.createTreeWalker(s, NodeFilter.SHOW_TEXT);
      const seen = new Set();
      for (let t = walker.nextNode(); t; t = walker.nextNode()) {
        const p = t.parentElement;
        if (!norm(t.textContent) || !p || seen.has(p) || !shown(p)) continue;
        seen.add(p);
        const cs = getComputedStyle(p);
        if (parseFloat(cs.opacity) === 0) continue;
        const fg = colour(cs.color); if (!fg) continue;
        const bg = ground(p);
        const over = { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a) };
        const size = parseFloat(cs.fontSize); const bold = Number(cs.fontWeight) >= 700;
        const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
        const r = ratio(over, bg); n++;
        const disabled = !!p.closest('[disabled], [aria-disabled="true"]');
        if (r < need && !disabled) bad.push(`"${norm(t.textContent).slice(0, 30)}" ${r.toFixed(2)}:1`);
      }
      return { pieces: n, bad };
    },
    /** Does the pane scroll sideways, and is every item inside it? */
    fits() {
      const s = scopeEl('pane'); if (!s) return null;
      const sr = s.getBoundingClientRect();
      const wide = Array.from(s.querySelectorAll('*')).filter((n) => shown(n) && n.scrollWidth > n.clientWidth + 1 && /(auto|scroll)/.test(getComputedStyle(n).overflowX)).map((n) => `${n.className || n.tagName} ${n.scrollWidth}>${n.clientWidth}`);
      return { paneWidth: Math.round(sr.width), scrollsSideways: wide.slice(0, 4), left: sr.left, right: sr.right };
    },
  };
  return true;
}
// </page>
// <plan>
// What the probe reads off the plan's tab: the day table, a part of the tab by
// its name, the smallest block that holds some words, how a day's row looks.
function installPlanHelpers() {
  const { shown, scopeEl } = window.__ap;
  const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  const CLICKABLE = 'button, [role="button"], [role="menuitem"], [role="menuitemradio"], [role="option"], [role="radio"], [role="tab"], [role="treeitem"], [role="checkbox"], [role="switch"], a[href], summary, input[type="checkbox"], input[type="radio"]';
  const spokenName = (n) => {
    const own = norm(n.getAttribute('aria-label'));
    if (own) return own;
    const by = n.getAttribute('aria-labelledby');
    return by ? norm(by.split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ')) : '';
  };
  const namesOf = (n) => {
    const words = norm(n.textContent);
    return (words ? [n.getAttribute('aria-label'), words] : [n.getAttribute('aria-label'), n.getAttribute('title'), n.getAttribute('data-parallx-title')]).map(norm).filter(Boolean);
  };
  const point = (n) => {
    let r = n.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) { n.scrollIntoView({ block: 'center', inline: 'center' }); r = n.getBoundingClientRect(); }
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  };
  const colour = (s) => {
    const str = String(s || '');
    let m = /rgba?\(([^)]+)\)/.exec(str);
    if (m) { const p = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; }
    m = /color\(srgb\s+([^)]+)\)/.exec(str);
    if (m) { const p = m[1].split(/[\s/]+/).filter(Boolean).map(parseFloat); return { r: p[0] * 255, g: p[1] * 255, b: p[2] * 255, a: p.length > 3 ? p[3] : 1 }; }
    return null;
  };
  const ground = (e) => {
    const layers = [];
    for (let p = e; p; p = p.parentElement) { const c = colour(getComputedStyle(p).backgroundColor); if (c && c.a > 0) { layers.push(c); if (c.a >= 0.999) break; } }
    let base = { r: 255, g: 255, b: 255, a: 1 };
    for (const c of layers.reverse()) base = { r: c.r * c.a + base.r * (1 - c.a), g: c.g * c.a + base.g * (1 - c.a), b: c.b * c.a + base.b * (1 - c.a), a: 1 };
    return base;
  };
  const over = (c, base) => (c ? { r: c.r * c.a + base.r * (1 - c.a), g: c.g * c.a + base.g * (1 - c.a), b: c.b * c.a + base.b * (1 - c.a) } : null);
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
    editorOpen: () => { const a = document.activeElement; return !!a && !!a.closest('[data-px-surface="database"]') && (a.matches('input, textarea, [contenteditable="true"]')); },
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
// <walk>
// What this piece's checks read off the page beyond the helpers above: the
// lines a person reads in a part of the screen, and how each reads against
// what it sits on.
function installWalkHelpers() {
  const { shown, scopeEl } = window.__ap;
  const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  const colour = (str) => { const m = /rgba?\(([^)]+)\)/.exec(String(str || '')); if (m) { const p = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; } const k = /color\(srgb\s+([^)]+)\)/.exec(String(str || '')); if (k) { const p = k[1].split(/[\s/]+/).filter(Boolean).map(parseFloat); return { r: p[0] * 255, g: p[1] * 255, b: p[2] * 255, a: p.length > 3 ? p[3] : 1 }; } return null; };
  const ground = (e) => { const layers = []; for (let p = e; p; p = p.parentElement) { const c = colour(getComputedStyle(p).backgroundColor); if (c && c.a > 0) { layers.push(c); if (c.a >= 0.999) break; } } let base = { r: 255, g: 255, b: 255 }; for (const c of layers.reverse()) base = { r: c.r * c.a + base.r * (1 - c.a), g: c.g * c.a + base.g * (1 - c.a), b: c.b * c.a + base.b * (1 - c.a) }; return base; };
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (a, b) => { const A = lum(a), B = lum(b); return (Math.max(A, B) + 0.05) / (Math.min(A, B) + 0.05); };
  const BLOCK = /^(block|flex|grid|list-item|table|table-row|table-cell|table-caption|flow-root)$/;
  /** The element a piece of text is a line of: its nearest ancestor that is laid out as a block. */
  const lineEl = (n) => { let e = n; while (e && e.parentElement && !BLOCK.test(getComputedStyle(e).display)) e = e.parentElement; return e; };
  window.__wk = {
    /**
     * The lines of words in `scope` that are not controls: each block of text
     * as a person reads it, with its contrast against what it sits on. A line
     * is the words of one block-level element that holds no other block.
     */
    lines(scope, part) {
      let s = scopeEl(scope);
      if (s && part) {
        // A part of the tab by its name (aria-label, aria-labelledby), else what its heading starts.
        const re = new RegExp(part, 'i');
        const name = (n) => norm(n.getAttribute('aria-label')) || norm((n.getAttribute('aria-labelledby') || '').split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' '));
        const named = Array.from(s.querySelectorAll('[aria-label], [aria-labelledby]')).find((n) => shown(n) && !n.matches('button, [role="button"], input, select, textarea, a[href]') && re.test(name(n)));
        const h = named ? null : Array.from(s.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"], legend')).find((n) => shown(n) && re.test(norm(n.innerText)));
        s = named || (h ? h.parentElement : null);
      }
      if (!s) return null;
      const seen = new Set(); const out = [];
      const walker = document.createTreeWalker(s, NodeFilter.SHOW_TEXT);
      for (let t = walker.nextNode(); t; t = walker.nextNode()) {
        const p = t.parentElement;
        if (!norm(t.textContent) || !p || !shown(p)) continue;
        if (p.closest('button, [role="button"], [role="menuitem"], [role="option"], [role="radio"], [role="tab"], a[href], input, select, textarea, th, td, caption, [aria-hidden="true"]')) continue;
        const e = lineEl(p);
        if (!e || seen.has(e)) continue;
        seen.add(e);
        const text = norm(e.innerText);
        if (!text) continue;
        const cs = getComputedStyle(p); const fg = colour(cs.color); const bg = ground(p);
        const over = fg ? { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a) } : null;
        out.push({ text, contrast: over ? Math.round(ratio(over, bg) * 100) / 100 : null, y: Math.round(e.getBoundingClientRect().y), transform: cs.textTransform });
      }
      return out;
    },
    /** Lines hidden from sight only (aria-hidden counts as shown to the eye): the same, without leaving those out. */
    seenLines(scope) {
      const s = scopeEl(scope);
      if (!s) return null;
      return String(s.innerText || '').split('\n').map(norm).filter(Boolean);
    },
    /**
     * Words like `source` that are really on screen in the editor area: the
     * smallest element that reads so and is what a press at its middle would hit
     * (a pane behind the one in front, or one drawn at no size, does not count).
     */
    seenText(source) {
      const ed = scopeEl('editor');
      if (!ed) return '';
      const re = new RegExp(source, 'i');
      const says = (n) => re.test(norm(n.innerText));
      for (const n of ed.querySelectorAll('*')) {
        if (!shown(n) || !says(n) || Array.from(n.children).some((k) => shown(k) && says(k))) continue;
        const r = n.getBoundingClientRect();
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        if (hit && (n.contains(hit) || hit.contains(n))) return norm(n.innerText);
      }
      return '';
    },
    /** The control that has the focus: its tag, type, name and whether it sits in the sheet or dialog in front. */
    focusIs() {
      const a = document.activeElement;
      if (!a || a === document.body) return null;
      const f = Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"], .parallx-modal-box, .st-sheet')).filter(shown).pop();
      return { tag: a.tagName, type: a.getAttribute('type') || '', role: a.getAttribute('role') || '', name: window.__ap.accName(a), inForm: !!f && f.contains(a), isForm: a === f };
    },
  };
  return true;
}
// </walk>

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
  await page.evaluate(installWalkHelpers);
  const r = await page.evaluate(installProbeModel);
  if (r !== 'ok') throw new Error(`scripted model not registered: ${r}`);
  return { app, page };
}

/** The handle a phase works through. */
function makeSession({ dir, workspace }) {
  const S = {
    dir, workspace, app: null, page: null,
    async open() {
      const a = await launch(dir, workspace); S.app = a.app; S.page = a.page;
      // Seen in the earlier probes: the New Subject sheet's tab can come back with the app. It is cancelled and said.
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
    /** Start a command and do not wait for it: one that opens a dialog only returns when the dialog goes. */
    run: (id, ...args) => { void S.page.evaluate(({ id, args }) => { void window.__parallx_workbench__._services.get({ id: 'ICommandService' }).executeCommand(id, ...args).catch(() => {}); }, { id, args }).catch(() => {}); },
    /** One of the chat's own tools, run as the chat runs it. */
    tool: (name, args) => S.page.evaluate(async ({ name, args }) => {
      const t = window.__parallx_workbench__._services.get({ id: 'ILanguageModelToolsService' }).getTool(name);
      if (!t) return `no tool ${name}`;
      try { const r = await t.handler(args, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) }); return String((r && r.content) || ''); } catch (e) { return `threw: ${e && e.message}`; }
    }, { name, args }),
    shot: async (name) => { try { const f = path.join(OUT, 'shots', `${String(++shotN).padStart(2, '0')}-${name}.png`); await S.page.screenshot({ path: f }); return f; } catch { return ''; } },
    text: (scope = 'pane') => S.page.evaluate((scope) => window.__ap.text(scope), scope),
    paneWords: async () => norm(await S.text('pane')),
    has: (scope, sel) => S.page.evaluate(({ scope, sel }) => window.__ap.has(scope, sel), { scope, sel }),
    card: () => S.page.evaluate(() => window.__ap.card()),
    // A unit's place tab whose name does not say the unit: one Study no longer finds (its row in the Trash) is named
    // "Unit" by its place, and one brought back by a restart has no trail until it is shown (c3eebb8f). The screen is
    // still that row's unit, whose address carries the row: it is named "<Subject> · <row's title>" from the workspace
    // file (the subject is the page that holds the row's database), as its own tab kept the name before.
    tabs: async () => (await S.page.evaluate(() => window.__ap.tabs())).map((t) => {
      const m = /^parallx:\/\/place\/study\/unit\?(.*)$/.exec(t.place || '');
      const row = m ? new URLSearchParams(m[1]).get('unit') : null;
      const placeholder = / · Unit$/.test(t.label);
      if (!row || (/ · /.test(t.label) && !placeholder)) return t;
      const r = coreAll(S.workspace, 'SELECT p.title, sp.title AS subject FROM pages p LEFT JOIN database_pages dp ON dp.page_id = p.id LEFT JOIN pages dbp ON dbp.id = dp.database_id LEFT JOIN pages sp ON sp.id = dbp.parent_id WHERE p.id = ?', [row])[0];
      const subject = placeholder ? t.label.slice(0, -' · Unit'.length) : r?.subject;
      return r && r.title && subject ? { ...t, label: `${norm(subject)} · ${norm(r.title)}` } : t;
    }),
    active: () => S.page.evaluate(() => window.__ap.active()),
    groups: () => S.page.evaluate((names) => window.__ap.groups(names), GROUP_NAMES),
    items: () => S.page.evaluate((names) => window.__ap.items(names), GROUP_NAMES),
    choices: () => S.page.evaluate(() => window.__ap.choices()),
    focused: () => S.page.evaluate(() => window.__ap.focused()),
    focusIs: () => S.page.evaluate(() => window.__wk.focusIs()),
    seenText: (re) => S.page.evaluate((source) => window.__wk.seenText(source), re.source),
    lines: (scope, part = '') => S.page.evaluate(({ scope, part }) => window.__wk.lines(scope, part), { scope, part }),
    seenLines: (scope) => S.page.evaluate((scope) => window.__wk.seenLines(scope), scope),
    find: (scope, re, sel) => S.page.evaluate(({ scope, source, flags, sel }) => window.__ap.find(scope, source, flags, sel), { scope, source: re.source, flags: re.flags, sel }),
    field: (re) => S.page.evaluate(({ source, flags }) => window.__ap.field(source, flags), { source: re.source, flags: re.flags }),
    formOpen: () => S.page.evaluate(() => window.__ap.formOpen()),
    formText: () => S.page.evaluate(() => window.__ap.formText()),
    textPoint: (scope, text, after) => S.page.evaluate(({ scope, text, after }) => window.__ap.textPoint(scope, text, after), { scope, text, after }),
    /** A cell of the canvas table in front, or null while its row or its column is not drawn. */
    cell: async (dbId, row, column) => { const c = await S.page.evaluate(({ dbId, row, column }) => window.__ap.cell(dbId, row, column), { dbId, row, column }); return c && c.found ? c : null; },
    heads: async (dbId) => (await S.page.evaluate(({ dbId }) => window.__ap.cell(dbId, '\u0000', '\u0000'), { dbId }))?.heads || [],
    /** Click, with the real mouse, the first enabled control in `scope` named like `re`. Its point is read at the press. */
    async press(scope, re, sel) {
      const hit = (await S.find(scope, re, sel)).find((h) => !h.disabled);
      if (!hit) return null;
      await S.page.mouse.click(hit.x, hit.y);
      return hit;
    },
    /** Click a point. A tab's or a choice's point is read again first: the strip or the list may have scrolled since. */
    async click(pt, opts) {
      const at = (pt.probeTab !== undefined || pt.probeChoice !== undefined) ? (await S.page.evaluate((p) => window.__ap.relocate(p), pt)) || pt : pt;
      return S.page.mouse.click(at.x, at.y, opts);
    },
    async setTool(tool, on) {
      const r = await S.page.evaluate(async ({ id, on }) => { try { await window.__parallx_workbench__._services.get({ id: 'IToolEnablementService' }).setEnablement(id, on); return true; } catch (e) { return String(e); } }, { id: TOOLS[tool], on });
      if (r !== true) throw new Error(`${tool} could not be turned ${on ? 'on' : 'off'}: ${r}`);
      const at = Date.now();
      must(await until(async () => (await S.hasCommand(TOOL_COMMAND[tool])) === on, 30_000, 50), `${tool} turned ${on ? 'on' : 'off'} (its command ${TOOL_COMMAND[tool]})`);
      if (on && tool === 'study') await S.page.waitForFunction(() => { try { return !!window.__parallx_workbench__._services.get({ id: 'ILanguageModelToolsService' }).getTool('study_results'); } catch { return false; } }, null, { timeout: 30_000 });
      return at;
    },
    /** Today as the app's own window has it, and its zone. */
    today: () => S.page.evaluate(() => { const n = new Date(); const p = (v) => String(v).padStart(2, '0'); return { date: `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())}`, zone: Intl.DateTimeFormat().resolvedOptions().timeZone, ms: n.getTime(), hour: n.getHours() }; }),
    dayTable: (firstDate) => S.page.evaluate((d) => window.__pp.dayTable(d), firstDate || ''),
    block: (scope, res, max = 260) => S.page.evaluate(({ scope, sources, max }) => window.__pp.block(scope, sources, max), { scope, sources: res.map((r) => (typeof r === 'string' ? esc(r) : r.source)), max }),
    region: (re) => S.page.evaluate((source) => window.__pp.region(source), re.source),
    /** A finger's tap at a point (CDP's own touch events). */
    async tap(pt) {
      const cdp = await S.page.context().newCDPSession(S.page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pt.x, y: pt.y }] });
      await sleep(60);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await cdp.detach().catch(() => {});
    },
  };
  return S;
}

// ── Study as it is: the sidebar, the subject's menu, New Subject, a session ──
const sidebarShown = (S) => S.page.evaluate(() => { const sb = window.__ap.scopeEl('sidebar'); return !!sb && window.__ap.shown(sb) && /(^|\n)\s*Materials\b/.test(sb.innerText); });
async function showStudySidebar(S) {
  if (await sidebarShown(S)) return true;
  await S.press('body', /^Study$/, '.activity-bar-item');
  return !!(await until(() => sidebarShown(S), 5000));
}
async function subjectsText(S) {
  const lines = (await S.text('sidebar')).split('\n').map(norm).filter(Boolean);
  const i = lines.findIndex((l) => /^Subjects\b/i.test(l));
  if (i < 0) return null;
  const j = lines.findIndex((l, k) => k > i && /^(Materials|Review|Sessions|Question banks)\b/i.test(l));
  return lines.slice(i + 1, j < 0 ? undefined : j).join(' ');
}
async function subjectPoint(S, name, { under = null } = {}) {
  await showStudySidebar(S);
  let pt = await S.textPoint('sidebar', name, '^Subjects( \\d+)?$');
  if (!pt && under) { const parent = await S.textPoint('sidebar', under, '^Subjects( \\d+)?$'); if (parent) { await S.click(parent); await sleep(500); pt = await S.textPoint('sidebar', name, '^Subjects( \\d+)?$'); } }
  return pt;
}
const MENU_ITEMS = '[role="menuitem"], [role="menuitemradio"], [role="option"], .parallx-quickpick-row';
/** The More Actions menu of a row in the sidebar (a subject's, or a unit's), opened: its items. */
async function rowMenu(S, name, under = null) {
  const row = await subjectPoint(S, name, { under });
  if (!row) return null;
  await S.page.mouse.move(row.x, row.y);
  await sleep(250);
  const more = (await S.find('sidebar', /^More Actions/i)).filter((h) => !h.disabled).sort((a, b) => Math.abs(a.y - row.y) - Math.abs(b.y - row.y))[0];
  if (!more || Math.abs(more.y - row.y) > 14) return null;
  await S.click(more);
  await sleep(450);
  return (await S.find('body', /./, '[role="menuitem"], [role="menuitemradio"]')).filter((h) => h.y > 48).map((h) => ({ name: h.name, x: h.x, y: h.y }));
}
const F = { name: /^(subject )?name\b/i, questions: /^questions?\b/i };
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
  await S.click(f);
  await sleep(400);
  const hit = await S.press('body', option, MENU_ITEMS);
  if (!hit) { await S.page.keyboard.press('Escape'); return { ok: false, why: 'not offered' }; }
  await sleep(300);
  return { ok: true };
}
function subjectOf(ws, name) {
  const page = pagesTitled(ws, name).filter((p) => !p.is_archived)[0] || null;
  const under = page ? databases(ws, page.id) : [];
  const named = (t) => under.find((d) => low(d.title) === t.toLowerCase()) || null;
  return { page, under, units: named('Units'), log: named('Work Log') };
}
const sheetOpen = (S) => S.has('root', '.st-sheet');
const pressStart = async (S) => (await S.press('root', /./, '[data-px-id="study.setup.start"]')) || (await S.press('root', /^(make questions and )?start\b/i, 'button'));
const answerable = (card) => !!card && !!card.stem && (card.options > 0 || !!card.field);
const waitCard = (S, ms = 15_000) => until(async () => { const c = await S.card(); return answerable(c) ? c : null; }, ms, 100);
async function waitVerdict(S, ms = 8000) {
  const seen = await until(async () => { const c = await S.card(); return c && c.verdict ? c : null; }, ms, 80);
  if (!seen) return null;
  await until(async () => (await S.find('root', /^Next\b/, 'button')).some((h) => !h.disabled), 3000, 80);
  await sleep(350);
  return (await S.card()) || seen;
}
async function answer(S, card, text) {
  if (card.field) {
    await S.click(card.field);
    await S.page.keyboard.type(text);
    await S.page.keyboard.press('Enter');
  } else {
    await S.press('root', /./, '.st-opt');
  }
  let v = await waitVerdict(S, 3000);
  if (!v) { (await S.press('root', /^(check|submit|grade)\b/i, 'button')) || (await S.page.keyboard.press('Control+Enter')); v = await waitVerdict(S, 8000); }
  return must(v, 'a verdict after the answer');
}
async function pressNext(S, stem) {
  must(await until(() => S.press('root', /^(Next|See Results|Finish)\b/, 'button'), 4000), 'an enabled Next');
  return until(async () => { const c = await S.card(); if (answerable(c) && c.stem !== stem) return c; return (await S.page.evaluate(() => window.__ap.results())) || !c ? 'end' : null; }, 6000, 80);
}
async function closeStudyTabs(S) {
  for (let i = 0; i < 5; i++) {
    const t = (await S.tabs()).find((x) => /:study:/.test(x.id) && !x.label.includes(' · ') && !/ Progress$/.test(x.label));
    if (!t) return;
    await S.page.evaluate((id) => { const tab = Array.from(document.querySelectorAll('.ui-tab')).find((x) => x.getAttribute('data-tab-id') === id); tab?.querySelector('.ui-tab-close')?.dispatchEvent(new MouseEvent('click', { bubbles: true })); }, t.id);
    await sleep(500);
    await S.press('body', /^(End Session|Leave|Close)\b/, '.parallx-modal-box button');
    await sleep(400);
  }
}

// ── The unit's tab ───────────────────────────────────────────────────────────
const tabTitled = async (S, title) => (await S.tabs()).filter((t) => t.label === title);
async function showTab(S, title) {
  const t = (await tabTitled(S, title))[0];
  if (!t) return false;
  if (!t.active) { await S.click(t); await until(async () => (await tabTitled(S, title)).some((x) => x.active), 3000, 50); }
  return true;
}
/** Where the × of the tab titled `title` is, read now: the strip may have scrolled, and a point beside the strip is another button. */
// The tab is found by its title as S.tabs() reads it (a Study place tab by the screen it shows, c3eebb8f), then by its id.
const tabClosePoint = async (S, title) => S.page.evaluate((id) => {
  const t = id && Array.from(document.querySelectorAll('.ui-tab')).find((x) => x.getAttribute('data-tab-id') === id);
  if (!t) return null;
  t.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  const b = t.querySelector('.ui-tab-close');
  const r = (b || t).getBoundingClientRect();
  const x = r.x + r.width / 2; const y = r.y + r.height / 2;
  const hit = document.elementFromPoint(x, y);
  return { x, y, onTab: !!hit && t.contains(hit), hasClose: !!b };
}, (await tabTitled(S, title))[0]?.id ?? '');
/** The tab titled `title` closed with the mouse, by its own ×. */
async function closeTab(S, title) {
  if (!(await showTab(S, title))) return false;
  const over = await tabClosePoint(S, title);
  if (!over) return false;
  await S.page.mouse.move(over.x, over.y);
  await sleep(150);
  const pt = await tabClosePoint(S, title);
  if (!pt || !pt.onTab || !pt.hasClose) return false;
  await S.page.mouse.click(pt.x, pt.y);
  return !!(await until(async () => (await tabTitled(S, title)).length === 0, 3000));
}
/** The tab in front closed by the workbench's own command (housekeeping between steps, never the thing under test). */
const closeFront = async (S) => { await S.cmd('workbench.action.closeActiveEditor'); await sleep(350); };
/**
 * The press on a unit's row, made so the tabs stand as they did when a unit had a tab of its own. Since c3eebb8f a
 * unit is a place in Study's one tab: a press moves that tab (off whatever it showed), Ctrl+click gives a tab of its
 * own. So: with the unit's tab open, that tab forward and the press (it stays there, as the press brought it forward
 * before); with no Study place tab open, the press (it opens the one tab); with one on another screen, Ctrl+click
 * (that screen's tab stays, as it did). `plain`: the press alone, for a check of the press itself.
 */
async function pressUnit(S, unit, pt, { plain = false } = {}) {
  if (plain) return S.click(pt);
  const tabs = await S.tabs();
  if (tabs.some((t) => t.label === tabTitle(unit))) { await showTab(S, tabTitle(unit)); return S.click(pt); }
  if (!tabs.some((t) => /:study-place:/.test(t.id))) return S.click(pt);
  await S.page.keyboard.down('Control');
  await S.click(pt);
  await S.page.keyboard.up('Control');
}
/** Press the unit in Study's sidebar; its tab in front, or a stop that says what came instead. Returns the time of the press. */
async function openUnit(S, unit, opts) {
  const pt = must(await subjectPoint(S, unit, { under: SUBJECT }), `the unit "${unit}" under "${SUBJECT}" in Study's sidebar`);
  const at = Date.now();
  await pressUnit(S, unit, pt, opts);
  const front = await until(async () => (await tabTitled(S, tabTitle(unit))).some((t) => t.active), 5000, 30);
  if (!front) {
    const tabs = (await S.tabs()).map((t) => `${t.label}${t.active ? ' (front)' : ''}`).join(' | ');
    const sheet = await sheetOpen(S);
    await closeStudyTabs(S);
    throw new Error(`no tab "${tabTitle(unit)}" in front after the unit was pressed in the sidebar (tabs: ${tabs}${sheet ? '; the setup sheet opened instead' : ''})`);
  }
  return at;
}
const itemOf = (items, title) => items.find((i) => i.title === title) || null;
/** Wait for the tab in front to show what `pred` wants of its groups and items. */
async function waitTab(S, pred, ms = 5000) {
  let g = []; let it = [];
  const hit = await until(async () => { g = await S.groups(); it = await S.items(); return pred(g, it) ? true : null; }, ms, 60);
  return { ok: !!hit, groups: g, items: it };
}
/** The Notes and files items of the tab, as titles. */
const notesTitles = (items) => items.filter((i) => low(i.group) === low(NOTES)).map((i) => i.title).sort();

// ── The picker and Find Matches ─────────────────────────────────────────────
/** Does a choice's row hold `title` on a line of its own? */
const lineIs = (choice, title) => choice.lines.some((l) => norm(l) === title);

// ── The canvas, the Explorer, the tools ──────────────────────────────────────
async function openDb(S, dbId) {
  await S.cmd('canvas.openPage', dbId);
  return !!(await until(() => S.page.evaluate((dbId) => Array.from(document.querySelectorAll('[data-px-surface="database"]')).some((e) => window.__ap.shown(e) && (e.getAttribute('data-px-instance') || '').endsWith(dbId)), dbId), 8000));
}
async function toTrash(S, pageId) {
  S.run('canvas.deletePage', pageId);
  must(await until(() => S.press('body', /^Move to Trash$/, 'button'), 5000), 'the Move to Trash button of the canvas\'s question');
  await sleep(400);
  return until(() => pageRow(S.workspace, pageId)?.is_archived === 1, 4000);
}
async function setMode(S, mode) {
  await S.cmd('settings.openAppearance');
  const sel = `[data-px-id="appearance.mode.${mode}"]`;
  must(await until(() => S.press('body', /./, sel), 8000), `Appearance's ${mode} mode`);
  await sleep(600);
  // Settings is a dialog over the window: Escape closes it, its own Close when Escape does not.
  await S.page.keyboard.press('Escape');
  if (!(await until(async () => !(await S.has('body', sel)), 2000))) await S.press('form', /^Close\b/);
  must(await until(async () => !(await S.has('body', sel)), 3000), 'Settings closed again');
  await sleep(300);
}
// ── Seeding the workspace ────────────────────────────────────────────────────
async function seedDatabase(S, title, properties, rows) {
  const made = await S.tool('canvas_create_database', { title, properties });
  const id = must((/id: ([0-9a-f-]{20,})/i.exec(made) || [])[1], `the id of the seeded database "${title}" (${made.slice(0, 120)})`);
  for (const r of rows) {
    const out = await S.tool('canvas_add_database_row', { databaseId: id, title: r.title, values: r.values || {} });
    if (/skipped|not set|threw|error/i.test(out)) throw new Error(`the seeded row "${r.title}" of "${title}" was not stored as given: ${out.slice(0, 160)}`);
  }
  return id;
}
async function seedPage(S, title, parentId) {
  const made = await S.tool('canvas_create_page', parentId ? { title, parentId, markdown: `Notes on ${title}.` } : { title, markdown: `Notes on ${title}.` });
  return must((/id: ([0-9a-f-]{20,})/i.exec(made) || [])[1], `the id of the seeded page "${title}" (${made.slice(0, 120)})`);
}
const bankColumns = (papers) => [
  { name: 'Model Answer', type: 'text' }, { name: 'Paper', type: 'select', options: papers },
  { name: 'Times Attempted', type: 'number' }, { name: 'Times Correct', type: 'number' },
  { name: 'Last Result', type: 'select', options: ['Right', 'Partly', 'Wrong'] },
];
/** Type `text` into a cell's editor and press Enter. Returns the moment Enter was pressed, or null when the cell opens no editor. */
async function typeCell(S, dbId, rowTitle, column, text) {
  const cell = must(await until(() => S.cell(dbId, rowTitle, column), 4000), `the cell ${column} of "${String(rowTitle).slice(0, 40)}" in the table`);
  await sleep(250);                                   // the table may have scrolled to the row
  await S.click((await S.cell(dbId, rowTitle, column)) || cell);
  const open = await until(() => S.page.evaluate(() => window.__pp.editorOpen()), 1500, 60);
  if (!open) return null;
  await S.page.keyboard.press('Control+A');
  await S.page.keyboard.type(String(text));
  await S.page.keyboard.press('Enter');
  return Date.now();
}
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
  // A plan had a tab of its own, kept open beside the others; now a plan is a place in Study's one tab (c3eebb8f), which
  // the next plan or unit moves, and the subject's Open Plan opens the plan it shows. When that is another plan of the
  // subject, the plan is reached by the command study.openPlan, which asks which plan, and its name is picked.
  if (!(await until(async () => (await tabTitled(S, name)).some((t) => t.active), 3000, 50))) {
    S.run('study.openPlan');
    must(await until(() => S.press('body', new RegExp(`^${esc(name)}(?![A-Za-z0-9])`), '.parallx-quickpick-row, [role="option"]'), 5000, 80), `"${name}" offered by study.openPlan`);
  }
  must(await until(async () => (await tabTitled(S, name)).some((t) => t.active), 8000, 50), `a tab titled "${name}" in front after Open Plan`);
}
/** The tab's table with `n` days in it. */
const tabShows = (S, n, firstDate, ms = 10_000) => until(async () => { const d = await tabDays(S, firstDate); return d && d.length === n ? d : null; }, ms, 80);

// ── What is seeded, and the steps of this piece ─────────────────────────────
const SUBJECT = 'Exam 7';
const BANK = 'Conceptual Questions';
const GROUP_NAMES = ['Notes and files', 'Questions'];
const NOTES = 'Notes and files';
const tabTitle = (unit, subject = SUBJECT) => `${subject} · ${unit}`;
const subjectMenu = (S, subject) => rowMenu(S, subject);
const BF = 'Bornhuetter Ferguson';
// The bank's papers and how many questions each has.
const PAPERS = { Mack: 3, Clark: 2, Venter: 2, Friedland: 2, [BF]: 2 };
const SEED = Object.entries(PAPERS).flatMap(([paper, n], p) => Array.from({ length: n }, (_, i) => {
  const k = (p + 1) * 100 + i + 1;
  // A question's row is a page too: its title holds no unit's name, so it is never a match for one.
  return { paper, question: `Reserving question ${k}: which statement is right?`, answer: `Statement number${k} explains reserving matters properly.` };
}));
const TYPED = 'Statement explains reserving matters properly.';
// The files: six PDFs in Readings/, notes in Notes/ and at the root.
const R = (f) => path.join('Readings', f);
const N = (f) => path.join('Notes', f);
const FILES = {
  mackPdf: R('Mack 1994 - Measuring the Variability of Chain Ladder Reserve Estimates.pdf'),
  clarkPdf: R('Clark 2003 - LDF Curve Fitting and Stochastic Reserving.pdf'),
  venterPdf: R('Venter 1998 - Testing the Assumptions of Age-to-Age Factors.pdf'),
  bfPdf: R('Bornhuetter Ferguson 1972 - The Actuary and IBNR.pdf'),
  brosiusPdf: R('Brosius 1993 - Loss Development Using Credibility.pdf'),
  mackenziePdf: R('Mackenzie 2001 - Notes.pdf'),
  mackMd: N('mack summary.md'),
  clarkTxt: N('CLARK - outline.txt'),
  mackenzieMd: N('Mackenzie review.md'),
  groceryTxt: N('Grocery list.txt'),
  clarkMd: 'Clark.md',
};
const nameOf = (key) => path.basename(FILES[key]);
const stemOf = (key) => nameOf(key).replace(/\.[^.]+$/, '');
// The pages, in the canvas's own layout (loose pages; one under another).
const PAGES = { mackPage: 'Mack', venterNotes: 'Venter - my notes', chain: 'chain ladder worked example', log: 'Reading Log', unmacked: 'Unmacked thoughts' };
const ALSO_CALLED = { Mack: 'Chain Ladder' };
// Which bank unit each PDF of Readings/ joins (its name holds the unit's name as whole words), and which become their own unit.
const JOINS = { mackPdf: 'Mack', clarkPdf: 'Clark', venterPdf: 'Venter', bfPdf: BF };
const OWN = ['brosiusPdf', 'mackenziePdf'];
const UNITS_WITH_FOLDER = [...Object.keys(PAPERS), ...OWN.map(stemOf)];

async function writeFiles(ws) {
  await fs.mkdir(path.join(ws, 'Readings'), { recursive: true });
  await fs.mkdir(path.join(ws, 'Notes'), { recursive: true });
  for (const [k, f] of Object.entries(FILES)) await fs.writeFile(path.join(ws, f), f.endsWith('.pdf') ? pdfBytes(stemOf(k).replace(/[()\\]/g, ' ')) : `${stemOf(k)}\n\nA note.\n`);
}

/** New Subject…, as a person fills it in: the name, a sources folder and a questions database, each when given. */
async function makeSubject(S, { name, questions = null, folder = null }) {
  S.run('study.newSubject');
  must(await until(() => S.formOpen(), 6000), 'the New Subject sheet after study.newSubject');
  await sleep(400);
  const nameField = must(await S.field(F.name), 'the Name field of the New Subject sheet');
  await S.click(nameField); await S.page.keyboard.press('Control+A'); await S.page.keyboard.type(name);
  if (folder) { const r = await chooseIn(S, /^sources folder\b/i, exact(folder)); if (!r.ok) throw new Error(`"${folder}" could not be chosen as the Sources folder: ${JSON.stringify(r)}`); }
  if (questions) { const r = await chooseIn(S, F.questions, exact(questions)); if (!r.ok) throw new Error(`"${questions}" could not be chosen as the Questions: ${JSON.stringify(r)}`); }
  await sleep(300);
  let mapped = false;
  for (let step = 0; step < 4; step++) {
    if (!(await S.formOpen())) break;
    if (questions && !mapped && (await S.field(/^answer\b/i))) mapped = true;
    must(await pressConfirm(S), `a button to confirm the New Subject sheet (it shows: ${norm(await S.formText()).slice(0, 160)})`);
    await until(async () => !(await S.formOpen()) || (questions && !mapped && (await S.field(/^answer\b/i))), 8000);
    await sleep(300);
  }
  if (await S.formOpen()) throw new Error(`the New Subject sheet did not close: ${norm(await S.formText()).slice(0, 200)}`);
}
/** The subject's page with Units and Work Log under it, once its Units rows have stopped changing. */
async function settledSubject(S, name, ms = 20_000) {
  const subj = must(await until(() => { const s = subjectOf(S.workspace, name); return s.page && s.units && s.log ? s : null; }, ms, 150), `the page "${name}" with Units and Work Log under it`);
  let last = ''; let since = Date.now();
  await until(() => { const now = JSON.stringify(rowsOf(S.workspace, subj.units.id).map((r) => [r.title, r.raw])); if (now !== last) { last = now; since = Date.now(); } return Date.now() - since > 2500; }, ms, 250);
  return subj;
}
const unitTitles = (ws, unitsDb) => rowsOf(ws, unitsDb).map((r) => norm(r.title));
const fileKeys = (ws, key) => keysOf(ws, { file: FILES[key] });
const unitHolds = (ws, unitsDb, unit, key) => holds(materialOf(ws, unitsDb, unit), fileKeys(ws, key));
const pageId = (ws, title) => pagesTitled(ws, title).filter((p) => !p.is_archived)[0]?.id || null;

// A session, as a person runs one.
/** The unit's tab, "Study…" on it, the setup sheet. */
async function openSetup(S, unit) {
  if (!(await showTab(S, tabTitle(unit)))) await openUnit(S, unit);
  must(await S.press('pane', /^Study…$/), `"Study…" on the tab "${tabTitle(unit)}"`);
  must(await until(() => sheetOpen(S), 6000), 'the setup sheet after "Study…"');
  await sleep(500);
}
/** A session over a unit, started with the mouse: the first question on screen. */
async function startSession(S, unit) {
  await openSetup(S, unit);
  must(await pressStart(S), 'the Start button of the setup sheet');
  return must(await waitCard(S), `the first question of the session over ${unit}`);
}
/** The session in front ended by its own End Session, the question answered. */
async function endSession(S) {
  must(await S.press('root', /^End Session$/), '"End Session" on the session');
  await sleep(400);
  await S.press('body', /^End Session$/, '.parallx-modal-box button');
  await sleep(900);
}
/** Answer every question left, to the results. Returns the moment the results were on screen. */
async function finishSession(S, card) {
  for (let i = 0; i < 8 && card && card !== 'end'; i++) { await answer(S, card, TYPED); card = await pressNext(S, card.stem); }
  must(card === 'end', 'the results after the last question');
  return Date.now();
}
/** The Work Log's newest row of a session over `unit`: its Minutes once they have stopped changing, or null. */
async function loggedMinutes(S, logDb, unit, ms = 6000) {
  const read = () => { const rows = rowsOf(S.workspace, logDb).filter((r) => norm(r.title) === tabTitle(unit)); return rows.length ? num(rows[rows.length - 1].values.Minutes) : null; };
  let last = null; let since = Date.now();
  await until(() => { const v = read(); if (v !== last) { last = v; since = Date.now(); } return v !== null && Date.now() - since > 1300; }, ms, 100);
  return read();
}

// The page's clock (Playwright's): the app's own timers and Date, moved by the probe.
async function fakeClock(S) {
  if (S.clockOn) return;
  await S.page.clock.install();
  S.clockOn = true;
}
const MIN = 60_000;
/** A point of the question on screen that does nothing when pressed: its words. */
const stemPoint = (S) => S.page.evaluate(() => { const r = window.__ap.scopeEl('root'); const q = r && Array.from(r.querySelectorAll('.st-card__q')).find(window.__ap.shown); if (!q) return null; const b = q.getBoundingClientRect(); return { x: b.x + Math.min(40, b.width / 2), y: b.y + b.height / 2 }; });
/** One sign that he is at the desk: a key, a turn of the wheel, a click or a finger's tap. */
async function input(S, kind) {
  if (kind === 'key') { await S.page.keyboard.press('Shift'); return; }
  const pt = (await stemPoint(S)) || { x: 720, y: 500 };
  if (kind === 'wheel') { await S.page.mouse.move(pt.x, pt.y); await S.page.mouse.wheel(0, 40); }
  else if (kind === 'click') await S.page.mouse.click(pt.x, pt.y);
  else if (kind === 'tap') await S.tap(pt);
  await sleep(60);
}
/** `times` stretches of `minutes` each on the page's clock, with one input after each (none when `kinds` is empty). */
async function pass(S, times, minutes, kinds = []) {
  for (let i = 0; i < times; i++) {
    await S.page.clock.runFor(minutes * MIN);
    if (kinds.length) await input(S, kinds[i % kinds.length]);
  }
}

// The plans of this piece.
const wk = (name, days, account, from, until, floor, standard, stretch) => ({ name, days, account, from, until, floor, standard, stretch });
const ph = (name, kind, start, end, items = null, minutes = null) => ({ name, kind, start, end, items, minutes });
const week7 = (monThu, fri, sat, sun) => ({ Mon: monThu, Tue: monThu, Wed: monThu, Thu: monThu, Fri: fri, Sat: sat, Sun: sun });
/** The plan around today: it began nine days ago and its exam is in three weeks; every weekday has hours. */
const sprint = (today) => ({ name: 'Sprint', start: addDays(today, -9), exam: addDays(today, 21), goal: 60, personal: week7(2, 1, 3, 4), work: week7(1, 1, 0, 0) });
/** A plan that lies ahead: six weeks from a week from now. */
const ahead = (today, name, off) => ({ name, start: addDays(today, 7), exam: addDays(today, 49), goal: 100, personal: week7(2, 1, 3, 0), work: week7(1, 1, 0, 0), ...(off === undefined ? {} : { off }) });
const DAYS_OFF = /^days off before the exam\b/i;
/** The New Plan sheet filled in and created; `spec.off` fills "Days off before the exam". */
async function makePlanWith(S, spec) {
  await openPlanSheet(S);
  await fillPlanSheet(S, spec);
  if (spec.off !== undefined) await fillField(S, DAYS_OFF, spec.off, 'the field "Days off before the exam" of the New Plan sheet');
  await pressCreate(S);
  must(await until(async () => (await tabTitled(S, spec.name)).some((t) => t.active), 40_000, 50), `a tab titled "${spec.name}" in front after Create (the sheet says: ${norm(await S.formText()).slice(0, 200) || 'nothing'})`);
  const p = must(await until(() => { const x = planOf(S.workspace, spec.name); return wholePlan(x) ? x : null; }, 20_000, 100), `the page "${spec.name}" with Plan, Week, Phases and Days under the subject's page`);
  const n = daysBetween(spec.start, spec.exam);
  must(await until(() => daysIn(S.workspace, p).length === n, 30_000, 150), `the ${n} days of "${spec.name}" in Days (it has ${daysIn(S.workspace, p).length})`);
  must(await tabShows(S, n, spec.start, 20_000), `the tab of "${spec.name}" showing its ${n} days`);
  return p;
}
/** The Phases rows as the file has them, with Follows. */
const phaseRows = (ws, p) => rowsOf(ws, p.phases.id).map((r) => ({ pageId: r.pageId, name: norm(r.title), kind: r.values.Kind ?? '', start: dateOf(r.values.Start), end: dateOf(r.values.End), follows: r.values.Follows ?? '' }));
const phaseNamed = (ws, p, name) => phaseRows(ws, p).find((r) => r.name === name) || null;
const DAY_KEYS = ['type', 'phase', 'work', 'floor', 'standard', 'stretch'];
/** What of the days before `today` is not as it was in `before` (a row gone, a value changed, a day marked Edited). */
function pastChanged(before, now, today) {
  const by = new Map(now.map((d) => [d.date, d]));
  const out = [];
  for (const b of before.filter((d) => d.date < today)) {
    const g = by.get(b.date);
    if (!g) { out.push(`${b.date}: its row is gone`); continue; }
    const bad = DAY_KEYS.filter((k) => String(g[k]) !== String(b[k]));
    if (bad.length) out.push(`${b.date}: ${bad.map((k) => `${k} ${g[k] === '' ? 'empty' : g[k]}, was ${b[k] === '' ? 'empty' : b[k]}`).join('; ')}`);
    if (g.edited) out.push(`${b.date}: marked Edited`);
  }
  return out;
}
/** What of the days from `today` on is not what the rules in the file give. */
function fromTodayDiffs(ws, p, today) {
  const want = expectedDays(ws, p).days.filter((d) => d.date >= today);
  return dayDiffs(daysIn(ws, p).filter((d) => d.date >= today), want, [...DAY_KEYS, 'planned']);
}
/**
 * After a change of the rules stored at `t0`: the days from today on follow
 * the rules (how long it took, in the file and then in the tab), and the days
 * before today are as `before` has them, still so a moment later.
 */
async function fromTodayOn(S, p, before, today, t0, { tab = null, start = null } = {}) {
  const ws = S.workspace;
  const rowsAt = await until(() => (fromTodayDiffs(ws, p, today).length ? null : Date.now()), 8000, 40);
  if (tab) await showTab(S, tab);
  const first = start || rulesIn(ws, p).plan.start;
  const tabDiffs = async () => {
    const w = expectedDays(ws, p); const shown = (await tabDays(S, first)) || [];
    const wantNew = asTab(w.days, w.rules.plan.following).filter((d) => d.date >= today);
    const wantOld = asTab(before.filter((d) => d.date < today && d.date >= first).map((d) => ({ ...d, planned: d.work + d[w.rules.plan.following.toLowerCase()] })), w.rules.plan.following);
    return [...dayDiffs(shown.filter((d) => d.date >= today), wantNew, ['type', 'phase', 'personal', 'work', 'total']), ...dayDiffs(shown.filter((d) => d.date < today), wantOld, ['type', 'phase', 'personal', 'work', 'total']).map((x) => `in the tab, before today: ${x}`)];
  };
  const tabAt = await until(async () => ((await tabDiffs()).length ? null : Date.now()), 8000, 80);
  await sleep(1500);                                  // a rewrite of the past that comes late is still a rewrite
  const past = pastChanged(before, daysIn(ws, p), today);
  const out = { followedMs: rowsAt ? Math.max(0, rowsAt - t0) : null, tabMs: tabAt ? Math.max(0, tabAt - t0) : null, pastChanged: past.length };
  if (!rowsAt) out.fromTodayDiffers = fromTodayDiffs(ws, p, today).slice(0, 3);
  if (!tabAt) out.tabDiffers = (await tabDiffs()).slice(0, 3);
  if (past.length) out.past = past.slice(0, 3);
  return out;
}
const keptAndFollowed = (r) => !!r && r.followedMs !== null && r.tabMs !== null && r.pastChanged === 0;

/** A Done cell read as hours: "2 min", "1 h 30 min", "1.5", "1.5 h". Empty is null. */
function doneHours(text) {
  const t = norm(text);
  if (!t || /^[—–-]$/.test(t)) return null;
  const hm = /(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?\b(?:\s*(\d+)\s*min)?/i.exec(t);
  if (hm) return Number(hm[1]) + (hm[2] ? Number(hm[2]) / 60 : 0);
  const m = /(\d+(?:\.\d+)?)\s*min/i.exec(t);
  if (m) return Number(m[1]) / 60;
  const n = /-?\d+(?:\.\d+)?/.exec(t);
  return n ? Number(n[0]) : null;
}
/** Today's row and the rows of `dates` in the tab's table: date -> the words of its Done cell (null when the table has no Done column). */
async function doneCells(S, first, dates) {
  const t = await S.dayTable(first);
  if (!t) return null;
  return Object.fromEntries(t.rows.filter((r) => dates.includes(r.date)).map((r) => [r.date, 'done' in r.cells ? r.cells.done : null]));
}
const near = (a, b, by = 0.06) => a !== null && b !== null && Math.abs(a - b) <= by;

// The words of point 7.
const wordsOf = (t) => norm(t).split(' ').filter(Boolean);
/** The line that says what `term` is: it begins with the term (after "The" or "A" at most) and has five words or more. */
function definingLine(lines, term) {
  const re = new RegExp(`^(?:the\\s+|an?\\s+)?${esc(term)}(?![A-Za-z-])`, 'i');
  return (lines || []).find((l) => re.test(l.text) && wordsOf(l.text).length >= 5 && l.text.length <= 240) || null;
}
/** Sentence case: it begins with a capital, is not in capitals, and at most half of its other words begin with one. */
function sentenceCase(line) {
  const w = wordsOf(line.text);
  const caps = w.slice(1).filter((x) => /^[A-Z][a-z]/.test(x)).length;
  return /^[A-Z]/.test(line.text) && line.text !== line.text.toUpperCase() && line.transform !== 'uppercase' && line.transform !== 'capitalize' && caps <= (w.length - 1) / 2;
}
/** For each term its line; ok when every term has one, each a line of its own, in sentence case. */
function linesFor(lines, terms) {
  const got = Object.fromEntries(terms.map((t) => [t, definingLine(lines, t)]));
  const texts = terms.map((t) => got[t]?.text).filter(Boolean);
  const ok = terms.every((t) => got[t]) && new Set(texts).size === terms.length && terms.every((t) => sentenceCase(got[t]));
  return { ok, got, said: Object.fromEntries(terms.map((t) => [t, got[t] ? got[t].text.slice(0, 110) : null])) };
}
const GONE = /no longer|is gone|was removed|has been removed|in the trash|not in units|deleted/i;
const notifications = (S) => S.page.evaluate(() => Array.from(document.querySelectorAll('.parallx-notification-message')).filter(window.__ap.shown).map((n) => (n.innerText || '').replace(/\s+/g, ' ').trim()));
/** Find Matches… from the subject's More Actions: 'list' with its choices, or 'said' with what the app said instead. */
async function findMatches(S) {
  const items = must(await rowMenu(S, SUBJECT), 'the subject\'s More Actions menu');
  const it = must(items.find((i) => /^Find Matches…$/.test(i.name)), `"Find Matches…" in the subject's More Actions (it has: ${items.map((i) => i.name).join(', ')})`);
  const before = (await notifications(S)).length;
  await S.click(it);
  const seen = await until(async () => ((await S.formOpen()) && (await S.choices()).length ? 'list' : (await notifications(S)).length > before ? 'said' : null), 6000, 100);
  await sleep(500);
  return { seen, list: seen === 'list' ? await S.choices() : [], said: (await notifications(S)).slice(before).join(' | ') };
}
const closeList = async (S) => { (await S.press('form', /^(cancel|close)$/i, 'button')) || (await S.page.keyboard.press('Escape')); await until(async () => !(await S.formOpen()), 3000); await sleep(300); };
/** The rows of the list that read `title` on a line of its own, each with its place in the list and its other words. */
const rowsFor = (list, title) => list.map((ch, i) => ({ ...ch, at: i, rest: ch.lines.filter((l) => norm(l) !== title).join(' | ') })).filter((ch) => lineIs(ch, title));
async function attachTicked(S, titles) {
  const r = must((await findMatches(S)).seen === 'list', 'the list of proposals');
  void r;
  const ticked = [];
  for (const title of titles) {
    const ch = must((await S.choices()).find((c) => lineIs(c, title)), `the proposal "${title}"`);
    await S.click(ch); await sleep(200);
    ticked.push(title);
  }
  must(await S.press('form', /^Attach Selected$/, 'button'), '"Attach Selected"');
  must(await until(async () => !(await S.formOpen()), 4000), 'the list closing after "Attach Selected"');
  await sleep(600);
  return ticked;
}
/** Press Tab until the focus is on a control named like `re` (at most `max` times). */
async function tabTo(S, re, max = 40, key = 'Tab') {
  for (let i = 0; i < max; i++) {
    await S.page.keyboard.press(key);
    const f = await S.focused();
    if (f && re.test(f.name || '')) return f;
  }
  return null;
}
/** The keys alone to a unit row's More Actions: Tab from the Subjects heading to the unit's row, once more to its More Actions. */
async function keysToUnitMore(S, unit) {
  await showStudySidebar(S);
  // A press on the words of the Subjects heading: nothing is focused by it, and Tab goes on from there.
  const head = must(await S.page.evaluate(() => { const sb = window.__ap.scopeEl('sidebar'); const n = sb && Array.from(sb.querySelectorAll('*')).filter((e) => window.__ap.shown(e) && /^Subjects( \d+)?$/.test((e.innerText || '').replace(/\s+/g, ' ').trim())).pop(); if (!n) return null; const r = n.getBoundingClientRect(); return { x: r.x + Math.min(20, r.width / 2), y: r.y + r.height / 2 }; }), 'the Subjects heading of the sidebar');
  await S.click(head);
  const row = await tabTo(S, new RegExp(`^(Open )?${esc(unit)}(?![A-Za-z])`), 40);
  if (!row) return null;
  await S.page.keyboard.press('Tab');
  const f = await S.focused();
  return f && /^More Actions/.test(f.name || '') ? f : null;
}
/** The name of the menu item the keys are on. */
const menuFocus = (S) => S.page.evaluate(() => {
  const a = document.activeElement;
  const act = a && a.getAttribute('aria-activedescendant') ? document.getElementById(a.getAttribute('aria-activedescendant')) : null;
  // The app's menu marks the item the keys are on with a class; the focus may stay where it was.
  const marked = Array.from(document.querySelectorAll('[role="menu"] .context-menu-item--selected, [role="menuitem"][data-active="true"], [role="menuitem"][aria-selected="true"]')).find(window.__ap.shown) || null;
  const n = act || marked || (a && a.matches('[role="menuitem"], [role="menuitemradio"], [role="option"]') ? a : null);
  return n ? window.__ap.accName(n) : '';
});
/** Arrow down through the open menu until the keys are on the item named like `re`. */
async function arrowTo(S, re, max = 14) {
  for (let i = 0; i < max; i++) {
    const name = await menuFocus(S);
    if (re.test(name)) return name;
    await S.page.keyboard.press('ArrowDown');
    await sleep(80);
  }
  return re.test(await menuFocus(S)) ? await menuFocus(S) : null;
}

// ── The phases ───────────────────────────────────────────────────────────────
const PHASES = [];
/** `kept` are checks of a phase that hold on the app as it is and must go on holding: counted with the ground. */
const phase = (n, title, base, checks, fn, kept = []) => PHASES.push({ n, title, base, checks, fn, kept });
/** One check that cannot stop the ones after it. `fn` returns [ok, what came back]. */
async function check(c, id, fn) {
  let ok = false;
  try { const r = await fn(); ok = !!r[0]; c(id, r[0], r[1]); } catch (err) { c(id, false, `stopped: ${String((err && err.message) || err).split('\n')[0].slice(0, 360)}`); }
  // What the screen showed when a check did not hold.
  if (!ok && c.S && c.S.page) await c.S.shot(`fail-${id}`);
}
/** The subject's More Actions menu of a unit's row, opened with the mouse: its items. */
const unitMenu = (S, unit) => rowMenu(S, unit, SUBJECT);
const sheetGone = (S) => until(async () => !(await sheetOpen(S)), 4000);
async function cancelSheet(S) { if (await sheetOpen(S)) { (await S.press('root', /^Cancel$/, '.st-sheet__acts button')) || (await S.page.keyboard.press('Escape')); await sheetGone(S); await sleep(300); } }

phase(0, 'The ground the checks stand on (the app as it is today; none of it is new)', 'plan', {
  '0.1': 'the app runs in the zone the probe asked for, and gives today as a local date',
  '0.2': 'the seed as the app shows it: the subject and its five units in the sidebar, their questions counted in Units, Mack also called Chain Ladder, the eleven files on disk',
  '0.3': 'the plan made through the sheet with a start nine days back: 30 days, the nine past ones worked out by the rules like the rest, none Edited, today\'s row marked, one phase "Start to exam"',
  '0.4': 'a Week row added through the chat\'s tool: the days from today on follow, in Days and in the tab',
  '0.5': 'a session over a unit: "Study…" on its tab, the setup sheet, Start, a typed answer graded, the results; the Work Log has its row',
  '0.6': 'the page\'s clock can be moved: a minute passes in well under a minute, and six minutes at the desk (a key each minute) are logged as 6 to 8',
  '0.7': 'Find Matches… lists the exact names for their units, unticked; a row is ticked with the keys (Tab into the list, the arrows, Space); closed without Attach Selected, nothing is attached',
  '0.8': 'a unit\'s row put in the Trash with its tab open: the tab says so and can be closed',
  '0.9': 'the unit row\'s More Actions is opened and its item chosen by the keys, and by a finger',
  '0.10': 'the New Subject sheet offers the workspace\'s folders (Readings, Notes) as Sources folder, and asks for the Questions',
  '0.11': 'in the setup sheet, Enter on a button that is not Start ("Practice") is that button\'s and starts nothing; Escape closes the sheet',
  '0.12': 'a past day\'s Done shows in the tab: 90 minutes in the Work Log three days ago read 1.5',
  '0.13': 'a Week row\'s Standard typed in the table leaves its Floor and Stretch as they were',
  '0.14': 'Appearance switches to light and back to dark',
  '0.15': 'the chat\'s tool empties a select cell',
}, async (S, c, A) => {
  const ws = S.workspace;
  const T = (await S.today()).date;
  const SP = sprint(T);
  await check(c, '0.1', async () => { const t = await S.today(); return [/^\d{4}-\d{2}-\d{2}$/.test(t.date) && (process.platform === 'win32' || t.zone === ZONE), { ...t, asked: ZONE }]; });
  await check(c, '0.2', async () => {
    await showStudySidebar(S);
    const side = (await subjectsText(S)) || '';
    const rows = Object.fromEntries(rowsOf(ws, A.units).map((r) => [norm(r.title), num(r.values.Questions)]));
    const missing = Object.values(FILES).filter((f) => !existsSync(path.join(ws, f)));
    return [Object.keys(PAPERS).every((u) => side.includes(u)) && same(rows, PAPERS) && norm(rowTitled(ws, A.units, 'Mack')?.values['Also Called']) === ALSO_CALLED.Mack && missing.length === 0 && Object.keys(FILES).length === 11,
      { sidebar: side.slice(0, 160), units: rows, mackAlsoCalled: rowTitled(ws, A.units, 'Mack')?.values['Also Called'], filesMissing: missing }];
  });
  const p = mustPlan(ws, SP.name);
  await check(c, '0.3', async () => {
    await openPlan(S, SP.name);
    const days = daysIn(ws, p); const want = expectedDays(ws, p).days;
    const diffs = dayDiffs(days, want, FILE_KEYS);
    const shown = await tabShows(S, 30, SP.start);
    const t = await S.dayTable(SP.start);
    const marked = (t?.rows || []).filter((r) => r.current).map((r) => r.date);
    const past = days.filter((d) => d.date < T);
    const ph1 = phaseRows(ws, p);
    await S.shot('00-plan-as-made');
    return [days.length === 30 && diffs.length === 0 && past.length === 9 && past.every((d) => d.planned > 0) && days.every((d) => !d.edited) && !!shown && same(marked, [T]) && ph1.length === 1 && ph1[0].name === 'Start to exam',
      { rows: days.length, pastDays: past.length, pastHours: past.map((d) => d.planned).join(' '), differs: diffs.slice(0, 3), edited: days.filter((d) => d.edited).length, tabShows: shown ? shown.length : null, marked, phases: ph1.map((x) => `${x.name} ${x.kind} ${x.start}..${x.end}`) }];
  });
  await check(c, '0.4', async () => {
    const { at } = await addRow(S, p.week.id, 'Lunch Break', weekValues(wk('Lunch Break', ['Mon', 'Wed', 'Fri', 'Sun'], 'Work', '', '', 1, 1, 1)));
    const rowsAt = await until(() => (fromTodayDiffs(ws, p, T).length ? null : Date.now()), 8000, 40);
    const tabOk = await until(async () => { const w = expectedDays(ws, p); return dayDiffs(((await tabDays(S, SP.start)) || []).filter((d) => d.date >= T), asTab(w.days, 'Standard').filter((d) => d.date >= T), ['type', 'phase', 'personal', 'work', 'total']).length ? null : Date.now(); }, 8000, 80);
    return [!!rowsAt && !!tabOk, { rowsMs: rowsAt ? rowsAt - at : null, tabMs: tabOk ? tabOk - at : null, differs: fromTodayDiffs(ws, p, T).slice(0, 3) }];
  });
  await check(c, '0.12', async () => {
    const d3 = addDays(T, -3);
    await addRow(S, A.log, 'Evening problems', { Date: `${d3}T19:00`, Minutes: 90 });
    const cell = await until(async () => { const x = await doneCells(S, SP.start, [d3, T]); return x && near(doneHours(x[d3]), 1.5, 0.001) ? x : null; }, 6000, 80);
    return [!!cell, cell || (await doneCells(S, SP.start, [d3, T]))];
  });
  await check(c, '0.13', async () => {
    const row = must(rulesIn(ws, p).week.find((w) => w.account === 'Personal' && w.days.includes('Sat')), 'the Week row that holds Saturday\'s personal hours');
    must(await openDb(S, p.week.id), 'the Week database open in the app');
    must(await until(async () => (await S.heads(p.week.id)).includes('Standard'), 5000), 'the headings of the Week table');
    const at = await typeCell(S, p.week.id, row.name, 'Standard', 7);
    const stored = await until(() => rulesIn(ws, p).week.find((w) => w.pageId === row.pageId)?.standard === 7, 3000, 20);
    await sleep(2000);
    const now = rulesIn(ws, p).week.find((w) => w.pageId === row.pageId);
    await closeTab(S, 'Week');
    return [!!at && !!stored && now.floor === row.floor && now.stretch === row.stretch, { was: `${row.floor}/${row.standard}/${row.stretch}`, is: `${now.floor}/${now.standard}/${now.stretch}` }];
  });
  await check(c, '0.5', async () => {
    let card = await startSession(S, 'Venter');
    const first = await answer(S, card, TYPED);
    await finishSession(S, await pressNext(S, card.stem));
    const row = await until(() => rowsOf(ws, A.log).find((r) => norm(r.title) === tabTitle('Venter') && num(r.values.Items) === 2), 6000);
    await S.shot('00-results');
    return [!!first.verdict && !!row && num(row.values.Minutes) >= 1, { verdict: first.verdict, logRow: row ? row.values : null }];
  });
  await check(c, '0.6', async () => {
    await fakeClock(S);
    const a = await S.today(); const t0 = Date.now();
    await S.page.clock.runFor(MIN);
    const real = Date.now() - t0; const b = await S.today();
    const card = await startSession(S, 'Clark');
    await answer(S, card, TYPED);
    await pass(S, 6, 1, ['key']);
    await endSession(S);
    const minutes = await loggedMinutes(S, A.log, 'Clark');
    return [Math.abs(b.ms - a.ms - MIN) < 20_000 + real && real < 20_000 && minutes >= 6 && minutes <= 8, { pageClockMovedMs: b.ms - a.ms, realMs: real, minutesLogged: minutes }];
  });
  await check(c, '0.7', async () => {
    const r = await findMatches(S);
    if (r.seen !== 'list') return [false, r];
    const mack = rowsFor(r.list, PAGES.mackPage); const clark = rowsFor(r.list, nameOf('clarkMd'));
    await S.shot('00-find-matches');
    // The keys: Tab from the search field into the list, the arrows to the row, Space.
    await S.page.keyboard.press('Tab');
    const activeRow = () => S.page.evaluate(() => { const a = document.activeElement; const id = a && a.getAttribute('aria-activedescendant'); const n = id ? document.getElementById(id) : null; return n ? (n.innerText || '').replace(/\s+/g, ' ').trim() : ''; });
    let on = false;
    for (let i = 0; i < r.list.length + 1; i++) { if ((await activeRow()).includes(nameOf('clarkMd'))) { await S.page.keyboard.press('Space'); await sleep(200); on = !!(await S.choices()).find((x) => lineIs(x, nameOf('clarkMd')))?.on; break; } await S.page.keyboard.press('ArrowDown'); await sleep(60); }
    await closeList(S);
    await sleep(800);
    const attached = Object.keys(PAPERS).filter((u) => !/^(\[\]|""|null|\s|\|)*$/.test(materialOf(ws, A.units, u)));
    return [mack.length === 1 && /\bMack\b/.test(mack[0].rest) && clark.length === 1 && /\bClark\b/.test(clark[0].rest) && r.list.every((x) => !x.on) && on && attached.length === 0,
      { proposals: r.list.map((x) => x.lines.join(' / ').slice(0, 70)), tickedByKeys: on, attachedAfterClosing: attached }];
  });
  await check(c, '0.9', async () => {
    const got = {};
    const more = await keysToUnitMore(S, 'Venter');
    got.moreActionsReached = !!more && more.hasRing;
    if (more) { await S.page.keyboard.press('Enter'); await sleep(400); got.byKeysItem = await arrowTo(S, /^Study…$/); if (got.byKeysItem) await S.page.keyboard.press('Enter'); }
    got.byKeys = !!more && !!(await until(() => sheetOpen(S), 4000));
    await cancelSheet(S);
    // By finger: a tap on the row's More Actions, a tap on the item.
    const again = must(await subjectPoint(S, 'Clark', { under: SUBJECT }), 'the unit Clark in the sidebar');
    await S.page.mouse.move(again.x, again.y);
    await sleep(250);
    const btn = (await S.find('sidebar', /^More Actions/i)).filter((h) => !h.disabled).sort((a, b) => Math.abs(a.y - again.y) - Math.abs(b.y - again.y))[0];
    await S.page.mouse.move(700, 600);
    if (btn && Math.abs(btn.y - again.y) <= 14) {
      await S.tap(btn); await sleep(500);
      const item = (await S.find('body', /^Study…$/, '[role="menuitem"]'))[0];
      if (item) { await S.tap(item); got.byFinger = !!(await until(() => sheetOpen(S), 4000)); } else got.byFinger = 'the menu did not open under the finger';
    } else got.byFinger = 'no More Actions beside the row';
    await cancelSheet(S);
    await S.page.keyboard.press('Escape');
    return [got.byKeys === true && got.byFinger === true, got];
  });
  await check(c, '0.11', async () => {
    await openSetup(S, 'Mack');
    const on = must(await tabTo(S, /^Practice$/, 12), 'the button "Practice" of the setup sheet, reached by Tab');
    await S.page.keyboard.press('Enter');
    await sleep(1200);
    const still = await sheetOpen(S); const card = await S.card();
    await S.page.keyboard.press('Escape');
    const closed = await sheetGone(S);
    return [still && !answerable(card) && !!closed, { focusWasOn: on.name, sheetStayed: still, sessionStarted: answerable(card), escapeClosed: !!closed }];
  });
  await check(c, '0.10', async () => {
    S.run('study.newSubject');
    must(await until(() => S.formOpen(), 6000), 'the New Subject sheet');
    await sleep(400);
    const folder = await S.field(/^sources folder\b/i); const q = await S.field(F.questions);
    const pick = async (f) => { if (!f) return []; if (f.options) return f.options; await S.click(f); await sleep(400); const o = (await S.find('body', /./, MENU_ITEMS)).filter((h) => h.y > 48).map((h) => h.name); await S.page.keyboard.press('Escape'); await sleep(200); return o; };
    const folders = await pick(folder); const banks = await pick(q);
    (await S.press('form', /^cancel$/i, 'button')) || (await S.page.keyboard.press('Escape'));
    await until(async () => !(await S.formOpen()), 3000);
    return [folders.includes('Readings') && folders.includes('Notes') && banks.length > 0, { sourcesFolder: folders.slice(0, 6), questions: banks.slice(0, 6) }];
  });
  await check(c, '0.8', async () => {
    await openUnit(S, 'Friedland');
    const row = must(rowTitled(ws, A.units, 'Friedland'), 'the row of Friedland in Units');
    must(await toTrash(S, row.pageId), 'the row of Friedland in the Trash');
    must(await showTab(S, tabTitle('Friedland')), 'the tab of Friedland');
    const said = await until(async () => (await S.seenText(GONE)) || null, 6000);
    await S.shot('00-gone-unit');
    const closed = await closeTab(S, tabTitle('Friedland'));
    return [!!said && closed, { says: (said || 'nothing on screen says so').slice(0, 140), closed }];
  });
  await check(c, '0.15', async () => {
    const { pageId: row } = await addRow(S, p.phases.id, 'Scratch Span', phaseValues(ph('Scratch Span', 'Catch-up', addDays(T, 15), addDays(T, 15))));
    await setProp(S, row, 'Kind', '');
    const emptied = await until(() => { const r = phaseRows(ws, p).find((x) => x.pageId === row); return r && !r.kind; }, 3000, 30);
    return [!!emptied, { selectEmptied: !!emptied }];
  });
  await check(c, '0.14', async () => {
    const ground = () => S.page.evaluate(() => { const m = /rgba?\(([^)]+)\)/.exec(getComputedStyle(document.body).backgroundColor); const q = m ? m[1].split(',').map(parseFloat) : [0, 0, 0]; return (q[0] + q[1] + q[2]) / 3; });
    await setMode(S, 'light'); const light = await ground();
    await setMode(S, 'dark'); const dark = await ground();
    return [light > 180 && dark < 80, { light, dark }];
  });
});

phase(1, 'Days gone by are never rewritten', 'plan', {
  '1.1': 'a Week row\'s hours typed in the table: today and the days after follow, the nine days before today keep their Type, Phase and hours, none marked Edited, in Days and in the tab',
  '1.2': 'a Week row added and another\'s days changed through the chat\'s tool: the same',
  '1.3': 'Phases rows added (a rest span and a study span that both begin before today and end after it): the days from today on take them, the days before keep their Type and Phase',
  '1.4': 'the exam date later, then earlier: days are added and taken away after today, the days before today stay',
  '1.5': 'the start date later, then earlier than it was: the rows of the days before today stay in Days as they were',
  '1.6': 'Running and Done still follow: a past day\'s hours changed by hand move Running of every day after it, and a Work Log row on a past date shows as its Done',
  '1.7': 'after the app was closed and opened the past days are as they were, and a rule changed then still leaves them',
  '1.8': 'two days on (the page\'s clock moved): a rule changed then leaves what are now past days, today and tomorrow of before among them, and changes the days from the new today on',
  '1.9': 'the tab says it in words: "Changes apply from today on"',
}, async (S, c, A) => {
  const ws = S.workspace;
  const T = (await S.today()).date;
  const SP = sprint(T);
  const p = mustPlan(ws, SP.name);
  await openPlan(S, SP.name);
  must(await tabShows(S, 30, SP.start), 'the tab showing the 30 days of the plan');
  const before = daysIn(ws, p);
  must(before.filter((d) => d.date < T).length === 9, 'nine days before today in Days');
  const todayRow = () => must(rulesIn(ws, p).week.find((w) => w.account === 'Personal' && w.days.includes(weekdayOf(T))), `the Week row that holds the personal hours of ${weekdayOf(T)}`);
  await check(c, '1.9', async () => { const t = await S.paneWords(); const m = /changes apply from today on/i.exec(t); return [!!m, m ? m[0] : t.slice(0, 160)]; });
  await check(c, '1.1', async () => {
    const row = todayRow();
    must(await openDb(S, p.week.id), 'the Week database open in the app');
    must(await until(async () => (await S.heads(p.week.id)).includes('Standard'), 5000), 'the headings of the Week table');
    const at = must(await typeCell(S, p.week.id, row.name, 'Standard', 7), 'an editor in the Standard cell');
    must(await until(() => rulesIn(ws, p).week.find((w) => w.pageId === row.pageId)?.standard === 7, 3000, 20), 'the 7 stored in Week');
    const r = await fromTodayOn(S, p, before, T, at, { tab: SP.name });
    await S.shot('01-after-week-change');
    return [keptAndFollowed(r), { row: row.name, ...r }];
  });
  await showTab(S, SP.name);
  await check(c, '1.2', async () => {
    const { at } = await addRow(S, p.week.id, 'Early Hour', weekValues(wk('Early Hour', WEEKDAYS, 'Work', '', '', 1, 1, 1)));
    const r1 = await fromTodayOn(S, p, before, T, at);
    const row = todayRow();
    const at2 = await setProp(S, row.pageId, 'Floor', 5);
    const r2 = await fromTodayOn(S, p, before, T, at2);
    return [keptAndFollowed(r1) && keptAndFollowed(r2), { added: r1, changed: r2 }];
  });
  await check(c, '1.3', async () => {
    await addRow(S, p.phases.id, 'Long Weekend', phaseValues(ph('Long Weekend', 'Rest', addDays(T, -4), addDays(T, 2))));
    const { at } = await addRow(S, p.phases.id, 'Warm Up', phaseValues(ph('Warm Up', 'Study', addDays(T, -12), addDays(T, 5))));
    const r = await fromTodayOn(S, p, before, T, at);
    const now = Object.fromEntries(daysIn(ws, p).filter((d) => [addDays(T, -1), T, addDays(T, 4)].includes(d.date)).map((d) => [d.date, `${d.type} / ${d.phase}`]));
    await S.shot('01-after-phases');
    return [keptAndFollowed(r) && now[T] === 'Rest / Warm Up' && now[addDays(T, 4)] === 'Study / Warm Up', { ...r, yesterdayTodayAndFourDaysOn: now }];
  });
  await check(c, '1.4', async () => {
    const planRow = rulesIn(ws, p).planRow.pageId;
    const at = await setProp(S, planRow, 'Exam Date', addDays(SP.exam, 7));
    const r1 = await fromTodayOn(S, p, before, T, at);
    const n1 = daysIn(ws, p).filter((d) => d.date >= T).length;
    const at2 = await setProp(S, planRow, 'Exam Date', addDays(SP.exam, -10));
    const r2 = await fromTodayOn(S, p, before, T, at2);
    const n2 = daysIn(ws, p).filter((d) => d.date >= T).length;
    return [keptAndFollowed(r1) && keptAndFollowed(r2) && n1 === 28 && n2 === 11, { later: r1, daysFromTodayThen: n1, earlier: r2, daysFromTodayNow: n2 }];
  });
  await check(c, '1.6', async () => {
    const d8 = addDays(T, -8); const d2 = addDays(T, -2);
    const row = must(daysIn(ws, p).find((d) => d.date === d8), `the Days row of ${d8}`);
    await setProp(S, row.pageId, 'Standard', 9);
    const running = () => { let sum = 0; return daysIn(ws, p).filter((d) => d.date >= rulesIn(ws, p).plan.start && d.date < rulesIn(ws, p).plan.exam).every((d) => { sum += d.planned; return Math.abs(d.running - sum) < 1e-9; }); };
    const ok = await until(() => { const d = daysIn(ws, p).find((x) => x.date === d8); return d && d.standard === 9 && d.planned === 9 + d.work && running(); }, 6000, 60);
    await addRow(S, A.log, 'Weekend reading', { Date: `${d2}T10:00`, Minutes: 120 });
    const done = await until(() => daysIn(ws, p).find((x) => x.date === d2)?.done === 2, 6000, 60);
    const cell = await until(async () => { const x = await doneCells(S, rulesIn(ws, p).plan.start, [d2]); return x && near(doneHours(x[d2]), 2, 0.001) ? x[d2] : null; }, 6000, 80);
    return [!!ok && !!done && !!cell, { runningIsTheSumOfPlanned: !!ok, doneInDays: daysIn(ws, p).find((x) => x.date === d2)?.done, doneInTheTab: cell }];
  });
  // From here on the day changed by hand above is his: it is left out of what "before" holds.
  const kept = before.filter((d) => d.date !== addDays(T, -8));
  await check(c, '1.5', async () => {
    const planRow = rulesIn(ws, p).planRow.pageId;
    const at = await setProp(S, planRow, 'Start Date', addDays(T, -3));
    const r1 = await fromTodayOn(S, p, kept, T, at);
    const at2 = await setProp(S, planRow, 'Start Date', addDays(T, -12));
    const r2 = await fromTodayOn(S, p, kept, T, at2);
    await setProp(S, planRow, 'Start Date', SP.start);
    await sleep(2500);
    return [keptAndFollowed(r1) && keptAndFollowed(r2), { later: r1, earlier: r2 }];
  });
  await check(c, '1.7', async () => {
    await S.relaunch();
    await openPlan(S, SP.name);
    must(await until(async () => ((await tabDays(S, SP.start)) || []).length > 0, 15_000), 'the plan\'s tab showing days after the restart');
    await sleep(3000);
    const past = pastChanged(kept, daysIn(ws, p), T);
    const { at } = await addRow(S, p.week.id, 'Late Hour', weekValues(wk('Late Hour', WEEKDAYS, 'Personal', '', '', 1, 1, 1)));
    const r = await fromTodayOn(S, p, kept, T, at);
    return [past.length === 0 && keptAndFollowed(r), { pastChangedByTheRestart: past.slice(0, 3), afterARuleChange: r }];
  });
  await check(c, '1.8', async () => {
    // What every day holds now, the day before the clock is moved.
    const asNow = daysIn(ws, p);
    const now = await S.today();
    await S.page.clock.install({ time: new Date(now.ms + 2 * DAY_MS) });
    S.clockOn = true;
    const T2 = (await S.today()).date;
    must(T2 === addDays(T, 2), `the page's clock two days on (it gives ${T2})`);
    const { at } = await addRow(S, p.week.id, 'Night Hour', weekValues(wk('Night Hour', WEEKDAYS, 'Work', '', '', 2, 2, 2)));
    const rowsAt = await until(() => (fromTodayDiffs(ws, p, T2).length ? null : Date.now()), 8000, 40);
    await sleep(1500);
    const past = pastChanged(asNow.filter((d) => d.date !== addDays(T, -8)), daysIn(ws, p), T2);
    return [!!rowsAt && past.length === 0, { newToday: T2, followedMs: rowsAt ? rowsAt - at : null, fromTheNewTodayDiffers: fromTodayDiffs(ws, p, T2).slice(0, 3), pastChanged: past.slice(0, 4) }];
  });
}, ['1.6']);

phase(2, 'A phase can follow the exam', 'bank', {
  '2.1': 'the New Plan sheet asks "Days off before the exam", 0 to begin with',
  '2.2': 'Phases has the column Follows (a select: Whole plan, Before exam); with no days off Create makes the one phase "Start to exam", which follows Whole plan',
  '2.3': 'with 3 days off Create also makes the Rest phase "Days off", which follows Before exam: the three days before the exam, at no hours, and the tab lists it',
  '2.4': 'the exam date moved later: both phases move within 2 s in the Phases rows and in the tab, and the days follow (the times are printed)',
  '2.5': 'the exam date moved earlier, right after: the same',
  '2.6': 'the start date moved: "Start to exam" starts there, "Days off" stays',
  '2.7': 'a phase he adds with Follows Before exam keeps its length and ends the day before the exam; one with Whole plan gets the plan\'s dates; one with Follows empty keeps its own dates; the exam moved, each does the same again',
  '2.8': 'a dated phase the new dates leave outside the plan is named in "Rules that disagree"',
  '2.9': 'study days no Study phase holds are named in "Rules that disagree" (how many, or from which day)',
  '2.10': 'after the app was closed and opened, the exam date moved: both phases still follow',
}, async (S, c) => {
  const ws = S.workspace;
  const T = (await S.today()).date;
  const A0 = ahead(T, 'Plain Block');
  const A3 = ahead(T, 'Tapered Block', 3);
  await check(c, '2.1', async () => {
    await openPlanSheet(S);
    const f = await S.field(DAYS_OFF);
    await S.shot('02-new-plan-sheet');
    (await S.press('form', /^cancel$/i, 'button')) || (await S.page.keyboard.press('Escape'));
    await until(async () => !(await S.formOpen()), 3000);
    return [!!f && Number(f.value) === 0 && String(f.value) !== '', f ? { label: f.label, value: f.value } : { fields: 'no field named "Days off before the exam"' }];
  });
  let p0 = null; let p0Err = '';
  try { p0 = await makePlanWith(S, A0); } catch (err) { p0Err = String((err && err.message) || err).slice(0, 240); }
  await check(c, '2.2', async () => {
    if (!p0) throw new Error(p0Err);
    const follows = col(columns(ws, p0.phases.id), 'Follows');
    const opts = (follows?.config?.options || []).map((o) => o.value ?? o.name ?? o);
    const rows = phaseRows(ws, p0);
    const one = rows[0] || {};
    return [!!follows && follows.type === 'select' && same(opts, ['Whole plan', 'Before exam']) && rows.length === 1 && one.name === 'Start to exam' && one.kind === 'Study' && one.follows === 'Whole plan' && one.start === A0.start && one.end === addDays(A0.exam, -1),
      { follows: follows ? `${follows.type}: ${opts.join(', ')}` : 'no column Follows', rows: rows.map((r) => `${r.name} ${r.kind} ${r.start}..${r.end} follows ${r.follows || 'nothing'}`) }];
  });
  let p3 = null; let p3Err = '';
  try { p3 = await makePlanWith(S, A3); } catch (err) { p3Err = String((err && err.message) || err).slice(0, 240); }
  const plan3 = () => { if (!p3) throw new Error(p3Err); return p3; };
  /** Both phases of the tapered plan as the exam date `exam` and the start date `start` want them. */
  const bothAt = (start, exam) => { const a = phaseNamed(ws, p3, 'Start to exam'); const b = phaseNamed(ws, p3, 'Days off'); return !!a && !!b && a.start === start && a.end === addDays(exam, -1) && b.start === addDays(exam, -3) && b.end === addDays(exam, -1); };
  const tabPhases = async (names, start, exam) => { const part = await S.region(/^phases\b/i); if (!part) return false; return names.every((n) => { const r = part.rows.find((x) => x.text.includes(n)); const w = n === 'Days off' ? [addDays(exam, -3), addDays(exam, -1)] : [start, addDays(exam, -1)]; return !!r && dateWords(w[0]).test(r.text) && dateWords(w[1]).test(r.text); }); };
  /** The exam or the start date set through the chat's tool; how long until the Phases rows, the tab and the days have followed. */
  const move = async (column, value, start, exam) => {
    const t0 = await setProp(S, rulesIn(ws, p3).planRow.pageId, column, value);
    const rowsAt = await until(() => (bothAt(start, exam) ? Date.now() : null), 8000, 40);
    const tabAt = await until(async () => ((await tabPhases(['Start to exam', 'Days off'], start, exam)) ? Date.now() : null), 8000, 60);
    const days = await follows(S, p3, t0);
    const last3 = daysIn(ws, p3).slice(-3);
    return { phasesMs: rowsAt ? rowsAt - t0 : null, tabMs: tabAt ? tabAt - t0 : null, daysMs: days.rowsMs, daysTabMs: days.tabMs, days: days.days, lastThree: last3.map((d) => `${d.date} ${d.type} ${d.planned} h`).join(', '), rows: phaseRows(ws, p3).map((r) => `${r.name} ${r.start}..${r.end}`) };
  };
  const moved = (r, n, exam) => r.phasesMs !== null && r.phasesMs <= 2000 && r.tabMs !== null && r.tabMs <= 2000 && r.daysMs !== null && r.daysMs <= 2000 && r.daysTabMs !== null && r.daysTabMs <= 2000 && r.days === n && daysIn(ws, p3).slice(-3).every((d, i) => d.date === addDays(exam, i - 3) && d.type === 'Rest' && d.planned === 0);
  await check(c, '2.3', async () => {
    plan3();
    const rows = phaseRows(ws, p3); const off = phaseNamed(ws, p3, 'Days off');
    const last3 = daysIn(ws, p3).slice(-3);
    const inTab = await until(() => tabPhases(['Start to exam', 'Days off'], A3.start, A3.exam), 5000);
    await S.shot('02-tapered-plan');
    return [rows.length === 2 && bothAt(A3.start, A3.exam) && off.kind === 'Rest' && off.follows === 'Before exam' && phaseNamed(ws, p3, 'Start to exam').follows === 'Whole plan' && last3.every((d) => d.type === 'Rest' && d.planned === 0) && !!inTab,
      { rows: rows.map((r) => `${r.name} ${r.kind} ${r.start}..${r.end} follows ${r.follows || 'nothing'}`), lastThreeDays: last3.map((d) => `${d.date} ${d.type} ${d.planned} h`), tabListsBoth: !!inTab }];
  });
  let exam = A3.exam; let start = A3.start;
  await check(c, '2.4', async () => { plan3(); exam = addDays(A3.exam, 5); const r = await move('Exam Date', exam, start, exam); return [moved(r, 47, exam), r]; });
  await check(c, '2.5', async () => { plan3(); exam = addDays(A3.exam, -9); const r = await move('Exam Date', exam, start, exam); return [moved(r, 33, exam), r]; });
  await check(c, '2.6', async () => { plan3(); start = addDays(A3.start, 4); const r = await move('Start Date', start, start, exam); return [moved(r, 29, exam), r]; });
  await check(c, '2.7', async () => {
    plan3();
    await addRow(S, p3.phases.id, 'Final Push', { ...phaseValues(ph('Final Push', 'Study', addDays(start, 2), addDays(start, 6))), Follows: 'Before exam' });
    await addRow(S, p3.phases.id, 'All Through', { ...phaseValues(ph('All Through', 'Catch-up', addDays(start, 9), addDays(start, 9))), Follows: 'Whole plan' });
    const { at } = await addRow(S, p3.phases.id, 'Mock Sitting', phaseValues(ph('Mock Sitting', 'Catch-up', addDays(exam, -6), addDays(exam, -6))));
    const mock = addDays(exam, -6);
    const asWanted = (ex) => { const a = phaseNamed(ws, p3, 'Final Push'); const b = phaseNamed(ws, p3, 'All Through'); const m = phaseNamed(ws, p3, 'Mock Sitting'); return !!a && !!b && !!m && a.start === addDays(ex, -5) && a.end === addDays(ex, -1) && b.start === start && b.end === addDays(ex, -1) && m.start === mock && m.end === mock && bothAt(start, ex); };
    const firstAt = await until(() => (asWanted(exam) ? Date.now() : null), 8000, 40);
    const rows1 = phaseRows(ws, p3).map((r) => `${r.name} ${r.start}..${r.end}`);
    exam = addDays(exam, 3);
    const t0 = await setProp(S, rulesIn(ws, p3).planRow.pageId, 'Exam Date', exam);
    const againAt = await until(() => (asWanted(exam) ? Date.now() : null), 8000, 40);
    return [!!firstAt && firstAt - at <= 2000 && !!againAt && againAt - t0 <= 2000, { addedMs: firstAt ? firstAt - at : null, afterAdding: rows1, examMovedMs: againAt ? againAt - t0 : null, afterTheExamMoved: phaseRows(ws, p3).map((r) => `${r.name} ${r.start}..${r.end}`) }];
  });
  await check(c, '2.8', async () => {
    plan3();
    const named = async () => { const part = await S.region(/rules that disagree/i); return part ? (part.rows.find((r) => r.text.includes('Mock Sitting') && /outside/i.test(r.text))?.text || '') : ''; };
    must(phaseNamed(ws, p3, 'Mock Sitting'), 'the dated phase "Mock Sitting" of the check before');
    const beforeMove = await named();
    exam = addDays(phaseNamed(ws, p3, 'Mock Sitting').start, -2);
    await setProp(S, rulesIn(ws, p3).planRow.pageId, 'Exam Date', exam);
    const said = await until(async () => (await named()) || null, 6000, 80);
    await S.shot('02-rules-that-disagree');
    return [!beforeMove && !!said, { before: beforeMove || 'not named', after: said || ((await S.region(/rules that disagree/i))?.text || 'no part "Rules that disagree"').slice(0, 200) }];
  });
  await check(c, '2.9', async () => {
    if (!p0) throw new Error(p0Err);
    await openPlan(S, A0.name);
    must(await tabShows(S, 42, A0.start), 'the tab of the plain plan showing its 42 days');
    const row = must(phaseNamed(ws, p0, 'Start to exam'), 'the phase "Start to exam"');
    // Named: a row of the part that has the word "phase" and says which days, by their number ("6 study days") or by the first of them.
    const named = async (n, firstDate) => { const part = await S.region(/rules that disagree/i); if (!part) return ''; const re = n === null ? /\d+\s+(study\s+)?days?(?![a-z])/i : new RegExp(`(?<![\\d.])${n}\\s+(study\\s+)?days?(?![a-z])`, 'i'); return part.rows.find((r) => /\bphase\b/i.test(r.text) && (re.test(r.text) || (!!firstDate && dateWords(firstDate).test(r.text))))?.text || ''; };
    const beforeMove = await named(null, '');
    // The tool answers "set" for a column that is not there too, so the file is asked.
    await setProp(S, row.pageId, 'Follows', '');
    must(col(columns(ws, p0.phases.id), 'Follows') && await until(() => phaseNamed(ws, p0, 'Start to exam')?.follows === '', 3000, 40), 'the Follows of "Start to exam" emptied in Phases');
    await sleep(800);
    const t0 = await setProp(S, rulesIn(ws, p0).planRow.pageId, 'Exam Date', addDays(A0.exam, 7));
    await follows(S, p0, t0);
    const looseDays = expectedDays(ws, p0).days.filter((d) => d.planned > 0 && !d.phase);
    const loose = looseDays.length;
    const said = await until(async () => (await named(loose, looseDays[0]?.date)) || null, 6000, 80);
    const kept = phaseNamed(ws, p0, 'Start to exam');
    return [!beforeMove && loose === 6 && !!said && kept.end === addDays(A0.exam, -1), { before: beforeMove || 'not named', studyDaysInNoPhase: loose, after: said || ((await S.region(/rules that disagree/i))?.text || 'no part "Rules that disagree"').slice(0, 200), phaseNowDated: `${kept.start}..${kept.end}` }];
  });
  await check(c, '2.10', async () => {
    plan3();
    await S.relaunch();
    await openPlan(S, A3.name);
    must(await until(async () => ((await tabDays(S, start)) || []).length > 0, 15_000), 'the tapered plan\'s tab showing days after the restart');
    exam = addDays(A3.exam, 2);
    const r = await move('Exam Date', exam, start, exam);
    return [r.phasesMs !== null && r.phasesMs <= 2000 && r.tabMs !== null && r.tabMs <= 2000, r];
  });
});

phase(3, 'New Subject with a sources folder and a question bank; Remove Unit…; a unit that is gone', 'seed', {
  '3.1': 'one unit per paper: the five of the bank and the two files that match none, seven in all, none twice',
  '3.2': 'a file whose name holds a bank unit\'s name as whole words joins that unit: it is in the unit\'s Material and its name without the extension in Also Called',
  '3.3': 'a file that matches no bank unit ("Mackenzie 2001 - Notes.pdf" beside the unit Mack) is its own unit and holds its file in Material; the bank\'s units keep their questions',
  '3.4': 'a unit\'s tab lists its PDF, for a unit of the bank and for a unit made from a file, and one press opens it',
  '3.5': 'a unit row\'s More Actions has "Remove Unit…"',
  '3.6': 'it asks first, naming the unit, and Cancel leaves the unit as it was',
  '3.7': 'confirmed, the unit\'s row is in the Trash and the unit is gone from the sidebar; its questions and its file stay, the other units are untouched',
  '3.8': 'the tab of a unit removed that way says so and can be closed (or has closed by itself)',
  '3.9': 'a unit\'s row put in the Trash in Units with its tab open: the tab says so and can be closed',
  '3.10': 'after the app was closed and opened, a tab of a unit that is gone says so and can be closed (or has not come back), and nothing errors',
}, async (S, c) => {
  const ws = S.workspace;
  await makeSubject(S, { name: SUBJECT, questions: BANK, folder: 'Readings' });
  const subj = await settledSubject(S, SUBJECT);
  const U = subj.units.id;
  await showStudySidebar(S);
  await sleep(1500);
  await S.shot('03-subject-made');
  await check(c, '3.1', async () => {
    const titles = unitTitles(ws, U);
    return [same([...titles].sort(), [...UNITS_WITH_FOLDER].sort()), { units: titles }];
  });
  await check(c, '3.2', async () => {
    const got = {};
    for (const [key, unit] of Object.entries(JOINS)) {
      const row = rowTitled(ws, U, unit);
      got[unit] = { inMaterial: unitHolds(ws, U, unit, key), inAlsoCalled: !!row && low(row.values['Also Called']).includes(low(stemOf(key))) };
    }
    const mackAlso = norm(rowTitled(ws, U, 'Mack')?.values['Also Called']);
    return [Object.values(got).every((g) => g.inMaterial && g.inAlsoCalled) && !/\.pdf\b/i.test(mackAlso), { ...got, mackAlsoCalled: mackAlso.slice(0, 120) }];
  });
  await check(c, '3.3', async () => {
    const got = {};
    for (const key of OWN) got[stemOf(key)] = { isAUnit: !!rowTitled(ws, U, stemOf(key)), holdsItsFile: unitHolds(ws, U, stemOf(key), key) };
    const mackHasMackenzie = unitHolds(ws, U, 'Mack', 'mackenziePdf');
    const counts = Object.fromEntries(Object.keys(PAPERS).map((u) => [u, num(rowTitled(ws, U, u)?.values.Questions)]));
    return [Object.values(got).every((g) => g.isAUnit && g.holdsItsFile) && !mackHasMackenzie && same(counts, PAPERS), { ...got, mackHoldsMackenziesFile: mackHasMackenzie, questions: counts }];
  });
  await check(c, '3.4', async () => {
    const got = {};
    for (const [unit, key] of [['Mack', 'mackPdf'], [stemOf('brosiusPdf'), 'brosiusPdf']]) {
      await openUnit(S, unit);
      const r = await waitTab(S, (g, it) => !!itemOf(it, nameOf(key)), 5000);
      const it = itemOf(r.items, nameOf(key));
      let opened = false;
      if (it) { await S.click(it.open); opened = !!(await until(async () => { const a = await S.active(); return a && a.file === path.join(ws, FILES[key]) ? a : null; }, 5000)); }
      got[unit.slice(0, 24)] = { listed: !!it, opened, lists: notesTitles(r.items).join(', ').slice(0, 100) };
      if (opened) await closeFront(S);
    }
    await S.shot('03-unit-tab');
    return [Object.values(got).every((g) => g.listed && g.opened), got];
  });
  let item = null;
  await check(c, '3.5', async () => {
    const items = must(await unitMenu(S, 'Friedland'), 'the More Actions menu of the unit Friedland');
    item = items.find((i) => i.name === 'Remove Unit…') || null;
    await S.shot('03-unit-menu');
    if (!item) await S.page.keyboard.press('Escape');
    return [!!item, { menu: items.map((i) => i.name) }];
  });
  const CONFIRM_REMOVE = /^(Remove|Remove Unit|Move to Trash)$/;
  /** "Remove Unit…" of a unit, pressed: the question it asks, or a stop. */
  const askRemove = async (unit) => {
    const items = must(await unitMenu(S, unit), `the More Actions menu of the unit ${unit}`);
    const it = items.find((i) => i.name === 'Remove Unit…');
    if (!it) { await S.page.keyboard.press('Escape'); throw new Error(`no "Remove Unit…" in the unit's More Actions (it has: ${items.map((i) => i.name).join(', ')})`); }
    await S.click(it);
    must(await until(() => S.formOpen(), 4000), 'a question after "Remove Unit…"');
    await sleep(300);
    return norm(await S.formText());
  };
  await check(c, '3.6', async () => {
    if (!item) throw new Error('no "Remove Unit…" in the unit\'s More Actions');
    await S.click(item);
    const asked = await until(() => S.formOpen(), 4000);
    const words = norm(await S.formText());
    await S.shot('03-remove-unit-question');
    const cancel = await S.press('form', /^Cancel$/, 'button');
    await until(async () => !(await S.formOpen()), 3000);
    await sleep(1200);
    const row = rowTitled(ws, U, 'Friedland');
    const side = (await subjectsText(S)) || '';
    return [!!asked && /Friedland/.test(words) && !!cancel && !!row && side.includes('Friedland'), { asked: words.slice(0, 200), cancelThere: !!cancel, unitStillInUnits: !!row, stillInTheSidebar: side.includes('Friedland') }];
  });
  await check(c, '3.7', async () => {
    const bankId = must(databases(ws).find((d) => d.title === BANK), 'the bank').id;
    const questions = () => rowsOf(ws, bankId).filter((r) => r.values.Paper === 'Friedland').length;
    const brosius = stemOf('brosiusPdf'); const file = path.join(ws, FILES.brosiusPdf); const hash = sha(file);
    const ids = { Friedland: must(rowTitled(ws, U, 'Friedland'), 'the row of Friedland').pageId, [brosius]: must(rowTitled(ws, U, brosius), `the row of ${brosius}`).pageId };
    const others = () => JSON.stringify(rowsOf(ws, U).filter((r) => !Object.values(ids).includes(r.pageId)).map((r) => [r.title, r.raw['Also Called'], r.raw.Material]));
    const othersBefore = others(); const all = rowsOf(ws, bankId).length;
    const got = {};
    for (const unit of ['Friedland', brosius]) {
      await askRemove(unit);
      must(await S.press('form', CONFIRM_REMOVE, 'button'), `a button that confirms (the question shows: ${norm(await S.formText()).slice(0, 120)})`);
      await until(async () => !(await S.formOpen()), 3000);
      const trashed = await until(() => pageRow(ws, ids[unit])?.is_archived === 1, 5000);
      const goneFromSide = await until(async () => !((await subjectsText(S)) || '').includes(unit), 5000);
      got[unit.slice(0, 24)] = { rowInTheTrash: !!trashed, rowStillExists: !!pageRow(ws, ids[unit]), goneFromTheSidebar: !!goneFromSide };
    }
    await sleep(1000);
    return [Object.values(got).every((g) => g.rowInTheTrash && g.rowStillExists && g.goneFromTheSidebar) && questions() === PAPERS.Friedland && rowsOf(ws, bankId).length === all && sha(file) === hash && others() === othersBefore,
      { ...got, friedlandsQuestions: questions(), bankRows: [all, rowsOf(ws, bankId).length], fileUntouched: sha(file) === hash, otherUnitsUntouched: others() === othersBefore }];
  });
  await check(c, '3.8', async () => {
    await openUnit(S, 'Clark');
    await askRemove('Clark');
    must(await S.press('form', CONFIRM_REMOVE, 'button'), 'a button that confirms');
    await until(async () => !(await S.formOpen()), 3000);
    must(await until(() => !rowTitled(ws, U, 'Clark'), 5000), 'the row of Clark out of Units');
    await sleep(1200);
    if (!(await tabTitled(S, tabTitle('Clark'))).length) return [true, 'the tab closed by itself'];
    await showTab(S, tabTitle('Clark'));
    const said = await until(async () => (await S.seenText(GONE)) || null, 6000);
    const closed = await closeTab(S, tabTitle('Clark'));
    return [!!said && closed, { says: (said || 'nothing on screen says so').slice(0, 140), closed }];
  });
  await check(c, '3.9', async () => {
    await openUnit(S, 'Mack');
    await openUnit(S, 'Venter');
    must(await toTrash(S, must(rowTitled(ws, U, 'Venter'), 'the row of Venter in Units').pageId), 'the row of Venter in the Trash');
    must(await showTab(S, tabTitle('Venter')), 'the tab of Venter');
    const said = await until(async () => (await S.seenText(GONE)) || null, 6000);
    await S.shot('03-gone-unit');
    return [!!said, { says: (said || 'nothing on screen says so').slice(0, 140) }];
  });
  await check(c, '3.10', async () => {
    // The tabs of Mack (a unit that is there) and of Venter (gone) are open as the app closes, Venter's in front.
    // Mack's coming back shows the app did bring its tabs back; Venter's must then say so, or be left out on purpose.
    const had = { mack: (await tabTitled(S, tabTitle('Mack'))).length, venter: (await tabTitled(S, tabTitle('Venter'))).length };
    must(had.mack === 1 && had.venter === 1, `the tabs of Mack and of Venter open before the restart (${JSON.stringify(had)})`);
    await sleep(3500);                                // the workbench stores its open tabs a moment after they change
    const errorsBefore = pageErrors.length;
    await S.relaunch();
    must(await until(async () => (await tabTitled(S, tabTitle('Mack'))).length === 1, 10_000), 'the tab of Mack back after the restart (the app brings its tabs back)');
    await sleep(2500);
    const back = (await tabTitled(S, tabTitle('Venter'))).length;
    if (!back) return [pageErrors.length === errorsBefore, { after: 'the tab of Mack came back, the tab of the unit that is gone did not', newPageErrors: pageErrors.length - errorsBefore }];
    await showTab(S, tabTitle('Venter'));
    const said = await until(async () => (await S.seenText(GONE)) || null, 10_000);
    await S.shot('03-gone-unit-after-restart');
    const closed = await closeTab(S, tabTitle('Venter'));
    return [!!said && closed && pageErrors.length === errorsBefore, { says: (said || 'nothing on screen says so').slice(0, 140), closed, newPageErrors: pageErrors.length - errorsBefore }];
  });
}, ['3.9']);

phase(4, 'Find Matches… proposes more', 'bank', {
  '4.1': 'the request\'s three are listed for their units: "mack summary.md" and the Mack PDF for Mack, the page "Venter - my notes" for Venter',
  '4.2': 'each of those rows says why: "name holds Mack", "name holds Venter"',
  '4.3': 'an Also Called name and any letter case count: the page "chain ladder worked example" for Mack ("holds Chain Ladder"), "CLARK - outline.txt" for Clark, the two-word unit\'s PDF for it',
  '4.4': 'whole words only: nothing is proposed for "Mackenzie 2001 - Notes.pdf", "Mackenzie review.md", "Unmacked thoughts", "Grocery list.txt", "Reading Log" or the Brosius PDF',
  '4.5': 'the exact names come first, and every row is unticked',
  '4.6': 'with the exact ones attached, Find Matches… still opens its list, with what is left to propose',
  '4.7': 'Attach Selected attaches the ticked ones to their units and nothing else, and they are not proposed again',
  '4.8': 'with everything attached it says so in words and opens no list',
}, async (S, c, A) => {
  const ws = S.workspace;
  const U = A.units;
  const HOLD = { [nameOf('mackMd')]: ['Mack', 'Mack'], [nameOf('mackPdf')]: ['Mack', '(Mack|Chain Ladder)'], [PAGES.venterNotes]: ['Venter', 'Venter'], [PAGES.chain]: ['Mack', 'Chain Ladder'], [nameOf('clarkTxt')]: ['Clark', 'Clark'], [nameOf('bfPdf')]: [BF, BF], [nameOf('clarkPdf')]: ['Clark', 'Clark'], [nameOf('venterPdf')]: ['Venter', 'Venter'] };
  const EXACT = { [PAGES.mackPage]: 'Mack', [nameOf('clarkMd')]: 'Clark' };
  const NEVER = [nameOf('mackenziePdf'), nameOf('mackenzieMd'), PAGES.unmacked, nameOf('groceryTxt'), PAGES.log, nameOf('brosiusPdf')];
  const first = await findMatches(S);
  const list = first.list;
  console.log(`   proposals: ${list.map((ch) => ch.lines.join(' / ').slice(0, 80)).join(' | ') || first.said || 'none'}`);
  await S.shot('04-find-matches');
  /** Is `title` proposed for `unit`, and does its row say it holds `held`? */
  const row = (title, unit, held) => { const r = rowsFor(list, title)[0]; return { listed: !!r, unit: !!r && new RegExp(`(?<![A-Za-z])${esc(unit)}(?![A-Za-z])`).test(r.rest), why: !!r && new RegExp(`\\bholds\\s+["“'‘]?${held}(?![A-Za-z])`, 'i').test(r.rest), says: r ? r.rest.slice(0, 80) : null }; };
  const THREE = [nameOf('mackMd'), nameOf('mackPdf'), PAGES.venterNotes];
  await check(c, '4.1', async () => { const got = Object.fromEntries(THREE.map((t) => [t.slice(0, 30), row(t, ...HOLD[t])])); return [Object.values(got).every((g) => g.listed && g.unit), got]; });
  await check(c, '4.2', async () => { const got = Object.fromEntries(THREE.map((t) => [t.slice(0, 30), row(t, ...HOLD[t])])); return [Object.values(got).every((g) => g.listed && g.why), Object.fromEntries(Object.entries(got).map(([k, g]) => [k, g.says]))]; });
  await check(c, '4.3', async () => {
    const got = Object.fromEntries([PAGES.chain, nameOf('clarkTxt'), nameOf('bfPdf')].map((t) => [t.slice(0, 30), row(t, ...HOLD[t])]));
    return [Object.values(got).every((g) => g.listed && g.unit && g.why), got];
  });
  await check(c, '4.4', async () => {
    const wrong = NEVER.filter((t) => rowsFor(list, t).length);
    const holdRows = Object.keys(HOLD).filter((t) => rowsFor(list, t).length).length;
    return [holdRows === Object.keys(HOLD).length && wrong.length === 0 && list.length === Object.keys(HOLD).length + Object.keys(EXACT).length, { proposedThoughNoWholeWordMatches: wrong, rows: list.length, wanted: Object.keys(HOLD).length + Object.keys(EXACT).length }];
  });
  await check(c, '4.5', async () => {
    const exactAt = Object.keys(EXACT).map((t) => rowsFor(list, t)[0]?.at ?? -1);
    const holdAt = Object.keys(HOLD).map((t) => rowsFor(list, t)[0]?.at ?? -1).filter((i) => i >= 0);
    return [exactAt.every((i) => i >= 0) && holdAt.length === Object.keys(HOLD).length && Math.max(...exactAt) < Math.min(...holdAt) && list.every((ch) => !ch.on), { exactAt, holdsAt: holdAt, ticked: list.filter((ch) => ch.on).length }];
  });
  if (first.seen === 'list') await closeList(S);
  const attachedTo = (unit, title) => { const key = Object.keys(FILES).find((k) => nameOf(k) === title); return key ? unitHolds(ws, U, unit, key) : holds(materialOf(ws, U, unit), [pageId(ws, title)]); };
  await check(c, '4.6', async () => {
    await attachTicked(S, Object.keys(EXACT));
    must(await until(() => Object.entries(EXACT).every(([t, u]) => attachedTo(u, t)), 4000), 'the two exact matches attached');
    const again = await findMatches(S);
    const titles = again.list.map((ch) => norm(ch.lines[0]));
    if (again.seen === 'list') await closeList(S);
    return [again.seen === 'list' && Object.keys(HOLD).every((t) => rowsFor(again.list, t).length === 1) && Object.keys(EXACT).every((t) => !rowsFor(again.list, t).length), { opened: again.seen, said: again.said, rows: titles }];
  });
  await check(c, '4.7', async () => {
    const pick = [nameOf('mackMd'), PAGES.venterNotes];
    await attachTicked(S, pick);
    const ok = await until(() => pick.every((t) => attachedTo(HOLD[t][0], t)), 4000);
    const others = Object.keys(HOLD).filter((t) => !pick.includes(t) && attachedTo(HOLD[t][0], t));
    const again = await findMatches(S);
    const stillProposed = pick.filter((t) => rowsFor(again.list, t).length);
    if (again.seen === 'list') await closeList(S);
    return [!!ok && others.length === 0 && again.seen === 'list' && stillProposed.length === 0 && again.list.length === Object.keys(HOLD).length - 2, { attached: !!ok, attachedThoughNotTicked: others, proposedAgain: stillProposed, rowsLeft: again.list.length }];
  });
  await check(c, '4.8', async () => {
    const rest = Object.keys(HOLD).filter((t) => !attachedTo(HOLD[t][0], t));
    await attachTicked(S, rest);
    must(await until(() => Object.keys(HOLD).every((t) => attachedTo(HOLD[t][0], t)), 5000), 'every proposal attached');
    const again = await findMatches(S);
    if (again.seen === 'list') await closeList(S);
    return [again.seen === 'said' && wordsOf(again.said).length >= 4, { opened: again.seen, said: again.said.slice(0, 160), rows: again.list.length }];
  });
});

phase(5, 'Today\'s Done shows today', 'plan', {
  '5.1': 'a study session finished now shows in today\'s Done within 2 s, in Days and in the tab, in minutes ("4 min"; the times are printed)',
  '5.2': 'less than 0.1 h is said in minutes on a past day too ("2 min"), and a single minute is not "0"',
  '5.3': 'more work today adds up: 90 minutes more read as hours on today\'s row within 2 s',
  '5.4': 'after the app was closed and opened, today\'s row still shows its Done',
}, async (S, c, A) => {
  const ws = S.workspace;
  const T = (await S.today()).date;
  const SP = sprint(T);
  const p = mustPlan(ws, SP.name);
  await openPlan(S, SP.name);
  must(await tabShows(S, 30, SP.start), 'the tab showing the 30 days of the plan');
  const doneIn = (date) => daysIn(ws, p).find((d) => d.date === date)?.done ?? null;
  const cellOf = async (date) => (await doneCells(S, SP.start, [date]))?.[date] ?? null;
  let sessionMinutes = 0;
  await check(c, '5.1', async () => {
    await fakeClock(S);
    let card = await startSession(S, 'Venter');
    await answer(S, card, TYPED);
    await pass(S, 3, 1, ['key']);
    const t0 = await finishSession(S, await pressNext(S, card.stem));
    const rowsAt = await until(() => (doneIn(T) > 0 ? Date.now() : null), 6000, 40);
    await showTab(S, SP.name);
    const tabAt = await until(async () => (doneHours(await cellOf(T)) > 0 ? Date.now() : null), 6000, 60);
    sessionMinutes = (await loggedMinutes(S, A.log, 'Venter')) || 0;
    await sleep(400);
    const cell = await cellOf(T);
    await S.shot('05-today-done');
    const m = /^(\d+)\s*min$/i.exec(norm(cell));
    return [!!rowsAt && rowsAt - t0 <= 2000 && !!tabAt && tabAt - t0 <= 2000 && sessionMinutes >= 3 && sessionMinutes <= 5 && !!m && Number(m[1]) === sessionMinutes && near(doneIn(T), sessionMinutes / 60, 0.011),
      { minutesLogged: sessionMinutes, doneInDays: doneIn(T), daysMs: rowsAt ? rowsAt - t0 : null, todaysDoneInTheTab: cell === null ? 'no Done column' : cell || 'empty', tabMs: tabAt ? tabAt - t0 : null }];
  });
  await check(c, '5.2', async () => {
    const d2 = addDays(T, -2); const d4 = addDays(T, -4);
    await addRow(S, A.log, 'A look at the notes', { Date: `${d2}T07:10`, Minutes: 2 });
    await addRow(S, A.log, 'One card', { Date: `${d4}T07:10`, Minutes: 1 });
    await showTab(S, SP.name);
    const ok = await until(async () => { const x = await doneCells(S, SP.start, [d2, d4]); return x && /^2\s*min$/i.test(norm(x[d2])) && /^1\s*min$/i.test(norm(x[d4])) ? x : null; }, 6000, 80);
    const got = ok || (await doneCells(S, SP.start, [d2, d4]));
    return [!!ok, { twoMinutes: got?.[d2], oneMinute: got?.[d4], inDays: [doneIn(d2), doneIn(d4)] }];
  });
  await check(c, '5.3', async () => {
    const had = doneHours(await cellOf(T));
    const { at } = await addRow(S, A.log, 'Afternoon problems', { Date: `${T}T00:20`, Minutes: 90 });
    const want = (sessionMinutes + 90) / 60;
    const tabAt = await until(async () => (near(doneHours(await cellOf(T)), want, 0.08) ? Date.now() : null), 6000, 60);
    const cell = await cellOf(T);
    return [had !== null && !!tabAt && tabAt - at <= 2000, { before: had, wantedHours: Math.round(want * 100) / 100, todaysDone: cell === null ? 'no Done column' : cell || 'empty', tabMs: tabAt ? tabAt - at : null }];
  });
  await check(c, '5.4', async () => {
    await addRow(S, A.log, 'A quick review', { Date: `${T}T00:40`, Minutes: 30 });
    await sleep(1500);
    await S.relaunch();
    await openPlan(S, SP.name);
    must(await until(async () => ((await tabDays(S, SP.start)) || []).length === 30, 15_000), 'the plan\'s tab showing its days after the restart');
    const inDays = doneIn(T);
    const cell = await until(async () => { const x = await cellOf(T); return near(doneHours(x), inDays, 0.08) ? x : null; }, 6000, 80);
    return [inDays >= 0.5 && !!cell, { doneInDays: inDays, todaysDone: cell || (await cellOf(T)) || 'empty' }];
  });
});

phase(6, 'Study\'s clock leaves out idle time (on the page\'s clock, moved by the probe)', 'bank', {
  '6.1': 'a session left open for 61 minutes with no input writes no hour to the Work Log: 5 minutes at most',
  '6.2': 'a stretch that ends idle is taken back, and what came before it stays: six minutes at the desk, then 30 idle, are logged as 6 to 9',
  '6.3': 'ten minutes is the line: an input only every 11 minutes (three times) logs 5 minutes at most',
  '6.4': 'a key, a turn of the wheel, a click and a finger\'s tap each count as being there: one of them every 9 minutes (36 in all) logs 34 to 38',
  '6.5': 'the seconds count only while the session\'s tab is showing: 12 minutes on another tab, a key each minute, log 3 minutes at most',
}, async (S, c, A) => {
  await fakeClock(S);
  /** A session over `unit`: its first question answered, then `during`, then End Session. Returns the Minutes logged. */
  const sitting = async (unit, during) => {
    const card = await startSession(S, unit);
    await answer(S, card, TYPED);
    await during();
    await endSession(S);
    return loggedMinutes(S, A.log, unit);
  };
  await check(c, '6.1', async () => { const m = await sitting('Venter', () => pass(S, 1, 61)); await S.shot('06-after-an-idle-hour'); return [m !== null && m <= 5, { minutesLogged: m }]; });
  await check(c, '6.2', async () => { const m = await sitting('Clark', async () => { await pass(S, 6, 1, ['key']); await pass(S, 1, 30); }); return [m !== null && m >= 6 && m <= 9, { minutesLogged: m }]; });
  await check(c, '6.3', async () => { const m = await sitting('Friedland', () => pass(S, 3, 11, ['key'])); return [m !== null && m <= 5, { minutesLogged: m }]; });
  await check(c, '6.4', async () => { const m = await sitting(BF, () => pass(S, 4, 9, ['key', 'wheel', 'click', 'tap'])); return [m !== null && m >= 34 && m <= 38, { minutesLogged: m }]; });
  await check(c, '6.5', async () => {
    const m = await sitting('Mack', async () => {
      must(await showTab(S, tabTitle('Mack')), 'the unit\'s tab, to switch away to');
      await pass(S, 12, 1, ['key']);
      must(await showTab(S, `Study · ${tabTitle('Mack')}`), 'the session\'s tab, to come back to');
      await sleep(400);
    });
    return [m !== null && m <= 3, { minutesLogged: m }];
  });
}, ['6.4']);

phase(7, 'Words where they are needed', 'plan', {
  '7.1': 'the New Plan sheet says what Personal and what Work hours are, a line each, in sentence case',
  '7.2': 'the New Plan sheet says what Floor, Standard and Stretch are, a line each, in sentence case',
  '7.3': 'the plan\'s tab says the same five',
  '7.4': 'the plan\'s tab says, in its part Phases, what Rest, Catch-up and Holiday do to a day\'s hours, a line each',
  '7.5': 'the sheet\'s "hours less / more" line says it fills the three columns once',
  '7.6': 'every one of those lines reads at 4.5 to 1 or better, in dark and in light',
}, async (S, c) => {
  const ws = S.workspace;
  const T = (await S.today()).date;
  const SP = sprint(T);
  mustPlan(ws, SP.name);
  const HOURS = ['Personal', 'Work']; const PLANS3 = ['Floor', 'Standard', 'Stretch']; const KINDS = ['Rest', 'Catch-up', 'Holiday'];
  const sheetLines = async () => { await openPlanSheet(S); return (await S.lines('form')) || []; };
  const closeSheet = async () => { (await S.press('form', /^cancel$/i, 'button')) || (await S.page.keyboard.press('Escape')); await until(async () => !(await S.formOpen()), 3000); await sleep(300); };
  const tabLines = async () => { await openPlan(S, SP.name); must(await tabShows(S, 30, SP.start), 'the tab showing the plan'); return { all: (await S.lines('pane')) || [], phases: (await S.lines('pane', '^phases\\b')) || [] }; };
  const onceLine = (lines) => lines.find((l) => /\bonce\b/i.test(l.text) && /(less|more|floor|stretch)/i.test(l.text)) || null;
  let sheet = await sheetLines();
  await S.shot('07-new-plan-sheet');
  await check(c, '7.1', async () => { const r = linesFor(sheet, HOURS); return [r.ok, r.said]; });
  await check(c, '7.2', async () => { const r = linesFor(sheet, PLANS3); return [r.ok, r.said]; });
  await check(c, '7.5', async () => { const l = onceLine(sheet); return [!!l, l ? l.text.slice(0, 160) : { lines: sheet.map((x) => x.text.slice(0, 50)).slice(0, 12) }]; });
  await closeSheet();
  let tab = await tabLines();
  await S.shot('07-plan-tab');
  await check(c, '7.3', async () => { const r = linesFor(tab.all, [...HOURS, ...PLANS3]); return [r.ok, r.said]; });
  await check(c, '7.4', async () => { const r = linesFor(tab.phases, KINDS); const hours = KINDS.every((k) => r.got[k] && /\bhours?\b/i.test(r.got[k].text)); return [r.ok && hours, { ...r.said, eachSaysHours: hours, partFound: tab.phases.length > 0 }]; });
  await check(c, '7.6', async () => {
    const out = {};
    for (const mode of ['dark', 'light']) {
      if (mode === 'light') await setMode(S, 'light');
      sheet = await sheetLines();
      const a = [...HOURS, ...PLANS3].map((t) => definingLine(sheet, t)); const once = onceLine(sheet);
      await closeSheet();
      tab = await tabLines();
      const b = [...[...HOURS, ...PLANS3].map((t) => definingLine(tab.all, t)), ...KINDS.map((t) => definingLine(tab.phases, t))];
      const all = [...a, once, ...b];
      out[mode] = { linesFound: all.filter(Boolean).length, wanted: all.length, below: all.filter((l) => l && !(l.contrast >= 4.5)).map((l) => `"${l.text.slice(0, 30)}" ${l.contrast}:1`) };
      if (mode === 'light') await S.shot('07-plan-tab-light');
    }
    await setMode(S, 'dark');
    return [Object.values(out).every((o) => o.linesFound === o.wanted && o.below.length === 0), out];
  });
});

phase(8, 'Enter starts', 'bank', {
  '8.1': 'the setup sheet opened with the mouse, the focus in the sheet and on no button: Enter starts the session',
  '8.2': 'by the keys alone: Enter on the unit tab\'s "Study…" opens the sheet, Enter again starts',
  '8.3': 'the subject\'s own sheet (More Actions, Study…): Enter starts there too, and a second time after that session was ended',
}, async (S, c) => {
  /** The focus put in the sheet but on no control: a press on its title. What has the focus then. */
  const focusInSheet = async () => {
    const title = await S.page.evaluate(() => { const s = Array.from(document.querySelectorAll('.st-sheet')).find(window.__ap.shown); const h = s && s.querySelector('.st-sheet__title, h1, h2, h3'); if (!h) return null; const r = h.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    if (title) await S.click(title);
    await sleep(200);
    return S.focusIs();
  };
  const started = async () => { const card = await until(async () => { const x = await S.card(); return answerable(x) ? x : null; }, 15_000, 100); return { card: !!card, sheetGone: !(await sheetOpen(S)) }; };
  await check(c, '8.1', async () => {
    await openSetup(S, 'Venter');
    const f = await focusInSheet();
    must(f && f.inForm && f.tag !== 'BUTTON' && f.tag !== 'TEXTAREA', `the focus in the sheet and on no button (it is on ${f ? `${f.tag} ${f.name}` : 'nothing'})`);
    await S.page.keyboard.press('Enter');
    const r = await started();
    await S.shot('08-after-enter');
    if (r.card) await endSession(S); else await cancelSheet(S);
    return [r.card && r.sheetGone, { focusWasOn: `${f.tag}${f.role ? `[${f.role}]` : ''} ${f.name}`, ...r }];
  });
  await check(c, '8.2', async () => {
    if (!(await showTab(S, tabTitle('Clark')))) await openUnit(S, 'Clark');
    const head = must(await S.textPoint('pane', tabTitle('Clark')), 'the title on the unit\'s tab');
    await S.click(head);
    const on = must(await tabTo(S, /^Study…$/, 30), '"Study…" on the unit\'s tab, reached by Tab');
    await S.page.keyboard.press('Enter');
    must(await until(() => sheetOpen(S), 6000), 'the setup sheet after Enter on "Study…"');
    await sleep(600);
    const f = await S.focusIs();
    await S.page.keyboard.press('Enter');
    const r = await started();
    if (r.card) await endSession(S); else await cancelSheet(S);
    return [r.card && r.sheetGone, { reached: on.name, focusInTheSheetWasOn: f ? `${f.tag}${f.role ? `[${f.role}]` : ''} ${f.name}` : 'nothing', ...r }];
  });
  await check(c, '8.3', async () => {
    const out = [];
    for (let i = 0; i < 2; i++) {
      const items = must(await rowMenu(S, SUBJECT), 'the subject\'s More Actions menu');
      await S.click(must(items.find((x) => /^Study…$/.test(x.name)), '"Study…" in the subject\'s More Actions'));
      must(await until(() => sheetOpen(S), 6000), 'the subject\'s setup sheet');
      await sleep(500);
      const f = await focusInSheet();
      must(f && f.inForm && f.tag !== 'BUTTON' && f.tag !== 'TEXTAREA', `the focus in the sheet and on no button (it is on ${f ? `${f.tag} ${f.name}` : 'nothing'})`);
      await S.page.keyboard.press('Enter');
      const r = await started();
      out.push(r);
      if (r.card) await endSession(S); else await cancelSheet(S);
    }
    return [out.every((r) => r.card && r.sheetGone), out];
  });
});

phase(9, 'Everyone can use the new controls', 'bank', {
  '9.1': '"Days off before the exam" is reached by Tab in the New Plan sheet, is named, shows the focus, takes a number typed, and Enter creates the plan with that many days off',
  '9.2': '"Remove Unit…" by the keys: the row\'s More Actions, the arrows, Enter; its question takes the focus and keeps Tab inside; Escape closes it and the unit stays',
  '9.3': '"Remove Unit…" by a finger: a tap on the row\'s More Actions, a tap on the item, a tap on Cancel',
  '9.4': 'a proposal that only holds a unit\'s name is ticked and attached by the keys alone',
}, async (S, c, A) => {
  const ws = S.workspace;
  const T = (await S.today()).date;
  await check(c, '9.1', async () => {
    const spec = ahead(T, 'Keyed Block', 2);
    await openPlanSheet(S);
    await fillPlanSheet(S, spec);
    const name = must(await S.field(PF.name), 'the Name field');
    await S.click(name);
    const f = await tabTo(S, DAYS_OFF, 30);
    if (!f) { (await S.press('form', /^cancel$/i, 'button')) || (await S.page.keyboard.press('Escape')); return [false, 'no field named "Days off before the exam" was reached by Tab']; }
    await S.page.keyboard.press('Control+A');
    await S.page.keyboard.type('2');
    await S.shot('09-days-off-focused');
    await S.page.keyboard.press('Enter');
    const front = await until(async () => (await tabTitled(S, spec.name)).some((t) => t.active), 40_000, 50);
    const p = await until(() => { const x = planOf(ws, spec.name); return wholePlan(x) && phaseNamed(ws, x, 'Days off') ? x : null; }, 15_000, 100);
    const off = p ? phaseNamed(ws, p, 'Days off') : null;
    return [f.hasRing && f.keyboard && !!front && !!off && off.start === addDays(spec.exam, -2) && off.end === addDays(spec.exam, -1), { name: f.name, focusShown: f.hasRing, planMade: !!front, daysOff: off ? `${off.start}..${off.end}` : null }];
  });
  /** The unit row's More Actions with the keys on "Remove Unit…", by the keys or by a finger; false with what was found instead. */
  await check(c, '9.2', async () => {
    must(await keysToUnitMore(S, 'Venter'), 'the row\'s More Actions, reached by Tab from the unit\'s row');
    await S.page.keyboard.press('Enter');
    await sleep(400);
    const on = await arrowTo(S, /^Remove Unit…$/);
    if (!on) { const items = (await S.find('body', /./, '[role="menuitem"]')).filter((h) => h.y > 48).map((h) => h.name); await S.page.keyboard.press('Escape'); return [false, { menu: items }]; }
    await S.page.keyboard.press('Enter');
    must(await until(() => S.formOpen(), 4000), 'the question after Enter on "Remove Unit…"');
    await sleep(400);
    const took = (await S.focusIs())?.inForm;
    const left = [];
    for (let i = 0; i < 8; i++) { await S.page.keyboard.press(i % 3 === 2 ? 'Shift+Tab' : 'Tab'); const f = await S.focused(); if (!f || !f.inForm) left.push(i + 1); else if (!f.hasRing) left.push(`no focus shown on ${f.name}`); }
    await S.page.keyboard.press('Escape');
    const closed = await until(async () => !(await S.formOpen()), 3000);
    await sleep(800);
    return [!!took && left.length === 0 && !!closed && !!rowTitled(ws, A.units, 'Venter'), { focusTaken: !!took, leftTheQuestionOrNoFocusShown: left, escapeClosed: !!closed, unitStays: !!rowTitled(ws, A.units, 'Venter') }];
  });
  await check(c, '9.3', async () => {
    const row = must(await subjectPoint(S, 'Clark', { under: SUBJECT }), 'the unit Clark in the sidebar');
    await S.page.mouse.move(row.x, row.y);
    await sleep(250);
    const btn = (await S.find('sidebar', /^More Actions/i)).filter((h) => !h.disabled).sort((a, b) => Math.abs(a.y - row.y) - Math.abs(b.y - row.y))[0];
    await S.page.mouse.move(700, 600);
    must(btn && Math.abs(btn.y - row.y) <= 14, 'More Actions beside the row');
    await S.tap(btn); await sleep(500);
    const item = (await S.find('body', /^Remove Unit…$/, '[role="menuitem"]'))[0];
    if (!item) { const items = (await S.find('body', /./, '[role="menuitem"]')).filter((h) => h.y > 48).map((h) => h.name); await S.page.keyboard.press('Escape'); return [false, { menu: items }]; }
    await S.tap(item);
    const asked = await until(() => S.formOpen(), 4000);
    await sleep(300);
    const cancel = (await S.find('form', /^Cancel$/, 'button'))[0];
    if (cancel) await S.tap(cancel);
    const closed = await until(async () => !(await S.formOpen()), 3000);
    await sleep(800);
    return [!!asked && !!cancel && !!closed && !!rowTitled(ws, A.units, 'Clark'), { asked: !!asked, cancelTapped: !!cancel, closed: !!closed, unitStays: !!rowTitled(ws, A.units, 'Clark') }];
  });
  await check(c, '9.4', async () => {
    const r = await findMatches(S);
    if (r.seen !== 'list') return [false, r];
    const want = nameOf('mackMd');
    await S.page.keyboard.press('Tab');
    const activeRow = () => S.page.evaluate(() => { const a = document.activeElement; const id = a && a.getAttribute('aria-activedescendant'); const n = id ? document.getElementById(id) : null; return n ? (n.innerText || '').replace(/\s+/g, ' ').trim() : ''; });
    let on = false;
    for (let i = 0; i < r.list.length + 1; i++) { if ((await activeRow()).includes(want)) { await S.page.keyboard.press('Space'); await sleep(200); on = !!(await S.choices()).find((x) => lineIs(x, want))?.on; break; } await S.page.keyboard.press('ArrowDown'); await sleep(60); }
    if (!on) { await closeList(S); return [false, { ticked: false, rows: r.list.map((x) => norm(x.lines[0])) }]; }
    const btn = await tabTo(S, /^Attach Selected$/, 6);
    if (btn) await S.page.keyboard.press('Enter');
    const closed = await until(async () => !(await S.formOpen()), 4000);
    const ok = await until(() => unitHolds(ws, A.units, 'Mack', 'mackMd'), 4000);
    if (!closed) await closeList(S);
    return [!!btn && !!closed && !!ok && !unitHolds(ws, A.units, 'Mack', 'mackPdf'), { ticked: on, attachReached: !!btn, attached: !!ok }];
  });
});

// ── The workspaces the phases start from: made by the app, once each ────────
// Study may know a subject by its workspace, so the phases all run on the one
// workspace path it was made in, put back from a snapshot before each.
//   seed  the files, the pages and the question bank; no subject
//   bank  seed, and the subject "Exam 7" made from the bank through the New Subject sheet
//   plan  bank, and the plan "Sprint" made through the New Plan sheet, begun nine days ago
const BASE_WORKSPACE = path.join(OUT, 'runs', 'subject-workspace');
const bases = { seed: { snapshot: null, failed: '' }, bank: { snapshot: null, failed: '' }, plan: { snapshot: null, failed: '' } };
const BASE_FROM = { seed: null, bank: 'seed', plan: 'bank' };
async function baseOf(kind) {
  const b = bases[kind];
  if (b.snapshot) return b.snapshot;
  if (b.failed) throw new Error(b.failed);
  const from = BASE_FROM[kind] ? await baseOf(BASE_FROM[kind]) : null;
  const root = await newRoot(`${kind}-made`, from, BASE_WORKSPACE);
  if (kind === 'seed') await writeFiles(BASE_WORKSPACE);
  const S = makeSession(root);
  try {
    await S.open();
    const ws = S.workspace;
    if (kind === 'seed') {
      const bank = await seedDatabase(S, BANK, bankColumns(Object.keys(PAPERS)), SEED.map((q) => ({ title: q.question, values: { 'Model Answer': q.answer, Paper: q.paper } })));
      must(rowsOf(ws, bank).length === SEED.length, `the ${SEED.length} seeded questions in the workspace file`);
      const log = await seedPage(S, PAGES.log);
      for (const k of ['mackPage', 'venterNotes', 'chain']) await seedPage(S, PAGES[k]);
      await seedPage(S, PAGES.unmacked, log);
      console.log(`[probe] the seed was made by the app: ${SEED.length} questions on ${Object.keys(PAPERS).length} papers, ${Object.keys(PAGES).length} pages, ${Object.keys(FILES).length} files (zone ${(await S.today()).zone}, today ${(await S.today()).date})`);
    } else if (kind === 'bank') {
      await makeSubject(S, { name: SUBJECT, questions: BANK });
      const subj = await settledSubject(S, SUBJECT);
      must(await openDb(S, subj.units.id), 'Units open in the app');
      const also = must(col(columns(ws, subj.units.id), 'Also Called'), 'the column Also Called in Units');
      for (const [u, v] of Object.entries(ALSO_CALLED)) await S.cmd('database.setCell', must(rowTitled(ws, subj.units.id, u), `the unit ${u}`).pageId, also.id, v);
      must(await until(() => norm(rowTitled(ws, subj.units.id, 'Mack')?.values['Also Called']) === ALSO_CALLED.Mack, 4000), 'Mack\'s Also Called stored');
      await closeTab(S, 'Units');
      await showStudySidebar(S);
      must(await until(async () => { const t = await subjectsText(S); return t && Object.keys(PAPERS).every((u) => t.includes(u)) ? t : null; }, 12_000), `the subject and its units in the sidebar (${(await subjectsText(S)) ?? 'no Subjects section'})`);
      console.log(`[probe] the subject "${SUBJECT}" was made through the New Subject sheet from the bank: ${Object.keys(PAPERS).length} units`);
    } else {
      const spec = sprint((await S.today()).date);
      const p = await makePlanWith(S, spec);
      must(await until(() => dayDiffs(daysIn(ws, p), expectedDays(ws, p).days, FILE_KEYS).length === 0, 20_000, 150), 'the days of "Sprint" as its rules give them');
      console.log(`[probe] the plan "${spec.name}" was made through the New Plan sheet: ${spec.start} to the day before ${spec.exam}`);
    }
    // No tab is left open: a full strip of tabs scrolls, and the phases open their own.
    for (let i = 0; i < 30 && (await S.tabs()).length; i++) await closeFront(S);
    await sleep(2000);
  } catch (err) {
    b.failed = `the workspace the phase starts from could not be made (${kind}): ${String((err && err.message) || err).split('\n')[0].slice(0, 260)}`;
    if (S.page) await S.shot(`base-${kind}-stopped`);
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
/** The ids a phase works with, from the file. */
function subjectIds(ws) {
  const s = subjectOf(ws, SUBJECT);
  return { page: s.page?.id ?? null, units: s.units?.id ?? null, log: s.log?.id ?? null };
}

async function main() {
  await fs.rm(path.join(OUT, 'shots'), { recursive: true, force: true });
  await fs.mkdir(path.join(OUT, 'shots'), { recursive: true });
  await fs.rm(path.join(OUT, 'runs'), { recursive: true, force: true });
  const t0 = Date.now();
  const keptIds = new Set();
  for (const p of PHASES) {
    if (ONLY && !ONLY.has(p.n)) continue;
    console.log(`\n── ${p.n}. ${p.title}`);
    const tp = Date.now();
    const done = new Set();
    for (const id of p.kept) keptIds.add(id);
    const c = (id, ok, got) => { if (done.has(id)) return; done.add(id); record(id, `${p.kept.includes(id) ? '(holds today) ' : ''}${p.checks[id] ?? '(unnamed check)'}`, ok, got); };
    let S = null;
    let stopped = '';
    try {
      S = makeSession(await newRoot(`phase-${String(p.n).padStart(2, '0')}`, await baseOf(p.base), BASE_WORKSPACE));
      c.S = S;
      await S.open();
      await p.fn(S, c, subjectIds(S.workspace));
    } catch (err) {
      stopped = String((err && err.message) || err).split('\n')[0].slice(0, 320);
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
  const isGround = (r) => r.id.startsWith('0.') || keptIds.has(r.id);
  const ground = results.filter(isGround); const fresh = results.filter((r) => !isGround(r));
  console.log(`\n[probe] page errors: ${pageErrors.length}`);
  for (const e of [...new Set(pageErrors)].slice(0, 8)) console.log(`   ${e}`);
  console.log(`[probe] ${results.length} checks: ${results.length - failed.length} ok, ${failed.length} FAIL${failed.length ? ` (${failed.map((r) => r.id).join(' ')})` : ''}`);
  console.log(`[probe] of them the ground (phase 0 and the checks marked "holds today"): ${ground.filter((r) => r.ok).length} of ${ground.length} ok; the new behaviour: ${fresh.filter((r) => r.ok).length} of ${fresh.length} ok`);
  console.log(`[probe] ${Math.round((Date.now() - t0) / 1000)} s; screenshots in ${path.join(OUT, 'shots')}`);
  process.exitCode = failed.length ? 1 : 0;
}
main().catch((err) => { console.log(`[probe] FAIL the probe itself stopped: ${err && err.stack ? err.stack : err}`); process.exitCode = 1; });
