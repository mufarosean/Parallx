// mo-parent-tags-probe.mjs: applying a tag in the Media Organizer applies its
// parents, in the real app, never on screen, the chat model's port refused.
//
// Seeds a throwaway workspace (tag-review-seed.cjs: four images, a tag tree
// ANIMALS › DOG › CORGI, SPORTS › BOXING, PEOPLE › CROWD …, review rows),
// approves two AI tag reviews through Tag Review, then reads the database
// back: the picks and all their parents must be on the photo, as before the
// multi-parent change (3019f3b2) lost them. (Dragging a branch onto items is
// tested in tests/unit/moTagDrag.test.ts: this seeded library is not in the grid.)
//
// Usage: node tests/probes/mo-parent-tags-probe.mjs <outDir>
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
const BOXING = path.join(PROJECT_ROOT, 'data', 'dashboard-assets', 'aa21bc3e-d260-41ac-8bcf-ab5efe10d0cb.jpg');
const nodeEnv = () => ({ ...process.env, ELECTRON_RUN_AS_NODE: '1' });
const dbPaths = (ws) => ['media-organizer', 'parallx-community.media-organizer'].map((id) => path.join(ws, '.parallx', 'extensions', id, 'data.db'));

const stamp = Date.now();
const appRoot = path.join(os.tmpdir(), `parallx-moparents-root-${stamp}`);
const workspace = path.join(os.tmpdir(), `parallx-moparents-ws-${stamp}`);
const photos = path.join(workspace, 'photos');
await fs.mkdir(path.join(appRoot, 'data'), { recursive: true });
await fs.mkdir(photos, { recursive: true });
await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: workspace }));
await fs.symlink(path.join(PROJECT_ROOT, 'ext'), path.join(appRoot, 'ext'), 'junction');
await fs.copyFile(BOXING, path.join(photos, 'boxing.jpg'));
const gen = [['card.jpg', 'testsrc2=size=2400x1600', 2400, 1600], ['fractal.jpg', 'mandelbrot=size=1800x1200', 1800, 1200], ['bars.jpg', 'smptehdbars=size=1920x1080', 1920, 1080]];
for (const [name, src] of gen) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', src, '-frames:v', '1', '-q:v', '3', path.join(photos, name)], { windowsHide: true });
  if (r.status !== 0) throw new Error(`ffmpeg ${name}: ${String(r.stderr).slice(0, 200)}`);
}
const specPath = path.join(appRoot, 'spec.json');
await fs.writeFile(specPath, JSON.stringify([{ basename: 'boxing.jpg', width: 564, height: 846 }, ...gen.map(([basename, , width, height]) => ({ basename, width, height }))]));
for (const db of dbPaths(workspace)) {
  const r = spawnSync(ELECTRON, [SEED, 'seed', db, photos, specPath], { env: nodeEnv(), encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error(`seed failed: ${r.stderr || r.stdout}`);
}

const { app, page, errors } = await launchApp(appRoot);
let failed = false;
try {
  await page.evaluate(async () => {
    await window.__parallx_workbench__._services.get({ id: 'IToolEnablementService' }).setEnablement('parallx-community.media-organizer', true);
  });
  await page.waitForTimeout(3_000);
  if ((await cmd(page, 'media-organizer.openTagReview')) !== true) throw new Error('media-organizer.openTagReview not available');
  await page.waitForSelector('.mo-tr-row', { timeout: 20_000 });
  await page.waitForTimeout(1_500);
  const row = (name) => page.locator('.mo-tr-row', { has: page.locator('.mo-tr-name', { hasText: name }) }).first();

  // 1. Approve the boxing photo's picks: BOXING, CROWD, CAMERA.
  await row('boxing.jpg').locator('.mo-tr-row-actions button', { hasText: 'Approve' }).click();
  await page.waitForTimeout(1_200);
  // 2. The No Match photo: add TEST CARD through the suggestion list, then Approve.
  const input = row('card.jpg').locator('.mo-tr-add-input');
  await input.click();
  await input.pressSequentially('test card', { delay: 30 });
  await page.waitForSelector('.mo-tr-suggest', { timeout: 5_000 });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  await row('card.jpg').locator('.mo-tr-row-actions button', { hasText: 'Approve' }).click();
  await page.waitForTimeout(1_500);

  // 3. The keyboard's drop: select the fractal photo, focus the sidebar's
  // ANIMALS › DOG row, Shift+F10, Enter on Apply To 1 Selected Item.
  if ((await cmd(page, 'media-organizer.openGrid')) !== true) throw new Error('media-organizer.openGrid not available');
  await page.waitForSelector('.mo-feed-card, .mo-card', { timeout: 20_000 });
  await page.waitForTimeout(1_500);
  const picked = await page.evaluate(() => {
    const tile = Array.from(document.querySelectorAll('.mo-feed-card')).find((t) => t.querySelector('img')?.alt === 'fractal' && t.getClientRects().length);
    if (tile) { tile.querySelector('.mo-feed-pick')?.click(); return tile.classList.contains('is-selected') ? 'feed' : 'feed, not selected'; }
    return 'no fractal tile';
  });
  const rail = await page.evaluate(() => { const b = Array.from(document.querySelectorAll('.activity-bar-item')).find((x) => /media|atelier/i.test((x.getAttribute('aria-label') || '') + ' ' + (x.dataset.iconId || ''))); if (!b) return 'no rail icon: ' + Array.from(document.querySelectorAll('.activity-bar-item')).map((x) => x.getAttribute('aria-label')).join(','); if (!b.classList.contains('active')) b.click(); return 'opened ' + b.getAttribute('aria-label'); });
  console.log('[probe] sidebar: ' + rail);
  await page.waitForTimeout(1_200);
  const tagsSeg = page.locator('.mo-browse-segbtn', { hasText: 'Tags' }).first();
  if (await tagsSeg.isVisible().catch(() => false)) await tagsSeg.click();
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    const animals = Array.from(document.querySelectorAll('.mo-sidebar-item')).find((r) => r.querySelector('.mo-sidebar-item-label')?.textContent === 'ANIMALS' && r.getClientRects().length);
    animals?.querySelector('.mo-tag-chevron')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await page.waitForTimeout(1_000);
  const focused = await page.evaluate(() => {
    const dog = Array.from(document.querySelectorAll('.mo-sidebar-item')).find((r) => r.querySelector('.mo-sidebar-item-label')?.textContent === 'DOG' && r.getClientRects().length);
    if (!dog) return 'no DOG row; rows: ' + Array.from(document.querySelectorAll('.mo-sidebar-item')).filter((r) => r.getClientRects().length).map((r) => (r.querySelector('.mo-sidebar-item-label')?.textContent || '?') + (r.querySelector('.mo-tag-chevron:not(.mo-tag-chevron-spacer)') ? '>' : '')).join(', ') + ' | segs: ' + Array.from(document.querySelectorAll('.mo-browse-segbtn')).map((b) => b.textContent + (b.getClientRects().length ? '' : '(hidden)')).join('/');
    if (dog.tabIndex < 0) dog.tabIndex = -1;
    dog.focus();
    return document.activeElement === dog ? 'DOG focused' : 'DOG not focusable';
  });
  await page.keyboard.press('Shift+F10');
  await page.waitForTimeout(600);
  const menu = await page.evaluate(() => Array.from(document.querySelectorAll('.context-menu .context-menu-item')).map((i) => i.textContent.trim()).slice(0, 3).join(' | '));
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1_500);
  console.log(`[probe] keyboard drop: ${picked}; ${focused}; menu: ${menu}`);
  console.log(`[probe] renderer errors: ${errors.length ? errors.join(' | ') : 'none'}`);
} catch (err) {
  failed = true;
  console.log(`[probe] failed: ${err && err.message}`);
} finally {
  await app.close().catch(() => {});
}

// Read the database back.
let ok = !failed;
const want = { 'boxing.jpg': ['BOXING', 'CAMERA', 'CROWD', 'EQUIPMENT', 'PEOPLE', 'SPORTS'], 'card.jpg': ['PATTERNS', 'TEST CARD'], 'fractal.jpg': ['ANIMALS', 'DOG', 'PATTERNS'] };
for (const db of dbPaths(workspace)) {
  const r = spawnSync(ELECTRON, [SEED, 'verify', db], { env: nodeEnv(), encoding: 'utf8', windowsHide: true });
  let out;
  try { out = JSON.parse(r.stdout); } catch { console.log(`[probe] ${db}: ${(r.stderr || r.stdout).trim()}`); continue; }
  const touched = (out.tagsOf['boxing.jpg'] || []).length > 0; // the copy the app opened: Approve wrote there
  if (!touched) continue; // the copy the app did not open
  for (const [photo, tags] of Object.entries(want)) {
    const got = (out.tagsOf[photo] || []).slice().sort();
    const pass = JSON.stringify(got) === JSON.stringify(tags);
    if (!pass) ok = false;
    console.log(`[probe] ${pass ? 'ok  ' : 'FAIL'} ${photo}: ${got.join(', ')}${pass ? '' : `  (want ${tags.join(', ')})`}`);
  }
}
await fs.rm(appRoot, { recursive: true, force: true }).catch(() => {});
await fs.rm(workspace, { recursive: true, force: true }).catch(() => {});
console.log(ok ? '[probe] parent tags: applied' : '[probe] parent tags: NOT applied');
process.exit(ok ? 0 : 1);
