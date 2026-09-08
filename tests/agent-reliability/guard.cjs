// Test-only entry wrapper, copied into the isolated code snapshot before launch.
// Installs confinement before the production Electron entry registers handlers.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { app, ipcMain, session } = require('electron');
// These tests exercise the runtime, not GPU rendering. Software rendering also
// avoids machine-specific GPU subprocess/DLL dependencies in hidden CI runs.
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('in-process-gpu');
const root = fs.realpathSync(process.env.PARALLX_RELIABILITY_RUN);
const workspace = fs.realpathSync(path.join(root, 'workspace'));
const code = fs.realpathSync(__dirname);
function inside(base, target) {
  const rel = path.relative(base, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}
function resolveTarget(target) {
  let probe = path.resolve(target);
  const tail = [];
  while (!fs.existsSync(probe)) { tail.unshift(path.basename(probe)); probe = path.dirname(probe); }
  return path.join(fs.realpathSync(probe), ...tail);
}
function check(target, read = false) {
  const resolved = resolveTarget(target);
  if (!inside(root, resolved) && !(read && inside(code, resolved))) {
    throw new Error(`Reliability confinement refused: ${target}`);
  }
}
if (!inside(root, resolveTarget(process.env.PARALLX_APP_ROOT)) ||
    !inside(root, resolveTarget(process.env.PARALLX_USER_DATA))) throw new Error('Unsafe app roots');
global.__reliability = { workspace: null, database: null, denied: [], writes: [] };
const nativeHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, handler) => nativeHandle(channel, async (event, ...args) => {
  try {
    if (channel.startsWith('database:') && JSON.stringify(args).includes('chat_')) {
      fs.appendFileSync(path.join(root, 'evidence', 'database-calls.jsonl'), JSON.stringify({ channel, args, at: Date.now() }) + '\n');
    }
    if (channel === 'fs:setWorkspaceRoot' || channel === 'database:open') {
      if (path.resolve(args[0] ?? '') !== workspace) throw new Error(`Wrong workspace: ${args[0]}`);
    }
    if (channel === 'fs:registerExtraRoots' && args[0]?.length) throw new Error('Extra roots forbidden');
    if (channel === 'terminal:spawn') return { id: null, error: { code: 'TEST_SCOPE', message: 'Terminal excluded from reliability fixture' } };
    if (/^(terminal:(exec|execStream:start)|python:|mcp:connect|shell:(openPath|openExternal|showItemInFolder|startDrag))/.test(channel)) {
      throw new Error(`Out-of-scope capability: ${channel}`);
    }
    if (/^(storage:(read-json|write-json|exists)|fs:(readFile|writeFile|stat|readdir|exists|hashFile|rename|delete|mkdir|copy|watch))$/.test(channel)) {
      const read = /read|stat|exists|hash|watch/.test(channel);
      check(args[0], read);
      if (channel === 'fs:rename' || channel === 'fs:copy') check(args[1]);
    }
    const result = await handler(event, ...args);
    if (channel === 'fs:setWorkspaceRoot') global.__reliability.workspace = args[0];
    if (channel === 'database:open' && !result?.error) global.__reliability.database = result.dbPath;
    if (channel === 'fs:writeFile' && !result?.error) {
      const write = { path: path.relative(workspace, args[0]), at: Date.now() };
      global.__reliability.writes.push(write);
      fs.appendFileSync(path.join(root, 'evidence', 'effects.jsonl'), JSON.stringify(write) + '\n');
      if (process.env.PARALLX_RELIABILITY_CRASH_WRITE === write.path) {
        // The file is real; the tool completion has not yet reached the renderer.
        await new Promise(() => {});
      }
    }
    return result;
  } catch (error) {
    global.__reliability.denied.push({ channel, message: error.message });
    throw error;
  }
});
function allowedUrl(raw) {
  try {
    const url = new URL(typeof raw === 'string' ? raw : raw.url ?? raw.href);
    if (['file:', 'data:', 'blob:', 'devtools:'].includes(url.protocol)) return true;
    return ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  } catch { return false; }
}
// No external browser traffic, including startup resources and new sessions.
app.on('session-created', (ses) => ses.webRequest.onBeforeRequest((details, done) => done({ cancel: !allowedUrl(details.url) })));
app.whenReady().then(() => session.defaultSession.webRequest.onBeforeRequest((details, done) => done({ cancel: !allowedUrl(details.url) })));
const nativeFetch = global.fetch;
global.fetch = (...args) => {
  if (!allowedUrl(args[0])) return Promise.reject(new Error('Reliability external network denied'));
  return nativeFetch(...args);
};
require('./electron/main.cjs');
