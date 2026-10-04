// optionalBridgesLazy.test.ts — the main-process bridges that exist for one
// optional tool (Web Research, Planner, Worksheets, Atelier, Flashcards) load
// nothing and start nothing at app start. Their channels are registered; the
// bridge module is required on the tool's first call (CLAUDE.md, "the app is
// only what the user turned on"; docs/MODULARITY_AUDIT_2026-10-04.md #22-#26).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = resolve(__dirname, '../..');
const E = (name: string) => require.resolve(`../../electron/${name}`);

const BRIDGE_MODULES = [
  'webFetchBridge.cjs', 'googleSyncBridge.cjs', 'imageBridge.cjs', 'modelBridge.cjs',
  'ankiBridge.cjs', 'screenRecorderBridge.cjs',
];

function loadedModules(): string[] {
  return Object.keys(require.cache);
}
function isLoaded(name: string): boolean {
  return loadedModules().includes(E(name));
}
function forgetModules(): void {
  for (const n of [...BRIDGE_MODULES, 'optionalBridges.cjs', 'workspaceSeal.cjs']) delete require.cache[E(n)];
  for (const k of loadedModules()) if (k.includes('onnxruntime')) delete require.cache[k];
}

type Handler = (event: unknown, ...args: unknown[]) => unknown;
function fakeIpc() {
  const handlers = new Map<string, Handler>();
  return {
    handlers,
    ipc: { handle: (ch: string, fn: Handler) => { if (handlers.has(ch)) throw new Error(`twice: ${ch}`); handlers.set(ch, fn); } },
    // Like ipcMain: a handler that throws rejects the invoke.
    call: (ch: string, ...args: unknown[]) => new Promise((res) => res(handlers.get(ch)!({}, ...args))),
  };
}

function deps(over: Record<string, unknown> = {}) {
  const secrets = new Map<string, string>();
  return {
    appRoot: mkdtempSync(join(tmpdir(), 'px-optional-')),
    app: {},
    getMainWindow: () => null,
    secrets: {
      readSecret: async (k: string) => secrets.get(k) ?? null,
      writeSecret: async (k: string, v: string) => { secrets.set(k, v); },
      deleteSecret: async (k: string) => { secrets.delete(k); },
    },
    isSealed: () => false,
    getWorkspaceRoot: () => null,
    isAllowedWritePath: () => false,
    boundsOnScreen: () => true,
    ...over,
  };
}

describe('optional tool bridges at app start', () => {
  beforeEach(() => { forgetModules(); vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('registers every channel but loads no bridge, no native runtime, and starts no timer', () => {
    const { setupOptionalBridges, OPTIONAL_BRIDGE_CHANNELS } = require('../../electron/optionalBridges.cjs');
    const { ipc, handlers } = fakeIpc();
    const bridges = setupOptionalBridges(ipc, deps());
    const all = Object.values(OPTIONAL_BRIDGE_CHANNELS as Record<string, string[]>).flat();
    expect([...handlers.keys()].sort()).toEqual([...all].sort());
    for (const m of BRIDGE_MODULES) expect(isLoaded(m), m).toBe(false);
    expect(loadedModules().some((k) => k.includes('onnxruntime'))).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    for (const b of Object.values(bridges as Record<string, { isLoaded(): boolean }>)) expect(b.isLoaded()).toBe(false);
  });

  it('loads a bridge on its tool\'s first call, once, and forwards the call', async () => {
    const { setupOptionalBridges } = require('../../electron/optionalBridges.cjs');
    const { ipc, call } = fakeIpc();
    const bridges = setupOptionalBridges(ipc, deps({ isSealed: () => true }));
    const r = await call('webFetch:request', { url: 'https://example.com' });
    expect(r).toMatchObject({ ok: false, error: { code: 'SEALED' } });
    expect(isLoaded('webFetchBridge.cjs')).toBe(true);
    expect(bridges.webFetch.isLoaded()).toBe(true);
    // The others are still not loaded.
    for (const m of BRIDGE_MODULES.filter((n) => n !== 'webFetchBridge.cjs')) expect(isLoaded(m), m).toBe(false);
    expect(await call('webFetch:resetTurn', 't1')).toEqual({ ok: true });

    expect(await call('google:status')).toMatchObject({ connected: false, email: null });
    expect(isLoaded('googleSyncBridge.cjs')).toBe(true);

    expect(await call('anki:read', join(tmpdir(), 'no-such-deck.apkg-missing'))).toMatchObject({ ok: false });
    expect(isLoaded('ankiBridge.cjs')).toBe(true);
  });

  it('the model bridge runs nothing until asked to, and never loads onnxruntime itself', async () => {
    const { setupOptionalBridges } = require('../../electron/optionalBridges.cjs');
    const { ipc, call } = fakeIpc();
    setupOptionalBridges(ipc, deps());
    const r = await call('models:status', { sha256: 'nope', bytes: 1 });
    expect(r).toMatchObject({ ok: false });
    expect(isLoaded('modelBridge.cjs')).toBe(true);
    expect(loadedModules().some((k) => k.includes('onnxruntime'))).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('answers "is anything recording?" without loading the recorder', async () => {
    const { setupOptionalBridges } = require('../../electron/optionalBridges.cjs');
    const { ipc, call } = fakeIpc();
    const bridges = setupOptionalBridges(ipc, deps());
    expect(await call('recorder:anyActive')).toEqual({ active: false });
    expect(isLoaded('screenRecorderBridge.cjs')).toBe(false);
    expect(bridges.recorder.peek()).toBeUndefined();
    // A call that needs the recorder loads it; with no frame open it is a no-op.
    expect(await call('recorder:pause', 'rec-1')).toEqual({ error: null, paused: false });
    expect(isLoaded('screenRecorderBridge.cjs')).toBe(true);
    expect(await call('recorder:anyActive')).toEqual({ active: false });
    expect(bridges.recorder.peek().anyActive()).toBe(false);
  });

  it('a bridge that fails to load fails the call and is tried again on the next', async () => {
    const { registerLazyBridge } = require('../../electron/optionalBridges.cjs');
    const { ipc, call } = fakeIpc();
    let attempts = 0;
    const b = registerLazyBridge(ipc, {
      name: 't', channels: ['t:go'],
      setup: (inner: { handle(c: string, f: Handler): void }) => {
        attempts++;
        if (attempts === 1) throw new Error('not yet');
        inner.handle('t:go', (_e, x) => `went ${x}`);
        return { tag: 1 };
      },
    });
    await expect(call('t:go', 1)).rejects.toThrow('not yet');
    expect(b.isLoaded()).toBe(false);
    expect(await call('t:go', 2)).toBe('went 2');
    expect(await call('t:go', 3)).toBe('went 3');
    expect(attempts).toBe(2);
    expect(b.peek()).toEqual({ tag: 1 });
  });
});

describe('the channel lists match what each bridge registers', () => {
  function channelsOf(setup: (ipc: { handle(c: string): void }) => void): string[] {
    const seen: string[] = [];
    setup({ handle: (c: string) => { seen.push(c); } });
    return seen.sort();
  }
  const { OPTIONAL_BRIDGE_CHANNELS: C } = require('../../electron/optionalBridges.cjs');
  const d = deps();
  const sorted = (a: string[]) => [...a].sort();

  it('webFetch', () => {
    expect(channelsOf((ipc) => require('../../electron/webFetchBridge.cjs').setupWebFetchBridge(ipc, d.appRoot, d.secrets.readSecret))).toEqual(sorted(C.webFetch));
  });
  it('google', () => {
    expect(channelsOf((ipc) => require('../../electron/googleSyncBridge.cjs').setupGoogleSyncBridge(ipc, d.appRoot, d.secrets))).toEqual(sorted(C.google));
  });
  it('images', () => {
    expect(channelsOf((ipc) => require('../../electron/imageBridge.cjs').setupImageBridge(ipc, d.app))).toEqual(sorted(C.images));
  });
  it('models', () => {
    expect(channelsOf((ipc) => require('../../electron/modelBridge.cjs').setupModelBridge(ipc, d))).toEqual(sorted(C.models));
  });
  it('recorder', () => {
    expect(channelsOf((ipc) => require('../../electron/screenRecorderBridge.cjs').setupScreenRecorderBridge(ipc, d))).toEqual(sorted(C.recorder));
  });
});

describe('the workspace seal is core, not a tool\'s', () => {
  beforeEach(() => forgetModules());

  it('holds with Web Research never loaded, and the bridges read it', async () => {
    const seal = require('../../electron/workspaceSeal.cjs');
    const { ipc, call } = fakeIpc();
    seal.setupWorkspaceSeal(ipc);
    expect(await call('workspace:setSealed', true)).toEqual({ ok: true, sealed: true });
    expect(seal.isSealed()).toBe(true);
    expect(isLoaded('webFetchBridge.cjs')).toBe(false);
    // The fetch bridge, set up without its own flag, refuses while sealed.
    const web = fakeIpc();
    require('../../electron/webFetchBridge.cjs').setupWebFetchBridge(web.ipc, '', async () => 'key');
    expect(await web.call('webSearch:request', { query: 'x' })).toMatchObject({ ok: false, error: { code: 'SEALED' } });
    await call('workspace:setSealed', false);
    expect(seal.isSealed()).toBe(false);
  });
});

describe('main.cjs does not load a tool\'s bridge at start', () => {
  const main = readFileSync(join(ROOT, 'electron/main.cjs'), 'utf8');

  it('requires none of the optional bridges itself', () => {
    for (const m of BRIDGE_MODULES) expect(main.includes(`require('./${m}')`), m).toBe(false);
    expect(main).toContain("require('./optionalBridges.cjs')");
  });
  it('keeps no recorder, anki, image or model handler of its own', () => {
    expect(main).not.toMatch(/ipcMain\.handle\('(recorder|anki|image|models|google|webSearch):/);
    expect(main).not.toMatch(/ipcMain\.handle\('webFetch:(request|resetTurn)'/);
  });
});

describe('the preload names no optional tool\'s channel (audit #22)', () => {
  const PRELOAD = E('preload.cjs');
  const ELECTRON = require.resolve('electron');

  /** Load preload.cjs against a fake electron; return what it exposes and the invokes it made. */
  function loadPreload() {
    const invoked: { channel: string; args: unknown[] }[] = [];
    let exposed: Record<string, any> = {};
    const fake = {
      contextBridge: { exposeInMainWorld: (_k: string, api: Record<string, any>) => { exposed = api; } },
      ipcRenderer: {
        invoke: (channel: string, ...args: unknown[]) => { invoked.push({ channel, args }); return Promise.resolve({ ok: true }); },
        send: () => {}, on: () => {}, once: () => {}, removeListener: () => {}, removeAllListeners: () => {},
      },
      clipboard: {}, webUtils: {}, webFrame: { setZoomFactor: () => {}, getZoomFactor: () => 1 },
    };
    const saved = require.cache[ELECTRON];
    require.cache[ELECTRON] = { id: ELECTRON, filename: ELECTRON, loaded: true, exports: fake } as any;
    delete require.cache[PRELOAD];
    try { require(PRELOAD); } finally {
      if (saved) require.cache[ELECTRON] = saved; else delete require.cache[ELECTRON];
      delete require.cache[PRELOAD];
    }
    return { exposed, invoked };
  }

  it('has no Web Research names or channels in its source', () => {
    const src = readFileSync(PRELOAD, 'utf8');
    expect(src).not.toMatch(/webFetch|webSearch|Web Research/);
  });

  it('lets a tool invoke exactly the channels optionalBridges.cjs registers', async () => {
    const { OPTIONAL_BRIDGE_CHANNELS } = require('../../electron/optionalBridges.cjs');
    const { exposed, invoked } = loadPreload();
    const all = Object.values(OPTIONAL_BRIDGE_CHANNELS as Record<string, string[]>).flat();
    for (const ch of all) await exposed.optionalBridges.invoke(ch, { a: 1 });
    expect(invoked.map((i) => i.channel)).toEqual(all);
    expect(invoked[0].args).toEqual([{ a: 1 }]);
  });

  it('refuses any other channel before it reaches IPC', async () => {
    const { exposed, invoked } = loadPreload();
    for (const ch of ['fs:writeFile', 'workspace:setSealed', 'webFetch:request ', '', 'toString', '__proto__']) {
      await expect(exposed.optionalBridges.invoke(ch)).rejects.toThrow(/not allowed/);
    }
    await expect(exposed.optionalBridges.invoke(undefined)).rejects.toThrow(/not allowed/);
    await expect(exposed.optionalBridges.invoke({ toString: () => 'webFetch:request' })).rejects.toThrow(/not allowed/);
    expect(invoked).toEqual([]);
  });

  it('keeps the core workspace seal on its own core channel', async () => {
    const { exposed, invoked } = loadPreload();
    await exposed.workspaceSeal.setSealed(true);
    expect(invoked).toEqual([{ channel: 'workspace:setSealed', args: [true] }]);
  });
});

describe('hash pool (fs:hashFile)', () => {
  it('starts no worker until asked, and stops its workers once idle', async () => {
    const { createHashPool } = require('../../electron/hashPool.cjs');
    const pool = createHashPool({ size: 2, idleMs: 40 });
    expect(pool.workerCount()).toBe(0);
    const dir = mkdtempSync(join(tmpdir(), 'px-hash-'));
    const file = join(dir, 'a.bin');
    writeFileSync(file, 'hello world');
    const r = await pool.run(file, false);
    expect(r.md5).toBe('5eb63bbbe01eeed093cb22bb8f5acdc3');
    expect(pool.workerCount()).toBe(1);
    const until = Date.now() + 3000;
    while (pool.workerCount() > 0 && Date.now() < until) await new Promise((res) => setTimeout(res, 20));
    expect(pool.workerCount()).toBe(0);
    // And it starts again on the next job.
    expect((await pool.run(file, false)).md5).toBe('5eb63bbbe01eeed093cb22bb8f5acdc3');
    pool.dispose();
    expect(pool.workerCount()).toBe(0);
  });
});
