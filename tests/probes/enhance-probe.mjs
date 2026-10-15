// enhance-probe.mjs: Enhance on SeedVR2 in the real app, hidden, Ollama's
// port refused (docs/ENHANCE.md, "Checks before it is called done").
//
//   PARALLX_RUNTIMES_DIR=<folder> node tests/probes/enhance-probe.mjs <outDir>
//
// With an empty <folder> it is the clean-machine test: the editor's Enhance
// tool shows the setup card, Set Up Enhance runs the whole setup, Stop during
// the model download keeps the part, Carry On finishes it; then nothing new
// may be in the user's folder, the registry or uv's default caches. With a
// set-up <folder> it goes straight on: Preview and Save As Copy in the
// editor, a 24 MP photo enlarged 2x, the library's Upscale, and Stop during
// an enlargement leaving nothing behind.
//
// The model files are about 9 GB and the packages about 3.5 GB, so the
// clean-machine run takes a while; a set-up folder can be reused after it.

import { spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PROJECT_ROOT, launchApp, setToolEnabled, cmd } from './scene.mjs';

const outDir = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'parallx-enhance-probe'));
const RUNTIMES = process.env.PARALLX_RUNTIMES_DIR;
if (!RUNTIMES) { console.error('Set PARALLX_RUNTIMES_DIR to the folder the engine is (or will be) set up in.'); process.exit(2); }
const ENGINE = path.join(RUNTIMES, 'seedvr2-enhance');
const ELECTRON = path.join(PROJECT_ROOT, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const SEED = path.join(PROJECT_ROOT, 'tests', 'probes', 'tag-review-seed.cjs');
const results = [];
const check = (name, ok, detail = '') => { results.push(!!ok); console.log(`[probe] ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  (${String(detail).slice(0, 300)})` : ''}`); };
const log = (...a) => console.log('[probe]', ...a);
const sizeOf = (f) => { try { const r = spawnSync(path.join(PROJECT_ROOT, 'ext', 'media-organizer', 'bin', 'magick.exe'), ['identify', '-format', '%w,%h', f], { encoding: 'utf8', windowsHide: true }); return r.stdout.trim(); } catch { return ''; } };

// ── What the user's machine looks like outside Parallx's folders, before and after ──
function outside() {
  const home = os.homedir();
  const places = [path.join(home, '.local'), path.join(home, '.cache'), path.join(home, '.config', 'uv'),
    process.env.APPDATA && path.join(process.env.APPDATA, 'uv'), process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'uv'),
    process.env.APPDATA && path.join(process.env.APPDATA, 'Python')].filter(Boolean);
  const list = (p) => { try { return readdirSync(p).sort().join(','); } catch { return '(none)'; } };
  const snap = { home: readdirSync(home).sort().join(','), places: Object.fromEntries(places.map((p) => [p, list(p)])) };
  if (process.platform === 'win32') {
    try { snap.registry = execFileSync('reg', ['query', 'HKCU\\Software\\Python', '/s'], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { snap.registry = '(none)'; }
  }
  return snap;
}

// ── A workspace with photos: the audit's four test pictures and a 24 MP one ──
const stamp = Date.now();
const appRoot = path.join(os.tmpdir(), `parallx-enhance-root-${stamp}`);
const ws = path.join(os.tmpdir(), `parallx-enhance-ws-${stamp}`);
const photos = path.join(ws, 'photos');
await fs.mkdir(path.join(appRoot, 'data'), { recursive: true });
await fs.mkdir(photos, { recursive: true });
await fs.mkdir(outDir, { recursive: true });
await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: ws }));
await fs.symlink(path.join(PROJECT_ROOT, 'ext'), path.join(appRoot, 'ext'), 'junction');
// The seed script expects the audit's four pictures (it adds tag reviews to them); the 24 MP one is ours.
const gen = [['boxing.jpg', 'testsrc2=size=1200x800', 1200, 800], ['card.jpg', 'testsrc2=size=1600x1200', 1600, 1200], ['fractal.jpg', 'mandelbrot=size=1200x900', 1200, 900], ['bars.jpg', 'smptehdbars=size=1280x720', 1280, 720], ['big.jpg', 'testsrc2=size=6000x4000', 6000, 4000]];
for (const [name, src] of gen) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', src, '-frames:v', '1', '-q:v', '3', path.join(photos, name)], { windowsHide: true });
  if (r.status !== 0) throw new Error(`ffmpeg ${name}: ${String(r.stderr).slice(0, 200)}`);
}
const specPath = path.join(ws, '.parallx', 'enhance-seed.json');
await fs.mkdir(path.dirname(specPath), { recursive: true });
await fs.writeFile(specPath, JSON.stringify(gen.map(([basename, , width, height]) => ({ basename, width, height }))));
let PHOTO = {};
for (const id of ['media-organizer', 'parallx-community.media-organizer']) {
  const r = spawnSync(ELECTRON, [SEED, 'seed', path.join(ws, '.parallx', 'extensions', id, 'data.db'), photos, specPath], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error(`seed: ${r.stderr || r.stdout}`);
  PHOTO = JSON.parse(r.stdout.trim().split(/\r?\n/).pop()).photo;
}

const fresh = (() => { try { return JSON.parse(readFileSync(path.join(ENGINE, 'state.json'), 'utf8')).selftest !== true; } catch { return true; } })();
const before = outside();
log(`engine folder ${ENGINE} (${fresh ? 'empty: the whole setup runs' : 'already set up'})`);
const { app, page, errors } = await launchApp(appRoot);
const card = () => page.evaluate(() => { const c = document.querySelector('.mo-enhance-setup'); return c && c.offsetParent !== null ? c.textContent.replace(/\s+/g, ' ').trim() : null; });
// Enhance's work folders: .enhance-* beside the workspace's other Media Organizer folders.
const workFolders = () => { const out = []; const walk = (d, depth) => { let es = []; try { es = readdirSync(d, { withFileTypes: true }); } catch { return; } for (const e of es) if (e.isDirectory()) { const p = path.join(d, e.name); if (/^.enhance-/.test(e.name)) out.push(p); else if (depth < 6) walk(p, depth + 1); } }; walk(path.join(ws, '.parallx'), 0); return out; };
const countFiles = (d) => { let n = 0; let es = []; try { es = readdirSync(d, { withFileTypes: true }); } catch { return 0; } for (const e of es) n += e.isDirectory() ? countFiles(path.join(d, e.name)) : 1; return n; };
const clickId = (id) => page.locator(`[data-px-id="${id}"]`).first().click({ timeout: 10_000 });
try {
  await setToolEnabled(page, 'parallx-community.media-organizer', true);
  await page.waitForTimeout(2500);

  // ── 1. The setup card, the setup, Stop and Carry On ──
  await cmd(page, 'media-organizer.editImage', PHOTO['fractal.jpg']);
  await page.waitForSelector('.mo-edit', { timeout: 30_000 });
  await clickId('media-organizer.imageEditor.tool.enhance');
  await page.waitForTimeout(3000);
  if (fresh) {
    const first = await card();
    check('the Enhance tool shows the setup card, with what it downloads', !!first && /Set up Enhance/.test(first) && /downloads about \d+ GB/.test(first), first);
    await page.screenshot({ path: path.join(outDir, 'enhance-card.png') });
    await clickId('media-organizer.enhance.setUp');
    const t0 = Date.now();
    const labels = [];
    let stopped = false; let resumed = false; let partSeen = false;
    while (Date.now() - t0 < 90 * 60_000) {
      const text = await card();
      if (text === null) break;   // the card went away: ready
      const label = text.replace(/^Setting up Enhance /, '').slice(0, 90);
      if (labels[labels.length - 1] !== label) { labels.push(label); log(`${Math.round((Date.now() - t0) / 1000)} s: ${label}`); }
      // Stop once in the big download, after a gigabyte; then carry on.
      const got = /(\d+\.\d) GB of/.exec(text);
      if (!stopped && /Downloading seedvr2/.test(text) && got && Number(got[1]) >= 2) {
        await clickId('media-organizer.enhance.stopSetUp');
        stopped = true;
        await page.waitForFunction(() => /Carry On Setting Up/.test(document.querySelector('.mo-enhance-setup')?.textContent || ''), null, { timeout: 60_000 }).catch(() => {});
        const parts = readdirSync(path.join(ENGINE, 'files')).filter((n) => n.endsWith('.part'));
        partSeen = parts.length > 0 && statSync(path.join(ENGINE, 'files', parts[0])).size > 1024 ** 3;
        check('Stop keeps what was downloaded and offers Carry On Setting Up', partSeen && /Carry On Setting Up/.test(await card() || ''), parts.join(', '));
        await page.screenshot({ path: path.join(outDir, 'enhance-stopped.png') });
        await clickId('media-organizer.enhance.setUp');
        resumed = true;
      }
      await page.waitForTimeout(3000);
    }
    const mins = Math.round((Date.now() - t0) / 6000) / 10;
    const ready = (await card()) === null;
    check('setup finishes and the card gives way to the Enlarge controls', ready, `${mins} min; ${labels.join(' > ').slice(0, 400)}`);
    check('it carried on after Stop rather than starting over', stopped && resumed, `stopped ${stopped}, resumed ${resumed}`);
    const st = JSON.parse(readFileSync(path.join(ENGINE, 'state.json'), 'utf8'));
    check('the runtime records each step, and the self-test passed', st.uv && st.python === '3.13.16' && st.packages && st.selftest === true, JSON.stringify(st).slice(0, 300));
    const after = outside();
    const diff = [];
    if (after.home !== before.home) diff.push(`home: ${before.home} -> ${after.home}`);
    for (const [p, v] of Object.entries(after.places)) if (before.places[p] !== v) diff.push(`${p}: ${before.places[p]} -> ${v}`);
    if (after.registry !== before.registry) diff.push(`registry: ${after.registry}`);
    check('nothing new outside the engine\'s folder (user folder, registry, uv\'s default caches)', diff.length === 0, diff.join(' | ') || 'none');
  }
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(outDir, 'enhance-ready.png') });

  // ── 2. Preview and Save As Copy in the editor (ENHANCE_ONLY=library skips it) ──
  if (process.env.ENHANCE_ONLY !== 'library') {
  const chip = page.locator('.mo-edit-chip, button, [role="radio"]').filter({ hasText: /^2×$/ }).first();
  await chip.click({ timeout: 10_000 });
  await page.waitForTimeout(800);
  const t1 = Date.now();
  await clickId('media-organizer.imageEditor.previewEnlarged');
  // While it runs, the pieces of the photo are in the workspace, not in the engine's shared folder.
  let piecesInWorkspace = false;
  for (let k = 0; k < 120 && !piecesInWorkspace; k++) { piecesInWorkspace = workFolders().some((d) => countFiles(d) > 0); if (!piecesInWorkspace) await page.waitForTimeout(500); }
  check('while it runs, the pieces are in a work folder in the workspace', piecesInWorkspace, workFolders().join(', ') || 'none seen');
  const previewed = await page.waitForFunction(() => { const p = document.querySelector('.mo-edit-preview'); return !!p && !p.classList.contains('mo-hidden'); }, null, { timeout: 10 * 60_000 }).then(() => true).catch(() => false);
  check('Preview Enlarged shows the enlarged picture', previewed, `${Math.round((Date.now() - t1) / 1000)} s`);
  await page.screenshot({ path: path.join(outDir, 'enhance-preview.png') });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
  const t2 = Date.now();
  await clickId('media-organizer.imageEditor.saveCopy');
  const want = path.join(photos, 'fractal-2x.png');
  let copy = '';
  while (Date.now() - t2 < 10 * 60_000 && !copy) { copy = readdirSync(photos).find((n) => /^fractal.*\.png$/i.test(n)) || ''; await page.waitForTimeout(1000); }
  await page.waitForTimeout(3000);
  check('Save As Copy writes the enlarged copy, twice the size', !!copy && sizeOf(path.join(photos, copy)) === '2400,1800', `${copy || 'none'} ${copy ? sizeOf(path.join(photos, copy)) : ''}; ${Math.round((Date.now() - t2) / 1000)} s; expected like ${path.basename(want)}`);
  // Afterwards: the work folders' files are gone (Eraser overwrites them within moments) and nothing is in the engine's folder.
  await page.waitForTimeout(20_000);
  const leftFiles = workFolders().reduce((n, d) => n + countFiles(d), 0);
  check('afterwards no piece of the photo is left in the workspace', leftFiles === 0, `${leftFiles} file(s) in ${workFolders().join(', ') || 'no work folder'}`);
  const shared = existsSync(path.join(ENGINE, 'tmp')) ? readdirSync(path.join(ENGINE, 'tmp')).filter((n) => /^enhance-/.test(n)) : [];
  check('and none is in the engine\'s shared folder', shared.length === 0, shared.join(', ') || 'none');

  }

  // ── 3. The library's Upscale: a 24 MP photo at 2x, then Stop part-way ──
  await cmd(page, 'media-organizer.openGrid');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(outDir, 'enhance-library.png') });
  // The feed shows no titles: find the 24 MP photo's card by its name, title or picture.
  const bigIndex = await page.evaluate(() => Array.from(document.querySelectorAll('.mo-card, .mo-feed-card')).findIndex((c) => /\bbig\b/.test([c.getAttribute('aria-label'), c.getAttribute('title'), c.textContent, ...Array.from(c.querySelectorAll('img')).map((i) => `${i.alt} ${i.title}`)].join(' '))));
  console.log('[probe] cards:', await page.evaluate(() => Array.from(document.querySelectorAll('.mo-card, .mo-feed-card')).map((c) => c.getAttribute('aria-label') || (c.querySelector('img') || {}).alt || c.textContent.trim().slice(0, 20)).join(' | ')));
  if (bigIndex < 0) throw new Error('The 24 MP photo is not in the library view; nothing else is upscaled in its place.');
  const bigCard = page.locator('.mo-card, .mo-feed-card').nth(bigIndex);
  await bigCard.waitFor({ state: 'visible', timeout: 30_000 });
  check('the library shows the 24 MP photo', bigIndex >= 0, String(bigIndex));
  const upscaleBig = async () => {
    await bigCard.click({ button: 'right' });
    await page.waitForSelector('.context-menu', { timeout: 5_000 });
    await page.locator('.context-menu').getByText('Upscale…', { exact: true }).first().click();
    await page.waitForSelector('.mo-bulk-dialog', { timeout: 10_000 });
    await page.locator('.mo-bulk-dialog [data-px-id="media-organizer.upscale.scale.2"]').click();
    await page.locator('.mo-bulk-dialog [data-px-id="media-organizer.upscale.run"]').click();
  };
  const t3 = Date.now();
  await upscaleBig();
  let label = '';
  const seen = [];
  while (Date.now() - t3 < 30 * 60_000) {
    const open = await page.locator('.mo-bulk-dialog').count();
    if (!open) break;
    label = await page.evaluate(() => Array.from(document.querySelectorAll('.mo-bulk-dialog .mo-bulk-dialog-section div')).map((d) => d.textContent).find((t) => /Upscaling/.test(t)) || '');
    if (label && seen[seen.length - 1] !== label) { seen.push(label); }
    await page.waitForTimeout(2000);
  }
  const big2 = path.join(photos, 'big-2x.png');
  check('the library\'s Upscale enlarges a 24 MP photo to 12000 x 8000', existsSync(big2) && sizeOf(big2) === '12000,8000', `${sizeOf(big2)}; ${Math.round((Date.now() - t3) / 1000)} s; ${seen.slice(-4).join(' > ').slice(0, 300)}`);
  check('its progress names the pieces', seen.some((s) => /piece \d+ of \d+/.test(s)), seen.slice(0, 3).join(' > '));

  // Stop part-way: nothing half-made stays, no engine process keeps running.
  await page.waitForTimeout(3000);
  await upscaleBig();
  await page.waitForTimeout(45_000);
  await page.locator('.mo-bulk-dialog [data-px-id="media-organizer.upscale.cancel"]').click();
  await page.waitForFunction(() => !document.querySelector('.mo-bulk-dialog'), null, { timeout: 120_000 }).catch(() => {});
  await page.waitForTimeout(5000);
  const left = readdirSync(photos).filter((n) => /big-2x \(2\)|\.source\.png|enhance-/.test(n));
  check('Stop ends the enlargement and leaves no file behind', left.length === 0, left.join(', ') || 'none');
  const procs = process.platform === 'win32'
    ? execFileSync('powershell', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process -Filter "Name='python.exe'" | Where-Object { $_.ExecutablePath -like '${ENGINE.replace(/'/g, "''")}*' } | Measure-Object | Select-Object -ExpandProperty Count`], { encoding: 'utf8', windowsHide: true }).trim()
    : '0';
  check('and no engine process is left running', procs === '0', `${procs} running`);
  console.log('[probe] errors:', errors.filter((e) => !/Ollama|11434|EmbeddingService|IndexingPipeline/.test(e)).slice(0, 5).join(' || ') || 'none');
} finally {
  await app.close();
}
const ok = results.every(Boolean);
console.log(ok ? `[probe] enhance: all ${results.length} ok` : `[probe] enhance: ${results.filter((r) => !r).length} of ${results.length} FAILED`);
process.exit(ok ? 0 : 1);
