// Feasibility check of the actual Browser bridge's WebContentsViews, using
// disposable userData and synthetic pages. No remote debugging port or model.
// Experimental diagnostic: the 2026-09-10 audit failed during fixture loading
// (ERR_FAILED -2), before the assertions below. Consult the generated artifact;
// a shell exit code alone is not evidence that this feasibility check passed.
const { app, BrowserWindow, webContents, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const repo = path.resolve(__dirname, '../..');
const base = path.join(repo, 'test-results/browser-audit');
fs.mkdirSync(base, { recursive: true });
const root = fs.mkdtempSync(path.join(base, 'cdp-'));
for (const dir of ['profile', 'session', 'tmp']) fs.mkdirSync(path.join(root, dir));
process.env.TEMP = process.env.TMP = path.join(root, 'tmp');
app.setPath('temp', path.join(root, 'tmp'));
// Match the established hidden Electron test harness on this Windows host.
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('in-process-gpu');
app.setPath('userData', path.join(root, 'profile'));
app.setPath('sessionData', path.join(root, 'session'));
global.fetch = async () => { throw new Error('Network disabled in audit fixture'); };
const watchdog = setTimeout(() => { console.error('CDP audit timed out', root); app.exit(2); }, 25000);

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 800, height: 600, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  const events = [];
  win.webContents.send = (channel, payload) => events.push({ channel, payload });
  const handlers = new Map();
  const { setupBrowserBridge } = require('../../electron/browserBridge.cjs');
  setupBrowserBridge({ handle: (channel, fn) => handlers.set(channel, fn) }, { getMainWindow: () => win, userData: path.join(root, 'profile'), getWorkspaceRoot: () => root });
  for (const partition of ['persist:parallx-browser', 'persist:parallx-browser-agent', 'parallx-browser-private']) {
    session.fromPartition(partition).webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => callback({ cancel: !/^(data:|about:)/.test(details.url) }));
  }
  // Data documents do not issue network requests. No page below leaves the fixture.
  const view = (method, tabId, ...args) => handlers.get('browser:view')({ sender: win.webContents }, method, tabId, ...args);
  const info = await view('create', 'agent:audit', 'agent');
  const wc = webContents.fromId(info.webContentsId);
  wc.on('render-process-gone', (_event, details) => fs.writeFileSync(path.join(root, 'renderer-failure.json'), JSON.stringify(details)));
  await view('bounds', 'agent:audit', { x: 0, y: 0, width: 780, height: 560, visible: true });
  const html = '<!doctype html><button id="action">Native action</button><a id="popup" href="https://fixture.invalid/popup" target="_blank">Popup</a><script>window.clicks=[];action.onclick=e=>clicks.push(e.isTrusted)</script>';
  await wc.loadURL('about:blank');
  await wc.executeJavaScript(`document.open(); document.write(${JSON.stringify(html)}); document.close();`);
  const attachedBefore = wc.debugger.isAttached();
  const ax = await wc.debugger.sendCommand('Accessibility.getFullAXTree');
  assert(ax.nodes.some(n => n.role?.value === 'button' && n.name?.value === 'Native action'));
  const click = async (selector) => {
    const rect = await wc.executeJavaScript(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await wc.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', ...rect, button: 'left', clickCount: 1 });
    await wc.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', ...rect, button: 'left', clickCount: 1 });
  };
  await click('#action');
  const clicks = await wc.executeJavaScript('clicks');
  assert.deepEqual(clicks, [true]);
  await click('#popup');
  await new Promise(resolve => setTimeout(resolve, 100));
  const popup = events.find(e => e.channel === 'browser:open-url');
  const screenshot = await wc.debugger.sendCommand('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(root, 'page.png'), Buffer.from(screenshot.data, 'base64'));
  const result = { pass: true, root, versions: { electron: process.versions.electron, chromium: process.versions.chrome }, attachedBefore, axButtonFound: true, trustedClick: clicks[0], popupForwarded: !!popup, popupPayload: popup?.payload, screenshotBytes: Buffer.from(screenshot.data, 'base64').length, scope: 'Actual Browser bridge in a fresh hidden Electron app; native view, AX, input and screenshot through its existing debugger. No Playwright attachment claim.' };
  fs.writeFileSync(path.join(root, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  await view('destroy', 'agent:audit');
  win.destroy(); clearTimeout(watchdog); app.exit(0);
}).catch(err => { fs.writeFileSync(path.join(root, 'failure.txt'), err.stack); console.error(err.stack, root); clearTimeout(watchdog); app.exit(1); });
