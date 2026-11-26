// look-details-probe.mjs — three small pieces of the look, on the real app:
//
//   A  A page's Default font is the app's interface face and follows it when
//      the app's face changes; Newsreader is in the page's Font menu and a
//      page set to it is drawn in it (the look's piece 6, first half).
//   B  The Dashboard's large numbers are in the display face, and their
//      figures are of one width so a running timer does not shift.
//   C  No fold mark or dropdown mark is a text triangle: they are the app's
//      chevron icons ("Text arrows elsewhere").
//
//   node scripts/build.mjs && xvfb-run -a node tests/probes/look-details-probe.mjs [outDir]
import fs from 'node:fs/promises';
import path from 'node:path';
import { PROJECT_ROOT, launchApp, cmd, cmdNoWait, screenshot } from './scene.mjs';
import { seedBeforeLaunch, seedAfterLaunch } from './audit-seed.mjs';

await fs.mkdir(path.join(PROJECT_ROOT, 'test-results'), { recursive: true });
const root = process.argv[2] ? path.resolve(process.argv[2]) : await fs.mkdtemp(path.join(PROJECT_ROOT, 'test-results', 'look-details-'));
await fs.rm(root, { recursive: true, force: true });
const appRoot = path.join(root, 'app');
const ws = path.join(root, 'workspace');
const shots = path.join(root, 'shots');
for (const d of [path.join(appRoot, 'data'), ws, shots]) await fs.mkdir(d, { recursive: true });
await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: ws }));
try { await fs.symlink(path.join(PROJECT_ROOT, 'ext'), path.join(appRoot, 'ext'), 'junction'); } catch { /* there */ }

const problems = [];
const check = (name, ok, got) => { console.log(`${ok ? '  ok ' : ' FAIL'} ${name}${ok ? '' : `: ${JSON.stringify(got)}`}`); if (!ok) problems.push(name); };
const pre = await seedBeforeLaunch(ws);
const { app, page, errors } = await launchApp(appRoot);
const first = (s) => s.split(',')[0].trim().replace(/['"]/g, '');
/** Every triangle character drawn as text on screen (in an element's own text or by its ::before/::after). */
const triangles = () => page.evaluate(() => {
  const T = /[▴-◄▲△]/;
  const out = [];
  for (const e of document.querySelectorAll('body *')) {
    if (!e.getClientRects().length || e.closest('[data-px-surface="canvas"] .tiptap, .textLayer, pre, code')) continue;
    const own = Array.from(e.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent).join('');
    const gen = getComputedStyle(e, '::before').content + getComputedStyle(e, '::after').content;
    if (T.test(own) || T.test(gen)) out.push(`${e.tagName.toLowerCase()}.${String(e.className).split(' ')[0]} "${(own || gen).trim().slice(0, 20)}"`);
  }
  return out;
});
const menuItem = (text) => page.evaluate((text) => { const it = [...document.querySelectorAll('[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]')].filter((e) => e.getClientRects().length).find((e) => (e.textContent || '').trim().replace(/\s+/g, ' ').startsWith(text)); if (!it) return null; const r = it.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, text);

try {
  const screens = await seedAfterLaunch(page, pre);

  // ── A: the page's font ────────────────────────────────────────────────
  await screens['seed:page']();
  await page.waitForTimeout(1_500);
  const fonts = () => page.evaluate(() => { const b = [...document.querySelectorAll('[data-px-surface="canvas"] .tiptap')].find((e) => e.getClientRects().length); return { body: b ? getComputedStyle(b).fontFamily : null, app: getComputedStyle(document.body).fontFamily, drawn: b ? document.fonts.check(`16px ${getComputedStyle(b).fontFamily.split(',')[0]}`) : false }; });
  const f0 = await fonts();
  check('a page on Default is in the app\'s interface face (Hanken Grotesk), not Inter', first(f0.body ?? '') === 'Hanken Grotesk' && first(f0.app) === 'Hanken Grotesk', f0);
  // The app's face changed, as Appearance changes it (it sets this one variable on the window).
  await page.evaluate(() => document.documentElement.style.setProperty('--parallx-fontFamily-ui', "'IBM Plex Mono', monospace"));
  await page.waitForTimeout(300);
  const f1 = await fonts();
  check('the page follows the app\'s face when it changes, without being reopened', first(f1.body ?? '') === 'IBM Plex Mono', f1);
  await page.evaluate(() => document.documentElement.style.removeProperty('--parallx-fontFamily-ui'));
  // Newsreader from the page's own menu.
  const menuBtn = await page.evaluate(() => { const b = [...document.querySelectorAll('[data-px-id="canvas.page.menu"]')].find((e) => e.getClientRects().length); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.click(menuBtn.x, menuBtn.y); await page.waitForTimeout(500);
  const fontRow = await menuItem('Font');
  check('the page\'s menu has Font', !!fontRow, fontRow);
  if (fontRow) { await page.mouse.move(fontRow.x, fontRow.y); await page.mouse.click(fontRow.x, fontRow.y); await page.waitForTimeout(600); }
  const names = await page.evaluate(() => [...document.querySelectorAll('[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]')].filter((e) => e.getClientRects().length).map((e) => (e.textContent || '').trim().replace(/^✓/, '')));
  check('the Font list has Default first, then Newsreader', names.indexOf('Newsreader') === names.indexOf('Default') + 1 && names.includes('Default'), names.slice(0, 24));
  await screenshot(app, page, path.join(shots, 'page-font-menu.png'), { keepFocus: true });
  const nr = await menuItem('Newsreader');
  if (nr) { await page.mouse.move(nr.x, nr.y); await page.mouse.click(nr.x, nr.y); await page.waitForTimeout(900); }
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  const f2 = await fonts();
  check('a page set to Newsreader is drawn in Newsreader, a face the app has', first(f2.body ?? '') === 'Newsreader' && f2.drawn, f2);
  await screenshot(app, page, path.join(shots, 'page-in-newsreader.png'));
  // It is the page's own setting: another page stays on Default.
  await cmd(page, 'canvas.newPage'); await page.waitForTimeout(1_500);
  const f3 = await fonts();
  check('a new page is still on the app\'s face', first(f3.body ?? '') === 'Hanken Grotesk', f3);

  // ── B: the Dashboard's large numbers ──────────────────────────────────
  await cmd(page, 'dashboard.open'); await page.waitForTimeout(1_500);
  const nums = await page.evaluate(() => ['.clw__time', '.cdw__num', '.dtimer__face', '.ypw__stat-n'].map((s) => { const e = [...document.querySelectorAll(s)].find((x) => x.getClientRects().length); if (!e) return { s, shown: false }; const cs = getComputedStyle(e); const w = (t) => { const c = e.cloneNode(false); c.textContent = t; c.style.cssText += ';position:absolute;visibility:hidden;width:auto;flex:none'; e.parentElement.appendChild(c); const x = c.getBoundingClientRect().width; c.remove(); return x; }; return { s, shown: true, font: cs.fontFamily.split(',')[0].replace(/['"]/g, ''), weight: cs.fontWeight, size: cs.fontSize, ones: w('11:11'), zeros: w('00:00'), eights: w('88:88') }; }));
  const shown = nums.filter((n) => n.shown);
  check('the Dashboard shows a large number to measure', shown.length >= 1, nums);
  check('each large number is in the display face at weight 500', shown.every((n) => n.font === 'Newsreader' && n.weight === '500'), shown);
  check('its figures are of one width (11:11, 00:00 and 88:88 take the same room)', shown.every((n) => Math.abs(n.ones - n.zeros) < 0.6 && Math.abs(n.eights - n.zeros) < 0.6), shown.map((n) => [n.s, n.ones, n.zeros, n.eights]));
  await screenshot(app, page, path.join(shots, 'dashboard-numbers.png'));

  // ── C: no text triangles ──────────────────────────────────────────────
  const found = {};
  const look = async (name) => { const t = await triangles(); if (t.length) found[name] = t; };
  await look('dashboard');
  // A dropdown (the kit's), in Settings.
  await cmdNoWait(page, 'settings.open'); await page.waitForTimeout(1_200);
  const dd = await page.evaluate(() => { const c = [...document.querySelectorAll('[aria-modal="true"] .ui-dropdown__chevron')].find((e) => e.getClientRects().length); return c ? { svg: !!c.querySelector('svg'), before: getComputedStyle(c, '::before').content } : null; });
  check('a dropdown\'s mark is the chevron icon', !!dd && dd.svg && (dd.before === 'none' || dd.before === 'normal'), dd);
  await look('settings');
  await screenshot(app, page, path.join(shots, 'settings-dropdown.png'));
  // The AI section's tool groups fold by a chevron button.
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  await cmdNoWait(page, 'settings.open', 'ai'); await page.waitForTimeout(1_500);
  await page.evaluate(() => [...document.querySelectorAll('[data-px-id="aiSettings.nav.tools"]')].find((e) => e.getClientRects().length)?.click()); await page.waitForTimeout(800);
  const folds = await page.evaluate(() => [...document.querySelectorAll('.ai-settings-tools-chevron')].filter((e) => e.getClientRects().length).map((e) => ({ svg: !!e.querySelector('svg'), text: e.textContent.trim(), name: e.getAttribute('aria-label') })));
  check('AI Settings\' tool groups fold by a chevron icon, each named', folds.length > 0 && folds.every((f) => f.svg && !f.text && f.name), folds.slice(0, 3));
  await look('ai settings');
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  // A tool's own page: its sections.
  await cmd(page, 'tools.showInstalled'); await page.waitForTimeout(1_000);
  await page.evaluate(() => [...document.querySelectorAll('.tool-gallery-page .tool-gallery-row')].find((e) => e.getClientRects().length)?.click()); await page.waitForTimeout(1_000);
  await page.evaluate(() => [...document.querySelectorAll('.tool-editor *')].find((e) => e.getClientRects().length && e.children.length === 0 && e.textContent.trim() === 'Feature Contributions')?.click()); await page.waitForTimeout(600);
  const contrib = await page.evaluate(() => [...document.querySelectorAll('.tool-editor-contrib-arrow')].filter((e) => e.getClientRects().length).map((e) => ({ svg: !!e.querySelector('svg'), text: e.textContent.trim() })));
  check('a tool\'s page folds its sections by a chevron icon', contrib.length > 0 && contrib.every((c) => c.svg && !c.text), contrib.slice(0, 3));
  await look('tool page');
  await screenshot(app, page, path.join(shots, 'tool-page-sections.png'));
  // Chat (the seeded conversation) and a database page's property pickers.
  for (const s of ['seed:chat', 'seed:chat.timing', 'seed:database', 'seed:page']) { await screens[s](); await page.waitForTimeout(1_200); await look(s); }
  await screens['seed:chat'](); await page.waitForTimeout(1_000);
  await screenshot(app, page, path.join(shots, 'chat.png'));
  await cmd(page, 'workspaceGraph.open'); await page.waitForTimeout(1_500); await look('workspace graph');
  check('no triangle is drawn as a text character on any of these screens', Object.keys(found).length === 0, found);
} catch (err) {
  console.log(`[probe] stopped: ${err?.stack ?? err}`);
  problems.push('the probe stopped');
  await screenshot(app, page, path.join(shots, 'stopped.png')).catch(() => {});
} finally {
  await app.close().catch(() => {});
}
const real = errors.filter((e) => !/Ollama|EmbeddingService/.test(e));
console.log(`\n[probe] page errors: ${real.length}`);
for (const e of real.slice(0, 8)) console.log('  ' + e);
console.log(`[probe] ${problems.length} problems${problems.length ? ': ' + problems.join('; ') : ''}`);
console.log(`[probe] shots: ${shots}`);
process.exitCode = problems.length ? 1 : 0;
