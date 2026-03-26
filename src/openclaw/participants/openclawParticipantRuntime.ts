import type {
  IChatMessage,
  IChatParticipantContext,
  IChatParticipantRequest,
  IChatRequestOptions,
  IChatResponseChunk,
  IChatResponseStream,
  ICancellationToken,
  IToolCall,
  IToolDefinition,
} from '../../services/chatTypes.js';
import type {
  IChatContextPlan,
  IChatRuntimeTrace,
  IOpenclawBootstrapDebugFile,
  IOpenclawBootstrapDebugReport,
  IRetrievalPlan,
} from '../openclawTypes.js';

export const OPENCLAW_BOOTSTRAP_FILES = [
  'AGENTS.md',
  'SOUL.md',
  'TOOLS.md',
  'IDENTITY.md',
  'USER.md',
  'HEARTBEAT.md',
  'BOOTSTRAP.md',
] as const;

export const OPENCLAW_MAX_READONLY_ITERATIONS = 3;
export const OPENCLAW_DEFAULT_BOOTSTRAP_MAX_CHARS = 20_000;
export const OPENCLAW_DEFAULT_BOOTSTRAP_TOTAL_MAX_CHARS = 150_000;

const MIN_BOOTSTRAP_FILE_BUDGET_CHARS = 64;
const BOOTSTRAP_HEAD_RATIO = 0.7;
const BOOTSTRAP_TAIL_RATIO = 0.2;

type ReadWorkspaceFile = (relativePath: string) => Promise<string | null | undefined>;

export type IOpenclawBootstrapEntry = {
  name: string;
  path: string;
  content?: string;
  missing: boolean;
};

export type IOpenclawBootstrapContextResult = {
  sections: string[];
  debug: IOpenclawBootstrapDebugReport;
};

export async function loadOpenclawBootstrapEntries(
  readWorkspaceFile: ReadWorkspaceFile | undefined,
): Promise<IOpenclawBootstrapEntry[]> {
  if (!readWorkspaceFile) {
    return OPENCLAW_BOOTSTRAP_FILES.map((path) => ({ name: path, path, missing: true }));
  }

  const entries: IOpenclawBootstrapEntry[] = [];
  for (const path of OPENCLAW_BOOTSTRAP_FILES) {
    const content = await readWorkspaceFile(path);
    if (typeof content === 'string') {
      entries.push({ name: path, path, content, missing: false });
      continue;
    }
    entries.push({ name: path, path, missing: true });
  }

  for (const path of ['MEMORY.md', 'memory.md'] as const) {
    const content = await readWorkspaceFile(path);
    if (typeof content === 'string') {
      const trimmed = content.trim();
      if (trimmed) {
        entries.push({ name: path, path, content, missing: false });
        break;
      }
    }
  }

  return entries;
}

export function buildOpenclawBootstrapContext(
  entries: readonly IOpenclawBootstrapEntry[],
  options?: { maxChars?: number; totalMaxChars?: number },
): IOpenclawBootstrapContextResult {
  const maxChars = normalizePositiveLimit(options?.maxChars, OPENCLAW_DEFAULT_BOOTSTRAP_MAX_CHARS);
  const totalMaxChars = normalizePositiveLimit(options?.totalMaxChars, OPENCLAW_DEFAULT_BOOTSTRAP_TOTAL_MAX_CHARS);
  let remainingTotalChars = totalMaxChars;
  const sections: string[] = [];
  const warningLines: string[] = [];
  const files: IOpenclawBootstrapDebugFile[] = [];

  for (const entry of entries) {
    const pathValue = entry.path.trim();
    if (!pathValue) {
      continue;
    }

    if (entry.missing) {
      const missingText = clampToBudget(`[MISSING] Expected at: ${pathValue}`, remainingTotalChars);
      let injectedChars = 0;
      if (missingText) {
        sections.push(`[${pathValue}]\n${missingText}`);
        injectedChars = missingText.length;
        remainingTotalChars = Math.max(0, remainingTotalChars - injectedChars);
      }
      files.push({
        name: entry.name,
        path: pathValue,
        missing: true,
        rawChars: 0,
        injectedChars,
        truncated: false,
        causes: [],
      });
      continue;
    }

    const trimmedContent = (entry.content ?? '').trimEnd();
    const contentForInjection = trimmedContent.trim();
    if (!contentForInjection) {
      files.push({
        name: entry.name,
        path: pathValue,
        missing: false,
        rawChars: 0,
        injectedChars: 0,
        truncated: false,
        causes: [],
      });
      continue;
    }

    if (remainingTotalChars < MIN_BOOTSTRAP_FILE_BUDGET_CHARS) {
      warningLines.push(`remaining bootstrap budget is ${remainingTotalChars} chars; skipping additional bootstrap files`);
      files.push({
        name: entry.name,
        path: pathValue,
        missing: false,
        rawChars: contentForInjection.length,
        injectedChars: 0,
        truncated: true,
        causes: ['total-limit'],
      });
      continue;
    }

    const fileBudget = Math.max(1, Math.min(maxChars, remainingTotalChars));
    const trimmed = trimBootstrapContent(contentForInjection, entry.name, fileBudget);
    const injectedContent = clampToBudget(trimmed.content, remainingTotalChars);
    const injectedChars = injectedContent.length;
    const truncated = trimmed.truncated || injectedChars < contentForInjection.length;
    if (injectedContent) {
      sections.push(`[${pathValue}]\n${injectedContent}`);
      remainingTotalChars = Math.max(0, remainingTotalChars - injectedChars);
    }
    if (truncated) {
      warningLines.push(`${entry.name}: ${contentForInjection.length} raw -> ${injectedChars} injected`);
    }
    files.push({
      name: entry.name,
      path: pathValue,
      missing: false,
      rawChars: contentForInjection.length,
      injectedChars,
      truncated,
      causes: [],
    });
  }

  const totalInjectedChars = files.filter((file) => !file.missing).reduce((sum, file) => sum + file.injectedChars, 0);
  const totalRawChars = files.filter((file) => !file.missing).reduce((sum, file) => sum + file.rawChars, 0);
  const finalizedFiles = files.map((file) => {
    if (file.missing || !file.truncated) {
      return file;
    }
    const causes: Array<'per-file-limit' | 'total-limit'> = [];
    if (file.rawChars > maxChars) {
      causes.push('per-file-limit');
    }
    if (file.injectedChars === 0 || totalInjectedChars >= totalMaxChars) {
      causes.push('total-limit');
    }
    return { ...file, causes };
  });

  return {
    sections,
    debug: {
      maxChars,
      totalMaxChars,
      totalRawChars,
      totalInjectedChars,
      files: finalizedFiles,
      warningLines,
    },
  };
}

function normalizePositiveLimit(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

function clampToBudget(content: string, budget: number): string {
  if (budget <= 0) {
    return '';
  }
  return content.length <= budget ? content : content.slice(0, budget);
}

function trimBootstrapContent(content: string, fileName: string, maxChars: number): { content: string; truncated: boolean } {
  if (content.length <= maxChars) {
    return { content, truncated: false };
  }

  const marker = `\n[...truncated, read ${fileName} for full content...]\n`;
  if (marker.length >= maxChars) {
    return { content: content.slice(0, maxChars), truncated: true };
  }

  const remaining = maxChars - marker.length;
  const headChars = Math.max(1, Math.floor(remaining * BOOTSTRAP_HEAD_RATIO));
  const tailChars = Math.max(0, Math.min(Math.floor(remaining * BOOTSTRAP_TAIL_RATIO), remaining - headChars));
  const head = content.slice(0, headChars);
  const tail = tailChars > 0 ? content.slice(-tailChars) : '';
  return {
    content: `${head}${marker}${tail}`,
    truncated: true,
  };
}

export function buildOpenclawSeedMessages(
  systemPrompt: string,
  history: IChatParticipantContext['history'],
  request: IChatParticipantRequest,
): IChatMessage[] {
  const messages: IChatMessage[] = [{
    role: 'system',
    content: systemPrompt,
  }];

  for (const pair of history) {
    messages.push({ role: 'user', content: pair.request.text });
    const assistantText = pair.response.parts
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

    if (assistantText) {
      messages.push({ role: 'assistant', content: assistantText });
    }
  }

  messages.push({
    role: 'user',
    content: request.text,
    images: request.attachments?.filter((attachment) => attachment.kind === 'image'),
  });

  return messages;
}

export async function executeOpenclawModelTurn(
  sendChatRequest: (
    messages: readonly IChatMessage[],
    options?: IChatRequestOptions,
    signal?: AbortSignal,
  ) => AsyncIterable<IChatResponseChunk>,
  messages: readonly IChatMessage[],
  requestOptions: IChatRequestOptions,
  response: IChatResponseStream,
  token: ICancellationToken,
): Promise<{
  markdown: string;
  thinking: string;
  toolCalls: IToolCall[];
  promptTokens?: number;
  completionTokens?: number;
}> {
  let markdown = '';
  let thinking = '';
  let promptTokens: number | undefined;
  let completionTokens: number | undefined;
  const toolCalls: IToolCall[] = [];

  for await (const chunk of sendChatRequest(messages, requestOptions)) {
    if (token.isCancellationRequested) {
      break;
    }

    markdown += chunk.content;
    if (chunk.thinking) {
      thinking += chunk.thinking;
      response.thinking(chunk.thinking);
    }
    if (chunk.toolCalls) {
      toolCalls.push(...chunk.toolCalls);
    }
    if (typeof chunk.promptEvalCount === 'number') {
      promptTokens = chunk.promptEvalCount;
    }
    if (typeof chunk.evalCount === 'number') {
      completionTokens = chunk.evalCount;
    }
  }

  return { markdown, thinking, toolCalls, promptTokens, completionTokens };
}

export function buildOpenclawReadOnlyRequestOptions(options: {
  tools?: readonly IToolDefinition[];
  temperature?: number;
  maxTokens?: number;
}): IChatRequestOptions {
  return {
    think: true,
    temperature: options.temperature,
    maxTokens: options.maxTokens || undefined,
    tools: options.tools && options.tools.length > 0 ? options.tools : undefined,
  };
}

export function buildOpenclawTraceSeed(
  request: IChatParticipantRequest,
  defaultReason: string,
): Pick<IChatRuntimeTrace, 'route' | 'contextPlan' | 'hasActiveSlashCommand' | 'isRagReady'> {
  const turnState = request.turnState;
  const route = turnState?.turnRoute ?? {
    kind: 'grounded',
    reason: defaultReason,
  };
  const retrievalPlan: IRetrievalPlan = {
    intent: route.kind === 'conversational' ? 'conversational' : 'question',
    reasoning: route.reason,
    needsRetrieval: route.kind === 'grounded',
    queries: [turnState?.contextQueryText ?? request.text],
  };
  const contextPlan: IChatContextPlan = {
    route: route.kind,
    intent: retrievalPlan.intent,
    useRetrieval: retrievalPlan.needsRetrieval,
    useMemoryRecall: route.kind === 'memory-recall',
    useTranscriptRecall: route.kind === 'transcript-recall',
    useConceptRecall: false,
    useCurrentPage: false,
    citationMode: route.kind === 'grounded' ? 'required' : 'disabled',
    reasoning: route.reason,
    retrievalPlan,
  };

  return {
    route,
    contextPlan,
    hasActiveSlashCommand: turnState?.hasActiveSlashCommand ?? false,
    isRagReady: turnState?.isRagReady ?? false,
  };
}