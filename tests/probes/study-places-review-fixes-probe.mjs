// study-places-review-fixes-probe.mjs — two fixes to Study's places, on the real app:
//   ba8b2e01: a subject's page header follows the subject once read (its subtitle
//             "N of M questions answered", its More Actions menu: Open Plan, Show/Hide Units),
//             and the keys stay on its title when it is drawn again.
//   162505ff: the setup sheet (Study… on the subject's or a unit's page) cancelled by
//             Escape, Cancel or its X brings back the tab it was opened from (Study's tab,
//             in the middle of the strip) and the keys go back on Study…; Start does not.
//
// Boots the built app hidden with a new profile and workspace, seeds a subject over a
// questions database (as getting-around-study-acceptance.mjs does), drives it by mouse
// and keys, and reads the tabs, the header and the focus back from the app.
//
//   node scripts/build.mjs && xvfb-run -a node tests/probes/study-places-review-fixes-probe.mjs [outDir]
import fs from 'node:fs/promises';
import path from 'node:path';
import { PROJECT_ROOT, launchApp, screenshot, toolList, setToolEnabled } from './scene.mjs';

const root = process.argv[2] ? path.resolve(process.argv[2]) : path.join(PROJECT_ROOT, 'test-results', 'study-places-review-fixes');
await fs.rm(root, { recursive: true, force: true });
const appRoot = path.join(root, 'app'); const ws = path.join(root, 'workspace'); const shots = path.join(root, 'shots');
for (const d of [path.join(appRoot, 'data'), path.join(ws, '.parallx'), shots]) await fs.mkdir(d, { recursive: true });
await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: ws }));
await fs.writeFile(path.join(ws, '.parallx/ai-config.json'), JSON.stringify({ overrides: { indexing: { autoIndex: false, watchFiles: false }, suggestions: { suggestionsEnabled: false }, heartbeat: { enabled: false } } }));
try { await fs.symlink(path.join(PROJECT_ROOT, 'ext'), path.join(appRoot, 'ext'), 'junction'); } catch { /* there */ }
const OTHER = ['Other One.md', 'Other Two.md', 'Other Three.md'];
for (const f of OTHER) await fs.writeFile(path.join(ws, f), `# ${f.replace('.md', '')}\n\nA page that is not Study.\n`);

const problems = [];
const check = (name, ok, got) => { console.log(`${ok ? '  ok ' : ' FAIL'} ${name}${ok ? '' : `: ${JSON.stringify(got)}`}`); if (!ok) problems.push(name); };

const manifest = JSON.parse(await fs.readFile(path.join(PROJECT_ROOT, 'ext', 'study', 'parallx-manifest.json'), 'utf8'));
const TOOL = manifest.id;
const SUBJECT = 'Seeded Subject';
const COLUMN = '.view[data-view-id="study.materials"]';

let app; let page; let errors = [];
const wait = (ms) => page.waitForTimeout(ms);

async function launch() {
  ({ app, page, errors } = await launchApp(appRoot));
  await page.waitForFunction(() => !!window.__parallx_workbench__?._services, null, { timeout: 60_000 });
}
async function ensureStudyOn() {
  const t = (await toolList(page)).find((x) => x.id === TOOL);
  if (t && !t.enabled) { await setToolEnabled(page, TOOL, true); await wait(4_000); }
  return (await toolList(page)).find((x) => x.id === TOOL)?.enabled === true;
}
const runCmd = (id, args = [], cap = 8_000) => page.evaluate(async ({ id, args, cap }) => {
  const svc = window.__parallx_workbench__?._services?.get?.({ id: 'ICommandService' });
  try { return await Promise.race([svc.executeCommand(id, ...args), new Promise((r) => setTimeout(() => r('(still running)'), cap))]); } catch (e) { return `failed: ${String(e?.message || e).slice(0, 160)}`; }
}, { id, args, cap });

/** The tabs in the strip (in order), the one in front, the subject header in front, the focus. */
const read = () => page.evaluate(({ TOOL }) => {
  const vis = (e) => !!e && e.getClientRects().length > 0;
  const tabs = [...document.querySelectorAll('.editor-group .ui-tab')].filter((t) => !t.classList.contains('ui-tab--leaving') && vis(t) && !t.closest('.editor-pane-container'))
    .map((t) => ({ id: t.dataset.tabId ?? '', label: (t.querySelector('.ui-tab-label')?.textContent ?? '').trim(), active: t.classList.contains('ui-tab--active') }));
  const act = tabs.find((t) => t.active) ?? null;
  const group = [...document.querySelectorAll('.editor-group')].find((g) => [...g.querySelectorAll('.ui-tab--active')].some(vis));
  const panes = group?.querySelector('.editor-pane-container');
  const title = [...(panes?.querySelectorAll('.px-page-header__title') ?? [])].find(vis);
  const head = title?.closest('.px-page-header');
  const sub = head?.querySelector('.px-page-header__subtitle');
  const ae = document.activeElement;
  return {
    tabs: tabs.map((t) => t.label), ids: tabs.map((t) => t.id), active: act?.label ?? null, activeId: act?.id ?? null,
    title: title ? title.textContent.trim() : null, subtitle: sub && vis(sub) ? sub.textContent.trim() : null,
    sheet: [...document.querySelectorAll('.st-sheet')].some(vis),
    focus: ae ? { tag: ae.tagName, id: ae.getAttribute('data-px-id') ?? '', cls: String(ae.className ?? '').slice(0, 80), body: ae === document.body, visible: vis(ae), inFront: !!panes?.contains(ae) } : null,
  };
}, { TOOL });
const short = (s) => ({ tabs: s.tabs, active: s.active, title: s.title, subtitle: s.subtitle, sheet: s.sheet, focus: s.focus });

async function showColumn() {
  const shown = await page.evaluate((C) => { const v = document.querySelector(C); return !!v && v.getClientRects().length > 0; }, COLUMN);
  if (shown) return;
  const at = await centre('.activity-bar-item[data-icon-id="study-container"]');
  if (at) { await page.mouse.click(at.x, at.y); await wait(1_200); }
}
const centre = (sel) => page.evaluate((sel) => { const e = [...document.querySelectorAll(sel)].find((x) => x.getClientRects().length); if (!e) return null; e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, sel);
async function pressColumn(label, { ctrl = false, ms = 2_200 } = {}) {
  await showColumn();
  const at = await page.evaluate(({ label, COLUMN }) => {
    const view = document.querySelector(COLUMN); if (!view) return null;
    const nameOf = (e) => ((e.querySelector('.px-btn__label')?.textContent) || e.getAttribute('aria-label') || e.textContent || '').replace(/\s+/g, ' ').trim();
    const e = [...view.querySelectorAll('button, a[href], [role="link"], [role="button"], [role="treeitem"], .st-sb__it')].find((x) => x.getClientRects().length && nameOf(x) === label);
    if (!e) return null; e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect(); return { x: r.x + Math.min(40, r.width / 2), y: r.y + r.height / 2 };
  }, { label, COLUMN });
  if (!at) return false;
  if (ctrl) await page.keyboard.down('Control');
  await page.mouse.click(at.x, at.y);
  if (ctrl) await page.keyboard.up('Control');
  await wait(ms);
  return true;
}
/** A visible control with this data-px-id in the editor in front, pressed by the mouse. */
async function pressId(id, ms = 1_800) {
  const at = await page.evaluate((id) => {
    const e = [...document.querySelectorAll(`.editor-pane-container [data-px-id="${id}"]`)].find((x) => x.getClientRects().length);
    if (!e) return null; e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, id);
  if (!at) return false;
  await page.mouse.click(at.x, at.y); await wait(ms);
  return true;
}
async function pressTab(tabId, ms = 1_400) {
  const at = await page.evaluate((id) => {
    const t = [...document.querySelectorAll('.editor-group .ui-tab')].find((x) => x.getClientRects().length && !x.closest('.editor-pane-container') && x.dataset.tabId === id);
    if (!t) return null; const l = (t.querySelector('.ui-tab-label') ?? t).getBoundingClientRect(); return { x: l.x + Math.min(20, l.width / 2), y: l.y + l.height / 2 };
  }, tabId);
  if (!at) return false;
  await page.mouse.click(at.x, at.y); await wait(ms);
  return true;
}
/** The More Actions menu of the header in front: opened by the mouse, its items read, closed. */
async function headerMenu({ keepOpen = false } = {}) {
  const ok = await page.evaluate(() => !![...document.querySelectorAll('.editor-pane-container .px-page-header [data-px-id="pageHeader.more"]')].find((x) => x.getClientRects().length));
  if (!ok) return null;
  await pressId('pageHeader.more', 700);
  const items = await page.evaluate(() => [...document.querySelectorAll('.context-menu')].filter((m) => m.getClientRects().length).flatMap((m) => [...m.querySelectorAll('.context-menu-item')].map((r) => (r.querySelector('.context-menu-item-label')?.textContent ?? r.textContent ?? '').trim())));
  if (!keepOpen) { await page.keyboard.press('Escape'); await wait(400); }
  return items;
}
async function pickMenu(text) {
  const at = await page.evaluate((text) => {
    const r = [...document.querySelectorAll('.context-menu .context-menu-item')].filter((x) => x.getClientRects().length).find((x) => (x.textContent ?? '').trim().includes(text));
    if (!r) return null; const b = r.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }, text);
  if (!at) { await page.keyboard.press('Escape'); await wait(300); return false; }
  await page.mouse.click(at.x, at.y); await wait(1_800);
  return true;
}
async function closeAllEditors() {
  for (let i = 0; i < 40 && (await read()).tabs.length > 0; i++) { await runCmd('workbench.action.closeActiveEditor'); await wait(250); }
  await page.keyboard.press('Escape').catch(() => {});
  await wait(500);
}
/** Tab presses until the focus is on the control with this id (at most `max`). */
async function tabTo(id, max = 25) {
  for (let i = 0; i < max; i++) {
    const f = (await read()).focus;
    if (f && f.id === id) return true;
    await page.keyboard.press('Tab'); await wait(120);
  }
  return ((await read()).focus?.id ?? '') === id;
}
/** Waits up to `ms` for the header in front to show a subtitle matching `re`. */
async function waitSubtitle(re, ms = 15_000) {
  const t0 = Date.now();
  let s = await read();
  while (Date.now() - t0 < ms) { if (s.subtitle && re.test(s.subtitle)) return s; await wait(500); s = await read(); }
  return s;
}
const addQuestion = (dbId, title, result) => page.evaluate(async ({ dbId, title, result }) => {
  const t = window.__parallx_workbench__._services.get({ id: 'ILanguageModelToolsService' }).getTool('canvas_add_database_row');
  const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };
  return String((await t.handler({ databaseId: dbId, title, values: { 'Model Answer': 'An answer.', Paper: 'Mack', 'Times Attempted': 1, 'Times Correct': result === 'Right' ? 1 : 0, 'Last Result': result } }, token))?.content ?? '');
}, { dbId, title, result });

const iso = (k) => { const d = new Date(); d.setDate(d.getDate() + k); const p = (v) => String(v).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const week = (a, b, c, d) => ({ Mon: a, Tue: a, Wed: a, Thu: a, Fri: b, Sat: c, Sun: d });

let questionsDb = '';
try {
  // ── Seed: a subject over a questions database (7 of 10 answered), no plan ──
  await launch();
  const on = await ensureStudyOn();
  questionsDb = await page.evaluate(async ({ SUBJECT }) => {
    const services = window.__parallx_workbench__._services;
    const tools = services.get({ id: 'ILanguageModelToolsService' });
    const cmds = services.get({ id: 'ICommandService' });
    const make = tools.getTool('canvas_create_database'); const add = tools.getTool('canvas_add_database_row');
    const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };
    const made = String((await make.handler({ title: 'Seeded Questions', properties: [
      { name: 'Model Answer', type: 'text' }, { name: 'Paper', type: 'select', options: ['Mack', 'Clark', 'Venter'] },
      { name: 'Times Attempted', type: 'number' }, { name: 'Times Correct', type: 'number' }, { name: 'Last Result', type: 'select', options: ['Right', 'Partly', 'Wrong'] },
    ] }, token))?.content || '');
    const id = (/id: ([0-9a-f-]{20,})/i.exec(made) || [])[1];
    if (!id) return '';
    const states = { Mack: ['Right', 'Right', 'Partly', 'Wrong', ''], Clark: ['Wrong', '', ''], Venter: ['Right', 'Right'] };
    let n = 0;
    for (const [paper, list] of Object.entries(states)) for (const result of list) {
      n += 1;
      await add.handler({ databaseId: id, title: `Seeded question ${n} on ${paper}?`, values: { 'Model Answer': `The answer to question ${n}.`, Paper: paper, ...(result ? { 'Times Attempted': 1, 'Times Correct': result === 'Right' ? 1 : 0, 'Last Result': result } : {}) } }, token);
    }
    await cmds.executeCommand('study.newSubject', { name: SUBJECT, questions: id });
    await new Promise((r) => setTimeout(r, 2500));
    return id;
  }, { SUBJECT });
  await wait(2_000);
  await closeAllEditors();
  console.log(`[seed] Study on: ${on}; questions database: ${questionsDb || 'none'}`);

  // ── Fix 1: the subject's page header follows the subject ──
  await pressColumn(SUBJECT, { ms: 3_000 });
  let s = await waitSubtitle(/questions answered/, 8_000);
  check('H0 the subject\'s page from Study\'s column: title "Seeded Subject", subtitle "7 of 10 questions answered"', s.title === SUBJECT && s.subtitle === '7 of 10 questions answered', short(s));
  const placeTab = s.activeId;
  let m = await headerMenu();
  check('H1 its More Actions, no plan yet: no Open Plan, has New Plan… and Hide Units', !!m && !m.includes('Open Plan') && m.includes('New Plan…') && m.includes('Hide Units') && !m.includes('Show Units'), m);

  await headerMenu({ keepOpen: true });
  const hid = await pickMenu('Hide Units');
  m = await headerMenu();
  check('H2 Hide Units picked in More Actions, the menu opened again: Show Units (not Hide Units)', hid && !!m && m.includes('Show Units') && !m.includes('Hide Units'), { hid, m });
  await headerMenu({ keepOpen: true });
  const shown = await pickMenu('Show Units');
  m = await headerMenu();
  check('H3 Show Units picked (twice in a row): Hide Units again', shown && !!m && m.includes('Hide Units') && !m.includes('Show Units'), { shown, m });

  // Cleanup, so the rest does not hang on H2/H3: when the units are still hidden, a fresh draw of the page (Home, then the subject) and its Show Units.
  await runCmd('study.openHome'); await wait(1_500); await pressColumn(SUBJECT, { ms: 2_500 });
  if ((await headerMenu() ?? []).includes('Show Units')) {
    await headerMenu({ keepOpen: true }); await pickMenu('Show Units');
    console.log(`[cleanup] the units were left hidden; shown again: ${JSON.stringify(await headerMenu())}`);
  }
  // The keys on the title while the header is drawn again (a question answered elsewhere: the count changes).
  await page.evaluate(() => { const t = [...document.querySelectorAll('.editor-pane-container .px-page-header__title')].find((x) => x.getClientRects().length); if (t) { t.tabIndex = -1; t.focus(); } });
  const before = await read();
  const added = await addQuestion(questionsDb, 'A question answered elsewhere on Mack?', 'Right');
  s = await waitSubtitle(/^8 of 11 questions answered/, 20_000);
  check('H4 a question added and answered in the database while the page shows: subtitle becomes "8 of 11 questions answered"', s.subtitle === '8 of 11 questions answered', { added: added.slice(0, 80), ...short(s) });
  check('H5 the keys were on the title before and stay on the (redrawn) title after', before.focus?.cls.includes('px-page-header__title') && s.focus?.tag === 'H1' && s.focus.cls.includes('px-page-header__title') && s.focus.inFront, { before: before.focus, after: s.focus });
  await page.evaluate(() => document.documentElement.removeAttribute('data-px-mode')); await wait(400);
  await screenshot(app, page, path.join(shots, 'subject-dark.png'));
  await page.evaluate(() => document.documentElement.setAttribute('data-px-mode', 'light')); await wait(600);
  await screenshot(app, page, path.join(shots, 'subject-light.png'));
  await page.evaluate(() => document.documentElement.removeAttribute('data-px-mode')); await wait(400);

  // A plan made while the page is drawn: a second Study tab on the subject keeps showing it; the plan opens in the one in front.
  await pressColumn(SUBJECT, { ctrl: true, ms: 2_500 });
  const two = await read();
  const subjectTabs = two.ids.filter((id) => id.startsWith(`${TOOL}:`));
  const made = await runCmd('study.newPlan', [{ subject: SUBJECT, name: 'Probe Plan', start: iso(-10), exam: iso(32), goal: 120, personal: week(2, 2, 4, 3), work: week(1, 2, 0, 0) }], 10_000);
  await wait(2_500);
  const afterPlan = await read();
  const results = [];
  for (const id of afterPlan.ids.filter((x) => x.startsWith(`${TOOL}:`))) {
    await pressTab(id, 1_200);
    const r = await read();
    if (r.title === SUBJECT) results.push({ id, menu: await headerMenu() });
  }
  check('H6 a plan made (study.newPlan with its form\'s answers) while a second tab shows the subject: that tab\'s More Actions has Open Plan', results.length > 0 && results.every((r) => r.menu && r.menu.includes('Open Plan')), { made, subjectTabs, tabsAfter: afterPlan.tabs, results });
  await closeAllEditors();

  // ── Fix 2: Study… from the subject's page and a unit's page, Study's tab in the middle ──
  await pressColumn(SUBJECT, { ms: 2_500 });
  const studyTab = (await read()).activeId;
  for (const f of OTHER) { await runCmd('file.openFile', [path.join(ws, f)]); await wait(900); }
  await pressTab(studyTab, 1_500);
  s = await read();
  const idx = s.ids.indexOf(studyTab);
  check('S0 Study\'s tab in front, in the middle of the strip (not last)', s.activeId === studyTab && idx >= 0 && idx < s.ids.length - 1 && s.title === SUBJECT, { idx, ...short(s) });

  for (const [round, opener] of [['subject 1st', 'study.subject.study'], ['subject 2nd', 'study.subject.study']]) {
    // Each round starts on Study's tab (so a round that left another tab in front does not hide the next).
    if ((await read()).activeId !== studyTab) await pressTab(studyTab, 1_500);
    const reached = await tabTo(opener);
    await page.keyboard.press('Enter'); await wait(2_200);
    const open = await read();
    await page.keyboard.press('Escape'); await wait(2_200);
    const back = await read();
    check(`E ${round}: Tab to Study…, Enter: the sheet in a tab of its own; Escape: Study's tab in front, keys on Study…`,
      reached && open.sheet && open.activeId !== studyTab && !back.sheet && back.activeId === studyTab && back.focus?.id === opener && back.focus.visible && !back.focus.body,
      { reached, open: short(open), back: short(back) });
  }
  if ((await read()).activeId !== studyTab) await pressTab(studyTab, 1_500);
  if (await pressId('study.subject.study', 2_200)) {
    const open = await read();
    await screenshot(app, page, path.join(shots, 'sheet-from-subject.png'), { keepFocus: true });
    const cancelled = await pressId('study.setup.cancel', 2_200);
    const back = await read();
    check('C1 Study… by mouse, Cancel by mouse: Study\'s tab in front, keys on Study…', open.sheet && cancelled && back.activeId === studyTab && back.focus?.id === 'study.subject.study', { cancelled, open: short(open), back: short(back) });
  } else check('C1 Study… by mouse', false, 'no Study… button');
  if ((await read()).activeId !== studyTab) await pressTab(studyTab, 1_500);
  if (await pressId('study.subject.study', 2_200)) {
    const xed = await pressId('study.sheet.close', 2_200);
    const back = await read();
    check('C2 Study… by mouse, the sheet\'s X by mouse: Study\'s tab in front, keys on Study…', xed && back.activeId === studyTab && back.focus?.id === 'study.subject.study', { xed, back: short(back) });
  }

  // From a unit's page: the same Study tab, still in the middle.
  if ((await read()).activeId !== studyTab) await pressTab(studyTab, 1_500);
  await pressColumn('Mack', { ms: 2_500 });
  s = await read();
  check('U0 Mack from the column: in the same Study tab, still not last', s.activeId === studyTab && s.ids.indexOf(studyTab) < s.ids.length - 1 && /Mack/.test(s.title ?? ''), short(s));
  {
    const reached = await tabTo('study.unit.study');
    await page.keyboard.press('Enter'); await wait(2_200);
    const open = await read();
    await page.keyboard.press('Escape'); await wait(2_200);
    const back = await read();
    check('U1 the unit\'s Study… by Tab and Enter, Escape: Study\'s tab in front, keys on the unit\'s Study…', reached && open.sheet && open.activeId !== studyTab && back.activeId === studyTab && back.focus?.id === 'study.unit.study' && back.focus.visible, { reached, open: short(open), back: short(back) });
  }
  if ((await read()).activeId !== studyTab) await pressTab(studyTab, 1_500);
  if (await pressId('study.unit.study', 2_200)) {
    const cancelled = await pressId('study.setup.cancel', 2_200);
    const back = await read();
    check('U2 the unit\'s Study… by mouse, Cancel by mouse: Study\'s tab in front, keys on the unit\'s Study…', cancelled && back.activeId === studyTab && back.focus?.id === 'study.unit.study', { cancelled, back: short(back) });
  }

  // After the tab was switched away and back: still.
  await pressTab(s.ids[s.ids.length - 1], 1_200);
  await pressTab(studyTab, 1_500);
  {
    const reached = await tabTo('study.unit.study');
    await page.keyboard.press('Enter'); await wait(2_200);
    await page.keyboard.press('Escape'); await wait(2_200);
    const back = await read();
    check('U3 after switching to another tab and back: Enter, Escape still lands on Study\'s tab and the unit\'s Study…', reached && back.activeId === studyTab && back.focus?.id === 'study.unit.study', { reached, back: short(back) });
  }

  // Start: the session's own tab stays in front.
  await pressColumn(SUBJECT, { ms: 2_500 });
  const beforeStart = await read();
  if (await pressId('study.subject.study', 2_200)) {
    const open = await read();
    const started = await pressId('study.setup.start', 4_500);
    await wait(1_500);
    const after = await read();
    check('T1 Study… then Start (the subject\'s questions, no model): a session tab in front, not Study\'s place tab; the sheet gone',
      started && open.sheet && !after.sheet && after.activeId !== studyTab && after.activeId?.startsWith(`${TOOL}:`) && !beforeStart.ids.includes(after.activeId) && after.ids.includes(studyTab),
      { started, open: short(open), after: { ...short(after), activeId: after.activeId } });
    await screenshot(app, page, path.join(shots, 'session-after-start.png'));
  } else check('T1 Study… on the subject page', false, 'no Study… button');

  // ── Restart with the subject's page in front ──
  await closeAllEditors();
  await pressColumn(SUBJECT, { ms: 2_500 });
  await wait(1_500);
  await app.close(); app = null;
  await launch();
  // The app may put its own Home in front at start; the subject's tab came back beside it: pressed.
  { const r0 = await read(); const back = r0.ids[r0.tabs.indexOf(SUBJECT)]; console.log(`[restart] tabs ${JSON.stringify(r0.tabs)}, in front ${r0.active}`); if (back && r0.activeId !== back) await pressTab(back, 300); }
  s = await waitSubtitle(/questions answered/, 20_000);
  check('R1 the app closed with the subject\'s page in front and opened: its tab back (pressed if not in front), subtitle "8 of 11 questions answered" (with its exam)', s.title === SUBJECT && /^8 of 11 questions answered/.test(s.subtitle ?? ''), short(s));
  m = await headerMenu();
  check('R2 after the restart its More Actions has Open Plan and Hide Units', !!m && m.includes('Open Plan') && m.includes('Hide Units'), m);
  await closeAllEditors();
  await app.close(); app = null;

  // ── The subject's page reached right after start ──
  await launch();
  await pressColumn(SUBJECT, { ms: 300 });
  s = await waitSubtitle(/questions answered/, 20_000);
  check('R3 opened and at once the subject pressed in the column: subtitle "8 of 11 questions answered"', s.title === SUBJECT && /^8 of 11 questions answered/.test(s.subtitle ?? ''), short(s));
  const pageErrors = errors.filter((e) => /study/i.test(e));
  check('P0 no page error naming Study', pageErrors.length === 0, pageErrors.slice(0, 3));
} catch (e) {
  check('the probe ran to the end', false, String(e?.stack ?? e).slice(0, 600));
} finally {
  await app?.close().catch(() => {});
}
console.log(`\n${problems.length ? `FAIL ${problems.length}` : 'PASS'} (screenshots in ${shots})`);
process.exit(problems.length ? 1 : 0);
