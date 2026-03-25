import type { IUnifiedAIConfig } from '../aiSettings/unifiedConfigTypes.js';

export const DEFAULT_CHAT_PARTICIPANT_ID = 'parallx.chat.default';
export const LEGACY_COMPARE_PARTICIPANT_ID = 'parallx.chat.legacy-default';
export const OPENCLAW_DEFAULT_PARTICIPANT_ID = 'parallx.chat.openclaw-default';

export function resolveChatRuntimeParticipantId(
  participantId: string,
  getConfig?: () => IUnifiedAIConfig | undefined,
): string {
  if (participantId !== DEFAULT_CHAT_PARTICIPANT_ID) {
    return participantId;
  }

  const implementation = getConfig?.()?.runtime.implementation;
  if (implementation === 'openclaw') {
    return OPENCLAW_DEFAULT_PARTICIPANT_ID;
  }

  return DEFAULT_CHAT_PARTICIPANT_ID;
}