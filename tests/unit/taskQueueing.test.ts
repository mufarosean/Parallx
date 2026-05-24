/**
 * M81 Slice C — Task Queueing characterization.
 *
 * Closes the §22 debt for `taskQueueing.test.ts` promised in
 * `docs/Parallx_Milestone_81.md`. Per the 2026-05-23 audit ruling
 * (`docs/research/M81_SLICE_C_AUDIT.md`), TaskService is CLOSED with no
 * consumer in code. The audit's exact wording: "Background work is
 * coordinated per-service via cooperative yields (`setTimeout(0)` in
 * `indexingPipeline`, queue+drain+yield in `semanticGraphService`,
 * `CronService`, `HeartbeatRunner`, autonomy feature flags). Manifest §11
 * forbids speculative services. Build the day a measured stall regression
 * appears that cooperative yields cannot solve — not before."
 *
 * This file is the anti-bitrot guard. If a future change quietly introduces
 * a parallel `TaskService` / `ITaskService` / `TaskQueue` abstraction,
 * these assertions fail, forcing the change to be a deliberate milestone
 * decision and to come with measured-stall evidence.
 */

import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

const SRC_ROOT = path.resolve(process.cwd(), 'src');

/**
 * Recursive walk over `src/` returning every `.ts` file. Skipped folders
 * are kept narrow — declaration files and `__tests__` folders are not
 * production surface.
 */
async function* walkTypeScript(root: string): AsyncGenerator<string> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
      yield* walkTypeScript(full);
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      yield full;
    }
  }
}

describe('M81 Slice C — task queueing (closed; anti-bitrot guard)', () => {
  it('src/ contains no TaskService / ITaskService / TaskQueue surface', async () => {
    // Forbidden identifiers — each is an explicit refusal from the
    // 2026-05-23 audit. If any of these appears, the speculative service
    // has been reintroduced without a milestone decision.
    const forbidden = /\b(ITaskService|TaskService|TaskQueue|IBackgroundTaskQueue|BackgroundTaskQueue)\b/;
    const hits: Array<{ file: string; line: number; text: string }> = [];
    for await (const file of walkTypeScript(SRC_ROOT)) {
      const content = await fs.readFile(file, 'utf8');
      if (!forbidden.test(content)) continue;
      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (forbidden.test(lines[i])) {
          hits.push({
            file: path.relative(process.cwd(), file),
            line: i + 1,
            text: lines[i].trim(),
          });
        }
      }
    }
    expect(hits, `Forbidden TaskService surface reintroduced:\n${hits.map(h => `  ${h.file}:${h.line}  ${h.text}`).join('\n')}`).toEqual([]);
  });

  it('src/services/ does not contain a taskService.ts module', async () => {
    const candidate = path.resolve(SRC_ROOT, 'services', 'taskService.ts');
    const stat = await fs.stat(candidate).catch(() => null);
    expect(stat).toBeNull();
  });

  it('cooperative yield primitives are still in place (replaces TaskQueue)', async () => {
    // The audit named these surfaces as the actual queue-free coordinators:
    //   - indexingPipeline: setTimeout(0) yields
    //   - semanticGraphService: queue+drain+yield
    //   - cronService
    //   - heartbeatRunner
    // We don't pin exact line counts (those legitimately change), only the
    // file existence — they MUST remain the cooperative-yield substrate
    // unless an explicit TaskQueue milestone is opened.
    const required = [
      'src/services/indexingPipeline.ts',
      'src/services/semanticGraphService.ts',
      'src/openclaw/openclawHeartbeatRunner.ts',
    ];
    for (const rel of required) {
      const stat = await fs.stat(path.resolve(process.cwd(), rel)).catch(() => null);
      expect(stat?.isFile(), `Cooperative-yield substrate missing: ${rel}`).toBe(true);
    }
  });
});
