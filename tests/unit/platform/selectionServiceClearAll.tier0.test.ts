// selectionServiceClearAll.tier0.test.ts — Slice A29

import { describe, it, expect, beforeEach } from 'vitest';
import { SelectionService } from '../../../src/services/selectionService.js';
import type { ISelection, ISelectionChangeEvent } from '../../../src/services/serviceTypes.js';

const sel = (filePath: string): ISelection => ({ kind: 'text', source: { filePath } });

describe('ISelectionService.clearAll() (Slice A29)', () => {
  let svc: SelectionService;
  let events: ISelectionChangeEvent[];

  beforeEach(() => {
    svc = new SelectionService();
    events = [];
    svc.onDidChangeSelection(e => events.push(e));
  });

  it('returns empty array and fires no events when nothing is selected', () => {
    const cleared = svc.clearAll();
    expect(cleared).toEqual([]);
    expect(events).toEqual([]);
  });

  it('clears every surface and returns ids in insertion order', () => {
    svc.setSelection('s1', sel('/a'));
    svc.setSelection('s2', sel('/b'));
    svc.setSelection('s3', sel('/c'));
    events.length = 0;
    const cleared = svc.clearAll();
    expect(cleared).toEqual(['s1', 's2', 's3']);
    expect(svc.hasAnySelection()).toBe(false);
    expect(svc.surfaceIds()).toEqual([]);
  });

  it('fires one event per cleared surface with selection=undefined and prior previous', () => {
    const a = sel('/a');
    const b = sel('/b');
    svc.setSelection('s1', a);
    svc.setSelection('s2', b);
    events.length = 0;
    svc.clearAll();
    expect(events).toHaveLength(2);
    expect(events[0].surfaceId).toBe('s1');
    expect(events[0].selection).toBeUndefined();
    expect(events[0].previous?.source.filePath).toBe('/a');
    expect(events[1].surfaceId).toBe('s2');
    expect(events[1].selection).toBeUndefined();
    expect(events[1].previous?.source.filePath).toBe('/b');
  });

  it('resets mostRecentSurfaceId so getSelection() returns undefined', () => {
    svc.setSelection('s1', sel('/a'));
    svc.setSelection('s2', sel('/b'));
    svc.clearAll();
    expect(svc.getSelection()).toBeUndefined();
  });

  it('returns a snapshot (mutating result does not affect service)', () => {
    svc.setSelection('s1', sel('/a'));
    const cleared = svc.clearAll() as string[];
    cleared.push('forged');
    svc.setSelection('s2', sel('/b'));
    expect(svc.surfaceIds()).toEqual(['s2']);
  });

  it('leaves the service usable after clearAll', () => {
    svc.setSelection('s1', sel('/a'));
    svc.clearAll();
    svc.setSelection('s2', sel('/b'));
    expect(svc.hasAnySelection()).toBe(true);
    expect(svc.surfaceIds()).toEqual(['s2']);
    expect(svc.getSelection()?.source.filePath).toBe('/b');
  });

  it('is idempotent — second call returns empty and fires no events', () => {
    svc.setSelection('s1', sel('/a'));
    svc.clearAll();
    events.length = 0;
    const cleared = svc.clearAll();
    expect(cleared).toEqual([]);
    expect(events).toEqual([]);
  });
});
