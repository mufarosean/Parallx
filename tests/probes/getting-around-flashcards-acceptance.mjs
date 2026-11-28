// getting-around-flashcards-acceptance.mjs — @acceptance for "Getting around",
// piece 6, Flashcards (ext/flashcards) onto the core's places point
// (docs/MASTER_LIST.md, "Getting around: one way to move in every tool",
// "The order of work" item 6; his picks 1A, 2A, 3A and the places-and-things
// table, whose Flashcards row reads: places (share the tool's one tab) =
// Decks, a deck, Study, Stats, Make Cards, Custom Study; things = none; a study
// session stays in the tab, as now).
//
// Written from the request before the build, by a verifier who is not the
// builder. The builder does not edit this file. The checks for the new
// behaviour failed on the app as it was when it was written (dev at aef6b8e4);
// the ones marked [guard] test what is already true and must stay true.
// On that app 4 of 76 passed: the four [guard]s (T1, O3, N1, X1); each is part
// of the walk and must stay true.
//
// What it holds the piece to:
//   R. A Flashcards tab the older build saved (editor type `flashcards`,
//      instance `main`, its view state's route on Exam 7's Browse), written into
//      the workspace's saved state before launch, comes back as ONE Flashcards
//      place tab (an address parallx://place/flashcards/…) on Exam 7's screen
//      (the tab named for the deck, the deck's id in the address).
//   W. A walk down the column's rows (Decks, Study, Stats, Make Cards, Import)
//      leaves exactly ONE Flashcards tab, named for the row, with an icon; the
//      page has the kit's title (h1.px-page-header__title) and no kit back
//      link, and Flashcards' own breadcrumb (.fc-pane__crumbs) is gone; the trail
//      in the bar under the tabs starts at Flashcards (with its icon) and ends on
//      the place, its last crumb the tab's name; the keys land on the title; the
//      column marks the row with the shared mark (aria-current="page" +
//      px-current) and only it, and its own mark (fc-sb__nav-item--active,
//      aria-selected) is gone. Each row has its own address.
//   K. A deck's row: the deck's screen (its Browse) in the one tab, named for
//      the deck; the trail from Flashcards names the deck; the deck's id in the
//      address; the kit title with the keys on it; Browse's "Decks" back button
//      (flashcards.browse.toDecks) gone; the column marks it with the shared
//      mark. A second deck's row moves the same tab. Every crumb before the last
//      goes to its own address in the same tab.
//   D. The deck's other screens, from its row's menu (Find Duplicates, Coverage
//      Review, Custom Study…), the custom deck's row and Study One Tag: each in
//      the one tab, named for it (the deck's screens with the deck in the trail
//      and its id in the address), with an address and the kit title; the hand-
//      made back buttons (flashcards.dedup.back, flashcards.coverage.back,
//      flashcards.customView.toDecks) gone; on Find Duplicates every crumb
//      before the last goes there in the same tab.
//   P. The deck's address, clicked as a link in a page, opens that deck's
//      screen in the one tab.
//   A. The same row twice in a row: one tab, same tab. After a switch to another
//      tab a row brings the one Flashcards tab forward.
//   B. Alt+Left / Alt+Right walk between Flashcards places in the one tab.
//   C. The manifest's commands (flashcards.open, .study, .customStudy, .stats,
//      .generate, .studyTag, .newCard) land in the one tab, each on its place.
//   L. The deep links parallx://flashcards/deck/<id>, /card/<id> and /study,
//      clicked in a page: that deck's screen (the card's deck), Study, in the
//      one tab.
//   H. Home's Flashcards card, "Study": Study in the one tab; the deck in Home's
//      feed: its screen in the one tab. The sidebar's Today buttons (Study N
//      cards, Memorize): Study there.
//   T. The study session stays in the tab [guard for the tab]: Show Answer and
//      a grade leave one Flashcards tab, the same tab, and its trail still ends
//      on Study.
//   O. Ctrl+click on a column row and on a deck's row gives a second tab on the
//      place; the deck's row keeps its own menu [guard]; the tab menu's Open in
//      Its Own Tab gives one more tab.
//   S. After the app is closed and opened, the one tab comes back at its place.
//   N. Nothing a tool other than Flashcards owns changes [guard]: Worksheets'
//      Problem Bank keeps its place tab and trail.
//   X. Turned off: no Flashcards tab, column or commands [guard], and the deck's
//      place address opens nothing; on again, its commands land in the one tab.
// Screenshots (shots/) of Decks, a deck's screen, Study and Stats, dark and
// light, are taken for a person to look at, not judged here.
// Read as the builder's choice, not checked: the place ids and parameter names;
// whether a deck's trail reads "Flashcards › Exam 7" or "Flashcards › Exam 7 ›
// Browse"; whether a deck-scoped Study or Custom Study names the deck; which
// buttons that END something stay (the error page's and a finished session's
// Back to Decks); which row carries the mark on a deck's screen (the deck's or
// Decks). Not checked: the dashboard widget's Study Now (adding a widget to a
// dashboard was not driven; it calls the same openFlashcards({ view: 'study' })
// as flashcards.study); Worksheets' "Review Due Flashcards" (it runs the command
// flashcards.study, checked in C; driving it needs a seeded campaign); Study
// (ext/study) has no link into Flashcards (none in its code at aef6b8e4).
//
//   node scripts/build.mjs && xvfb-run -a node tests/probes/getting-around-flashcards-acceptance.mjs [outDir]
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PROJECT_ROOT, launchApp, cmd, screenshot, toolList, setToolEnabled } from './scene.mjs';

const root = process.argv[2] ? path.resolve(process.argv[2]) : path.join(PROJECT_ROOT, 'tests', '.tmp-getting-around-flashcards');
await fs.rm(root, { recursive: true, force: true });
const appRoot = path.join(root, 'app'); const ws = path.join(root, 'workspace'); const shots = path.join(root, 'shots');
for (const d of [path.join(appRoot, 'data'), path.join(ws, '.parallx'), shots]) await fs.mkdir(d, { recursive: true });
await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: ws }));
await fs.writeFile(path.join(ws, '.parallx/ai-config.json'), JSON.stringify({ overrides: { indexing: { autoIndex: false, watchFiles: false }, suggestions: { suggestionsEnabled: false }, heartbeat: { enabled: false } } }));
try { await fs.symlink(path.join(PROJECT_ROOT, 'ext'), path.join(appRoot, 'ext'), 'junction'); } catch { /* there */ }

let passed = 0; const failed = []; const guards = [];
const check = (name, ok, got, { guard = false } = {}) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${guard ? '[guard] ' : ''}${name}${ok ? '' : `: ${JSON.stringify(got)}`}`);
  if (guard) guards.push(name);
  if (ok) passed += 1; else failed.push(name);
};

const manifest = JSON.parse(await fs.readFile(path.join(PROJECT_ROOT, 'ext', 'flashcards', 'parallx-manifest.json'), 'utf8'));
const TOOL = manifest.id; // parallx-community.flashcards: the prefix of every Flashcards tab's id
const OLD_TYPE = 'flashcards';
/** A place's address: parallx://place/flashcards/<place>?<params>. */
const PLACE_ADDR = /^parallx:\/\/place\/flashcards\/[^?/]+/i;
const DECK = 'Exam 7'; const DECK2 = 'Probe Second'; const CUSTOM = 'Probe Formulas'; const CUSTOM_TAG = 'probe-formulas';
const COLUMN = '.view[data-view-id="flashcards.decks"]';
const ELECTRON = path.join(PROJECT_ROOT, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const nodeEnv = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };

// SQL on Flashcards' own database, with the app closed (better-sqlite3 under Electron's node).
const sqlScript = path.join(root, 'sql.cjs');
await fs.writeFile(sqlScript, `
const Database = require(${JSON.stringify(path.join(PROJECT_ROOT, 'node_modules', 'better-sqlite3'))});
const db = new Database(process.argv[2]);
const out = [];
for (const s of JSON.parse(process.argv[3])) { const st = db.prepare(s.sql); out.push(st.reader ? st.all(...(s.args || [])) : st.run(...(s.args || [])).changes); }
db.close();
console.log(JSON.stringify(out));
`);
async function fcDbPath() {
  const dir = path.join(ws, '.parallx', 'extensions');
  const names = await fs.readdir(dir).catch(() => []);
  for (const n of [TOOL, 'flashcards', ...names.filter((x) => /flashcard/i.test(x))]) {
    const p = path.join(dir, n, 'data.db');
    try { await fs.access(p); return p; } catch { /* next */ }
  }
  return null;
}
function sql(dbPath, statements) {
  const r = spawnSync(ELECTRON, [sqlScript, dbPath, JSON.stringify(statements)], { env: nodeEnv, encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error(`sql: ${r.stderr || r.stdout}`);
  return JSON.parse(r.stdout.trim().split(/\r?\n/).pop());
}

let app; let page; let errors = [];
const wait = (ms) => page.waitForTimeout(ms);

/** What a person sees: the tabs, the trail under them, the page, Flashcards' column, the focus. */
const read = () => page.evaluate(({ TOOL, COLUMN }) => {
  const vis = (e) => !!e && e.getClientRects().length > 0;
  const tabs = [...document.querySelectorAll('.editor-group .ui-tab')].filter((t) => !t.classList.contains('ui-tab--leaving') && vis(t) && !t.closest('.editor-pane-container')).map((t) => {
    const icon = t.querySelector('.ui-tab-icon');
    return {
      id: t.dataset.tabId ?? '', label: (t.querySelector('.ui-tab-label')?.textContent ?? '').trim(), active: t.classList.contains('ui-tab--active'),
      icon: !!icon && vis(icon) && !!icon.querySelector('svg, img'),
      group: t.closest('.editor-group')?.getAttribute('data-editor-group-id') ?? null,
    };
  });
  const act = tabs.find((t) => t.active) ?? null;
  const group = act ? document.querySelector(`.editor-group[data-editor-group-id="${act.group}"]`) : null;
  const ribbon = group?.querySelector('.editor-ribbon');
  const crumbs = ribbon && vis(ribbon) && !ribbon.classList.contains('hidden')
    ? [...ribbon.querySelectorAll('.parallx-breadcrumb-item')].filter(vis).map((c) => ({
      label: ((c.querySelector('.breadcrumb-label, [class*="label"]') ?? c).textContent ?? '').trim(),
      icon: !!c.querySelector('svg, img'), address: c.dataset.address ?? '',
    }))
    : [];
  const panes = group?.querySelector('.editor-pane-container');
  const title = [...(panes?.querySelectorAll('.px-page-header__title') ?? [])].find(vis);
  const back = [...(panes?.querySelectorAll('.px-page-header__back') ?? [])].find(vis);
  // Flashcards' own breadcrumb, as a person would see it (drawn and holding a crumb).
  const ownCrumbs = [...(panes?.querySelectorAll('.fc-pane__crumbs') ?? [])].filter((e) => vis(e) && (e.textContent ?? '').trim()).map((e) => (e.textContent ?? '').replace(/\s+/g, ' ').trim());
  // The hand-made back buttons the trail now does the work of, wherever drawn and visible in the page.
  const backIds = ['flashcards.browse.toDecks', 'flashcards.customView.toDecks', 'flashcards.dedup.back', 'flashcards.coverage.back'];
  const handBacks = [...(panes?.querySelectorAll('[data-px-id]') ?? [])].filter((e) => vis(e) && backIds.includes(e.getAttribute('data-px-id'))).map((e) => e.getAttribute('data-px-id'));
  const view = document.querySelector(COLUMN);
  const nameOf = (e) => ((e.querySelector('.fc-sb__nav-label, .fc-deck-row__name, .px-btn__label')?.textContent) || e.getAttribute('aria-label') || e.textContent || '').replace(/\s+/g, ' ').trim();
  const marked = view ? [...view.querySelectorAll('[aria-current="page"]')].filter(vis).map((e) => ({ name: nameOf(e), pxCurrent: e.classList.contains('px-current') })) : null;
  const oldMarks = view ? [...view.querySelectorAll('.fc-sb__nav-item--active, [role="tab"][aria-selected="true"]')].map(nameOf) : null;
  const ae = document.activeElement;
  const fc = tabs.filter((t) => t.id.startsWith(`${TOOL}:`));
  return {
    count: tabs.length, labels: tabs.map((t) => t.label), ids: tabs.map((t) => t.id), active: act?.label ?? null, activeId: act?.id ?? null, activeIcon: act?.icon ?? false,
    activeIsFc: !!act && act.id.startsWith(`${TOOL}:`),
    fc: fc.map((t) => t.label), fcIds: fc.map((t) => t.id),
    crumbs, address: crumbs.length ? crumbs[crumbs.length - 1].address : '',
    title: title ? (title.textContent ?? '').trim() : null,
    back: back ? (back.textContent ?? '').trim() || '(a back link)' : null,
    ownCrumbs, handBacks,
    column: !!view && vis(view), marked, oldMarks,
    focus: ae ? { tag: ae.tagName, cls: String(ae.className ?? ''), tabindex: ae.getAttribute('tabindex'), text: (ae.textContent ?? '').trim().slice(0, 40), inEditor: !!panes?.contains(ae) } : null,
  };
}, { TOOL, COLUMN });
const titleFocused = (s) => !!s.focus && s.focus.tag === 'H1' && /\bpx-page-header__title\b/.test(s.focus.cls) && s.focus.tabindex === '-1' && s.focus.inEditor;
const short = (s) => ({ active: s.active, activeId: s.activeId, fc: s.fc, crumbs: s.crumbs.map((c) => c.label), address: s.address, title: s.title });
const last = (s) => (s.crumbs.length ? s.crumbs[s.crumbs.length - 1].label : '');
const matches = (re, text) => (re instanceof RegExp ? re.test(text ?? '') : text === re);
/** The trail starts at Flashcards (with its icon), ends on the place (the tab's name), and the address is a Flashcards place's. */
function trailIs(s, place) {
  if (s.crumbs.length < 2 || s.crumbs[0].label !== 'Flashcards' || !s.crumbs[0].icon) return false;
  const l = last(s);
  return matches(place, l) && l === s.active && PLACE_ADDR.test(s.address);
}
/** A deck's screen: the trail starts at Flashcards (with its icon), a crumb names the deck, the address is a Flashcards place's with the deck's id. */
function deckTrail(s, deckName, deckId, place = null) {
  if (s.crumbs.length < 2 || s.crumbs[0].label !== 'Flashcards' || !s.crumbs[0].icon) return false;
  if (!s.crumbs.slice(1).some((c) => c.label.includes(deckName))) return false;
  if (place && !matches(place, last(s))) return false;
  return PLACE_ADDR.test(s.address) && idIn(s.address, deckId);
}
/** On this place, in the one Flashcards tab (no other Flashcards tab open). */
const onePlace = (s, place) => s.fc.length === 1 && s.activeIsFc && matches(place, s.active);
/** The deck's id is a parameter of the address's query. */
const idIn = (a, id) => { const q = decodeURIComponent(String(a).split('?')[1] ?? ''); return !!id && new RegExp(`(?:^|[=&:,])${String(id)}(?:$|[&:,])`).test(q); };

const centre = (sel) => page.evaluate((sel) => { const e = [...document.querySelectorAll(sel)].find((x) => x.getClientRects().length); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, sel);
async function showColumn() {
  const shown = await page.evaluate((COLUMN) => { const v = document.querySelector(COLUMN); return !!v && v.getClientRects().length > 0; }, COLUMN);
  if (shown) return;
  const at = await centre('.activity-bar-item[data-icon-id="flashcards-container"]');
  if (at) { await page.mouse.click(at.x, at.y); await wait(1_200); }
}
/**
 * A control in Flashcards' column: named exactly `label` (a nav row's label, a kit button's label, else its name),
 * or, with `deck`, a deck's row (its name holds `label`, not its actions button). Its centre, or null.
 */
async function columnControl(label, { deck = false } = {}) {
  await showColumn();
  return page.evaluate(({ label, deck, COLUMN }) => {
    const view = document.querySelector(COLUMN);
    if (!view) return null;
    const nameOf = (e) => ((e.querySelector('.fc-sb__nav-label, .fc-deck-row__name, .px-btn__label')?.textContent) || e.getAttribute('aria-label') || e.textContent || '').replace(/\s+/g, ' ').trim();
    const all = [...view.querySelectorAll('button, a[href], [role="link"], [role="button"], [role="tab"], [role="treeitem"], .fc-deck-row')];
    const e = all.find((x) => x.getClientRects().length && (deck ? nameOf(x).includes(label) && !/^Actions for/.test(nameOf(x)) && !x.classList.contains('fc-deck-row__more') : nameOf(x) === label));
    if (!e) return null;
    e.scrollIntoView({ block: 'nearest' });
    const r = e.getBoundingClientRect(); return { x: r.x + Math.min(40, r.width / 2), y: r.y + r.height / 2 };
  }, { label, deck, COLUMN });
}
async function pressColumn(label, { ctrl = false, ms = 2_200, deck = false, right = false } = {}) {
  const at = await columnControl(label, { deck });
  if (!at) return false;
  if (ctrl) await page.keyboard.down('Control');
  await page.mouse.click(at.x, at.y, { button: right ? 'right' : 'left' });
  if (ctrl) await page.keyboard.up('Control');
  await wait(ms);
  return true;
}
/** A visible control in the active editor whose text (or name) starts with `text`: pressed by the mouse. */
async function pressInPage(text, { ms = 1_800, sel = 'button, [role="button"]', exact = false } = {}) {
  const at = await page.evaluate(({ text, sel, exact }) => {
    const act = [...document.querySelectorAll('.editor-group .ui-tab--active')].find((t) => t.getClientRects().length && !t.closest('.editor-pane-container'));
    const panes = act?.closest('.editor-group')?.querySelector('.editor-pane-container');
    const nm = (x) => (x.textContent ?? '').replace(/\s+/g, ' ').trim() || (x.getAttribute('aria-label') ?? '');
    const e = [...(panes?.querySelectorAll(sel) ?? [])].find((x) => x.getClientRects().length && !x.disabled && (exact ? nm(x) === text : nm(x).startsWith(text)));
    if (!e) return null;
    e.scrollIntoView({ block: 'nearest' });
    const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, { text, sel, exact });
  if (!at) return false;
  await page.mouse.click(at.x, at.y); await wait(ms);
  return true;
}
/** The tab with this label (the last, if several; the active one when label is null), by the mouse. */
async function pressTab(label, { right = false, ms = 1_400, id = null } = {}) {
  const at = await page.evaluate(({ label, id }) => {
    const t = [...document.querySelectorAll('.editor-group .ui-tab')].filter((x) => x.getClientRects().length && !x.closest('.editor-pane-container') && !x.classList.contains('ui-tab--leaving') && (id !== null ? x.dataset.tabId === id : label === null ? x.classList.contains('ui-tab--active') : (x.querySelector('.ui-tab-label')?.textContent ?? '').trim() === label)).pop();
    if (!t) return null; const l = (t.querySelector('.ui-tab-label') ?? t).getBoundingClientRect(); return { x: l.x + Math.min(20, l.width / 2), y: l.y + l.height / 2 };
  }, { label, id });
  if (!at) return false;
  await page.mouse.click(at.x, at.y, { button: right ? 'right' : 'left' });
  await wait(ms);
  return true;
}
/** A crumb of the trail under the tabs, by its index: pressed by the mouse. */
async function pressCrumb(index, { ms = 2_200 } = {}) {
  const at = await page.evaluate((index) => {
    const act = [...document.querySelectorAll('.editor-group .ui-tab--active')].find((t) => t.getClientRects().length && !t.closest('.editor-pane-container'));
    const ribbon = act?.closest('.editor-group')?.querySelector('.editor-ribbon');
    const c = [...(ribbon?.querySelectorAll('.parallx-breadcrumb-item') ?? [])].filter((x) => x.getClientRects().length)[index];
    if (!c) return null; const r = (c.querySelector('.breadcrumb-label, [class*="label"]') ?? c).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, index);
  if (!at) return false;
  await page.mouse.click(at.x, at.y); await wait(ms);
  return true;
}
const menuItems = () => page.evaluate(() => [...document.querySelectorAll('.context-menu')].filter((m) => m.getClientRects().length).flatMap((m) => [...m.querySelectorAll('.context-menu-item')].map((r) => (r.querySelector('.context-menu-item-label')?.textContent ?? r.textContent ?? '').trim())));
async function pickMenuItem(text) {
  const at = await page.evaluate((text) => {
    const r = [...document.querySelectorAll('.context-menu .context-menu-item')].filter((x) => x.getClientRects().length).find((x) => (x.textContent ?? '').includes(text));
    if (!r) return null; const b = r.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }, text);
  if (!at) { await page.keyboard.press('Escape'); await wait(300); return false; }
  await page.mouse.click(at.x, at.y); await wait(2_200);
  return true;
}
/** The deck's row's own menu (right-click), and one of its items picked. */
async function deckMenu(deckName, item) {
  const opened = await pressColumn(deckName, { deck: true, right: true, ms: 800 });
  if (!opened) return false;
  return pickMenuItem(item);
}
async function closeAllEditors() {
  for (let i = 0; i < 40 && (await read()).count > 0; i++) { await cmd(page, 'workbench.action.closeActiveEditor'); await wait(250); }
  await page.keyboard.press('Escape').catch(() => {});
  await wait(500);
}
const key = async (k, ms = 2_000) => { await page.keyboard.press(k); await wait(ms); };
const runToolText = (name, args) => page.evaluate(async ({ name, args }) => {
  const tools = window.__parallx_workbench__._services.get({ id: 'ILanguageModelToolsService' });
  const t = tools.getTool(name); if (!t) return `no tool ${name}`;
  const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };
  try { return String((await t.handler(args, token))?.content ?? ''); } catch (e) { return `failed: ${String(e?.message || e).slice(0, 160)}`; }
}, { name, args });
const runTool = async (name, args) => { const out = await runToolText(name, args); return (/id: ([0-9a-f-]{20,})/i.exec(out) || [])[1] ?? `no id: ${out.slice(0, 160)}`; };
/** Runs a command and returns what it returned; does not wait longer than `cap` ms for it. */
const runCmd = (id, args = [], cap = 8_000) => page.evaluate(async ({ id, args, cap }) => {
  const svc = window.__parallx_workbench__?._services?.get?.({ id: 'ICommandService' });
  try { return await Promise.race([svc.executeCommand(id, ...args), new Promise((r) => setTimeout(() => r('(still running)'), cap))]); } catch (e) { return `failed: ${String(e?.message || e).slice(0, 160)}`; }
}, { id, args, cap });
const hasCommand = (id) => page.evaluate((id) => !!window.__parallx_workbench__._services.get({ id: 'ICommandService' }).hasCommand?.(id), id);
/** The column's mark: exactly one marked control, named `label`, with px-current; none of Flashcards' own marks left. */
async function markRight(label) {
  const has = !!(await columnControl(label));
  const s = await read();
  const after = s.marked ?? [];
  return { ok: has && after.length === 1 && after[0].name === label && after[0].pxCurrent && (s.oldMarks ?? []).length === 0, has, marked: after, oldMarks: s.oldMarks };
}
/** On a deck's screen: the column holds the shared mark (on the deck's row or on Decks), each with px-current, none of the old marks. */
async function deckMarkRight(deckName) {
  await showColumn();
  const s = await read();
  const m = s.marked ?? [];
  return { ok: m.length >= 1 && m.every((x) => x.pxCurrent && (x.name.includes(deckName) || x.name === 'Decks')) && (s.oldMarks ?? []).length === 0, marked: m, oldMarks: s.oldMarks };
}
/** A page holding links, and one of them clicked by the mouse. */
async function makeLinkPage(title, hrefs) {
  const md = hrefs.map((h, i) => `See [link ${i + 1}](${h}).`).join('\n\n');
  return runTool('canvas_create_page', { title, markdown: md });
}
async function clickLink(pageId, href) {
  if (!pageId || /^no /.test(pageId)) return false;
  await cmd(page, 'canvas.openPage', pageId); await wait(2_000);
  const at = await page.evaluate((href) => { const a = [...document.querySelectorAll('[data-px-surface="canvas"] a')].find((x) => x.getClientRects().length && x.getAttribute('href') === href); if (!a) return null; const r = a.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, href);
  if (!at) return false;
  await page.mouse.click(at.x, at.y); await wait(2_800);
  return true;
}
/** Each crumb before the last, pressed in turn: the same tab goes to that crumb's address; Alt+Left comes back. */
async function crumbsGoThere() {
  const s0 = await read();
  const out = [];
  for (let i = 0; i < s0.crumbs.length - 1; i++) {
    const want = s0.crumbs[i].address;
    const pressed = await pressCrumb(i);
    const s = await read();
    out.push({ crumb: s0.crumbs[i].label, want, pressed, got: s.address, sameTab: s.activeId === s0.activeId, one: s.fc.length === 1 });
    await key('Alt+ArrowLeft', 2_200);
  }
  const ok = s0.crumbs.length >= 2 && out.every((o) => o.pressed && PLACE_ADDR.test(o.want) && o.got === o.want && o.sameTab && o.one);
  return { ok, out };
}

async function launch() {
  ({ app, page, errors } = await launchApp(appRoot));
  await page.waitForFunction(() => !!window.__parallx_workbench__?._services, null, { timeout: 60_000 });
  await wait(2_500);
}
async function ensureOn() {
  const t = (await toolList(page)).find((x) => x.id === TOOL);
  if (t && !t.enabled) { await setToolEnabled(page, TOOL, true); await wait(4_000); }
  return (await toolList(page)).find((x) => x.id === TOOL)?.enabled === true;
}

// ── Run 1: Flashcards on; two decks with new cards (some tagged for a custom deck, one for Memorize) ──
await launch();
const onFirst = await ensureOn();
const ids = { deck: 0, deck2: 0, card2: 0, custom: 0 };
const made = await page.evaluate(async ({ DECK, DECK2, CUSTOM_TAG }) => {
  const svc = window.__parallx_workbench__._services.get({ id: 'ICommandService' });
  const add = (deckName, cards) => svc.executeCommand('flashcards.addCards', { deckName, cards }).catch((e) => String(e?.message || e));
  const a = await add(DECK, [
    { front: 'What does the chain ladder method project?', back: 'Ultimate losses, by development factors.' },
    { front: 'What does Mack give?', back: 'The standard error of the chain ladder reserve.', tags: [CUSTOM_TAG] },
    { front: 'Name the Bornhuetter-Ferguson weight.', back: 'The percent unreported.', tags: [CUSTOM_TAG] },
    { front: 'What is an age-to-age factor?', back: 'The ratio of losses at one age to the age before.' },
    { front: 'What does Clark fit?', back: 'A growth curve to the development.', tags: ['memorize'] },
    { front: 'What is tail development?', back: 'Development past the last age in the triangle.' },
  ]);
  const b = await add(DECK2, [
    { front: 'Probe second one', back: '1' }, { front: 'Probe second two', back: '2' }, { front: 'Probe second three', back: '3' },
  ]);
  return { a, b };
}, { DECK, DECK2, CUSTOM_TAG });
ids.deck = Number(made?.a?.deckId) || 0; ids.deck2 = Number(made?.b?.deckId) || 0; ids.card2 = Number(made?.b?.ids?.[0]) || 0;
await wait(1_500);
await closeAllEditors();
await wait(1_000);
await app.close(); app = null;

// The custom deck, in Flashcards' own table (a named view over the cards carrying its tag).
const fcDb = await fcDbPath();
try {
  const [, rows] = sql(fcDb, [
    { sql: 'INSERT INTO fc_custom_decks (name, tag, description, position, created_at) VALUES (?, ?, ?, 0, ?)', args: [CUSTOM, CUSTOM_TAG, '', Date.now()] },
    { sql: 'SELECT id FROM fc_custom_decks WHERE tag = ?', args: [CUSTOM_TAG] },
  ]);
  ids.custom = Number(rows?.[0]?.id) || 0;
} catch (e) { console.log(`[seed] Flashcards' database: ${e?.message ?? e}`); }
console.log(`[seed] Flashcards on: ${onFirst}; addCards ${JSON.stringify(made).slice(0, 200)}; db ${fcDb ? path.relative(root, fcDb) : 'none'}; ids ${JSON.stringify(ids)}`);

// The older build saved its one tab as a tool editor of type `flashcards`, instance `main`, named "Flashcards",
// its pane's view state ({ route, scrollTop }, wrapped by the tool editor pane as { provider }) on the screen it showed.
const statePath = path.join(ws, '.parallx', 'workspace-state.json');
let seededOld = false;
try {
  const file = JSON.parse(await fs.readFile(statePath, 'utf8'));
  const wb = JSON.parse(file.workbench);
  const groupId = wb.editors?.groups?.[0]?.id ?? 'editor-group-1';
  const inputId = `${TOOL}:${OLD_TYPE}:main`;
  wb.editors = {
    groups: [{ id: groupId, editors: [{
      typeId: OLD_TYPE, inputId, pinned: true,
      data: { inputId, instanceId: 'main', name: 'Flashcards', iconHtml: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"><path d="M12 2 2 7l10 5 10-5-10-5z"/></svg>', ownerToolId: TOOL },
      state: { provider: { route: { view: 'browse', deckId: ids.deck }, scrollTop: 0 } },
    }], activeEditorIndex: 0 }],
    activeGroupIndex: 0, activeGroupId: groupId,
  };
  file.workbench = JSON.stringify(wb);
  await fs.writeFile(statePath, JSON.stringify(file, null, 2));
  seededOld = !!(ids.deck && ids.deck2 && ids.custom);
} catch (e) { console.log(`[seed] the saved state could not be written: ${e?.message ?? e}`); }
console.log(`[seed] the older build's Flashcards tab (flashcards/main on ${DECK}'s Browse) written into the saved state: ${seededOld}`);

try {
  await launch();
  await ensureOn();
  await wait(1_500);

  // ── R. The older build's tab ──
  let s = await read();
  if (s.fcIds.length === 1 && !s.activeIsFc) { await pressTab(null, { id: s.fcIds[0], ms: 2_400 }); s = await read(); }
  console.log(`[restore] ${JSON.stringify({ ...short(s), ownCrumbs: s.ownCrumbs })}`);
  check('R1 the older build\'s saved Flashcards tab (flashcards/main) comes back as ONE Flashcards tab, a place (its address parallx://place/flashcards/…)', seededOld && s.fc.length === 1 && s.activeIsFc && PLACE_ADDR.test(s.address), short(s));
  check(`R2 that tab is on the screen it showed: ${DECK}'s, the tab named for the deck, the trail from Flashcards naming it, the deck's id (${ids.deck}) in the address`, s.fc.length === 1 && (s.active ?? '').includes(DECK) && deckTrail(s, DECK, ids.deck), short(s));

  await closeAllEditors();

  // ── W. The walk down the column's rows ──
  const walk = [
    { row: 'Decks', place: /^Decks$/ },
    { row: 'Study', place: /^Study$/ },
    { row: 'Stats', place: /^Stats$/ },
    { row: 'Make Cards', place: /^Make Cards$/ },
    { row: 'Import', place: /Import/ },
  ];
  const addresses = {};
  for (const w of walk) {
    const pressed = await pressColumn(w.row, { ms: 2_600 });
    s = await read();
    addresses[w.row] = s.address;
    console.log(`[walk] ${w.row} pressed: ${pressed} → ${JSON.stringify(short(s))}`);
    check(`W1 ${w.row}: exactly one Flashcards tab, in front, named for the place (${w.place.source}), with an icon`, pressed && onePlace(s, w.place) && s.activeIcon, { pressed, ...short(s), icon: s.activeIcon });
    check(`W2 ${w.row}: the page has the kit's title (h1.px-page-header__title), no kit back link, and Flashcards' own breadcrumb is gone`, pressed && s.activeIsFc && s.title !== null && s.back === null && s.ownCrumbs.length === 0, { pressed, title: s.title, back: s.back, ownCrumbs: s.ownCrumbs });
    check(`W3 ${w.row}: the trail under the tabs is "Flashcards › …${w.place.source}…", Flashcards with its icon, the last crumb the tab's name; the address parallx://place/flashcards/…`, pressed && trailIs(s, w.place), s.crumbs);
    check(`W4 ${w.row}: the keys are on the page's kit title (h1, tabindex -1, in the editor)`, pressed && titleFocused(s), s.focus);
    const m = await markRight(w.row);
    check(`W5 ${w.row}: the column marks this row only, with the shared mark (aria-current="page" + px-current); its own mark (fc-sb__nav-item--active / aria-selected) gone`, pressed && m.ok, m);
    if (w.row === 'Decks') await screenshot(app, page, path.join(shots, 'w-decks-dark.png'));
    if (w.row === 'Study') await screenshot(app, page, path.join(shots, 'w-study-dark.png'));
    if (w.row === 'Stats') await screenshot(app, page, path.join(shots, 'w-stats-dark.png'));
  }
  const addrList = walk.map((w) => addresses[w.row]).filter((a) => PLACE_ADDR.test(a));
  check('W6 every row walked has its own address (as many different parallx://place/flashcards/… addresses as rows)', addrList.length === walk.length && new Set(addrList).size === walk.length, addresses);

  // ── K. A deck's screen ──
  await closeAllEditors();
  await pressColumn('Decks', { ms: 2_200 });
  const k0 = await read();
  const deckPressed = await pressColumn(DECK, { deck: true, ms: 2_800 });
  s = await read();
  const deckAddress = s.address;
  console.log(`[deck] ${DECK} pressed: ${deckPressed} → ${JSON.stringify(short(s))}`);
  check(`K1 ${DECK}'s row: its screen in the one Flashcards tab (the tab that was on Decks), named for the deck, with an icon`, deckPressed && s.fc.length === 1 && s.activeIsFc && s.activeId === k0.activeId && (s.active ?? '').includes(DECK) && s.activeIcon, { deckPressed, before: short(k0), after: short(s) });
  check(`K2 its trail starts at Flashcards (with its icon) and names ${DECK}; the address carries the deck's id (${ids.deck})`, deckPressed && deckTrail(s, DECK, ids.deck), { crumbs: s.crumbs, address: s.address });
  check('K3 the deck\'s screen has the kit\'s title with the keys on it; Browse\'s "Decks" back button (flashcards.browse.toDecks) and Flashcards\' own breadcrumb are gone', deckPressed && s.title !== null && titleFocused(s) && !s.handBacks.includes('flashcards.browse.toDecks') && s.ownCrumbs.length === 0, { title: s.title, focus: s.focus, handBacks: s.handBacks, ownCrumbs: s.ownCrumbs });
  const km = await deckMarkRight(DECK);
  check(`K4 the column carries the shared mark on ${DECK}'s screen (on its row or on Decks, aria-current="page" + px-current), none of its own marks`, deckPressed && km.ok, km);
  await screenshot(app, page, path.join(shots, 'k-deck-dark.png'));
  const kc = await crumbsGoThere();
  check(`K5 on ${DECK}'s screen, each crumb before the last pressed: that crumb's address, in the same tab (then Alt+Left back)`, deckPressed && kc.ok, kc.out);
  await closeAllEditors();
  await pressColumn(DECK, { deck: true, ms: 2_600 });
  const k5 = await read();
  await pressColumn(DECK2, { deck: true, ms: 2_600 });
  s = await read();
  check(`K6 then ${DECK2}'s row: the same tab moves to ${DECK2} (named for it, its id ${ids.deck2} in a different address)`, s.fc.length === 1 && s.activeId === k5.activeId && (s.active ?? '').includes(DECK2) && deckTrail(s, DECK2, ids.deck2) && s.address !== k5.address, { before: short(k5), after: short(s) });

  // ── P. The deck's address as a link in a page ──
  await closeAllEditors();
  const pPage = await makeLinkPage('Probe Deck Address', [PLACE_ADDR.test(deckAddress) ? deckAddress : 'parallx://place/flashcards/none']);
  await pressColumn('Stats', { ms: 2_200 });
  const p0 = await read();
  const pClicked = PLACE_ADDR.test(deckAddress) ? await clickLink(pPage, deckAddress) : false;
  s = await read();
  check(`P1 ${DECK}'s address (${deckAddress || 'none read'}), clicked as a link in a page: ${DECK}'s screen in the one Flashcards tab (the tab that was on Stats)`, pClicked && s.fc.length === 1 && s.activeId === p0.activeId && (s.active ?? '').includes(DECK) && deckTrail(s, DECK, ids.deck), { pClicked, before: short(p0), after: short(s) });

  // ── D. The deck's other screens; the custom deck; one tag ──
  const deckScreens = [
    { item: 'Find Duplicates', place: /Duplicates/, back: 'flashcards.dedup.back' },
    { item: 'Coverage Review', place: /Coverage/, back: 'flashcards.coverage.back' },
  ];
  for (const d of deckScreens) {
    await closeAllEditors();
    await pressColumn('Decks', { ms: 2_200 });
    const d0 = await read();
    const picked = await deckMenu(DECK, d.item);
    await wait(800);
    s = await read();
    console.log(`[deck screen] ${d.item}: ${picked} → ${JSON.stringify(short(s))}`);
    check(`D ${d.item} (${DECK}'s menu): in the one Flashcards tab (the tab that was on Decks), the tab named for it, the trail ending on it and naming ${DECK}, the deck's id in the address`, picked && s.fc.length === 1 && s.activeId === d0.activeId && matches(d.place, s.active) && deckTrail(s, DECK, ids.deck, d.place) && last(s) === s.active, { picked, before: short(d0), after: short(s) });
    check(`D ${d.item}: the kit's title, the keys on it, its hand-made Back (${d.back}) and Flashcards' own breadcrumb gone`, picked && s.title !== null && titleFocused(s) && !s.handBacks.includes(d.back) && s.ownCrumbs.length === 0, { title: s.title, focus: s.focus, handBacks: s.handBacks, ownCrumbs: s.ownCrumbs });
    if (d.item === 'Find Duplicates') {
      const dc = await crumbsGoThere();
      check(`D Find Duplicates: each crumb before the last pressed goes to that crumb's address in the same tab (the deck's crumb to ${DECK}'s screen)`, picked && dc.ok && dc.out.some((o) => o.crumb.includes(DECK)), dc.out);
    }
  }
  await closeAllEditors();
  await pressColumn('Decks', { ms: 2_200 });
  const cs0 = await read();
  const csPicked = await deckMenu(DECK, 'Custom Study');
  s = await read();
  check(`D Custom Study… (${DECK}'s menu): in the one Flashcards tab, named Custom Study, trail "Flashcards › … › Custom Study", an address, the kit's title`, csPicked && s.fc.length === 1 && s.activeId === cs0.activeId && /Custom Study/.test(s.active ?? '') && trailIs(s, /Custom Study/) && s.title !== null, { csPicked, before: short(cs0), after: short(s) });
  await closeAllEditors();
  await pressColumn('Decks', { ms: 2_200 });
  const cd0 = await read();
  const cdPressed = await pressColumn(CUSTOM, { deck: true, ms: 2_600 });
  s = await read();
  check(`D the custom deck's row (${CUSTOM}): in the one Flashcards tab, named for it, the trail from Flashcards ending on it, an address`, cdPressed && s.fc.length === 1 && s.activeId === cd0.activeId && (s.active ?? '').includes(CUSTOM) && s.crumbs[0]?.label === 'Flashcards' && !!s.crumbs[0]?.icon && last(s).includes(CUSTOM) && PLACE_ADDR.test(s.address), { cdPressed, before: short(cd0), after: short(s) });
  check('D the custom deck\'s screen: the kit\'s title, no hand-made "Decks" back (flashcards.customView.toDecks), no own breadcrumb', cdPressed && s.title !== null && !s.handBacks.includes('flashcards.customView.toDecks') && s.ownCrumbs.length === 0, { title: s.title, handBacks: s.handBacks, ownCrumbs: s.ownCrumbs });

  // ── A. Twice in a row; after a switch away ──
  await closeAllEditors();
  await pressColumn('Stats'); const a0 = await read();
  await pressColumn('Stats'); s = await read();
  check('A1 Stats pressed twice in a row: still one Flashcards tab, the same tab, on Stats', onePlace(a0, /^Stats$/) && onePlace(s, /^Stats$/) && s.activeId === a0.activeId && trailIs(s, /^Stats$/), { first: short(a0), second: short(s) });
  const notesPage = await runTool('canvas_create_page', { title: 'Probe Elsewhere', markdown: 'Another tab.' });
  await cmd(page, 'canvas.openPage', notesPage); await wait(2_000);
  const away = await read();
  await pressColumn('Decks', { ms: 2_400 });
  s = await read();
  check('A2 after switching to a page\'s tab, Decks pressed: the one Flashcards tab comes forward (same tab id) on Decks; the page\'s tab stays', !away.activeIsFc && onePlace(s, /^Decks$/) && s.activeId === a0.activeId && s.labels.includes('Probe Elsewhere') && trailIs(s, /^Decks$/), { away: away.active, after: short(s) });

  // ── B. Back and Forward ──
  await closeAllEditors();
  await pressColumn('Decks'); await pressColumn('Stats'); await pressColumn(DECK, { deck: true, ms: 2_600 });
  s = await read();
  const bId = s.activeId;
  await key('Alt+ArrowLeft');
  let b1 = await read();
  check(`B1 Decks → Stats → ${DECK}, Alt+Left: Stats, in the same tab, still one Flashcards tab`, onePlace(b1, /^Stats$/) && b1.activeId === bId && trailIs(b1, /^Stats$/), { before: bId, after: short(b1) });
  check('B2 after Back, the keys are on Stats\' page title', /^Stats$/.test(b1.active ?? '') && titleFocused(b1), b1.focus);
  await key('Alt+ArrowLeft');
  b1 = await read();
  check('B3 Alt+Left again: Decks, in the same tab, trail "Flashcards › Decks"', onePlace(b1, /^Decks$/) && b1.activeId === bId && trailIs(b1, /^Decks$/), short(b1));
  const bm = await markRight('Decks');
  check('B4 after Back the column\'s mark follows: only Decks is marked', /^Decks$/.test(b1.active ?? '') && bm.ok, bm);
  await key('Alt+ArrowRight');
  b1 = await read();
  check('B5 Alt+Right: Stats again, in the same tab', onePlace(b1, /^Stats$/) && b1.activeId === bId, short(b1));
  await key('Alt+ArrowRight');
  b1 = await read();
  check(`B6 Alt+Right again: ${DECK}'s screen, in the same tab`, b1.fc.length === 1 && b1.activeId === bId && (b1.active ?? '').includes(DECK) && deckTrail(b1, DECK, ids.deck), short(b1));

  // ── C. The manifest's commands ──
  await closeAllEditors();
  const commands = [
    ['flashcards.open', [], /^Decks$/, 'trail'],
    ['flashcards.stats', [], /^Stats$/, 'trail'],
    ['flashcards.study', [], /^Study$/, 'trail'],
    ['flashcards.customStudy', [], /Custom Study/, 'trail'],
    ['flashcards.generate', [], /^Make Cards$/, 'trail'],
    ['flashcards.studyTag', [CUSTOM_TAG], /Study|Formulas/, 'any'],
    ['flashcards.newCard', [], DECK2, 'deck'],
  ];
  let cId = null;
  for (const [id, args, place, kind] of commands) {
    const done = await runCmd(id, args); await wait(2_600);
    s = await read();
    if (cId === null) cId = s.activeId;
    const failedRun = typeof done === 'string' && /^failed/.test(done);
    const landed = kind === 'deck'
      ? s.fc.length === 1 && s.activeIsFc && s.activeId === cId && (s.active ?? '').includes(place) && deckTrail(s, place, ids.deck2)
      : kind === 'any'
        ? onePlace(s, place) && s.activeId === cId && s.crumbs[0]?.label === 'Flashcards' && last(s) === s.active && PLACE_ADDR.test(s.address)
        : onePlace(s, place) && s.activeId === cId && trailIs(s, place);
    check(`C ${id}${args.length ? ` ${JSON.stringify(args)}` : ''}: lands in the one Flashcards tab (same tab), on ${place instanceof RegExp ? place.source : `${place}'s screen`}, trail from Flashcards, a place address`, !failedRun && landed, { done, ...short(s) });
  }

  // ── L. Deep links in a page ──
  await closeAllEditors();
  const deckLink = `parallx://flashcards/deck/${ids.deck}`; const cardLink = `parallx://flashcards/card/${ids.card2}`; const studyLink = 'parallx://flashcards/study';
  const lPage = await makeLinkPage('Probe Flashcards Links', [deckLink, cardLink, studyLink]);
  await runCmd('flashcards.stats'); await wait(2_200);
  const l0 = await read();
  let clicked = await clickLink(lPage, deckLink);
  s = await read();
  check(`L1 ${deckLink}, clicked in a page: ${DECK}'s screen in the one Flashcards tab (the tab that was on Stats)`, clicked && s.fc.length === 1 && s.activeId === l0.activeId && (s.active ?? '').includes(DECK) && deckTrail(s, DECK, ids.deck), { clicked, before: short(l0), after: short(s) });
  clicked = await clickLink(lPage, cardLink);
  s = await read();
  check(`L2 ${cardLink} (a card of ${DECK2}), clicked in a page: ${DECK2}'s screen in the one tab`, ids.card2 > 0 && clicked && s.fc.length === 1 && s.activeId === l0.activeId && (s.active ?? '').includes(DECK2) && deckTrail(s, DECK2, ids.deck2), { clicked, after: short(s) });
  clicked = await clickLink(lPage, studyLink);
  s = await read();
  check(`L3 ${studyLink}, clicked in a page: Study in the one tab, trail "Flashcards › Study"`, clicked && onePlace(s, /^Study$/) && s.activeId === l0.activeId && trailIs(s, /^Study$/), { clicked, after: short(s) });

  // ── H. Home's card and feed; the sidebar's Today buttons ──
  await closeAllEditors();
  await runCmd('flashcards.stats'); await wait(2_200);
  const h0 = await read();
  await cmd(page, 'home.open'); await wait(2_600);
  const homeStudy = await page.evaluate(() => {
    const card = [...document.querySelectorAll('.home-card')].find((c) => c.getClientRects().length && /Flashcards/.test(c.querySelector('.home-card__from')?.textContent ?? '') && [...c.querySelectorAll('button, a')].some((b) => (b.textContent ?? '').trim() === 'Study'));
    const b = card && [...card.querySelectorAll('button, a')].find((x) => (x.textContent ?? '').trim() === 'Study');
    if (!b) return null; b.scrollIntoView({ block: 'nearest' }); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (homeStudy) { await page.mouse.click(homeStudy.x, homeStudy.y); await wait(2_800); }
  s = await read();
  check('H1 Home\'s Flashcards card, "Study" pressed: Study in the one Flashcards tab (the tab that was on Stats), trail "Flashcards › Study"', !!homeStudy && onePlace(s, /^Study$/) && s.activeId === h0.activeId && trailIs(s, /^Study$/), { homeStudy: !!homeStudy, after: short(s) });
  await cmd(page, 'home.open'); await wait(2_600);
  const feed = await page.evaluate((DECK) => {
    const t = [...document.querySelectorAll('.home-entry__title')].find((x) => x.getClientRects().length && (x.textContent ?? '').trim() === DECK);
    if (!t) return null; t.scrollIntoView({ block: 'nearest' }); const r = t.getBoundingClientRect(); return { x: r.x + Math.min(30, r.width / 2), y: r.y + r.height / 2 };
  }, DECK);
  if (feed) { await page.mouse.click(feed.x, feed.y); await wait(2_800); }
  s = await read();
  check(`H2 ${DECK} in Home's feed, pressed: its screen in the one Flashcards tab`, !!feed && s.fc.length === 1 && s.activeId === h0.activeId && (s.active ?? '').includes(DECK) && deckTrail(s, DECK, ids.deck), { feed: !!feed, after: short(s) });
  await runCmd('flashcards.stats'); await wait(2_000);
  const todayStudy = await centre(`${COLUMN} [data-px-id="flashcards.side.today.study"]`);
  if (todayStudy) { await page.mouse.click(todayStudy.x, todayStudy.y); await wait(2_800); }
  s = await read();
  check('H3 the sidebar\'s Today "Study N cards": Study in the one tab, trail "Flashcards › Study"', !!todayStudy && onePlace(s, /^Study$/) && s.activeId === h0.activeId && trailIs(s, /^Study$/), { todayStudy: !!todayStudy, after: short(s) });
  await runCmd('flashcards.stats'); await wait(2_000);
  await showColumn();
  const memo = await centre(`${COLUMN} [data-px-id="flashcards.side.today.memorize"]`);
  if (memo) { await page.mouse.click(memo.x, memo.y); await wait(2_800); }
  s = await read();
  check('H4 the sidebar\'s Today "Memorize": a Study place in the one tab, trail from Flashcards ending on the tab\'s name', !!memo && s.fc.length === 1 && s.activeId === h0.activeId && /Study|Memori/i.test(s.active ?? '') && s.crumbs[0]?.label === 'Flashcards' && last(s) === s.active && PLACE_ADDR.test(s.address), { memo: !!memo, after: short(s) });

  // ── T. The study session stays in the tab ──
  await closeAllEditors();
  await pressColumn('Study', { ms: 2_800 });
  const t0 = await read();
  const reveal = await centre('.editor-pane-container [data-px-id="flashcards.study.reveal"]');
  if (reveal) { await page.mouse.click(reveal.x, reveal.y); await wait(1_200); }
  const grade = await centre('.editor-pane-container [data-px-id^="flashcards.study.grade."]');
  if (grade) { await page.mouse.click(grade.x, grade.y); await wait(1_800); }
  s = await read();
  check('T1 in a study session, Show Answer then a grade pressed: still one Flashcards tab, the same tab, no tab more', !!reveal && !!grade && s.fc.length === 1 && s.activeId === t0.activeId && s.count === t0.count, { reveal: !!reveal, grade: !!grade, before: short(t0), after: short(s) }, { guard: true });
  check('T2 and the trail still ends on Study, the tab still named Study', !!grade && onePlace(s, /^Study$/) && trailIs(s, /^Study$/), short(s));

  // ── O. Ctrl+click; the deck's own menu; Open in Its Own Tab ──
  await closeAllEditors();
  await pressColumn('Stats', { ms: 2_200 });
  const o0 = await read();
  const ctrl = await pressColumn('Stats', { ctrl: true, ms: 2_600 });
  let o1 = await read();
  check('O1 on Stats, Ctrl+click on Stats in the column: a second Flashcards tab, both on Stats, the new one in front', onePlace(o0, /^Stats$/) && ctrl && o1.fc.length === 2 && o1.fc.every((l) => /^Stats$/.test(l)) && o1.activeId !== o0.activeId && trailIs(o1, /^Stats$/), { before: short(o0), ctrl, after: short(o1) });
  await closeAllEditors();
  await pressColumn('Stats', { ms: 2_200 });
  const o2a = await read();
  const ctrlDeck = await pressColumn(DECK, { deck: true, ctrl: true, ms: 2_800 });
  o1 = await read();
  check(`O2 on Stats, Ctrl+click on ${DECK}'s row: a second Flashcards tab on ${DECK}'s screen, in front; the Stats tab stays`, ctrlDeck && o1.fc.length === 2 && o1.activeId !== o2a.activeId && o1.fcIds.includes(o2a.activeId) && (o1.active ?? '').includes(DECK) && deckTrail(o1, DECK, ids.deck) && o1.fc.some((l) => /^Stats$/.test(l)), { before: short(o2a), ctrlDeck, after: short(o1) });
  await pressColumn(DECK, { deck: true, right: true, ms: 800 });
  const own = await menuItems();
  await page.keyboard.press('Escape'); await wait(400);
  check(`O3 ${DECK}'s row keeps its own menu (Study Deck, Browse Cards, Find Duplicates, Rename…)`, ['Study Deck', 'Find Duplicates', 'Rename'].every((x) => own.some((m) => m.includes(x))), own, { guard: true });
  await closeAllEditors();
  await pressColumn('Stats', { ms: 2_200 });
  const o3a = await read();
  await pressTab(null, { right: true, ms: 800 });
  const tabMenu = await menuItems();
  const picked = await pickMenuItem('Open in Its Own Tab');
  const o4 = await read();
  check('O4 the Flashcards tab\'s menu has "Open in Its Own Tab": one more tab on Stats', tabMenu.includes('Open in Its Own Tab') && picked && o4.fc.length === o3a.fc.length + 1 && o4.fc.every((l) => /^Stats$/.test(l)), { tabMenu, after: short(o4) });

  // ── Light and dark ──
  await closeAllEditors();
  await pressColumn(DECK, { deck: true, ms: 2_600 });
  await screenshot(app, page, path.join(shots, 'deck-dark.png'));
  await page.evaluate(() => document.documentElement.setAttribute('data-px-mode', 'light'));
  await wait(700);
  await screenshot(app, page, path.join(shots, 'deck-light.png'));
  await pressColumn('Decks', { ms: 2_400 });
  await screenshot(app, page, path.join(shots, 'decks-light.png'));
  await pressColumn('Stats', { ms: 2_400 });
  await screenshot(app, page, path.join(shots, 'stats-light.png'));
  await page.evaluate(() => document.documentElement.setAttribute('data-px-mode', 'dark'));

  // ── N. Nothing another tool owns changes ──
  await closeAllEditors();
  await cmd(page, 'worksheet.bank'); await wait(2_400);
  s = await read();
  check('N1 Worksheets\' Problem Bank: its own tab, "Problem Bank", trail "Worksheets › Problem Bank", a place address', s.active === 'Problem Bank' && s.crumbs[0]?.label === 'Worksheets' && last(s) === 'Problem Bank' && /^parallx:\/\/place\/worksheet\//.test(s.address) && !s.activeIsFc, short(s), { guard: true });

  // ── S. After the app is closed and opened ──
  await closeAllEditors();
  await pressColumn('Decks', { ms: 2_000 });
  await pressColumn(DECK, { deck: true, ms: 2_600 });
  const s0 = await read();
  await wait(1_500);
  await app.close(); app = null;
  await launch();
  s = await read();
  if (s.fcIds.length === 1 && !s.activeIsFc) await pressTab(null, { id: s.fcIds[0], ms: 2_600 });
  else await wait(1_000);
  s = await read();
  check(`S1 Decks then ${DECK} in the one tab, the app closed and opened: one Flashcards tab comes back, on ${DECK}'s screen (named for it, its id in the address)`, s0.fc.length === 1 && (s0.active ?? '').includes(DECK) && s.fc.length === 1 && (s.active ?? '').includes(DECK) && deckTrail(s, DECK, ids.deck), { before: short(s0), after: short(s) });

  // ── X. Turned off and on ──
  await ensureOn();
  await runCmd('flashcards.stats'); await wait(2_200);
  const off = await setToolEnabled(page, TOOL, false); await wait(2_500);
  const x0 = await read();
  const cmdGone = !(await hasCommand('flashcards.open'));
  check('X1 Flashcards turned off: no Flashcards tab, no Flashcards column, its commands gone', off === true && x0.fc.length === 0 && !x0.column && cmdGone, { off, fc: x0.fc, column: x0.column, cmdGone }, { guard: true });
  const offOpened = PLACE_ADDR.test(deckAddress) ? await clickLink(pPage, deckAddress) : 'no address read';
  await wait(1_800);
  const x0b = await read();
  check(`X2 while off, ${DECK}'s place address (read while on) opens nothing: no Flashcards tab`, PLACE_ADDR.test(deckAddress) && x0b.fc.length === 0, { deckAddress, offOpened: String(offOpened).slice(0, 80), fc: x0b.fc });
  const on = await setToolEnabled(page, TOOL, true); await wait(4_000);
  await runCmd('flashcards.open'); await wait(2_400);
  await runCmd('flashcards.stats'); await wait(2_400);
  const x1 = await read();
  check('X3 turned on again, open then stats: one Flashcards tab, on Stats, trail "Flashcards › Stats"', on === true && onePlace(x1, /^Stats$/) && trailIs(x1, /^Stats$/), { on, ...short(x1) });
} catch (err) {
  console.log(`[probe] stopped: ${err?.stack ?? err}`); failed.push('the probe stopped');
  if (page) await screenshot(app, page, path.join(shots, 'stopped.png')).catch(() => {});
} finally { await app?.close().catch(() => {}); }

const real = errors.filter((e) => !/Ollama|EmbeddingService|ERR_CONNECTION_REFUSED/.test(e));
console.log(`\n[probe] page errors: ${real.length}`); for (const e of real.slice(0, 6)) console.log('  ' + e);
console.log(`[probe] shots: ${shots}`);
console.log(`[probe] guards (true before the piece, must stay true): ${guards.join(', ') || 'none'}`);
const total = passed + failed.length;
console.log(`RESULT: ${passed}/${total} passed`);
process.exitCode = failed.length ? 1 : 0;
