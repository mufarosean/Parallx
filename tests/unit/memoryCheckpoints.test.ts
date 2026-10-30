// memoryCheckpoints.test.ts — memory_write leaves /rewind checkpoints: the
// prior text of each memory file it changed, so a bad memory write can be
// taken back like any file write.
import { describe, it, expect, beforeEach } from 'vitest';
import { memoryWritePaths, withMemoryCheckpoints } from '../../src/built-in/chat/tools/memoryCheckpoints';
import { listCheckpoints, _resetCheckpointsForTests } from '../../src/services/fileCheckpointService';
import type { IChatTool } from '../../src/services/chatTypes';

const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) } as never;

describe('memory write checkpoints', () => {
  beforeEach(() => _resetCheckpointsForTests());

  it('knows which files each kind of write may change', () => {
    expect(memoryWritePaths({ file: 'USER' })).toEqual(['.parallx/USER.md']);
    expect(memoryWritePaths({ file: 'MEMORY' })).toEqual(['.parallx/memory/MEMORY.md']);
    expect(memoryWritePaths({ file: 'daily', date: '2026-10-30' })).toEqual(['.parallx/memory/2026-10-30.md']);
    expect(memoryWritePaths({ file: 'daily' }, '2026-11-01')).toEqual(['.parallx/memory/2026-11-01.md']);
    expect(memoryWritePaths({ file: 'lesson', slug: 'clark-tail' })).toEqual(['.parallx/memory/lessons/clark-tail.md', '.parallx/memory/MEMORY.md', '.parallx/memory/_archive/lessons/clark-tail.md']);
    expect(memoryWritePaths({ file: 'lesson', slug: '../x' })).toEqual([]);
  });

  it('checkpoints every file the write changed, created ones as absent', async () => {
    const files = new Map<string, string>([['.parallx/memory/MEMORY.md', '# Index\n']]);
    const inner: IChatTool = {
      name: 'memory_write', description: '', parameters: {}, requiresConfirmation: true, permissionLevel: 'requires-approval' as never,
      async handler() {
        files.set('.parallx/memory/lessons/clark-tail.md', 'Truncate at 20 years');
        files.set('.parallx/memory/MEMORY.md', '# Index\n- clark-tail\n');
        return { content: 'Added lesson `clark-tail`.' };
      },
    };
    const tool = withMemoryCheckpoints(inner, async (p) => files.get(p) ?? null);
    const r = await tool.handler({ file: 'lesson', action: 'add', slug: 'clark-tail' }, token);
    expect(r.content).toMatch(/checkpoint #\d+, #\d+; \/rewind restores/);
    const cps = listCheckpoints();
    expect(cps.map((c) => [c.path, c.priorContent])).toEqual(expect.arrayContaining([
      ['.parallx/memory/lessons/clark-tail.md', null],
      ['.parallx/memory/MEMORY.md', '# Index\n'],
    ]));
    expect(cps).toHaveLength(2); // the archive copy did not change
  });

  it('leaves a refused write without a checkpoint', async () => {
    const inner = { name: 'memory_write', handler: async () => ({ content: 'Cannot add', isError: true }) } as unknown as IChatTool;
    const r = await withMemoryCheckpoints(inner, async () => 'x').handler({ file: 'USER', action: 'add' }, token);
    expect(r).toEqual({ content: 'Cannot add', isError: true });
    expect(listCheckpoints()).toHaveLength(0);
  });
});
