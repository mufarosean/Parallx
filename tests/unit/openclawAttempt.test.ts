import { describe, expect, it, vi, beforeEach } from 'vitest';

import type {
  IChatMessage,
  IChatParticipantRequest,
  IChatResponseChunk,
  IChatResponseStream,
  ICancellationToken,
  IToolResult,
} from '../../src/services/chatTypes';
import type { IOpenclawTurnContext } from '../../src/openclaw/openclawAttempt';
import type { IOpenclawAssembleResult } from '../../src/openclaw/openclawContextEngine';
import { executeOpenclawAttempt } from '../../src/openclaw/openclawAttempt';

// Mock buildOpenclawPromptArtifacts to return a fixed prompt
vi.mock('../../src/openclaw/openclawPromptArtifacts', () => ({
  buildOpenclawPromptArtifacts: vi.fn(() => ({
    systemPrompt: 'You are a helpful assistant.',
    report: {
      source: 'run',
      systemPromptLength: 30,
      workspaceSectionLength: 0,
      skillsSectionLength: 0,
      toolSectionLength: 0,
      preferencesLength: 0,
      overlayLength: 0,
      bootstrapFileCount: 0,
      activeBootstrapFiles: [],
      modelTier: 'small',
      provenance: {},
    },
  })),
}));

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createResponse(): IChatResponseStream {
  return {
    markdown: vi.fn(),
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
    getMarkdownText: vi.fn(() => ''),
  };
}

function createToken(cancelled = false): ICancellationToken {
  return {
    isCancellationRequested: cancelled,
    onCancellationRequested: vi.fn(() => ({ dispose: vi.fn() })) as any,
  };
}

function createRequest(text = 'Hello'): IChatParticipantRequest {
  return { text, attachments: [], command: undefined } as unknown as IChatParticipantRequest;
}

function createAssembled(overrides?: Partial<IOpenclawAssembleResult>): IOpenclawAssembleResult {
  return {
    messages: [],
    estimatedTokens: 100,
    ragSources: [],
    retrievedContextText: '',
    ...overrides,
  };
}

async function* streamChunks(chunks: IChatResponseChunk[]): AsyncIterable<IChatResponseChunk> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

function textChunk(content: string, opts?: Partial<IChatResponseChunk>): IChatResponseChunk {
  return { content, done: true, promptEvalCount: 100, evalCount: 50, ...opts } as IChatResponseChunk;
}

function toolCallChunk(content: string, toolCalls: Array<{ function: { name: string; arguments: Record<string, unknown> } }>): IChatResponseChunk {
  return { content, done: true, toolCalls, promptEvalCount: 100, evalCount: 50 } as unknown as IChatResponseChunk;
}

function createContext(overrides?: Partial<IOpenclawTurnContext>): IOpenclawTurnContext {
  return {
    sessionId: 'test-session',
    history: [],
    tokenBudget: 8192,
    engine: {
      bootstrap: vi.fn(async () => ({ ragReady: true, memoryReady: true, conceptsReady: true })),
      assemble: vi.fn(async () => createAssembled()),
      compact: vi.fn(async () => ({ compacted: true, tokensBefore: 1000, tokensAfter: 500 })),
      afterTurn: vi.fn(async () => {}),
    },
    bootstrapFiles: [],
    bootstrapDebugReport: {} as any,
    workspaceDigest: '',
    skillState: { promptEntries: [] } as any,
    runtimeInfo: { model: 'qwen2.5:7b', provider: 'ollama', host: 'localhost', parallxVersion: '0.1.0' },
    toolState: { availableDefinitions: [] } as any,
    maxToolIterations: 6,
    sendChatRequest: vi.fn(() => streamChunks([textChunk('Hello world')])),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('executeOpenclawAttempt', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('simple turn, no tools — returns markdown', async () => {
    const context = createContext();
    const response = createResponse();
    const result = await executeOpenclawAttempt(
      createRequest(),
      context,
      createAssembled(),
      response,
      createToken(),
    );

    expect(result.markdown).toBe('Hello world');
    expect(result.toolCallCount).toBe(0);
    expect(response.markdown).toHaveBeenCalledWith('Hello world');
  });

  it('tool call loop — model returns tool call, tool executes, model returns text', async () => {
    let callCount = 0;
    const sendChatRequest = vi.fn(() => {
      callCount++;
      if (callCount === 1) {
        return streamChunks([
          toolCallChunk('Using tool...', [{ function: { name: 'readFile', arguments: { path: 'test.md' } } }]),
        ]);
      }
      return streamChunks([textChunk('File content is X.')]);
    });

    const invokeToolWithRuntimeControl = vi.fn(async (): Promise<IToolResult> => ({
      content: 'file contents here',
    }));

    const context = createContext({
      sendChatRequest,
      invokeToolWithRuntimeControl,
      toolState: {
        availableDefinitions: [{ name: 'readFile', description: 'Read file', parameters: {} }],
      } as any,
    });
    const response = createResponse();

    const result = await executeOpenclawAttempt(
      createRequest(),
      context,
      createAssembled(),
      response,
      createToken(),
    );

    expect(result.toolCallCount).toBe(1);
    expect(invokeToolWithRuntimeControl).toHaveBeenCalledWith(
      'readFile',
      { path: 'test.md' },
      expect.anything(),
      undefined,
      expect.anything(),
    );
  });

  it('tool result truncation — oversized results are truncated', async () => {
    let callCount = 0;
    const sendChatRequest = vi.fn(() => {
      callCount++;
      if (callCount === 1) {
        return streamChunks([
          toolCallChunk('Using tool...', [{ function: { name: 'readFile', arguments: { path: 'big.md' } } }]),
        ]);
      }
      return streamChunks([textChunk('Done.')]);
    });

    // 150K chars — exceeds the 100K cap, so truncation should kick in.
    const longContent = 'x'.repeat(150_000);
    const invokeToolWithRuntimeControl = vi.fn(async (): Promise<IToolResult> => ({
      content: longContent,
    }));

    const context = createContext({
      sendChatRequest,
      invokeToolWithRuntimeControl,
      toolState: {
        availableDefinitions: [{ name: 'readFile', description: 'Read', parameters: {} }],
      } as any,
    });

    const result = await executeOpenclawAttempt(
      createRequest(),
      context,
      createAssembled(),
      createResponse(),
      createToken(),
    );

    expect(result.toolCallCount).toBe(1);
    const secondCallMessages = (sendChatRequest.mock.calls as any[][])[1][0] as IChatMessage[];
    const toolMsg = secondCallMessages.find(m => m.role === 'tool');
    expect(toolMsg).toBeDefined();
    expect(toolMsg!.content.length).toBeLessThan(longContent.length);
    expect(toolMsg!.content).toContain('truncated');
  });

  it('ChatToolLoopSafety blocks after 8+ identical tool calls', async () => {
    // Model always requests the same tool call
    const sendChatRequest = vi.fn(() =>
      streamChunks([
        toolCallChunk('Calling...', [{ function: { name: 'readFile', arguments: { path: 'same.md' } } }]),
      ]),
    );

    const invokeToolWithRuntimeControl = vi.fn(async (): Promise<IToolResult> => ({
      content: 'result',
    }));

    const context = createContext({
      sendChatRequest,
      invokeToolWithRuntimeControl,
      toolState: {
        availableDefinitions: [{ name: 'readFile', description: 'Read', parameters: {} }],
      } as any,
      maxToolIterations: 20, // High limit — safety should kick in before this
    });

    const result = await executeOpenclawAttempt(
      createRequest(),
      context,
      createAssembled(),
      createResponse(),
      createToken(),
    );

    // Safety blocks at 8 consecutive identical calls
    expect(result.toolCallCount).toBeLessThanOrEqual(8);
  });

  it('maxToolIterations respected', async () => {
    // Model always returns a tool call
    const sendChatRequest = vi.fn(() =>
      streamChunks([
        toolCallChunk('Calling...', [{ function: { name: 'tool1', arguments: {} } }]),
      ]),
    );

    let toolNum = 0;
    const invokeToolWithRuntimeControl = vi.fn(async (): Promise<IToolResult> => ({
      content: `result-${++toolNum}`,
    }));

    const context = createContext({
      sendChatRequest,
      invokeToolWithRuntimeControl,
      toolState: {
        availableDefinitions: [{ name: 'tool1', description: 't', parameters: {} }],
      } as any,
      maxToolIterations: 2,
    });

    const result = await executeOpenclawAttempt(
      createRequest(),
      context,
      createAssembled(),
      createResponse(),
      createToken(),
    );

    // maxToolIterations=2 means at most 2 tool loop iterations + 1 initial = 3 model calls max
    // But the model call on iteration 3 (index 2) exits the while loop (iterations >= maxToolIterations + 1)
    expect(sendChatRequest).toHaveBeenCalledTimes(3);
  });

  it('cancellation mid-tool-loop', async () => {
    let callCount = 0;
    const token = createToken();
    const sendChatRequest = vi.fn(() => {
      callCount++;
      if (callCount === 1) {
        return streamChunks([
          toolCallChunk('Calling...', [{ function: { name: 'readFile', arguments: { path: 'a' } } }]),
        ]);
      }
      return streamChunks([textChunk('Done.')]);
    });

    const invokeToolWithRuntimeControl = vi.fn(async (): Promise<IToolResult> => {
      // Simulate cancellation during tool execution
      (token as any).isCancellationRequested = true;
      return { content: 'result' };
    });

    const context = createContext({
      sendChatRequest,
      invokeToolWithRuntimeControl,
      toolState: {
        availableDefinitions: [{ name: 'readFile', description: 'Read', parameters: {} }],
      } as any,
    });

    const result = await executeOpenclawAttempt(
      createRequest(),
      context,
      createAssembled(),
      createResponse(),
      token,
    );

    // Should have stopped after cancellation
    expect(result.toolCallCount).toBe(1);
  });

  it('system prompt budget warning logged', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // tokenBudget of 10 → 10% system budget = 1 token
    // The mock system prompt "You are a helpful assistant." ≈ 8 tokens → exceeds budget
    const context = createContext({ tokenBudget: 10 });

    await executeOpenclawAttempt(
      createRequest(),
      context,
      createAssembled(),
      createResponse(),
      createToken(),
    );

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('System prompt'),
    );

    warnSpy.mockRestore();
  });

  it('mention context blocks injected', async () => {
    const sendChatRequest = vi.fn(() => streamChunks([textChunk('Done')]));

    const context = createContext({
      sendChatRequest,
      mentionContextBlocks: ['## File: test.md\nHello world'],
    });

    await executeOpenclawAttempt(
      createRequest(),
      context,
      createAssembled(),
      createResponse(),
      createToken(),
    );

    // Verify the messages sent to model include the mention context
    const messages = (sendChatRequest.mock.calls as any[][])[0][0] as IChatMessage[];
    const mentionMsg = messages.find(m => m.role === 'user' && m.content.includes('File: test.md'));
    expect(mentionMsg).toBeDefined();
  });

  it('afterTurn called with final messages', async () => {
    const afterTurn = vi.fn(async () => {});
    const context = createContext({
      engine: {
        bootstrap: vi.fn(async () => ({ ragReady: true, memoryReady: true, conceptsReady: true })),
        assemble: vi.fn(async () => createAssembled()),
        compact: vi.fn(async () => ({ compacted: true, tokensBefore: 1000, tokensAfter: 500 })),
        afterTurn,
      },
    });

    await executeOpenclawAttempt(
      createRequest(),
      context,
      createAssembled(),
      createResponse(),
      createToken(),
    );

    expect(afterTurn).toHaveBeenCalledTimes(1);
    expect(afterTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'test-session',
        messages: expect.arrayContaining([
          expect.objectContaining({ role: 'system' }),
        ]),
      }),
    );
  });

  // -------------------------------------------------------------------------
  // Empty-response salvage — thinking models that answer only inside their
  // reasoning and emit no visible content (qwen3.x / DeepSeek-R1 failure mode)
  // -------------------------------------------------------------------------

  describe('empty-response salvage', () => {
    it('reasoning-only response — continuation nudge recovers the final answer', async () => {
      let callCount = 0;
      const sendChatRequest = vi.fn(() => {
        callCount++;
        if (callCount === 1) {
          // All output landed in thinking; visible content is empty.
          return streamChunks([textChunk('', { thinking: 'The Mack SE is 26,909 because...' })]);
        }
        return streamChunks([textChunk('The Mack standard error is 26,909.')]);
      });

      const context = createContext({ sendChatRequest });
      const response = createResponse();

      const result = await executeOpenclawAttempt(
        createRequest(),
        context,
        createAssembled(),
        response,
        createToken(),
      );

      expect(sendChatRequest).toHaveBeenCalledTimes(2);
      expect(result.markdown).toBe('The Mack standard error is 26,909.');
      expect(result.emptyResponseContinuations).toBe(1);
      // Original reasoning survives into the result even though the
      // continuation round had no thinking of its own.
      expect(result.thinking).toContain('The Mack SE is 26,909 because...');
      // The user was told why an extra round happened.
      expect(response.progress).toHaveBeenCalledWith(
        expect.stringContaining('requesting the final answer'),
      );
      // No failure warning on the success path.
      expect(response.warning).not.toHaveBeenCalled();

      // The continuation request carries the reasoning as plain assistant
      // text plus a user nudge to answer.
      const secondCallMessages = (sendChatRequest.mock.calls as any[][])[1][0] as IChatMessage[];
      const carryMsg = secondCallMessages.find(
        (m) => m.role === 'assistant' && m.content.includes('The Mack SE is 26,909 because...'),
      );
      expect(carryMsg).toBeDefined();
      expect(secondCallMessages[secondCallMessages.length - 1]).toEqual(
        expect.objectContaining({
          role: 'user',
          content: expect.stringContaining('write your final answer now'),
        }),
      );
    });

    it('reasoning-only persists — gives up after the cap and surfaces a diagnosis', async () => {
      const sendChatRequest = vi.fn(() =>
        streamChunks([textChunk('', { thinking: 'still only reasoning...' })]),
      );

      const context = createContext({ sendChatRequest });
      const response = createResponse();

      const result = await executeOpenclawAttempt(
        createRequest(),
        context,
        createAssembled(),
        response,
        createToken(),
      );

      // 1 original + 2 continuations, then stop — no runaway loop.
      expect(sendChatRequest).toHaveBeenCalledTimes(3);
      expect(result.markdown).toBe('');
      expect(result.emptyResponseContinuations).toBe(2);
      expect(response.warning).toHaveBeenCalledWith(
        expect.stringContaining('never produced a final response'),
      );
      // Every round's reasoning is preserved for the transcript.
      expect(result.thinking).toContain('still only reasoning...');
    });

    it('visible content present — no continuation even when thinking is non-empty', async () => {
      const sendChatRequest = vi.fn(() =>
        streamChunks([textChunk('Here is the answer.', { thinking: 'worked it out...' })]),
      );

      const context = createContext({ sendChatRequest });
      const response = createResponse();

      const result = await executeOpenclawAttempt(
        createRequest(),
        context,
        createAssembled(),
        response,
        createToken(),
      );

      expect(sendChatRequest).toHaveBeenCalledTimes(1);
      expect(result.markdown).toBe('Here is the answer.');
      expect(result.emptyResponseContinuations).toBeUndefined();
      expect(result.thinking).toBe('worked it out...');
    });

    it('fully empty response (no thinking either) — no salvage, returns empty once', async () => {
      const sendChatRequest = vi.fn(() => streamChunks([textChunk('')]));

      const context = createContext({ sendChatRequest });
      const response = createResponse();

      const result = await executeOpenclawAttempt(
        createRequest(),
        context,
        createAssembled(),
        response,
        createToken(),
      );

      // A truly empty generation is a different failure — the salvage nudge
      // ("your reply contained reasoning") would be a lie, so it must not fire.
      expect(sendChatRequest).toHaveBeenCalledTimes(1);
      expect(result.markdown).toBe('');
      expect(result.emptyResponseContinuations).toBeUndefined();
    });
  });
});
