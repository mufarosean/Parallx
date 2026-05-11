// tests/unit/webResearchHubStorage.test.ts — M65 Iter 3 C5/C6: Research Hub
// get/set tools store and retrieve {pageId, title} via global storage, with
// input validation that rejects malformed page ids and strips control chars.

import { describe, it, expect, beforeEach } from 'vitest';

let ext: any;
let stored: Record<string, string>;

beforeEach(async () => {
  ext = await import('../../ext/web-research/main.js');
  stored = {};
  ext.__test__._setGlobalStorage({
    get: async (k: string) => stored[k] ?? null,
    set: async (k: string, v: string) => { stored[k] = v; },
  });
});

describe('getResearchHub', () => {
  it('returns null JSON when no Hub has been set', async () => {
    const r = await ext.__test__.getResearchHubTool();
    expect(r.isError).toBe(false);
    expect(JSON.parse(r.content)).toBeNull();
  });

  it('returns the stored {pageId, title} after setResearchHub', async () => {
    await ext.__test__.setResearchHubTool({ pageId: 'page_abc123', title: 'My Hub' });
    const r = await ext.__test__.getResearchHubTool();
    expect(r.isError).toBe(false);
    expect(JSON.parse(r.content)).toEqual({ pageId: 'page_abc123', title: 'My Hub' });
  });

  it('returns title="Research Hub" default when only pageId stored', async () => {
    stored[ext.__test__.KEY_HUB_PAGE_ID] = 'page_only';
    const r = await ext.__test__.getResearchHubTool();
    expect(JSON.parse(r.content)).toEqual({ pageId: 'page_only', title: 'Research Hub' });
  });
});

describe('setResearchHub — input validation (C6)', () => {
  it('rejects empty pageId', async () => {
    const r = await ext.__test__.setResearchHubTool({ pageId: '', title: 'x' });
    expect(r.isError).toBe(true);
    expect(r.errorCode).toBe('BAD_PAGE_ID');
  });

  it('rejects pageId with spaces or HTML', async () => {
    const r = await ext.__test__.setResearchHubTool({ pageId: 'evil <script>', title: 'x' });
    expect(r.isError).toBe(true);
    expect(r.errorCode).toBe('BAD_PAGE_ID');
  });

  it('rejects pageId longer than 256 chars', async () => {
    const r = await ext.__test__.setResearchHubTool({ pageId: 'a'.repeat(257), title: 'x' });
    expect(r.isError).toBe(true);
    expect(r.errorCode).toBe('BAD_PAGE_ID');
  });

  it('defaults title to "Research Hub" when omitted', async () => {
    const r = await ext.__test__.setResearchHubTool({ pageId: 'page_abc' });
    expect(r.isError).toBe(false);
    expect(JSON.parse(r.content)).toEqual({ pageId: 'page_abc', title: 'Research Hub' });
  });

  it('strips control characters from title', async () => {
    const r = await ext.__test__.setResearchHubTool({ pageId: 'page_abc', title: 'A\u0000B\u0007C' });
    expect(r.isError).toBe(false);
    const out = JSON.parse(r.content);
    expect(out.title).toBe('ABC');
  });

  it('truncates title to 200 chars', async () => {
    const r = await ext.__test__.setResearchHubTool({ pageId: 'page_abc', title: 'x'.repeat(500) });
    const out = JSON.parse(r.content);
    expect(out.title.length).toBe(200);
  });
});
