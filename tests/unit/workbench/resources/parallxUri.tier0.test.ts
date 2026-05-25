// parallxUri.tier0.test.ts — Slice A1 verification
//
// Pure-Node unit tests for the Resource union type + canonical URI scheme.
// No DOM, no IPC, no filesystem.

import { describe, it, expect } from 'vitest';
import {
  parse,
  serialize,
  equals,
} from '../../../../src/workbench/resources/parallxUri.js';
import {
  fileResource,
  canvasPageResource,
  chatSessionResource,
  toolArtifactResource,
  externalResource,
  type Resource,
} from '../../../../src/workbench/resources/resource.js';

describe('parallxUri.parse — typed parallx:// URIs', () => {
  it('parses a bare canvas-page URI', () => {
    const r = parse('parallx://canvas-page:abc-123');
    expect(r).toEqual({ type: 'canvas-page', pageId: 'abc-123' });
  });

  it('parses a canvas-page URI with workspace + block', () => {
    const r = parse('parallx://canvas-page:p1?workspace=ws1&block=b1');
    expect(r).toEqual({ type: 'canvas-page', pageId: 'p1', workspaceId: 'ws1', blockId: 'b1' });
  });

  it('parses a chat-session URI with turn', () => {
    const r = parse('parallx://chat-session:s1?turn=t1&workspace=ws1');
    expect(r).toEqual({ type: 'chat-session', sessionId: 's1', turnId: 't1', workspaceId: 'ws1' });
  });

  it('parses a file URI with absolute Windows path', () => {
    const path = 'C:\\Users\\me\\notes\\hello world.md';
    const r = parse(`parallx://file:${encodeURIComponent(path)}?workspace=ws1&hash=deadbeef`);
    expect(r).toEqual({ type: 'file', path, workspaceId: 'ws1', hash: 'deadbeef' });
  });

  it('parses a tool-artifact URI', () => {
    const r = parse('parallx://tool-artifact:my.tool/art-1?workspace=ws1');
    expect(r).toEqual({ type: 'tool-artifact', toolId: 'my.tool', artifactId: 'art-1', workspaceId: 'ws1' });
  });
});

describe('parallxUri.parse — legacy aliases', () => {
  it('parses the legacy parallx.canvas:canvas:<uuid> alias', () => {
    const r = parse('parallx.canvas:canvas:legacy-page-uuid');
    expect(r).toEqual({ type: 'canvas-page', pageId: 'legacy-page-uuid' });
  });

  it('rejects legacy alias with empty UUID', () => {
    expect(parse('parallx.canvas:canvas:')).toBeNull();
  });
});

describe('parallxUri.parse — external pass-through', () => {
  it('treats http:// as external', () => {
    const r = parse('https://example.com/path?x=1');
    expect(r).toEqual({ type: 'external', scheme: 'https', uri: 'https://example.com/path?x=1' });
  });

  it('treats unknown custom schemes as external', () => {
    const r = parse('mailto:a@b.c');
    expect(r).toEqual({ type: 'external', scheme: 'mailto', uri: 'mailto:a@b.c' });
  });
});

describe('parallxUri.parse — rejection paths', () => {
  it('rejects empty string', () => {
    expect(parse('')).toBeNull();
  });

  it('rejects non-string input', () => {
    // @ts-expect-error testing runtime guard
    expect(parse(null)).toBeNull();
    // @ts-expect-error testing runtime guard
    expect(parse(undefined)).toBeNull();
  });

  it('rejects parallx:// with unknown type', () => {
    expect(parse('parallx://nope:abc')).toBeNull();
  });

  it('rejects parallx:// with empty id', () => {
    expect(parse('parallx://canvas-page:')).toBeNull();
  });

  it('rejects parallx:// with missing type-id separator', () => {
    expect(parse('parallx://justwords')).toBeNull();
  });

  it('rejects tool-artifact missing /artifactId', () => {
    expect(parse('parallx://tool-artifact:tool-only')).toBeNull();
    expect(parse('parallx://tool-artifact:tool/')).toBeNull();
  });

  it('rejects strings with no scheme separator', () => {
    expect(parse('not-a-uri')).toBeNull();
  });
});

describe('parallxUri.serialize', () => {
  it('serializes file with full metadata', () => {
    const r = fileResource('C:/a b.md', { hash: 'h', workspaceId: 'ws' });
    expect(serialize(r)).toBe('parallx://file:C%3A%2Fa%20b.md?workspace=ws&hash=h');
  });

  it('serializes canvas-page omitting empty optionals', () => {
    expect(serialize(canvasPageResource('p1'))).toBe('parallx://canvas-page:p1');
  });

  it('serializes chat-session with turn + workspace', () => {
    expect(serialize(chatSessionResource('s1', { turnId: 't1', workspaceId: 'ws1' })))
      .toBe('parallx://chat-session:s1?workspace=ws1&turn=t1');
  });

  it('serializes tool-artifact with encoded toolId', () => {
    const r = toolArtifactResource('my/tool', 'art id');
    expect(serialize(r)).toBe('parallx://tool-artifact:my%2Ftool/art%20id');
  });

  it('serializes external by returning raw uri', () => {
    expect(serialize(externalResource('https://x.test/p'))).toBe('https://x.test/p');
  });
});

describe('parallxUri round-trip', () => {
  const cases: Resource[] = [
    fileResource('/tmp/file.txt'),
    fileResource('C:/a b.md', { hash: 'h', workspaceId: 'ws' }),
    canvasPageResource('p1'),
    canvasPageResource('p1', { blockId: 'b1', workspaceId: 'ws1' }),
    chatSessionResource('s1', { turnId: 't1', workspaceId: 'ws1' }),
    toolArtifactResource('tool.a', 'art-1'),
    toolArtifactResource('tool/a', 'art id', { workspaceId: 'ws1' }),
    externalResource('https://x.test/p?q=1'),
  ];

  for (const original of cases) {
    it(`round-trips ${original.type} → uri → resource`, () => {
      const uri = serialize(original);
      const parsed = parse(uri);
      expect(parsed).not.toBeNull();
      expect(equals(parsed!, original)).toBe(true);
    });
  }
});

describe('parallxUri.equals', () => {
  it('returns true for resources with identical canonical form', () => {
    expect(equals(canvasPageResource('p1'), canvasPageResource('p1'))).toBe(true);
  });

  it('returns false when optional fields differ', () => {
    expect(equals(
      canvasPageResource('p1'),
      canvasPageResource('p1', { blockId: 'b1' }),
    )).toBe(false);
  });

  it('returns false across types', () => {
    expect(equals(
      canvasPageResource('x'),
      chatSessionResource('x'),
    )).toBe(false);
  });
});
