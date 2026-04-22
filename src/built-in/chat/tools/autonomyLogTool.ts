// autonomyLogTool.ts — read-only access to the Autonomy Log
//
// The chat-surface plugin used to push autonomous results directly into
// the user's transcript, which polluted the conversation. Results now
// land in a dedicated AutonomyLogService; this tool lets the agent read
// that log so it's aware of what heartbeat / cron / subagent runs
// produced while it wasn't on turn.
//
// Scope: read-only, free (no approval). Agents may mark entries read to
// prevent double-processing across turns — that's still a read-side
// mutation with no external side effects.

import type {
  IChatTool,
  ICancellationToken,
  IToolResult,
} from '../../../services/chatTypes.js';
import type {
  IAutonomyLogReader,
  AutonomyOrigin,
  IAutonomyLogEntry,
} from '../../../services/autonomyLogService.js';

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

function readBool(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined;
}

/**
 * Slim the entry before handing it to the model — raw metadata blobs can
 * be large and the model only needs a scannable view. The full content
 * markdown is preserved; metadata is truncated to a handful of
 * well-known fields.
 */
function summarize(entry: IAutonomyLogEntry): Record<string, unknown> {
  const md = (entry.metadata ?? {}) as Record<string, unknown>;
  const metaSummary: Record<string, unknown> = {};
  for (const k of ['reason', 'jobName', 'path', 'eventType']) {
    if (md[k] !== undefined) metaSummary[k] = md[k];
  }
  return {
    id: entry.id,
    timestamp: entry.timestamp,
    origin: entry.origin,
    requestText: entry.requestText,
    content: entry.content,
    meta: Object.keys(metaSummary).length > 0 ? metaSummary : undefined,
    read: entry.read,
  };
}

export function createAutonomyLogTool(log: IAutonomyLogReader | undefined): IChatTool {
  return {
    name: 'autonomy_log',
    description:
      'Read the autonomy log — results from heartbeat, cron, and subagent runs that happened while you were not on turn. Use this at the start of a turn if the user references background activity, or to catch up on events. Optional filters: origin ("heartbeat"|"cron"|"subagent"|"agent"), limit (default 50, max 200), onlyUnread. Pass markRead: true to mark returned entries as seen.',
    parameters: {
      type: 'object',
      properties: {
        origin: {
          type: 'string',
          description: 'Filter to a single origin ("heartbeat" | "cron" | "subagent" | "agent").',
        },
        limit: {
          type: 'number',
          description: 'Max entries to return (default 50, capped at 200).',
        },
        onlyUnread: {
          type: 'boolean',
          description: 'Return only entries not yet marked read.',
        },
        markRead: {
          type: 'boolean',
          description: 'Mark the returned entries as read after fetching them.',
        },
      },
    },
    requiresConfirmation: false,
    permissionLevel: 'always-allowed',
    source: 'built-in',
    handler: async (args: Record<string, unknown>, _token: ICancellationToken): Promise<IToolResult> => {
      if (!log) return fail('autonomy log service unavailable');

      const originArg = readString(args.origin) as AutonomyOrigin | undefined;
      const limitArg = readNumber(args.limit);
      const onlyUnread = readBool(args.onlyUnread) ?? false;
      const markRead = readBool(args.markRead) ?? false;

      const limit = limitArg !== undefined
        ? Math.max(1, Math.min(200, Math.floor(limitArg)))
        : 50;

      const entries = log.getEntries({ limit, origin: originArg, onlyUnread });
      const summaries = entries.map(summarize);
      const unreadCount = log.getUnreadCount();

      let marked = 0;
      if (markRead && entries.length > 0) {
        marked = log.markRead(entries.map((e) => e.id));
      }

      return ok({
        entries: summaries,
        returned: summaries.length,
        unreadCount: markRead ? Math.max(0, unreadCount - marked) : unreadCount,
        markedRead: marked,
      });
    },
  };
}
