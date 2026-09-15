// quiz-flow-probe.mjs — the new quiz surfaces inside the REAL app, hidden,
// over a COPY of Mufaro's workspace database (his live one is never touched).
// Home -> Quizzes list -> open a quiz -> Quiz Overview -> add a note -> jump
// to a problem -> Dashboard rewards. Screenshots + every renderer error.
//   node quiz-flow-probe.mjs <outDir>
import { _electron as electron } from 'playwright';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
const PROJECT_ROOT = 'D:/AI/Parallx';
const SRC_DB = 'C:/Users/mchit/OneDrive/Documents/Actuarial Science/Exams/Exam 7 - October 2026/.parallx/data.db';
const outDir = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'parallx-quiz-probe'));

function launchEnv(appRoot) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE') env[k] = v;
  env.PARALLX_TEST_MODE = '1'; env.PARALLX_RENDERER_PORT = '0'; env.PARALLX_HIDDEN_PROBE = '1';
  env.PARALLX_APP_ROOT = appRoot; env.PARALLX_USER_DATA = path.join(appRoot, 'data', 'chromium-cache');
  return env;
}
async function makeRoots() {
  const stamp = Date.now();
  const appRoot = path.join(os.tmpdir(), `parallx-quiz-root-${stamp}`);
  const workspace = path.join(os.tmpdir(), `parallx-quiz-ws-${stamp}`);
  await fs.mkdir(path.join(appRoot, 'data'), { recursive: true });
  await fs.mkdir(path.join(workspace, '.parallx'), { recursive: true });
  await fs.writeFile(path.join(workspace, 'README.md'), '# Quiz probe workspace\n');
  await fs.copyFile(SRC_DB, path.join(workspace, '.parallx', 'data.db'));
  await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: workspace }));
  try { await fs.symlink(path.join(PROJECT_ROOT, 'ext'), path.join(appRoot, 'ext'), 'junction'); } catch { /* fine */ }
  return { appRoot, workspace };
}
async function runCommand(page, commandId, ...args) {
  return page.evaluate(async ({ commandId, args }) => {
    const wb = window.__parallx_workbench__;
    const svc = wb?._services?.get?.({ id: 'ICommandService' });
    if (!svc?.executeCommand) return false;
    try { await svc.executeCommand(commandId, ...args); return true; } catch (e) { return String(e); }
  }, { commandId, args });
}
async function main() {
  await fs.mkdir(outDir, { recursive: true });
  const { appRoot, workspace } = await makeRoots();
  console.log(`[probe] workspace ${workspace}`);
  const app = await electron.launch({ args: ['.'], cwd: PROJECT_ROOT, env: launchEnv(appRoot) });
  const errors = [];
  const shot = async (page, name) => { const f = path.join(outDir, name); await page.screenshot({ path: f }); console.log(`[probe] screenshot -> ${f}`); };
  try {
    const page = await app.firstWindow();
    page.on('pageerror', (e) => errors.push('pageerror: ' + String(e).slice(0, 300)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 240)}`); });
    await page.setViewportSize({ width: 1500, height: 950 }).catch(() => {});
    await page.waitForSelector('[data-part-id="workbench.parts.titlebar"]', { state: 'attached', timeout: 90_000 });
    await page.waitForTimeout(3_000);
    console.log('[probe] worksheet.open ->', await runCommand(page, 'worksheet.open'));
    await page.waitForSelector('.ws-launch__listtitle', { timeout: 60_000 });
    await page.waitForTimeout(1_500);
    const lists = await page.$$eval('.ws-launch__list', (els) => els.map((e) => ({ title: e.querySelector('.ws-launch__listtitle')?.textContent, rows: e.querySelectorAll('.ws-launch__row').length, first: e.querySelector('.ws-launch__row')?.textContent?.slice(0, 90) })));
    console.log('[probe] home lists:', JSON.stringify(lists));
    await shot(page, 'home.png');
    const quizList = await page.$('.ws-launch__list:has(.ws-launch__listtitle:text-is("Quizzes"))');
    if (!quizList) throw new Error('no Quizzes list on Home');
    const firstRow = await quizList.$('.ws-launch__row');
    await firstRow.click();
    await page.waitForSelector('.ws-sessionbar', { state: 'visible', timeout: 60_000 });
    await page.waitForTimeout(4_000);
    const bar = await page.$eval('.ws-sessionbar', (b) => ({ pos: b.querySelector('.ws-sessionbar__pos')?.textContent, buttons: [...b.querySelectorAll('button')].map((x) => `${x.getAttribute('aria-label')}${x.disabled ? '(off)' : ''}`), chips: [...b.querySelectorAll('.ws-chip')].map((c) => c.textContent) }));
    console.log('[probe] quiz bar:', JSON.stringify(bar));
    await shot(page, 'quiz.png');
    await page.click('.ws-sessionbar button[aria-label="Quiz Overview"]');
    await page.waitForSelector('.ws-quiz__overview', { timeout: 30_000 });
    await page.waitForTimeout(1_500);
    const overview = await page.$eval('.ws-quiz__overview', (o) => ({ head: o.querySelector('.ws-quiz__overviewhead')?.textContent?.slice(0, 160), rows: o.querySelectorAll('.ws-quiz__row').length, statuses: [...o.querySelectorAll('.ws-quiz__row .ws-chip')].slice(0, 8).map((c) => c.textContent), current: o.querySelector('.ws-quiz__row--current .ws-quiz__num')?.textContent }));
    console.log('[probe] overview:', JSON.stringify(overview));
    await shot(page, 'overview.png');
    // A note on the first problem.
    await page.click('.ws-quiz__row >> nth=0 >> button[aria-label="Add Note"]');
    await page.waitForTimeout(300);
    await page.keyboard.type('Retained BF: premium times ELR times the unreported share.');
    await page.click('.ws-quiz__overviewhead');
    await page.waitForTimeout(800);
    const notePreview = await page.$eval('.ws-quiz__row >> nth=0', (r) => ({ preview: r.querySelector('.ws-quiz__notepreview')?.textContent, label: r.querySelector('button[aria-label]')?.getAttribute('aria-label') }));
    console.log('[probe] note:', JSON.stringify(notePreview));
    // Jump to the third problem.
    await page.click('.ws-quiz__row >> nth=2');
    await page.waitForSelector('.ws-sessionbar__pos', { timeout: 30_000 });
    await page.waitForTimeout(3_500);
    const after = await page.$eval('.ws-sessionbar', (b) => ({ pos: b.querySelector('.ws-sessionbar__pos')?.textContent, sheet: !!document.querySelector('.ws-pane__sheet canvas') }));
    console.log('[probe] after jump:', JSON.stringify(after));
    await shot(page, 'jumped.png');
    // Unhiding the solution columns by hand must read as Reveal Solution.
    const reveal = await page.evaluate(async () => {
      const sheetEl = document.querySelector('.ws-pane__sheet');
      const host = sheetEl && sheetEl.__wsHost;
      if (!host) return { error: 'no host' };
      const label = () => [...document.querySelectorAll('.ws-item__titlerow button[aria-label]')].map((b) => b.getAttribute('aria-label')).filter((l) => /Solution/.test(l))[0] ?? null;
      const before = label();
      const snap = host.getSnapshot();
      const sh = snap.sheets[snap.sheetOrder[0]];
      const hidden = Object.entries(sh.columnData || {}).filter(([, d]) => d.hd).map(([c]) => +c).sort((a, b) => a - b);
      if (!hidden.length) return { before, error: 'nothing hidden' };
      const runs = []; for (const c of hidden) { const l = runs[runs.length - 1]; if (l && l[1] === c - 1) l[1] = c; else runs.push([c, c]); }
      for (const [a, b] of runs) host.setColumnsHidden(a, b - a + 1, false);
      await new Promise((r) => setTimeout(r, 600));
      const afterUnhide = label();
      for (const [a, b] of runs) host.setColumnsHidden(a, b - a + 1, true);
      await new Promise((r) => setTimeout(r, 600));
      return { before, hiddenRuns: runs, afterUnhide, afterRehide: label() };
    });
    console.log('[probe] reveal follows the sheet:', JSON.stringify(reveal));
    // Back to the overview: the note must be there from the database.
    await page.click('.ws-sessionbar button[aria-label="Quiz Overview"]');
    await page.waitForSelector('.ws-quiz__overview', { timeout: 30_000 });
    await page.waitForTimeout(1_200);
    console.log('[probe] note persisted:', JSON.stringify(await page.$eval('.ws-quiz__row >> nth=0', (r) => r.querySelector('.ws-quiz__notepreview')?.textContent)));
    // Dashboard rewards.
    console.log('[probe] worksheet.dashboard ->', await runCommand(page, 'worksheet.dashboard'));
    await page.waitForSelector('.ws-rewards', { timeout: 60_000 });
    await page.waitForTimeout(1_500);
    const rewards = await page.$eval('.ws-rewards', (g) => ({ total: g.querySelectorAll('.ws-reward').length, earned: g.querySelectorAll('.ws-reward:not(.ws-reward--locked)').length, iconsRendered: g.querySelectorAll('.ws-reward__icon svg').length, first: g.querySelector('.ws-reward')?.textContent?.slice(0, 80) }));
    console.log('[probe] rewards:', JSON.stringify(rewards));
    const xp = await page.$eval('.ws-camp__xp', (e) => e.textContent).catch(() => null);
    console.log('[probe] campaign xp line:', xp);
    await shot(page, 'dashboard.png');
  } finally {
    console.log(`[probe] renderer errors: ${errors.length}`);
    for (const e of errors.slice(0, 12)) console.log('  ' + e);
    await app.close().catch(() => {});
  }
}
main().catch((err) => { console.error('[probe] failed:', err); process.exit(1); });
