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
  IChatParticipantHandler,
  IChatParticipantRequest,
  IChatParticipantContext,
  IChatResponseStream,
  ICancellationToken,
  IChatParticipantResult,
  IChatMessage,
  IChatRequestOptions,
  IChatResponseChunk,
} from '../../../services/chatTypes.js';

// ── Service accessor ──

/** Block summary returned by canvas queries. */
export interface IBlockSummary {
  readonly id: string;
  readonly blockType: string;
  readonly parentBlockId: string | null;
  readonly sortOrder: number;
  /** Plain text preview of the block content (truncated). */
  readonly textPreview: string;
}

/** Page structure with blocks. */
export interface IPageStructure {
  readonly pageId: string;
  readonly title: string;
  readonly icon?: string;
  readonly blocks: readonly IBlockSummary[];
}

/**
 * Services injected into the canvas participant.
 * Wired in chatTool.ts with real service implementations.
 */
export interface ICanvasParticipantServices {
  sendChatRequest(
    messages: readonly IChatMessage[],
    options?: IChatRequestOptions,
    signal?: AbortSignal,
  ): AsyncIterable<IChatResponseChunk>;
  getActiveModel(): string | undefined;

  /** Get the ID of the currently active page (from editor). */
  getCurrentPageId(): string | undefined;
  /** Get the title of the currently active page. */
  getCurrentPageTitle(): string | undefined;
  /** Get the block structure of a page. */
  getPageStructure(pageId: string): Promise<IPageStructure | null>;
  /** Workspace display name. */
  getWorkspaceName(): string;
}

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

  const handler: IChatParticipantHandler = async (
    request: IChatParticipantRequest,
    context: IChatParticipantContext,
    response: IChatResponseStream,
    token: ICancellationToken,
  ): Promise<IChatParticipantResult> => {

    const command = request.command;

    try {
      if (command === 'describe') {
        return await handleDescribe(request, context, response, token, services);
      } else if (command === 'blocks') {
        return await handleBlocks(request, context, response, token, services);
      } else {
        // No command — answer canvas-related questions with page context
        return await handleGeneral(request, context, response, token, services);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { errorDetails: { message, responseIsIncomplete: true } };
    }
  };

  return {
    id: CANVAS_PARTICIPANT_ID,
    displayName: 'Canvas',
    description: 'Answers questions about your canvas pages and block structure.',
    commands: [
      { name: 'describe', description: 'Describe the current page structure' },
      { name: 'blocks', description: 'List all blocks on the current page' },
    ],
    handler,
    dispose: () => {/* no-op */},
  };
}

// ── Command handlers ──

async function handleDescribe(
  _request: IChatParticipantRequest,
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

  const messages: IChatMessage[] = [
    {
      role: 'system',
      content: [
        `You are a canvas assistant for "${services.getWorkspaceName()}".`,
        `The user is viewing the page "${structure.title}".`,
        'Here is the page structure:',
        '',
        structureText,
        '',
        'Describe the page structure, organisation, and content to the user.',
      ].join('\n'),
    },
    { role: 'user', content: `Describe the structure of "${structure.title}".` },
  ];

  return await streamLLMResponse(messages, response, token, services);
}

async function handleBlocks(
  _request: IChatParticipantRequest,
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
  request: IChatParticipantRequest,
  context: IChatParticipantContext,
  response: IChatResponseStream,
  token: ICancellationToken,
  services: ICanvasParticipantServices,
): Promise<IChatParticipantResult> {
  const pageId = services.getCurrentPageId();

  const messages: IChatMessage[] = [];
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

  messages.push({ role: 'system', content: systemLines.join('\n') });

  // History
  for (const pair of context.history) {
    messages.push({ role: 'user', content: pair.request.text });
    const responseText = pair.response.parts
      .map((part) => {
        if ('content' in part && typeof part.content === 'string') { return part.content; }
        if ('code' in part && typeof part.code === 'string') { return '```\n' + part.code + '\n```'; }
        return '';
      })
      .filter(Boolean)
      .join('\n');
    if (responseText) {
      messages.push({ role: 'assistant', content: responseText });
    }
  }

  messages.push({ role: 'user', content: request.text });

  return await streamLLMResponse(messages, response, token, services);
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

/**
 * Stream the LLM response to the chat response stream.
 */
async function streamLLMResponse(
  messages: IChatMessage[],
  response: IChatResponseStream,
  token: ICancellationToken,
  services: ICanvasParticipantServices,
): Promise<IChatParticipantResult> {
  const abortController = new AbortController();
  if (token.isCancellationRequested) { abortController.abort(); }
  const cancelListener = token.onCancellationRequested(() => abortController.abort());

  try {
    const stream = services.sendChatRequest(messages, undefined, abortController.signal);

    for await (const chunk of stream) {
      if (token.isCancellationRequested) { break; }
      if (chunk.thinking) { response.thinking(chunk.thinking); }
      if (chunk.content) { response.markdown(chunk.content); }
    }

    return {};
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') { return {}; }
    const message = err instanceof Error ? err.message : String(err);
    return { errorDetails: { message, responseIsIncomplete: true } };
  } finally {
    cancelListener.dispose();
  }
}
