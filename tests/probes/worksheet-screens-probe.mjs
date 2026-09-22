// worksheet-screens-probe.mjs — every worksheet screen, in the REAL app,
// hidden, over a SYNTHETIC bank. No window appears, no real workspace is
// opened: the probe makes a throwaway app root and workspace, lets the app
// migrate the empty database on a first hidden run, seeds it with
// worksheet-seed.cjs, then runs again and screenshots each screen.
//
//   node tests/probes/worksheet-screens-probe.mjs <outDir>
// Requires `npm run build` first — the app loads dist/.
import { _electron as electron } from 'playwright';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const outDir = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'parallx-worksheet-shots'));

function launchEnv(appRoot) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE') env[k] = v;
  env.PARALLX_TEST_MODE = '1'; env.PARALLX_RENDERER_PORT = '0'; env.PARALLX_HIDDEN_PROBE = '1';
  env.PARALLX_APP_ROOT = appRoot; env.PARALLX_USER_DATA = path.join(appRoot, 'data', 'chromium-cache');
  return env;
}
async function makeRoots() {
  const stamp = Date.now();
  const appRoot = path.join(os.tmpdir(), `parallx-wsshots-root-${stamp}`);
  const workspace = path.join(os.tmpdir(), `parallx-wsshots-ws-${stamp}`);
  await fs.mkdir(path.join(appRoot, 'data'), { recursive: true });
  await fs.mkdir(path.join(workspace, '.parallx'), { recursive: true });
  await fs.writeFile(path.join(workspace, 'README.md'), '# Worksheet screens probe workspace\n');
  await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: workspace }));
  try { await fs.symlink(path.join(PROJECT_ROOT, 'ext'), path.join(appRoot, 'ext'), 'junction'); } catch { /* fine */ }
  return { appRoot, workspace };
}
async function runCommand(page, commandId, ...args) {
  return page.evaluate(async ({ commandId, args }) => {
    const wb = window.__parallx_workbench__;
    const svc = wb?._services?.get?.({ id: 'ICommandService' });
    if (!svc?.executeCommand) return false;
    try { await svc.executeCommand(commandId, ...args); return true; } catch (e) { return String(e); }
  }, { commandId, args });
}
async function boot(appRoot) {
  const app = await electron.launch({ args: ['.'], cwd: PROJECT_ROOT, env: launchEnv(appRoot) });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + String(e).slice(0, 300)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 240)}`); });
  await page.setViewportSize({ width: 1500, height: 950 }).catch(() => {});
  await page.waitForSelector('[data-part-id="workbench.parts.titlebar"]', { state: 'attached', timeout: 90_000 });
  await page.waitForTimeout(2_500);
  return { app, page, errors };
}
async function home(page) {
  await runCommand(page, 'worksheet.open');
  await page.waitForSelector('.ws-home__nav', { timeout: 60_000 });
  await page.waitForTimeout(800);
}
// Home's destinations are a row of quiet buttons; its actions sit in the continue strip.
async function tile(page, title) {
  await page.locator('.ws-home__nav .ws-btn', { hasText: title }).first().click();
  await page.waitForTimeout(1_200);
}

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  const { appRoot, workspace } = await makeRoots();
  const dbPath = path.join(workspace, '.parallx', 'data.db');
  console.log(`[probe] workspace ${workspace}`);

  // Run 1: let the app create and migrate the database.
  {
    const { app, page } = await boot(appRoot);
    await home(page);
    await app.close();
  }
  // Seed under Electron's Node (better-sqlite3 is built for its ABI).
  const electronBin = path.join(PROJECT_ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'electron.cmd' : 'electron');
  const seed = spawnSync(electronBin, [path.join(__dirname, 'worksheet-seed.cjs'), dbPath], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', shell: process.platform === 'win32' });
  console.log('[probe] seed:', (seed.stdout || '').trim(), (seed.stderr || '').trim());
  if (seed.status !== 0) { console.error('[probe] seed failed'); process.exit(1); }

  // Run 2: the screens.
  const { app, page, errors } = await boot(appRoot);
  // A hung capture must not end the run: each shot has its own timeout and
  // failure line. The dashboard is shot in a tall viewport instead of scrolled,
  // since scrolling the charts' pane stalled the compositor.
  const shot = async (name, opts = {}) => {
    const f = path.join(outDir, name);
    for (let attempt = 1; attempt <= 2; attempt++) {
      try { await page.screenshot({ path: f, timeout: 15_000, animations: 'disabled', ...opts }); console.log(`[probe] screenshot -> ${f}`); return; }
      catch (e) { if (attempt === 2) console.log(`[probe] screenshot FAILED ${name}: ${String(e).split('\n')[0]}`); else await page.waitForTimeout(1_500); }
    }
  };
  try {
    await home(page);
    await shot('01-home.png');
    // Home at a wide window, where a stretched layout shows.
    await page.setViewportSize({ width: 2300, height: 950 }).catch(() => {});
    await page.waitForTimeout(600);
    await shot('01b-home-wide.png');
    await page.setViewportSize({ width: 1500, height: 950 }).catch(() => {});
    await page.waitForTimeout(400);

    await tile(page, 'Dashboard');
    await page.waitForSelector('.ws-dash__tiles', { timeout: 60_000 });
    await page.waitForTimeout(1_500);
    await shot('02-dashboard-top.png');
    await page.setViewportSize({ width: 1500, height: 2300 }).catch(() => {});
    await page.waitForTimeout(1_200);
    await shot('03-dashboard-full.png');
    await page.setViewportSize({ width: 1500, height: 950 }).catch(() => {});
    await page.waitForTimeout(600);

    await home(page);
    await tile(page, 'Problem Bank');
    await page.waitForSelector('.ws-home__filters', { timeout: 30_000 });
    await shot('04-bank.png');
    const noted = page.locator('.ws-bank__filter', { hasText: 'Noted' }).first();
    if (await noted.count()) { await noted.click(); await page.waitForTimeout(800); await shot('05-bank-noted.png'); }

    await home(page);
    await page.locator('.ws-home__acts .ws-btn', { hasText: /Start Quiz|New Quiz/ }).first().click();
    await page.waitForTimeout(1_200);
    await shot('06-quiz-builder.png');

    await home(page);
    await tile(page, 'Quizzes');
    await page.waitForTimeout(1_200);
    await shot('07-quizzes.png');

    // The open quiz, from Home's Resume button.
    await home(page);
    const quizRow = page.locator('.ws-home__acts .ws-btn', { hasText: 'Resume' }).first();
    if (await quizRow.count()) {
      await quizRow.click();
      await page.waitForSelector('.ws-sessionbar', { timeout: 60_000 });
      await page.waitForSelector('.ws-item__title', { timeout: 60_000 }).catch(() => {});
      await page.waitForTimeout(5_000);
      await shot('08-sheet.png');
      const noteBtn = page.locator('[aria-label="Add Note"], [aria-label="Edit Note"]').first();
      if (await noteBtn.count()) { await noteBtn.click(); await page.waitForTimeout(500); await shot('09-sheet-note.png'); }
      const overview = page.locator('[aria-label="Quiz Overview"]').first();
      if (await overview.count()) {
        await overview.click();
        await page.waitForSelector('.ws-quiz__overview', { timeout: 30_000 });
        await page.waitForTimeout(1_000);
        await shot('10-overview.png');
        const editNote = page.locator('.ws-quiz__row [aria-label="Edit Note"], .ws-quiz__row [aria-label="Add Note"]').first();
        if (await editNote.count()) { await editNote.click(); await page.waitForTimeout(400); await shot('11-overview-note.png'); }
        const summary = page.locator('.ws-btn--small', { hasText: 'Quiz Summary' }).first();
        if (await summary.count()) { await summary.click(); await page.waitForTimeout(1_200); await shot('12-summary.png'); }
      }
    } else {
      console.log('[probe] no quiz row on Home');
    }

    await home(page);
    await tile(page, 'Settings');
    await page.waitForTimeout(1_000);
    await shot('13-settings.png');
  } finally {
    console.log(`[probe] renderer errors: ${errors.length}`);
    for (const e of errors.slice(0, 20)) console.log('  ' + e);
    await app.close().catch(() => {});
    await fs.rm(appRoot, { recursive: true, force: true }).catch(() => {});
    await fs.rm(workspace, { recursive: true, force: true }).catch(() => {});
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
