import { describe, expect, it, vi } from 'vitest';

import { ChatMode } from '../../src/services/chatTypes';
import { buildChatTurnExecutionConfig } from '../../src/built-in/chat/utilities/chatTurnExecutionConfig';

describe('chat turn execution config', () => {
  it('disables tools for conversational turns and carries profile model settings', () => {
    const { synthesisOptions } = buildChatTurnExecutionConfig({
      sendChatRequest: vi.fn(),
      getWorkspaceName: () => 'Demo',
      getPageCount: vi.fn(),
      getCurrentPageTitle: () => undefined,
      getToolDefinitions: vi.fn(() => [{ name: 'write_file' }] as any),
      getReadOnlyToolDefinitions: vi.fn(() => [{ name: 'read_file' }] as any),
      unifiedConfigService: {
        getEffectiveConfig: () => ({ memory: { memoryEnabled: true } }),
      } as any,
    } as any, {
      requestMode: ChatMode.Agent,
      requestText: 'hello',
      capabilities: {
        canReadContext: true,
        canInvokeTools: true,
        canProposeEdits: false,
        canAutonomous: true,
      },
      aiProfile: { model: { temperature: 0.2, maxTokens: 333 } } as any,
      messages: [],
      userContent: 'hello',
      retrievedContextText: '',
      evidenceAssessment: { status: 'sufficient', reasons: [] },
      isConversationalTurn: true,
      citationMode: 'disabled',
      ragSources: [],
      retrievalPlan: { intent: 'conversational', reasoning: 'chat', needsRetrieval: false, queries: [] },
      sessionId: 'session-1',
      history: [],
      response: {} as any,
      token: {} as any,
      maxIterations: 5,
      repairMarkdown: (markdown) => markdown,
      buildExtractiveFallbackAnswer: vi.fn(),
      buildMissingCitationFooter: vi.fn(),
      buildDeterministicSessionSummary: vi.fn(),
      parseEditResponse: vi.fn(),
      extractToolCallsFromText: vi.fn(),
      stripToolNarration: vi.fn(),
      categorizeError: vi.fn(),
    });

    expect(synthesisOptions.requestOptions.tools).toBeUndefined();
    expect(synthesisOptions.requestOptions.temperature).toBe(0.2);
    expect(synthesisOptions.requestOptions.maxTokens).toBe(333);
    expect(synthesisOptions.useModelOnlyExecution).toBe(false);
    expect(synthesisOptions.memoryEnabled).toBe(true);
  });

  it('uses read-only tools in ask mode and JSON output in edit mode policy cases', () => {
    const baseServices = {
      sendChatRequest: vi.fn(),
      invokeToolWithRuntimeControl: vi.fn(),
      getWorkspaceName: () => 'Demo',
      getPageCount: vi.fn(),
      getCurrentPageTitle: () => undefined,
      getToolDefinitions: vi.fn(() => [{ name: 'write_file' }] as any),
      getReadOnlyToolDefinitions: vi.fn(() => [{ name: 'read_file' }] as any),
      unifiedConfigService: {
        getEffectiveConfig: () => ({ memory: { memoryEnabled: false } }),
      } as any,
    } as any;

    const askConfig = buildChatTurnExecutionConfig(baseServices, {
      requestMode: ChatMode.Ask,
      requestText: 'question',
      capabilities: {
        canReadContext: true,
        canInvokeTools: true,
        canProposeEdits: false,
        canAutonomous: false,
      },
      messages: [],
      userContent: 'question',
      retrievedContextText: '',
      evidenceAssessment: { status: 'weak', reasons: [] },
      isConversationalTurn: false,
      citationMode: 'required',
      ragSources: [],
      retrievalPlan: { intent: 'question', reasoning: 'grounded', needsRetrieval: true, queries: [] },
      sessionId: 'session-2',
      history: [],
      response: {} as any,
      token: {} as any,
      maxIterations: 3,
      repairMarkdown: (markdown) => markdown,
      buildExtractiveFallbackAnswer: vi.fn(),
      buildMissingCitationFooter: vi.fn(),
      buildDeterministicSessionSummary: vi.fn(),
      parseEditResponse: vi.fn(),
      extractToolCallsFromText: vi.fn(),
      stripToolNarration: vi.fn(),
      categorizeError: vi.fn(),
    });

    expect(askConfig.synthesisOptions.requestOptions.tools).toEqual([{ name: 'read_file' }]);
    expect(askConfig.synthesisOptions.canInvokeTools).toBe(true);
    expect(askConfig.synthesisOptions.useModelOnlyExecution).toBe(false);
    expect(askConfig.synthesisOptions.memoryEnabled).toBe(false);

    const editConfig = buildChatTurnExecutionConfig(baseServices, {
      requestMode: ChatMode.Edit,
      requestText: 'edit this',
      capabilities: {
        canReadContext: true,
        canInvokeTools: false,
        canProposeEdits: true,
        canAutonomous: false,
      },
      messages: [],
      userContent: 'edit this',
      retrievedContextText: '',
      evidenceAssessment: { status: 'sufficient', reasons: [] },
      isConversationalTurn: false,
      citationMode: 'disabled',
      ragSources: [],
      retrievalPlan: { intent: 'question', reasoning: 'edit', needsRetrieval: false, queries: [] },
      sessionId: 'session-3',
      history: [],
      response: {} as any,
      token: {} as any,
      maxIterations: 2,
      repairMarkdown: (markdown) => markdown,
      buildExtractiveFallbackAnswer: vi.fn(),
      buildMissingCitationFooter: vi.fn(),
      buildDeterministicSessionSummary: vi.fn(),
      parseEditResponse: vi.fn(),
      extractToolCallsFromText: vi.fn(),
      stripToolNarration: vi.fn(),
      categorizeError: vi.fn(),
    });

    expect(editConfig.synthesisOptions.requestOptions.tools).toBeUndefined();
    expect(editConfig.synthesisOptions.requestOptions.format).toEqual({ type: 'object' });
    expect(editConfig.synthesisOptions.isEditMode).toBe(true);
    expect(editConfig.synthesisOptions.useModelOnlyExecution).toBe(true);
  });
});