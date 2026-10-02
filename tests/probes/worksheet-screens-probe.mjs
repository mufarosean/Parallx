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
  await page.waitForSelector('.ws-home__dest', { timeout: 60_000 });
  await page.waitForTimeout(800);
}
// Home's three destinations are cards; the rest open by command.
const TILE_COMMANDS = { 'Settings': 'worksheet.settings', 'Import Workbook': 'worksheet.importExcel', 'Generate Items': 'worksheet.generate' };
async function tile(page, title) {
  if (TILE_COMMANDS[title]) await runCommand(page, TILE_COMMANDS[title]);
  else await page.locator('.ws-home__destcard', { hasText: title }).first().click();
  await page.waitForTimeout(1_200);
}
/** What a screen says to a probe reader: its header, its buttons, its tab. */
async function describe(page, label) {
  const d = await page.evaluate(() => {
    const vis = (e) => e && e.offsetParent !== null;
    const pane = [...document.querySelectorAll('.ws-pane')].filter(vis).pop();
    const h = pane?.querySelector('.px-page-header');
    const tab = document.querySelector('.tab.active, .editor-tab.active, [role="tab"][aria-selected="true"]');
    return {
      tab: tab?.textContent?.trim() ?? '',
      title: h?.querySelector('.px-page-header__title')?.textContent ?? '',
      sub: h?.querySelector('.px-page-header__subtitle')?.textContent ?? '',
      back: h?.querySelector('.px-page-header__back')?.textContent ?? '',
      actions: [...(h?.querySelectorAll('.px-page-header__actions > button') ?? [])].map((b) => b.textContent.trim() || b.getAttribute('aria-label')).join(' | '),
      unlabelled: [...(pane?.querySelectorAll('button') ?? [])].filter((b) => vis(b) && !b.textContent.trim() && !b.getAttribute('aria-label')).length,
      overflowX: pane ? pane.scrollWidth - pane.clientWidth : 0,
    };
  });
  console.log(`[probe] ${label}: tab="${d.tab}" back="${d.back}" title="${d.title}" sub="${d.sub}" actions=[${d.actions}] unlabelled=${d.unlabelled} overflowX=${d.overflowX}`);
}
async function openMenu(page, btn) {
  await btn.click();
  await page.waitForSelector('.context-menu', { timeout: 5_000 }).catch(() => {});
  await page.waitForTimeout(300);
  return page.evaluate(() => [...document.querySelectorAll('.context-menu .context-menu-item, .context-menu [role="menuitem"]')].map((e) => e.textContent.trim()).filter(Boolean).join(' | '));
}
async function closeMenu(page) { await page.keyboard.press('Escape'); await page.waitForTimeout(200); }

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
      // The hidden window draws no frame until something changes: nudge a
      // 1 px dot so the screenshot has a frame to take.
      // A pointer move also wakes the compositor where the dot alone does not.
      await page.mouse.move(600 + attempt * 7, 400 + attempt * 5).catch(() => {});
      await page.evaluate(() => { const d = document.getElementById('__probe_repaint') || document.body.appendChild(Object.assign(document.createElement('div'), { id: '__probe_repaint', style: 'position:fixed;right:0;bottom:0;width:1px;height:1px;pointer-events:none' })); d.style.opacity = d.style.opacity === '0.01' ? '0.02' : '0.01'; }).catch(() => {});
      try { await page.screenshot({ path: f, timeout: 15_000, animations: 'disabled', ...opts }); console.log(`[probe] screenshot -> ${f}`); return; }
      catch (e) {
        if (attempt === 2) { console.log(`[probe] screenshot FAILED ${name}: ${String(e).split('\n')[0]}`); break; }
        // Still no frame: a 1 px resize forces layout and a new frame.
        const vp = page.viewportSize();
        if (vp) { await page.setViewportSize({ width: vp.width + 1, height: vp.height }).catch(() => {}); await page.waitForTimeout(300); await page.setViewportSize(vp).catch(() => {}); }
        await page.waitForTimeout(1_000);
      }
    }
  };
  try {
    await home(page);
    await describe(page, 'home');
    await shot('01-home.png');
    const add = page.locator('.px-page-header__actions .px-btn--secondary', { hasText: 'Add Problems' }).first();
    if (await add.count()) { console.log('[probe] add menu: ' + await openMenu(page, add)); await shot('01c-home-add-menu.png'); await closeMenu(page); }
    // Home at a wide window, where a stretched layout shows.
    await page.setViewportSize({ width: 2300, height: 950 }).catch(() => {});
    await page.waitForTimeout(600);
    await shot('01b-home-wide.png');
    await page.setViewportSize({ width: 1500, height: 950 }).catch(() => {});
    await page.waitForTimeout(400);

    await tile(page, 'Study Dashboard');
    await page.waitForSelector('.ws-dash__tiles', { timeout: 60_000 });
    await page.waitForTimeout(1_500);
    await describe(page, 'dashboard');
    await shot('02-dashboard-top.png');
    await page.setViewportSize({ width: 1500, height: 2300 }).catch(() => {});
    await page.waitForTimeout(1_200);
    await shot('03-dashboard-full.png');
    await page.setViewportSize({ width: 1500, height: 950 }).catch(() => {});
    await page.waitForTimeout(600);

    await home(page);
    await tile(page, 'Problem Bank');
    await page.waitForSelector('.ws-home__filters', { timeout: 30_000 });
    await describe(page, 'bank');
    await shot('04-bank.png');
    const noted = page.locator('.px-chip', { hasText: 'Noted' }).first();
    if (await noted.count()) {
      await noted.click(); await page.waitForTimeout(800);
      await describe(page, 'bank noted');
      await page.locator('.ws-bankrow').nth(1).hover().catch(() => {});
      await page.waitForTimeout(300);
      await shot('05-bank-noted.png');
      const rowMore = page.locator('.ws-bankrow').nth(1).locator('.px-btn--icon').last();
      if (await rowMore.count()) { console.log('[probe] bank row menu: ' + await openMenu(page, rowMore)); await shot('05b-bank-row-menu.png'); await closeMenu(page); }
      // Quiz These… hands the shown problems to the builder.
      const these = page.locator('.px-page-header .px-btn--primary', { hasText: 'Quiz These' }).first();
      if (await these.count()) { await these.click(); await page.waitForTimeout(1_200); await describe(page, 'builder from bank'); await shot('05c-builder-from-bank.png'); }
      await runCommand(page, 'worksheet.bank'); await page.waitForTimeout(800);
      const notedOn = page.locator('.px-chip[aria-pressed="true"]', { hasText: 'Noted' }).first();
      if (await notedOn.count()) { await notedOn.click(); await page.waitForTimeout(400); }
    }

    await home(page);
    await page.locator('.px-page-header .px-btn--primary', { hasText: 'New Quiz' }).first().click();
    await page.waitForTimeout(1_200);
    await describe(page, 'builder');
    await shot('06-quiz-builder.png');

    await home(page);
    await tile(page, 'Quizzes');
    await page.waitForTimeout(1_200);
    await describe(page, 'quizzes');
    await page.locator('.ws-quizrow').last().hover().catch(() => {});
    const qMore = page.locator('.ws-quizrow').last().locator('.px-btn--icon').last();
    if (await qMore.count()) { console.log('[probe] quiz row menu: ' + await openMenu(page, qMore)); }
    await shot('07-quizzes.png');
    await closeMenu(page);

    // The open quiz, from Home's Resume button.
    await home(page);
    const quizRow = page.locator('.ws-home__todayacts .px-btn', { hasText: 'Resume' }).first();
    if (await quizRow.count()) {
      await quizRow.click();
      await page.waitForSelector('.ws-sessionbar', { timeout: 60_000 });
      await page.waitForSelector('.ws-item__title', { timeout: 60_000 }).catch(() => {});
      await page.waitForTimeout(5_000);
      await describe(page, 'sheet');
      console.log('[probe] sheet header: ' + await page.evaluate(() => [...document.querySelectorAll('.ws-item__titlerow button')].filter((b) => b.offsetParent).map((b) => b.textContent.trim() || b.getAttribute('aria-label')).join(' | ')));
      console.log('[probe] quiz dots: ' + await page.evaluate(() => [...document.querySelectorAll('.ws-sessionbar__dot')].map((d) => d.getAttribute('aria-label')).join(' | ')));
      await shot('08-sheet.png');
      const noteBtn = page.locator('.ws-item__titlerow [aria-label="Add Note"], .ws-item__titlerow [aria-label="Edit Note"]').first();
      if (await noteBtn.count()) { await noteBtn.click(); await page.waitForTimeout(500); await shot('09-sheet-note.png'); await noteBtn.click(); }
      const sheetMore = page.locator('.ws-item__titlerow [aria-label="More Actions"]').first();
      if (await sheetMore.count()) { console.log('[probe] sheet menu: ' + await openMenu(page, sheetMore)); await shot('09b-sheet-menu.png'); await closeMenu(page); }
      // Rate from the switch: the segment lights and the dot follows.
      const easy = page.locator('.ws-rate [data-value="easy"]').first();
      if (await easy.count()) {
        await easy.click(); await page.waitForTimeout(1_500);
        console.log('[probe] rated: ' + await page.evaluate(() => document.querySelector('.ws-rate .ui-segmented-control__segment--active')?.textContent ?? 'none') + ' | dot: ' + await page.evaluate(() => document.querySelector('.ws-sessionbar__dot--current')?.getAttribute('aria-label') ?? ''));
        await shot('09c-sheet-rated.png');
      }
      const overview = page.locator('.ws-sessionbar .px-btn', { hasText: 'Overview' }).first();
      if (await overview.count()) {
        await overview.click();
        await page.waitForSelector('.ws-quiz__overview', { timeout: 30_000 });
        await page.waitForTimeout(1_000);
        await describe(page, 'overview');
        await shot('10-overview.png');
        const editNote = page.locator('.ws-quiz__row [aria-label="Edit Note"], .ws-quiz__row [aria-label="Add Note"]').first();
        if (await editNote.count()) { await editNote.click(); await page.waitForTimeout(400); await shot('11-overview-note.png'); }
        const summary = page.locator('.px-page-header .px-btn--primary', { hasText: 'Quiz Summary' }).first();
        if (await summary.count()) { await summary.click(); await page.waitForTimeout(1_500); await describe(page, 'summary'); await shot('12-summary.png'); }
      }
    } else {
      console.log('[probe] no Resume on Home');
    }

    await tile(page, 'Settings');
    await page.waitForTimeout(1_000);
    await describe(page, 'settings');
    await shot('13-settings.png');
    await tile(page, 'Import Workbook');
    await page.waitForTimeout(800);
    await describe(page, 'import');
    await shot('13b-import.png');
    await tile(page, 'Generate Items');
    await page.waitForTimeout(800);
    await describe(page, 'generate');
    await shot('13c-generate.png');

    // Light mode and a narrow window, over the screens most used.
    await page.evaluate(() => document.documentElement.setAttribute('data-px-mode', 'light'));
    await home(page);
    await shot('14-home-light.png');
    await tile(page, 'Study Dashboard');
    await page.waitForSelector('.ws-dash__tiles', { timeout: 60_000 });
    await page.waitForTimeout(1_200);
    await shot('15-dashboard-light.png');
    await home(page);
    await tile(page, 'Problem Bank');
    await page.waitForTimeout(1_000);
    await shot('16-bank-light.png');
    await page.evaluate(() => document.documentElement.setAttribute('data-px-mode', 'dark'));
    await page.setViewportSize({ width: 820, height: 900 }).catch(() => {});
    await home(page);
    await describe(page, 'home narrow');
    await shot('17-home-narrow.png');
    await tile(page, 'Problem Bank');
    await page.waitForTimeout(1_000);
    await describe(page, 'bank narrow');
    await shot('18-bank-narrow.png');
    await runCommand(page, 'worksheet.practice');
    await page.waitForTimeout(1_200);
    await describe(page, 'builder narrow');
    await shot('19-builder-narrow.png');
    await tile(page, 'Settings');
    await page.waitForTimeout(800);
    await describe(page, 'settings narrow');
    await shot('20-settings-narrow.png');
  } finally {
    console.log(`[probe] renderer errors: ${errors.length}`);
    for (const e of errors.slice(0, 20)) console.log('  ' + e);
    await app.close().catch(() => {});
    await fs.rm(appRoot, { recursive: true, force: true }).catch(() => {});
    await fs.rm(workspace, { recursive: true, force: true }).catch(() => {});
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
