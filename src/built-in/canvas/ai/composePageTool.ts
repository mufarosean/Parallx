// composePageTool.ts — the `canvas_compose_page` AI tool.
//
// Live page authoring: the tool carries NO content. The executor runs a focused
// streaming model turn whose output IS the new page body, and each content delta
// is typed into the open editor block-by-block (via the pane's stream sink) so
// the user watches the page being written. When the page isn't open, the
// composed body is written directly to the DB. Implemented over the live
// services in canvas/main.ts (the tool stays pure/testable).

import type {
  IChatTool,
  IToolResult,
  ICancellationToken,
  ToolPermissionLevel,
} from '../../../services/chatTypes.js';

export interface IComposePageOutcome {
  readonly ok: boolean;
  /** Human summary for the tool result (block counts, streamed-vs-direct, errors). */
  readonly summary: string;
}

/** Run the streaming composition for a page. Implemented in canvas/main.ts. */
export type ComposePageFn = (
  pageId: string,
  instruction: string,
  token: ICancellationToken,
) => Promise<IComposePageOutcome>;

export function createComposePageTool(compose: ComposePageFn): IChatTool {
  return {
    name: 'canvas_compose_page',
    displaySummary: 'Write a canvas page live, streaming into the open editor.',
    description:
      'COMPOSE the body of an existing canvas page from an instruction. The body is ' +
      'GENERATED and streamed into the page — when the user has the page open they ' +
      'watch it being written block-by-block, live. Pass the page UUID and a clear ' +
      'instruction; do NOT pass the body itself. ' +
      'PREFER this over `canvas_edit_page` for substantial writes or rewrites (full drafts, ' +
      'restructures, long additions) — especially when the user is looking at the page. ' +
      'For small targeted touch-ups use `canvas_edit_block` or `canvas_edit_page`. ' +
      'REPLACES the existing body.',
    parameters: {
      type: 'object',
      required: ['pageId', 'instruction'],
      properties: {
        pageId: { type: 'string', description: 'UUID of the existing page to compose (from `canvas_find_pages` or the workspace context).' },
        instruction: { type: 'string', description: 'What to write — topic, structure, tone, constraints. The model composes the full body from this.' },
      },
    },
    requiresConfirmation: true,
    permissionLevel: 'requires-approval' as ToolPermissionLevel,
    category: 'canvas',
    async handler(args: Record<string, unknown>, token: ICancellationToken): Promise<IToolResult> {
      const pageId = String(args['pageId'] ?? '').trim();
      const instruction = String(args['instruction'] ?? '').trim();
      if (!pageId || !instruction) {
        return { content: 'canvas_compose_page needs a `pageId` and a non-empty `instruction`.', isError: true };
      }
      const outcome = await compose(pageId, instruction, token);
      return { content: outcome.summary, isError: !outcome.ok };
    },
  };
}
