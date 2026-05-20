// appCommandTools.ts — M70 App Command Control
//
// Two thin tools that let the AI act on the workbench command palette
// without exploding the prompt with 70+ tool definitions:
//
//   app__find_commands  (green) — fuzzy search over opt-in commands
//   app__run_command    (blue)  — execute by ID, with denylist + opt-in check
//
// The denylist (M70_EXCLUDED_COMMANDS) is enforced at run time *before*
// `aiInvocable` is consulted, so a contributor mistake (setting
// aiInvocable on an excluded id) does not bypass policy. See
// docs/Parallx_Milestone_70.md and docs/M70_DEDUP_AUDIT.md.

import type {
  IChatTool,
  ICancellationToken,
  IToolResult,
} from '../../../services/chatTypes.js';
import type {
  ICommandRegistry,
  ICommandServiceShape,
} from '../../../commands/commandTypes.js';
import {
  findAIInvocableCommands,
  isCommandAIInvocable,
  isCommandExcludedForAI,
} from '../../../commands/m70CommandPolicy.js';

function ok(payload: Record<string, unknown>): IToolResult {
  return { content: JSON.stringify({ ok: true, ...payload }) };
}

function fail(message: string): IToolResult {
  return { content: JSON.stringify({ ok: false, error: message }), isError: true };
}

function readString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function readNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

// ─── app__find_commands ────────────────────────────────────────────────────

export function createAppFindCommandsTool(
  registry: Pick<ICommandRegistry, 'getCommands'> | undefined,
): IChatTool {
  return {
    name: 'app__find_commands',
    displaySummary: 'Find Parallx app commands by description.',
    description:
      'Search the Parallx workbench command registry for commands matching ' +
      'a natural-language query. Returns up to 5 candidate commands with their ' +
      'IDs and capability descriptions. Call this ONLY when the user is ' +
      'explicitly asking to do something TO the Parallx application — change a ' +
      'setting, open a view, activate a tool, switch a theme. Do NOT call this ' +
      'for file operations, code tasks, or data queries — those have their own ' +
      'dedicated tools.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Natural-language description of the desired action (e.g. "switch to dark theme", "open workspace graph").',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results (default 5, capped at 10).',
        },
      },
      required: ['query'],
    },
    requiresConfirmation: false,
    permissionLevel: 'always-allowed',
    source: 'built-in',
    handler: async (args: Record<string, unknown>, _token: ICancellationToken): Promise<IToolResult> => {
      if (!registry) return fail('command registry unavailable');
      const query = readString(args.query) ?? '';
      const limitArg = readNumber(args.limit);
      const limit = limitArg !== undefined
        ? Math.max(1, Math.min(10, Math.floor(limitArg)))
        : 5;
      const results = findAIInvocableCommands(registry, query, limit);
      return ok({
        results: results.map(r => ({
          id: r.id,
          title: r.title,
          description: r.aiDescription,
          category: r.category,
        })),
        returned: results.length,
      });
    },
  };
}

// ─── app__run_command ──────────────────────────────────────────────────────

export function createAppRunCommandTool(
  commandService: ICommandServiceShape | undefined,
): IChatTool {
  return {
    name: 'app__run_command',
    displaySummary: 'Run a Parallx app command by ID.',
    description:
      'Execute a Parallx workbench command by its exact ID. The ID must come ' +
      'from a prior `app__find_commands` call — never invent one. The command ' +
      'is validated against the opt-in registry and the M70 denylist before it ' +
      'runs; a refusal returns a structured error you can relay to the user.',
    parameters: {
      type: 'object',
      properties: {
        commandId: {
          type: 'string',
          description: 'Exact command ID returned by `app__find_commands` (e.g. "workbench.action.toggleSidebar").',
        },
        arg: {
          type: 'string',
          description: 'Optional single string argument. Only valid for the small set of single-string-arg opt-in commands.',
        },
      },
      required: ['commandId'],
    },
    requiresConfirmation: false,
    // Color gate (BLUE) is enforced separately in openclawToolPolicy.ts —
    // we leave the default permission level so the user's permission settings
    // (always-allowed / requires-approval / never-allowed) still apply.
    permissionLevel: 'always-allowed',
    source: 'built-in',
    handler: async (args: Record<string, unknown>, _token: ICancellationToken): Promise<IToolResult> => {
      if (!commandService) return fail('command service unavailable');

      const commandId = readString(args.commandId);
      if (!commandId) return fail('commandId is required');

      // Gate 2 — hardcoded denylist always wins, even over aiInvocable.
      if (isCommandExcludedForAI(commandId)) {
        return fail(`Command "${commandId}" is excluded from AI invocation by policy.`);
      }

      const descriptor = commandService.getCommand(commandId);
      if (!descriptor) {
        return fail(`Unknown command "${commandId}". Use app__find_commands to discover valid IDs.`);
      }

      // Gate 1 — opt-in registry. The descriptor must declare aiInvocable.
      if (!isCommandAIInvocable(descriptor)) {
        return fail(`Command "${commandId}" is not opted in for AI invocation.`);
      }

      const arg = readString(args.arg);
      try {
        const result = arg !== undefined
          ? await commandService.executeCommand(commandId, arg)
          : await commandService.executeCommand(commandId);
        return ok({
          commandId,
          executed: true,
          // Result is forwarded only if it's a primitive — command return
          // values are often UI handles or DOM nodes that don't serialize.
          result: _safeResult(result),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return fail(`Command "${commandId}" failed: ${msg}`);
      }
    },
  };
}

function _safeResult(v: unknown): unknown {
  if (v === undefined || v === null) return null;
  const t = typeof v;
  if (t === 'string' || t === 'number' || t === 'boolean') return v;
  return null;
}
