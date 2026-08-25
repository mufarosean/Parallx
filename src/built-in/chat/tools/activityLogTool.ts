// activityLogTool.ts — read-only access to the Activity Journal.
//
// The journal is the app's common activity language: a timeline of what the
// user (and the assistant) actually did — opened this PDF, created that
// canvas page, ran this command, asked that question. This tool lets the
// model reconstruct "what was the user doing?" on demand: diagnosing an
// error report, grounding an autonomous run, or answering "what did I work
// on this morning?".
//
// Scope: strictly read-only, always allowed.

import type {
  IChatTool,
  ICancellationToken,
  IToolResult,
} from '../../../services/chatTypes.js';
import type { IActivityJournalService } from '../../../services/activityJournalService.js';

function optStr(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

export function createActivityLogTool(journal: IActivityJournalService | undefined): IChatTool {
  return {
    name: 'activity_log',
    displaySummary: 'Read the user-activity timeline.',
    description: 'Read the app activity journal: a timeline of what the user (and assistant) did — editors opened, pages edited, commands run, questions asked. Returns structured events {time, actor, verb, object, detail?, source, ref?, count}; filter by actor/verb/source/ref for targeted questions ("what did the user edit?", "which tools failed?").',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max events, newest kept (default 60, max 500).' },
        sinceMinutes: { type: 'number', description: 'Only events from the last N minutes.' },
        actor: { type: 'string', description: 'Exact actor filter: "user", "ai", "system", or "ext:<toolId>".' },
        verb: { type: 'string', description: 'Exact verb filter, e.g. "edited", "ran", "opened", "tool failed".' },
        source: { type: 'string', description: 'Exact source filter: which tap produced the event, e.g. "editor", "command", "surface", "settings", "canvas".' },
        ref: { type: 'string', description: 'Exact ref filter: the stable object identity, e.g. "page:<id>".' },
      },
    },
    requiresConfirmation: false,
    permissionLevel: 'always-allowed',
    category: 'autonomy',
    source: 'built-in',
    handler: async (args: Record<string, unknown>, _token: ICancellationToken): Promise<IToolResult> => {
      if (!journal) {
        return { content: JSON.stringify({ ok: false, error: 'activity journal unavailable' }), isError: true };
      }
      const limit = typeof args.limit === 'number' && Number.isFinite(args.limit)
        ? Math.max(1, Math.min(500, Math.floor(args.limit)))
        : 60;
      const sinceMinutes = typeof args.sinceMinutes === 'number' && Number.isFinite(args.sinceMinutes)
        ? Math.max(1, args.sinceMinutes)
        : undefined;
      const sinceTs = sinceMinutes ? Date.now() - sinceMinutes * 60_000 : undefined;
      const events = await journal.query({
        limit, sinceTs,
        actor: optStr(args.actor),
        verb: optStr(args.verb),
        source: optStr(args.source),
        ref: optStr(args.ref),
      });
      // Structured objects, not prose (Phase B): the model filters and joins
      // on fields instead of regexing a rendered line.
      return {
        content: JSON.stringify({
          ok: true,
          returned: events.length,
          events: events.map((e) => ({
            time: new Date(e.ts).toISOString(),
            actor: e.actor,
            verb: e.verb,
            object: e.object,
            ...(e.detail ? { detail: e.detail } : {}),
            source: e.source,
            ...(e.ref ? { ref: e.ref } : {}),
            ...(e.count > 1 ? { count: e.count } : {}),
          })),
        }),
      };
    },
  };
}
