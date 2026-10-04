// tests/unit/webResearchKeyNotInRenderer.test.ts
//
// M65 Iter 1 \u2014 Security Analyst veto regression.
//
// The Brave Search API key MUST live only in main-process safeStorage. It
// must never appear in renderer-bundled code (so it can't be exfiltrated
// through the LLM prompt context) and must never be persisted to the
// plaintext IGlobalStorageService file.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '..', '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

describe('M65: Brave API key is never referenced from renderer-bundled code', () => {
  it('ext/web-research/ source contains no braveApiKey / brave_api_key / BRAVE_API_KEY references', () => {
    const dir = join(REPO_ROOT, 'ext', 'web-research');
    const files = walk(dir).filter((f) => /\.(js|mjs|cjs)$/i.test(f));
    expect(files.length).toBeGreaterThan(0);
    // Match the three literal identifier forms called out by the audit:
    // braveApiKey, brave_api_key, BRAVE_API_KEY. Comments using natural
    // English (e.g. "Brave API key") are allowed \u2014 they cannot leak the
    // secret because they aren't identifiers.
    const pattern = /brave_?api_?key/i;
    for (const f of files) {
      const content = readFileSync(f, 'utf8');
      expect(content, `${f} must not reference the Brave API key`).not.toMatch(pattern);
    }
  });

  it('data/global-storage.json never contains a webResearch.braveApiKey entry', () => {
    // IGlobalStorageService is backed by this file. If a future change
    // re-routes the key through plain storage, the literal key string will
    // appear here and this assertion will fail.
    const p = join(REPO_ROOT, 'data', 'global-storage.json');
    if (!existsSync(p)) return; // empty workspace state is fine
    const content = readFileSync(p, 'utf8');
    expect(content).not.toMatch(/webResearch\.braveApiKey/i);
  });

  it("the key is the extension's own setting, kept in safeStorage, never in a settings file", async () => {
    // Web Research declares it in its manifest (secret: true); the Settings
    // hub shows it only while the extension runs and writes it to safeStorage.
    const manifest = JSON.parse(readFileSync(join(REPO_ROOT, 'ext', 'web-research', 'parallx-manifest.json'), 'utf8'));
    const prop = manifest.contributes.configuration[0].properties['webResearch.braveApiKey'];
    expect(prop).toMatchObject({ type: 'string', secret: true });

    const { SettingsRegistryService } = await import('../../src/services/settingsRegistryService');
    const { registerManifestConfiguration } = await import('../../src/services/manifestSettings');
    const mem = () => { const m = new Map<string, string>(); return { get: async (k: string) => m.get(k), set: async (k: string, v: string) => { m.set(k, v); }, delete: async (k: string) => { m.delete(k); }, has: async (k: string) => m.has(k), keys: async () => [...m.keys()], clear: async () => m.clear(), m }; };
    const user = mem();
    const registry = new SettingsRegistryService(user as any, mem() as any);
    await registry.initialize();
    const secrets = new Map<string, string>();
    registry.setSecretStorage({
      setString: async (k: string, v: string) => { secrets.set(k, v); return { ok: true }; },
      getString: async (k: string) => ({ ok: true, value: secrets.get(k) ?? null }),
      delete: async (k: string) => { secrets.delete(k); return { ok: true }; },
    } as any);
    const bound: string[] = [];
    registerManifestConfiguration(registry, manifest, {
      getConfiguration: () => ({ get: () => undefined, update: async (k: string) => { bound.push(k); } }),
    } as any);
    expect(registry.getSchema('webResearch.braveApiKey')).toMatchObject({ secret: true });
    await registry.setValue('webResearch.braveApiKey', 'BSA-test');
    expect(secrets.get('webResearch.braveApiKey')).toBe('BSA-test');
    expect(bound).toEqual([]); // never written to the configuration file
    expect(JSON.stringify([...user.m.values()])).not.toMatch(/BSA-test/);
  });
});
