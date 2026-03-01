// chatSystemPrompts.ts — Mode-aware system prompt builder (M9 Task 4.2)
//
// Builds the system prompt prepended to every Ollama request.
// The prompt varies by mode and includes workspace context.
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
 */
export interface ISystemPromptContext {
  /** Workspace display name (e.g. "My Project"). */
  readonly workspaceName: string;
  /** Number of pages in the workspace. */
  readonly pageCount: number;
  /** Title of the currently active page, if any. */
  readonly currentPageTitle?: string;
  /** Tool definitions to include (Agent mode only). */
  readonly tools?: readonly IToolDefinition[];
  /** Actual page titles for context (up to ~20). */
  readonly pageNames?: readonly string[];
  /** Actual file/dir names at workspace root (up to ~30). */
  readonly fileNames?: readonly string[];
}

// ── Prompt builders ──

/**
 * Build the system prompt for the given mode and context.
 *
 * The prompt is kept concise to preserve context window budget.
 * Large system prompts are the #1 cause of context overflow.
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
  const lines: string[] = [
    'You are Parallx, a helpful local AI assistant for a knowledge workspace.',
    'Be concise, clear, and use markdown formatting when appropriate.',
    '',
    `Workspace: "${ctx.workspaceName}" (${ctx.pageCount} canvas page${ctx.pageCount !== 1 ? 's' : ''}).`,
  ];

  if (ctx.currentPageTitle) {
    lines.push(`The user is currently viewing: "${ctx.currentPageTitle}".`);
  }

  // Inject actual page names so the model doesn't hallucinate
  appendContentListings(lines, ctx);

  lines.push(
    '',
    'Answer questions about workspace content, general knowledge, and anything the user asks.',
    'You do NOT have access to tools or the ability to modify content. Only answer and explain.',
    'IMPORTANT: Only reference pages and files that are listed above. Do NOT invent or guess page/file names.',
  );

  return lines.join('\n');
}

// ── Edit mode ──

function buildEditPrompt(ctx: ISystemPromptContext): string {
  const lines: string[] = [
    'You are Parallx, a local AI assistant in Edit mode for a knowledge workspace.',
    '',
    `Workspace: "${ctx.workspaceName}" (${ctx.pageCount} page${ctx.pageCount !== 1 ? 's' : ''}).`,
  ];

  if (ctx.currentPageTitle) {
    lines.push(`The user is viewing: "${ctx.currentPageTitle}".`);
  }

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
    'You are Parallx, a local AI agent for a knowledge workspace.',
    'You have access to tools and can take autonomous actions.',
    '',
    `Workspace: "${ctx.workspaceName}" (${ctx.pageCount} canvas page${ctx.pageCount !== 1 ? 's' : ''}).`,
  ];

  if (ctx.currentPageTitle) {
    lines.push(`The user is viewing: "${ctx.currentPageTitle}".`);
  }

  // Inject actual page/file names
  appendContentListings(lines, ctx);

  // Include tool descriptions if available
  if (ctx.tools && ctx.tools.length > 0) {
    lines.push(
      '',
      'You have the following tools available:',
      '',
    );

    for (const tool of ctx.tools) {
      lines.push(`- **${tool.name}**: ${tool.description}`);

      // Include parameter schema summary if compact enough
      const paramKeys = Object.keys(tool.parameters);
      if (paramKeys.length > 0) {
        const schema = tool.parameters as Record<string, unknown>;
        const props = schema['properties'] as Record<string, { type?: string; description?: string }> | undefined;
        if (props) {
          const paramList = Object.entries(props)
            .map(([key, val]) => `\`${key}\` (${val.type ?? 'any'}): ${val.description ?? ''}`)
            .join('; ');
          lines.push(`  Parameters: ${paramList}`);
        }
      }
    }
  }

  lines.push(
    '',
    'Guidelines:',
    '- Use tools when they help answer the user\'s question',
    '- Explain your reasoning before and after tool use',
    '- If a tool call fails, explain the error and suggest alternatives',
    '- Read-only tools (search, read, list) can be used freely',
    '- Write tools (create, update, delete) require user confirmation',
    '- IMPORTANT: Only reference pages and files that actually exist (listed above or discovered via tools). Do NOT guess or invent names.',
  );

  return lines.join('\n');
}

// ── Shared helpers ──

/**
 * Append actual page titles and file names to the system prompt lines.
 * Prevents the LLM from hallucinating content that doesn't exist.
 */
function appendContentListings(lines: string[], ctx: ISystemPromptContext): void {
  if (ctx.pageNames && ctx.pageNames.length > 0) {
    lines.push('', 'Canvas pages in this workspace:');
    for (const name of ctx.pageNames) {
      lines.push(`- ${name}`);
    }
    if (ctx.pageCount > ctx.pageNames.length) {
      lines.push(`  ...and ${ctx.pageCount - ctx.pageNames.length} more.`);
    }
  }

  if (ctx.fileNames && ctx.fileNames.length > 0) {
    lines.push('', 'Files and folders at the workspace root:');
    for (const name of ctx.fileNames) {
      lines.push(`- ${name}`);
    }
  }
}
