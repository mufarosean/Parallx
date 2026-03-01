// Unit tests for ChatService — M9.0

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChatService } from '../../src/services/chatService';
import { ChatAgentService } from '../../src/services/chatAgentService';
import { ChatModeService } from '../../src/services/chatModeService';
import { LanguageModelsService } from '../../src/services/languageModelsService';
import { ChatMode } from '../../src/services/chatTypes';
import type {
  IChatParticipant,
  IChatParticipantRequest,
  IChatParticipantContext,
  IChatResponseStream,
  ICancellationToken,
} from '../../src/services/chatTypes';

function createDefaultAgent(): IChatParticipant {
  return {
    id: 'parallx.chat.default',
    displayName: 'Default',
    description: 'Default agent for tests',
    commands: [],
    handler: async (
      _request: IChatParticipantRequest,
      _context: IChatParticipantContext,
      response: IChatResponseStream,
      _token: ICancellationToken,
    ) => {
      response.markdown('Hello from default agent');
      return {};
    },
  };
}

describe('ChatService', () => {
  let chatService: ChatService;
  let agentService: ChatAgentService;
  let modeService: ChatModeService;
  let lmService: LanguageModelsService;

  beforeEach(() => {
    agentService = new ChatAgentService();
    modeService = new ChatModeService();
    lmService = new LanguageModelsService();
    chatService = new ChatService(agentService, modeService, lmService);

    // Register default agent
    agentService.registerAgent(createDefaultAgent());
  });

  // ── Session Lifecycle ──

  describe('session lifecycle', () => {
    it('createSession creates a session with a unique ID', () => {
      const session = chatService.createSession();
      expect(session.id).toBeTruthy();
      expect(session.messages).toHaveLength(0);
      expect(session.requestInProgress).toBe(false);
      expect(session.title).toBe('New Chat');
    });

    it('createSession fires onDidCreateSession', () => {
      const listener = vi.fn();
      chatService.onDidCreateSession(listener);

      const session = chatService.createSession();
      expect(listener).toHaveBeenCalledWith(session);
    });

    it('createSession uses provided mode', () => {
      const session = chatService.createSession(ChatMode.Agent);
      expect(session.mode).toBe(ChatMode.Agent);
    });

    it('createSession defaults to the mode service mode', () => {
      modeService.setMode(ChatMode.Edit);
      const session = chatService.createSession();
      expect(session.mode).toBe(ChatMode.Edit);
    });

    it('getSession returns session by ID', () => {
      const session = chatService.createSession();
      expect(chatService.getSession(session.id)).toBe(session);
    });

    it('getSession returns undefined for unknown ID', () => {
      expect(chatService.getSession('nonexistent')).toBeUndefined();
    });

    it('getSessions returns all sessions', () => {
      chatService.createSession();
      chatService.createSession();
      expect(chatService.getSessions()).toHaveLength(2);
    });

    it('deleteSession removes the session', () => {
      const session = chatService.createSession();
      chatService.deleteSession(session.id);
      expect(chatService.getSession(session.id)).toBeUndefined();
    });

    it('deleteSession fires onDidDeleteSession', () => {
      const listener = vi.fn();
      chatService.onDidDeleteSession(listener);

      const session = chatService.createSession();
      chatService.deleteSession(session.id);
      expect(listener).toHaveBeenCalledWith(session.id);
    });

    it('session has a valid URI', () => {
      const session = chatService.createSession();
      expect(session.sessionResource.scheme).toBe('parallx-chat-session');
      expect(session.sessionResource.path).toContain(session.id);
    });
  });

  // ── Request Orchestration ──

  describe('sendRequest', () => {
    it('sends a message and invokes the default agent', async () => {
      const session = chatService.createSession();
      const result = await chatService.sendRequest(session.id, 'Hello');

      expect(result).toBeDefined();
      expect(session.messages).toHaveLength(1);
      expect(session.messages[0].request.text).toBe('Hello');
      expect(session.messages[0].response.isComplete).toBe(true);
    });

    it('auto-generates title from first message', async () => {
      const session = chatService.createSession();
      await chatService.sendRequest(session.id, 'What is TypeScript?');

      expect(session.title).toBe('What is TypeScript?');
    });

    it('truncates long titles to ~50 chars', async () => {
      const session = chatService.createSession();
      const longMsg = 'A'.repeat(100);
      await chatService.sendRequest(session.id, longMsg);

      expect(session.title.length).toBeLessThanOrEqual(50);
      expect(session.title).toContain('...');
    });

    it('fires onDidChangeSession during request', async () => {
      const listener = vi.fn();
      chatService.onDidChangeSession(listener);

      const session = chatService.createSession();
      await chatService.sendRequest(session.id, 'Hi');

      // Should be called multiple times: start, response update(s), finalize
      expect(listener).toHaveBeenCalled();
      expect(listener.mock.calls.every((call: [string]) => call[0] === session.id)).toBe(true);
    });

    it('throws for nonexistent session', async () => {
      await expect(chatService.sendRequest('bad-id', 'Hello'))
        .rejects.toThrow('not found');
    });

    it('throws for concurrent requests', async () => {
      const slowAgent: IChatParticipant = {
        id: 'parallx.chat.default',
        displayName: 'Slow',
        description: 'Slow agent',
        commands: [],
        handler: async (_req, _ctx, _resp, _tok) => {
          await new Promise((r) => setTimeout(r, 100));
          return {};
        },
      };

      // Replace default agent with slow one
      const svc2 = new ChatAgentService();
      svc2.registerAgent(slowAgent);
      const cs2 = new ChatService(svc2, modeService, lmService);

      const session = cs2.createSession();
      const p1 = cs2.sendRequest(session.id, 'First');

      await expect(cs2.sendRequest(session.id, 'Second'))
        .rejects.toThrow('already in progress');

      await p1; // Clean up
    });

    it('agent response parts appear in session', async () => {
      const session = chatService.createSession();
      await chatService.sendRequest(session.id, 'Hi');

      const responseParts = session.messages[0].response.parts;
      expect(responseParts.length).toBeGreaterThan(0);
    });

    it('cancelRequest stops an in-progress request', async () => {
      const abortSeen = vi.fn();
      const longAgent: IChatParticipant = {
        id: 'parallx.chat.default',
        displayName: 'Long',
        description: 'Long-running agent',
        commands: [],
        handler: async (_req, _ctx, _resp, token) => {
          token.onCancellationRequested(() => abortSeen());
          await new Promise((r) => setTimeout(r, 200));
          return {};
        },
      };

      const svc = new ChatAgentService();
      svc.registerAgent(longAgent);
      const cs = new ChatService(svc, modeService, lmService);

      const session = cs.createSession();
      const promise = cs.sendRequest(session.id, 'Long task');

      // Cancel after a short delay
      setTimeout(() => cs.cancelRequest(session.id), 20);

      await promise;
      expect(abortSeen).toHaveBeenCalled();
    });
  });
});
