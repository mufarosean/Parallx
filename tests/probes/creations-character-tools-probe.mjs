// Hidden-window probe for the chat's Creations character tools
// (docs/CREATIONS_AI.md, Characters from the chat). A stand-in Ollama on
// localhost:11434 plays a model that does what a good one should: in ONE chat
// turn it asks creations_character_brief, saves three characters in one
// creations_save_characters call (a brother and sister connected to each
// other and to Lord Ashby, who is already in the roster; one of them with an
// Appearance short of the user's sections), then sends only the fix, then
// answers with the links. Then, with Tom open in the Studio, a third chat
// asks to make him older: the model reads him (find) and changes two parts
// of him (creations_edit_character); the Studio opens him again with the
// change and its Undo; a fourth chat undoes it. The model is a 3B one on purpose: the app runs
// small models with the `standard` tool profile, which hides extension tools
// that do not opt into it. Checks what reached the model, what was written,
// that the links check out and open the Studio, and shoots the Studio and the
// Characters page.
// Usage: xvfb-run -a node tests/probes/creations-character-tools-probe.mjs <outDir>
// (needs port 11434 free, the app built, and the sqlite module built for Electron)
import { _electron as electron } from 'playwright';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const outDir = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'parallx-character-tools'));
const MODEL = 'probe-model:3b';
const now = Date.now();

const APPEARANCE = (who) => [
  `Overview: ${who} reads as someone built for outdoor work, weathered and watchful.`,
  'Height and build: Five foot ten, broad through the back, about thirteen stone, carried low and steady.',
  'Face: A long jaw, pale grey eyes set close, a nose broken once and set a little crooked.',
  'Clothes: A waxed jacket gone pale at the seams, cord trousers, boots resoled twice.',
  'Physicality: Stands with his weight on the back foot and listens with his head tilted; sits on the edge of a chair as if about to be called out.',
].join('\n\n');
const SHEET = (name, o = {}) => ({
  name,
  tagline: 'Keeps the estate\'s game and its secrets',
  description: `${name} has kept the game on the Harrow Court estate for eleven years and lives in the keeper's cottage by the river.`,
  appearance: APPEARANCE(name.split(' ')[0]),
  personality: 'Dry, patient and quietly funny; he wants to be left alone and cannot leave anyone in trouble.',
  voice: 'Says little and says it slowly.\nAnswers a question with a fact about the weather.\nGoes quieter when angry, never louder.\nMight say: \'The river\'s up. Mind the stones.\'\nNever says: \'I promise\' or \'trust me\'.',
  backstory: 'Born in the valley in 1984, the son of the last keeper, he left for the army at eighteen and came back at twenty-nine when his father died.',
  drives: 'Wants: the cottage to stay his.\nFears: the estate being sold.\nIn the way: Lord Ashby\'s debts.',
  secrets: 'He knows where the north wood money went.',
  relationships: 'Lord Ashby: his employer, who pays late.\nNell Hale: his sister, who runs the pub.',
  exampleDialogue: '[USER]: Seen any poachers?\n[AI]: Seen boot prints by the weir. Size ten. Townie boots.\n[USER]: Do you trust his lordship?\n[AI]: I trust the river to rise in March.\n[USER]: Nice day.\n[AI]: It\'ll rain by four.',
  reminder: `${name} never lets anyone cross the weir alone.`,
  ...o,
});
const CHARACTERS = [
  { ...SHEET('Tom Hale'), concept: 'The Harrow Court gamekeeper', connections: [{ name: 'Lord Ashby', how: 'works for him at Harrow Court as his gamekeeper', addToTheirCard: true }, { name: 'Nell Hale', how: 'her older brother' }] },
  { ...SHEET('Nell Hale', { tagline: 'Runs the Hare and Hounds and hears everything', description: 'Nell Hale runs the Hare and Hounds in the village below Harrow Court.', relationships: 'Tom Hale: her older brother, the keeper.\nLord Ashby: owes the pub three months.' }), connections: [{ name: 'Tom Hale', how: 'his younger sister' }] },
  // One with an Appearance short of the user's sections: refused, then fixed with just the field.
  { ...SHEET('Ines Brask', { tagline: 'The new vet nobody asked for', description: 'Ines Brask is the valley\'s new vet, two months in.', appearance: 'Overview: Small and quick.\n\nFace: Freckled, with a split lip healing.', relationships: 'Tom Hale: brought her a shot dog.\nNell Hale: her landlady.' }) },
];
const INES_FIX = { name: 'Ines Brask', appearance: APPEARANCE('Ines').replace(/his/g, 'her').replace(/ he /g, ' she ') };

// ── A stand-in Ollama that calls the tools ─────────────────────────────────
const requests = [];
const toolCall = (name, args) => ({ role: 'assistant', content: '', tool_calls: [{ function: { name, arguments: args } }] });
function replyFor(msgs) {
  // Only this turn's tool results count: what follows the last user message.
  let lastUser = -1;
  msgs.forEach((m, i) => { if (m.role === 'user') lastUser = i; });
  const asked = String(msgs[lastUser]?.content || '');
  const done = msgs.slice(lastUser + 1).filter((m) => m.role === 'tool');
  if (/Make Tom older/.test(asked)) {
    if (done.length === 0) return toolCall('creations_find_characters', { names: ['Tom Hale'] });
    if (done.length === 1) return toolCall('creations_edit_character', { character: 'Tom Hale', request: 'older, greying, afraid of the river', changes: { appearance: 'Face: A long jaw gone slack at the edges, pale grey eyes set close, hair grey at the temples, a nose broken once and set a little crooked.', drives: 'Fears: the river he grew up on.' } });
    return { role: 'assistant', content: `Done. ${(String(done.at(-1)?.content || '').match(/parallx:\/\/creations\/character\?file=\S+/) || [''])[0]}` };
  }
  if (/Give Tom a limp/.test(asked)) {
    if (done.length === 0) return toolCall('creations_edit_character', { character: 'Tom Hale', changes: { appearance: 'Physicality: Walks with a limp from a fall at the weir, favouring the left leg; sits on the edge of a chair as if about to be called out.' } });
    return { role: 'assistant', content: 'Done.' };
  }
  if (/Undo that change/.test(asked)) {
    if (done.length === 0) return toolCall('creations_edit_character', { character: 'Tom Hale', undo: true });
    return { role: 'assistant', content: 'Undone.' };
  }
  if (/look like/.test(asked)) {
    const found = msgs.slice(lastUser + 1).filter((m) => m.role === 'tool');
    if (found.length === 0) return toolCall('creations_find_characters', { names: ['Tom Hale'] });
    if (found.length === 1) return toolCall('creations_find_characters', { query: '"harrow court"' });
    return { role: 'assistant', content: 'Tom is tall and weathered. Near Harrow Court you have Nell and Lord Ashby.' };
  }
  const tools = done;
  const last = tools.at(-1);
  const lastText = String(last?.content || '');
  if (tools.length === 0) return toolCall('creations_character_brief', { connectTo: ['Lord Ashby'] });
  if (tools.length === 1) return toolCall('creations_save_characters', { characters: CHARACTERS });
  if (tools.length === 2 && /Not saved/.test(lastText)) return toolCall('creations_save_characters', { characters: [INES_FIX] });
  const links = tools.map((t) => String(t.content || '')).join('\n').match(/- [^:\n]+: parallx:\/\/creations\/character\?file=[^\s)]+/g) || [];
  return { role: 'assistant', content: `Here they are:\n${links.map((l) => l.replace(/^- ([^:]+): (\S+)$/, '- [$1]($2)')).join('\n')}` };
}
function startOllama() {
  const json = (res, body) => { res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify(body)); };
  const server = http.createServer((req, res) => {
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST' }); res.end(); return; }
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      const url = req.url || '';
      if (url.startsWith('/api/version')) return json(res, { version: '0.12.0' });
      if (url.startsWith('/api/tags')) return json(res, { models: [{ name: MODEL, model: MODEL, size: 2e9, modified_at: new Date(now).toISOString(), details: { family: 'llama', parameter_size: '3B', quantization_level: 'Q4_K_M' } }] });
      if (url.startsWith('/api/show')) return json(res, { model_info: { 'general.architecture': 'llama', 'llama.context_length': 32768 }, capabilities: ['completion', 'tools'], details: { family: 'llama', parameter_size: '3B' } });
      if (url.startsWith('/api/ps')) return json(res, { models: [] });
      if (url.startsWith('/api/embed')) return json(res, { embeddings: [[0, 0, 0]] });
      if (url.startsWith('/api/chat')) {
        let parsed = {};
        try { parsed = JSON.parse(body || '{}'); } catch { /* keep empty */ }
        const msgs = Array.isArray(parsed.messages) ? parsed.messages : [];
        const toolNames = Array.isArray(parsed.tools) ? parsed.tools.map((t) => t?.function?.name).filter(Boolean) : [];
        requests.push({ msgs, toolNames });
        const isTurn = toolNames.length > 0;
        // A Studio rewrite of one section: the stand-in rewrites every section, as models do.
        const isSection = !isTurn && /exactly one string key/.test(String(msgs[0]?.content || '')) && /ONE paragraph: the Clothes section/.test(String(msgs[1]?.content || ''));
        const message = isTurn ? replyFor(msgs)
          : isSection ? { role: 'assistant', content: JSON.stringify({ appearance: ['Overview: NEW.', 'Height and build: NEW.', 'Face: NEW.', 'Clothes: A heavy oilskin coat over a moleskin waistcoat.', 'Physicality: NEW.'].join('\n\n') }) }
          : { role: 'assistant', content: 'Characters' };
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Access-Control-Allow-Origin': '*' });
        res.write(JSON.stringify({ model: MODEL, message, done: false }) + '\n');
        res.end(JSON.stringify({ model: MODEL, message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop' }) + '\n');
        return;
      }
      res.writeHead(404, { 'Access-Control-Allow-Origin': '*' }); res.end();
    });
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(11434, '127.0.0.1', () => resolve(server)); });
}

async function seed(workspace) {
  const root = path.join(workspace, '.parallx', 'extensions', 'text-generator');
  await fs.mkdir(path.join(root, 'characters'), { recursive: true });
  await fs.writeFile(path.join(root, 'characters', 'lord-ashby.json'), JSON.stringify({
    id: 'char-ashby', name: 'Lord Ashby', roleInstruction: 'Ashby holds Harrow Court.', createdAt: now, updatedAt: now,
    studio: { sheet: { name: 'Lord Ashby', tagline: 'Owns the valley and its debts', description: 'Ashby holds Harrow Court, a grey stone house above the river, and three farms he is selling one field at a time.', appearance: '', personality: '', voice: '', backstory: '', drives: '', secrets: 'He sold the north wood to pay a debt.', relationships: 'Clara Ashby: his wife, in London most of the year.', exampleDialogue: '', reminder: '' } },
  }, null, 2));
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
  const appRoot = path.join(os.tmpdir(), `parallx-ct-root-${stamp}`);
  const workspace = path.join(os.tmpdir(), `parallx-ct-ws-${stamp}`);
  await fs.mkdir(path.join(appRoot, 'data'), { recursive: true });
  await fs.mkdir(path.join(workspace, '.parallx'), { recursive: true });
  await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: workspace }));
  await fs.symlink(path.join(PROJECT_ROOT, 'ext'), path.join(appRoot, 'ext'), 'junction');
  await fs.writeFile(path.join(workspace, '.parallx', 'ai-config.json'), JSON.stringify({ overrides: { indexing: { autoIndex: false, watchFiles: false } } }));
  await seed(workspace);
  const charsDir = path.join(workspace, '.parallx', 'extensions', 'text-generator', 'characters');
  console.log(`[probe] workspace ${workspace}`);

  const app = await electron.launch({ args: ['.'], cwd: PROJECT_ROOT, env: launchEnv(appRoot) });
  const errors = [];
  const page = await app.firstWindow();
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 300)}`); });
  let failed = 0;
  const check = (ok, what) => { if (!ok) failed++; console.log(`[probe] ${ok ? 'PASS' : 'FAIL'} ${what}`); };
  // The window is never shown (a hidden probe), so Playwright's screenshot
  // can wait forever on a paint; Electron's own capture of the page works.
  const shot = async (name) => {
    const file = path.join(outDir, name);
    try {
      const b64 = await app.evaluate(async ({ BrowserWindow }) => {
        const w = BrowserWindow.getAllWindows()[0];
        const img = await w.webContents.capturePage();
        return img.isEmpty() ? '' : img.toPNG().toString('base64');
      });
      if (!b64) throw new Error('the capture came back empty');
      await fs.writeFile(file, Buffer.from(b64, 'base64'));
      console.log(`[probe] screenshot -> ${file}`);
    } catch (e) { console.log(`[probe] screenshot FAILED ${name}: ${String(e).split('\n')[0]}`); }
  };

  try {
    await page.setViewportSize({ width: 1400, height: 900 }).catch(() => {});
    await page.waitForSelector('[data-part-id="workbench.parts.titlebar"]', { state: 'attached', timeout: 90_000 });
    await page.waitForTimeout(3_000);
    const setup = await page.evaluate(async (model) => {
      const svc = (id) => window.__parallx_workbench__._services.get({ id });
      try { await svc('IToolEnablementService').setEnablement('parallx-community.creations-ai', true); } catch (e) { return { error: String(e) }; }
      const tools = svc('ILanguageModelToolsService');
      for (let i = 0; i < 150 && !tools._tools.has('creations_save_characters'); i++) await new Promise((r) => setTimeout(r, 100));
      const lm = svc('ILanguageModelsService');
      for (let i = 0; i < 50 && !(await lm.getModels().catch(() => [])).length; i++) await new Promise((r) => setTimeout(r, 200));
      try { lm.setActiveModel(model); await lm.getModelInfo(model); } catch { /* the probe checks the turn */ }
      const links = svc('ILinkResolverService');
      return {
        tools: ['creations_character_brief', 'creations_save_characters', 'creations_find_characters', 'creations_edit_character'].filter((n) => tools._tools.has(n)),
        contract: links.allContracts().some((c) => c.segment === 'creations'),
        activeModel: lm.getActiveModel(),
      };
    }, MODEL);
    console.log(`[probe] setup: ${JSON.stringify(setup)}`);
    check(setup.tools?.length === 4, `Creations registers its four character tools when it is turned on (${setup.tools?.join(', ')})`);
    check(setup.contract === true, 'Creations registers the parallx://creations link kind');

    // One chat turn, as the user would send it.
    const turn = await page.evaluate(async (model) => {
      const svc = (id) => window.__parallx_workbench__._services.get({ id });
      const chat = svc('IChatService');
      const s = chat.createSession('agent', model);
      const p = chat.sendRequest(s.id, 'Make me Tom Hale, the gamekeeper at Lord Ashby\'s estate, his sister Nell who runs the pub, and Ines Brask the new vet. Add Tom to Ashby\'s card too.').catch((e) => ({ thrown: String(e && e.message || e) }));
      const res = await Promise.race([p, new Promise((r) => setTimeout(() => r({ timedOut: true }), 60_000))]);
      const session = chat.getSession(s.id) || s;
      const pair = session.messages[session.messages.length - 1];
      const parts = pair ? pair.response.parts : [];
      return {
        res: res && (res.timedOut || res.thrown) ? res : null,
        text: parts.filter((x) => x.kind === 'markdown').map((x) => x.content).join('\n'),
        tools: parts.filter((x) => x.kind === 'toolInvocation').map((x) => ({ name: x.toolName, status: x.status, isError: !!(x.isError || (x.result && x.result.isError)), result: x.result ? String(x.result.content) : '' })),
        pending: parts.filter((x) => x.kind === 'toolInvocation' && !x.result).map((x) => `${x.toolName}:${x.status}`),
      };
    }, MODEL);
    console.log(`[probe] turn: ${JSON.stringify({ res: turn.res, tools: turn.tools.map((t) => `${t.name}${t.isError ? '(error)' : ''}`), pending: turn.pending })}`);
    check(!turn.res, `the turn finishes on its own (${JSON.stringify(turn.res)})`);
    const turnReqs = requests.filter((r) => r.toolNames.length);
    check(turnReqs.length >= 1 && ['creations_character_brief', 'creations_save_characters'].every((n) => turnReqs[0].toolNames.includes(n)), `the model is offered the tools, as a 3B model on the standard profile (${turnReqs[0]?.toolNames.filter((n) => n.startsWith('creations')).join(', ')})`);
    check(turn.tools.map((t) => t.name).join(',') === 'creations_character_brief,creations_save_characters,creations_save_characters', `the tools run in order: brief, save, save (${turn.tools.map((t) => t.name).join(',')})`);
    const brief = turn.tools[0]?.result || '';
    check(/"appearance" \(5 sections: Overview, Height and build, Face, Clothes, Physicality\)/.test(brief), 'the brief carries the shipped Sheet structure');
    check(brief.includes('- Lord Ashby: Owns the valley and its debts') && brief.includes('CONNECTED PEOPLE') && brief.includes('Harrow Court, a grey stone house above the river'), 'the brief lists the roster and brings Lord Ashby\'s card');
    check(!brief.includes('north wood'), 'the brief never shows the connected card\'s secrets');
    const first = turn.tools[1]?.result || '';
    check(/^Saved 2 of 3 characters\./.test(first), `the first save takes two of three (${first.split('\n')[0]})`);
    check(/- Ines Brask:\n {2}- appearance is missing the sections Height and build, Clothes, Physicality/.test(first), 'and says exactly what Ines lacks');
    const second = turn.tools[2]?.result || '';
    check(/^Saved 1 of 1 character\./.test(second) && /kept from the earlier call: tagline/.test(second), 'the fix is only the name and the field; the rest is kept, and the result says so');

    const files = (await fs.readdir(charsDir)).filter((f) => f.endsWith('.json'));
    const read = async (f) => JSON.parse(await fs.readFile(path.join(charsDir, f), 'utf8'));
    const all = new Map();
    for (const f of files) { const d = await read(f); all.set(d.name, { f, d }); }
    check(files.length === 4 && ['Tom Hale', 'Nell Hale', 'Ines Brask', 'Lord Ashby'].every((n) => all.has(n)), `four characters on disk (${[...all.keys()].join(', ')})`);
    const tom = all.get('Tom Hale');
    const nell = all.get('Nell Hale');
    check(JSON.stringify(tom?.d.studio.connections) === JSON.stringify([{ fileName: 'lord-ashby.json', name: 'Lord Ashby', how: 'works for him at Harrow Court as his gamekeeper' }, { fileName: nell?.f, name: 'Nell Hale', how: 'her older brother' }]), 'Tom is connected to Ashby in the roster and to Nell by her new file');
    check(all.get('Lord Ashby')?.d.studio.sheet.relationships === 'Clara Ashby: his wife, in London most of the year.\nTom Hale: works for him at Harrow Court as his gamekeeper.', 'Ashby\'s card gained one line about Tom, as asked');
    check(/^Overview: .*\n\nHeight and build: .*\n\nFace: .*\n\nClothes: .*\n\nPhysicality: /s.test(all.get('Ines Brask')?.d.studio.sheet.appearance || ''), 'Ines was saved with all five appearance sections');
    check(all.get('Ines Brask')?.d.studio.sheet.secrets === 'He knows where the north wood money went.', 'and with the rest of her sheet from the first call');
    check(tom?.d.studio.madeIn === 'chat' && tom?.d.roleInstruction.includes('## Appearance\nOverview:'), 'a chat-made character is in the Studio\'s own shape');

    const linkList = (turn.text.match(/parallx:\/\/creations\/character\?file=[^\s)]+/g) || []);
    check(linkList.length === 3, `the answer gives three character links (${linkList.length})`);
    const checks = await page.evaluate(async (uris) => {
      const links = window.__parallx_workbench__._services.get({ id: 'ILinkResolverService' });
      const out = [];
      for (const u of uris) out.push(await links.verify(u, { thorough: true }));
      out.push(await links.verify('parallx://creations/character?file=character-00000000.json', {}));
      return out;
    }, linkList);
    check(checks.slice(0, 3).every((c) => c.ok), `every link checks out (${checks.slice(0, 3).map((c) => c.location).join(', ')})`);
    check(checks[3] && checks[3].ok === false, 'a link to no character does not');

    // A second chat, asking about them: the model looks them up.
    const ask = await page.evaluate(async (model) => {
      const chat = window.__parallx_workbench__._services.get({ id: 'IChatService' });
      const s = chat.createSession('agent', model);
      const p = chat.sendRequest(s.id, 'What does Tom Hale look like, and who else do I have around Harrow Court?').catch((e) => ({ thrown: String(e && e.message || e) }));
      const res = await Promise.race([p, new Promise((r) => setTimeout(() => r({ timedOut: true }), 60_000))]);
      const session = chat.getSession(s.id) || s;
      const parts = session.messages.at(-1)?.response.parts || [];
      return { res: res && (res.timedOut || res.thrown) ? res : null, tools: parts.filter((x) => x.kind === 'toolInvocation').map((x) => ({ name: x.toolName, result: x.result ? String(x.result.content) : '' })) };
    }, MODEL);
    check(!ask.res && ask.tools.map((t) => t.name).join(',') === 'creations_find_characters,creations_find_characters', `a question about them runs find twice (${ask.tools.map((t) => t.name).join(',')})`);
    const byName = ask.tools[0]?.result || '';
    check(byName.startsWith('1 character named Tom Hale, of 4 in the roster.') && byName.includes('Appearance:\nOverview: Tom reads as someone built for outdoor work') && byName.includes('Connected to:\n- Lord Ashby: works for him at Harrow Court as his gamekeeper'), 'find by name returns Tom\'s whole sheet, with his connections');
    const byWords = ask.tools[1]?.result || '';
    check(/^\d+ characters matching "harrow court", of 4 in the roster\./.test(byWords) && ['Tom Hale', 'Nell Hale', 'Lord Ashby'].every((n) => byWords.includes(`- ${n}: parallx://creations/character?file=`)), `find by words lists who is around Harrow Court, each with a link (${byWords.split('\n')[0]})`);

    // Open Tom's link: the Characters editor opens on him, in the Studio.
    const opened = await page.evaluate(async (u) => window.__parallx_workbench__._services.get({ id: 'ILinkResolverService' }).open(u), linkList.find((l) => l.includes(encodeURIComponent(tom.f)) || l.includes(tom.f)));
    check(opened === true, 'opening Tom\'s link succeeds');
    await page.waitForTimeout(2_500);
    const studioName = await page.locator('.cs-title').first().inputValue().catch(() => '');
    check(studioName === 'Tom Hale', `the Studio is open on Tom (${studioName})`);
    const crumbs = await page.locator('.cs-crumbs').first().textContent().catch(() => '');
    check(/Connected to Lord Ashby, Nell Hale/.test(crumbs || ''), `the Studio shows his connections (${crumbs})`);
    await shot('character-tools-studio.png');

    // With Tom open in the Studio, a chat changes him; another undoes it.
    const say = (text) => page.evaluate(async ({ model, text }) => {
      const chat = window.__parallx_workbench__._services.get({ id: 'IChatService' });
      const s = chat.createSession('agent', model);
      const p = chat.sendRequest(s.id, text).catch((e) => ({ thrown: String(e && e.message || e) }));
      const res = await Promise.race([p, new Promise((r) => setTimeout(() => r({ timedOut: true }), 60_000))]);
      const session = chat.getSession(s.id) || s;
      const parts = session.messages.at(-1)?.response.parts || [];
      return { res: res && (res.timedOut || res.thrown) ? res : null, text: parts.filter((x) => x.kind === 'markdown').map((x) => x.content).join('\n'), tools: parts.filter((x) => x.kind === 'toolInvocation').map((x) => ({ name: x.toolName, isError: !!(x.result && x.result.isError), result: x.result ? String(x.result.content) : '' })) };
    }, { model: MODEL, text });
    const tomBefore = (await read(tom.f)).studio.sheet;
    const edit = await say('Make Tom older, grey at the temples, and he has started to fear the river.');
    check(!edit.res && edit.tools.map((t) => t.name).join(',') === 'creations_find_characters,creations_edit_character', `a change runs find, then edit (${edit.tools.map((t) => `${t.name}${t.isError ? '(error)' : ''}`).join(',')})`);
    check(requests.filter((r) => r.toolNames.length).at(-1)?.toolNames.includes('creations_edit_character'), 'the edit tool is offered to a 3B model');
    const edited = edit.tools[1]?.result || '';
    check(edited.startsWith(`Changed Tom Hale: parallx://creations/character?file=${tom.f}\n- appearance: the Face section (the rest kept)\n- drives: the Fears line (the rest kept)`), `the edit says what it changed (${edited.split('\n').slice(0, 3).join(' | ')})`);
    const tomAfter = (await read(tom.f)).studio;
    const paras = tomAfter.sheet.appearance.split('\n\n');
    check(paras.length === 5 && paras[2].includes('grey at the temples') && paras[0] === tomBefore.appearance.split('\n\n')[0] && paras[4] === tomBefore.appearance.split('\n\n')[4], 'only the Face section changed; the other four are word for word');
    check(tomAfter.sheet.drives === 'Wants: the cottage to stay his.\nFears: the river he grew up on.\nIn the way: Lord Ashby\'s debts.', 'only the Fears line of Drives changed');
    check(tomAfter.sheet.voice === tomBefore.voice && tomAfter.sheet.exampleDialogue === tomBefore.exampleDialogue && JSON.stringify(tomAfter.connections) === JSON.stringify(tom.d.studio.connections), 'the rest of Tom, and his connections, are as they were');
    check(tomAfter.chatEdits?.length === 1 && tomAfter.chatEdits[0].request === 'older, greying, afraid of the river', 'what it replaced is kept on the card, with what was asked');
    check((await fs.readdir(charsDir)).filter((f) => f.endsWith('.json')).length === 4, 'no new file: the same card was changed');
    await page.waitForTimeout(1_500);
    const studioNow = await page.evaluate(() => ({
      face: document.querySelector('.cs-row[data-key="appearance"] textarea')?.value || '',
      notice: document.querySelector('.cs-chat-edit')?.textContent || '',
      undo: [...document.querySelectorAll('.cs-row[data-key="appearance"] .cs-icon-btn')].find((b) => b.title.startsWith('Undo'))?.title || '',
    }));
    check(studioNow.face.includes('grey at the temples'), 'the open Studio shows the change at once');
    check(/The chat changed Appearance and Drives\. Asked for: older, greying, afraid of the river/.test(studioNow.notice) && studioNow.undo === 'Undo the chat\'s change to appearance', `and offers Undo for it (${studioNow.notice})`);
    await shot('character-tools-edited.png');
    const undo = await say('Undo that change to Tom.');
    check(!undo.res && /^Undid the chat's last change to Tom Hale: Appearance and Drives are back as before\./.test(undo.tools[0]?.result || ''), `undo from the chat puts both back (${(undo.tools[0]?.result || '').split('\n')[0]})`);
    const tomUndone = (await read(tom.f)).studio;
    check(JSON.stringify(tomUndone.sheet) === JSON.stringify(tomBefore) && tomUndone.chatEdits.length === 0, 'Tom is exactly as he was before the change');
    await page.waitForTimeout(1_500);
    const studioAfterUndo = await page.evaluate(() => ({ face: document.querySelector('.cs-row[data-key="appearance"] textarea')?.value || '', notice: getComputedStyle(document.querySelector('.cs-chat-edit')).display }));
    check(!studioAfterUndo.face.includes('grey at the temples') && studioAfterUndo.notice === 'none', 'and the Studio shows him as he was, with nothing left to undo');

    // The Chat Behaviour page open on Tom, with typing not yet saved: a chat edit keeps both.
    await page.locator('button:has-text("Chat Behaviour")').first().click();
    await page.waitForTimeout(1_500);
    const typed = 'Tom Hale never lets anyone cross the weir alone, and never at night.';
    const typedOk = await page.evaluate((typed) => {
      const area = [...document.querySelectorAll('.tg-ce textarea')].find((a) => a.value.startsWith('Tom Hale never lets anyone cross the weir alone'));
      if (!area) return false;
      area.value = typed;
      area.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }, typed);
    check(typedOk, 'the Chat Behaviour page is open on Tom, with a reminder typed and not saved');
    const limp = await say('Give Tom a limp.');
    check(!limp.res && /^Changed Tom Hale: /.test(limp.tools[0]?.result || ''), `the chat changes him with that page open (${(limp.tools[0]?.result || '').split('\n')[0]})`);
    const tomLimp = await read(tom.f);
    check(tomLimp.reminder === typed && tomLimp.studio.sheet.reminder === typed, 'the reminder typed on that page was saved first, into the sheet too');
    check(/Physicality: Walks with a limp/.test(tomLimp.studio.sheet.appearance) && tomLimp.roleInstruction.includes('Walks with a limp'), 'and the chat\'s change is on the card');
    await page.waitForTimeout(1_500);
    const pageNow = await page.evaluate(() => ({
      open: !!document.querySelector('.tg-ce'),
      role: [...document.querySelectorAll('.tg-ce textarea')].some((a) => a.value.includes('Walks with a limp')),
    }));
    check(pageNow.open && pageNow.role, 'the page opened again on the changed card');
    // Saved from that page, an edit reaches the sheet the Studio and the chat read.
    const saidOnPage = 'Tom Hale never lets anyone cross the weir alone, day or night.';
    await page.evaluate((v) => {
      const area = [...document.querySelectorAll('.tg-ce textarea')].find((a) => a.value.startsWith('Tom Hale never lets anyone cross the weir alone'));
      area.value = v; area.dispatchEvent(new Event('input', { bubbles: true }));
      [...document.querySelectorAll('.tg-ce button')].find((b) => b.textContent.trim() === 'Save Character').click();
    }, saidOnPage);
    await page.waitForTimeout(1_000);
    const tomSaved = await read(tom.f);
    check(tomSaved.reminder === saidOnPage && tomSaved.studio.sheet.reminder === saidOnPage && /Walks with a limp/.test(tomSaved.studio.sheet.appearance), 'Save Character on that page keeps the sheet in step, and the chat\'s change');

    // Back in the Studio: Rewrite one section of Appearance, and only it changes.
    await page.locator('button:has-text("Back To Studio")').first().click();
    await page.waitForTimeout(1_500);
    await page.locator('.cs-row[data-key="appearance"] [aria-label^="Rewrite"]').click();
    await page.waitForTimeout(800);
    const chipsShown = await page.$$eval('.cs-row[data-key="appearance"] .cs-steer-sections .cs-mode', (els) => els.map((e) => e.textContent));
    check(JSON.stringify(chipsShown) === JSON.stringify(['Whole Field', 'Overview', 'Height and build', 'Face', 'Clothes', 'Physicality']), `Rewrite on Appearance offers Whole Field and each section (${chipsShown.join(', ')})`);
    await page.locator('.cs-row[data-key="appearance"] .cs-row-steer textarea').fill('change his clothes to something for the rain');
    await page.waitForTimeout(300);
    const pressedNow = await page.$$eval('.cs-row[data-key="appearance"] .cs-steer-sections .cs-mode[aria-pressed="true"]', (els) => els.map((e) => e.textContent));
    check(pressedNow.join() === 'Clothes', `a direction that names the clothes picks Clothes (${pressedNow.join()})`);
    await shot('character-tools-section-rewrite.png');
    const beforeSection = (await read(tom.f)).studio.sheet.appearance.split('\n\n');
    await page.locator('.cs-row[data-key="appearance"] .cs-row-steer button:has-text("Rewrite")').click();
    await page.waitForTimeout(2_500);
    const afterSection = (await read(tom.f)).studio.sheet.appearance.split('\n\n');
    check(afterSection.length === 5 && afterSection[3] === 'Clothes: A heavy oilskin coat over a moleskin waistcoat.' && [0, 1, 2, 4].every((i) => afterSection[i] === beforeSection[i]), 'only the Clothes section changed on the card, though the model rewrote all five');
    await page.evaluate(async () => window.__parallx_workbench__._services.get({ id: 'ICommandService' }).executeCommand('textGenerator.openCharacters'));
    await page.waitForTimeout(2_000);
    const cards = await page.$$eval('.cr-char-card, .cr-card, [class*="cr-gallery"] [class*="card"]', (els) => els.map((e) => (e.textContent || '').slice(0, 40)));
    check(['Tom Hale', 'Nell Hale', 'Ines Brask'].every((n) => cards.some((c) => c.includes(n))), `the Characters page lists the new three (${cards.length} cards)`);
    await shot('character-tools-gallery.png');
  } finally {
    const relevant = errors.filter((e) => !/ERR_CONNECTION_REFUSED|api\/embed|favicon/.test(e));
    console.log(relevant.length ? `[probe] ${relevant.length} renderer error(s):\n  ${relevant.join('\n  ')}` : '[probe] no renderer errors');
    console.log(`[probe] ${failed === 0 ? 'ALL PASS' : `${failed} FAILED`}`);
    await app.close().catch(() => {});
    ollama.close();
    await fs.rm(appRoot, { recursive: true, force: true }).catch(() => {});
    await fs.rm(workspace, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((err) => { console.error('[probe] failed:', err); process.exit(1); });
