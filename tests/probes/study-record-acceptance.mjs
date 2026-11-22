// @acceptance: Study's record: a subject is a canvas page with Units, Questions and a Work Log, and Study reads and writes them
// Written from the request (piece 1 of "Study as the study system", 2026-11-18)
// before the build, by a verifier that did not build it, and seen to fail on
// the app as it was (eaa3346e). The builder does not edit this file: a check
// that is wrong is reported, not changed.
//
// What a person must be able to do when the piece is done (a phase's number is
// the request's statement; 11 is "For tool authors"; PARALLX_PROBE_ONLY takes
// these numbers):
//
//    1  New Subject… (command study.newSubject, Study's sidebar menu, Study's
//       home): a dialog for Name, Sources folder, Questions, Notes; confirming
//       makes a canvas page with the databases Units, Questions and Work Log
//       under it, with the request's columns, no Status column, and one unit
//       per subfolder (or per .pdf/.md/.markdown/.txt file) of the folder
//    2  an existing database as the questions: a mapping step with guesses he
//       can change; the database is used in place and only missing columns
//       are added; Units gets a row per distinct value of the Unit column
//    3  the subject in Study's sidebar with its units and "answered of total";
//       Open Units, Open Questions, Open Work Log, Study…, Remove Subject…
//    4  activating a unit studies only that unit's questions, on the usual card
//    5  each answer goes back to its row (Attempts, Correct, Last Result in the
//       database's own words, Last Answered); Mark as Right / Wrong corrects
//       the row without a second attempt; the unit's numbers follow
//    6  the database is the record: a row added, edited or deleted, and
//       Attempts edited by hand, are what Study uses next, with no restart
//    7  one Work Log row per session, updated when the session is resumed
//    8  the columns Study keeps cannot be edited in the table and say so; a
//       column Study needs that is deleted comes back
//    9  Study off: nothing changes, the databases still open and edit; on
//       again, the subject is back with its counts
//   10  2,000 questions: counts shown within 60 s, an answer written back
//       within 2 s (both times are printed)
//   11  api.canvas.databases is typed, documented and handed to any extension
//
// How it runs. Every phase gets its own app, profile and workspace, so one
// failure hides nothing. Phases 3 to 9 start from a copy of a workspace in
// which the app itself adopted a seeded database as the subject "Exam 7". A
// scripted model stands in for the owner's (there is none here): it grades a
// typed answer by its words against the prompt, so it proves the plumbing and
// never the quality of grading. The mouse and the keys are real.
//
//   xvfb-run -a node tests/probes/study-record-acceptance.mjs [outDir]
//   PARALLX_PROBE_ONLY=1,4,7-9   only those phases
//
// Where a result is read from. Never from what the probe typed: from the
// workspace's own database file (<workspace>/.parallx/data.db: pages,
// databases, database_properties, database_pages, page_property_values), from
// the database's table in the app, and from the words in Study's sidebar.
//
// How the probe writes "in the database" (none of it is Study or the new door):
// the canvas table itself with the mouse and keys (a cell's editor, a row's
// name, Delete Row…, a header's Delete property), and the chat's own tools
// canvas_create_database and canvas_add_database_row for seeding and for a row
// added with values.
// For the 2,000-row case only, 1,980 rows are written into the workspace file
// with the app closed, each a copy of a row the app made, before Study sees it.
//
// What the probe holds on to (the builder keeps these, or the check fails):
//   - everything new is found by the words a person reads (label, aria-label,
//     text): the command study.newSubject; "New Subject…"; the dialog's fields
//     Name, Sources folder, Questions (default "New database"), Notes; the
//     mapping step's Answer, Unit, Attempts, Correct, Last Result, Last
//     Answered and its choice "Add a column"; the sidebar section "Subjects";
//     the actions Open Units, Open Questions, Open Work Log, Study…, Remove
//     Subject…; "N of M" beside a unit; "kept by Study" on a kept cell
//   - the dialog is the app's modal ([role=dialog] or .parallx-modal-box) or
//     Study's sheet (.st-sheet). A choice is a native select, the kit's select,
//     radios, or a menu: the probe clicks the field and then the option by its
//     words. The folder is typed into a text field as an absolute path, or
//     picked through the system's folder dialog (answered here by a stand-in)
//   - a subject's actions are buttons on its row, or its context menu (right
//     click), or a More Actions menu on the row
//   - a unit is activated by a click on its name under Subjects (Enter, then a
//     double click, are tried next); if the usual setup sheet opens, Start
//   - the session card as it is today: .st-root, .st-card, .st-card__q, the
//     card's textarea, .st-fb.st-fb--show, Next, Previous, Mark…, Mark as
//     Right / Mark as Wrong, Discuss in Chat, results .st-res, a session's row
//     .st-sb__it--session, the setup sheet .st-sheet
//   - the canvas table as it is today: [data-px-surface="database"] with the
//     database's id at the end of data-px-instance, .canvas-db-th__name,
//     tr.canvas-db-row, td[role=gridcell], .canvas-db-cell__value,
//     .canvas-db-cell__titletext, data-editable, the command database.setCell
//   - the scripted model reads Study's grading prompts as they are today: the
//     system line's JSON keys ("points" with "contradiction", "rubric"), the
//     numbered lines under "Points to mark…", and "Student's answer:"
//
// How the request is read where it leaves room (told to the builder):
//   - "answered" of a unit is the number of its questions with Attempts > 0;
//     "Right Last Time" the number whose Last Result means right
//   - a select Last Result with the options Correct / Incorrect is written in
//     those words; a new Questions database gets Right / Partly / Wrong
//   - Last Answered and Last Worked hold today's date (the local date, or the
//     UTC date: either passes)
//   - a kept cell "says it is kept by Study" when those words are in the
//     cell's text, title or aria-label
//   - a kept column that cannot be deleted at all also passes "comes back"
//   - required columns are checked by name and type; an extra column is
//     printed and is not a failure, except one named Status
//   - the Unit of a question is read as the unit's name: a text or select
//     value, or a relation to the Units row
//   - the door's function names are not fixed by the request: the probe looks
//     for one function per job by the words in its name (list, get, create,
//     ensure…columns, rows, add…row, update…row, remove…row, on…Change…,
//     …page) and calls only the three reads with the database's id
//
// Not checked here: "with canvas databases unavailable the door fails clearly"
// (canvas cannot be turned off in a running app); Partly as a result (the
// stand-in grader gives right or wrong); a kept cell in views other than the
// table and the command path.
import { _electron as electron } from 'playwright';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.resolve(process.argv[2] ?? path.join(REPO, 'test-results', 'study-record-acceptance'));
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
/** Today as the app may write it: the local date or the UTC date. */
function todays() {
  const d = new Date();
  const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return [...new Set([local, d.toISOString().slice(0, 10)])];
}
const isToday = (v) => typeof v === 'string' && todays().some((t) => v.startsWith(t));
const num = (v) => (v === null || v === undefined || v === '' ? 0 : Number(v));
const checked = (v) => v === true || v === 1 || v === 'true';

// ── The checks ────────────────────────────────────────────────────────────────
const results = []; // { id, label, ok }
function record(id, label, ok, got) {
  const detail = got === undefined ? '' : ` :: ${String(typeof got === 'string' ? got : JSON.stringify(got)).replace(/\s+/g, ' ').slice(0, 460)}`;
  console.log(`${ok ? '  ok ' : ' FAIL'} ${id} ${label}${ok && !detail ? '' : detail}`);
  results.push({ id, label, ok: !!ok });
}

// ── Fixtures: two folders of sources ─────────────────────────────────────────
const NESTED = 'Exam 7 Sources';                      // subfolders: one unit each
const NESTED_UNITS = ['A Mack 1993', 'B Clark 2003', 'C Friedland'];
const FLAT = 'GLM Readings';                          // files: one unit per .pdf/.md/.markdown/.txt
const FLAT_UNITS = ['01 Introduction', '02 Link Functions', '03 Deviance', '04 Offsets'];
async function makeFixtures() {
  const dir = path.join(OUT, 'fixtures');
  await fs.rm(dir, { recursive: true, force: true });
  for (const u of NESTED_UNITS) { await fs.mkdir(path.join(dir, NESTED, u), { recursive: true }); await fs.writeFile(path.join(dir, NESTED, u, 'reading.md'), `# ${u}\n\nA page of ${u}.\n`); }
  await fs.writeFile(path.join(dir, NESTED, 'syllabus.txt'), 'A loose file beside the subfolders.\n');
  await fs.mkdir(path.join(dir, FLAT), { recursive: true });
  await fs.writeFile(path.join(dir, FLAT, '02 Link Functions.md'), '# Link functions\n\nThe log link keeps the mean positive.\n');
  await fs.writeFile(path.join(dir, FLAT, '01 Introduction.pdf'), '%PDF-1.4\n% a stand-in, never opened\n');
  await fs.writeFile(path.join(dir, FLAT, '04 Offsets.markdown'), 'An offset is a term with a fixed coefficient of one.\n');
  await fs.writeFile(path.join(dir, FLAT, '03 Deviance.txt'), 'Deviance compares a model with the saturated model.\n');
  await fs.writeFile(path.join(dir, FLAT, '05 Figures.docx'), 'not a source Study reads\n');
  await fs.writeFile(path.join(dir, FLAT, 'cover.png'), 'not a source Study reads\n');
  return dir;
}

/** A new profile under runs/<name>, and a workspace at `workspace` copied from `from`. */
async function newRoot(name, from, workspace = path.join(OUT, 'runs', name, 'workspace')) {
  const dir = path.join(OUT, 'runs', name);
  await fs.rm(dir, { recursive: true, force: true });
  await fs.rm(workspace, { recursive: true, force: true });
  await fs.mkdir(path.join(dir, 'app', 'data'), { recursive: true });
  await fs.cp(from, workspace, { recursive: true });
  // No background indexing, suggestions or heartbeat: the probe is the only thing calling the model.
  await fs.mkdir(path.join(workspace, '.parallx'), { recursive: true });
  await fs.writeFile(path.join(workspace, '.parallx', 'ai-config.json'), JSON.stringify({ overrides: { indexing: { autoIndex: false, watchFiles: false }, suggestions: { suggestionsEnabled: false }, heartbeat: { enabled: false } } }));
  return { dir, workspace };
}

// ── The workspace's database file, read as the app left it ──────────────────
function coreAll(workspace, sql, params = []) {
  const file = path.join(workspace, '.parallx', 'data.db');
  if (!existsSync(file)) return [];
  const d = new DatabaseSync(file, { readOnly: true });
  try { return d.prepare(sql).all(...params); } finally { d.close(); }
}
const parse = (s) => { try { return JSON.parse(s); } catch { return s; } };
/** The live pages that are not databases, by title. */
const pagesTitled = (ws, title) => coreAll(ws, 'SELECT id, title, parent_id FROM pages WHERE title = ? AND is_archived = 0 AND id NOT IN (SELECT id FROM databases)', [title]);
/** The live databases, optionally only those directly under a page. */
const databases = (ws, parentId = undefined) => coreAll(ws, `SELECT d.id, p.title, p.parent_id FROM databases d JOIN pages p ON p.id = d.id WHERE p.is_archived = 0 ${parentId === undefined ? '' : 'AND p.parent_id = ?'} ORDER BY p.sort_order`, parentId === undefined ? [] : [parentId]);
const columns = (ws, dbId) => coreAll(ws, 'SELECT id, name, type, config, sort_order FROM database_properties WHERE database_id = ? ORDER BY sort_order', [dbId]).map((p) => ({ ...p, config: parse(p.config) }));
const optionsOf = (col) => (Array.isArray(col?.config?.options) ? col.config.options.map((o) => String(o?.value ?? o?.name ?? o)) : []);
/** A database's rows: { pageId, title, parentId, sort, values by column name, raw by column id (the stored JSON text) }. */
function rowsOf(ws, dbId) {
  const cols = columns(ws, dbId);
  const rows = coreAll(ws, 'SELECT p.id AS pageId, p.title, p.parent_id AS parentId, dp.sort_order AS sort FROM database_pages dp JOIN pages p ON p.id = dp.page_id WHERE dp.database_id = ? AND p.is_archived = 0 ORDER BY dp.sort_order, p.id', [dbId]);
  const by = new Map(rows.map((r) => [r.pageId, { ...r, values: {}, raw: {} }]));
  for (const v of coreAll(ws, 'SELECT page_id, property_id, value FROM page_property_values WHERE database_id = ?', [dbId])) {
    const r = by.get(v.page_id); const c = cols.find((x) => x.id === v.property_id);
    if (!r || !c) continue;
    r.raw[c.id] = v.value; r.values[c.name] = parse(v.value);
  }
  return [...by.values()];
}
const rowTitled = (ws, dbId, title) => rowsOf(ws, dbId).find((r) => norm(r.title) === norm(title)) || null;
/** A unit named by a cell: the text or option itself, or the titles of the rows a relation points at. */
function unitNames(ws, value) {
  const list = Array.isArray(value) ? value : value === null || value === undefined || value === '' ? [] : [value];
  return list.map((v) => {
    const id = typeof v === 'object' && v ? String(v.id ?? v.pageId ?? '') : String(v);
    const page = /^[0-9a-f-]{20,}$/i.test(id) ? coreAll(ws, 'SELECT title FROM pages WHERE id = ?', [id])[0] : null;
    return norm(page ? page.title : typeof v === 'object' && v ? v.title ?? v.name ?? v.value ?? '' : v);
  }).filter(Boolean);
}
/** A column by one of its names (case and spaces aside). */
const col = (cols, ...names) => cols.find((c) => names.some((n) => norm(c.name).toLowerCase() === n.toLowerCase())) || null;
/** Everything stored for a database and its rows, as one string that changes when anything of the person's changes. */
function fingerprint(ws, dbId) {
  const page = coreAll(ws, 'SELECT title, parent_id, is_archived FROM pages WHERE id = ?', [dbId])[0] ?? null;
  const cols = columns(ws, dbId).map((c) => [c.id, c.name, c.type, JSON.stringify(c.config)]);
  const rows = rowsOf(ws, dbId).map((r) => [r.pageId, r.title, r.parentId, r.sort, Object.entries(r.raw).sort()]);
  return JSON.stringify({ page, cols, rows });
}

// ── The seeded database shaped like his: 12 conceptual questions on 3 papers ─
const BANK = 'Conceptual Questions';
const NOTES_DB = 'Reading Notes';
const SEED = [
  // paper, question, model answer, attempted, correct, last result
  ['Mack', 'What does Mack assume about development factors across accident years 101?', 'Development factors stay independent between different accident years.', 3, 2, 'Correct'],
  ['Mack', 'What drives the variance of the next cumulative loss under Mack 102?', 'Variance grows proportional with cumulative losses reported already.', 1, 0, 'Incorrect'],
  ['Mack', 'Why does Mack weight link ratios by volume 103?', 'Volume weighting minimises estimator variance under proportional assumption.', null, null, null],
  ['Mack', 'Which diagnostic tests calendar year effects in Mack 104?', 'Counting large versus small factors along every diagonal.', null, null, null],
  ['Clark', 'Which growth curves does Clark fit to development 201?', 'Loglogistic together with Weibull growth curves describe emergence.', 2, 2, 'Correct'],
  ['Clark', 'What separates process variance from parameter variance in Clark 202?', 'Process randomness differs from estimation uncertainty around parameters.', null, null, null],
  ['Clark', 'Why does Clark prefer the Cape Cod form 203?', 'Fewer parameters produce smaller estimation error using exposure.', null, null, null],
  ['Clark', 'What does truncation do to the fitted curve in Clark 204?', 'Truncation stops extrapolation beyond chosen maturity point.', null, null, null],
  ['Clark', 'How is the scale factor sigma squared estimated in Clark 205?', 'Dividing squared residuals through degrees freedom gives sigma.', null, null, null],
  ['Friedland', 'When does the expected claims technique work best 301?', 'Immature periods lacking credible reported experience suit expectation.', null, null, null],
  ['Friedland', 'What distorts paid development after faster settlement 302?', 'Accelerated closure inflates early payments versus history.', null, null, null],
  ['Friedland', 'Why adjust case reserves for adequacy changes 303?', 'Strengthening reserves overstates incurred development otherwise.', null, null, null],
];
const SEED_UNITS = { Mack: { total: 4, answered: 2, right: 1 }, Clark: { total: 5, answered: 1, right: 1 }, Friedland: { total: 3, answered: 0, right: 0 } };
const WRONG = 'Qqqqqqq zzzzzzz wwwwwww.';

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

// What the probe reads off the page: a control by the name a person reads, the
// card on screen, a field of the dialog by its label, a cell of the table.
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
    if (scope === 'form') return form();
    if (scope === 'body') return document.body;
    return Array.from(document.querySelectorAll(scope)).find(shown) || null;
  };
  // The name a person reads: the words on the control; its tooltip only when it shows no words (an icon).
  const namesOf = (n) => {
    const words = norm(n.textContent);
    return (words ? [n.getAttribute('aria-label'), words] : [n.getAttribute('aria-label'), n.getAttribute('title'), n.getAttribute('data-parallx-title')]).map(norm).filter(Boolean);
  };
  // The label of a field: aria-label, aria-labelledby, its <label>, its placeholder.
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
  /** The table of the database on screen (the one whose id ends data-px-instance, or any). */
  const table = (dbId) => {
    const surfaces = Array.from(document.querySelectorAll('[data-px-surface="database"]')).filter(shown);
    const s = dbId ? surfaces.find((e) => (e.getAttribute('data-px-instance') || '').endsWith(dbId)) : surfaces[0];
    return s ? { surface: s, heads: Array.from(s.querySelectorAll('.canvas-db-th__name')).map((h) => norm(h.textContent)), rows: Array.from(s.querySelectorAll('tr.canvas-db-row')) } : null;
  };
  window.__ap = {
    shown, scopeEl,
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
        const pressed = n.getAttribute('aria-pressed') ?? n.getAttribute('aria-checked') ?? (n.tagName === 'INPUT' && (n.type === 'checkbox' || n.type === 'radio') ? String(n.checked) : null);
        out.push({ ...point(n), name, disabled: !!n.disabled || n.getAttribute('aria-disabled') === 'true', pressed, tag: n.tagName });
      }
      return out;
    },
    /** A field of the dialog whose label matches: where it is, what it is, what it shows. */
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
      // The name alone, or the name with its count in the same element ("Mack 2 of 4").
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
        fbClass: fb ? String(fb.className) : '',
      };
    },
    results: () => { const r = scopeEl('root'); return !!r && Array.from(r.querySelectorAll('.st-res')).some(shown); },
    tabs: () => Array.from(document.querySelectorAll('.ui-tab')).map((t) => ({ id: t.getAttribute('data-tab-id') || '', active: t.classList.contains('ui-tab--active'), label: norm(t.querySelector('.ui-tab-label')?.textContent) })),
    notices: () => Array.from(document.querySelectorAll('.parallx-notification, .parallx-modal-box')).filter(shown).map((n) => norm(n.innerText)).join('\n'),
    tableState(dbId) { const t = table(dbId); return t ? { heads: t.heads, titles: t.rows.map((r) => norm(r.querySelector('.canvas-db-cell__titletext')?.textContent)) } : null; },
    /** One cell: where to click, whether the table lets it be edited, what it shows and says. */
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
      const th = t.surface.querySelectorAll('thead th')[i];
      const headSays = th ? [th, ...th.querySelectorAll('*')].flatMap((n) => [n.getAttribute('title'), n.getAttribute('aria-label'), n.getAttribute('data-parallx-title')]).map(norm).filter(Boolean).join(' | ') : '';
      return { ...point(target), text: norm(td.innerText), editable: td.dataset.editable === 'true', says, headSays, editing: !!td.querySelector('input, textarea, [contenteditable="true"], .canvas-db-cell__editor') };
    },
    head(dbId, column) { const t = table(dbId); const h = t && Array.from(t.surface.querySelectorAll('.canvas-db-th__name')).find((x) => norm(x.textContent).toLowerCase() === String(column).toLowerCase()); return h ? point(h) : null; },
    editorOpen: () => { const a = document.activeElement; return !!a && !!a.closest('[data-px-surface="database"]') && (a.matches('input, textarea, [contenteditable="true"]')); },
  };
  return true;
}

// ── An extension that is not Study, to stand at the door ────────────────────
const DOOR_EXT = {
  manifest: { manifestVersion: 1, id: 'probe.door-probe', name: 'Door Probe', version: '0.0.1', publisher: 'probe', description: 'Reads api.canvas.databases for the acceptance probe.', main: 'main.js', activationEvents: ['onStartupFinished'], engines: { parallx: '^0.1.0' }, contributes: { commands: [{ id: 'doorprobe.keys', title: 'Door Probe: Keys' }, { id: 'doorprobe.call', title: 'Door Probe: Call' }] } },
  main: `
function walk(o, pre, out, depth) { if (!o || depth > 2) return out; for (const k of Object.keys(o)) { const v = o[k]; const p = pre ? pre + '.' + k : k; if (typeof v === 'function') out.push(p); else if (v && typeof v === 'object') walk(v, p, out, depth + 1); } return out; }
const safe = (v) => { try { return v === undefined ? null : JSON.parse(JSON.stringify(v)); } catch { return String(v); } };
export function activate(api, context) {
  context.subscriptions.push(api.commands.registerCommand('doorprobe.keys', () => {
    const door = api.canvas && api.canvas.databases;
    return { type: typeof door, keys: door ? walk(door, '', [], 0) : [], canvas: api.canvas ? Object.keys(api.canvas) : [] };
  }));
  context.subscriptions.push(api.commands.registerCommand('doorprobe.call', async (name, args) => {
    let fn = api.canvas && api.canvas.databases; let self = fn;
    for (const part of String(name).split('.')) { self = fn; fn = fn ? fn[part] : undefined; }
    if (typeof fn !== 'function') return { ok: false, error: 'no function ' + name };
    try { return { ok: true, value: safe(await fn.apply(self, args || [])) }; } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
  }));
}
export function deactivate() {}
`,
};

// ── One app ──────────────────────────────────────────────────────────────────
const pageErrors = [];
let shotN = 0;
async function launch(dir, workspace) {
  const appRoot = path.join(dir, 'app');
  await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: workspace }));
  // The app's extensions, and beside them the one that stands at the door.
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
  const on = await page.evaluate(async () => {
    const s = window.__parallx_workbench__._services.get({ id: 'IToolEnablementService' });
    try { await s.setEnablement('parallx-community.study', true); await s.setEnablement('probe.door-probe', true); return true; } catch (e) { return String(e); }
  });
  if (on !== true) throw new Error(`Study or the door extension could not be turned on: ${on}`);
  // Study has finished starting once its last registration (the chat tools) is in.
  await page.waitForFunction(() => { try { return !!window.__parallx_workbench__._services.get({ id: 'ILanguageModelToolsService' }).getTool('study_results'); } catch { return false; } }, null, { timeout: 60_000 });
  await page.waitForFunction(() => { try { return window.__parallx_workbench__._services.get({ id: 'ICommandService' }).hasCommand('doorprobe.keys'); } catch { return false; } }, null, { timeout: 30_000 });
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
    async open() { const a = await launch(dir, workspace); S.app = a.app; S.page = a.page; },
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
    text: (scope = 'root') => S.page.evaluate((scope) => window.__ap.text(scope), scope),
    has: (scope, sel) => S.page.evaluate(({ scope, sel }) => window.__ap.has(scope, sel), { scope, sel }),
    card: () => S.page.evaluate(() => window.__ap.card()),
    tabs: () => S.page.evaluate(() => window.__ap.tabs()),
    notices: () => S.page.evaluate(() => window.__ap.notices()),
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
    /** The system's folder and file dialog, answered with `paths` (there is no person to pick). */
    answerSystemDialog: (paths) => S.app.evaluate(({ dialog }, paths) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: paths }); dialog.showOpenDialogSync = () => paths; }, paths),
    all: (sql, params) => coreAll(S.workspace, sql, params),
  };
  return S;
}

// ── Steps a person takes ─────────────────────────────────────────────────────
const sidebarShown = (S) => S.page.evaluate(() => { const sb = window.__ap.scopeEl('sidebar'); return !!sb && window.__ap.shown(sb) && /(^|\n)\s*Materials\b/.test(sb.innerText); });
async function showStudySidebar(S) {
  if (await sidebarShown(S)) return true;
  await S.press('body', /^Study$/, '.activity-bar-item');
  return !!(await until(() => sidebarShown(S), 5000));
}
/** The words of the sidebar's Subjects section (its label's line to the next section's), or null when there is none. */
async function subjectsText(S) {
  const lines = (await S.text('sidebar')).split('\n').map(norm).filter(Boolean);
  const i = lines.findIndex((l) => /^Subjects\b/i.test(l));
  if (i < 0) return null;
  const j = lines.findIndex((l, k) => k > i && /^(Materials|Review|Sessions|Question banks)\b/i.test(l));
  return lines.slice(i + 1, j < 0 ? undefined : j).join(' ');
}
/** "answered of total" beside a unit's name in the Subjects section. */
function unitCount(text, unit) {
  const m = new RegExp(`${esc(unit)}\\s*[:·,-]?\\s*(\\d+)\\s+of\\s+(\\d+)`, 'i').exec(String(text || ''));
  return m ? { answered: Number(m[1]), total: Number(m[2]) } : null;
}
const countsOf = async (S, units) => { const t = await subjectsText(S); return Object.fromEntries(units.map((u) => [u, unitCount(t, u)])); };
const sameCounts = (got, want) => Object.entries(want).every(([u, w]) => got[u] && got[u].answered === w.answered && got[u].total === w.total);
/** A subject's (or a unit's) name under Subjects: where to click. A folded subject is opened once. */
async function subjectPoint(S, name, { under = null } = {}) {
  await showStudySidebar(S);
  let pt = await S.textPoint('sidebar', name, '^Subjects( \\d+)?$');
  if (!pt && under) { const parent = await S.textPoint('sidebar', under, '^Subjects( \\d+)?$'); if (parent) { await S.click(parent); await sleep(500); pt = await S.textPoint('sidebar', name, '^Subjects( \\d+)?$'); } }
  return pt;
}
const MENU_ITEMS = '[role="menuitem"], [role="menuitemradio"], [role="option"], .parallx-quickpick-row';
/** One of a subject's actions: a button on its row, its context menu, or its More Actions menu. */
async function subjectAction(S, subject, label) {
  const row = must(await subjectPoint(S, subject), `the subject "${subject}" under Subjects in the sidebar`);
  const re = new RegExp(`^${esc(label).replace(/…$/, '(…|\\.\\.\\.)?')}$`, 'i');
  await S.page.mouse.move(row.x, row.y);
  await sleep(250);
  const near = (await S.find('sidebar', re)).filter((h) => !h.disabled).sort((a, b) => Math.abs(a.y - row.y) - Math.abs(b.y - row.y))[0];
  if (near && Math.abs(near.y - row.y) < 60) { await S.click(near); return `button "${near.name}"`; }
  await S.click(row, { button: 'right' });
  await sleep(450);
  let item = await S.press('body', re, MENU_ITEMS);
  if (item) return `context menu: ${item.name}`;
  await S.page.keyboard.press('Escape');
  const more = (await S.find('sidebar', /^More Actions/i)).filter((h) => !h.disabled).sort((a, b) => Math.abs(a.y - row.y) - Math.abs(b.y - row.y))[0];
  if (more) { await S.click(more); await sleep(450); item = await S.press('body', re, MENU_ITEMS); if (item) return `More Actions: ${item.name}`; await S.page.keyboard.press('Escape'); }
  return '';
}

/** Choose `option` in the dialog's field labelled like `re`. Returns what was offered, or why not. */
async function chooseIn(S, re, option) {
  const f = await S.field(re);
  if (!f) return { ok: false, why: 'no such field' };
  if (f.tag === 'SELECT') {
    const label = (f.options || []).find((o) => option.test(o));
    if (!label) return { ok: false, why: 'not offered', offered: f.options };
    await S.page.selectOption('[data-probe-field]', { label });
    return { ok: true, offered: f.options };
  }
  // Radios or a list in the dialog itself.
  const inForm = (await S.find('form', option, '[role="radio"], [role="option"], input[type="radio"], label')).find((h) => !h.disabled);
  if (inForm && /radiogroup|listbox|group/.test(f.role)) { await S.click(inForm); return { ok: true, offered: [inForm.name] }; }
  await S.click(f);
  await sleep(400);
  const offered = (await S.find('body', /./, MENU_ITEMS)).map((h) => h.name);
  const hit = await S.press('body', option, MENU_ITEMS);
  if (!hit) { const back = await S.press('body', exact(f.value), MENU_ITEMS); if (!back) await S.page.keyboard.press('Escape'); return { ok: false, why: 'not offered', offered }; }
  await sleep(300);
  return { ok: true, offered };
}
const F = { name: /^(subject )?name\b/i, folder: /sources?\b|folder/i, questions: /^questions?\b/i, notes: /^notes?\b/i };
const MAP = { answer: /^answer\b/i, unit: /^unit\b/i, attempts: /^attempts\b/i, correct: /^correct\b/i, lastResult: /^last result\b/i, lastAnswered: /^last answered\b/i };
const CONFIRM = [/^(create|create subject|new subject|add subject)\b/i, /^(continue|next)\b/i, /^(done|ok|save|use|adopt|confirm|finish)\b/i];
async function pressConfirm(S) {
  for (const re of CONFIRM) {
    const hit = (await S.find('form', re, 'button')).find((h) => !h.disabled && !/add a column|browse|choose|cancel/i.test(h.name));
    if (hit) { await S.click(hit); return hit; }
  }
  return null;
}
async function openNewSubject(S) {
  if (!(await S.hasCommand('study.newSubject'))) throw new Error('there is no command study.newSubject');
  S.run('study.newSubject');
  must(await until(() => S.formOpen(), 6000), 'the New Subject dialog after study.newSubject');
  await sleep(400);
}
/**
 * New Subject…, as a person fills it in. `questions` / `notes` are the title
 * of an existing database; `mapping` runs on the mapping step before it is
 * confirmed. Returns when the dialog has closed, with the time of the last confirm.
 */
async function newSubject(S, { name, folder = null, questions = null, notes = null, mapping = null }) {
  await openNewSubject(S);
  const nameField = must(await S.field(F.name), 'the Name field of the New Subject dialog');
  await S.click(nameField); await S.page.keyboard.press('Control+A'); await S.page.keyboard.type(name);
  if (folder) {
    await S.answerSystemDialog([folder]);
    const f = must(await S.field(F.folder) || (await S.find('form', /sources?|folder|browse/i, 'button'))[0], 'the Sources folder field');
    await S.click(f);
    if (f.tag === 'INPUT' || f.tag === 'TEXTAREA') { await S.page.keyboard.press('Control+A'); await S.page.keyboard.type(folder); await S.page.keyboard.press('Tab'); } else { await sleep(500); await S.press('body', exact(path.basename(folder)), MENU_ITEMS); }
    await sleep(400);
  }
  if (questions) { const r = await chooseIn(S, F.questions, exact(questions)); if (!r.ok) throw new Error(`"${questions}" could not be chosen as the Questions: ${JSON.stringify(r)}`); }
  if (notes) { const r = await chooseIn(S, F.notes, exact(notes)); if (!r.ok) throw new Error(`"${notes}" could not be chosen as the Notes: ${JSON.stringify(r)}`); }
  await sleep(300);
  let confirmedAt = 0; let mapped = false;
  for (let step = 0; step < 4; step++) {
    if (!(await S.formOpen())) break;
    if (questions && !mapped && (await S.field(MAP.answer))) { mapped = true; if (mapping) await mapping(); }
    confirmedAt = Date.now();
    must(await pressConfirm(S), `a button to confirm the New Subject dialog (it shows: ${norm(await S.formText()).slice(0, 160)})`);
    await until(async () => !(await S.formOpen()) || (questions && !mapped && (await S.field(MAP.answer))), 6000);
    await sleep(300);
  }
  if (await S.formOpen()) throw new Error(`the New Subject dialog did not close: ${norm(await S.formText()).slice(0, 200)}`);
  if (questions && !mapped) throw new Error('no mapping step was shown for the existing database');
  return { confirmedAt };
}
/** The subject's page and its databases, from the file. */
function subjectOf(ws, name) {
  const page = pagesTitled(ws, name)[0] || null;
  const under = page ? databases(ws, page.id) : [];
  const named = (t) => under.find((d) => norm(d.title).toLowerCase() === t.toLowerCase()) || null;
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
async function deleteRow(S, dbId, rowTitle) {
  const cell = must(await S.cell(dbId, rowTitle, 'Name'), `the row "${rowTitle.slice(0, 40)}" in the table`);
  await S.click(cell, { button: 'right' });
  await sleep(400);
  must(await S.press('body', /^Delete Row/, MENU_ITEMS), 'Delete Row… in the row\'s menu');
  await sleep(400);
  must(await S.press('body', /^Delete Row$/, '.parallx-modal-box button'), 'the Delete Row button of the question');
  await sleep(600);
}
/** A header's Delete property, confirmed. Returns how far it got. */
async function deleteColumn(S, dbId, column) {
  const head = await S.page.evaluate(({ dbId, column }) => window.__ap.head(dbId, column), { dbId, column });
  if (!head) return 'no such header';
  await S.click(head);
  await sleep(400);
  const item = await S.press('body', /^Delete property$/i, 'button, [role="menuitem"], [role="button"]');
  if (!item) { await S.page.keyboard.press('Escape'); return 'the header offers no Delete property'; }
  await sleep(400);
  const yes = await S.press('body', /^Delete$/, '.parallx-modal-box button');
  await sleep(700);
  return yes ? 'deleted' : 'not confirmed';
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
/** Activate a unit under a subject and return its first card. */
async function studyUnit(S, subject, unit) {
  const pt = must(await subjectPoint(S, unit, { under: subject }), `the unit "${unit}" under "${subject}" in the sidebar`);
  await S.click(pt);
  let card = await cardAfter(S, 3000);
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
/** Type an answer and submit it; returns the card with its verdict. */
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
const OVERRULE = /overrul|overrid|disagree|\bmark (it |this |answer |as )*(right|correct|wrong|incorrect)|\bi was (right|wrong)|\bcount (it |this )?as\b/i;
async function overrule(S, to) {
  const ctl = (await S.find('root', OVERRULE)).find((h) => !h.disabled && (to === 'right' ? !/wrong|incorrect/i.test(h.name) : !/\b(right|correct)\b/i.test(h.name) || /wrong|incorrect/i.test(h.name)));
  if (!ctl) return '';
  await S.click(ctl);
  await sleep(500);
  const pick = await S.press('body', to === 'right' ? /\b(right|correct)\b/i : /\b(wrong|incorrect|miss(ed)?)\b/i, '.context-menu [role="menuitem"], .parallx-modal-box button, .parallx-quickpick-row');
  await sleep(900);
  return `${ctl.name}${pick ? ` → ${pick.name}` : ''}`;
}
async function closeActiveTab(S) { await S.press('body', /./, '.ui-tab--active .ui-tab-close'); await sleep(700); }
async function closeStudyTabs(S) {
  for (let i = 0; i < 5; i++) {
    const t = (await S.tabs()).find((x) => /:study:/.test(x.id));
    if (!t) return;
    await S.page.evaluate((id) => { const tab = Array.from(document.querySelectorAll('.ui-tab')).find((x) => x.getAttribute('data-tab-id') === id); tab?.querySelector('.ui-tab-close')?.dispatchEvent(new MouseEvent('click', { bubbles: true })); }, t.id);
    await sleep(500);
    await S.press('body', /^(End Session|Leave|Close)\b/, '.parallx-modal-box button');
    await sleep(400);
  }
}

// ── Seeding, through the chat's own tools ────────────────────────────────────
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
const BANK_COLUMNS = [
  { name: 'Model Answer', type: 'text' }, { name: 'Paper', type: 'select', options: ['Mack', 'Clark', 'Friedland'] },
  { name: 'Times Attempted', type: 'number' }, { name: 'Times Correct', type: 'number' },
  { name: 'Last Result', type: 'select', options: ['Correct', 'Incorrect'] }, { name: 'Remarks', type: 'text' },
];
const bankRows = () => SEED.map(([paper, q, a, att, cor, last], i) => ({ title: q, values: { 'Model Answer': a, Paper: paper, ...(att === null ? {} : { 'Times Attempted': att, 'Times Correct': cor, 'Last Result': last }), ...(i % 5 === 0 ? { Remarks: `His own remark ${i}` } : {}) } }));
async function seedBank(S) {
  const bank = await seedDatabase(S, BANK, BANK_COLUMNS, bankRows());
  const notes = await seedDatabase(S, NOTES_DB, [{ name: 'Paper', type: 'text' }], [{ title: 'Note on Mack', values: { Paper: 'Mack' } }, { title: 'Note on Clark', values: { Paper: 'Clark' } }]);
  must(rowsOf(S.workspace, bank).length === SEED.length, 'the 12 seeded rows in the workspace file');
  return { bank, notes };
}
/**
 * 2,000 questions on 20 papers. The database, its columns and the first row of
 * each paper are made by the chat's tools; the other 1,980 rows are written
 * into the workspace file with the app closed, each a copy of a row the app
 * made (the tool takes minutes for 2,000), and the app is started again.
 * Each paper: 100 questions, the first 25 with history, 10 of them right last time.
 */
const BIG_PAPERS = Array.from({ length: 20 }, (_, i) => `Paper ${String(i + 1).padStart(2, '0')}`);
async function seedBigBank(S) {
  const ws = S.workspace;
  const valuesOf = (p, i) => ({ 'Model Answer': `Reference statement number${p * 100 + i} explaining matters.`, Paper: BIG_PAPERS[p], ...(i < 25 ? { 'Times Attempted': 1 + (i % 3), 'Times Correct': i < 10 ? 1 : 0, 'Last Result': i < 10 ? 'Correct' : 'Incorrect' } : {}) });
  const titleOf = (p, i) => `Question ${p + 1}-${i + 1}: what holds for item ${p * 100 + i}?`;
  const big = await seedDatabase(S, 'Big Bank', BANK_COLUMNS.map((x) => (x.name === 'Paper' ? { ...x, options: BIG_PAPERS } : x)), BIG_PAPERS.map((_, p) => ({ title: titleOf(p, 0), values: valuesOf(p, 0) })));
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
  must(await openDb(S, big), 'the 2,000-row database open in the app');
  const inApp = await until(() => S.page.evaluate((big) => { const t = window.__ap.tableState(big); return t && t.titles.length >= 2000 ? t.titles.length : null; }, big), 30_000, 250);
  must(inApp, 'the 2,000 rows in the app\'s own table of the database');
  return big;
}
const seededRow = (stem) => SEED.find((r) => norm(r[1]) === norm(stem)) || null;

// ── The phases ───────────────────────────────────────────────────────────────
const PHASES = [];
const phase = (n, title, base, checks, fn) => PHASES.push({ n, title, base, checks, fn });
const SUBJECT = 'Exam 7';
const KEPT = ['Questions', 'Answered', 'Right Last Time', 'Last Worked'];
const typesOk = (cols, want) => Object.entries(want).map(([name, types]) => { const c = col(cols, name); return c && (types.length === 0 || types.includes(c.type)) ? null : `${name}: ${c ? c.type : 'missing'}`; }).filter(Boolean);
const UNITS_WANT = { Order: ['number'], Weight: ['number'], Questions: ['number'], Answered: ['number'], 'Right Last Time': ['number'], 'Last Worked': ['date'] };
const QUESTIONS_WANT = { Answer: ['text'], Unit: [], Kind: ['select'], Source: ['text', 'url'], Attempts: ['number'], Correct: ['number'], 'Last Result': ['select'], 'Last Answered': ['date'] };
const LOG_WANT = { Date: ['datetime'], Minutes: ['number'], Unit: [], Tool: ['select'], Kind: ['select'], Items: ['number'], Right: ['number'], Confirmed: ['checkbox'], Origin: ['select'] };
const hasAll = (have, want) => want.filter((w) => !have.some((h) => h.toLowerCase() === w.toLowerCase()));

phase(1, 'New Subject…', 'plain', {
  '1.1': 'the command study.newSubject opens a dialog that asks for Name, Sources folder, Questions (New database by default), and no Notes choice',
  '1.2': 'New Subject… is in Study\'s sidebar menu',
  '1.3': 'New Subject… is on Study\'s home',
  '1.4': 'the name is required: confirming without one makes no page and no database',
  '1.5': 'confirming makes a canvas page named after the subject, with the databases Units, Questions and Work Log under it',
  '1.6': 'Units has Order, Weight, Questions, Answered, Right Last Time (numbers) and Last Worked (date)',
  '1.7': 'Questions has Answer, Unit, Kind (Short, Essay), Source, Attempts, Correct, Last Result (Right, Partly, Wrong), Last Answered',
  '1.8': 'Work Log has Date (datetime), Minutes, Unit, Tool, Kind (Questions, Cards, Problems, Reading, Notes, Discussion), Items, Right, Confirmed (checkbox), Origin (App, Manual, Import)',
  '1.9': 'none of the three has a Status column',
  '1.10': 'a sources folder with subfolders: one unit per subfolder, in name order',
  '1.11': 'a sources folder of files: one unit per .pdf, .md, .markdown and .txt file, named without its extension, in name order',
  '1.12': 'no sources folder: the Units database is there and empty, and the subject is listed in the sidebar',
}, async (S, c) => {
  const ws = S.workspace;
  // The dialog.
  const has = await S.hasCommand('study.newSubject');
  if (has) S.run('study.newSubject');
  const open = has && (await until(() => S.formOpen(), 6000));
  await sleep(400);
  const fields = open ? { name: await S.field(F.name), folder: (await S.field(F.folder)) || (await S.find('form', /sources?|folder/i, 'button'))[0] || null, questions: await S.field(F.questions), notes: await S.field(F.notes) } : {};
  await S.shot('01-new-subject-dialog');
  c('1.1', !!open && !!fields.name && !!fields.folder && !!fields.questions && !fields.notes && /new database/i.test(fields.questions.value), { command: has, dialog: !!open, name: !!fields.name, folder: !!fields.folder, questions: fields.questions ? fields.questions.value : null, notes: !!fields.notes });
  // No name.
  if (open) {
    const before = databases(ws).length + coreAll(ws, 'SELECT COUNT(*) AS n FROM pages')[0].n;
    const pressed = await pressConfirm(S);
    await sleep(1500);
    const after = databases(ws).length + coreAll(ws, 'SELECT COUNT(*) AS n FROM pages')[0].n;
    c('1.4', after === before && !coreAll(ws, "SELECT 1 FROM pages WHERE title IN ('Units', 'Work Log')").length, { confirmWasPressable: !!pressed, pagesAndDatabasesBefore: before, after, dialogStillOpen: await S.formOpen() });
    if (await S.formOpen()) { (await S.press('form', /^cancel$/i, 'button')) || (await S.page.keyboard.press('Escape')); await sleep(500); }
  }
  // Where else it is offered.
  await showStudySidebar(S);
  let inMenu = (await S.find('sidebar', /^New Subject(…|\.\.\.)?$/i))[0] ? 'a button in the sidebar' : '';
  for (const opener of inMenu ? [] : [/^More Actions/i, /^(Add|New)\b/i]) {
    for (const b of (await S.find('sidebar', opener)).concat(await S.find('body', opener, '.part-sidebar button, [data-part-id="workbench.parts.sidebar"] button')).slice(0, 4)) {
      await S.click(b); await sleep(450);
      const item = (await S.find('body', /^New Subject(…|\.\.\.)?$/i, MENU_ITEMS))[0];
      await S.page.keyboard.press('Escape'); await sleep(200);
      if (item) { inMenu = `${b.name}: ${item.name}`; break; }
    }
    if (inMenu) break;
  }
  c('1.2', !!inMenu, inMenu || 'no New Subject… in the Study sidebar, its More Actions or its add menu');
  await S.cmd('study.open');
  await sleep(1200);
  const home = (await S.find('root', /^New Subject(…|\.\.\.)?$/i))[0];
  await S.shot('01-study-home');
  c('1.3', !!home, home ? home.name : `Study's home shows: ${norm(await S.text('root')).slice(0, 160)}`);
  // A subject from a folder of subfolders.
  await newSubject(S, { name: 'Exam 7', folder: path.join(ws, NESTED) });
  const s1 = await waitSubject(S, 'Exam 7');
  c('1.5', !!s1 && !!s1.questions, s1 ? { page: s1.page.title, under: s1.under.map((d) => d.title) } : { page: pagesTitled(ws, 'Exam 7').length, databases: databases(ws).map((d) => d.title) });
  if (!s1) return;
  const uc = columns(ws, s1.units.id); const qc = s1.questions ? columns(ws, s1.questions.id) : []; const lc = columns(ws, s1.log.id);
  console.log(`   columns: Units [${uc.map((x) => `${x.name}:${x.type}`).join(', ')}] Questions [${qc.map((x) => `${x.name}:${x.type}`).join(', ')}] Work Log [${lc.map((x) => `${x.name}:${x.type}`).join(', ')}]`);
  c('1.6', typesOk(uc, UNITS_WANT).length === 0, typesOk(uc, UNITS_WANT));
  const qBad = [...typesOk(qc, QUESTIONS_WANT), ...hasAll(optionsOf(col(qc, 'Kind')), ['Short', 'Essay']).map((o) => `Kind lacks ${o}`), ...hasAll(optionsOf(col(qc, 'Last Result')), ['Right', 'Partly', 'Wrong']).map((o) => `Last Result lacks ${o}`)];
  c('1.7', !!s1.questions && qBad.length === 0, qBad);
  const lBad = [...typesOk(lc, LOG_WANT), ...hasAll(optionsOf(col(lc, 'Kind')), ['Questions', 'Cards', 'Problems', 'Reading', 'Notes', 'Discussion']).map((o) => `Kind lacks ${o}`), ...hasAll(optionsOf(col(lc, 'Origin')), ['App', 'Manual', 'Import']).map((o) => `Origin lacks ${o}`)];
  c('1.8', lBad.length === 0, lBad);
  c('1.9', !!s1.questions && ![...uc, ...qc, ...lc].some((x) => /^status$/i.test(norm(x.name)) || x.type === 'status'), { units: uc.map((x) => x.name), questions: qc.map((x) => x.name), log: lc.map((x) => x.name) });
  const inOrder = (rows) => [...rows].sort((a, b) => num(a.values.Order) - num(b.values.Order) || a.sort - b.sort).map((r) => r.title);
  const u1 = await until(() => { const r = rowsOf(ws, s1.units.id); return r.length >= NESTED_UNITS.length ? r : null; }, 8000) || rowsOf(ws, s1.units.id);
  c('1.10', JSON.stringify(inOrder(u1)) === JSON.stringify(NESTED_UNITS) && JSON.stringify(u1.map((r) => r.title)) === JSON.stringify(NESTED_UNITS), { units: u1.map((r) => [r.title, r.values.Order]) });
  // A subject from a folder of files.
  await newSubject(S, { name: 'GLMs', folder: path.join(ws, FLAT) });
  const s2 = await waitSubject(S, 'GLMs');
  const u2 = s2 ? (await until(() => { const r = rowsOf(ws, s2.units.id); return r.length >= FLAT_UNITS.length ? r : null; }, 8000) || rowsOf(ws, s2.units.id)) : [];
  c('1.11', !!s2 && JSON.stringify(u2.map((r) => r.title)) === JSON.stringify(FLAT_UNITS) && JSON.stringify(inOrder(u2)) === JSON.stringify(FLAT_UNITS), { units: u2.map((r) => [r.title, r.values.Order]) });
  // A subject with no folder.
  await newSubject(S, { name: 'Bare Subject' });
  const s3 = await waitSubject(S, 'Bare Subject');
  await showStudySidebar(S);
  const listed = await until(async () => { const t = await subjectsText(S); return t && ['Exam 7', 'GLMs', 'Bare Subject'].every((n) => t.includes(n)) ? t : null; }, 6000);
  await S.shot('01-three-subjects');
  c('1.12', !!s3 && rowsOf(ws, s3.units.id).length === 0 && !!listed, { made: !!s3, unitRows: s3 ? rowsOf(ws, s3.units.id).length : null, subjectsInSidebar: (await subjectsText(S)) ?? 'no Subjects section' });
});

phase(2, 'An existing database as the questions', 'plain', {
  '2.1': 'choosing an existing database as the Questions shows a mapping step for Answer, Unit, Attempts, Correct, Last Result and Last Answered',
  '2.2': 'the guesses from the column names: Model Answer, Paper, Times Attempted, Times Correct, Last Result',
  '2.3': 'a role with no matching column (Last Answered) offers "Add a column"',
  '2.4': 'a guess can be changed, and changed back, on the mapping step',
  '2.5': 'there is no Notes field to choose a database in (notes are attached to units)',
  '2.6': 'adoption copies, moves and renames nothing: the same rows, titles, order, place and values, and no second Questions database',
  '2.7': 'only a missing column is added: his columns are as they were and a Last Answered date column is new',
  '2.8': 'Units gets one row per distinct value of the Unit column, with its Questions, Answered and Right Last Time from the history',
  '2.9': 'the sidebar lists the subject\'s units with "answered of total" from the history already in the database',
}, async (S, c) => {
  const ws = S.workspace;
  const { bank, notes } = await seedBank(S);
  const before = fingerprint(ws, bank); const colsBefore = columns(ws, bank); const rowsBefore = rowsOf(ws, bank);
  const notesBefore = fingerprint(ws, notes);
  await openNewSubject(S);
  const nameField = must(await S.field(F.name), 'the Name field');
  await S.click(nameField); await S.page.keyboard.type(SUBJECT);
  const picked = await chooseIn(S, F.questions, exact(BANK));
  const notesPicked = await chooseIn(S, F.notes, exact(NOTES_DB));
  // New Subject has no Notes choice (owner, 2026-11-22: notes are attached to units from any layout).
  c('2.5', !notesPicked.ok && notesPicked.why === 'no such field', notesPicked);
  if (!(await S.field(MAP.answer))) { await pressConfirm(S); await until(() => S.field(MAP.answer), 5000); }
  await sleep(400);
  const shown = {}; for (const [k, re] of Object.entries(MAP)) shown[k] = await S.field(re);
  await S.shot('02-mapping-step');
  c('2.1', picked.ok && Object.values(shown).every(Boolean), { chosen: picked, fields: Object.fromEntries(Object.entries(shown).map(([k, f]) => [k, !!f])) });
  const guess = Object.fromEntries(Object.entries(shown).map(([k, f]) => [k, f ? f.value : null]));
  c('2.2', exact('Model Answer').test(guess.answer ?? '') && exact('Paper').test(guess.unit ?? '') && exact('Times Attempted').test(guess.attempts ?? '') && exact('Times Correct').test(guess.correct ?? '') && exact('Last Result').test(guess.lastResult ?? ''), guess);
  if (!shown.answer) throw new Error('no mapping step to go on from');
  const addOffered = /add a column/i.test(guess.lastAnswered ?? '') ? { ok: true, shown: guess.lastAnswered } : await chooseIn(S, MAP.lastAnswered, /^add a column/i);
  c('2.3', addOffered.ok, addOffered);
  const toRemarks = await chooseIn(S, MAP.answer, exact('Remarks'));
  const afterChange = (await S.field(MAP.answer))?.value;
  const back = await chooseIn(S, MAP.answer, exact('Model Answer'));
  const afterBack = (await S.field(MAP.answer))?.value;
  c('2.4', toRemarks.ok && exact('Remarks').test(afterChange ?? '') && back.ok && exact('Model Answer').test(afterBack ?? ''), { afterChange, afterBack });
  must(await pressConfirm(S), 'a button to confirm the mapping');
  await until(async () => !(await S.formOpen()), 8000);
  const subj = must(await waitSubject(S, SUBJECT), `the page "${SUBJECT}" with Units and Work Log under it`);
  await sleep(1500);
  const colsAfter = columns(ws, bank); const rowsAfter = rowsOf(ws, bank);
  const oldIds = new Set(colsBefore.map((x) => x.id));
  const strip = (rows) => JSON.stringify(rows.map((r) => [r.pageId, r.title, r.parentId, r.sort, Object.entries(r.raw).filter(([id]) => oldIds.has(id)).sort()]));
  const pageSame = JSON.stringify(JSON.parse(before).page) === JSON.stringify(coreAll(ws, 'SELECT title, parent_id, is_archived FROM pages WHERE id = ?', [bank])[0]);
  c('2.6', strip(rowsAfter) === strip(rowsBefore) && pageSame && !subj.questions && databases(ws).filter((d) => norm(d.title) === BANK).length === 1 && fingerprint(ws, notes) === notesBefore,
    { rowsBefore: rowsBefore.length, rowsAfter: rowsAfter.length, rowsIdentical: strip(rowsAfter) === strip(rowsBefore), databasePageSame: pageSame, secondQuestionsDatabase: !!subj.questions, notesDatabaseSame: fingerprint(ws, notes) === notesBefore });
  const kept = colsBefore.every((b) => { const a = colsAfter.find((x) => x.id === b.id); return a && a.name === b.name && a.type === b.type && JSON.stringify(optionsOf(a)) === JSON.stringify(optionsOf(b)); });
  const added = colsAfter.filter((x) => !oldIds.has(x.id));
  c('2.7', kept && added.some((x) => /^last answered$/i.test(norm(x.name)) && x.type === 'date') && !added.some((x) => /^(status|answer|unit|attempts|correct)$/i.test(norm(x.name))), { hisColumnsAsTheyWere: kept, added: added.map((x) => `${x.name}:${x.type}`) });
  const units = await until(() => { const r = rowsOf(ws, subj.units.id); return r.length >= 3 && r.every((u) => u.values.Questions !== undefined) ? r : null; }, 8000) || rowsOf(ws, subj.units.id);
  const unitOk = Object.entries(SEED_UNITS).every(([name, w]) => { const u = units.find((r) => norm(r.title) === name); return u && num(u.values.Questions) === w.total && num(u.values.Answered) === w.answered && num(u.values['Right Last Time']) === w.right; });
  c('2.8', units.length === 3 && unitOk, units.map((u) => [u.title, u.values.Questions, u.values.Answered, u.values['Right Last Time']]));
  await showStudySidebar(S);
  const counts = await until(async () => { const got = await countsOf(S, Object.keys(SEED_UNITS)); return sameCounts(got, SEED_UNITS) ? got : null; }, 8000);
  await S.shot('02-adopted-in-sidebar');
  c('2.9', !!counts, counts ?? { sidebar: (await subjectsText(S)) ?? 'no Subjects section' });
});

phase(3, 'The subject in the sidebar', 'adopted', {
  '3.1': 'the sidebar has a Subjects section that lists the subject, and under it each unit with "answered of total"',
  '3.2': 'Open Units opens the Units database',
  '3.3': 'Open Questions opens the database used as the questions',
  '3.4': 'Open Work Log opens the Work Log database',
  '3.5': 'Study… starts a session over the subject\'s questions',
  '3.6': 'Remove Subject… asks first, and Cancel keeps the subject',
  '3.7': 'Remove Subject… confirmed takes the subject out of Study and leaves the page, the databases, every row and every value as they were',
}, async (S, c, A) => {
  const ws = S.workspace;
  await showStudySidebar(S);
  const counts = await until(async () => { const got = await countsOf(S, Object.keys(SEED_UNITS)); return sameCounts(got, SEED_UNITS) ? got : null; }, 8000);
  const text = await subjectsText(S);
  await S.shot('03-subjects-section');
  c('3.1', !!counts && !!text && text.includes(SUBJECT), text ?? 'no Subjects section');
  const opens = async (label, dbId) => {
    const how = await subjectAction(S, SUBJECT, label);
    const open = how && (await until(() => S.page.evaluate((dbId) => { const t = window.__ap.tableState(dbId); return t && (document.querySelector('.ui-tab--active')?.getAttribute('data-tab-id') || '').endsWith(dbId) ? t : null; }, dbId), 6000));
    return { how: how || 'no such action on the subject', opened: !!open, heads: open ? open.heads : null };
  };
  const o1 = await opens('Open Units', A.units); c('3.2', o1.opened, o1);
  const o2 = await opens('Open Questions', A.bank); c('3.3', o2.opened && (o2.heads || []).includes('Model Answer'), o2);
  const o3 = await opens('Open Work Log', A.log); c('3.4', o3.opened, o3);
  const how = await subjectAction(S, SUBJECT, 'Study…');
  const card = how ? await cardAfter(S, 5000) : null;
  await S.shot('03-study-all');
  c('3.5', !!card && !!seededRow(card.stem), { how: how || 'no Study… on the subject', firstQuestion: card ? card.stem : null });
  await closeStudyTabs(S);
  const before = [A.bank, A.units, A.log, A.notes].map((id) => fingerprint(ws, id)).join('\n');
  const pagesBefore = coreAll(ws, 'SELECT COUNT(*) AS n FROM pages WHERE is_archived = 0')[0].n;
  const ask1 = await subjectAction(S, SUBJECT, 'Remove Subject…');
  const asked = ask1 && (await until(() => S.has('body', '.parallx-modal-box, [role="dialog"]'), 4000));
  await S.shot('03-remove-asks');
  if (asked) { (await S.press('body', /^cancel$/i, '.parallx-modal-box button, [role="dialog"] button')) || (await S.page.keyboard.press('Escape')); await sleep(700); }
  const still = (await subjectsText(S)) || '';
  c('3.6', !!asked && still.includes(SUBJECT), { how: ask1 || 'no Remove Subject… on the subject', asked: !!asked, stillListed: still.includes(SUBJECT) });
  if (!asked) { c('3.7', false, 'Remove Subject… never asked'); return; }
  await subjectAction(S, SUBJECT, 'Remove Subject…');
  await until(() => S.has('body', '.parallx-modal-box, [role="dialog"]'), 4000);
  const yes = await S.press('body', /^(remove|remove subject)\b/i, '.parallx-modal-box button, [role="dialog"] button');
  const gone = await until(async () => { const t = await subjectsText(S); return !t || !t.includes(SUBJECT); }, 6000);
  await sleep(800);
  const after = [A.bank, A.units, A.log, A.notes].map((id) => fingerprint(ws, id)).join('\n');
  c('3.7', !!yes && !!gone && after === before && pagesTitled(ws, SUBJECT).length === 1 && coreAll(ws, 'SELECT COUNT(*) AS n FROM pages WHERE is_archived = 0')[0].n === pagesBefore,
    { confirmed: !!yes, goneFromSidebar: !!gone, databasesIdentical: after === before, pageStillThere: pagesTitled(ws, SUBJECT).length === 1 });
});

/** The bank's row for a stem, with the mapped columns read by their own names. */
function bankRow(ws, bankId, stem) {
  const r = rowTitled(ws, bankId, stem);
  return r ? { pageId: r.pageId, title: r.title, attempts: num(r.values['Times Attempted']), correct: num(r.values['Times Correct']), last: r.values['Last Result'] ?? null, answered: r.values['Last Answered'] ?? null, answer: r.values['Model Answer'], paper: r.values.Paper } : null;
}
const settle = async (fn, ms = 4000) => (await until(fn, ms, 100)) || fn();

phase(4, 'Study a unit', 'adopted', {
  '4.1': 'activating a unit in the sidebar starts a session whose first question is one of that unit\'s rows',
  '4.2': 'the whole session asks that unit\'s questions and no other: each of its four once, then it ends',
  '4.3': 'Previous shows the question before as it was answered, and Next returns',
  '4.4': 'an answered question from the database has Mark…, Mark as Right / Wrong and Discuss in Chat',
}, async (S, c, A) => {
  const mine = SEED.filter((r) => r[0] === 'Mack').map((r) => norm(r[1]));
  let card = await studyUnit(S, SUBJECT, 'Mack');
  await S.shot('04-unit-session');
  c('4.1', mine.includes(card.stem), { firstQuestion: card.stem });
  const seen = [];
  let controls = null; let prevOk = null;
  for (let i = 0; i < 8 && card !== 'end' && card; i++) {
    seen.push(card.stem);
    const row = seededRow(card.stem);
    await answer(S, card, row ? row[2] : WRONG);
    if (i === 0) controls = { mark: (await S.find('root', /^mark(ed)?\b(?!.*(right|wrong))/i)).length > 0, markRight: (await S.find('root', OVERRULE)).length > 0, discuss: (await S.find('root', /discuss.{0,12}chat/i)).length > 0 };
    const next = await pressNext(S, card.stem);
    if (i === 0 && next && next !== 'end') {
      const prev = await S.press('root', /^Previous\b/, 'button');
      const shownPrev = prev && (await until(async () => { const x = await S.card(); return x && x.stem === seen[0] && x.verdict ? x : null; }, 4000));
      const again = shownPrev && (await S.press('root', /^Next\b/, 'button')) && (await until(async () => { const x = await S.card(); return x && x.stem === next.stem ? x : null; }, 4000));
      prevOk = { previousShowsTheFirstWithItsVerdict: !!shownPrev, nextReturns: !!again };
    }
    card = next;
  }
  c('4.2', card === 'end' && seen.length === 4 && [...seen].sort().join('|') === [...mine].sort().join('|'), { asked: seen, ended: card === 'end' });
  c('4.3', !!prevOk && prevOk.previousShowsTheFirstWithItsVerdict && prevOk.nextReturns, prevOk ?? 'there was no second question to come back from');
  c('4.4', !!controls && controls.mark && controls.markRight && controls.discuss, controls);
});

phase(5, 'Results go back to the row', 'adopted', {
  '5.1': 'answered right: the row\'s Attempts and Correct go up by one, Last Result is the database\'s own word for right, Last Answered is today',
  '5.2': 'answered wrong: Attempts goes up by one, Correct stays, Last Result is the database\'s own word for wrong',
  '5.3': 'Mark as Right over the grader: Correct goes up, Last Result turns right, Attempts is not counted again',
  '5.4': 'Mark as Wrong over the grader: Correct goes back down, Last Result turns wrong, Attempts is not counted again',
  '5.5': 'no other row and no other column of his changed',
  '5.6': 'the unit\'s row in Units follows: Questions, Answered, Right Last Time and Last Worked today',
  '5.7': 'the sidebar\'s "answered of total" for the unit follows',
}, async (S, c, A) => {
  const ws = S.workspace;
  const row = (stem) => bankRow(ws, A.bank, stem);
  const others = () => JSON.stringify(rowsOf(ws, A.bank).filter((r) => r.values.Paper !== 'Mack').map((r) => [r.pageId, r.title, r.values]));
  const remarks = () => JSON.stringify(rowsOf(ws, A.bank).map((r) => [r.pageId, r.title, r.values.Remarks ?? null, r.values['Model Answer'], r.values.Paper]));
  const others0 = others(); const remarks0 = remarks();
  // Right.
  let card = await studyUnit(S, SUBJECT, 'Mack');
  const a0 = must(row(card.stem), 'the first question\'s row'); const aStem = card.stem;
  await answer(S, card, a0.answer);
  const a1 = await settle(() => { const r = row(aStem); return r.attempts === a0.attempts + 1 ? r : null; });
  c('5.1', !!a1 && a1.attempts === a0.attempts + 1 && a1.correct === a0.correct + 1 && a1.last === 'Correct' && isToday(a1.answered), { before: a0, after: a1 ?? row(aStem) });
  // Wrong, then he says right.
  card = must(await pressNext(S, aStem), 'a second question'); if (card === 'end') throw new Error('the session ended after one question');
  const b0 = must(row(card.stem), 'the second question\'s row'); const bStem = card.stem;
  await answer(S, card, WRONG);
  const b1 = await settle(() => { const r = row(bStem); return r.attempts === b0.attempts + 1 ? r : null; });
  c('5.2', !!b1 && b1.attempts === b0.attempts + 1 && b1.correct === b0.correct && b1.last === 'Incorrect' && isToday(b1.answered), { before: b0, after: b1 ?? row(bStem) });
  const how1 = await overrule(S, 'right');
  const b2 = await settle(() => { const r = row(bStem); return r.last === 'Correct' ? r : null; });
  c('5.3', !!how1 && !!b2 && b2.attempts === b0.attempts + 1 && b2.correct === b0.correct + 1 && b2.last === 'Correct', { how: how1 || 'no Mark as Right on the card', before: b0, after: b2 ?? row(bStem) });
  // Right, then he says wrong.
  card = must(await pressNext(S, bStem), 'a third question'); if (card === 'end') throw new Error('the session ended after two questions');
  const c0 = must(row(card.stem), 'the third question\'s row'); const cStem = card.stem;
  await answer(S, card, c0.answer);
  await settle(() => { const r = row(cStem); return r.correct === c0.correct + 1 ? r : null; });
  const how2 = await overrule(S, 'wrong');
  const c2 = await settle(() => { const r = row(cStem); return r.last === 'Incorrect' ? r : null; });
  await S.shot('05-overruled');
  c('5.4', !!how2 && !!c2 && c2.attempts === c0.attempts + 1 && c2.correct === c0.correct && c2.last === 'Incorrect', { how: how2 || 'no Mark as Wrong on the card', before: c0, after: c2 ?? row(cStem) });
  c('5.5', others() === others0 && remarks() === remarks0, { otherUnitsRowsSame: others() === others0, hisOtherColumnsSame: remarks() === remarks0 });
  // The unit follows: of Mack's four, how many have an attempt and how many were right last time, counted from the bank's own rows.
  const mack = rowsOf(ws, A.bank).filter((r) => r.values.Paper === 'Mack');
  const want = { total: mack.length, answered: mack.filter((r) => num(r.values['Times Attempted']) > 0).length, right: mack.filter((r) => r.values['Last Result'] === 'Correct').length };
  const unit = await settle(() => { const u = rowTitled(ws, A.units, 'Mack'); return u && num(u.values.Answered) === want.answered && num(u.values['Right Last Time']) === want.right && isToday(u.values['Last Worked']) ? u : null; });
  c('5.6', !!unit && num(unit.values.Questions) === want.total && want.answered > SEED_UNITS.Mack.answered, { want, units: unit ? unit.values : rowTitled(ws, A.units, 'Mack')?.values ?? null });
  const side = await until(async () => { const u = unitCount(await subjectsText(S), 'Mack'); return u && u.answered === want.answered && u.total === want.total ? u : null; }, 5000);
  c('5.7', !!side && want.answered > SEED_UNITS.Mack.answered, side ?? { want, sidebar: (await subjectsText(S)) ?? 'no Subjects section' });
});

phase(51, 'Results in a new database\'s words, and in a checkbox', 'plain', {
  '5.8': 'a new Questions database: rows added in the database are asked, and an answer writes Attempts, Correct, Last Result Right or Wrong and Last Answered',
  '5.9': 'a guess changed on the mapping step is the column Study uses, and a checkbox mapped as Last Result is checked when right and unchecked when wrong',
}, async (S, c) => {
  const ws = S.workspace;
  // A new database, filled in the database.
  await newSubject(S, { name: 'GLMs' });
  const s = must(await waitSubject(S, 'GLMs'), 'the subject GLMs'); must(s.questions, 'its Questions database');
  await S.tool('canvas_add_database_row', { databaseId: s.units.id, title: 'Link Functions', values: { Order: 1 } });
  const unitRow = must(rowTitled(ws, s.units.id, 'Link Functions'), 'the unit row added in the Units database');
  const unitCol = must(col(columns(ws, s.questions.id), 'Unit'), 'the Unit column of Questions');
  const unitValue = unitCol.type === 'relation' ? [unitRow.pageId] : unitCol.type === 'tags' ? ['Link Functions'] : 'Link Functions';
  const QA = [['Why use a log link for claim counts 401?', 'Predictions remain positive while effects become multiplicative.'], ['What does the canonical link simplify 402?', 'Sufficient statistics arise making estimation equations simpler.']];
  for (const [q, a] of QA) await S.tool('canvas_add_database_row', { databaseId: s.questions.id, title: q, values: { Answer: a, Unit: unitValue, Kind: 'Short' } });
  await showStudySidebar(S);
  must(await until(async () => { const u = unitCount(await subjectsText(S), 'Link Functions'); return u && u.total === 2 ? u : null; }, 8000), `"Link Functions 0 of 2" in the sidebar (it shows: ${(await subjectsText(S)) ?? 'no Subjects section'})`);
  let card = await studyUnit(S, 'GLMs', 'Link Functions');
  const first = card.stem; const firstQA = must(QA.find(([q]) => norm(q) === first), `a question from the database on the card (it shows "${first}")`);
  await answer(S, card, firstQA[1]);
  card = await pressNext(S, first);
  const second = card && card !== 'end' ? card.stem : null;
  if (second) await answer(S, card, WRONG);
  const r1 = await settle(() => { const r = rowTitled(ws, s.questions.id, first); return r && num(r.values.Attempts) === 1 ? r : null; });
  const r2 = second ? await settle(() => { const r = rowTitled(ws, s.questions.id, second); return r && num(r.values.Attempts) === 1 ? r : null; }) : null;
  c('5.8', !!r1 && !!r2 && num(r1.values.Correct) === 1 && r1.values['Last Result'] === 'Right' && isToday(r1.values['Last Answered']) && num(r2.values.Correct) === 0 && r2.values['Last Result'] === 'Wrong' && r1.values.Kind === 'Short',
    { right: r1 ? r1.values : null, wrong: r2 ? r2.values : null });
  await closeStudyTabs(S);
  // A database whose result is a checkbox, with columns no guess could name.
  const cb = await seedDatabase(S, 'Checkbox Bank', [{ name: 'Solution', type: 'text' }, { name: 'Decoy', type: 'text' }, { name: 'Topic', type: 'select', options: ['Offsets'] }, { name: 'Tries', type: 'number' }, { name: 'Wins', type: 'number' }, { name: 'Got It', type: 'checkbox' }],
    [{ title: 'What is an offset in a rate model 501?', values: { Solution: 'Exposure enters through logarithm having coefficient fixed.', Decoy: 'Nothing whatever belongs inside here.', Topic: 'Offsets', 'Got It': true } },
      { title: 'When would an offset carry prior factors 502?', values: { Solution: 'Existing relativities stay untouched during refitting others.', Decoy: 'Nothing whatever belongs inside here.', Topic: 'Offsets' } }]);
  await newSubject(S, { name: 'Offsets Course', questions: 'Checkbox Bank', mapping: async () => {
    for (const [re, to] of [[MAP.answer, 'Solution'], [MAP.unit, 'Topic'], [MAP.attempts, 'Tries'], [MAP.correct, 'Wins'], [MAP.lastResult, 'Got It']]) { const r = await chooseIn(S, re, exact(to)); if (!r.ok) throw new Error(`"${to}" could not be chosen on the mapping step: ${JSON.stringify(r)}`); }
  } });
  must(await waitSubject(S, 'Offsets Course'), 'the subject Offsets Course');
  card = await studyUnit(S, 'Offsets Course', 'Offsets');
  const got = {};
  for (let i = 0; i < 2 && card && card !== 'end'; i++) {
    const stem = card.stem; const r0 = must(rowTitled(ws, cb, stem), 'the card\'s row in the Checkbox Bank');
    const right = /502/.test(stem); // the one unchecked before is answered right, the one checked before wrong
    await answer(S, card, right ? r0.values.Solution : WRONG);
    got[right ? 'right' : 'wrong'] = (await settle(() => { const r = rowTitled(ws, cb, stem); return r && num(r.values.Tries) === 1 ? r : null; }))?.values ?? rowTitled(ws, cb, stem)?.values;
    card = await pressNext(S, stem);
  }
  c('5.9', !!got.right && !!got.wrong && checked(got.right['Got It']) && num(got.right.Wins) === 1 && num(got.right.Tries) === 1 && !checked(got.wrong['Got It']) && num(got.wrong.Wins) === 0 && num(got.wrong.Tries) === 1, got);
});

phase(6, 'The database is the record', 'adopted', {
  '6.1': 'a row added in the database is counted in the sidebar without a reload',
  '6.2': 'a title edited in the table is the wording the next session asks, and the old wording is not asked',
  '6.3': 'an Answer edited in the table is the answer the next session grades against',
  '6.4': 'a row deleted in the table is no longer asked, and the sidebar\'s total follows',
  '6.5': 'Attempts edited by hand is respected: an answer adds one to what is there',
  '6.6': 'the sidebar\'s "answered" follows a hand edit of Attempts without a reload',
  '6.7': 'the added row is asked in the next session',
}, async (S, c, A) => {
  const ws = S.workspace;
  const F4 = SEED.filter((r) => r[0] === 'Friedland');
  const ADDED = ['Which method blends expected and reported claims 304?', 'Bornhuetter Ferguson combines expectation alongside emerged development.'];
  const NEW_TITLE = 'In his own words: when is expected claims the right technique 9301?';
  const NEW_ANSWER = 'Whenever history offers nothing credible regarding newer business.';
  await showStudySidebar(S);
  must(await until(async () => unitCount(await subjectsText(S), 'Friedland'), 6000), 'Friedland with its count in the sidebar');
  // Added (by the chat's tool, as a row with values), edited and deleted in the table.
  await S.tool('canvas_add_database_row', { databaseId: A.bank, title: ADDED[0], values: { 'Model Answer': ADDED[1], Paper: 'Friedland' } });
  const added = await until(async () => { const u = unitCount(await subjectsText(S), 'Friedland'); return u && u.total === 4 ? u : null; }, 6000);
  c('6.1', !!added, added ?? (await subjectsText(S)));
  must(await openDb(S, A.bank), 'the questions database open in the app');
  must(await editCell(S, A.bank, F4[0][1], 'Name', NEW_TITLE), 'an editor on the row\'s name');
  must(await editCell(S, A.bank, F4[1][1], 'Model Answer', NEW_ANSWER), 'an editor on the Model Answer cell');
  await deleteRow(S, A.bank, F4[2][1]);
  must(await editCell(S, A.bank, F4[1][1], 'Times Attempted', '40'), 'an editor on the Times Attempted cell');
  await S.shot('06-edited-in-the-table');
  // What the file holds now is what was done in the table (the precondition of the checks below).
  const now = rowsOf(ws, A.bank).filter((r) => r.values.Paper === 'Friedland');
  must(now.length === 3 && now.some((r) => r.title === NEW_TITLE) && now.some((r) => r.values['Model Answer'] === NEW_ANSWER && num(r.values['Times Attempted']) === 40), `the table edits in the workspace file (${JSON.stringify(now.map((r) => [r.title.slice(0, 30), r.values['Times Attempted']]))})`);
  const side = await until(async () => { const u = unitCount(await subjectsText(S), 'Friedland'); return u && u.total === 3 && u.answered === 1 ? u : null; }, 6000);
  c('6.6', !!side, side ?? (await subjectsText(S)));
  // The next session, in the same run of the app.
  let card = await studyUnit(S, SUBJECT, 'Friedland');
  const asked = []; let graded = null; let hand = null;
  for (let i = 0; i < 6 && card && card !== 'end'; i++) {
    const stem = card.stem; asked.push(stem);
    if (stem === norm(F4[1][1])) {
      const v = await answer(S, card, NEW_ANSWER);
      graded = { verdictClass: v.fbClass, verdict: v.verdict };
      hand = await settle(() => { const r = bankRow(ws, A.bank, stem); return r && r.attempts !== 40 ? r : null; });
    } else await answer(S, card, WRONG);
    card = await pressNext(S, stem);
  }
  await S.shot('06-next-session');
  c('6.2', asked.includes(norm(NEW_TITLE)) && !asked.includes(norm(F4[0][1])), { asked });
  c('6.3', !!graded && /st-fb--ok/.test(graded.verdictClass) && !!hand && hand.correct === 1 && hand.last === 'Correct', { graded, row: hand });
  c('6.4', asked.length > 0 && !asked.includes(norm(F4[2][1])) && !!side && side.total === 3, { asked, sidebarTotal: side ? side.total : null });
  c('6.5', !!hand && hand.attempts === 41, hand ?? 'the edited question was not asked');
  c('6.7', asked.includes(norm(ADDED[0])), { asked });
});

/** The session resumed from its row in the sidebar: its first question not yet answered (or 'end'). */
async function resumeSession(S) {
  await showStudySidebar(S);
  must(await until(() => S.press('sidebar', /./, '.st-sb__it--session'), 5000), 'the session\'s row in the sidebar');
  let card = must(await waitCard(S, 10_000), 'the resumed session\'s question');
  for (let i = 0; i < 6 && card && card !== 'end' && card.verdict; i++) card = await pressNext(S, card.stem);
  return card;
}

phase(7, 'One Work Log row per session', 'adopted', {
  '7.1': 'a session left with two answers and closed has one Work Log row: Tool Study, Kind Questions, Items 2, Right 1, Confirmed, Origin App',
  '7.2': 'the row says when the session started, at least 1 minute, and the unit worked',
  '7.3': 'resuming that session and answering more updates the same row: still one row, Items 3',
  '7.4': 'finishing the session leaves that one row, with Items 4',
  '7.5': 'a session opened and closed with no answer adds no row',
}, async (S, c, A) => {
  const ws = S.workspace;
  const log = () => rowsOf(ws, A.log);
  must(log().length === 0, 'an empty Work Log to start from');
  // Two answers on Mack (one right, one wrong), then the tab is closed.
  const t0 = Date.now();
  let card = await studyUnit(S, SUBJECT, 'Mack');
  let stem = card.stem;
  await answer(S, card, must(seededRow(stem), 'the card\'s seeded row')[2]);
  card = must(await pressNext(S, stem), 'a second question'); stem = card.stem;
  await answer(S, card, WRONG);
  await sleep(500);
  await closeStudyTabs(S);
  const t1 = Date.now();
  const one = await until(() => { const r = log(); return r.length && num(r[r.length - 1].values.Items) === 2 ? r : null; }, 6000) || log();
  const w = one[one.length - 1]?.values ?? {};
  await openDb(S, A.log); await S.shot('07-work-log');
  c('7.1', one.length === 1 && w.Tool === 'Study' && w.Kind === 'Questions' && num(w.Items) === 2 && num(w.Right) === 1 && checked(w.Confirmed) && w.Origin === 'App', { rows: one.length, row: w });
  const started = Date.parse(String(w.Date ?? ''));
  c('7.2', one.length === 1 && Number.isFinite(started) && started >= t0 - 120_000 && started <= t1 + 60_000 && num(w.Minutes) >= 1 && num(w.Minutes) <= 3 && unitNames(ws, w.Unit).includes('Mack'), { date: w.Date, sessionRanBetween: [new Date(t0).toISOString(), new Date(t1).toISOString()], minutes: w.Minutes, unit: unitNames(ws, w.Unit) });
  if (one.length !== 1) throw new Error('there is no single Work Log row to go on from');
  // Resumed from its row in the sidebar, one more answer, closed again.
  card = await resumeSession(S);
  if (card === 'end' || !card) throw new Error('the resumed session had no unanswered question');
  await answer(S, card, WRONG);
  await sleep(500);
  await closeStudyTabs(S);
  const two = await until(() => { const r = log(); return r.some((x) => num(x.values.Items) === 3) ? r : null; }, 6000) || log();
  c('7.3', two.length === 1 && two[0].pageId === one[0].pageId && num(two[0].values.Items) === 3 && num(two[0].values.Right) === 1, { rows: two.length, sameRow: two[0]?.pageId === one[0].pageId, row: two[0]?.values });
  // Finished.
  card = await resumeSession(S);
  if (card && card !== 'end') { stem = card.stem; await answer(S, card, must(seededRow(stem), 'the card\'s seeded row')[2]); card = await pressNext(S, stem); }
  const three = await until(() => { const r = log(); return r.some((x) => num(x.values.Items) === 4) ? r : null; }, 6000) || log();
  c('7.4', card === 'end' && three.length === 1 && three[0].pageId === one[0].pageId && num(three[0].values.Items) === 4 && num(three[0].values.Right) === 2, { ended: card === 'end', rows: three.length, row: three[0]?.values });
  // Opened and left untouched.
  await closeStudyTabs(S);
  await studyUnit(S, SUBJECT, 'Clark');
  await sleep(800);
  await closeStudyTabs(S);
  await sleep(2500);
  c('7.5', three.length === 1 && log().length === 1, { rowsBefore: three.length, rowsAfter: log().length });
});

phase(8, 'The columns Study keeps', 'adopted', {
  '8.1': 'a kept cell in Units (Answered) opens no editor when clicked, and the table marks it not editable',
  '8.2': 'the cell says it is kept by Study',
  '8.3': 'the same holds for Questions, Right Last Time and Last Worked, while Weight in the same table is his to edit',
  '8.4': 'the table\'s own command to set a cell does not change a kept value',
  '8.5': 'a kept column that is deleted comes back with its numbers recomputed, the next time the database changes',
  '8.6': 'a column of his that Study needs (Weight) comes back empty after it is deleted',
  '8.7': 'a deleted column Study needs is back when Study starts again',
}, async (S, c, A) => {
  const ws = S.workspace;
  must(await openDb(S, A.units), 'the Units database open in the app');
  const before = rowTitled(ws, A.units, 'Mack').values;
  const opened = await editCell(S, A.units, 'Mack', 'Answered', '99');
  if (opened) await sleep(600);
  const cell = await S.cell(A.units, 'Mack', 'Answered');
  await S.page.mouse.move(cell.x, cell.y); await sleep(700);
  await S.shot('08-kept-cell');
  c('8.1', !opened && !cell.editable && num(rowTitled(ws, A.units, 'Mack').values.Answered) === num(before.Answered), { editorOpened: opened, markedEditable: cell.editable, stored: rowTitled(ws, A.units, 'Mack').values.Answered });
  const tip = norm(await S.page.evaluate(() => Array.from(document.querySelectorAll('[role="tooltip"], .parallx-tooltip, .ui-tooltip')).filter(window.__ap.shown).map((n) => n.innerText).join(' ')));
  c('8.2', /kept by study/i.test(`${cell.says} | ${cell.headSays} | ${tip}`), { cellSays: cell.says, headerSays: cell.headSays, tooltip: tip });
  const rest = {};
  for (const k of ['Questions', 'Right Last Time', 'Last Worked']) { const x = await S.cell(A.units, 'Mack', k); const o = await editCell(S, A.units, 'Mack', k, '7'); if (o) await sleep(400); rest[k] = { editorOpened: o, says: /kept by study/i.test(`${x.says} | ${x.headSays}`) }; }
  const weightOpened = await editCell(S, A.units, 'Mack', 'Weight', '12');
  const weight = await settle(() => (num(rowTitled(ws, A.units, 'Mack').values.Weight) === 12 ? 12 : null));
  c('8.3', Object.values(rest).every((r) => !r.editorOpened && r.says) && weightOpened && weight === 12, { kept: rest, weightEditorOpened: weightOpened, weightStored: rowTitled(ws, A.units, 'Mack').values.Weight });
  const answeredCol = col(columns(ws, A.units), 'Answered'); const mackRow = rowTitled(ws, A.units, 'Mack');
  await S.cmd('database.setCell', mackRow.pageId, answeredCol.id, 77);
  await sleep(700);
  c('8.4', num(rowTitled(ws, A.units, 'Mack').values.Answered) === SEED_UNITS.Mack.answered, { stored: rowTitled(ws, A.units, 'Mack').values.Answered, want: SEED_UNITS.Mack.answered });
  // Deleted, then the questions database changes.
  const d1 = await deleteColumn(S, A.units, 'Answered');
  const d2 = await deleteColumn(S, A.units, 'Weight');
  const goneNow = { Answered: !col(columns(ws, A.units), 'Answered'), Weight: !col(columns(ws, A.units), 'Weight') };
  await S.tool('canvas_add_database_row', { databaseId: A.bank, title: 'A fifth Mack question 105?', values: { 'Model Answer': 'Residual plots against earlier cumulative amounts.', Paper: 'Mack', 'Times Attempted': 1, 'Times Correct': 1, 'Last Result': 'Correct' } });
  const back = await until(() => { const cs = columns(ws, A.units); const u = rowTitled(ws, A.units, 'Mack'); return col(cs, 'Answered') && col(cs, 'Weight') && u && num(u.values.Answered) === 3 ? u : null; }, 8000);
  const cs = columns(ws, A.units); const mack = rowTitled(ws, A.units, 'Mack');
  c('8.5', !!back && num(mack.values.Answered) === 3 && num(mack.values.Questions) === 5 && col(cs, 'Answered')?.type === 'number', { deleting: d1, wasGone: goneNow.Answered, columnBack: !!col(cs, 'Answered'), mack: mack?.values });
  c('8.6', d2 === 'deleted' && goneNow.Weight && !!col(cs, 'Weight') && (mack.values.Weight === undefined || mack.values.Weight === null || mack.values.Weight === ''), { deleting: d2, wasGone: goneNow.Weight, columnBack: !!col(cs, 'Weight'), weight: mack?.values.Weight ?? null });
  // Deleted, then Study starts.
  must(await openDb(S, A.units), 'the Units database open in the app');
  const d3 = await deleteColumn(S, A.units, 'Order');
  const goneOrder = !col(columns(ws, A.units), 'Order');
  await S.relaunch();
  const again = await until(() => col(columns(ws, A.units), 'Order'), 12_000);
  c('8.7', d3 === 'deleted' && goneOrder && !!again && again.type === 'number', { deleting: d3, wasGone: goneOrder, backAfterRestart: !!again });
});

phase(9, 'Study off, and on again', 'adopted', {
  '9.1': 'turning Study off changes nothing in the page, the databases, the rows or the values',
  '9.2': 'with Study off the questions database still opens and a cell can be edited',
  '9.3': 'with Study off a kept column and its values stay, and stay read-only, and the cell still says Study keeps it',
  '9.4': 'turned on again, the subject is back in the sidebar and its counts include what was edited while it was off',
}, async (S, c, A) => {
  const ws = S.workspace;
  await showStudySidebar(S);
  must(await until(async () => sameCounts(await countsOf(S, Object.keys(SEED_UNITS)), SEED_UNITS), 8000), `the subject with its counts before Study is turned off (${(await subjectsText(S)) ?? 'no Subjects section'})`);
  const all = () => [A.bank, A.units, A.log, A.notes].map((id) => fingerprint(ws, id)).join('\n') + JSON.stringify(coreAll(ws, 'SELECT id, title, parent_id, is_archived FROM pages ORDER BY id'));
  const before = all();
  const setStudy = (on) => S.page.evaluate(async (on) => { try { await window.__parallx_workbench__._services.get({ id: 'IToolEnablementService' }).setEnablement('parallx-community.study', on); return true; } catch (e) { return String(e); } }, on);
  must((await setStudy(false)) === true, 'Study turned off');
  await sleep(2500);
  c('9.1', all() === before && !(await S.hasCommand('study.open')), { identical: all() === before, studyCommandsGone: !(await S.hasCommand('study.open')) });
  const opened = await openDb(S, A.bank);
  const target = SEED[9][1]; // a Friedland question with no history
  const edited = opened && (await editCell(S, A.bank, target, 'Times Attempted', '2'));
  const stored = await settle(() => (num(rowTitled(ws, A.bank, target)?.values['Times Attempted']) === 2 ? 2 : null));
  c('9.2', !!opened && !!edited && stored === 2, { opened, editorOpened: edited, stored: rowTitled(ws, A.bank, target)?.values['Times Attempted'] ?? null });
  must(await openDb(S, A.units), 'the Units database open with Study off');
  const keptOpened = await editCell(S, A.units, 'Mack', 'Answered', '55');
  if (keptOpened) await sleep(500);
  const cell = await S.cell(A.units, 'Mack', 'Answered');
  await S.shot('09-study-off-kept-cell');
  c('9.3', !keptOpened && !cell.editable && /kept by study/i.test(`${cell.says} | ${cell.headSays}`) && num(rowTitled(ws, A.units, 'Mack').values.Answered) === SEED_UNITS.Mack.answered, { editorOpened: keptOpened, markedEditable: cell.editable, says: cell.says, stored: rowTitled(ws, A.units, 'Mack').values.Answered });
  must((await setStudy(true)) === true, 'Study turned on again');
  await S.page.waitForFunction(() => { try { return !!window.__parallx_workbench__._services.get({ id: 'ILanguageModelToolsService' }).getTool('study_results'); } catch { return false; } }, null, { timeout: 30_000 });
  await showStudySidebar(S);
  const want = { ...SEED_UNITS, Friedland: { total: 3, answered: 1 } };
  const counts = await until(async () => { const got = await countsOf(S, Object.keys(want)); return sameCounts(got, want) ? got : null; }, 10_000);
  await S.shot('09-study-on-again');
  c('9.4', !!counts, counts ?? { want, sidebar: (await subjectsText(S)) ?? 'no Subjects section' });
});

phase(10, 'Two thousand questions', 'plain', {
  '10.1': 'a database of 2,000 questions is taken in: Units has its 20 units, each with 100 questions and its answered count',
  '10.2': 'the sidebar shows the right counts for all 20 units within 60 s of New Subject being confirmed (the time is printed)',
  '10.3': 'an answer in that subject is written back to its row within 2 s (the time is printed)',
}, async (S, c) => {
  const ws = S.workspace;
  if (!(await S.hasCommand('study.newSubject'))) throw new Error('there is no command study.newSubject (the 2,000 rows were not seeded)');
  const papers = BIG_PAPERS;
  const tSeed = Date.now();
  const big = await seedBigBank(S);
  console.log(`   seeded 2,000 rows (20 by the chat's tool, 1,980 into the workspace file with the app closed) in ${((Date.now() - tSeed) / 1000).toFixed(1)} s`);
  const { confirmedAt } = await newSubject(S, { name: 'Big Subject', questions: 'Big Bank' });
  await showStudySidebar(S);
  const want = Object.fromEntries(papers.map((p) => [p, { answered: 25, total: 100 }]));
  const shown = await until(async () => sameCounts(await countsOf(S, papers), want), 90_000, 200);
  const took = (Date.now() - confirmedAt) / 1000;
  console.log(`   2,000 rows: New Subject confirmed to counts shown: ${shown ? `${took.toFixed(1)} s` : `not shown after ${took.toFixed(0)} s`}`);
  await S.shot('10-two-thousand');
  const s = subjectOf(ws, 'Big Subject');
  const units = s.units ? rowsOf(ws, s.units.id) : [];
  c('10.1', units.length === 20 && papers.every((p) => { const u = units.find((r) => norm(r.title) === p); return u && num(u.values.Questions) === 100 && num(u.values.Answered) === 25 && num(u.values['Right Last Time']) === 10; }) && rowsOf(ws, big).length === 2000, { units: units.length, first: units[0] ? [units[0].title, units[0].values] : null });
  c('10.2', !!shown && took <= 60, { seconds: Number(took.toFixed(1)), shown: !!shown, sidebar: shown ? undefined : ((await subjectsText(S)) ?? 'no Subjects section').slice(0, 200) });
  const card = await studyUnit(S, 'Big Subject', 'Paper 07');
  const r0 = must(rowTitled(ws, big, card.stem), 'the card\'s row among the 2,000');
  await S.click(must(card.field, 'an answer box'));
  await S.page.keyboard.type(String(r0.values['Model Answer']));
  const tEnter = Date.now();
  await S.page.keyboard.press('Enter');
  const file = path.join(ws, '.parallx', 'data.db');
  const d = new DatabaseSync(file, { readOnly: true });
  const attemptsCol = col(columns(ws, big), 'Times Attempted');
  let wrote = null;
  try {
    const q = d.prepare('SELECT value FROM page_property_values WHERE page_id = ? AND property_id = ? AND database_id = ?');
    wrote = await until(() => { const v = q.get(r0.pageId, attemptsCol.id, big); return v && num(parse(v.value)) === num(r0.values['Times Attempted']) + 1 ? Date.now() : null; }, 15_000, 20);
  } finally { d.close(); }
  const wroteIn = wrote ? (wrote - tEnter) / 1000 : null;
  console.log(`   2,000 rows: Enter on an answer to its row written (grading by the scripted model included): ${wroteIn === null ? 'not written in 15 s' : `${wroteIn.toFixed(2)} s`}`);
  c('10.3', wroteIn !== null && wroteIn < 2, { seconds: wroteIn });
});

phase(11, 'For tool authors: api.canvas.databases', 'plain', {
  '11.1': 'src/api/parallx.d.ts types canvas.databases',
  '11.2': 'docs/PARALLX_EXTENSION_AUTHORING_FOR_AI.md documents api.canvas.databases',
  '11.3': 'an extension that is not Study is handed api.canvas.databases, with Study turned off',
  '11.4': 'the door has a function for each job: list, get, create, a parent page, ensure columns, rows, add a row, update a row, remove a row, hear changes',
  '11.5': 'through the door the other extension lists a database made in the app, gets its columns and reads its rows with their values',
}, async (S, c) => {
  const dts = readFileSync(path.join(REPO, 'src', 'api', 'parallx.d.ts'), 'utf8');
  const canvasNs = dts.slice(Math.max(0, dts.indexOf('export namespace canvas')));
  c('11.1', /export namespace canvas\b/.test(dts) && /\b(namespace|const|let|var)\s+databases\b|\bdatabases\s*:/.test(canvasNs), { mentions: (dts.match(/canvas\.databases|namespace databases/g) || []).length });
  const doc = readFileSync(path.join(REPO, 'docs', 'PARALLX_EXTENSION_AUTHORING_FOR_AI.md'), 'utf8');
  c('11.2', /api\.canvas\.databases/.test(doc), { mentions: (doc.match(/canvas\.databases/g) || []).length });
  await S.page.evaluate(async () => { await window.__parallx_workbench__._services.get({ id: 'IToolEnablementService' }).setEnablement('parallx-community.study', false); });
  await sleep(1500);
  const { bank } = await seedBank(S);
  const keys = (await S.cmd('doorprobe.keys')).r || { type: 'unknown', keys: [] };
  c('11.3', keys.type === 'object' && keys.keys.length > 0, { typeofDoor: keys.type, canvasHas: keys.canvas });
  const k = keys.keys || [];
  const pick = (yes, no = /$^/) => k.find((x) => yes.test(x) && !no.test(x)) || null;
  const jobs = {
    list: pick(/^(list|all|getall)(databases)?$|list.*database|^list$/i, /row|col|prop|page/i),
    get: pick(/^(get|open|read|describe)(database)?$/i, /row|all/i),
    create: pick(/^(create|new|add)(database)?$/i, /row|col|page/i),
    page: pick(/page/i),
    ensureColumns: pick(/(ensure|require|sure).*(col|prop|field)|^(ensure)/i),
    rows: pick(/^(list|get|read|query)?\.?rows?$|(list|get|read|query).*rows/i, /^(add|update|remove|delete|create|on)/i),
    addRow: pick(/(add|create|insert).*row|rows?\.(add|create|insert)/i),
    updateRow: pick(/(update|set|write|patch).*(row|cell|value)|rows?\.(update|set)/i),
    removeRow: pick(/(remove|delete).*row|rows?\.(remove|delete)/i),
    changes: pick(/^on[A-Z_]?.*(change|did)/i),
  };
  c('11.4', Object.values(jobs).every(Boolean), { found: jobs, functions: k });
  const call = async (name, id) => {
    if (!name) return { ok: false, error: 'no such function' };
    for (const args of id === undefined ? [[]] : [[id], [{ id }], [{ databaseId: id }]]) { const r = (await S.cmd('doorprobe.call', name, args)).r; if (r && r.ok && r.value !== null && JSON.stringify(r.value) !== '[]') return r; }
    return (await S.cmd('doorprobe.call', name, id === undefined ? [] : [id])).r || { ok: false, error: 'the call did not return' };
  };
  const listed = await call(jobs.list); const got = await call(jobs.get, bank); const rows = await call(jobs.rows, bank);
  const L = JSON.stringify(listed.value ?? ''); const G = JSON.stringify(got.value ?? ''); const R = JSON.stringify(rows.value ?? '');
  const ok = { listHasIt: L.includes(bank) && L.includes(BANK), getHasColumns: BANK_COLUMNS.every((x) => G.includes(`"${x.name}"`)), rowsHaveTitles: SEED.every((r) => R.includes(r[1])), rowsHaveValues: SEED.every((r) => R.includes(r[2])) };
  c('11.5', Object.values(ok).every(Boolean), { ...ok, errors: [listed, got, rows].map((r) => r.error || '').filter(Boolean) });
});

// ── The subject the later phases start from: adopted by the app, once ────────
// Study may know a subject by its workspace, so those phases all run on the
// one workspace path it was made in, put back from a snapshot before each.
const ADOPT_WORKSPACE = path.join(OUT, 'runs', 'adopted-workspace');
let adoptedSnapshot = null; let adoptedFailed = '';
async function adoptedBase(fixtures) {
  if (adoptedSnapshot) return adoptedSnapshot;
  if (adoptedFailed) throw new Error(adoptedFailed);
  const S = makeSession(await newRoot('adopted-made', fixtures, ADOPT_WORKSPACE));
  try {
    await S.open();
    await seedBank(S);
    await newSubject(S, { name: SUBJECT, questions: BANK });
    must(await waitSubject(S, SUBJECT), `the page "${SUBJECT}" with Units and Work Log under it`);
    await showStudySidebar(S);
    must(await until(async () => sameCounts(await countsOf(S, Object.keys(SEED_UNITS)), SEED_UNITS), 10_000), `the adopted subject's counts in the sidebar (${(await subjectsText(S)) ?? 'no Subjects section'})`);
    await closeStudyTabs(S);
    await sleep(800);
    console.log(`[probe] the subject "${SUBJECT}" was made by the app from the seeded "${BANK}"`);
  } catch (err) {
    adoptedFailed = `the subject the phase starts from could not be made: ${String((err && err.message) || err).split('\n')[0].slice(0, 220)}`;
    throw new Error(adoptedFailed);
  } finally { await S.close(); }
  const snapshot = path.join(OUT, 'runs', 'adopted-snapshot');
  await fs.cp(ADOPT_WORKSPACE, snapshot, { recursive: true });
  adoptedSnapshot = snapshot;
  return adoptedSnapshot;
}
/** The ids a phase on the adopted subject works with, from the file. */
function adoptedIds(ws) {
  const s = subjectOf(ws, SUBJECT);
  const byTitle = (t) => databases(ws).find((d) => norm(d.title) === t)?.id ?? null;
  return { page: s.page?.id ?? null, units: s.units?.id ?? null, log: s.log?.id ?? null, bank: byTitle(BANK), notes: byTitle(NOTES_DB) };
}

async function main() {
  await fs.mkdir(path.join(OUT, 'shots'), { recursive: true });
  await fs.rm(path.join(OUT, 'runs'), { recursive: true, force: true });
  const fixtures = await makeFixtures();
  const t0 = Date.now();
  for (const p of PHASES) {
    const n = p.n === 51 ? 5 : p.n;
    if (ONLY && !ONLY.has(n)) continue;
    console.log(`\n── ${n}. ${p.title}`);
    const tp = Date.now();
    const done = new Set();
    const c = (id, ok, got) => { if (done.has(id)) return; done.add(id); record(id, p.checks[id] ?? '(unnamed check)', ok, got); };
    let S = null;
    let stopped = '';
    try {
      const name = `phase-${String(p.n).padStart(2, '0')}`;
      S = makeSession(p.base === 'adopted' ? await newRoot(name, await adoptedBase(fixtures), ADOPT_WORKSPACE) : await newRoot(name, fixtures));
      await S.open();
      await p.fn(S, c, p.base === 'adopted' ? adoptedIds(S.workspace) : null);
    } catch (err) {
      stopped = String((err && err.message) || err).split('\n')[0].slice(0, 300);
      if (S && S.page) await S.shot(`${String(p.n).padStart(2, '0')}-stopped`);
    } finally {
      if (S) await S.close();
      if (S && p.base === 'adopted') await fs.rename(ADOPT_WORKSPACE, path.join(S.dir, 'workspace-after')).catch(() => {});
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
