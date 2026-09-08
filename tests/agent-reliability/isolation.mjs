import fs from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';

export const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const artifactRoot = path.join(repo, 'test-results/agent-reliability');
const preparedPath = path.join(artifactRoot, 'prepared.json');
export const codeRoot = process.env.PARALLX_RELIABILITY_CODE_ROOT ?? (existsSync(preparedPath)
  ? JSON.parse(readFileSync(preparedPath, 'utf8')).codeRoot
  : path.join(artifactRoot, 'code-7384af4f'));
export function contained(root, target) {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}
export async function preflight(run) {
  const actual = await fs.realpath(run.root);
  assert(contained(await fs.realpath(artifactRoot), actual), 'Run outside artifact root');
  const marker = JSON.parse(await fs.readFile(path.join(actual, 'run.json'), 'utf8'));
  assert.equal(marker.owner, 'parallx-agent-reliability');
  for (const dir of [run.appRoot, run.workspace, run.evidence, run.userData]) {
    assert(contained(actual, await fs.realpath(dir)), `Root escaped: ${dir}`);
  }
  assert.equal(run.appRoot, path.join(actual, 'app'));
  assert.equal(run.workspace, path.join(actual, 'workspace'));
  const last = JSON.parse(await fs.readFile(path.join(run.appRoot, 'data/last-workspace.json'), 'utf8'));
  assert.equal(last.path, run.workspace);
}
export async function createRun(name, mode = 'deterministic') {
  assert.match(name, /^[a-z0-9-]+$/);
  await fs.mkdir(artifactRoot, { recursive: true });
  const root = await fs.mkdtemp(path.join(artifactRoot, `${name}-`));
  const run = { root, appRoot: path.join(root, 'app'), workspace: path.join(root, 'workspace'), evidence: path.join(root, 'evidence') };
  run.userData = path.join(run.appRoot, 'data/chromium-cache');
  for (const dir of [run.workspace, run.evidence, run.userData]) await fs.mkdir(dir, { recursive: true });
  const { createHash } = await import('node:crypto');
  const source = await fs.readFile(path.join(codeRoot, 'src/built-in/chat/data/chatDataService.ts'));
  await fs.writeFile(path.join(root, 'run.json'), JSON.stringify({ owner: 'parallx-agent-reliability', name, mode, codeRoot,
    chatDataServiceSha256: createHash('sha256').update(source).digest('hex'), created: new Date().toISOString() }, null, 2));
  await fs.writeFile(path.join(run.appRoot, 'data/last-workspace.json'), JSON.stringify({ path: run.workspace }));
  await preflight(run);
  return run;
}
export async function prepareCode() {
  assert(contained(artifactRoot, await fs.realpath(codeRoot)));
  await fs.copyFile(path.join(repo, 'tests/agent-reliability/guard.cjs'), path.join(codeRoot, 'reliability-bootstrap.cjs'));
  const pkgPath = path.join(codeRoot, 'package.json');
  const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8'));
  pkg.main = 'reliability-bootstrap.cjs';
  await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2));
}
export async function launch(run, options = {}) {
  await preflight(run);
  const env = {};
  // Do not inherit credentials, provider config, startup flags, or Electron mode.
  for (const key of ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA']) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  Object.assign(env, { PARALLX_TEST_MODE: '1', PARALLX_HIDDEN_PROBE: '1', PARALLX_RENDERER_PORT: '0',
    PARALLX_APP_ROOT: run.appRoot, PARALLX_USER_DATA: run.userData, PARALLX_RELIABILITY_RUN: run.root });
  const tempDir = path.join(run.appRoot, 'data/tmp');
  await fs.mkdir(tempDir, { recursive: true });
  env.TEMP = tempDir;
  env.TMP = tempDir;
  if (options.crashWrite) env.PARALLX_RELIABILITY_CRASH_WRITE = options.crashWrite;
  const app = await electron.launch({ args: ['.'], cwd: codeRoot, env, timeout: 60000 });
  await fs.writeFile(path.join(run.evidence, `process-${Date.now()}.json`), JSON.stringify({ pid: app.process().pid, codeRoot, runRoot: run.root, launchedAt: new Date().toISOString() }));
  const logs = [];
  app.process().stderr?.on('data', chunk => logs.push({ type: 'main-stderr', text: String(chunk) }));
  app.process().on('exit', (code, signal) => logs.push({ type: 'exit', code, signal }));
  try {
    const page = await app.firstWindow();
    page.on('console', m => logs.push({ type: m.type(), text: m.text() }));
    page.on('pageerror', e => logs.push({ type: 'pageerror', text: String(e) }));
    await page.waitForSelector('.parallx-ready', { state: 'attached', timeout: 90000 });
    await page.waitForFunction(() => Boolean(window.__parallx_chat_debug__ && window.__parallx_workbench__), undefined, { timeout: 60000 });
    const main = await app.evaluate(({ app }) => ({ userData: app.getPath('userData'), sessionData: app.getPath('sessionData'), guard: global.__reliability }));
    const renderer = await page.evaluate(() => {
      const wb = window.__parallx_workbench__;
      const db = wb._services.get({ id: 'IDatabaseService' });
      return { dataRoot: window.parallxElectron.dataRoot, database: db.currentPath };
    });
    assert.equal(main.userData, run.userData);
    assert.equal(main.sessionData, run.userData);
    assert.equal(path.resolve(main.guard.workspace), run.workspace);
    assert.equal(renderer.dataRoot, run.appRoot);
    assert.equal(path.resolve(renderer.database), path.join(run.workspace, '.parallx/data.db'));
    assert.equal(path.resolve(main.guard.database), path.resolve(renderer.database));
    await fs.writeFile(path.join(run.evidence, `isolation-${Date.now()}.json`), JSON.stringify({ main, renderer }, null, 2));
    return { app, page, logs, async close() {
      await fs.writeFile(path.join(run.evidence, `console-${Date.now()}.json`), JSON.stringify(logs, null, 2));
      let timer;
      try {
        await Promise.race([app.close(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Owned Electron close timed out')), 10000); })]);
      } catch (error) {
        app.process().kill();
        await fs.writeFile(path.join(run.evidence, 'close-error.json'), JSON.stringify({ error: String(error) }));
        throw error;
      } finally { clearTimeout(timer); }
    } };
  } catch (e) {
    await fs.writeFile(path.join(run.evidence, 'boot-failure.json'), JSON.stringify({ error: String(e), logs }, null, 2));
    await app.close().catch(() => {});
    throw e;
  }
}
