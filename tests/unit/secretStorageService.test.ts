// secretStorageService.test.ts — M60 §T6.F3
//
// Verifies the renderer-side facade over `secret:set/get/delete` IPC:
//   • base64 round-tripping of UTF-8 strings (incl. multibyte)
//   • bridge-unavailable path returns a typed error
//   • IPC errors (safe-storage-unavailable, not-found, invalid-key)
//     surface verbatim
//
// M62: gmail-specific persistence helpers were removed; the Gmail MCP
// server now owns its own credential store.

import { describe, it, expect, vi } from 'vitest';
import {
  createSecretStorageService,
  type ISecretBridge,
} from '../../src/services/secretStorageService';

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

// Silence unused-import lint when vi is not used.
void vi;
