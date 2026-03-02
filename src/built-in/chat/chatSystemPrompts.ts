// chatSystemPrompts.ts — Dynamic system prompt builder (M9 Task 4.2, M10 Task 4.1 + 4.2)
//
// Builds the system prompt prepended to every Ollama request.
// The prompt varies by mode and includes workspace context.
//
// M10 Phase 4 overhaul:
//   - Removed static page/file listings (replaced by RAG retrieval)
//   - Added Parallx self-awareness (identity, capabilities)
//   - Added dynamic workspace statistics (pages, files, RAG status)
//   - Kept total system prompt under ~2000 tokens
//
// VS Code reference:
//   System prompts are assembled in the agent handler. VS Code builds them
//   from multiple sources (agent description, mode, tools, workspace context).
//   Parallx centralises prompt building here for consistency.

import { ChatMode } from '../../services/chatTypes.js';
import type { IToolDefinition } from '../../services/chatTypes.js';

// ── Context types ──

/**
 * Dynamic context injected into system prompts.
 *
 * M10 Phase 4: Removed `pageNames` and `fileNames` arrays — RAG retrieval
 * replaces static listings. Added workspace statistics and RAG status.
 */
export interface ISystemPromptContext {
  /** Workspace display name (e.g. "My Project"). */
  readonly workspaceName: string;
  /** Number of pages in the workspace. */
  readonly pageCount: number;
  /** Title of the currently active page, if any. */
  readonly currentPageTitle?: string;
  /** Tool definitions to include (Ask mode: read-only; Agent mode: all). */
  readonly tools?: readonly IToolDefinition[];
  /** Number of files in the workspace (0 if unknown). */
  readonly fileCount?: number;
  /** Whether the RAG knowledge index is ready for retrieval. */
  readonly isRAGAvailable?: boolean;
  /** Whether the indexing pipeline is currently running. */
  readonly isIndexing?: boolean;
}

// ── Parallx identity (Task 4.2) ──

const PARALLX_IDENTITY = [
  'You are Parallx AI, the built-in assistant for Parallx — a local-first knowledge workspace and second-brain tool.',
  'Parallx combines canvas pages (rich-text notes), a file explorer, and AI-powered tools into a unified workbench for organising knowledge, ideas, and projects.',
  'Everything runs locally on the user\'s machine. You are powered by Ollama (local LLM inference) and have no internet access.',
].join(' ');

// ── Prompt builders ──

/**
 * Build the system prompt for the given mode and context.
 *
 * M10 Phase 4: Prompts are kept concise (~1000-1500 tokens) to preserve
 * context window budget. RAG-retrieved context and page/file listings
 * are injected into the *user* message, not the system prompt.
 */
export function buildSystemPrompt(mode: ChatMode, context: ISystemPromptContext): string {
  switch (mode) {
    case ChatMode.Ask:
      return buildAskPrompt(context);
    case ChatMode.Edit:
      return buildEditPrompt(context);
    case ChatMode.Agent:
      return buildAgentPrompt(context);
    default:
      return buildAskPrompt(context);
  }
}

// ── Ask mode ──

function buildAskPrompt(ctx: ISystemPromptContext): string {
  const lines: string[] = [PARALLX_IDENTITY];

  // Workspace statistics
  lines.push('');
  appendWorkspaceStats(lines, ctx);

  // Context explanation (RAG-aware)
  lines.push(
    '',
    'CONTEXT:',
    '- The content of the currently open page (if any) is included in the user\'s message automatically.',
  );
  if (ctx.isRAGAvailable) {
    lines.push('- Relevant knowledge from across the workspace is retrieved automatically via semantic search and included in the user\'s message.');
  }
  lines.push(
    '- If the user attaches files or pages, their content is also included directly in the message.',
  );

  // Read-only tool list
  if (ctx.tools && ctx.tools.length > 0) {
    lines.push(
      '',
      'TOOLS (read-only):',
    );
    for (const tool of ctx.tools) {
      lines.push(`- ${tool.name}: ${tool.description}`);
    }
  }

  // Rules
  lines.push(
    '',
    'RULES:',
    '- When the user asks about content NOT in the provided context, use tools (read_page, search_workspace, search_knowledge) to find it first.',
    '- Do NOT guess or invent page names, file names, or content. Only reference what is in the context or discovered via tools.',
    '- You can READ workspace content with tools but CANNOT create, modify, or delete anything.',
    '- read_page accepts both a page UUID and a page title.',
    '- Be concise. Use markdown formatting when appropriate.',
  );

  return lines.join('\n');
}

// ── Edit mode ──

function buildEditPrompt(ctx: ISystemPromptContext): string {
  const lines: string[] = [
    'You are Parallx AI in Edit mode — a local-first knowledge workspace assistant.',
    '',
  ];

  appendWorkspaceStats(lines, ctx);

  lines.push(
    '',
    'Your task is to propose edits to canvas pages and blocks.',
    'Respond with a JSON object matching this schema:',
    '',
    '```json',
    '{',
    '  "explanation": "Brief description of the changes",',
    '  "edits": [',
    '    {',
    '      "pageId": "<page-uuid>",',
    '      "blockId": "<block-uuid or omit for page-level>",',
    '      "operation": "insert" | "update" | "delete",',
    '      "content": "<new content for insert/update>"',
    '    }',
    '  ]',
    '}',
    '```',
    '',
    'Available operations:',
    '- **insert**: Add a new block to the page',
    '- **update**: Replace the content of an existing block',
    '- **delete**: Remove a block from the page',
    '',
    'Always include an "explanation" field describing what you changed and why.',
    'If the user request is unclear, ask for clarification instead of guessing.',
  );

  return lines.join('\n');
}

// ── Agent mode ──

function buildAgentPrompt(ctx: ISystemPromptContext): string {
  const lines: string[] = [
    PARALLX_IDENTITY,
    'You are in Agent mode — you can take autonomous actions using tools.',
  ];

  // Workspace statistics
  lines.push('');
  appendWorkspaceStats(lines, ctx);

  // Context explanation (RAG-aware)
  lines.push(
    '',
    'CONTEXT:',
    '- The content of the currently open page (if any) is included in the user\'s message automatically.',
  );
  if (ctx.isRAGAvailable) {
    lines.push('- Relevant knowledge from across the workspace is retrieved automatically via semantic search and included in the user\'s message.');
  }
  lines.push(
    '- If the user attaches files or pages, their content is also included directly in the message.',
  );

  // Full tool list
  if (ctx.tools && ctx.tools.length > 0) {
    lines.push(
      '',
      'TOOLS:',
    );
    for (const tool of ctx.tools) {
      const paramSummary = formatToolParams(tool);
      lines.push(`- ${tool.name}: ${tool.description}${paramSummary ? ` (${paramSummary})` : ''}`);
    }
  }

  // Rules
  lines.push(
    '',
    'RULES:',
    '- Use tools proactively — read before answering, search before claiming something does or does not exist.',
    '- Read-only tools (search, read, list) can be used freely. Write tools (create, update, delete) require user confirmation.',
    '- Do NOT invent page names, file names, or content. Only reference what you discover via tools or context.',
    '- read_page accepts both a page UUID and a page title.',
    '- Explain your reasoning before and after tool use.',
    '- If a tool call fails, explain the error and suggest alternatives.',
  );

  return lines.join('\n');
}

// ── Shared helpers ──

/**
 * Append compact workspace statistics to the prompt lines.
 */
function appendWorkspaceStats(lines: string[], ctx: ISystemPromptContext): void {
  const parts: string[] = [];
  parts.push(`${ctx.pageCount} canvas page${ctx.pageCount !== 1 ? 's' : ''}`);
  if (ctx.fileCount !== undefined && ctx.fileCount > 0) {
    parts.push(`${ctx.fileCount} file${ctx.fileCount !== 1 ? 's' : ''}`);
  }

  lines.push(`Workspace: "${ctx.workspaceName}" — ${parts.join(', ')}.`);

  if (ctx.currentPageTitle) {
    lines.push(`Currently viewing: "${ctx.currentPageTitle}".`);
  }

  // Index status
  if (ctx.isIndexing) {
    lines.push('Knowledge index: building (some queries may return incomplete results).');
  } else if (ctx.isRAGAvailable) {
    lines.push('Knowledge index: ready (semantic search available across all workspace content).');
  }
}

/**
 * Format tool parameter names compactly for the Agent mode tool list.
 * Returns empty string if no meaningful params.
 */
function formatToolParams(tool: IToolDefinition): string {
  const schema = tool.parameters as Record<string, unknown>;
  const props = schema['properties'] as Record<string, { type?: string }> | undefined;
  if (!props) { return ''; }
  return Object.entries(props)
    .map(([key, val]) => `${key}: ${val.type ?? 'any'}`)
    .join(', ');
}
