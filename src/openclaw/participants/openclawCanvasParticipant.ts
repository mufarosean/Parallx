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
  executeOpenclawModelTurn,
  loadOpenclawBootstrapEntries,
  OPENCLAW_MAX_READONLY_ITERATIONS,
} from './openclawParticipantRuntime.js';

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
  const { sections: bootstrapSections, debug: bootstrapReport } = buildOpenclawBootstrapContext(bootstrapEntries);
  services.reportBootstrapDebug?.(bootstrapReport);
  const systemPrompt = [
    'You are the OpenClaw canvas lane inside Parallx.',
    'Treat the open canvas page as live workspace state. Use read-only tools when more evidence is needed.',
    `Workspace: ${services.getWorkspaceName()}`,
    ...bootstrapSections,
    'Canvas context for this turn:',
    options.promptContext,
  ].join('\n\n');
  const messages = buildOpenclawSeedMessages(systemPrompt, context.history, {
    ...request,
    text: options.userText,
  });
  const requestOptions = buildOpenclawReadOnlyRequestOptions({
    tools: services.getReadOnlyToolDefinitions?.(),
  });

  reportTrace(services, request, context, {
    phase: 'interpretation',
    checkpoint: 'openclaw-bootstrap-loaded',
    runState: 'prepared',
    note: options.traceReason,
  });

  let iterationsRemaining = OPENCLAW_MAX_READONLY_ITERATIONS;
  while (iterationsRemaining >= 0) {
    const iteration = await executeOpenclawModelTurn(
      services.sendChatRequest,
      messages,
      requestOptions,
      response,
      token,
    );

    if (typeof iteration.promptTokens === 'number' && typeof iteration.completionTokens === 'number') {
      response.reportTokenUsage(iteration.promptTokens, iteration.completionTokens);
    }

    if (iteration.toolCalls.length === 0) {
      if (iteration.markdown) {
        response.markdown(iteration.markdown);
      }
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

    if (!services.invokeToolWithRuntimeControl) {
      response.warning('OpenClaw canvas lane received tool calls, but runtime-controlled tool invocation is not available.');
      break;
    }

    messages.push({
      role: 'assistant',
      content: iteration.markdown,
      toolCalls: iteration.toolCalls,
      thinking: iteration.thinking,
    });

    for (const toolCall of iteration.toolCalls) {
      const toolName = toolCall.function.name;
      reportTrace(services, request, context, {
        phase: 'execution',
        checkpoint: 'openclaw-tool-dispatch',
        runState: 'executing',
        toolName,
      });
      const toolResult = await services.invokeToolWithRuntimeControl(toolName, toolCall.function.arguments, token);
      messages.push({ role: 'tool', content: toolResult.content, toolName });
    }

    iterationsRemaining -= 1;
  }

  response.warning('OpenClaw canvas lane stopped before completing the turn.');
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