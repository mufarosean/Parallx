// resourceWorkspaceId.tier0.test.ts — Slice A32

import { describe, it, expect } from 'vitest';
import {
  resourceWorkspaceId,
  fileResource,
  canvasPageResource,
  chatSessionResource,
  toolArtifactResource,
  externalResource,
} from '../../../src/workbench/resources/resource.js';

describe('resourceWorkspaceId() (Slice A32)', () => {
  it('returns workspaceId from FileResource', () => {
    expect(resourceWorkspaceId(fileResource('/a', { workspaceId: 'w1' }))).toBe('w1');
  });

  it('returns workspaceId from CanvasPageResource', () => {
    expect(resourceWorkspaceId(canvasPageResource('p1', { workspaceId: 'w1' }))).toBe('w1');
  });

  it('returns workspaceId from ChatSessionResource', () => {
    expect(resourceWorkspaceId(chatSessionResource('s1', { workspaceId: 'w1' }))).toBe('w1');
  });

  it('returns workspaceId from ToolArtifactResource', () => {
    expect(resourceWorkspaceId(toolArtifactResource('t1', 'a1', { workspaceId: 'w1' }))).toBe('w1');
  });

  it('returns undefined for ExternalResource (no workspace scope)', () => {
    expect(resourceWorkspaceId(externalResource('https://example.com'))).toBeUndefined();
  });

  it('returns undefined when workspace-scoped variants omit workspaceId', () => {
    expect(resourceWorkspaceId(fileResource('/a'))).toBeUndefined();
    expect(resourceWorkspaceId(canvasPageResource('p1'))).toBeUndefined();
    expect(resourceWorkspaceId(chatSessionResource('s1'))).toBeUndefined();
    expect(resourceWorkspaceId(toolArtifactResource('t1', 'a1'))).toBeUndefined();
  });

  it('is suitable for filtering an array by workspace', () => {
    const items = [
      fileResource('/a', { workspaceId: 'w1' }),
      fileResource('/b', { workspaceId: 'w2' }),
      externalResource('https://example.com'),
      canvasPageResource('p1', { workspaceId: 'w1' }),
    ];
    const inW1 = items.filter(r => resourceWorkspaceId(r) === 'w1');
    expect(inW1).toHaveLength(2);
    expect(inW1.map(r => r.type)).toEqual(['file', 'canvas-page']);
  });
});
