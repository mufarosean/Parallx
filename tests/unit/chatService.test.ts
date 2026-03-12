// Unit tests for ChatService — M9.0

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChatService } from '../../src/services/chatService';
import { ChatAgentService } from '../../src/services/chatAgentService';
import { ChatModeService } from '../../src/services/chatModeService';
import { LanguageModelsService } from '../../src/services/languageModelsService';
import { ChatMode, ChatContentPartKind } from '../../src/services/chatTypes';
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
      expect(session.messages[0].request.requestId).toBeTruthy();
      expect(session.messages[0].request.attempt).toBe(0);
      expect(session.messages[0].response.isComplete).toBe(true);
    });

    it('stores replay metadata for regenerated requests', async () => {
      const session = chatService.createSession();
      await chatService.sendRequest(session.id, 'Hello');

      const original = session.messages[0].request;
      await chatService.sendRequest(session.id, original.text, {
        attachments: original.attachments,
        attempt: original.attempt + 1,
        replayOfRequestId: original.requestId,
      });

      expect(session.messages).toHaveLength(1);
      expect(session.messages[0].request.attempt).toBe(1);
      expect(session.messages[0].request.replayOfRequestId).toBe(original.requestId);
      expect(session.messages[0].request.requestId).not.toBe(original.requestId);
    });

    it('replaces the replayed turn instead of appending a duplicate assistant response', async () => {
      const session = chatService.createSession();
      await chatService.sendRequest(session.id, 'Hello');

      const originalRequestId = session.messages[0].request.requestId;

      await chatService.sendRequest(session.id, 'Hello', {
        attempt: 1,
        replayOfRequestId: originalRequestId,
      });

      expect(session.messages).toHaveLength(1);
      expect(session.messages[0].request.requestId).not.toBe(originalRequestId);
      expect(session.messages[0].request.replayOfRequestId).toBe(originalRequestId);
      expect(session.messages[0].response.parts[0]).toMatchObject({
        kind: ChatContentPartKind.Markdown,
        content: 'Hello from default agent',
      });
    });

    it('drops trailing turns when replaying an earlier request', async () => {
      const session = chatService.createSession();
      await chatService.sendRequest(session.id, 'First');
      await chatService.sendRequest(session.id, 'Second');

      const original = session.messages[0].request;
      await chatService.sendRequest(session.id, original.text, {
        attempt: original.attempt + 1,
        replayOfRequestId: original.requestId,
      });

      expect(session.messages).toHaveLength(1);
      expect(session.messages[0].request.text).toBe('First');
      expect(session.messages[0].request.attempt).toBe(1);
    });

    it('collapses old replay chains when regenerating a duplicated session', async () => {
      const session = chatService.createSession();

      session.messages.push(
        {
          request: {
            text: 'Hello',
            requestId: 'req-1',
            attempt: 0,
            timestamp: 1,
          },
          response: {
            parts: [{ kind: ChatContentPartKind.Markdown, content: 'Old answer' }],
            isComplete: true,
            modelId: session.modelId,
            timestamp: 2,
          },
        },
        {
          request: {
            text: 'Hello',
            requestId: 'req-2',
            attempt: 1,
            replayOfRequestId: 'req-1',
            timestamp: 3,
          },
          response: {
            parts: [{ kind: ChatContentPartKind.Markdown, content: 'Duplicate answer' }],
            isComplete: true,
            modelId: session.modelId,
            timestamp: 4,
          },
        },
      );

      await chatService.sendRequest(session.id, 'Hello', {
        attempt: 2,
        replayOfRequestId: 'req-2',
      });

      expect(session.messages).toHaveLength(1);
      expect(session.messages[0].request.text).toBe('Hello');
      expect(session.messages[0].request.attempt).toBe(2);
      expect(session.messages[0].request.replayOfRequestId).toBe('req-2');
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

    it('supports detached response stream methods during agent execution', async () => {
      const detachedAgent: IChatParticipant = {
        id: 'parallx.chat.default',
        displayName: 'Detached',
        description: 'Detached method regression coverage',
        commands: [],
        handler: async (_req, _ctx, response) => {
          const writeWarning = response.warning;
          const writeMarkdown = response.markdown;
          writeWarning('Detached warning');
          writeMarkdown('Detached markdown');
          return {};
        },
      };

      const svc = new ChatAgentService();
      svc.registerAgent(detachedAgent);
      const cs = new ChatService(svc, modeService, lmService);

      const session = cs.createSession();
      const result = await cs.sendRequest(session.id, 'Hello');

      expect(result).toEqual({});
      expect(session.messages[0].response.parts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: ChatContentPartKind.Warning, message: 'Detached warning' }),
          expect.objectContaining({ kind: ChatContentPartKind.Markdown, content: 'Detached markdown' }),
        ]),
      );
    });
  });

  // ── Unified Thinking — progress/reference fold into thinking ──

  describe('unified thinking stream', () => {
    it('progress() folds into existing thinking part', async () => {
      const agent: IChatParticipant = {
        id: 'parallx.chat.default',
        displayName: 'Test',
        description: 'Test',
        commands: [],
        handler: async (_req, _ctx, response) => {
          response.thinking('Planning...');
          response.progress('Searching 3 sources…');
          response.markdown('Result');
          return {};
        },
      };
      const svc = new ChatAgentService();
      svc.registerAgent(agent);
      const cs = new ChatService(svc, modeService, lmService);
      const session = cs.createSession();
      await cs.sendRequest(session.id, 'test');

      const parts = session.messages[0].response.parts;
      // Thinking should be first part
      expect(parts[0].kind).toBe(ChatContentPartKind.Thinking);
      // No standalone Progress parts
      expect(parts.find(p => p.kind === ChatContentPartKind.Progress)).toBeUndefined();
    });

    it('reference() folds into existing thinking part', async () => {
      const agent: IChatParticipant = {
        id: 'parallx.chat.default',
        displayName: 'Test',
        description: 'Test',
        commands: [],
        handler: async (_req, _ctx, response) => {
          response.thinking('Finding context...');
          response.reference('file://test.md', 'test.md');
          response.reference('file://notes.md', 'notes.md');
          response.markdown('Answer');
          return {};
        },
      };
      const svc = new ChatAgentService();
      svc.registerAgent(agent);
      const cs = new ChatService(svc, modeService, lmService);
      const session = cs.createSession();
      await cs.sendRequest(session.id, 'test');

      const parts = session.messages[0].response.parts;
      // Only thinking + markdown — no standalone Reference parts
      expect(parts.find(p => p.kind === ChatContentPartKind.Reference)).toBeUndefined();
      const thinking = parts.find(p => p.kind === ChatContentPartKind.Thinking) as any;
      expect(thinking).toBeDefined();
      expect(thinking.provenance).toHaveLength(2);
      expect(thinking.provenance[0].label).toBe('test.md');
    });

    it('reference() stores index when provided', async () => {
      const agent: IChatParticipant = {
        id: 'parallx.chat.default',
        displayName: 'Test',
        description: 'Test',
        commands: [],
        handler: async (_req, _ctx, response) => {
          response.thinking('Finding context...');
          response.reference('file://test.md', 'test.md', 1);
          response.reference('file://notes.md', 'notes.md', 2);
          response.markdown('Answer');
          return {};
        },
      };
      const svc = new ChatAgentService();
      svc.registerAgent(agent);
      const cs = new ChatService(svc, modeService, lmService);
      const session = cs.createSession();
      await cs.sendRequest(session.id, 'test');

      const parts = session.messages[0].response.parts;
      const thinking = parts.find(p => p.kind === ChatContentPartKind.Thinking) as any;
      expect(thinking.provenance[0].index).toBe(1);
      expect(thinking.provenance[1].index).toBe(2);
    });

    it('setCitations() attaches citations to all markdown parts', async () => {
      const agent: IChatParticipant = {
        id: 'parallx.chat.default',
        displayName: 'Test',
        description: 'Test',
        commands: [],
        handler: async (_req, _ctx, response) => {
          response.markdown('See [1] for details.');
          response.setCitations([
            { index: 1, uri: 'file://test.md', label: 'test.md' },
          ]);
          return {};
        },
      };
      const svc = new ChatAgentService();
      svc.registerAgent(agent);
      const cs = new ChatService(svc, modeService, lmService);
      const session = cs.createSession();
      await cs.sendRequest(session.id, 'test');

      const parts = session.messages[0].response.parts;
      const md = parts.find(p => p.kind === ChatContentPartKind.Markdown) as any;
      expect(md.citations).toHaveLength(1);
      expect(md.citations[0].index).toBe(1);
      expect(md.citations[0].label).toBe('test.md');
    });

    it('progress creates thinking when none exists', async () => {
      const agent: IChatParticipant = {
        id: 'parallx.chat.default',
        displayName: 'Test',
        description: 'Test',
        commands: [],
        handler: async (_req, _ctx, response) => {
          response.progress('Searching…');
          response.markdown('Done');
          return {};
        },
      };
      const svc = new ChatAgentService();
      svc.registerAgent(agent);
      const cs = new ChatService(svc, modeService, lmService);
      const session = cs.createSession();
      await cs.sendRequest(session.id, 'test');

      const parts = session.messages[0].response.parts;
      // A thinking part should exist (created by progress)
      const thinking = parts.find(p => p.kind === ChatContentPartKind.Thinking) as any;
      expect(thinking).toBeDefined();
      // progressMessage should be cleared after close()
      expect(thinking.progressMessage).toBeUndefined();
    });

    it('retains a progress-only thinking part after close()', async () => {
      const agent: IChatParticipant = {
        id: 'parallx.chat.default',
        displayName: 'Test',
        description: 'Test',
        commands: [],
        handler: async (_req, _ctx, response) => {
          response.progress('Thinking…');
          response.markdown('Done');
          return {};
        },
      };
      const svc = new ChatAgentService();
      svc.registerAgent(agent);
      const cs = new ChatService(svc, modeService, lmService);
      const session = cs.createSession();
      await cs.sendRequest(session.id, 'test');

      const parts = session.messages[0].response.parts;
      const thinking = parts.find(p => p.kind === ChatContentPartKind.Thinking) as any;
      expect(thinking).toBeDefined();
      expect(thinking.progressMessage).toBeUndefined();
      expect(parts[0].kind).toBe(ChatContentPartKind.Thinking);
    });

    it('thinking part appears first after close()', async () => {
      const agent: IChatParticipant = {
        id: 'parallx.chat.default',
        displayName: 'Test',
        description: 'Test',
        commands: [],
        handler: async (_req, _ctx, response) => {
          response.markdown('Some text first');
          response.thinking('model thinking');
          response.markdown(' more text');
          return {};
        },
      };
      const svc = new ChatAgentService();
      svc.registerAgent(agent);
      const cs = new ChatService(svc, modeService, lmService);
      const session = cs.createSession();
      await cs.sendRequest(session.id, 'test');

      const parts = session.messages[0].response.parts;
      expect(parts[0].kind).toBe(ChatContentPartKind.Thinking); // Thinking is first
    });
  });});

describe('default participant integration helpers', () => {
  it('does not replace streamed markdown with an empty string after narration cleanup', async () => {
    const { createDefaultParticipant } = await import('../../src/built-in/chat/participants/defaultParticipant');

    const sendChatRequest = vi.fn().mockReturnValue((async function* () {
      yield {
        content: 'The user wants to know the number of files in the workspace.',
        done: true,
      };
    })());

    const services = {
      sendChatRequest,
      getActiveModel: () => 'test-model',
      getWorkspaceName: () => 'Test Workspace',
      getPageCount: async () => 5,
      getCurrentPageTitle: () => undefined,
      getToolDefinitions: () => [],
      getReadOnlyToolDefinitions: () => [],
      invokeTool: vi.fn(async () => ({ content: 'tool result' })),
      maxIterations: 10,
    } as any;

    const participant = createDefaultParticipant(services);
    const stream = {
      calls: { markdown: [] as string[] },
      markdown(content: string) { this.calls.markdown.push(content); },
      thinking() {}, progress() {}, reference() {}, warning() {}, confirmation() {},
      beginToolInvocation() { return '1'; }, updateToolInvocation() {},
      endToolInvocation() {}, codeBlock() {}, replaceLastMarkdown() {},
      reportTokenUsage() {}, setCitations() {},
      getMarkdownText() { return this.calls.markdown.join(''); },
    } as any;

    const result = await participant.handler(
      { text: 'How many files are there?', requestId: '1', mode: 'ask', modelId: 'test-model', attempt: 0 },
      { sessionId: 's1', history: [] },
      stream,
      { isCancellationRequested: false, isYieldRequested: false, onCancellationRequested: () => ({ dispose() {} }) },
    );

    expect(result).toEqual({});
    expect(stream.calls.markdown.join('')).toContain('The user wants to know');
  });

  it('retries once without tools when the final answer collapses to empty markdown', async () => {
    const { createDefaultParticipant } = await import('../../src/built-in/chat/participants/defaultParticipant');

    const sendChatRequest = vi.fn()
      .mockImplementationOnce(() => (async function* () {
        yield {
          toolCalls: [{ function: { name: 'read_file', arguments: { path: 'Claims Guide.md' } } }],
          done: true,
        };
      })())
      .mockImplementationOnce(() => (async function* () {
        yield {
          done: true,
        };
      })())
      .mockImplementationOnce(() => (async function* () {
        yield {
          content: 'Call Sarah Chen at (555) 234-5678 or the 24/7 claims line 1-800-555-CLAIM within 72 hours.',
          done: true,
        };
      })());

    const services = {
      sendChatRequest,
      getActiveModel: () => 'test-model',
      getWorkspaceName: () => 'Test Workspace',
      getPageCount: async () => 5,
      getCurrentPageTitle: () => undefined,
      getToolDefinitions: () => [],
      getReadOnlyToolDefinitions: () => [{ name: 'read_file', description: 'Read a file', inputSchema: { type: 'object' } }],
      invokeTool: vi.fn(async () => ({ content: 'tool result' })),
      maxIterations: 10,
    } as any;

    const participant = createDefaultParticipant(services);
    const stream = {
      calls: { markdown: [] as string[], warnings: [] as string[] },
      markdown(content: string) { this.calls.markdown.push(content); },
      warning(content: string) { this.calls.warnings.push(content); },
      thinking() {}, progress() {}, reference() {}, confirmation() {},
      beginToolInvocation() { return '1'; }, updateToolInvocation() {}, endToolInvocation() {},
      codeBlock() {}, replaceLastMarkdown() {}, reportTokenUsage() {}, setCitations() {},
      getMarkdownText() { return this.calls.markdown.join(''); },
    } as any;

    const result = await participant.handler(
      { text: 'How do I file a claim and who do I call?', requestId: '1', mode: 'ask', modelId: 'test-model', attempt: 0 },
      { sessionId: 's1', history: [] },
      stream,
      { isCancellationRequested: false, isYieldRequested: false, onCancellationRequested: () => ({ dispose() {} }) },
    );

    expect(result).toEqual({});
    expect(sendChatRequest).toHaveBeenCalledTimes(3);
    expect(stream.calls.markdown.join('')).toContain('Sarah Chen');
    expect(stream.calls.warnings).toEqual([]);
  });

  it('runs one retrieve-again pass when the initial evidence is insufficient', async () => {
    const { createDefaultParticipant } = await import('../../src/built-in/chat/participants/defaultParticipant');

    const retrieveContext = vi.fn()
      .mockResolvedValueOnce({
        text: [
          '[Retrieved Context]',
          '---',
          '[1] Source: Accident Quick Reference.md',
          'Path: Accident Quick Reference.md',
          '## Filing Deadlines',
          '- Report to insurer: Within 72 hours',
          '---',
        ].join('\n'),
        sources: [{ uri: 'Accident Quick Reference.md', label: 'Accident Quick Reference.md', index: 1 }],
      })
      .mockResolvedValueOnce({
        text: [
          '[Retrieved Context]',
          '---',
          '[2] Source: Vehicle Info.md',
          'Path: Vehicle Info.md',
          '## Estimated Current Value',
          '- **Note:** Total loss threshold is 75% of current value (~$21,375 – $22,650).',
          '---',
        ].join('\n'),
        sources: [{ uri: 'Vehicle Info.md', label: 'Vehicle Info.md', index: 2 }],
      });

    const sendChatRequest = vi.fn().mockImplementation(async function* (messages: Array<{ role: string; content: string }>) {
      const finalUserMessage = messages[messages.length - 1]?.content ?? '';
      expect(finalUserMessage).toContain('Vehicle Info.md');
      yield { content: 'The total loss threshold is 75% of current value.', done: true };
    });

    const services = {
      sendChatRequest,
      retrieveContext,
      isRAGAvailable: () => true,
      isIndexing: () => false,
      getActiveModel: () => 'test-model',
      getWorkspaceName: () => 'Test Workspace',
      getPageCount: async () => 5,
      getCurrentPageTitle: () => undefined,
      getToolDefinitions: () => [],
      getReadOnlyToolDefinitions: () => [],
      invokeTool: vi.fn(async () => ({ content: 'tool result' })),
      maxIterations: 10,
    } as any;

    const participant = createDefaultParticipant(services);
    const stream = {
      calls: { markdown: [] as string[] },
      markdown(content: string) { this.calls.markdown.push(content); },
      thinking() {}, progress() {}, reference() {}, warning() {}, confirmation() {},
      beginToolInvocation() { return '1'; }, updateToolInvocation() {}, endToolInvocation() {},
      codeBlock() {}, replaceLastMarkdown() {}, reportTokenUsage() {}, setCitations() {},
      getMarkdownText() { return this.calls.markdown.join(''); },
    } as any;

    const result = await participant.handler(
      { text: 'At what point would my car be declared a total loss?', requestId: '1', mode: 'ask', modelId: 'test-model', attempt: 0 },
      { sessionId: 's1', history: [] },
      stream,
      { isCancellationRequested: false, isYieldRequested: false, onCancellationRequested: () => ({ dispose() {} }) },
    );

    expect(result).toEqual({});
    expect(retrieveContext).toHaveBeenCalledTimes(2);
    expect(stream.calls.markdown.join('')).toContain('75%');
  });

  it('adds an evidence-insufficient response constraint when evidence stays thin after retry', async () => {
    const { createDefaultParticipant } = await import('../../src/built-in/chat/participants/defaultParticipant');

    const retrieveContext = vi.fn()
      .mockResolvedValue({
        text: [
          '[Retrieved Context]',
          '---',
          '[1] Source: Accident Quick Reference.md',
          'Path: Accident Quick Reference.md',
          '## Filing Deadlines',
          '- Report to insurer: Within 72 hours',
          '---',
        ].join('\n'),
        sources: [{ uri: 'Accident Quick Reference.md', label: 'Accident Quick Reference.md', index: 1 }],
      });

    const sendChatRequest = vi.fn().mockImplementation(async function* () {
      yield { done: true };
    });

    const services = {
      sendChatRequest,
      retrieveContext,
      isRAGAvailable: () => true,
      isIndexing: () => false,
      getActiveModel: () => 'test-model',
      getWorkspaceName: () => 'Test Workspace',
      getPageCount: async () => 5,
      getCurrentPageTitle: () => undefined,
      getToolDefinitions: () => [],
      getReadOnlyToolDefinitions: () => [],
      invokeTool: vi.fn(async () => ({ content: 'tool result' })),
      maxIterations: 10,
    } as any;

    const participant = createDefaultParticipant(services);
    const stream = {
      calls: { markdown: [] as string[] },
      markdown(content: string) { this.calls.markdown.push(content); },
      thinking() {}, progress() {}, reference() {}, warning() {}, confirmation() {},
      beginToolInvocation() { return '1'; }, updateToolInvocation() {}, endToolInvocation() {},
      codeBlock() {}, replaceLastMarkdown() {}, reportTokenUsage() {}, setCitations() {},
      getMarkdownText() { return this.calls.markdown.join(''); },
    } as any;

    const result = await participant.handler(
      { text: 'At what point would my car be declared a total loss?', requestId: '1', mode: 'ask', modelId: 'test-model', attempt: 0 },
      { sessionId: 's1', history: [] },
      stream,
      { isCancellationRequested: false, isYieldRequested: false, onCancellationRequested: () => ({ dispose() {} }) },
    );

    expect(result).toEqual({});
    const firstUserMessage = sendChatRequest.mock.calls[0]?.[0]?.at(-1)?.content ?? '';
    expect(firstUserMessage).toContain('Response Constraint: If the evidence stays insufficient');
    expect(stream.calls.markdown.join('')).toMatch(/Relevant details from retrieved context|do not have enough grounded evidence/);
  });

  it('adds a no-inference constraint for unsupported specific coverage questions', async () => {
    const { createDefaultParticipant } = await import('../../src/built-in/chat/participants/defaultParticipant');

    const retrieveContext = vi.fn().mockResolvedValue({
      text: [
        '[Retrieved Context]',
        '---',
        '[1] Source: Auto Insurance Policy.md',
        'Path: Auto Insurance Policy.md',
        '### Comprehensive Coverage',
        'Covers damage to your vehicle from non-collision events: theft, vandalism, natural disasters, falling objects, animal strikes.',
        '---',
      ].join('\n'),
      sources: [{ uri: 'Auto Insurance Policy.md', label: 'Auto Insurance Policy.md', index: 1 }],
    });

    const sendChatRequest = vi.fn().mockImplementation(async function* () {
      yield { done: true };
    });

    const services = {
      sendChatRequest,
      retrieveContext,
      isRAGAvailable: () => true,
      isIndexing: () => false,
      getActiveModel: () => 'test-model',
      getWorkspaceName: () => 'Test Workspace',
      getPageCount: async () => 5,
      getCurrentPageTitle: () => undefined,
      getToolDefinitions: () => [],
      getReadOnlyToolDefinitions: () => [],
      invokeTool: vi.fn(async () => ({ content: 'tool result' })),
      maxIterations: 10,
    } as any;

    const participant = createDefaultParticipant(services);
    const stream = {
      calls: { markdown: [] as string[] },
      markdown(content: string) { this.calls.markdown.push(content); },
      thinking() {}, progress() {}, reference() {}, warning() {}, confirmation() {},
      beginToolInvocation() { return '1'; }, updateToolInvocation() {}, endToolInvocation() {},
      codeBlock() {}, replaceLastMarkdown() {}, reportTokenUsage() {}, setCitations() {},
      getMarkdownText() { return this.calls.markdown.join(''); },
    } as any;

    const result = await participant.handler(
      { text: 'What does my policy say about earthquake coverage?', requestId: '1', mode: 'ask', modelId: 'test-model', attempt: 0 },
      { sessionId: 's1', history: [] },
      stream,
      { isCancellationRequested: false, isYieldRequested: false, onCancellationRequested: () => ({ dispose() {} }) },
    );

    expect(result).toEqual({});
    expect(sendChatRequest).not.toHaveBeenCalled();
    expect(stream.calls.markdown.join('')).toMatch(/could not find earthquake|not explicitly covered|cannot confirm/i);
  });

  it('answers unsupported specific coverage questions directly with a not-found plus contact-agent fallback', async () => {
    const { createDefaultParticipant } = await import('../../src/built-in/chat/participants/defaultParticipant');

    const retrieveContext = vi.fn().mockResolvedValue({
      text: [
        '[Retrieved Context]',
        '---',
        '[1] Source: Auto Insurance Policy.md',
        'Path: Auto Insurance Policy.md',
        '## Exclusions',
        'This policy does NOT cover:',
        '1. Damage from racing or speed contests',
        '2. Intentional damage',
        '---',
      ].join('\n'),
      sources: [{ uri: 'Auto Insurance Policy.md', label: 'Auto Insurance Policy.md', index: 1 }],
    });

    const sendChatRequest = vi.fn().mockImplementation(async function* () {
      yield { done: true };
    });

    const services = {
      sendChatRequest,
      retrieveContext,
      isRAGAvailable: () => true,
      isIndexing: () => false,
      getActiveModel: () => 'test-model',
      getWorkspaceName: () => 'Test Workspace',
      getPageCount: async () => 5,
      getCurrentPageTitle: () => undefined,
      getToolDefinitions: () => [],
      getReadOnlyToolDefinitions: () => [],
      invokeTool: vi.fn(async () => ({ content: 'tool result' })),
      maxIterations: 10,
    } as any;

    const participant = createDefaultParticipant(services);
    const stream = {
      calls: { markdown: [] as string[] },
      markdown(content: string) { this.calls.markdown.push(content); },
      thinking() {}, progress() {}, reference() {}, warning() {}, confirmation() {},
      beginToolInvocation() { return '1'; }, updateToolInvocation() {}, endToolInvocation() {},
      codeBlock() {}, replaceLastMarkdown() {}, reportTokenUsage() {}, setCitations() {},
      getMarkdownText() { return this.calls.markdown.join(''); },
    } as any;

    const result = await participant.handler(
      { text: 'What does my policy say about earthquake coverage?', requestId: '1', mode: 'ask', modelId: 'test-model', attempt: 0 },
      { sessionId: 's1', history: [] },
      stream,
      { isCancellationRequested: false, isYieldRequested: false, onCancellationRequested: () => ({ dispose() {} }) },
    );

    expect(result).toEqual({});
    expect(sendChatRequest).not.toHaveBeenCalled();
    expect(stream.calls.markdown.join('')).toMatch(/could not find earthquake|not explicitly covered|cannot confirm/i);
    expect(stream.calls.markdown.join('')).toMatch(/contact your agent|endorsement|additional coverage/i);
  });

  it('uses deductible context from the previous turn for short comprehensive follow-ups', async () => {
    const { createDefaultParticipant } = await import('../../src/built-in/chat/participants/defaultParticipant');

    const retrieveContext = vi.fn().mockImplementation(async (query: string) => {
      if (/comprehensive/i.test(query) && /deductible/i.test(query)) {
        return {
          text: [
            '[Retrieved Context]',
            '---',
            '[1] Source: Auto Insurance Policy.md',
            'Path: Auto Insurance Policy.md',
            '### Comprehensive Coverage',
            '- **Deductible:** $250',
            '---',
          ].join('\n'),
          sources: [{ uri: 'Auto Insurance Policy.md', label: 'Auto Insurance Policy.md', index: 1 }],
        };
      }

      return {
        text: [
          '[Retrieved Context]',
          '---',
          '[1] Source: Auto Insurance Policy.md',
          'Path: Auto Insurance Policy.md',
          '### Comprehensive Coverage',
          'Covers non-collision damage.',
          '---',
        ].join('\n'),
        sources: [{ uri: 'Auto Insurance Policy.md', label: 'Auto Insurance Policy.md', index: 1 }],
      };
    });

    const sendChatRequest = vi.fn().mockImplementation(async function* () {
      yield { content: 'Comprehensive coverage is part of your policy.', done: true };
    });

    const services = {
      sendChatRequest,
      retrieveContext,
      isRAGAvailable: () => true,
      isIndexing: () => false,
      getActiveModel: () => 'test-model',
      getWorkspaceName: () => 'Test Workspace',
      getPageCount: async () => 5,
      getCurrentPageTitle: () => undefined,
      getToolDefinitions: () => [],
      getReadOnlyToolDefinitions: () => [],
      invokeTool: vi.fn(async () => ({ content: 'tool result' })),
      maxIterations: 10,
    } as any;

    const participant = createDefaultParticipant(services);
    const stream = {
      calls: { markdown: [] as string[] },
      markdown(content: string) { this.calls.markdown.push(content); },
      thinking() {}, progress() {}, reference() {}, warning() {}, confirmation() {},
      beginToolInvocation() { return '1'; }, updateToolInvocation() {}, endToolInvocation() {},
      codeBlock() {}, replaceLastMarkdown() {}, reportTokenUsage() {}, setCitations() {},
      getMarkdownText() { return this.calls.markdown.join(''); },
    } as any;

    const result = await participant.handler(
      { text: 'And what about comprehensive?', requestId: '2', mode: 'ask', modelId: 'test-model', attempt: 0 },
      {
        sessionId: 's1',
        history: [{
          request: { text: 'What is my collision deductible?', requestId: 'req-history-1', attempt: 0, timestamp: Date.now() },
          response: { parts: [{ kind: 'markdown', content: 'Your collision deductible is $500.' }] },
        }],
      } as any,
      stream,
      { isCancellationRequested: false, isYieldRequested: false, onCancellationRequested: () => ({ dispose() {} }) },
    );

    expect(result).toEqual({});
    expect(retrieveContext).toHaveBeenCalledWith(expect.stringMatching(/comprehensive/i));
    expect(retrieveContext).toHaveBeenCalledWith(expect.stringMatching(/deductible/i));
    expect(stream.calls.markdown.join('')).toContain('Comprehensive coverage is part of your policy.');
  });

  it('redirects obvious off-topic requests back to workspace scope without calling the model', async () => {
    const { createDefaultParticipant } = await import('../../src/built-in/chat/participants/defaultParticipant');

    const sendChatRequest = vi.fn().mockImplementation(async function* () {
      yield { done: true };
    });

    const participant = createDefaultParticipant({
      sendChatRequest,
      maxIterations: 10,
    } as any);

    const stream = {
      calls: { markdown: [] as string[] },
      markdown(content: string) { this.calls.markdown.push(content); },
      thinking() {}, progress() {}, reference() {}, warning() {}, confirmation() {},
      beginToolInvocation() { return '1'; }, updateToolInvocation() {}, endToolInvocation() {},
      codeBlock() {}, replaceLastMarkdown() {}, reportTokenUsage() {}, setCitations() {},
      getMarkdownText() { return this.calls.markdown.join(''); },
    } as any;

    const result = await participant.handler(
      { text: "What's the best recipe for chocolate chip cookies?", requestId: '1', mode: 'ask', modelId: 'test-model', attempt: 0 },
      { sessionId: 's1', history: [] },
      stream,
      { isCancellationRequested: false, isYieldRequested: false, onCancellationRequested: () => ({ dispose() {} }) },
    );

    expect(result).toEqual({});
    expect(sendChatRequest).not.toHaveBeenCalled();
    expect(stream.calls.markdown.join('')).toMatch(/insurance policy|workspace|files/i);
    expect(stream.calls.markdown.join('')).not.toMatch(/preheat oven|baking soda|vanilla extract/i);
  });

  it('uses retrieved context as a final fallback when both model passes return no markdown', async () => {
    const { createDefaultParticipant } = await import('../../src/built-in/chat/participants/defaultParticipant');

    const sendChatRequest = vi.fn()
      .mockImplementationOnce(() => (async function* () {
        yield {
          toolCalls: [{ function: { name: 'read_file', arguments: { path: 'Claims Guide.md' } } }],
          done: true,
        };
      })())
      .mockImplementationOnce(() => (async function* () {
        yield { done: true };
      })())
      .mockImplementationOnce(() => (async function* () {
        yield { done: true };
      })());

    const services = {
      sendChatRequest,
      getActiveModel: () => 'test-model',
      getWorkspaceName: () => 'Test Workspace',
      getPageCount: async () => 5,
      getCurrentPageTitle: () => undefined,
      getToolDefinitions: () => [],
      getReadOnlyToolDefinitions: () => [{ name: 'read_file', description: 'Read a file', inputSchema: { type: 'object' } }],
      invokeTool: vi.fn(async () => ({ content: 'tool result' })),
      retrieveContext: vi.fn(async () => ({
        text: [
          '[Retrieved Context]',
          '---',
          '[1] Source: Claims Guide.md',
          'Path: Claims Guide.md',
          '### Step 1: Report the Claim',
          '- Your agent: Sarah Chen — (555) 234-5678',
          '- 24/7 Claims Line: 1-800-555-CLAIM (2524)',
          '- File within 72 hours of the incident',
          '---',
        ].join('\n'),
        sources: [{ uri: 'Claims Guide.md', label: 'Claims Guide.md', index: 1 }],
      })),
      isRAGAvailable: () => true,
      isIndexing: () => false,
      maxIterations: 10,
    } as any;

    const participant = createDefaultParticipant(services);
    const stream = {
      calls: { markdown: [] as string[], warnings: [] as string[] },
      markdown(content: string) { this.calls.markdown.push(content); },
      warning(content: string) { this.calls.warnings.push(content); },
      thinking() {}, progress() {}, reference() {}, confirmation() {},
      beginToolInvocation() { return '1'; }, updateToolInvocation() {}, endToolInvocation() {},
      codeBlock() {}, replaceLastMarkdown() {}, reportTokenUsage() {}, setCitations() {},
      getMarkdownText() { return this.calls.markdown.join(''); },
    } as any;

    const result = await participant.handler(
      { text: 'OK I want to file a claim. How do I do that and who do I call?', requestId: '1', mode: 'ask', modelId: 'test-model', attempt: 0 },
      { sessionId: 's1', history: [] },
      stream,
      { isCancellationRequested: false, isYieldRequested: false, onCancellationRequested: () => ({ dispose() {} }) },
    );

    expect(result).toEqual({});
    expect(sendChatRequest).toHaveBeenCalledTimes(3);
    expect(stream.calls.markdown.join('')).toContain('Sarah Chen');
    expect(stream.calls.markdown.join('')).toContain('1-800-555-CLAIM');
    expect(stream.calls.markdown.join('')).toContain('72 hours');
  });

  it('preserves source attribution when abort fallback synthesizes a response', async () => {
    const { createDefaultParticipant } = await import('../../src/built-in/chat/participants/defaultParticipant');

    const sendChatRequest = vi.fn()
      .mockImplementationOnce(() => (async function* () {
        throw new DOMException('signal is aborted without reason', 'AbortError');
      })());

    const services = {
      sendChatRequest,
      getActiveModel: () => 'test-model',
      getWorkspaceName: () => 'Test Workspace',
      getPageCount: async () => 5,
      getCurrentPageTitle: () => undefined,
      getToolDefinitions: () => [],
      getReadOnlyToolDefinitions: () => [{ name: 'read_file', description: 'Read a file', inputSchema: { type: 'object' } }],
      invokeTool: vi.fn(async () => ({ content: 'tool result' })),
      retrieveContext: vi.fn(async () => ({
        text: [
          '[Retrieved Context]',
          '---',
          '[1] Source: Agent Contacts.md',
          'Path: Agent Contacts.md',
          '## Preferred Repair Shops',
          '1. **AutoCraft Collision Center**',
          '2. **Precision Auto Body**',
          '3. **Riverside Honda Service Center**',
          '---',
        ].join('\n'),
        sources: [{ uri: 'Agent Contacts.md', label: 'Agent Contacts.md', index: 1 }],
      })),
      isRAGAvailable: () => true,
      isIndexing: () => false,
      maxIterations: 10,
    } as any;

    const participant = createDefaultParticipant(services);
    const stream = {
      calls: { markdown: [] as string[], warnings: [] as string[], citations: [] as Array<Array<{ index: number; uri: string; label: string }>> },
      markdown(content: string) { this.calls.markdown.push(content); },
      warning(content: string) { this.calls.warnings.push(content); },
      thinking() {}, progress() {}, reference() {}, confirmation() {},
      beginToolInvocation() { return '1'; }, updateToolInvocation() {}, endToolInvocation() {},
      codeBlock() {}, replaceLastMarkdown() {}, reportTokenUsage() {},
      setCitations(citations: Array<{ index: number; uri: string; label: string }>) { this.calls.citations.push(citations); },
      getMarkdownText() { return this.calls.markdown.join(''); },
    } as any;

    const result = await participant.handler(
      { text: 'Which repair shops are recommended under my policy? Please cite your sources.', requestId: '1', mode: 'ask', modelId: 'test-model', attempt: 0 },
      { sessionId: 's1', history: [] },
      stream,
      { isCancellationRequested: false, isYieldRequested: false, onCancellationRequested: () => ({ dispose() {} }) },
    );

    expect(result).toEqual({});
    expect(stream.calls.markdown.join('')).toContain('AutoCraft Collision Center');
    expect(stream.calls.markdown.join('')).toContain('Precision Auto Body');
    expect(stream.calls.markdown.join('')).toContain('Agent Contacts.md');
    expect(stream.calls.citations).toHaveLength(1);
  });

  it('treats a new-session greeting as a conversational clean-slate turn', async () => {
    const { createDefaultParticipant } = await import('../../src/built-in/chat/participants/defaultParticipant');

    const retrieveContext = vi.fn();
    const recallMemories = vi.fn();
    const recallConcepts = vi.fn();
    const getCurrentPageContent = vi.fn();
    const sendChatRequest = vi.fn().mockImplementation(async function* (messages: Array<{ role: string; content: string }>, options?: { tools?: unknown[] }) {
      expect(messages[messages.length - 1]?.content).toBe('hello');
      expect(options?.tools).toBeUndefined();
      yield { content: 'Hi there. How can I help?', done: true };
    });

    const services = {
      sendChatRequest,
      retrieveContext,
      recallMemories,
      recallConcepts,
      getCurrentPageContent,
      isRAGAvailable: () => true,
      isIndexing: () => false,
      getActiveModel: () => 'test-model',
      getWorkspaceName: () => 'Test Workspace',
      getPageCount: async () => 5,
      getCurrentPageTitle: () => undefined,
      getToolDefinitions: () => [{ name: 'read_file', description: 'Read a file', inputSchema: { type: 'object' } }],
      getReadOnlyToolDefinitions: () => [{ name: 'read_file', description: 'Read a file', inputSchema: { type: 'object' } }],
      invokeTool: vi.fn(async () => ({ content: 'tool result' })),
      maxIterations: 10,
    } as any;

    const participant = createDefaultParticipant(services);
    const stream = {
      calls: { markdown: [] as string[], citations: [] as Array<Array<{ index: number; uri: string; label: string }>> },
      markdown(content: string) { this.calls.markdown.push(content); },
      thinking() {}, progress() {}, reference() {}, warning() {}, confirmation() {},
      beginToolInvocation() { return '1'; }, updateToolInvocation() {}, endToolInvocation() {},
      codeBlock() {}, replaceLastMarkdown() {}, reportTokenUsage() {},
      setCitations(citations: Array<{ index: number; uri: string; label: string }>) { this.calls.citations.push(citations); },
      getMarkdownText() { return this.calls.markdown.join(''); },
    } as any;

    const result = await participant.handler(
      { text: 'hello', requestId: '1', mode: 'ask', modelId: 'test-model', attempt: 0 },
      { sessionId: 's1', history: [] },
      stream,
      { isCancellationRequested: false, isYieldRequested: false, onCancellationRequested: () => ({ dispose() {} }) },
    );

    expect(result).toEqual({});
    expect(retrieveContext).not.toHaveBeenCalled();
    expect(recallMemories).not.toHaveBeenCalled();
    expect(recallConcepts).not.toHaveBeenCalled();
    expect(getCurrentPageContent).not.toHaveBeenCalled();
    expect(stream.calls.markdown.join('')).toContain('Hi there');
    expect(stream.calls.markdown.join('')).not.toContain('Sources:');
    expect(stream.calls.citations).toEqual([]);
  });

  it('keeps retrieval enabled for explicit workspace questions in a new session', async () => {
    const { createDefaultParticipant } = await import('../../src/built-in/chat/participants/defaultParticipant');

    const retrieveContext = vi.fn().mockResolvedValue({
      text: [
        '[Retrieved Context]',
        '---',
        '[1] Source: Claims Guide.md',
        'Path: Claims Guide.md',
        '## Filing Deadlines',
        '- Report to insurer: Within 72 hours',
        '---',
      ].join('\n'),
      sources: [{ uri: 'Claims Guide.md', label: 'Claims Guide.md', index: 1 }],
    });
    const sendChatRequest = vi.fn().mockImplementation(async function* (messages: Array<{ role: string; content: string }>, options?: { tools?: unknown[] }) {
      expect(messages[messages.length - 1]?.content).toContain('[Retrieved Context]');
      expect(options?.tools).toHaveLength(1);
      yield { content: 'You need to report the claim within 72 hours [1].', done: true };
    });

    const services = {
      sendChatRequest,
      retrieveContext,
      isRAGAvailable: () => true,
      isIndexing: () => false,
      getActiveModel: () => 'test-model',
      getWorkspaceName: () => 'Test Workspace',
      getPageCount: async () => 5,
      getCurrentPageTitle: () => undefined,
      getToolDefinitions: () => [{ name: 'read_file', description: 'Read a file', inputSchema: { type: 'object' } }],
      getReadOnlyToolDefinitions: () => [{ name: 'read_file', description: 'Read a file', inputSchema: { type: 'object' } }],
      invokeTool: vi.fn(async () => ({ content: 'tool result' })),
      maxIterations: 10,
    } as any;

    const participant = createDefaultParticipant(services);
    const stream = {
      calls: { markdown: [] as string[] },
      markdown(content: string) { this.calls.markdown.push(content); },
      thinking() {}, progress() {}, reference() {}, warning() {}, confirmation() {},
      beginToolInvocation() { return '1'; }, updateToolInvocation() {}, endToolInvocation() {},
      codeBlock() {}, replaceLastMarkdown() {}, reportTokenUsage() {}, setCitations() {},
      getMarkdownText() { return this.calls.markdown.join(''); },
    } as any;

    const result = await participant.handler(
      { text: 'What does Claims Guide.md say about filing deadlines?', requestId: '1', mode: 'ask', modelId: 'test-model', attempt: 0 },
      { sessionId: 's1', history: [] },
      stream,
      { isCancellationRequested: false, isYieldRequested: false, onCancellationRequested: () => ({ dispose() {} }) },
    );

    expect(result).toEqual({});
    expect(retrieveContext).toHaveBeenCalledTimes(1);
    expect(stream.calls.markdown.join('')).toContain('72 hours');
  });

  it('treats explicit prior-conversation recall as memory-first without workspace retrieval', async () => {
    const { createDefaultParticipant } = await import('../../src/built-in/chat/participants/defaultParticipant');

    const retrieveContext = vi.fn();
    const recallMemories = vi.fn().mockResolvedValue([
      '[Conversation Memory]',
      '---',
      'Previous session (2026-03-08T10:00:00.000Z):',
      'The user described an accident at the Riverside Mall parking lot on Elm Street. The other driver ran a red light and hit the passenger door. Police report number: 2026-0305-1147.',
    ].join('\n'));
    const sendChatRequest = vi.fn().mockImplementation(async function* (messages: Array<{ role: string; content: string }>, options?: { tools?: unknown[] }) {
      const userMessage = messages[messages.length - 1]?.content ?? '';
      expect(userMessage).toContain('[Conversation Memory]');
      expect(userMessage).not.toContain('[Retrieved Context]');
      expect(options?.tools).toHaveLength(1);
      yield { content: 'You previously told me the accident happened at the Riverside Mall parking lot on Elm Street, and that the other driver ran a red light and hit your passenger door. Police report number: 2026-0305-1147.', done: true };
    });

    const services = {
      sendChatRequest,
      retrieveContext,
      recallMemories,
      recallConcepts: vi.fn(),
      isRAGAvailable: () => true,
      isIndexing: () => false,
      getActiveModel: () => 'test-model',
      getWorkspaceName: () => 'Test Workspace',
      getPageCount: async () => 5,
      getCurrentPageTitle: () => undefined,
      getToolDefinitions: () => [{ name: 'read_file', description: 'Read a file', inputSchema: { type: 'object' } }],
      getReadOnlyToolDefinitions: () => [{ name: 'read_file', description: 'Read a file', inputSchema: { type: 'object' } }],
      invokeTool: vi.fn(async () => ({ content: 'tool result' })),
      maxIterations: 10,
    } as any;

    const participant = createDefaultParticipant(services);
    const stream = {
      calls: { markdown: [] as string[] },
      markdown(content: string) { this.calls.markdown.push(content); },
      thinking() {}, progress() {}, reference() {}, warning() {}, confirmation() {},
      beginToolInvocation() { return '1'; }, updateToolInvocation() {}, endToolInvocation() {},
      codeBlock() {}, replaceLastMarkdown() {}, reportTokenUsage() {}, setCitations() {},
      getMarkdownText() { return this.calls.markdown.join(''); },
    } as any;

    const result = await participant.handler(
      { text: 'In my last conversation, I told you about an accident I had. What details do you remember about it?', requestId: '1', mode: 'ask', modelId: 'test-model', attempt: 0 },
      { sessionId: 's2', history: [] },
      stream,
      { isCancellationRequested: false, isYieldRequested: false, onCancellationRequested: () => ({ dispose() {} }) },
    );

    expect(result).toEqual({});
    expect(retrieveContext).not.toHaveBeenCalled();
    expect(recallMemories).toHaveBeenCalledTimes(1);
    expect(stream.calls.markdown.join('')).toContain('Riverside Mall parking lot');
    expect(stream.calls.markdown.join('')).toContain('Elm Street');
  });

  it('answers approval-scope questions from product semantics without retrieval', async () => {
    const { createDefaultParticipant } = await import('../../src/built-in/chat/participants/defaultParticipant');

    const retrieveContext = vi.fn();
    const sendChatRequest = vi.fn();

    const services = {
      sendChatRequest,
      retrieveContext,
      isRAGAvailable: () => true,
      isIndexing: () => false,
      getActiveModel: () => 'test-model',
      getWorkspaceName: () => 'Test Workspace',
      getPageCount: async () => 5,
      getCurrentPageTitle: () => undefined,
      getToolDefinitions: () => [{ name: 'read_file', description: 'Read a file', inputSchema: { type: 'object' } }],
      getReadOnlyToolDefinitions: () => [{ name: 'read_file', description: 'Read a file', inputSchema: { type: 'object' } }],
      invokeTool: vi.fn(async () => ({ content: 'tool result' })),
      maxIterations: 10,
    } as any;

    const participant = createDefaultParticipant(services);
    const stream = {
      calls: { markdown: [] as string[] },
      markdown(content: string) { this.calls.markdown.push(content); },
      thinking() {}, progress() {}, reference() {}, warning() {}, confirmation() {},
      beginToolInvocation() { return '1'; }, updateToolInvocation() {}, endToolInvocation() {},
      codeBlock() {}, replaceLastMarkdown() {}, reportTokenUsage() {}, setCitations() {},
      getMarkdownText() { return this.calls.markdown.join(''); },
    } as any;

    const result = await participant.handler(
      { text: 'What is the difference between Approve once and Approve task?', requestId: '1', mode: 'ask', modelId: 'test-model', attempt: 0 },
      { sessionId: 's1', history: [] },
      stream,
      { isCancellationRequested: false, isYieldRequested: false, onCancellationRequested: () => ({ dispose() {} }) },
    );

    expect(result).toEqual({});
    expect(retrieveContext).not.toHaveBeenCalled();
    expect(sendChatRequest).not.toHaveBeenCalled();
    expect(stream.calls.markdown.join('')).toContain('Approve once allows only the current action to run');
    expect(stream.calls.markdown.join('')).toContain('remaining approval-scoped actions');
  });

  it('answers blocked outside-workspace recovery questions from product semantics without retrieval', async () => {
    const { createDefaultParticipant } = await import('../../src/built-in/chat/participants/defaultParticipant');

    const retrieveContext = vi.fn();
    const sendChatRequest = vi.fn();

    const services = {
      sendChatRequest,
      retrieveContext,
      isRAGAvailable: () => true,
      isIndexing: () => false,
      getActiveModel: () => 'test-model',
      getWorkspaceName: () => 'Test Workspace',
      getPageCount: async () => 5,
      getCurrentPageTitle: () => undefined,
      getToolDefinitions: () => [{ name: 'read_file', description: 'Read a file', inputSchema: { type: 'object' } }],
      getReadOnlyToolDefinitions: () => [{ name: 'read_file', description: 'Read a file', inputSchema: { type: 'object' } }],
      invokeTool: vi.fn(async () => ({ content: 'tool result' })),
      maxIterations: 10,
    } as any;

    const participant = createDefaultParticipant(services);
    const stream = {
      calls: { markdown: [] as string[] },
      markdown(content: string) { this.calls.markdown.push(content); },
      thinking() {}, progress() {}, reference() {}, warning() {}, confirmation() {},
      beginToolInvocation() { return '1'; }, updateToolInvocation() {}, endToolInvocation() {},
      codeBlock() {}, replaceLastMarkdown() {}, reportTokenUsage() {}, setCitations() {},
      getMarkdownText() { return this.calls.markdown.join(''); },
    } as any;

    const result = await participant.handler(
      { text: 'My delegated task was blocked because it targeted a file outside the workspace. What should I do next?', requestId: '1', mode: 'ask', modelId: 'test-model', attempt: 0 },
      { sessionId: 's1', history: [] },
      stream,
      { isCancellationRequested: false, isYieldRequested: false, onCancellationRequested: () => ({ dispose() {} }) },
    );

    expect(result).toEqual({});
    expect(retrieveContext).not.toHaveBeenCalled();
    expect(sendChatRequest).not.toHaveBeenCalled();
    expect(stream.calls.markdown.join('')).toContain('outside the active workspace boundary');
    expect(stream.calls.markdown.join('')).toContain('Retarget the task');
    expect(stream.calls.markdown.join('')).toContain('continue or retry the task');
  });

  it('answers recorded-artifact follow-up questions from product semantics without retrieval', async () => {
    const { createDefaultParticipant } = await import('../../src/built-in/chat/participants/defaultParticipant');

    const retrieveContext = vi.fn();
    const sendChatRequest = vi.fn();

    const services = {
      sendChatRequest,
      retrieveContext,
      isRAGAvailable: () => true,
      isIndexing: () => false,
      getActiveModel: () => 'test-model',
      getWorkspaceName: () => 'Test Workspace',
      getPageCount: async () => 5,
      getCurrentPageTitle: () => undefined,
      getToolDefinitions: () => [{ name: 'read_file', description: 'Read a file', inputSchema: { type: 'object' } }],
      getReadOnlyToolDefinitions: () => [{ name: 'read_file', description: 'Read a file', inputSchema: { type: 'object' } }],
      invokeTool: vi.fn(async () => ({ content: 'tool result' })),
      maxIterations: 10,
    } as any;

    const participant = createDefaultParticipant(services);
    const stream = {
      calls: { markdown: [] as string[] },
      markdown(content: string) { this.calls.markdown.push(content); },
      thinking() {}, progress() {}, reference() {}, warning() {}, confirmation() {},
      beginToolInvocation() { return '1'; }, updateToolInvocation() {}, endToolInvocation() {},
      codeBlock() {}, replaceLastMarkdown() {}, reportTokenUsage() {}, setCitations() {},
      getMarkdownText() { return this.calls.markdown.join(''); },
    } as any;

    const result = await participant.handler(
      { text: 'A delegated task finished with recorded artifacts. What should I check next?', requestId: '1', mode: 'ask', modelId: 'test-model', attempt: 0 },
      { sessionId: 's1', history: [] },
      stream,
      { isCancellationRequested: false, isYieldRequested: false, onCancellationRequested: () => ({ dispose() {} }) },
    );

    expect(result).toEqual({});
    expect(retrieveContext).not.toHaveBeenCalled();
    expect(sendChatRequest).not.toHaveBeenCalled();
    expect(stream.calls.markdown.join('')).toContain('which workspace files the task changed or produced');
    expect(stream.calls.markdown.join('')).toContain('Check those files first');
  });

  it('answers trace-explanation questions from product semantics without retrieval', async () => {
    const { createDefaultParticipant } = await import('../../src/built-in/chat/participants/defaultParticipant');

    const retrieveContext = vi.fn();
    const sendChatRequest = vi.fn();

    const services = {
      sendChatRequest,
      retrieveContext,
      isRAGAvailable: () => true,
      isIndexing: () => false,
      getActiveModel: () => 'test-model',
      getWorkspaceName: () => 'Test Workspace',
      getPageCount: async () => 5,
      getCurrentPageTitle: () => undefined,
      getToolDefinitions: () => [{ name: 'read_file', description: 'Read a file', inputSchema: { type: 'object' } }],
      getReadOnlyToolDefinitions: () => [{ name: 'read_file', description: 'Read a file', inputSchema: { type: 'object' } }],
      invokeTool: vi.fn(async () => ({ content: 'tool result' })),
      maxIterations: 10,
    } as any;

    const participant = createDefaultParticipant(services);
    const stream = {
      calls: { markdown: [] as string[] },
      markdown(content: string) { this.calls.markdown.push(content); },
      thinking() {}, progress() {}, reference() {}, warning() {}, confirmation() {},
      beginToolInvocation() { return '1'; }, updateToolInvocation() {}, endToolInvocation() {},
      codeBlock() {}, replaceLastMarkdown() {}, reportTokenUsage() {}, setCitations() {},
      getMarkdownText() { return this.calls.markdown.join(''); },
    } as any;

    const result = await participant.handler(
      { text: 'What does the trace in task details help me understand?', requestId: '1', mode: 'ask', modelId: 'test-model', attempt: 0 },
      { sessionId: 's1', history: [] },
      stream,
      { isCancellationRequested: false, isYieldRequested: false, onCancellationRequested: () => ({ dispose() {} }) },
    );

    expect(result).toEqual({});
    expect(retrieveContext).not.toHaveBeenCalled();
    expect(sendChatRequest).not.toHaveBeenCalled();
    expect(stream.calls.markdown.join('')).toContain('planning, approval, and execution events');
    expect(stream.calls.markdown.join('')).toContain('why a task stopped');
  });
});
