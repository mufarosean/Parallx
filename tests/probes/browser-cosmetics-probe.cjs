// browser-cosmetics-probe.cjs: does the browser's cosmetic-filter path work
// end to end in a sandboxed, context-isolated page? A HIDDEN window loads a
// local page through the same preload registration and IPC handlers the
// bridge uses (electron/browserBridge.cjs, ensureCosmetics) with the real
// engine cache, then reads what got hidden. The page is served from a local
// socket but reached as http://probe-parallx.com (a host-resolver rule maps
// it to 127.0.0.1), because the lists exempt localhost and bare IP hosts
// from generic hiding. The test elements are built from the engine's own
// generic rules, so the probe never guesses a selector.
// No window ever appears. No network beyond the loopback.
//
// Run: env -u ELECTRON_RUN_AS_NODE node_modules/.bin/electron tests/probes/browser-cosmetics-probe.cjs [engine.bin]
// Exit 0 when every generic-rule element is hidden and the content is not.
const { app, BrowserWindow, session, ipcMain } = require('electron');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { ElectronBlocker } = require('@ghostery/adblocker-electron');
const { parse: parseTld } = require('tldts');

const PRELOAD = require.resolve('@ghostery/adblocker-electron-preload');
const ENGINE = process.argv[2] || ['engine-full.bin', 'engine.bin']
  .map((f) => path.join(process.cwd(), 'data', 'chromium-cache', 'browser', f))
  .find((p) => fs.existsSync(p));
const HOST = 'probe-parallx.com';
app.commandLine.appendSwitch('host-resolver-rules', 'MAP ' + HOST + ' 127.0.0.1');

app.whenReady().then(async () => {
  if (!ENGINE) throw new Error('no engine cache under data/chromium-cache/browser; run the app once so the lists load');
  const blocker = ElectronBlocker.deserialize(fs.readFileSync(ENGINE));
  const generic = blocker.getFilters().cosmeticFilters.filter((f) => f.isGenericHide && f.isGenericHide() && !f.isUnhide() && !f.isScriptInject());
  const classes = generic.filter((f) => /^\.[A-Za-z][\w-]*$/.test(f.getSelector())).slice(0, 3).map((f) => f.getSelector().slice(1));
  const ids = generic.filter((f) => /^#[A-Za-z][\w-]*$/.test(f.getSelector())).slice(0, 2).map((f) => f.getSelector().slice(1));
  if (!classes.length && !ids.length) throw new Error('engine has no simple generic class or id rules');
  console.log(`test classes: ${classes.join(' ')} | test ids: ${ids.join(' ')}`);

  const ses = session.fromPartition('probe-cosmetics');
  ses.registerPreloadScript({ type: 'frame', filePath: PRELOAD });
  let calls = 0;
  ipcMain.handle('@ghostery/adblocker/is-mutation-observer-enabled', async () => true);
  ipcMain.handle('@ghostery/adblocker/inject-cosmetic-filters', async (event, url, msg) => {
    calls++;
    const first = msg === undefined;
    const parsed = parseTld(String(url || ''));
    const r = blocker.getCosmeticsFilters({
      url, hostname: parsed.hostname || '', domain: parsed.domain || '',
      classes: msg && msg.classes, hrefs: msg && msg.hrefs, ids: msg && msg.ids,
      getBaseRules: first, getInjectionRules: false, getExtendedRules: false, getRulesFromHostname: first, getRulesFromDOM: !first,
      callerContext: { lifecycle: msg && msg.lifecycle },
    });
    console.log(`  ipc call ${calls}: first=${first} classes=${msg && msg.classes ? msg.classes.length : 0} ids=${msg && msg.ids ? msg.ids.length : 0} -> styles=${r && r.styles ? r.styles.length : 0} chars`);
    if (r && r.styles && r.styles.length) { try { await event.sender.insertCSS(r.styles, { cssOrigin: 'user' }); } catch (err) { console.log('  insertCSS failed:', err && err.message); } }
  });

  const html = '<!doctype html><html><head><title>probe</title></head><body><p id="content">content stays</p>'
    + classes.map((c, i) => `<div class="${c}" style="height:40px">AD-C${i}</div>`).join('')
    + ids.map((id, i) => `<div id="${id}" style="height:40px">AD-I${i}</div>`).join('')
    + '</body></html>';
  const server = http.createServer((_req, res) => { res.setHeader('content-type', 'text/html'); res.end(html); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const win = new BrowserWindow({ show: false, width: 800, height: 600, webPreferences: { partition: 'probe-cosmetics', sandbox: true, contextIsolation: true, nodeIntegration: false } });
  win.webContents.on('preload-error', (_e, p, err) => console.log('  preload-error:', p, err && err.message));
  await win.loadURL(`http://${HOST}:${server.address().port}/`);
  await new Promise((r) => setTimeout(r, 1500));
  const rows = JSON.parse(await win.webContents.executeJavaScript(
    'JSON.stringify([...document.body.children].map((e) => [e.tagName + (e.id ? "#" + e.id : "") + (e.className ? "." + e.className : ""), getComputedStyle(e).display]))',
  ));
  for (const [name, display] of rows) console.log(`  ${display === 'none' ? 'hidden ' : 'visible'}  ${name}`);
  const ads = rows.filter(([n]) => n !== 'P#content');
  const hidden = ads.filter(([, d]) => d === 'none').length;
  const contentRow = rows.find(([n]) => n === 'P#content');
  const contentOk = !!contentRow && contentRow[1] !== 'none';
  const ok = ads.length > 0 && hidden === ads.length && contentOk;
  console.log(`${ok ? 'OK' : 'FAIL'}: ${hidden}/${ads.length} generic-rule elements hidden, content ${contentOk ? 'kept' : 'HIDDEN'}, ${calls} ipc calls (engine: ${path.basename(ENGINE)})`);
  server.close();
  app.exit(ok ? 0 : 1);
}).catch((err) => { console.error('probe error:', err && err.stack || err); app.exit(2); });
