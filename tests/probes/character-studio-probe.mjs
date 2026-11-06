// Hidden-window probe for Character Studio (docs/CHARACTER_STUDIO.md): a
// throwaway workspace, the app never shown, Ollama blocked. Makes a new
// character, then photographs the stage and every tab, mixes parts, moves
// sliders and colours, times a draw, and checks a saved change comes back
// after the tab is closed and reopened. Every picture is of a clothed
// character (the samples are dressed; nothing here undresses one).
//
// With CS_PORTRAITS=1 it also writes the portrait pictures the part pickers
// show (ext/character-studio/models/portraits/<id>-face.webp and -body.webp).
//
// Usage: node tests/probes/character-studio-probe.mjs <outDir>   (the app built)
import { _electron as electron } from 'playwright';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const outDir = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'parallx-character-studio'));
const PORTRAITS = path.join(PROJECT_ROOT, 'ext', 'character-studio', 'models', 'portraits');

function launchEnv(appRoot) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE') env[k] = v;
  Object.assign(env, { PARALLX_TEST_MODE: '1', PARALLX_RENDERER_PORT: '0', PARALLX_HIDDEN_PROBE: '1', PARALLX_APP_ROOT: appRoot, PARALLX_USER_DATA: path.join(appRoot, 'data', 'chromium-cache') });
  return env;
}

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  const stamp = Date.now();
  const appRoot = path.join(os.tmpdir(), `parallx-cs-root-${stamp}`);
  const workspace = path.join(os.tmpdir(), `parallx-cs-ws-${stamp}`);
  await fs.mkdir(path.join(appRoot, 'data'), { recursive: true });
  await fs.mkdir(path.join(workspace, '.parallx'), { recursive: true });
  await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: workspace }));
  await fs.symlink(path.join(PROJECT_ROOT, 'ext'), path.join(appRoot, 'ext'), 'junction');
  await fs.writeFile(path.join(workspace, '.parallx', 'ai-config.json'), JSON.stringify({ overrides: { indexing: { autoIndex: false, watchFiles: false } } }));

  const app = await electron.launch({ args: ['.', '--mute-audio'], cwd: PROJECT_ROOT, env: launchEnv(appRoot) });
  await app.context().route(/^https?:\/\/(localhost|127\.0\.0\.1):11434\//, (route) => route.abort('connectionrefused'));
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_CONNECTION_REFUSED|11434|Ollama|EmbeddingService|IndexingPipeline/i.test(m.text())) errors.push(`console: ${m.text().slice(0, 300)}`); });
  const run = (id, ...args) => page.evaluate(async ({ id, args }) => {
    const svc = window.__parallx_workbench__?._services?.get?.({ id: 'ICommandService' });
    try { await svc.executeCommand(id, ...args); return 'ok'; } catch (e) { return `failed: ${String(e).slice(0, 200)}`; }
  }, { id, args });
  const shot = async (name) => { await page.waitForTimeout(900); await page.screenshot({ path: path.join(outDir, `${name}.png`), timeout: 90_000 }); console.log(`[probe] ${name}.png`); };
  const tab = async (label) => { await page.locator('.cs-tabs [role="tab"]', { hasText: label }).first().click(); await page.waitForTimeout(600); };
  const setSlider = (key, value) => page.evaluate(({ key, value }) => {
    const host = document.querySelector(`[data-px-id="character-studio.slider.${key}"]`);
    const el = host && (host.tagName === 'INPUT' ? host : host.querySelector('input'));
    if (!el) return false;
    el.value = String(value); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, { key, value });
  const pick = (gridId, value) => page.evaluate(({ gridId, value }) => {
    const t = document.querySelector(`[data-px-id="${gridId}"] [data-value="${value}"]`);
    if (!t) return false; t.click(); return true;
  }, { gridId, value });
  const settle = () => page.waitForFunction(() => { const v = document.querySelector('.cs-canvas')?.csViewer; return v && v.character; }, null, { timeout: 30_000 }).then(() => page.waitForTimeout(2000));

  let verdict = 'FAIL';
  try {
    await page.setViewportSize({ width: 1500, height: 950 }).catch(() => {});
    await page.waitForSelector('[data-part-id="workbench.parts.titlebar"]', { state: 'attached', timeout: 90_000 });
    await page.waitForTimeout(3_000);
    console.log(`[probe] turn on: ${await page.evaluate(async () => {
      const svc = window.__parallx_workbench__._services.get({ id: 'IToolEnablementService' });
      try { await svc.setEnablement('parallx.character-studio', true); return 'ok'; } catch (e) { return String(e); }
    })}`);
    await page.waitForTimeout(4_000);
    console.log(`[probe] new character: ${await run('characterStudio.new')}`);
    await page.waitForSelector('.cs-stage canvas.cs-canvas', { timeout: 60_000 });
    await page.waitForSelector('.cs-tabs [role="tab"]', { timeout: 60_000 });
    await settle();

    if (process.env.CS_EYES) {
      await run('characterStudio.view', '', 'face'); await shot('eyes-1-looking');
      console.log(`[probe] look: ${await page.evaluate(() => { const v = document.querySelector('.cs-canvas').csViewer; const l = v.character.rig.lookAt; const t = l && l.applier && l.applier.constructor.name; if (l) { l.target = null; l.autoUpdate = false; l.reset && l.reset(); } return `${!!l} ${t}`; })}`);
      await shot('eyes-2-still');
    }
    if (process.env.CS_PORTRAITS) {
      await fs.mkdir(PORTRAITS, { recursive: true });
      const ids = await page.evaluate(() => document.querySelector('.cs-canvas').csViewer.catalogue.models.map((m) => m.id));
      for (const id of ids) {
        const pics = await page.evaluate(async (id) => {
          const v = document.querySelector('.cs-canvas').csViewer;
          const data = JSON.parse(JSON.stringify(v.data));
          data.parts = { body: id, face: id, hair: id };
          for (const k of Object.keys(data.colours)) data.colours[k] = 'own';
          data.expression = 'neutral';
          await v.show(data);
          for (let i = 0; i < 30; i++) v.character.update(1 / 30, i / 30);
          return { face: await v.picture({ size: 192, framing: 'face', yaw: 0.25 }), body: await v.picture({ size: 192, framing: 'body', yaw: 0.35 }) };
        }, id);
        for (const [framing, url] of Object.entries(pics)) {
          const png = path.join(outDir, `portrait-${id}-${framing}.png`);
          await fs.writeFile(png, Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
          execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', png, '-c:v', 'libwebp', '-quality', '88', '-pix_fmt', 'yuva420p', path.join(PORTRAITS, `${id}-${framing}.webp`)]);
        }
        console.log(`[probe] portraits for ${id}`);
      }
    }

    const perf = await page.evaluate(() => {
      const v = document.querySelector('.cs-canvas').csViewer; const gl = v.renderer.getContext();
      v.draw(0.016); gl.finish();
      const t0 = performance.now();
      for (let i = 0; i < 20; i++) { v.turn(0.05, 0); v.draw(0.016); gl.finish(); }
      return { size: `${v.canvas.width}x${v.canvas.height}`, msPerFrame: ((performance.now() - t0) / 20).toFixed(2) };
    });
    console.log(`[probe] draw: ${JSON.stringify(perf)}`);
    await run('characterStudio.view', '', 'body');
    await shot('01-character-tab');
    await run('characterStudio.view', '', 'face'); await shot('02-face');
    console.log(`[probe] face from shino: ${await pick('character-studio.part.face', 'shino')}`); await settle();
    console.log(`[probe] hair from hana: ${await pick('character-studio.part.hair', 'hana')}`); await settle();
    await shot('03-mixed-face');
    await run('characterStudio.view', '', 'body');
    await tab('Body');
    for (const [k, v] of [['head', 1.15], ['legs', 1.12], ['bust', 1.3], ['hips', 1.15]]) console.log(`[probe] ${k}=${v}: ${await setSlider(k, v)}`);
    await settle(); await shot('04-body-tab');
    await tab('Face');
    for (const [k, v] of [['eyeSize', 1.25], ['faceWidth', 0.92], ['chin', 0.6]]) console.log(`[probe] ${k}=${v}: ${await setSlider(k, v)}`);
    await run('characterStudio.view', '', 'face'); await settle(); await shot('05-face-tab');
    await tab('Colour');
    for (const [g, v] of [['hair', 'pink'], ['eyes', 'violet'], ['top', 'navy']]) console.log(`[probe] colour ${g}=${v}: ${await pick(`character-studio.colour.${g}`, v)}`);
    await settle(); await shot('06-colour-tab');
    await tab('Mood'); await page.waitForTimeout(4000);
    console.log(`[probe] mood happy: ${await pick('character-studio.expression', 'happy')}`);
    await settle(); await shot('07-mood-tab');
    await run('characterStudio.view', '', 'body');
    console.log(`[probe] randomise: ${await run('characterStudio.randomise', '')}`); await settle(); await shot('08-random');

    // Saved and back: change the height, let it save, close the tab, reopen
    await tab('Body'); await setSlider('height', 1.1); await page.waitForTimeout(2_500);
    const tabEl = page.locator('.ui-tab', { hasText: 'Character' }).first();
    await tabEl.hover().catch(() => {});
    await tabEl.locator('.ui-tab-close').click({ force: true }).catch((e) => console.log(`[probe] close click: ${e.message.split('\n')[0]}`));
    await page.waitForTimeout(1500);
    console.log(`[probe] stages after closing: ${await page.evaluate(() => document.querySelectorAll('.cs-canvas').length)}`);
    console.log(`[probe] reopen: ${await run('characterStudio.open')}`);
    await page.waitForSelector('.cs-tabs [role="tab"]', { timeout: 60_000 });
    await tab('Body');
    const height = await page.evaluate(() => { const h = document.querySelector('[data-px-id="character-studio.slider.height"]'); const i = h && (h.tagName === 'INPUT' ? h : h.querySelector('input')); return i ? i.value : null; });
    console.log(`[probe] height after reopening: ${height} (want 1.1)`);
    if (Math.abs(Number(height) - 1.1) > 0.001) errors.push(`saved height came back as ${height}`);
    const thumb = await page.evaluate(() => !!document.querySelector('.cs-side-row img.cs-side-thumb'));
    console.log(`[probe] list shows a face picture: ${thumb}`);
    console.log(`[probe] errors: ${errors.length ? '\n  ' + errors.join('\n  ') : 'none'}`);
    verdict = errors.length ? 'FAIL' : 'OK';
  } catch (err) {
    console.log(`[probe] stopped: ${err && err.message}`);
    await page.screenshot({ path: path.join(outDir, 'error.png'), timeout: 30_000 }).catch(() => {});
    console.log(`[probe] errors: ${errors.join('\n  ')}`);
  } finally {
    await app.close().catch(() => {});
    await fs.rm(appRoot, { recursive: true, force: true }).catch(() => {});
    await fs.rm(workspace, { recursive: true, force: true }).catch(() => {});
  }
  console.log(`[probe] ${verdict}`);
  process.exitCode = verdict === 'OK' ? 0 : 1;
}

main();
