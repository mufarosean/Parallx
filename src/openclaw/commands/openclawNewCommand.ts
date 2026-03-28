// D2: /new command — Start a new conversation
// Upstream: src/commands/session.ts — session lifecycle management

import type { IChatResponseStream } from '../../services/chatTypes.js';
import type { IDefaultParticipantServices } from '../openclawTypes.js';
import { THINK_SESSION_FLAG } from './openclawThinkCommand.js';
import { VERBOSE_SESSION_FLAG } from './openclawVerboseCommand.js';

export async function tryHandleOpenclawNewCommand(
  services: IDefaultParticipantServices,
  command: string | undefined,
  response: IChatResponseStream,
): Promise<boolean> {
  if (command !== 'new') return false;

  // Clear session-scoped flags before starting new session
  if (services.setSessionFlag) {
    services.setSessionFlag(THINK_SESSION_FLAG, false);
    services.setSessionFlag(VERBOSE_SESSION_FLAG, false);
  }

  // Bridge to widget-layer session creation via executeCommand
  if (services.executeCommand) {
    response.markdown('Starting new conversation...');
    services.executeCommand('chat.clearSession');
    return true;
  }

  response.markdown('⚠️ New session command is not available in this context.');
  return true;
}
