// selectionResourceAutoPopulate.tier0.test.ts — Slice A7
//
// SelectionService.setSelection auto-populates `selection.resource` from
// `selection.source.filePath` when the caller didn't supply one.

import { describe, it, expect } from 'vitest';
import { SelectionService } from '../../../src/services/selectionService.js';
import type { ISelection } from '../../../src/services/selectionActionTypes.js';
import type { Resource } from '../../../src/workbench/resources/resource.js';

function selection(filePath: string, withResource?: Resource): ISelection {
  return {
    surfaceId: 'editor',
    selectedText: 'hello',
    source: {
      fileName: filePath.split('/').pop() ?? filePath,
      filePath,
    },
    ...(withResource ? { resource: withResource } : {}),
  };
}

describe('SelectionService — Slice A7 auto-populate selection.resource', () => {
  it('derives a FileResource from source.filePath when resource is omitted', () => {
    const svc = new SelectionService();
    svc.setSelection('editor', selection('/notes/a.md'));
    const got = svc.getSelection('editor');
    expect(got?.resource).toBeDefined();
    expect(got?.resource?.type).toBe('file');
    if (got?.resource?.type === 'file') {
      expect(got.resource.path).toBe('/notes/a.md');
    }
  });

  it('preserves an explicitly-supplied resource', () => {
    const svc = new SelectionService();
    const explicit: Resource = { type: 'tool-artifact', artifactId: 'A1' };
    svc.setSelection('editor', selection('/notes/a.md', explicit));
    expect(svc.getSelection('editor')?.resource).toBe(explicit);
  });

  it('leaves resource undefined when filePath is empty', () => {
    const svc = new SelectionService();
    svc.setSelection('editor', selection(''));
    expect(svc.getSelection('editor')?.resource).toBeUndefined();
  });

  it('emits the enriched selection to subscribers', () => {
    const svc = new SelectionService();
    let last: ISelection | undefined;
    svc.onDidChangeSelection(e => { last = e.selection; });
    svc.setSelection('editor', selection('/x.md'));
    expect(last?.resource?.type).toBe('file');
  });

  it('clearing a selection still works', () => {
    const svc = new SelectionService();
    svc.setSelection('editor', selection('/x.md'));
    svc.setSelection('editor', undefined);
    expect(svc.getSelection('editor')).toBeUndefined();
  });
});
