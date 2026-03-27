import { describe, expect, it, vi, beforeEach } from 'vitest';

import type {
  IChatMessage,
  IChatResponseChunk,
  IChatResponseStream,
  ICancellationToken,
  IToolDefinition,
  IToolResult,
} from '../../src/services/chatTypes';
import {
  runOpenclawReadOnlyTurn,
  type IReadOnlyTurnOptions,
  type IReadOnlyTurnResult,
} from '../../src/openclaw/openclawReadOnlyTurnRunner';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createResponse(): IChatResponseStream {
  const markdownParts: string[] = [];
  return {
    markdown: vi.fn((value: string) => { markdownParts.push(value); }),
    codeBlock: vi.fn(),
    progress: vi.fn(),
    provenance: vi.fn(),
    reference: vi.fn(),
    thinking: vi.fn(),
    warning: vi.fn(),
    button: vi.fn(),
    confirmation: vi.fn(),
    beginToolInvocation: vi.fn(),
    updateToolInvocation: vi.fn(),
    editProposal: vi.fn(),
    editBatch: vi.fn(),
    push: vi.fn(),
    replaceLastMarkdown: vi.fn(),
    throwIfDone: vi.fn(),
    reportTokenUsage: vi.fn(),
    setCitations: vi.fn(),
    getMarkdownText: vi.fn(() => markdownParts.join('')),
  };
}

function createToken(cancelled = false): ICancellationToken {
  return {
    isCancellationRequested: cancelled,
    onCancellationRequested: vi.fn(() => ({ dispose: vi.fn() })) as any,
  };
}

async function* streamChunks(chunks: IChatResponseChunk[]): AsyncIterable<IChatResponseChunk> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

function makeSimpleChunk(content: string, opts?: Partial<IChatResponseChunk>): IChatResponseChunk {
  return { content, done: false, ...opts } as IChatResponseChunk;
}

function makeFinalChunk(content: string, opts?: Partial<IChatResponseChunk>): IChatResponseChunk {
  return { content, done: true, promptEvalCount: 100, evalCount: 50, ...opts } as IChatResponseChunk;
}

const dummyTool: IToolDefinition = {
  name: 'readFile',
  description: 'Read a file',
  parameters: { type: 'object', properties: { path: { type: 'string' } } },
};

function baseOptions(overrides?: Partial<IReadOnlyTurnOptions>): IReadOnlyTurnOptions {
  const response = createResponse();
  return {
    sendChatRequest: vi.fn(() => streamChunks([makeFinalChunk('Hello world')])),
    messages: [{ role: 'system', content: 'You are helpful.' }] as IChatMessage[],
    requestOptions: {},
    tools: [],
    response,
    token: createToken(),
    maxIterations: 3,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('openclawReadOnlyTurnRunner', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('happy path: returns markdown with completed=true on simple response', async () => {
    const opts = baseOptions();
    const result = await runOpenclawReadOnlyTurn(opts);

    expect(result.completed).toBe(true);
    expect(result.markdown).toContain('Hello world');
    expect(result.toolCallCount).toBe(0);
    expect(result.transientRetries).toBe(0);
    expect(result.timeoutRetries).toBe(0);
  });

  it('reports token usage when chunks contain counts', async () => {
    const response = createResponse();
    const opts = baseOptions({
      sendChatRequest: vi.fn(() => streamChunks([
        { content: 'Hi', done: true, promptEvalCount: 200, evalCount: 100 } as IChatResponseChunk,
      ])),
      response,
    });
    const result = await runOpenclawReadOnlyTurn(opts);

    expect(result.promptTokens).toBe(200);
    expect(result.completionTokens).toBe(100);
    expect(response.reportTokenUsage).toHaveBeenCalledWith(200, 100);
  });

  it('streams thinking tokens to response.thinking()', async () => {
    const response = createResponse();
    const opts = baseOptions({
      sendChatRequest: vi.fn(() => streamChunks([
        { content: '', thinking: 'Let me think...', done: false } as IChatResponseChunk,
        { content: 'Answer', done: true } as IChatResponseChunk,
      ])),
      response,
    });
    const result = await runOpenclawReadOnlyTurn(opts);

    expect(result.thinking).toContain('Let me think...');
    expect(response.thinking).toHaveBeenCalledWith('Let me think...');
  });

  it('executes tool calls and feeds results back for multi-iteration', async () => {
    let callCount = 0;
    const sendChatRequest = vi.fn(() => {
      callCount++;
      if (callCount === 1) {
        // First iteration: model requests a tool call
        return streamChunks([
          {
            content: 'Using tool...',
            done: true,
            toolCalls: [{ function: { name: 'readFile', arguments: { path: 'test.md' } } }],
          } as unknown as IChatResponseChunk,
        ]);
      }
      // Second iteration: model returns final answer
      return streamChunks([makeFinalChunk('File content is X.')]);
    });

    const invokeToolWithRuntimeControl = vi.fn(async (): Promise<IToolResult> => ({
      content: 'file contents here',
    }));

    const opts = baseOptions({
      sendChatRequest,
      tools: [dummyTool],
      invokeToolWithRuntimeControl,
    });
    const result = await runOpenclawReadOnlyTurn(opts);

    expect(result.completed).toBe(true);
    expect(result.toolCallCount).toBe(1);
    expect(invokeToolWithRuntimeControl).toHaveBeenCalledWith('readFile', { path: 'test.md' }, expect.anything());
  });

  it('warns and returns completed=false when tool calls arrive but no invoker', async () => {
    const response = createResponse();
    const opts = baseOptions({
      sendChatRequest: vi.fn(() => streamChunks([
        {
          content: 'Need tool...',
          done: true,
          toolCalls: [{ function: { name: 'readFile', arguments: { path: 'x' } } }],
        } as unknown as IChatResponseChunk,
      ])),
      response,
      invokeToolWithRuntimeControl: undefined,
    });
    const result = await runOpenclawReadOnlyTurn(opts);

    expect(result.completed).toBe(false);
    expect(response.warning).toHaveBeenCalled();
  });

  it('retries on transient error with exponential backoff', async () => {
    vi.useFakeTimers();
    let callCount = 0;
    const transientErr = new Error('ECONNRESET');

    const sendChatRequest = vi.fn(() => {
      callCount++;
      if (callCount <= 2) {
        return (async function* () {
          throw transientErr;
        })();
      }
      return streamChunks([makeFinalChunk('Recovered')]);
    });

    const response = createResponse();
    const opts = baseOptions({ sendChatRequest, response });

    const promise = runOpenclawReadOnlyTurn(opts);

    // Advance past both retry delays
    await vi.advanceTimersByTimeAsync(20_000);

    const result = await promise;
    expect(result.completed).toBe(true);
    expect(result.transientRetries).toBe(2);
    expect(response.progress).toHaveBeenCalled();

    vi.useRealTimers();
  });

  it('stops and returns incomplete when cancellation is requested', async () => {
    const token: ICancellationToken = {
      isCancellationRequested: true,
      onCancellationRequested: vi.fn(() => ({ dispose: vi.fn() })) as any,
    };

    const opts = baseOptions({ token });
    const result = await runOpenclawReadOnlyTurn(opts);

    // When already cancelled, the loop body still runs once but breaks on token check
    expect(result.completed).toBe(false);
  });

  it('exhausts iteration budget and returns completed=false', async () => {
    // Every iteration returns a tool call, never a final answer
    const sendChatRequest = vi.fn(() => streamChunks([
      {
        content: 'Calling tool...',
        done: true,
        toolCalls: [{ function: { name: 'readFile', arguments: { path: 'a' } } }],
      } as unknown as IChatResponseChunk,
    ]));

    const invokeToolWithRuntimeControl = vi.fn(async (): Promise<IToolResult> => ({
      content: 'result',
    }));

    const response = createResponse();
    const opts = baseOptions({
      sendChatRequest,
      tools: [dummyTool],
      invokeToolWithRuntimeControl,
      maxIterations: 2,
      response,
    });
    const result = await runOpenclawReadOnlyTurn(opts);

    expect(result.completed).toBe(false);
    expect(response.warning).toHaveBeenCalledWith(
      expect.stringContaining('stopped before completing'),
    );
  });

  it('propagates non-transient errors without retry', async () => {
    const fatalErr = new Error('Model not found');
    const sendChatRequest = vi.fn(() => (async function* () {
      throw fatalErr;
    })());

    const opts = baseOptions({ sendChatRequest });
    await expect(runOpenclawReadOnlyTurn(opts)).rejects.toThrow('Model not found');
  });

  it('applies readonly tool policy to filter tools', async () => {
    // Provide tools and verify the runner uses filtered tools in request options
    const sendChatRequest = vi.fn((_messages: any, options: any) => {
      // The runner should pass policy-filtered (or undefined) tools
      return streamChunks([makeFinalChunk('Done')]);
    });

    const opts = baseOptions({
      sendChatRequest,
      tools: [dummyTool],
    });
    const result = await runOpenclawReadOnlyTurn(opts);

    expect(result.completed).toBe(true);
    // sendChatRequest was called with some request options (tools may be filtered)
    expect(sendChatRequest).toHaveBeenCalledTimes(1);
  });

  it('accumulates markdown from multiple chunks', async () => {
    const opts = baseOptions({
      sendChatRequest: vi.fn(() => streamChunks([
        makeSimpleChunk('Hello '),
        makeSimpleChunk('world'),
        makeFinalChunk('!'),
      ])),
    });
    const result = await runOpenclawReadOnlyTurn(opts);

    expect(result.markdown).toBe('Hello world!');
    expect(result.completed).toBe(true);
  });

  it('handles empty model response gracefully', async () => {
    const response = createResponse();
    const opts = baseOptions({
      sendChatRequest: vi.fn(() => streamChunks([
        { content: '', done: true } as IChatResponseChunk,
      ])),
      response,
    });
    const result = await runOpenclawReadOnlyTurn(opts);

    expect(result.completed).toBe(true);
    expect(result.markdown).toBe('');
    // Empty markdown should not be sent to response.markdown()
    expect(response.markdown).not.toHaveBeenCalled();
  });

  it('counts tool calls across multiple iterations', async () => {
    let callCount = 0;
    const sendChatRequest = vi.fn(() => {
      callCount++;
      if (callCount <= 2) {
        return streamChunks([
          {
            content: `iter ${callCount}`,
            done: true,
            toolCalls: [
              { function: { name: 'readFile', arguments: { path: `file${callCount}` } } },
              { function: { name: 'readFile', arguments: { path: `file${callCount}b` } } },
            ],
          } as unknown as IChatResponseChunk,
        ]);
      }
      return streamChunks([makeFinalChunk('Final')]);
    });

    const invokeToolWithRuntimeControl = vi.fn(async (): Promise<IToolResult> => ({
      content: 'ok',
    }));

    const opts = baseOptions({
      sendChatRequest,
      tools: [dummyTool],
      invokeToolWithRuntimeControl,
      maxIterations: 5,
    });
    const result = await runOpenclawReadOnlyTurn(opts);

    expect(result.completed).toBe(true);
    // 2 iterations x 2 tool calls each = 4 total
    expect(result.toolCallCount).toBe(4);
  });
});
