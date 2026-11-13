// Hidden-window probe: Enhance for a video and for a GIF, from the library's
// menu to the new file in the library, with no graphics card. The script that
// does the work, engine/enhance_video.py, is the real one; only the model is
// stood in for: a stand-in for SeedVR2's command line has the machine's
// ffmpeg resize the frames and prints the lines the real one prints. So what
// is checked is everything around the model: the dialog and what it says, the
// preview with the original beside it, a run that is stopped and carried on
// from its kept frames, the card in use, the result's size, frames and sound,
// and the result as a library item with the original's tags.
//
// Usage: node tests/probes/enhance-video-probe.mjs <outDir>   (run from Bash)
import { _electron as electron } from 'playwright';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { PROJECT_ROOT, launchEnv, pickMenu } from './scene.mjs';

const outDir = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'parallx-enhance-video'));
const ELECTRON = path.join(PROJECT_ROOT, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const SEED = path.join(PROJECT_ROOT, 'tests', 'probes', 'tag-review-seed.cjs');
const ID = 'media-organizer.enhanceVideo';
const px = (id) => `[data-px-id="${id}"]`;

// The stand-in for seedvr2/inference_cli.py: the standard library and ffmpeg. It writes the frames it was
// asked for (from --skip_first_frames on, numbered from 0, the short side --resolution) chunk by chunk,
// with the real one's "Chunk" and "Phase" lines, pausing `delay.txt` seconds a phase.
const STAND_IN = String.raw`
import os, subprocess, sys, tempfile, time
a = sys.argv[1:]
src = a[0]
def opt(name, default=None):
    return a[a.index(name) + 1] if name in a else default
here = os.path.dirname(os.path.abspath(__file__))
ffmpeg = open(os.path.join(here, 'ffmpeg-path.txt'), encoding='utf-8').read().strip()
delay = float(open(os.path.join(here, 'delay.txt'), encoding='utf-8').read().strip() or 0)
out, res, skip, chunk = opt('--output'), int(opt('--resolution')), int(opt('--skip_first_frames', '0')), int(opt('--chunk_size', '0'))
base = os.path.splitext(os.path.basename(src))[0]
every, dest = tempfile.mkdtemp(), os.path.join(out, base)
os.makedirs(dest)
scale = "scale='if(lt(iw,ih),%d,-2)':'if(lt(iw,ih),-2,%d)':flags=neighbor" % (res, res)
subprocess.run([ffmpeg, '-hide_banner', '-loglevel', 'error', '-y', '-i', src, '-vf', "select='gte(n,%d)',%s" % (skip, scale), '-vsync', '0', '-start_number', '0', os.path.join(every, '%06d.png')], check=True)
names = sorted(os.listdir(every))
chunk = chunk or len(names)
chunks = max(1, -(-len(names) // chunk))
for c in range(chunks):
    if chunks > 1:
        print('Chunk %d/%d: %d new + 0 context frames' % (c + 1, chunks, chunk), flush=True)
    for phase in ('Phase 1: VAE encoding', 'Phase 2: DiT upscaling', 'Phase 3: VAE decoding'):
        print(phase, flush=True)
        time.sleep(delay)
    for n in names[c * chunk:(c + 1) * chunk]:
        os.replace(os.path.join(every, n), os.path.join(dest, '%s_%s' % (base, n)))
os.rmdir(every)
print('All upscaling processes completed successfully', flush=True)
`;

const ff = (args) => spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { windowsHide: true, encoding: 'utf8' });
const probeOf = (file) => {
  const r = spawnSync('ffprobe', ['-v', 'error', '-count_frames', '-show_entries', 'stream=codec_type,codec_name,width,height,nb_read_frames', '-of', 'json', file], { windowsHide: true, encoding: 'utf8' });
  try { return JSON.parse(r.stdout).streams; } catch { return []; }
};

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  const where = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['ffmpeg'], { encoding: 'utf8', windowsHide: true });
  const ffmpegPath = String(where.stdout || '').trim().split(/\r?\n/)[0];
  if (!ffmpegPath) { console.log('[probe] SKIP ffmpeg is needed'); process.exit(2); }
  const stamp = Date.now();
  const appRoot = path.join(os.tmpdir(), `parallx-ev-root-${stamp}`);
  const workspace = path.join(os.tmpdir(), `parallx-ev-ws-${stamp}`);
  const photos = path.join(workspace, 'photos');
  const runtimes = path.join(appRoot, 'runtimes');
  await fs.mkdir(path.join(appRoot, 'data'), { recursive: true });
  await fs.mkdir(photos, { recursive: true });
  await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: workspace }));
  await fs.writeFile(path.join(workspace, '.parallx-keep'), '');
  await fs.mkdir(path.join(workspace, '.parallx'), { recursive: true });
  await fs.writeFile(path.join(workspace, '.parallx', 'ai-config.json'), JSON.stringify({ overrides: { indexing: { autoIndex: false, watchFiles: false } } }));

  // The app's extensions, with the Media Organizer as a copy whose SeedVR2 is the stand-in.
  await fs.mkdir(path.join(appRoot, 'ext'));
  for (const name of readdirSync(path.join(PROJECT_ROOT, 'ext'), { withFileTypes: true })) {
    if (!name.isDirectory()) continue;
    const from = path.join(PROJECT_ROOT, 'ext', name.name), to = path.join(appRoot, 'ext', name.name);
    if (name.name !== 'media-organizer') { await fs.symlink(from, to, 'junction'); continue; }
    await fs.cp(from, to, { recursive: true, filter: (src) => !/[\\/]engine[\\/]seedvr2([\\/]|$)/.test(src) });
  }
  const engineDir = path.join(appRoot, 'ext', 'media-organizer', 'engine');
  await fs.mkdir(path.join(engineDir, 'seedvr2'));
  await fs.writeFile(path.join(engineDir, 'seedvr2', 'inference_cli.py'), STAND_IN);
  await fs.writeFile(path.join(engineDir, 'seedvr2', 'ffmpeg-path.txt'), ffmpegPath);
  const delay = (s) => fs.writeFile(path.join(engineDir, 'seedvr2', 'delay.txt'), String(s));
  await delay(0.05);

  // A runtime that counts as set up: the machine's own Python, the model's files as empty stand-ins.
  const rt = path.join(runtimes, 'seedvr2-enhance');
  await fs.mkdir(path.join(rt, 'files'), { recursive: true });
  const venv = spawnSync('python', ['-m', 'venv', path.join(rt, 'env')], { encoding: 'utf8', windowsHide: true });
  if (venv.status !== 0) { console.log(`[probe] SKIP no Python to stand in for the engine: ${venv.stderr || venv.stdout}`); process.exit(2); }
  const engineJs = readFileSync(path.join(PROJECT_ROOT, 'ext', 'media-organizer', 'enhance-engine.js'), 'utf8');
  const kept = {};
  for (const m of engineJs.matchAll(/name: '([^']+)', url: .*?sha256: '([0-9a-f]{64})'/g)) { await fs.writeFile(path.join(rt, 'files', m[1]), ''); kept[m[1]] = m[2]; }
  if (Object.keys(kept).length !== 2) throw new Error('the engine\'s two model files were not found in enhance-engine.js');
  const lock = readFileSync(path.join(engineDir, process.platform === 'win32' ? 'requirements-win.lock' : 'requirements-linux.lock'), 'utf8');
  await fs.writeFile(path.join(rt, 'state.json'), JSON.stringify({ uv: 'stand-in', python: '3.13.16', packages: crypto.createHash('sha256').update(`3.13.16\n${lock}`).digest('hex'), files: kept, selftest: true }));

  // The library: the seed's five photos, a video with sound, and a GIF.
  const BOXING = path.join(PROJECT_ROOT, 'data', 'dashboard-assets', 'aa21bc3e-d260-41ac-8bcf-ab5efe10d0cb.jpg');
  if (!existsSync(BOXING)) { console.log('[probe] SKIP the seed photo is not on this machine'); process.exit(2); }
  await fs.copyFile(BOXING, path.join(photos, 'boxing.jpg'));
  await fs.copyFile(BOXING, path.join(photos, 'marked.jpg'));
  const stills = [['card.jpg', 'testsrc2=size=1200x800', 1200, 800], ['fractal.jpg', 'mandelbrot=size=900x600', 900, 600], ['bars.jpg', 'smptehdbars=size=1280x720', 1280, 720]];
  for (const [name, src] of stills) if (ff(['-f', 'lavfi', '-i', src, '-frames:v', '1', '-q:v', '3', path.join(photos, name)]).status !== 0) throw new Error(`ffmpeg ${name}`);
  const SECONDS = 8, FPS = 24, FRAMES = SECONDS * FPS;
  if (ff(['-f', 'lavfi', '-i', `testsrc2=size=640x360:rate=${FPS}`, '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', String(SECONDS), '-pix_fmt', 'yuv420p', '-c:a', 'aac', path.join(photos, 'harbour.mp4')]).status !== 0) throw new Error('ffmpeg harbour.mp4');
  if (ff(['-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=10', '-t', '2', path.join(photos, 'wave.gif')]).status !== 0) throw new Error('ffmpeg wave.gif');
  const specPath = path.join(appRoot, 'spec.json');
  await fs.writeFile(specPath, JSON.stringify([{ basename: 'boxing.jpg', width: 564, height: 846 }, ...stills.map(([basename, , width, height]) => ({ basename, width, height })), { basename: 'marked.jpg', width: 564, height: 846 },
    { basename: 'harbour.mp4', video: true, width: 640, height: 360, duration: SECONDS, frameRate: FPS }, { basename: 'wave.gif', width: 320, height: 240 }]));
  let seeded = null;
  for (const id of ['media-organizer', 'parallx-community.media-organizer']) {
    const db = path.join(workspace, '.parallx', 'extensions', id, 'data.db');
    const r = spawnSync(ELECTRON, [SEED, 'seed', db, photos, specPath], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', windowsHide: true });
    if (r.status !== 0) throw new Error(`seed failed: ${r.stderr || r.stdout}`);
    seeded = JSON.parse(r.stdout.trim().split(/\r?\n/).pop());
  }

  // What the app is told the graphics card has: room at first, later a chat model on it.
  const cardsFile = path.join(appRoot, 'cards.json');
  const card = (freeMiB) => fs.writeFile(cardsFile, JSON.stringify([{ name: 'Test Card', vramMiB: 32607, freeMiB, driver: '580.00' }]));
  await card(30000);
  const env = launchEnv(appRoot);
  env.PARALLX_RUNTIMES_DIR = runtimes;
  env.PARALLX_TEST_GPU_CARDS_FILE = cardsFile;
  const app = await electron.launch({ args: ['.', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--mute-audio'], cwd: PROJECT_ROOT, env });
  await app.context().route(/^https?:\/\/(localhost|127\.0\.0\.1):11434\//, (route) => route.abort('connectionrefused'));
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 300)}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_CONNECTION_REFUSED|Cannot connect to Ollama|Failed to fetch/.test(m.text())) errors.push(`console: ${m.text().slice(0, 300)}`); });
  let failed = 0;
  const check = (ok, what) => { if (!ok) failed++; console.log(`[probe] ${ok ? 'PASS' : 'FAIL'} ${what}`); };
  const shot = async (name) => {
    // A hidden window can hand back its last painted frame: ask for a fresh one, and keep the second capture.
    const b64 = await app.evaluate(async ({ BrowserWindow }) => { const wc = BrowserWindow.getAllWindows()[0].webContents; wc.invalidate(); await new Promise((r) => setTimeout(r, 250)); await wc.capturePage(); await new Promise((r) => setTimeout(r, 400)); const img = await wc.capturePage(); return img.isEmpty() ? '' : img.toPNG().toString('base64'); });
    if (b64) { await fs.writeFile(path.join(outDir, name), Buffer.from(b64, 'base64')); console.log(`[probe] screenshot -> ${path.join(outDir, name)}`); }
  };
  const texts = (sel) => page.evaluate((s) => [...document.querySelectorAll(s)].map((e) => e.textContent.trim()), sel);
  const run = (id, ...args) => page.evaluate(async ({ id, args }) => { try { await window.__parallx_workbench__._services.get({ id: 'ICommandService' }).executeCommand(id, ...args); return 'ok'; } catch (e) { return String(e && e.message); } }, { id, args });
  const menuOn = async (name, label) => {
    const found = await page.evaluate((name) => {
      const c = [...document.querySelectorAll('.mo-card, .mo-list-row')].find((x) => (x.textContent || '').includes(name));
      if (!c) return false;
      const r = c.getBoundingClientRect();
      c.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 20, clientY: r.top + 20 }));
      return true;
    }, name);
    if (!found) return false;
    await page.waitForTimeout(500);
    return pickMenu(page, label);
  };
  const sql = (query) => {
    const dbs = ['media-organizer', 'parallx-community.media-organizer'].map((id) => path.join(workspace, '.parallx', 'extensions', id, 'data.db'));
    const script = `const D=require('better-sqlite3');const out=[];for(const p of ${JSON.stringify(dbs)}){try{const d=new D(p,{readonly:true});out.push(d.prepare(${JSON.stringify(query)}).all());d.close();}catch(e){out.push(String(e.message));}}console.log(JSON.stringify(out));`;
    const r = spawnSync(ELECTRON, ['-e', script], { cwd: PROJECT_ROOT, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', windowsHide: true });
    try { return JSON.parse(r.stdout.trim().split(/\r?\n/).pop()); } catch { return [r.stderr || r.stdout]; }
  };
  const workFolders = async () => (await fs.readdir(path.join(workspace, '.parallx'), { recursive: true })).filter((f) => /\.enhance-video-[a-z0-9]+$/.test(f));

  try {
    await page.setViewportSize({ width: 1500, height: 950 }).catch(() => {});
    await page.waitForSelector('[data-part-id="workbench.parts.titlebar"]', { state: 'attached', timeout: 90_000 });
    await page.waitForTimeout(3_000);
    await page.evaluate(async () => { await window.__parallx_workbench__._services.get({ id: 'IToolEnablementService' }).setEnablement('parallx-community.media-organizer', true); });
    await page.waitForTimeout(3_000);
    check((await run('media-organizer.openGrid')) === 'ok', 'the library opens');
    await page.waitForSelector(px('media-organizer.layout.grid'), { timeout: 30_000 });
    await page.click(px('media-organizer.layout.grid')); // the layout whose cards carry their names
    await page.waitForSelector('.mo-card, .mo-list-row', { timeout: 30_000 });
    await page.waitForTimeout(2_500);

    // ── the menu, and what the dialog says ──
    check(await menuOn('harbour', 'Enhance Video…'), 'a video\'s menu offers Enhance Video…');
    await page.waitForSelector(px(`${ID}.go`), { timeout: 30_000 });
    const said = (await texts('.mo-ev-dialog p')).join(' | ');
    check(/640 × 360 becomes 1280 × 720\./.test(said), `it says what the clip becomes: ${said.slice(0, 110)}`);
    check(/8 seconds, 192 frames\. It takes about \d+ (seconds|minutes)/.test(said), 'its length, its frames and how long the run takes');
    check(/new video beside the original, with its sound/.test(said), 'and that the original is never changed');
    check((await texts(`${px(`${ID}.preview`)}`)).join('') === 'Preview 3 Seconds', 'a preview is offered before the whole clip');
    // Keyboard: Tab stays inside the dialog, every control has a name, and the focused one shows a ring.
    const walk = [];
    for (let i = 0; i < 6; i++) { await page.keyboard.press('Tab'); walk.push(await page.evaluate(() => { const e = document.activeElement; const cs = getComputedStyle(e); return { inside: !!e.closest('.mo-ev-dialog'), name: (e.getAttribute('aria-label') || e.textContent || '').trim(), ring: cs.outlineStyle !== 'none' || cs.boxShadow !== 'none' }; })); }
    check(walk.every((w) => w.inside && w.name && w.ring), `Tab stays inside the dialog, on named controls that show focus (${[...new Set(walk.map((w) => (w.inside ? w.name : 'OUTSIDE')))].join(', ')})`);
    await page.mouse.move(700, 80); await page.waitForTimeout(500);
    await shot('enhance-video-1-dialog.png');

    // ── the preview: the enlarged three seconds over the original ──
    await page.click(px(`${ID}.preview`));
    await page.waitForSelector('.mo-ev-compare', { timeout: 90_000 });
    await page.waitForTimeout(1_500);
    const cmp = await page.evaluate(() => { const b = document.querySelector('.mo-ev-compare'); const [before, after] = b.querySelectorAll('video'); return { after: [after.videoWidth, after.videoHeight], before: [before.videoWidth, before.videoHeight], at: b.style.getPropertyValue('--mo-ev-at'), beforeTime: before.currentTime }; });
    check(cmp.after.join('x') === '1280x720' && cmp.before.join('x') === '640x360', `the preview shows the enlarged clip (${cmp.after.join(' x ')}) over the original (${cmp.before.join(' x ')})`);
    check(cmp.beforeTime >= 2.3, `the original is shown at the same moment of the clip (${cmp.beforeTime.toFixed(2)} s in)`);
    await page.focus('.mo-ev-range'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
    const moved = await page.evaluate(() => document.querySelector('.mo-ev-compare').style.getPropertyValue('--mo-ev-at'));
    check(cmp.at === '50%' && moved === '52%', `the line between them moves by the keyboard (${cmp.at} -> ${moved})`);
    await shot('enhance-video-2-preview.png');

    // ── the run, stopped part of the way ──
    await delay(1.5);
    await page.click(px(`${ID}.go`));
    await page.waitForSelector(px(`${ID}.stop`), { timeout: 15_000 });
    await page.waitForFunction(() => /frame ([89]\d|1\d\d) of 192/.test((document.querySelector('.mo-ev-dialog .mo-gen-running') || {}).textContent || ''), null, { timeout: 60_000 });
    check(true, `it says where it is: ${(await texts('.mo-ev-dialog .mo-gen-running')).join('')}`);
    await shot('enhance-video-3-running.png');
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    check((await page.locator('.mo-ev-dialog').count()) === 1, 'Escape does not close it while it runs');
    await page.click(px(`${ID}.stop`));
    await page.waitForSelector(px(`${ID}.go`), { timeout: 30_000 });
    const keptSaid = (await texts('.mo-ev-kept p')).join('');
    const keptN = Number((/kept: (\d+) of 192/.exec(keptSaid) || [])[1] || 0);
    check(keptN >= 80 && keptN < 192 && keptN % 80 === 0 && (await workFolders()).some((f) => existsSync(path.join(workspace, '.parallx', f, 'state.json'))), `Stop keeps the whole chunks that were done (${keptSaid.slice(0, 70)})`);
    check((await texts(px(`${ID}.go`))).join('') === 'Carry On Enhancing' && readdirSync(photos).filter((f) => /harbour/.test(f)).join() === 'harbour.mp4', 'it offers to carry on, and nothing half-made is left beside the original');
    await shot('enhance-video-4-stopped.png');

    // ── the card in use ──
    await card(9200);
    await page.click(px(`${ID}.go`));
    await page.waitForSelector('.mo-ev-dialog .mo-gen-card', { timeout: 15_000 });
    const inUse = (await texts('.mo-ev-dialog .mo-gen-card .mo-gen-dim')).join(' ');
    check(/needs about \d+ GB free\. 9 GB of 32 GB is free/.test(inUse), `with the card in use it says how much is free: ${inUse.slice(0, 70)}`);
    await shot('enhance-video-5-card-in-use.png');
    await card(30000);
    await delay(0.05);
    await page.click(px(`${ID}.aside`));

    // ── carried on to the end: the file, and the library ──
    await page.waitForFunction(() => !document.querySelector('.mo-ev-dialog'), null, { timeout: 120_000 });
    const made = path.join(photos, 'harbour-2x.mp4');
    check(existsSync(made), 'the result is a new file beside the original: harbour-2x.mp4');
    const streams = existsSync(made) ? probeOf(made) : [];
    const v = streams.find((s) => s.codec_type === 'video') || {}, a = streams.find((s) => s.codec_type === 'audio');
    check(v.width === 1280 && v.height === 720 && Number(v.nb_read_frames) === FRAMES, `twice the size with every frame (${v.width} x ${v.height}, ${v.nb_read_frames} of ${FRAMES} frames)`);
    check(!!a && a.codec_name === 'aac', `and the original's sound (${a ? a.codec_name : 'none'})`);
    check(probeOf(path.join(photos, 'harbour.mp4')).some((s) => s.width === 640), 'the original is as it was');
    await page.waitForTimeout(2_500);
    const rows = sql("SELECT f.basename AS name FROM mo_videos v JOIN mo_videos_files vf ON vf.video_id = v.id JOIN mo_files f ON f.id = vf.file_id ORDER BY f.basename");
    const names = rows.flatMap((r) => (Array.isArray(r) ? r.map((x) => x.name) : []));
    check(names.includes('harbour-2x.mp4') && names.includes('harbour.mp4'), `both are in the library (${[...new Set(names)].join(', ')})`);
// Their files are erased the user's way (Eraser, where it is installed, works on after this); what marks a folder
    // as finished at once is that its state file is gone, and the next start's sweep takes such a folder.
    const left = await workFolders();
    const marked = left.filter((f) => existsSync(path.join(workspace, '.parallx', f, 'state.json')));
    check(marked.length === 0, `no work folder is left marked as a run to carry on (${left.length} being erased, ${marked.length} with a state file)`);

    // ── a GIF comes back a GIF ──
    check(await menuOn('wave', 'Enhance GIF…'), 'a GIF\'s menu offers Enhance GIF…');
    await page.waitForSelector(px(`${ID}.go`), { timeout: 30_000 });
    const gifSaid = (await texts('.mo-ev-dialog p')).join(' | ');
    check(/320 × 240 becomes 640 × 480\./.test(gifSaid) && /new GIF beside the original/.test(gifSaid) && (await page.locator(px(`${ID}.preview`)).count()) === 0, `the dialog is the GIF's: ${gifSaid.slice(0, 90)}`);
    await page.click(px(`${ID}.go`));
    await page.waitForFunction(() => !document.querySelector('.mo-ev-dialog'), null, { timeout: 120_000 });
    const gif = path.join(photos, 'wave-2x.gif');
    const g = existsSync(gif) ? (probeOf(gif).find((s) => s.codec_type === 'video') || {}) : {};
    check(g.codec_name === 'gif' && g.width === 640 && g.height === 480 && Number(g.nb_read_frames) === 20, `wave-2x.gif is a GIF twice the size with every frame (${g.width} x ${g.height}, ${g.nb_read_frames} frames)`);

    check(errors.length === 0, `no errors in the window${errors.length ? `: ${errors.slice(0, 3).join(' || ')}` : ''}`);
  } catch (err) {
    failed++; console.log(`[probe] FAIL stopped: ${(err && err.message) || err}`);
    await shot('enhance-video-stopped.png').catch(() => {});
    console.log(`[probe] the dialog said: ${(await texts('.mo-ev-dialog p').catch(() => [])).join(' | ').slice(0, 400)}`);
    if (errors.length) console.log(`[probe] window errors: ${errors.slice(0, 4).join(' || ')}`);
    for (const f of (await fs.readdir(path.join(workspace, '.parallx'), { recursive: true }).catch(() => [])).filter((x) => /engine-last\.log$/.test(x))) console.log(`[probe] the engine last said: ${(await fs.readFile(path.join(workspace, '.parallx', f), 'utf8')).slice(-700)}`);
  } finally {
    await app.close().catch(() => {});
    await fs.rm(workspace, { recursive: true, force: true }).catch(() => {});
    await fs.rm(appRoot, { recursive: true, force: true }).catch(() => {});
  }
  console.log(failed ? `[probe] ${failed} FAILED` : '[probe] 0 problems');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
