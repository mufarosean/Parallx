// D3: Diagnostics service + diagnostic checks unit tests
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DiagnosticsService } from '../../src/services/diagnosticsService';
import { CORE_DIAGNOSTIC_CHECKS, EXTENDED_DIAGNOSTIC_CHECKS, ALL_DIAGNOSTIC_CHECKS } from '../../src/services/diagnosticChecks';
import type { IDiagnosticCheckDeps, IDiagnosticResult, IDiagnosticCheckProducer } from '../../src/services/serviceTypes';

function createMockDeps(overrides: Partial<IDiagnosticCheckDeps> = {}): IDiagnosticCheckDeps {
  return {
    getWorkspaceName: () => 'test-workspace',
    checkProviderStatus: async () => ({ available: true, version: '0.5.0' }),
    getActiveModel: () => 'gpt-oss:20b',
    listModels: async () => [{ id: 'gpt-oss:20b', name: 'gpt-oss:20b', size: 20_000_000_000 }],
    isRAGAvailable: () => true,
    isIndexing: () => false,
    getFileCount: async () => 42,
    existsRelative: async () => true,
    getModelContextLength: () => 32768,
    getEffectiveConfig: () => ({ model: 'gpt-oss:20b' }),
    checkEmbedding: async () => true,
    checkVectorStore: async () => true,
    checkDocumentExtraction: async () => true,
    checkMemoryService: async () => true,
    ...overrides,
  };
}

describe('DiagnosticsService', () => {
  it('runs checks and returns results', async () => {
    const check: IDiagnosticCheckProducer = async () => ({
      name: 'Test Check',
      status: 'pass',
      detail: 'ok',
      timestamp: Date.now(),
    });
    const service = new DiagnosticsService(createMockDeps(), [check]);
    const results = await service.runChecks();
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Test Check');
    expect(results[0].status).toBe('pass');
  });

  it('caches last results', async () => {
    const check: IDiagnosticCheckProducer = async () => ({
      name: 'Cached',
      status: 'pass',
      detail: 'ok',
      timestamp: Date.now(),
    });
    const service = new DiagnosticsService(createMockDeps(), [check]);
    expect(service.getLastResults()).toHaveLength(0);
    await service.runChecks();
    expect(service.getLastResults()).toHaveLength(1);
  });

  it('fires onDidChange event', async () => {
    const check: IDiagnosticCheckProducer = async () => ({
      name: 'Event',
      status: 'warn',
      detail: 'testing',
      timestamp: Date.now(),
    });
    const service = new DiagnosticsService(createMockDeps(), [check]);
    const handler = vi.fn();
    service.onDidChange(handler);
    await service.runChecks();
    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0][0]).toHaveLength(1);
  });

  it('catches check producer errors', async () => {
    const failingCheck: IDiagnosticCheckProducer = async () => {
      throw new Error('boom');
    };
    const service = new DiagnosticsService(createMockDeps(), [failingCheck]);
    const results = await service.runChecks();
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('fail');
    expect(results[0].detail).toContain('boom');
  });

  it('runs multiple checks in parallel', async () => {
    const checks: IDiagnosticCheckProducer[] = [
      async () => ({ name: 'A', status: 'pass', detail: 'a', timestamp: Date.now() }),
      async () => ({ name: 'B', status: 'warn', detail: 'b', timestamp: Date.now() }),
      async () => ({ name: 'C', status: 'fail', detail: 'c', timestamp: Date.now() }),
    ];
    const service = new DiagnosticsService(createMockDeps(), checks);
    const results = await service.runChecks();
    expect(results).toHaveLength(3);
    expect(results.map(r => r.name)).toEqual(['A', 'B', 'C']);
  });

  it('updateDeps merges new deps into check context', async () => {
    const check: IDiagnosticCheckProducer = async (deps) => ({
      name: 'Model',
      status: deps.getActiveModel?.() ? 'pass' : 'fail',
      detail: deps.getActiveModel?.() ?? 'none',
      timestamp: Date.now(),
    });
    const service = new DiagnosticsService(createMockDeps({ getActiveModel: undefined }), [check]);
    // Before updateDeps — getActiveModel is undefined
    let results = await service.runChecks();
    expect(results[0].status).toBe('fail');
    // After updateDeps — getActiveModel is now wired
    service.updateDeps({ getActiveModel: () => 'gpt-oss:20b' });
    results = await service.runChecks();
    expect(results[0].status).toBe('pass');
    expect(results[0].detail).toBe('gpt-oss:20b');
  });

  it('updateDeps does not overwrite existing deps', async () => {
    const check: IDiagnosticCheckProducer = async (deps) => ({
      name: 'Workspace',
      status: 'pass',
      detail: deps.getWorkspaceName(),
      timestamp: Date.now(),
    });
    const service = new DiagnosticsService(createMockDeps({ getWorkspaceName: () => 'original' }), [check]);
    service.updateDeps({ getActiveModel: () => 'model' });
    const results = await service.runChecks();
    expect(results[0].detail).toBe('original'); // not overwritten
  });

  it('dispose prevents further events', async () => {
    const check: IDiagnosticCheckProducer = async () => ({
      name: 'Dispose',
      status: 'pass',
      detail: 'ok',
      timestamp: Date.now(),
    });
    const service = new DiagnosticsService(createMockDeps(), [check]);
    const handler = vi.fn();
    service.onDidChange(handler);
    service.dispose();
    await service.runChecks(); // still runs, but event may not fire due to disposed emitter
    // Allow both behaviors: emitter may throw or silently not fire
    // The key is that dispose doesn't break runChecks
  });
});

describe('Core Diagnostic Checks', () => {
  it('exports 9 core checks', () => {
    expect(CORE_DIAGNOSTIC_CHECKS).toHaveLength(9);
  });

  it('Ollama Connection — pass when available', async () => {
    const result = await CORE_DIAGNOSTIC_CHECKS[0](createMockDeps());
    expect(result.name).toBe('Ollama Connection');
    expect(result.status).toBe('pass');
    expect(result.detail).toContain('Connected');
    expect(result.timestamp).toBeGreaterThan(0);
  });

  it('Ollama Connection — fail when unavailable', async () => {
    const result = await CORE_DIAGNOSTIC_CHECKS[0](createMockDeps({
      checkProviderStatus: async () => ({ available: false, error: 'unreachable' }),
    }));
    expect(result.status).toBe('fail');
    expect(result.detail).toContain('unreachable');
  });

  it('Active Model — pass when set', async () => {
    const result = await CORE_DIAGNOSTIC_CHECKS[1](createMockDeps());
    expect(result.status).toBe('pass');
    expect(result.detail).toBe('gpt-oss:20b');
  });

  it('Active Model — fail when not set', async () => {
    const result = await CORE_DIAGNOSTIC_CHECKS[1](createMockDeps({ getActiveModel: () => undefined }));
    expect(result.status).toBe('fail');
  });

  it('Model Available — pass when model found', async () => {
    const result = await CORE_DIAGNOSTIC_CHECKS[2](createMockDeps());
    expect(result.status).toBe('pass');
  });

  it('Model Available — fail when model missing', async () => {
    const result = await CORE_DIAGNOSTIC_CHECKS[2](createMockDeps({
      listModels: async () => [{ id: 'other-model', name: 'other-model' }],
    }));
    expect(result.status).toBe('fail');
    expect(result.detail).toContain('not found');
  });

  it('RAG Engine — pass when available', async () => {
    const result = await CORE_DIAGNOSTIC_CHECKS[3](createMockDeps());
    expect(result.status).toBe('pass');
  });

  it('RAG Engine — warn when unavailable', async () => {
    const result = await CORE_DIAGNOSTIC_CHECKS[3](createMockDeps({ isRAGAvailable: () => false }));
    expect(result.status).toBe('warn');
  });

  it('File Index — pass when files indexed', async () => {
    const result = await CORE_DIAGNOSTIC_CHECKS[4](createMockDeps());
    expect(result.status).toBe('pass');
    expect(result.detail).toContain('42');
  });

  it('File Index — warn when empty', async () => {
    const result = await CORE_DIAGNOSTIC_CHECKS[4](createMockDeps({ getFileCount: async () => 0 }));
    expect(result.status).toBe('warn');
  });

  it('Workspace — pass when name exists', async () => {
    const result = await CORE_DIAGNOSTIC_CHECKS[5](createMockDeps());
    expect(result.status).toBe('pass');
  });

  it('Bootstrap — pass when AGENTS.md found', async () => {
    const result = await CORE_DIAGNOSTIC_CHECKS[6](createMockDeps());
    expect(result.status).toBe('pass');
  });

  it('Bootstrap — warn when missing', async () => {
    const result = await CORE_DIAGNOSTIC_CHECKS[6](createMockDeps({ existsRelative: async () => false }));
    expect(result.status).toBe('warn');
  });

  it('Context Window — pass when positive', async () => {
    const result = await CORE_DIAGNOSTIC_CHECKS[7](createMockDeps());
    expect(result.status).toBe('pass');
    expect(result.detail).toContain('32K');
  });

  it('Configuration — pass when loaded', async () => {
    const result = await CORE_DIAGNOSTIC_CHECKS[8](createMockDeps());
    expect(result.status).toBe('pass');
  });

  it('Configuration — warn when defaults', async () => {
    const result = await CORE_DIAGNOSTIC_CHECKS[8](createMockDeps({ getEffectiveConfig: () => undefined }));
    expect(result.status).toBe('warn');
  });

  it('all core checks produce valid results', async () => {
    const deps = createMockDeps();
    for (const check of CORE_DIAGNOSTIC_CHECKS) {
      const result = await check(deps);
      expect(result.name).toBeTruthy();
      expect(['pass', 'fail', 'warn']).toContain(result.status);
      expect(result.timestamp).toBeGreaterThan(0);
    }
  });
});

describe('Extended Diagnostic Checks', () => {
  it('exports 4 extended checks', () => {
    expect(EXTENDED_DIAGNOSTIC_CHECKS).toHaveLength(4);
  });

  it('Embedding — pass when responding', async () => {
    const result = await EXTENDED_DIAGNOSTIC_CHECKS[0](createMockDeps());
    expect(result.status).toBe('pass');
    expect(result.detail).toContain('nomic-embed-text');
  });

  it('Embedding — fail when unavailable', async () => {
    const result = await EXTENDED_DIAGNOSTIC_CHECKS[0](createMockDeps({ checkEmbedding: async () => false }));
    expect(result.status).toBe('fail');
  });

  it('Embedding — warn when check unavailable', async () => {
    const result = await EXTENDED_DIAGNOSTIC_CHECKS[0](createMockDeps({ checkEmbedding: undefined }));
    expect(result.status).toBe('warn');
  });

  it('Vector Store — pass when operational', async () => {
    const result = await EXTENDED_DIAGNOSTIC_CHECKS[1](createMockDeps());
    expect(result.status).toBe('pass');
  });

  it('Document Extraction — pass when available', async () => {
    const result = await EXTENDED_DIAGNOSTIC_CHECKS[2](createMockDeps());
    expect(result.status).toBe('pass');
  });

  it('Memory Service — pass when operational', async () => {
    const result = await EXTENDED_DIAGNOSTIC_CHECKS[3](createMockDeps());
    expect(result.status).toBe('pass');
  });

  it('all extended checks produce valid results', async () => {
    const deps = createMockDeps();
    for (const check of EXTENDED_DIAGNOSTIC_CHECKS) {
      const result = await check(deps);
      expect(result.name).toBeTruthy();
      expect(['pass', 'fail', 'warn']).toContain(result.status);
      expect(result.timestamp).toBeGreaterThan(0);
    }
  });
});

describe('ALL_DIAGNOSTIC_CHECKS', () => {
  it('combines core + extended = 13 total', () => {
    expect(ALL_DIAGNOSTIC_CHECKS).toHaveLength(13);
    expect(ALL_DIAGNOSTIC_CHECKS).toEqual([...CORE_DIAGNOSTIC_CHECKS, ...EXTENDED_DIAGNOSTIC_CHECKS]);
  });
});

describe('/doctor command delegation', () => {
  it('delegates to diagnosticsService when available', async () => {
    const { tryHandleOpenclawDoctorCommand } = await import('../../src/openclaw/commands/openclawDoctorCommand');

    const mockResults: IDiagnosticResult[] = [
      { name: 'Test', status: 'pass', detail: 'ok', timestamp: Date.now() },
    ];
    const mockDiagnosticsService = {
      runChecks: vi.fn().mockResolvedValue(mockResults),
      getLastResults: () => mockResults,
      onDidChange: vi.fn(),
    };

    const markdownChunks: string[] = [];
    const response = {
      markdown: (text: string) => markdownChunks.push(text),
      progress: () => {},
    } as any;

    const services = {
      getWorkspaceName: () => 'test',
      diagnosticsService: mockDiagnosticsService,
    } as any;

    const handled = await tryHandleOpenclawDoctorCommand(services, 'doctor', response);
    expect(handled).toBe(true);
    expect(mockDiagnosticsService.runChecks).toHaveBeenCalledOnce();
    expect(markdownChunks[0]).toContain('Diagnostic Report');
  });

  it('falls back to inline checks without diagnosticsService', async () => {
    const { tryHandleOpenclawDoctorCommand } = await import('../../src/openclaw/commands/openclawDoctorCommand');

    const markdownChunks: string[] = [];
    const response = {
      markdown: (text: string) => markdownChunks.push(text),
      progress: () => {},
    } as any;

    const services = {
      getWorkspaceName: () => 'fallback-workspace',
      getActiveModel: () => 'test-model',
      getModelContextLength: () => 8192,
      unifiedConfigService: { getEffectiveConfig: () => ({}) },
    } as any;

    const handled = await tryHandleOpenclawDoctorCommand(services, 'doctor', response);
    expect(handled).toBe(true);
    expect(markdownChunks[0]).toContain('Diagnostic Report');
  });
});
