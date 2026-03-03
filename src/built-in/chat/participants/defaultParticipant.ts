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
  IChatResponseChunk,
  IToolDefinition,
  IToolCall,
  IToolResult,
  IChatEditProposalContent,
  EditProposalOperation,
  IContextPill,
} from '../../../services/chatTypes.js';
import { ChatContentPartKind } from '../../../services/chatTypes.js';
import { buildSystemPrompt } from '../chatSystemPrompts.js';
import type { ISystemPromptContext } from '../chatSystemPrompts.js';
import { getModeCapabilities, shouldIncludeTools, shouldUseStructuredOutput } from '../chatModeCapabilities.js';
import { executeInitCommand } from '../commands/initCommand.js';
import type { IInitCommandServices } from '../commands/initCommand.js';
import { TokenBudgetService } from '../../../services/tokenBudgetService.js';
import { extractMentions, resolveMentions } from '../chatMentionResolver.js';
import type { IMentionResolutionServices } from '../chatMentionResolver.js';
import { SlashCommandRegistry, parseSlashCommand } from '../chatSlashCommands.js';
import { loadUserCommands } from '../userCommandLoader.js';
import type { IUserCommandFileSystem } from '../userCommandLoader.js';

/** Default maximum agentic loop iterations. */
const DEFAULT_MAX_ITERATIONS = 10;
/** Ask mode needs fewer iterations — it only reads, never writes. */
const ASK_MODE_MAX_ITERATIONS = 5;
/** Default network timeout in milliseconds. */
const DEFAULT_NETWORK_TIMEOUT_MS = 60_000;
/** Context overflow threshold — warn at this fraction of context length. */
const CONTEXT_OVERFLOW_WARN_THRESHOLD = 0.8;

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

/**
 * Service accessor for the default participant.
 * Passed in from the activation layer — avoids importing service implementations.
 */
export interface IDefaultParticipantServices {
  sendChatRequest(
    messages: readonly IChatMessage[],
    options?: IChatRequestOptions,
    signal?: AbortSignal,
  ): AsyncIterable<IChatResponseChunk>;
  getActiveModel(): string | undefined;
  /** Workspace name for system prompt context. */
  getWorkspaceName(): string;
  /** Page count for system prompt context. */
  getPageCount(): Promise<number>;
  /** Current page title, if any. */
  getCurrentPageTitle(): string | undefined;
  /** Available tool definitions (for Agent mode — all tools). */
  getToolDefinitions(): readonly IToolDefinition[];
  /** Read-only tool definitions (for Ask mode — no write tools). */
  getReadOnlyToolDefinitions(): readonly IToolDefinition[];
  /**
   * Invoke a tool by name with confirmation gate (Cap 6).
   * Returns the tool result (may include user rejection).
   */
  invokeTool?(
    name: string,
    args: Record<string, unknown>,
    token: ICancellationToken,
  ): Promise<IToolResult>;
  /** Max agentic loop iterations (default: 10). */
  maxIterations?: number;
  /** Network timeout in milliseconds (default: 60000). */
  networkTimeout?: number;
  /** Context length of the active model (tokens). 0 = unknown. */
  getModelContextLength?(): number;
  /** Send a summarization request to compress conversation history. */
  sendSummarizationRequest?(
    messages: readonly IChatMessage[],
    signal?: AbortSignal,
  ): AsyncIterable<IChatResponseChunk>;

  // ── Workspace statistics (M10 Phase 4 — dynamic system prompt) ──

  /** Count of files in the workspace (undefined if no workspace folder). */
  getFileCount?(): Promise<number>;
  /** Whether the RAG knowledge index is ready for retrieval. */
  isRAGAvailable?(): boolean;
  /** Whether the indexing pipeline is currently running. */
  isIndexing?(): boolean;
  /** Read a file's text content by path (for attachment context injection). */
  readFileContent?(fullPath: string): Promise<string>;

  /**
   * Read the content of the currently active canvas page (implicit context).
   * Returns title + text content, or undefined if no page is open.
   */
  getCurrentPageContent?(): Promise<{ title: string; pageId: string; textContent: string } | undefined>;

  // ── RAG context retrieval (M10 Phase 3) ──

  /**
   * Retrieve relevant context chunks for a user query via hybrid search.
   * Returns formatted context string + source citations for Reference rendering.
   * Returns undefined if the retrieval service is not available or indexing hasn't completed.
   */
  retrieveContext?(query: string): Promise<{ text: string; sources: Array<{ uri: string; label: string }> } | undefined>;

  // ── Memory (M10 Phase 5 — Tasks 5.1 + 5.2) ──

  /** Recall relevant memories from past conversations. */
  recallMemories?(query: string): Promise<string | undefined>;
  /** Store a conversation summary in memory. */
  storeSessionMemory?(sessionId: string, summary: string, messageCount: number): Promise<void>;
  /** Check if a session has enough messages for summarisation. */
  isSessionEligibleForSummary?(messageCount: number): boolean;
  /** Check if a session has already been summarised. */
  hasSessionMemory?(sessionId: string): Promise<boolean>;
  /** Extract and store user preferences from text. */
  extractPreferences?(text: string): Promise<void>;
  /** Get formatted preferences for system prompt injection. */
  getPreferencesForPrompt?(): Promise<string | undefined>;

  // ── Prompt file overlay (M11 Task 1.4) ──

  /**
   * Get assembled prompt file overlay from SOUL.md / AGENTS.md / TOOLS.md / rules/*.md.
   * Returns the overlay text to replace the hardcoded PARALLX_IDENTITY in the system prompt.
   * Returns undefined if no prompt files are configured.
   * @param activeFilePath — relative path of the currently active file (for pattern-scoped rules)
   */
  getPromptOverlay?(activeFilePath?: string): Promise<string | undefined>;

  // ── /init command support (M11 Task 1.6) ──

  /**
   * List files in a relative directory. For /init workspace scanning.
   */
  listFilesRelative?(relativePath: string): Promise<{ name: string; type: 'file' | 'directory' }[]>;
  /**
   * Read a file by relative path. Returns null on error.
   */
  readFileRelative?(relativePath: string): Promise<string | null>;
  /**
   * Write a file to workspace root by relative path.
   */
  writeFileRelative?(relativePath: string, content: string): Promise<void>;
  /**
   * Check if a relative path exists in the workspace.
   */
  existsRelative?(relativePath: string): Promise<boolean>;
  /**
   * Invalidate the prompt file cache (after AGENTS.md is written).
   */
  invalidatePromptFiles?(): void;

  /**
   * Report context pills — called after context resolution so the UI
   * can show what the LLM sees (M11 Task 1.10).
   */
  reportContextPills?(pills: IContextPill[]): void;

  /**
   * Report token budget breakdown — called after budget allocation so the UI
   * can show slot usage (M11 Task 4.8).
   */
  reportBudget?(slots: ReadonlyArray<{ label: string; used: number; allocated: number; color: string }>): void;

  // ── @mention resolution (M11 Tasks 3.2–3.4) ──

  /**
   * List files in a folder by relative path (for @folder: mention).
   * Returns relative paths and content of each file (respecting .parallxignore).
   */
  listFolderFiles?(folderPath: string): Promise<Array<{ relativePath: string; content: string }>>;
  /**
   * Get last N lines of terminal output (for @terminal mention).
   */
  getTerminalOutput?(): Promise<string | undefined>;

  // ── User-defined commands (M11 Task 3.7) ──

  /**
   * Filesystem for loading user-defined slash commands from .parallx/commands/.
   */
  userCommandFileSystem?: IUserCommandFileSystem;

  // ── /compact session compaction (M11 Task 3.8) ──

  /**
   * Replace session history with a compacted summary.
   * Called by /compact after summarization is complete.
   */
  compactSession?(sessionId: string, summaryText: string): void;

  // ── Excluded context (M11 Task 1.10) ──

  /**
   * Get the set of context pill IDs the user has excluded via the UI.
   * Context sources whose ID matches an excluded pill should be skipped.
   */
  getExcludedContextIds?(): ReadonlySet<string>;
}

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

    const pageCount = await services.getPageCount().catch(() => 0);

    // Gather workspace statistics for dynamic system prompt (M10 Phase 4)
    const fileCount = services.getFileCount
      ? await services.getFileCount().catch(() => 0)
      : undefined;

    // Load prompt file overlay (M11 Task 1.4 — SOUL.md / AGENTS.md / TOOLS.md / rules)
    let promptOverlay: string | undefined;
    if (services.getPromptOverlay) {
      try {
        promptOverlay = await services.getPromptOverlay();
      } catch {
        // Prompt file loading is best-effort — fall back to hardcoded identity
      }
    }

    const promptContext: ISystemPromptContext = {
      workspaceName: services.getWorkspaceName(),
      pageCount,
      currentPageTitle: services.getCurrentPageTitle(),
      tools: shouldIncludeTools(request.mode)
        ? (capabilities.canAutonomous ? services.getToolDefinitions() : services.getReadOnlyToolDefinitions())
        : undefined,
      fileCount,
      isRAGAvailable: services.isRAGAvailable?.() ?? false,
      isIndexing: services.isIndexing?.() ?? false,
      promptOverlay,
    };

    const systemPrompt = buildSystemPrompt(request.mode, promptContext);

    // Append user preferences to system prompt (M10 Phase 5 — Task 5.2)
    let finalSystemPrompt = systemPrompt;
    if (services.getPreferencesForPrompt) {
      try {
        const prefsBlock = await services.getPreferencesForPrompt();
        if (prefsBlock) {
          finalSystemPrompt = systemPrompt + '\n\n' + prefsBlock;
        }
      } catch {
        // Preferences are best-effort
      }
    }

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
    if (services.getCurrentPageContent) {
      try {
        const pageContext = await services.getCurrentPageContent();
        if (pageContext && pageContext.textContent) {
          contextParts.push(
            `[Currently open page: "${pageContext.title}" (id: ${pageContext.pageId})]\n${pageContext.textContent}`,
          );
        }
      } catch {
        // Silently skip — implicit context is best-effort
      }
    }

    // 1b. RAG context: per-turn re-query (M10 Phase 3, M11 Tasks 1.7, 3.9)
    //
    // Fires on EVERY user message — re-embeds the query and re-searches.
    // De-duplicates against explicitly attached files AND mention-resolved context
    // to avoid redundant chunks. Source citations are emitted as Reference parts.
    // Token budget trimming (Task 1.8) handles dropping stale chunks when tight.
    const ragSources: Array<{ uri: string; label: string }> = [];
    if (services.retrieveContext) {
      try {
        const ragResult = await services.retrieveContext(userText);
        if (ragResult) {
          // Build a set of paths already in context for de-duplication
          const alreadyInContext = new Set<string>();

          // Explicit attachments
          if (request.attachments?.length) {
            for (const att of request.attachments) {
              alreadyInContext.add(att.fullPath);
              alreadyInContext.add(att.name);
            }
          }

          // Mention-resolved sources (e.g. @workspace already injected via mentions)
          for (const pill of mentionPills) {
            alreadyInContext.add(pill.label);
            // Extract path from pill id if present
            const colonIdx = pill.id.indexOf(':');
            if (colonIdx > 0) {
              alreadyInContext.add(pill.id.substring(colonIdx + 1));
            }
          }

          // Filter RAG sources to exclude already-in-context files
          const filteredSources = ragResult.sources.filter((s) => {
            return !alreadyInContext.has(s.uri) && !alreadyInContext.has(s.label);
          });

          // Only inject RAG text if there are non-duplicate sources
          if (filteredSources.length > 0 || ragResult.sources.length === 0) {
            contextParts.push(ragResult.text);
          }

          // Emit source citations as Reference content parts
          for (const source of filteredSources) {
            response.reference(source.uri, source.label);
            ragSources.push(source);
          }
        }
      } catch {
        // RAG retrieval is best-effort — don't block the request
      }
    }

    // 1c. Memory context: retrieve relevant past conversation memories (M10 Phase 5)
    if (services.recallMemories) {
      try {
        const memoryContext = await services.recallMemories(userText);
        if (memoryContext) {
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
    const contextWindow = services.getModelContextLength?.() ?? 0;
    if (contextWindow > 0 && contextParts.length > 0) {
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
      userContent = contextParts.length > 0
        ? `${contextParts.join('\n\n')}\n\n${userText}`
        : userText;
    }

    messages.push({
      role: 'user',
      content: userContent,
    });

    // ── Context overflow detection & LLM-based summarization ──

    const contextLength = services.getModelContextLength?.() ?? 0;
    if (contextLength > 0) {
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
    const options: IChatRequestOptions = {
      // Ask mode: read-only tools; Agent mode: all tools
      tools: shouldIncludeTools(request.mode)
        ? (capabilities.canAutonomous ? services.getToolDefinitions() : services.getReadOnlyToolDefinitions())
        : undefined,
      // Edit mode: use JSON structured output
      format: shouldUseStructuredOutput(request.mode) ? { type: 'object' } : undefined,
    };

    // Create an AbortController linked to the cancellation token
    const abortController = new AbortController();
    if (token.isCancellationRequested) {
      abortController.abort();
    }
    const cancelListener = token.onCancellationRequested(() => {
      abortController.abort();
    });

    // Network timeout — abort if no response within configured time
    const timeoutMs = services.networkTimeout ?? DEFAULT_NETWORK_TIMEOUT_MS;
    let networkTimeoutId: ReturnType<typeof setTimeout> | undefined;
    if (timeoutMs > 0) {
      networkTimeoutId = setTimeout(() => {
        abortController.abort(new DOMException('Request timed out', 'TimeoutError'));
      }, timeoutMs);
    }

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

      for (let iteration = 0; iteration <= maxIterations; iteration++) {
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
          if (token.isCancellationRequested) {
            break;
          }

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

        // If cancelled, break out
        if (token.isCancellationRequested) {
          break;
        }

        // ── Edit mode: parse JSON structured output into edit proposals ──
        if (isEditMode && turnContent) {
          _parseEditResponse(turnContent, response);
          break; // Edit mode is single-turn (no tool calls)
        }

        // No tool calls → model gave a final answer, done
        if (turnToolCalls.length === 0) {
          break;
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
          const toolCallId = `${tcName}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

          // 1. Render pending tool card
          response.beginToolInvocation(toolCallId, tcName, tcArgs);
          producedContent = true;

          // 2. Update status to running
          response.updateToolInvocation(toolCallId, { status: 'running' });

          // 3. Invoke the tool
          let result: IToolResult;
          try {
            result = await services.invokeTool!(tcName, tcArgs, token);
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            result = { content: `Tool "${tcName}" failed: ${errMsg}`, isError: true };
          }

          // 4. Update card with result
          if (result.isError && result.content === 'Tool execution rejected by user') {
            response.updateToolInvocation(toolCallId, {
              status: 'rejected',
              isComplete: true,
              isConfirmed: false,
              result,
            });
          } else {
            response.updateToolInvocation(toolCallId, {
              status: result.isError ? 'rejected' : 'completed',
              isComplete: true,
              isConfirmed: !result.isError,
              isError: result.isError,
              result,
            });
          }

          // 5. Append tool result message for the model
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
