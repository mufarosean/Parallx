// canvasPageResolver.tier0.test.ts — Slice A8

import { describe, it, expect, vi } from 'vitest';
import { ResourceRegistry } from '../../../../../src/workbench/resources/resourceRegistry.js';
import { canvasPageResource } from '../../../../../src/workbench/resources/resource.js';
import {
  CanvasPageResourceResolver,
  canvasPageResourceResolver,
} from '../../../../../src/workbench/resources/resolvers/canvasPageResolver.js';

describe('CanvasPageResourceResolver', () => {
  it('has type "canvas-page"', () => {
    expect(new CanvasPageResourceResolver({ getPage: () => null }).type).toBe('canvas-page');
  });

  it('resolves a known page', async () => {
    const getPage = vi.fn(async (id: string) => ({ id, title: 'X' }));
    const r = new CanvasPageResourceResolver({ getPage });
    const res = canvasPageResource('p1');
    const out = await r.resolve(res);
    expect(out.resource).toBe(res);
    expect(out.page).toEqual({ id: 'p1', title: 'X' });
    expect(getPage).toHaveBeenCalledWith('p1');
  });

  it('rejects on missing page', async () => {
    const r = new CanvasPageResourceResolver({ getPage: () => undefined });
    await expect(r.resolve(canvasPageResource('missing'))).rejects.toThrow(/not found/);
  });

  it('rejects on empty pageId', async () => {
    const r = new CanvasPageResourceResolver({ getPage: () => null });
    await expect(r.resolve(canvasPageResource(''))).rejects.toThrow(/empty/);
  });

  it('integrates with ResourceRegistry.resolveUri', async () => {
    const reg = new ResourceRegistry();
    reg.register(canvasPageResourceResolver({ getPage: async id => ({ id }) }));
    const out = await reg.resolveUri<{ page: { id: string } }>('parallx://canvas-page:p42');
    expect(out?.page.id).toBe('p42');
  });
});
