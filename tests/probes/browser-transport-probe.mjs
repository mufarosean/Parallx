// browser-transport-probe.mjs: Task A of docs/BROWSER_AGENT_AUDIT_AND_PROPOSAL.md.
//
// Proves native CDP on the ACTUAL Browser bridge in the ACTUAL app, not a
// standalone Electron harness: the app launches hidden (PARALLX_HIDDEN_PROBE)
// on a throwaway app root and workspace, the Browser extension is enabled, a
// real agent-partition WebContentsView is created through the preload API, and
// the checks run through that view's own debugger from the main process.
//
// Fixture pages come from two local HTTP servers (two origins, so the second
// one's iframe is an out-of-process frame). Nothing leaves the machine.
// Every step is time-boxed and logged to progress.log, so a stall names itself.
//
// Usage: node tests/probes/browser-transport-probe.mjs
// Requires `npm run build` first. Evidence: test-results/browser-audit/transport-*/

import { _electron as electron } from 'playwright';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'test-results', 'browser-audit', `transport-${Date.now().toString(36)}`);
const t0 = Date.now();
const step = (msg) => { const line = `[${((Date.now() - t0) / 1000).toFixed(1)}s] ${msg}`; console.log(line); try { appendFileSync(path.join(OUT, 'progress.log'), line + '\n'); } catch { /* dir not yet made */ } };
const within = (ms, label, promise) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(`step timed out after ${ms} ms: ${label}`)), ms)),
]);

function serve(routes) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const body = routes[req.url.split('?')[0]];
      if (!body) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(body);
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}

function launchEnv(appRoot) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE') env[k] = v;
  Object.assign(env, {
    PARALLX_TEST_MODE: '1', PARALLX_RENDERER_PORT: '0', PARALLX_HIDDEN_PROBE: '1', PARALLX_APP_ROOT: appRoot, PARALLX_USER_DATA: path.join(appRoot, 'data', 'chromium-cache'),
    // The fixtures' hosts: without them the assistant's profile refuses every loopback request.
    PARALLX_BROWSER_AGENT_ALLOW_LOCAL: '127.0.0.1,localhost',
  });
  return env;
}

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  // Second origin: localhost vs 127.0.0.1 are different sites, so this frame is out of process.
  const other = await serve({ '/frame': '<!doctype html><title>Cross</title><button id="x">Cross frame action</button>' });
  const crossUrl = `http://localhost:${other.port}/frame`;
  const main = await serve({
    '/': `<!doctype html><title>Transport fixture</title>
      <button id="action">Native action</button>
      <a id="popup" href="/popup" target="_blank">Open popup</a>
      <div id="host"></div>
      <div contenteditable="true" role="textbox" aria-label="Rich editor">Rich editor</div>
      <iframe id="same" srcdoc="<button>Inside frame</button>" style="width:200px;height:60px"></iframe>
      <iframe id="cross" src="${crossUrl}" style="width:240px;height:60px"></iframe>
      <p id="scheme"></p>
      <script>
        window.clicks = [];
        action.addEventListener('click', (e) => clicks.push(e.isTrusted));
        host.attachShadow({ mode: 'open' }).innerHTML = '<button>Shadow action</button>';
        const q = matchMedia('(prefers-color-scheme: dark)');
        const paint = () => { scheme.textContent = q.matches ? 'dark' : 'light'; };
        q.addEventListener('change', paint); paint();
      </script>`,
    '/popup': '<!doctype html><title>Popup</title><p>Popup page</p>',
  });
  const baseUrl = `http://127.0.0.1:${main.port}/`;
  step(`fixtures at ${baseUrl} and ${crossUrl}`);

  const stamp = Date.now();
  const appRoot = path.join(os.tmpdir(), `parallx-transport-root-${stamp}`);
  const workspace = path.join(os.tmpdir(), `parallx-transport-ws-${stamp}`);
  await fs.mkdir(path.join(appRoot, 'data'), { recursive: true });
  await fs.mkdir(workspace, { recursive: true });
  await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: workspace }));
  await fs.symlink(path.join(ROOT, 'ext'), path.join(appRoot, 'ext'), 'junction');

  const app = await electron.launch({ args: ['.'], cwd: ROOT, env: launchEnv(appRoot) });
  // Keep Playwright from answering page dialogs itself (it dismisses any nobody listens for).
  app.context().on('dialog', () => {});
  const result = { scope: 'Actual app, actual Browser bridge, real agent-partition view, its existing debugger; hidden window.', baseUrl, checks: {} };
  const c = result.checks;
  // One main-process call per check, each time-boxed. State that must outlive
  // a call (the frame sessions) lives on globalThis.__tp in the main process.
  const mainCall = (label, fn, arg, ms = 20_000) => { step(`main: ${label}`); return within(ms, label, app.evaluate(fn, arg)); };
  let ok = false;
  try {
    const page = await app.firstWindow();
    await page.waitForSelector('[data-part-id="workbench.parts.titlebar"]', { state: 'attached', timeout: 90_000 });
    await page.waitForTimeout(3_000);
    step('app up; enabling the Browser');
    await within(15_000, 'enable browser', page.evaluate(async () => {
      await window.__parallx_workbench__._services.get({ id: 'IToolEnablementService' }).setEnablement('parallx.browser', true);
    }));
    await page.waitForTimeout(2_000);

    step('creating an agent view through the preload API');
    const info = await within(15_000, 'create view', page.evaluate(async () => {
      const b = window.parallxElectron.browser;
      window.__events = [];
      b.onEvent((e) => window.__events.push(e));
      const v = await b.view('create', 'agent:transport', 'agent', {});
      await b.view('bounds', 'agent:transport', { x: 0, y: 40, width: 900, height: 640, visible: true });
      return v;
    }));
    result.view = info;
    const id = info.webContentsId;
    step(`view ${id}; navigating (not awaiting the load promise)`);
    await page.evaluate((url) => { void window.parallxElectron.browser.view('navigate', 'agent:transport', url); }, baseUrl);
    c.loaded = await mainCall('wait for load', async ({ webContents }, { id, url }) => {
      const wc = webContents.fromId(id);
      for (let i = 0; i < 100; i++) {
        if (!wc.isLoading() && wc.getURL() === url) return { url: wc.getURL(), title: wc.getTitle() };
        await new Promise((r) => setTimeout(r, 100));
      }
      return { stillLoading: wc.isLoading(), url: wc.getURL() };
    }, { id, url: baseUrl });

    c.attach = await mainCall('debugger state and auto-attach', async ({ webContents }, { id, crossUrl }) => {
      const wc = webContents.fromId(id);
      const dbg = wc.debugger;
      globalThis.__tp = { frameSessions: new Map() };
      const out = { electron: process.versions.electron, chromium: process.versions.chrome, attachedByBridge: dbg.isAttached() };
      dbg.on('message', (_e, method, params) => {
        if (method === 'Target.attachedToTarget' && params.targetInfo.type === 'iframe') globalThis.__tp.frameSessions.set(params.targetInfo.url, params.sessionId);
      });
      await dbg.sendCommand('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
      for (let i = 0; i < 50 && !globalThis.__tp.frameSessions.has(crossUrl); i++) await new Promise((r) => setTimeout(r, 100));
      out.crossFrameSession = globalThis.__tp.frameSessions.get(crossUrl) || null;
      return out;
    }, { id, crossUrl });

    c.ax = await mainCall('accessibility trees', async ({ webContents }, { id, crossUrl }) => {
      const dbg = webContents.fromId(id).debugger;
      const send = (m, p, s) => dbg.sendCommand(m, p || {}, s);
      await send('Accessibility.enable');
      const names = (tree) => tree.nodes.filter((n) => !n.ignored).map((n) => `${n.role && n.role.value}:${n.name && n.name.value}`);
      const top = names(await send('Accessibility.getFullAXTree'));
      const tree = await send('Page.getFrameTree');
      const child = (tree.frameTree.childFrames || []).find((f) => f.frame.url === 'about:srcdoc');
      const crossSession = globalThis.__tp.frameSessions.get(crossUrl);
      return {
        nativeButton: top.includes('button:Native action'),
        shadowButton: top.includes('button:Shadow action'),
        richEditor: top.some((s) => s.startsWith('textbox:Rich editor')),
        sameOriginFrame: child ? names(await send('Accessibility.getFullAXTree', { frameId: child.frame.id })).includes('button:Inside frame') : 'no srcdoc frame',
        crossOriginFrame: crossSession ? names(await send('Accessibility.getFullAXTree', {}, crossSession)).includes('button:Cross frame action') : 'no session',
      };
    }, { id, crossUrl });

    const clickSelector = async ({ webContents }, { id, selector }) => {
      const dbg = webContents.fromId(id).debugger;
      const send = (m, p) => dbg.sendCommand(m, p || {});
      await send('DOM.enable');
      const doc = await send('DOM.getDocument', { depth: 0 });
      const { nodeId } = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector });
      const { quads } = await send('DOM.getContentQuads', { nodeId });
      const q = quads[0];
      const x = (q[0] + q[2] + q[4] + q[6]) / 4; const y = (q[1] + q[3] + q[5] + q[7]) / 4;
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
      return { x, y };
    };
    await mainCall('native click on #action', clickSelector, { id, selector: '#action' });
    c.trustedClicks = await mainCall('read clicks', ({ webContents }, id) => webContents.fromId(id).executeJavaScript('window.clicks', true), id);

    // Page.captureScreenshot waits for a compositor frame that a hidden window
    // never produces (first run: timed out after 20 s). Record that, time-boxed,
    // then capture through Electron's capturePage, which the bridge's own
    // snapshot already uses.
    c.cdpCaptureInHiddenWindow = await within(4_000, 'cdp capture', app.evaluate(async ({ webContents }, id) => {
      const r = await webContents.fromId(id).debugger.sendCommand('Page.captureScreenshot', { format: 'png' });
      return `returned ${Buffer.from(r.data, 'base64').length} bytes`;
    }, id)).catch((e) => String(e.message));
    const shot = await mainCall('capturePage', async ({ webContents }, id) => {
      const img = await webContents.fromId(id).capturePage();
      return { b64: img.toPNG().toString('base64'), size: img.getSize(), empty: img.isEmpty() };
    }, id);
    c.capture = { size: shot.size, empty: shot.empty };
    c.screenshotBytes = Buffer.from(shot.b64, 'base64').length;
    await fs.writeFile(path.join(OUT, 'page.png'), Buffer.from(shot.b64, 'base64'));

    c.documentStartScript = await mainCall('document-start script', async ({ webContents }, id) => {
      const wc = webContents.fromId(id);
      const send = (m, p) => wc.debugger.sendCommand(m, p || {});
      const added = await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__probeMarker = 42;' });
      wc.reload();
      for (let i = 0; i < 100 && (wc.isLoading() || wc.getURL() === 'about:blank'); i++) await new Promise((r) => setTimeout(r, 100));
      const v = await wc.executeJavaScript('window.__probeMarker', true);
      await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: added.identifier });
      return v;
    }, id);

    step('page theme through the bridge IPC');
    c.pageThemeReply = await within(10_000, 'setPageTheme', page.evaluate((i) => window.parallxElectron.browser.setPageTheme(i, 'dark'), id));
    await page.waitForTimeout(300);
    // Read the media query itself: the page's change listener only runs on the
    // next rendered frame, which a hidden window never produces.
    c.pageThemeDark = await mainCall('read theme', ({ webContents }, i) => webContents.fromId(i).executeJavaScript('matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"', true), id);

    c.reattach = await mainCall('detach and reattach', async ({ webContents }, id) => {
      const dbg = webContents.fromId(id).debugger;
      dbg.detach();
      const detached = !dbg.isAttached();
      dbg.attach('1.3');
      await dbg.sendCommand('Page.enable');
      await dbg.sendCommand('Accessibility.enable');
      const tree = await dbg.sendCommand('Accessibility.getFullAXTree');
      return { detached, axAfter: tree.nodes.some((n) => n.role && n.role.value === 'button' && n.name && n.name.value === 'Native action') };
    }, id);

    // The popup goes last: the broker opens an assistant tab for it, and the
    // extension's view reconciliation then reaps views no tab owns, this probe's view included.
    // A popup from an assistant-profile page stays in that profile: a new
    // assistant tab (tab-open), never a user tab (open-url).
    step('popup: native click on the target=_blank link');
    await mainCall('native click on #popup', clickSelector, { id, selector: '#popup' });
    await page.waitForTimeout(1_200);
    c.popupEvent = await page.evaluate(() => ({
      openUrl: window.__events.filter((e) => e.type === 'open-url').map((e) => e.payload),
      tabOpen: window.__events.filter((e) => e.type === 'automation:event' && e.payload && e.payload.type === 'tab-open').map((e) => e.payload),
    }));

    result.gate = {
      axReadMain: !!(c.ax.nativeButton && c.ax.shadowButton && c.ax.richEditor),
      axReadFrames: c.ax.sameOriginFrame === true && c.ax.crossOriginFrame === true,
      trustedInput: Array.isArray(c.trustedClicks) && c.trustedClicks.length === 1 && c.trustedClicks[0] === true,
      capture: c.screenshotBytes > 5000,
      popupStaysAssistant: !!(c.popupEvent && c.popupEvent.openUrl.length === 0 && c.popupEvent.tabOpen.length === 1 && c.popupEvent.tabOpen[0].openerTabId === 'agent:transport'),
      documentStartScripts: c.documentStartScript === 42,
      pageThemeCoexists: c.pageThemeDark === 'dark',
      detachReattach: !!(c.reattach.detached && c.reattach.axAfter),
    };
    ok = Object.values(result.gate).every(Boolean);
    result.pass = ok;
  } catch (err) {
    result.error = String(err && err.stack || err);
    step(`FAILED: ${result.error.split('\n')[0]}`);
  } finally {
    await within(15_000, 'app.close', app.close()).catch(() => { try { app.process().kill(); } catch { /* gone */ } });
    main.srv.close(); other.srv.close();
    await fs.rm(appRoot, { recursive: true, force: true }).catch(() => {});
    await fs.rm(workspace, { recursive: true, force: true }).catch(() => {});
    await fs.writeFile(path.join(OUT, 'result.json'), JSON.stringify(result, null, 2));
  }
  console.log(JSON.stringify({ out: OUT, gate: result.gate, error: result.error, checks: result.checks }, null, 2));
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
