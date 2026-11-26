// dialog-keys-probe.mjs — an open dialog never loses the keyboard, and the
// command palette's arrows reach every row and keep it in view.
//
// The faults behind the keyboard audit's counts on 2026-11-26: the palette
// did not scroll to its highlighted row and, with the pointer resting over
// the list, jumped back to the row under it; a dialog whose focused control
// was redrawn (Settings' list of sections) or that was pressed on plain
// words left the focus on the window, where Escape closed nothing.
//
//   node scripts/build.mjs && xvfb-run -a node tests/probes/dialog-keys-probe.mjs
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { launchApp, cmdNoWait } from './scene.mjs';

const stamp = Date.now();
const appRoot = path.join(os.tmpdir(), `parallx-dialog-keys-${stamp}`);
const ws = path.join(os.tmpdir(), `parallx-dialog-keys-ws-${stamp}`);
await fs.mkdir(path.join(appRoot, 'data'), { recursive: true });
await fs.mkdir(ws, { recursive: true });
await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: ws }));

const problems = [];
const check = (name, ok, got) => { console.log(`${ok ? '  ok ' : ' FAIL'} ${name}${ok ? '' : `: ${JSON.stringify(got)}`}`); if (!ok) problems.push(name); };
const { app, page } = await launchApp(appRoot);
const palette = () => page.evaluate(() => {
  const l = document.querySelector('.command-palette-list');
  if (!l || !l.getClientRects().length) return null;
  const rows = [...l.querySelectorAll('.command-palette-item')];
  const i = rows.findIndex((r) => r.classList.contains('selected'));
  const r = rows[i]?.getBoundingClientRect(); const lr = l.getBoundingClientRect();
  return { i, n: rows.length, inView: !!r && r.top >= lr.top - 1 && r.bottom <= lr.bottom + 1, x: lr.x + lr.width / 2, y: lr.y + lr.height / 2, scrolls: l.scrollHeight > l.clientHeight + 2 };
});
const dialogOpen = () => page.evaluate(() => !![...document.querySelectorAll('[aria-modal="true"]')].find((e) => e.getClientRects().length));
const focusOn = () => page.evaluate(() => { const a = document.activeElement; return a ? `${a.tagName.toLowerCase()}${a.getAttribute('data-px-id') ? '#' + a.getAttribute('data-px-id') : ''}` : 'nothing'; });

try {
  // The palette, the pointer away from it and then resting over it.
  for (const where of ['away from the list', 'resting over the list']) {
    await cmdNoWait(page, 'workbench.action.showCommands');
    await page.waitForTimeout(700);
    const p0 = await palette();
    if (where.startsWith('resting')) await page.mouse.move(p0.x, p0.y); else await page.mouse.move(5, 5);
    await page.waitForTimeout(200);
    const start = (await palette()).i;
    const seen = []; let outOfView = 0;
    for (let k = 0; k < p0.n + 3; k++) { await page.keyboard.press('ArrowDown'); await page.waitForTimeout(110); const s = await palette(); seen.push(s.i); if (!s.inView) outOfView++; }
    const want = Array.from({ length: p0.n + 3 }, (_, k) => Math.min(p0.n - 1, start + 1 + k));
    check(`the palette has more rows than fit (${p0.n})`, p0.scrolls, p0);
    check(`pointer ${where}: Arrow Down walks every row to the last, one at a time`, seen.join() === want.join(), seen.join(' '));
    check(`pointer ${where}: the highlighted row is in view at every step`, outOfView === 0, outOfView);
    for (let k = 0; k < p0.n + 2; k++) { await page.keyboard.press('ArrowUp'); await page.waitForTimeout(60); }
    const top = await palette();
    check(`pointer ${where}: Arrow Up comes back to the first row, in view`, top.i === 0 && top.inView, top);
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    check(`pointer ${where}: Escape closes the palette`, !(await palette()));
  }
  // A pointer that does move still chooses the row under it.
  await cmdNoWait(page, 'workbench.action.showCommands'); await page.waitForTimeout(700);
  const row3 = await page.evaluate(() => { const r = document.querySelectorAll('.command-palette-item')[3].getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.move(row3.x - 30, row3.y - 2); await page.mouse.move(row3.x, row3.y); await page.waitForTimeout(200);
  check('a pointer moved onto a row highlights it', (await palette()).i === 3, (await palette()).i);

  // The palette pressed on words that take no focus, then the keyboard.
  await page.evaluate(() => document.activeElement?.blur());
  check('with the focus fallen to the window, the palette is still open', !!(await palette()) && (await focusOn()) === 'body', await focusOn());
  await page.keyboard.press('Tab'); await page.waitForTimeout(150);
  check('Tab brings the focus back into the palette, not the page behind', (await focusOn()) === 'input#quickAccess.input', await focusOn());
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  check('Escape from there closes it', !(await palette()));

  // Settings: a press on a section in its list, then Escape.
  await cmdNoWait(page, 'settings.open'); await page.waitForTimeout(1_200);
  const nav = await page.evaluate(() => [...document.querySelectorAll('[aria-modal="true"] [data-px-id^="settings.nav."]')].filter((e) => e.getClientRects().length).map((e) => { const r = e.getBoundingClientRect(); return { id: e.getAttribute('data-px-id'), x: r.x + r.width / 2, y: r.y + r.height / 2 }; }));
  check('Settings lists its sections', nav.length > 5, nav.length);
  await page.mouse.click(nav[2].x, nav[2].y); await page.waitForTimeout(500);
  check('a press on a section leaves the focus on that section', (await focusOn()) === `button#${nav[2].id}`, await focusOn());
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  check('Escape then closes Settings', !(await dialogOpen()));
  await cmdNoWait(page, 'settings.open'); await page.waitForTimeout(900);
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('Tab'); await page.waitForTimeout(150);
  check('Settings with the focus on the window: Tab goes into the dialog', await page.evaluate(() => !!document.activeElement?.closest('[aria-modal="true"]')), await focusOn());
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  check('and Escape closes it', !(await dialogOpen()));
} catch (err) {
  console.log(`[probe] stopped: ${err?.stack ?? err}`); problems.push('the probe stopped');
} finally {
  await app.close().catch(() => {});
  await fs.rm(appRoot, { recursive: true, force: true }).catch(() => {});
  await fs.rm(ws, { recursive: true, force: true }).catch(() => {});
}
console.log(`[probe] ${problems.length} problems${problems.length ? ': ' + problems.join('; ') : ''}`);
process.exitCode = problems.length ? 1 : 0;
