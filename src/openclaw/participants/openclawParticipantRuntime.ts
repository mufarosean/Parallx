import type {
  IChatMessage,
  IChatParticipantContext,
  IChatParticipantRequest,
  IChatRequestOptions,
  IChatResponseChunk,
  IChatResponseStream,
  IChatToolInvocationContent,
  ICancellationToken,
  IToolCall,
  IToolDefinition,
} from '../../services/chatTypes.js';
import { ChatContentPartKind } from '../../services/chatTypes.js';
import type {
  IChatContextPlan,
  IChatRuntimeTrace,
  IChatTurnRoute,
  IOpenclawBootstrapDebugFile,
  IOpenclawBootstrapDebugReport,
  IRetrievalPlan,
} from '../openclawTypes.js';
import { HEARTBEAT_PURPOSE_PATH, HEARTBEAT_PURPOSE_TEMPLATE } from '../heartbeatPurpose.js';

export const OPENCLAW_BOOTSTRAP_FILES = [
  '.parallx/SOUL.md',
  '.parallx/USER.md',
  '.parallx/AGENTS.md',
  '.parallx/TOOLS.md',
] as const;

/**
 * Built-in defaults for bootstrap files that every workspace should have.
 * When a workspace is missing these files, the runtime injects these defaults
 * instead of marking them [MISSING]. Mirrors upstream's scaffold-on-create.
 */
export const OPENCLAW_BOOTSTRAP_DEFAULTS = new Map<string, string>([
  ['.parallx/SOUL.md', `# Parallx AI Assistant

You are Parallx, a local AI assistant running entirely on the user's machine.
You help the user understand and work with their project files and canvas pages.

## Personality
- Direct, concise, technical
- Explain your reasoning when asked
- Admit when you don't know something
- Never hallucinate file contents — read the actual file

## Constraints
- You can ONLY access files within this workspace
- You MUST ask permission before writing or modifying files
- You MUST NOT fabricate code or file contents
- When referencing files, always verify they exist first
- Keep responses focused — don't repeat the user's question back

## Response Style
- Use code blocks with language tags
- Reference file paths relative to workspace root
- When showing diffs, use unified diff format
- For long explanations, use headers and bullet points`],
  ['.parallx/USER.md', `# User

## About
- (Name, role, what you do)

## Current focus
- (What you're working on)

## Preferences
- (How you like the AI to behave)
`],
  ['.parallx/TOOLS.md', `# Tool Usage Guidelines

## When to Use Tools
- Use file read/search tools to answer questions about workspace content
- Use write tools only when explicitly asked to create or modify files
- Prefer targeted file reads over broad searches when the user specifies a file

## Tool Invocation Style
- Always explain what you're about to do before invoking a tool
- Report tool results clearly and concisely
- If a tool fails, explain the failure and suggest alternatives`],
  // M87 S2 — heartbeat purpose file. Scaffolded by /init like SOUL/TOOLS,
  // but deliberately NOT in OPENCLAW_BOOTSTRAP_FILES: watches are heartbeat
  // seed context only (see heartbeatPurpose.ts), never per-turn prompt bloat.
  [HEARTBEAT_PURPOSE_PATH, HEARTBEAT_PURPOSE_TEMPLATE],
]);

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
    return OPENCLAW_BOOTSTRAP_FILES.map((path) => {
      const fallback = OPENCLAW_BOOTSTRAP_DEFAULTS.get(path);
      if (fallback) {
        return { name: path, path, content: fallback, missing: false };
      }
      return { name: path, path, missing: true };
    });
  }

  const entries: IOpenclawBootstrapEntry[] = [];
  for (const path of OPENCLAW_BOOTSTRAP_FILES) {
    const content = await readWorkspaceFile(path);
    if (typeof content === 'string') {
      entries.push({ name: path, path, content, missing: false });
      continue;
    }
    const fallback = OPENCLAW_BOOTSTRAP_DEFAULTS.get(path);
    if (fallback) {
      entries.push({ name: path, path, content: fallback, missing: false });
      continue;
    }
    entries.push({ name: path, path, missing: true });
  }

  // M85 Slice D — the memory INDEX is a guaranteed part of every turn's
  // context ("index always loaded, bodies on demand"). The canonical index
  // lives at .parallx/memory/MEMORY.md (workspaceMemoryService); the root
  // paths are legacy fallbacks. Before this fix only the ROOT paths were
  // probed, so the canonical index was silently never loaded and the memory
  // prompt's "the index is in your context every turn" was false.
  for (const path of ['.parallx/memory/MEMORY.md', 'MEMORY.md', 'memory.md'] as const) {
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

// ── History flattening — "the transcript is sacred" (docs/HARNESS.md §1) ──
//
// The ONE owner of pair→message flattening. Session pairs already persist the
// full tool record (`IChatToolInvocationContent`: name, args, status, isError,
// result) — the old flatteners here and in openclawDefaultParticipant dropped
// every tool part, so each turn the model forgot what it had read and run,
// then re-read and re-derived it. This flattener re-emits the tool exchanges
// in round order, exactly the shape the live tool loop produces
// (assistant+toolCalls followed by role:'tool' results), which both providers
// already translate.
//
// Aging policy (upstream pattern: Anthropic context-management clears OLD
// tool results but keeps the calls): pairs older than the most recent
// RECENT_FULL_FIDELITY_PAIRS keep their tool CALLS verbatim (long string args
// elided) while RESULTS decay to a head preview + an explicit marker telling
// the model to re-run the tool if it needs the full output. Error results
// keep a longer preview — failure memory is what prevents repeated failures.

const RECENT_FULL_FIDELITY_PAIRS = 2;
const AGED_RESULT_PREVIEW_CHARS = 200;
const AGED_ERROR_PREVIEW_CHARS = 800;
const AGED_ARG_VALUE_CHARS = 200;

function elideAgedArgs(args: Record<string, unknown>): Record<string, unknown> {
  let changed = false;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === 'string' && value.length > AGED_ARG_VALUE_CHARS) {
      out[key] = `${value.slice(0, AGED_ARG_VALUE_CHARS)}…[+${value.length - AGED_ARG_VALUE_CHARS} chars elided by history aging]`;
      changed = true;
    } else {
      out[key] = value;
    }
  }
  return changed ? out : args;
}

function toolResultText(inv: IChatToolInvocationContent, aged: boolean): string {
  if (inv.status === 'rejected') {
    return '[Tool call rejected by user]';
  }
  const isError = inv.status === 'error' || inv.isError === true || inv.result?.isError === true;
  let base = inv.result?.content ?? '';
  if (!base) {
    return isError ? '[TOOL ERROR] (no result recorded)' : '[no result recorded]';
  }
  if (isError && !base.startsWith('[TOOL ERROR]')) {
    base = `[TOOL ERROR] ${base}`;
  }
  if (!aged) {
    return base;
  }
  const cap = isError ? AGED_ERROR_PREVIEW_CHARS : AGED_RESULT_PREVIEW_CHARS;
  if (base.length <= cap) {
    return base;
  }
  return `${base.slice(0, cap)}\n[…result truncated by history aging — ${base.length} chars total; re-run ${inv.toolName} if the full output is needed]`;
}

/**
 * Flatten persisted request/response pairs into provider-ready messages,
 * preserving the tool exchange record.
 *
 * Text parts included: Markdown and CodeBlock. Thinking parts are deliberately
 * EXCLUDED — the old duck-typed check (`'content' in part`) replayed prior
 * reasoning as assistant prose; upstream strips prior-turn thinking (the
 * Anthropic API does this server-side), and replaying it both bloats history
 * and teaches the model to narrate instead of act.
 */
export function flattenPairsToMessages(
  history: IChatParticipantContext['history'],
): IChatMessage[] {
  const messages: IChatMessage[] = [];
  const agedBefore = history.length - RECENT_FULL_FIDELITY_PAIRS;

  for (let i = 0; i < history.length; i++) {
    const pair = history[i];
    const aged = i < agedBefore;
    messages.push({ role: 'user', content: pair.request.text });

    const textBuf: string[] = [];
    let toolGroup: IChatToolInvocationContent[] = [];

    const flushRound = (): void => {
      const text = textBuf.join('\n');
      if (toolGroup.length > 0) {
        messages.push({
          role: 'assistant',
          content: text,
          toolCalls: toolGroup.map((inv) => ({
            function: {
              name: inv.toolName,
              arguments: aged ? elideAgedArgs(inv.args) : inv.args,
            },
          })),
        });
        for (const inv of toolGroup) {
          messages.push({
            role: 'tool',
            toolName: inv.toolName,
            content: toolResultText(inv, aged),
          });
        }
      } else if (text) {
        messages.push({ role: 'assistant', content: text });
      }
      textBuf.length = 0;
      toolGroup = [];
    };

    for (const part of pair.response.parts) {
      if (part.kind === ChatContentPartKind.ToolInvocation) {
        toolGroup.push(part as IChatToolInvocationContent);
        continue;
      }
      // A text part after a tool group closes that round.
      if (toolGroup.length > 0) {
        flushRound();
      }
      if (part.kind === ChatContentPartKind.Markdown && typeof (part as { content?: unknown }).content === 'string') {
        textBuf.push((part as { content: string }).content);
      } else if (part.kind === ChatContentPartKind.CodeBlock && typeof (part as { code?: unknown }).code === 'string') {
        textBuf.push('```\n' + (part as { code: string }).code + '\n```');
      }
      // Thinking / Progress / Warning / Confirmation / Edit* parts: skipped.
    }
    flushRound();
  }

  return messages;
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

  messages.push(...flattenPairsToMessages(history));

  messages.push({
    role: 'user',
    content: request.text,
    images: request.attachments?.filter((attachment) => attachment.kind === 'image'),
  });

  return messages;
}

/**
 * @deprecated Use {@link runOpenclawReadOnlyTurn} from openclawReadOnlyTurnRunner.ts
 * for readonly participants, or {@link runOpenclawTurn} from openclawTurnRunner.ts
 * for the default participant. This function lacks retry logic and tool policy filtering.
 */
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
  // OpenClaw participants derive their own route — never consume the old
  // regex-based turnState.turnRoute from the legacy routing cascade.
  const route: IChatTurnRoute = {
    kind: 'grounded',
    reason: defaultReason,
  };
  const retrievalPlan: IRetrievalPlan = {
    intent: 'question',
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