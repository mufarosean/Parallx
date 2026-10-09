// Hidden-window probe: the chat suggests the open file, for every kind of file.
// Found 2026-10-09: with a Markdown file open the chat suggested nothing, while
// a canvas page or a PDF was suggested. A text editor describes its file by
// the workspace-relative path, which the suggestion refused as not a path.
// Opens notes/plan.md and notes/todo.txt from the Explorer, as the user does,
// checks the suggestion chip for each, adds one and checks it is attached.
// Usage: xvfb-run -a node tests/probes/chat-suggested-file-probe.mjs <outDir>
// (needs the app built and the sqlite module built for Electron)
import { _electron as electron } from 'playwright';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const outDir = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'parallx-suggested-file'));

function launchEnv(appRoot) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE') env[k] = v;
  Object.assign(env, { PARALLX_TEST_MODE: '1', PARALLX_RENDERER_PORT: '0', PARALLX_HIDDEN_PROBE: '1', PARALLX_APP_ROOT: appRoot, PARALLX_USER_DATA: path.join(appRoot, 'data', 'chromium-cache') });
  return env;
}

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  const stamp = Date.now();
  const appRoot = path.join(os.tmpdir(), `parallx-sf-root-${stamp}`);
  const workspace = path.join(os.tmpdir(), `parallx-sf-ws-${stamp}`);
  await fs.mkdir(path.join(appRoot, 'data'), { recursive: true });
  await fs.mkdir(path.join(workspace, '.parallx'), { recursive: true });
  await fs.mkdir(path.join(workspace, 'notes'), { recursive: true });
  await fs.writeFile(path.join(workspace, 'notes', 'plan.md'), '# Plan\n\nRead Brosius first.\n');
  await fs.writeFile(path.join(workspace, 'notes', 'todo.txt'), 'buy milk\n');
  await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: workspace }));
  await fs.symlink(path.join(PROJECT_ROOT, 'ext'), path.join(appRoot, 'ext'), 'junction');
  await fs.writeFile(path.join(workspace, '.parallx', 'ai-config.json'), JSON.stringify({ overrides: { indexing: { autoIndex: false, watchFiles: false } } }));

  const app = await electron.launch({ args: ['.'], cwd: PROJECT_ROOT, env: launchEnv(appRoot) });
  const errors = [];
  const page = await app.firstWindow();
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
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
  const suggested = () => page.evaluate(() => [...document.querySelectorAll('.parallx-chat-context-chip--implicit')].map((c) => c.textContent.trim()));
  const openFromExplorer = async (name) => {
    await page.locator('.explorer-tree, [class*="explorer"]').getByText(name, { exact: true }).first().click();
    await page.waitForTimeout(1_200);
  };

  try {
    await page.setViewportSize({ width: 1400, height: 900 }).catch(() => {});
    await page.waitForSelector('[data-part-id="workbench.parts.titlebar"]', { state: 'attached', timeout: 90_000 });
    await page.waitForTimeout(3_000);
    await page.evaluate(() => window.__parallx_workbench__._services.get({ id: 'ICommandService' }).executeCommand('chat.focus')).catch(() => {});
    await page.waitForTimeout(1_000);
    await page.locator('[class*="explorer"]').getByText('notes', { exact: true }).first().click();
    await page.waitForTimeout(800);

    await openFromExplorer('plan.md');
    const forMd = await suggested();
    check(forMd.some((t) => t.includes('plan.md')), `a Markdown file open: the chat suggests it (${JSON.stringify(forMd)})`);
    await shot('suggested-md.png');

    await openFromExplorer('todo.txt');
    const forTxt = await suggested();
    check(forTxt.some((t) => t.includes('todo.txt')), `a text file open: the chat suggests it (${JSON.stringify(forTxt)})`);

    // Add it: the chip becomes an attachment with the file's full path.
    await page.locator('.parallx-chat-context-chip--implicit button').first().click();
    await page.waitForTimeout(500);
    const attached = await page.evaluate(() => [...document.querySelectorAll('.parallx-chat-context-chip:not(.parallx-chat-context-chip--implicit)')].map((c) => `${c.textContent.trim()}|${c.title}`));
    check(attached.some((t) => t.includes('todo.txt')), `added, it is attached (${JSON.stringify(attached)})`);
  } finally {
    console.log(errors.length ? `[probe] ${errors.length} renderer error(s):\n  ${errors.join('\n  ')}` : '[probe] no renderer errors');
    console.log(`[probe] ${failed === 0 ? 'ALL PASS' : `${failed} FAILED`}`);
    await app.close().catch(() => {});
    await fs.rm(appRoot, { recursive: true, force: true }).catch(() => {});
    await fs.rm(workspace, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((err) => { console.error('[probe] failed:', err); process.exit(1); });
