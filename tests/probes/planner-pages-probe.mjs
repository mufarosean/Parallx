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
    page: pane.dataset.tab, tabs: shown('.planner-pane__tab').length, pageMonth: shown('.planner-today__month').length, lists: shown('.planner-tasks__navitem').length,
    title: shown('.px-page-header__title')[0]?.textContent ?? null, subtitle: shown('.px-page-header__subtitle')[0]?.textContent ?? null,
    actions: shown('.planner-pane__actions button, .planner-pane__actions [role="button"], .planner-pane__actions [role="radio"], .px-page-header button').map((b) => (b.getAttribute('aria-label') || b.title || b.textContent || '').trim()),
    bar: shown('.planner-pane__header').length, titleFont: shown('.px-page-header__title, .planner-cdate')[0] ? getComputedStyle(shown('.px-page-header__title, .planner-cdate')[0]).fontFamily.split(',')[0].replace(/['"]/g, '') + ' ' + getComputedStyle(shown('.px-page-header__title, .planner-cdate')[0]).fontSize : null,
    calTitle: shown('.planner-cdate')[0]?.textContent ?? null,
    capture: (() => { const c = shown('.planner-today__capture')[0]; if (!c) return null; const cs = getComputedStyle(c); return { radius: parseFloat(cs.borderTopLeftRadius), shadow: cs.boxShadow !== 'none', key: c.querySelector('kbd')?.textContent ?? null, icon: !!c.querySelector('svg') }; })(),
    sideHeads: shown('.planner-today__side .planner-today__head').map((h) => h.textContent.trim()), cards: shown('.planner-today__card').length,
    review: shown('.planner-today__review-item').map((r) => ({ name: r.querySelector('.planner-today__task-title')?.textContent, days: [...r.querySelectorAll('.planner-today__plan button')].map((b) => b.textContent.trim()) })),
    hourFont: (() => { const h = shown('.planner-today__hour')[0]; return h ? getComputedStyle(h, '::before').fontFamily.split(',')[0].replace(/['"]/g, '') : null; })(),
    band: (() => { const b = shown('.planner-section--review')[0]; if (!b) return null; const cs = getComputedStyle(b); return { bg: cs.backgroundColor, radius: parseFloat(cs.borderTopLeftRadius), border: cs.borderTopWidth }; })(),
    taskRows: shown('.planner-task').map((t) => ({ h: Math.round(t.getBoundingClientRect().height), due: t.querySelector('.planner-task__due') ? getComputedStyle(t.querySelector('.planner-task__due')).fontFamily.split(',')[0].replace(/['"]/g, '') : null })),
    month: (() => { const cells = shown('.planner-month__cell'); if (!cells.length) return null; const t = cells.find((c) => c.classList.contains('planner-month__cell--today')); const a = cells[0].getBoundingClientRect(), b = cells[1].getBoundingClientRect(); const chip = shown('.planner-month__chip').find((c) => c.querySelector('.planner-month__chiptime')) ?? shown('.planner-month__chip')[0]; return { n: cells.length, gap: Math.round(b.left - a.right), radius: parseFloat(getComputedStyle(cells[7]).borderTopLeftRadius), today: t ? { label: t.querySelector('.planner-month__cellnum')?.textContent, ring: getComputedStyle(t).boxShadow } : null, other: cells.filter((c) => c.classList.contains('planner-month__cell--other-month')).length, chip: chip ? { time: chip.querySelector('.planner-month__chiptime')?.textContent ?? null, text: chip.querySelector('.planner-month__chiptext')?.textContent, radius: parseFloat(getComputedStyle(chip).borderTopLeftRadius) } : null }; })(),
    view: shown('[data-px-id="planner.calendar.view"] [aria-checked="true"], [data-px-id="planner.calendar.view"] [aria-pressed="true"], [data-px-id="planner.calendar.view"] .ui-segmented-control__segment--selected')[0]?.textContent ?? null,
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
  check('Today: no tabs across the page and no month beside the day', p.tabs === 0 && p.pageMonth === 0, p);
  check('Today: the date is the front-page title in the display face, New Event beside it, and no bar over the page', /day, \w+ \d+/.test(p.title ?? '') && p.titleFont === 'Newsreader 34px' && p.actions.some((a) => /New Event/.test(a)) && p.bar === 0, [p.title, p.titleFont, p.actions, p.bar]);
  check('Today: the capture field is one lifted sheet with a plus and its key', !!p.capture && p.capture.radius >= 10 && p.capture.shadow && p.capture.key === 'Enter' && p.capture.icon, p.capture);
  check('Today: the side is plain sections with a count each (To review, Due today), no cards', p.sideHeads.join('|') === 'To review0|Due today0' && p.cards === 0, [p.sideHeads, p.cards]);
  check('Today: the hours are in the mono face', /Mono/.test(p.hourFont ?? ''), p.hourFont);
  await screenshot(app, page, path.join(shots, 'today.png'));
  // Calendar, by the mouse on the sidebar's row.
  const cal = await side('calendar');
  await page.mouse.click(cal.x, cal.y); await page.waitForTimeout(1_200);
  p = await read();
  check('a press on Calendar in the sidebar shows the calendar and lights that row alone', p.page === 'calendar' && p.lit.join() === 'calendar' && p.tabs === 0, p);
  check('Calendar: the month is the title, in the display face; then the arrows, Today, Month Week Day and New Event', /^[A-Z][a-z]+ \d{4}$/.test(p.calTitle ?? '') && p.titleFont === 'Newsreader 22px' && ['Previous', 'Next', 'today', 'Month', 'Week', 'Day', 'New Event'].every((w) => p.actions.some((a) => a.includes(w))), [p.calTitle, p.titleFont, p.actions]);
  check('Calendar: each day is its own rounded sheet with a gap round it', !!p.month && p.month.n >= 28 && p.month.gap >= 4 && p.month.radius >= 8, p.month);
  check('Calendar: today is ringed and says "Today"; days of other months are marked to step back', /^Today \d+$/.test(p.month.today?.label ?? '') && /2px/.test(p.month.today.ring) && p.month.other > 0, p.month);
  check('Calendar: an event is a soft rounded chip, an event at a time with the time in front', !!p.month.chip && p.month.chip.radius >= 5 && /^\d{1,2}(:\d{2})?\s?(AM|PM)?$/i.test(p.month.chip.time ?? '') && p.month.chip.text === 'Seeded meeting', p.month.chip);
  // Month, Week, Day is one switch: by keys, Right moves to Week.
  await page.evaluate(() => { const g = document.querySelector('[data-px-id="planner.calendar.view"]'); (g.querySelector('[tabindex="0"]') ?? g.querySelector('button'))?.focus(); });
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter'); await page.waitForTimeout(900);
  const wk = await page.evaluate(() => ({ week: !!document.querySelector('.planner-week, .planner-timegrid, [class*="planner-week"]')?.getClientRects().length, month: !!document.querySelector('.planner-month')?.getClientRects().length }));
  check('Calendar: the switch, by keys, shows the week', wk.week && !wk.month, wk);
  await cmd(page, 'planner.show', 'calendar'); await page.evaluate(() => [...document.querySelectorAll('[data-px-id="planner.calendar.view"] button')].find((b) => b.textContent.trim() === 'Month')?.click()); await page.waitForTimeout(900);
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
  check('Tasks: the page is the list alone, titled with its name and its count, New Task at its right, no bar over it', p.lists === 0 && p.tabs === 0 && /^\d+ tasks?$/.test(p.subtitle ?? '') && p.actions.some((a) => /New Task/.test(a)) && p.bar === 0, p);
  check('Tasks: the Review Queue stands on a soft band, with no box drawn round it', !!p.band && p.band.radius >= 8 && p.band.border === '0px' && !/rgba?\(0, 0, 0, 0\)/.test(p.band.bg), p.band);
  check('Tasks: every task is a row of 36 px or more', p.taskRows.length >= 2 && p.taskRows.every((r) => r.h >= 36), p.taskRows);
  await screenshot(app, page, path.join(shots, 'tasks-all.png'));
  const rq = await side('tasks.review');
  await page.mouse.click(rq.x, rq.y); await page.waitForTimeout(1_000);
  p = await read();
  check('Review Queue from the sidebar retitles the page, with its one line of help', p.title === 'Review Queue' && p.subtitle === 'Captured without a date. Pick a day for each.' && p.lit.join() === 'tasks.review', p);
  // A day given from the queue: the task leaves it and carries its day in the mono face.
  await page.evaluate(() => [...document.querySelectorAll('.planner-task__quickplan button')].find((b) => b.getClientRects().length && b.textContent.trim() === 'Today')?.click()); await page.waitForTimeout(1_000);
  await cmd(page, 'planner.show', 'tasks', 'today'); await page.waitForTimeout(900);
  p = await read();
  check('a task given Today from the queue is on the Today list, its day in the mono face', p.title === 'Today' && p.taskRows.length === 1 && /Mono/.test(p.taskRows[0].due ?? ''), p.taskRows);
  await cmd(page, 'planner.show', 'today'); await page.waitForTimeout(900);
  p = await read();
  check('and Today\'s side shows what is left to review with its three day buttons, and one due today', p.review.length === 1 && p.review[0].days.join('|') === 'Today|Tomorrow|Next Week' && p.sideHeads.join('|') === 'To review1|Due today1', [p.review, p.sideHeads]);
  await screenshot(app, page, path.join(shots, 'today-with-tasks.png'));
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
