import type {
  ICancellationToken,
  IChatMessage,
  IChatParticipantResult,
  IChatRequestOptions,
  IChatRequestResponsePair,
  IChatResponseStream,
} from '../../../services/chatTypes.js';
import type { IDefaultParticipantServices, IRetrievalPlan } from '../chatTypes.js';
import { executeChatModelOnly } from './chatModelOnlyExecutor.js';
import { executeChatGrounded, type IChatGroundedEvidenceAssessment, type IChatGroundedToolGuard } from './chatGroundedExecutor.js';
import { queueChatMemoryWriteBack } from './chatMemoryWriteBack.js';
import { validateAndFinalizeChatResponse } from './chatResponseValidator.js';
import { selectAttributableCitations } from './chatResponseParsingHelpers.js';

const DEFAULT_NETWORK_TIMEOUT_MS = 60_000;

export interface IExecutePreparedChatTurnDeps {
  readonly sendChatRequest: IDefaultParticipantServices['sendChatRequest'];
  readonly invokeTool?: IDefaultParticipantServices['invokeTool'];
  readonly extractPreferences?: IDefaultParticipantServices['extractPreferences'];
  readonly storeSessionMemory?: IDefaultParticipantServices['storeSessionMemory'];
  readonly storeConceptsFromSession?: IDefaultParticipantServices['storeConceptsFromSession'];
  readonly isSessionEligibleForSummary?: IDefaultParticipantServices['isSessionEligibleForSummary'];
  readonly getSessionMemoryMessageCount?: IDefaultParticipantServices['getSessionMemoryMessageCount'];
  readonly sendSummarizationRequest?: IDefaultParticipantServices['sendSummarizationRequest'];
  readonly reportResponseDebug?: IDefaultParticipantServices['reportResponseDebug'];
  readonly buildExtractiveFallbackAnswer: (query: string, retrievedContextText: string) => string;
  readonly buildMissingCitationFooter: (
    text: string,
    citations: Array<{ index: number; label: string }>,
  ) => string;
  readonly buildDeterministicSessionSummary: (
    history: readonly IChatRequestResponsePair[],
    currentRequestText: string,
  ) => string;
  readonly repairMarkdown: (markdown: string) => string;
  readonly parseEditResponse: (rawContent: string, response: IChatResponseStream) => void;
  readonly extractToolCallsFromText: typeof executeChatModelOnly extends (
    deps: infer TDeps,
    options: any,
  ) => any
    ? TDeps extends { extractToolCallsFromText: infer TExtract }
      ? TExtract
      : never
    : never;
  readonly stripToolNarration: typeof executeChatModelOnly extends (
    deps: infer TDeps,
    options: any,
  ) => any
    ? TDeps extends { stripToolNarration: infer TStrip }
      ? TStrip
      : never
    : never;
  readonly categorizeError: (err: unknown) => { message: string };
  readonly executeModelOnly?: typeof executeChatModelOnly;
  readonly executeGrounded?: typeof executeChatGrounded;
  readonly queueMemoryWriteBack?: typeof queueChatMemoryWriteBack;
  readonly validateAndFinalizeResponse?: typeof validateAndFinalizeChatResponse;
}

export interface IExecutePreparedChatTurnOptions {
  readonly messages: IChatMessage[];
  readonly requestOptions: IChatRequestOptions;
  readonly response: IChatResponseStream;
  readonly token: ICancellationToken;
  readonly maxIterations: number;
  readonly canInvokeTools: boolean;
  readonly isEditMode: boolean;
  readonly useModelOnlyExecution: boolean;
  readonly requestText: string;
  readonly userContent: string;
  readonly retrievedContextText: string;
  readonly evidenceAssessment: IChatGroundedEvidenceAssessment;
  readonly isConversationalTurn: boolean;
  readonly citationMode: 'required' | 'disabled';
  readonly ragSources: Array<{ uri: string; label: string; index?: number }>;
  readonly retrievalPlan: IRetrievalPlan;
  readonly memoryEnabled: boolean;
  readonly sessionId: string;
  readonly history: readonly IChatRequestResponsePair[];
  readonly networkTimeoutMs?: number;
  readonly sessionCancellationSignal?: AbortSignal;
  readonly toolGuard?: IChatGroundedToolGuard;
}

export async function executePreparedChatTurn(
  deps: IExecutePreparedChatTurnDeps,
  options: IExecutePreparedChatTurnOptions,
): Promise<IChatParticipantResult> {
  const modelOnlyExecutor = deps.executeModelOnly ?? executeChatModelOnly;
  const groundedExecutor = deps.executeGrounded ?? executeChatGrounded;
  const memoryWriteBack = deps.queueMemoryWriteBack ?? queueChatMemoryWriteBack;
  const responseValidator = deps.validateAndFinalizeResponse ?? validateAndFinalizeChatResponse;

  const applyFallbackAnswer = (phase: string, note: string): void => {
    const extractiveFallback = deps.buildExtractiveFallbackAnswer(
      options.requestText,
      options.retrievedContextText || options.userContent,
    );
    if (extractiveFallback) {
      options.response.markdown(extractiveFallback);
    } else if (options.isConversationalTurn) {
      options.response.markdown('I could not produce a conversational response from the current model output. Please try again.');
    } else if (options.evidenceAssessment.status === 'insufficient') {
      options.response.markdown('I do not have enough grounded evidence in the current workspace context to answer this confidently. Please point me to the relevant document or add more detail.');
    } else {
      options.response.markdown('I could not produce a grounded final answer from the current model output. Please try again.');
    }

    if (options.citationMode === 'required' && options.ragSources.length > 0) {
      const citations = options.ragSources.map((source, index) => ({
        index: source.index ?? (index + 1),
        uri: source.uri,
        label: source.label,
      }));
      const attributableCitations = selectAttributableCitations(
        options.response.getMarkdownText(),
        citations,
      );
      const citationFooter = deps.buildMissingCitationFooter(
        options.response.getMarkdownText(),
        attributableCitations.map(({ index, label }) => ({ index, label })),
      );
      if (citationFooter) {
        options.response.markdown(citationFooter);
      }
      if (attributableCitations.length > 0) {
        options.response.setCitations(attributableCitations);
      }
    }

    deps.reportResponseDebug?.({
      phase: extractiveFallback ? `${phase}-extractive-fallback` : `${phase}-visible-fallback`,
      markdownLength: options.response.getMarkdownText().trim().length,
      yielded: !!options.token.isYieldRequested,
      cancelled: options.token.isCancellationRequested,
      retrievedContextLength: options.retrievedContextText.length,
      note,
    });
  };

  const abortController = new AbortController();
  if (options.token.isCancellationRequested) {
    abortController.abort();
  }
  const cancelListener = options.token.onCancellationRequested(() => {
    abortController.abort();
  });

  if (options.sessionCancellationSignal) {
    if (options.sessionCancellationSignal.aborted) {
      abortController.abort();
    } else {
      options.sessionCancellationSignal.addEventListener('abort', () => abortController.abort(), { once: true });
    }
  }

  const timeoutMs = options.networkTimeoutMs ?? DEFAULT_NETWORK_TIMEOUT_MS;
  let networkTimeoutId: ReturnType<typeof setTimeout> | undefined;
  const resetNetworkTimeout = () => {
    if (timeoutMs <= 0) {
      return;
    }
    if (networkTimeoutId !== undefined) {
      clearTimeout(networkTimeoutId);
    }
    networkTimeoutId = setTimeout(() => {
      abortController.abort(new DOMException('Request timed out', 'TimeoutError'));
    }, timeoutMs);
  };
  resetNetworkTimeout();

  try {
    let producedContent = false;

    if (options.useModelOnlyExecution) {
      const modelOnlyResult = await modelOnlyExecutor(
        {
          sendChatRequest: deps.sendChatRequest,
          resetNetworkTimeout,
          parseEditResponse: deps.parseEditResponse,
          extractToolCallsFromText: deps.extractToolCallsFromText,
          stripToolNarration: deps.stripToolNarration,
          reportFirstTokenLatency: (durationMs) => {
            console.debug(`[Parallx:latency] Time to first token: ${durationMs.toFixed(1)}ms`);
          },
          reportStreamCompleteLatency: (durationMs) => {
            console.debug(`[Parallx:latency] LLM stream complete: ${durationMs.toFixed(1)}ms`);
          },
        },
        {
          messages: options.messages,
          requestOptions: options.requestOptions,
          abortSignal: abortController.signal,
          response: options.response,
          token: options.token,
          canInvokeTools: options.canInvokeTools,
          isEditMode: options.isEditMode,
        },
      );
      producedContent = modelOnlyResult.producedContent;
    } else {
      const groundedResult = await groundedExecutor(
        {
          sendChatRequest: deps.sendChatRequest,
          invokeTool: deps.invokeTool,
          resetNetworkTimeout,
          parseEditResponse: deps.parseEditResponse,
          extractToolCallsFromText: deps.extractToolCallsFromText,
          stripToolNarration: deps.stripToolNarration,
          buildExtractiveFallbackAnswer: deps.buildExtractiveFallbackAnswer,
          reportResponseDebug: deps.reportResponseDebug,
          reportFirstTokenLatency: (durationMs) => {
            console.debug(`[Parallx:latency] Time to first token: ${durationMs.toFixed(1)}ms`);
          },
          reportStreamCompleteLatency: (durationMs) => {
            console.debug(`[Parallx:latency] LLM stream complete: ${durationMs.toFixed(1)}ms`);
          },
        },
        {
          messages: options.messages,
          requestOptions: options.requestOptions,
          abortSignal: abortController.signal,
          response: options.response,
          token: options.token,
          maxIterations: options.maxIterations,
          canInvokeTools: options.canInvokeTools,
          isEditMode: options.isEditMode,
          requestText: options.requestText,
          userContent: options.userContent,
          retrievedContextText: options.retrievedContextText,
          evidenceAssessment: options.evidenceAssessment,
          toolGuard: options.toolGuard,
        },
      );
      producedContent = groundedResult.producedContent;
    }

    if (networkTimeoutId !== undefined) {
      clearTimeout(networkTimeoutId);
    }

    if (!producedContent && !options.token.isCancellationRequested) {
      options.response.warning('The model returned an empty response. Try rephrasing your question or selecting a different model.');
    }

    memoryWriteBack(
      {
        extractPreferences: deps.extractPreferences,
        storeSessionMemory: deps.storeSessionMemory,
        storeConceptsFromSession: deps.storeConceptsFromSession,
        isSessionEligibleForSummary: deps.isSessionEligibleForSummary,
        getSessionMemoryMessageCount: deps.getSessionMemoryMessageCount,
        sendSummarizationRequest: deps.sendSummarizationRequest,
        buildDeterministicSessionSummary: deps.buildDeterministicSessionSummary,
      },
      {
        memoryEnabled: options.memoryEnabled,
        requestText: options.requestText,
        sessionId: options.sessionId,
        history: options.history,
      },
    );

    if (options.retrievalPlan.needsRetrieval && options.retrievalPlan.queries.length > 0) {
      const queryList = options.retrievalPlan.queries.map((query) => `• ${query}`).join('\n');
      options.response.thinking(
        `Intent: ${options.retrievalPlan.intent}\n`
        + `Analysis: ${options.retrievalPlan.reasoning}\n`
        + `Searched for:\n${queryList}`,
      );
    }

    responseValidator(
      {
        repairMarkdown: deps.repairMarkdown,
        buildMissingCitationFooter: deps.buildMissingCitationFooter,
        selectAttributableCitations,
        applyFallbackAnswer,
        reportResponseDebug: deps.reportResponseDebug,
      },
      {
        response: options.response,
        token: options.token,
        isEditMode: options.isEditMode,
        isConversational: options.isConversationalTurn,
        citationMode: options.citationMode,
        ragSources: options.ragSources,
        retrievedContextLength: options.retrievedContextText.length,
      },
    );

    return {};
  } catch (err) {
    if (networkTimeoutId !== undefined) {
      clearTimeout(networkTimeoutId);
    }

    deps.reportResponseDebug?.({
      phase: 'catch',
      markdownLength: options.response.getMarkdownText().trim().length,
      yielded: !!options.token.isYieldRequested,
      cancelled: options.token.isCancellationRequested,
      retrievedContextLength: options.retrievedContextText.length,
      note: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    });

    if (err instanceof DOMException && err.name === 'AbortError') {
      if (!options.token.isCancellationRequested && !options.token.isYieldRequested && options.response.getMarkdownText().trim().length === 0) {
        applyFallbackAnswer('catch', 'abort-without-user-cancel');
      }
      return {};
    }

    const { message } = deps.categorizeError(err);
    return {
      errorDetails: {
        message,
        responseIsIncomplete: true,
      },
    };
  } finally {
    cancelListener.dispose();
  }
}