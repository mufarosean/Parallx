// defaultParticipant.ts — Default chat participant (M9 Cap 3 + Cap 4 + Cap 6 agentic loop)
//
// The default agent that handles messages when no @mention is specified.
// Sends the conversation to ILanguageModelsService and streams the response
// back through the IChatResponseStream.
//
// Cap 4 additions: mode-aware system prompts, mode capability enforcement.
// Cap 6 additions: agentic loop — tool call → execute → feed back → repeat.
//
// VS Code reference:
//   Built-in chat participant registered in chat.contribution.ts
//   Agent loop: chatAgents.ts — processes tool_calls, feeds results back

import type { IDisposable } from '../../../platform/lifecycle.js';
import type {
  IChatParticipant,
  IChatParticipantHandler,
  IChatParticipantRequest,
  IChatParticipantContext,
  IChatResponseStream,
  ICancellationToken,
  IChatParticipantResult,
  IChatMessage,
  IChatRequestOptions,
  IToolCall,
  IToolResult,
  IChatEditProposalContent,
  EditProposalOperation,
  IContextPill,
} from '../../../services/chatTypes.js';
import { ChatContentPartKind } from '../../../services/chatTypes.js';
import { captureSession } from '../../../workspace/staleGuard.js';
import type {
  IDefaultParticipantServices,
  IInitCommandServices,
  IMentionResolutionServices,
  IRetrievalPlan,
  ISystemPromptContext,
} from '../chatTypes.js';
import { buildSystemPrompt } from '../config/chatSystemPrompts.js';
import { getModeCapabilities, shouldIncludeTools, shouldUseStructuredOutput } from '../config/chatModeCapabilities.js';
import { executeInitCommand } from '../commands/initCommand.js';
import { TokenBudgetService } from '../../../services/tokenBudgetService.js';
import { extractMentions, resolveMentions } from '../utilities/chatMentionResolver.js';
import { SlashCommandRegistry, parseSlashCommand } from '../config/chatSlashCommands.js';
import { loadUserCommands } from '../utilities/userCommandLoader.js';

/** Default maximum agentic loop iterations. */
const DEFAULT_MAX_ITERATIONS = 10;
/** Ask mode needs fewer iterations — it only reads, never writes. */
const ASK_MODE_MAX_ITERATIONS = 5;

/**
 * Fallback: extract tool calls from text content when the model emits them
 * as JSON instead of using the structured tool_calls API field.
 *
 * Small models (e.g. llama3.1:8b, qwen2.5) sometimes respond with:
 *   {"name": "read_file", "parameters": {"path": "file.md"}}
 *   {"name": "read_file", "arguments": {"path": "file.md"}}
 * or wrapped in markdown code blocks, rather than using Ollama's tool_calls.
 *
 * @returns Extracted tool calls and the cleaned text (JSON stripped).
 */
/** @internal Exported for unit testing. */
export function _extractToolCallsFromText(text: string): { toolCalls: IToolCall[]; cleanedText: string } {
  const toolCalls: IToolCall[] = [];
  let cleaned = text;

  // Pattern 1: JSON object with "name" + "parameters" or "arguments" (single or in array)
  // Matches both bare JSON and JSON inside ```json code blocks.
  // Ollama/OpenAI format uses "arguments"; some models also emit "parameters".
  // ARGS_KEY includes surrounding quotes because JSON keys are quoted strings.
  const ARGS_KEY = '"(?:parameters|arguments)"';
  const jsonPatterns = [
    // Code-fenced JSON block (object)
    new RegExp('```(?:json)?\\s*\\n?({[\\s\\S]*?"name"\\s*:\\s*"[\\w]+"[\\s\\S]*?' + ARGS_KEY + '\\s*:[\\s\\S]*?})\\s*\\n?```', 'g'),
    // Code-fenced JSON block (array)
    new RegExp('```(?:json)?\\s*\\n?(\\[[\\s\\S]*?"name"\\s*:\\s*"[\\w]+"[\\s\\S]*?' + ARGS_KEY + '\\s*:[\\s\\S]*?\\])\\s*\\n?```', 'g'),
    // Bare JSON object
    new RegExp('({\\s*"name"\\s*:\\s*"[\\w]+"\\s*,\\s*' + ARGS_KEY + '\\s*:\\s*{[^{}]*(?:{[^{}]*}[^{}]*)*}\\s*})', 'g'),
    // JSON array of tool calls
    new RegExp('(\\[\\s*{\\s*"name"\\s*:\\s*"[\\w]+"\\s*,\\s*' + ARGS_KEY + '\\s*:[\\s\\S]*?}\\s*\\])', 'g'),
  ];

  for (const pattern of jsonPatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const jsonStr = match[1] || match[0];
      try {
        const parsed = JSON.parse(jsonStr);
        const items = Array.isArray(parsed) ? parsed : [parsed];
        for (const item of items) {
          // Accept both "parameters" and "arguments" keys (Ollama / OpenAI formats)
          const args = item.parameters ?? item.arguments;
          if (
            typeof item === 'object' && item !== null &&
            typeof item.name === 'string' && item.name.length > 0 &&
            typeof args === 'object' && args !== null
          ) {
            toolCalls.push({
              function: { name: item.name, arguments: args },
            });
            // Strip the matched JSON (including code fence if present) from cleaned text
            cleaned = cleaned.replace(match[0], '');
          }
        }
      } catch {
        // Not valid JSON — skip
      }
    }
    if (toolCalls.length > 0) { break; } // Don't double-match
  }

  // Strip common preamble narration small models add before JSON tool calls.
  // e.g. "Here is the JSON response with its proper arguments that best answers..."
  // e.g. "Here's the JSON response for the function call:"
  // e.g. "Based on the conversation history, here is a JSON response..."
  if (toolCalls.length > 0) {
    cleaned = cleaned
      .replace(/(?:Based on[\s\S]{0,60},\s*)?[Hh]ere(?:'s| is) the JSON response[\s\S]{0,80}?:\s*/g, '')
      .replace(/(?:I will|Let me|I'll)\s+(?:now\s+)?(?:call|use|invoke|execute)\s+the\s+\w+\s+tool[\s\S]{0,40}?[.:]/gi, '');
  }

  // Trim leftover whitespace / empty lines
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();

  return { toolCalls, cleanedText: cleaned };
}

/**
 * Strip prose narration about tool calls from model output.
 *
 * Small models sometimes describe tool calls in natural language instead of
 * executing them (e.g. "Here's a function call to read_file...  This will read
 * the text content...  It seems the file is not located...").  This function
 * removes those narrated tool-call blocks so the user only sees useful content.
 */
export function _stripToolNarration(text: string): string {
  // Remove sentences that describe making function/tool calls
  let cleaned = text
    // "Here's a/an/the/an alternative function call to X with its proper arguments:"
    .replace(/[Hh]ere(?:'s| is) (?:a|an|the|an alternative) (?:function|tool) call[^.:\n]*[.:]\s*/g, '')
    // "Based on the functions/context provided..."
    .replace(/[Bb]ased on the (?:functions?|tools?|context)[^.:\n]*[.:]\s*/g, '')
    // "with its proper arguments:"
    .replace(/with its proper arguments[.:]\s*/gi, '')
    // "I'll/Let me call/use/invoke the X tool/function"
    .replace(/(?:I'?(?:ll|m going to)|[Ll]et me)\s+(?:now\s+)?(?:call|use|invoke|try|execute)\s+(?:the\s+)?(?:`?\w+`?\s+)?(?:function|tool)[^.:\n]*[.:]\s*/gi, '')
    // "This function/tool call will..."
    .replace(/[Tt]his (?:function|tool) call will[^.\n]*\.\s*/g, '')
    // "This will list/read/search/get all/the..."
    .replace(/This will (?:read|list|search|get|fetch|retrieve|provide|show) (?:all |the )?[^.\n]*\.\s*/gi, '')
    // "The output of this function call indicates..."
    .replace(/[Tt]he output of this (?:function|tool) call[^.\n]*\.\s*/g, '')
    // "Alternatively, since there are no pages... you could use X"
    .replace(/[Aa]lternatively,?\s+(?:since\s+)?[^.\n]*(?:you could|you can)\s+use\s+`?\w+`?[^.\n]*[.:]\s*/g, '')
    // "It seems that the file X is not located..."  (hallucinated execution result)
    .replace(/It seems (?:that )?the (?:file|page)[^"\n]*(?:"[^"]*"[^.\n]*)?(?:not (?:located|found)|does(?:n't| not) exist)[^.\n]*\.\s*/gi, '')
    // "Let me try again with a different approach."
    .replace(/[Ll]et me try (?:again )?with a different approach\.\s*/g, '')
    // "Based on the context and conversation history, I'll provide a JSON..."
    .replace(/Based on[^,.\n]*,\s*I'll provide a JSON[^.\n]*\.\s*/gi, '')
    // ── Structured narration patterns ──
    // "Action:" block followed by JSON — model narrating a tool call
    .replace(/\bAction:\s*```[\s\S]*?```/gi, '')
    .replace(/\bAction:\s*\{[\s\S]*?\}\s*/gi, '')
    // "Execution:" block with hallucinated results
    .replace(/\bExecution:\s*```[\s\S]*?```/gi, '')
    .replace(/\bExecution:\s*\{[\s\S]*?\}\s*/gi, '')
    // "Let's execute this action/tool/function..."
    .replace(/[Ll]et'?s\s+execute\s+this\s+(?:action|tool|function)[^.\n]*\.?\s*/gi, '')
    // "To determine/find/get X, I will Y"
    .replace(/To (?:determine|find|get|check|count|list|know)\s+[^,.\n]*,\s*I (?:will|am going to|need to)[^.\n]*\.?\s*/gi, '')
    // "The user wants to know..." (model restating the request)
    .replace(/[Tt]he user (?:wants|needs|is asking|asked)\s+(?:to\s+)?(?:know|find|get|see|understand)[^.\n]*\.?\s*/gi, '');

  // Trim excessive whitespace
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();
  return cleaned;
}

/** Default network timeout in milliseconds. */
const DEFAULT_NETWORK_TIMEOUT_MS = 60_000;
/** Context overflow threshold — warn at this fraction of context length. */
const CONTEXT_OVERFLOW_WARN_THRESHOLD = 0.8;

// ── Planner gate ──
//
// The planner (thinking layer) runs on EVERY message when available.
// It classifies intent and decides what context the model needs.
// See docs/research/INTERACTION_LAYER_ARCHITECTURE.md for rationale.

/**
 * Rough token estimation: chars / 4.
 * This is the same heuristic used by VS Code's chat implementation.
 */
function estimateTokens(messages: readonly IChatMessage[]): number {
  let chars = 0;
  for (const m of messages) {
    chars += m.content.length;
  }
  return Math.ceil(chars / 4);
}

/**
 * Categorize a fetch/network error into a user-friendly message.
 */
function categorizeError(err: unknown): { message: string; isNetworkError: boolean } {
  if (err instanceof DOMException && err.name === 'AbortError') {
    return { message: '', isNetworkError: false }; // Handled separately
  }
  if (err instanceof DOMException && err.name === 'TimeoutError') {
    return {
      message: 'Request timed out. The model may be loading or the Ollama server is unresponsive. Try again or check that Ollama is running.',
      isNetworkError: true,
    };
  }
  const msg = err instanceof Error ? err.message : String(err);
  // Detect "Ollama not running" — fetch to localhost fails
  if (msg.includes('Failed to fetch') || msg.includes('ECONNREFUSED') || msg.includes('NetworkError') || msg.includes('fetch failed')) {
    return {
      message: 'Ollama is not running. Install and start Ollama from https://ollama.com, then try again.',
      isNetworkError: true,
    };
  }
  // Detect "model not found" — Ollama returns 404 with specific message
  if (msg.includes('model') && (msg.includes('not found') || msg.includes('404'))) {
    // Extract model name if possible
    const modelMatch = msg.match(/model\s+['"]?([^\s'"]+)/i);
    const modelName = modelMatch?.[1] ?? 'the requested model';
    return {
      message: `Model "${modelName}" not found. Run \`ollama pull ${modelName}\` to download it.`,
      isNetworkError: false,
    };
  }
  return { message: msg, isNetworkError: false };
}

// IDefaultParticipantServices — now defined in chatTypes.ts (M13 Phase 1)
export type { IDefaultParticipantServices } from '../chatTypes.js';

/** Default participant ID — must match ChatAgentService's DEFAULT_AGENT_ID. */
const DEFAULT_PARTICIPANT_ID = 'parallx.chat.default';

/**
 * Create the default chat participant.
 *
 * Returns an IDisposable that holds the participant descriptor.
 * The caller (chatTool.ts) registers this with IChatAgentService.
 */
export function createDefaultParticipant(services: IDefaultParticipantServices): IChatParticipant & IDisposable {

  const configMaxIterations = services.maxIterations ?? DEFAULT_MAX_ITERATIONS;

  // ── Slash command registry (M11 Tasks 3.5–3.7) ──
  const commandRegistry = new SlashCommandRegistry();

  // Load user-defined commands from .parallx/commands/ (fire-and-forget)
  if (services.userCommandFileSystem) {
    loadUserCommands(services.userCommandFileSystem).then((cmds) => {
      if (cmds.length > 0) {
        commandRegistry.registerCommands(cmds);
      }
    }).catch(() => { /* best-effort */ });
  }

  const handler: IChatParticipantHandler = async (
    request: IChatParticipantRequest,
    context: IChatParticipantContext,
    response: IChatResponseStream,
    token: ICancellationToken,
  ): Promise<IChatParticipantResult> => {

    // ── Mode capability enforcement ──

    const capabilities = getModeCapabilities(request.mode);

    // Ask mode: fewer iterations (read-only context gathering), Agent: full budget
    const maxIterations = capabilities.canAutonomous
      ? configMaxIterations
      : Math.min(configMaxIterations, ASK_MODE_MAX_ITERATIONS);

    // ── /init command handler (M11 Task 1.6) ──

    if (request.command === 'init') {
      const initServices: IInitCommandServices = {
        sendChatRequest: services.sendChatRequest,
        getWorkspaceName: services.getWorkspaceName,
        listFiles: services.listFilesRelative
          ? (rel) => services.listFilesRelative!(rel)
          : undefined,
        readFile: services.readFileRelative
          ? (rel) => services.readFileRelative!(rel)
          : undefined,
        writeFile: services.writeFileRelative
          ? (rel, content) => services.writeFileRelative!(rel, content)
          : undefined,
        exists: services.existsRelative
          ? (rel) => services.existsRelative!(rel)
          : undefined,
        invalidatePromptFiles: services.invalidatePromptFiles,
      };
      await executeInitCommand(initServices, response);
      return {};
    }

    // ── Slash command detection (M11 Tasks 3.5–3.6) ──
    //
    // If the user typed /command, parse it and apply the prompt template.
    // Special handlers (/init, /compact) are dispatched above or below.
    const slashResult = parseSlashCommand(request.text, commandRegistry);
    let effectiveText = request.text;
    let activeCommand = request.command; // from the parser (chatRequestParser.ts)
    if (slashResult.command) {
      activeCommand = slashResult.commandName;
      // /compact is handled later (Task 3.8)
      if (slashResult.command.specialHandler === 'compact') {
        // Fall through — handled in the /compact section below
      } else if (slashResult.command.specialHandler === 'init') {
        // Already handled above via request.command
      } else {
        // Apply prompt template — context will be filled after context injection
        effectiveText = slashResult.remainingText;
      }
    }

    // ── /compact command handler (M11 Task 3.8) ──
    //
    // Summarize conversation history and replace old messages with a compact summary.
    // Shows token savings to the user.
    if (activeCommand === 'compact' || slashResult.command?.specialHandler === 'compact') {
      if (!services.sendSummarizationRequest) {
        response.markdown('`/compact` requires a summarization model. No summarization service available.');
        return {};
      }
      if (context.history.length < 2) {
        response.markdown('Nothing to compact — conversation history is too short.');
        return {};
      }

      response.progress('Compacting conversation history…');

      // Build history text for summarization
      const historyText = context.history.map((pair) => {
        const respText = pair.response.parts
          .map((p) => {
            const part = p as unknown as Record<string, unknown>;
            if ('text' in part && typeof part.text === 'string') { return part.text; }
            if ('code' in part && typeof part.code === 'string') { return '```\n' + part.code + '\n```'; }
            return '';
          })
          .filter(Boolean)
          .join('\n');
        return `User: ${pair.request.text}\nAssistant: ${respText}`;
      }).join('\n\n---\n\n');

      const beforeTokens = Math.ceil(historyText.length / 4);

      // Summarize via LLM
      const summaryPrompt: IChatMessage[] = [
        {
          role: 'system',
          content:
            'You are a conversation summarizer. Condense the following conversation history into a concise context summary. ' +
            'Preserve all key facts, decisions, code references, and action items. Output ONLY the summary.',
        },
        { role: 'user', content: historyText },
      ];

      let summaryText = '';
      for await (const chunk of services.sendSummarizationRequest(summaryPrompt)) {
        if (chunk.content) { summaryText += chunk.content; }
      }

      if (summaryText) {
        const afterTokens = Math.ceil(summaryText.length / 4);
        const saved = beforeTokens - afterTokens;

        // Actually replace session history with the compacted summary
        if (services.compactSession) {
          services.compactSession(context.sessionId, summaryText);
        }

        response.markdown(
          `**Conversation compacted.**\n\n` +
          `- Before: ~${beforeTokens.toLocaleString()} tokens (${context.history.length} turns)\n` +
          `- After: ~${afterTokens.toLocaleString()} tokens (summary)\n` +
          `- Saved: ~${saved.toLocaleString()} tokens (${Math.round((saved / beforeTokens) * 100)}%)\n\n` +
          `The summarized context will be used for future messages in this session.`,
        );
      } else {
        response.markdown('Could not generate a summary. The conversation was not modified.');
      }

      return {};
    }

    // ── Build system prompt with workspace context ──
    // Parallelize independent async calls to reduce pre-response latency.

    const [pageCount, fileCount, promptOverlayFromFiles, workspaceDigest, prefsBlock] = await Promise.all([
      services.getPageCount().catch(() => 0),
      services.getFileCount ? services.getFileCount().catch(() => 0) : Promise.resolve(undefined),
      services.getPromptOverlay ? services.getPromptOverlay().catch(() => undefined) : Promise.resolve(undefined),
      services.getWorkspaceDigest ? services.getWorkspaceDigest().catch(() => undefined) : Promise.resolve(undefined),
      services.getPreferencesForPrompt ? services.getPreferencesForPrompt().catch(() => undefined) : Promise.resolve(undefined),
    ]);

    // M15: AI Settings persona overlay takes priority over file-based prompt overlay.
    // Both replace PARALLX_IDENTITY in the system prompt via the promptOverlay field.
    const aiProfile = services.aiSettingsService?.getActiveProfile();
    const promptOverlay = aiProfile?.chat.systemPrompt || promptOverlayFromFiles;

    const promptContext: ISystemPromptContext = {
      workspaceName: services.getWorkspaceName(),
      pageCount,
      currentPageTitle: services.getCurrentPageTitle(),
      // Tools are sent via the Ollama API tools parameter, NOT in the system
      // prompt text.  Listing them in the prompt causes small models to narrate
      // about tool calls instead of using the structured API.
      tools: undefined,
      fileCount,
      isRAGAvailable: services.isRAGAvailable?.() ?? false,
      isIndexing: services.isIndexing?.() ?? false,
      promptOverlay,
      workspaceDigest,
    };

    const systemPrompt = buildSystemPrompt(request.mode, promptContext);

    // Append user preferences to system prompt (M10 Phase 5 — Task 5.2)
    const finalSystemPrompt = prefsBlock
      ? systemPrompt + '\n\n' + prefsBlock
      : systemPrompt;

    // Build the message list from conversation history + current request
    const messages: IChatMessage[] = [];

    // System prompt (mode-aware)
    messages.push({
      role: 'system',
      content: finalSystemPrompt,
    });

    // History (previous request/response pairs)
    for (const pair of context.history) {
      messages.push({
        role: 'user',
        content: pair.request.text,
      });

      // Extract text from response parts
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
        messages.push({
          role: 'assistant',
          content: responseText,
        });
      }
    }

    // ── Build user message with implicit context + attachments ──
    //
    // Following VS Code's implicit context pattern (chatImplicitContext.ts):
    // The content of the currently open page is injected directly into the user
    // message so the model can reference it without a tool call (zero round-trips).

    const contextParts: string[] = [];
    const mentionPills: IContextPill[] = [];

    // 0. @mention resolution (M11 Tasks 3.2–3.4)
    //
    // Extract @file:, @folder:, @workspace, @terminal mentions from
    // the user's raw text. Resolve each to context blocks + pills.
    // The clean text (mentions stripped) is used for the LLM message.
    const mentions = extractMentions(request.text);
    let userText = request.text;
    if (mentions.length > 0) {
      const mentionServices: IMentionResolutionServices = {
        readFileContent: services.readFileContent
          ? (path: string) => services.readFileContent!(path)
          : undefined,
        listFolderFiles: services.listFolderFiles
          ? (folderPath: string) => services.listFolderFiles!(folderPath)
          : undefined,
        retrieveContext: services.retrieveContext
          ? (query: string) => services.retrieveContext!(query)
          : undefined,
        getTerminalOutput: services.getTerminalOutput
          ? () => services.getTerminalOutput!()
          : undefined,
      };
      const mentionResult = await resolveMentions(
        request.text,
        mentions,
        mentionServices,
      );
      contextParts.push(...mentionResult.contextBlocks);
      mentionPills.push(...mentionResult.pills);
      userText = mentionResult.cleanText;
    }

    // 1. Implicit context: active canvas page content
    //
    // Cap at ~4000 tokens (16K chars) so a large page doesn't drown
    // the actual question and RAG context. The model can always use
    // read_current_page tool for the full text.
    const MAX_PAGE_CONTEXT_CHARS = 16_000;
    if (services.getCurrentPageContent) {
      try {
        const pageContext = await services.getCurrentPageContent();
        if (pageContext && pageContext.textContent) {
          const text = pageContext.textContent.length > MAX_PAGE_CONTEXT_CHARS
            ? pageContext.textContent.slice(0, MAX_PAGE_CONTEXT_CHARS) + '\n[…truncated — use read_current_page for full content]'
            : pageContext.textContent;
          contextParts.push(
            `[Currently open page: "${pageContext.title}" (id: ${pageContext.pageId})]\n${text}`,
          );
        }
      } catch {
        // Silently skip — implicit context is best-effort
      }
    }

    // 1b. RAG context: per-turn retrieval
    //
    // Direct embedding retrieval: embed the user's raw message, do hybrid
    // vector + BM25 search, inject top results.  This is the pattern used
    // by Open WebUI, AnythingLLM, Jan, and LibreChat — one LLM call total.
    //
    // The old M12 planner made a separate LLM call to classify intent and
    // generate search queries before the response call.  That doubled
    // latency on local Ollama (e.g. 45s planner + 13s response = 58s
    // vs native Ollama's 13s).  No mainstream local AI app does this.
    const ragSources: Array<{ uri: string; label: string; index?: number }> = [];
    let retrievalPlan: IRetrievalPlan | undefined;

    const hasActiveSlashCommand = !!(activeCommand && activeCommand !== 'compact');
    const isRagReady = services.isRAGAvailable?.() ?? false;

    // Synthetic plan — downstream code checks retrievalPlan for gating.
    // Always retrieve when RAG is ready; embedding scores filter relevance.
    retrievalPlan = {
      intent: 'question',
      reasoning: 'Direct retrieval — embedding similarity filters relevance.',
      needsRetrieval: isRagReady && !hasActiveSlashCommand,
      queries: [],
    };

    // Direct retrieval: embed user's raw message → hybrid search → inject results.
    if (services.retrieveContext && retrievalPlan.needsRetrieval) {
      try {
        const ragResult = await services.retrieveContext(userText);
        if (ragResult) {
          const alreadyInContext = new Set<string>();
          if (request.attachments?.length) {
            for (const att of request.attachments) {
              alreadyInContext.add(att.fullPath);
              alreadyInContext.add(att.name);
            }
          }
          for (const pill of mentionPills) {
            alreadyInContext.add(pill.label);
            const colonIdx = pill.id.indexOf(':');
            if (colonIdx > 0) {
              alreadyInContext.add(pill.id.substring(colonIdx + 1));
            }
          }

          const filteredSources = ragResult.sources.filter((s) => {
            return !alreadyInContext.has(s.uri) && !alreadyInContext.has(s.label);
          });

          if (filteredSources.length > 0 || ragResult.sources.length === 0) {
            contextParts.push(ragResult.text);
          }

          for (const source of filteredSources) {
            response.reference(source.uri, source.label, source.index);
            ragSources.push(source);
          }
        }
      } catch {
        // RAG retrieval is best-effort — don't block the request
      }
    }

    // 1c. Memory context: retrieve relevant past conversation memories (M10 Phase 5)
    // Gated by the plan — conversational messages don't need past memories.
    // Capped at ~1000 tokens (4K chars) so cross-session memory doesn't
    // overwhelm the current query's context.
    const MAX_MEMORY_CONTEXT_CHARS = 4_000;
    if (services.recallMemories && retrievalPlan?.needsRetrieval !== false) {
      try {
        let memoryContext = await services.recallMemories(userText);
        if (memoryContext) {
          if (memoryContext.length > MAX_MEMORY_CONTEXT_CHARS) {
            memoryContext = memoryContext.slice(0, MAX_MEMORY_CONTEXT_CHARS) + '\n[…memory truncated]';
          }
          contextParts.push(memoryContext);
        }
      } catch {
        // Memory recall is best-effort — don't block the request
      }
    }

    // 2. Explicit attachments: user-added file context
    if (request.attachments?.length && services.readFileContent) {
      for (const attachment of request.attachments) {
        try {
          const content = await services.readFileContent(attachment.fullPath);
          contextParts.push(`File: ${attachment.name}\n\`\`\`\n${content}\n\`\`\``);
        } catch {
          contextParts.push(`File: ${attachment.name}\n[Could not read file]`);
        }
      }
    }

    // 2b. Report context pills to the UI (M11 Task 1.10)
    //
    // After all context sources are resolved, build pills for display.
    const pills: IContextPill[] = [];
    if (services.reportContextPills) {

      // System prompt overlay (SOUL + AGENTS + TOOLS)
      const sysContent = messages[0]?.content ?? '';
      pills.push({
        id: 'system-prompt',
        label: 'System prompt',
        type: 'system',
        tokens: Math.ceil(sysContent.length / 4),
        removable: false,
      });

      // RAG sources
      for (const src of ragSources) {
        pills.push({
          id: src.uri,
          label: src.label,
          type: 'rag',
          tokens: 0, // token count is estimated from context part, rough
          removable: true,
        });
      }

      // Explicit attachments
      if (request.attachments?.length) {
        for (const att of request.attachments) {
          pills.push({
            id: att.fullPath,
            label: att.name,
            type: 'attachment',
            tokens: 0,
            removable: true,
          });
        }
      }

      // @mention-resolved pills (M11 Tasks 3.2–3.4)
      pills.push(...mentionPills);

      // Estimate tokens for each pill from context parts
      // (rough: distribute non-system context proportionally)
      const totalNonSysChars = contextParts.reduce((sum, p) => sum + p.length, 0);
      for (const pill of pills) {
        if (pill.type === 'rag' || pill.type === 'attachment') {
          // Find the matching context part by label
          const match = contextParts.find(p => p.includes(pill.label));
          if (match) {
            (pill as { tokens: number }).tokens = Math.ceil(match.length / 4);
          } else if (totalNonSysChars > 0 && pills.length > 1) {
            // Fallback: evenly distribute
            const nonSysPills = pills.filter(p => p.type !== 'system');
            (pill as { tokens: number }).tokens = Math.ceil(totalNonSysChars / nonSysPills.length / 4);
          }
        }
      }

      services.reportContextPills(pills);
    }

    // 2b½. Filter out excluded context sources (M11 Task 1.10)
    //
    // If the user has excluded pills via the UI, remove those context parts
    // so the LLM doesn't see them.
    if (services.getExcludedContextIds) {
      const excluded = services.getExcludedContextIds();
      if (excluded.size > 0) {
        // Remove context parts that belong to excluded pills (by label or URI match)
        for (let i = contextParts.length - 1; i >= 0; i--) {
          const part = contextParts[i];
          const shouldExclude = pills.some(
            (pill: IContextPill) => excluded.has(pill.id) && pill.removable && part.includes(pill.label),
          );
          if (shouldExclude) {
            contextParts.splice(i, 1);
          }
        }
      }
    }

    // 2c. Token budget allocation (M11 Task 1.8)
    //
    // Apply token budget to trim RAG context and history if they exceed
    // their allotted slots. This prevents context window overflow before
    // the ad-hoc summarization safety net kicks in.
    //
    // When the model's context length isn't available yet (first call before
    // the cache is warm), use a conservative fallback so budgeting always runs.
    // Without this, the very first request sends unbounded context.
    const BUDGET_FALLBACK_CTX = 8192;
    const contextWindow = services.getModelContextLength?.() || BUDGET_FALLBACK_CTX;
    if (contextParts.length > 0) {
      const budgetService = new TokenBudgetService();
      const ragContent = contextParts.join('\n\n');
      const historyContent = messages
        .filter(m => m.role !== 'system')
        .map(m => m.content)
        .join('\n');

      const budgetResult = budgetService.allocate(
        contextWindow,
        messages[0]?.content ?? '',
        ragContent,
        historyContent,
        userText,
      );

      // If RAG was trimmed, replace contextParts with trimmed version
      if (budgetResult.wasTrimmed && budgetResult.slots['ragContext'] !== ragContent) {
        contextParts.length = 0;
        const trimmed = budgetResult.slots['ragContext'];
        if (trimmed) {
          contextParts.push(trimmed);
        }
      }

      // If history was trimmed, truncate the messages array
      if (budgetResult.wasTrimmed && budgetResult.slots['history'] !== historyContent) {
        // Keep system prompt (index 0) and replace history with trimmed version
        const trimmedHistory = budgetResult.slots['history'];
        // Remove old history messages, re-add as single summarized message
        while (messages.length > 1) {
          messages.pop();
        }
        if (trimmedHistory) {
          messages.push({
            role: 'user',
            content: '[Summarized conversation context]\n' + trimmedHistory,
          });
          messages.push({
            role: 'assistant',
            content: 'Understood, I have the context.',
          });
        }
      }

      if (budgetResult.warning) {
        response.progress(budgetResult.warning);
      }

      // Report budget breakdown to the UI (Task 4.8)
      // Use post-trim values from budgetResult.slots so the UI shows actual usage
      if (services.reportBudget) {
        const sysTokens = Math.ceil((messages[0]?.content ?? '').length / 4);
        const ragTokens = Math.ceil((budgetResult.slots['ragContext'] ?? ragContent).length / 4);
        const histTokens = Math.ceil((budgetResult.slots['history'] ?? historyContent).length / 4);
        const userTokens = Math.ceil(userText.length / 4);
        const totalSlots = contextWindow;
        services.reportBudget([
          { label: 'System', used: sysTokens, allocated: Math.ceil(totalSlots * 0.10), color: '#6c71c4' },
          { label: 'RAG',    used: ragTokens,  allocated: Math.ceil(totalSlots * 0.30), color: '#268bd2' },
          { label: 'History', used: histTokens, allocated: Math.ceil(totalSlots * 0.30), color: '#859900' },
          { label: 'User',   used: userTokens,  allocated: Math.ceil(totalSlots * 0.30), color: '#cb4b16' },
        ]);
      }
    }

    // 3. Compose final user message (use userText — mentions stripped)
    //
    // If a slash command was detected, apply its prompt template now
    // (substituting {input} and {context}).
    //
    // M12: If a retrieval plan is available, inject a reasoning hint so the
    // LLM understands the user's INTENT, not just their literal words.
    let userContent: string;
    if (slashResult.command && !slashResult.command.specialHandler) {
      const contextStr = contextParts.join('\n\n');
      const templated = commandRegistry.applyTemplate(
        slashResult.command,
        effectiveText,
        contextStr,
      );
      userContent = templated ?? effectiveText;
    } else {
      const parts: string[] = [];

      // M12: Inject planner reasoning as a hint before the retrieved context.
      // This guides the LLM to reason about what the user NEEDS, not just what they said.
      if (retrievalPlan && retrievalPlan.reasoning && retrievalPlan.needsRetrieval) {
        parts.push(
          `[Retrieval Analysis]\n` +
          `Intent: ${retrievalPlan.intent}\n` +
          `Analysis: ${retrievalPlan.reasoning}`,
        );
      }

      if (contextParts.length > 0) {
        parts.push(contextParts.join('\n\n'));
      }

      parts.push(userText);
      userContent = parts.join('\n\n');
    }

    messages.push({
      role: 'user',
      content: userContent,
    });

    // ── Context overflow detection & LLM-based summarization ──

    const contextLength = services.getModelContextLength?.() || BUDGET_FALLBACK_CTX;
    {
      const tokenEstimate = estimateTokens(messages);
      const warnThreshold = Math.floor(contextLength * CONTEXT_OVERFLOW_WARN_THRESHOLD);

      if (tokenEstimate > contextLength && services.sendSummarizationRequest) {
        // Exceeded context — summarize older messages (invisible to user)
        try {
          const historyToSummarize = messages.slice(1, -1); // exclude system + current user
          if (historyToSummarize.length > 2) {
            const summaryPrompt: IChatMessage[] = [
              {
                role: 'system',
                content:
                  'You are a conversation summarizer. Condense the following conversation history into a concise context message. ' +
                  'Preserve all key facts, decisions, and code references. Output ONLY the summary, no preamble.',
              },
              {
                role: 'user',
                content: historyToSummarize.map((m) => `[${m.role}]: ${m.content}`).join('\n\n'),
              },
            ];

            let summaryText = '';
            for await (const chunk of services.sendSummarizationRequest(summaryPrompt)) {
              if (chunk.content) { summaryText += chunk.content; }
            }

            if (summaryText) {
              // Replace history with summary — keep system prompt + summary + current user msg
              const systemMsg = messages[0];
              const currentMsg = messages[messages.length - 1];
              messages.length = 0;
              messages.push(systemMsg);
              messages.push({ role: 'assistant', content: `[Conversation summary]: ${summaryText}` });
              messages.push(currentMsg);
            }
          }
        } catch {
          // Summarization failed — proceed with full history (best effort)
        }
      } else if (tokenEstimate > warnThreshold) {
        response.warning(
          `Approaching context limit (${tokenEstimate} / ${contextLength} estimated tokens). ` +
          'Older messages may be summarized automatically if the conversation continues.',
        );
      }
    }

    // Build request options (mode-aware)
    // Without the LLM planner, we no longer classify intent.  Always send
    // tools — the model ignores them when not needed.  This matches how
    // ChatGPT and Open WebUI handle tool availability.
    const isConversational = false;
    const options: IChatRequestOptions = {
      tools: (!isConversational && shouldIncludeTools(request.mode))
        ? (capabilities.canAutonomous ? services.getToolDefinitions() : services.getReadOnlyToolDefinitions())
        : undefined,
      // Edit mode: use JSON structured output
      format: shouldUseStructuredOutput(request.mode) ? { type: 'object' } : undefined,
      // Enable thinking/reasoning mode — the provider passes this to Ollama's
      // `think` parameter.  Models that support it (DeepSeek-R1, QwQ) will
      // stream reasoning tokens separately; others silently ignore it.
      think: true,
      // M15: Apply model settings from the active AI profile
      temperature: aiProfile?.model.temperature,
      maxTokens: aiProfile?.model.maxTokens || undefined,
    };

    // Create an AbortController linked to the cancellation token
    const abortController = new AbortController();
    if (token.isCancellationRequested) {
      abortController.abort();
    }
    const cancelListener = token.onCancellationRequested(() => {
      abortController.abort();
    });

    // Link session cancellation signal (fires on workspace switch)
    const sessionSignal = services.sessionManager?.activeContext?.cancellationSignal;
    if (sessionSignal) {
      if (sessionSignal.aborted) {
        abortController.abort();
      } else {
        sessionSignal.addEventListener('abort', () => abortController.abort(), { once: true });
      }
    }

    // Network stall timeout — abort if no data received for this duration.
    // This resets on every chunk so thinking models (qwen3, DeepSeek-R1) that
    // stream for 60+ seconds don't get killed mid-response.  Only fires when
    // the model truly stalls (no data at all for the timeout period).
    const timeoutMs = services.networkTimeout ?? DEFAULT_NETWORK_TIMEOUT_MS;
    let networkTimeoutId: ReturnType<typeof setTimeout> | undefined;
    const resetNetworkTimeout = () => {
      if (timeoutMs <= 0) return;
      if (networkTimeoutId !== undefined) clearTimeout(networkTimeoutId);
      networkTimeoutId = setTimeout(() => {
        abortController.abort(new DOMException('Request timed out', 'TimeoutError'));
      }, timeoutMs);
    };
    resetNetworkTimeout();

    try {
      // ── Agentic loop (Cap 6 Task 6.2) ──
      //
      // When the model returns tool_calls, we:
      // 1. Render tool invocation cards (pending)
      // 2. Invoke each tool via ILanguageModelToolsService
      // 3. Update card status (running → completed/rejected)
      // 4. Append tool result messages
      // 5. Re-send the updated history back to the model
      // 6. Repeat until no more tool_calls or max iterations reached
      //
      // Ask mode: read-only tools only.  Agent mode: all tools.
      // Edit mode: tools are not sent in the request.

      const canInvokeTools = capabilities.canInvokeTools && !!services.invokeTool;
      const isEditMode = capabilities.canProposeEdits && !capabilities.canAutonomous;
      let producedContent = false;

      // Capture session guard for stale detection during tool invocations
      const toolGuard = services.sessionManager
        ? captureSession(services.sessionManager)
        : undefined;

      for (let iteration = 0; iteration <= maxIterations; iteration++) {
        // Yield check — allow a steering/queued message to interrupt between iterations
        if (token.isYieldRequested || token.isCancellationRequested) {
          break;
        }

        // Collect content and tool calls from the current LLM turn
        let turnContent = '';
        const turnToolCalls: IToolCall[] = [];
        let turnPromptTokens = 0;
        let turnCompletionTokens = 0;

        const stream = services.sendChatRequest(
          messages,
          options,
          abortController.signal,
        );

        for await (const chunk of stream) {
          if (token.isCancellationRequested || token.isYieldRequested) {
            break;
          }

          // Reset stall timeout — model is actively producing data
          resetNetworkTimeout();

          // Thinking content
          if (chunk.thinking) {
            response.thinking(chunk.thinking);
          }

          // Regular content — in Edit mode, buffer instead of streaming
          if (chunk.content) {
            if (!isEditMode) {
              response.markdown(chunk.content);
            }
            turnContent += chunk.content;
            producedContent = true;
          }

          // Collect tool calls from the response
          if (chunk.toolCalls && chunk.toolCalls.length > 0) {
            for (const tc of chunk.toolCalls) {
              turnToolCalls.push(tc);
            }
          }

          // Capture real token counts from Ollama's final chunk
          if (chunk.promptEvalCount) { turnPromptTokens = chunk.promptEvalCount; }
          if (chunk.evalCount) { turnCompletionTokens = chunk.evalCount; }
        }

        // Report token usage from this turn to the response stream
        if (turnPromptTokens > 0 || turnCompletionTokens > 0) {
          response.reportTokenUsage(turnPromptTokens, turnCompletionTokens);
        }

        // If cancelled or yield requested, break out
        if (token.isCancellationRequested || token.isYieldRequested) {
          break;
        }

        // ── Edit mode: parse JSON structured output into edit proposals ──
        if (isEditMode && turnContent) {
          _parseEditResponse(turnContent, response);
          break; // Edit mode is single-turn (no tool calls)
        }

        // ── Fallback: detect tool calls embedded as JSON in text content ──
        // Small models (llama3.1:8b, qwen2.5) sometimes emit tool calls as
        // JSON text in the content field instead of using the structured
        // tool_calls API.  If no structured tool calls were found, scan the
        // accumulated text for JSON tool call patterns.
        if (turnToolCalls.length === 0 && turnContent && canInvokeTools) {
          const { toolCalls: textToolCalls, cleanedText } = _extractToolCallsFromText(turnContent);
          if (textToolCalls.length > 0) {
            for (const tc of textToolCalls) {
              turnToolCalls.push(tc);
            }
            // Replace the already-rendered markdown to strip the raw JSON
            if (!isEditMode) {
              response.replaceLastMarkdown(cleanedText);
            }
            turnContent = cleanedText;
          }
        }

        // ── Narration detection ──
        // Small models sometimes narrate about tool calls in prose instead of
        // actually calling them (e.g. "Here's a function call to read_file...",
        // "Action: { name: list_files ... }", "The user wants to know...").
        // Strip narration regardless of whether real tool calls were found —
        // the user should never see prose describing the mechanics.
        if (turnToolCalls.length === 0 && turnContent) {
          const narrationPattern = /(?:here'?s?\s+(?:a|an|the)\s+(?:function|tool)\s+call|(?:I'?(?:ll|m going to)|let me)\s+(?:call|use|invoke|try)\s+(?:the\s+)?(?:`?\w+`?\s+)?(?:function|tool)|this (?:function|tool) call will|based on the (?:functions?|tools?|context)\s+provided|with its proper arguments|\bAction:\s*[{`]|\bExecution:\s*[{`]|let'?s\s+execute\s+this\s+(?:action|tool)|the user (?:wants|needs|is asking)\s+to\s+know)/i;
          if (narrationPattern.test(turnContent)) {
            const cleaned = _stripToolNarration(turnContent);
            if (!isEditMode) {
              response.replaceLastMarkdown(cleaned);
            }
            turnContent = cleaned;
          }
        }

        // No tool calls → model gave a final answer, done
        if (turnToolCalls.length === 0) {
          break;
        }

        // ── Tool-calling turn: discard streamed content ──
        // When the model calls tools, any text it produced alongside the
        // tool calls is intermediate thinking (raw JSON, narration, etc.)
        // — not the final answer.  The real answer comes on the next turn
        // after tool results are processed.  Clear streamed markdown so the
        // user only sees the final synthesized response.
        if (turnContent && !isEditMode) {
          response.replaceLastMarkdown('');
        }

        // Tool calls but not in Agent mode or no invokeTool wired
        if (!canInvokeTools) {
          response.warning('Tool calls are not available in this mode.');
          break;
        }

        // Guard against exceeding max iterations (the last iteration
        // should be the model's final response without tool calls)
        if (iteration === maxIterations) {
          response.warning(`Agentic loop reached maximum iterations (${maxIterations}). Stopping.`);
          break;
        }

        // Append the assistant message (with content + tool_calls) to history
        // so the model sees its own tool call + results on the next turn.
        // Note: Ollama expects the assistant message to be present before tool results.
        if (turnContent) {
          messages.push({ role: 'assistant', content: turnContent });
        }

        // ── Process each tool call ──

        for (const toolCall of turnToolCalls) {
          const tcName = toolCall.function.name;
          const tcArgs = toolCall.function.arguments;

          // Tools run silently — no tool cards shown to the user.
          // The user sees the final response, not the mechanics.
          producedContent = true;

          // Invoke the tool (skip if session is stale)
          let result: IToolResult;
          if (toolGuard && !toolGuard.isValid()) {
            result = { content: 'Workspace session changed — results discarded.', isError: true };
            console.warn('[DefaultParticipant] Skipping tool "%s" — workspace session changed', tcName);
          } else {
            try {
              result = await services.invokeTool!(tcName, tcArgs, token);
            } catch (err) {
              const errMsg = err instanceof Error ? err.message : String(err);
              result = { content: `Tool "${tcName}" failed: ${errMsg}`, isError: true };
            }
          }

          // Append tool result message for the model
          messages.push({
            role: 'tool',
            content: result.content,
            toolName: tcName,
          });
        }

        // Loop continues: messages now include tool results,
        // next iteration sends the full history back to the model.
      }

      // Clear network timeout since we got a response
      if (networkTimeoutId !== undefined) { clearTimeout(networkTimeoutId); }

      // ── Empty response detection ──
      if (!producedContent && !token.isCancellationRequested) {
        response.warning('The model returned an empty response. Try rephrasing your question or selecting a different model.');
      }

      // ── Post-response: preference extraction (M10 Phase 5 — Task 5.2) ──
      // Fire-and-forget — don't block the response
      if (services.extractPreferences && request.text) {
        services.extractPreferences(request.text).catch(() => {});
      }

      // ── Post-response: session memory (M10 Phase 5 — Task 5.1) ──
      // If the session has enough messages and hasn't been summarised yet,
      // create a summary for cross-session memory. We do this when the session
      // grows beyond the threshold, using the summarization LLM.
      if (
        services.storeSessionMemory &&
        services.isSessionEligibleForSummary &&
        services.hasSessionMemory &&
        services.sendSummarizationRequest &&
        context.history.length > 0
      ) {
        const sessionId = context.sessionId ?? '';
        const messageCount = context.history.length + 1; // +1 for current exchange
        if (sessionId && services.isSessionEligibleForSummary(messageCount)) {
          // Fire and forget — don't block chat response
          services.hasSessionMemory(sessionId).then(async (hasMemory) => {
            if (hasMemory) { return; }
            try {
              // Build a compact conversation transcript for summarization
              const transcript = context.history.map((p) => {
                const respText = p.response.parts
                  .map((part) => ('content' in part && typeof part.content === 'string') ? part.content : '')
                  .filter(Boolean).join(' ');
                return `User: ${p.request.text}\nAssistant: ${respText}`;
              }).join('\n\n');
              const current = `User: ${request.text}`;
              const fullTranscript = transcript + '\n\n' + current;

              const summaryPrompt: IChatMessage[] = [
                {
                  role: 'system',
                  content:
                    'Summarise this conversation in 2-4 sentences. Focus on the key topics discussed, ' +
                    'decisions made, and any important context. Output ONLY the summary.',
                },
                { role: 'user', content: fullTranscript },
              ];

              let summaryText = '';
              for await (const chunk of services.sendSummarizationRequest!(summaryPrompt)) {
                if (chunk.content) { summaryText += chunk.content; }
              }

              if (summaryText.trim()) {
                await services.storeSessionMemory!(sessionId, summaryText.trim(), messageCount);
              }
            } catch {
              // Memory summarisation is best-effort
            }
          }).catch(() => {});
        }
      }

      // M12: Append retrieval plan thought process (collapsible thinking UI)
      // Shows users the AI's reasoning and which queries it searched for.
      if (retrievalPlan && retrievalPlan.needsRetrieval && retrievalPlan.queries.length > 0) {
        const queryList = retrievalPlan.queries.map((q) => `• ${q}`).join('\n');
        response.thinking(
          `Intent: ${retrievalPlan.intent}\n` +
          `Analysis: ${retrievalPlan.reasoning}\n` +
          `Searched for:\n${queryList}`,
        );
      }

      // M15: Attach numbered citation map to all markdown parts so the
      // renderer can resolve [N] markers to clickable source badges.
      if (ragSources.length > 0) {
        const citations = ragSources
          .filter((s): s is { uri: string; label: string; index: number } => s.index != null)
          .map(s => ({ index: s.index, uri: s.uri, label: s.label }));
        if (citations.length > 0) {
          response.setCitations(citations);
        }
      }

      return {};
    } catch (err) {
      // Clear network timeout on error
      if (networkTimeoutId !== undefined) { clearTimeout(networkTimeoutId); }

      if (err instanceof DOMException && err.name === 'AbortError') {
        // User-initiated cancellation — not an error
        return {};
      }

      // Categorize the error for user-friendly messaging
      const { message, isNetworkError: _isNetworkError } = categorizeError(err);
      return {
        errorDetails: {
          message,
          responseIsIncomplete: true,
        },
      };
    } finally {
      cancelListener.dispose();
    }
  };

  // Build participant descriptor
  const participant: IChatParticipant & IDisposable = {
    id: DEFAULT_PARTICIPANT_ID,
    displayName: 'Chat',
    description: 'Default chat participant — sends messages to the active language model.',
    commands: [
      { name: 'init', description: 'Scan workspace and generate AGENTS.md' },
      { name: 'explain', description: 'Explain how code or a concept works' },
      { name: 'fix', description: 'Find and fix problems in the code' },
      { name: 'test', description: 'Generate tests for the code' },
      { name: 'doc', description: 'Generate documentation or comments' },
      { name: 'review', description: 'Code review — suggest improvements' },
      { name: 'compact', description: 'Summarize conversation to free token budget' },
    ],
    handler,
    dispose: () => {
      // No-op cleanup — the participant is just a descriptor
    },
  };

  return participant;
}

// ── Edit mode JSON parser ──

/** Valid edit operations. */
const VALID_OPERATIONS = new Set<string>(['insert', 'update', 'delete']);

/**
 * Parse JSON structured output from Edit mode and emit edit proposals.
 *
 * Expected schema:
 * ```json
 * {
 *   "explanation": "Brief description of the changes",
 *   "edits": [{ "pageId", "blockId?", "operation", "content" }]
 * }
 * ```
 *
 * Falls back gracefully: shows raw response + warning if parsing fails.
 */
function _parseEditResponse(rawContent: string, response: IChatResponseStream): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    // JSON parse failed — show raw content with warning
    response.warning('Edit mode: failed to parse model response as JSON. Showing raw output.');
    response.markdown(rawContent);
    return;
  }

  if (!parsed || typeof parsed !== 'object') {
    response.warning('Edit mode: model response is not a JSON object. Showing raw output.');
    response.markdown(rawContent);
    return;
  }

  const obj = parsed as Record<string, unknown>;

  // Extract explanation
  const explanation = typeof obj['explanation'] === 'string' ? obj['explanation'] : '';

  // Extract and validate edits array
  const editsRaw = obj['edits'];
  if (!Array.isArray(editsRaw) || editsRaw.length === 0) {
    // No edits — show explanation as markdown + warning
    if (explanation) {
      response.markdown(explanation);
    }
    response.warning('Edit mode: no edits found in model response.');
    return;
  }

  // Validate and build edit proposals
  const proposals: IChatEditProposalContent[] = [];
  const warnings: string[] = [];

  for (let i = 0; i < editsRaw.length; i++) {
    const entry = editsRaw[i];
    if (!entry || typeof entry !== 'object') {
      warnings.push(`Edit ${i + 1}: not a valid object, skipped.`);
      continue;
    }

    const e = entry as Record<string, unknown>;
    const pageId = typeof e['pageId'] === 'string' ? e['pageId'] : '';
    const blockId = typeof e['blockId'] === 'string' ? e['blockId'] : undefined;
    const operation = typeof e['operation'] === 'string' ? e['operation'] : '';
    const content = typeof e['content'] === 'string' ? e['content'] : '';

    if (!pageId) {
      warnings.push(`Edit ${i + 1}: missing pageId, skipped.`);
      continue;
    }
    if (!VALID_OPERATIONS.has(operation)) {
      warnings.push(`Edit ${i + 1}: invalid operation "${operation}", skipped.`);
      continue;
    }

    proposals.push({
      kind: ChatContentPartKind.EditProposal,
      pageId,
      blockId,
      operation: operation as EditProposalOperation,
      after: content,
      status: 'pending',
    });
  }

  // Emit warnings for invalid entries
  for (const w of warnings) {
    response.warning(w);
  }

  if (proposals.length === 0) {
    if (explanation) {
      response.markdown(explanation);
    }
    response.warning('Edit mode: all proposed edits were invalid.');
    return;
  }

  // Emit edit batch (explanation + proposals)
  response.editBatch(explanation, proposals);
}
