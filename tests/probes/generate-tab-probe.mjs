// Hidden-window probe: the Image Editor's Generate tab, start to finish, with
// no graphics card. The engine is stood in for: a runtime whose Python is the
// machine's own and whose generate.py writes plain coloured patches, so what
// is checked is everything around the model: the tab and its three steps,
// marking an area, the job that is written, progress, the tries, a try shown
// on the photo, Keep storing a patch, and the photo changing. It starts one
// step short of set up: the set-up's last step, a test edit, meets a card
// that is in use, and the tab offers to set the chat model aside and finish.
//
// Usage: node tests/probes/generate-tab-probe.mjs <outDir>   (run from Bash)
import { _electron as electron } from 'playwright';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { PROJECT_ROOT, launchEnv } from './scene.mjs';

const outDir = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'parallx-generate-tab'));
const ELECTRON = path.join(PROJECT_ROOT, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const SEED = path.join(PROJECT_ROOT, 'tests', 'probes', 'tag-review-seed.cjs');
const ID = 'media-organizer.imageEditor.generate';
const px = (id) => `[data-px-id="${id}"]`;

// The stand-in for engine/generate.py: the standard library only. It writes
// each try as one colour, opaque in the middle of the piece and clear round it.
const STUB = String.raw`
import json, struct, sys, time, zlib, os
job = json.load(open(sys.argv[sys.argv.index('--job') + 1], encoding='utf-8'))
head = open(job['input'], 'rb').read(32)
w, h = struct.unpack('>II', head[16:24])
def png(colour):
    rows = b''
    for y in range(h):
        row = bytearray([0])
        for x in range(w):
            inside = w * 0.25 <= x < w * 0.75 and h * 0.25 <= y < h * 0.75
            row += bytes(colour) + bytes([255 if inside else 0])
        rows += bytes(row)
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(rows, 1)) + chunk(b'IEND', b'')
os.makedirs(job['output'], exist_ok=True)
print(json.dumps({'stage': 'load'}), flush=True)
tries = []
for n, colour in enumerate([(230, 40, 40), (40, 200, 60), (50, 90, 235)][:job.get('tries', 1)], start=1):
    for step in (10, 25, 40):
        print(json.dumps({'stage': 'generate', 'try': n, 'of': job.get('tries', 1), 'step': step, 'steps': 40}), flush=True)
        time.sleep(0.25)
    open(os.path.join(job['output'], 'try-%d.png' % n), 'wb').write(png(colour))
    tries.append({'file': 'try-%d.png' % n, 'box': [0, 0, w, h], 'seed': job.get('seed', 42) + n - 1, 'seconds': 0.8, 'held_db': 40.0})
    print(json.dumps({'stage': 'tried', 'try': n, 'of': job.get('tries', 1), 'file': 'try-%d.png' % n}), flush=True)
written = 'Remove the thing in the middle of the picture and continue what is behind it.'
asked = job.get('write_prompt', True)
result = {'prompt': written if asked else job['instruction'], 'prompt_by': 'engine' if asked else 'instruction', 'note': '', 'model_size': [w, h], 'steps': 40, 'tries': tries, 'peak_gb': 0}
json.dump(result, open(os.path.join(job['output'], 'result.json'), 'w'))
print(json.dumps(dict(stage='done', **result)), flush=True)
`;

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  const stamp = Date.now();
  const appRoot = path.join(os.tmpdir(), `parallx-gen-root-${stamp}`);
  const workspace = path.join(os.tmpdir(), `parallx-gen-ws-${stamp}`);
  const photos = path.join(workspace, 'photos');
  const runtimes = path.join(appRoot, 'runtimes');
  await fs.mkdir(path.join(appRoot, 'data'), { recursive: true });
  await fs.mkdir(photos, { recursive: true });
  await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: workspace }));
  await fs.writeFile(path.join(workspace, '.parallx-keep'), '');
  await fs.mkdir(path.join(workspace, '.parallx'), { recursive: true });
  await fs.writeFile(path.join(workspace, '.parallx', 'ai-config.json'), JSON.stringify({ overrides: { indexing: { autoIndex: false, watchFiles: false } } }));

  // The app's extensions, with the Media Organizer as a copy whose engine script is the stand-in.
  await fs.mkdir(path.join(appRoot, 'ext'));
  for (const name of readdirSync(path.join(PROJECT_ROOT, 'ext'), { withFileTypes: true })) {
    if (!name.isDirectory()) continue;
    const from = path.join(PROJECT_ROOT, 'ext', name.name), to = path.join(appRoot, 'ext', name.name);
    if (name.name !== 'media-organizer') { await fs.symlink(from, to, 'junction'); continue; }
    await fs.cp(from, to, { recursive: true, filter: (src) => !/[\\/]engine[\\/]seedvr2([\\/]|$)/.test(src) });
  }
  const engineDir = path.join(appRoot, 'ext', 'media-organizer', 'engine');
  await fs.writeFile(path.join(engineDir, 'generate.py'), STUB);
  {
    // The copy's declaration is the stand-in's: its model files are empty, so it asks for no disk; and where the
    // probe runs on another system than Windows (a cloud checkout), it is declared for that one.
    const enginePath = path.join(appRoot, 'ext', 'media-organizer', 'generate-engine.js');
    const declared = readFileSync(enginePath, 'utf8');
    let here = declared.replace('diskBytes: 45 * 1024 ** 3', 'diskBytes: 1024 ** 2');
    if (process.platform !== 'win32') here = here.replace("locks: { win32: enginePath('requirements-generate-win.lock') }", `locks: { ${process.platform}: enginePath('requirements-generate-win.lock') }`).replace("platforms: ['win32-x64']", `platforms: ['${process.platform}-${process.arch}']`);
    if (here === declared || (process.platform !== 'win32' && here.includes("platforms: ['win32-x64']"))) throw new Error('the engine\'s declaration is not where the probe expects it');
    await fs.writeFile(enginePath, here);
  }

  // A runtime with everything in place but its self-test: the machine's own Python, the model's files
  // as empty stand-ins. The self-test is a stand-in too: it fails for want of graphics memory while
  // the file `card-full` is there.
  const cardFull = path.join(appRoot, 'card-full');
  await fs.writeFile(cardFull, '');
  await fs.writeFile(path.join(engineDir, 'selftest-generate.py'), `import os, sys\nif os.path.exists(${JSON.stringify(cardFull)}):\n    print('GENERATE-ERROR: Generate needs about 21 GB of free graphics memory; 9 GB is free. Set the chat model aside and try again.', file=sys.stderr)\n    sys.exit(2)\nprint('{"selftest":"ok"}')\n`);
  const rt = path.join(runtimes, 'qwen-image-generate');
  await fs.mkdir(path.join(rt, 'files'), { recursive: true });
  const venv = spawnSync('python', ['-m', 'venv', path.join(rt, 'env')], { encoding: 'utf8', windowsHide: true });
  if (venv.status !== 0) { console.log(`[probe] SKIP no Python to stand in for the engine: ${venv.stderr || venv.stdout}`); process.exit(2); }
  const models = JSON.parse(readFileSync(path.join(engineDir, 'generate-models.json'), 'utf8')).files;
  const kept = {};
  for (const m of models) { await fs.writeFile(path.join(rt, 'files', m.name), ''); kept[m.name] = m.sha256; }
  const lock = readFileSync(path.join(engineDir, 'requirements-generate-win.lock'), 'utf8');
  const uvVersion = /UV_VERSION = '([^']+)'/.exec(readFileSync(path.join(PROJECT_ROOT, 'electron', 'runtimeBridge.cjs'), 'utf8'))[1];
  await fs.mkdir(path.join(rt, 'uv'), { recursive: true });
  await fs.writeFile(path.join(rt, 'uv', process.platform === 'win32' ? 'uv.exe' : 'uv'), '');
  await fs.writeFile(path.join(rt, 'state.json'), JSON.stringify({ uv: uvVersion, python: '3.13.16', packages: crypto.createHash('sha256').update(`3.13.16\n${lock}`).digest('hex'), files: kept, selftest: false }));

  // The photos the library seed knows (tag-review-seed.cjs), fractal.jpg among them: photo 3.
  const BOXING = path.join(PROJECT_ROOT, 'data', 'dashboard-assets', 'aa21bc3e-d260-41ac-8bcf-ab5efe10d0cb.jpg');
  if (!existsSync(BOXING)) { console.log('[probe] SKIP the seed photo is not on this machine'); process.exit(2); }
  await fs.copyFile(BOXING, path.join(photos, 'boxing.jpg'));
  await fs.copyFile(BOXING, path.join(photos, 'marked.jpg'));
  const gen = [['card.jpg', 'testsrc2=size=2400x1600', 2400, 1600], ['fractal.jpg', 'mandelbrot=size=1800x1200', 1800, 1200], ['bars.jpg', 'smptehdbars=size=1920x1080', 1920, 1080]];
  for (const [name, src] of gen) {
    const made = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', src, '-frames:v', '1', '-q:v', '3', path.join(photos, name)], { windowsHide: true });
    if (made.status !== 0) { console.log('[probe] SKIP ffmpeg is needed to make the test photos'); process.exit(2); }
  }
  const specPath = path.join(appRoot, 'spec.json');
  await fs.writeFile(specPath, JSON.stringify([{ basename: 'boxing.jpg', width: 564, height: 846 }, ...gen.map(([basename, , width, height]) => ({ basename, width, height })), { basename: 'marked.jpg', width: 564, height: 846 }]));
  for (const id of ['media-organizer', 'parallx-community.media-organizer']) {
    const db = path.join(workspace, '.parallx', 'extensions', id, 'data.db');
    const r = spawnSync(ELECTRON, [SEED, 'seed', db, photos, specPath], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', windowsHide: true });
    if (r.status !== 0) throw new Error(`seed failed: ${r.stderr || r.stdout}`);
  }

  // What the app is told the graphics card has: first a chat model on it, later room.
  const cardsFile = path.join(appRoot, 'cards.json');
  const card = (freeMiB) => fs.writeFile(cardsFile, JSON.stringify([{ name: 'Test Card', vramMiB: 32607, freeMiB, driver: '580.00' }]));
  await card(9200);
  const env = launchEnv(appRoot);
  env.PARALLX_RUNTIMES_DIR = runtimes;
  env.PARALLX_TEST_GPU_CARDS_FILE = cardsFile;
  const app = await electron.launch({ args: ['.', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--mute-audio'], cwd: PROJECT_ROOT, env });
  await app.context().route(/^https?:\/\/(localhost|127\.0\.0\.1):11434\//, (route) => route.abort('connectionrefused'));
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 300)}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_CONNECTION_REFUSED|Cannot connect to Ollama/.test(m.text())) errors.push(`console: ${m.text().slice(0, 300)}`); });
  let failed = 0;
  const check = (ok, what) => { if (!ok) failed++; console.log(`[probe] ${ok ? 'PASS' : 'FAIL'} ${what}`); };
  const shot = async (name) => {
    // A hidden window can hand back its last painted frame: ask for a fresh one, and keep the second capture.
    const b64 = await app.evaluate(async ({ BrowserWindow }) => { const wc = BrowserWindow.getAllWindows()[0].webContents; wc.invalidate(); await new Promise((r) => setTimeout(r, 250)); await wc.capturePage(); await new Promise((r) => setTimeout(r, 400)); const img = await wc.capturePage(); return img.isEmpty() ? '' : img.toPNG().toString('base64'); });
    if (b64) { await fs.writeFile(path.join(outDir, name), Buffer.from(b64, 'base64')); console.log(`[probe] screenshot -> ${path.join(outDir, name)}`); }
  };
  const texts = (sel) => page.evaluate((s) => [...document.querySelectorAll(s)].map((e) => e.textContent.trim()), sel);
  const stageSum = () => page.evaluate(() => {
    const cv = document.querySelector('.mo-edit-stage canvas');
    if (!cv) return -1;
    const t = document.createElement('canvas'); t.width = 64; t.height = 64;
    const g = t.getContext('2d'); g.drawImage(cv, 0, 0, 64, 64);
    const d = g.getImageData(0, 0, 64, 64).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] * 3 + d[i + 1] * 5 + d[i + 2] * 7; return s;
  });

  try {
    await page.setViewportSize({ width: 1500, height: 950 }).catch(() => {});
    await page.waitForSelector('[data-part-id="workbench.parts.titlebar"]', { state: 'attached', timeout: 90_000 });
    await page.waitForTimeout(3_000);
    await page.evaluate(async () => { await window.__parallx_workbench__._services.get({ id: 'IToolEnablementService' }).setEnablement('parallx-community.media-organizer', true); });
    await page.waitForTimeout(3_000);
    const opened = await page.evaluate(async () => { try { await window.__parallx_workbench__._services.get({ id: 'ICommandService' }).executeCommand('media-organizer.editImage', 3); return 'ok'; } catch (e) { return String(e && e.message); } });
    await page.waitForSelector(px('media-organizer.imageEditor.tool.generate'), { timeout: 30_000 });
    await page.waitForTimeout(1_500);
    check(opened === 'ok', `the editor opens (${opened})`);
    const tabs = await texts('.mo-edit-tab .mo-edit-tab-label');
    check(tabs.join('/') === 'Edit/Masks/Crop/Remove/Enhance/Generate', `six tabs, Generate last: ${tabs.join('/')}`);

    // ── set-up's last step meets a card in use ──
    await page.click(px('media-organizer.imageEditor.tool.generate'));
    await page.waitForSelector(px(`${ID}.setUp`), { timeout: 15_000 });
    check((await texts(px(`${ID}.setUp`))).join('') === 'Carry On Setting Up', 'a set-up that stopped part of the way offers to carry on');
    await page.click(px(`${ID}.setUp`));
    await page.waitForSelector('.mo-edit-setup .mo-gen-card', { timeout: 60_000 });
    const oneLeft = (await texts('.mo-edit-setup-title, .mo-edit-setup .mo-gen-card .mo-gen-dim')).join(' ');
    check(/One step left/.test(oneLeft) && /9 GB of 32 GB is free/.test(oneLeft), `the test edit found the card in use, and the tab says so: ${oneLeft.slice(0, 90)}`);
    check((await texts(px(`${ID}.aside`))).join('') === 'Set The Chat Model Aside And Finish' && (await page.locator(px(`${ID}.setUp`)).count()) === 0, 'with one button: Set The Chat Model Aside And Finish');
    await page.mouse.move(700, 500); await page.waitForTimeout(600);
    await shot('generate-0-one-step-left.png');
    await fs.rm(cardFull); await card(30000);
    await page.click(px(`${ID}.aside`));

    // ── the tab: three steps ──
    await page.waitForSelector('.mo-gen-step', { timeout: 60_000 });
    check((await page.locator('.mo-gen-card').count()) === 0, 'and the set-up finishes once there is room');
    await card(9200);
    const steps = await texts('.mo-gen-step-title');
    check(steps.join(' / ') === 'Mark the area / Say what to do there / Pick a result', `three steps: ${steps.join(' / ')}`);
    const go = page.locator(px(`${ID}.generate`));
    check(await go.isDisabled(), 'Generate waits for an area to be marked');
    await shot('generate-1-empty.png');

    // ── 1: brush over the photo ──
    const stage = await page.locator('.mo-edit-stage').boundingBox();
    const cx = stage.x + stage.width / 2, cy = stage.y + stage.height / 2;
    await page.mouse.move(cx - 120, cy - 40);
    await page.mouse.down();
    await page.mouse.move(cx, cy, { steps: 8 });
    await page.mouse.move(cx + 120, cy + 30, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(500);
    check((await texts('.mo-gen-ok')).join('') === 'Marked', 'brushing marks the area');
    check(!(await go.isDisabled()), 'and Generate is offered');
    const inked = await page.evaluate(() => { const c = document.querySelector('.mo-gen-ink'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 20) n++; return n; });
    check(inked > 2000, `the mark is drawn over the photo (${inked} px)`);

    // ── 2: the instruction, from a ready-made start, then typed ──
    await page.click(px(`${ID}.start.2`));
    const text = page.locator('.mo-gen-text');
    check((await text.inputValue()) === 'Replace what is marked with ', `a start fills the instruction: ${JSON.stringify(await text.inputValue())}`);
    await text.type('a small red tractor');
    await shot('generate-2-marked.png');
    const before = await stageSum();

    // ── the card is in use: the numbers, and one button ──
    await go.click();
    await page.waitForSelector('.mo-gen-card', { timeout: 10_000 });
    const inUse = (await texts('.mo-gen-card .mo-gen-dim')).join(' ');
    check(/needs about 21 GB free\. 9 GB of 32 GB is free/.test(inUse), `with the card in use it says how much is free: ${inUse.slice(0, 80)}`);
    check((await page.locator('.mo-gen-thumb').count()) === 0 && (await page.locator('.mo-gen-running').count()) === 1, 'and nothing is started');
    await page.waitForTimeout(600);
    await page.click(px(`${ID}.aside`));
    await page.waitForSelector('.mo-gen-card .mo-gen-error', { timeout: 15_000 });
    check(/still not enough free/.test((await texts('.mo-gen-card .mo-gen-error')).join('')), 'when setting the chat model aside frees too little, it says so');
    await page.mouse.move(700, 500); await page.waitForTimeout(800);
    await shot("generate-2b-card-in-use.png");
    await card(30000);
    await page.click(px(`${ID}.aside`));
    await page.waitForSelector('.mo-gen-text + .mo-gen-starts ~ .mo-gen-running:not(.mo-gen-card *)', { timeout: 15_000 }).catch(() => {});
    await page.waitForFunction(() => !document.querySelector('.mo-gen-card'), null, { timeout: 15_000 });
    const running = (await texts('.mo-gen-running')).join('');
    check(/Cutting out|Loading the model|Generating/.test(running), `it says what it is doing: ${running}`);
    check(await page.locator(px(`${ID}.stop`)).isVisible(), 'Stop is offered while it runs');

    // ── 3: the tries ──
    await page.waitForSelector('.mo-gen-thumb', { timeout: 60_000 });
    await page.waitForTimeout(600);
    const thumbs = await page.locator('.mo-gen-thumb').count();
    check(thumbs === 3, `three tries to pick from (${thumbs})`);
    const jobDir = (await fs.readdir(path.join(workspace, '.parallx'), { recursive: true })).filter((f) => /generate-[a-z0-9]+[\\/]job\.json$/.test(f))[0];
    const job = jobDir ? JSON.parse(await fs.readFile(path.join(workspace, '.parallx', jobDir), 'utf8')) : null;
    check(!!job && job.instruction === 'Replace what is marked with a small red tractor' && job.tries === 3 && existsSync(job.input) && existsSync(job.mask), `the job names the piece, the mask and the instruction (${job ? job.instruction : 'no job'})`);
    const pieceSize = job ? (() => { const head = readFileSync(job.input).subarray(16, 24); return { w: head.readUInt32BE(0), h: head.readUInt32BE(4) }; })() : { w: 0, h: 0 };
    check(!!job && job.cut_out === false && job.write_prompt === true && pieceSize.w >= 512 && pieceSize.w <= 1800 && pieceSize.h >= 512 && pieceSize.h < 1200, `the piece is cut out once, at the photo's own pixels, and the engine is asked to write the instruction out (${pieceSize.w} x ${pieceSize.h})`);
    const told = (await texts('.mo-gen-step .mo-gen-dim')).filter((t) => t.startsWith('Written out for the model:'));
    check(told.length === 1 && /Remove the thing in the middle/.test(told[0]), `what the model was given is shown under the tries (${(told[0] || 'nothing').slice(0, 70)})`);
    const shownTry = await page.evaluate(() => { const i = document.querySelector('.mo-gen-try'); const r = i.getBoundingClientRect(); return { hidden: i.classList.contains('mo-hidden'), w: Math.round(r.width), h: Math.round(r.height) }; });
    check(!shownTry.hidden && shownTry.w > 100 && shownTry.h > 80, `the first try is shown on the photo (${shownTry.w} x ${shownTry.h})`);
    await page.click(px(`${ID}.try.2`));
    await page.waitForTimeout(400);
    check((await page.locator(px(`${ID}.try.2`)).getAttribute('aria-pressed')) === 'true', 'choosing a try marks it');
    await shot('generate-3-tries.png');

    // ── keep: a patch, and the photo changes ──
    await page.click(px(`${ID}.keep`));
    await page.waitForTimeout(1_500);
    const patches = (await fs.readdir(path.join(workspace, '.parallx'), { recursive: true })).filter((f) => /edits[\\/]3[\\/]g[a-z0-9]+\.png$/.test(f));
    check(patches.length === 1, `Keep stores one patch beside the photo's edits (${patches.join(', ') || 'none'})`);
    const after = await stageSum();
    check(before !== after && after >= 0, 'the photo shows the kept result');
    check((await page.locator('.mo-gen-thumb').count()) === 0 && (await texts('.mo-gen-ok')).length === 0, 'the tab is ready for the next edit');
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(1_200);
    check((await stageSum()) === before, 'Undo takes the kept result off again');
    await shot('generate-4-kept-undone.png');

    check(errors.length === 0, `no errors in the window${errors.length ? `: ${errors.slice(0, 3).join(' || ')}` : ''}`);
  } finally {
    await app.close().catch(() => {});
    await fs.rm(workspace, { recursive: true, force: true }).catch(() => {});
    await fs.rm(appRoot, { recursive: true, force: true }).catch(() => {});
  }
  console.log(failed ? `[probe] ${failed} FAILED` : '[probe] 0 problems');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
