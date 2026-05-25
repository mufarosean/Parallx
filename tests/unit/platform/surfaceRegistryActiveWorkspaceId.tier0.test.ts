// surfaceRegistryActiveWorkspaceId.tier0.test.ts — Slice A56

import { describe, it, expect, beforeEach } from 'vitest';
import { SurfaceRegistry } from '../../../src/workbench/resources/surfaceRegistry.js';
import { fileResource } from '../../../src/workbench/resources/resource.js';

describe('ISurfaceRegistry.activeWorkspaceId (Slice A56)', () => {
  let r: SurfaceRegistry;
  beforeEach(() => {
    r = new SurfaceRegistry();
  });

  it('returns undefined when no surface is active', () => {
    expect(r.activeWorkspaceId()).toBeUndefined();
  });

  it('returns undefined when active surface has no resource', () => {
    r.register({ id: 's1', kind: 'editor' });
    r.setActive('s1');
    expect(r.activeWorkspaceId()).toBeUndefined();
  });

  it('returns the workspace id of the active resource', () => {
    r.register({ id: 's1', kind: 'editor', resource: fileResource('/a.md', { workspaceId: 'w1' }) });
    r.setActive('s1');
    expect(r.activeWorkspaceId()).toBe('w1');
  });

  it('updates when active surface changes', () => {
    r.register({ id: 's1', kind: 'editor', resource: fileResource('/a.md', { workspaceId: 'w1' }) });
    r.register({ id: 's2', kind: 'editor', resource: fileResource('/b.md', { workspaceId: 'w2' }) });
    r.setActive('s1');
    expect(r.activeWorkspaceId()).toBe('w1');
    r.setActive('s2');
    expect(r.activeWorkspaceId()).toBe('w2');
  });

  it('returns undefined after active is cleared', () => {
    r.register({ id: 's1', kind: 'editor', resource: fileResource('/a.md', { workspaceId: 'w1' }) });
    r.setActive('s1');
    r.setActive(undefined);
    expect(r.activeWorkspaceId()).toBeUndefined();
  });

  it('returns undefined for resources without workspace scope', () => {
    // resource without workspaceId metadata
    const noWs = fileResource('/a.md');
    r.register({ id: 's1', kind: 'editor', resource: noWs });
    r.setActive('s1');
    expect(r.activeWorkspaceId()).toBeUndefined();
  });

  it('agrees with manual resourceWorkspaceId(activeResource())', async () => {
    const { resourceWorkspaceId } = await import('../../../src/workbench/resources/resource.js');
    r.register({ id: 's1', kind: 'editor', resource: fileResource('/a.md', { workspaceId: 'w1' }) });
    r.setActive('s1');
    const ar = r.activeResource();
    expect(r.activeWorkspaceId()).toBe(ar ? resourceWorkspaceId(ar) : undefined);
  });
});
