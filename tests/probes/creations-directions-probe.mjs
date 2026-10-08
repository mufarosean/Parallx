// Hidden-window probe for Directions in a Creations AI roleplay
// (docs/CREATIONS_AI.md, Directions). A stand-in Ollama on localhost:11434
// answers the director and the turn, so the whole flow runs without a model:
// press Suggest Directions, the card fills as the reply streams, a pick lands
// in the composer as "/ai @Name note", Send writes that character's turn with
// the note, and the card closes. Prints what the model was sent and shoots
// the card in dark, light and a narrow pane.
// Usage: xvfb-run -a node tests/probes/creations-directions-probe.mjs <outDir>
// (needs port 11434 free: stop a real Ollama first)
import { _electron as electron } from 'playwright';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const outDir = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'parallx-directions'));

const now = Date.now();
const H = 3_600_000;
const sheet = (o) => ({ name: '', tagline: '', description: '', appearance: '', personality: '', voice: '', backstory: '', drives: '', secrets: '', relationships: '', exampleDialogue: '', reminder: '', ...o });
const CHARACTERS = [
  ['mara-vell.json', { name: 'Mara Vell', roleInstruction: 'Mara runs contraband along the Salt Coast.', studio: { sheet: sheet({ name: 'Mara Vell', tagline: 'Smuggler cartographer who maps the routes nobody admits exist.', drives: 'Wants the drowned city charted before the harbourmaster sells it.', secrets: 'She opened the sea wall the night the city drowned.', relationships: 'Oswin: owes her a life and keeps the hours to forget it.' }) } }],
  ['brother-oswin.json', { name: 'Brother Oswin', roleInstruction: 'Oswin is a lapsed monk.', studio: { sheet: sheet({ name: 'Brother Oswin', tagline: 'Lapsed monk who still keeps the hours, mostly out of spite.', drives: 'Wants the archive opened and the names of the drowned read aloud.' }) } }],
];
const THREAD_ID = 'thread-directions-1';
const MESSAGES = [
  { author: 'ai', name: 'Mara Vell', characterFile: 'mara-vell.json', content: '*She sets the lantern on a shelf of swollen ledgers.* Mind your step. The floor here remembers the flood better than the clerks do.' },
  { author: 'ai', name: 'Brother Oswin', characterFile: 'brother-oswin.json', content: 'I brought the chart. The real one.' },
  { author: 'ai', name: 'Mara Vell', characterFile: 'mara-vell.json', content: '*Her hand stops halfway to the lantern.* You kept the map. Of course you kept the map.' },
];

const DIRECTOR_REPLY = [
  '## Narrator',
  'New Scene: Cut to the harbour wall at dawn, where the buyer is already waiting',
  'Time Skip: Three days pass and the archive door has a new lock',
  'Arrival: The Harbourmaster comes down the stairs with two clerks',
  'Event: The tide turns and water starts rising through the floor',
  '',
  '## Brother Oswin',
  'Deepen: Lays the chart flat and smooths the drowned streets with his thumb',
  'Push: Asks Mara who paid her to keep the archive closed',
  'Complicate: Recognises the harbourmaster\'s seal on the ledger beside her',
  'Move: Starts down the flooded stair toward the lower stacks',
  '',
  '## Mara Vell',
  'Deepen: Turns the lantern down so he cannot see her hands shake',
  'Push: Offers to buy the chart for the price of her boat',
  'Complicate: Lets slip she was on the sea wall the night it opened',
  'Move: Hears boots on the stair above and kills the light',
].join('\n');

// ── A stand-in Ollama ─────────────────────────────────────────────────────
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
        const isDirector = String(msgs[0]?.content || '').startsWith('You are the director');
        const isMemory = String(msgs[0]?.content || '').startsWith('You extract durable memory');
        const text = isDirector ? DIRECTOR_REPLY : isMemory ? '{"facts": [], "beats": []}' : '*She offers a price for the chart, too high to be honest.* Name it, love.';
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Access-Control-Allow-Origin': '*' });
        // Stream in small pieces, slowly enough to see the card fill.
        const pieces = text.match(/[\s\S]{1,24}/g) || [];
        for (const p of pieces) {
          res.write(JSON.stringify({ model: 'probe-model:latest', message: { role: 'assistant', content: p }, done: false }) + '\n');
          await new Promise((r) => setTimeout(r, isDirector ? 25 : 10));
        }
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
  for (const d of ['characters', `threads/${THREAD_ID}`]) await fs.mkdir(path.join(root, d), { recursive: true });
  for (const [file, data] of CHARACTERS) await fs.writeFile(path.join(root, 'characters', file), JSON.stringify({ id: `char-${file}`, createdAt: now - 100 * H, updatedAt: now - H, ...data }, null, 2));
  await fs.writeFile(path.join(root, 'threads', THREAD_ID, 'thread.json'), JSON.stringify({
    id: THREAD_ID, title: 'The Drowned Archive',
    characters: [{ file: 'mara-vell.json', addedAt: now - 3 * H }, { file: 'brother-oswin.json', addedAt: now - 3 * H }],
    supportingCast: [{ id: 's1', name: 'The Harbourmaster', note: 'sold the drowned city twice' }],
    sceneState: { location: 'the drowned archive', time: 'second bell', mood: 'wary' },
    writingPreset: 'immersive-rp', userName: 'Anon', createdAt: now - 3 * H, updatedAt: now - 2 * H,
  }, null, 2));
  await fs.writeFile(path.join(root, 'threads', THREAD_ID, 'messages.jsonl'), MESSAGES.map((m, i) => JSON.stringify({ id: `m${i}`, timestamp: now - 3 * H + i * 60_000, generatedBy: 'model', hiddenFrom: null, ...m })).join('\n') + '\n');
  await fs.writeFile(path.join(root, 'threads', THREAD_ID, 'memories.md'), '# Memory\n\n## Facts\n\n### Events\n- Oswin carried the real chart out of the flood.\n\n## Timeline\n\n- Mara and Oswin meet in the drowned archive.\n\n## Notes\n\n');
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
  const appRoot = path.join(os.tmpdir(), `parallx-dir-root-${stamp}`);
  const workspace = path.join(os.tmpdir(), `parallx-dir-ws-${stamp}`);
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
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 300)}`); });
  const check = (ok, what) => console.log(`[probe] ${ok ? 'PASS' : 'FAIL'} ${what}`);

  const shot = async (name) => {
    const file = path.join(outDir, name);
    try { await page.screenshot({ path: file, timeout: 8_000, animations: 'disabled' }); console.log(`[probe] screenshot -> ${file}`); } catch (e) { console.log(`[probe] screenshot FAILED ${name}: ${String(e).split('\n')[0]}`); }
  };
  const run = (id, ...args) => page.evaluate(async ({ id, args }) => {
    const svc = window.__parallx_workbench__?._services?.get?.({ id: 'ICommandService' });
    try { await svc.executeCommand(id, ...args); return 'ok'; } catch (e) { return `failed: ${String(e).slice(0, 160)}`; }
  }, { id, args });

  try {
    await page.setViewportSize({ width: 1400, height: 900 }).catch(() => {});
    await page.waitForSelector('[data-part-id="workbench.parts.titlebar"]', { state: 'attached', timeout: 90_000 });
    await page.waitForTimeout(3_000);
    await page.evaluate(async () => {
      const svc = window.__parallx_workbench__._services.get({ id: 'IToolEnablementService' });
      try { await svc.setEnablement('parallx-community.creations-ai', true); } catch (e) { console.warn(String(e)); }
    });
    await page.waitForTimeout(4_000);
    await run('textGenerator.openHome');
    await page.waitForTimeout(1_500);
    await page.locator('.cr-cont-card', { hasText: 'Mara Vell' }).first().click();
    await page.waitForSelector('.tg-input-textarea', { timeout: 10_000 });
    await page.waitForTimeout(2_500);

    // 1. Ask. The card opens, fills as the reply streams, and ends with four per character.
    const button = page.locator('button[aria-label="Suggest Directions"]');
    check(await button.count() === 1, 'the composer has a Suggest Directions button');
    await button.click();
    await page.waitForSelector('.cr-directions .cr-direction', { timeout: 10_000 });
    const midway = await page.locator('.cr-directions .cr-direction').count();
    await page.waitForFunction(() => document.querySelectorAll('.cr-directions .cr-direction').length === 12 && !/Writing/.test(document.querySelector('.cr-directions')?.textContent || ''), null, { timeout: 15_000 });
    check(midway < 12, `the card fills while the reply streams (first look: ${midway} of 12)`);
    const groups = await page.$$eval('.cr-directions-group', (gs) => gs.map((g) => ({ who: g.querySelector('.cr-directions-who > span:last-child')?.textContent, kinds: [...g.querySelectorAll('.cr-direction-kind')].map((k) => k.textContent) })));
    console.log(`[probe] card: ${JSON.stringify(groups)}`);
    check(groups.map((g) => g.who).join(',') === 'Narrator,Brother Oswin,Mara Vell', 'the Narrator comes first; the one who spoke last (Mara) comes last');
    check(groups[0]?.kinds.join(',') === 'New Scene,Time Skip,Arrival,Event', 'the Narrator has New Scene, Time Skip, Arrival, Event');
    check(groups.slice(1).every((g) => g.kinds.join(',') === 'Deepen,Push,Complicate,Move'), 'each character has Deepen, Push, Complicate, Move');
    const dir = chats.find((m) => String(m[0]?.content || '').startsWith('You are the director'));
    const dirUser = String(dir?.[1]?.content || '');
    check(/Write the options for the Narrator, then for: Brother Oswin, Mara Vell\.$/.test(dirUser), 'the director is asked for the Narrator, then Oswin, then Mara');
    check(dirUser.includes('Hides: She opened the sea wall'), "the director sees Mara's secret from her sheet");
    check(dirUser.includes('- The Harbourmaster: sold the drowned city twice'), 'the director sees the supporting cast');
    check(dirUser.includes('Oswin carried the real chart out of the flood.'), 'the director sees the memory file');
    check(dirUser.includes('Now: the drowned archive, second bell, wary'), 'the director sees the scene');
    const box = await page.locator('.cr-directions').boundingBox();
    const input = await page.locator('.tg-input-card').boundingBox();
    check(box && input && box.y + box.height <= input.y + 1, 'the card sits above the composer');
    await shot('directions-dark.png');

    // 2. Pick. Mara's Push lands in the composer as the chat's own command.
    await page.locator('.cr-directions-group', { hasText: 'Mara Vell' }).locator('.cr-direction', { hasText: 'Offers to buy the chart' }).click();
    const composed = await page.locator('.tg-input-textarea').inputValue();
    check(composed === '/ai @"Mara Vell" Offers to buy the chart for the price of her boat', `the pick is in the composer: ${composed}`);
    check(await page.locator('.cr-direction--picked').count() === 1, 'the pick is marked on the card');
    await shot('directions-picked.png');

    // 3. Send. Mara writes the turn with the note; the card closes.
    const before = chats.length;
    await page.locator('.tg-input-send').click();
    await page.waitForFunction(() => document.querySelector('.cr-directions')?.style.display === 'none', null, { timeout: 10_000 }).catch(() => {});
    check(await page.locator('.cr-directions').evaluate((e) => e.style.display === 'none'), 'the card closes when the turn starts');
    await page.waitForTimeout(3_000);
    const turn = chats.slice(before).find((m) => !String(m[0]?.content || '').startsWith('You extract') && !String(m[0]?.content || '').startsWith('You are the director'));
    const last = String(turn?.at(-1)?.content || '');
    check(/Now write the next reply as Mara Vell/.test(last), 'the turn is written as Mara');
    check(/DIRECTOR'S NOTE[^\]]*Offers to buy the chart for the price of her boat/.test(last), "the pick is the turn's director's note");
    const lines = (await fs.readFile(path.join(workspace, '.parallx', 'extensions', 'text-generator', 'threads', THREAD_ID, 'messages.jsonl'), 'utf8')).trim().split('\n');
    const saved = JSON.parse(lines.at(-1));
    check(saved.characterFile === 'mara-vell.json' && saved.instruction === 'Offers to buy the chart for the price of her boat', 'the reply is saved as Mara with the note it was written with');

    // 4. The note goes into the next ask as one already used.
    await page.locator('button[aria-label="Suggest Directions"]').click();
    await page.waitForFunction(() => document.querySelectorAll('.cr-directions .cr-direction').length === 12, null, { timeout: 15_000 });
    const again = chats.filter((m) => String(m[0]?.content || '').startsWith('You are the director')).at(-1);
    check(String(again?.[1]?.content || '').includes('Notes the last turns were written with:\n- Offers to buy the chart'), 'the next ask knows the note just used');
    check(/Write the options for the Narrator, then for: Brother Oswin, Mara Vell\.$/.test(String(again?.[1]?.content || '')), 'Mara spoke last again, so she is last again');

    // 5. Prose typed by the player stays; the pick goes on the last line.
    await page.locator('.tg-input-textarea').fill('*Oswin sets the chart down.*');
    await page.locator('.cr-directions-group', { hasText: 'Brother Oswin' }).locator('.cr-direction').first().click();
    check(/^\*Oswin sets the chart down\.\*\n\/ai @"Brother Oswin" /.test(await page.locator('.tg-input-textarea').inputValue()), 'typed words stay and the pick goes on the last line');

    // 5b. A Narrator pick under typed words: the words are posted, then the
    //     Narrator writes the next turn with the note, and the story moves.
    await page.locator('.tg-input-textarea').fill('*Oswin pockets the chart.*');
    await page.locator('.cr-directions-group', { hasText: 'Narrator' }).locator('.cr-direction', { hasText: 'Three days pass' }).click();
    const narComposed = await page.locator('.tg-input-textarea').inputValue();
    check(narComposed === '*Oswin pockets the chart.*\n/nar Three days pass and the archive door has a new lock', `a Narrator pick goes on the last line as /nar: ${JSON.stringify(narComposed)}`);
    await shot('directions-narrator-picked.png');
    const beforeNar = chats.length;
    await page.locator('.tg-input-send').click();
    await page.waitForTimeout(3_000);
    const narTurn = chats.slice(beforeNar).find((m) => !String(m[0]?.content || '').startsWith('You extract') && !String(m[0]?.content || '').startsWith('You are the director'));
    const narSystem = narTurn ? narTurn.filter((m) => m.role === 'system').map((m) => m.content).join('\n') : '';
    const narLast = String(narTurn?.at(-1)?.content || '');
    check(/Active turn: Narrator/.test(narSystem), 'the next turn is the Narrator\'s');
    check(/Three days pass and the archive door has a new lock/.test(narLast), "the pick is the Narrator turn's note");
    const narLines = (await fs.readFile(path.join(workspace, '.parallx', 'extensions', 'text-generator', 'threads', THREAD_ID, 'messages.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
    const typed = narLines.at(-2);
    const narSaved = narLines.at(-1);
    check(typed?.content === '*Oswin pockets the chart.*', 'the typed words are posted without the command');
    check(narSaved?.name === 'Narrator' && narSaved?.instruction === 'Three days pass and the archive door has a new lock', 'the reply is saved as the Narrator with its note');
    await page.locator('button[aria-label="Suggest Directions"]').click();
    await page.waitForFunction(() => document.querySelectorAll('.cr-directions .cr-direction').length === 12, null, { timeout: 15_000 });

    // 6. Light and narrow.
    await page.evaluate(() => document.documentElement.setAttribute('data-px-mode', 'light'));
    await page.waitForTimeout(600);
    await shot('directions-light.png');
    await page.evaluate(() => document.documentElement.setAttribute('data-px-mode', 'dark'));
    await page.setViewportSize({ width: 760, height: 900 }).catch(() => {});
    await page.waitForTimeout(800);
    const overflow = await page.locator('.cr-directions').evaluate((e) => e.scrollWidth > e.clientWidth + 2);
    check(!overflow, 'no sideways overflow in a narrow pane');
    await shot('directions-narrow.png');

    // 7. Escape closes it.
    await page.locator('.cr-direction').first().focus();
    await page.keyboard.press('Escape');
    check(await page.locator('.cr-directions').evaluate((e) => e.style.display === 'none'), 'Escape closes the card');
  } finally {
    const relevant = errors.filter((e) => !/ERR_CONNECTION_REFUSED|api\/embed|favicon/.test(e));
    console.log(relevant.length ? `[probe] ${relevant.length} renderer error(s):\n  ${relevant.join('\n  ')}` : '[probe] no renderer errors');
    await app.close().catch(() => {});
    ollama.close();
    await fs.rm(appRoot, { recursive: true, force: true }).catch(() => {});
    await fs.rm(workspace, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((err) => { console.error('[probe] failed:', err); process.exit(1); });
