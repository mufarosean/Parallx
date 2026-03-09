// Unit tests for default participant agentic loop — M9 Cap 6 Task 6.2

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatMode } from '../../src/services/chatTypes';
import type {
  IChatResponseChunk,
  IChatParticipantRequest,
  IChatParticipantContext,
  IChatResponseStream,
  ICancellationToken,
  IToolResult,
} from '../../src/services/chatTypes';
import { createDefaultParticipant } from '../../src/built-in/chat/participants/defaultParticipant';
import type { IDefaultParticipantServices } from '../../src/built-in/chat/participants/defaultParticipant';

// ── Helpers ──

function createToken(): ICancellationToken {
  return {
    isCancellationRequested: false,
    onCancellationRequested: vi.fn(() => ({ dispose: vi.fn() })) as any,
  };
}

function createStream(): IChatResponseStream & { calls: Record<string, any[][]> } {
  const calls: Record<string, any[][]> = {
    markdown: [],
    thinking: [],
    warning: [],
    beginToolInvocation: [],
    updateToolInvocation: [],
    codeBlock: [],
    progress: [],
    reference: [],
    button: [],
    confirmation: [],
    push: [],
    throwIfDone: [],
  };

  return {
    calls,
    markdown: vi.fn((...args) => calls['markdown'].push(args)),
    thinking: vi.fn((...args) => calls['thinking'].push(args)),
    warning: vi.fn((...args) => calls['warning'].push(args)),
    beginToolInvocation: vi.fn((...args) => calls['beginToolInvocation'].push(args)),
    updateToolInvocation: vi.fn((...args) => calls['updateToolInvocation'].push(args)),
    codeBlock: vi.fn((...args) => calls['codeBlock'].push(args)),
    progress: vi.fn((...args) => calls['progress'].push(args)),
    reference: vi.fn((...args) => calls['reference'].push(args)),
    button: vi.fn(),
    confirmation: vi.fn((...args) => calls['confirmation'].push(args)),
    push: vi.fn((...args) => calls['push'].push(args)),
    getMarkdownText: vi.fn(() => calls['markdown'].map((args) => String(args[0] ?? '')).join('')),
    setCitations: vi.fn(),
    throwIfDone: vi.fn(),
  };
}

function makeRequest(overrides: Partial<IChatParticipantRequest> = {}): IChatParticipantRequest {
  return {
    text: 'Hello',
    mode: ChatMode.Ask,
    ...overrides,
  };
}

function makeContext(overrides: Partial<IChatParticipantContext> = {}): IChatParticipantContext {
  return {
    history: [],
    sessionId: 'test-session',
    ...overrides,
  };
}

async function* streamChunks(chunks: IChatResponseChunk[]): AsyncIterable<IChatResponseChunk> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

// ── Tests ──

describe('defaultParticipant agentic loop', () => {
  let services: IDefaultParticipantServices;
  let sendChatRequest: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sendChatRequest = vi.fn();
    services = {
      sendChatRequest,
      getActiveModel: () => 'test-model',
      getWorkspaceName: () => 'Test Workspace',
      getPageCount: async () => 5,
      getCurrentPageTitle: () => undefined,
      getToolDefinitions: () => [],
      getReadOnlyToolDefinitions: () => [],
      invokeTool: vi.fn(async () => ({ content: 'tool result' })),
      maxIterations: 10,
    };
  });

  it('streams markdown content in Ask mode (with read-only tools)', async () => {
    sendChatRequest.mockReturnValue(streamChunks([
      { content: 'Hello ', done: false },
      { content: 'World', done: true },
    ]));

    const participant = createDefaultParticipant(services);
    const stream = createStream();

    const result = await participant.handler(
      makeRequest({ mode: ChatMode.Ask }),
      makeContext(),
      stream,
      createToken(),
    );

    expect(result).toEqual({});
    expect(stream.calls['markdown']).toHaveLength(2);
    expect(stream.calls['markdown'][0][0]).toBe('Hello ');
    expect(stream.calls['markdown'][1][0]).toBe('World');
  });

  it('executes agentic loop when model returns tool_calls in Agent mode', async () => {
    // First call: model requests a tool
    const firstResponse = streamChunks([
      { content: '', done: false, toolCalls: [{ function: { name: 'search_workspace', arguments: { query: 'test' } } }] },
      { content: '', done: true },
    ]);

    // Second call: model gives final answer
    const secondResponse = streamChunks([
      { content: 'Based on the search results, here is the answer.', done: true },
    ]);

    sendChatRequest
      .mockReturnValueOnce(firstResponse)
      .mockReturnValueOnce(secondResponse);

    const participant = createDefaultParticipant(services);
    const stream = createStream();

    const result = await participant.handler(
      makeRequest({ mode: ChatMode.Agent }),
      makeContext(),
      stream,
      createToken(),
    );

    expect(result).toEqual({});

    // Tool was invoked silently (no tool cards rendered to user)
    expect(services.invokeTool).toHaveBeenCalledWith(
      'search_workspace',
      { query: 'test' },
      expect.any(Object),
    );

    // No tool invocation cards shown — tools run silently
    expect(stream.calls['beginToolInvocation']).toHaveLength(0);
    expect(stream.calls['updateToolInvocation']).toHaveLength(0);

    // LLM was called twice (initial + after tool result)
    expect(sendChatRequest).toHaveBeenCalledTimes(2);

    // Final answer was streamed
    expect(stream.calls['markdown']).toHaveLength(1);
    expect(stream.calls['markdown'][0][0]).toContain('search results');
  });

  it('stops at max iterations', async () => {
    // Model always returns tool calls
    const toolResponse = () => streamChunks([
      { content: '', done: false, toolCalls: [{ function: { name: 'search_workspace', arguments: { query: 'loop' } } }] },
      { content: '', done: true },
    ]);

    sendChatRequest.mockImplementation(() => toolResponse());

    services.maxIterations = 2;
    const participant = createDefaultParticipant(services);
    const stream = createStream();

    await participant.handler(
      makeRequest({ mode: ChatMode.Agent }),
      makeContext(),
      stream,
      createToken(),
    );

    // Should stop at maxIterations
    // The loop runs: iteration 0 (tool call → execute), iteration 1 (tool call → execute), iteration 2 = maxIterations → stops
    expect(stream.calls['warning'].some(
      (args: any[]) => typeof args[0] === 'string' && args[0].includes('maximum iterations'),
    )).toBe(true);
  });

  it('handles tool invocation rejection', async () => {
    const firstResponse = streamChunks([
      { content: '', done: false, toolCalls: [{ function: { name: 'create_page', arguments: { title: 'New' } } }] },
      { content: '', done: true },
    ]);
    const secondResponse = streamChunks([
      { content: 'OK, I won\'t create the page.', done: true },
    ]);

    sendChatRequest
      .mockReturnValueOnce(firstResponse)
      .mockReturnValueOnce(secondResponse);

    (services.invokeTool as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      content: 'Tool execution rejected by user',
      isError: true,
    });

    const participant = createDefaultParticipant(services);
    const stream = createStream();

    await participant.handler(
      makeRequest({ mode: ChatMode.Agent }),
      makeContext(),
      stream,
      createToken(),
    );

    // Tool was still invoked (even though rejected)
    expect(services.invokeTool).toHaveBeenCalled();

    // No tool invocation cards rendered — tools run silently
    expect(stream.calls['beginToolInvocation']).toHaveLength(0);
  });

  it('warns when tool_calls received in Edit mode (no tools)', async () => {
    sendChatRequest.mockReturnValue(streamChunks([
      { content: '', done: false, toolCalls: [{ function: { name: 'search', arguments: {} } }] },
      { content: 'Answer', done: true },
    ]));

    const participant = createDefaultParticipant(services);
    const stream = createStream();

    await participant.handler(
      makeRequest({ mode: ChatMode.Edit }),
      makeContext(),
      stream,
      createToken(),
    );

    // Edit mode uses structured output parsing, not tool invocation
    // Tool calls should not be processed
    expect(stream.calls['beginToolInvocation']).toHaveLength(0);
  });

  it('handles cancellation during agentic loop', async () => {
    const token = createToken();
    let resolveFn: () => void;
    const blockingPromise = new Promise<void>((resolve) => { resolveFn = resolve; });

    sendChatRequest.mockReturnValue(streamChunks([
      { content: '', done: false, toolCalls: [{ function: { name: 'slow_tool', arguments: {} } }] },
      { content: '', done: true },
    ]));

    (services.invokeTool as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      // Simulate cancellation during tool execution
      (token as any).isCancellationRequested = true;
      return { content: 'Tool execution cancelled', isError: true };
    });

    const participant = createDefaultParticipant(services);
    const stream = createStream();

    const result = await participant.handler(
      makeRequest({ mode: ChatMode.Agent }),
      makeContext(),
      stream,
      token,
    );

    // Should exit without error
    expect(result).toEqual({});
  });

  it('handles multiple tool calls in single response', async () => {
    const firstResponse = streamChunks([
      { content: '', done: false, toolCalls: [
        { function: { name: 'list_pages', arguments: {} } },
        { function: { name: 'search_workspace', arguments: { query: 'notes' } } },
      ]},
      { content: '', done: true },
    ]);
    const secondResponse = streamChunks([
      { content: 'Here are your pages and search results.', done: true },
    ]);

    sendChatRequest
      .mockReturnValueOnce(firstResponse)
      .mockReturnValueOnce(secondResponse);

    const participant = createDefaultParticipant(services);
    const stream = createStream();

    await participant.handler(
      makeRequest({ mode: ChatMode.Agent }),
      makeContext(),
      stream,
      createToken(),
    );

    // Both tools were invoked silently
    expect(services.invokeTool).toHaveBeenCalledTimes(2);
    expect(stream.calls['beginToolInvocation']).toHaveLength(0);
  });
});
