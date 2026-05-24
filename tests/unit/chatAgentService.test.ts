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
    mode: ChatMode.Agent,
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

  it('invokeAgent prefers a participant runtime when one is registered', async () => {
    const handler = vi.fn(async () => ({ metadata: { source: 'handler' } }));
    const runtimeHandleTurn = vi.fn(async () => ({ metadata: { source: 'runtime' } }));
    service.registerAgent({
      ...createMockParticipant('test.runtime', handler),
      runtime: { handleTurn: runtimeHandleTurn },
    });

    const result = await service.invokeAgent(
      'test.runtime',
      createMockRequest(),
      createMockContext(),
      createMockStream(),
      createMockToken(),
    );

    expect(runtimeHandleTurn).toHaveBeenCalledTimes(1);
    expect(handler).not.toHaveBeenCalled();
    expect(result).toEqual({ metadata: { source: 'runtime' } });
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

  it('invokeAgent reports a runtime failure trace when a handler throws', async () => {
    const handler = vi.fn(async () => { throw new Error('boom'); });
    const reportTrace = vi.fn();
    service.registerAgent(createMockParticipant('faulty', handler));

    await service.invokeAgent(
      'faulty',
      {
        ...createMockRequest(),
        turnState: {
          rawText: 'hello',
          effectiveText: 'hello',
          userText: 'hello',
          contextQueryText: 'hello',
          semantics: {
            rawText: 'hello',
            normalizedText: 'hello',
            strippedApostropheText: 'hello',
            isConversational: false,
            isExplicitMemoryRecall: false,
            isExplicitTranscriptRecall: false,
            isFileEnumeration: false,
            isExhaustiveWorkspaceReview: false,
            workflowTypeHint: 'generic-grounded',
          },
          queryScope: {
            level: 'workspace',
            derivedFrom: 'inferred',
            confidence: 1,
          },
          turnRoute: {
            kind: 'grounded',
            reason: 'test route',
            coverageMode: 'representative',
          },
          hasActiveSlashCommand: false,
          isRagReady: true,
        },
      },
      {
        ...createMockContext(),
        runtime: { reportTrace },
      },
      createMockStream(),
      createMockToken(),
    );

    expect(reportTrace).toHaveBeenCalledWith(expect.objectContaining({
      checkpoint: 'participant-handler-error',
      runState: 'failed',
      runtime: 'claw',
      sessionId: 'test-session',
      note: 'boom',
    }));
  });

  // ── Participant resolution priority (M82 §11 / audit Q3) ────────────────
  //
  // _resolveAgent priority order — pinned because Slice B / M82 chat-participant
  // contributions all rely on this lookup chain. Order must be:
  //   1. exact id match
  //   2. (only if id has no '.') `parallx.chat.<id>` namespace fallback
  //   3. case-insensitive `displayName` match
  describe('participant resolution priority (M82 §11 / audit Q3)', () => {
    it('exact id beats namespace fallback', () => {
      const direct = createMockParticipant('myExt.assistant');
      service.registerAgent(direct);
      // also register a namespaced "assistant" — the bare id "myExt.assistant"
      // contains a dot so namespace fallback is NOT considered.
      const namespaced = createMockParticipant('parallx.chat.assistant');
      service.registerAgent(namespaced);

      expect(service.getAgent('myExt.assistant')).toBe(direct);
    });

    it('bare id falls back to `parallx.chat.<id>` namespace match', () => {
      const builtin = createMockParticipant('parallx.chat.default');
      service.registerAgent(builtin);

      expect(service.getAgent('default')).toBe(builtin);
    });

    it('namespace fallback is NOT attempted when id contains a dot', () => {
      const builtin = createMockParticipant('parallx.chat.default');
      service.registerAgent(builtin);

      // "x.default" contains a dot → no namespace fallback → no display-name
      // match (displayName='parallx.chat.default') → undefined.
      expect(service.getAgent('x.default')).toBeUndefined();
    });

    it('case-insensitive displayName match is last-resort', () => {
      const agent: IChatParticipant = {
        ...createMockParticipant('opaque.id'),
        displayName: 'Researcher',
      };
      service.registerAgent(agent);

      expect(service.getAgent('researcher')).toBe(agent);
      expect(service.getAgent('RESEARCHER')).toBe(agent);
      expect(service.getAgent('  Researcher  ')).toBe(agent);
    });

    it('returns undefined when no rule matches', () => {
      service.registerAgent(createMockParticipant('a.b'));
      expect(service.getAgent('totally-unknown')).toBeUndefined();
    });
  });
});
