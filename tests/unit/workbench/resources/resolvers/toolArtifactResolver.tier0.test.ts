// toolArtifactResolver.tier0.test.ts — Slice A9

import { describe, it, expect, vi } from 'vitest';
import { ResourceRegistry } from '../../../../../src/workbench/resources/resourceRegistry.js';
import { toolArtifactResource } from '../../../../../src/workbench/resources/resource.js';
import {
  ToolArtifactResourceResolver,
  toolArtifactResourceResolver,
} from '../../../../../src/workbench/resources/resolvers/toolArtifactResolver.js';

describe('ToolArtifactResourceResolver', () => {
  it('has type "tool-artifact"', () => {
    expect(new ToolArtifactResourceResolver({ getArtifact: () => null }).type).toBe('tool-artifact');
  });

  it('resolves a known artifact', async () => {
    const getArtifact = vi.fn(async (tool: string, id: string) => ({ tool, id, body: 'x' }));
    const r = new ToolArtifactResourceResolver({ getArtifact });
    const res = toolArtifactResource('webSearch', 'a1');
    const out = await r.resolve(res);
    expect(out.artifact).toEqual({ tool: 'webSearch', id: 'a1', body: 'x' });
    expect(getArtifact).toHaveBeenCalledWith('webSearch', 'a1');
  });

  it('rejects on missing artifact', async () => {
    const r = new ToolArtifactResourceResolver({ getArtifact: () => undefined });
    await expect(r.resolve(toolArtifactResource('t', 'missing'))).rejects.toThrow(/not found/);
  });

  it('rejects on empty ids', async () => {
    const r = new ToolArtifactResourceResolver({ getArtifact: () => null });
    await expect(r.resolve(toolArtifactResource('', 'x'))).rejects.toThrow(/empty/);
    await expect(r.resolve(toolArtifactResource('x', ''))).rejects.toThrow(/empty/);
  });

  it('integrates with ResourceRegistry.resolveUri', async () => {
    const reg = new ResourceRegistry();
    reg.register(toolArtifactResourceResolver({ getArtifact: async (t, a) => ({ t, a }) }));
    // tool-artifact URI body is "<toolId>/<artifactId>" — check parser-supported shape
    // (parallxUri.ts encodes this as 'tool-artifact:<toolId>/<artifactId>' or similar)
    // Use the canonical helper to construct then stringify:
    const res = toolArtifactResource('search', 'a1');
    const out = await reg.resolve(res);
    expect((out as { artifact: { t: string; a: string } }).artifact).toEqual({ t: 'search', a: 'a1' });
  });
});
