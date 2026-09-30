// chat-context-weight-probe.mjs — what a chat message carries before the user has said
// anything: the tools the app offers the model, with the size of each one's name,
// description and argument schema. Hidden, throwaway workspace, NO chat request and
// NO model call: the tools are read from the tool registry, nothing is sent anywhere.
//   node tests/probes/chat-context-weight-probe.mjs <out.json> [extensionId ...]
// With no extension ids, every extension found under ext/ is switched on.
import { _electron as electron } from 'playwright';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const outFile = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'parallx-chat-weight.json'));
const wanted = process.argv.slice(3);

function launchEnv(appRoot) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE') env[k] = v;
  env.PARALLX_TEST_MODE = '1'; env.PARALLX_RENDERER_PORT = '0'; env.PARALLX_HIDDEN_PROBE = '1';
  env.PARALLX_APP_ROOT = appRoot; env.PARALLX_USER_DATA = path.join(appRoot, 'data', 'chromium-cache');
  return env;
}
async function main() {
  const stamp = Date.now();
  const appRoot = path.join(os.tmpdir(), `parallx-chatweight-root-${stamp}`);
  const workspace = path.join(os.tmpdir(), `parallx-chatweight-ws-${stamp}`);
  await fs.mkdir(path.join(appRoot, 'data'), { recursive: true });
  await fs.mkdir(workspace, { recursive: true });
  await fs.writeFile(path.join(workspace, 'README.md'), '# Chat weight probe\n');
  await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: workspace }));
  try { await fs.symlink(path.join(PROJECT_ROOT, 'ext'), path.join(appRoot, 'ext'), 'junction'); } catch { /* fine */ }

  const extIds = [];
  for (const dir of await fs.readdir(path.join(PROJECT_ROOT, 'ext'))) {
    try {
      const m = JSON.parse(await fs.readFile(path.join(PROJECT_ROOT, 'ext', dir, 'parallx-manifest.json'), 'utf8'));
      const id = m.id || (m.publisher && m.name ? `${m.publisher}.${m.name}` : "");
      if (id && (wanted.length === 0 || wanted.includes(id))) extIds.push(id);
    } catch { /* not an extension */ }
  }

  const app = await electron.launch({ args: ['.'], cwd: PROJECT_ROOT, env: launchEnv(appRoot) });
  try {
    const page = await app.firstWindow();
    await page.waitForSelector('[data-part-id="workbench.parts.titlebar"]', { state: 'attached', timeout: 90_000 });
    await page.waitForTimeout(3_000);
    const read = () => page.evaluate(() => {
      const svc = window.__parallx_workbench__?._services?.get?.({ id: 'ILanguageModelToolsService' });
      const tools = svc?.getTools?.() || [];
      return tools.map((t) => ({
        name: t.name,
        source: t.source || t.extensionId || t.category || '',
        descriptionChars: String(t.description || '').length,
        schemaChars: JSON.stringify(t.parameters ?? {}).length,
        sentChars: JSON.stringify({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters ?? {} } }).length,
      }));
    });
    const builtIn = await read();
    const enabled = await page.evaluate(async (ids) => {
      const svc = window.__parallx_workbench__?._services?.get?.({ id: 'IToolEnablementService' });
      const out = {};
      for (const id of ids) { try { await svc.setEnablement(id, true); out[id] = true; } catch (e) { out[id] = String(e).slice(0, 120); } }
      return out;
    }, extIds);
    await page.waitForTimeout(8_000);
    const all = await read();
    const before = new Set(builtIn.map((t) => t.name));
    const sum = (list, key) => list.reduce((n, t) => n + t[key], 0);
    const added = all.filter((t) => !before.has(t.name));
    const report = {
      extensionsSwitchedOn: enabled,
      builtIn: { tools: builtIn.length, sentChars: sum(builtIn, 'sentChars'), schemaChars: sum(builtIn, 'schemaChars'), descriptionChars: sum(builtIn, 'descriptionChars') },
      fromExtensions: { tools: added.length, sentChars: sum(added, 'sentChars'), schemaChars: sum(added, 'schemaChars'), descriptionChars: sum(added, 'descriptionChars') },
      tools: all.sort((a, b) => b.sentChars - a.sentChars),
    };
    await fs.writeFile(outFile, JSON.stringify(report, null, 1));
    console.log('[probe] built-in tools:', JSON.stringify(report.builtIn));
    console.log('[probe] extension tools:', JSON.stringify(report.fromExtensions));
    console.log('[probe] heaviest 25:');
    for (const t of report.tools.slice(0, 25)) console.log(`  ${String(t.sentChars).padStart(6)} chars  ${t.name}`);
    console.log('[probe] report ->', outFile);
  } finally {
    await app.close().catch(() => {});
    await fs.rm(appRoot, { recursive: true, force: true }).catch(() => {});
    await fs.rm(workspace, { recursive: true, force: true }).catch(() => {});
  }
}
main().catch((err) => { console.error('[probe] failed:', err); process.exit(1); });
