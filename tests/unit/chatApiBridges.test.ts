// Unit tests for API bridges — M9.2 Cap 8

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LanguageModelBridge } from '../../src/api/bridges/languageModelBridge';
import { ChatBridge } from '../../src/api/bridges/chatBridge';
import { LanguageModelsService } from '../../src/services/languageModelsService';
import { ChatAgentService } from '../../src/services/chatAgentService';
import type { IDisposable } from '../../src/platform/lifecycle';
import type {
  ILanguageModelProvider,
  ILanguageModelInfo,
  IChatMessage,
  IChatResponseChunk,
  IProviderStatus,
  ICancellationToken,
} from '../../src/services/chatTypes';

// ── Mock Provider ──

function createMockProvider(): ILanguageModelProvider {
  return {
    id: 'test-provider',
    displayName: 'Test Provider',
    async checkAvailability(): Promise<IProviderStatus> {
      return { available: true };
    },
    async listModels(): Promise<readonly ILanguageModelInfo[]> {
      return [
        {
          id: 'test-model',
          displayName: 'Test Model',
          family: 'test',
          parameterSize: '1B',
          quantization: 'Q4_0',
          contextLength: 4096,
          capabilities: ['completion'],
        },
      ];
    },
    async getModelInfo(modelId: string): Promise<ILanguageModelInfo> {
      return {
        id: modelId,
        displayName: 'Test Model',
        family: 'test',
        parameterSize: '1B',
        quantization: 'Q4_0',
        contextLength: 4096,
        capabilities: ['completion'],
      };
    },
    async *sendChatRequest(
      _modelId: string,
      _messages: readonly IChatMessage[],
    ): AsyncIterable<IChatResponseChunk> {
      yield { content: 'Hello from test' };
    },
  };
}

// ── LanguageModelBridge Tests ──

describe('LanguageModelBridge', () => {
  let service: LanguageModelsService;
  let bridge: LanguageModelBridge;
  let subscriptions: IDisposable[];

  beforeEach(() => {
    service = new LanguageModelsService();
    subscriptions = [];
    bridge = new LanguageModelBridge('test-tool', service, subscriptions);
  });

  it('getModels returns models from service', async () => {
    service.registerProvider(createMockProvider());

    const models = await bridge.getModels();
    expect(models.length).toBe(1);
    expect(models[0].id).toBe('test-model');
  });

  it('registerProvider registers a provider through the bridge', async () => {
    const d = bridge.registerProvider(createMockProvider());
    expect(d).toBeDefined();

    const models = await service.getModels();
    expect(models.length).toBe(1);
  });

  it('onDidChangeModels fires when models change', async () => {
    const listener = vi.fn();
    bridge.onDidChangeModels(listener);

    service.registerProvider(createMockProvider());
    // Wait for model refresh
    await new Promise((r) => setTimeout(r, 50));

    expect(listener).toHaveBeenCalled();
  });

  it('throws after dispose', async () => {
    bridge.dispose();
    await expect(bridge.getModels()).rejects.toThrow('disposed');
  });

  it('dispose cleans up registrations', async () => {
    bridge.registerProvider(createMockProvider());
    bridge.dispose();

    // Provider should be unregistered
    const providers = service.getProviders();
    expect(providers.length).toBe(0);
  });
});

// ── ChatBridge Tests ──

describe('ChatBridge', () => {
  let agentService: ChatAgentService;
  let bridge: ChatBridge;
  let subscriptions: IDisposable[];

  beforeEach(() => {
    agentService = new ChatAgentService();
    subscriptions = [];
    bridge = new ChatBridge('test-tool', agentService, undefined, subscriptions);
  });

  it('createChatParticipant registers an agent', () => {
    const handler = vi.fn().mockResolvedValue({});
    const participant = bridge.createChatParticipant('test.agent', handler);

    expect(participant.id).toBe('test.agent');
    expect(participant.handler).toBe(handler);

    // Verify it's registered
    const agent = agentService.getAgent('test.agent');
    expect(agent).toBeDefined();
  });

  it('participant properties are mutable', () => {
    const handler = vi.fn().mockResolvedValue({});
    const participant = bridge.createChatParticipant('test.agent', handler);

    participant.displayName = 'Custom Name';
    participant.description = 'Custom description';
    participant.commands = [{ name: 'test', description: 'A test command' }];

    expect(participant.displayName).toBe('Custom Name');
    expect(participant.description).toBe('Custom description');
    expect(participant.commands).toHaveLength(1);
  });

  it('participant dispose unregisters from agent service', () => {
    const handler = vi.fn().mockResolvedValue({});
    const participant = bridge.createChatParticipant('test.agent', handler);

    participant.dispose();

    const agent = agentService.getAgent('test.agent');
    expect(agent).toBeUndefined();
  });

  it('throws after bridge dispose', () => {
    bridge.dispose();
    expect(() =>
      bridge.createChatParticipant('test.agent', vi.fn().mockResolvedValue({})),
    ).toThrow('disposed');
  });

  it('bridge dispose cleans up all participants', () => {
    const handler = vi.fn().mockResolvedValue({});
    bridge.createChatParticipant('agent1', handler);
    bridge.createChatParticipant('agent2', handler);

    bridge.dispose();

    expect(agentService.getAgent('agent1')).toBeUndefined();
    expect(agentService.getAgent('agent2')).toBeUndefined();
  });
});
