// externalResolver.tier0.test.ts — Slice A9

import { describe, it, expect } from 'vitest';
import { ResourceRegistry } from '../../../../../src/workbench/resources/resourceRegistry.js';
import { externalResource } from '../../../../../src/workbench/resources/resource.js';
import {
  ExternalResourceResolver,
  externalResourceResolver,
} from '../../../../../src/workbench/resources/resolvers/externalResolver.js';

describe('ExternalResourceResolver', () => {
  it('has type "external"', () => {
    expect(new ExternalResourceResolver().type).toBe('external');
  });

  it('echoes the URI unchanged', async () => {
    const r = new ExternalResourceResolver();
    const res = externalResource('https://example.com/x');
    const out = await r.resolve(res);
    expect(out.uri).toBe('https://example.com/x');
    expect(out.resource).toBe(res);
  });

  it('rejects on empty URI', async () => {
    const r = new ExternalResourceResolver();
    const bad = { type: 'external' as const, scheme: '', uri: '' };
    await expect(r.resolve(bad)).rejects.toThrow(/empty/);
  });

  it('integrates with ResourceRegistry.resolve', async () => {
    const reg = new ResourceRegistry();
    reg.register(externalResourceResolver());
    const out = await reg.resolve(externalResource('mailto:x@y.z'));
    expect((out as { uri: string }).uri).toBe('mailto:x@y.z');
  });
});
