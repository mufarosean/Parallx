// optionalBridges.cjs — main-process bridges that exist for one optional tool.
//
// The app is only what the user turned on (CLAUDE.md): nothing may load or
// run at app start for a tool that may be off. Each bridge here belongs to
// one tool. Its IPC channels are registered at start (a name and a small
// function, nothing more), but the bridge module itself, and anything it
// pulls in, is required only on the tool's first call. A user who never turns
// the tool on never loads it. Work a bridge starts (a worker, a download, a
// capture) starts on a call from its tool, and stops on the tool's own calls
// or when it goes idle, as before.
//
// Adding a bridge: list every channel its setup registers; the test
// tests/unit/optionalBridgesLazy.test.ts checks the lists against the real
// bridges.

/**
 * Register `channels` now; run `setup(ipc)` (which registers the real
 * handlers into `ipc`) on the first call to any of them, then forward.
 *
 * @param {{ handle(channel: string, fn: Function): void }} ipcMain
 * @param {{
 *   name: string,
 *   channels: string[],
 *   setup: (ipc: { handle(channel: string, fn: Function): void, removeHandler(channel: string): void }) => any,
 *   whileUnloaded?: Record<string, (...args: any[]) => any>,
 * }} spec  `whileUnloaded` answers a channel without loading the bridge
 *          (e.g. "is anything recording?" is "no" before the bridge exists).
 * @returns {{ isLoaded(): boolean, load(): any, peek(): any }}  load() loads
 *          and returns what setup returned; peek() returns it only if loaded.
 */
function registerLazyBridge(ipcMain, spec) {
  const { name, channels, setup, whileUnloaded = {} } = spec;
  /** @type {Map<string, Function> | null} */
  let handlers = null;
  let result;
  const ensure = () => {
    if (handlers) return handlers;
    const captured = new Map();
    result = setup({
      handle: (channel, fn) => { captured.set(channel, fn); },
      removeHandler: (channel) => { captured.delete(channel); },
    });
    handlers = captured;
    return handlers;
  };
  for (const channel of channels) {
    ipcMain.handle(channel, (event, ...args) => {
      if (!handlers && Object.prototype.hasOwnProperty.call(whileUnloaded, channel)) {
        return whileUnloaded[channel](event, ...args);
      }
      const fn = ensure().get(channel);
      if (!fn) throw new Error(`[${name}] the bridge has no handler for ${channel}`);
      return fn(event, ...args);
    });
  }
  return {
    isLoaded: () => handlers !== null,
    load: () => { ensure(); return result; },
    peek: () => (handlers ? result : undefined),
  };
}

/** Every optional bridge's channels, by bridge. */
const OPTIONAL_BRIDGE_CHANNELS = Object.freeze({
  // Web Research (ext/web-research): electron/webFetchBridge.cjs
  webFetch: ['webFetch:request', 'webSearch:request', 'webFetch:resetTurn'],
  // Planner: electron/googleSyncBridge.cjs
  google: ['google:authorize', 'google:status', 'google:disconnect', 'google:fetch'],
  // Worksheets: electron/imageBridge.cjs
  images: ['image:rasterizeMetafile', 'image:renderEquations'],
  // Atelier (ext/media-organizer): electron/modelBridge.cjs (onnxruntime in its worker)
  models: ['models:status', 'models:download', 'models:cancelDownload', 'models:run'],
  // Flashcards (ext/flashcards): electron/ankiBridge.cjs
  anki: ['anki:read'],
  // Atelier: electron/screenRecorderBridge.cjs
  recorder: [
    'recorder:anyActive', 'recorder:openFrame', 'recorder:setBounds', 'recorder:pause', 'recorder:resume',
    'recorder:setIgnoreMouse', 'recorder:start', 'recorder:sendAudio', 'recorder:stop', 'recorder:cancel',
  ],
});

/** Events those bridges send to the main window; a tool listens through optionalBridges.on. */
const OPTIONAL_BRIDGE_EVENTS = Object.freeze([
  'models:progress', // Atelier: model download progress (modelBridge.cjs)
  'recorder:complete', // Atelier: a recording finished or was cancelled (screenRecorderBridge.cjs)
]);

/**
 * Register every optional bridge, loading none of them.
 *
 * @param {{ handle(channel: string, fn: Function): void }} ipcMain
 * @param {{
 *   appRoot: string,
 *   app: any,
 *   getMainWindow: () => any,
 *   secrets: { readSecret: Function, writeSecret: Function, deleteSecret: Function },
 *   isSealed: () => boolean,
 *   getWorkspaceRoot: () => string | null,
 *   isAllowedWritePath: (p: string) => boolean,
 *   boundsOnScreen: (b: any) => boolean,
 * }} deps
 */
function setupOptionalBridges(ipcMain, deps) {
  const C = OPTIONAL_BRIDGE_CHANNELS;
  return {
    webFetch: registerLazyBridge(ipcMain, {
      name: 'webFetch',
      channels: C.webFetch,
      setup: (ipc) => require('./webFetchBridge.cjs').setupWebFetchBridge(ipc, deps.appRoot, deps.secrets.readSecret, { isSealed: deps.isSealed }),
    }),
    google: registerLazyBridge(ipcMain, {
      name: 'google',
      channels: C.google,
      setup: (ipc) => require('./googleSyncBridge.cjs').setupGoogleSyncBridge(ipc, deps.appRoot, deps.secrets),
    }),
    images: registerLazyBridge(ipcMain, {
      name: 'images',
      channels: C.images,
      setup: (ipc) => require('./imageBridge.cjs').setupImageBridge(ipc, deps.app),
    }),
    models: registerLazyBridge(ipcMain, {
      name: 'models',
      channels: C.models,
      setup: (ipc) => require('./modelBridge.cjs').setupModelBridge(ipc, { appRoot: deps.appRoot, getMainWindow: deps.getMainWindow, isSealed: deps.isSealed }),
    }),
    anki: registerLazyBridge(ipcMain, {
      name: 'anki',
      channels: C.anki,
      setup: (ipc) => {
        // Parsing happens in a worker_thread (ankiWorker.cjs): the .apkg path
        // opens a SQLite database with better-sqlite3, which is synchronous
        // and must never run on this process.
        const { readAnkiExport } = require('./ankiBridge.cjs');
        ipc.handle('anki:read', async (_event, filePath) => {
          try {
            return await readAnkiExport(filePath);
          } catch (err) {
            return { ok: false, error: (err && err.message) || String(err) };
          }
        });
      },
    }),
    recorder: registerLazyBridge(ipcMain, {
      name: 'recorder',
      channels: C.recorder,
      // The tool asks this at start to heal a stale "recording" flag; no
      // frame can be open before the bridge exists.
      whileUnloaded: { 'recorder:anyActive': () => ({ active: false }) },
      setup: (ipc) => require('./screenRecorderBridge.cjs').setupScreenRecorderBridge(ipc, {
        appRoot: deps.appRoot,
        getMainWindow: deps.getMainWindow,
        getWorkspaceRoot: deps.getWorkspaceRoot,
        isAllowedWritePath: deps.isAllowedWritePath,
        boundsOnScreen: deps.boundsOnScreen,
      }),
    }),
  };
}

module.exports = { registerLazyBridge, setupOptionalBridges, OPTIONAL_BRIDGE_CHANNELS, OPTIONAL_BRIDGE_EVENTS };
