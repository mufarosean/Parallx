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
    } as IDefaultParticipantServices;

    const participant = createOpenclawDefaultParticipant(services);
    const response = createResponse();

    await participant.handler({
      text: 'What does my policy cover?',
      requestId: 'req-1',
      mode: ChatMode.Agent,
      modelId: 'test-model',
      attempt: 0,
    } as IChatParticipantRequest, {
      sessionId: 'session-1',
      history: [],
    } as IChatParticipantContext, response, createToken());

    expect(sendChatRequest).toHaveBeenCalled();
    const sentMessages = sendChatRequest.mock.calls[0][0];
    expect(sentMessages[0].role).toBe('system');
    expect(sentMessages[0].content).toContain('You are Parallx, a local AI assistant');
    expect(sentMessages[0].content).toContain('## Workspace Context');
    expect(sentMessages[0].content).toContain('### AGENTS.md');
    expect(sentMessages[0].content).toContain('workspace instructions');
    expect(sentMessages[0].content).toContain('### SOUL.md');
    expect(sentMessages[0].content).toContain('persona');
    expect(sentMessages[0].content).toContain('## Response Guidelines');
    expect(sentMessages[0].content).not.toContain('should not be injected');
    expect(sentMessages.at(-1)).toEqual(expect.objectContaining({
      role: 'user',
      content: 'What does my policy cover?',
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
      mode: ChatMode.Agent,
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
    expect(response.markdown).toHaveBeenCalledWith(expect.stringContaining('Hidden skills:'));
  });

  it('uses canonical skill state for prompt visibility and reporting', async () => {
    const sendChatRequest = vi.fn(() => streamChunks([
      { content: 'Skilled answer', done: true, promptEvalCount: 8, evalCount: 12 },
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
      getSkillCatalog: () => [
        {
          name: 'claims-playbook',
          description: 'Claims workflow.',
          kind: 'workflow',
          tags: ['claims'],
          location: '.parallx/skills/claims-playbook/SKILL.md',
        },
        {
          name: 'internal-playbook',
          description: 'Hidden workflow.',
          kind: 'workflow',
          tags: ['internal'],
          location: '.parallx/skills/internal-playbook/SKILL.md',
          disableModelInvocation: true,
        },
        {
          name: 'read_policy',
          description: 'Tool skill.',
          kind: 'tool',
          tags: ['tool'],
          location: '.parallx/skills/read_policy/SKILL.md',
        },
      ],
      readFileRelative: vi.fn(async () => null),
      reportSystemPromptReport,
      getPreferencesForPrompt: vi.fn(async () => 'Prefer concise answers.'),
      unifiedConfigService: {
        getEffectiveConfig: () => ({
          chat: { workspaceDescription: 'Insurance workspace' },
          model: { temperature: 0.2, maxTokens: 512 },
        } as any),
      } as any,
    } as IDefaultParticipantServices;

    const participant = createOpenclawDefaultParticipant(services);
    const response = createResponse();

    await participant.handler({
      text: 'Help with a claim.',
      requestId: 'req-skills',
      mode: ChatMode.Agent,
      modelId: 'test-model',
      attempt: 0,
    } as IChatParticipantRequest, {
      sessionId: 'session-skills',
      history: [],
    } as IChatParticipantContext, response, createToken());

    const sentMessages = sendChatRequest.mock.calls[0][0];
    expect(sentMessages[0].content).toContain('claims-playbook');
    expect(sentMessages[0].content).not.toContain('internal-playbook');
    expect(sentMessages[0].content).toContain('## User Preferences');
    expect(reportSystemPromptReport).toHaveBeenCalledWith(expect.objectContaining({
      source: 'run',
      skills: expect.objectContaining({
        totalCount: 3,
        visibleCount: 1,
        hiddenCount: 2,
      }),
      tools: expect.objectContaining({
        totalCount: 1,
        availableCount: 1,
        filteredCount: 0,
        skillDerivedCount: 1,
      }),
    }));
  });

  it('derives skill tools at runtime and reports filtered capability state', async () => {
    const sendChatRequest = vi.fn(() => streamChunks([
      { content: 'Runtime skill answer', done: true, promptEvalCount: 9, evalCount: 14 },
    ]));
    const reportSystemPromptReport = vi.fn();
    const services: IDefaultParticipantServices = {
      sendChatRequest,
      getActiveModel: () => 'test-model',
      getWorkspaceName: () => 'Demo Workspace',
      getPageCount: vi.fn(async () => 0),
      getCurrentPageTitle: () => undefined,
      getToolDefinitions: () => [{ name: 'run_command', description: 'Run command', parameters: { type: 'object', properties: { command: { type: 'string' } } } }],
      getReadOnlyToolDefinitions: () => [],
      getSkillCatalog: () => [
        {
          name: 'policy_playbook',
          description: 'Explain the policy workflow.',
          kind: 'tool',
          tags: ['tool'],
          location: '.parallx/skills/policy_playbook/SKILL.md',
          permissionLevel: 'always-allowed',
          parameters: [{ name: 'query', type: 'string', description: 'Question', required: true }],
          body: '# Policy Playbook',
        },
      ],
      getToolPermissions: () => ({ run_command: 'never-allowed' }),
      readFileRelative: vi.fn(async () => null),
      reportSystemPromptReport,
      invokeToolWithRuntimeControl: vi.fn(async (name: string) => ({ content: `invoked ${name}` })),
      unifiedConfigService: {
        getEffectiveConfig: () => ({
          chat: { workspaceDescription: 'Insurance workspace' },
          model: { temperature: 0.2, maxTokens: 512 },
        } as any),
      } as any,
    } as IDefaultParticipantServices;

    const participant = createOpenclawDefaultParticipant(services);
    const response = createResponse();

    await participant.handler({
      text: 'Use the policy playbook.',
      requestId: 'req-runtime-tools',
      mode: ChatMode.Agent,
      modelId: 'test-model',
      attempt: 0,
    } as IChatParticipantRequest, {
      sessionId: 'session-runtime-tools',
      history: [],
    } as IChatParticipantContext, response, createToken());

    const requestOptions = sendChatRequest.mock.calls[0][1];
    expect(requestOptions.tools).toEqual([
      expect.objectContaining({ name: 'policy_playbook' }),
    ]);
    expect(reportSystemPromptReport).toHaveBeenCalledWith(expect.objectContaining({
      tools: expect.objectContaining({
        totalCount: 2,
        availableCount: 1,
        filteredCount: 1,
        skillDerivedCount: 1,
        entries: expect.arrayContaining([
          expect.objectContaining({ name: 'policy_playbook', source: 'skill', available: true }),
          expect.objectContaining({ name: 'run_command', source: 'platform', available: false, filteredReason: 'permission-never-allowed' }),
        ]),
      }),
    }));
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
    expect(firstMessages[0].content).toContain('You are Parallx, a local AI assistant');
    expect(invokeToolWithRuntimeControl).toHaveBeenCalledWith('read_file', { path: 'Policy.md' }, expect.objectContaining({ isCancellationRequested: false }));
    expect(response.markdown).toHaveBeenCalledWith('Grounded OpenClaw answer');
  });

  it('injects current canvas page context into default grounded turns (C2)', async () => {
    const sendChatRequest = vi.fn(() => streamChunks([
      { content: 'Vehicle answer', done: true },
    ]));
    const getCurrentPageContent = vi.fn(async () => ({
      title: 'Testing',
      pageId: 'page-1',
      textContent: 'This page should be visible in the OpenClaw context.',
    }));
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
    } as IDefaultParticipantServices;

    const participant = createOpenclawDefaultParticipant(services);
    const response = createResponse();

    await participant.handler({
      text: 'Tell me about my insured vehicle.',
      requestId: 'req-vehicle',
      mode: ChatMode.Agent,
      modelId: 'test-model',
      attempt: 0,
    } as IChatParticipantRequest, {
      sessionId: 'session-vehicle',
      history: [],
    } as IChatParticipantContext, response, createToken());

    expect(getCurrentPageContent).toHaveBeenCalled();
    const sentMessages = sendChatRequest.mock.calls[0][0];
    // Page content is now delivered via a user-role context message (F8-3 fix),
    // not systemPromptAddition, matching upstream AssembleResult.messages pattern.
    const contextMsg = sentMessages.find((m: any) =>
      m.role === 'user' && m.content.includes('Currently Open Page')
    );
    expect(contextMsg).toBeDefined();
  });

  it('seeds prior conversation turns into the default OpenClaw model prompt', async () => {
    const sendChatRequest = vi.fn(() => streamChunks([
      { content: 'Follow-up answer', done: true },
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
    } as IDefaultParticipantServices;

    const participant = createOpenclawDefaultParticipant(services);
    const response = createResponse();

    await participant.handler({
      text: 'Who should I call to file the claim?',
      requestId: 'req-history-followup',
      mode: ChatMode.Agent,
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
      content: 'Who should I call to file the claim?',
    }));
    expect(response.markdown).toHaveBeenCalledWith('Follow-up answer');
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
      mode: ChatMode.Agent,
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
});
