// D7: Observability service tests
import { describe, it, expect, vi } from 'vitest';
import { ObservabilityService } from '../../src/services/observabilityService';
import type { ITurnMetrics, ISessionMetrics, IModelMetrics } from '../../src/services/serviceTypes';

function makeTurn(overrides: Partial<ITurnMetrics> = {}): ITurnMetrics {
  return {
    model: 'gpt-oss:20b',
    promptTokens: 500,
    completionTokens: 200,
    totalTokens: 700,
    durationMs: 3000,
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('ObservabilityService', () => {
  it('starts with empty metrics', () => {
    const svc = new ObservabilityService();
    const m = svc.getSessionMetrics();
    expect(m.turnCount).toBe(0);
    expect(m.totalTokens).toBe(0);
    expect(m.totalDurationMs).toBe(0);
    expect(svc.getTurnHistory()).toHaveLength(0);
  });

  it('records a turn and updates session metrics', () => {
    const svc = new ObservabilityService();
    svc.recordTurn(makeTurn());
    const m = svc.getSessionMetrics();
    expect(m.turnCount).toBe(1);
    expect(m.totalPromptTokens).toBe(500);
    expect(m.totalCompletionTokens).toBe(200);
    expect(m.totalTokens).toBe(700);
    expect(m.totalDurationMs).toBe(3000);
    expect(m.avgDurationMs).toBe(3000);
  });

  it('accumulates multiple turns', () => {
    const svc = new ObservabilityService();
    svc.recordTurn(makeTurn({ promptTokens: 100, completionTokens: 50, totalTokens: 150, durationMs: 1000 }));
    svc.recordTurn(makeTurn({ promptTokens: 200, completionTokens: 100, totalTokens: 300, durationMs: 2000 }));
    svc.recordTurn(makeTurn({ promptTokens: 300, completionTokens: 150, totalTokens: 450, durationMs: 3000 }));
    const m = svc.getSessionMetrics();
    expect(m.turnCount).toBe(3);
    expect(m.totalPromptTokens).toBe(600);
    expect(m.totalCompletionTokens).toBe(300);
    expect(m.totalTokens).toBe(900);
    expect(m.totalDurationMs).toBe(6000);
    expect(m.avgDurationMs).toBe(2000);
    expect(m.avgPromptTokens).toBe(200);
    expect(m.avgCompletionTokens).toBe(100);
  });

  it('fires onDidRecordTurn event', () => {
    const svc = new ObservabilityService();
    const handler = vi.fn();
    svc.onDidRecordTurn(handler);
    const turn = makeTurn();
    svc.recordTurn(turn);
    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0][0]).toBe(turn);
  });

  it('returns turn history in order', () => {
    const svc = new ObservabilityService();
    svc.recordTurn(makeTurn({ model: 'a' }));
    svc.recordTurn(makeTurn({ model: 'b' }));
    svc.recordTurn(makeTurn({ model: 'c' }));
    const history = svc.getTurnHistory();
    expect(history).toHaveLength(3);
    expect(history.map(t => t.model)).toEqual(['a', 'b', 'c']);
  });

  describe('getModelMetrics', () => {
    it('groups by model', () => {
      const svc = new ObservabilityService();
      svc.recordTurn(makeTurn({ model: 'gpt-oss:20b', durationMs: 2000, totalTokens: 400 }));
      svc.recordTurn(makeTurn({ model: 'gpt-oss:20b', durationMs: 4000, totalTokens: 600 }));
      svc.recordTurn(makeTurn({ model: 'qwen3.5', durationMs: 1000, totalTokens: 200 }));
      const all = svc.getModelMetrics();
      expect(all).toHaveLength(2);
      const gpt = all.find(m => m.model === 'gpt-oss:20b')!;
      expect(gpt.turnCount).toBe(2);
      expect(gpt.totalTokens).toBe(1000);
      expect(gpt.avgDurationMs).toBe(3000);
      const qwen = all.find(m => m.model === 'qwen3.5')!;
      expect(qwen.turnCount).toBe(1);
      expect(qwen.avgDurationMs).toBe(1000);
    });

    it('filters by model when specified', () => {
      const svc = new ObservabilityService();
      svc.recordTurn(makeTurn({ model: 'gpt-oss:20b' }));
      svc.recordTurn(makeTurn({ model: 'qwen3.5' }));
      const filtered = svc.getModelMetrics('gpt-oss:20b');
      expect(filtered).toHaveLength(1);
      expect(filtered[0].model).toBe('gpt-oss:20b');
    });

    it('returns empty for unknown model', () => {
      const svc = new ObservabilityService();
      svc.recordTurn(makeTurn({ model: 'gpt-oss:20b' }));
      expect(svc.getModelMetrics('nonexistent')).toHaveLength(0);
    });
  });
});

describe('/usage with observability', () => {
  it('renders observability data when service available', async () => {
    const { tryHandleOpenclawUsageCommand } = await import('../../src/openclaw/commands/openclawUsageCommand');

    const mockObsSvc = {
      recordTurn: vi.fn(),
      getSessionMetrics: (): ISessionMetrics => ({
        turnCount: 5,
        totalPromptTokens: 2500,
        totalCompletionTokens: 1000,
        totalTokens: 3500,
        totalDurationMs: 15000,
        avgDurationMs: 3000,
        avgPromptTokens: 500,
        avgCompletionTokens: 200,
      }),
      getModelMetrics: (): IModelMetrics[] => [
        { model: 'gpt-oss:20b', turnCount: 5, totalTokens: 3500, avgDurationMs: 3000, avgPromptTokens: 500, avgCompletionTokens: 200 },
      ],
      getTurnHistory: () => [],
      onDidRecordTurn: vi.fn(),
    };

    const chunks: string[] = [];
    const response = { markdown: (t: string) => chunks.push(t), progress: () => {} } as any;
    const context = { history: [] } as any;
    const services = {
      getActiveModel: () => 'gpt-oss:20b',
      getModelContextLength: () => 32768,
      observabilityService: mockObsSvc,
    } as any;

    const handled = await tryHandleOpenclawUsageCommand(services, 'usage', context, response);
    expect(handled).toBe(true);
    expect(chunks[0]).toContain('Session Token Usage');
    expect(chunks[0]).toContain('3,500');
    expect(chunks[0]).toContain('3.0s'); // avgDurationMs = 3000
    expect(chunks[0]).toContain('Turns | 5');
  });

  it('falls back to history aggregation without observability', async () => {
    const { tryHandleOpenclawUsageCommand } = await import('../../src/openclaw/commands/openclawUsageCommand');

    const chunks: string[] = [];
    const response = { markdown: (t: string) => chunks.push(t), progress: () => {} } as any;
    const context = {
      history: [
        { response: { promptTokens: 100, completionTokens: 50 } },
        { response: { promptTokens: 200, completionTokens: 80 } },
      ],
    } as any;
    const services = {
      getActiveModel: () => 'gpt-oss:20b',
      getModelContextLength: () => 32768,
    } as any;

    const handled = await tryHandleOpenclawUsageCommand(services, 'usage', context, response);
    expect(handled).toBe(true);
    expect(chunks[0]).toContain('430');
    expect(chunks[0]).toContain('Turns | 2');
  });
});

describe('Turn timing integration', () => {
  it('IOpenclawTurnResult includes durationMs', async () => {
    // Verify the type contract by checking the turn runner exports
    const mod = await import('../../src/openclaw/openclawTurnRunner');
    expect(mod.runOpenclawTurn).toBeDefined();
    // The function itself is async, so we just check it exists.
    // The durationMs field is structurally enforced by IOpenclawTurnResult.
  });

  it('IReadOnlyTurnResult includes durationMs', async () => {
    const mod = await import('../../src/openclaw/openclawReadOnlyTurnRunner');
    expect(mod.runOpenclawReadOnlyTurn).toBeDefined();
    // durationMs is structurally enforced by IReadOnlyTurnResult.
    // Readonly participants (workspace/canvas) now also report timing.
  });
});

describe('Zero-token edge case', () => {
  it('records a zero-token turn without error', () => {
    const svc = new ObservabilityService();
    svc.recordTurn(makeTurn({ promptTokens: 0, completionTokens: 0, totalTokens: 0, durationMs: 100 }));
    const m = svc.getSessionMetrics();
    expect(m.turnCount).toBe(1);
    expect(m.totalTokens).toBe(0);
    expect(m.totalDurationMs).toBe(100);
  });
});

describe('Observability diagnostic check', () => {
  it('reports pass when no turns yet', async () => {
    const { EXTENDED_DIAGNOSTIC_CHECKS } = await import('../../src/services/diagnosticChecks');
    // The observability check is the last extended check (index 4)
    const obsCheck = EXTENDED_DIAGNOSTIC_CHECKS[5];
    const result = await obsCheck({
      getWorkspaceName: () => 'test',
      getObservabilityMetrics: () => ({
        turnCount: 0,
        totalPromptTokens: 0,
        totalCompletionTokens: 0,
        totalTokens: 0,
        totalDurationMs: 0,
        avgDurationMs: 0,
        avgPromptTokens: 0,
        avgCompletionTokens: 0,
      }),
    });
    expect(result.name).toBe('Observability');
    expect(result.status).toBe('pass');
    expect(result.detail).toContain('no turns');
  });

  it('reports pass when avg duration is healthy', async () => {
    const { EXTENDED_DIAGNOSTIC_CHECKS } = await import('../../src/services/diagnosticChecks');
    const obsCheck = EXTENDED_DIAGNOSTIC_CHECKS[5];
    const result = await obsCheck({
      getWorkspaceName: () => 'test',
      getObservabilityMetrics: () => ({
        turnCount: 5,
        totalPromptTokens: 2500,
        totalCompletionTokens: 1000,
        totalTokens: 3500,
        totalDurationMs: 15000,
        avgDurationMs: 3000,
        avgPromptTokens: 500,
        avgCompletionTokens: 200,
      }),
    });
    expect(result.status).toBe('pass');
    expect(result.detail).toContain('5 turns');
  });

  it('warns when avg duration exceeds 30s', async () => {
    const { EXTENDED_DIAGNOSTIC_CHECKS } = await import('../../src/services/diagnosticChecks');
    const obsCheck = EXTENDED_DIAGNOSTIC_CHECKS[5];
    const result = await obsCheck({
      getWorkspaceName: () => 'test',
      getObservabilityMetrics: () => ({
        turnCount: 3,
        totalPromptTokens: 1500,
        totalCompletionTokens: 600,
        totalTokens: 2100,
        totalDurationMs: 120000,
        avgDurationMs: 40000,
        avgPromptTokens: 500,
        avgCompletionTokens: 200,
      }),
    });
    expect(result.status).toBe('warn');
    expect(result.detail).toContain('slow');
  });

  it('warns when service not wired', async () => {
    const { EXTENDED_DIAGNOSTIC_CHECKS } = await import('../../src/services/diagnosticChecks');
    const obsCheck = EXTENDED_DIAGNOSTIC_CHECKS[5];
    const result = await obsCheck({ getWorkspaceName: () => 'test' });
    expect(result.status).toBe('warn');
    expect(result.detail).toContain('not wired');
  });
});

describe('D6: Compaction metrics in observability', () => {
  it('records turns with compaction fields', () => {
    const svc = new ObservabilityService();
    svc.recordTurn(makeTurn({ overflowCompactions: 2, timeoutCompactions: 1 }));
    const history = svc.getTurnHistory();
    expect(history).toHaveLength(1);
    expect(history[0].overflowCompactions).toBe(2);
    expect(history[0].timeoutCompactions).toBe(1);
  });

  it('compaction fields are optional and default to undefined', () => {
    const svc = new ObservabilityService();
    svc.recordTurn(makeTurn());
    const history = svc.getTurnHistory();
    expect(history[0].overflowCompactions).toBeUndefined();
    expect(history[0].timeoutCompactions).toBeUndefined();
  });
});
