import { describe, expect, it, vi } from 'vitest';

import { ChatMode } from '../../src/services/chatTypes';
import type {
  IChatParticipantContext,
  IChatParticipantRequest,
  IChatResponseChunk,
  IChatResponseStream,
  ICancellationToken,
} from '../../src/services/chatTypes';
import { createOpenclawWorkspaceParticipant } from '../../src/openclaw/participants/openclawWorkspaceParticipant';
import { createOpenclawCanvasParticipant } from '../../src/openclaw/participants/openclawCanvasParticipant';
import type {
  ICanvasParticipantServices,
  IWorkspaceParticipantServices,
} from '../../src/openclaw/openclawTypes';

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

function createToken(): ICancellationToken {
  return {
    isCancellationRequested: false,
    onCancellationRequested: vi.fn(() => ({ dispose: vi.fn() })) as any,
  };
}

async function* streamChunks(chunks: IChatResponseChunk[]): AsyncIterable<IChatResponseChunk> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

describe('openclaw scoped participants', () => {
  it('answers workspace document listing queries deterministically without the model', async () => {
    const sendChatRequest = vi.fn(() => streamChunks([{ content: 'should not run', done: true }]));
    const participant = createOpenclawWorkspaceParticipant({
      sendChatRequest,
      getActiveModel: () => 'test-model',
      getWorkspaceName: () => 'Demo Workspace',
      listPages: vi.fn(async () => []),
      searchPages: vi.fn(async () => []),
      getPageContent: vi.fn(async () => ''),
      getPageTitle: vi.fn(async () => undefined),
      listFiles: vi.fn(async (relativePath: string) => {
        if (!relativePath || relativePath === '.') {
          return [
            { name: 'Agent Contacts.md', type: 'file' },
            { name: 'Claims Guide.md', type: 'file' },
            { name: '.parallx', type: 'directory' },
          ];
        }
        return [];
      }),
      readFileContent: vi.fn(async () => null),
      getReadOnlyToolDefinitions: () => [],
      reportRuntimeTrace: vi.fn(),
    } as IWorkspaceParticipantServices);
    const response = createResponse();

    await participant.handler({
      text: 'What documents do I have in my workspace?',
      requestId: 'req-docs',
      mode: ChatMode.Ask,
      modelId: 'test-model',
      attempt: 0,
    } as IChatParticipantRequest, {
      sessionId: 'session-docs',
      history: [],
    } as IChatParticipantContext, response, createToken());

    expect(sendChatRequest).not.toHaveBeenCalled();
    expect(response.markdown).toHaveBeenCalledWith([
      'Your workspace contains 2 documents:',
      '',
      '- Agent Contacts.md',
      '- Claims Guide.md',
    ].join('\n'));
  });

  it('builds workspace prompts with OpenClaw bootstrap markers', async () => {
    const sendChatRequest = vi.fn(() => streamChunks([{ content: 'workspace answer', done: true }]));
    const reportBootstrapDebug = vi.fn();
    const participant = createOpenclawWorkspaceParticipant({
      sendChatRequest,
      getActiveModel: () => 'test-model',
      getWorkspaceName: () => 'Demo Workspace',
      listPages: vi.fn(async () => [{ id: 'page-1', title: 'Claims Guide', icon: '📄' }]),
      searchPages: vi.fn(async () => [{ id: 'page-1', title: 'Claims Guide', icon: '📄' }]),
      getPageContent: vi.fn(async () => 'Plain content'),
      getPageTitle: vi.fn(async () => 'Claims Guide'),
      readFileContent: vi.fn(async (relativePath: string) => (relativePath === 'AGENTS.md' ? 'agent rules' : null as any)),
      getReadOnlyToolDefinitions: () => [],
      reportBootstrapDebug,
      reportRuntimeTrace: vi.fn(),
    } as IWorkspaceParticipantServices);
    const response = createResponse();

    await participant.handler({
      text: 'claims',
      command: 'search',
      requestId: 'req-1',
      mode: ChatMode.Ask,
      modelId: 'test-model',
      attempt: 0,
    } as IChatParticipantRequest, {
      sessionId: 'session-1',
      history: [],
    } as IChatParticipantContext, response, createToken());

    const messages = sendChatRequest.mock.calls[0][0];
    const bootstrapDebug = reportBootstrapDebug.mock.calls[0][0];
    expect(messages[0].content).toContain('OpenClaw workspace lane');
    expect(messages[0].content).toContain('[AGENTS.md]');
    expect(messages[0].content).toContain('[MISSING] Expected at: SOUL.md');
    expect(bootstrapDebug.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'AGENTS.md', rawChars: expect.any(Number) }),
      expect.objectContaining({ name: 'SOUL.md', missing: true, rawChars: 0, injectedChars: expect.any(Number) }),
    ]));
    expect(response.markdown).toHaveBeenCalledWith('workspace answer');
  });

  it('runs canvas describe through the OpenClaw canvas lane', async () => {
    const sendChatRequest = vi.fn(() => streamChunks([{ content: 'canvas answer', done: true }]));
    const participant = createOpenclawCanvasParticipant({
      sendChatRequest,
      getActiveModel: () => 'test-model',
      getWorkspaceName: () => 'Demo Workspace',
      getCurrentPageId: () => 'page-1',
      getCurrentPageTitle: () => 'Claims Workflow',
      getPageStructure: vi.fn(async () => ({
        pageId: 'page-1',
        title: 'Claims Workflow',
        blocks: [{ id: 'block-1', blockType: 'paragraph', parentBlockId: null, sortOrder: 0, textPreview: 'Start here' }],
      })),
      readFileContent: vi.fn(async () => null),
      getReadOnlyToolDefinitions: () => [],
      reportRuntimeTrace: vi.fn(),
    } as ICanvasParticipantServices);
    const response = createResponse();

    await participant.handler({
      text: '',
      command: 'describe',
      requestId: 'req-2',
      mode: ChatMode.Ask,
      modelId: 'test-model',
      attempt: 0,
    } as IChatParticipantRequest, {
      sessionId: 'session-2',
      history: [],
    } as IChatParticipantContext, response, createToken());

    const messages = sendChatRequest.mock.calls[0][0];
    expect(messages[0].content).toContain('OpenClaw canvas lane');
    expect(messages[0].content).toContain('Claims Workflow');
    expect(response.markdown).toHaveBeenCalledWith('canvas answer');
  });

  it('reports no retrieval attempted for canvas no-page guardrails', async () => {
    const reportRetrievalDebug = vi.fn();
    const participant = createOpenclawCanvasParticipant({
      sendChatRequest: vi.fn(() => streamChunks([{ content: 'should not run', done: true }])),
      getActiveModel: () => 'test-model',
      getWorkspaceName: () => 'Demo Workspace',
      getCurrentPageId: () => undefined,
      getCurrentPageTitle: () => undefined,
      getPageStructure: vi.fn(async () => null),
      readFileContent: vi.fn(async () => null),
      getReadOnlyToolDefinitions: () => [],
      reportRuntimeTrace: vi.fn(),
      reportRetrievalDebug,
    } as ICanvasParticipantServices);
    const response = createResponse();

    await participant.handler({
      text: '',
      command: 'describe',
      requestId: 'req-no-page',
      mode: ChatMode.Ask,
      modelId: 'test-model',
      attempt: 0,
    } as IChatParticipantRequest, {
      sessionId: 'session-no-page',
      history: [],
    } as IChatParticipantContext, response, createToken());

    expect(reportRetrievalDebug).toHaveBeenCalledWith({
      hasActiveSlashCommand: true,
      isRagReady: false,
      needsRetrieval: false,
      attempted: false,
    });
    expect(response.markdown).toHaveBeenCalledWith('No page is currently open. Open a canvas page to use `@canvas /describe`.');
  });
});