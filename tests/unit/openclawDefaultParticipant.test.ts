import { describe, expect, it, vi } from 'vitest';

import { ChatMode } from '../../src/services/chatTypes';
import type {
  IChatParticipantContext,
  IChatParticipantRequest,
  IChatResponseChunk,
  IChatResponseStream,
  ICancellationToken,
} from '../../src/services/chatTypes';
import { createOpenclawDefaultParticipant } from '../../src/openclaw/participants/openclawDefaultParticipant';
import type { IDefaultParticipantServices } from '../../src/openclaw/openclawTypes';

function createResponse(): IChatResponseStream {
  const markdownParts: string[] = [];
  return {
    markdown: vi.fn((value: string) => {
      markdownParts.push(value);
    }),
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
    getMarkdownText: vi.fn(() => markdownParts.join('')),
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

describe('openclaw default participant', () => {
  it('builds a fresh-session bootstrap prompt from workspace files', async () => {
    const sendChatRequest = vi.fn(() => streamChunks([
      { content: 'OpenClaw answer', done: true, promptEvalCount: 10, evalCount: 12 },
    ]));
    const reportBootstrapDebug = vi.fn();
    const reportSystemPromptReport = vi.fn();
    const services: IDefaultParticipantServices = {
      sendChatRequest,
      getActiveModel: () => 'test-model',
      getWorkspaceName: () => 'Demo Workspace',
      getPageCount: vi.fn(async () => 0),
      getCurrentPageTitle: () => undefined,
      getToolDefinitions: () => [],
      getReadOnlyToolDefinitions: () => [],
      readFileRelative: vi.fn(async (path: string) => {
        if (path === 'AGENTS.md') {
          return 'workspace instructions';
        }
        if (path === 'SOUL.md') {
          return 'persona';
        }
        if (path === 'memory/2026-03-24.md') {
          return 'should not be injected';
        }
        return null;
      }),
      unifiedConfigService: {
        getEffectiveConfig: () => ({
          chat: { workspaceDescription: 'Insurance workspace' },
          model: { temperature: 0.2, maxTokens: 512 },
        } as any),
      } as any,
      reportBootstrapDebug,
        reportSystemPromptReport,
      reportRuntimeTrace: vi.fn(),
    } as IDefaultParticipantServices;

    const participant = createOpenclawDefaultParticipant(services);
    const response = createResponse();

    await participant.handler({
      text: 'What does my policy cover?',
      requestId: 'req-1',
      mode: ChatMode.Ask,
      modelId: 'test-model',
      attempt: 0,
    } as IChatParticipantRequest, {
      sessionId: 'session-1',
      history: [],
    } as IChatParticipantContext, response, createToken());

    const sentMessages = sendChatRequest.mock.calls[0][0];
    expect(sentMessages[0].role).toBe('system');
    expect(sentMessages[0].content).toContain('OpenClaw runtime lane');
    expect(sentMessages[0].content).toContain('Modes gate authority, not wakefulness. Ask mode is read-first');
    expect(sentMessages[0].content).toContain('## Retrieved Context Contract');
    expect(sentMessages[0].content).toContain('preserve the source formatting exactly');
    expect(sentMessages[0].content).toContain('# Project Context');
    expect(sentMessages[0].content).toContain('[AGENTS.md]');
    expect(sentMessages[0].content).toContain('workspace instructions');
    expect(sentMessages[0].content).toContain('Insurance workspace');
    expect(sentMessages[0].content).toContain('[TOOLS.md]');
    expect(sentMessages[0].content).toContain('[MISSING] Expected at: TOOLS.md');
    expect(sentMessages[0].content).not.toContain('should not be injected');
    expect(reportBootstrapDebug).toHaveBeenCalledWith(expect.objectContaining({
      totalRawChars: expect.any(Number),
      totalInjectedChars: expect.any(Number),
      files: expect.arrayContaining([
        expect.objectContaining({ name: 'AGENTS.md', rawChars: expect.any(Number) }),
      ]),
    }));
    expect(reportSystemPromptReport).toHaveBeenCalledWith(expect.objectContaining({
      source: 'run',
      systemPrompt: expect.objectContaining({ chars: expect.any(Number), projectContextChars: expect.any(Number) }),
    }));
    expect(response.markdown).toHaveBeenCalledWith('OpenClaw answer');
  });

  it('answers /context without sending a model request', async () => {
    const sendChatRequest = vi.fn(() => streamChunks([{ content: 'should not run', done: true }]));
    const reportSystemPromptReport = vi.fn();
    const services: IDefaultParticipantServices = {
      sendChatRequest,
      getActiveModel: () => 'test-model',
      getWorkspaceName: () => 'Demo Workspace',
      getPageCount: vi.fn(async () => 0),
      getCurrentPageTitle: () => undefined,
      getToolDefinitions: () => [{ name: 'read_file', description: 'Read file', parameters: { type: 'object', properties: { path: { type: 'string' } } } }],
      getReadOnlyToolDefinitions: () => [{ name: 'read_file', description: 'Read file', parameters: { type: 'object', properties: { path: { type: 'string' } } } }],
      readFileRelative: vi.fn(async (path: string) => (path === 'AGENTS.md' ? 'workspace instructions' : null)),
      unifiedConfigService: {
        getEffectiveConfig: () => ({
          chat: { workspaceDescription: 'Insurance workspace' },
          model: { temperature: 0.2, maxTokens: 512 },
        } as any),
      } as any,
      getModelContextLength: () => 32000,
      reportSystemPromptReport,
      reportRuntimeTrace: vi.fn(),
    } as IDefaultParticipantServices;

    const participant = createOpenclawDefaultParticipant(services);
    const response = createResponse();

    await participant.handler({
      text: 'list',
      command: 'context',
      requestId: 'req-context',
      mode: ChatMode.Ask,
      modelId: 'test-model',
      attempt: 0,
    } as IChatParticipantRequest, {
      sessionId: 'session-context',
      history: [],
    } as IChatParticipantContext, response, createToken());

    expect(sendChatRequest).not.toHaveBeenCalled();
    expect(reportSystemPromptReport).toHaveBeenCalledWith(expect.objectContaining({ source: 'estimate' }));
    expect(response.markdown).toHaveBeenCalledWith(expect.stringContaining('Context breakdown'));
    expect(response.markdown).toHaveBeenCalledWith(expect.stringContaining('Bootstrap max/file'));
  });

  it('executes runtime-controlled tool calls inside the separate OpenClaw lane', async () => {
    const sendChatRequest = vi.fn()
      .mockReturnValueOnce(streamChunks([
        {
          content: '',
          done: true,
          toolCalls: [{ function: { name: 'read_file', arguments: { path: 'Policy.md' } } }],
        },
      ]))
      .mockReturnValueOnce(streamChunks([
        { content: 'Grounded OpenClaw answer', done: true },
      ]));
    const invokeToolWithRuntimeControl = vi.fn(async () => ({ content: 'Policy content' }));
    const services: IDefaultParticipantServices = {
      sendChatRequest,
      getActiveModel: () => 'test-model',
      getWorkspaceName: () => 'Demo Workspace',
      getPageCount: vi.fn(async () => 0),
      getCurrentPageTitle: () => undefined,
      getToolDefinitions: () => [{ name: 'read_file', description: 'Read file', parameters: {} }],
      getReadOnlyToolDefinitions: () => [{ name: 'read_file', description: 'Read file', parameters: {} }],
      invokeToolWithRuntimeControl,
      readFileRelative: vi.fn(async () => null),
      unifiedConfigService: {
        getEffectiveConfig: () => ({ model: { temperature: 0.2, maxTokens: 512 }, chat: { workspaceDescription: '' } } as any),
      } as any,
      reportRuntimeTrace: vi.fn(),
    } as IDefaultParticipantServices;

    const participant = createOpenclawDefaultParticipant(services);
    const response = createResponse();

    await participant.handler({
      text: 'Read Policy.md and summarize it.',
      requestId: 'req-2',
      mode: ChatMode.Agent,
      modelId: 'test-model',
      attempt: 0,
    } as IChatParticipantRequest, {
      sessionId: 'session-2',
      history: [],
    } as IChatParticipantContext, response, createToken());

    const firstMessages = sendChatRequest.mock.calls[0][0];
    expect(firstMessages[0].content).toContain('Modes gate authority, not wakefulness. Agent mode unlocks action tools');
    expect(invokeToolWithRuntimeControl).toHaveBeenCalledWith('read_file', { path: 'Policy.md' }, expect.objectContaining({ isCancellationRequested: false }), undefined);
    expect(response.markdown).toHaveBeenCalledWith('Grounded OpenClaw answer');
  });

  it('does not inject current canvas page context into default grounded turns', async () => {
    const sendChatRequest = vi.fn(() => streamChunks([
      { content: 'Vehicle answer', done: true },
    ]));
    const getCurrentPageContent = vi.fn(async () => ({
      title: 'Testing',
      pageId: 'page-1',
      textContent: 'This page should stay out of the default OpenClaw lane.',
    }));
    const reportRuntimeTrace = vi.fn();
    const services: IDefaultParticipantServices = {
      sendChatRequest,
      getActiveModel: () => 'test-model',
      getWorkspaceName: () => 'Demo Workspace',
      getPageCount: vi.fn(async () => 1),
      getCurrentPageTitle: () => 'Testing',
      getCurrentPageContent,
      getToolDefinitions: () => [],
      getReadOnlyToolDefinitions: () => [],
      retrieveContext: vi.fn(async () => ({
        text: '[Retrieved Context]\nVehicle Info.md says the insured vehicle is a 2024 Honda Accord EX-L.',
        sources: [{ uri: 'Vehicle Info.md', label: 'Vehicle Info.md', index: 1 }],
      })),
      readFileRelative: vi.fn(async () => null),
      unifiedConfigService: {
        getEffectiveConfig: () => ({
          chat: { workspaceDescription: 'Insurance workspace' },
          model: { temperature: 0.2, maxTokens: 512 },
        } as any),
      } as any,
      reportRuntimeTrace,
    } as IDefaultParticipantServices;

    const participant = createOpenclawDefaultParticipant(services);
    const response = createResponse();

    await participant.handler({
      text: 'Tell me about my insured vehicle.',
      requestId: 'req-vehicle',
      mode: ChatMode.Ask,
      modelId: 'test-model',
      attempt: 0,
    } as IChatParticipantRequest, {
      sessionId: 'session-vehicle',
      history: [],
    } as IChatParticipantContext, response, createToken());

    expect(getCurrentPageContent).not.toHaveBeenCalled();
    const sentMessages = sendChatRequest.mock.calls[0][0];
    expect(sentMessages.at(-1)?.content).not.toContain('This page should stay out of the default OpenClaw lane.');
    expect(sentMessages.at(-1)?.content).not.toContain('Testing');
    expect(reportRuntimeTrace).toHaveBeenLastCalledWith(expect.objectContaining({
      contextPlan: expect.objectContaining({ useCurrentPage: false }),
    }));
  });

  it('seeds prior conversation turns into the default OpenClaw model prompt', async () => {
    const sendChatRequest = vi.fn(() => streamChunks([
      { content: 'Follow-up answer', done: true },
    ]));
    const reportSystemPromptReport = vi.fn();
    const services: IDefaultParticipantServices = {
      sendChatRequest,
      getActiveModel: () => 'test-model',
      getWorkspaceName: () => 'Demo Workspace',
      getPageCount: vi.fn(async () => 0),
      getCurrentPageTitle: () => undefined,
      getToolDefinitions: () => [],
      getReadOnlyToolDefinitions: () => [],
      retrieveContext: vi.fn(async () => ({
        text: '[Retrieved Context]\nAgent Contacts.md lists Sarah Chen and the claims hotline.',
        sources: [{ uri: 'Agent Contacts.md', label: 'Agent Contacts.md', index: 1 }],
      })),
      readFileRelative: vi.fn(async () => null),
      unifiedConfigService: {
        getEffectiveConfig: () => ({
          chat: { workspaceDescription: 'Insurance workspace' },
          model: { temperature: 0.2, maxTokens: 512 },
        } as any),
      } as any,
      reportSystemPromptReport,
      reportRuntimeTrace: vi.fn(),
    } as IDefaultParticipantServices;

    const participant = createOpenclawDefaultParticipant(services);
    const response = createResponse();

    await participant.handler({
      text: 'Who should I call to file the claim?',
      requestId: 'req-history-followup',
      mode: ChatMode.Ask,
      modelId: 'test-model',
      attempt: 0,
    } as IChatParticipantRequest, {
      sessionId: 'session-history-followup',
      history: [{
        request: { text: 'Someone just backed into my car in a parking lot. What should I do?' },
        response: { parts: [{ kind: 'markdown', content: 'Take photos, stay safe, and exchange insurance information.' }] },
      }] as any,
    } as IChatParticipantContext, response, createToken());

    const sentMessages = sendChatRequest.mock.calls[0][0];
    expect(sentMessages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'user', content: 'Someone just backed into my car in a parking lot. What should I do?' }),
      expect.objectContaining({ role: 'assistant', content: 'Take photos, stay safe, and exchange insurance information.' }),
    ]));
    expect(sentMessages.at(-1)).toEqual(expect.objectContaining({
      role: 'user',
      content: expect.stringContaining('[User Request]'),
    }));
    expect(sentMessages.at(-1)?.content).toContain('Who should I call to file the claim?');
    expect(sentMessages.at(-1)?.content).toContain('[Retrieved Context]');
    expect(reportSystemPromptReport).toHaveBeenCalledWith(expect.objectContaining({
      promptProvenance: expect.objectContaining({
        rawUserInput: 'Who should I call to file the claim?',
        parsedUserText: 'Who should I call to file the claim?',
        historyTurns: 1,
        modelMessageCount: sentMessages.length,
        modelMessageRoles: sentMessages.map((message: { role: string }) => message.role),
        finalUserMessage: expect.stringContaining('Who should I call to file the claim?'),
      }),
    }));
    expect(response.markdown).toHaveBeenCalledWith(expect.stringContaining('Follow-up answer'));
  });

  it('reports no retrieval attempted for conversational OpenClaw default turns', async () => {
    const sendChatRequest = vi.fn(() => streamChunks([
      { content: 'Hey! How can I help?', done: true },
    ]));
    const reportRetrievalDebug = vi.fn();
    const services: IDefaultParticipantServices = {
      sendChatRequest,
      getActiveModel: () => 'test-model',
      getWorkspaceName: () => 'Demo Workspace',
      getPageCount: vi.fn(async () => 0),
      getCurrentPageTitle: () => undefined,
      getToolDefinitions: () => [],
      getReadOnlyToolDefinitions: () => [],
      readFileRelative: vi.fn(async () => null),
      unifiedConfigService: {
        getEffectiveConfig: () => ({
          chat: { workspaceDescription: 'Insurance workspace' },
          model: { temperature: 0.2, maxTokens: 512 },
        } as any),
      } as any,
      reportRuntimeTrace: vi.fn(),
      reportRetrievalDebug,
    } as IDefaultParticipantServices;

    const participant = createOpenclawDefaultParticipant(services);
    const response = createResponse();

    await participant.handler({
      text: 'Hi hows it going?',
      requestId: 'req-hello',
      mode: ChatMode.Ask,
      modelId: 'test-model',
      attempt: 0,
    } as IChatParticipantRequest, {
      sessionId: 'session-hello',
      history: [],
    } as IChatParticipantContext, response, createToken());

    expect(reportRetrievalDebug).toHaveBeenCalledWith(expect.objectContaining({
      needsRetrieval: false,
      attempted: false,
    }));
  });

  it('acknowledges when a retrieved source is only a brief overview', async () => {
    const sendChatRequest = vi.fn(() => streamChunks([
      {
        content: 'Umbrella coverage adds an extra layer of liability protection once the underlying limits are exhausted. [1]',
        done: true,
      },
    ]));
    const services: IDefaultParticipantServices = {
      sendChatRequest,
      getActiveModel: () => 'test-model',
      getWorkspaceName: () => 'Stress Workspace',
      isRAGAvailable: () => true,
      getPageCount: vi.fn(async () => 0),
      getCurrentPageTitle: () => undefined,
      getToolDefinitions: () => [],
      getReadOnlyToolDefinitions: () => [],
      retrieveContext: vi.fn(async () => ({
        text: [
          '[Retrieved Context]',
          '[1] Source: overview.md',
          'Path: policies/umbrella/overview.md',
          'Umbrella coverage adds an extra layer of liability protection that kicks in after underlying limits are exhausted.',
          'For more details, contact your agent.',
        ].join('\n'),
        sources: [
          { uri: 'policies/umbrella/overview.md', label: 'overview.md', index: 1 },
        ],
      })),
      readFileRelative: vi.fn(async () => null),
      unifiedConfigService: {
        getEffectiveConfig: () => ({
          chat: { workspaceDescription: 'Stress workspace' },
          model: { temperature: 0.2, maxTokens: 512 },
        } as any),
      } as any,
      reportRuntimeTrace: vi.fn(),
    } as IDefaultParticipantServices;

    const participant = createOpenclawDefaultParticipant(services);
    const response = createResponse();

    await participant.handler({
      text: 'Summarize umbrella/overview.md.',
      requestId: 'req-umbrella-overview',
      mode: ChatMode.Ask,
      modelId: 'test-model',
      attempt: 0,
    } as IChatParticipantRequest, {
      sessionId: 'session-umbrella-overview',
      history: [],
    } as IChatParticipantContext, response, createToken());

    expect(response.getMarkdownText()).toMatch(/brief|minimal|limited|only/i);
  });

  it('preserves semantic fallback trace reasoning for broad workspace summary prompts', async () => {
    const sendChatRequest = vi.fn(() => streamChunks([
      { content: 'Workspace overview answer', done: true },
    ]));
    const reportRuntimeTrace = vi.fn();
    const services: IDefaultParticipantServices = {
      sendChatRequest,
      getActiveModel: () => 'test-model',
      getWorkspaceName: () => 'Stress Workspace',
      isRAGAvailable: () => true,
      getPageCount: vi.fn(async () => 0),
      getCurrentPageTitle: () => undefined,
      getToolDefinitions: () => [],
      getReadOnlyToolDefinitions: () => [],
      retrieveContext: vi.fn(async () => ({
        text: [
          '[Retrieved Context]',
          '[1] Source: file-a.md',
          'Path: notes/file-a.md',
          'A short file.',
          '[2] Source: file-b.md',
          'Path: notes/file-b.md',
          'Another short file.',
          '[3] Source: file-c.md',
          'Path: notes/file-c.md',
          'Third file.',
        ].join('\n'),
        sources: [
          { uri: 'notes/file-a.md', label: 'file-a.md', index: 1 },
          { uri: 'notes/file-b.md', label: 'file-b.md', index: 2 },
          { uri: 'notes/file-c.md', label: 'file-c.md', index: 3 },
        ],
      })),
      readFileRelative: vi.fn(async () => null),
      unifiedConfigService: {
        getEffectiveConfig: () => ({
          chat: { workspaceDescription: 'Stress workspace' },
          model: { temperature: 0.2, maxTokens: 512 },
        } as any),
      } as any,
      reportRuntimeTrace,
    } as IDefaultParticipantServices;

    const participant = createOpenclawDefaultParticipant(services);
    const response = createResponse();

    await participant.handler({
      text: 'Tell me about everything in here.',
      requestId: 'req-broad-summary',
      mode: ChatMode.Ask,
      modelId: 'test-model',
      attempt: 0,
      turnState: {
        userText: 'Tell me about everything in here.',
        contextQueryText: 'Tell me about everything in here.',
        hasActiveSlashCommand: false,
        isRagReady: true,
        isConversationalTurn: false,
        turnRoute: {
          kind: 'grounded',
          reason: 'Default grounded route uses normal workspace-aware context planning.',
          coverageMode: 'exhaustive',
        },
        queryScope: {
          level: 'workspace',
          derivedFrom: 'contextual',
          confidence: 0.8,
        },
      } as any,
    } as IChatParticipantRequest, {
      sessionId: 'session-broad-summary',
      history: [],
    } as IChatParticipantContext, response, createToken());

    expect(reportRuntimeTrace).toHaveBeenCalledWith(expect.objectContaining({
      semanticFallback: expect.objectContaining({
        kind: 'broad-workspace-summary',
        reason: expect.stringContaining('Broad workspace-wide phrasing implies exhaustive multi-file coverage'),
      }),
      routeAuthority: expect.objectContaining({ action: 'corrected' }),
      route: expect.objectContaining({
        coverageMode: 'representative',
        reason: expect.stringContaining('Evidence authority correction'),
      }),
    }));
  });

  it('answers approval-scope questions deterministically without a model turn', async () => {
    const sendChatRequest = vi.fn(() => streamChunks([
      { content: 'should not run', done: true },
    ]));
    const reportRuntimeTrace = vi.fn();
    const services: IDefaultParticipantServices = {
      sendChatRequest,
      getActiveModel: () => 'test-model',
      getWorkspaceName: () => 'Demo Workspace',
      getPageCount: vi.fn(async () => 0),
      getCurrentPageTitle: () => undefined,
      getToolDefinitions: () => [],
      getReadOnlyToolDefinitions: () => [],
      readFileRelative: vi.fn(async () => null),
      unifiedConfigService: {
        getEffectiveConfig: () => ({
          chat: { workspaceDescription: 'Insurance workspace' },
          model: { temperature: 0.2, maxTokens: 512 },
        } as any),
      } as any,
      reportRuntimeTrace,
      reportRetrievalDebug: vi.fn(),
    } as IDefaultParticipantServices;

    const participant = createOpenclawDefaultParticipant(services);
    const response = createResponse();

    await participant.handler({
      text: 'What is the difference between Approve once and Approve task?',
      requestId: 'req-approval-scope',
      mode: ChatMode.Ask,
      modelId: 'test-model',
      attempt: 0,
    } as IChatParticipantRequest, {
      sessionId: 'session-approval-scope',
      history: [],
    } as IChatParticipantContext, response, createToken());

    expect(sendChatRequest).not.toHaveBeenCalled();
    expect(response.getMarkdownText()).toContain('Approve once allows only the current action to run.');
    expect(response.getMarkdownText()).toContain('remaining approval-scoped actions');
    expect(reportRuntimeTrace).toHaveBeenCalledWith(expect.objectContaining({
      route: expect.objectContaining({ kind: 'product-semantics' }),
    }));
  });

  it('answers task-trace questions deterministically without a model turn', async () => {
    const sendChatRequest = vi.fn(() => streamChunks([
      { content: 'should not run', done: true },
    ]));
    const services: IDefaultParticipantServices = {
      sendChatRequest,
      getActiveModel: () => 'test-model',
      getWorkspaceName: () => 'Demo Workspace',
      getPageCount: vi.fn(async () => 0),
      getCurrentPageTitle: () => undefined,
      getToolDefinitions: () => [],
      getReadOnlyToolDefinitions: () => [],
      readFileRelative: vi.fn(async () => null),
      unifiedConfigService: {
        getEffectiveConfig: () => ({
          chat: { workspaceDescription: 'Insurance workspace' },
          model: { temperature: 0.2, maxTokens: 512 },
        } as any),
      } as any,
      reportRuntimeTrace: vi.fn(),
      reportRetrievalDebug: vi.fn(),
    } as IDefaultParticipantServices;

    const participant = createOpenclawDefaultParticipant(services);
    const response = createResponse();

    await participant.handler({
      text: 'What does the trace in task details help me understand?',
      requestId: 'req-task-trace',
      mode: ChatMode.Ask,
      modelId: 'test-model',
      attempt: 0,
    } as IChatParticipantRequest, {
      sessionId: 'session-task-trace',
      history: [],
    } as IChatParticipantContext, response, createToken());

    expect(sendChatRequest).not.toHaveBeenCalled();
    expect(response.getMarkdownText()).toContain('planning, approval, and execution events');
    expect(response.getMarkdownText()).toContain('why a task stopped');
  });

  it('corrects empty exhaustive coverage back to representative retrieval and reports route authority', async () => {
    const sendChatRequest = vi.fn(() => streamChunks([
      { content: 'Representative retrieval fallback answer.', done: true },
    ]));
    const reportRuntimeTrace = vi.fn();
    const services: IDefaultParticipantServices = {
      sendChatRequest,
      getActiveModel: () => 'test-model',
      getWorkspaceName: () => 'Demo Workspace',
      isRAGAvailable: () => true,
      getPageCount: vi.fn(async () => 0),
      getCurrentPageTitle: () => undefined,
      getToolDefinitions: () => [],
      getReadOnlyToolDefinitions: () => [],
      listFilesRelative: vi.fn(async () => [
        { name: 'policy-scan.pdf', type: 'file' as const },
      ]),
      readFileRelative: vi.fn(async () => null),
      retrieveContext: vi.fn(async () => ({
        text: [
          '[Retrieved Context]',
          '[1] Source: Broken Docs fallback',
          'Path: Broken Docs/policy-scan.pdf',
          'Representative retrieval fallback content.',
        ].join('\n'),
        sources: [{ uri: 'Broken Docs/policy-scan.pdf', label: 'Broken Docs fallback', index: 1 }],
      })),
      unifiedConfigService: {
        getEffectiveConfig: () => ({
          chat: { workspaceDescription: 'Insurance workspace' },
          model: { temperature: 0.2, maxTokens: 512 },
        } as any),
      } as any,
      reportRuntimeTrace,
      reportRetrievalDebug: vi.fn(),
    } as IDefaultParticipantServices;

    const participant = createOpenclawDefaultParticipant(services);
    const response = createResponse();

    await participant.handler({
      text: 'Please summarize each file in the Broken Docs folder.',
      requestId: 'req-route-authority',
      mode: ChatMode.Ask,
      modelId: 'test-model',
      attempt: 0,
    } as IChatParticipantRequest, {
      sessionId: 'session-route-authority',
      history: [],
    } as IChatParticipantContext, response, createToken());

    expect(reportRuntimeTrace).toHaveBeenCalledWith(expect.objectContaining({
      routeAuthority: expect.objectContaining({ action: 'corrected' }),
      route: expect.objectContaining({
        coverageMode: 'representative',
        reason: expect.stringContaining('Evidence authority correction'),
      }),
    }));
  });

  it('returns grounded workspace-wide file summaries for explicit exhaustive prompts', async () => {
    const sendChatRequest = vi.fn(() => streamChunks([
      { content: '', done: true },
    ]));
    const services: IDefaultParticipantServices = {
      sendChatRequest,
      getActiveModel: () => 'test-model',
      getWorkspaceName: () => 'Stress Workspace',
      isRAGAvailable: () => true,
      getPageCount: vi.fn(async () => 0),
      getCurrentPageTitle: () => undefined,
      getToolDefinitions: () => [],
      getReadOnlyToolDefinitions: () => [],
      listFilesRelative: vi.fn(async (relativePath: string) => {
        if (relativePath === '') {
          return [
            { name: 'Claims Guide.md', type: 'file' as const },
            { name: 'Vehicle Info.md', type: 'file' as const },
          ];
        }
        return [];
      }),
      readFileRelative: vi.fn(async (path: string) => {
        if (path === 'Claims Guide.md') {
          return '# Claims Guide\nCall your insurer and gather incident details.';
        }
        if (path === 'Vehicle Info.md') {
          return '# Vehicle Info\nThe insured vehicle is a 2024 Honda Accord EX-L.';
        }
        return null;
      }),
      unifiedConfigService: {
        getEffectiveConfig: () => ({
          chat: { workspaceDescription: 'Stress workspace' },
          model: { temperature: 0.2, maxTokens: 512 },
        } as any),
      } as any,
      reportRuntimeTrace: vi.fn(),
    } as IDefaultParticipantServices;

    const participant = createOpenclawDefaultParticipant(services);
    const response = createResponse();

    await participant.handler({
      text: 'Summarize each file in this workspace.',
      requestId: 'req-workspace-each-file',
      mode: ChatMode.Ask,
      modelId: 'test-model',
      attempt: 0,
      turnState: {
        userText: 'Summarize each file in this workspace.',
        contextQueryText: 'Summarize each file in this workspace.',
        hasActiveSlashCommand: false,
        isRagReady: true,
        isConversationalTurn: false,
        turnRoute: {
          kind: 'grounded',
          reason: 'Explicit exhaustive summary request.',
          workflowType: 'folder-summary',
          coverageMode: 'exhaustive',
        },
        queryScope: {
          level: 'workspace',
          derivedFrom: 'contextual',
          confidence: 1,
          pathPrefixes: [],
        },
      } as any,
    } as IChatParticipantRequest, {
      sessionId: 'session-workspace-each-file',
      history: [],
    } as IChatParticipantContext, response, createToken());

    expect(response.getMarkdownText()).toContain('Claims Guide.md');
    expect(response.getMarkdownText()).toContain('Vehicle Info.md');
  });

  it('returns grounded folder summaries for natural-language exhaustive prompts', async () => {
    const sendChatRequest = vi.fn(() => streamChunks([
      { content: '', done: true },
    ]));
    const services: IDefaultParticipantServices = {
      sendChatRequest,
      getActiveModel: () => 'test-model',
      getWorkspaceName: () => 'Stress Workspace',
      isRAGAvailable: () => true,
      getPageCount: vi.fn(async () => 0),
      getCurrentPageTitle: () => undefined,
      getToolDefinitions: () => [],
      getReadOnlyToolDefinitions: () => [],
      listFilesRelative: vi.fn(async (relativePath: string) => {
        if (relativePath === '') {
          return [
            { name: 'policies', type: 'directory' as const },
            { name: 'claims', type: 'directory' as const },
          ];
        }
        if (relativePath === 'policies' || relativePath === 'policies/') {
          return [
            { name: 'auto-policy-2024.md', type: 'file' as const },
            { name: 'auto-policy-2023.md', type: 'file' as const },
          ];
        }
        if (relativePath === 'claims' || relativePath === 'claims/') {
          return [
            { name: 'how-to-file.md', type: 'file' as const },
          ];
        }
        return [];
      }),
      readFileRelative: vi.fn(async (path: string) => {
        if (path === 'policies/auto-policy-2024.md') {
          return '# Auto Policy 2024\nCollision deductible is $500.';
        }
        if (path === 'policies/auto-policy-2023.md') {
          return '# Auto Policy 2023\nCollision deductible is $750.';
        }
        if (path === 'claims/how-to-file.md') {
          return '# Claims How To File\nOfficial five-step guide.';
        }
        return null;
      }),
      unifiedConfigService: {
        getEffectiveConfig: () => ({
          chat: { workspaceDescription: 'Stress workspace' },
          model: { temperature: 0.2, maxTokens: 512 },
        } as any),
      } as any,
      reportRuntimeTrace: vi.fn(),
    } as IDefaultParticipantServices;

    const participant = createOpenclawDefaultParticipant(services);
    const response = createResponse();

    await participant.handler({
      text: 'Summarize each file in the policies folder.',
      requestId: 'req-policies-folder-summary',
      mode: ChatMode.Ask,
      modelId: 'test-model',
      attempt: 0,
      turnState: {
        userText: 'Summarize each file in the policies folder.',
        contextQueryText: 'Summarize each file in the policies folder.',
        hasActiveSlashCommand: false,
        isRagReady: true,
        isConversationalTurn: false,
        turnRoute: {
          kind: 'grounded',
          reason: 'Explicit exhaustive summary request.',
          workflowType: 'folder-summary',
          coverageMode: 'exhaustive',
        },
        queryScope: {
          level: 'folder',
          derivedFrom: 'inferred',
          confidence: 1,
          pathPrefixes: ['policies/'],
        },
      } as any,
    } as IChatParticipantRequest, {
      sessionId: 'session-policies-folder-summary',
      history: [],
    } as IChatParticipantContext, response, createToken());

    expect(response.getMarkdownText()).toContain('policies/auto-policy-2024.md');
    expect(response.getMarkdownText()).toContain('policies/auto-policy-2023.md');
    expect(response.getMarkdownText()).not.toContain('claims/how-to-file.md');
  });

  it('does not collapse explicit unsupported-topic folder prompts into deterministic folder summaries', async () => {
    const sendChatRequest = vi.fn(() => streamChunks([
      { content: '', done: true },
    ]));
    const services: IDefaultParticipantServices = {
      sendChatRequest,
      getActiveModel: () => 'test-model',
      getWorkspaceName: () => 'Books Workspace',
      isRAGAvailable: () => true,
      getPageCount: vi.fn(async () => 0),
      getCurrentPageTitle: () => undefined,
      getToolDefinitions: () => [],
      getReadOnlyToolDefinitions: () => [],
      listFilesRelative: vi.fn(async (relativePath: string) => {
        if (relativePath === '' || relativePath === 'Stoicism' || relativePath === 'Stoicism/') {
          return [
            { name: 'The Daily Stoic 366 Meditations on Wisdom, Perseverance, and the Art of Living.pdf', type: 'file' as const },
          ];
        }
        return [];
      }),
      readFileRelative: vi.fn(async (path: string) => {
        if (path === 'Stoicism/The Daily Stoic 366 Meditations on Wisdom, Perseverance, and the Art of Living.pdf') {
          return 'Stoic meditations and reflections for daily practice.';
        }
        return null;
      }),
      unifiedConfigService: {
        getEffectiveConfig: () => ({
          chat: { workspaceDescription: 'Books workspace' },
          model: { temperature: 0.2, maxTokens: 512 },
        } as any),
      } as any,
      reportRuntimeTrace: vi.fn(),
    } as IDefaultParticipantServices;

    const participant = createOpenclawDefaultParticipant(services);
    const response = createResponse();

    await participant.handler({
      text: 'In the Stoicism folder, which book is about baking chocolate chip cookies? If none, say that none of the Stoicism books appear to be about that.',
      requestId: 'req-unsupported-stoicism-topic',
      mode: ChatMode.Ask,
      modelId: 'test-model',
      attempt: 0,
      turnState: {
        userText: 'In the Stoicism folder, which book is about baking chocolate chip cookies? If none, say that none of the Stoicism books appear to be about that.',
        contextQueryText: 'In the Stoicism folder, which book is about baking chocolate chip cookies? If none, say that none of the Stoicism books appear to be about that.',
        hasActiveSlashCommand: false,
        isRagReady: true,
        isConversationalTurn: false,
        turnRoute: {
          kind: 'grounded',
          reason: 'Explicit unsupported-topic prompt scoped to a folder.',
          workflowType: 'folder-summary',
          coverageMode: 'exhaustive',
        },
        queryScope: {
          level: 'folder',
          derivedFrom: 'inferred',
          confidence: 1,
          pathPrefixes: ['Stoicism/'],
        },
      } as any,
    } as IChatParticipantRequest, {
      sessionId: 'session-unsupported-stoicism-topic',
      history: [],
    } as IChatParticipantContext, response, createToken());

    expect(response.getMarkdownText()).toContain('None of the Stoicism books appear to be about that.');
    expect(response.getMarkdownText()).not.toContain('I reviewed 1 file in scope');
  });

  it('short-circuits unsupported specific coverage questions before the OpenClaw loop exhausts', async () => {
    const sendChatRequest = vi.fn(() => streamChunks([
      { content: '', done: true },
    ]));
    const services: IDefaultParticipantServices = {
      sendChatRequest,
      getActiveModel: () => 'test-model',
      getWorkspaceName: () => 'Demo Workspace',
      isRAGAvailable: () => true,
      getPageCount: vi.fn(async () => 0),
      getCurrentPageTitle: () => undefined,
      getToolDefinitions: () => [],
      getReadOnlyToolDefinitions: () => [],
      retrieveContext: vi.fn(async () => ({
        text: [
          '[Retrieved Context]',
          '[1] Source: Auto Insurance Policy.md',
          'Path: Auto Insurance Policy.md',
          '## Exclusions',
          'This policy does NOT cover ride-sharing without endorsement or wear and tear.',
        ].join('\n'),
        sources: [{ uri: 'Auto Insurance Policy.md', label: 'Auto Insurance Policy.md', index: 1 }],
      })),
      readFileRelative: vi.fn(async () => null),
      unifiedConfigService: {
        getEffectiveConfig: () => ({
          chat: { workspaceDescription: 'Insurance workspace' },
          model: { temperature: 0.2, maxTokens: 512 },
        } as any),
      } as any,
      reportRuntimeTrace: vi.fn(),
    } as IDefaultParticipantServices;

    const participant = createOpenclawDefaultParticipant(services);
    const response = createResponse();

    await participant.handler({
      text: 'What does my policy say about earthquake coverage?',
      requestId: 'req-unsupported-specific-coverage',
      mode: ChatMode.Ask,
      modelId: 'test-model',
      attempt: 0,
    } as IChatParticipantRequest, {
      sessionId: 'session-unsupported-specific-coverage',
      history: [],
    } as IChatParticipantContext, response, createToken());

    expect(response.getMarkdownText()).toContain('could not find earthquake');
    expect(response.getMarkdownText()).toContain('contact your agent');
  });

  it('short-circuits memory-recall turns with direct canonical memory output', async () => {
    const sendChatRequest = vi.fn(() => streamChunks([
      { content: '', done: true },
    ]));
    const services: IDefaultParticipantServices = {
      sendChatRequest,
      getActiveModel: () => 'test-model',
      getWorkspaceName: () => 'Demo Workspace',
      isRAGAvailable: () => true,
      getPageCount: vi.fn(async () => 0),
      getCurrentPageTitle: () => undefined,
      getToolDefinitions: () => [],
      getReadOnlyToolDefinitions: () => [],
      recallMemories: vi.fn(async () => [
        '[Conversation Memory]',
        '---',
        'Durable memory:',
        '- Technical answer preference: structured brevity.',
        '---',
        'Daily memory (2026-03-12):',
        '- Today\'s migration spike codename is ember-rail.',
      ].join('\n')),
      readFileRelative: vi.fn(async () => null),
      unifiedConfigService: {
        getEffectiveConfig: () => ({
          chat: { workspaceDescription: 'Insurance workspace' },
          model: { temperature: 0.2, maxTokens: 512 },
        } as any),
      } as any,
      reportRuntimeTrace: vi.fn(),
    } as IDefaultParticipantServices;

    const participant = createOpenclawDefaultParticipant(services);
    const response = createResponse();

    await participant.handler({
      text: 'Which note is a durable preference and which note is only for today?',
      requestId: 'req-memory-recall',
      mode: ChatMode.Ask,
      modelId: 'test-model',
      attempt: 0,
    } as IChatParticipantRequest, {
      sessionId: 'session-memory-recall',
      history: [],
    } as IChatParticipantContext, response, createToken());

    expect(response.getMarkdownText()).toContain('structured brevity');
    expect(response.getMarkdownText()).toContain('ember-rail');
    expect(sendChatRequest).not.toHaveBeenCalled();
  });

  it('repairs same-name how-to-file comparisons to mention the informal 3-step notes version', async () => {
    const sendChatRequest = vi.fn(() => streamChunks([
      {
        content: 'I found two files with the same name. The claims/how-to-file.md file is the official guide with 5 steps, while the notes version is more informal.',
        done: true,
      },
    ]));
    const services: IDefaultParticipantServices = {
      sendChatRequest,
      getActiveModel: () => 'test-model',
      getWorkspaceName: () => 'Stress Workspace',
      isRAGAvailable: () => true,
      getPageCount: vi.fn(async () => 0),
      getCurrentPageTitle: () => undefined,
      getToolDefinitions: () => [],
      getReadOnlyToolDefinitions: () => [],
      retrieveContext: vi.fn(async () => ({
        text: [
          '[Retrieved Context]',
          '[1] Source: how-to-file.md',
          'Path: claims/how-to-file.md',
          '# How to File an Insurance Claim',
          '## Step 1: Document the Incident',
          '## Step 2: File a Police Report',
          '## Step 3: Notify Your Insurance Agent',
          '## Step 4: Work with the Adjuster',
          '## Step 5: Submit Final Documentation',
          '[2] Source: how-to-file.md',
          'Path: notes/how-to-file.md',
          '# how to file a claim — my notes',
          '1. call the agent and tell them what happened',
          '2. they assign an adjuster',
          '3. get your car fixed',
        ].join('\n'),
        sources: [
          { uri: 'claims/how-to-file.md', label: 'how-to-file.md', index: 1 },
          { uri: 'notes/how-to-file.md', label: 'how-to-file.md', index: 2 },
        ],
      })),
      readFileRelative: vi.fn(async () => null),
      unifiedConfigService: {
        getEffectiveConfig: () => ({
          chat: { workspaceDescription: 'Stress workspace' },
          model: { temperature: 0.2, maxTokens: 512 },
        } as any),
      } as any,
      reportRuntimeTrace: vi.fn(),
    } as IDefaultParticipantServices;

    const participant = createOpenclawDefaultParticipant(services);
    const response = createResponse();

    await participant.handler({
      text: 'Compare the two how-to-file documents.',
      requestId: 'req-how-to-file-compare',
      mode: ChatMode.Ask,
      modelId: 'test-model',
      attempt: 0,
    } as IChatParticipantRequest, {
      sessionId: 'session-how-to-file-compare',
      history: [],
    } as IChatParticipantContext, response, createToken());

    expect(response.getMarkdownText()).toMatch(/notes\/how-to-file\.md.*3 steps/i);
  });

  it('queues shared session-memory write-back after a completed OpenClaw turn', async () => {
    const sendChatRequest = vi.fn(() => streamChunks([
      { content: 'I remember the accident details you shared.', done: true },
    ]));
    const storeSessionMemory = vi.fn(async () => {});
    const getSessionMemoryMessageCount = vi.fn(async () => null);
    const sendSummarizationRequest = vi.fn(() => streamChunks([
      { content: '{"summary":"User described a recent accident at Riverside Mall on Elm Street and already filed a police report."}', done: true },
    ]));
    const services: IDefaultParticipantServices = {
      sendChatRequest,
      getActiveModel: () => 'test-model',
      getWorkspaceName: () => 'Demo Workspace',
      getPageCount: vi.fn(async () => 0),
      getCurrentPageTitle: () => undefined,
      getToolDefinitions: () => [],
      getReadOnlyToolDefinitions: () => [],
      readFileRelative: vi.fn(async () => null),
      unifiedConfigService: {
        getEffectiveConfig: () => ({
          chat: { workspaceDescription: 'Insurance workspace' },
          model: { temperature: 0.2, maxTokens: 512 },
          memory: { memoryEnabled: true },
        } as any),
      } as any,
      reportRuntimeTrace: vi.fn(),
      storeSessionMemory,
      isSessionEligibleForSummary: vi.fn(() => true),
      getSessionMemoryMessageCount,
      sendSummarizationRequest,
    } as IDefaultParticipantServices;

    const participant = createOpenclawDefaultParticipant(services);
    const response = createResponse();

    await participant.handler({
      text: 'What details do you remember about my accident?',
      requestId: 'req-memory',
      mode: ChatMode.Ask,
      modelId: 'test-model',
      attempt: 0,
    } as IChatParticipantRequest, {
      sessionId: 'session-memory',
      history: [{
        request: { text: 'I was in a car accident yesterday at Riverside Mall on Elm Street.' },
        response: { parts: [{ kind: 'markdown', content: 'I can help you track those details.' }] },
      }] as any,
    } as IChatParticipantContext, response, createToken());

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(getSessionMemoryMessageCount).toHaveBeenCalledWith('session-memory');
    expect(storeSessionMemory).toHaveBeenCalledWith(
      'session-memory',
      expect.stringContaining('Riverside Mall on Elm Street'),
      2,
    );
  });

  it('applies shared grounded answer repairs to final OpenClaw answers', async () => {
    const sendChatRequest = vi.fn(() => streamChunks([
      {
        content: 'Your insurance agent’s phone number is (555) 234‑5678【1】.',
        done: true,
      },
    ]));
    const services: IDefaultParticipantServices = {
      sendChatRequest,
      getActiveModel: () => 'test-model',
      getWorkspaceName: () => 'Demo Workspace',
      getPageCount: vi.fn(async () => 0),
      getCurrentPageTitle: () => undefined,
      getToolDefinitions: () => [],
      getReadOnlyToolDefinitions: () => [],
      retrieveContext: vi.fn(async () => ({
        text: [
          '[Retrieved Context]',
          '---',
          '[1] Source: Agent Contacts.md',
          'Path: Agent Contacts.md',
          '| Field | Details |',
          '|-------|---------|',
          '| **Name** | Sarah Chen |',
          '| **Phone** | (555) 234-5678 |',
          '---',
        ].join('\n'),
        sources: [{ uri: 'Agent Contacts.md', label: 'Agent Contacts.md', index: 1 }],
      })),
      readFileRelative: vi.fn(async () => null),
      unifiedConfigService: {
        getEffectiveConfig: () => ({
          chat: { workspaceDescription: 'Insurance workspace' },
          model: { temperature: 0.2, maxTokens: 512 },
        } as any),
      } as any,
      reportRuntimeTrace: vi.fn(),
    } as IDefaultParticipantServices;

    const participant = createOpenclawDefaultParticipant(services);
    const response = createResponse();

    await participant.handler({
      text: 'What is my insurance agent\'s phone number?',
      requestId: 'req-agent',
      mode: ChatMode.Ask,
      modelId: 'test-model',
      attempt: 0,
    } as IChatParticipantRequest, {
      sessionId: 'session-agent',
      history: [],
    } as IChatParticipantContext, response, createToken());

    expect(response.getMarkdownText()).toContain('Sarah Chen');
    expect(response.getMarkdownText()).toContain('(555) 234-5678');
  });
});