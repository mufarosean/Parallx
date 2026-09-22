// Hidden-window probe: import a real Rising Fellow workbook through the app's
// own practice-workbook importer and prove the two things it used to lose now
// arrive: equations (Office Math shapes) as rendered pictures, and Windows
// metafiles (EMF) as PNG. Reads the stored items back from the workspace
// database afterwards and counts drawings by kind.
// Usage: node tests/probes/worksheet-import-probe.mjs <outDir> <workbook.xlsx> [expectEquations] [expectPictures]
import { _electron as electron } from 'playwright';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const outDir = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'parallx-import-probe'));
const WORKBOOK = path.resolve(process.argv[3] ?? '');
const EXPECT_EQ = Number(process.argv[4] ?? 0);
const EXPECT_PICS = Number(process.argv[5] ?? 0);
const ELECTRON = path.join(PROJECT_ROOT, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const VERIFY = path.join(__dirname, 'worksheet-import-verify.cjs');

let APP = null;
function launchEnv(appRoot) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE') env[k] = v;
  env.PARALLX_TEST_MODE = '1';
  env.PARALLX_RENDERER_PORT = '0';
  env.PARALLX_HIDDEN_PROBE = '1';
  env.PARALLX_APP_ROOT = appRoot;
  env.PARALLX_USER_DATA = path.join(appRoot, 'data', 'chromium-cache');
  return env;
}
async function makeRoots() {
  const stamp = Date.now();
  const appRoot = path.join(os.tmpdir(), `parallx-import-root-${stamp}`);
  const workspace = path.join(os.tmpdir(), `parallx-import-ws-${stamp}`);
  await fs.mkdir(path.join(appRoot, 'data'), { recursive: true });
  await fs.mkdir(path.join(workspace, '.parallx'), { recursive: true });
  await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: workspace }));
  await fs.symlink(path.join(PROJECT_ROOT, 'ext'), path.join(appRoot, 'ext'), 'junction');
  await fs.writeFile(path.join(workspace, '.parallx', 'ai-config.json'), JSON.stringify({ overrides: { indexing: { autoIndex: false, watchFiles: false } } }));
  await fs.writeFile(path.join(workspace, 'README.md'), '# Import probe\n');
  return { appRoot, workspace };
}
async function runCommand(page, id, ...args) {
  return page.evaluate(async ({ commandId, args }) => {
    const svc = window.__parallx_workbench__?._services?.get?.({ id: 'ICommandService' });
    if (!svc?.executeCommand) return 'no command service';
    try { await svc.executeCommand(commandId, ...args); return 'ok'; } catch (e) { return `failed: ${String(e).slice(0, 160)}`; }
  }, { commandId: id, args });
}
async function shot(page, name) {
  await page.waitForTimeout(400);
  const file = path.join(outDir, `${name}.png`);
  let how = 'playwright';
  try {
    await page.screenshot({ path: file, timeout: 8_000 });
  } catch {
    how = 'capturePage';
    const out = await APP.evaluate(async ({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed());
      if (!w) return null;
      const img = await w.webContents.capturePage();
      return { b64: img.toPNG().toString('base64'), size: img.getSize() };
    });
    if (!out || !out.b64) { console.log(`[probe] ${name}: no frame`); return; }
    await fs.writeFile(file, Buffer.from(out.b64, 'base64'));
    how += ` ${out.size.width}x${out.size.height}`;
  }
  console.log(`[probe] ${name} -> ${file} (${how})`);
}

async function main() {
  if (!WORKBOOK) throw new Error('usage: <outDir> <workbook.xlsx>');
  await fs.mkdir(outDir, { recursive: true });
  const { appRoot, workspace } = await makeRoots();
  console.log(`[probe] app root ${appRoot}\n[probe] workspace ${workspace}\n[probe] workbook ${WORKBOOK}`);
  const app = await electron.launch({ args: ['.'], cwd: PROJECT_ROOT, env: launchEnv(appRoot) });
  APP = app;
  const errors = [];
  const checks = [];
  const check = (ok, label) => { checks.push([!!ok, label]); console.log(`[probe] ${ok ? 'PASS' : 'FAIL'} ${label}`); };
  try {
    const page = await app.firstWindow();
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 300)}`);
      else if (m.type() === 'warning' && /Worksheet|import|problem/i.test(m.text())) console.log(`[probe] warning: ${m.text().slice(0, 400)}`);
    });
    await page.setViewportSize({ width: 1400, height: 900 }).catch(() => {});
    await page.waitForSelector('[data-part-id="workbench.parts.titlebar"]', { state: 'attached', timeout: 90_000 });
    await page.waitForTimeout(3_000);

    // The renderer reads only inside the workspace or what the dialog granted;
    // the probe skips the dialog, so the workbook goes inside the workspace.
    const inside = path.join(workspace, 'imports', path.basename(WORKBOOK));
    await fs.mkdir(path.dirname(inside), { recursive: true });
    await fs.copyFile(WORKBOOK, inside);
    const readInfo = await page.evaluate(async (file) => {
      const e = window.parallxElectron;
      if (!e?.fs?.readFile) return 'fs.readFile missing';
      try {
        const r = await e.fs.readFile(file);
        return r?.error ? `error: ${r.error.message}` : `encoding=${r?.encoding} content=${r?.content ? r.content.length : 0} chars; images bridge=${typeof e.images?.rasterizeMetafile}`;
      } catch (err) { return `threw: ${String(err).slice(0, 160)}`; }
    }, inside);
    console.log(`[probe] fs.readFile: ${readInfo}`);

    // The file dialog is native; the command takes the path instead.
    console.log(`[probe] importExcel: ${await runCommand(page, 'worksheet.importExcel', inside)}`);
    await page.waitForTimeout(6_000);
    const early = await page.evaluate(() => {
      const pane = document.querySelector('.ws-create');
      const texts = pane ? Array.from(pane.querySelectorAll('div, p, span')).map((e) => (e.children.length === 0 ? e.textContent.trim() : '')).filter(Boolean) : [];
      return { pane: !!pane, texts: texts.slice(0, 12).join(' | ').slice(0, 400) };
    });
    console.log(`[probe] pane after 6s: ${JSON.stringify(early)}`);
    await shot(page, 'import-early');
    await page.waitForSelector('.ws-import__row', { timeout: 120_000 });
    await page.waitForTimeout(800);
    const rows = await page.locator('.ws-import__row').count();
    console.log(`[probe] picker rows: ${rows}`);
    check(rows > 0, 'workbook read: problems listed');
    await shot(page, 'import-picker');

    const importBtn = page.getByRole('button', { name: /Import Selected Problems/ }).first();
    await importBtn.click();
    // Rendering equations and rasterising metafiles happens here; give it time.
    const started = Date.now();
    let status = '';
    while (Date.now() - started < 240_000) {
      await page.waitForTimeout(1_500);
      status = await page.evaluate(() => Array.from(document.querySelectorAll('.ws-import__status, .ws-status, [class*="status"]')).map((e) => e.textContent.trim()).filter(Boolean).join(' | ')).catch(() => '');
      const busy = await importBtn.isDisabled().catch(() => false);
      if (/imported|done|added/i.test(status) && !busy) break;
      if (!busy && Date.now() - started > 20_000 && !/reading|importing|rendering/i.test(status)) break;
    }
    console.log(`[probe] after import (${Math.round((Date.now() - started) / 1000)}s): ${status.slice(0, 200)}`);
    await shot(page, 'import-done');

    // Open the bank and the first problem with an equation, for the eye.
    console.log(`[probe] bank: ${await runCommand(page, 'worksheet.bank')}`);
    await page.waitForTimeout(2_500);
    const q3 = page.getByText(/Q #3 ·/).first();
    if (await q3.count()) {
      await q3.click().catch(() => {});
      await page.waitForTimeout(6_000);
      await shot(page, 'import-q3');
    } else {
      console.log('[probe] no "Q #3" row found in the bank (skipped the screenshot)');
    }
  } finally {
    if (errors.length) {
      console.log(`[probe] ${errors.length} renderer error(s):`);
      for (const e of errors) console.log(`  ${e}`);
    } else console.log('[probe] no renderer errors');
    await app.close().catch(() => {});
    // What landed in the database: drawings by kind per imported item.
    const db = path.join(workspace, '.parallx', 'data.db');
    const r = spawnSync(ELECTRON, [VERIFY, db], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', windowsHide: true });
    const out = (r.stdout || '').trim();
    console.log(out || `[probe] verify produced no output: ${(r.stderr || '').slice(0, 300)}`);
    const totals = /TOTAL items=(\d+) equationPngs=(\d+) textSvgs=(\d+) picturePngs=(\d+) pictureOther=(\d+)/.exec(out);
    if (totals) {
      const [, items, eq, svgs, pics, other] = totals.map(Number);
      check(items > 0, `items imported (${items})`);
      if (EXPECT_EQ) check(eq >= EXPECT_EQ, `equations rendered as pictures (${eq} of ${EXPECT_EQ} expected)`);
      if (EXPECT_PICS) check(pics >= EXPECT_PICS, `pictures stored as PNG incl. metafiles (${pics} of ${EXPECT_PICS} expected)`);
      check(other === 0, `no metafile left unrasterised (${other})`);
      console.log(`[probe] text boxes still drawn as text: ${svgs}`);
    } else check(false, 'database verification ran');
    const failed = checks.filter(([ok]) => !ok).length;
    console.log(`[probe] ${checks.length - failed}/${checks.length} checks passed`);
    await fs.rm(appRoot, { recursive: true, force: true }).catch(() => {});
    await fs.rm(workspace, { recursive: true, force: true }).catch(() => {});
    if (failed || errors.length) process.exitCode = 1;
  }
}
main().catch((err) => { console.error('[probe] failed:', err); process.exit(1); });
