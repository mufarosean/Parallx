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
      expect(thinking.references).toHaveLength(2);
      expect(thinking.references[0].label).toBe('test.md');
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
      expect(thinking.references[0].index).toBe(1);
      expect(thinking.references[1].index).toBe(2);
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

// ── _extractToolCallsFromText — text-based tool call fallback ──

describe('_extractToolCallsFromText', () => {
  let _extractToolCallsFromText: typeof import('../../src/built-in/chat/participants/defaultParticipant')._extractToolCallsFromText;

  beforeEach(async () => {
    const mod = await import('../../src/built-in/chat/participants/defaultParticipant');
    _extractToolCallsFromText = mod._extractToolCallsFromText;
  });

  it('extracts a bare JSON tool call object', () => {
    const text = 'Here is the tool call:\n{"name": "read_file", "parameters": {"path": "file.md"}}';
    const { toolCalls, cleanedText } = _extractToolCallsFromText(text);
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].function.name).toBe('read_file');
    expect(toolCalls[0].function.arguments).toEqual({ path: 'file.md' });
    expect(cleanedText).toBe('Here is the tool call:');
  });

  it('extracts a JSON tool call inside a code block', () => {
    const text = 'I will read the file:\n```json\n{"name": "read_file", "parameters": {"path": "test.md"}}\n```\nDone.';
    const { toolCalls, cleanedText } = _extractToolCallsFromText(text);
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].function.name).toBe('read_file');
    expect(cleanedText).toContain('I will read the file:');
    expect(cleanedText).toContain('Done.');
    expect(cleanedText).not.toContain('read_file');
  });

  it('returns empty array when no tool calls found', () => {
    const text = 'Hello! How can I help you today?';
    const { toolCalls, cleanedText } = _extractToolCallsFromText(text);
    expect(toolCalls).toHaveLength(0);
    expect(cleanedText).toBe(text);
  });

  it('handles tool call with nested parameters', () => {
    const text = '{"name": "search_workspace", "parameters": {"query": "hello world", "limit": 5}}';
    const { toolCalls } = _extractToolCallsFromText(text);
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].function.name).toBe('search_workspace');
    expect(toolCalls[0].function.arguments).toEqual({ query: 'hello world', limit: 5 });
  });

  it('does not extract invalid JSON', () => {
    const text = '{"name": "read_file", "parameters": {broken}}';
    const { toolCalls } = _extractToolCallsFromText(text);
    expect(toolCalls).toHaveLength(0);
  });

  it('does not extract objects missing name or parameters', () => {
    const text = '{"action": "read_file", "params": {"path": "x"}}';
    const { toolCalls } = _extractToolCallsFromText(text);
    expect(toolCalls).toHaveLength(0);
  });

  it('strips the matched JSON from cleaned text', () => {
    const text = '{"name": "list_files", "parameters": {"directory": "."}}';
    const { cleanedText } = _extractToolCallsFromText(text);
    expect(cleanedText).toBe('');
  });

  it('preserves surrounding text when stripping tool call', () => {
    const text = 'Let me check.\n{"name": "list_files", "parameters": {"directory": "."}}\nHere are the results:';
    const { toolCalls, cleanedText } = _extractToolCallsFromText(text);
    expect(toolCalls).toHaveLength(1);
    expect(cleanedText).toContain('Let me check.');
    expect(cleanedText).toContain('Here are the results:');
  });

  it('extracts tool call using "arguments" key (Ollama/OpenAI format)', () => {
    const text = '{"name": "list_files", "arguments": {"path": "."}}';
    const { toolCalls, cleanedText } = _extractToolCallsFromText(text);
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].function.name).toBe('list_files');
    expect(toolCalls[0].function.arguments).toEqual({ path: '.' });
    expect(cleanedText).toBe('');
  });

  it('extracts code-fenced tool call with "arguments" key', () => {
    const text = 'Action:\n```json\n{"name": "read_file", "arguments": {"path": "docs/README.md"}}\n```';
    const { toolCalls } = _extractToolCallsFromText(text);
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].function.name).toBe('read_file');
    expect(toolCalls[0].function.arguments).toEqual({ path: 'docs/README.md' });
  });
});

// ── _stripToolNarration — prose tool-call narration removal ──

describe('_stripToolNarration', () => {
  let _stripToolNarration: typeof import('../../src/built-in/chat/participants/defaultParticipant')._stripToolNarration;

  beforeEach(async () => {
    const mod = await import('../../src/built-in/chat/participants/defaultParticipant');
    _stripToolNarration = mod._stripToolNarration;
  });

  it('strips "Here\'s a function call to X" narration', () => {
    const text = 'Here\'s a function call to read_file with its proper arguments:\nSome useful content.';
    const result = _stripToolNarration(text);
    expect(result).toContain('Some useful content.');
    expect(result).not.toContain('function call');
  });

  it('strips "Let me call/use the X tool" narration', () => {
    const text = 'Let me use the list_files tool to find that.\nThe workspace has 5 files.';
    const result = _stripToolNarration(text);
    expect(result).not.toContain('Let me use');
    expect(result).toContain('The workspace has 5 files.');
  });

  it('strips "This function call will..." narration', () => {
    const text = 'This function call will read the text content of the specified file.\nHere is the summary.';
    const result = _stripToolNarration(text);
    expect(result).not.toContain('function call will');
    expect(result).toContain('Here is the summary.');
  });

  it('strips "Based on the functions provided" narration', () => {
    const text = 'Based on the functions provided and the context:\n\nHere\'s a function call to list_pages with its proper arguments:\n\nSome useful content about the workspace.';
    const result = _stripToolNarration(text);
    expect(result).not.toContain('Based on the functions');
    expect(result).not.toContain('proper arguments');
    expect(result).toContain('Some useful content about the workspace.');
  });

  it('strips "Alternatively you could use X" narration', () => {
    const text = 'Alternatively, since there are no pages in the workspace, you could use `read_file` to read the contents:\nHere are the files.';
    const result = _stripToolNarration(text);
    expect(result).not.toContain('Alternatively');
    expect(result).not.toContain('read_file');
    expect(result).toContain('Here are the files.');
  });

  it('strips "This will list all pages" narration', () => {
    const text = 'This will list all pages in the workspace with their titles and IDs.\nThe workspace has 5 files.';
    const result = _stripToolNarration(text);
    expect(result).not.toContain('This will list');
    expect(result).toContain('The workspace has 5 files.');
  });

  it('strips hallucinated execution results', () => {
    const text = 'It seems that the file "Auto Insurance Policy.md" is not located in the specified path. Let me try again with a different approach.';
    const result = _stripToolNarration(text);
    expect(result).not.toContain('not located');
    expect(result).not.toContain('different approach');
  });

  it('preserves useful content among narration', () => {
    const text = 'The workspace contains 7 files.\n\nHere\'s a function call to read_file with proper args:\nThis will read the insurance policy.\n\nPlease let me know if you need more.';
    const result = _stripToolNarration(text);
    expect(result).toContain('The workspace contains 7 files.');
    expect(result).toContain('Please let me know if you need more.');
  });

  it('returns text unchanged when no narration is present', () => {
    const text = 'The workspace has 5 pages about insurance. Here is a summary.';
    const result = _stripToolNarration(text);
    expect(result).toBe(text);
  });

  it('strips "Action:" block with JSON', () => {
    const text = 'The user wants to know the number of files.\n\nAction:\n{"name": "list_files", "arguments": {"path": "."}}\n\nLet\'s execute this action.';
    const result = _stripToolNarration(text);
    expect(result).not.toContain('Action:');
    expect(result).not.toContain('list_files');
    expect(result).not.toContain("Let's execute");
  });

  it('strips "Execution:" block with hallucinated results', () => {
    const text = 'Execution:\n{"result": [{"name": "Activism", "type": "directory"}]}\n\nThere are 5 folders.';
    const result = _stripToolNarration(text);
    expect(result).not.toContain('Execution:');
    expect(result).not.toContain('Activism');
    expect(result).toContain('There are 5 folders.');
  });

  it('preserves generic explanatory prefacing when no tool syntax is present', () => {
    const text = 'The user wants to know the number of files in the workspace.\n\nThere are 42 files.';
    const result = _stripToolNarration(text);
    expect(result).toContain('The user wants to know');
    expect(result).toContain('There are 42 files.');
  });

  it('preserves "To determine X, I will Y" when it is ordinary explanation, not tool narration', () => {
    const text = 'To determine the number of files in the workspace, I will review the indexed file list.\n\nThere are 42 files.';
    const result = _stripToolNarration(text);
    expect(result).toContain('To determine the number of files');
    expect(result).toContain('There are 42 files.');
  });

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

  it('falls back to extractive retrieved-context lines when the retry is also empty', async () => {
    const { _buildExtractiveFallbackAnswer } = await import('../../src/built-in/chat/participants/defaultParticipant');

    const fallback = _buildExtractiveFallbackAnswer(
      'How do I file a claim and who do I call?',
      '[Retrieved Context]\n---\n[1] Source: Claims Guide.md\nPath: Claims Guide.md\n### Step 1: Report the Claim\n- Your agent: Sarah Chen — (555) 234-5678\n- 24/7 Claims Line: 1-800-555-CLAIM (2524)\n- File within 72 hours of the incident\n---',
    );

    expect(fallback).toContain('Sarah Chen');
    expect(fallback).toContain('1-800-555-CLAIM');
    expect(fallback).toContain('72 hours');
  });

  it('classifies missing grounded evidence as insufficient', async () => {
    const { _assessEvidenceSufficiency } = await import('../../src/built-in/chat/participants/defaultParticipant');

    const assessment = _assessEvidenceSufficiency(
      'What is my collision deductible?',
      '',
      [],
    );

    expect(assessment.status).toBe('insufficient');
    expect(assessment.reasons).toContain('no-grounded-sources');
  });

  it('classifies a focused single-source fact answer as sufficient', async () => {
    const { _assessEvidenceSufficiency } = await import('../../src/built-in/chat/participants/defaultParticipant');

    const assessment = _assessEvidenceSufficiency(
      'What is my collision deductible?',
      [
        '[Retrieved Context]',
        '---',
        '[1] Source: Auto Insurance Policy.md',
        'Path: Auto Insurance Policy.md',
        '### Collision Coverage',
        '- **Deductible:** $500',
        '---',
      ].join('\n'),
      [{ uri: 'Auto Insurance Policy.md', label: 'Auto Insurance Policy.md', index: 1 }],
    );

    expect(assessment.status).toBe('sufficient');
    expect(assessment.reasons).toEqual([]);
  });

  it('classifies partial hard-query evidence as weak', async () => {
    const { _assessEvidenceSufficiency } = await import('../../src/built-in/chat/participants/defaultParticipant');

    const assessment = _assessEvidenceSufficiency(
      'I was rear-ended by an uninsured driver. What should I do and what does my policy cover?',
      [
        '[Retrieved Context]',
        '---',
        '[1] Source: Accident Quick Reference.md',
        'Path: Accident Quick Reference.md',
        '## Uninsured Driver Filing Deadlines',
        '- After an uninsured driver accident, report the claim to your insurer.',
        '- Report to insurer: Within 72 hours',
        '---',
      ].join('\n'),
      [{ uri: 'Accident Quick Reference.md', label: 'Accident Quick Reference.md', index: 1 }],
    );

    expect(assessment.status).toBe('weak');
    expect(assessment.reasons).toEqual(expect.arrayContaining([
      'hard-query-low-source-coverage',
      'hard-query-low-section-coverage',
    ]));
  });

  it('classifies specific coverage claims as insufficient when the evidence only supports a broader category', async () => {
    const { _assessEvidenceSufficiency } = await import('../../src/built-in/chat/participants/defaultParticipant');

    const assessment = _assessEvidenceSufficiency(
      'What does my policy say about earthquake coverage?',
      [
        '[Retrieved Context]',
        '---',
        '[1] Source: Auto Insurance Policy.md',
        'Path: Auto Insurance Policy.md',
        '### Comprehensive Coverage',
        'Covers damage to your vehicle from non-collision events: theft, vandalism, natural disasters, falling objects, animal strikes.',
        '---',
      ].join('\n'),
      [{ uri: 'Auto Insurance Policy.md', label: 'Auto Insurance Policy.md', index: 1 }],
    );

    expect(assessment.status).toBe('insufficient');
    expect(assessment.reasons).toContain('specific-coverage-not-explicitly-supported');
  });

  it('builds a deterministic session summary from recent user-provided facts', async () => {
    const { _buildDeterministicSessionSummary } = await import('../../src/built-in/chat/participants/defaultParticipant');

    const summary = _buildDeterministicSessionSummary(
      [{ request: { text: 'I was in a car accident yesterday at the Riverside Mall parking lot on Elm Street.' } }],
      'The other driver ran a red light, hit my passenger door, and the police report number is 2026-0305-1147.',
    );

    expect(summary).toContain('Riverside Mall parking lot');
    expect(summary).toContain('Elm Street');
    expect(summary).toContain('red light');
    expect(summary).toContain('passenger door');
    expect(summary).toContain('2026-0305-1147');
  });

  it('builds a keyword-focused retrieve-again query from unresolved terms', async () => {
    const { _buildRetrieveAgainQuery } = await import('../../src/built-in/chat/participants/defaultParticipant');

    const query = _buildRetrieveAgainQuery(
      'At what point would my car be declared a total loss?',
      [
        '[Retrieved Context]',
        '---',
        '[1] Source: Accident Quick Reference.md',
        'Path: Accident Quick Reference.md',
        '## Filing Deadlines',
        '- Report to insurer: Within 72 hours',
        '---',
      ].join('\n'),
    );

    expect(query).toContain('declared');
    expect(query).toContain('total');
    expect(query).toContain('loss');
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
    expect(stream.calls.markdown.join('')).toMatch(/do not see earthquake explicitly listed|cannot confirm/i);
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
    expect(stream.calls.markdown.join('')).toMatch(/do not see earthquake explicitly listed|cannot confirm/i);
    expect(stream.calls.markdown.join('')).toMatch(/contact your agent|endorsement|additional coverage/i);
  });

  it('repairs overly definitive unsupported specific coverage answers into document-bounded uncertainty', async () => {
    const { _repairUnsupportedSpecificCoverageAnswer } = await import('../../src/built-in/chat/participants/defaultParticipant');

    const repaired = _repairUnsupportedSpecificCoverageAnswer(
      'What does my policy say about earthquake coverage?',
      'Your policy does not include earthquake coverage. It is covered under the broader natural disasters category. [1]',
      { status: 'insufficient', reasons: ['specific-coverage-not-explicitly-supported'] },
    );

    expect(repaired).toContain('do not explicitly confirm earthquake');
    expect(repaired).toContain('do not explicitly name that specific coverage');
  });

  it('removes broader-category affirmative phrasing for unsupported specific coverage answers', async () => {
    const { _repairUnsupportedSpecificCoverageAnswer } = await import('../../src/built-in/chat/participants/defaultParticipant');

    const repaired = _repairUnsupportedSpecificCoverageAnswer(
      'What does my policy say about earthquake coverage?',
      'The policy documents do not explicitly confirm earthquake. The documents mention natural disasters. So the policy covers earthquake under that broader category. [1]',
      { status: 'insufficient', reasons: ['specific-coverage-not-explicitly-supported'] },
    );

    expect(repaired).toContain('do not explicitly confirm earthquake');
    expect(repaired).toContain('do not explicitly name that specific coverage');
    expect(repaired).not.toMatch(/covers? earthquake/i);
  });

  it('removes unsupported specific coverage phrasing that says broader coverage would apply', async () => {
    const { _repairUnsupportedSpecificCoverageAnswer } = await import('../../src/built-in/chat/participants/defaultParticipant');

    const repaired = _repairUnsupportedSpecificCoverageAnswer(
      'What does my policy say about earthquake coverage?',
      'The policy documents do not explicitly confirm earthquake. The only coverage that would apply to seismic events is the Comprehensive part of the policy, which covers natural disasters. [1]',
      { status: 'insufficient', reasons: ['specific-coverage-not-explicitly-supported'] },
    );

    expect(repaired).toContain('do not explicitly confirm earthquake');
    expect(repaired).toContain('do not explicitly name that specific coverage');
    expect(repaired).not.toMatch(/would apply to seismic events/i);
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

  it('repairs malformed collision deductible answers to the grounded policy amount', async () => {
    const { _repairDeductibleConflictAnswer } = await import('../../src/built-in/chat/participants/defaultParticipant');

    const repaired = _repairDeductibleConflictAnswer(
      'What is my collision deductible now?',
      'Your collision deductible is ** 17',
      [
        '[Retrieved Context]',
        '---',
        '[1] Source: Auto Insurance Policy.md',
        'Path: Auto Insurance Policy.md',
        '### Collision Coverage',
        '- **Deductible:** $950',
        '---',
      ].join('\n'),
    );

    expect(repaired).toContain('$950');
    expect(repaired).not.toContain('$500');
  });

  it('repairs vehicle answers to include trim or color when grounded context has it', async () => {
    const { _repairVehicleInfoAnswer } = await import('../../src/built-in/chat/participants/defaultParticipant');

    const repaired = _repairVehicleInfoAnswer(
      'Tell me about my insured vehicle.',
      'Your insured vehicle is a 2024 Honda Accord.',
      [
        '[Retrieved Context]',
        '---',
        '[1] Source: Vehicle Info.md',
        'Path: Vehicle Info.md',
        '2024 Honda Accord EX-L',
        'Color: Lunar Silver Metallic',
        '---',
      ].join('\n'),
    );

    expect(repaired).toMatch(/EX-L|Lunar Silver Metallic/i);
  });

  it('keeps extractive fallback anchored to the matching repair-shop section', async () => {
    const { _buildExtractiveFallbackAnswer } = await import('../../src/built-in/chat/participants/defaultParticipant');

    const fallback = _buildExtractiveFallbackAnswer(
      'Which repair shops are recommended under my policy? Please cite your sources.',
      [
        '[Retrieved Context]',
        '---',
        '[1] Source: Agent Contacts.md',
        'Path: Agent Contacts.md',
        '## Preferred Repair Shops',
        '1. **AutoCraft Collision Center**',
        '2. **Precision Auto Body**',
        '3. **Riverside Honda Service Center**',
        '---',
        '[2] Source: Vehicle Info.md',
        'Path: Vehicle Info.md',
        '## Estimated Current Value',
        '- **Note:** Total loss threshold is 75% of current value',
        '---',
      ].join('\n'),
    );

    expect(fallback).toContain('AutoCraft Collision Center');
    expect(fallback).toContain('Precision Auto Body');
    expect(fallback).not.toContain('Total loss threshold');
  });

  it('combines the strongest retrieved sections when a query needs contact and deadline details', async () => {
    const { _buildExtractiveFallbackAnswer } = await import('../../src/built-in/chat/participants/defaultParticipant');

    const fallback = _buildExtractiveFallbackAnswer(
      'OK I want to file a claim. How do I do that and who do I call?',
      [
        '[Retrieved Context]',
        '---',
        '[1] Source: Claims Guide.md',
        'Path: Claims Guide.md',
        '### Step 1: Report the Claim',
        '**Who to contact:**',
        '- **Your agent:** Sarah Chen — (555) 234-5678 (Mon-Fri 8am-6pm)',
        '- **24/7 Claims Line:** 1-800-555-CLAIM (2524)',
        '- Policy number: PLX-2026-4481',
        '- Police report number',
        '---',
        '[2] Source: Auto Insurance Policy.md',
        'Path: Auto Insurance Policy.md',
        '## How to File a Claim',
        '1. Call your agent or the 24/7 claims line: **1-800-555-CLAIM (2524)**',
        '2. File within **72 hours** of the incident',
        '---',
        '[3] Source: Claims Guide.md',
        'Path: Claims Guide.md',
        '## Uninsured Motorist (UM) Claim Procedure',
        '1. **File a police report within 24 hours** (mandatory for UM claims)',
        '---',
      ].join('\n'),
    );

    expect(fallback).toContain('Sarah Chen');
    expect(fallback).toContain('1-800-555-CLAIM');
    expect(fallback).toContain('72 hours');
    expect(fallback).not.toContain('mandatory for UM claims');
  });

  it('repairs agent contact answers to include the agent name and ASCII phone formatting', async () => {
    const { _repairAgentContactAnswer } = await import('../../src/built-in/chat/participants/defaultParticipant');

    const repaired = _repairAgentContactAnswer(
      "What is my insurance agent's phone number?",
      'Your agent’s phone number is (555) 234‑5678 1\n\nSources: 1 Agent Contacts.md; 2 Claims Guide.md',
      [
        '[Retrieved Context]',
        '---',
        '[1] Source: Agent Contacts.md',
        'Path: Agent Contacts.md',
        '## Agent & Emergency Contacts',
        '| Field | Details |',
        '|-------|---------|',
        '| **Name** | Sarah Chen |',
        '| **Title** | Senior Insurance Agent |',
        '| **Phone** | (555) 234-5678 |',
        '---',
      ].join('\n'),
    );

    expect(repaired).toContain('Sarah Chen');
    expect(repaired).toContain('(555) 234-5678');
  });

  it('repairs total-loss answers to preserve ASCII 75% and the KBB shorthand from retrieved evidence', async () => {
    const { _repairTotalLossThresholdAnswer } = await import('../../src/built-in/chat/participants/defaultParticipant');

    const repaired = _repairTotalLossThresholdAnswer(
      'At what point would my car be declared a total loss?',
      [
        'Your vehicle would be declared a total loss when the estimated repair cost exceeds 75 % of its current market value.',
        '',
        'Current value (Kelly Blue Book Jan 2026): $28,500 - $30,200.',
      ].join('\n'),
      [
        '[Retrieved Context]',
        '---',
        '[1] Source: Vehicle Info.md',
        'Path: Vehicle Info.md',
        '## Estimated Current Value',
        '- **Kelly Blue Book (Jan 2026):** $28,500 - $30,200',
        '- **Note:** Total loss threshold is 75% of current value (~$21,375 - $22,650).',
        '---',
      ].join('\n'),
    );

    expect(repaired).toContain('75%');
    expect(repaired).toContain('Kelly Blue Book (KBB)');
  });

  it('repairs deductible confirmation answers to explicitly reject an incorrect claimed amount', async () => {
    const { _repairDeductibleConflictAnswer } = await import('../../src/built-in/chat/participants/defaultParticipant');

    const repaired = _repairDeductibleConflictAnswer(
      'I remember my collision deductible is $1,000. Can you confirm?',
      'Your collision deductible is $500 according to the policy summary.',
      [
        '[Retrieved Context]',
        '---',
        '[1] Source: Auto Insurance Policy.md',
        '### Collision Coverage',
        '- **Deductible:** $500',
        '---',
      ].join('\n'),
    );

    expect(repaired).toContain('No.');
    expect(repaired).toContain('$500');
    expect(repaired).toContain('$1,000');
  });

  it('repairs current deductible answers to avoid repeating a stale conflicting amount', async () => {
    const { _repairDeductibleConflictAnswer } = await import('../../src/built-in/chat/participants/defaultParticipant');

    const repaired = _repairDeductibleConflictAnswer(
      'What is my collision deductible now?',
      [
        'Your collision coverage has a deductible of $750 per occurrence as listed in the policy summary.',
        'The quick-reference card also lists a $500 deductible, which may be an older or incorrect figure.',
        '',
        'Collision deductible per policy: $750',
        'Quick-reference card lists $500',
      ].join('\n'),
      [
        '[Retrieved Context]',
        '---',
        '[1] Source: Auto Insurance Policy.md',
        '### Collision Coverage',
        '- **Deductible:** $750',
        '---',
        '[5] Source: Accident Quick Reference.md',
        '| **Collision Deductible** | $500 |',
        '---',
      ].join('\n'),
    );

    expect(repaired).toContain('$750');
    expect(repaired).not.toContain('$500');
    expect(repaired).toContain('current policy amount');
  });

  it('repairs direct deductible answers to suppress stale conflicting amounts from older references', async () => {
    const { _repairDeductibleConflictAnswer } = await import('../../src/built-in/chat/participants/defaultParticipant');

    const repaired = _repairDeductibleConflictAnswer(
      'What is my collision deductible?',
      'Your collision deductible is $950 per occurrence. (While the quick-reference card lists $500, the policy summary specifies $950.)',
      [
        '[Retrieved Context]',
        '---',
        '[1] Source: Auto Insurance Policy.md',
        '### Collision Coverage',
        '- **Deductible:** $950',
        '---',
        '[5] Source: Accident Quick Reference.md',
        '| **Collision Deductible** | $500 |',
        '---',
      ].join('\n'),
    );

    expect(repaired).toContain('$950');
    expect(repaired).not.toContain('$500');
  });

  it('combines primary and backup coverage sections when the query asks what coverage applies', async () => {
    const { _buildExtractiveFallbackAnswer } = await import('../../src/built-in/chat/participants/defaultParticipant');

    const fallback = _buildExtractiveFallbackAnswer(
      'They said they have insurance but I am not sure. What coverage do I have for this?',
      [
        '[Retrieved Context]',
        '---',
        '[1] Source: Claims Guide.md',
        'Path: Claims Guide.md',
        '## Uninsured Motorist (UM) Claim Procedure',
        '3. Your UM coverage applies: up to $100,000/$300,000 bodily injury, $25,000 property damage',
        '---',
        '[2] Source: Auto Insurance Policy.md',
        'Path: Auto Insurance Policy.md',
        '### Collision Coverage',
        '- **Coverage Limit:** $50,000 per occurrence',
        '- **Deductible:** $500',
        '---',
      ].join('\n'),
    );

    expect(fallback).toContain('Collision Coverage');
    expect(fallback).toContain('$500');
    expect(fallback).toContain('UM coverage applies');
  });

  it('repairs code-oriented answers with the exact helper and stage names from retrieved context', async () => {
    const { _repairGroundedCodeAnswer } = await import('../../src/built-in/chat/participants/defaultParticipant');

    const repaired = _repairGroundedCodeAnswer(
      'Which helper assembles the escalation packet in the workflow architecture doc, and what two stage names does it include?',
      'The escalation packet is assembled by the Severity Desk Coordinator. It includes valuation and photos.',
      [
        '[Retrieved Context]',
        '---',
        '[1] Source: Claims Workflow Architecture.md',
        '```ts',
        'export function buildEscalationPacket() {',
        '  return {',
        "    stages: ['policy-summary', 'valuation', 'photos', 'police-report'],",
        "    owner: 'Severity Desk Coordinator',",
        '  };',
        '}',
        '```',
      ].join('\n'),
    );

    expect(repaired).toContain('buildEscalationPacket');
    expect(repaired).toContain('policy-summary');
    expect(repaired).toContain('valuation');
  });

  it('leaves non-code answers unchanged when the query is not asking for helper or stage names', async () => {
    const { _repairGroundedCodeAnswer } = await import('../../src/built-in/chat/participants/defaultParticipant');

    const answer = 'The Severity Desk Coordinator owns packet completeness.';
    const repaired = _repairGroundedCodeAnswer(
      'Who owns packet completeness in the workflow architecture doc?',
      answer,
      [
        '[Retrieved Context]',
        '---',
        '[1] Source: Claims Workflow Architecture.md',
        '### 3.1 Packet Ownership',
        'The Severity Desk Coordinator is responsible for packet completeness.',
        '---',
      ].join('\n'),
    );

    expect(repaired).toBe(answer);
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

describe('_buildMissingCitationFooter', () => {
  let _buildMissingCitationFooter: typeof import('../../src/built-in/chat/participants/defaultParticipant')._buildMissingCitationFooter;

  beforeEach(async () => {
    const mod = await import('../../src/built-in/chat/participants/defaultParticipant');
    _buildMissingCitationFooter = mod._buildMissingCitationFooter;
  });

  it('adds a visible citation footer when markdown has no [N] markers', () => {
    const footer = _buildMissingCitationFooter(
      'Recommended shops are AutoCraft Collision Center and Precision Auto Body.',
      [
        { index: 4, label: 'Agent Contacts.md' },
        { index: 7, label: 'Claims Guide.md' },
      ],
    );

    expect(footer).toBe('\n\nSources: [4] Agent Contacts.md; [7] Claims Guide.md');
  });

  it('skips the fallback when markdown already names the source document', () => {
    const footer = _buildMissingCitationFooter(
      'Recommended shops are listed in Agent Contacts.md.',
      [{ index: 4, label: 'Agent Contacts.md' }],
    );

    expect(footer).toBe('');
  });

  it('adds the fallback when markdown only has bare numeric citation text', () => {
    const footer = _buildMissingCitationFooter(
      'Recommended shops are AutoCraft Collision Center 4 and Precision Auto Body 4.',
      [{ index: 4, label: 'Agent Contacts.md' }],
    );

    expect(footer).toBe('\n\nSources: [4] Agent Contacts.md');
  });

  it('adds the fallback when markdown only uses a generic Source column header', () => {
    const footer = _buildMissingCitationFooter(
      [
        '| Step | Source |',
        '|------|--------|',
        '| Call your agent | 1 |',
      ].join('\n'),
      [{ index: 1, label: 'Accident Quick Reference.md' }],
    );

    expect(footer).toBe('\n\nSources: [1] Accident Quick Reference.md');
  });

  it('adds the fallback when markdown references only the source stem without the file name', () => {
    const footer = _buildMissingCitationFooter(
      'These details come from the Claims Workflow Architecture document. 1',
      [{ index: 1, label: 'Claims Workflow Architecture.md' }],
    );

    expect(footer).toBe('\n\nSources: [1] Claims Workflow Architecture.md');
  });
});
