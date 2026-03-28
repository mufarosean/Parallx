// D2: Slash command handler tests
import { describe, expect, it, vi } from 'vitest';
import { tryHandleOpenclawStatusCommand } from '../../src/openclaw/commands/openclawStatusCommand';
import { tryHandleOpenclawNewCommand } from '../../src/openclaw/commands/openclawNewCommand';
import { tryHandleOpenclawModelsCommand } from '../../src/openclaw/commands/openclawModelsCommand';
import { tryHandleOpenclawDoctorCommand } from '../../src/openclaw/commands/openclawDoctorCommand';
import { tryHandleOpenclawThinkCommand, THINK_SESSION_FLAG } from '../../src/openclaw/commands/openclawThinkCommand';
import { tryHandleOpenclawUsageCommand } from '../../src/openclaw/commands/openclawUsageCommand';
import { tryHandleOpenclawToolsCommand } from '../../src/openclaw/commands/openclawToolsCommand';
import { tryHandleOpenclawVerboseCommand, VERBOSE_SESSION_FLAG } from '../../src/openclaw/commands/openclawVerboseCommand';
import type { IDefaultParticipantServices } from '../../src/openclaw/openclawTypes';

function createMockResponse() {
  const chunks: string[] = [];
  return {
    markdown: vi.fn((text: string) => chunks.push(text)),
    progress: vi.fn(),
    codeBlock: vi.fn(),
    warning: vi.fn(),
    reference: vi.fn(),
    thinking: vi.fn(),
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
    getMarkdownText: vi.fn(() => chunks.join('')),
    provenance: vi.fn(),
    _chunks: chunks,
  };
}

function createMinimalServices(overrides?: Partial<IDefaultParticipantServices>): IDefaultParticipantServices {
  return {
    sendChatRequest: vi.fn() as any,
    getActiveModel: () => 'gpt-oss:20b',
    getWorkspaceName: () => 'test-workspace',
    getPageCount: async () => 5,
    getCurrentPageTitle: () => 'Test Page',
    getToolDefinitions: () => [],
    getReadOnlyToolDefinitions: () => [],
    ...overrides,
  };
}

// ━━━ /status ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe('/status command', () => {
  it('ignores non-status commands', async () => {
    const response = createMockResponse();
    const result = await tryHandleOpenclawStatusCommand(createMinimalServices(), 'init', response);
    expect(result).toBe(false);
    expect(response.markdown).not.toHaveBeenCalled();
  });

  it('renders runtime status markdown', async () => {
    const response = createMockResponse();
    const services = createMinimalServices({
      getModelContextLength: () => 131072,
      isRAGAvailable: () => true,
      isIndexing: () => false,
      getFileCount: async () => 42,
      checkProviderStatus: async () => ({ available: true, version: '0.6.0' }),
    });
    const result = await tryHandleOpenclawStatusCommand(services, 'status', response);
    expect(result).toBe(true);
    expect(response.markdown).toHaveBeenCalledOnce();
    const text = response._chunks[0];
    expect(text).toContain('AI Runtime Status');
    expect(text).toContain('gpt-oss:20b');
    expect(text).toContain('✅ Connected');
    expect(text).toContain('42');
  });

  it('handles missing provider status gracefully', async () => {
    const response = createMockResponse();
    const result = await tryHandleOpenclawStatusCommand(createMinimalServices(), 'status', response);
    expect(result).toBe(true);
    expect(response._chunks[0]).toContain('AI Runtime Status');
  });
});

// ━━━ /new ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe('/new command', () => {
  it('ignores non-new commands', async () => {
    const response = createMockResponse();
    const result = await tryHandleOpenclawNewCommand(createMinimalServices(), 'status', response);
    expect(result).toBe(false);
  });

  it('bridges to chat.clearSession command', async () => {
    const executeCommand = vi.fn();
    const response = createMockResponse();
    const services = createMinimalServices({ executeCommand });
    const result = await tryHandleOpenclawNewCommand(services, 'new', response);
    expect(result).toBe(true);
    expect(executeCommand).toHaveBeenCalledWith('chat.clearSession');
  });

  it('warns when executeCommand is not available', async () => {
    const response = createMockResponse();
    const result = await tryHandleOpenclawNewCommand(createMinimalServices(), 'new', response);
    expect(result).toBe(true);
    expect(response._chunks[0]).toContain('not available');
  });
});

// ━━━ /models ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe('/models command', () => {
  it('ignores non-models commands', async () => {
    const response = createMockResponse();
    const result = await tryHandleOpenclawModelsCommand(createMinimalServices(), 'init', response);
    expect(result).toBe(false);
  });

  it('renders model list table', async () => {
    const response = createMockResponse();
    const services = createMinimalServices({
      listModels: async () => [
        { id: 'gpt-oss:20b', name: 'gpt-oss:20b', parameterSize: '20B', quantization: 'Q4_K_M', contextLength: 131072 },
        { id: 'qwen3.5:latest', name: 'qwen3.5:latest', parameterSize: '72B', contextLength: 65536 },
      ],
    });
    const result = await tryHandleOpenclawModelsCommand(services, 'models', response);
    expect(result).toBe(true);
    const text = response._chunks[0];
    expect(text).toContain('Available Models');
    expect(text).toContain('gpt-oss:20b');
    expect(text).toContain('qwen3.5:latest');
    expect(text).toContain('2 model(s)');
  });

  it('falls back to getAvailableModelIds when listModels not wired', async () => {
    const response = createMockResponse();
    const services = createMinimalServices({
      getAvailableModelIds: async () => ['gpt-oss:20b', 'llama3.2:latest'],
    });
    const result = await tryHandleOpenclawModelsCommand(services, 'models', response);
    expect(result).toBe(true);
    const text = response._chunks[0];
    expect(text).toContain('gpt-oss:20b');
  });

  it('handles empty model list', async () => {
    const response = createMockResponse();
    const services = createMinimalServices({
      listModels: async () => [],
    });
    const result = await tryHandleOpenclawModelsCommand(services, 'models', response);
    expect(result).toBe(true);
    expect(response._chunks[0]).toContain('No models found');
  });
});

// ━━━ /doctor ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe('/doctor command', () => {
  it('ignores non-doctor commands', async () => {
    const response = createMockResponse();
    const result = await tryHandleOpenclawDoctorCommand(createMinimalServices(), 'status', response);
    expect(result).toBe(false);
  });

  it('runs all diagnostic checks', async () => {
    const response = createMockResponse();
    const services = createMinimalServices({
      checkProviderStatus: async () => ({ available: true, version: '0.6.0' }),
      listModels: async () => [{ id: 'gpt-oss:20b', name: 'gpt-oss:20b' }],
      isRAGAvailable: () => true,
      isIndexing: () => false,
      getFileCount: async () => 10,
      existsRelative: async () => true,
      getModelContextLength: () => 131072,
    });
    const result = await tryHandleOpenclawDoctorCommand(services, 'doctor', response);
    expect(result).toBe(true);
    expect(response.progress).toHaveBeenCalledWith('Running diagnostics...');
    const text = response._chunks[0];
    expect(text).toContain('Diagnostic Report');
    expect(text).toContain('Ollama Connection');
    expect(text).toContain('Active Model');
    expect(text).toContain('pass');
  });

  it('reports failures when provider is down', async () => {
    const response = createMockResponse();
    const services = createMinimalServices({
      checkProviderStatus: async () => ({ available: false, error: 'Connection refused' }),
      getActiveModel: () => undefined,
    });
    const result = await tryHandleOpenclawDoctorCommand(services, 'doctor', response);
    expect(result).toBe(true);
    const text = response._chunks[0];
    expect(text).toContain('❌');
    expect(text).toContain('Recommended Actions');
  });
});

// ━━━ /think ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe('/think command', () => {
  it('ignores non-think commands', async () => {
    const response = createMockResponse();
    const result = await tryHandleOpenclawThinkCommand(createMinimalServices(), 'status', response);
    expect(result).toBe(false);
  });

  it('toggles thinking mode on', async () => {
    const flags = new Map<string, boolean>();
    const response = createMockResponse();
    const services = createMinimalServices({
      getSessionFlag: (key: string) => flags.get(key) ?? false,
      setSessionFlag: (key: string, value: boolean) => { flags.set(key, value); },
    });
    const result = await tryHandleOpenclawThinkCommand(services, 'think', response);
    expect(result).toBe(true);
    expect(flags.get(THINK_SESSION_FLAG)).toBe(true);
    expect(response._chunks[0]).toContain('enabled');
  });

  it('toggles thinking mode off', async () => {
    const flags = new Map<string, boolean>([[THINK_SESSION_FLAG, true]]);
    const response = createMockResponse();
    const services = createMinimalServices({
      getSessionFlag: (key: string) => flags.get(key) ?? false,
      setSessionFlag: (key: string, value: boolean) => { flags.set(key, value); },
    });
    const result = await tryHandleOpenclawThinkCommand(services, 'think', response);
    expect(result).toBe(true);
    expect(flags.get(THINK_SESSION_FLAG)).toBe(false);
    expect(response._chunks[0]).toContain('disabled');
  });
});

// ━━━ /usage ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe('/usage command', () => {
  it('ignores non-usage commands', async () => {
    const response = createMockResponse();
    const result = await tryHandleOpenclawUsageCommand(createMinimalServices(), 'status', { history: [] } as any, response);
    expect(result).toBe(false);
  });

  it('aggregates token usage from history', async () => {
    const response = createMockResponse();
    const context = {
      history: [
        { response: { promptTokens: 500, completionTokens: 200 } },
        { response: { promptTokens: 800, completionTokens: 300 } },
      ],
    };
    const services = createMinimalServices({
      getModelContextLength: () => 131072,
    });
    const result = await tryHandleOpenclawUsageCommand(services, 'usage', context as any, response);
    expect(result).toBe(true);
    const text = response._chunks[0];
    expect(text).toContain('Session Token Usage');
    expect(text).toContain('1,300'); // total prompt
    expect(text).toContain('500'); // total completion
    expect(text).toContain('2'); // turns
  });

  it('handles empty history', async () => {
    const response = createMockResponse();
    const result = await tryHandleOpenclawUsageCommand(
      createMinimalServices(), 'usage', { history: [] } as any, response,
    );
    expect(result).toBe(true);
    expect(response._chunks[0]).toContain('No turns completed');
  });
});

// ━━━ /tools ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe('/tools command', () => {
  it('ignores non-tools commands', async () => {
    const response = createMockResponse();
    const result = await tryHandleOpenclawToolsCommand(createMinimalServices(), 'status', response);
    expect(result).toBe(false);
  });

  it('renders tool list table', async () => {
    const response = createMockResponse();
    const services = createMinimalServices({
      getToolDefinitions: () => [
        { name: 'read_file', description: 'Read a file from workspace', parameters: { type: 'object' as const, properties: {} } },
        { name: 'search', description: 'Search workspace content', parameters: { type: 'object' as const, properties: {} } },
      ],
      getToolPermissions: () => ({ read_file: 'always-allowed' as const, search: 'requires-approval' as const }),
    });
    const result = await tryHandleOpenclawToolsCommand(services, 'tools', response);
    expect(result).toBe(true);
    const text = response._chunks[0];
    expect(text).toContain('Available Tools');
    expect(text).toContain('read_file');
    expect(text).toContain('search');
    expect(text).toContain('2 total capabilities');
  });

  it('handles empty tool list', async () => {
    const response = createMockResponse();
    const result = await tryHandleOpenclawToolsCommand(createMinimalServices(), 'tools', response);
    expect(result).toBe(true);
    expect(response._chunks[0]).toContain('No tools registered');
  });
});

// ━━━ /verbose ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe('/verbose command', () => {
  it('ignores non-verbose commands', async () => {
    const response = createMockResponse();
    const result = await tryHandleOpenclawVerboseCommand(createMinimalServices(), 'status', response);
    expect(result).toBe(false);
  });

  it('toggles verbose mode on', async () => {
    const flags = new Map<string, boolean>();
    const response = createMockResponse();
    const services = createMinimalServices({
      getSessionFlag: (key: string) => flags.get(key) ?? false,
      setSessionFlag: (key: string, value: boolean) => { flags.set(key, value); },
    });
    const result = await tryHandleOpenclawVerboseCommand(services, 'verbose', response);
    expect(result).toBe(true);
    expect(flags.get(VERBOSE_SESSION_FLAG)).toBe(true);
    expect(response._chunks[0]).toContain('enabled');
  });

  it('toggles verbose mode off', async () => {
    const flags = new Map<string, boolean>([[VERBOSE_SESSION_FLAG, true]]);
    const response = createMockResponse();
    const services = createMinimalServices({
      getSessionFlag: (key: string) => flags.get(key) ?? false,
      setSessionFlag: (key: string, value: boolean) => { flags.set(key, value); },
    });
    const result = await tryHandleOpenclawVerboseCommand(services, 'verbose', response);
    expect(result).toBe(true);
    expect(flags.get(VERBOSE_SESSION_FLAG)).toBe(false);
    expect(response._chunks[0]).toContain('disabled');
  });
});

// ━━━ Command dispatch guard ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe('command dispatch guard', () => {
  it('all commands return false for undefined command', async () => {
    const response = createMockResponse();
    const services = createMinimalServices();
    expect(await tryHandleOpenclawStatusCommand(services, undefined, response)).toBe(false);
    expect(await tryHandleOpenclawNewCommand(services, undefined, response)).toBe(false);
    expect(await tryHandleOpenclawModelsCommand(services, undefined, response)).toBe(false);
    expect(await tryHandleOpenclawDoctorCommand(services, undefined, response)).toBe(false);
    expect(await tryHandleOpenclawThinkCommand(services, undefined, response)).toBe(false);
    expect(await tryHandleOpenclawUsageCommand(services, undefined, { history: [] } as any, response)).toBe(false);
    expect(await tryHandleOpenclawToolsCommand(services, undefined, response)).toBe(false);
    expect(await tryHandleOpenclawVerboseCommand(services, undefined, response)).toBe(false);
  });
});

// ━━━ Edge case: /think without setSessionFlag ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe('/think edge cases', () => {
  it('warns when setSessionFlag is not available', async () => {
    const response = createMockResponse();
    const services = createMinimalServices({
      getSessionFlag: () => false,
      // setSessionFlag is intentionally undefined
    });
    const result = await tryHandleOpenclawThinkCommand(services, 'think', response);
    expect(result).toBe(true);
    expect(response._chunks[0]).toContain('not available');
  });
});

// ━━━ Edge case: /verbose without setSessionFlag ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe('/verbose edge cases', () => {
  it('warns when setSessionFlag is not available', async () => {
    const response = createMockResponse();
    const services = createMinimalServices({
      getSessionFlag: () => false,
      // setSessionFlag is intentionally undefined
    });
    const result = await tryHandleOpenclawVerboseCommand(services, 'verbose', response);
    expect(result).toBe(true);
    expect(response._chunks[0]).toContain('not available');
  });
});

// ━━━ Edge case: /status with provider error ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe('/status edge cases', () => {
  it('handles provider status that throws', async () => {
    const response = createMockResponse();
    const services = createMinimalServices({
      checkProviderStatus: async () => { throw new Error('Network error'); },
    });
    const result = await tryHandleOpenclawStatusCommand(services, 'status', response);
    expect(result).toBe(true);
    expect(response._chunks[0]).toContain('AI Runtime Status');
  });

  it('renders config section when available', async () => {
    const response = createMockResponse();
    const services = createMinimalServices({
      unifiedConfigService: {
        getEffectiveConfig: () => ({
          model: { temperature: 0.7, maxTokens: 4096 },
          agent: { maxIterations: 25 },
        }),
      } as any,
    });
    const result = await tryHandleOpenclawStatusCommand(services, 'status', response);
    expect(result).toBe(true);
    const text = response._chunks[0];
    expect(text).toContain('Agent');
    expect(text).toContain('25');
  });
});

// ━━━ Edge case: /models with listModels error ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe('/models edge cases', () => {
  it('handles listModels that throws', async () => {
    const response = createMockResponse();
    const services = createMinimalServices({
      listModels: async () => { throw new Error('Connection refused'); },
    });
    const result = await tryHandleOpenclawModelsCommand(services, 'models', response);
    expect(result).toBe(true);
    expect(response._chunks[0]).toContain('No models found');
  });

  it('handles both listModels and getAvailableModelIds unavailable', async () => {
    const response = createMockResponse();
    const services = createMinimalServices();
    // Neither listModels nor getAvailableModelIds — should show "No models available"
    const result = await tryHandleOpenclawModelsCommand(services, 'models', response);
    expect(result).toBe(true);
    expect(response._chunks[0]).toContain('No models available');
  });
});

// ━━━ Edge case: /doctor with multiple failures ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe('/doctor edge cases', () => {
  it('shows recommendations for all failures', async () => {
    const response = createMockResponse();
    const services = createMinimalServices({
      checkProviderStatus: async () => ({ available: false, error: 'Connection refused' }),
      getActiveModel: () => undefined,
      isRAGAvailable: () => false,
      getFileCount: async () => 0,
      getModelContextLength: () => 0,
    });
    const result = await tryHandleOpenclawDoctorCommand(services, 'doctor', response);
    expect(result).toBe(true);
    const text = response._chunks[0];
    expect(text).toContain('Recommended Actions');
    expect(text).toContain('Ollama Connection');
    expect(text).toContain('Active Model');
  });

  it('handles checkProviderStatus throwing', async () => {
    const response = createMockResponse();
    const services = createMinimalServices({
      checkProviderStatus: async () => { throw new Error('Timeout'); },
    });
    const result = await tryHandleOpenclawDoctorCommand(services, 'doctor', response);
    expect(result).toBe(true);
    const text = response._chunks[0];
    expect(text).toContain('Diagnostic Report');
    expect(text).toContain('❌'); // connection check failed
  });
});

// ━━━ Cross-command: /new clears session flags ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe('/new session flag clearing', () => {
  it('clears think and verbose flags on /new', async () => {
    const flags = new Map<string, boolean>([
      [THINK_SESSION_FLAG, true],
      [VERBOSE_SESSION_FLAG, true],
    ]);
    const executeCommand = vi.fn();
    const response = createMockResponse();
    const services = createMinimalServices({
      getSessionFlag: (key: string) => flags.get(key) ?? false,
      setSessionFlag: (key: string, value: boolean) => { flags.set(key, value); },
      executeCommand,
    });
    await tryHandleOpenclawNewCommand(services, 'new', response);
    expect(flags.get(THINK_SESSION_FLAG)).toBe(false);
    expect(flags.get(VERBOSE_SESSION_FLAG)).toBe(false);
    expect(executeCommand).toHaveBeenCalledWith('chat.clearSession');
  });
});

// ━━━ Cross-command: /think and /verbose coexistence ━━━━━━━━━━━━━━━━━━━━━━━━
describe('cross-command interactions', () => {
  it('think and verbose can be active simultaneously', async () => {
    const flags = new Map<string, boolean>();
    const services = createMinimalServices({
      getSessionFlag: (key: string) => flags.get(key) ?? false,
      setSessionFlag: (key: string, value: boolean) => { flags.set(key, value); },
    });

    const r1 = createMockResponse();
    await tryHandleOpenclawThinkCommand(services, 'think', r1);
    expect(flags.get(THINK_SESSION_FLAG)).toBe(true);

    const r2 = createMockResponse();
    await tryHandleOpenclawVerboseCommand(services, 'verbose', r2);
    expect(flags.get(VERBOSE_SESSION_FLAG)).toBe(true);

    // Both should still be true
    expect(flags.get(THINK_SESSION_FLAG)).toBe(true);
    expect(flags.get(VERBOSE_SESSION_FLAG)).toBe(true);
  });

  it('toggling one does not affect the other', async () => {
    const flags = new Map<string, boolean>([
      [THINK_SESSION_FLAG, true],
      [VERBOSE_SESSION_FLAG, true],
    ]);
    const services = createMinimalServices({
      getSessionFlag: (key: string) => flags.get(key) ?? false,
      setSessionFlag: (key: string, value: boolean) => { flags.set(key, value); },
    });

    // Toggle think off
    const r1 = createMockResponse();
    await tryHandleOpenclawThinkCommand(services, 'think', r1);
    expect(flags.get(THINK_SESSION_FLAG)).toBe(false);
    expect(flags.get(VERBOSE_SESSION_FLAG)).toBe(true); // unaffected
  });
});

// ━━━ Edge case: /tools with skills and permissions ━━━━━━━━━━━━━━━━━━━━━━━━━
describe('/tools edge cases', () => {
  it('renders skills section when skills are available', async () => {
    const response = createMockResponse();
    const services = createMinimalServices({
      getToolDefinitions: () => [
        { name: 'read_file', description: 'Read a file', parameters: { type: 'object' as const, properties: {} } },
      ],
      getSkillCatalog: () => [
        { name: 'web-search', description: 'Search the web', kind: 'builtin', tags: [] },
      ],
    });
    const result = await tryHandleOpenclawToolsCommand(services, 'tools', response);
    expect(result).toBe(true);
    const text = response._chunks[0];
    expect(text).toContain('Skills');
    expect(text).toContain('web-search');
    expect(text).toContain('2 total capabilities');
  });
});

// ━━━ Edge case: /usage with context window percentage ━━━━━━━━━━━━━━━━━━━━━━
describe('/usage edge cases', () => {
  it('shows context usage percentage when data available', async () => {
    const response = createMockResponse();
    const context = {
      history: [
        { response: { promptTokens: 50000, completionTokens: 15000 } },
      ],
    };
    const services = createMinimalServices({
      getModelContextLength: () => 131072,
    });
    const result = await tryHandleOpenclawUsageCommand(services, 'usage', context as any, response);
    expect(result).toBe(true);
    const text = response._chunks[0];
    expect(text).toContain('Context Usage');
    expect(text).toContain('%');
  });
});
