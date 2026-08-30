// /rewind — HARNESS.md §2.2: recovery over permission.
//
// Lists the file checkpoints captured by the write tools this app run and
// restores one on request. Upstream pattern: Claude Code's /rewind restores
// checkpointed file state. Canvas pages have their own DB revisions; this
// command covers workspace FILES.
//
//   /rewind          — list recent checkpoints
//   /rewind last     — restore the most recent checkpoint
//   /rewind <id>     — restore checkpoint #id

import type { IChatResponseStream } from '../../services/chatTypes.js';
import {
  listCheckpoints,
  latestCheckpoint,
  revertCheckpoint,
} from '../../built-in/chat/tools/fileCheckpoints.js';

export async function tryHandleOpenclawRewindCommand(
  command: string | undefined,
  argText: string | undefined,
  response: IChatResponseStream,
): Promise<boolean> {
  if (command !== 'rewind') return false;

  const arg = (argText ?? '').trim();

  if (!arg) {
    const entries = listCheckpoints(10);
    if (entries.length === 0) {
      response.markdown('No file checkpoints yet. Checkpoints are captured automatically before every file write, edit, or delete, and last for this app run.');
      return true;
    }
    const lines = entries.map((e) => {
      const when = new Date(e.at).toLocaleTimeString();
      const kind = e.priorContent === null ? 'created' : e.tool === 'fs_delete_file' ? 'deleted' : 'modified';
      const intent = e.intent ? ` — ${e.intent}` : '';
      return `- **#${e.id}** ${when} · \`${e.path}\` ${kind} by ${e.tool}${intent}`;
    });
    response.markdown([
      '**File Checkpoints** (newest first; this app run)',
      '',
      ...lines,
      '',
      'Restore with `/rewind <id>` or `/rewind last`.',
    ].join('\n'));
    return true;
  }

  let id: number | undefined;
  if (arg === 'last') {
    id = latestCheckpoint()?.id;
    if (id === undefined) {
      response.markdown('No file checkpoints yet — nothing to restore.');
      return true;
    }
  } else {
    const parsed = Number.parseInt(arg.replace(/^#/, ''), 10);
    if (Number.isNaN(parsed)) {
      response.markdown(`Unrecognized argument \`${arg}\`. Use \`/rewind\`, \`/rewind last\`, or \`/rewind <id>\`.`);
      return true;
    }
    id = parsed;
  }

  const result = await revertCheckpoint(id);
  response.markdown(result.ok ? `✓ ${result.message}` : `Could not rewind: ${result.message}`);
  return true;
}
