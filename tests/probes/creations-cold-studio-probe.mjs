// Hidden-window probe for the owner's failure of 2026-11-02: open the app,
// go straight to Creations, rewrite one field of a character with AI, and
// nothing comes (the engine broker ran every call at the launch warm-up's
// 256K, past the card). Plays exactly that against the REAL Ollama on this
// machine (no stand-in), with the Creations default model at Auto context
// (the worst case: nothing remembered, nothing loaded), and measures the
// time from the click to the first text in the field. Reads Ollama's server
// log for the sizes the model was loaded at: none may exceed 131072.
//
// Usage: node tests/probes/creations-cold-studio-probe.mjs <outDir> [model]
// (the app built; Ollama running with the model installed; uses the GPU)
import { _electron as electron } from 'playwright';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const outDir = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'parallx-cold-studio'));
const MODEL = process.argv[3] || 'gemma4:31b';
const OLLAMA_LOG = path.join(process.env.LOCALAPPDATA || '', 'Ollama', 'server.log');
const now = Date.now();

const VOICE = 'Says little and says it slowly.\nAnswers a question with a fact about the weather.\nGoes quieter when angry, never louder.';
const CHARACTER = {
  name: 'Tom Hale', tagline: 'Keeps the estate\'s game and its secrets',
  description: 'Tom Hale has kept the game on the Harrow Court estate for eleven years and lives in the keeper\'s cottage by the river.',
  appearance: 'Overview: Weathered and watchful.\n\nHeight and build: Five foot ten, broad through the back.\n\nFace: A long jaw, pale grey eyes.\n\nClothes: A waxed jacket gone pale at the seams.\n\nPhysicality: Stands with his weight on the back foot.',
  personality: 'Dry, patient and quietly funny; he wants to be left alone and cannot leave anyone in trouble.',
  voice: VOICE,
  backstory: 'Born in the valley in 1984, the son of the last keeper, he left for the army at eighteen and came back at twenty-nine when his father died.',
  drives: 'Wants: the cottage to stay his.\nFears: the estate being sold.\nIn the way: Lord Ashby\'s debts.',
  secrets: 'He knows where the north wood money went.',
  relationships: 'Lord Ashby: his employer, who pays late.\nNell Hale: his sister, who runs the pub.',
  exampleDialogue: '[USER]: Seen any poachers?\n[AI]: Seen boot prints by the weir. Size ten. Townie boots.\n[USER]: Do you trust his lordship?\n[AI]: I trust the river. It has never once lied about the weather.\n[USER]: Cold tonight.\n[AI]: Frost by four. Bring the dog in.',
  reminder: 'Tom has kept the Harrow Court game for eleven years; Lord Ashby owes him two months\' pay.',
};

function launchEnv(appRoot) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE') env[k] = v;
  Object.assign(env, { PARALLX_TEST_MODE: '1', PARALLX_RENDERER_PORT: '0', PARALLX_HIDDEN_PROBE: '1', PARALLX_APP_ROOT: appRoot, PARALLX_USER_DATA: path.join(appRoot, 'data', 'chromium-cache') });
  return env;
}

async function logLines() {
  try { return (await fs.readFile(OLLAMA_LOG, 'utf8')).split('\n'); } catch { return []; }
}

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  const stamp = Date.now();
  const appRoot = path.join(os.tmpdir(), `parallx-cold-root-${stamp}`);
  const workspace = path.join(os.tmpdir(), `parallx-cold-ws-${stamp}`);
  const extRoot = path.join(workspace, '.parallx', 'extensions', 'text-generator');
  await fs.mkdir(path.join(appRoot, 'data'), { recursive: true });
  await fs.mkdir(path.join(extRoot, 'characters'), { recursive: true });
  await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: workspace }));
  await fs.symlink(path.join(PROJECT_ROOT, 'ext'), path.join(appRoot, 'ext'), 'junction');
  await fs.writeFile(path.join(workspace, '.parallx', 'ai-config.json'), JSON.stringify({ overrides: { indexing: { autoIndex: false, watchFiles: false } } }));
  await fs.writeFile(path.join(extRoot, 'settings.json'), JSON.stringify({ defaultModel: MODEL, defaultContextWindow: 0 }, null, 2));
  await fs.writeFile(path.join(extRoot, 'characters', 'tom-hale.json'), JSON.stringify({ id: 'char-tom', createdAt: now - 3_600_000, updatedAt: now - 3_600_000, name: CHARACTER.name, studio: { mode: 'concept', concept: 'The Harrow Court gamekeeper', sheet: CHARACTER } }, null, 2));
  const logStart = (await logLines()).length;
  console.log(`[probe] workspace ${workspace}; model ${MODEL} at Auto; Ollama log from line ${logStart}`);

  const app = await electron.launch({ args: ['.', '--mute-audio'], cwd: PROJECT_ROOT, env: launchEnv(appRoot) });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
  const run = (id, ...args) => page.evaluate(async ({ id, args }) => {
    const svc = window.__parallx_workbench__?._services?.get?.({ id: 'ICommandService' });
    try { await svc.executeCommand(id, ...args); return 'ok'; } catch (e) { return `failed: ${String(e).slice(0, 160)}`; }
  }, { id, args });
  const click = async (selector, text) => {
    const loc = text ? page.locator(selector, { hasText: text }).first() : page.locator(selector).first();
    await loc.waitFor({ state: 'visible', timeout: 10_000 });
    await loc.click();
    await page.waitForTimeout(800);
  };
  let verdict = 'FAIL';
  try {
    await page.setViewportSize({ width: 1400, height: 900 }).catch(() => {});
    await page.waitForSelector('[data-part-id="workbench.parts.titlebar"]', { state: 'attached', timeout: 90_000 });
    await page.waitForTimeout(3_000);
    await page.evaluate(async () => {
      const svc = window.__parallx_workbench__._services.get({ id: 'IToolEnablementService' });
      try { await svc.setEnablement('parallx-community.creations-ai', true); } catch (e) { console.warn(String(e)); }
    });
    await page.waitForTimeout(4_000);
    console.log(`[probe] openCharacters: ${await run('textGenerator.openCharacters')}`);
    await click('.cr-gallery-tools button', 'Characters').catch(() => {});
    await click('.cr-card', 'Tom Hale');
    await page.waitForSelector('.cs-row[data-key="voice"] textarea.cs-row-text', { timeout: 20_000 });
    const before = await page.locator('.cs-row[data-key="voice"] textarea.cs-row-text').inputValue();
    console.log(`[probe] Studio open; voice before: ${before.split('\n')[0]}`);

    // The owner's step: rewrite one field with AI. The rewrite button opens the direction box; its Rewrite runs it.
    const t0 = Date.now();
    await click('.cs-row[data-key="voice"] button[aria-label^="Rewrite voice"]');
    await click('.cs-row[data-key="voice"] .cs-row-steer button', 'Rewrite');
    const tQueued = Date.now();
    let tWriting = 0, tFirstText = 0, after = before, error = '';
    const deadline = t0 + 6 * 60_000;
    while (Date.now() < deadline) {
      const st = await page.evaluate(() => {
        const row = document.querySelector('.cs-row[data-key="voice"]');
        const err = [...row.querySelectorAll('*')].map((e) => (e.textContent || '').trim()).find((t) => /could not|not answering|gave no answer|failed/i.test(t) && t.length < 400) || '';
        return { writing: row.classList.contains('cs-row--writing') || row.classList.contains('cs-row--queued'), value: row.querySelector("textarea.cs-row-text").value, err };
      });
      if (st.writing && !tWriting) tWriting = Date.now();
      if (st.value !== before && !tFirstText) { tFirstText = Date.now(); after = st.value; }
      if (st.err) { error = st.err; break; }
      if (tFirstText && !st.writing) { after = st.value; break; }
      await page.waitForTimeout(500);
    }
    const secs = (t) => (t ? ((t - t0) / 1000).toFixed(1) + 's' : 'never');
    console.log(`[probe] clicked +0s; queued ${secs(tQueued)}; writing ${secs(tWriting)}; first text ${secs(tFirstText)}; done ${secs(Date.now())}`);
    if (error) console.log(`[probe] row error: ${error}`);
    console.log(`[probe] voice after: ${after.split('\n').slice(0, 4).join(' | ').slice(0, 300)}`);
    await page.screenshot({ path: path.join(outDir, 'studio-after.png'), timeout: 8_000 }).catch(() => {});

    const lines = (await logLines()).slice(logStart);
    const loads = lines.filter((l) => /predicted_num_ctx=|loaded runners|evicting|n_ctx_seq/.test(l)).map((l) => l.replace(/^.*(msg=|llama_context: )/, '').slice(0, 160));
    console.log('[probe] Ollama since launch:'); for (const l of loads) console.log(`  ${l}`);
    const sizes = [...lines.join('\n').matchAll(/predicted_num_ctx=(\d+)/g)].map((m) => +m[1]);
    const over = sizes.filter((n) => n > 131072);
    const ok = !!tFirstText && !error && after !== before && over.length === 0;
    verdict = ok ? 'OK' : 'FAIL';
    console.log(`[probe] sizes loaded: ${sizes.join(', ') || '(none logged)'}; over 131072: ${over.length}`);
    if (errors.length) console.log(`[probe] page errors: ${errors.join(' || ')}`);
  } finally {
    await app.close().catch(() => {});
    console.log(`[probe] VERDICT ${verdict}`);
  }
  process.exit(verdict === 'OK' ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
