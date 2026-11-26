// pdf-viewer-probe.mjs — the PDF viewer shows the page lifted on a darker
// ground, with its controls in one pill at the foot (the look's piece 7).
//
//   node scripts/build.mjs && xvfb-run -a node tests/probes/pdf-viewer-probe.mjs [outDir]
import fs from 'node:fs/promises';
import path from 'node:path';
import { PROJECT_ROOT, launchApp, cmd, openFile, tinyPdf, screenshot } from './scene.mjs';

await fs.mkdir(path.join(PROJECT_ROOT, 'test-results'), { recursive: true });
const root = process.argv[2] ? path.resolve(process.argv[2]) : await fs.mkdtemp(path.join(PROJECT_ROOT, 'test-results', 'pdf-viewer-'));
await fs.rm(root, { recursive: true, force: true });
const appRoot = path.join(root, 'app'); const ws = path.join(root, 'workspace'); const shots = path.join(root, 'shots');
for (const d of [path.join(appRoot, 'data'), ws, shots]) await fs.mkdir(d, { recursive: true });
await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: ws }));
await fs.writeFile(path.join(ws, 'probe-paper.pdf'), tinyPdf('The page of a probe'));

const problems = [];
const check = (name, ok, got) => { console.log(`${ok ? '  ok ' : ' FAIL'} ${name}${ok ? '' : `: ${JSON.stringify(got)}`}`); if (!ok) problems.push(name); };
const { app, page, errors } = await launchApp(appRoot);
const lum = (c) => { const m = c.match(/[\d.]+/g).map(Number); return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]; };
const read = () => page.evaluate(() => {
  const pane = [...document.querySelectorAll('.pdf-editor-pane')].find((e) => e.getClientRects().length);
  if (!pane) return null;
  const bar = pane.querySelector('.pdf-toolbar'); const b = bar.getBoundingClientRect(); const p = pane.getBoundingClientRect();
  const sheet = pane.querySelector('.pdfViewer .page .canvasWrapper'); const s = sheet?.getBoundingClientRect();
  const controls = [...bar.querySelectorAll('button, input, [role="button"]')].filter((e) => e.getClientRects().length).map((e) => { const r = e.getBoundingClientRect(); return { name: e.getAttribute('aria-label') || e.title || e.textContent.trim(), inPane: r.left >= p.left - 1 && r.right <= p.right + 1 && r.bottom <= p.bottom + 1, h: Math.round(r.height), w: Math.round(r.width) }; });
  const probe = document.createElement('div'); probe.style.cssText = 'background: var(--px-bg); position: fixed; width: 1px; height: 1px'; document.body.appendChild(probe); const paper = getComputedStyle(probe).backgroundColor; probe.remove();
  return {
    bar: { top: Math.round(b.top), bottom: Math.round(b.bottom), centre: Math.round(b.left + b.width / 2), w: Math.round(b.width), h: Math.round(b.height), radius: parseFloat(getComputedStyle(bar).borderTopLeftRadius), shadow: getComputedStyle(bar).boxShadow !== 'none' },
    pane: { top: Math.round(p.top), bottom: Math.round(p.bottom), centre: Math.round(p.left + p.width / 2), w: Math.round(p.width) },
    ground: getComputedStyle(pane.querySelector('.pdf-viewer-container')).backgroundColor, paper,
    sheet: s ? { bg: getComputedStyle(pane.querySelector('.pdfViewer .page')).backgroundColor, shadow: getComputedStyle(sheet).boxShadow !== 'none', top: Math.round(s.top), bottom: Math.round(s.bottom) } : null,
    controls,
  };
});
try {
  await openFile(page, 'probe-paper.pdf');
  await page.waitForSelector('.pdf-editor-pane .pdfViewer .page', { timeout: 30_000 });
  await page.waitForTimeout(1_500);
  let v = await read();
  check('the PDF is open, with its page drawn', !!v?.sheet, v);
  check('the controls are one pill at the foot of the pane, centred', v.bar.bottom <= v.pane.bottom && v.pane.bottom - v.bar.bottom <= 24 && v.bar.top > v.pane.top + (v.pane.bottom - v.pane.top) / 2 && Math.abs(v.bar.centre - v.pane.centre) <= 2 && v.bar.radius >= v.bar.h / 2 && v.bar.shadow, v.bar);
  check('every control of the pill is inside the pane', v.controls.length >= 6 && v.controls.every((c) => c.inPane), v.controls.filter((c) => !c.inPane));
  check('the ground is darker than the app\'s paper, and the sheet is still white and lifted', lum(v.ground) < lum(v.paper) && v.sheet.bg === 'rgb(255, 255, 255)' && v.sheet.shadow, { ground: v.ground, paper: v.paper, sheet: v.sheet });
  await screenshot(app, page, path.join(shots, 'pdf.png'));
  // By keys: Tab from the tab strip comes to the pill's controls; each shows where it is.
  await page.evaluate(() => [...document.querySelectorAll('.pdf-toolbar button')].find((e) => e.getClientRects().length && !e.disabled)?.focus());
  await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
  const f = await page.evaluate(() => { const a = document.activeElement; const c = getComputedStyle(a); return { inBar: !!a.closest('.pdf-toolbar'), ring: `${c.outlineStyle} ${c.outlineWidth} ${c.boxShadow}` }; });
  check('a control of the pill reached by Tab shows a focus ring', f.inBar && !/^none 0px none$/.test(f.ring), f);
  // A menu opened from the pill stays inside the window.
  const menuBtn = await page.evaluate(() => { const b = [...document.querySelectorAll('.pdf-toolbar button')].filter((e) => e.getClientRects().length).find((e) => (e.getAttribute('aria-label') || e.title || '') === 'Zoom Presets'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, name: 'Zoom Presets' }; });
  if (menuBtn) {
    await page.mouse.click(menuBtn.x, menuBtn.y); await page.waitForTimeout(500);
    const m = await page.evaluate(() => { const e = [...document.querySelectorAll('[data-px-surface="contextMenu"], [role="menu"], .ui-dropdown__list')].filter((x) => x.getClientRects().length).pop(); if (!e) return null; const r = e.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight, items: e.querySelectorAll('[role^="menuitem"], [role="option"]').length }; });
    check(`the menu of "${menuBtn.name}" opens whole inside the window`, !!m && m.top >= 0 && m.bottom <= m.vh && m.items > 0, m);
    await screenshot(app, page, path.join(shots, 'pdf-menu.png'), { keepFocus: true });
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  } else check('a menu of the pill was found to open', false, await page.evaluate(() => [...document.querySelectorAll('.pdf-toolbar button')].map((b) => `${b.getAttribute('aria-label') || b.title}|${b.getAttribute('aria-haspopup')}`)));
  // Find opens at the top, clear of the pill.
  await page.keyboard.press('Control+f'); await page.waitForTimeout(600);
  const find = await page.evaluate(() => { const s = [...document.querySelectorAll('.pdf-editor-pane [class*="search"], .find-widget, [data-px-surface*="find"]')].filter((e) => e.getClientRects().length && e.querySelector('input'))[0]; const b = document.querySelector('.pdf-toolbar').getBoundingClientRect(); if (!s) return null; const r = s.getBoundingClientRect(); return { bottom: Math.round(r.bottom), barTop: Math.round(b.top) }; });
  check('Find opens clear of the pill', !!find && find.bottom < find.barTop, find);
  await page.keyboard.press('Escape');
  // The end of the document scrolls clear of the pill.
  await page.evaluate(() => { const c = document.querySelector('.pdf-editor-pane .pdf-viewer-container'); c.scrollTop = c.scrollHeight; });
  await page.waitForTimeout(500);
  v = await read();
  check('scrolled to the end, the sheet\'s foot is above the pill', v.sheet.bottom <= v.bar.top, { sheet: v.sheet, bar: v.bar });
  // A narrow window: the pill never reaches past the pane.
  await page.setViewportSize({ width: 620, height: 900 }); await page.waitForTimeout(700);
  v = await read();
  const inside = await page.evaluate(() => { const pane = [...document.querySelectorAll('.pdf-editor-pane')].find((e) => e.getClientRects().length).getBoundingClientRect(); const b = document.querySelector('.pdf-toolbar').getBoundingClientRect(); return { left: Math.round(b.left - pane.left), right: Math.round(pane.right - b.right), pane: Math.round(pane.width), bar: Math.round(b.width) }; });
  check('in a narrow pane the pill stays inside the pane', inside.left >= 0 && inside.right >= 0, inside);
  await screenshot(app, page, path.join(shots, 'pdf-narrow.png'));
  await page.setViewportSize({ width: 1400, height: 900 }); await page.waitForTimeout(500);
  // Light.
  await cmd(page, 'settings.openAppearance'); await page.waitForTimeout(800);
  await page.evaluate(() => [...document.querySelectorAll('[data-px-id="appearance.mode.light"]')].find((e) => e.getClientRects().length)?.click());
  await page.waitForTimeout(800); await page.keyboard.press('Escape'); await page.waitForTimeout(500);
  v = await read();
  check('in light too the ground is darker than the paper', lum(v.ground) < lum(v.paper), { ground: v.ground, paper: v.paper });
  await screenshot(app, page, path.join(shots, 'pdf-light.png'));
} catch (err) {
  console.log(`[probe] stopped: ${err?.stack ?? err}`); problems.push('the probe stopped');
  await screenshot(app, page, path.join(shots, 'stopped.png')).catch(() => {});
} finally { await app.close().catch(() => {}); }
const real = errors.filter((e) => !/Ollama|EmbeddingService/.test(e));
console.log(`\n[probe] page errors: ${real.length}`); for (const e of real.slice(0, 6)) console.log('  ' + e);
console.log(`[probe] ${problems.length} problems${problems.length ? ': ' + problems.join('; ') : ''}`);
console.log(`[probe] shots: ${shots}`);
process.exitCode = problems.length || real.length ? 1 : 0;
