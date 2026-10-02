// Hidden-window probe for the Creations redesign (docs/CREATIONS_AI.md, Redesign).
// Seeds a workspace with characters, a chat, a story and a table, opens each
// surface, prints what is on it (headers, buttons without words, overflow) and
// screenshots it in dark, light and a narrow pane.
// Usage: node tests/probes/creations-redesign-probe.mjs <outDir> [sceneName ...]
import { _electron as electron } from 'playwright';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const outDir = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'parallx-creations'));
const only = new Set(process.argv.slice(3));
const want = (name) => only.size === 0 || only.has(name);

const now = Date.now();
const H = 3_600_000;
const sheet = (o) => ({ name: '', tagline: '', description: '', appearance: '', personality: '', voice: '', backstory: '', drives: '', secrets: '', relationships: '', exampleDialogue: '', reminder: '', ...o });
const CHARACTERS = [
  ['mara-vell.json', { name: 'Mara Vell', updatedAt: now - 2 * H, studio: { mode: 'concept', concept: 'A smuggler who draws her own sea charts', locks: ['tagline'], sheet: sheet({ name: 'Mara Vell', tagline: 'Smuggler cartographer who maps the routes nobody admits exist.', description: 'Mara runs contraband along the Salt Coast with charts she drew herself, half of them wrong on purpose. She is owed favours in every harbour from Port Ardent to the Glass Shoals and trusts none of them. She keeps a ledger of every lie she has told, in a cipher only she can read, and she reads it on the nights the sea is too loud to sleep.\n\nShe learned the trade from her aunt, who drowned with the old city, and she has never forgiven the harbourmaster for closing the sea wall that night.', personality: 'Wry, quick to laugh at the wrong moment, slow to forgive.', voice: 'Short, salty sentences. Calls people love when she is annoyed.' }) } }],
  ['brother-oswin.json', { name: 'Brother Oswin', updatedAt: now - 5 * H, studio: { sheet: sheet({ name: 'Brother Oswin', tagline: 'Lapsed monk who still keeps the hours, mostly out of spite.' }) } }],
  ['kestrel.json', { name: 'Kestrel', updatedAt: now - 9 * H, studio: { sheet: sheet({ name: 'Kestrel', tagline: 'Sky-ship deckhand with a grudge against gravity.' }) } }],
  ['inspector-okafor.json', { name: 'Inspector Okafor', updatedAt: now - 30 * H, studio: { sheet: sheet({ name: 'Inspector Okafor', tagline: 'Patient detective in a city that floods every Thursday.' }) } }],
  ['the-lantern-keeper.json', { name: 'The Lantern Keeper', updatedAt: now - 50 * H, studio: { sheet: sheet({ name: 'The Lantern Keeper', tagline: 'Collects other people’s secrets and keeps them lit.' }) } }],
  ['juno-hale.json', { name: 'Juno Hale', updatedAt: now - 70 * H, roleInstruction: 'Juno is the ship’s AI. She has opinions about the captain’s music and keeps them mostly to herself.' }],
  ['rook-saltire.json', { name: 'Rook Saltire', updatedAt: now - 90 * H, studio: { sheet: sheet({ name: 'Rook Saltire', tagline: 'Duelist who has lost every duel but the important ones.' }) } }],
];
const THREAD_ID = 'thread-probe-1';
const MESSAGES = [
  { author: 'ai', name: 'Mara Vell', characterFile: 'mara-vell.json', content: '*She sets the lantern on a shelf of swollen ledgers.* Mind your step. The floor here remembers the flood better than the clerks do.' },
  { author: 'user', name: 'Anon', content: 'I brought the chart. The real one.' },
  { author: 'ai', name: 'Mara Vell', characterFile: 'mara-vell.json', content: '*Her hand stops halfway to the lantern.* You kept the map. Of course you kept the map.' },
  { author: 'user', name: 'Anon', content: 'Enough that you owe me the truth about where it leads.' },
  { author: 'ai', name: 'Mara Vell', characterFile: 'mara-vell.json', content: 'It leads home, if you are foolish enough to call a drowned city home.' },
];
const STORY = {
  id: 'story-probe', title: 'The Salt Road',
  brief: { premise: 'A smuggler and a lapsed monk follow a forbidden chart to the city drowned beneath Port Ardent.', genre: 'Fantasy', setting: 'The Salt Coast', cast: [], style: 'Wry, lyrical', pov: 'third-limited', tense: 'past', authorsNote: 'Keep the banter dry.', beatLength: 'medium' },
  chapters: [{ id: 'ch-1', title: 'The Lantern Fleet' }],
  beats: [
    { id: 'b1', chapterId: 'ch-1', text: 'The fleet came in on the low tide, forty boats with their lanterns hooded, and not one of them showed on the harbourmaster’s ledger.', instruction: '', createdAt: now - H },
    { id: 'b2', chapterId: 'ch-1', text: 'Mara found him there at the second bell. "You’re counting my boats," she said, and it wasn’t a question.', instruction: '', createdAt: now - H },
  ],
  memory: '', memoryAt: 0, createdAt: now - 3 * H, updatedAt: now - 3 * H,
};
const TABLE = `output
  The ferryman hasn’t taken a coin in a week, and nobody has drowned.
  The {harbourmaster|priest|baker} was seen at the drowned archive.
  A ship came in with no crew and {a full hold|a lit lantern|a cat}.
  There is a door under the fish market {that wasn’t there yesterday|that hums}.
`;

async function seed(workspace) {
  const root = path.join(workspace, '.parallx', 'extensions', 'text-generator');
  for (const d of ['characters', `threads/${THREAD_ID}`, 'stories', 'tables', 'lorebooks']) await fs.mkdir(path.join(root, d), { recursive: true });
  for (const [file, data] of CHARACTERS) await fs.writeFile(path.join(root, 'characters', file), JSON.stringify({ id: `char-${file}`, createdAt: now - 100 * H, ...data }, null, 2));
  await fs.writeFile(path.join(root, 'threads', THREAD_ID, 'thread.json'), JSON.stringify({ id: THREAD_ID, title: 'The Drowned Archive', characters: [{ file: 'mara-vell.json', addedAt: now - 3 * H }], writingPreset: 'immersive-rp', userName: 'Anon', createdAt: now - 3 * H, updatedAt: now - 2 * H }, null, 2));
  await fs.writeFile(path.join(root, 'threads', THREAD_ID, 'messages.jsonl'), MESSAGES.map((m, i) => JSON.stringify({ id: `m${i}`, timestamp: now - 3 * H + i * 60_000, generatedBy: m.author === 'user' ? 'human' : 'model', hiddenFrom: null, ...m })).join('\n') + '\n');
  await fs.writeFile(path.join(root, 'stories', 'the-salt-road.json'), JSON.stringify(STORY, null, 2));
  await fs.writeFile(path.join(root, 'tables', 'tavern-rumours.txt'), TABLE);
  await fs.writeFile(path.join(root, 'lorebooks', 'salt-coast.md'), '---\nname: Salt Coast\n---\n\n## Port Ardent\nA harbour town that floods.\n\n## The Drowning\nThe night the old city went under.\n');
}

function launchEnv(appRoot) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE') env[k] = v;
  Object.assign(env, { PARALLX_TEST_MODE: '1', PARALLX_RENDERER_PORT: '0', PARALLX_HIDDEN_PROBE: '1', PARALLX_APP_ROOT: appRoot, PARALLX_USER_DATA: path.join(appRoot, 'data', 'chromium-cache') });
  return env;
}

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  const stamp = Date.now();
  const appRoot = path.join(os.tmpdir(), `parallx-cr-root-${stamp}`);
  const workspace = path.join(os.tmpdir(), `parallx-cr-ws-${stamp}`);
  await fs.mkdir(path.join(appRoot, 'data'), { recursive: true });
  await fs.mkdir(path.join(workspace, '.parallx'), { recursive: true });
  await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: workspace }));
  await fs.symlink(path.join(PROJECT_ROOT, 'ext'), path.join(appRoot, 'ext'), 'junction');
  await fs.writeFile(path.join(workspace, '.parallx', 'ai-config.json'), JSON.stringify({ overrides: { indexing: { autoIndex: false, watchFiles: false } } }));
  await seed(workspace);
  console.log(`[probe] workspace ${workspace}`);

  const app = await electron.launch({ args: ['.'], cwd: PROJECT_ROOT, env: launchEnv(appRoot) });
  const errors = [];
  const page = await app.firstWindow();
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_CONNECTION_REFUSED|Ollama/.test(m.text())) errors.push(`console: ${m.text().slice(0, 300)}`); });

  const shot = async (name) => {
    const file = path.join(outDir, name);
    await page.evaluate(() => { const d = document.getElementById('__probe_repaint') || document.body.appendChild(Object.assign(document.createElement('div'), { id: '__probe_repaint', style: 'position:fixed;right:0;bottom:0;width:1px;height:1px;pointer-events:none' })); d.style.opacity = d.style.opacity === '0.01' ? '0.02' : '0.01'; }).catch(() => {});
    try { await page.screenshot({ path: file, timeout: 8_000, animations: 'disabled' }); console.log(`[probe] screenshot -> ${file}`); return; } catch { /* fall back */ }
    const out = await app.evaluate(async ({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed());
      if (!w) return null;
      const img = await w.webContents.capturePage();
      return img.toPNG().toString('base64');
    }).catch(() => null);
    if (out) { await fs.writeFile(file, Buffer.from(out, 'base64')); console.log(`[probe] screenshot (capturePage) -> ${file}`); }
    else console.log(`[probe] screenshot FAILED ${name}`);
  };
  const run = (id, ...args) => page.evaluate(async ({ id, args }) => {
    const svc = window.__parallx_workbench__?._services?.get?.({ id: 'ICommandService' });
    try { await svc.executeCommand(id, ...args); return 'ok'; } catch (e) { return `failed: ${String(e).slice(0, 160)}`; }
  }, { id, args });
  // What the active editor shows: its heading, its buttons, the ones without words, overflow.
  const describe = (label) => page.evaluate((label) => {
    const part = document.querySelector('[data-part-id="workbench.parts.editor"]');
    const pane = [...(part?.querySelectorAll('.editor-pane, [class*="editor-pane"]') || [])].find((p) => p.getBoundingClientRect().width > 0) || part;
    const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const heads = [...pane.querySelectorAll('h1, h2, .cs-title')].filter(vis).slice(0, 5).map((h) => (h.value || h.textContent || '').trim().slice(0, 40));
    const buttons = [...pane.querySelectorAll('button')].filter(vis);
    const words = buttons.map((b) => (b.textContent || '').trim()).filter(Boolean);
    const unlabelled = buttons.filter((b) => !(b.textContent || '').trim() && !b.getAttribute('aria-label') && !b.title).length;
    const over = [...pane.querySelectorAll('*')].filter((e) => vis(e) && e.scrollWidth > e.clientWidth + 2 && getComputedStyle(e).overflowX === 'visible' && e.clientWidth > 0).length;
    const portraits = [...pane.querySelectorAll('.cr-portrait')].filter(vis).length;
    const clipped = [...pane.querySelectorAll('textarea')].filter((t) => vis(t) && t.scrollHeight > t.clientHeight + 2).length;
    return `${label}: heads=[${heads.join(' | ')}] portraits=${portraits} clippedTextareas=${clipped} buttons=[${[...new Set(words)].slice(0, 24).join(' | ')}] unlabelled=${unlabelled} overflowX=${pane.scrollWidth > pane.clientWidth + 2 ? 'yes' : 'no'} (${over})`;
  }, label).then((t) => console.log(`[probe] ${t}`)).catch((e) => console.log(`[probe] describe ${label} failed: ${e}`));
  const click = async (selector, text) => {
    const loc = text ? page.locator(selector, { hasText: text }).first() : page.locator(selector).first();
    await loc.waitFor({ state: 'visible', timeout: 6_000 }).catch(() => {});
    if (!(await loc.count())) { console.log(`[probe] nothing to click: ${selector} ${text || ''}`); return false; }
    await loc.click().catch((e) => console.log(`[probe] click failed ${selector}: ${String(e).split('\n')[0]}`));
    await page.waitForTimeout(1_200);
    return true;
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

    const scenes = [
      ['home', async () => { await run('textGenerator.openHome'); }],
      ['characters', async () => { await run('textGenerator.openCharacters'); }],
      ['characters-lore', async () => { await run('textGenerator.openCharacters'); await click('.cr-gallery-tools [role="radiogroup"] button, .cr-gallery-tools .ui-segmented-control button', 'Lorebooks'); }],
      ['studio', async () => { await run('textGenerator.openCharacters'); await click('.cr-gallery-tools button', 'Characters'); await click('.cr-card', 'Mara Vell'); }],
      ['studio-new', async () => { await run('textGenerator.newCharacter'); }],
      ['chat', async () => { await run('textGenerator.openHome'); await click('.cr-cont-card', 'Mara Vell'); }],
      ['chat-memory', async () => { await click('button[aria-label="Memory"]'); const m = page.locator('.tg-msg--ai').nth(1); if (await m.count()) await m.hover().catch(() => {}); }],
      ['story', async () => { await run('textGenerator.openHome'); await click('.cr-cont-card', 'The Salt Road'); }],
      ['tables', async () => { await run('textGenerator.openTables'); }],
      ['settings', async () => { await run('textGenerator.openSettings'); }],
    ];
    for (const [name, go] of scenes) {
      if (!want(name)) continue;
      const before = errors.length;
      await go();
      await page.waitForTimeout(2_500);
      await describe(name);
      await shot(`${name}.png`);
      if (errors.length > before) console.log(`  errors: ${errors.slice(before).join(' || ').slice(0, 500)}`);
    }
    if (want('light')) {
      await page.evaluate(() => document.documentElement.setAttribute('data-px-mode', 'light'));
      for (const [name, cmd] of [['home-light', 'textGenerator.openHome'], ['characters-light', 'textGenerator.openCharacters']]) { await run(cmd); await page.waitForTimeout(1_500); await shot(`${name}.png`); }
      await page.evaluate(() => document.documentElement.setAttribute('data-px-mode', 'dark'));
    }
    if (want('narrow')) {
      await page.setViewportSize({ width: 760, height: 900 }).catch(() => {});
      await page.waitForTimeout(800);
      for (const [name, cmd] of [['home-narrow', 'textGenerator.openHome'], ['characters-narrow', 'textGenerator.openCharacters']]) { await run(cmd); await page.waitForTimeout(1_500); await describe(name); await shot(`${name}.png`); }
    }
  } finally {
    console.log(errors.length ? `[probe] ${errors.length} renderer error(s):\n  ${errors.join('\n  ')}` : '[probe] no renderer errors');
    await app.close().catch(() => {});
    await fs.rm(appRoot, { recursive: true, force: true }).catch(() => {});
    await fs.rm(workspace, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((err) => { console.error('[probe] failed:', err); process.exit(1); });
