// workspaceParticipant.ts — @workspace chat participant (M9 Task 5.3)
//
// Provides workspace-aware chat context. Supports /search, /list, /summarize
// commands that inject page data into the LLM prompt.
//
// Pattern: context injection, NOT tool calls — Ask-mode compatible.
//
// VS Code reference:
//   src/vs/workbench/contrib/chat/browser/chatAgents.ts — workspace agent gathers context

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
} from '../../../services/chatTypes.js';
import type { IWorkspaceParticipantServices } from '../chatTypes.js';
import { dispatchScopedParticipantCommand } from '../utilities/chatParticipantCommandDispatcher.js';
import { appendScopedParticipantHistory } from '../utilities/chatScopedParticipantExecution.js';
import { runScopedParticipantPrompt } from '../utilities/chatScopedParticipantPromptRunner.js';

// IPageSummary, IWorkspaceParticipantServices — now defined in chatTypes.ts (M13 Phase 1)
export type { IPageSummary, IWorkspaceParticipantServices } from '../chatTypes.js';

// ── Constants ──

const WORKSPACE_PARTICIPANT_ID = 'parallx.chat.workspace';
const MAX_PAGES_IN_CONTEXT = 50;
const MAX_CONTENT_CHARS = 4000; // Truncate page content for context budget

// ── Factory ──

/**
 * Create the @workspace chat participant.
 *
 * Commands:
 *   /search <query> — Search pages by title
 *   /list            — List all pages
 *   /summarize <id>  — Summarize a page's content
 */
export function createWorkspaceParticipant(services: IWorkspaceParticipantServices): IChatParticipant & IDisposable {

  const handler: IChatParticipantHandler = async (
    request: IChatParticipantRequest,
    context: IChatParticipantContext,
    response: IChatResponseStream,
    token: ICancellationToken,
  ): Promise<IChatParticipantResult> => {
    try {
      return await dispatchScopedParticipantCommand({
        surface: 'workspace',
        request,
        context,
        response,
        token,
        services,
        handlers: {
          search: handleSearch,
          list: handleList,
          summarize: handleSummarize,
        },
        defaultHandler: handleGeneral,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        errorDetails: { message, responseIsIncomplete: true },
      };
    }
  };

  return {
    id: WORKSPACE_PARTICIPANT_ID,
    displayName: 'Workspace',
    description: 'Answers questions about your workspace pages and content.',
    commands: [
      { name: 'search', description: 'Search pages by title' },
      { name: 'list', description: 'List all pages in the workspace' },
      { name: 'summarize', description: 'Summarize a specific page' },
    ],
    handler,
    dispose: () => {/* no-op */},
  };
}

// ── Command handlers ──

async function handleSearch(
  request: import('../chatTypes.js').IChatParticipantInterpretation,
  _context: IChatParticipantContext,
  response: IChatResponseStream,
  token: ICancellationToken,
  services: IWorkspaceParticipantServices,
): Promise<IChatParticipantResult> {
  const query = request.effectiveText;
  if (!query) {
    response.markdown('Please provide a search query. Example: `@workspace /search meeting notes`');
    return {};
  }

  response.progress(`Searching for "${query}"...`);

  if (token.isCancellationRequested) { return {}; }

  const results = await services.searchPages(query);

  if (results.length === 0) {
    response.markdown(`No pages found matching "${query}".`);
    return {};
  }

  // Add references for each result
  for (const page of results) {
    response.reference(`parallx://page/${page.id}`, `${page.icon ?? '📄'} ${page.title}`);
  }

  // Build context for LLM
  const contextText = results
    .map((p) => `- ${p.icon ?? '📄'} "${p.title}" (id: ${p.id})`)
    .join('\n');

  return await runScopedParticipantPrompt(
    [
      `You are a workspace assistant for "${services.getWorkspaceName()}".`,
      'The user searched their workspace. Here are the matching pages:',
      '',
      contextText,
      '',
      'Summarise what was found and help the user explore the results.',
    ].join('\n'),
    `I searched for "${query}". What did you find?`,
    undefined,
    response,
    token,
    services.sendChatRequest,
  );
}

async function handleList(
  _request: import('../chatTypes.js').IChatParticipantInterpretation,
  _context: IChatParticipantContext,
  response: IChatResponseStream,
  token: ICancellationToken,
  services: IWorkspaceParticipantServices,
): Promise<IChatParticipantResult> {
  response.progress('Listing workspace pages...');

  if (token.isCancellationRequested) { return {}; }

  const pages = await services.listPages();

  if (pages.length === 0) {
    response.markdown('Your workspace has no pages yet. Create one to get started!');
    return {};
  }

  // Add references
  const displayed = pages.slice(0, MAX_PAGES_IN_CONTEXT);
  for (const page of displayed) {
    response.reference(`parallx://page/${page.id}`, `${page.icon ?? '📄'} ${page.title}`);
  }

  // Build summary
  const lines: string[] = [
    `**${pages.length} page${pages.length !== 1 ? 's' : ''}** in "${services.getWorkspaceName()}":`,
    '',
  ];

  for (const page of displayed) {
    lines.push(`- ${page.icon ?? '📄'} ${page.title}`);
  }

  if (pages.length > MAX_PAGES_IN_CONTEXT) {
    lines.push(`\n... and ${pages.length - MAX_PAGES_IN_CONTEXT} more.`);
  }

  response.markdown(lines.join('\n'));
  return {};
}

async function handleSummarize(
  request: import('../chatTypes.js').IChatParticipantInterpretation,
  _context: IChatParticipantContext,
  response: IChatResponseStream,
  token: ICancellationToken,
  services: IWorkspaceParticipantServices,
): Promise<IChatParticipantResult> {
  const pageId = request.effectiveText;
  if (!pageId) {
    response.markdown('Please provide a page ID. Example: `@workspace /summarize <page-id>`');
    return {};
  }

  response.progress('Reading page content...');

  if (token.isCancellationRequested) { return {}; }

  const title = await services.getPageTitle(pageId);
  if (!title) {
    response.markdown(`Page not found: \`${pageId}\``);
    return {};
  }

  const content = await services.getPageContent(pageId);
  const contentText = content
    ? extractTextFromTiptapJson(content).slice(0, MAX_CONTENT_CHARS)
    : '(empty page)';

  response.reference(`parallx://page/${pageId}`, `📄 ${title}`);

  return await runScopedParticipantPrompt(
    [
      `You are a workspace assistant for "${services.getWorkspaceName()}".`,
      `The user wants a summary of their page titled "${title}".`,
      'Here is the page content:',
      '',
      contentText,
    ].join('\n'),
    `Summarize this page: "${title}"`,
    undefined,
    response,
    token,
    services.sendChatRequest,
  );
}

async function handleGeneral(
  request: import('../chatTypes.js').IChatParticipantInterpretation,
  context: IChatParticipantContext,
  response: IChatResponseStream,
  token: ICancellationToken,
  services: IWorkspaceParticipantServices,
): Promise<IChatParticipantResult> {
  // Inject workspace overview into the system prompt
  response.progress('Gathering workspace context...');

  if (token.isCancellationRequested) { return {}; }

  const pages = await services.listPages();
  const pageList = pages
    .slice(0, 20)
    .map((p) => `- ${p.icon ?? '📄'} "${p.title}"`)
    .join('\n');

  // Gather file system context if available
  let fileListSection = '';
  if (services.listFiles) {
    try {
      const entries = await services.listFiles('.');
      if (entries.length > 0) {
        const fileLines = entries
          .slice(0, 30)
          .map((e) => `- ${e.type === 'directory' ? '📁' : '📄'} ${e.name}`)
          .join('\n');
        fileListSection = [
          '',
          `The workspace file system root contains ${entries.length} entries:`,
          '',
          fileLines,
          entries.length > 30 ? `\n... and ${entries.length - 30} more.` : '',
        ].join('\n');
      }
    } catch {
      // File system not available — skip silently
    }
  }

  return await runScopedParticipantPrompt(
    [
      `You are a workspace assistant for "${services.getWorkspaceName()}".`,
      `The workspace contains ${pages.length} canvas page${pages.length !== 1 ? 's' : ''}:`,
      '',
      pageList || '(no pages yet)',
      fileListSection,
      '',
      'Answer the user\'s question using workspace context where relevant.',
      'If the question is about a specific page, reference it by title.',
      'If the question is about files, reference them by path.',
    ].join('\n'),
    request.effectiveText,
    context,
    response,
    token,
    services.sendChatRequest,
  );
}

/**
 * Extract plain text from a Tiptap JSON content string.
 * Traverses the doc tree and concatenates text nodes.
 */
function extractTextFromTiptapJson(jsonStr: string): string {
  try {
    const doc = JSON.parse(jsonStr);
    const texts: string[] = [];
    walkTiptapNode(doc, texts);
    return texts.join('\n');
  } catch {
    return jsonStr; // Fallback: return raw string
  }
}

function walkTiptapNode(node: unknown, texts: string[]): void {
  if (!node || typeof node !== 'object') { return; }
  const n = node as Record<string, unknown>;

  // Text node
  if (n['type'] === 'text' && typeof n['text'] === 'string') {
    texts.push(n['text'] as string);
    return;
  }

  // Recurse into content array
  if (Array.isArray(n['content'])) {
    for (const child of n['content']) {
      walkTiptapNode(child, texts);
    }
  }
}
