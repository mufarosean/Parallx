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
import { renderActivityLine } from '../../../services/activityJournalService.js';

export function createActivityLogTool(journal: IActivityJournalService | undefined): IChatTool {
  return {
    name: 'activity_log',
    displaySummary: 'Read the user-activity timeline.',
    description: 'Read the app activity journal: a human-readable timeline of what the user (and assistant) did — editors opened, pages edited, commands run, questions asked. Use it to understand recent context or diagnose what led up to a problem.',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max events, newest kept (default 60, max 500).' },
        sinceMinutes: { type: 'number', description: 'Only events from the last N minutes.' },
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
      const events = await journal.query({ limit, sinceTs });
      return {
        content: JSON.stringify({
          ok: true,
          returned: events.length,
          timeline: events.map(renderActivityLine),
        }),
      };
    },
  };
}
