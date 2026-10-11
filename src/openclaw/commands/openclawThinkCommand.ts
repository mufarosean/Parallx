// D2: /think command — Turn the model's reasoning off or on for this session
// Upstream: src/commands/think.ts — thinking/reasoning mode control
//
// The model reasons before it answers by default. `/think` turns that off for
// the session (faster answers, no reasoning shown) and on again. `/new`
// returns to the default.

import type { IChatResponseStream } from '../../services/chatTypes.js';
import type { IDefaultParticipantServices } from '../openclawTypes.js';

/** Set while the session has reasoning turned off. Unset means the default (on). */
export const REASONING_OFF_SESSION_FLAG = 'openclaw.reasoningOff';

export async function tryHandleOpenclawThinkCommand(
  services: IDefaultParticipantServices,
  command: string | undefined,
  response: IChatResponseStream,
): Promise<boolean> {
  if (command !== 'think') return false;

  if (!services.setSessionFlag) {
    response.markdown('Warning: Session flag storage is not available. Reasoning cannot be turned off.');
    return true;
  }

  const off = !(services.getSessionFlag?.(REASONING_OFF_SESSION_FLAG) ?? false);
  services.setSessionFlag(REASONING_OFF_SESSION_FLAG, off);
  response.markdown(
    off
      ? '**Reasoning off.** The model answers directly for the rest of this session. Run `/think` again to turn it back on.'
      : '**Reasoning on.** The model reasons before it answers, and its reasoning is shown.',
  );
  return true;
}
