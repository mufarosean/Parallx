import { describe, expect, it } from 'vitest';
import { doesPageChangeAffectSidebar, PageChangeKind, type PageChangeEvent } from '../../src/built-in/canvas/canvasTypes';

describe('doesPageChangeAffectSidebar', () => {
  it('ignores content-only page updates', () => {
    const event: PageChangeEvent = {
      kind: PageChangeKind.Updated,
      pageId: 'page-1',
      changedFields: ['content', 'contentSchemaVersion'],
    };

    expect(doesPageChangeAffectSidebar(event)).toBe(false);
  });

  it('refreshes when sidebar-visible metadata changes', () => {
    const event: PageChangeEvent = {
      kind: PageChangeKind.Updated,
      pageId: 'page-1',
      changedFields: ['title'],
    };

    expect(doesPageChangeAffectSidebar(event)).toBe(true);
  });

  it('refreshes when change metadata is unavailable', () => {
    const event: PageChangeEvent = {
      kind: PageChangeKind.Updated,
      pageId: 'page-1',
    };

    expect(doesPageChangeAffectSidebar(event)).toBe(true);
  });

  it('refreshes for non-update events', () => {
    const event: PageChangeEvent = {
      kind: PageChangeKind.Moved,
      pageId: 'page-1',
    };

    expect(doesPageChangeAffectSidebar(event)).toBe(true);
  });
});