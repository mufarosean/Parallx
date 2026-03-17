import type { ICancellationToken, IChatResponseStream } from '../../../services/chatTypes.js';
import type { IChatRuntimeTrace, IChatTurnRoute } from '../chatTypes.js';
import { createChatContextPlan, createChatRuntimeTrace } from './chatContextPlanner.js';
import { selectDeterministicAnswer } from './chatDeterministicAnswerSelector.js';
import { selectAttributableCitations } from './chatResponseParsingHelpers.js';

interface IChatResponseDebugReporter {
  (debug: {
    phase: string;
    markdownLength: number;
    yielded: boolean;
    cancelled: boolean;
    retrievedContextLength: number;
  }): void;
}

interface IChatRuntimeTraceReporter {
  (trace: IChatRuntimeTrace): void;
}

function emitDeterministicAnswer(options: {
  response: IChatResponseStream;
  token: ICancellationToken;
  markdown: string;
  phase: string;
  retrievedContextLength: number;
  reportResponseDebug?: IChatResponseDebugReporter;
}): void {
  options.response.markdown(options.markdown);
  options.reportResponseDebug?.({
    phase: options.phase,
    markdownLength: options.markdown.length,
    yielded: !!options.token.isYieldRequested,
    cancelled: options.token.isCancellationRequested,
    retrievedContextLength: options.retrievedContextLength,
  });
}

export function handleEarlyDeterministicAnswer(options: {
  route: IChatTurnRoute;
  hasActiveSlashCommand: boolean;
  isRagReady: boolean;
  sessionId: string;
  response: IChatResponseStream;
  token: ICancellationToken;
  reportRuntimeTrace?: IChatRuntimeTraceReporter;
  reportResponseDebug?: IChatResponseDebugReporter;
}): boolean {
  const deterministicAnswer = selectDeterministicAnswer({ route: options.route });
  if (!deterministicAnswer) {
    return false;
  }

  const contextPlan = createChatContextPlan(options.route, {
    hasActiveSlashCommand: options.hasActiveSlashCommand,
    isRagReady: options.isRagReady,
  });

  options.reportRuntimeTrace?.(createChatRuntimeTrace(
    options.route,
    contextPlan,
    {
      sessionId: options.sessionId,
      hasActiveSlashCommand: options.hasActiveSlashCommand,
      isRagReady: options.isRagReady,
    },
  ));

  emitDeterministicAnswer({
    response: options.response,
    token: options.token,
    markdown: deterministicAnswer.markdown,
    phase: deterministicAnswer.phase,
    retrievedContextLength: deterministicAnswer.retrievedContextLength,
    reportResponseDebug: options.reportResponseDebug,
  });

  return true;
}

export function handlePreparedContextDeterministicAnswer(options: {
  route: IChatTurnRoute;
  query: string;
  evidenceAssessment: { status: 'sufficient' | 'weak' | 'insufficient'; reasons: string[] };
  retrievedContextText: string;
  memoryResult: string | null;
  ragSources: Array<{ uri: string; label: string; index?: number }>;
  response: IChatResponseStream;
  token: ICancellationToken;
  reportResponseDebug?: IChatResponseDebugReporter;
}): boolean {
  const coverageAnswer = selectDeterministicAnswer({
    route: options.route,
    query: options.query,
    evidenceAssessment: options.evidenceAssessment,
    retrievedContextText: options.retrievedContextText,
  });

  if (
    coverageAnswer?.phase === 'deterministic-grounded-books-direct-answer'
    || coverageAnswer?.phase === 'deterministic-workflow-direct-answer'
    ||
    coverageAnswer?.phase === 'unsupported-specific-coverage-direct-answer'
    || coverageAnswer?.phase === 'unsupported-workspace-topic-direct-answer'
  ) {
    emitDeterministicAnswer({
      response: options.response,
      token: options.token,
      markdown: coverageAnswer.markdown,
      phase: coverageAnswer.phase,
      retrievedContextLength: coverageAnswer.retrievedContextLength,
      reportResponseDebug: options.reportResponseDebug,
    });

    if (options.ragSources.length > 0) {
      const citations = options.ragSources.map((source, index) => ({
          index: source.index ?? (index + 1),
          uri: source.uri,
          label: source.label,
        }));
      const attributableCitations = selectAttributableCitations(coverageAnswer.markdown, citations);
      if (attributableCitations.length > 0) {
        options.response.setCitations(attributableCitations);
      }
    }
    return true;
  }

  if (options.route.kind !== 'memory-recall' || !options.memoryResult) {
    return false;
  }

  const memoryAnswer = selectDeterministicAnswer({
    route: options.route,
    memoryContext: options.memoryResult,
  });
  if (!memoryAnswer) {
    return false;
  }

  emitDeterministicAnswer({
    response: options.response,
    token: options.token,
    markdown: memoryAnswer.markdown,
    phase: memoryAnswer.phase,
    retrievedContextLength: memoryAnswer.retrievedContextLength,
    reportResponseDebug: options.reportResponseDebug,
  });

  return true;
}