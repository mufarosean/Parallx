import { describe, expect, it, vi } from 'vitest';
import {
  CanvasDataService,
  SaveStateKind,
  type SaveStateEvent,
} from '../../src/built-in/canvas/canvasDataService';
import type { IPage } from '../../src/built-in/canvas/canvasTypes';

class FailingSaveService extends CanvasDataService {
  override async updatePage(
    _pageId: string,
    _updates: Partial<Pick<IPage, 'title' | 'icon' | 'content' | 'coverUrl' | 'coverYOffset' | 'fontFamily' | 'fullWidth' | 'smallText' | 'isLocked' | 'isFavorited' | 'contentSchemaVersion'>>,
  ): Promise<IPage> {
    throw new Error('forced-save-failure');
  }
}

function makePage(overrides: Partial<IPage> = {}): IPage {
  return {
    id: 'p1',
    parentId: null,
    title: 'T',
    icon: null,
    content: '{"type":"doc","content":[{"type":"paragraph"}]}',
    contentSchemaVersion: 1,
    sortOrder: 1,
    isArchived: false,
    coverUrl: null,
    coverYOffset: 0.5,
    fontFamily: 'default',
    fullWidth: false,
    smallText: false,
    isLocked: false,
    isFavorited: false,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('CanvasDataService save-state observability', () => {
  it('emits pending -> flushing -> failed for debounce save failures', async () => {
    vi.useFakeTimers();
    const service = new FailingSaveService(5);
    const events: SaveStateEvent[] = [];
    const disposable = service.onDidChangeSaveState((e) => events.push(e));

    service.scheduleContentSave('p1', '{"type":"doc","content":[]}');

    await vi.advanceTimersByTimeAsync(10);
    await Promise.resolve();

    expect(events.map((e) => e.kind)).toEqual([
      SaveStateKind.Pending,
      SaveStateKind.Flushing,
      SaveStateKind.Failed,
    ]);

    disposable.dispose();
    service.dispose();
    vi.useRealTimers();
  });

  it('emits failed repair state when auto-heal write fails', async () => {
    const service = new FailingSaveService();
    const events: SaveStateEvent[] = [];
    const disposable = service.onDidChangeSaveState((e) => events.push(e));

    const result = await service.decodePageContentForEditor(
      makePage({ content: '{ invalid json', contentSchemaVersion: 0 }),
    );

    expect(result.doc.type).toBe('doc');
    expect(result.recovered).toBe(true);
    expect(events.some((e) => e.kind === SaveStateKind.Failed && e.source === 'repair')).toBe(true);

    disposable.dispose();
    service.dispose();
  });
});
