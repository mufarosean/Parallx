// <name>-probe.mjs — <what this proves, in one sentence>.
//
// Boots the built app hidden with a new profile and workspace, does what a
// person would do, and reads the result back from the app.
//
//   node scripts/build.mjs && xvfb-run -a node tests/probes/<name>-probe.mjs [outDir]
import fs from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright';

const repo = path.resolve(import.meta.dirname, '../..');
await fs.mkdir(path.join(repo, 'test-results'), { recursive: true });
const root = process.argv[2] ? path.resolve(process.argv[2]) : await fs.mkdtemp(path.join(repo, 'test-results', 'probe-'));
const appRoot = path.join(root, 'app');
const workspace = path.join(root, 'workspace');
const shots = path.join(root, 'shots');
for (const d of [path.join(appRoot, 'data/chromium-cache'), path.join(workspace, '.parallx'), shots]) await fs.mkdir(d, { recursive: true });
await fs.writeFile(path.join(appRoot, 'data/last-workspace.json'), JSON.stringify({ path: workspace }));
// No background indexing, suggestions or heartbeat: the probe is the only thing acting.
await fs.writeFile(path.join(workspace, '.parallx/ai-config.json'), JSON.stringify({ overrides: { indexing: { autoIndex: false, watchFiles: false }, suggestions: { suggestionsEnabled: false }, heartbeat: { enabled: false } } }));
const env = { ...process.env, PARALLX_TEST_MODE: '1', PARALLX_RENDERER_PORT: '0', PARALLX_APP_ROOT: appRoot, PARALLX_USER_DATA: path.join(appRoot, 'data/chromium-cache') };
delete env.ELECTRON_RUN_AS_NODE;

const problems = [];
const errors = [];
const check = (name, ok, got) => { console.log(`${ok ? '  ok ' : ' FAIL'} ${name}${ok ? '' : `: ${JSON.stringify(got)}`}`); if (!ok) problems.push(name); };

let app; let page;
async function launch() {
  app = await electron.launch({ args: ['.', '--mute-audio', '--no-sandbox', '--disable-gpu'], cwd: repo, env, timeout: 90000 });
  page = await app.firstWindow();
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(1440, 900); });
  await page.waitForSelector('.parallx-ready', { state: 'attached', timeout: 120000 });
  await page.waitForFunction(() => !!window.__parallx_workbench__?._services, null, { timeout: 60000 });
  await page.waitForTimeout(1500);
}
const run = (id, ...args) => page.evaluate(({ id, args }) => window.__parallx_workbench__._services.get({ id: 'ICommandService' }).executeCommand(id, ...args), { id, args });
const wait = (ms) => page.waitForTimeout(ms);

try {
  await launch();
  // 1. Open the surface: await run('<command.id>', ...args);
  // 2. Act as a person does: page.mouse.click(x, y), page.keyboard.type('…'), page.keyboard.press('Control+z').
  // 3. Read the result back from the app, then: check('what should be true', value === expected, value);
  // 4. await page.screenshot({ path: path.join(shots, 'surface.png') }); and look at it.
  // 5. The hard cases: empty, twice, after another tab, after `await app.close(); await launch();`, tool turned off.
  await wait(0);
} catch (err) {
  console.log(`[probe] stopped: ${err?.stack ?? err}`);
  problems.push('the probe stopped');
  try { await page.screenshot({ path: path.join(shots, 'stopped.png') }); } catch { /* no window */ }
} finally {
  await app?.close().catch(() => {});
}
console.log(`\n[probe] page errors: ${errors.length}`);
for (const e of errors.slice(0, 8)) console.log('  ' + e);
console.log(`[probe] ${problems.length} problems${problems.length ? ': ' + problems.join('; ') : ''}`);
console.log(`[probe] shots: ${shots}`);
process.exitCode = problems.length ? 1 : 0;
