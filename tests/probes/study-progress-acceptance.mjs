// @acceptance: Study's Progress: a subject's units as bars of right, partly, wrong and not yet, with the bars of every tool that reports progress
// Written from the request (piece 2 of the Study system, "Progress", 2026-11-18)
// before the build, by a verifier that did not build it, and seen to fail on
// the app as it was (c475b3c7). The builder does not edit this file: a check
// that is wrong is reported, not changed.
//
// What a person must be able to do when the piece is done (a phase's number is
// the request's statement; 11 is "For tool authors"; PARALLX_PROBE_ONLY takes
// these numbers):
//
//    1  Open Progress: first in a subject's More Actions menu, and the command
//       "Study: Open Progress…" (study.openProgress), which asks which subject
//       when there is more than one. It opens a tab titled "<Subject> Progress"
//    2  one row per unit in the Units order, a "Questions" bar (green Right,
//       yellow Partly, red Wrong, the rest not answered) and "N of M" beside
//       it; above the rows the subject's totals per kind and a legend in words
//    3  "In Order" / "Weakest First", remembered
//    4  a part of a Questions bar is a button that starts the unit's setup on
//       those questions; the unit's name opens its setup; a part of another
//       tool's bar opens that tool when the tool offers it, and is plain when
//       it does not
//    5  an answer in a session, a row edited in the Questions database, a
//       problem rated in Worksheets, a card rated in Flashcards: the open tab
//       shows the new counts within 2 s (each time is printed)
//    6  "Problems" bars with Worksheets' own counts, "Cards" bars from
//       Flashcards; a tool turned off takes only its bars, at once; Study off
//       and nothing of Progress runs
//    7  matching by name (case, spaces and punctuation aside), "Also Called" in
//       Units, and a line per tool for the groups that match no unit
//    8  the sidebar's unit rows carry a thin bar over all kinds together
//    9  names a screen reader speaks, one order of parts, contrast in light and
//       dark, keyboard and focus, a part too thin for a finger still reachable
//   10  no questions yet; the database in the Trash; no bar for a kind with
//       nothing; 2,000 questions in 20 units open in under 2 s (printed)
//   11  the core seam: any extension reaches the progress providers through
//       one core command, with Study off; Worksheets and Flashcards are there
//       while they are on; the stacked bar is in the kit
//    0  is not in the request: it is the ground the other checks stand on, the
//       app as it is today (the seed as Worksheets' dashboard shows it, a
//       problem and a card rated on the tools' own screens, a cell changed in
//       the table, a tool turned off and on, light and dark, the Trash). Its
//       checks pass before the build and must go on passing; every other
//       check fails before the build
//
// How it runs. Every phase gets its own app, profile and workspace, so one
// failure hides nothing. Phases 1 to 9 and 11 start from a copy of a workspace
// that the app itself made: a seeded database adopted as the subject "Exam 7"
// (the piece before this one), a problem bank in Worksheets and two decks in
// Flashcards. A scripted model stands in for the owner's (there is none here):
// it grades a typed answer by its words, so it proves the plumbing and never
// the quality of grading. The mouse and the keys are real.
//
//   xvfb-run -a node tests/probes/study-progress-acceptance.mjs [outDir]
//   PARALLX_PROBE_ONLY=1,4,7-9   only those phases
//
// Where a result is read from. Never from what the probe typed: from the bars
// on screen (their spoken names, their parts, the "N of M" beside them), from
// the workspace's own database file (<workspace>/.parallx/data.db), from
// Worksheets' own dashboard ("Progress by paper", read off its screen in the
// same app), and from a second extension that is not Study.
//
// How the probe writes (none of it is Study or the new seam):
//   - the Questions and Units databases: the chat's own tools to seed, then the
//     canvas table with the mouse and keys
//   - Worksheets' problems and their ratings, Flashcards' decks, cards and
//     reviews: written into the workspace file with the app closed, into the
//     tables the tools made (ws_items, ws_attempts; Flashcards' own file:
//     fc_decks, fc_cards, fc_reviews), as tests/probes/worksheet-seed.cjs does. One problem and one
//     card are then rated through the tools' own screens (phase 5)
//   - for the 2,000-question case, 1,980 rows are copies of rows the app made
//
// What the probe holds on to (the builder keeps these, or the check fails):
//   - the words of the request, found as a person reads them: the command
//     study.openProgress titled "Study: Open Progress…"; "Open Progress" first
//     in the subject's More Actions menu; the tab "<Subject> Progress"; the
//     kinds "Questions", "Problems", "Cards"; "N of M"; the legend's Right,
//     Partly, Wrong, Not yet; "In Order" and "Weakest First" (one of them
//     marked chosen by aria-checked, aria-pressed or aria-selected); the column
//     "Also Called"; "<Kind> not matched to a unit: …" and its hint naming
//     Also Called; "No questions yet."; the word Trash
//   - a bar is an element with role "group" or "img" whose accessible name
//     (aria-label) is statement 9's sentence: "<Unit>, <Kind>: 12 right,
//     3 partly, 2 wrong, 5 not yet" (four counts, always in that order; a
//     tool's bar says the tool's own four words; a totals bar names the
//     subject or "All units" in place of the unit; the sidebar's bar may leave
//     the kind out)
//   - THE ONE NEW HOOK: each part of a bar is a descendant of the bar that
//     carries data-state = "good", "middling", "poor" or "rest" (the request's
//     own words for the four states), is as wide as it is drawn, and has its
//     colour as its own background-color. A part with nothing in it is not in
//     the bar. A part that can be pressed is a <button> or role="button" whose
//     name is statement 9's: "Mack, Questions, wrong: 2. Study these"
//   - the count beside a bar is the nearest "N of M" in the smallest box around
//     the bar that holds no other bar
//   - a choice of subject, and a menu, are the app's own (a quick pick's rows,
//     [role=menuitem])
//   - the seam: one core command whose id has "progress" and "registry" or
//     "providers" in it and is not study.*; it returns one object with a
//     function to register, a function to list, and an event (as
//     questions.getRegistry does). A provider's fields are not named by the
//     request beyond id, tool id, a display name and the group's shape
//     { group, label, total, good, middling, poor }, so the probe reads them by
//     kind: its strings, the function that lists (list…, …groups…, …counts…),
//     the event (on…), the optional function that opens (open…, show…), its
//     four words wherever they are. The probe's own provider (kind "Drills",
//     words Crisp, Shaky, Blank, Untried) is made in the shape of Worksheets'
//   - the kit's bar is a function of api.ui with "bar" in its name
//   - as they are today: Study's sidebar and session card (see the probe of the
//     piece before), the canvas table, Worksheets' dashboard (.ws-dash__paperrow,
//     its bar's aria-label "Clark: 3 easy, 1 medium, 2 hard, 4 not rated", a
//     part's "Quiz Clark Not rated, 4 problems"), the sheet's rating ("Rate
//     this problem": Easy, Medium, Hard), Flashcards' flashcards.studyTag, Show
//     Answer and the grade buttons, Appearance's Light and Dark
//
// How the request is read where it leaves room (told to the builder):
//   - the totals of a tool's kind may be over the units' bars or over every
//     group of the tool: either passes
//   - "the contrast rule" is WCAG 1.4.11, 3 to 1: each part against the surface
//     the bar sits on (the rest part may instead sit in a bar whose border or
//     outline has 3 to 1), and each part against its neighbour unless a gap of
//     at least one pixel of the surface lies between them
//   - "shows focus": a part focused by Tab has, on the part itself, an outline
//     or a shadow (with a colour and a size) that it does not have unfocused
//   - "too thin to press by finger": narrower than 24 px (WCAG 2.5.8). Then
//     the part is at least that wide anyway, or a menu button on its row
//     offers the same action by the state's word
//   - "at once" for a tool turned off, and for a provider that goes: 2 s
//   - Open Progress twice shows the one tab, it does not make a second
//   - an edit of Also Called or of Order shows in the open tab within 5 s, or
//     at the latest when Progress is opened again (which it was is printed)
//   - "N of M" beside a unit in the sidebar may count the questions (as the
//     piece before) or all kinds; the bar beside it is over all kinds
//   - a unit made by hand in Units with no questions, and matched to a paper,
//     has a Problems bar and no Questions bar
//   - the unmatched line names a group by its name or its label, followed by
//     its total ("Brosius 6", "brosius 5 of 6" both pass)
//
// Not checked here: the bar's look beyond its colours, order and size (the
// visual bar's probe does that); touch itself (tests/probes/touch-drag-probe
// and the keyboard audit); a database that is deleted for ever, as opposed to
// in the Trash; that the core seam's code names no tool (the modularity
// reviewer reads that; here a tool the core cannot know, the probe's own, gets
// its bar); whether Worksheets or Flashcards choose to offer "open"; parallx.d.ts
// (the request types the seam only "if it is part of the api").
import { _electron as electron } from 'playwright';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.resolve(process.argv[2] ?? path.join(REPO, 'test-results', 'study-progress-acceptance'));
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
/** A name as matching reads it: case, spaces, punctuation and accents aside. */
const plain = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
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
const sum4 = (...lists) => lists.reduce((t, l) => t.map((v, i) => v + l[i]), [0, 0, 0, 0]);

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
/** Flashcards keeps its decks, cards and reviews in a file of its own. */
const cardsFile = (workspace) => path.join(workspace, '.parallx', 'extensions', 'flashcards', 'data.db');
const coreAll = (workspace, sql, params = []) => fileAll(coreFile(workspace), sql, params);
const cardsAll = (workspace, sql, params = []) => fileAll(cardsFile(workspace), sql, params);
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

// ── What is seeded ───────────────────────────────────────────────────────────
// Counts are always [green, yellow, red, the rest].
const SUBJECT = 'Exam 7';
const BANK = 'Conceptual Questions';
const WRONG = 'Qqqqqqq zzzzzzz wwwwwww.';
// Study's own questions, by paper, as their last results: R right, P partly, W wrong, N not answered.
const Q_STATES = { Mack: 'RRRPWWNN', Clark: 'RPPNNN', Friedland: 'NNNN', Venter: 'RRRRW' };
const Q = Object.fromEntries(Object.entries(Q_STATES).map(([u, s]) => [u, ['R', 'P', 'W', 'N'].map((k) => [...s].filter((x) => x === k).length)]));
const RESULT = { R: 'Right', P: 'Partly', W: 'Wrong' };
const BY_RESULT = { good: 'R', middling: 'P', poor: 'W', rest: 'N' };
/** The questions, the papers taking turns so the units come out as Mack, Clark, Friedland, Venter. */
const SEED = (() => {
  const out = [];
  const papers = Object.keys(Q_STATES);
  for (let i = 0; i < 8; i++) papers.forEach((paper, p) => {
    const state = Q_STATES[paper][i];
    if (!state) return;
    const n = (p + 1) * 100 + i + 1;
    out.push({ paper, state, n, question: `What does ${paper} hold about reserving item ${n}?`, answer: `Statement number${n} explains ${paper.toLowerCase()} reserving matters properly.` });
  });
  return out;
})();
const stemsOf = (paper, state) => SEED.filter((q) => q.paper === paper && (!state || q.state === state)).map((q) => q.question).sort();
const seededQuestion = (stem) => SEED.find((q) => norm(q.question) === norm(stem)) || null;
const HAND_UNIT = 'Siewert';                                   // a unit made by hand: problems, no questions
const UNITS = [...Object.keys(Q_STATES), HAND_UNIT];             // the Units order
// Worksheets' problems by paper: [easy, medium, hard, not rated]. Only the first three papers equal a unit's name.
const P = { clark: [3, 1, 2, 4], friedland: [0, 0, 0, 5], siewert: [1, 0, 1, 2], brosius: [2, 2, 1, 1], hurlimann: [0, 0, 3, 0], mack1994: [4, 1, 1, 1] };
const P_LABEL = { clark: 'Clark', friedland: 'Friedland', siewert: 'Siewert', brosius: 'Brosius', hurlimann: 'Hürlimann', mack1994: 'Mack (1994)' };
const P_UNIT = { Clark: 'clark', Friedland: 'friedland', Siewert: 'siewert' };
// Flashcards' cards by group, as last ratings: G good, E easy, H hard, A again, N never reviewed.
const DECK = 'Exam 7 Cards';
const CARD_TAGS = { mack: 'GEHAN', clark: 'GNN', 'fried-land': 'NNN', 'chain-ladder': 'GN' };
const CARD_DECKS = { VENTER: 'AAHN' };
const cardCounts = (s) => [[...s].filter((x) => x === 'G' || x === 'E').length, [...s].filter((x) => x === 'H').length, [...s].filter((x) => x === 'A').length, [...s].filter((x) => x === 'N').length];
const C = { Mack: cardCounts(CARD_TAGS.mack), Clark: cardCounts(CARD_TAGS.clark), Friedland: cardCounts(CARD_TAGS['fried-land']), Venter: cardCounts(CARD_DECKS.VENTER) };
const C_CHAIN = cardCounts(CARD_TAGS['chain-ladder']);
/** Every kind of a unit together, as seeded. */
const allKinds = (unit) => sum4(Q[unit] || [0, 0, 0, 0], P_UNIT[unit] ? P[P_UNIT[unit]] : [0, 0, 0, 0], C[unit] || [0, 0, 0, 0]);
/** Weakest first: the lowest share of green over all a unit's items; nothing attempted comes last. */
const WEAKEST = (() => {
  const share = (u) => { const c = allKinds(u); const total = c[0] + c[1] + c[2] + c[3]; return { u, attempted: c[0] + c[1] + c[2] > 0, share: total ? c[0] / total : 0 }; };
  const all = UNITS.map(share);
  return [...all.filter((x) => x.attempted).sort((a, b) => a.share - b.share), ...all.filter((x) => !x.attempted)].map((x) => x.u);
})();
const nOfM = (c) => ({ n: c[0] + c[1] + c[2], m: c[0] + c[1] + c[2] + c[3] });
const Q_WORDS = ['right', 'partly', 'wrong', 'not yet'];
const STATES = ['good', 'middling', 'poor', 'rest'];
/** Statement 9's sentence for a bar. */
const spoken = (owner, kind, counts, words = Q_WORDS) => `${owner}, ${kind}: ${counts.map((n, i) => `${n} ${words[i]}`).join(', ')}`;

// <model>
// The scripted model: provider "probe", model "probe-model". It answers
// Study's grading prompts from the prompt itself. A typed answer is right when
// its words cover each point to mark (or, with no points listed, the text
// before "Student's answer:"), so the row's own answer typed back is right and
// WRONG is wrong.
function installProbeModel() {
  const svc = window.__parallx_workbench__?._services?.get?.({ id: 'ILanguageModelsService' });
  if (!svc?.registerProvider) return 'no models service';
  const M = (window.__probeModel = window.__probeModel || { calls: [] });
  const long = (s) => String(s).toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 4);
  const pointsOf = (s) => {
    const parts = String(s).replace(/\.$/, '').split(/,\s+(?:and\s+|which\s+|with\s+)?|\s+and\s+|\.\s+/).map((p) => p.trim()).filter((p) => p.split(' ').length >= 3);
    return (parts.length ? parts : [String(s)]).slice(0, 3).map((t, i) => ({ text: t, required: i < 2 }));
  };
  const info = { id: 'probe-model', displayName: 'Probe Model', family: 'probe', parameterSize: '1B', quantization: 'none', contextLength: 32768, capabilities: ['completion'] };
  function answerFor(kind, user) {
    if (kind === 'grade') {
      const [before, after = ''] = user.split(/Student's answer:/i);
      const answer = after.toLowerCase();
      const block = (before.split(/Points to mark[^\n]*:/i)[1] || '');
      let pts = block.split('\n').map((l) => l.trim()).filter((l) => /^\d+\.\s/.test(l)).map((l) => l.replace(/^\d+\.\s*/, '').replace(/\s*\(supporting detail\)$/, ''));
      if (!pts.length) pts = [long(answer).filter((w) => before.toLowerCase().includes(w)).length >= Math.max(1, Math.ceil(long(answer).length * 0.6)) && long(answer).length ? answer : '\u0000missing'];
      const points = pts.map((p) => {
        const ws = long(p); const hit = ws.filter((w) => answer.includes(w)).length;
        return { status: ws.length && hit / ws.length >= 0.6 ? 'hit' : hit > 0 ? 'partial' : 'miss', note: '' };
      });
      return JSON.stringify({ points, contradiction: false, note: points.every((p) => p.status === 'hit') ? '' : 'The answer leaves out what the reference says.' });
    }
    if (kind === 'rubric') { const ref = (user.split(/answer:\n/i)[1] || user).split('\n')[0]; return JSON.stringify({ rubric: pointsOf(ref), contradictions: [] }); }
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
      const entry = { n: M.calls.length + 1, kind, t0: Date.now(), t1: 0 };
      M.calls.push(entry);
      try {
        const out = answerFor(kind, user);
        for (let i = 0; i < out.length; i += 200) { if (signal?.aborted) return; yield { content: out.slice(i, i + 200), done: false }; }
        yield { content: '', done: true };
      } finally { entry.t1 = Date.now(); }
    },
  });
  svc.setActiveModel?.('probe-model');
  return 'ok';
}
// </model>

// <page>
// What the probe reads off the page: a control by the name a person reads, the
// card on screen, a field of the dialog by its label, a cell of the table, and
// the bars with their parts.
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
  const BAR_NAME = /^(.+?)(?:,\s*([^,:]+))?:\s*(\d+)\s+([^,]+?),\s*(\d+)\s+([^,]+?),\s*(\d+)\s+([^,]+?),\s*(\d+)\s+([^,]+?)\.?$/;
  const NOT_A_BAR = 'button, a, input, select, textarea, [role="button"], [role="radio"], [role="tab"], [role="menuitem"], [role="option"], [role="link"], [role="checkbox"], [role="switch"]';
  const edge = (cs, base) => {
    const sides = [[cs.borderTopWidth, cs.borderTopColor, cs.borderTopStyle], [cs.outlineWidth, cs.outlineColor, cs.outlineStyle]];
    return sides.filter(([w, , style]) => parseFloat(w) >= 1 && style !== 'none').map(([, c]) => over(colour(c), base)).filter(Boolean);
  };
  /** The bars in `scope`: the name each speaks, its counts, its parts, the "N of M" beside it. */
  const bars = (scope) => {
    const s = scopeEl(scope);
    if (!s) return [];
    const found = [];
    for (const n of s.querySelectorAll('[aria-label], [aria-labelledby]')) {
      if (!shown(n) || n.matches(NOT_A_BAR) || found.some((f) => f.n.contains(n))) continue;
      const name = spokenName(n);
      const m = BAR_NAME.exec(name);
      if (m) found.push({ n, name, m });
    }
    return found.map(({ n, name, m }) => {
      const r = n.getBoundingClientRect();
      const base = ground(n.parentElement || n);
      const parts = Array.from(n.querySelectorAll('[data-state]')).filter((p) => ['good', 'middling', 'poor', 'rest'].includes(p.getAttribute('data-state'))).map((p) => {
        const pr = p.getBoundingClientRect(); const cs = getComputedStyle(p);
        const button = p.tagName === 'BUTTON' || p.getAttribute('role') === 'button';
        return {
          state: p.getAttribute('data-state'), shown: shown(p), x: pr.x, w: pr.width, h: pr.height, cx: pr.x + pr.width / 2, cy: pr.y + pr.height / 2,
          button, focusable: p.tabIndex >= 0, disabled: !!p.disabled || p.getAttribute('aria-disabled') === 'true', name: spokenName(p) || norm(p.getAttribute('title')),
          bg: over(colour(cs.backgroundColor), base), raw: cs.backgroundColor, edges: edge(cs, base),
        };
      });
      // The count beside it: the nearest "N of M" in the smallest box around the bar that holds no other bar.
      let count = null;
      for (let p = n.parentElement; p && s.contains(p); p = p.parentElement) {
        if (found.filter((f) => p.contains(f.n)).length > 1) break;
        const t = /(\d[\d,]*)\s+of\s+(\d[\d,]*)/.exec(norm(p.innerText));
        if (t) { count = { n: Number(t[1].replace(/,/g, '')), m: Number(t[2].replace(/,/g, '')) }; break; }
        if (p === s) break;
      }
      const cs = getComputedStyle(n);
      return {
        name, owner: norm(m[1]), kind: norm(m[2] || ''), counts: [m[3], m[5], m[7], m[9]].map(Number), words: [m[4], m[6], m[8], m[10]].map(norm),
        role: n.getAttribute('role') || '', x: r.x, y: r.y, w: r.width, h: r.height, classes: Array.from(n.classList), count, parts,
        surface: base, edges: edge(cs, base),
      };
    });
  };
  window.__ap = {
    shown, scopeEl, bars,
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
    tabs: () => Array.from(document.querySelectorAll('.ui-tab')).map((t) => { const l = t.querySelector('.ui-tab-label') || t; const id = t.getAttribute('data-tab-id') || ''; return { id, active: t.classList.contains('ui-tab--active'), label: studyPlaceName(id, norm(t.querySelector('.ui-tab-label')?.textContent)), ...point(l) }; }),
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
      const bar = a.closest('[data-state]') ? Array.from(document.querySelectorAll('[aria-label]')).find((b) => b !== a && b.contains(a) && BAR_NAME.test(spokenName(b))) : null;
      return { name: spokenName(a) || norm(a.textContent) || norm(a.getAttribute('title')), tag: a.tagName, role: a.getAttribute('role') || '', state: a.getAttribute('data-state') || '', bar: bar ? spokenName(bar) : '', inPane: !!scopeEl('pane')?.contains(a),
        ring: `${cs.outlineStyle}|${parseFloat(cs.outlineWidth) || 0}|${cs.outlineColor}|${cs.boxShadow}`, hasRing: drawn(cs), keyboard: a.matches(':focus-visible') };
    },
    /** The look of the part named `name` while it does not have the focus. */
    ringOf(name) {
      const n = Array.from(document.querySelectorAll('[data-state]')).find((p) => shown(p) && spokenName(p) === name);
      if (!n) return null;
      const cs = getComputedStyle(n);
      return `${cs.outlineStyle}|${parseFloat(cs.outlineWidth) || 0}|${cs.outlineColor}|${cs.boxShadow}`;
    },
  };
  return true;
}
// </page>

// ── An extension that is not Study, to stand at the seam ────────────────────
const DOOR_EXT = {
  manifest: { manifestVersion: 1, id: 'probe.door-probe', name: 'Door Probe', version: '0.0.1', publisher: 'probe', description: 'Reads and fills the progress providers for the acceptance probe.', main: 'main.js', activationEvents: ['onStartupFinished'], engines: { parallx: '^0.1.0' },
    contributes: { commands: ['registry', 'groups', 'watch', 'watched', 'mimic', 'mimicSet', 'mimicState', 'mimicDispose', 'ui'].map((c) => ({ id: `doorprobe.${c}`, title: `Door Probe: ${c}` })) } },
  main: `
const safe = (v) => { try { return v === undefined ? null : JSON.parse(JSON.stringify(v)); } catch { return String(v); } };
const keysOf = (o) => { const out = new Set(); for (let p = o; p && p !== Object.prototype && p !== Function.prototype; p = Object.getPrototypeOf(p)) for (const k of Object.getOwnPropertyNames(p)) if (k !== 'constructor') out.add(k); return [...out]; };
const fnKey = (o, yes, no) => keysOf(o).find((k) => typeof o[k] === 'function' && yes.test(k) && !(no && no.test(k)));
const LIST = /list|group|count/i; const EVENT = /^on[A-Z_]/; const OPEN = /open|show|reveal|launch|start/i;
const describe = (p) => { const d = { id: String(p.id || ''), strings: {}, functions: [], objects: {} }; for (const k of keysOf(p)) { const v = p[k]; if (typeof v === 'string') d.strings[k] = v; else if (typeof v === 'function') d.functions.push(k); else if (v && typeof v === 'object') d.objects[k] = safe(v); } return d; };
export function activate(api, context) {
  const reg = async (cmd) => { const r = await api.commands.executeCommand(cmd); return r && typeof r === 'object' ? r : null; };
  const listOf = (r) => { const k = fnKey(r, /^(list|all|get|providers)/i); return k ? Array.from(r[k]() || []) : []; };
  const watch = { fired: 0, sub: null };
  const mine = new Map();
  const on = (id, fn) => context.subscriptions.push(api.commands.registerCommand(id, async (...args) => { try { return await fn(...args); } catch (e) { return { ok: false, error: String((e && e.message) || e) }; } }));
  on('doorprobe.registry', async (cmd) => {
    const r = await reg(cmd);
    if (!r) return { ok: false, error: 'the command returned no object' };
    return { ok: true, keys: keysOf(r).filter((k) => typeof r[k] === 'function'), providers: listOf(r).map(describe) };
  });
  on('doorprobe.groups', async (cmd, id) => {
    const r = await reg(cmd); const p = r && listOf(r).find((x) => x.id === id);
    if (!p) return { ok: false, error: 'no provider ' + id };
    const k = fnKey(p, LIST, EVENT);
    if (!k) return { ok: false, error: 'the provider has no function that lists its groups' };
    return { ok: true, fn: k, groups: safe(await p[k]()) };
  });
  on('doorprobe.watch', async (cmd) => {
    const r = await reg(cmd); const k = r && fnKey(r, EVENT);
    if (!k) return { ok: false, error: 'the registry has no event' };
    if (watch.sub) watch.sub.dispose();
    watch.fired = 0; watch.sub = r[k](() => { watch.fired += 1; });
    context.subscriptions.push(watch.sub);
    return { ok: true, event: k };
  });
  on('doorprobe.watched', async () => ({ ok: true, fired: watch.fired }));
  // A provider of this extension's own, in the shape of one a tool registered: same fields, its own values.
  on('doorprobe.mimic', async (cmd, spec) => {
    const r = await reg(cmd);
    if (!r) return { ok: false, error: 'no registry' };
    const real = listOf(r).find((p) => !String(p.id || '').startsWith('doorprobe.') && /worksheet/i.test(String(p.id) + ' ' + JSON.stringify(describe(p).strings))) || listOf(r).find((p) => !String(p.id || '').startsWith('doorprobe.'));
    if (!real) return { ok: false, error: 'no provider is registered to shape a new one on' };
    const st = { groups: spec.groups, listCalls: 0, openCalls: [], listeners: new Set(), reg: null };
    const words = spec.words;
    const slot = (key, value, i) => (/good/i.test(key) ? 0 : /midd/i.test(key) ? 1 : /poor|bad/i.test(key) ? 2 : /rest|none|not|new|un/i.test(key) ? 3 : /easy/i.test(value) ? 0 : /medium/i.test(value) ? 1 : /hard/i.test(value) ? 2 : /not|un|new/i.test(value) ? 3 : i);
    const reword = (v) => {
      if (Array.isArray(v)) return v.map((x, i) => (typeof x === 'string' ? words[Math.min(i, 3)] : reword(x)));
      if (v && typeof v === 'object') { const out = {}; Object.keys(v).forEach((k, i) => { out[k] = typeof v[k] === 'string' ? words[slot(k, v[k], Math.min(i, 3))] : reword(v[k]); }); return out; }
      return v;
    };
    const listKey = fnKey(real, LIST, EVENT);
    let sync = false;
    try { const probe = listKey ? real[listKey]() : null; sync = !(probe && typeof probe.then === 'function'); } catch { sync = false; }
    const clone = {}; const shape = {};
    let hasOpen = false;
    for (const k of keysOf(real)) {
      const v = real[k];
      if (typeof v === 'string') { clone[k] = v === real.id ? spec.id : /tool/i.test(k) ? 'probe.door-probe' : spec.kind; shape[k] = 'string'; }
      else if (typeof v === 'function') {
        if (EVENT.test(k)) { clone[k] = (listener) => { st.listeners.add(listener); return { dispose() { st.listeners.delete(listener); } }; }; shape[k] = 'event'; }
        else if (k === listKey) { clone[k] = sync ? () => { st.listCalls += 1; return st.groups.map((g) => ({ ...g })); } : async () => { st.listCalls += 1; return st.groups.map((g) => ({ ...g })); }; shape[k] = 'list'; }
        else if (OPEN.test(k)) { hasOpen = true; if (spec.withOpen) { clone[k] = (...args) => { st.openCalls.push(safe(args)); return Promise.resolve(true); }; shape[k] = 'open'; } }
        else { clone[k] = v.bind(real); shape[k] = 'kept'; }
      } else if (v && typeof v === 'object') { clone[k] = reword(v); shape[k] = 'words'; }
      else { clone[k] = v; shape[k] = typeof v; }
    }
    if (spec.withOpen && !hasOpen) { clone.open = (...args) => { st.openCalls.push(safe(args)); return Promise.resolve(true); }; shape.open = 'open (no provider had one to copy the name from)'; }
    const rk = fnKey(r, /^(register|add)/i);
    if (!rk) return { ok: false, error: 'the registry has no function to register' };
    st.reg = r[rk](clone);
    mine.set(spec.id, st);
    return { ok: true, shapedOn: String(real.id), shape, words: safe(Object.fromEntries(Object.entries(clone).filter(([, v]) => v && typeof v === 'object'))) };
  });
  on('doorprobe.mimicSet', async (id, groups) => { const st = mine.get(id); if (!st) return { ok: false, error: 'not registered' }; if (groups) st.groups = groups; for (const l of [...st.listeners]) { try { l(); } catch { /* the listener's own */ } } return { ok: true, listeners: st.listeners.size }; });
  on('doorprobe.mimicState', async (id) => { const st = mine.get(id); return st ? { ok: true, listCalls: st.listCalls, openCalls: st.openCalls, listeners: st.listeners.size } : { ok: false, error: 'not registered' }; });
  on('doorprobe.mimicDispose', async (id) => { const st = mine.get(id); if (st && st.reg && st.reg.dispose) st.reg.dispose(); mine.delete(id); return { ok: true }; });
  on('doorprobe.ui', async () => ({ ok: true, keys: api.ui ? Object.keys(api.ui) : [] }));
}
export function deactivate() {}
`,
};

// ── One app ──────────────────────────────────────────────────────────────────
const TOOLS = { study: 'parallx-community.study', worksheets: 'parallx.worksheet', flashcards: 'parallx-community.flashcards', door: 'probe.door-probe' };
const TOOL_COMMAND = { study: 'study.open', worksheets: 'worksheet.dashboard', flashcards: 'flashcards.studyTag', door: 'doorprobe.registry' };
const pageErrors = [];
let shotN = 0;
async function launch(dir, workspace) {
  const appRoot = path.join(dir, 'app');
  await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: workspace }));
  // The app's extensions, and beside them the one that stands at the seam.
  const extDir = path.join(appRoot, 'ext');
  if (!existsSync(extDir)) {
    await fs.mkdir(extDir, { recursive: true });
    for (const d of await fs.readdir(path.join(REPO, 'ext'), { withFileTypes: true })) if (d.isDirectory()) await fs.symlink(path.join(REPO, 'ext', d.name), path.join(extDir, d.name), 'junction');
    await fs.mkdir(path.join(extDir, 'door-probe'));
    await fs.writeFile(path.join(extDir, 'door-probe', 'parallx-manifest.json'), JSON.stringify(DOOR_EXT.manifest));
    await fs.writeFile(path.join(extDir, 'door-probe', 'main.js'), DOOR_EXT.main);
  }
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE') env[k] = v;
  Object.assign(env, { PARALLX_TEST_MODE: '1', PARALLX_RENDERER_PORT: '0', PARALLX_APP_ROOT: appRoot, PARALLX_USER_DATA: path.join(appRoot, 'data', 'chromium-cache') });
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
  if (on !== true) throw new Error(`Study, Worksheets, Flashcards or the probe's extension could not be turned on: ${on}`);
  // Study has finished starting once its last registration (the chat tools) is in.
  await page.waitForFunction(() => { try { return !!window.__parallx_workbench__._services.get({ id: 'ILanguageModelToolsService' }).getTool('study_results'); } catch { return false; } }, null, { timeout: 60_000 });
  await page.waitForFunction((ids) => { try { const c = window.__parallx_workbench__._services.get({ id: 'ICommandService' }); return ids.every((id) => c.hasCommand(id)); } catch { return false; } }, Object.values(TOOL_COMMAND), { timeout: 60_000 });
  await page.waitForTimeout(600);
  await page.evaluate(installPageHelpers);
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
    bars: (scope = 'pane') => S.page.evaluate((scope) => window.__ap.bars(scope), scope),
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

// ── Steps a person takes (Study as the piece before left it) ────────────────
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
/** "N of M" beside a unit's name in the Subjects section. */
function unitCount(text, unit) {
  const m = new RegExp(`${esc(unit)}\\s*[:·,-]?\\s*(\\d+)\\s+of\\s+(\\d+)`, 'i').exec(String(text || ''));
  return m ? { n: Number(m[1]), m: Number(m[2]) } : null;
}
/** The sidebar lists every unit with a count: of its questions (as the piece before) or of all kinds. */
async function sidebarReady(S, units = Object.keys(Q)) {
  const t = await subjectsText(S);
  if (!t) return null;
  const got = Object.fromEntries(units.map((u) => [u, unitCount(t, u)]));
  const fits = (u) => got[u] && [nOfM(Q[u]), nOfM(allKinds(u))].some((w) => w.n === got[u].n && w.m === got[u].m);
  return units.every(fits) ? got : null;
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
  return !!(await until(() => S.page.evaluate((dbId) => !!window.__ap.tableState(dbId), dbId), 8000));
}
/** Type `text` into a cell's editor; false when the cell opens no editor. */
async function editCell(S, dbId, rowTitle, column, text) {
  const cell = must(await until(() => S.cell(dbId, rowTitle, column), 4000), `the cell ${column} of "${rowTitle.slice(0, 40)}" in the table`);
  await S.click(cell);
  const open = await until(() => S.page.evaluate(() => window.__ap.editorOpen()), 1500, 60);
  if (!open) return false;
  await S.page.keyboard.press('Control+A');
  await S.page.keyboard.type(String(text));
  await S.page.keyboard.press('Enter');
  await sleep(500);
  return true;
}
/** Choose `option` in a select cell: click the cell, then its pill, then the option in the list it opens. */
async function chooseCell(S, dbId, rowTitle, column, option) {
  const cell = must(await until(() => S.cell(dbId, rowTitle, column), 4000), `the cell ${column} of "${rowTitle.slice(0, 40)}" in the table`);
  await S.click(cell);
  const pill = await until(async () => (await S.find('body', /./, '.canvas-db-cell__editor.canvas-prop-select, .canvas-db-cell__editor .canvas-prop-select'))[0], 2000, 60);
  if (!pill) return false;
  await S.click(pill);
  const item = await until(async () => (await S.find('body', exact(option), '.canvas-prop-select-dropdown__item'))[0], 2000, 60);
  if (!item) { await S.page.keyboard.press('Escape'); return false; }
  await S.click(item);
  await sleep(400);
  await S.page.keyboard.press('Escape');
  await sleep(300);
  return true;
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

// A session's card.
const sheetOpen = (S) => S.has('root', '.st-sheet');
const pressStart = async (S) => (await S.press('root', /./, '[data-px-id="study.setup.start"]')) || (await S.press('root', /^(make questions and )?start\b/i, 'button'));
const answerable = (card) => !!card && !!card.stem && (card.options > 0 || !!card.field);
const waitCard = (S, ms = 15_000) => until(async () => { const c = await S.card(); return answerable(c) ? c : null; }, ms, 100);
/** After something that should start a session: the first card (through the usual setup sheet if it is offered). */
async function cardAfter(S, ms = 4000) {
  const seen = await until(async () => ((await sheetOpen(S)) ? 'sheet' : answerable(await S.card()) ? 'card' : null), ms, 100);
  if (seen === 'sheet') { await sleep(300); must(await pressStart(S), 'the Start button on the setup sheet'); }
  return seen ? waitCard(S, 15_000) : null;
}
async function studyUnit(S, subject, unit) {
  const pt = must(await subjectPoint(S, unit, { under: subject }), `the unit "${unit}" under "${subject}" in the sidebar`);
  // A unit pressed gave it a tab of its own; now it moves Study's one tab (which may be on Progress), and Ctrl+click
  // gives it a tab of its own (c3eebb8f): Ctrl+click, so the tab that was open stays open as before.
  await S.page.keyboard.down('Control');
  await S.click(pt);
  await S.page.keyboard.up('Control');
  let card = await cardAfter(S, 3000);
  // The unit is a place in Study's one tab now, and the keys land on the page's title, not on its Study… (c3eebb8f):
  // the page's Study… is pressed where Enter pressed it before.
  if (!card && (await S.press('root', /./, '[data-px-id="study.unit.study"]'))) card = await cardAfter(S, 2500);
  if (!card) { await S.page.keyboard.press('Enter'); card = await cardAfter(S, 2500); }
  if (!card) { await S.page.mouse.dblclick(pt.x, pt.y); card = await cardAfter(S, 3000); }
  return must(card, `a first question after activating the unit "${unit}"`);
}
async function waitVerdict(S, ms = 8000) {
  const seen = await until(async () => { const c = await S.card(); return c && c.verdict ? c : null; }, ms, 80);
  if (!seen) return null;
  await until(async () => (await S.find('root', /^Next\b/, 'button')).some((h) => !h.disabled), 3000, 80);
  await sleep(350);
  return (await S.card()) || seen;
}
async function answer(S, card, text) {
  await S.click(must(card.field, `an answer box on the card "${card.stem.slice(0, 50)}"`));
  await S.page.keyboard.type(text);
  await S.page.keyboard.press('Enter');
  let v = await waitVerdict(S, 3000);
  if (!v) { (await S.press('root', /^(check|submit|grade)\b/i, 'button')) || (await S.page.keyboard.press('Control+Enter')); v = await waitVerdict(S, 8000); }
  return must(v, 'a verdict after the typed answer');
}
/** Next: the following card, or 'end' when the session is over. */
async function pressNext(S, stem) {
  must(await until(() => S.press('root', /^(Next|See Results|Finish)\b/, 'button'), 4000), 'an enabled Next');
  return until(async () => { const c = await S.card(); if (answerable(c) && c.stem !== stem) return c; return (await S.page.evaluate(() => window.__ap.results())) || !c ? 'end' : null; }, 6000, 80);
}
/** Answer every card of the session that is starting, wrongly, and return the questions it asked. */
async function sessionStems(S, first, cap = 12) {
  const seen = [];
  let card = first;
  for (let i = 0; i < cap && card && card !== 'end'; i++) {
    seen.push(card.stem);
    await answer(S, card, WRONG);
    card = await pressNext(S, card.stem);
  }
  return { seen: seen.sort(), ended: card === 'end' };
}
async function closeStudyTabs(S) {
  for (let i = 0; i < 5; i++) {
    const t = (await S.tabs()).find((x) => /:study:/.test(x.id) && !/ Progress$/.test(x.label));
    if (!t) return;
    await S.page.evaluate((id) => { const tab = Array.from(document.querySelectorAll('.ui-tab')).find((x) => x.getAttribute('data-tab-id') === id); tab?.querySelector('.ui-tab-close')?.dispatchEvent(new MouseEvent('click', { bubbles: true })); }, t.id);
    await sleep(500);
    await S.press('body', /^(End Session|Leave|Close)\b/, '.parallx-modal-box button');
    await sleep(400);
  }
}

// ── Progress: opening it and reading it ──────────────────────────────────────
const progressTitle = (subject) => `${subject} Progress`;
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
/** study.openProgress, and the subject picked when it asks. Returns, with the tab "<Subject> Progress" in front, the moment the command (or the pick) was given. */
async function openProgress(S, subject = SUBJECT) {
  if (!(await S.hasCommand('study.openProgress'))) throw new Error('there is no command study.openProgress');
  let at = Date.now();
  S.run('study.openProgress');
  const title = progressTitle(subject);
  const pick = new RegExp(`^${esc(subject)}(?![A-Za-z0-9])`);
  const front = async () => (await tabTitled(S, title)).some((t) => t.active);
  const seen = await until(async () => ((await front()) ? 'tab' : (await S.find('body', pick, '.parallx-quickpick-row, [role="option"]')).length ? 'asked' : null), 6000, 50);
  if (seen === 'asked') { await S.press('body', pick, '.parallx-quickpick-row, [role="option"]'); at = Date.now(); }
  must(await until(front, 6000, 50), `a tab titled "${title}" in front after study.openProgress (tabs: ${(await S.tabs()).map((t) => t.label).join(' | ')})`);
  return at;
}
const barOf = (bars, owner, kind) => bars.find((b) => low(b.owner) === low(owner) && low(b.kind) === low(kind)) || null;
const isUnit = (owner, units = UNITS) => units.some((u) => low(u) === low(owner));
/** The units in the order their rows stand in the tab, top to bottom. */
const unitOrder = (bars, units = UNITS) => { const out = []; for (const b of [...bars].filter((b) => isUnit(b.owner, units)).sort((a, b2) => a.y - b2.y || a.x - b2.x)) { const u = units.find((x) => low(x) === low(b.owner)); if (!out.includes(u)) out.push(u); } return out; };
const brief = (bars) => bars.map((b) => `${b.name}${b.count ? ` [${b.count.n} of ${b.count.m}]` : ''}`);
/** Wait for the bars of the tab in front to satisfy `pred`; the bars as they are at the end either way. */
async function waitBars(S, pred, ms = 6000, scope = 'pane') {
  const hit = await until(async () => { const b = await S.bars(scope); return pred(b) ? b : null; }, ms, 60);
  return { ok: !!hit, bars: hit || (await S.bars(scope)) };
}
const hasCounts = (bars, owner, kind, counts) => { const b = barOf(bars, owner, kind); return !!b && same(b.counts, counts); };
/** The tab with every Questions bar as seeded: what the later checks start from. */
async function progressReady(S, ms = 8000) {
  const r = await waitBars(S, (bars) => Object.keys(Q).every((u) => hasCounts(bars, u, 'Questions', Q[u])), ms);
  if (!r.ok) throw new Error(`the Progress tab does not show the seeded Questions bars (it shows: ${brief(r.bars).join(' | ').slice(0, 220) || norm(await S.text('pane')).slice(0, 160) || 'nothing'})`);
  return r.bars;
}
/** A part of a bar, by its state. */
const partOf = (bar, state) => (bar ? bar.parts.find((p) => p.state === state && p.shown) || null : null);
async function pressPart(S, owner, kind, state) {
  const bar = must(barOf(await S.bars(), owner, kind), `the bar "${owner}, ${kind}"`);
  const part = must(partOf(bar, state), `the ${state} part (data-state="${state}") of the bar "${bar.name}"`);
  await S.click({ x: part.cx, y: part.cy });
  return part;
}
/** The sort control's two choices, as they are. */
async function sortChoices(S) {
  const a = (await S.find('pane', /^In Order$/))[0] || null; const b = (await S.find('pane', /^Weakest First$/))[0] || null;
  return { inOrder: a, weakest: b, chosen: a && a.pressed === 'true' ? 'In Order' : b && b.pressed === 'true' ? 'Weakest First' : null };
}
/** Lines of the tab that say which groups of a tool match no unit. */
async function unmatchedLine(S, kind) {
  const lines = (await S.text('pane')).split('\n').map(norm).filter(Boolean);
  return lines.find((l) => new RegExp(`^${esc(kind)} not matched to a unit\\b`, 'i').test(l)) || null;
}
/** Does the line name the group (by name or label) followed by its total? */
const lineHas = (line, names, total) => !!line && names.some((n) => new RegExp(`${esc(n)}\\D{0,3}(\\d+ of )?${total}\\b`, 'i').test(line.normalize('NFC')) || new RegExp(`${esc(plain(n))}\\D{0,3}(\\d+ of )?${total}\\b`, 'i').test(line.normalize('NFD').replace(/[̀-ͯ]/g, '')));

// Colours.
const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const ratio = (a, b) => { const A = lum(a), B = lum(b); return (Math.max(A, B) + 0.05) / (Math.min(A, B) + 0.05); };
function hueOf({ r, g, b }) {
  const R = r / 255, G = g / 255, B = b / 255; const max = Math.max(R, G, B), min = Math.min(R, G, B); const d = max - min;
  if (d < 0.08) return { hue: -1, sat: 0 };
  let h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  h = (h * 60 + 360) % 360;
  return { hue: Math.round(h), sat: d / (max || 1) };
}
const colourName = (c) => { if (!c) return 'none'; const { hue, sat } = hueOf(c); if (hue < 0 || sat < 0.2) return 'grey'; if (hue >= 335 || hue < 22) return 'red'; if (hue >= 22 && hue <= 72) return 'yellow'; if (hue > 72 && hue <= 175) return 'green'; return `hue ${hue}`; };
const WANT_COLOUR = { good: 'green', middling: 'yellow', poor: 'red' };
/** Statement 9's contrast rule over a bar: what fails, in words. */
function contrastFaults(bar) {
  const faults = [];
  const parts = bar.parts.filter((p) => p.shown && p.w > 0).sort((a, b) => a.x - b.x);
  const fenced = bar.edges.some((e) => ratio(e, bar.surface) >= 3);
  for (const p of parts) {
    if (!p.bg) { faults.push(`${p.state}: no background colour (${p.raw})`); continue; }
    const r = ratio(p.bg, bar.surface);
    if (r < 3 && !(p.state === 'rest' && (fenced || p.edges.some((e) => ratio(e, bar.surface) >= 3)))) faults.push(`${p.state} against the surface ${r.toFixed(2)}:1`);
  }
  for (let i = 1; i < parts.length; i++) {
    const a = parts[i - 1], b = parts[i];
    if (!a.bg || !b.bg) continue;
    const gap = b.x - (a.x + a.w);
    const r = ratio(a.bg, b.bg);
    if (r < 3 && gap < 1) faults.push(`${a.state} against ${b.state} ${r.toFixed(2)}:1 with no gap`);
  }
  return faults;
}

// ── The seam, through the probe's extension ──────────────────────────────────
/** The core command that hands out the progress providers, found by its words; null when there is none. */
async function seam(S) {
  const ids = (await S.commandIds()).filter((id) => /progress/i.test(id) && /regist|provider/i.test(id) && !/^study\./i.test(id) && !/^doorprobe\./.test(id));
  for (const id of ids) {
    const r = (await S.cmd('doorprobe.registry', id)).r;
    if (r && r.ok && r.keys.some((k) => /^(register|add)/i.test(k)) && r.keys.some((k) => /^(list|all|get|providers)/i.test(k))) return { id, ...r, candidates: ids };
  }
  return ids.length ? { id: null, candidates: ids } : null;
}
const mustSeam = async (S) => { const s = await seam(S); if (!s || !s.id) throw new Error(`no core command hands an extension the progress providers (commands with "progress" and "registry" or "providers" in the id: ${s ? s.candidates.join(', ') : 'none'})`); return s; };
const door = async (S, name, ...args) => (await S.cmd(`doorprobe.${name}`, ...args)).r || { ok: false, error: 'the command did not return' };
const stringsOf = (p) => Object.values(p.strings).concat(JSON.stringify(p.objects));
const providerOf = (list, re) => list.find((p) => re.test(stringsOf(p).join(' '))) || null;
const DRILL_WORDS = ['Crisp', 'Shaky', 'Blank', 'Untried'];
const DRILLS = [{ group: 'mack', label: 'Mack', total: 9, good: 4, middling: 2, poor: 1 }, { group: 'zeta', label: 'Zeta', total: 3, good: 0, middling: 0, poor: 3 }];
const DRILL_MACK = [4, 2, 1, 2];
const wordsFit = (words, want) => words.every((w, i) => low(w) === low(want[i]));

// ── Worksheets and Flashcards, as they are today ─────────────────────────────
/** Worksheets' own "Progress by paper", read off its dashboard: { label: { counts, rated, total } }. */
async function dashboardPapers(S) {
  await S.cmd('worksheet.dashboard');
  must(await until(() => S.has('body', '.ws-dash__paperrow'), 20_000), 'Worksheets\' dashboard with its Progress by paper');
  await sleep(400);
  const rows = await S.page.evaluate(() => Array.from(document.querySelectorAll('.ws-dash__paperrow')).filter(window.__ap.shown).map((r) => ({ label: (r.querySelector('.ws-dash__papername')?.textContent || '').trim(), aria: r.querySelector('.ws-dash__bar')?.getAttribute('aria-label') || '', beside: (r.querySelector('.ws-dash__barlabel')?.textContent || '').trim() })));
  const out = {};
  for (const r of rows) {
    const m = /: (\d+) easy, (\d+) medium, (\d+) hard, (\d+) not rated$/.exec(r.aria); const b = /^(\d+)\/(\d+)/.exec(r.beside);
    if (m && b) out[r.label] = { counts: m.slice(1, 5).map(Number), rated: Number(b[1]), total: Number(b[2]) };
  }
  await S.press('body', /./, '.ui-tab--active .ui-tab-close');
  await sleep(400);
  return out;
}
/** Rate one of a paper's unrated problems Easy, on the sheet, as a person does. Returns when the rating is in the file. */
async function rateAProblem(S, paper) {
  const before = coreAll(S.workspace, "SELECT COUNT(*) AS n FROM ws_attempts WHERE completed = 1 AND self_grade = 'easy'")[0].n;
  await S.cmd('worksheet.dashboard');
  must(await until(() => S.has('body', '.ws-dash__paperrow'), 20_000), 'Worksheets\' dashboard');
  must(await S.press('body', new RegExp(`^Quiz ${esc(P_LABEL[paper])} Not rated, \\d+ problems$`), '.ws-dash__bar [role="button"]'), `the Not rated part of ${P_LABEL[paper]} on Worksheets' dashboard`);
  const easy = must(await until(async () => (await S.find('body', /^Easy$/, '[role="radiogroup"][aria-label="Rate this problem"] [role="radio"]'))[0], 90_000, 200), 'the sheet\'s rating (Rate this problem: Easy)');
  await sleep(1500);
  await S.click((await S.find('body', /^Easy$/, '[role="radiogroup"][aria-label="Rate this problem"] [role="radio"]'))[0] || easy);
  const at = must(await until(() => (coreAll(S.workspace, "SELECT COUNT(*) AS n FROM ws_attempts WHERE completed = 1 AND self_grade = 'easy'")[0].n > before ? Date.now() : null), 10_000, 20), 'the Easy rating in the workspace file');
  return at;
}
/** Review one card of a tag and grade it Good, on Flashcards' own screen. Returns when the review is in the file. */
async function rateACard(S, tag) {
  const before = cardsAll(S.workspace, 'SELECT COUNT(*) AS n FROM fc_reviews')[0].n;
  await S.cmd('flashcards.studyTag', tag);
  must(await until(() => S.press('body', /^Show Answer$/), 30_000, 200), 'Show Answer on a card of the tag');
  must(await until(() => S.press('body', /^Good\b|Good/, '.fc-grade--good, button.fc-grade'), 8000, 100), 'the Good grade on the card');
  const at = must(await until(() => (cardsAll(S.workspace, 'SELECT COUNT(*) AS n FROM fc_reviews')[0].n > before ? Date.now() : null), 10_000, 20), 'the review in the workspace file');
  const last = cardsAll(S.workspace, 'SELECT r.rating, c.tags FROM fc_reviews r JOIN fc_cards c ON c.id = r.card_id ORDER BY r.id DESC LIMIT 1')[0];
  if (!last || last.rating !== 3 || !String(last.tags).includes(tag)) throw new Error(`the review written was not Good on a ${tag} card: ${JSON.stringify(last)}`);
  return at;
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

// ── Seeding ──────────────────────────────────────────────────────────────────
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
const bankColumns = (papers) => [
  { name: 'Model Answer', type: 'text' }, { name: 'Paper', type: 'select', options: papers },
  { name: 'Times Attempted', type: 'number' }, { name: 'Times Correct', type: 'number' },
  { name: 'Last Result', type: 'select', options: ['Right', 'Partly', 'Wrong'] },
];
const historyOf = (state) => (state === 'N' ? {} : { 'Times Attempted': state === 'R' ? 2 : 1, 'Times Correct': state === 'R' ? 2 : 0, 'Last Result': RESULT[state] });
/** Worksheets' bank and Flashcards' decks, written into the workspace file with the app closed. */
function seedTools(ws) {
  let d = new DatabaseSync(coreFile(ws));
  const DAY = 86400000; const NOW = Date.now();
  const sheet = (title) => JSON.stringify({ id: 'wb', sheetOrder: ['s1'], appVersion: '0.1', sheets: { s1: { id: 's1', name: 'Sheet1', rowCount: 40, columnCount: 12, cellData: { 0: { 0: { v: title } }, 2: { 1: { v: 'Given the following information:' } }, 4: { 1: { v: 'Accident Year' }, 2: { v: 'Reported' } }, 5: { 1: { v: 2021 }, 2: { v: 1200 } }, 7: { 1: { v: 'Question: estimate the ultimate loss.' } } } } } });
  try {
    d.exec('BEGIN');
    const insItem = d.prepare("INSERT INTO ws_items (title, question_md, created_at, sheet_json, paper, source, kind, quadrant, sheet_name, source_label) VALUES (?, '', ?, ?, ?, ?, ?, 1, ?, 'Probe workbook')");
    const insAttempt = d.prepare("INSERT INTO ws_attempts (item_id, started_at, updated_at, cells_json, self_grade, completed, seconds, session_id, imported, worked_at) VALUES (?, ?, ?, ?, ?, ?, 300, '', 0, ?)");
    const item = (paper, i, source = 'rf', kind = 'quant') => { const title = `RF ${P_LABEL[paper] || 'Loose'} - ${i}`; return Number(insItem.run(title, NOW - (40 + i) * DAY, sheet(title), paper, source, kind, title).lastInsertRowid); };
    const rate = (id, grade, ago) => insAttempt.run(id, NOW - ago * DAY - 600000, NOW - ago * DAY, '', grade, 1, NOW - ago * DAY);
    for (const [paper, [easy, medium, hard, rest]] of Object.entries(P)) {
      let i = 0;
      for (const [grade, n] of [['easy', easy], ['medium', medium], ['hard', hard], ['', rest]]) for (let k = 0; k < n; k++) {
        const id = item(paper, ++i);
        if (grade) rate(id, grade, 2 + (i % 5));
        // The last rating is the one that counts: an older Hard under an Easy.
        if (paper === 'clark' && grade === 'easy' && k === 0) rate(id, 'hard', 20);
        // Worked on and never rated is not rated.
        if (paper === 'clark' && !grade && k === 0) insAttempt.run(id, NOW - 3600000, NOW - 1800000, '{"x":1}', '', 0, NOW - 1800000);
      }
    }
    // What Worksheets' "Progress by paper" leaves out: essays, the custom bank, a problem with no paper.
    rate(item('clark', 91, 'rf', 'essay'), 'easy', 3); rate(item('clark', 92, 'rf', 'essay'), 'easy', 3);
    rate(item('clark', 93, 'custom', 'quant'), 'hard', 3);
    rate(item('', 94, 'rf', 'quant'), 'easy', 3);
    d.exec('COMMIT');
  } finally { d.close(); }
  d = new DatabaseSync(cardsFile(ws));
  try {
    d.exec('BEGIN');
    const insDeck = d.prepare("INSERT INTO fc_decks (name, description, created_at) VALUES (?, '', ?)");
    const insCard = d.prepare('INSERT INTO fc_cards (deck_id, front, back, tags, created_at) VALUES (?, ?, ?, ?, ?)');
    const insReview = d.prepare("INSERT INTO fc_reviews (card_id, reviewed_at, rating, interval_before, interval_after, ease_before, ease_after, state_before, state_after, ms_taken) VALUES (?, ?, ?, 0, ?, 2.5, 2.5, ?, ?, 4000)");
    const setCard = d.prepare('UPDATE fc_cards SET state = ?, reps = ?, lapses = ?, interval_days = ?, due_at = ?, last_reviewed_at = ? WHERE id = ?');
    const RATING = { A: 1, H: 2, G: 3, E: 4 };
    const cards = (deckId, tag, states, label) => [...states].forEach((s, i) => {
      const id = Number(insCard.run(deckId, `Card ${label} ${i + 1}: what holds?`, `Answer ${label} ${i + 1}.`, tag, NOW - 30 * DAY).lastInsertRowid);
      if (s === 'N') return;
      // The last review is the one that counts: an older Again under a Good.
      if (s === 'G' && i === 0) insReview.run(id, NOW - 9 * DAY, 1, 0, 'new', 'learning');
      insReview.run(id, NOW - 2 * DAY, RATING[s], s === 'A' ? 0 : 6, 'new', s === 'A' ? 'relearning' : 'review');
      setCard.run(s === 'A' ? 'relearning' : 'review', 1, s === 'A' ? 1 : 0, s === 'A' ? 0 : 6, NOW + 4 * DAY, NOW - 2 * DAY, id);
    });
    const main = Number(insDeck.run(DECK, NOW - 40 * DAY).lastInsertRowid);
    for (const [tag, states] of Object.entries(CARD_TAGS)) cards(main, tag, states, tag);
    for (const [name, states] of Object.entries(CARD_DECKS)) cards(Number(insDeck.run(name, NOW - 40 * DAY).lastInsertRowid), '', states, name);
    d.exec('COMMIT');
  } finally { d.close(); }
}
/**
 * 2,000 questions on 20 papers. The database, its columns and the first row of
 * each paper are made by the chat's tools; the other 1,980 rows are written
 * into the workspace file with the app closed, each a copy of a row the app
 * made, and the app is started again. Each paper: 100 questions, 10 right,
 * 1 partly, 14 wrong, 75 not answered.
 */
const BIG_PAPERS = Array.from({ length: 20 }, (_, i) => `Paper ${String(i + 1).padStart(2, '0')}`);
const BIG = [10, 1, 14, 75];
async function seedBigBank(S) {
  const ws = S.workspace;
  const stateOf = (i) => (i < 10 ? 'R' : i < 11 ? 'P' : i < 25 ? 'W' : 'N');
  const valuesOf = (p, i) => ({ 'Model Answer': `Reference statement number${p * 100 + i} explaining matters.`, Paper: BIG_PAPERS[p], ...historyOf(stateOf(i)) });
  const titleOf = (p, i) => `Question ${p + 1}-${i + 1}: what holds for item ${p * 100 + i}?`;
  const big = await seedDatabase(S, 'Big Bank', bankColumns(BIG_PAPERS), BIG_PAPERS.map((_, p) => ({ title: titleOf(p, 0), values: valuesOf(p, 0) })));
  const cols = columns(ws, big);
  await S.close();
  const d = new DatabaseSync(path.join(ws, '.parallx', 'data.db'));
  try {
    const template = d.prepare('SELECT * FROM pages WHERE parent_id = ? LIMIT 1').get(big);
    const names = Object.keys(template);
    const insPage = d.prepare(`INSERT INTO pages (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`);
    const insMember = d.prepare('INSERT INTO database_pages (database_id, page_id, sort_order) VALUES (?, ?, ?)');
    const insValue = d.prepare('INSERT INTO page_property_values (page_id, property_id, database_id, value) VALUES (?, ?, ?, ?)');
    let order = 20;
    d.exec('BEGIN');
    for (let p = 0; p < 20; p++) for (let i = 1; i < 100; i++) {
      const id = randomUUID(); order += 1;
      insPage.run(...names.map((n) => (n === 'id' ? id : n === 'title' ? titleOf(p, i) : n === 'sort_order' ? order : template[n])));
      insMember.run(big, id, order);
      for (const [name, value] of Object.entries(valuesOf(p, i))) insValue.run(id, col(cols, name).id, big, JSON.stringify(value));
    }
    d.exec('COMMIT');
  } finally { d.close(); }
  await S.open();
  must(rowsOf(ws, big).length === 2000, '2,000 seeded rows in the workspace file');
  return big;
}

// ── The phases ───────────────────────────────────────────────────────────────
const PHASES = [];
const phase = (n, title, base, checks, fn) => PHASES.push({ n, title, base, checks, fn });
/** One check that cannot stop the ones after it. `fn` returns [ok, what came back]. */
async function check(c, id, fn) {
  try { const [ok, got] = await fn(); c(id, ok, got); } catch (err) { c(id, false, `stopped: ${String((err && err.message) || err).split('\n')[0].slice(0, 300)}`); }
}

phase(0, 'The ground the checks stand on (the app as it is today; none of it is new)', 'subject', {
  '0.1': 'the workspace is as seeded: Worksheets\' dashboard shows the six papers with their counts, and leaves out the essays, the custom problem and the one with no paper',
  '0.2': 'the palette can be read (F1, then the words), and the subject\'s More Actions menu',
  '0.3': 'a unit studied from the sidebar asks that unit\'s questions and ends',
  '0.4': 'a Last Result is changed in the Questions table, and a row deleted there',
  '0.5': 'a problem is rated Easy on Worksheets\' sheet, and its dashboard follows',
  '0.6': 'a card is graded Good on Flashcards\' screen',
  '0.7': 'a tool is turned off and on without a restart',
  '0.8': 'Appearance switches to light and back to dark',
  '0.9': 'a database is put in the Trash by the canvas\'s own command',
}, async (S, c, A) => {
  const ws = S.workspace;
  await check(c, '0.1', async () => {
    const dash = await dashboardPapers(S);
    return [Object.keys(P).every((p) => dash[P_LABEL[p]] && same(dash[P_LABEL[p]].counts, P[p]) && dash[P_LABEL[p]].total === P[p].reduce((t, n) => t + n, 0)) && Object.keys(dash).length === 6, dash];
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
    return [rows.some((r) => /Study: New Subject/.test(r)) && !!items && items.some((i) => /^Open Units$/.test(i.name)), { paletteRows: rows, menu: items ? items.map((i) => i.name) : null }];
  });
  await check(c, '0.3', async () => {
    const first = await studyUnit(S, SUBJECT, 'Friedland');
    const r = await sessionStems(S, first);
    await closeStudyTabs(S);
    return [r.ended && same(r.seen, stemsOf('Friedland')), r];
  });
  await check(c, '0.4', async () => {
    must(await openDb(S, A.bank), 'the Questions database open in the app');
    const row = stemsOf('Mack', 'W')[0];
    const picked = await chooseCell(S, A.bank, row, 'Last Result', 'Right');
    const stored = await until(() => rowTitled(ws, A.bank, row)?.values['Last Result'] === 'Right', 3000, 20);
    const victim = stemsOf('Clark', 'N')[0];
    await deleteRow(S, A.bank, victim);
    const gone = await until(() => !rowTitled(ws, A.bank, victim), 4000, 20);
    return [picked && !!stored && !!gone, { pickedInTheCellsList: picked, stored: rowTitled(ws, A.bank, row)?.values['Last Result'] ?? null, rowDeleted: !!gone }];
  });
  await check(c, '0.5', async () => {
    await rateAProblem(S, 'clark');
    const dash = (await dashboardPapers(S)).Clark;
    return [!!dash && same(dash.counts, [P.clark[0] + 1, P.clark[1], P.clark[2], P.clark[3] - 1]), dash];
  });
  await check(c, '0.6', async () => { await rateACard(S, 'fried-land'); return [true, cardsAll(ws, 'SELECT r.rating, c.tags FROM fc_reviews r JOIN fc_cards c ON c.id = r.card_id ORDER BY r.id DESC LIMIT 1')[0]]; });
  await check(c, '0.7', async () => {
    await S.setTool('worksheets', false); const off = !(await S.hasCommand('worksheet.dashboard'));
    await S.setTool('worksheets', true); const dash = await dashboardPapers(S);
    return [off && Object.keys(dash).length === 6, { off, papersWhenOnAgain: Object.keys(dash).length }];
  });
  await check(c, '0.8', async () => {
    const ground = () => S.page.evaluate(() => { const m = /rgba?\(([^)]+)\)/.exec(getComputedStyle(document.body).backgroundColor); const p = m ? m[1].split(',').map(parseFloat) : [0, 0, 0]; return (p[0] + p[1] + p[2]) / 3; });
    await setMode(S, 'light'); const light = await ground();
    await setMode(S, 'dark'); const dark = await ground();
    return [light > 180 && dark < 80, { light, dark }];
  });
  await check(c, '0.9', async () => {
    await toTrash(S, A.bank);
    const trashed = await until(() => coreAll(ws, 'SELECT is_archived FROM pages WHERE id = ?', [A.bank])[0]?.is_archived === 1, 5000);
    return [!!trashed, { archived: coreAll(ws, 'SELECT is_archived FROM pages WHERE id = ?', [A.bank])[0] }];
  });
});

phase(1, 'Open Progress', 'subject', {
  '1.1': 'the command study.openProgress is there, and the command palette lists it as "Study: Open Progress…"',
  '1.2': 'with one subject the command asks nothing and opens a tab titled "Exam 7 Progress"',
  '1.3': '"Open Progress" is the first item of the subject\'s More Actions menu in Study\'s sidebar',
  '1.4': 'choosing it there brings the tab "Exam 7 Progress" to the front, with the subject\'s bars in it',
  '1.5': 'opened a second time it is the same one tab, not a second',
  '1.6': 'with two subjects the command asks which, and the one picked is the one opened',
}, async (S, c) => {
  await showStudySidebar(S);
  await check(c, '1.1', async () => {
    const has = await S.hasCommand('study.openProgress');
    await S.page.keyboard.press('F1');
    await sleep(500);
    await S.page.keyboard.type('Open Progress');
    await sleep(700);
    const rows = (await S.find('body', /Open Progress/i, '.parallx-quickpick-row, [role="option"]')).map((r) => r.name);
    await S.shot('01-palette');
    await S.page.keyboard.press('Escape');
    await sleep(300);
    return [has && rows.some((r) => /Study: Open Progress(…|\.\.\.)/.test(r)), { command: has, paletteRows: rows }];
  });
  await check(c, '1.2', async () => {
    await openProgress(S, SUBJECT);
    const asked = (await S.find('body', /./, '.parallx-quickpick-row')).length > 0;
    const bars = await progressReady(S);
    await S.shot('01-progress-tab');
    return [!asked && bars.length > 0, { tabs: (await S.tabs()).map((t) => t.label), asked, bars: bars.length }];
  });
  await closeTab(S, progressTitle(SUBJECT));
  let items = null;
  await check(c, '1.3', async () => {
    items = await subjectMenu(S, SUBJECT);
    await S.shot('01-more-actions');
    return [!!items && items.length > 1 && /^Open Progress$/.test(items[0].name), items ? items.map((i) => i.name) : 'no More Actions on the subject\'s row'];
  });
  await check(c, '1.4', async () => {
    const item = (items || []).find((i) => /^Open Progress$/.test(i.name));
    if (!item) { await S.page.keyboard.press('Escape'); return [false, 'no Open Progress in the menu']; }
    await S.click(item);
    const front = await until(async () => (await tabTitled(S, progressTitle(SUBJECT))).some((t) => t.active), 6000);
    const bars = front ? await progressReady(S) : [];
    return [!!front && bars.length > 0, { tabs: (await S.tabs()).map((t) => t.label), bars: brief(bars).slice(0, 4) }];
  });
  await check(c, '1.5', async () => {
    await openProgress(S, SUBJECT);
    await sleep(600);
    const n = (await tabTitled(S, progressTitle(SUBJECT))).length;
    return [n === 1, { tabsTitledSo: n }];
  });
  await check(c, '1.6', async () => {
    await newSubject(S, { name: 'GLMs' });
    must(await waitSubject(S, 'GLMs'), 'the second subject "GLMs"');
    await sleep(800);
    await closeTab(S, progressTitle(SUBJECT));
    must(await S.hasCommand('study.openProgress'), 'the command study.openProgress');
    S.run('study.openProgress');
    const offered = await until(async () => { const rows = (await S.find('body', /./, '.parallx-quickpick-row, [role="option"]')).map((r) => r.name); return rows.some((r) => /GLMs/.test(r)) && rows.some((r) => r.includes(SUBJECT)) ? rows : null; }, 5000);
    await S.shot('01-which-subject');
    if (!offered) return [false, { asked: false, tabs: (await S.tabs()).map((t) => t.label) }];
    await S.press('body', /^GLMs\b/, '.parallx-quickpick-row, [role="option"]');
    const front = await until(async () => (await tabTitled(S, progressTitle('GLMs'))).some((t) => t.active), 6000);
    return [!!front && (await tabTitled(S, progressTitle(SUBJECT))).length === 0, { offered, tabs: (await S.tabs()).map((t) => t.label) }];
  });
});

phase(2, 'A row per unit, a bar per kind', 'subject', {
  '2.1': 'one row for every unit of the subject, top to bottom in the Units order',
  '2.2': 'each unit with questions has a "Questions" bar whose counts are the Questions database\'s: right, partly, wrong, not yet',
  '2.3': 'beside each bar "N of M": N the green, yellow and red together, M all',
  '2.4': 'the parts are green for Right, yellow for Partly and red for Wrong, and each is as wide as its share of the bar',
  '2.5': 'above the rows, the subject\'s totals for Questions as the same bar with its "N of M"',
  '2.6': 'above the rows, totals for Problems and for Cards too, each with its "N of M"',
  '2.7': 'a legend in words: Right, Partly, Wrong, Not yet',
  '2.8': 'the Units order is the Units database\'s: a unit whose Order is changed there moves in the tab',
}, async (S, c, A) => {
  await openProgress(S);
  const bars = await progressReady(S);
  await S.shot('02-progress');
  console.log(`   bars: ${brief(bars).join(' | ')}`);
  await check(c, '2.1', async () => [same(unitOrder(bars), UNITS), { rows: unitOrder(bars), want: UNITS }]);
  await check(c, '2.2', async () => {
    const got = Object.fromEntries(Object.keys(Q).map((u) => [u, barOf(bars, u, 'Questions')?.name ?? null]));
    return [Object.keys(Q).every((u) => low(got[u]) === low(spoken(u, 'Questions', Q[u]))), got];
  });
  await check(c, '2.3', async () => {
    const got = Object.fromEntries(Object.keys(Q).map((u) => [u, barOf(bars, u, 'Questions')?.count ?? null]));
    return [Object.keys(Q).every((u) => same(got[u], nOfM(Q[u]))), got];
  });
  await check(c, '2.4', async () => {
    const bar = must(barOf(bars, 'Mack', 'Questions'), 'the bar "Mack, Questions"');
    const parts = STATES.map((s) => partOf(bar, s));
    const total = parts.reduce((t, p) => t + (p ? p.w : 0), 0);
    const got = parts.map((p, i) => (p ? { state: p.state, colour: colourName(p.bg), share: Number((p.w / (total || 1)).toFixed(2)), want: Number((Q.Mack[i] / 8).toFixed(2)) } : { state: STATES[i], missing: true }));
    const coloured = got.slice(0, 3).every((g) => g.colour === WANT_COLOUR[g.state]) && got[3] && !['green', 'yellow', 'red'].includes(got[3].colour);
    // A share may be a little off where a thin part is widened for the finger.
    const sized = got.every((g) => !g.missing && Math.abs(g.share - g.want) <= 0.08) && total > 60;
    return [coloured && sized, { parts: got, barWidth: Math.round(bar.w) }];
  });
  const firstRowY = Math.min(...bars.filter((b) => isUnit(b.owner)).map((b) => b.y));
  const totalsOf = (kind) => bars.filter((b) => !isUnit(b.owner) && low(b.kind) === low(kind) && b.y < firstRowY);
  await check(c, '2.5', async () => {
    const want = sum4(...Object.values(Q));
    const t = totalsOf('Questions');
    return [t.length === 1 && same(t[0].counts, want) && same(t[0].count, nOfM(want)) && wordsFit(t[0].words, Q_WORDS), { totals: brief(t), want: spoken('…', 'Questions', want) }];
  });
  await check(c, '2.6', async () => {
    const pWant = [sum4(P.clark, P.friedland, P.siewert), sum4(...Object.values(P))];
    const cWant = [sum4(...Object.values(C)), sum4(...Object.values(C), C_CHAIN)];
    const p = totalsOf('Problems'); const k = totalsOf('Cards');
    const fits = (t, wants) => t.length === 1 && wants.some((w) => same(t[0].counts, w) && same(t[0].count, nOfM(w)));
    return [fits(p, pWant) && fits(k, cWant), { problems: brief(p), cards: brief(k), wantProblems: pWant, wantCards: cWant }];
  });
  await check(c, '2.7', async () => {
    const text = await S.text('pane');
    const words = ['Right', 'Partly', 'Wrong', 'Not yet'];
    const got = Object.fromEntries(words.map((w) => [w, new RegExp(`(^|[^A-Za-z])${w}([^A-Za-z]|$)`).test(text)]));
    return [Object.values(got).every(Boolean), got];
  });
  await check(c, '2.8', async () => {
    must(await openDb(S, A.units), 'the Units database open in the app');
    must(await editCell(S, A.units, 'Venter', 'Order', '0'), 'an editor on Venter\'s Order');
    must(await until(() => num(rowTitled(S.workspace, A.units, 'Venter')?.values.Order) === 0 && rowTitled(S.workspace, A.units, 'Venter')?.values.Order !== undefined, 4000), 'Order 0 stored for Venter');
    const want = ['Venter', ...UNITS.filter((u) => u !== 'Venter')];
    must(await showTab(S, progressTitle(SUBJECT)), 'the Progress tab still open');
    let r = await waitBars(S, (b) => same(unitOrder(b), want), 5000);
    let how = 'in the open tab';
    if (!r.ok) { await closeTab(S, progressTitle(SUBJECT)); await openProgress(S); r = await waitBars(S, (b) => same(unitOrder(b), want), 5000); how = 'after Progress was opened again'; }
    console.log(`   Order edited in Units: the row moved ${r.ok ? how : 'never'}`);
    return [r.ok, { rows: unitOrder(r.bars), want, how }];
  });
});

phase(3, 'In Order and Weakest First', 'subject', {
  '3.1': 'a two-way control "In Order" / "Weakest First", with In Order chosen to begin with',
  '3.2': 'Weakest First puts the unit with the lowest share of green over all its items first (every kind counted), and a unit with nothing attempted last',
  '3.3': 'In Order puts the rows back in the Units order',
  '3.4': 'the choice is remembered when the tab is closed and opened again',
  '3.5': 'the choice is remembered when the app is closed and started again',
}, async (S, c) => {
  await openProgress(S);
  await progressReady(S);
  let s = await sortChoices(S);
  await check(c, '3.1', async () => [!!s.inOrder && !!s.weakest && s.chosen === 'In Order', { inOrder: s.inOrder ? s.inOrder.pressed : 'no such control', weakestFirst: s.weakest ? s.weakest.pressed : 'no such control' }]);
  await check(c, '3.2', async () => {
    await S.click(must(s.weakest, 'the choice "Weakest First"'));
    const r = await waitBars(S, (b) => same(unitOrder(b), WEAKEST), 4000);
    await S.shot('03-weakest-first');
    return [r.ok && (await sortChoices(S)).chosen === 'Weakest First', { rows: unitOrder(r.bars), want: WEAKEST, shares: Object.fromEntries(UNITS.map((u) => { const k = allKinds(u); return [u, `${k[0]} green of ${k[0] + k[1] + k[2] + k[3]}`]; })) }];
  });
  await check(c, '3.3', async () => {
    await S.click(must((await sortChoices(S)).inOrder, 'the choice "In Order"'));
    const r = await waitBars(S, (b) => same(unitOrder(b), UNITS), 4000);
    return [r.ok && (await sortChoices(S)).chosen === 'In Order', { rows: unitOrder(r.bars) }];
  });
  await check(c, '3.4', async () => {
    await S.click(must((await sortChoices(S)).weakest, 'the choice "Weakest First"'));
    must((await waitBars(S, (b) => same(unitOrder(b), WEAKEST), 4000)).ok, 'the rows weakest first before the tab is closed');
    await sleep(600);
    must(await closeTab(S, progressTitle(SUBJECT)), 'the Progress tab closed');
    await openProgress(S);
    const r = await waitBars(S, (b) => same(unitOrder(b), WEAKEST), 5000);
    s = await sortChoices(S);
    return [r.ok && s.chosen === 'Weakest First', { chosen: s.chosen, rows: unitOrder(r.bars) }];
  });
  await check(c, '3.5', async () => {
    await S.relaunch();
    await showStudySidebar(S);
    await closeTab(S, progressTitle(SUBJECT));
    await openProgress(S);
    const r = await waitBars(S, (b) => same(unitOrder(b), WEAKEST), 8000);
    s = await sortChoices(S);
    return [r.ok && s.chosen === 'Weakest First', { chosen: s.chosen, rows: unitOrder(r.bars) }];
  });
});

phase(4, 'Act from a bar', 'subject', {
  '4.1': 'each part of a Questions bar that has something in it is a button, and a part with nothing in it is not there',
  '4.2': 'the red part of Mack starts the unit\'s setup on Mack\'s questions whose last result is Wrong, and no other',
  '4.3': 'the yellow part of Clark: its questions whose last result is Partly',
  '4.4': 'the rest of Mack: its questions not answered yet',
  '4.5': 'the green part of Mack: its questions whose last result is Right',
  '4.6': 'the unit\'s name in the row opens the unit\'s setup, as in the sidebar: all of that unit\'s questions',
  '4.7': 'a tool the app has never heard of registers a provider and gets its bar in the unit\'s row, in its own words',
  '4.8': 'a part of that tool\'s bar is a button that opens the tool on that group and state, because the tool offers it',
  '4.9': 'the same tool without a way to open: its parts are plain, not buttons, and cannot take the focus',
}, async (S, c) => {
  await openProgress(S);
  const bars = await progressReady(S);
  await check(c, '4.1', async () => {
    const got = {};
    for (const u of Object.keys(Q)) { const bar = barOf(bars, u, 'Questions'); got[u] = STATES.map((s, i) => { const p = partOf(bar, s); return Q[u][i] > 0 ? (p ? (p.button && p.focusable && !p.disabled ? 'button' : 'plain') : 'missing') : (p ? 'there with nothing in it' : 'absent'); }); }
    const want = (u) => Q[u].map((n) => (n > 0 ? 'button' : 'absent'));
    return [Object.keys(Q).every((u) => same(got[u], want(u))), got];
  });
  /** Press a part, go through the setup, and return the questions the session asks. */
  const sessionFrom = async (unit, state) => {
    must(await showTab(S, progressTitle(SUBJECT)), 'the Progress tab');
    must((await waitBars(S, (b) => !!barOf(b, unit, 'Questions'), 5000)).ok, `the bar "${unit}, Questions"`);
    await pressPart(S, unit, 'Questions', state);
    const first = must(await cardAfter(S, 5000), `the unit's setup or a first question after the ${state} part of ${unit} was pressed`);
    const r = await sessionStems(S, first);
    await closeStudyTabs(S);
    return r;
  };
  for (const [id, unit, state] of [['4.2', 'Mack', 'poor'], ['4.3', 'Clark', 'middling'], ['4.4', 'Mack', 'rest'], ['4.5', 'Mack', 'good']]) {
    await check(c, id, async () => {
      const want = stemsOf(unit, BY_RESULT[state]);
      const r = await sessionFrom(unit, state);
      if (id === '4.2') await S.shot('04-after-red-part');
      return [r.ended && same(r.seen, want), { asked: r.seen, want, ended: r.ended }];
    });
  }
  await check(c, '4.6', async () => {
    must(await showTab(S, progressTitle(SUBJECT)), 'the Progress tab');
    const name = (await S.find('pane', /^Friedland$/, 'button, [role="button"], a[href]')).find((h) => !h.disabled);
    if (!name) return [false, 'the unit\'s name is not a control in its row'];
    await S.click(name);
    const sheet = await until(() => sheetOpen(S), 4000);
    const first = await cardAfter(S, 4000);
    const r = first ? await sessionStems(S, first) : { seen: [], ended: false };
    await closeStudyTabs(S);
    return [!!sheet && r.ended && same(r.seen, stemsOf('Friedland')), { setupSheet: !!sheet, asked: r.seen, want: stemsOf('Friedland') }];
  });
  let made = null;
  await check(c, '4.7', async () => {
    const s = await mustSeam(S);
    must(await showTab(S, progressTitle(SUBJECT)), 'the Progress tab');
    made = await door(S, 'mimic', s.id, { id: 'doorprobe.drills', kind: 'Drills', words: DRILL_WORDS, groups: DRILLS, withOpen: true });
    if (!made.ok) return [false, made];
    console.log(`   the probe's provider, shaped on ${made.shapedOn}: ${JSON.stringify(made.shape)}`);
    const t0 = Date.now();
    const r = await waitBars(S, (b) => hasCounts(b, 'Mack', 'Drills', DRILL_MACK), 5000);
    const bar = barOf(r.bars, 'Mack', 'Drills');
    console.log(`   a new provider's bar shown ${r.ok ? `${((Date.now() - t0) / 1000).toFixed(2)} s after it registered` : 'never'}`);
    await S.shot('04-a-third-tools-bar');
    return [r.ok && wordsFit(bar.words, DRILL_WORDS) && same(bar.count, nOfM(DRILL_MACK)) && !!(await unmatchedLine(S, 'Drills')), { bar: bar ? `${bar.name} [${JSON.stringify(bar.count)}]` : null, unmatched: await unmatchedLine(S, 'Drills') }];
  });
  await check(c, '4.8', async () => {
    if (!made || !made.ok) return [false, 'the probe\'s provider was not registered'];
    const bar = must(barOf(await S.bars(), 'Mack', 'Drills'), 'the bar "Mack, Drills"');
    const part = must(partOf(bar, 'poor'), 'the poor part of "Mack, Drills"');
    await S.click({ x: part.cx, y: part.cy });
    const st = await until(async () => { const x = await door(S, 'mimicState', 'doorprobe.drills'); return x.ok && x.openCalls.length ? x : null; }, 3000);
    const args = st ? JSON.stringify(st.openCalls[0]) : '';
    return [part.button && !!st && st.openCalls.length === 1 && /mack/i.test(args) && /poor|blank/i.test(args) && /Mack, Drills, blank: 1\b/i.test(part.name), { partIsButton: part.button, partName: part.name, openCalledWith: st ? st.openCalls : 'open was not called' }];
  });
  await check(c, '4.9', async () => {
    const s = await mustSeam(S);
    const reps = await door(S, 'mimic', s.id, { id: 'doorprobe.reps', kind: 'Reps', words: DRILL_WORDS, groups: [{ group: 'clark', label: 'Clark', total: 6, good: 1, middling: 2, poor: 3 }], withOpen: false });
    if (!reps.ok) return [false, reps];
    const r = await waitBars(S, (b) => hasCounts(b, 'Clark', 'Reps', [1, 2, 3, 0]), 5000);
    const bar = barOf(r.bars, 'Clark', 'Reps');
    const parts = bar ? bar.parts.filter((p) => p.shown).map((p) => ({ state: p.state, button: p.button, focusable: p.focusable })) : [];
    return [r.ok && parts.length === 3 && parts.every((p) => !p.button && !p.focusable), { bar: bar ? bar.name : null, parts }];
  });
});

phase(5, 'Watch it move', 'subject', {
  '5.1': 'an answer given in a Study session: the open Progress tab shows the unit\'s new counts within 2 s of the row being written',
  '5.2': 'a row\'s Last Result changed in the Questions database: the new counts within 2 s',
  '5.3': 'a row deleted in the Questions database: the unit has one question fewer within 2 s',
  '5.4': 'a problem rated Easy on Worksheets\' own sheet: the unit\'s Problems bar moves within 2 s, to what Worksheets\' dashboard then says',
  '5.5': 'a card graded Good on Flashcards\' own screen: the unit\'s Cards bar moves within 2 s',
  '5.6': 'a provider that says its counts changed: its bar follows within 2 s',
}, async (S, c, A) => {
  const ws = S.workspace;
  await openProgress(S);
  await progressReady(S);
  /** After something changed at `at`: bring the tab forward and time its bar. */
  const moved = async (what, at, owner, kind, counts) => {
    must(await showTab(S, progressTitle(SUBJECT)), 'the Progress tab, still open');
    const r = await waitBars(S, (b) => hasCounts(b, owner, kind, counts), 6000, 'pane');
    const took = (Date.now() - at) / 1000;
    console.log(`   ${what}: ${r.ok ? `shown ${took.toFixed(2)} s after it was written` : `not shown after ${took.toFixed(1)} s`}`);
    const bar = barOf(r.bars, owner, kind);
    return { ok: r.ok && took <= 2 && !!bar && same(bar.count, nOfM(counts)), got: { seconds: Number(took.toFixed(2)), bar: bar ? bar.name : null, beside: bar ? bar.count : null, want: counts } };
  };
  await check(c, '5.1', async () => {
    const card = await studyUnit(S, SUBJECT, 'Friedland');
    const q = must(seededQuestion(card.stem), 'the card\'s seeded question');
    await answer(S, card, q.answer);
    const at = must(await until(() => (rowTitled(ws, A.bank, q.question)?.values['Last Result'] === 'Right' ? Date.now() : null), 8000, 20), 'Last Result = Right written to the row');
    const r = await moved('an answer in a session', at, 'Friedland', 'Questions', [1, 0, 0, 3]);
    await S.shot('05-after-an-answer');
    await closeStudyTabs(S);
    return [r.ok, r.got];
  });
  const wrongRow = stemsOf('Mack', 'W')[0];
  await check(c, '5.2', async () => {
    must(await openDb(S, A.bank), 'the Questions database open in the app');
    must(await chooseCell(S, A.bank, wrongRow, 'Last Result', 'Right'), 'Right in the list of the Last Result cell');
    const at = must(await until(() => (rowTitled(ws, A.bank, wrongRow)?.values['Last Result'] === 'Right' ? Date.now() : null), 4000, 20), 'Last Result = Right stored for the row');
    const r = await moved('a Last Result changed in the table', at, 'Mack', 'Questions', [Q.Mack[0] + 1, Q.Mack[1], Q.Mack[2] - 1, Q.Mack[3]]);
    return [r.ok, r.got];
  });
  await check(c, '5.3', async () => {
    must(await openDb(S, A.bank), 'the Questions database open in the app');
    const victim = stemsOf('Clark', 'N')[0];
    await deleteRow(S, A.bank, victim);
    const at = must(await until(() => (!rowTitled(ws, A.bank, victim) ? Date.now() : null), 4000, 20), 'the row gone from the workspace file');
    const r = await moved('a row deleted', at, 'Clark', 'Questions', [Q.Clark[0], Q.Clark[1], Q.Clark[2], Q.Clark[3] - 1]);
    return [r.ok, r.got];
  });
  await check(c, '5.4', async () => {
    const at = await rateAProblem(S, 'clark');
    const want = [P.clark[0] + 1, P.clark[1], P.clark[2], P.clark[3] - 1];
    const r = await moved('a problem rated in Worksheets', at, 'Clark', 'Problems', want);
    await S.shot('05-after-a-rating');
    const dash = (await dashboardPapers(S)).Clark;
    return [r.ok && !!dash && same(dash.counts, want), { ...r.got, worksheetsDashboardSays: dash ? dash.counts : null }];
  });
  await check(c, '5.5', async () => {
    const at = await rateACard(S, 'fried-land');
    const r = await moved('a card graded in Flashcards', at, 'Friedland', 'Cards', [1, 0, 0, 2]);
    return [r.ok, r.got];
  });
  await check(c, '5.6', async () => {
    const s = await mustSeam(S);
    const made = await door(S, 'mimic', s.id, { id: 'doorprobe.drills', kind: 'Drills', words: DRILL_WORDS, groups: DRILLS, withOpen: false });
    if (!made.ok) return [false, made];
    must(await showTab(S, progressTitle(SUBJECT)), 'the Progress tab');
    must((await waitBars(S, (b) => hasCounts(b, 'Mack', 'Drills', DRILL_MACK), 5000)).ok, 'the bar "Mack, Drills" before its counts change');
    const fired = await door(S, 'mimicSet', 'doorprobe.drills', [{ group: 'mack', label: 'Mack', total: 9, good: 6, middling: 2, poor: 1 }]);
    const r = await moved('a provider\'s own change event', Date.now(), 'Mack', 'Drills', [6, 2, 1, 0]);
    return [r.ok && fired.listeners > 0, { ...r.got, listenersOnTheProvidersEvent: fired.listeners ?? 0 }];
  });
});

phase(6, 'Bars come and go with their tools', 'subject', {
  '6.1': 'with Worksheets on, each unit matched to a paper has a "Problems" bar: easy, medium, hard, not rated, with the counts Worksheets\' own "Progress by paper" shows for that paper',
  '6.2': 'beside each Problems bar, "N of M" is the dashboard\'s rated / total',
  '6.3': 'with Flashcards on, each unit matched to a card tag or a deck has a "Cards" bar: last rating Good or Easy green, Hard yellow, Again red, never reviewed the rest',
  '6.4': 'Worksheets turned off: its Problems bars, its totals and its unmatched line go within 2 s, with no restart, and the Questions and Cards bars stay as they were',
  '6.5': 'Worksheets turned on again: the Problems bars are back, in the same open tab',
  '6.6': 'Flashcards turned off: only the Cards bars go, within 2 s',
  '6.7': 'Study turned off: the Progress tab and its command are gone, and Study asks no provider for anything, even when a provider says its counts changed',
  '6.8': 'Study turned on again: Progress opens with the same bars',
}, async (S, c) => {
  const dash = await dashboardPapers(S);
  console.log(`   Worksheets' dashboard: ${Object.entries(dash).map(([k, v]) => `${k} ${v.counts.join('/')} (${v.rated}/${v.total})`).join(', ')}`);
  // The seed must be what the dashboard says, or the comparison below proves nothing.
  for (const [paper, counts] of Object.entries(P)) if (!dash[P_LABEL[paper]] || !same(dash[P_LABEL[paper]].counts, counts)) throw new Error(`Worksheets' dashboard does not show the seeded paper ${paper} as ${counts}: ${JSON.stringify(dash[P_LABEL[paper]] ?? null)}`);
  await openProgress(S);
  const bars = await progressReady(S);
  const kindBars = (list, kind) => list.filter((b) => low(b.kind) === low(kind));
  const snapshot = (list, kinds) => JSON.stringify(list.filter((b) => kinds.some((k) => low(b.kind) === low(k))).map((b) => [b.name, b.count]).sort());
  await check(c, '6.1', async () => {
    const r = await waitBars(S, (b) => Object.keys(P_UNIT).every((u) => hasCounts(b, u, 'Problems', dash[P_LABEL[P_UNIT[u]]].counts)), 5000);
    const got = Object.fromEntries(UNITS.map((u) => [u, barOf(r.bars, u, 'Problems')?.name ?? null]));
    const words = Object.keys(P_UNIT).every((u) => { const b = barOf(r.bars, u, 'Problems'); return b && wordsFit(b.words, ['easy', 'medium', 'hard', 'not rated']); });
    await S.shot('06-problems-and-cards');
    return [r.ok && words && got.Mack === null && got.Venter === null, { bars: got, worksheets: Object.fromEntries(Object.keys(P_UNIT).map((u) => [u, dash[P_LABEL[P_UNIT[u]]].counts])) }];
  });
  await check(c, '6.2', async () => {
    const now = await S.bars();
    const got = Object.fromEntries(Object.keys(P_UNIT).map((u) => [u, barOf(now, u, 'Problems')?.count ?? null]));
    return [Object.keys(P_UNIT).every((u) => { const d = dash[P_LABEL[P_UNIT[u]]]; return got[u] && got[u].n === d.rated && got[u].m === d.total; }), { beside: got, worksheets: Object.fromEntries(Object.keys(P_UNIT).map((u) => [u, `${dash[P_LABEL[P_UNIT[u]]].rated}/${dash[P_LABEL[P_UNIT[u]]].total}`])) }];
  });
  await check(c, '6.3', async () => {
    const r = await waitBars(S, (b) => Object.keys(C).every((u) => hasCounts(b, u, 'Cards', C[u])), 5000);
    const got = Object.fromEntries(UNITS.map((u) => { const b = barOf(r.bars, u, 'Cards'); return [u, b ? `${b.name} [${b.count ? `${b.count.n} of ${b.count.m}` : 'no count'}]` : null]; }));
    const words = Object.keys(C).every((u) => { const b = barOf(r.bars, u, 'Cards'); return b && /good|easy/i.test(b.words[0]) && /hard/i.test(b.words[1]) && /again/i.test(b.words[2]) && same(b.count, nOfM(C[u])); });
    return [r.ok && words && got.Siewert === null, { bars: got, want: C }];
  });
  const before = await S.bars();
  await check(c, '6.4', async () => {
    must(kindBars(before, 'Problems').length > 0, 'Problems bars before Worksheets is turned off');
    const at = await S.setTool('worksheets', false);
    const r = await waitBars(S, (b) => kindBars(b, 'Problems').length === 0, 6000);
    const took = (Date.now() - at) / 1000;
    console.log(`   Worksheets off: its bars gone ${r.ok ? `in ${took.toFixed(2)} s` : `not after ${took.toFixed(1)} s`}`);
    const line = await unmatchedLine(S, 'Problems');
    await S.shot('06-worksheets-off');
    return [r.ok && took <= 2 && !line && snapshot(r.bars, ['Questions', 'Cards']) === snapshot(before, ['Questions', 'Cards']) && (await tabTitled(S, progressTitle(SUBJECT))).length === 1, { seconds: Number(took.toFixed(2)), problemsBarsLeft: kindBars(r.bars, 'Problems').length, unmatchedLine: line, othersUnchanged: snapshot(r.bars, ['Questions', 'Cards']) === snapshot(before, ['Questions', 'Cards']) }];
  });
  await check(c, '6.5', async () => {
    await S.setTool('worksheets', true);
    const r = await waitBars(S, (b) => snapshot(b, ['Problems']) === snapshot(before, ['Problems']) && kindBars(b, 'Problems').length > 0, 15_000);
    return [r.ok, { problems: brief(kindBars(r.bars, 'Problems')) }];
  });
  await check(c, '6.6', async () => {
    const was = await S.bars();
    must(kindBars(was, 'Cards').length > 0, 'Cards bars before Flashcards is turned off');
    const at = await S.setTool('flashcards', false);
    const r = await waitBars(S, (b) => kindBars(b, 'Cards').length === 0, 6000);
    const took = (Date.now() - at) / 1000;
    console.log(`   Flashcards off: its bars gone ${r.ok ? `in ${took.toFixed(2)} s` : `not after ${took.toFixed(1)} s`}`);
    return [r.ok && took <= 2 && snapshot(r.bars, ['Questions', 'Problems']) === snapshot(was, ['Questions', 'Problems']) && kindBars(r.bars, 'Problems').length > 0, { seconds: Number(took.toFixed(2)), cardsBarsLeft: kindBars(r.bars, 'Cards').length, othersUnchanged: snapshot(r.bars, ['Questions', 'Problems']) === snapshot(was, ['Questions', 'Problems']) }];
  });
  await check(c, '6.7', async () => {
    const s = await mustSeam(S);
    const made = await door(S, 'mimic', s.id, { id: 'doorprobe.drills', kind: 'Drills', words: DRILL_WORDS, groups: DRILLS, withOpen: false });
    if (!made.ok) return [false, made];
    must((await waitBars(S, (b) => hasCounts(b, 'Mack', 'Drills', DRILL_MACK), 5000)).ok, 'the bar "Mack, Drills" while Study is on');
    const on = await door(S, 'mimicState', 'doorprobe.drills');
    await S.setTool('study', false);
    await sleep(1500);
    const mid = await door(S, 'mimicState', 'doorprobe.drills');
    await door(S, 'mimicSet', 'doorprobe.drills', [{ group: 'mack', label: 'Mack', total: 9, good: 9, middling: 0, poor: 0 }]);
    await sleep(2500);
    const off = await door(S, 'mimicState', 'doorprobe.drills');
    const tabs = (await S.tabs()).map((t) => t.label);
    const barsLeft = (await S.bars('body')).filter((b) => /Questions|Drills|Problems/i.test(b.kind)).length;
    await S.shot('06-study-off');
    return [on.listCalls > 0 && off.listCalls === mid.listCalls && off.listeners === 0 && !(await S.hasCommand('study.openProgress')) && barsLeft === 0, { listCallsWhileOn: on.listCalls, listCallsAfterOff: off.listCalls - mid.listCalls, listenersLeftOnTheProvider: off.listeners, commandLeft: await S.hasCommand('study.openProgress'), tabs, barsLeftOnScreen: barsLeft }];
  });
  await check(c, '6.8', async () => {
    await S.setTool('study', true);
    await S.setTool('flashcards', true);
    await door(S, 'mimicDispose', 'doorprobe.drills');
    await showStudySidebar(S);
    await closeTab(S, progressTitle(SUBJECT));
    await openProgress(S);
    const r = await waitBars(S, (b) => snapshot(b, ['Questions', 'Problems', 'Cards']) === snapshot(before, ['Questions', 'Problems', 'Cards']), 15_000);
    return [r.ok, { bars: brief(r.bars).length, sameAsBefore: r.ok }];
  });
});

phase(7, 'Matching by name, and Also Called', 'subject', {
  '7.1': 'a group belongs to the unit whose name it equals with case, spaces and punctuation aside: the card tag "fried-land" is Friedland\'s, the deck "VENTER" is Venter\'s',
  '7.2': 'Units has a text column "Also Called" that is his to edit: its cell opens an editor and does not say Study keeps it',
  '7.3': 'under the rows, one line for the problems that match no unit, each paper with its count: Brosius 6, Hürlimann 3, Mack (1994) 7, and none that is matched',
  '7.4': 'one line for the cards that match no unit, with the tag chain-ladder and its 2',
  '7.5': 'the lines say that Also Called in Units matches them',
  '7.6': 'names typed into Mack\'s Also Called, separated by a comma, match too: Mack gets a Problems bar with the counts of Worksheets\' "Mack (1994)" and its Cards bar takes in the tag chain-ladder',
  '7.7': 'what is matched that way is no longer listed as unmatched',
  '7.8': 'Also Called stays as he typed it: Study does not overwrite it, also after the app is started again',
}, async (S, c, A) => {
  const ws = S.workspace;
  await openProgress(S);
  const bars = await progressReady(S);
  await check(c, '7.1', async () => {
    const r = await waitBars(S, (b) => hasCounts(b, 'Friedland', 'Cards', C.Friedland) && hasCounts(b, 'Venter', 'Cards', C.Venter), 5000);
    return [r.ok, { friedland: barOf(r.bars, 'Friedland', 'Cards')?.name ?? null, venter: barOf(r.bars, 'Venter', 'Cards')?.name ?? null }];
  });
  const lines = { problems: null, cards: null };
  await check(c, '7.3', async () => {
    lines.problems = await until(() => unmatchedLine(S, 'Problems'), 3000);
    await S.shot('07-unmatched');
    const lastBarY = Math.max(...bars.map((b) => b.y));
    const at = lines.problems ? await S.page.evaluate((t) => { const s = window.__ap.scopeEl('pane'); const n = Array.from(s.querySelectorAll('*')).filter((e) => window.__ap.shown(e) && (e.innerText || '').replace(/\s+/g, ' ').trim().startsWith(t)).pop(); return n ? n.getBoundingClientRect().y : null; }, lines.problems.slice(0, 30)) : null;
    const has = { brosius: lineHas(lines.problems, ['brosius', 'Brosius'], 6), hurlimann: lineHas(lines.problems, ['hurlimann', 'Hürlimann'], 3), mack1994: lineHas(lines.problems, ['mack1994', 'Mack (1994)'], 7) };
    const matchedListed = ['Clark', 'Friedland', 'Siewert'].filter((n) => new RegExp(`\\b${n}\\b`, 'i').test(lines.problems || ''));
    return [Object.values(has).every(Boolean) && matchedListed.length === 0 && at !== null && at > lastBarY, { line: lines.problems, has, matchedListed, underTheRows: at !== null && at > lastBarY }];
  });
  await check(c, '7.4', async () => {
    lines.cards = await until(() => unmatchedLine(S, 'Cards'), 3000);
    return [lineHas(lines.cards, ['chain-ladder', 'chain ladder'], 2) && !/fried-land|\bVENTER\b|\bmack\b|\bclark\b/i.test(lines.cards || ''), { line: lines.cards }];
  });
  await check(c, '7.5', async () => {
    const text = await S.text('pane');
    const i = text.search(/not matched to a unit/i);
    return [i >= 0 && /Also Called/.test(text.slice(i)) && /Units/.test(text.slice(i)), i >= 0 ? norm(text.slice(i)).slice(0, 300) : 'no such line'];
  });
  must(await openDb(S, A.units), 'the Units database open in the app');
  let typed = false;
  await check(c, '7.2', async () => {
    const column = col(columns(ws, A.units), 'Also Called');
    const cell = column ? await until(() => S.cell(A.units, 'Mack', 'Also Called'), 3000) : null;
    typed = !!cell && (await editCell(S, A.units, 'Mack', 'Also Called', 'Mack 1994, Chain Ladder'));
    const stored = typed ? await until(() => rowTitled(ws, A.units, 'Mack')?.values['Also Called'] === 'Mack 1994, Chain Ladder', 4000) : false;
    await S.shot('07-also-called');
    return [!!column && column.type === 'text' && !!cell && cell.editable && !/kept by study/i.test(cell.says) && typed && !!stored, { column: column ? column.type : 'no column Also Called in Units', cellEditable: cell ? cell.editable : null, cellSays: cell ? cell.says : null, stored: rowTitled(ws, A.units, 'Mack')?.values['Also Called'] ?? null }];
  });
  const dash = await dashboardPapers(S);
  const mackCards = sum4(C.Mack, C_CHAIN);
  await check(c, '7.6', async () => {
    if (!typed) return [false, 'Also Called could not be typed into'];
    const want = must(dash['Mack (1994)'], 'the paper "Mack (1994)" on Worksheets\' dashboard').counts;
    must(await showTab(S, progressTitle(SUBJECT)), 'the Progress tab');
    const pred = (b) => hasCounts(b, 'Mack', 'Problems', want) && hasCounts(b, 'Mack', 'Cards', mackCards);
    let r = await waitBars(S, pred, 5000); let how = 'in the open tab';
    if (!r.ok) { await closeTab(S, progressTitle(SUBJECT)); await openProgress(S); r = await waitBars(S, pred, 6000); how = 'after Progress was opened again'; }
    console.log(`   Also Called typed in Units: matched ${r.ok ? how : 'never'}`);
    await S.shot('07-matched-by-also-called');
    return [r.ok, { problems: barOf(r.bars, 'Mack', 'Problems')?.name ?? null, cards: barOf(r.bars, 'Mack', 'Cards')?.name ?? null, wantProblems: want, wantCards: mackCards, how }];
  });
  await check(c, '7.7', async () => {
    const p = await unmatchedLine(S, 'Problems'); const k = await unmatchedLine(S, 'Cards');
    return [!!lines.problems && !!p && lineHas(p, ['brosius', 'Brosius'], 6) && !lineHas(p, ['mack1994', 'Mack (1994)'], 7) && !/chain.?ladder/i.test(k || ''), { problems: p, cards: k }];
  });
  await check(c, '7.8', async () => {
    if (!typed) return [false, 'Also Called could not be typed into'];
    await S.relaunch();
    await showStudySidebar(S);
    await sleep(2500);
    const stored = rowTitled(ws, A.units, 'Mack')?.values['Also Called'] ?? null;
    await closeTab(S, progressTitle(SUBJECT));
    await openProgress(S);
    const r = await waitBars(S, (b) => hasCounts(b, 'Mack', 'Cards', mackCards), 8000);
    return [stored === 'Mack 1994, Chain Ladder' && r.ok, { stored, mackCards: barOf(r.bars, 'Mack', 'Cards')?.name ?? null }];
  });
});

phase(8, 'The sidebar shows it small', 'subject', {
  '8.1': 'each unit\'s row under Subjects carries a bar next to its "N of M"',
  '8.2': 'the bar is over all kinds together: Mack\'s counts are its questions and its cards, Clark\'s its questions, problems and cards',
  '8.3': 'it is the same four parts in the same order, with the same colours, and it is thin',
  '8.4': 'it follows a change without a reload: a Last Result changed in the database moves Mack\'s bar',
  '8.5': 'with Worksheets off the bar of Clark loses its problems and keeps the rest',
}, async (S, c, A) => {
  const ws = S.workspace;
  await showStudySidebar(S);
  must(await until(() => sidebarReady(S), 10_000), `the subject's units in the sidebar (${(await subjectsText(S)) ?? 'no Subjects section'})`);
  const unitBars = async () => {
    const all = await S.bars('sidebar'); const out = {};
    for (const u of UNITS) { const pt = await subjectPoint(S, u, { under: SUBJECT }); out[u] = pt ? all.find((b) => low(b.owner) === low(u) && Math.abs(b.y + b.h / 2 - pt.y) < 22) || null : null; }
    return out;
  };
  let got = await unitBars();
  await S.shot('08-sidebar');
  await check(c, '8.1', async () => {
    const text = await subjectsText(S);
    const beside = Object.fromEntries(UNITS.map((u) => [u, unitCount(text, u)]));
    return [UNITS.every((u) => got[u] && beside[u]), { bars: Object.fromEntries(UNITS.map((u) => [u, got[u] ? got[u].name : null])), beside }];
  });
  await check(c, '8.2', async () => [UNITS.every((u) => got[u] && same(got[u].counts, allKinds(u))), { counts: Object.fromEntries(UNITS.map((u) => [u, got[u] ? got[u].counts : null])), want: Object.fromEntries(UNITS.map((u) => [u, allKinds(u)])) }]);
  await check(c, '8.3', async () => {
    const bar = must(got.Mack, 'Mack\'s bar in the sidebar');
    const parts = bar.parts.filter((p) => p.shown).sort((a, b) => a.x - b.x);
    const colours = parts.map((p) => `${p.state}:${colourName(p.bg)}`);
    const ok = same(parts.map((p) => p.state), STATES) && parts.slice(0, 3).every((p) => colourName(p.bg) === WANT_COLOUR[p.state]) && bar.h > 0 && bar.h <= 10 && parts.every((p) => p.h <= 10);
    return [ok, { parts: colours, height: bar.h }];
  });
  await check(c, '8.4', async () => {
    const row = stemsOf('Mack', 'W')[0];
    must(await openDb(S, A.bank), 'the Questions database open in the app');
    must(await chooseCell(S, A.bank, row, 'Last Result', 'Right'), 'Right in the list of the Last Result cell');
    must(await until(() => rowTitled(ws, A.bank, row)?.values['Last Result'] === 'Right', 4000, 20), 'Last Result = Right stored');
    const at = Date.now();
    const base = allKinds('Mack'); const want = [base[0] + 1, base[1], base[2] - 1, base[3]];
    const ok = await until(async () => { got = await unitBars(); return got.Mack && same(got.Mack.counts, want); }, 5000, 100);
    console.log(`   the sidebar's bar after a change in the database: ${ok ? `${((Date.now() - at) / 1000).toFixed(2)} s` : 'not moved in 5 s'}`);
    return [!!ok, { counts: got.Mack ? got.Mack.counts : null, want }];
  });
  await check(c, '8.5', async () => {
    await S.setTool('worksheets', false);
    const want = sum4(Q.Clark, C.Clark);
    const ok = await until(async () => { got = await unitBars(); return got.Clark && same(got.Clark.counts, want); }, 5000, 100);
    await S.shot('08-sidebar-worksheets-off');
    return [!!ok, { counts: got.Clark ? got.Clark.counts : null, want }];
  });
});

phase(9, 'Everyone can read it', 'subject', {
  '9.1': 'each bar has a role and a name a screen reader speaks in full: "Mack, Questions: 3 right, 1 partly, 2 wrong, 2 not yet"',
  '9.2': 'each button part has its own name and count: "Mack, Questions, wrong: 2. Study these"',
  '9.3': 'the parts keep one order in every bar of the tab and the sidebar: green, yellow, red, the rest',
  '9.4': 'dark: every part has 3 to 1 against the surface and against its neighbour (or a gap between them)',
  '9.5': 'light: the same, and the colours are still green, yellow and red',
  '9.6': 'every button part is reached with Tab, in the order of the rows and the parts',
  '9.7': 'a part focused by the keyboard shows it: an outline or a shadow it does not have unfocused',
  '9.8': 'Enter on a focused part does what a click does: the unit\'s setup on those questions',
}, async (S, c) => {
  await openProgress(S);
  const bars = await progressReady(S);
  await check(c, '9.1', async () => {
    const mack = barOf(bars, 'Mack', 'Questions');
    const roles = [...new Set(bars.map((b) => b.role || 'none'))];
    return [!!mack && mack.name === spoken('Mack', 'Questions', Q.Mack) && bars.every((b) => /^(group|img)$/.test(b.role)), { name: mack ? mack.name : null, want: spoken('Mack', 'Questions', Q.Mack), roles }];
  });
  const partNames = (u) => STATES.map((s, i) => (Q[u][i] > 0 ? `${u}, Questions, ${Q_WORDS[i]}: ${Q[u][i]}. Study these` : null)).filter(Boolean);
  await check(c, '9.2', async () => {
    const got = Object.fromEntries(Object.keys(Q).map((u) => [u, (barOf(bars, u, 'Questions')?.parts || []).filter((p) => p.shown && p.button).map((p) => p.name)]));
    return [Object.keys(Q).every((u) => same(got[u], partNames(u))), { got: got.Mack, want: partNames('Mack') }];
  });
  await check(c, '9.3', async () => {
    await showStudySidebar(S);
    const all = [...bars, ...(await S.bars('sidebar'))];
    const out = all.filter((b) => { const parts = b.parts.filter((p) => p.shown).sort((a, b2) => a.x - b2.x).map((p) => STATES.indexOf(p.state)); return !parts.length || parts.some((v, i) => i > 0 && v <= parts[i - 1]) || parts.length !== b.counts.filter((n) => n > 0).length; });
    return [all.length >= 12 && (await S.bars('sidebar')).length >= UNITS.length && out.length === 0, { bars: all.length, inTheSidebar: (await S.bars('sidebar')).length, outOfOrderOrWithoutParts: out.map((b) => `${b.name}: ${b.parts.filter((p) => p.shown).map((p) => p.state).join(',') || 'no parts'}`).slice(0, 4) }];
  });
  const contrast = async (mode) => {
    await setMode(S, mode);
    must(await showTab(S, progressTitle(SUBJECT)), 'the Progress tab');
    const now = await progressReady(S);
    await S.shot(`09-${mode}`);
    const faults = now.flatMap((b) => contrastFaults(b).map((f) => `${b.name.split(':')[0]}: ${f}`));
    const mack = barOf(now, 'Mack', 'Questions');
    const colours = mack.parts.filter((p) => p.shown).map((p) => `${p.state}:${colourName(p.bg)}`);
    const surface = `rgb(${[mack.surface.r, mack.surface.g, mack.surface.b].map(Math.round).join(',')})`;
    const coloured = mack.parts.filter((p) => p.shown && p.state !== 'rest').every((p) => colourName(p.bg) === WANT_COLOUR[p.state]);
    const right = mode === 'light' ? lum(mack.surface) > 0.5 : lum(mack.surface) < 0.2;
    return [now.length > 0 && now.every((b) => b.parts.some((p) => p.shown)) && faults.length === 0 && coloured && right, { surface, colours, faults: faults.slice(0, 6), bars: now.length }];
  };
  await check(c, '9.4', () => contrast('dark'));
  await check(c, '9.5', () => contrast('light'));
  await setMode(S, 'dark').catch(() => {});
  let reached = [];
  await check(c, '9.6', async () => {
    must(await showTab(S, progressTitle(SUBJECT)), 'the Progress tab');
    const s = await sortChoices(S);
    await S.click(must(s.inOrder, 'the choice "In Order" to start the Tab walk from'));
    await sleep(300);
    for (let i = 0; i < 90; i++) {
      await S.page.keyboard.press('Tab');
      const f = await S.focused();
      if (!f || !f.inPane) { if (reached.length) break; continue; }
      if (f.state) reached.push(f);
    }
    const names = reached.map((f) => f.name).filter((n) => Object.keys(Q).some((u) => n.startsWith(`${u}, Questions, `)));
    const want = Object.keys(Q).flatMap((u) => partNames(u));
    return [same(names, want), { reached: names.length, want: want.length, first: names.slice(0, 3), missing: want.filter((w) => !names.includes(w)).slice(0, 4) }];
  });
  await check(c, '9.7', async () => {
    const f = reached.find((x) => x.name === `Mack, Questions, wrong: ${Q.Mack[2]}. Study these`);
    if (!f) return [false, 'the wrong part of Mack was not reached with Tab'];
    // The same part, on screen, without the focus. (A click at the window's corner took the focus away
    // before: that corner is the title bar's Home button, it opened the Home tab over Progress, the part
    // was no longer on screen, and "unfocused" came back null, which differs from any ring.) The focus is
    // moved on with the keyboard instead, and the unfocused look has to be read, not missing.
    must(await showTab(S, progressTitle(SUBJECT)), 'the Progress tab');
    for (let i = 0; i < 3 && (await S.focused())?.name === f.name; i++) await S.page.keyboard.press('Tab');
    const now = await S.focused();
    if (now && now.name === f.name) return [false, 'the focus could not be moved off the part with Tab'];
    const plainLook = await S.page.evaluate((name) => window.__ap.ringOf(name), f.name);
    if (typeof plainLook !== 'string') return [false, { focused: f.ring, unfocused: plainLook, why: 'the part was not on screen to be read without the focus' }];
    return [f.keyboard && f.hasRing && f.ring !== plainLook, { focused: f.ring, unfocused: plainLook, focusVisible: f.keyboard, focusNowOn: now ? now.name : null }];
  });
  await check(c, '9.8', async () => {
    const target = `Mack, Questions, wrong: ${Q.Mack[2]}. Study these`;
    must(await showTab(S, progressTitle(SUBJECT)), 'the Progress tab');
    const s = await sortChoices(S);
    await S.click(must(s.inOrder, 'the choice "In Order"'));
    let on = null;
    for (let i = 0; i < 90 && !on; i++) { await S.page.keyboard.press('Tab'); const f = await S.focused(); if (f && f.name === target) on = f; }
    if (!on) return [false, 'the wrong part of Mack could not be focused with Tab'];
    await S.page.keyboard.press('Enter');
    const first = await cardAfter(S, 5000);
    const ok = !!first && stemsOf('Mack', 'W').includes(first.stem);
    await closeStudyTabs(S);
    return [ok, { firstQuestion: first ? first.stem : 'no setup and no question after Enter' }];
  });
});

phase(10, 'Empty and odd cases', 'plain', {
  '10.1': 'a subject with no questions: its Progress tab says "No questions yet." with the way to add them, and shows no bar',
  '10.2': '2,000 questions in 20 units: from the command to all 20 bars with their counts in under 2 s (the time is printed)',
  '10.3': 'a part too thin to press by finger (1 question in 100) is still reachable: at least 24 px wide, or its action is in a menu on the row',
  '10.4': 'a unit with nothing in a kind shows no bar for that kind, not an empty one: no Problems or Cards bar on any of the 20, and no totals for them',
  '10.5': 'a subject whose Questions database is in the Trash says so in place of bars',
}, async (S, c) => {
  const ws = S.workspace;
  await showStudySidebar(S);
  await check(c, '10.1', async () => {
    await newSubject(S, { name: 'Bare Subject' });
    must(await waitSubject(S, 'Bare Subject'), 'the subject "Bare Subject"');
    await sleep(800);
    await openProgress(S, 'Bare Subject');
    const text = await until(async () => { const t = await S.text('pane'); return /No questions yet\./.test(t) ? t : null; }, 5000);
    const way = (await S.find('pane', /question|add|new/i)).map((h) => h.name);
    await S.shot('10-no-questions');
    return [!!text && (way.length > 0 || /Open Questions|Questions database/i.test(text)) && (await S.bars()).length === 0, { says: norm(text || (await S.text('pane'))).slice(0, 200), controls: way, bars: (await S.bars()).length }];
  });
  await closeTab(S, progressTitle('Bare Subject'));
  const tSeed = Date.now();
  const big = await seedBigBank(S);
  console.log(`   seeded 2,000 rows (20 by the chat's tool, 1,980 into the workspace file with the app closed) in ${((Date.now() - tSeed) / 1000).toFixed(1)} s`);
  await newSubject(S, { name: 'Big Subject', questions: 'Big Bank' });
  await showStudySidebar(S);
  must(await until(async () => { const t = await subjectsText(S); return BIG_PAPERS.every((p) => { const k = unitCount(t, p); return k && k.n === 25 && k.m === 100; }); }, 90_000, 250), 'the 20 units of the 2,000 questions with their counts in the sidebar');
  await check(c, '10.2', async () => {
    const at = await openProgress(S, 'Big Subject');
    const r = await waitBars(S, (b) => BIG_PAPERS.every((p) => hasCounts(b, p, 'Questions', BIG)), 20_000);
    const took = (Date.now() - at) / 1000;
    console.log(`   2,000 questions in 20 units: study.openProgress to every bar shown: ${r.ok ? `${took.toFixed(2)} s` : `not shown after ${took.toFixed(0)} s`}`);
    await S.shot('10-two-thousand');
    return [r.ok && took < 2 && same(unitOrder(r.bars, BIG_PAPERS), BIG_PAPERS), { seconds: Number(took.toFixed(2)), bars: r.bars.length, first: r.bars[0] ? r.bars[0].name : null }];
  });
  await check(c, '10.3', async () => {
    const bar = must(barOf(await S.bars(), 'Paper 07', 'Questions'), 'the bar "Paper 07, Questions"');
    const part = must(partOf(bar, 'middling'), 'the partly part of "Paper 07, Questions"');
    if (part.w >= 24 && part.button) return [true, { width: Number(part.w.toFixed(1)), barWidth: Math.round(bar.w) }];
    const menus = (await S.find('pane', /more actions|actions|menu/i, 'button, [role="button"]')).filter((h) => Math.abs(h.y - part.cy) < 26);
    let item = null;
    for (const m of menus) { await S.click(m); await sleep(400); item = (await S.find('body', /partly/i, '[role="menuitem"], [role="menuitemradio"]'))[0] || null; await S.page.keyboard.press('Escape'); await sleep(200); if (item) break; }
    return [!!item, { width: Number(part.w.toFixed(1)), menuButtonsOnTheRow: menus.map((m) => m.name), menuItem: item ? item.name : null }];
  });
  await check(c, '10.4', async () => {
    const bars = await S.bars();
    const others = bars.filter((b) => !/^questions$/i.test(b.kind));
    const empty = bars.filter((b) => b.counts.reduce((t, n) => t + n, 0) === 0);
    return [bars.length >= 20 && others.length === 0 && empty.length === 0, { bars: bars.length, otherKinds: brief(others).slice(0, 4), emptyBars: brief(empty).slice(0, 4) }];
  });
  await check(c, '10.5', async () => {
    must((await S.bars()).length > 0, 'bars before the database goes to the Trash');
    await toTrash(S, big);
    must(await until(() => coreAll(ws, 'SELECT is_archived FROM pages WHERE id = ?', [big])[0]?.is_archived === 1, 5000), 'the Questions database in the Trash');
    must(await showTab(S, progressTitle('Big Subject')) || (await openProgress(S, 'Big Subject')), 'the Progress tab');
    let r = await until(async () => { const t = await S.text('pane'); return /trash/i.test(t) && (await S.bars()).length === 0 ? t : null; }, 5000);
    if (!r) { await closeTab(S, progressTitle('Big Subject')); await openProgress(S, 'Big Subject'); r = await until(async () => { const t = await S.text('pane'); return /trash/i.test(t) && (await S.bars()).length === 0 ? t : null; }, 5000); }
    await S.shot('10-in-the-trash');
    return [!!r, { says: norm(r || (await S.text('pane'))).slice(0, 200), bars: (await S.bars()).length }];
  });
});

phase(11, 'For tool authors: the progress providers and the kit\'s bar', 'subject', {
  '11.1': 'one core command, not Study\'s, hands an extension the registry of progress providers (register, list, an event), with Study turned off',
  '11.2': 'it lists a provider of Worksheets and one of Flashcards: an id "<tool>.<store>", the kind "Problems" / "Cards", the tool\'s id',
  '11.3': 'Worksheets\' provider lists its groups as { group, label, total, good, middling, poor } with the counts of its own "Progress by paper", and no other problems',
  '11.4': 'Flashcards\' provider lists a group for a tag and for a deck, by the last rating: mack 5 with 2, 1, 1; VENTER 4 with 0, 1, 2',
  '11.5': 'each gives its own words for the four states: Easy, Medium, Hard; Good or Easy, Hard, Again',
  '11.6': 'any extension can register a provider of its own and take it away again, and the registry\'s event says so',
  '11.7': 'Worksheets turned off: its provider is gone from the registry, Flashcards\' is still there, and the event fired; on again, it is back',
  '11.8': 'Flashcards turned off: its provider is gone from the registry',
  '11.9': 'docs/PARALLX_EXTENSION_AUTHORING_FOR_AI.md documents progress providers and the command that reaches them',
  '11.10': 'the stacked bar is in the kit: api.ui has a function for it, and the bars in Progress and in the sidebar are that one component, not a class of Study\'s own',
}, async (S, c) => {
  const dash = await dashboardPapers(S);
  let uiClasses = null;
  // Read while Study is on: the classes of a bar in the tab and of a bar in the sidebar.
  try {
    await showStudySidebar(S);
    await openProgress(S);
    const inTab = await progressReady(S); const inSide = await S.bars('sidebar');
    uiClasses = { tab: barOf(inTab, 'Mack', 'Questions')?.classes ?? [], sidebar: inSide.find((b) => low(b.owner) === 'mack')?.classes ?? [] };
  } catch (err) { uiClasses = { error: String((err && err.message) || err).slice(0, 160) }; }
  await S.setTool('study', false);
  await sleep(800);
  let s = null; let ws = null; let fc = null;
  await check(c, '11.1', async () => {
    s = await seam(S);
    return [!!s && !!s.id && s.keys.some((k) => /^on[A-Z_]/.test(k)), s ? { command: s.id, registry: s.keys, candidates: s.candidates } : 'no command with "progress" and "registry" or "providers" in its id'];
  });
  await check(c, '11.2', async () => {
    s = await mustSeam(S);
    ws = providerOf(s.providers, /parallx\.worksheet/); fc = providerOf(s.providers, /parallx-community\.flashcards/);
    const fits = (p, kind) => !!p && /^[a-z0-9-]+\.[A-Za-z0-9._-]+$/.test(p.id) && Object.values(p.strings).includes(kind);
    return [fits(ws, 'Problems') && fits(fc, 'Cards') && ws.id !== fc.id, { worksheets: ws ? ws.strings : null, flashcards: fc ? fc.strings : null, all: s.providers.map((p) => p.id) }];
  });
  const groupOf = (groups, name) => (Array.isArray(groups) ? groups.find((g) => plain(g.group) === plain(name) || plain(g.label) === plain(name)) : null) || null;
  const countsOf = (g) => (g ? [g.good, g.middling, g.poor, g.total - g.good - g.middling - g.poor] : null);
  await check(c, '11.3', async () => {
    s = await mustSeam(S);
    const r = await door(S, 'groups', s.id, must(ws, 'Worksheets\' provider').id);
    if (!r.ok) return [false, r];
    const got = Object.fromEntries(Object.keys(P).map((p) => [p, countsOf(groupOf(r.groups, p) || groupOf(r.groups, P_LABEL[p]))]));
    const shaped = r.groups.every((g) => typeof g.group === 'string' && typeof g.label === 'string' && ['total', 'good', 'middling', 'poor'].every((k) => Number.isInteger(g[k])));
    const total = r.groups.reduce((t, g) => t + g.total, 0);
    return [shaped && r.groups.length === Object.keys(P).length && Object.keys(P).every((p) => same(got[p], dash[P_LABEL[p]].counts)) && total === Object.values(dash).reduce((t, d) => t + d.total, 0), { groups: r.groups.length, got, problemsListed: total, dashboardTotal: Object.values(dash).reduce((t, d) => t + d.total, 0) }];
  });
  await check(c, '11.4', async () => {
    s = await mustSeam(S);
    const r = await door(S, 'groups', s.id, must(fc, 'Flashcards\' provider').id);
    if (!r.ok) return [false, r];
    const got = { mack: countsOf(groupOf(r.groups, 'mack')), venter: countsOf(groupOf(r.groups, 'VENTER')), chain: countsOf(groupOf(r.groups, 'chain-ladder')) };
    return [same(got.mack, C.Mack) && same(got.venter, C.Venter) && same(got.chain, C_CHAIN), { got, want: { mack: C.Mack, venter: C.Venter, chain: C_CHAIN }, groups: r.groups.map((g) => g.group) }];
  });
  await check(c, '11.5', async () => {
    const w = stringsOf(must(ws, 'Worksheets\' provider')).join(' '); const f = stringsOf(must(fc, 'Flashcards\' provider')).join(' ');
    return [/easy/i.test(w) && /medium/i.test(w) && /hard/i.test(w) && /again/i.test(f) && /hard/i.test(f) && /good|easy/i.test(f), { worksheets: w.slice(0, 200), flashcards: f.slice(0, 200) }];
  });
  await check(c, '11.6', async () => {
    s = await mustSeam(S);
    const w = await door(S, 'watch', s.id);
    const made = await door(S, 'mimic', s.id, { id: 'doorprobe.drills', kind: 'Drills', words: DRILL_WORDS, groups: DRILLS, withOpen: true });
    if (!made.ok) return [false, made];
    const listed = (await mustSeam(S)).providers.find((p) => p.id === 'doorprobe.drills');
    const groups = await door(S, 'groups', s.id, 'doorprobe.drills');
    const firedOn = (await door(S, 'watched')).fired;
    await door(S, 'mimicDispose', 'doorprobe.drills');
    const gone = !(await mustSeam(S)).providers.some((p) => p.id === 'doorprobe.drills');
    const firedOff = (await door(S, 'watched')).fired;
    return [w.ok && !!listed && Object.values(listed.strings).includes('Drills') && groups.ok && same(countsOf(groupOf(groups.groups, 'mack')), DRILL_MACK) && gone && firedOn >= 1 && firedOff > firedOn, { listed: listed ? listed.strings : null, goneAfterDispose: gone, eventFired: [firedOn, firedOff] }];
  });
  await check(c, '11.7', async () => {
    s = await mustSeam(S);
    await door(S, 'watch', s.id);
    await S.setTool('worksheets', false);
    const off = await until(async () => { const now = (await mustSeam(S)).providers; return !providerOf(now, /parallx\.worksheet/) ? now : null; }, 3000);
    const fired = (await door(S, 'watched')).fired;
    await S.setTool('worksheets', true);
    const back = await until(async () => providerOf((await mustSeam(S)).providers, /parallx\.worksheet/), 15_000);
    return [!!off && !!providerOf(off, /parallx-community\.flashcards/) && fired >= 1 && !!back, { goneWhenOff: !!off, flashcardsStill: off ? !!providerOf(off, /parallx-community\.flashcards/) : null, eventFired: fired, backWhenOn: !!back }];
  });
  await check(c, '11.8', async () => {
    must(providerOf((await mustSeam(S)).providers, /parallx-community\.flashcards/), 'Flashcards\' provider before it is turned off');
    await S.setTool('flashcards', false);
    const off = await until(async () => { const now = (await mustSeam(S)).providers; return !providerOf(now, /parallx-community\.flashcards/) ? now : null; }, 3000);
    return [!!off && !!providerOf(off, /parallx\.worksheet/), { left: off ? off.map((p) => p.id) : (await mustSeam(S)).providers.map((p) => p.id) }];
  });
  await check(c, '11.9', async () => {
    const doc = readFileSync(path.join(REPO, 'docs', 'PARALLX_EXTENSION_AUTHORING_FOR_AI.md'), 'utf8');
    const id = s && s.id ? s.id : null;
    return [/progress provider/i.test(doc) && !!id && doc.includes(id) && /middling/.test(doc), { mentionsProgressProviders: /progress provider/i.test(doc), namesTheCommand: id ? doc.includes(id) : 'there is no command to name', givesTheGroupShape: /middling/.test(doc) }];
  });
  await check(c, '11.10', async () => {
    const ui = await door(S, 'ui');
    const fns = (ui.keys || []).filter((k) => /bar/i.test(k) && !/(tool|side|scroll|status|tab|menu|title|activity)bar/i.test(k));
    const shared = uiClasses && uiClasses.tab ? uiClasses.tab.filter((k) => uiClasses.sidebar.includes(k) && !/^st-/.test(k)) : [];
    return [fns.length > 0 && shared.length > 0, { apiUiFunctions: fns, classesInTheTab: uiClasses.tab ?? uiClasses, classesInTheSidebar: uiClasses.sidebar ?? null, sharedAndNotStudys: shared }];
  });
});

// ── The workspace the phases start from: made by the app, once ───────────────
// Study may know a subject by its workspace, so those phases all run on the
// one workspace path it was made in, put back from a snapshot before each.
const BASE_WORKSPACE = path.join(OUT, 'runs', 'subject-workspace');
let baseSnapshot = null; let baseFailed = '';
async function subjectBase() {
  if (baseSnapshot) return baseSnapshot;
  if (baseFailed) throw new Error(baseFailed);
  const S = makeSession(await newRoot('subject-made', null, BASE_WORKSPACE));
  try {
    await S.open();
    // Study's questions: a database shaped like his, adopted as the subject.
    const bank = await seedDatabase(S, BANK, bankColumns(Object.keys(Q_STATES)), SEED.map((q) => ({ title: q.question, values: { 'Model Answer': q.answer, Paper: q.paper, ...historyOf(q.state) } })));
    must(rowsOf(S.workspace, bank).length === SEED.length, `the ${SEED.length} seeded questions in the workspace file`);
    await newSubject(S, { name: SUBJECT, questions: BANK });
    const subj = must(await waitSubject(S, SUBJECT), `the page "${SUBJECT}" with Units and Work Log under it`);
    await showStudySidebar(S);
    must(await until(() => sidebarReady(S), 12_000), `the adopted subject's counts in the sidebar (${(await subjectsText(S)) ?? 'no Subjects section'})`);
    // A unit made by hand, after the others: it has problems in Worksheets and no questions.
    const order = Math.max(0, ...rowsOf(S.workspace, subj.units.id).map((r) => num(r.values.Order))) + 1;
    const added = await S.tool('canvas_add_database_row', { databaseId: subj.units.id, title: HAND_UNIT, values: { Order: order } });
    must(await until(() => rowTitled(S.workspace, subj.units.id, HAND_UNIT), 5000), `the unit "${HAND_UNIT}" added to Units (${added.slice(0, 100)})`);
    const units = rowsOf(S.workspace, subj.units.id).sort((a, b) => num(a.values.Order) - num(b.values.Order) || a.sort - b.sort).map((r) => r.title);
    must(same(units, UNITS), `the units in the order ${UNITS.join(', ')} (they are ${units.join(', ')})`);
    // The other tools' tables exist once each has run; their data goes in with the app closed.
    must(await until(() => coreAll(S.workspace, "SELECT COUNT(*) AS n FROM sqlite_master WHERE name IN ('ws_items', 'ws_attempts')")[0].n === 2 && cardsAll(S.workspace, "SELECT COUNT(*) AS n FROM sqlite_master WHERE name IN ('fc_decks', 'fc_cards', 'fc_reviews')")[0]?.n === 3, 30_000, 250), 'the tables of Worksheets (in the workspace file) and of Flashcards (in its own file)');
    await closeStudyTabs(S);
    await sleep(2000);
    await S.close();
    seedTools(S.workspace);
    await S.open();
    const dash = await dashboardPapers(S);
    for (const [paper, counts] of Object.entries(P)) must(dash[P_LABEL[paper]] && same(dash[P_LABEL[paper]].counts, counts), `the seeded paper ${paper} on Worksheets' dashboard as ${counts} (it shows ${JSON.stringify(dash[P_LABEL[paper]] ?? null)}; all: ${Object.keys(dash).join(', ')})`);
    must(Object.keys(dash).length === Object.keys(P).length, `only the six seeded papers on the dashboard (${Object.keys(dash).join(', ')})`);
    const cards = cardsAll(S.workspace, 'SELECT COUNT(*) AS n FROM fc_cards')[0].n;
    must(cards === 17, `the 17 seeded cards (${cards})`);
    await showStudySidebar(S);
    must(await until(() => sidebarReady(S), 12_000), 'the subject back in the sidebar after the tools were seeded');
    await sleep(2000);
    console.log(`[probe] the workspace was made by the app: the subject "${SUBJECT}" from ${SEED.length} seeded questions, ${Object.values(P).reduce((t, c) => t + c[0] + c[1] + c[2] + c[3], 0)} problems on ${Object.keys(P).length} papers, ${cards} cards`);
  } catch (err) {
    baseFailed = `the workspace the phase starts from could not be made: ${String((err && err.message) || err).split('\n')[0].slice(0, 260)}`;
    throw new Error(baseFailed);
  } finally { await S.close(); }
  const snapshot = path.join(OUT, 'runs', 'subject-snapshot');
  await fs.cp(BASE_WORKSPACE, snapshot, { recursive: true });
  baseSnapshot = snapshot;
  return baseSnapshot;
}
/** The ids a phase on the subject works with, from the file. */
function subjectIds(ws) {
  const s = subjectOf(ws, SUBJECT);
  return { page: s.page?.id ?? null, units: s.units?.id ?? null, log: s.log?.id ?? null, bank: databases(ws).find((d) => norm(d.title) === BANK)?.id ?? null };
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
      const name = `phase-${String(p.n).padStart(2, '0')}`;
      S = makeSession(p.base === 'subject' ? await newRoot(name, await subjectBase(), BASE_WORKSPACE) : await newRoot(name, null));
      await S.open();
      await p.fn(S, c, p.base === 'subject' ? subjectIds(S.workspace) : null);
    } catch (err) {
      stopped = String((err && err.message) || err).split('\n')[0].slice(0, 300);
      if (S && S.page) await S.shot(`${String(p.n).padStart(2, '0')}-stopped`);
    } finally {
      if (S) await S.close();
      if (S && p.base === 'subject') await fs.rename(BASE_WORKSPACE, path.join(S.dir, 'workspace-after')).catch(() => {});
    }
    // A check the phase never reached has not passed.
    for (const id of Object.keys(p.checks)) if (!done.has(id)) c(id, false, stopped ? `not reached: ${stopped}` : 'not reached');
    console.log(`   (${Math.round((Date.now() - tp) / 1000)} s)`);
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n[probe] page errors: ${pageErrors.length}`);
  for (const e of [...new Set(pageErrors)].slice(0, 8)) console.log(`   ${e}`);
  console.log(`[probe] ${results.length} checks: ${results.length - failed.length} ok, ${failed.length} FAIL${failed.length ? ` (${failed.map((r) => r.id).join(' ')})` : ''}`);
  console.log(`[probe] ${Math.round((Date.now() - t0) / 1000)} s; screenshots in ${path.join(OUT, 'shots')}`);
  process.exitCode = failed.length ? 1 : 0;
}
main().catch((err) => { console.log(`[probe] FAIL the probe itself stopped: ${err && err.stack ? err.stack : err}`); process.exitCode = 1; });
