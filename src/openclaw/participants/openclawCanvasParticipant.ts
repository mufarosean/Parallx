import type { IDisposable } from '../../platform/lifecycle.js';
import type {
  IChatParticipant,
  IChatParticipantContext,
  IChatParticipantRequest,
  IChatParticipantResult,
  IChatResponseStream,
  ICancellationToken,
} from '../../services/chatTypes.js';
import type {
  ICanvasParticipantServices,
  IChatRuntimeTrace,
  IPageStructure,
} from '../openclawTypes.js';
import {
  buildOpenclawBootstrapContext,
  buildOpenclawReadOnlyRequestOptions,
  buildOpenclawSeedMessages,
  buildOpenclawTraceSeed,
  loadOpenclawBootstrapEntries,
  OPENCLAW_MAX_READONLY_ITERATIONS,
} from './openclawParticipantRuntime.js';
import { runOpenclawReadOnlyTurn } from '../openclawReadOnlyTurnRunner.js';
import { buildOpenclawSystemPrompt } from '../openclawSystemPrompt.js';
import type { IOpenclawRuntimeInfo } from '../openclawSystemPrompt.js';
import { resolveAgentConfig } from '../agents/openclawAgentResolver.js';

const OPENCLAW_CANVAS_PARTICIPANT_ID = 'parallx.chat.canvas';

export function createOpenclawCanvasParticipant(services: ICanvasParticipantServices): IChatParticipant & IDisposable {
  const handler = async (
    request: IChatParticipantRequest,
    context: IChatParticipantContext,
    response: IChatResponseStream,
    token: ICancellationToken,
  ): Promise<IChatParticipantResult> => handleCanvasTurn(services, request, context, response, token);

  return {
    id: OPENCLAW_CANVAS_PARTICIPANT_ID,
    surface: 'canvas',
    displayName: 'Canvas',
    description: 'OpenClaw-style canvas assistant lane.',
    commands: [
      { name: 'describe', description: 'Describe the current page structure' },
      { name: 'blocks', description: 'List all blocks on the current page' },
    ],
    handler,
    runtime: { handleTurn: handler },
    dispose: () => {},
  };
}

async function handleCanvasTurn(
  services: ICanvasParticipantServices,
  request: IChatParticipantRequest,
  context: IChatParticipantContext,
  response: IChatResponseStream,
  token: ICancellationToken,
): Promise<IChatParticipantResult> {
  services.reportRetrievalDebug?.({
    hasActiveSlashCommand: !!request.command,
    isRagReady: false,
    needsRetrieval: false,
    attempted: false,
  });

  switch (request.command) {
    case 'describe':
      return handleDescribe(services, request, context, response, token);
    case 'blocks':
      return handleBlocks(services, response, token);
    default:
      return handleGeneral(services, request, context, response, token);
  }
}

async function handleDescribe(
  services: ICanvasParticipantServices,
  request: IChatParticipantRequest,
  context: IChatParticipantContext,
  response: IChatResponseStream,
  token: ICancellationToken,
): Promise<IChatParticipantResult> {
  const pageId = services.getCurrentPageId();
  if (!pageId) {
    response.markdown('No page is currently open. Open a canvas page to use `@canvas /describe`.');
    return {};
  }

  response.progress('Reading page structure...');
  if (token.isCancellationRequested) {
    return {};
  }

  const structure = await services.getPageStructure(pageId);
  if (!structure) {
    response.markdown(`Could not read page structure for \`${pageId}\`.`);
    return {};
  }

  response.reference(`parallx://page/${pageId}`, `${structure.icon ?? '📄'} ${structure.title}`);
  return runCanvasPromptTurn(services, request, context, response, token, {
    userText: `Describe the structure of ${structure.title}.`,
    promptContext: formatPageStructure(structure),
    traceReason: 'OpenClaw canvas describe lane',
  });
}

async function handleBlocks(
  services: ICanvasParticipantServices,
  response: IChatResponseStream,
  token: ICancellationToken,
): Promise<IChatParticipantResult> {
  const pageId = services.getCurrentPageId();
  if (!pageId) {
    response.markdown('No page is currently open. Open a canvas page to use `@canvas /blocks`.');
    return {};
  }

  response.progress('Reading blocks...');
  if (token.isCancellationRequested) {
    return {};
  }

  const structure = await services.getPageStructure(pageId);
  if (!structure) {
    response.markdown(`Could not read page structure for \`${pageId}\`.`);
    return {};
  }

  response.reference(`parallx://page/${pageId}`, `${structure.icon ?? '📄'} ${structure.title}`);
  if (structure.blocks.length === 0) {
    response.markdown(`**${structure.title}** has no blocks yet.`);
    return {};
  }

  const lines: string[] = [
    `**${structure.blocks.length} block${structure.blocks.length !== 1 ? 's' : ''}** on "${structure.title}":`,
    '',
  ];
  for (const block of structure.blocks) {
    const preview = block.textPreview
      ? ` — ${block.textPreview.slice(0, 80)}${block.textPreview.length > 80 ? '...' : ''}`
      : '';
    lines.push(`- **${block.blockType}** \`${block.id.slice(0, 8)}...\`${preview}`);
    response.reference(`parallx://block/${block.id}`, `${block.blockType} block`);
  }
  response.markdown(lines.join('\n'));
  return {};
}

async function handleGeneral(
  services: ICanvasParticipantServices,
  request: IChatParticipantRequest,
  context: IChatParticipantContext,
  response: IChatResponseStream,
  token: ICancellationToken,
): Promise<IChatParticipantResult> {
  const pageId = services.getCurrentPageId();
  if (!pageId) {
    return runCanvasPromptTurn(services, request, context, response, token, {
      userText: request.text,
      promptContext: 'No page is currently open.',
      traceReason: 'OpenClaw canvas general lane',
    });
  }

  response.progress('Reading current page...');
  if (token.isCancellationRequested) {
    return {};
  }

  const structure = await services.getPageStructure(pageId);
  if (!structure) {
    response.markdown(`Could not read page structure for \`${pageId}\`.`);
    return {};
  }
  response.reference(`parallx://page/${pageId}`, `${structure.icon ?? '📄'} ${structure.title}`);
  return runCanvasPromptTurn(services, request, context, response, token, {
    userText: request.text,
    promptContext: formatPageStructure(structure),
    traceReason: 'OpenClaw canvas general lane',
  });
}

async function runCanvasPromptTurn(
  services: ICanvasParticipantServices,
  request: IChatParticipantRequest,
  context: IChatParticipantContext,
  response: IChatResponseStream,
  token: ICancellationToken,
  options: {
    userText: string;
    promptContext: string;
    traceReason: string;
  },
): Promise<IChatParticipantResult> {
  const bootstrapEntries = await loadOpenclawBootstrapEntries(
    services.readFileContent
      ? async (relativePath: string) => services.readFileContent!(relativePath)
      : undefined,
  );
  const { sections: _bootstrapSections, debug: bootstrapReport } = buildOpenclawBootstrapContext(bootstrapEntries);
  services.reportBootstrapDebug?.(bootstrapReport);

  const bootstrapFiles = bootstrapEntries
    .filter(e => !e.missing && e.content)
    .map(e => ({ name: e.name, content: e.content! }));

  const runtimeInfo: IOpenclawRuntimeInfo = {
    model: services.getActiveModel() ?? 'unknown',
    provider: 'ollama',
    host: 'localhost',
    parallxVersion: '0.1.0',
    os: typeof process !== 'undefined' ? `${process.platform} ${process.arch}` : undefined,
    arch: typeof process !== 'undefined' ? process.arch : undefined,
  };

  // F3-16: Populate skills and tools for readonly participants.
  const skillEntries = (services as any).getSkillCatalog?.() as any[] | undefined;
  const skills = (skillEntries ?? [])
    .filter((s: any) => s.kind === 'workflow' && s.disableModelInvocation !== true)
    .map((s: any) => ({ name: s.name as string, description: (s.description ?? '') as string, location: (s.location ?? '') as string }));
  const toolDefs = services.getReadOnlyToolDefinitions?.() ?? [];
  const tools = toolDefs.map(t => ({ name: t.name, description: t.description }));

  // D8: Resolve agent config for 'canvas' surface if registry is available
  const effectiveConfig = services.unifiedConfigService?.getEffectiveConfig();
  const resolvedAgentConfig = services.agentRegistry ? resolveAgentConfig(
    services.agentRegistry,
    'canvas',
    {
      model: runtimeInfo.model,
      temperature: effectiveConfig?.model?.temperature ?? 0.7,
      maxTokens: effectiveConfig?.model?.maxTokens ?? 4096,
      maxIterations: OPENCLAW_MAX_READONLY_ITERATIONS,
      autoRag: effectiveConfig?.retrieval?.autoRag ?? true,
    },
  ) : undefined;

  const systemPrompt = buildOpenclawSystemPrompt({
    bootstrapFiles,
    workspaceDigest: `Workspace: ${services.getWorkspaceName()}`,
    skills,
    tools,
    runtimeInfo,
    systemPromptAddition: [
      'You are the OpenClaw canvas lane inside Parallx.',
      'Treat the open canvas page as live workspace state. Use read-only tools when more evidence is needed.',
      'Canvas context for this turn:',
      options.promptContext,
    ].join('\n\n'),
    agentIdentity: resolvedAgentConfig?.identity,
    agentSystemPromptOverlay: resolvedAgentConfig?.systemPromptOverlay,
  });

  const messages = buildOpenclawSeedMessages(systemPrompt, context.history, {
    ...request,
    text: options.userText,
  });
  const requestOptions = buildOpenclawReadOnlyRequestOptions({
    temperature: resolvedAgentConfig?.temperature ?? effectiveConfig?.model?.temperature,
    maxTokens: resolvedAgentConfig?.maxTokens ?? effectiveConfig?.model?.maxTokens,
  });

  reportTrace(services, request, context, {
    phase: 'interpretation',
    checkpoint: 'openclaw-bootstrap-loaded',
    runState: 'prepared',
    note: options.traceReason,
  });

  try {
    const result = await runOpenclawReadOnlyTurn({
      sendChatRequest: services.sendChatRequest,
      messages,
      requestOptions,
      tools: (() => {
        const raw = services.getReadOnlyToolDefinitions?.() ?? [];
        return services.filterToolsForSession ? services.filterToolsForSession(raw, context.sessionId) : raw;
      })(),
      response,
      token,
      maxIterations: OPENCLAW_MAX_READONLY_ITERATIONS,
      sessionId: context.sessionId,
      invokeToolWithRuntimeControl: services.invokeToolWithRuntimeControl
        ? (name, args, tok, observer, sid) => services.invokeToolWithRuntimeControl!(name, args, tok, observer, sid ?? context.sessionId)
        : undefined,
      toolObserver: services.runtimeHookRegistry?.getCompositeToolObserver(),
      messageObserver: services.runtimeHookRegistry?.getCompositeMessageObserver(),
      modelName: services.getActiveModel() ?? 'unknown',
    });

    // D7: Record turn metrics in observability service
    if (services.observabilityService && !token.isCancellationRequested) {
      services.observabilityService.recordTurn({
        model: services.getActiveModel() ?? 'unknown',
        promptTokens: result.promptTokens ?? 0,
        completionTokens: result.completionTokens ?? 0,
        totalTokens: (result.promptTokens ?? 0) + (result.completionTokens ?? 0),
        durationMs: result.durationMs,
        timestamp: Date.now(),
      });
    }

    if (result.completed) {
      reportTrace(services, request, context, {
        phase: 'execution',
        checkpoint: 'openclaw-run-complete',
        runState: 'completed',
      });
      return {
        metadata: {
          runtimeBoundary: {
            type: 'openclaw-canvas',
            participantId: OPENCLAW_CANVAS_PARTICIPANT_ID,
            runtime: 'openclaw',
          },
        },
      };
    }

    reportTrace(services, request, context, {
      phase: 'execution',
      checkpoint: 'openclaw-run-incomplete',
      runState: 'failed',
      note: 'iteration-budget-exhausted',
    });
    return {
      errorDetails: {
        message: 'OpenClaw canvas lane exhausted its iteration budget.',
        responseIsIncomplete: true,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    reportTrace(services, request, context, {
      phase: 'execution',
      checkpoint: 'openclaw-run-error',
      runState: 'failed',
      note: message,
    });
    response.warning(`OpenClaw canvas lane failed: ${message}`);
    return {
      errorDetails: {
        message,
        responseIsIncomplete: true,
      },
    };
  }
}

function formatPageStructure(structure: IPageStructure): string {
  if (structure.blocks.length === 0) {
    return '(empty page — no blocks)';
  }

  return [
    `Page: ${structure.title}`,
    ...structure.blocks.map((block) => {
      const preview = block.textPreview
        ? `: ${block.textPreview.slice(0, 200)}${block.textPreview.length > 200 ? '...' : ''}`
        : '';
      return `[${block.blockType}] ${block.id.slice(0, 8)}${preview}`;
    }),
  ].join('\n');
}

function reportTrace(
  services: ICanvasParticipantServices,
  request: IChatParticipantRequest,
  context: IChatParticipantContext,
  patch: Partial<IChatRuntimeTrace> & Pick<IChatRuntimeTrace, 'phase' | 'checkpoint' | 'runState'>,
): void {
  if (!services.reportRuntimeTrace) {
    return;
  }
  services.reportRuntimeTrace({
    ...buildOpenclawTraceSeed(request, 'OpenClaw canvas route'),
    sessionId: context.sessionId,
    runtime: 'openclaw',
    ...patch,
  });
}