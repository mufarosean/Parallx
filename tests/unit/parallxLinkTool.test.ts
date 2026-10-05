// parallxLinkTool.test.ts — M66 Iteration C tool guardrail.
//
// The tool MUST validate the target against the snapshot of registered
// contracts. A new extension becoming valid is purely a function of
// `getContracts()` returning more entries — no per-extension branches in
// the tool itself.

import { describe, it, expect } from 'vitest';
import type { ICancellationToken } from '../../src/services/chatTypes.js';
import {
  createParallxLinkTool,
  type IParallxLinkToolContractView,
} from '../../src/built-in/chat/tools/parallxLinkTool.js';

const NOT_CANCELLED: ICancellationToken = {
  isCancellationRequested: false,
  onCancellationRequested: () => ({ dispose: () => {} }),
};

function makeContracts(...segments: string[]): readonly IParallxLinkToolContractView[] {
  return segments.map((s) => ({
    segment: s,
    displayName: s.charAt(0).toUpperCase() + s.slice(1),
    kinds: [{ kind: 'page', uriTemplate: `parallx://${s}/page/<id>` }],
  }));
}

async function call(args: Record<string, unknown>, contracts: readonly IParallxLinkToolContractView[]) {
  const tool = createParallxLinkTool(() => contracts);
  const result = await tool.handler(args, NOT_CANCELLED);
  const parsed = JSON.parse(result.content as string) as Record<string, unknown>;
  return { result, parsed };
}

describe('M66 link_create tool', () => {
  it('mints a valid URI when target parses and segment is registered', async () => {
    const { result, parsed } = await call(
      { target: 'parallx://canvas/page/01HZX' },
      makeContracts('canvas'),
    );
    expect(result.isError).toBeFalsy();
    expect(parsed.ok).toBe(true);
    expect(parsed.uri).toBe('parallx://canvas/page/01HZX');
    expect(parsed.segment).toBe('canvas');
    expect(parsed.displayName).toBe('Canvas');
  });

  it('rejects when target is not a parallx:// URI', async () => {
    const { result, parsed } = await call(
      { target: 'https://example.com/foo' },
      makeContracts('canvas'),
    );
    expect(result.isError).toBe(true);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toMatch(/not a valid parallx/);
  });

  it('rejects when segment is unknown', async () => {
    const { result, parsed } = await call(
      { target: 'parallx://nonexistent/page/1' },
      makeContracts('canvas', 'explorer'),
    );
    expect(result.isError).toBe(true);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toContain('Unknown segment "nonexistent"');
    expect(parsed.error).toContain('canvas');
    expect(parsed.error).toContain('explorer');
  });

  it('appends anchor as query string when target has none', async () => {
    const { parsed } = await call(
      { target: 'parallx://canvas/page/01HZX', anchor: 'block=abc' },
      makeContracts('canvas'),
    );
    expect(parsed.uri).toBe('parallx://canvas/page/01HZX?block=abc');
  });

  it('appends anchor with & when target already has a query', async () => {
    const { parsed } = await call(
      { target: 'parallx://explorer/file?path=%2Ffoo.pdf', anchor: 'page=3&quote=foo' },
      makeContracts('explorer'),
    );
    expect(parsed.uri).toBe('parallx://explorer/file?path=%2Ffoo.pdf&page=3&quote=foo');
  });

  it('rejects anchor that starts with ? or & (caller should pass query body only)', async () => {
    const { result, parsed } = await call(
      { target: 'parallx://canvas/page/01HZX', anchor: '?block=abc' },
      makeContracts('canvas'),
    );
    expect(result.isError).toBe(true);
    expect(parsed.error).toMatch(/must not start with/);
  });

  it('fails fast when no contracts are registered', async () => {
    const { result, parsed } = await call(
      { target: 'parallx://canvas/page/01HZX' },
      [],
    );
    expect(result.isError).toBe(true);
    expect(parsed.error).toContain('(none registered)');
  });

  it('requires target argument', async () => {
    const { result, parsed } = await call({}, makeContracts('canvas'));
    expect(result.isError).toBe(true);
    expect(parsed.error).toMatch(/Missing required argument: target/);
  });
});

// ── The link's own check (verify) ───────────────────────────────────────────
//
// "ok: true" used to mean only "shaped like a parallx:// link": the model
// then told the user its links were "validated" and "verified" when the
// files did not exist. Now the link's kind checks the target, and the result
// carries what was checked and where the link lands.

describe('link_create checks the target', () => {
  async function callWith(args: Record<string, unknown>, verify: (uri: string) => Promise<any>) {
    const tool = createParallxLinkTool(() => makeContracts('canvas', 'explorer'), verify);
    const result = await tool.handler(args, NOT_CANCELLED);
    return { result, parsed: JSON.parse(result.content as string) as Record<string, unknown> };
  }

  it('returns the checked link, what was checked, and the location to cite', async () => {
    const seen: string[] = [];
    const { result, parsed } = await callWith(
      { target: 'parallx://explorer/file', params: { path: 'Rising Fellow Guides/Clark.pdf', quote: 'The ultimate loss is NOT the same' } },
      async (uri) => {
        seen.push(uri);
        return { ok: true, uri: 'parallx://explorer/file?path=X&page=13', checked: '"Clark.pdf" exists and the quote was found on page 13 of 30.', location: 'page 13 of 30' };
      },
    );
    expect(result.isError).toBeFalsy();
    expect(parsed).toMatchObject({ ok: true, uri: 'parallx://explorer/file?path=X&page=13', location: 'page 13 of 30' });
    expect(parsed.checked).toContain('page 13 of 30');
    // params were encoded into the URI handed to the check.
    const asked = new URL(seen[0]);
    expect(asked.searchParams.get('path')).toBe('Rising Fellow Guides/Clark.pdf');
    expect(asked.searchParams.get('quote')).toBe('The ultimate loss is NOT the same');
  });

  it('passes the check\'s error through as a failure', async () => {
    const { result, parsed } = await callWith(
      { target: 'parallx://explorer/file?path=D:/AI/Parallx/Shapland.pdf' },
      async () => ({ ok: false, error: 'No file at "D:/AI/Parallx/Shapland.pdf" in this workspace.' }),
    );
    expect(result.isError).toBe(true);
    expect(parsed).toEqual({ ok: false, error: 'No file at "D:/AI/Parallx/Shapland.pdf" in this workspace.' });
  });

  it('encodes params with characters a hand-built link breaks on', async () => {
    let asked = '';
    await callWith(
      { target: 'parallx://explorer/file', params: { path: 'C++ notes/a&b #1.pdf', quote: 'x + y = 100%', page: 3 } },
      async (uri) => { asked = uri; return { ok: true, uri, checked: 'ok' }; },
    );
    const u = new URL(asked);
    expect(u.searchParams.get('path')).toBe('C++ notes/a&b #1.pdf');
    expect(u.searchParams.get('quote')).toBe('x + y = 100%');
    expect(u.searchParams.get('page')).toBe('3');
    expect(u.hash).toBe('');
  });

  it('lets params override the same name in target', async () => {
    let asked = '';
    await callWith(
      { target: 'parallx://explorer/file?path=old.pdf&page=2', params: { page: 9 } },
      async (uri) => { asked = uri; return { ok: true, uri, checked: 'ok' }; },
    );
    const u = new URL(asked);
    expect(u.searchParams.get('path')).toBe('old.pdf');
    expect(u.searchParams.get('page')).toBe('9');
  });

  it('rejects params that are not an object of strings and numbers', async () => {
    const { result, parsed } = await callWith({ target: 'parallx://explorer/file', params: ['path'] }, async () => ({ ok: true, uri: '', checked: '' }));
    expect(result.isError).toBe(true);
    expect(parsed.error).toMatch(/params must be an object/);
  });

  it('without a checker, says the target was not checked', async () => {
    const { parsed } = await call({ target: 'parallx://canvas/page/01HZX' }, makeContracts('canvas'));
    expect(parsed.checked).toBe('The link is well formed; its target was not checked.');
  });
});
