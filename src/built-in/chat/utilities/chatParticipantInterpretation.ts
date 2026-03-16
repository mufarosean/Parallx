import type { IChatParticipantRequest } from '../../../services/chatTypes.js';
import type { ChatParticipantSurface, IChatParticipantInterpretation } from '../chatTypes.js';
import { analyzeChatTurnSemantics } from './chatTurnSemantics.js';

export function interpretChatParticipantRequest(
  surface: ChatParticipantSurface,
  request: IChatParticipantRequest,
): IChatParticipantInterpretation {
  const effectiveText = request.text.trim();
  const commandName = request.command?.trim() || undefined;
  const hasExplicitCommand = !!commandName;

  return {
    surface,
    rawText: request.text,
    effectiveText,
    commandName,
    hasExplicitCommand,
    kind: hasExplicitCommand ? 'command' : 'message',
    semantics: analyzeChatTurnSemantics(effectiveText),
  };
}