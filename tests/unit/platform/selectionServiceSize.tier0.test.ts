// selectionServiceSize.tier0.test.ts — Slice A42

import { describe, it, expect, beforeEach } from 'vitest';
import { SelectionService } from '../../../src/services/selectionService.js';
import type { ISelection } from '../../../src/services/selectionActionTypes.js';
import { fileResource } from '../../../src/workbench/resources/resource.js';

const sel = (workspaceId?: string): ISelection => ({
  source: { kind: 'text', filePath: '/x' },
  text: 'x',
  resource: workspaceId ? fileResource('/x', { workspaceId }) : undefined,
});

describe('ISelectionService.size (Slice A42)', () => {
  let svc: SelectionService;
  beforeEach(() => {
    svc = new SelectionService();
  });

  it('is 0 on empty service', () => {
    expect(svc.size).toBe(0);
  });

  it('increments on setSelection of new surface', () => {
    svc.setSelection('s1', sel('w1'));
    expect(svc.size).toBe(1);
    svc.setSelection('s2', sel('w1'));
    expect(svc.size).toBe(2);
  });

  it('does not change when setting selection on existing surface', () => {
    svc.setSelection('s1', sel('w1'));
    svc.setSelection('s1', sel('w2'));
    expect(svc.size).toBe(1);
  });

  it('decrements when clearing a surface (undefined)', () => {
    svc.setSelection('s1', sel('w1'));
    svc.setSelection('s2', sel('w1'));
    svc.setSelection('s1', undefined);
    expect(svc.size).toBe(1);
  });

  it('returns to 0 after clearAll()', () => {
    svc.setSelection('s1', sel('w1'));
    svc.setSelection('s2', sel('w2'));
    svc.clearAll();
    expect(svc.size).toBe(0);
  });

  it('matches entries().length', () => {
    svc.setSelection('s1', sel('w1'));
    svc.setSelection('s2', sel('w2'));
    svc.setSelection('s3', sel('w1'));
    expect(svc.size).toBe(svc.entries().length);
  });
});
