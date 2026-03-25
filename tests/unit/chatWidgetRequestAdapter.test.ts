import { describe, expect, it, vi } from 'vitest';

import { ChatRequestQueueKind } from '../../src/built-in/chat/chatTypes';
import { buildChatWidgetRequestServices } from '../../src/built-in/chat/utilities/chatWidgetRequestAdapter';

describe('chat widget request adapter', () => {
  it('delegates request lifecycle operations', async () => {
    const sendRequest = vi.fn().mockResolvedValue(undefined);
    const cancelRequest = vi.fn();
    const createSession = vi.fn().mockReturnValue({ id: 'session-1' });
    const queueRequest = vi.fn().mockReturnValue({
      id: 'pending-1',
      text: 'msg',
      kind: ChatRequestQueueKind.Queued,
      options: { command: 'context' },
      timestamp: 1,
    });
    const removePendingRequest = vi.fn();
    const requestYield = vi.fn();

    const services = buildChatWidgetRequestServices({
      sendRequest,
      cancelRequest,
      createSession,
      onDidChangeSession: vi.fn() as any,
      getProviderStatus: vi.fn(() => ({ available: true })),
      onDidChangeProviderStatus: vi.fn() as any,
      queueRequest,
      removePendingRequest,
      requestYield,
      onDidChangePendingRequests: vi.fn() as any,
    });

    await services.sendRequest('session-1', 'hello', [{ id: 'a-1' }] as any);
    services.cancelRequest('session-1');
    expect(services.createSession()).toEqual({ id: 'session-1' });
    expect(services.queueRequest?.('session-1', 'msg', ChatRequestQueueKind.Queued, { command: 'context' } as any)).toEqual({
      id: 'pending-1',
      text: 'msg',
      kind: ChatRequestQueueKind.Queued,
      options: { command: 'context' },
      timestamp: 1,
    });
    services.removePendingRequest?.('session-1', 'pending-1');
    services.requestYield?.('session-1');

    expect(sendRequest).toHaveBeenCalledWith('session-1', 'hello', [{ id: 'a-1' }]);
    expect(cancelRequest).toHaveBeenCalledWith('session-1');
    expect(queueRequest).toHaveBeenCalledWith('session-1', 'msg', ChatRequestQueueKind.Queued, { command: 'context' });
    expect(removePendingRequest).toHaveBeenCalledWith('session-1', 'pending-1');
    expect(requestYield).toHaveBeenCalledWith('session-1');
  });

  it('delegates provider status signals', () => {
    const onDidChangeSession = vi.fn() as any;
    const onDidChangeProviderStatus = vi.fn() as any;
    const onDidChangePendingRequests = vi.fn() as any;

    const services = buildChatWidgetRequestServices({
      sendRequest: vi.fn().mockResolvedValue(undefined),
      cancelRequest: vi.fn(),
      createSession: vi.fn(),
      onDidChangeSession,
      getProviderStatus: vi.fn(() => ({ available: false })),
      onDidChangeProviderStatus,
      queueRequest: vi.fn() as any,
      removePendingRequest: vi.fn(),
      requestYield: vi.fn(),
      onDidChangePendingRequests,
    });

    expect(services.getProviderStatus()).toEqual({ available: false });
    expect(services.onDidChangeSession).toBe(onDidChangeSession);
    expect(services.onDidChangeProviderStatus).toBe(onDidChangeProviderStatus);
    expect(services.onDidChangePendingRequests).toBe(onDidChangePendingRequests);
  });
});