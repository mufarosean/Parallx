import type { IUnifiedAIConfig } from '../aiSettings/unifiedConfigTypes.js';

export const DEFAULT_CHAT_PARTICIPANT_ID = 'parallx.chat.default';
export const OPENCLAW_DEFAULT_PARTICIPANT_ID = 'parallx.chat.openclaw-default';

/**
 * Resolves the active runtime participant ID. Non-default participants
 * pass through unchanged. The default participant maps to OpenClaw.
 */
export function resolveChatRuntimeParticipantId(
  participantId: string,
  _getConfig?: () => IUnifiedAIConfig | undefined,
): string {
  if (participantId !== DEFAULT_CHAT_PARTICIPANT_ID) {
    return participantId;
  }
  return OPENCLAW_DEFAULT_PARTICIPANT_ID;
}