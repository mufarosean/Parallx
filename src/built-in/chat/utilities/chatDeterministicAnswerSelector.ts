import type { IChatTurnRoute } from '../chatTypes.js';
import {
  buildDirectMemoryRecallAnswer,
  buildUnsupportedSpecificCoverageAnswer,
} from './chatDeterministicExecutors.js';

export interface IDeterministicAnswerSelection {
  readonly markdown: string;
  readonly phase:
    | 'product-semantics-direct-answer'
    | 'off-topic-direct-answer'
    | 'memory-recall-direct-answer'
    | 'unsupported-specific-coverage-direct-answer';
  readonly retrievedContextLength: number;
}

export function selectDeterministicAnswer(options: {
  route: IChatTurnRoute;
  memoryContext?: string;
  query?: string;
  evidenceAssessment?: { status: 'sufficient' | 'weak' | 'insufficient'; reasons: string[] };
  retrievedContextText?: string;
}): IDeterministicAnswerSelection | undefined {
  if (options.route.directAnswer) {
    return {
      markdown: options.route.directAnswer,
      phase: options.route.kind === 'product-semantics'
        ? 'product-semantics-direct-answer'
        : 'off-topic-direct-answer',
      retrievedContextLength: 0,
    };
  }

  if (options.query && options.evidenceAssessment) {
    const unsupportedSpecificCoverageAnswer = buildUnsupportedSpecificCoverageAnswer(
      options.query,
      options.evidenceAssessment,
    );
    if (unsupportedSpecificCoverageAnswer) {
      return {
        markdown: unsupportedSpecificCoverageAnswer,
        phase: 'unsupported-specific-coverage-direct-answer',
        retrievedContextLength: options.retrievedContextText?.length ?? 0,
      };
    }
  }

  if (options.route.kind === 'memory-recall' && options.memoryContext) {
    const directMemoryAnswer = buildDirectMemoryRecallAnswer(options.memoryContext);
    if (directMemoryAnswer) {
      return {
        markdown: directMemoryAnswer,
        phase: 'memory-recall-direct-answer',
        retrievedContextLength: 0,
      };
    }
  }

  return undefined;
}