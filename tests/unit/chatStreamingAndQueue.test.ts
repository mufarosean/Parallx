// Unit tests for streamed thinking extraction and pending request queue — M13

import { describe, it, expect, beforeEach } from 'vitest';
import { _extractInlineThinking } from '../../src/built-in/chat/providers/ollamaProvider';
import { ChatService, CancellationTokenSource } from '../../src/services/chatService';
import { ChatAgentService } from '../../src/services/chatAgentService';
import { ChatModeService } from '../../src/services/chatModeService';
import { LanguageModelsService } from '../../src/services/languageModelsService';
import { ChatRequestQueueKind } from '../../src/services/chatTypes';
import type {
  IChatParticipant,
  IChatParticipantRequest,
  IChatParticipantContext,
  IChatResponseStream,
  ICancellationToken,
} from '../../src/services/chatTypes';

// ═══════════════════════════════════════════════════════════════════════════════
// Inline thinking extraction tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('_extractInlineThinking', () => {
  it('returns null when no think tags and not in tag', () => {
    expect(_extractInlineThinking('Hello world', false)).toBeNull();
  });

  it('extracts a complete think block', () => {
    const result = _extractInlineThinking(
      '<think>reasoning here</think>final answer',
      false,
    );
    expect(result).toEqual({
      content: 'final answer',
      thinking: 'reasoning here',
      stillInTag: false,
    });
  });

  it('handles opening tag without closing (cross-chunk)', () => {
    const result = _extractInlineThinking(
      'prefix<think>partial reasoning',
      false,
    );
    expect(result).toEqual({
      content: 'prefix',
      thinking: 'partial reasoning',
      stillInTag: true,
    });
  });

  it('continues thinking from previous chunk', () => {
    const result = _extractInlineThinking(
      'continued reasoning</think>answer',
      true,
    );
    expect(result).toEqual({
      content: 'answer',
      thinking: 'continued reasoning',
      stillInTag: false,
    });
  });

  it('handles still-in-tag continuation with no close', () => {
    const result = _extractInlineThinking(
      'more thinking words',
      true,
    );
    expect(result).toEqual({
      content: '',
      thinking: 'more thinking words',
      stillInTag: true,
    });
  });

  it('handles multiple think blocks in one chunk', () => {
    const result = _extractInlineThinking(
      '<think>first</think>middle<think>second</think>end',
      false,
    );
    expect(result).toEqual({
      content: 'middleend',
      thinking: 'firstsecond',
      stillInTag: false,
    });
  });

  it('handles empty think tags', () => {
    const result = _extractInlineThinking('<think></think>content', false);
    expect(result).toEqual({
      content: 'content',
      thinking: '',
      stillInTag: false,
    });
  });

  it('handles think tag at very end', () => {
    const result = _extractInlineThinking('content<think>', false);
    expect(result).toEqual({
      content: 'content',
      thinking: '',
      stillInTag: true,
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CancellationTokenSource yield tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('CancellationTokenSource.requestYield', () => {
  it('starts with yield not requested', () => {
    const cts = new CancellationTokenSource();
    expect(cts.token.isYieldRequested).toBe(false);
    cts.dispose();
  });

  it('sets yield after requestYield()', () => {
    const cts = new CancellationTokenSource();
    cts.requestYield();
    expect(cts.token.isYieldRequested).toBe(true);
    cts.dispose();
  });

  it('yield and cancel are independent', () => {
    const cts = new CancellationTokenSource();
    cts.requestYield();
    expect(cts.token.isCancellationRequested).toBe(false);
    expect(cts.token.isYieldRequested).toBe(true);
    cts.cancel();
    expect(cts.token.isCancellationRequested).toBe(true);
    expect(cts.token.isYieldRequested).toBe(true);
    cts.dispose();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ChatService pending request queue tests
// ═══════════════════════════════════════════════════════════════════════════════

function createSlowAgent(): IChatParticipant {
  return {
    id: 'parallx.chat.default',
    displayName: 'Default',
    description: 'Slow agent for queue tests',
    commands: [],
    handler: async (
      _request: IChatParticipantRequest,
      _context: IChatParticipantContext,
      response: IChatResponseStream,
      _token: ICancellationToken,
    ) => {
      response.markdown('Slow agent response');
      await new Promise((r) => setTimeout(r, 50));
      return {};
    },
  };
}

describe('ChatService pending request queue', () => {
  let chatService: ChatService;
  let agentService: ChatAgentService;
  let modeService: ChatModeService;
  let lmService: LanguageModelsService;

  beforeEach(() => {
    agentService = new ChatAgentService();
    modeService = new ChatModeService();
    lmService = new LanguageModelsService();
    chatService = new ChatService(agentService, modeService, lmService);
    agentService.registerAgent(createSlowAgent());
  });

  it('queues a Queued request onto a session', () => {
    const session = chatService.createSession();
    const pending = chatService.queueRequest(session.id, 'queued message', ChatRequestQueueKind.Queued);
    expect(pending.text).toBe('queued message');
    expect(pending.kind).toBe(ChatRequestQueueKind.Queued);
    expect(session.pendingRequests).toHaveLength(1);
    expect(session.pendingRequests[0].id).toBe(pending.id);
  });

  it('queues Steering at front of queue', () => {
    const session = chatService.createSession();
    chatService.queueRequest(session.id, 'first queued', ChatRequestQueueKind.Queued);
    chatService.queueRequest(session.id, 'steering msg', ChatRequestQueueKind.Steering);
    chatService.queueRequest(session.id, 'second queued', ChatRequestQueueKind.Queued);

    expect(session.pendingRequests).toHaveLength(3);
    expect(session.pendingRequests[0].text).toBe('steering msg');
    expect(session.pendingRequests[1].text).toBe('first queued');
    expect(session.pendingRequests[2].text).toBe('second queued');
  });

  it('removes a pending request by ID', () => {
    const session = chatService.createSession();
    const p1 = chatService.queueRequest(session.id, 'msg1', ChatRequestQueueKind.Queued);
    chatService.queueRequest(session.id, 'msg2', ChatRequestQueueKind.Queued);

    chatService.removePendingRequest(session.id, p1.id);
    expect(session.pendingRequests).toHaveLength(1);
    expect(session.pendingRequests[0].text).toBe('msg2');
  });

  it('remove is a no-op for non-existent ID', () => {
    const session = chatService.createSession();
    chatService.queueRequest(session.id, 'msg1', ChatRequestQueueKind.Queued);
    chatService.removePendingRequest(session.id, 'nonexistent');
    expect(session.pendingRequests).toHaveLength(1);
  });

  it('throws when queuing on non-existent session', () => {
    expect(() =>
      chatService.queueRequest('fake-session', 'msg', ChatRequestQueueKind.Queued),
    ).toThrow('Session not found');
  });

  it('fires onDidChangePendingRequests when queuing', () => {
    const session = chatService.createSession();
    let firedId: string | undefined;
    chatService.onDidChangePendingRequests((id) => { firedId = id; });
    chatService.queueRequest(session.id, 'msg', ChatRequestQueueKind.Queued);
    expect(firedId).toBe(session.id);
  });

  it('fires onDidChangePendingRequests when removing', () => {
    const session = chatService.createSession();
    const p = chatService.queueRequest(session.id, 'msg', ChatRequestQueueKind.Queued);
    let firedId: string | undefined;
    chatService.onDidChangePendingRequests((id) => { firedId = id; });
    chatService.removePendingRequest(session.id, p.id);
    expect(firedId).toBe(session.id);
  });

  it('steering request at front preserves insertion order among steering', () => {
    const session = chatService.createSession();
    chatService.queueRequest(session.id, 's1', ChatRequestQueueKind.Steering);
    chatService.queueRequest(session.id, 's2', ChatRequestQueueKind.Steering);
    chatService.queueRequest(session.id, 'q1', ChatRequestQueueKind.Queued);

    expect(session.pendingRequests[0].text).toBe('s1');
    expect(session.pendingRequests[1].text).toBe('s2');
    expect(session.pendingRequests[2].text).toBe('q1');
  });
});
