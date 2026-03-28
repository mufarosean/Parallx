// D2: /verbose command — Toggle verbose debug output for this session
// Upstream: src/commands/verbose.ts — debug output control

import type { IChatResponseStream } from '../../services/chatTypes.js';
import type { IDefaultParticipantServices } from '../openclawTypes.js';

export const VERBOSE_SESSION_FLAG = 'openclaw.verboseEnabled';

export async function tryHandleOpenclawVerboseCommand(
  services: IDefaultParticipantServices,
  command: string | undefined,
  response: IChatResponseStream,
): Promise<boolean> {
  if (command !== 'verbose') return false;

  const current = services.getSessionFlag?.(VERBOSE_SESSION_FLAG) ?? false;
  const next = !current;

  if (services.setSessionFlag) {
    services.setSessionFlag(VERBOSE_SESSION_FLAG, next);
    response.markdown(
      next
        ? '🔍 **Verbose mode enabled.** Debug information will be shown for subsequent turns:\n'
          + '- Runtime trace (routing, context plan, retrieval)\n'
          + '- Token budget breakdown\n'
          + '- Tool invocation details\n'
          + '- Bootstrap file loading'
        : '🔇 **Verbose mode disabled.** Returning to standard output.',
    );
  } else {
    response.markdown('⚠️ Session flag storage is not available. Verbose mode cannot be toggled.');
  }

  return true;
}
