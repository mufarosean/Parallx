// autonomySubagentGate.test.ts — M60 Phase γ §3.6 (depth-1 cap) + §3.8
// (flag gate) + §3.10 (event emit) for SubagentSpawner.

import { describe, expect, it, vi } from 'vitest';
import {
  SubagentSpawner,
  type ISubagentSpawnAutonomyInfo,
} from '../../src/openclaw/openclawSubagentSpawn';

function makeSpawner(opts: {
  isFlagEnabled?: () => boolean;
  onAutonomyEvent?: (info: ISubagentSpawnAutonomyInfo) => void;
  executor?: ReturnType<typeof vi.fn>;
  maxDepth?: number;
} = {}) {
  const executor = opts.executor ?? vi.fn().mockResolvedValue('ok');
  const announcer = vi.fn().mockResolvedValue(undefined);
  const spawner = new SubagentSpawner(executor, announcer, opts.maxDepth ?? 1);
  if (opts.isFlagEnabled || opts.onAutonomyEvent) {
    spawner.setObservers({
      isFlagEnabled: opts.isFlagEnabled,
      onAutonomyEvent: opts.onAutonomyEvent,
    });
  }
  return { spawner, executor, announcer };
}

describe('SubagentSpawner — M60 §3.8 flag gate', () => {
  it('refuses to spawn when autonomy.subagent.enabled is off', async () => {
    const events: ISubagentSpawnAutonomyInfo[] = [];
    const { spawner, executor } = makeSpawner({
      isFlagEnabled: () => false,
      onAutonomyEvent: (info) => events.push(info),
    });
    const result = await spawner.spawn({ task: 'do x' });
    expect(executor).not.toHaveBeenCalled();
    expect(result.status).toBe('failed');
    expect(result.error).toContain('gated');
    const gated = events.find((e) => e.outcome === 'gated');
    expect(gated).toBeDefined();
    expect(gated!.note).toContain('autonomy.subagent.enabled=false');
    spawner.dispose();
  });

  it('emits a completed event when flag is on and spawn succeeds', async () => {
    const events: ISubagentSpawnAutonomyInfo[] = [];
    const { spawner, executor } = makeSpawner({
      isFlagEnabled: () => true,
      onAutonomyEvent: (info) => events.push(info),
    });
    const result = await spawner.spawn({ task: 'do x' });
    expect(executor).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('completed');
    const completed = events.find((e) => e.outcome === 'completed');
    expect(completed).toBeDefined();
    expect(completed!.runId).toBeTruthy();
    spawner.dispose();
  });
});

describe('SubagentSpawner — M60 §3.6 depth-1 hard cap (no nested spawns)', () => {
  it('refuses to spawn at callerDepth ≥ maxDepth (=1)', async () => {
    const events: ISubagentSpawnAutonomyInfo[] = [];
    const { spawner, executor } = makeSpawner({
      isFlagEnabled: () => true,
      onAutonomyEvent: (info) => events.push(info),
      maxDepth: 1,
    });
    const result = await spawner.spawn({ task: 'nested', callerDepth: 1 });
    expect(executor).not.toHaveBeenCalled();
    expect(result.status).toBe('failed');
    expect(result.error).toContain('depth limit');
    const budget = events.find((e) => e.outcome === 'budget');
    expect(budget).toBeDefined();
    expect(budget!.note).toContain('depth-limit');
    spawner.dispose();
  });
});

describe('SubagentSpawner — parent session isolation', () => {
  it('does not invoke the announcer when result is empty', async () => {
    const executor = vi.fn().mockResolvedValue('');
    const announcer = vi.fn().mockResolvedValue(undefined);
    const spawner = new SubagentSpawner(executor, announcer, 1);
    spawner.setObservers({ isFlagEnabled: () => true });
    const result = await spawner.spawn({ task: 't' });
    expect(result.status).toBe('completed');
    // Empty result skips announcement (parent session unchanged).
    expect(announcer).not.toHaveBeenCalled();
    spawner.dispose();
  });
});
