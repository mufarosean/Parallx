// @acceptance: one record of study work for every tool: Worksheets, Flashcards, reading and discussion reach the subject's Work Log and the plan's Done, counted by one idle-aware clock
// Written from the request ("Piece B: one record of study work for every
// tool", its twelve numbered points and its Decided list) before the build, by
// a verifier that did not build it, and seen to fail on the app as it was
// (ef5610ab). The builder does not edit this file: a check that is wrong is
// reported, not changed.
//
// What a person must be able to see when the piece is done (a phase's number
// is the request's point, a check's number begins with it; PARALLX_PROBE_ONLY
// takes these numbers):
//
//    1  The record is his Work Log: the plan's Done is the sum of the Work
//       Log's Minutes by local day and nothing else; a row's Minutes changed
//       by hand, and Done follows the row, not the tool
//    2  Work in another tool reaches it: a Worksheets problem worked, Flashcards
//       cards reviewed, for a paper or tag that matches a unit by its name or
//       its Also Called: one row per tool, unit and local day (Date, Minutes,
//       Unit, Tool, Kind Problems or Cards, Items, Right, Origin App) that
//       grows; a paper or tag of no unit is in no row; today's Done has it
//    3  Reading counts: a PDF of a unit's Material showing, Kind Reading; not
//       while its tab is behind another; not a PDF of no unit
//    4  Discussion counts: a chat opened from a unit in Study, Kind
//       Discussion; not any other chat
//    5  One clock: in each of the five, seven minutes at the desk and an hour
//       away are seven minutes; moving the mouse is not being there; the idle
//       time is one setting of the app (5, 10, 15, 30; 10 to begin with) that
//       all five follow; the two old clock files are gone
//    6  The stop is said: on screen and politely to a screen reader, and the
//       return too; the rule is written where he can find it
//    7  What he wrote is his: a row he adds, a row of Study's he changes; an
//       untouched row goes on following the tool
//    8  Off keeps the past: Worksheets or Flashcards off and on; Study off
//       clocks and writes nothing, and the other tools keep their own time
//    9  The core names no tool: the point is documented, the ratchets hold
//   10  No double counting: a session is one row; a restart in the middle of
//       the day; a second sync writes nothing; only the tool that is showing
//   11  A day is the local day, each side of midnight on its own day
//   12  Seen: the subject shows today's and the week's minutes by tool or kind
//    0  is not in the request: the ground the other checks stand on (the seed
//       as the app shows it, the plan with today in it, the Work Log's
//       columns, Done from a hand row, the page's clock, each tool driven for
//       real, the tools turned off and on, Settings read, a cell typed, a
//       restart, light and dark). Its checks pass before the build and must go
//       on passing. Six checks in other phases are ground too and are printed
//       with "(holds today)": 5.5 (Study's own session leaves out an hour
//       away), 7.5 (a session's row he changed stays), 8.6 (Worksheets keeps
//       its own time while Study is off), 8.8 (nothing left running after
//       Study is turned off), 9.2 (the ratchets) and 10.1 (a session is one
//       row). Every other check fails before the build.
//
// On the app as it was (ef5610ab, 2026-11-23, Linux, zone America/Chicago,
// one run of 11 minutes): 79 checks. The 21 of the ground pass (phase 0's 15 and
// the six above). The 58 of the new behaviour all fail, each because the
// behaviour is not there: no Work Log row is written for Worksheets,
// Flashcards, reading or a chat (the rows are looked for and the file has
// none; Worksheets' own ledger and Flashcards' own record, printed beside,
// have the time); Settings has no idle setting once the tools are off; nothing
// on screen or in a live region says a clock stopped; the two clock files are
// there; the docs do not name the point; no part of Study names today, the
// week and two sources together. No page error.
//
// How it runs. Every phase gets its own app, profile and workspace, so one
// failure hides nothing. A phase starts from a copy of a workspace the app
// itself made, in three steps, each from the one before:
//   seed     six PDFs on disk (five in Readings/, one at the root) and a
//            question bank with a Paper column, made through the chat's own
//            tools; then, with the app closed, Worksheets' problems (papers
//            clark, friedland, hurlimann), its own ledger for the history day
//            and Flashcards' cards (tags clark, chain-ladder, zeta; a deck
//            VENTER), written into the tables the tools made
//   subject  the subject "Exam 7" made through the New Subject sheet from the
//            bank and the folder Readings: six units, five holding a PDF in
//            Material; Mack's Also Called gains "Chain Ladder"
//   plan     the plan "Sprint" made through the New Plan sheet: it began nine
//            days before and its exam is three weeks on
// Every phase starts from plan. The mouse, the keys and the finger are real.
// A scripted model stands in for the owner's: it grades a typed answer by its
// words and answers a chat with one word, which proves the plumbing only.
//
//   xvfb-run -a node tests/probes/study-work-acceptance.mjs [outDir]
//   PARALLX_PROBE_ONLY=0,3,5-7   only those phases
//   PARALLX_PROBE_TZ=Asia/Tokyo  the app's time zone (default America/Chicago;
//                                Linux and macOS only, Windows keeps its own)
//
// Which checks rest on seeded history, and which on work done here. The only
// time that is seeded is Worksheets' own ledger for one past day (two days
// before the seed was made): 15 and 10 minutes on two Clark problems, 30 on a
// Hürlimann one. 1.1, 1.2, 2.1, 2.2, 7.1, 7.2 rest on it and say [history];
// 8.1 reads that day's row beside today's, and 10.3's rows from the tools
// may be it. No Flashcards time, no reading and no chat is
// seeded. Phase 12's rows are added to the Work Log through the chat's own
// tool, as rows he wrote (Origin Manual). Everything else is worked here: a
// Worksheets problem opened from its dashboard, a cell typed, rated; cards
// turned and graded on Flashcards' screen; a PDF opened from the unit's tab
// and scrolled, clicked, tapped; a chat opened by Discuss, its prompt sent
// and answered; a Study session answered and ended.
//
// Today, the clock and midnight. No date is fixed: every date is counted from
// the app's own today. Time that must pass is not waited for: Playwright's
// clock is put on the page (page.clock) and moved, so the app's own timers and
// Date run on. It is moved by jumps (clock.fastForward), one second at a time
// while he is at the desk, so a clock that looks every second sees one-second
// looks, with one real key, wheel, click or tap after each minute; five and
// thirty seconds at a time while he is away. (clock.runFor fires every frame
// of a spreadsheet and takes a real minute for each minute.) Wherever minutes
// are worked the clock goes in first:
//   - at the real now; or, when the run is after 20:00 local, at 09:00 of the
//     next day, which is then the phase's today. So a phase's hour or two of
//     clock time never crosses midnight by accident, at any hour of a run.
//   - phase 11 puts it at 23:45 local (of the next day when the real time is
//     past 23:35) and works across midnight on purpose.
//   - phase 12 moves on to the next Wednesday when today is a Sunday, Monday
//     or Tuesday, so yesterday and the day before are in "this week" however
//     a week is counted.
// The seed's day is kept from when the seed was made; the history day is two
// days before it, in every phase. A RUN THAT CROSSES LOCAL MIDNIGHT on the
// real clock: the seed and the plan are made once, at the start, and every
// phase reads today again when it begins, so phases after midnight work a day
// later against the same plan (it runs nine days back and three weeks on) and
// the same history day. Only phase 1 (no clock on the page, a few seconds) and
// the first five checks of phase 0 read the real day while they run; if
// midnight falls inside one of those few seconds, 0.4 or 0.5 can fail: run
// that phase again. A row of a day gone by is never rewritten by the plan
// (piece A), so no past day's Type, Phase or hours is expected to change
// here; only its Done, which follows the Work Log.
//
// THE ALLOWANCE. The request says the row grows while he works and that
// today's Done shows it the same day; it gives no number. After work in a
// tool the probe leaves the tool (a click on the plan's tab; the chat's panel
// closed) and gives the Work Log two minutes of the page's clock, twenty
// seconds at a time, and about three real seconds, reading the file each
// time. A build that writes only on a restart, or less often than every two
// minutes with nothing to prompt it, fails. Minutes are 7 "give or take
// one": a tool's seconds may be rounded up or to the nearest.
//
// Where a result is read from. Never from what the probe typed: from the
// workspace's own database file (<workspace>/.parallx/data.db: the Work Log's
// rows as the app wrote them, each with its Date as a local day, Minutes,
// Unit by the unit's name, Tool, Kind, Items, Right, Origin; Units), from the
// plan's tab on screen (a day's Done), from Worksheets' own clock on its
// sheet, from Settings on screen, from what is on screen and what the live
// regions are given, from the repository's files (points 5 and 9). Worksheets'
// own ledger (ws_study_time) and Flashcards' own record (fc_reviews) are read
// only in the ground checks and to print beside a failure; no check of the
// new behaviour depends on a table of the new code.
//
// How the probe writes (none of it is Study or the new point): the chat's own
// tool canvas_add_database_row for a row he adds by hand; the canvas table
// with the mouse and keys for a Minutes cell he changes;
// canvas_set_page_property once (12.3); the tools' tables with the app closed
// for the seed. The subject and the plan are made only through their sheets.
//
// What the probe holds on to (the builder keeps these, or the check fails):
//   - the request's words: the Work Log's columns Date, Minutes, Unit, Tool,
//     Kind, Items, Right, Confirmed, Origin; Kind "Problems", "Cards",
//     "Reading", "Discussion" (and "Questions" for a session, as today);
//     Origin "App"; Unit holding the unit's row; Tool holding the tool's
//     name (anything with "worksheet" in it, anything with "flashcard" in
//     it, in any letter case; "Study" for a session, as today); Date a date,
//     a local date and time, or a moment with its zone
//   - THE HOOKS (the few things that are not the request's words):
//       1. the idle setting (5.7, 6.6) is in the app's Settings, the dialog
//          that settings.open shows, with Worksheets, Flashcards and Study
//          all turned off. It is found by typing, into Search settings, one
//          of: idle, counting, no input, away, clock. It is one control that
//          chooses one of several (a select, a group of radios, or a button
//          that opens a list: the kit's dropdown) whose four choices hold the
//          numbers 5, 10, 15 and 30 (the first number in each choice's words)
//       2. the stop (phase 6) is anything on screen, anywhere in the window,
//          that was not there two minutes into the work and after eleven
//          minutes away says one of: paused, stopped, not counting, no longer
//          counting, idle, away, inactive, on hold; in words, or as the name
//          or tooltip of an icon (aria-label, title). To a screen reader: an
//          element with aria-live or role status, alert or log is given text
//          with one of those words; "politely" is aria-live="polite" or role
//          status or log, and nothing with those words in an assertive
//          region or an alert. The return: within three seconds of a key, the
//          stop's words are no longer on screen, and a polite region is given
//          a text that is not the stop's and has one of: resum…, again,
//          running, restart, continu…, back, counting
//       3. the rule (6.6) is a sentence of eight words or more that holds one
//          of: taken back, not count…, no longer count…, counts (for)
//          nothing, stop(s) counting, left out, is not counted, does not
//          count. It stands in the idle setting's row in Settings (its name
//          and description), or with the stop (its words, tooltip or
//          description)
//       4. the breakdown (phase 12) is in Study: in its sidebar, or in a tab
//          that an item of the subject's More Actions beginning Open, Show or
//          View opens (not Open Units, Open Questions, Open Work Log, which
//          are the canvas). It is the smallest part of that surface that
//          holds the words "today", "week" (or "7 days") and two of the
//          sources. A source is named by its kind or its tool: Problems or
//          Worksheets, Cards or Flashcards, Questions or Study. Each time is
//          written with its unit: "25 min", "1 h 5 min", "1.1 h", "1:05" (a
//          bare number is not read). A line is a table row, a list item or a
//          sentence; a source's time is the time that follows its word; one
//          time on a line belongs to the part ("Today", "This week") the line
//          stands under, two are today's and the week's in the order the two
//          were named above them
//       5. a chat "opened from a unit": a control on the unit's tab whose
//          name begins "Discuss" when there is one, else "Discuss in Chat" on
//          an answered question of a session over the unit (as today)
//   - as they are today: the plan's tab (tr[data-date], a Done column),
//     Study's sidebar and a unit's tab ("Open <title>", "Study…"), the setup
//     sheet, a session's card, "End Session", the Work Log row of a session
//     titled "<Subject> · <Unit>", Worksheets' dashboard ("Quiz Clark Not
//     rated, 3 problems"), its sheet ("Rate this problem": Easy, the clock
//     .ws-problem__timer, "Next Problem"), Flashcards' flashcards.studyTag,
//     Show Answer and button.fc-grade, the PDF pane (parallx.editor.pdf),
//     file.openFile, the chat (textarea.parallx-chat-input-textarea,
//     .parallx-chat-message--assistant, "New Chat", chat.show,
//     workbench.action.toggleAuxiliaryBar), Settings ("Search settings",
//     "Close Settings"), worksheet.settings, the canvas table, Appearance
//
// How the request is read where it leaves room (told to the builder):
//   1  nothing else feeds Done: read as "Done is what the Work Log's rows of
//      the day sum to", checked wherever Done is read, and by a hand edit
//   2  time Worksheets had already counted before this piece (its ledger of a
//      past day) reaches the Work Log too, as a row of that day: the request
//      says tools report work by day and Study writes the rows. Flashcards'
//      past (the gaps it stored) is not looked at. "Items" is the problems
//      worked and rated that day, the cards reviewed that day. "Right where
//      the tool knows it": Flashcards knows (Good and Easy are right, Again is
//      not), so three cards graded Good, Good, Again are Right 2; Worksheets
//      rates Easy, Medium, Hard and its Right is not read. Confirmed is
//      printed and not judged. The row's title is the builder's (not empty)
//   3  "showing" is the PDF's tab in front in its group; a split view, the
//      window minimised or behind another program are not driven. A PDF in
//      two units' Material is not seeded. The row's Tool is not read
//   4  the chat counts while its panel shows. The session the question came
//      from is ended and its tab closed first, so the chat is the only thing
//      of the unit on screen. A chat beside a PDF or a session of the same
//      unit, both showing at once, is not driven: the request does not say
//      whether those seconds count once or twice. "Any other chat" is the
//      chat's own New Chat
//   5  "one setting for the whole app" is in the app's Settings whatever
//      tools are on, so it is looked for with all three off. A clock already
//      running need not follow a change of the setting: it is changed before
//      the work. Mouse movement is checked in Worksheets, which counted it
//   6  "where a clock is shown or a session is running" is a Study session, a
//      Worksheets sheet and a Flashcards session of cards. Reading and chat
//      show no clock and are not looked at
//   7  a row he adds for the same tool, unit and day as one of Study's: both
//      stay, his as written, Study's with the tool's number. A row of Study's
//      he changes stays as he left it and Study makes no second row for that
//      tool, unit and day (point 2's one row): the minutes worked afterwards
//      are his to add
//   8  "the rows carry on": the same row, by its page, grows after the tool
//      is on again. Study off: reading and chat time while it is off is never
//      counted, then or later; time worked in Worksheets while Study is off
//      reaches the Work Log when Study is on again (8.7), since the tool kept
//      it and Study reads the tools. "No listener or timer is left": counted
//      on the window and the document (keys, pointer, wheel, touch, scroll,
//      visibility, focus) and as repeating timers, with all three tools off
//      before and after; a core that keeps such a listener once Study has
//      been on fails 8.8
//   9  that the point is generic is read from outside only: the docs name it,
//      the ratchets hold with the baselines as they were (kept in this file),
//      the probe's own count of the three tools' names in core code has not
//      risen, and reading still counts with Worksheets and Flashcards off
//  10  "running the sync twice writes nothing": nothing in the Work Log's
//      part of the file changes (rows, values, times of writing, revisions)
//      over two quiet minutes, a restart, and Study off and on
//  11  a Study session that crosses midnight stays one row; which day it is
//      on is not checked
//  12  "the week" may be Monday to Sunday, Sunday to Saturday or the last
//      seven days; "by tool or kind" may be either
//
// What a build could do to pass without doing the thing, and what stops it:
//   - write Flashcards' rows from the gap between showing and grading: 5.2
//     holds a card 68 minutes and wants 6 to 8
//   - stop the clock at the idle time without taking the stretch back: seven
//     at the desk and 61 away would read 17, and every phase-5 check wants 6
//     to 8; ignore the setting: 5.8 to 5.12 want 1 to 3 where ten minutes
//     gives 14
//   - feed Done from the tools beside the Work Log: 1.2 and 7.2 change a row
//     by hand and want Done to be the row's
//   - never sync again, which keeps every hand edit: 7.4 wants an untouched
//     row to go on growing in the same run; 10.3 wants rows from the tools to
//     be there before "nothing is written" counts
//   - show the stop's words always: they must be absent two minutes in and
//     gone after a key
//   - rename the clock files: 5.6 also looks for the old arithmetic in the
//     two tools' folders; raise a ratchet's baseline or loosen its test: 9.2
//     holds the baselines as they were and counts the names itself
//   - a check that is true of nothing: every "adds nothing" and "stays"
//     check also wants the row that proves the clock was running (3.2, 3.3,
//     4.2, 2.7, 8.4, 8.5, 10.3)
//
// What only the owner's machine can show. All phases need the built app (npm
// run build) and nothing else: no model, no graphics card, no network. Not
// shown here:
//   - Windows: the app's zone is the machine's there (PARALLX_PROBE_TZ is not
//     applied), so run it once as it is
//   - a real idle hour on the real clock, the lid closed, the window
//     minimised or behind another program
//   - what a screen reader says (the live regions' text is read, not speech)
//   - his own model in the chat and in grading; real PDFs; his own bank
//
// Not checked here, and why:
//   - that a tool registers "a provider of work by day and group" and "a
//     reader reads them", as an interface: the request's shape of the point
//     is how it is built, and no name of it is given to look for (see 9)
//   - that Study itself names neither tool for it (only the core is counted)
//   - a Flashcards deck matched by its name (only tags are driven; the seed
//     has the deck VENTER); a paper matched by Also Called in Worksheets
//   - the Dashboard timer staying out; work matching units of two subjects
//   - IPC work and one-shot timers left for a tool that is off
//   - the look of the new parts (the visual bar's probe), the full keyboard
//     and touch audits (their own probes), the pieces before (their probes)
import { _electron as electron } from 'playwright';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.resolve(process.argv[2] ?? path.join(REPO, 'test-results', 'study-work-acceptance'));
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
const TOOLS = { study: 'parallx-community.study', worksheets: 'parallx.worksheet', flashcards: 'parallx-community.flashcards' };
const TOOL_COMMAND = { study: 'study.open', worksheets: 'worksheet.dashboard', flashcards: 'flashcards.studyTag' };
const ZONE = process.env.PARALLX_PROBE_TZ || 'America/Chicago';
// The probe's own dates are worked out in the app's zone (Windows keeps the machine's for both).
if (process.platform !== 'win32') process.env.TZ = ZONE;
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
  if (on !== true) throw new Error(`Study, Worksheets and Flashcards could not be turned on: ${on}`);
  // Study has finished starting once its last registration (the chat tools) is in.
  await page.waitForFunction(() => { try { return !!window.__parallx_workbench__._services.get({ id: 'ILanguageModelToolsService' }).getTool('study_results'); } catch { return false; } }, null, { timeout: 60_000 });
  await page.waitForFunction((ids) => { try { const c = window.__parallx_workbench__._services.get({ id: 'ICommandService' }); return ids.every((id) => c.hasCommand(id)); } catch { return false; } }, Object.values(TOOL_COMMAND), { timeout: 60_000 });
  await page.waitForTimeout(600);
  await page.evaluate(installPageHelpers);
  await page.evaluate(installPlanHelpers);
  await page.evaluate(installWalkHelpers);
  await page.evaluate(installWorkHelpers);
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
    today: () => S.page.evaluate(() => { const n = new Date(); const p = (v) => String(v).padStart(2, '0'); return { date: `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())}`, zone: Intl.DateTimeFormat().resolvedOptions().timeZone, ms: n.getTime(), hour: n.getHours(), minute: n.getMinutes() }; }),
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
  // A press on Study's item while its sidebar shows would close it, so the sidebar is looked at for a moment first
  // (it is drawn again when a tool is turned on), and pressed again when a press closed it.
  for (let i = 0; i < 3; i++) {
    if (await until(() => sidebarShown(S), i ? 3000 : 1200, 100)) return true;
    await S.press('body', /^Study$/, '.activity-bar-item');
    await sleep(300);
  }
  return !!(await until(() => sidebarShown(S), 3000));
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
  let at = 0; let front = null;
  // The sidebar is drawn again when the subject's rows change; a press that falls on a row being redrawn is lost, so it is pressed again.
  for (let i = 0; i < 3 && !front; i++) {
    const pt = must(await subjectPoint(S, unit, { under: SUBJECT }), `the unit "${unit}" under "${SUBJECT}" in Study's sidebar`);
    at = Date.now();
    await pressUnit(S, unit, pt, opts);
    front = await until(async () => (await tabTitled(S, tabTitle(unit))).some((t) => t.active), 2500, 30);
  }
  if (!front) {
    const tabs = (await S.tabs()).map((t) => `${t.label}${t.active ? ' (front)' : ''}`).join(' | ');
    throw new Error(`no tab "${tabTitle(unit)}" in front after the unit was pressed in the sidebar (tabs: ${tabs}${(await sheetOpen(S)) ? '; the setup sheet opened instead' : ''})`);
  }
  return at;
}
/** Wait for the tab in front to show what `pred` wants of its groups and items. */
async function waitTab(S, pred, ms = 5000) {
  let g = []; let it = [];
  const hit = await until(async () => { g = await S.groups(); it = await S.items(); return pred(g, it) ? true : null; }, ms, 60);
  return { ok: !!hit, groups: g, items: it };
}

// ── The picker and Find Matches ─────────────────────────────────────────────

// ── The canvas, the Explorer, the tools ──────────────────────────────────────
async function openDb(S, dbId) {
  await S.cmd('canvas.openPage', dbId);
  return !!(await until(() => S.page.evaluate((dbId) => Array.from(document.querySelectorAll('[data-px-surface="database"]')).some((e) => window.__ap.shown(e) && (e.getAttribute('data-px-instance') || '').endsWith(dbId)), dbId), 8000));
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
const bankColumns = (papers) => [
  { name: 'Model Answer', type: 'text' }, { name: 'Paper', type: 'select', options: papers },
  { name: 'Times Attempted', type: 'number' }, { name: 'Times Correct', type: 'number' },
  { name: 'Last Result', type: 'select', options: ['Right', 'Partly', 'Wrong'] },
];
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
function daysIn(ws, p) {
  const phaseTitle = new Map(rowsOf(ws, p.phases.id).map((r) => [r.pageId, r.title]));
  const phaseName = (v) => (Array.isArray(v) ? v.map((id) => phaseTitle.get(id) ?? id).join(', ') : norm(v));
  return rowsOf(ws, p.days.id).map((r) => ({
    pageId: r.pageId, title: r.title, date: dateOf(r.values.Date), type: r.values.Type ?? '', phase: phaseName(r.values.Phase),
    work: num(r.values.Work), floor: num(r.values.Floor), standard: num(r.values.Standard), stretch: num(r.values.Stretch),
    planned: num(r.values.Planned), running: num(r.values.Running), done: num(r.values.Done), edited: r.values.Edited === true || r.values.Edited === 1, note: r.values.Note ?? '',
  })).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
const hoursIn = (t) => { const m = /-?\d+(?:\.\d+)?/.exec(String(t ?? '')); return m ? Number(m[0]) : 0; };
const wordIn = (t) => (/^[\s—–-]*$/.test(String(t ?? '')) ? '' : norm(t));
/** The days of the plan as the tab's table shows them (a day listed as outside the plan is left out). */
async function tabDays(S, firstDate) {
  const t = await S.dayTable(firstDate);
  if (!t) return null;
  return t.rows.filter((r) => !r.outside).map((r) => ({ date: r.date, type: wordIn(r.cells.type), phase: wordIn(r.cells.phase), personal: hoursIn(r.cells.personal), work: hoursIn(r.cells.work), total: hoursIn(r.cells.total), running: hoursIn(r.cells.running) }));
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

/** The plan's tab in front: as it is, or through "Open Plan" in the subject's More Actions. */
async function openPlan(S, name) {
  if (await showTab(S, name)) return;
  let items = null;
  for (let i = 0; i < 4 && !items; i++) { items = await subjectMenu(S, SUBJECT); if (!items) await sleep(700); }
  must(items, `the More Actions menu of "${SUBJECT}"`);
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
// The files: five PDFs in Readings/ (the subject's sources folder, so each is in a unit's Material) and one PDF at
// the root that is in no unit's Material.
const R = (f) => path.join('Readings', f);
const FILES = {
  mackPdf: R('Mack 1994 - Measuring the Variability of Chain Ladder Reserve Estimates.pdf'),
  clarkPdf: R('Clark 2003 - LDF Curve Fitting and Stochastic Reserving.pdf'),
  venterPdf: R('Venter 1998 - Testing the Assumptions of Age-to-Age Factors.pdf'),
  bfPdf: R('Bornhuetter Ferguson 1972 - The Actuary and IBNR.pdf'),
  brosiusPdf: R('Brosius 1993 - Loss Development Using Credibility.pdf'),
  loosePdf: 'Zehnwirth 1994 - Probabilistic Development Factor Models.pdf',
};
const nameOf = (key) => path.basename(FILES[key]);
const stemOf = (key) => nameOf(key).replace(/\.[^.]+$/, '');
const ALSO_CALLED = { Mack: 'Chain Ladder' };
// Which bank unit each PDF of Readings/ joins (its name holds the unit's name as whole words); Brosius becomes its own unit.
const JOINS = { mackPdf: 'Mack', clarkPdf: 'Clark', venterPdf: 'Venter', bfPdf: BF };
const OWN = ['brosiusPdf'];
const UNITS_WITH_FOLDER = [...Object.keys(PAPERS), ...OWN.map(stemOf)];

async function writeFiles(ws) {
  await fs.mkdir(path.join(ws, 'Readings'), { recursive: true });
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
/** The Work Log's newest row of a session over `unit`: its Minutes once they have stopped changing, or null. */
async function loggedMinutes(S, logDb, unit, ms = 6000) {
  const read = () => { const rows = rowsOf(S.workspace, logDb).filter((r) => norm(r.title) === tabTitle(unit)); return rows.length ? num(rows[rows.length - 1].values.Minutes) : null; };
  let last = null; let since = Date.now();
  await until(() => { const v = read(); if (v !== last) { last = v; since = Date.now(); } return v !== null && Date.now() - since > 1300; }, ms, 100);
  return read();
}

// ── The page's clock (Playwright's): the app's own timers and Date, moved by the probe ──
const pad2 = (v) => String(v).padStart(2, '0');
const localDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
/** A wall-clock time of a local date, as an instant (the probe's zone is the app's). */
const localMs = (date, h, m) => new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), h, m, 0).getTime();
/**
 * Put the page's clock in. Returns the phase's today (the page's own date from then on).
 *   'day'    the real now; after 20:00 local it is tomorrow 09:00 instead, so no phase's
 *            hour or two of clock time crosses midnight unless it means to
 *   'night'  23:45 local of today (of tomorrow when the real time is already past 23:35)
 *   'midweek' as 'day', moved on to the next Wednesday when the day is a Sunday, Monday or Tuesday,
 *            so that yesterday and the day before are in this week however a week is counted
 */
async function deskClock(S, mode = 'day') {
  if (S.clockOn) throw new Error('the page\'s clock is already in');
  const now = await S.today();
  let T = now.date; let time = null;
  if (mode === 'day') { if (now.hour >= 20) { T = addDays(now.date, 1); time = localMs(T, 9, 0); } }
  else if (mode === 'night') { if (now.hour === 23 && now.minute >= 35) T = addDays(now.date, 1); time = localMs(T, 23, 45); }
  else {
    if (now.hour >= 20) T = addDays(T, 1);
    while (!['Wed', 'Thu', 'Fri', 'Sat'].includes(weekdayOf(T))) T = addDays(T, 1);
    if (T !== now.date) time = localMs(T, 9, 0);
  }
  await S.page.clock.install(time === null ? undefined : { time: new Date(time) });
  S.clockOn = true;
  const got = await S.today();
  if (got.date !== T) throw new Error(`the page's clock says ${got.date}, wanted ${T}`);
  return T;
}
/** The app closed and opened again in the middle of the day: the page's clock goes on from where it was. */
async function restart(S) {
  const at = S.clockOn ? await S.page.evaluate(() => Date.now()) : null;
  await S.close(); S.clockOn = false;
  await S.open();
  if (at !== null) { await S.page.clock.install({ time: new Date(at + 5000) }); S.clockOn = true; }
}
/**
 * `seconds` of the page's clock, a jump of `step` seconds at a time. A jump fires each timer that
 * is due once, so a clock that looks every second sees one-second looks, as in life; a spreadsheet
 * that redraws sixty times a second does not redraw sixty times for each of them (clock.runFor
 * does, and a minute then takes a minute).
 */
async function jump(S, seconds, step = 1) {
  for (let s = 0; s < seconds; s += step) await S.page.clock.fastForward(step * 1000);
}
/** A point of the question on screen that does nothing when pressed: its words. */
const stemPoint = (S) => S.page.evaluate(() => { const r = window.__ap.scopeEl('root'); const q = r && Array.from(r.querySelectorAll('.st-card__q')).find(window.__ap.shown); if (!q) return null; const b = q.getBoundingClientRect(); return { x: b.x + Math.min(40, b.width / 2), y: b.y + b.height / 2 }; });
/** One sign that he is at the desk: a key, a turn of the wheel, a click or a finger's tap (at `pt` when given). */
async function input(S, kind, pt = null) {
  if (kind === 'key') { await S.page.keyboard.press('Shift'); await sleep(30); return; }
  const at = pt || (await stemPoint(S)) || { x: 720, y: 500 };
  if (kind === 'wheel') { await S.page.mouse.move(at.x, at.y); await S.page.mouse.wheel(0, 40); }
  else if (kind === 'click') await S.page.mouse.click(at.x, at.y);
  else if (kind === 'tap') await S.tap(at);
  else if (kind === 'move') await S.page.mouse.move(at.x + Math.round(Math.random() * 40), at.y + Math.round(Math.random() * 40), { steps: 3 });
  await sleep(40);
}
/** `minutes` at the desk: each minute passes a second at a time and ends with one input, the kinds taking turns. */
async function desk(S, minutes, kinds = ['key'], pt = null) {
  for (let i = 0; i < minutes; i++) { await jump(S, 60); await input(S, kinds[i % kinds.length], pt); }
}
/** `minutes` with no input at all. The first twelve pass five seconds at a time, the rest thirty. */
async function away(S, minutes) {
  const fine = Math.min(minutes, 12);
  await jump(S, fine * 60, 5);
  if (minutes > fine) await jump(S, (minutes - fine) * 60, 30);
}
/** `times` stretches of `minutes` with no input, one input after each. */
async function gaps(S, times, minutes, kind = 'key', pt = null) {
  for (let i = 0; i < times; i++) { await jump(S, minutes * 60, 5); await input(S, kind, pt); }
}

// The plans of this piece.
const week7 = (monThu, fri, sat, sun) => ({ Mon: monThu, Tue: monThu, Wed: monThu, Thu: monThu, Fri: fri, Sat: sat, Sun: sun });
/** The plan around today: it began nine days ago and its exam is in three weeks; every weekday has hours. */
const sprint = (today) => ({ name: 'Sprint', start: addDays(today, -9), exam: addDays(today, 21), goal: 60, personal: week7(2, 1, 3, 4), work: week7(1, 1, 0, 0) });
/** The New Plan sheet filled in and created; `spec.off` fills "Days off before the exam". */
async function makePlanWith(S, spec) {
  await openPlanSheet(S);
  await fillPlanSheet(S, spec);
  await pressCreate(S);
  must(await until(async () => (await tabTitled(S, spec.name)).some((t) => t.active), 40_000, 50), `a tab titled "${spec.name}" in front after Create (the sheet says: ${norm(await S.formText()).slice(0, 200) || 'nothing'})`);
  const p = must(await until(() => { const x = planOf(S.workspace, spec.name); return wholePlan(x) ? x : null; }, 20_000, 100), `the page "${spec.name}" with Plan, Week, Phases and Days under the subject's page`);
  const n = daysBetween(spec.start, spec.exam);
  must(await until(() => daysIn(S.workspace, p).length === n, 30_000, 150), `the ${n} days of "${spec.name}" in Days (it has ${daysIn(S.workspace, p).length})`);
  must(await tabShows(S, n, spec.start, 20_000), `the tab of "${spec.name}" showing its ${n} days`);
  return p;
}
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

// <work>
// What this piece's checks read off the page beyond the helpers above.
function installWorkHelpers() {
  const { shown, scopeEl, accName } = window.__ap;
  const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  const mid = (n) => { const r = n.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; };
  const colour = (str) => { const m = /rgba?\(([^)]+)\)/.exec(String(str || '')); if (m) { const p = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; } const k = /color\(srgb\s+([^)]+)\)/.exec(String(str || '')); if (k) { const p = k[1].split(/[\s/]+/).filter(Boolean).map(parseFloat); return { r: p[0] * 255, g: p[1] * 255, b: p[2] * 255, a: p.length > 3 ? p[3] : 1 }; } return null; };
  const ground = (e) => { const layers = []; for (let p = e; p; p = p.parentElement) { const c = colour(getComputedStyle(p).backgroundColor); if (c && c.a > 0) { layers.push(c); if (c.a >= 0.999) break; } } let base = { r: 255, g: 255, b: 255 }; for (const c of layers.reverse()) base = { r: c.r * c.a + base.r * (1 - c.a), g: c.g * c.a + base.g * (1 - c.a), b: c.b * c.a + base.b * (1 - c.a) }; return base; };
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (a, b) => { const A = lum(a), B = lum(b); return (Math.max(A, B) + 0.05) / (Math.min(A, B) + 0.05); };
  const dialog = () => { const all = Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"], .parallx-modal-box, .st-sheet')).filter(shown); return all.length ? all[all.length - 1] : null; };
  const CHOOSERS = 'select, [role="radiogroup"], button[aria-haspopup="listbox"], [role="combobox"]';
  const live = { on: false, log: [] };
  window.__wo = {
    /** A cell of the canvas table in front: the row titled `title` whose cell under `whereCol` reads `whereText` (any row with that title when not given). */
    cellWhere(dbId, title, column, whereCol, whereText) {
      const surfaces = Array.from(document.querySelectorAll('[data-px-surface="database"]')).filter(shown);
      const sf = dbId ? surfaces.find((e) => (e.getAttribute('data-px-instance') || '').endsWith(dbId)) : surfaces[0];
      if (!sf) return null;
      const heads = Array.from(sf.querySelectorAll('.canvas-db-th__name')).map((h) => norm(h.textContent).toLowerCase());
      const i = heads.indexOf(String(column).toLowerCase()); const w = whereCol ? heads.indexOf(String(whereCol).toLowerCase()) : -1;
      const rows = Array.from(sf.querySelectorAll('tr.canvas-db-row')).filter((r) => norm(r.querySelector('.canvas-db-cell__titletext')?.textContent) === norm(title));
      const tr = rows.find((r) => w < 0 || norm(r.querySelectorAll('td[role="gridcell"]')[w]?.innerText) === String(whereText));
      const td = tr && i >= 0 ? tr.querySelectorAll('td[role="gridcell"]')[i] : null;
      if (!td) return { found: false, heads, rows: rows.length };
      td.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      return { found: true, ...mid(td), text: norm(td.innerText), rows: rows.length };
    },
    /** A point on the sheet's grid, away from its edges. */
    sheetPoint() {
      const p = scopeEl('pane');
      const cs = p ? Array.from(p.querySelectorAll('canvas')).filter(shown).sort((a, b) => b.width * b.height - a.width * a.height)[0] : null;
      if (!cs) return null;
      const r = cs.getBoundingClientRect();
      return { x: r.x + r.width * 0.55, y: r.y + r.height * 0.6 };
    },
    /** The middle of the tab in front. */
    paneMiddle() { const p = scopeEl('pane'); return p ? mid(p) : null; },
    /** Worksheets' own clock on the sheet in front, in seconds. */
    sheetTimer() {
      const p = scopeEl('pane');
      const t = p && Array.from(p.querySelectorAll('.ws-problem__timer')).find(shown);
      if (!t) return null;
      const parts = norm(t.textContent).split(':').map(Number);
      return parts.some((x) => !Number.isFinite(x)) ? null : parts.reduce((a, b) => a * 60 + b, 0);
    },
    /** The chat as it shows: its box, what is in it, how many messages and how many of them the model's. */
    chat() {
      const box = Array.from(document.querySelectorAll('textarea.parallx-chat-input-textarea')).find(shown) || null;
      const msgs = Array.from(document.querySelectorAll('.parallx-chat-message')).filter(shown);
      const mine = msgs.filter((m) => m.classList.contains('parallx-chat-message--assistant'));
      const fresh = Array.from(document.querySelectorAll('button')).find((b) => shown(b) && /^New Chat$/i.test(accName(b)));
      const send = Array.from(document.querySelectorAll('button')).find((b) => shown(b) && /^Send message$/i.test(accName(b)));
      return { shown: !!box, focused: !!box && document.activeElement === box, box: box ? { ...mid(box), value: box.value } : null, send: send ? mid(send) : null, messages: msgs.length, answers: mine.length, lastAnswer: mine.length ? norm(mine[mine.length - 1].innerText).slice(0, 120) : '', newChat: fresh ? mid(fresh) : null };
    },
    /**
     * The controls of `scope` (the dialog in front by default) that choose one of several:
     * a select, a group of radios, a button that opens a list. Each is marked so it can be found again.
     */
    choosers(scope) {
      const s = scope ? scopeEl(scope) : dialog();
      if (!s) return [];
      const out = [];
      Array.from(s.querySelectorAll(CHOOSERS)).filter(shown).forEach((n, i) => {
        n.setAttribute('data-probe-chooser', String(i));
        let row = n;
        while (row.parentElement && row.parentElement !== s && Array.from(row.parentElement.querySelectorAll(CHOOSERS)).filter(shown).length <= 1) row = row.parentElement;
        const o = { i, name: accName(n), row: norm(row.innerText).slice(0, 700), ...mid(n) };
        if (n.tagName === 'SELECT') { o.kind = 'select'; o.labels = Array.from(n.options).map((x) => norm(x.textContent)); o.chosen = norm(n.selectedOptions[0]?.textContent); }
        else if (n.getAttribute('role') === 'radiogroup') {
          const rs = Array.from(n.querySelectorAll('[role="radio"], input[type="radio"]')).filter((r) => shown(r) || shown(r.parentElement));
          o.kind = 'radios'; o.labels = rs.map((r) => accName(r) || norm(r.closest('label')?.textContent));
          const on = rs.find((r) => (r.tagName === 'INPUT' ? r.checked : r.getAttribute('aria-checked') === 'true'));
          o.chosen = on ? (accName(on) || norm(on.closest('label')?.textContent)) : '';
        } else { o.kind = 'list'; o.labels = null; o.chosen = norm(n.innerText); }
        out.push(o);
      });
      return out;
    },
    /** The options of the list that is open now. */
    openOptions() {
      return Array.from(document.querySelectorAll('[role="listbox"] [role="option"], [role="menu"] [role="menuitemradio"]')).filter(shown).map((n) => ({ label: norm(n.innerText), on: n.getAttribute('aria-selected') === 'true' || n.getAttribute('aria-checked') === 'true', ...mid(n) }));
    },
    /** A radio of a marked chooser, by its place. */
    radioPoint(i, k) {
      const n = document.querySelector(`[data-probe-chooser="${i}"]`);
      const rs = n ? Array.from(n.querySelectorAll('[role="radio"], input[type="radio"]')).filter((r) => shown(r) || shown(r.parentElement)) : [];
      return rs[k] ? mid(shown(rs[k]) ? rs[k] : rs[k].parentElement) : null;
    },
    /**
     * Everything on screen that says words like `source`: in its own words, or in the name or
     * tooltip it carries (an icon says it so). Each with how it reads against what it sits on.
     */
    saying(source) {
      const re = new RegExp(source, 'i');
      const out = [];
      for (const n of document.body.querySelectorAll('*')) {
        if (!shown(n) || n.closest('script, style')) continue;
        const own = norm(Array.from(n.childNodes).filter((x) => x.nodeType === 3).map((x) => x.textContent).join(' '));
        const carried = [n.getAttribute('aria-label'), n.getAttribute('title'), n.getAttribute('data-parallx-title'), n.getAttribute('aria-description')].map(norm).filter(Boolean).join(' | ');
        const inWords = !!own && re.test(norm(n.innerText)) && re.test(own) ? norm(n.innerText) : '';
        if (!inWords && !re.test(carried)) continue;
        if (parseFloat(getComputedStyle(n).opacity) === 0) continue;
        const r = n.getBoundingClientRect();
        if (r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) continue;
        let contrast = null;
        if (inWords) { const cs = getComputedStyle(n); const fg = colour(cs.color); const bg = ground(n); if (fg) contrast = Math.round(ratio({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a) }, bg) * 100) / 100; }
        const more = [n.getAttribute('title'), n.getAttribute('data-parallx-title'), n.getAttribute('aria-description'), n.closest('[title]')?.getAttribute('title')].map(norm).filter(Boolean).join(' | ');
        out.push({ text: (inWords || carried).slice(0, 300), inWords: !!inWords, contrast, more: more.slice(0, 400), part: n.closest('[data-part-id]')?.getAttribute('data-part-id') || '', hidden: !!n.closest('[aria-hidden="true"]') });
      }
      return out;
    },
    /** Start writing down what the live regions say (what a screen reader is given to speak), with how each is spoken. */
    liveStart() {
      live.log.length = 0;
      if (live.on) return true;
      live.on = true;
      const last = new WeakMap();
      const scan = () => {
        for (const el of document.querySelectorAll('[aria-live], [role="status"], [role="alert"], [role="log"]')) {
          const text = norm(el.textContent);
          if (last.get(el) === text) continue;
          last.set(el, text);
          if (!text) continue;
          const role = el.getAttribute('role'); const al = el.getAttribute('aria-live');
          live.log.push({ how: al || (role === 'alert' ? 'assertive' : 'polite'), text: text.slice(0, 300), n: live.log.length });
        }
      };
      scan(); live.log.length = 0;
      new MutationObserver(scan).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['aria-live', 'role', 'aria-label'] });
      return true;
    },
    liveLog: () => live.log.slice(),
    /**
     * Count what is left running: the repeating timers alive, and the listeners on the window and
     * the document for the signs that he is there. Counted from the moment this is put in.
     */
    watchStart() {
      if (window.__watch) return true;
      const w = window.__watch = { timers: new Set(), listeners: [] };
      const KINDS = new Set(['keydown', 'keyup', 'keypress', 'pointerdown', 'pointerup', 'pointermove', 'mousedown', 'mousemove', 'click', 'wheel', 'scroll', 'touchstart', 'touchend', 'visibilitychange', 'focus', 'blur']);
      const si = window.setInterval; const ci = window.clearInterval;
      window.setInterval = function (...a) { const id = si.apply(this, a); w.timers.add(id); return id; };
      window.clearInterval = function (id) { w.timers.delete(id); return ci.call(this, id); };
      const add = EventTarget.prototype.addEventListener; const rem = EventTarget.prototype.removeEventListener;
      const cap = (o) => (typeof o === 'boolean' ? o : !!(o && o.capture));
      EventTarget.prototype.addEventListener = function (type, fn, o) {
        if ((this === window || this === document) && KINDS.has(type) && fn && !w.listeners.some((l) => l.t === this && l.type === type && l.fn === fn && l.cap === cap(o))) {
          const l = { t: this, type, fn, cap: cap(o) }; w.listeners.push(l);
          if (o && typeof o === 'object' && o.signal) o.signal.addEventListener('abort', () => { const k = w.listeners.indexOf(l); if (k >= 0) w.listeners.splice(k, 1); });
        }
        return add.call(this, type, fn, o);
      };
      EventTarget.prototype.removeEventListener = function (type, fn, o) {
        if (this === window || this === document) { const k = w.listeners.findIndex((l) => l.t === this && l.type === type && l.fn === fn && l.cap === cap(o)); if (k >= 0) w.listeners.splice(k, 1); }
        return rem.call(this, type, fn, o);
      };
      return true;
    },
    /** The count sees a timer and a listener come and go (the probe's own, put in and taken out). */
    watchWorks() {
      const w = window.__watch; if (!w) return false;
      const a = [w.timers.size, w.listeners.length]; const f = () => {};
      const id = window.setInterval(f, 3_600_000); window.addEventListener('keydown', f, true);
      const b = [w.timers.size, w.listeners.length];
      window.clearInterval(id); window.removeEventListener('keydown', f, true);
      const d = [w.timers.size, w.listeners.length];
      return b[0] === a[0] + 1 && b[1] === a[1] + 1 && d[0] === a[0] && d[1] === a[1];
    },
    watching: () => { const w = window.__watch; if (!w) return null; const by = {}; for (const l of w.listeners) by[l.type] = (by[l.type] || 0) + 1; return { timers: w.timers.size, listeners: w.listeners.length, by }; },
  };
  return true;
}
// </work>

// ── The Work Log as the file has it ─────────────────────────────────────────
const LOG_COLUMNS = ['Date', 'Minutes', 'Unit', 'Tool', 'Kind', 'Items', 'Right', 'Confirmed', 'Origin'];
/** The local day of a Date cell: a date, a local date and time, or a moment with a zone turned into the app's day. */
function dayOfCell(v) {
  if (typeof v === 'number') return localDate(new Date(v));
  const s = String(v ?? '');
  if (/T.*(Z|[+-]\d{2}:?\d{2})$/.test(s)) return localDate(new Date(s));
  return s.slice(0, 10);
}
const idsOf = (v) => (Array.isArray(v) ? v : v ? [v] : []).map((x) => (x && typeof x === 'object' ? String(x.id ?? x.pageId ?? '') : String(x)));
/** Every row of the Work Log: its day, minutes, units by name, tool, kind, items, right, origin. */
function logOf(ws, A) {
  const unit = new Map(rowsOf(ws, A.units).map((r) => [r.pageId, norm(r.title)]));
  return rowsOf(ws, A.log).map((r) => ({
    pageId: r.pageId, title: norm(r.title), day: dayOfCell(r.values.Date), minutes: num(r.values.Minutes),
    units: idsOf(r.values.Unit).map((id) => unit.get(id) ?? id), tool: norm(r.values.Tool), kind: norm(r.values.Kind),
    items: r.values.Items ?? null, right: r.values.Right ?? null, confirmed: r.values.Confirmed ?? null, origin: norm(r.values.Origin),
  }));
}
const TOOL_NAMED = { worksheets: /worksheet/i, flashcards: /flashcard/i, study: /^study$/i };
/** The rows that are of a unit, a kind, a day and a tool (each when given). */
const rowsWhere = (rows, { unit, kind, day, tool } = {}) => rows.filter((r) => (!unit || r.units.includes(unit)) && (!kind || low(r.kind) === low(kind)) && (!day || r.day === day) && (!tool || TOOL_NAMED[tool].test(r.tool)));
const minutesOf = (rows) => rows.reduce((t, r) => t + r.minutes, 0);
const brief = (rows) => rows.map((r) => `${r.day} ${r.tool || '(no tool)'}/${r.kind || '(no kind)'} ${r.units.join('+') || '(no unit)'} ${r.minutes} min, items ${r.items ?? '-'}, right ${r.right ?? '-'}, ${r.origin || '(no origin)'}`);
const between = (v, a, b) => typeof v === 'number' && v >= a && v <= b;
/** The same rows as before, none new and none gone, each with its minutes or one more (a minute may round over while the last seconds land). */
const steady = (before, after) => before.length === after.length && before.every((b, i) => after[i].pageId === b.pageId && after[i].day === b.day && after[i].minutes >= b.minutes && after[i].minutes <= b.minutes + 1);
/** The Work Log's part of the file as one string: every row, every value and when each was last written. */
function logStamp(ws, A) {
  const pages = coreAll(ws, 'SELECT p.id, p.title, p.is_archived, p.updated_at, p.revision FROM database_pages dp JOIN pages p ON p.id = dp.page_id WHERE dp.database_id = ? ORDER BY p.id', [A.log]);
  const values = coreAll(ws, 'SELECT page_id, property_id, value, updated_at FROM page_property_values WHERE database_id = ? ORDER BY page_id, property_id', [A.log]);
  return createHash('sha256').update(JSON.stringify([pages, values])).digest('hex').slice(0, 16);
}

/**
 * THE ALLOWANCE. After work in a tool, the Work Log is given two minutes of the page's clock
 * (twenty seconds at a time, with nothing of the tools showing) and a few real seconds to
 * follow. `read` reads the file; done as soon as `ok` holds and still holds a second later.
 */
async function settle(S, read, ok) {
  let v = null;
  for (let i = 0; i <= 6; i++) {
    v = read();
    if (ok(v)) { await sleep(1000); v = read(); if (ok(v)) return v; }
    if (i < 6) { if (S.clockOn) await jump(S, 20, 5); await sleep(S.clockOn ? 300 : 900); }
  }
  return v;
}
/** The same two minutes passed whatever the file says: for a check that something did not happen. */
async function wait2(S) {
  for (let i = 0; i < 6; i++) { if (S.clockOn) await jump(S, 20, 5); await sleep(S.clockOn ? 250 : 600); }
  await sleep(700);
}

// ── The tools, each driven as a person drives it ────────────────────────────
const PLAN = 'Sprint';
/** Leave whatever tool is showing: the plan's tab in front (a click on its tab). */
async function leave(S) {
  must(await showTab(S, PLAN), `the tab of the plan "${PLAN}", to leave the tool for`);
  await sleep(250);
}
const cardsFile = (workspace) => path.join(workspace, '.parallx', 'extensions', 'flashcards', 'data.db');
const cardsAll = (ws, sql, params = []) => fileAll(cardsFile(ws), sql, params);
// Worksheets: problems by paper. Clark and Friedland are units' names; Hürlimann is no unit's.
const P_PROBLEMS = { clark: 5, friedland: 4, hurlimann: 2 };
const P_LABEL = { clark: 'Clark', friedland: 'Friedland', hurlimann: 'Hürlimann' };
// Seconds in Worksheets' own ledger on the history day, per paper and problem: Clark 15 + 10 minutes, Hürlimann 30.
const HISTORY = { clark: [900, 600], hurlimann: [1800] };
// Flashcards: cards by tag in one deck (clark is a unit's name, chain-ladder is Mack's Also Called, zeta is nobody's), and a deck named for a unit.
const DECK = 'Exam 7 Cards';
const CARD_TAGS = { clark: 6, 'chain-ladder': 3, zeta: 3 };
const CARD_DECKS = { VENTER: 3 };
const RATE = '[role="radiogroup"][aria-label="Rate this problem"] [role="radio"]';
const wo = (S, fn, ...args) => S.page.evaluate(({ fn, args }) => window.__wo[fn](...args), { fn, args });
/** Worksheets: a paper's problems that are not rated, opened from its own dashboard; the first one's sheet in front. */
async function openProblem(S, paper) {
  await S.cmd('worksheet.dashboard');
  must(await until(() => S.has('body', '.ws-dash__paperrow'), 20_000), 'Worksheets\' dashboard with its Progress by paper');
  await sleep(300);
  must(await until(() => S.press('body', new RegExp(`^Quiz ${esc(P_LABEL[paper])} Not rated, \\d+ problems$`), '.ws-dash__bar [role="button"]'), 5000), `the Not rated part of ${P_LABEL[paper]} on Worksheets' dashboard`);
  must(await until(async () => (await S.find('body', /^Easy$/, RATE)).length, 90_000, 200), 'the problem\'s sheet (its rating: Easy, Medium, Hard)');
  must(await until(async () => (await wo(S, 'sheetTimer')) !== null, 5000), 'the clock on the sheet');
  await sleep(1200);
  return (await S.tabs()).find((t) => t.active)?.label || '';
}
/** A number typed into a cell of the sheet in front, and the problem rated. */
async function workProblem(S, grade = 'Easy') {
  const pt = must(await wo(S, 'sheetPoint'), 'the sheet\'s grid');
  await S.page.mouse.click(pt.x, pt.y);
  await sleep(150);
  await S.page.keyboard.type('1200');
  await S.page.keyboard.press('Enter');
  await sleep(400);
  must(await S.press('body', exact(grade), RATE), `the rating ${grade} on the sheet`);
  await sleep(600);
}
/** The next problem of the quiz in front. */
async function nextProblem(S) {
  const before = await S.page.evaluate(() => Array.from(document.querySelectorAll('.ws-sessionbar__dot--cur')).map((n) => n.getAttribute('aria-label') || '').join('|'));
  must(await S.press('pane', /^Next Problem$/), '"Next Problem" on the quiz');
  must(await until(async () => (await S.page.evaluate(() => Array.from(document.querySelectorAll('.ws-sessionbar__dot--cur')).map((n) => n.getAttribute('aria-label') || '').join('|'))) !== before && (await S.find('body', /^Easy$/, RATE)).length > 0, 30_000, 150), 'the next problem\'s sheet');
  await sleep(1200);
}
/** Flashcards: the cards of a tag, on its own screen; the first card showing. */
async function openCards(S, tag) {
  await S.cmd('flashcards.studyTag', tag);
  must(await until(async () => (await S.find('body', /^Show Answer$/)).length, 30_000, 200), `a card of the tag ${tag} on Flashcards' screen (Show Answer)`);
  await sleep(400);
}
/** The card showing is turned and graded. */
async function gradeCard(S, grade) {
  must(await until(() => S.press('body', /^Show Answer$/), 8000, 100), 'Show Answer on the card');
  must(await until(() => S.press('body', new RegExp(`\\b${grade}\\b`), 'button.fc-grade'), 8000, 100), `the grade ${grade} on the card`);
  await sleep(700);
}
/** The PDF of a unit, opened from the unit's own tab. Returns its title. */
async function openUnitPdf(S, unit) {
  if (!(await showTab(S, tabTitle(unit)))) await openUnit(S, unit);
  const w = await waitTab(S, (g, it) => it.some((i) => /\.pdf$/i.test(i.title)));
  const it = must(w.items.find((i) => /\.pdf$/i.test(i.title)), `a PDF listed on the tab "${tabTitle(unit)}" (it lists: ${w.items.map((i) => i.title).join(', ') || 'nothing'})`);
  await S.click(it.open);
  must(await until(async () => { const a = await S.active(); return a && a.typeId === 'parallx.editor.pdf' && a.name === it.title; }, 10_000, 100), `the PDF "${it.title}" in front`);
  await sleep(1500);
  return it.title;
}
/** A file opened by the workbench's own command (the Explorer's double click does the same). */
async function openFileTab(S, rel) {
  const full = path.join(S.workspace, rel);
  await S.cmd('file.openFile', full);
  must(await until(async () => { const a = await S.active(); return a && a.name === path.basename(rel); }, 10_000, 100), `"${path.basename(rel)}" in front`);
  await sleep(1500);
}
const chat = (S) => wo(S, 'chat');
/** The chat's panel closed (the workbench's own command), when it shows. */
async function hideChat(S) {
  if (!(await chat(S)).shown) return;
  await S.cmd('workbench.action.toggleAuxiliaryBar');
  must(await until(async () => !(await chat(S)).shown, 4000), 'the chat\'s panel closed');
  await sleep(200);
}
/** What is staged in the chat is sent with Enter; the model's answer is on screen. */
async function sendStaged(S, typed = '') {
  // The panel slides in: its box is pressed once it has stopped moving, and again if the press did not land in it.
  let last = null;
  const c0 = must(await until(async () => { const c = await chat(S); const still = c.shown && last && Math.abs(last.x - c.box.x) < 1 && Math.abs(last.y - c.box.y) < 1; last = c.shown ? c.box : null; return still ? c : null; }, 8000, 200), 'the chat showing');
  for (let i = 0; i < 3; i++) { await S.click((await chat(S)).box || c0.box); await sleep(200); if ((await chat(S)).focused) break; }
  must((await chat(S)).focused, 'the chat\'s box holding the keys');
  if (typed) await S.page.keyboard.type(typed);
  await sleep(150);
  await S.page.keyboard.press('Enter');
  const answered = async () => { const c = await chat(S); return c.answers > c0.answers && c.lastAnswer ? c : null; };
  let c1 = await until(answered, 6000, 150);
  if (!c1) { const c = await chat(S); if (c.send && c.box.value) await S.click(c.send); c1 = await until(answered, 30_000, 150); }
  must(c1, 'the model\'s answer in the chat');
  await sleep(600);
  return c1;
}
/**
 * A chat opened from a unit in Study: the unit's own Discuss action when its tab has one
 * (a control whose name begins "Discuss"), else "Discuss in Chat" on an answered question of a
 * session over the unit, which is then ended and its tab closed, so only the chat is left.
 * The prompt is sent and answered. Returns how it was opened.
 */
async function discussFrom(S, unit) {
  if (!(await showTab(S, tabTitle(unit)))) await openUnit(S, unit);
  await sleep(500);
  const own = (await S.find('pane', /^Discuss\b/i)).find((h) => !h.disabled);
  if (own) {
    await S.click(own);
    const c = must(await until(async () => { const x = await chat(S); return x.shown ? x : null; }, 8000), 'the chat after the unit\'s Discuss');
    await sendStaged(S, c.box.value ? '' : `Explain what ${unit} assumes.`);
    return 'the unit\'s own Discuss';
  }
  const card = await startSession(S, unit);
  await answer(S, card, TYPED);
  must(await S.press('root', /^Discuss in Chat\b/), '"Discuss in Chat" on the answered question');
  must(await until(async () => { const x = await chat(S); return x.shown && x.box.value.includes('Reserving question') ? x : null; }, 8000), 'the chat with the question staged');
  await sendStaged(S);
  must(await showTab(S, `Study · ${tabTitle(unit)}`), 'the session\'s tab');
  await endSession(S);
  await closeSessionTabs(S);
  return 'Discuss in Chat on a question of a session over the unit';
}
/** The tabs of sessions (and of a setup sheet) closed by their own ×; the plan's and the units' tabs stay. */
async function closeSessionTabs(S) {
  for (let i = 0; i < 5; i++) {
    const t = (await S.tabs()).find((x) => /^Study( · |$)/.test(x.label));
    if (!t) return;
    await closeTab(S, t.label);
    await sleep(300);
    await S.press('body', /^(End Session|Leave|Close)\b/, '.parallx-modal-box button');
    await sleep(300);
  }
}
/** The chat's box: where the keys of a discussion go. */
async function inChat(S) {
  for (let i = 0; i < 3; i++) { const c = await chat(S); must(c.shown, 'the chat showing'); await S.click(c.box); await sleep(200); if ((await chat(S)).focused) return c.box; }
  throw new Error('the chat\'s box did not take the keys');
}
/** Another chat, not opened from Study: the chat's own New Chat, a question typed and answered. */
async function otherChat(S) {
  let empty = false;
  for (let i = 0; i < 3 && !empty; i++) {
    await sleep(500);                                 // the panel may still be sliding in
    const c = await chat(S);
    must(c.newChat, 'the chat\'s New Chat button');
    await S.click(c.newChat);
    empty = !!(await until(async () => (await chat(S)).answers === 0, 2500));
  }
  must(empty, 'an empty chat after New Chat');
  await sendStaged(S, 'What is a reserve?');
}
/** A session over a unit: its first question answered, then `during`, then End Session. Returns the Minutes logged. */
async function sitting(S, A, unit, during) {
  const card = await startSession(S, unit);
  await answer(S, card, TYPED);
  await during();
  await endSession(S);
  const m = await loggedMinutes(S, A.log, unit);
  await closeSessionTabs(S);
  return m;
}

// ── Settings ─────────────────────────────────────────────────────────────────
async function openSettings(S) {
  await S.cmd('settings.open');
  must(await until(async () => (await S.formOpen()) && (await S.find('form', /^Search settings$/, 'input')).length, 8000), 'Settings, with its search field');
  await sleep(400);
}
async function closeSettings(S) {
  if (!(await S.formOpen())) return;
  (await S.press('form', /^Close Settings$/)) || (await S.page.keyboard.press('Escape'));
  await until(async () => !(await S.formOpen()), 3000);
  await sleep(300);
}
async function searchSettings(S, words) {
  const f = must((await S.find('form', /^Search settings$/, 'input'))[0], 'the search field of Settings');
  await S.click(f); await S.page.keyboard.press('Control+A'); await S.page.keyboard.type(words);
  await sleep(900);
}
const firstNumber = (label) => { const m = /\d+/.exec(String(label)); return m ? Number(m[0]) : null; };
/**
 * In Settings (open, searched for each of `words` in turn): the first control that chooses one
 * of several and whose choices `fits`. A button that opens a list is opened to read it.
 * Returns { words, name, row, labels, chosen, i, kind } or null, and what it looked at.
 */
async function findChooser(S, words, fits) {
  const looked = [];
  for (const w of words) {
    await searchSettings(S, w);
    const all = await wo(S, 'choosers');
    for (const k of all.slice(0, 12)) {
      let labels = k.labels; let chosen = k.chosen;
      if (k.kind === 'list') {
        await S.page.mouse.click(k.x, k.y);
        const opts = (await until(async () => { const o = await wo(S, 'openOptions'); return o.length ? o : null; }, 1500, 80)) || [];
        labels = opts.map((o) => o.label); chosen = (opts.find((o) => o.on) || {}).label ?? chosen;
        const again = (await wo(S, 'choosers')).find((x) => x.i === k.i);
        await S.page.mouse.click((again || k).x, (again || k).y);
        await until(async () => !(await wo(S, 'openOptions')).length, 1500, 80);
      }
      looked.push(`${w}: ${k.name || '(no name)'} [${(labels || []).join(', ')}]`);
      if (labels && fits(labels)) return { found: { words: w, name: k.name, row: k.row, labels, chosen, i: k.i, kind: k.kind }, looked };
    }
  }
  return { found: null, looked };
}
/** Choose, in the control findChooser found (Settings still showing it), the choice at place `k`. */
async function choose(S, ctl, k) {
  const now = must((await wo(S, 'choosers')).find((x) => x.i === ctl.i), 'the control again');
  if (ctl.kind === 'select') await S.page.selectOption(`[data-probe-chooser="${ctl.i}"]`, { index: k });
  else if (ctl.kind === 'radios') await S.click(must(await wo(S, 'radioPoint', ctl.i, k), 'the choice'));
  else { await S.page.mouse.click(now.x, now.y); const o = must(await until(async () => { const x = await wo(S, 'openOptions'); return x.length ? x : null; }, 1500, 80), 'the list of choices'); await S.page.mouse.click(o[k].x, o[k].y); }
  await sleep(600);
}
const IDLE_CHOICES = [5, 10, 15, 30];
const idleFits = (labels) => labels.length === 4 && same(labels.map(firstNumber).sort((a, b) => a - b), IDLE_CHOICES);
// The words a person would look for the idle time under.
const IDLE_WORDS = ['idle', 'counting', 'no input', 'away', 'clock'];

// ── Seeding the tools (history only) and the workspaces the phases start from ─
/**
 * Worksheets' bank and Flashcards' decks, written into the workspace's files with the app
 * closed, into the tables the tools made. The only time written is Worksheets' own ledger on the
 * history day (two days before the seed was made): what the tool had counted before this piece.
 */
function seedTools(ws, histDay) {
  let d = new DatabaseSync(coreFile(ws));
  const NOW = Date.now();
  const noon = localMs(histDay, 12, 0);
  const sheet = (title) => JSON.stringify({ id: 'wb', sheetOrder: ['s1'], appVersion: '0.1', sheets: { s1: { id: 's1', name: 'Sheet1', rowCount: 40, columnCount: 12, cellData: { 0: { 0: { v: title } }, 2: { 1: { v: 'Given the following information:' } }, 4: { 1: { v: 'Accident Year' }, 2: { v: 'Reported' } }, 5: { 1: { v: 2021 }, 2: { v: 1200 } }, 7: { 1: { v: 'Question: estimate the ultimate loss.' } } } } } });
  try {
    d.exec('BEGIN');
    const insItem = d.prepare("INSERT INTO ws_items (title, question_md, created_at, sheet_json, paper, source, kind, quadrant, sheet_name, source_label) VALUES (?, '', ?, ?, ?, 'rf', 'quant', 1, ?, 'Probe workbook')");
    const insAttempt = d.prepare("INSERT INTO ws_attempts (item_id, started_at, updated_at, cells_json, self_grade, completed, seconds, session_id, imported, worked_at) VALUES (?, ?, ?, '', 'easy', 1, ?, '', 0, ?)");
    const insTime = d.prepare("INSERT INTO ws_study_time (day, item_id, session_id, seconds) VALUES (?, ?, '', ?)");
    for (const [paper, n] of Object.entries(P_PROBLEMS)) for (let i = 1; i <= n; i++) {
      const title = `RF ${P_LABEL[paper]} - ${i}`;
      const id = Number(insItem.run(title, NOW - (40 + i) * DAY_MS, sheet(title), paper, title).lastInsertRowid);
      const secs = (HISTORY[paper] || [])[i - 1];
      if (secs) { insAttempt.run(id, noon - secs * 1000, noon, secs, noon); insTime.run(histDay, id, secs); }
    }
    d.exec('COMMIT');
  } finally { d.close(); }
  d = new DatabaseSync(cardsFile(ws));
  try {
    d.exec('BEGIN');
    const insDeck = d.prepare("INSERT INTO fc_decks (name, description, created_at) VALUES (?, '', ?)");
    const insCard = d.prepare('INSERT INTO fc_cards (deck_id, front, back, tags, created_at) VALUES (?, ?, ?, ?, ?)');
    const cards = (deckId, tag, n, label) => { for (let i = 1; i <= n; i++) insCard.run(deckId, `Card ${label} ${i}: what holds?`, `Answer ${label} ${i}.`, tag, NOW - 30 * DAY_MS); };
    const main = Number(insDeck.run(DECK, NOW - 40 * DAY_MS).lastInsertRowid);
    for (const [tag, n] of Object.entries(CARD_TAGS)) cards(main, tag, n, tag);
    for (const [name, n] of Object.entries(CARD_DECKS)) cards(Number(insDeck.run(name, NOW - 40 * DAY_MS).lastInsertRowid), '', n, name);
    d.exec('COMMIT');
  } finally { d.close(); }
}
/** Worksheets' own ledger: the seconds it has for a day, by paper. */
const ledger = (ws, day) => Object.fromEntries(coreAll(ws, 'SELECT i.paper AS paper, SUM(t.seconds) AS s FROM ws_study_time t JOIN ws_items i ON i.id = t.item_id WHERE t.day = ? GROUP BY i.paper', [day]).map((r) => [r.paper, Number(r.s)]));

// Study may know a subject by its workspace, so the phases all run on the one
// workspace path it was made in, put back from a snapshot before each.
//   seed     the six PDFs on disk, the question bank made through the chat's own tools, and, with
//            the app closed, Worksheets' problems, its ledger of the history day and Flashcards' cards
//   subject  the subject "Exam 7" made through the New Subject sheet from the bank and the folder
//            Readings (six units, five of them holding a PDF); Mack also called Chain Ladder
//   plan     the plan "Sprint" made through the New Plan sheet: begun nine days before, exam in three weeks
const BASE_WORKSPACE = path.join(OUT, 'runs', 'subject-workspace');
const bases = { seed: { snapshot: null, failed: '' }, subject: { snapshot: null, failed: '' }, plan: { snapshot: null, failed: '' } };
const BASE_FROM = { seed: null, subject: 'seed', plan: 'subject' };
/** The day the seed was made (the app's own date then) and the history day, two days before it. */
let SEED_DAY = ''; let HIST = '';
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
      const t = await S.today();
      SEED_DAY = t.date; HIST = addDays(SEED_DAY, -2);
      const bank = await seedDatabase(S, BANK, bankColumns(Object.keys(PAPERS)), SEED.map((q) => ({ title: q.question, values: { 'Model Answer': q.answer, Paper: q.paper } })));
      must(rowsOf(ws, bank).length === SEED.length, `the ${SEED.length} seeded questions in the workspace file`);
      // The other tools' tables exist once each has run; their data goes in with the app closed.
      must(await until(() => coreAll(ws, "SELECT COUNT(*) AS n FROM sqlite_master WHERE name IN ('ws_items', 'ws_attempts', 'ws_study_time')")[0].n === 3 && cardsAll(ws, "SELECT COUNT(*) AS n FROM sqlite_master WHERE name IN ('fc_decks', 'fc_cards', 'fc_reviews')")[0]?.n === 3, 30_000, 250), 'the tables of Worksheets (in the workspace file) and of Flashcards (in its own file)');
      await sleep(1500);
      await S.close();
      seedTools(ws, HIST);
      await S.open();
      console.log(`[probe] the seed: ${SEED.length} questions on ${Object.keys(PAPERS).length} papers, ${Object.keys(FILES).length} PDFs, ${Object.values(P_PROBLEMS).reduce((a, n) => a + n, 0)} problems, ${cardsAll(ws, 'SELECT COUNT(*) AS n FROM fc_cards')[0].n} cards; zone ${t.zone}, made on ${SEED_DAY}, history on ${HIST}`);
    } else if (kind === 'subject') {
      await makeSubject(S, { name: SUBJECT, questions: BANK, folder: 'Readings' });
      const subj = await settledSubject(S, SUBJECT);
      must(await openDb(S, subj.units.id), 'Units open in the app');
      const also = must(col(columns(ws, subj.units.id), 'Also Called'), 'the column Also Called in Units');
      const mack = must(rowTitled(ws, subj.units.id, 'Mack'), 'the unit Mack');
      const had = norm(mack.values['Also Called']);
      // Units' own command for a cell; what New Subject put there (the joined file's name) is kept.
      await S.cmd('database.setCell', mack.pageId, also.id, had ? `${had}, ${ALSO_CALLED.Mack}` : ALSO_CALLED.Mack);
      must(await until(() => norm(rowTitled(ws, subj.units.id, 'Mack')?.values['Also Called']).includes(ALSO_CALLED.Mack), 4000), 'Mack\'s Also Called stored');
      await closeTab(S, 'Units');
      await showStudySidebar(S);
      must(await until(async () => { const t = await subjectsText(S); return t && Object.keys(PAPERS).every((u) => t.includes(u)) ? t : null; }, 12_000), `the subject and its units in the sidebar (${(await subjectsText(S)) ?? 'no Subjects section'})`);
      console.log(`[probe] the subject "${SUBJECT}" was made through the New Subject sheet from the bank and the folder Readings: ${unitTitles(ws, subj.units.id).length} units`);
    } else {
      const spec = sprint((await S.today()).date);
      await makePlanWith(S, spec);
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
/** The plan as made, with today in it: its tab in front, showing its days. */
async function planInFront(S) {
  const p = mustPlan(S.workspace, PLAN);
  const start = dateOf(rowsOf(S.workspace, p.plan.id)[0]?.values['Start Date']);
  await openPlan(S, PLAN);
  must(await tabShows(S, daysIn(S.workspace, p).length, start, 15_000), `the tab of "${PLAN}" showing its days`);
  return { p, start };
}
/** A day's Done as the plan's tab shows it, in hours (null: nothing shown). The tab is brought to the front. */
async function doneShown(S, start, day) {
  await showTab(S, PLAN);
  const cells = await doneCells(S, start, [day]);
  return cells && day in cells ? doneHours(cells[day]) : null;
}
/** Wait until a day's Done in the tab is `minutes` (to the tab's rounding). Returns what it shows. */
async function doneIs(S, start, day, minutes, ms = 4000) {
  let got = null;
  await until(async () => { got = await doneShown(S, start, day); return near(got, minutes / 60, 0.06); }, ms, 120);
  return got;
}
/** A number typed, with the keys, into a cell of a row of a canvas table (the row titled so; `where` picks among rows of one title by another cell's words). */
async function typeInRow(S, dbId, title, column, text, where = null) {
  must(await openDb(S, dbId), 'the table open in the app');
  const get = async () => { const x = await wo(S, 'cellWhere', dbId, title, column, where ? where[0] : null, where ? where[1] : null); return x && x.found ? x : null; };
  must(await until(get, 5000), `the cell ${column} of the row "${String(title).slice(0, 50)}"${where ? ` whose ${where[0]} reads ${where[1]}` : ''}`);
  await sleep(300);
  await S.click(await get());
  must(await until(() => S.page.evaluate(() => window.__pp.editorOpen()), 1500, 60), `an editor in the cell ${column}`);
  await S.page.keyboard.press('Control+A');
  await S.page.keyboard.type(String(text));
  await S.page.keyboard.press('Enter');
  await sleep(500);
}
/** Worksheets' own "Progress by paper", read off its dashboard: { label: [easy, medium, hard, not rated] }, and what the dashboard says of time. */
async function dashboardSays(S) {
  await S.cmd('worksheet.dashboard');
  must(await until(() => S.has('body', '.ws-dash__paperrow'), 20_000), 'Worksheets\' dashboard with its Progress by paper');
  await sleep(400);
  const rows = await S.page.evaluate(() => Array.from(document.querySelectorAll('.ws-dash__paperrow')).filter(window.__ap.shown).map((r) => ({ label: (r.querySelector('.ws-dash__papername')?.textContent || '').trim(), aria: r.querySelector('.ws-dash__bar')?.getAttribute('aria-label') || '' })));
  const papers = {};
  for (const r of rows) { const m = /: (\d+) easy, (\d+) medium, (\d+) hard, (\d+) not rated$/.exec(r.aria); if (m) papers[r.label] = m.slice(1, 5).map(Number); }
  const time = (/Time studied\s+([\dhm ]+?)\s+Rated/i.exec(norm(await S.text('pane'))) || [])[1] || '';
  await closeFront(S);
  return { papers, time: norm(time) };
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

phase(0, 'The ground the checks stand on (the app as it is today; none of it is new)', 'plan', {
  '0.1': 'the app runs in the zone the probe asked for, gives today as a local date, and the probe\'s own dates are in that zone',
  '0.2': 'the seed as the app shows it: the subject and its six units in the sidebar; five units hold their PDF in Material; the sixth PDF is on disk and in no unit\'s Material; Mack is also called Chain Ladder',
  '0.3': 'the three tools are on: Worksheets\' dashboard shows the seeded papers and the 55 minutes of its own ledger; Flashcards has the seeded cards',
  '0.4': 'the plan made through the sheet has today in it (its row is marked), and the Work Log has the columns Date, Minutes, Unit, Tool, Kind, Items, Right, Confirmed, Origin',
  '0.5': 'Done is the Work Log\'s Minutes by local day: a row of 90 minutes three days ago adds 1.5 to that day, and a row of 30 minutes at 23:30 five days ago adds 30 minutes to that day and nothing to the next',
  '0.6': 'the page\'s clock moves by jumps of a second: a minute passes in a few real seconds, and a Study session with six minutes at the desk (a key each minute) is logged as 6 to 8, one row: Study, Questions, the unit, App',
  '0.7': 'Worksheets driven for real: a Friedland problem opened from its dashboard, a cell typed, rated Easy; after seven minutes at the desk and 61 away its own clock on the sheet reads 7 to 8 minutes and its own ledger has them for today',
  '0.8': 'Flashcards driven for real: the cards of the tag clark on its screen, one held two minutes and graded Good, the next graded Again; its own record has both, the first held two minutes of the page\'s clock',
  '0.9': 'reading: Mack\'s tab lists its PDF and "Open" puts the PDF pane in front on that file; the PDF that is in no unit opens too',
  '0.10': 'a chat opened from a unit: the question is staged in the chat, Enter sends it and the stand-in model answers; New Chat starts another',
  '0.11': 'each of the three tools can be turned off and on (its command goes and comes back)',
  '0.12': 'Settings finds a setting by its words and the probe reads its choices, which one is chosen, and chooses another (Worksheets\' decimals: 2, 4, 6, 8, Full)',
  '0.13': 'a Minutes cell typed by hand in the Work Log\'s table is stored',
  '0.14': 'the app closed and opened in the middle of the day: the same Work Log rows, the subject in the sidebar, the three tools on',
  '0.15': 'Appearance switches to light and back to dark',
}, async (S, c, A) => {
  const ws = S.workspace;
  const real = await S.today();
  await check(c, '0.1', async () => [/^\d{4}-\d{2}-\d{2}$/.test(real.date) && (process.platform === 'win32' || real.zone === ZONE) && localDate(new Date()) === real.date, { ...real, asked: ZONE, probeSays: localDate(new Date()) }]);
  await check(c, '0.2', async () => {
    await showStudySidebar(S);
    const side = (await subjectsText(S)) || '';
    const units = unitTitles(ws, A.units);
    const held = Object.fromEntries(Object.entries({ ...JOINS, brosiusPdf: stemOf('brosiusPdf') }).map(([k, u]) => [u, unitHolds(ws, A.units, u, k)]));
    const looseHeldBy = units.filter((u) => unitHolds(ws, A.units, u, 'loosePdf'));
    const also = norm(rowTitled(ws, A.units, 'Mack')?.values['Also Called']);
    return [Object.keys(PAPERS).every((u) => side.includes(u)) && same([...units].sort(), [...UNITS_WITH_FOLDER].sort()) && Object.values(held).every(Boolean) && looseHeldBy.length === 0 && existsSync(path.join(ws, FILES.loosePdf)) && also.includes('Chain Ladder'),
      { sidebar: side.slice(0, 140), units, holdsItsPdf: held, loosePdfHeldBy: looseHeldBy, mackAlsoCalled: also }];
  });
  await check(c, '0.3', async () => {
    const on = {}; for (const [t, id] of Object.entries(TOOL_COMMAND)) on[t] = await S.hasCommand(id);
    const dash = await dashboardSays(S);
    const cards = cardsAll(ws, 'SELECT COUNT(*) AS n FROM fc_cards')[0].n;
    const want = { Clark: [2, 0, 0, 3], Friedland: [0, 0, 0, 4], 'Hürlimann': [1, 0, 0, 1] };
    return [Object.values(on).every(Boolean) && Object.keys(dash.papers).length === 3 && Object.entries(want).every(([k, v]) => same(dash.papers[k], v)) && /^55\s*m/.test(dash.time) && cards === 15 && same(ledger(ws, HIST), { clark: 1500, hurlimann: 1800 }),
      { on, dashboard: dash, cards, ledgerOfTheHistoryDay: ledger(ws, HIST) }];
  });
  const { p, start } = await planInFront(S);
  await check(c, '0.4', async () => {
    const t = await S.dayTable(start);
    const marked = (t?.rows || []).filter((r) => r.current).map((r) => r.date);
    const cols = columns(ws, A.log).map((x) => x.name);
    const days = daysIn(ws, p).map((d) => d.date);
    await S.shot('00-plan');
    return [same(marked, [real.date]) && days.includes(real.date) && days.includes(HIST) && LOG_COLUMNS.every((n) => cols.includes(n)), { marked, planFrom: days[0], planTo: days[days.length - 1], workLogColumns: cols }];
  });
  await check(c, '0.5', async () => {
    const d3 = addDays(real.date, -3); const d5 = addDays(real.date, -5); const d4 = addDays(real.date, -4);
    const before = { [d3]: (await doneShown(S, start, d3)) || 0, [d5]: (await doneShown(S, start, d5)) || 0, [d4]: (await doneShown(S, start, d4)) || 0 };
    await addRow(S, A.log, 'Evening problems', { Date: `${d3}T19:00`, Minutes: 90 });
    await addRow(S, A.log, 'Late reading', { Date: `${d5}T23:30`, Minutes: 30 });
    const ok = await until(async () => near(await doneShown(S, start, d3), before[d3] + 1.5, 0.01) && near(await doneShown(S, start, d5), before[d5] + 0.5, 0.06), 6000, 150);
    const after = { [d3]: await doneShown(S, start, d3), [d5]: await doneShown(S, start, d5), [d4]: (await doneShown(S, start, d4)) || 0 };
    return [!!ok && near(after[d4], before[d4], 0.001), { before, after }];
  });
  await check(c, '0.13', async () => {
    await typeInRow(S, A.log, 'Evening problems', 'Minutes', 75);
    const stored = await until(() => num(rowTitled(ws, A.log, 'Evening problems')?.values.Minutes) === 75, 3000, 50);
    await closeTab(S, 'Work Log');
    return [!!stored, { minutesInTheFile: rowTitled(ws, A.log, 'Evening problems')?.values.Minutes }];
  });
  await check(c, '0.12', async () => {
    await openSettings(S);
    const fits = (labels) => same(labels.map((l) => l.toLowerCase()), ['2', '4', '6', '8', 'full']);
    const a = await findChooser(S, ['decimals'], fits);
    if (!a.found) { await closeSettings(S); return [false, a.looked]; }
    await choose(S, a.found, 2);
    await closeSettings(S);
    await openSettings(S);
    const b = await findChooser(S, ['decimals'], fits);
    if (b.found) await choose(S, b.found, 1);
    await closeSettings(S);
    return [a.found.chosen === '4' && !!b.found && b.found.chosen === '6', { name: a.found.name, choices: a.found.labels, chosenAtFirst: a.found.chosen, afterChoosingTheThird: b.found ? b.found.chosen : null }];
  });
  await check(c, '0.11', async () => {
    const got = {};
    for (const t of ['worksheets', 'flashcards', 'study']) {
      await S.setTool(t, false); const off = !(await S.hasCommand(TOOL_COMMAND[t]));
      await S.setTool(t, true); got[t] = { off, onAgain: await S.hasCommand(TOOL_COMMAND[t]) };
    }
    await showStudySidebar(S);
    must(await until(async () => ((await subjectsText(S)) || '').includes('Mack'), 12_000), 'the subject back in the sidebar');
    return [Object.values(got).every((g) => g.off && g.onAgain), got];
  });
  await planInFront(S);
  const T = await deskClock(S);
  await check(c, '0.6', async () => {
    const a = await S.today(); const t0 = Date.now();
    await jump(S, 60);
    const realMs = Date.now() - t0; const b = await S.today();
    const m = await sitting(S, A, 'Clark', () => desk(S, 6));
    const rows = rowsWhere(logOf(ws, A), { unit: 'Clark', day: T });
    const r = rows[0];
    return [b.ms - a.ms >= 60_000 && b.ms - a.ms < 60_000 + realMs + 5000 && realMs < 20_000 && between(m, 6, 8) && rows.length === 1 && TOOL_NAMED.study.test(r.tool) && r.kind === 'Questions' && r.origin === 'App',
      { pageClockMovedMs: b.ms - a.ms, realMs, minutesLogged: m, rows: brief(rows) }];
  });
  await check(c, '0.7', async () => {
    await openProblem(S, 'friedland');
    await workProblem(S);
    await desk(S, 7);
    const atDesk = await wo(S, 'sheetTimer');
    await away(S, 61);
    await sleep(300);
    const timer = await wo(S, 'sheetTimer');
    await S.shot('00-worksheets-after-an-hour-away');
    await leave(S);
    for (let i = 0; i < 4; i++) await closeFront(S);
    const secs = await until(() => { const s = ledger(ws, T).friedland; return between(s, 400, 500) ? s : null; }, 6000, 200);
    const rated = coreAll(ws, "SELECT COUNT(*) AS n FROM ws_attempts a JOIN ws_items i ON i.id = a.item_id WHERE i.paper = 'friedland' AND a.self_grade = 'easy'")[0].n;
    return [between(timer, 415, 490) && between(atDesk, 415, 490) && !!secs && rated === 1, { clockOnTheSheetAfterSevenMinutes: atDesk, afterAnHourAway: timer, ledgerSecondsToday: ledger(ws, T), friedlandRatedEasy: rated }];
  });
  await check(c, '0.8', async () => {
    await openCards(S, 'clark');
    await desk(S, 2);
    await gradeCard(S, 'Good');
    await gradeCard(S, 'Again');
    await S.shot('00-flashcards');
    const rows = await until(() => { const r = cardsAll(ws, 'SELECT r.rating, r.ms_taken, c.tags FROM fc_reviews r JOIN fc_cards c ON c.id = r.card_id ORDER BY r.id'); return r.length >= 2 ? r : null; }, 5000, 100);
    await closeFront(S);
    return [!!rows && rows.length === 2 && rows[0].rating === 3 && rows[1].rating === 1 && rows.every((r) => r.tags === 'clark') && rows[0].ms_taken >= 110_000, rows ? rows.map((r) => ({ ...r })) : cardsAll(ws, 'SELECT rating, ms_taken FROM fc_reviews').map((r) => ({ ...r }))];
  });
  await check(c, '0.9', async () => {
    const title = await openUnitPdf(S, 'Mack');
    const a = await S.active();
    await S.shot('00-pdf');
    await openFileTab(S, FILES.loosePdf);
    const b = await S.active();
    await closeFront(S); await showTab(S, title); await closeFront(S);
    return [title === nameOf('mackPdf') && a.typeId === 'parallx.editor.pdf' && path.basename(a.file) === nameOf('mackPdf') && b.typeId === 'parallx.editor.pdf' && b.name === nameOf('loosePdf'), { opened: title, inFront: a, thenTheLooseOne: b.name }];
  });
  await check(c, '0.10', async () => {
    const how = await discussFrom(S, 'Venter');
    const one = await chat(S);
    await S.shot('00-chat');
    await otherChat(S);
    const two = await chat(S);
    await hideChat(S);
    return [one.answers >= 1 && !!one.lastAnswer && two.answers === 1, { openedBy: how, answered: one.lastAnswer, messages: one.messages, afterNewChat: { messages: two.messages, answers: two.answers } }];
  });
  await check(c, '0.14', async () => {
    const before = logOf(ws, A).map((r) => [r.pageId, r.minutes]);
    await restart(S);
    await showStudySidebar(S);
    const side = await until(async () => { const t = (await subjectsText(S)) || ''; return t.includes('Mack') ? t : null; }, 12_000);
    const on = {}; for (const [t, id] of Object.entries(TOOL_COMMAND)) on[t] = await S.hasCommand(id);
    const after = logOf(ws, A).map((r) => [r.pageId, r.minutes]);
    const now = await S.today();
    return [!!side && Object.values(on).every(Boolean) && same(before, after) && before.length >= 3 && now.date === T, { rowsBefore: before.length, rowsAfter: after.length, on, todayAfter: now.date }];
  });
  await check(c, '0.15', async () => {
    const bright = () => S.page.evaluate(() => { const m = /rgba?\(([^)]+)\)/.exec(getComputedStyle(document.body).backgroundColor) || /rgba?\(([^)]+)\)/.exec(getComputedStyle(document.documentElement).backgroundColor); const p = m ? m[1].split(/[\s,/]+/).map(parseFloat) : [0, 0, 0]; return (p[0] + p[1] + p[2]) / 3; });
    const dark0 = await bright();
    await setMode(S, 'light'); const light = await bright();
    await setMode(S, 'dark'); const dark1 = await bright();
    return [light > 160 && dark0 < 90 && dark1 < 90, { dark: dark0, light, darkAgain: dark1 }];
  });
});

phase(1, 'The record is his Work Log: Done is the sum of its Minutes by local day, and nothing else feeds it', 'plan', {
  '1.1': '[history] the 25 minutes Worksheets had counted on Clark two days before the seed are in the Work Log (a row that is not Study\'s own, Origin App), and that day\'s Done in the plan\'s tab is the sum of the Work Log\'s Minutes for the day',
  '1.2': '[history] Done follows the Work Log, not the tool: that row\'s Minutes typed to 40 by hand, the day\'s Done is 40 minutes within 2 seconds, and still is after two minutes',
}, async (S, c, A) => {
  const ws = S.workspace;
  const { start } = await planInFront(S);
  const hist = () => rowsWhere(logOf(ws, A), { day: HIST });
  const others = (rows) => rows.filter((r) => !TOOL_NAMED.study.test(r.tool) && r.origin === 'App' && r.minutes > 0);
  let row = null;
  await check(c, '1.1', async () => {
    const rows = await settle(S, hist, (r) => others(r).length > 0);
    row = others(rows)[0] || null;
    const shown = await doneIs(S, start, HIST, minutesOf(rows));
    await S.shot('01-done-of-the-history-day');
    return [!!row && minutesOf(rows) === 25 && near(shown, 25 / 60, 0.06), { workLogRowsOfThatDay: brief(rows), doneShown: shown, worksheetsOwnLedger: ledger(ws, HIST) }];
  });
  await check(c, '1.2', async () => {
    must(row, 'a row written from Worksheets\' time (1.1)');
    await typeInRow(S, A.log, row.title, 'Minutes', 40, ['Minutes', String(row.minutes)]);
    const t0 = Date.now();
    const shown = await doneIs(S, start, HIST, 40, 4000);
    const ms = Date.now() - t0;
    await wait2(S);
    const later = await doneShown(S, start, HIST);
    return [near(shown, 40 / 60, 0.06) && ms <= 2500 && near(later, 40 / 60, 0.06) && minutesOf(hist()) === 40, { doneShown: shown, ms, twoMinutesLater: later, workLogRowsOfThatDay: brief(hist()) }];
  });
});

phase(2, 'Work in another tool reaches the Work Log: one row per tool, unit and local day, that grows', 'plan', {
  '2.1': '[history] Worksheets\' time on Clark\'s paper two days before the seed is one row: that date, Unit Clark, Tool Worksheets, Kind Problems, Minutes 25, Items 2, Origin App',
  '2.2': '[history] the 30 minutes Worksheets had counted that day on a paper that matches no unit (Hürlimann) are in no Work Log row: the day has the one row and 25 minutes',
  '2.3': 'a Friedland problem worked in Worksheets for five minutes (a cell typed, rated) is, within the allowance, one row for today: Unit Friedland, Tool Worksheets, Kind Problems, Minutes 4 to 6, Items 1, Origin App',
  '2.4': 'the row grows and is not one row per answer: the quiz\'s next problem worked for four more minutes, and the same row reads 8 to 11 minutes and Items 2; there is still one row',
  '2.5': 'three cards of the tag clark reviewed in Flashcards over five minutes (Good, Good, Again) are one row for today: Unit Clark, Tool Flashcards, Kind Cards, Minutes 4 to 6, Items 3, Right 2, Origin App',
  '2.6': 'the matching is Progress\'s: a card of the tag chain-ladder reviewed for three minutes is a row for Mack (its Also Called is Chain Ladder), Minutes 2 to 4',
  '2.7': 'work for a tag that matches no unit (zeta, three minutes, a card graded) is in no row: the Work Log is as it was (and has the rows of 2.5 and 2.6)',
  '2.8': 'today\'s Done in the plan\'s tab includes it the same day: it is the sum of today\'s Work Log rows (which hold Worksheets\' and Flashcards\' minutes)',
  '2.9': 'one row per tool, unit and local day: today has exactly three rows (Worksheets and Friedland, Flashcards and Clark, Flashcards and Mack), each named',
}, async (S, c, A) => {
  const ws = S.workspace;
  const { start } = await planInFront(S);
  const T = await deskClock(S);
  const log = () => logOf(ws, A);
  const today = (q = {}) => rowsWhere(log(), { day: T, ...q });
  await check(c, '2.1', async () => {
    const rows = await settle(S, () => rowsWhere(log(), { day: HIST }), (r) => r.length > 0);
    const mine = rowsWhere(rows, { unit: 'Clark', kind: 'Problems', tool: 'worksheets' });
    return [mine.length === 1 && mine[0].minutes === 25 && num(mine[0].items) === 2 && mine[0].origin === 'App', { rowsOfThatDay: brief(rows), confirmed: mine[0]?.confirmed, worksheetsOwnLedger: ledger(ws, HIST) }];
  });
  await check(c, '2.2', async () => {
    const rows = rowsWhere(log(), { day: HIST });
    return [rows.length === 1 && rows[0].minutes === 25 && rows[0].units.includes('Clark') && log().every((r) => !/h.rlimann/i.test(`${r.title} ${r.units.join(' ')}`)), { rowsOfThatDay: brief(rows), worksheetsOwnLedger: ledger(ws, HIST) }];
  });
  let quizTab = ''; let first = null;
  await check(c, '2.3', async () => {
    quizTab = await openProblem(S, 'friedland');
    await workProblem(S);
    await desk(S, 5);
    await leave(S);
    const rows = await settle(S, () => today({ unit: 'Friedland', kind: 'Problems' }), (r) => r.length === 1 && between(r[0].minutes, 4, 6) && num(r[0].items) === 1);
    first = rows[0] || null;
    return [rows.length === 1 && between(first.minutes, 4, 6) && TOOL_NAMED.worksheets.test(first.tool) && num(first.items) === 1 && first.origin === 'App', { rows: brief(rows), allOfToday: brief(today()), worksheetsOwnLedger: ledger(ws, T) }];
  });
  await check(c, '2.4', async () => {
    must(first, 'the row of 2.3');
    must(await showTab(S, quizTab), `the quiz's tab "${quizTab}"`);
    await nextProblem(S);
    await workProblem(S);
    await desk(S, 4);
    await leave(S);
    const rows = await settle(S, () => today({ unit: 'Friedland', kind: 'Problems' }), (r) => r.length === 1 && between(r[0].minutes, 8, 11) && num(r[0].items) === 2);
    return [rows.length === 1 && rows[0].pageId === first.pageId && between(rows[0].minutes, 8, 11) && num(rows[0].items) === 2, { was: brief([first]), is: brief(rows), sameRow: rows[0]?.pageId === first.pageId }];
  });
  await check(c, '2.5', async () => {
    await openCards(S, 'clark');
    await desk(S, 2); await gradeCard(S, 'Good');
    await desk(S, 2); await gradeCard(S, 'Good');
    await desk(S, 1); await gradeCard(S, 'Again');
    await leave(S);
    const rows = await settle(S, () => today({ unit: 'Clark', kind: 'Cards' }), (r) => r.length === 1 && between(r[0].minutes, 4, 6) && num(r[0].items) === 3);
    const r = rows[0];
    return [rows.length === 1 && between(r.minutes, 4, 6) && TOOL_NAMED.flashcards.test(r.tool) && num(r.items) === 3 && num(r.right) === 2 && r.origin === 'App', { rows: brief(rows), allOfToday: brief(today()) }];
  });
  await check(c, '2.6', async () => {
    await openCards(S, 'chain-ladder');
    await desk(S, 3); await gradeCard(S, 'Good');
    await leave(S);
    const rows = await settle(S, () => today({ unit: 'Mack', kind: 'Cards' }), (r) => r.length === 1 && between(r[0].minutes, 2, 4));
    return [rows.length === 1 && between(rows[0].minutes, 2, 4) && TOOL_NAMED.flashcards.test(rows[0].tool) && num(rows[0].items) === 1, { rows: brief(rows), allOfToday: brief(today()) }];
  });
  await check(c, '2.7', async () => {
    const before = log();
    await openCards(S, 'zeta');
    await desk(S, 3); await gradeCard(S, 'Good');
    await leave(S);
    await wait2(S);
    const after = log();
    return [steady(before, after) && today({ kind: 'Cards' }).length === 2, { before: brief(before), after: brief(after) }];
  });
  await check(c, '2.8', async () => {
    const rows = today();
    const sum = minutesOf(rows);
    const shown = await doneIs(S, start, T, sum);
    await S.shot('02-todays-done');
    return [rows.some((r) => TOOL_NAMED.worksheets.test(r.tool)) && rows.some((r) => TOOL_NAMED.flashcards.test(r.tool)) && sum >= 14 && near(shown, sum / 60, 0.06), { doneShown: shown, workLogMinutesToday: sum, rows: brief(rows) }];
  });
  await check(c, '2.9', async () => {
    const rows = today();
    const key = (r) => `${TOOL_NAMED.worksheets.test(r.tool) ? 'Worksheets' : TOOL_NAMED.flashcards.test(r.tool) ? 'Flashcards' : r.tool}/${r.units.join('+')}`;
    return [same(rows.map(key).sort(), ['Flashcards/Clark', 'Flashcards/Mack', 'Worksheets/Friedland']) && rows.every((r) => r.title && r.origin === 'App'), { rows: brief(rows), titles: rows.map((r) => r.title) }];
  });
});

phase(3, 'Reading counts: time with a PDF showing that is in a unit\'s Material', 'plan', {
  '3.1': 'six minutes with Mack\'s PDF showing (opened from the unit\'s tab; the wheel, a key, a click, a tap, one each minute) are a row for today: Unit Mack, Kind Reading, Minutes 5 to 7, Origin App',
  '3.2': 'only while it is showing: eight minutes with the PDF\'s tab behind another, a key each minute, add at most one minute (the row of 3.1 is there)',
  '3.3': 'a PDF in no unit\'s Material counts for nothing: six minutes with it showing, used the same way, and the Work Log is as it was (the row of 3.1 is there)',
  '3.4': 'today\'s Done in the plan\'s tab includes the reading: it is the sum of today\'s Work Log rows',
}, async (S, c, A) => {
  const ws = S.workspace;
  const { start } = await planInFront(S);
  const T = await deskClock(S);
  const log = () => logOf(ws, A);
  const reading = () => rowsWhere(log(), { day: T, kind: 'Reading' });
  const KINDS = ['wheel', 'key', 'click', 'tap'];
  let title = '';
  await check(c, '3.1', async () => {
    title = await openUnitPdf(S, 'Mack');
    const pt = must(await wo(S, 'paneMiddle'), 'the PDF\'s pane');
    await S.page.mouse.click(pt.x, pt.y);
    await desk(S, 6, KINDS, pt);
    await S.shot('03-reading');
    await leave(S);
    const rows = await settle(S, reading, (r) => r.length === 1 && between(r[0].minutes, 5, 7));
    return [rows.length === 1 && rows[0].units.includes('Mack') && rows[0].units.length === 1 && between(rows[0].minutes, 5, 7) && rows[0].origin === 'App', { rows: brief(rows), allOfToday: brief(rowsWhere(log(), { day: T })) }];
  });
  await check(c, '3.2', async () => {
    const before = reading();
    must(await showTab(S, title), 'the PDF\'s tab'); await sleep(300);
    must(await showTab(S, tabTitle('Mack')), 'the unit\'s tab, in front of the PDF\'s');
    await desk(S, 8);
    await leave(S);
    await wait2(S);
    const after = reading();
    return [before.length === 1 && between(before[0].minutes, 5, 7) && after.length === 1 && after[0].minutes <= before[0].minutes + 1, { before: brief(before), after: brief(after) }];
  });
  await check(c, '3.3', async () => {
    const before = log(); const had = reading();
    await openFileTab(S, FILES.loosePdf);
    const pt = must(await wo(S, 'paneMiddle'), 'the PDF\'s pane');
    await S.page.mouse.click(pt.x, pt.y);
    await desk(S, 6, KINDS, pt);
    await leave(S);
    await wait2(S);
    const after = log();
    return [had.length === 1 && steady(before, after), { before: brief(before), after: brief(after) }];
  });
  await check(c, '3.4', async () => {
    const rows = rowsWhere(log(), { day: T }); const sum = minutesOf(rows);
    const shown = await doneIs(S, start, T, sum);
    return [reading().length === 1 && sum >= 5 && near(shown, sum / 60, 0.06), { doneShown: shown, workLogMinutesToday: sum, rows: brief(rows) }];
  });
});

phase(4, 'Discussion counts: time in a chat he opened from a unit in Study', 'plan', {
  '4.1': 'six minutes in a chat opened from the unit Venter (its prompt sent and answered, a key each minute) are a row for today: Unit Venter, Kind Discussion, Minutes 5 to 8, Origin App',
  '4.2': 'any other chat counts for nothing: New Chat, a question asked and answered, six minutes in it the same way, and the Discussion row has at most one minute more and there is no second one (the row of 4.1 is there)',
  '4.3': 'today\'s Done in the plan\'s tab includes the discussion: it is the sum of today\'s Work Log rows',
}, async (S, c, A) => {
  const ws = S.workspace;
  const { start } = await planInFront(S);
  const T = await deskClock(S);
  const log = () => logOf(ws, A);
  const talk = () => rowsWhere(log(), { day: T, kind: 'Discussion' });
  await check(c, '4.1', async () => {
    const how = await discussFrom(S, 'Venter');
    await inChat(S);
    await desk(S, 6);
    await S.shot('04-discussion');
    await hideChat(S);
    await leave(S);
    const rows = await settle(S, talk, (r) => r.length === 1 && between(r[0].minutes, 5, 8));
    return [rows.length === 1 && rows[0].units.includes('Venter') && rows[0].units.length === 1 && between(rows[0].minutes, 5, 8) && rows[0].origin === 'App', { openedBy: how, rows: brief(rows), allOfToday: brief(rowsWhere(log(), { day: T })) }];
  });
  await check(c, '4.2', async () => {
    const before = talk();
    await S.cmd('chat.show');
    must(await until(async () => (await chat(S)).shown, 5000), 'the chat showing again');
    await otherChat(S);
    await inChat(S);
    await desk(S, 6);
    await hideChat(S);
    await leave(S);
    await wait2(S);
    const after = talk();
    return [before.length === 1 && between(before[0].minutes, 5, 8) && after.length === 1 && after[0].minutes <= before[0].minutes + 1, { before: brief(before), after: brief(after), allOfToday: brief(rowsWhere(log(), { day: T })) }];
  });
  await check(c, '4.3', async () => {
    const rows = rowsWhere(log(), { day: T }); const sum = minutesOf(rows);
    const shown = await doneIs(S, start, T, sum);
    return [talk().length === 1 && sum >= 5 && near(shown, sum / 60, 0.06), { doneShown: shown, workLogMinutesToday: sum, rows: brief(rows) }];
  });
});

phase(5, 'One clock: seven minutes at the desk and an hour away are seven minutes, in each of the five', 'plan', {
  '5.1': 'Worksheets: seven minutes on a Friedland problem (a key each minute), then twelve minutes of only moving the mouse, then 61 away: the Work Log\'s row reads 6 to 8 minutes (not 19, not 80, not 0)',
  '5.2': 'Flashcards: one card of clark showing for seven minutes at the desk and 61 away, then graded: the row reads 6 to 8 minutes and Items 1 (not the 68 between showing and grading)',
  '5.3': 'reading: seven minutes with Mack\'s PDF and 61 away: the Reading row reads 6 to 8',
  '5.4': 'discussion: seven minutes in the chat opened from Venter and 61 away: the Discussion row reads 6 to 8',
  '5.5': 'Study\'s own session: seven minutes at the desk and 61 away are logged as 6 to 8',
  '5.6': 'Worksheets\' own clock file (src/built-in/worksheet/studyClock.ts) and Study\'s copy (ext/study/src/16-clock-model.js) are gone, and neither tool\'s folder still holds the old clock\'s arithmetic',
}, async (S, c, A) => {
  const ws = S.workspace;
  await planInFront(S);
  const T = await deskClock(S);
  const today = (q = {}) => rowsWhere(logOf(ws, A), { day: T, ...q });
  const one78 = (r) => r.length === 1 && between(r[0].minutes, 6, 8);
  await check(c, '5.5', async () => { const m = await sitting(S, A, 'Clark', async () => { await desk(S, 7); await away(S, 61); }); return [between(m, 6, 8), { minutesLogged: m }]; });
  await check(c, '5.1', async () => {
    await openProblem(S, 'friedland');
    await workProblem(S);
    await desk(S, 7);
    const pt = must(await wo(S, 'sheetPoint'), 'the sheet\'s grid');
    await desk(S, 12, ['move'], pt);
    await away(S, 61);
    await leave(S);
    const rows = await settle(S, () => today({ unit: 'Friedland', kind: 'Problems' }), one78);
    return [one78(rows) && TOOL_NAMED.worksheets.test(rows[0].tool), { rows: brief(rows), allOfToday: brief(today()), worksheetsOwnLedger: ledger(ws, T) }];
  });
  await check(c, '5.2', async () => {
    await openCards(S, 'clark');
    await desk(S, 7);
    await away(S, 61);
    await gradeCard(S, 'Good');
    await leave(S);
    const rows = await settle(S, () => today({ unit: 'Clark', kind: 'Cards' }), (r) => one78(r) && num(r[0].items) === 1);
    return [one78(rows) && num(rows[0].items) === 1 && TOOL_NAMED.flashcards.test(rows[0].tool), { rows: brief(rows), flashcardsOwnRecord: cardsAll(ws, 'SELECT rating, ms_taken FROM fc_reviews').map((r) => ({ ...r })) }];
  });
  await check(c, '5.3', async () => {
    await openUnitPdf(S, 'Mack');
    const pt = must(await wo(S, 'paneMiddle'), 'the PDF\'s pane');
    await S.page.mouse.click(pt.x, pt.y);
    await desk(S, 7, ['wheel', 'key', 'click', 'tap'], pt);
    await away(S, 61);
    await leave(S);
    const rows = await settle(S, () => today({ unit: 'Mack', kind: 'Reading' }), one78);
    return [one78(rows), { rows: brief(rows) }];
  });
  await check(c, '5.4', async () => {
    await discussFrom(S, 'Venter');
    await inChat(S);
    await desk(S, 7);
    await away(S, 61);
    await hideChat(S);
    await leave(S);
    const rows = await settle(S, () => today({ unit: 'Venter', kind: 'Discussion' }), one78);
    return [one78(rows), { rows: brief(rows), allOfToday: brief(today()) }];
  });
  await check(c, '5.6', async () => {
    const gone = { worksheets: !existsSync(path.join(REPO, 'src', 'built-in', 'worksheet', 'studyClock.ts')), study: !existsSync(path.join(REPO, 'ext', 'study', 'src', '16-clock-model.js')) };
    // The old clock's arithmetic, by what it took back: whatever the file is called now.
    const OLD = /sinceInputMs|stretchMs\s*[+=]|function\s+stClockAdvance|function\s+advance\s*\(\s*state/;
    const still = [];
    for (const dir of [path.join(REPO, 'src', 'built-in', 'worksheet'), path.join(REPO, 'ext', 'study', 'src'), path.join(REPO, 'ext', 'flashcards')]) {
      for (const f of await fs.readdir(dir, { recursive: true })) {
        const full = path.join(dir, f);
        if (!/\.(ts|js)$/.test(f) || /node_modules|[\\/]test[\\/]/.test(full)) continue;
        if (OLD.test(readFileSync(full, 'utf8'))) still.push(path.relative(REPO, full));
      }
    }
    if (OLD.test(readFileSync(path.join(REPO, 'ext', 'study', 'main.js'), 'utf8'))) still.push('ext/study/main.js');
    return [gone.worksheets && gone.study && still.length === 0, { fileGone: gone, oldClockStillIn: still }];
  });
}, ['5.5']);

phase(5, 'One setting: the idle time is one setting for the whole app, and all five follow it', 'plan', {
  '5.7': 'with Worksheets, Flashcards and Study all turned off, the app\'s Settings has the idle time (found by searching for idle, counting, no input, away or clock): one control whose choices are 5, 10, 15 and 30 minutes, with 10 chosen',
  '5.8': 'chosen as 5 there, Study\'s session follows: two minutes at the desk, then a key six minutes later, twice, are logged as 1 to 3 (at ten minutes they are 14)',
  '5.9': 'Worksheets follows: the same on a Friedland problem, and the Work Log\'s row reads 1 to 3',
  '5.10': 'Flashcards follows: the same on a card of clark, and the row reads 1 to 3',
  '5.11': 'reading follows: the same on Mack\'s PDF, and the Reading row reads 1 to 3',
  '5.12': 'discussion follows: the same in the chat opened from Venter, and the Discussion row reads 1 to 3',
  '5.13': 'Worksheets keeps no idle time of its own: its Settings tab has no such control, or the one it has reads 5 too',
}, async (S, c, A) => {
  const ws = S.workspace;
  let ctl = null;
  await check(c, '5.7', async () => {
    for (const t of ['worksheets', 'flashcards', 'study']) await S.setTool(t, false);
    await sleep(800);
    await openSettings(S);
    const r = await findChooser(S, IDLE_WORDS, idleFits);
    await S.shot('05-the-idle-setting');
    ctl = r.found;
    if (!ctl) { await closeSettings(S); for (const t of ['worksheets', 'flashcards', 'study']) await S.setTool(t, true); return [false, { noControlWithTheChoices: IDLE_CHOICES, controlsLookedAt: r.looked }]; }
    const chosen = firstNumber(ctl.chosen);
    return [chosen === 10, { foundBySearching: ctl.words, name: ctl.name, choices: ctl.labels, chosen: ctl.chosen, row: ctl.row.slice(0, 200) }];
  });
  must(ctl, 'the one idle setting in the app\'s Settings (5.7)');
  await choose(S, ctl, ctl.labels.findIndex((l) => firstNumber(l) === 5));
  await closeSettings(S);
  for (const t of ['worksheets', 'flashcards', 'study']) await S.setTool(t, true);
  await showStudySidebar(S);
  must(await until(async () => ((await subjectsText(S)) || '').includes('Mack'), 12_000), 'the subject back in the sidebar');
  await planInFront(S);
  const T = await deskClock(S);
  const today = (q = {}) => rowsWhere(logOf(ws, A), { day: T, ...q });
  const one13 = (r) => r.length === 1 && between(r[0].minutes, 1, 3);
  const work = async (pt = null, kinds = ['key']) => { await desk(S, 2, kinds, pt); await gaps(S, 2, 6, 'key'); };
  await check(c, '5.8', async () => { const m = await sitting(S, A, 'Clark', () => work()); return [between(m, 1, 3), { minutesLogged: m }]; });
  await check(c, '5.9', async () => {
    await openProblem(S, 'friedland'); await workProblem(S); await work(); await leave(S);
    const rows = await settle(S, () => today({ unit: 'Friedland', kind: 'Problems' }), one13);
    return [one13(rows), { rows: brief(rows), worksheetsOwnLedger: ledger(ws, T) }];
  });
  await check(c, '5.10', async () => {
    await openCards(S, 'clark'); await work(); await gradeCard(S, 'Good'); await leave(S);
    const rows = await settle(S, () => today({ unit: 'Clark', kind: 'Cards' }), one13);
    return [one13(rows), { rows: brief(rows) }];
  });
  await check(c, '5.11', async () => {
    await openUnitPdf(S, 'Mack'); const pt = must(await wo(S, 'paneMiddle'), 'the PDF\'s pane'); await S.page.mouse.click(pt.x, pt.y); await work(pt, ['wheel', 'click']); await leave(S);
    const rows = await settle(S, () => today({ unit: 'Mack', kind: 'Reading' }), one13);
    return [one13(rows), { rows: brief(rows) }];
  });
  await check(c, '5.12', async () => {
    await discussFrom(S, 'Venter'); await inChat(S); await work(); await hideChat(S); await leave(S);
    const rows = await settle(S, () => today({ unit: 'Venter', kind: 'Discussion' }), one13);
    return [one13(rows), { rows: brief(rows) }];
  });
  await check(c, '5.13', async () => {
    await S.cmd('worksheet.settings');
    must(await until(async () => /stop counting|sheet appearance|decimals shown/i.test(await S.text('pane')), 8000), 'Worksheets\' Settings tab');
    await sleep(400);
    const own = (await wo(S, 'choosers', 'pane')).filter((k) => k.labels && idleFits(k.labels));
    return [own.every((k) => firstNumber(k.chosen) === 5), { worksheetsOwnIdleControls: own.map((k) => `${k.name}: ${k.chosen}`) }];
  });
});

// The words that say a clock has stopped, and that it goes again.
const STOPPED = /\b(paused|stopped|not counting|no longer counting|idle|away|inactive|on hold)\b/i;
const RESUMED = /resum|again|running|restart|continu|back\b|counting/i;
const RULE = /taken back|not count|no longer count|counts? (for )?nothing|stops? counting|left out|is not counted|does not count|doesn't count/i;
/**
 * A stop for idleness on the surface in front, and the return. Two minutes at the desk, eleven
 * away, then one key. Returns what newly said "stopped" on screen, what the live regions were
 * given at the stop and at the return, and whether the stop's words were gone after the key.
 */
async function stopAndReturn(S, shot) {
  await wo(S, 'liveStart');
  await desk(S, 2);
  const had = new Set((await wo(S, 'saying', STOPPED.source)).map((x) => x.text));
  await wo(S, 'liveStart');
  await away(S, 11);
  await sleep(700);
  const said = (await wo(S, 'saying', STOPPED.source)).filter((x) => !had.has(x.text) && !x.hidden);
  const spoken = (await wo(S, 'liveLog')).filter((l) => STOPPED.test(l.text));
  if (shot) await S.shot(shot);
  const n = (await wo(S, 'liveLog')).length;
  await input(S, 'key');
  await jump(S, 3);
  await sleep(900);
  const after = (await wo(S, 'saying', STOPPED.source)).filter((x) => !had.has(x.text) && !x.hidden);
  const stopTexts = new Set(spoken.map((l) => l.text));
  const back = (await wo(S, 'liveLog')).slice(n).filter((l) => RESUMED.test(l.text) && !stopTexts.has(l.text));
  return {
    seen: said.length > 0, politely: spoken.some((l) => l.how === 'polite') && !spoken.some((l) => l.how === 'assertive'),
    gone: said.length > 0 && !after.some((x) => said.some((y) => y.text === x.text)), backPolitely: back.some((l) => l.how === 'polite') && !back.some((l) => l.how === 'assertive'),
    said, spoken, back, words: [...said.map((x) => `${x.text} ${x.more}`), ...spoken.map((l) => l.text)],
  };
}
const told = (r) => ({ onScreen: r.said.map((x) => `${x.text.slice(0, 90)}${x.inWords ? '' : ' (a name, not words)'} [${x.part.replace('workbench.parts.', '')}]`), toAScreenReader: r.spoken.map((l) => `${l.how}: ${l.text.slice(0, 90)}`), atTheReturn: r.back.map((l) => `${l.how}: ${l.text.slice(0, 90)}`), stopWordsGoneAfterAKey: r.gone });

phase(6, 'The stop is said: when the clock stops for idleness and when it resumes, to the eye and to a screen reader, and what the rule is', 'plan', {
  '6.1': 'a Study session left eleven minutes without input: something on screen newly says the clock has stopped (paused, stopped, not counting, idle, away)',
  '6.2': 'the same is given to a screen reader politely (a live region that is polite or a status, never an alert)',
  '6.3': 'at the next key the stop\'s words are gone from the screen, and a screen reader is told, politely, that it goes again',
  '6.4': 'Worksheets, where a clock is shown on the sheet: the stop is on screen and spoken politely, and so is the return',
  '6.5': 'Flashcards, where a session of cards is running: the stop is on screen and spoken politely, and so is the return',
  '6.6': 'somewhere he can find it says what the rule is: by the idle setting in the app\'s Settings (the three tools turned off), or with the words of the stop itself, a sentence that says idle time is not counted',
  '6.7': 'the stop\'s words read at 4.5 to 1 or better in dark and in light (a Study session)',
}, async (S, c, A) => {
  await planInFront(S);
  await deskClock(S);
  const rules = [];
  let dark = null;
  const card = await startSession(S, 'Clark');
  await answer(S, card, TYPED);
  dark = await stopAndReturn(S, '06-session-stopped');
  rules.push(...dark.words);
  await check(c, '6.1', async () => [dark.seen, told(dark)]);
  await check(c, '6.2', async () => [dark.seen && dark.politely, told(dark)]);
  await check(c, '6.3', async () => [dark.gone && dark.backPolitely, told(dark)]);
  await check(c, '6.7', async () => {
    await setMode(S, 'light');
    must(await showTab(S, `Study · ${tabTitle('Clark')}`), 'the session\'s tab');
    const light = await stopAndReturn(S, '06-session-stopped-light');
    await setMode(S, 'dark');
    const read = (r) => r.said.filter((x) => x.inWords).map((x) => x.contrast);
    const ok = (r) => r.seen && read(r).every((v) => v !== null && v >= 4.5);
    return [ok(dark) && ok(light), { dark: { said: dark.said.map((x) => x.text.slice(0, 60)), contrast: read(dark) }, light: { said: light.said.map((x) => x.text.slice(0, 60)), contrast: read(light) }, note: dark.seen && !read(dark).length ? 'the stop is a name on an icon: its contrast is not measured here' : '' }];
  });
  await endSession(S);
  await closeSessionTabs(S);
  await check(c, '6.4', async () => {
    await openProblem(S, 'friedland');
    await workProblem(S);
    const r = await stopAndReturn(S, '06-worksheets-stopped');
    rules.push(...r.words);
    await leave(S);
    return [r.seen && r.politely && r.gone && r.backPolitely, told(r)];
  });
  await check(c, '6.5', async () => {
    await openCards(S, 'clark');
    const r = await stopAndReturn(S, '06-flashcards-stopped');
    rules.push(...r.words);
    await leave(S);
    return [r.seen && r.politely && r.gone && r.backPolitely, told(r)];
  });
  await check(c, '6.6', async () => {
    for (const t of ['worksheets', 'flashcards', 'study']) await S.setTool(t, false);
    await sleep(800);
    await openSettings(S);
    const r = await findChooser(S, IDLE_WORDS, idleFits);
    const row = r.found ? r.found.row : '';
    await closeSettings(S);
    for (const t of ['worksheets', 'flashcards', 'study']) await S.setTool(t, true);
    const saysRule = (t) => RULE.test(t) && norm(t).split(' ').length >= 8;
    const where = saysRule(row) ? 'by the idle setting' : rules.some(saysRule) ? 'with the stop' : '';
    return [!!where, { where, byTheSetting: row.slice(0, 260) || 'no idle setting found with the tools off', withTheStop: rules.map((t) => t.slice(0, 120)) }];
  });
});

phase(7, 'What he wrote is his: a row he adds, or changes, is never overwritten or removed; an untouched row follows the tool', 'plan', {
  '7.1': '[history] a row he adds by hand for the same tool, unit and day as a row Study wrote (50 minutes, Origin Manual) stays as he wrote it, and Study\'s row stays 25, through work in the tool, the app closed and opened, and two minutes',
  '7.2': '[history] the row Study wrote, its Minutes changed by hand to 40, stays 40 through work in the tool, Study turned off and on, the app closed and opened, and two minutes; Study makes no second row for it, and the day\'s Done is his 40 and his 50',
  '7.3': 'today\'s growing row too: Worksheets\' row for Friedland, its Minutes typed to 90 while the day\'s work goes on, stays 90 after three more minutes of work, and there is still one row',
  '7.4': 'a row Study wrote and he did not touch follows the tool: the Clark problem worked two minutes in 7.2 is a row of 1 to 3 for today, and after three more minutes on the next it reads 4 to 7',
  '7.5': 'a Study session\'s row, its Minutes typed to 45 after the session, stays 45 through the app closed and opened',
}, async (S, c, A) => {
  const ws = S.workspace;
  const { start } = await planInFront(S);
  const T = await deskClock(S);
  const log = () => logOf(ws, A);
  const byId = (id) => log().find((r) => r.pageId === id) || null;
  const appHist = () => rowsWhere(log(), { day: HIST, unit: 'Clark', kind: 'Problems' }).filter((r) => r.origin === 'App');
  const r0 = (await settle(S, appHist, (r) => r.length === 1 && r[0].minutes === 25))[0] || null;
  let quizTab = ''; let mine = null;
  await check(c, '7.1', async () => {
    must(r0 && r0.minutes === 25, 'the row Study wrote from Worksheets\' time on the history day (25 minutes)');
    const clark = must(rowTitled(ws, A.units, 'Clark'), 'the unit Clark').pageId;
    mine = (await addRow(S, A.log, 'My own count', { Date: `${HIST}T20:00`, Minutes: 50, Unit: [clark], Tool: r0.tool, Kind: 'Problems', Origin: 'Manual' })).pageId;
    const asWritten = JSON.stringify(rowsOf(ws, A.log).find((r) => r.pageId === mine)?.raw);
    quizTab = await openProblem(S, 'friedland'); await workProblem(S); await desk(S, 3); await leave(S);
    await settle(S, () => rowsWhere(log(), { day: T, unit: 'Friedland', kind: 'Problems' }), (r) => r.length === 1);
    await restart(S); await planInFront(S);
    await wait2(S);
    const now = JSON.stringify(rowsOf(ws, A.log).find((r) => r.pageId === mine)?.raw);
    return [now === asWritten && byId(mine)?.minutes === 50 && byId(r0.pageId)?.minutes === 25 && appHist().length === 1, { hisRow: brief([byId(mine)].filter(Boolean)), unchanged: now === asWritten, studysRow: brief(appHist()) }];
  });
  await check(c, '7.2', async () => {
    must(r0 && r0.minutes === 25, 'the row Study wrote from Worksheets\' time on the history day');
    await typeInRow(S, A.log, r0.title, 'Minutes', 40, ['Minutes', '25']);
    must(await until(() => byId(r0.pageId)?.minutes === 40, 3000, 50), 'the 40 he typed, in the file');
    await closeTab(S, 'Work Log');
    await openProblem(S, 'clark'); await workProblem(S); await desk(S, 2); await leave(S);
    await wait2(S);
    await S.setTool('study', false); await sleep(800); await S.setTool('study', true);
    await planInFront(S); await wait2(S);
    await restart(S); await planInFront(S); await wait2(S);
    const rows = rowsWhere(log(), { day: HIST });
    const shown = await doneIs(S, start, HIST, 90);
    return [byId(r0.pageId)?.minutes === 40 && rowsWhere(rows, { unit: 'Clark', kind: 'Problems' }).length === (mine ? 2 : 1) && minutesOf(rows) === (mine ? 90 : 40) && near(shown, minutesOf(rows) / 60, 0.06), { rowsOfThatDay: brief(rows), doneShown: shown }];
  });
  await check(c, '7.3', async () => {
    const fr = () => rowsWhere(log(), { day: T, unit: 'Friedland', kind: 'Problems' });
    const had = await settle(S, fr, (r) => r.length === 1 && r[0].minutes >= 2);
    must(had.length === 1, 'Worksheets\' row for Friedland today');
    await typeInRow(S, A.log, had[0].title, 'Minutes', 90, ['Minutes', String(had[0].minutes)]);
    must(await until(() => byId(had[0].pageId)?.minutes === 90, 3000, 50), 'the 90 he typed, in the file');
    await closeTab(S, 'Work Log');
    await openProblem(S, 'friedland'); await workProblem(S); await desk(S, 3); await leave(S);
    await wait2(S);
    const now = fr();
    return [now.length === 1 && now[0].pageId === had[0].pageId && now[0].minutes === 90, { was: brief(had), is: brief(now) }];
  });
  await check(c, '7.4', async () => {
    const cl = () => rowsWhere(log(), { day: T, unit: 'Clark', kind: 'Problems' });
    const a = await settle(S, cl, (r) => r.length === 1 && between(r[0].minutes, 1, 3));
    await openProblem(S, 'clark'); await workProblem(S); await desk(S, 3); await leave(S);
    const b = await settle(S, cl, (r) => r.length === 1 && between(r[0].minutes, 4, 7));
    return [a.length === 1 && between(a[0].minutes, 1, 3) && b.length === 1 && b[0].pageId === a[0].pageId && between(b[0].minutes, 4, 7), { afterTwoMinutes: brief(a), afterThreeMore: brief(b) }];
  });
  await check(c, '7.5', async () => {
    const m = await sitting(S, A, 'Venter', () => desk(S, 3));
    const row = must(rowsWhere(log(), { day: T, unit: 'Venter', kind: 'Questions' })[0], 'the session\'s row');
    await typeInRow(S, A.log, row.title, 'Minutes', 45, ['Minutes', String(row.minutes)]);
    must(await until(() => byId(row.pageId)?.minutes === 45, 3000, 50), 'the 45 he typed, in the file');
    await restart(S); await planInFront(S); await wait2(S);
    const now = rowsWhere(log(), { day: T, unit: 'Venter', kind: 'Questions' });
    return [between(m, 3, 5) && now.length === 1 && now[0].minutes === 45, { logged: m, afterTheRestart: brief(now) }];
  });
}, ['7.5']);

phase(8, 'Off keeps the past: a tool turned off leaves its rows; on again they carry on; Study off clocks and writes nothing', 'plan', {
  '8.1': 'Worksheets turned off: its rows stay in the Work Log (the history day\'s and today\'s) and neither day\'s Done drops, two minutes on',
  '8.2': 'Worksheets on again: the same rows, no second copy; three more minutes of work and today\'s row carries on (5 to 8 minutes)',
  '8.3': 'Flashcards the same: three minutes of cards make a row; off, it stays and Done does not drop; on, no second copy, and two more minutes carry it on (4 to 7 minutes, Items 2)',
  '8.4': 'Study turned off: six minutes with Mack\'s PDF showing and five in the chat opened from Venter write nothing (the Work Log\'s part of the file is untouched), where four and three minutes had made a Reading and a Discussion row before',
  '8.5': 'Study on again: no time from while it was off (the Reading row and the Discussion row have at most a minute more), and no second copy of either',
  '8.6': 'while Study was off the other tools kept their own time as before: Worksheets\' clock on the sheet counted four minutes of work',
  '8.7': 'and that work reaches the Work Log once Study is on again: Worksheets\' row for Friedland today has those four minutes more, in the one row',
  '8.8': 'nothing is left running for Study: with the three tools off, then Study on, a PDF read and a chat held, then Study off, there are no more repeating timers and no more listeners for keys, clicks, taps, the wheel or the window on the window and the document than before Study was turned on',
}, async (S, c, A) => {
  const ws = S.workspace;
  let { start } = await planInFront(S);
  const T = await deskClock(S);
  const log = () => logOf(ws, A);
  const today = (q = {}) => rowsWhere(log(), { day: T, ...q });
  const sheets = () => log().filter((r) => TOOL_NAMED.worksheets.test(r.tool));
  let fr = null; let done0 = null;
  await check(c, '8.1', async () => {
    await openProblem(S, 'friedland'); await workProblem(S); await desk(S, 3); await leave(S);
    fr = (await settle(S, () => today({ unit: 'Friedland', kind: 'Problems' }), (r) => r.length === 1 && between(r[0].minutes, 2, 4)))[0] || null;
    const before = sheets();
    done0 = { [HIST]: await doneShown(S, start, HIST), [T]: await doneShown(S, start, T) };
    await S.setTool('worksheets', false);
    await wait2(S);
    const after = sheets();
    const done1 = { [HIST]: await doneShown(S, start, HIST), [T]: await doneShown(S, start, T) };
    return [before.length === 2 && steady(before, after) && near(done1[HIST], 25 / 60, 0.06) && done0[T] > 0 && done1[T] >= done0[T] - 0.001 && done1[T] <= done0[T] + 0.02, { rowsBefore: brief(before), rowsAfter: brief(after), doneBefore: done0, doneAfter: done1 }];
  });
  await check(c, '8.2', async () => {
    const before = sheets();
    await S.setTool('worksheets', true);
    await wait2(S);
    const back = sheets();
    await openProblem(S, 'friedland'); await workProblem(S); await desk(S, 3); await leave(S);
    const now = await settle(S, () => today({ unit: 'Friedland', kind: 'Problems' }), (r) => r.length === 1 && between(r[0].minutes, 5, 8));
    return [before.length === 2 && steady(before, back) && now.length === 1 && !!fr && now[0].pageId === fr.pageId && between(now[0].minutes, 5, 8) && sheets().length === 2, { rowsWhileOff: brief(before), rowsOnAgain: brief(back), todayAfterMoreWork: brief(now) }];
  });
  await check(c, '8.3', async () => {
    const cards = () => today({ unit: 'Clark', kind: 'Cards' });
    await openCards(S, 'clark'); await desk(S, 3); await gradeCard(S, 'Good'); await leave(S);
    const a = await settle(S, cards, (r) => r.length === 1 && between(r[0].minutes, 2, 4));
    const d0 = await doneShown(S, start, T);
    await S.setTool('flashcards', false);
    await wait2(S);
    const off = cards(); const d1 = await doneShown(S, start, T);
    await S.setTool('flashcards', true);
    await wait2(S);
    const on = cards();
    await openCards(S, 'clark'); await desk(S, 2); await gradeCard(S, 'Good'); await leave(S);
    const b = await settle(S, cards, (r) => r.length === 1 && between(r[0].minutes, 4, 7) && num(r[0].items) === 2);
    return [a.length === 1 && between(a[0].minutes, 2, 4) && steady(a, off) && d0 > 0 && d1 >= d0 - 0.001 && d1 <= d0 + 0.02 && steady(a, on) && b.length === 1 && b[0].pageId === a[0].pageId && between(b[0].minutes, 4, 7) && num(b[0].items) === 2,
      { made: brief(a), whileOff: brief(off), doneBeforeAndWhileOff: [d0, d1], onAgain: brief(on), afterMoreCards: brief(b) }];
  });
  const reading = () => today({ unit: 'Mack', kind: 'Reading' }); const talk = () => today({ unit: 'Venter', kind: 'Discussion' });
  let rr = []; let dr = []; let quiz = ''; let frOff = null; let timerGain = null;
  await check(c, '8.4', async () => {
    const pdf = await openUnitPdf(S, 'Mack');
    const pt = must(await wo(S, 'paneMiddle'), 'the PDF\'s pane');
    await S.page.mouse.click(pt.x, pt.y); await desk(S, 4, ['wheel', 'key'], pt); await leave(S);
    rr = await settle(S, reading, (r) => r.length === 1 && between(r[0].minutes, 3, 5));
    await discussFrom(S, 'Venter'); await inChat(S); await desk(S, 3); await hideChat(S); await leave(S);
    dr = await settle(S, talk, (r) => r.length === 1 && between(r[0].minutes, 2, 5));
    // Worksheets' sheet is opened now, for 8.6: its tab waits behind.
    quiz = await openProblem(S, 'friedland'); await workProblem(S); await leave(S);
    frOff = (await settle(S, () => today({ unit: 'Friedland', kind: 'Problems' }), (r) => r.length === 1))[0] || null;
    await wait2(S);
    const stamp = logStamp(ws, A);
    await S.setTool('study', false);
    await sleep(800);
    must(await showTab(S, pdf), 'the PDF\'s tab, still open with Study off');
    await S.page.mouse.click(pt.x, pt.y); await desk(S, 6, ['wheel', 'key'], pt);
    await S.cmd('chat.show'); must(await until(async () => (await chat(S)).shown, 5000), 'the chat showing'); await inChat(S); await desk(S, 5); await hideChat(S);
    // 8.6: Worksheets goes on counting its own time.
    must(await showTab(S, quiz), 'the quiz\'s tab'); await sleep(400);
    const t0 = await wo(S, 'sheetTimer'); await desk(S, 4); const t1 = await wo(S, 'sheetTimer');
    timerGain = t0 === null || t1 === null ? null : t1 - t0;
    await S.cmd('worksheet.dashboard'); await sleep(600);          // the sheet is left
    for (let i = 0; i < 6; i++) { await jump(S, 20); await sleep(150); }
    const after = logStamp(ws, A);
    return [rr.length === 1 && between(rr[0].minutes, 3, 5) && dr.length === 1 && between(dr[0].minutes, 2, 5) && after === stamp, { readingBefore: brief(rr), discussionBefore: brief(dr), workLogUntouchedWhileOff: after === stamp }];
  });
  await check(c, '8.6', async () => [between(timerGain, 230, 260), { secondsGainedOnTheSheetInFourMinutes: timerGain }]);
  await S.setTool('study', true);
  await showStudySidebar(S);
  must(await until(async () => ((await subjectsText(S)) || '').includes('Mack'), 12_000), 'the subject back in the sidebar');
  ({ start } = await planInFront(S));
  await check(c, '8.5', async () => {
    await wait2(S);
    const r = reading(); const d = talk();
    return [rr.length === 1 && dr.length === 1 && r.length === 1 && d.length === 1 && r[0].minutes <= rr[0].minutes + 1 && d[0].minutes <= dr[0].minutes + 1, { readingBefore: brief(rr), readingNow: brief(r), discussionBefore: brief(dr), discussionNow: brief(d) }];
  });
  await check(c, '8.7', async () => {
    must(frOff, 'Worksheets\' row for Friedland before Study was turned off');
    const now = await settle(S, () => today({ unit: 'Friedland', kind: 'Problems' }), (r) => r.length === 1 && between(r[0].minutes - frOff.minutes, 3, 5));
    return [now.length === 1 && now[0].pageId === frOff.pageId && between(now[0].minutes - frOff.minutes, 3, 5), { beforeStudyWasOff: brief([frOff]), now: brief(now) }];
  });
  await check(c, '8.8', async () => {
    for (let i = 0; i < 30 && (await S.tabs()).length; i++) await closeFront(S);
    for (const t of ['study', 'worksheets', 'flashcards']) await S.setTool(t, false);
    await openFileTab(S, FILES.mackPdf);
    await S.cmd('chat.show'); must(await until(async () => (await chat(S)).shown, 5000), 'the chat showing');
    await sleep(1500);
    await wo(S, 'watchStart');
    const counts = await wo(S, 'watchWorks');
    await jump(S, 30); await sleep(800);
    const before = await wo(S, 'watching');
    await S.setTool('study', true);
    await sleep(1500);
    const pt = must(await wo(S, 'paneMiddle'), 'the PDF\'s pane');
    await S.page.mouse.click(pt.x, pt.y); await desk(S, 3, ['wheel', 'key'], pt);
    await inChat(S); await desk(S, 2);
    const on = await wo(S, 'watching');
    await S.setTool('study', false);
    await jump(S, 30); await sleep(1500);
    const after = await wo(S, 'watching');
    for (const t of ['study', 'worksheets', 'flashcards']) await S.setTool(t, true);
    return [counts && after.timers <= before.timers && after.listeners <= before.listeners, { theCountSeesATimerAndAListenerComeAndGo: counts, beforeStudyOn: before, whileOn: on, afterStudyOff: after }];
  });
}, ['8.6', '8.8']);

// The modularity ratchets' baselines as they were when this probe was written (ef5610ab): a count may fall, never rise.
const CORE_TOOL_BASELINE = { 'electron/webFetchBridge.cjs': { webResearch: 2 }, 'src/api/apiFactory.ts': { workspaceGraph: 9 }, 'src/api/bridges/dashboardBridge.ts': { webResearch: 3 }, 'src/built-in/chat/tools/workflowTools.ts': { budget: 1 }, 'src/openclaw/mcp/mcpCatalog.ts': { flashcards: 1 }, 'src/openclaw/openclawSystemPrompt.ts': { planner: 1 }, 'src/openclaw/participants/openclawContextReport.ts': { workspaceGraph: 1 }, 'src/services/browserAutomationTypes.ts': { browser: 1 } };
const IMPORT_BASELINE = { 'src/api/bridges/chatBridge.ts': 1, 'src/built-in/canvas/ai/pageTools.ts': 1, 'src/built-in/chat/data/chatDataService.ts': 2, 'src/built-in/chat/main.ts': 1, 'src/services/chatAgentService.ts': 1, 'src/services/chatService.ts': 8 };
// The probe's own count of the three tools' names in core code (comments aside), as it was then.
const CORE_NAMES_THEN = { 'src/built-in/canvas/dashboardWidgets.ts': { study: 1 }, 'src/built-in/canvas/main.ts': { study: 3 }, 'src/built-in/dashboard/widgetTemplates.ts': { study: 1 }, 'src/openclaw/mcp/mcpCatalog.ts': { flashcards: 1, study: 1 } };
const CORE_NAMES = { worksheets: /parallx\.worksheet|\bworksheets?[._:-]|\bWorksheets?\b/g, flashcards: /\bflashcards?[._-]|\bFlashcards?\b/g, study: /parallx-community\.study|\bstudy[._:-]|\bst_[a-z]|\bStudy\b/g };
/** Every core file (src/**.ts and .css, electron/*.cjs; not the tools' own folders or the manifests) with how often its code names each of the three tools. */
async function coreNames() {
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/(?<=[;,{}()\]])\s*\/\/[^\n]*/g, '');
  const files = [];
  for (const f of await fs.readdir(path.join(REPO, 'src'), { recursive: true })) { const rel = `src/${f.split(path.sep).join('/')}`; if (/\.(ts|css)$/.test(rel) && !/^src\/built-in\/(planner|worksheet)\//.test(rel) && rel !== 'src/tools/builtinManifests.ts') files.push(rel); }
  for (const f of await fs.readdir(path.join(REPO, 'electron'))) if (/\.cjs$/.test(f)) files.push(`electron/${f}`);
  const out = {};
  for (const rel of files) {
    const text = strip(readFileSync(path.join(REPO, rel), 'utf8'));
    for (const [tool, re] of Object.entries(CORE_NAMES)) { const n = (text.match(re) || []).length; if (n) (out[rel] ??= {})[tool] = n; }
  }
  return out;
}

phase(9, 'The core names no tool: the contribution point is generic, documented, and the modularity ratchets hold', 'plan', {
  '9.1': 'docs/PARALLX_EXTENSION_AUTHORING_FOR_AI.md documents the contribution point: providers of work, what one reports (minutes and items by day and group), and how a tool registers one',
  '9.2': 'the modularity ratchets pass (coreToolMentionsRatchet, importDirectionRatchet) with no baseline raised since this probe was written, and the probe\'s own count finds no core file naming Study, Worksheets or Flashcards more than it did then',
  '9.3': 'the clock is the core\'s: with Worksheets and Flashcards both turned off, five minutes with Mack\'s PDF showing are still a Reading row of 4 to 6 minutes',
}, async (S, c, A) => {
  const ws = S.workspace;
  await check(c, '9.1', async () => {
    const doc = readFileSync(path.join(REPO, 'docs', 'PARALLX_EXTENSION_AUTHORING_FOR_AI.md'), 'utf8');
    const at = doc.search(/work[- ]providers?\b|providers? of (study )?work\b|workProviders?\b|work[- ]record providers?\b/i);
    const part = at < 0 ? '' : doc.slice(Math.max(0, at - 400), at + 4000);
    const has = { providersOfWork: at >= 0, minutes: /\bminutes\b/i.test(part), items: /\bitems\b/i.test(part), byDay: /\bday\b/i.test(part), byGroup: /\bgroup\b/i.test(part), registering: /\bregister/i.test(part) };
    return [Object.values(has).every(Boolean), has];
  });
  await check(c, '9.2', async () => {
    const { spawnSync } = await import('node:child_process');
    const run = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vitest', 'run', 'tests/unit/coreToolMentionsRatchet.test.ts', 'tests/unit/importDirectionRatchet.test.ts'], { cwd: REPO, encoding: 'utf8', timeout: 180_000, shell: process.platform === 'win32' });
    const raised = [];
    const core = JSON.parse(readFileSync(path.join(REPO, 'tests', 'unit', 'core-tool-mentions-baseline.json'), 'utf8'));
    for (const [f, tools] of Object.entries(core)) for (const [t, n] of Object.entries(tools)) if (n > ((CORE_TOOL_BASELINE[f] || {})[t] || 0)) raised.push(`core-tool-mentions ${f} ${t}: ${n}`);
    const imp = JSON.parse(readFileSync(path.join(REPO, 'tests', 'unit', 'import-direction-baseline.json'), 'utf8'));
    for (const [f, n] of Object.entries(imp)) if (n > (IMPORT_BASELINE[f] || 0)) raised.push(`import-direction ${f}: ${n}`);
    const names = await coreNames(); const named = [];
    for (const [f, tools] of Object.entries(names)) for (const [t, n] of Object.entries(tools)) if (n > ((CORE_NAMES_THEN[f] || {})[t] || 0)) named.push(`${f} names ${t} ${n} times (${(CORE_NAMES_THEN[f] || {})[t] || 0} then)`);
    return [run.status === 0 && raised.length === 0 && named.length === 0, { ratchetsExit: run.status, raisedBaselines: raised, coreFilesNamingATool: named.slice(0, 8), tail: run.status === 0 ? '' : String(run.stdout || run.stderr || run.error || '').slice(-400) }];
  });
  await check(c, '9.3', async () => {
    await planInFront(S);
    const T = await deskClock(S);
    await S.setTool('worksheets', false); await S.setTool('flashcards', false);
    await openUnitPdf(S, 'Mack');
    const pt = must(await wo(S, 'paneMiddle'), 'the PDF\'s pane');
    await S.page.mouse.click(pt.x, pt.y); await desk(S, 5, ['wheel', 'key'], pt); await leave(S);
    const rows = await settle(S, () => rowsWhere(logOf(ws, A), { day: T, unit: 'Mack', kind: 'Reading' }), (r) => r.length === 1 && between(r[0].minutes, 4, 6));
    return [rows.length === 1 && between(rows[0].minutes, 4, 6), { rows: brief(rows) }];
  });
}, ['9.2']);

phase(10, 'No double counting: across a restart, a second sync, and a tool that is not the one showing', 'plan', {
  '10.1': 'a Study session is one row as today: six minutes over Clark are one row (Study, Questions, 6 to 8 minutes), and two minutes on there is no second row for that time',
  '10.2': 'the app closed and opened in the middle of the day\'s work: Worksheets\' row for Friedland reads the same 3 to 5 minutes afterwards, and three more minutes of work make it 6 to 9, in the one row with Items 2',
  '10.3': 'a second sync writes nothing: with rows written from the tools in it, the Work Log\'s part of the file (every row, every value, every time of writing) is the same after two minutes, the app closed and opened, and Study turned off and on',
  '10.4': 'each tool counts only while it is the one showing: six minutes with Mack\'s PDF in front and Worksheets\' sheet in a tab behind are a Reading row of 5 to 7, and Worksheets\' row has at most a minute more',
}, async (S, c, A) => {
  const ws = S.workspace;
  await planInFront(S);
  const T = await deskClock(S);
  const log = () => logOf(ws, A);
  const today = (q = {}) => rowsWhere(log(), { day: T, ...q });
  const fr = () => today({ unit: 'Friedland', kind: 'Problems' });
  await check(c, '10.1', async () => {
    const m = await sitting(S, A, 'Clark', () => desk(S, 6));
    await leave(S); await wait2(S);
    const rows = today();
    return [between(m, 6, 8) && rows.length === 1 && rows[0].units.includes('Clark') && TOOL_NAMED.study.test(rows[0].tool) && rows[0].kind === 'Questions' && between(rows[0].minutes, 6, 8), { minutesLogged: m, rowsOfToday: brief(rows) }];
  });
  let quiz = '';
  await check(c, '10.2', async () => {
    await openProblem(S, 'friedland'); await workProblem(S); await desk(S, 4); await leave(S);
    const a = await settle(S, fr, (r) => r.length === 1 && between(r[0].minutes, 3, 5));
    await restart(S); await planInFront(S); await wait2(S);
    const b = fr();
    quiz = await openProblem(S, 'friedland'); await workProblem(S); await desk(S, 3); await leave(S);
    const d = await settle(S, fr, (r) => r.length === 1 && between(r[0].minutes, 6, 9) && num(r[0].items) === 2);
    return [a.length === 1 && between(a[0].minutes, 3, 5) && steady(a, b) && d.length === 1 && d[0].pageId === a[0].pageId && between(d[0].minutes, 6, 9) && num(d[0].items) === 2, { before: brief(a), afterTheRestart: brief(b), afterThreeMore: brief(d) }];
  });
  await check(c, '10.3', async () => {
    // Worksheets' tabs are closed first, so its last seconds have landed before the file is read.
    for (const label of [quiz, 'Study Dashboard']) if (label && (await showTab(S, label))) await closeFront(S);
    await leave(S); await wait2(S); await wait2(S);
    const fromTools = log().filter((r) => r.origin === 'App' && !TOOL_NAMED.study.test(r.tool));
    const a = logStamp(ws, A);
    await wait2(S); const b = logStamp(ws, A);
    await restart(S); await planInFront(S); await wait2(S); const d = logStamp(ws, A);
    await S.setTool('study', false); await sleep(800); await S.setTool('study', true); await planInFront(S); await wait2(S); const e = logStamp(ws, A);
    return [fromTools.length >= 1 && a === b && b === d && d === e, { rowsFromTheTools: brief(fromTools), sameAfterTwoMinutes: a === b, sameAfterARestart: b === d, sameAfterStudyOffAndOn: d === e }];
  });
  await check(c, '10.4', async () => {
    const before = fr();
    if (!(await showTab(S, quiz || '\u0000'))) { quiz = await openProblem(S, 'friedland'); await workProblem(S); }
    await sleep(400);
    await openUnitPdf(S, 'Mack');
    const pt = must(await wo(S, 'paneMiddle'), 'the PDF\'s pane');
    await S.page.mouse.click(pt.x, pt.y); await desk(S, 6, ['wheel', 'key'], pt); await leave(S);
    const rd = await settle(S, () => today({ unit: 'Mack', kind: 'Reading' }), (r) => r.length === 1 && between(r[0].minutes, 5, 7));
    const after = fr();
    return [rd.length === 1 && between(rd[0].minutes, 5, 7) && before.length === 1 && after.length === 1 && after[0].minutes <= before[0].minutes + 1, { reading: brief(rd), worksheetsBefore: brief(before), worksheetsAfter: brief(after) }];
  });
}, ['10.1']);

phase(11, 'A day is the local day the work was done on, each side of midnight on its own day', 'plan', {
  '11.1': 'six minutes with Mack\'s PDF from 23:45 local are on that local day (5 to 7 minutes) and not on the next, whatever day it is in UTC',
  '11.2': 'Flashcards showing across midnight, from some minutes before it to 00:06, a key each minute and a card graded on each side: a row for each day, Unit Clark, Kind Cards, Items 1; the first day\'s reads the minutes there were to midnight, give or take one, and the next day\'s 5 to 7',
  '11.3': 'the plan\'s tab shows each day\'s Done on its own row: the first day\'s is its rows\' sum and the next day\'s its own',
}, async (S, c, A) => {
  const ws = S.workspace;
  const { start } = await planInFront(S);
  const T = await deskClock(S, 'night');
  const T1 = addDays(T, 1);
  const rows = (q) => rowsWhere(logOf(ws, A), q);
  await check(c, '11.1', async () => {
    await openUnitPdf(S, 'Mack');
    const pt = must(await wo(S, 'paneMiddle'), 'the PDF\'s pane');
    await S.page.mouse.click(pt.x, pt.y); await desk(S, 6, ['wheel', 'key'], pt);
    const at = await S.today();
    await leave(S);
    const r = await settle(S, () => rows({ unit: 'Mack', kind: 'Reading' }), (x) => x.length === 1 && between(x[0].minutes, 5, 7));
    return [at.date === T && r.length === 1 && r[0].day === T && between(r[0].minutes, 5, 7), { stillTheFirstDayWhenLeft: at.date === T, utcThen: new Date(at.ms).toISOString(), rows: brief(r) }];
  });
  await check(c, '11.2', async () => {
    const t0 = await S.today();
    must(t0.date === T && t0.hour === 23, `still before midnight of ${T} (the page's clock says ${t0.date} ${t0.hour}:${pad2(t0.minute)})`);
    await openCards(S, 'clark');
    const left = 60 - (await S.today()).minute;       // whole minutes to midnight
    must(left >= 4, `four minutes or more to midnight when the cards open (${left})`);
    await desk(S, left - 3); await gradeCard(S, 'Good');
    await desk(S, 3 + 6); await gradeCard(S, 'Good');
    const t1 = await S.today();
    await S.shot('11-after-midnight');
    await leave(S);
    const want = (r) => rows({ unit: 'Clark', kind: 'Cards', day: T }).length === 1 && rows({ unit: 'Clark', kind: 'Cards', day: T1 }).length === 1 && r.length === 2;
    const all = await settle(S, () => rows({ unit: 'Clark', kind: 'Cards' }), want);
    const a = rows({ unit: 'Clark', kind: 'Cards', day: T }); const b = rows({ unit: 'Clark', kind: 'Cards', day: T1 });
    return [t1.date === T1 && all.length === 2 && a.length === 1 && b.length === 1 && between(a[0].minutes, left - 1, left + 1) && between(b[0].minutes, 5, 7) && num(a[0].items) === 1 && num(b[0].items) === 1,
      { minutesBeforeMidnight: left, pageClockAfter: `${t1.date} ${t1.hour}:${pad2(t1.minute)}`, rows: brief(all) }];
  });
  await check(c, '11.3', async () => {
    const a = rows({ day: T }); const b = rows({ day: T1 });
    const da = await doneIs(S, start, T, minutesOf(a)); const db = await doneIs(S, start, T1, minutesOf(b));
    return [b.length >= 1 && minutesOf(b) >= 5 && minutesOf(a) >= 9 && near(da, minutesOf(a) / 60, 0.06) && near(db, minutesOf(b) / 60, 0.06), { firstDay: { rows: brief(a), doneShown: da }, nextDay: { rows: brief(b), doneShown: db } }];
  });
});

// The words a line of the breakdown is found by: the kind, or the tool that does it.
const SOURCES = { problems: /\b(Problems|Worksheets)\b/i, cards: /\b(Cards|Flashcards)\b/i, questions: /\b(Questions|Study)\b/i };
/** Every time written with its unit in a piece of text, in minutes: "1 h 5 min", "65 min", "1.1 h", "1:05". */
function timesIn(text) {
  const out = [];
  const re = /(\d+)\s*h(?:ours?|rs?)?\.?\s*(\d+)\s*m(?:in(?:utes?|s)?)?\b|(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?\b|(\d+)\s*m(?:in(?:utes?|s)?)?\b|\b(\d+):(\d{2})\b/gi;
  for (let m = re.exec(text); m; m = re.exec(text)) out.push(m[1] !== undefined ? Number(m[1]) * 60 + Number(m[2]) : m[3] !== undefined ? Number(m[3]) * 60 : m[4] !== undefined ? Number(m[4]) : Number(m[5]) * 60 + Number(m[6]));
  return out;
}
/**
 * The breakdown read from the lines of its block: { today: { problems, cards, questions }, week: … }, in minutes.
 * A line is a row of a table, an item of a list or a sentence. A line with "today" or "week" and no source sets
 * which of the two the lines after it are of (with both, the order of the columns); a source's time is the time
 * that follows its word, up to the next source's word: one time is of the part the line is in, two are today's
 * and the week's in the order the columns were named (today first when they were not).
 */
function breakdownOf(lines) {
  const out = { today: {}, week: {} };
  let scope = null; let order = ['today', 'week'];
  const scopeAt = (t) => { const a = t.search(/\btoday\b/i); const b = t.search(/\b(this |the |last 7 days|7 days|week)/i) >= 0 ? t.search(/\bweek\b|\b7 days\b/i) : -1; return { a, b }; };
  for (const raw of lines) {
    const line = String(raw);
    const hits = [];
    for (const [key, re] of Object.entries(SOURCES)) { const m = new RegExp(re.source, 'i').exec(line); if (m) hits.push({ key, at: m.index, end: m.index + m[0].length }); }
    hits.sort((x, y) => x.at - y.at);
    const { a, b } = scopeAt(line);
    const firstHit = hits.length ? hits[0].at : Infinity;
    if (a >= 0 && b >= 0 && Math.max(a, b) < firstHit) { order = a < b ? ['today', 'week'] : ['week', 'today']; if (!hits.length) { scope = null; continue; } }
    else if (a >= 0 && a < firstHit) scope = 'today';
    else if (b >= 0 && b < firstHit) scope = 'week';
    hits.forEach((h, i) => {
      const times = timesIn(line.slice(h.end, i + 1 < hits.length ? hits[i + 1].at : undefined));
      if (times.length >= 2) { if (!(h.key in out[order[0]])) out[order[0]][h.key] = times[0]; if (!(h.key in out[order[1]])) out[order[1]][h.key] = times[1]; }
      else if (times.length === 1 && scope && !(h.key in out[scope])) out[scope][h.key] = times[0];
    });
  }
  return out;
}
/** Minutes shown against minutes meant: the same, or within what a tenth of an hour rounds away. */
const about = (shown, meant) => typeof shown === 'number' && Math.abs(shown - meant) <= 3;

phase(12, 'Seen, not hidden: a subject shows where its minutes came from, for today and the week, from the Work Log', 'plan', {
  '12.1': 'in Study, the subject shows today\'s minutes by tool or kind: Problems (Worksheets) 25 and Cards (Flashcards) 12, as its Work Log has them',
  '12.2': 'and the week\'s: Problems, Cards and Questions (Study) as the Work Log has them for the week (Monday to Sunday, Sunday to Saturday or the last seven days: one of them, the same for all three), which leaves out the 500 minutes of eight days ago',
  '12.3': 'it is read from the Work Log: today\'s Problems row changed to 55 minutes, and the subject shows 55 for today and 30 more for the week',
}, async (S, c, A) => {
  const ws = S.workspace;
  await planInFront(S);
  const T = await deskClock(S, 'midweek');
  // Rows as he might have written them, each with its tool and its kind.
  const hand = [[0, 'Worksheets', 'Problems', 25], [0, 'Flashcards', 'Cards', 12], [-1, 'Flashcards', 'Cards', 48], [-1, 'Worksheets', 'Problems', 40], [-2, 'Study', 'Questions', 30], [-8, 'Worksheets', 'Problems', 500]];
  const made = [];
  for (const [d, tool, kind, minutes] of hand) made.push((await addRow(S, A.log, `${kind} by hand`, { Date: `${addDays(T, d)}T10:00`, Minutes: minutes, Tool: tool, Kind: kind, Origin: 'Manual' })).pageId);
  const stored = logOf(ws, A).filter((r) => made.includes(r.pageId));
  must(stored.length === 6 && stored.every((r) => r.tool && r.kind), `the six rows stored with their Tool and Kind (${brief(stored).join(' | ')})`);
  /** What the Work Log has, by source, for today and for the week under each reading of "the week". */
  const meant = () => {
    const rows = logOf(ws, A);
    const src = (r) => (SOURCES.problems.test(`${r.kind} ${r.tool}`) ? 'problems' : SOURCES.cards.test(`${r.kind} ${r.tool}`) ? 'cards' : /^questions$/i.test(r.kind) ? 'questions' : null);
    const sum = (from, to) => { const o = { problems: 0, cards: 0, questions: 0 }; for (const r of rows) { const k = src(r); if (k && r.day >= from && r.day <= to) o[k] += r.minutes; } return o; };
    const wd = WEEKDAYS.indexOf(weekdayOf(T));          // Mon 0 … Sun 6
    return { today: sum(T, T), week: { 'Monday to Sunday': sum(addDays(T, -wd), addDays(T, 6 - wd)), 'Sunday to Saturday': sum(addDays(T, -((wd + 1) % 7)), addDays(T, 6 - ((wd + 1) % 7))), 'the last seven days': sum(addDays(T, -6), T) } };
  };
  /** The subject's surfaces in Study, each looked at for the breakdown: what its More Actions opens, and the sidebar. */
  const look = async () => {
    const seen = []; visited.length = 0;
    const blockOf = (scope) => S.page.evaluate(({ scope, a, b }) => {
      const s = window.__ap.scopeEl(scope); if (!s) return null;
      const res = [/\btoday\b/i, /\bweek\b|\b7 days\b/i, new RegExp(a, 'i'), new RegExp(b, 'i')];
      let best = null;
      for (const n of s.querySelectorAll('*')) { if (!window.__ap.shown(n)) continue; const t = n.innerText || ''; if (t.length > 4000 || !res.every((re) => re.test(t))) continue; if (!best || t.length < best.length) best = t; }
      return best ? best.split('\n').map((l) => l.replace(/[  ]+/g, ' ').trim()).filter(Boolean) : null;
    }, { scope, a: SOURCES.problems.source, b: SOURCES.cards.source });
    await showStudySidebar(S);
    const side = await blockOf('sidebar');
    visited.push('Study\'s sidebar');
    if (side) seen.push({ where: 'Study\'s sidebar', lines: side });
    const items = (await rowMenu(S, SUBJECT)) || [];
    await S.page.keyboard.press('Escape'); await sleep(200);
    for (const name of items.map((i) => i.name).filter((n) => /^(open|show|view)\b/i.test(n) && !/^open (units|questions|work log)$/i.test(n))) {
      const again = ((await rowMenu(S, SUBJECT)) || []).find((i) => i.name === name);
      if (!again) { await S.page.keyboard.press('Escape'); continue; }
      await S.click(again);
      await sleep(1500);
      visited.push(`"${name}"`);
      const lines = await blockOf('pane');
      if (lines) seen.push({ where: `"${name}" in the subject's More Actions`, lines });
    }
    return seen.map((x) => ({ ...x, got: breakdownOf(x.lines) }));
  };
  const visited = [];
  let seen = await look();
  await S.shot('12-where-the-minutes-came-from');
  const fitsWeek = (got, m) => Object.entries(m.week).find(([, w]) => ['problems', 'cards', 'questions'].every((k) => about(got.week[k], w[k])));
  await check(c, '12.1', async () => {
    const m = meant();
    const hit = seen.find((x) => about(x.got.today.problems, m.today.problems) && about(x.got.today.cards, m.today.cards));
    return [!!hit && m.today.problems === 25 && m.today.cards === 12, { workLogSays: m.today, found: hit ? { where: hit.where, shows: hit.got.today } : null, lookedIn: visited.join(', '), whereTodayTheWeekAndTwoSourcesStandTogether: seen.map((x) => `${x.where}: ${JSON.stringify(x.got)}`) }];
  });
  await check(c, '12.2', async () => {
    const m = meant();
    const hit = seen.map((x) => ({ x, w: fitsWeek(x.got, m) })).find((r) => r.w);
    return [!!hit && Object.values(m.week).every((w) => w.problems < 500 && w.questions === 30), { workLogSays: m.week, found: hit ? { where: hit.x.where, shows: hit.x.got.week, theWeekIs: hit.w[0] } : null, looked: seen.map((x) => `${x.where}: ${JSON.stringify(x.got.week)}`) }];
  });
  await check(c, '12.3', async () => {
    const before = meant();
    await setProp(S, made[0], 'Minutes', 55);
    must(await until(() => meant().today.problems === before.today.problems + 30, 3000, 50), 'the 55 minutes in the file');
    const m = meant(); let hit = null;
    for (let i = 0; i < 2 && !hit; i++) { await sleep(1200); seen = await look(); hit = seen.find((x) => about(x.got.today.problems, m.today.problems) && fitsWeek(x.got, m)) || null; }
    return [!!hit && m.today.problems === before.today.problems + 30, { workLogSays: { today: m.today, week: m.week }, found: hit ? { where: hit.where, shows: hit.got } : null, looked: seen.map((x) => `${x.where}: ${JSON.stringify(x.got)}`) }];
  });
});

async function main() {
  await fs.rm(path.join(OUT, 'shots'), { recursive: true, force: true });
  await fs.mkdir(path.join(OUT, 'shots'), { recursive: true });
  await fs.rm(path.join(OUT, 'runs'), { recursive: true, force: true });
  const t0 = Date.now();
  const keptIds = new Set();
  const runs = new Map();
  for (const p of PHASES) {
    if (ONLY && !ONLY.has(p.n)) continue;
    runs.set(p.n, (runs.get(p.n) || 0) + 1);
    const dirName = `phase-${String(p.n).padStart(2, '0')}${runs.get(p.n) > 1 ? `-${runs.get(p.n)}` : ''}`;
    console.log(`\n── ${p.n}. ${p.title}`);
    const tp = Date.now();
    const done = new Set();
    for (const id of p.kept) keptIds.add(id);
    const c = (id, ok, got) => { if (done.has(id)) return; done.add(id); record(id, `${p.kept.includes(id) ? '(holds today) ' : ''}${p.checks[id] ?? '(unnamed check)'}`, ok, got); };
    let S = null;
    let stopped = '';
    try {
      S = makeSession(await newRoot(dirName, await baseOf(p.base), BASE_WORKSPACE));
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
    if (stopped) console.log(`   the phase stopped: ${stopped}`);
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
