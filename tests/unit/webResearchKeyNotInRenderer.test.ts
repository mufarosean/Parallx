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

  it('WebResearchSection writes the Brave key via the secret bridge, not IGlobalStorageService', () => {
    const src = readFileSync(
      join(REPO_ROOT, 'src', 'aiSettings', 'ui', 'sections', 'webResearchSection.ts'),
      'utf8',
    );
    // The Brave key constant must not be passed to IStorage.set/get.
    expect(src).not.toMatch(/_storage[^\n]*\.(set|get)\([^)]*KEY_BRAVE_API_KEY/);
    expect(src).not.toMatch(/storage\.(set|get)\(\s*['"`]webResearch\.braveApiKey/);
    // Positive check: must use the secret storage service for the key.
    expect(src).toMatch(/createSecretStorageService/);
  });
});
