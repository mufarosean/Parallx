// match-system-probe.mjs — Settings › Appearance › Mode › Match System, in the built app.
//
// The computer's light or dark setting is played by Electron's
// nativeTheme.themeSource. Checks: choosing Match System follows it, live,
// the chrome and the code editor's theme together, and the page says which
// one is on; choosing Dark stops following.
//   node scripts/build.mjs && xvfb-run -a node tests/probes/match-system-probe.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright';

const repo = path.resolve(import.meta.dirname, '../..');
const root = await fs.mkdtemp(path.join(repo, 'test-results', 'match-system-'));
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
  // Playwright pins prefers-color-scheme to light on the pages it drives;
  // without this the app never sees the computer's setting change.
  await page.emulateMedia({ colorScheme: null });
  await page.waitForSelector('.parallx-ready', { state: 'attached', timeout: 120000 });
  await page.waitForFunction(() => !!window.__parallx_workbench__?._services, null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  const system = async (source) => { await app.evaluate(({ nativeTheme }, s) => { nativeTheme.themeSource = s; }, source); await page.waitForTimeout(600); };
  const state = () => page.evaluate(() => ({
    mode: document.documentElement.getAttribute('data-px-mode') ?? 'dark',
    editorBg: getComputedStyle(document.body).getPropertyValue('--vscode-editor-background').trim(),
    status: document.querySelector('.px-appearance-mode-status:not([hidden])')?.textContent ?? null,
    selected: document.querySelector('.px-mode-btn[aria-pressed="true"]')?.dataset.mode ?? null,
  }));
  const storedTheme = async () => JSON.parse(await fs.readFile(path.join(appRoot, 'data/global-storage.json'), 'utf8'))['parallx.colorTheme'] ?? null;

  await system('dark');
  await page.evaluate(() => window.__parallx_workbench__._services.get({ id: 'ICommandService' }).executeCommand('settings.openAppearance'));
  await page.waitForSelector('.px-mode-btn[data-mode="system"]', { timeout: 15000 });
  await page.click('.px-mode-btn[data-mode="system"]');
  await page.waitForTimeout(400);
  let s = await state();
  check('Match System selected, dark while the computer is dark', s.selected === 'system' && s.mode === 'dark' && s.status === 'Following your computer: dark right now.', s);

  await system('light');
  s = await state();
  const lightTheme = await storedTheme();
  check('the computer turns light: the app follows, code editor too', s.mode === 'light' && s.status === 'Following your computer: light right now.' && lightTheme === 'parallx-light-modern', { ...s, storedTheme: lightTheme });

  await system('dark');
  s = await state();
  check('and back to dark', s.mode === 'dark' && (await storedTheme()) === 'parallx-dark-modern', s);

  await page.click('.px-mode-btn[data-mode="light"]');
  await page.waitForTimeout(300);
  await system('dark');
  s = await state();
  check('choosing Light stops following: the computer going dark changes nothing', s.selected === 'light' && s.mode === 'light' && s.status === null, s);
} finally {
  await app.close().catch(() => {});
}
console.log(`[probe] ${results.filter(Boolean).length}/${results.length} checks passed`);
