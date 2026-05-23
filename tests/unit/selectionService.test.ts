/**
 * Unit tests for SelectionService (M81 Slice A).
 *
 * Verifies state-shaped "current selection changed" broadcast:
 *  - per-surface set/get
 *  - most-recently-set lookup when no surfaceId is provided
 *  - event payload (current + previous)
 *  - multi-subscriber fan-out
 *  - subscriber disposal stops further notifications
 *  - service disposal clears state and stops events
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { SelectionService } from '../../src/services/selectionService';
import type { ISelection } from '../../src/services/selectionActionTypes';
import type { ISelectionChangeEvent } from '../../src/services/serviceTypes';

function makeSelection(surfaceId: string, text: string, file = 'a.md'): ISelection {
  return {
    surfaceId,
    selectedText: text,
    source: { fileName: file, filePath: `/ws/${file}` },
  };
}

describe('SelectionService', () => {
  let svc: SelectionService;

  beforeEach(() => {
    svc = new SelectionService();
  });

  afterEach(() => {
    svc.dispose();
  });

  it('fires onDidChangeSelection with the new payload and undefined previous', () => {
    const events: ISelectionChangeEvent[] = [];
    svc.onDidChangeSelection((e) => events.push(e));

    const sel = makeSelection('editor', 'hello');
    svc.setSelection('editor', sel);

    expect(events).toHaveLength(1);
    expect(events[0].surfaceId).toBe('editor');
    expect(events[0].selection).toBe(sel);
    expect(events[0].previous).toBeUndefined();
  });

  it('reports `previous` on a subsequent change for the same surface', () => {
    const events: ISelectionChangeEvent[] = [];
    svc.onDidChangeSelection((e) => events.push(e));

    const first = makeSelection('editor', 'one');
    const second = makeSelection('editor', 'two');
    svc.setSelection('editor', first);
    svc.setSelection('editor', second);

    expect(events).toHaveLength(2);
    expect(events[1].selection).toBe(second);
    expect(events[1].previous).toBe(first);
  });

  it('skips no-op identical-reference writes', () => {
    const events: ISelectionChangeEvent[] = [];
    svc.onDidChangeSelection((e) => events.push(e));

    const sel = makeSelection('editor', 'hello');
    svc.setSelection('editor', sel);
    svc.setSelection('editor', sel);

    expect(events).toHaveLength(1);
  });

  it('clearing an empty surface is a no-op', () => {
    const events: ISelectionChangeEvent[] = [];
    svc.onDidChangeSelection((e) => events.push(e));

    svc.setSelection('editor', undefined);

    expect(events).toHaveLength(0);
  });

  it('getSelection(surfaceId) returns the per-surface current selection', () => {
    const a = makeSelection('editor', 'A', 'a.md');
    const b = makeSelection('pdf', 'B', 'b.pdf');

    svc.setSelection('editor', a);
    svc.setSelection('pdf', b);

    expect(svc.getSelection('editor')).toBe(a);
    expect(svc.getSelection('pdf')).toBe(b);
    expect(svc.getSelection('canvas')).toBeUndefined();
  });

  it('getSelection() with no arg returns the most-recently-set selection', () => {
    const a = makeSelection('editor', 'A');
    const b = makeSelection('pdf', 'B');

    svc.setSelection('editor', a);
    expect(svc.getSelection()).toBe(a);

    svc.setSelection('pdf', b);
    expect(svc.getSelection()).toBe(b);

    // Updating the older surface makes it most-recent again
    const a2 = makeSelection('editor', 'A2');
    svc.setSelection('editor', a2);
    expect(svc.getSelection()).toBe(a2);
  });

  it('clearing the most-recent surface falls back to a remaining surface', () => {
    const a = makeSelection('editor', 'A');
    const b = makeSelection('pdf', 'B');

    svc.setSelection('editor', a);
    svc.setSelection('pdf', b);
    svc.setSelection('pdf', undefined);

    expect(svc.getSelection('pdf')).toBeUndefined();
    expect(svc.getSelection()).toBe(a);
    expect(svc.hasAnySelection()).toBe(true);
  });

  it('clearing the only remaining surface leaves getSelection() undefined', () => {
    const a = makeSelection('editor', 'A');
    svc.setSelection('editor', a);
    svc.setSelection('editor', undefined);

    expect(svc.getSelection()).toBeUndefined();
    expect(svc.getSelection('editor')).toBeUndefined();
    expect(svc.hasAnySelection()).toBe(false);
  });

  it('fans out events to multiple subscribers', () => {
    const a = vi.fn();
    const b = vi.fn();
    const c = vi.fn();
    svc.onDidChangeSelection(a);
    svc.onDidChangeSelection(b);
    svc.onDidChangeSelection(c);

    svc.setSelection('editor', makeSelection('editor', 'x'));

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(c).toHaveBeenCalledTimes(1);
  });

  it('disposing a subscriber stops further notifications to it', () => {
    const a = vi.fn();
    const b = vi.fn();
    const aSub = svc.onDidChangeSelection(a);
    svc.onDidChangeSelection(b);

    svc.setSelection('editor', makeSelection('editor', '1'));
    aSub.dispose();
    svc.setSelection('editor', makeSelection('editor', '2'));

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
  });

  it('dispose() clears state and stops events', () => {
    const listener = vi.fn();
    svc.onDidChangeSelection(listener);
    svc.setSelection('editor', makeSelection('editor', 'x'));
    expect(svc.hasAnySelection()).toBe(true);

    svc.dispose();

    expect(svc.hasAnySelection()).toBe(false);
    expect(svc.getSelection('editor')).toBeUndefined();
    expect(svc.getSelection()).toBeUndefined();

    // Post-dispose setSelection is a no-op and does not throw
    svc.setSelection('editor', makeSelection('editor', 'y'));
    expect(listener).toHaveBeenCalledTimes(1); // only the pre-dispose call
    expect(svc.hasAnySelection()).toBe(false);
  });
});
