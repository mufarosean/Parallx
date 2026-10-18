// extension-draft-probe.mjs: the assistant writes an extension, the person
// installs it, hidden, on a throwaway app root and workspace. Calls the real
// extension_propose tool with a draft (no model calls), presses Install in
// the review tab, and checks the extension runs at once with no restart.
// Also checks the ```suggest card stages a request and never sends one.
//
// Usage: node tests/probes/extension-draft-probe.mjs <outDir>
// Requires `npm run build` first (the app loads dist/).

import { _electron as electron } from 'playwright';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const outDir = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'parallx-extension-draft'));

const DRAFT = {
  manifest: {
    manifestVersion: 1, id: 'assistant.recipes', name: 'Recipe Converter', version: '0.1.0', publisher: 'assistant',
    description: 'Converts recipes to metric.', main: 'main.js', activationEvents: ['onStartupFinished'], engines: { parallx: '>=0.1.0' },
    contributes: { commands: [{ id: 'assistant.recipes.open', title: 'Convert A Recipe…' }] },
  },
  files: {
    'main.js': [
      'export function activate(api, context) {',
      "  context.subscriptions.push(api.commands.registerCommand('assistant.recipes.open', () => 'converted'));",
      '}',
      'export function deactivate() {}',
    ].join('\n'),
  },
};

const ANSWER = 'Here is the conversion.\n\n```suggest\nYou have asked me to convert a recipe to metric four times this month. Want a tool for it?\ntask: convert a recipe to metric\n```';

function launchEnv(appRoot) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE') env[k] = v;
  Object.assign(env, { PARALLX_TEST_MODE: '1', PARALLX_RENDERER_PORT: '0', PARALLX_HIDDEN_PROBE: '1', PARALLX_APP_ROOT: appRoot, PARALLX_USER_DATA: path.join(appRoot, 'data', 'chromium-cache') });
  return env;
}

const errors = [];
let fails = 0;
const check = (ok, what) => { if (!ok) fails++; console.log(`[probe] ${ok ? 'PASS' : 'FAIL'} ${what}`); };

async function launch(appRoot) {
  const app = await electron.launch({ args: ['.', '--mute-audio'], cwd: PROJECT_ROOT, env: launchEnv(appRoot) });
  await app.context().route(/^https?:\/\/(localhost|127\.0\.0\.1):11434\//, (route) => route.abort('connectionrefused'));
  const page = await app.firstWindow();
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 300)}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 300)}`); });
  await page.waitForSelector('[data-part-id="workbench.parts.titlebar"]', { state: 'attached', timeout: 90_000 });
  await page.waitForTimeout(3_000);
  return { app, page };
}

const run = (page, id, ...args) => page.evaluate(async ({ id, args }) => window.__parallx_workbench__._services.get({ id: 'ICommandService' }).executeCommand(id, ...args), { id, args });

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  const stamp = Date.now();
  const appRoot = path.join(os.tmpdir(), `parallx-xd-root-${stamp}`);
  const ws = path.join(os.tmpdir(), `parallx-xd-ws-${stamp}`);
  await fs.mkdir(path.join(appRoot, 'data'), { recursive: true });
  await fs.mkdir(path.join(ws, '.parallx'), { recursive: true });
  await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: ws }));
  await fs.writeFile(path.join(ws, '.parallx', 'ai-config.json'), JSON.stringify({ overrides: { indexing: { autoIndex: false, watchFiles: false } } }));
  try {
    let { app, page } = await launch(appRoot);
    const seeded = await page.evaluate(async (answer) => {
      const svc = window.__parallx_workbench__._services.get({ id: 'IChatService' });
      const now = Date.now();
      const r = await window.parallxElectron.database.runTransaction([
        { type: 'run', sql: 'INSERT INTO chat_sessions (id, workspace_id, title, mode, model_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', params: ['probe-xd', svc._workspaceId, 'Suggest probe', 'agent', '', now, now] },
        { type: 'run', sql: 'INSERT INTO chat_messages (session_id, role, content, parts_json, is_complete, timestamp, sort_order) VALUES (?, ?, ?, ?, 1, ?, 0)', params: ['probe-xd', 'user', 'Convert this recipe to metric.', '[]', now] },
        { type: 'run', sql: 'INSERT INTO chat_messages (session_id, role, content, parts_json, is_complete, timestamp, sort_order) VALUES (?, ?, ?, ?, 1, ?, 1)', params: ['probe-xd', 'assistant', answer, JSON.stringify([{ kind: 'markdown', content: answer }]), now] },
      ]);
      return r.error ? `ERR ${r.error.message}` : 'ok';
    }, ANSWER);
    check(seeded === 'ok', `seeded the chat (${seeded})`);
    await app.close();
    ({ app, page } = await launch(appRoot));

    // The suggestion card: Build An Extension… stages a request, nothing is sent.
    await run(page, 'chat.show');
    await page.waitForTimeout(800);
    await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('button, [role="button"]')).find((el) => /histor/i.test(`${el.getAttribute('aria-label') ?? ''} ${el.getAttribute('title') ?? ''}`));
      b?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await page.waitForTimeout(800);
    await page.evaluate(() => {
      const row = Array.from(document.querySelectorAll('*')).find((el) => el.children.length === 0 && el.textContent?.trim() === 'Suggest probe');
      (row?.closest('[role="option"], [role="treeitem"], [role="button"], button, li') ?? row)?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await page.waitForTimeout(1_200);
    await page.locator('.px-af-suggest').first().scrollIntoViewIfNeeded().catch(() => {});
    await page.screenshot({ path: path.join(outDir, '1-suggest.png') }).catch((e) => console.log(`[probe] shot failed: ${e}`));
    await page.locator('.px-af-suggest__actions button', { hasText: 'Build An Extension' }).first().click();
    await page.waitForTimeout(600);
    const staged = await page.evaluate(() => {
      const box = document.querySelector('.parallx-chat-input-area textarea, .parallx-chat-input-area [contenteditable="true"]');
      return box ? ('value' in box ? box.value : box.textContent) : null;
    });
    check(/Build an extension for this: convert a recipe to metric/.test(String(staged)), `Build An Extension… puts the request in the input (${JSON.stringify(staged)})`);

    // The tool: a passing draft opens the review; Install is the only way in.
    const proposed = await page.evaluate(async (draft) => {
      const tools = window.__parallx_workbench__._services.get({ id: 'ILanguageModelToolsService' });
      const tool = tools.getTool('extension_propose');
      return tool ? (await tool.handler(draft, { isCancellationRequested: false })).content : 'no tool';
    }, DRAFT);
    check(/checks passed/.test(proposed), `extension_propose accepts the draft (${proposed.slice(0, 80)})`);
    await page.waitForTimeout(1_200);
    const review = await page.evaluate(() => ({
      card: !!document.querySelector('.px-xr__card'),
      buttons: Array.from(document.querySelectorAll('.px-xr__actions button')).map((b) => b.textContent.trim()),
      checks: document.querySelector('.px-xr__checks')?.textContent ?? '',
      installedBefore: !!window.__parallx_workbench__._services.get({ id: 'ICommandService' }).getCommand?.('assistant.recipes.open'),
    }));
    check(review.card && review.buttons.join('|') === 'Not Now|View Code…|Install' && !review.installedBefore, `the review shows Not Now, View Code…, Install and nothing is installed yet (${JSON.stringify(review)})`);
    await page.setViewportSize({ width: 1440, height: 1000 }).catch(() => {});
    await page.locator('.px-xr__card').first().screenshot({ path: path.join(outDir, '2-review.png') }).catch(() => {});

    await page.locator('.px-xr__actions button', { hasText: 'Install' }).first().click();
    await page.waitForTimeout(3_000);
    const after = await page.evaluate(async () => {
      const outcome = document.querySelector('.px-xr__outcome')?.textContent ?? '';
      let ran = null;
      try { ran = await window.__parallx_workbench__._services.get({ id: 'ICommandService' }).executeCommand('assistant.recipes.open'); } catch (e) { ran = `ERR ${e?.message ?? e}`; }
      return { outcome, ran };
    });
    check(/Installed and turned on/.test(after.outcome) && after.ran === 'converted', `Install installs it and it runs at once (${JSON.stringify(after)})`);
    const onDisk = await fs.stat(path.join(appRoot, 'data', 'extensions', 'assistant.recipes', '.parallx-draft')).then(() => true, () => false);
    check(onDisk, 'it is written to the app\'s extensions folder, marked as the assistant\'s');
    await page.locator('.px-xr__card').first().screenshot({ path: path.join(outDir, '3-installed.png') }).catch(() => {});
    await app.close();
  } finally {
    const real = errors.filter((e) => !/ERR_CONNECTION_REFUSED|Ollama|11434/.test(e));
    console.log(`${real.length} renderer error(s)`);
    for (const e of real) console.log(`  ${e}`);
    console.log(fails ? `[probe] ${fails} FAILED` : '[probe] all passed');
    await fs.rm(appRoot, { recursive: true, force: true }).catch(() => {});
    await fs.rm(ws, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
