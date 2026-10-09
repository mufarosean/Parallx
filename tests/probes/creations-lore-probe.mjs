// Hidden-window probe for lorebooks in a Creations AI roleplay
// (docs/CREATIONS_AI.md, Lorebooks; ext/creations-ai/lore.js). A stand-in
// Ollama on localhost:11434 records what the turn is sent. Two characters,
// each with a lorebook of their own; the player names Lord Ashby, and
// Blackstone was named a few messages back. Checks the prompt the model got:
// the world's overview, those two entries in full, every other entry as one
// line, "rain" not fired by "train", a character-scoped entry left out, both
// characters' books used; then the Prompt Inspector's account of each entry.
// Usage: xvfb-run -a node tests/probes/creations-lore-probe.mjs <outDir>
// (needs port 11434 free, the app built, and the sqlite module built for Electron)
import { _electron as electron } from 'playwright';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const outDir = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'parallx-lore'));
const now = Date.now();
const H = 3_600_000;

const VALLEY = `---
name: The Valley
---

# The Valley

A river valley in the north, wet nine months of the year.

## Blackstone Keep
triggers: blackstone
summary: the Ashby family's ruined fortress above the river
The keep burned in 1888. Its cellars still flood every spring.

## Lord Ashby
Owns the valley and sells it a field at a time to pay his debts.

## Rainfall
triggers: rain
It rains on the valley almost every day from September to May.

## The Hollow Folk
scope: character:Nell Hale
They live under the hill.
`;
const SALT = `---
name: Salt Coast
---

## The Harbourmaster
summary: sold the drowned city twice
He keeps the only key to the sea wall.
`;
// The chat's own world lore: on no character, picked in Chat Settings.
const WORLD = `---
name: The Northern Reach
---

# The Northern Reach

Three valleys under one failing crown; the roads close from November to March.

## The Crown Tax
summary: a tithe of one sheep in ten, collected at midsummer
The collectors come with soldiers, and the Ashbys pay late every year.
`;
const sheet = (o) => ({ name: '', tagline: '', description: '', appearance: '', personality: '', voice: '', backstory: '', drives: '', secrets: '', relationships: '', exampleDialogue: '', reminder: '', ...o });
const CHARACTERS = [
  ['tom-hale.json', { name: 'Tom Hale', roleInstruction: 'Tom keeps the game on the Ashby estate.', lorebookFiles: ['valley.md'], studio: { sheet: sheet({ name: 'Tom Hale', description: 'Tom keeps the game on the Ashby estate.' }) } }],
  ['mara-vell.json', { name: 'Mara Vell', roleInstruction: 'Mara runs contraband along the Salt Coast.', lorebookFiles: ['salt.md', 'valley.md'], studio: { sheet: sheet({ name: 'Mara Vell', description: 'Mara runs contraband along the Salt Coast.' }) } }],
];
const THREAD_ID = 'thread-lore-1';
const MESSAGES = [
  { author: 'ai', name: 'Tom Hale', characterFile: 'tom-hale.json', content: 'The road to Blackstone is out. We go by the river.' },
  { author: 'ai', name: 'Mara Vell', characterFile: 'mara-vell.json', content: 'Then we miss the train. Fine.' },
  { author: 'ai', name: 'Tom Hale', characterFile: 'tom-hale.json', content: '*He shoulders the gun.* Keep up.' },
];

const chats = [];
function startOllama() {
  const json = (res, body) => { res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify(body)); };
  const server = http.createServer((req, res) => {
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST' }); res.end(); return; }
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      const url = req.url || '';
      if (url.startsWith('/api/version')) return json(res, { version: '0.12.0' });
      if (url.startsWith('/api/tags')) return json(res, { models: [{ name: 'probe-model:latest', model: 'probe-model:latest', size: 2e9, modified_at: new Date(now).toISOString(), details: { family: 'llama', parameter_size: '3B', quantization_level: 'Q4_K_M' } }] });
      if (url.startsWith('/api/show')) return json(res, { model_info: { 'general.architecture': 'llama', 'llama.context_length': 8192 }, capabilities: ['completion'], details: { family: 'llama', parameter_size: '3B' } });
      if (url.startsWith('/api/ps')) return json(res, { models: [] });
      if (url.startsWith('/api/embed')) return json(res, { embeddings: [[0, 0, 0]] });
      if (url.startsWith('/api/chat')) {
        let parsed = {};
        try { parsed = JSON.parse(body || '{}'); } catch { /* keep empty */ }
        const msgs = Array.isArray(parsed.messages) ? parsed.messages : [];
        if (msgs.length === 0) return json(res, { done: true });
        chats.push(msgs);
        const isMemory = String(msgs[0]?.content || '').startsWith('You extract durable memory');
        const text = isMemory ? '{"facts": [], "beats": []}' : '*Tom spits.* Ashby will be at the keep by dark.';
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Access-Control-Allow-Origin': '*' });
        res.write(JSON.stringify({ model: 'probe-model:latest', message: { role: 'assistant', content: text }, done: false }) + '\n');
        res.end(JSON.stringify({ model: 'probe-model:latest', message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop' }) + '\n');
        return;
      }
      res.writeHead(404, { 'Access-Control-Allow-Origin': '*' }); res.end();
    });
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(11434, '127.0.0.1', () => resolve(server)); });
}

async function seed(workspace) {
  const root = path.join(workspace, '.parallx', 'extensions', 'text-generator');
  for (const d of ['characters', 'lorebooks', `threads/${THREAD_ID}`]) await fs.mkdir(path.join(root, d), { recursive: true });
  for (const [file, data] of CHARACTERS) await fs.writeFile(path.join(root, 'characters', file), JSON.stringify({ id: `char-${file}`, createdAt: now - 100 * H, updatedAt: now - H, ...data }, null, 2));
  await fs.writeFile(path.join(root, 'lorebooks', 'valley.md'), VALLEY);
  await fs.writeFile(path.join(root, 'lorebooks', 'salt.md'), SALT);
  await fs.writeFile(path.join(root, 'lorebooks', 'world.md'), WORLD);
  await fs.writeFile(path.join(root, 'threads', THREAD_ID, 'thread.json'), JSON.stringify({
    id: THREAD_ID, title: 'The Road To Blackstone',
    characters: [{ file: 'tom-hale.json', addedAt: now - 3 * H }, { file: 'mara-vell.json', addedAt: now - 3 * H }],
    lorebookFiles: ['world.md'],
    writingPreset: 'immersive-rp', userName: 'Anon', createdAt: now - 3 * H, updatedAt: now - 2 * H,
  }, null, 2));
  await fs.writeFile(path.join(root, 'threads', THREAD_ID, 'messages.jsonl'), MESSAGES.map((m, i) => JSON.stringify({ id: `m${i}`, timestamp: now - 3 * H + i * 60_000, generatedBy: 'model', hiddenFrom: null, ...m })).join('\n') + '\n');
}

function launchEnv(appRoot) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE') env[k] = v;
  Object.assign(env, { PARALLX_TEST_MODE: '1', PARALLX_RENDERER_PORT: '0', PARALLX_HIDDEN_PROBE: '1', PARALLX_APP_ROOT: appRoot, PARALLX_USER_DATA: path.join(appRoot, 'data', 'chromium-cache') });
  return env;
}

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  const ollama = await startOllama();
  const stamp = Date.now();
  const appRoot = path.join(os.tmpdir(), `parallx-lore-root-${stamp}`);
  const workspace = path.join(os.tmpdir(), `parallx-lore-ws-${stamp}`);
  await fs.mkdir(path.join(appRoot, 'data'), { recursive: true });
  await fs.mkdir(path.join(workspace, '.parallx'), { recursive: true });
  await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: workspace }));
  await fs.symlink(path.join(PROJECT_ROOT, 'ext'), path.join(appRoot, 'ext'), 'junction');
  await fs.writeFile(path.join(workspace, '.parallx', 'ai-config.json'), JSON.stringify({ overrides: { indexing: { autoIndex: false, watchFiles: false } } }));
  await seed(workspace);

  const app = await electron.launch({ args: ['.'], cwd: PROJECT_ROOT, env: launchEnv(appRoot) });
  const errors = [];
  const page = await app.firstWindow();
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 300)}`); });
  let failed = 0;
  const check = (ok, what) => { if (!ok) failed++; console.log(`[probe] ${ok ? 'PASS' : 'FAIL'} ${what}`); };
  const shot = async (name) => {
    try {
      const b64 = await app.evaluate(async ({ BrowserWindow }) => {
        const img = await BrowserWindow.getAllWindows()[0].webContents.capturePage();
        return img.isEmpty() ? '' : img.toPNG().toString('base64');
      });
      if (b64) { await fs.writeFile(path.join(outDir, name), Buffer.from(b64, 'base64')); console.log(`[probe] screenshot -> ${path.join(outDir, name)}`); }
    } catch (e) { console.log(`[probe] screenshot FAILED ${name}: ${String(e).split('\n')[0]}`); }
  };

  try {
    await page.setViewportSize({ width: 1400, height: 900 }).catch(() => {});
    await page.waitForSelector('[data-part-id="workbench.parts.titlebar"]', { state: 'attached', timeout: 90_000 });
    await page.waitForTimeout(3_000);
    await page.evaluate(async () => {
      const svc = window.__parallx_workbench__._services.get({ id: 'IToolEnablementService' });
      try { await svc.setEnablement('parallx-community.creations-ai', true); } catch (e) { console.warn(String(e)); }
    });
    await page.waitForTimeout(4_000);
    await page.evaluate(() => window.__parallx_workbench__._services.get({ id: 'ICommandService' }).executeCommand('textGenerator.openHome'));
    await page.waitForTimeout(1_500);
    await page.locator('.cr-cont-card', { hasText: 'Tom Hale' }).first().click();
    await page.waitForSelector('.tg-input-textarea', { timeout: 10_000 });
    await page.waitForTimeout(2_000);

    const before = chats.length;
    await page.locator('.tg-input-textarea').fill('Is Lord Ashby coming tonight?');
    await page.locator('.tg-input-send').click();
    await page.waitForTimeout(3_000);
    const turn = chats.slice(before).find((m) => !String(m[0]?.content || '').startsWith('You extract'));
    const sys = turn ? turn.filter((m) => m.role === 'system').map((m) => m.content).join('\n') : '';
    const lore = (sys.split('## World & Lore\n')[1] || '').split(/\n## (?!#)/)[0];
    console.log(`[probe] lore sent:\n${lore}`);
    check(lore.startsWith('These are facts of this world. Never contradict them'), 'the lore opens with the rule: facts of this world, never contradicted');
    check(lore.includes('### The Valley\nA river valley in the north'), 'the world\'s overview is always in full');
    check(lore.includes('### Lord Ashby\nOwns the valley'), 'Lord Ashby, named just now, is in full (an entry with no triggers line, called by its heading)');
    check(lore.includes('### Blackstone Keep\nThe keep burned in 1888.'), 'Blackstone Keep, named three messages back, is still in full');
    check(lore.includes('- Rainfall: It rains on the valley') && !lore.includes('### Rainfall'), '"train" does not fire "rain": Rainfall is one line');
    check(lore.includes('- The Harbourmaster: sold the drowned city twice'), 'Mara\'s own lorebook is used too, in brief');
    check(!lore.includes('Hollow Folk'), 'an entry for Nell\'s chats only is left out');
    check(lore.includes('### The Northern Reach\nThree valleys under one failing crown') && lore.includes('- The Crown Tax: a tithe of one sheep in ten'), 'the chat\'s own world lore is sent, though no character has it');
    check(lore.indexOf('### The Northern Reach') < lore.indexOf('### The Valley'), 'the chat\'s world lore comes before the characters\' books');

    await page.locator('button[title^="Inspect prompt"]').first().click();
    await page.waitForTimeout(1_500);
    const inspector = await page.evaluate(() => document.querySelector('.tg-modal')?.textContent || '');
    check(/IN FULL  \[valley\.md\] Lord Ashby  \(said: lord ashby\)/.test(inspector), 'the Prompt Inspector says Lord Ashby is in full because he was named');
    check(/IN BRIEF \[valley\.md\] Rainfall  \(comes in full when someone says: rain\)/.test(inspector), 'and says what would bring Rainfall in');
    check(/HIDDEN   \[valley\.md\] The Hollow Folk  \(nell hale is not in this chat\)/.test(inspector), 'and why the Hollow Folk are out');
    await shot('lore-chat.png');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    check(await page.evaluate(() => document.querySelectorAll('.tg-modal-overlay').length === 0), 'Escape closes the Prompt Inspector');
    // Chat Settings shows the world lore, and what the characters bring as well.
    await page.locator('button[title="Chat settings"]').first().click();
    await page.waitForTimeout(800);
    const drawer = await page.evaluate(() => {
      const field = [...document.querySelectorAll('.tg-drawer-field')].find((f) => f.querySelector('.tg-drawer-label')?.textContent === 'World lore');
      return field ? { chips: [...field.querySelectorAll('.tg-drawer-chip')].map((c) => c.textContent.trim()), add: !!field.querySelector('.tg-drawer-add-btn'), hint: field.querySelector('.tg-drawer-hint')?.textContent || '' } : null;
    });
    check(!!drawer && drawer.chips.join() === 'The Northern Reach' && drawer.add, `Chat Settings has World lore with the chat's lorebook and + Add Lorebook (${JSON.stringify(drawer)})`);
    check(!!drawer && drawer.hint === 'Also from the characters: The Valley, Salt Coast.', `and says what the characters bring (${drawer?.hint})`);
    await shot('lore-chat-settings.png');
    // Removed there, it is gone from the next turn.
    await page.evaluate(() => {
      const field = [...document.querySelectorAll('.tg-drawer-field')].find((f) => f.querySelector('.tg-drawer-label')?.textContent === 'World lore');
      field.querySelector('.tg-drawer-chip-remove').click();
    });
    await page.waitForTimeout(800);
    const savedThread = JSON.parse(await fs.readFile(path.join(workspace, '.parallx', 'extensions', 'text-generator', 'threads', THREAD_ID, 'thread.json'), 'utf8'));
    check(Array.isArray(savedThread.lorebookFiles) && savedThread.lorebookFiles.length === 0, 'removing it there saves the chat without it');
    await page.locator('.tg-drawer .tg-modal-close').first().click();
    await page.waitForTimeout(300);
    const beforeNext = chats.length;
    await page.locator('.tg-input-textarea').fill('And the tax?');
    await page.locator('.tg-input-send').click();
    await page.waitForTimeout(3_000);
    const next = chats.slice(beforeNext).find((m) => !String(m[0]?.content || '').startsWith('You extract'));
    const nextSys = next ? next.filter((m) => m.role === 'system').map((m) => m.content).join('\n') : '';
    check(!!next && !nextSys.includes('Northern Reach') && nextSys.includes('### The Valley'), 'the next turn has no world lore from the chat, and the characters\' books still');

  } catch (e) {
    failed++;
    console.log(`[probe] FAIL the probe stopped: ${String(e).split('\n')[0]}`);
  } finally {
    console.log(errors.length ? `[probe] ${errors.length} renderer error(s):\n  ${errors.join('\n  ')}` : '[probe] no renderer errors');
    console.log(`[probe] ${failed === 0 ? 'ALL PASS' : `${failed} FAILED`}`);
    await app.close().catch(() => {});
    ollama.close();
    await fs.rm(appRoot, { recursive: true, force: true }).catch(() => {});
    await fs.rm(workspace, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((err) => { console.error('[probe] failed:', err); process.exit(1); });
