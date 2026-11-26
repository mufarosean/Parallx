// tools-list-probe.mjs — Tools and Extensions is one list grouped On and Off,
// each tool with its own icon, what it adds, and a switch (the look's piece 8,
// his pick 6B).
//
// Boots the built app hidden on a new workspace, opens the list, turns a tool
// off with the mouse and on again with the keys, and reads the tool's state
// back from the app's own services.
//
//   node scripts/build.mjs && xvfb-run -a node tests/probes/tools-list-probe.mjs [outDir]
import fs from 'node:fs/promises';
import path from 'node:path';
import { PROJECT_ROOT, launchApp, cmd, toolList, screenshot } from './scene.mjs';

await fs.mkdir(path.join(PROJECT_ROOT, 'test-results'), { recursive: true });
const root = process.argv[2] ? path.resolve(process.argv[2]) : await fs.mkdtemp(path.join(PROJECT_ROOT, 'test-results', 'tools-list-'));
await fs.rm(root, { recursive: true, force: true }); // a run starts from nothing, whatever the last one left
const appRoot = path.join(root, 'app');
const ws = path.join(root, 'workspace');
const shots = path.join(root, 'shots');
for (const d of [path.join(appRoot, 'data'), ws, shots]) await fs.mkdir(d, { recursive: true });
await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: ws }));
try { await fs.symlink(path.join(PROJECT_ROOT, 'ext'), path.join(appRoot, 'ext'), 'junction'); } catch { /* there */ }

const problems = [];
const check = (name, ok, got) => { console.log(`${ok ? '  ok ' : ' FAIL'} ${name}${ok ? '' : `: ${JSON.stringify(got)}`}`); if (!ok) problems.push(name); };

const { app, page, errors } = await launchApp(appRoot);
/** The list as drawn: its title, its group labels, and every row. */
const read = () => page.evaluate(() => {
  const pane = Array.from(document.querySelectorAll('.tool-gallery-page')).find((p) => p.getClientRects().length);
  if (!pane) return null;
  const rows = [];
  let group = '';
  for (const el of pane.querySelectorAll('.tool-gallery-group-header, .tool-gallery-row')) {
    if (el.classList.contains('tool-gallery-group-header')) { group = el.textContent.trim(); continue; }
    const sw = el.querySelector('[role="switch"]');
    const r = sw?.getBoundingClientRect();
    rows.push({
      group, name: el.querySelector('.tool-gallery-row-name')?.textContent ?? '',
      icon: el.querySelector('.tool-gallery-row-icon svg')?.innerHTML ?? '',
      meta: el.querySelector('.tool-gallery-row-meta')?.textContent ?? '',
      sw: sw ? { on: sw.getAttribute('aria-checked'), label: sw.getAttribute('aria-label'), x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height } : null,
    });
  }
  return { title: pane.querySelector('h1')?.textContent ?? '', titleFont: pane.querySelector('h1') ? getComputedStyle(pane.querySelector('h1')).fontFamily : '', groups: Array.from(pane.querySelectorAll('.tool-gallery-group-header')).map((g) => g.textContent.trim()), groupFont: getComputedStyle(pane.querySelector('.tool-gallery-group-header')).fontFamily, rows };
});
const tabs = () => page.evaluate(() => Array.from(document.querySelectorAll('.editor-tab-bar .ui-tab')).filter((x) => x.getClientRects().length).length);
const toolRow = (name) => page.evaluate((name) => !!Array.from(document.querySelectorAll('button.activity-bar-item')).find((b) => b.getClientRects().length && (b.getAttribute('aria-label') || b.textContent || '').includes(name)), name);

try {
  await cmd(page, 'tools.showInstalled');
  await page.waitForTimeout(1_200);
  const tools = await toolList(page);
  const on = tools.filter((t) => t.enabled).length;
  const off = tools.length - on;
  const a = await read();
  check('the page is titled Tools and Extensions in the display face', a?.title === 'Tools and Extensions' && /Newsreader/.test(a.titleFont), a && [a.title, a.titleFont]);
  check(`the groups read "On, ${on}" and "Off, ${off}" in the mono face`, a.groups.join(' | ') === [`On, ${on}`, off ? `Off, ${off}` : null].filter(Boolean).join(' | ') && /Mono/.test(a.groupFont), [a.groups, a.groupFont]);
  check('one row a tool', a.rows.length === tools.length, [a.rows.length, tools.length]);
  check('every row has an icon, and they are not all the same one', a.rows.every((r) => r.icon) && new Set(a.rows.map((r) => r.icon)).size > 3, new Set(a.rows.map((r) => r.icon)).size);
  check('rows say what the tool adds', a.rows.filter((r) => /\d+ (command|view|setting)s?/.test(r.meta)).length >= a.rows.length - 3, a.rows.filter((r) => !r.meta).map((r) => r.name));
  const required = tools.filter((t) => t.required).length;
  check('a tool the app requires has no switch; every other has one', a.rows.filter((r) => !r.sw).length === required, [a.rows.filter((r) => !r.sw).length, required]);
  check('every switch in On is on, in Off is off, and is named', a.rows.filter((r) => r.sw).every((r) => r.sw.on === String(r.group.startsWith('On')) && r.sw.label?.includes(r.name)), a.rows.filter((r) => r.sw).map((r) => [r.name, r.sw.on, r.sw.label]).slice(0, 4));
  await screenshot(app, page, path.join(shots, 'tools-list.png'));

  // Off with the mouse: the tool that shows a row in the sidebar's tools, so its leaving can be seen.
  const pick = a.rows.find((r) => r.sw && r.group.startsWith('On') && r.name === 'Planner') ?? a.rows.find((r) => r.sw && r.group.startsWith('On'));
  const tabs0 = await tabs();
  const inColumn0 = await toolRow(pick.name);
  // The list is longer than the window: bring the row into view, then press where its switch now is.
  const at = await page.evaluate((name) => { const row = [...document.querySelectorAll('.tool-gallery-page .tool-gallery-row')].find((r) => r.querySelector('.tool-gallery-row-name')?.textContent === name); row.scrollIntoView({ block: 'center' }); const r = row.querySelector('[role="switch"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, pick.name);
  await page.mouse.click(at.x, at.y);
  await page.waitForTimeout(1_500);
  const b = await read();
  const after = (await toolList(page)).filter((t) => !t.enabled).length;
  const moved = b.rows.find((r) => r.name === pick.name);
  check(`a press on ${pick.name}'s switch turns the tool off (read from the app)`, after === off + 1, [off, after]);
  check('its row is under Off, its switch off', moved?.group.startsWith('Off') && moved.sw?.on === 'false', moved);
  check('the press did not open the tool\'s page', (await tabs()) === tabs0, [tabs0, await tabs()]);
  check('its row left the sidebar\'s tools at once', inColumn0 ? !(await toolRow(pick.name)) : true, inColumn0);
  await screenshot(app, page, path.join(shots, 'tools-list-one-off.png'));

  // On again with the keys: Tab to the switch, Space.
  await page.evaluate(() => Array.from(document.querySelectorAll('.tool-gallery-page [data-px-id="tools.search"]')).find((x) => x.getClientRects().length)?.focus());
  let reached = false;
  for (let i = 0; i < 80 && !reached; i++) {
    await page.keyboard.press('Tab');
    reached = await page.evaluate((name) => document.activeElement?.getAttribute('role') === 'switch' && (document.activeElement.getAttribute('aria-label') || '').includes(name), pick.name);
  }
  check('Tab reaches the switch', reached);
  const ring = await page.evaluate(() => { const e = document.activeElement; const t = e.querySelector('.ui-toggle__track') ?? e; const c = getComputedStyle(t), d = getComputedStyle(e); return [c.outlineStyle, c.outlineWidth, c.boxShadow, d.outlineStyle, d.outlineWidth].join(' '); });
  check('the focused switch shows a ring', /solid|rgb/.test(ring) && !/^none 0px none none 0px$/.test(ring), ring);
  await page.keyboard.press('Space');
  await page.waitForTimeout(1_500);
  const c = await read();
  check('Space turns it on again (read from the app)', (await toolList(page)).filter((t) => !t.enabled).length === off, (await toolList(page)).filter((t) => !t.enabled).length);
  check('its row is back under On', c.rows.find((r) => r.name === pick.name)?.group.startsWith('On'), c.rows.find((r) => r.name === pick.name));

  // A group label folds its group; a row opens the tool's page.
  await page.evaluate(() => Array.from(document.querySelectorAll('.tool-gallery-page .tool-gallery-group-header')).find((x) => x.getClientRects().length)?.focus());
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  const d = await read();
  check('Enter on "On" folds its rows away', d.rows.filter((r) => r.group.startsWith('On')).length === 0, d.rows.length);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  const first = await page.evaluate(() => { const r = Array.from(document.querySelectorAll('.tool-gallery-page .tool-gallery-row-name')).find((x) => x.getClientRects().length).getBoundingClientRect(); return { x: r.x + 4, y: r.y + r.height / 2 }; });
  await page.mouse.click(first.x, first.y);
  await page.waitForTimeout(900);
  check('a press on a row opens the tool\'s page', (await tabs()) === tabs0 + 1, [tabs0, await tabs()]);

  // A finger gets a target of 24 px or more.
  check('the switch is at least 24 px in one direction and 16 in the other', c.rows.filter((r) => r.sw).every((r) => Math.max(r.sw.w, r.sw.h) >= 24 && Math.min(r.sw.w, r.sw.h) >= 16), c.rows.find((r) => r.sw)?.sw);
} catch (err) {
  console.log(`[probe] stopped: ${err?.stack ?? err}`);
  problems.push('the probe stopped');
  try { await page.screenshot({ path: path.join(shots, 'stopped.png') }); } catch { /* no window */ }
} finally {
  await app.close().catch(() => {});
}
const real = errors.filter((e) => !/Ollama|EmbeddingService/.test(e));
console.log(`\n[probe] page errors: ${real.length}`);
for (const e of real.slice(0, 8)) console.log('  ' + e);
console.log(`[probe] ${problems.length} problems${problems.length ? ': ' + problems.join('; ') : ''}`);
console.log(`[probe] shots: ${shots}`);
process.exitCode = problems.length ? 1 : 0;
