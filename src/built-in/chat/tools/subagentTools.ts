// subagentTools.ts — `sessions_spawn` chat tool (M58 W5)
//
// Upstream parity:
//   - sessions-spawn-tool.ts:1-212 @ github.com/openclaw/openclaw
//     Single tool, "run" mode: spawn an isolated subagent, wait for its
//     final response, return it to the caller as the tool result.
//
// Parallx adaptation:
//   - Backed by the audit-closed SubagentSpawner (D5 15/15 ALIGNED) wired to
//     the ephemeral-session substrate (M58 W5-A) via
//     createSubagentTurnExecutor.
//   - Always approval-gated via `subagentToolPermissionLevel` — no read-only
//     exemption. Spawning a subagent is privileged.
//   - Depth cap is hard-coded to 1 for M58: a subagent cannot spawn another
//     subagent. Enforced by
//     (a) `currentSubagentDepth() > 0` rejection at the tool handler, and
//     (b) `callerDepth >= maxDepth` rejection inside SubagentSpawner.
//     Belt-and-braces — (a) gives a clean error message without consuming
//     a registry slot; (b) is the structural guarantee.

import type {
  IChatTool,
  ICancellationToken,
  IToolResult,
} from '../../../services/chatTypes.js';
import type {
  SubagentSpawner,
} from '../../../openclaw/openclawSubagentSpawn.js';
import { currentSubagentDepth } from '../../../openclaw/openclawSubagentExecutor.js';
import { subagentToolPermissionLevel } from '../../../openclaw/openclawToolPolicy.js';

// ---------------------------------------------------------------------------
// Arg readers
// ---------------------------------------------------------------------------

function readString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function readNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function readStringArray(v: unknown): readonly string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: string[] = [];
  for (const entry of v) {
    if (typeof entry === 'string' && entry.length > 0) out.push(entry);
  }
  return out;
}

function failure(message: string): IToolResult {
  return { content: JSON.stringify({ ok: false, error: message }), isError: true };
}

function success(payload: Record<string, unknown>): IToolResult {
  return { content: JSON.stringify({ ok: true, ...payload }) };
}

// ---------------------------------------------------------------------------
// sessions_spawn
// ---------------------------------------------------------------------------

export function createSessionsSpawnTool(
  spawner: SubagentSpawner | undefined,
): IChatTool {
  const name = 'sessions_spawn';
  return {
    name,
    description:
      'Spawn an isolated subagent to handle a delegated task. The subagent ' +
      'runs in an ephemeral session with full tool access and returns its ' +
      'final assistant response. Requires user approval. Subagents cannot ' +
      'spawn further subagents (max depth 1).',
    parameters: {
      type: 'object',
      required: ['task'],
      properties: {
        task: {
          type: 'string',
          description: 'The task / prompt for the subagent to work on.',
        },
        label: {
          type: 'string',
          description: 'Human-readable short label for the sub-task.',
        },
        model: {
          type: 'string',
          description: 'Optional model override (e.g. "gpt-oss:20b"). Defaults to the parent session model.',
        },
        tools: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional tool allowlist. Currently informational (captured for M59).',
        },
        timeoutMs: {
          type: 'number',
          description: 'Subagent run timeout in milliseconds (applied via runTimeoutSeconds).',
        },
      },
    },
    requiresConfirmation: true,
    permissionLevel: subagentToolPermissionLevel(name),
    source: 'built-in',
    handler: async (args: Record<string, unknown>, _token: ICancellationToken): Promise<IToolResult> => {
      if (!spawner) {
        return failure('Subagent spawner not available');
      }
      const task = readString(args.task);
      if (!task) return failure('Missing required argument: task');

      // Depth cap: M58 hard-caps at 1. If this tool call originates from
      // inside a subagent turn, reject without consuming a run slot.
      const callerDepth = currentSubagentDepth();
      if (callerDepth > 0) {
        return failure(
          `Subagents may not spawn further subagents (max depth 1, caller at depth ${callerDepth}).`,
        );
      }

      const label = readString(args.label);
      const model = readString(args.model);
      const timeoutMs = readNumber(args.timeoutMs);
      const runTimeoutSeconds = timeoutMs !== undefined && timeoutMs > 0
        ? Math.ceil(timeoutMs / 1000)
        : undefined;

      // `tools` is captured but not yet enforced — M59 will wire
      // per-subagent tool allowlisting through the tool policy pipeline.
      readStringArray(args.tools);

      const result = await spawner.spawn({
        task,
        label,
        model,
        runTimeoutSeconds,
        callerDepth,
      });

      if (result.status !== 'completed') {
        return failure(result.error ?? `Subagent ${result.status}`);
      }

      return success({
        runId: result.runId,
        status: result.status,
        durationMs: result.durationMs,
        result: result.result,
      });
    },
  };
}

export const SUBAGENT_TOOL_NAMES = ['sessions_spawn'] as const;
