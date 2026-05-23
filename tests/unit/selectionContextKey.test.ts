/**
 * Unit test for the `selectionExists` context key (M81 Slice A).
 *
 * Verifies the key flips:
 *   - false  → true   when any surface sets a non-undefined selection
 *   - true   → false  when all surfaces clear their selection
 *   - stays  true     while at least one surface still has a selection
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { ContextKeyService } from '../../src/context/contextKey';
import { WorkbenchContextManager, CTX_SELECTION_EXISTS } from '../../src/context/workbenchContext';
import { SelectionService } from '../../src/services/selectionService';
import type { ISelection } from '../../src/services/selectionActionTypes';

function makeSelection(surfaceId: string, text: string): ISelection {
  return {
    surfaceId,
    selectedText: text,
    source: { fileName: 'a.md', filePath: '/ws/a.md' },
  };
}

describe('selectionExists context key', () => {
  let ctxService: ContextKeyService;
  let ctxManager: WorkbenchContextManager;
  let selection: SelectionService;

  beforeEach(() => {
    ctxService = new ContextKeyService();
    ctxManager = new WorkbenchContextManager(ctxService, undefined);
    selection = new SelectionService();
    ctxManager.trackSelectionService(selection);
  });

  afterEach(() => {
    selection.dispose();
    ctxManager.dispose();
    ctxService.dispose();
  });

  it('is false by default', () => {
    expect(ctxService.getContextValue(CTX_SELECTION_EXISTS)).toBe(false);
  });

  it('flips to true when a surface sets a selection', () => {
    selection.setSelection('editor', makeSelection('editor', 'hello'));
    expect(ctxService.getContextValue(CTX_SELECTION_EXISTS)).toBe(true);
  });

  it('stays true while a second surface also has a selection', () => {
    selection.setSelection('editor', makeSelection('editor', 'A'));
    selection.setSelection('pdf', makeSelection('pdf', 'B'));
    expect(ctxService.getContextValue(CTX_SELECTION_EXISTS)).toBe(true);
  });

  it('stays true when one of two surfaces clears', () => {
    selection.setSelection('editor', makeSelection('editor', 'A'));
    selection.setSelection('pdf', makeSelection('pdf', 'B'));
    selection.setSelection('pdf', undefined);
    expect(ctxService.getContextValue(CTX_SELECTION_EXISTS)).toBe(true);
  });

  it('flips back to false when all surfaces clear', () => {
    selection.setSelection('editor', makeSelection('editor', 'A'));
    selection.setSelection('pdf', makeSelection('pdf', 'B'));
    expect(ctxService.getContextValue(CTX_SELECTION_EXISTS)).toBe(true);

    selection.setSelection('editor', undefined);
    selection.setSelection('pdf', undefined);
    expect(ctxService.getContextValue(CTX_SELECTION_EXISTS)).toBe(false);
  });
});
