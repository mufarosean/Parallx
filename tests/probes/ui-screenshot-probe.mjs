// ui-screenshot-probe.mjs — look at the app without showing it.
//
// Launches the real Electron app HIDDEN (PARALLX_HIDDEN_PROBE) against a
// throwaway data root and workspace (PARALLX_APP_ROOT), drives it through a
// few scenes, and writes PNGs. No window ever appears, and the developer's
// real workspace is never opened: the probe's last-workspace.json points at a
// temp folder it creates itself.
//
// Usage:
//   node tests/probes/ui-screenshot-probe.mjs <outDir> [scene ...]
// Scenes: boot welcome watermark chat autonomy dashboard planner settings
// (default: all). Requires `npm run build` first — the app loads dist/.
//
// It drives the app by scene id (docs/SELF_DESCRIBING_UI_DESIGN.md step 9):
// controls through scene.mjs's click and [data-px-id], the workbench only
// through scene.mjs's helpers. What the app draws but does not declare (a
// video, a photo card, a clip's timeline, pdf.js pages, a layout being
// measured) is read as content, under the surface that holds it.
//
// Why this exists: static analysis and vitest both passed while the mindmap
// board was dead on screen (2026-08-31). UI ships after a capture, not before.

import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { PROJECT_ROOT, launchApp as launchHidden, cmd, click, openFile, setToolEnabled, setSetting, settingSchema, messages, menuRows, pickMenu } from './scene.mjs';

const outDir = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'parallx-probe-shots'));
const requested = process.argv.slice(3);
const ALL_SCENES = ['boot', 'welcome', 'watermark', 'chrome', 'chat', 'autonomy', 'dashboard', 'planner', 'canvas', 'clip', 'project', 'timelapse', 'image', 'sidebar', 'moaudit', 'motrash', 'mofav', 'mofilters', 'moart', 'pdf', 'settings', 'appearance'];
const scenes = requested.length ? requested : ALL_SCENES;

// Media Organizer's library, photo pages, image editor, practice and plans
// open as one editor type; its clip editor and clip projects as another.
const MO = 'media-organizer-grid';
const CLIP = 'media-organizer-clip';
const MO_SIDEBAR = 'mediaOrganizer.browser';
const IMAGE = 'media-organizer-image';
const surface = (id) => `[data-px-surface="${id}"]`;
const ctl = (id) => `[data-px-id="${id}"]`;

async function makeTempRoots() {
  const stamp = Date.now();
  const appRoot = path.join(os.tmpdir(), `parallx-probe-root-${stamp}`);
  const workspace = path.join(os.tmpdir(), `parallx-probe-ws-${stamp}`);
  await fs.mkdir(path.join(appRoot, 'data'), { recursive: true });
  await fs.mkdir(path.join(workspace, 'notes'), { recursive: true });
  await fs.writeFile(path.join(workspace, 'README.md'), '# Probe workspace\n\nA throwaway folder the screenshot probe made.\n');
  await fs.writeFile(path.join(workspace, 'notes', 'siewert.md'), '# Siewert\n\nExcess loss development notes.\n');
  await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: workspace }));
  // Development extensions load from <app root>/ext, so the throwaway root
  // gets a junction to the repo's ext/ (a junction needs no privilege).
  try { await fs.symlink(path.join(PROJECT_ROOT, 'ext'), path.join(appRoot, 'ext'), 'junction'); }
  catch (err) { console.log(`[probe] ext junction failed: ${String(err).split('\n')[0]}`); }
  // A six-second synthetic video with a tone, for the clip editor scene.
  const clip = path.join(workspace, 'probe-clip.mp4');
  const ff = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
    '-t', '6', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', clip], { windowsHide: true });
  if (ff.status !== 0) console.log(`[probe] synthetic clip failed: ${String(ff.stderr || '').slice(0, 200)}`);
  // A second one for the clip project scene (a different picture and length).
  const clip2 = path.join(workspace, 'probe-session-2.mp4');
  const ff2 = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'smptebars=size=640x360:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=48000',
    '-t', '9', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', clip2], { windowsHide: true });
  if (ff2.status !== 0) console.log(`[probe] second clip failed: ${String(ff2.stderr || '').slice(0, 200)}`);
  return { appRoot, workspace, clip, clip2 };
}

// Each entry is [commandId, ...args]; the first that runs wins.
async function runCommand(page, entries) {
  for (const entry of entries) {
    const [id, ...args] = Array.isArray(entry) ? entry : [entry];
    const ok = await cmd(page, id, ...args);
    if (ok === true) return id;
    console.log(`[probe] ${id}: ${ok}`);
  }
  return null;
}

async function scene(name, fn) {
  try { await fn(); } catch (err) { console.log(`[probe] ${name}: failed (${String(err).split('\n')[0]})`); }
}

// Settings and Appearance are centred overlays; Escape closes them.
async function closeSettings(page) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
}

async function shot(page, name) {
  await page.waitForTimeout(600);
  // The hidden window makes no new frame while a <video> sits paused, and a
  // screenshot waits for one: paused videos play (muted) for the shot, then
  // pause again at the time they held.
  const held = await page.evaluate(() => Array.from(document.querySelectorAll('video')).map((v, i) => {
    if (!v.paused || v.readyState < 2) return null;
    const st = { i, t: v.currentTime, muted: v.muted };
    v.muted = true; v.play().catch(() => {});
    return st;
  }).filter(Boolean)).catch(() => []);
  // A still page in the hidden window makes no new frame until something
  // changes: nudge a 1 px dot so the screenshot has a frame to take.
  await nudge(page);
  const file = path.join(outDir, `${name}.png`);
  // A still page in the hidden window sometimes makes no new frame; a missed
  // shot is reported, not a reason to stop the scene.
  let took = await page.screenshot({ path: file, timeout: 8_000 }).then(() => true, () => false);
  // Fallback: the main process captures what the window last drew.
  if (!took && _currentApp) {
    const b64 = await _currentApp.evaluate(async ({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      if (!w) return null;
      const img = await w.webContents.capturePage();
      return img.toPNG().toString('base64');
    }).catch((e) => { console.log(`[probe] ${name}: capturePage failed (${String(e).split('\n')[0]})`); return null; });
    if (b64) { await fs.writeFile(file, Buffer.from(b64, 'base64')); took = true; }
  }
  if (!took) console.log(`[probe] ${name}: no shot`);
  if (held.length) {
    await page.evaluate((list) => {
      const vids = document.querySelectorAll('video');
      for (const st of list) { const v = vids[st.i]; if (!v) continue; v.pause(); v.muted = st.muted; try { v.currentTime = st.t; } catch { /* ignore */ } }
    }, held).catch(() => {});
    await page.waitForTimeout(150);
  }
  if (took) console.log(`[probe] ${name} -> ${file}`);
}

/** A 1 px change the hidden window must draw, so a screenshot has a frame to take. */
async function nudge(page) {
  await page.evaluate(() => {
    let d = document.getElementById('__probe_repaint');
    if (!d) { d = document.createElement('div'); d.id = '__probe_repaint'; d.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;pointer-events:none;z-index:2147483647'; document.body.appendChild(d); }
    d.style.opacity = d.style.opacity === '0.01' ? '0.02' : '0.01';
  }).catch(() => {});
}

async function enableMediaOrganizer(page) {
  // External tools start disabled in a fresh data root; enabling one
  // activates it directly.
  const enabled = await setToolEnabled(page, 'parallx-community.media-organizer', true);
  if (enabled !== true) console.log(`[probe] enable media-organizer: ${enabled}`);
  await page.waitForTimeout(3_000);
}

/** Turns Media Organizer off and on again: its start-up work (a purge, a migration) runs again. */
async function restartMediaOrganizer(page) {
  await setToolEnabled(page, 'parallx-community.media-organizer', false);
  await page.waitForTimeout(2_000);
  await enableMediaOrganizer(page);
}

/** Shows Media Organizer's sidebar (Atelier) if it is not on screen. */
async function showMoSidebar(page) {
  if (await page.locator(surface(MO_SIDEBAR)).first().isVisible().catch(() => false)) return;
  await click(page, 'activitybar.media-organizer-container').catch((e) => console.log(`[probe] no Atelier button (${String(e).split('\n')[0]})`));
  await page.waitForTimeout(1_200);
}

/** The topmost menu as one line: label, (off), <key>, — between groups. 'NO MENU' when none is open. */
async function menuLine(page, { keys = false } = {}) {
  const rows = await menuRows(page);
  if (!rows) return 'NO MENU';
  return rows.map((r) => { const sub = r.key.includes('\u276F'); const key = r.key.replace('\u276F', '').trim(); return `${r.separatorBefore ? '— | ' : ''}${r.label}${r.off ? ' (off)' : ''}${keys && key ? ` <${key}>` : ''}${sub ? ' ›' : ''}`; }).join(' | ');
}

/** The visible controls under a surface whose id starts with `prefix`, each as its text, else its tooltip or name. */
function controlsIn(page, surfaceId, prefix) {
  return page.evaluate(({ surfaceId, prefix }) => Array.from(__px.pane(surfaceId)?.querySelectorAll(`[data-px-id^="${prefix}"]`) || [])
    .filter((b) => b.getClientRects().length)
    .map((b) => (b.textContent.trim() || b.title || b.getAttribute('aria-label') || '').trim()).join(' | '), { surfaceId, prefix });
}

/** Fills the visible field with this id (panes stay mounted behind other tabs, each with its own). */
function fillId(page, id, text) {
  return page.locator(ctl(id)).filter({ visible: true }).first().fill(text);
}

/** Presses the visible control with this id in the page (element.click()). Resolves whether there was one. */
function press(page, id) {
  return page.evaluate((id) => { const b = __px.ctl(id); if (!b) return false; b.click(); return true; }, id);
}

/** Clicks the visible control whose name, text or tooltip is `label`. Resolves whether one was found. */
async function clickLabel(page, label) {
  const id = await page.evaluate((l) => Array.from(document.querySelectorAll('[data-px-id]')).find((b) => b.getClientRects().length && [b.getAttribute('aria-label'), b.textContent.trim(), b.title].includes(l))?.getAttribute('data-px-id'), label);
  if (!id) return false;
  // Pressed in the page: a player's controls fade out, and a real click waits on them.
  return press(page, id);
}

/**
 * A photo card in the library (cards are rows of its list, so content):
 * 'open' double-clicks it, 'menu' right-clicks it, 'pick' clicks it,
 * 'select' ticks its box, 'star' clicks its favourite star.
 */
function moCard(page, name, act) {
  return page.evaluate(({ name, act }) => {
    const c = __px.all('media-organizer-grid', '.mo-card, .mo-list-row').find((x) => (x.textContent || '').includes(name));
    if (!c) return false;
    const r = c.getBoundingClientRect();
    if (act === 'open') c.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    else if (act === 'menu') c.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 20, clientY: r.top + 20 }));
    else if (act === 'pick') c.click();
    else if (act === 'select') c.querySelector('.mo-card-check, .mo-card-select, input[type=checkbox]')?.click();
    else if (act === 'star') c.querySelector('.mo-card-fav')?.click();
    return true;
  }, { name, act });
}

/** The library's count line ("8 items match"). */
function moCount(page) {
  return page.evaluate(() => __px.one('media-organizer-grid', '.mo-page-header .px-page-header__subtitle')?.textContent || '');
}

/** Clicks a fixed place in Media Organizer's sidebar (All Media, Favorites, Untagged, Trash…). */
async function moPlace(page, label) {
  await showMoSidebar(page);
  await click(page, `media-organizer.side.place.${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`);
}

/** Scans `dir` into Media Organizer, the folder dialog answered with it. */
async function moScan(app, page, dir, wait) {
  await app.evaluate(({ dialog }, d) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [d] }); }, dir);
  await runCommand(page, ['media-organizer.scan']);
  await page.waitForTimeout(wait);
}

/** Media Organizer's own database (its extension store, not the workbench). */
const moSql = (page, q, p = []) => page.evaluate(async ({ q, p }) => { const r = await window.parallxElectron.extensionDatabase.all('media-organizer', q, p); return r.rows || r.error; }, { q, p });
const moRun = (page, q, p = []) => page.evaluate(async ({ q, p }) => { const r = await window.parallxElectron.extensionDatabase.run('media-organizer', q, p); return r.error ? JSON.stringify(r.error) : r.changes; }, { q, p });

let _currentApp = null;
// Resize the real window too: the viewport alone does not always follow a second change.
async function resizeWindow(page, width, height) {
  if (_currentApp) await _currentApp.evaluate(({ BrowserWindow }, [w, h]) => { const win = BrowserWindow.getAllWindows()[0]; if (win) { win.unmaximize(); win.setContentSize(w, h); } }, [width, height]).catch(() => {});
  await page.setViewportSize({ width, height }).catch(() => {});
}

/**
 * The hidden app, with a page-side helper for content: __px.pane(id) is the
 * visible surface with that id (panes stay mounted behind other tabs),
 * __px.all(id, sel) and __px.one(id, sel) what matches inside it, and
 * __px.ctl(id) the visible control with that scene id.
 */
async function launchApp(appRoot, errors) {
  const r = await launchHidden(appRoot);
  errors.push(...r.errors);
  r.page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
  r.page.on('console', (m) => { if (m.type() === 'error' && !/ERR_CONNECTION_REFUSED/.test(m.text())) errors.push(`console: ${m.text().slice(0, 300)}`); });
  _currentApp = r.app;
  await installHelpers(r.page);
  return { app: r.app, page: r.page };
}

async function installHelpers(page) {
  await page.evaluate(() => {
    const shown = (e) => !!e && e.getClientRects().length > 0;
    const pane = (id) => Array.from(document.querySelectorAll(`[data-px-surface="${id}"]`)).filter(shown).pop() || null;
    const all = (id, sel) => { const p = pane(id); return p ? Array.from(p.querySelectorAll(sel)) : []; };
    const ctl = (id) => { const els = Array.from(document.querySelectorAll(`[data-px-id="${id}"]`)); return els.find(shown) || els[0] || null; };
    window.__px = { pane, all, one: (id, sel) => all(id, sel)[0] || null, ctl };
  });
}

// A clip project keeps its edits until it is deleted: make one from two
// videos, edit the first, switch videos, quit the app, start it again, and
// read the edits back. Then delete the project.
async function projectScene(appRoot, clip, clip2, errors) {
  const trimState = (page) => page.evaluate(() => {
    const q = (s) => __px.all('media-organizer-clip', s);
    const panel = q('.mo-ce-panel').find((x) => (x.querySelector('.mo-ce-panel-title')?.textContent || '') === 'Trim');
    const tcs = Array.from(panel ? panel.querySelectorAll('.mo-ce-tcfield') : []).map((i) => i.value);
    const name = q('.mo-ce-name')[0]?.textContent || '';
    const badge = q('.mo-ce-toolbar .mo-ce-badge')[0]?.textContent || '';
    const rows = q('.mo-cp-bin .mo-cp-row').map((r) => `${r.querySelector('.mo-cp-row-name')?.textContent}[${r.querySelector('.mo-cp-row-meta')?.textContent}]${r.classList.contains('mo-cp-row--active') ? '*' : ''}`);
    const sub = q('.mo-cp-sub')[0]?.textContent || '';
    const side = Array.from(__px.pane('mediaOrganizer.browser')?.querySelectorAll('.mo-cp-sidebar .mo-sidebar-item-label') || []).map((x) => x.textContent);
    return `editor=${name} trim=${tcs.join('..')} queue=${badge} bin=${rows.join(' | ')} sub="${sub}" sidebar=${side.join(',')}`;
  });
  const seqState = (page) => page.evaluate(() => {
    const q = (s) => __px.all('media-organizer-clip', s);
    const rows = q('.mo-cs-row').map((r) => `${r.querySelector('.mo-cs-num')?.textContent}. ${r.querySelector('.mo-cp-row-name')?.textContent} [${r.querySelector('.mo-cp-row-meta')?.textContent}] ${r.querySelector('.mo-cs-len')?.textContent}`);
    const meta = q('.mo-cs .mo-ce-meta')[0]?.textContent || '';
    const btn = __px.ctl('media-organizer.clipProject.exportSequence')?.textContent || '';
    const st = q('.mo-cs-status')[0]?.textContent || '';
    const seqMeta = __px.ctl('media-organizer.clipProject.sequence')?.querySelector('.mo-cp-row-meta')?.textContent || '';
    return `meta="${meta}" bin="${seqMeta}" button="${btn}" status="${st}" rows=${rows.join(' | ')}`;
  });
  // A video in the project's bin (rows are content): a click opens it.
  const openVideo = async (page, n) => { await page.locator(`${surface(CLIP)} .mo-cp-list .mo-cp-row`).nth(n).click(); await page.waitForTimeout(1_500); };
  const markIn = async (page, t) => {
    await page.evaluate((tt) => { __px.one('media-organizer-clip', 'video').currentTime = tt; }, t);
    await page.waitForTimeout(400);
    await page.evaluate(() => __px.one('media-organizer-clip', '.mo-clip-page')?.focus());
    await page.keyboard.press('i');
    await page.waitForTimeout(300);
    await page.keyboard.press('q');
    await page.waitForTimeout(1_500);
  };
  const exportStatus = (page) => page.evaluate(() => __px.one('media-organizer-clip', '.mo-cs-status')?.textContent || '');
  const exportBusy = (page) => page.evaluate(() => !!__px.ctl('media-organizer.clipProject.exportSequence')?.classList.contains('mo-ce-busy'));
  const waitFor = async (page, test, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await test()) return true; await page.waitForTimeout(300); } return false; };
  // A dropdown by id: open it, step down `steps` options from the chosen one, take it.
  const choose = async (page, id, steps) => { await click(page, id); await page.waitForTimeout(200); for (let i = 0; i < steps; i++) await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); await page.waitForTimeout(200); };
  let { app, page } = await launchApp(appRoot, errors);
  try {
    await enableMediaOrganizer(page);
    // New Clip Project… asks for a name first.
    void cmd(page, 'media-organizer.newClipProject', [clip, clip2]);
    await page.waitForSelector(ctl('inputBox.input'), { timeout: 10_000 });
    await fillId(page, 'inputBox.input', 'Oil study, October');
    await page.keyboard.press('Enter');
    await page.waitForSelector(`${surface(CLIP)} .mo-cp .mo-clip-page`, { timeout: 30_000 });
    await page.waitForTimeout(1_500);
    console.log(`[probe] project @open: ${await trimState(page)}`);
    // Edit the first video: In at 2 s, and queue a clip.
    await markIn(page, 2);
    console.log(`[probe] project @edited: ${await trimState(page)}`);
    await shot(page, 'project');
    // The second video opens untouched; the first comes back as it was left.
    await openVideo(page, 1);
    console.log(`[probe] project @second: ${await trimState(page)}`);
    await openVideo(page, 0);
    console.log(`[probe] project @back: ${await trimState(page)}`);
    // A clip from the second video too; both line up in the Sequence.
    await openVideo(page, 1);
    await markIn(page, 3);
    await click(page, 'media-organizer.clipProject.sequence');
    await page.waitForSelector(`${ctl('media-organizer.clipProject.exportSequence')} >> visible=true`, { state: 'visible', timeout: 10_000 });
    await page.waitForTimeout(800);
    console.log(`[probe] project @sequence: ${await seqState(page)}`);
    await shot(page, 'project-sequence');
    // Export it for real (the save dialog answers with a path in the workspace).
    const seqOut = path.join(path.dirname(clip), 'probe-sequence.mp4');
    await app.evaluate(({ dialog }, out) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: out }); }, seqOut);
    const t0 = Date.now();
    await click(page, 'media-organizer.clipProject.exportSequence');
    await page.waitForTimeout(1_500);
    console.log(`[probe] project @exporting: ${await seqState(page)}`);
    await waitFor(page, async () => /^Exported|failed|cancelled/i.test(await exportStatus(page)) && !(await exportBusy(page)), 180_000);
    const pr = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', seqOut]);
    let probeText = 'no file';
    try { const j = JSON.parse(String(pr.stdout)); probeText = `duration=${Number(j.format.duration).toFixed(2)} streams=${j.streams.map((x) => x.codec_type + (x.width ? `:${x.width}x${x.height}` : '')).join(',')}`; } catch { /* no file */ }
    console.log(`[probe] project @exported (${((Date.now() - t0) / 1000).toFixed(1)} s): ${await seqState(page)} file: ${probeText}`);
    await shot(page, 'project-sequence-done');
    // Cancel: a heavier second export (1920 × 1080 at 60 fps) is stopped
    // mid-render; ffmpeg must die at once and the partial file go.
    await choose(page, 'media-organizer.clipProject.sequence.size', 1);
    await choose(page, 'media-organizer.clipProject.sequence.fps', 1);
    await click(page, 'media-organizer.clipProject.exportSequence');
    await waitFor(page, async () => /Rendering clip 2/.test(await exportStatus(page)), 60_000);
    console.log(`[probe] project @cancel before: ${await seqState(page)}`);
    const tc = Date.now();
    await click(page, 'media-organizer.clipProject.exportSequence');
    await waitFor(page, async () => /cancelled/i.test(await exportStatus(page)) && !(await exportBusy(page)), 60_000);
    const stopMs = Date.now() - tc;
    const left = await fs.stat(seqOut).then(() => 'partial file left', () => 'partial file removed');
    const ffLeft = spawnSync('pgrep', ['-f', 'part_001.mp4']).stdout?.toString().trim();
    console.log(`[probe] project @cancel: stopped in ${stopMs} ms, status="${await exportStatus(page)}" ${left}, ffmpeg ${ffLeft ? 'still running' : 'gone'}`);
    // Double-click a clip in the sequence: its video opens with that clip being edited.
    await page.locator(`${surface(CLIP)} .mo-cs-row`).nth(1).dblclick();
    await page.waitForSelector(`${surface(CLIP)} .mo-cp .mo-clip-page`, { timeout: 15_000 });
    await page.waitForTimeout(1_200);
    console.log(`[probe] project @edit clip: ${await trimState(page)} status="${await page.evaluate(() => __px.all('media-organizer-clip', '.mo-clip-page *').map((e) => e.childElementCount === 0 ? e.textContent : '').find((t) => /^Editing clip/.test(t || '')) || 'no editing note')}"`);
    await openVideo(page, 0);
    // A narrow tab closes the bin to a rail.
    await page.setViewportSize({ width: 820, height: 900 }).catch(() => {});
    await page.waitForTimeout(800);
    await shot(page, 'project-narrow');
    await page.setViewportSize({ width: 1400, height: 900 }).catch(() => {});
    await page.waitForTimeout(800);
  } finally {
    await app.close().catch(() => {});
  }
  // Start again: the project is in the sidebar and opens where it was left.
  ({ app, page } = await launchApp(appRoot, errors));
  try {
    await page.waitForTimeout(2_000);
    await runCommand(page, [['media-organizer.openClipProject', 1]]);
    await page.waitForSelector(`${surface(CLIP)} .mo-cp .mo-clip-page`, { timeout: 30_000 });
    await page.waitForTimeout(1_500);
    console.log(`[probe] project @restart: ${await trimState(page)}`);
    await shot(page, 'project-restart');
    await click(page, 'media-organizer.clipProject.sequence');
    await page.waitForSelector(`${ctl('media-organizer.clipProject.exportSequence')} >> visible=true`, { state: 'visible', timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(800);
    console.log(`[probe] project @restart sequence: ${await seqState(page)}`);
    await openVideo(page, 0);
    // The Media Organizer sidebar lists the project.
    await showMoSidebar(page);
    await page.waitForTimeout(300);
    await shot(page, 'project-sidebar');
    // Delete it from the project's menu.
    await click(page, 'media-organizer.clipProject.actions');
    await page.waitForTimeout(300);
    await pickMenu(page, 'Delete Project…');
    await page.waitForTimeout(500);
    await click(page, 'confirm.ok').catch(() => click(page, 'notification.delete-project'));
    await page.waitForTimeout(1_200);
    const after = await page.evaluate(() => `pageOpen=${!!__px.one('media-organizer-clip', '.mo-cp')} sidebar=${Array.from(__px.pane('mediaOrganizer.browser')?.querySelectorAll('.mo-cp-sidebar .mo-sidebar-item-label') || []).map((x) => x.textContent).join(',')}`);
    console.log(`[probe] project @deleted: ${after}`);
  } finally {
    await app.close().catch(() => {});
  }
}

// Timelapse tools: three segments with the middle one at 4×, the last frame
// held and a before-and-after still, exported for real and measured.
async function timelapseScene(appRoot, clip2, errors) {
  const { app, page } = await launchApp(appRoot, errors);
  try {
    await enableMediaOrganizer(page);
    await runCommand(page, [['media-organizer.openClipEditor', clip2]]);
    await page.waitForSelector(`${surface(CLIP)} ${ctl('media-organizer.clipEditor.export')} >> visible=true`, { state: 'visible', timeout: 20_000 });
    await page.waitForTimeout(1_500);
    for (const t of [3, 6]) {
      await page.evaluate((tt) => { const v = __px.one('media-organizer-clip', 'video'); v.pause(); v.currentTime = tt; }, t);
      await page.waitForTimeout(400);
      await page.evaluate(() => __px.one('media-organizer-clip', '.mo-clip-page')?.focus());
      await page.keyboard.press('s');
      await page.waitForTimeout(300);
    }
    await click(page, 'media-organizer.clipEditor.tab.trim');
    await page.waitForTimeout(300);
    // A segment's speed lives in its row (rows are content).
    const set = await page.evaluate(() => {
      const rows = __px.all('media-organizer-clip', '.mo-clip-segrow').filter((r) => r.querySelector('.mo-ce-segspeed'));
      const sel = rows[1]?.querySelector('.mo-ce-segspeed');
      if (!sel) return `segment rows=${rows.length}, no speed control`;
      sel.value = '4'; sel.dispatchEvent(new Event('change', { bubbles: true }));
      return `segment rows=${rows.length}`;
    });
    await page.waitForTimeout(400);
    await click(page, 'media-organizer.clipEditor.tab.audio');
    await page.waitForTimeout(300);
    await fillId(page, 'media-organizer.clipEditor.holdEnd', '1.5');
    if (!(await page.evaluate(() => __px.ctl('media-organizer.clipEditor.beforeAfter')?.checked))) await click(page, 'media-organizer.clipEditor.beforeAfter');
    await page.waitForTimeout(200);
    await fillId(page, 'media-organizer.clipEditor.beforeAfter.seconds', '2');
    const fin = await page.evaluate(() => `hold=${__px.ctl('media-organizer.clipEditor.holdEnd')?.value} beforeAfter=${!!__px.ctl('media-organizer.clipEditor.beforeAfter')?.checked} secs=${__px.ctl('media-organizer.clipEditor.beforeAfter.seconds')?.value}`);
    await page.waitForTimeout(500);
    const state = await page.evaluate(() => {
      const q = (s) => __px.all('media-organizer-clip', s);
      const segs = q('.mo-clip-segrow').filter((r) => r.querySelector('.mo-ce-segspeed')).map((r) => `${r.querySelector('.mo-clip-queue-meta')?.textContent}@${r.querySelector('.mo-ce-segspeed')?.value}×=${r.querySelector('.mo-ce-seglen')?.textContent}`);
      const blocks = q('.mo-ce-block-num').map((b) => b.textContent);
      return `segs=[${segs.join(' | ')}] blocks=[${blocks.join(',')}] readout="${q('.mo-ce-readout')[0]?.textContent}" export="${__px.ctl('media-organizer.clipEditor.export')?.textContent}"`;
    });
    console.log(`[probe] timelapse: ${set}; ${fin}; ${state}`);
    await shot(page, 'timelapse');
    const out = path.join(path.dirname(clip2), 'probe-timelapse.mp4');
    await app.evaluate(({ dialog }, o) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: o }); }, out);
    const t0 = Date.now();
    await click(page, 'media-organizer.clipEditor.export');
    await page.waitForFunction(() => !!__px.ctl('media-organizer.clipEditor.toast.dismiss')?.getClientRects().length || /failed/i.test(__px.one('media-organizer-clip', '.mo-clip-status')?.textContent || ''), null, { timeout: 180_000 }).catch(() => {});
    const pr = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', out]);
    let probeText = 'no file';
    try { const j = JSON.parse(String(pr.stdout)); probeText = `duration=${Number(j.format.duration).toFixed(2)} (want 10.25) streams=${j.streams.map((x) => x.codec_type).join(',')}`; } catch { /* no file */ }
    console.log(`[probe] timelapse export (${((Date.now() - t0) / 1000).toFixed(1)} s): ${probeText}`);
    if (probeText !== 'no file') {
      spawnSync('ffmpeg', ['-v', 'error', '-y', '-ss', '7.5', '-i', out, '-frames:v', '1', path.join(outDir, 'timelapse-hold.png')]);
      spawnSync('ffmpeg', ['-v', 'error', '-y', '-ss', '9.3', '-i', out, '-frames:v', '1', path.join(outDir, 'timelapse-before-after.png')]);
    }
  } finally {
    await app.close().catch(() => {});
  }
}

// The image editor: a folder of photos is scanned, one opens in Edit Image,
// and each tool is shot (dark, then light, then a narrow window).
// The filter pills: Tags (include, leave out), Favorites, Date (a quick
// choice, then taken), Clear. Logs each pill and the match count.
async function moFiltersScene(appRoot, workspace, errors) {
  const media = path.join(workspace, 'filtertest');
  await fs.mkdir(media, { recursive: true });
  const ff = (args) => spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
  ff(['-f', 'lavfi', '-i', 'mandelbrot=s=640x480', '-frames:v', '1', '-q:v', '4', path.join(media, 'beach1.jpg')]);
  ff(['-f', 'lavfi', '-i', 'cellauto=s=640x480:rule=30', '-frames:v', '1', '-q:v', '4', path.join(media, 'beach2.jpg')]);
  ff(['-f', 'lavfi', '-i', 'cellauto=s=640x480:rule=90', '-frames:v', '1', '-q:v', '4', path.join(media, 'sky.jpg')]);
  const { app, page } = await launchApp(appRoot, errors);
  const log = (k, v) => console.log(`[probe] filters ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
  // The pill bar: each of its children as text, * when set (aria-pressed).
  const pills = () => page.evaluate(() => Array.from(__px.ctl('media-organizer.filter.tags')?.parentElement?.children || []).filter((p) => p.offsetParent).map((p) => `${p.textContent.trim()}${p.getAttribute('aria-pressed') === 'true' ? '*' : ''}`).join(' | '));
  const count = () => moCount(page);
  const pill = (k) => click(page, `media-organizer.filter.${k}`).catch((e) => log(`no pill ${k}`, String(e).split('\n')[0]));
  // A tag in the Tags pill's list (its rows are content, next to its search field).
  const row = (name) => page.evaluate((n) => {
    let p = __px.ctl('media-organizer.filter.tagSearch');
    while (p && !p.querySelector('.mo-tagpick-row')) p = p.parentElement;
    Array.from(p?.querySelectorAll('.mo-tagpick-row') || []).find((r) => r.textContent.trim() === n)?.click();
  }, name);
  try {
    await enableMediaOrganizer(page);
    await moScan(app, page, media, 5_000);
    await moRun(page, `INSERT INTO mo_tags (name) VALUES ('beach'), ('sky')`);
    await moRun(page, `INSERT INTO mo_photos_tags (photo_id, tag_id, via_parent_id) SELECT pf.photo_id, (SELECT id FROM mo_tags WHERE name = 'beach'), 0 FROM mo_photos_files pf JOIN mo_files f ON f.id = pf.file_id WHERE f.basename LIKE 'beach%'`);
    await moRun(page, `INSERT INTO mo_photos_tags (photo_id, tag_id, via_parent_id) SELECT pf.photo_id, (SELECT id FROM mo_tags WHERE name = 'sky'), 0 FROM mo_photos_files pf JOIN mo_files f ON f.id = pf.file_id WHERE f.basename IN ('sky.jpg', 'beach2.jpg')`);
    await moRun(page, `UPDATE mo_photos SET rating = 1 WHERE id IN (SELECT pf.photo_id FROM mo_photos_files pf JOIN mo_files f ON f.id = pf.file_id WHERE f.basename = 'beach1.jpg')`);
    await moRun(page, `UPDATE mo_photos SET taken_at = '2019-05-04T10:00:00' WHERE id IN (SELECT pf.photo_id FROM mo_photos_files pf JOIN mo_files f ON f.id = pf.file_id WHERE f.basename = 'sky.jpg')`);
    await runCommand(page, ['media-organizer.openGrid']);
    await page.waitForTimeout(3_000);
    await press(page, 'media-organizer.layout.grid');
    await page.waitForTimeout(1_500);
    log('start', `${await pills()} / ${await count()}`);
    await shot(page, 'filters-pills');
    // Photos, GIFs and Videos are pills too: all on, a click takes one out, the last stays.
    await click(page, 'media-organizer.filter.type.videos');
    await page.waitForTimeout(1_200);
    log('videos off', `${await pills()} / ${await count()}`);
    await click(page, 'media-organizer.filter.type.gifs');
    await page.waitForTimeout(1_200);
    log('photos only', `${await pills()} / ${await count()}`);
    await click(page, 'media-organizer.filter.type.photos');
    await page.waitForTimeout(800);
    log('last one stays', `${await pills()} / ${await count()}`);
    await shot(page, 'filters-type-pills');
    await click(page, 'media-organizer.filter.clearPills');
    await page.waitForTimeout(1_200);
    log('types back', `${await pills()} / ${await count()}`);
    await pill('tags');
    await page.waitForTimeout(800);
    await row('beach');
    await page.waitForTimeout(1_200);
    log('include beach', `${await pills()} / ${await count()}`);
    await row('sky');
    await page.waitForTimeout(400);
    await row('sky');
    await page.waitForTimeout(1_200);
    log('beach, not sky', `${await pills()} / ${await count()}`);
    await shot(page, 'filters-tags-pop');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await click(page, 'media-organizer.filter.tags.clear');
    await page.waitForTimeout(1_000);
    log('tags cleared', `${await pills()} / ${await count()}`);
    await pill('fav');
    await page.waitForTimeout(1_200);
    log('favorites', `${await pills()} / ${await count()}`);
    await pill('fav');
    await page.waitForTimeout(1_000);
    await pill('date');
    await page.waitForTimeout(500);
    await click(page, 'media-organizer.filter.date.month');
    await page.waitForTimeout(1_200);
    log('this month (added)', `${await pills()} / ${await count()}`);
    await click(page, 'media-organizer.filter.date.taken');
    await page.waitForTimeout(1_200);
    log('this month (taken)', `${await pills()} / ${await count()}`);
    await shot(page, 'filters-date-pop');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await click(page, 'media-organizer.filter.clearPills');
    await page.waitForTimeout(1_200);
    log('cleared', `${await pills()} / ${await count()}`);
    // A tag's right-click: New Child Tag… files the new tag under it.
    await showMoSidebar(page);
    await click(page, 'media-organizer.side.tags');
    await page.waitForTimeout(1_200);
    // Tags went in by SQL; a filter keystroke reloads the list.
    await fillId(page, 'media-organizer.side.tagFilter', 'b');
    await fillId(page, 'media-organizer.side.tagFilter', '');
    await page.waitForTimeout(1_200);
    const tagRows = () => page.evaluate(() => __px.all('mediaOrganizer.browser', '.mo-tag-row'));
    void tagRows;
    log('tag rows before', await page.evaluate(() => { const rows = __px.all('mediaOrganizer.browser', '.mo-tag-row'); return `${rows.length} rows, sidebar ${__px.pane('mediaOrganizer.browser') ? 'shown' : 'hidden'}: ` + rows.map((r) => r.textContent.trim()).join(', '); }));
    await page.evaluate(() => { const r = __px.all('mediaOrganizer.browser', '.mo-tag-row').find((x) => /beach/i.test(x.textContent)); if (r) { const b = r.getBoundingClientRect(); r.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: b.left + 20, clientY: b.top + 5 })); } });
    await page.waitForTimeout(400);
    log('tag menu', await menuLine(page));
    await pickMenu(page, /New Child Tag/);
    await page.waitForTimeout(500);
    log('dialog', await page.evaluate(() => { const t = __px.ctl('media-organizer.createTag.names'); let p = t; while (p && !p.querySelector('h3')) p = p.parentElement; return t ? (p?.querySelector('h3')?.textContent || 'dialog without a title') : 'no dialog'; }));
    await shot(page, 'filters-child-tag-dialog');
    await fillId(page, 'media-organizer.createTag.names', 'Sunset');
    await click(page, 'media-organizer.createTag.create');
    await page.waitForTimeout(1_500);
    log('relation', JSON.stringify(await moSql(page, `SELECT c.name AS child, p.name AS parent FROM mo_tags_relations r JOIN mo_tags c ON c.id = r.child_id JOIN mo_tags p ON p.id = r.parent_id`)));
    log('tag rows', await page.evaluate(() => __px.all('mediaOrganizer.browser', '.mo-tag-row').map((r) => `${r.querySelector('.mo-sidebar-item-label')?.textContent || r.textContent.trim()}@${r.style.paddingLeft}`).join(' | ')));
    await shot(page, 'filters-child-tag');
  } finally {
    await app.close().catch(() => {});
  }
}

// The video player on a video's page, and the art tools (Daily Study,
// Practice Session, Painting Plans) as they stand, for a UI review.
async function moArtScene(appRoot, workspace, errors) {
  const media = path.join(workspace, 'arttest');
  await fs.mkdir(media, { recursive: true });
  const ff = (args) => spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
  ff(['-f', 'lavfi', '-i', 'mandelbrot=s=960x720', '-frames:v', '1', '-q:v', '3', path.join(media, 'harbour.jpg')]);
  ff(['-f', 'lavfi', '-i', 'cellauto=s=720x960:rule=30', '-frames:v', '1', '-q:v', '3', path.join(media, 'figure.jpg')]);
  ff(['-f', 'lavfi', '-i', 'life=s=800x600:mold=10:ratio=0.3', '-frames:v', '1', '-q:v', '3', path.join(media, 'still-life.jpg')]);
  ff(['-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=30:d=12', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=12', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path.join(media, 'studio-session.mp4')]);
  const { app, page } = await launchApp(appRoot, errors);
  const log = (k, v) => console.log(`[probe] art ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
  // The video's page: its player is content of the page.
  const pageVideo = (fn) => page.evaluate(fn);
  const lightboxVideo = (fn) => page.evaluate(fn);
  try {
    await enableMediaOrganizer(page);
    await moScan(app, page, media, 8_000);
    await runCommand(page, ['media-organizer.openGrid']);
    await page.waitForTimeout(3_000);
    await press(page, 'media-organizer.layout.grid');
    await page.waitForTimeout(1_500);
    // The video's page: the player (filmstrip scrubber, one row of controls).
    await moCard(page, 'studio-session', 'open');
    await page.waitForTimeout(4_000);
    log('player', await page.evaluate(() => __px.one('media-organizer-grid', '.mo-detail-preview .mo-player') ? 'found' : 'MISSING'));
    log('header', `${await page.evaluate(() => __px.one('media-organizer-grid', '.mo-detail-header-meta')?.textContent || 'no meta')} | ${await controlsIn(page, MO, 'media-organizer.viewer.')}`);
    log('controls', await controlsIn(page, MO, 'media-organizer.player.'));
    log('frames', await page.evaluate(() => __px.all('media-organizer-grid', '.mo-detail-preview .mo-player-strip-frame').length));
    await pageVideo(() => { const v = __px.one('media-organizer-grid', '.mo-detail-preview .mo-player-video'); if (v) { v.muted = true; v.currentTime = 2.5; } });
    await page.waitForTimeout(600);
    await pageVideo(() => __px.one('media-organizer-grid', '.mo-detail-preview .mo-player')?.focus());
    await page.keyboard.press('BracketLeft');
    await pageVideo(() => { __px.one('media-organizer-grid', '.mo-detail-preview .mo-player-video').currentTime = 7.25; });
    await page.waitForTimeout(600);
    await page.keyboard.press('BracketRight');
    await page.keyboard.press('Period');
    await page.waitForTimeout(500);
    log('marks', `${(await controlsIn(page, MO, 'media-organizer.player.')).split(' | ').filter((t) => /^(In|Out)/.test(t)).join(' , ')} / ${await page.evaluate(() => __px.one('media-organizer-grid', '.mo-detail-preview .mo-player-readout')?.textContent)}`);
    const sb = await page.evaluate(() => { const r = __px.one('media-organizer-grid', '.mo-detail-preview .mo-player-strip')?.getBoundingClientRect(); return r ? { x: r.left + r.width * 0.62, y: r.top + r.height / 2 } : null; });
    if (sb) await page.mouse.move(sb.x, sb.y);
    await page.waitForTimeout(900);
    await shot(page, 'art-video-page');
    await clickLabel(page, 'Loop');
    await pageVideo(() => { const v = __px.one('media-organizer-grid', '.mo-detail-preview .mo-player-video'); v.currentTime = 7.1; v.play(); });
    await page.waitForTimeout(1_500);
    log('loop wraps to In', await pageVideo(() => __px.one('media-organizer-grid', '.mo-detail-preview .mo-player-video').currentTime.toFixed(2)));
    await pageVideo(() => __px.one('media-organizer-grid', '.mo-detail-preview .mo-player-video').pause());
    await page.evaluate(() => document.documentElement.setAttribute('data-px-mode', 'light'));
    await page.waitForTimeout(800);
    await shot(page, 'art-video-page-light');
    await page.evaluate(() => document.documentElement.removeAttribute('data-px-mode'));
    await resizeWindow(page, 900, 800);
    await page.waitForTimeout(1_000);
    await shot(page, 'art-video-page-narrow');
    await resizeWindow(page, 1400, 900);
    await page.waitForTimeout(800);
    // The library viewer: the same player in the viewer's colours.
    await runCommand(page, ['media-organizer.openGrid']);
    await page.waitForTimeout(2_000);
    await moCard(page, 'studio-session', 'menu');
    await page.waitForTimeout(500);
    await pickMenu(page, /View Full Size/);
    await page.waitForTimeout(4_000);
    log('viewer', `${await lightboxVideo(() => __px.one('media-organizer.lightbox', '.mo-player') ? 'player' : 'NO PLAYER')} | bar: ${(await controlsIn(page, 'media-organizer.lightbox', 'media-organizer.lightbox.')) || 'none'}`);
    log('viewer playing', await lightboxVideo(() => { const v = __px.one('media-organizer.lightbox', '.mo-player-video'); return v ? `${!v.paused} at ${v.currentTime.toFixed(2)}` : 'none'; }));
    await lightboxVideo(() => { const v = __px.one('media-organizer.lightbox', '.mo-player-video'); if (v) v.muted = true; });
    await page.keyboard.press('Space');
    await page.waitForTimeout(300);
    log('space pauses', await lightboxVideo(() => __px.one('media-organizer.lightbox', '.mo-player-video')?.paused));
    await page.keyboard.press('BracketLeft');
    await page.waitForTimeout(300);
    log('viewer marks', await controlsIn(page, 'media-organizer.lightbox', 'media-organizer.player.'));
    await page.mouse.move(700, 450);
    await shot(page, 'art-video-viewer');
    await page.locator(ctl('media-organizer.lightbox.previous')).first().screenshot({ path: path.join(outDir, 'art-video-viewer-prev.png'), timeout: 5_000 }).catch((e) => log('prev shot', String(e).split('\n')[0]));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
    log('viewer closed', await page.evaluate(() => !__px.pane('media-organizer.lightbox')));
    // Art tools on.
    await setSetting(page, 'mediaOrganizer.enableArtTools', true);
    await page.waitForTimeout(1_500);
    await runCommand(page, ['media-organizer.openGrid']);
    await page.waitForTimeout(2_500);
    await showMoSidebar(page);
    log('sidebar', await page.evaluate(() => __px.all('mediaOrganizer.browser', '.mo-sidebar-item-label').map((x) => x.textContent).join(' | ')));
    await shot(page, 'art-library');
    await press(page, 'media-organizer.layout.feed');
    await page.waitForTimeout(1_500);
    await shot(page, 'art-library-feed');
    // Practice Session setup, then a run.
    await runCommand(page, ['media-organizer.practiceSession']);
    await page.waitForTimeout(2_500);
    log('practice setup buttons', await controlsIn(page, MO, 'media-organizer.practice.'));
    await shot(page, 'art-practice-setup');
    await click(page, 'media-organizer.practice.start');
    await page.waitForTimeout(3_000);
    await page.mouse.move(800, 450);
    await page.waitForTimeout(150);
    await page.mouse.move(820, 470);
    log('practice player buttons', await controlsIn(page, MO, 'media-organizer.practice.player.'));
    await shot(page, 'art-practice-player');
    await clickLabel(page, 'Stop');
    await page.waitForTimeout(1_500);
    await shot(page, 'art-practice-after');
    // Daily Study.
    await runCommand(page, ['media-organizer.dailyStudy']);
    await page.waitForTimeout(3_000);
    await page.mouse.move(800, 450);
    await page.waitForTimeout(150);
    await page.mouse.move(820, 470);
    await shot(page, 'art-daily');
    await clickLabel(page, 'Stop');
    await page.waitForTimeout(1_000);
    // Painting Plans: empty list, then a plan from a photo.
    await runCommand(page, ['media-organizer.paintingPlans']);
    await page.waitForTimeout(2_000);
    await shot(page, 'art-plans-empty');
    await runCommand(page, ['media-organizer.openGrid']);
    await page.waitForTimeout(2_000);
    await press(page, 'media-organizer.layout.grid');
    await page.waitForTimeout(1_500);
    await moCard(page, 'harbour', 'menu');
    await page.waitForTimeout(500);
    await pickMenu(page, /Plan Painting/);
    await page.waitForTimeout(4_000);
    log('plan tools', await page.evaluate(() => Array.from(__px.pane('media-organizer-grid')?.querySelectorAll('[data-px-id^="media-organizer.plan.tool."]') || []).map((b) => b.title || b.getAttribute('aria-label')).join(' | ')));
    await shot(page, 'art-plan-light');
    for (const t of ['Crop', 'Values', 'Composition', 'Palette', 'Compare', 'Process', 'Plan']) {
      const tid = await page.evaluate((t) => Array.from(__px.pane('media-organizer-grid')?.querySelectorAll('[data-px-id^="media-organizer.plan.tool."]') || []).find((b) => b.title === t)?.getAttribute('data-px-id'), t);
      if (tid) await click(page, tid); else log(`no tool ${t}`, '');
      await page.waitForTimeout(1_200);
      await shot(page, `art-plan-${t.toLowerCase()}`);
    }
    await runCommand(page, ['media-organizer.paintingPlans']);
    await page.waitForTimeout(2_000);
    await shot(page, 'art-plans-list');
    // A photo's page with the art tools on.
    await runCommand(page, ['media-organizer.openGrid']);
    await page.waitForTimeout(2_000);
    await moCard(page, 'harbour', 'open');
    await page.waitForTimeout(2_500);
    await shot(page, 'art-photo-page');
    await resizeWindow(page, 900, 800);
    await page.waitForTimeout(800);
    await runCommand(page, ['media-organizer.practiceSession']);
    await page.waitForTimeout(1_500);
    await shot(page, 'art-practice-setup-narrow');
  } finally {
    await app.close().catch(() => {});
  }
}

// Favorites in place of star ratings: a card's star, the F key, the menu,
// the Favorites view and filter, the detail page, and old ratings migrated.
// The PDF viewer: a generated four-page PDF with an outline, opened from the
// explorer. Toolbar, thumbnails, outline, find, menus, a highlight and its
// panel, night reading, light mode and a narrow window.
async function pdfScene(appRoot, workspace, errors) {
  const pdfPath = path.join(workspace, 'probe-reading.pdf');
  // The cloud container keeps its browser outside Playwright's cache; locally
  // Playwright finds its own.
  const cloudChrome = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
  const hasCloudChrome = await fs.access(cloudChrome).then(() => true, () => false);
  const browser = await chromium.launch(hasCloudChrome ? { executablePath: cloudChrome } : {});
  try {
    const p = await browser.newPage();
    const para = 'Excess loss development follows the reported pattern closely in the early years and then flattens. The tail factor is chosen from the industry curve and checked against the company triangle. ';
    const sec = (n, t) => `<h1>${n}. ${t}</h1><p>${para.repeat(6)}</p><h2>${n}.1 Method</h2><p>${para.repeat(5)}</p><h2>${n}.2 Results</h2><p>${para.repeat(5)}</p>`;
    await p.setContent(`<html><body style="font:12pt Georgia;margin:0">${[['Introduction'], ['Data'], ['Development'], ['Conclusions']].map(([t], i) => `<section style="page-break-after:always">${sec(i + 1, t)}</section>`).join('')}</body></html>`);
    await p.pdf({ path: pdfPath, format: 'Letter', margin: { top: '1in', bottom: '1in', left: '1in', right: '1in' }, tagged: true, outline: true });
  } finally { await browser.close(); }
  const { app, page } = await launchApp(appRoot, errors);
  const PDF = 'parallx.editor.pdf';
  try {
    // The toolbar's controls come from the scene; the pages, outline,
    // thumbnails and find count are pdf.js content under the viewer.
    const state = () => page.evaluate(() => {
      const pane = __px.pane('parallx.editor.pdf');
      const q = (s) => pane ? pane.querySelector(s) : null;
      const btns = Array.from(pane?.querySelectorAll('[data-px-id^="pdf."]') || []).filter((b) => b.tagName === 'BUTTON' && b.getClientRects().length && !b.closest('[data-px-surface="pdf.selection"]'))
        .map((b) => `${b.getAttribute('aria-label') || b.title || '?'}${b.disabled ? '(off)' : ''}${b.classList.contains('active') ? '*' : ''}`);
      const tb = q('.pdf-toolbar');
      return `toolbar=${tb?.clientWidth}/${tb?.scrollWidth} page="${__px.ctl('pdf.page')?.value}/${q('.pdf-toolbar-page-total')?.textContent}" zoom="${__px.ctl('pdf.zoom')?.value}" btns=[${btns.join(', ')}] outline=${pane?.querySelectorAll('.pdf-outline-title').length} thumbs=${pane?.querySelectorAll('.pdf-thumbnail-item').length} match="${q('.pdf-find-count')?.textContent || ''}"`;
    });
    await openFile(page, 'probe-reading.pdf');
    await page.waitForSelector(`${surface(PDF)} .pdfViewer .page canvas`, { timeout: 20_000 });
    await page.waitForTimeout(2_500);
    console.log(`[probe] pdf: ${await state()}`);
    console.log(`[probe] pdf focus after open: ${await page.evaluate(() => { const a = document.activeElement; return `${a?.tagName}.${a?.className?.toString().slice(0, 40)} inPane=${!!a?.closest('[data-px-surface="parallx.editor.pdf"]')}`; })}`);
    console.log(`[probe] pdf page box: ${await page.evaluate(() => {
      const pg = __px.one('parallx.editor.pdf', '.pdfViewer .page'); const cs = getComputedStyle(pg); const r = pg.getBoundingClientRect();
      const cw = pg.querySelector('.canvasWrapper')?.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + 4, r.top + 200);
      const ct = __px.one('parallx.editor.pdf', '.pdf-viewer-container');
      return `scrollTop=${ct.scrollTop} containerTop=${Math.round(ct.getBoundingClientRect().top)} cwShadow="${cw ? getComputedStyle(pg.querySelector('.canvasWrapper')).boxShadow : ''}" page=${Math.round(r.left)}..${Math.round(r.right)} top=${Math.round(r.top)} border="${cs.borderLeftWidth} ${cs.borderLeftStyle} ${cs.borderLeftColor}" bg=${cs.backgroundColor} clip=${cs.backgroundClip} shadow="${cs.boxShadow}" canvas=${Math.round(cw?.left)}..${Math.round(cw?.right)} hitAtBorder=${hit?.className} viewerPad="${getComputedStyle(__px.one('parallx.editor.pdf', '.pdfViewer')).padding}" containerBg=${getComputedStyle(ct).backgroundColor}`;
    })}`);
    await shot(page, 'pdf');
    const clickBtn = async (id) => {
      await click(page, id).catch((e) => console.log(`[probe] pdf: no toolbar button ${id} (${String(e).split('\n')[0]})`));
      await page.waitForTimeout(900);
    };
    const panel = () => page.evaluate(() => {
      const pane = __px.pane('parallx.editor.pdf');
      const p = __px.ctl('pdf.panelSide');
      const seg = Array.from(p?.children || []).map((b) => `${b.textContent}${b.getAttribute('aria-checked') === 'true' || b.getAttribute('aria-pressed') === 'true' || b.getAttribute('aria-selected') === 'true' ? '*' : ''}`).join('|');
      const pages = Array.from(pane?.querySelectorAll('.pdf-outline-page') || []).map((x) => x.textContent).join(',');
      return `open=${!!p?.getClientRects().length} seg=${seg} outlinePages=[${pages}] current="${pane?.querySelector('.pdf-outline-item.is-current .pdf-outline-title')?.textContent || ''}" thumbActive=${pane?.querySelector('.pdf-thumbnail-active .pdf-thumbnail-label')?.textContent}`;
    });
    const side = (label) => page.locator(ctl('pdf.panelSide')).getByText(label, { exact: true }).click();
    console.log(`[probe] pdf toolbar names: ${await page.evaluate(() => Array.from(__px.pane('parallx.editor.pdf')?.querySelectorAll('[data-px-id^="pdf."]') || []).filter((b) => b.getClientRects().length && !b.closest('[data-px-surface="pdf.selection"]') && /^(BUTTON|INPUT)$/.test(b.tagName)).map((b) => b.getAttribute('aria-label') || '?').join(' | '))}`);
    // Side panel: Outline, then Pages.
    await clickBtn('pdf.panel');
    console.log(`[probe] pdf panel: ${await panel()}`);
    await shot(page, 'pdf-outline');
    // Read on: page 3, so the current section moves.
    await page.evaluate(() => { const v = __px.one('parallx.editor.pdf', '.pdf-viewer-container'); const p3 = v.querySelector('.pdfViewer .page[data-page-number="3"]'); v.scrollTop = p3.offsetTop + 40; });
    await page.waitForTimeout(900);
    console.log(`[probe] pdf panel at page 3: ${await panel()}`);
    await shot(page, 'pdf-outline-p3');
    await side('Pages');
    await page.waitForTimeout(1_500);
    console.log(`[probe] pdf panel pages: ${await panel()}`);
    await shot(page, 'pdf-pages');
    await clickBtn('pdf.panel');
    await page.evaluate(() => { __px.one('parallx.editor.pdf', '.pdf-viewer-container').scrollTop = 0; });
    await page.waitForTimeout(600);
    // Find, from Ctrl+F with focus in the explorer.
    await page.keyboard.press('Control+f');
    await page.waitForTimeout(400);
    await page.keyboard.type('tail factor');
    await page.waitForTimeout(1_500);
    console.log(`[probe] pdf find: ${await state()}`);
    await shot(page, 'pdf-find');
    const whole = await page.evaluate(() => Array.from(document.querySelectorAll('[data-px-id^="pdf.search."]')).find((b) => /whole/.test(b.getAttribute('data-px-id')))?.getAttribute('data-px-id'));
    if (whole) await click(page, whole); else console.log('[probe] pdf: no whole-word toggle');
    await page.locator(ctl('pdf.search.query')).first().focus();
    await page.keyboard.press('Control+a');
    await page.keyboard.type('tail fact');
    await page.waitForTimeout(1_200);
    console.log(`[probe] pdf find whole word "tail fact": ${await state()}`);
    await shot(page, 'pdf-find-none');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    console.log(`[probe] pdf find closed: shown=${await page.evaluate(() => !!__px.ctl('pdf.search.query')?.getClientRects().length)}`);
    // Select a line: the bubble.
    const box = await page.evaluate(() => {
      const spans = __px.all('parallx.editor.pdf', '.pdfViewer .page[data-page-number="1"] .textLayer span').filter((s) => (s.textContent || '').length > 30);
      const s = spans[3]; if (!s) return null;
      const r = s.getBoundingClientRect(); return { x: r.left + 2, y: r.top + r.height / 2, w: r.width };
    });
    if (box) {
      const select = async () => {
        await page.mouse.move(box.x, box.y);
        await page.mouse.down();
        await page.mouse.move(box.x + box.w * 0.7, box.y, { steps: 8 });
        await page.mouse.up();
        // The hidden window draws no frame on its own, and the bubble waits
        // for one: nudge a repaint.
        await nudge(page);
        await page.screenshot({ timeout: 4_000 }).catch(() => {});
        await page.waitForTimeout(500);
      };
      await select();
      const bubble = await page.evaluate(() => { const b = __px.pane('pdf.selection'); return b ? Array.from(b.querySelectorAll('[data-px-id]')).map((x) => x.getAttribute('aria-label')).join(' | ') : 'NONE'; });
      console.log(`[probe] pdf bubble: ${bubble}, menu=${!!(await menuRows(page))}`);
      await shot(page, 'pdf-bubble');
      // Right-click the selection: the short menu, Highlight submenu open.
      await page.mouse.click(box.x + box.w * 0.3, box.y, { button: 'right' });
      await page.waitForTimeout(600);
      console.log(`[probe] pdf right-click menu: ${(await menuRows(page))?.map((r) => r.label).join(' | ') ?? 'NO MENU'}`);
      const hiId = (await menuRows(page))?.find((r) => r.label === 'Highlight')?.id;
      if (hiId) { await page.locator(ctl(hiId)).last().hover(); await page.waitForTimeout(700); }
      await shot(page, 'pdf-menu');
      await page.keyboard.press('Escape');
      await page.mouse.click(5, 450);
      await page.waitForTimeout(300);
      // Highlight from the bubble (green), then open its panel.
      await select();
      await click(page, 'pdf.selection.highlight.green').catch(() => {});
      await page.waitForTimeout(900);
      console.log(`[probe] pdf highlight made: boxes=${await page.evaluate(() => __px.all('parallx.editor.pdf', '.pdf-highlight-box').length)} bubbleGone=${await page.evaluate(() => !__px.pane('pdf.selection'))}`);
      await page.mouse.move(box.x + 40, box.y + 30);
      await page.waitForTimeout(400);
      // The highlight's tab is drawn on the page: content, clicked where it is.
      const tab = await page.evaluate(() => { const t = __px.one('parallx.editor.pdf', '.pdf-highlight-tab'); if (!t) return null; const r = t.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
      if (tab) {
        await page.mouse.click(tab.x, tab.y); await page.waitForTimeout(900);
        await shot(page, 'pdf-highlight-panel');
        await page.evaluate(() => document.documentElement.setAttribute('data-px-mode', 'light'));
        await page.waitForTimeout(600);
        await shot(page, 'pdf-highlight-panel-light');
        await page.evaluate(() => document.documentElement.removeAttribute('data-px-mode'));
        await page.mouse.click(700, 160); await page.waitForTimeout(400);
      }
    }
    await clickBtn('pdf.nightReading');
    await shot(page, 'pdf-night');
    await clickBtn('pdf.nightReading');
    await page.evaluate(() => document.documentElement.setAttribute('data-px-mode', 'light'));
    await page.waitForTimeout(800);
    await clickBtn('pdf.panel');
    await side('Outline');
    await page.waitForTimeout(600);
    await page.keyboard.press('Control+f');
    await page.waitForTimeout(300);
    await page.keyboard.type('tail factor');
    await page.waitForTimeout(1_200);
    await shot(page, 'pdf-light');
    await page.keyboard.press('Escape');
    await page.evaluate(() => document.documentElement.removeAttribute('data-px-mode'));
    await resizeWindow(page, 760, 820);
    await page.waitForTimeout(1_200);
    console.log(`[probe] pdf narrow: ${await state()} ${await panel()}`);
    await shot(page, 'pdf-narrow');
  } finally {
    await app.close().catch(() => {});
  }
}

async function moFavScene(appRoot, workspace, errors) {
  const media = path.join(workspace, 'favtest');
  await fs.mkdir(media, { recursive: true });
  const ff = (args) => spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
  ff(['-f', 'lavfi', '-i', 'mandelbrot=s=640x480', '-frames:v', '1', '-q:v', '4', path.join(media, 'alpha.jpg')]);
  ff(['-f', 'lavfi', '-i', 'cellauto=s=640x480:rule=30', '-frames:v', '1', '-q:v', '4', path.join(media, 'beta.jpg')]);
  ff(['-f', 'lavfi', '-i', 'cellauto=s=640x480:rule=90', '-frames:v', '1', '-q:v', '4', path.join(media, 'gamma.jpg')]);
  const { app, page } = await launchApp(appRoot, errors);
  const log = (k, v) => console.log(`[probe] fav ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
  const ratings = async () => JSON.stringify(await moSql(page, `SELECT f.basename AS f, p.rating AS r FROM mo_photos p JOIN mo_photos_files pf ON pf.photo_id = p.id JOIN mo_files f ON f.id = pf.file_id ORDER BY f.basename`));
  try {
    await enableMediaOrganizer(page);
    await moScan(app, page, media, 5_000);
    // Old star ratings, as a library from before would have them; restart to migrate.
    await moRun(page, `UPDATE mo_photos SET rating = 4 WHERE id IN (SELECT pf.photo_id FROM mo_photos_files pf JOIN mo_files f ON f.id = pf.file_id WHERE f.basename = 'gamma.jpg')`);
    await moRun(page, `DELETE FROM mo_settings WHERE key = 'favorites_from_ratings'`);
    await setToolEnabled(page, 'parallx-community.media-organizer', false);
    await page.waitForTimeout(1_500);
    await enableMediaOrganizer(page);
    await page.waitForTimeout(2_000);
    log('after migration', await ratings());
    await moPlace(page, 'Untagged');
    await page.waitForTimeout(2_500);
    // A card's star.
    await moCard(page, 'alpha', 'star');
    await page.waitForTimeout(800);
    log('after clicking alpha star', `${await ratings()} star on=${await page.evaluate(() => __px.all('media-organizer-grid', '.mo-card').find((x) => (x.textContent || '').includes('alpha'))?.querySelector('.mo-card-fav')?.classList.contains('is-on'))}`);
    await page.mouse.move(5, 5);
    await page.waitForTimeout(300);
    await shot(page, 'fav-cards');
    // The F key on the focused card.
    await moCard(page, 'beta', 'pick');
    await page.waitForTimeout(300);
    await page.keyboard.press('f');
    await page.waitForTimeout(800);
    log('after F on beta', await ratings());
    // The menu.
    await moCard(page, 'beta', 'menu');
    await page.waitForTimeout(400);
    log('menu on beta', await menuLine(page));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    // Sidebar count and the Favorites view.
    log('sidebar Favorites count', await page.evaluate(() => __px.ctl('media-organizer.side.place.favorites')?.querySelector('.mo-sidebar-item-count')?.textContent || ''));
    await moPlace(page, 'Favorites');
    await page.waitForTimeout(2_500);
    log('Favorites view', await page.evaluate(() => __px.all('media-organizer-grid', '.mo-card .mo-card-title, .mo-feed-tile').map((c) => c.textContent.trim()).join(', ') || __px.all('media-organizer-grid', '.mo-card').length + ' cards'));
    // Detail page favourite button.
    if (!(await moCard(page, 'gamma', 'open'))) await page.evaluate(() => __px.one('media-organizer-grid', '.mo-card')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
    await page.waitForTimeout(2_500);
    log('detail header buttons', await page.evaluate(() => Array.from(__px.pane('media-organizer-grid')?.querySelectorAll('[data-px-id^="media-organizer.viewer."]') || []).filter((b) => b.getClientRects().length).map((b) => `${b.title || b.getAttribute('aria-label') || b.textContent.trim()}${b.classList.contains('mo-active') || b.getAttribute('aria-pressed') === 'true' ? '*' : ''}`).join(' | ')));
    await shot(page, 'fav-detail');
    // Search operator.
    await moPlace(page, 'All Media');
    await page.waitForTimeout(2_000);
    await fillId(page, 'media-organizer.search', 'is:favorite');
    await page.locator(ctl('media-organizer.search')).filter({ visible: true }).first().press('Enter');
    await page.waitForTimeout(2_000);
    log('is:favorite search subtitle', await moCount(page));
  } finally {
    await app.close().catch(() => {});
  }
}

// Delete set to Trash: Delete moves without asking, Trash offers Restore,
// Delete Permanently… and Empty Trash…, and Trash older than 30 days is
// removed with its files (and so is not re-imported by the folder watcher).
async function moTrashScene(appRoot, workspace, errors) {
  const media = path.join(workspace, 'trashtest');
  await fs.mkdir(media, { recursive: true });
  const ff = (args) => spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
  ff(['-f', 'lavfi', '-i', 'mandelbrot=s=640x480', '-frames:v', '1', '-q:v', '4', path.join(media, 'keep.jpg')]);
  ff(['-f', 'lavfi', '-i', 'cellauto=s=640x480:rule=30', '-frames:v', '1', '-q:v', '4', path.join(media, 'bin.jpg')]);
  const { app, page } = await launchApp(appRoot, errors);
  const log = (k, v) => console.log(`[probe] trash ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
  const binState = async () => JSON.stringify(await moSql(page, `SELECT p.id, p.deleted_at FROM mo_photos p JOIN mo_photos_files pf ON pf.photo_id = p.id JOIN mo_files f ON f.id = pf.file_id WHERE f.basename = 'bin.jpg'`));
  const dialog = () => page.evaluate(() => {
    const b = __px.ctl('media-organizer.bulkDelete.confirm');
    if (!b?.getClientRects().length) return null;
    let p = b; while (p && !p.querySelector('h3')) p = p.parentElement;
    return p?.querySelector('h3')?.textContent || 'dialog without a title';
  });
  const promptLine = () => page.evaluate(() => Array.from(document.querySelectorAll('[data-px-surface="notification"], [data-px-surface="confirm"]')).filter((n) => n.getClientRects().length).map((n) => n.textContent.trim()).join(' | ') || 'nothing');
  try {
    await enableMediaOrganizer(page);
    await moScan(app, page, media, 5_000);
    await showMoSidebar(page);
    const trashRow = () => page.evaluate(() => (__px.ctl('media-organizer.side.place.trash')?.getClientRects().length ? 'shown' : 'hidden'));
    log('Trash row with Delete = permanent and Trash empty', await trashRow());
    await setSetting(page, 'mediaOrganizer.deleteMode', 'trash');
    await page.waitForTimeout(1_500);
    log('Trash row with Delete = trash', await trashRow());
    await moPlace(page, 'Untagged');
    await page.waitForTimeout(2_500);
    await moCard(page, 'bin', 'menu');
    await page.waitForTimeout(400);
    log('menu on a photo', await menuLine(page));
    await pickMenu(page, 'Move to Trash');
    await page.waitForTimeout(1_500);
    log('after Move to Trash', `${await binState()} ${JSON.stringify(await messages(page))}`);
    await moPlace(page, 'Trash');
    await page.waitForTimeout(2_500);
    log('Trash header', await page.evaluate(() => Array.from(__px.one('media-organizer-grid', '.mo-page-header')?.querySelectorAll('[data-px-id]') || []).filter((b) => b.getClientRects().length && b.tagName === 'BUTTON').map((b) => (b.textContent || b.title || '').trim()).join(' | ')));
    await moCard(page, 'bin', 'menu');
    await page.waitForTimeout(400);
    log('menu in Trash', await menuLine(page));
    await shot(page, 'trash-menu');
    await pickMenu(page, 'Restore');
    await page.waitForTimeout(1_500);
    log('after Restore', `${await binState()} ${JSON.stringify(await messages(page))}`);
    // Again into Trash, by the Delete key this time, then the permanent dialog.
    await moPlace(page, 'Untagged');
    await page.waitForTimeout(2_000);
    await moCard(page, 'bin', 'select');
    await page.waitForTimeout(300);
    await page.evaluate(() => __px.one('media-organizer-grid', '.mo-grid-browser')?.focus());
    await page.keyboard.press('Delete');
    await page.waitForTimeout(1_500);
    log('Delete key (Trash mode)', `${await binState()} dialog=${!!(await dialog())} ${JSON.stringify(await messages(page))}`);
    await moPlace(page, 'Trash');
    await page.waitForTimeout(2_000);
    await moCard(page, 'bin', 'menu');
    await page.waitForTimeout(400);
    await pickMenu(page, 'Delete Permanently…');
    await page.waitForTimeout(500);
    log('Delete Permanently… opens', (await dialog()) || 'no dialog');
    await click(page, 'media-organizer.bulkDelete.cancel').catch(() => {});
    await page.waitForTimeout(300);
    // Empty Trash… asks (it used to crash before asking).
    await click(page, 'media-organizer.emptyTrash').catch((e) => log('no Empty Trash', String(e).split('\n')[0]));
    await page.waitForTimeout(800);
    log('Empty Trash… asks', await promptLine());
    await shot(page, 'trash-empty-prompt');
    await click(page, 'notification.cancel').catch(() => click(page, 'confirm.cancel')).catch(() => {});
    await page.waitForTimeout(300);
    // 30 days later: removed with its file, and not re-imported.
    log('backdate', String(await moRun(page, `UPDATE mo_photos SET deleted_at = datetime('now', '-40 days') WHERE deleted_at IS NOT NULL`)));
    await restartMediaOrganizer(page);
    await page.waitForTimeout(3_000);
    log('bin.jpg after restart', `${await binState()} on disk=${await fs.stat(path.join(media, 'bin.jpg')).then(() => true).catch(() => false)}`);
    await runCommand(page, ['media-organizer.rescan']);
    await page.waitForTimeout(5_000);
    log('bin.jpg after rescan', `${await binState()} ${JSON.stringify(await messages(page))}`);
    log('keep.jpg untouched', JSON.stringify(await moSql(page, `SELECT p.deleted_at FROM mo_photos p JOIN mo_photos_files pf ON pf.photo_id = p.id JOIN mo_files f ON f.id = pf.file_id WHERE f.basename = 'keep.jpg'`)));
  } finally {
    await app.close().catch(() => {});
  }
}

// Media Organizer audit: every menu on a photo, a GIF, a video and a
// selection; the page ⋯ and View; what Delete and the Delete key do; Trash;
// commands run from the palette without arguments; the shortcuts sheet.
// Logs each menu's items and each message the app shows.
async function moAuditScene(appRoot, workspace, errors) {
  const media = path.join(workspace, 'audit');
  await fs.mkdir(media, { recursive: true });
  const ff = (args) => spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
  ff(['-f', 'lavfi', '-i', 'mandelbrot=s=800x600', '-frames:v', '1', '-q:v', '4', path.join(media, 'one.jpg')]);
  ff(['-f', 'lavfi', '-i', 'gradients=s=800x600:speed=0', '-frames:v', '1', '-q:v', '4', path.join(media, 'two.jpg')]);
  ff(['-f', 'lavfi', '-i', 'cellauto=s=800x600:rule=30', '-frames:v', '1', '-q:v', '4', path.join(media, 'three.jpg')]);
  ff(['-f', 'lavfi', '-i', 'testsrc=s=320x240:d=1:r=10', path.join(media, 'loop.gif')]);
  ff(['-f', 'lavfi', '-i', 'testsrc=s=640x360:d=2:r=25', '-pix_fmt', 'yuv420p', path.join(media, 'clip.mp4')]);
  const { app, page } = await launchApp(appRoot, errors);
  const log = (k, v) => console.log(`[probe] audit ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
  const menuItems = () => menuLine(page, { keys: true });
  const prompts = () => page.evaluate(() => Array.from(document.querySelectorAll('[data-px-surface="notification"], [data-px-surface="confirm"], [data-px-surface="inputBox"]')).filter((n) => n.getClientRects().length).map((n) => n.textContent.trim()).join(' | '));
  const closeMenus = async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(250); };
  const rightClickCard = async (name) => { const ok = await moCard(page, name, 'menu'); await page.waitForTimeout(400); return ok; };
  try {
    await enableMediaOrganizer(page);
    await moScan(app, page, media, 6_000);
    await moPlace(page, 'All Media');
    await page.waitForTimeout(3_000);
    log('All Media opens as', await page.evaluate(() => ['feed', 'grid', 'list'].filter((k) => __px.ctl(`media-organizer.layout.${k}`)?.getAttribute('aria-pressed') === 'true' || __px.ctl(`media-organizer.layout.${k}`)?.classList.contains('active')).join(',') + (__px.one('media-organizer-grid', '.mo-feed')?.offsetParent ? ' (feed visible)' : '')));
    log('messages after scan', await messages(page));
    // Grid layout, then each kind of card.
    await press(page, 'media-organizer.layout.grid');
    await page.waitForTimeout(2_000);
    log('cards', await page.evaluate(() => __px.all('media-organizer-grid', '.mo-card').map((c) => (c.querySelector('.mo-card-title')?.textContent || '').trim()).join(', ')));
    for (const name of ['one', 'loop', 'clip']) {
      const ok = await rightClickCard(name);
      log(`menu on ${name}`, ok ? await menuItems() : 'card not found');
      if (name === 'one') await shot(page, 'audit-menu-photo');
      await closeMenus();
    }
    // Page ⋯ and View.
    await click(page, 'pageHeader.more');
    await page.waitForTimeout(400);
    log('page ⋯', await menuItems());
    await closeMenus();
    await click(page, 'media-organizer.viewOptions');
    await page.waitForTimeout(400);
    log('View popover', await page.evaluate(() => Array.from(__px.pane('media-organizer.viewPopover')?.querySelectorAll('[data-px-id]') || []).map((r) => (r.getAttribute('aria-label') || r.textContent).trim()).join(' | ')));
    await page.mouse.click(700, 700);
    await page.waitForTimeout(300);
    // Select all, then the selection's right-click and bar.
    await page.evaluate(() => __px.one('media-organizer-grid', '.mo-card')?.click());
    await page.waitForTimeout(300);
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(600);
    log('selection bar', await controlsIn(page, MO, 'media-organizer.selection.'));
    await shot(page, 'audit-selection');
    await rightClickCard('one');
    log('menu on selection', await menuItems());
    await shot(page, 'audit-menu-selection');
    await closeMenus();
    // The Delete key with the selection (keys go to the focused grid).
    await page.evaluate(() => __px.one('media-organizer-grid', '.mo-grid-browser')?.focus());
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(400);
    await page.keyboard.press('Delete');
    await page.waitForTimeout(500);
    log('Delete key opens', await page.evaluate(() => {
      const b = __px.ctl('media-organizer.bulkDelete.confirm');
      if (!b?.getClientRects().length) return 'no dialog';
      let d = b; while (d && !d.querySelector('h3')) d = d.parentElement;
      return `${d?.querySelector('h3')?.textContent} / ${d?.querySelector('.mo-bulk-dialog-warn')?.textContent} / checkbox checked=${d?.querySelector('input[type=checkbox]')?.checked}`;
    }));
    await shot(page, 'audit-delete-dialog');
    await click(page, 'media-organizer.bulkDelete.cancel').catch(() => {});
    await page.waitForTimeout(300);
    // The palette's Move Selected to Trash on one item, then the Trash view.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await moCard(page, 'three', 'select');
    await page.waitForTimeout(300);
    log('selected before moveToTrash', String(await page.evaluate(() => __px.all('media-organizer-grid', '.mo-card.selected, .mo-card.is-selected, .mo-card.mo-selected, .mo-card[aria-selected="true"]').length)));
    await runCommand(page, ['media-organizer.moveToTrash']);
    await page.waitForTimeout(1_200);
    log('messages after moveToTrash', await messages(page));
    await moPlace(page, 'Trash');
    await page.waitForTimeout(2_500);
    log('Trash view cards', await page.evaluate(() => __px.all('media-organizer-grid', '.mo-card, .mo-feed-tile').filter((c) => c.offsetParent).map((c) => (c.textContent || '').trim().slice(0, 20)).join(', ') || 'none'));
    log('Trash view buttons', await page.evaluate(() => Array.from(__px.one('media-organizer-grid', '.mo-page-header')?.querySelectorAll('[data-px-id]') || []).filter((b) => b.getClientRects().length && b.tagName === 'BUTTON').map((b) => (b.textContent || b.title || '').trim()).join(' | ')));
    if (await rightClickCard('three')) { log('menu in Trash', await menuItems()); await closeMenus(); }
    else log('menu in Trash', 'no card (Trash view may be a feed or empty)');
    // Folder row right-click in the sidebar (tree rows are content).
    await page.evaluate(() => { const r = __px.one('mediaOrganizer.browser', '[data-mo-browse="folders"] .mo-sidebar-item'); if (r) { const b = r.getBoundingClientRect(); r.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: b.left + 10, clientY: b.top + 5 })); } });
    await page.waitForTimeout(400);
    log('folder row right-click', await menuItems());
    await closeMenus();
    // Commands from the palette, no arguments.
    for (const c of ['revealInMO', 'openClipEditor', 'editImage', 'createAlbum', 'openSmartAlbum', 'cacheStats', 'emptyTrash']) {
      await runCommand(page, [`media-organizer.${c}`]);
      await page.waitForTimeout(900);
      log(`palette ${c}`, `${JSON.stringify(await messages(page))} on screen: ${await prompts()}`);
      if (c === 'editImage' || c === 'emptyTrash') await shot(page, `audit-palette-${c}`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
    }
    // Trash older than 30 days: backdate the trashed photo, restart the tool
    // (the purge runs on activation), then rescan the folder.
    const photoState = async () => JSON.stringify(await moSql(page, `SELECT p.id, f.basename, p.deleted_at FROM mo_photos p JOIN mo_photos_files pf ON pf.photo_id = p.id JOIN mo_files f ON f.id = pf.file_id WHERE f.basename = 'three.jpg'`));
    log('three.jpg before', await photoState());
    log('backdate', String(await moRun(page, `UPDATE mo_photos SET deleted_at = datetime('now', '-40 days') WHERE deleted_at IS NOT NULL`)));
    await restartMediaOrganizer(page);
    log('three.jpg after restart (auto-purge)', await photoState());
    log('three.jpg on disk', String(await fs.stat(path.join(media, 'three.jpg')).then(() => true).catch(() => false)));
    await runCommand(page, ['media-organizer.rescan']);
    await page.waitForTimeout(6_000);
    log('three.jpg after rescan', await photoState());
    log('messages', await messages(page));
    // The shortcuts sheet (its rows are content beside its Close).
    await runCommand(page, ['media-organizer.showShortcuts']);
    await page.waitForTimeout(600);
    log('shortcuts sheet', await page.evaluate(() => { let d = __px.ctl('media-organizer.shortcuts.close'); while (d && !d.querySelector('.mo-cheat-row')) d = d.parentElement; return Array.from(d?.querySelectorAll('.mo-cheat-row') || []).map((r) => r.textContent.replace(/\s+/g, ' ').trim()).filter((t) => /Delete|sash|Save|filter/i.test(t)).join(' | '); }));
    await page.keyboard.press('Escape');
  } finally {
    await app.close().catch(() => {});
  }
}

// The Media Organizer sidebar: the places to look, To sort, Collections,
// Studio and Browse (Folders | Tags), in dark and light, with a view open.
async function sidebarScene(appRoot, workspace, errors) {
  const photos = path.join(workspace, 'photos');
  await fs.mkdir(photos, { recursive: true });
  for (const [name, lav] of [['a.jpg', 'mandelbrot=s=800x600'], ['b.jpg', 'gradients=s=800x600:speed=0'], ['c.jpg', 'cellauto=s=800x600:rule=110']]) {
    spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', lav, '-frames:v', '1', '-q:v', '4', path.join(photos, name)]);
  }
  const { app, page } = await launchApp(appRoot, errors);
  try {
    await enableMediaOrganizer(page);
    await moScan(app, page, photos, 4_000);
    await showMoSidebar(page);
    await page.waitForSelector(ctl('media-organizer.side.place.all-media'), { timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(1_500);
    // The sidebar's sections and rows are drawn content; its Folders and
    // Tags switch is in the scene.
    const state = () => page.evaluate(() => {
      const q = (s) => __px.all('mediaOrganizer.browser', s);
      const heads = q('.mo-sidebar-section-header').map((h) => `${h.querySelector('.mo-sidebar-section-title')?.textContent}${h.classList.contains('collapsed') ? '(folded)' : ''}`);
      const rows = q('.mo-sidebar-item').filter((r) => r.offsetParent).map((r) => `${r.querySelector('.mo-sidebar-item-label')?.textContent}${r.querySelector('.mo-sidebar-item-count')?.textContent ? '=' + r.querySelector('.mo-sidebar-item-count').textContent : ''}${r.classList.contains('is-current') ? '*' : ''}${r.classList.contains('is-quiet') ? '~' : ''}`);
      const seg = ['folders', 'tags'].map((k) => __px.ctl(`media-organizer.side.${k}`)).filter(Boolean).map((b) => `${b.textContent}${b.classList.contains('is-on') || b.getAttribute('aria-selected') === 'true' ? '*' : ''}`);
      const hints = q('.mo-sidebar-hint').filter((h) => h.offsetParent).map((h) => h.textContent);
      return `heads=[${heads}] seg=[${seg}] rows=[${rows.join(', ')}] hints=[${hints.join(' / ')}]`;
    });
    console.log(`[probe] sidebar: ${await state()}`);
    await shot(page, 'sidebar');
    // Studio's +: New Clip Project… and Record Screen….
    await click(page, 'media-organizer.side.new-in-studio').catch((e) => console.log(`[probe] sidebar: no Studio + (${String(e).split('\n')[0]})`));
    await page.waitForTimeout(400);
    console.log(`[probe] sidebar Studio +: ${await menuLine(page)}`);
    await shot(page, 'sidebar-studio-menu');
    await page.keyboard.press('Escape');
    console.log(`[probe] settings hub: ${await settingSchema(page, 'mediaOrganizer.deleteMode')}`);
    await click(page, 'media-organizer.side.place.all-media');
    await page.waitForTimeout(2_500);
    await page.mouse.move(150, 300);
    console.log(`[probe] sidebar, All Media open: ${await state()}`);
    await shot(page, 'sidebar-current');
    await click(page, 'media-organizer.side.tags');
    await page.waitForTimeout(800);
    console.log(`[probe] sidebar, tags: ${await state()}`);
    await shot(page, 'sidebar-tags');
    await page.evaluate(() => document.documentElement.setAttribute('data-px-mode', 'light'));
    await page.waitForTimeout(800);
    await shot(page, 'sidebar-light');
  } finally {
    await app.close().catch(() => {});
  }
}

async function imageScene(appRoot, workspace, errors) {
  const photos = path.join(workspace, 'photos');
  await fs.mkdir(photos, { recursive: true });
  const srcs = [
    ['studio.jpg', 'gradients=s=1600x1067:c0=0x2b4a6f:c1=0xd99a5b:c2=0x7a3b2e:x0=0:y0=0:x1=1600:y1=1067:speed=0,noise=alls=12:allf=t'],
    ['garden.jpg', 'mandelbrot=s=1600x1067:maxiter=200'],
    ['portrait.jpg', 'gradients=s=900x1200:c0=0x1d2b24:c1=0xe8d7b0:x0=0:y0=1200:x1=900:y1=0:speed=0,noise=alls=10:allf=t'],
    ['sketch.jpg', 'cellauto=s=1600x1067:rule=110,negate'],
    ['dusk.jpg', 'gradients=s=1600x1067:c0=0x0b0d26:c1=0xff7a3d:c2=0x6a2c70:speed=0'],
  ];
  for (const [name, lav] of srcs) {
    spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', lav, '-frames:v', '1', '-q:v', '3', path.join(photos, name)]);
  }
  const { app, page } = await launchApp(appRoot, errors);
  try {
    await enableMediaOrganizer(page);
    await moScan(app, page, photos, 4_000);
    await runCommand(page, [['media-organizer.editImage', 1]]);
    await page.waitForSelector(`${ctl('media-organizer.imageEditor.saveOptions')} >> visible=true`, { state: 'visible', timeout: 20_000 });
    await page.waitForTimeout(3_000);
    // A tool tab by its name (the tabs' ids are the tools' own keys).
    // A tool tab by its name; the tabs' ids are the tools' own keys.
    const TOOL = { 'Edit': 'edit', 'Crop And Rotate': 'crop', 'Remove': 'remove', 'Enhance': 'enhance' };
    const tool = async (label) => {
      await click(page, `media-organizer.imageEditor.tool.${TOOL[label]}`).catch((e) => console.log(`[probe] image: no tool ${label} (${String(e).split('\n')[0]})`));
      await page.waitForTimeout(1_200);
    };
    // The panel's body, the presets, histogram and stage are content of the editor.
    const scrollPanel = async (frac) => { await page.evaluate((f) => { const b = __px.one('media-organizer-image', '.mo-edit-panel-body'); if (b) b.scrollTop = (b.scrollHeight - b.clientHeight) * f; }, frac); await page.waitForTimeout(400); };
    const openAll = async () => {
      for (let i = 0; i < 10; i++) {
        const id = await page.evaluate(() => Array.from(document.querySelectorAll('[data-px-id^="media-organizer.imageEditor.section."]')).find((b) => b.getClientRects().length && (b.getAttribute('aria-expanded') === 'false' || b.closest('.is-shut')))?.getAttribute('data-px-id'));
        if (!id) break;
        await click(page, id);
        await page.waitForTimeout(150);
      }
    };
    const setSlider = async (id, value) => page.evaluate(({ id, value }) => {
      const el = __px.ctl(`media-organizer.imageEditor.slider.${id}`);
      if (!el) return false;
      el.value = String(value); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }, { id, value });
    const state = async () => page.evaluate(() => {
      const q = (s) => __px.all('media-organizer-image', s);
      const tabs = Array.from(document.querySelectorAll('[data-px-id^="media-organizer.imageEditor.tool."]')).filter((t) => t.getClientRects().length).map((t) => `${t.textContent.trim()}${t.classList.contains('is-on') ? '*' : ''}${t.classList.contains('is-used') ? '•' : ''}`).join(' ');
      const secs = q('.mo-edit-section').map((x) => `${x.querySelector('.mo-edit-section-title')?.textContent}${x.querySelector('.mo-edit-section-dot') ? '•' : ''}`).join(', ');
      const changed = q('.mo-edit-slider.is-changed').map((x) => `${x.querySelector('.mo-edit-slider-name')?.textContent}=${x.querySelector('.mo-edit-value')?.textContent}`).join(', ');
      const tb = q('.mo-edit-topbar')[0];
      const top = Array.from(tb?.querySelectorAll('[data-px-id]') || []).filter((b) => b.tagName === 'BUTTON' && b.offsetParent).map((b) => (b.getAttribute('aria-label') || b.textContent || '').trim()).join(' | ');
      const presets = q('.mo-edit-ptile').length + ' tiles, ' + q('.mo-edit-ptile img:not(.mo-hidden)').length + ' pictures, on: ' + q('.mo-edit-ptile.is-on').map((t) => t.textContent).join(',');
      const root = q('.mo-edit')[0]; const pn = q('.mo-edit-panel')[0];
      const geo = `win=${window.innerWidth} root=${root?.clientWidth} rootR=${Math.round(root?.getBoundingClientRect().right || 0)} topbar=${tb?.clientWidth}/${tb?.scrollWidth} panelR=${Math.round(pn?.getBoundingClientRect().right || 0)}`;
      return `${geo} tabs=[${tabs}] sections=[${secs}] changed=[${changed}] top=[${top}] presets=[${presets}] hist="${q('.mo-edit-histcap')[0]?.textContent}" size="${q('.mo-edit-dim')[0]?.textContent}" edited=${!q('.mo-edit-edited')[0]?.classList.contains('mo-hidden')}`;
    });
    const shots = async (suffix) => {
      await tool('Edit');
      await scrollPanel(0);
      await page.waitForTimeout(1_500);
      await shot(page, `image-edit${suffix}`);
      await openAll();
      await scrollPanel(0.5);
      await shot(page, `image-edit-colour${suffix}`);
      await scrollPanel(1);
      await shot(page, `image-edit-bottom${suffix}`);
      await scrollPanel(0);
      await tool('Crop And Rotate');
      await shot(page, `image-crop${suffix}`);
      await tool('Remove');
      await shot(page, `image-remove${suffix}`);
      await tool('Enhance');
      await shot(page, `image-enhance${suffix}`);
      await tool('Edit');
    };
    const menuText = async () => (await menuRows(page))?.map((r) => `${r.label}${r.key}`).join(' | ') ?? 'NO MENU';
    // A few changes, so the marks show: Exposure, Contrast, Highlights, Vibrance, and Clarity (in Effects, closed).
    await tool('Edit');
    for (const [id, v] of [['exposure', 0.35], ['contrast', 0.12], ['highlights', -0.4], ['vibrance', 0.18], ['clarity', 0.3]]) await setSlider(id, v);
    await page.waitForTimeout(800);
    console.log(`[probe] image state: ${await state()}`);
    // Point at a preset (a tile, content): the stage previews it and says so.
    await page.locator(`${surface(IMAGE)} .mo-edit-ptile`, { hasText: 'Golden Hour' }).first().hover().catch(() => {});
    await page.waitForTimeout(800);
    console.log(`[probe] image hover chip: "${await page.evaluate(() => __px.one('media-organizer-image', '.mo-edit-stagechip--top:not(.mo-hidden)')?.textContent || 'none')}"`);
    await shot(page, 'image-preset-hover');
    await page.mouse.move(700, 300);
    // Split compare and the highlight clipping shown on the photo.
    await press(page, 'media-organizer.imageEditor.split');
    await press(page, 'media-organizer.imageEditor.clipping.highlights');
    await page.waitForTimeout(1_200);
    console.log(`[probe] image split: ${await page.evaluate(() => `bar=${!__px.one('media-organizer-image', '.mo-edit-splitbar')?.classList.contains('mo-hidden')} clipLayer=${!__px.one('media-organizer-image', '.mo-edit-cliplayer')?.classList.contains('mo-hidden')} hist="${__px.one('media-organizer-image', '.mo-edit-histcap')?.textContent}"`)}`);
    await shot(page, 'image-split');
    await press(page, 'media-organizer.imageEditor.split');
    await press(page, 'media-organizer.imageEditor.clipping.highlights');
    // Crop 4:5 and straighten a little with the dial.
    await tool('Crop And Rotate');
    await click(page, 'media-organizer.imageEditor.crop.aspect.4-5').catch((e) => console.log(`[probe] image: no 4:5 (${String(e).split('\n')[0]})`));
    await page.waitForTimeout(600);
    const dialBox = await page.locator(`${surface(IMAGE)} .mo-edit-dial`).boundingBox().catch(() => null);
    if (dialBox) {
      await page.mouse.move(dialBox.x + dialBox.width / 2, dialBox.y + 10);
      await page.mouse.down(); await page.mouse.move(dialBox.x + dialBox.width / 2 + 25, dialBox.y + 10, { steps: 5 }); await page.mouse.up();
    }
    await page.waitForTimeout(800);
    console.log(`[probe] image crop: size="${await page.evaluate(() => __px.one('media-organizer-image', '.mo-edit-cropsize')?.textContent)}" dial="${await page.evaluate(() => __px.one('media-organizer-image', '.mo-edit-dial-value')?.textContent)}" ${await state()}`);
    await shot(page, 'image-crop-45');
    // The ⋯ and Save menus.
    await click(page, 'media-organizer.imageEditor.more');
    await page.waitForTimeout(400);
    console.log(`[probe] image more menu: ${await menuText()}`);
    await shot(page, 'image-more-menu');
    await page.keyboard.press('Escape');
    await click(page, 'media-organizer.imageEditor.saveOptions');
    await page.waitForTimeout(400);
    console.log(`[probe] image save menu: ${await menuText()}`);
    await page.keyboard.press('Escape');
    // Undo the crop so the rest of the shots show the whole photo.
    await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z');
    await page.waitForTimeout(600);
    await shots('');
    // Light mode (Appearance's data-px-mode, which the --px-* tokens follow).
    await page.evaluate(() => document.documentElement.setAttribute('data-px-mode', 'light'));
    await page.waitForTimeout(800);
    await shots('-light');
    // A narrow window.
    await resizeWindow(page, 1000, 760);
    await page.waitForTimeout(1_000);
    await tool('Edit');
    await scrollPanel(0);
    console.log(`[probe] image narrow: ${await state()}`);
    await shot(page, 'image-narrow-light');
    await resizeWindow(page, 860, 700);
    await page.waitForTimeout(1_000);
    console.log(`[probe] image narrower: ${await state()}`);
    await shot(page, 'image-narrower-light');
  } finally {
    await app.close().catch(() => {});
  }
}

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  const { appRoot, workspace, clip, clip2 } = await makeTempRoots();
  console.log(`[probe] app root ${appRoot}\n[probe] workspace ${workspace}`);
  if (scenes.includes('image')) {
    const errs = [];
    await scene('image', () => imageScene(appRoot, workspace, errs));
    const real = errs.filter((e) => !/ERR_CONNECTION_REFUSED|Ollama/.test(e));
    if (real.length) { console.log(`[probe] image: ${real.length} renderer error(s)`); for (const e of real) console.log(`  ${e}`); }
    if (scenes.length === 1) {
      await fs.rm(appRoot, { recursive: true, force: true }).catch(() => {});
      await fs.rm(workspace, { recursive: true, force: true }).catch(() => {});
      return;
    }
  }
  if (scenes.includes('mofilters')) {
    const errs = [];
    await scene('mofilters', () => moFiltersScene(appRoot, workspace, errs));
    const real = errs.filter((e) => !/ERR_CONNECTION_REFUSED|Ollama/.test(e));
    if (real.length) { console.log(`[probe] mofilters: ${real.length} renderer error(s)`); for (const e of real) console.log(`  ${e}`); }
    if (scenes.length === 1) {
      await fs.rm(appRoot, { recursive: true, force: true }).catch(() => {});
      await fs.rm(workspace, { recursive: true, force: true }).catch(() => {});
      return;
    }
  }
  if (scenes.includes('moart')) {
    const errs = [];
    await scene('moart', () => moArtScene(appRoot, workspace, errs));
    const real = errs.filter((e) => !/ERR_CONNECTION_REFUSED|Ollama/.test(e));
    if (real.length) { console.log(`[probe] moart: ${real.length} renderer error(s)`); for (const e of real) console.log(`  ${e}`); }
    if (scenes.length === 1) {
      await fs.rm(appRoot, { recursive: true, force: true }).catch(() => {});
      await fs.rm(workspace, { recursive: true, force: true }).catch(() => {});
      return;
    }
  }
  if (scenes.includes('pdf')) {
    const errs = [];
    await scene('pdf', () => pdfScene(appRoot, workspace, errs));
    const real = errs.filter((e) => !/ERR_CONNECTION_REFUSED|Ollama/.test(e));
    if (real.length) { console.log(`[probe] pdf: ${real.length} renderer error(s)`); for (const e of real) console.log(`  ${e}`); }
    if (scenes.length === 1) {
      await fs.rm(appRoot, { recursive: true, force: true }).catch(() => {});
      await fs.rm(workspace, { recursive: true, force: true }).catch(() => {});
      return;
    }
  }
  if (scenes.includes('mofav')) {
    const errs = [];
    await scene('mofav', () => moFavScene(appRoot, workspace, errs));
    const real = errs.filter((e) => !/ERR_CONNECTION_REFUSED|Ollama/.test(e));
    if (real.length) { console.log(`[probe] mofav: ${real.length} renderer error(s)`); for (const e of real) console.log(`  ${e}`); }
    if (scenes.length === 1) {
      await fs.rm(appRoot, { recursive: true, force: true }).catch(() => {});
      await fs.rm(workspace, { recursive: true, force: true }).catch(() => {});
      return;
    }
  }
  if (scenes.includes('motrash')) {
    const errs = [];
    await scene('motrash', () => moTrashScene(appRoot, workspace, errs));
    const real = errs.filter((e) => !/ERR_CONNECTION_REFUSED|Ollama/.test(e));
    if (real.length) { console.log(`[probe] motrash: ${real.length} renderer error(s)`); for (const e of real) console.log(`  ${e}`); }
    if (scenes.length === 1) {
      await fs.rm(appRoot, { recursive: true, force: true }).catch(() => {});
      await fs.rm(workspace, { recursive: true, force: true }).catch(() => {});
      return;
    }
  }
  if (scenes.includes('moaudit')) {
    const errs = [];
    await scene('moaudit', () => moAuditScene(appRoot, workspace, errs));
    const real = errs.filter((e) => !/ERR_CONNECTION_REFUSED|Ollama/.test(e));
    if (real.length) { console.log(`[probe] moaudit: ${real.length} renderer error(s)`); for (const e of real) console.log(`  ${e}`); }
    if (scenes.length === 1) {
      await fs.rm(appRoot, { recursive: true, force: true }).catch(() => {});
      await fs.rm(workspace, { recursive: true, force: true }).catch(() => {});
      return;
    }
  }
  if (scenes.includes('sidebar')) {
    const errs = [];
    await scene('sidebar', () => sidebarScene(appRoot, workspace, errs));
    const real = errs.filter((e) => !/ERR_CONNECTION_REFUSED|Ollama/.test(e));
    if (real.length) { console.log(`[probe] sidebar: ${real.length} renderer error(s)`); for (const e of real) console.log(`  ${e}`); }
    if (scenes.length === 1) {
      await fs.rm(appRoot, { recursive: true, force: true }).catch(() => {});
      await fs.rm(workspace, { recursive: true, force: true }).catch(() => {});
      return;
    }
  }
  if (scenes.includes('timelapse')) {
    const errs = [];
    await scene('timelapse', () => timelapseScene(appRoot, clip2, errs));
    const real = errs.filter((e) => !/ERR_CONNECTION_REFUSED|Ollama/.test(e));
    if (real.length) { console.log(`[probe] timelapse: ${real.length} renderer error(s)`); for (const e of real) console.log(`  ${e}`); }
    if (scenes.length === 1) {
      await fs.rm(appRoot, { recursive: true, force: true }).catch(() => {});
      await fs.rm(workspace, { recursive: true, force: true }).catch(() => {});
      return;
    }
  }
  if (scenes.includes('project')) {
    const errs = [];
    await scene('project', () => projectScene(appRoot, clip, clip2, errs));
    if (errs.length) { console.log(`[probe] project: ${errs.length} renderer error(s)`); for (const e of errs) console.log(`  ${e}`); }
    if (scenes.length === 1) {
      await fs.rm(appRoot, { recursive: true, force: true }).catch(() => {});
      await fs.rm(workspace, { recursive: true, force: true }).catch(() => {});
      return;
    }
  }

  const errors = [];
  const { app, page } = await launchApp(appRoot, errors);
  try {
    if (scenes.includes('boot')) await shot(page, 'boot');

    if (scenes.includes('welcome')) {
      await runCommand(page, ['welcome.openWelcome']);
      await page.waitForTimeout(800);
      await shot(page, 'welcome');
    }

    // The chrome at a glance: the empty editor's hints, the settings (gear)
    // menu against its icon, the status bar, and a file's breadcrumbs.
    if (scenes.includes('chrome')) {
      await scene('chrome', async () => {
        for (let i = 0; i < 6; i++) await runCommand(page, ['workbench.action.closeActiveEditor']);
        await page.waitForTimeout(600);
        await shot(page, 'chrome-empty');
        await click(page, 'activitybar.manage').catch(() => {});
        await page.waitForTimeout(500);
        const gap = await page.evaluate(() => {
          const g = __px.ctl('activitybar.manage')?.getBoundingClientRect();
          const m = Array.from(document.querySelectorAll('[data-px-surface="contextMenu"]')).map((x) => x.getBoundingClientRect()).find((r) => r.width > 0);
          if (!g || !m) return 'no gear or menu';
          return `gear=${Math.round(g.left)},${Math.round(g.top)} ${Math.round(g.width)}x${Math.round(g.height)} menu=${Math.round(m.left)},${Math.round(m.top)} ${Math.round(m.width)}x${Math.round(m.height)} menuBottom-gearBottom=${Math.round(m.bottom - g.bottom)} menuLeft-gearRight=${Math.round(m.left - g.right)}`;
        });
        console.log(`[probe] gear menu: ${gap}`);
        await shot(page, 'chrome-gear');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
        // The status bar's items are its controls in the scene.
        const sb = await page.evaluate(() => {
          const bar = __px.pane('workbench.parts.statusbar');
          if (!bar) return 'no status bar';
          const items = Array.from(bar.querySelectorAll('[data-px-id]')).filter((x) => x.offsetParent).map((x) => { const r = x.getBoundingClientRect(); return `"${x.textContent.trim().slice(0, 20)}" h=${Math.round(r.height)} fs=${getComputedStyle(x).fontSize}`; });
          return `bar h=${Math.round(bar.getBoundingClientRect().height)} fs=${getComputedStyle(bar).fontSize}; ${items.join('; ')}`;
        });
        console.log(`[probe] status bar: ${sb}`);
        // A file one folder down, so the path has a folder, a chevron and the file.
        await openFile(page, 'siewert.md');
        const opened = await page.evaluate(() => (__px.pane('editorGroup')?.textContent || '').includes('Excess loss') ? 'ok' : 'not open');
        // Each crumb's icon, label and chevron: their vertical centres should
        // agree. The breadcrumbs are not in the scene; they are measured as
        // content of the editor group.
        const bc = await page.evaluate(() => {
          const c = __px.all('editorGroup', '.breadcrumbs-control').find((x) => x.getClientRects().length);
          if (!c) return 'no breadcrumbs';
          const r = c.getBoundingClientRect();
          const mid = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return b.height ? +(b.top + b.height / 2).toFixed(1) : null; };
          const glyph = (el) => { if (!el) return null; const rg = document.createRange(); rg.selectNodeContents(el); const b = rg.getBoundingClientRect(); return b.height ? +(b.top + b.height / 2).toFixed(1) : null; };
          const items = Array.from(c.querySelectorAll('.parallx-breadcrumb-item')).map((it) => {
            const svg = it.querySelector('.breadcrumb-icon svg');
            const sep = it.querySelector('.breadcrumb-separator svg');
            return `${it.querySelector('.breadcrumb-label')?.textContent} icon=${mid(svg)} text=${glyph(it.querySelector('.breadcrumb-label'))} sep=${mid(sep)}`;
          });
          const item = c.querySelector('.parallx-breadcrumb-item');
          return `bar h=${Math.round(r.height)} mid=${(r.top + r.height / 2).toFixed(1)} fs=${item ? getComputedStyle(item).fontSize : '-'}; ${items.join('; ')}`;
        });
        console.log(`[probe] file breadcrumbs (${opened}): ${bc}`);
        await shot(page, 'chrome-file');
        const tbar = await page.evaluate(() => {
          const b = __px.ctl('titlebar.searchCommands');
          const center = __px.one('workbench.parts.titlebar', '.titlebar-center');
          return `search=${b ? `"${b.title}" ${Math.round(b.getBoundingClientRect().width)}x${Math.round(b.getBoundingClientRect().height)}` : 'none'} centre="${(center?.textContent || '').trim()}"`;
        });
        console.log(`[probe] title bar: ${tbar}`);
      });
    }
    if (scenes.includes('watermark')) {
      for (let i = 0; i < 4; i++) await runCommand(page, ['workbench.action.closeActiveEditor']);
      await page.waitForTimeout(600);
      const wm = await page.evaluate(() => {
        const el = __px.one('workbench.parts.editor', '.editor-watermark');
        if (!el) return 'no .editor-watermark element';
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return `class="${el.className}" display=${cs.display} opacity=${cs.opacity} rect=${Math.round(r.width)}x${Math.round(r.height)} covered-by=${top ? top.tagName + '.' + top.className : 'none'} text="${(el.textContent || '').trim().slice(0, 40)}"`;
      });
      console.log(`[probe] watermark: ${wm}`);
      await shot(page, 'watermark');
    }

    if (scenes.includes('chat')) {
      const shown = await runCommand(page, ['chat.show']);
      if (!shown) await page.keyboard.press('Control+Shift+i');
      await page.waitForSelector(ctl('chat.input'), { timeout: 15_000 }).catch(() => {});
      await page.waitForTimeout(800);
      await shot(page, 'chat');
    }

    if (scenes.includes('autonomy')) {
      // The activity log lives in the bottom panel.
      await scene('autonomy', async () => {
        if (!(await page.locator(surface('workbench.parts.panel')).first().isVisible().catch(() => false))) await click(page, 'titlebar.layout.bottom');
        if (!(await runCommand(page, [['workbench.view.show', 'view.activityLog']]))) throw new Error('no activity log view');
        await page.locator(ctl('panel.views')).getByText('Activity', { exact: true }).first().click({ timeout: 5_000 });
        await page.waitForSelector(`${surface('view.activityLog')} >> visible=true`, { state: 'visible', timeout: 5_000 });
        await page.waitForTimeout(800);
        await shot(page, 'autonomy');
      });
    }

    if (scenes.includes('dashboard')) {
      const ok = await runCommand(page, ['dashboard.newPage']);
      if (ok) {
        const header = await page.waitForSelector(`${surface('dashboard')} >> visible=true`, { state: 'visible', timeout: 15_000 }).catch(() => null);
        console.log(`[probe] dashboard header ${header ? 'mounted' : 'NOT mounted'}`);
        await page.waitForTimeout(1_000);
        await shot(page, 'dashboard');
        await runCommand(page, ['dashboard.addWidget']);
        await page.waitForSelector(`${ctl('dashboard.picker.cancel')} >> visible=true`, { state: 'visible', timeout: 5_000 }).catch(() => {});
        await page.waitForTimeout(600);
        await shot(page, 'dashboard-picker');
        await page.keyboard.press('Escape');
      } else console.log('[probe] dashboard: no command matched, skipped');
    }

    if (scenes.includes('planner')) {
      await scene('planner', async () => {
        const ok = await runCommand(page, ['planner.open']);
        if (!ok) throw new Error('planner.open not available');
        await page.waitForTimeout(1_200);
        await shot(page, 'planner');
        await click(page, 'planner.tab.tasks', { timeout: 5_000 });
        await page.waitForTimeout(900);
        await shot(page, 'planner-tasks');
      });
    }

    if (scenes.includes('canvas')) {
      await scene('canvas', async () => {
        const ok = await runCommand(page, ['canvas.newPage']);
        if (!ok) throw new Error('canvas.newPage not available');
        await page.waitForSelector(`${surface('canvas')} ${ctl('canvas.page.menu')} >> visible=true`, { state: 'visible', timeout: 15_000 });
        await page.waitForTimeout(1_000);
        // Focus the page body first (the editor, which the scene never
        // declares): unfocused typing lands on document.body.
        await page.locator(`${surface('canvas')} [contenteditable="true"]`).first().click({ timeout: 5_000 }).catch(() => {});
        // Type a heading and a few lines so the page looks like a page.
        await page.keyboard.type('Siewert');
        await page.keyboard.press('Enter');
        await page.keyboard.type('Excess losses above a per-occurrence deductible or an aggregate limit.');
        await page.waitForTimeout(1_200);
        await shot(page, 'canvas');
        // Which element paints each horizontal hairline near the tab strip.
        const edges = await page.evaluate(() => {
          const out = [];
          for (const y of [70, 71, 72, 73, 74]) {
            const els = document.elementsFromPoint(600, y).slice(0, 3).map((el) => {
              const cs = getComputedStyle(el);
              return `${el.tagName.toLowerCase()}.${String(el.className).split(' ').slice(0, 2).join('.')}[bb=${cs.borderBottomColor} bt=${cs.borderTopColor} bg=${cs.backgroundColor}]`;
            });
            out.push(`y=${y}: ${els.join(' > ')}`);
          }
          return out.join(' || ');
        });
        console.log(`[probe] canvas edges: ${edges}`);
        // The page menu (⋯) with the font section.
        const diag = await page.evaluate(() => {
          const btn = __px.ctl('canvas.page.menu');
          if (!btn) return 'no button';
          const r = btn.getBoundingClientRect();
          const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return `rect=${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)} top=${top ? top.tagName + '.' + String(top.className).slice(0, 60) : 'none'}`;
        });
        console.log(`[probe] canvas menu button: ${diag}`);
        await click(page, 'canvas.page.menu', { timeout: 3_000 });
        await page.waitForSelector(`${ctl('canvas.font.current')} >> visible=true`, { state: 'visible', timeout: 5_000 });
        await page.waitForTimeout(500);
        await shot(page, 'canvas-page-menu');
        const fonts = () => page.evaluate(() => Array.from(document.querySelectorAll('[data-px-id^="canvas.font.pick."]')).filter((x) => x.getClientRects().length).length);
        console.log(`[probe] font list (collapsed): ${await fonts()} fonts shown`);
        // The font row opens the font list inside the menu.
        await click(page, 'canvas.font.current', { timeout: 3_000 });
        await page.waitForTimeout(400);
        console.log(`[probe] font list (open): ${await fonts()} fonts shown`);
        await shot(page, 'canvas-page-menu-fonts');
        await page.keyboard.press('Escape');
        // The sidebar's trash popup (empty in a fresh workspace, which is
        // still a state worth seeing).
        await runCommand(page, [['workbench.view.show', 'view.canvas']]);
        await page.waitForTimeout(400);
        await click(page, 'canvas.sidebar.trash', { timeout: 3_000 });
        await page.waitForSelector(`${ctl('canvas.trash.close')} >> visible=true`, { state: 'visible', timeout: 5_000 });
        await page.waitForTimeout(400);
        await shot(page, 'canvas-trash');
        await page.keyboard.press('Escape');
      });
    }
    if (scenes.includes('clip')) {
      await scene('clip', async () => {
        await enableMediaOrganizer(page);
        const ok = await runCommand(page, [['media-organizer.openClipEditor', clip]]);
        if (!ok) throw new Error('media-organizer.openClipEditor not available (extension not loaded?)');
        await page.waitForSelector(`${surface(CLIP)} ${ctl('media-organizer.clipEditor.export')} >> visible=true`, { state: 'visible', timeout: 20_000 });
        await page.waitForTimeout(1_500);
        await shot(page, 'clip');
        // Where the stage sits at each shot: it must stay on screen while the
        // controls scroll (blur boxes and text live on the video).
        const stageState = async (label) => {
          const d = await page.evaluate(() => {
            const st = __px.one('media-organizer-clip', '.mo-clip-stage');
            if (!st) return 'no stage';
            const r = st.getBoundingClientRect();
            return `top=${Math.round(r.top)} bottom=${Math.round(r.bottom)} visible=${r.bottom > 80 && r.top < window.innerHeight - 80}`;
          });
          console.log(`[probe] clip stage @${label}: ${d}`);
        };
        const popOpen = () => page.evaluate(() => !!__px.ctl('media-organizer.clipEditor.exportPopover.export')?.getClientRects().length);
        const queueOpen = () => page.evaluate(() => !!__px.ctl('media-organizer.clipEditor.queue.close')?.getClientRects().length);
        // The inspector's tabs (Trim, Crop, Look, Blur, Text, Audio); 'Export'
        // opens the toolbar's Export menu.
        const openSection = async (title) => {
          if (title === 'Export') {
            if (!(await popOpen())) await press(page, 'media-organizer.clipEditor.exportOptions');
            await page.waitForTimeout(300);
            return popOpen();
          }
          const r = await press(page, `media-organizer.clipEditor.tab.${title.toLowerCase()}`);
          if (!r) console.log(`[probe] clip: no tab ${title}`);
          await page.waitForTimeout(300);
          return r;
        };
        const closeMenus = async () => {
          if (await popOpen()) await press(page, 'media-organizer.clipEditor.exportOptions');
          if (await queueOpen()) await press(page, 'media-organizer.clipEditor.queue.close');
        };
        const clickBtn = async (id) => {
          const r = await press(page, id);
          if (!r) console.log(`[probe] clip: no button ${id}`);
          await page.waitForTimeout(400);
          return r;
        };
        const video = () => page.evaluate(() => !!__px.one('media-organizer-clip', 'video'));
        const status = () => page.evaluate(() => __px.one('media-organizer-clip', '.mo-clip-status')?.textContent || '');
        // Trim: split twice, delete the middle segment (a cut), bring it back
        // from the timeline, then undo that.
        await openSection('Trim');
        const focusPage = async () => page.evaluate(() => __px.one('media-organizer-clip', '.mo-clip-page')?.focus());
        const seekTo = async (t) => { await page.evaluate((tt) => { const v = __px.one('media-organizer-clip', 'video'); if (v) { v.pause(); v.currentTime = tt; } }, t); await page.waitForTimeout(300); };
        const laneState = () => page.evaluate(() => {
          const q = (s) => __px.all('media-organizer-clip', s);
          const tc = q('.mo-ce-tcfield');
          const undo = __px.ctl('media-organizer.clipEditor.undo');
          return `blocks=${q('.mo-ce-block').length} cuts=[${q('.mo-ce-dim').map((d) => d.textContent).join(', ')}] segrows=${q('.mo-ce .mo-clip-segrow').length} range=${tc[0]?.value}..${tc[1]?.value} undo=${!!undo && !undo.disabled}`;
        });
        void video;
        await seekTo(2); await focusPage(); await page.keyboard.press('s');
        await seekTo(4); await focusPage(); await page.keyboard.press('s');
        // Segment rows are content: a click on one picks it.
        await page.evaluate(() => __px.all('media-organizer-clip', '.mo-ce .mo-clip-segrow')[1]?.click());
        await page.waitForTimeout(300); await focusPage(); await page.keyboard.press('Delete');
        await page.waitForTimeout(500);
        console.log(`[probe] clip cut: ${await laneState()}`);
        await shot(page, 'clip-segments'); await stageState('clip-segments');
        await page.evaluate(() => __px.all('media-organizer-clip', '.mo-ce-dim').find((d) => /Cut/.test(d.textContent))?.click());
        await page.waitForTimeout(500);
        console.log(`[probe] clip brought back: ${await laneState()}`);
        await focusPage(); await page.keyboard.press('Control+z');
        await page.waitForTimeout(600);
        console.log(`[probe] clip undo: ${await laneState()}`);
        const lanes = await page.evaluate(() => { const q = (s) => __px.all('media-organizer-clip', s); return `thumbs=${q('.mo-ce-thumb').length} wave=${q('.mo-ce-wave')[0]?.style.display !== 'none'} ticks=${q('.mo-ce-tick').length} status="${q('.mo-clip-status')[0]?.textContent || ''}"`; });
        console.log(`[probe] clip timeline: ${lanes}`);
        await shot(page, 'clip-split');
        // Blur: one region on the stage.
        if (await openSection('Blur')) {
          await clickBtn('media-organizer.clipEditor.blur.add');
          await page.evaluate(() => __px.one('media-organizer-clip', 'video')?.pause());
          await page.waitForTimeout(300);
          const d = await page.evaluate(() => { const b = __px.one('media-organizer-clip', '.mo-blur-rect'); if (!b) return 'none'; const r = b.getBoundingClientRect(); return `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)}x${Math.round(r.height)} t=${__px.one('media-organizer-clip', 'video')?.currentTime}`; });
          console.log(`[probe] clip blur rect: ${d}`);
          // Oval shape for the shot.
          await clickBtn('media-organizer.clipEditor.blur.shape.ellipse');
          const shapeState = await page.evaluate(() => {
            const active = Array.from(document.querySelectorAll('[data-px-id^="media-organizer.clipEditor.blur."]')).filter((b) => b.classList.contains('mo-active')).map((b) => b.textContent).join('|');
            // The shape lives on the inner fill; the box stays rectangular so
            // its outline and handles are never masked away.
            const b = __px.one('media-organizer-clip', '.mo-blur-rect .mo-blur-fill');
            const handles = __px.all('media-organizer-clip', '.mo-blur-rect.mo-active .mo-blur-handle').length;
            return `active=${active} radius=${b ? getComputedStyle(b).borderRadius : 'none'} mask=${b ? (getComputedStyle(b).maskImage || '').slice(0, 40) : ''} handles=${handles}`;
          });
          console.log(`[probe] clip blur shape: ${shapeState}`);
          await shot(page, 'clip-blur'); await stageState('clip-blur');
          // The same frame with the box hidden, for a pixel comparison.
          await page.evaluate(() => { __px.one('media-organizer-clip', '.mo-blur-layer').style.visibility = 'hidden'; });
          await shot(page, 'clip-blur-ref');
          await page.evaluate(() => { __px.one('media-organizer-clip', '.mo-blur-layer').style.visibility = ''; });
        }
        // Text: one caption.
        if (await openSection('Text')) {
          await clickBtn('media-organizer.clipEditor.text.add');
          const capInput = page.locator(ctl('media-organizer.clipEditor.text.value')).first();
          if (await capInput.count()) { await capInput.fill('Excess of loss, explained\nA second line'); await capInput.dispatchEvent('input'); await page.waitForTimeout(400); }
          // Pause and park the playhead inside the caption's window so the
          // preview on the stage is in the shot.
          await page.evaluate(() => {
            const v = __px.one('media-organizer-clip', 'video');
            const textPanel = __px.all('media-organizer-clip', '.mo-ce-panel').find((x) => (x.querySelector('.mo-ce-panel-title')?.textContent || '') === 'Text');
            const from = textPanel?.querySelector('.mo-ce-timerow .mo-ce-tcfield');
            const parse = (t) => t.split(':').reduce((acc, p) => acc * 60 + parseFloat(p), 0);
            if (v) { v.pause(); if (from) v.currentTime = parse(from.value) + 0.3; }
          });
          await page.waitForTimeout(600);
          await shot(page, 'clip-text'); await stageState('clip-text');
        }
        // Look: a filter must change the preview; Preview Render must produce a
        // real rendered clip over the stage.
        if (await openSection('Look')) {
          const filterOf = () => page.evaluate(() => getComputedStyle(__px.one('media-organizer-clip', 'video')).filter);
          const before = await filterOf();
          await clickBtn('media-organizer.clipEditor.look.vivid');
          const after = await filterOf();
          console.log(`[probe] clip filter preview: before="${before}" after="${after}"`);
          await shot(page, 'clip-look');
          if (await clickBtn('media-organizer.clipEditor.previewRender')) {
            const t0 = Date.now();
            let rendered = 'timeout';
            while (Date.now() - t0 < 40_000) {
              const overlay = await page.evaluate(() => !!__px.one('media-organizer-clip', '.mo-render-preview video'));
              const st = await status();
              if (overlay) { rendered = 'overlay video present'; break; }
              if (/fail|error|could not/i.test(st)) { rendered = 'status: ' + st; break; }
              await page.waitForTimeout(500);
            }
            console.log(`[probe] clip preview render: ${rendered} (${Math.round((Date.now() - t0) / 1000)}s)`);
            await shot(page, 'clip-render');
            await click(page, 'media-organizer.clipEditor.previewRender.close').catch(() => {});
            await page.waitForTimeout(300);
          }
        }
        // Blur: Track must follow the region across In/Out.
        if (await openSection('Blur') && await clickBtn('media-organizer.clipEditor.blur.track')) {
          const t0 = Date.now();
          let res = 'timeout';
          while (Date.now() - t0 < 60_000) {
            const st = await status();
            if (/Follow done|failed|error|Low lock|tighten/i.test(st)) { res = st; break; }
            await page.waitForTimeout(500);
          }
          console.log(`[probe] clip blur follow: ${res} (${Math.round((Date.now() - t0) / 1000)}s)`);
          await shot(page, 'clip-follow');
          // Pixelate must preview as a real mosaic (a canvas inside the box).
          const pix = await clickBtn('media-organizer.clipEditor.blur.effect.pixelate');
          await clickBtn('media-organizer.clipEditor.blur.shape.ellipse');
          const mosaic = !pix ? 'no Pixelate button' : await page.evaluate(() => {
            const cv = __px.one('media-organizer-clip', '.mo-blur-mosaic');
            if (!cv) return 'no mosaic canvas';
            const r = cv.getBoundingClientRect();
            const ctx = cv.getContext('2d'); const px = ctx.getImageData(0, 0, cv.width, cv.height).data;
            let nonBlack = 0; for (let i = 0; i < px.length; i += 4) if (px[i] + px[i + 1] + px[i + 2] > 30) nonBlack++;
            return `canvas ${cv.width}x${cv.height} cells, shown ${Math.round(r.width)}x${Math.round(r.height)}px, ${nonBlack}/${cv.width * cv.height} cells carry picture`;
          });
          console.log(`[probe] clip pixelate preview: ${mosaic}`);
          await shot(page, 'clip-pixelate');
        }
        // Crop: on, a 9:16 window, the floating bar on the stage.
        if (await openSection('Crop')) {
          const on = await page.evaluate(() => __px.ctl('media-organizer.clipEditor.crop')?.checked);
          if (!on) await clickBtn('media-organizer.clipEditor.crop');
          await clickBtn('media-organizer.clipEditor.crop.aspect.9-16');
          await shot(page, 'clip-crop');
        }
        // Audio, then the Export menu (MP4, then GIF with its frames row).
        if (await openSection('Audio')) await shot(page, 'clip-audio'); await stageState('clip-audio');
        if (await openSection('Export')) {
          await shot(page, 'clip-export'); await stageState('clip-export');
          await clickBtn('media-organizer.clipEditor.format.gif');
          await page.waitForTimeout(2_100);
          await shot(page, 'clip-export-gif');
          await clickBtn('media-organizer.clipEditor.queue.add');
          await page.waitForTimeout(800);
        }
        await closeMenus();
        await clickBtn('media-organizer.clipEditor.queue');
        await shot(page, 'clip-queue');
        await closeMenus();
        // Text on the video: park inside the text's window, drag it, check it moved.
        const capCheck = await page.evaluate(async () => {
          const v = __px.one('media-organizer-clip', 'video');
          v.pause(); v.currentTime = 4.5; // segment 2 starts at 4 → output 2.5, inside 2..5
          await new Promise((r) => setTimeout(r, 500));
          const cap = __px.one('media-organizer-clip', '.mo-ce-caption');
          if (!cap) return 'no caption on the video';
          const r0 = cap.getBoundingClientRect();
          const lines = cap.querySelectorAll('.mo-ce-caption-line').length;
          const opts = { bubbles: true, clientX: r0.left + r0.width / 2, clientY: r0.top + r0.height / 2, button: 0 };
          cap.dispatchEvent(new MouseEvent('mousedown', opts));
          window.dispatchEvent(new MouseEvent('mousemove', { ...opts, clientX: opts.clientX - 120, clientY: opts.clientY - 80 }));
          window.dispatchEvent(new MouseEvent('mouseup', opts));
          await new Promise((r) => setTimeout(r, 300));
          const cap2 = __px.one('media-organizer-clip', '.mo-ce-caption');
          const r1 = cap2 ? cap2.getBoundingClientRect() : null;
          return `lines=${lines} moved=${r1 ? Math.round(r1.left - r0.left) + ',' + Math.round(r1.top - r0.top) : 'gone'}`;
        });
        console.log(`[probe] clip text object: ${capCheck}`);
        await shot(page, 'clip-text-moved');
        // The ? sheet.
        await focusPage(); await page.keyboard.press('?');
        await page.waitForTimeout(300); await shot(page, 'clip-keys'); await page.keyboard.press('Escape');
        // Exports through the real pipeline, the save dialog answered with a
        // workspace path: one to the end, one cancelled half way.
        // The renderer's bridge is frozen; the native dialog is answered in
        // the main process instead.
        const stub = await app.evaluate(({ dialog }, ws) => {
          let n = 0;
          dialog.showSaveDialog = async () => ({ canceled: false, filePath: `${ws}/probe-export-${++n}.mp4` });
          return 'stubbed';
        }, workspace).catch((e) => 'failed: ' + String(e).slice(0, 80));
        console.log(`[probe] clip save dialog: ${stub}`);
        if (stub === 'stubbed') {
          // Empty the queue so Export is the single-clip path, pick MP4.
          if (!(await queueOpen())) await clickBtn('media-organizer.clipEditor.queue');
          for (let i = 0; i < 5; i++) {
            const more = page.locator(`${surface('media-organizer.clipEditor.queueItem')} ${ctl('media-organizer.clipEditor.queueItem.more')}`).first();
            if (!(await more.count())) break;
            await more.click();
            await page.waitForTimeout(200);
            await pickMenu(page, 'Remove');
            await page.waitForTimeout(200);
          }
          await closeMenus();
          await openSection('Export');
          await clickBtn('media-organizer.clipEditor.format.mp4');
          await closeMenus();
          await page.waitForTimeout(500);
          const exportBtn = () => page.locator(ctl('media-organizer.clipEditor.export')).first();
          const busy = () => page.evaluate(() => __px.ctl('media-organizer.clipEditor.export')?.classList.contains('mo-ce-busy'));
          await exportBtn().evaluate((el) => el.click());
          const t0 = Date.now(); let st = '';
          while (Date.now() - t0 < 60_000) {
            st = await page.evaluate(() => {
              const toast = __px.ctl('media-organizer.clipEditor.toast.dismiss');
              const shown = !!toast?.getClientRects().length;
              return `${shown ? 'toast: ' + (__px.one('media-organizer-clip', '.mo-ce-toast-text')?.textContent || '') : ''}|${__px.one('media-organizer-clip', '.mo-clip-status')?.textContent}`;
            });
            if (/^toast/.test(st) || /failed/i.test(st)) break;
            await page.waitForTimeout(500);
          }
          const f1 = await fs.stat(path.join(workspace, 'probe-export-1.mp4')).then((x) => x.size).catch(() => 0);
          console.log(`[probe] clip export: ${st} · file ${f1} bytes (${Math.round((Date.now() - t0) / 1000)}s)`);
          await shot(page, 'clip-exported');
          // Second export, cancelled on its first progress.
          await exportBtn().evaluate((el) => el.click());
          let sawBusy = false;
          for (let i = 0; i < 100; i++) {
            if (await busy()) { sawBusy = true; await exportBtn().evaluate((el) => el.click()); break; }
            await page.waitForTimeout(50);
          }
          await page.waitForTimeout(3_000);
          const after = `${await status()} · button "${await exportBtn().textContent()}"`;
          const f2 = await fs.stat(path.join(workspace, 'probe-export-2.mp4')).then(() => 'left behind').catch(() => 'removed');
          console.log(`[probe] clip cancel: saw progress=${sawBusy} · ${after} · partial file ${f2}`);
        }
        // A narrow pane: the inspector is a sheet over the timeline.
        await page.setViewportSize({ width: 820, height: 900 }).catch(() => {});
        await page.waitForTimeout(600);
        await shot(page, 'clip-narrow');
        await click(page, 'media-organizer.clipEditor.tab.text').catch(() => {});
        await page.waitForTimeout(500);
        await shot(page, 'clip-narrow-sheet');
        await page.setViewportSize({ width: 620, height: 900 }).catch(() => {});
        await page.waitForTimeout(600);
        await shot(page, 'clip-tiny');
        await page.setViewportSize({ width: 1400, height: 900 }).catch(() => {});
        await page.waitForTimeout(400);
        const summary = await page.evaluate(() => {
          const q = (s) => __px.all('media-organizer-clip', s);
          const rows = q('.mo-ce-panel, .mo-ce-popgroup').map((a) => {
            const t = a.querySelector('.mo-ce-panel-title')?.textContent || '';
            const s = a.querySelector('.mo-ce-sum')?.textContent || '';
            return `${t}${s ? ' [' + s + ']' : ''}`;
          });
          const layer = q('.mo-caption-layer')[0];
          const textPanel = q('.mo-ce-panel').find((x) => (x.querySelector('.mo-ce-panel-title')?.textContent || '') === 'Text');
          const nums = Array.from(textPanel ? textPanel.querySelectorAll('.mo-ce-timerow .mo-ce-tcfield') : []).map((i) => i.value).join('..') || 'none';
          const txt = __px.ctl('media-organizer.clipEditor.text.value')?.value || '';
          const vt = q('video')[0]?.currentTime;
          const capDiag = `layer=${layer ? getComputedStyle(layer).display + '/' + layer.children.length : 'none'} window=${nums} text="${txt}" vt=${vt}`;
          return `sections=${rows.join(' | ')} segrows=${q('.mo-clip-segrow').length} blurrects=${q('.mo-blur-rect').length} captions=${q('.mo-ce-caption').length} ${capDiag} status="${q('.mo-clip-status')[0]?.textContent || ''}"`;
        });
        console.log(`[probe] clip: ${summary}`);
        // Close the editor tab so later scenes start clean.
        await runCommand(page, ['workbench.action.closeActiveEditor']);
        await page.waitForTimeout(300);
      });
    }
    if (scenes.includes('settings')) {
      const ok = await runCommand(page, ['settings.open']);
      if (ok) { await page.waitForTimeout(1_000); await shot(page, 'settings'); await closeSettings(page); }
      else console.log('[probe] settings: no command matched, skipped');
    }

    if (scenes.includes('appearance')) {
      await scene('appearance', async () => {
        const ok = await runCommand(page, ['settings.openAppearance']);
        if (!ok) throw new Error('settings.openAppearance not available');
        await page.waitForSelector(`${ctl('appearance.mode.dark')} >> visible=true`, { state: 'visible', timeout: 10_000 });
        await page.waitForTimeout(800);
        await shot(page, 'appearance');
        await closeSettings(page);
      });
    }
  } finally {
    if (errors.length) {
      console.log(`[probe] ${errors.length} uncaught renderer error(s):`);
      for (const e of errors) console.log(`  ${e}`);
    }
    await app.close().catch(() => {});
    await fs.rm(appRoot, { recursive: true, force: true }).catch(() => {});
    await fs.rm(workspace, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((err) => { console.error('[probe] failed:', err); process.exit(1); });
