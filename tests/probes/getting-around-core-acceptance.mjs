// getting-around-core-acceptance.mjs — @acceptance for "Getting around",
// piece 1, the core point (docs/MASTER_LIST.md, "Getting around: one way to
// move in every tool", "The order of work" item 1), proved on Planner.
//
// Written from the request before the build, by a verifier who is not the
// builder. The builder does not edit this file. Every check below failed on
// the app as it was when it was written (dev at dd31bae2).
//
// What it holds the piece to:
//   A. One tab for the tool, named for the place (Today, Calendar, Tasks), with an icon.
//   B. The trail in the bar under the tabs (the editor ribbon's breadcrumbs,
//      `.parallx-breadcrumb-item`): "Planner" first with an icon, the place last;
//      a crumb pressed (mouse, or keys and Enter) moves in the same tab.
//   C. After a move, document.activeElement is the new page's kit title
//      (h1.px-page-header__title, tabindex="-1") inside the active editor.
//   D. Exactly one row of Planner's column has aria-current="page": the current place's.
//   E. Open in Its Own Tab on the tab's menu and on a column row's menu; Ctrl+click on a row.
//   F. parallx://place/planner/tasks, clicked as a link in a page, lands on the Planner tab named Tasks.
//   G. Canvas's trail goes to a parent page in the same tab.
//   H. parallx.places.register is declared in parallx.d.ts and documented.
// Plus: the same row twice, after another tab and back, after the app is closed and opened.
// Not in this piece: Back and Forward.
//
//   node scripts/build.mjs && xvfb-run -a node tests/probes/getting-around-core-acceptance.mjs [outDir]
import fs from 'node:fs/promises';
import path from 'node:path';
import { PROJECT_ROOT, launchApp, cmd, screenshot, messages } from './scene.mjs';

const root = process.argv[2] ? path.resolve(process.argv[2]) : path.join(PROJECT_ROOT, 'tests', '.tmp-getting-around-core');
await fs.rm(root, { recursive: true, force: true });
const appRoot = path.join(root, 'app'); const ws = path.join(root, 'workspace'); const shots = path.join(root, 'shots');
for (const d of [path.join(appRoot, 'data'), path.join(ws, '.parallx'), shots]) await fs.mkdir(d, { recursive: true });
await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: ws }));
await fs.writeFile(path.join(ws, 'notes.txt'), 'A file the control link opens.\n');
await fs.writeFile(path.join(ws, '.parallx/ai-config.json'), JSON.stringify({ overrides: { indexing: { autoIndex: false, watchFiles: false }, suggestions: { suggestionsEnabled: false }, heartbeat: { enabled: false } } }));
try { await fs.symlink(path.join(PROJECT_ROOT, 'ext'), path.join(appRoot, 'ext'), 'junction'); } catch { /* there */ }

let passed = 0; const failed = [];
const check = (name, ok, got) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `: ${JSON.stringify(got)}`}`);
  if (ok) passed += 1; else failed.push(name);
};
const NAME = { today: 'Today', calendar: 'Calendar', tasks: 'Tasks' };

let app; let page; let errors = [];
const wait = (ms) => page.waitForTimeout(ms);

/** What a person sees: the tabs, the trail under them, Planner's column, the focus. */
const read = () => page.evaluate(() => {
  const vis = (e) => !!e && e.getClientRects().length > 0;
  const tabs = [...document.querySelectorAll('.editor-group .ui-tab')].filter((t) => !t.classList.contains('ui-tab--leaving') && vis(t)).map((t) => {
    const icon = t.querySelector('.ui-tab-icon');
    return {
      id: t.dataset.tabId, label: (t.querySelector('.ui-tab-label')?.textContent ?? '').trim(), active: t.classList.contains('ui-tab--active'),
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
      icon: !!c.querySelector('svg, img'),
    }))
    : [];
  const panes = group?.querySelector('.editor-pane-container');
  const planner = [...(panes?.querySelectorAll('.planner-pane') ?? [])].find(vis);
  const canvas = [...(panes?.querySelectorAll('[data-px-surface="canvas"]') ?? [])].find(vis);
  const ae = document.activeElement;
  const rows = [...document.querySelectorAll('.planner-sidebar .planner-sidebar__row[data-key]')];
  return {
    count: tabs.length, labels: tabs.map((t) => t.label), active: act?.label ?? null, activeIcon: act?.icon ?? false,
    crumbs, place: planner?.dataset.tab ?? null,
    canvasPage: canvas ? (canvas.getAttribute('data-px-instance') || '').split(':').pop() : null,
    current: rows.filter((r) => r.getAttribute('aria-current') === 'page').map((r) => r.dataset.key),
    focus: ae ? { tag: ae.tagName, cls: ae.className, tabindex: ae.getAttribute('tabindex'), text: (ae.textContent ?? '').trim().slice(0, 40), inEditor: !!panes?.contains(ae) } : null,
  };
});
const titleFocused = (s) => !!s.focus && s.focus.tag === 'H1' && /\bpx-page-header__title\b/.test(s.focus.cls) && s.focus.tabindex === '-1' && s.focus.inEditor;

const centre = (sel) => page.evaluate((sel) => { const e = [...document.querySelectorAll(sel)].find((x) => x.getClientRects().length); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, sel);
const rowSel = (key) => `.planner-sidebar .planner-sidebar__row[data-key="${key}"]`;
async function press(sel, opts = {}) {
  const at = await centre(sel);
  if (!at) throw new Error(`nothing on screen at ${sel}`);
  if (opts.ctrl) await page.keyboard.down('Control');
  await page.mouse.click(at.x, at.y, { button: opts.right ? 'right' : 'left' });
  if (opts.ctrl) await page.keyboard.up('Control');
  await wait(opts.wait ?? 1_300);
}
const pressRow = (key, opts) => press(rowSel(key), opts);
/** The tab with this label (the last, if several; the active tab when label is null), by the mouse. False when there is none. */
async function pressTab(label, opts = {}) {
  const at = await page.evaluate((label) => {
    const t = [...document.querySelectorAll('.editor-group .ui-tab')].filter((x) => x.getClientRects().length && !x.classList.contains('ui-tab--leaving') && (label === null ? x.classList.contains('ui-tab--active') : (x.querySelector('.ui-tab-label')?.textContent ?? '').trim() === label)).pop();
    if (!t) return null; const r = t.getBoundingClientRect(); return { x: r.x + Math.min(40, r.width / 2), y: r.y + r.height / 2 };
  }, label);
  if (!at) return false;
  await page.mouse.click(at.x, at.y, { button: opts.right ? 'right' : 'left' });
  await wait(opts.wait ?? 1_000);
  return true;
}
/** The open context menu's rows, as shown. */
const menuItems = () => page.evaluate(() => [...document.querySelectorAll('.context-menu')].filter((m) => m.getClientRects().length).flatMap((m) => [...m.querySelectorAll('.context-menu-item')].map((r) => (r.querySelector('.context-menu-item-label')?.textContent ?? r.textContent ?? '').trim())));
async function pickMenuItem(text) {
  const at = await page.evaluate((text) => {
    const r = [...document.querySelectorAll('.context-menu .context-menu-item')].filter((x) => x.getClientRects().length).find((x) => (x.textContent ?? '').includes(text));
    if (!r) return null; const b = r.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }, text);
  if (!at) { await page.keyboard.press('Escape'); await wait(300); return false; }
  await page.mouse.click(at.x, at.y); await wait(1_500);
  return true;
}
async function closeAllEditors() {
  for (let i = 0; i < 30 && (await read()).count > 0; i++) { await cmd(page, 'workbench.action.closeActiveEditor'); await wait(250); }
  await wait(500);
}
async function showPlannerColumn() {
  if (await centre(rowSel('today'))) return;
  await press('.activity-bar-item[data-icon-id="planner-container"]', { wait: 1_000 });
}
/**
 * A crumb of the trail, by its label, pressed with the keys: the crumb (or the
 * trail, when the crumbs are reached by arrows inside it, as the existing bar
 * does: ArrowRight from the bar onto its first crumb, Left and Right between
 * them) focused, then Enter.
 */
async function crumbByKeys(label) {
  const focusedCrumb = () => page.evaluate(() => {
    const c = document.activeElement?.closest?.('.parallx-breadcrumb-item');
    return c ? ((c.querySelector('.breadcrumb-label, [class*="label"]') ?? c).textContent ?? '').trim() : null;
  });
  const how = await page.evaluate((label) => {
    const ribbon = [...document.querySelectorAll('.editor-group .editor-ribbon')].find((r) => r.getClientRects().length);
    const crumbs = [...(ribbon?.querySelectorAll('.parallx-breadcrumb-item') ?? [])].filter((c) => c.getClientRects().length);
    const c = crumbs.find((x) => ((x.querySelector('.breadcrumb-label, [class*="label"]') ?? x).textContent ?? '').trim() === label);
    if (!c) return null;
    const own = c.matches('button, a[href], [tabindex]:not([tabindex="-1"])') ? c : c.querySelector('button, a[href], [tabindex]:not([tabindex="-1"])');
    if (own) { own.focus(); return 'own'; }
    const w = c.closest('.parallx-breadcrumbs');
    if (!w || w.tabIndex < 0) return null;
    w.focus(); return 'arrows';
  }, label);
  if (!how) return false;
  if (how === 'arrows') {
    for (let k = 0; k < 12; k++) {
      const at = await focusedCrumb();
      if (at === label) break;
      await page.keyboard.press(at === null ? 'ArrowRight' : 'ArrowLeft');
    }
    if ((await focusedCrumb()) !== label) return false;
  }
  await page.keyboard.press('Enter'); await wait(1_300);
  return true;
}
async function pressCrumb(label) {
  return page.evaluate((label) => {
    const ribbon = [...document.querySelectorAll('.editor-group .editor-ribbon')].find((r) => r.getClientRects().length);
    const c = [...(ribbon?.querySelectorAll('.parallx-breadcrumb-item') ?? [])].filter((x) => x.getClientRects().length).find((x) => ((x.querySelector('.breadcrumb-label, [class*="label"]') ?? x).textContent ?? '').trim() === label);
    if (!c) return null; const r = c.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, label).then(async (at) => { if (!at) return false; await page.mouse.click(at.x, at.y); await wait(1_300); return true; });
}
const runTool = (name, args) => page.evaluate(async ({ name, args }) => {
  const tools = window.__parallx_workbench__._services.get({ id: 'ILanguageModelToolsService' });
  const t = tools.getTool(name); if (!t) return `no tool ${name}`;
  const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };
  const out = String((await t.handler(args, token))?.content ?? '');
  return (/id: ([0-9a-f-]{20,})/i.exec(out) || [])[1] ?? `no id: ${out.slice(0, 160)}`;
}, { name, args });

async function launch() {
  ({ app, page, errors } = await launchApp(appRoot));
  await page.waitForFunction(() => !!window.__parallx_workbench__?._services, null, { timeout: 60_000 });
  await wait(1_500);
}

// H, a static check of the contract offered to extensions.
const dts = await fs.readFile(path.join(PROJECT_ROOT, 'src/api/parallx.d.ts'), 'utf8');
const ns = /export\s+namespace\s+places\s*\{([\s\S]*?)\n\s{0,4}\}/.exec(dts);
check('H1 parallx.d.ts declares `export namespace places` with a `register` function', !!ns && /\bfunction\s+register\s*\(/.test(ns[1]), ns ? ns[1].slice(0, 200) : 'no namespace places');
const guide = await fs.readFile(path.join(PROJECT_ROOT, 'docs/PARALLX_EXTENSION_AUTHORING_FOR_AI.md'), 'utf8');
check('H2 the extension authoring guide documents parallx.places.register', /parallx\.places\.register/.test(guide), 'not mentioned');

try {
  await launch();

  // Seeds (not checks): a parent page, a child page under it, a page with a place link.
  const parentId = await runTool('canvas_create_page', { title: 'Probe Parent', markdown: 'The parent page.' });
  const childId = await runTool('canvas_create_page', { title: 'Probe Child', parentId, markdown: 'The child page.' });
  const linkId = await runTool('canvas_create_page', { title: 'Probe Links', markdown: 'Go to [the task list](parallx://place/planner/tasks) from here. Or [the notes](parallx://explorer/file?path=notes.txt).' });
  console.log(`[seed] parent ${parentId} child ${childId} links ${linkId}`);

  await closeAllEditors();
  await showPlannerColumn();

  // ── A. One tab, named for the place ──
  await pressRow('calendar');
  let s = await read();
  check('A1 Calendar pressed in the column: one tab, named "Calendar", with an icon, showing the calendar', s.count === 1 && s.active === 'Calendar' && s.activeIcon && s.place === 'calendar', s);
  await pressRow('calendar');
  s = await read();
  check('A2 Calendar pressed again: still one tab, still "Calendar"', s.count === 1 && s.active === 'Calendar', s);
  await pressRow('tasks');
  s = await read();
  check('A3 Tasks pressed: the same one tab is renamed "Tasks" (no new tab), icon kept', s.count === 1 && s.active === 'Tasks' && s.activeIcon && s.place === 'tasks', s);
  await pressRow('today');
  s = await read();
  check('A4 Today pressed: the one tab is renamed "Today"', s.count === 1 && s.active === 'Today' && s.place === 'today', s);
  await screenshot(app, page, path.join(shots, 'a-today-tab.png'));

  // ── B. The trail in the bar under the tabs ──
  await pressRow('tasks');
  s = await read();
  check('B1 on Tasks the trail shows under the tab: "Planner" first with an icon, "Tasks" last', s.crumbs.length >= 2 && s.crumbs[0].label === 'Planner' && s.crumbs[0].icon && s.crumbs[s.crumbs.length - 1].label === 'Tasks', s.crumbs);
  await screenshot(app, page, path.join(shots, 'b-trail-tasks.png'));
  await pressRow('calendar');
  s = await read();
  check('B2 on Calendar the trail ends in "Calendar"', s.crumbs.length >= 2 && s.crumbs[0].label === 'Planner' && s.crumbs[s.crumbs.length - 1].label === 'Calendar', s.crumbs);
  await pressRow('tasks');
  const beforeCrumb = (await read()).count;
  const pressedCrumb = await pressCrumb('Planner');
  s = await read();
  check('B3 on Tasks, the "Planner" crumb pressed by mouse goes to Today in the same tab (tab renamed, count same)', pressedCrumb && s.count === beforeCrumb && s.active === 'Today' && s.place === 'today', { pressedCrumb, beforeCrumb, ...s });
  await pressRow('calendar');
  const byKeys = await crumbByKeys('Planner');
  s = await read();
  check('B4 on Calendar, the "Planner" crumb reached by keys and Enter goes to Today in the same tab', byKeys && s.count === 1 && s.active === 'Today' && s.place === 'today', { byKeys, ...s });

  // ── C. The keys land on the new page's title ──
  await pressRow('tasks', { wait: 1_600 });
  s = await read();
  check('C1 after Tasks pressed by mouse, focus is the new page\'s kit title h1 (tabindex -1) in the editor', titleFocused(s), s.focus);
  await pressRow('today', { wait: 300 });
  await page.evaluate((sel) => document.querySelector(sel)?.focus(), rowSel('tasks'));
  await page.keyboard.press('Enter'); await wait(1_600);
  s = await read();
  check('C2 after Tasks chosen by Enter on its row, focus is the new page\'s kit title h1 (tabindex -1) in the editor', s.place === 'tasks' && titleFocused(s), { place: s.place, focus: s.focus });
  await pressRow('today', { wait: 1_600 });
  s = await read();
  check('C3 after Today pressed by mouse, focus is Today\'s kit title h1 (tabindex -1) in the editor', s.place === 'today' && titleFocused(s), { place: s.place, focus: s.focus });

  // ── D. One mark for where you are ──
  await pressRow('calendar');
  s = await read();
  check('D1 on Calendar exactly one column row has aria-current="page", and it is Calendar', s.current.length === 1 && s.current[0] === 'calendar', s.current);
  await pressRow('tasks');
  s = await read();
  check('D2 the mark moves with the place: on Tasks only Tasks has aria-current="page"', s.current.length === 1 && s.current[0] === 'tasks', s.current);
  await pressCrumb('Planner');
  s = await read();
  check('D3 a move by the trail moves the mark too: only Today has aria-current="page"', s.place === 'today' && s.current.length === 1 && s.current[0] === 'today', { place: s.place, current: s.current });

  // ── After another tab and back; F, the address ──
  await pressRow('calendar');
  await cmd(page, 'canvas.openPage', linkId); await wait(1_500);
  const away = await read();
  await pressTab(away.labels.find((l) => /Calendar|Planner/.test(l)) ?? 'Calendar');
  s = await read();
  check('X1 after another tab and back, the Planner tab is still "Calendar" and the trail still ends in "Calendar"', s.active === 'Calendar' && s.place === 'calendar' && s.crumbs.length >= 2 && s.crumbs[s.crumbs.length - 1].label === 'Calendar', { away: away.labels, ...s });
  // Control (not counted): a parallx:// link that exists today, clicked the same way, opens its target,
  // so F1 below tests the place address and not the click route.
  await pressTab('Probe Links');
  const ctl = await centre('[data-px-surface="canvas"] a[href^="parallx://explorer/file"]');
  if (ctl) { await page.mouse.click(ctl.x, ctl.y); await wait(1_500); }
  const ctlRead = await read();
  console.log(`[control] a parallx://explorer/file link clicked in the page opens the file: ${ctlRead.active === 'notes.txt' ? 'yes' : 'NO ' + JSON.stringify(ctlRead.labels)}`);
  if (ctlRead.active === 'notes.txt') { await cmd(page, 'workbench.action.closeActiveEditor'); await wait(600); }
  await pressTab('Probe Links');
  await messages(page);
  const beforeLink = (await read()).count;
  const link = await centre('[data-px-surface="canvas"] a[href="parallx://place/planner/tasks"]');
  if (link) { await page.mouse.click(link.x, link.y); await wait(1_800); }
  s = await read();
  s.said = await messages(page);
  check('F1 parallx://place/planner/tasks, clicked as a link in a page, lands on the Planner tab named "Tasks" (no second Planner tab)', !!link && s.active === 'Tasks' && s.place === 'tasks' && s.count === beforeLink, { link: !!link, beforeLink, ...s });
  await screenshot(app, page, path.join(shots, 'f-after-link.png'));

  // ── G. Canvas's trail goes to the parent in the same tab ──
  await cmd(page, 'canvas.openPage', childId); await wait(1_800);
  const g0 = await read();
  const parentCrumb = await page.evaluate(() => {
    // Canvas draws its trail in its own strip at the top of the group, not in .editor-ribbon: look in the whole active group.
    const group = document.querySelector('.editor-group .ui-tab--active')?.closest('.editor-group');
    const c = [...(group?.querySelectorAll('.canvas-breadcrumb, .parallx-breadcrumb-item') ?? [])].filter((x) => x.getClientRects().length).find((x) => ((x.querySelector('.canvas-breadcrumb-label, .breadcrumb-label') ?? x).textContent ?? '').trim() === 'Probe Parent');
    if (!c) return null; const r = c.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (parentCrumb) { await page.mouse.click(parentCrumb.x, parentCrumb.y); await wait(1_800); }
  s = await read();
  check('G1 on a child page, its parent\'s crumb pressed shows the parent in the same tab (count same)', g0.canvasPage === childId && !!parentCrumb && s.count === g0.count && s.canvasPage === parentId && s.active === 'Probe Parent', { before: { count: g0.count, page: g0.canvasPage, active: g0.active }, crumb: !!parentCrumb, after: { count: s.count, page: s.canvasPage, active: s.active, labels: s.labels } });
  await screenshot(app, page, path.join(shots, 'g-parent.png'));

  // ── E. Open in Its Own Tab, and Ctrl+click ──
  await closeAllEditors();
  await showPlannerColumn();
  await pressRow('calendar');
  await pressTab(null, { right: true, wait: 600 });
  const tabMenu = await menuItems();
  await screenshot(app, page, path.join(shots, 'e-tab-menu.png'), { keepFocus: true });
  const pickedTab = await pickMenuItem('Open in Its Own Tab');
  s = await read();
  check('E1 the Planner tab\'s menu has "Open in Its Own Tab", and it opens a second tab on the same place: two tabs, both "Calendar"', tabMenu.includes('Open in Its Own Tab') && pickedTab && s.count === 2 && s.labels.filter((l) => l === 'Calendar').length === 2, { tabMenu, ...s });
  if (!(await pressTab('Calendar'))) await pressTab(null);
  const e2 = (await read()).count;
  await pressRow('tasks', { ctrl: true });
  s = await read();
  check('E2 Ctrl+click on Tasks in the column opens Tasks in a tab of its own: one more tab, named "Tasks", the Calendar tabs still "Calendar"', s.count === e2 + 1 && s.labels.filter((l) => l === 'Tasks').length === 1 && s.labels.filter((l) => l === 'Calendar').length === 2 && s.active === 'Tasks' && s.place === 'tasks', { before: e2, ...s });
  const e3 = s.count;
  await pressRow('today', { right: true, wait: 600 });
  const rowMenu = await menuItems();
  const pickedRow = await pickMenuItem('Open in Its Own Tab');
  s = await read();
  check('E3 a place row\'s menu in the column has "Open in Its Own Tab", and it opens Today in one more tab', rowMenu.includes('Open in Its Own Tab') && pickedRow && s.count === e3 + 1 && s.labels.includes('Today') && s.active === 'Today', { rowMenu, before: e3, ...s });

  // ── After the app is closed and opened ──
  await closeAllEditors();
  await showPlannerColumn();
  await pressRow('tasks');
  await wait(1_500);
  await app.close(); app = null;
  await launch();
  await wait(1_500);
  // The app may open on Home; the restored Planner tab is the one that is not Home. Press it.
  const restored = (await read()).labels.filter((l) => l !== 'Home');
  if (restored.length === 1) await pressTab(restored[0], { wait: 1_500 });
  s = await read();
  check('R1 after the app is closed and opened, the restored Planner tab is named for the place it shows, not "Planner"', restored.length === 1 && !!s.place && s.active === NAME[s.place], { restored, ...s });
} catch (err) {
  console.log(`[probe] stopped: ${err?.stack ?? err}`); failed.push('the probe stopped');
  if (page) await screenshot(app, page, path.join(shots, 'stopped.png')).catch(() => {});
} finally { await app?.close().catch(() => {}); }

const real = errors.filter((e) => !/Ollama|EmbeddingService|ERR_CONNECTION_REFUSED/.test(e));
console.log(`\n[probe] page errors: ${real.length}`); for (const e of real.slice(0, 6)) console.log('  ' + e);
console.log(`[probe] shots: ${shots}`);
const total = passed + failed.length;
console.log(`RESULT: ${passed}/${total} passed`);
process.exitCode = failed.length ? 1 : 0;
