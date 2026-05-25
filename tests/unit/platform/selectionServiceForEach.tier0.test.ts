// selectionServiceForEach.tier0.test.ts — Slice A73

import { describe, it, expect, beforeEach } from 'vitest';
import { SelectionService } from '../../../src/services/selectionService.js';
import { fileResource, canvasPageResource } from '../../../src/workbench/resources/resource.js';

describe('ISelectionService.forEach (Slice A73)', () => {
  let s: SelectionService;
  beforeEach(() => {
    s = new SelectionService();
  });

  it('does not invoke cb on empty service', () => {
    let n = 0;
    s.forEach(() => {
      n++;
    });
    expect(n).toBe(0);
  });

  it('invokes cb once per entry in insertion order', () => {
    s.setSelection('s1', { resource: fileResource('/a.md', { workspaceId: 'w1' }) });
    s.setSelection('s2', { resource: canvasPageResource('p', { workspaceId: 'w1' }) });
    s.setSelection('s3', { resource: fileResource('/c.md', { workspaceId: 'w2' }) });
    const seen: string[] = [];
    s.forEach((e) => {
      seen.push(e.surfaceId);
    });
    expect(seen).toEqual(['s1', 's2', 's3']);
  });

  it('passes (surfaceId, selection) entries to cb', () => {
    const r = fileResource('/a.md', { workspaceId: 'w1' });
    s.setSelection('s1', { resource: r });
    const seen: Array<{ surfaceId: string; resource: unknown }> = [];
    s.forEach((e) => {
      seen.push({ surfaceId: e.surfaceId, resource: e.selection.resource });
    });
    expect(seen).toEqual([{ surfaceId: 's1', resource: r }]);
  });

  it('reflects clearing a surface via setSelection(undefined)', () => {
    s.setSelection('s1', { resource: fileResource('/a.md', { workspaceId: 'w1' }) });
    s.setSelection('s2', { resource: fileResource('/b.md', { workspaceId: 'w1' }) });
    s.setSelection('s1', undefined);
    const seen: string[] = [];
    s.forEach((e) => {
      seen.push(e.surfaceId);
    });
    expect(seen).toEqual(['s2']);
  });

  it('after clearAll() → no invocations', () => {
    s.setSelection('s1', { resource: fileResource('/a.md', { workspaceId: 'w1' }) });
    s.clearAll();
    let n = 0;
    s.forEach(() => {
      n++;
    });
    expect(n).toBe(0);
  });

  it('cb may throw; later iterations are not invoked', () => {
    s.setSelection('s1', { resource: fileResource('/a.md', { workspaceId: 'w1' }) });
    s.setSelection('s2', { resource: fileResource('/b.md', { workspaceId: 'w1' }) });
    s.setSelection('s3', { resource: fileResource('/c.md', { workspaceId: 'w1' }) });
    let n = 0;
    expect(() =>
      s.forEach((e) => {
        n++;
        if (e.surfaceId === 's2') throw new Error('stop');
      }),
    ).toThrow('stop');
    expect(n).toBe(2);
  });

  it('agrees with entries() over iteration', () => {
    s.setSelection('s1', { resource: fileResource('/a.md', { workspaceId: 'w1' }) });
    s.setSelection('s2', { resource: canvasPageResource('p', { workspaceId: 'w2' }) });
    const seen: Array<{ surfaceId: string; selection: unknown }> = [];
    s.forEach((e) => seen.push({ surfaceId: e.surfaceId, selection: e.selection }));
    const expected = s.entries().map((e) => ({ surfaceId: e.surfaceId, selection: e.selection }));
    expect(seen).toEqual(expected);
  });
});
