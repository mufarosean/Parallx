// bulk-remove-probe.mjs: Remove From Other Photos (docs/IMAGE_EDITOR.md) in the
// real app, never on screen.
//
// Makes a set of photos with the same logo stamped on them at different places
// and sizes (one has it twice, one has a second, different mark, one has it
// see-through, some have none), seeds a throwaway workspace with them, launches
// the app HIDDEN (PARALLX_HIDDEN_PROBE), and:
//   example   brushes over the logo and the tag on one photo in the editor
//   open      Remove From Other Photos: the marks looked for, the photos to choose from
//   choose    only the photos ticked are looked in: a click, a shift-click for a run, Select All
//   library   Remove Marks From Selected: the photos selected in the library, ticked
//   find      Find Marks: every stamped mark is found where it was put, nothing else is
//   decide    a find is left out and taken back in; Mark Only and Whole Brushed Area show their shapes
//   remove    Remove And Save Copies, Mark Only: a copy beside each original, the mark gone from
//             it, what lay beside the letters as it was, the original untouched
//   whole     one photo kept back and removed as Whole Brushed Area
//   again     looking again finds nothing left
//
// Needs the Remove model on disk: PARALLX_MODELS_DIR, or <repo>/data/models.
// PROBE_PHOTOS=<folder> adds real photos (jpg, webp) as backgrounds.
// PROBE_LONG=<pixels> makes the set's photos that long (1600 when not given), and PROBE_MARK=<n> the
// marks n times their size on the 1600-pixel photos (when not given they grow with the photos).
// PROBE_LONG=4800 PROBE_MARK=1 is a small mark on a large photo: the case that gave 75 finds a photo.
//
// Usage: node tests/probes/bulk-remove-probe.mjs <outDir>
import { _electron as electron } from 'playwright';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync, readdirSync, statSync } from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const outDir = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'parallx-bulk-remove-shots'));
const ELECTRON = path.join(PROJECT_ROOT, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const SEED = path.join(__dirname, 'tag-review-seed.cjs');
const BOXING = path.join(PROJECT_ROOT, 'data', 'dashboard-assets', 'aa21bc3e-d260-41ac-8bcf-ab5efe10d0cb.jpg');
const MODELS = process.env.PARALLX_MODELS_DIR || path.join(PROJECT_ROOT, 'data', 'models');
const MODEL = '1faef5301d78db7dda502fe59966957ec4b79dd64e16f03ed96913c7a4eb68d6.onnx';
const W = Math.round(Number(process.env.PROBE_LONG) || 1600); const H = Math.round((W * 1067) / 1600);
const K = W / 1600;                                        // places are given for a photo 1600 wide
const MS = Number(process.env.PROBE_MARK) || K;            // and so are the marks' sizes
let APP = null;
let failures = 0;

function nodeEnv() { return { ...process.env, ELECTRON_RUN_AS_NODE: '1' }; }
function launchEnv(appRoot) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE') env[k] = v;
  Object.assign(env, { PARALLX_TEST_MODE: '1', PARALLX_RENDERER_PORT: '0', PARALLX_HIDDEN_PROBE: '1', PARALLX_APP_ROOT: appRoot, PARALLX_USER_DATA: path.join(appRoot, 'data', 'chromium-cache'), PARALLX_MODELS_DIR: MODELS });
  return env;
}
const dbPaths = (ws) => ['media-organizer', 'parallx-community.media-organizer'].map((id) => path.join(ws, '.parallx', 'extensions', id, 'data.db'));
const ffmpeg = (args) => { const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { windowsHide: true, maxBuffer: 64 * 1024 * 1024 }); if (r.status !== 0) throw new Error(`ffmpeg: ${String(r.stderr).slice(0, 400)}`); return r.stdout; };
const log = (label, value) => console.log(`[probe] ${label}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
function check(label, ok, detail) {
  if (!ok) failures++;
  console.log(`[probe] ${ok ? 'PASS' : 'FAIL'} ${label}${detail !== undefined && detail !== null ? ': ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`);
}
const apart = (a, b) => { if (!a || !b || a.length !== b.length) return -1; let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };
function fileGrid(file, size, crop) {
  const vf = (crop ? `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y},` : '') + `scale=${size}:${size}:flags=area`;
  return Array.from(ffmpeg(['-i', file, '-vf', vf, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']));
}

// How many pixels of a place are the mark's own colour (within 40 of it on every channel).
function markPixels(file, region, colour) {
  const raw = ffmpeg(['-i', file, '-vf', `crop=${region.w}:${region.h}:${region.x}:${region.y}`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  let n = 0;
  for (let i = 0; i + 2 < raw.length; i += 3) if (Math.abs(raw[i] - colour[0]) < 40 && Math.abs(raw[i + 1] - colour[1]) < 40 && Math.abs(raw[i + 2] - colour[2]) < 40) n++;
  return n;
}
const COLOUR = { logo: [255, 255, 255], tag: [255, 208, 96] };

// ── the photos ──
const LOGO = { w: 420, h: 120 }; const TAG = { w: 300, h: 70 };
function makeMarks(dir) {
  const font = 'C:/Windows/Fonts/arialbd.ttf'; const italic = 'C:/Windows/Fonts/georgiai.ttf';
  const esc = (f) => f.replace(':', '\\:');
  const logo = path.join(dir, 'logo.png'); const tag = path.join(dir, 'tag.png');
  const blank = (s) => ['-f', 'lavfi', '-i', `color=c=black@0.0:s=${s.w}x${s.h},format=rgba`];
  if (existsSync(font)) ffmpeg([...blank(LOGO), '-vf', `drawtext=fontfile='${esc(font)}':text='NORTHLIGHT':fontcolor=white:fontsize=58:x=(w-text_w)/2:y=(h-text_h)/2,drawbox=x=3:y=3:w=414:h=114:color=white@1.0:t=5`, '-frames:v', '1', logo]);
  else ffmpeg([...blank(LOGO), '-vf', 'drawbox=x=3:y=3:w=414:h=114:color=white@1.0:t=5,drawbox=x=40:y=30:w=60:h=60:color=white@1.0:t=12,drawbox=x=140:y=30:w=240:h=14:color=white@1.0:t=fill,drawbox=x=140:y=70:w=160:h=14:color=white@1.0:t=fill', '-frames:v', '1', logo]);
  if (existsSync(italic)) ffmpeg([...blank(TAG), '-vf', `drawtext=fontfile='${esc(italic)}':text='(c) j.moyo':fontcolor=0xffd060:fontsize=52:x=(w-text_w)/2:y=(h-text_h)/2`, '-frames:v', '1', tag]);
  else ffmpeg([...blank(TAG), '-vf', 'drawbox=x=10:y=10:w=50:h=50:color=0xffd060@1.0:t=8,drawbox=x=80:y=20:w=200:h=10:color=0xffd060@1.0:t=fill,drawbox=x=80:y=44:w=120:h=10:color=0xffd060@1.0:t=fill', '-frames:v', '1', tag]);
  return { logo, tag };
}
function backgrounds(dir) {
  const out = [];
  const add = (name, args) => { const file = path.join(dir, `bg-${name}.jpg`); ffmpeg([...args, '-frames:v', '1', '-q:v', '2', file]); out.push(file); };
  const real = process.env.PROBE_PHOTOS;
  if (real && existsSync(real)) {
    const files = readdirSync(real).filter((n) => /\.(jpe?g|webp)$/i.test(n)).map((n) => path.join(real, n));
    const crops = ['crop=iw/2:ih/2:0:0', 'crop=iw/2:ih/2:iw/2:ih/2', 'crop=iw/3:ih/3:iw/3:ih/3', 'crop=iw*0.4:ih*0.4:iw*0.1:ih*0.55', 'null'];
    let n = 0;
    // the colour profile is taken off: the app brings every photo into sRGB, and the checks below compare plain numbers
    for (const f of files) for (const c of crops) add(`real-${++n}`, ['-i', f, '-map_metadata', '-1', '-vf', `${c},scale=${W}:${H},sidedata=mode=delete`]);
  }
  add('ring', ['-i', BOXING, '-vf', `crop=500:333:30:60,scale=${W}:${H}:flags=lanczos`]);
  add('floor', ['-i', BOXING, '-vf', `crop=500:333:40:480,scale=${W}:${H}:flags=lanczos`]);
  add('fractal', ['-f', 'lavfi', '-i', `mandelbrot=size=${W}x${H}:start_scale=1.2`]);
  add('fractal-2', ['-f', 'lavfi', '-i', `mandelbrot=size=${W}x${H}:start_scale=0.3:start_x=-0.74:start_y=0.13`]);
  add('card', ['-f', 'lavfi', '-i', `testsrc2=size=${W}x${H}`]);
  add('sky', ['-f', 'lavfi', '-i', `gradients=size=${W}x${H}:c0=0x2a4a7a:c1=0xc8a070:x0=0:y0=0:x1=0:y1=${H}`]);
  add('dusk', ['-f', 'lavfi', '-i', `gradients=size=${W}x${H}:c0=0x302040:c1=0x905030:x0=0:y0=0:x1=${W}:y1=${H}`]);
  add('ring-wide', ['-i', BOXING, '-vf', `crop=564:376:0:200,scale=${W}:${H}:flags=lanczos`]);
  return out;
}
// A photo: a background with marks laid on. -> { name, file, clean, marks: [{ kind, x, y, w, h }] }
function compose(dir, cleanDir, name, bg, marks) {
  const file = path.join(dir, name); const clean = path.join(cleanDir, name);
  ffmpeg(['-i', bg, '-frames:v', '1', '-q:v', '3', clean]);
  if (!marks.length) { ffmpeg(['-i', bg, '-frames:v', '1', '-q:v', '3', file]); return { name, file, clean, marks: [] }; }
  const inputs = ['-i', bg]; const chain = []; const truth = []; let last = '0';
  marks.forEach((m, i) => {
    inputs.push('-i', m.art);
    const w = Math.round(m.size.w * m.scale); const h = Math.round(m.size.h * m.scale);
    chain.push(`[${i + 1}]scale=${w}:${h},format=rgba,colorchannelmixer=aa=${m.alpha ?? 1}[l${i}]`, `[${last}][l${i}]overlay=${m.x}:${m.y}[o${i}]`);
    last = `o${i}`;
    truth.push({ kind: m.kind, x: m.x, y: m.y, w, h, solid: (m.alpha ?? 1) === 1 });
  });
  ffmpeg([...inputs, '-filter_complex', chain.join(';'), '-map', `[${last}]`, '-frames:v', '1', '-q:v', '3', file]);
  return { name, file, clean, marks: truth };
}

async function makeRoots() {
  const stamp = Date.now();
  const appRoot = path.join(os.tmpdir(), `parallx-bulk-root-${stamp}`);
  const workspace = path.join(os.tmpdir(), `parallx-bulk-ws-${stamp}`);
  const photos = path.join(workspace, 'photos');
  const made = path.join(appRoot, 'made'); const cleanDir = path.join(appRoot, 'clean');
  for (const d of [path.join(appRoot, 'data'), photos, made, cleanDir]) await fs.mkdir(d, { recursive: true });
  await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: workspace }));
  await fs.symlink(path.join(PROJECT_ROOT, 'ext'), path.join(appRoot, 'ext'), 'junction');
  // the seed's own four, which the set's folder also holds: photos with no mark on them
  await fs.copyFile(BOXING, path.join(photos, 'boxing.jpg'));
  const gen = [['card.jpg', 'testsrc2=size=2400x1600', 2400, 1600], ['fractal.jpg', 'mandelbrot=size=1800x1200', 1800, 1200], ['bars.jpg', 'smptehdbars=size=1920x1080', 1920, 1080]];
  for (const [name, src] of gen) ffmpeg(['-f', 'lavfi', '-i', src, '-frames:v', '1', '-q:v', '3', path.join(photos, name)]);
  const art = makeMarks(made);
  const bg = backgrounds(made);
  const pick = (i) => bg[i % bg.length];
  // a mark's place is where its middle was on the 1600-pixel photo, so a smaller mark stays on the photo
  const put = (size, x, y, scale) => ({ x: Math.max(0, Math.min(W - Math.round(size.w * scale * MS), Math.round((x + (size.w * scale) / 2) * K - (size.w * scale * MS) / 2))), y: Math.max(0, Math.min(H - Math.round(size.h * scale * MS), Math.round((y + (size.h * scale) / 2) * K - (size.h * scale * MS) / 2))) });
  const logo = (x, y, scale, alpha) => ({ kind: 'logo', art: art.logo, size: LOGO, ...put(LOGO, x, y, scale), scale: scale * MS, alpha });
  const tag = (x, y, scale) => ({ kind: 'tag', art: art.tag, size: TAG, ...put(TAG, x, y, scale), scale: scale * MS });
  const set = [
    compose(photos, cleanDir, 'set-01-example.jpg', pick(0), [logo(1150, 900, 0.85), tag(60, 50, 0.9)]),
    compose(photos, cleanDir, 'set-02-same-place.jpg', pick(1), [logo(1150, 900, 0.85)]),
    compose(photos, cleanDir, 'set-03-other-corner.jpg', pick(2), [logo(40, 60, 0.85)]),
    compose(photos, cleanDir, 'set-04-smaller.jpg', pick(3), [logo(700, 480, 0.55)]),
    compose(photos, cleanDir, 'set-05-larger.jpg', pick(4), [logo(300, 700, 1.4)]),
    compose(photos, cleanDir, 'set-06-two-of-it.jpg', pick(5), [logo(100, 100, 0.85), logo(1100, 850, 0.7)]),
    compose(photos, cleanDir, 'set-07-both-marks.jpg', pick(6), [logo(1180, 40, 0.8), tag(1250, 980, 0.9)]),
    compose(photos, cleanDir, 'set-08-see-through.jpg', pick(7), [logo(600, 300, 0.85, 0.45)]),
    compose(photos, cleanDir, 'set-09-no-mark.jpg', pick(8), []),
    compose(photos, cleanDir, 'set-10-no-mark.jpg', pick(9), []),
  ];
  const spec = [{ basename: 'boxing.jpg', width: 564, height: 846 }, ...gen.map(([basename, , width, height]) => ({ basename, width, height })), ...set.map((p) => ({ basename: p.name, width: W, height: H }))];
  const specPath = path.join(appRoot, 'spec.json');
  await fs.writeFile(specPath, JSON.stringify(spec));
  for (const db of dbPaths(workspace)) {
    const r = spawnSync(ELECTRON, [SEED, 'seed', db, photos, specPath], { env: nodeEnv(), encoding: 'utf8', windowsHide: true });
    if (r.status !== 0) throw new Error(`seed failed: ${r.stderr || r.stdout}`);
  }
  return { appRoot, workspace, photos, set, exampleId: 5, backgrounds: bg.length };
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
  try { await page.screenshot({ path: file, timeout: 8_000 }); } catch {
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

const editorState = (page) => page.evaluate(() => {
  const root = Array.from(document.querySelectorAll('.mo-edit')).find((r) => r.offsetParent !== null);
  if (!root) return null;
  const chip = root.querySelector('.mo-edit-chip');
  const message = root.querySelector('.mo-edit-message');
  const s = root.querySelector('.mo-edit-stage').getBoundingClientRect();
  return {
    title: root.querySelector('.mo-edit-title')?.textContent,
    tool: root.querySelector('.mo-edit-tool.is-on')?.getAttribute('aria-label'),
    chip: !chip || chip.classList.contains('mo-hidden') ? '' : (chip.textContent || ''),
    message: !message || message.classList.contains('mo-hidden') ? '' : (message.textContent || ''),
    panelButtons: Array.from(root.querySelectorAll('.mo-edit-panel-body button')).map((b) => `${b.textContent.trim()}${b.disabled ? ' (off)' : ''}`).filter(Boolean).join('/'),
    panelTitles: Array.from(root.querySelectorAll('.mo-edit-panel-body .mo-edit-section-title')).map((t) => t.textContent).join('/'),
    sliders: root.querySelectorAll('.mo-edit-panel input[type="range"]').length,
    stage: { x: s.left, y: s.top, w: s.width, h: s.height, zoom: parseFloat(root.querySelector('.mo-edit-zoom').textContent) / 100, dpr: window.devicePixelRatio || 1 },
  };
});
const bulkState = (page) => page.evaluate(() => {
  const root = Array.from(document.querySelectorAll('.mo-br-page')).find((r) => r.offsetParent !== null);
  if (!root) return null;
  const btn = (t) => Array.from(root.querySelectorAll('.mo-tr-actions-bar button')).find((b) => b.textContent.trim().startsWith(t));
  const state = (b) => (!b ? 'missing' : b.disabled ? 'off' : 'on');
  return {
    title: root.querySelector('.mo-tr-title').textContent,
    sub: root.querySelector('.mo-tr-sub').textContent,
    scope: (root.querySelector('.mo-dd .ui-dropdown__button')?.textContent || '').trim(),
    what: (root.querySelectorAll('.mo-dd .ui-dropdown__button')[1]?.textContent || '').trim(),
    save: (root.querySelectorAll('.mo-dd .ui-dropdown__button')[2]?.textContent || '').trim(),
    marks: Array.from(root.querySelectorAll('.mo-br-mark')).map((m) => ({ on: m.querySelector('input').checked, plain: m.classList.contains('is-plain'), picture: m.querySelector('img').naturalWidth, shape: (m.querySelector('.mo-br-shape')?.style.maskImage || '').length, says: Array.from(m.querySelectorAll('span:not(.mo-br-mark-pic):not(.mo-br-shape)')).map((x) => x.textContent).join(' ') })),
    find: state(btn('Find Marks')), findText: (btn('Find Marks')?.textContent || '').trim(), stop: state(btn('Stop')), remove: state(btn('Remove And Save')), removeText: (btn('Remove And Save')?.textContent || '').trim(),
    picked: root.querySelector('.mo-br-picked')?.textContent || '',
    filters: Array.from(root.querySelectorAll('.mo-br-filters button')).map((b) => b.textContent.trim()),
    bar: root.querySelector('.mo-tr-progress').style.visibility, percent: Number(root.querySelector('.mo-tr-progress').getAttribute('aria-valuenow') || 0),
    tiles: Array.from(root.querySelectorAll('.mo-br-tile')).map((t) => ({
      name: t.querySelector('.mo-br-name').textContent, status: t.querySelector('.mo-br-status').textContent, note: t.querySelector('.mo-br-status').title,
      checked: t.querySelector('.mo-br-pick input').checked, hidden: t.hidden, picture: t.querySelector('.mo-br-pic img').naturalWidth > 0,
      finds: Array.from(t.querySelectorAll('.mo-br-find')).map((f) => ({ x: parseFloat(f.style.left), y: parseFloat(f.style.top), w: parseFloat(f.style.width), h: parseFloat(f.style.height), unsure: f.classList.contains('is-unsure'), on: !f.classList.contains('is-off'), mark: Number(f.dataset.mark), score: Number(f.dataset.score), points: Number(f.dataset.points), size: Number(f.dataset.size), settled: Number(f.dataset.settled), shape: (f.querySelector('.mo-br-shape')?.style.maskImage || '').length })),
    })),
    natives: root.querySelectorAll('select').length,
    empty: root.querySelector('.mo-tr-empty').hidden ? '' : root.querySelector('.mo-tr-empty').textContent,
  };
});
async function until(read, test, ms) {
  const start = Date.now();
  let st = await read();
  while (!(st && test(st)) && Date.now() - start < ms) { await new Promise((r) => setTimeout(r, 150)); st = await read(); }
  if (st) st.took = Date.now() - start;
  return st;
}
const clickIn = (page, root, text) => page.evaluate(({ root, text }) => {
  const r = Array.from(document.querySelectorAll(root)).find((x) => x.offsetParent !== null);
  const b = r && Array.from(r.querySelectorAll('button')).find((x) => x.textContent.trim().startsWith(text) || x.getAttribute('aria-label') === text);
  if (!b || b.disabled) return false;
  b.click();
  return true;
}, { root, text });
const setBrush = (page, value) => page.evaluate((value) => {
  const root = Array.from(document.querySelectorAll('.mo-edit')).find((r) => r.offsetParent !== null);
  const el = Array.from(root.querySelectorAll('.mo-edit-panel input[type="range"]')).find((i) => i.dataset.slider === 'brush');
  if (!el) return false;
  el.value = String(value);
  el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}, value);

// The page's dropdowns, in order: Photos To Look In, What To Remove, How To Save.
const chooseWhat = (page, label) => chooseFrom(page, 1, label);
const chooseSave = (page, label) => chooseFrom(page, 2, label);
async function chooseFrom(page, nth, label) {
  const button = page.locator('.mo-br-page .mo-dd .ui-dropdown__button').nth(nth);
  await button.click();
  const item = page.locator('.ui-dropdown__list .ui-dropdown__item').filter({ hasText: label }).first();
  await item.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {});
  if (!(await item.count())) return false;
  await item.click();
  return true;
}
// A click on a photo's picture, as the hand does it (shift held for a run of photos).
const clickPhoto = (page, name, shift) => page.evaluate(({ name, shift }) => {
  const root = Array.from(document.querySelectorAll('.mo-br-page')).find((r) => r.offsetParent !== null);
  const tile = Array.from(root.querySelectorAll('.mo-br-tile')).find((t) => t.querySelector('.mo-br-name').textContent === name);
  const pic = tile && tile.querySelector('.mo-br-pic');
  if (!pic) return false;
  pic.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: !!shift }));
  return true;
}, { name, shift });
const tick = (page, name, on) => page.evaluate(({ name, on }) => {
  const root = Array.from(document.querySelectorAll('.mo-br-page')).find((r) => r.offsetParent !== null);
  const tile = Array.from(root.querySelectorAll('.mo-br-tile')).find((t) => t.querySelector('.mo-br-name').textContent === name);
  const box = tile && tile.querySelector('.mo-br-pick input');
  if (!box || box.disabled) return false;
  if (box.checked !== on) box.click();
  return true;
}, { name, on });
const rawOf = (file, r) => ffmpeg(['-i', file, '-vf', `crop=${r.w}:${r.h}:${r.x}:${r.y}`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
/**
 * What happened beside a mark. In the mark's own box: which pixels are the mark (they differ from the
 * photo that never had it) and which are more than `keep` pixels from any of those. Of the latter,
 * what share the copy changed (by more than 12 of 255 on a channel), and by how much on average.
 */
function beside(copy, original, clean, r, keep) {
  const c = rawOf(copy, r); const o = rawOf(original, r); const t = rawOf(clean, r);
  const n = r.w * r.h;
  const mark = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (Math.abs(o[i * 3] - t[i * 3]) > 24 || Math.abs(o[i * 3 + 1] - t[i * 3 + 1]) > 24 || Math.abs(o[i * 3 + 2] - t[i * 3 + 2]) > 24) mark[i] = 1;
  let far = 0; let changed = 0; let sum = 0;
  for (let y = 0; y < r.h; y++) {
    for (let x = 0; x < r.w; x++) {
      let near = false;
      for (let dy = -keep; dy <= keep && !near; dy += 2) for (let dx = -keep; dx <= keep; dx += 2) { const xx = x + dx; const yy = y + dy; if (xx >= 0 && yy >= 0 && xx < r.w && yy < r.h && mark[yy * r.w + xx]) { near = true; break; } }
      if (near) continue;
      far++;
      const i = (y * r.w + x) * 3;
      const d = Math.max(Math.abs(c[i] - o[i]), Math.abs(c[i + 1] - o[i + 1]), Math.abs(c[i + 2] - o[i + 2]));
      sum += d;
      if (d > 12) changed++;
    }
  }
  return { far, share: far ? changed / far : 0, mean: far ? sum / far : 0 };
}

// Is this find the mark that was put there? Its middle on the mark's, and the mark inside it.
function isMark(f, m) {
  const x = (f.x / 100) * W; const y = (f.y / 100) * H; const w = (f.w / 100) * W; const h = (f.h / 100) * H;
  const mid = Math.abs(x + w / 2 - (m.x + m.w / 2)) < m.w * 0.1 + 4 && Math.abs(y + h / 2 - (m.y + m.h / 2)) < m.h * 0.2 + 4;
  const holds = x <= m.x + m.w * 0.04 && y <= m.y + m.h * 0.1 && x + w >= m.x + m.w * 0.96 && y + h >= m.y + m.h * 0.9;
  return mid && holds && w < m.w * 1.6 && h < m.h * 2.6;
}

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  if (!existsSync(path.join(MODELS, MODEL))) { console.log(`[probe] the Remove model is not on disk (${MODELS}): nothing to check`); process.exit(2); }
  const { appRoot, workspace, photos, set, exampleId, backgrounds: nbg } = await makeRoots();
  console.log(`[probe] app root ${appRoot}\n[probe] workspace ${workspace}\n[probe] ${set.length} photos in the set over ${nbg} backgrounds, ${set.reduce((n, p) => n + p.marks.length, 0)} marks stamped`);
  const sizes = new Map(set.map((p) => [p.name, statSync(p.file).size]));
  const app = await electron.launch({ args: ['.'], cwd: PROJECT_ROOT, env: launchEnv(appRoot) });
  APP = app;
  const errors = [];
  try {
    const page = await app.firstWindow();
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 300)}`); });
    const said = [];
    page.on('console', (m) => { if (/Remove From Other Photos|the finder/.test(m.text())) { said.push(m.text()); console.log(`[probe] app says: ${m.text()}`); } });
    await page.setViewportSize({ width: 1500, height: 950 }).catch(() => {});
    await page.waitForSelector('[data-part-id="workbench.parts.titlebar"]', { state: 'attached', timeout: 90_000 });
    await page.waitForTimeout(3_000);
    await page.evaluate(async () => { await window.__parallx_workbench__._services.get({ id: 'IToolEnablementService' }).setEnablement('parallx-community.media-organizer', true); });
    await page.waitForTimeout(3_000);

    // ── example: the marks brushed over on one photo ──
    const example = set[0];
    log('editImage', await runCommand(page, 'media-organizer.editImage', exampleId));
    let ed = await until(() => editorState(page), (s) => s.title === example.name && s.sliders > 0 && !s.message, 30_000);
    check('the editor opens on the example', !!ed && ed.title === example.name, ed && ed.title);
    await clickIn(page, '.mo-edit', 'Remove');
    ed = await until(() => editorState(page), (s) => s.tool === 'Remove' && s.panelButtons.includes('Undo Last Removal'), 20_000);
    check('Remove is ready, and Remove From Other Photos waits for a first removal', ed.panelButtons.includes('Remove From Other Photos (off)') && ed.panelTitles.includes('Other Photos'), ed.panelButtons);
    ed = await until(() => editorState(page), (s) => s.stage.zoom > 0 && s.stage.w > 0, 10_000);
    log('stage', ed.stage);
    const k = ed.stage.zoom / ed.stage.dpr;
    const at = (px, py) => [ed.stage.x + ed.stage.w / 2 + (px - W / 2) * k, ed.stage.y + ed.stage.h / 2 + (py - H / 2) * k];
    for (const [i, m] of example.marks.entries()) {
      await setBrush(page, Math.min(240, Math.max(20, Math.round((m.h + 24) * k))));
      const [x0, y0] = at(m.x - 4, m.y + m.h / 2); const [x1] = at(m.x + m.w + 4, m.y + m.h / 2);
      await page.mouse.move(x0, y0);
      await page.mouse.down();
      await page.mouse.move(x1, y0, { steps: 14 });
      await page.mouse.up();
      ed = await until(() => editorState(page), (s) => s.panelTitles.includes(`Removed (${i + 1})`) && !s.chip, 90_000);
      check(`the ${m.kind} is brushed over and removed`, ed.panelTitles.includes(`Removed (${i + 1})`), ed.panelTitles);
    }
    check('Remove From Other Photos is offered once something is removed', ed.panelButtons.includes('Remove From Other Photos') && !ed.panelButtons.includes('Remove From Other Photos (off)'), ed.panelButtons);
    await shot(page, 'bulk-example');

    // ── open ──
    await clickIn(page, '.mo-edit', 'Remove From Other Photos');
    let b = await until(() => bulkState(page), (s) => s.tiles.length > 0 && s.marks.length > 0 && s.sub.startsWith('Tick the photos'), 30_000);
    log('page', b && { ...b, tiles: b.tiles.length });
    check('the page opens with the marks to look for', !!b && b.title === 'Remove From Other Photos' && b.marks.length === example.marks.length && b.marks.every((m) => m.on && !m.plain && m.picture > 0), b && b.marks);
    check('and the other photos of the folder, the example left out', !!b && b.tiles.length === set.length - 1 + 4 && !b.tiles.some((t) => t.name === example.name) && b.scope.startsWith('This Folder'), b && `${b.tiles.length} photos; ${b.scope}`);
    check('nothing can be removed before anything is found', !!b && b.remove === 'off' && b.removeText === 'Remove And Save Copies', b && b.removeText);
    check('no photo is ticked and nothing is looked in until one is', !!b && b.tiles.every((t) => !t.checked) && b.find === 'off' && b.findText === 'Find Marks' && b.picked.startsWith('0 of 13'), b && `${b.sub} | ${b.picked}`);
    check('one dropdown, the shared one', !!b && b.natives === 0 && !!b.scope);
    await shot(page, 'bulk-open');

    // ── choose: only the photos ticked are looked in ──
    await clickPhoto(page, 'set-02-same-place.jpg', false);
    let some = await until(() => bulkState(page), (s) => s.findText === 'Find Marks In 1 Photo', 5_000);
    check('a click on a photo ticks it', some.findText === 'Find Marks In 1 Photo' && some.tiles.find((t) => t.name === 'set-02-same-place.jpg').checked, some.findText);
    await clickPhoto(page, 'set-04-smaller.jpg', true);
    some = await until(() => bulkState(page), (s) => s.findText === 'Find Marks In 3 Photos', 5_000);
    check('a shift-click ticks the run up to it', some.findText === 'Find Marks In 3 Photos' && ['set-02-same-place.jpg', 'set-03-other-corner.jpg', 'set-04-smaller.jpg'].every((n) => some.tiles.find((t) => t.name === n).checked) && some.picked.startsWith('3 of 13'), `${some.findText}; ${some.picked}`);
    await clickPhoto(page, 'set-09-no-mark.jpg', false);
    await clickIn(page, '.mo-br-page', 'Find Marks');
    some = await until(() => bulkState(page), (s) => s.sub.startsWith('Found on') && s.stop === 'off', 600_000);
    const lookedAt = some.tiles.filter((t) => t.status).map((t) => t.name).sort();
    check('only the four ticked are looked in', lookedAt.join() === ['set-02-same-place.jpg', 'set-03-other-corner.jpg', 'set-04-smaller.jpg', 'set-09-no-mark.jpg'].join() && some.filters.some((f) => f === 'Not Looked At 9') && some.sub.includes('of 4 photos looked at'), `${some.sub} | ${some.filters.join(' | ')}`);
    check('the mark is found on the three that have it', ['set-02-same-place.jpg', 'set-03-other-corner.jpg', 'set-04-smaller.jpg'].every((n) => some.tiles.find((t) => t.name === n).status === '1 Found') && some.tiles.find((t) => t.name === 'set-09-no-mark.jpg').status === 'Not Found', some.tiles.filter((t) => t.status).map((t) => `${t.name}: ${t.status}`).join('; '));
    await shot(page, 'bulk-chosen');
    await clickIn(page, '.mo-br-page', 'Select None');
    some = await until(() => bulkState(page), (s) => s.picked.startsWith('0 of'), 5_000);
    check('Select None unticks them', some.tiles.every((t) => !t.checked) && some.find === 'off', some.picked);
    await clickIn(page, '.mo-br-page', 'Select All');
    some = await until(() => bulkState(page), (s) => s.findText === 'Find Marks In 13 Photos', 5_000);
    check('Select All ticks every photo', some.findText === 'Find Marks In 13 Photos' && some.tiles.every((t) => t.checked), some.findText);
    said.length = 0;

    // ── find ──
    const t0 = Date.now();
    await clickIn(page, '.mo-br-page', 'Find Marks');
    const during = await until(() => bulkState(page), (s) => (s.sub.startsWith('Looking at') || s.sub.startsWith('Learning')) && s.bar === 'visible', 10_000);
    check('while it looks it says what it is doing, and can be stopped', !!during && during.stop === 'on' && during.find === 'off', during && `${during.sub} (${during.percent}%)`);
    b = await until(() => bulkState(page), (s) => s.sub.startsWith('Found on') && s.stop === 'off' && s.bar === 'hidden', 600_000);
    log('looking took', `${((Date.now() - t0) / 1000).toFixed(1)} s for ${b.tiles.length} photos`);
    log('after', b.sub);
    check('the logo was learnt from the photos that have it (the tag is on one other photo only, too few to learn from), on the graphics card', said.some((t) => /learnt 1 of 2 marks/.test(t)) && said.some((t) => /on the graphics card/.test(t)), said.map((t) => t.replace('[MediaOrganizer] Remove From Other Photos: ', '')).join(' | '));
    let right = 0; let stamped = 0; const wrong = [];
    for (const p of set.slice(1)) {
      const t = b.tiles.find((x) => x.name === p.name);
      const sure = t ? t.finds.filter((f) => !f.unsure) : [];
      for (const m of p.marks) { stamped++; if (sure.some((f) => isMark(f, m))) right++; else wrong.push(`${p.name}: the ${m.kind} was not found (${t ? t.status : 'no tile'})`); }
      for (const f of sure) if (!p.marks.some((m) => isMark(f, m))) wrong.push(`${p.name}: found something that is no mark at ${f.x.toFixed(0)}%, ${f.y.toFixed(0)}%`);
    }
    for (const name of ['boxing.jpg', 'card.jpg', 'fractal.jpg', 'bars.jpg']) { const t = b.tiles.find((x) => x.name === name); if (!t || t.finds.some((f) => !f.unsure)) wrong.push(`${name}: found something that is no mark`); }
    check('every stamped mark is found where it was put, at its size', right === stamped, `${right} of ${stamped}`);
    // what the wrong ones were judged on
    for (const t of b.tiles) {
      const p = set.find((x) => x.name === t.name);
      const bad = t.finds.filter((f) => !(p && p.marks.some((m) => isMark(f, m))));
      const good = t.finds.filter((f) => p && p.marks.some((m) => isMark(f, m)));
      if (bad.length || process.env.PROBE_SAY) console.log(`[probe]   ${t.name}: right ${good.map((f) => `mark ${f.mark} ${f.score} (settled ${f.settled}) on ${f.points} points at ${f.size} px`).join(', ') || 'none'}; wrong ${bad.map((f) => `mark ${f.mark} ${f.score} (settled ${f.settled}) on ${f.points} points at ${f.size} px`).join(', ') || 'none'}`);
    }
    const given = b.tiles.reduce((n, t) => n + t.finds.length, 0);
    check('a photo is given the finds it has, not dozens', given <= stamped + 4 && b.tiles.every((t) => t.finds.length <= 4), `${given} finds on ${b.tiles.length} photos for ${stamped} marks stamped; the most on one photo ${Math.max(...b.tiles.map((t) => t.finds.length))}`);
    check('and nothing else is called a mark', wrong.length === 0, wrong.length ? wrong : 'no photo has a wrong find');
    const two = b.tiles.find((t) => t.name === 'set-06-two-of-it.jpg'); const both = b.tiles.find((t) => t.name === 'set-07-both-marks.jpg');
    check('the photo with the logo twice has two finds, the one with both marks has both', !!two && two.status.startsWith('2 Found') && !!both && both.status.startsWith('2 Found'), `${two && two.status}; ${both && both.status}`);
    const none = b.tiles.filter((t) => t.status === 'Not Found').map((t) => t.name);
    check('photos without the mark say Not Found and are left alone', ['set-09-no-mark.jpg', 'set-10-no-mark.jpg'].every((n) => none.includes(n)) && b.tiles.filter((t) => t.status === 'Not Found').every((t) => !t.checked), none.join(', '));
    const unsure = b.tiles.filter((t) => t.finds.some((f) => f.unsure));
    check('what it is unsure of is shown but not marked for removal', unsure.every((t) => t.finds.filter((f) => f.unsure).every((f) => !f.on)), `${unsure.length} photos have an unsure find`);
    const counted = b.tiles.filter((t) => t.checked).length;
    check('the button says how many copies it will write', b.remove === 'on' && b.removeText === `Remove And Save ${counted} ${counted === 1 ? 'Copy' : 'Copies'}`, b.removeText);
    check('the photos show their pictures and the filters their counts', b.tiles.every((t) => t.picture) && b.filters.some((f) => f.startsWith('All ')) && b.filters.some((f) => f.startsWith('Found ')) && b.filters.some((f) => f.startsWith('Not Found ')), b.filters.join(' | '));
    check('Mark Only is chosen; the logo shows the shape worked out for it, the tag (on one other photo only) says Whole Area', b.what.startsWith('Mark Only') && b.marks[0].shape > 0 && !b.marks[0].says && b.marks[1].says === 'Whole Area', `${b.what}; ${JSON.stringify(b.marks.map((m) => ({ shape: m.shape > 0, says: m.says })))}`);
    check('every find shows the shape that will be removed', b.tiles.every((t) => t.finds.every((f) => f.shape > 0)));
    await shot(page, 'bulk-found');
    const logoShape = b.marks[0].shape;
    await chooseWhat(page, 'Whole Brushed Area');
    let whole = await until(() => bulkState(page), (s) => s.what.startsWith('Whole Brushed Area') && s.marks[0].shape !== logoShape, 5_000);
    check('Whole Brushed Area shows what was brushed instead', whole.what.startsWith('Whole Brushed Area') && whole.marks[0].shape > 0 && whole.marks[0].shape !== logoShape && !whole.marks[1].says, `${whole.what}; the shape drawn changed: ${whole.marks[0].shape !== logoShape}`);
    await shot(page, 'bulk-whole');
    await chooseWhat(page, 'Mark Only');
    whole = await until(() => bulkState(page), (s) => s.what.startsWith('Mark Only') && s.marks[0].shape === logoShape, 5_000);
    check('and Mark Only is back', whole.what.startsWith('Mark Only') && whole.marks[0].shape === logoShape, whole.what);

    // ── decide: a find left out, and taken back in ──
    const target = 'set-04-smaller.jpg';
    const toggle = () => page.evaluate((name) => {
      const root = Array.from(document.querySelectorAll('.mo-br-page')).find((r) => r.offsetParent !== null);
      const tile = Array.from(root.querySelectorAll('.mo-br-tile')).find((t) => t.querySelector('.mo-br-name').textContent === name);
      const f = tile && tile.querySelector('.mo-br-find');
      if (!f) return false;
      f.click();
      return true;
    }, target);
    await toggle();
    let after = await until(() => bulkState(page), (s) => s.removeText.includes(` ${counted - 1} `), 5_000);
    check('a find clicked is left in the photo, and the photo drops out of the count', after.removeText.includes(` ${counted - 1} `) && after.tiles.find((t) => t.name === target).finds[0].on === false, after.removeText);
    await toggle();
    after = await until(() => bulkState(page), (s) => s.removeText.includes(` ${counted} `), 5_000);
    check('clicked again it is back', after.removeText.includes(` ${counted} `) && after.tiles.find((t) => t.name === target).checked, after.removeText);

    // ── remove: Mark Only, one photo kept back ──
    const KEPT = 'set-05-larger.jpg';
    await tick(page, KEPT, false);
    const first = counted - 1;
    after = await until(() => bulkState(page), (s) => s.removeText.includes(` ${first} `), 5_000);
    check('a photo unticked is kept back', after.removeText.includes(` ${first} `), after.removeText);
    await clickIn(page, '.mo-br-page', 'Remove And Save');
    const confirm = page.locator('button').filter({ hasText: new RegExp(`^Save ${first} Cop`) }).first();
    await confirm.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
    check('it asks before writing, saying how many copies', (await confirm.count()) > 0);
    const t1 = Date.now();
    if (await confirm.count()) await confirm.click();
    const over = (s) => s.stop === 'off' && s.bar === 'hidden' && !s.tiles.some((t) => t.status === 'Removing');
    b = await until(() => bulkState(page), (s) => over(s) && s.tiles.filter((t) => t.status.startsWith('Removed') || t.status === 'Failed').length >= first, 900_000);
    log('removing took', `${((Date.now() - t1) / 1000).toFixed(1)} s for ${first} photos`);
    log('after', b.sub);
    check('every photo marked for removal says Removed, the one kept back is still to do', b.tiles.filter((t) => t.status.startsWith('Removed')).length === first && !b.tiles.some((t) => t.status === 'Failed') && b.tiles.find((t) => t.name === KEPT).status.startsWith('1 Found'), `${b.tiles.filter((t) => t.status.startsWith('Removed')).length} of ${first}; ${b.tiles.filter((t) => t.status === 'Failed').map((t) => `${t.name}: ${t.note}`).join('; ')}`);
    await shot(page, 'bulk-removed');
    let copies = 0; const poor = []; const spared = [];
    for (const p of set.slice(1)) {
      if (!p.marks.length || p.name === KEPT) continue;
      const copy = path.join(photos, p.name.replace(/\.jpg$/, '-edit.jpg'));
      if (!existsSync(copy)) { poor.push(`${p.name}: no copy`); continue; }
      copies++;
      for (const m of p.marks) {
        const region = { x: Math.max(0, m.x), y: Math.max(0, m.y), w: Math.min(W - m.x, m.w), h: Math.min(H - m.y, m.h) };
        // the mark's own colour: how much of it the place held, holds now, and holds in the photo that never had the mark
        const had = markPixels(p.file, region, COLOUR[m.kind]); const has = markPixels(copy, region, COLOUR[m.kind]); const never = markPixels(p.clean, region, COLOUR[m.kind]);
        const stands = apart(fileGrid(copy, 24, region), fileGrid(p.clean, 24, region));
        // what lay beside the letters, in the mark's own box and further than 14 pixels from any of them
        const by = beside(copy, p.file, p.clean, region, 14);
        const note = `${p.name} ${m.kind}: ${had} pixels of its colour before, ${has} in the copy (${never} in the photo that never had it); the place stands ${stands.toFixed(1)} of 255 from that photo; beside the mark ${(by.share * 100).toFixed(1)}% of ${by.far} pixels changed`;
        if (m.solid && !(has - never < (had - never) * 0.1)) poor.push(note); else console.log(`[probe]   ${note}`);
        if (m.kind === 'logo' && by.far > 200) spared.push({ name: p.name, share: by.share, stands });
      }
      const clear = [{ x: Math.round(700 * K), y: Math.round(20 * K), w: 200, h: 200 }, { x: Math.round(60 * K), y: Math.round(420 * K), w: 200, h: 200 }].find((r) => !p.marks.some((m) => m.x < r.x + r.w + 60 && m.x + m.w > r.x - 60 && m.y < r.y + r.h + 60 && m.y + m.h > r.y - 60));
      const drift = clear ? apart(fileGrid(copy, 24, clear), fileGrid(p.file, 24, clear)) : 0;
      if (drift > 2) poor.push(`${p.name}: away from the marks the photo moved by ${drift.toFixed(2)} of 255`);
    }
    check('a copy is written beside each original', copies === set.slice(1).filter((p) => p.marks.length && p.name !== KEPT).length, `${copies} copies`);
    check('in each copy the mark is gone, and the photo away from it is as it was', poor.length === 0, poor.length ? poor : 'no copy holds the colour of its mark');
    const worst = spared.reduce((m, x) => Math.max(m, x.share), 0);
    check('Mark Only leaves what lay beside the letters as it was', spared.length > 0 && worst < 0.05, `${spared.length} logos with room beside their letters; at most ${(worst * 100).toFixed(1)}% of what lay beside them changed`);

    // ── whole: the photo kept back, removed as Whole Brushed Area and saved over its original ──
    await chooseWhat(page, 'Whole Brushed Area');
    await until(() => bulkState(page), (s) => s.what.startsWith('Whole Brushed Area'), 5_000);
    await tick(page, KEPT, true);
    after = await until(() => bulkState(page), (s) => s.removeText.includes(' 1 Copy'), 5_000);
    check('the photo kept back is the one left to do', after.removeText === 'Remove And Save 1 Copy', after.removeText);
    check('copies are what is written unless asked otherwise', after.save.startsWith('Save As Copies'), after.save);
    // PROBE_SAVE=copy writes this one as a copy too, as the others were
    const saveOver = (process.env.PROBE_SAVE || 'over') !== 'copy';
    if (saveOver) {
      await chooseSave(page, 'Save Over Originals');
      after = await until(() => bulkState(page), (s) => s.save.startsWith('Save Over Originals') && s.removeText.includes('Over'), 5_000);
      check('Save Over Originals says so on the button', after.removeText === 'Remove And Save Over 1 Original', `${after.save}; ${after.removeText}`);
    }
    const keptFile = path.join(photos, KEPT);
    const keptOut = saveOver ? keptFile : path.join(photos, KEPT.replace(/\.jpg$/, '-edit.jpg'));
    const keptBefore = path.join(appRoot, 'kept-before.jpg');      // what the original held, out of the library's sight
    await fs.copyFile(keptFile, keptBefore);
    await clickIn(page, '.mo-br-page', 'Remove And Save');
    const confirm2 = page.locator('button').filter({ hasText: saveOver ? /^Save Over 1 Original/ : /^Save 1 Copy/ }).first();
    await confirm2.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
    const asked = (await confirm2.count()) ? await page.evaluate(() => (document.querySelector('.parallx-modal-box') || {}).textContent || '') : '';
    if (saveOver) check('it asks first and says the originals cannot be brought back', /cannot be brought back/.test(asked), asked.slice(0, 200));
    if (await confirm2.count()) await confirm2.click();
    b = await until(() => bulkState(page), (s) => over(s) && s.tiles.find((t) => t.name === KEPT).status !== '1 Found', 300_000);
    {
      const p = set.find((x) => x.name === KEPT); const m = p.marks[0];
      const region = { x: m.x, y: m.y, w: m.w, h: m.h };
      const tile = b.tiles.find((t) => t.name === KEPT);
      const written = existsSync(keptOut) && apart(fileGrid(keptOut, 24, region), fileGrid(keptBefore, 24, region)) > 1;
      const had = markPixels(keptBefore, region, COLOUR.logo); const has = written ? markPixels(keptOut, region, COLOUR.logo) : -1;
      const by = written ? beside(keptOut, keptBefore, p.clean, region, 14) : { share: 0, far: 0 };
      check('Whole Brushed Area removes the mark too, and rebuilds what lay beside it', written && has < had * 0.1 && by.share > worst * 2 && by.share > 0.1, `${had} pixels of its colour before, ${has} in the saved photo; beside the mark ${(by.share * 100).toFixed(1)}% of ${by.far} pixels changed`);
      if (saveOver) {
        check('the photo was saved over its original: no copy, nothing left beside it', written && !existsSync(path.join(photos, KEPT.replace(/\.jpg$/, '-edit.jpg'))) && !readdirSync(photos).some((n) => /\.saving-/.test(n)), `${tile && tile.status}: ${tile && tile.note}; ${b.sub}`);
        check('and the page says so', !!tile && tile.status.startsWith('Removed') && /^Saved over /.test(tile.note), tile && tile.note);
      } else copies += written ? 1 : 0;
    }
    check(saveOver ? 'no other original was written to' : 'no original was written to', set.every((p) => (saveOver && p.name === KEPT) || statSync(p.file).size === sizes.get(p.name)));
    check('photos with nothing found have no copy', !existsSync(path.join(photos, 'set-09-no-mark-edit.jpg')) && !existsSync(path.join(photos, 'boxing-edit.jpg')));

    // the removal is part of each photo's own edit: it can be undone in the editor
    log('editImage', await runCommand(page, 'media-organizer.editImage', exampleId + 1));
    ed = await until(() => editorState(page), (s) => s.title === set[1].name && s.sliders >= 0 && !s.message, 30_000);
    await clickIn(page, '.mo-edit', 'Remove');
    ed = await until(() => editorState(page), (s) => s.tool === 'Remove' && /Removed \(\d+\)/.test(s.panelTitles), 20_000);
    check('the removal is in the photo\'s own edit, where it can be undone', !!ed && ed.panelTitles.includes('Removed (1)'), ed && ed.panelTitles);

    log('editImage', await runCommand(page, 'media-organizer.editImage', exampleId));
    ed = await until(() => editorState(page), (s) => s.title === example.name && !s.message, 30_000);
    await clickIn(page, '.mo-edit', 'Remove');
    await until(() => editorState(page), (s) => s.tool === 'Remove' && s.panelButtons.includes('Remove From Other Photos'), 20_000);
    await clickIn(page, '.mo-edit', 'Remove From Other Photos');
    b = await until(() => bulkState(page), (s) => s.tiles.length === set.length - 1 + 4 + copies && s.sub.startsWith('Tick the photos'), 30_000);
    check('opened again, the page lists the copies with the rest', !!b && b.tiles.length === set.length - 1 + 4 + copies, b && `${b.tiles.length} photos`);
    await clickIn(page, '.mo-br-page', 'Select All');
    await until(() => bulkState(page), (s) => s.find === 'on', 5_000);
    await clickIn(page, '.mo-br-page', 'Find Marks');
    b = await until(() => bulkState(page), (s) => s.sub.startsWith('Found on') && s.stop === 'off' && s.bar === 'hidden', 600_000);
    const left = b.tiles.filter((t) => t.finds.some((f) => !f.unsure)).map((t) => `${t.name} (${t.status})`);
    check('looking again finds nothing left, in the copies or in the photos they were made from', left.length === 0, left.length ? left : b.sub);

    // ── library: the photos selected there are the photos to look in ──
    const chosen = [exampleId, exampleId + 8, exampleId + 9];                   // the example and the two photos without a mark
    log('removeFromSelected', await runCommand(page, 'media-organizer.removeFromSelected', chosen));
    b = await until(() => bulkState(page), (s) => s.scope.startsWith('Selected In Library') && s.tiles.length === 2, 30_000);
    check('Remove Marks From Selected opens the page on the photos selected, ticked, the one with a removal as the example', !!b && b.scope.startsWith('Selected In Library (2)') && b.tiles.length === 2 && b.tiles.every((t) => t.checked) && b.findText === 'Find Marks In 2 Photos' && b.marks.length === example.marks.length, b && `${b.scope}; ${b.tiles.map((t) => t.name).join(', ')}; ${b.findText}`);
    log('removeFromSelected', await runCommand(page, 'media-organizer.removeFromSelected', [exampleId + 8, exampleId + 9]));
    ed = await until(() => editorState(page), (s) => s.title === 'set-09-no-mark.jpg' && s.tool === 'Remove', 30_000);
    check('with no mark removed on any of them yet, the first opens in the editor on Remove', !!ed && ed.title === 'set-09-no-mark.jpg' && ed.tool === 'Remove', ed && `${ed.title}; ${ed.tool}`);

    if (errors.length) { failures++; console.log(`[probe] FAIL renderer errors:\n  ${errors.slice(0, 8).join('\n  ')}`); } else console.log('[probe] no renderer errors');
  } finally {
    await app.close().catch(() => {});
    if (!process.env.PROBE_KEEP) for (const d of [appRoot, workspace]) await fs.rm(d, { recursive: true, force: true }).catch(() => {});
  }
  console.log(failures ? `[probe] ${failures} check(s) FAILED` : '[probe] every check passed');
  process.exit(failures ? 1 : 0);
}

main().catch((err) => { console.error('[probe] crashed:', err); process.exit(1); });
