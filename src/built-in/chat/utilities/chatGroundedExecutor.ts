import type {
  ICancellationToken,
  IChatMessage,
  IChatRequestOptions,
  IChatResponseChunk,
  IChatResponseStream,
  IToolCall,
  IToolResult,
} from '../../../services/chatTypes.js';
import type {
  ChatRuntimeApprovalState,
  IChatRuntimeAutonomyMirror,
  IChatRuntimeToolInvocationObserver,
  IChatRuntimeTrace,
} from '../chatTypes.js';
import { ChatToolLoopSafety } from '../../../services/chatToolLoopSafety.js';

export interface IChatGroundedToolGuard {
  isValid(): boolean;
}

export interface IChatGroundedEvidenceAssessment {
  readonly status: 'sufficient' | 'weak' | 'insufficient';
  readonly reasons: string[];
}

export interface IChatGroundedExecutorDeps {
  readonly sendChatRequest: (
    messages: readonly IChatMessage[],
    options?: IChatRequestOptions,
    signal?: AbortSignal,
  ) => AsyncIterable<IChatResponseChunk>;
  readonly invokeToolWithRuntimeControl?: (
    name: string,
    args: Record<string, unknown>,
    token: ICancellationToken,
    observer?: IChatRuntimeToolInvocationObserver,
  ) => Promise<IToolResult>;
  readonly resetNetworkTimeout: () => void;
  readonly parseEditResponse: (rawContent: string, response: IChatResponseStream) => void;
  readonly extractToolCallsFromText: (text: string) => { toolCalls: IToolCall[]; cleanedText: string };
  readonly stripToolNarration: (text: string) => string;
  readonly buildExtractiveFallbackAnswer: (query: string, retrievedContextText: string) => string;
  readonly reportResponseDebug?: (debug: {
    phase: string;
    markdownLength: number;
    yielded: boolean;
    cancelled: boolean;
    retrievedContextLength: number;
    note?: string;
  }) => void;
  readonly reportRuntimeTrace?: (trace: Partial<IChatRuntimeTrace> & Pick<IChatRuntimeTrace, 'route' | 'contextPlan' | 'hasActiveSlashCommand' | 'isRagReady'>) => void;
  readonly reportFirstTokenLatency?: (durationMs: number) => void;
  readonly reportStreamCompleteLatency?: (durationMs: number) => void;
}

export interface IChatGroundedExecutorOptions {
  readonly messages: IChatMessage[];
  readonly requestOptions: IChatRequestOptions;
  readonly abortSignal: AbortSignal;
  readonly response: IChatResponseStream;
  readonly token: ICancellationToken;
  readonly maxIterations: number;
  readonly canInvokeTools: boolean;
  readonly isEditMode: boolean;
  readonly requestText: string;
  readonly userContent: string;
  readonly retrievedContextText: string;
  readonly evidenceAssessment: IChatGroundedEvidenceAssessment;
  readonly toolGuard?: IChatGroundedToolGuard;
  readonly autonomyMirror?: IChatRuntimeAutonomyMirror;
  readonly runtimeTraceSeed?: Pick<IChatRuntimeTrace, 'route' | 'contextPlan' | 'hasActiveSlashCommand' | 'isRagReady'>;
}

export interface IChatGroundedExecutorResult {
  readonly producedContent: boolean;
}

const NARRATION_PATTERN = /(?:here'?s?\s+(?:a|an|the)\s+(?:function|tool)\s+call|(?:I'?(?:ll|m going to)|let me)\s+(?:call|use|invoke|try)\s+(?:the\s+)?(?:`?\w+`?\s+)?(?:function|tool)|this (?:function|tool) call will|based on the (?:functions?|tools?|context)\s+provided|with its proper arguments|\bAction:\s*[{`]|\bExecution:\s*[{`]|let'?s\s+execute\s+this\s+(?:action|tool))/i;

export async function executeChatGrounded(
  deps: IChatGroundedExecutorDeps,
  options: IChatGroundedExecutorOptions,
): Promise<IChatGroundedExecutorResult> {
  let producedContent = false;
  const loopSafety = new ChatToolLoopSafety();

  const emitToolTrace = (checkpoint: string, toolName: string, approvalState: ChatRuntimeApprovalState, note?: string): void => {
    if (!deps.reportRuntimeTrace || !options.runtimeTraceSeed) {
      return;
    }

    deps.reportRuntimeTrace({
      ...options.runtimeTraceSeed,
      checkpoint,
      toolName,
      approvalState,
      note,
    });
  };

  for (let iteration = 0; iteration <= options.maxIterations; iteration += 1) {
    if (options.token.isYieldRequested || options.token.isCancellationRequested) {
      break;
    }

    let turnContent = '';
    const turnToolCalls: IToolCall[] = [];
    let turnPromptTokens = 0;
    let turnCompletionTokens = 0;

    const stream = deps.sendChatRequest(
      options.messages,
      options.requestOptions,
      options.abortSignal,
    );

    const streamStart = performance.now();
    let firstTokenLogged = false;

    for await (const chunk of stream) {
      if (!firstTokenLogged && (chunk.content || chunk.thinking)) {
        deps.reportFirstTokenLatency?.(performance.now() - streamStart);
        firstTokenLogged = true;
      }

      if (options.token.isCancellationRequested || options.token.isYieldRequested) {
        break;
      }

      deps.resetNetworkTimeout();

      if (chunk.thinking) {
        options.response.thinking(chunk.thinking);
      }

      if (chunk.content) {
        if (!options.isEditMode) {
          options.response.markdown(chunk.content);
        }
        turnContent += chunk.content;
        producedContent = true;
      }

      if (chunk.toolCalls && chunk.toolCalls.length > 0) {
        turnToolCalls.push(...chunk.toolCalls);
      }

      if (chunk.promptEvalCount) { turnPromptTokens = chunk.promptEvalCount; }
      if (chunk.evalCount) { turnCompletionTokens = chunk.evalCount; }
    }

    deps.reportStreamCompleteLatency?.(performance.now() - streamStart);

    if (turnPromptTokens > 0 || turnCompletionTokens > 0) {
      options.response.reportTokenUsage(turnPromptTokens, turnCompletionTokens);
    }

    if (options.token.isCancellationRequested || options.token.isYieldRequested) {
      break;
    }

    if (options.isEditMode && turnContent) {
      deps.parseEditResponse(turnContent, options.response);
      break;
    }

    if (turnToolCalls.length === 0 && turnContent && options.canInvokeTools) {
      const { toolCalls: textToolCalls, cleanedText } = deps.extractToolCallsFromText(turnContent);
      if (textToolCalls.length > 0) {
        turnToolCalls.push(...textToolCalls);
        if (!options.isEditMode) {
          options.response.replaceLastMarkdown(cleanedText);
        }
        turnContent = cleanedText;
      }
    }

    if (turnToolCalls.length === 0 && turnContent && NARRATION_PATTERN.test(turnContent)) {
      const cleaned = deps.stripToolNarration(turnContent);
      if (!options.isEditMode && cleaned.trim().length > 0) {
        options.response.replaceLastMarkdown(cleaned);
      }
      turnContent = cleaned.trim().length > 0 ? cleaned : turnContent;
    }

    if (turnToolCalls.length === 0) {
      break;
    }

    if (turnContent && !options.isEditMode) {
      options.response.replaceLastMarkdown('');
    }

    if (!options.canInvokeTools || !deps.invokeToolWithRuntimeControl) {
      options.response.warning('Tool calls are not available in this mode.');
      break;
    }

    if (iteration === options.maxIterations) {
      options.response.warning(`Agentic loop reached maximum iterations (${options.maxIterations}). Stopping.`);
      break;
    }

    if (turnContent) {
      options.messages.push({ role: 'assistant', content: turnContent });
    }

    for (const toolCall of turnToolCalls) {
      const toolName = toolCall.function.name;
      const toolArgs = toolCall.function.arguments;
      producedContent = true;

      const loopDecision = loopSafety.record(toolName, toolArgs);
      if (loopDecision.blocked) {
        options.response.warning(loopDecision.note ?? `Blocked repeated ${toolName} calls.`);
        options.messages.push({
          role: 'tool',
          content: loopDecision.note ?? `Blocked repeated ${toolName} calls.`,
          toolName,
        });
        break;
      }

      let result: IToolResult;
      if (options.toolGuard && !options.toolGuard.isValid()) {
        result = { content: 'Workspace session changed — results discarded.', isError: true };
        console.warn('[DefaultParticipant] Skipping tool "%s" — workspace session changed', toolName);
      } else {
        try {
          const downstreamObserver: IChatRuntimeToolInvocationObserver = {
            onValidated: (metadata) => emitToolTrace('tool-validated', metadata.name, 'not-required', metadata.permissionLevel),
            onApprovalRequested: (metadata) => emitToolTrace('approval-requested', metadata.name, 'pending', metadata.approvalSource),
            onApprovalResolved: (metadata, approved) => emitToolTrace(
              approved ? 'approval-resolved' : 'approval-denied',
              metadata.name,
              metadata.autoApproved ? 'auto-approved' : approved ? 'approved' : 'denied',
              metadata.approvalSource,
            ),
            onExecuted: (metadata, invocationResult) => emitToolTrace(
              invocationResult.isError ? 'tool-executed-error' : 'tool-executed',
              metadata.name,
              metadata.requiresApproval ? 'approved' : metadata.autoApproved ? 'auto-approved' : 'not-required',
              invocationResult.isError ? invocationResult.content : undefined,
            ),
          };
          const runtimeObserver = options.autonomyMirror
            ? options.autonomyMirror.createToolObserver(toolName, toolArgs, downstreamObserver)
            : downstreamObserver;
          result = await deps.invokeToolWithRuntimeControl(toolName, toolArgs, options.token, runtimeObserver);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          result = { content: `Tool "${toolName}" failed: ${errMsg}`, isError: true };
        }
      }

      options.messages.push({
        role: 'tool',
        content: result.content,
        toolName,
      });
    }
  }

  deps.reportResponseDebug?.({
    phase: 'post-loop-before-fallback',
    markdownLength: options.response.getMarkdownText().trim().length,
    yielded: !!options.token.isYieldRequested,
    cancelled: options.token.isCancellationRequested,
    retrievedContextLength: options.retrievedContextText.length,
  });

  if (!options.isEditMode && !options.token.isCancellationRequested && options.response.getMarkdownText().trim().length === 0) {
    const fallbackMessages: IChatMessage[] = [
      ...options.messages,
      {
        role: 'user',
        content:
          'Provide the final answer directly to the user in markdown using the retrieved context and tool results already available. ' +
          'Do not call tools, do not output JSON, and do not describe tool usage. If sources are available, cite them using [N].',
      },
    ];

    const fallbackOptions: IChatRequestOptions = {
      ...options.requestOptions,
      tools: undefined,
      format: undefined,
      think: false,
    };

    deps.resetNetworkTimeout();
    let fallbackPromptTokens = 0;
    let fallbackCompletionTokens = 0;
    for await (const chunk of deps.sendChatRequest(fallbackMessages, fallbackOptions, options.abortSignal)) {
      if (options.token.isCancellationRequested || options.token.isYieldRequested) {
        break;
      }

      deps.resetNetworkTimeout();
      if (chunk.content) {
        options.response.markdown(chunk.content);
        producedContent = true;
      }
      if (chunk.promptEvalCount) { fallbackPromptTokens = chunk.promptEvalCount; }
      if (chunk.evalCount) { fallbackCompletionTokens = chunk.evalCount; }
    }

    if (fallbackPromptTokens > 0 || fallbackCompletionTokens > 0) {
      options.response.reportTokenUsage(fallbackPromptTokens, fallbackCompletionTokens);
    }

    if (options.response.getMarkdownText().trim().length === 0) {
      const extractiveFallback = deps.buildExtractiveFallbackAnswer(options.requestText, options.retrievedContextText || options.userContent);
      if (extractiveFallback) {
        options.response.markdown(extractiveFallback);
        producedContent = true;
        deps.reportResponseDebug?.({
          phase: 'post-loop-extractive-fallback',
          markdownLength: options.response.getMarkdownText().trim().length,
          yielded: !!options.token.isYieldRequested,
          cancelled: options.token.isCancellationRequested,
          retrievedContextLength: options.retrievedContextText.length,
          note: 'extractive',
        });
      }
    }

    if (options.response.getMarkdownText().trim().length === 0) {
      options.response.markdown(
        options.evidenceAssessment.status === 'insufficient'
          ? 'I do not have enough grounded evidence in the current workspace context to answer this confidently. Please point me to the relevant document or add more detail.'
          : 'I could not produce a grounded final answer from the current model output. Please try again.',
      );
      producedContent = true;
      deps.reportResponseDebug?.({
        phase: 'post-loop-visible-fallback',
        markdownLength: options.response.getMarkdownText().trim().length,
        yielded: !!options.token.isYieldRequested,
        cancelled: options.token.isCancellationRequested,
        retrievedContextLength: options.retrievedContextText.length,
        note: 'visible',
      });
    }
  }

  return { producedContent };
}