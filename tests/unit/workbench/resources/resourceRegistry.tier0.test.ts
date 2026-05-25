// resourceRegistry.tier0.test.ts — Slice A2 verification
//
// Pure-Node unit tests for ResourceRegistry dispatch behavior.

import { describe, it, expect, beforeEach } from 'vitest';
import { ResourceRegistry, type ResourceResolver } from '../../../../src/workbench/resources/resourceRegistry.js';
import {
  canvasPageResource,
  fileResource,
  chatSessionResource,
  type CanvasPageResource,
  type FileResource,
} from '../../../../src/workbench/resources/resource.js';

function fileResolver(): ResourceResolver<FileResource, { name: string; path: string }> {
  return {
    type: 'file',
    async resolve(r) { return { name: r.path.split(/[\\/]/).pop()!, path: r.path }; },
  };
}

function canvasResolver(): ResourceResolver<CanvasPageResource, { pageId: string }> {
  return {
    type: 'canvas-page',
    async resolve(r) { return { pageId: r.pageId }; },
  };
}

describe('ResourceRegistry — register / has / unregister', () => {
  let reg: ResourceRegistry;
  beforeEach(() => { reg = new ResourceRegistry(); });

  it('registers a resolver and reports has()', () => {
    reg.register(fileResolver());
    expect(reg.has('file')).toBe(true);
    expect(reg.has('canvas-page')).toBe(false);
  });

  it('throws on duplicate register', () => {
    reg.register(fileResolver());
    expect(() => reg.register(fileResolver())).toThrow(/already registered/);
  });

  it('override replaces existing resolver', () => {
    reg.register(fileResolver());
    const replaced = reg.override(fileResolver());
    expect(replaced).toBe(true);
  });

  it('override returns false when no prior resolver', () => {
    expect(reg.override(fileResolver())).toBe(false);
  });

  it('unregister removes and reports', () => {
    reg.register(fileResolver());
    expect(reg.unregister('file')).toBe(true);
    expect(reg.has('file')).toBe(false);
    expect(reg.unregister('file')).toBe(false);
  });
});

describe('ResourceRegistry — resolve', () => {
  let reg: ResourceRegistry;
  beforeEach(() => { reg = new ResourceRegistry(); });

  it('dispatches to the resolver for the resource type', async () => {
    reg.register(fileResolver());
    const out = await reg.resolve<{ name: string; path: string }>(fileResource('/tmp/a.md'));
    expect(out).toEqual({ name: 'a.md', path: '/tmp/a.md' });
  });

  it('rejects when no resolver is registered for the type', async () => {
    reg.register(fileResolver());
    await expect(reg.resolve(canvasPageResource('p1'))).rejects.toThrow(/no resolver registered/);
  });

  it('dispatches to the correct resolver among many', async () => {
    reg.register(fileResolver());
    reg.register(canvasResolver());
    const a = await reg.resolve<{ pageId: string }>(canvasPageResource('p1'));
    const b = await reg.resolve<{ name: string }>(fileResource('/tmp/b.md'));
    expect(a.pageId).toBe('p1');
    expect(b.name).toBe('b.md');
  });
});

describe('ResourceRegistry — resolveUri', () => {
  let reg: ResourceRegistry;
  beforeEach(() => {
    reg = new ResourceRegistry();
    reg.register(canvasResolver());
  });

  it('parses a parallx:// URI then dispatches', async () => {
    const out = await reg.resolveUri<{ pageId: string }>('parallx://canvas-page:abc');
    expect(out).toEqual({ pageId: 'abc' });
  });

  it('parses legacy canvas alias then dispatches', async () => {
    const out = await reg.resolveUri<{ pageId: string }>('parallx.canvas:canvas:legacy');
    expect(out).toEqual({ pageId: 'legacy' });
  });

  it('returns null for malformed URIs', async () => {
    expect(await reg.resolveUri('')).toBeNull();
    expect(await reg.resolveUri('parallx://nope:1')).toBeNull();
  });

  it('rejects when URI parses but type has no resolver', async () => {
    await expect(
      reg.resolveUri('parallx://chat-session:s1'),
    ).rejects.toThrow(/no resolver registered/);
  });
});

describe('ResourceRegistry — dispose', () => {
  it('clears all resolvers on dispose', async () => {
    const reg = new ResourceRegistry();
    reg.register(fileResolver());
    reg.dispose();
    expect(reg.has('file')).toBe(false);
    await expect(reg.resolve(fileResource('/x'))).rejects.toThrow(/no resolver/);
  });
});

describe('ResourceRegistry — also routes chat-session resolvers when registered', () => {
  it('end-to-end: register chat resolver, parse URI, resolve', async () => {
    const reg = new ResourceRegistry();
    reg.register({
      type: 'chat-session',
      async resolve(r) { return { sessionId: r.sessionId, turnId: r.turnId }; },
    });
    const out = await reg.resolveUri<{ sessionId: string; turnId?: string }>('parallx://chat-session:s1?turn=t1');
    expect(out).toEqual({ sessionId: 's1', turnId: 't1' });

    // Direct resolve path
    const direct = await reg.resolve<{ sessionId: string }>(chatSessionResource('s2'));
    expect(direct.sessionId).toBe('s2');
  });
});
