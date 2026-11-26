// planner-pages-probe.mjs — Planner's pages have no second copy of what its
// list in the sidebar holds: no tabs, no month and no list of lists on the
// page (the look's piece 9, the part built on 2026-11-26). The pages are
// chosen in the sidebar, by mouse and by keys.
//
//   node scripts/build.mjs && xvfb-run -a node tests/probes/planner-pages-probe.mjs [outDir]
import fs from 'node:fs/promises';
import path from 'node:path';
import { PROJECT_ROOT, launchApp, cmd, screenshot } from './scene.mjs';
import { seedBeforeLaunch, seedAfterLaunch } from './audit-seed.mjs';

await fs.mkdir(path.join(PROJECT_ROOT, 'test-results'), { recursive: true });
const root = process.argv[2] ? path.resolve(process.argv[2]) : await fs.mkdtemp(path.join(PROJECT_ROOT, 'test-results', 'planner-pages-'));
await fs.rm(root, { recursive: true, force: true });
const appRoot = path.join(root, 'app'); const ws = path.join(root, 'workspace'); const shots = path.join(root, 'shots');
for (const d of [path.join(appRoot, 'data'), ws, shots]) await fs.mkdir(d, { recursive: true });
await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: ws }));
try { await fs.symlink(path.join(PROJECT_ROOT, 'ext'), path.join(appRoot, 'ext'), 'junction'); } catch { /* there */ }

const problems = [];
const check = (name, ok, got) => { console.log(`${ok ? '  ok ' : ' FAIL'} ${name}${ok ? '' : `: ${JSON.stringify(got)}`}`); if (!ok) problems.push(name); };
const pre = await seedBeforeLaunch(ws);
const { app, page, errors } = await launchApp(appRoot);
const read = () => page.evaluate(() => {
  const pane = [...document.querySelectorAll('.planner-pane')].find((e) => e.getClientRects().length);
  if (!pane) return null;
  const shown = (sel, within = pane) => [...within.querySelectorAll(sel)].filter((e) => e.getClientRects().length);
  return {
    page: pane.dataset.tab, tabs: shown('.planner-pane__tab').length, month: shown('.planner-today__month').length, lists: shown('.planner-tasks__navitem').length,
    title: shown('.px-page-header__title')[0]?.textContent ?? null, subtitle: shown('.px-page-header__subtitle')[0]?.textContent ?? null,
    actions: shown('.planner-pane__actions button, .planner-pane__actions [role="button"]').map((b) => (b.getAttribute('aria-label') || b.title || b.textContent || '').trim()),
    lit: [...document.querySelectorAll('.planner-sidebar .planner-sidebar__row--active')].map((r) => r.dataset.key),
    sideMonth: !!document.querySelector('.planner-sidebar .px-smallmonth'), sideLists: document.querySelectorAll('.planner-sidebar .planner-sidebar__row[data-key^="tasks."]').length,
    rows: shown('.planner-task, .planner-task-row, [class*="planner-task__"]').length, focusIn: pane.contains(document.activeElement),
  };
});
const side = (key) => page.evaluate((key) => { const r = document.querySelector(`.planner-sidebar .planner-sidebar__row[data-key="${key}"]`); if (!r) return null; const b = r.matches('button') ? r : r.querySelector('button') ?? r; const q = b.getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2 }; }, key);
try {
  await seedAfterLaunch(page, pre);
  await cmd(page, 'planner.open'); await page.waitForTimeout(1_500);
  await page.evaluate(() => document.querySelector('.activity-bar-item[data-icon-id="planner-container"]')?.click()); await page.waitForTimeout(900);
  let p = await read();
  check('Planner opens on Today, with the sidebar holding the month and the six lists', p?.page === 'today' && p.sideMonth && p.sideLists === 6, p);
  check('Today: no tabs across the page and no month beside the day', p.tabs === 0 && p.month === 0, p);
  check('Today: the date is the page\'s title, and New Event is still at its head', /day, \w+ \d+/.test(p.title ?? '') && p.actions.some((a) => /New Event/.test(a)), [p.title, p.actions]);
  await screenshot(app, page, path.join(shots, 'today.png'));
  // Calendar, by the mouse on the sidebar's row.
  const cal = await side('calendar');
  await page.mouse.click(cal.x, cal.y); await page.waitForTimeout(1_200);
  p = await read();
  check('a press on Calendar in the sidebar shows the calendar and lights that row alone', p.page === 'calendar' && p.lit.join() === 'calendar' && p.tabs === 0, p);
  check('Calendar keeps its own controls at the head (Today, the arrows, the view, New Event)', ['today', 'Previous', 'Next', 'Month', 'New Event'].every((w) => p.actions.some((a) => a.includes(w))) && p.actions.length >= 4, p.actions);
  await screenshot(app, page, path.join(shots, 'calendar.png'));
  // An empty Tasks page still says which list it is.
  await cmd(page, 'planner.show', 'tasks', 'overdue'); await page.waitForTimeout(900);
  p = await read();
  check('with no task yet, Tasks still names its list', p.page === 'tasks' && p.title === 'Overdue' && p.subtitle === '0 tasks', p);
  // Two tasks captured on Today, as a person does.
  await cmd(page, 'planner.show', 'today'); await page.waitForTimeout(800);
  for (const t of ['Probe task one', 'Probe task two']) { await page.locator('[data-px-id="planner.today.capture"]').first().click(); await page.keyboard.type(t); await page.keyboard.press('Enter'); await page.waitForTimeout(500); }
  // Tasks and one of its lists, by keys: the row focused, Enter.
  await page.evaluate(() => { const r = document.querySelector('.planner-sidebar .planner-sidebar__row[data-key="tasks.all"]'); (r.matches('button') ? r : r.querySelector('button') ?? r).focus(); });
  await page.keyboard.press('Enter'); await page.waitForTimeout(1_200);
  p = await read();
  check('Enter on All Tasks in the sidebar shows Tasks on that list', p.page === 'tasks' && p.lit.join() === 'tasks.all' && p.title === 'All Tasks', p);
  check('Tasks: the page is the list alone, titled with its name and its count', p.lists === 0 && p.tabs === 0 && /^\d+ tasks?$/.test(p.subtitle ?? ''), p);
  await screenshot(app, page, path.join(shots, 'tasks-all.png'));
  const rq = await side('tasks.review');
  await page.mouse.click(rq.x, rq.y); await page.waitForTimeout(1_000);
  p = await read();
  check('Review Queue from the sidebar retitles the page', p.title === 'Review Queue' && p.lit.join() === 'tasks.review', p);
  await screenshot(app, page, path.join(shots, 'tasks-review.png'));
  // With another tool's list in the sidebar, the command still reaches every page.
  await page.evaluate(() => document.querySelector('.activity-bar-item[data-icon-id="explorer-container"]')?.click()); await page.waitForTimeout(600);
  await cmd(page, 'planner.show', 'calendar'); await page.waitForTimeout(900);
  check('with another tool\'s list showing, Planner: Show reaches the calendar', (await read()).page === 'calendar', await read());
} catch (err) {
  console.log(`[probe] stopped: ${err?.stack ?? err}`); problems.push('the probe stopped');
  await screenshot(app, page, path.join(shots, 'stopped.png')).catch(() => {});
} finally { await app.close().catch(() => {}); }
const real = errors.filter((e) => !/Ollama|EmbeddingService/.test(e));
console.log(`\n[probe] page errors: ${real.length}`); for (const e of real.slice(0, 6)) console.log('  ' + e);
console.log(`[probe] ${problems.length} problems${problems.length ? ': ' + problems.join('; ') : ''}`);
console.log(`[probe] shots: ${shots}`);
process.exitCode = problems.length || real.length ? 1 : 0;
