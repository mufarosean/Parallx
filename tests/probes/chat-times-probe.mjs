// chat-times-probe.mjs: the AI chat's message times, an answer's line of time
// and speed, and the dates on old chats, checked in a hidden copy of the app
// on a throwaway workspace.
//
// No model is used. Requests to the engine's address are answered by a
// stand-in that replies in Ollama's own wire format (a little reasoning, an
// answer, and a final object with the token counts and durations Ollama
// reports), so the path from the engine's bytes to the line under the answer
// is the app's real one. What a real model reports is not checked here.
//
// It checks: a sent message shows its time; a finished answer shows its line
// (time, how long, tokens a second) beside its actions; the line opens by
// keyboard to where the time went; the timing is kept in the database and is
// there after a restart; an answer kept before timing was shows its time
// alone; a message from yesterday says so; the chat list shows how long ago
// through yesterday and the date for any chat older.
//
// Usage: node tests/probes/chat-times-probe.mjs [--out FOLDER]
// Requires `npm run build` first (the app loads dist/). Pictures go to FOLDER
// (a folder in the system's temporary directory when not given).

import { _electron as electron } from 'playwright';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const outArg = process.argv.indexOf('--out');
const outDir = outArg > 0 ? path.resolve(process.argv[outArg + 1]) : path.join(os.tmpdir(), 'parallx-chat-times');

const MODEL = 'standin:latest';
// The final object of a streamed answer, with the figures Ollama reports (nanoseconds): 282 tokens in 4.536 s is 62.2 a second.
const FINAL = { total_duration: 4883583458, load_duration: 1334875, prompt_eval_count: 26, prompt_eval_duration: 342546000, eval_count: 282, eval_duration: 4535599000 };
const line = (o) => JSON.stringify({ model: MODEL, created_at: new Date().toISOString(), ...o });
const ANSWER = [
  line({ message: { role: 'assistant', content: '', thinking: 'Weighing the question. ' }, done: false }),
  line({ message: { role: 'assistant', content: '', thinking: 'A short answer will do.' }, done: false }),
  line({ message: { role: 'assistant', content: 'About sixty-two ' }, done: false }),
  line({ message: { role: 'assistant', content: 'tokens a second.' }, done: false }),
  line({ message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop', ...FINAL }),
].join('\n') + '\n';

/** The stand-in engine: what the app asks Ollama, answered here. Anything else (embeddings) is refused. */
async function standIn(route) {
  const url = new URL(route.request().url());
  const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  const details = { family: 'standin', families: ['standin'], parameter_size: '1B', quantization_level: 'Q4_K_M', format: 'gguf' };
  if (url.pathname === '/api/version') return json({ version: '0.12.6' });
  if (url.pathname === '/api/tags') return json({ models: [{ name: MODEL, model: MODEL, modified_at: '2026-11-01T00:00:00Z', size: 1_000_000, digest: 'standin', details }] });
  if (url.pathname === '/api/ps') return json({ models: [] });
  if (url.pathname === '/api/show') return json({ details, model_info: { 'general.architecture': 'standin', 'standin.context_length': 8192 }, capabilities: ['completion', 'thinking'] });
  if (url.pathname === '/api/chat') return route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: ANSWER });
  return route.abort('connectionrefused');
}

function launchEnv(appRoot) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE') env[k] = v;
  Object.assign(env, {
    PARALLX_TEST_MODE: '1', PARALLX_RENDERER_PORT: '0', PARALLX_HIDDEN_PROBE: '1',
    PARALLX_APP_ROOT: appRoot, PARALLX_USER_DATA: path.join(appRoot, 'data', 'chromium-cache'),
  });
  return env;
}

const errors = [];
async function launch(appRoot) {
  const app = await electron.launch({ args: ['.', '--mute-audio'], cwd: PROJECT_ROOT, env: launchEnv(appRoot) });
  // Nothing reaches the Ollama the real app uses: the stand-in answers in its place.
  await app.context().route(/^https?:\/\/(localhost|127\.0\.0\.1):11434\//, standIn);
  const page = await app.firstWindow();
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 300)}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 300)}`); });
  await page.setViewportSize({ width: 1500, height: 950 }).catch(() => {});
  await page.waitForSelector('[data-part-id="workbench.parts.titlebar"]', { state: 'attached', timeout: 90_000 });
  await page.waitForTimeout(3_000);
  await page.evaluate(() => window.__parallx_workbench__._services.get({ id: 'ICommandService' }).executeCommand('chat.show')).catch(() => {});
  await page.waitForTimeout(1_200);
  return { app, page };
}

let failed = 0;
const check = (ok, what) => { if (!ok) failed++; console.log(`[chat-times] ${ok ? 'PASS' : 'FAIL'} ${what}`); };
/** Intl puts a narrow no-break space before AM/PM. */
const plain = (s) => String(s ?? '').replace(/[  ]/g, ' ').trim();

async function shot(app, name) {
  // A hidden window can hand back its last painted frame: ask for a fresh one, and keep the second capture.
  const b64 = await app.evaluate(async ({ BrowserWindow }) => { const wc = BrowserWindow.getAllWindows()[0].webContents; wc.invalidate(); await new Promise((r) => setTimeout(r, 250)); await wc.capturePage(); await new Promise((r) => setTimeout(r, 400)); const img = await wc.capturePage(); return img.isEmpty() ? '' : img.toPNG().toString('base64'); });
  if (b64) { await fs.writeFile(path.join(outDir, name), Buffer.from(b64, 'base64')); console.log(`[chat-times] picture -> ${path.join(outDir, name)}`); }
}

/** What is on screen for the open chat: each sent message's stamp, each answer's line and its details. */
const onScreen = (page) => page.evaluate(() => ({
  sent: [...document.querySelectorAll('.parallx-chat-message--user')].map((m) => { const t = m.querySelector('.parallx-chat-message-time'); return { text: (m.querySelector('.parallx-chat-message-body')?.textContent ?? '').trim().slice(0, 40), time: t?.textContent ?? '', full: t?.getAttribute('title') ?? '' }; }),
  answers: [...document.querySelectorAll('.parallx-chat-message--assistant')].map((m) => {
    const b = m.querySelector('button.parallx-chat-meta');
    const d = b ? document.getElementById(b.getAttribute('aria-controls')) : null;
    return {
      line: b?.textContent ?? '', spoken: b?.getAttribute('aria-label') ?? '', expanded: b?.getAttribute('aria-expanded') ?? '', inActions: !!b?.closest('.parallx-chat-message-actions'),
      detailsShown: !!d && !d.hidden && d.getClientRects().length > 0,
      rows: d ? [...d.querySelectorAll('tr')].map((r) => `${r.querySelector('th')?.textContent}: ${r.querySelector('td')?.textContent}`) : [],
    };
  }),
}));

const chats = (page) => page.evaluate(() => [...document.querySelectorAll('.parallx-chat-session-sidebar-item')].map((r) => ({
  title: r.querySelector('.parallx-chat-session-sidebar-item-title')?.textContent ?? '', when: r.querySelector('.parallx-chat-session-sidebar-item-time')?.textContent ?? '',
})));

/** The chat list is a popout behind the Chat History button. */
async function showChatList(page) {
  const open = await page.evaluate(() => !!document.querySelector('.parallx-chat-session-sidebar--visible'));
  if (!open) await page.locator('.parallx-chat-title-action--history').first().click();
  await page.waitForTimeout(700);
}

async function openChat(page, title) {
  await showChatList(page);
  await page.locator('.parallx-chat-session-sidebar-item-info', { hasText: title }).first().click();
  await page.waitForTimeout(1_200);
}

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  const stamp = Date.now();
  const appRoot = path.join(os.tmpdir(), `parallx-chat-times-root-${stamp}`);
  const ws = path.join(os.tmpdir(), `parallx-chat-times-ws-${stamp}`);
  await fs.mkdir(path.join(appRoot, 'data'), { recursive: true });
  await fs.mkdir(ws, { recursive: true });
  await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: ws }));
  let app, page;
  try {
    ({ app, page } = await launch(appRoot));

    // ── Chats from other days, written the way the app keeps them ──
    const seeded = await page.evaluate(async (model) => {
      const svc = window.__parallx_workbench__._services.get({ id: 'IChatService' });
      const wsId = svc._workspaceId;
      const db = window.parallxElectron.database;
      const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
      const day = 86_400_000;
      const yesterdayEvening = midnight.getTime() - day + (21 * 60 + 14) * 60_000;      // yesterday, 9:14 PM
      const lastYear = new Date(); lastYear.setFullYear(lastYear.getFullYear() - 1); lastYear.setHours(9, 5, 0, 0);
      const seeds = [
        { id: 'probe-yesterday', title: 'Asked yesterday evening', at: yesterdayEvening },
        { id: 'probe-three-days', title: 'Asked three days ago', at: midnight.getTime() - 3 * day + 10 * 3_600_000 },
        { id: 'probe-last-year', title: 'Asked last year', at: lastYear.getTime() },
      ];
      const ops = [];
      for (const s of seeds) {
        ops.push({ type: 'run', sql: 'INSERT INTO chat_sessions (id, workspace_id, title, mode, model_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', params: [s.id, wsId, s.title, 'agent', model, s.at, s.at] });
        // An exchange kept before timing was: no timing_json.
        ops.push({ type: 'run', sql: 'INSERT INTO chat_messages (session_id, role, content, parts_json, model_id, is_complete, timestamp, sort_order) VALUES (?, ?, ?, ?, ?, 1, ?, 0)', params: [s.id, 'user', `A question from ${s.title.toLowerCase()}`, JSON.stringify({ requestId: `${s.id}-r1`, attempt: 0 }), '', s.at] });
        ops.push({ type: 'run', sql: 'INSERT INTO chat_messages (session_id, role, content, parts_json, model_id, is_complete, timestamp, sort_order) VALUES (?, ?, ?, ?, ?, 1, ?, 1)', params: [s.id, 'assistant', 'An older answer.', JSON.stringify([{ kind: 'markdown', content: 'An older answer.' }]), model, s.at] });
      }
      const r = await db.runTransaction(ops);
      const cols = await db.all('PRAGMA table_info(chat_messages)');
      return { ok: !r.error, error: r.error?.message, timingColumn: (cols.rows ?? cols).some((c) => c.name === 'timing_json') };
    }, MODEL);
    check(seeded.ok, `chats from other days seeded${seeded.error ? ` (${seeded.error})` : ''}`);
    check(seeded.timingColumn, 'the chat database has a place for an answer\'s timing (timing_json)');

    // ── A real exchange, typed into the chat, answered by the stand-in ──
    const input = page.locator('.parallx-chat-input textarea').first();
    await input.click();
    await input.fill('How fast do you write?');
    const sentAt = Date.now();
    await page.keyboard.press('Enter');
    let done = false;
    for (let i = 0; i < 60 && !done; i++) {
      await page.waitForTimeout(500);
      done = await page.evaluate(() => {
        const svc = window.__parallx_workbench__._services.get({ id: 'IChatService' });
        const s = svc.getSessions().find((x) => x.messages.some((p) => p.request.text === 'How fast do you write?'));
        return !!s && !s.requestInProgress && s.messages[s.messages.length - 1].response.isComplete;
      });
    }
    check(done, 'a typed message was answered (by the stand-in engine)');
    await page.waitForTimeout(800);
    const kept = await page.evaluate(() => {
      const svc = window.__parallx_workbench__._services.get({ id: 'IChatService' });
      const s = svc.getSessions().find((x) => x.messages.some((p) => p.request.text === 'How fast do you write?'));
      const p = s?.messages[s.messages.length - 1];
      return { sessionId: s?.id, model: p?.response.modelId, asked: p?.request.timestamp, timing: p?.response.timing ?? null, parts: p?.response.parts.map((x) => x.kind) };
    });
    console.log(`[chat-times] the answer as the app holds it: ${JSON.stringify(kept)}`);
    const t = kept.timing ?? {};
    check(t.writtenTokens === 282 && t.writingMs === 4536 && t.readTokens === 26 && t.readingMs === 343, `the engine's figures reached the answer (${t.writtenTokens} tokens in ${t.writingMs} ms; ${t.readTokens} read in ${t.readingMs} ms)`);
    check(t.firstWordAt >= kept.asked && t.completedAt >= t.firstWordAt && t.completedAt - sentAt < 60_000, 'the first word and the finish are stamped, in order, after the message was sent');

    let view = await onScreen(page);
    const mine = view.sent[view.sent.length - 1] ?? {};
    const answer = view.answers[view.answers.length - 1] ?? {};
    check(/^\d{1,2}:\d{2} [AP]M$/.test(plain(mine.time)), `the sent message shows its time ("${plain(mine.time)}")`);
    check(/\d{4} at \d{1,2}:\d{2}:\d{2} [AP]M$/.test(plain(mine.full)), `its whole date and time is on hover ("${plain(mine.full)}")`);
    check(/^\d{1,2}:\d{2} [AP]M · \d+(\.\d)? s · 62\.2 tokens\/s$/.test(plain(answer.line)), `the answer shows its line: time, how long, tokens a second ("${plain(answer.line)}")`);
    check(answer.inActions && answer.expanded === 'false' && !answer.detailsShown, 'the line sits in the answer\'s row of actions, closed');
    check(/took .* s, 62\.2 tokens a second/.test(plain(answer.spoken)), `a screen reader hears it in words ("${plain(answer.spoken)}")`);
    await shot(app, 'chat-times-1-answer.png');

    // ── Opened by keyboard ──
    await page.evaluate(() => { const all = document.querySelectorAll('button.parallx-chat-meta'); all[all.length - 1].focus(); });
    const focusShown = await page.evaluate(() => { const b = document.activeElement; const cs = b ? getComputedStyle(b) : null; return !!b && b.classList.contains('parallx-chat-meta') && b.matches(':focus-visible') && cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0; });
    check(focusShown, 'the line takes the keyboard\'s focus and shows it');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    view = await onScreen(page);
    const opened = view.answers[view.answers.length - 1] ?? {};
    console.log(`[chat-times] where the time went: ${JSON.stringify(opened.rows.map(plain))}`);
    const row = (name) => plain(opened.rows.find((r) => r.startsWith(`${name}:`)) ?? '');
    check(opened.expanded === 'true' && opened.detailsShown, 'Enter opens where the time went');
    check(/^First word: after \d+(\.\d)? s$/.test(row('First word')) && /^Whole answer: \d+(\.\d)? s$/.test(row('Whole answer')), `it says when the first word came and how long the whole answer took ("${row('First word')}", "${row('Whole answer')}")`);
    check(row('Speed') === 'Speed: 62.2 tokens/s' && row('Written') === 'Written: 282 tokens in 4.5 s, reasoning included', `it gives the speed and what it is made of ("${row('Written')}")`);
    check(row('Prompt read') === 'Prompt read: 26 tokens in 0.3 s' && row('Model') === `Model: ${MODEL}`, `it says what was read and by which model ("${row('Prompt read')}", "${row('Model')}")`);
    check(!row('Model loaded'), 'a model load too short to notice is left out');
    await shot(app, 'chat-times-2-details.png');
    await page.keyboard.press('Space');
    await page.waitForTimeout(300);
    view = await onScreen(page);
    check(view.answers[view.answers.length - 1]?.expanded === 'false', 'Space closes it again');

    // ── Kept in the database, and there after a restart ──
    await page.waitForTimeout(1_500); // the save that follows an answer
    const stored = await page.evaluate(async (sessionId) => {
      const r = await window.parallxElectron.database.all('SELECT role, timing_json FROM chat_messages WHERE session_id = ? ORDER BY sort_order', [sessionId]);
      return r.rows ?? r;
    }, kept.sessionId);
    const storedTiming = (() => { try { return JSON.parse(stored.find((r) => r.role === 'assistant')?.timing_json ?? 'null'); } catch { return null; } })();
    check(stored.find((r) => r.role === 'user')?.timing_json == null && storedTiming?.writtenTokens === 282 && storedTiming?.completedAt === t.completedAt, 'the answer\'s timing is kept with it in the database');
    await app.close();

    ({ app, page } = await launch(appRoot));
    // The chat's model named the chat after its first answer; the stand-in's reply to that is its title now.
    const title = await page.evaluate((id) => window.__parallx_workbench__._services.get({ id: 'IChatService' }).getSessions().find((s) => s.id === id)?.title ?? '', kept.sessionId);
    console.log(`[chat-times] the typed chat is listed as "${title}"`);
    await openChat(page, title);
    view = await onScreen(page);
    const after = view.answers[view.answers.length - 1] ?? {};
    check(/ · 62\.2 tokens\/s$/.test(plain(after.line)) && plain(after.line) === plain(answer.line), `after a restart the answer still shows its line ("${plain(after.line)}")`);

    // ── Other days ──
    await showChatList(page);
    await shot(app, 'chat-times-3-list.png');
    const list = await chats(page);
    console.log(`[chat-times] the chat list: ${JSON.stringify(list.map((c) => `${c.title} = ${plain(c.when)}`))}`);
    const when = (title) => plain(list.find((c) => c.title.includes(title))?.when);
    check(/^(now|\d+m ago)$/.test(when(title)), `today's chat says how long ago ("${when(title)}")`);
    check(when('Asked yesterday evening') === 'yesterday' || /^\d+h ago$/.test(when('Asked yesterday evening')), `yesterday's chat stays relative ("${when('Asked yesterday evening')}")`);
    check(/^[A-Z][a-z]{2} \d{1,2}$/.test(when('Asked three days ago')), `a chat from three days ago shows its date ("${when('Asked three days ago')}")`);
    check(/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/.test(when('Asked last year')), `a chat from last year shows its date with the year ("${when('Asked last year')}")`);

    await openChat(page, 'Asked yesterday evening');
    view = await onScreen(page);
    check(plain(view.sent[0]?.time) === 'Yesterday, 9:14 PM', `a message from yesterday says so ("${plain(view.sent[0]?.time)}")`);
    check(plain(view.answers[0]?.line) === 'Yesterday, 9:14 PM', `an answer kept before timing was shows its time alone ("${plain(view.answers[0]?.line)}")`);
    await shot(app, 'chat-times-4-yesterday.png');
    await openChat(page, 'Asked last year');
    view = await onScreen(page);
    check(/^[A-Z][a-z]{2} \d{1,2}, \d{4}, 9:05 AM$/.test(plain(view.sent[0]?.time)), `a message from last year shows its date and year ("${plain(view.sent[0]?.time)}")`);
  } finally {
    if (app) await app.close().catch(() => {});
    const real = errors.filter((e) => !/ERR_CONNECTION_REFUSED|ERR_FAILED|Failed to fetch|embed/i.test(e));
    console.log(`[chat-times] ${real.length} renderer error(s)`);
    for (const e of real) console.log(`  ${e}`);
    failed += real.length;
    await fs.rm(appRoot, { recursive: true, force: true }).catch(() => {});
    await fs.rm(ws, { recursive: true, force: true }).catch(() => {});
    console.log(`[chat-times] ${failed} problem(s)`);
  }
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
