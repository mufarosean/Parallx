import type { IDisposable } from '../../platform/lifecycle.js';
import type {
  IChatMessage,
  IChatParticipant,
  IChatParticipantContext,
  IChatParticipantRequest,
  IChatParticipantResult,
  IChatResponseStream,
  ICancellationToken,
  IChatFollowup,
} from '../../services/chatTypes.js';
import { ChatMode, ChatContentPartKind, isChatFileAttachment } from '../../services/chatTypes.js';
import type {
  IDefaultParticipantServices,
  IOpenclawCommandRegistryFacade,
} from '../openclawTypes.js';
import { OPENCLAW_DEFAULT_PARTICIPANT_ID } from '../../services/chatRuntimeSelector.js';
import {
  buildFallbackSessionSummary,
  createOpenclawCommandRegistry,
  createOpenclawRuntimeLifecycle,
  tryHandleOpenclawCompactCommand,
  tryHandleOpenclawInitCommand,
} from '../openclawDefaultRuntimeSupport.js';
import { tryHandleOpenclawContextCommand } from './openclawContextReport.js';
import { buildOpenclawBootstrapContext, loadOpenclawBootstrapEntries } from './openclawParticipantRuntime.js';
import type { IOpenclawTurnContext } from '../openclawAttempt.js';
import { runOpenclawTurn } from '../openclawTurnRunner.js';
import { OpenclawContextEngine } from '../openclawContextEngine.js';
import { resolveToolProfile } from '../openclawToolPolicy.js';
import { computeTokenBudget } from '../openclawTokenBudget.js';
import { resolveMentions, resolveVariables } from '../openclawTurnPreprocessing.js';
import type { IBootstrapFile, IOpenclawRuntimeInfo } from '../openclawSystemPrompt.js';
import { buildOpenclawRuntimeSkillState } from '../openclawSkillState.js';
import { buildOpenclawRuntimeToolState } from '../openclawToolState.js';
import { resolveAgentConfig, type IGlobalConfigSlice } from '../agents/openclawAgentResolver.js';
// D2: Command handlers
import { tryHandleOpenclawStatusCommand } from '../commands/openclawStatusCommand.js';
import { tryHandleOpenclawNewCommand } from '../commands/openclawNewCommand.js';
import { tryHandleOpenclawModelsCommand } from '../commands/openclawModelsCommand.js';
import { tryHandleOpenclawDoctorCommand } from '../commands/openclawDoctorCommand.js';
import { tryHandleOpenclawThinkCommand, THINK_SESSION_FLAG } from '../commands/openclawThinkCommand.js';
import { tryHandleOpenclawUsageCommand } from '../commands/openclawUsageCommand.js';
import { tryHandleOpenclawToolsCommand } from '../commands/openclawToolsCommand.js';
import { tryHandleOpenclawVerboseCommand, VERBOSE_SESSION_FLAG } from '../commands/openclawVerboseCommand.js';

export function createOpenclawDefaultParticipant(services: IDefaultParticipantServices): IChatParticipant & IDisposable {
  const commandRegistry = createOpenclawCommandRegistry();
  const handler = async (
    request: IChatParticipantRequest,
    context: IChatParticipantContext,
    response: IChatResponseStream,
    token: ICancellationToken,
  ): Promise<IChatParticipantResult> => runOpenclawDefaultTurn(services, commandRegistry, request, context, response, token);

  return {
    id: OPENCLAW_DEFAULT_PARTICIPANT_ID,
    surface: 'default',
    displayName: 'Chat (OpenClaw)',
    description: 'Separate OpenClaw-style chat runtime lane.',
    commands: [
      { name: 'context', description: 'Show the runtime context breakdown' },
      { name: 'init', description: 'Scan workspace and generate AGENTS.md' },
      { name: 'compact', description: 'Summarize conversation to free token budget' },
      { name: 'status', description: 'Show AI runtime status (model, connection, budget)' },
      { name: 'new', description: 'Start a new conversation' },
      { name: 'models', description: 'List available Ollama models' },
      { name: 'doctor', description: 'Run diagnostic checks on AI runtime' },
      { name: 'think', description: 'Toggle extended thinking mode for this session' },
      { name: 'usage', description: 'Show token usage statistics for this session' },
      { name: 'tools', description: 'List available tools and their status' },
      { name: 'verbose', description: 'Toggle verbose debug output for this session' },
    ],
    handler,
    runtime: { handleTurn: handler },
    provideFollowups: async (): Promise<readonly IChatFollowup[]> => {
      return [];
    },
    dispose: () => {},
  };
}

async function runOpenclawDefaultTurn(
  services: IDefaultParticipantServices,
  _commandRegistry: IOpenclawCommandRegistryFacade,
  request: IChatParticipantRequest,
  context: IChatParticipantContext,
  response: IChatResponseStream,
  token: ICancellationToken,
): Promise<IChatParticipantResult> {
  const initResult = await tryHandleOpenclawInitCommand(services, request.command, response);
  if (initResult) {
    return initResult;
  }

  const contextResult = await tryHandleOpenclawContextCommand(services, request, response);
  if (contextResult.handled) {
    return {};
  }

  if (await tryHandleOpenclawCompactCommand(services, {
    activeCommand: request.command,
    slashSpecialHandler: request.command === 'compact' ? 'compact' : undefined,
    context,
    response,
  })) {
    return {};
  }

  // D2: New slash command dispatch
  if (await tryHandleOpenclawStatusCommand(services, request.command, response)) return {};
  if (await tryHandleOpenclawNewCommand(services, request.command, response)) return {};
  if (await tryHandleOpenclawModelsCommand(services, request.command, response)) return {};
  if (await tryHandleOpenclawDoctorCommand(services, request.command, response)) return {};
  if (await tryHandleOpenclawThinkCommand(services, request.command, response)) return {};
  if (await tryHandleOpenclawUsageCommand(services, request.command, context, response)) return {};
  if (await tryHandleOpenclawToolsCommand(services, request.command, response, request.mode)) return {};
  if (await tryHandleOpenclawVerboseCommand(services, request.command, response)) return {};

  // M2: Resolve @file/@folder/@workspace/@terminal mentions
  const mentionResult = await resolveMentions(request.text, services);
  if (mentionResult.pills.length > 0) {
    services.reportContextPills?.(mentionResult.pills as any[]);
  }

  // M43: Resolve #activeFile, #file:path variables
  const variableResult = await resolveVariables(mentionResult.strippedText, services);
  if (variableResult.pills.length > 0) {
    services.reportContextPills?.(variableResult.pills as any[]);
  }

  // M11: Load pattern-scoped rules from .parallx/rules/*.md
  const patternRulesOverlay = await services.getPromptOverlay?.().catch(() => undefined);

  const effectiveOverlay = patternRulesOverlay || undefined;

  // C3: Resolve non-image file attachments into context blocks
  const fileAttachmentBlocks: string[] = [];
  if (request.attachments?.length && services.readFileRelative) {
    const fileAttachments = request.attachments.filter(isChatFileAttachment);
    for (const att of fileAttachments) {
      const content = await services.readFileRelative(att.fullPath).catch(() => null);
      if (content) {
        fileAttachmentBlocks.push(`## Attached File: ${att.name}\n${content}`);
      }
    }
  }

  // Combine mention + variable + file attachment context blocks
  const allContextBlocks = [
    ...(mentionResult.contextBlocks.length > 0 ? mentionResult.contextBlocks : []),
    ...(variableResult.contextBlocks.length > 0 ? variableResult.contextBlocks : []),
    ...fileAttachmentBlocks,
  ];

  // Build turn context for the new OpenClaw execution pipeline
  const turnContext = await buildOpenclawTurnContext(services, request, context, {
    mentionContextBlocks: allContextBlocks.length > 0 ? allContextBlocks : undefined,
    promptOverlay: effectiveOverlay,
    isSteeringTurn: request.isSteeringTurn,
  });

  // D2: Verbose mode — emit debug header when enabled
  const verboseEnabled = services.getSessionFlag?.(VERBOSE_SESSION_FLAG) ?? false;
  if (verboseEnabled) {
    const debugLines = [
      '<details><summary>🔍 Verbose Debug</summary>\n',
      `- **Model:** ${turnContext.runtimeInfo.model}`,
      `- **Token Budget:** ${turnContext.tokenBudget}`,
      `- **Tools:** ${turnContext.toolState.availableCount} active`,
      `- **History:** ${turnContext.history.length} messages`,
      `- **Bootstrap Files:** ${turnContext.bootstrapFiles.length}`,
      `- **Agent:** ${turnContext.agentConfig?.id ?? 'default'}`,
      `- **Think:** ${services.getSessionFlag?.(THINK_SESSION_FLAG) ? 'enabled' : 'disabled'}`,
      `- **Auto-RAG:** ${turnContext.autoRag !== false ? 'enabled' : 'disabled'}`,
      '\n</details>\n',
    ];
    response.markdown(debugLines.join('\n'));
  }

  // Execute turn through the new pipeline
  const lifecycle = createOpenclawRuntimeLifecycle({});

  try {
    const result = await runOpenclawTurn(request, turnContext, response, token);

    // D7: Record turn metrics in observability service
    if (services.observabilityService && !token.isCancellationRequested) {
      services.observabilityService.recordTurn({
        model: services.getActiveModel?.() ?? 'unknown',
        promptTokens: result.promptTokens ?? 0,
        completionTokens: result.completionTokens ?? 0,
        totalTokens: (result.promptTokens ?? 0) + (result.completionTokens ?? 0),
        durationMs: result.durationMs,
        timestamp: Date.now(),
        overflowCompactions: result.overflowCompactions || undefined,
        timeoutCompactions: result.timeoutCompactions || undefined,
        compactionQualityScore: result.compactionQualityScore,
        compactionQualityRetries: result.compactionQualityRetries,
      });
    }

    // Aborted — skip memory writeback and record as aborted, not completed
    if (token.isCancellationRequested) {
      lifecycle.recordAborted();
      return {
        metadata: {
          runtimeBoundary: {
            type: 'openclaw-default',
            participantId: OPENCLAW_DEFAULT_PARTICIPANT_ID,
            runtime: 'openclaw',
          },
        },
      };
    }

    // M1: Citation metadata — attempt already validated+remapped citations
    const attributable = result.validatedCitations ?? [];
    if (attributable.length > 0) {
      response.setCitations(attributable.map(s => ({ index: s.index, uri: s.uri, label: s.label })));
    }

    // M43: Edit mode — emit response as tracked-change edit proposal
    if (request.mode === ChatMode.Edit && result.markdown.trim() && services.getCurrentPageContent) {
      const page = await services.getCurrentPageContent().catch(() => undefined);
      if (page) {
        response.editBatch('AI-suggested edits', [{
          kind: ChatContentPartKind.EditProposal,
          pageId: page.pageId,
          operation: 'update' as const,
          before: page.textContent,
          after: result.markdown.trim(),
          status: 'pending' as const,
        }]);
      }
    }

    // Memory writeback
    lifecycle.queueMemoryWriteBack(
      {
        extractPreferences: services.extractPreferences,
        storeSessionMemory: services.storeSessionMemory,
        storeConceptsFromSession: services.storeConceptsFromSession,
        isSessionEligibleForSummary: services.isSessionEligibleForSummary,
        getSessionMemoryMessageCount: services.getSessionMemoryMessageCount,
        sendSummarizationRequest: services.sendSummarizationRequest,
        buildFallbackSessionSummary,
      },
      {
        memoryEnabled: services.unifiedConfigService?.getEffectiveConfig().memory?.memoryEnabled ?? true,
        requestText: request.text,
        sessionId: context.sessionId,
        history: context.history,
      },
    );
    lifecycle.recordCompleted();

    return {
      metadata: {
        runtimeBoundary: {
          type: 'openclaw-default',
          participantId: OPENCLAW_DEFAULT_PARTICIPANT_ID,
          runtime: 'openclaw',
        },
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    lifecycle.recordFailed(message);
    response.warning(`OpenClaw turn failed: ${message}`);
    return {
      errorDetails: {
        message,
        responseIsIncomplete: true,
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Turn context builder — maps platform services to IOpenclawTurnContext
// ---------------------------------------------------------------------------

/** Safety ceiling — prevents runaway loops regardless of user setting. */
const OPENCLAW_MAX_ITERATIONS_CEILING = 50;
const OPENCLAW_MAX_READONLY_ITERATIONS = 10;

async function buildOpenclawTurnContext(
  services: IDefaultParticipantServices,
  request: IChatParticipantRequest,
  context: IChatParticipantContext,
  preprocessed?: { mentionContextBlocks?: readonly string[]; promptOverlay?: string; isSteeringTurn?: boolean },
): Promise<IOpenclawTurnContext> {
  // Token budget from model context length
  const contextWindow = services.getModelContextLength?.() ?? 8192;
  const budget = computeTokenBudget(contextWindow);

  // Bootstrap files (AGENTS.md, SOUL.md, TOOLS.md, etc.)
  const bootstrapEntries = await loadOpenclawBootstrapEntries(services.readFileRelative);
  const { debug: bootstrapDebugReport } = buildOpenclawBootstrapContext(bootstrapEntries);
  const bootstrapFiles: IBootstrapFile[] = bootstrapEntries
    .filter(e => !e.missing && e.content)
    .map(e => ({ name: e.name, content: e.content! }));

  // Workspace digest
  const workspaceDigest = (await services.getWorkspaceDigest?.()) ?? '';

  const skillCatalog = services.getSkillCatalog?.() ?? [];
  const skillState = buildOpenclawRuntimeSkillState(skillCatalog);
  const platformTools = request.mode === ChatMode.Edit
    ? services.getReadOnlyToolDefinitions()
    : services.getToolDefinitions();

  // Context engine
  const engine = new OpenclawContextEngine(services);

  // Runtime info
  const runtimeInfo: IOpenclawRuntimeInfo = {
    model: services.getActiveModel() ?? request.modelId,
    provider: 'ollama',
    host: 'localhost',
    parallxVersion: '0.1.0',
  };

  // Max tool iterations — Agent gets full autonomy from user setting, Ask/Edit get short loops
  const maxToolIterations = request.mode === ChatMode.Agent
    ? Math.min(services.maxIterations ?? 25, OPENCLAW_MAX_ITERATIONS_CEILING)
    : OPENCLAW_MAX_READONLY_ITERATIONS;

  const effectiveConfig = services.unifiedConfigService?.getEffectiveConfig();

  // D8: Resolve agent config if registry is available (before tool state, so agent tools can be applied)
  const agentId = 'default'; // Default participant → 'default' agent
  const resolvedAgentConfig = services.agentRegistry ? resolveAgentConfig(
    services.agentRegistry,
    agentId,
    {
      model: runtimeInfo.model,
      temperature: effectiveConfig?.model?.temperature ?? 0.7,
      maxTokens: effectiveConfig?.model?.maxTokens ?? 4096,
      maxIterations: maxToolIterations,
      autoRag: effectiveConfig?.retrieval?.autoRag ?? true,
    } satisfies IGlobalConfigSlice,
  ) : undefined;

  const toolState = buildOpenclawRuntimeToolState({
    platformTools,
    skillCatalog,
    mode: resolveToolProfile(request.mode),
    permissions: services.getToolPermissions?.(),
    agentTools: resolvedAgentConfig?.tools,
  });

  // Flatten history pairs into IChatMessage[]
  const history = flattenHistory(context.history);

  // Model fallback: resolve available models for retry on model errors
  const fallbackModels = services.getAvailableModelIds
    ? (await services.getAvailableModelIds()).filter(id => id !== runtimeInfo.model)
    : undefined;

  return {
    sessionId: context.sessionId,
    history,
    tokenBudget: budget.total,
    engine,
    bootstrapFiles,
    bootstrapDebugReport,
    workspaceDigest,
    skillState,
    runtimeInfo,
    preferencesPrompt: await services.getPreferencesForPrompt?.(),
    temperature: resolvedAgentConfig?.temperature ?? effectiveConfig?.model?.temperature,
    maxTokens: resolvedAgentConfig?.maxTokens ?? effectiveConfig?.model?.maxTokens,
    autoRag: resolvedAgentConfig?.autoRag ?? effectiveConfig?.retrieval?.autoRag,
    toolState,
    maxToolIterations,
    agentConfig: resolvedAgentConfig,
    mentionContextBlocks: preprocessed?.mentionContextBlocks,
    promptOverlay: preprocessed?.promptOverlay,
    isSteeringTurn: preprocessed?.isSteeringTurn,
    reportSystemPromptReport: services.reportSystemPromptReport,
    sendChatRequest: (messages, options, signal) => services.sendChatRequest(messages, {
      ...options,
      // D2: Inject session-level thinking flag
      think: options?.think ?? (services.getSessionFlag?.(THINK_SESSION_FLAG) || undefined),
    }, signal),
    fallbackModels: fallbackModels?.length ? fallbackModels : undefined,
    rebuildSendChatRequest: services.sendChatRequestForModel ?? undefined,
    invokeToolWithRuntimeControl: services.invokeToolWithRuntimeControl
      ? (name, args, token) => services.invokeToolWithRuntimeControl!(name, args, token)
      : undefined,
  };
}

function flattenHistory(
  history: IChatParticipantContext['history'],
): IChatMessage[] {
  const messages: IChatMessage[] = [];
  for (const pair of history) {
    messages.push({ role: 'user', content: pair.request.text });
    const assistantText = pair.response.parts
      .map(part => {
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
  return messages;
}

// ---------------------------------------------------------------------------
// Followup suggestions removed (M41 anti-pattern A3: heuristic patchwork).
// The 3 hardcoded generic strings ("Explain more", "Alternatives", "Apply it")
// provided no value. Return empty array from provideFollowups instead.
