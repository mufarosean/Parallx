// Unit tests for ChatAgentService — M9.0

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChatAgentService } from '../../src/services/chatAgentService';
import type {
  IChatParticipant,
  IChatParticipantRequest,
  IChatParticipantContext,
  IChatResponseStream,
  ICancellationToken,
  IChatParticipantResult,
} from '../../src/services/chatTypes';
import { ChatMode } from '../../src/services/chatTypes';

function createMockParticipant(
  id: string,
  handler?: IChatParticipant['handler'],
): IChatParticipant {
  return {
    id,
    displayName: id,
    description: `Mock participant ${id}`,
    commands: [],
    handler: handler ?? (async () => ({})),
  };
}

function createMockRequest(text = 'hello'): IChatParticipantRequest {
  return {
    text,
    requestId: 'req-1',
    mode: ChatMode.Ask,
    modelId: 'test-model',
    attempt: 0,
  };
}

function createMockContext(): IChatParticipantContext {
  return { sessionId: 'test-session', history: [] };
}

function createMockStream(): IChatResponseStream {
  return {
    markdown: vi.fn(),
    codeBlock: vi.fn(),
    progress: vi.fn(),
    reference: vi.fn(),
    thinking: vi.fn(),
    warning: vi.fn(),
    button: vi.fn(),
    confirmation: vi.fn(),
    beginToolInvocation: vi.fn(),
    updateToolInvocation: vi.fn(),
    push: vi.fn(),
  };
}

function createMockToken(): ICancellationToken {
  return {
    isCancellationRequested: false,
    onCancellationRequested: () => ({ dispose() {} }),
  };
}

describe('ChatAgentService', () => {
  let service: ChatAgentService;

  beforeEach(() => {
    service = new ChatAgentService();
  });

  it('starts with no agents', () => {
    expect(service.getAgents()).toHaveLength(0);
    expect(service.getDefaultAgent()).toBeUndefined();
  });

  it('registerAgent adds an agent', () => {
    const agent = createMockParticipant('test.agent');
    service.registerAgent(agent);
    expect(service.getAgents()).toHaveLength(1);
    expect(service.getAgent('test.agent')).toBe(agent);
  });

  it('registerAgent fires onDidChangeAgents', () => {
    const listener = vi.fn();
    service.onDidChangeAgents(listener);

    service.registerAgent(createMockParticipant('a'));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('registerAgent throws for duplicate ids', () => {
    service.registerAgent(createMockParticipant('dup'));
    expect(() => service.registerAgent(createMockParticipant('dup')))
      .toThrow("already registered");
  });

  it('dispose from registerAgent removes the agent', () => {
    const disposable = service.registerAgent(createMockParticipant('removable'));
    expect(service.getAgent('removable')).toBeDefined();

    disposable.dispose();
    expect(service.getAgent('removable')).toBeUndefined();
  });

  it('getDefaultAgent returns the agent with id "parallx.chat.default"', () => {
    service.registerAgent(createMockParticipant('other'));
    expect(service.getDefaultAgent()).toBeUndefined();

    service.registerAgent(createMockParticipant('parallx.chat.default'));
    expect(service.getDefaultAgent()?.id).toBe('parallx.chat.default');
  });

  it('invokeAgent calls the agent handler', async () => {
    const handler = vi.fn(async () => ({ metadata: { ok: true } }));
    service.registerAgent(createMockParticipant('test', handler));

    const result = await service.invokeAgent(
      'test',
      createMockRequest(),
      createMockContext(),
      createMockStream(),
      createMockToken(),
    );

    expect(handler).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ metadata: { ok: true } });
  });

  it('invokeAgent falls back to default agent when participant not found', async () => {
    const defaultHandler = vi.fn(async () => ({ fallback: true }));
    service.registerAgent(createMockParticipant('parallx.chat.default', defaultHandler));

    const result = await service.invokeAgent(
      'nonexistent',
      createMockRequest(),
      createMockContext(),
      createMockStream(),
      createMockToken(),
    );

    expect(defaultHandler).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ fallback: true });
  });

  it('invokeAgent throws when participant not found and no default', async () => {
    await expect(
      service.invokeAgent(
        'nonexistent',
        createMockRequest(),
        createMockContext(),
        createMockStream(),
        createMockToken(),
      ),
    ).rejects.toThrow('not found');
  });

  it('invokeAgent catches handler errors and writes warning to stream', async () => {
    const handler = vi.fn(async () => { throw new Error('boom'); });
    service.registerAgent(createMockParticipant('faulty', handler));

    const stream = createMockStream();
    const result = await service.invokeAgent(
      'faulty',
      createMockRequest(),
      createMockContext(),
      stream,
      createMockToken(),
    );

    expect(result.errorDetails).toBeDefined();
    expect(result.errorDetails?.message).toContain('boom');
    expect(stream.warning).toHaveBeenCalled();
  });
});
