import { isChatImageAttachment } from '../../../services/chatTypes.js';
import type {
  IChatAttachment,
  IChatMessage,
  IChatRequestResponsePair,
} from '../../../services/chatTypes.js';
import { flattenPairsToMessages } from '../../../openclaw/participants/openclawParticipantRuntime.js';

/**
 * Seed messages for a runtime-prompt turn: system prompt + the session's
 * history through the ONE flattener (tool exchanges preserved, thinking
 * parts excluded). Review fix 2026-09-02: this file carried a private copy
 * of the retired duck-typed flattener, so every rail seeding through it
 * still forgot its tools and replayed its reasoning.
 */
export function buildRuntimePromptSeedMessages(options: {
  systemPrompt: string;
  history?: readonly IChatRequestResponsePair[];
}): IChatMessage[] {
  return [
    { role: 'system', content: options.systemPrompt },
    ...flattenPairsToMessages(options.history ?? []),
  ];
}

export function buildRuntimePromptEnvelopeMessages(options: {
  seedMessages: readonly IChatMessage[];
  userContent: string;
  attachments?: readonly IChatAttachment[];
}): IChatMessage[] {
  return [
    ...options.seedMessages,
    {
      role: 'user',
      content: options.userContent,
      images: options.attachments?.filter(isChatImageAttachment),
    },
  ];
}
