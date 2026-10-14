// touch-drag-probe.mjs: drags by finger in the real app, never on screen,
// the chat model's port refused (docs/ACCESSIBILITY.md, section 8;
// src/ui/touchDrag.ts).
//
// + The sidebar's divider follows a finger as it follows the mouse.
// + An editor tab, held a moment and moved past the next tab's middle,
//   lands after it (the browser's drag and drop, from a finger).
//
// Usage: node tests/probes/touch-drag-probe.mjs   (after npm run build)

import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { launchApp, cmd } from './scene.mjs';

const stamp = Date.now();
const appRoot = path.join(os.tmpdir(), `parallx-touch-root-${stamp}`);
const ws = path.join(os.tmpdir(), `parallx-touch-ws-${stamp}`);
await fs.mkdir(path.join(appRoot, 'data'), { recursive: true });
await fs.mkdir(ws, { recursive: true });
await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: ws }));

const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`[probe] ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`); };
const { app, page, errors } = await launchApp(appRoot);
try {
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  const fingerDrag = async (from, dx, { hold = 0 } = {}) => {
    await touch('touchStart', from.x, from.y);
    if (hold) await page.waitForTimeout(hold);
    for (let i = 1; i <= 10; i++) { await touch('touchMove', from.x + (dx * i) / 10, from.y); await page.waitForTimeout(25); }
    await touch('touchEnd');
    await page.waitForTimeout(400);
  };

  // The sidebar's divider.
  const sash = () => page.evaluate(() => {
    const s = Array.from(document.querySelectorAll('.grid-sash-vertical')).find((x) => x.getClientRects().length);
    const r = s?.getBoundingClientRect();
    return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2, side: document.querySelector('[data-part-id="workbench.parts.sidebar"]')?.getBoundingClientRect().width } : null;
  });
  const s0 = await sash();
  await fingerDrag(s0, 80);
  const s1 = await sash();
  check('a finger drags the sidebar divider', !!s1 && Math.abs(s1.side - s0.side - 80) <= 2, `${s0?.side} -> ${s1?.side}`);

  // An editor tab, by the browser's drag and drop.
  await cmd(page, 'welcome.openWelcome');
  await cmd(page, 'dashboard.open');
  await page.waitForTimeout(1_200);
  const tabs = () => page.evaluate(() => Array.from(document.querySelectorAll('.editor-tab-bar .ui-tab')).filter((x) => x.getClientRects().length).map((x) => { const r = x.getBoundingClientRect(); return { name: x.textContent.trim().replace('×', ''), x: r.x + r.width / 2, y: r.y + r.height / 2, right: r.right }; }));
  const t0 = await tabs();
  const [first, second] = t0;
  await fingerDrag(first, second.right - 20 - first.x, { hold: 500 });
  const t1 = (await tabs()).map((t) => t.name);
  check('a finger, held then moved, drags a tab past the next one', t1[0] === second.name && t1[1] === first.name, `${t0.map((t) => t.name).join(' | ')} -> ${t1.join(' | ')}`);
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
