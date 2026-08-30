import { describe, expect, it, beforeEach, vi } from 'vitest';

import {
  bindCheckpointEnvironment,
  recordCheckpoint,
  listCheckpoints,
  latestCheckpoint,
  revertCheckpoint,
  _resetCheckpointsForTests,
} from '../../src/services/fileCheckpointService';
import { tryHandleOpenclawRewindCommand } from '../../src/openclaw/commands/openclawRewindCommand';
import type { IChatResponseStream } from '../../src/services/chatTypes';

function fakeResponse(): { response: IChatResponseStream; text: () => string } {
  const parts: string[] = [];
  const response = { markdown: vi.fn((s: string) => { parts.push(s); }) } as unknown as IChatResponseStream;
  return { response, text: () => parts.join('\n') };
}

describe('fileCheckpoints — recovery over permission (HARNESS.md 2.2)', () => {
  beforeEach(() => {
    _resetCheckpointsForTests();
  });

  it('records and lists newest-first with a rolling cap', () => {
    for (let i = 0; i < 60; i++) {
      recordCheckpoint({ path: `f${i}.ts`, priorContent: 'old', tool: 'fs_edit_file' });
    }
    const listed = listCheckpoints(10);
    expect(listed).toHaveLength(10);
    expect(listed[0].path).toBe('f59.ts');
    expect(latestCheckpoint()?.path).toBe('f59.ts');
    // Cap enforced at 50 — the earliest entries are gone
    expect(listCheckpoints(100)).toHaveLength(50);
  });

  it('revert restores prior content through the writer and records the inverse', async () => {
    const writes: Array<{ path: string; content: string }> = [];
    bindCheckpointEnvironment({
      fs: {
        exists: async () => true,
        readFileContent: async () => ({ content: 'CURRENT', type: 'text', totalChars: 7 }),
        readdir: async () => [],
        workspaceRootName: 'ws',
      },
      writer: {
        writeFile: async (path: string, content: string) => { writes.push({ path, content }); },
        isPathAllowed: () => true,
      },
      workspaceRoot: 'D:/ws',
    });

    const entry = recordCheckpoint({ path: 'a.ts', priorContent: 'ORIGINAL', tool: 'fs_edit_file', intent: 'Fix import' });
    const result = await revertCheckpoint(entry.id);

    expect(result.ok).toBe(true);
    expect(writes).toEqual([{ path: 'a.ts', content: 'ORIGINAL' }]);
    // The revert checkpointed the pre-revert state, so it is itself revertible
    const inverse = latestCheckpoint()!;
    expect(inverse.tool).toBe('rewind');
    expect(inverse.priorContent).toBe('CURRENT');
  });

  it('refuses unknown ids and reports missing writer plainly', async () => {
    bindCheckpointEnvironment({});
    const missing = await revertCheckpoint(999);
    expect(missing.ok).toBe(false);
    expect(missing.message).toContain('No checkpoint');

    recordCheckpoint({ path: 'a.ts', priorContent: 'x', tool: 'fs_write_file' });
    const noWriter = await revertCheckpoint(1);
    expect(noWriter.ok).toBe(false);
    expect(noWriter.message).toContain('writer');
  });

  it('/rewind lists checkpoints with intent and restores by id', async () => {
    const writes: Array<{ path: string; content: string }> = [];
    bindCheckpointEnvironment({
      fs: {
        exists: async () => true,
        readFileContent: async () => ({ content: 'NOW', type: 'text', totalChars: 3 }),
        readdir: async () => [],
        workspaceRootName: 'ws',
      },
      writer: { writeFile: async (p: string, c: string) => { writes.push({ path: p, content: c }); }, isPathAllowed: () => true },
    });
    recordCheckpoint({ path: 'notes.md', priorContent: 'BEFORE', tool: 'fs_edit_file', intent: 'Tighten the summary' });

    const list = fakeResponse();
    expect(await tryHandleOpenclawRewindCommand('rewind', '', list.response)).toBe(true);
    expect(list.text()).toContain('#1');
    expect(list.text()).toContain('notes.md');
    expect(list.text()).toContain('Tighten the summary');

    const restore = fakeResponse();
    expect(await tryHandleOpenclawRewindCommand('rewind', '#1', restore.response)).toBe(true);
    expect(writes).toEqual([{ path: 'notes.md', content: 'BEFORE' }]);
    expect(restore.text()).toContain('Restored');

    expect(await tryHandleOpenclawRewindCommand('other', '', fakeResponse().response)).toBe(false);
  });
});
