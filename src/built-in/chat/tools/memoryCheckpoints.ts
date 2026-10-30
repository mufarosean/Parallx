// memoryCheckpoints.ts — a memory write can be taken back with /rewind.
//
// The file tools checkpoint what they overwrite (fileCheckpointService.ts),
// but memory_write wrote USER.md, MEMORY.md, the daily log and lesson files
// with no way back short of editing them by hand. Wrapped here, it records
// the prior text of every file it changed (a lesson add touches the lesson
// and the index; a removal also writes the archived copy), so /rewind lists
// and restores them like any other write.

import type { IChatTool, IToolResult } from '../../../services/chatTypes.js';
import { recordCheckpoint } from '../../../services/fileCheckpointService.js';
import { appDayKey } from '../../../services/localTime.js';

const MEMORY_DIR = '.parallx/memory';

/** The workspace files a memory_write call may change. */
export function memoryWritePaths(args: Record<string, unknown>, today = appDayKey(new Date())): string[] {
  const index = `${MEMORY_DIR}/MEMORY.md`;
  switch (args['file']) {
    case 'USER': return ['.parallx/USER.md'];
    case 'MEMORY': return [index];
    case 'daily': {
      const date = typeof args['date'] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(args['date'].trim()) ? args['date'].trim() : today;
      return [`${MEMORY_DIR}/${date}.md`];
    }
    case 'lesson': {
      const slug = typeof args['slug'] === 'string' ? args['slug'].trim() : '';
      if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) return [];
      return [`${MEMORY_DIR}/lessons/${slug}.md`, index, `${MEMORY_DIR}/_archive/lessons/${slug}.md`];
    }
    default: return [];
  }
}

/** How the wrapper reads a workspace file; null when it does not exist. */
export type MemoryFileReader = (relativePath: string) => Promise<string | null>;

/** memory_write, checkpointing each file it changes. A failed checkpoint never blocks the write. */
export function withMemoryCheckpoints(tool: IChatTool, read: MemoryFileReader | undefined): IChatTool {
  if (!read) return tool;
  const readSafely = (p: string) => read(p).catch(() => undefined);
  return {
    ...tool,
    async handler(args, token, invocation): Promise<IToolResult> {
      const paths = memoryWritePaths(args);
      const before = await Promise.all(paths.map(readSafely));
      const result = await tool.handler(args, token, invocation);
      if (result.isError || !paths.length) return result;
      const ids: number[] = [];
      for (let i = 0; i < paths.length; i++) {
        const prior = before[i];
        if (prior === undefined) continue; // could not read it before: nothing to restore to
        const now = await readSafely(paths[i]);
        if (now === prior) continue;
        try {
          ids.push(recordCheckpoint({ path: paths[i], priorContent: prior, tool: 'memory_write', intent: typeof args['action'] === 'string' ? `${args['action']} ${String(args['file'] ?? '')}`.trim() : undefined }).id);
        } catch { /* over the checkpoint cap: the write stands without one */ }
      }
      if (!ids.length) return result;
      return { ...result, content: `${result.content} (checkpoint ${ids.map((id) => `#${id}`).join(', ')}; /rewind restores)` };
    },
  };
}
