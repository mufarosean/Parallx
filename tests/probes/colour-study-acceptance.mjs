// colour-study-acceptance.mjs — @acceptance
//
// The acceptance probe for Colour Study (docs/ATELIER_COLOUR_STUDY.md), a
// standalone tool in Atelier's Studio section for learning to mix paint.
// Written from the owner's request and the contract in that file BEFORE the
// tool was built, by an agent that did not build it. The builder does not
// edit this file; if a check is wrong the verifier changes it and says why.
//
// It boots the built app hidden on a throwaway workspace with a seeded
// library (five pictures, one painting plan with saved colours, and a paint
// list of its own in `plan_paints_v1`), acts with the real mouse and keys,
// and reads back `root.__moColourStudy.state()`, the page and the database.
//
// What it checks (one ok / FAIL line each):
//   1. Studio has "Colour Study"; `media-organizer.colourStudy` opens the home;
//      the home can make a sheet; `media-organizer.colour.newSheet` makes and
//      opens one on the wheel, with no picture and no plan asked for.
//   2. The sheet: a wheel canvas with a size and drawn hues, numbered dots,
//      palette rows, a recipe made only of the paints in the list (parts, a
//      role each, a closeness word), target and mix on the ground, Copy Recipe.
//   3. Keys: arrows on a dot turn the set and change its strength, 1 to N
//      choose a colour, the lightness bar is a slider the arrows move, and the
//      wheel is redrawn at the new lightness.
//   4. Harmony, wheel model, hatching and Value Check change the state and
//      what is drawn.
//   5. The five rows, their sentences and Why, a click (shown in the card), a
//      double click (the base), the light toggle, the twins' own greyscale.
//   6. Edit Mix: a tube row per paint, more / less, the drift sentence, Reset,
//      one nudge per paint in the list, Fix My Mix, Swap.
//   7. Paints: removing one changes the list and the recipe; named sets are
//      saved and switched; the choice survives reopening.
//   8. A sheet comes back as it was after its tab is closed, and after the
//      app is closed and opened; its row is in `mo_colour_sheets`; with
//      Atelier turned off the sheet and its command are gone.
//   9. A picture as the source (a click takes the pixel's colour), and a
//      sheet made from a painting plan's variation with its saved colours.
//  10. Screenshots of the sheet, the bench and the picture source.
//
// Where the contract leaves a detail open the probe finds the control by its
// accessible name or role; each such place says ASSUMED and what it expects.
//
//   node scripts/build.mjs
//   mkdir -p test-results && xvfb-run -a node tests/probes/colour-study-acceptance.mjs test-results/colour-study
//
// COLOUR_STUDY_EXT=<dir> runs against another copy of `ext/` (the code as it
// was before the build, to see every check of new behaviour fail).

import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { launchApp } from './scene.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');
const ELECTRON = path.join(REPO, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const SEED = path.join(__dirname, 'tag-review-seed.cjs');
const TOOL = 'parallx-community.media-organizer';
const EXT = process.env.COLOUR_STUDY_EXT ? path.resolve(process.env.COLOUR_STUDY_EXT) : path.join(REPO, 'ext');

const outDir = path.resolve(process.argv[2] ?? path.join(REPO, 'test-results', 'colour-study'));
const stamp = Date.now();
const appRoot = path.join(outDir, `app-${stamp}`);
const workspace = path.join(outDir, `ws-${stamp}`);
const photos = path.join(workspace, 'photos');
const shots = path.join(outDir, 'shots');

// ── What the probe seeds ─────────────────────────────────────────────────────
// A paint list that is not the starter list: seven known tubes and one of the
// probe's own, so a tool that reads the shared list shows exactly these.
const SEEDED_PAINTS = [
  { name: 'Titanium White', hex: '#F4F3EE' }, { name: 'Cadmium Yellow Light', hex: '#F7D417' },
  { name: 'Yellow Ochre', hex: '#C6923A' }, { name: 'Cadmium Red Light', hex: '#E2342A' },
  { name: 'Alizarin Crimson', hex: '#8E1B2C' }, { name: 'Ultramarine Blue', hex: '#1F2E8C' },
  { name: 'Burnt Umber', hex: '#4A2E20' }, { name: 'Probe Teal', hex: '#1F8A8A' },
];
// halves.jpg: the left half one colour, the right half another.
const LEFT = [200, 64, 42];
const RIGHT = [42, 80, 200];
// The plan's variation carries three saved colours (two on the picture, one from the palette).
const PLAN_SAVED = [{ rgb: [200, 64, 42], x: 0.25, y: 0.5 }, { rgb: [42, 80, 200], x: 0.75, y: 0.5 }, { rgb: [30, 140, 90], x: null, y: null }];
const HARMONIES = { complementary: [0, 180], splitComplementary: [0, 150, 210], triadic: [0, 120, 240], tetradic: [0, 60, 180, 300], square: [0, 90, 180, 270], analogous: [0, -30, 30] };

// ── Colour arithmetic (the probe's own, from the contract) ───────────────────
const hexRgb = (hex) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? '').trim()); return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : null; };
const normHex = (hex) => { const c = hexRgb(hex); return c ? c.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase() : null; };
const near = (a, b, tol = 2) => !!a && !!b && a.every((v, i) => Math.abs(v - b[i]) <= tol);
const nearHex = (a, b, tol = 2) => near(hexRgb(a), hexRgb(b), tol);
function hsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  return [h, s, l];
}
// Painter's value: CIE L* / 10.
function value(rgb) {
  const lin = rgb.map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  const y = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  return (y > 0.008856 ? 116 * Math.cbrt(y) - 16 : 903.3 * y) / 10;
}
// moWheelAngle: 'painter' puts angles 0, 60, 120, 180, 240, 300, 360 on hues 0, 30, 60, 120, 240, 285, 360; 'screen' is the hue.
function wheelAngle(hue, model) {
  if (model !== 'painter') return hue;
  const A = [0, 60, 120, 180, 240, 300, 360], H = [0, 30, 60, 120, 240, 285, 360];
  for (let i = 0; i < 6; i++) if (hue >= H[i] && hue <= H[i + 1]) return A[i] + ((hue - H[i]) / (H[i + 1] - H[i])) * 60;
  return 0;
}
const angDiff = (a, b) => { const d = Math.abs((((a - b) % 360) + 360) % 360); return Math.min(d, 360 - d); };
// Do these colours sit on the harmony's angles, taking any one of them as the base?
function onHarmony(colours, type, model, tol = 12) {
  const offs = HARMONIES[type];
  if (!offs || colours.length !== offs.length) return false;
  const angles = colours.map((c) => wheelAngle(hsl(hexRgb(c))[0], model));
  return angles.some((base) => {
    const left = angles.map((a) => (((a - base) % 360) + 360) % 360);
    return offs.every((o) => { const i = left.findIndex((a) => angDiff(a, o) <= tol); if (i < 0) return false; left.splice(i, 1); return true; });
  });
}
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'none'; // the kit's sceneSlug
const flat = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const sameSet = (a, b) => a.length === b.length && [...a].map(flat).sort().join('|') === [...b].map(flat).sort().join('|');
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ── Results ──────────────────────────────────────────────────────────────────
const failed = [];
let passed = 0;
const notRunList = [];
async function t(name, fn) {
  let ok = false, got;
  try {
    const r = await Promise.race([fn(), new Promise((_, rej) => setTimeout(() => rej(new Error('took over 90 s')), 90_000))]);
    ok = Array.isArray(r) ? r[0] === true : r === true;
    got = Array.isArray(r) ? r[1] : r;
  } catch (e) { got = 'stopped: ' + String(e?.message || e).split('\n')[0].slice(0, 260); }
  let shown = '';
  if (!ok) { try { shown = JSON.stringify(got); } catch { shown = String(got); } shown = ': ' + String(shown ?? '').slice(0, 420); }
  console.log(`${ok ? '  ok ' : ' FAIL'} ${name}${shown}`);
  if (ok) passed++; else failed.push(name);
}
const notRun = (name, why) => { console.log(` NOT RUN ${name}: ${why}`); notRunList.push(name); };

// ── The seed: a library, a plan, the paint list ──────────────────────────────
const nodeEnv = () => ({ ...process.env, ELECTRON_RUN_AS_NODE: '1' });
const dbPaths = ['media-organizer', TOOL].map((id) => path.join(workspace, '.parallx', 'extensions', id, 'data.db'));
const DB_TOOL = path.join(outDir, `db-tool-${stamp}.cjs`);
const DB_TOOL_SOURCE = `
'use strict';
const fs = require('fs');
const [sqlite, mode, dbPath, argPath] = process.argv.slice(2);
if (mode === 'read' && !fs.existsSync(dbPath)) { console.log(JSON.stringify({ missing: true })); process.exit(0); }
const db = new (require(sqlite))(dbPath, mode === 'read' ? { readonly: true } : {});
if (mode === 'seed') {
  const a = JSON.parse(fs.readFileSync(argPath, 'utf8'));
  db.prepare('INSERT OR REPLACE INTO mo_settings (key, value) VALUES (?, ?)').run('plan_paints_v1', JSON.stringify({ paints: a.paints }));
  const plan = Number(db.prepare('INSERT INTO mo_plans (title, photo_id, canvas_w, canvas_h) VALUES (?, ?, 16, 20)').run('Probe Plan', a.photoId).lastInsertRowid);
  const variant = Number(db.prepare('INSERT INTO mo_plan_variants (plan_id, name, recipe_json, position) VALUES (?, ?, ?, 0)').run(plan, 'Probe Variation', JSON.stringify({ saved: a.saved })).lastInsertRowid);
  db.prepare('UPDATE mo_plans SET variant_id = ? WHERE id = ?').run(variant, plan);
  console.log(JSON.stringify({ plan, variant }));
} else {
  const has = !!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'mo_colour_sheets'").get();
  const sheets = has ? db.prepare('SELECT * FROM mo_colour_sheets ORDER BY id').all() : null;
  const setting = (k) => { const r = db.prepare('SELECT value FROM mo_settings WHERE key = ?').get(k); return r ? r.value : null; };
  console.log(JSON.stringify({ sheets, paints: setting('plan_paints_v1'), sets: setting('plan_paint_sets_v1') }));
}
db.close();
`;
function dbTool(mode, dbPath, argPath) {
  const r = spawnSync(ELECTRON, [DB_TOOL, path.join(REPO, 'node_modules', 'better-sqlite3'), mode, dbPath, ...(argPath ? [argPath] : [])], { env: nodeEnv(), encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error(`db ${mode} failed: ${(r.stderr || r.stdout || '').slice(0, 300)}`);
  return JSON.parse(r.stdout.trim().split(/\r?\n/).pop());
}
async function seed() {
  for (const d of [path.join(appRoot, 'data'), photos, shots]) await fs.mkdir(d, { recursive: true });
  await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: workspace }));
  await fs.symlink(EXT, path.join(appRoot, 'ext'), 'junction');
  await fs.writeFile(DB_TOOL, DB_TOOL_SOURCE);
  const ff = (args, name) => { const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args, path.join(photos, name)], { windowsHide: true }); if (r.status !== 0) throw new Error(`ffmpeg ${name}: ${String(r.stderr).slice(0, 200)}`); };
  const gen = [['boxing.jpg', 'testsrc2=size=1200x800', 1200, 800], ['card.jpg', 'testsrc2=size=2400x1600', 2400, 1600], ['fractal.jpg', 'mandelbrot=size=1800x1200', 1800, 1200], ['bars.jpg', 'smptehdbars=size=1920x1080', 1920, 1080]];
  for (const [name, src] of gen) ff(['-f', 'lavfi', '-i', src, '-frames:v', '1', '-q:v', '3'], name);
  const hexOf = (c) => '0x' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
  ff(['-f', 'lavfi', '-i', `color=c=${hexOf(LEFT)}:s=600x800`, '-f', 'lavfi', '-i', `color=c=${hexOf(RIGHT)}:s=600x800`, '-filter_complex', 'hstack', '-frames:v', '1', '-q:v', '2'], 'halves.jpg');
  const spec = [...gen.map(([basename, , width, height]) => ({ basename, width, height })), { basename: 'halves.jpg', width: 1200, height: 800 }];
  const specPath = path.join(appRoot, 'spec.json');
  await fs.writeFile(specPath, JSON.stringify(spec));
  const argPath = path.join(appRoot, 'seed-arg.json');
  let out = null;
  for (const db of dbPaths) {
    const r = spawnSync(ELECTRON, [SEED, 'seed', db, photos, specPath], { env: nodeEnv(), encoding: 'utf8', windowsHide: true });
    if (r.status !== 0) throw new Error(`seed failed: ${r.stderr || r.stdout}`);
    const lib = JSON.parse(r.stdout.trim().split(/\r?\n/).pop());
    await fs.writeFile(argPath, JSON.stringify({ paints: SEEDED_PAINTS, photoId: lib.photo['halves.jpg'], saved: PLAN_SAVED }));
    out = { photo: lib.photo, ...dbTool('seed', db, argPath) };
  }
  return out;
}
const readDb = () => { const all = dbPaths.map((p) => dbTool('read', p)); return all.find((d) => d.sheets) || all.find((d) => !d.missing) || { missing: true }; };

// ── The app ──────────────────────────────────────────────────────────────────
let app = null, page = null, errors = [];
const wait = (ms) => page.waitForTimeout(ms);
const P = (fn, arg) => page.evaluate(fn, arg);
const run = (id, ...args) => P(async ({ id, args }) => {
  const svc = window.__parallx_workbench__?._services?.get?.({ id: 'ICommandService' });
  if (!svc) return { ok: false, error: 'no command service' };
  try { const v = await svc.executeCommand(id, ...args); return { ok: true, value: v === undefined ? null : JSON.parse(JSON.stringify(v)) }; } catch (e) { return { ok: false, error: String(e?.message || e) }; }
}, { id, args });
const setTool = (on) => P(async ({ id, on }) => { await window.__parallx_workbench__._services.get({ id: 'IToolEnablementService' }).setEnablement(id, on); }, { id: TOOL, on });

// What the page helpers read. They never set anything.
function installHelpers() {
  const vis = (el) => { if (!el || !el.isConnected) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  const root = () => Array.from(document.querySelectorAll('.mo-cs')).find(vis) || null;
  const nameOf = (el) => {
    const by = (el.getAttribute('aria-labelledby') || '').split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ').trim();
    return (el.getAttribute('aria-label') || by || el.getAttribute('title') || el.textContent || '').replace(/\s+/g, ' ').trim();
  };
  const CLICKABLE = 'button, [role="button"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="option"], [role="radio"], [role="switch"], [role="checkbox"], a[href], summary';
  const box = (el) => { el.scrollIntoView({ block: 'center', inline: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, left: r.left, top: r.top, w: r.width, h: r.height }; };
  const rgbOf = (css) => { const m = /^rgba?\(([^)]+)\)/.exec(css || ''); if (!m) return null; const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number); return p.length > 3 && p[3] === 0 ? null : p.slice(0, 3).map(Math.round); };
  // The colour an element is painted with: its own background, else its first painted descendant's.
  const paint = (el) => { if (!el) return null; for (const e of [el, ...el.querySelectorAll('*')]) { const c = rgbOf(getComputedStyle(e).backgroundColor); if (c) return c; } return null; };
  const all = (sel, scope) => Array.from((scope || document).querySelectorAll(sel)).filter(vis);
  const clickables = (scope) => all(CLICKABLE, scope);
  // The editor area without its tabs: where a home page's own controls are.
  const editorClickables = () => clickables(document.querySelector('[data-part-id="workbench.parts.editor"]') || document.body).filter((e) => e.getAttribute('role') !== 'tab' && !e.closest('[role="tablist"]'));
  const p = {
    vis, root, nameOf, box, paint, all, clickables, editorClickables, stash: [], seen: new WeakSet(),
    state() { const r = root(); const h = r && r.__moColourStudy; return h && typeof h.state === 'function' ? JSON.parse(JSON.stringify(h.state())) : null; },
    mark() { p.seen = new WeakSet(clickables()); },
    fresh() { p.stash = clickables().filter((e) => !p.seen.has(e)); return p.stash.map((e, i) => ({ i, name: nameOf(e), role: e.getAttribute('role') || e.tagName.toLowerCase() })); },
    // A PNG (base64) as numbers: its mean colour, its centre, how many of twelve hue bands it has, and a coarse signature.
    async decode(b64) {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
      const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(bmp, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height).data, n = c.width * c.height;
      const bands = new Array(12).fill(0), mean = [0, 0, 0];
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, dd = mx - mn;
        mean[0] += d[i]; mean[1] += d[i + 1]; mean[2] += d[i + 2];
        if (dd > 0.12 && l > 0.08 && l < 0.92 && dd / (1 - Math.abs(2 * l - 1)) > 0.25) { let h = mx === r ? ((g - b) / dd) % 6 : mx === g ? (b - r) / dd + 2 : (r - g) / dd + 4; h = (h * 60 + 360) % 360; bands[Math.min(11, Math.floor(h / 30))]++; }
      }
      const at = (fx, fy) => { const cx = Math.floor(c.width * fx), cy = Math.floor(c.height * fy), s = [0, 0, 0]; let k = 0; for (let y = cy - 2; y <= cy + 2; y++) for (let x = cx - 2; x <= cx + 2; x++) { if (x < 0 || y < 0 || x >= c.width || y >= c.height) continue; const i = (y * c.width + x) * 4; s[0] += d[i]; s[1] += d[i + 1]; s[2] += d[i + 2]; k++; } return s.map((v) => Math.round(v / Math.max(1, k))); };
      let sig = '';
      for (let gy = 0; gy < 24; gy++) for (let gx = 0; gx < 24; gx++) { const q = at((gx + 0.5) / 24, (gy + 0.5) / 24); sig += (q[0] >> 4).toString(16) + (q[1] >> 4).toString(16) + (q[2] >> 4).toString(16); }
      return { w: c.width, h: c.height, mean: mean.map((v) => Math.round((v / n) * 10) / 10), centre: at(0.5, 0.5), hues: bands.filter((v) => v > n * 0.004).length, sig };
    },
  };
  window.__csProbe = p;
}
async function boot() {
  ({ app, page, errors } = await launchApp(appRoot));
  await setTool(true);
  await wait(3_000);
  // Studio's drawing and painting tools are behind Atelier's own setting; on, as the owner has it.
  await P(async () => { await window.__parallx_workbench__._services.get({ id: 'IConfigurationService' }).getConfiguration('mediaOrganizer').update('enableArtTools', true); });
  await wait(1_200);
  await P(installHelpers);
}

// Reading the sheet.
const state = async () => { const s = await P(() => window.__csProbe.state()); if (!s) throw new Error('no visible .mo-cs with __moColourStudy.state()'); return s; };
const stateOrNull = () => P(() => window.__csProbe.state()).catch(() => null);
const until = async (fn, ms = 3_000) => { const end = Date.now() + ms; let v; for (;;) { try { v = await fn(); } catch { v = null; } if (v || Date.now() > end) return v; await wait(120); } };
const activeInstance = () => P(() => { const m = window.__parallx_workbench__._services.get({ id: 'IEditorGroupService' })?.activeGroup?.model; const e = m?.editors?.[m.activeIndex] ?? m?.activeEditor; return e ? String(e.instanceId ?? e.id ?? '') : null; });
const ctl = (id) => `[data-px-id="media-organizer.colour.${id}"]`;
// The box of the nth visible match (inside the sheet unless `anywhere`), scrolled into view.
async function boxOf(sel, { nth = 0, anywhere = false } = {}) {
  const b = await P(({ sel, nth, anywhere }) => { const p = window.__csProbe, r = p.root(); if (!anywhere && !r) return { err: 'no visible .mo-cs' }; const el = p.all(sel, anywhere ? document : r)[nth]; return el ? p.box(el) : { err: `not on screen: ${sel}${nth ? ` [${nth}]` : ''}` }; }, { sel, nth, anywhere });
  if (b.err) throw new Error(b.err);
  return b;
}
async function click(sel, opts) { const b = await boxOf(sel, opts); await page.mouse.click(b.x, b.y); await wait(350); return b; }
const clickCtl = (id) => click(ctl(id), { anywhere: true });
const clickStash = async (i) => { const b = await P((i) => { const el = window.__csProbe.stash[i]; return el && window.__csProbe.vis(el) ? window.__csProbe.box(el) : null; }, i); if (!b) throw new Error('the control went away before it could be clicked'); await page.mouse.click(b.x, b.y); await wait(400); };
// A visible control found by its accessible name (ASSUMED wherever the contract gives no id).
async function byName(source, { editor = false } = {}) {
  return P(({ source, editor }) => { const p = window.__csProbe, re = new RegExp(source, 'i'); const el = (editor ? p.editorClickables() : p.clickables()).find((e) => re.test(p.nameOf(e))); return el ? { ...p.box(el), name: p.nameOf(el) } : null; }, { source, editor });
}
// Chooses one option of a control declared with a data-px-id: a child of it named so (a segmented
// switch), a native option, or an item of the menu or list it opens.
async function choose(id, source) {
  const sel = ctl(id);
  const r = await P(({ sel, source }) => {
    const p = window.__csProbe, re = new RegExp(source, 'i'), el = p.all(sel)[0];
    if (!el) return { err: `not on screen: ${sel}` };
    const native = el.tagName === 'SELECT' ? el : el.querySelector('select');
    if (native) { const o = Array.from(native.options).find((x) => re.test(x.textContent.trim())); return o ? { native: o.value } : { err: `no option like /${source}/ in ${sel}`, got: Array.from(native.options).map((x) => x.textContent.trim()) }; }
    const inner = p.clickables(el).find((e) => re.test(p.nameOf(e)));
    if (inner) return { box: p.box(inner) };
    p.mark();
    return { open: p.box(el) };
  }, { sel, source });
  if (r.err) throw new Error(r.err + (r.got ? ` (has ${r.got.join(', ')})` : ''));
  if (r.native !== undefined) { await page.locator(`${sel}:visible, ${sel} select:visible`).first().selectOption(r.native); await wait(400); return 'native'; }
  if (r.box) { await page.mouse.click(r.box.x, r.box.y); await wait(400); return 'segment'; }
  await page.mouse.click(r.open.x, r.open.y); await wait(450);
  const item = await P((source) => { const p = window.__csProbe, re = new RegExp(source, 'i'); const fresh = p.fresh(); const hit = fresh.find((f) => re.test(f.name)); return hit ? { i: hit.i } : { names: fresh.map((f) => f.name).slice(0, 14) }; }, source);
  if (item.i === undefined) { await page.keyboard.press('Escape'); throw new Error(`${sel} opened nothing named like /${source}/ (it offered: ${item.names.join(' | ') || 'nothing'})`); }
  await clickStash(item.i);
  return 'menu';
}
const pressedOf = (id) => P((sel) => { const el = window.__csProbe.all(sel)[0]; if (!el) return null; const inner = el.matches('input') ? el : el.querySelector('input[type="checkbox"]'); return el.getAttribute('aria-pressed') ?? el.getAttribute('aria-checked') ?? (inner ? String(inner.checked) : null); }, ctl(id));
// The picture of a rectangle of the window, as numbers.
async function pixels(b) {
  const clip = { x: Math.max(0, Math.floor(b.left)), y: Math.max(0, Math.floor(b.top)), width: Math.max(1, Math.floor(b.w)), height: Math.max(1, Math.floor(b.h)) };
  let buf;
  try { buf = await page.screenshot({ clip, timeout: 8_000 }); } catch {
    const b64 = await app.evaluate(async ({ BrowserWindow }, rect) => { const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed()); return w ? (await w.webContents.capturePage(rect)).toPNG().toString('base64') : null; }, clip);
    if (!b64) throw new Error('no frame could be captured');
    buf = Buffer.from(b64, 'base64');
  }
  return P((b64) => window.__csProbe.decode(b64), buf.toString('base64'));
}
async function shot(name, sel) {
  if (sel) await boxOf(sel); // only a surface that is on screen is a screenshot of it
  const file = path.join(shots, `${name}.png`);
  try { await page.screenshot({ path: file, timeout: 8_000 }); } catch {
    const b64 = await app.evaluate(async ({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed()); return w ? (await w.webContents.capturePage()).toPNG().toString('base64') : null; });
    if (!b64) throw new Error('no frame could be captured');
    await fs.writeFile(file, Buffer.from(b64, 'base64'));
  }
  return file;
}
const wheelBox = async () => {
  const b = await P(() => { const p = window.__csProbe, r = p.root(); if (!r) return { err: 'no visible .mo-cs' }; const w = r.querySelector('.mo-cs-wheel'); if (!w) return { err: 'no .mo-cs-wheel' }; const c = w.tagName === 'CANVAS' ? w : w.querySelector('canvas'); if (!c) return { err: 'no canvas in .mo-cs-wheel' }; return { ...p.box(c), cw: c.width, ch: c.height, vis: p.vis(c) }; });
  if (b.err) throw new Error(b.err);
  return b;
};
// Puts the keyboard on a dot of the wheel: a click on it, and the element's own focus if the click left it elsewhere.
async function focusDot(n = 0) {
  const b = await boxOf('.mo-cs-dot', { nth: n });
  await page.mouse.click(b.x, b.y); await wait(250);
  const on = await P((n) => { const p = window.__csProbe, d = p.all('.mo-cs-dot', p.root())[n]; if (!d) return false; if (document.activeElement !== d && !d.contains(document.activeElement)) d.focus(); return document.activeElement === d || d.contains(document.activeElement); }, n);
  if (!on) throw new Error('a dot of the wheel cannot take the keyboard focus');
}
const press = async (key, times = 1) => { for (let i = 0; i < times; i++) { await page.keyboard.press(key); await wait(70); } await wait(350); };
const activeHex = (s) => s.colours[s.active];
const recipeKey = (s) => JSON.stringify([s.recipe?.paints?.map((p) => [p.name, p.parts]), s.recipe?.hex, s.recipe?.de]);
const paintedOf = (sel, nth = 0) => P(({ sel, nth }) => { const p = window.__csProbe, r = p.root(); const el = r && p.all(sel, r)[nth]; return el ? p.paint(el) : null; }, { sel, nth });
const textOf = (sel, nth = 0) => P(({ sel, nth }) => { const p = window.__csProbe, r = p.root(); const el = r && p.all(sel, r)[nth]; return el ? (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim() : null; }, { sel, nth });
const countOf = (sel) => P((sel) => { const p = window.__csProbe, r = p.root(); return r ? p.all(sel, r).length : -1; }, sel);
// Turns the set until the active colour's recipe has at least two paints (a mix worth editing).
async function mixedRecipe() {
  let s = await state();
  for (let i = 0; i < 24 && !(s.recipe?.paints?.length >= 2); i++) { await focusDot(s.active); await press('ArrowRight', 5); s = await state(); }
  if (!(s.recipe?.paints?.length >= 2)) throw new Error('no colour on the wheel has a recipe of two paints');
  return s;
}
// Opens a sheet from the Colour Study home by its title, as a person would.
// ASSUMED: the home lists each sheet as a control whose accessible name contains the sheet's title.
async function openSheet(id, title) {
  const there = await stateOrNull();
  if (there && String(there.sheetId) === String(id)) return there;
  if (!title) throw new Error('the sheet has no title to find it by on the home');
  for (let i = 0; i < 6; i++) {
    const home = await run('media-organizer.colourStudy');
    if (!home.ok) throw new Error(home.error);
    await wait(900);
    const found = await P(({ title, i }) => { const p = window.__csProbe; const hits = p.editorClickables().filter((e) => p.nameOf(e).toLowerCase().includes(title.toLowerCase()) && !/\b(rename|delete|remove)\b/i.test(p.nameOf(e))); return hits[i] ? p.box(hits[i]) : { none: hits.length }; }, { title, i });
    if (found.none !== undefined) throw new Error(`the home shows ${found.none} control(s) named for the sheet "${title}"; none opened sheet ${id}`);
    await page.mouse.click(found.x, found.y);
    let s = await until(async () => { const x = await stateOrNull(); return x && String(x.sheetId) === String(id) ? x : null; }, 2_000);
    if (!s && !(await stateOrNull())) { await page.mouse.dblclick(found.x, found.y); s = await until(async () => { const x = await stateOrNull(); return x && String(x.sheetId) === String(id) ? x : null; }, 2_000); }
    if (s) { await wait(600); return s; }
  }
  throw new Error(`could not open sheet ${id} from the home`);
}
async function openAtelierSidebar() {
  await P(() => { const b = document.querySelector('[data-px-id="activitybar.media-organizer-container"]') || Array.from(document.querySelectorAll('.activity-bar-item')).find((x) => Array.from(x.attributes).some((a) => /media.?organizer/i.test(a.value))); if (b && b.getAttribute('aria-selected') !== 'true') b.click(); });
  await page.waitForSelector('.mo-sidebar-item', { timeout: 10_000 });
  await wait(600);
}
// Removes a paint from the list through the page. ASSUMED: My Paints (`.myPaints`) shows the list, and a
// paint leaves it by a control named "Remove <paint>" (as Painting Plans has it), or by the documented
// `.tubeOn.<slug>` or `.dropPaint.<slug>`. The one that takes the paint out of state.paints is used.
async function removePaint(name) {
  const tries = [
    ['a control named Remove', () => byName(`^(remove|delete)\\b.*${esc(name)}`)],
    ['tubeOn', () => boxOf(ctl(`tubeOn.${slug(name)}`), { anywhere: true }).catch(() => null)],
    ['dropPaint', () => boxOf(ctl(`dropPaint.${slug(name)}`), { anywhere: true }).catch(() => null)],
  ];
  const attempt = async () => {
    for (const [how, find] of tries) {
      const b = await find();
      if (!b) continue;
      await page.mouse.click(b.x, b.y); await wait(600);
      if ((await state()).paints.some((p) => flat(p) === flat(name))) { // a question before it goes
        const ask = await byName('^(remove|delete|ok|yes)$');
        if (ask) { await page.mouse.click(ask.x, ask.y); await wait(500); }
      }
      if (!(await state()).paints.some((p) => flat(p) === flat(name))) return how;
    }
    return null;
  };
  let how = await attempt();
  if (!how) { await clickCtl('myPaints'); await wait(600); how = await attempt(); }
  if (!how) throw new Error(`nothing on the page took ${name} out of the paint list (My Paints, Remove ${name}, tubeOn, dropPaint)`);
  await wait(500);
  return how;
}
// Saves the paints in use as a named set. ASSUMED: a control named like "Save As Set…" / "Save Set…" /
// "New Set…" is in My Paints or in what `.paintSet` opens; it asks for the name in a text field that
// takes the focus, and Enter confirms.
async function saveSetAs(name) {
  const NAME = '(save.*\\bset\\b|save as|new set|add set)';
  let b = await byName(NAME);
  if (!b) { await clickCtl('myPaints'); await wait(600); b = await byName(NAME); }
  if (!b) { await clickCtl('paintSet'); await wait(500); b = await byName(NAME); }
  if (!b) throw new Error('no control named like Save As Set… in My Paints or under the paint set control');
  await page.mouse.click(b.x, b.y); await wait(600);
  const field = await P(() => { const a = document.activeElement; return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA'); });
  if (!field) throw new Error(`"${b.name}" did not put the focus in a text field for the set's name`);
  await page.keyboard.press('Control+a');
  await page.keyboard.type(name);
  await page.keyboard.press('Enter');
  await wait(800);
}
async function switchSet(name) {
  if (!(await boxOf(ctl('paintSet'), { anywhere: true }).catch(() => null))) { await clickCtl('myPaints'); await wait(600); }
  await choose('paintSet', esc(name));
  await wait(700);
}

// ── The run ──────────────────────────────────────────────────────────────────
console.log(`[colour-study] ext: ${EXT}`);
let seeded = null, sheetA = null, titleA = '', finalA = null, dbAfter = null, benchShot = false, pictureShot = false, sheetShot = false;
try {
  seeded = await seed();
  await boot();
} catch (e) {
  console.log(`[colour-study] the app did not start: ${e?.stack || e}`);
}
const up = !!page;

// 1. Where it lives and how it opens ─────────────────────────────────────────
await t('1.1 Studio in Atelier\'s sidebar has the item "Colour Study"', async () => {
  await openAtelierSidebar();
  const got = await P(() => Array.from(document.querySelectorAll('.mo-sidebar-section')).map((s) => ({ title: s.querySelector('.mo-sidebar-section-title')?.textContent || '', items: Array.from(s.querySelectorAll('.mo-sidebar-item-label')).filter(window.__csProbe.vis).map((l) => l.textContent) })));
  const studio = got.find((s) => /^studio$/i.test(s.title.trim()));
  return [!!studio && studio.items.includes('Colour Study'), studio ? studio.items : got.map((s) => s.title)];
});
await t('1.2 a click on that item opens the Colour Study home (instance colour:list)', async () => {
  const b = await P(() => { const p = window.__csProbe; const sec = Array.from(document.querySelectorAll('.mo-sidebar-section')).find((s) => /^studio$/i.test((s.querySelector('.mo-sidebar-section-title')?.textContent || '').trim())); const l = sec && Array.from(sec.querySelectorAll('.mo-sidebar-item-label')).find((x) => p.vis(x) && x.textContent === 'Colour Study'); return l ? p.box(l.closest('.mo-sidebar-item') || l) : null; });
  if (!b) throw new Error('no Colour Study item to click');
  await page.mouse.click(b.x, b.y);
  const inst = await until(async () => ((await activeInstance()) === 'colour:list' ? 'colour:list' : null), 4_000);
  return [inst === 'colour:list', await activeInstance()];
});
await t('1.3 the command media-organizer.colourStudy opens the home from another tab', async () => {
  await run('media-organizer.paintingPlans'); await wait(800);
  const before = await activeInstance();
  const r = await run('media-organizer.colourStudy'); await wait(900);
  const inst = await activeInstance();
  return [r.ok && before !== 'colour:list' && inst === 'colour:list', { command: r, before, after: inst }];
});
let sheetB = null;
await t('1.4 the home itself can make a sheet: a control named New… opens one (ASSUMED name)', async () => {
  if ((await activeInstance()) !== 'colour:list') throw new Error('the home is not open');
  const b = await byName('^new\\b', { editor: true });
  if (!b) throw new Error('no control named New… on the home');
  await page.mouse.click(b.x, b.y);
  const s = await until(stateOrNull, 4_000);
  sheetB = s ? s.sheetId : null;
  return [!!s && s.sheetId != null && (await activeInstance()) === `colour:sheet:${s.sheetId}`, { control: b.name, sheet: s && s.sheetId, instance: await activeInstance() }];
});
await t('1.5 media-organizer.colour.newSheet returns a new id and opens that sheet (.mo-cs)', async () => {
  const r = await run('media-organizer.colour.newSheet');
  if (!r.ok) throw new Error(r.error);
  const s = await until(async () => { const x = await stateOrNull(); return x && String(x.sheetId) === String(r.value) ? x : null; }, 5_000);
  if (s) { sheetA = s.sheetId; titleA = s.title; }
  await wait(800);
  return [r.value != null && !!s && (await activeInstance()) === `colour:sheet:${r.value}`, { returned: r.value, onScreen: (await stateOrNull())?.sheetId ?? null, instance: await activeInstance() }];
});
await t('1.6 made twice, the two sheets are two sheets (different ids)', async () => {
  const s = await state();
  return [sheetB != null && sheetA != null && String(sheetA) !== String(sheetB) && String(s.sheetId) === String(sheetA), { first: sheetB, second: sheetA }];
});
await t('1.7 the new sheet stands on the wheel: no picture, no plan, nothing asked', async () => {
  const s = await state();
  const pic = await countOf('.mo-cs-picture'), wheel = await countOf('.mo-cs-wheel');
  const dialog = await P(() => window.__csProbe.all('[role="dialog"], [role="alertdialog"]').length);
  return [s.source === 'wheel' && pic === 0 && wheel === 1 && dialog === 0 && typeof s.title === 'string' && s.title.trim().length > 0, { source: s.source, picture: pic, wheel, dialogs: dialog, title: s.title }];
});

// 2. What the sheet shows ────────────────────────────────────────────────────
await t('2.1 the wheel is a canvas with a width and a height, on screen', async () => {
  const b = await wheelBox();
  return [b.vis && b.cw > 0 && b.ch > 0 && b.w >= 120 && b.h >= 120, { canvas: [b.cw, b.ch], box: [Math.round(b.w), Math.round(b.h)] }];
});
await t('2.2 the wheel is drawn: its pixels carry at least six of twelve hue bands', async () => {
  const px = await pixels(await wheelBox());
  return [px.hues >= 6, { hueBands: px.hues, mean: px.mean }];
});
await t('2.3 one dot per colour, each a named slider numbered 1 to N, the set reachable by Tab', async () => {
  const s = await state();
  const dots = await P(() => { const p = window.__csProbe; return p.all('.mo-cs-dot', p.root()).map((d) => ({ role: d.getAttribute('role'), tab: d.tabIndex, text: (d.textContent || '').trim(), name: d.getAttribute('aria-label') || '' })); });
  const ok = s.colours.length >= 2 && dots.length === s.colours.length && dots.some((d) => d.tab >= 0) && dots.every((d, i) => d.role === 'slider' && d.text.includes(String(i + 1)) && d.name.trim().length > 0);
  return [ok, { colours: s.colours.length, dots }];
});
await t('2.4 the colours are hex, the active one is among them, and they sit on the harmony named', async () => {
  const s = await state();
  const ok = Array.isArray(s.colours) && s.colours.every((c) => !!hexRgb(c)) && Number.isInteger(s.active) && s.active >= 0 && s.active < s.colours.length && ['painter', 'screen'].includes(s.wheel) && onHarmony(s.colours, s.harmony, s.wheel);
  return [ok, { colours: s.colours, active: s.active, harmony: s.harmony, wheel: s.wheel }];
});
await t('2.5 the paints in use are the shared list (the eight seeded in plan_paints_v1, the probe\'s own tube among them)', async () => {
  const s = await state();
  return [Array.isArray(s.paints) && sameSet(s.paints, SEEDED_PAINTS.map((p) => p.name)), s.paints];
});
await t('2.6 the recipe uses only paints from the list, each with parts and a role', async () => {
  const s = await state();
  const r = s.recipe?.paints || [];
  const ok = r.length >= 1 && r.every((p) => s.paints.some((n) => flat(n) === flat(p.name)) && Number(p.parts) > 0 && typeof p.role === 'string' && p.role.trim().length > 0);
  return [ok, r];
});
await t('2.7 the recipe has a closeness word and a measure, and its mix is a colour', async () => {
  const r = (await state()).recipe || {};
  return [typeof r.closeness === 'string' && r.closeness.trim().length > 0 && Number.isFinite(Number(r.de)) && r.de !== null && !!hexRgb(r.hex), { closeness: r.closeness, de: r.de, hex: r.hex }];
});
await t('2.8 the card shows the recipe: every paint by name, its role hint, and the closeness word', async () => {
  const s = await state();
  const card = await P(() => { const p = window.__csProbe, c = p.all('.mo-cs-card', p.root())[0]; if (!c) return null; return [c.innerText, ...Array.from(c.querySelectorAll('[title], [aria-label]')).map((e) => (e.getAttribute('title') || '') + ' ' + (e.getAttribute('aria-label') || ''))].join(' ').replace(/\s+/g, ' ').toLowerCase(); });
  if (card == null) throw new Error('no .mo-cs-card on screen');
  const has = (x) => card.includes(String(x).replace(/\s+/g, ' ').trim().toLowerCase());
  const missing = [...s.recipe.paints.flatMap((p) => [has(p.name) ? null : `name ${p.name}`, has(p.role) ? null : `role of ${p.name}`]), has(s.recipe.closeness) ? null : `closeness ${s.recipe.closeness}`].filter(Boolean);
  return [s.recipe.paints.length >= 1 && missing.length === 0, { missing, card: card.slice(0, 200) }];
});
await t('2.9 target and mix sit on the ground: the target is the active colour, the mix is the recipe\'s', async () => {
  const s = await state();
  const inGround = await P(() => { const p = window.__csProbe, g = p.all('.mo-cs-card .mo-cs-ground', p.root())[0]; return !!g && p.all('.mo-cs-target', g).length === 1 && p.all('.mo-cs-mix', g).length === 1 && !!p.paint(g); });
  const target = await paintedOf('.mo-cs-target'), mix = await paintedOf('.mo-cs-mix');
  return [inGround && near(target, hexRgb(activeHex(s))) && near(mix, hexRgb(s.recipe.hex)), { inGround, target, active: activeHex(s), mix, recipe: s.recipe.hex }];
});
await t('2.10 a palette row per colour, each with a lightness bar that is a named slider', async () => {
  const s = await state();
  const rows = await P(() => { const p = window.__csProbe; return p.all('.mo-cs-pal-row', p.root()).map((r) => { const v = p.all('.mo-cs-vbar', r)[0]; return v ? { role: v.getAttribute('role'), now: v.getAttribute('aria-valuenow'), min: v.getAttribute('aria-valuemin'), max: v.getAttribute('aria-valuemax'), name: p.nameOf(v), tab: v.tabIndex } : null; }); });
  const ok = rows.length === s.colours.length && rows.every((v) => v && v.role === 'slider' && v.tab >= 0 && v.name.length > 0 && [v.now, v.min, v.max].every((x) => x !== null && Number.isFinite(Number(x))) && Number(v.min) < Number(v.max));
  return [ok, rows];
});
await t('2.11 Copy Recipe puts the recipe\'s paints on the clipboard', async () => {
  const s = await state();
  await app.evaluate(({ clipboard }) => clipboard.writeText('colour-study-probe: nothing copied yet'));
  await clickCtl('copyRecipe'); await wait(500);
  const text = await app.evaluate(({ clipboard }) => clipboard.readText());
  return [s.recipe.paints.length >= 1 && s.recipe.paints.every((p) => text.toLowerCase().includes(p.name.toLowerCase())) && /\d/.test(text), text.slice(0, 200)];
});
await t('10.1 a screenshot of the sheet', async () => { const f = await shot('colour-study-sheet', '.mo-cs-wheel'); sheetShot = true; return [true, f]; });

// 3. The keyboard ────────────────────────────────────────────────────────────
await t('3.1 ArrowRight on a dot turns the set: every colour\'s hue moves and the harmony holds', async () => {
  const a = await state();
  await focusDot(a.active);
  await press('ArrowRight', 6);
  const b = await state();
  const moved = a.colours.map((c, i) => angDiff(hsl(hexRgb(c))[0], hsl(hexRgb(b.colours[i]))[0]));
  return [b.colours.length === a.colours.length && moved.every((d) => d >= 1) && onHarmony(b.colours, b.harmony, b.wheel), { before: a.colours, after: b.colours, moved: moved.map((d) => Math.round(d)) }];
});
await t('3.2 the recipe and the card follow the turned colour', async () => {
  const a = await state();
  await focusDot(a.active);
  await press('ArrowLeft', 9);
  const b = await state();
  const target = await paintedOf('.mo-cs-target'), mix = await paintedOf('.mo-cs-mix');
  return [activeHex(a) !== activeHex(b) && recipeKey(a) !== recipeKey(b) && near(target, hexRgb(activeHex(b))) && near(mix, hexRgb(b.recipe.hex)), { was: [activeHex(a), a.recipe?.hex, a.recipe?.de], now: [activeHex(b), b.recipe?.hex, b.recipe?.de], target, mix }];
});
await t('3.3 ArrowDown on a dot lowers the colour\'s strength, ArrowUp raises it', async () => {
  const a = await state();
  await focusDot(a.active);
  await press('ArrowDown', 5);
  const b = await state();
  await press('ArrowUp', 3);
  const c = await state();
  const sat = (s) => hsl(hexRgb(activeHex(s)))[1];
  return [sat(b) < sat(a) - 0.005 && sat(c) > sat(b) + 0.005, { start: sat(a).toFixed(3), afterDown: sat(b).toFixed(3), afterUp: sat(c).toFixed(3) }];
});
await t('3.4 key 2 chooses colour 2 and key 1 colour 1; the card follows', async () => {
  const a = await state();
  await focusDot(a.active);
  await press('2');
  const b = await state();
  const targetB = await paintedOf('.mo-cs-target');
  await press('1');
  const c = await state();
  const targetC = await paintedOf('.mo-cs-target');
  return [b.active === 1 && c.active === 0 && near(targetB, hexRgb(b.colours[1])) && near(targetC, hexRgb(c.colours[0])) && b.colours[0] !== b.colours[1], { after2: b.active, after1: c.active, targetB, targetC, colours: c.colours }];
});
await t('3.5 the lightness bar moves with the arrow keys: Left darkens the colour, Right lightens it', async () => {
  const a = await state();
  const focus = (n) => P((n) => { const p = window.__csProbe, row = p.all('.mo-cs-pal-row', p.root())[n], v = row && p.all('.mo-cs-vbar', row)[0]; if (!v) return null; v.scrollIntoView({ block: 'center' }); v.focus(); return document.activeElement === v ? Number(v.getAttribute('aria-valuenow')) : null; }, n);
  const now = () => P(() => { const v = document.activeElement; return v && v.classList.contains('mo-cs-vbar') ? Number(v.getAttribute('aria-valuenow')) : null; });
  const v0 = await focus(a.active);
  if (v0 === null) throw new Error('the active row\'s .mo-cs-vbar cannot take the focus');
  await press('ArrowLeft', 8);
  const b = await state(), v1 = await now();
  await press('ArrowRight', 5);
  const c = await state(), v2 = await now();
  const L = (s) => value(hexRgb(s.colours[a.active]));
  return [v1 < v0 && v2 > v1 && L(b) < L(a) - 0.05 && L(c) > L(b) + 0.03, { bar: [v0, v1, v2], value: [L(a), L(b), L(c)].map((x) => x.toFixed(2)) }];
});
await t('3.6 the wheel is drawn at the active colour\'s lightness: darker colour, darker wheel', async () => {
  const a = await state();
  const lum = (m) => 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2];
  const before = await pixels(await wheelBox());
  await P((n) => { const p = window.__csProbe, row = p.all('.mo-cs-pal-row', p.root())[n]; p.all('.mo-cs-vbar', row)[0].focus(); }, a.active);
  await press('ArrowLeft', 12);
  const dark = await pixels(await wheelBox());
  await press('ArrowRight', 12);
  const back = await pixels(await wheelBox());
  return [lum(dark.mean) < lum(before.mean) - 1.5 && lum(back.mean) > lum(dark.mean) + 1.5, { before: lum(before.mean).toFixed(1), darker: lum(dark.mean).toFixed(1), back: lum(back.mean).toFixed(1) }];
});

// 4. The controls above the wheel ────────────────────────────────────────────
// ASSUMED: the harmony options are named in words (Triadic, Square, Complementary…) and the wheel
// models Painter and Screen, as the contract names them; state.harmony holds MO_HARMONIES' key.
await t('4.1 choosing Triadic makes three colours and three dots, 120 degrees apart on the wheel in use', async () => {
  const how = await choose('harmony', '^triadic');
  const s = await state();
  return [s.harmony === 'triadic' && s.colours.length === 3 && (await countOf('.mo-cs-dot')) === 3 && (await countOf('.mo-cs-pal-row')) === 3 && onHarmony(s.colours, 'triadic', s.wheel), { how, harmony: s.harmony, colours: s.colours, wheel: s.wheel }];
});
await t('4.2 key 3 now chooses the third colour', async () => {
  await focusDot(0);
  await press('3');
  const s = await state();
  await press('1');
  return [s.active === 2, s.active];
});
await t('4.3 the wheel model: Screen then Painter change state.wheel, and the set keeps its harmony on each', async () => {
  await choose('wheelModel', '^screen');
  const a = await state();
  await choose('wheelModel', '^painter');
  const b = await state();
  return [a.wheel === 'screen' && onHarmony(a.colours, a.harmony, 'screen') && b.wheel === 'painter' && onHarmony(b.colours, b.harmony, 'painter') && JSON.stringify(a.colours) !== JSON.stringify(b.colours), { screen: [a.wheel, a.colours], painter: [b.wheel, b.colours] }];
});
await t('4.4 the wheel is redrawn for the model (its pixels differ between Painter and Screen)', async () => {
  const painter = await pixels(await wheelBox());
  await choose('wheelModel', '^screen');
  const screen = await pixels(await wheelBox());
  await choose('wheelModel', '^painter');
  return [painter.sig !== screen.sig && (await state()).wheel === 'painter', { same: painter.sig === screen.sig }];
});
await t('4.5 the hatch toggle changes state.hatch, and hatching is drawn on the wheel while it is on', async () => {
  const a = await state();
  const pa = await pixels(await wheelBox());
  await clickCtl('hatch');
  const b = await state();
  const pb = await pixels(await wheelBox());
  await clickCtl('hatch');
  const c = await state();
  return [typeof a.hatch === 'boolean' && b.hatch === !a.hatch && c.hatch === a.hatch && pa.sig !== pb.sig, { hatch: [a.hatch, b.hatch, c.hatch], wheelChanged: pa.sig !== pb.sig }];
});
// ASSUMED (the marker's name is open): with Value Check on, the root carries a class or data attribute
// with "grey", "gray" or "value" in it that it does not carry when off.
await t('4.6 Value Check sets state.valueCheck and marks the root', async () => {
  const marks = () => P(() => { const r = window.__csProbe.root(); return r ? [...r.classList, ...Object.entries(r.dataset).map(([k, v]) => `data-${k}=${v}`)] : null; });
  const a = await state(), ma = await marks();
  await clickCtl('valueCheck');
  const b = await state(), mb = await marks();
  const added = (mb || []).filter((m) => !(ma || []).includes(m));
  return [a.valueCheck === false && b.valueCheck === true && added.some((m) => /gr[ae]y|value/i.test(m)), { before: a.valueCheck, after: b.valueCheck, added }];
});
await t('4.7 with Value Check on, the colours are seen in grey (the target swatch on screen has no hue)', async () => {
  const s = await state();
  if (s.valueCheck !== true) throw new Error('Value Check is not on');
  if (hsl(hexRgb(activeHex(s)))[1] < 0.15) throw new Error('the active colour is already grey; nothing to see');
  const px = (await pixels(await boxOf('.mo-cs-target'))).centre;
  return [Math.max(...px) - Math.min(...px) <= 10, { seen: px, colour: activeHex(s) }];
});
await t('4.8 Value Check off again: state and the colour on screen come back', async () => {
  await clickCtl('valueCheck');
  const s = await state();
  const px = (await pixels(await boxOf('.mo-cs-target'))).centre;
  return [s.valueCheck === false && near(px, hexRgb(activeHex(s)), 14), { valueCheck: s.valueCheck, seen: px, colour: activeHex(s) }];
});

// 5. The rows ────────────────────────────────────────────────────────────────
const ROWS = ['value', 'light', 'tone', 'temp', 'twins'];
await t('5.1 five rows (value, light, tone, temp, twins), each with the cells state.rows names', async () => {
  const s = await state();
  const dom = await P(() => { const p = window.__csProbe; return Object.fromEntries(p.all('.mo-cs-row[data-row]', p.root()).map((r) => [r.getAttribute('data-row'), p.all('.mo-cs-cell', r).map((c) => c.tagName + (c.getAttribute('role') ? ':' + c.getAttribute('role') : ''))])); });
  const ok = ROWS.every((k) => Array.isArray(s.rows?.[k]) && s.rows[k].length >= 3 && s.rows[k].every((c) => !!hexRgb(c)) && dom[k] && dom[k].length === s.rows[k].length && dom[k].every((c) => /^BUTTON|:button$/.test(c)));
  return [ok && Object.keys(dom).length === 5, { state: Object.fromEntries(ROWS.map((k) => [k, s.rows?.[k]?.length])), page: Object.fromEntries(Object.entries(dom).map(([k, v]) => [k, v.length])) }];
});
await t('5.2 every row has its one-line explanation', async () => {
  const notes = await P(() => { const p = window.__csProbe; return Object.fromEntries(p.all('.mo-cs-row[data-row]', p.root()).map((r) => [r.getAttribute('data-row'), (p.all('.mo-cs-row-note', r)[0]?.innerText || '').replace(/\s+/g, ' ').trim()])); });
  return [ROWS.every((k) => (notes[k] || '').length >= 12) && new Set(ROWS.map((k) => notes[k])).size === 5, notes];
});
await t('5.3 the value row climbs: each cell lighter than the one before', async () => {
  const v = (await state()).rows.value.map((c) => value(hexRgb(c)));
  return [v.length >= 3 && v.every((x, i) => i === 0 || x > v[i - 1] - 0.02) && v[v.length - 1] - v[0] >= 3, v.map((x) => x.toFixed(2))];
});
await t('5.4 the cells are painted with the row\'s colours', async () => {
  const s = await state();
  const got = await P(() => { const p = window.__csProbe; return Object.fromEntries(p.all('.mo-cs-row[data-row]', p.root()).map((r) => [r.getAttribute('data-row'), p.all('.mo-cs-cell', r).map((c) => p.paint(c))])); });
  const bad = ROWS.flatMap((k) => (s.rows[k] || []).map((c, i) => (near(got[k]?.[i], hexRgb(c), 3) ? null : `${k}[${i}] ${c} seen ${got[k]?.[i]}`))).filter(Boolean);
  return [bad.length === 0 && ROWS.every((k) => s.rows[k]?.length), bad.slice(0, 6)];
});
await t('5.5 value twins: the same value, different colours', async () => {
  const tw = (await state()).rows.twins.map(hexRgb);
  const v = tw.map(value);
  return [tw.length >= 3 && Math.max(...v) - Math.min(...v) <= 0.75 && new Set(tw.map(String)).size === tw.length, v.map((x) => x.toFixed(2))];
});
// ASSUMED: `.mo-cs-why` is a <details>, or holds (or is) a button with aria-expanded.
await t('5.6 every row\'s Why opens to an explanation', async () => {
  const out = {};
  for (const k of ROWS) {
    const b = await P((k) => { const p = window.__csProbe, row = p.all(`.mo-cs-row[data-row="${k}"]`, p.root())[0], w = row && p.all('.mo-cs-why', row)[0]; if (!w) return null; const t = w.matches('summary, button, [role="button"]') ? w : w.querySelector('summary, button, [role="button"], [aria-expanded]') || w; return { ...p.box(t), len: document.body.innerText.length }; }, k);
    if (!b) { out[k] = 'no .mo-cs-why'; continue; }
    await page.mouse.click(b.x, b.y); await wait(400);
    out[k] = await P(({ k, len }) => { const p = window.__csProbe, row = p.all(`.mo-cs-row[data-row="${k}"]`, p.root())[0], w = row && row.querySelector('.mo-cs-why'); if (!w) return 'gone'; const open = (w.matches('details') ? w : w.querySelector('details'))?.open === true || [w, ...w.querySelectorAll('[aria-expanded]')].some((e) => e.getAttribute('aria-expanded') === 'true'); return { open, grew: document.body.innerText.length - len }; }, { k, len: b.len });
  }
  return [ROWS.every((k) => out[k] && out[k].open === true && out[k].grew >= 20), out];
});
await t('5.7 a click on a cell shows that colour in the card and leaves the base alone', async () => {
  const a = await state();
  const i = a.rows.tone.findIndex((c) => !a.colours.some((x) => nearHex(x, c, 6)) && !nearHex(String(a.base), c, 6));
  if (i < 0) throw new Error('no tone cell differs from the palette');
  await click('.mo-cs-row[data-row="tone"] .mo-cs-cell', { nth: i });
  await wait(500);
  const b = await state();
  const target = await paintedOf('.mo-cs-target');
  const card = (await textOf('.mo-cs-card')) || '';
  return [near(target, hexRgb(a.rows.tone[i])) && card.toUpperCase().includes(normHex(a.rows.tone[i])) && JSON.stringify(b.base) === JSON.stringify(a.base), { cell: a.rows.tone[i], target, hexInCard: card.toUpperCase().includes(normHex(a.rows.tone[i])), base: [a.base, b.base] }];
});
await t('5.8 a double click on a cell makes it the base (state.base), and the rows are worked from it', async () => {
  const a = await state();
  const i = a.rows.temp.findIndex((c) => !a.colours.some((x) => nearHex(x, c, 6)) && !nearHex(String(a.base), c, 6));
  if (i < 0) throw new Error('no temp cell differs from the palette');
  const cell = a.rows.temp[i];
  const b0 = await boxOf('.mo-cs-row[data-row="temp"] .mo-cs-cell', { nth: i });
  await page.mouse.dblclick(b0.x, b0.y); await wait(800);
  const b = await state();
  const isBase = typeof b.base === 'number' ? nearHex(b.colours[b.base], cell) : nearHex(String(b.base), cell);
  return [isBase && JSON.stringify(b.base) !== JSON.stringify(a.base) && b.colours.some((c) => nearHex(c, cell)) && JSON.stringify(b.rows.value) !== JSON.stringify(a.rows.value), { cell, baseWas: a.base, baseNow: b.base, colours: b.colours }];
});
await t('5.9 the light toggle (Warm Light, Cool Light) changes state.light and the light row', async () => {
  const a = await state();
  await choose('lightKind', a.light === 'cool' ? '^warm' : '^cool');
  const b = await state();
  await choose('lightKind', a.light === 'cool' ? '^cool' : '^warm');
  const c = await state();
  return [['warm', 'cool'].includes(a.light) && b.light !== a.light && ['warm', 'cool'].includes(b.light) && JSON.stringify(b.rows.light) !== JSON.stringify(a.rows.light) && c.light === a.light && JSON.stringify(c.rows.light) === JSON.stringify(a.rows.light), { light: [a.light, b.light, c.light], rowChanged: JSON.stringify(b.rows.light) !== JSON.stringify(a.rows.light) }];
});
await t('5.10 the twins have their own greyscale: on, the twins are seen grey while the tone row keeps its colour', async () => {
  const s = await state();
  const pick = (row) => s.rows[row].map((c, i) => [hsl(hexRgb(c))[1] * (1 - Math.abs(2 * hsl(hexRgb(c))[2] - 1)), i]).sort((x, y) => y[0] - x[0])[0][1];
  const ti = pick('twins'), oi = pick('tone');
  const seen = async (row, i) => (await pixels(await boxOf(`.mo-cs-row[data-row="${row}"] .mo-cs-cell`, { nth: i }))).centre;
  const spread = (c) => Math.max(...c) - Math.min(...c);
  const before = await seen('twins', ti), pressedBefore = await pressedOf('twinsGrey');
  await clickCtl('twinsGrey');
  const on = await seen('twins', ti), tone = await seen('tone', oi), pressedOn = await pressedOf('twinsGrey');
  const mid = await state();
  await clickCtl('twinsGrey');
  const off = await seen('twins', ti);
  return [spread(before) > 30 && spread(on) <= 10 && spread(tone) > 30 && spread(off) > 30 && mid.valueCheck === false && pressedBefore !== pressedOn, { twinBefore: before, twinGrey: on, toneMeanwhile: tone, twinAfter: off, pressed: [pressedBefore, pressedOn] }];
});

// 6. Edit Mix ────────────────────────────────────────────────────────────────
let benchBase = null; // the state when the bench opened
const tubes = () => P(() => { const p = window.__csProbe, b = p.all('.mo-cs-bench', p.root())[0]; return b ? p.all('.mo-cs-tube[data-paint]', b).map((tb) => ({ paint: tb.getAttribute('data-paint'), parts: (p.all('.mo-cs-parts', tb)[0]?.textContent || '').trim() })) : null; });
const partsOf = (s, name) => { const m = (s.mix || []).find((x) => flat(x.name) === flat(name)); return m ? Number(m.parts) : 0; };
await t('6.1 Edit Mix opens the bench with one tube row per paint of the recipe, at the recipe\'s parts', async () => {
  const a = await mixedRecipe();
  await clickCtl('editMix'); await wait(600);
  const s = await state();
  const tb = await tubes();
  if (!tb) throw new Error('no .mo-cs-bench on screen');
  benchBase = s;
  const ok = tb.length === s.recipe.paints.length && s.recipe.paints.every((p) => tb.some((x) => flat(x.paint) === flat(p.name) && x.parts.includes(String(p.parts)))) && Array.isArray(s.mix) && s.mix.length === s.recipe.paints.length && s.recipe.paints.every((p) => partsOf(s, p.name) === Number(p.parts)) && recipeKey(a) === recipeKey(s);
  return [ok, { recipe: s.recipe.paints.map((p) => [p.name, p.parts]), tubes: tb, mix: s.mix }];
});
await t('10.2 a screenshot of the bench', async () => { const f = await shot('colour-study-bench', '.mo-cs-bench'); benchShot = true; return [true, f]; });
await t('6.2 "more" on a tube raises that paint\'s parts and the predicted mix changes colour', async () => {
  const a = await state();
  const name = a.recipe.paints[0].name;
  const mixA = await paintedOf('.mo-cs-mix');
  await clickCtl(`more.${slug(name)}`); await clickCtl(`more.${slug(name)}`); await wait(400);
  const b = await state();
  const mixB = await paintedOf('.mo-cs-mix');
  const tb = (await tubes()).find((x) => flat(x.paint) === flat(name));
  const others = a.mix.filter((m) => flat(m.name) !== flat(name)).every((m) => partsOf(b, m.name) === Number(m.parts));
  return [partsOf(b, name) > partsOf(a, name) && others && !!tb && tb.parts.includes(String(partsOf(b, name))) && !!mixA && !!mixB && !near(mixA, mixB, 0), { paint: name, parts: [partsOf(a, name), partsOf(b, name)], tube: tb, mix: [mixA, mixB] }];
});
await t('6.3 the drift from the recipe is put in words (.mo-cs-drift, state.drift)', async () => {
  const s = await state();
  const text = await textOf('.mo-cs-bench .mo-cs-drift');
  return [typeof text === 'string' && text.length >= 8 && !!s.drift, { text, drift: s.drift }];
});
await t('6.4 "less" lowers the parts again', async () => {
  const a = await state();
  const name = a.recipe.paints[0].name;
  await clickCtl(`less.${slug(name)}`); await wait(400);
  const b = await state();
  return [partsOf(b, name) < partsOf(a, name) && partsOf(b, name) >= 0, { paint: name, parts: [partsOf(a, name), partsOf(b, name)] }];
});
await t('6.5 Reset returns the bench to the recipe', async () => {
  if (!benchBase) throw new Error('the bench never opened');
  const edited = await state();
  await clickCtl('resetMix'); await wait(500);
  const s = await state();
  const mix = await paintedOf('.mo-cs-mix');
  const back = s.mix.length === s.recipe.paints.length && s.recipe.paints.every((p) => partsOf(s, p.name) === Number(p.parts));
  return [JSON.stringify(edited.mix) !== JSON.stringify(s.mix) && back && near(mix, hexRgb(s.recipe.hex)) && recipeKey(s) === recipeKey(benchBase), { edited: edited.mix, now: s.mix, recipe: s.recipe.paints.map((p) => [p.name, p.parts]), mix }];
});
await t('6.6 the nudge row shows what one more part of each paint in the list would do: one swatch per paint', async () => {
  const s = await state();
  const n = await P(() => { const p = window.__csProbe, row = p.all('.mo-cs-bench .mo-cs-nudges', p.root())[0]; return row ? p.all('.mo-cs-nudge[data-paint]', row).map((b) => ({ paint: b.getAttribute('data-paint'), tag: b.tagName, painted: p.paint(b), name: p.nameOf(b) })) : null; });
  if (!n) throw new Error('no .mo-cs-nudges in the bench');
  return [sameSet(n.map((x) => x.paint), s.paints) && n.every((x) => x.tag === 'BUTTON' && x.painted && x.name.length > 0) && new Set(n.map((x) => String(x.painted))).size >= Math.min(4, n.length), n.map((x) => [x.paint, x.painted])];
});
await t('6.7 Fix My Mix: six problems to choose from, and a choice gives advice that names a paint from the list', async () => {
  const s = await state();
  const there = await P(() => ['bright', 'dull', 'dark', 'light', 'warm', 'cool'].filter((k) => window.__csProbe.all(`[data-px-id="media-organizer.colour.fix.${k}"]`).length === 1));
  const advice = {};
  for (const k of there) {
    await clickCtl(`fix.${k}`); await wait(450);
    advice[k] = (await textOf('.mo-cs-fix-advice')) || '';
  }
  const naming = Object.values(advice).filter((a) => a.length >= 8 && s.paints.some((p) => a.toLowerCase().includes(p.toLowerCase())));
  return [there.length === 6 && naming.length >= 1 && new Set(Object.values(advice)).size >= 2, { controls: there, advice }];
});
// ASSUMED: Swap shows its offers (at most three mixes without the paint) as new controls, in a menu or
// in the bench; the first of them that is not Cancel / Close / Back is chosen.
await t('6.8 Swap on a paint offers mixes without it, and choosing one takes that paint out of the mix', async () => {
  await clickCtl('resetMix').catch(() => {});
  const a = await state();
  const name = ([...a.mix].reverse().find((m) => !/white/i.test(m.name)) || a.mix[0]).name;
  await P(() => window.__csProbe.mark());
  await clickCtl(`swap.${slug(name)}`); await wait(600);
  const offers = (await P(() => window.__csProbe.fresh())).filter((o) => !/^(cancel|close|back)\b/i.test(o.name));
  if (!offers.length) throw new Error(`Swap on ${name} offered nothing new to choose`);
  await clickStash(offers[0].i); await wait(600);
  const b = await state();
  const ok = Array.isArray(b.mix) && b.mix.length >= 1 && !b.mix.some((m) => flat(m.name) === flat(name)) && b.mix.every((m) => b.paints.some((p) => flat(p) === flat(m.name)) && Number(m.parts) > 0);
  const tb = await tubes();
  return [ok && offers.length <= 4 && !!tb && sameSet(tb.map((x) => x.paint), b.mix.map((m) => m.name)), { swapped: name, offers: offers.map((o) => o.name), mixWas: a.mix, mixNow: b.mix, tubes: tb }];
});

// 7. The paints ──────────────────────────────────────────────────────────────
let removed = null, removed2 = null, paintsA = null;
await t('7.1 taking a paint the recipe uses out of the list changes state.paints, and the recipe is made without it', async () => {
  const a = await state();
  const name = (a.recipe.paints.find((p) => !/white/i.test(p.name)) || a.recipe.paints[0]).name;
  const how = await removePaint(name);
  await wait(600);
  const b = await state();
  removed = name;
  const ok = a.paints.length === b.paints.length + 1 && !b.paints.some((p) => flat(p) === flat(name)) && !b.recipe.paints.some((p) => flat(p.name) === flat(name)) && b.recipe.paints.length >= 1 && b.recipe.paints.every((p) => b.paints.some((n) => flat(n) === flat(p.name)));
  return [ok, { how, removed: name, paints: b.paints, recipeWas: a.recipe.paints.map((p) => p.name), recipeNow: b.recipe.paints.map((p) => p.name) }];
});
// ASSUMED: a saved set is a copy; taking a paint out of the list afterwards does not rewrite the set saved before.
await t('7.2 the paints in use are saved as a named set (state.paintSet names it)', async () => {
  await saveSetAs('Probe Set A');
  const s = await state();
  paintsA = s.paints;
  return [s.paintSet === 'Probe Set A' && !!removed && !s.paints.some((p) => flat(p) === flat(removed)), { paintSet: s.paintSet, paints: s.paints }];
});
await t('7.3 a second set, one paint fewer, is saved beside it', async () => {
  const a = await state();
  const name = a.paints.find((p) => !/white/i.test(p) && flat(p) !== flat('Probe Teal')) || a.paints[0];
  await removePaint(name);
  removed2 = name;
  await saveSetAs('Probe Set B');
  const s = await state();
  return [s.paintSet === 'Probe Set B' && s.paints.length === a.paints.length - 1 && !s.paints.some((p) => flat(p) === flat(name)), { removed: name, paintSet: s.paintSet, paints: s.paints }];
});
await t('7.4 switching to the first set brings its paints back; switching to the second takes one away again', async () => {
  if (!paintsA || !removed2) throw new Error('the two sets were not saved');
  await switchSet('Probe Set A');
  const a = await state();
  await switchSet('Probe Set B');
  const b = await state();
  const ok = a.paintSet === 'Probe Set A' && sameSet(a.paints, paintsA) && a.paints.some((p) => flat(p) === flat(removed2)) && b.paintSet === 'Probe Set B' && !b.paints.some((p) => flat(p) === flat(removed2)) && b.paints.length === paintsA.length - 1 && b.recipe.paints.every((p) => b.paints.some((n) => flat(n) === flat(p.name)));
  return [ok, { A: [a.paintSet, a.paints], B: [b.paintSet, b.paints] }];
});

// 8. It comes back as it was ─────────────────────────────────────────────────
const KEPT = ['wheel', 'harmony', 'colours', 'paints', 'paintSet'];
const kept = (s) => Object.fromEntries(KEPT.map((k) => [k, s[k]]));
await t('8.1 harmony, wheel model and a colour are changed, the tab is closed, the sheet is opened again from the home: the same', async () => {
  await choose('harmony', '^square');
  await choose('wheelModel', '^screen');
  await focusDot(0);
  await press('ArrowRight', 7);
  const a = await state();
  if (!(a.harmony === 'square' && a.wheel === 'screen' && a.colours.length === 4)) throw new Error(`the changes did not take: ${JSON.stringify(kept(a))}`);
  await wait(1_500);
  await run('workbench.action.closeActiveEditor'); await wait(900);
  const still = await stateOrNull();
  if (still && String(still.sheetId) === String(a.sheetId)) throw new Error('the sheet\'s tab did not close');
  const b = await openSheet(a.sheetId, a.title);
  return [JSON.stringify(kept(a)) === JSON.stringify(kept(b)), { before: kept(a), after: kept(b) }];
});

// 9. From a picture, and from a plan ─────────────────────────────────────────
// ASSUMED: Choose Picture… (`.choosePicture`) offers the library's photos as controls named with the
// photo's title (as Painting Plans' picker does), with a search field that narrows them.
const pictureBox = () => P(() => { const p = window.__csProbe, r = p.root(); const pic = r && p.all('.mo-cs-picture', r)[0]; if (!pic) return null; const img = [pic, ...pic.querySelectorAll('img, canvas')].filter((e) => p.vis(e) && (e.tagName === 'CANVAS' || e.tagName === 'IMG')).filter((e) => (e.tagName === 'IMG' ? e.naturalWidth > 0 : e.width > 0)).sort((x, y) => y.getBoundingClientRect().width - x.getBoundingClientRect().width)[0]; return img ? p.box(img) : null; });
await t('9.1 choosing Picture as the source and a photo from the library shows the picture in the wheel\'s place', async () => {
  await openSheet(sheetA, titleA);
  const sourceAt = await boxOf(ctl('source'), { anywhere: true });
  const pictureAt = await P((sel) => { const p = window.__csProbe, el = p.all(sel)[0], inner = el && p.clickables(el).find((e) => /^picture/i.test(p.nameOf(e))); return inner ? p.box(inner) : null; }, ctl('source'));
  await P(() => window.__csProbe.mark()); // whatever appears from here on is the picker
  if (pictureAt) { await page.mouse.click(pictureAt.x, pictureAt.y); await wait(500); } else { void sourceAt; await choose('source', '^picture'); await P(() => window.__csProbe.mark()); await wait(300); }
  await wait(500);
  if (!(await pictureBox())) {
    const offered = async () => (await P(() => window.__csProbe.fresh())).find((o) => /halves/i.test(o.name));
    let item = await offered();
    if (!item && (await boxOf(ctl('choosePicture'), { anywhere: true }).catch(() => null))) { await clickCtl('choosePicture'); await wait(900); item = await offered(); }
    if (!item) {
      const typed = await P(() => { const a = document.activeElement; const f = a && a.tagName === 'INPUT' ? a : window.__csProbe.all('input[type="search"], input[type="text"]').pop(); if (!f) return false; f.focus(); return true; });
      if (typed) { await page.keyboard.type('halves'); await wait(900); item = await offered(); }
    }
    if (!item) throw new Error('no photo named halves was offered to choose');
    await clickStash(item.i);
  }
  const b = await until(pictureBox, 8_000);
  await wait(800);
  const s = await state();
  return [!!b && b.w >= 120 && b.h >= 80 && s.source === 'picture' && (await countOf('.mo-cs-wheel canvas, canvas.mo-cs-wheel')) === 0, { picture: b && [Math.round(b.w), Math.round(b.h)], source: s.source }];
});
await t('9.2 the picture\'s own colours are listed (.mo-cs-mass), the two halves among them', async () => {
  const masses = await P(() => { const p = window.__csProbe; return p.all('.mo-cs-mass', p.root()).map((m) => p.paint(m)); });
  return [masses.length >= 2 && masses.some((m) => near(m, LEFT, 40)) && masses.some((m) => near(m, RIGHT, 40)), masses];
});
await t('10.3 a screenshot of the picture source', async () => { const f = await shot('colour-study-picture', '.mo-cs-picture'); pictureShot = true; return [true, f]; });
await t('9.3 a click on the picture makes the active colour the colour under the pointer (left half, then right half)', async () => {
  const b = await pictureBox();
  if (!b) throw new Error('no picture on screen');
  const a = await state();
  await page.mouse.click(b.left + b.w * 0.25, b.top + b.h * 0.5); await wait(700);
  const l = await state();
  await page.mouse.click(b.left + b.w * 0.75, b.top + b.h * 0.5); await wait(700);
  const r = await state();
  const target = await paintedOf('.mo-cs-target');
  const ok = near(hexRgb(activeHex(l)), LEFT, 30) && near(hexRgb(activeHex(r)), RIGHT, 30) && r.source === 'picture' && near(target, hexRgb(activeHex(r))) && r.recipe.paints.length >= 1 && recipeKey(r) !== recipeKey(l) && activeHex(a) !== activeHex(l);
  return [ok, { before: activeHex(a), left: activeHex(l), right: activeHex(r), source: r.source, target }];
});
await t('9.4 back to Wheel: the wheel returns and the colour taken from the picture is kept', async () => {
  const a = await state();
  await choose('source', '^wheel'); await wait(600);
  const b = await state();
  const w = await wheelBox();
  return [b.source === 'wheel' && w.vis && (await countOf('.mo-cs-picture')) === 0 && nearHex(activeHex(b), activeHex(a)), { source: b.source, was: activeHex(a), now: activeHex(b) }];
});
await t('8.2 what the sheet holds at the end is read for the checks after the restart', async () => {
  await wait(1_500);
  finalA = await state();
  return [String(finalA.sheetId) === String(sheetA), { sheet: finalA.sheetId, ...kept(finalA) }];
});

// From a plan. The plan was seeded with a variation of three saved colours.
let planOpen = false, planWhy = '';
if (up) {
  try {
    await run('media-organizer.paintingPlans'); await wait(900);
    const r = await run('media-organizer.plans.open', seeded.plan);
    planOpen = !!(await until(async () => (await activeInstance()) === `plans:edit:${seeded.plan}`, 6_000));
    if (!planOpen) planWhy = `the seeded plan did not open in a hidden run (${r.ok ? await activeInstance() : r.error})`;
    await wait(3_000);
  } catch (e) { planWhy = String(e?.message || e).slice(0, 200); }
} else planWhy = 'the app did not start';
const PLAN_CHECKS = ['9.5 from the open plan, media-organizer.plan.openInColourStudy makes a new sheet and opens it', '9.6 that sheet\'s colours include the variation\'s saved colours', '9.7 the plan\'s picture came too'];
if (!planOpen) for (const n of PLAN_CHECKS) notRun(n, planWhy);
else {
  let planSheet = null;
  await t(PLAN_CHECKS[0], async () => {
    const r = await run('media-organizer.plan.openInColourStudy');
    if (!r.ok) throw new Error(r.error);
    planSheet = await until(async () => { const s = await stateOrNull(); return s && String(s.sheetId) !== String(sheetA) && String(s.sheetId) !== String(sheetB) ? s : null; }, 8_000);
    await wait(1_500);
    return [!!planSheet && (await activeInstance()) === `colour:sheet:${planSheet.sheetId}`, { sheet: planSheet && planSheet.sheetId, instance: await activeInstance() }];
  });
  await t(PLAN_CHECKS[1], async () => {
    const s = await state();
    if (String(s.sheetId) === String(sheetA)) throw new Error('still on the first sheet');
    const missing = PLAN_SAVED.filter((c) => !s.colours.some((x) => near(hexRgb(x), c.rgb, 2))).map((c) => c.rgb);
    return [missing.length === 0 && s.recipe.paints.every((p) => s.paints.some((n) => flat(n) === flat(p.name))), { colours: s.colours, missing }];
  });
  await t(PLAN_CHECKS[2], async () => {
    const s = await state();
    if (String(s.sheetId) === String(sheetA)) throw new Error('still on the first sheet');
    const b = await until(pictureBox, 6_000);
    const px = b ? (await pixels({ left: b.left + b.w * 0.2, top: b.top + b.h * 0.45, w: b.w * 0.1, h: b.h * 0.1 })).centre : null;
    return [!!b && s.source === 'picture' && near(px, LEFT, 30), { source: s.source, picture: b && [Math.round(b.w), Math.round(b.h)], leftHalfSeen: px }];
  });
}

// The app is closed; the database is read; the app is opened again ───────────
const pageErrors1 = errors.slice();
await app?.close().catch(() => {});
app = null; page = null;
await t('8.3 the sheets are rows of mo_colour_sheets (id, title, state_json), the first sheet among them', async () => {
  dbAfter = readDb();
  if (!dbAfter.sheets) throw new Error('no table mo_colour_sheets in the workspace database');
  const row = dbAfter.sheets.find((r) => String(r.id) === String(sheetA));
  let parsed = null;
  try { parsed = row ? JSON.parse(row.state_json) : null; } catch { parsed = null; }
  const cols = row ? Object.keys(row) : [];
  return [!!row && ['id', 'title', 'state_json', 'created_at', 'updated_at'].every((c) => cols.includes(c)) && !!parsed && typeof parsed === 'object' && row.title === titleA && dbAfter.sheets.length >= 2, { rows: dbAfter.sheets.map((r) => [r.id, r.title]), columns: cols }];
});
await t('7.5 the paints in use are the shared list: plan_paints_v1 now holds exactly the sheet\'s paints', async () => {
  if (!dbAfter || !finalA) throw new Error('nothing to compare');
  const stored = JSON.parse(dbAfter.paints || 'null');
  const names = (stored?.paints || []).map((p) => p.name);
  return [sameSet(names, finalA.paints) && names.length < SEEDED_PAINTS.length && !!removed && !names.some((n) => flat(n) === flat(removed)), { stored: names, sheet: finalA.paints }];
});
await t('7.6 the named sets are kept in plan_paint_sets_v1', async () => {
  if (!dbAfter) throw new Error('nothing to read');
  const text = dbAfter.sets || '';
  if (!text) throw new Error('the setting plan_paint_sets_v1 is not there');
  JSON.parse(text);
  return [text.includes('Probe Set A') && text.includes('Probe Set B'), text.slice(0, 240)];
});
try { if (up) await boot(); } catch (e) { console.log(`[colour-study] the app did not start again: ${e?.stack || e}`); page = null; }
await t('8.4 after the app is closed and opened, the sheet opens from the home as it was (colours, harmony, wheel model, paints, set)', async () => {
  if (!finalA) throw new Error('the sheet\'s last state was never read');
  const s = await openSheet(sheetA, titleA);
  return [JSON.stringify(kept(s)) === JSON.stringify(kept(finalA)) && s.paintSet === 'Probe Set B', { before: kept(finalA), after: kept(s) }];
});
await t('8.5 Atelier turned off: the sheet and its command go at once; turned on again, the sheet is as it was', async () => {
  if (!finalA) throw new Error('the sheet\'s last state was never read');
  await openSheet(sheetA, titleA);
  await setTool(false); await wait(2_000);
  const gone = await P(() => document.querySelectorAll('.mo-cs').length);
  const refused = await run('media-organizer.colourStudy');
  await setTool(true); await wait(3_000);
  await P(async () => { await window.__parallx_workbench__._services.get({ id: 'IConfigurationService' }).getConfiguration('mediaOrganizer').update('enableArtTools', true); });
  await wait(1_000);
  const s = await openSheet(sheetA, titleA);
  return [gone === 0 && refused.ok === false && JSON.stringify(kept(s)) === JSON.stringify(kept(finalA)), { sheetsWhileOff: gone, commandWhileOff: refused, after: kept(s) }];
});
await t('10.4 the three screenshots are files in the out dir', async () => {
  const files = ['colour-study-sheet', 'colour-study-bench', 'colour-study-picture'].map((n) => path.join(shots, `${n}.png`));
  const sizes = await Promise.all(files.map(async (f) => (existsSync(f) ? (await fs.stat(f)).size : 0)));
  return [sheetShot && benchShot && pictureShot && sizes.every((n) => n > 4_000), Object.fromEntries(files.map((f, i) => [path.basename(f), sizes[i]]))];
});

const pageErrors = [...pageErrors1, ...errors];
await app?.close().catch(() => {});
for (const d of [appRoot, workspace]) await fs.rm(d, { recursive: true, force: true }).catch(() => {});
await fs.rm(DB_TOOL, { force: true }).catch(() => {});

console.log(`\n[colour-study] renderer errors: ${pageErrors.length}`);
for (const e of pageErrors.slice(0, 8)) console.log('  ' + e);
if (notRunList.length) console.log(`[colour-study] NOT RUN (${notRunList.length}): ${notRunList.join('; ')}`);
console.log(`[colour-study] ${passed} ok, ${failed.length} FAIL, ${notRunList.length} not run`);
console.log(`[colour-study] shots: ${shots}`);
process.exit(failed.length ? 1 : 0);
