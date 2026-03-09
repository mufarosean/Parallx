import { describe, expect, it, vi } from 'vitest';

import { buildChatTokenBarServices } from '../../src/built-in/chat/utilities/chatTokenBarAdapter';

describe('chat token bar adapter', () => {
  it('delegates token bar queries', async () => {
    const session = { id: 'session-1' };
    const widget = { getSession: () => session };

    const services = buildChatTokenBarServices({
      getActiveWidget: () => widget as any,
      getContextLength: vi.fn().mockResolvedValue(128_000),
      getMode: vi.fn(() => 'agent' as any),
      getWorkspaceName: vi.fn(() => 'Parallx'),
      getPageCount: vi.fn().mockResolvedValue(42),
      getCurrentPageTitle: vi.fn(() => 'Current Page'),
      getToolDefinitions: vi.fn(() => [{ name: 'search' }] as any),
      getFileCount: vi.fn().mockResolvedValue(17),
      isRAGAvailable: vi.fn(() => true),
      isIndexing: vi.fn(() => false),
      getIndexingProgress: vi.fn(() => ({ phase: 'idle', processed: 0, total: 0 })),
      getIndexStats: vi.fn(() => ({ pages: 42, files: 17 })),
    });

    expect(services.getActiveSession()).toBe(session);
    await expect(services.getContextLength()).resolves.toBe(128_000);
    expect(services.getMode()).toBe('agent');
    expect(services.getWorkspaceName()).toBe('Parallx');
    await expect(services.getPageCount()).resolves.toBe(42);
    expect(services.getCurrentPageTitle()).toBe('Current Page');
    expect(services.getToolDefinitions()).toEqual([{ name: 'search' }]);
    await expect(services.getFileCount()).resolves.toBe(17);
    expect(services.isRAGAvailable()).toBe(true);
    expect(services.isIndexing()).toBe(false);
    expect(services.getIndexingProgress?.()).toEqual({ phase: 'idle', processed: 0, total: 0 });
    expect(services.getIndexStats?.()).toEqual({ pages: 42, files: 17 });
  });

  it('returns undefined active session without an active widget', () => {
    const services = buildChatTokenBarServices({
      getActiveWidget: () => undefined,
      getContextLength: vi.fn().mockResolvedValue(0),
      getMode: vi.fn(() => 'agent' as any),
      getWorkspaceName: vi.fn(() => 'Parallx'),
      getPageCount: vi.fn().mockResolvedValue(0),
      getCurrentPageTitle: vi.fn(() => undefined),
      getToolDefinitions: vi.fn(() => []),
      getFileCount: vi.fn().mockResolvedValue(0),
      isRAGAvailable: vi.fn(() => false),
      isIndexing: vi.fn(() => false),
      getIndexingProgress: vi.fn(() => ({ phase: 'idle', processed: 0, total: 0 })),
      getIndexStats: vi.fn(() => undefined),
    });

    expect(services.getActiveSession()).toBeUndefined();
  });
});