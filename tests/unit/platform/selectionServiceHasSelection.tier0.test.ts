// selectionServiceHasSelection.tier0.test.ts — Slice A25

import { describe, it, expect } from 'vitest';
import { SelectionService } from '../../../src/services/selectionService.js';
import type { ISelection } from '../../../src/services/selectionActionTypes.js';

const sel = (text: string): ISelection => ({
  source: { kind: 'editor', filePath: '/x.md' } as any,
  text,
} as ISelection);

describe('ISelectionService.hasSelection (Slice A25)', () => {
  it('returns false on empty service', () => {
    const s = new SelectionService();
    expect(s.hasSelection('any')).toBe(false);
  });

  it('returns true after setSelection', () => {
    const s = new SelectionService();
    s.setSelection('s1', sel('hello'));
    expect(s.hasSelection('s1')).toBe(true);
  });

  it('returns false for surfaces with no selection', () => {
    const s = new SelectionService();
    s.setSelection('s1', sel('hello'));
    expect(s.hasSelection('s2')).toBe(false);
  });

  it('returns false after clearing with undefined', () => {
    const s = new SelectionService();
    s.setSelection('s1', sel('hello'));
    s.setSelection('s1', undefined);
    expect(s.hasSelection('s1')).toBe(false);
  });

  it('does not affect other surfaces', () => {
    const s = new SelectionService();
    s.setSelection('s1', sel('a'));
    s.setSelection('s2', sel('b'));
    s.setSelection('s1', undefined);
    expect(s.hasSelection('s1')).toBe(false);
    expect(s.hasSelection('s2')).toBe(true);
  });

  it('agrees with surfaceIds()', () => {
    const s = new SelectionService();
    s.setSelection('s1', sel('a'));
    s.setSelection('s2', sel('b'));
    for (const id of s.surfaceIds()) {
      expect(s.hasSelection(id)).toBe(true);
    }
  });
});
