// contrast-probe.mjs — Settings › Appearance › Increase Contrast in the built app.
//
// New profile under test-results/. Turns the switch on through Settings,
// then, in every palette (Slate, Warm, Ember) and both modes, resolves the
// tokens the app paints with and measures their contrast against the page
// and card grounds: borders at least 3:1, strong borders 4.5:1, muted text
// 7:1, dividers and part lines 2:1. Checks the focus ring is 2px, and 3px
// with the switch on. Whole-window captures of Settings in dark and light.
//   node scripts/build.mjs && xvfb-run -a node tests/probes/contrast-probe.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright';

const repo = path.resolve(import.meta.dirname, '../..');
const root = await fs.mkdtemp(path.join(repo, 'test-results', 'contrast-'));
const appRoot = path.join(root, 'app');
const workspace = path.join(root, 'workspace');
const shots = path.join(root, 'shots');
for (const d of [path.join(appRoot, 'data/chromium-cache'), path.join(workspace, '.parallx'), shots]) await fs.mkdir(d, { recursive: true });
await fs.writeFile(path.join(appRoot, 'data/last-workspace.json'), JSON.stringify({ path: workspace }));
const env = { ...process.env, PARALLX_TEST_MODE: '1', PARALLX_RENDERER_PORT: '0', PARALLX_APP_ROOT: appRoot, PARALLX_USER_DATA: path.join(appRoot, 'data/chromium-cache') };
delete env.ELECTRON_RUN_AS_NODE;

const results = [];
const check = (label, ok, detail) => { results.push(ok); console.log(`[probe] ${ok ? 'ok  ' : 'FAIL'} ${label}${detail !== undefined ? ` ${JSON.stringify(detail)}` : ''}`); };
const app = await electron.launch({ args: ['.', '--no-sandbox', '--disable-gpu'], cwd: repo, env, timeout: 90000 });
const shot = async (file) => {
  const b64 = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
  await fs.writeFile(path.join(shots, file), Buffer.from(b64, 'base64'));
};
try {
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(1280, 800); });
  await page.waitForSelector('.parallx-ready', { state: 'attached', timeout: 120000 });
  await page.waitForFunction(() => !!window.__parallx_workbench__?._services, null, { timeout: 60000 });
  await page.waitForTimeout(1500);

  const measure = () => page.evaluate(() => {
    const probe = document.createElement('div');
    document.body.appendChild(probe);
    const rgb = (token) => {
      probe.style.color = `var(${token})`;
      const c = getComputedStyle(probe).color;
      const n = c.match(/[\d.]+/g).map(Number);
      return c.startsWith('color(') ? n.slice(0, 3).map((v) => v * 255) : n.slice(0, 3);
    };
    const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    const L = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    const cr = (a, b) => { const x = L(a), y = L(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const grounds = [rgb('--px-bg'), rgb('--px-bg-elevated')];
    const worst = (token) => Math.min(...grounds.map((g) => cr(rgb(token), g)));
    const out = {};
    for (const t of ['--px-border', '--px-border-strong', '--px-divider', '--px-chrome-line', '--px-text-muted', '--px-text-secondary']) out[t] = Math.round(worst(t) * 100) / 100;
    probe.remove();
    return out;
  });
  const setLook = (mode, base) => page.evaluate(({ mode, base }) => {
    const r = document.documentElement;
    if (mode === 'light') r.setAttribute('data-px-mode', 'light'); else r.removeAttribute('data-px-mode');
    if (base === 'slate') r.removeAttribute('data-px-theme'); else r.setAttribute('data-px-theme', base);
  }, { mode, base });
  const focusWidth = async () => {
    await page.evaluate(() => { const b = document.createElement('button'); b.className = 'px-btn'; b.id = 'probe-btn'; b.textContent = 'Probe'; document.body.appendChild(b); });
    await page.focus('#probe-btn');
    await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab'); // keyboard focus → :focus-visible
    await page.focus('#probe-btn');
    const w = await page.evaluate(() => { const b = document.getElementById('probe-btn'); const w = getComputedStyle(b).outlineWidth; b.remove(); return w; });
    return w;
  };

  const before = await measure();
  check('standard: borders sit near 1.3:1 (the problem)', before['--px-border'] < 1.6, before);
  check('standard focus ring is 2px', (await focusWidth()) === '2px');

  // The real switch, in Settings › Appearance.
  await page.evaluate(() => window.__parallx_workbench__._services.get({ id: 'ICommandService' }).executeCommand('settings.openAppearance'));
  await page.waitForSelector('[role="switch"][aria-label="Increase Contrast"]', { timeout: 15000 });
  await page.click('[role="switch"][aria-label="Increase Contrast"]');
  await page.waitForTimeout(300);
  check('the switch sets data-px-contrast="more"', await page.evaluate(() => document.documentElement.getAttribute('data-px-contrast')) === 'more');
  await page.locator('[role="switch"][aria-label="Increase Contrast"]').scrollIntoViewIfNeeded();
  await shot('dark-slate-on.png');

  for (const mode of ['dark', 'light']) for (const base of ['slate', 'warm', 'ember']) {
    await setLook(mode, base);
    const m = await measure();
    const ok = m['--px-border'] >= 3 && m['--px-border-strong'] >= 4.5 && m['--px-text-muted'] >= 7 && m['--px-divider'] >= 2 && m['--px-chrome-line'] >= 2 && m['--px-text-secondary'] >= 10;
    check(`${mode} ${base}: borders ≥3, strong ≥4.5, muted ≥7, dividers ≥2, secondary ≥10`, ok, m);
    if (mode === 'light' && base === 'slate') { await page.waitForTimeout(400); await shot('light-slate-on.png'); }
  }
  await setLook('dark', 'slate');
  await page.keyboard.press('Escape');
  check('focus ring is 3px with the switch on', (await focusWidth()) === '3px');
} finally {
  await app.close().catch(() => {});
}
console.log(`[probe] ${results.filter(Boolean).length}/${results.length} checks passed; shots: ${shots}`);
