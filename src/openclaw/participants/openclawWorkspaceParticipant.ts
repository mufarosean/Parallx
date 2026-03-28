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
  IChatRuntimeTrace,
  IWorkspaceParticipantServices,
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

const OPENCLAW_WORKSPACE_PARTICIPANT_ID = 'parallx.chat.workspace';

export function createOpenclawWorkspaceParticipant(services: IWorkspaceParticipantServices): IChatParticipant & IDisposable {
  const handler = async (
    request: IChatParticipantRequest,
    context: IChatParticipantContext,
    response: IChatResponseStream,
    token: ICancellationToken,
  ): Promise<IChatParticipantResult> => handleWorkspaceTurn(services, request, context, response, token);

  return {
    id: OPENCLAW_WORKSPACE_PARTICIPANT_ID,
    surface: 'workspace',
    displayName: 'Workspace',
    description: 'OpenClaw-style workspace assistant lane.',
    commands: [
      { name: 'search', description: 'Search pages by title' },
      { name: 'list', description: 'List all pages in the workspace' },
      { name: 'summarize', description: 'Summarize a specific page' },
    ],
    handler,
    runtime: { handleTurn: handler },
    dispose: () => {},
  };
}

async function handleWorkspaceTurn(
  services: IWorkspaceParticipantServices,
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
    case 'list':
      return handleList(services, response, token);
    case 'search':
      return handleSearch(services, request, context, response, token);
    case 'summarize':
      return handleSummarize(services, request, context, response, token);
    default:
      return handleGeneral(services, request, context, response, token);
  }
}

async function handleList(
  services: IWorkspaceParticipantServices,
  response: IChatResponseStream,
  token: ICancellationToken,
): Promise<IChatParticipantResult> {
  response.progress('Listing workspace pages...');
  if (token.isCancellationRequested) {
    return {};
  }

  const pages = await services.listPages();
  if (pages.length === 0) {
    response.markdown('Your workspace has no pages yet. Create one to get started!');
    return {};
  }

  const displayed = pages.slice(0, 50);
  for (const page of displayed) {
    response.reference(`parallx://page/${page.id}`, `${page.icon ?? '📄'} ${page.title}`);
  }

  const lines: string[] = [
    `**${pages.length} page${pages.length !== 1 ? 's' : ''}** in "${services.getWorkspaceName()}":`,
    '',
  ];
  for (const page of displayed) {
    lines.push(`- ${page.icon ?? '📄'} ${page.title}`);
  }
  if (pages.length > displayed.length) {
    lines.push(``, `... and ${pages.length - displayed.length} more.`);
  }

  response.markdown(lines.join('\n'));
  return {};
}

async function handleSearch(
  services: IWorkspaceParticipantServices,
  request: IChatParticipantRequest,
  context: IChatParticipantContext,
  response: IChatResponseStream,
  token: ICancellationToken,
): Promise<IChatParticipantResult> {
  const query = request.text.trim();
  if (!query) {
    response.markdown('Please provide a search query. Example: `@workspace /search meeting notes`');
    return {};
  }

  response.progress(`Searching for "${query}"...`);
  if (token.isCancellationRequested) {
    return {};
  }

  const results = await services.searchPages(query);
  if (results.length === 0) {
    response.markdown(`No pages found matching "${query}".`);
    return {};
  }

  for (const page of results) {
    response.reference(`parallx://page/${page.id}`, `${page.icon ?? '📄'} ${page.title}`);
  }

  const promptContext = [
    `Workspace search query: ${query}`,
    'Matching pages:',
    ...results.map((page) => `- ${page.icon ?? '📄'} ${page.title} (id: ${page.id})`),
  ].join('\n');

  return runWorkspacePromptTurn(services, request, context, response, token, {
    userText: `Summarize the workspace search results for: ${query}`,
    promptContext,
    traceReason: 'OpenClaw workspace search lane',
    boundaryType: 'openclaw-workspace',
  });
}

async function handleSummarize(
  services: IWorkspaceParticipantServices,
  request: IChatParticipantRequest,
  context: IChatParticipantContext,
  response: IChatResponseStream,
  token: ICancellationToken,
): Promise<IChatParticipantResult> {
  const pageId = request.text.trim();
  if (!pageId) {
    response.markdown('Please provide a page ID. Example: `@workspace /summarize <page-id>`');
    return {};
  }

  response.progress('Reading page content...');
  if (token.isCancellationRequested) {
    return {};
  }

  const title = await services.getPageTitle(pageId);
  if (!title) {
    response.markdown(`Page not found: \`${pageId}\``);
    return {};
  }

  const content = await services.getPageContent(pageId);
  response.reference(`parallx://page/${pageId}`, `📄 ${title}`);

  const promptContext = [
    `Page title: ${title}`,
    `Page id: ${pageId}`,
    'Page content:',
    '',
    extractTextFromTiptapJson(content ?? '(empty page)').slice(0, 4000),
  ].join('\n');

  return runWorkspacePromptTurn(services, request, context, response, token, {
    userText: `Summarize this workspace page: ${title}`,
    promptContext,
    traceReason: 'OpenClaw workspace summarize lane',
    boundaryType: 'openclaw-workspace',
  });
}

async function handleGeneral(
  services: IWorkspaceParticipantServices,
  request: IChatParticipantRequest,
  context: IChatParticipantContext,
  response: IChatResponseStream,
  token: ICancellationToken,
): Promise<IChatParticipantResult> {
  response.progress('Gathering workspace context...');
  if (token.isCancellationRequested) {
    return {};
  }

  const pages = await services.listPages();
  const promptLines = [
    `Workspace page count: ${pages.length}`,
    'Top workspace pages:',
    ...pages.slice(0, 20).map((page) => `- ${page.icon ?? '📄'} ${page.title} (id: ${page.id})`),
  ];

  if (services.listFiles) {
    try {
      const entries = await services.listFiles('.');
      promptLines.push('', 'Workspace root entries:');
      promptLines.push(...entries.slice(0, 30).map((entry) => `- ${entry.type === 'directory' ? 'dir' : 'file'}: ${entry.name}`));
    } catch {
      // Ignore file listing failures in the OpenClaw lane.
    }
  }

  return runWorkspacePromptTurn(services, request, context, response, token, {
    userText: request.text,
    promptContext: promptLines.join('\n'),
    traceReason: 'OpenClaw workspace general lane',
    boundaryType: 'openclaw-workspace',
  });
}

async function runWorkspacePromptTurn(
  services: IWorkspaceParticipantServices,
  request: IChatParticipantRequest,
  context: IChatParticipantContext,
  response: IChatResponseStream,
  token: ICancellationToken,
  options: {
    userText: string;
    promptContext: string;
    traceReason: string;
    boundaryType: string;
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
  // Skills from catalog (if service exposes it), tools from readonly definitions.
  const skillEntries = (services as any).getSkillCatalog?.() as any[] | undefined;
  const skills = (skillEntries ?? [])
    .filter((s: any) => s.kind === 'workflow' && s.disableModelInvocation !== true)
    .map((s: any) => ({ name: s.name as string, description: (s.description ?? '') as string, location: (s.location ?? '') as string }));
  const toolDefs = services.getReadOnlyToolDefinitions?.() ?? [];
  const tools = toolDefs.map(t => ({ name: t.name, description: t.description }));

  // D8: Resolve agent config for 'workspace' surface if registry is available
  const effectiveConfig = services.unifiedConfigService?.getEffectiveConfig();
  const resolvedAgentConfig = services.agentRegistry ? resolveAgentConfig(
    services.agentRegistry,
    'workspace',
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
      'You are the OpenClaw workspace lane inside Parallx.',
      'Treat the workspace as the source of truth. Use read-only tools when additional evidence is needed.',
      'Workspace context for this turn:',
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
      tools: services.getReadOnlyToolDefinitions?.() ?? [],
      response,
      token,
      maxIterations: OPENCLAW_MAX_READONLY_ITERATIONS,
      invokeToolWithRuntimeControl: services.invokeToolWithRuntimeControl
        ? (name, args, tok) => services.invokeToolWithRuntimeControl!(name, args, tok)
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
            type: options.boundaryType,
            participantId: OPENCLAW_WORKSPACE_PARTICIPANT_ID,
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
        message: 'OpenClaw workspace lane exhausted its iteration budget.',
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
    response.warning(`OpenClaw workspace lane failed: ${message}`);
    return {
      errorDetails: {
        message,
        responseIsIncomplete: true,
      },
    };
  }
}

function reportTrace(
  services: IWorkspaceParticipantServices,
  request: IChatParticipantRequest,
  context: IChatParticipantContext,
  patch: Partial<IChatRuntimeTrace> & Pick<IChatRuntimeTrace, 'phase' | 'checkpoint' | 'runState'>,
): void {
  if (!services.reportRuntimeTrace) {
    return;
  }
  services.reportRuntimeTrace({
    ...buildOpenclawTraceSeed(request, 'OpenClaw workspace route'),
    sessionId: context.sessionId,
    runtime: 'openclaw',
    ...patch,
  });
}

function extractTextFromTiptapJson(jsonStr: string): string {
  try {
    const doc = JSON.parse(jsonStr);
    const texts: string[] = [];
    walkTiptapNode(doc, texts);
    return texts.join('\n');
  } catch {
    return jsonStr;
  }
}

function walkTiptapNode(node: unknown, texts: string[]): void {
  if (!node || typeof node !== 'object') {
    return;
  }
  const record = node as Record<string, unknown>;
  if (record['type'] === 'text' && typeof record['text'] === 'string') {
    texts.push(record['text'] as string);
    return;
  }
  if (Array.isArray(record['content'])) {
    for (const child of record['content']) {
      walkTiptapNode(child, texts);
    }
  }
}