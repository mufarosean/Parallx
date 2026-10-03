// color-theme-retired-probe.mjs — the Ctrl+T picker is retired, in the built app.
//
// New profile under test-results/ seeded as someone who once picked High
// Contrast Dark. Checks: the app opens dark with Increase Contrast on and
// stores Dark Modern in its place; Ctrl+T opens no picker; Preferences:
// Color Theme… opens Settings on Appearance.
//   node scripts/build.mjs && xvfb-run -a node tests/probes/color-theme-retired-probe.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright';

const repo = path.resolve(import.meta.dirname, '../..');
const root = await fs.mkdtemp(path.join(repo, 'test-results', 'color-theme-'));
const appRoot = path.join(root, 'app');
const workspace = path.join(root, 'workspace');
for (const d of [path.join(appRoot, 'data/chromium-cache'), path.join(workspace, '.parallx')]) await fs.mkdir(d, { recursive: true });
await fs.writeFile(path.join(appRoot, 'data/last-workspace.json'), JSON.stringify({ path: workspace }));
await fs.writeFile(path.join(appRoot, 'data/global-storage.json'), JSON.stringify({ 'parallx.colorTheme': 'parallx-hc-dark' }));
const env = { ...process.env, PARALLX_TEST_MODE: '1', PARALLX_RENDERER_PORT: '0', PARALLX_APP_ROOT: appRoot, PARALLX_USER_DATA: path.join(appRoot, 'data/chromium-cache') };
delete env.ELECTRON_RUN_AS_NODE;
const results = [];
const check = (label, ok, detail) => { results.push(ok); console.log(`[probe] ${ok ? 'ok  ' : 'FAIL'} ${label}${detail !== undefined ? ` ${JSON.stringify(detail)}` : ''}`); };
const app = await electron.launch({ args: ['.', '--no-sandbox', '--disable-gpu'], cwd: repo, env, timeout: 90000 });
try {
  const page = await app.firstWindow();
  await page.waitForSelector('.parallx-ready', { state: 'attached', timeout: 120000 });
  await page.waitForFunction(() => !!window.__parallx_workbench__?._services, null, { timeout: 60000 });
  await page.waitForTimeout(2000);
  const root$ = await page.evaluate(() => ({ contrast: document.documentElement.getAttribute('data-px-contrast'), mode: document.documentElement.getAttribute('data-px-mode') }));
  const appearance = JSON.parse(await fs.readFile(path.join(appRoot, 'data/appearance.json'), 'utf8'));
  const stored = JSON.parse(await fs.readFile(path.join(appRoot, 'data/global-storage.json'), 'utf8'))['parallx.colorTheme'];
  check('a stored High Contrast Dark opens dark with Increase Contrast on', root$.contrast === 'more' && root$.mode === null && appearance.increaseContrast === true && appearance.mode === 'dark', { root$, appearance: { mode: appearance.mode, increaseContrast: appearance.increaseContrast } });
  check('and Dark Modern is stored in its place', stored === 'parallx-dark-modern', stored);

  await page.locator('[data-part-id="workbench.parts.statusbar"], .statusbar').first().click({ position: { x: 500, y: 8 } }).catch(() => {});
  await page.keyboard.press('Control+t');
  await page.waitForTimeout(600);
  const picker = await page.evaluate(() => [...document.querySelectorAll('input')].some((i) => /color theme/i.test(i.placeholder || '')));
  check('Ctrl+T opens no theme picker', !picker);
  await page.keyboard.press('Escape');

  await page.evaluate(() => window.__parallx_workbench__._services.get({ id: 'ICommandService' }).executeCommand('workbench.action.selectTheme'));
  await page.waitForTimeout(1200);
  const active = await page.evaluate(() => document.querySelector('.settings-editor__nav-item--active')?.textContent?.trim() ?? null);
  check('Preferences: Color Theme… opens Settings on Appearance', active === 'Appearance', active);
  const listed = await page.evaluate(() => [...window.__parallx_workbench__._services.get({ id: 'ICommandService' }).getCommands().values()].find((c) => c.id === 'workbench.action.selectTheme')?.title);
  check('its palette title reads Color Theme…', listed === 'Color Theme…', listed);
} finally {
  await app.close().catch(() => {});
}
console.log(`[probe] ${results.filter(Boolean).length}/${results.length} checks passed`);
