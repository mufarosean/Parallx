// D2: /think command — Toggle extended thinking mode for this session
// Upstream: src/commands/think.ts — thinking/reasoning mode control

import type { IChatResponseStream } from '../../services/chatTypes.js';
import type { IDefaultParticipantServices } from '../openclawTypes.js';

export const THINK_SESSION_FLAG = 'openclaw.thinkingEnabled';

export async function tryHandleOpenclawThinkCommand(
  services: IDefaultParticipantServices,
  command: string | undefined,
  response: IChatResponseStream,
): Promise<boolean> {
  if (command !== 'think') return false;

  const current = services.getSessionFlag?.(THINK_SESSION_FLAG) ?? false;
  const next = !current;

  if (services.setSessionFlag) {
    services.setSessionFlag(THINK_SESSION_FLAG, next);
    response.markdown(
      next
        ? '🧠 **Thinking mode enabled.** The model will show its reasoning process for subsequent messages in this session.'
        : '💬 **Thinking mode disabled.** Returning to standard response mode.',
    );
  } else {
    response.markdown('⚠️ Session flag storage is not available. Thinking mode cannot be toggled.');
  }

  return true;
}
