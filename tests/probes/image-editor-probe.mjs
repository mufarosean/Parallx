// image-editor-probe.mjs: the image editor (docs/IMAGE_EDITOR.md) in the real
// app, never on screen.
//
// Seeds a throwaway workspace with real images (the Tag Review seed, which
// also gives fractal.jpg a PATTERNS tag, plus a photo with a mark drawn on
// it), launches the app HIDDEN (PARALLX_HIDDEN_PROBE), and drives the editor:
//   open      the tab: histogram, four tools, four sections, presets, filmstrip
//   sliders   every slider of every section changes the picture
//   compare   Show Original, Split View
//   keys      undo, redo, original, through the keybinding service
//   zoom      100%, Fit
//   light     Auto, the tone curve
//   colour    Black And White, the mixer, grading
//   presets   hover previews, click applies
//   crop      shapes, straighten, turns, flips, dragging the frame
//   copy      Copy Edit, then Paste Edit on another photo from the filmstrip
//   save      Save As Copy at full size; the saved file against what was shown
//   remove    a mark brushed over is gone, and the copy shows the photo behind it
//   enhance   a copy twice the size (when the upscaler is installed)
//   reopen    the edit comes back
//   entry     Edit Image in the library's menu and on a photo's tab
// After the app closes it reads the editor's tables back.
//
// Remove needs the model on disk: PARALLX_MODELS_DIR, or <repo>/data/models.
//
// Usage: node tests/probes/image-editor-probe.mjs <outDir>
// Requires `npm run build` first (the app loads dist/).
import { _electron as electron } from 'playwright';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const outDir = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'parallx-image-editor-shots'));
const ELECTRON = path.join(PROJECT_ROOT, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const SEED = path.join(__dirname, 'tag-review-seed.cjs');
const VERIFY = path.join(__dirname, 'image-editor-verify.cjs');
const BOXING = path.join(PROJECT_ROOT, 'data', 'dashboard-assets', 'aa21bc3e-d260-41ac-8bcf-ab5efe10d0cb.jpg');
const MODELS = process.env.PARALLX_MODELS_DIR || path.join(PROJECT_ROOT, 'data', 'models');
const MODEL = '1faef5301d78db7dda502fe59966957ec4b79dd64e16f03ed96913c7a4eb68d6.onnx';
const UPSCALER = path.join(PROJECT_ROOT, 'ext', 'media-organizer', 'bin', process.platform === 'win32' ? 'realesrgan-ncnn-vulkan.exe' : 'realesrgan-ncnn-vulkan');
const PHOTO = { boxing: 1, card: 2, fractal: 3, bars: 4, marked: 5 };   // ids in seed order
const MARK = { x: 380, y: 60, w: 150, h: 46 };                           // the mark drawn on marked.jpg (564 x 846), over the background
const GRID = 48;
const ONLY = (process.env.PROBE_ONLY || '').split(',').map((x) => x.trim()).filter(Boolean);
const want = (name) => !ONLY.length || ONLY.includes(name);
let APP = null;
let failures = 0;

function nodeEnv() { return { ...process.env, ELECTRON_RUN_AS_NODE: '1' }; }
function launchEnv(appRoot) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE') env[k] = v;
  env.PARALLX_TEST_MODE = '1';
  env.PARALLX_RENDERER_PORT = '0';
  env.PARALLX_HIDDEN_PROBE = '1';
  env.PARALLX_APP_ROOT = appRoot;
  env.PARALLX_USER_DATA = path.join(appRoot, 'data', 'chromium-cache');
  env.PARALLX_MODELS_DIR = MODELS;
  return env;
}
const dbPaths = (ws) => ['media-organizer', 'parallx-community.media-organizer']
  .map((id) => path.join(ws, '.parallx', 'extensions', id, 'data.db'));
const ffmpeg = (args) => { const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { windowsHide: true, maxBuffer: 64 * 1024 * 1024 }); if (r.status !== 0) throw new Error(`ffmpeg: ${String(r.stderr).slice(0, 300)}`); return r.stdout; };

async function makeRoots() {
  const stamp = Date.now();
  const appRoot = path.join(os.tmpdir(), `parallx-edit-root-${stamp}`);
  const workspace = path.join(os.tmpdir(), `parallx-edit-ws-${stamp}`);
  const photos = path.join(workspace, 'photos');
  await fs.mkdir(path.join(appRoot, 'data'), { recursive: true });
  await fs.mkdir(photos, { recursive: true });
  await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: workspace }));
  await fs.symlink(path.join(PROJECT_ROOT, 'ext'), path.join(appRoot, 'ext'), 'junction');
  await fs.copyFile(BOXING, path.join(photos, 'boxing.jpg'));
  const gen = [['card.jpg', 'testsrc2=size=2400x1600', 2400, 1600], ['fractal.jpg', 'mandelbrot=size=1800x1200', 1800, 1200], ['bars.jpg', 'smptehdbars=size=1920x1080', 1920, 1080]];
  for (const [name, src] of gen) ffmpeg(['-f', 'lavfi', '-i', src, '-frames:v', '1', '-q:v', '3', path.join(photos, name)]);
  // the same photo with a mark on it: a light label with a dark bar, the kind of thing Remove is for
  ffmpeg(['-i', BOXING, '-vf', `drawbox=x=${MARK.x}:y=${MARK.y}:w=${MARK.w}:h=${MARK.h}:color=white@0.92:t=fill,drawbox=x=${MARK.x + 14}:y=${MARK.y + 16}:w=${MARK.w - 28}:h=14:color=black@0.95:t=fill`, '-frames:v', '1', '-q:v', '2', path.join(photos, 'marked.jpg')]);
  const spec = [{ basename: 'boxing.jpg', width: 564, height: 846 }, ...gen.map(([basename, , width, height]) => ({ basename, width, height })), { basename: 'marked.jpg', width: 564, height: 846 }];
  const specPath = path.join(appRoot, 'spec.json');
  await fs.writeFile(specPath, JSON.stringify(spec));
  for (const db of dbPaths(workspace)) {
    const r = spawnSync(ELECTRON, [SEED, 'seed', db, photos, specPath], { env: nodeEnv(), encoding: 'utf8', windowsHide: true });
    if (r.status !== 0) throw new Error(`seed failed: ${r.stderr || r.stdout}`);
  }
  return { appRoot, workspace, photos };
}

async function runCommand(page, id, ...args) {
  return page.evaluate(async ({ commandId, args }) => {
    const svc = window.__parallx_workbench__?._services?.get?.({ id: 'ICommandService' });
    if (!svc?.executeCommand) return 'no command service';
    try { await svc.executeCommand(commandId, ...args); return 'ok'; } catch (e) { return 'failed: ' + (e && e.message); }
  }, { commandId: id, args });
}

async function shot(page, name) {
  await page.waitForTimeout(1_200);
  const file = path.join(outDir, `${name}.png`);
  try {
    await page.screenshot({ path: file, timeout: 8_000 });
  } catch {
    const out = await APP.evaluate(async ({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed());
      if (!w) return null;
      const img = await w.webContents.capturePage();
      return { b64: img.toPNG().toString('base64') };
    });
    if (!out || !out.b64) { console.log(`[probe] ${name}: no frame`); return; }
    await fs.writeFile(file, Buffer.from(out.b64, 'base64'));
  }
  console.log(`[probe] ${name} -> ${file}`);
}

const log = (label, value) => console.log(`[probe] ${label}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
function check(label, ok, detail) {
  if (!ok) failures++;
  console.log(`[probe] ${ok ? 'PASS' : 'FAIL'} ${label}${detail !== undefined && detail !== null ? ': ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`);
}

// The editor on screen: what it says and how the picture looks.
const editorState = (page, size = GRID) => page.evaluate((size) => {
  const root = Array.from(document.querySelectorAll('.mo-edit')).find((r) => r.offsetParent !== null);
  if (!root) return null;
  const cv = root.querySelector('.mo-edit-canvas');
  const out = { brightness: -1, colour: -1, grid: null, box: '' };
  try {
    const full = document.createElement('canvas'); full.width = cv.width; full.height = cv.height;
    const fx = full.getContext('2d', { willReadFrequently: true }); fx.drawImage(cv, 0, 0);
    const d = fx.getImageData(0, 0, full.width, full.height).data;
    let x0 = full.width, y0 = full.height, x1 = -1, y1 = -1;
    for (let y = 0; y < full.height; y += 2) for (let x = 0; x < full.width; x += 2) if (d[(y * full.width + x) * 4 + 3] > 200) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 >= 0) {
      const small = document.createElement('canvas'); small.width = size; small.height = size;
      const sx = small.getContext('2d', { willReadFrequently: true }); sx.imageSmoothingQuality = 'high';
      sx.drawImage(full, x0, y0, x1 - x0 + 1, y1 - y0 + 1, 0, 0, size, size);
      const s = sx.getImageData(0, 0, size, size).data;
      const rgb = []; let sum = 0; let spread = 0;
      for (let i = 0; i < s.length; i += 4) { rgb.push(s[i], s[i + 1], s[i + 2]); sum += s[i] + s[i + 1] + s[i + 2]; spread += Math.max(s[i], s[i + 1], s[i + 2]) - Math.min(s[i], s[i + 1], s[i + 2]); }
      out.grid = rgb; out.box = `${x1 - x0 + 1}x${y1 - y0 + 1}`;
      out.brightness = Math.round(sum / (size * size * 3)); out.colour = Math.round(spread / (size * size));
    }
  } catch { /* no picture yet */ }
  const btn = (text) => Array.from(root.querySelectorAll('button')).find((b) => b.textContent.trim() === text || b.getAttribute('aria-label') === text);
  const st = (text) => { const b = btn(text); return !b ? 'missing' : (b.disabled ? 'off' : 'on'); };
  const values = {};
  for (const i of root.querySelectorAll('.mo-edit-panel input[type="range"]')) values[i.dataset.slider] = Number(i.value);
  let histogram = 0;
  try { const h = root.querySelector('.mo-edit-hist-canvas'); const d = h.getContext('2d').getImageData(0, 0, h.width, h.height).data; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) histogram++; } catch { /* none */ }
  const frame = root.querySelector('.mo-edit-cropframe');
  const chip = root.querySelector('.mo-edit-chip');
  const message = root.querySelector('.mo-edit-message');
  return Object.assign(out, {
    title: root.querySelector('.mo-edit-title')?.textContent,
    size: root.querySelector('.mo-edit-topbar-left .mo-edit-dim')?.textContent,
    zoom: root.querySelector('.mo-edit-zoom')?.textContent,
    tool: root.querySelector('.mo-edit-tool.is-on')?.getAttribute('aria-label'),
    tools: Array.from(root.querySelectorAll('.mo-edit-tool')).map((t) => t.getAttribute('aria-label')).join('/'),
    sections: Array.from(root.querySelectorAll('.mo-edit-panel-body > .mo-edit-section > .mo-edit-section-head .mo-edit-section-title')).map((s) => s.textContent).join('/'),
    values,
    buttons: `undo=${st('Undo')} redo=${st('Redo')} reset=${st('Reset')} original=${st('Show Original')} split=${st('Split View')} copy=${st('Copy Edit')} paste=${st('Paste Edit')} save=${st('Save As Copy')}`,
    saveOver: st('Save'),
    saveOverHint: btn('Save')?.getAttribute('title') || '',
    original: btn('Show Original')?.getAttribute('aria-pressed'),
    splitOn: btn('Split View')?.getAttribute('aria-pressed'),
    bw: btn('Black And White')?.getAttribute('aria-pressed') || 'none',
    pannable: root.querySelector('.mo-edit-stage').classList.contains('is-pannable'),
    histogram,
    presets: root.querySelectorAll('.mo-edit-preset').length,
    film: root.querySelectorAll('.mo-edit-film-item').length,
    filmCurrent: root.querySelector('.mo-edit-film-item.is-current')?.getAttribute('aria-label') || '',
    filmEdited: Array.from(root.querySelectorAll('.mo-edit-film-item.is-edited')).map((f) => f.getAttribute('aria-label')).join(','),
    filmCount: root.querySelector('.mo-edit-film-count')?.textContent || '',
    frame: frame && !frame.classList.contains('mo-hidden') ? `${Math.round(frame.offsetWidth)}x${Math.round(frame.offsetHeight)}` : 'hidden',
    chip: !chip || chip.classList.contains('mo-hidden') ? '' : (chip.textContent || ''),
    progress: !chip || chip.classList.contains('mo-hidden') ? null : {
      label: chip.querySelector('.mo-edit-chip-label')?.textContent || '',
      note: chip.querySelector('.mo-edit-chip-note')?.textContent || '',
      bar: !chip.querySelector('.mo-edit-progress')?.classList.contains('mo-hidden'),
      percent: Number(chip.querySelector('.mo-edit-progress')?.getAttribute('aria-valuenow') || 0),
    },
    message: !message || message.classList.contains('mo-hidden') ? '' : (message.textContent || ''),
    hints: Array.from(root.querySelectorAll('.mo-edit-panel-body .mo-edit-hint')).map((h) => h.textContent).join(' | ').slice(0, 400),
    panelButtons: Array.from(root.querySelectorAll('.mo-edit-panel-body button')).map((b) => b.textContent.trim()).filter(Boolean).join('/'),
    panelTitles: Array.from(root.querySelectorAll('.mo-edit-panel-body .mo-edit-section-title')).map((t) => t.textContent).join('/'),
    dropdowns: root.querySelectorAll('.mo-edit-panel-body .mo-dd').length,
    nativeSelects: root.querySelectorAll('select').length,
  });
}, size);

// How far two pictures are apart: the mean difference per channel, 0..255.
const apart = (a, b) => { if (!a || !b || a.length !== b.length) return -1; let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };

// Read the editor until `test` holds (or the time is up); returns the last reading and how long it took.
async function settle(page, test, ms = 10_000) {
  const start = Date.now();
  let st = await editorState(page);
  while (!(st && test(st)) && Date.now() - start < ms) { await page.waitForTimeout(120); st = await editorState(page); }
  if (st) st.took = Date.now() - start;
  return st;
}

const setSlider = (page, id, value) => page.evaluate(({ id, value }) => {
  const root = Array.from(document.querySelectorAll('.mo-edit')).find((r) => r.offsetParent !== null);
  const el = Array.from(root.querySelectorAll('.mo-edit-panel input[type="range"]')).find((i) => i.dataset.slider === id);
  if (!el) return false;
  el.value = String(value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}, { id, value });

const click = (page, text, scope = '') => page.evaluate(({ text, scope }) => {
  const root = Array.from(document.querySelectorAll('.mo-edit')).find((r) => r.offsetParent !== null);
  const within = scope ? root.querySelector(scope) : root;
  const b = within && Array.from(within.querySelectorAll('button')).find((x) => x.textContent.trim() === text || x.getAttribute('aria-label') === text);
  if (!b || b.disabled) return false;
  b.click();
  return true;
}, { text, scope });

// Open a section of the panel by its title, if it is folded.
const unfold = (page, title) => page.evaluate((title) => {
  const root = Array.from(document.querySelectorAll('.mo-edit')).find((r) => r.offsetParent !== null);
  const fold = Array.from(root.querySelectorAll('.mo-edit-section-fold')).find((f) => f.querySelector('.mo-edit-section-title')?.textContent === title);
  if (!fold) return false;
  if (fold.getAttribute('aria-expanded') === 'false') fold.click();
  return true;
}, title);

const rectOf = (page, selector) => page.evaluate((selector) => {
  const root = Array.from(document.querySelectorAll('.mo-edit')).find((r) => r.offsetParent !== null);
  const el = root.querySelector(selector);
  if (!el) return null;
  el.scrollIntoView({ block: 'center' });
  const b = el.getBoundingClientRect();
  return { x: b.left, y: b.top, w: b.width, h: b.height };
}, selector);

// Choose an item of the nth shared dropdown in the panel.
async function choose(page, nth, label) {
  const button = page.locator('.mo-edit-panel-body .mo-dd .ui-dropdown__button').nth(nth);
  if (!(await button.count())) return false;
  await button.click();
  const item = page.locator('.ui-dropdown__list .ui-dropdown__item').filter({ hasText: label }).first();
  await item.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {});
  if (!(await item.count())) return false;
  await item.click();
  return true;
}

// The middle of the picture as drawn, pixel for pixel: what a control that works on fine detail changes.
const finePixels = (page) => page.evaluate(() => {
  const root = Array.from(document.querySelectorAll('.mo-edit')).find((r) => r.offsetParent !== null);
  const cv = root.querySelector('.mo-edit-canvas');
  const n = 256;
  const c = document.createElement('canvas'); c.width = n; c.height = n;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(cv, Math.round((cv.width - n) / 2), Math.round((cv.height - n) / 2), n, n, 0, 0, n, n);
  const d = x.getImageData(0, 0, n, n).data;
  const rgb = [];
  for (let i = 0; i < d.length; i += 4) rgb.push(d[i], d[i + 1], d[i + 2]);
  return rgb;
});
async function fineMoves(page, id, value, before) {
  if (!(await setSlider(page, id, value))) return -1;
  const start = Date.now(); let by = 0;
  while (Date.now() - start < 6_000) { by = apart(await finePixels(page), before); if (by > 0.4) break; await page.waitForTimeout(150); }
  return by;
}

function fileGrid(file, size, crop) {
  const vf = (crop ? `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y},` : '') + `scale=${size}:${size}:flags=area`;
  return Array.from(ffmpeg(['-i', file, '-vf', vf, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']));
}
function fileSize(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file], { encoding: 'utf8', windowsHide: true });
  return String(r.stdout || '').trim();
}
// Mean difference per channel, leaving out cells on a colour boundary (their value depends on how the shrink was done).
function meanDiff(a, b, size) {
  const flat = (arr, i) => {
    const x = i % size; const y = (i / size) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx; const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const j = ny * size + nx;
      for (let c = 0; c < 3; c++) if (Math.abs(arr[i * 3 + c] - arr[j * 3 + c]) > 24) return false;
    }
    return true;
  };
  let sum = 0; let n = 0;
  for (let i = 0; i < size * size; i++) {
    if (!flat(b, i)) continue;
    for (let c = 0; c < 3; c++) { sum += Math.abs(a[i * 3 + c] - b[i * 3 + c]); n++; }
  }
  return { mean: n ? sum / n : -1, cells: n / 3 };
}
async function waitForFile(file, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) { if (existsSync(file)) return true; await new Promise((r) => setTimeout(r, 250)); }
  return existsSync(file);
}

async function openEditor(page, photoId, name) {
  const r = await runCommand(page, 'media-organizer.editImage', photoId);
  const st = await settle(page, (s) => s.title === name && s.brightness >= 0 && Object.keys(s.values).length > 0 && !s.message, 30_000);
  await page.waitForTimeout(400);
  return { r, st };
}
// A slider moved off rest must change the picture; returns how far.
async function moves(page, id, value, before) {
  if (!(await setSlider(page, id, value))) return { ok: false, by: -1, st: null };
  const st = await settle(page, (s) => s.values[id] === value && apart(s.grid, before.grid) > 0.4, 6_000);
  return { ok: st.values[id] === value && apart(st.grid, before.grid) > 0.4, by: apart(st.grid, before.grid), st };
}
const resetAll = async (page) => { await click(page, 'Reset'); return settle(page, (s) => s.buttons.includes('reset=off'), 8_000); };

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  const { appRoot, workspace, photos } = await makeRoots();
  const hasModel = existsSync(path.join(MODELS, MODEL));
  const hasUpscaler = existsSync(UPSCALER);
  console.log(`[probe] app root ${appRoot}\n[probe] workspace ${workspace}\n[probe] remove model ${hasModel ? 'on disk' : 'NOT on disk: Remove is not checked'}; upscaler ${hasUpscaler ? 'installed' : 'NOT installed: Enhance is not checked'}`);
  const app = await electron.launch({ args: ['.'], cwd: PROJECT_ROOT, env: launchEnv(appRoot) });
  APP = app;
  const errors = [];
  try {
    const page = await app.firstWindow();
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 300)}`); });
    page.on('console', (m) => { if (/\[MediaOrganizer\] (enhance|remove)/.test(m.text())) console.log(`[probe] app says: ${m.text()}`); });
    await page.setViewportSize({ width: 1500, height: 950 }).catch(() => {});
    await page.waitForSelector('[data-part-id="workbench.parts.titlebar"]', { state: 'attached', timeout: 90_000 });
    await page.waitForTimeout(3_000);
    await page.evaluate(async () => {
      await window.__parallx_workbench__._services.get({ id: 'IToolEnablementService' }).setEnablement('parallx-community.media-organizer', true);
    });
    await page.waitForTimeout(3_000);

    // ── open ──
    const opened = await openEditor(page, PHOTO.fractal, 'fractal.jpg');
    const open = opened.st;
    log('editImage', opened.r);
    log('open', { ...open, grid: undefined });
    check('the editor opens on the photo', !!open && open.title === 'fractal.jpg' && open.size === '1800 × 1200', open && `${open.title} ${open.size}`);
    check('four tools, Edit chosen', open.tools === 'Edit/Crop And Rotate/Remove/Enhance' && open.tool === 'Edit', `${open.tools}; ${open.tool}`);
    check('Light, Colour, Effects and Detail', open.sections === 'Light/Colour/Effects/Detail', open.sections);
    check('the histogram is drawn', (await settle(page, (s) => s.histogram > 200)).histogram > 200);
    check('twelve looks in the presets panel', open.presets === 12, String(open.presets));
    const filmed = await settle(page, (s) => s.film === 5 && s.filmCurrent === 'fractal.jpg');
    check('the filmstrip shows the folder, this photo marked', filmed.film === 5 && filmed.filmCurrent === 'fractal.jpg' && filmed.filmCount === '4 of 5', `${filmed.film} photos, current ${filmed.filmCurrent}, ${filmed.filmCount}`);
    check('nothing to undo, reset, compare or save yet', open.buttons === 'undo=off redo=off reset=off original=off split=off copy=off paste=off save=off', open.buttons);
    check('no native selects', open.nativeSelects === 0);
    await shot(page, 'editor-open');

    if (want('edit')) {
    // ── every slider changes the picture ──
    for (const title of ['Light', 'Colour', 'Effects', 'Detail']) await unfold(page, title);
    await page.waitForTimeout(300);
    const rest = await settle(page, (s) => s.brightness >= 0);
    const tries = { exposure: 1, contrast: 0.6, highlights: -0.8, shadows: 0.8, whites: 0.8, blacks: -0.8, warmth: 0.8, tint: 0.8, vibrance: -0.9, saturation: -0.9,
      clarity: 1, dehaze: 0.9, vignette: -0.9 };
    const dead = []; const by = {};
    for (const [id, value] of Object.entries(tries)) {
      const m = await moves(page, id, value, rest);
      by[id] = Number(m.by.toFixed(2));
      if (!m.ok) dead.push(id);
      await click(page, 'Reset');
      await settle(page, (s) => apart(s.grid, rest.grid) < 0.2 && s.buttons.includes('reset=off'), 6_000);
    }
    check('every broad slider changes the picture', dead.length === 0, dead.length ? `no change from: ${dead.join(', ')}; ${JSON.stringify(by)}` : by);
    // the ones that work on fine detail are judged where they can be seen: at 100%, pixel for pixel
    await click(page, '100%');
    await settle(page, (s) => s.zoom === '100%');
    await page.waitForTimeout(1_200);
    const fineRest = await finePixels(page);
    const fineBy = {}; const fineDead = [];
    for (const [id, value] of Object.entries({ texture: 1, grain: 1, sharpen: 1.5, noise: 1, noiseColour: 1 })) {
      const d = await fineMoves(page, id, value, fineRest);
      fineBy[id] = Number(d.toFixed(2));
      if (!(d > 0.4)) fineDead.push(id);
      await click(page, 'Reset');
      const start = Date.now();
      while (Date.now() - start < 6_000 && apart(await finePixels(page), fineRest) > 0.05) await page.waitForTimeout(150);
    }
    check('every fine slider changes the picture at 100%', fineDead.length === 0, fineDead.length ? `no change from: ${fineDead.join(', ')}; ${JSON.stringify(fineBy)}` : fineBy);
    await click(page, 'Fit');
    await settle(page, (s) => s.zoom !== '100%' && apart(s.grid, rest.grid) < 0.3);
    // the ones that shape another: they matter only with their parent on
    await setSlider(page, 'vignette', -0.8);
    const vig = await settle(page, (s) => s.values.vignette === -0.8 && apart(s.grid, rest.grid) > 0.4);
    const mid = await moves(page, 'vignetteMid', 0.05, vig);
    const feather = await moves(page, 'vignetteFeather', 0.02, mid.st || vig);
    check('Midpoint and Feather shape the vignette', mid.ok && feather.ok, `${mid.by.toFixed(2)}, ${feather.by.toFixed(2)}`);
    await resetAll(page);

    // ── compare ──
    await setSlider(page, 'exposure', 1);
    const bright = await settle(page, (s) => s.brightness > rest.brightness + 5);
    check('an edit turns the buttons on', bright.buttons === 'undo=on redo=off reset=on original=on split=on copy=on paste=off save=on', bright.buttons);
    await click(page, 'Show Original');
    const orig = await settle(page, (s) => s.original === 'true' && apart(s.grid, rest.grid) < 0.5);
    check('Show Original shows the untouched picture', orig.original === 'true' && apart(orig.grid, rest.grid) < 0.5, `${apart(orig.grid, rest.grid).toFixed(2)} from the original, after ${orig.took} ms`);
    await click(page, 'Show Original');
    await settle(page, (s) => s.original === 'false' && s.brightness === bright.brightness);
    await click(page, 'Split View');
    const split = await settle(page, (s) => s.splitOn === 'true' && s.brightness > rest.brightness + 1 && s.brightness < bright.brightness - 1);
    check('Split View shows the original on one side and the edit on the other', split.splitOn === 'true' && split.brightness > rest.brightness && split.brightness < bright.brightness, `${rest.brightness} < ${split.brightness} < ${bright.brightness}`);
    await shot(page, 'editor-split');
    await click(page, 'Split View');
    await settle(page, (s) => s.splitOn === 'false' && s.brightness === bright.brightness);

    // ── keys, through the keybinding service ──
    await page.locator('.mo-edit-stage').first().click({ position: { x: 20, y: 20 } });
    await page.keyboard.press('Control+z');
    const undone = await settle(page, (s) => s.values.exposure === 0 && apart(s.grid, rest.grid) < 0.5);
    check('Ctrl+Z undoes', undone.values.exposure === 0 && apart(undone.grid, rest.grid) < 0.5 && undone.buttons.includes('redo=on'), `exposure ${undone.values.exposure}, ${undone.buttons}`);
    await page.keyboard.press('Control+y');
    const redone = await settle(page, (s) => s.values.exposure === 1 && s.brightness === bright.brightness);
    check('Ctrl+Y redoes', redone.values.exposure === 1 && redone.brightness === bright.brightness, `exposure ${redone.values.exposure}`);
    await page.keyboard.press('Backslash');
    check('\\ shows the original', (await settle(page, (s) => s.original === 'true')).original === 'true');
    await page.keyboard.press('Backslash');
    check('\\ again shows the edit', (await settle(page, (s) => s.original === 'false')).original === 'false');
    await page.locator('.mo-edit-panel input[type="range"]').first().focus();
    await page.keyboard.press('Control+z');
    check('Ctrl+Z works with a slider focused', (await settle(page, (s) => s.values.exposure === 0)).values.exposure === 0);
    await page.keyboard.press('Control+Shift+z');
    check('Ctrl+Shift+Z redoes', (await settle(page, (s) => s.values.exposure === 1)).values.exposure === 1);

    // ── zoom ──
    const fit = (await editorState(page)).zoom;
    await click(page, '100%');
    const full = await settle(page, (s) => s.zoom === '100%');
    check('100% shows one pixel for one pixel and can be panned', full.zoom === '100%' && full.pannable, `${fit} -> ${full.zoom}, pannable ${full.pannable}`);
    await click(page, 'Fit');
    const refit = await settle(page, (s) => s.zoom === fit);
    check('Fit shows the whole picture again', refit.zoom === fit && !refit.pannable, refit.zoom);
    await resetAll(page);

    // ── Light: the tone curve ──
    await unfold(page, 'Tone Curve');
    await page.waitForTimeout(500);
    const curveBox = await rectOf(page, '.mo-edit-curve');
    if (curveBox) {
      // lift the middle of the line: press at the centre, release well above it
      await page.mouse.move(curveBox.x + curveBox.w * 0.5, curveBox.y + curveBox.h * 0.5);
      await page.mouse.down();
      await page.mouse.move(curveBox.x + curveBox.w * 0.5, curveBox.y + curveBox.h * 0.22, { steps: 6 });
      await page.mouse.up();
    }
    const curved = await settle(page, (s) => s.brightness > rest.brightness + 3);
    check('lifting the tone curve brightens the picture', !!curveBox && curved.brightness > rest.brightness + 3, `${rest.brightness} -> ${curved.brightness}`);
    await shot(page, 'editor-curve');
    const uncurved = (await click(page, 'Reset Curve')) ? await settle(page, (s) => apart(s.grid, rest.grid) < 0.5) : null;
    check('Reset Curve brings the line back', !!uncurved && apart(uncurved.grid, rest.grid) < 0.5);

    // ── Colour: Black And White, the mixer, grading ──
    await click(page, 'Black And White');
    const bw = await settle(page, (s) => s.bw === 'true' && s.colour <= 1);
    check('Black And White takes the colour out', bw.bw === 'true' && bw.colour <= 1 && rest.colour > 10, `colour ${rest.colour} -> ${bw.colour}`);
    await click(page, 'Black And White');
    await settle(page, (s) => s.bw === 'false' && apart(s.grid, rest.grid) < 0.5);
    await unfold(page, 'Colour Mixer');
    await page.waitForTimeout(300);
    await click(page, 'Green', '.mo-edit-dots');
    await page.waitForTimeout(300);
    const mixed = await moves(page, 'mix-1', -1, rest);
    check('the colour mixer changes one colour', mixed.ok, `by ${mixed.by.toFixed(2)}`);
    await click(page, 'Reset Mixer');
    await settle(page, (s) => apart(s.grid, rest.grid) < 0.5);
    await unfold(page, 'Colour Grading');
    await page.waitForTimeout(300);
    const wheel = await rectOf(page, '.mo-edit-wheel');
    if (wheel) {
      await page.mouse.move(wheel.x + wheel.w * 0.5, wheel.y + wheel.h * 0.5);
      await page.mouse.down();
      await page.mouse.move(wheel.x + wheel.w * 0.9, wheel.y + wheel.h * 0.35, { steps: 5 });
      await page.mouse.up();
    }
    const graded = await settle(page, (s) => apart(s.grid, rest.grid) > 0.4);
    check('a grading wheel colours the shadows', !!wheel && apart(graded.grid, rest.grid) > 0.4, `by ${apart(graded.grid, rest.grid).toFixed(2)}`);
    await shot(page, 'editor-colour');
    await resetAll(page);

    // ── presets ──
    const presetBox = await rectOf(page, '.mo-edit-preset');
    if (presetBox) await page.mouse.move(presetBox.x + 20, presetBox.y + presetBox.h / 2);
    const hovered = await settle(page, (s) => apart(s.grid, rest.grid) > 0.4);
    check('hovering a preset previews it without changing the edit', apart(hovered.grid, rest.grid) > 0.4 && hovered.buttons.includes('reset=off'), `by ${apart(hovered.grid, rest.grid).toFixed(2)}, ${hovered.buttons}`);
    await page.mouse.move(700, 10);
    check('moving away ends the preview', apart((await settle(page, (s) => apart(s.grid, rest.grid) < 0.5)).grid, rest.grid) < 0.5);
    await click(page, 'Vivid', '.mo-edit-presets');
    await page.mouse.move(700, 10);
    const vivid = await settle(page, (s) => s.values.saturation === 0.3);
    check('clicking a preset applies it', vivid.values.saturation === 0.3 && vivid.values.contrast === 0.12 && vivid.buttons.includes('reset=on'), `saturation ${vivid.values.saturation}, contrast ${vivid.values.contrast}`);

    // ── Auto, on a real photo ──
    const box1 = (await openEditor(page, PHOTO.boxing, 'boxing.jpg')).st;
    await click(page, 'Auto');
    const auto = await settle(page, (s) => s.buttons.includes('reset=on') && apart(s.grid, box1.grid) > 0.2);
    await shot(page, 'editor-auto');
    check('Auto sets the Light sliders from the picture', auto.buttons.includes('reset=on') && Object.values(auto.values).every((v) => Number.isFinite(v)) && apart(auto.grid, box1.grid) > 0.2 && Math.abs(auto.values.whites) <= 0.6 && Math.abs(auto.values.blacks) <= 0.6,
      `exposure ${auto.values.exposure}, contrast ${auto.values.contrast}, whites ${auto.values.whites}, blacks ${auto.values.blacks}`);

    // ── Copy Edit, then Paste Edit on another photo, by way of the filmstrip ──
    await click(page, 'Copy Edit');
    await page.waitForTimeout(300);
    await page.evaluate(() => { const root = Array.from(document.querySelectorAll('.mo-edit')).find((r) => r.offsetParent !== null); root.querySelector('.mo-edit-film-item[aria-label="card.jpg"]').click(); });
    const card = await settle(page, (s) => s.title === 'card.jpg' && s.size === '2400 × 1600' && s.brightness >= 0 && !s.message && s.film === 5, 30_000);
    check('the filmstrip opens another photo in the same tab', card.title === 'card.jpg' && card.size === '2400 × 1600' && card.filmCurrent === 'card.jpg', `${card.title} ${card.size}`);
    check('edited photos are marked in the filmstrip', card.filmEdited.includes('boxing.jpg') && card.filmEdited.includes('fractal.jpg'), card.filmEdited);
    check('Paste Edit is offered', card.buttons.includes('paste=on'), card.buttons);
    await click(page, 'Paste Edit');
    const pasted = await settle(page, (s) => s.values.exposure === auto.values.exposure && s.buttons.includes('reset=on'));
    check('Paste Edit brings the look across', pasted.values.exposure === auto.values.exposure && pasted.values.whites === auto.values.whites && pasted.values.vibrance === auto.values.vibrance, `exposure ${pasted.values.exposure}`);
    await page.locator('.mo-edit-stage').first().click({ position: { x: 20, y: 20 } });
    await page.keyboard.press('PageDown');
    const next = await settle(page, (s) => s.title === 'fractal.jpg' && s.brightness >= 0 && !s.message, 30_000);
    check('Page Down moves to the next photo, with its own edit', next.title === 'fractal.jpg' && next.values.saturation === 0.3, `${next.title}, saturation ${next.values.saturation}`);

    // ── Crop And Rotate ──
    await resetAll(page);
    await click(page, 'Crop And Rotate');
    const crop0 = await settle(page, (s) => s.tool === 'Crop And Rotate' && s.frame !== 'hidden');
    check('the crop tool shows the frame over the whole photo', crop0.tool === 'Crop And Rotate' && crop0.frame !== 'hidden' && crop0.size === '1800 × 1200', `frame ${crop0.frame}, ${crop0.size}`);
    check('it uses the shared dropdown', crop0.nativeSelects === 0 && crop0.dropdowns > 0, `${crop0.dropdowns} dropdown(s)`);
    await choose(page, 0, '1 : 1');
    const square = await settle(page, (s) => s.size === '1200 × 1200');
    check('a square shape takes the largest square', square.size === '1200 × 1200', square.size);
    await shot(page, 'editor-crop');
    await setSlider(page, 'straighten', 8);
    const leaned = await settle(page, (s) => s.values.straighten === 8 && s.size !== '1200 × 1200');
    const side = Number((leaned.size || '').split(' ')[0]);
    check('straightening makes the crop as large as the turned photo allows', leaned.values.straighten === 8 && side > 900 && side < 1200 && leaned.size === `${side} × ${side}`, leaned.size);
    await shot(page, 'editor-straighten');
    await setSlider(page, 'straighten', 0);
    check('and back upright it is the full square again', (await settle(page, (s) => s.size === '1200 × 1200')).size === '1200 × 1200');
    // drag the frame's east handle inwards: the shape is held, so both sides shrink
    const handle = await rectOf(page, '.mo-edit-crophandle--e');
    if (handle) {
      await page.mouse.move(handle.x + handle.w / 2, handle.y + handle.h / 2);
      await page.mouse.down();
      await page.mouse.move(handle.x + handle.w / 2 - 80, handle.y + handle.h / 2, { steps: 6 });
      await page.mouse.up();
    }
    const dragged = await settle(page, (s) => s.size !== '1200 × 1200');
    const ds = (dragged.size || '').split(' × ').map(Number);
    check('dragging a handle resizes the crop and keeps its shape', !!handle && ds[0] < 1200 && ds[0] > 600 && ds[0] === ds[1], dragged.size);
    await click(page, 'Reset Crop And Rotate');
    await settle(page, (s) => s.size === '1800 × 1200');
    await click(page, 'Rotate Right');
    const turned = await settle(page, (s) => s.size === '1200 × 1800');
    check('Rotate Right turns the photo', turned.size === '1200 × 1800', turned.size);
    await click(page, 'Flip Horizontal');
    const flipped = await settle(page, (s) => apart(s.grid, turned.grid) > 0.4);
    check('Flip Horizontal mirrors it', apart(flipped.grid, turned.grid) > 0.4, `by ${apart(flipped.grid, turned.grid).toFixed(2)}`);
    await click(page, 'Reset Crop And Rotate');
    await settle(page, (s) => s.size === '1800 × 1200');

    // ── Save As Copy, with the tag carried and a turn in it ──
    await click(page, 'Rotate Left');
    await settle(page, (s) => s.size === '1200 × 1800');
    await click(page, 'Edit');
    await settle(page, (s) => s.tool === 'Edit' && s.frame === 'hidden');
    for (const title of ['Light', 'Colour']) await unfold(page, title);
    await setSlider(page, 'exposure', 0.5);
    await setSlider(page, 'warmth', 0.3);
    await settle(page, (s) => s.values.warmth === 0.3);
    await click(page, 'Save As Copy');
    const fractalCopy = path.join(photos, 'fractal-edit.jpg');
    const during = await settle(page, (s) => !!s.progress || existsSync(fractalCopy), 10_000);
    check('Save As Copy writes beside the original', await waitForFile(fractalCopy, 40_000), fractalCopy);
    const afterSave = await settle(page, (s) => !s.chip, 20_000);
    check('a plain save shows its bar, then leaves the editor in front', !!afterSave && afterSave.title === 'fractal.jpg' && (!during.progress || during.progress.bar), during.progress ? `${during.progress.label} ${during.progress.percent}%` : 'too quick to see');
    check('the copy is full size, turned', fileSize(fractalCopy) === '1200,1800', fileSize(fractalCopy));
    log('original untouched', `fractal.jpg ${(await fs.stat(path.join(photos, 'fractal.jpg'))).size} bytes, ${fileSize(path.join(photos, 'fractal.jpg'))}`);

    // ── what is seen is what is saved (flat colour bars: a shrink cannot blur them) ──
    await openEditor(page, PHOTO.bars, 'bars.jpg');
    for (const title of ['Light', 'Colour', 'Effects', 'Detail', 'Colour Mixer']) await unfold(page, title);
    await page.waitForTimeout(300);
    for (const [id, v] of Object.entries({ exposure: 0.4, shadows: 0.5, whites: -0.3, saturation: -0.4, vibrance: 0.5, tint: 0.2, clarity: 0.4, dehaze: 0.2, vignette: -0.5, sharpen: 0.6 })) await setSlider(page, id, v);
    await click(page, 'Blue', '.mo-edit-dots');
    await page.waitForTimeout(300);
    await setSlider(page, 'mix-0', 0.6);
    await settle(page, (s) => s.values['mix-0'] === 0.6);
    await page.waitForTimeout(1_500);
    const shown = await editorState(page);
    await shot(page, 'editor-edited');
    await click(page, 'Save As Copy');
    const barsCopy = path.join(photos, 'bars-edit.jpg');
    check('the second copy is written', await waitForFile(barsCopy, 40_000), barsCopy);
    await settle(page, (s) => !s.chip, 20_000);
    if (shown.grid && existsSync(barsCopy)) {
      const saved = meanDiff(shown.grid, fileGrid(barsCopy, GRID), GRID);
      const untouched = meanDiff(shown.grid, fileGrid(path.join(photos, 'bars.jpg'), GRID), GRID);
      check('the saved picture is the one shown', saved.mean >= 0 && saved.mean < 3.5, `mean difference ${saved.mean.toFixed(2)} of 255 over ${saved.cells} cells (shown at ${shown.box})`);
      check('and it is not the original', untouched.mean > 8, `original differs by ${untouched.mean.toFixed(2)}`);
    } else check('the saved picture is the one shown', false, 'nothing to compare');

    // ── reopen: the edit was kept ──
    await runCommand(page, 'workbench.action.closeActiveEditor');
    await page.waitForTimeout(800);
    const back = (await openEditor(page, PHOTO.bars, 'bars.jpg')).st;
    check('reopening shows the edit where it was left', !!back && back.values.exposure === 0.4 && back.values.shadows === 0.5 && back.values.saturation === -0.4 && back.values.tint === 0.2 && back.buttons.includes('reset=on'), back && JSON.stringify(back.values).slice(0, 200));

    }

    // ── Enhance ──
    if (hasUpscaler && want('enhance')) {
      await openEditor(page, PHOTO.bars, 'bars.jpg');
      await resetAll(page);
      await click(page, 'Enhance');
      const en = await settle(page, (s) => s.tool === 'Enhance' && s.dropdowns === 2, 20_000);
      check('Enhance offers a size and a model', en.dropdowns === 2, `${en.dropdowns} dropdown(s); ${en.hints.slice(0, 120)}`);
      await choose(page, 0, '2x Larger');
      const chosen = await settle(page, (s) => /becomes 3840 × 2160/.test(s.hints));
      check('it says what the copy will be', /1920 × 1080 becomes 3840 × 2160/.test(chosen.hints) && chosen.buttons.includes('save=on'), chosen.hints.slice(0, 160));
      await click(page, 'Save As Copy');
      const big = path.join(photos, 'bars-2x.png');
      const t0 = Date.now();
      // while it runs: a bar that says what is going on and moves
      const seen = []; let why = 'time ran out'; let pictured = false;
      while (Date.now() - t0 < 300_000) {
        const st = await editorState(page);
        if (!st) { why = 'the editor left the front'; break; }   // the enlarged copy's own tab has taken its place
        if (st.progress && st.progress.label === 'Enlarging' && st.progress.percent > 20 && !pictured) { pictured = true; await shot(page, 'editor-enlarging'); }
        if (st.progress) { const last = seen[seen.length - 1]; if (!last || last.label !== st.progress.label || last.percent !== st.progress.percent) seen.push(st.progress); }
        else if (seen.length) { why = 'the bar was taken down'; break; }
        await page.waitForTimeout(100);
      }
      log('the watch ended because', `${why}, after ${Math.round((Date.now() - t0) / 100) / 10} s`);
      const percents = seen.map((p) => p.percent);
      check('a progress bar says what is going on while it runs', seen.length >= 2 && seen.every((p) => p.bar && p.label) && seen.some((p) => p.label === 'Enlarging'), seen.map((p) => `${p.label} ${p.percent}%`).join(' > ').slice(0, 300));
      check('and it only ever moves forward', percents.every((v, i) => i === 0 || v >= percents[i - 1]) && Math.max(...percents) > 50, percents.join(', ').slice(0, 200));
      check('Save As Copy writes the enlarged copy', await waitForFile(big, 300_000), big);
      check('it is twice the size', fileSize(big) === '3840,2160', `${fileSize(big)}, ${Math.round((Date.now() - t0) / 1000)} s`);
      // when it finishes: the enlarged copy in a tab of its own, in front
      const tab = await page.waitForFunction(() => {
        const shown = Array.from(document.querySelectorAll('.mo-detail-editor')).some((d) => d.offsetParent !== null);
        const editor = Array.from(document.querySelectorAll('.mo-edit')).some((d) => d.offsetParent !== null);
        const active = Array.from(document.querySelectorAll('[role="tab"][aria-selected="true"], .editor-tab.active, .editor-tab.is-active')).map((t) => t.textContent.trim().replace(/×$/, '')).filter(Boolean);
        return shown && !editor ? (active.join(' | ') || 'shown') : false;
      }, null, { timeout: 30_000 }).then((h) => h.jsonValue()).catch(() => '');
      const tabs = await page.evaluate(() => Array.from(document.querySelectorAll('.editor-tab, [role="tab"]')).map((t) => t.textContent.trim().replace(/×$/, '')).filter(Boolean));
      check('the enlarged copy opens in its own tab, in front', !!tab && tabs.includes('bars-2x.png'), `in front: ${tab}; tabs: ${tabs.slice(0, 6).join(', ')}`);
      const strays = (await fs.readdir(photos)).filter((n) => /upscale-|\.x4\./.test(n));
      check('nothing temporary is left beside the photo', strays.length === 0, strays.join(', ') || 'none');
    }

    // ── Remove ──
    if (hasModel && want('remove')) {
      const marked = (await openEditor(page, PHOTO.marked, 'marked.jpg')).st;
      await click(page, 'Remove');
      const ready = await settle(page, (s) => s.tool === 'Remove' && s.panelButtons.includes('Undo Last Removal'), 20_000);
      check('Remove is ready: the model is on disk', ready.panelButtons.includes('Undo Last Removal'), ready.panelButtons || ready.hints);
      await setSlider(page, 'brush', 60);
      // where the mark is on screen: the photo is shown whole, centred in the stage
      const readGeom = () => page.evaluate(() => { const root = Array.from(document.querySelectorAll('.mo-edit')).find((r) => r.offsetParent !== null); const s = root.querySelector('.mo-edit-stage').getBoundingClientRect(); return { x: s.left, y: s.top, w: s.width, h: s.height, zoom: parseFloat(root.querySelector('.mo-edit-zoom').textContent) / 100, dpr: window.devicePixelRatio || 1 }; });
      // the zoom is written once the photo is laid out: a hidden window draws slowly, so it is waited for
      let geom = await readGeom();
      for (const start = Date.now(); Date.now() - start < 20_000 && !(geom.zoom > 0 && geom.w > 0); ) { await page.waitForTimeout(250); geom = await readGeom(); }
      console.log(`[probe] stage ${Math.round(geom.w)}x${Math.round(geom.h)} zoom ${geom.zoom}`);
      const k = geom.zoom / geom.dpr;                                    // screen pixels per photo pixel
      const at = (px, py) => [geom.x + geom.w / 2 + (px - 564 / 2) * k, geom.y + geom.h / 2 + (py - 846 / 2) * k];
      const [x0, y0] = at(MARK.x - 6, MARK.y + MARK.h / 2);
      const [x1] = at(MARK.x + MARK.w + 6, MARK.y + MARK.h / 2);
      await page.mouse.move(x0, y0);
      await page.mouse.down();
      await page.mouse.move(x1, y0, { steps: 12 });
      await page.mouse.up();
      const removed = await settle(page, (s) => s.panelTitles.includes('Removed (1)') && !s.chip && apart(s.grid, marked.grid) > 0.05, 90_000);
      check('brushing over the mark removes it', removed.panelTitles.includes('Removed (1)') && apart(removed.grid, marked.grid) > 0.05, `${removed.panelTitles}; picture changed by ${apart(removed.grid, marked.grid).toFixed(2)}`);
      await shot(page, 'editor-removed');
      await click(page, 'Save As Copy');
      const cleaned = path.join(photos, 'marked-edit.jpg');
      check('the copy without the mark is written', await waitForFile(cleaned, 40_000), cleaned);
      await settle(page, (s) => !s.chip, 20_000);
      if (existsSync(cleaned)) {
        const region = { x: MARK.x - 4, y: MARK.y - 4, w: MARK.w + 8, h: MARK.h + 8 };
        const truth = fileGrid(path.join(photos, 'boxing.jpg'), 24, region);
        const withMark = apart(fileGrid(path.join(photos, 'marked.jpg'), 24, region), truth);
        const repaired = apart(fileGrid(cleaned, 24, region), truth);
        check('where the mark was, the copy is close to the photo that never had one', repaired < withMark * 0.35 && repaired < 20, `the mark stood ${withMark.toFixed(1)} of 255 from the true photo; the repair stands ${repaired.toFixed(1)}`);
        const around = { x: 40, y: 60, w: 200, h: 200 };
        const drift = apart(fileGrid(cleaned, 24, around), fileGrid(path.join(photos, 'marked.jpg'), 24, around));
        check('and the rest of the photo is untouched', drift < 2, `${drift.toFixed(2)} of 255`);
      }
      await click(page, 'Undo Last Removal');
      const undoneMark = await settle(page, (s) => apart(s.grid, marked.grid) < 0.3 && s.panelTitles.includes('Removed') && !s.panelTitles.includes('Removed ('), 20_000);
      check('Undo Last Removal brings the mark back', apart(undoneMark.grid, marked.grid) < 0.3, `${apart(undoneMark.grid, marked.grid).toFixed(2)} from the marked photo`);
      await page.locator('.mo-edit-stage').first().hover({ position: { x: 20, y: 20 } });
      await page.keyboard.press('Control+z');
      const again = await settle(page, (s) => s.panelTitles.includes('Removed (1)') && apart(s.grid, marked.grid) > 0.05, 20_000);
      check('and undoing that removes it again', again.panelTitles.includes('Removed (1)') && apart(again.grid, marked.grid) > 0.05);
    }

    // ── Save: over the original ──
    if (want('saveover')) {
      const file = path.join(photos, 'fractal.jpg');
      const names = async () => (await fs.readdir(photos)).sort().join(', ');
      const modal = (text) => page.evaluate((text) => { const b = Array.from(document.querySelectorAll('.parallx-modal-box button')).find((x) => x.textContent.trim() === text); if (!b) return false; b.click(); return true; }, text);
      const asks = async () => { const seen = await page.waitForSelector('.parallx-modal-box', { timeout: 8_000 }).then(() => true).catch(() => false); return seen ? page.evaluate(() => document.querySelector('.parallx-modal-box').textContent) : ''; };
      // the checks before this one leave the editor on Remove: the sliders are the Edit tool's
      await openEditor(page, PHOTO.fractal, 'fractal.jpg');
      await click(page, 'Edit');
      const opened = await settle(page, (s) => s.tool === 'Edit' && s.values.exposure !== undefined, 10_000);
      if (opened && opened.buttons.includes('reset=on')) await resetAll(page);
      const rest = await settle(page, (s) => s.buttons.includes('save=off'), 8_000);
      check('with nothing changed there is nothing to save over', rest.saveOver === 'off', `${rest.saveOver}: ${rest.saveOverHint}`);
      for (const title of ['Light', 'Colour']) await unfold(page, title);
      await setSlider(page, 'exposure', 0.6);
      await setSlider(page, 'saturation', -0.6);
      await settle(page, (s) => s.values.saturation === -0.6 && s.saveOver === 'on');
      await page.waitForTimeout(1_500);
      const shown = await editorState(page);
      const before = { bytes: (await fs.stat(file)).size, grid: fileGrid(file, GRID), names: await names() };
      check('Save is offered beside Save As Copy', shown.saveOver === 'on' && shown.buttons.includes('save=on'), `${shown.saveOver}: ${shown.saveOverHint}`);

      await click(page, 'Save');
      const question = await asks();
      check('Save asks before it replaces the original', /Save over fractal\.jpg\?/.test(question) && /cannot be brought back/.test(question) && /Save Over Original/.test(question), question.slice(0, 200));
      await modal('Cancel');
      await page.waitForTimeout(1_500);
      check('Cancel leaves the file as it was', (await fs.stat(file)).size === before.bytes && apart(fileGrid(file, GRID), before.grid) === 0 && (await names()) === before.names, await names());

      await page.locator('.mo-edit-stage').first().hover({ position: { x: 20, y: 20 } });
      await page.keyboard.press('Control+s');
      const again = await asks();
      check('Ctrl+S asks the same', /Save over fractal\.jpg\?/.test(again), again.slice(0, 80));
      await modal('Save Over Original');
      let changed = false;
      for (const start = Date.now(); Date.now() - start < 40_000 && !changed;) { await page.waitForTimeout(250); changed = apart(fileGrid(file, GRID), before.grid) > 1; }
      check('the original holds the edited picture', changed, `${before.bytes} bytes before, ${(await fs.stat(file)).size} after`);
      // while the saved file is being read back every button is off and the panel is empty: wait for the sliders
      const after = await settle(page, (s) => !s.chip && s.title === 'fractal.jpg' && s.brightness >= 0 && s.buttons.includes('reset=off') && s.saveOver === 'off' && !s.message && s.values.exposure !== undefined, 30_000);
      check('the editor opens the saved file with no edit left on it', !!after && after.title === 'fractal.jpg' && after.buttons.includes('reset=off') && after.buttons.includes('undo=off') && after.values.exposure === 0, after && `${after.buttons}; exposure ${after.values.exposure}`);
      if (shown.grid) {
        const saved = meanDiff(shown.grid, fileGrid(file, GRID), GRID);
        check('the saved picture is the one that was shown', saved.mean >= 0 && saved.mean < 3.5, `mean difference ${saved.mean.toFixed(2)} of 255 over ${saved.cells} cells`);
        // a hidden window draws slowly: the reading is taken once the picture holds still
        const onDisk = fileGrid(file, GRID);
        const near = (s) => (s && s.grid ? meanDiff(s.grid, onDisk, GRID).mean : -1);
        const drawn = await settle(page, (s) => s.title === 'fractal.jpg' && near(s) >= 0 && near(s) < 3.5, 20_000);
        check('and the editor shows it once, not the edit on top of itself', near(drawn) >= 0 && near(drawn) < 3.5, `mean difference ${near(drawn).toFixed(2)} of 255, after ${drawn && drawn.took} ms`);
      }
      check('it is the same size, a JPEG still', fileSize(file) === '1800,1200', fileSize(file));
      check('no copy and no leftover file beside it', (await names()) === before.names, await names());

      // enlarged and saved over: the upscaler writes a PNG, the original is a JPEG and stays one
      if (hasUpscaler) {
        const bars = path.join(photos, 'bars.jpg');
        const kind = (f) => String(spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', f], { encoding: 'utf8', windowsHide: true }).stdout || '').trim();
        const was = { names: await names(), grid: fileGrid(bars, GRID) };
        const st0 = (await openEditor(page, PHOTO.bars, 'bars.jpg')).st;
        if (st0 && st0.buttons.includes('reset=on')) await resetAll(page);
        await click(page, 'Enhance');
        await settle(page, (s) => s.tool === 'Enhance' && s.dropdowns === 2, 20_000);
        await choose(page, 0, '2x Larger');
        const chosen = await settle(page, (s) => /becomes 3840 × 2160/.test(s.hints) && s.saveOver === 'on');
        check('Save is offered for an enlargement too', !!chosen && chosen.saveOver === 'on', chosen && chosen.saveOverHint);
        await click(page, 'Save');
        await asks();
        await modal('Save Over Original');
        let size = '';
        for (const start = Date.now(); Date.now() - start < 300_000 && size !== '3840,2160';) { await page.waitForTimeout(500); size = fileSize(bars); }
        check('the original holds the picture twice the size, a JPEG still', size === '3840,2160' && kind(bars) === 'mjpeg', `${size} ${kind(bars)}`);
        // the upscaler redraws the picture, so it is near the original and not equal to it; another photo stands far off
        const same = meanDiff(was.grid, fileGrid(bars, GRID), GRID).mean; const other = meanDiff(fileGrid(path.join(photos, 'card.jpg'), GRID), fileGrid(bars, GRID), GRID).mean;
        check('and it is the same picture, enlarged', same >= 0 && same < 12 && other > same * 3, `${same.toFixed(2)} of 255 from what it held; ${other.toFixed(2)} from another photo`);
        const big = await settle(page, (s) => !s.chip && s.title === 'bars.jpg' && s.size === '3840 × 2160' && s.saveOver === 'off' && !s.message, 60_000);
        check('the editor opens it at its new size with nothing left to save', !!big && big.size === '3840 × 2160' && big.saveOver === 'off' && big.buttons.includes('save=off'), big && `${big.size}; ${big.buttons}`);
        check('no copy and no leftover file beside it', (await names()) === was.names, await names());
      }
    }

    // ── the ways in: a card's right-click menu and the photo's own tab ──
    if (want('entry')) {
    await runCommand(page, 'workbench.action.closeActiveEditor');
    await page.waitForTimeout(600);
    await runCommand(page, 'media-organizer.openGrid');
    const gotCards = await page.waitForSelector('.mo-card, .mo-feed-card', { timeout: 20_000 }).then(() => true).catch(() => false);
    check('the library shows cards', gotCards);
      const names = await page.evaluate(() => Array.from(document.querySelectorAll('.mo-card-title')).map((t) => t.textContent));
      check('no temporary file is in the library', !names.some((n) => /upscale-|\.x4/.test(n)), names.join(', '));
      if (hasModel && want('remove')) {
        // the copy carries the original's title, so the two cards read the same
        const shown = await page.evaluate(() => Array.from(document.querySelectorAll('.mo-card-title, .mo-feed-cap-title')).map((t) => t.textContent));
        check('a saved copy is a card of its own beside its original', shown.filter((n) => n === 'marked').length >= 2, shown.join(', '));
      }
    await page.waitForTimeout(800);
    if (gotCards) {
      const card1 = page.locator('.mo-card, .mo-feed-card').first();
      await card1.click({ button: 'right' });
      await page.waitForSelector('.context-menu', { timeout: 5_000 }).catch(() => {});
      const items = await page.evaluate(() => Array.from(document.querySelectorAll('.context-menu [role="menuitem"], .context-menu .context-menu-item')).map((i) => i.textContent.trim()).filter(Boolean));
      check('the right-click menu offers Edit Image' + (want('edit') ? ' and Paste Edit' : ''), items.includes('Edit Image') && (!want('edit') || items.includes('Paste Edit')), items.slice(0, 7).join(' | '));
      await page.locator('.context-menu').getByText('Edit Image', { exact: true }).first().click().catch(() => {});
      const viaMenu = await settle(page, (st) => !!st.title && st.brightness >= 0, 20_000);
      check('and it opens the editor', !!viaMenu && !!viaMenu.title && viaMenu.brightness >= 0, viaMenu && viaMenu.title);
      await runCommand(page, 'workbench.action.closeActiveEditor');
      await page.waitForTimeout(600);
      await runCommand(page, 'media-organizer.openGrid');
      await page.locator('.mo-card:visible, .mo-feed-card:visible').first().waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {});
      await page.waitForTimeout(600);
      await page.locator('.mo-card:visible, .mo-feed-card:visible').first().dblclick().catch(() => {});
      const visibleHeader = () => page.evaluate(() => { const d = Array.from(document.querySelectorAll('.mo-detail-editor')).find((x) => x.offsetParent !== null); return d ? Array.from(d.querySelectorAll('.mo-detail-header-actions button')).map((x) => x.getAttribute('title')).join(' | ') : ''; });
      let header = '';
      for (const start = Date.now(); Date.now() - start < 15_000 && !header;) { header = await visibleHeader(); if (!header) await page.waitForTimeout(200); }
      check('the photo tab offers Edit Image, and Upscale has moved into the editor', header.includes('Edit Image') && !header.includes('Upscale'), header);
      await page.evaluate(() => { const d = Array.from(document.querySelectorAll('.mo-detail-editor')).find((x) => x.offsetParent !== null); const b = d && d.querySelector('.mo-detail-header-actions button[title="Edit Image"]'); if (b) b.click(); });
      const viaHeader = await settle(page, (st) => !!st.title && st.brightness >= 0, 20_000);
      check('and it opens the editor too', !!viaHeader && !!viaHeader.title && viaHeader.brightness >= 0, viaHeader && viaHeader.title);
      await shot(page, 'editor-final');
    }
    }
  } finally {
    if (errors.length) {
      console.log(`[probe] ${errors.length} renderer error(s):`);
      for (const e of errors) console.log(`  ${e}`);
      failures += 1;
    } else {
      console.log('[probe] no renderer errors');
    }
    await app.close().catch(() => {});
    for (const db of dbPaths(workspace)) {
      const r = spawnSync(ELECTRON, [VERIFY, db], { env: nodeEnv(), encoding: 'utf8', windowsHide: true });
      console.log(`[probe] db ${path.basename(path.dirname(db))}: ${(r.stdout || r.stderr || '').trim()}`);
      // the library the app wrote to is the extension's own; the other is seeded for an install under the community id
      if (want('saveover') && path.basename(path.dirname(db)) === 'media-organizer' && /record of fractal\.jpg/.test(r.stdout || '')) {
        const line = String(r.stdout).split(/\r?\n/).find((l) => /record of fractal\.jpg/.test(l)) || '';
        check('the library kept the photo and knows its new file', /photo 3 /.test(line) && /in step with the file/.test(line) && /tags=\[PATTERNS\]/.test(line) && /no edit stored/.test(line) && /thumbnail for the new picture/.test(line), line.trim());
      }
    }
    await fs.rm(appRoot, { recursive: true, force: true }).catch(() => {});
    await fs.rm(workspace, { recursive: true, force: true }).catch(() => {});
    console.log(`[probe] ${failures ? failures + ' check(s) FAILED' : 'every check passed'}`);
  }
}

main().catch((err) => { console.error('[probe] failed:', err); process.exit(1); });
