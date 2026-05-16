// tests/unit/webResearchHistoryLog.test.ts — M65 Iter 3 C7/C8:
// logResearchEvent writes a whitelist-serialized ndjson line; secrets and
// response bodies are NEVER persisted; daily-rotation filename is correct.

import { describe, it, expect, beforeEach } from 'vitest';

let ext: any;
let fsStore: Map<string, string>;
let fsCalls: { mkdir: string[]; reads: string[]; writes: Array<{ uri: string; content: string }> };

function makeApi() {
  fsStore = new Map();
  fsCalls = { mkdir: [], reads: [], writes: [] };
  const fsHandle = {
    mkdir: async (uri: string) => {
      fsCalls.mkdir.push(uri);
    },
    exists: async (uri: string) => fsStore.has(uri),
    readFile: async (uri: string) => {
      fsCalls.reads.push(uri);
      return fsStore.get(uri) ?? '';
    },
    writeFile: async (uri: string, content: string) => {
      fsCalls.writes.push({ uri, content });
      fsStore.set(uri, content);
    },
  };
  return {
    workspace: {
      workspaceFolders: [{ uri: 'file:///tmp/ws' }],
    },
    // M67 Phase 3 — web-research uses api.requestCapability('fs', ...) for fs access.
    requestCapability: (capability: string) => {
      if (capability !== 'fs') throw new Error(`Unknown capability: ${capability}`);
      return fsHandle;
    },
  };
}

beforeEach(async () => {
  ext = await import('../../ext/web-research/main.js');
  ext.__test__._setApi(makeApi());
});

describe('_buildHistoryLine — whitelist serialization (C7)', () => {
  it('returns null for an unrecognized kind', () => {
    expect(ext.__test__._buildHistoryLine({ kind: 'nope' })).toBeNull();
  });

  it('accepts the four allowed kinds', () => {
    for (const kind of ['search', 'fetch', 'hub-create', 'draft-create']) {
      const line = ext.__test__._buildHistoryLine({ kind });
      expect(line).not.toBeNull();
      const parsed = JSON.parse(line!);
      expect(parsed.kind).toBe(kind);
    }
  });

  it('NEVER persists apiKey, body, content, html, response, headers, cookies', () => {
    const line = ext.__test__._buildHistoryLine({
      kind: 'fetch',
      url: 'https://example.com/x',
      apiKey: 'BSA_super_secret',
      body: '<html>nope</html>',
      content: 'untrusted markdown',
      html: '<script>alert(1)</script>',
      text: 'sanitized text',
      markdown: '# heading',
      response: { ok: true },
      headers: { authorization: 'leak' },
      cookies: 'session=abc',
    });
    expect(line).not.toBeNull();
    const parsed = JSON.parse(line!);
    expect(parsed).not.toHaveProperty('apiKey');
    expect(parsed).not.toHaveProperty('body');
    expect(parsed).not.toHaveProperty('content');
    expect(parsed).not.toHaveProperty('html');
    expect(parsed).not.toHaveProperty('text');
    expect(parsed).not.toHaveProperty('markdown');
    expect(parsed).not.toHaveProperty('response');
    expect(parsed).not.toHaveProperty('headers');
    expect(parsed).not.toHaveProperty('cookies');
    // The raw stringified line must not contain the secret either.
    expect(line!).not.toContain('BSA_super_secret');
    expect(line!).not.toContain('<html>');
    expect(line!).not.toContain('<script>');
  });

  it('persists only the whitelisted metadata', () => {
    const line = ext.__test__._buildHistoryLine({
      kind: 'search',
      query: 'rust async runtimes',
      urlCount: 7,
    });
    const parsed = JSON.parse(line!);
    expect(parsed.kind).toBe('search');
    expect(parsed.query).toBe('rust async runtimes');
    expect(parsed.urlCount).toBe(7);
    expect(typeof parsed.ts).toBe('string');
    expect(parsed.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('truncates query at 256 chars and url at 2048 chars', () => {
    const line = ext.__test__._buildHistoryLine({
      kind: 'fetch',
      url: 'https://example.com/' + 'a'.repeat(3000),
      query: 'q'.repeat(500),
    });
    const parsed = JSON.parse(line!);
    expect(parsed.url.length).toBeLessThanOrEqual(2048);
    expect(parsed.query.length).toBeLessThanOrEqual(256);
  });

  it('strips control characters from query and url', () => {
    const line = ext.__test__._buildHistoryLine({
      kind: 'fetch',
      url: 'https://e.com/\u0000\u0007',
      query: 'a\u0000b',
    });
    const parsed = JSON.parse(line!);
    expect(parsed.url).toBe('https://e.com/');
    expect(parsed.query).toBe('ab');
  });

  it('rejects malformed hubPageId / draftPageId', () => {
    const line = ext.__test__._buildHistoryLine({
      kind: 'draft-create',
      hubPageId: 'evil <x>',
      draftPageId: 'page_ok',
    });
    const parsed = JSON.parse(line!);
    expect(parsed).not.toHaveProperty('hubPageId');
    expect(parsed.draftPageId).toBe('page_ok');
  });
});

describe('_historyFileName — daily rotation', () => {
  it('uses YYYY-MM-DD local date', () => {
    const d = new Date(2026, 4, 11); // May 11 2026 local
    const name = ext.__test__._historyFileName(d);
    expect(name).toBe('web-research-history.2026-05-11.ndjson');
  });
});

describe('logResearchEventTool — ndjson append', () => {
  it('writes the line under .parallx/data/<filename>', async () => {
    const r = await ext.__test__.logResearchEventTool({ kind: 'search', query: 'q' });
    expect(r.isError).toBe(false);
    expect(fsCalls.writes.length).toBe(1);
    expect(fsCalls.writes[0].uri).toMatch(/\.parallx\/data\/web-research-history\.\d{4}-\d{2}-\d{2}\.ndjson$/);
    expect(fsCalls.writes[0].content.endsWith('\n')).toBe(true);
    const lines = fsCalls.writes[0].content.trim().split('\n');
    expect(lines.length).toBe(1);
    expect(JSON.parse(lines[0]).kind).toBe('search');
  });

  it('mkdir is invoked to ensure the .parallx/data dir', async () => {
    await ext.__test__.logResearchEventTool({ kind: 'fetch', url: 'https://x.com/' });
    expect(fsCalls.mkdir.length).toBeGreaterThan(0);
    expect(fsCalls.mkdir.some(u => u.endsWith('.parallx/data'))).toBe(true);
  });

  it('appends a new line to an existing file rather than overwriting', async () => {
    const first = await ext.__test__.logResearchEventTool({ kind: 'search', query: 'q1' });
    expect(first.isError).toBe(false);
    const second = await ext.__test__.logResearchEventTool({ kind: 'search', query: 'q2' });
    expect(second.isError).toBe(false);
    const finalContent = fsCalls.writes[fsCalls.writes.length - 1].content;
    const lines = finalContent.trim().split('\n');
    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[0]).query).toBe('q1');
    expect(JSON.parse(lines[1]).query).toBe('q2');
  });

  it('returns soft error on bad record kind', async () => {
    const r = await ext.__test__.logResearchEventTool({ kind: 'unknown' });
    expect(r.isError).toBe(true);
    expect(r.errorCode).toBe('BAD_RECORD');
    expect(fsCalls.writes.length).toBe(0);
  });
});
