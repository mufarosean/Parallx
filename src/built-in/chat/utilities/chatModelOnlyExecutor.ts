import type {
  ICancellationToken,
  IChatMessage,
  IChatRequestOptions,
  IChatResponseChunk,
  IChatResponseStream,
  IToolCall,
} from '../../../services/chatTypes.js';

export interface IChatModelOnlyExecutorDeps {
  readonly sendChatRequest: (
    messages: readonly IChatMessage[],
    options?: IChatRequestOptions,
    signal?: AbortSignal,
  ) => AsyncIterable<IChatResponseChunk>;
  readonly resetNetworkTimeout: () => void;
  readonly parseEditResponse: (rawContent: string, response: IChatResponseStream) => void;
  readonly extractToolCallsFromText: (text: string) => { toolCalls: IToolCall[]; cleanedText: string };
  readonly stripToolNarration: (text: string) => string;
  readonly reportFirstTokenLatency?: (durationMs: number) => void;
  readonly reportStreamCompleteLatency?: (durationMs: number) => void;
}

export interface IChatModelOnlyExecutorOptions {
  readonly messages: readonly IChatMessage[];
  readonly requestOptions: IChatRequestOptions;
  readonly abortSignal: AbortSignal;
  readonly response: IChatResponseStream;
  readonly token: ICancellationToken;
  readonly canInvokeTools: boolean;
  readonly isEditMode: boolean;
}

export interface IChatModelOnlyExecutorResult {
  readonly producedContent: boolean;
  readonly turnContent: string;
  readonly toolCalls: IToolCall[];
  readonly stoppedEarly: boolean;
}

const NARRATION_PATTERN = /(?:here'?s?\s+(?:a|an|the)\s+(?:function|tool)\s+call|(?:I'?(?:ll|m going to)|let me)\s+(?:call|use|invoke|try)\s+(?:the\s+)?(?:`?\w+`?\s+)?(?:function|tool)|this (?:function|tool) call will|based on the (?:functions?|tools?|context)\s+provided|with its proper arguments|\bAction:\s*[{`]|\bExecution:\s*[{`]|let'?s\s+execute\s+this\s+(?:action|tool))/i;

export async function executeChatModelOnly(
  deps: IChatModelOnlyExecutorDeps,
  options: IChatModelOnlyExecutorOptions,
): Promise<IChatModelOnlyExecutorResult> {
  let producedContent = false;
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
      for (const toolCall of chunk.toolCalls) {
        turnToolCalls.push(toolCall);
      }
    }

    if (chunk.promptEvalCount) { turnPromptTokens = chunk.promptEvalCount; }
    if (chunk.evalCount) { turnCompletionTokens = chunk.evalCount; }
  }

  deps.reportStreamCompleteLatency?.(performance.now() - streamStart);

  if (turnPromptTokens > 0 || turnCompletionTokens > 0) {
    options.response.reportTokenUsage(turnPromptTokens, turnCompletionTokens);
  }

  if (options.token.isCancellationRequested || options.token.isYieldRequested) {
    return {
      producedContent,
      turnContent,
      toolCalls: turnToolCalls,
      stoppedEarly: true,
    };
  }

  if (options.isEditMode && turnContent) {
    deps.parseEditResponse(turnContent, options.response);
    return {
      producedContent,
      turnContent,
      toolCalls: [],
      stoppedEarly: false,
    };
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

  if (turnToolCalls.length > 0) {
    if (turnContent && !options.isEditMode) {
      options.response.replaceLastMarkdown('');
    }
    options.response.warning('Tool calls are not available in this mode.');
  }

  return {
    producedContent,
    turnContent,
    toolCalls: turnToolCalls,
    stoppedEarly: false,
  };
}