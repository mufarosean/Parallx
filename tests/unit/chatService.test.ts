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

  it('strips "The user wants to know..." restating', () => {
    const text = 'The user wants to know the number of files in the workspace.\n\nThere are 42 files.';
    const result = _stripToolNarration(text);
    expect(result).not.toContain('The user wants to know');
    expect(result).toContain('There are 42 files.');
  });

  it('strips "To determine X, I will Y" narration', () => {
    const text = 'To determine the number of files in the workspace, I will list all files.\n\nThere are 42 files.';
    const result = _stripToolNarration(text);
    expect(result).not.toContain('To determine');
    expect(result).toContain('There are 42 files.');
  });
});
