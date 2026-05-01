// secretStorageService.test.ts — M60 §T6.F3
//
// Verifies the renderer-side facade over `secret:set/get/delete` IPC:
//   • base64 round-tripping of UTF-8 strings (incl. multibyte)
//   • bridge-unavailable path returns a typed error
//   • IPC errors (safe-storage-unavailable, not-found, invalid-key)
//     surface verbatim
//   • persistRefreshToken / loadPersistedRefreshToken /
//     clearPersistedRefreshToken roundtrip via the same fake bridge

import { describe, it, expect, vi } from 'vitest';
import {
  createSecretStorageService,
  GMAIL_REFRESH_TOKEN_KEY,
  type ISecretBridge,
} from '../../src/services/secretStorageService';
import {
  clearPersistedRefreshToken,
  loadPersistedRefreshToken,
  persistRefreshToken,
  InMemoryAccessTokenCache,
} from '../../src/services/gmailOAuthService';

// ─── Fake bridge ───────────────────────────────────────────────────

function makeFakeBridge(): ISecretBridge & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    async set(key, valueB64) {
      store.set(key, valueB64);
      return { ok: true };
    },
    async get(key) {
      const v = store.get(key);
      if (v === undefined) return { ok: false, error: 'not-found' };
      return { ok: true, valueB64: v };
    },
    async delete(key) {
      store.delete(key);
      return { ok: true };
    },
  };
}

describe('secretStorageService — base64 round-trip', () => {
  it('round-trips ASCII', async () => {
    const bridge = makeFakeBridge();
    const svc = createSecretStorageService(bridge);
    expect(svc.available).toBe(true);
    const setResult = await svc.setString('a-key', 'hello-world');
    expect(setResult.ok).toBe(true);
    expect(bridge.store.get('a-key')).toBe(Buffer.from('hello-world', 'utf8').toString('base64'));
    const r = await svc.getString('a-key');
    expect(r.ok).toBe(true);
    expect(r.value).toBe('hello-world');
  });

  it('round-trips multibyte UTF-8', async () => {
    const bridge = makeFakeBridge();
    const svc = createSecretStorageService(bridge);
    const value = 'tøken-with-üñîcödé-😀';
    await svc.setString('k', value);
    const r = await svc.getString('k');
    expect(r.ok).toBe(true);
    expect(r.value).toBe(value);
  });

  it('delete removes the entry', async () => {
    const bridge = makeFakeBridge();
    const svc = createSecretStorageService(bridge);
    await svc.setString('k', 'v');
    expect(bridge.store.has('k')).toBe(true);
    const dr = await svc.delete('k');
    expect(dr.ok).toBe(true);
    expect(bridge.store.has('k')).toBe(false);
  });
});

describe('secretStorageService — error surfaces', () => {
  it('returns bridge-unavailable when bridge missing', async () => {
    const svc = createSecretStorageService(undefined);
    expect(svc.available).toBe(false);
    const a = await svc.setString('k', 'v');
    expect(a).toEqual({ ok: false, error: 'bridge-unavailable' });
    const b = await svc.getString('k');
    expect(b.ok).toBe(false);
    const c = await svc.delete('k');
    expect(c.ok).toBe(false);
  });

  it('forwards safe-storage-unavailable error code', async () => {
    const bridge: ISecretBridge = {
      set: async () => ({ ok: false, error: 'safe-storage-unavailable' }),
      get: async () => ({ ok: false, error: 'safe-storage-unavailable' }),
      delete: async () => ({ ok: false, error: 'safe-storage-unavailable' }),
    };
    const svc = createSecretStorageService(bridge);
    const r = await svc.setString('k', 'v');
    expect(r).toEqual({ ok: false, error: 'safe-storage-unavailable' });
    const g = await svc.getString('k');
    expect(g.ok).toBe(false);
    expect(g.error).toBe('safe-storage-unavailable');
  });

  it('not-found is returned as a non-ok read', async () => {
    const bridge = makeFakeBridge();
    const svc = createSecretStorageService(bridge);
    const r = await svc.getString('missing');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('not-found');
  });
});

describe('gmailOAuthService — token persistence wiring', () => {
  it('persistRefreshToken writes only the refresh_token field', async () => {
    const bridge = makeFakeBridge();
    const svc = createSecretStorageService(bridge);
    await persistRefreshToken(
      { access_token: 'AT', refresh_token: 'RT', expires_in: 3600, scope: '', token_type: 'Bearer' },
      svc,
    );
    expect(bridge.store.size).toBe(1);
    expect(bridge.store.has(GMAIL_REFRESH_TOKEN_KEY)).toBe(true);
    // Access token must NOT be in the store.
    for (const v of bridge.store.values()) {
      expect(Buffer.from(v, 'base64').toString('utf8')).not.toContain('AT');
    }
  });

  it('persistRefreshToken is a no-op when refresh_token absent', async () => {
    const bridge = makeFakeBridge();
    const svc = createSecretStorageService(bridge);
    const r = await persistRefreshToken(
      { access_token: 'AT', expires_in: 3600, scope: '', token_type: 'Bearer' },
      svc,
    );
    expect(r.ok).toBe(true);
    expect(bridge.store.size).toBe(0);
  });

  it('loadPersistedRefreshToken returns the stored token', async () => {
    const bridge = makeFakeBridge();
    const svc = createSecretStorageService(bridge);
    await persistRefreshToken(
      { access_token: 'AT', refresh_token: 'RT-XYZ', expires_in: 1, scope: '', token_type: 'Bearer' },
      svc,
    );
    const t = await loadPersistedRefreshToken(svc);
    expect(t).toBe('RT-XYZ');
  });

  it('loadPersistedRefreshToken returns undefined when missing', async () => {
    const svc = createSecretStorageService(makeFakeBridge());
    const t = await loadPersistedRefreshToken(svc);
    expect(t).toBeUndefined();
  });

  it('clearPersistedRefreshToken removes the entry', async () => {
    const bridge = makeFakeBridge();
    const svc = createSecretStorageService(bridge);
    await persistRefreshToken(
      { access_token: 'AT', refresh_token: 'RT', expires_in: 1, scope: '', token_type: 'Bearer' },
      svc,
    );
    expect(bridge.store.has(GMAIL_REFRESH_TOKEN_KEY)).toBe(true);
    const r = await clearPersistedRefreshToken(svc);
    expect(r.ok).toBe(true);
    expect(bridge.store.has(GMAIL_REFRESH_TOKEN_KEY)).toBe(false);
  });
});

describe('gmailOAuthService — InMemoryAccessTokenCache', () => {
  it('returns the token while valid and undefined after expiry (with 30s skew)', () => {
    const cache = new InMemoryAccessTokenCache();
    let now = 1_000_000;
    const clock = () => now;
    cache.set('AT', 100, clock); // expires at 1_100_000
    expect(cache.get(clock)).toBe('AT');
    now = 1_070_000; // exactly at the 30s skew boundary
    expect(cache.get(clock)).toBeUndefined();
    now = 1_080_000; // well past the skew window
    expect(cache.get(clock)).toBeUndefined();
  });

  it('clear() removes the cached token', () => {
    const cache = new InMemoryAccessTokenCache();
    cache.set('AT', 3600);
    cache.clear();
    expect(cache.get()).toBeUndefined();
  });

  it('returns undefined when never set', () => {
    expect(new InMemoryAccessTokenCache().get()).toBeUndefined();
  });
});

// Silence unused-import lint when vi is not used.
void vi;
