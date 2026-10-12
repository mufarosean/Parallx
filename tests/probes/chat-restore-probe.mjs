// chat-restore-probe.mjs: chats come back after a restart, hidden, on a
// throwaway workspace. Seeds three chats (no model calls), quits, starts
// again, and checks the list carries each chat's first question as its
// preview while the messages stay unloaded until the chat is opened.
//
// Usage: node tests/probes/chat-restore-probe.mjs
// Requires `npm run build` first (the app loads dist/).

import { _electron as electron } from 'playwright';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

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
  const app = await electron.launch({ args: ['.'], cwd: PROJECT_ROOT, env: launchEnv(appRoot) });
  const page = await app.firstWindow();
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 300)}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 300)}`); });
  await page.waitForSelector('[data-part-id="workbench.parts.titlebar"]', { state: 'attached', timeout: 90_000 });
  await page.waitForTimeout(3_000);
  return { app, page };
}

const chat = (page, fn, arg) => page.evaluate(fn, arg);

async function main() {
  const stamp = Date.now();
  const appRoot = path.join(os.tmpdir(), `parallx-chat-root-${stamp}`);
  const ws = path.join(os.tmpdir(), `parallx-chat-ws-${stamp}`);
  await fs.mkdir(path.join(appRoot, 'data'), { recursive: true });
  await fs.mkdir(ws, { recursive: true });
  await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: ws }));
  try {
    let { app, page } = await launch(appRoot);
    const seeded = await chat(page, async () => {
      const svc = window.__parallx_workbench__._services.get({ id: 'IChatService' });
      const wsId = svc._workspaceId;
      const db = window.parallxElectron.database;
      const now = Date.now();
      const ops = [];
      for (let i = 0; i < 3; i++) {
        const id = `probe-chat-${i}`;
        ops.push({ type: 'run', sql: 'INSERT INTO chat_sessions (id, workspace_id, title, mode, model_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', params: [id, wsId, `Chat ${i}`, 'agent', '', now - i * 1000, now - i * 1000] });
        ops.push({ type: 'run', sql: 'INSERT INTO chat_messages (session_id, role, content, parts_json, is_complete, timestamp, sort_order) VALUES (?, ?, ?, ?, 1, ?, 0)', params: [id, 'user', `First question ${i}`, '[]', now] });
        ops.push({ type: 'run', sql: 'INSERT INTO chat_messages (session_id, role, content, parts_json, is_complete, timestamp, sort_order) VALUES (?, ?, ?, ?, 1, ?, 1)', params: [id, 'assistant', `Answer ${i}`, JSON.stringify([{ kind: 'markdown', content: `Answer ${i}` }]), now] });
      }
      const r = await db.runTransaction(ops);
      return `workspaceId="${wsId}" seed=${r.error ? `ERR ${r.error.message}` : 'ok'}`;
    });
    console.log(`[chat] ${seeded}`);
    await app.close();

    ({ app, page } = await launch(appRoot));
    console.log(`[chat] after restart: ${await chat(page, () => {
      const svc = window.__parallx_workbench__._services.get({ id: 'IChatService' });
      return svc.getSessions().filter((s) => s.id.startsWith('probe-chat-')).map((s) => `${s.id} preview="${s.previewText}" pending=${s.messagesPendingLoad} messages=${s.messages.length}`).join(' | ') || 'no probe chats';
    })}`);
    console.log(`[chat] opened: ${await chat(page, async () => {
      const svc = window.__parallx_workbench__._services.get({ id: 'IChatService' });
      await svc.ensureSessionHydrated('probe-chat-1');
      const s = svc.getSession('probe-chat-1');
      return `pending=${s.messagesPendingLoad} messages=${s.messages.length} first="${s.messages[0]?.request?.text ?? JSON.stringify(s.messages[0]).slice(0, 120)}"`;
    })}`);
    // The list the person sees.
    await page.keyboard.press('Control+Shift+i').catch(() => {});
    await page.waitForTimeout(1_500);
    console.log(`[chat] list text: ${await chat(page, () => {
      const t = document.body.innerText;
      return ['First question 0', 'First question 1', 'First question 2', 'Chat 0', 'Chat 1', 'Chat 2'].map((s) => `${s}:${t.includes(s)}`).join(' ');
    })}`);
    await app.close();
  } finally {
    const real = errors.filter((e) => !/ERR_CONNECTION_REFUSED|Ollama|11434/.test(e));
    console.log(`${real.length} renderer error(s)`);
    for (const e of real) console.log(`  ${e}`);
    await fs.rm(appRoot, { recursive: true, force: true }).catch(() => {});
    await fs.rm(ws, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
