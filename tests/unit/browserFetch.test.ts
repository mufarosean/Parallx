// browserFetch.test.ts — reading a page with the browser engine, with a fake
// Electron: the gate on everything the page loads, the hidden in-memory
// window, the challenge wait, and what comes back. No window is ever opened.

import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const { createBrowserFetch, looksLikeChallenge } = require_('../../electron/browserFetch.cjs');
const policy = require_('../../electron/browserPolicy.cjs');

type Page = { status: number; title: string; html: string; url?: string };

/** A fake Electron whose window loads scripted pages: each loadURL serves the pages in turn, one per tick. */
function fakeElectron(pages: Page[], opts: { failLoad?: boolean } = {}) {
  const made: { win: FakeWindow; partition: string; webPreferences: Record<string, unknown> }[] = [];
  const sessions: FakeSession[] = [];
  class FakeSession {
    partition: string;
    gate: ((d: unknown, cb: (r: unknown) => void) => void) | null = null;
    ua = '';
    cleared = 0;
    constructor(p: string) { this.partition = p; }
    setUserAgent(ua: string) { this.ua = ua; }
    setPermissionRequestHandler() {}
    setPermissionCheckHandler() {}
    setDevicePermissionHandler() {}
    on() {}
    webRequest = { onBeforeRequest: (_f: unknown, fn: (d: unknown, cb: (r: unknown) => void) => void) => { this.gate = fn; } };
    async clearStorageData() { this.cleared++; }
    async clearCache() { this.cleared++; }
  }
  class FakeWindow {
    webContents: FakeContents;
    opts: Record<string, unknown>;
    destroyed = false;
    constructor(o: Record<string, unknown>) {
      this.opts = o;
      this.webContents = new FakeContents();
      made.push({ win: this, partition: String((o.webPreferences as Record<string, unknown>).partition), webPreferences: o.webPreferences as Record<string, unknown> });
    }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; }
  }
  class FakeContents extends EventEmitter {
    current: Page | null = null;
    setWindowOpenHandler() {}
    setAudioMuted() {}
    async loadURL(url: string) {
      let i = 0;
      const serve = () => {
        const p = pages[i++];
        if (!p) return;
        this.current = { ...p, url: p.url ?? url };
        if (opts.failLoad) { this.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', url, true); return; }
        this.emit('did-navigate', {}, this.current.url, p.status, '');
        this.emit('did-finish-load');
        if (pages[i]) setTimeout(serve, 15);
      };
      setTimeout(serve, 0);
    }
    async executeJavaScript() { return { html: this.current?.html ?? '', title: this.current?.title ?? '', url: this.current?.url ?? '' }; }
  }
  const electron = {
    BrowserWindow: FakeWindow,
    session: { fromPartition: (p: string) => { const s = new FakeSession(p); sessions.push(s); return s; } },
    app: { userAgentFallback: 'Mozilla/5.0 Electron/40 Chrome/134' },
  };
  return { electron, made, sessions };
}

const real: Page = { status: 200, title: 'Ada (character)', html: '<html><head><title>Ada (character)</title></head><body><p>Ada keeps a lighthouse.</p></body></html>' };
const wall: Page = { status: 403, title: 'Just a moment...', html: '<html><body><div id="cf-challenge">Checking your browser</div></body></html>' };
const okPreflight = async (url: string) => { if (/10\.0\.0\.1/.test(url)) throw Object.assign(new Error('private'), { code: 'PRIVATE_IP' }); return new URL(url); };

describe('looksLikeChallenge', () => {
  it('knows a bot wall by its title, its markers, or a short page under a refusing status', () => {
    expect(looksLikeChallenge({ status: 403, title: 'Just a moment...', html: '<html></html>' })).toBe(true);
    expect(looksLikeChallenge({ status: 200, title: 'Welcome', html: '<div class="cf-turnstile"></div>' })).toBe(true);
    expect(looksLikeChallenge({ status: 503, title: 'Site', html: '<p>Access denied</p>' })).toBe(true);
    expect(looksLikeChallenge({ status: 200, title: 'Ada', html: real.html })).toBe(false);
    expect(looksLikeChallenge({ status: 403, title: 'Members only', html: 'x'.repeat(30_000) })).toBe(false);
  });
});

describe('createBrowserFetch', () => {
  it('reads a page in a hidden, in-memory window and tears it down', async () => {
    const f = fakeElectron([real]);
    const fetcher = createBrowserFetch({ electron: f.electron, policy, preflight: okPreflight });
    const r = await fetcher.fetchPage({ url: 'https://wiki.example/wiki/Ada' });
    expect(r).toMatchObject({ status: 200, finalUrl: 'https://wiki.example/wiki/Ada', contentType: 'text/html', title: 'Ada (character)', via: 'browser' });
    expect(r.body).toContain('lighthouse');
    expect(f.made).toHaveLength(1);
    const { win, partition, webPreferences } = f.made[0];
    expect(win.opts.show).toBe(false);
    expect(partition.startsWith('persist:')).toBe(false);
    expect(webPreferences).toMatchObject({ sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false, images: false });
    expect(win.destroyed).toBe(true);
    expect(f.sessions[0].ua).toContain('Electron');
    await new Promise((r) => setTimeout(r, 0));
    expect(f.sessions[0].cleared).toBe(2);
  });

  it('waits a challenge out and returns the page it reloads into', async () => {
    const f = fakeElectron([wall, real]);
    const fetcher = createBrowserFetch({ electron: f.electron, policy, preflight: okPreflight, options: { challengeWaitMs: 500 } });
    const r = await fetcher.fetchPage({ url: 'https://wiki.example/wiki/Ada' });
    expect(r.status).toBe(200);
    expect(r.body).toContain('lighthouse');
  });

  it('a challenge that never clears is a failure that says so', async () => {
    const f = fakeElectron([wall]);
    const fetcher = createBrowserFetch({ electron: f.electron, policy, preflight: okPreflight, options: { challengeWaitMs: 10, challengeRounds: 1 } });
    await expect(fetcher.fetchPage({ url: 'https://wiki.example/wiki/Ada' })).rejects.toMatchObject({ code: 'BROWSER_CHALLENGE' });
    expect(f.made[0].win.destroyed).toBe(true);
  });

  it('a page that does not load, or a refused address, never opens a window for nothing', async () => {
    const f = fakeElectron([real], { failLoad: true });
    const fetcher = createBrowserFetch({ electron: f.electron, policy, preflight: okPreflight });
    await expect(fetcher.fetchPage({ url: 'https://gone.example/' })).rejects.toMatchObject({ code: 'BROWSER_LOAD_FAILED' });
    const g = fakeElectron([real]);
    const refused = createBrowserFetch({ electron: g.electron, policy, preflight: okPreflight });
    await expect(refused.fetchPage({ url: 'https://10.0.0.1/secret' })).rejects.toMatchObject({ code: 'PRIVATE_IP' });
    expect(g.made).toHaveLength(0);
  });

  it('gates everything the page loads: https only, nothing local, main frames re-run the preflight', async () => {
    const f = fakeElectron([real]);
    const fetcher = createBrowserFetch({ electron: f.electron, policy, preflight: okPreflight });
    const decide = (details: Record<string, unknown>) => new Promise<Record<string, unknown>>((resolve) => fetcher._gate(details, resolve));
    expect(await decide({ url: 'http://cdn.example/a.js', resourceType: 'script' })).toEqual({ cancel: true });
    expect(await decide({ url: 'https://192.168.1.1/img.png', resourceType: 'image' })).toEqual({ cancel: true });
    expect(await decide({ url: 'https://localhost/x', resourceType: 'xhr' })).toEqual({ cancel: true });
    expect(await decide({ url: 'https://cdn.example/a.js', resourceType: 'script' })).toEqual({});
    expect(await decide({ url: 'data:text/plain,hi', resourceType: 'image' })).toEqual({});
    expect(await decide({ url: 'https://10.0.0.1/', resourceType: 'mainFrame' })).toEqual({ cancel: true });
    expect(await decide({ url: 'https://wiki.example/next', resourceType: 'mainFrame' })).toEqual({});
    // The real session had the gate installed.
    await fetcher.fetchPage({ url: 'https://wiki.example/wiki/Ada' });
    expect(typeof f.sessions[0].gate).toBe('function');
  });
});
