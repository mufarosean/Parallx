// resourceFromSelectionSource.tier0.test.ts — Slice A5 verification

import { describe, it, expect } from 'vitest';
import { resourceFromSelectionSource } from '../../../../src/workbench/resources/resource.js';

describe('resourceFromSelectionSource', () => {
  it('returns a FileResource for a plain filePath', () => {
    const r = resourceFromSelectionSource({ filePath: '/tmp/a.md' });
    expect(r).toEqual({ type: 'file', path: '/tmp/a.md', hash: undefined, workspaceId: undefined });
  });

  it('propagates workspaceId', () => {
    const r = resourceFromSelectionSource({ filePath: '/x.md', workspaceId: 'w1' });
    expect(r).toEqual({ type: 'file', path: '/x.md', hash: undefined, workspaceId: 'w1' });
  });

  it('returns undefined when filePath is missing', () => {
    expect(resourceFromSelectionSource({})).toBeUndefined();
  });

  it('returns undefined when filePath is empty string', () => {
    expect(resourceFromSelectionSource({ filePath: '' })).toBeUndefined();
  });

  it('returns undefined for non-string filePath', () => {
    expect(resourceFromSelectionSource({ filePath: 123 as unknown as string })).toBeUndefined();
  });

  it('ignores pageNumber (PDF page) for now — file identity is the path', () => {
    const r = resourceFromSelectionSource({ filePath: '/x.pdf', pageNumber: 7 });
    expect(r?.type).toBe('file');
    if (r?.type === 'file') expect(r.path).toBe('/x.pdf');
  });
});
