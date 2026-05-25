// resourceRegistryResolveSafe.tier0.test.ts — Slice A20

import { describe, it, expect } from 'vitest';
import { ResourceRegistry } from '../../../src/workbench/resources/resourceRegistry.js';
import type { Resource, ResourceResolver } from '../../../src/workbench/resources/resourceRegistry.js';

interface FileResource extends Resource { readonly type: 'file'; readonly path: string }

function makeFileResolver(returnValue: unknown = 'ok'): ResourceResolver<FileResource, unknown> {
  return {
    type: 'file',
    resolve: async () => returnValue,
  };
}

describe('IResourceRegistry.resolveSafe (Slice A20)', () => {
  it('returns ok:true with value for a registered Resource', async () => {
    const r = new ResourceRegistry();
    r.register(makeFileResolver('file-content'));
    const out = await r.resolveSafe<string>({ type: 'file', path: '/a' } as FileResource);
    expect(out).toEqual({ ok: true, value: 'file-content' });
  });

  it('returns ok:true with value for a parseable URI string', async () => {
    const r = new ResourceRegistry();
    r.register(makeFileResolver('via-uri'));
    const out = await r.resolveSafe<string>('parallx://file:/some/path');
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.value).toBe('via-uri');
  });

  it('returns ok:false reason=malformed-uri for unparseable strings', async () => {
    const r = new ResourceRegistry();
    r.register(makeFileResolver());
    const out = await r.resolveSafe('not-a-uri');
    expect(out).toEqual({ ok: false, reason: 'malformed-uri' });
  });

  it('returns ok:false reason=malformed-uri for null/undefined/non-objects', async () => {
    const r = new ResourceRegistry();
    expect(await r.resolveSafe(null)).toEqual({ ok: false, reason: 'malformed-uri' });
    expect(await r.resolveSafe(undefined)).toEqual({ ok: false, reason: 'malformed-uri' });
    expect(await r.resolveSafe({} as unknown as Resource)).toEqual({ ok: false, reason: 'malformed-uri' });
    expect(await r.resolveSafe({ type: 123 } as unknown as Resource)).toEqual({ ok: false, reason: 'malformed-uri' });
  });

  it('returns ok:false reason=no-resolver when type has no registered resolver', async () => {
    const r = new ResourceRegistry();
    const out = await r.resolveSafe({ type: 'file', path: '/a' } as FileResource);
    expect(out).toEqual({ ok: false, reason: 'no-resolver' });
  });

  it('returns ok:false reason=no-resolver for parseable URI without a resolver', async () => {
    const r = new ResourceRegistry();
    const out = await r.resolveSafe('parallx://file:/x');
    expect(out).toEqual({ ok: false, reason: 'no-resolver' });
  });

  it('returns ok:false reason=failed with error when resolver throws', async () => {
    const r = new ResourceRegistry();
    const boom = new Error('boom');
    r.register({ type: 'file', resolve: async () => { throw boom; } });
    const out = await r.resolveSafe({ type: 'file', path: '/a' } as FileResource);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.reason).toBe('failed');
      expect(out.error).toBe(boom);
    }
  });

  it('never throws across all four reason categories', async () => {
    const r = new ResourceRegistry();
    r.register({ type: 'file', resolve: async () => { throw new Error('x'); } });
    await expect(r.resolveSafe(null)).resolves.toBeDefined();
    await expect(r.resolveSafe('parallx://unknown:/x')).resolves.toBeDefined();
    await expect(r.resolveSafe({ type: 'file', path: '/a' } as FileResource)).resolves.toBeDefined();
    await expect(r.resolveSafe('not-a-uri')).resolves.toBeDefined();
  });
});
