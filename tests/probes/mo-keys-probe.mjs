// mo-keys-probe.mjs: the Media Organizer's drags from the keyboard, in the
// real app, never on screen, the chat model's port refused
// (docs/ACCESSIBILITY.md, section 6; ext/media-organizer/keys.js).
//
// Seeds a throwaway library (tag-review-seed.cjs) and, in the image editor:
// + zooms the stage (it becomes pannable) and 0 fits it again; on the Crop
// tool the Straighten dial steps with the arrows and the crop frame moves.
//
// Usage: node tests/probes/mo-keys-probe.mjs
// Requires `npm run build` first (the app loads dist/).

import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { launchApp, cmd } from './scene.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const ELECTRON = path.join(PROJECT_ROOT, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const SEED = path.join(__dirname, 'tag-review-seed.cjs');
const nodeEnv = () => ({ ...process.env, ELECTRON_RUN_AS_NODE: '1' });
const dbPaths = (ws) => ['media-organizer', 'parallx-community.media-organizer'].map((id) => path.join(ws, '.parallx', 'extensions', id, 'data.db'));

const stamp = Date.now();
const appRoot = path.join(os.tmpdir(), `parallx-mokeys-root-${stamp}`);
const workspace = path.join(os.tmpdir(), `parallx-mokeys-ws-${stamp}`);
const photos = path.join(workspace, 'photos');
await fs.mkdir(path.join(appRoot, 'data'), { recursive: true });
await fs.mkdir(photos, { recursive: true });
await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: workspace }));
await fs.symlink(path.join(PROJECT_ROOT, 'ext'), path.join(appRoot, 'ext'), 'junction');
const gen = [['boxing.jpg', 'testsrc2=size=1200x800', 1200, 800], ['card.jpg', 'testsrc2=size=2400x1600', 2400, 1600], ['fractal.jpg', 'mandelbrot=size=1800x1200', 1800, 1200], ['bars.jpg', 'smptehdbars=size=1920x1080', 1920, 1080]];
for (const [name, src] of gen) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', src, '-frames:v', '1', '-q:v', '3', path.join(photos, name)], { windowsHide: true });
  if (r.status !== 0) throw new Error(`ffmpeg ${name}: ${String(r.stderr).slice(0, 200)}`);
}
const specPath = path.join(appRoot, 'spec.json');
await fs.writeFile(specPath, JSON.stringify(gen.map(([basename, , width, height]) => ({ basename, width, height }))));
let seeded = null;
for (const db of dbPaths(workspace)) {
  const r = spawnSync(ELECTRON, [SEED, 'seed', db, photos, specPath], { env: nodeEnv(), encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error(`seed failed: ${r.stderr || r.stdout}`);
  seeded = JSON.parse(r.stdout.trim().split(/\r?\n/).pop());
}

const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`[probe] ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`); };
const { app, page, errors } = await launchApp(appRoot);
try {
  await page.evaluate(async () => {
    await window.__parallx_workbench__._services.get({ id: 'IToolEnablementService' }).setEnablement('parallx-community.media-organizer', true);
  });
  await page.waitForTimeout(3_000);
  const opened = await cmd(page, 'media-organizer.editImage', seeded.photo['fractal.jpg']);
  await page.waitForSelector('.mo-edit-stage', { timeout: 30_000 });
  await page.waitForTimeout(3_000);
  check('the image editor opens', opened === true, String(opened));

  // The stage: + zooms in (pannable), 0 fits again.
  const stage = () => page.evaluate(() => { const s = Array.from(document.querySelectorAll('.mo-edit-stage')).find((x) => x.getClientRects().length); return s ? { pannable: s.classList.contains('is-pannable'), tab: s.tabIndex, keys: s.getAttribute('aria-keyshortcuts') } : null; });
  await page.evaluate(() => Array.from(document.querySelectorAll('.mo-edit-stage')).find((x) => x.getClientRects().length)?.focus());
  for (let i = 0; i < 6; i++) await page.keyboard.press('+');
  await page.waitForTimeout(600);
  const zoomed = await stage();
  check('+ zooms the photo in (the stage pans)', !!zoomed && zoomed.pannable && zoomed.tab === 0, JSON.stringify(zoomed));
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('0');
  await page.waitForTimeout(1_500); // a hidden window draws late
  await page.waitForTimeout(600);
  const fitted = await stage();
  check('0 fits it again', !!fitted && !fitted.pannable, JSON.stringify(fitted));

  // The Crop tool: the Straighten dial and the crop frame.
  await page.evaluate(() => Array.from(document.querySelectorAll('[data-px-id="media-organizer.imageEditor.tool.crop"]')).find((x) => x.getClientRects().length)?.click());
  await page.waitForTimeout(1_000);
  const dialBefore = await page.evaluate(() => { const d = Array.from(document.querySelectorAll('.mo-edit-dial')).find((x) => x.getClientRects().length); d?.focus(); return d ? d.getAttribute('aria-valuenow') : null; });
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(800);
  const dialAfter = await page.evaluate(() => document.activeElement?.classList.contains('mo-edit-dial') ? document.activeElement.getAttribute('aria-valuenow') : `focus on ${document.activeElement?.className}`);
  check('the Straighten dial steps with the arrows', dialBefore !== null && Number(dialAfter) === Number(dialBefore) + 0.5, `${dialBefore} -> ${dialAfter}`);
  const frame = () => page.evaluate(() => { const f = Array.from(document.querySelectorAll('.mo-edit-cropframe')).find((x) => x.getClientRects().length); return f ? f.style.left + ',' + f.style.width : null; });
  await page.keyboard.press('Home'); // back to level
  await page.waitForTimeout(500);
  await page.evaluate(() => Array.from(document.querySelectorAll('.mo-edit-cropframe')).find((x) => x.getClientRects().length)?.focus());
  const until = async (was) => { for (let i = 0; i < 30; i++) { const now = await frame(); if (now !== was) return now; await page.waitForTimeout(100); } return frame(); };
  const before = await frame();
  for (let i = 0; i < 4; i++) await page.keyboard.press('Alt+ArrowLeft');
  const sized = await until(before);
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
  const moved = await until(sized);
  check('the crop frame sizes and moves with the keys', !!before && sized !== before && moved !== sized, `${before} -> ${sized} -> ${moved}`);
  console.log(`[probe] renderer errors: ${errors.length ? errors.join(' | ') : 'none'}`);
} catch (err) {
  check('the run', false, err && err.message);
} finally {
  await app.close().catch(() => {});
  await fs.rm(appRoot, { recursive: true, force: true }).catch(() => {});
  await fs.rm(workspace, { recursive: true, force: true }).catch(() => {});
}
const ok = results.every(Boolean);
console.log(ok ? '[probe] media organizer keys: all ok' : '[probe] media organizer keys: FAILED');
process.exit(ok ? 0 : 1);
