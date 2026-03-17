import type { IChatTurnRoute } from '../chatTypes.js';
import {
  buildDeterministicGroundedBooksAnswer,
  buildDirectMemoryRecallAnswer,
  buildDeterministicWorkflowAnswer,
  buildUnsupportedSpecificCoverageAnswer,
  buildUnsupportedWorkspaceTopicAnswer,
} from './chatDeterministicExecutors.js';

export interface IDeterministicAnswerSelection {
  readonly markdown: string;
  readonly phase:
    | 'product-semantics-direct-answer'
    | 'off-topic-direct-answer'
    | 'memory-recall-direct-answer'
    | 'deterministic-grounded-books-direct-answer'
    | 'deterministic-workflow-direct-answer'
    | 'unsupported-specific-coverage-direct-answer'
    | 'unsupported-workspace-topic-direct-answer';
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
    const deterministicGroundedBooksAnswer = buildDeterministicGroundedBooksAnswer(
      options.query,
      options.retrievedContextText ?? '',
    );
    if (deterministicGroundedBooksAnswer) {
      return {
        markdown: deterministicGroundedBooksAnswer,
        phase: 'deterministic-grounded-books-direct-answer',
        retrievedContextLength: options.retrievedContextText?.length ?? 0,
      };
    }

    if (
      options.route.workflowType === 'folder-summary'
      || options.route.workflowType === 'comparative'
      || options.route.workflowType === 'exhaustive-extraction'
    ) {
      const deterministicWorkflowAnswer = buildDeterministicWorkflowAnswer(
        options.route.workflowType,
        options.query,
        options.retrievedContextText ?? '',
      );
      if (deterministicWorkflowAnswer) {
        return {
          markdown: deterministicWorkflowAnswer,
          phase: 'deterministic-workflow-direct-answer',
          retrievedContextLength: options.retrievedContextText?.length ?? 0,
        };
      }
    }

    const unsupportedWorkspaceTopicAnswer = buildUnsupportedWorkspaceTopicAnswer(
      options.query,
      options.retrievedContextText ?? '',
    );
    if (unsupportedWorkspaceTopicAnswer) {
      return {
        markdown: unsupportedWorkspaceTopicAnswer,
        phase: 'unsupported-workspace-topic-direct-answer',
        retrievedContextLength: options.retrievedContextText?.length ?? 0,
      };
    }

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