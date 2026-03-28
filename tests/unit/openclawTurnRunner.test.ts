import { describe, expect, it, vi, beforeEach } from 'vitest';

import type {
  IChatParticipantRequest,
  IChatResponseStream,
  ICancellationToken,
} from '../../src/services/chatTypes';
import type { IOpenclawTurnContext } from '../../src/openclaw/openclawAttempt';
import type { IOpenclawAssembleResult, IOpenclawContextEngine } from '../../src/openclaw/openclawContextEngine';
import { runOpenclawTurn } from '../../src/openclaw/openclawTurnRunner';
import * as attemptModule from '../../src/openclaw/openclawAttempt';

vi.mock('../../src/openclaw/openclawAttempt', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/openclaw/openclawAttempt')>();
  return {
    ...original,
    executeOpenclawAttempt: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// Test helpers (mirrors openclawReadOnlyTurnRunner.test.ts patterns)
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

function createEngine(overrides?: Partial<IOpenclawContextEngine>): IOpenclawContextEngine {
  return {
    bootstrap: vi.fn(async () => ({ ragReady: true, memoryReady: true, conceptsReady: true })),
    assemble: vi.fn(async (): Promise<IOpenclawAssembleResult> => ({
      messages: [{ role: 'user', content: 'Hello' }],
      estimatedTokens: 100,
      ragSources: [],
      retrievedContextText: '',
    })),
    compact: vi.fn(async () => ({ compacted: true, tokensBefore: 1000, tokensAfter: 500 })),
    afterTurn: vi.fn(async () => {}),
    ...overrides,
  };
}

function createRequest(text = 'Hello'): IChatParticipantRequest {
  return { text, attachments: [], command: undefined } as unknown as IChatParticipantRequest;
}

function createContext(overrides?: Partial<IOpenclawTurnContext>): IOpenclawTurnContext {
  return {
    sessionId: 'test-session',
    history: [],
    tokenBudget: 8192,
    engine: createEngine(),
    bootstrapFiles: [],
    bootstrapDebugReport: {} as any,
    workspaceDigest: '',
    skillState: {} as any,
    runtimeInfo: { model: 'qwen2.5:7b', provider: 'ollama', host: 'localhost', parallxVersion: '0.1.0' },
    toolState: { availableDefinitions: [] } as any,
    maxToolIterations: 6,
    sendChatRequest: vi.fn(),
    ...overrides,
  };
}

const successResult = {
  markdown: 'Hello world',
  thinking: '',
  toolCallCount: 0,
  promptTokens: 100,
  completionTokens: 50,
  ragSources: [],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('openclawTurnRunner', () => {
  const mockExecute = attemptModule.executeOpenclawAttempt as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    mockExecute.mockReset();
  });

  it('successful turn — happy path', async () => {
    mockExecute.mockResolvedValueOnce(successResult);

    const response = createResponse();
    const result = await runOpenclawTurn(createRequest(), createContext(), response, createToken());

    expect(result.markdown).toBe('Hello world');
    expect(result.overflowCompactions).toBe(0);
    expect(result.transientRetries).toBe(0);
    expect(result.timeoutCompactions).toBe(0);
  });

  it('context overflow → compact → retry succeeds', async () => {
    mockExecute
      .mockRejectedValueOnce(new Error('context length exceeded'))
      .mockResolvedValueOnce(successResult);

    const engine = createEngine();
    const response = createResponse();
    const result = await runOpenclawTurn(
      createRequest(),
      createContext({ engine }),
      response,
      createToken(),
    );

    expect(result.markdown).toBe('Hello world');
    expect(result.overflowCompactions).toBe(1);
    expect(engine.compact).toHaveBeenCalledTimes(1);
    expect(response.progress).toHaveBeenCalledWith(expect.stringContaining('overflow'));
  });

  it('max overflow retries exhausted (4 overflows → throws on 4th)', async () => {
    mockExecute.mockRejectedValue(new Error('context length exceeded'));

    const engine = createEngine();
    const response = createResponse();

    await expect(
      runOpenclawTurn(createRequest(), createContext({ engine }), response, createToken()),
    ).rejects.toThrow('context length exceeded');

    // 3 compacts + throws on 4th
    expect(engine.compact).toHaveBeenCalledTimes(3);
  });

  it('timeout → force compact → retry succeeds', async () => {
    mockExecute
      .mockRejectedValueOnce(new Error('request timeout after 30s'))
      .mockResolvedValueOnce(successResult);

    const engine = createEngine();
    const response = createResponse();
    const result = await runOpenclawTurn(
      createRequest(),
      createContext({ engine }),
      response,
      createToken(),
    );

    expect(result.markdown).toBe('Hello world');
    expect(result.timeoutCompactions).toBe(1);
    expect(engine.compact).toHaveBeenCalledWith(
      expect.objectContaining({ force: true }),
    );
  });

  it('max timeout retries exhausted', async () => {
    mockExecute.mockRejectedValue(new Error('request timeout'));

    const engine = createEngine();

    await expect(
      runOpenclawTurn(createRequest(), createContext({ engine }), createResponse(), createToken()),
    ).rejects.toThrow('request timeout');

    // 2 timeout compacts then throws
    expect(engine.compact).toHaveBeenCalledTimes(2);
  });

  it('transient → delay → retry succeeds', async () => {
    vi.useFakeTimers();
    mockExecute
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(successResult);

    const response = createResponse();
    const promise = runOpenclawTurn(
      createRequest(),
      createContext(),
      response,
      createToken(),
    );

    await vi.advanceTimersByTimeAsync(20_000);
    const result = await promise;

    expect(result.markdown).toBe('Hello world');
    expect(result.transientRetries).toBe(1);
    expect(response.progress).toHaveBeenCalledWith(expect.stringContaining('Transient error'));

    vi.useRealTimers();
  });

  it('max transient retries exhausted', async () => {
    // Replace setTimeout to resolve immediately (avoid real delays)
    const origSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = ((fn: () => void) => origSetTimeout(fn, 0)) as any;

    mockExecute.mockImplementation(async () => {
      throw new Error('ECONNREFUSED');
    });

    await expect(
      runOpenclawTurn(createRequest(), createContext(), createResponse(), createToken()),
    ).rejects.toThrow('ECONNREFUSED');

    // 1 original + 3 retries = 4 total
    expect(mockExecute).toHaveBeenCalledTimes(4);

    globalThis.setTimeout = origSetTimeout;
  });

  it('cancellation respected', async () => {
    const token = createToken(true);
    const result = await runOpenclawTurn(createRequest(), createContext(), createResponse(), token);

    expect(result.markdown).toBe('');
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('context engine bootstrap called once', async () => {
    mockExecute.mockResolvedValueOnce(successResult);

    const engine = createEngine();
    await runOpenclawTurn(createRequest(), createContext({ engine }), createResponse(), createToken());

    expect(engine.bootstrap).toHaveBeenCalledTimes(1);
    expect(engine.bootstrap).toHaveBeenCalledWith({
      sessionId: 'test-session',
      tokenBudget: 8192,
    });
  });

  it('model fallback on model error', async () => {
    mockExecute
      .mockRejectedValueOnce(new Error('out of memory allocating tensor'))
      .mockResolvedValueOnce(successResult);

    const fallbackSend = vi.fn();
    const response = createResponse();
    const result = await runOpenclawTurn(
      createRequest(),
      createContext({
        fallbackModels: ['llama3:32b', 'phi3:8b'],
        rebuildSendChatRequest: () => fallbackSend,
      }),
      response,
      createToken(),
    );

    expect(result.markdown).toBe('Hello world');
    expect(response.progress).toHaveBeenCalledWith(
      expect.stringContaining('falling back to llama3:32b'),
    );
  });

  it('all fallback models fail → throws', async () => {
    mockExecute.mockRejectedValue(new Error('model not found'));

    await expect(
      runOpenclawTurn(
        createRequest(),
        createContext({
          fallbackModels: ['modelA', 'modelB'],
          rebuildSendChatRequest: () => vi.fn(),
        }),
        createResponse(),
        createToken(),
      ),
    ).rejects.toThrow('model not found');

    // Original attempt + 2 fallback attempts = 3
    expect(mockExecute).toHaveBeenCalledTimes(3);
  });

  it('proactive compaction at >80% budget', async () => {
    mockExecute.mockResolvedValueOnce(successResult);

    const engine = createEngine({
      assemble: vi.fn()
        .mockResolvedValueOnce({
          messages: [{ role: 'user', content: 'Hello' }],
          estimatedTokens: 7000, // >80% of 8192
          ragSources: [],
          retrievedContextText: '',
        })
        .mockResolvedValueOnce({
          messages: [{ role: 'user', content: 'Hello' }],
          estimatedTokens: 3000,
          ragSources: [],
          retrievedContextText: '',
        }),
    });

    const response = createResponse();
    const result = await runOpenclawTurn(
      createRequest(),
      createContext({ engine }),
      response,
      createToken(),
    );

    expect(result.markdown).toBe('Hello world');
    expect(engine.compact).toHaveBeenCalledTimes(1);
    expect(response.progress).toHaveBeenCalledWith(expect.stringContaining('auto-compacting'));
  });

  // -----------------------------------------------------------------------
  // Iteration 2 refinement tests
  // -----------------------------------------------------------------------

  it('model fallback resets retry counters for each model candidate (upstream pattern)', async () => {
    // Model A: overflow once, then model error
    // Model B: should get fresh overflow retry budget
    mockExecute
      .mockRejectedValueOnce(new Error('context length exceeded'))  // A: overflow
      .mockRejectedValueOnce(new Error('out of memory'))            // A: model error
      .mockRejectedValueOnce(new Error('context length exceeded'))  // B: overflow (fresh counter)
      .mockResolvedValueOnce(successResult);                        // B: success

    const engine = createEngine();
    const fallbackSend = vi.fn();
    const response = createResponse();
    const result = await runOpenclawTurn(
      createRequest(),
      createContext({
        engine,
        fallbackModels: ['modelB'],
        rebuildSendChatRequest: () => fallbackSend,
      }),
      response,
      createToken(),
    );

    expect(result.markdown).toBe('Hello world');
    // Compactions: 1 for model A overflow + 1 for model B overflow = 2
    expect(engine.compact).toHaveBeenCalledTimes(2);
  });

  it('model fallback skipped when rebuildSendChatRequest is undefined', async () => {
    // If fallbackModels is defined but rebuildSendChatRequest is not,
    // the model fallback branch should NOT be entered — error should propagate
    mockExecute.mockRejectedValue(new Error('out of memory'));

    await expect(
      runOpenclawTurn(
        createRequest(),
        createContext({
          fallbackModels: ['modelA', 'modelB'],
          rebuildSendChatRequest: undefined,
        }),
        createResponse(),
        createToken(),
      ),
    ).rejects.toThrow('out of memory');

    // Only 1 attempt — no fallback retries since rebuild is unavailable
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  it('proactive compaction uses independent counter from error-path compaction', async () => {
    // Proactive compact uses all 3 budget → error-path overflow should still get 3 retries
    mockExecute
      .mockRejectedValueOnce(new Error('context length exceeded'))
      .mockRejectedValueOnce(new Error('context length exceeded'))
      .mockRejectedValueOnce(new Error('context length exceeded'))
      .mockResolvedValueOnce(successResult);

    const assembleCount = { value: 0 };
    const engine = createEngine({
      assemble: vi.fn(async (): Promise<IOpenclawAssembleResult> => {
        assembleCount.value++;
        // First 3 assemblies return high tokens (triggers proactive compact)
        // Then normal
        if (assembleCount.value <= 3) {
          return {
            messages: [{ role: 'user', content: 'Hello' }],
            estimatedTokens: 7000,
            ragSources: [],
            retrievedContextText: '',
          };
        }
        return {
          messages: [{ role: 'user', content: 'Hello' }],
          estimatedTokens: 100,
          ragSources: [],
          retrievedContextText: '',
        };
      }),
    });

    const response = createResponse();
    const result = await runOpenclawTurn(
      createRequest(),
      createContext({ engine }),
      response,
      createToken(),
    );

    // 3 proactive compacts + 3 error-path compacts = 6 total compacts
    // (proactive counter is independent, doesn't consume error-path budget)
    expect(result.markdown).toBe('Hello world');
    expect(engine.compact).toHaveBeenCalledTimes(6);
  });

  it('compact failure during overflow rethrows original error', async () => {
    mockExecute.mockRejectedValueOnce(new Error('context length exceeded'));

    const engine = createEngine({
      compact: vi.fn(async () => { throw new Error('compact disk full'); }),
    });

    await expect(
      runOpenclawTurn(createRequest(), createContext({ engine }), createResponse(), createToken()),
    ).rejects.toThrow('context length exceeded');
  });

  it('compact failure during timeout rethrows original error', async () => {
    mockExecute.mockRejectedValueOnce(new Error('request timeout'));

    const engine = createEngine({
      compact: vi.fn(async () => { throw new Error('compact disk full'); }),
    });

    await expect(
      runOpenclawTurn(createRequest(), createContext({ engine }), createResponse(), createToken()),
    ).rejects.toThrow('request timeout');
  });

  // -----------------------------------------------------------------------
  // D3: Steer Check — upstream L1 runReplyAgent step 1
  // -----------------------------------------------------------------------

  describe('steer check (D3)', () => {
    it('steering turn sets isSteeringTurn in result', async () => {
      mockExecute.mockResolvedValueOnce(successResult);

      const result = await runOpenclawTurn(
        createRequest(),
        createContext({ isSteeringTurn: true }),
        createResponse(),
        createToken(),
      );

      expect(result.isSteeringTurn).toBe(true);
    });

    it('non-steering turn sets isSteeringTurn to false', async () => {
      mockExecute.mockResolvedValueOnce(successResult);

      const result = await runOpenclawTurn(
        createRequest(),
        createContext(),
        createResponse(),
        createToken(),
      );

      expect(result.isSteeringTurn).toBe(false);
    });

    it('steering turn shows progress notification', async () => {
      mockExecute.mockResolvedValueOnce(successResult);
      const response = createResponse();

      await runOpenclawTurn(
        createRequest(),
        createContext({ isSteeringTurn: true }),
        response,
        createToken(),
      );

      expect(response.progress).toHaveBeenCalledWith('Processing steering message...');
    });

    it('non-steering turn skips steer progress', async () => {
      mockExecute.mockResolvedValueOnce(successResult);
      const response = createResponse();

      await runOpenclawTurn(
        createRequest(),
        createContext(),
        response,
        createToken(),
      );

      expect(response.progress).not.toHaveBeenCalledWith('Processing steering message...');
    });

    it('cancelled steering turn preserves isSteeringTurn', async () => {
      const result = await runOpenclawTurn(
        createRequest(),
        createContext({ isSteeringTurn: true }),
        createResponse(),
        createToken(true),
      );

      expect(result.markdown).toBe('');
      expect(result.isSteeringTurn).toBe(true);
    });
  });
});
