// run-navigation-probe.mjs — the flashcards navigation surface, headless.
//
// Unit tests cover the pure logic; this covers the wiring that actually broke:
// a route dispatched at a tab whose PANE is not alive (workspace restore, LRU
// eviction, tab-switch teardown) used to be swallowed, so Custom Study, Study
// Deck and Browse Cards surfaced the tab on whatever it last showed and looked
// dead. It also pins the sidebar rail, the pane breadcrumb, and the Decks home.
//
// Headless: jsdom + node:sqlite, no Electron, no window
// (dev machine = study machine).
//
// Run:  node ext/flashcards/test/run-navigation-probe.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(__dirname, '..');
const { JSDOM } = await import('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
global.window = dom.window;
global.document = dom.window.document;
for (const k of ['HTMLElement', 'CustomEvent', 'Event', 'Node', 'getComputedStyle']) global[k] = dom.window[k];
global.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
global.cancelAnimationFrame = (id) => clearTimeout(id);
try { Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true }); } catch {}

const sql = new DatabaseSync(':memory:');
const dbApi = {
  async open() { return {}; },
  async migrate(dir) { for (const f of fs.readdirSync(dir).sort()) sql.exec(fs.readFileSync(path.join(dir, f), 'utf8')); return {}; },
  async run(s, p = []) { try { const r = sql.prepare(s).run(...p); return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) }; } catch (e) { return { error: e }; } },
  async get(s, p = []) { try { return { row: sql.prepare(s).get(...p) ?? null }; } catch (e) { return { error: e }; } },
  async all(s, p = []) { try { return { rows: sql.prepare(s).all(...p) }; } catch (e) { return { error: e }; } },
};

let editorProvider = null, sidebarProvider = null;
const cmds = {};
const openEditors = [];
let lastMenu = null;
const api = {
  env: { toolPath: EXT },
  database: dbApi,
  views: { registerViewProvider: (id, p) => { sidebarProvider = p; return { dispose() {} }; } },
  editors: {
    registerEditorProvider: (t, p) => { editorProvider = p; return { dispose() {} }; },
    get openEditors() { return openEditors; },
    focusEditor: async () => true,
    openEditor: async (o) => { const id = `parallx-community.flashcards:${o.typeId}:${o.instanceId}`; if (!openEditors.some((e) => e.id === id)) openEditors.push({ id, name: o.title }); },
    openFileEditor: async () => {},
  },
  commands: { registerCommand: (id, h) => { cmds[id] = h; return { dispose() {} }; }, executeCommand: async () => undefined },
  window: { showInformationMessage: () => {}, showErrorMessage: (m) => console.log('[err]', m), showWarningMessage: () => {}, showInputBox: async () => null, showConfirmModal: async () => false },
  workspace: { getConfiguration: () => ({ get: (k, d) => d }), onDidChangeConfiguration: () => ({ dispose() {} }) },
  ui: {
    renderMarkdown: (t) => { const d = document.createElement('div'); d.textContent = t; return d; },
    createDropdown: (c, o = {}) => { const e = document.createElement('div'); c.appendChild(e); let v = o.selected ?? ''; const ls = []; return { element: e, get value() { return v; }, set value(x) { v = x; }, setItems() {}, onDidChange: (l) => { ls.push(l); return { dispose() {} }; }, focus() {}, setDisabled() {}, dispose() {}, _fire(x) { v = x; ls.forEach((l) => l(x)); }, _items: o.items }; },
    createAiButton: (h, o) => { const b = document.createElement('button'); b.className = 'fc-btn'; b.textContent = o.label; h.appendChild(b); return b; },
    showContextMenu: (pos, items) => { lastMenu = items.map((i) => i.label || '—'); },
  },
  lm: {}, links: { registerLinkHandler: () => ({ dispose() {} }) }, dashboard: { registerWidget: () => ({ dispose() {} }) },
};

const mod = await import(pathToFileURL(path.join(EXT, 'main.js')).href);
await mod.activate(api, { subscriptions: [] });

const now = Date.now();
const DAY = 86400000;
await dbApi.run('INSERT INTO fc_decks (id, name, created_at, exam_date) VALUES (1, ?, ?, ?)', ['Exam 7', now, now + 90 * DAY]);
await dbApi.run('INSERT INTO fc_decks (id, name, created_at) VALUES (2, ?, ?)', ['Mack Chainladder', now]);
const ins = sql.prepare('INSERT INTO fc_cards (id, deck_id, front, back, created_at, state, ease, interval_days, due_at, reps, lapses, learning_step, tags) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)');
for (let i = 1; i <= 60; i++) ins.run(i, 1, 'Q' + i, 'A' + i, now - i * 1000, 'new', 2.5, 0, 0, 0, 0, 0, '');
for (let i = 61; i <= 80; i++) ins.run(i, 1, 'Q' + i, 'A' + i, now - i * 1000, 'review', 2.5, 5, now + (i - 60) * DAY, 3, i % 4, 0, '');
for (let i = 81; i <= 95; i++) ins.run(i, 2, 'Q' + i, 'A' + i, now - i * 1000, 'new', 2.5, 0, 0, 0, 0, 0, '');

let fails = 0;
const check = (label, ok, detail = '') => {
  if (ok) console.log('  PASS  ' + label);
  else { fails++; console.log('  FAIL  ' + label + (detail ? ' — ' + detail : '')); }
};
const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms));
const click = (node) => node.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
const btnByText = (host, re) => [...host.querySelectorAll('button')].find((b) => re.test(b.textContent));

console.log('\n=== 1. route survives when no pane is alive ===');
openEditors.push({ id: 'parallx-community.flashcards:flashcards:main', name: 'Flashcards' });
await cmds['flashcards.customStudy']();
await settle();
const host = document.createElement('div');
document.body.appendChild(host);
editorProvider.createEditorPane(host, { id: 'x', instanceId: 'main', setName() {} });
await settle(350);
check('flashcards.customStudy lands on Custom Study, not the default view',
  host.querySelector('.fc-view__title')?.textContent === 'Custom Study',
  'saw: ' + host.querySelector('.fc-view__title')?.textContent);

console.log('\n=== 2. sidebar navigation rail ===');
const sbHost = document.createElement('div');
document.body.appendChild(sbHost);
const sb = sidebarProvider.createView(sbHost);
await settle(300);
const rail = [...sbHost.querySelectorAll('.fc-sb__nav-item')].map((n) => n.textContent.trim());
check('rail lists every destination', JSON.stringify(rail) === JSON.stringify(['Decks', 'Study', 'Create', 'Import', 'Stats']), JSON.stringify(rail));
check('rail is above the scroller (does not scroll away)',
  sbHost.querySelector('.fc-sidebar > .fc-sb__nav') !== null);
check('rail lights the view the pane is on (Custom Study lights Study)',
  sbHost.querySelector('.fc-sb__nav-item--active')?.dataset.view === 'study',
  'lit: ' + sbHost.querySelector('.fc-sb__nav-item--active')?.dataset.view);

const statsItem = [...sbHost.querySelectorAll('.fc-sb__nav-item')].find((n) => n.dataset.view === 'stats');
click(statsItem);
await settle(400);
check('clicking a rail entry navigates the pane', host.textContent.includes('Stats') || !!host.querySelector('.fc-view'),
  host.querySelector('.fc-pane__body')?.textContent?.slice(0, 60));
check('rail follows the pane to Stats', sbHost.querySelector('.fc-sb__nav-item--active')?.dataset.view === 'stats');

const decksItem = [...sbHost.querySelectorAll('.fc-sb__nav-item')].find((n) => n.dataset.view === 'decks');
click(decksItem);
await settle(400);

console.log('\n=== 3. Decks home page ===');
const body = host.querySelector('.fc-pane__body');
check('home has a masthead', body.querySelector('.fc-home__title')?.textContent === 'Decks');
check('masthead summarises the collection', /2 decks · 95 cards · next exam in \d+ days/.test(body.querySelector('.fc-home__sub')?.textContent || ''),
  body.querySelector('.fc-home__sub')?.textContent);
check("today's numbers are on the home page", body.querySelectorAll('.fc-home__stat').length === 3);
const homeStudy = btnByText(body, /Study \d+ Cards?/);
check('home offers the daily session', !!homeStudy && !homeStudy.disabled, homeStudy?.textContent);
check('home offers Custom Study', !!btnByText(body, /^Custom Study$/));
check('home offers Import Cards', !!btnByText(body, /Import Cards/));
check('home lists both decks', body.querySelectorAll('.fc-deck-card').length === 2);
check('deck counts are labelled', body.querySelector('.fc-deck-count__l')?.textContent === 'new');
check('deck actions are visible, not hover-only', body.querySelectorAll('.fc-deck-card__actions .fc-btn').length === 6);
const moreBtn = body.querySelector('.fc-deck-card__actions .fc-btn--icon');
click(moreBtn);
await settle(80);
check('deck overflow opens the ONE shared deck menu',
  Array.isArray(lastMenu) && lastMenu.includes('Custom Study…') && lastMenu.includes('Delete Deck'),
  JSON.stringify(lastMenu));

console.log('\n=== 4. pane breadcrumb replaced the tab strip ===');
check('no tab strip in the pane', host.querySelectorAll('.fc-pane__tab').length === 0);
check('breadcrumb on the home reads Decks', host.querySelector('.fc-pane__crumbs')?.textContent === 'Decks',
  host.querySelector('.fc-pane__crumbs')?.textContent);
click([...body.querySelectorAll('.fc-deck-card__info')][0]);
await settle(400);
check('deck-scoped breadcrumb names the deck',
  /Decks\s*\/\s*Exam 7/.test(host.querySelector('.fc-pane__crumbs')?.textContent || ''),
  host.querySelector('.fc-pane__crumbs')?.textContent);
check('rail lights Decks while inside a deck', sbHost.querySelector('.fc-sb__nav-item--active')?.dataset.view === 'decks');
check('the deck row in the sidebar is selected',
  sbHost.querySelector('.fc-deck-row--active')?.dataset.deckId === '1',
  sbHost.querySelector('.fc-deck-row--active')?.dataset.deckId);
const backCrumb = [...host.querySelectorAll('.fc-crumb--link')][0];
click(backCrumb);
await settle(400);
check('breadcrumb walks back to the home', host.querySelector('.fc-home__title')?.textContent === 'Decks');

console.log('\n=== 5. Custom Study + Review Ahead ===');
document.dispatchEvent(new dom.window.CustomEvent('parallx.flashcards.route', { detail: { view: 'custom' } }));
await settle(350);
const cs = host.querySelector('.fc-pane__body');
check('Custom Study opens', cs.querySelector('.fc-view__title')?.textContent === 'Custom Study');
check('availability is reported', /\d+ new cards available/.test(cs.querySelector('.fc-cs__avail')?.textContent || ''),
  cs.querySelector('.fc-cs__avail')?.textContent);
let start = btnByText(cs, /Study \d+ Cards?/);
check('Extra New Cards can start', !!start && !start.disabled, start?.textContent);
click(start);
await settle(450);
check('Extra New Cards serves a session', !!host.querySelector('.fc-study'));

document.dispatchEvent(new dom.window.CustomEvent('parallx.flashcards.route', { detail: { view: 'custom' } }));
await settle(350);
const cs2 = host.querySelector('.fc-pane__body');
click([...cs2.querySelectorAll('.fc-cs__mode')].find((m) => /Review Ahead/.test(m.textContent)));
await settle(150);
check('Review Ahead reports what is in range', /\d+ reviews in range available/.test(cs2.querySelector('.fc-cs__avail')?.textContent || ''),
  cs2.querySelector('.fc-cs__avail')?.textContent);
start = btnByText(cs2, /Study \d+ Cards?/);
check('Review Ahead can start', !!start && !start.disabled, start?.textContent);
click(start);
await settle(450);
check('Review Ahead serves a session', !!host.querySelector('.fc-study'));
check('the session is banner-labelled Review Ahead', /Review Ahead/.test(host.querySelector('.fc-pane__body')?.textContent || ''));

console.log('\n=== 6. deck menu route from the sidebar ===');
lastMenu = null;
const deckRowMore = sbHost.querySelector('.fc-deck-row__more');
click(deckRowMore);
await settle(60);
check('sidebar deck menu carries Custom Study…', (lastMenu || []).includes('Custom Study…'), JSON.stringify(lastMenu));

console.log('\n=== 7. working ahead after the daily session (the blank-pane bug) ===');
// A deck's daily session is keyed by its id; a custom one by its launch
// stamp. Mixing a number into that map used to throw inside the pruner,
// AFTER the study root was appended — a blank pane with no error on screen.
document.dispatchEvent(new dom.window.CustomEvent('parallx.flashcards.route', { detail: { view: 'study', deckId: 1 } }));
await settle(400);
check('the deck studies normally', !!host.querySelector('.fc-study__front'));

document.dispatchEvent(new dom.window.CustomEvent('parallx.flashcards.route', { detail: { view: 'custom', deckId: 1 } }));
await settle(350);
const cs3 = host.querySelector('.fc-pane__body');
const modeCounts = [...cs3.querySelectorAll('.fc-cs__mode')].map((m) =>
  `${m.querySelector('.fc-cs__mode-name').textContent}=${m.querySelector('.fc-cs__mode-count').textContent}`);
check('every mode reports its own count, not just the selected one',
  modeCounts.length === 4 && modeCounts.every((t) => !t.endsWith('=')), modeCounts.join('  '));
const start3 = btnByText(cs3, /Study \d+ Cards?/);
click(start3);
await settle(500);
check('the custom session renders instead of a blank pane',
  !!host.querySelector('.fc-study__front'),
  JSON.stringify(host.querySelector('.fc-pane__body').textContent.slice(0, 80)));

console.log(fails === 0 ? '\nAll checks passed.' : `\n${fails} check(s) FAILED.`);
process.exit(fails === 0 ? 0 : 1);
