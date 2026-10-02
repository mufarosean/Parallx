import { describe, expect, it } from 'vitest';
import { buildAgentsSnapshot, liveRunStep } from '../../src/built-in/agents/agentsModel';
import { engineLines } from '../../src/built-in/chat/widgets/chatEngineChip';
import { placementOf } from '../../src/built-in/chat/providers/ollamaProvider';

const base = { paused: false, tasks: [], approvals: [], jobs: [], rows: [] };

describe('what the app says about the model engine', () => {
  it('background runs show in Running now, with where they stand', () => {
    const s = buildAgentsSnapshot({
      ...base,
      live: [
        { runId: 'b', origin: 'heartbeat', startedAt: 2, engine: 'waiting', behindChat: true },
        { runId: 'a', origin: 'workflow', label: 'Morning Brief', startedAt: 1, engine: 'working', preemptions: 1 },
        { runId: 'c', origin: 'subagent', startedAt: 3 },
      ],
    });
    expect(s.running.map((r) => [r.name, r.step, r.state, r.action, r.kind])).toEqual([
      ['Morning Brief', 'Working (paused once for your chat)', 'working', 'stop', 'run'],
      ['Heartbeat', 'Waiting for the model, behind your chat', 'waiting', 'stop', 'run'],
      ['Helper', 'Working', 'working', 'stop', 'run'],
    ]);
  });

  it('words for a run waiting behind another run', () => {
    expect(liveRunStep({ runId: 'x', startedAt: 0, engine: 'waiting' })).toBe('Waiting for the model');
    expect(liveRunStep({ runId: 'x', startedAt: 0, engine: 'working', preemptions: 3 })).toBe('Working (paused 3 times for your chat)');
  });

  it('the chip says where the model sits and who waits', () => {
    expect(engineLines(undefined)).toEqual([]);
    expect(engineLines({ waiting: 0, where: 'gpu' })).toEqual(['On the graphics card']);
    expect(engineLines({ waiting: 2, where: 'partial' })).toEqual([
      'Partly on the CPU, so slower. A smaller size may fit on the graphics card.',
      '2 background runs wait until your chat is done',
    ]);
    expect(engineLines({ waiting: 1 })).toEqual(['1 background run waits until your chat is done']);
  });

  it("reads Ollama's /api/ps sizes as a place", () => {
    expect(placementOf({ name: 'q', size: 100, size_vram: 100, context_length: 163840 })).toEqual({ modelId: 'q', where: 'gpu', contextLength: 163840 });
    expect(placementOf({ name: 'q', size: 100, size_vram: 70 }).where).toBe('partial');
    expect(placementOf({ name: 'q', size: 100, size_vram: 0 }).where).toBe('cpu');
    // Older servers send no size_vram: assume it fits.
    expect(placementOf({ name: 'q', size: 100 }).where).toBe('gpu');
  });
});
