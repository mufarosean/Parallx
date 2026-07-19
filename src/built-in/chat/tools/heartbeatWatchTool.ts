// heartbeatWatchTool.ts — M87 S2: "watch this for me" as a real gesture.
//
// One tool, three actions over the `## Watch` section of
// .parallx/HEARTBEAT.md (the heartbeat's purpose file — see
// src/openclaw/heartbeatPurpose.ts for the format and semantics):
//
//   list   — current standing watches
//   add    — append a watch line (idempotent on duplicates)
//   remove — delete watches whose text contains a substring
//
// File IO is injected (workspace-relative read/write/exists) so the tool is
// fully testable headlessly and stays decoupled from the fs service shape.

import type {
  IChatTool,
  ICancellationToken,
  IToolResult,
  ToolPermissionLevel,
} from '../../../services/chatTypes.js';
import {
  HEARTBEAT_PURPOSE_PATH,
  HEARTBEAT_PURPOSE_TEMPLATE,
  addWatch,
  parseHeartbeatPurpose,
  removeWatch,
} from '../../../openclaw/heartbeatPurpose.js';

export interface IHeartbeatWatchFileAccess {
  readFile(relativePath: string): Promise<string | null>;
  writeFile(relativePath: string, content: string): Promise<void>;
}

function ok(payload: unknown): IToolResult {
  return { content: JSON.stringify(payload) };
}
function err(message: string): IToolResult {
  return { content: message, isError: true };
}

export function createHeartbeatWatchTool(files: IHeartbeatWatchFileAccess): IChatTool {
  return {
    name: 'heartbeat_watch',
    displaySummary: 'Manage the heartbeat\'s standing watches.',
    description:
      'Manage the standing watches in .parallx/HEARTBEAT.md — the concerns the background heartbeat checks on every review. '
      + 'Use action="add" when the user asks you to keep an eye on something over time ("watch this for me", "remind me if X ever happens"); '
      + 'action="remove" (with `match`) when a watch is no longer wanted; action="list" to show current watches. '
      + 'Watches are free-text sentences; write them as testable conditions (e.g. "Warn me if the Exam 7 page has not been edited for a week").',
    parameters: {
      type: 'object',
      required: ['action'],
      properties: {
        action: { type: 'string', enum: ['list', 'add', 'remove'] },
        watch: { type: 'string', description: '(add) The watch sentence to append.' },
        match: { type: 'string', description: '(remove) Case-insensitive substring — every watch containing it is removed.' },
      },
    },
    requiresConfirmation: false,
    permissionLevel: 'always-allowed' as ToolPermissionLevel,
    category: 'autonomy',
    source: 'built-in',
    handler: async (args: Record<string, unknown>, _token: ICancellationToken): Promise<IToolResult> => {
      const action = typeof args.action === 'string' ? args.action : '';
      let content: string | null;
      try {
        content = await files.readFile(HEARTBEAT_PURPOSE_PATH);
      } catch {
        content = null;
      }
      const current = content ?? HEARTBEAT_PURPOSE_TEMPLATE;

      if (action === 'list') {
        return ok({ watches: parseHeartbeatPurpose(current).watches, path: HEARTBEAT_PURPOSE_PATH });
      }

      if (action === 'add') {
        const watch = typeof args.watch === 'string' ? args.watch.trim() : '';
        if (!watch) return err('add requires a non-empty `watch`.');
        const next = addWatch(current, watch);
        if (next === current) {
          return ok({ added: false, reason: 'duplicate', watches: parseHeartbeatPurpose(current).watches });
        }
        try {
          await files.writeFile(HEARTBEAT_PURPOSE_PATH, next);
        } catch (e) {
          return err(`Could not write ${HEARTBEAT_PURPOSE_PATH}: ${e instanceof Error ? e.message : String(e)}`);
        }
        return ok({ added: true, watches: parseHeartbeatPurpose(next).watches });
      }

      if (action === 'remove') {
        const match = typeof args.match === 'string' ? args.match.trim() : '';
        if (!match) return err('remove requires a non-empty `match`.');
        const { content: next, removed } = removeWatch(current, match);
        if (removed === 0) {
          return ok({ removed: 0, watches: parseHeartbeatPurpose(current).watches });
        }
        try {
          await files.writeFile(HEARTBEAT_PURPOSE_PATH, next);
        } catch (e) {
          return err(`Could not write ${HEARTBEAT_PURPOSE_PATH}: ${e instanceof Error ? e.message : String(e)}`);
        }
        return ok({ removed, watches: parseHeartbeatPurpose(next).watches });
      }

      return err(`Unknown action: ${action}. Use list | add | remove.`);
    },
  };
}
