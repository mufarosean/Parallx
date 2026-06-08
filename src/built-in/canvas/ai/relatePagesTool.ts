// relatePagesTool.ts — the `canvas_relate_pages` AI tool.
//
// Lets the agent ACT on its most common useful review intent: connect related
// canvas pages. It nests the related pages as sub-pages under a hub page via the
// data service's integrity-preserving `movePageWithBlocks`, so the structural
// link is real and reversible (no "page blocks disappear" hazard). Title-
// addressed, so the agent can call it straight from the workspace context it is
// shown in a review.

import type {
  IChatTool,
  IToolResult,
  ICancellationToken,
  ToolPermissionLevel,
} from '../../../services/chatTypes.js';

/** Resolve titles → page ids and nest each related page under the hub. Returns
 *  what was actually linked vs not found. Implemented in canvas/main.ts over the
 *  live data service (the tool stays pure/testable). */
export type RelatePagesFn = (
  hubTitle: string,
  relatedTitles: readonly string[],
) => Promise<{ hub?: string; linked: string[]; missing: string[] }>;

export function createRelatePagesTool(relate: RelatePagesFn): IChatTool {
  return {
    name: 'canvas_relate_pages',
    displaySummary: 'Connect related canvas pages under a hub page.',
    description:
      'Connect related canvas pages by nesting them as sub-pages under a hub page. ' +
      'Use when several existing pages clearly belong together — e.g. the user just ' +
      'created a hub page ("Q3 Planning") and related pages already exist ("Q3 Budget", ' +
      '"Q3 Goals"). Pass EXACT page titles as shown in the workspace context. The change ' +
      'is structural and reversible. Do NOT use this to create pages — only to relate ' +
      'ones that already exist.',
    parameters: {
      type: 'object',
      required: ['hub', 'related'],
      properties: {
        hub: { type: 'string', description: 'Exact title of the hub page that everything relates to.' },
        related: {
          type: 'array',
          items: { type: 'string' },
          description: 'Exact titles of the existing pages to nest under the hub.',
        },
      },
    },
    requiresConfirmation: true,
    permissionLevel: 'requires-approval' as ToolPermissionLevel,
    category: 'canvas',
    async handler(args: Record<string, unknown>, _token: ICancellationToken): Promise<IToolResult> {
      const hub = String(args['hub'] ?? '').trim();
      const related = Array.isArray(args['related'])
        ? (args['related'] as unknown[]).map((t) => String(t).trim()).filter(Boolean)
        : [];
      if (!hub || related.length === 0) {
        return { content: 'canvas_relate_pages needs a `hub` title and a non-empty `related` list of page titles.', isError: true };
      }

      const res = await relate(hub, related);
      if (!res.hub) {
        return { content: `Hub page "${hub}" was not found. Pass an exact, existing page title.`, isError: true };
      }
      if (res.linked.length === 0) {
        return {
          content: `Nothing linked under "${res.hub}" — none of the related titles matched existing pages: ${res.missing.join(', ') || '(none)'}.`,
          isError: true,
        };
      }
      const parts = [`Nested ${res.linked.length} page(s) under "${res.hub}": ${res.linked.join(', ')}.`];
      if (res.missing.length) parts.push(`Could not find: ${res.missing.join(', ')}.`);
      return { content: parts.join(' ') };
    },
  };
}
