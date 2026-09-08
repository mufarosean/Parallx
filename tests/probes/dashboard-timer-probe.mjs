// dashboard-timer-probe.mjs — render the Timer widget in a HIDDEN window over
// a synthetic state (tasks, a week of sessions) and save a screenshot, so
// the layout can be checked by eye in each interval mode.
//
// Run (Electron, not Node):
//   env -u ELECTRON_RUN_AS_NODE node_modules/.bin/electron tests/probes/dashboard-timer-probe.mjs <out.png> [--mode focus|short|long] [--running] [--light] [--no-tasks]
import { app, BrowserWindow, nativeTheme } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const args = process.argv.slice(2);
const [outPng] = args.filter((a) => !a.startsWith('--'));
const mode = (args.find((a) => a.startsWith('--mode='))?.slice(7)) || 'focus';
const running = args.includes('--running');
const light = args.includes('--light');
const noTasks = args.includes('--no-tasks');
if (!outPng) { console.error('usage: electron dashboard-timer-probe.mjs <out.png> [--mode=focus|short|long] [--running] [--light] [--no-tasks]'); app.exit(2); }

app.whenReady().then(async () => {
  nativeTheme.themeSource = light ? 'light' : 'dark';
  const esbuild = require('esbuild');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plx-timer-'));
  const bundle = path.join(tmp, 'timer.js');
  await esbuild.build({ entryPoints: [path.join(ROOT, 'src', 'built-in', 'dashboard', 'widgets', 'timerWidget.ts')], bundle: true, platform: 'browser', format: 'esm', outfile: bundle, logLevel: 'error' });
  const css = (p) => pathToFileURL(path.join(ROOT, ...p)).href;
  const DAY = 86400000;
  const now = Date.now();
  const log = [];
  for (let d = 6; d >= 1; d--) for (let i = 0; i < [3, 0, 5, 4, 2, 6][d - 1] ?? 2; i++) log.push({ startedAt: now - d * DAY + i * 1800000, minutes: 25, label: 'Focus', mode: 'focus' });
  log.push({ startedAt: now - 2 * 3600000, minutes: 25, label: 'Focus', mode: 'focus' });
  const state = {
    log, mode, cycle: 1,
    endsAt: running ? now + 17 * 60000 + 42000 : null, pausedRemaining: null,
    tasks: noTasks ? [] : [
      { id: 'a', title: 'Sahasrabuddhe CAS SP17 07', est: 3, act: 1, done: false, createdAt: now },
      { id: 'b', title: 'Brosius flashcards, the due pile', est: 2, act: 0, done: false, createdAt: now },
      { id: 'c', title: 'Clark: read the LDF curve derivation again', est: 1, act: 1, done: true, createdAt: now },
    ],
    activeTaskId: noTasks ? null : 'a',
  };
  const html = `<!doctype html><html${light ? ' data-px-mode="light"' : ''}><head><meta charset="utf-8">
<link rel="stylesheet" href="${css(['src', 'theme', 'px-tokens.css'])}">
<link rel="stylesheet" href="${css(['src', 'built-in', 'dashboard', 'dashboard.css'])}">
<style>html,body{margin:0;height:100%;background:var(--px-bg);color:var(--px-text);font-family:var(--px-font-ui);font-size:var(--px-text-base)}#host{position:absolute;left:24px;top:24px;width:360px;height:420px}</style></head>
<body><div id="host"></div>
<script>window.__STATE__ = ${JSON.stringify(state).replace(/<\/script/gi, '<\\/script')};</script>
<script type="module">
  import { TIMER_WIDGET } from '${pathToFileURL(bundle).href}';
  try {
    const listeners = [];
    window.__HANDLE__ = TIMER_WIDGET.createWidget(document.getElementById('host'), {
      instanceId: 'probe', pageId: 'probe', config: TIMER_WIDGET.defaultConfig,
      // A stand-in planner: one five-hour quiz block and one task due today.
      api: { commands: { executeCommand: async (id) => id === 'planner.getRegistry' ? { data: {
        listTasks: async () => [{ id: 'tk1', title: 'Review Verrall flashcards', status: 'planned', dueAt: Date.now() }],
        listEvents: async () => [{ id: 'ev1', title: 'Quiz: Brosius and Clark', startAt: Date.now(), endAt: Date.now() + 5 * 3600000, allDay: false }],
        updateTask: async () => ({}),
      } } : null } },
      cachedOutput: JSON.stringify(window.__STATE__), errorMessage: null,
      onDidChangeConfig: (fn) => { listeners.push(fn); return { dispose() {} }; },
      requestRefresh() {}, setCachedOutput(s) { window.__SAVED__ = s; }, setError() {}, clearError() {},
    });
    window.__READY__ = true;
  } catch (err) { window.__ERROR__ = String(err && err.stack || err); }
</script></body></html>`;
  const page = path.join(tmp, 'timer.html');
  fs.writeFileSync(page, html);
  const win = new BrowserWindow({ show: false, width: 410, height: 470, webPreferences: { webSecurity: false, contextIsolation: false, nodeIntegration: false, backgroundThrottling: false, offscreen: true } });
  win.webContents.setFrameRate(30);
  await win.loadFile(page);
  const deadline = Date.now() + 8000;
  let ready = false; let error = null;
  while (Date.now() < deadline) {
    const s = await win.webContents.executeJavaScript('({ ready: !!window.__READY__, error: window.__ERROR__ || null })');
    if (s.error) { error = s.error; break; }
    if (s.ready) { ready = true; break; }
    await new Promise((r) => setTimeout(r, 120));
  }
  if (error) { console.error('mount failed:', error); app.exit(1); return; }
  if (!ready) { console.error('mount timed out'); app.exit(1); return; }
  await new Promise((r) => setTimeout(r, 700));
  const diag = await win.webContents.executeJavaScript(`(() => {
    const q = (s) => document.querySelector(s);
    const host = document.getElementById('host');
    return { face: q('.dtimer__face')?.textContent, start: q('.dtimer__btn--primary')?.textContent, caption: q('.dtimer__caption')?.textContent, summary: q('.dtimer__taskssummary')?.textContent, stats: q('.dtimer__stats')?.textContent, tasks: document.querySelectorAll('.dtimer__task').length, mode: host.dataset.mode, overflow: host.scrollHeight > host.clientHeight };
  })()`);
  const image = await win.webContents.capturePage();
  fs.writeFileSync(outPng, image.toPNG());
  console.log(`rendered -> ${outPng} (${image.getSize().width}x${image.getSize().height})`);
  console.log(JSON.stringify(diag));
  app.exit(0);
}).catch((err) => { console.error('probe error:', err && err.stack || err); app.exit(2); });
