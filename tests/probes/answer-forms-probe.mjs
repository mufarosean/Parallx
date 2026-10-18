// answer-forms-probe.mjs: the answer forms in a real chat, hidden, on a
// throwaway workspace (ui/answerForms.ts). Seeds one chat whose answer
// uses every core form (no model calls), opens it, types a live number,
// steps through a worked solution, saves a chart to a page, and shoots
// each stage in the dark and light themes.
//
// Usage: node tests/probes/answer-forms-probe.mjs <outDir>
// Requires `npm run build` first (the app loads dist/).

import { _electron as electron } from 'playwright';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const outDir = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'parallx-answer-forms'));
const F = '```';

const ANSWER = [
  'The chain ladder projects each accident year forward using how losses have developed in the past. Five moves:',
  '',
  '1. **Build the triangle.** Losses by accident year down the side, age across the top.',
  '2. **Take age-to-age factors.** Each age divided by the one before it.',
  '3. **Select a factor per age.** Average down each column, then use judgement.',
  '',
  '> [!WARNING]',
  '> A change in how fast claims are settled breaks the method\'s one assumption.',
  '',
  `${F}takeaway`, 'Chain ladder trusts the data. Bornhuetter-Ferguson trusts the expectation, until the data has matured enough to outweigh it.', F,
  '',
  `${F}chart`, 'title: Most development is over by 36 months', 'caption: Selected age-to-age factors, example triangle', 'baseline: 1',
  '12-24: 1.65 *', '24-36: 1.21 *', '36-48: 1.08', '48-60: 1.03', '60-72: 1.01',
  'note: Factors past 1.00 are what is still to come.', F,
  '',
  'Your sittings line up like this:',
  '',
  `${F}timeline`, 'Oct 6: Practice exam 1 (done)', 'Oct 13: Practice exam 2 (done)', 'Oct 18: Today (today)', 'Oct 20: Practice exam 3', 'Oct 27: The sitting (key)', F,
  '',
  'Side by side:',
  '',
  '| | Chain ladder | Bornhuetter-Ferguson |', '|---|---|---|',
  '| Relies on | The data alone | Data plus an expected loss ratio |',
  '| Immature years | Swing with early losses | Stay near the expectation |',
  '',
  '> [!NOTE]',
  '> Benktander sits between the two.',
  '',
  'Try it with your own numbers:',
  '',
  `${F}live`, 'paid = 4,200 "Paid to date"', 'cdf = 1.25 "Factor to ultimate"', 'ultimate = paid * cdf "Ultimate"', 'reserve = ultimate - paid "Reserve"', '---',
  'With {paid} paid so far and a factor to ultimate of {cdf}, the ultimate comes to {ultimate}, which leaves a reserve of {reserve}.', F,
  '',
  'The same reserve the way Clark gets the factor, one step at a time:',
  '',
  `${F}worked`, 'Find the age: The 2022 year is 36 months old at the valuation date.', 'Read the growth curve: At 36 months G = 0.80, so 80% of ultimate has emerged.',
  'Invert it: 1 ÷ 0.80 = 1.25, the factor to ultimate.', 'Apply it: 4,200 × 1.25 = 5,250 ultimate; less 4,200 paid leaves a reserve of 1,050.', F,
  '',
  'Move the tail factor and watch the reserve follow:',
  '',
  `${F}app`, 'title: Tail Factor Simulator',
  '<label>Tail factor <input id="t" type="range" min="100" max="120" value="105"></label> Reserve <b id="o"></b>',
  '<div style="height: 260px; background: var(--px-bg-elevated)"></div>',
  '<script>const t = document.getElementById("t"), o = document.getElementById("o"); const s = () => { o.textContent = Math.round(4200 * 1.25 * t.value / 100 - 4200); }; t.oninput = s; s();</script>', F,
].join('\n');

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
  await app.context().route(/^https?:\/\/(localhost|127\.0\.0\.1):11434\//, (route) => route.abort('connectionrefused'));
  const page = await app.firstWindow();
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 300)}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 300)}`); });
  await page.waitForSelector('[data-part-id="workbench.parts.titlebar"]', { state: 'attached', timeout: 90_000 });
  await page.waitForTimeout(3_000);
  return { app, page };
}

let fails = 0;
const check = (ok, what) => { if (!ok) fails++; console.log(`[probe] ${ok ? 'PASS' : 'FAIL'} ${what}`); };

async function shot(app, page, name, selector) {
  const file = path.join(outDir, name);
  try {
    if (selector) await page.locator(selector).first().screenshot({ path: file, timeout: 8_000, animations: 'disabled' });
    else await page.screenshot({ path: file, timeout: 8_000, animations: 'disabled' });
    console.log(`[probe] screenshot -> ${file}`);
    return;
  } catch { /* fall back */ }
  const png = await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed());
    return w ? (await w.webContents.capturePage()).toPNG().toString('base64') : null;
  }).catch(() => null);
  if (png) { await fs.writeFile(file, Buffer.from(png, 'base64')); console.log(`[probe] screenshot (capturePage) -> ${file}`); }
}

const run = (page, id, ...args) => page.evaluate(async ({ id, args }) => {
  const svc = window.__parallx_workbench__?._services?.get?.({ id: 'ICommandService' });
  return svc ? svc.executeCommand(id, ...args) : null;
}, { id, args });

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  const stamp = Date.now();
  const appRoot = path.join(os.tmpdir(), `parallx-af-root-${stamp}`);
  const ws = path.join(os.tmpdir(), `parallx-af-ws-${stamp}`);
  await fs.mkdir(path.join(appRoot, 'data'), { recursive: true });
  await fs.mkdir(path.join(ws, '.parallx'), { recursive: true });
  await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: ws }));
  await fs.writeFile(path.join(ws, '.parallx', 'ai-config.json'), JSON.stringify({ overrides: { indexing: { autoIndex: false, watchFiles: false } } }));
  try {
    let { app, page } = await launch(appRoot);
    const seeded = await page.evaluate(async (answer) => {
      const svc = window.__parallx_workbench__._services.get({ id: 'IChatService' });
      const wsId = svc._workspaceId;
      const now = Date.now();
      const r = await window.parallxElectron.database.runTransaction([
        { type: 'run', sql: 'INSERT INTO chat_sessions (id, workspace_id, title, mode, model_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', params: ['probe-forms', wsId, 'Forms probe', 'agent', '', now, now] },
        { type: 'run', sql: 'INSERT INTO chat_messages (session_id, role, content, parts_json, is_complete, timestamp, sort_order) VALUES (?, ?, ?, ?, 1, ?, 0)', params: ['probe-forms', 'user', 'Walk me through the chain ladder.', '[]', now] },
        { type: 'run', sql: 'INSERT INTO chat_messages (session_id, role, content, parts_json, is_complete, timestamp, sort_order) VALUES (?, ?, ?, ?, 1, ?, 1)', params: ['probe-forms', 'assistant', answer, JSON.stringify([{ kind: 'markdown', content: answer }]), now] },
      ]);
      return r.error ? `ERR ${r.error.message}` : 'ok';
    }, ANSWER);
    check(seeded === 'ok', `seeded the chat (${seeded})`);
    await app.close();

    ({ app, page } = await launch(appRoot));
    await run(page, 'chat.show');
    await page.waitForTimeout(1_000);
    // Open the seeded chat from the chat's history list.
    const history = await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('button, [role="button"]')).find((el) => /histor|chats/i.test(`${el.getAttribute('aria-label') ?? ''} ${el.getAttribute('title') ?? ''}`));
      b?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return b ? (b.getAttribute('aria-label') || b.getAttribute('title')) : null;
    });
    console.log(`[probe] history button: ${history}`);
    await page.waitForTimeout(800);
    const opened = await page.evaluate(async () => {
      const row = Array.from(document.querySelectorAll('*')).find((el) => el.children.length === 0 && el.textContent?.trim() === 'Forms probe');
      if (!row) return false;
      (row.closest('[role="option"], [role="treeitem"], [role="button"], button, li, .parallx-chat-session-item') ?? row).dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return true;
    });
    await page.waitForTimeout(1_500);
    const forms = await page.evaluate(() => Array.from(document.querySelectorAll('.px-af-host')).map((h) => h.getAttribute('data-af-form')));
    check(opened && forms.join(',') === 'takeaway,chart,timeline,live,worked,app', `the answer draws its forms (${forms.join(',')})`);
    check(await page.evaluate(() => document.querySelectorAll('.markdown-alert-lead').length === 2), 'callouts open with a lead-in word');

    // Widen the chat so the answer reads at its usual width.
    await page.setViewportSize({ width: 1440, height: 1000 }).catch(() => {});
    await page.waitForTimeout(500);
    for (const theme of ['dark', 'light']) {
      // Settings › Appearance, the way the keyboard audit switches mode.
      await run(page, 'settings.openAppearance');
      await page.waitForTimeout(800);
      await page.evaluate((m) => Array.from(document.querySelectorAll(`[data-px-id="appearance.mode.${m}"]`)).find((e) => e.getClientRects().length)?.click(), theme);
      await page.waitForTimeout(800);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
      const answerSel = '.parallx-chat-markdown:has(.px-af-host)';
      await page.locator('.px-af-host[data-af-form="takeaway"]').scrollIntoViewIfNeeded().catch(() => {});
      await shot(app, page, `${theme}-1-steps-callout-takeaway-chart.png`, answerSel);
    }

    // Live numbers: type a new paid amount.
    const live = page.locator('input[data-af-var="paid"]').first();
    await live.scrollIntoViewIfNeeded();
    await live.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('8,000');
    await page.waitForTimeout(300);
    const reserve = await page.evaluate(() => Array.from(document.querySelectorAll('[data-af-out="reserve"]')).map((n) => n.textContent));
    check(reserve.every((t) => t === '2,000'), `typing 8,000 makes the reserve 2,000 (${reserve.join(', ')})`);
    check(await page.evaluate(() => document.activeElement?.getAttribute('data-af-var') === 'paid'), 'the field keeps focus while typing');
    await shot(app, page, 'light-2-live.png', '.px-af-host[data-af-form="live"]');

    // Worked solution: Next Step by keyboard until done, then Start Over.
    const next = page.locator('.px-af-worked__next').first();
    await next.scrollIntoViewIfNeeded();
    await next.focus();
    for (let i = 0; i < 3; i++) { await page.keyboard.press('Enter'); await page.waitForTimeout(150); }
    const worked = await page.evaluate(() => ({
      shown: Array.from(document.querySelectorAll('.px-af-worked__step')).filter((s) => !s.hidden).length,
      focus: document.activeElement?.textContent?.trim(),
    }));
    check(worked.shown === 4 && worked.focus === 'Start Over', `Enter steps through all four, focus lands on Start Over (${JSON.stringify(worked)})`);
    await shot(app, page, 'light-3-worked.png', '.px-af-host[data-af-form="worked"]');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);
    check(await page.evaluate(() => Array.from(document.querySelectorAll('.px-af-worked__step')).filter((s) => !s.hidden).length === 1), 'Start Over goes back to step one');

    // Timeline and table.
    await page.locator('.px-af-host[data-af-form="timeline"]').scrollIntoViewIfNeeded();
    await shot(app, page, 'light-4-timeline-table.png', '.parallx-chat-markdown:has(.px-af-host)');

    // Save the chart to a page: a Chart block that keeps working.
    const save = page.locator('.px-af-host[data-af-form="chart"] .px-af-save button').first();
    await save.scrollIntoViewIfNeeded();
    await save.click();
    await page.waitForTimeout(2_500);
    const block = await page.evaluate(() => {
      const b = document.querySelector('.canvas-toolblock[data-block-type="parallx.chat.chart"]');
      return b ? { bars: b.querySelectorAll('.px-af-chart__bar').length, save: b.querySelectorAll('.px-af-save').length } : null;
    });
    check(!!block && block.bars === 5 && block.save === 0, `Save To Page opens a page with a working Chart block (${JSON.stringify(block)})`);
    await shot(app, page, 'light-5-chart-on-page.png', '.canvas-toolblock');

    // The mini-app: its script runs in the jail, the frame takes the height it reports.
    await page.locator('.px-af-host[data-af-form="app"]').first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(1_500);
    const appFrame = page.frames().find((f) => f.url().startsWith('parallx-frame:') && f.parentFrame() === page.mainFrame());
    const reserveText = appFrame ? await appFrame.evaluate(() => document.getElementById('o')?.textContent).catch((e) => String(e)) : null;
    const frameH = await page.evaluate(() => document.querySelector('.px-af-app__frame')?.getBoundingClientRect().height ?? 0);
    check(reserveText === '1313', `the app's script runs in its frame (reserve ${reserveText})`);
    check(frameH >= 270 && frameH < 315, `the frame sizes to its content (${Math.round(frameH)}px)`);
    check(await page.evaluate(() => { const f = document.querySelector('.px-af-app__frame'); return f?.getAttribute('sandbox') === 'allow-scripts'; }), 'the frame is sandboxed without same-origin');
    const scheme = appFrame ? await appFrame.evaluate(() => getComputedStyle(document.documentElement).colorScheme).catch(() => '') : '';
    check(scheme === 'light', `a frame drawn in the dark theme follows the switch to light (${scheme})`);
    await shot(app, page, 'light-6-mini-app.png', '.px-af-host[data-af-form="app"]');

    await page.locator('.px-af-app__actions button', { hasText: 'Open In Tab' }).first().click();
    await page.waitForTimeout(1_500);
    check(await page.evaluate(() => !!document.querySelector('.px-af-app-fill .px-af-app__frame')), 'Open In Tab shows the app in a tab of its own');
    await shot(app, page, 'light-7-mini-app-tab.png');

    await page.locator('.px-af-app__actions button', { hasText: 'Pin To Dashboard' }).first().click();
    await page.waitForTimeout(2_500);
    const pinned = await page.evaluate(() => ({ frames: document.querySelectorAll('.px-af-app-fill .px-af-app__frame').length, title: Array.from(document.querySelectorAll('.dashboard-widget__title, [class*="dashboard-widget"] [class*="title"]')).some((e) => e.textContent?.includes('Tail Factor Simulator')) }));
    check(pinned.frames >= 1 && pinned.title, `Pin To Dashboard places a Mini-App widget (${JSON.stringify(pinned)})`);
    await shot(app, page, 'light-8-mini-app-dashboard.png');
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
