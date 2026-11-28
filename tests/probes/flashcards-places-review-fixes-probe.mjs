// flashcards-places-review-fixes-probe.mjs — the three review fixes of
// f04ecb7e (Getting around, piece 6: Flashcards onto the places point),
// driven on the real app with the mouse and keys, read back from the page and
// from Flashcards' own database.
//
// Written by the verifier, not the builder. What it holds:
//   A. A typed-answer card (recallMode 'conceptual') first in a session: Study
//      pressed in the column puts the keys on the Study title; a word typed
//      there lands in the card's answer box; the card is not skipped (s), no
//      inline editor opens (e), nothing is graded or undone (z); the session
//      writes no review. The same after leaving Study and coming back.
//   R. A recognition card: Study pressed, the keys on the title, Space shows
//      the answer, a digit grades: the next card comes up and the review is in
//      the database after the app is closed.
//   L. The title's left edge equals the left edge of what is under it (±2px)
//      on Stats, Decks, Custom Study and Find Duplicates.
//   W. A deck with an 85-character name in a ~500px editor: Browse's page does
//      not scroll sideways and its title wraps onto more than one line.
// On 83d6f32b (the build before the fixes) A, L and W are expected to fail;
// R is a guard (it held before) and must stay true. Run 2026-11-28:
// 83d6f32b 7 passed, 10 failed (A2-A5, the four L, W2, W3); f04ecb7e 17 of 17.
//
//   node scripts/build.mjs && xvfb-run -a node tests/probes/flashcards-places-review-fixes-probe.mjs [outDir]
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PROJECT_ROOT, launchApp, toolList, setToolEnabled, screenshot } from './scene.mjs';

const root = process.argv[2] ? path.resolve(process.argv[2]) : path.join(PROJECT_ROOT, 'tests', '.tmp-fc-review-fixes');
await fs.rm(root, { recursive: true, force: true });
const shots = path.join(root, 'shots');
await fs.mkdir(shots, { recursive: true });

let passed = 0; const failed = [];
const check = (name, ok, got) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `: ${JSON.stringify(got)}`}`);
  if (ok) passed += 1; else failed.push(name);
};

const manifest = JSON.parse(await fs.readFile(path.join(PROJECT_ROOT, 'ext', 'flashcards', 'parallx-manifest.json'), 'utf8'));
const TOOL = manifest.id;
const COLUMN = '.view[data-view-id="flashcards.decks"]';
const ELECTRON = path.join(PROJECT_ROOT, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');

async function makeWorkspace(name) {
  const base = path.join(root, name);
  const appRoot = path.join(base, 'app'); const ws = path.join(base, 'workspace');
  for (const d of [path.join(appRoot, 'data'), path.join(ws, '.parallx')]) await fs.mkdir(d, { recursive: true });
  await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: ws }));
  await fs.writeFile(path.join(ws, '.parallx/ai-config.json'), JSON.stringify({ overrides: { indexing: { autoIndex: false, watchFiles: false }, suggestions: { suggestionsEnabled: false }, heartbeat: { enabled: false } } }));
  try { await fs.symlink(path.join(PROJECT_ROOT, 'ext'), path.join(appRoot, 'ext'), 'junction'); } catch { /* there */ }
  return { appRoot, ws };
}
const sqlScript = path.join(root, 'sql.cjs');
await fs.writeFile(sqlScript, `
const Database = require(${JSON.stringify(path.join(PROJECT_ROOT, 'node_modules', 'better-sqlite3'))});
const db = new Database(process.argv[2], { readonly: true });
const out = [];
for (const s of JSON.parse(process.argv[3])) out.push(db.prepare(s).all());
db.close();
console.log(JSON.stringify(out));
`);
async function sql(ws, statements) {
  const dir = path.join(ws, '.parallx', 'extensions');
  const names = await fs.readdir(dir).catch(() => []);
  for (const n of [TOOL, 'flashcards', ...names.filter((x) => /flashcard/i.test(x))]) {
    const p = path.join(dir, n, 'data.db');
    try { await fs.access(p); } catch { continue; }
    const r = spawnSync(ELECTRON, [sqlScript, p, JSON.stringify(statements)], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8' });
    if (r.status !== 0) return `sql: ${r.stderr || r.stdout}`;
    return JSON.parse(r.stdout.trim().split(/\r?\n/).pop());
  }
  return 'no database';
}

let app = null; let page = null; let errors = [];
const wait = (ms) => page.waitForTimeout(ms);
async function launch(appRoot) {
  ({ app, page, errors } = await launchApp(appRoot));
  await page.waitForFunction(() => !!window.__parallx_workbench__?._services, null, { timeout: 60_000 });
  await wait(2_500);
  const t = (await toolList(page)).find((x) => x.id === TOOL);
  if (t && !t.enabled) { await setToolEnabled(page, TOOL, true); await wait(4_000); }
}
const addCards = (deckName, cards) => page.evaluate(({ deckName, cards }) => window.__parallx_workbench__._services.get({ id: 'ICommandService' }).executeCommand('flashcards.addCards', { deckName, cards }).catch((e) => String(e?.message || e)), { deckName, cards });
async function closeAllEditors() {
  for (let i = 0; i < 40; i++) {
    const n = await page.evaluate(() => document.querySelectorAll('.editor-group .ui-tab:not(.ui-tab--leaving)').length);
    if (!n) break;
    await page.evaluate(() => window.__parallx_workbench__._services.get({ id: 'ICommandService' }).executeCommand('workbench.action.closeActiveEditor'));
    await wait(250);
  }
}
async function showColumn() {
  const shown = await page.evaluate((COLUMN) => { const v = document.querySelector(COLUMN); return !!v && v.getClientRects().length > 0; }, COLUMN);
  if (shown) return;
  const at = await page.evaluate(() => { const e = [...document.querySelectorAll('.activity-bar-item[data-icon-id="flashcards-container"]')].find((x) => x.getClientRects().length); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  if (at) { await page.mouse.click(at.x, at.y); await wait(1_200); }
}
/** A column row by its label (or, with deck, a deck's row holding the label), clicked by the mouse. */
async function pressColumn(label, { deck = false, right = false, ms = 2_400 } = {}) {
  await showColumn();
  const at = await page.evaluate(({ label, deck, COLUMN }) => {
    const view = document.querySelector(COLUMN); if (!view) return null;
    const nameOf = (e) => ((e.querySelector('.fc-sb__nav-label, .fc-deck-row__name, .px-btn__label')?.textContent) || e.getAttribute('aria-label') || e.textContent || '').replace(/\s+/g, ' ').trim();
    const all = [...view.querySelectorAll('button, a[href], [role="link"], [role="button"], [role="tab"], [role="treeitem"], .fc-deck-row')];
    const e = all.find((x) => x.getClientRects().length && (deck ? nameOf(x).includes(label) && !/^Actions for/.test(nameOf(x)) && !x.classList.contains('fc-deck-row__more') : nameOf(x) === label));
    if (!e) return null;
    e.scrollIntoView({ block: 'nearest' });
    const r = e.getBoundingClientRect(); return { x: r.x + Math.min(40, r.width / 2), y: r.y + r.height / 2 };
  }, { label, deck, COLUMN });
  if (!at) return false;
  await page.mouse.click(at.x, at.y, { button: right ? 'right' : 'left' });
  await wait(ms);
  return true;
}
async function pickMenuItem(text) {
  const at = await page.evaluate((text) => {
    const r = [...document.querySelectorAll('.context-menu .context-menu-item')].filter((x) => x.getClientRects().length).find((x) => (x.textContent ?? '').includes(text));
    if (!r) return null; const b = r.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }, text);
  if (!at) { await page.keyboard.press('Escape'); return false; }
  await page.mouse.click(at.x, at.y); await wait(2_400);
  return true;
}

/** The Study surface as a person sees it: where the keys are, the card's question, the answer box, an open editor. */
const studyState = () => page.evaluate(() => {
  const vis = (e) => !!e && e.getClientRects().length > 0;
  const pane = [...document.querySelectorAll('.fc-pane')].find(vis);
  const ae = document.activeElement;
  const front = pane?.querySelector('.fc-study__front');
  const answer = [...(pane?.querySelectorAll('.fc-study__produce-input') ?? [])].find(vis);
  const grades = [...(pane?.querySelectorAll('[data-px-id^="flashcards.study.grade."]') ?? [])].filter(vis).length;
  return {
    focus: ae ? { tag: ae.tagName, cls: String(ae.className ?? ''), text: (ae.textContent ?? '').trim().slice(0, 40) } : null,
    onTitle: !!ae && ae.tagName === 'H1' && /\bpx-page-header__title\b/.test(String(ae.className)) && !!pane?.contains(ae),
    title: ([...(pane?.querySelectorAll('.px-page-header__title') ?? [])].find(vis)?.textContent ?? '').trim(),
    front: (front?.textContent ?? '').replace(/\s+/g, ' ').trim(),
    answer: answer ? answer.value : null,
    answerFocused: !!answer && ae === answer,
    editorOpen: [...(pane?.querySelectorAll('.fc-study__edit') ?? [])].some(vis),
    grades,
  };
});

/** On the shown Flashcards page: the title's left edge and the left edge of what is under it. */
const alignment = () => page.evaluate(() => {
  const vis = (e) => !!e && e.getClientRects().length > 0 && e.getBoundingClientRect().width > 0;
  const pane = [...document.querySelectorAll('.fc-pane')].find(vis);
  const t = [...(pane?.querySelectorAll('.fc-pane__body .px-page-header__title') ?? [])].find(vis);
  if (!t) return { title: null };
  const view = t.closest('.fc-view') ?? pane.querySelector('.fc-pane__body');
  // The title's top-level block in the page, then the first drawn block after it.
  let top = t; while (top.parentElement && top.parentElement !== view) top = top.parentElement;
  let next = top.nextElementSibling; while (next && !vis(next)) next = next.nextElementSibling;
  const cs = getComputedStyle(view);
  const box = view.getBoundingClientRect().left + parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth);
  // The title's text, where it is drawn (its own box can carry padding).
  const range = document.createRange(); range.selectNodeContents(t);
  const textLeft = range.getClientRects()[0]?.left ?? t.getBoundingClientRect().left;
  return {
    title: (t.textContent ?? '').trim(), titleLeft: Math.round(t.getBoundingClientRect().left * 10) / 10, textLeft: Math.round(textLeft * 10) / 10,
    under: next ? `${next.tagName.toLowerCase()}.${String(next.className).split(' ')[0]}` : null,
    underLeft: next ? Math.round(next.getBoundingClientRect().left * 10) / 10 : null,
    contentLeft: Math.round(box * 10) / 10,
  };
});
const lined = (a) => a.title !== null && a.underLeft !== null && Math.abs(a.textLeft - a.underLeft) <= 2 && Math.abs(a.textLeft - a.contentLeft) <= 2;

try {
  // ── A. Typed-answer cards only: the first card of the session asks for a typed answer. ──
  const wa = await makeWorkspace('typed');
  await launch(wa.appRoot);
  const rubric = [{ text: 'names the method', required: true }];
  const madeA = await addCards('Typed Deck', [
    { front: 'Explain the chain ladder method.', back: 'It projects ultimate losses by development factors.', recallMode: 'conceptual', rubric },
    { front: 'Explain the Bornhuetter-Ferguson method.', back: 'A credibility blend of expected and developed losses.', recallMode: 'conceptual', rubric },
    { front: 'Explain the Cape Cod method.', back: 'Bornhuetter-Ferguson with the prior estimated from the data.', recallMode: 'conceptual', rubric },
  ]);
  await wait(1_500);
  await closeAllEditors();
  const pressedA = await pressColumn('Study', { ms: 3_000 });
  const a0 = await studyState();
  check('A1 Study pressed in the column (typed-answer cards only): the keys are on the Study title and an empty answer box is drawn',
    pressedA && a0.onTitle && a0.title === 'Study' && a0.answer === '' && !!a0.front, { pressedA, madeA: typeof madeA === 'object' ? madeA?.count : madeA, ...a0 });
  await screenshot(app, page, path.join(shots, 'a-typed-before.png'), { keepFocus: true });
  await page.keyboard.type('test', { delay: 60 }); await wait(800);
  const a1 = await studyState();
  check('A2 "test" typed on the title lands in the answer box, and the keys go with it', a1.answer === 'test' && a1.answerFocused, a1);
  check('A3 the card is not skipped (s): the same question is still shown', a1.front === a0.front && !!a0.front, { before: a0.front, after: a1.front });
  check('A4 no inline editor opens (e)', !a1.editorOpen, a1);
  await screenshot(app, page, path.join(shots, 'a-typed-after.png'), { keepFocus: true });
  // Twice: leave Study for Decks, come back by the column, type again.
  await pressColumn('Decks', { ms: 2_000 });
  await pressColumn('Study', { ms: 3_000 });
  const a2 = await studyState();
  const a2before = a2.answer;
  if (a2.answerFocused) await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.type('zse', { delay: 60 }); await wait(800);
  const a3 = await studyState();
  check('A5 back on Study a second time: "zse" typed lands in the answer box; the question stays, no editor',
    a3.answer !== null && a3.answer.endsWith('zse') && a3.answer.length === (a2before ?? '').length + 3 && a3.front === a2.front && !!a2.front && !a3.editorOpen,
    { a2, a3 });
  await closeAllEditors();
  await app.close(); app = null;
  const revA = await sql(wa.ws, ['SELECT COUNT(*) AS n FROM fc_reviews']);
  check('A6 nothing was graded: no review in Flashcards\' database', Array.isArray(revA) && revA[0][0].n === 0, revA);

  // ── R. Recognition cards: Space shows the answer, a digit grades. ──
  const wr = await makeWorkspace('recognition');
  await launch(wr.appRoot);
  await addCards('Plain Deck', [
    { front: 'What is an age-to-age factor?', back: 'The ratio of losses at one age to the age before.' },
    { front: 'What is tail development?', back: 'Development past the last age.' },
    { front: 'What does Mack give?', back: 'The standard error of the reserve.' },
  ]);
  await wait(1_500);
  await closeAllEditors();
  const pressedR = await pressColumn('Study', { ms: 3_000 });
  const r0 = await studyState();
  check('R1 Study pressed in the column (recognition cards): the keys are on the Study title, no answer box, no grades yet',
    pressedR && r0.onTitle && r0.answer === null && r0.grades === 0 && !!r0.front, { pressedR, ...r0 });
  await page.keyboard.press('Space'); await wait(1_000);
  const r1 = await studyState();
  check('R2 Space on the title shows the answer: the four grades are drawn', r1.grades === 4, r1);
  await page.keyboard.press('3'); await wait(1_500);
  const r2 = await studyState();
  check('R3 3 grades the card: the next card is up, on its question', r2.front !== r0.front && !!r2.front && r2.grades === 0, { before: r0.front, after: r2 });
  await closeAllEditors();
  await app.close(); app = null;
  const revR = await sql(wr.ws, ['SELECT COUNT(*) AS n FROM fc_reviews', 'SELECT rating FROM fc_reviews']);
  check('R4 the grade is in Flashcards\' database (one review, rating 3)', Array.isArray(revR) && revR[0][0].n === 1 && revR[1][0].rating === 3, revR);

  // ── L and W. Titles line up; a long deck name wraps in a narrow pane. ──
  const wl = await makeWorkspace('layout');
  await launch(wl.appRoot);
  const LONG = 'Exam 7 Reading Notes on Loss Development, Reserve Variability and Tail Factor Selection';
  await addCards('Layout Deck', [
    { front: 'Probe card one', back: '1', tags: ['probe-layout'] }, { front: 'Probe card one', back: '1' }, { front: 'Probe card two', back: '2' },
  ]);
  await addCards(LONG, [{ front: 'Long deck card', back: 'x' }]);
  await wait(1_500);
  await closeAllEditors();
  for (const [what, open] of [
    ['Stats', () => pressColumn('Stats')],
    ['Decks', () => pressColumn('Decks')],
    ['Custom Study', async () => (await pressColumn('Layout Deck', { deck: true, right: true, ms: 800 })) && pickMenuItem('Custom Study')],
    ['Find Duplicates', async () => (await pressColumn('Layout Deck', { deck: true, right: true, ms: 800 })) && pickMenuItem('Find Duplicates')],
  ]) {
    const opened = await open();
    const a = await alignment();
    check(`L ${what}: the title's left edge equals the left edge of what is under it (±2px)`, !!opened && lined(a), { opened, ...a });
    await screenshot(app, page, path.join(shots, `l-${what.toLowerCase().replace(/\s+/g, '-')}.png`));
  }
  // Narrow the window until the editor is about 500px wide.
  const editorWidth = () => page.evaluate(() => { const g = [...document.querySelectorAll('.editor-group')].find((x) => x.getClientRects().length); return g ? Math.round(g.getBoundingClientRect().width) : 0; });
  let ew = await editorWidth();
  for (let i = 0; i < 4 && Math.abs(ew - 500) > 20; i++) {
    const vw = await page.evaluate(() => window.innerWidth);
    await page.setViewportSize({ width: Math.max(300, vw - (ew - 500)), height: 900 }); await wait(900);
    ew = await editorWidth();
  }
  const pressedW = await pressColumn(LONG.slice(0, 30), { deck: true, ms: 2_600 });
  const w = await page.evaluate(() => {
    const vis = (e) => !!e && e.getClientRects().length > 0;
    const pane = [...document.querySelectorAll('.fc-pane')].find(vis);
    const body = pane?.querySelector('.fc-pane__body');
    const view = body?.querySelector('.fc-view');
    const t = [...(body?.querySelectorAll('.px-page-header__title') ?? [])].find(vis);
    const range = document.createRange(); if (t) range.selectNodeContents(t);
    const lines = t ? new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size : 0;
    const editor = pane?.closest('.editor-pane-container') ?? null;
    return {
      title: (t?.textContent ?? '').trim(), lines, titleRight: t ? Math.round(t.getBoundingClientRect().right) : null,
      paneRight: pane ? Math.round(pane.getBoundingClientRect().right) : null,
      bodyScroll: body ? [body.scrollWidth, body.clientWidth] : null,
      viewScroll: view ? [view.scrollWidth, view.clientWidth] : null,
      editorScroll: editor ? [editor.scrollWidth, editor.clientWidth] : null,
      pageScroll: [document.body.scrollWidth, document.body.clientWidth],
    };
  });
  check(`W1 the editor is about 500px wide (${ew}px) and ${LONG.length} characters' deck's Browse is open`, pressedW && Math.abs(ew - 500) <= 40 && w.title.includes(LONG.slice(0, 20)), { ew, pressedW, title: w.title });
  const noSide = (p) => !!p && p[0] <= p[1];
  check('W2 Browse\'s page does not scroll sideways (its scroll width is no wider than its width, in the pane, the editor and the window)',
    noSide(w.bodyScroll) && noSide(w.viewScroll) && noSide(w.editorScroll) && noSide(w.pageScroll) && w.titleRight !== null && w.titleRight <= w.paneRight + 1, w);
  check('W3 the long title wraps onto more than one line', w.lines >= 2, w);
  await screenshot(app, page, path.join(shots, 'w-browse-narrow-dark.png'));
  await closeAllEditors();
} catch (err) {
  console.log(`[probe] stopped: ${err?.stack ?? err}`);
  failed.push('the probe stopped');
  try { await page?.screenshot({ path: path.join(shots, 'stopped.png') }); } catch { /* no window */ }
} finally {
  await app?.close().catch(() => {});
}
const pageErrors = errors.filter((e) => e.startsWith('pageerror'));
console.log(`\n[probe] page errors (last run): ${pageErrors.length}`);
for (const e of pageErrors.slice(0, 6)) console.log('  ' + e);
console.log(`RESULT ${passed} passed, ${failed.length} failed${failed.length ? ': ' + failed.join('; ') : ''}`);
console.log(`[probe] shots: ${shots}`);
process.exitCode = failed.length ? 1 : 0;
