// Unit tests for workspaceParticipant — M9 Cap 5 Task 5.3

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatMode } from '../../src/services/chatTypes';
import type {
  IChatParticipantRequest,
  IChatParticipantContext,
  IChatResponseStream,
  ICancellationToken,
  IChatMessage,
  IChatRequestOptions,
  IChatResponseChunk,
} from '../../src/services/chatTypes';
import { createWorkspaceParticipant } from '../../src/built-in/chat/participants/workspaceParticipant';
import type { IWorkspaceParticipantServices, IPageSummary } from '../../src/built-in/chat/participants/workspaceParticipant';

// ── Mock helpers ──

function mockServices(overrides?: Partial<IWorkspaceParticipantServices>): IWorkspaceParticipantServices {
  return {
    sendChatRequest: vi.fn(async function* (): AsyncIterable<IChatResponseChunk> {
      yield { content: 'LLM response', thinking: undefined, toolCalls: undefined };
    }),
    getActiveModel: vi.fn(() => 'test-model'),
    listPages: vi.fn(async () => [
      { id: 'p1', title: 'Meeting Notes', icon: '📝' },
      { id: 'p2', title: 'Project Plan', icon: '📋' },
    ]),
    searchPages: vi.fn(async () => [
      { id: 'p1', title: 'Meeting Notes', icon: '📝' },
    ]),
    getPageContent: vi.fn(async () => '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Hello world"}]}]}'),
    getPageTitle: vi.fn(async () => 'Meeting Notes'),
    getWorkspaceName: vi.fn(() => 'Test Workspace'),
    ...overrides,
  };
}

function mockRequest(overrides?: Partial<IChatParticipantRequest>): IChatParticipantRequest {
  return {
    text: 'hello',
    requestId: 'req-1',
    mode: ChatMode.Ask,
    modelId: 'test-model',
    attempt: 0,
    ...overrides,
  };
}

function mockContext(): IChatParticipantContext {
  return { sessionId: 'test-session', history: [] };
}

function mockStream(): IChatResponseStream {
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
    throwIfDone: vi.fn(),
  };
}

function mockToken(cancelled = false): ICancellationToken {
  return {
    isCancellationRequested: cancelled,
    onCancellationRequested: vi.fn(() => ({ dispose: vi.fn() })),
  };
}

// ── Tests ──

describe('createWorkspaceParticipant', () => {
  it('returns a participant with correct metadata', () => {
    const p = createWorkspaceParticipant(mockServices());
    expect(p.id).toBe('parallx.chat.workspace');
    expect(p.displayName).toBe('Workspace');
    expect(p.commands).toHaveLength(3);
    expect(p.commands.map((c) => c.name)).toEqual(['search', 'list', 'summarize']);
  });
});

describe('workspace participant: /list command', () => {
  it('lists pages and writes references', async () => {
    const services = mockServices();
    const stream = mockStream();
    const participant = createWorkspaceParticipant(services);

    await participant.handler(
      mockRequest({ command: 'list', text: '' }),
      mockContext(),
      stream,
      mockToken(),
    );

    expect(services.listPages).toHaveBeenCalled();
    expect(stream.progress).toHaveBeenCalledWith('Listing workspace pages...');
    expect(stream.reference).toHaveBeenCalledTimes(2);
    expect(stream.markdown).toHaveBeenCalled();
    const mdCall = (stream.markdown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(mdCall).toContain('2 pages');
    expect(mdCall).toContain('Meeting Notes');
    expect(mdCall).toContain('Project Plan');
  });

  it('handles empty workspace', async () => {
    const services = mockServices({ listPages: vi.fn(async () => []) });
    const stream = mockStream();
    const participant = createWorkspaceParticipant(services);

    await participant.handler(
      mockRequest({ command: 'list', text: '' }),
      mockContext(),
      stream,
      mockToken(),
    );

    const mdCall = (stream.markdown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(mdCall).toContain('no pages');
  });
});

describe('workspace participant: /search command', () => {
  it('searches pages and streams LLM response', async () => {
    const services = mockServices();
    const stream = mockStream();
    const participant = createWorkspaceParticipant(services);

    await participant.handler(
      mockRequest({ command: 'search', text: 'meeting' }),
      mockContext(),
      stream,
      mockToken(),
    );

    expect(services.searchPages).toHaveBeenCalledWith('meeting');
    expect(stream.progress).toHaveBeenCalledWith('Searching for "meeting"...');
    expect(stream.reference).toHaveBeenCalled();
    expect(services.sendChatRequest).toHaveBeenCalled();
    expect(stream.markdown).toHaveBeenCalledWith('LLM response');
  });

  it('handles no results', async () => {
    const services = mockServices({ searchPages: vi.fn(async () => []) });
    const stream = mockStream();
    const participant = createWorkspaceParticipant(services);

    await participant.handler(
      mockRequest({ command: 'search', text: 'nonexistent' }),
      mockContext(),
      stream,
      mockToken(),
    );

    const mdCall = (stream.markdown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(mdCall).toContain('No pages found');
  });

  it('asks for query when text is empty', async () => {
    const services = mockServices();
    const stream = mockStream();
    const participant = createWorkspaceParticipant(services);

    await participant.handler(
      mockRequest({ command: 'search', text: '' }),
      mockContext(),
      stream,
      mockToken(),
    );

    const mdCall = (stream.markdown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(mdCall).toContain('search query');
  });
});

describe('workspace participant: /summarize command', () => {
  it('summarizes a page', async () => {
    const services = mockServices();
    const stream = mockStream();
    const participant = createWorkspaceParticipant(services);

    await participant.handler(
      mockRequest({ command: 'summarize', text: 'p1' }),
      mockContext(),
      stream,
      mockToken(),
    );

    expect(services.getPageTitle).toHaveBeenCalledWith('p1');
    expect(services.getPageContent).toHaveBeenCalledWith('p1');
    expect(stream.reference).toHaveBeenCalled();
    expect(services.sendChatRequest).toHaveBeenCalled();
  });

  it('handles page not found', async () => {
    const services = mockServices({ getPageTitle: vi.fn(async () => null) });
    const stream = mockStream();
    const participant = createWorkspaceParticipant(services);

    await participant.handler(
      mockRequest({ command: 'summarize', text: 'unknown-id' }),
      mockContext(),
      stream,
      mockToken(),
    );

    const mdCall = (stream.markdown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(mdCall).toContain('not found');
  });
});

describe('workspace participant: general (no command)', () => {
  it('injects workspace context and streams response', async () => {
    const services = mockServices();
    const stream = mockStream();
    const participant = createWorkspaceParticipant(services);

    await participant.handler(
      mockRequest({ text: 'What pages do I have?' }),
      mockContext(),
      stream,
      mockToken(),
    );

    expect(services.listPages).toHaveBeenCalled();
    expect(stream.progress).toHaveBeenCalledWith('Gathering workspace context...');
    expect(services.sendChatRequest).toHaveBeenCalled();

    // Check system message includes workspace context
    const messages = (services.sendChatRequest as ReturnType<typeof vi.fn>).mock.calls[0][0] as IChatMessage[];
    const system = messages.find((m) => m.role === 'system');
    expect(system?.content).toContain('Test Workspace');
    expect(system?.content).toContain('Meeting Notes');
  });
});

describe('workspace participant: cancellation', () => {
  it('respects cancellation token', async () => {
    const services = mockServices();
    const stream = mockStream();
    const participant = createWorkspaceParticipant(services);

    const result = await participant.handler(
      mockRequest({ command: 'list', text: '' }),
      mockContext(),
      stream,
      mockToken(true), // cancelled
    );

    expect(result).toEqual({});
    // Should not call listPages because cancelled before data fetch
    // (progress is called before the check)
  });
});
