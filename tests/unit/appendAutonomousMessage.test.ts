/**
 * appendAutonomousMessage.test.ts — M58-real post-ship fix.
 *
 * Proves the ChatService.appendAutonomousMessage API used by the
 * ChatSurfacePlugin to inject heartbeat / cron / subagent result cards
 * into the user's active chat session without running a turn.
 *
 * Invariants:
 *   1. Appends a well-formed request/response pair to session.messages
 *   2. Fires onDidChangeSession so the widget re-renders
 *   3. Assistant response is marked complete with a single markdown part
 *   4. Rejects ephemeral session ids (autonomous cards must land in the
 *      parent, not in the ephemeral sub-run that produced them)
 *   5. Returns false for unknown session ids without throwing
 *   6. Default requestText carries the origin marker
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ChatService } from '../../src/services/chatService';
import { ChatAgentService } from '../../src/services/chatAgentService';
import { ChatModeService } from '../../src/services/chatModeService';
import { LanguageModelsService } from '../../src/services/languageModelsService';
import { ChatContentPartKind, ChatMode } from '../../src/services/chatTypes';

describe('ChatService.appendAutonomousMessage (M58-real)', () => {
  let chatService: ChatService;

  beforeEach(() => {
    const agentService = new ChatAgentService();
    const modeService = new ChatModeService();
    const lmService = new LanguageModelsService();
    chatService = new ChatService(agentService, modeService, lmService);
  });

  it('appends a pair with markdown content and fires change event', () => {
    const session = chatService.createSession(ChatMode.Agent);
    let fired = 0;
    chatService.onDidChangeSession(() => { fired++; });

    const ok = chatService.appendAutonomousMessage(session.id, {
      content: 'heartbeat completed: 3 files indexed',
      origin: 'heartbeat',
    });

    expect(ok).toBe(true);
    expect(fired).toBe(1);
    expect(session.messages).toHaveLength(1);
    const pair = session.messages[0];
    expect(pair.request.text).toBe('[heartbeat]');
    expect(pair.response.isComplete).toBe(true);
    expect(pair.response.parts).toHaveLength(1);
    expect(pair.response.parts[0].kind).toBe(ChatContentPartKind.Markdown);
    expect((pair.response.parts[0] as { content: string }).content)
      .toBe('heartbeat completed: 3 files indexed');
  });

  it('honours custom requestText', () => {
    const session = chatService.createSession(ChatMode.Agent);
    chatService.appendAutonomousMessage(session.id, {
      content: 'x',
      origin: 'cron',
      requestText: '[cron · nightly-digest]',
    });
    expect(session.messages[0].request.text).toBe('[cron · nightly-digest]');
  });

  it('rejects ephemeral session ids', () => {
    const parent = chatService.createSession(ChatMode.Agent);
    const handle = chatService.createEphemeralSession(parent.id);
    const ok = chatService.appendAutonomousMessage(handle.sessionId, {
      content: 'stray',
      origin: 'subagent',
    });
    expect(ok).toBe(false);
    // Parent must not be mutated either
    expect(parent.messages).toHaveLength(0);
  });

  it('returns false for unknown session without throwing', () => {
    const ok = chatService.appendAutonomousMessage('no-such-id', {
      content: 'x',
      origin: 'heartbeat',
    });
    expect(ok).toBe(false);
  });

  it('each append generates a unique request id', () => {
    const session = chatService.createSession(ChatMode.Agent);
    chatService.appendAutonomousMessage(session.id, { content: 'a', origin: 'heartbeat' });
    chatService.appendAutonomousMessage(session.id, { content: 'b', origin: 'heartbeat' });
    expect(session.messages).toHaveLength(2);
    expect(session.messages[0].request.requestId).not.toBe(session.messages[1].request.requestId);
  });
});
