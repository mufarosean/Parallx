import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import {
  SubagentSpawner,
  SubagentRegistry,
  DEFAULT_MAX_SPAWN_DEPTH,
  DEFAULT_RUN_TIMEOUT_SECONDS,
  MAX_CONCURRENT_RUNS,
  type ISubagentSpawnParams,
  type SubagentTurnExecutor,
  type SubagentAnnouncer,
} from '../../src/openclaw/openclawSubagentSpawn';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createParams(overrides?: Partial<ISubagentSpawnParams>): ISubagentSpawnParams {
  return {
    task: 'Analyze the test file for coverage',
    label: 'coverage-check',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// SubagentRegistry
// ---------------------------------------------------------------------------

describe('SubagentRegistry', () => {
  it('registers a run with correct defaults', () => {
    const reg = new SubagentRegistry();
    const run = reg.register(createParams());

    expect(run.id).toMatch(/^subagent-/);
    expect(run.task).toBe('Analyze the test file for coverage');
    expect(run.label).toBe('coverage-check');
    expect(run.model).toBeNull();
    expect(run.status).toBe('spawning');
    expect(run.callerDepth).toBe(0);
    expect(run.spawnedAt).toBeGreaterThan(0);
    expect(run.completedAt).toBeNull();
    expect(run.result).toBeNull();
    expect(run.error).toBeNull();
    expect(run.timeoutMs).toBe(DEFAULT_RUN_TIMEOUT_SECONDS * 1000);

    reg.dispose();
  });

  it('registers with explicit values', () => {
    const reg = new SubagentRegistry();
    const run = reg.register(createParams({
      model: 'gpt-oss:20b',
      callerDepth: 2,
      runTimeoutSeconds: 60,
    }));

    expect(run.model).toBe('gpt-oss:20b');
    expect(run.callerDepth).toBe(2);
    expect(run.timeoutMs).toBe(60_000);

    reg.dispose();
  });

  it('assigns unique IDs', () => {
    const reg = new SubagentRegistry();
    const r1 = reg.register(createParams());
    const r2 = reg.register(createParams());

    expect(r1.id).not.toBe(r2.id);

    reg.dispose();
  });

  it('updates run status', () => {
    const reg = new SubagentRegistry();
    const run = reg.register(createParams());

    const updated = reg.update(run.id, { status: 'running' });
    expect(updated.status).toBe('running');

    reg.dispose();
  });

  it('updates with result and completedAt', () => {
    const reg = new SubagentRegistry();
    const run = reg.register(createParams());

    const now = Date.now();
    const updated = reg.update(run.id, {
      status: 'completed',
      result: 'All tests pass',
      completedAt: now,
    });

    expect(updated.status).toBe('completed');
    expect(updated.result).toBe('All tests pass');
    expect(updated.completedAt).toBe(now);

    reg.dispose();
  });

  it('throws on update for unknown ID', () => {
    const reg = new SubagentRegistry();

    expect(() => reg.update('nonexistent', { status: 'failed' })).toThrow(/not found/i);

    reg.dispose();
  });

  it('tracks active runs', () => {
    const reg = new SubagentRegistry();
    const r1 = reg.register(createParams());
    reg.update(r1.id, { status: 'running' });

    const r2 = reg.register(createParams());
    reg.update(r2.id, { status: 'completed', completedAt: Date.now() });

    expect(reg.activeRuns).toHaveLength(1);
    expect(reg.activeRuns[0].id).toBe(r1.id);
    expect(reg.activeCount).toBe(1);

    reg.dispose();
  });

  it('get returns snapshot', () => {
    const reg = new SubagentRegistry();
    const run = reg.register(createParams());
    const fetched = reg.get(run.id);

    expect(fetched).toEqual(run);
    expect(fetched).not.toBe(run);

    reg.dispose();
  });

  it('get returns undefined for unknown ID', () => {
    const reg = new SubagentRegistry();
    expect(reg.get('nonexistent')).toBeUndefined();
    reg.dispose();
  });

  it('remove deletes a run', () => {
    const reg = new SubagentRegistry();
    const run = reg.register(createParams());

    expect(reg.remove(run.id)).toBe(true);
    expect(reg.get(run.id)).toBeUndefined();

    reg.dispose();
  });

  it('throws on register after dispose', () => {
    const reg = new SubagentRegistry();
    reg.dispose();

    expect(() => reg.register(createParams())).toThrow(/disposed/i);
  });

  it('dispose clears all runs', () => {
    const reg = new SubagentRegistry();
    reg.register(createParams());
    reg.register(createParams());
    reg.dispose();

    expect(reg.runs).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// SubagentSpawner
// ---------------------------------------------------------------------------

describe('SubagentSpawner', () => {
  let executor: ReturnType<typeof vi.fn>;
  let announcer: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    executor = vi.fn().mockResolvedValue('Task completed successfully');
    announcer = vi.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('spawn — happy path', () => {
    it('spawns and completes a sub-agent', async () => {
      const spawner = new SubagentSpawner(executor, announcer);

      const result = await spawner.spawn(createParams());

      expect(result.status).toBe('completed');
      expect(result.result).toBe('Task completed successfully');
      expect(result.error).toBeNull();
      expect(result.runId).toMatch(/^subagent-/);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);

      expect(executor).toHaveBeenCalledWith('Analyze the test file for coverage', null);

      spawner.dispose();
    });

    it('passes model override to executor', async () => {
      const spawner = new SubagentSpawner(executor, announcer);

      await spawner.spawn(createParams({ model: 'qwen3.5' }));

      expect(executor).toHaveBeenCalledWith(expect.any(String), 'qwen3.5');

      spawner.dispose();
    });

    it('announces completion', async () => {
      const spawner = new SubagentSpawner(executor, announcer);

      await spawner.spawn(createParams());

      expect(announcer).toHaveBeenCalledTimes(1);
      expect(announcer).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'completed' }),
        'Task completed successfully',
      );

      spawner.dispose();
    });

    it('updates registry through lifecycle', async () => {
      const spawner = new SubagentSpawner(executor, announcer);

      const result = await spawner.spawn(createParams());
      const run = spawner.registry.get(result.runId);

      expect(run).toBeDefined();
      expect(run!.status).toBe('completed');
      expect(run!.result).toBe('Task completed successfully');
      expect(run!.completedAt).toBeGreaterThan(0);

      spawner.dispose();
    });
  });

  describe('spawn — depth limit', () => {
    it('rejects when depth >= maxDepth', async () => {
      const spawner = new SubagentSpawner(executor, announcer, 3);

      const result = await spawner.spawn(createParams({ callerDepth: 3 }));

      expect(result.status).toBe('failed');
      expect(result.error).toMatch(/depth limit/i);
      expect(executor).not.toHaveBeenCalled();

      spawner.dispose();
    });

    it('allows at depth < maxDepth', async () => {
      const spawner = new SubagentSpawner(executor, announcer, 3);

      const result = await spawner.spawn(createParams({ callerDepth: 2 }));

      expect(result.status).toBe('completed');

      spawner.dispose();
    });

    it('uses DEFAULT_MAX_SPAWN_DEPTH', async () => {
      const spawner = new SubagentSpawner(executor, announcer);

      const result = await spawner.spawn(createParams({
        callerDepth: DEFAULT_MAX_SPAWN_DEPTH,
      }));

      expect(result.status).toBe('failed');
      expect(result.error).toMatch(/depth limit/i);

      spawner.dispose();
    });
  });

  describe('spawn — concurrency limit', () => {
    it('rejects when max concurrent runs reached', async () => {
      // Create a slow executor that never resolves
      const slowExecutor = vi.fn().mockReturnValue(new Promise(() => { /* never resolves */ }));
      const registry = new SubagentRegistry();
      const spawner = new SubagentSpawner(slowExecutor, announcer, 10, registry);

      // Fill up the concurrent limit by registering runs directly
      for (let i = 0; i < MAX_CONCURRENT_RUNS; i++) {
        const run = registry.register(createParams({ task: `task-${i}` }));
        registry.update(run.id, { status: 'running' });
      }

      const result = await spawner.spawn(createParams({ task: 'overflow' }));

      expect(result.status).toBe('failed');
      expect(result.error).toMatch(/concurrent/i);

      spawner.dispose();
    });
  });

  describe('spawn — executor failure', () => {
    it('marks run as failed on executor error', async () => {
      executor.mockRejectedValueOnce(new Error('model unavailable'));
      const spawner = new SubagentSpawner(executor, announcer);

      const result = await spawner.spawn(createParams());

      expect(result.status).toBe('failed');
      expect(result.error).toBe('model unavailable');
      expect(announcer).not.toHaveBeenCalled();

      spawner.dispose();
    });

    it('marks run as timeout on timeout error', async () => {
      executor.mockRejectedValueOnce(new Error('Sub-agent timeout after 120000ms'));
      const spawner = new SubagentSpawner(executor, announcer);

      const result = await spawner.spawn(createParams());

      expect(result.status).toBe('timeout');

      spawner.dispose();
    });
  });

  describe('spawn — announcer failure', () => {
    it('completes even if announcer fails', async () => {
      announcer.mockRejectedValueOnce(new Error('announce failed'));
      const spawner = new SubagentSpawner(executor, announcer);

      const result = await spawner.spawn(createParams());

      // Non-fatal — run still succeeded
      expect(result.status).toBe('completed');
      expect(result.result).toBe('Task completed successfully');

      spawner.dispose();
    });
  });

  describe('spawn — no announcer', () => {
    it('works with null announcer', async () => {
      const spawner = new SubagentSpawner(executor, null);

      const result = await spawner.spawn(createParams());

      expect(result.status).toBe('completed');

      spawner.dispose();
    });
  });

  describe('cancel', () => {
    it('cancels a running sub-agent', () => {
      const registry = new SubagentRegistry();
      const spawner = new SubagentSpawner(executor, announcer, 3, registry);

      const run = registry.register(createParams());
      registry.update(run.id, { status: 'running' });

      expect(spawner.cancel(run.id)).toBe(true);

      const cancelled = registry.get(run.id);
      expect(cancelled!.status).toBe('cancelled');
      expect(cancelled!.completedAt).toBeGreaterThan(0);
    });

    it('returns false for unknown run', () => {
      const spawner = new SubagentSpawner(executor, announcer);

      expect(spawner.cancel('nonexistent')).toBe(false);

      spawner.dispose();
    });

    it('returns false for already completed run', () => {
      const registry = new SubagentRegistry();
      const spawner = new SubagentSpawner(executor, announcer, 3, registry);

      const run = registry.register(createParams());
      registry.update(run.id, { status: 'completed', completedAt: Date.now() });

      expect(spawner.cancel(run.id)).toBe(false);

      spawner.dispose();
    });
  });

  describe('dispose', () => {
    it('cancels active runs on dispose', () => {
      const registry = new SubagentRegistry();
      const spawner = new SubagentSpawner(executor, announcer, 3, registry);

      const r1 = registry.register(createParams());
      registry.update(r1.id, { status: 'running' });

      spawner.dispose();

      // Registry is disposed, but we can check the run was cancelled
      // (dispose clears the registry, so no runs remain)
      expect(registry.runs).toHaveLength(0);
    });

    it('throws on spawn after dispose', async () => {
      const spawner = new SubagentSpawner(executor, announcer);
      spawner.dispose();

      await expect(spawner.spawn(createParams())).rejects.toThrow(/disposed/i);
    });
  });
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('subagent constants', () => {
  it('DEFAULT_MAX_SPAWN_DEPTH is reasonable', () => {
    expect(DEFAULT_MAX_SPAWN_DEPTH).toBeGreaterThanOrEqual(1);
    expect(DEFAULT_MAX_SPAWN_DEPTH).toBeLessThanOrEqual(10);
  });

  it('DEFAULT_RUN_TIMEOUT_SECONDS is reasonable', () => {
    expect(DEFAULT_RUN_TIMEOUT_SECONDS).toBeGreaterThanOrEqual(30);
    expect(DEFAULT_RUN_TIMEOUT_SECONDS).toBeLessThanOrEqual(600);
  });

  it('MAX_CONCURRENT_RUNS is reasonable', () => {
    expect(MAX_CONCURRENT_RUNS).toBeGreaterThanOrEqual(1);
    expect(MAX_CONCURRENT_RUNS).toBeLessThanOrEqual(20);
  });
});
