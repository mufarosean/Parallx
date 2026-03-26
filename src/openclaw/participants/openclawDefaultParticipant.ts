import type { IDisposable } from '../../platform/lifecycle.js';
import type {
  IChatMessage,
  IChatParticipant,
  IChatParticipantContext,
  IChatParticipantRequest,
  IChatParticipantResult,
  IChatResponseStream,
  ICancellationToken,
} from '../../services/chatTypes.js';
import { ChatMode } from '../../services/chatTypes.js';
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

  // Build turn context for the new OpenClaw execution pipeline
  const turnContext = await buildOpenclawTurnContext(services, request, context);

  // Execute turn through the new pipeline
  const lifecycle = createOpenclawRuntimeLifecycle({});

  try {
    const result = await runOpenclawTurn(request, turnContext, response, token);

    // Citations
    if (result.ragSources.length > 0) {
      response.setCitations(result.ragSources.map(s => ({ index: s.index, uri: s.uri, label: s.label })));
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
