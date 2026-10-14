// touch-drag-probe.mjs: drags by finger in the real app, never on screen,
// the chat model's port refused (docs/ACCESSIBILITY.md, section 8;
// src/ui/touchDrag.ts). One check for each way a drag starts:
//
// + The workbench divider: a press helper drag (onDragPress), claimed.
// + An editor tab: the browser's drag and drop, held then moved.
// + A table's row grip: a press helper drag on a seeded page.
// + The cover, repositioned: a press helper drag on its overlay.
// + A planner event in the month view: a pointer drag that holds first.
// + A concept map box: a pointer drag that holds first.
// + A dashboard widget's corner: a claimed pointer drag (resize).
// + The image editor's Straighten dial: a claimed pointer drag.
// + A swipe on a page scrolls it and starts nothing (the hold is not up).
//
// Usage: node tests/probes/touch-drag-probe.mjs   (after npm run build)

import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { PROJECT_ROOT, launchApp, cmd, setToolEnabled } from './scene.mjs';
import { seedBeforeLaunch, seedAfterLaunch } from './audit-seed.mjs';

const stamp = Date.now();
const appRoot = path.join(os.tmpdir(), `parallx-touch-root-${stamp}`);
const ws = path.join(os.tmpdir(), `parallx-touch-ws-${stamp}`);
await fs.mkdir(path.join(appRoot, 'data'), { recursive: true });
await fs.mkdir(ws, { recursive: true });
await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: ws }));
await fs.symlink(path.join(PROJECT_ROOT, 'ext'), path.join(appRoot, 'ext'), 'junction');

const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`[probe] ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`); };
const pre = await seedBeforeLaunch(ws);
const { app, page, errors } = await launchApp(appRoot);
try {
  await setToolEnabled(page, 'parallx-community.media-organizer', true);
  await page.waitForTimeout(2_500);
  const screens = await seedAfterLaunch(page, pre);
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  /** A finger from `from`, held `hold` ms, moved by (dx, dy) in ten steps, lifted. */
  const finger = async (from, dx, dy, { hold = 0 } = {}) => {
    await touch('touchStart', from.x, from.y);
    if (hold) await page.waitForTimeout(hold);
    for (let i = 1; i <= 10; i++) { await touch('touchMove', from.x + (dx * i) / 10, from.y + (dy * i) / 10); await page.waitForTimeout(25); }
    await touch('touchEnd');
    await page.waitForTimeout(600);
  };
  const centre = (sel) => page.evaluate((sel) => { const e = Array.from(document.querySelectorAll(sel)).find((x) => x.getClientRects().length && x.getBoundingClientRect().width > 0); if (!e) return null; e.scrollIntoView({ block: 'center', inline: 'center' }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height }; }, sel);

  // 1. The workbench divider.
  const side = () => page.evaluate(() => document.querySelector('[data-part-id="workbench.parts.sidebar"]')?.getBoundingClientRect().width);
  const s0 = await side();
  await finger(await centre('.grid-sash-vertical'), 80, 0);
  const s1 = await side();
  check('a finger drags the sidebar divider', Math.abs(s1 - s0 - 80) <= 2, `${s0} -> ${s1}`);

  // 2. An editor tab, held then moved past the next one.
  await cmd(page, 'welcome.openWelcome');
  await cmd(page, 'dashboard.open');
  await page.waitForTimeout(1_200);
  const tabs = () => page.evaluate(() => Array.from(document.querySelectorAll('.editor-tab-bar .ui-tab')).filter((x) => x.getClientRects().length).map((x) => { const r = x.getBoundingClientRect(); return { name: x.textContent.trim().replace('×', ''), x: r.x + r.width / 2, y: r.y + r.height / 2, right: r.right }; }));
  const t0 = await tabs();
  const wi = t0.findIndex((t) => t.name === 'Welcome');
  const [a, b] = [t0[wi], t0[wi + 1]];
  await finger(a, b.right - 20 - a.x, 0, { hold: 500 });
  const t1 = (await tabs()).map((t) => t.name);
  check('a finger, held then moved, drags a tab past the next one', t1.indexOf(a.name) === t1.indexOf(b.name) + 1, `${t0.map((t) => t.name).join(' | ')} -> ${t1.join(' | ')}`);

  // 3. A table's row grip on the seeded page.
  await screens['seed:page']();
  await page.waitForTimeout(1_500);
  const firstCol = () => page.evaluate(() => Array.from(document.querySelectorAll('[data-px-surface="canvas"] table tr')).filter((r) => r.getClientRects().length).map((r) => r.cells[0]?.textContent.trim()).join(','));
  const rows0 = await firstCol();
  const cell = await centre('[data-px-surface="canvas"] table tr:nth-child(2) td');
  await page.mouse.move(cell.x, cell.y); // the grips draw for the table under the pointer
  await page.waitForTimeout(400);
  const grip = await page.evaluate(() => { const g = Array.from(document.querySelectorAll('.table-grip--row')).find((x) => x.getClientRects().length && x.dataset.index === '1'); if (!g) return null; const r = g.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  if (grip) await finger(grip, 0, cell.h * 1.6);
  const rows1 = await firstCol();
  check('a finger drags a table row by its grip', !!grip && rows1 !== rows0, `${rows0} -> ${rows1}${grip ? '' : ' (no grip)'}`);

  // 3b. A block by its drag handle (the browser's drag and drop): held, then moved below the next block.
  // The place of 'A paragraph with bold text.' among the page's blocks.
  const blocks = () => page.evaluate(() => { const kids = Array.from(document.querySelectorAll('[data-px-surface="canvas"] .tiptap')).find((x) => x.getClientRects().length)?.children ?? []; return Array.from(kids).findIndex((k) => k.textContent.startsWith('A paragraph with')); });
  const b0 = await blocks();
  // No text selected (its formatting menu would sit over the handle): a caret at the end, as a tap leaves it.
  await page.evaluate(() => { const ed = Array.from(document.querySelectorAll('[data-px-surface="canvas"] [contenteditable="true"]')).filter((x) => x.offsetParent).map((x) => x.editor).find(Boolean); ed?.commands.setTextSelection(ed.state.doc.content.size - 1); ed?.commands.blur(); });
  await page.waitForTimeout(300);
  const para = await page.evaluate(() => { const p = Array.from(document.querySelectorAll('[data-px-surface="canvas"] .tiptap > p')).find((x) => x.getClientRects().length && x.textContent.startsWith('A paragraph with')); p.scrollIntoView({ block: 'center' }); const r = p.getBoundingClientRect(); return { x: r.x + 40, y: r.y + r.height / 2 }; });
  await page.mouse.move(para.x, para.y); // the handle draws for the block under the pointer
  await page.waitForTimeout(400);
  const handle = await page.evaluate(() => { const h = Array.from(document.querySelectorAll('.drag-handle')).find((x) => x.getClientRects().length && getComputedStyle(x).visibility !== 'hidden'); if (!h) return null; const r = h.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  if (handle) await finger(handle, 0, 140, { hold: 500 });
  const b1 = await blocks();
  check('a finger, held then moved, drags a block by its handle', !!handle && b1 > b0, `block at ${b0} -> ${b1}${handle ? '' : ' (no handle)'}`);

  // 4. The cover, repositioned.
  await page.evaluate(() => Array.from(document.querySelectorAll('[data-px-id="canvas.cover.reposition"]')).find((x) => x.isConnected)?.click());
  await page.waitForTimeout(500);
  const pos = () => page.evaluate(() => Array.from(document.querySelectorAll('.canvas-page-cover')).find((x) => x.getClientRects().length)?.style.backgroundPosition ?? '');
  const p0 = await pos();
  const overlay = await centre('.canvas-cover-reposition-overlay');
  if (overlay) await finger(overlay, 0, 40);
  const p1 = await pos();
  check('a finger repositions the cover', !!overlay && p1 !== p0, `${p0} -> ${p1}`);
  await page.keyboard.press('Escape');

  // 5. A planner event in the month view: held, then moved a day.
  const events = () => page.evaluate(async () => { const reg = await window.__parallx_workbench__._services.get({ id: 'ICommandService' }).executeCommand('planner.getRegistry'); const d = new Date(); const list = await reg.data.listEvents({ from: d.getTime() - 40 * 86_400_000, to: d.getTime() + 40 * 86_400_000 }); return Object.fromEntries(list.map((e) => [e.title, e.startAt])); });
  await cmd(page, 'planner.open');
  await page.waitForTimeout(800);
  await page.evaluate(() => Array.from(document.querySelectorAll('[data-px-id="planner.tab.calendar"]')).find((x) => x.getClientRects().length)?.click());
  await page.waitForTimeout(1_200);
  const e0 = await events();
  const chip = await page.evaluate(() => { const c = Array.from(document.querySelectorAll('.planner-month__chip')).find((x) => x.getClientRects().length && x.textContent.includes('Seeded meeting')); if (!c) return null; const cellEl = c.closest('[class*="planner-month__cell"]') || c.parentElement; const r = c.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, cellW: cellEl.getBoundingClientRect().width }; });
  if (chip) await finger(chip, chip.cellW, 0, { hold: 500 });
  const e1 = await events();
  check('a finger, held then moved, moves a planner event a day', !!chip && e1['Seeded meeting'] - e0['Seeded meeting'] === 86_400_000, `${chip ? '' : 'no chip; '}${(e1['Seeded meeting'] - e0['Seeded meeting']) / 3_600_000} h`);

  // 6. A concept map box: held, then moved.
  await screens['seed:conceptMap']();
  await page.waitForTimeout(1_500);
  const boxAt = () => page.evaluate(() => { const g = Array.from(document.querySelectorAll('.canvas-conceptmap .parallx-mindmap__node')).find((x) => x.getAttribute('data-mindmap-label') === 'Cape Cod'); const r = g?.querySelector('.parallx-mindmap__box')?.getBoundingClientRect(); return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; });
  const m0 = await boxAt();
  if (m0) await finger(m0, 60, 60, { hold: 500 });
  const m1 = await boxAt();
  check('a finger, held then moved, moves a concept map box', !!m0 && !!m1 && Math.hypot(m1.x - m0.x, m1.y - m0.y) > 20, `${JSON.stringify(m0)} -> ${JSON.stringify(m1)}`);

  // 7. A dashboard widget's corner.
  await cmd(page, 'dashboard.open');
  await page.waitForTimeout(1_200);
  const widget = () => page.evaluate(() => { const w = Array.from(document.querySelectorAll('.dashboard-widget')).find((x) => x.getClientRects().length); return w ? w.getBoundingClientRect().width : null; });
  const w0 = await widget();
  // A finger shows a widget's handles as a phone does: tap the widget, then drag a corner.
  const wBody = await page.evaluate(() => { const w = Array.from(document.querySelectorAll('.dashboard-widget')).find((x) => x.getClientRects().length); const r = w.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height - 12 }; });
  await touch('touchStart', wBody.x, wBody.y); await touch('touchEnd'); await page.waitForTimeout(400);
  const corner = await page.evaluate(() => { const w = Array.from(document.querySelectorAll('.dashboard-widget')).find((x) => x.getClientRects().length); const h = w?.querySelector('.dashboard-widget__resize--se, .dashboard-widget__resize--e'); if (!h) return null; const r = h.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  if (corner) await finger(corner, 160, 0);
  const w1 = await widget();
  check('a finger resizes a dashboard widget', !!corner && w1 !== w0, `${w0} -> ${w1}${corner ? '' : ' (no corner)'}`);

  // 8. The image editor's Straighten dial.
  await screens['seed:imageEditor']();
  await page.waitForSelector('.mo-edit-stage', { timeout: 30_000 });
  await page.waitForTimeout(2_000);
  await page.evaluate(() => Array.from(document.querySelectorAll('[data-px-id="media-organizer.imageEditor.tool.crop"]')).find((x) => x.getClientRects().length)?.click());
  await page.waitForTimeout(800);
  const dialVal = () => page.evaluate(() => Array.from(document.querySelectorAll('.mo-edit-dial')).find((x) => x.getClientRects().length)?.getAttribute('aria-valuenow'));
  const d0 = await dialVal();
  const dial = await centre('.mo-edit-dial');
  if (dial) await finger(dial, Math.min(120, dial.w / 3), 0);
  const d1 = await dialVal();
  check('a finger turns the Straighten dial', !!dial && d1 !== d0, `${d0} -> ${d1}`);

  // 9. A swipe on a page scrolls and starts nothing.
  await screens['seed:page']();
  await page.waitForTimeout(1_200);
  const scrollOf = () => page.evaluate(() => { const s = Array.from(document.querySelectorAll('[data-px-surface="canvas"] *')).find((x) => x.getClientRects().length && x.scrollHeight > x.clientHeight + 20 && /auto|scroll/.test(getComputedStyle(x).overflowY)); return s ? s.scrollTop : null; });
  const sc0 = await scrollOf();
  const body = await centre('[data-px-surface="canvas"] .tiptap p:last-of-type');
  if (body) await finger(body, 0, -200);
  const sc1 = await scrollOf();
  const marquee = await page.evaluate(() => !!Array.from(document.querySelectorAll('.block-marquee, [class*="marquee"]')).find((x) => x.getClientRects().length && x.getBoundingClientRect().width > 4));
  check('a swipe on a page scrolls it and draws no selection box', sc0 !== null && sc1 !== sc0 && !marquee, `scroll ${sc0} -> ${sc1}, box ${marquee}`);
  console.log(`[probe] renderer errors: ${errors.length ? errors.join(' | ') : 'none'}`);
} catch (err) {
  check('the run', false, err && err.message);
} finally {
  await app.close().catch(() => {});
  await fs.rm(appRoot, { recursive: true, force: true }).catch(() => {});
  await fs.rm(ws, { recursive: true, force: true }).catch(() => {});
}
const ok = results.every(Boolean);
console.log(ok ? '[probe] touch drags: all ok' : '[probe] touch drags: FAILED');
process.exit(ok ? 0 : 1);
