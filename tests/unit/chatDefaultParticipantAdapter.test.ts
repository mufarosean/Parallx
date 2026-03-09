import { describe, expect, it, vi } from 'vitest';

import { buildChatDefaultParticipantServices } from '../../src/built-in/chat/utilities/chatDefaultParticipantAdapter';

describe('chat default participant adapter', () => {
  it('delegates default participant services', async () => {
    const sendChatRequest = vi.fn(() => ({ [Symbol.asyncIterator]: async function* () {} }) as AsyncIterable<any>);
    const retrieveContext = vi.fn().mockResolvedValue({ text: 'ctx', sources: [{ uri: 'u', label: 'L', index: 1 }] });
    const getWorkspaceDigest = vi.fn().mockResolvedValue('digest');
    const compactSession = vi.fn();

    const services = buildChatDefaultParticipantServices({
      sendChatRequest,
      getActiveModel: vi.fn(() => 'model'),
      getWorkspaceName: vi.fn(() => 'Parallx'),
      getPageCount: vi.fn().mockResolvedValue(2),
      getCurrentPageTitle: vi.fn(() => 'Page'),
      getToolDefinitions: vi.fn(() => [{ name: 'tool' }] as any),
      getReadOnlyToolDefinitions: vi.fn(() => [{ name: 'read-only-tool' }] as any),
      maxIterations: 8,
      networkTimeout: 1234,
      retrieveContext,
      getWorkspaceDigest,
      compactSession,
    });

    const stream = services.sendChatRequest([], undefined, undefined);

    expect(stream).toBe(sendChatRequest.mock.results[0]?.value);
    expect(services.getActiveModel()).toBe('model');
    expect(services.getWorkspaceName()).toBe('Parallx');
    await expect(services.getPageCount()).resolves.toBe(2);
    expect(services.getCurrentPageTitle()).toBe('Page');
    expect(services.getToolDefinitions()).toEqual([{ name: 'tool' }]);
    expect(services.getReadOnlyToolDefinitions()).toEqual([{ name: 'read-only-tool' }]);
    expect(services.maxIterations).toBe(8);
    expect(services.networkTimeout).toBe(1234);
    await expect(services.retrieveContext?.('claim')).resolves.toEqual({ text: 'ctx', sources: [{ uri: 'u', label: 'L', index: 1 }] });
    await expect(services.getWorkspaceDigest?.()).resolves.toBe('digest');
    services.compactSession?.('session-1', 'summary');

    expect(retrieveContext).toHaveBeenCalledWith('claim');
    expect(getWorkspaceDigest).toHaveBeenCalledTimes(1);
    expect(compactSession).toHaveBeenCalledWith('session-1', 'summary');
  });

  it('preserves optional service absence', () => {
    const services = buildChatDefaultParticipantServices({
      sendChatRequest: vi.fn(() => ({ [Symbol.asyncIterator]: async function* () {} }) as AsyncIterable<any>),
      getActiveModel: vi.fn(() => undefined),
      getWorkspaceName: vi.fn(() => 'Parallx'),
      getPageCount: vi.fn().mockResolvedValue(0),
      getCurrentPageTitle: vi.fn(() => undefined),
      getToolDefinitions: vi.fn(() => []),
      getReadOnlyToolDefinitions: vi.fn(() => []),
    });

    expect(services.retrieveContext).toBeUndefined();
    expect(services.recallMemories).toBeUndefined();
    expect(services.getWorkspaceDigest).toBeUndefined();
    expect(services.compactSession).toBeUndefined();
  });
});