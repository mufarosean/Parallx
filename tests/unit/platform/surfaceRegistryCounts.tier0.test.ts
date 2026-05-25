// surfaceRegistryCounts.tier0.test.ts — Slice A46

import { describe, it, expect, beforeEach } from 'vitest';
import { SurfaceRegistry } from '../../../src/workbench/resources/surfaceRegistry.js';
import { surface } from '../../../src/workbench/resources/surface.js';
import { fileResource, externalResource } from '../../../src/workbench/resources/resource.js';

describe('ISurfaceRegistry.countByKind / countByWorkspace (Slice A46)', () => {
  let r: SurfaceRegistry;
  beforeEach(() => {
    r = new SurfaceRegistry();
  });

  it('returns 0 on empty registry', () => {
    expect(r.countByKind('editor')).toBe(0);
    expect(r.countByWorkspace('w1')).toBe(0);
  });

  it('counts by kind', () => {
    r.register(surface('a', 'editor', 'A'));
    r.register(surface('b', 'editor', 'B'));
    r.register(surface('c', 'view', 'C'));
    expect(r.countByKind('editor')).toBe(2);
    expect(r.countByKind('view')).toBe(1);
    expect(r.countByKind('chat')).toBe(0);
  });

  it('counts by workspaceId', () => {
    r.register(surface('a', 'editor', 'A', fileResource('/a.md', { workspaceId: 'w1' })));
    r.register(surface('b', 'editor', 'B', fileResource('/b.md', { workspaceId: 'w1' })));
    r.register(surface('c', 'editor', 'C', fileResource('/c.md', { workspaceId: 'w2' })));
    expect(r.countByWorkspace('w1')).toBe(2);
    expect(r.countByWorkspace('w2')).toBe(1);
    expect(r.countByWorkspace('wx')).toBe(0);
  });

  it('skips surfaces with no resource', () => {
    r.register(surface('a', 'editor', 'A'));
    r.register(surface('b', 'editor', 'B', fileResource('/b.md', { workspaceId: 'w1' })));
    expect(r.countByWorkspace('w1')).toBe(1);
  });

  it('skips external resources for countByWorkspace', () => {
    r.register(surface('a', 'editor', 'A', externalResource('https://example.com')));
    r.register(surface('b', 'editor', 'B', fileResource('/b.md', { workspaceId: 'w1' })));
    expect(r.countByWorkspace('w1')).toBe(1);
  });

  it('empty arg returns 0', () => {
    r.register(surface('a', 'editor', 'A', fileResource('/a.md', { workspaceId: 'w1' })));
    expect(r.countByKind('' as never)).toBe(0);
    expect(r.countByWorkspace('')).toBe(0);
  });

  it('matches listByKind(kind).length and listByWorkspace(id).length', () => {
    r.register(surface('a', 'editor', 'A', fileResource('/a.md', { workspaceId: 'w1' })));
    r.register(surface('b', 'view', 'B', fileResource('/b.md', { workspaceId: 'w1' })));
    expect(r.countByKind('editor')).toBe(r.listByKind('editor').length);
    expect(r.countByKind('view')).toBe(r.listByKind('view').length);
    expect(r.countByWorkspace('w1')).toBe(r.listByWorkspace('w1').length);
  });
});
