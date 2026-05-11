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

describe('M66 parallx_link tool', () => {
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
