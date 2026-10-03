// reduce-motion-probe.mjs — Settings › Appearance › Reduce Motion, in the built app.
//
// New profile under test-results/. Turns the switch on through Settings and
// reads what the engine would animate: a kit button's transition and the
// command palette's entrance. Both run at their token durations with the
// switch off and are stilled with it on, and come back when it is off again.
//   node scripts/build.mjs && xvfb-run -a node tests/probes/reduce-motion-probe.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright';

const repo = path.resolve(import.meta.dirname, '../..');
const root = await fs.mkdtemp(path.join(repo, 'test-results', 'reduce-motion-'));
const appRoot = path.join(root, 'app');
const workspace = path.join(root, 'workspace');
for (const d of [path.join(appRoot, 'data/chromium-cache'), path.join(workspace, '.parallx')]) await fs.mkdir(d, { recursive: true });
await fs.writeFile(path.join(appRoot, 'data/last-workspace.json'), JSON.stringify({ path: workspace }));
const env = { ...process.env, PARALLX_TEST_MODE: '1', PARALLX_RENDERER_PORT: '0', PARALLX_APP_ROOT: appRoot, PARALLX_USER_DATA: path.join(appRoot, 'data/chromium-cache') };
delete env.ELECTRON_RUN_AS_NODE;
const results = [];
const check = (label, ok, detail) => { results.push(ok); console.log(`[probe] ${ok ? 'ok  ' : 'FAIL'} ${label}${detail !== undefined ? ` ${JSON.stringify(detail)}` : ''}`); };
const app = await electron.launch({ args: ['.', '--no-sandbox', '--disable-gpu'], cwd: repo, env, timeout: 90000 });
try {
  const page = await app.firstWindow();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.waitForSelector('.parallx-ready', { state: 'attached', timeout: 120000 });
  await page.waitForFunction(() => !!window.__parallx_workbench__?._services, null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  const motion = () => page.evaluate(() => {
    const btn = document.createElement('button'); btn.className = 'px-btn'; document.body.appendChild(btn);
    const palette = document.createElement('div'); palette.className = 'command-palette'; document.body.appendChild(palette);
    const out = { button: getComputedStyle(btn).transitionDuration.split(',')[0].trim(), palette: getComputedStyle(palette).animationDuration };
    btn.remove(); palette.remove();
    return out;
  });
  const switchOn = () => page.click('[role="switch"][aria-label="Reduce Motion"]');

  const before = await motion();
  check('switch off: a button transitions and the palette animates', before.button !== '0s' && parseFloat(before.button) > 0.01 && parseFloat(before.palette) > 0.01, before);
  await page.evaluate(() => window.__parallx_workbench__._services.get({ id: 'ICommandService' }).executeCommand('settings.openAppearance'));
  await page.waitForSelector('[role="switch"][aria-label="Reduce Motion"]', { timeout: 15000 });
  await switchOn();
  await page.waitForTimeout(200);
  const on = await motion();
  check('switch on: both are stilled', parseFloat(on.button) < 0.001 && parseFloat(on.palette) < 0.001, on);
  check('saved, and the root carries data-px-motion', (JSON.parse(await fs.readFile(path.join(appRoot, 'data/appearance.json'), 'utf8')).reduceMotion === true) && (await page.evaluate(() => document.documentElement.getAttribute('data-px-motion'))) === 'reduced');
  await switchOn();
  await page.waitForTimeout(200);
  const off = await motion();
  check('switch off again: motion is back', parseFloat(off.button) > 0.01 && parseFloat(off.palette) > 0.01, off);
} finally {
  await app.close().catch(() => {});
}
console.log(`[probe] ${results.filter(Boolean).length}/${results.length} checks passed`);
