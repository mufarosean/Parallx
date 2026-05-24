/**
 * Pin-the-invariant: SelectionService state-shaped event broadcast (M81 Slice A).
 *
 * SelectionService tracks per-surface selection and fires `onDidChangeSelection`
 * whenever a surface's selection differs from its prior value. The audit's
 * Slice A rescope made this service purely ADDITIVE alongside the existing
 * action-shaped `SelectionActionDispatcher` — these tests pin the state
 * semantics so a future refactor cannot silently break event consumers
 * (context keys, when-clause subscribers, future surfaces).
 *
 * See src/services/selectionService.ts and docs/Parallx_Milestone_81.md §4.
 */

import { describe, expect, it } from 'vitest';
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

describe('SelectionService event broadcast (M81 Slice A)', () => {
  it('fires onDidChangeSelection on first setSelection with previous=undefined', () => {
    const svc = new SelectionService();
    const events: ISelectionChangeEvent[] = [];
    svc.onDidChangeSelection(e => events.push(e));

    const sel = makeSelection('editor', 'hello');
    svc.setSelection('editor', sel);

    expect(events).toHaveLength(1);
    expect(events[0].surfaceId).toBe('editor');
    expect(events[0].selection).toBe(sel);
    expect(events[0].previous).toBeUndefined();
    svc.dispose();
  });

  it('does NOT fire on identity-equal repeat setSelection (reference check)', () => {
    const svc = new SelectionService();
    const sel = makeSelection('editor', 'x');
    svc.setSelection('editor', sel);

    const events: ISelectionChangeEvent[] = [];
    svc.onDidChangeSelection(e => events.push(e));

    svc.setSelection('editor', sel); // same reference
    expect(events).toHaveLength(0);
    svc.dispose();
  });

  it('fires on a different selection object even with the same text content (no deep compare)', () => {
    const svc = new SelectionService();
    svc.setSelection('editor', makeSelection('editor', 'same'));

    const events: ISelectionChangeEvent[] = [];
    svc.onDidChangeSelection(e => events.push(e));

    svc.setSelection('editor', makeSelection('editor', 'same'));
    expect(events).toHaveLength(1);
    svc.dispose();
  });

  it('clearing an unset surface is a no-op (no event)', () => {
    const svc = new SelectionService();
    const events: ISelectionChangeEvent[] = [];
    svc.onDidChangeSelection(e => events.push(e));

    svc.setSelection('editor', undefined);
    expect(events).toHaveLength(0);
    svc.dispose();
  });

  it('clearing a previously-set surface fires with selection=undefined and previous=prior', () => {
    const svc = new SelectionService();
    const sel = makeSelection('editor', 'x');
    svc.setSelection('editor', sel);

    const events: ISelectionChangeEvent[] = [];
    svc.onDidChangeSelection(e => events.push(e));

    svc.setSelection('editor', undefined);
    expect(events).toHaveLength(1);
    expect(events[0].selection).toBeUndefined();
    expect(events[0].previous).toBe(sel);
    svc.dispose();
  });

  it('getSelection() without surfaceId returns most-recent surface selection', () => {
    const svc = new SelectionService();
    const a = makeSelection('editor', 'A');
    const b = makeSelection('pdf', 'B');
    svc.setSelection('editor', a);
    svc.setSelection('pdf', b);

    expect(svc.getSelection()).toBe(b);
    expect(svc.getSelection('editor')).toBe(a);
    expect(svc.getSelection('pdf')).toBe(b);
    svc.dispose();
  });

  it('clearing most-recent surface falls back to another surface that still has a selection', () => {
    const svc = new SelectionService();
    const a = makeSelection('editor', 'A');
    const b = makeSelection('pdf', 'B');
    svc.setSelection('editor', a);
    svc.setSelection('pdf', b);

    svc.setSelection('pdf', undefined);
    expect(svc.getSelection()).toBe(a);
    expect(svc.hasAnySelection()).toBe(true);
    svc.dispose();
  });

  it('clearing the last remaining selection drops mostRecent to undefined', () => {
    const svc = new SelectionService();
    svc.setSelection('editor', makeSelection('editor', 'A'));
    svc.setSelection('editor', undefined);

    expect(svc.getSelection()).toBeUndefined();
    expect(svc.hasAnySelection()).toBe(false);
    svc.dispose();
  });

  it('after dispose, setSelection is a no-op and no events fire', () => {
    const svc = new SelectionService();
    const events: ISelectionChangeEvent[] = [];
    svc.onDidChangeSelection(e => events.push(e));

    svc.dispose();
    svc.setSelection('editor', makeSelection('editor', 'late'));

    expect(events).toHaveLength(0);
    expect(svc.getSelection('editor')).toBeUndefined();
  });
});
