import type { IChatTurnRoute, IChatTurnSemantics } from '../chatTypes.js';
import { analyzeChatTurnSemantics } from './chatTurnSemantics.js';

export function determineChatTurnRoute(
  textOrSemantics: string | IChatTurnSemantics,
  options?: { hasActiveSlashCommand?: boolean },
): IChatTurnRoute {
  const semantics = typeof textOrSemantics === 'string'
    ? analyzeChatTurnSemantics(textOrSemantics)
    : textOrSemantics;

  if (options?.hasActiveSlashCommand) {
    return {
      kind: 'grounded',
      reason: 'Slash command is active, so automatic direct-answer routing is bypassed.',
    };
  }

  if (semantics.productSemanticsDirectAnswer) {
    return {
      kind: 'product-semantics',
      reason: 'Matched a product-semantics explanation that should bypass retrieval.',
      directAnswer: semantics.productSemanticsDirectAnswer,
    };
  }

  if (semantics.offTopicDirectAnswer) {
    return {
      kind: 'off-topic',
      reason: 'Matched an off-topic request pattern outside the workspace domain.',
      directAnswer: semantics.offTopicDirectAnswer,
    };
  }

  if (semantics.isExplicitTranscriptRecall) {
    return {
      kind: 'transcript-recall',
      reason: 'Explicit prior-session history should use transcript recall without generic retrieval.',
    };
  }

  if (semantics.isExplicitMemoryRecall) {
    return {
      kind: 'memory-recall',
      reason: 'Explicit prior-conversation recall should use memory without retrieval.',
    };
  }

  if (semantics.isConversational) {
    return {
      kind: 'conversational',
      reason: 'Short conversational turn should avoid workspace retrieval and tool priming.',
    };
  }

  if (semantics.isFileEnumeration) {
    return {
      kind: 'grounded',
      reason: 'File or directory enumeration question — use tools to list actual contents instead of relying on retrieved context.',
      coverageMode: semantics.groundedCoverageModeHint,
    };
  }

  return {
    kind: 'grounded',
    reason: semantics.groundedCoverageModeHint === 'exhaustive'
      ? 'This request needs exhaustive file-by-file coverage rather than representative retrieval.'
      : 'Default grounded route uses normal workspace-aware context planning.',
    coverageMode: semantics.groundedCoverageModeHint,
  };
}