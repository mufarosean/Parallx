import type {
  ICancellationToken,
  IChatAttachment,
  IChatFileAttachment,
  IChatImageAttachment,
  IChatMessage,
  IChatParticipantContext,
  IChatParticipantRequest,
  IChatParticipantResult,
  IChatResponseStream,
  IChatResponseChunk,
} from '../../../services/chatTypes.js';
import { isChatFileAttachment, isChatImageAttachment } from '../../../services/chatTypes.js';

const MAX_SCOPED_ATTACHMENT_FILES = 4;
const MAX_SCOPED_ATTACHMENT_CHARS = 16000;
const MAX_SCOPED_ATTACHMENT_FILE_CHARS = 4000;

export function appendScopedParticipantHistory(
  messages: IChatMessage[],
  context: IChatParticipantContext,
): void {
  for (const pair of context.history) {
    messages.push({ role: 'user', content: pair.request.text });
    const responseText = pair.response.parts
      .map((part) => {
        if ('content' in part && typeof part.content === 'string') {
          return part.content;
        }
        if ('code' in part && typeof part.code === 'string') {
          return '```\n' + part.code + '\n```';
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
    if (responseText) {
      messages.push({ role: 'assistant', content: responseText });
    }
  }
}

export function createScopedParticipantMessages(
  systemContent: string,
  userContent: string,
  request: IChatParticipantRequest,
  context?: IChatParticipantContext,
): IChatMessage[] {
  const messages: IChatMessage[] = [
    { role: 'system', content: systemContent },
  ];

  if (context) {
    appendScopedParticipantHistory(messages, context);
  }

  messages.push({
    role: 'user',
    content: userContent,
    images: request.attachments?.filter(isChatImageAttachment),
  });
  return messages;
}

function formatScopeSummary(request: IChatParticipantRequest): string | undefined {
  const turnState = request.turnState;
  if (!turnState) {
    return undefined;
  }

  const lines: string[] = [
    `[Shared turn scope] level=${turnState.queryScope.level}; route=${turnState.turnRoute.kind}`,
  ];

  if (turnState.queryScope.pathPrefixes?.length) {
    lines.push(`Paths: ${turnState.queryScope.pathPrefixes.join(', ')}`);
  }

  if (turnState.queryScope.resolvedEntities?.length) {
    lines.push(`Resolved entities: ${turnState.queryScope.resolvedEntities.map((entity) => entity.resolvedPath).join(', ')}`);
  }

  if (turnState.semanticFallback) {
    lines.push(`Semantic fallback: ${turnState.semanticFallback.kind}`);
  }

  return lines.join('\n');
}

async function formatAttachmentSummary(
  attachments: readonly IChatAttachment[] | undefined,
  readFileContent?: (relativePath: string) => Promise<string>,
): Promise<string | undefined> {
  if (!attachments?.length) {
    return undefined;
  }

  const fileAttachments = attachments.filter(isChatFileAttachment).slice(0, MAX_SCOPED_ATTACHMENT_FILES);
  const imageAttachments = attachments.filter(isChatImageAttachment);
  const sections: string[] = [];
  let usedChars = 0;

  for (const attachment of fileAttachments) {
    let contentBlock = '[Could not read file]';
    if (readFileContent) {
      try {
        const content = await readFileContent(attachment.fullPath);
        const remaining = Math.max(0, MAX_SCOPED_ATTACHMENT_CHARS - usedChars);
        const nextChunk = content.slice(0, Math.min(MAX_SCOPED_ATTACHMENT_FILE_CHARS, remaining));
        if (nextChunk) {
          contentBlock = nextChunk;
          usedChars += nextChunk.length;
        }
      } catch {
        contentBlock = '[Could not read file]';
      }
    }
    sections.push(`[Attached file: ${attachment.name}]\n${contentBlock}`);
    if (usedChars >= MAX_SCOPED_ATTACHMENT_CHARS) {
      break;
    }
  }

  for (const image of imageAttachments) {
    sections.push(`[Attached image: ${image.name}]`);
  }

  return sections.length > 0 ? sections.join('\n\n') : undefined;
}

export async function buildScopedParticipantUserContent(options: {
  request: IChatParticipantRequest;
  userText: string;
  readFileContent?: (relativePath: string) => Promise<string>;
  reportParticipantDebug?: (debug: {
    surface: 'workspace' | 'canvas';
    usedSharedTurnState: boolean;
    attachmentCount: number;
    fileAttachmentCount: number;
    imageAttachmentCount: number;
    queryScopeLevel?: string;
    semanticFallbackKind?: string;
  }) => void;
  surface: 'workspace' | 'canvas';
}): Promise<string> {
  const scopeSummary = formatScopeSummary(options.request);
  const attachmentSummary = await formatAttachmentSummary(options.request.attachments, options.readFileContent);

  options.reportParticipantDebug?.({
    surface: options.surface,
    usedSharedTurnState: !!options.request.turnState,
    attachmentCount: options.request.attachments?.length ?? 0,
    fileAttachmentCount: options.request.attachments?.filter(isChatFileAttachment).length ?? 0,
    imageAttachmentCount: options.request.attachments?.filter(isChatImageAttachment).length ?? 0,
    queryScopeLevel: options.request.turnState?.queryScope.level,
    semanticFallbackKind: options.request.turnState?.semanticFallback?.kind,
  });

  return [scopeSummary, attachmentSummary, options.userText].filter(Boolean).join('\n\n');
}

export async function streamScopedParticipantLLMResponse(
  messages: IChatMessage[],
  response: IChatResponseStream,
  token: ICancellationToken,
  sendChatRequest: (
    messages: readonly IChatMessage[],
    options?: unknown,
    signal?: AbortSignal,
  ) => AsyncIterable<IChatResponseChunk>,
): Promise<IChatParticipantResult> {
  const abortController = new AbortController();
  if (token.isCancellationRequested) {
    abortController.abort();
  }
  const cancelListener = token.onCancellationRequested(() => abortController.abort());

  try {
    const stream = sendChatRequest(messages, undefined, abortController.signal);

    for await (const chunk of stream) {
      if (token.isCancellationRequested) {
        break;
      }
      if (chunk.thinking) {
        response.thinking(chunk.thinking);
      }
      if (chunk.content) {
        response.markdown(chunk.content);
      }
    }

    return {};
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return {};
    }
    const message = err instanceof Error ? err.message : String(err);
    return { errorDetails: { message, responseIsIncomplete: true } };
  } finally {
    cancelListener.dispose();
  }
}