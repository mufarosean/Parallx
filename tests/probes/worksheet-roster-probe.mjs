// worksheet-roster-probe.mjs — the roster in the Campaign tab, in the REAL
// app, hidden, over a SYNTHETIC bank (worksheet-seed.cjs, then
// worksheet-roster-seed.cjs). Checks the numbers the page shows, that
// Start Today's Roster makes a quiz of what is still starred, that the page
// then offers Resume and lists the quiz, and the Settings card.
//
//   node tests/probes/worksheet-roster-probe.mjs <outDir>
// Requires `npm run build` first — the app loads dist/.
import { _electron as electron } from 'playwright';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const outDir = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'parallx-roster-shots'));
let failures = 0;
const check = (ok, what) => { console.log(`[probe] ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures++; };

function launchEnv(appRoot) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE') env[k] = v;
  env.PARALLX_TEST_MODE = '1'; env.PARALLX_RENDERER_PORT = '0'; env.PARALLX_HIDDEN_PROBE = '1';
  env.PARALLX_APP_ROOT = appRoot; env.PARALLX_USER_DATA = path.join(appRoot, 'data', 'chromium-cache');
  return env;
}
async function boot(appRoot) {
  const app = await electron.launch({ args: ['.', '--mute-audio'], cwd: PROJECT_ROOT, env: launchEnv(appRoot) });
  // The hidden copy never reaches the Ollama the real app uses.
  await app.context().route(/^https?:\/\/(localhost|127\.0\.0\.1):11434\//, (route) => route.abort('connectionrefused'));
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + String(e).slice(0, 300)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 240)}`); });
  await page.setViewportSize({ width: 1400, height: 1100 }).catch(() => {});
  await page.waitForSelector('[data-part-id="workbench.parts.titlebar"]', { state: 'attached', timeout: 90_000 });
  await page.waitForTimeout(2_500);
  return { app, page, errors };
}
async function runCommand(page, commandId, ...args) {
  return page.evaluate(async ({ commandId, args }) => {
    const svc = window.__parallx_workbench__?._services?.get?.({ id: 'ICommandService' });
    if (!svc?.executeCommand) return false;
    try { await svc.executeCommand(commandId, ...args); return true; } catch (e) { return String(e); }
  }, { commandId, args });
}
async function shot(page, name) {
  await page.evaluate(() => { const d = document.getElementById('__probe_repaint') || document.body.appendChild(Object.assign(document.createElement('div'), { id: '__probe_repaint', style: 'position:fixed;right:0;bottom:0;width:1px;height:1px;pointer-events:none' })); d.style.opacity = d.style.opacity === '0.01' ? '0.02' : '0.01'; }).catch(() => {});
  try { await page.screenshot({ path: path.join(outDir, name), timeout: 15_000, animations: 'disabled' }); console.log(`[probe] screenshot -> ${path.join(outDir, name)}`); }
  catch (e) { console.log(`[probe] screenshot FAILED ${name}: ${String(e).split('\n')[0]}`); }
}
const visiblePane = (page) => page.evaluate(() => {
  const pane = [...document.querySelectorAll('.ws-pane')].filter((e) => e.offsetParent !== null).pop();
  return {
    title: pane?.querySelector('.px-page-header__title')?.textContent?.trim() ?? '',
    sub: pane?.querySelector('.px-page-header__subtitle')?.textContent?.trim() ?? '',
    tiles: [...(pane?.querySelectorAll('.ws-dash__tile') ?? [])].map((t) => `${t.querySelector('.ws-dash__tilelabel')?.textContent}=${t.querySelector('.ws-dash__tilevalue')?.textContent}`),
    days: [...(pane?.querySelectorAll('.ws-roster__day') ?? [])].map((d) => d.textContent.replace(/\s+/g, ' ').trim()),
    start: pane?.querySelector('.ws-roster__start')?.textContent?.trim() ?? '',
    quizzes: [...(pane?.querySelectorAll('.ws-roster__quiz') ?? [])].map((q) => q.textContent.replace(/\s+/g, ' ').trim()),
    papers: pane?.querySelectorAll('.ws-dash__paperrow').length ?? 0,
    overflowX: pane ? pane.scrollWidth - pane.clientWidth : 0,
  };
});

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  const stamp = Date.now();
  const appRoot = path.join(os.tmpdir(), `parallx-roster-root-${stamp}`);
  const workspace = path.join(os.tmpdir(), `parallx-roster-ws-${stamp}`);
  await fs.mkdir(path.join(appRoot, 'data'), { recursive: true });
  await fs.mkdir(path.join(workspace, '.parallx'), { recursive: true });
  await fs.writeFile(path.join(workspace, 'README.md'), '# Roster probe workspace\n');
  await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: workspace }));
  try { await fs.symlink(path.join(PROJECT_ROOT, 'ext'), path.join(appRoot, 'ext'), 'junction'); } catch { /* fine */ }
  const dbPath = path.join(workspace, '.parallx', 'data.db');

  { // Run 1: the app makes and migrates the database.
    const { app, page } = await boot(appRoot);
    await runCommand(page, 'worksheet.open');
    await page.waitForSelector('.ws-home__dest', { timeout: 60_000 });
    await app.close();
  }
  const electronBin = path.join(PROJECT_ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'electron.cmd' : 'electron');
  for (const script of ['worksheet-seed.cjs', 'worksheet-roster-seed.cjs']) {
    const r = spawnSync(electronBin, [path.join(__dirname, script), dbPath], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', shell: process.platform === 'win32' });
    console.log(`[probe] ${script}:`, (r.stdout || '').trim().split('\n').pop(), (r.stderr || '').trim().slice(0, 300));
    if (r.status !== 0) { console.error('[probe] seed failed'); process.exit(1); }
  }

  const { app, page, errors } = await boot(appRoot);
  try {
    await runCommand(page, 'worksheet.plan');
    await page.waitForSelector('.ws-roster__day', { timeout: 30_000 });
    await page.waitForTimeout(1_000);
    let v = await visiblePane(page);
    console.log('[probe] page:', JSON.stringify(v));
    check(v.title === 'Roster Test', 'title from the tag');
    check(/^Day 2 of 6/.test(v.sub), 'second of six days');
    // Three rated today by the roster seed, one more by the base seed.
    check(v.tiles.includes('Done today=4'), 'four done today');
    check(v.tiles.includes('Still starred=9 of 12'), 'nine of twelve still starred');
    check(v.days.length === 6 && /1 unstarred/.test(v.days[0]) && /2 unstarred/.test(v.days[1]) && /9 left/.test(v.days[1]) && /Ahead/.test(v.days[2]), 'day squares');
    check(/Start Today's Roster/.test(v.start), 'start button');
    check(v.papers > 0 && v.overflowX <= 0, 'papers, no sideways scroll');
    await shot(page, '01-roster.png');

    await page.locator('.ws-roster__start .px-btn--primary').click();
    await page.waitForTimeout(2_500);
    // The quiz bar reads "Roster Test · Mon Oct 19 · 1 of 9".
    const quiz = await page.evaluate(() => document.body.innerText.match(/Roster Test · \S+ \S+ \d+\s*·\s*1 of \d+/)?.[0] ?? '');
    console.log('[probe] quiz tab:', quiz);
    check(/^Roster Test · .*1 of 9/.test(quiz), 'quiz named for the roster day, nine problems');
    await shot(page, '02-quiz.png');

    await runCommand(page, 'worksheet.plan');
    await page.waitForTimeout(1_500);
    v = await visiblePane(page);
    console.log('[probe] after start:', JSON.stringify({ start: v.start, quizzes: v.quizzes }));
    check(/Resume Today's Roster/.test(v.start), 'resume once started');
    check(v.quizzes.length === 1 && /9 problems/.test(v.quizzes[0]), 'the quiz is listed with nine problems');
    await shot(page, '03-roster-after-start.png');

    await runCommand(page, 'worksheet.settings');
    await page.waitForTimeout(1_200);
    const settings = await page.evaluate(() => [...document.querySelectorAll('.ws-setrow__title')].map((t) => t.textContent.trim()));
    check(settings.includes('Tag') && settings.includes('First day') && settings.includes('Last day'), 'roster settings rows');
    await shot(page, '04-settings.png');
  } finally {
    const own = errors.filter((e) => /roster|worksheet/i.test(e));
    console.log(`[probe] page errors: ${errors.length} (${own.length} worksheet)`);
    for (const e of own) console.log('  ' + e);
    if (own.length) failures++;
    await app.close();
  }
  console.log(failures ? `[probe] ${failures} FAILED` : '[probe] all checks passed');
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
