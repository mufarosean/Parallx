// column-lists-probe.mjs — each tool's own list in the column: Files, Planner,
// Flashcards, Study, and Open above them all.
//
// Boots the built app hidden on a seeded workspace, opens each tool's list
// and uses it as a person would: Open lists every open editor with its live
// word whatever tool is showing; Files is the file tree; Planner has Today, Calendar, Tasks with
// its six lists and their counts, a small month that opens the calendar on
// the day pressed, the calendars and Settings; Flashcards has a named row a
// destination; Study has Home, the subject, its plan, Progress and its units.
// Screenshots in dark and light.
//
//   node scripts/build.mjs && xvfb-run -a node tests/probes/column-lists-probe.mjs [outDir]
import path from 'node:path';
import fs from 'node:fs/promises';
import { PROJECT_ROOT, launchApp, cmd, setToolEnabled } from './scene.mjs';
import { seedBeforeLaunch, seedAfterLaunch } from './audit-seed.mjs';

await fs.mkdir(path.join(PROJECT_ROOT, 'test-results'), { recursive: true });
const outDir = process.argv[2] ? path.resolve(process.argv[2]) : await fs.mkdtemp(path.join(PROJECT_ROOT, 'test-results', 'column-lists-'));
const shots = path.join(outDir, 'shots');
const appRoot = path.join(outDir, 'app');
const ws = path.join(outDir, 'workspace');
for (const d of [shots, path.join(appRoot, 'data'), ws]) await fs.mkdir(d, { recursive: true });
await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: ws }));
try { await fs.symlink(path.join(PROJECT_ROOT, 'ext'), path.join(appRoot, 'ext'), 'junction'); } catch { /* ok */ }

const problems = [];
const check = (name, ok, got) => { console.log(`${ok ? '  ok ' : ' FAIL'} ${name}${ok ? '' : `: ${JSON.stringify(got)}`}`); if (!ok) problems.push(name); };

const seedPre = await seedBeforeLaunch(ws);
const { app, page, errors } = await launchApp(appRoot);
const wait = (ms) => page.waitForTimeout(ms);
const shot = async (name) => {
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur()).catch(() => {});
  await page.mouse.move(760, 560); await wait(300);
  const file = path.join(shots, name);
  if (await page.screenshot({ path: file, timeout: 8_000 }).then(() => true, () => false)) return;
  const b64 = await app.evaluate(async ({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; return w ? (await w.webContents.capturePage()).toPNG().toString('base64') : null; }).catch(() => null);
  if (b64) await fs.writeFile(file, Buffer.from(b64, 'base64'));
};
const mode = async (m) => {
  await cmd(page, 'settings.openAppearance'); await wait(800);
  await page.evaluate((m) => Array.from(document.querySelectorAll(`[data-px-id="appearance.mode.${m}"]`)).find((e) => e.getClientRects().length)?.click(), m);
  await wait(800); await page.keyboard.press('Escape'); await wait(400);
};
/** Open a tool's list by pressing its row at the foot of the column. */
const tool = async (name) => {
  const at = await page.evaluate((name) => { const b = [...document.querySelectorAll('.sidebar-tools .activity-bar-item')].find((x) => x.getAttribute('aria-label') === name); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, name);
  if (!at) return false;
  await page.mouse.click(at.x, at.y); await wait(900);
  return true;
};
/** Press, with the mouse, the visible control with this scene id. */
const press = async (id) => {
  const at = await page.evaluate((id) => { const e = [...document.querySelectorAll(`[data-px-id="${CSS.escape(id)}"]`)].find((x) => x.getClientRects().length); if (!e) return null; e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, id);
  if (!at) return false;
  await page.mouse.click(at.x, at.y); await wait(700);
  return true;
};
const head = () => page.evaluate(() => document.querySelector('.sidebar-header-label')?.textContent ?? null);
const activeTab = () => page.evaluate(() => document.querySelector('.editor-tab-bar .ui-tab--active .ui-tab-label')?.textContent ?? null);

try {
  for (const id of ['parallx-community.flashcards', 'parallx-community.study']) await setToolEnabled(page, id, true);
  await wait(3_000);
  await seedAfterLaunch(page, seedPre);

  // ── Open, in the column whatever tool is showing; then Files, the tree alone ──
  await cmd(page, 'welcome.openWelcome'); await wait(600);
  check('Files: its row opens its list', await tool('Explorer') && (await head()) === 'Explorer', await head());
  // A live word, set the way an editor sets its own.
  const word = await page.evaluate(() => {
    const svc = window.__parallx_workbench__._services.get({ id: 'IEditorService' });
    const open = svc.getOpenEditors();
    return { set: svc.setEditorStatus(open[0].id, 'p. 214'), name: open[0].name, missing: svc.setEditorStatus('no-such-editor', 'x') };
  });
  await wait(400);
  const openRows = () => page.evaluate(() => [...document.querySelectorAll('.sidebar-open .open-editors-item')].map((r) => ({ name: r.querySelector('.open-editors-label')?.textContent, word: r.querySelector('.open-editors-status')?.textContent ?? null, h: Math.round(r.getBoundingClientRect().height), icon: !!r.querySelector('.open-editors-icon svg'), tab: r.tabIndex, shown: r.getClientRects().length > 0 })));
  const files = await page.evaluate(() => ({
    sections: [...document.querySelectorAll('.sidebar-views .view-section')].filter((s) => s.getClientRects().length).map((s) => s.dataset.viewId),
    openInExplorer: !!document.querySelector('.sidebar-views .open-editors-view'),
    tree: document.querySelectorAll('.sidebar-views [role="treeitem"]').length,
  }));
  let rows = await openRows();
  check('Open: every open editor has a row with its icon, 26 px tall', rows.length >= 3 && rows.every((r) => r.icon && r.h === 26), rows.slice(0, 4));
  check('Open: an editor\'s live word shows on its row, and on no other', word.set === true && word.missing === false && rows.filter((r) => r.word).length === 1 && rows.find((r) => r.name === word.name)?.word === 'p. 214', { word, rows: rows.filter((r) => r.word) });
  check('Open: one row is the Tab stop and the arrows walk the rows', rows.filter((r) => r.tab === 0).length === 1, rows.map((r) => r.tab));
  await page.evaluate(() => document.querySelector('.sidebar-open .open-editors-item[tabindex="0"]')?.focus());
  await page.keyboard.press('Home'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); await wait(500);
  check('Open: Enter on a row brings its editor to the front', (await activeTab()) === rows[1].name, { tab: await activeTab(), want: rows[1].name });
  check('Files: the Explorer\'s list is the file tree alone', files.sections.join('|') === 'view.explorer' && !files.openInExplorer && files.tree > 0, files);
  const names = rows.map((r) => r.name).join('|');
  for (const name of ['Planner', 'Study']) {
    await tool(name);
    rows = await openRows();
    check(`Open: the same rows are there with ${name}'s list showing`, rows.map((r) => r.name).join('|') === names && rows.some((r) => r.shown), rows.map((r) => r.name));
  }
  await tool('Explorer');
  await shot('dark-files.png');

  // ── Planner ──
  await page.evaluate(() => window.__parallx_workbench__._services.get({ id: 'ICommandService' }).executeCommand('planner.open')); await wait(1_200);
  check('Planner: its row opens its list', await tool('Planner') && (await head()) === 'Planner', await head());
  const planner = () => page.evaluate(() => {
    const rows = [...document.querySelectorAll('.planner-sidebar .planner-sidebar__row[data-key]')].map((r) => ({ key: r.dataset.key, name: r.querySelector('.px-btn__label')?.textContent, count: r.querySelector('[data-role="count"]:not([hidden])')?.textContent ?? null, active: r.classList.contains('planner-sidebar__row--active'), h: Math.round(r.getBoundingClientRect().height) }));
    const month = document.querySelector('.planner-sidebar .px-smallmonth');
    return {
      rows, month: month ? { title: month.querySelector('.px-datepicker__title')?.textContent, days: month.querySelectorAll('.px-datepicker__day').length, today: month.querySelector('.px-datepicker__day--today')?.textContent ?? null, stops: month.querySelectorAll('.px-datepicker__day[tabindex="0"]').length } : null,
      calendars: [...document.querySelectorAll('.planner-sidebar__cal')].map((c) => c.textContent.trim()),
      page: { tab: document.querySelector('.planner-pane')?.dataset.tab ?? null, pageTabs: document.querySelectorAll('.planner-pane__tab').length, pageLists: document.querySelectorAll('.planner-tasks__navitem').length, pageMonth: document.querySelectorAll('.planner-today__month').length, tasksTitle: document.querySelector('.planner-tasks .px-page-header__title')?.textContent ?? null, title: document.querySelector('.planner-cal__title, .planner-calendar__title, .planner-toolbar__title')?.textContent ?? null, text: (document.querySelector('.planner-pane, .planner-root, .planner')?.innerText ?? '').slice(0, 400) },
    };
  });
  let p = await planner();
  check('Planner: Today, Calendar, Tasks, then Tasks\' six lists', p.rows.map((r) => r.name).join('|') === 'Today|Calendar|Tasks|Review Queue|Today|This Week|Overdue|All Tasks|Completed|Settings', p.rows.map((r) => r.name));
  check('Planner: no row is squeezed (each at least 24 px)', p.rows.every((r) => r.h >= 24), p.rows.map((r) => r.h));
  check('Planner: each of the six lists shows its count', p.rows.filter((r) => r.key.startsWith('tasks.')).every((r) => /^\d+$/.test(r.count ?? '')), p.rows.filter((r) => r.key.startsWith('tasks.')));
  check('Planner: the small month is there, 42 days, today marked, one Tab stop', !!p.month && p.month.days === 42 && !!p.month.today && p.month.stops === 1, p.month);
  check('Planner: the calendars are listed', p.calendars.length >= 1, p.calendars);
  // A task captured now is counted on All Tasks and on Review Queue without a reload.
  const before = Number(p.rows.find((r) => r.key === 'tasks.all')?.count ?? -1);
  await cmd(page, 'planner.show', 'today'); await wait(700);
  const cap = page.locator('[data-px-id="planner.today.capture"]').first();
  if (await cap.count()) { await cap.click(); await page.keyboard.type('Probe task for the column'); await page.keyboard.press('Enter'); await wait(1_200); }
  p = await planner();
  check('Planner: a captured task raises All Tasks and the Review Queue at once', Number(p.rows.find((r) => r.key === 'tasks.all')?.count) === before + 1 && Number(p.rows.find((r) => r.key === 'tasks.review')?.count) >= 1, p.rows.filter((r) => r.key.startsWith('tasks.')));
  check('Planner: pressing Overdue opens Tasks on that list and lights the row', await press('planner.side.tasks.overdue') && (p = await planner()).page.tab === 'tasks' && p.page.tasksTitle === 'Overdue' && p.rows.find((r) => r.key === 'tasks.overdue')?.active === true && p.rows.filter((r) => r.active).length === 1, { page: p.page, active: p.rows.filter((r) => r.active).map((r) => r.key) });
  check('Planner: pressing Review Queue changes the list on the page already open', await press('planner.side.tasks.review') && (p = await planner()).page.tasksTitle === 'Review Queue', p.page);
  // The look's piece 9: what the sidebar's list has, the page no longer has a second copy of.
  check('Planner: the page has no tabs, no list of lists and no month of its own', p.page.pageTabs === 0 && p.page.pageLists === 0 && p.page.pageMonth === 0, p.page);
  check('Planner: pressing Calendar lights Calendar', await press('planner.side.calendar') && (p = await planner()).rows.find((r) => r.key === 'calendar')?.active === true, p.rows.filter((r) => r.active).map((r) => r.key));
  // The small month by keys: Page Down goes to next month, Enter opens the calendar on that day.
  await page.evaluate(() => document.querySelector('.planner-sidebar .px-smallmonth .px-datepicker__day[tabindex="0"]')?.focus());
  const monthBefore = p.month.title;
  await page.keyboard.press('PageDown'); await wait(200);
  const picked = await page.evaluate(() => ({ label: document.activeElement?.getAttribute('aria-label') ?? null, inMonth: !!document.activeElement?.closest('.px-smallmonth') }));
  await page.keyboard.press('Enter'); await wait(900);
  p = await planner();
  const shownMonth = (picked.label ?? '').match(/, (\w+) \d+, (\d{4})/);
  const pageSays = await page.evaluate(() => (document.querySelector('.editor-pane-container')?.innerText ?? '').slice(0, 600));
  check('Planner: Page Down in the small month moves to the next month and keeps the keys inside it', picked.inMonth && p.month.title !== monthBefore, { picked, was: monthBefore, now: p.month.title });
  check('Planner: Enter on a day opens the calendar on that day\'s month', !!shownMonth && pageSays.includes(shownMonth[1]) && p.rows.find((r) => r.key === 'calendar')?.active === true, { picked: picked.label, page: pageSays.slice(0, 120) });
  check('Planner: the day picked is the one marked in the small month', await page.evaluate((label) => document.querySelector('.planner-sidebar .px-smallmonth .px-datepicker__day[aria-selected="true"]')?.getAttribute('aria-label') === label, picked.label), picked.label);
  await cmd(page, 'planner.show', 'today'); await wait(700);
  await shot('dark-planner.png');

  // ── Flashcards ──
  await cmd(page, 'flashcards.open'); await wait(1_200);
  check('Flashcards: its row opens its list', await tool('Flashcards') && (await head()) === 'Flashcards', await head());
  const fc = () => page.evaluate(() => {
    const items = [...document.querySelectorAll('.fc-sidebar .fc-sb__nav-item')].map((i) => { const r = i.getBoundingClientRect(); return { view: i.dataset.view, name: i.textContent.trim(), icon: !!i.querySelector('.fc-sb__nav-icon svg') && i.querySelector('.fc-sb__nav-icon').getClientRects().length > 0, y: Math.round(r.y), x: Math.round(r.x), h: Math.round(r.height), selected: i.getAttribute('aria-selected') }; });
    return { items, orientation: document.querySelector('.fc-sb__nav')?.getAttribute('aria-orientation'), decks: !!document.querySelector('.fc-sidebar .fc-sb__decks'), title: document.querySelector('.fc-pane h1, .fc-pane .fc-home__title, .fc-pane [class*="__title"]')?.textContent ?? null };
  });
  let f = await fc();
  check('Flashcards: a named row a destination, one under the other, each with its icon', f.items.map((i) => i.name).join('|') === 'Decks|Study|Stats|Make Cards|Import' && f.items.every((i, k) => i.icon && i.h >= 24 && (k === 0 || (i.y > f.items[k - 1].y && i.x === f.items[0].x))), f.items);
  check('Flashcards: the rows say they run down, and the decks are under them', f.orientation === 'vertical' && f.decks, { o: f.orientation, decks: f.decks });
  check('Flashcards: pressing Stats opens Stats and marks the row', await press('flashcards.side.stats') && (f = await fc()).items.find((i) => i.view === 'stats')?.selected === 'true' && f.items.filter((i) => i.selected === 'true').length === 1, f.items.map((i) => [i.view, i.selected]));
  await page.evaluate(() => document.querySelector('.fc-sb__nav-item[aria-selected="true"]')?.focus());
  await page.keyboard.press('ArrowDown'); await wait(700);
  f = await fc();
  check('Flashcards: the Down arrow moves to the next row and opens it', f.items.find((i) => i.view === 'create')?.selected === 'true', f.items.map((i) => [i.view, i.selected]));
  await press('flashcards.side.decks');
  await shot('dark-flashcards.png');

  // ── Study ──
  await cmd(page, 'study.open'); await wait(1_500);
  check('Study: its row opens its list', await tool('Study') && (await head()) === 'Study', await head());
  const st = await page.evaluate(() => {
    const ids = [...document.querySelectorAll('.sidebar-views [data-px-id^="study.side."]')].filter((e) => e.getClientRects().length).map((e) => ({ id: e.dataset.pxId, y: Math.round(e.getBoundingClientRect().y), name: (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 30) }));
    const first = (re) => ids.find((i) => re.test(i.id));
    return { home: first(/^study\.side\.home/), subject: first(/^study\.side\.subject\.\d+$/), plan: first(/^study\.side\.plan\./), progress: first(/^study\.side\.progress\./), unit: first(/^study\.side\.unit\.[^.]+\.[^.]+$/), all: ids.slice(0, 14).map((i) => i.id) };
  });
  check('Study: Home, the subject, its plan, Progress, then its units, in that order', !!st.home && !!st.subject && !!st.plan && !!st.progress && !!st.unit && st.home.y < st.subject.y && st.subject.y < st.plan.y && st.plan.y < st.progress.y && st.progress.y < st.unit.y, st);
  check('Study: pressing Progress opens the subject\'s Progress tab', await press(st.progress?.id ?? 'none') && /progress/i.test((await activeTab()) ?? ''), await activeTab());
  await cmd(page, 'study.open'); await wait(1_000);
  await shot('dark-study.png');

  // ── Light, and no page errors from any of it ──
  await mode('light');
  for (const [name, open] of [['Explorer', 'welcome.openWelcome'], ['Planner', 'planner.open'], ['Flashcards', 'flashcards.open'], ['Study', 'study.open']]) {
    await cmd(page, open); await wait(900);
    await tool(name);
    await shot(`light-${name === 'Explorer' ? 'files' : name.toLowerCase()}.png`);
  }
} catch (err) {
  console.log(`[probe] stopped: ${err?.stack ?? err}`);
  problems.push('the probe stopped');
  await shot('stopped.png').catch(() => {});
} finally {
  await app.close().catch(() => {});
}
const real = errors.filter((e) => !/Ollama|EmbeddingService/.test(e));
console.log(`\n[probe] page errors: ${real.length}`);
for (const e of real.slice(0, 8)) console.log('  ' + e);
if (real.length) problems.push('page errors');
console.log(`[probe] ${problems.length} problems${problems.length ? ': ' + problems.join('; ') : ''}`);
console.log(`[probe] shots: ${shots}`);
process.exitCode = problems.length ? 1 : 0;
