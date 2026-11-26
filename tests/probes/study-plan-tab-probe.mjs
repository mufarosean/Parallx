// study-plan-tab-probe.mjs — a plan's tab opens on the days left as its one
// large number, and shows the phases as one strip from the start to the exam
// (the look's piece 11, the part built on 2026-11-26).
//
//   node scripts/build.mjs && xvfb-run -a node tests/probes/study-plan-tab-probe.mjs [outDir]
import fs from 'node:fs/promises';
import path from 'node:path';
import { PROJECT_ROOT, launchApp, screenshot, setToolEnabled } from './scene.mjs';
import { seedBeforeLaunch, seedAfterLaunch } from './audit-seed.mjs';

await fs.mkdir(path.join(PROJECT_ROOT, 'test-results'), { recursive: true });
const root = process.argv[2] ? path.resolve(process.argv[2]) : await fs.mkdtemp(path.join(PROJECT_ROOT, 'test-results', 'study-plan-tab-'));
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
  const tab = [...document.querySelectorAll('.st-plan')].find((e) => e.getClientRects().length);
  if (!tab) return null;
  const n = tab.querySelector('.st-plan__leftn'); const left = tab.querySelector('.st-plan__left');
  const strip = tab.querySelector('.st-plan__strip'); const sr = strip?.getBoundingClientRect();
  const phases = [...tab.querySelectorAll('.st-plan__sphase')].map((b) => { const r = b.getBoundingClientRect(); return { name: (b.getAttribute('aria-label') || '').split(', ')[0], label: b.getAttribute('aria-label'), w: Math.round(r.width), h: Math.round(r.height), x: r.x + r.width / 2, y: r.y + r.height / 2, now: b.classList.contains('st-plan__sphase--now'), short: b.classList.contains('st-plan__sphase--short'), inStrip: r.x >= sr.x - 1 && r.right <= sr.right + 1 }; });
  const list = [...tab.querySelectorAll('.st-plan__phase')].map((li) => ({ name: li.querySelector('.st-plan__pname')?.textContent, facts: li.querySelector('.st-plan__pfacts')?.textContent }));
  return { left: left?.textContent ?? null, n: n?.textContent ?? null, nFont: n ? getComputedStyle(n).fontFamily.split(',')[0].replace(/['"]/g, '') : null, nSize: n ? getComputedStyle(n).fontSize : null, subtitle: tab.querySelector('.px-page-header__subtitle')?.textContent ?? '', phases, list, focus: document.activeElement?.className ?? '', focusPhase: document.activeElement?.querySelector?.('.st-plan__pname')?.textContent ?? null };
});
try {
  await setToolEnabled(page, 'parallx-community.study', true); // an extension is off until turned on
  await page.waitForTimeout(2_500);
  const screens = await seedAfterLaunch(page, pre);
  await screens['seed:study.plan'](); await page.waitForTimeout(2_000);
  const a = await read();
  check('the plan\'s tab is open', !!a, a);
  check('the days left are the one large number, in the display face', /^\d+ days? left$/.test(a.left ?? '') && a.nFont === 'Newsreader' && parseFloat(a.nSize) >= 40, [a.left, a.nFont, a.nSize]);
  check('the line under the title no longer says them a second time', !/left/.test(a.subtitle) && /Exam /.test(a.subtitle), a.subtitle);
  check('the strip has one piece a dated phase, in the order of the list below', a.phases.length >= 2 && a.phases.map((p) => p.name).join('|') === a.list.filter((l) => !/No dates/.test(l.facts)).map((l) => l.name).join('|'), [a.phases.map((p) => p.name), a.list.map((l) => l.name)]);
  check('every piece is inside the strip and at least 36 px wide', a.phases.every((p) => p.inStrip && p.w >= 36), a.phases.map((p) => p.w));
  const days = (p) => Number((p.label.match(/(\d+) days?/) || [])[1]);
  const longest = a.phases.reduce((m, p) => (days(p) > days(m) ? p : m)); const shortest = a.phases.reduce((m, p) => (days(p) < days(m) ? p : m));
  check('a longer phase is wider than a shorter one', longest.w > shortest.w, [longest.name, longest.w, shortest.name, shortest.w]);
  check('each piece is named with its kind, dates, days and hours', a.phases.every((p) => /, (Study|Rest|Catch-up|Holiday|No kind), .* · \d+ days? · [\d.]+ h/.test(p.label)), a.phases.map((p) => p.label));
  check('at most one piece is the one today is in', a.phases.filter((p) => p.now).length <= 1, a.phases.filter((p) => p.now).map((p) => p.name));
  await screenshot(app, page, path.join(shots, 'plan-tab.png'));
  // A press on a piece goes to that phase's facts.
  const target = a.phases[a.phases.length - 1];
  await page.mouse.click(target.x, target.y); await page.waitForTimeout(400);
  const b = await read();
  check('a press on a piece puts the focus on that phase\'s facts in the list', b.focusPhase === target.name, [b.focus, b.focusPhase]);
  // By keys: Tab reaches the strip's pieces, Enter does the same.
  await page.evaluate(() => [...document.querySelectorAll('.st-plan .st-plan__sphase')].find((e) => e.getClientRects().length)?.focus());
  await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab'); // arrived at by key, as a ring is shown for
  check('Tab comes to the strip\'s first piece', await page.evaluate(() => document.activeElement?.classList.contains('st-plan__sphase')), await page.evaluate(() => document.activeElement?.className));
  const ring = await page.evaluate(() => { const c = getComputedStyle(document.activeElement); return `${c.outlineStyle} ${c.outlineWidth} ${c.boxShadow}`; });
  check('a piece shows a focus ring', !/^none 0px none$/.test(ring), ring);
  await page.keyboard.press('Enter'); await page.waitForTimeout(400);
  const c = await read();
  check('Enter on the first piece goes to the first phase\'s facts', c.focusPhase === a.phases[0].name, [c.focus, c.focusPhase]);
  // The day table and the four Open buttons are where they were.
  const kept = await page.evaluate(() => { const t = [...document.querySelectorAll('.st-plan')].find((e) => e.getClientRects().length); return { rows: t.querySelectorAll('.st-plan__table tbody tr.st-plan__day').length, opens: [...t.querySelectorAll('.st-plan__opens button')].map((x) => x.textContent.trim()) }; });
  check('every day is still in its table, and the four Open buttons are there', kept.rows > 7 && kept.opens.join('|') === 'Open Days|Open Week|Open Phases|Open Plan Settings', kept);
} catch (err) {
  console.log(`[probe] stopped: ${err?.stack ?? err}`); problems.push('the probe stopped');
  await screenshot(app, page, path.join(shots, 'stopped.png')).catch(() => {});
} finally { await app.close().catch(() => {}); }
const real = errors.filter((e) => !/Ollama|EmbeddingService/.test(e));
console.log(`\n[probe] page errors: ${real.length}`); for (const e of real.slice(0, 6)) console.log('  ' + e);
console.log(`[probe] ${problems.length} problems${problems.length ? ': ' + problems.join('; ') : ''}`);
console.log(`[probe] shots: ${shots}`);
process.exitCode = problems.length ? 1 : 0;
