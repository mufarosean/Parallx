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
    displaySummary: 'Delegate a self-contained task to an isolated subagent.',
    description: 'Delegate a self-contained task to a subagent that runs in its OWN isolated session and returns only its final answer. '
      + 'Use it to keep your context lean: bulk work whose intermediate output would flood this conversation — sweeping many files, digesting a long document, researching a side question — comes back as one distilled result instead of raw dumps. '
      + 'The subagent starts FRESH: it shares none of this conversation, so the task prompt must be fully self-contained (include paths/page titles, constraints, and the exact shape of the answer you want back). '
      + 'Do not use it for trivial single-tool work (just call the tool), and treat its answer as a report to verify, not ground truth. '
      + 'Each spawn is a real model run; on a user-initiated turn it runs without a prompt (the user\'s gesture is the approval), autonomous turns stay gated. '
      + 'Prefer profile "reader" for research and digestion — it runs read-only. Max depth 1 — subagents cannot spawn further subagents.',
    parameters: {
      type: 'object',
      required: ['task'],
      properties: {
        task: {
          type: 'string',
          description: 'Task prompt.',
        },
        label: {
          type: 'string',
          description: 'Short label.',
        },
        model: {
          type: 'string',
          description: 'Model override (defaults to parent model).',
        },
        profile: {
          type: 'string',
          enum: ['reader', 'worker'],
          description: 'reader = read-only tools (research, digest — default choice); worker = reads + safe writes, no shell.',
        },
        tools: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional tool-name allowlist; the subagent sees only these tools.',
        },
        timeoutMs: {
          type: 'number',
          description: 'Timeout in ms.',
        },
      },
    },
    requiresConfirmation: true,
    permissionLevel: subagentToolPermissionLevel(name),
    category: 'subagent',
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

      // HARNESS.md §4.1 — the M59 debt, paid: the allowlist and typed
      // profile flow through the spawner into the ephemeral session's tool
      // policy (enforced by the default participant's tool state).
      const tools = readStringArray(args.tools);
      const profileRaw = readString(args.profile);
      const profile = profileRaw === 'reader' || profileRaw === 'worker' ? profileRaw : undefined;

      const result = await spawner.spawn({
        task,
        label,
        model,
        runTimeoutSeconds,
        callerDepth,
        profile,
        tools: tools && tools.length > 0 ? tools : undefined,
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
