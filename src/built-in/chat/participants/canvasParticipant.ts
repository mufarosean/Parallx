// canvasParticipant.ts — @canvas chat participant (M9 Task 5.4)
//
// Provides canvas-specific chat context. Supports /describe and /blocks
// commands that inject current page structure into the LLM prompt.
//
// Pattern: read-only context injection via existing services.
// Edit mode capabilities fully implemented in Capability 7.
//
// VS Code reference:
//   Canvas participants are Parallx-specific — no direct VS Code counterpart.

import type { IDisposable } from '../../../platform/lifecycle.js';
import type {
  IChatParticipant,
  IChatParticipantRequest,
  IChatParticipantContext,
  IChatResponseStream,
  ICancellationToken,
  IChatParticipantResult,
} from '../../../services/chatTypes.js';
import type { IPageStructure, ICanvasParticipantServices } from '../chatTypes.js';
import { createScopedChatParticipantRuntime } from '../utilities/chatScopedParticipantRuntime.js';
import { runScopedParticipantPrompt } from '../utilities/chatScopedParticipantPromptRunner.js';

// IBlockSummary, IPageStructure, ICanvasParticipantServices — now defined in chatTypes.ts (M13 Phase 1)
export type { IBlockSummary, IPageStructure, ICanvasParticipantServices } from '../chatTypes.js';

// ── Constants ──

const CANVAS_PARTICIPANT_ID = 'parallx.chat.canvas';
const MAX_BLOCK_PREVIEW = 200; // chars per block preview

// ── Factory ──

/**
 * Create the @canvas chat participant.
 *
 * Commands:
 *   /describe — Describe the current page structure
 *   /blocks   — List all blocks on the current page
 */
export function createCanvasParticipant(services: ICanvasParticipantServices): IChatParticipant & IDisposable {
  const runtime = createScopedChatParticipantRuntime({
    surface: 'canvas',
    services,
    handlers: {
      describe: handleDescribe,
      blocks: handleBlocks,
    },
    defaultHandler: handleGeneral,
  });

  const handler = (request: IChatParticipantRequest, context: IChatParticipantContext, response: IChatResponseStream, token: ICancellationToken) => runtime.handleTurn(
    request,
    context,
    response,
    token,
  );

  return {
    id: CANVAS_PARTICIPANT_ID,
    surface: 'canvas',
    displayName: 'Canvas',
    description: 'Answers questions about your canvas pages and block structure.',
    commands: [
      { name: 'describe', description: 'Describe the current page structure' },
      { name: 'blocks', description: 'List all blocks on the current page' },
    ],
    runtime,
    handler,
    dispose: () => {/* no-op */},
  };
}

// ── Command handlers ──

async function handleDescribe(
  _request: import('../chatTypes.js').IChatParticipantInterpretation,
  originalRequest: IChatParticipantRequest,
  _context: IChatParticipantContext,
  response: IChatResponseStream,
  token: ICancellationToken,
  services: ICanvasParticipantServices,
): Promise<IChatParticipantResult> {
  const pageId = services.getCurrentPageId();
  if (!pageId) {
    response.markdown('No page is currently open. Open a canvas page to use `@canvas /describe`.');
    return {};
  }

  response.progress('Reading page structure...');

  if (token.isCancellationRequested) { return {}; }

  const structure = await services.getPageStructure(pageId);
  if (!structure) {
    response.markdown(`Could not read page structure for \`${pageId}\`.`);
    return {};
  }

  response.reference(`parallx://page/${pageId}`, `${structure.icon ?? '📄'} ${structure.title}`);

  const structureText = formatPageStructure(structure);

  return await runScopedParticipantPrompt({
    systemPrompt: [
      `You are a canvas assistant for "${services.getWorkspaceName()}".`,
      `The user is viewing the page "${structure.title}".`,
      'Here is the page structure:',
      '',
      structureText,
      '',
      'Describe the page structure, organisation, and content to the user.',
    ].join('\n'),
    userText: `Describe the structure of "${structure.title}".`,
    request: originalRequest,
    context: undefined,
    response,
    token,
    sendChatRequest: services.sendChatRequest,
    readFileContent: services.readFileContent,
    reportParticipantDebug: services.reportParticipantDebug,
    reportRuntimeTrace: services.reportRuntimeTrace,
    surface: 'canvas',
  });
}

async function handleBlocks(
  _request: import('../chatTypes.js').IChatParticipantInterpretation,
  _originalRequest: IChatParticipantRequest,
  _context: IChatParticipantContext,
  response: IChatResponseStream,
  token: ICancellationToken,
  services: ICanvasParticipantServices,
): Promise<IChatParticipantResult> {
  const pageId = services.getCurrentPageId();
  if (!pageId) {
    response.markdown('No page is currently open. Open a canvas page to use `@canvas /blocks`.');
    return {};
  }

  response.progress('Reading blocks...');

  if (token.isCancellationRequested) { return {}; }

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

  // Build block list
  const lines: string[] = [
    `**${structure.blocks.length} block${structure.blocks.length !== 1 ? 's' : ''}** on "${structure.title}":`,
    '',
  ];

  for (const block of structure.blocks) {
    const indent = block.parentBlockId ? '  ' : '';
    const preview = block.textPreview
      ? ` — ${block.textPreview.slice(0, 80)}${block.textPreview.length > 80 ? '...' : ''}`
      : '';
    lines.push(`${indent}- **${block.blockType}** \`${block.id.slice(0, 8)}...\`${preview}`);
    response.reference(`parallx://block/${block.id}`, `${block.blockType} block`);
  }

  response.markdown(lines.join('\n'));
  return {};
}

async function handleGeneral(
  request: import('../chatTypes.js').IChatParticipantInterpretation,
  originalRequest: IChatParticipantRequest,
  context: IChatParticipantContext,
  response: IChatResponseStream,
  token: ICancellationToken,
  services: ICanvasParticipantServices,
): Promise<IChatParticipantResult> {
  const pageId = services.getCurrentPageId();

  const systemLines: string[] = [
    `You are a canvas assistant for "${services.getWorkspaceName()}".`,
  ];

  // Include current page context if available
  if (pageId) {
    response.progress('Reading current page...');
    if (token.isCancellationRequested) { return {}; }

    const structure = await services.getPageStructure(pageId);
    if (structure) {
      response.reference(`parallx://page/${pageId}`, `${structure.icon ?? '📄'} ${structure.title}`);
      systemLines.push(
        `The user is viewing "${structure.title}".`,
        'Page structure:',
        '',
        formatPageStructure(structure),
      );
    }
  } else {
    systemLines.push('No page is currently open.');
  }

  systemLines.push(
    '',
    'Answer the user\'s question about the canvas page and its blocks.',
  );

  return await runScopedParticipantPrompt({
    systemPrompt: systemLines.join('\n'),
    userText: request.effectiveText,
    request: originalRequest,
    context,
    response,
    token,
    sendChatRequest: services.sendChatRequest,
    readFileContent: services.readFileContent,
    reportParticipantDebug: services.reportParticipantDebug,
    reportRuntimeTrace: services.reportRuntimeTrace,
    surface: 'canvas',
  });
}

// ── Helpers ──

/**
 * Format page structure as a concise text description.
 */
function formatPageStructure(structure: IPageStructure): string {
  if (structure.blocks.length === 0) {
    return '(empty page — no blocks)';
  }

  const lines: string[] = [];
  for (const block of structure.blocks) {
    const indent = block.parentBlockId ? '  ' : '';
    const preview = block.textPreview
      ? `: ${block.textPreview.slice(0, MAX_BLOCK_PREVIEW)}${block.textPreview.length > MAX_BLOCK_PREVIEW ? '...' : ''}`
      : '';
    lines.push(`${indent}[${block.blockType}] ${block.id.slice(0, 8)}${preview}`);
  }
  return lines.join('\n');
}
