// browserDebugger.cjs — the one owner of a page view's devtools-protocol link.
//
// A Browser page view (electron/browserBridge.cjs) is driven through its
// webContents.debugger by three features: ad-blocking scriptlets injected at
// document start, the page-theme emulation, and AI automation
// (electron/browserAutomationBroker.cjs). They share one controller per view so
// none of them detaches another, and so the state each one registered is put
// back after the link drops (Electron detaches the debugger when DevTools opens
// on the page; it can be reattached once DevTools closes).
//
// Every command is time-boxed. A command that never answers (the screenshot
// command waits forever for a frame a hidden window never paints) rejects with
// CDP_TIMEOUT instead of blocking whoever awaits it.
'use strict';

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * An Error with a code. `extra` (optional) is merged into the outcome the
 * broker builds from it: page-derived detail kept out of the message.
 */
function codeError(code, message, extra) {
  const err = new Error(message || code);
  err.code = code;
  if (extra) err.extra = extra;
  return err;
}

function createDebuggerController(wc) {
  const dbg = wc.debugger;
  const messageListeners = new Set();
  const detachListeners = new Set();
  // What must be true again after a reattach.
  const state = {
    domains: new Set(['Page']),
    scriptSource: '',
    scriptId: null,
    mediaFeatures: null,
    autoAttach: false,
    interceptFileChooser: false,
  };
  let restoring = null;

  const onMessage = (_event, method, params, sessionId) => {
    for (const fn of [...messageListeners]) { try { fn(method, params || {}, sessionId); } catch { /* a listener's problem */ } }
  };
  const onDetach = (_event, reason) => {
    state.scriptId = null;
    for (const fn of [...detachListeners]) { try { fn(String(reason || 'detached')); } catch { /* ignore */ } }
  };
  const onDevtoolsClosed = () => { void ensure().catch(() => { /* retried on next use */ }); };
  dbg.on('message', onMessage);
  dbg.on('detach', onDetach);
  wc.on('devtools-closed', onDevtoolsClosed);

  function raw(method, params, sessionId, timeoutMs) {
    if (wc.isDestroyed()) return Promise.reject(codeError('PAGE_GONE', 'The page is gone.'));
    const ms = timeoutMs || DEFAULT_TIMEOUT_MS;
    let timer = null;
    const call = sessionId ? dbg.sendCommand(method, params || {}, sessionId) : dbg.sendCommand(method, params || {});
    return Promise.race([
      call,
      new Promise((_, reject) => { timer = setTimeout(() => reject(codeError('CDP_TIMEOUT', `${method} did not answer within ${ms} ms`)), ms); }),
    ]).finally(() => clearTimeout(timer));
  }

  /** Attach if needed and restore registered state. Throws DEBUGGER_BUSY while DevTools owns the page. */
  function ensure() {
    if (wc.isDestroyed()) return Promise.reject(codeError('PAGE_GONE', 'The page is gone.'));
    if (dbg.isAttached() && !restoring) return Promise.resolve();
    if (restoring) return restoring;
    if (wc.isDevToolsOpened()) return Promise.reject(codeError('DEBUGGER_BUSY', 'DevTools is open on this page.'));
    restoring = (async () => {
      try { dbg.attach('1.3'); } catch (err) {
        if (!dbg.isAttached()) throw codeError('DEBUGGER_BUSY', err && err.message ? err.message : String(err));
      }
      for (const domain of state.domains) await raw(`${domain}.enable`).catch(() => { /* a domain the page no longer offers */ });
      if (state.scriptSource) {
        const r = await raw('Page.addScriptToEvaluateOnNewDocument', { source: state.scriptSource }).catch(() => null);
        state.scriptId = r && r.identifier ? r.identifier : null;
      }
      if (state.mediaFeatures) await raw('Emulation.setEmulatedMedia', { features: state.mediaFeatures }).catch(() => {});
      if (state.autoAttach) await raw('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }).catch(() => {});
      if (state.interceptFileChooser) await raw('Page.setInterceptFileChooserDialog', { enabled: true }).catch(() => {});
    })().finally(() => { restoring = null; });
    return restoring;
  }

  async function send(method, params, sessionId, timeoutMs) {
    await ensure();
    return raw(method, params, sessionId, timeoutMs);
  }

  async function enable(domain) {
    state.domains.add(domain);
    await send(`${domain}.enable`);
  }

  /** The ad-blocking scriptlet source for the next documents ('' for none). */
  async function setScriptlet(source) {
    const next = source || '';
    if (next === state.scriptSource && (state.scriptId || !next)) return;
    state.scriptSource = next;
    await ensure();
    if (state.scriptId) { await raw('Page.removeScriptToEvaluateOnNewDocument', { identifier: state.scriptId }).catch(() => {}); state.scriptId = null; }
    if (next) { const r = await raw('Page.addScriptToEvaluateOnNewDocument', { source: next }); state.scriptId = r && r.identifier ? r.identifier : null; }
  }

  /** prefers-color-scheme emulation for the page theme ([] for none). */
  async function setEmulatedMedia(features) {
    state.mediaFeatures = Array.isArray(features) && features.length ? features : null;
    await send('Emulation.setEmulatedMedia', { features: state.mediaFeatures || [] });
  }

  /** Attach to out-of-process frames (flattened sessions) so their trees and nodes are reachable. */
  async function setAutoAttach(on) {
    state.autoAttach = !!on;
    await send('Target.setAutoAttach', { autoAttach: !!on, waitForDebuggerOnStart: false, flatten: true });
  }

  /**
   * Hold the page's file chooser for the protocol client instead of showing
   * the native Open dialog (Page.fileChooserOpened reports it). The top
   * frame's session only: out-of-process frames are asked on their own.
   */
  async function setInterceptFileChooser(on) {
    state.interceptFileChooser = !!on;
    await send('Page.setInterceptFileChooserDialog', { enabled: !!on });
  }

  function onEvent(fn) { messageListeners.add(fn); return () => messageListeners.delete(fn); }
  function onDetached(fn) { detachListeners.add(fn); return () => detachListeners.delete(fn); }

  function dispose() {
    messageListeners.clear();
    detachListeners.clear();
    try { dbg.removeListener('message', onMessage); dbg.removeListener('detach', onDetach); } catch { /* gone */ }
    try { wc.removeListener('devtools-closed', onDevtoolsClosed); } catch { /* gone */ }
  }

  return {
    ensure, send, enable, setScriptlet, setEmulatedMedia, setAutoAttach, setInterceptFileChooser, onEvent, onDetached, dispose,
    get attached() { try { return dbg.isAttached(); } catch { return false; } },
  };
}

module.exports = { createDebuggerController, codeError, DEFAULT_TIMEOUT_MS };
