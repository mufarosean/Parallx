// selectionServiceIntrospection.tier0.test.ts — Slice A19

import { describe, it, expect } from 'vitest';
import { SelectionService } from '../../../src/services/selectionService.js';
import type { ISelection } from '../../../src/services/selectionActionTypes.js';

function sel(filePath: string, text: string = 'x'): ISelection {
  return { text, source: { filePath } } as ISelection;
}

describe('SelectionService introspection (Slice A19)', () => {
  it('surfaceIds() returns [] when empty', () => {
    const s = new SelectionService();
    expect(s.surfaceIds()).toEqual([]);
    expect(s.entries()).toEqual([]);
  });

  it('surfaceIds() lists every surface with a selection', () => {
    const s = new SelectionService();
    s.setSelection('a', sel('/a.md'));
    s.setSelection('b', sel('/b.md'));
    expect(s.surfaceIds()).toEqual(['a', 'b']);
  });

  it('preserves insertion order across re-writes to the same surface', () => {
    const s = new SelectionService();
    s.setSelection('a', sel('/a.md'));
    s.setSelection('b', sel('/b.md'));
    s.setSelection('a', sel('/a2.md')); // re-write should not move 'a' to end
    expect(s.surfaceIds()).toEqual(['a', 'b']);
  });

  it('drops a surface from surfaceIds() after clearing its selection', () => {
    const s = new SelectionService();
    s.setSelection('a', sel('/a.md'));
    s.setSelection('b', sel('/b.md'));
    s.setSelection('a', undefined);
    expect(s.surfaceIds()).toEqual(['b']);
  });

  it('entries() returns (surfaceId, selection) pairs in insertion order', () => {
    const s = new SelectionService();
    const sa = sel('/a.md');
    const sb = sel('/b.md');
    s.setSelection('a', sa);
    s.setSelection('b', sb);
    const e = s.entries();
    expect(e.length).toBe(2);
    expect(e[0].surfaceId).toBe('a');
    expect(e[1].surfaceId).toBe('b');
    expect(e[0].selection.text).toBe('x');
  });

  it('returns fresh snapshots independent of later mutations', () => {
    const s = new SelectionService();
    s.setSelection('a', sel('/a.md'));
    const ids = s.surfaceIds();
    const ents = s.entries();
    s.setSelection('b', sel('/b.md'));
    expect(ids).toEqual(['a']);
    expect(ents.length).toBe(1);
  });

  it('entries() carries the auto-populated resource (A7 derivation)', () => {
    const s = new SelectionService();
    s.setSelection('a', sel('/a.md'));
    const e = s.entries();
    expect(e[0].selection.resource).toBeDefined();
    expect(e[0].selection.resource?.type).toBe('file');
  });

  it('hasAnySelection() agrees with surfaceIds()/entries()', () => {
    const s = new SelectionService();
    expect(s.hasAnySelection()).toBe(false);
    s.setSelection('a', sel('/a.md'));
    expect(s.hasAnySelection()).toBe(true);
    expect(s.surfaceIds().length).toBe(1);
    expect(s.entries().length).toBe(1);
    s.setSelection('a', undefined);
    expect(s.hasAnySelection()).toBe(false);
    expect(s.surfaceIds().length).toBe(0);
    expect(s.entries().length).toBe(0);
  });
});
