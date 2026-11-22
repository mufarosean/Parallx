// @acceptance: Study as the harness: a unit's tab holds all its material (notes and files of any layout, its questions, every tool's group) and opens each in its own editor
// Written from the request ("Study as the harness: a unit is one place for all
// its material", 2026-11-19) before the build, by a verifier that did not
// build it, and seen to fail on the app as it was (d6654f73). The builder does
// not edit this file: a check that is wrong is reported, not changed.
//
// What a person must be able to do when the piece is done (a phase's number is
// the request's statement; PARALLX_PROBE_ONLY takes these numbers):
//
//    1  pressing a unit in Study's sidebar opens its tab "<Subject> · <Unit>",
//       one per unit (pressed again it comes forward, also after the app was
//       closed and opened); "Study…" is one press away on the tab and in the
//       unit row's More Actions
//    2  the tab groups everything by kind, each group with its count: Notes
//       and files (title or file name, and where it lives), Questions (right,
//       partly, wrong, not yet), one group per tool that reports progress, in
//       its own words; an empty group says so and how to add to it
//    3  one press opens an item in its own editor (a page in the canvas
//       editor, a PDF in the PDF editor, any other file in what the app opens
//       it with); Questions open the setup sheet and, by a second control, the
//       Questions database; a tool's group opens the tool through its provider
//    4  "Add Notes or Files…": a picker over every page and every file,
//       searchable by name and path, several at once; a page may belong to
//       several units; "Remove" takes it off the unit and leaves it untouched
//    5  "Find Matches…" in the subject's More Actions proposes pages and files
//       by name or Also Called (case, spaces, punctuation and accents aside),
//       all unticked; nothing is attached until "Attach Selected", and then
//       only the ticked ones
//    6  the Units database has a column "Material" listing every attached item
//       by name; an item added or removed there shows in the tab within 2 s
//       (each time is printed)
//    7  a page in the Trash, a file deleted, a file moved outside the app: the
//       item says it is missing, in words, with Remove, and nothing errors; a
//       file renamed in the app's Explorer is followed
//    8  the New Subject sheet has no Notes choice; a subject made earlier with
//       a notes database still opens, and the notes database is as it was
//    9  every item and control reachable by keyboard and named ("Open
//       <title>", "Remove <title> from <Unit>"), focus shown, the picker keeps
//       Tab inside and gives focus back, a tap by finger opens an item, the
//       text reads in light and dark, the tab fits 900 px
//   10  a tool turned off takes only its group, at once; Study off leaves the
//       pages, the files and the Material column; a unit of 300 questions, 40
//       items and two tools' groups shows within 1 s (the time is printed)
//    0  is not in the request: the ground the other checks stand on (the seed
//       as the app shows it, the editors the app opens each kind in, the
//       Trash, the Explorer's Rename, a tool off and on, light and dark, the
//       New Subject sheet, the subject's menu). Its checks pass before the
//       build and must go on passing; every other check fails before the build
//
// How it runs. Every phase gets its own app, profile and workspace, so one
// failure hides nothing. Every phase starts from a copy of one workspace that
// the app itself made: a seeded questions database adopted as the subject
// "Exam 7" through the New Subject sheet, two units added by hand in Units,
// Also Called filled in by the table's own command, Worksheets' problems and
// Flashcards' cards written into the tools' own tables with the app closed,
// and a notes database recorded on the subject in Study's own store with the
// app closed (as a subject made with the Notes choice was). A scripted model
// stands in for the owner's (there is none here): it grades a typed answer by
// its words, so it proves the plumbing and never the quality of grading. The
// mouse, the keys and the finger are real.
//
//   xvfb-run -a node tests/probes/study-unit-acceptance.mjs [outDir]
//   PARALLX_PROBE_ONLY=0,2,5-7   only those phases
//
// The material is seeded in several layouts on purpose, so the build cannot
// assume one: loose top-level pages ("Mack", "Chain Ladder", "hurlimann",
// "Mack and Clark Compared", "Grocery List", 30 "Bulk Page NN"), pages under an
// unrelated parent ("Reading Log" › "Fried-Land", "Week 3 Thoughts"), rows of a
// canvas database ("Lecture Notes": "VENTER", "Admin"), a PDF two folders down
// ("Readings/Week 1/Mack 1993.pdf"), Markdown at the root ("Clark.md"), an
// image ("Siewert.png"), plain text ("Grocery list.txt"), ten Markdown files in
// a folder ("bulk/Bulk File NN.md"). The units are Mack, Clark, Friedland,
// Venter, Siewert and Hürlimann; Mack's Also Called is "Mack 1993, Chain
// Ladder", so "Mack 1993.pdf" and "Chain Ladder" match Mack only through it.
//
// Where a result is read from. Never from what the probe typed: from the
// unit's tab (the words and the accessible names on it), from what the
// workbench reports as the active editor (IEditorService.activeEditor: its
// typeId, its id, its file), from the workspace's own database file
// (<workspace>/.parallx/data.db), from the files on disk, from the canvas table
// of Units, and from an extension that is not Study (its provider is told when
// it is asked to open).
//
// What the probe holds on to (the builder keeps these, or the check fails):
//   - the words of the request: the tab title "<Subject> · <Unit>" (a middle
//     dot with a space each side); "Add Notes or Files…"; "Find Matches…" in
//     the subject's More Actions menu; "Attach Selected"; "Study…" on the tab
//     and in the unit row's More Actions; the column "Material" in Units; the
//     group names "Notes and files", "Questions" and each provider's own
//     display name ("Problems", "Cards", the probe's "Drills"); the four words
//     right, partly, wrong, not yet beside numbers; a tool's own four words
//     beside numbers (Worksheets: easy, medium, hard, not rated; Flashcards:
//     good or easy, hard, again, not reviewed)
//   - THE HOOKS THE BUILDER PROVIDES (the request names no structure):
//       a. a group begins with a heading (h1 to h6, or role="heading") whose
//          words begin with the group's name and hold its count as a number
//          ("Notes and files 3", "Questions (8)"); what the group holds follows
//          that heading, in document order, up to the next group's heading
//       b. an item is a control (a button, link, role=button) whose accessible
//          name (aria-label, else its words) is "Open <title>", and a control
//          named "Remove <title> from <Unit>"; the smallest element holding
//          both is the item's row, and its words show the title (a page's
//          title, a file's name with its extension) and where it lives
//       c. the picker and the list of matches are the app's modal
//          ([role=dialog] or .parallx-modal-box) or a sheet (.st-sheet); the
//          picker has a text field to search in; each choice is a checkbox
//          (input[type=checkbox], role=checkbox, or a role=option with
//          aria-selected/aria-checked) whose row's words hold the item's title
//          on a line of its own (and, in Find Matches, the proposed unit); the
//          picker's confirming button starts with Attach, Add, Done or OK
//   - as they are today: Study's sidebar (Subjects, the unit's button, More
//     Actions on a row, the subject's menu as [role=menuitem]), the setup
//     sheet .st-sheet and the session card (see the record probe), the canvas
//     table ([data-px-surface=database], .canvas-db-th__name, tr.canvas-db-row,
//     td[role=gridcell], data-editable), the command database.setCell on the
//     table in front, canvas.deletePage with "Move to Trash", the Explorer's
//     tree (role=treeitem, its context menu's Rename, the inline input),
//     file.openFile, Worksheets' dashboard (.ws-dash__paperrow), Appearance's
//     [data-px-id="appearance.mode.light|dark"], the core command
//     progress.getRegistry (piece 2)
//
// How the request is read where it leaves room (told to the builder):
//   - "matches a unit's name": a page's title, or a file's name without its
//     extension, equals the unit's name or one of its Also Called names once
//     case, spaces, punctuation and accents are set aside. The probe holds that
//     every such item is proposed for that unit and that items matching no
//     unit are not proposed; an item that only contains a unit's name (a
//     reading of "matches" as "contains") is neither required nor refused
//   - the groups stand in the order the request lists them: Notes and files,
//     then Questions, then the tools' groups
//   - "where it lives": a file's folders (each folder's name is in the row);
//     a page's parent page, or the database it is a row of (its title is in
//     the row). A top-level page or a file at the root is not checked
//   - "missing, in words": the row says missing, not found, in the Trash,
//     deleted, moved, gone or no longer there
//   - an edit "there" (the Material column): the probe writes the cell through
//     the table's own command database.setCell with the Units table in front,
//     with a value made from the cell's own stored value (one element taken
//     out; or one element copied from an item of the same kind with that
//     item's id, path and name put in). So any cell format the builder picks
//     is edited in its own format. The 2 s are timed from the write to the
//     unit's tab, brought to the front, showing it
//   - "at once" for a tool turned off: 2 s
//   - "within 1 second": from the press on the unit in the sidebar to the tab
//     in front with every group and its count drawn
//   - "reads well in light and dark": WCAG 1.4.3, every piece of text in the
//     tab at 4.5:1 against what it sits on (3:1 for large text)
//   - "at 900 px": the window 900 px wide; the tab has no sideways scroll and
//     every item's Open control lies inside it
//   - a file "moved" in 7 is moved on disk outside the app (the app's own
//     Explorer rename is the one that must be followed)
//   - the Questions group's two controls: some control in the group opens the
//     setup sheet on the unit (Start asks only its questions), another opens
//     the Questions database; a tool's group: some control in it makes the
//     provider's open() be called with that unit's group
//
// Not checked here: the look beyond contrast and width (the visual bar's
// probe); a drag to attach (none is asked for); a file moved into another
// folder by the Explorer's cut and paste or drag (only its Rename, which is a
// move to a new name, is driven); whether a tool's group shows for a unit with
// nothing in that tool; the Questions group's "or" read as either control
// alone; that no Study code names another tool (the modularity reviewer reads
// that; here a tool the core cannot know, the probe's own "Drills", gets its
// group); the owner's own model, card or Windows.
import { _electron as electron } from 'playwright';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.resolve(process.argv[2] ?? path.join(REPO, 'test-results', 'study-unit-acceptance'));
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
const cardsFile = (ws) => path.join(ws, '.parallx', 'extensions', 'flashcards', 'data.db');
/** Study's own store: the extension file under .parallx/extensions that holds st_subjects. */
function studyFile(ws) {
  const root = path.join(ws, '.parallx', 'extensions');
  if (!existsSync(root)) return null;
  for (const d of readdirSync(root)) {
    const f = path.join(root, d, 'data.db');
    if (existsSync(f) && fileAll(f, "SELECT name FROM sqlite_master WHERE name = 'st_subjects'").length) return f;
  }
  return null;
}
const coreAll = (ws, sql, params = []) => fileAll(coreFile(ws), sql, params);
const cardsAll = (ws, sql, params = []) => fileAll(cardsFile(ws), sql, params);
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

// ── What is seeded ───────────────────────────────────────────────────────────
// Counts are always [green, yellow, red, the rest].
const SUBJECT = 'Exam 7';
const BANK = 'Conceptual Questions';
const NOTES_DB = 'Reading Notes';
const WRONG = 'Qqqqqqq zzzzzzz wwwwwww.';
const tabTitle = (unit, subject = SUBJECT) => `${subject} · ${unit}`;
const Q_STATES = { Mack: 'RRRPWWNN', Clark: 'RPPNNN', Friedland: 'NNNN', Venter: 'RRRRW' };
const Q = Object.fromEntries(Object.entries(Q_STATES).map(([u, s]) => [u, ['R', 'P', 'W', 'N'].map((k) => [...s].filter((x) => x === k).length)]));
const RESULT = { R: 'Right', P: 'Partly', W: 'Wrong' };
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
const stemsOf = (paper) => SEED.filter((q) => q.paper === paper).map((q) => q.question).sort();
const HAND_UNITS = ['Siewert', 'Hürlimann'];
const UNITS = [...Object.keys(Q_STATES), ...HAND_UNITS];
const ALSO_CALLED = { Mack: 'Mack 1993, Chain Ladder' };
// Worksheets' problems by paper [easy, medium, hard, not rated]; Flashcards' cards by tag (G good, E easy, H hard, A again, N never).
const P = { mack: [2, 1, 1, 3], clark: [3, 1, 2, 4], brosius: [2, 2, 1, 1] };
const P_LABEL = { mack: 'Mack', clark: 'Clark', brosius: 'Brosius' };
const CARD_TAGS = { mack: 'GEHAN', clark: 'GNN' };
const DECK = 'Exam 7 Cards';
const cardCounts = (s) => [[...s].filter((x) => x === 'G' || x === 'E').length, [...s].filter((x) => x === 'H').length, [...s].filter((x) => x === 'A').length, [...s].filter((x) => x === 'N').length];
const C = { Mack: cardCounts(CARD_TAGS.mack), Clark: cardCounts(CARD_TAGS.clark) };
const WORDS = {
  Questions: ['right', 'partly', 'wrong', 'not yet'],
  Problems: ['easy', 'medium', 'hard', 'not rated'],
  Cards: ['good or easy', 'hard', 'again', 'not reviewed'],
  Drills: ['crisp', 'shaky', 'blank', 'untried'],
};
const DRILL_MACK = [4, 2, 1, 2];
const GROUP_NAMES = ['Notes and files', 'Questions', 'Problems', 'Cards', 'Drills'];
const NOTES = 'Notes and files';

/** The material, in every layout. `page` items are canvas pages; `file` items are paths in the workspace. */
const M = {
  mackPage: { title: 'Mack', kind: 'page' },
  compared: { title: 'Mack and Clark Compared', kind: 'page' },
  chain: { title: 'Chain Ladder', kind: 'page' },
  hurli: { title: 'hurlimann', kind: 'page' },
  grocery: { title: 'Grocery List', kind: 'page' },
  log: { title: 'Reading Log', kind: 'page' },
  fried: { title: 'Fried-Land', kind: 'page', parent: 'log', lives: ['Reading Log'] },
  week3: { title: 'Week 3 Thoughts', kind: 'page', parent: 'log', lives: ['Reading Log'] },
  venterRow: { title: 'VENTER', kind: 'row', db: 'Lecture Notes', lives: ['Lecture Notes'] },
  adminRow: { title: 'Admin', kind: 'row', db: 'Lecture Notes', lives: ['Lecture Notes'] },
  pdf: { title: 'Mack 1993.pdf', kind: 'file', file: path.join('Readings', 'Week 1', 'Mack 1993.pdf'), lives: ['Readings', 'Week 1'] },
  md: { title: 'Clark.md', kind: 'file', file: 'Clark.md' },
  png: { title: 'Siewert.png', kind: 'file', file: 'Siewert.png' },
  txt: { title: 'Grocery list.txt', kind: 'file', file: 'Grocery list.txt' },
};
const BULK_PAGES = Array.from({ length: 30 }, (_, i) => `Bulk Page ${String(i + 1).padStart(2, '0')}`);
const BULK_FILES = Array.from({ length: 10 }, (_, i) => path.join('bulk', `Bulk File ${String(i + 1).padStart(2, '0')}.md`));
/** What Find Matches must propose, and for which unit. */
const MUST_PROPOSE = [['mackPage', 'Mack'], ['chain', 'Mack'], ['pdf', 'Mack'], ['md', 'Clark'], ['png', 'Siewert'], ['hurli', 'Hürlimann'], ['fried', 'Friedland'], ['venterRow', 'Venter']];
/** What matches no unit, by any reading. */
const MUST_NOT = ['grocery', 'txt', 'week3', 'adminRow', 'log'];

function pdfBytes(text) {
  const s = `BT /F1 18 Tf 72 700 Td (${text}) Tj ET`;
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>', `<< /Length ${s.length} >>\nstream\n${s}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let out = '%PDF-1.4\n'; const off = [];
  objs.forEach((o, i) => { off.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${off.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return out;
}
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
async function writeFiles(ws) {
  await fs.mkdir(path.join(ws, 'Readings', 'Week 1'), { recursive: true });
  await fs.mkdir(path.join(ws, 'bulk'), { recursive: true });
  await fs.writeFile(path.join(ws, M.pdf.file), pdfBytes('Mack 1993: the standard error of chain ladder reserve estimates'));
  await fs.writeFile(path.join(ws, M.md.file), '# Clark\n\nLDF curve fitting and the Cape Cod method.\n');
  await fs.writeFile(path.join(ws, M.png.file), PNG);
  await fs.writeFile(path.join(ws, M.txt.file), 'milk\nbread\n');
  for (const f of BULK_FILES) await fs.writeFile(path.join(ws, f), `# ${path.basename(f, '.md')}\n\nA bulk note.\n`);
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
  const shown = (n) => !!n && n.getClientRects().length > 0 && n.getBoundingClientRect().width > 0 && getComputedStyle(n).visibility !== 'hidden';
  const CLICKABLE = 'button, [role="button"], [role="menuitem"], [role="menuitemradio"], [role="option"], [role="radio"], [role="tab"], [role="treeitem"], [role="checkbox"], [role="switch"], [role="link"], a[href], summary, input[type="checkbox"], input[type="radio"]';
  const CONTROLS = `${CLICKABLE}, input, select, textarea, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]`;
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
        return { ...point(n), label, tag: n.tagName, role: n.getAttribute('role') || '', value: fieldValue(n), options: n.tagName === 'SELECT' ? Array.from(n.options).map((o) => norm(o.textContent)) : null };
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
    tabs: () => Array.from(document.querySelectorAll('.ui-tab')).map((t) => { const l = t.querySelector('.ui-tab-label') || t; return { id: t.getAttribute('data-tab-id') || '', probeTab: t.getAttribute('data-tab-id') || '', active: t.classList.contains('ui-tab--active'), label: norm(t.querySelector('.ui-tab-label')?.textContent), ...point(l) }; }),
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

// ── An extension that is not Study: a tool the core cannot know, with a provider that can open ──
const DOOR_EXT = {
  manifest: { manifestVersion: 1, id: 'probe.door-probe', name: 'Door Probe', version: '0.0.1', publisher: 'probe', description: 'A progress provider of its own for the acceptance probe.', main: 'main.js', activationEvents: ['onStartupFinished'], engines: { parallx: '^0.1.0' },
    contributes: { commands: [{ id: 'doorprobe.state', title: 'Door Probe: State' }] } },
  main: `
export async function activate(api, context) {
  const st = { opened: [], listed: 0 };
  context.subscriptions.push(api.commands.registerCommand('doorprobe.state', () => JSON.parse(JSON.stringify(st))));
  const reg = await api.commands.executeCommand('progress.getRegistry');
  if (!reg || typeof reg.register !== 'function') return;
  const listeners = new Set();
  context.subscriptions.push(reg.register({
    id: 'doorprobe.drills', displayName: 'Drills', toolId: 'probe.door-probe',
    words: { good: 'Crisp', middling: 'Shaky', poor: 'Blank', rest: 'Untried' },
    groups() { st.listed += 1; return [{ group: 'mack', label: 'Mack', total: 9, good: 4, middling: 2, poor: 1 }, { group: 'zeta', label: 'Zeta', total: 3, good: 0, middling: 0, poor: 3 }]; },
    onDidChange(l) { listeners.add(l); return { dispose() { listeners.delete(l); } }; },
    async open(groups, state) { st.opened.push({ groups: Array.from(groups || []), state }); return true; },
  }));
}
export function deactivate() {}
`,
};

// ── One app ──────────────────────────────────────────────────────────────────
const TOOLS = { study: 'parallx-community.study', worksheets: 'parallx.worksheet', flashcards: 'parallx-community.flashcards', door: 'probe.door-probe' };
const TOOL_COMMAND = { study: 'study.open', worksheets: 'worksheet.dashboard', flashcards: 'flashcards.studyTag', door: 'doorprobe.state' };
const pageErrors = [];
let shotN = 0;
async function launch(dir, workspace, width = 1440) {
  const appRoot = path.join(dir, 'app');
  await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: workspace }));
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
  const args = process.getuid?.() === 0 ? ['--no-sandbox', '.', '--mute-audio', '--disable-gpu'] : ['.', '--mute-audio', '--disable-gpu'];
  const app = await electron.launch({ executablePath: ELECTRON, args, cwd: REPO, env, timeout: 90_000 });
  const page = await app.firstWindow();
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 300)));
  await page.setViewportSize({ width, height: 900 }).catch(() => {});
  await page.waitForSelector('.parallx-ready', { state: 'attached', timeout: 120_000 });
  await page.waitForFunction(() => !!window.__parallx_workbench__?._services, null, { timeout: 60_000 });
  await page.waitForTimeout(1_200);
  const on = await page.evaluate(async (ids) => {
    const s = window.__parallx_workbench__._services.get({ id: 'IToolEnablementService' });
    try { for (const id of ids) await s.setEnablement(id, true); return true; } catch (e) { return String(e); }
  }, Object.values(TOOLS));
  if (on !== true) throw new Error(`Study, Worksheets, Flashcards or the probe's extension could not be turned on: ${on}`);
  await page.waitForFunction(() => { try { return !!window.__parallx_workbench__._services.get({ id: 'ILanguageModelToolsService' }).getTool('study_results'); } catch { return false; } }, null, { timeout: 60_000 });
  await page.waitForFunction((ids) => { try { const c = window.__parallx_workbench__._services.get({ id: 'ICommandService' }); return ids.every((id) => c.hasCommand(id)); } catch { return false; } }, Object.values(TOOL_COMMAND), { timeout: 60_000 });
  await page.waitForTimeout(600);
  await page.evaluate(installPageHelpers);
  const r = await page.evaluate(installProbeModel);
  if (r !== 'ok') throw new Error(`scripted model not registered: ${r}`);
  return { app, page };
}

function makeSession({ dir, workspace }) {
  const S = {
    dir, workspace, app: null, page: null, width: 1440,
    async open() {
      const a = await launch(dir, workspace, S.width); S.app = a.app; S.page = a.page;
      if ((await S.tabs()).some((t) => t.label === 'New Subject') && (await S.formOpen())) {
        (await S.press('form', /^cancel$/i, 'button')) || (await S.page.keyboard.press('Escape'));
        await sleep(600);
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
    run: (id, ...args) => { void S.page.evaluate(({ id, args }) => { void window.__parallx_workbench__._services.get({ id: 'ICommandService' }).executeCommand(id, ...args).catch(() => {}); }, { id, args }).catch(() => {}); },
    tool: (name, args) => S.page.evaluate(async ({ name, args }) => {
      const t = window.__parallx_workbench__._services.get({ id: 'ILanguageModelToolsService' }).getTool(name);
      if (!t) return `no tool ${name}`;
      try { const r = await t.handler(args, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) }); return String((r && r.content) || ''); } catch (e) { return `threw: ${e && e.message}`; }
    }, { name, args }),
    shot: async (name) => { try { const f = path.join(OUT, 'shots', `${String(++shotN).padStart(2, '0')}-${name}.png`); await S.page.screenshot({ path: f }); return f; } catch { return ''; } },
    text: (scope = 'pane') => S.page.evaluate((scope) => window.__ap.text(scope), scope),
    has: (scope, sel) => S.page.evaluate(({ scope, sel }) => window.__ap.has(scope, sel), { scope, sel }),
    card: () => S.page.evaluate(() => window.__ap.card()),
    tabs: () => S.page.evaluate(() => window.__ap.tabs()),
    active: () => S.page.evaluate(() => window.__ap.active()),
    groups: () => S.page.evaluate((names) => window.__ap.groups(names), GROUP_NAMES),
    items: () => S.page.evaluate((names) => window.__ap.items(names), GROUP_NAMES),
    choices: () => S.page.evaluate(() => window.__ap.choices()),
    focused: () => S.page.evaluate(() => window.__ap.focused()),
    find: (scope, re, sel) => S.page.evaluate(({ scope, source, flags, sel }) => window.__ap.find(scope, source, flags, sel), { scope, source: re.source, flags: re.flags, sel }),
    field: (re) => S.page.evaluate(({ source, flags }) => window.__ap.field(source, flags), { source: re.source, flags: re.flags }),
    formOpen: () => S.page.evaluate(() => window.__ap.formOpen()),
    formText: () => S.page.evaluate(() => window.__ap.formText()),
    textPoint: (scope, text, after) => S.page.evaluate(({ scope, text, after }) => window.__ap.textPoint(scope, text, after), { scope, text, after }),
    cell: (dbId, row, column) => S.page.evaluate(({ dbId, row, column }) => window.__ap.cell(dbId, row, column), { dbId, row, column }),
    async press(scope, re, sel) {
      const hit = (await S.find(scope, re, sel)).find((h) => !h.disabled);
      if (!hit) return null;
      await S.page.mouse.click(hit.x, hit.y);
      return hit;
    },
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
const F = { name: /^(subject )?name\b/i, questions: /^questions?\b/i, notes: /^notes?\b/i };
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
    if (questions && !mapped && (await S.field(/^answer\b/i))) mapped = true;
    must(await pressConfirm(S), `a button to confirm the New Subject dialog (it shows: ${norm(await S.formText()).slice(0, 160)})`);
    await until(async () => !(await S.formOpen()) || (questions && !mapped && (await S.field(/^answer\b/i))), 6000);
    await sleep(300);
  }
  if (await S.formOpen()) throw new Error(`the New Subject dialog did not close: ${norm(await S.formText()).slice(0, 200)}`);
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
async function cardAfter(S, ms = 4000) {
  const seen = await until(async () => ((await sheetOpen(S)) ? 'sheet' : answerable(await S.card()) ? 'card' : null), ms, 100);
  if (seen === 'sheet') { await sleep(300); must(await pressStart(S), 'the Start button on the setup sheet'); }
  return seen ? waitCard(S, 15_000) : null;
}
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
async function sessionStems(S, first, cap = 12) {
  const seen = [];
  let card = first;
  for (let i = 0; i < cap && card && card !== 'end'; i++) { seen.push(card.stem); await answer(S, card, WRONG); card = await pressNext(S, card.stem); }
  return { seen: seen.sort(), ended: card === 'end' };
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
async function closeTab(S, title) {
  if (!(await showTab(S, title))) return false;
  await S.press('body', /./, '.ui-tab--active .ui-tab-close');
  return !!(await until(async () => (await tabTitled(S, title)).length === 0, 3000));
}
/** Press the unit in Study's sidebar; its tab in front, or a stop that says what came instead. Returns the time of the press. */
async function openUnit(S, unit) {
  const pt = must(await subjectPoint(S, unit, { under: SUBJECT }), `the unit "${unit}" under "${SUBJECT}" in Study's sidebar`);
  const at = Date.now();
  await S.click(pt);
  const front = await until(async () => (await tabTitled(S, tabTitle(unit))).some((t) => t.active), 5000, 30);
  if (!front) {
    const tabs = (await S.tabs()).map((t) => `${t.label}${t.active ? ' (front)' : ''}`).join(' | ');
    const sheet = await sheetOpen(S);
    await closeStudyTabs(S);
    throw new Error(`no tab "${tabTitle(unit)}" in front after the unit was pressed in the sidebar (tabs: ${tabs}${sheet ? '; the setup sheet opened instead' : ''})`);
  }
  return at;
}
const groupOf = (groups, name) => groups.find((g) => low(g.name) === low(name)) || null;
const itemOf = (items, title) => items.find((i) => i.title === title) || null;
/** "3 right" or "Right: 3", for each of the four words. */
const countsIn = (text, words) => words.map((w) => { const m = new RegExp(`(?:^|[^\\d])(\\d+)\\s+${esc(w)}\\b|\\b${esc(w)}\\W{1,3}(\\d+)(?!\\d)`, 'i').exec(text); return m ? Number(m[1] ?? m[2]) : null; });
/** Wait for the tab in front to show what `pred` wants of its groups and items. */
async function waitTab(S, pred, ms = 5000) {
  let g = []; let it = [];
  const hit = await until(async () => { g = await S.groups(); it = await S.items(); return pred(g, it) ? true : null; }, ms, 60);
  return { ok: !!hit, groups: g, items: it };
}
const brief = (groups) => groups.map((g) => `${g.heading}`).join(' | ');
/** The Notes and files items of the tab, as titles. */
const notesTitles = (items) => items.filter((i) => low(i.group) === low(NOTES)).map((i) => i.title).sort();

// ── The picker and Find Matches ─────────────────────────────────────────────
/** Does a choice's row hold `title` on a line of its own? */
const lineIs = (choice, title) => choice.lines.some((l) => norm(l) === title);
async function openPicker(S, unit) {
  must(await showTab(S, tabTitle(unit)), `the tab "${tabTitle(unit)}"`);
  must(await S.press('pane', /^Add Notes or Files(…|\.\.\.)$/), `"Add Notes or Files…" on the tab "${tabTitle(unit)}"`);
  must(await until(() => S.formOpen(), 4000), 'a picker after "Add Notes or Files…"');
  await sleep(400);
}
async function search(S, text) {
  const f = must(await S.page.evaluate(() => window.__ap.searchField()), 'a text field to search in, in the picker');
  await S.click(f);
  await S.page.keyboard.press('Control+A');
  if (text) await S.page.keyboard.type(text); else await S.page.keyboard.press('Backspace');
  await sleep(500);
}
const choiceFor = async (S, title) => (await S.choices()).find((c) => lineIs(c, title)) || null;
/** Tick the choice whose row reads `title` (searching for it first). */
async function tick(S, title, { searchFor = title } = {}) {
  if (searchFor !== null) await search(S, searchFor);
  const c = must(await until(() => choiceFor(S, title), 3000), `a choice "${title}" in the picker (it shows: ${norm(await S.formText()).slice(0, 200)})`);
  if (!c.on) { await S.click(c); await sleep(250); }
  const after = await choiceFor(S, title);
  return !!after && after.on;
}
async function confirmPicker(S) {
  const hit = (await S.find('form', /^(Attach|Add|Done|OK)\b/i, 'button')).find((h) => !h.disabled && !/^Add Notes or Files/.test(h.name));
  must(hit, `a button to attach the chosen items (the picker shows: ${norm(await S.formText()).slice(0, 160)})`);
  await S.click(hit);
  must(await until(async () => !(await S.formOpen()), 4000), 'the picker closing after the chosen items were attached');
  await sleep(300);
}
/** Attach `keys` (of M) to `unit` through its tab's picker, as a person does. */
async function attach(S, unit, keys) {
  if (!(await tabTitled(S, tabTitle(unit))).length) await openUnit(S, unit);
  await openPicker(S, unit);
  const ticked = {};
  for (const k of keys) ticked[k] = await tick(S, M[k].title);
  await confirmPicker(S);
  const r = await waitTab(S, (g, it) => keys.every((k) => itemOf(it, M[k].title)), 4000);
  if (!r.ok) throw new Error(`after the picker, the tab "${tabTitle(unit)}" does not list ${keys.map((k) => M[k].title).join(', ')} (it lists: ${notesTitles(r.items).join(', ') || 'nothing'}; ticked: ${JSON.stringify(ticked)})`);
  return r;
}
async function pressRemove(S, unit, title) {
  const it = must(itemOf(await S.items(), title), `the item "${title}" in the tab "${tabTitle(unit)}"`);
  must(it.remove, `"Remove ${title} from ${unit}" in the item's row`);
  await S.click(it.remove);
  await sleep(300);
  // A question first, if the build asks one.
  await S.press('body', /^(Remove|OK|Yes)$/, '.parallx-modal-box button, [role="dialog"] button, [role="alertdialog"] button');
  return until(async () => !itemOf(await S.items(), title), 3000);
}

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
/** Rename a file at the workspace's root in the app's Explorer: its row's context menu, Rename, the new name, Enter. */
async function explorerRename(S, from, to) {
  await S.cmd('workbench.view.explorer');
  await sleep(800);
  if (!(await S.find('body', /./, '[role="treeitem"]')).length) await S.press('body', /^Explorer\b/, '.activity-bar-item');
  // A row's words start with its icon's letters (MD, TXT): its name is the label inside it.
  const row = await until(async () => (await S.find('body', exact(from), '[role="treeitem"] .tree-node-label'))[0], 6000);
  if (!row) { await S.shot('explorer-no-row'); throw new Error(`could not find the row "${from}" in the Explorer (its rows: ${(await S.find('body', /./, '[role="treeitem"]')).map((r) => r.name).slice(0, 12).join(', ') || 'none'})`); }
  await S.click(row, { button: 'right' });
  await sleep(400);
  must(await S.press('body', /^Rename(\b|F2)/, MENU_ITEMS), 'Rename in the Explorer row\'s menu');
  await sleep(400);
  await S.page.keyboard.press('Control+A');
  await S.page.keyboard.type(to);
  await S.page.keyboard.press('Enter');
  return until(() => existsSync(path.join(S.workspace, to)) && !existsSync(path.join(S.workspace, from)), 5000);
}
async function setMode(S, mode) {
  await S.cmd('settings.openAppearance');
  must(await until(() => S.press('body', /./, `[data-px-id="appearance.mode.${mode}"]`), 8000), `Appearance's ${mode} mode`);
  await sleep(600);
  await S.press('body', /./, '.ui-tab--active .ui-tab-close');
  await sleep(400);
}
async function dashboardPapers(S) {
  await S.cmd('worksheet.dashboard');
  must(await until(() => S.has('body', '.ws-dash__paperrow'), 20_000), 'Worksheets\' dashboard with its Progress by paper');
  await sleep(400);
  const rows = await S.page.evaluate(() => Array.from(document.querySelectorAll('.ws-dash__paperrow')).filter(window.__ap.shown).map((r) => ({ label: (r.querySelector('.ws-dash__papername')?.textContent || '').trim(), aria: r.querySelector('.ws-dash__bar')?.getAttribute('aria-label') || '' })));
  await S.press('body', /./, '.ui-tab--active .ui-tab-close');
  await sleep(300);
  const out = {};
  for (const r of rows) { const m = /: (\d+) easy, (\d+) medium, (\d+) hard, (\d+) not rated$/.exec(r.aria); if (m) out[r.label] = m.slice(1, 5).map(Number); }
  return out;
}
const doorState = async (S) => (await S.cmd('doorprobe.state')).r || { opened: [], listed: 0 };
/** Grow or shrink the Material cell through the table's own command, in the cell's own format. */
async function editMaterial(S, A, unit, { remove = null, add = null, like = null }) {
  const ws = S.workspace;
  must(await openDb(S, A.units), 'the Units database open in the app');
  const cols = materialCols(ws, A.units);
  must(cols.length, 'a column named Material in Units');
  const row = must(rowTitled(ws, A.units, unit), `the unit "${unit}" in Units`);
  const fileKeys = (k) => keysOf(ws, { pageId: A.ids[k], file: M[k].file });
  for (const c of cols) {
    const raw = row.raw[c.name];
    if (raw === undefined || raw === null) continue;
    const v = parse(raw);
    const has = (x, k) => holds(JSON.stringify(x), fileKeys(k)) || holds(JSON.stringify(x), [M[k].title]);
    let next = null;
    if (remove && has(v, remove)) {
      if (Array.isArray(v)) next = v.filter((x) => !has(x, remove));
      else if (typeof v === 'string') next = v.split(/\s*[\n,;]\s*/).filter((x) => x && !holds(x, [...fileKeys(remove), M[remove].title])).join(', ');
    }
    if (add && like && has(v, like)) {
      const swap = (s) => {
        let out = s;
        const from = [...fileKeys(like), M[like].title]; const to = [...fileKeys(add), M[add].title];
        const pairs = from.map((f, i) => [f, to[i]]).filter(([f, t]) => f && t).sort((a, b) => b[0].length - a[0].length);
        for (const [f, t] of pairs) out = out.split(f).join(t);
        return out;
      };
      if (Array.isArray(v)) { const tpl = v.find((x) => has(x, like)); next = [...v, JSON.parse(swap(JSON.stringify(tpl)))]; }
      else if (typeof v === 'string') next = `${v}, ${M[add].kind === 'file' ? M[add].file.split(path.sep).join('/') : M[add].title}`;
    }
    if (next === null) continue;
    const r = await S.cmd('database.setCell', row.pageId, c.id, next);
    if (!r.ok) throw new Error(`database.setCell on ${c.name} refused: ${r.e}`);
    return { column: c.name, before: v, after: next };
  }
  throw new Error(`no Material cell of ${unit} holds ${remove ? M[remove].title : M[like].title} (it holds: ${materialOf(ws, A.units, unit).slice(0, 200)})`);
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
const historyOf = (state) => (state === 'N' ? {} : { 'Times Attempted': state === 'R' ? 2 : 1, 'Times Correct': state === 'R' ? 2 : 0, 'Last Result': RESULT[state] });
function seedTools(ws) {
  let d = new DatabaseSync(coreFile(ws));
  const DAY = 86400000; const NOW = Date.now();
  const sheet = (title) => JSON.stringify({ id: 'wb', sheetOrder: ['s1'], appVersion: '0.1', sheets: { s1: { id: 's1', name: 'Sheet1', rowCount: 40, columnCount: 12, cellData: { 0: { 0: { v: title } }, 2: { 1: { v: 'Given the following information:' } }, 7: { 1: { v: 'Question: estimate the ultimate loss.' } } } } } });
  try {
    d.exec('BEGIN');
    const insItem = d.prepare("INSERT INTO ws_items (title, question_md, created_at, sheet_json, paper, source, kind, quadrant, sheet_name, source_label) VALUES (?, '', ?, ?, ?, 'rf', 'quant', 1, ?, 'Probe workbook')");
    const insAttempt = d.prepare("INSERT INTO ws_attempts (item_id, started_at, updated_at, cells_json, self_grade, completed, seconds, session_id, imported, worked_at) VALUES (?, ?, ?, '', ?, 1, 300, '', 0, ?)");
    for (const [paper, counts] of Object.entries(P)) {
      let i = 0;
      ['easy', 'medium', 'hard', ''].forEach((grade, g) => { for (let k = 0; k < counts[g]; k++) { i += 1; const title = `RF ${P_LABEL[paper]} - ${i}`; const id = Number(insItem.run(title, NOW - (40 + i) * DAY, sheet(title), paper, title).lastInsertRowid); if (grade) insAttempt.run(id, NOW - 3 * DAY - 600000, NOW - 3 * DAY, grade, NOW - 3 * DAY); } });
    }
    d.exec('COMMIT');
  } finally { d.close(); }
  d = new DatabaseSync(cardsFile(ws));
  try {
    d.exec('BEGIN');
    const deck = Number(d.prepare("INSERT INTO fc_decks (name, description, created_at) VALUES (?, '', ?)").run(DECK, NOW - 40 * DAY).lastInsertRowid);
    const insCard = d.prepare('INSERT INTO fc_cards (deck_id, front, back, tags, created_at) VALUES (?, ?, ?, ?, ?)');
    const insReview = d.prepare("INSERT INTO fc_reviews (card_id, reviewed_at, rating, interval_before, interval_after, ease_before, ease_after, state_before, state_after, ms_taken) VALUES (?, ?, ?, 0, ?, 2.5, 2.5, 'new', ?, 4000)");
    const setCard = d.prepare('UPDATE fc_cards SET state = ?, reps = 1, lapses = ?, interval_days = ?, due_at = ?, last_reviewed_at = ? WHERE id = ?');
    const RATING = { A: 1, H: 2, G: 3, E: 4 };
    for (const [tag, states] of Object.entries(CARD_TAGS)) [...states].forEach((s, i) => {
      const id = Number(insCard.run(deck, `Card ${tag} ${i + 1}: what holds?`, `Answer ${tag} ${i + 1}.`, tag, NOW - 30 * DAY).lastInsertRowid);
      if (s === 'N') return;
      insReview.run(id, NOW - 2 * DAY, RATING[s], s === 'A' ? 0 : 6, s === 'A' ? 'relearning' : 'review');
      setCard.run(s === 'A' ? 'relearning' : 'review', s === 'A' ? 1 : 0, s === 'A' ? 0 : 6, NOW + 4 * DAY, NOW - 2 * DAY, id);
    });
    d.exec('COMMIT');
  } finally { d.close(); }
}
/** Clark's questions up to 300: copies of a row the app made, written with the app closed. */
function seedManyQuestions(ws, bankId) {
  const cols = columns(ws, bankId);
  const d = new DatabaseSync(coreFile(ws));
  let added = 0;
  try {
    const clark = d.prepare("SELECT p.id FROM pages p JOIN database_pages dp ON dp.page_id = p.id WHERE dp.database_id = ? AND p.title LIKE 'What does Clark%' LIMIT 1").get(bankId);
    const template = d.prepare('SELECT * FROM pages WHERE id = ?').get(clark.id);
    const names = Object.keys(template);
    const insPage = d.prepare(`INSERT INTO pages (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`);
    const insMember = d.prepare('INSERT INTO database_pages (database_id, page_id, sort_order) VALUES (?, ?, ?)');
    const insValue = d.prepare('INSERT INTO page_property_values (page_id, property_id, database_id, value) VALUES (?, ?, ?, ?)');
    d.exec('BEGIN');
    for (let i = 0; i < 300 - Q.Clark.reduce((t, n) => t + n, 0); i++) {
      const id = randomUUID();
      insPage.run(...names.map((n) => (n === 'id' ? id : n === 'title' ? `What does Clark hold about extra item ${i + 1}?` : n === 'sort_order' ? 1000 + i : template[n])));
      insMember.run(bankId, id, 1000 + i);
      insValue.run(id, col(cols, 'Paper').id, bankId, JSON.stringify('Clark'));
      insValue.run(id, col(cols, 'Model Answer').id, bankId, JSON.stringify(`Reference statement number${i} for Clark.`));
      added += 1;
    }
    d.exec('COMMIT');
  } finally { d.close(); }
  return added;
}

// ── The phases ───────────────────────────────────────────────────────────────
const PHASES = [];
const phase = (n, title, checks, fn) => PHASES.push({ n, title, checks, fn });
async function check(c, id, fn) {
  try { const [ok, got] = await fn(); c(id, ok, got); } catch (err) { c(id, false, `stopped: ${String((err && err.message) || err).split('\n')[0].slice(0, 360)}`); }
}
/** What the app opens each kind of file in, as phase 0 read it (file.openFile, the app's own route). */
const EDITOR_FOR = {};

phase(0, 'The ground the checks stand on (the app as it is today; none of it is new)', {
  '0.1': 'the seed as the app shows it: the subject and its six units in Study\'s sidebar; Worksheets\' dashboard has Mack and Clark with their counts',
  '0.2': 'Units has the column Also Called, and Mack\'s holds "Mack 1993, Chain Ladder"',
  '0.3': 'the seeded pages are where they were put: loose at the top, under "Reading Log", rows of "Lecture Notes"',
  '0.4': 'the app opens a page in the canvas editor (canvas.openPage), and the PDF, the Markdown and the image each in an editor of their own (file.openFile)',
  '0.5': 'the subject\'s More Actions menu opens and lists Open Units',
  '0.6': 'the New Subject sheet opens with its Name and Questions fields',
  '0.7': 'a page goes to the Trash by the canvas\'s own command',
  '0.8': 'a file is renamed in the app\'s Explorer (its row\'s menu, Rename)',
  '0.9': 'a tool is turned off and on without a restart; Appearance switches to light and back to dark',
}, async (S, c, A) => {
  const ws = S.workspace;
  await check(c, '0.1', async () => {
    await showStudySidebar(S);
    const t = await until(async () => { const x = await subjectsText(S); return x && UNITS.every((u) => x.includes(u)) ? x : null; }, 10_000);
    const dash = await dashboardPapers(S);
    return [!!t && same(dash.Mack, P.mack) && same(dash.Clark, P.clark), { subjects: (t || (await subjectsText(S)) || '').slice(0, 200), dashboard: dash }];
  });
  await check(c, '0.2', async () => {
    const v = rowTitled(ws, A.units, 'Mack')?.values['Also Called'];
    return [!!col(columns(ws, A.units), 'Also Called') && norm(v) === ALSO_CALLED.Mack, { alsoCalled: v ?? null }];
  });
  await check(c, '0.3', async () => {
    const top = ['mackPage', 'compared', 'chain', 'hurli', 'grocery', 'log'].every((k) => pageRow(ws, A.ids[k])?.parent_id == null);
    const under = ['fried', 'week3'].every((k) => pageRow(ws, A.ids[k])?.parent_id === A.ids.log);
    const rows = ['venterRow', 'adminRow'].every((k) => coreAll(ws, 'SELECT 1 FROM database_pages WHERE database_id = ? AND page_id = ?', [A.lectures, A.ids[k]]).length === 1);
    return [top && under && rows, { top, under, rows }];
  });
  await check(c, '0.4', async () => {
    await S.cmd('canvas.openPage', A.ids.fried);
    const page = await until(async () => { const a = await S.active(); return a && a.id.includes(A.ids.fried) ? a : null; }, 5000);
    const got = { page };
    for (const k of ['pdf', 'md', 'png']) {
      await S.cmd('file.openFile', path.join(ws, M[k].file));
      got[k] = await until(async () => { const a = await S.active(); return a && a.file === path.join(ws, M[k].file) ? a : null; }, 6000);
      if (got[k]) EDITOR_FOR[k] = got[k].typeId;
    }
    const kinds = ['pdf', 'md', 'png'].map((k) => got[k]?.typeId);
    return [!!page && page.typeId === 'canvas' && kinds.every(Boolean) && new Set(kinds).size === 3, { page: page ? page.typeId : null, pdf: kinds[0], md: kinds[1], png: kinds[2] }];
  });
  await check(c, '0.5', async () => {
    const items = await rowMenu(S, SUBJECT);
    await S.page.keyboard.press('Escape');
    return [!!items && items.some((i) => /^Open Units$/.test(i.name)), items ? items.map((i) => i.name) : 'no More Actions on the subject\'s row'];
  });
  await check(c, '0.6', async () => {
    S.run('study.newSubject');
    const open = await until(() => S.formOpen(), 6000);
    const name = open ? await S.field(F.name) : null; const q = open ? await S.field(F.questions) : null;
    await S.shot('00-new-subject-sheet');
    if (open) { (await S.press('form', /^cancel$/i, 'button')) || (await S.page.keyboard.press('Escape')); await sleep(500); }
    return [!!name && !!q, { sheet: !!open, name: !!name, questions: !!q }];
  });
  await check(c, '0.7', async () => [!!(await toTrash(S, A.ids.grocery)), pageRow(ws, A.ids.grocery)?.is_archived]);
  await check(c, '0.8', async () => {
    const ok = await explorerRename(S, M.txt.title, 'Grocery list old.txt');
    return [!!ok, { renamedOnDisk: existsSync(path.join(ws, 'Grocery list old.txt')) }];
  });
  await check(c, '0.9', async () => {
    await S.setTool('worksheets', false); const off = !(await S.hasCommand('worksheet.dashboard'));
    await S.setTool('worksheets', true); const on = await S.hasCommand('worksheet.dashboard');
    const ground = () => S.page.evaluate(() => { const m = /rgba?\(([^)]+)\)/.exec(getComputedStyle(document.body).backgroundColor); const p = m ? m[1].split(',').map(parseFloat) : [0, 0, 0]; return (p[0] + p[1] + p[2]) / 3; });
    await setMode(S, 'light'); const light = await ground();
    await setMode(S, 'dark'); const dark = await ground();
    return [off && on && light > 180 && dark < 80, { off, on, light, dark }];
  });
});

phase(1, 'Open a unit', {
  '1.1': 'pressing Mack in Study\'s sidebar opens a tab titled "Exam 7 · Mack", in front',
  '1.2': 'pressed again after another tab came forward, the same one tab comes forward (no second)',
  '1.3': 'another unit opens a tab of its own: "Exam 7 · Clark" beside "Exam 7 · Mack"',
  '1.4': '"Study…" on the unit\'s tab opens the setup sheet on that unit: Start asks only Clark\'s questions',
  '1.5': 'the unit row\'s More Actions in the sidebar has "Study…", and it opens the setup sheet on that unit',
  '1.6': 'after the app is closed and opened, pressing Mack still gives one tab "Exam 7 · Mack"',
}, async (S, c) => {
  await check(c, '1.1', async () => {
    await openUnit(S, 'Mack');
    await S.shot('01-unit-tab');
    const tabs = await tabTitled(S, tabTitle('Mack'));
    return [tabs.length === 1 && tabs[0].active, (await S.tabs()).map((t) => t.label)];
  });
  await check(c, '1.2', async () => {
    must((await tabTitled(S, tabTitle('Mack'))).length, `the tab "${tabTitle('Mack')}"`);
    await S.cmd('file.openFile', path.join(S.workspace, M.md.file));
    await until(async () => !(await tabTitled(S, tabTitle('Mack'))).some((t) => t.active), 4000);
    await openUnit(S, 'Mack');
    await sleep(500);
    const tabs = await tabTitled(S, tabTitle('Mack'));
    return [tabs.length === 1 && tabs[0].active, { tabsTitledSo: tabs.length, front: tabs.some((t) => t.active) }];
  });
  await check(c, '1.3', async () => {
    await openUnit(S, 'Clark');
    const both = [(await tabTitled(S, tabTitle('Mack'))).length, (await tabTitled(S, tabTitle('Clark'))).length];
    return [same(both, [1, 1]), { mack: both[0], clark: both[1] }];
  });
  await check(c, '1.4', async () => {
    must(await showTab(S, tabTitle('Clark')), `the tab "${tabTitle('Clark')}"`);
    must(await S.press('pane', /^Study(…|\.\.\.)$/), `"Study…" on the tab "${tabTitle('Clark')}"`);
    const sheet = await until(() => sheetOpen(S), 4000);
    const first = sheet ? await cardAfter(S, 4000) : null;
    const r = first ? await sessionStems(S, first) : { seen: [], ended: false };
    await closeStudyTabs(S);
    return [!!sheet && r.ended && same(r.seen, stemsOf('Clark')), { setupSheet: !!sheet, asked: r.seen.length, want: stemsOf('Clark').length, same: same(r.seen, stemsOf('Clark')) }];
  });
  await check(c, '1.5', async () => {
    const items = await rowMenu(S, 'Friedland', SUBJECT);
    if (!items) return [false, 'no More Actions on the unit\'s row in the sidebar'];
    const it = items.find((i) => /^Study(…|\.\.\.)$/.test(i.name));
    if (!it) { await S.page.keyboard.press('Escape'); return [false, { menu: items.map((i) => i.name) }]; }
    await S.click(it);
    const sheet = await until(() => sheetOpen(S), 4000);
    const first = sheet ? await cardAfter(S, 4000) : null;
    const r = first ? await sessionStems(S, first) : { seen: [], ended: false };
    await closeStudyTabs(S);
    return [!!sheet && r.ended && same(r.seen, stemsOf('Friedland')), { menu: items.map((i) => i.name), setupSheet: !!sheet, asked: r.seen }];
  });
  await check(c, '1.6', async () => {
    await S.relaunch();
    await showStudySidebar(S);
    await openUnit(S, 'Mack');
    await sleep(600);
    return [(await tabTitled(S, tabTitle('Mack'))).length === 1, (await S.tabs()).map((t) => t.label)];
  });
});

phase(2, 'Everything of a unit in one tab, grouped by kind', {
  '2.1': 'the tab of Mack has the groups "Notes and files", "Questions", and one per tool that reports progress ("Problems", "Cards", "Drills"), in that order',
  '2.2': 'Notes and files lists what was attached, each by its title or file name, and its heading counts them',
  '2.3': 'each item shows where it lives: a file\'s folders, a page\'s parent page, the database a row is in',
  '2.4': 'Questions: "8" in its heading, and 3 right, 1 partly, 2 wrong, 2 not yet',
  '2.5': 'Problems in Worksheets\' words, with its counts: 7, and 2 easy, 1 medium, 1 hard, 3 not rated',
  '2.6': 'Cards in Flashcards\' words: 5, and 2 good or easy, 1 hard, 1 again, 1 not reviewed',
  '2.7': 'a tool the app cannot know (the probe\'s own) has its group in its own words: Drills 9, 4 crisp, 2 shaky, 1 blank, 2 untried',
  '2.8': 'a unit with nothing attached says so in a line under Notes and files, with how to add to it',
  '2.9': 'a unit with no questions says so in a line under Questions, with how to add to it',
}, async (S, c) => {
  await openUnit(S, 'Mack');
  await attach(S, 'Mack', ['compared', 'md']);
  await attach(S, 'Friedland', ['fried', 'venterRow', 'pdf']);
  must(await showTab(S, tabTitle('Mack')), `the tab "${tabTitle('Mack')}"`);
  const r = await waitTab(S, (g) => GROUP_NAMES.every((n) => groupOf(g, n)), 5000);
  await S.shot('02-unit-groups');
  console.log(`   groups: ${brief(r.groups)}`);
  await check(c, '2.1', async () => {
    const order = [...r.groups].sort((a, b) => a.y - b.y).map((g) => g.name);
    const iN = order.indexOf(NOTES); const iQ = order.indexOf('Questions'); const tools = ['Problems', 'Cards', 'Drills'].map((n) => order.indexOf(n));
    return [iN === 0 && iQ === 1 && tools.every((i) => i > 1), { order }];
  });
  await check(c, '2.2', async () => {
    const g = groupOf(r.groups, NOTES);
    const titles = notesTitles(r.items);
    return [!!g && g.count === 2 && same(titles, [M.compared.title, M.md.title].sort()), { heading: g ? g.heading : null, items: titles }];
  });
  await check(c, '2.3', async () => {
    must(await showTab(S, tabTitle('Friedland')), `the tab "${tabTitle('Friedland')}"`);
    const t = await waitTab(S, (g, it) => ['fried', 'venterRow', 'pdf'].every((k) => itemOf(it, M[k].title)), 4000);
    const got = Object.fromEntries(['fried', 'venterRow', 'pdf'].map((k) => { const it = itemOf(t.items, M[k].title); return [M[k].title, it ? { row: it.row, lives: M[k].lives.every((w) => it.row.includes(w)) } : null]; }));
    await S.shot('02-where-it-lives');
    return [Object.values(got).every((x) => x && x.lives), got];
  });
  must(await showTab(S, tabTitle('Mack')), `the tab "${tabTitle('Mack')}"`);
  const groupCheck = (name, total, counts, words) => async () => {
    const g = groupOf((await waitTab(S, (gs) => groupOf(gs, name), 3000)).groups, name);
    if (!g) return [false, `no group "${name}" (the tab shows: ${brief(await S.groups()) || norm(await S.text('pane')).slice(0, 160)})`];
    const got = countsIn(g.text, words);
    return [g.count === total && same(got, counts), { heading: g.heading, counts: got, want: counts, text: g.text.slice(0, 160) }];
  };
  await check(c, '2.4', groupCheck('Questions', 8, Q.Mack, WORDS.Questions));
  await check(c, '2.5', groupCheck('Problems', 7, P.mack, WORDS.Problems));
  await check(c, '2.6', groupCheck('Cards', 5, C.Mack, WORDS.Cards));
  await check(c, '2.7', groupCheck('Drills', 9, DRILL_MACK, WORDS.Drills));
  await check(c, '2.8', async () => {
    await openUnit(S, 'Venter');
    const t = await waitTab(S, (g) => groupOf(g, NOTES), 4000);
    const g = groupOf(t.groups, NOTES);
    await S.shot('02-nothing-attached');
    return [!!g && (g.count === 0 || g.count === null) && /\b(no|nothing|none)\b/i.test(g.text) && /Add Notes or Files/i.test(g.text + ' ' + g.controls.map((x) => x.name).join(' ')), { group: g ? { heading: g.heading, text: g.text.slice(0, 200), controls: g.controls.map((x) => x.name) } : null }];
  });
  await check(c, '2.9', async () => {
    await openUnit(S, 'Siewert');
    const t = await waitTab(S, (g) => groupOf(g, 'Questions'), 4000);
    const g = groupOf(t.groups, 'Questions');
    return [!!g && /\bno questions\b|\bnothing\b|\bnone\b/i.test(g.text) && /\b(add|open|import|make|write)\b/i.test(g.text), { group: g ? { heading: g.heading, text: g.text.slice(0, 200) } : null }];
  });
});

phase(3, 'Open anything with one press, in its own editor', {
  '3.1': 'a page at the top of the canvas opens in the canvas editor, that page',
  '3.2': 'a page under another page, and a row of a canvas database, each open in the canvas editor as that page',
  '3.3': 'the PDF two folders down opens in the PDF editor, that file',
  '3.4': 'the Markdown and the image each open in what the app opens them with, that file',
  '3.5': 'a control of the Questions group opens the setup sheet on the unit: Start asks only Venter\'s questions',
  '3.6': 'another control of the Questions group opens the Questions database',
  '3.7': 'a control of a tool\'s group asks that tool, through its provider, to open the unit\'s group (the probe\'s provider is told "mack")',
  '3.8': 'a control of the Problems group opens Worksheets on Mack\'s problems (a tab of its own comes to the front)',
}, async (S, c, A) => {
  const ws = S.workspace;
  await openUnit(S, 'Venter');
  await attach(S, 'Venter', ['chain', 'fried', 'venterRow', 'pdf', 'md', 'png']);
  /** Press "Open <title>" in the unit's tab and read the active editor. */
  const openIt = async (k) => {
    must(await showTab(S, tabTitle('Venter')), `the tab "${tabTitle('Venter')}"`);
    const it = must(itemOf(await S.items(), M[k].title), `the item "Open ${M[k].title}"`);
    await S.click(it.open);
    const want = M[k].kind === 'file' ? path.join(ws, M[k].file) : A.ids[k];
    const a = await until(async () => { const x = await S.active(); return x && (M[k].kind === 'file' ? x.file === want : x.id.includes(want)) ? x : null; }, 5000);
    return a || { not: await S.active() };
  };
  await check(c, '3.1', async () => { const a = await openIt('chain'); return [a.typeId === 'canvas', a]; });
  await check(c, '3.2', async () => { const a = await openIt('fried'); const b = await openIt('venterRow'); await S.shot('03-row-page-open'); return [a.typeId === 'canvas' && b.typeId === 'canvas', { child: a, row: b }]; });
  await check(c, '3.3', async () => { const a = await openIt('pdf'); await S.shot('03-pdf-open'); return [a.typeId === 'parallx.editor.pdf' && (!EDITOR_FOR.pdf || a.typeId === EDITOR_FOR.pdf), a]; });
  await check(c, '3.4', async () => {
    const md = await openIt('md'); const png = await openIt('png');
    const wantMd = EDITOR_FOR.md || 'parallx.editor.file'; const wantPng = EDITOR_FOR.png || 'parallx.editor.image';
    return [md.typeId === wantMd && png.typeId === wantPng, { md, png, want: { md: wantMd, png: wantPng } }];
  });
  const questionsControls = async () => {
    must(await showTab(S, tabTitle('Venter')), `the tab "${tabTitle('Venter')}"`);
    const g = groupOf((await waitTab(S, (gs) => groupOf(gs, 'Questions'), 3000)).groups, 'Questions');
    return g ? g.controls.filter((x) => !x.disabled && !/^(remove|delete)\b/i.test(x.name)) : [];
  };
  const tried = [];
  await check(c, '3.5', async () => {
    const list = await questionsControls();
    if (!list.length) return [false, 'no control in a Questions group'];
    for (const ctl of list) {
      must(await showTab(S, tabTitle('Venter')), 'the unit tab');
      const now = (await questionsControls()).find((x) => x.name === ctl.name);
      if (!now) continue;
      await S.click(now);
      const sheet = await until(() => sheetOpen(S), 2500);
      tried.push({ name: ctl.name, sheet: !!sheet, active: await S.active() });
      if (!sheet) continue;
      const first = await cardAfter(S, 4000);
      const r = first ? await sessionStems(S, first) : { seen: [], ended: false };
      await closeStudyTabs(S);
      return [r.ended && same(r.seen, stemsOf('Venter')), { control: ctl.name, asked: r.seen.length, want: stemsOf('Venter').length }];
    }
    return [false, { tried }];
  });
  await check(c, '3.6', async () => {
    const list = await questionsControls();
    for (const ctl of list) {
      must(await showTab(S, tabTitle('Venter')), 'the unit tab');
      const now = (await questionsControls()).find((x) => x.name === ctl.name);
      if (!now) continue;
      await S.click(now);
      const a = await until(async () => { const x = await S.active(); return x && x.id.includes(A.bank) ? x : null; }, 2500);
      if (await sheetOpen(S)) await closeStudyTabs(S);
      if (a) return [true, { control: ctl.name, active: a }];
    }
    return [false, { controls: list.map((x) => x.name), tried }];
  });
  await check(c, '3.7', async () => {
    await openUnit(S, 'Mack');
    const before = (await doorState(S)).opened.length;
    const g = groupOf((await waitTab(S, (gs) => groupOf(gs, 'Drills'), 4000)).groups, 'Drills');
    if (!g) return [false, 'no group "Drills" in the tab of Mack'];
    for (const ctl of g.controls.filter((x) => !x.disabled)) {
      must(await showTab(S, tabTitle('Mack')), 'the unit tab');
      await S.click(ctl);
      const st = await until(async () => { const s = await doorState(S); return s.opened.length > before ? s : null; }, 2000);
      if (st) { const last = st.opened[st.opened.length - 1]; return [last.groups.some((x) => plain(x) === 'mack') && !last.groups.some((x) => plain(x) === 'zeta'), { control: ctl.name, openedWith: last }]; }
    }
    return [false, { controls: g.controls.map((x) => x.name), opened: 'the provider\'s open was never called' }];
  });
  await check(c, '3.8', async () => {
    must(await showTab(S, tabTitle('Mack')), 'the unit tab');
    const g = groupOf(await S.groups(), 'Problems');
    if (!g) return [false, 'no group "Problems" in the tab of Mack'];
    for (const ctl of g.controls.filter((x) => !x.disabled)) {
      must(await showTab(S, tabTitle('Mack')), 'the unit tab');
      const tabsBefore = (await S.tabs()).map((t) => t.id);
      await S.click(ctl);
      const t = await until(async () => { const front = (await S.tabs()).find((x) => x.active); return front && !tabsBefore.includes(front.id) && front.label !== tabTitle('Mack') ? front : null; }, 4000);
      if (t) { await S.shot('03-worksheets-from-group'); return [true, { control: ctl.name, opened: t.label }]; }
    }
    return [false, { controls: g.controls.map((x) => x.name) }];
  });
});

phase(4, 'Attach material, any layout', {
  '4.1': '"Add Notes or Files…" on the unit\'s tab opens a picker with a field to search in',
  '4.2': 'the picker offers every kind of page and file: a page under another, a row of a database, a loose page, a PDF two folders down, Markdown, an image, plain text',
  '4.3': 'it is searchable by path: "Week 1" finds the PDF in Readings/Week 1 and not Clark.md; "clark" finds Clark.md and "Mack and Clark Compared", and not Siewert.png',
  '4.4': 'several chosen at once are all attached to the unit: its tab lists the three, and so does its Material in the workspace file',
  '4.5': 'a page may belong to several units: "Mack and Clark Compared" attached to Clark too is in both tabs',
  '4.6': 'the same item chosen again for the same unit is listed once',
  '4.7': '"Remove" takes Clark.md off Mack (gone from the tab and from Material) and the file on disk is untouched',
  '4.8': '"Remove" of the shared page from Clark leaves it on Mack, and the page itself is untouched',
}, async (S, c, A) => {
  const ws = S.workspace;
  await openUnit(S, 'Mack');
  await check(c, '4.1', async () => {
    await openPicker(S, 'Mack');
    const f = await S.page.evaluate(() => window.__ap.searchField());
    await S.shot('04-picker');
    return [!!f, { searchField: !!f, picker: norm(await S.formText()).slice(0, 200) }];
  });
  await check(c, '4.2', async () => {
    must(await S.formOpen(), 'the picker');
    const got = {};
    for (const k of ['week3', 'adminRow', 'chain', 'pdf', 'md', 'png', 'txt']) { await search(S, M[k].title); got[M[k].title] = !!(await until(() => choiceFor(S, M[k].title), 2500)); }
    return [Object.values(got).every(Boolean), got];
  });
  await check(c, '4.3', async () => {
    must(await S.formOpen(), 'the picker');
    await search(S, 'Week 1');
    const a = { pdf: !!(await until(() => choiceFor(S, M.pdf.title), 2500)), md: !!(await choiceFor(S, M.md.title)) };
    await search(S, 'clark');
    const b = { md: !!(await until(() => choiceFor(S, M.md.title), 2500)), compared: !!(await choiceFor(S, M.compared.title)), png: !!(await choiceFor(S, M.png.title)) };
    return [a.pdf && !a.md && b.md && b.compared && !b.png, { 'Week 1': a, clark: b }];
  });
  await check(c, '4.4', async () => {
    if (!(await S.formOpen())) await openPicker(S, 'Mack');
    const ticked = {};
    for (const k of ['compared', 'md', 'png']) ticked[M[k].title] = await tick(S, M[k].title);
    await search(S, '');
    await confirmPicker(S);
    const t = await waitTab(S, (g, it) => ['compared', 'md', 'png'].every((k) => itemOf(it, M[k].title)), 4000);
    const inFile = await until(() => ['compared', 'md', 'png'].every((k) => holds(materialOf(ws, A.units, 'Mack'), keysOf(ws, { pageId: A.ids[k], file: M[k].file }))), 3000);
    await S.shot('04-three-attached');
    return [t.ok && !!inFile, { ticked, tab: notesTitles(t.items), material: materialOf(ws, A.units, 'Mack').slice(0, 300) }];
  });
  await check(c, '4.5', async () => {
    await openUnit(S, 'Clark');
    await attach(S, 'Clark', ['compared']);
    must(await showTab(S, tabTitle('Mack')), 'the tab of Mack');
    const mack = await waitTab(S, (g, it) => itemOf(it, M.compared.title), 3000);
    return [mack.ok && holds(materialOf(ws, A.units, 'Clark'), [A.ids.compared]) && holds(materialOf(ws, A.units, 'Mack'), [A.ids.compared]), { mack: notesTitles(mack.items), clarkMaterial: materialOf(ws, A.units, 'Clark').slice(0, 200) }];
  });
  await check(c, '4.6', async () => {
    await openPicker(S, 'Mack');
    await tick(S, M.png.title);
    await confirmPicker(S);
    await sleep(800);
    const titles = notesTitles(await S.items());
    return [titles.filter((t) => t === M.png.title).length === 1, { listed: titles }];
  });
  await check(c, '4.7', async () => {
    const before = sha(path.join(ws, M.md.file));
    must(await showTab(S, tabTitle('Mack')), 'the tab of Mack');
    const gone = await pressRemove(S, 'Mack', M.md.title);
    const fileGone = await until(() => !holds(materialOf(ws, A.units, 'Mack'), keysOf(ws, { file: M.md.file })), 3000);
    return [!!gone && !!fileGone && sha(path.join(ws, M.md.file)) === before && before !== null, { goneFromTab: !!gone, goneFromMaterial: !!fileGone, fileSame: sha(path.join(ws, M.md.file)) === before }];
  });
  await check(c, '4.8', async () => {
    const page = JSON.stringify(pageRow(ws, A.ids.compared));
    must(await showTab(S, tabTitle('Clark')), 'the tab of Clark');
    const gone = await pressRemove(S, 'Clark', M.compared.title);
    must(await showTab(S, tabTitle('Mack')), 'the tab of Mack');
    const still = await waitTab(S, (g, it) => itemOf(it, M.compared.title), 3000);
    return [!!gone && still.ok && JSON.stringify(pageRow(ws, A.ids.compared)) === page && holds(materialOf(ws, A.units, 'Mack'), [A.ids.compared]) && !holds(materialOf(ws, A.units, 'Clark'), [A.ids.compared]), { goneFromClark: !!gone, stillOnMack: still.ok, pageUntouched: JSON.stringify(pageRow(ws, A.ids.compared)) === page }];
  });
});

phase(5, 'Study proposes, he decides: Find Matches…', {
  '5.1': '"Find Matches…" is in the subject\'s More Actions, and opens a list of proposals',
  '5.2': 'every page and file whose name is a unit\'s (case, spaces, punctuation, accents aside) or an Also Called of it is proposed, with that unit',
  '5.3': 'nothing that matches no unit is proposed (Grocery List, Grocery list.txt, Week 3 Thoughts, Admin, Reading Log)',
  '5.4': 'every proposal\'s checkbox is unticked',
  '5.5': 'nothing is attached while the list is open, nor after it is closed without "Attach Selected"',
  '5.6': '"Attach Selected" attaches the ticked ones (Clark.md to Clark, hurlimann to Hürlimann), and nothing else',
}, async (S, c, A) => {
  const ws = S.workspace;
  const attachedNow = () => UNITS.map((u) => [u, materialOf(ws, A.units, u)]).filter(([, v]) => v && !/^(\[\]|""|null|\s|\|)*$/.test(v));
  const openMatches = async () => {
    const items = must(await rowMenu(S, SUBJECT), 'the subject\'s More Actions menu');
    const it = items.find((i) => /^Find Matches(…|\.\.\.)$/.test(i.name));
    if (!it) { await S.page.keyboard.press('Escape'); throw new Error(`no "Find Matches…" in the subject's More Actions (it has: ${items.map((i) => i.name).join(', ')})`); }
    await S.click(it);
    must(await until(() => S.formOpen(), 5000), 'a list of proposals after "Find Matches…"');
    await sleep(800);
  };
  let list = [];
  await check(c, '5.1', async () => {
    await openMatches();
    list = await until(async () => { const x = await S.choices(); return x.length ? x : null; }, 5000) || [];
    await S.shot('05-find-matches');
    return [list.length > 0, { proposals: list.length, text: norm(await S.formText()).slice(0, 200) }];
  });
  const rowFor = (k) => list.filter((ch) => lineIs(ch, M[k].title));
  await check(c, '5.2', async () => {
    const got = Object.fromEntries(MUST_PROPOSE.map(([k, unit]) => [`${M[k].title} → ${unit}`, rowFor(k).some((ch) => plain(ch.text).includes(plain(unit)))]));
    console.log(`   proposals: ${list.map((ch) => ch.text.slice(0, 60)).join(' | ')}`);
    return [list.length > 0 && Object.values(got).every(Boolean), got];
  });
  await check(c, '5.3', async () => {
    const wrong = MUST_NOT.filter((k) => rowFor(k).length);
    return [list.length > 0 && wrong.length === 0, { proposedThoughNoMatch: wrong.map((k) => M[k].title) }];
  });
  await check(c, '5.4', async () => [list.length > 0 && list.every((ch) => !ch.on), { ticked: list.filter((ch) => ch.on).map((ch) => ch.text.slice(0, 50)) }]);
  await check(c, '5.5', async () => {
    const whileOpen = attachedNow();
    (await S.press('form', /^(cancel|close)$/i, 'button')) || (await S.page.keyboard.press('Escape'));
    await until(async () => !(await S.formOpen()), 3000);
    await sleep(1500);
    const after = attachedNow();
    return [list.length > 0 && whileOpen.length === 0 && after.length === 0, { whileOpen, afterClosing: after }];
  });
  await check(c, '5.6', async () => {
    await openMatches();
    list = await until(async () => { const x = await S.choices(); return x.length ? x : null; }, 5000) || [];
    for (const k of ['md', 'hurli']) {
      const ch = must(rowFor(k)[0], `the proposal "${M[k].title}"`);
      await S.click(ch);
      await sleep(250);
    }
    const on = (await S.choices()).filter((ch) => ch.on).map((ch) => ch.text.slice(0, 50));
    must(await S.press('form', /^Attach Selected$/, 'button'), '"Attach Selected"');
    await until(async () => !(await S.formOpen()), 4000);
    const ok = await until(() => holds(materialOf(ws, A.units, 'Clark'), keysOf(ws, { file: M.md.file })) && holds(materialOf(ws, A.units, 'Hürlimann'), [A.ids.hurli]), 3000);
    const others = attachedNow().filter(([u]) => u !== 'Clark' && u !== 'Hürlimann');
    const clark = materialOf(ws, A.units, 'Clark');
    const onlyOne = !['compared', 'mackPage', 'chain', 'pdf', 'png', 'fried', 'venterRow'].some((k) => holds(clark, keysOf(ws, { pageId: A.ids[k], file: M[k].file })));
    return [!!ok && others.length === 0 && onlyOne && on.length === 2, { ticked: on, clark: clark.slice(0, 160), hurlimann: materialOf(ws, A.units, 'Hürlimann').slice(0, 160), others }];
  });
});

phase(6, 'The Material column in Units is his', {
  '6.1': 'Units has a column named "Material", and its cells can be edited in the table (not kept by Study)',
  '6.2': 'Mack\'s Material cell in the table names every item attached to Mack',
  '6.3': 'a file added in the Material cell shows in Mack\'s tab within 2 s',
  '6.4': 'a page added in the Material cell shows in Mack\'s tab within 2 s',
  '6.5': 'an item removed in the Material cell goes from Mack\'s tab within 2 s',
}, async (S, c, A) => {
  const ws = S.workspace;
  await openUnit(S, 'Mack');
  await attach(S, 'Mack', ['compared', 'md']);
  await check(c, '6.1', async () => {
    must(await openDb(S, A.units), 'the Units database open in the app');
    const cell = await until(async () => { const x = await S.cell(A.units, 'Mack', 'Material'); return x && x.found ? x : null; }, 3000);
    await S.shot('06-material-column');
    return [!!cell && materialCols(ws, A.units).some((x) => low(x.name) === 'material') && cell.editable && !/kept by study/i.test(cell.says), { columns: columns(ws, A.units).map((x) => `${x.name} (${x.type})`), cell }];
  });
  await check(c, '6.2', async () => {
    must(await openDb(S, A.units), 'the Units database');
    const cell = await until(async () => { const x = await S.cell(A.units, 'Mack', 'Material'); return x && x.found && x.text.includes(M.compared.title) && x.text.includes(M.md.title) ? x : null; }, 3000);
    return [!!cell, { cell: cell ? cell.text : (await S.cell(A.units, 'Mack', 'Material')) }];
  });
  const shows = async (what, at, pred) => {
    must(await showTab(S, tabTitle('Mack')), 'the tab of Mack, still open');
    const r = await waitTab(S, (g, it) => pred(it), 6000);
    const took = (Date.now() - at) / 1000;
    console.log(`   ${what}: ${r.ok ? `shown ${took.toFixed(2)} s after it was written` : `not shown after ${took.toFixed(1)} s`}`);
    return [r.ok && took <= 2, { seconds: Number(took.toFixed(2)), tab: notesTitles(r.items) }];
  };
  await check(c, '6.3', async () => {
    const e = await editMaterial(S, A, 'Mack', { add: 'png', like: 'md' });
    const at = must(await until(() => (holds(materialOf(ws, A.units, 'Mack'), [M.png.title, ...keysOf(ws, { file: M.png.file })]) ? Date.now() : null), 3000, 20), 'Siewert.png in Mack\'s Material in the file');
    console.log(`   the cell ${e.column} went from ${JSON.stringify(e.before).slice(0, 120)} to ${JSON.stringify(e.after).slice(0, 160)}`);
    return shows('a file added in the Material cell', at, (it) => !!itemOf(it, M.png.title));
  });
  await check(c, '6.4', async () => {
    await editMaterial(S, A, 'Mack', { add: 'chain', like: 'compared' });
    const at = must(await until(() => (holds(materialOf(ws, A.units, 'Mack'), [A.ids.chain]) ? Date.now() : null), 3000, 20), 'Chain Ladder in Mack\'s Material in the file');
    return shows('a page added in the Material cell', at, (it) => !!itemOf(it, M.chain.title));
  });
  await check(c, '6.5', async () => {
    await editMaterial(S, A, 'Mack', { remove: 'compared' });
    const at = must(await until(() => (!holds(materialOf(ws, A.units, 'Mack'), [A.ids.compared]) ? Date.now() : null), 3000, 20), 'Mack and Clark Compared gone from Mack\'s Material in the file');
    return shows('an item removed in the Material cell', at, (it) => !itemOf(it, M.compared.title) && !!itemOf(it, M.md.title));
  });
});

phase(7, 'Gone things say so; a file renamed in the Explorer is followed', {
  '7.1': 'a page moved to the Trash shows in the unit as missing, in words, with Remove',
  '7.2': 'a file deleted on disk shows as missing, in words, with Remove; pressing its Open raises no error',
  '7.3': 'a file moved away on disk outside the app shows as missing, in words, with Remove',
  '7.4': 'Remove on a missing page takes it off the unit; the page stays in the Trash',
  '7.5': 'a file renamed in the app\'s Explorer is followed: the unit lists it by its new name, and Open opens the file at its new path',
  '7.6': 'after the app is closed and opened, the renamed file is still followed and the missing ones still say so',
}, async (S, c, A) => {
  const ws = S.workspace;
  await openUnit(S, 'Mack');
  await attach(S, 'Mack', ['chain', 'png', 'txt', 'md']);
  const errorsAt = pageErrors.length;
  const says = (it) => !!it && /\b(missing|not found|in the trash|deleted|moved|gone|no longer)\b/i.test(it.row) && !!it.remove;
  const missing = async (k) => {
    must(await showTab(S, tabTitle('Mack')), 'the tab of Mack');
    const r = await waitTab(S, (g, it) => says(itemOf(it, M[k].title)), 5000);
    return { ok: r.ok, row: itemOf(r.items, M[k].title)?.row ?? 'not listed' };
  };
  await check(c, '7.1', async () => {
    must(await toTrash(S, A.ids.chain), 'Chain Ladder in the Trash');
    const r = await missing('chain');
    await S.shot('07-page-in-trash');
    return [r.ok && pageErrors.length === errorsAt, { ...r, newPageErrors: pageErrors.slice(errorsAt) }];
  });
  await check(c, '7.2', async () => {
    await fs.rm(path.join(ws, M.png.file));
    const r = await missing('png');
    const it = itemOf(await S.items(), M.png.title);
    if (it) { await S.click(it.open); await sleep(1200); }
    await showTab(S, tabTitle('Mack'));
    return [r.ok && pageErrors.length === errorsAt, { ...r, newPageErrors: pageErrors.slice(errorsAt) }];
  });
  await check(c, '7.3', async () => {
    await fs.mkdir(path.join(ws, 'Archive'), { recursive: true });
    await fs.rename(path.join(ws, M.txt.file), path.join(ws, 'Archive', M.txt.title));
    const r = await missing('txt');
    return [r.ok, r];
  });
  await check(c, '7.4', async () => {
    must(await showTab(S, tabTitle('Mack')), 'the tab of Mack');
    const gone = await pressRemove(S, 'Mack', M.chain.title);
    return [!!gone && pageRow(ws, A.ids.chain)?.is_archived === 1 && !holds(materialOf(ws, A.units, 'Mack'), [A.ids.chain]) && pageErrors.length === errorsAt, { goneFromTab: !!gone, stillInTrash: pageRow(ws, A.ids.chain)?.is_archived === 1, newPageErrors: pageErrors.slice(errorsAt) }];
  });
  const RENAMED = 'Clark Notes.md';
  await check(c, '7.5', async () => {
    must(await explorerRename(S, M.md.title, RENAMED), `${M.md.title} renamed to ${RENAMED} in the Explorer`);
    must(await showTab(S, tabTitle('Mack')), 'the tab of Mack');
    const r = await waitTab(S, (g, it) => itemOf(it, RENAMED) && !says(itemOf(it, RENAMED)), 5000);
    const it = itemOf(r.items, RENAMED);
    let a = null;
    if (it) { await S.click(it.open); a = await until(async () => { const x = await S.active(); return x && x.file === path.join(ws, RENAMED) ? x : null; }, 5000); }
    await S.shot('07-renamed-followed');
    return [r.ok && !!a, { listed: notesTitles(r.items), opened: a }];
  });
  await check(c, '7.6', async () => {
    await S.relaunch();
    await openUnit(S, 'Mack');
    const r = await waitTab(S, (g, it) => itemOf(it, RENAMED) && says(itemOf(it, M.png.title)) && says(itemOf(it, M.txt.title)), 6000);
    return [r.ok, { items: r.items.map((i) => `${i.title}: ${i.row.slice(0, 60)}`) }];
  });
});

phase(8, 'New Subject loses its Notes choice; a subject made with one keeps working', {
  '8.1': 'the New Subject sheet has its Name and Questions and no Notes choice',
  '8.2': 'the subject made earlier with a notes database is still in Study\'s sidebar and its unit opens in its tab',
  '8.3': 'the notes database and its rows are as they were, and Study still has the subject in its store',
}, async (S, c, A) => {
  const ws = S.workspace;
  const fp = () => JSON.stringify([pageRow(ws, A.notes), rowsOf(ws, A.notes).map((r) => [r.title, r.values])]);
  const before = fp();
  await check(c, '8.1', async () => {
    S.run('study.newSubject');
    must(await until(() => S.formOpen(), 6000), 'the New Subject sheet');
    await sleep(500);
    const labels = await S.page.evaluate(() => window.__ap.fieldLabels());
    const name = await S.field(F.name); const q = await S.field(F.questions); const notes = await S.field(F.notes);
    await S.shot('08-new-subject');
    (await S.press('form', /^cancel$/i, 'button')) || (await S.page.keyboard.press('Escape'));
    await sleep(500);
    return [!!name && !!q && !notes && !labels.some((l) => /\bnotes?\b/i.test(l)), { fields: labels }];
  });
  await check(c, '8.2', async () => {
    await showStudySidebar(S);
    const t = await subjectsText(S);
    await openUnit(S, 'Mack');
    const g = await waitTab(S, (gs) => groupOf(gs, 'Questions'), 4000);
    return [!!t && t.includes('Mack') && g.ok, { sidebar: (t || '').slice(0, 120), groups: brief(g.groups) }];
  });
  await check(c, '8.3', async () => {
    await S.relaunch();
    await showStudySidebar(S);
    await sleep(1500);
    const sf = studyFile(ws);
    const kept = sf ? fileAll(sf, 'SELECT id FROM st_subjects WHERE name = ?', [SUBJECT]).length === 1 : false;
    let opened = false;
    try { await openUnit(S, 'Mack'); opened = true; } catch { opened = false; }
    return [fp() === before && kept && opened, { notesDatabaseSame: fp() === before, subjectInStudysStore: kept, unitOpensAfterRestart: opened }];
  });
});

phase(9, 'Everyone can use it', {
  '9.1': 'every control in the unit\'s tab has a name; each item is named "Open <title>" and "Remove <title> from Mack"',
  '9.2': 'Tab reaches every item\'s Open and Remove, "Add Notes or Files…" and "Study…", and each shows its focus',
  '9.3': 'Enter on a focused "Open Clark.md" opens Clark.md',
  '9.4': 'the picker opened by keyboard takes the focus, keeps Tab and Shift+Tab inside, and Escape gives the focus back to "Add Notes or Files…"',
  '9.5': 'a tap by finger on "Open Mack 1993.pdf" opens the PDF',
  '9.6': 'every piece of text in the tab reads at 4.5:1 (3:1 large) in light and in dark',
  '9.7': 'at 900 px wide the tab has no sideways scroll and every item\'s Open lies inside it',
}, async (S, c) => {
  await openUnit(S, 'Mack');
  await attach(S, 'Mack', ['compared', 'md', 'pdf']);
  const titles = ['compared', 'md', 'pdf'].map((k) => M[k].title);
  await check(c, '9.1', async () => {
    const it = await S.items();
    const unnamed = await S.page.evaluate(() => Array.from(window.__ap.scopeEl('pane').querySelectorAll('button, a[href], [role="button"], [role="link"], [role="checkbox"], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter((n) => window.__ap.shown(n) && !window.__ap.accName(n)).map((n) => n.outerHTML.slice(0, 80)));
    const named = titles.every((t) => { const x = itemOf(it, t); return x && x.remove && x.remove.name === `Remove ${t} from Mack`; });
    return [named && unnamed.length === 0, { items: it.map((x) => [x.title, x.remove ? x.remove.name : null]), unnamed }];
  });
  await check(c, '9.2', async () => {
    must(await showTab(S, tabTitle('Mack')), 'the tab of Mack');
    const want = new Set([...titles.flatMap((t) => [`Open ${t}`, `Remove ${t} from Mack`]), 'Add Notes or Files…', 'Study…']);
    const reached = new Map();
    await S.page.evaluate(() => { const p = window.__ap.scopeEl('pane'); p.setAttribute('tabindex', '-1'); p.focus(); });
    for (let i = 0; i < 80 && reached.size < want.size; i++) {
      await S.page.keyboard.press('Tab');
      const f = await S.focused();
      if (!f) continue;
      const name = f.name.replace(/\.\.\.$/, '…');
      if (want.has(name) && !reached.has(name)) reached.set(name, f.hasRing);
    }
    const missingNames = [...want].filter((n) => !reached.has(n)); const ringless = [...reached].filter(([, r]) => !r).map(([n]) => n);
    return [missingNames.length === 0 && ringless.length === 0, { notReached: missingNames, noFocusShown: ringless }];
  });
  await check(c, '9.3', async () => {
    must(await showTab(S, tabTitle('Mack')), 'the tab of Mack');
    await S.page.evaluate(() => { const p = window.__ap.scopeEl('pane'); p.setAttribute('tabindex', '-1'); p.focus(); });
    let on = false;
    for (let i = 0; i < 60 && !on; i++) { await S.page.keyboard.press('Tab'); on = (await S.focused())?.name === `Open ${M.md.title}`; }
    if (!on) return [false, 'Tab never reached "Open Clark.md"'];
    await S.page.keyboard.press('Enter');
    const a = await until(async () => { const x = await S.active(); return x && x.file === path.join(S.workspace, M.md.file) ? x : null; }, 4000);
    return [!!a, a || (await S.active())];
  });
  await check(c, '9.4', async () => {
    must(await showTab(S, tabTitle('Mack')), 'the tab of Mack');
    await S.page.evaluate(() => { const p = window.__ap.scopeEl('pane'); p.setAttribute('tabindex', '-1'); p.focus(); });
    let on = false;
    for (let i = 0; i < 60 && !on; i++) { await S.page.keyboard.press('Tab'); on = /^Add Notes or Files(…|\.\.\.)$/.test((await S.focused())?.name || ''); }
    if (!on) return [false, 'Tab never reached "Add Notes or Files…"'];
    await S.page.keyboard.press('Enter');
    const open = await until(() => S.formOpen(), 3000);
    if (!open) return [false, 'Enter on "Add Notes or Files…" opened no picker'];
    await sleep(400);
    const took = (await S.focused())?.inForm;
    const out = [];
    for (let i = 0; i < 25; i++) { await S.page.keyboard.press('Tab'); if (!(await S.focused())?.inForm) out.push(`Tab ${i + 1}`); }
    for (let i = 0; i < 10; i++) { await S.page.keyboard.press('Shift+Tab'); if (!(await S.focused())?.inForm) out.push(`Shift+Tab ${i + 1}`); }
    await S.page.keyboard.press('Escape');
    const closed = await until(async () => !(await S.formOpen()), 2000);
    await sleep(300);
    const back = await S.focused();
    return [!!took && out.length === 0 && !!closed && /^Add Notes or Files(…|\.\.\.)$/.test(back?.name || ''), { focusTaken: !!took, leftThePicker: out, closed: !!closed, focusAfter: back ? back.name : null }];
  });
  await check(c, '9.5', async () => {
    must(await showTab(S, tabTitle('Mack')), 'the tab of Mack');
    const it = must(itemOf(await S.items(), M.pdf.title), `"Open ${M.pdf.title}"`);
    const cdp = await S.page.context().newCDPSession(S.page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: it.open.x, y: it.open.y }] });
    await sleep(60);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const a = await until(async () => { const x = await S.active(); return x && x.file === path.join(S.workspace, M.pdf.file) ? x : null; }, 4000);
    return [!!a, a || (await S.active())];
  });
  await check(c, '9.6', async () => {
    const out = {};
    for (const mode of ['light', 'dark']) {
      await setMode(S, mode);
      must(await showTab(S, tabTitle('Mack')), 'the tab of Mack');
      must((await waitTab(S, (g) => groupOf(g, NOTES), 3000)).ok, 'the Notes and files group');
      await sleep(400);
      await S.shot(`09-unit-${mode}`);
      out[mode] = await S.page.evaluate(() => window.__ap.contrast('pane'));
    }
    return [out.light && out.dark && out.light.pieces > 0 && out.light.bad.length === 0 && out.dark.bad.length === 0, { light: out.light && { pieces: out.light.pieces, bad: out.light.bad.slice(0, 6) }, dark: out.dark && { pieces: out.dark.pieces, bad: out.dark.bad.slice(0, 6) } }];
  });
  await check(c, '9.7', async () => {
    await S.page.setViewportSize({ width: 900, height: 900 });
    await sleep(800);
    must(await showTab(S, tabTitle('Mack')), 'the tab of Mack');
    const r = await waitTab(S, (g, it) => titles.every((t) => itemOf(it, t)), 3000);
    const fit = await S.page.evaluate(() => window.__ap.fits());
    await S.shot('09-unit-900px');
    const outside = r.items.filter((i) => i.open.left < fit.left - 1 || i.open.right > fit.right + 1).map((i) => i.title);
    return [r.ok && fit.scrollsSideways.length === 0 && outside.length === 0, { ...fit, itemsOutside: outside }];
  });
});

phase(10, 'Tools on and off, Study off, and a big unit', {
  '10.1': 'Worksheets turned off: the Problems group goes from the open tab within 2 s; Notes and files, Questions, Cards and Drills stay',
  '10.2': 'Worksheets on again: the Problems group is back in the same tab',
  '10.3': 'Flashcards turned off: only the Cards group goes, within 2 s',
  '10.4': 'the probe\'s own tool turned off: only its Drills group goes, within 2 s',
  '10.5': 'Study turned off: the unit\'s tab and Study\'s commands go; the Material column, its cells, the pages and the files stay as they were',
  '10.6': 'Study on again: the unit opens with the same items',
  '10.7': 'a unit of 300 questions, 40 attached items and two tools\' groups shows its tab within 1 s of the press (the time is printed)',
}, async (S, c, A) => {
  const ws = S.workspace;
  await openUnit(S, 'Mack');
  await attach(S, 'Mack', ['compared', 'md', 'pdf']);
  const names = (g) => g.map((x) => x.name).sort();
  const before = await waitTab(S, (g) => GROUP_NAMES.every((n) => groupOf(g, n)), 5000);
  const offTimed = async (tool, group) => {
    must(await showTab(S, tabTitle('Mack')), 'the tab of Mack');
    const was = names((await S.groups()));
    must(was.includes(group), `the group ${group} before ${tool} is turned off (groups: ${was.join(', ')})`);
    const at = await S.setTool(tool, false);
    const r = await waitTab(S, (g) => !groupOf(g, group), 5000);
    const took = (Date.now() - at) / 1000;
    console.log(`   ${tool} off: its group gone ${r.ok ? `in ${took.toFixed(2)} s` : `not after ${took.toFixed(1)} s`}`);
    const left = names(r.groups);
    return [r.ok && took <= 2 && same(left, was.filter((n) => n !== group)) && same(notesTitles(r.items), notesTitles(before.items)), { seconds: Number(took.toFixed(2)), before: was, after: left }];
  };
  await check(c, '10.1', async () => { must(before.ok, `every group in the tab of Mack (it shows: ${brief(before.groups)})`); return offTimed('worksheets', 'Problems'); });
  await check(c, '10.2', async () => {
    await S.setTool('worksheets', true);
    must(await showTab(S, tabTitle('Mack')), 'the tab of Mack');
    const r = await waitTab(S, (g) => groupOf(g, 'Problems'), 10_000);
    return [r.ok && (await tabTitled(S, tabTitle('Mack'))).length === 1, { groups: names(r.groups) }];
  });
  await check(c, '10.3', async () => offTimed('flashcards', 'Cards'));
  await check(c, '10.4', async () => offTimed('door', 'Drills'));
  const fp = () => JSON.stringify([materialCols(ws, A.units).map((x) => [x.name, x.type]), UNITS.map((u) => materialOf(ws, A.units, u)), ['compared', 'chain'].map((k) => pageRow(ws, A.ids[k])), ['md', 'pdf', 'png'].map((k) => sha(path.join(ws, M[k].file)))]);
  await check(c, '10.5', async () => {
    const was = fp();
    must(materialCols(ws, A.units).length && holds(materialOf(ws, A.units, 'Mack'), [A.ids.compared]), 'Mack\'s Material in the file before Study is turned off');
    await S.setTool('study', false);
    await sleep(2000);
    const tabGone = (await tabTitled(S, tabTitle('Mack'))).length === 0;
    const cmds = (await S.commandIds()).filter((id) => /^study\./.test(id));
    must(await openDb(S, A.units), 'the Units database open with Study off');
    const cell = await until(async () => { const x = await S.cell(A.units, 'Mack', 'Material'); return x && x.found ? x : null; }, 3000);
    await S.shot('10-study-off-units');
    return [tabGone && cmds.length === 0 && fp() === was && !!cell && cell.text.includes(M.compared.title), { tabGone, studyCommandsLeft: cmds.slice(0, 5), sameInTheFile: fp() === was, cell: cell ? cell.text : null }];
  });
  await check(c, '10.6', async () => {
    await S.setTool('study', true);
    await S.setTool('flashcards', true);
    await S.setTool('door', true);
    await openUnit(S, 'Mack');
    const r = await waitTab(S, (g, it) => same(notesTitles(it), notesTitles(before.items)), 5000);
    return [r.ok, { items: notesTitles(r.items) }];
  });
  await check(c, '10.7', async () => {
    // 300 questions in Clark, written with the app closed; then 40 items attached through the picker.
    await S.close();
    const added = seedManyQuestions(ws, A.bank);
    await S.open();
    await openUnit(S, 'Clark');
    await openPicker(S, 'Clark');
    await search(S, 'Bulk');
    const wanted = [...BULK_PAGES, ...BULK_FILES.map((f) => path.basename(f))];
    let ticked = 0;
    for (const t of wanted) { const ch = await until(() => choiceFor(S, t), 1500); if (ch && !ch.on) { await S.click(ch); ticked += 1; await sleep(60); } else if (ch && ch.on) ticked += 1; }
    must(ticked === 40, `40 Bulk items ticked in the picker (${ticked})`);
    await confirmPicker(S);
    must((await waitTab(S, (g) => groupOf(g, NOTES)?.count === 40, 8000)).ok, 'the 40 items in the tab of Clark');
    must(await closeTab(S, tabTitle('Clark')), 'the tab of Clark closed');
    await sleep(800);
    const at = await openUnit(S, 'Clark');
    const r = await waitTab(S, (g) => groupOf(g, NOTES)?.count === 40 && groupOf(g, 'Questions')?.count === 300 && groupOf(g, 'Problems')?.count === 10 && groupOf(g, 'Cards')?.count === 3, 5000);
    const took = (Date.now() - at) / 1000;
    console.log(`   a unit of 300 questions (${added} added to the file), 40 items, two tools' groups: tab shown ${r.ok ? `${took.toFixed(2)} s after the press` : `not after ${took.toFixed(1)} s`}`);
    await S.shot('10-big-unit');
    return [r.ok && took <= 1, { seconds: Number(took.toFixed(2)), groups: brief(r.groups) }];
  });
});

// ── The workspace the phases start from: made by the app, once ───────────────
const BASE_WORKSPACE = path.join(OUT, 'runs', 'subject-workspace');
let baseSnapshot = null; let baseFailed = '';
let baseIds = null;
async function subjectBase() {
  if (baseSnapshot) return baseSnapshot;
  if (baseFailed) throw new Error(baseFailed);
  const root = await newRoot('subject-made', null, BASE_WORKSPACE);
  await writeFiles(BASE_WORKSPACE);
  const S = makeSession(root);
  try {
    await S.open();
    const bank = await seedDatabase(S, BANK, bankColumns(Object.keys(Q_STATES)), SEED.map((q) => ({ title: q.question, values: { 'Model Answer': q.answer, Paper: q.paper, ...historyOf(q.state) } })));
    must(rowsOf(S.workspace, bank).length === SEED.length, `the ${SEED.length} seeded questions in the workspace file`);
    const notes = await seedDatabase(S, NOTES_DB, [{ name: 'Topic', type: 'text' }], [{ title: 'First Note', values: { Topic: 'reserving' } }, { title: 'Second Note', values: { Topic: 'credibility' } }]);
    const lectures = await seedDatabase(S, 'Lecture Notes', [{ name: 'Topic', type: 'text' }], [{ title: M.venterRow.title, values: { Topic: 'credibility' } }, { title: M.adminRow.title, values: { Topic: 'exam logistics' } }]);
    const ids = {};
    for (const k of ['mackPage', 'compared', 'chain', 'hurli', 'grocery', 'log']) ids[k] = await seedPage(S, M[k].title);
    for (const k of ['fried', 'week3']) ids[k] = await seedPage(S, M[k].title, ids.log);
    for (const t of BULK_PAGES) await seedPage(S, t);
    const rowId = (t) => rowTitled(S.workspace, lectures, t)?.pageId;
    ids.venterRow = rowId(M.venterRow.title); ids.adminRow = rowId(M.adminRow.title);
    must(ids.venterRow && ids.adminRow, 'the rows of Lecture Notes');
    await newSubject(S, { name: SUBJECT, questions: BANK });
    const subj = must(await until(() => { const s = subjectOf(S.workspace, SUBJECT); return s.page && s.units && s.log ? s : null; }, 15_000, 150), `the page "${SUBJECT}" with Units and Work Log under it`);
    let order = Math.max(0, ...rowsOf(S.workspace, subj.units.id).map((r) => num(r.values.Order)));
    for (const u of HAND_UNITS) {
      order += 1;
      await S.tool('canvas_add_database_row', { databaseId: subj.units.id, title: u, values: { Order: order } });
      must(await until(() => rowTitled(S.workspace, subj.units.id, u), 5000), `the unit "${u}" added to Units`);
    }
    must(await openDb(S, subj.units.id), 'Units open in the app');
    const also = must(col(columns(S.workspace, subj.units.id), 'Also Called'), 'the column Also Called in Units');
    for (const [u, v] of Object.entries(ALSO_CALLED)) await S.cmd('database.setCell', rowTitled(S.workspace, subj.units.id, u).pageId, also.id, v);
    must(await until(() => norm(rowTitled(S.workspace, subj.units.id, 'Mack')?.values['Also Called']) === ALSO_CALLED.Mack, 4000), 'Mack\'s Also Called stored');
    must(await until(() => coreAll(S.workspace, "SELECT COUNT(*) AS n FROM sqlite_master WHERE name IN ('ws_items', 'ws_attempts')")[0].n === 2 && cardsAll(S.workspace, "SELECT COUNT(*) AS n FROM sqlite_master WHERE name IN ('fc_decks', 'fc_cards', 'fc_reviews')")[0]?.n === 3, 30_000, 250), 'the tables of Worksheets and of Flashcards');
    await closeStudyTabs(S);
    await sleep(2000);
    await S.close();
    seedTools(S.workspace);
    // A subject made with the Notes choice: Study's own store names the notes database (as the sheet's Notes did).
    const sf = must(studyFile(S.workspace), 'Study\'s own store (st_subjects) in the workspace');
    const hasNotesCol = fileAll(sf, 'PRAGMA table_info(st_subjects)').some((x) => x.name === 'notes_db');
    if (hasNotesCol) { const d = new DatabaseSync(sf); try { d.prepare('UPDATE st_subjects SET notes_db = ? WHERE name = ?').run(notes, SUBJECT); } finally { d.close(); } }
    console.log(`   the subject's notes database in Study's store: ${hasNotesCol ? `set to "${NOTES_DB}"` : 'Study\'s store has no notes_db column; the subject is as the app makes it'}`);
    await S.open();
    await showStudySidebar(S);
    must(await until(async () => { const t = await subjectsText(S); return t && UNITS.every((u) => t.includes(u)) ? t : null; }, 12_000), `the subject and its units in the sidebar (${(await subjectsText(S)) ?? 'no Subjects section'})`);
    await sleep(1500);
    baseIds = { ids, notes, lectures, bank };
    console.log(`[probe] the workspace was made by the app: "${SUBJECT}" with ${UNITS.length} units, ${SEED.length} questions, ${Object.keys(ids).length + BULK_PAGES.length} pages, ${4 + BULK_FILES.length} files, problems on ${Object.keys(P).length} papers, ${Object.values(CARD_TAGS).join('').length} cards`);
  } catch (err) {
    baseFailed = `the workspace the phases start from could not be made: ${String((err && err.message) || err).split('\n')[0].slice(0, 260)}`;
    throw new Error(baseFailed);
  } finally { await S.close(); }
  const snapshot = path.join(OUT, 'runs', 'subject-snapshot');
  await fs.cp(BASE_WORKSPACE, snapshot, { recursive: true });
  baseSnapshot = snapshot;
  return baseSnapshot;
}
function subjectIds(ws) {
  const s = subjectOf(ws, SUBJECT);
  return { page: s.page?.id ?? null, units: s.units?.id ?? null, log: s.log?.id ?? null, ...baseIds };
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
      // Phase 3 reads what phase 0 found the app opens each kind in; run alone, it finds it first.
      S = makeSession(await newRoot(`phase-${String(p.n).padStart(2, '0')}`, await subjectBase(), BASE_WORKSPACE));
      await S.open();
      const A = subjectIds(S.workspace);
      if (p.n === 3 && !Object.keys(EDITOR_FOR).length) for (const k of ['pdf', 'md', 'png']) { await S.cmd('file.openFile', path.join(S.workspace, M[k].file)); const a = await until(async () => { const x = await S.active(); return x && x.file === path.join(S.workspace, M[k].file) ? x : null; }, 6000); if (a) EDITOR_FOR[k] = a.typeId; }
      await p.fn(S, c, A);
    } catch (err) {
      stopped = String((err && err.message) || err).split('\n')[0].slice(0, 320);
      if (S && S.page) await S.shot(`${String(p.n).padStart(2, '0')}-stopped`);
    } finally {
      if (S) await S.close();
      if (S) await fs.rename(BASE_WORKSPACE, path.join(S.dir, 'workspace-after')).catch(() => {});
    }
    for (const id of Object.keys(p.checks)) if (!done.has(id)) c(id, false, stopped ? `not reached: ${stopped}` : 'not reached');
    console.log(`   (${Math.round((Date.now() - tp) / 1000)} s)`);
  }
  const failed = results.filter((r) => !r.ok);
  const ground = results.filter((r) => r.id.startsWith('0.'));
  console.log(`\n[probe] page errors: ${pageErrors.length}`);
  for (const e of [...new Set(pageErrors)].slice(0, 8)) console.log(`   ${e}`);
  console.log(`[probe] ground (phase 0): ${ground.length - ground.filter((r) => !r.ok).length} of ${ground.length} ok`);
  console.log(`[probe] ${results.length} checks: ${results.length - failed.length} ok, ${failed.length} FAIL${failed.length ? ` (${failed.map((r) => r.id).join(' ')})` : ''}`);
  console.log(`[probe] ${Math.round((Date.now() - t0) / 1000)} s; screenshots in ${path.join(OUT, 'shots')}`);
  process.exitCode = failed.length ? 1 : 0;
}
main().catch((err) => { console.log(`[probe] FAIL the probe itself stopped: ${err && err.stack ? err.stack : err}`); process.exitCode = 1; });
