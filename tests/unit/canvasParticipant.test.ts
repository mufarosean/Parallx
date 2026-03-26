// Unit tests for canvasParticipant — M9 Cap 5 Task 5.4

import { describe, it, expect, vi } from 'vitest';
import { ChatMode } from '../../src/services/chatTypes';
import type {
  IChatParticipantRequest,
  IChatParticipantContext,
  IChatResponseStream,
  ICancellationToken,
  IChatMessage,
  IChatResponseChunk,
} from '../../src/services/chatTypes';
import { createCanvasParticipant } from '../../src/built-in/chat/participants/canvasParticipant';
import type { ICanvasParticipantServices, IPageStructure } from '../../src/built-in/chat/participants/canvasParticipant';

// ── Mock helpers ──

const MOCK_STRUCTURE: IPageStructure = {
  pageId: 'page-1',
  title: 'Design Doc',
  icon: '📐',
  blocks: [
    { id: 'block-1-abcdef', blockType: 'heading', parentBlockId: null, sortOrder: 0, textPreview: 'Introduction' },
    { id: 'block-2-abcdef', blockType: 'paragraph', parentBlockId: null, sortOrder: 1, textPreview: 'This document describes...' },
    { id: 'block-3-abcdef', blockType: 'list', parentBlockId: null, sortOrder: 2, textPreview: 'Item 1, Item 2' },
  ],
};

function mockServices(overrides?: Partial<ICanvasParticipantServices>): ICanvasParticipantServices {
  return {
    sendChatRequest: vi.fn(async function* (): AsyncIterable<IChatResponseChunk> {
      yield { content: 'LLM canvas response', thinking: undefined, toolCalls: undefined };
    }),
    getActiveModel: vi.fn(() => 'test-model'),
    getCurrentPageId: vi.fn(() => 'page-1'),
    getCurrentPageTitle: vi.fn(() => 'Design Doc'),
    getPageStructure: vi.fn(async () => MOCK_STRUCTURE),
    getWorkspaceName: vi.fn(() => 'Test Workspace'),
    readFileContent: vi.fn(async (relativePath: string) => `content for ${relativePath}`),
    reportParticipantDebug: vi.fn(),
    reportRuntimeTrace: vi.fn(),
    ...overrides,
  };
}

function mockRequest(overrides?: Partial<IChatParticipantRequest>): IChatParticipantRequest {
  return {
    text: 'hello',
    requestId: 'req-1',
    mode: ChatMode.Agent,
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
    replaceLastMarkdown: vi.fn(),
    reportTokenUsage: vi.fn(),
    setCitations: vi.fn(),
    getMarkdownText: vi.fn(() => ''),
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

describe('createCanvasParticipant', () => {
  it('returns a participant with correct metadata', () => {
    const p = createCanvasParticipant(mockServices());
    expect(p.id).toBe('parallx.chat.canvas');
    expect(p.displayName).toBe('Canvas');
    expect(p.commands).toHaveLength(2);
    expect(p.commands.map((c) => c.name)).toEqual(['describe', 'blocks']);
  });
});

describe('canvas participant: /describe command', () => {
  it('describes page structure via LLM', async () => {
    const services = mockServices();
    const stream = mockStream();
    const participant = createCanvasParticipant(services);

    await participant.handler(
      mockRequest({ command: 'describe', text: '' }),
      mockContext(),
      stream,
      mockToken(),
    );

    expect(services.getCurrentPageId).toHaveBeenCalled();
    expect(services.getPageStructure).toHaveBeenCalledWith('page-1');
    expect(stream.progress).toHaveBeenCalledWith('Reading page structure...');
    expect(stream.reference).toHaveBeenCalled();
    expect(services.sendChatRequest).toHaveBeenCalled();

    // Check system message has page structure
    const messages = (services.sendChatRequest as ReturnType<typeof vi.fn>).mock.calls[0][0] as IChatMessage[];
    const system = messages.find((m) => m.role === 'system');
    expect(system?.content).toContain('Design Doc');
    expect(system?.content).toContain('heading');
    expect(system?.content).toContain('paragraph');
    expect(services.reportRuntimeTrace).toHaveBeenCalledWith(expect.objectContaining({
      checkpoint: 'prompt-seed',
      note: 'canvas scoped participant prompt seed',
    }));
    expect(services.reportRuntimeTrace).toHaveBeenCalledWith(expect.objectContaining({
      checkpoint: 'prompt-envelope',
      note: 'canvas scoped participant prompt envelope',
    }));
  });

  it('handles no active page', async () => {
    const services = mockServices({ getCurrentPageId: vi.fn(() => undefined) });
    const stream = mockStream();
    const participant = createCanvasParticipant(services);

    await participant.handler(
      mockRequest({ command: 'describe', text: '' }),
      mockContext(),
      stream,
      mockToken(),
    );

    const mdCall = (stream.markdown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(mdCall).toContain('No page is currently open');
  });

  it('handles page structure not found', async () => {
    const services = mockServices({ getPageStructure: vi.fn(async () => null) });
    const stream = mockStream();
    const participant = createCanvasParticipant(services);

    await participant.handler(
      mockRequest({ command: 'describe', text: '' }),
      mockContext(),
      stream,
      mockToken(),
    );

    const mdCall = (stream.markdown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(mdCall).toContain('Could not read');
  });
});

describe('canvas participant: /blocks command', () => {
  it('lists blocks with types and previews', async () => {
    const services = mockServices();
    const stream = mockStream();
    const participant = createCanvasParticipant(services);

    await participant.handler(
      mockRequest({ command: 'blocks', text: '' }),
      mockContext(),
      stream,
      mockToken(),
    );

    expect(services.getPageStructure).toHaveBeenCalledWith('page-1');
    expect(stream.reference).toHaveBeenCalled();

    const mdCall = (stream.markdown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(mdCall).toContain('3 blocks');
    expect(mdCall).toContain('heading');
    expect(mdCall).toContain('paragraph');
    expect(mdCall).toContain('list');
  });

  it('handles empty page (no blocks)', async () => {
    const emptyStructure: IPageStructure = { pageId: 'p1', title: 'Empty', blocks: [] };
    const services = mockServices({ getPageStructure: vi.fn(async () => emptyStructure) });
    const stream = mockStream();
    const participant = createCanvasParticipant(services);

    await participant.handler(
      mockRequest({ command: 'blocks', text: '' }),
      mockContext(),
      stream,
      mockToken(),
    );

    const mdCall = (stream.markdown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(mdCall).toContain('has no blocks');
  });

  it('handles no active page', async () => {
    const services = mockServices({ getCurrentPageId: vi.fn(() => undefined) });
    const stream = mockStream();
    const participant = createCanvasParticipant(services);

    await participant.handler(
      mockRequest({ command: 'blocks', text: '' }),
      mockContext(),
      stream,
      mockToken(),
    );

    const mdCall = (stream.markdown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(mdCall).toContain('No page is currently open');
  });
});

describe('canvas participant: general (no command)', () => {
  it('includes page context in LLM request', async () => {
    const services = mockServices();
    const stream = mockStream();
    const participant = createCanvasParticipant(services);

    await participant.handler(
      mockRequest({ text: 'What is this page about?' }),
      mockContext(),
      stream,
      mockToken(),
    );

    expect(services.getPageStructure).toHaveBeenCalledWith('page-1');
    expect(services.sendChatRequest).toHaveBeenCalled();
    expect(stream.markdown).toHaveBeenCalledWith('LLM canvas response');
  });

  it('reports scoped runtime checkpoints through shared participant runtime context', async () => {
    const services = mockServices({ reportRuntimeTrace: undefined });
    const stream = mockStream();
    const participant = createCanvasParticipant(services);
    const reportTrace = vi.fn();

    await participant.handler(
      mockRequest({ text: 'What is this page about?' }),
      { sessionId: 'test-session', history: [], runtime: { reportTrace } },
      stream,
      mockToken(),
    );

    expect(reportTrace).toHaveBeenCalledWith(expect.objectContaining({
      checkpoint: 'scoped-handler-start',
      runState: 'executing',
      runtime: 'claw',
      note: 'canvas scoped participant dispatch',
    }));
    expect(reportTrace).toHaveBeenCalledWith(expect.objectContaining({
      checkpoint: 'prompt-envelope',
      runtime: 'claw',
      note: 'canvas scoped participant prompt envelope',
    }));
    expect(reportTrace).toHaveBeenCalledWith(expect.objectContaining({
      checkpoint: 'scoped-handler-complete',
      runState: 'completed',
      runtime: 'claw',
      note: 'canvas scoped participant dispatch',
    }));
  });

  it('passes image attachments through to the scoped participant user message and image payload', async () => {
    const services = mockServices();
    const stream = mockStream();
    const participant = createCanvasParticipant(services);

    await participant.handler(
      mockRequest({
        text: 'Describe this screenshot',
        attachments: [{
          kind: 'image',
          id: 'image-1',
          name: 'screenshot.png',
          fullPath: 'image-1',
          isImplicit: false,
          mimeType: 'image/png',
          data: 'abc123',
        }],
      }),
      mockContext(),
      stream,
      mockToken(),
    );

    const messages = (services.sendChatRequest as ReturnType<typeof vi.fn>).mock.calls[0][0] as IChatMessage[];
    const userMessage = messages.find((m) => m.role === 'user');
    expect(userMessage?.content).toContain('[Attached image: screenshot.png]');
    expect(userMessage?.images).toHaveLength(1);
    expect(services.reportParticipantDebug).toHaveBeenCalledWith(expect.objectContaining({
      surface: 'canvas',
      imageAttachmentCount: 1,
    }));
  });

  it('handles no active page gracefully', async () => {
    const services = mockServices({ getCurrentPageId: vi.fn(() => undefined) });
    const stream = mockStream();
    const participant = createCanvasParticipant(services);

    await participant.handler(
      mockRequest({ text: 'Tell me about canvas' }),
      mockContext(),
      stream,
      mockToken(),
    );

    // Should still send request but without page context
    expect(services.sendChatRequest).toHaveBeenCalled();
    const messages = (services.sendChatRequest as ReturnType<typeof vi.fn>).mock.calls[0][0] as IChatMessage[];
    const system = messages.find((m) => m.role === 'system');
    expect(system?.content).toContain('No page is currently open');
  });
});

describe('canvas participant: error handling', () => {
  it('returns error details on service failure', async () => {
    const services = mockServices({
      getPageStructure: vi.fn(async () => { throw new Error('DB error'); }),
    });
    const stream = mockStream();
    const participant = createCanvasParticipant(services);

    const result = await participant.handler(
      mockRequest({ command: 'describe', text: '' }),
      mockContext(),
      stream,
      mockToken(),
    );

    expect(result.errorDetails).toBeDefined();
    expect(result.errorDetails!.message).toContain('DB error');
  });
});
