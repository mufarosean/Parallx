// tests/unit/webResearchNoDirectFetch.test.ts — C14 grep regression test.
//
// ext/web-research/ must never call fetch(), require('http'), or require('https')
// directly. Every outbound HTTP must go through the bridge IPC.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), '..', '..');
const EXT_DIR = path.join(REPO_ROOT, 'ext', 'web-research');

function listJsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listJsFiles(p));
    else if (entry.isFile() && /\.(js|mjs|cjs)$/.test(entry.name)) out.push(p);
  }
  return out;
}

// Strip comments + string literals from a source file so we only scan
// actual code tokens. This is intentionally crude — accept false positives
// on weird template-string content; we'd rather over-detect.
function stripCommentsAndStrings(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/`(?:\\.|[^`\\])*`/g, '``');
}

describe('ext/web-research — no direct outbound HTTP (C14)', () => {
  const files = listJsFiles(EXT_DIR);

  it('the extension directory has at least one JS file', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    const rel = path.relative(REPO_ROOT, file);
    it(`${rel} contains no fetch() / http(s) require / new URLSearchParams-to-network`, () => {
      const raw = fs.readFileSync(file, 'utf-8');
      const code = stripCommentsAndStrings(raw);

      // `fetch(` as a call — exclude `webFetch.` namespacing.
      // We match a `fetch(` that is NOT immediately preceded by an identifier
      // character or a dot (so window.fetch( and bare fetch( both match,
      // but webFetch( does not because the `b` is an identifier char before).
      const fetchCalls = code.match(/(?<![A-Za-z0-9_.])fetch\s*\(/g);
      expect(fetchCalls, `${rel} must not call fetch() directly`).toBeNull();

      // require('http'), require('https'), require('node:http'), require('node:https')
      const httpReq = code.match(/require\s*\(\s*['"](?:node:)?https?['"]\s*\)/g);
      expect(httpReq, `${rel} must not require node http/https`).toBeNull();

      // import from 'http' / 'https' / 'node:http' / 'node:https'
      const httpImport = code.match(/\bfrom\s*['"](?:node:)?https?['"]/g);
      expect(httpImport, `${rel} must not import node http/https`).toBeNull();

      // XMLHttpRequest — same egress class
      const xhr = code.match(/\bXMLHttpRequest\b/g);
      expect(xhr, `${rel} must not use XMLHttpRequest`).toBeNull();

      // navigator.sendBeacon — known exfil channel
      const beacon = code.match(/sendBeacon\s*\(/g);
      expect(beacon, `${rel} must not use sendBeacon`).toBeNull();
    });
  }
});
