// text-size-probe.mjs — Settings › Appearance › Text size in the built app.
//
// New profile and workspace under test-results/. Checks: the keys step the
// window's zoom and save it; Ctrl+0 still focuses the side bar; inside a
// worksheet's sheet Ctrl+= zooms the cells, not the app; the size survives a
// restart (main opens the window at it); the Appearance page and the View
// menu offer it; Electron's own zoom shortcuts are gone from its menu.
//   node scripts/build.mjs && xvfb-run -a node tests/probes/text-size-probe.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright';

const repo = path.resolve(import.meta.dirname, '../..');
const root = await fs.mkdtemp(path.join(repo, 'test-results', 'text-size-'));
const appRoot = path.join(root, 'app');
const workspace = path.join(root, 'workspace');
const shots = path.join(root, 'shots');
for (const d of [path.join(appRoot, 'data/chromium-cache'), path.join(workspace, '.parallx'), shots]) await fs.mkdir(d, { recursive: true });
await fs.writeFile(path.join(appRoot, 'data/last-workspace.json'), JSON.stringify({ path: workspace }));
await fs.writeFile(path.join(workspace, '.parallx/ai-config.json'), JSON.stringify({ overrides: { indexing: { autoIndex: false, watchFiles: false }, suggestions: { suggestionsEnabled: false }, heartbeat: { enabled: false } } }));
const env = { ...process.env, PARALLX_TEST_MODE: '1', PARALLX_RENDERER_PORT: '0', PARALLX_APP_ROOT: appRoot, PARALLX_USER_DATA: path.join(appRoot, 'data/chromium-cache') };
delete env.ELECTRON_RUN_AS_NODE;

const results = [];
const check = (label, ok, detail) => { results.push({ label, ok }); console.log(`[probe] ${ok ? 'ok  ' : 'FAIL'} ${label}${detail !== undefined ? ` (${JSON.stringify(detail)})` : ''}`); };

async function launch() {
  const app = await electron.launch({ args: ['.', '--no-sandbox', '--disable-gpu'], cwd: repo, env, timeout: 90000 });
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(1280, 800); });
  await page.waitForSelector('.parallx-ready', { state: 'attached', timeout: 120000 });
  await page.waitForFunction(() => !!window.__parallx_workbench__?._services, null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  return { app, page };
}
// The whole window as drawn (Playwright's own screenshot crops to its CSS
// viewport, which shrinks as the zoom grows).
const shot = async (app, file) => {
  const b64 = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
  await fs.writeFile(path.join(shots, file), Buffer.from(b64, 'base64'));
};
const zoom = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor());
const saved = async () => { try { return JSON.parse(await fs.readFile(path.join(appRoot, 'data/appearance.json'), 'utf8')).textSize ?? 1; } catch { return 'no file'; } };
const press = async (page, keys) => { await page.locator('.statusbar, [data-part-id="workbench.parts.statusbar"]').first().click({ position: { x: 600, y: 8 } }).catch(() => {}); await page.keyboard.press(keys); await page.waitForTimeout(400); };

let { app, page } = await launch();
try {
  const menu = await app.evaluate(({ Menu }) => JSON.stringify(Menu.getApplicationMenu()?.items.map((i) => i.submenu?.items.map((s) => s.role)).flat()));
  check('Electron menu has no zoom shortcuts', !/zoomin|zoomout|resetzoom/.test(menu), menu);
  check('opens at 100%', (await zoom(app)) === 1, await zoom(app));
  await press(page, 'Control+Equal');
  check('Ctrl+= → 110%, saved', (await zoom(app)) === 1.1 && (await saved()) === 1.1, [await zoom(app), await saved()]);
  await press(page, 'Control+Shift+Equal');
  check('Ctrl+Shift+= → 125%', Math.abs((await zoom(app)) - 1.25) < 1e-9, await zoom(app));
  await press(page, 'Control+Minus');
  check('Ctrl+- → 110%', Math.abs((await zoom(app)) - 1.1) < 1e-9, await zoom(app));
  // Playwright's Numpad0 is the pad with Num Lock off (it sends Insert); a
  // keyboard with Num Lock on sends "0" from the pad, which this dispatches.
  await page.evaluate(() => (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', { key: '0', code: 'Numpad0', ctrlKey: true, bubbles: true, cancelable: true })));
  await page.waitForTimeout(400);
  check('Ctrl+NumPad0 → 100%', (await zoom(app)) === 1, await zoom(app));
  await press(page, 'Control+NumpadAdd');
  check('Ctrl+NumPad+ → 110%', Math.abs((await zoom(app)) - 1.1) < 1e-9, await zoom(app));
  await press(page, 'Control+Digit0');
  const sidebarFocused = await page.evaluate(() => !!document.activeElement?.closest('[data-part-id="workbench.parts.sidebar"]'));
  check('Ctrl+0 still focuses the side bar, size unchanged', sidebarFocused && Math.abs((await zoom(app)) - 1.1) < 1e-9, { sidebarFocused, zoom: await zoom(app) });

  // The worksheet's sheet keeps Ctrl+= for its cells.
  await page.evaluate(() => window.__parallx_workbench__._services.get({ id: 'ICommandService' }).executeCommand('worksheet.openScratch'));
  await page.waitForFunction(() => !!document.querySelector('.ws-pane__sheet')?.__wsHost, null, { timeout: 60000 });
  await page.waitForTimeout(2500);
  const box = await page.locator('.ws-pane__sheet canvas').first().boundingBox();
  await page.mouse.click(box.x + 200, box.y + 120);
  await page.waitForTimeout(300);
  const sheetZoomText = () => page.evaluate(() => [...document.querySelectorAll('.ws-pane__sheet *')].map((e) => e.textContent?.trim()).find((t) => /^\d+\s?%$/.test(t || '')) ?? null);
  const before = await sheetZoomText();
  const inSheet = await page.evaluate(() => !!document.activeElement?.closest('[data-px-owns-zoom]'));
  await page.keyboard.press('Control+Equal');
  await page.waitForTimeout(500);
  const after = await sheetZoomText();
  check('in the sheet, Ctrl+= zooms the cells and not the app', inSheet && before !== after && Math.abs((await zoom(app)) - 1.1) < 1e-9, { inSheet, before, after, app: await zoom(app) });
  await shot(app, 'worksheet-110.png');

  // Settings › Appearance › Text size.
  await page.evaluate(() => window.__parallx_workbench__._services.get({ id: 'ICommandService' }).executeCommand('settings.openAppearance'));
  await page.waitForSelector('[data-text-size]', { timeout: 15000 });
  const labels = await page.$$eval('[data-text-size]', (bs) => bs.map((b) => `${b.textContent}${b.getAttribute('aria-pressed') === 'true' ? '*' : ''}`));
  check('Appearance lists the sizes, 110% selected', labels.join(' ') === '90% 100% 110%* 125% 150%', labels);
  await page.click('[data-text-size="1.25"]');
  await page.waitForTimeout(400);
  check('picking 125% on the page zooms the app', Math.abs((await zoom(app)) - 1.25) < 1e-9, await zoom(app));
  const fits = await page.evaluate(() => { const r = document.querySelector('.settings-editor-overlay').getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), bottom: Math.round(r.bottom), w: innerWidth, h: innerHeight }; });
  check('the Settings window fits the window at 125%', fits.left >= 0 && fits.right <= fits.w && fits.bottom <= fits.h, fits);
  await shot(app, 'appearance-125.png');
  await page.keyboard.press('Escape');

  const viewMenu = await page.evaluate(async () => {
    const item = [...document.querySelectorAll('.titlebar-menu-item, .menubar-menu-button, [role="menubar"] > *')].find((e) => e.textContent.trim() === 'View');
    item?.click();
    await new Promise((r) => setTimeout(r, 400));
    const rows = [...document.querySelectorAll('.context-menu-item, [role="menuitem"]')].map((e) => e.textContent.trim().replace(/\s+/g, ' '));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return rows.filter((r) => /Text Size/.test(r));
  });
  check('View menu offers the three text size items', viewMenu.length === 3, viewMenu);
} finally {
  await app.close().catch(() => {});
}

// A restart opens at the saved size.
({ app, page } = await launch());
try {
  check('after a restart the app opens at 125%', Math.abs((await zoom(app)) - 1.25) < 1e-9, await zoom(app));
  await shot(app, 'restart-125.png');
} finally {
  await app.close().catch(() => {});
}
console.log(`[probe] ${results.filter((r) => r.ok).length}/${results.length} checks passed; shots: ${shots}`);
