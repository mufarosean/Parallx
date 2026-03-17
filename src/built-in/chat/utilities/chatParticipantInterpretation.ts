import type { IChatParticipantRequest } from '../../../services/chatTypes.js';
import type { ChatParticipantSurface, IChatParticipantInterpretation } from '../chatTypes.js';
import { analyzeChatTurnSemantics } from './chatTurnSemantics.js';

export function interpretChatParticipantRequest(
  surface: ChatParticipantSurface,
  request: IChatParticipantRequest,
): IChatParticipantInterpretation {
  const providedInterpretation = request.interpretation;
  const effectiveText = providedInterpretation?.effectiveText ?? request.text.trim();
  const commandName = request.command?.trim() || providedInterpretation?.commandName || undefined;
  const hasExplicitCommand = providedInterpretation?.hasExplicitCommand ?? !!commandName;

  return {
    surface: providedInterpretation?.surface ?? surface,
    rawText: providedInterpretation?.rawText ?? request.text,
    effectiveText,
    commandName,
    hasExplicitCommand,
    kind: providedInterpretation?.kind ?? (hasExplicitCommand ? 'command' : 'message'),
    semantics: providedInterpretation?.semantics ?? analyzeChatTurnSemantics(effectiveText),
  };
}