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
import { tryHandleWorkspaceDocumentListing } from '../openclawWorkspaceDocumentListing.js';
import { tryHandleOpenclawContextCommand } from './openclawContextReport.js';
import { loadOpenclawBootstrapEntries } from './openclawParticipantRuntime.js';
import type { IOpenclawTurnContext } from '../openclawAttempt.js';
import { runOpenclawTurn } from '../openclawTurnRunner.js';
import { OpenclawContextEngine } from '../openclawContextEngine.js';
import { resolveToolProfile } from '../openclawToolPolicy.js';
import { computeTokenBudget } from '../openclawTokenBudget.js';
import { validateCitations, buildExtractiveFallback } from '../openclawResponseValidation.js';
import { resolveMentions, resolveVariables, activateSkill, detectSemanticFallback } from '../openclawTurnPreprocessing.js';
import type { IBootstrapFile, ISkillEntry, IOpenclawRuntimeInfo } from '../openclawSystemPrompt.js';

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
    ],
    handler,
    runtime: { handleTurn: handler },
    provideFollowups: async (_result, _context, _token): Promise<readonly IChatFollowup[]> => {
      // Extract followup suggestions from the last response metadata.
      // Uses simple heuristic: suggest deepening, broadening, or applying the topic.
      return generateFollowupSuggestions(_result);
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

  if (await tryHandleWorkspaceDocumentListing({
    text: request.text,
    listFiles: services.listFilesRelative,
    response,
    token,
    workspaceName: services.getWorkspaceName(),
  })) {
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

  // M3: Skill activation — when command is a skill, inject resolved body
  const activated = request.command
    ? activateSkill(request.command, variableResult.strippedText, services)
    : undefined;

  // M4: Semantic fallback — detect broad workspace summary prompts
  const semanticFallback = detectSemanticFallback(variableResult.strippedText);

  // M11: Load pattern-scoped rules from .parallx/rules/*.md
  const patternRulesOverlay = await services.getPromptOverlay?.().catch(() => undefined);

  // Merge pattern rules + semantic fallback overlays
  const effectiveOverlay = [patternRulesOverlay, semanticFallback?.promptOverlay]
    .filter(Boolean)
    .join('\n\n') || undefined;

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
    activatedSkillBody: activated?.resolvedBody,
    promptOverlay: effectiveOverlay,
  });

  // Execute turn through the new pipeline
  const lifecycle = createOpenclawRuntimeLifecycle({});

  try {
    const result = await runOpenclawTurn(request, turnContext, response, token);

    // M1: Response validation — remap/filter citations
    const validated = validateCitations(result.markdown, [...result.ragSources]);
    if (validated.attributableSources.length > 0) {
      response.setCitations(validated.attributableSources.map(s => ({ index: s.index, uri: s.uri, label: s.label })));
    }

    // M6: Extractive fallback — when model returns empty but we have context
    if (!result.markdown.trim() && result.retrievedContextText) {
      const fallback = buildExtractiveFallback(request.text, result.retrievedContextText);
      if (fallback) {
        response.markdown(fallback);
      }
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

const OPENCLAW_MAX_AGENT_ITERATIONS = 6;
const OPENCLAW_MAX_READONLY_ITERATIONS = 3;

async function buildOpenclawTurnContext(
  services: IDefaultParticipantServices,
  request: IChatParticipantRequest,
  context: IChatParticipantContext,
  preprocessed?: { mentionContextBlocks?: readonly string[]; activatedSkillBody?: string; promptOverlay?: string },
): Promise<IOpenclawTurnContext> {
  // Token budget from model context length
  const contextWindow = services.getModelContextLength?.() ?? 8192;
  const budget = computeTokenBudget(contextWindow);

  // Bootstrap files (AGENTS.md, SOUL.md, TOOLS.md, etc.)
  const bootstrapEntries = await loadOpenclawBootstrapEntries(services.readFileRelative);
  const bootstrapFiles: IBootstrapFile[] = bootstrapEntries
    .filter(e => !e.missing && e.content)
    .map(e => ({ name: e.name, content: e.content! }));

  // Workspace digest
  const workspaceDigest = (await services.getWorkspaceDigest?.()) ?? '';

  // Skills from catalog
  const skillEntries = services.getWorkflowSkillCatalog?.() ?? [];
  const skills: ISkillEntry[] = skillEntries
    .filter(s => s.kind === 'workflow')
    .map(s => ({ name: s.name, description: s.description, location: s.location ?? '' }));

  // Tools based on mode — M41 Phase 9: Ask + Agent get full tools,
  // Edit gets read-only tools for context lookup only
  const tools = request.mode === ChatMode.Edit
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

  // Max tool iterations — Agent gets full autonomy, Ask/Edit get short loops
  const maxToolIterations = request.mode === ChatMode.Agent
    ? Math.min(services.maxIterations ?? OPENCLAW_MAX_AGENT_ITERATIONS, OPENCLAW_MAX_AGENT_ITERATIONS)
    : OPENCLAW_MAX_READONLY_ITERATIONS;

  // Tool permissions for pre-flight filtering
  const toolPermissions = services.getToolPermissions?.();

  // Flatten history pairs into IChatMessage[]
  const history = flattenHistory(context.history);

  return {
    sessionId: context.sessionId,
    history,
    tokenBudget: budget.total,
    engine,
    bootstrapFiles,
    workspaceDigest,
    skills,
    runtimeInfo,
    tools,
    toolMode: resolveToolProfile(request.mode),
    maxToolIterations,
    toolPermissions,
    mentionContextBlocks: preprocessed?.mentionContextBlocks,
    activatedSkillBody: preprocessed?.activatedSkillBody,
    promptOverlay: preprocessed?.promptOverlay,
    sendChatRequest: (messages, options, signal) => services.sendChatRequest(messages, options, signal),
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
// Followup suggestion generator (M43 Gap 2.2)
// ---------------------------------------------------------------------------

/**
 * Generate 2-3 followup suggestions based on the response result.
 *
 * Uses a lightweight heuristic: if the response mentions specific topics,
 * suggest deepening, comparing, or applying them. Falls back to generic
 * continuations if no topic can be extracted.
 */
function generateFollowupSuggestions(result: IChatParticipantResult): IChatFollowup[] {
  if (result.errorDetails) return [];

  const followups: IChatFollowup[] = [
    { message: 'Can you explain that in more detail?', label: 'Explain more' },
    { message: 'What are the alternatives or trade-offs?', label: 'Alternatives' },
    { message: 'How would I apply this in practice?', label: 'Apply it' },
  ];

  return followups.slice(0, 3);
}
