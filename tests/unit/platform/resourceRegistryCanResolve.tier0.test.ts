// resourceRegistryCanResolve.tier0.test.ts — Slice A17
//
// Verifies canResolve(Resource | string) on IResourceRegistry.

import { describe, it, expect } from 'vitest';
import { ResourceRegistry, type ResourceResolver } from '../../../src/workbench/resources/resourceRegistry.js';
import { fileResource, externalResource, type FileResource, type ExternalResource } from '../../../src/workbench/resources/resource.js';

const fileResolver: ResourceResolver<FileResource, string> = {
  type: 'file',
  async resolve(r) { return r.path; },
};

const externalResolver: ResourceResolver<ExternalResource, string> = {
  type: 'external',
  async resolve(r) { return r.uri; },
};

describe('ResourceRegistry.canResolve (Slice A17)', () => {
  it('returns false on empty registry for any resource', () => {
    const reg = new ResourceRegistry();
    expect(reg.canResolve(fileResource('/a'))).toBe(false);
    expect(reg.canResolve(externalResource('https://x'))).toBe(false);
  });

  it('returns true for a registered Resource by reference', () => {
    const reg = new ResourceRegistry();
    reg.register(fileResolver);
    expect(reg.canResolve(fileResource('/a'))).toBe(true);
    expect(reg.canResolve(externalResource('https://x'))).toBe(false);
  });

  it('returns true for a parseable URI of a registered type', () => {
    const reg = new ResourceRegistry();
    reg.register(fileResolver);
    expect(reg.canResolve('parallx://file:' + encodeURIComponent('/a/b.md'))).toBe(true);
  });

  it('returns false for a parseable URI whose type has no resolver', () => {
    const reg = new ResourceRegistry();
    reg.register(fileResolver);
    expect(reg.canResolve('parallx://canvas-page:abc')).toBe(false);
  });

  it('returns false for malformed parallx URIs and strings without a scheme', () => {
    const reg = new ResourceRegistry();
    reg.register(fileResolver);
    expect(reg.canResolve('parallx://')).toBe(false);
    expect(reg.canResolve('')).toBe(false);
    expect(reg.canResolve('not-a-uri')).toBe(false); // no scheme separator → unparseable
  });

  it('handles external scheme URIs via the external resolver', () => {
    const reg = new ResourceRegistry();
    reg.register(externalResolver);
    expect(reg.canResolve('https://example.com')).toBe(true);
    expect(reg.canResolve('https://example.com/foo?bar=1')).toBe(true);
  });

  it('returns false for non-Resource objects', () => {
    const reg = new ResourceRegistry();
    reg.register(fileResolver);
    expect(reg.canResolve({} as unknown as never)).toBe(false);
    expect(reg.canResolve({ type: 123 } as unknown as never)).toBe(false);
  });

  it('tracks dynamic register / unregister', () => {
    const reg = new ResourceRegistry();
    expect(reg.canResolve(fileResource('/a'))).toBe(false);
    reg.register(fileResolver);
    expect(reg.canResolve(fileResource('/a'))).toBe(true);
    reg.unregister('file');
    expect(reg.canResolve(fileResource('/a'))).toBe(false);
  });
});
