// floating-parts-probe.mjs — the window's floating parts in the look (piece
// 3): a menu is a rounded lifted sheet with its shortcuts in the mono face
// and a chevron for a submenu; a notice is a lifted sheet with one pigment
// dot for its kind, and the bell's list draws the same dot.
//
//   node scripts/build.mjs && xvfb-run -a node tests/probes/floating-parts-probe.mjs [outDir]
import fs from 'node:fs/promises';
import path from 'node:path';
import { PROJECT_ROOT, launchApp, cmd, cmdNoWait, screenshot } from './scene.mjs';

await fs.mkdir(path.join(PROJECT_ROOT, 'test-results'), { recursive: true });
const root = process.argv[2] ? path.resolve(process.argv[2]) : await fs.mkdtemp(path.join(PROJECT_ROOT, 'test-results', 'floating-parts-'));
await fs.rm(root, { recursive: true, force: true });
const appRoot = path.join(root, 'app'); const ws = path.join(root, 'workspace'); const shots = path.join(root, 'shots');
for (const d of [path.join(appRoot, 'data'), ws, shots]) await fs.mkdir(d, { recursive: true });
await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: ws }));
await fs.writeFile(path.join(ws, 'notes.md'), '# Notes\n');

const problems = [];
const check = (name, ok, got) => { console.log(`${ok ? '  ok ' : ' FAIL'} ${name}${ok ? '' : `: ${JSON.stringify(got)}`}`); if (!ok) problems.push(name); };
const { app, page, errors } = await launchApp(appRoot);
const menu = () => page.evaluate(() => {
  const m = [...document.querySelectorAll('.context-menu')].filter((e) => e.getClientRects().length).pop();
  if (!m) return null;
  const cs = getComputedStyle(m); const r = m.getBoundingClientRect();
  const items = [...m.querySelectorAll('.context-menu-item')].map((i) => { const q = i.getBoundingClientRect(); const kb = i.querySelector('.context-menu-item-keybinding'); const arrow = i.querySelector('.context-menu-submenu-arrow'); return { text: i.querySelector('.context-menu-item-label')?.textContent, h: Math.round(q.height), radius: parseFloat(getComputedStyle(i).borderTopLeftRadius), inside: q.left >= r.left && q.right <= r.right, kb: kb ? { text: kb.textContent, font: getComputedStyle(kb).fontFamily.split(',')[0].replace(/['"]/g, '') } : null, arrow: arrow ? { svg: !!arrow.querySelector('svg'), text: arrow.textContent.trim() } : null }; });
  return { radius: parseFloat(cs.borderTopLeftRadius), shadow: cs.boxShadow !== 'none', pad: parseFloat(cs.paddingLeft), inWindow: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth, items, selected: m.querySelector('.context-menu-item--selected .context-menu-item-label')?.textContent ?? null };
});
try {
  // A menu of the menu bar, opened and walked by keys.
  await page.keyboard.press('Alt'); await page.waitForTimeout(200);
  await page.keyboard.press('Enter'); await page.waitForTimeout(500);
  let m = await menu();
  if (!m) { await page.evaluate(() => [...document.querySelectorAll('[role="menubar"] [role="menuitem"]')].find((e) => e.textContent.trim() === 'File')?.click()); await page.waitForTimeout(500); m = await menu(); }
  check('a menu of the menu bar opens', !!m && m.items.length > 5, m);
  check('it is a rounded sheet lifted off the window, its rows inset and rounded', m.radius >= 10 && m.shadow && m.pad >= 6 && m.items.every((i) => i.radius >= 6 && i.inside), { radius: m.radius, pad: m.pad });
  check('every row is at least 28 px, a finger\'s floor with its neighbours', m.items.every((i) => i.h >= 28), m.items.map((i) => i.h));
  check('shortcuts are in the mono face', m.items.filter((i) => i.kb).length >= 3 && m.items.filter((i) => i.kb).every((i) => /Mono/.test(i.kb.font)), m.items.filter((i) => i.kb).map((i) => i.kb));
  const first = m.selected;
  await page.keyboard.press('ArrowDown'); await page.waitForTimeout(150);
  const second = (await menu()).selected;
  check('Arrow Down moves the highlight to the next row', !!second && second !== first, [first, second]);
  await screenshot(app, page, path.join(shots, 'menu-file.png'), { keepFocus: true });
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  check('Escape closes it', !(await menu()));
  // A context menu on a file, and a menu with a submenu (a page's own).
  const f = await page.evaluate(() => { const b = [...document.querySelectorAll('[role="treeitem"]')].find((e) => /notes\.md/.test(e.textContent)); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + 40, y: r.y + r.height / 2 }; });
  await page.mouse.click(f.x, f.y, { button: 'right' }); await page.waitForTimeout(500);
  m = await menu();
  check('a file\'s context menu is the same sheet, inside the window', !!m && m.radius >= 10 && m.inWindow && m.items.length > 5, m && { radius: m.radius, inWindow: m.inWindow });
  await screenshot(app, page, path.join(shots, 'menu-context.png'), { keepFocus: true });
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  await cmd(page, 'canvas.newPage'); await page.waitForTimeout(1_500);
  await page.evaluate(() => [...document.querySelectorAll('[data-px-id="canvas.page.menu"]')].find((e) => e.getClientRects().length)?.click()); await page.waitForTimeout(500);
  m = await menu();
  const subs = (m?.items ?? []).filter((i) => i.arrow);
  check('a row that opens a submenu is marked by the chevron icon, not a text arrow', subs.length >= 1 && subs.every((i) => i.arrow.svg && !i.arrow.text), subs);
  await screenshot(app, page, path.join(shots, 'menu-page.png'), { keepFocus: true });
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);

  // Notices: one of each kind, kept on screen long enough to be read back.
  await page.evaluate(() => { const n = window.__parallx_workbench__._services.get({ id: 'INotificationService' }); void n.notify('information', '12 questions made for Clark', [], undefined, 120000); void n.notify('warning', 'The clock stopped', [], undefined, 120000); void n.notify('error', 'The file could not be saved', [], undefined, 120000); });
  await page.waitForTimeout(700);
  const notes = await page.evaluate(() => [...document.querySelectorAll('.parallx-notification')].filter((e) => e.getClientRects().length).map((e) => { const d = e.querySelector('.parallx-notification-icon'); const dc = getComputedStyle(d); const c = getComputedStyle(e); const r = d.getBoundingClientRect(); return { kind: [...e.classList].find((x) => /-(information|warning|error)$/.test(x))?.split('-').pop(), text: e.querySelector('.parallx-notification-message')?.textContent, dot: { w: Math.round(r.width), h: Math.round(r.height), round: parseFloat(dc.borderTopLeftRadius) >= 4, colour: dc.backgroundColor, svgShown: !!d.querySelector('svg')?.getClientRects().length }, sheet: { radius: parseFloat(c.borderTopLeftRadius), shadow: c.boxShadow !== 'none' }, role: e.getAttribute('role'), buttons: e.querySelectorAll('button').length }; }));
  check('three notices show, each a lifted rounded sheet', notes.length === 3 && notes.every((n) => n.sheet.radius >= 10 && n.sheet.shadow), notes.map((n) => n.sheet));
  check('each has one 9 px dot and no drawn icon', notes.every((n) => n.dot.w === 9 && n.dot.h === 9 && n.dot.round && !n.dot.svgShown), notes.map((n) => n.dot));
  check('the dot\'s colour says the kind: three kinds, three colours', new Set(notes.map((n) => n.dot.colour)).size === 3, notes.map((n) => [n.kind, n.dot.colour]));
  check('a notice with no action has only its close button', notes.every((n) => n.buttons === 1), notes.map((n) => n.buttons));
  check('a screen reader is told (role status or alert)', notes.every((n) => /status|alert/.test(n.role ?? '')), notes.map((n) => n.role));
  await screenshot(app, page, path.join(shots, 'notices.png'));
  // The bell's list draws the same dots.
  await page.evaluate(() => document.querySelector('[data-px-id="activitybar.notifications"]')?.click()); await page.waitForTimeout(700);
  const bell = await page.evaluate(() => [...document.querySelectorAll('.parallx-notification-center-item')].filter((e) => e.getClientRects().length).map((e) => { const d = getComputedStyle(e, '::before'); const meta = e.querySelector('.parallx-notification-center-meta'); return { sev: e.dataset.severity, w: parseFloat(d.width), colour: d.backgroundColor, svgShown: !!e.querySelector(':scope > .svg-icon svg')?.getClientRects().length, metaFont: getComputedStyle(meta).fontFamily.split(',')[0].replace(/['"]/g, ''), meta: meta.textContent }; }));
  check('the bell lists the three, each with the same dot and its time in the mono face', bell.length === 3 && bell.every((b) => b.w === 9 && !b.svgShown && /Mono/.test(b.metaFont)) && new Set(bell.map((b) => b.colour)).size === 3, bell);
  check('a notice and its row in the bell have the same colour', bell.every((b) => notes.find((n) => n.kind === b.sev)?.dot.colour === b.colour), [bell.map((b) => [b.sev, b.colour]), notes.map((n) => [n.kind, n.dot.colour])]);
  await screenshot(app, page, path.join(shots, 'bell.png'), { keepFocus: true });
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  // Settings: a rounded sheet with its title.
  await cmdNoWait(page, 'settings.open'); await page.waitForTimeout(1_200);
  const st = await page.evaluate(() => { const d = [...document.querySelectorAll('.settings-editor-overlay')].find((e) => e.getClientRects().length); if (!d) return null; const c = getComputedStyle(d); const r = d.getBoundingClientRect(); return { radius: parseFloat(c.borderTopLeftRadius), shadow: c.boxShadow !== 'none', w: Math.round(r.width), vw: innerWidth }; });
  check('Settings is a wide rounded sheet over the window', !!st && st.radius >= 10 && st.shadow && st.w >= 900, st);
  await screenshot(app, page, path.join(shots, 'settings.png'), { keepFocus: true });
} catch (err) {
  console.log(`[probe] stopped: ${err?.stack ?? err}`); problems.push('the probe stopped');
  await screenshot(app, page, path.join(shots, 'stopped.png')).catch(() => {});
} finally { await app.close().catch(() => {}); }
const real = errors.filter((e) => !/Ollama|EmbeddingService/.test(e));
console.log(`\n[probe] page errors: ${real.length}`); for (const e of real.slice(0, 6)) console.log('  ' + e);
console.log(`[probe] ${problems.length} problems${problems.length ? ': ' + problems.join('; ') : ''}`);
console.log(`[probe] shots: ${shots}`);
process.exitCode = problems.length || real.length ? 1 : 0;
