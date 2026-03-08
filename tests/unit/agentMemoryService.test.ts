import { describe, expect, it } from 'vitest';
import { InMemoryStorage } from '../../src/platform/storage';
import { AgentMemoryService } from '../../src/services/agentMemoryService';
import { AgentTaskStore } from '../../src/services/agentTaskStore';

async function createMemoryHarness(): Promise<{ memoryService: AgentMemoryService; taskStore: AgentTaskStore }> {
  const storage = new InMemoryStorage();
  const taskStore = new AgentTaskStore();
  await taskStore.setStorage(storage);
  const memoryService = new AgentMemoryService(taskStore);
  return { memoryService, taskStore };
}

describe('AgentMemoryService', () => {
  it('records task-scoped working memory entries', async () => {
    const { memoryService } = await createMemoryHarness();

    const entry = await memoryService.remember('task-1', {
      id: 'memory-1',
      category: 'goal',
      content: '  Produce   a migration checklist.  ',
      source: 'user',
      pinned: true,
    }, '2026-03-08T15:10:00.000Z');

    expect(entry.content).toBe('Produce a migration checklist.');
    expect(memoryService.listTaskMemory('task-1')).toHaveLength(1);
  });

  it('compacts older non-pinned memory entries by category', async () => {
    const { memoryService, taskStore } = await createMemoryHarness();

    for (let index = 0; index < 5; index += 1) {
      await memoryService.remember('task-1', {
        id: `attempt-${index}`,
        category: 'attempt',
        content: `Attempt ${index}`,
      }, `2026-03-08T15:1${index}:00.000Z`);
    }

    const compacted = await memoryService.compactTaskMemory('task-1', '2026-03-08T15:20:00.000Z');
    const attempts = compacted.filter((entry) => entry.category === 'attempt');
    expect(attempts.filter((entry) => !entry.supersededById)).toHaveLength(4);
    expect(taskStore.getMemoryEntry('attempt-0')?.supersededById).toBeDefined();
  });

  it('lists only active entries by default and exposes superseded entries on request', async () => {
    const { memoryService } = await createMemoryHarness();
    await memoryService.remember('task-1', {
      id: 'memory-1',
      category: 'assumption',
      content: 'The output should be a markdown checklist.',
    }, '2026-03-08T15:21:00.000Z');
    await memoryService.correctTaskMemory('task-1', 'memory-1', {
      id: 'memory-2',
      content: 'The output should be a JSON checklist.',
    }, '2026-03-08T15:22:00.000Z');

    expect(memoryService.listTaskMemory('task-1').map((entry) => entry.id)).toEqual(['memory-2']);
    expect(memoryService.listTaskMemory('task-1', { includeSuperseded: true }).map((entry) => entry.id)).toEqual(['memory-1', 'memory-2']);
  });

  it('corrects task memory by superseding the previous entry', async () => {
    const { memoryService, taskStore } = await createMemoryHarness();
    await memoryService.remember('task-1', {
      id: 'memory-1',
      category: 'assumption',
      content: 'Use the legacy claims schema.',
      source: 'agent',
      pinned: true,
    }, '2026-03-08T15:23:00.000Z');

    const corrected = await memoryService.correctTaskMemory('task-1', 'memory-1', {
      id: 'memory-2',
      content: 'Use the revised claims schema.',
      source: 'user',
    }, '2026-03-08T15:24:00.000Z');

    expect(corrected.previous.supersededById).toBe('memory-2');
    expect(corrected.corrected.source).toBe('user');
    expect(corrected.corrected.pinned).toBe(true);
    expect(memoryService.getTaskMemoryEntry('task-1', 'memory-2')?.content).toBe('Use the revised claims schema.');
    expect(taskStore.getMemoryEntry('memory-1')?.supersededById).toBe('memory-2');
  });
});